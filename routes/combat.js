const express = require('express');
const db = require('../db/db');
const combat = require('../lib/combat');
const inventory = require('../lib/inventory');
const leveling = require('../lib/leveling');
const { getEquipmentBonuses, getNpcEquipmentBonuses } = require('../lib/equipment');
const { getClassPassiveBonuses } = require('../lib/passives');
const { getClassAncestorChain } = require('../lib/evolution');
const questSteps = require('../lib/questSteps');
const elements = require('../lib/elements');
const afinidades = require('../lib/afinidades');
const { getRankBonuses, applyPercentBonus } = require('../lib/ranks');
const questProgress = require('../lib/questProgress');
const achievements = require('../lib/achievements');
const aurelia = require('../lib/aurelia');
const coleccion = require('../lib/coleccion');
const comida = require('../lib/comida');
const mythic = require('../lib/mythic');
const mazmorras = require('../lib/mazmorras');
// los eclipses de las Ruinas Ancestrales: monstruos corrompidos (más fuerza y más premio)
const eclipse = require('../lib/eclipse');
// los aliados que pelean a tu lado en el final (R13, lib/aliados.js)
const aliados = require('../lib/aliados');
const piezasSet = require('../lib/piezasSet');
const huntRewards = require('../lib/huntRewards');
const eventos = require('../lib/eventos');
const { handleWorldBossFinalize, handleDailyEventFinalize, WORLD_BOSS_CODE_PREFIX } = require('../lib/eventFinalize');
const { requireAuth } = require('../lib/auth');
const { applyGuildXp, getGuildLevelsForPlayers, combatBonusMultipliers } = require('../lib/guilds');
const { positionOf } = require('../lib/worldPresence');
const pets = require('../lib/pets');
const { incrementCounter, markCounterCodeSeen, getCounter } = require('../lib/counters');
const logros = require('../lib/logros');
const { applyInnateTrigger, applyLiveInnateModifiers, getInnateForClass, getSkillModifier, getTargetDamageBonus } = require('../lib/innates');

// Enriquece `target` con datos que PASSIVE_CONDITIONAL "por target" necesita (categoría de
// monstruo, si es jefe, si ya se enfrentó ese tipo antes en este combate) y arma el Set de
// categorías ya enfrentadas. No se persiste nada de esto, es solo para evaluar la condición.
async function buildTargetInnateContext(sessionId, target) {
  if (!target?.monster_code) return { alreadyFought: new Set() };
  const monsterRes = await db.query('SELECT category FROM monsters WHERE code = $1', [target.monster_code]);
  target.monster_category = monsterRes.rows[0]?.category || null;
  const bossRes = await db.query(
    `SELECT 1 FROM player_tower_runs ptr JOIN tower_floors tf ON tf.floor_number = ptr.current_floor
     WHERE ptr.current_session_id = $1 AND tf.is_boss_floor AND tf.boss_monster_code = $2`,
    [sessionId, target.monster_code]
  );
  target.is_boss = bossRes.rows.length > 0;
  const foughtRes = await db.query(
    `SELECT DISTINCT m.category FROM combat_participants cp JOIN monsters m ON m.code = cp.monster_code
     WHERE cp.session_id = $1 AND cp.side = 'ENEMY' AND cp.hp <= 0 AND cp.id != $2`,
    [sessionId, target.id]
  );
  return { alreadyFought: new Set(foughtRes.rows.map((r) => r.category)) };
}

// Meditación (Sanador Legendario -> Asceta): el % de curación escala con MEDITACIONES_USADAS
// acumulado del propio jugador (se lee ANTES de incrementarlo con este uso).
function meditationHealPercent(usesSoFar) {
  if (usesSoFar >= 150) return 10;
  if (usesSoFar >= 100) return 7.5;
  if (usesSoFar >= 50) return 5;
  return 2.5;
}

// Clases cuyos ataques cuentan para KILLS_GOLPE_PUNO (Monje y evoluciones) / KILLS_CORTE
// (Espadachín y evoluciones) — no hay un único skill "Golpe de Puño"/"técnicas de corte",
// el contador es de clase (ver backend-spec-evolution-counters.md sección 3.1).
const PUNCH_CLASS_IDS = [6, 38, 42];
const CUT_CLASS_IDS = [7, 43];

// Los 5 venenos que cuentan para VENENOS_DOMINADOS (Envenenador -> Maestro Envenenador).
const POISON_SKILL_CODES = [
  'PICARO_ENVENENAMIENTO', 'ENVENENADOR_DOT', 'ENVENENADOR_DOT_DEBILITANTE',
  'ENVENENADOR_DOT_CORROSIVO', 'MAESTRO_ENVENENADOR_DOT_VACIO',
];

// World Boss (docs/backend-spec-world-boss.md): balance defaults, ajustables sin tocar
// arquitectura. Cualquier monstruo cuyo code empiece con este prefijo usa el golpe en área por
// % de HP máximo en vez de la fórmula de daño normal (ver rama especial en advanceEnemyTurns).
const WORLD_BOSS_ATTEMPT_COOLDOWN_SECONDS = 60;
const WORLD_BOSS_MIN_LEVEL_TO_ENTER = 10;
const WORLD_BOSS_HIT_PERCENT_MIN = 3;
const WORLD_BOSS_HIT_PERCENT_MAX = 7;
const WORLD_BOSS_DEF_MITIGATION_CAP = 0.45;

const router = express.Router();
router.use(requireAuth);

// players no tiene evasion como columna propia (solo "crit" como numero plano para chance),
// a diferencia de classes/monsters. Evasion se arma 100% de pasivas+equipo con base 0;
// crit_damage sale de classes.base_crit_damage (ver lib/leveling.js) + pasivas/equipo.
const DEFAULT_PLAYER_EVASION = 0;

// ---------- Helpers de carga/persistencia ----------

// ¿le queda a este jugador algún personaje en pie (su héroe o sus contratados) en esa sesión?
// Un jugador con todo caído en un combate de grupo que sigue no cuenta como "en combate": puede
// volver a su refugio y entrar en otra pelea mientras su grupo termina la suya.
const STANDING_SQL = `EXISTS (
  SELECT 1 FROM combat_participants alive
  WHERE alive.session_id = cs.id AND alive.hp > 0
    AND (alive.player_id = $1 OR alive.owner_player_id = $1)
)`;

async function hasAbandonedActiveSession(playerId) {
  const res = await db.query(
    `SELECT 1 FROM combat_abandoned_players cap
     JOIN combat_sessions cs ON cs.id = cap.session_id
     WHERE cap.player_id = $1 AND cs.status = 'IN_PROGRESS' AND ${STANDING_SQL}
     LIMIT 1`,
    [playerId]
  );
  return res.rows.length > 0;
}

// A diferencia de hasAbandonedActiveSession (que solo mira si LA IA tiene que resolver un
// combate que el jugador abandonó), esto detecta que el jugador sigue como combatiente activo
// en una sesion sin terminar, sin haberla abandonado (ej. inicio otra pelea sin cerrar esta).
async function hasActiveCombatSession(playerId) {
  const res = await db.query(
    `SELECT 1 FROM combat_participants cp
     JOIN combat_sessions cs ON cs.id = cp.session_id
     WHERE cp.player_id = $1 AND cs.status = 'IN_PROGRESS' AND ${STANDING_SQL}
     LIMIT 1`,
    [playerId]
  );
  return res.rows.length > 0;
}

async function hydratePlayers(playerIds) {
  // "bien alimentado": la comida que tomó antes de salir (lib/comida.js) suma sus bonos a esta pelea
  const foods = await comida.activeFor(playerIds).catch(() => ({}));
  const result = await db.query(
    `SELECT id, nickname, hp, max_hp, mana, max_mana, atk, def, mag, magic_def, spd, crit, luck,
            level, current_class_id, evolution_class_id,
            COALESCE(evolution_class_id, current_class_id) AS class_id
     FROM players WHERE id = ANY($1::int[])`,
    [playerIds]
  );
  return Promise.all(result.rows.map(async (p) => {
    // p.hp/max_hp ya incluyen el bono de equipo (ver lib/equipment.js applyHpBonusDelta);
    // sumarlo de nuevo aca lo duplicaba en cada pelea. Las pasivas SI suman de toda la cadena
    // de evolucion, no solo current/evolution (hay hasta 3 niveles de profundidad, ver
    // getClassAncestorChain) — p.class_id, usado abajo, sigue siendo solo la clase EFECTIVA, es
    // lo que el motor de innatas/combate necesita para saber "qué clase es ahora".
    const classChain = await getClassAncestorChain(p.class_id);
    const [bonus, passives, baseCritDamage, petB, util] = await Promise.all([
      getEquipmentBonuses(p.id),
      getClassPassiveBonuses(classChain, p.level),
      leveling.getClassBaseCritDamage(p.class_id),
      pets.getActivePetBonuses(p.id),
      coleccion.utilityBonuses(p.id),
    ]);

    const playerMaxHp = Math.round(p.max_hp * (1 + (passives.hp + (util.hp || 0)) / 100)) + petB.hp;
    const luck = Number(p.luck || 0) + (passives.luck || 0) + (bonus.luck || 0) + petB.luck;
    return {
      side: 'PLAYER',
      player_id: p.id,
      monster_code: null,
      name: p.nickname,
      hp: Math.min(p.hp, playerMaxHp),
      max_hp: playerMaxHp,
      mana: Math.min(p.mana, p.max_mana + petB.mana),
      max_mana: p.max_mana + petB.mana,
      atk: Math.round(p.atk * (1 + passives.atk / 100)) + (bonus.atk || 0) + petB.atk,
      mag: Math.round(p.mag * (1 + passives.mag / 100)) + (bonus.mag || 0) + petB.mag,
      def: Math.round(p.def * (1 + passives.def / 100)) + (bonus.def || 0) + petB.def,
      magic_def: Math.round(p.magic_def * (1 + passives.magic_def / 100)) + (bonus.magic_def || 0) + petB.magic_def,
      spd: Math.round(p.spd * (1 + passives.spd / 100)) + (bonus.spd || 0) + petB.spd,
      luck,
      crit_chance: Number(p.crit) + passives.crit_chance + (bonus.crit_chance || 0) + luck * 0.5 + petB.crit_chance,
      crit_damage: baseCritDamage + passives.crit_damage + (bonus.crit_damage || 0) + petB.crit_damage,
      evasion: DEFAULT_PLAYER_EVASION + passives.evasion + (bonus.evasion || 0) + petB.evasion,
      magic_damage_bonus: passives.magic_damage_bonus + passives.magical_damage,
      hot_hp_percent: passives.hot_hp_percent + petB.hot_hp_percent + (bonus.hot_hp_percent || 0),
      mana_regen_percent: bonus.mana_regen_percent || 0,
      physical_damage_bonus: passives.physical_damage,
      elemental_damage_bonus: passives.elemental_damage,
      heal_bonus: passives.heal_bonus + petB.heal_bonus + (bonus.heal_bonus || 0),
      // cartas de Aguante (lib/coleccion.js): menos daño recibido, nunca más ataque
      damage_reduction: petB.damage_reduction + (util.guard || 0),
      npc_id: null,
      class_id: p.class_id,
      level: p.level,
      xp_reward: 0,
      gold_reward: 0,
      owner_player_id: p.id,
    };
  })).then((list) => list.map((c) => comida.applyTo(c, foods[c.player_id]?.effects)));
}

async function hydratePartyNpcs(playerId, ownerPlayerId = null, slotLimit = null) {
  const result = await db.query(
    `SELECT pn.id, pn.name, pn.class_id, pn.level, pn.hp, pn.max_hp, pn.mana, pn.max_mana,
            pn.atk, pn.def, pn.mag, pn.magic_def, pn.spd, pn.crit
     FROM player_party pp
     JOIN player_npcs pn ON pn.id = pp.npc_id
     WHERE pp.player_id = $1
     ORDER BY pp.slot
     ${slotLimit ? `LIMIT ${slotLimit}` : ''}`,
    [playerId]
  );

  return Promise.all(result.rows.map(async (npc) => {
    const [bonus, passives, baseCritDamage] = await Promise.all([
      getNpcEquipmentBonuses(npc.id),
      getClassPassiveBonuses(npc.class_id, npc.level),
      leveling.getClassBaseCritDamage(npc.class_id),
    ]);
    return {
      side: 'PLAYER',
      player_id: null,
      npc_id: npc.id,
      class_id: npc.class_id,
      monster_code: null,
      name: npc.name,
      level: npc.level,
      hp: Math.min(npc.hp, Math.round(npc.max_hp * (1 + passives.hp / 100))),
      max_hp: Math.round(npc.max_hp * (1 + passives.hp / 100)),
      mana: npc.mana,
      max_mana: npc.max_mana,
      atk: Math.round(npc.atk * (1 + passives.atk / 100)) + (bonus.atk || 0),
      mag: Math.round(npc.mag * (1 + passives.mag / 100)) + (bonus.mag || 0),
      def: Math.round(npc.def * (1 + passives.def / 100)) + (bonus.def || 0),
      magic_def: Math.round(npc.magic_def * (1 + passives.magic_def / 100)) + (bonus.magic_def || 0),
      spd: Math.round(npc.spd * (1 + passives.spd / 100)) + (bonus.spd || 0),
      luck: (passives.luck || 0) + (bonus.luck || 0),
      crit_chance: Number(npc.crit) + passives.crit_chance + (bonus.crit_chance || 0) + ((passives.luck || 0) + (bonus.luck || 0)) * 0.5,
      crit_damage: baseCritDamage + passives.crit_damage + (bonus.crit_damage || 0),
      evasion: DEFAULT_PLAYER_EVASION + passives.evasion + (bonus.evasion || 0),
      magic_damage_bonus: passives.magic_damage_bonus + passives.magical_damage,
      hot_hp_percent: passives.hot_hp_percent + (bonus.hot_hp_percent || 0),
      mana_regen_percent: bonus.mana_regen_percent || 0,
      physical_damage_bonus: passives.physical_damage,
      elemental_damage_bonus: passives.elemental_damage,
      heal_bonus: passives.heal_bonus + (bonus.heal_bonus || 0),
      xp_reward: 0,
      gold_reward: 0,
      owner_player_id: ownerPlayerId ?? playerId,
    };
  }));
}

// "3-6" → { min: 3, max: 6 }; "15" → { min: 15, max: 15 }; recortado al rango de la zona.
function parseLevelRange(text, zoneMin, zoneMax) {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(String(text ?? ''));
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  const min = Math.max(zoneMin, Math.min(a, b));
  const max = Math.min(zoneMax, Math.max(a, b));
  return min <= max ? { min, max } : null;
}

// Interpola linealmente un stat entre las dos filas de monster_level_scalings que rodean al
// nivel pedido (normalmente solo hay 2 filas guardadas: min_spawn_level y max_spawn_level).
function interpolateStat(level, low, high, key) {
  const lowVal = Number(low[key]);
  const highVal = Number(high[key]);
  if (low.level === high.level) return lowVal;
  const t = (level - low.level) / (high.level - low.level);
  return lowVal + (highVal - lowVal) * t;
}

async function hydrateMonsters(monsterSpecs) {
  const combatants = [];

  for (const spec of monsterSpecs) {
    const monsterResult = await db.query('SELECT * FROM monsters WHERE code = $1', [spec.code]);
    if (!monsterResult.rows.length) continue;
    const monster = monsterResult.rows[0];
    const level = spec.level || monster.base_level;

    const scalingResult = await db.query(
      'SELECT * FROM monster_level_scalings WHERE monster_id = $1 ORDER BY level',
      [monster.id]
    );
    const rows = scalingResult.rows;

    // low = la fila de nivel mas alto que sea <= level; high = la de nivel mas bajo que sea >= level.
    // Si "level" cae fuera del rango cargado, ambas terminan apuntando a la punta mas cercana.
    let low = null;
    let high = null;
    for (const row of rows) {
      if (row.level <= level) low = row;
      if (row.level >= level && !high) high = row;
    }
    if (!low) low = high;
    if (!high) high = low;
    // Mundo 2D: las subzonas peligrosas suben a los monstruos por encima de su nivel máximo
    // cargado (un lobo común en las Tierras Heridas, nivel 12): en vez de quedarse con las stats
    // del techo, se sigue la misma recta de las dos últimas filas.
    if (spec.extrapolate && rows.length >= 2 && level > rows[rows.length - 1].level) {
      low = rows[rows.length - 2];
      high = rows[rows.length - 1];
    }

    const stat = (key, fallback) => (low ? Math.round(interpolateStat(level, low, high, key)) : fallback);
    const statRaw = (key, fallback) => (low ? interpolateStat(level, low, high, key) : fallback);

    // Si "level" (el nivel de quien entra) cae por debajo del min_spawn_level real del monstruo,
    // low/high de arriba quedan clavados en la fila de min_spawn_level (el piso mas bajo cargado) y
    // stat()/statRaw() devuelven esas stats TAL CUAL, sin importar que tan lejos este el nivel
    // pedido — un nivel 1 contra un dragon cuyo piso real es 38 recibia las stats completas de
    // nivel 38 y moria de un golpe (ver World Boss / Evento del Día, que escalan al nivel de quien
    // entra sin importar el piso natural del monstruo elegido). belowFloorRatio achica ademas
    // proporcionalmente al nivel real pedido; en 1 si level >= min_spawn_level (caso normal, no
    // cambia nada de lo que ya habia).
    const belowFloorRatio = (monster.min_spawn_level > 0 && level < monster.min_spawn_level)
      ? level / monster.min_spawn_level
      : 1;

    const hp = Math.max(1, Math.round(stat('hp', monster.base_hp) * belowFloorRatio));
    const levelRange = monster.max_spawn_level - monster.min_spawn_level;
    const spawnRatio = Math.max(0, levelRange > 0 ? (level - monster.min_spawn_level) / levelRange : 0);

    combatants.push({
      side: 'ENEMY',
      player_id: null,
      monster_code: monster.code,
      element_id: monster.element_id,
      // World Boss: el nivel real (escala al del jugador que entra) queda oculto en la ficha,
      // no en la logica de combate — level sigue siendo el numero real mas abajo y en toda
      // la interpolacion de arriba, solo se tapa lo que ve el jugador.
      name: monster.code.startsWith(WORLD_BOSS_CODE_PREFIX) ? `${monster.name} Lv.???` : `${monster.name} Lv.${level}`,
      hp,
      max_hp: hp,
      mana: level * 10,
      max_mana: level * 10,
      atk: Math.round(stat('atk', monster.base_atk) * belowFloorRatio),
      mag: Math.round(stat('magic_atk', monster.base_magic_atk) * belowFloorRatio),
      def: Math.round(stat('def', monster.base_def) * belowFloorRatio),
      magic_def: Math.round(stat('magic_def', monster.base_magic_def) * belowFloorRatio),
      spd: Math.round(stat('spd', monster.base_spd) * belowFloorRatio),
      crit_chance: statRaw('crit_chance', monster.base_crit_chance),
      crit_damage: statRaw('crit_damage', monster.base_crit_damage),
      evasion: statRaw('evasion', monster.base_evasion),
      // XP y oro escalan linealmente desde min_spawn_level (+0%) hasta max_spawn_level (+50%), y
      // ademas por belowFloorRatio (una version achicada del monstruo da recompensa achicada, no
      // la recompensa completa de su piso natural).
      xp_reward: Math.round(monster.xp_reward * belowFloorRatio * (1 + spawnRatio * 0.5)),
      gold_reward: Math.round(monster.gold_reward * belowFloorRatio * (1 + spawnRatio * 0.5)),
      level,
    });
  }

  return combatants;
}

// Máximo de personajes por lado en un combate: 3 jugadores, 1 jugador y sus 2 compañeros, o 2
// jugadores y un compañero.
const COMBAT_SIDE_MAX = 3;

// Mundo 2D: compañeros de grupo que entran a tu combate: están en el mundo, en tu zona, a menos
// de WORLD_GROUP_PX (unos 3 metros = 3 casillas, como si estuvieran a tu lado) y sin otro combate
// en curso. Da igual cómo empezó: hierba alta o un monstruo que deambula por el área.
const WORLD_GROUP_PX = 3 * 32 + 16;
async function worldGroupPartners(playerId, left = []) {
  const me = positionOf(playerId);
  if (!me) return [];
  const g = await db.query(
    `SELECT gm2.player_id FROM player_coop_group_members gm
     JOIN player_coop_group_members gm2 ON gm2.group_id = gm.group_id AND gm2.player_id <> gm.player_id
     WHERE gm.player_id = $1`,
    [playerId]
  );
  const out = [];
  for (const { player_id: pid } of g.rows) {
    const p = positionOf(pid);
    // los que se quedan afuera reciben un aviso (lejos, en otra zona o ya peleando)
    if (!p || p.zone !== me.zone || Math.hypot(p.x - me.x, p.y - me.y) > WORLD_GROUP_PX) { left.push({ pid, why: 'lejos' }); continue; }
    // está mirando el combate de otro (modo espectador): es intangible, no entra
    if (p.state === 'observando') { left.push({ pid, why: 'observando' }); continue; }
    // sigue dentro de otra pelea abierta (peleando, o caído mirando cómo termina): no se lo suma.
    // Si ya se fue de ella (salir caído), está libre.
    const busy = await db.query(
      `SELECT 1 FROM combat_participants cp JOIN combat_sessions cs ON cs.id = cp.session_id
       WHERE cp.player_id = $1 AND cs.status = 'IN_PROGRESS'
         AND NOT EXISTS (SELECT 1 FROM combat_abandoned_players cap WHERE cap.session_id = cs.id AND cap.player_id = $1)
       LIMIT 1`,
      [pid]
    );
    if (busy.rows.length || await hasAbandonedActiveSession(pid)) { left.push({ pid, why: 'ocupado' }); continue; }
    out.push(pid);
  }
  return out.slice(0, 2);
}

// avisa a los del grupo que no entraron al combate (estaban lejos u ocupados)
async function notifyLeftOut(req, leftOut, sessionId = null) {
  if (!leftOut?.length) return;
  const io = req.app.get('io');
  const who = await db.query('SELECT nickname FROM players WHERE id = $1', [req.playerId]);
  for (const { pid, why } of leftOut) {
    io?.to(`player:${pid}`).emit('coop:battle-missed', { leaderName: who.rows[0]?.nickname, leaderId: req.playerId, sessionId, why });
  }
}

// co-op: tras cuánto tiempo sin actuar se puede saltar el turno de un compañero (se defiende)
const IDLE_TURN_MS = 30 * 1000;

function emitCombatUpdate(req, sessionId, state) {
  req.app.get('io')?.to(`combat:${sessionId}`).emit('combat:update', state);
}

// Marca en player_monster_encounters los monstruos que estos jugadores acaban de enfrentar,
// para que el front sepa a cuales ya no debe ocultarles el nombre (bestiario).
async function recordMonsterEncounters(playerIds, enemyCombatants) {
  const ids = [...new Set(playerIds)].filter(Boolean);
  const codes = [...new Set(enemyCombatants.map((e) => e.monster_code))];
  if (!ids.length || !codes.length) return;
  await db.query(
    `INSERT INTO player_monster_encounters (player_id, monster_id)
     SELECT p, m.id FROM unnest($1::int[]) AS p, monsters m WHERE m.code = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [ids, codes]
  );
}

// "Jefe derrotado" basado en kill real (docs/backend-spec-jefe-derrotado-por-kill.md): a
// diferencia de player_monster_encounters (se llena al ENTRAR en combate), esta solo se llena en
// victoria -- se usa en GET /:playerId/zones para bossDefeated en vez de si completaste la misión.
async function recordMonsterKills(playerIds, enemyCombatants) {
  const ids = [...new Set(playerIds)].filter(Boolean);
  const codes = [...new Set(enemyCombatants.map((e) => e.monster_code))];
  if (!ids.length || !codes.length) return;
  await db.query(
    `INSERT INTO player_monster_kills (player_id, monster_id)
     SELECT p, m.id FROM unnest($1::int[]) AS p, monsters m WHERE m.code = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [ids, codes]
  );
}

// Crea la sesion de combate y reclama player_active_combat_session para cada jugador humano
// en la misma transaccion: player_id es PK ahi, asi que si alguno ya tiene una sesion activa
// el INSERT choca contra la constraint, se hace ROLLBACK completo (ninguna sesion duplicada
// llega a persistir) y se tira un error marcado con .isActiveCombatConflict para que la ruta
// responda 400 en vez de dejarlo caer en el 500 generico.
async function createCombatSessionWithClaim(insertSessionFn, playerIds) {
  const ids = [...new Set(playerIds.filter(Boolean))];

  // Repara claims huérfanas antes de intentar: un jugador puede quedar con una fila en
  // player_active_combat_session apuntando a una sesión donde nunca terminó de tener su propio
  // combat_participants (ej. lo invitaron a un coop pero quedó afuera por estar con 0 HP, o el
  // request se cayó entre el commit del claim y insertParticipants más abajo), o a una sesión
  // que ya terminó pero finalizeSession no lo limpió porque solo borra claims de quienes SÍ
  // llegaron a ser participantes. Sin esto, ese jugador queda bloqueado para siempre (todo intento
  // de entrar a un combate choca contra el PK de player_id y devuelve isActiveCombatConflict).
  if (ids.length) {
    await db.query(
      `DELETE FROM player_active_combat_session pacs
       USING combat_sessions cs
       WHERE pacs.session_id = cs.id
         AND pacs.player_id = ANY($1::int[])
         AND (
           cs.status != 'IN_PROGRESS'
           OR (
             -- una sesión recién creada todavía no tiene participantes (los inserta el mismo
             -- request justo después del claim): sin este margen, dos pedidos casi simultáneos
             -- se borraban el claim uno al otro y quedaban DOS combates abiertos
             cs.created_at < now() - interval '30 seconds'
             AND NOT EXISTS (
               SELECT 1 FROM combat_participants cp
               WHERE cp.session_id = cs.id AND (cp.player_id = pacs.player_id OR cp.owner_player_id = pacs.player_id)
             )
           )
         )`,
      [ids]
    );
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const sessionResult = await insertSessionFn(client);
    const sessionId = sessionResult.rows[0].id;
    for (const playerId of ids) {
      await client.query(
        'INSERT INTO player_active_combat_session(player_id, session_id) VALUES ($1, $2)',
        [playerId, sessionId]
      );
    }
    await client.query('COMMIT');
    return sessionResult;
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw Object.assign(
        new Error('Ya tienes (o tu compañero tiene) un combate sin terminar. Termínalo antes de iniciar otro.'),
        { isActiveCombatConflict: true }
      );
    }
    throw err;
  } finally {
    client.release();
  }
}

// regeneración de maná por ronda (el Orbe del mago): la columna se crea sola si la base no la tiene
let manaRegenColumn = null;
const ensureManaRegenColumn = () => (manaRegenColumn ??= db.query(
  'ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS mana_regen_percent NUMERIC(5,2) NOT NULL DEFAULT 0'
).catch((err) => { manaRegenColumn = null; throw err; }));

async function insertParticipants(sessionId, combatants) {
  await ensureManaRegenColumn();
  const inserted = [];
  for (const c of combatants) {
    const result = await db.query(
      `INSERT INTO combat_participants(
         session_id, side, player_id, npc_id, class_id, monster_code, name, hp, max_hp, mana, max_mana,
         atk, mag, def, magic_def, spd, crit_chance, crit_damage, evasion,
         magic_damage_bonus, hot_hp_percent, xp_reward, gold_reward,
         physical_damage_bonus, elemental_damage_bonus, heal_bonus, luck, owner_player_id, damage_reduction, level,
         mutation_code, mana_regen_percent, element_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
       RETURNING *`,
      [
        sessionId, c.side, c.player_id ?? null, c.npc_id ?? null, c.class_id ?? null,
        c.monster_code, c.name, c.hp, c.max_hp, c.mana, c.max_mana,
        c.atk, c.mag, c.def, c.magic_def, c.spd, c.crit_chance, c.crit_damage, c.evasion,
        c.magic_damage_bonus ?? 0, c.hot_hp_percent ?? 0, c.xp_reward, c.gold_reward,
        c.physical_damage_bonus ?? 0, c.elemental_damage_bonus ?? 0, c.heal_bonus ?? 0, c.luck ?? 0,
        c.owner_player_id ?? null, c.damage_reduction ?? 0, c.level ?? null,
        c.mutation_code ?? null, c.mana_regen_percent ?? 0,
        // elemento del monstruo: su golpe básico lleva una parte de ese elemento (lib/combat.js resolveAttack)
        c.monster_code ? c.element_id ?? null : null,
      ]
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

async function loadParticipants(sessionId) {
  const [participantsResult, buffsResult] = await Promise.all([
    db.query(
      `SELECT cp.*, c.name AS class_name
       FROM combat_participants cp
       LEFT JOIN classes c ON c.id = cp.class_id
       WHERE cp.session_id = $1
       ORDER BY cp.id`,
      [sessionId]
    ),
    db.query('SELECT id, participant_id, stat_code, applied_flat FROM combat_participant_buffs WHERE session_id = $1', [sessionId]),
  ]);
  const all = participantsResult.rows;
  for (const p of all) {
    p.temp_resist = {};
    p.no_damage_window = false;
    p.damage_taken_bonus = 0;
    p.paralysis = null;
    p.blind_miss = 0;
    p.taunting = false;
    for (const buff of buffsResult.rows) {
      if (buff.participant_id !== p.id) continue;
      if (buff.stat_code.startsWith('RESIST_')) {
        const elemCode = buff.stat_code.replace('RESIST_', '');
        p.temp_resist[elemCode] = (p.temp_resist[elemCode] || 0) + Number(buff.applied_flat);
      } else if (buff.stat_code === 'NO_DAMAGE') {
        p.no_damage_window = true;
      } else if (buff.stat_code === 'DAMAGE_TAKEN') {
        p.damage_taken_bonus += Number(buff.applied_flat);
      } else if (buff.stat_code === 'PARALYZE') {
        // applied_flat = última ronda en la que ya se sorteó si pierde el turno
        p.paralysis = { buffId: buff.id, checkedRound: Number(buff.applied_flat) };
      } else if (buff.stat_code === 'BLIND') {
        p.blind_miss += Number(buff.applied_flat);
      } else if (buff.stat_code === 'TAUNT') {
        p.taunting = true;
      }
    }
  }
  return {
    all,
    player: all.filter((p) => p.side === 'PLAYER'),
    enemy: all.filter((p) => p.side === 'ENEMY'),
  };
}

// Nigromante -> Lich (COMBATES_LIMITE_SOBREVIVIDOS, ex DIAS_VIVIDOS): marca la sesión si algún
// jugador bajó a <=10% de su HP máximo en algún momento. Se consume (y cuenta +1 por héroe) al
// ganar el combate en finalizeSession — nunca si se pierde estando así.
async function markNearDeathIfLow(p) {
  if (!p.player_id || p.hp <= 0 || !p.session_id) return;
  if (p.hp > Number(p.max_hp) * 0.10) return;
  await db.query('UPDATE combat_sessions SET had_near_death = TRUE WHERE id = $1', [p.session_id]);
}

async function persistParticipant(p) {
  await db.query(
    `UPDATE combat_participants SET hp=$1, mana=$2, is_defending=$3, has_acted_this_round=$4,
       atk=$5, mag=$6, def=$7, spd=$8, magic_def=$9, crit_chance=$10,
       imbued_element_id=$11, imbued_damage_bonus=$12
     WHERE id=$13`,
    [p.hp, p.mana, p.is_defending, p.has_acted_this_round, p.atk, p.mag, p.def, p.spd, p.magic_def, p.crit_chance,
     p.imbued_element_id ?? null, p.imbued_damage_bonus ?? 0, p.id]
  );
  await markNearDeathIfLow(p);
}

// ONCE_PER_COMBAT (variantes ligadas a la muerte): si `p` acaba de quedar en <=0 HP y su clase
// tiene esta innata (y todavía no la usó en este combate), sobrevive/revive en vez de caer.
// extra_json.survive_hp = nunca cae (Vacío del Combate); extra_json.revive_percent = cae y
// revive al toque (Trascendencia). Mismo patrón que pet_revive_used, a nivel innata de clase.
async function checkOnceForCombatSave(p) {
  if (!p || p.hp > 0 || p.innate_used_this_combat) return;
  const innate = await getInnateForClass(p.class_id);
  if (!innate || innate.trigger_type !== 'ONCE_PER_COMBAT') return;
  if (innate.extra_json?.survive_hp != null) {
    p.hp = Number(innate.extra_json.survive_hp);
  } else if (innate.extra_json?.revive_percent != null) {
    p.hp = Math.max(1, Math.round(Number(p.max_hp) * Number(innate.extra_json.revive_percent) / 100));
  } else {
    return;
  }
  p.innate_used_this_combat = true;
  await db.query('UPDATE combat_participants SET innate_used_this_combat = TRUE WHERE id = $1', [p.id]);
}

// ONCE_PER_COMBAT (Escamas de Dragón): inmune al primer crítico que reciba en el combate. Se
// llama ANTES de resolver el golpe; si corresponde, marca target.crit_immune para que
// lib/combat.js no aplique el multiplicador de crítico, y consume el uso solo si de verdad
// hubiera sido crítico (chequeado después vía result.critPrevented).
async function checkCritImmunity(target) {
  if (!target || target.innate_used_this_combat) return;
  const innate = await getInnateForClass(target.class_id);
  if (!innate || innate.trigger_type !== 'ONCE_PER_COMBAT' || !innate.extra_json?.immune_first_crit) return;
  target.crit_immune = true;
}
async function consumeCritImmunityIfUsed(target, result) {
  if (target?.crit_immune && result?.critPrevented) {
    target.innate_used_this_combat = true;
    await db.query('UPDATE combat_participants SET innate_used_this_combat = TRUE WHERE id = $1', [target.id]);
  }
}

// Nombre de zona de este combate (para PASSIVE_CONDITIONAL/ZONE_IN, ej. Saber Ancestral). Se
// deriva de cualquier enemigo con monster_code; null si no aplica (ej. PvP inexistente hoy).
async function getCombatZoneName(participants) {
  const anyEnemy = participants.enemy.find((e) => e.monster_code);
  if (!anyEnemy) return null;
  const res = await db.query(
    `SELECT mz.name FROM monsters m JOIN monster_zones mz ON mz.id = m.zone_id WHERE m.code = $1`,
    [anyEnemy.monster_code]
  );
  return res.rows[0]?.name || null;
}

// Sombra Doble (Asesino Umbrío): antes de que un enemigo confirme su objetivo, chance de que se
// "confunda" y golpee a otro participante al azar (de cualquier bando, aliado o enemigo del
// confundido). Devuelve el nuevo target si redirige, o null si no corresponde/no dispara.
// Objetivo de un enemigo entre los héroes vivos: si alguno provoca (Escudo Defensivo del
// Guerrero) y no está invisible, va contra él; si no, al azar.
function pickHeroTarget(heroes) {
  const alive = heroes.filter((p) => p.hp > 0);
  const taunters = alive.filter((p) => p.taunting && !p.no_damage_window);
  const pool = taunters.length ? taunters : alive;
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

async function maybeRedirectTarget(originalTarget, participants) {
  if (!originalTarget || originalTarget.hp <= 0) return null;
  const innate = await applyInnateTrigger('ON_ENEMY_TARGETS_ME', { actor: originalTarget, target: null, allies: [], enemies: [] });
  if (innate?.extra_json?.effect !== 'redirect_to_random_participant') return null;
  const pool = participants.all.filter((p) => p.hp > 0 && p.id !== originalTarget.id && !p.is_summon);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Escudo pequeño temporal: no existe un mecanismo de "escudo" dedicado, así que se aproxima con
// un DAMAGE_TAKEN negativo de 1-2 turnos (reduce el próximo golpe/s que reciba), reusando la
// misma tabla que ya usan los debuffs/buffs de daño recibido.
async function grantSmallShield(sessionId, participantId, reductionPercent = 15, durationTurns = 2) {
  await db.query(
    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DAMAGE_TAKEN',$3,$4,FALSE,NULL)",
    [sessionId, participantId, -reductionPercent, durationTurns]
  );
}

async function grantGuaranteedNextCrit(sessionId, participantId) {
  await db.query(
    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'PENDING_GUARANTEED_CRIT',0,3,FALSE,NULL)",
    [sessionId, participantId]
  );
}
// Si `actor` tiene un crítico garantizado pendiente (Danza de Acero), lo consume y devuelve true
// para que el caller fuerce el crítico en la resolución de este golpe.
async function consumePendingGuaranteedCrit(actor) {
  const res = await db.query(
    "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'PENDING_GUARANTEED_CRIT' RETURNING id",
    [actor.id]
  );
  return res.rows.length > 0;
}
// Disparo Fantasma (Francotirador Fantasmal): el primer ataque de cada combate no puede ser
// esquivado. Se consume en el primer ATTACK básico que el actor haga (no en skills).
async function consumePendingUnavoidableHit(actor) {
  const res = await db.query(
    "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'PENDING_UNAVOIDABLE_HIT' RETURNING id",
    [actor.id]
  );
  return res.rows.length > 0;
}

// Efectos de la familia de "golpe conectado": ON_BASIC_ATTACK_HIT (actor, ataque básico exitoso),
// ON_CRIT (actor, crítico) / ON_CRIT_RECEIVED (target, recibió un crítico), ON_DAMAGE_TAKEN
// (target, recibió daño — reflejo). ON_DODGE se maneja aparte en cada punto de esquive (ya
// existía desde la fase 2) para no disparar el trigger dos veces. isBasicAttack=true solo para
// el ATTACK básico (no skills). `allies` = vivos del mismo bando que `actor` (para heal random ally).
async function resolveOnHitInnates(sessionId, actor, target, result, isBasicAttack, actorAllies = []) {
  if (!target || result.evaded || !(result.damage > 0)) return;

  if (isBasicAttack) {
    const basicInnate = await applyInnateTrigger('ON_BASIC_ATTACK_HIT', { actor, target, allies: actorAllies, enemies: [] });
    if (basicInnate) {
      const eff = basicInnate.extra_json || {};
      if (eff.effect === 'extra_attack') {
        actor.grants_extra_action = true; // se lee al final del handler, ver "grants_extra_action"
      } else if (eff.apply_dot) {
        await db.query(
          "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',5,2,TRUE,NULL)",
          [sessionId, target.id]
        );
      } else if (eff.effect === 'heal_self_percent_of_damage_dealt') {
        const healAmt = Math.max(1, Math.round(result.damage * Number(basicInnate.percent_amount || 0) / 100));
        actor.hp = Math.min(Number(actor.max_hp), actor.hp + healAmt);
        await persistParticipant(actor);
      } else if (eff.effect === 'heal_random_ally_small') {
        const pool = [actor, ...actorAllies].filter((a) => a.hp > 0);
        const randomAlly = pool[Math.floor(Math.random() * pool.length)];
        if (randomAlly) {
          const healAmt = Math.max(1, Math.round(Number(randomAlly.max_hp) * 0.05));
          randomAlly.hp = Math.min(Number(randomAlly.max_hp), randomAlly.hp + healAmt);
          await persistParticipant(randomAlly);
        }
      } else if (eff.effect === 'add_minor_magic_hit_of_imbued_element' && actor.imbued_element_id) {
        const minorDmg = Math.max(1, Math.round(Number(actor.mag || 0) * 0.3));
        target.hp = Math.max(0, target.hp - minorDmg);
        await checkOnceForCombatSave(target);
        await persistParticipant(target);
      }
    }
  }

  if (result.crit) {
    const critInnate = await applyInnateTrigger('ON_CRIT', { actor, target, allies: actorAllies, enemies: [] });
    if (critInnate?.extra_json?.effect === 'debuff_mag_target') {
      await db.query(
        "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'MAG',$3,2,TRUE,NULL)",
        [sessionId, target.id, -10]
      );
    }
    // Cuerpo de Hierro (Maestro Monje, ON_CRIT_RECEIVED): dispara para que quede registrado, pero
    // no hay motor de "inmunidad a debuffs de DEF" todavía — no hay ningún debuff de DEF que
    // pueda aplicarse en el mismo golpe que un crítico hoy, así que no tiene efecto observable aún.
    await applyInnateTrigger('ON_CRIT_RECEIVED', { actor: target, target: actor, allies: [], enemies: [] });
  }

  const dmgTakenInnate = await applyInnateTrigger('ON_DAMAGE_TAKEN', { actor: target, target: actor, allies: [], enemies: [] });
  if (dmgTakenInnate?.extra_json?.effect === 'reflect_damage') {
    const reflectDmg = Math.max(1, Math.round(result.damage * Number(dmgTakenInnate.percent_amount || 0) / 100));
    actor.hp = Math.max(0, actor.hp - reflectDmg);
    await checkOnceForCombatSave(actor);
    await persistParticipant(actor);
  }
}

// CRITICOS_REALIZADOS / CRITICOS_ARCO: cualquier golpe (ATTACK o SKILL) del jugador con crit.
async function registerCritCounter(playerId, isCrit) {
  if (!isCrit) return;
  await incrementCounter(playerId, 'CRITICOS_REALIZADOS');
  const bowRes = await db.query(
    `SELECT 1 FROM player_equipment pe JOIN items i ON i.id = pe.item_id
     WHERE pe.player_id = $1 AND pe.slot = 'WEAPON' AND i.code LIKE 'ARCO_%'`,
    [playerId]
  );
  if (bowRes.rows.length) await incrementCounter(playerId, 'CRITICOS_ARCO');
}

// Contadores de kill: por elemento de la skill, por categoría/zona del monstruo, y los 4
// contadores atados a un skill/clase puntual (GOLPES_LETALES, KILLS_EXPLOSIVO, KILLS_GOLPE_PUNO,
// KILLS_CORTE). `skill` es null para un ATTACK básico (sin elemento ni clase asociada).
async function registerKillCounters(playerId, sessionId, deadTargets, skill, actor = null, participants = null) {
  if (!deadTargets.length) return;

  if (actor) {
    const killInnate = await applyInnateTrigger('ON_KILL', { actor, target: deadTargets[0], allies: [], enemies: [] });
    if (killInnate?.is_stacking) {
      const stackAmount = Number(killInnate.extra_json?.stack_amount || 1);
      actor.innate_stacks = (actor.innate_stacks || 0) + stackAmount;
      await db.query('UPDATE combat_participants SET innate_stacks = $1 WHERE id = $2', [actor.innate_stacks, actor.id]);
    } else if (killInnate) {
      const eff = killInnate.extra_json || {};
      if (eff.effect === 'heal_self_percent_max_hp') {
        const healAmt = Math.max(1, Math.round(Number(actor.max_hp) * Number(killInnate.percent_amount || 0) / 100));
        actor.hp = Math.min(Number(actor.max_hp), actor.hp + healAmt);
        await persistParticipant(actor);
      } else if (participants && (eff.effect === 'summon_spirit_single_attack' || eff.effect === 'summon_skeleton_temp')) {
        const name = eff.effect === 'summon_spirit_single_attack' ? 'Espíritu Vengador' : 'Esqueleto Invocado';
        await createSummonParticipant(
          sessionId, actor, { stat_code: name, duration_turns: eff.effect === 'summon_spirit_single_attack' ? 1 : 3, percent_amount: 0 },
          { id: null, element_id: null }, participants
        );
        const roundRes = await db.query('SELECT current_round FROM combat_sessions WHERE id = $1', [sessionId]);
        await execSummonBonusAttack(sessionId, actor.id, roundRes.rows[0]?.current_round, participants);
      }
    }
  }

  let elemCode = null;
  if (skill?.element_id) {
    elemCode = await elements.getElementCodeById(skill.element_id);
    if (elemCode) await incrementCounter(playerId, `KILLS_${elemCode}`, deadTargets.length);
    if (elemCode) await incrementCounter(playerId, 'KILLS_ELEMENTAL', deadTargets.length);
  }

  if (skill) {
    if (skill.code === 'PICARO_GOLPE_LETAL') await incrementCounter(playerId, 'GOLPES_LETALES', deadTargets.length);
    if (skill.code === 'ARQUERO_FLECHA_EXPLOSIVA') await incrementCounter(playerId, 'KILLS_EXPLOSIVO', deadTargets.length);
    if (PUNCH_CLASS_IDS.includes(skill.class_id)) await incrementCounter(playerId, 'KILLS_GOLPE_PUNO', deadTargets.length);
    if (CUT_CLASS_IDS.includes(skill.class_id)) await incrementCounter(playerId, 'KILLS_CORTE', deadTargets.length);
  }

  for (const target of deadTargets) {
    if (!target.monster_code) continue; // estos contadores son solo por kills de monstruos
    const monsterRes = await db.query('SELECT category, zone_id FROM monsters WHERE code = $1', [target.monster_code]);
    const monster = monsterRes.rows[0];
    if (!monster) continue;

    if (monster.category === 'DRACOIDE') await incrementCounter(playerId, 'KILLS_DRAGON');
    if (monster.category === 'BESTIA') {
      await incrementCounter(playerId, 'ANIMALES_CAZADOS');
      await incrementCounter(playerId, 'ANIMALES_SALVAJES_MUERTOS');
    }
    if (['DEMONIO', 'ESPECTRO', 'MUERTO_VIVIENTE'].includes(monster.category) || elemCode === 'DARK') {
      await incrementCounter(playerId, 'ENEMIGOS_OSCUROS_MUERTOS');
    }
    if (elemCode === 'COSMIC') {
      const bossRes = await db.query(
        `SELECT 1 FROM player_tower_runs ptr JOIN tower_floors tf ON tf.floor_number = ptr.current_floor
         WHERE ptr.current_session_id = $1 AND tf.is_boss_floor AND tf.boss_monster_code = $2`,
        [sessionId, target.monster_code]
      );
      if (bossRes.rows.length) await incrementCounter(playerId, 'BOSSES_COSMICOS_MUERTOS');
    }
    if (monster.zone_id) {
      const zoneRes = await db.query(
        `SELECT 1 FROM monster_zones WHERE id = $1 AND (name ILIKE 'Ruinas%' OR name ILIKE 'Catacumbas%')`,
        [monster.zone_id]
      );
      if (zoneRes.rows.length) await incrementCounter(playerId, 'KILLS_EN_RUINAS');
    }
  }
}

// Trampa (Pícaro -> Especialista en Trampas): se activa SOLA en el turno siguiente de quien la
// plantó, sin pedirle ninguna acción (mismo espíritu que un turno de IA/abandonado). Hiere a un
// objetivo random del bando CONTRARIO a quien puso la trampa con un sangrado de 5 turnos.
async function resolveTrapActivation(sessionId, round, actor, participants) {
  const targetPool = actor.side === 'PLAYER' ? participants.enemy : participants.player;
  const target = combat.pickRandomAliveTarget(targetPool);

  actor.is_preparing_trap = false;
  actor.trap_rounds_remaining = 0;
  actor.has_acted_this_round = true;
  await db.query(
    'UPDATE combat_participants SET is_preparing_trap = FALSE, trap_rounds_remaining = 0, has_acted_this_round = TRUE WHERE id = $1',
    [actor.id]
  );

  if (!target) {
    await insertLog(sessionId, round, {
      actorId: actor.id, action: 'SKILL', targetId: null,
      description: `¡La trampa de ${actor.name} se activó, pero ya no quedaba nadie a quien herir!`,
    });
    return;
  }

  // World Boss es inmune a todo DOT (ver startNewRound) — misma razón que el bloque de skills
  // ESTADO_ALTERADO: evitar crear un buff inerte y un mensaje de "sangrado" que nunca va a pegar.
  if (target.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX)) {
    await insertLog(sessionId, round, {
      actorId: actor.id, action: 'SKILL', targetId: target.id,
      description: `¡La trampa de ${actor.name} se activó, pero ${target.name} es inmune al sangrado (daño por % de HP máximo)!`,
    });
    if (actor.player_id) await incrementCounter(actor.player_id, 'TRAMPAS_DESPLEGADAS');
    return;
  }

  await db.query(
    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',5,5,TRUE,NULL)",
    [sessionId, target.id]
  );
  await insertLog(sessionId, round, {
    actorId: actor.id, action: 'SKILL', targetId: target.id,
    description: `¡La trampa de ${actor.name} se activó! ${target.name} queda sangrando (5% HP máx/turno, 5 turnos).`,
  });

  if (actor.player_id) await incrementCounter(actor.player_id, 'TRAMPAS_DESPLEGADAS');
}

// Crea un invocado como combat_participant del lado PLAYER con has_acted_this_round=TRUE
// (el invocado no tiene turno propio; actua como bonus action del invocador).
// Aplica el aura de resistencia elemental a todos los aliados vivos.
async function createSummonParticipant(sessionId, actor, summonEffect, skill, participants) {
  let invokerLevel = 1;
  if (actor.player_id) {
    const r = await db.query('SELECT level FROM players WHERE id = $1', [actor.player_id]);
    invokerLevel = r.rows[0]?.level || 1;
  } else if (actor.npc_id) {
    const r = await db.query('SELECT level FROM player_npcs WHERE id = $1', [actor.npc_id]);
    invokerLevel = r.rows[0]?.level || 1;
  }

  const summonName     = summonEffect.stat_code;
  const summonHp       = Math.round(Number(actor.max_hp) * 0.40);
  const summonDef      = Math.round(invokerLevel * 3);
  const summonRounds   = Number(summonEffect.duration_turns || 5);
  const auraStrength   = Number(summonEffect.percent_amount || 25);

  const ins = await db.query(
    `INSERT INTO combat_participants(
       session_id, side, player_id, npc_id, class_id, monster_code,
       name, hp, max_hp, mana, max_mana, atk, mag, def, magic_def, spd,
       crit_chance, crit_damage, evasion, magic_damage_bonus, hot_hp_percent,
       xp_reward, gold_reward,
       is_summon, summoner_id, summon_rounds_remaining, element_id, has_acted_this_round
     ) VALUES ($1,'PLAYER',NULL,NULL,NULL,NULL,$2,$3,$3,0,0,0,$4,$5,$5,0,
               0,150,0,0,0,0,0, TRUE,$6,$7,$8,TRUE)
     RETURNING *`,
    [sessionId, summonName, summonHp, Number(actor.mag), summonDef,
     actor.id, summonRounds, skill.element_id ?? null]
  );
  const summon = ins.rows[0];
  summon.temp_resist      = {};
  summon.no_damage_window = false;
  summon.damage_taken_bonus = 0;

  // Vínculo Espiritual: los invocados del dueño de la innata nacen con stats reforzados.
  const summonerInnate = await getInnateForClass(actor.class_id);
  if (summonerInnate?.trigger_type === 'PASSIVE_STAT' && summonerInnate.extra_json?.summon_bonus) {
    const { atk: atkPct, mag: magPct } = summonerInnate.extra_json.summon_bonus;
    if (atkPct) summon.atk = Math.round(Number(summon.atk || 0) * (1 + Number(atkPct) / 100));
    if (magPct) summon.mag = Math.round(Number(summon.mag || 0) * (1 + Number(magPct) / 100));
    await db.query('UPDATE combat_participants SET atk = $1, mag = $2 WHERE id = $3', [summon.atk, summon.mag, summon.id]);
  }

  // Aura de resistencia elemental para todos los aliados vivos
  if (skill.element_id) {
    const elemCode = await elements.getElementCodeById(skill.element_id);
    if (elemCode) {
      const statCode    = `RESIST_${elemCode}`;
      const alivePlayers = participants.player.filter((p) => p.hp > 0);
      for (const p of alivePlayers) {
        p.temp_resist[elemCode] = (p.temp_resist[elemCode] || 0) + auraStrength;
        await db.query(
          'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,FALSE,$6)',
          [sessionId, p.id, statCode, auraStrength, summonRounds, skill.id]
        );
      }
    }
  }

  participants.player.push(summon);
  participants.all.push(summon);
  return { summon, auraStrength };
}

// Ejecuta el ataque automatico del invocado activo del actor (bonus action).
// No tiene turno propio; se llama justo despues de que el invocador actue.
async function execSummonBonusAttack(sessionId, actorParticipantId, round, participants) {
  const summon = participants.player.find(
    (p) => p.is_summon && Number(p.summoner_id) === actorParticipantId && p.hp > 0
  );
  if (!summon) return null;

  const aliveEnemies = participants.enemy.filter((e) => e.hp > 0);
  if (!aliveEnemies.length) return null;

  const target    = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
  const synthSkill = {
    base_value: 30, scaling_stat: 'MAG', scaling_multiplier: 0.75,
    hits: 1, skill_type: 'ATAQUE', damage_school: 'MAGICO',
    element_id: summon.element_id,
  };

  let elemModsByTarget = {};
  if (summon.element_id) {
    const elemCode  = await elements.getElementCodeById(summon.element_id);
    const lapBonus = await getTowerLapBonus(sessionId);
    const baseResist = target.monster_code
      ? await elements.getMonsterElementResistance(target.monster_code, summon.element_id, lapBonus)
      : target.player_id
        ? await elements.getPlayerElementResistance(target.player_id, summon.element_id)
        : await elements.getClassElementResistance(target.class_id, summon.element_id);
    const tempResist = (elemCode && target.temp_resist?.[elemCode]) || 0;
    elemModsByTarget[target.id] = { damageBonusPercent: 0, resistancePercent: baseResist + tempResist };
  }

  const [result] = combat.resolveSkill(summon, [target], synthSkill, elemModsByTarget);
  await persistParticipant(target);

  const elemCode = summon.element_id ? await elements.getElementCodeById(summon.element_id) : null;
  const hitDesc  = result.evaded
    ? `${target.name} esquiva`
    : `${target.name} por ${result.amount}${result.crit ? ' (¡crítico!)' : ''}${elemCode ? ` [${elemCode}]` : ''}`;

  await insertLog(sessionId, round, {
    actorId:  summon.id,
    action:   'ATTACK',
    targetId: target.id,
    damage:   result.evaded ? 0 : result.amount,
    evaded:   result.evaded,
    crit:     result.crit,
    description: `${summon.name} ataca a ${hitDesc}.`,
    hp_after: target.hp,
  });

  return result;
}

function getParticipantStat(participant, statCode) {
  if (statCode === 'ATK') return Number(participant.atk || 0);
  if (statCode === 'MAG') return Number(participant.mag || 0);
  if (statCode === 'DEF') return Number(participant.def || 0);
  if (statCode === 'MAGIC_DEF') return Number(participant.magic_def || 0);
  if (statCode === 'SPD') return Number(participant.spd || 0);
  if (statCode === 'CRIT_CHANCE') return Number(participant.crit_chance || 0);
  if (statCode === 'EVASION') return Number(participant.evasion || 0);
  return 0;
}

function applyStatDelta(participant, statCode, delta) {
  if (statCode === 'ATK') participant.atk = (participant.atk || 0) + delta;
  else if (statCode === 'MAG') participant.mag = (participant.mag || 0) + delta;
  else if (statCode === 'DEF') participant.def = (participant.def || 0) + delta;
  else if (statCode === 'MAGIC_DEF') participant.magic_def = (participant.magic_def || 0) + delta;
  else if (statCode === 'SPD') participant.spd = (participant.spd || 0) + delta;
  else if (statCode === 'CRIT_CHANCE') participant.crit_chance = (participant.crit_chance || 0) + delta;
  else if (statCode === 'EVASION') participant.evasion = (participant.evasion || 0) + delta;
}

// Técnicas que el maestro de tu orden ya te puede enseñar al pasar de fromLevel a toLevel (para
// avisarlo al subir de nivel)
async function teachableSkillNames(playerId, fromLevel, toLevel) {
  const pr = await db.query('SELECT current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId]);
  if (!pr.rows.length) return [];
  const chain = await getClassAncestorChain(pr.rows[0].evolution_class_id || pr.rows[0].current_class_id);
  const r = await db.query(
    `SELECT s.name FROM skills s
     WHERE s.learn_method = 'GOLD' AND s.learn_level > $2 AND s.learn_level <= $3 AND s.class_id = ANY($4::int[])
       AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $1 AND ps.skill_id = s.id)
     ORDER BY s.learn_level, s.id`,
    [playerId, fromLevel, toLevel, chain]
  );
  return r.rows.map((x) => x.name);
}

// ---- Estados de las habilidades (sangrado, quemadura, parálisis…) ----
// Los efectos secundarios de las habilidades de daño están en skill_effects con chance_percent
// (35%): cada estado (status_code) se sortea UNA vez por objetivo golpeado y, si sale, se aplican
// todas sus filas (la quemadura es daño por turno + menos ataque). Las habilidades de estado
// (Envenenamiento…) no pasan por aquí: esas siempre aplican.
const STATUS_NAMES = { BLEED: 'sangrado', BURN: 'quemadura', SLOW: 'ralentización', PARALYZE: 'parálisis', BLIND: 'ceguera', WEAKEN: 'debilidad', POISON: 'veneno' };
const DOT_NAMES = { BLEED: 'sangrado', BURN: 'quemadura', POISON: 'veneno' };
// paralizado: probabilidad de perder el turno (se sortea una vez por ronda)
const PARALYSIS_SKIP_PERCENT = 25;

// Inmunidades lógicas: un monstruo de fuego no se quema, una roca no sangra, un fantasma no se
// envenena. Por la categoría del monstruo (sin sangre ni cuerpo vivo) o por su elemento (si es de
// ese elemento o lo resiste bastante). Solo monstruos: los héroes se protegen con su equipo.
const STATUS_IMMUNE_CATEGORIES = {
  BLEED: ['ELEMENTAL', 'ESPECTRO', 'MUERTO_VIVIENTE'],
  POISON: ['ELEMENTAL', 'ESPECTRO', 'MUERTO_VIVIENTE'],
};
const STATUS_IMMUNE_ELEMENT = { BURN: 'FIRE', PARALYZE: 'LIGHTNING', SLOW: 'ICE' };
const IMMUNE_RESIST_PERCENT = 40;
const monsterNatureCache = new Map();
async function monsterNature(code) {
  if (!monsterNatureCache.has(code)) {
    const m = (await db.query(
      `SELECT m.category, e.code AS element,
              COALESCE(json_object_agg(re.code, mer.resistance_percent) FILTER (WHERE re.code IS NOT NULL), '{}') AS resist
       FROM monsters m LEFT JOIN elements e ON e.id = m.element_id
       LEFT JOIN monster_element_resistances mer ON mer.monster_id = m.id
       LEFT JOIN elements re ON re.id = mer.element_id
       WHERE m.code = $1 GROUP BY m.id, e.code`,
      [code]
    )).rows[0];
    monsterNatureCache.set(code, m ?? null);
  }
  return monsterNatureCache.get(code);
}
// ¿este objetivo no puede sufrir este estado? (status: BURN, BLEED, POISON, PARALYZE, SLOW…)
async function immuneToStatus(target, status) {
  if (!target?.monster_code || !status) return false;
  const n = await monsterNature(target.monster_code);
  if (!n) return false;
  if (STATUS_IMMUNE_CATEGORIES[status]?.includes(n.category)) return true;
  const el = STATUS_IMMUNE_ELEMENT[status];
  return !!el && (n.element === el || Number(n.resist?.[el] ?? 0) >= IMMUNE_RESIST_PERCENT);
}
// el daño por turno de una habilidad de estado: quemadura si es de fuego, si no veneno
const dotStatusOf = (elementCode) => (elementCode === 'FIRE' ? 'BURN' : 'POISON');

async function applyStatusEffect(sessionId, target, effect, skillId, actor) {
  const status = effect.status_code ?? null;
  const dur = Number(effect.duration_turns);
  if (['DOT', 'PARALYZE', 'BLIND'].includes(effect.effect_type)) {
    // DOT: % de vida por ronda; BLIND: % de fallar sus golpes; PARALYZE: empieza sin ronda sorteada
    const flat = effect.effect_type === 'PARALYZE' ? 0 : Number(effect.percent_amount || 0);
    await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = $2 AND skill_id = $3', [target.id, effect.effect_type, skillId]);
    await db.query(
      'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id,status_code) VALUES($1,$2,$3,$4,$5,TRUE,$6,$7)',
      [sessionId, target.id, effect.effect_type, flat, dur, skillId, status]
    );
  } else if (effect.effect_type === 'STAT_MOD' && dur) {
    await applyStatModBuff(sessionId, target, effect, true, [], skillId, actor);
    if (status) {
      await db.query('UPDATE combat_participant_buffs SET status_code = $1 WHERE participant_id = $2 AND skill_id = $3 AND stat_code = $4',
        [status, target.id, skillId, effect.stat_code]);
    }
  }
}

async function applyOnHitStatuses(sessionId, actor, skill, results, descParts) {
  if (skill.skill_type !== 'ATAQUE') return;
  const rows = (await db.query(
    `SELECT effect_type, stat_code, percent_amount, duration_turns, chance_percent, status_code
     FROM skill_effects WHERE skill_id = $1 AND chance_percent IS NOT NULL ORDER BY id`,
    [skill.id]
  )).rows;
  if (!rows.length) return;
  const groups = {};
  for (const r of rows) (groups[r.status_code ?? r.effect_type] ??= []).push(r);
  for (const res of results) {
    const t = res.target;
    if (res.evaded || t.hp <= 0) continue;
    // el World Boss no sufre daño por turno ni pierde turnos
    const worldBoss = t.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX);
    for (const [status, effects] of Object.entries(groups)) {
      if (Math.random() * 100 >= Number(effects[0].chance_percent)) continue;
      if (worldBoss && effects.some((e) => e.effect_type === 'DOT' || e.effect_type === 'PARALYZE')) continue;
      // un DOT sin estado nombrado es veneno
      const code = status === 'DOT' ? 'POISON' : status;
      if (await immuneToStatus(t, code)) {
        descParts.push(`${t.name} es inmune a ${STATUS_NAMES[code] ?? code.toLowerCase()}.`);
        continue;
      }
      for (const e of effects) await applyStatusEffect(sessionId, t, e, skill.id, actor);
      descParts.push(`¡${t.name} sufre ${STATUS_NAMES[status] ?? status.toLowerCase()}!`);
    }
  }
}

// Parálisis: al empezar su turno, una vez por ronda, puede quedarse sin actuar
async function paralysisSkip(sessionId, round, actor) {
  if (!actor.paralysis || actor.paralysis.checkedRound === round) return false;
  await db.query('UPDATE combat_participant_buffs SET applied_flat = $1 WHERE id = $2', [round, actor.paralysis.buffId]);
  actor.paralysis.checkedRound = round;
  if (Math.random() * 100 >= PARALYSIS_SKIP_PERCENT) return false;
  actor.has_acted_this_round = true;
  actor.is_defending = false;
  await persistParticipant(actor);
  await insertLog(sessionId, round, {
    actorId: actor.id, targetId: actor.id, action: 'SKILL', success: false,
    description: `${actor.name} está paralizado y no puede moverse.`,
  });
  return true;
}

// Aplica un efecto STAT_MOD (imbue, resist, DAMAGE_TAKEN, o stat regular) a un participante.
// skillId: si se pasa, la misma skill no puede acumular el mismo efecto (solo refresca duración).
// Distintas skills con el mismo stat_code SÍ pueden acumularse (ej. dos imbues distintos de fuego).
async function applyStatModBuff(sessionId, target, effect, isDebuff, descParts, skillId = null, actor = null) {
  const ELEMENT_CODES = ['FIRE', 'ICE', 'LIGHTNING', 'WIND', 'EARTH', 'WATER', 'LIGHT', 'DARK', 'COSMIC'];
  const SUPPORTED_BUFF_STATS = ['ATK', 'MAG', 'DEF', 'MAGIC_DEF', 'SPD', 'CRIT_CHANCE', 'EVASION'];
  const pct = Number(effect.percent_amount || 0);
  const durationTurns = Number(effect.duration_turns);

  const resistElemCode = ELEMENT_CODES.find((ec) => effect.stat_code === `RESIST_${ec}`);
  if (resistElemCode) {
    if (skillId) {
      const ex = await db.query(
        'SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code=$3',
        [target.id, skillId, effect.stat_code]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} resist ${resistElemCode} refrescado (${durationTurns}T)`);
        return;
      }
    }
    target.temp_resist = target.temp_resist || {};
    target.temp_resist[resistElemCode] = (target.temp_resist[resistElemCode] || 0) + pct;
    await db.query(
      'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [sessionId, target.id, effect.stat_code, pct, durationTurns, isDebuff, skillId]
    );
    descParts.push(`${target.name} +${pct}% resist ${resistElemCode} (${durationTurns}T)`);
    return;
  }

  const imbueElemCode = ELEMENT_CODES.find((ec) => effect.stat_code === `${ec}_DAMAGE`);
  if (imbueElemCode) {
    const imbueStatCode = `IMBUE_${imbueElemCode}`;
    if (skillId) {
      const ex = await db.query(
        'SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code=$3',
        [target.id, skillId, imbueStatCode]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} imbue ${imbueElemCode} refrescado (${durationTurns}T)`);
        return;
      }
    }
    const elemId = await elements.getElementIdByCode(imbueElemCode);
    if (elemId) {
      target.imbued_element_id = elemId;
      target.imbued_damage_bonus = pct;
      await persistParticipant(target);
      await db.query(
        'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [sessionId, target.id, imbueStatCode, pct, durationTurns, false, skillId]
      );
      descParts.push(`${target.name} imbuído con ${imbueElemCode} +${pct}% daño (${durationTurns}T)`);
      if (actor) {
        const imbueInnate = await applyInnateTrigger('ON_IMBUE', { actor, target, allies: [], enemies: [] });
        if (imbueInnate?.extra_json?.effect === 'self_gains_resist_that_element_1_turn') {
          await db.query(
            "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,1,FALSE,NULL)",
            [sessionId, actor.id, `RESIST_${imbueElemCode}`, Number(imbueInnate.percent_amount || 0)]
          );
        }
      }
    }
    return;
  }

  if (effect.stat_code === 'DAMAGE_TAKEN') {
    if (skillId) {
      const ex = await db.query(
        "SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code='DAMAGE_TAKEN'",
        [target.id, skillId]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} maldición refrescada (${durationTurns}T)`);
        return;
      }
    }
    target.damage_taken_bonus = (target.damage_taken_bonus || 0) + pct;
    await db.query(
      "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DAMAGE_TAKEN',$3,$4,$5,$6)",
      [sessionId, target.id, pct, durationTurns, isDebuff, skillId]
    );
    const sign = pct >= 0 ? '+' : '';
    descParts.push(`${target.name} ${sign}${pct}% daño recibido (${durationTurns}T)`);
    return;
  }

  if (SUPPORTED_BUFF_STATS.includes(effect.stat_code)) {
    if (skillId) {
      const ex = await db.query(
        'SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code=$3',
        [target.id, skillId, effect.stat_code]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} ${effect.stat_code} refrescado (${durationTurns}T)`);
        return;
      }
    }
    // EVASION es un caso especial: pct es el valor ABSOLUTO objetivo (ej. 100 = esquiva
    // garantizada), no un multiplicador del valor actual (que suele arrancar en 0).
    const appliedFlat = effect.stat_code === 'EVASION'
      ? pct - getParticipantStat(target, 'EVASION')
      : Math.round(getParticipantStat(target, effect.stat_code) * pct / 100);
    applyStatDelta(target, effect.stat_code, appliedFlat);
    await persistParticipant(target);
    await db.query(
      'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [sessionId, target.id, effect.stat_code, appliedFlat, durationTurns, isDebuff, skillId]
    );
    const sign = pct >= 0 ? '+' : '';
    descParts.push(`${target.name} ${sign}${pct}% ${effect.stat_code} (${durationTurns}T)`);
  }
}

// ─── Romper (estilo Octopath) ───────────────────────────────────────────────────────────────
// Cada monstruo tiene un escudo según su rareza. Cada golpe que recibe de un jugador le quita 1
// punto (2 si es su debilidad elemental, 0 si lo resiste; las habilidades de varios golpes quitan
// por golpe).
// Al llegar a 0 queda ROTO: pierde su turno en esta ronda y en la siguiente y recibe +50% de daño
// (buff DAMAGE_TAKEN); al terminar se le restaura el escudo. Escudo y rotura se guardan como filas
// especiales de combat_participant_buffs (SHIELD con el valor actual, BREAK con las rondas).
// Los jefes (MINIBOSS/LEGENDARY) además entran en FURIA una vez al bajar de la mitad de vida.
const SHIELD_BY_RARITY = { COMMON: 3, RARE: 4, MINIBOSS: 5, LEGENDARY: 7 };
const BREAK_DAMAGE_BONUS = 50;
const FURY_ATK_PERCENT = 30;
let monsterRarityCache = null;

async function getMonsterRarities(code = null) {
  // un monstruo que se agregó después de llenar la caché (p. ej. los de la cripta, que se crean
  // la primera vez que se usan) obliga a recargarla
  if (monsterRarityCache && code && !(code in monsterRarityCache)) monsterRarityCache = null;
  if (!monsterRarityCache) {
    const r = await db.query('SELECT code, rarity FROM monsters');
    monsterRarityCache = Object.fromEntries(r.rows.map((m) => [m.code, m.rarity]));
  }
  return monsterRarityCache;
}

async function maxShieldOf(p) {
  if (!p.monster_code || p.monster_code.startsWith(WORLD_BOSS_CODE_PREFIX) || p.is_summon) return 0;
  const rarities = await getMonsterRarities(p.monster_code);
  return SHIELD_BY_RARITY[rarities[p.monster_code]] ?? 3;
}

async function applyBreakAndFury(sessionId, round, actor, participants, hpBefore, body) {
  if (actor.side !== 'PLAYER') return;
  let elementId = actor.imbued_element_id ?? null;
  let hits = 1;
  if (body.action === 'SKILL' && body.skillId) {
    const sk = (await db.query('SELECT element_id, hits FROM skills WHERE id = $1', [body.skillId])).rows[0];
    elementId = sk?.element_id ?? null;
    hits = Math.max(1, Number(sk?.hits) || 1);
  } else if (body.action !== 'ATTACK') {
    return;
  }
  const rarities = await getMonsterRarities(participants.enemy[0]?.monster_code);
  for (const enemy of participants.enemy) {
    const before = hpBefore.get(enemy.id);
    if (before == null || enemy.hp >= before) continue;
    // furia del jefe: una sola vez por combate al bajar de la mitad
    if (['MINIBOSS', 'LEGENDARY'].includes(rarities[enemy.monster_code]) && enemy.hp > 0 && enemy.hp <= enemy.max_hp / 2) {
      const fury = await db.query("SELECT 1 FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'FURY'", [enemy.id]);
      if (!fury.rows.length) {
        const extra = Math.round(Number(enemy.atk) * FURY_ATK_PERCENT / 100);
        applyStatDelta(enemy, 'ATK', extra);
        await persistParticipant(enemy);
        await db.query(
          "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'FURY',$3,9999,FALSE,NULL)",
          [sessionId, enemy.id, extra]
        );
        await insertLog(sessionId, round, {
          actorId: actor.id, targetId: enemy.id, action: 'SKILL',
          description: `¡${enemy.name} entra en furia! Su ataque aumenta un ${FURY_ATK_PERCENT}%.`,
        });
      }
    }
    // golpear con un elemento descubre cómo le afecta a este tipo de monstruo (lib/afinidades.js)
    if (elementId) {
      const elCode = (await getElementCodes())[elementId];
      await afinidades.learn(actor.player_id ?? actor.owner_player_id, enemy.monster_code, elCode).catch(() => {});
    }
    if (enemy.hp <= 0) continue;
    const max = await maxShieldOf(enemy);
    if (!max) continue;
    const broken = await db.query("SELECT 1 FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'BREAK'", [enemy.id]);
    if (broken.rows.length) continue;
    // cuánto le quita al escudo cada golpe: 1 lo neutro (y lo físico), 2 su debilidad, 0 lo que resiste
    let perHit = 1;
    // los jefes de mazmorra cambian de debilidad (lib/mazmorra.js): manda la de este momento
    const forcedWeak = mazmorras.isBoss(enemy.monster_code) ? await mazmorras.weakElementOf(enemy.id) : null;
    if (forcedWeak != null) {
      perHit = elementId === forcedWeak ? 2 : 1;
    } else if (elementId) {
      const res = await db.query(
        `SELECT mer.resistance_percent FROM monster_element_resistances mer
         JOIN monsters m ON m.id = mer.monster_id WHERE m.code = $1 AND mer.element_id = $2`,
        [enemy.monster_code, elementId]
      );
      const pct = Number(res.rows[0]?.resistance_percent ?? 0);
      perHit = pct < 0 ? 2 : pct > 0 ? 0 : 1;
    }
    if (perHit === 0) {
      await insertLog(sessionId, round, {
        actorId: actor.id, targetId: enemy.id, action: 'SKILL',
        description: `${enemy.name} resiste ese elemento: su escudo no cede.`,
      });
      continue;
    }
    const row = (await db.query("SELECT id, applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'SHIELD'", [enemy.id])).rows[0];
    const current = row ? Number(row.applied_flat) : max;
    const next = Math.max(0, current - perHit * hits);
    if (row) await db.query('UPDATE combat_participant_buffs SET applied_flat = $1 WHERE id = $2', [next, row.id]);
    else {
      await db.query(
        "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'SHIELD',$3,9999,FALSE,NULL)",
        [sessionId, enemy.id, next]
      );
    }
    if (next === 0) {
      // ¡roto! pierde lo que le quedaba de esta ronda y la siguiente, y recibe más daño
      enemy.has_acted_this_round = true;
      await persistParticipant(enemy);
      await db.query(
        `INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id)
         VALUES($1,$2,'BREAK',0,2,TRUE,NULL), ($1,$2,'DAMAGE_TAKEN',$3,2,TRUE,NULL)`,
        [sessionId, enemy.id, BREAK_DAMAGE_BONUS]
      );
      await insertLog(sessionId, round, {
        actorId: actor.id, targetId: enemy.id, action: 'SKILL',
        description: `¡${enemy.name} ha sido ROTO! Pierde su turno y recibe más daño.`,
      });
    }
  }
}

async function getLastActingSide(sessionId, round) {
  const result = await db.query(
    `SELECT cp.side FROM combat_log cl
     JOIN combat_participants cp ON cp.id = cl.actor_participant_id
     WHERE cl.session_id = $1 AND cl.round = $2
     ORDER BY cl.id DESC LIMIT 1`,
    [sessionId, round]
  );
  return result.rows[0] ? result.rows[0].side : null;
}

// combat_log.skill_code: qué habilidad se usó (el combate 2D la anima con su efecto propio).
// Se agrega sola la primera vez, así el back no se cae si se despliega antes del schema.sql.
let skillCodeColumn = null;
const ensureSkillCodeColumn = () => (skillCodeColumn ??= db.query('ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS skill_code TEXT')
  .catch((err) => { skillCodeColumn = null; throw err; }));

async function insertLog(sessionId, round, entry) {
  await ensureSkillCodeColumn();
  await db.query(
    `INSERT INTO combat_log(session_id, round, actor_participant_id, action, target_participant_id, item_id, damage, heal, evaded, crit, success, description, hp_after, mana_after, skill_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      sessionId, round, entry.actorId, entry.action, entry.targetId || null, entry.itemId || null,
      entry.damage ?? null, entry.heal ?? null, entry.evaded || false, entry.crit || false, entry.success !== false, entry.description,
      entry.hp_after ?? null, entry.mana_after ?? null, entry.skillCode ?? null,
    ]
  );
}

async function startNewRound(sessionId, participants) {
  await db.query('UPDATE combat_sessions SET current_round = current_round + 1, updated_at = now() WHERE id = $1', [sessionId]);
  const roundRes = await db.query('SELECT current_round, world_boss_event_id FROM combat_sessions WHERE id = $1', [sessionId]);
  const newRound = roundRes.rows[0].current_round;
  const isWorldBoss = !!roundRes.rows[0].world_boss_event_id;
  // Los invocados tienen has_acted_this_round=TRUE permanente (actuan como bonus action, no turno propio)
  await db.query(
    'UPDATE combat_participants SET has_acted_this_round = FALSE, is_defending = FALSE WHERE session_id = $1 AND hp > 0 AND NOT is_summon',
    [sessionId]
  );
  participants.all.forEach((p) => {
    if (p.hp > 0 && !p.is_summon) {
      p.has_acted_this_round = false;
      p.is_defending = false;
    }
  });

  // DOT tick: daño por veneno antes de expirar buffs (percent_amount % del HP máximo por ronda).
  const dotRows = await db.query(
    "SELECT * FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'DOT'",
    [sessionId]
  );
  for (const dot of dotRows.rows) {
    const p = participants.all.find((x) => x.id === dot.participant_id);
    // World Boss: inmune a todo DOT (% de daño por turno), sea cual sea la skill/innata que lo
    // haya aplicado — el buff sigue su curso normal (cuenta rondas, expira) pero no pega.
    if (p && p.hp > 0 && !p.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX)) {
      const dotDmg = Math.max(1, Math.round(Number(p.max_hp) * Number(dot.applied_flat) / 100));
      p.hp = Math.max(0, p.hp - dotDmg);
      await checkOnceForCombatSave(p);
      await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
      await markNearDeathIfLow(p);
      // queda en el registro para que el cliente muestre el daño del veneno (actor = objetivo).
      // Va en la ronda que termina: getLastActingSide mira la ronda nueva y no debe contarlo.
      await insertLog(sessionId, newRound - 1, {
        actorId: p.id, targetId: p.id, action: 'SKILL', damage: dotDmg, hp_after: p.hp,
        description: `${p.name} sufre ${dotDmg} de daño por ${DOT_NAMES[dot.status_code] ?? 'veneno'}.`,
      });
    }
  }

  // Tick de buffs/debuffs: decrementar turns restantes y revertir los que expiran.
  const buffsResult = await db.query(
    'SELECT * FROM combat_participant_buffs WHERE session_id = $1',
    [sessionId]
  );
  for (const buff of buffsResult.rows) {
    const newRounds = buff.rounds_remaining - 1;
    const p = participants.all.find((x) => x.id === buff.participant_id);
    if (newRounds <= 0) {
      if (p) {
        if (buff.stat_code.startsWith('IMBUE_')) {
          p.imbued_element_id = null;
          p.imbued_damage_bonus = 0;
          await persistParticipant(p);
        } else if (buff.stat_code === 'BREAK') {
          // se recupera de la rotura: escudo lleno otra vez
          const max = await maxShieldOf(p);
          await db.query("UPDATE combat_participant_buffs SET applied_flat = $1 WHERE participant_id = $2 AND stat_code = 'SHIELD'", [max, p.id]);
          await mazmorras.onBreakEnd(sessionId, p, newRound - 1, insertLog);
        } else if (buff.stat_code.startsWith('RESIST_') || buff.stat_code === 'DOT' || buff.stat_code === 'NO_DAMAGE' || buff.stat_code === 'DAMAGE_TAKEN' || buff.stat_code === 'HOT' || buff.stat_code === 'SHIELD' || buff.stat_code === 'FURY' || buff.stat_code === 'PARALYZE' || buff.stat_code === 'BLIND' || buff.stat_code === 'TAUNT') {
          // Solo borrar la fila: estos efectos no tienen stat persistido que revertir
        } else {
          applyStatDelta(p, buff.stat_code, -Number(buff.applied_flat));
          await persistParticipant(p);
        }
      }
      await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [buff.id]);
    } else {
      await db.query('UPDATE combat_participant_buffs SET rounds_remaining = $1 WHERE id = $2', [newRounds, buff.id]);
      // SEGUNDOS_OCULTO: aunque el nombre diga "segundos", se mide en turnos con invisibilidad activa.
      if (buff.stat_code === 'NO_DAMAGE' && p?.player_id) {
        await incrementCounter(p.player_id, 'SEGUNDOS_OCULTO');
      }
    }
  }

  // HOT tick desde skills temporales (stat_code='HOT', applied_flat = % del max_hp). World Boss:
  // anula toda regeneración por turno (activa o pasiva, ver loop siguiente) — el buff sigue
  // existiendo y contando rondas, solo no cura, para que la pelea no se pueda "turtlear".
  const hotSkillRows = await db.query(
    "SELECT * FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'HOT'",
    [sessionId]
  );
  if (!isWorldBoss) {
    for (const hot of hotSkillRows.rows) {
      const p = participants.all.find((x) => x.id === hot.participant_id);
      if (p && p.hp > 0) {
        const healAmt = Math.max(1, Math.round(Number(p.max_hp) * Number(hot.applied_flat) / 100));
        const before = p.hp;
        p.hp = Math.min(Number(p.max_hp), p.hp + healAmt);
        await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
        if (p.hp > before) {
          await insertLog(sessionId, newRound - 1, {
            actorId: p.id, targetId: p.id, action: 'SKILL', heal: p.hp - before, hp_after: p.hp,
            description: `${p.name} recupera ${p.hp - before} PV por regeneración.`,
          });
        }
      }
    }
  }

  // HOT (Heal Over Time): participantes vivos con hot_hp_percent > 0 se curan al final de cada ronda.
  if (!isWorldBoss) {
    for (const p of participants.all) {
      if (p.hp > 0 && Number(p.hot_hp_percent) > 0) {
        const heal = Math.max(1, Math.round(Number(p.max_hp) * Number(p.hot_hp_percent) / 100));
        p.hp = Math.min(Number(p.max_hp), p.hp + heal);
        await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
      }
    }
  }

  // regeneración de maná del equipo (el Orbe del mago): % del maná máximo al final de cada ronda
  for (const p of participants.all) {
    if (p.hp > 0 && Number(p.mana_regen_percent) > 0 && Number(p.mana) < Number(p.max_mana)) {
      const gain = Math.max(1, Math.round(Number(p.max_mana) * Number(p.mana_regen_percent) / 100));
      p.mana = Math.min(Number(p.max_mana), Number(p.mana) + gain);
      await db.query('UPDATE combat_participants SET mana = $1 WHERE id = $2', [p.mana, p.id]);
    }
  }

  // Los que siguen ROTOS no actúan en esta ronda
  const brokenRows = await db.query("SELECT participant_id FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'BREAK'", [sessionId]);
  for (const row of brokenRows.rows) {
    const p = participants.all.find((x) => x.id === row.participant_id);
    if (p && p.hp > 0) {
      p.has_acted_this_round = true;
      await db.query('UPDATE combat_participants SET has_acted_this_round = TRUE WHERE id = $1', [p.id]);
    }
  }

  // Expiración de invocados: decrementar rondas restantes; al llegar a 0, desaparecer
  const activeSummons = await db.query(
    'SELECT id, name, summon_rounds_remaining FROM combat_participants WHERE session_id = $1 AND is_summon = TRUE AND hp > 0',
    [sessionId]
  );
  for (const row of activeSummons.rows) {
    const remaining = Number(row.summon_rounds_remaining) - 1;
    const sp = participants.all.find((p) => p.id === row.id);
    if (remaining <= 0) {
      await db.query('UPDATE combat_participants SET hp = 0 WHERE id = $1', [row.id]);
      if (sp) sp.hp = 0;
      await insertLog(sessionId, newRound, {
        actorId: row.id, action: 'SKILL',
        description: `${row.name} ha cumplido su tiempo y regresa a su plano.`,
      });
    } else {
      await db.query('UPDATE combat_participants SET summon_rounds_remaining = $1 WHERE id = $2', [remaining, row.id]);
      if (sp) sp.summon_rounds_remaining = remaining;
    }
  }
}

// Cada monstruo (ver seed.sql: monster_drops) tiene exactamente 1 material propio con su
// drop_chance_percent (COMMON 30%, RARE 15%, MINIBOSS 8%, LEGENDARY 100% garantizado) y una
// cantidad min/max. Se rolea independiente por CADA enemigo de la sesion (no por codigo unico),
// asi que matar 2 Lobos de Pradera en la misma pelea son 2 tiradas separadas de su drop.
// Pergaminos de receta de un jefe (SCROLL_<SET>_<CLASE>, uno por clase): cada jefe vencido da COMO
// MUCHO UNO. Se tira una sola vez con el % de monster_drops por OWN_CLASS_SCROLL_MULT (35% en los
// minijefes, 25% en los legendarios) y, si sale, la clase se elige con peso: las clases de los héroes
// del combate (partyClasses) pesan el doble, así a cada uno le cae más seguido el suyo y los de otras
// clases siguen saliendo para comerciarlos.
const OWN_CLASS_SCROLL_MULT = 2;
// Piezas de set de jefe: también COMO MUCHO UNA por jefe, en su propia tirada (55% épico o raro, 45%
// legendario) y con el mismo peso por clase que el pergamino. La pieza enseña a fabricarse a sí misma.
const PIECE_CHANCE = { LEGENDARIO: 22.5, OTRO: 27.5 };
const pieceChanceOf = (rarity) => (rarity === 'LEGENDARIO' ? PIECE_CHANCE.LEGENDARIO : PIECE_CHANCE.OTRO);
// bono de experiencia por cada otro jugador del grupo (ver el reparto en finalizeSession)
const GROUP_XP_BONUS = 0.1;
// el elemento del golpe básico de un monstruo, como se lee en el registro ("+ 40 de fuego")
const ELEMENT_WORD = { FIRE: 'fuego', ICE: 'hielo', LIGHTNING: 'rayo', WATER: 'agua', EARTH: 'tierra', WIND: 'viento', LIGHT: 'luz', DARK: 'oscuridad', COSMIC: 'energía cósmica' };
// cuánto maná devuelve el ataque básico (fracción del máximo)
const BASIC_ATTACK_MANA_PCT = 0.08;
async function rollMonsterDrops(enemies, dropRateBonusPct = 0, partyClasses = []) {
  const codes = [...new Set(enemies.map((e) => e.monster_code))];
  if (!codes.length) return [];
  const ownScroll = (itemCode) => /^SCROLL_/.test(itemCode ?? '') && partyClasses.some((c) => itemCode.endsWith(`_${c}`));

  const dropsResult = await db.query(
    `SELECT m.code AS monster_code, md.item_id, i.code AS item_code, i.name AS item_name, i.rarity AS item_rarity,
            md.drop_chance_percent, md.min_quantity, md.max_quantity
     FROM monster_drops md
     JOIN monsters m ON m.id = md.monster_id
     JOIN items i ON i.id = md.item_id
     WHERE m.code = ANY($1::text[])`,
    [codes]
  );
  // Agrupa drops por monstruo. Cada drop normal se tira aparte; los pergaminos de clase de un jefe
  // (5 filas, una por clase) se tiran juntos: como mucho uno (ver OWN_CLASS_SCROLL_MULT).
  const dropsByCode = new Map();
  for (const row of dropsResult.rows) {
    if (!dropsByCode.has(row.monster_code)) dropsByCode.set(row.monster_code, []);
    dropsByCode.get(row.monster_code).push(row);
  }

  // Piezas de set de jefe: además del pergamino (la receta del set), una tirada aparte por una pieza al
  // azar del set de una clase (elegida con el mismo peso que el pergamino). La pieza enseña a
  // fabricarse a sí misma (lib/recetas.js).
  const scrollIds = [...new Set(dropsResult.rows.filter((d) => /^SCROLL_/.test(d.item_code)).map((d) => d.item_id))];
  const piecesOf = new Map();
  if (scrollIds.length) {
    const pr = await db.query(
      `SELECT cr.scroll_item_id, i.id, i.name FROM crafting_recipes cr JOIN items i ON i.id = cr.result_item_id
       WHERE cr.scroll_item_id = ANY($1::int[]) AND i.item_type = 'EQUIPMENT'`,
      [scrollIds]
    );
    for (const p of pr.rows) {
      if (!piecesOf.has(p.scroll_item_id)) piecesOf.set(p.scroll_item_id, []);
      piecesOf.get(p.scroll_item_id).push(p);
    }
  }

  const bonus = 1 + dropRateBonusPct / 100;
  // una fila de pergamino al azar, con las clases del grupo pesando el doble
  const pickScrollRow = (rows) => {
    const weights = rows.map((r) => (ownScroll(r.item_code) ? OWN_CLASS_SCROLL_MULT : 1));
    let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
    return rows.find((_, i) => (roll -= weights[i]) < 0) ?? rows[rows.length - 1];
  };
  const dropped = [];
  for (const enemy of enemies) {
    const drops = dropsByCode.get(enemy.monster_code);
    if (!drops) continue;
    const scrolls = drops.filter((d) => /^SCROLL_/.test(d.item_code));
    for (const drop of drops) {
      if (scrolls.includes(drop)) continue;
      if (Math.random() * 100 >= Math.min(100, Number(drop.drop_chance_percent) * bonus)) continue;
      const quantity = drop.min_quantity + Math.floor(Math.random() * (drop.max_quantity - drop.min_quantity + 1));
      dropped.push({ itemId: drop.item_id, itemName: drop.item_name, quantity });
    }
    if (!scrolls.length) continue;
    // como mucho un pergamino…
    const scrollChance = Math.min(100, Math.max(...scrolls.map((d) => Number(d.drop_chance_percent))) * OWN_CLASS_SCROLL_MULT * bonus);
    if (Math.random() * 100 < scrollChance) {
      const drop = pickScrollRow(scrolls);
      const quantity = drop.min_quantity + Math.floor(Math.random() * (drop.max_quantity - drop.min_quantity + 1));
      dropped.push({ itemId: drop.item_id, itemName: drop.item_name, quantity });
    }
    // …y como mucho una pieza de su set, en su propia tirada
    const withPieces = scrolls.filter((d) => piecesOf.get(d.item_id)?.length);
    if (withPieces.length) {
      const pieceChance = Math.min(100, pieceChanceOf(withPieces[0].item_rarity) * OWN_CLASS_SCROLL_MULT * bonus);
      if (Math.random() * 100 < pieceChance) {
        const pieces = piecesOf.get(pickScrollRow(withPieces).item_id);
        const piece = pieces[Math.floor(Math.random() * pieces.length)];
        dropped.push({ itemId: piece.id, itemName: piece.name, quantity: 1 });
      }
    }
  }
  return dropped;
}

// ---------- Torre infinita: motor de corridas (Fase 2) ----------
const TOWER_DIFFICULTY_STAT_MULT = { 1: 1.0, 2: 1.3, 3: 1.6 };
const TOWER_DIFFICULTY_COIN_MULT = { 1: 1, 2: 1.5, 3: 2 };

// Rareza de encuentro + mutaciones (docs/backend-spec-abismo-rareza-mutaciones.md): capa nueva y
// separada de monsters.rarity (que es elegibilidad de spawn, no esto) — un monstruo de sala normal
// puede salir más fuerte y/o mutado. No aplica a pisos de jefe.
const ENCOUNTER_RARITY_WEIGHTS      = { COMUN: 60, POCO_COMUN: 20, RARO: 10, ELITE: 7, MINI_JEFE: 2, JEFE: 1 };
const ENCOUNTER_RARITY_STAT_MULT    = { COMUN: 1,  POCO_COMUN: 1.15, RARO: 1.35, ELITE: 1.7, MINI_JEFE: 2.2, JEFE: 2.8 };
const ENCOUNTER_RARITY_REWARD_MULT  = { COMUN: 1,  POCO_COMUN: 1.2,  RARO: 1.5,  ELITE: 2,   MINI_JEFE: 3,   JEFE: 4 };
const ENCOUNTER_RARITY_MUTATION_CHANCE = { COMUN: 0, POCO_COMUN: 0.1, RARO: 0.3, ELITE: 0.6, MINI_JEFE: 0.9, JEFE: 1 };
const ENCOUNTER_RARITY_LABEL = { POCO_COMUN: 'Poco Común', RARO: 'Raro', ELITE: 'Élite', MINI_JEFE: 'Mini Jefe', JEFE: 'Jefe' };
const ENCOUNTER_RARITY_ORDER = Object.keys(ENCOUNTER_RARITY_WEIGHTS);

const MUTATIONS = {
  FRENETICO: { label: 'Frenético', apply: (e) => { e.spd = Math.round(e.spd * 1.4); } },
  GIGANTE:   { label: 'Gigante',   apply: (e) => { e.hp = Math.round(e.hp * 2); e.max_hp = e.hp; } },
  DORADO:    { label: 'Dorado',    apply: (e) => { e.gold_reward = Math.round(e.gold_reward * 3); } },
  CORRUPTO:  { label: 'Corrupto',  apply: (e) => { e.mutation_code = 'CORRUPTO'; } },
};

function rollEncounterRarity() {
  const total = Object.values(ENCOUNTER_RARITY_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const tier of ENCOUNTER_RARITY_ORDER) {
    if (roll < ENCOUNTER_RARITY_WEIGHTS[tier]) return tier;
    roll -= ENCOUNTER_RARITY_WEIGHTS[tier];
  }
  return 'COMUN';
}

// Muta un enemigo YA hidratado (hydrateMonsters) in-place. encounter_rarity no tiene columna
// propia en combat_participants todavia (v1: alcanza con que quede concatenado en el name, ver
// sección 5 del doc) — mutation_code SÍ necesita persistir de verdad porque Corrupto se chequea
// en cada ataque futuro del mismo participante (ver hook en advanceEnemyTurns).
function applyEncounterRarity(enemy) {
  const tier = rollEncounterRarity();
  if (tier !== 'COMUN') {
    const mult = ENCOUNTER_RARITY_STAT_MULT[tier];
    enemy.hp = Math.round(enemy.hp * mult); enemy.max_hp = enemy.hp;
    enemy.atk = Math.round(enemy.atk * mult);
    enemy.def = Math.round(enemy.def * mult);
    enemy.mag = Math.round(enemy.mag * mult);
    enemy.magic_def = Math.round(enemy.magic_def * mult);
    enemy.spd = Math.round(enemy.spd * mult);
    const rewardMult = ENCOUNTER_RARITY_REWARD_MULT[tier];
    enemy.gold_reward = Math.round(enemy.gold_reward * rewardMult);
    enemy.xp_reward = Math.round(enemy.xp_reward * rewardMult);
    enemy.name = `${enemy.name} · ${ENCOUNTER_RARITY_LABEL[tier]}`;
    enemy.encounter_rarity = tier;
  }
  if (Math.random() < ENCOUNTER_RARITY_MUTATION_CHANCE[tier]) {
    const codes = Object.keys(MUTATIONS);
    const code = codes[Math.floor(Math.random() * codes.length)];
    MUTATIONS[code].apply(enemy);
    enemy.name = `${enemy.name} ${MUTATIONS[code].label}`;
  }
}

// Evento del Día (docs/backend-spec-evento-del-dia.md): misma escala de stats/recompensa/mutación
// que applyEncounterRarity de arriba, pero sin sorteo — la plantilla del día ya trae el tier y la
// mutación fijos (si tiene), así que se aplican directo en vez de tirar rollEncounterRarity().
function applyForcedRarityAndMutation(enemy, forcedRarity, forcedMutation) {
  const mult = ENCOUNTER_RARITY_STAT_MULT[forcedRarity];
  if (mult && mult !== 1) {
    enemy.hp = Math.round(enemy.hp * mult); enemy.max_hp = enemy.hp;
    enemy.atk = Math.round(enemy.atk * mult);
    enemy.def = Math.round(enemy.def * mult);
    enemy.mag = Math.round(enemy.mag * mult);
    enemy.magic_def = Math.round(enemy.magic_def * mult);
    enemy.spd = Math.round(enemy.spd * mult);
  }
  const rewardMult = ENCOUNTER_RARITY_REWARD_MULT[forcedRarity];
  if (rewardMult && rewardMult !== 1) {
    enemy.gold_reward = Math.round(enemy.gold_reward * rewardMult);
    enemy.xp_reward = Math.round(enemy.xp_reward * rewardMult);
  }
  enemy.name = `${enemy.name} · ${ENCOUNTER_RARITY_LABEL[forcedRarity] || forcedRarity}`;
  enemy.encounter_rarity = forcedRarity;
  if (forcedMutation && MUTATIONS[forcedMutation]) {
    MUTATIONS[forcedMutation].apply(enemy);
    enemy.name = `${enemy.name} ${MUTATIONS[forcedMutation].label}`;
  }
}

// Eventos narrativos de sala (docs/backend-spec-abismo-eventos-narrativos.md): antes de que una
// sala sea combate garantizado, una ruleta pesada por Luck decide si en vez es un evento con 2
// opciones. Luck alta => menos trampas, más de todo lo bueno; luck baja => al revés, tope +/-40
// para no volver el combate irrelevante ni garantizar solo eventos buenos con luck muy alta.
const TOWER_EVENT_CATEGORY_BASE_WEIGHTS = { COMBAT: 55, TRAP: 15, VENDOR: 10, SANCTUARY: 8, SECRET: 7, STORY: 5 };
const TOWER_EVENT_TRAP_DAMAGE_PERCENT = 8;

function rollRoomCategory(avgLuck) {
  const shift = Math.max(-40, Math.min(40, avgLuck * 0.6));
  const w = { ...TOWER_EVENT_CATEGORY_BASE_WEIGHTS };
  w.TRAP = Math.max(2, w.TRAP - shift * 0.5);
  w.VENDOR += shift * 0.15;
  w.SANCTUARY += shift * 0.15;
  w.SECRET += shift * 0.1;
  w.STORY += shift * 0.1;

  const total = Object.values(w).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [cat, weight] of Object.entries(w)) {
    if (roll < weight) return cat;
    roll -= weight;
  }
  return 'COMBAT';
}

// Elige una fila al azar de tower_room_events para esa categoria, pesada por su columna weight
// (no la categoria en si, eso ya lo resolvio rollRoomCategory). Null si esa categoria no tiene
// ninguna fila cargada todavia (cae a combate en el caller).
async function pickRoomEvent(eventType) {
  const rowsRes = await db.query('SELECT * FROM tower_room_events WHERE event_type = $1', [eventType]);
  const rows = rowsRes.rows;
  if (!rows.length) return null;
  const totalWeight = rows.reduce((sum, r) => sum + r.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const row of rows) {
    if (roll < row.weight) return row;
    roll -= row.weight;
  }
  return rows[rows.length - 1];
}

function towerFloorLevel(floorNumber) {
  return 29 + floorNumber;
}

// ---------- Torre infinita: escalado post-piso 150 (Fase 4) ----------
function resolveInfiniteFloor(floorNumber) {
  if (floorNumber <= 150) return { queryFloor: floorNumber, lap: 0 };
  const offset = floorNumber - 151;
  const lap = Math.floor(offset / 60) + 1;
  const queryFloor = 91 + (offset % 60);
  return { queryFloor, lap };
}

function infiniteStatMult(lap) {
  return lap > 0 ? 1 + 0.15 * Math.pow(lap, 1.3) : 1;
}

async function getTowerLapBonus(sessionId) {
  const res = await db.query(
    `SELECT current_floor FROM player_tower_runs WHERE current_session_id = $1 AND status = 'IN_PROGRESS'`,
    [sessionId]
  );
  if (!res.rows.length) return 0;
  return resolveInfiniteFloor(res.rows[0].current_floor).lap;
}

async function buildTowerMonsterSpecs(floorRow, participantCount) {
  const level = towerFloorLevel(floorRow.floor_number);

  if (floorRow.is_boss_floor) {
    const specs = [{ code: floorRow.boss_monster_code, level }];
    for (const code of floorRow.escort_monster_codes || []) specs.push({ code, level });
    return specs;
  }

  const eligible = await db.query(
    `SELECT code FROM monsters
     WHERE zone_id = $1 AND rarity IN ('COMMON','RARE')
       AND min_spawn_level <= $2 AND max_spawn_level >= $2`,
    [floorRow.tower_zone_id, level]
  );
  if (!eligible.rows.length) {
    throw Object.assign(new Error(`No hay monstruos configurados para el piso ${floorRow.floor_number}`), { status: 500 });
  }

  const count = participantCount <= 1 ? (Math.random() < 0.5 ? 1 : 2) : Math.floor(Math.random() * 3) + 1;
  const specs = [];
  for (let i = 0; i < count; i += 1) {
    const m = eligible.rows[Math.floor(Math.random() * eligible.rows.length)];
    specs.push({ code: m.code, level });
  }
  return specs;
}

async function buildTowerRoom(run, floorNumber, roomNumber) {
  const { queryFloor, lap } = resolveInfiniteFloor(floorNumber);
  const floorResult = await db.query('SELECT * FROM tower_floors WHERE floor_number = $1', [queryFloor]);
  const floorRow = floorResult.rows[0];
  if (!floorRow) throw Object.assign(new Error(`Piso ${floorNumber} no configurado`), { status: 500 });

  const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
  const [allCombatants, ...npcLists] = await Promise.all([
    hydratePlayers(allPlayerIds),
    ...allPlayerIds.map((id) => hydratePartyNpcs(id, id, 1)),
  ]);
  const aliveCombatants = allCombatants.filter((p) => p.hp > 0);
  const aliveNpcs = npcLists.flat().filter((n) => n.hp > 0);
  if (!aliveCombatants.length && !aliveNpcs.length) {
    throw Object.assign(new Error('Toda la formación está derrotada.'), { status: 400 });
  }

  // Eventos narrativos: el piso de jefe siempre es combate (no tendria sentido reemplazarlo).
  // El resto de las salas tiran la ruleta pesada por el Luck promedio del grupo antes de armar
  // el encuentro; si sale otra cosa que COMBAT, la sala queda como evento pendiente en vez de
  // sesion de combate.
  if (!floorRow.is_boss_floor) {
    const avgLuck = allCombatants.length
      ? allCombatants.reduce((sum, p) => sum + Number(p.luck || 0), 0) / allCombatants.length
      : 0;
    const category = rollRoomCategory(avgLuck);
    if (category !== 'COMBAT') {
      const event = await pickRoomEvent(category);
      if (event) {
        await db.query(
          'UPDATE player_tower_runs SET current_floor=$1, current_room=$2, current_session_id=NULL, pending_event_id=$3 WHERE id=$4',
          [floorNumber, roomNumber, event.id, run.id]
        );
        return null;
      }
      // Sin filas cargadas todavia para esa categoria: cae a combate en vez de trabarse.
    }
  }

  const participantCount = aliveCombatants.length + aliveNpcs.length;
  const monsterSpecs = await buildTowerMonsterSpecs(floorRow, participantCount);
  const enemyCombatants = await hydrateMonsters(monsterSpecs);
  await recordMonsterEncounters(allPlayerIds, enemyCombatants);

  const statMult = (TOWER_DIFFICULTY_STAT_MULT[run.difficulty] || 1) * infiniteStatMult(lap);
  for (const e of enemyCombatants) {
    e.hp = Math.round(e.hp * statMult);
    e.max_hp = e.hp;
    e.atk = Math.round(e.atk * statMult);
    e.def = Math.round(e.def * statMult);
    e.mag = Math.round(e.mag * statMult);
    e.magic_def = Math.round(e.magic_def * statMult);
    e.spd = Math.round(e.spd * statMult);
  }

  if (!floorRow.is_boss_floor) {
    for (const e of enemyCombatants) applyEncounterRarity(e);
  }

  const sessionResult = await createCombatSessionWithClaim(
    (client) => client.query(
      'INSERT INTO combat_sessions(guest_player_id, guest_player_id_2) VALUES($1,$2) RETURNING *',
      [run.guest_player_id, run.guest_player_id_2]
    ),
    allPlayerIds
  );
  const sessionId = sessionResult.rows[0].id;

  for (const abandonedId of run.abandoned_player_ids || []) {
    await db.query(
      `INSERT INTO combat_abandoned_players(session_id, player_id, penalized) VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING`,
      [sessionId, abandonedId]
    );
  }

  await insertParticipants(sessionId, [...aliveCombatants, ...aliveNpcs, ...enemyCombatants]);
  await advanceEnemyTurns(sessionId);

  await db.query(
    'UPDATE player_tower_runs SET current_floor=$1, current_room=$2, current_session_id=$3 WHERE id=$4',
    [floorNumber, roomNumber, sessionId, run.id]
  );

  return sessionId;
}

// Compartido entre el cierre de una sesion de combate ganada y la resolucion de un evento
// narrativo (docs/backend-spec-abismo-eventos-narrativos.md sección 3): sigue a la sala siguiente
// del piso, o banca la moneda y cierra el piso si ya era la ultima sala.
async function advanceTowerRoomOrFloor(run, floorRow) {
  if (run.current_room < floorRow.room_count) {
    await buildTowerRoom(run, run.current_floor, run.current_room + 1);
  } else {
    // Piso completo: banca la moneda de ESTE piso ya mismo (no en /advance), así que si
    // extraés apenas terminás el piso (sin apretar Seguir) igual la cuenta.
    const coinsGained = Math.round(1 * (TOWER_DIFFICULTY_COIN_MULT[run.difficulty] || 1));
    await db.query(
      `UPDATE player_tower_runs SET current_session_id=NULL, coins_earned = coins_earned + $2 WHERE id=$1`,
      [run.id, coinsGained]
    );

    if (floorRow.is_boss_floor) {
      const runPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
      await db.query('UPDATE players SET boss_kills = boss_kills + 1 WHERE id = ANY($1::int[])', [runPlayerIds]);
      for (const pid of runPlayerIds) await incrementCounter(pid, 'JEFES_FINALES_MUERTOS');
    }
  }
}

async function handleTowerSessionEnd(sessionId, status) {
  const runRes = await db.query(
    `SELECT * FROM player_tower_runs WHERE current_session_id = $1 AND status = 'IN_PROGRESS'`,
    [sessionId]
  );
  const run = runRes.rows[0];
  if (!run) return;

  if (status !== 'PLAYER_WON') {
    // Ciudades del Abismo (docs/backend-spec-ciudad-del-abismo.md parte 5): si el grupo ya pasó
    // por al menos un checkpoint, un wipe no termina la corrida — la devuelve al último
    // asentamiento con todos revividos al 100%, en vez de perderla entera. Solo si nunca pasó
    // por ningún checkpoint (last_banked_floor === 0) se comporta como antes.
    if (run.last_banked_floor > 0) {
      const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);

      // Revivir al 100% -- mismo criterio que la enfermera del asentamiento (parte 3): hp/mana
      // de la columna cruda, no el efectivo con bonos de mascota/pasivas, para ser consistentes
      // con como ya cura /tower/settlement/heal.
      await db.query('UPDATE players SET hp = max_hp, mana = max_mana WHERE id = ANY($1::int[])', [allPlayerIds]);
      await db.query(
        `UPDATE player_npcs SET hp = max_hp, mana = max_mana
         WHERE id IN (SELECT npc_id FROM player_party WHERE player_id = ANY($1::int[]))`,
        [allPlayerIds]
      );

      await db.query(
        `UPDATE player_tower_runs
         SET current_floor = last_banked_floor, current_room = 1, coins_earned = 0, current_session_id = NULL
         WHERE id = $1`,
        [run.id]
      );
      return;
    }

    await db.query(
      `UPDATE player_tower_runs SET status='WIPED', current_session_id=NULL, ended_at=now() WHERE id=$1`,
      [run.id]
    );
    return;
  }

  const floorRes = await db.query('SELECT * FROM tower_floors WHERE floor_number = $1', [run.current_floor]);
  const floorRow = floorRes.rows[0];
  await advanceTowerRoomOrFloor(run, floorRow);
}

async function finalizeSession(sessionId, status, participants) {
  // un combate se cierra una sola vez: si ya terminó, no se vuelve a repartir nada. Antes, consultar
  // un combate ya ganado (GET /sessions/:id llama a advanceEnemyTurns, que ve a los enemigos muertos)
  // volvía a dar la experiencia, el oro y el botín en cada consulta.
  const closed = await db.query(
    "UPDATE combat_sessions SET status = $1, updated_at = now() WHERE id = $2 AND status = 'IN_PROGRESS' RETURNING id",
    [status, sessionId]
  );
  if (!closed.rows.length) return null;
  await db.query('DELETE FROM combat_participant_buffs WHERE session_id = $1', [sessionId]);

  // World Boss (500.000 HP) es un ENEMY_WON garantizado para un grupo normal -- eso es a
  // proposito (igual reparte cosmic_shards por el daño hecho, ver handleWorldBossFinalize),
  // no una derrota real del héroe. No debe sumar a combat_losses ni contar como una pelea
  // perdida de verdad.
  const sessRow = await db.query('SELECT world_boss_event_id, mythic_hunt_id FROM combat_sessions WHERE id = $1', [sessionId]);
  // el jefe mítico (lib/mythic.js) tampoco cuenta como derrota: es un intento contra vida compartida
  const isWorldBoss = !!sessRow.rows[0]?.world_boss_event_id || !!sessRow.rows[0]?.mythic_hunt_id;

  let rewards = null;
  if (status === 'PLAYER_WON') {
    rewards = participants.enemy.reduce(
      (acc, m) => ({ gold: acc.gold + (m.gold_reward || 0), xp: acc.xp + (m.xp_reward || 0) }),
      { gold: 0, xp: 0 }
    );
    rewards.levelUps = [];
  }

  const abandonedRes = await db.query(
    'SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]
  );
  const abandonedIds = abandonedRes.rows.map((r) => r.player_id);

  // heroPs[0] es el líder (quien llamó a explore); en solo hay uno.
  // Excluir jugadores que abandonaron el combate: no cobran oro/xp/items.
  const heroPs = participants.player.filter((p) => p.player_id && !abandonedIds.includes(p.player_id));
  const heroP  = heroPs[0] ?? null;
  const npcPs  = participants.player.filter((p) => p.npc_id && !abandonedIds.includes(p.owner_player_id));

  if (heroP) {
    if (rewards) {
      for (const enemy of participants.enemy) {
        await questProgress.registerKill(heroP.player_id, enemy.monster_code);
      }
      // emboscadas de misión (lib/questSteps.js): ganar el combate cumple el objetivo
      for (const hp of heroPs) {
        await questSteps.registerAmbushWin(hp.player_id, participants.enemy.map((e) => e.monster_code));
      }
      await recordMonsterKills(heroPs.map((hp) => hp.player_id), participants.enemy);
      // Colección y jefe mítico (lib/huntRewards.js): bestiario, cuenta de la zona, esbirros y
      // los bonos de utilidad de cada héroe (amuletos + cartas engarzadas)
      const { bestiaryEvents, utilBy } = await huntRewards.beforeRewards(heroPs, participants.enemy, sessionId);
      const leaderUtil = utilBy.get(heroP.player_id);

      const rankResult = await db.query('SELECT rank FROM players WHERE id = $1', [heroP.player_id]);
      const { xpBonusPercent, rewardBonusPercent } = await getRankBonuses(rankResult.rows[0].rank);
      const [combatAchBonuses, heroPetBonuses] = await Promise.all([
        achievements.getPlayerBonuses(heroP.player_id),
        pets.getActivePetBonuses(heroP.player_id),
      ]);

      const heroClassRes = await db.query(
        'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
        [heroP.player_id]
      );
      const heroChain = await getClassAncestorChain(
        heroClassRes.rows[0]?.evolution_class_id || heroClassRes.rows[0]?.current_class_id
      );
      const heroPassives = await getClassPassiveBonuses(heroChain, heroClassRes.rows[0]?.level);

      rewards.gold = applyPercentBonus(applyPercentBonus(applyPercentBonus(applyPercentBonus(rewards.gold, rewardBonusPercent), combatAchBonuses.goldEarned), heroPassives.gold_bonus), heroPetBonuses.gold_percent);
      rewards.xp   = applyPercentBonus(applyPercentBonus(applyPercentBonus(applyPercentBonus(rewards.xp,   xpBonusPercent),     combatAchBonuses.xpEarned),   heroPassives.xp_bonus),   heroPetBonuses.xp_percent);
      const heroLuckRow = await db.query('SELECT luck FROM players WHERE id = $1', [heroP.player_id]);
      const heroLuck = Number(heroLuckRow.rows[0]?.luck || 0);
      const partyClasses = [...new Set(await Promise.all(heroPs.map((h) => baseClassCode(h.class_id))))].filter(Boolean);
      // (los monstruos corrompidos por el eclipse de las Ruinas sueltan más: lib/eclipse.js)
      const dropBonusPct = heroPassives.drop_rate_bonus + heroLuck + heroPetBonuses.drop_rate_percent + leaderUtil.drop + eclipse.botinExtra(participants.enemy);
      rewards.itemsDropped = await rollMonsterDrops(participants.enemy, dropBonusPct, partyClasses);

      // Co-op: oro dividido en partes iguales entre todos los héroes (1 a 3).
      const goldPerHero = Math.floor(rewards.gold / heroPs.length);
      rewards.gold = goldPerHero;

      // Bonus de combate por nivel de gremio: cada héroe usa el nivel de SU PROPIO gremio
      // (0 si no está en ninguno, en cuyo caso el bonus es nulo).
      const heroGuildLevels = await getGuildLevelsForPlayers(heroPs.map((hp) => hp.player_id));

      // COMBATES_LIMITE_SOBREVIVIDOS (ex DIAS_VIVIDOS): solo cuenta si alguien del equipo bajó
      // a <=10% HP en algún momento de ESTA pelea Y la terminaron ganando (nunca si se pierde).
      const sessionRes = await db.query('SELECT had_near_death FROM combat_sessions WHERE id = $1', [sessionId]);
      const hadNearDeath = sessionRes.rows[0]?.had_near_death || false;

      // mazmorras: quien ya venció al jefe hoy cobra la mitad de XP y oro (lib/mazmorra.js rewardMult)
      const dungeonMult = new Map();
      for (const hp of heroPs) dungeonMult.set(hp.player_id, (await mazmorras.rewardMult(sessionId, hp.player_id).catch(() => null)) ?? 1);
      if ((dungeonMult.get(heroP.player_id) ?? 1) < 1) rewards.dungeonRepeat = dungeonMult.get(heroP.player_id);

      for (const hp of heroPs) {
        const heroGoldMult = combatBonusMultipliers(heroGuildLevels.get(hp.player_id)).gold;
        let heroGold = Math.round(goldPerHero * heroGoldMult * (1 + (utilBy.get(hp.player_id)?.gold || 0) / 100) * dungeonMult.get(hp.player_id));
        const victoryInnate = await applyInnateTrigger('ON_VICTORY_REWARD', { actor: hp, target: null, allies: [], enemies: [] });
        if (victoryInnate?.stat_code === 'GOLD') {
          heroGold = Math.round(heroGold * (1 + Number(victoryInnate.percent_amount || 0) / 100));
        }
        await db.query(
          'UPDATE players SET hp = $1, mana = $2, gold = gold + $3, combat_wins = combat_wins + 1, updated_at = now() WHERE id = $4',
          [hp.hp, hp.mana, heroGold, hp.player_id]
        );
        if (hadNearDeath) await incrementCounter(hp.player_id, 'COMBATES_LIMITE_SOBREVIVIDOS');
        // Respiro / Serenidad: recupera un poco de vida y maná al ganar
        await coleccion.applyVictoryRecovery(hp.player_id, utilBy.get(hp.player_id));
      }

      const partySize = heroPs.length + npcPs.length;
      // Bono de grupo: +10% por cada otro JUGADOR del grupo (los compañeros contratados no cuentan),
      // así jugar juntos rinde más y no solo va más rápido. Se reparte entre todos, como antes.
      const groupXpMult = 1 + GROUP_XP_BONUS * Math.max(0, heroPs.length - 1);
      const splitXp = Math.floor((rewards.xp * groupXpMult) / partySize);

      // Nivel promedio de los enemigos de ESTA pelea, para penalizar el XP si el jugador ya los
      // superó de nivel (ver leveling.underLevelXpMult) — sin esto volver a pisos bajos de la
      // Torre ya superados da el mismo XP integro que contenido a tu nivel.
      const avgEnemyLevel = participants.enemy.length
        ? participants.enemy.reduce((sum, e) => sum + (e.level || 0), 0) / participants.enemy.length
        : 0;

      for (const hp of heroPs) {
        const heroXpMult = combatBonusMultipliers(heroGuildLevels.get(hp.player_id)).xp;
        const levelMult = leveling.underLevelXpMult(hp.level, avgEnemyLevel);
        // bendición del Pilar de Aethra (ofrenda en Aurelia): +5% / +10% en el festival
        const blessMult = await aurelia.xpBlessingMult(hp.player_id) * eventos.xpMult(); // + Noche de caza (lib/eventos.js)
        const utilXpMult = 1 + (utilBy.get(hp.player_id)?.xp || 0) / 100;
        const heroXp = Math.round(splitXp * heroXpMult * levelMult * blessMult * utilXpMult * (dungeonMult.get(hp.player_id) ?? 1));
        const levelResult = await leveling.applyXpGain(hp.player_id, heroXp);
        if (levelResult && levelResult.leveledUp) {
          rewards.levelUps.push({
            playerId: hp.player_id, newLevel: levelResult.newLevel,
            teachable: await teachableSkillNames(hp.player_id, hp.level, levelResult.newLevel),
          });
          aurelia.announceLevelUp(hp.player_id, levelResult.newLevel);
        }
        if (hp !== heroP) {
          for (const enemy of participants.enemy) {
            await questProgress.registerKill(hp.player_id, enemy.monster_code);
          }
        }
      }
      for (const npc of npcPs) {
        const levelMult = leveling.underLevelXpMult(npc.level, avgEnemyLevel);
        const npcXp = Math.round(splitXp * levelMult);
        const npcLevelResult = await leveling.applyNpcXpGain(npc.npc_id, npcXp);
        if (npcLevelResult && npcLevelResult.leveledUp) {
          rewards.levelUps.push({ npcId: npc.npc_id, npcName: npc.name, newLevel: npcLevelResult.newLevel });
        }
      }

      for (const drop of rewards.itemsDropped) {
        for (const hp of heroPs) {
          await inventory.addItem(hp.player_id, drop.itemId, drop.quantity);
        }
      }
      // piezas de set de los monstruos raros (lib/piezasSet.js): cada héroe tira por su cuenta; la
      // pieza es de una clase base al azar
      rewards.setPieces = [];
      for (const hp of heroPs) {
        const piece = await piezasSet.rollFor(participants.enemy, dropBonusPct).catch(() => null);
        if (!piece) continue;
        await inventory.addItem(hp.player_id, piece.id, 1);
        rewards.setPieces.push({ playerId: hp.player_id, itemId: piece.id, name: piece.name });
      }

      // cartas de monstruo (tirada propia de cada héroe) y resumen del bestiario
      await huntRewards.afterRewards({ heroPs, heroP, enemies: participants.enemy, utilBy, bestiaryEvents, rewards });

      const monsterCodes = participants.enemy.map((e) => e.monster_code).filter(Boolean);
      if (monsterCodes.length) {
        const zoneRows = await db.query(
          `SELECT DISTINCT zone_id FROM monsters WHERE code = ANY($1::text[]) AND zone_id IS NOT NULL`,
          [monsterCodes]
        );
        for (const { zone_id } of zoneRows.rows) {
          for (const hp of heroPs) {
            await db.query(
              `INSERT INTO player_zone_unlocks(player_id, zone_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
              [hp.player_id, zone_id]
            );
          }
        }
      }

      const guildMemberRes = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [heroP.player_id]);
      if (guildMemberRes.rows.length) {
        const codes = participants.enemy.map((e) => e.monster_code).filter(Boolean);
        if (codes.length) {
          const rarityRes = await db.query(`SELECT code, rarity FROM monsters WHERE code = ANY($1::text[])`, [codes]);
          const rarityByCode = new Map(rarityRes.rows.map((r) => [r.code, r.rarity]));
          const GUILD_XP_BY_RARITY = { COMMON: 5, RARE: 15, MINIBOSS: 50, LEGENDARY: 120 };
          const baseGuildXp = participants.enemy.reduce((sum, e) => sum + (GUILD_XP_BY_RARITY[rarityByCode.get(e.monster_code)] || 0), 0);
          const guildXpGained = Math.round(applyPercentBonus(baseGuildXp, heroPetBonuses.guild_xp_percent));
          if (guildXpGained > 0) await applyGuildXp(guildMemberRes.rows[0].guild_id, guildXpGained);
        }
      }
    } else {
      for (const hp of heroPs) {
        if (status === 'ENEMY_WON' && !isWorldBoss) {
          await db.query(
            'UPDATE players SET hp = $1, mana = $2, combat_losses = combat_losses + 1, updated_at = now() WHERE id = $3',
            [hp.hp, hp.mana, hp.player_id]
          );
        } else {
          await db.query(
            'UPDATE players SET hp = $1, mana = $2, updated_at = now() WHERE id = $3',
            [hp.hp, hp.mana, hp.player_id]
          );
        }
      }
    }
  }

  for (const npc of npcPs) {
    await db.query('UPDATE player_npcs SET hp = $1, mana = $2 WHERE id = $3', [npc.hp, npc.mana, npc.npc_id]);
  }

  // Libera a todos los jugadores humanos de esta sesion (incluidos los que la abandonaron)
  // de player_active_combat_session, para que puedan iniciar otro combate.
  const sessionPlayerIds = participants.player.filter((p) => p.player_id).map((p) => p.player_id);
  if (sessionPlayerIds.length) {
    await db.query('DELETE FROM player_active_combat_session WHERE player_id = ANY($1::int[])', [sessionPlayerIds]);
  }

  await handleTowerSessionEnd(sessionId, status);
  await handleWorldBossFinalize(sessionId, status, participants);
  // jefe mítico: resta la vida compartida (también si huiste) y reparte si cayó
  const mythicSummary = await mythic.handleFinalize(sessionId, participants).catch((err) => { console.error('[mythic] finalize', err.message); return null; });
  if (mythicSummary && rewards) rewards.mythic = mythicSummary;
  // mazmorras (Cripta del Vigía, Mina Profunda): guardianes vencidos, puerta y cofre del jefe
  const cryptSummary = await mazmorras.handleFinalize(sessionId, status, participants, aurelia.addNews).catch((err) => { console.error('[mazmorra] finalize', err.message); return null; });
  if (cryptSummary && rewards) rewards.crypt = cryptSummary;
  // El extra del Evento del Día (oro/monedas/xp fijos del catálogo + bono de nivel bajo + material)
  // se escribe directo a la DB adentro de handleDailyEventFinalize, pero eso NO alcanza al `rewards`
  // que esta función devuelve — y `rewards` es justo lo que el handler manda de vuelta al front
  // (`res.json({ ...state, rewards })`), así que sin este merge el front nunca lo ve en la pantalla
  // de victoria aunque el oro/xp sí haya llegado de verdad a la cuenta del jugador (bug reportado:
  // docs/backend-spec-evento-del-dia-preview-no-coincide.md). dailyEventExtra representa al héroe
  // "líder" (heroes[0], el mismo que ya es la referencia implícita del resto de `rewards`), no la
  // suma de todo el grupo co-op.
  const dailyEventExtra = await handleDailyEventFinalize(sessionId, status, participants);
  if (dailyEventExtra && rewards) {
    rewards.gold += dailyEventExtra.extraGold;
    rewards.xp += dailyEventExtra.extraXp;
    rewards.dungeonCoins = (rewards.dungeonCoins || 0) + dailyEventExtra.extraDungeonCoins;
    if (dailyEventExtra.bonusMaterial) rewards.bonusMaterial = dailyEventExtra.bonusMaterial;
  }

  // logros (lib/logros.js): si peleaste solo, si fue un jefe, si quedaste al filo, y los que se
  // ganaron con esta pelea (los del líder van en la respuesta; los demás los ven en su ventana)
  const logrosPor = await logros.despuesDelCombate({ status, participants, heroPs, isBoss: mazmorras.isBoss })
    .catch((err) => { console.error('[logros] combate', err.message); return new Map(); });
  if (rewards && heroP) rewards.logros = logrosPor.get(heroP.player_id) ?? [];

  return rewards;
}



async function resolveAbandonedPlayerTurn(sessionId, round, actor, participants) {
  const target = combat.pickRandomAliveTarget(participants.enemy);
  if (!target) return;
  const result = combat.resolveAttack(actor, target);
  actor.has_acted_this_round = true;
  await persistParticipant(actor);
  await persistParticipant(target);
  await insertLog(sessionId, round, {
    actorId: actor.id, action: 'ATTACK', targetId: target.id,
    damage: result.damage, evaded: result.evaded, crit: result.crit,
    description: result.evaded
      ? `${actor.name} (IA) ataca a ${target.name}, pero esquiva el golpe.`
      : `${actor.name} (IA) ataca a ${target.name}, infligiéndole ${result.damage} de daño${result.crit ? ' (¡Crítico!)' : ''}.`,
    hp_after: target.hp,
  });
}

// El turno de un aliado del final (lib/aliados.js): ataca al enemigo más herido, para ayudar a terminarlo
async function resolveAllyTurn(sessionId, round, actor, participants) {
  const vivos = participants.enemy.filter((p) => p.hp > 0);
  if (!vivos.length) return;
  const target = vivos.sort((a, b) => a.hp / a.max_hp - b.hp / b.max_hp)[0];
  const result = combat.resolveAttack(actor, target);
  actor.has_acted_this_round = true;
  await persistParticipant(actor);
  await persistParticipant(target);
  await insertLog(sessionId, round, {
    actorId: actor.id, action: 'ATTACK', targetId: target.id,
    damage: result.damage, evaded: result.evaded, crit: result.crit,
    description: result.evaded
      ? `${actor.name} pelea a tu lado: ataca a ${target.name}, pero esquiva el golpe.`
      : `${actor.name} pelea a tu lado: golpea a ${target.name} y le hace ${result.damage} de daño${result.crit ? ' (¡Crítico!)' : ''}.`,
    hp_after: target.hp,
  });
}

// Auto-resuelve turnos de ENEMY y de jugadores abandonados (IA básica), y transiciones de
// ronda hasta que sea turno de un PLAYER activo o termine la pelea. Devuelve { ended, status }.
async function advanceEnemyTurns(sessionId) {
  // un combate que ya terminó no se sigue jugando (p. ej. al consultarlo otra vez después de ganar)
  const cur = await db.query('SELECT status FROM combat_sessions WHERE id = $1', [sessionId]);
  if (cur.rows[0] && cur.rows[0].status !== 'IN_PROGRESS') return { ended: true, status: cur.rows[0].status };
  for (let safety = 0; safety < 200; safety += 1) {
    const participants = await loadParticipants(sessionId);
    await applyLiveInnateModifiers(participants, await getCombatZoneName(participants));

    if (combat.isWiped(participants.player)) {
      // Revivir pasiva de mascota: si un héroe tiene mascota con PASSIVE_REVIVE y no la usó aún
      let revived = false;
      for (const p of participants.player) {
        if (!p.player_id || p.is_summon) continue;
        const reviveRes = await db.query(
          'SELECT pet_revive_used FROM combat_participants WHERE id = $1', [p.id]
        );
        if (reviveRes.rows[0]?.pet_revive_used) continue;
        const petB = await pets.getActivePetBonuses(p.player_id);
        if (!petB.passive_revive) continue;
        p.hp = Math.max(1, Math.round(Number(p.max_hp) * 0.30));
        await db.query(
          'UPDATE combat_participants SET hp = $1, pet_revive_used = TRUE WHERE id = $2',
          [p.hp, p.id]
        );
        revived = true;
        break;
      }
      if (!revived) {
        await finalizeSession(sessionId, 'ENEMY_WON', participants);
        return { ended: true, status: 'ENEMY_WON' };
      }
    }
    if (combat.isWiped(participants.enemy)) {
      await finalizeSession(sessionId, 'PLAYER_WON', participants);
      return { ended: true, status: 'PLAYER_WON' };
    }

    const sessionResult = await db.query('SELECT current_round FROM combat_sessions WHERE id = $1', [sessionId]);
    const round = sessionResult.rows[0].current_round;
    const lastActingSide = await getLastActingSide(sessionId, round);
    const side = combat.determineActingSide(participants.player, participants.enemy, lastActingSide);

    if (side === null) {
      await startNewRound(sessionId, participants);
      continue;
    }
    if (side === 'PLAYER') {
      const actor = combat.nextActor(participants.player);
      if (await paralysisSkip(sessionId, round, actor)) continue;
      if (actor.is_preparing_trap) {
        await resolveTrapActivation(sessionId, round, actor, participants);
        continue;
      }
      // los aliados del final (lib/aliados.js) pelean solos
      if (aliados.esAliado(actor)) {
        await resolveAllyTurn(sessionId, round, actor, participants);
        continue;
      }
      const ownerId = actor.player_id ?? actor.owner_player_id;
      const abandonedRes = await db.query(
        'SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]
      );
      const abandonedIds = abandonedRes.rows.map((r) => r.player_id);
      if (ownerId != null && abandonedIds.includes(ownerId)) {
        await resolveAbandonedPlayerTurn(sessionId, round, actor, participants);
        continue;
      }
      return { ended: false };
    }

    const actor = combat.nextActor(participants.enemy);
    if (await paralysisSkip(sessionId, round, actor)) continue;
    if (actor.is_preparing_trap) {
      await resolveTrapActivation(sessionId, round, actor, participants);
      continue;
    }
    // el Vigía de la cripta: marca a un héroe con su faro y al turno siguiente le dispara
    if (await mazmorras.bossTurn({ sessionId, round, actor, participants, persistParticipant, insertLog, markNearDeathIfLow })) continue;
    // los jefes míticos anuncian su gran golpe a todo el grupo (lib/mythic.js)
    if (await mythic.bossTurn({ sessionId, round, actor, participants, persistParticipant, insertLog, markNearDeathIfLow })) continue;
    if (round === 1) {
      await applyInnateTrigger('ON_COMBAT_START', { actor, target: null, allies: [], enemies: [] });
    }

    // === IA de skills de monstruo ===
    let skillActionDone = false;
    if (actor.monster_code) {
      const monsterSkillsRes = await db.query(
        `SELECT s.*, ms.use_chance_percent
         FROM monster_skills ms
         JOIN skills s ON s.id = ms.skill_id
         WHERE ms.monster_id = (SELECT id FROM monsters WHERE code = $1)`,
        [actor.monster_code]
      );

      const aliveEnemies = participants.enemy.filter((p) => p.hp > 0);
      const deadEnemies = participants.enemy.filter((p) => p.hp <= 0);
      const alivePlayers = participants.player.filter((p) => p.hp > 0);
      const actorHpPct = actor.max_hp > 0 ? (actor.hp / actor.max_hp) * 100 : 0;
      const hasDeadAlly = deadEnemies.some((p) => p.id !== actor.id);
      const numAlivePlayers = alivePlayers.length;
      // Prioridad de skill según contexto táctico (menor = más urgente).
      // La IA prefiere curarse si está crítico, revivir aliados si está bien, debuffear
      // en rondas tempranas, AoE cuando hay múltiples objetivos, y atacar el resto del tiempo.
      // Si ninguna skill pasa su use_chance_percent, se hace ataque básico.
      const skillPriority = (s) => {
        if (s.skill_type === 'CURACION' && actorHpPct < 25) return 0;
        if (s.skill_type === 'ESPECIAL' && hasDeadAlly && actorHpPct > 35) return 1;
        if (s.skill_type === 'DEBUFF' && round <= 3) return 2;
        if (s.target_type === 'ALL_ENEMIES' && numAlivePlayers >= 2) return 3;
        if (s.skill_type === 'BUFF' && round <= 2) return 4;
        if (s.skill_type === 'ATAQUE') return 5;
        return 6;
      };
      let sortedSkills = monsterSkillsRes.rows.slice().sort((a, b) => skillPriority(a) - skillPriority(b));
      // los monstruos de magia lanzan más seguido (lib/combat.js monsterForcedSkill)
      const forcedSkill = combat.monsterForcedSkill(actor, sortedSkills);
      if (forcedSkill) sortedSkills = [forcedSkill, ...sortedSkills.filter((s) => s !== forcedSkill)];

      for (const skill of sortedSkills) {
        if (Number(actor.mana || 0) < Number(skill.mana_cost || 0)) continue;
        if (skill !== forcedSkill && Math.random() * 100 >= Number(skill.use_chance_percent)) continue;

        let specialEffects = [];
        let isReviveSkill = false;
        if (skill.skill_type === 'ESPECIAL') {
          const effRes = await db.query(
            'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
            [skill.id]
          );
          specialEffects = effRes.rows;
          isReviveSkill = specialEffects.some((e) => e.effect_type === 'REVIVE');
        }

        let skillTargets = [];
        if (skill.target_type === 'SELF') {
          skillTargets = [actor];
        } else if (skill.target_type === 'ALLY') {
          if (isReviveSkill) {
            const dead = deadEnemies.filter((p) => p.id !== actor.id);
            if (!dead.length) continue;
            skillTargets = [dead[Math.floor(Math.random() * dead.length)]];
          } else {
            const others = aliveEnemies.filter((p) => p.id !== actor.id);
            if (!others.length) continue;
            skillTargets = [others[Math.floor(Math.random() * others.length)]];
          }
        } else if (skill.target_type === 'ALL_ALLIES') {
          skillTargets = aliveEnemies;
        } else if (skill.target_type === 'ENEMY') {
          if (!alivePlayers.length) continue;
          skillTargets = [pickHeroTarget(alivePlayers)];
        } else if (skill.target_type === 'ALL_ENEMIES') {
          skillTargets = alivePlayers;
        }
        if (!skillTargets.length) continue;

        actor.mana = Math.max(0, (actor.mana || 0) - Number(skill.mana_cost || 0));
        const skillDescParts = [];
        let skillLog = null; // ataques y curaciones: con sus números (ver más abajo)

        if (['BUFF', 'DEBUFF'].includes(skill.skill_type)) {
          const isDebuff = skill.skill_type === 'DEBUFF';
          const buffEffects = await db.query(
            "SELECT effect_type, stat_code, percent_amount, duration_turns FROM skill_effects WHERE skill_id = $1 AND duration_turns IS NOT NULL",
            [skill.id]
          );
          for (const effect of buffEffects.rows) {
            if (effect.effect_type === 'STAT_MOD') {
              for (const t of skillTargets) {
                await applyStatModBuff(sessionId, t, effect, isDebuff, skillDescParts, skill.id, actor);
              }
            } else if (effect.effect_type === 'HOT') {
              const pct = Number(effect.percent_amount || 0);
              const dur = Number(effect.duration_turns);
              for (const t of skillTargets) {
                await db.query(
                  "DELETE FROM combat_participant_buffs WHERE participant_id=$1 AND stat_code='HOT' AND skill_id=$2",
                  [t.id, skill.id]
                );
                await db.query(
                  "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'HOT',$3,$4,FALSE,$5)",
                  [sessionId, t.id, pct, dur, skill.id]
                );
                skillDescParts.push(`${t.name} regeneración: ${pct}% HP/turno (${dur}T)`);
              }
            }
          }
        } else if (skill.skill_type === 'ESTADO_ALTERADO') {
          const altEffects = await db.query(
            'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
            [skill.id]
          );
          for (const effect of altEffects.rows) {
            if (effect.effect_type === 'DOT') {
              const pct = Number(effect.percent_amount || 0);
              const dur = Number(effect.duration_turns);
              const npcDotStatus = dotStatusOf(skill.element_id ? await elements.getElementCodeById(skill.element_id) : null);
              for (const t of skillTargets) {
                if (await immuneToStatus(t, npcDotStatus)) {
                  skillDescParts.push(`${t.name} es inmune a ${STATUS_NAMES[npcDotStatus]}.`);
                  continue;
                }
                await db.query(
                  "DELETE FROM combat_participant_buffs WHERE participant_id=$1 AND stat_code='DOT' AND skill_id=$2",
                  [t.id, skill.id]
                );
                await db.query(
                  "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',$3,$4,TRUE,$5)",
                  [sessionId, t.id, pct, dur, skill.id]
                );
                skillDescParts.push(`${t.name} envenenado: ${pct}% HP/turno (${dur}T)`);
              }
            }
          }
        } else if (skill.skill_type === 'ESPECIAL') {
          for (const effect of specialEffects) {
            if (effect.effect_type === 'REVIVE') {
              const pct = Number(effect.percent_amount || 30);
              for (const t of skillTargets) {
                t.hp = Math.max(1, Math.round(Number(t.max_hp) * pct / 100));
                await persistParticipant(t);
                skillDescParts.push(`${t.name} revivido con ${t.hp} HP`);
              }
            } else if (effect.effect_type === 'CLEANSE') {
              for (const t of skillTargets) {
                const debuffRows = await db.query(
                  'SELECT * FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE',
                  [t.id]
                );
                for (const debuff of debuffRows.rows) {
                  const sc = debuff.stat_code;
                  if (sc !== 'DOT' && sc !== 'NO_DAMAGE' && !sc.startsWith('RESIST_') && !sc.startsWith('IMBUE_')) {
                    applyStatDelta(t, sc, -Number(debuff.applied_flat));
                  }
                }
                await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE', [t.id]);
                await persistParticipant(t);
                skillDescParts.push(`${t.name}: ${debuffRows.rows.length} debuff(s) eliminado(s)`);
              }
            } else if (effect.effect_type === 'STAT_MOD' && effect.duration_turns) {
              for (const t of skillTargets) {
                await applyStatModBuff(sessionId, t, effect, false, skillDescParts, skill.id, actor);
              }
            }
          }
        } else if (['ATAQUE', 'CURACION'].includes(skill.skill_type)) {
          let elemModsByTargetId = {};
          if (skill.element_id) {
            const elemCode = await elements.getElementCodeById(skill.element_id);
            // Bug real: esto siempre llamaba a getMonsterElementalDamageBonus, que con
            // actor.monster_code=null (cualquier jugador o NPC) siempre devuelve 0 — el bono
            // elemental de clase (class_elemental_damage_bonus) nunca se aplicaba al atacar con
            // una skill. Mismo patrón ya correcto que usa el otro branch de skills mas abajo
            // (~línea 2906: getClassElementalDamageBonus + actor.elemental_damage_bonus).
            const damageBonusPercent = actor.monster_code
              ? await elements.getMonsterElementalDamageBonus(actor.monster_code, skill.element_id)
              : (await elements.getClassElementalDamageBonus(actor.class_id, skill.element_id)) + Number(actor.elemental_damage_bonus || 0);
            for (const t of skillTargets) {
              const baseResist = t.monster_code
                ? await elements.getMonsterElementResistance(t.monster_code, skill.element_id)
                : t.player_id
                  ? await elements.getPlayerElementResistance(t.player_id, skill.element_id)
                  : await elements.getClassElementResistance(t.class_id, skill.element_id);
              const tempResist = (elemCode && t.temp_resist?.[elemCode]) || 0;
              elemModsByTargetId[t.id] = { damageBonusPercent, resistancePercent: baseResist + tempResist };
            }
          }
          for (const t of skillTargets) await checkCritImmunity(t);
          const results = combat.resolveSkill(actor, skillTargets, skill, elemModsByTargetId);
          for (const r of results) await consumeCritImmunityIfUsed(r.target, r);
          for (const r of results) await checkOnceForCombatSave(r.target);
          for (const r of results) await persistParticipant(r.target);
          const statusParts = [];
          await applyOnHitStatuses(sessionId, actor, skill, results, statusParts);
          for (const r of results) {
            if (!r.evaded) continue;
            if (r.target.player_id) await incrementCounter(r.target.player_id, 'ATAQUES_ESQUIVADOS');
            const dodgeInnate = await applyInnateTrigger('ON_DODGE', { actor: r.target, target: actor, allies: [], enemies: [] });
            if (dodgeInnate?.extra_json?.guarantee_next_crit) await grantGuaranteedNextCrit(sessionId, r.target.id);
          }
          // misma forma que las habilidades del jugador: el combate 2D (BattleScene.skillHits) reparte
          // los golpes por objetivo y muestra cada número; con un solo objetivo usa damage/crit/evaded
          const heal = skill.skill_type === 'CURACION';
          const summary = results.map((r) => (r.evaded
            ? `${r.target.name} esquiva`
            : heal ? `${r.target.name}, curándole ${r.amount} HP` : `${r.target.name}, haciéndole ${r.amount} de daño${r.crit ? ' (¡Crítico!)' : ''}`)).join('; ');
          const total = results.reduce((sum, r) => sum + (r.evaded ? 0 : r.amount), 0);
          skillLog = {
            targetId: results[0]?.target.id ?? null,
            damage: heal ? null : total,
            heal: heal ? total : null,
            evaded: results.length > 0 && results.every((r) => r.evaded),
            crit: results.some((r) => r.crit),
            description: heal
              ? `${actor.name} usa ${skill.name} y cura a ${summary}.`
              : `${actor.name} usa ${skill.name} sobre ${summary}.${statusParts.length ? ` ${statusParts.join(' ')}` : ''}`,
            hp_after: results[0]?.target.hp ?? null,
          };
        }

        actor.has_acted_this_round = true;
        await persistParticipant(actor);
        await insertLog(sessionId, round, {
          actorId: actor.id,
          action: 'SKILL',
          skillCode: skill.code,
          ...(skillLog ?? {
            targetId: skillTargets[0]?.id || null,
            description: `${actor.name} usa ${skill.name}: ${skillDescParts.join(', ') || 'sin efecto'}.`,
            hp_after: skillTargets[0]?.hp ?? null,
          }),
        });
        skillActionDone = true;
        break;
      }
    }

    if (!skillActionDone && actor.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX)) {
      // World Boss: ignora la fórmula de daño física/mágica normal — golpe en área por % del
      // HP MÁXIMO de cada objetivo, mitigado (con tope) por su DEF. Sección 5 del doc.
      // Una fila de combat_log POR OBJETIVO (no una combinada): useCombatFloaters (front) arma
      // el número flotante/shake leyendo target_participant_id+damage de cada fila individual —
      // con una sola fila combinada, solo el primer objetivo mostraba el golpe.
      const aliveTargets = participants.player.filter((p) => p.hp > 0);
      const basePercent = WORLD_BOSS_HIT_PERCENT_MIN + Math.random() * (WORLD_BOSS_HIT_PERCENT_MAX - WORLD_BOSS_HIT_PERCENT_MIN);
      for (const target of aliveTargets) {
        const mitigation = Math.min(WORLD_BOSS_DEF_MITIGATION_CAP, (target.def || 0) / 3000);
        const finalPercent = basePercent * (1 - mitigation);
        const dmg = Math.max(1, Math.round(Number(target.max_hp) * finalPercent / 100));
        target.hp = Math.max(0, target.hp - dmg);
        await persistParticipant(target);
        await markNearDeathIfLow(target);
        await insertLog(sessionId, round, {
          actorId: actor.id,
          action: 'ATTACK',
          targetId: target.id,
          damage: dmg,
          description: `¡${actor.name} golpea a ${target.name} por ${dmg}!`,
          hp_after: target.hp,
        });
      }
      actor.has_acted_this_round = true;
      await persistParticipant(actor);
      continue;
    }

    if (!skillActionDone) {
    // Ataque básico
    let target = pickHeroTarget(participants.player) ?? combat.pickRandomAliveTarget(participants.player);
    target = await maybeRedirectTarget(target, participants) || target;

    if (target.no_damage_window) {
      actor.has_acted_this_round = true;
      await persistParticipant(actor);
      await insertLog(sessionId, round, {
        actorId: actor.id,
        action: 'ATTACK',
        targetId: target.id,
        damage: 0,
        evaded: true,
        description: `${actor.name} ataca a ${target.name} pero el ataque no tiene efecto (invisible).`,
        hp_after: target.hp,
      });
      continue;
    }

    // Bono elemental propio del monstruo (ej. Dragon de Fuego, ver monsters.element_id) y
    // resistencia del jugador objetivo a ese elemento. Monstruos sin element_id (la mayoria)
    // pegan sin modificador, igual que antes.
    let elementalMods;
    let basicElemName = null;
    if (actor.element_id) {
      const damageBonusPercent = await elements.getMonsterElementalDamageBonus(actor.monster_code, actor.element_id);
      const baseResist = target.player_id
        ? await elements.getPlayerElementResistance(target.player_id, actor.element_id)
        : await elements.getClassElementResistance(target.class_id, actor.element_id);
      const elemCode = await elements.getElementCodeById(actor.element_id);
      const tempResist = (elemCode && target.temp_resist?.[elemCode]) || 0;
      elementalMods = { damageBonusPercent, resistancePercent: baseResist + tempResist };
      basicElemName = ELEMENT_WORD[elemCode] ?? null;
    }

    await checkCritImmunity(target);
    const result = combat.resolveAttack(actor, target, elementalMods);
    actor.has_acted_this_round = true;
    await consumeCritImmunityIfUsed(target, result);
    await checkOnceForCombatSave(target);

    await persistParticipant(actor);
    await persistParticipant(target);
    if (result.evaded) {
      if (target.player_id) await incrementCounter(target.player_id, 'ATAQUES_ESQUIVADOS');
      const dodgeInnate = await applyInnateTrigger('ON_DODGE', { actor: target, target: actor, allies: [], enemies: [] });
      if (dodgeInnate?.extra_json?.guarantee_next_crit) await grantGuaranteedNextCrit(sessionId, target.id);
    } else {
      await resolveOnHitInnates(sessionId, actor, target, result, true, participants.player.filter((p) => p.id !== target.id && p.hp > 0));
      // Mutación Corrupto (docs/backend-spec-abismo-rareza-mutaciones.md): mismo DOT que ya usa
      // el resto del juego (ver Puño Corrupto), 5% HP máx/turno por 2 turnos.
      if (actor.mutation_code === 'CORRUPTO') {
        await db.query(
          "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',5,2,TRUE,NULL)",
          [sessionId, target.id]
        );
      }
    }
    await insertLog(sessionId, round, {
      actorId: actor.id,
      action: 'ATTACK',
      targetId: target.id,
      damage: result.damage,
      evaded: result.evaded,
      crit: result.crit,
      description: result.evaded
        ? `${actor.name} ataca a ${target.name}, pero esquiva el golpe.`
        : result.elementDamage && basicElemName
          ? `${actor.name} ataca a ${target.name}: ${result.damage - result.elementDamage} de daño + ${result.elementDamage} de ${basicElemName}${result.crit ? ' (¡Crítico!)' : ''}.`
          : `${actor.name} ataca a ${target.name}, infligiéndole ${result.damage} de daño${result.crit ? ' (¡Crítico!)' : ''}.`,
      hp_after: target.hp,
    });
    } // end !skillActionDone
  }

  throw new Error('Combate excedió el límite de turnos automáticos');
}

// id -> code de la tabla elements (9 filas fijas): se lee una vez y queda en memoria.
let elementCodesCache = null;
async function getElementCodes() {
  if (!elementCodesCache) {
    const res = await db.query('SELECT id, code FROM elements');
    elementCodesCache = Object.fromEntries(res.rows.map((r) => [r.id, r.code]));
  }
  return elementCodesCache;
}

// código de la clase base (GUERRERO, MAGO...) de una clase cualquiera; se guarda en memoria
const baseClassCache = new Map();
async function baseClassCode(classId) {
  if (!baseClassCache.has(classId)) {
    const chain = await getClassAncestorChain(classId);
    const r = await db.query('SELECT code FROM classes WHERE id = $1', [chain[0] ?? classId]);
    baseClassCache.set(classId, r.rows[0]?.code ?? null);
  }
  return baseClassCache.get(classId);
}

async function fetchSessionState(sessionId) {
  const sessionResult = await db.query('SELECT * FROM combat_sessions WHERE id = $1', [sessionId]);
  if (!sessionResult.rows.length) return null;

  const [participants, abandonedRes] = await Promise.all([
    loadParticipants(sessionId),
    db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]),
  ]);
  const abandonedIds = abandonedRes.rows.map((r) => r.player_id);
  // clase base de cada personaje del grupo (las evoluciones usan el sprite de su clase base):
  // en un combate en grupo cada uno ve al otro con su sprite real, no con el propio
  for (const p of participants.player) {
    if (p.class_id) p.base_class_code = await baseClassCode(p.class_id);
  }

  await ensureSkillCodeColumn();
  const logResult = await db.query(
    `SELECT cl.id, cl.round, cl.action, cl.damage, cl.heal, cl.evaded, cl.crit, cl.success, cl.description,
            cl.hp_after, cl.mana_after, cl.actor_participant_id, cl.target_participant_id, cl.skill_code,
            sk.skill_type, sk.target_type AS skill_target, sk.damage_school AS skill_school, sk.hits AS skill_hits,
            se.code AS skill_element,
            a.name AS actor_name, t.name AS target_name
     FROM combat_log cl
     LEFT JOIN combat_participants a ON a.id = cl.actor_participant_id
     LEFT JOIN combat_participants t ON t.id = cl.target_participant_id
     LEFT JOIN skills sk ON sk.code = cl.skill_code
     LEFT JOIN elements se ON se.id = sk.element_id
     WHERE cl.session_id = $1
     ORDER BY cl.id`,
    [sessionId]
  );

  let nextActor = null;
  if (sessionResult.rows[0].status === 'IN_PROGRESS') {
    const lastActingSide = await getLastActingSide(sessionId, sessionResult.rows[0].current_round);
    const side = combat.determineActingSide(participants.player, participants.enemy, lastActingSide);
    if (side === 'PLAYER') {
      nextActor = combat.nextActor(participants.player);
    }
  }

  // Elemento de cada combatiente y resistencias/debilidades de los monstruos (porcentaje negativo =
  // debilidad), para que el front pueda mostrarlas como el "Break" de Octopath y colorear los golpes.
  const elementCodes = await getElementCodes();
  const monsterCodes = [...new Set(participants.all.map((p) => p.monster_code).filter(Boolean))];
  const resistByMonster = {};
  if (monsterCodes.length) {
    const resRes = await db.query(
      `SELECT m.code AS monster_code, e.code AS element_code, mer.resistance_percent
       FROM monster_element_resistances mer
       JOIN monsters m ON m.id = mer.monster_id
       JOIN elements e ON e.id = mer.element_id
       WHERE m.code = ANY($1::text[]) AND mer.resistance_percent <> 0`,
      [monsterCodes]
    );
    for (const r of resRes.rows) {
      (resistByMonster[r.monster_code] ??= {})[r.element_code] = Number(r.resistance_percent);
    }
  }

  // Estados activos (venenos, mejoras, maldiciones, invisibilidad…) para mostrarlos en combate
  const buffRes = await db.query(
    `SELECT b.participant_id, b.stat_code, b.applied_flat, b.rounds_remaining, b.is_debuff, b.status_code, s.name AS skill_name
     FROM combat_participant_buffs b
     LEFT JOIN skills s ON s.id = b.skill_id
     WHERE b.session_id = $1
     ORDER BY b.id`,
    [sessionId]
  );
  const effectsById = {};
  const shieldRow = {};
  const brokenIds = new Set();
  const weakNow = {};
  for (const b of buffRes.rows) {
    if (b.stat_code === 'SHIELD') { shieldRow[b.participant_id] = Number(b.applied_flat); continue; }
    if (b.stat_code === 'BREAK') { brokenIds.add(b.participant_id); continue; }
    // contadores internos del Vigía (la debilidad se ve en sus resistencias)
    if (b.stat_code === 'WEAK_ELEM') { weakNow[b.participant_id] = Number(b.applied_flat); continue; }
    if (b.stat_code === 'FARO_N' || b.stat_code === 'MYTH_N' || b.stat_code === 'MYTH_CHARGE') continue;
    // el +50% de daño de la rotura ya se ve como "ROTO" en el cliente
    if (b.stat_code === 'DAMAGE_TAKEN' && brokenIds.has(b.participant_id) && Number(b.applied_flat) === BREAK_DAMAGE_BONUS) continue;
    (effectsById[b.participant_id] ??= []).push({
      code: b.stat_code,
      amount: Number(b.applied_flat),
      rounds: b.rounds_remaining,
      debuff: b.is_debuff,
      status: b.status_code ?? null,
      source: b.skill_name ?? null,
    });
  }

  // lo que lleva puesto cada héroe (arma, mano secundaria y armadura): el combate dibuja esa
  // arma y pinta la ropa con el color del set (gpr/src/game/gear.js)
  const heroIds = participants.player.map((p) => p.player_id).filter(Boolean);
  const gearBy = {};
  if (heroIds.length) {
    const gr = await db.query(
      `SELECT pe.player_id, pe.slot, i.code, i.name, i.rarity, i.class_id FROM player_equipment pe JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = ANY($1::int[]) AND pe.slot IN ('WEAPON', 'OFFHAND', 'ARMOR')`,
      [heroIds]
    );
    for (const r of gr.rows) {
      (gearBy[r.player_id] ??= {})[r.slot.toLowerCase()] = { code: r.code, name: r.name, rarity: r.rarity, class_id: r.class_id, slot: r.slot, item_type: 'EQUIPMENT' };
    }
  }

  // rondas que faltan para volver a usar cada habilidad: { participante: { skillId: rondas } }
  const cdRes = await db.query('SELECT participant_id, skill_id, ready_round FROM combat_skill_cooldowns WHERE session_id = $1', [sessionId]);
  const cooldownsById = {};
  for (const c of cdRes.rows) {
    const left = c.ready_round - sessionResult.rows[0].current_round;
    if (left > 0) (cooldownsById[c.participant_id] ??= {})[c.skill_id] = left;
  }
  // afinidades: solo las que ya descubrió alguno de los héroes del combate (las demás se ven como «?»)
  const affHeroIds = [...new Set(participants.all.map((p) => (p.side === 'PLAYER' ? p.player_id : null)).filter(Boolean))];
  const knownAff = await afinidades.knownFor(affHeroIds, monsterCodes).catch(() => new Map());
  const enrichedParticipants = participants.all.map((p) => ({
    ...p,
    cooldowns: cooldownsById[p.id] ?? {},
    is_ai_controlled: abandonedIds.includes(p.player_id ?? p.owner_player_id) || aliados.esAliado(p),
    // World Boss: el nivel real no se expone al jugador (ver hydrateMonsters, mismo criterio).
    level: p.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX) ? null : p.level,
    element_code: elementCodes[p.element_id] ?? null,
    imbued_element_code: elementCodes[p.imbued_element_id] ?? null,
    // el jefe de mazmorra anuncia su debilidad del momento: esa se ve siempre
    resistances: p.monster_code
      ? (weakNow[p.id] != null
        ? { ...afinidades.filter(Object.fromEntries(Object.entries(resistByMonster[p.monster_code] ?? {}).filter(([, v]) => v > 0)), knownAff.get(p.monster_code)).shown, [mazmorras.ELEMENT_CODE[weakNow[p.id]]]: -50 }
        : afinidades.filter(resistByMonster[p.monster_code], knownAff.get(p.monster_code)).shown)
      : undefined,
    affinity_hidden: p.monster_code ? afinidades.filter(resistByMonster[p.monster_code], knownAff.get(p.monster_code)).hidden : undefined,
    effects: effectsById[p.id] ?? [],
    gear: p.player_id ? (gearBy[p.player_id] ?? {}) : undefined,
  }));
  // escudo de Romper de cada monstruo: { current, max, broken }
  for (const p of enrichedParticipants) {
    if (p.side !== 'ENEMY') continue;
    const max = await maxShieldOf(p);
    if (max) p.shield = { current: shieldRow[p.id] ?? max, max, broken: brokenIds.has(p.id) };
  }

  return {
    session: sessionResult.rows[0],
    round: sessionResult.rows[0].current_round,
    participants: enrichedParticipants,
    log: logResult.rows,
    nextActorId: nextActor ? nextActor.id : null,
  };
}

// ---------- Endpoints ----------

// POST /api/combat/sessions
// body: { monsters: [{ code: 'LOBO_PRADERA', level: 9 }] }
// Carga al heroe + todos los NPCs activos del grupo del jugador como participantes PLAYER.
// POST /api/combat/zones/:zoneId/explore — genera encuentro aleatorio al explorar una zona
router.post('/zones/:zoneId/explore', async (req, res, next) => {
  try {
    const zoneResult = await db.query(
      `SELECT id, name, min_level, max_level FROM monster_zones WHERE id = $1`,
      [req.params.zoneId]
    );
    if (!zoneResult.rows.length) {
      return res.status(404).json({ error: 'Zona no encontrada' });
    }
    const zone = zoneResult.rows[0];

    // Maestros de clase (docs/backend-spec-maestros-de-clase.md): si evolucionaste a una clase
    // con maestro pendiente y ya estas en un gremio, la proxima exploracion te encuentra con el
    // en vez de armar el combate normal. Sin gremio el pendiente queda guardado sin bloquear nada.
    const pendingMasterRow = await db.query('SELECT pending_master_id FROM players WHERE id = $1', [req.playerId]);
    const pendingMasterId = pendingMasterRow.rows[0]?.pending_master_id;
    if (pendingMasterId) {
      const guildRes = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [req.playerId]);
      const guildId = guildRes.rows[0]?.guild_id;
      if (guildId) {
        const master = (await db.query('SELECT * FROM class_masters WHERE id = $1', [pendingMasterId])).rows[0];
        return res.status(200).json({ masterEncounter: { masterId: master.id, name: master.name, dialogue: master.intro_dialogue } });
      }
    }

    // ─── Co-op: cargar combatientes de hasta 2 compañeros si vienen coopPartnerIds ───
    // Mundo 2D (worldGroup): los elige el servidor: los de tu grupo que están cerca en el mapa
    // y libres. Si no hay ninguno, el combate es solo tuyo, como siempre.
    const leftOut = [];
    const coopPartnerIds = req.body?.worldGroup === true
      ? await worldGroupPartners(req.playerId, leftOut)
      : Array.isArray(req.body?.coopPartnerIds)
        ? [...new Set(req.body.coopPartnerIds.map(Number))].filter((id) => id !== req.playerId)
        : [];

    const formationResult = await db.query(
      `SELECT p.level AS hero_level,
              COUNT(pn.id) AS npc_count,
              COALESCE(MAX(pn.level), 0) AS max_npc_level
       FROM players p
       LEFT JOIN player_party pp ON pp.player_id = p.id
       LEFT JOIN player_npcs pn ON pn.id = pp.npc_id AND pn.hp > 0
       WHERE p.id = $1
       GROUP BY p.level`,
      [req.playerId]
    );
    const { hero_level, npc_count, max_npc_level } = formationResult.rows[0];
    const formationSize = 1 + parseInt(npc_count, 10);
    const maxFormationLevel = Math.max(parseInt(hero_level, 10), parseInt(max_npc_level, 10));

    // Mundo 2D: el combate empezó en una subzona con su rango de niveles ("3-6", "15"), como en
    // un MMO: los monstruos salen de ese rango, sin importar el nivel de quien pelea. Siempre
    // dentro del rango de la zona. Sin subzona (página de exploración), como antes: hasta tu
    // nivel +1.
    const areaRange = parseLevelRange(req.body?.areaLevels, zone.min_level, zone.max_level);
    const minMonsterLevel = areaRange ? areaRange.min : zone.min_level;
    const maxMonsterLevel = areaRange ? areaRange.max : Math.min(maxFormationLevel + 1, zone.max_level);

    // Si tú o algún compañero de grupo tiene una quest de jefe de esta zona aceptada y
    // todavía no la entregó, ESE jefe aparece garantizado (no depende del roll de rareza).
    // Estar en player_active_quests ya implica "no entregada todavia": completar SIEMPRE
    // borra esa fila (ver DELETE en players.js), tanto para quests de una sola vez como
    // para las DIARIA repetibles (cada vez que se retoma el "X ha vuelto a aparecer" vuelve
    // a estar garantizado hasta entregarla, sin importar cuantas veces se completo antes).
    // Se lee la rareza real del monstruo objetivo (no se asume LEGENDARY): la zona tiene
    // quests de jefe separadas para el MINIBOSS y el LEGENDARY, cada una con su propio
    // monstruo en quest_objectives. Si ambas estan activas a la vez, prioriza LEGENDARY.
    const partyIds = [req.playerId, ...coopPartnerIds];
    const forcedBoss = await db.query(
      `SELECT m.rarity FROM quests q
       JOIN player_active_quests paq ON paq.quest_id = q.id AND paq.player_id = ANY($2::int[])
       JOIN quest_objectives qo ON qo.quest_id = q.id AND qo.objective_type = 'DEFEAT_BOSS'
       JOIN monsters m ON m.id = qo.monster_id
       WHERE q.zone_id = $1 AND q.is_boss_quest = TRUE
       ORDER BY (m.rarity = 'LEGENDARY') DESC
       LIMIT 1`,
      [zone.id, partyIds]
    );

    // Mundo 2D: si chocaste contra un monstruo visible del mapa (leadMonsterCode), ese
    // monstruo encabeza el combate y los aliados salen de su misma rareza (o COMMON).
    // Los jefes del mapa usan su guarida (POST /sessions), así que aquí solo se aceptan
    // monstruos COMMON/RARE de esta zona.
    let lead = null;
    if (typeof req.body?.leadMonsterCode === 'string') {
      const leadRes = await db.query(
        `SELECT code, min_spawn_level, max_spawn_level, rarity
         FROM monsters
         WHERE zone_id = $1 AND code = $2 AND rarity IN ('COMMON', 'RARE')`,
        [zone.id, req.body.leadMonsterCode]
      );
      lead = leadRes.rows[0] || null;
    }

    // Decide rareza del encuentro: LEGENDARY 5%, MINIBOSS 10%, RARE 25%, COMMON 60%
    const roll = Math.random() * 100;
    let targetRarity = lead ? lead.rarity : forcedBoss.rows.length
      ? forcedBoss.rows[0].rarity
      : roll < 5 ? 'LEGENDARY' : roll < 15 ? 'MINIBOSS' : roll < 40 ? 'RARE' : 'COMMON';

    let eligible = await db.query(
      `SELECT code, min_spawn_level, max_spawn_level, rarity
       FROM monsters
       WHERE zone_id = $1 AND rarity = $2
         AND min_spawn_level <= $3 AND max_spawn_level >= $4`,
      [zone.id, targetRarity, maxMonsterLevel, minMonsterLevel]
    );

    // Si no hay de esa rareza, baja a COMMON
    if (!eligible.rows.length) {
      eligible = await db.query(
        `SELECT code, min_spawn_level, max_spawn_level, rarity
         FROM monsters
         WHERE zone_id = $1 AND rarity = 'COMMON'
           AND min_spawn_level <= $2 AND max_spawn_level >= $3`,
        [zone.id, maxMonsterLevel, minMonsterLevel]
      );
    }
    // Subzona más alta que los monstruos comunes de la zona: salen igual, subidos de nivel
    if (!eligible.rows.length && areaRange) {
      eligible = await db.query(
        `SELECT code, min_spawn_level, max_spawn_level, rarity
         FROM monsters WHERE zone_id = $1 AND rarity IN ('COMMON', 'RARE')`,
        [zone.id]
      );
    }

    // Mundo 2D: la zona de encuentro del mapa donde empezó la pelea dice qué monstruos viven ahí
    // (areaMonsters). Los comunes y raros salen de esa lista, así cada monstruo está en su lugar
    // (en el Lago Helado, sierpes y espectros; no las arpías de la Garganta). Los jefes no cambian.
    const areaCodes = Array.isArray(req.body?.areaMonsters)
      ? req.body.areaMonsters.filter((c) => typeof c === 'string').slice(0, 8)
      : [];
    const plainRoll = eligible.rows.length > 0 && eligible.rows.every((r) => r.rarity === 'COMMON' || r.rarity === 'RARE');
    if (areaCodes.length && !forcedBoss.rows.length && plainRoll) {
      const inArea = eligible.rows.filter((r) => areaCodes.includes(r.code));
      if (inArea.length) {
        eligible = { rows: inArea };
      } else {
        const listed = (await db.query(
          `SELECT code, min_spawn_level, max_spawn_level, rarity
           FROM monsters WHERE zone_id = $1 AND code = ANY($2::text[]) AND rarity IN ('COMMON', 'RARE')`,
          [zone.id, areaCodes]
        )).rows;
        const same = listed.filter((r) => r.rarity === eligible.rows[0].rarity);
        const commons = listed.filter((r) => r.rarity === 'COMMON');
        if (same.length || commons.length) eligible = { rows: same.length ? same : commons };
      }
    }

    if (!eligible.rows.length && !lead) {
      return res.status(400).json({ error: 'No hay monstruos disponibles en esta zona para tu nivel' });
    }

    // Cantidad de monstruos según rareza y tamaño de formación. En grupo cuenta el lado completo
    // (jugadores + el compañero que entra), que nunca pasa de COMBAT_SIDE_MAX.
    const actualRarity = lead ? lead.rarity : eligible.rows[0].rarity;
    const sideSize = coopPartnerIds.length ? Math.min(COMBAT_SIDE_MAX, formationSize + coopPartnerIds.length) : formationSize;
    let monsterCount;
    if (actualRarity === 'LEGENDARY' || actualRarity === 'MINIBOSS') {
      monsterCount = 1;
    } else if (actualRarity === 'RARE') {
      monsterCount = sideSize === 1 ? 1 : Math.floor(Math.random() * 2) + 1;
    } else {
      const maxCount = sideSize === 1 ? 2 : 3;
      monsterCount = Math.floor(Math.random() * maxCount) + 1;
    }

    // Elige monstruos aleatorios con nivel dentro del rango válido
    const monsterSpecs = [];
    // nunca más de COMBAT_SIDE_MAX enemigos, pase lo que pase con las reglas de arriba
    monsterCount = Math.min(monsterCount, COMBAT_SIDE_MAX);
    for (let i = 0; i < monsterCount; i++) {
      const pool = eligible.rows.length ? eligible.rows : [lead];
      const m = i === 0 && lead ? lead : pool[Math.floor(Math.random() * pool.length)];
      let lo = Math.max(m.min_spawn_level, minMonsterLevel);
      let hi = Math.max(lo, Math.min(m.max_spawn_level, maxMonsterLevel));
      // en una subzona manda su rango: si el monstruo no llega (o se pasa), se ajusta a él
      if (areaRange && (m.min_spawn_level > maxMonsterLevel || m.max_spawn_level < minMonsterLevel)) {
        lo = minMonsterLevel;
        hi = maxMonsterLevel;
      }
      const level = lo + Math.floor(Math.random() * (hi - lo + 1));
      monsterSpecs.push({ code: m.code, level, extrapolate: !!areaRange });
    }

    for (const pid of [req.playerId, ...coopPartnerIds]) {
      if (await hasAbandonedActiveSession(pid)) {
        return res.status(400).json({
          error: 'Todavía tienes (o tu compañero tiene) un combate anterior en curso que la IA está resolviendo. Esperen a que termine.',
        });
      }
      if (await hasActiveCombatSession(pid)) {
        return res.status(400).json({
          error: 'Todavía tienes (o tu compañero tiene) un combate sin terminar. Termínalo antes de iniciar otro.',
        });
      }
    }

    if (coopPartnerIds.length) {
      const allPlayerIds = [req.playerId, ...coopPartnerIds];
      const groupCheck = await db.query(
        `SELECT gm.group_id
         FROM player_coop_group_members gm
         WHERE gm.player_id = ANY($1::int[])
         GROUP BY gm.group_id
         HAVING COUNT(DISTINCT gm.player_id) = $2`,
        [allPlayerIds, allPlayerIds.length]
      );
      if (!groupCheck.rows.length) {
        return res.status(403).json({ error: 'No estás en el mismo grupo co-op que esos jugadores' });
      }

      // Como mucho COMBAT_SIDE_MAX personajes por lado: primero los jugadores y, en los puestos
      // que sobren, el compañero del primer puesto del líder del grupo; si no tiene (o está
      // caído), el del primer puesto del siguiente miembro.
      const leaderRes = await db.query('SELECT leader_id FROM player_coop_groups WHERE id = $1', [groupCheck.rows[0].group_id]);
      const leaderId = leaderRes.rows[0]?.leader_id;
      const npcOrder = [...allPlayerIds].sort((a, b) => Number(b === leaderId) - Number(a === leaderId));
      const [allCombatants, enemyCombatants, ...npcLists] = await Promise.all([
        hydratePlayers(allPlayerIds),
        hydrateMonsters(monsterSpecs),
        ...npcOrder.map((id) => hydratePartyNpcs(id, id, 1)),
      ]);

      const aliveCombatants = allCombatants.filter((p) => p.hp > 0);
      const freeSlots = Math.max(0, COMBAT_SIDE_MAX - aliveCombatants.length);
      const aliveNpcs = npcLists.flat().filter((n) => n.hp > 0).slice(0, freeSlots);

      if (!aliveCombatants.length && !aliveNpcs.length) {
        return res.status(400).json({ error: 'Toda la formación está derrotada.' });
      }

      const sessionResult = await createCombatSessionWithClaim(
        (client) => client.query(
          'INSERT INTO combat_sessions(guest_player_id, guest_player_id_2) VALUES($1,$2) RETURNING *',
          [coopPartnerIds[0] ?? null, coopPartnerIds[1] ?? null]
        ),
        allPlayerIds
      );
      const sessionId = sessionResult.rows[0].id;
      await mythic.rememberSpot(sessionId, req.body?.worldPos);

      await insertParticipants(sessionId, [...aliveCombatants, ...aliveNpcs, ...enemyCombatants]);
      await recordMonsterEncounters(allPlayerIds, enemyCombatants);
      await advanceEnemyTurns(sessionId);
      const state = await fetchSessionState(sessionId);
      emitCombatUpdate(req, sessionId, state);
      await notifyLeftOut(req, leftOut, sessionId);
      // los compañeros del mundo entran al mismo combate al instante
      if (req.body?.worldGroup === true) {
        const who = await db.query('SELECT nickname FROM players WHERE id = $1', [req.playerId]);
        const io = req.app.get('io');
        for (const pid of coopPartnerIds) {
          io?.to(`player:${pid}`).emit('coop:battle', { sessionId, zoneId: zone.id, leaderId: req.playerId, leaderName: who.rows[0]?.nickname });
        }
      }
      return res.status(201).json({ ...state, coopPartnerIds });
    }

    const [playerCombatants, npcCombatants, enemyCombatants] = await Promise.all([
      hydratePlayers([req.playerId]),
      hydratePartyNpcs(req.playerId, req.playerId),
      hydrateMonsters(monsterSpecs),
    ]);

    const aliveHero = playerCombatants.filter((p) => p.hp > 0);
    const aliveNpcs = npcCombatants.filter((n) => n.hp > 0);

    if (aliveHero.length === 0 && aliveNpcs.length === 0) {
      return res.status(400).json({ error: 'Toda tu formación está derrotada. Ve al gremio a curarte.' });
    }
    // en el mundo 2D (manda su posición) el héroe caído no entra a pelear aunque le queden
    // compañeros: la pantalla de combate es la de tu héroe y el combate quedaba trabado, sin nadie
    // que lo jugara y bloqueando cualquier otro. Primero despierta en tu refugio.
    if (req.body?.worldPos && aliveHero.length === 0) {
      return res.status(400).json({ error: 'Estás sin fuerzas: despierta en tu refugio antes de volver a pelear.' });
    }

    const sessionResult = await createCombatSessionWithClaim(
      (client) => client.query("INSERT INTO combat_sessions DEFAULT VALUES RETURNING *"),
      [req.playerId]
    );
    const sessionId = sessionResult.rows[0].id;
    await mythic.rememberSpot(sessionId, req.body?.worldPos);

    await insertParticipants(sessionId, [...aliveHero, ...aliveNpcs, ...enemyCombatants]);
    await recordMonsterEncounters([req.playerId], enemyCombatants);
    await advanceEnemyTurns(sessionId);

    const state = await fetchSessionState(sessionId);
    emitCombatUpdate(req, sessionId, state);
    await notifyLeftOut(req, leftOut, sessionId);
    res.status(201).json(state);
  } catch (err) {
    if (err.isActiveCombatConflict) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// POST /api/combat/sessions — inicia combate con monstruos específicos (NPC battles, boss manual, etc.)
router.post('/sessions', async (req, res, next) => {
  const { monsters } = req.body;
  const playerIds = [req.playerId];

  if (!Array.isArray(monsters) || monsters.length < 1 || monsters.length > 3) {
    return res.status(400).json({ error: 'monsters debe tener entre 1 y 3 (formato: { code, level })' });
  }
  // el jefe mítico solo se enfrenta por su cacería, y sus esbirros solo existen mientras está suelto
  if (monsters.some((m) => coleccion.isMythic(m?.code))) {
    return res.status(400).json({ error: 'Al jefe mítico solo se lo enfrenta durante su cacería' });
  }
  // los de las mazmorras solo se pelean allá abajo (routes/mazmorra.js)
  const dungeonOf = monsters.map((m) => mazmorras.ofMonster(m?.code)).find(Boolean);
  if (dungeonOf) {
    return res.status(400).json({ error: `Esos guardianes solo se enfrentan en ${dungeonOf.texts.name}` });
  }
  const minionCode = monsters.map((m) => m?.code).find((c) => mythic.MINION_CODES.has(c));
  if (minionCode) {
    // solo los del jefe que está suelto ahora
    const hunt = await mythic.activeHunt();
    const minion = Object.values(mythic.MITICOS).find((d) => d.minion.code === minionCode)?.minion;
    if (!hunt || mythic.minionOf(hunt.zone_id)?.code !== minionCode) {
      return res.status(400).json({ error: `Las ${minion?.plural ?? 'criaturas del jefe mítico'} ya se fueron` });
    }
  }

  try {
    if (await hasAbandonedActiveSession(req.playerId)) {
      return res.status(400).json({ error: 'Todavía tienes un combate anterior en curso que la IA está resolviendo. Espera a que termine.' });
    }
    if (await hasActiveCombatSession(req.playerId)) {
      return res.status(400).json({ error: 'Todavía tienes un combate sin terminar. Termínalo antes de iniciar otro.' });
    }

    // El nivel lo decide el servidor, no el cliente. Nunca baja del piso natural del monstruo: por
    // debajo, hydrateMonsters lo achica (belowFloorRatio) y un nivel 1 peleaba contra un Titán o
    // un Rey de la Montaña de juguete, sin la penalización por diferencia de nivel. Los esbirros
    // del jefe mítico salen a tu nivel, dentro del rango de su zona (como su jefe).
    const playerLevel = Number((await db.query('SELECT level FROM players WHERE id = $1', [req.playerId])).rows[0]?.level) || 1;
    const floors = new Map((await db.query(
      'SELECT code, min_spawn_level FROM monsters WHERE code = ANY($1::text[])',
      [monsters.map((m) => String(m?.code ?? ''))]
    )).rows.map((r) => [r.code, Number(r.min_spawn_level) || 1]));
    const specs = monsters.map((m) => {
      const def = Object.values(mythic.MITICOS).find((d) => d.minion.code === m?.code);
      if (def) return { ...m, level: mythic.cloneLevel(def, playerLevel) };
      return { ...m, level: Math.max(Number(m?.level) || 0, floors.get(m?.code) ?? 1) };
    });

    const [playerCombatants, npcCombatants, enemyCombatants] = await Promise.all([
      hydratePlayers(playerIds),
      hydratePartyNpcs(req.playerId),
      hydrateMonsters(specs),
    ]);

    if (playerCombatants.length !== playerIds.length) {
      return res.status(404).json({ error: 'Algún jugador no fue encontrado' });
    }
    if (enemyCombatants.length !== monsters.length) {
      return res.status(404).json({ error: 'Algún monstruo no fue encontrado' });
    }
    // el eclipse de las Ruinas Ancestrales (lib/eclipse.js): los monstruos de la zona salen corrompidos
    await eclipse.corromper(db, req.playerId, enemyCombatants).catch(() => false);
    const aliveHero = playerCombatants.filter((p) => p.hp > 0);
    // el final (R13): en sus emboscadas pelean a tu lado dos de los que ayudaste en el viaje
    const allies = await aliados.deEmboscada(req.playerId, monsters.map((m) => m.code), playerCombatants[0]).catch(() => []);
    // (la formación tiene 4 lugares: con aliados, de tus compañeros viene solo el primero)
    const aliveNpcs = [...npcCombatants.filter((n) => n.hp > 0).slice(0, allies.length ? 4 - 1 - allies.length : 2), ...allies];

    if (aliveHero.length === 0 && aliveNpcs.length === 0) {
      return res.status(400).json({ error: 'Toda tu formación está derrotada. Ve al gremio a curarte.' });
    }

    const sessionResult = await createCombatSessionWithClaim(
      (client) => client.query("INSERT INTO combat_sessions DEFAULT VALUES RETURNING *"),
      [req.playerId]
    );
    const sessionId = sessionResult.rows[0].id;

    await insertParticipants(sessionId, [...aliveHero, ...aliveNpcs, ...enemyCombatants]);
    await recordMonsterEncounters([req.playerId], enemyCombatants);
    await advanceEnemyTurns(sessionId);

    const state = await fetchSessionState(sessionId);
    emitCombatUpdate(req, sessionId, state);
    res.status(201).json(state);
  } catch (error) {
    if (error.isActiveCombatConflict) return res.status(400).json({ error: error.message });
    next(error);
  }
});

// GET /api/combat/sessions/active — sesión ACTIVE del jugador autenticado, si existe
// POST /api/combat/sessions/:id/leave-fallen — caíste en un combate de grupo que sigue: sales de
// él sin castigo (no es abandonar a tus compañeros: ya no te quedaba nadie en pie). Quedas caído
// para despertar en tu refugio (POST /world/revivir) y no cobras lo que gane el grupo después.
router.post('/sessions/:id/leave-fallen', async (req, res, next) => {
  const sessionId = Number(req.params.id);
  try {
    const sess = await db.query(
      `SELECT cs.status FROM combat_sessions cs
       JOIN combat_participants cp ON cp.session_id = cs.id AND cp.player_id = $2
       WHERE cs.id = $1`,
      [sessionId, req.playerId]
    );
    if (!sess.rows.length) return res.status(404).json({ error: 'No estás en ese combate' });
    if (sess.rows[0].status !== 'IN_PROGRESS') return res.json({ left: false, ended: true });
    const mine = await db.query(
      `SELECT player_id, npc_id, hp, mana FROM combat_participants
       WHERE session_id = $1 AND (player_id = $2 OR owner_player_id = $2)`,
      [sessionId, req.playerId]
    );
    if (mine.rows.some((p) => p.hp > 0)) {
      return res.status(400).json({ error: 'Todavía tienes personajes en pie en este combate' });
    }
    await db.query(
      `INSERT INTO combat_abandoned_players(session_id, player_id, penalized) VALUES ($1, $2, FALSE)
       ON CONFLICT DO NOTHING`,
      [sessionId, req.playerId]
    );
    await db.query('DELETE FROM player_active_combat_session WHERE player_id = $1 AND session_id = $2', [req.playerId, sessionId]);
    // queda caído como si la pelea hubiera terminado para él (el refugio lo levanta)
    for (const p of mine.rows) {
      if (p.player_id) {
        await db.query('UPDATE players SET hp = 0, mana = $1, combat_losses = combat_losses + 1, updated_at = now() WHERE id = $2', [p.mana, p.player_id]);
      } else if (p.npc_id) {
        await db.query('UPDATE player_npcs SET hp = 0, mana = $1 WHERE id = $2', [p.mana, p.npc_id]);
      }
    }
    res.json({ left: true });
  } catch (error) {
    next(error);
  }
});

router.get('/sessions/active', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT cs.id FROM combat_sessions cs
       JOIN combat_participants cp ON cp.session_id = cs.id
       WHERE cs.status = 'IN_PROGRESS' AND cp.player_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM combat_abandoned_players cap
           WHERE cap.session_id = cs.id AND cap.player_id = $1
         )
       ORDER BY cs.id DESC
       LIMIT 1`,
      [req.playerId]
    );
    if (!result.rows.length) return res.json(null);
    await advanceEnemyTurns(result.rows[0].id);
    const state = await fetchSessionState(result.rows[0].id);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

// GET /api/combat/sessions/:id
// ---------------------------------------------------------------- refuerzos
// Mundo 2D: un compañero de grupo empezó un combate y no entraste porque estabas lejos. Si te
// acercas (REINFORCE_PX) y eliges "Unirse a la batalla" en su menú, entras a su combate ya
// empezado. Solo entra tu héroe (no tu compañero NPC) y llega con su turno de esta ronda ya gastado:
// la pelea sigue en el mismo turno en que estaba y tú actúas desde la ronda siguiente. Los que
// ya pelean ven el aviso "¡Tus refuerzos están llegando!" y a tu héroe entrar caminando.
const REINFORCE_SIDE_MAX = 4;
const REINFORCE_PX = 10 * 32; // unas 10 casillas: lo tienes a la vista

// POST /api/combat/reinforce/:targetId — unirse al combate de ese compañero de grupo
router.post('/reinforce/:targetId', async (req, res, next) => {
  try {
    const targetId = Number(req.params.targetId);
    if (!targetId || targetId === req.playerId) return res.status(400).json({ error: 'Elige a un compañero de tu grupo' });
    const sameGroup = await db.query(
      `SELECT 1 FROM player_coop_group_members a
       JOIN player_coop_group_members b ON b.group_id = a.group_id
       WHERE a.player_id = $1 AND b.player_id = $2`,
      [req.playerId, targetId]
    );
    if (!sameGroup.rows.length) return res.status(403).json({ error: 'Solo puedes ayudar a los de tu grupo' });
    if (await hasActiveCombatSession(req.playerId) || await hasAbandonedActiveSession(req.playerId)) {
      return res.status(409).json({ error: 'Termina tu combate antes de unirte a otro' });
    }
    // los dos en el mundo y en la misma zona (lejos sí, pero no en otra parte del continente)
    const me = positionOf(req.playerId);
    const ally = positionOf(targetId);
    if (!me || !ally) return res.status(409).json({ error: 'Tu compañero ya no está en el mundo' });
    if (me.zone !== ally.zone) return res.status(409).json({ error: 'Tu compañero pelea en otra zona' });
    if (Math.hypot(me.x - ally.x, me.y - ally.y) > REINFORCE_PX) {
      const n = await db.query('SELECT nickname FROM players WHERE id = $1', [targetId]);
      return res.status(409).json({ error: `Acércate a ${n.rows[0]?.nickname ?? 'tu compañero'} para unirte a su batalla` });
    }

    const s = await db.query(
      `SELECT cs.* FROM combat_participants cp
       JOIN combat_sessions cs ON cs.id = cp.session_id
       WHERE cp.player_id = $1 AND cs.status = 'IN_PROGRESS'
         AND NOT EXISTS (SELECT 1 FROM combat_abandoned_players cap WHERE cap.session_id = cs.id AND cap.player_id = $1)
       ORDER BY cs.id DESC LIMIT 1`,
      [targetId]
    );
    const session = s.rows[0];
    if (!session) return res.status(404).json({ error: 'Ese combate ya terminó' });
    // eventos con reglas propias: jefe mundial, cacería mítica, evento diario
    if (session.world_boss_event_id || session.mythic_hunt_id || session.daily_event_code) {
      return res.status(409).json({ error: 'A ese combate no se puede entrar a mitad' });
    }
    const sessionId = session.id;
    const parts = await loadParticipants(sessionId);
    if (parts.player.some((p) => p.player_id === req.playerId)) return res.status(409).json({ error: 'Ya estás en ese combate' });
    const sideNow = parts.player.filter((p) => p.hp > 0 && !p.is_summon).length;
    if (sideNow >= REINFORCE_SIDE_MAX) return res.status(409).json({ error: 'Ese combate ya está lleno' });

    const [hero] = await hydratePlayers([req.playerId]);
    if (!hero || hero.hp <= 0) return res.status(400).json({ error: 'Estás sin fuerzas: cúrate antes de pelear' });

    // reclamar el combate (como al empezar uno): si justo empezaste otro, choca y no entra
    try {
      await db.query('INSERT INTO player_active_combat_session(player_id, session_id) VALUES ($1, $2)', [req.playerId, sessionId]);
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Termina tu combate antes de unirte a otro' });
      throw err;
    }
    const [joined] = await insertParticipants(sessionId, [hero]);
    // llega con el turno de esta ronda ya gastado: la pelea sigue donde estaba
    await db.query('UPDATE combat_participants SET has_acted_this_round = TRUE WHERE id = $1', [joined.id]);
    await db.query(
      `UPDATE combat_sessions SET
         guest_player_id = CASE WHEN guest_player_id IS NULL THEN $2 ELSE guest_player_id END,
         guest_player_id_2 = CASE WHEN guest_player_id IS NOT NULL AND guest_player_id_2 IS NULL AND guest_player_id <> $2 THEN $2 ELSE guest_player_id_2 END,
         updated_at = now()
       WHERE id = $1`,
      [sessionId, req.playerId]
    );
    await recordMonsterEncounters([req.playerId], parts.enemy);
    // (si nadie había actuado aún en la ronda, la velocidad del grupo cambió: que resuelva el
    // turno de los monstruos si ahora les toca)
    await advanceEnemyTurns(sessionId);
    const state = await fetchSessionState(sessionId);
    const reinforcement = { playerId: req.playerId, participantId: joined.id, name: hero.name };
    emitCombatUpdate(req, sessionId, { ...state, reinforcement });
    res.status(201).json({ ...state, reinforcement, zoneId: null });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- modo espectador
// Mirar el combate de otro jugador del mundo 2D (amigo o desconocido). Solo se mira: el que
// observa no actúa, no gana nada y la pelea no avanza por él (no se llama a advanceEnemyTurns).
// Recibe las novedades por el socket (combat:join + combat:update) y, por si se pierde alguna,
// pregunta cada pocos segundos con GET /watch/session/:id.

// GET /api/combat/watch/:targetId — el combate abierto en el que pelea ese jugador
router.get('/watch/:targetId', async (req, res, next) => {
  try {
    const targetId = Number(req.params.targetId);
    if (!targetId || targetId === req.playerId) return res.status(400).json({ error: 'Elige a otro jugador' });
    // quien mira no puede estar peleando a la vez
    const mine = await db.query(
      `SELECT 1 FROM combat_participants cp JOIN combat_sessions cs ON cs.id = cp.session_id
       WHERE cp.player_id = $1 AND cs.status = 'IN_PROGRESS'
         AND NOT EXISTS (SELECT 1 FROM combat_abandoned_players cap WHERE cap.session_id = cs.id AND cap.player_id = $1)
       LIMIT 1`,
      [req.playerId]
    );
    if (mine.rows.length) return res.status(409).json({ error: 'Termina tu combate antes de mirar otro' });
    const s = await db.query(
      `SELECT cs.id, p.nickname FROM combat_participants cp
       JOIN combat_sessions cs ON cs.id = cp.session_id
       JOIN players p ON p.id = cp.player_id
       WHERE cp.player_id = $1 AND cs.status = 'IN_PROGRESS'
         AND NOT EXISTS (SELECT 1 FROM combat_abandoned_players cap WHERE cap.session_id = cs.id AND cap.player_id = $1)
       ORDER BY cs.id DESC LIMIT 1`,
      [targetId]
    );
    if (!s.rows.length) return res.status(404).json({ error: 'Ese jugador no está peleando ahora' });
    const state = await fetchSessionState(s.rows[0].id);
    res.json({ ...state, watching: { targetId, name: s.rows[0].nickname } });
  } catch (error) {
    next(error);
  }
});

// GET /api/combat/watch/session/:id — estado de un combate que estás mirando (también cuando
// ya terminó, para saber cómo acabó)
router.get('/watch/session/:id', async (req, res, next) => {
  try {
    const ok = await db.query('SELECT 1 FROM combat_sessions WHERE id = $1', [req.params.id]);
    if (!ok.rows.length) return res.status(404).json({ error: 'Ese combate ya no existe' });
    res.json(await fetchSessionState(req.params.id));
  } catch (error) {
    next(error);
  }
});

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const ownershipRes = await db.query(
      `SELECT 1 FROM combat_participants WHERE session_id = $1 AND player_id = $2 LIMIT 1`,
      [req.params.id, req.playerId]
    );
    if (!ownershipRes.rows.length) return res.status(404).json({ error: 'Sesión de combate no encontrada' });
    await advanceEnemyTurns(req.params.id);
    const state = await fetchSessionState(req.params.id);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

// GET /api/combat/sessions/:id/log — historial de turnos de una sesión
router.get('/sessions/:id/log', async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const sessionRes = await db.query(
      `SELECT cs.id, cs.status FROM combat_sessions cs
       JOIN combat_participants cp ON cp.session_id = cs.id
       WHERE cs.id = $1 AND cp.player_id = $2
       LIMIT 1`,
      [sessionId, req.playerId]
    );
    if (!sessionRes.rows.length) return res.status(404).json({ error: 'Sesión no encontrada o no te pertenece' });

    const logRes = await db.query(
      `SELECT cl.round, cl.action, cl.damage, cl.heal, cl.evaded, cl.crit, cl.success,
              cl.description, cl.created_at,
              actor.name AS actor_name, actor.side AS actor_side,
              target.name AS target_name
       FROM combat_log cl
       LEFT JOIN combat_participants actor ON actor.id = cl.actor_participant_id
       LEFT JOIN combat_participants target ON target.id = cl.target_participant_id
       WHERE cl.session_id = $1
       ORDER BY cl.id ASC`,
      [sessionId]
    );
    res.json({ sessionId: Number(sessionId), status: sessionRes.rows[0].status, log: logRes.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/combat/sessions/:id/action
// body: { participantId, action: 'ATTACK'|'DEFEND'|'ESCAPE'|'USE_ITEM', targetParticipantId?, itemId? }
router.post('/sessions/:id/action', async (req, res, next) => {
  const sessionId = req.params.id;
  const { participantId, action, targetParticipantId, itemId } = req.body;

  if (!['ATTACK', 'DEFEND', 'ESCAPE', 'USE_ITEM', 'SKILL'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser ATTACK, DEFEND, ESCAPE, USE_ITEM o SKILL' });
  }

  try {
    const sessionResult = await db.query('SELECT * FROM combat_sessions WHERE id = $1', [sessionId]);
    if (!sessionResult.rows.length) return res.status(404).json({ error: 'Sesión de combate no encontrada' });
    const session = sessionResult.rows[0];
    if (session.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: `La pelea ya terminó (${session.status})` });
    }

    const participants = await loadParticipants(sessionId);
    await applyLiveInnateModifiers(participants, await getCombatZoneName(participants));
    const lastActingSide = await getLastActingSide(sessionId, session.current_round);
    const side = combat.determineActingSide(participants.player, participants.enemy, lastActingSide);

    if (side !== 'PLAYER') {
      return res.status(400).json({ error: 'No es el turno del jugador' });
    }
    // vida de cada enemigo antes de actuar: para saber a quién le pegó (Romper / Furia)
    const hpBeforeAction = new Map(participants.enemy.map((p) => [p.id, p.hp]));

    const expectedActor = combat.nextActor(participants.player);
    const actor = participants.player.find((p) => p.id === Number(participantId));

    if (!actor || !expectedActor || actor.id !== expectedActor.id) {
      return res.status(400).json({ error: 'No es el turno de ese personaje' });
    }
    const ajeno = (actor.player_id !== null && actor.player_id !== req.playerId)
      || (actor.player_id === null && actor.owner_player_id !== null && actor.owner_player_id !== req.playerId);
    // Co-op en el mundo: si un compañero no responde, otro jugador del combate puede saltar su
    // turno (se defiende solo) cuando ya pasaron IDLE_TURN_MS desde la última acción. Así una
    // pelea en grupo no se traba porque alguien se fue a hacer otra cosa.
    let saltaTurno = false;
    if (ajeno && req.body?.skipIdle === true && action === 'DEFEND') {
      const enSesion = participants.player.some((p) => p.player_id === req.playerId);
      const last = await db.query('SELECT MAX(created_at) AS at FROM combat_log WHERE session_id = $1', [sessionId]);
      const since = new Date(last.rows[0]?.at ?? session.created_at).getTime();
      if (!enSesion) return res.status(403).json({ error: 'No estás en este combate' });
      if (Date.now() - since < IDLE_TURN_MS) {
        return res.status(400).json({ error: 'Dale unos segundos más a tu compañero' });
      }
      saltaTurno = true;
    }
    if (!saltaTurno && actor.player_id !== null && actor.player_id !== req.playerId) {
      return res.status(403).json({ error: 'No puedes actuar por un personaje que no es tuyo' });
    }
    // Co-op: en sesiones con dos jugadores, el NPC pertenece a uno solo.
    if (!saltaTurno && actor.player_id === null && actor.owner_player_id !== null && actor.owner_player_id !== req.playerId) {
      return res.status(403).json({ error: 'Ese NPC pertenece a tu compañero' });
    }

    // Trampa: si este participante está "cargando" la activación, este turno se resuelve solo,
    // sin importar qué acción haya mandado el front (bloqueado, no elige nada este turno).
    if (actor.is_preparing_trap) {
      await resolveTrapActivation(sessionId, session.current_round, actor, participants);
      const refreshed = await loadParticipants(sessionId);
      if (combat.isWiped(refreshed.enemy)) {
        const rewards = await finalizeSession(sessionId, 'PLAYER_WON', refreshed);
        const state = await fetchSessionState(sessionId);
        emitCombatUpdate(req, sessionId, { ...state, rewards });
        return res.json({ ...state, rewards });
      }
      if (combat.isWiped(refreshed.player)) {
        await finalizeSession(sessionId, 'ENEMY_WON', refreshed);
        const state = await fetchSessionState(sessionId);
        emitCombatUpdate(req, sessionId, state);
        return res.json({ ...state, rewards: null });
      }
      await advanceEnemyTurns(sessionId);
      const state = await fetchSessionState(sessionId);
      emitCombatUpdate(req, sessionId, state);
      return res.json(state);
    }

    const actorPetBonuses = actor.player_id === req.playerId
      ? await pets.getActivePetBonuses(req.playerId)
      : null;

    if (session.current_round === 1) {
      const startInnate = await applyInnateTrigger('ON_COMBAT_START', { actor, target: null, allies: [], enemies: [] });
      if (startInnate?.extra_json?.first_attack_unavoidable) {
        await db.query(
          "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'PENDING_UNAVOIDABLE_HIT',0,3,FALSE,NULL)",
          [sessionId, actor.id]
        );
      } else if (startInnate?.extra_json?.effect === 'imbue_random_element_on_basic_attacks') {
        const randomElemCode = ['FIRE', 'ICE', 'LIGHTNING', 'WIND', 'EARTH', 'WATER', 'LIGHT', 'DARK'][Math.floor(Math.random() * 8)];
        const elemId = await elements.getElementIdByCode(randomElemCode);
        if (elemId) {
          actor.imbued_element_id = elemId;
          actor.imbued_damage_bonus = 10;
          await persistParticipant(actor);
        }
      }
    }

    const turnStartInnate = await applyInnateTrigger('ON_TURN_START', { actor, target: null, allies: [], enemies: [] });
    // World Boss anula toda regeneración automática por turno — Favor del Bosque/Coro Celestial
    // son la versión "innata" del mismo mecanismo que hot_hp_percent/HOT (ver startNewRound), así
    // que se gatean igual: el trigger consume su chance normal, solo no cura.
    if (turnStartInnate && !session.world_boss_event_id) {
      const eff = turnStartInnate.extra_json || {};
      if (eff.effect === 'heal_self') {
        const healAmt = Math.max(1, Math.round(Number(actor.max_hp) * Number(turnStartInnate.percent_amount || 0) / 100));
        actor.hp = Math.min(Number(actor.max_hp), actor.hp + healAmt);
        await persistParticipant(actor);
      } else if (eff.effect === 'heal_team_small_while_summon_active') {
        const hasActiveSummon = participants.player.some((p) => p.is_summon && Number(p.summoner_id) === actor.id && p.hp > 0);
        if (hasActiveSummon) {
          for (const ally of participants.player.filter((p) => p.hp > 0 && !p.is_summon)) {
            const healAmt = Math.max(1, Math.round(Number(ally.max_hp) * 0.03));
            ally.hp = Math.min(Number(ally.max_hp), ally.hp + healAmt);
            await persistParticipant(ally);
          }
        }
      }
    }

    let logEntry;
    let usedSkillCode = null; // qué habilidad usó (combat_log.skill_code: el resto del grupo la ve animada)
    actor.grants_extra_action = false; // Filo Constante / Manos Rápidas: no marcar como actuado al final

    if (action === 'ATTACK') {
      const target = targetParticipantId
        ? participants.enemy.find((e) => e.id === Number(targetParticipantId) && e.hp > 0)
        : combat.pickRandomAliveTarget(participants.enemy);
      if (!target) return res.status(400).json({ error: 'Objetivo inválido' });

      if (target.no_damage_window) {
        logEntry = {
          actorId: actor.id, action,
          targetId: target.id,
          damage: 0, evaded: true,
          description: `${actor.name} ataca a ${target.name} pero no tiene efecto (invisible).`,
          hp_after: target.hp, mana_after: actor.mana,
        };
      } else {

      let attackElementalMods;
      let attackImbueElemCode = null;
      if (actor.imbued_element_id) {
        // Clase del actor: para héroe está en players, para NPC en combat_participants.class_id
        let actorClassId = actor.class_id;
        if (!actorClassId && actor.player_id) {
          const pRes = await db.query(
            'SELECT COALESCE(evolution_class_id, current_class_id) AS class_id FROM players WHERE id = $1',
            [actor.player_id]
          );
          actorClassId = pRes.rows[0]?.class_id || null;
        }
        const classElemBonus = actorClassId
          ? await elements.getClassElementalDamageBonus(actorClassId, actor.imbued_element_id)
          : 0;
        const damageBonusPercent = classElemBonus + Number(actor.imbued_damage_bonus || 0);
        const lapBonus = await getTowerLapBonus(sessionId);
        const baseResistance = target.monster_code
          ? await elements.getMonsterElementResistance(target.monster_code, actor.imbued_element_id, lapBonus)
          : target.player_id
            ? await elements.getPlayerElementResistance(target.player_id, actor.imbued_element_id)
            : await elements.getClassElementResistance(target.class_id, actor.imbued_element_id);
        attackImbueElemCode = await elements.getElementCodeById(actor.imbued_element_id);
        const targetTempResist = (attackImbueElemCode && target.temp_resist?.[attackImbueElemCode]) || 0;
        attackElementalMods = { damageBonusPercent, resistancePercent: baseResistance + targetTempResist };
      }

      let attackBonusPercent = 0;
      // El básico de jugador/NPC es siempre físico (ATK contra DEF), también el de Mago y Sacerdote:
      // la magia sale de las habilidades. Sin maná, el básico devuelve BASIC_ATTACK_MANA_PCT.
      const isMagicAttack = false;
      if (actor.player_id === req.playerId) {
        const playerBonuses = await achievements.getPlayerBonuses(req.playerId);
        attackBonusPercent += isMagicAttack ? playerBonuses.magicalDamage : playerBonuses.physicalDamage;
        if (attackImbueElemCode) {
          attackBonusPercent += playerBonuses.elementalDamage;
          attackBonusPercent += playerBonuses.elementDamage[attackImbueElemCode] || 0;
        }
        if (target.monster_code) {
          const catRes = await db.query('SELECT category FROM monsters WHERE code = $1', [target.monster_code]);
          attackBonusPercent += playerBonuses.categoryDamage[catRes.rows[0]?.category] || 0;
        }
        if (actorPetBonuses) {
          attackBonusPercent += isMagicAttack ? actorPetBonuses.magical_damage : actorPetBonuses.physical_damage;
          if (attackImbueElemCode) attackBonusPercent += actorPetBonuses.elemental_damage;
        }
      }
      // Bonuses de pasivas de clase (aplican a cualquier actor PLAYER, incluyendo NPCs)
      if (isMagicAttack) attackBonusPercent += Number(actor.magic_damage_bonus || 0);
      else attackBonusPercent += Number(actor.physical_damage_bonus || 0);
      if (attackImbueElemCode) attackBonusPercent += Number(actor.elemental_damage_bonus || 0);

      const { alreadyFought } = await buildTargetInnateContext(sessionId, target);
      const targetBonus = await getTargetDamageBonus(actor, target, { alreadyFoughtCategoriesThisCombat: alreadyFought });
      attackBonusPercent += targetBonus.damagePercent;
      if (targetBonus.critChancePercent) actor.crit_chance = (actor.crit_chance || 0) + targetBonus.critChancePercent;
      if (targetBonus.ignoreResistance && attackElementalMods) attackElementalMods.resistancePercent = 0;

      const hadGuaranteedCrit = (await consumePendingGuaranteedCrit(actor)) || targetBonus.guaranteedCrit;
      if (hadGuaranteedCrit) actor.crit_chance = 100;
      const hadUnavoidableHit = await consumePendingUnavoidableHit(actor);
      const savedEvasion = target.evasion;
      if (hadUnavoidableHit) target.evasion = 0;
      await checkCritImmunity(target);
      const result = combat.resolveAttack(actor, target, attackElementalMods, attackBonusPercent);
      if (hadUnavoidableHit) target.evasion = savedEvasion;
      // el ataque básico recupera un poco de maná (no hay otra forma de recuperarlo en combate)
      const manaBefore = Number(actor.mana || 0);
      actor.mana = Math.min(Number(actor.max_mana || 0), manaBefore + Math.round(Number(actor.max_mana || 0) * BASIC_ATTACK_MANA_PCT));
      const manaGained = actor.mana - manaBefore;
      if (manaGained > 0) await persistParticipant(actor);
      await consumeCritImmunityIfUsed(target, result);
      await checkOnceForCombatSave(target);
      await persistParticipant(target);
      if (actor.player_id === req.playerId) {
        await questProgress.registerAction(req.playerId, { baseAction: 'ATTACK', killCount: target.hp <= 0 ? 1 : 0 });
        await registerCritCounter(req.playerId, result.crit);
        const actorAllies = participants.player.filter((p) => p.id !== actor.id && p.hp > 0);
        await resolveOnHitInnates(sessionId, actor, target, result, true, actorAllies);
        if (target.hp <= 0) await registerKillCounters(req.playerId, sessionId, [target], null, actor, participants);
      }
      logEntry = {
        actorId: actor.id,
        action,
        targetId: target.id,
        damage: result.damage,
        evaded: result.evaded,
        crit: result.crit,
        description: result.evaded
          ? `${actor.name} ataca a ${target.name}, pero esquiva el golpe.`
          : `${actor.name} ataca a ${target.name}, infligiéndole ${result.damage} de daño${attackElementalMods ? ' elemental' : ''}${result.crit ? ' (¡Crítico!)' : ''}.${manaGained > 0 ? ` Recupera ${manaGained} de maná.` : ''}`,
        hp_after: target.hp, mana_after: actor.mana,
      };
      } // end else (no_damage_window)
    } else if (action === 'SKILL') {
      const { skillId } = req.body;
      if (!skillId) return res.status(400).json({ error: 'skillId es requerido para SKILL' });

      const skillResult = await db.query('SELECT * FROM skills WHERE id = $1', [skillId]);
      if (!skillResult.rows.length) return res.status(404).json({ error: 'Skill no encontrada' });
      const skill = skillResult.rows[0];
      usedSkillCode = skill.code;

      if (skill.is_passive || skill.skill_type === 'PASIVA') {
        return res.status(400).json({ error: 'Esa habilidad es pasiva y siempre está activa.' });
      }
      if (!['ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESTADO_ALTERADO', 'ESPECIAL'].includes(skill.skill_type)) {
        return res.status(400).json({ error: 'Esa habilidad todavía no está disponible en combate.' });
      }

      let actorClassId;

      if (actor.npc_id) {
        // NPCs: skills con class_id = NULL son universales (cualquier NPC puede usarlas si tiene nivel)
        if (skill.class_id !== null && actor.class_id !== skill.class_id) {
          return res.status(400).json({ error: 'Esa habilidad no es de la clase de este NPC' });
        }
        const npcLvlRes = await db.query('SELECT level FROM player_npcs WHERE id = $1', [actor.npc_id]);
        if (!npcLvlRes.rows.length) return res.status(400).json({ error: 'NPC no encontrado' });
        const npcMeetsLevel = npcLvlRes.rows[0].level >= (skill.learn_level || 1);
        if (!npcMeetsLevel) {
          const npcSkillRow = await db.query(
            'SELECT 1 FROM npc_skills WHERE npc_id = $1 AND skill_id = $2',
            [actor.npc_id, skillId]
          );
          if (!npcSkillRow.rows.length) {
            return res.status(400).json({ error: `Este NPC necesita nivel ${skill.learn_level} para usar esa habilidad` });
          }
        }
        actorClassId = actor.class_id;
      } else {
        const playerRowResult = await db.query(
          'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
          [actor.player_id]
        );
        const playerRow = playerRowResult.rows[0];
        // class_id = NULL → skill universal, cualquier clase puede usarla
        if (skill.class_id !== null) {
          const knownClassIds = await getClassAncestorChain(playerRow.evolution_class_id || playerRow.current_class_id);
          if (!knownClassIds.includes(skill.class_id)) {
            return res.status(400).json({ error: 'Esa habilidad no es de tu clase' });
          }
        }
        const unlockedByLevel = skill.learn_method === 'LEVEL' && playerRow.level >= (skill.learn_level || 1);
        if (!unlockedByLevel) {
          const learned = await db.query(
            'SELECT 1 FROM player_skills WHERE player_id = $1 AND skill_id = $2',
            [actor.player_id, skillId]
          );
          if (!learned.rows.length) return res.status(400).json({ error: 'Todavía no aprendiste esa habilidad' });
        }
        actorClassId = playerRow.evolution_class_id || playerRow.current_class_id;
      }

      if (actor.mana < skill.mana_cost) {
        return res.status(400).json({ error: `No te alcanza el maná (necesitas ${skill.mana_cost})` });
      }

      // Tiempo de espera: cooldown_rounds = cada cuántas rondas se puede usar (2 = una ronda sí y
      // otra no). Se guarda por combatiente y habilidad en combat_skill_cooldowns.
      if (skill.cooldown_rounds != null) {
        const cd = await db.query('SELECT ready_round FROM combat_skill_cooldowns WHERE participant_id = $1 AND skill_id = $2', [actor.id, skill.id]);
        const readyRound = cd.rows[0]?.ready_round;
        if (readyRound != null && session.current_round < readyRound) {
          const roundsLeft = readyRound - session.current_round;
          return res.status(400).json({ error: `${skill.name} estará lista en ${roundsLeft} ${roundsLeft === 1 ? 'ronda' : 'rondas'}.` });
        }
        await db.query('DELETE FROM combat_skill_cooldowns WHERE participant_id = $1 AND skill_id = $2', [actor.id, skill.id]);
        await db.query(
          'INSERT INTO combat_skill_cooldowns(session_id, participant_id, skill_id, ready_round) VALUES ($1, $2, $3, $4)',
          [sessionId, actor.id, skill.id, session.current_round + Number(skill.cooldown_rounds)]
        );
      }

      // Efectos de skills ESPECIAL necesarios antes de seleccionar objetivo (REVIVE apunta a muertos)
      let specialEffects = [];
      if (skill.skill_type === 'ESPECIAL') {
        const r = await db.query(
          'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
          [skillId]
        );
        specialEffects = r.rows;
      }
      const isReviveSkill   = specialEffects.some((e) => e.effect_type === 'REVIVE');
      const hasSummonEffect = specialEffects.some((e) => e.effect_type === 'SUMMON');

      // Validación anticipada: no puede haber dos invocados del mismo invocador a la vez
      if (hasSummonEffect) {
        const existingSummon = participants.player.find(
          (p) => p.is_summon && Number(p.summoner_id) === actor.id && p.hp > 0
        );
        if (existingSummon) {
          return res.status(400).json({ error: `${existingSummon.name} ya está activo. Espera a que expire o muera.` });
        }
      }

      let targets;
      if (skill.target_type === 'SELF') {
        targets = [actor];
      } else if (skill.target_type === 'ALLY') {
        if (isReviveSkill) {
          const deadAlly = targetParticipantId
            ? participants.player.find((p) => p.id === Number(targetParticipantId) && p.hp === 0)
            : participants.player.find((p) => p.hp === 0);
          targets = deadAlly ? [deadAlly] : [];
        } else {
          const ally = targetParticipantId
            ? participants.player.find((p) => p.id === Number(targetParticipantId) && p.hp > 0)
            : actor;
          targets = ally ? [ally] : [];
        }
      } else if (skill.target_type === 'ALL_ALLIES') {
        targets = participants.player.filter((p) => p.hp > 0);
      } else if (skill.target_type === 'ALL_ENEMIES') {
        targets = participants.enemy.filter((e) => e.hp > 0);
      } else {
        const enemy = targetParticipantId
          ? participants.enemy.find((e) => e.id === Number(targetParticipantId) && e.hp > 0)
          : combat.pickRandomAliveTarget(participants.enemy);
        targets = enemy ? [enemy] : [];
      }
      if (!targets.length) return res.status(400).json({ error: 'Objetivo inválido' });

      const manaCostReduction = actorPetBonuses ? actorPetBonuses.mana_cost_reduction : 0;
      let effectiveManaCost = Math.max(0, Math.ceil(skill.mana_cost * (1 - manaCostReduction / 100)));
      const spellCastInnate = await applyInnateTrigger('ON_SPELL_CAST', { actor, target: null, allies: [], enemies: [] });
      if (spellCastInnate?.extra_json?.effect === 'no_mana_cost') effectiveManaCost = 0;
      actor.mana -= effectiveManaCost;

      // Bono elemental del atacante (por clase) y resistencia de cada objetivo. Para objetivos
      // NPC (player_id = null) se usa class_id guardado en combat_participants.
      let elementalModsByTargetId = {};
      let skillElemCode = null;
      if (skill.element_id) {
        const damageBonusPercent = (await elements.getClassElementalDamageBonus(actorClassId, skill.element_id))
          + Number(actor.elemental_damage_bonus || 0);
        skillElemCode = await elements.getElementCodeById(skill.element_id);
        const lapBonus = await getTowerLapBonus(sessionId);
        for (const t of targets) {
          const baseResist = t.monster_code
            ? await elements.getMonsterElementResistance(t.monster_code, skill.element_id, lapBonus)
            : t.player_id
              ? await elements.getPlayerElementResistance(t.player_id, skill.element_id)
              : await elements.getClassElementResistance(t.class_id, skill.element_id);
          const tempResist = (skillElemCode && t.temp_resist?.[skillElemCode]) || 0;
          const ignoresThisElement = actor.ignore_resistance_element && actor.ignore_resistance_element === skillElemCode;
          elementalModsByTargetId[t.id] = { damageBonusPercent, resistancePercent: ignoresThisElement ? 0 : baseResist + tempResist };
        }
      }

      // Daño condicional y crítico garantizado para skills ATAQUE
      if (skill.skill_type === 'ATAQUE') {
        const atkSpecialRes = await db.query(
          `SELECT effect_type, stat_code, percent_amount, condition_stat, condition_comparison, condition_value
           FROM skill_effects WHERE skill_id = $1 AND effect_type IN ('CONDITIONAL_DAMAGE', 'GUARANTEED_CRIT')`,
          [skillId]
        );
        for (const effect of atkSpecialRes.rows) {
          for (const t of targets) {
            const mods = elementalModsByTargetId[t.id] || {};
            if (effect.effect_type === 'GUARANTEED_CRIT') {
              mods.guaranteedCrit = true;
            } else if (effect.effect_type === 'CONDITIONAL_DAMAGE') {
              const tStatVal = getParticipantStat(t, effect.condition_stat);
              const condVal = Number(effect.condition_value);
              const op = effect.condition_comparison;
              const met = op === '<' ? tStatVal < condVal
                : op === '>' ? tStatVal > condVal
                : op === '<=' ? tStatVal <= condVal
                : op === '>=' ? tStatVal >= condVal
                : op === '=' ? tStatVal === condVal : false;
              if (met) mods.conditionalBonusPercent = (mods.conditionalBonusPercent || 0) + Number(effect.percent_amount || 0);
            }
            elementalModsByTargetId[t.id] = mods;
          }
        }
      }

      if (['BUFF', 'DEBUFF'].includes(skill.skill_type)) {
        const isDebuff = skill.skill_type === 'DEBUFF';
        const effectsResult = await db.query(
          `SELECT effect_type, stat_code, percent_amount, duration_turns FROM skill_effects
           WHERE skill_id = $1 AND duration_turns IS NOT NULL`,
          [skillId]
        );
        const buffDescParts = [];
        for (const effect of effectsResult.rows) {
          if (effect.effect_type === 'STAT_MOD') {
            for (const target of targets) {
              await applyStatModBuff(sessionId, target, effect, isDebuff, buffDescParts, skillId, actor);
            }
          } else if (effect.effect_type === 'TAUNT') {
            // Provocar: los enemigos atacan a este héroe mientras dure
            for (const target of targets) {
              await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'TAUNT'", [target.id]);
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id,status_code) VALUES($1,$2,'TAUNT',0,$3,FALSE,$4,'TAUNT')",
                [sessionId, target.id, Number(effect.duration_turns), skillId]
              );
              buffDescParts.push(`${target.name} provoca a los enemigos (${effect.duration_turns}T)`);
            }
          } else if (effect.effect_type === 'HOT') {
            let pct = Number(effect.percent_amount || 0);
            if (skill.code === 'SANADOR_LEGENDARIO_MEDITACION' && actor.player_id === req.playerId) {
              const usesSoFar = await getCounter(req.playerId, 'MEDITACIONES_USADAS');
              pct = meditationHealPercent(usesSoFar);
            }
            const dur = Number(effect.duration_turns);
            for (const target of targets) {
              await db.query(
                "DELETE FROM combat_participant_buffs WHERE participant_id=$1 AND stat_code='HOT' AND skill_id=$2",
                [target.id, skillId]
              );
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'HOT',$3,$4,FALSE,$5)",
                [sessionId, target.id, pct, dur, skillId]
              );
              // World Boss anula toda regeneración por turno (ver startNewRound) — el buff se
              // aplica igual (por si el mismo skill trae otro efecto aparte) pero nunca cura acá.
              buffDescParts.push(session.world_boss_event_id
                ? `${target.name}: "¡Ese truco tampoco funcionará!" — El Devorador de Estrellas anula la regeneración`
                : `${target.name} regeneración: ${pct}% HP/turno (${dur}T)`);
            }
            if (skill.code === 'SANADOR_LEGENDARIO_MEDITACION' && actor.player_id === req.playerId) {
              await incrementCounter(req.playerId, 'MEDITACIONES_USADAS');
            }
            const hotInnate = await applyInnateTrigger('ON_HEAL_CAST', { actor, target: targets[0], allies: [], enemies: [] });
            if (hotInnate?.extra_json?.effect === 'cleanse_one_debuff_each_ally' && hotInnate.extra_json?.skill_code === skill.code) {
              for (const ally of targets) {
                const debuffRow = await db.query(
                  'SELECT id, stat_code, applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE LIMIT 1',
                  [ally.id]
                );
                if (debuffRow.rows.length) {
                  const d = debuffRow.rows[0];
                  if (d.stat_code !== 'DOT' && d.stat_code !== 'NO_DAMAGE' && !d.stat_code.startsWith('RESIST_')) {
                    applyStatDelta(ally, d.stat_code, -Number(d.applied_flat));
                    await persistParticipant(ally);
                  }
                  await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [d.id]);
                }
              }
            }
          }
        }
        if (actor.player_id === req.playerId) {
          if (!isDebuff && ['ALLY', 'ALL_ALLIES'].includes(skill.target_type)) {
            await incrementCounter(req.playerId, 'ALIADOS_PROTEGIDOS');
          }
          if (skill.code === 'SACERDOTE_BENDICION') await incrementCounter(req.playerId, 'BENDICIONES_DADAS');
          if (skill.code === 'EXORCISTA_APOYO') await incrementCounter(req.playerId, 'EXORCISMOS_EXITOSOS');
          if (skill.code === 'SANADOR_DIVINO_PREDICCION') await incrementCounter(req.playerId, 'PREDICCIONES_USADAS');
        }
        logEntry = {
          actorId: actor.id, action,
          targetId: targets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${buffDescParts.join(', ') || 'sin efecto'}.`,
        };
      } else if (skill.skill_type === 'ESTADO_ALTERADO') {
        const altEffectsRes = await db.query(
          'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
          [skillId]
        );
        const altDescParts = [];
        const dotInnate = await getInnateForClass(actor.class_id);
        const dotElemCode = skill.element_id ? await elements.getElementCodeById(skill.element_id) : null;
        for (const effect of altEffectsRes.rows) {
          if (effect.effect_type === 'DOT') {
            let pct = Number(effect.percent_amount || 0);
            let dur = Number(effect.duration_turns);
            // Toxina Base / Veneno Persistente: la magnitud/duración vive en extra_json del
            // atacante, no en el skill_effect (aplica a CUALQUIER DOT que el actor inflija).
            if (dotInnate?.trigger_type === 'PASSIVE_STAT') {
              if (dotInnate.extra_json?.dot_damage_bonus_percent) {
                pct *= 1 + Number(dotInnate.extra_json.dot_damage_bonus_percent) / 100;
              }
              if (dotInnate.extra_json?.dot_duration_bonus_turns) {
                dur += Number(dotInnate.extra_json.dot_duration_bonus_turns);
              }
              // Combustión/Fusión de Sombras: "el DOT puede critar" se aproxima como una
              // probabilidad, al momento de aplicarlo, de que pegue más fuerte durante toda
              // su duración (no hay caster_id en combat_participant_buffs para rolear por tick).
              if ((dotInnate.extra_json?.dot_can_crit || []).includes(dotElemCode)
                  && Math.random() * 100 < Number(actor.crit_chance || 0)) {
                pct *= 1 + Number(actor.crit_damage || 50) / 100;
              }
            }
            for (const target of targets) {
              // World Boss es inmune a todo DOT (ver startNewRound) — antes esto igual creaba el
              // buff (inerte, nunca tickeaba) y mostraba "envenenado" como si hubiera funcionado.
              // Ahora ni se crea el buff ni cuenta para ENVENENAMIENTOS/VENENOS_DOMINADOS.
              if (target.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX)) {
                altDescParts.push(`${target.name} es inmune a ${skill.name} (daño por % de HP máximo).`);
                continue;
              }
              if (await immuneToStatus(target, dotStatusOf(dotElemCode))) {
                altDescParts.push(`${target.name} es inmune a ${STATUS_NAMES[dotStatusOf(dotElemCode)]}.`);
                continue;
              }
              await db.query(
                "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'DOT' AND skill_id = $2",
                [target.id, skillId]
              );
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',$3,$4,TRUE,$5)",
                [sessionId, target.id, pct, dur, skillId]
              );
              altDescParts.push(`${target.name} envenenado: ${Math.round(pct)}% HP/turno (${dur}T)`);
              if (actor.player_id === req.playerId && POISON_SKILL_CODES.includes(skill.code)) {
                await incrementCounter(req.playerId, 'ENVENENAMIENTOS');
                await markCounterCodeSeen(req.playerId, 'VENENOS_DOMINADOS', skill.code);
              }
              await applyInnateTrigger('ON_DOT_APPLY', { actor, target, allies: [], enemies: [] });
            }
          } else if (effect.effect_type === 'STAT_MOD' && effect.duration_turns) {
            for (const target of targets) {
              await applyStatModBuff(sessionId, target, effect, true, altDescParts, skillId, actor);
            }
          }
        }
        logEntry = {
          actorId: actor.id, action,
          targetId: targets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${altDescParts.join(', ') || 'sin efecto'}.`,
        };
      } else if (skill.skill_type === 'ESPECIAL') {
        // specialEffects ya fue cargado antes de la selección de objetivo
        const espDescParts = [];

        if (skill.code === 'PICARO_ROBAR') {
          const target = targets[0];
          const leyendaViva = await getSkillModifier(actor.class_id, 'PICARO_ROBAR');
          const retryPenaltyRes = await db.query(
            "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'ROBAR_RETRY_PENALTY' RETURNING applied_flat",
            [actor.id]
          );
          const retryPenalty = retryPenaltyRes.rows[0] ? Number(retryPenaltyRes.rows[0].applied_flat) : 0;
          let chance = 30 + Number(actor.luck || 0) * 0.5 - retryPenalty;
          if (leyendaViva?.extra_json?.success_bonus_percent) chance += Number(leyendaViva.extra_json.success_bonus_percent);
          const success = Math.random() * 100 < chance;
          const ownerId = actor.player_id || req.playerId;
          if (!success) {
            espDescParts.push(`${actor.name} intenta robarle a ${target.name}, pero falla.`);
          } else {
            const monsterRes = target.monster_code
              ? await db.query('SELECT id FROM monsters WHERE code = $1', [target.monster_code])
              : { rows: [] };
            const ojoDeTesoros = await getSkillModifier(actor.class_id, 'PICARO_ROBAR');
            const preferRare = ojoDeTesoros?.extra_json?.effect === 'rare_drop_chance_bonus';
            const dropsRes = monsterRes.rows.length
              ? await db.query(
                  preferRare
                    ? `SELECT md.item_id, md.min_quantity, md.max_quantity FROM monster_drops md JOIN items i ON i.id = md.item_id
                       WHERE md.monster_id = $1 ORDER BY
                       CASE i.rarity WHEN 'LEGENDARIO' THEN 5 WHEN 'EPICO' THEN 4 WHEN 'RARO' THEN 3 WHEN 'POCO_COMUN' THEN 2 ELSE 1 END DESC
                       LIMIT 1`
                    : 'SELECT item_id, min_quantity, max_quantity FROM monster_drops WHERE monster_id = $1',
                  [monsterRes.rows[0].id]
                )
              : { rows: [] };
            if (!dropsRes.rows.length) {
              espDescParts.push(`${actor.name} le roba a ${target.name}, pero no tenía nada que robar.`);
            } else {
              const drop = preferRare ? dropsRes.rows[0] : dropsRes.rows[Math.floor(Math.random() * dropsRes.rows.length)];
              const qty = drop.min_quantity + Math.floor(Math.random() * (drop.max_quantity - drop.min_quantity + 1));
              await inventory.addItem(ownerId, drop.item_id, qty);
              if (actor.player_id === req.playerId) await incrementCounter(req.playerId, 'ITEMS_ROBADOS');
              espDescParts.push(`¡${actor.name} le roba ${qty}x un objeto a ${target.name}!`);
            }
          }
          const manosRapidas = await getSkillModifier(actor.class_id, 'PICARO_ROBAR');
          if (manosRapidas?.extra_json?.effect === 'extra_action_reduced_chance') {
            actor.grants_extra_action = true;
            await db.query(
              "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'ROBAR_RETRY_PENALTY',$3,1,TRUE,NULL)",
              [sessionId, actor.id, Number(manosRapidas.extra_json.penalty_percent || 0)]
            );
          }
        } else if (skill.code === 'ESPECIALISTA_TRAMPAS_TRAMPA') {
          const terrenoPreparado = await getSkillModifier(actor.class_id, 'ESPECIALISTA_TRAMPAS_TRAMPA');
          if (terrenoPreparado?.extra_json?.effect === 'instant_activation_same_turn') {
            actor.is_preparing_trap = false;
            actor.trap_rounds_remaining = 0;
            await db.query(
              'UPDATE combat_participants SET is_preparing_trap = FALSE, trap_rounds_remaining = 0 WHERE id = $1',
              [actor.id]
            );
            await resolveTrapActivation(sessionId, session.current_round, actor, participants);
            espDescParts.push(`${actor.name} activa la trampa al instante.`);
          } else {
            actor.is_preparing_trap = true;
            actor.trap_rounds_remaining = 1;
            await db.query(
              'UPDATE combat_participants SET is_preparing_trap = TRUE, trap_rounds_remaining = 1 WHERE id = $1',
              [actor.id]
            );
            espDescParts.push(`${actor.name} está preparando una trampa...`);
          }
        } else if (skill.code === 'ESPECIALISTA_TRAMPAS_DESACTIVAR') {
          const target = targets[0];
          if (!target.is_preparing_trap) {
            espDescParts.push(`${target.name} no tiene ninguna trampa que desactivar.`);
          } else {
            const detectorNato = await getSkillModifier(actor.class_id, 'ESPECIALISTA_TRAMPAS_DESACTIVAR');
            const chance = detectorNato?.extra_json?.success_rate_percent ?? (50 + Number(actor.luck || 0) * 0.5);
            const success = Math.random() * 100 < chance;
            if (!success) {
              espDescParts.push(`${actor.name} intenta desactivar la trampa de ${target.name}, pero falla.`);
            } else {
              target.is_preparing_trap = false;
              target.trap_rounds_remaining = 0;
              await db.query(
                'UPDATE combat_participants SET is_preparing_trap = FALSE, trap_rounds_remaining = 0 WHERE id = $1',
                [target.id]
              );
              espDescParts.push(`¡${actor.name} desactivó la trampa de ${target.name}!`);
              if (actor.player_id === req.playerId) await incrementCounter(req.playerId, 'TRAMPAS_DETECTADAS');
            }
          }
        }

        for (const effect of specialEffects) {
          if (effect.effect_type === 'REVIVE') {
            const pct = Number(effect.percent_amount || 30);
            for (const target of targets) {
              target.hp = Math.max(1, Math.round(Number(target.max_hp) * pct / 100));
              await persistParticipant(target);
              espDescParts.push(`${target.name} revivido con ${target.hp} HP`);
              if (actor.player_id === req.playerId) await incrementCounter(req.playerId, 'ALIADOS_SALVADOS');
              const reviveInnate = await applyInnateTrigger('ON_REVIVE_CAST', { actor, target, allies: [], enemies: [] });
              if (reviveInnate?.extra_json?.effect === 'heal_team_small_on_revive') {
                for (const ally of participants.player.filter((p) => p.hp > 0 && p.id !== target.id)) {
                  const healAmt = Math.max(1, Math.round(Number(ally.max_hp) * 0.05));
                  ally.hp = Math.min(Number(ally.max_hp), ally.hp + healAmt);
                  await persistParticipant(ally);
                }
              }
            }
          } else if (effect.effect_type === 'CLEANSE') {
            for (const target of targets) {
              const debuffRows = await db.query(
                'SELECT * FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE',
                [target.id]
              );
              for (const debuff of debuffRows.rows) {
                const sc = debuff.stat_code;
                if (sc !== 'DOT' && sc !== 'NO_DAMAGE' && !sc.startsWith('RESIST_') && !sc.startsWith('IMBUE_')) {
                  applyStatDelta(target, sc, -Number(debuff.applied_flat));
                }
              }
              await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE', [target.id]);
              await persistParticipant(target);
              espDescParts.push(`${target.name}: ${debuffRows.rows.length} debuff(s) eliminado(s)`);
            }
          } else if (effect.effect_type === 'NO_DAMAGE_WINDOW') {
            const invisInnate = await getInnateForClass(actor.class_id);
            const dur = Number(effect.duration_turns || 1) + Number(invisInnate?.extra_json?.invisibility_duration_bonus_turns || 0);
            for (const target of targets) {
              await db.query(
                "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'NO_DAMAGE' AND skill_id = $2",
                [target.id, skillId]
              );
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'NO_DAMAGE',0,$3,FALSE,$4)",
                [sessionId, target.id, dur, skillId]
              );
              target.no_damage_window = true;
              espDescParts.push(`${target.name} invisible por ${dur} turno(s)`);
            }
          } else if (effect.effect_type === 'STAT_MOD' && effect.duration_turns) {
            for (const target of targets) {
              await applyStatModBuff(sessionId, target, effect, false, espDescParts, skillId, actor);
            }
          } else if (effect.effect_type === 'SUMMON') {
            const { summon, auraStrength } = await createSummonParticipant(sessionId, actor, effect, skill, participants);
            const elemCode = skill.element_id ? await elements.getElementCodeById(skill.element_id) : null;
            espDescParts.push(`¡${summon.name} invocado! Atacará ${effect.duration_turns} rondas. Equipo +${auraStrength}% resist ${elemCode || ''}.`);
            if (actor.player_id === req.playerId) await incrementCounter(req.playerId, 'INVOCACIONES_REALIZADAS');
          }
        }
        logEntry = {
          actorId: actor.id, action,
          targetId: targets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${espDescParts.join(', ') || 'sin efecto'}.`,
          mana_after: actor.mana,
        };
      } else {
        let categoryBonusByTargetId = {};
        if (skill.skill_type === 'ATAQUE') {
          // Bonus de clase pasiva: físico aplica a cualquier actor; mágico ya está en resolveSkillHit
          let baseSkillBonus = 0;
          if (skill.damage_school === 'FISICO') baseSkillBonus += Number(actor.physical_damage_bonus || 0);

          if (actor.player_id === req.playerId) {
            const playerBonuses = await achievements.getPlayerBonuses(req.playerId);
            if (skill.damage_school === 'FISICO') baseSkillBonus += playerBonuses.physicalDamage;
            else if (skill.damage_school === 'MAGICO') baseSkillBonus += playerBonuses.magicalDamage;
            if (skillElemCode) {
              baseSkillBonus += playerBonuses.elementalDamage;
              baseSkillBonus += playerBonuses.elementDamage[skillElemCode] || 0;
            }
            if (actorPetBonuses) {
              if (skill.damage_school === 'FISICO') baseSkillBonus += actorPetBonuses.physical_damage;
              else if (skill.damage_school === 'MAGICO') baseSkillBonus += actorPetBonuses.magical_damage;
              if (skillElemCode) baseSkillBonus += actorPetBonuses.elemental_damage;
            }
            for (const t of targets) {
              let targetBonus = baseSkillBonus;
              if (t.monster_code) {
                const catRes = await db.query('SELECT category FROM monsters WHERE code = $1', [t.monster_code]);
                targetBonus += playerBonuses.categoryDamage[catRes.rows[0]?.category] || 0;
              }
              const { alreadyFought: fought2 } = await buildTargetInnateContext(sessionId, t);
              const innateBonus = await getTargetDamageBonus(actor, t, { alreadyFoughtCategoriesThisCombat: fought2 });
              targetBonus += innateBonus.damagePercent;
              if (innateBonus.critChancePercent) actor.crit_chance = (actor.crit_chance || 0) + innateBonus.critChancePercent;
              if (innateBonus.guaranteedCrit) elementalModsByTargetId[t.id] = { ...(elementalModsByTargetId[t.id] || {}), guaranteedCrit: true };
              if (innateBonus.ignoreResistance) elementalModsByTargetId[t.id] = { ...(elementalModsByTargetId[t.id] || {}), resistancePercent: 0 };
              if (innateBonus.ignoreMagicDef) elementalModsByTargetId[t.id] = { ...(elementalModsByTargetId[t.id] || {}), ignoreMagicDef: true };
              if (targetBonus) categoryBonusByTargetId[t.id] = targetBonus;
            }
          } else if (baseSkillBonus > 0) {
            for (const t of targets) categoryBonusByTargetId[t.id] = baseSkillBonus;
          }
        }

        const results = combat.resolveSkill(actor, targets, skill, elementalModsByTargetId, categoryBonusByTargetId);

        // Bonus de curación de clase pasiva (HEAL_BONUS % sobre el total curado)
        if (skill.skill_type === 'CURACION' && Number(actor.heal_bonus || 0) > 0) {
          for (const r of results) {
            const extra = Math.round(r.amount * Number(actor.heal_bonus) / 100);
            if (extra > 0) {
              r.amount += extra;
              r.target.hp = Math.min(Number(r.target.max_hp), r.target.hp + extra);
            }
          }
        }

        for (const r of results) await persistParticipant(r.target);
        const statusParts = [];
        await applyOnHitStatuses(sessionId, actor, skill, results, statusParts);
        if (actor.player_id === req.playerId) {
          const deadTargets = results.filter((r) => r.target.hp <= 0).map((r) => r.target);
          await questProgress.registerAction(req.playerId, {
            skillId: skill.id,
            damageSchool: skill.damage_school,
            isElemental: !!skill.element_id,
            killCount: deadTargets.length,
          });

          if (results.some((r) => r.crit)) await registerCritCounter(req.playerId, true);
          const actorAllies = participants.player.filter((p) => p.id !== actor.id && p.hp > 0);
          for (const r of results) {
            await resolveOnHitInnates(sessionId, actor, r.target, r, false, actorAllies);
          }
          if (skill.skill_type === 'ATAQUE') {
            const spellInnate = await applyInnateTrigger('ON_SPELL_DAMAGE', { actor, target: results[0]?.target, allies: actorAllies, enemies: [] });
            if (spellInnate) {
              const eff = spellInnate.extra_json || {};
              if (eff.effect === 'heal_lowest_hp_ally_percent_of_damage') {
                const totalDmg = results.reduce((s, r) => s + r.amount, 0);
                const pool = [actor, ...actorAllies];
                const lowest = pool.reduce((min, a) => (a.hp / a.max_hp < min.hp / min.max_hp ? a : min), pool[0]);
                const healAmt = Math.max(1, Math.round(totalDmg * Number(spellInnate.percent_amount || 0) / 100));
                lowest.hp = Math.min(Number(lowest.max_hp), lowest.hp + healAmt);
                await persistParticipant(lowest);
              } else if (eff.debuff_target_1_turn && results[0]?.target) {
                await db.query(
                  "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'SPD',$3,1,TRUE,NULL)",
                  [sessionId, results[0].target.id, -10]
                );
              } else if (eff.effect === 'apply_resist_debuff_of_that_element' && skill.element_id && results[0]?.target) {
                const elemCode = await elements.getElementCodeById(skill.element_id);
                if (elemCode) {
                  await db.query(
                    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,2,TRUE,NULL)",
                    [sessionId, results[0].target.id, `RESIST_${elemCode}`, -10]
                  );
                }
              }
            }
          }
          if (skill.target_type === 'ALL_ENEMIES') {
            const aoeInnate = await applyInnateTrigger('ON_AOE_HIT', { actor, target: results[0]?.target, allies: actorAllies, enemies: [] });
            if (aoeInnate) {
              const eff = aoeInnate.extra_json || {};
              if (eff.debuff_all_targets_1_turn) {
                for (const r of results.filter((x) => x.target.hp > 0)) {
                  await db.query(
                    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'SPD',$3,1,TRUE,NULL)",
                    [sessionId, r.target.id, -15]
                  );
                }
              } else if (eff.effect === 'stun_1_turn') {
                for (const r of results.filter((x) => x.target.hp > 0)) {
                  r.target.has_acted_this_round = true;
                  await persistParticipant(r.target);
                }
              }
            }
          }
          if (deadTargets.length) {
            await registerKillCounters(req.playerId, sessionId, deadTargets, skill, actor, participants);
            const invisRes = await db.query(
              `SELECT 1 FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'NO_DAMAGE'`,
              [actor.id]
            );
            if (invisRes.rows.length) await incrementCounter(req.playerId, 'KILLS_EN_INVISIBILIDAD', deadTargets.length);
          }
          if (skill.skill_type === 'CURACION') {
            await incrementCounter(req.playerId, 'CUROS_REALIZADOS');
            await incrementCounter(req.playerId, '_CURA_ATAQUE_CURAS');
            const healAllies = participants.player.filter((p) => p.id !== actor.id && p.hp > 0);
            const healInnate = await applyInnateTrigger('ON_HEAL_CAST', { actor, target: results[0]?.target, allies: healAllies, enemies: [] });
            if (healInnate) {
              const eff = healInnate.extra_json || {};
              const mainTarget = results[0]?.target;
              if (eff.effect === 'double_heal' && mainTarget) {
                const extra = results.reduce((s, r) => s + r.amount, 0) / results.length || 0;
                mainTarget.hp = Math.min(Number(mainTarget.max_hp), mainTarget.hp + Math.round(extra));
                await persistParticipant(mainTarget);
              } else if (eff.effect === 'grant_small_shield_to_healed_target' && mainTarget) {
                await grantSmallShield(sessionId, mainTarget.id);
              } else if (eff.effect === 'heal_adjacent_lowest_hp_ally_small' && healAllies.length) {
                const lowest = healAllies.reduce((min, a) => (a.hp / a.max_hp < min.hp / min.max_hp ? a : min), healAllies[0]);
                const healAmt = Math.max(1, Math.round(Number(lowest.max_hp) * 0.05));
                lowest.hp = Math.min(Number(lowest.max_hp), lowest.hp + healAmt);
                await persistParticipant(lowest);
              } else if (eff.effect === 'restore_mana_on_heal') {
                actor.mana = Math.min(Number(actor.max_mana), actor.mana + Math.round(Number(actor.max_mana) * 0.1));
                await persistParticipant(actor);
              } else if (eff.effect === 'cleanse_one_debuff_each_ally' && healInnate.extra_json?.skill_code === skill.code) {
                for (const ally of [actor, ...healAllies]) {
                  const debuffRow = await db.query(
                    'SELECT id, stat_code, applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE LIMIT 1',
                    [ally.id]
                  );
                  if (debuffRow.rows.length) {
                    const d = debuffRow.rows[0];
                    if (d.stat_code !== 'DOT' && d.stat_code !== 'NO_DAMAGE' && !d.stat_code.startsWith('RESIST_')) {
                      applyStatDelta(ally, d.stat_code, -Number(d.applied_flat));
                      await persistParticipant(ally);
                    }
                    await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [d.id]);
                  }
                }
              } else if (eff.effect === 'heal_also_damages_enemies_small') {
                for (const enemy of participants.enemy.filter((e) => e.hp > 0)) {
                  const dmg = Math.max(1, Math.round(Number(enemy.max_hp) * 0.03));
                  enemy.hp = Math.max(0, enemy.hp - dmg);
                  await persistParticipant(enemy);
                }
              }
            }
          } else if (skill.skill_type === 'ATAQUE') {
            await incrementCounter(req.playerId, '_CURA_ATAQUE_ATAQUES');
          }
        }

        const summary = results
          .map((r) => (r.evaded
            ? `${r.target.name} esquiva`
            : skill.skill_type === 'CURACION'
              ? `${r.target.name}, curándole ${r.amount} HP`
              : `${r.target.name}, haciéndole ${r.amount} de daño${r.crit ? ' (¡Crítico!)' : ''}`))
          .join('; ');

        const totalAmount = results.reduce((sum, r) => sum + r.amount, 0);
        logEntry = {
          actorId: actor.id,
          action,
          targetId: results[0].target.id,
          damage: skill.skill_type === 'CURACION' ? null : totalAmount,
          heal: skill.skill_type === 'CURACION' ? totalAmount : null,
          evaded: results.every((r) => r.evaded),
          crit: results.some((r) => r.crit),
          description: skill.skill_type === 'CURACION'
            ? `${actor.name} usa ${skill.name} y cura a ${summary}.`
            : `${actor.name} usa ${skill.name} sobre ${summary}.${statusParts.length ? ` ${statusParts.join(' ')}` : ''}`,
          hp_after: results[0].target.hp,
          mana_after: actor.mana,
        };
      }
    } else if (action === 'DEFEND') {
      actor.is_defending = true;
      if (actor.player_id === req.playerId) {
        await questProgress.registerAction(req.playerId, { baseAction: 'DEFEND', killCount: 0 });
      }
      let defendDescExtra = '';
      const defendInnate = await applyInnateTrigger('ON_DEFEND', { actor, target: null, allies: [], enemies: [] });
      if (defendInnate) {
        if (defendInnate.percent_amount != null && defendInnate.extra_json == null) {
          // Centro de Gravedad: reducción extra al primer golpe que reciba este turno, se
          // consume junto con is_defending (mismo patrón, ver lib/combat.js).
          actor.defend_bonus_reduction = Number(defendInnate.percent_amount);
        } else if (defendInnate.extra_json?.effect === 'grant_small_shield_random_ally') {
          const allyPool = participants.player.filter((p) => p.hp > 0 && p.id !== actor.id);
          const randomAlly = allyPool[Math.floor(Math.random() * allyPool.length)];
          if (randomAlly) {
            await grantSmallShield(sessionId, randomAlly.id);
            defendDescExtra = ` ${randomAlly.name} recibe un escudo pequeño.`;
          }
        }
      }
      logEntry = { actorId: actor.id, action, description: `${actor.name} se pone en guardia.${defendDescExtra}`, mana_after: actor.mana };
    } else if (action === 'ESCAPE') {
      // cualquier personaje tuyo (héroe o compañero contratado) puede intentar que el grupo huya;
      // antes solo el héroe, y en el turno de un compañero el botón Huir no hacía nada
      const petEscapeBonus = actorPetBonuses ? actorPetBonuses.escape_bonus : 0;
      const chance = Math.min(90, combat.escapeChance(actor, participants.enemy) + petEscapeBonus);
      const success = Math.random() * 100 < chance;

      if (success) {
        actor.has_acted_this_round = true;
        await persistParticipant(actor);
        await insertLog(sessionId, session.current_round, {
          actorId: actor.id,
          action,
          success: true,
          description: `${actor.name} escapa del combate. El grupo huye.`,
        });
        const rewards = await finalizeSession(sessionId, 'ESCAPED', participants);
        const state = await fetchSessionState(sessionId);
        emitCombatUpdate(req, sessionId, { ...state, rewards });
        return res.json({ ...state, rewards });
      }

      logEntry = { actorId: actor.id, action, success: false, description: `${actor.name} intenta escapar pero falla.`, mana_after: actor.mana };
    } else if (action === 'USE_ITEM') {
      if (!itemId) return res.status(400).json({ error: 'itemId es requerido para USE_ITEM' });

      // Si el actor es un NPC (player_id = null), el inventario pertenece al jugador dueño.
      const itemOwnerId = actor.player_id ?? req.playerId;
      const bestTier = await inventory.getBestQualityTier(itemOwnerId, itemId);
      const have = await inventory.getQuantity(itemOwnerId, itemId, 0, bestTier);
      if (have < 1) return res.status(400).json({ error: 'No tienes ese item' });

      const targetParticipant = targetParticipantId
        ? participants.player.find((p) => p.id === Number(targetParticipantId))
        : actor;
      if (!targetParticipant) return res.status(400).json({ error: 'Objetivo inválido' });

      const bonuses = await db.query(
        'SELECT stat_code, amount, is_percent, duration_turns FROM item_stat_bonuses WHERE item_id = $1',
        [itemId]
      );
      const itemNameResult = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
      const itemName = itemNameResult.rows[0] ? itemNameResult.rows[0].name : 'item';

      // Cristal de Resurrección (docs ya borrados, ver commit): rechazar ANTES de consumir el
      // item si el objetivo no está caído — perderlo sin efecto por apuntar mal sería muy caro.
      const isRevive = bonuses.rows.some((b) => b.stat_code === 'REVIVE_HP_PERCENT');
      if (isRevive && targetParticipant.hp > 0) {
        return res.status(400).json({ error: `${targetParticipant.name} no está caído, no hace falta revivir.` });
      }

      // Multiplicador por quality_tier del item crafteado con suerte
      const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];
      const qualityMult = QUALITY_TIER_MULTIPLIER[bestTier] ?? 1;

      const BUFF_STAT_MAP = { BUFF_ATK: 'ATQ', BUFF_DEF: 'DEF', BUFF_MAG: 'MAG', BUFF_SPD: 'VEL' };
      const BUFF_STAT_KEY = { BUFF_ATK: 'atk', BUFF_DEF: 'def', BUFF_MAG: 'mag', BUFF_SPD: 'spd' };
      let hpRestored = 0;
      let manaRestored = 0;
      let revived = false;
      const buffParts = [];
      for (const bonus of bonuses.rows) {
        const amount = Math.round(Number(bonus.amount) * qualityMult);
        if (bonus.stat_code === 'REVIVE_HP_PERCENT') {
          targetParticipant.hp = Math.max(1, Math.round(targetParticipant.max_hp * amount / 100));
          revived = true;
        } else if (bonus.stat_code === 'HOT' && bonus.duration_turns) {
          // Regen por ronda con duración. quality_tier sube el % Y extiende 1 ronda por tier.
          const hotDuration = Number(bonus.duration_turns) + bestTier;
          await db.query(
            `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining)
             VALUES ($1, $2, 'HOT', $3, $4)`,
            [sessionId, targetParticipant.id, amount, hotDuration]
          );
          buffParts.push(`obtuvo regeneración por ${hotDuration} rondas`);
        } else if (bonus.stat_code === 'CURE_DOT') {
          // Antídoto: quita los venenos (DOT) que tenga encima
          const cured = await db.query(
            "DELETE FROM combat_participant_buffs WHERE session_id = $1 AND participant_id = $2 AND stat_code = 'DOT' RETURNING id",
            [sessionId, targetParticipant.id]
          );
          buffParts.push(cured.rows.length ? 'se curó del veneno' : 'no estaba envenenado');
        } else if (bonus.stat_code === 'HEAL_HP') {
          const before = targetParticipant.hp;
          targetParticipant.hp = Math.min(targetParticipant.max_hp, targetParticipant.hp + amount);
          hpRestored += targetParticipant.hp - before;
        } else if (bonus.stat_code === 'RESTORE_MANA' || bonus.stat_code === 'HEAL_MP') {
          const before = targetParticipant.mana;
          targetParticipant.mana = Math.min(targetParticipant.max_mana, targetParticipant.mana + amount);
          manaRestored += targetParticipant.mana - before;
        } else if (bonus.stat_code === 'ALL_STATS' && bonus.is_percent) {
          const multiplier = 1 + amount / 100;
          targetParticipant.atk = Math.round(targetParticipant.atk * multiplier);
          targetParticipant.mag = Math.round(targetParticipant.mag * multiplier);
          targetParticipant.def = Math.round(targetParticipant.def * multiplier);
          targetParticipant.spd = Math.round(targetParticipant.spd * multiplier);
          buffParts.push(`aumentó ${amount}% todas las stats`);
        } else if (BUFF_STAT_MAP[bonus.stat_code]) {
          const key = BUFF_STAT_KEY[bonus.stat_code];
          if (bonus.is_percent) {
            targetParticipant[key] = Math.round(targetParticipant[key] * (1 + amount / 100));
          } else {
            targetParticipant[key] += amount;
          }
          buffParts.push(`aumentó ${amount}${bonus.is_percent ? '%' : ''} ${BUFF_STAT_MAP[bonus.stat_code]}`);
        }
      }

      const effectParts = [];
      if (revived) effectParts.push(`fue revivido con ${targetParticipant.hp} HP`);
      if (hpRestored > 0) effectParts.push(`recuperó ${hpRestored} HP`);
      if (manaRestored > 0) effectParts.push(`restauró ${manaRestored} Maná`);
      effectParts.push(...buffParts);
      const effectText =
        effectParts.length === 0
          ? 'no tuvo efecto'
          : effectParts.length === 1
          ? effectParts[0]
          : `${effectParts.slice(0, -1).join(', ')} y ${effectParts[effectParts.length - 1]}`;

      await inventory.removeItem(itemOwnerId, itemId, 1, 0, bestTier);
      await persistParticipant(targetParticipant);

      const isSelfTarget = targetParticipant.id === actor.id;
      const description = isSelfTarget
        ? actor.player_id
          ? `Usaste ${itemName}: ${effectText}.`
          : `${actor.name} usó ${itemName} en sí mismo: ${effectText}.`
        : `${actor.name} usó ${itemName} en ${targetParticipant.name}: ${targetParticipant.name} ${effectText}.`;

      logEntry = {
        actorId: actor.id,
        action,
        targetId: targetParticipant.id,
        itemId,
        description,
        hp_after: targetParticipant.hp,
        mana_after: targetParticipant.mana,
      };
    }

    actor.has_acted_this_round = !actor.grants_extra_action;
    await persistParticipant(actor);
    if (usedSkillCode && logEntry) logEntry.skillCode = usedSkillCode;
    await insertLog(sessionId, session.current_round, logEntry);
    await applyBreakAndFury(sessionId, session.current_round, actor, participants, hpBeforeAction, req.body);

    // Bonus action del invocado: si el actor tiene un invocado activo, ataca automaticamente
    await execSummonBonusAttack(sessionId, actor.id, session.current_round, participants);

    const refreshed = await loadParticipants(sessionId);
    if (combat.isWiped(refreshed.enemy)) {
      const rewards = await finalizeSession(sessionId, 'PLAYER_WON', refreshed);
      const state = await fetchSessionState(sessionId);
      emitCombatUpdate(req, sessionId, { ...state, rewards });
      return res.json({ ...state, rewards });
    }
    if (combat.isWiped(refreshed.player)) {
      await finalizeSession(sessionId, 'ENEMY_WON', refreshed);
      const state = await fetchSessionState(sessionId);
      emitCombatUpdate(req, sessionId, state);
      return res.json({ ...state, rewards: null });
    }

    await advanceEnemyTurns(sessionId);
    const state = await fetchSessionState(sessionId);
    emitCombatUpdate(req, sessionId, state);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.hydratePlayers = hydratePlayers;
module.exports.hydratePartyNpcs = hydratePartyNpcs;
module.exports.hydrateMonsters = hydrateMonsters;
module.exports.worldGroupPartners = worldGroupPartners;
module.exports.notifyLeftOut = notifyLeftOut;
module.exports.COMBAT_SIDE_MAX = COMBAT_SIDE_MAX;
module.exports.immuneToStatus = immuneToStatus;
module.exports.insertParticipants = insertParticipants;
module.exports.advanceEnemyTurns = advanceEnemyTurns;
module.exports.fetchSessionState = fetchSessionState;
module.exports.hasAbandonedActiveSession = hasAbandonedActiveSession;
module.exports.hasActiveCombatSession = hasActiveCombatSession;
module.exports.buildTowerRoom = buildTowerRoom;
module.exports.resolveInfiniteFloor = resolveInfiniteFloor;
module.exports.createCombatSessionWithClaim = createCombatSessionWithClaim;
module.exports.worldGroupPartners = worldGroupPartners;
module.exports.notifyLeftOut = notifyLeftOut;
module.exports.WORLD_BOSS_CODE_PREFIX = WORLD_BOSS_CODE_PREFIX;
module.exports.WORLD_BOSS_ATTEMPT_COOLDOWN_SECONDS = WORLD_BOSS_ATTEMPT_COOLDOWN_SECONDS;
module.exports.WORLD_BOSS_MIN_LEVEL_TO_ENTER = WORLD_BOSS_MIN_LEVEL_TO_ENTER;
module.exports.advanceTowerRoomOrFloor = advanceTowerRoomOrFloor;
module.exports.handleTowerSessionEnd = handleTowerSessionEnd;
module.exports.TOWER_EVENT_TRAP_DAMAGE_PERCENT = TOWER_EVENT_TRAP_DAMAGE_PERCENT;
module.exports.applyForcedRarityAndMutation = applyForcedRarityAndMutation;
