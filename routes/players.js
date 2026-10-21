const express = require('express');
const db = require('../db/db');
const { rankAtLeast, getRankForReputation, getRankBonuses, applyPercentBonus } = require('../lib/ranks');
const inventory = require('../lib/inventory');
const { spendCurrency, withTransaction, learnSkillForGold } = require('../lib/currency');
const leveling = require('../lib/leveling');
const questProgress = require('../lib/questProgress');
const achievements = require('../lib/achievements');
const logros = require('../lib/logros');
const mochila = require('../lib/mochila');
const precios = require('../lib/precios');
const { getEquipmentBonuses, applyHpBonusDelta, getNpcEquipmentBonuses, getNpcEquipmentBonusesBatch, applyNpcHpBonusDelta, QUALITY_TIER_MULTIPLIER: EQUIP_QUALITY_MULT } = require('../lib/equipment');
const { getClassPassiveBonuses } = require('../lib/passives');
const eleccion = require('../lib/eleccion');
const evolution = require('../lib/evolution');
const { fetchQuestDetail } = require('./quests');
const questSteps = require('../lib/questSteps');
const { requireAuth, requireSelf } = require('../lib/auth');
const { getActivePetBonuses } = require('../lib/pets');
const { incrementCounter } = require('../lib/counters');
const { applyInnateTrigger } = require('../lib/innates');
const { getPlayerGuildRow } = require('../lib/guilds');
// servicios de la ciudad: hay que estar junto a quien los ofrece (ver lib/cercania.js)
const { requireNear, lejosDe, SERVICIOS, cercaDe, positionOf } = require('../lib/cercania');
const { isFestival } = require('../lib/aurelia');

// Crafteo: dónde se fabrica cada receta (crafting_recipes.station). Sin lugar, en cualquier lado
// (pociones, comidas, vendajes, refinados simples); el equipo y los lingotes en una forja; el agua
// en el Pilar de Aethra. Devuelve null si estás donde hace falta, o el aviso para el jugador.
function stationProblem(playerId, station) {
  const s = station && SERVICIOS[station];
  return s ? lejosDe(playerId, s.lugares, s.nombre) : null;
}
const npcSell = require('../lib/npcSell');
const recetas = require('../lib/recetas');
const fuentes = require('../lib/fuentes');
const desmantelar = require('../lib/desmantelar');
const armas = require('../lib/armas');
const comida = require('../lib/comida');

const router = express.Router();

// Todas las rutas son /:playerId/..., asi que un solo middleware alcanza para exigir login
// y que el token corresponda exactamente a ese jugador (nadie craftea/completa quests por otro).
router.use(requireAuth);
router.use('/:playerId', requireSelf);

// Material que se pierde si falla el crafteo, por rareza del resultado (ver
// sistema_crafteo_gremios_completo.html: Comun/Poco Comun siempre tienen exito).
const FAILURE_LOSS_PERCENT = {
  COMUN: 0,
  POCO_COMUN: 0,
  RARO: 50,
  EPICO: 70,
  LEGENDARIO: 90,
};

// Probabilístico por unidad: cada unidad tiene lossPercent% de chance individual de perderse.
// Evita que Math.ceil convierta porcentajes parciales en 100% de pérdida en cantidades chicas
// (ej. 1 scroll al 70% = siempre perdido con ceil, pero con esto = 70% de chance).
function calcFailLoss(quantity, lossPercent) {
  let lost = 0;
  for (let i = 0; i < quantity; i++) {
    if (Math.random() * 100 < lossPercent) lost++;
  }
  return lost;
}

// Costo de curarse en el gremio: oro por punto de HP/mana recuperado. 0.5 = 2 puntos por cada
// oro (antes 1 punto por oro) -- a niveles altos, curar de 0 al grupo entero (heroe + NPCs, HP y
// mana) llegaba a costar 600-800+ oro contra un ingreso de ~80 oro por victoria en zona 1, asi
// que una mala racha borraba de un saque lo ganado en 7-10 peleas. calcHeal ya soporta un valor
// no entero (Math.floor(gold / GUILD_HEAL_GOLD_PER_HP) funciona igual con 0.5).
const GUILD_HEAL_GOLD_PER_HP = 0.5;

const EQUIPMENT_SLOTS = ['WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY'];

// Devuelve un Set con los IDs de zonas desbloqueadas para un jugador.
// Misma lógica que GET /:playerId/zones: primera zona siempre, las demás si el jefe de la
// zona anterior fue derrotado O el jugador ya alcanzó el nivel mínimo de esa zona.
async function getUnlockedZoneIds(playerId, playerLevel) {
  const zonesResult = await db.query(
    'SELECT id, min_level FROM monster_zones WHERE is_tower_zone = FALSE ORDER BY min_level'
  );
  // "Jefe derrotado" basado en kill real, no en mision completada (docs/backend-spec-jefe-
  // derrotado-por-kill.md) — misma fuente que GET /:playerId/zones, para que una zona no
  // aparezca "desbloqueada" ahi pero sus misiones sigan ocultas por esta funcion.
  const bossMonstersResult = await db.query(
    `SELECT q.zone_id, qo.monster_id
     FROM quests q
     JOIN quest_objectives qo ON qo.quest_id = q.id AND qo.objective_type = 'DEFEAT_BOSS'
     WHERE q.is_boss_quest = TRUE AND q.quest_type = 'PRINCIPAL'`
  );
  const bossMonsterByZone = new Map(bossMonstersResult.rows.map((r) => [r.zone_id, r.monster_id]));

  const killsResult = await db.query(
    'SELECT monster_id FROM player_monster_kills WHERE player_id = $1',
    [playerId]
  );
  const killedMonsterIds = new Set(killsResult.rows.map((r) => r.monster_id));

  let previousBossDefeated = true;
  const unlockedIds = new Set();
  for (const [index, zone] of zonesResult.rows.entries()) {
    const bossMonsterId = bossMonsterByZone.get(zone.id) || null;
    const bossDefeated = bossMonsterId ? killedMonsterIds.has(bossMonsterId) : false;
    if (index === 0 || previousBossDefeated || playerLevel >= zone.min_level) {
      unlockedIds.add(zone.id);
    }
    previousBossDefeated = bossDefeated;
  }
  return unlockedIds;
}

// GET /api/players/:playerId/bestiary
// IDs de monstruos que el jugador ya enfrentó al menos una vez (para no ocultarles el nombre en el front).
router.get('/:playerId/bestiary', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const result = await db.query(
      'SELECT monster_id FROM player_monster_encounters WHERE player_id = $1',
      [playerId]
    );
    res.json(result.rows.map((r) => r.monster_id));
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/zones
// Una zona (salvo la primera) se desbloquea si el jugador ya derroto al jefe PRINCIPAL
// (is_boss_quest) de la zona anterior, o si ya alcanzo el nivel minimo de esta zona
// (asi un jugador que viene de otro lado/subio de nivel afuera no queda trabado).
// GET /api/player/:playerId/zones
// Devuelve todas las zonas con: estado de combate (boss, nivel), desbloqueo de crafteo y artesanos.
router.get('/:playerId/zones', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const playerResult = await db.query('SELECT level FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const playerLevel = playerResult.rows[0].level;

    const zonesResult = await db.query(
      'SELECT id, name, min_level, max_level, description FROM monster_zones WHERE is_tower_zone = FALSE ORDER BY min_level'
    );

    // "Jefe derrotado" basado en kill real, no en mision completada (docs/backend-spec-jefe-
    // derrotado-por-kill.md) — cuenta si lo mataste alguna vez, sea por mision o explorando
    // libremente sin la mision aceptada.
    const bossMonstersResult = await db.query(
      `SELECT q.zone_id, qo.monster_id
       FROM quests q
       JOIN quest_objectives qo ON qo.quest_id = q.id AND qo.objective_type = 'DEFEAT_BOSS'
       WHERE q.is_boss_quest = TRUE`
    );
    const bossMonsterByZone = new Map(bossMonstersResult.rows.map((r) => [r.zone_id, r.monster_id]));

    const killsResult = await db.query(
      'SELECT monster_id FROM player_monster_kills WHERE player_id = $1',
      [playerId]
    );
    const killedMonsterIds = new Set(killsResult.rows.map((r) => r.monster_id));

    const craftUnlocksResult = await db.query(
      `SELECT zone_id, unlocked_at FROM player_zone_unlocks WHERE player_id = $1`,
      [playerId]
    );
    const craftUnlockByZone = new Map(craftUnlocksResult.rows.map((r) => [r.zone_id, r.unlocked_at]));

    const artisansResult = await db.query(
      `SELECT zone_id, json_agg(json_build_object('code',code,'name',name,'specialty',specialty) ORDER BY name) AS artisans
       FROM artisans GROUP BY zone_id`
    );
    const artisansByZone = new Map(artisansResult.rows.map((r) => [r.zone_id, r.artisans]));

    let previousBossDefeated = true;
    const zones = zonesResult.rows.map((zone, index) => {
      const bossMonsterId = bossMonsterByZone.get(zone.id) || null;
      const bossDefeated = bossMonsterId ? killedMonsterIds.has(bossMonsterId) : false;
      const unlocked = index === 0 || previousBossDefeated || playerLevel >= zone.min_level;
      previousBossDefeated = bossDefeated;

      return {
        id: zone.id,
        name: zone.name,
        minLevel: zone.min_level,
        maxLevel: zone.max_level,
        levelRange: `${zone.min_level}-${zone.max_level}`,
        description: zone.description,
        bossDefeated,
        unlocked,
        craftingUnlocked: craftUnlockByZone.has(zone.id),
        craftingUnlockedAt: craftUnlockByZone.get(zone.id) || null,
        artisans: artisansByZone.get(zone.id) || [],
      };
    });

    res.json(zones);
  } catch (error) {
    next(error);
  }
});

// POST /api/player/:playerId/guild/heal
// body vacío           → greedy: cura héroe primero hasta full, luego NPCs en orden de slot.
// { heroOnly: true }   → cura solo al héroe.
// { npcId: N }         → cura solo al NPC N (debe estar en el grupo activo).
// En todos los casos se gasta solo el oro disponible: si no alcanza para el full se cura
// parcialmente (HP primero, mana después) y se cobra solo lo que se usó.
// Excepción: para las "leyendas" (players.is_bot) la curación es siempre gratis y completa --
// una vez que son leyendas, los ciudadanos del pueblo las apoyan con el descanso, no hace falta
// que paguen. No aplica a jugadores reales.
router.post('/:playerId/guild/heal', async (req, res, next) => {
  const { playerId } = req.params;
  const { npcId, heroOnly } = req.body || {};

  // Cuántos puntos de HP/mana cura con el oro dado; prioriza HP sobre maná. isFree (leyendas)
  // cura todo lo que falte sin límite de oro ni cobrar nada.
  function calcHeal(missingHp, missingMana, gold, isFree) {
    const affordablePoints = isFree ? Infinity : Math.floor(gold / GUILD_HEAL_GOLD_PER_HP);
    const points = Math.min(missingHp + missingMana, affordablePoints);
    const healHp = Math.min(missingHp, points);
    const healMana = Math.min(missingMana, points - healHp);
    // el oro es entero: medio punto se cobra como uno (antes 65 puntos costaban 32,5 y la base lo
    // rechazaba DESPUÉS de curar: «error interno», cura aplicada y gratis)
    return { healHp, healMana, cost: isFree ? 0 : Math.ceil((healHp + healMana) * GUILD_HEAL_GOLD_PER_HP) };
  }

  try {
    const [playerResult, petB] = await Promise.all([
      db.query('SELECT hp, max_hp, mana, max_mana, gold, is_bot FROM players WHERE id = $1', [playerId]),
      getActivePetBonuses(Number(playerId)),
    ]);
    if (!playerResult.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerResult.rows[0];
    const isFree = player.is_bot;
    const effectiveMaxHp = player.max_hp + petB.hp;
    const effectiveMaxMana = player.max_mana + petB.mana;
    let gold = Number(player.gold);

    if (npcId) {
      const npcRes = await db.query(
        `SELECT pn.id, pn.name, pn.hp, pn.max_hp, pn.mana, pn.max_mana
         FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.player_id = $1 AND pn.id = $2`,
        [playerId, npcId]
      );
      if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo activo' });
      const npc = npcRes.rows[0];

      const { healHp, healMana, cost } = calcHeal(npc.max_hp - npc.hp, npc.max_mana - npc.mana, gold, isFree);
      if (healHp + healMana === 0) {
        return res.status(400).json({ error: !isFree && gold < GUILD_HEAL_GOLD_PER_HP ? 'No tienes oro suficiente' : `${npc.name} ya está al máximo` });
      }
      await db.query('UPDATE player_npcs SET hp = hp + $1, mana = mana + $2 WHERE id = $3', [healHp, healMana, npc.id]);
      await db.query('UPDATE players SET gold = gold - $1, updated_at = now() WHERE id = $2', [cost, playerId]);
      return res.json({ npcId: npc.id, name: npc.name, healedHp: healHp, healedMana: healMana, cost, newGold: gold - cost });
    }

    if (heroOnly) {
      const { healHp, healMana, cost } = calcHeal(effectiveMaxHp - player.hp, effectiveMaxMana - player.mana, gold, isFree);
      if (healHp + healMana === 0) {
        return res.status(400).json({ error: !isFree && gold < GUILD_HEAL_GOLD_PER_HP ? 'No tienes oro suficiente' : 'Ya estás al máximo' });
      }
      await db.query(
        'UPDATE players SET hp = hp + $1, mana = mana + $2, gold = gold - $3, updated_at = now() WHERE id = $4',
        [healHp, healMana, cost, playerId]
      );
      return res.json({ healedHp: healHp, healedMana: healMana, cost, newHp: player.hp + healHp, newMana: player.mana + healMana, newGold: gold - cost });
    }

    // --- Greedy: héroe primero, luego NPCs en orden de slot ---
    const npcRes = await db.query(
      `SELECT pn.id, pn.name, pn.hp, pn.max_hp, pn.mana, pn.max_mana
       FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = $1 ORDER BY pp.slot`,
      [playerId]
    );
    const npcs = npcRes.rows;

    const totalMissing = (effectiveMaxHp - player.hp) + (effectiveMaxMana - player.mana)
      + npcs.reduce((s, n) => s + (n.max_hp - n.hp) + (n.max_mana - n.mana), 0);
    if (totalMissing === 0) return res.status(400).json({ error: 'El héroe y todos los NPCs del grupo ya están al máximo' });
    if (!isFree && gold < GUILD_HEAL_GOLD_PER_HP) return res.status(400).json({ error: 'No tienes oro suficiente para curar ni 1 punto' });

    let totalCost = 0;
    let heroHealed = null;
    const npcsHealed = [];

    // todo o nada: si algo falla no queda nadie curado sin cobrar
    await withTransaction(async (client) => {
      const heroHeal = calcHeal(effectiveMaxHp - player.hp, effectiveMaxMana - player.mana, gold, isFree);
      if (heroHeal.healHp + heroHeal.healMana > 0) {
        await client.query('UPDATE players SET hp = hp + $1, mana = mana + $2, updated_at = now() WHERE id = $3', [heroHeal.healHp, heroHeal.healMana, playerId]);
        gold -= heroHeal.cost;
        totalCost += heroHeal.cost;
        heroHealed = { healedHp: heroHeal.healHp, healedMana: heroHeal.healMana };
      }

      for (const npc of npcs) {
        if (!isFree && gold < GUILD_HEAL_GOLD_PER_HP) break;
        const h = calcHeal(npc.max_hp - npc.hp, npc.max_mana - npc.mana, gold, isFree);
        if (h.healHp + h.healMana === 0) continue;
        await client.query('UPDATE player_npcs SET hp = hp + $1, mana = mana + $2 WHERE id = $3', [h.healHp, h.healMana, npc.id]);
        gold -= h.cost;
        totalCost += h.cost;
        npcsHealed.push({ npcId: npc.id, name: npc.name, healedHp: h.healHp, healedMana: h.healMana });
      }

      await client.query('UPDATE players SET gold = gold - $1, updated_at = now() WHERE id = $2', [totalCost, playerId]);
    });
    res.json({ totalCost, newGold: Number(player.gold) - totalCost, hero: heroHealed, npcsHealed });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/skills
// Skills que el jugador puede usar AHORA en combate (boton "Habilidades"): las que ya
// desbloqueo por nivel (LEVEL) o ya aprendio (player_skills, ej. comprada en el gremio), de su
// clase base o evolucionada. "supported" indica si el motor de combate ya sabe resolverla -
// hoy solo ATAQUE/CURACION (ver lib/combat.js resolveSkill); BUFF/DEBUFF con duracion y
// ESPECIAL/ESTADO_ALTERADO quedan listadas pero deshabilitadas hasta que exista ese motor.
router.get('/:playerId/skills', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const playerResult = await db.query(
      'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
      [playerId]
    );
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classIds = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
    await armas.asegurarColumna();
    const etiquetas = await armas.armasDe(playerId);

    const skillsResult = await db.query(
      `SELECT s.id, s.code, s.name, s.skill_type, s.damage_school, s.target_type, s.mana_cost,
              s.hits, s.description, s.cooldown_rounds, s.arma_requerida, e.code AS element_code
       FROM skills s
       LEFT JOIN elements e ON e.id = s.element_id
       WHERE s.is_passive = FALSE AND s.skill_type != 'PASIVA'
         AND (s.class_id = ANY($1::int[]) OR s.class_id IS NULL)
         AND (
           (s.class_id = ANY($1::int[]) AND s.learn_method = 'LEVEL' AND s.learn_level <= $2)
           OR EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $3 AND ps.skill_id = s.id)
         )
       ORDER BY s.class_id, s.name`,
      [classIds, player.level, playerId]
    );

    const skills = skillsResult.rows.map((s) => {
      const supported = ['ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESPECIAL', 'ESTADO_ALTERADO'].includes(s.skill_type) && !s.is_passive;
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        skillType: s.skill_type,
        damageSchool: s.damage_school,
        elementCode: s.element_code,
        targetType: s.target_type,
        manaCost: s.mana_cost,
        hits: s.hits,
        description: s.description,
        cooldownRounds: s.cooldown_rounds,
        supported,
        unsupportedReason: supported ? null : 'Esta habilidad todavía no está disponible en combate.',
        // el arma que pide (null = ninguna) y si la tiene equipada ahora
        armaRequerida: s.arma_requerida,
        armaNombre: s.arma_requerida ? armas.NOMBRE[s.arma_requerida] : null,
        armaOk: armas.cumple(s.arma_requerida, etiquetas),
        armaMotivo: armas.motivo(s, etiquetas),
      };
    });

    res.json(skills);
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/class-skills?npcId=N
// Todas las skills de la clase del héroe (base + evolución) o de un NPC del grupo.
// Incluye pasivas y activas, aprendidas y no. Para pasivas incluye sus efectos para mostrar
// qué bono dan. Para el héroe "learned" incluye LEVEL y comprado (GOLD/QUEST). Para NPC
// solo LEVEL (los NPCs aprenden automáticamente todas las skills LEVEL de su clase).
router.get('/:playerId/class-skills', async (req, res, next) => {
  const { playerId } = req.params;
  const npcId = req.query.npcId ? Number(req.query.npcId) : null;

  try {
    let classIds, level, isNpc;
    await armas.asegurarColumna();

    if (npcId) {
      const npcRes = await db.query(
        'SELECT class_id, level FROM player_npcs WHERE id = $1 AND player_id = $2',
        [npcId, playerId]
      );
      if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });
      classIds = [npcRes.rows[0].class_id];
      level = npcRes.rows[0].level;
      isNpc = true;
    } else {
      const playerRes = await db.query(
        'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
        [playerId]
      );
      if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
      const p = playerRes.rows[0];
      classIds = await evolution.getClassAncestorChain(p.evolution_class_id || p.current_class_id);
      level = p.level;
      isNpc = false;
    }

    let skillsRes;
    if (isNpc) {
      skillsRes = await db.query(
        `SELECT s.id, s.name, s.skill_type, s.is_passive, s.learn_method, s.learn_level, s.cooldown_rounds,
                s.mana_cost, s.target_type, s.damage_school, s.hits, s.description, s.arma_requerida,
                TRUE AS learned
         FROM skills s
         WHERE (s.class_id = ANY($1::int[])
                OR (s.class_id IS NULL AND NOT EXISTS (SELECT 1 FROM monster_skills ms WHERE ms.skill_id = s.id)))
           AND s.learn_method IN ('LEVEL', 'GOLD')
           AND s.learn_level <= $2
         ORDER BY s.is_passive DESC, s.learn_level, s.name`,
        [classIds, level]
      );
    } else {
      skillsRes = await db.query(
        `SELECT s.id, s.name, s.skill_type, s.is_passive, s.learn_method, s.learn_level, s.cooldown_rounds,
                s.mana_cost, s.target_type, s.damage_school, s.hits, s.description, s.arma_requerida,
                ((s.learn_method = 'LEVEL' AND s.learn_level <= $2 AND s.class_id = ANY($3::int[]))
                 OR EXISTS(SELECT 1 FROM player_skills ps WHERE ps.player_id = $1 AND ps.skill_id = s.id)
                ) AS learned
         FROM skills s
         WHERE (s.class_id = ANY($3::int[])
                OR (s.class_id IS NULL AND NOT EXISTS (SELECT 1 FROM monster_skills ms WHERE ms.skill_id = s.id)))
         ORDER BY s.is_passive DESC, s.learn_level, s.name`,
        [playerId, level, classIds]
      );
    }

    if (!skillsRes.rows.length) return res.json([]);
    // el arma del héroe (los compañeros no se revisan: pelean con lo de su clase)
    const etiquetas = isNpc ? null : await armas.armasDe(playerId);

    const skillIds = skillsRes.rows.map((s) => s.id);
    const effectsRes = await db.query(
      `SELECT skill_id, effect_type, stat_code, percent_amount, flat_amount, duration_turns, chance_percent, status_code, description
       FROM skill_effects
       WHERE skill_id = ANY($1::int[])
       ORDER BY skill_id, id`,
      [skillIds]
    );
    const effectsBySkillId = {};
    for (const e of effectsRes.rows) {
      if (!effectsBySkillId[e.skill_id]) effectsBySkillId[e.skill_id] = [];
      effectsBySkillId[e.skill_id].push({
        effectType: e.effect_type,
        statCode: e.stat_code,
        percentAmount: e.percent_amount != null ? Number(e.percent_amount) : null,
        flatAmount: e.flat_amount != null ? Number(e.flat_amount) : null,
        durationTurns: e.duration_turns,
        chancePercent: e.chance_percent != null ? Number(e.chance_percent) : null,
        statusCode: e.status_code ?? null,
        description: e.description ?? null,
      });
    }

    res.json(skillsRes.rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      skillType: s.skill_type,
      damageSchool: s.damage_school,
      isPassive: s.is_passive,
      learnMethod: s.learn_method,
      learnLevel: s.learn_level,
      cooldownRounds: s.cooldown_rounds,
      learned: s.learned,
      manaCost: s.mana_cost,
      targetType: s.target_type,
      damageSchool: s.damage_school,
      hits: s.hits,
      description: s.description,
      effects: effectsBySkillId[s.id] || [],
      armaNombre: s.arma_requerida ? armas.NOMBRE[s.arma_requerida] : null,
      armaOk: etiquetas ? armas.cumple(s.arma_requerida, etiquetas) : true,
    })));
  } catch (error) { next(error); }
});

// GET /api/players/:playerId/guild/skills?classId=N
// El "maestro de gremio" no es una entidad propia: cada clase es su propio maestro. Si no
// se pasa classId, devuelve las skills de la clase base del jugador (current_class_id, que
// no cambia al evolucionar). Si se pasa classId (para ver un maestro que no es el tuyo),
// se listan igual sus skills pero todas quedan bloqueadas para aprender.
router.get('/:playerId/guild/skills', async (req, res, next) => {
  const { playerId } = req.params;
  const requestedClassId = req.query.classId ? Number(req.query.classId) : null;

  try {
    const playerResult = await db.query('SELECT current_class_id, evolution_class_id, gold, level FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classId = requestedClassId || player.current_class_id;
    const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
    const isOwnClass = classChain.includes(classId);

    const skillsResult = await db.query(
      `SELECT s.id, s.code, s.name, s.learn_method, s.learn_level, s.learn_gold_cost, s.learn_requirement_text, s.description,
              ps.player_id IS NOT NULL AS learned,
              EXISTS (
                SELECT 1 FROM quests q
                JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
                WHERE q.name = s.learn_requirement_text
              ) AS quest_completed
       FROM skills s
       LEFT JOIN player_skills ps ON ps.skill_id = s.id AND ps.player_id = $1
       WHERE s.class_id = $2 AND s.learn_method IN ('GOLD', 'QUEST')
       ORDER BY s.learn_method, s.learn_level NULLS LAST, s.name`,
      [playerId, classId]
    );

    const skills = skillsResult.rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      description: s.description,
      learnMethod: s.learn_method,
      goldCost: s.learn_gold_cost,
      requirementText: s.learn_requirement_text,
      learnLevel: s.learn_level,
      // el maestro enseña desde ese nivel
      levelLocked: s.learn_level != null && Number(player.level) < s.learn_level,
      learned: s.learned,
      locked: !isOwnClass || (s.learn_method === 'QUEST' && !s.quest_completed) || (s.learn_level != null && Number(player.level) < s.learn_level),
      affordable: isOwnClass && s.learn_method === 'GOLD' ? Number(player.gold) >= s.learn_gold_cost : null,
    }));

    res.json({ gold: Number(player.gold), level: Number(player.level), classId, isOwnClass, skills });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/guild/learn-skill { skillId }
router.post('/:playerId/guild/learn-skill', requireNear('maestros'), async (req, res, next) => {
  const { playerId } = req.params;
  const { skillId } = req.body;

  try {
    const skillResult = await db.query('SELECT * FROM skills WHERE id = $1', [skillId]);
    if (!skillResult.rows.length) {
      return res.status(404).json({ error: 'Skill no encontrada' });
    }
    const skill = skillResult.rows[0];

    const playerResult = await db.query('SELECT current_class_id, evolution_class_id, gold, level FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
    if (!classChain.includes(skill.class_id)) {
      return res.status(400).json({ error: 'Esa skill no es de tu clase' });
    }
    if (!['GOLD', 'QUEST'].includes(skill.learn_method)) {
      return res.status(400).json({ error: 'Esa skill no se puede aprender en el gremio' });
    }
    if (skill.learn_level != null && Number(player.level) < skill.learn_level) {
      return res.status(400).json({ error: `Tu maestro te la enseña desde el nivel ${skill.learn_level}` });
    }

    const already = await db.query('SELECT 1 FROM player_skills WHERE player_id = $1 AND skill_id = $2', [playerId, skillId]);
    if (already.rows.length) {
      return res.status(400).json({ error: 'Ya aprendiste esa skill' });
    }

    if (skill.learn_method === 'QUEST') {
      const questCompleted = await db.query(
        `SELECT 1 FROM quests q
         JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
         WHERE q.name = $2`,
        [playerId, skill.learn_requirement_text]
      );
      if (!questCompleted.rows.length) {
        return res.status(400).json({ error: `Primero debes completar la misión: ${skill.learn_requirement_text}` });
      }
      await db.query('INSERT INTO player_skills(player_id, skill_id) VALUES ($1, $2)', [playerId, skillId]);
      return res.json({ learnedSkillId: skill.id, name: skill.name, cost: 0, newGold: Number(player.gold) });
    }

    const cost = skill.learn_gold_cost;
    if (Number(player.gold) < cost) {
      return res.status(400).json({ error: `No tienes suficiente oro (necesitas ${cost})`, cost, gold: Number(player.gold) });
    }

    const learned = await learnSkillForGold(playerId, cost, {
      table: 'player_skills', ownerColumn: 'player_id', ownerId: playerId, skillId,
    });
    if (learned.abort) return res.status(learned.status).json({ error: learned.error, cost });

    res.json({ learnedSkillId: skill.id, name: skill.name, cost, newGold: learned.balance });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/npcs/:npcId/learn-skill { skillId }
// Igual que guild/learn-skill pero para un NPC del grupo -- el NPC no tiene oro propio (lo paga el
// jugador) ni hace quests propias (el requisito QUEST se revisa contra las misiones YA completadas
// por el jugador dueño, mismo criterio que para su propio héroe).
router.post('/:playerId/npcs/:npcId/learn-skill', requireNear('maestros'), async (req, res, next) => {
  const { playerId, npcId } = req.params;
  const { skillId } = req.body;

  try {
    const [skillResult, npcResult, playerResult] = await Promise.all([
      db.query('SELECT * FROM skills WHERE id = $1', [skillId]),
      db.query('SELECT id, class_id FROM player_npcs WHERE id = $1 AND player_id = $2', [npcId, playerId]),
      db.query('SELECT gold FROM players WHERE id = $1', [playerId]),
    ]);
    if (!skillResult.rows.length) return res.status(404).json({ error: 'Skill no encontrada' });
    if (!npcResult.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo' });
    const skill = skillResult.rows[0];
    const npc = npcResult.rows[0];
    const player = playerResult.rows[0];

    const classChain = await evolution.getClassAncestorChain(npc.class_id);
    if (!classChain.includes(skill.class_id)) {
      return res.status(400).json({ error: 'Esa skill no es de la clase de este NPC' });
    }
    if (!['GOLD', 'QUEST'].includes(skill.learn_method)) {
      return res.status(400).json({ error: 'Esa skill no se puede aprender en el gremio' });
    }
    // las técnicas del maestro con nivel las aprenden los compañeros solos al llegar a ese nivel
    if (skill.learn_method === 'GOLD' && skill.learn_level != null) {
      return res.status(400).json({ error: `Tus compañeros la aprenden solos al llegar al nivel ${skill.learn_level}` });
    }

    const already = await db.query('SELECT 1 FROM npc_skills WHERE npc_id = $1 AND skill_id = $2', [npcId, skillId]);
    if (already.rows.length) {
      return res.status(400).json({ error: 'Ese NPC ya aprendió esa skill' });
    }

    if (skill.learn_method === 'QUEST') {
      const questCompleted = await db.query(
        `SELECT 1 FROM quests q
         JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
         WHERE q.name = $2`,
        [playerId, skill.learn_requirement_text]
      );
      if (!questCompleted.rows.length) {
        return res.status(400).json({ error: `Primero debes completar la misión: ${skill.learn_requirement_text}` });
      }
      await db.query('INSERT INTO npc_skills(npc_id, skill_id) VALUES ($1, $2)', [npcId, skillId]);
      return res.json({ learnedSkillId: skill.id, name: skill.name, cost: 0, newGold: Number(player.gold) });
    }

    const cost = skill.learn_gold_cost;
    if (Number(player.gold) < cost) {
      return res.status(400).json({ error: `No tienes suficiente oro (necesitas ${cost})`, cost, gold: Number(player.gold) });
    }

    const learned = await learnSkillForGold(playerId, cost, {
      table: 'npc_skills', ownerColumn: 'npc_id', ownerId: npcId, skillId,
    });
    if (learned.abort) return res.status(learned.status).json({ error: learned.error, cost });

    res.json({ learnedSkillId: skill.id, name: skill.name, cost, newGold: learned.balance });
  } catch (error) {
    next(error);
  }
});

// Precio de venta al gremio para CUALQUIER item del inventario: ver lib/npcSell.js (masterPrice).

// GET /api/players/:playerId/guild/shop?classId=N
// Tienda del maestro de gremio: vende solo el set basico de nivel 1 de su clase (items con
// buy_price seteado, ver migracion). Igual que en guild/skills, se puede mirar la tienda de
// un maestro que no es el tuyo, pero solo se puede comprar en la de tu propia clase.
router.get('/:playerId/guild/shop', async (req, res, next) => {
  const { playerId } = req.params;
  const requestedClassId = req.query.classId ? Number(req.query.classId) : null;

  try {
    const playerResult = await db.query('SELECT current_class_id, evolution_class_id, gold FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classId = requestedClassId || player.current_class_id;
    const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
    const isOwnClass = classChain.includes(classId);

    const itemsResult = await db.query(
      `SELECT id, code, name, slot, rarity, required_level, buy_price, description
       FROM items
       WHERE class_id = $1 AND buy_price IS NOT NULL
       ORDER BY slot`,
      [classId]
    );

    res.json({
      gold: Number(player.gold),
      classId,
      isOwnClass,
      items: itemsResult.rows.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        slot: i.slot,
        rarity: i.rarity,
        requiredLevel: i.required_level,
        buyPrice: i.buy_price,
        description: i.description,
        affordable: Number(player.gold) >= i.buy_price,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/guild/shop/buy { itemId, quantity? }
router.post('/:playerId/guild/shop/buy', requireNear('maestros'), async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  try {
    const item = await npcSell.itemForSale(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    if (item.buy_price === null) {
      return res.status(400).json({ error: 'Ese item no está a la venta' });
    }

    const playerResult = await db.query('SELECT current_class_id, evolution_class_id, gold FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    if (item.class_id) {
      const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
      if (!classChain.includes(item.class_id)) {
        return res.status(403).json({ error: 'Esta tienda es para tu propia clase' });
      }
    }

    const cost = item.buy_price * qty;
    if (Number(player.gold) < cost) {
      return res.status(400).json({ error: `No tienes suficiente oro (necesitas ${cost})`, cost, gold: Number(player.gold) });
    }

    const newGold = await withTransaction(async (client) => {
      const balance = await spendCurrency(playerId, 'gold', cost, client);
      if (balance !== null) await inventory.addItem(playerId, item.id, qty, 0, 0, client);
      return balance;
    });
    if (newGold === null) return res.status(400).json({ error: `No tienes suficiente oro (necesitas ${cost})`, cost });

    res.json({ boughtItemId: item.id, name: item.name, quantity: qty, cost, newGold });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/guild/shop/sell { itemId, quantity, enchantLevel? }
// Solo opera contra player_inventory (lo no equipado): un item equipado nunca aparece ahi,
// asi que no hace falta validacion extra para evitar vender lo que tienes puesto.
router.post('/:playerId/guild/shop/sell', requireNear('maestros'), async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, quantity, enchantLevel = 0 } = req.body;
  const qty = Number(quantity) || 1;

  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    const item = itemResult.rows[0];
    if (item.is_quest_item) return res.status(400).json({ error: `${item.name} es un objeto de misión: no se puede vender.` });

    const owned = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (owned < qty) {
      return res.status(400).json({ error: 'No tienes esa cantidad en tu inventario' });
    }

    // La venta siempre es la mitad del precio de compra (buy_price) cuando el item se vende
    // en algun gremio. Para items que no estan a la venta en ninguna tienda (drops, etc.) no
    // hay "costo" que reducir a la mitad, asi que se usa la tabla por rareza como respaldo. Nunca
    // más de la mitad de lo que cuesta en otra tienda de oro (ver lib/npcSell.js).
    const unitPrice = npcSell.masterPrice(item);
    const total = unitPrice * qty;

    const client = await db.pool.connect();
    let updated;
    try {
      await client.query('BEGIN');
      await inventory.removeItem(playerId, itemId, qty, enchantLevel, null, client);
      updated = await client.query(
        'UPDATE players SET gold = gold + $1, updated_at = now() WHERE id = $2 RETURNING gold',
        [total, playerId]
      );
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ soldItemId: item.id, name: item.name, quantitySold: qty, goldGained: total, newGold: Number(updated.rows[0].gold) });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/evolutions
// Evoluciones posibles desde la clase efectiva actual (evolution_class_id si ya evoluciono antes,
// sino current_class_id), con el detalle de que requisito falta. Los requisitos tipo COUNTER
// (la mayoria, ej. "100 kills con fuego") quedan con available=false: todavia no existe sistema
// de contadores de jugador (ver lib/evolution.js).
router.get('/:playerId/evolutions', async (req, res, next) => {
  try {
    const result = await evolution.getAvailableEvolutions(req.params.playerId);
    if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/evolve { evolutionId }
router.post('/:playerId/evolve', async (req, res, next) => {
  const { evolutionId } = req.body;
  if (!evolutionId) return res.status(400).json({ error: 'evolutionId es requerido' });

  try {
    const result = await evolution.evolvePlayer(req.params.playerId, evolutionId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/player/:playerId/master-encounter/resolve — ayudar al maestro de clase pendiente
// (docs/backend-spec-maestros-de-clase.md): lo instala en el gremio actual del jugador (no es
// personal, cualquier miembro puede comprarle despues).
router.post('/:playerId/master-encounter/resolve', async (req, res, next) => {
  try {
    const playerRes = await db.query('SELECT pending_master_id FROM players WHERE id = $1', [req.playerId]);
    const masterId = playerRes.rows[0]?.pending_master_id;
    if (!masterId) return res.status(400).json({ error: 'No hay ningún encuentro pendiente' });

    const guildRes = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [req.playerId]);
    const guildId = guildRes.rows[0]?.guild_id;
    if (!guildId) return res.status(400).json({ error: 'Necesitás estar en un gremio' });

    await db.query(
      `INSERT INTO guild_class_masters(guild_id, master_id, unlocked_by_player_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [guildId, masterId, req.playerId]
    );
    await db.query('UPDATE players SET pending_master_id = NULL WHERE id = $1', [req.playerId]);
    res.json({ unlocked: true, masterId });
  } catch (error) {
    next(error);
  }
});

// POST /api/player/:playerId/inventory/favorito { inventoryId } — pone o quita el candado (lib/mochila.js)
router.post('/:playerId/inventory/favorito', async (req, res, next) => {
  try {
    const favorito = await mochila.alternarFavorito(Number(req.params.playerId), Number(req.body?.inventoryId));
    if (favorito === null) return res.status(404).json({ error: 'No tienes eso en la mochila' });
    res.json({ favorito });
  } catch (error) { next(error); }
});

// GET /api/players/:playerId/inventory?type=EQUIPMENT&slot=WEAPON&rarity=RARO
router.get('/:playerId/inventory', async (req, res, next) => {
  const { type, slot, rarity } = req.query;
  await mochila.ensureTables().catch(() => {});
  const conditions = ['pi.player_id = $1'];
  const params = [req.params.playerId];

  if (type) {
    params.push(type);
    conditions.push(`i.item_type = $${params.length}`);
  }
  if (slot) {
    params.push(slot);
    conditions.push(`i.slot = $${params.length}`);
  }
  if (rarity) {
    params.push(rarity);
    conditions.push(`i.rarity = $${params.length}`);
  }

  try {
    const result = await db.query(
      `SELECT pi.id AS inventory_id, pi.item_id, pi.enchant_level, pi.quality_tier, pi.quantity, pi.favorito,
              i.code, i.name, i.item_type, i.slot, i.rarity, i.class_id, i.is_quest_item,
              i.required_level, i.is_two_handed, i.buy_price, i.sell_zone_mult, ${npcSell.SELL_CAP_SQL} AS sell_cap,
              (EXISTS (SELECT 1 FROM crafting_recipes cr2 WHERE cr2.scroll_item_id = i.id)) AS is_scroll,
              (
                EXISTS (SELECT 1 FROM crafting_recipes cr2 WHERE cr2.scroll_item_id = i.id)
                AND NOT EXISTS (
                  SELECT 1 FROM crafting_recipes cr3
                  WHERE cr3.scroll_item_id = i.id
                  AND NOT EXISTS (
                    SELECT 1 FROM player_learned_recipes plr2
                    WHERE plr2.recipe_id = cr3.id AND plr2.player_id = pi.player_id
                  )
                )
              ) AS recipe_already_learned
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.item_type, pi.quality_tier DESC, pi.enchant_level DESC, i.name`,
      params
    );
    const RARITY_NAMES = ['COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO'];
    const rows = result.rows.map((r) => ({
      ...r,
      effective_rarity: RARITY_NAMES[Math.min(RARITY_NAMES.indexOf(r.rarity) + r.quality_tier, 4)] ?? r.rarity,
      // lo que te pagan los NPC (null = el artesano no lo compra)
      sell_artisan: npcSell.artisanPrice(r),
      sell_master: npcSell.masterPrice(r),
    }));
    // mejora (▲ en la mochila) y sobra (para «Vender lo que no usas»): lib/mochila.js
    res.json(await mochila.marcar(Number(req.params.playerId), rows).catch(() => rows));
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/inventory/use/:itemId — usar un scroll para aprender una receta
router.post('/:playerId/inventory/use/:itemId', async (req, res, next) => {
  const { playerId, itemId } = req.params;
  try {
    const owned = await inventory.getQuantity(playerId, itemId);
    if (owned < 1) return res.status(400).json({ error: 'No tienes ese item en tu inventario' });

    const recipeRes = await db.query(
      `SELECT cr.id AS recipe_id, res.name AS result_name
       FROM crafting_recipes cr
       JOIN items res ON res.id = cr.result_item_id
       WHERE cr.scroll_item_id = $1`,
      [itemId]
    );
    if (!recipeRes.rows.length) return res.status(400).json({ error: 'Este item no es un pergamino de receta' });

    const learnedRes = await db.query(
      'SELECT recipe_id FROM player_learned_recipes WHERE player_id = $1 AND recipe_id = ANY($2::int[])',
      [playerId, recipeRes.rows.map((r) => r.recipe_id)]
    );
    const alreadyLearnedIds = new Set(learnedRes.rows.map((r) => r.recipe_id));
    const newRecipes = recipeRes.rows.filter((r) => !alreadyLearnedIds.has(r.recipe_id));

    if (!newRecipes.length) {
      return res.json({ message: 'Ya conocías todas las recetas de este pergamino', alreadyLearned: true, learnedRecipes: [] });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await inventory.removeItem(playerId, itemId, 1, 0, null, client);
      for (const r of newRecipes) {
        await client.query(
          'INSERT INTO player_learned_recipes(player_id, recipe_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [playerId, r.recipe_id]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({
      message: `Aprendiste ${newRecipes.length} receta(s) nueva(s)`,
      alreadyLearned: false,
      learnedRecipes: newRecipes.map((r) => ({ recipeId: r.recipe_id, resultName: r.result_name })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/equipment - los 7 slots, con el item puesto (o null) en cada uno.
router.get('/:playerId/equipment', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pe.slot, pe.enchant_level, pe.quality_tier, i.id AS item_id, i.code, i.name, i.rarity, i.is_two_handed, i.required_level
       FROM player_equipment pe
       JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = $1`,
      [req.params.playerId]
    );
    const bySlot = {};
    for (const row of result.rows) bySlot[row.slot] = row;

    const equipment = EQUIPMENT_SLOTS.map((slot) => {
      const row = bySlot[slot];
      return {
        slot,
        item: row
          ? {
              itemId: row.item_id,
              code: row.code,
              name: row.name,
              rarity: row.rarity,
              effectiveRarity: (() => {
                const RN = ['COMUN','POCO_COMUN','RARO','EPICO','LEGENDARIO'];
                return RN[Math.min(RN.indexOf(row.rarity) + (row.quality_tier || 0), 4)] ?? row.rarity;
              })(),
              qualityTier: row.quality_tier || 0,
              isTwoHanded: row.is_two_handed,
              requiredLevel: row.required_level,
              enchantLevel: row.enchant_level,
            }
          : null,
      };
    });

    res.json(equipment);
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/inspect/:targetId
// Perfil de solo lectura de CUALQUIER jugador (docs/backend-spec-inspeccionar-jugador.md) --
// mismo criterio que friends/search: nada de esto es privado hoy (ya se puede buscar nickname/
// nivel/clase de cualquiera sin ser amigos), así que cualquier jugador autenticado puede
// inspeccionar a cualquier otro. No expone email, inventario no equipado, ni mensajería.
// :playerId es quien pide (requireSelf ya lo valida a nivel router), :targetId es a quien mira.
router.get('/:playerId/inspect/:targetId', async (req, res, next) => {
  const { targetId } = req.params;
  try {
    const playerResult = await db.query(
      `SELECT p.nickname, p.level, p.rank, p.created_at, p.hp, p.atk, p.def, p.mag, p.magic_def, p.spd, p.crit,
              p.combat_wins, p.combat_losses, p.boss_kills,
              c.name AS class_name, c.code AS class_code
       FROM players p
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE p.id = $1`,
      [targetId]
    );
    if (!playerResult.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerResult.rows[0];

    const [equipResult, guild, npcsResult, bonus, petRes, achRes, bestRes] = await Promise.all([
      db.query(
        `SELECT pe.slot, pe.item_id, i.name AS item_name, i.rarity, pe.enchant_level, pe.quality_tier
         FROM player_equipment pe JOIN items i ON i.id = pe.item_id
         WHERE pe.player_id = $1 ORDER BY pe.slot`,
        [targetId]
      ),
      getPlayerGuildRow(targetId),
      db.query(
        `SELECT pn.id, pn.name, pn.level, c.name AS class_name
         FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
         JOIN classes c ON c.id = pn.class_id
         WHERE pp.player_id = $1 ORDER BY pp.slot`,
        [targetId]
      ),
      getEquipmentBonuses(targetId),
      // lo que se ve al inspeccionar en el mundo: mascota que lo acompaña, logros y bestiario
      db.query(
        `SELECT pt.name, pt.rarity, pp.level FROM player_pets pp JOIN pets pt ON pt.id = pp.pet_id
         WHERE pp.player_id = $1 AND pp.is_active LIMIT 1`,
        [targetId]
      ),
      db.query('SELECT count(*)::int AS n FROM player_achievements WHERE player_id = $1', [targetId]),
      db.query('SELECT count(*)::int AS fichas, count(*) FILTER (WHERE completed)::int AS dominadas FROM player_bestiary WHERE player_id = $1', [targetId])
        .catch(() => ({ rows: [{ fichas: 0, dominadas: 0 }] })),
    ]);

    const npcIds = npcsResult.rows.map((n) => n.id);
    const npcEquipResult = npcIds.length
      ? await db.query(
          `SELECT ne.npc_id, ne.slot, i.name AS item_name, i.rarity
           FROM npc_equipment ne JOIN items i ON i.id = ne.item_id
           WHERE ne.npc_id = ANY($1::int[])`,
          [npcIds]
        )
      : { rows: [] };
    const npcEquipByNpc = {};
    for (const row of npcEquipResult.rows) {
      (npcEquipByNpc[row.npc_id] = npcEquipByNpc[row.npc_id] || []).push({
        slot: row.slot, itemName: row.item_name, rarity: row.rarity,
      });
    }

    res.json({
      nickname: player.nickname,
      level: player.level,
      className: player.class_name,
      rank: player.rank,
      createdAt: player.created_at,
      stats: {
        hp: player.hp, // ya incluye el bono de equipo (persistido, ver lib/equipment.js)
        atk: player.atk + (bonus.atk || 0),
        def: player.def + (bonus.def || 0),
        mag: player.mag + (bonus.mag || 0),
        magicDef: player.magic_def + (bonus.magic_def || 0),
        spd: player.spd + (bonus.spd || 0),
        crit: Number(player.crit) + (bonus.crit_chance || 0),
      },
      general: {
        combatWins: player.combat_wins,
        combatLosses: player.combat_losses,
        bossKills: player.boss_kills,
      },
      classCode: player.class_code,
      pet: petRes.rows[0] ? { name: petRes.rows[0].name, rarity: petRes.rows[0].rarity, level: petRes.rows[0].level } : null,
      achievements: achRes.rows[0].n,
      bestiary: { fichas: bestRes.rows[0].fichas, dominadas: bestRes.rows[0].dominadas },
      equipment: equipResult.rows.map((r) => ({
        slot: r.slot,
        itemId: r.item_id,
        itemName: r.item_name,
        rarity: r.rarity,
        enchantLevel: r.enchant_level,
        qualityTier: r.quality_tier,
      })),
      guild: guild ? { name: guild.name, role: guild.role, level: guild.level, emblem: guild.emblem, color: guild.color } : null,
      companions: npcsResult.rows.map((n) => ({
        name: n.name,
        className: n.class_name,
        level: n.level,
        equipment: npcEquipByNpc[n.id] || [],
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/equip { itemId, enchantLevel? }
// Saca el item del inventario y lo pone en su slot. Si ocupaba algo ese slot (o OFFHAND, en
// caso de un arma a dos manos), eso vuelve al inventario con su enchant_level original.
router.post('/:playerId/equip', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, enchantLevel = 0, qualityTier: requestedTier = 0 } = req.body;

  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    const item = itemResult.rows[0];

    if (item.item_type !== 'EQUIPMENT' || !item.slot) {
      return res.status(400).json({ error: 'Ese item no es equipable' });
    }

    const owned = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (owned < 1) {
      return res.status(400).json({ error: 'No tienes ese item en tu inventario' });
    }

    const playerResult = await db.query(
      'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
      [playerId]
    );
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    if (item.class_id) {
      const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
      if (!classChain.includes(item.class_id)) {
        return res.status(400).json({ error: 'Ese item no es de tu clase' });
      }
    }
    if (item.required_level && player.level < item.required_level) {
      return res.status(400).json({ error: `Necesitas nivel ${item.required_level} para equipar esto` });
    }

    if (item.slot === 'OFFHAND') {
      const weapon = await db.query(
        `SELECT i.is_two_handed FROM player_equipment pe
         JOIN items i ON i.id = pe.item_id
         WHERE pe.player_id = $1 AND pe.slot = 'WEAPON'`,
        [playerId]
      );
      if (weapon.rows.length && weapon.rows[0].is_two_handed) {
        return res.status(400).json({ error: 'Tu arma actual ocupa las dos manos' });
      }
    }

    // HP efectivo (ver lib/equipment.js): se mide el bono de equipo antes y despues del swap
    // para aplicar solo el delta a players.hp/max_hp, sin importar cuantos slots cambiaron
    // (ej. equipar un arma a dos manos tambien libera el offhand).
    const bonusBefore = await getEquipmentBonuses(playerId);
    const sinArmaAntes = await armas.habilidadesSinArma(playerId, await armas.armasDe(playerId)).catch(() => []);

    // Todo el swap (desequipar lo viejo, sacar lo nuevo del inventario, equiparlo) en una sola
    // transaccion -- antes cada paso confirmaba por separado, asi que un fallo a mitad de camino
    // (ej. la insercion de player_equipment) podia dejar el item ya descontado del inventario
    // sin haber quedado equipado, perdiendolo.
    const client = await db.pool.connect();
    let equipQualityTier;
    try {
      await client.query('BEGIN');

      const previous = await client.query(
        `DELETE FROM player_equipment WHERE player_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier`,
        [playerId, item.slot]
      );
      if (previous.rows.length) {
        await inventory.addItem(playerId, previous.rows[0].item_id, 1, previous.rows[0].enchant_level, previous.rows[0].quality_tier || 0, client);
      }

      if (item.is_two_handed) {
        const previousOffhand = await client.query(
          `DELETE FROM player_equipment WHERE player_id = $1 AND slot = 'OFFHAND' RETURNING item_id, enchant_level, quality_tier`,
          [playerId]
        );
        if (previousOffhand.rows.length) {
          await inventory.addItem(playerId, previousOffhand.rows[0].item_id, 1, previousOffhand.rows[0].enchant_level, previousOffhand.rows[0].quality_tier || 0, client);
        }
      }

      equipQualityTier = Number(requestedTier);
      const hasIt = await inventory.getQuantity(playerId, itemId, enchantLevel, equipQualityTier);
      if (hasIt < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No tienes ese item con esa rareza en tu inventario' });
      }

      await inventory.removeItem(playerId, itemId, 1, enchantLevel, equipQualityTier, client);
      await client.query(
        `INSERT INTO player_equipment(player_id, slot, item_id, enchant_level, quality_tier) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id, enchant_level = EXCLUDED.enchant_level, quality_tier = EXCLUDED.quality_tier`,
        [playerId, item.slot, itemId, enchantLevel, equipQualityTier]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const bonusAfter = await getEquipmentBonuses(playerId);
    await applyHpBonusDelta(playerId, (bonusAfter.hp || 0) - (bonusBefore.hp || 0));

    // las habilidades que este cambio deja sin poder usarse (arco por espada: las flechas se apagan)
    const sinArmaAhora = await armas.habilidadesSinArma(playerId, await armas.armasDe(playerId)).catch(() => []);
    const avisoArmas = sinArmaAhora.filter((n) => !sinArmaAntes.includes(n));

    res.json({ slot: item.slot, itemId: item.id, name: item.name, avisoArmas });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/unequip { slot }
router.post('/:playerId/unequip', async (req, res, next) => {
  const { playerId } = req.params;
  const { slot } = req.body;

  if (!EQUIPMENT_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Slot inválido' });
  }

  try {
    const sinArmaAntes = await armas.habilidadesSinArma(playerId, await armas.armasDe(playerId)).catch(() => []);
    const removed = await db.query(
      `DELETE FROM player_equipment WHERE player_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier`,
      [playerId, slot]
    );
    if (!removed.rows.length) {
      return res.status(400).json({ error: 'No tienes nada equipado en ese slot' });
    }
    await inventory.addItem(playerId, removed.rows[0].item_id, 1, removed.rows[0].enchant_level, removed.rows[0].quality_tier || 0);

    // HP efectivo (ver lib/equipment.js): resta exactamente el bono de HP del item sacado.
    const removedHpBonus = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS hp_bonus FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP'`,
      [removed.rows[0].item_id]
    );
    await applyHpBonusDelta(playerId, -Number(removedHpBonus.rows[0].hp_bonus));

    const sinArmaAhora = await armas.habilidadesSinArma(playerId, await armas.armasDe(playerId)).catch(() => []);
    const avisoArmas = sinArmaAhora.filter((n) => !sinArmaAntes.includes(n));

    res.json({ slot, unequippedItemId: removed.rows[0].item_id, avisoArmas });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/quests/available
router.get('/:playerId/quests/available', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const playerResult = await db.query('SELECT level, rank, current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);

    const [questsResult, unlockedZoneIds, yaElegidas, porRival] = await Promise.all([
      db.query(
        `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
                q.min_level, q.max_level, q.min_rank_code, q.is_repeatable, q.repeat_cooldown_hours,
                q.difficulty_stars, q.description, q.npc_name, q.location_name, q.required_class_id,
                q.reputation_reward, q.gold_reward, q.xp_reward, q.requires_quest_id,
                q.is_personal, q.giver_npc, q.turn_in_npc, q.dialog,
                pqc.times_completed, pqc.last_completed_at,
                paq.id IS NOT NULL AS accepted,
                (q.requires_quest_id IS NULL OR prereq.quest_id IS NOT NULL) AS prerequisite_met
         FROM quests q
         LEFT JOIN monster_zones mz ON mz.id = q.zone_id
         LEFT JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
         LEFT JOIN player_active_quests paq ON paq.quest_id = q.id AND paq.player_id = $1
         LEFT JOIN player_quest_completions prereq ON prereq.quest_id = q.requires_quest_id AND prereq.player_id = $1
         WHERE q.quest_type != 'OCULTA'
         ORDER BY q.difficulty_stars DESC, q.zone_id, q.chain_position`,
        [playerId]
      ),
      getUnlockedZoneIds(playerId, player.level),
      eleccion.elegidas(playerId),
      eleccion.cumplidasPorRival(playerId),
    ]);
    // lo que sigue a una elección acepta cualquiera de las dos (lib/eleccion.js)
    for (const q of questsResult.rows) if (!q.prerequisite_met && porRival.has(q.requires_quest_id)) q.prerequisite_met = true;

    const dailiesToday = dailyPickIds(questsResult.rows.filter((q) => q.quest_type === 'DIARIA'
      && (!q.zone_id || unlockedZoneIds.has(q.zone_id))
      && (!q.required_class_id || classChain.includes(q.required_class_id))
      && (!q.min_rank_code || rankAtLeast(player.rank, q.min_rank_code))
      && q.prerequisite_met), playerId, player.level);
    const available = questsResult.rows.filter((q) => {
      if (q.quest_type === 'DIARIA' && !q.accepted && !dailiesToday.has(q.id)) return false;
      // Quests de zona sólo visibles si esa zona está desbloqueada
      if (q.zone_id && !unlockedZoneIds.has(q.zone_id)) return false;
      if (q.required_class_id && !classChain.includes(q.required_class_id)) return false;
      if (q.min_rank_code && !rankAtLeast(player.rank, q.min_rank_code)) return false;
      if (!q.prerequisite_met) return false;
      // elecciones de la historia: si ya elegiste la otra, esta no se ofrece (lib/eleccion.js)
      if (eleccion.tapada(q.code, yaElegidas)) return false;
      // Ya completada: si NO es repetible, no vuelve a aparecer nunca mas (es de 1 sola vez).
      // Si es repetible, se oculta solo mientras dure el cooldown desde la ultima entrega.
      if (q.times_completed) {
        if (!q.is_repeatable) return false;
        if (q.repeat_cooldown_hours) {
          const cooldownMs = q.repeat_cooldown_hours * 60 * 60 * 1000;
          if (Date.now() - new Date(q.last_completed_at).getTime() < cooldownMs) return false;
        }
      }
      return true;
    }).map((q) => ({ ...q, meets_level: !q.min_level || player.level >= q.min_level }));

    res.json(await questProgress.attachObjectives(playerId, available));
  } catch (error) {
    next(error);
  }
});

// Diarias sorteadas: cada jugador ve DAILY_PICKS diarias por día (como en un MMO), elegidas entre
// las que le sirven por nivel en sus zonas. El sorteo depende del día (UTC) y del jugador, así que
// durante el día son siempre las mismas aunque las entregue (no salen otras para farmear).
// Las que ya aceptó se siguen viendo hasta que las entregue o abandone.
const DAILY_PICKS = 3;
const DAILY_TRIVIAL_LEVELS = 6; // igual que TRIVIAL_LEVELS del front (game/questGivers.js)
function dailyPickIds(dailies, playerId, level) {
  const eligible = dailies
    .filter((q) => (!q.min_level || q.min_level <= level) && (!q.max_level || level <= q.max_level + DAILY_TRIVIAL_LEVELS))
    .sort((a, b) => a.id - b.id);
  // semilla: día + jugador (FNV-1a), barajado de Fisher-Yates con un generador simple
  let h = 2166136261;
  for (const ch of `${new Date().toISOString().slice(0, 10)}:${playerId}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return new Set(eligible.slice(0, DAILY_PICKS).map((q) => q.id));
}

// POST /api/players/:playerId/quests/:questId/accept
// Marca una quest como "en curso" para que aparezca en /quests/active (panel Quests del
// dashboard). Mismas validaciones que completarla, asi no se puede aceptar algo que de
// todas formas no se podria entregar (nivel/rango/cooldown).
router.post('/:playerId/quests/:questId/accept', async (req, res, next) => {
  const { playerId, questId } = req.params;

  try {
    const playerResult = await db.query('SELECT level, rank, current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const quest = await fetchQuestDetail(questId);
    if (!quest) return res.status(404).json({ error: 'Quest no encontrada' });

    if (quest.required_class_id) {
      const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
      if (!classChain.includes(quest.required_class_id)) {
        return res.status(403).json({ error: 'Esta misión es solo para tu clase' });
      }
    }
    if (quest.min_level && player.level < quest.min_level) {
      return res.status(400).json({ error: `Requiere nivel ${quest.min_level}` });
    }
    if (quest.min_rank_code && !rankAtLeast(player.rank, quest.min_rank_code)) {
      return res.status(400).json({ error: `Requiere rango ${quest.min_rank_code} o superior` });
    }
    // (lo que sigue a una elección acepta cualquiera de las dos: lib/eleccion.js)
    if (quest.requires_quest_id && !(await eleccion.previaCumplida(playerId, quest.requires_quest_id))) {
      return res.status(400).json({ error: 'Todavía no completaste la misión previa requerida' });
    }

    if (eleccion.tapada(quest.code, await eleccion.elegidas(playerId))) {
      return res.status(400).json({ error: 'Ya elegiste el otro camino: esta decisión es para siempre.' });
    }

    const completionResult = await db.query(
      'SELECT times_completed, last_completed_at FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    if (completionResult.rows.length) {
      if (!quest.is_repeatable) {
        return res.status(400).json({ error: 'Ya completaste esta misión (es de una sola vez)' });
      }
      if (quest.repeat_cooldown_hours) {
        const cooldownMs = quest.repeat_cooldown_hours * 60 * 60 * 1000;
        if (Date.now() - new Date(completionResult.rows[0].last_completed_at).getTime() < cooldownMs) {
          return res.status(400).json({ error: 'Esta quest diaria todavía está en cooldown' });
        }
      }
    }

    if (quest.quest_type === 'DIARIA') {
      // misma cuenta que GET /quests/available: solo se aceptan las diarias sorteadas para hoy
      const [unlocked, classChain] = await Promise.all([
        getUnlockedZoneIds(playerId, player.level),
        evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id),
      ]);
      const dailies = (await db.query(
        `SELECT q.id, q.zone_id, q.min_level, q.max_level, q.required_class_id, q.min_rank_code FROM quests q
         WHERE q.quest_type = 'DIARIA' AND (q.requires_quest_id IS NULL OR EXISTS (
           SELECT 1 FROM player_quest_completions c WHERE c.player_id = $1 AND c.quest_id = q.requires_quest_id))`,
        [playerId]
      )).rows.filter((q) => (!q.zone_id || unlocked.has(q.zone_id))
        && (!q.required_class_id || classChain.includes(q.required_class_id))
        && (!q.min_rank_code || rankAtLeast(player.rank, q.min_rank_code)));
      if (!dailyPickIds(dailies, playerId, player.level).has(quest.id)) {
        return res.status(400).json({ error: 'Esa diaria no está entre las de hoy. Mañana habrá otras.' });
      }
    }

    const already = await db.query(
      'SELECT 1 FROM player_active_quests WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    if (already.rows.length) {
      return res.status(400).json({ error: 'Ya aceptaste esta quest' });
    }

    await db.query('INSERT INTO player_active_quests(player_id, quest_id) VALUES ($1, $2)', [playerId, questId]);

    res.json({ acceptedQuestId: quest.id, name: quest.name });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/quests/active
// Quests aceptadas y todavia no entregadas (panel "Mis Quests" del dashboard).
router.get('/:playerId/quests/active', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const result = await db.query(
      `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
              q.min_level, q.max_level, q.min_rank_code, q.is_repeatable,
              q.difficulty_stars, q.description, q.npc_name, q.location_name,
              q.reputation_reward, q.gold_reward, q.xp_reward, paq.accepted_at,
              q.is_personal, q.giver_npc, q.turn_in_npc, q.dialog
       FROM player_active_quests paq
       JOIN quests q ON q.id = paq.quest_id
       LEFT JOIN monster_zones mz ON mz.id = q.zone_id
       WHERE paq.player_id = $1
       ORDER BY paq.accepted_at`,
      [playerId]
    );
    res.json(await questProgress.attachObjectives(playerId, result.rows));
  } catch (error) {
    next(error);
  }
});

// Valida que los objetivos de la quest (quest_objectives) ya se cumplieron antes de pagar
// recompensas. KILL_MONSTER/DEFEAT_BOSS/KILL_ANY_IN_ZONE se miran contra player_quest_progress
// (que combat.js llena via lib/questProgress.js al ganar peleas); COLLECT_ITEM se mira directo
// contra player_inventory porque ese conteo ya existe ahi. Las OCULTA no tienen quest_objectives
// (su condicion vive en quest_hidden_requirements, ver seed.sql) asi que no entran a este loop.
async function findUnmetObjective(playerId, quest) {
  if (!quest.objectives.length) return null;

  const progressByObjectiveId = await questProgress.getProgressForQuest(playerId, quest.id);

  for (const objective of quest.objectives) {
    if (objective.objective_type === 'COLLECT_ITEM') {
      const have = await inventory.getQuantity(playerId, objective.item_id);
      if (have < objective.target_count) return objective;
    } else {
      const current = progressByObjectiveId.get(objective.objective_id) || 0;
      if (current < objective.target_count) return objective;
    }
  }
  return null;
}

// POST /api/players/:playerId/quests/:questId/complete
router.post('/:playerId/quests/:questId/complete', async (req, res, next) => {
  const { playerId, questId } = req.params;

  try {
    const playerResult = await db.query('SELECT level, rank, xp, gold, reputation, current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const quest = await fetchQuestDetail(questId);
    if (!quest) return res.status(404).json({ error: 'Quest no encontrada' });

    if (quest.required_class_id) {
      const classChain = await evolution.getClassAncestorChain(player.evolution_class_id || player.current_class_id);
      if (!classChain.includes(quest.required_class_id)) {
        return res.status(403).json({ error: 'Esta misión es solo para tu clase' });
      }
    }
    if (quest.min_level && player.level < quest.min_level) {
      return res.status(400).json({ error: `Requiere nivel ${quest.min_level}` });
    }
    if (quest.min_rank_code && !rankAtLeast(player.rank, quest.min_rank_code)) {
      return res.status(400).json({ error: `Requiere rango ${quest.min_rank_code} o superior` });
    }
    // (lo que sigue a una elección acepta cualquiera de las dos: lib/eleccion.js)
    if (quest.requires_quest_id && !(await eleccion.previaCumplida(playerId, quest.requires_quest_id))) {
      return res.status(400).json({ error: 'Todavía no completaste la misión previa requerida' });
    }

    const completionResult = await db.query(
      'SELECT times_completed, last_completed_at FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );

    if (completionResult.rows.length) {
      if (!quest.is_repeatable) {
        return res.status(400).json({ error: 'Ya completaste esta misión (es de una sola vez)' });
      }
      if (quest.repeat_cooldown_hours) {
        const cooldownMs = quest.repeat_cooldown_hours * 60 * 60 * 1000;
        if (Date.now() - new Date(completionResult.rows[0].last_completed_at).getTime() < cooldownMs) {
          return res.status(400).json({ error: 'Esta quest diaria todavía está en cooldown' });
        }
      }
    }

    const unmetObjective = await findUnmetObjective(playerId, quest);
    if (unmetObjective) {
      return res.status(400).json({
        error: `Objetivo incompleto: ${unmetObjective.description || 'todavía faltan requisitos por cumplir'}`,
      });
    }
    // misiones de historia: se entregan en persona a quien corresponde
    if (quest.turn_in_npc && !req.bot) {
      const home = questSteps.NPC_HOMES[quest.turn_in_npc];
      if (home && !cercaDe(playerId, home.zone, home.x, home.y, 5)) {
        return res.status(403).json({ error: `Entrégale esta misión a ${home.name} en persona.`, lejos: true });
      }
    }
    // misiones de entregar objetos (COLLECT_ITEM): al entregarlas se los lleva el NPC. Antes solo
    // se miraba que los tuvieras, así que las diarias repetibles se cobraban siempre con los mismos.
    for (const o of quest.objectives.filter((x) => x.objective_type === 'COLLECT_ITEM' && x.item_id)) {
      await inventory.removeItem(playerId, o.item_id, o.target_count, 0, null);
    }

    // El bonus de XP/oro lo da el rango que el jugador tiene AL COMPLETAR la quest (antes de
    // que esta misma entrega lo suba de rango), igual que xpBonus/moneyBonus en
    // GET /api/player/:id/reputation.
    const { xpBonusPercent, rewardBonusPercent } = await getRankBonuses(player.rank);
    const questAchBonuses = await achievements.getPlayerBonuses(playerId);
    const bonusedGold = applyPercentBonus(applyPercentBonus(quest.gold_reward, rewardBonusPercent), questAchBonuses.goldEarned);
    const bonusedXp = applyPercentBonus(applyPercentBonus(quest.xp_reward, xpBonusPercent), questAchBonuses.xpEarned);

    const newGold = Number(player.gold) + bonusedGold;
    const newReputation = Number(player.reputation) + quest.reputation_reward;
    const newRank = await getRankForReputation(newReputation);

    await db.query(
      'UPDATE players SET gold = $1, reputation = $2, rank = $3, updated_at = now() WHERE id = $4',
      [newGold, newReputation, newRank, playerId]
    );
    if (quest.is_boss_quest) {
      await db.query('UPDATE players SET boss_kills = boss_kills + 1 WHERE id = $1', [playerId]);
      await incrementCounter(playerId, 'JEFES_FINALES_MUERTOS');
    }
    const isCombatQuest = quest.objectives?.some((o) =>
      ['KILL_MONSTER', 'KILL_ANY_IN_ZONE', 'DEFEAT_BOSS'].includes(o.objective_type));
    if (isCombatQuest) await incrementCounter(playerId, 'MISIONES_COMBATE_COMPLETADAS');

    const levelResult = await leveling.applyXpGain(playerId, bonusedXp);

    // NPCs del grupo activo también reciben XP de la quest (mismo reparto que combate).
    const questPartyRes = await db.query(
      `SELECT pn.id AS npc_id, pn.name
       FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = $1`,
      [playerId]
    );
    const questNpcLevelUps = [];
    if (questPartyRes.rows.length > 0) {
      const questPartySize = 1 + questPartyRes.rows.length;
      const npcQuestXp = Math.floor(bonusedXp / questPartySize);
      for (const npc of questPartyRes.rows) {
        const npcResult = await leveling.applyNpcXpGain(npc.npc_id, npcQuestXp);
        if (npcResult && npcResult.leveledUp) {
          questNpcLevelUps.push({ npcId: npc.npc_id, npcName: npc.name, newLevel: npcResult.newLevel });
        }
      }
    }

    await db.query(
      `INSERT INTO player_quest_completions(player_id, quest_id, times_completed, last_completed_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (player_id, quest_id)
       DO UPDATE SET times_completed = player_quest_completions.times_completed + 1, last_completed_at = now()`,
      [playerId, questId]
    );
    await db.query('DELETE FROM player_active_quests WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
    // progreso y objetos de misión (la llave, las cartas…): ya no hacen falta
    await questSteps.resetQuestState(playerId, questId);

    for (const reward of quest.itemRewards) {
      await inventory.addItem(playerId, reward.item_id, reward.quantity);
    }

    const timesCompletedRes = await db.query(
      'SELECT times_completed FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    const timesCompleted = timesCompletedRes.rows[0]?.times_completed || 1;
    const unlockedAchievements = await achievements.checkQuestAchievements(playerId, questId, timesCompleted);
    // los logros nuevos (lib/logros.js): historia, elecciones, Trueno…
    const logrosNuevos = await logros.revisarSeguro(playerId);

    res.json({
      questCompleted: quest.name,
      xpGained: bonusedXp,
      goldGained: bonusedGold,
      reputationGained: quest.reputation_reward,
      rankBonusApplied: { xpBonusPercent, rewardBonusPercent },
      newRank,
      leveledUp: levelResult ? levelResult.leveledUp : false,
      newLevel: levelResult ? levelResult.newLevel : undefined,
      itemsGained: quest.itemRewards,
      npcLevelUps: questNpcLevelUps,
      unlockedAchievements: unlockedAchievements.map((a) => ({
        code: a.code,
        name: a.name,
        description: a.description,
        bonusCategory: a.bonus_category,
        bonusPercent: a.bonus_percent,
      })),
      logros: logrosNuevos,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/player/:playerId/quests/:questId/abandon
// Abandona una quest activa: borra el registro de player_active_quests y limpia el progreso
// de objetivos. El desbloqueo de zona depende de player_monster_kills (kill real, ver
// getUnlockedZoneIds más arriba), no de esta quest, así que también se puede abandonar la
// de jefe PRINCIPAL sin trabar el avance.
router.delete('/:playerId/quests/:questId/abandon', async (req, res, next) => {
  const { playerId, questId } = req.params;
  try {
    const activeResult = await db.query(
      'SELECT 1 FROM player_active_quests WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    if (!activeResult.rows.length) {
      return res.status(400).json({ error: 'No tienes esa quest activa' });
    }

    const questResult = await db.query(
      'SELECT name FROM quests WHERE id = $1',
      [questId]
    );
    if (!questResult.rows.length) return res.status(404).json({ error: 'Quest no encontrada' });
    const quest = questResult.rows[0];

    await db.query('DELETE FROM player_active_quests WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
    await questSteps.resetQuestState(playerId, questId);

    res.json({ abandoned: true, questName: quest.name });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/quests/:questId/reset
// Reiniciar una misión trabada: vuelve al primer paso (sin progreso, sin sus objetos de misión)
// y sigue aceptada. Es la salida segura si algo raro pasó a mitad de camino.
router.post('/:playerId/quests/:questId/reset', async (req, res, next) => {
  const { playerId, questId } = req.params;
  try {
    const active = await db.query(
      `SELECT q.name FROM player_active_quests paq JOIN quests q ON q.id = paq.quest_id
       WHERE paq.player_id = $1 AND paq.quest_id = $2`,
      [playerId, questId]
    );
    if (!active.rows.length) return res.status(400).json({ error: 'No tienes esa misión activa' });
    await questSteps.resetQuestState(playerId, questId);
    res.json({ reset: true, questName: active.rows[0].name });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/quests/interact  { kind: 'TALK'|'VISIT'|'INVESTIGATE'|'AMBUSH', target }
// El mundo avisa que hablaste con un NPC, llegaste a un lugar, examinaste algo o caíste en una
// emboscada; el servidor comprueba que estés ahí y en ese paso de la misión (lib/questSteps.js).
router.post('/:playerId/quests/interact', async (req, res, next) => {
  const { playerId } = req.params;
  const kind = String(req.body?.kind ?? '');
  if (!['TALK', 'VISIT', 'INVESTIGATE', 'AMBUSH', 'ESCORT'].includes(kind) || req.body?.target == null) {
    return res.status(400).json({ error: 'Interacción inválida' });
  }
  try {
    res.json(await questSteps.interact(playerId, { kind, target: req.body.target }));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/quests/npc-spots — NPCs que una misión tuya movió de lugar
router.get('/:playerId/quests/npc-spots', async (req, res, next) => {
  try {
    res.json(await questSteps.npcSpotsFor(req.params.playerId));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/quests/completed
// Historial de quests completadas: cuántas veces y cuándo fue la última entrega.
// Ordenado por última completada desc (las más recientes primero).
router.get('/:playerId/quests/completed', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
              q.difficulty_stars, q.is_repeatable, q.repeat_cooldown_hours,
              q.reputation_reward, q.gold_reward, q.xp_reward,
              q.npc_name, q.location_name,
              pqc.times_completed, pqc.last_completed_at
       FROM player_quest_completions pqc
       JOIN quests q ON q.id = pqc.quest_id
       LEFT JOIN monster_zones mz ON mz.id = q.zone_id
       WHERE pqc.player_id = $1
       ORDER BY pqc.last_completed_at DESC`,
      [playerId]
    );

    const rewardsResult = await db.query(
      `SELECT qir.quest_id, i.name AS item_name, i.code AS item_code, qir.quantity
       FROM quest_item_rewards qir
       JOIN items i ON i.id = qir.item_id
       WHERE qir.quest_id = ANY($1::int[])`,
      [result.rows.map((q) => q.id)]
    );
    const rewardsByQuestId = new Map();
    for (const r of rewardsResult.rows) {
      if (!rewardsByQuestId.has(r.quest_id)) rewardsByQuestId.set(r.quest_id, []);
      rewardsByQuestId.get(r.quest_id).push({ itemCode: r.item_code, itemName: r.item_name, quantity: r.quantity });
    }

    res.json(result.rows.map((q) => ({
      id: q.id,
      code: q.code,
      name: q.name,
      questType: q.quest_type,
      zoneName: q.zone_name,
      difficultyStar: q.difficulty_stars,
      isRepeatable: q.is_repeatable,
      repeatCooldownHours: q.repeat_cooldown_hours,
      rewards: {
        reputation: q.reputation_reward,
        gold: q.gold_reward,
        xp: q.xp_reward,
        items: rewardsByQuestId.get(q.id) || [],
      },
      npcName: q.npc_name,
      locationName: q.location_name,
      timesCompleted: q.times_completed,
      lastCompletedAt: q.last_completed_at,
    })));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/logros — la ventana de Logros (lib/logros.js): los 62 con su avance, los grupos,
// los Puntos de Gesta con sus hitos y el título equipado. Antes revisa los que falten (así se dan los que
// se ganaron antes de que existieran).
router.get('/:playerId/logros', async (req, res, next) => {
  try { res.json(await logros.estado(Number(req.params.playerId))); } catch (error) { next(error); }
});
// POST /api/player/:playerId/logros/titulo { code } — equipa el título de un logro ganado (code null: lo quita)
router.post('/:playerId/logros/titulo', async (req, res, next) => {
  try {
    const r = await logros.equiparTitulo(Number(req.params.playerId), req.body?.code ? String(req.body.code) : null);
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/achievements
// Lista todos los logros del juego con estado desbloqueado/bloqueado para el jugador.
// Incluye progreso de completaciones de la quest asociada para los bloqueados.
router.get('/:playerId/achievements', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT a.id, a.code, a.name, a.description,
              a.threshold, a.bonus_type, a.bonus_category, a.bonus_percent,
              pa.unlocked_at,
              pqc.times_completed
       FROM achievements a
       LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
       LEFT JOIN player_quest_completions pqc ON pqc.quest_id = a.quest_id AND pqc.player_id = $1
       ORDER BY a.id`,
      [playerId]
    );
    res.json(result.rows.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      description: a.description,
      threshold: a.threshold,
      bonus: { type: a.bonus_type, category: a.bonus_category, percent: a.bonus_percent },
      unlocked: !!a.unlocked_at,
      unlockedAt: a.unlocked_at,
      progress: { current: Number(a.times_completed || 0), required: a.threshold },
    })));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/craft/available
// Solo recetas de zonas desbloqueadas: las básicas que ya DESCUBRIÓ (lib/recetas.js) y las de
// pergamino que ya aprendió. Incluye para cada ingrediente cuánto tiene vs cuánto necesita.
// Con ?libro=1 (el Taller del mundo) además vienen las de pergamino todavía sin aprender, de
// todas las clases (locked, con de dónde sale el pergamino) y una fila "hidden" por cada básica sin
// descubrir (sin nombre: solo su categoría, para contar "4 por descubrir").
// GET /api/player/:playerId/craft/stations — ¿estás junto a una forja / al Pilar? (null = sí; si no,
// el aviso). El taller lo pregunta cada pocos segundos mientras está abierto (es barato, a
// diferencia de /craft/available que arma todas las recetas).
router.get('/:playerId/craft/stations', (req, res) => {
  res.json({ forja: stationProblem(req.params.playerId, 'forja'), pilar: stationProblem(req.params.playerId, 'pilar') });
});

router.get('/:playerId/craft/available', async (req, res, next) => {
  const { playerId } = req.params;
  const libro = req.query.libro === '1';
  try {
    await recetas.ensureBook(playerId);
    const recipesResult = await db.query(
      `SELECT cr.id, cr.code, i.name AS result_name, cr.result_quantity, cr.station,
              cr.rarity, cr.success_rate_percent, cr.artisan_name, cr.description,
              cr.scroll_item_id, si.name AS scroll_item_name, si.code AS scroll_item_code,
              cr.required_class_id, c.name AS required_class_name, c.code AS required_class_code,
              i.item_type AS result_item_type, i.id AS result_item_id, i.slot AS result_slot, i.required_level, i.is_two_handed,
              i.rarity AS result_rarity, pk.recipe_id IS NOT NULL AS known, COALESCE(pk.seen, TRUE) AS seen,
              EXISTS (SELECT 1 FROM player_learned_recipes plr WHERE plr.player_id = $1 AND plr.recipe_id = cr.id) AS learned
       FROM crafting_recipes cr
       JOIN items i ON i.id = cr.result_item_id
       LEFT JOIN items si ON si.id = cr.scroll_item_id
       LEFT JOIN classes c ON c.id = cr.required_class_id
       LEFT JOIN player_known_recipes pk ON pk.player_id = $1 AND pk.recipe_id = cr.id
       WHERE (cr.zone_id IS NULL OR cr.zone_id IN (
         SELECT zone_id FROM player_zone_unlocks WHERE player_id = $1
       ))
       ORDER BY cr.rarity, i.name`,
      [playerId]
    );
    // las de pergamino sin aprender se muestran con candado, de TODAS las clases (como en los MMO, se
    // puede fabricar equipo de otra clase para venderlo o regalarlo; cada una en la pestaña de su clase)
    // de dónde sale cada pergamino (los monstruos que lo sueltan y con qué probabilidad)
    const scrollIds = [...new Set(recipesResult.rows.filter((r) => r.scroll_item_id && !r.learned).map((r) => r.scroll_item_id))];
    const scrollSources = new Map();
    if (libro && scrollIds.length) {
      // solo jefes de zonas que ya tiene abiertas (las recetas sin zona no adelantan las que vienen)
      const src = await db.query(
        `SELECT d.item_id, m.name, d.drop_chance_percent::float AS pct, s.rarity
         FROM monster_drops d JOIN monsters m ON m.id = d.monster_id JOIN items s ON s.id = d.item_id
         WHERE d.item_id = ANY($1::int[])
           AND (m.zone_id IS NULL OR m.zone_id IN (SELECT zone_id FROM player_zone_unlocks WHERE player_id = $2))
         ORDER BY d.drop_chance_percent DESC`,
        [scrollIds, playerId]
      );
      for (const r of src.rows) {
        if (!scrollSources.has(r.item_id)) scrollSources.set(r.item_id, []);
        // pieza del set: la misma tabla que routes/combat.js (PIECE_CHANCE)
        scrollSources.get(r.item_id).push({ monster: r.name, chance: r.pct, pieceChance: r.rarity === 'LEGENDARIO' ? 22.5 : 27.5 });
      }
    }
    const hidden = [];

    // ¿estás en una forja / junto al Pilar? (una vez por lugar, no por receta)
    const stationNote = {};
    for (const st of Object.keys(SERVICIOS).filter((k) => k === 'forja' || k === 'pilar')) stationNote[st] = stationProblem(playerId, st);
    const festival = isFestival();
    // el nivel del héroe: el Taller avisa del equipo que todavía no se puede poner
    const heroLevel = Number((await db.query('SELECT level FROM players WHERE id = $1', [playerId])).rows[0]?.level ?? 1);
    // las piezas de set de jefe de TU clase salen el doble (routes/combat.js OWN_CLASS_SCROLL_MULT):
    // el Taller muestra la probabilidad que de verdad tienes
    const pc = (await db.query('SELECT current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId])).rows[0];
    const heroChainIds = await evolution.getClassAncestorChain(pc?.evolution_class_id || pc?.current_class_id);
    const heroClassCodes = new Set((await db.query('SELECT code FROM classes WHERE id = ANY($1::int[])', [heroChainIds])).rows.map((r) => r.code));
    // para comparar con lo que llevas puesto: las stats de cada pieza y las de tu equipo (con su calidad
    // y encantamiento, lo que de verdad te da)
    const eqIds = [...new Set(recipesResult.rows.filter((r) => r.result_item_type === 'EQUIPMENT').map((r) => r.result_item_id))];
    const statsOf = new Map();
    if (eqIds.length) {
      const st = await db.query(
        'SELECT item_id, stat_code, amount::float AS amount, is_percent FROM item_stat_bonuses WHERE item_id = ANY($1::int[]) ORDER BY id',
        [eqIds]
      );
      for (const r of st.rows) {
        if (!statsOf.has(r.item_id)) statsOf.set(r.item_id, []);
        statsOf.get(r.item_id).push({ stat: r.stat_code, amount: r.amount, percent: r.is_percent });
      }
    }
    const worn = {};
    for (const r of (await db.query(
      `SELECT pe.slot, i.name, i.is_two_handed, pe.quality_tier, pe.enchant_level, b.stat_code, b.amount::float AS amount, b.is_percent
       FROM player_equipment pe JOIN items i ON i.id = pe.item_id LEFT JOIN item_stat_bonuses b ON b.item_id = pe.item_id
       WHERE pe.player_id = $1 ORDER BY b.id`,
      [playerId]
    )).rows) {
      const w = (worn[r.slot] ??= { name: r.name, twoHanded: r.is_two_handed, stats: [] });
      const mult = (1 + (r.enchant_level || 0) * 0.05) * (EQUIP_QUALITY_MULT[r.quality_tier || 0] ?? 1);
      if (r.stat_code) w.stats.push({ stat: r.stat_code, amount: Math.round(r.amount * mult * 10) / 10, percent: r.is_percent });
    }
    // lo que dejarías de llevar al ponerte esa pieza (un arma a dos manos también quita la mano izquierda)
    const replaced = (slot, twoHanded) => {
      const list = [worn[slot], twoHanded && slot === 'WEAPON' ? worn.OFFHAND : null,
        slot === 'OFFHAND' && worn.WEAPON?.twoHanded ? worn.WEAPON : null].filter(Boolean);
      return list.length ? { names: list.map((w) => w.name), stats: list.flatMap((w) => w.stats) } : null;
    };
    const available = [];
    for (const recipe of recipesResult.rows) {
      const isScroll = !!recipe.scroll_item_id;
      const locked = isScroll && !recipe.learned;
      // básica sin descubrir: no se muestra (el Taller del mundo la cuenta como "por descubrir")
      if (!isScroll && !recipe.known) {
        if (libro) hidden.push({ hidden: true, classCode: recipe.required_class_code, resultType: recipe.result_item_type });
        continue;
      }
      // con candado: con su pergamino al alcance (lo suelta un jefe de una zona que ya abriste)
      if (locked && (!libro || !scrollSources.has(recipe.scroll_item_id))) continue;
      // un arma única de otra clase (la Lágrima de Aethra): no se puede hacer, no se muestra (ver lib/recetas.js)
      if (recipe.result_rarity === 'UNICO' && recipe.required_class_code && !heroClassCodes.has(recipe.required_class_code)) continue;
      const ingredients = await db.query(
        `SELECT ri.item_id, it.name AS item_name, ri.quantity
         FROM crafting_recipe_ingredients ri
         JOIN items it ON it.id = ri.item_id
         WHERE ri.recipe_id = $1`,
        [recipe.id]
      );

      const ingredientStatus = await Promise.all(
        ingredients.rows.map(async (ing) => {
          const have = await inventory.getQuantity(playerId, ing.item_id);
          return { itemId: ing.item_id, itemName: ing.item_name, need: ing.quantity, have };
        })
      );

      const canCraft = ingredientStatus.every((i) => i.have >= i.need);
      available.push({
        id: recipe.id,
        code: recipe.code,
        resultName: recipe.result_name,
        resultQuantity: recipe.station === 'pilar' && festival ? recipe.result_quantity * 2 : recipe.result_quantity,
        resultType: recipe.result_item_type,
        // dónde se fabrica y si estás ahí (stationNote: el aviso si no)
        station: recipe.station,
        stationNote: recipe.station ? stationNote[recipe.station] ?? null : null,
        resultItemId: recipe.result_item_id,
        resultSlot: recipe.result_slot,
        twoHanded: !!recipe.is_two_handed,
        resultStats: statsOf.get(recipe.result_item_id) ?? null,
        equipped: recipe.result_item_type === 'EQUIPMENT' ? replaced(recipe.result_slot, recipe.is_two_handed) : null,
        // nivel para equiparlo (solo el equipo; levelOk: el héroe ya lo alcanza)
        requiredLevel: recipe.result_item_type === 'EQUIPMENT' ? Number(recipe.required_level) || null : null,
        levelOk: recipe.result_item_type !== 'EQUIPMENT' || heroLevel >= (Number(recipe.required_level) || 1),
        rarity: recipe.rarity,
        successRate: Number(recipe.success_rate_percent),
        // lo que cobra el artesano por fabricar una (solo el equipo; lib/precios.js)
        goldCost: recipe.result_item_type === 'EQUIPMENT' ? precios.fabricarOro(recipe.required_level, recipe.rarity) : 0,
        artisanName: recipe.artisan_name,
        description: recipe.description,
        classId: recipe.required_class_id,
        // los accesorios de jefe no tienen clase: la dice su pergamino (…_MAGO), así salen en esa pestaña
        className: recipe.required_class_name ?? SCROLL_CLASS_NAME[scrollClassOf(recipe)] ?? null,
        classCode: recipe.required_class_code ?? scrollClassOf(recipe),
        // equipo de otra clase: se puede fabricar (para venderlo o regalarlo), pero tú no te lo puedes equipar
        otherClass: recipe.result_item_type === 'EQUIPMENT' && !!(recipe.required_class_code ?? scrollClassOf(recipe))
          && !heroClassCodes.has(recipe.required_class_code ?? scrollClassOf(recipe)),
        canCraft: canCraft && !locked,
        ingredients: ingredientStatus,
        // libro de recetas: "NUEVO" hasta que la abre (también las de set de jefe recién aprendidas);
        // candado si es de set de jefe y todavía no conseguiste ninguna pieza
        isNew: !recipe.seen && (!isScroll || recipe.learned),
        locked,
        scrollName: locked ? recipe.scroll_item_name : null,
        // quién suelta piezas de este set y con qué probabilidad para ti
        scrollSources: locked
          ? (scrollSources.get(recipe.scroll_item_id) ?? []).map((s) => ({
            ...s,
            chance: Math.min(100, Math.round(s.chance * (heroClassCodes.has(scrollClassOf(recipe)) ? 2 : 1) * 10) / 10),
            pieceChance: Math.min(100, Math.round(s.pieceChance * (heroClassCodes.has(scrollClassOf(recipe)) ? 2 : 1) * 10) / 10),
          }))
          : null,
      });
    }

    res.json(libro ? [...available, ...hidden] : available);
  } catch (error) {
    next(error);
  }
});

// clase de una receta de pergamino sin clase propia, según el código del pergamino (SCROLL_X_MAGO)
const SCROLL_CLASS_NAME = { GUERRERO: 'Guerrero', MAGO: 'Mago', ARQUERO: 'Arquero', PICARO: 'Pícaro', SACERDOTE: 'Sacerdote' };
const scrollClassOf = (r) => String(r.scroll_item_code ?? '').match(/_(GUERRERO|MAGO|ARQUERO|PICARO|SACERDOTE)$/)?.[1] ?? null;

// GET /api/player/:playerId/craft/fuentes/:itemId — de dónde sale un material: monstruos que lo
// sueltan (con su %), recursos del mapa, si se fabrica y si se compra. El Taller lo pide al tocar
// «¿Dónde?» en un material (lib/fuentes.js; no nombra lo de zonas que todavía no abriste).
router.get('/:playerId/craft/fuentes/:itemId', async (req, res, next) => {
  try {
    const id = Number(req.params.itemId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Ese material no existe' });
    const sources = await fuentes.sourcesForItems(req.params.playerId, [id]);
    res.json(sources.get(id) ?? null);
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/craft/novedades — crafteos descubiertos que todavía no se avisaron
// (el mundo lo pregunta cuando cambia la mochila: "¡Descubriste un crafteo nuevo!")
router.get('/:playerId/craft/novedades', async (req, res, next) => {
  try { res.json({ discovered: await recetas.novedades(req.params.playerId) }); } catch (error) { next(error); }
});
// POST /api/player/:playerId/craft/seen { recipeCode } — la abrió en el Taller: ya no es "NUEVO"
router.post('/:playerId/craft/seen', async (req, res, next) => {
  try {
    await recetas.markSeen(req.params.playerId, String(req.body?.recipeCode ?? ''));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// POST /api/players/:playerId/craft
// body: { recipeCode, quantity? }  — quantity por defecto 1, máx 99
router.post('/:playerId/craft', async (req, res, next) => {
  const { playerId } = req.params;
  const { recipeCode } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!recipeCode) {
    return res.status(400).json({ error: 'recipeCode es requerido' });
  }

  try {
    const recipeResult = await db.query(
      `SELECT cr.id, cr.result_item_id, i.name AS result_name, i.item_type AS result_item_type, cr.result_quantity,
              cr.rarity, cr.success_rate_percent, cr.zone_id, cr.scroll_item_id, cr.station, i.required_level AS result_level
       FROM crafting_recipes cr
       JOIN items i ON i.id = cr.result_item_id
       WHERE cr.code = $1`,
      [recipeCode]
    );
    if (!recipeResult.rows.length) {
      return res.status(404).json({ error: 'Receta no encontrada' });
    }
    const recipe = recipeResult.rows[0];

    // el equipo se fabrica en una forja y el agua en el Pilar; lo demás en cualquier lado
    const lejos = req.bot ? null : stationProblem(playerId, recipe.station);
    if (lejos) return res.status(403).json({ error: lejos, lejos: true });
    // Festival de Aethra (domingos): cada frasco llenado en el Pilar rinde el doble
    if (recipe.station === 'pilar' && isFestival()) recipe.result_quantity *= 2;

    // Verificar zona desbloqueada
    if (recipe.zone_id) {
      const zoneCheck = await db.query(
        `SELECT 1 FROM player_zone_unlocks WHERE player_id = $1 AND zone_id = $2`,
        [playerId, recipe.zone_id]
      );
      if (!zoneCheck.rows.length) {
        return res.status(403).json({ error: 'Zona no desbloqueada. Vence monstruos de esa zona primero.' });
      }
    }

    // Verificar receta scroll aprendida
    if (recipe.scroll_item_id) {
      const learnedCheck = await db.query(
        `SELECT 1 FROM player_learned_recipes WHERE player_id = $1 AND recipe_id = $2`,
        [playerId, recipe.id]
      );
      if (!learnedCheck.rows.length) {
        return res.status(403).json({ error: 'Receta no aprendida. Consigue el drop del MINIBOSS correspondiente.' });
      }
    }

    const ingredients = await db.query(
      `SELECT ri.item_id, i.name AS item_name, ri.quantity
       FROM crafting_recipe_ingredients ri
       JOIN items i ON i.id = ri.item_id
       WHERE ri.recipe_id = $1`,
      [recipe.id]
    );

    // el trabajo del artesano: el equipo cuesta oro según su rareza y su nivel (lib/precios.js), por intento
    const goldCost = recipe.result_item_type === 'EQUIPMENT' ? precios.fabricarOro(recipe.result_level, recipe.rarity) * qty : 0;
    if (goldCost > 0) {
      const g = Number((await db.query('SELECT gold FROM players WHERE id = $1', [playerId])).rows[0]?.gold ?? 0);
      if (g < goldCost) return res.status(400).json({ error: `El artesano cobra ${goldCost.toLocaleString('es')} de oro por su trabajo. Tienes ${g.toLocaleString('es')}.` });
    }

    for (const ingredient of ingredients.rows) {
      const have = await inventory.getQuantity(playerId, ingredient.item_id);
      if (have < ingredient.quantity * qty) {
        return res.status(400).json({
          error: `Materiales insuficientes: necesitas ${ingredient.quantity * qty} x ${ingredient.item_name} (tienes ${have})`,
          missingItemId: ingredient.item_id,
        });
      }
    }

    // Luck total: base del jugador + equipo + pasivas del heroe + pasivas de NPCs en el grupo.
    const playerLuckRow = await db.query(
      'SELECT luck, current_class_id, evolution_class_id, level FROM players WHERE id = $1',
      [playerId]
    );
    const pd = playerLuckRow.rows[0] || {};
    const equipBonus = await getEquipmentBonuses(playerId);
    const heroChain = await evolution.getClassAncestorChain(pd.evolution_class_id || pd.current_class_id);
    const heroPassives = await getClassPassiveBonuses(heroChain, pd.level);
    const partyNpcs = await db.query(
      `SELECT pn.class_id, pn.level FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = $1`,
      [playerId]
    );
    let partyLuck = 0;
    for (const npc of partyNpcs.rows) {
      const np = await getClassPassiveBonuses(npc.class_id, npc.level);
      partyLuck += np.luck || 0;
    }
    const totalLuck = Number(pd.luck || 0) + (equipBonus.luck || 0) + (heroPassives.luck || 0) + partyLuck;

    const RARITY_NAMES = ['COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO'];
    const baseRarityIdx = RARITY_NAMES.indexOf(recipe.rarity);

    // Roll independiente por cada unidad: éxito + luck por separado.
    // tierCounts[t] = cuántas unidades salieron con quality_tier=t.
    const tierCounts = {};
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < qty; i++) {
      if (Math.random() * 100 >= Number(recipe.success_rate_percent)) { failCount++; continue; }
      successCount++;
      let tier = 0;
      if (totalLuck > 0 && baseRarityIdx < 4) {
        const maxJumps = 4 - baseRarityIdx;
        let currentChance = totalLuck;
        while (tier < maxJumps && Math.random() * 100 < currentChance) {
          tier++;
          currentChance *= 0.5;
        }
      }
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
    const success = successCount > 0 || failCount < qty;

    // Consumir ingredientes y entregar el resultado en una sola transaccion -- antes cada
    // removeItem/addItem confirmaba por separado, asi que un fallo a mitad del loop podia dejar
    // los ingredientes descontados sin haber entregado el item crafteado.
    const client = await db.pool.connect();
    const results = [];
    // lo que se perdió en los intentos fallidos (el taller lo muestra al fallar)
    const lost = [];
    try {
      await client.query('BEGIN');
      if (goldCost > 0) {
        const paid = await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold', [goldCost, playerId]);
        if (!paid.rows.length) throw Object.assign(new Error('No te alcanza el oro para pagarle al artesano'), { status: 400, expose: true });
      }
      // Ingredientes: los exitosos consumen cantidad completa, los fallidos consumen % según rareza.
      for (const ingredient of ingredients.rows) {
        const successCost = ingredient.quantity * successCount;
        const failCost = calcFailLoss(ingredient.quantity * failCount, FAILURE_LOSS_PERCENT[recipe.rarity] ?? 0);
        if (failCost > 0) lost.push({ name: ingredient.item_name, quantity: failCost });
        if (successCost + failCost > 0) await inventory.removeItem(playerId, ingredient.item_id, successCost + failCost, 0, null, client);
      }

      // Agregar al inventario agrupado por tier
      for (const [tier, count] of Object.entries(tierCounts)) {
        const t = Number(tier);
        const gained = recipe.result_quantity * count;
        await inventory.addItem(playerId, recipe.result_item_id, gained, 0, t, client);
        results.push({ qualityTier: t, quantity: gained, rarity: RARITY_NAMES[Math.min(baseRarityIdx + t, 4)] });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const totalGained = recipe.result_quantity * successCount;
    if (totalGained > 0) await questSteps.registerCraft(playerId, recipe.result_item_id, totalGained);
    const luckyCount = Object.entries(tierCounts).filter(([t]) => Number(t) > 0).reduce((s, [, c]) => s + c, 0);

    if (totalGained > 0 && recipe.result_item_type === 'CONSUMABLE') {
      await incrementCounter(playerId, 'POCIONES_CRAFTEADAS', totalGained);
    }
    // logros de artesanía (lib/logros.js)
    if (totalGained > 0) {
      await incrementCounter(playerId, 'OBJETOS_FABRICADOS', totalGained);
      if (recipe.rarity === 'LEGENDARIO') await incrementCounter(playerId, 'LEGENDARIOS_FABRICADOS', successCount);
      if (String(recipeCode).startsWith('RECETA_LAGRIMA_')) await incrementCounter(playerId, 'LAGRIMA_FORJADA');
    }
    const logrosNuevos = totalGained > 0 ? await logros.revisarSeguro(playerId) : [];

    if (totalGained > 0) {
      const classRes = await db.query(
        'SELECT COALESCE(evolution_class_id, current_class_id) AS class_id, luck FROM players WHERE id = $1',
        [playerId]
      );
      const craftInnate = await applyInnateTrigger('ON_CRAFT', {
        actor: { class_id: classRes.rows[0]?.class_id, luck: classRes.rows[0]?.luck }, target: null, allies: [], enemies: [],
      });
      // Alquimia Sagrada: el motor no soporta "potencia" variable por ítem crafteado todavía, así
      // que se aproxima con unidades extra (redondeado hacia arriba) en vez de +% de efecto.
      if (craftInnate?.extra_json?.effect === 'potion_potency_bonus') {
        const bonusQty = Math.ceil(totalGained * Number(craftInnate.percent_amount || 0) / 100);
        if (bonusQty > 0) await inventory.addItem(playerId, recipe.result_item_id, bonusQty, 0, 0);
      }
    }

    res.json({
      success: successCount > 0,
      logros: logrosNuevos,
      successCount,
      failCount,
      quantity: qty,
      totalGained,
      goldCost,
      luck: totalLuck,
      results,
      lost,
      message: successCount === 0
        ? `El crafteo falló ${failCount} vez${failCount > 1 ? 'es' : ''}, perdiste parte de los materiales`
        : luckyCount > 0
          ? `¡${luckyCount} crafteo${luckyCount > 1 ? 's' : ''} con suerte! Obtuviste ${totalGained}x ${recipe.result_name}`
          : `Crafteo exitoso: obtuviste ${totalGained}x ${recipe.result_name}`,
      item: successCount > 0 ? { id: recipe.result_item_id, name: recipe.result_name } : null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/player/:playerId/dismantle
// body: { itemId, quantity? } — desmantela un ítem crafteado y devuelve materiales.
// GET /api/player/:playerId/food-buff — la comida activa ("bien alimentado") o null
router.get('/:playerId/food-buff', async (req, res, next) => {
  try {
    const foods = await comida.activeFor([Number(req.params.playerId)]);
    res.json({ foodBuff: foods[req.params.playerId] ?? null });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/use-item  body: { itemId, targetNpcId? }
// Usa un consumible fuera de combate sobre el héroe o un NPC del grupo.
// Las comidas con bonos de combate (BUFF_*, ALL_STATS) dejan al héroe "bien alimentado" un rato: los
// combates que empiece mientras dure arrancan con esos bonos (lib/comida.js). El HOT se ignora.
router.post('/:playerId/use-item', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, targetNpcId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId es requerido' });
  try {
    const itemRes = await db.query('SELECT id, code, name, item_type FROM items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    const item = itemRes.rows[0];
    if (item.item_type !== 'CONSUMABLE') {
      return res.status(400).json({ error: 'Ese item no es consumible' });
    }

    const bestTier = await inventory.getBestQualityTier(playerId, itemId);
    const have = await inventory.getQuantity(playerId, itemId, 0, bestTier);
    if (have < 1) return res.status(400).json({ error: 'No tienes ese item' });

    // la Vela de Sebo de las Catacumbas: no cura nada, vuelve a encender la llama del héroe (la barra de
    // luz vive en el cliente, gpr/src/game/world/llama.js: aquí solo se gasta la vela y se avisa)
    if (item.code === 'VELA_SEBO') {
      if (targetNpcId) return res.status(400).json({ error: 'La vela la lleva tu héroe.' });
      await inventory.removeItem(playerId, itemId, 1, 0, bestTier);
      return res.json({ message: 'Enciendes la Vela de Sebo. Huele mal, pero tu llama vuelve a arder entera.', llama: true });
    }

    // Libros de hechizo: enseñan una skill universal (class_id NULL) al héroe, no afectan HP/MP.
    // Se resuelven acá y no en el loop de item_stat_bonuses porque no es un bono numérico de stat.
    const teaches = await db.query(
      `SELECT s.id AS skill_id, s.name, s.description
       FROM item_teaches_skill its JOIN skills s ON s.id = its.skill_id
       WHERE its.item_id = $1`,
      [itemId]
    );
    if (teaches.rows.length) {
      if (targetNpcId) {
        return res.status(400).json({ error: 'Los libros de hechizo solo se pueden usar en el héroe.' });
      }
      const { skill_id: skillId, name: skillName } = teaches.rows[0];
      const already = await db.query('SELECT 1 FROM player_skills WHERE player_id = $1 AND skill_id = $2', [playerId, skillId]);
      if (already.rows.length) {
        return res.status(400).json({ error: `Ya conoces la habilidad "${skillName}".` });
      }
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO player_skills(player_id, skill_id) VALUES ($1, $2)', [playerId, skillId]);
        await inventory.removeItem(playerId, itemId, 1, 0, bestTier, client);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
      return res.json({
        message: `Aprendiste "${skillName}" con ${item.name}.`,
        learnedSkillId: skillId,
        skillName,
      });
    }

    const bonuses = await db.query(
      'SELECT stat_code, amount, is_percent FROM item_stat_bonuses WHERE item_id = $1',
      [itemId]
    );
    const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];
    const qualityMult = QUALITY_TIER_MULTIPLIER[bestTier] ?? 1;

    // ── Determinar objetivo: héroe o NPC del grupo ──
    let target, targetName;
    if (targetNpcId) {
      const npcRes = await db.query(
        `SELECT pn.id, pn.name, pn.hp, pn.max_hp, pn.mana, pn.max_mana
         FROM player_npcs pn
         JOIN player_party pp ON pp.npc_id = pn.id
         WHERE pn.id = $1 AND pn.player_id = $2`,
        [targetNpcId, playerId]
      );
      if (!npcRes.rows.length) {
        return res.status(404).json({ error: 'Ese NPC no está en tu grupo activo' });
      }
      target = npcRes.rows[0];
      targetName = target.name;
    } else {
      const playerRes = await db.query('SELECT hp, max_hp, mana, max_mana FROM players WHERE id = $1', [playerId]);
      target = playerRes.rows[0];
      targetName = 'tu héroe';
    }

    let newHp = target.hp;
    let newMana = target.mana;
    const applied = [];

    for (const bonus of bonuses.rows) {
      const amount = Math.round(Number(bonus.amount) * qualityMult);
      if (bonus.stat_code === 'HEAL_HP') {
        const before = newHp;
        newHp = Math.min(target.max_hp, newHp + amount);
        if (newHp > before) applied.push(`+${newHp - before} HP`);
      } else if (bonus.stat_code === 'HEAL_MP' || bonus.stat_code === 'RESTORE_MANA') {
        const before = newMana;
        newMana = Math.min(target.max_mana, newMana + amount);
        if (newMana > before) applied.push(`+${newMana - before} Maná`);
      }
    }

    // bonos de combate: solo el héroe queda "bien alimentado"
    const foodEffects = targetNpcId ? [] : comida.effectsOf(bonuses.rows, qualityMult);
    if (applied.length === 0 && !foodEffects.length) {
      return res.status(400).json({ error: `${targetName} ya tiene el HP y Maná al máximo` });
    }

    let foodBuff = null;
    if (foodEffects.length) await comida.ensureTable();
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      if (targetNpcId) {
        await client.query('UPDATE player_npcs SET hp = $1, mana = $2 WHERE id = $3', [newHp, newMana, targetNpcId]);
      } else {
        await client.query('UPDATE players SET hp = $1, mana = $2, updated_at = now() WHERE id = $3', [newHp, newMana, playerId]);
      }
      await inventory.removeItem(playerId, itemId, 1, 0, bestTier, client);
      if (foodEffects.length) foodBuff = await comida.eat(playerId, item, foodEffects, client);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    // Construir mensaje descriptivo
    const effectDesc = applied.map((a) => {
      if (a.includes('HP')) return `recuperó ${a.replace('+', '')}`;
      if (a.includes('Maná')) return `restauró ${a.replace('+', '')}`;
      return a;
    }).join(' y ');

    let message;
    if (targetNpcId) {
      const casterRes = await db.query('SELECT nickname FROM players WHERE id = $1', [playerId]);
      const casterName = casterRes.rows[0]?.nickname ?? 'El jugador';
      message = `${casterName} usó ${item.name} en ${targetName}: ${targetName} ${effectDesc}`;
    } else {
      message = effectDesc ? `Usaste ${item.name}: ${effectDesc}` : `Comiste ${item.name}`;
    }
    if (foodBuff) message += `. Bien alimentado ${comida.FOOD_MINUTES} min: tus combates empiezan con ${foodBuff.text}.`;
    // comidas (no pociones): el logro secreto «Buen Diente» (lib/logros.js)
    let logrosNuevos = [];
    if (!targetNpcId && (foodBuff || !/POCION|ELIXIR|ESENCIA|ANTIDOTO|VENDAJE|AGUA_/.test(String(item.code ?? '')))) {
      await incrementCounter(playerId, 'COMIDAS');
      logrosNuevos = await logros.revisarSeguro(playerId);
    }

    res.json({
      message,
      foodBuff,
      logros: logrosNuevos,
      targetNpcId: targetNpcId ?? null,
      hp: newHp,
      maxHp: target.max_hp,
      mana: newMana,
      maxMana: target.max_mana,
    });
  } catch (error) { next(error); }
});

// Lo que devuelve lo decide lib/desmantelar.js: la regla manual (dismantle_recipes) si hay, o la
// mitad en promedio de los materiales de su receta, sin las piezas de jefe. Solo equipo.
// GET /api/player/:playerId/dismantle/preview/:itemId — lo que puede salir (lib/desmantelar.js preview)
router.get('/:playerId/dismantle/preview/:itemId', async (req, res, next) => {
  try {
    const r = await desmantelar.preview(Number(req.params.itemId));
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/dismantle-batch { items: [{ itemId, quantity }] } — desmantela varias piezas de una
// vez (con las mismas reglas: nada equipado ni con candado); devuelve todo lo recuperado junto
router.post('/:playerId/dismantle-batch', requireNear('taller'), async (req, res, next) => {
  const { playerId } = req.params;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
  if (!items.length) return res.status(400).json({ error: 'No elegiste nada para desmantelar' });
  try {
    const equipped = new Set((await db.query('SELECT item_id FROM player_equipment WHERE player_id = $1', [playerId])).rows.map((r) => r.item_id));
    const gained = new Map();
    let rotas = 0;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const it of items) {
        const itemId = Number(it.itemId);
        if (!itemId || equipped.has(itemId) || await mochila.esFavorito(playerId, itemId, null, client)) continue;
        const have = Number((await client.query(
          'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND enchant_level = 0',
          [playerId, itemId])).rows[0].n);
        const qty = Math.min(have, Math.max(1, Math.min(99, parseInt(it.quantity) || 1)));
        if (qty < 1) continue;
        const planned = await desmantelar.plan(itemId, qty);
        if (planned.error) continue;
        await inventory.removeItem(playerId, itemId, qty, 0, null, client);
        for (const mat of planned.materials) {
          await inventory.addItem(playerId, mat.itemId, mat.quantity, 0, 0, client);
          const cur = gained.get(mat.itemId) ?? { id: mat.itemId, name: mat.name, quantity: 0 };
          cur.quantity += mat.quantity;
          gained.set(mat.itemId, cur);
        }
        rotas += qty;
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    if (!rotas) return res.status(400).json({ error: 'No había nada que se pudiera desmantelar' });
    res.json({ success: true, desmanteladas: rotas, materials: [...gained.values()], message: `Desmantelaste ${rotas} pieza${rotas === 1 ? '' : 's'}.` });
  } catch (error) { next(error); }
});

router.post('/:playerId/dismantle', requireNear('taller'), async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!itemId) {
    return res.status(400).json({ error: 'itemId es requerido' });
  }

  try {
    // qué devuelve: lib/desmantelar.js (solo equipo, la mitad en promedio, nunca las piezas de jefe)
    const planned = await desmantelar.plan(itemId, qty);
    if (planned.error) return res.status(400).json({ error: planned.error });
    // (con mala suerte en el sorteo de las fracciones puede no salir nada: se desmantela igual)
    const materials = planned.materials;

    const have = await inventory.getQuantity(playerId, itemId);
    if (have < qty) {
      return res.status(400).json({
        error: `No tienes suficientes unidades (tienes ${have}, necesitas ${qty})`,
      });
    }

    const equippedCheck = await db.query(
      `SELECT 1 FROM player_equipment WHERE player_id = $1 AND item_id = $2`,
      [playerId, itemId]
    );
    if (equippedCheck.rows.length) {
      return res.status(400).json({ error: 'No puedes desmantelar un ítem equipado. Desequípalo primero.' });
    }
    if (await mochila.esFavorito(playerId, itemId)) {
      return res.status(400).json({ error: 'Esa pieza tiene candado: quítaselo en la mochila para desmantelarla.' });
    }

    // Sacar el item y dar los materiales en una sola transaccion -- antes, si algo fallaba a
    // mitad del loop de materiales, el item ya se habia descontado sin entregar el resto.
    const client = await db.pool.connect();
    const gained = [];
    try {
      await client.query('BEGIN');
      await inventory.removeItem(playerId, itemId, qty, 0, null, client);
      for (const mat of materials) {
        await inventory.addItem(playerId, mat.itemId, mat.quantity, 0, 0, client);
        gained.push({ id: mat.itemId, name: mat.name, quantity: mat.quantity });
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const itemNameRow = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    const itemName = itemNameRow.rows[0]?.name ?? 'Ítem';

    res.json({
      success: true,
      message: `Desmantelado exitoso: ${qty}x ${itemName}`,
      materials: gained,
    });
  } catch (error) {
    next(error);
  }
});

// ─── FORMACIÓN / PARTY ───────────────────────────────────────────────────────

const NPC_REFRESH_COST = 150;
const NPC_POOL_SIZE = 5;
const HIRE_COST_PER_LEVEL = 80;
const PARTY_MAX_NPC_SLOTS = 2;
const BENCH_CAP = 10;

// Batched: agrupa por (class_id, level) para pasivas y por class_id para crit_damage base, asi
// NPCs que comparten clase/nivel (frecuente en /party/pool y /bench) no repiten la misma query
// una vez por NPC (antes era un Promise.all con 1 query de pasivas + 1 de critDamage POR NPC).
async function getNpcCombatExtrasBatch(npcs) {
  const passivesCache = new Map();
  const critCache = new Map();
  for (const n of npcs) {
    const passivesKey = `${n.class_id}:${n.level}`;
    if (!passivesCache.has(passivesKey)) passivesCache.set(passivesKey, getClassPassiveBonuses(n.class_id, n.level));
    if (!critCache.has(n.class_id)) critCache.set(n.class_id, leveling.getClassBaseCritDamage(n.class_id));
  }
  const passivesKeys = [...passivesCache.keys()];
  const critKeys = [...critCache.keys()];
  const [passivesValues, critValues] = await Promise.all([
    Promise.all(passivesCache.values()),
    Promise.all(critCache.values()),
  ]);
  const passivesResolved = Object.fromEntries(passivesKeys.map((k, i) => [k, passivesValues[i]]));
  const critResolved = Object.fromEntries(critKeys.map((k, i) => [k, critValues[i]]));

  const result = {};
  for (const n of npcs) {
    result[n.id] = {
      passives: passivesResolved[`${n.class_id}:${n.level}`],
      baseCritDamage: critResolved[n.class_id],
    };
  }
  return result;
}
const BASE_CLASS_IDS = [1, 2, 3, 4, 5];
const NPC_NAMES = [
  'Aldric', 'Bravos', 'Caelum', 'Draven', 'Eriel', 'Faeron', 'Goreth', 'Hadrix',
  'Ishan', 'Jorath', 'Kael', 'Lyron', 'Marek', 'Navar', 'Orynn', 'Pelion',
  'Riven', 'Solan', 'Tarak', 'Ulvan', 'Varek', 'Waran', 'Xael', 'Yoren', 'Zarek',
  'Aelith', 'Brenna', 'Caelia', 'Dara', 'Elyna', 'Faena', 'Gyra', 'Hessa',
  'Iyla', 'Jarra', 'Kira', 'Lyra', 'Mira', 'Nessa', 'Petra', 'Rhea', 'Sela',
  'Thela', 'Vela', 'Wren', 'Xara', 'Yasha', 'Zara', 'Bram', 'Cedric',
];

async function buildNpcPool(heroLevel) {
  const classesRes = await db.query(
    `SELECT id, name, base_hp, base_atk, base_def, base_mag, base_magic_def,
            base_spd, base_crit_chance, base_mana FROM classes WHERE id = ANY($1)`,
    [BASE_CLASS_IDS]
  );
  const growthsRes = await db.query(
    `SELECT class_id, level_from, level_to, hp_per_level, atk_per_level, def_per_level,
            mag_per_level, magic_def_per_level, spd_per_level, mana_per_level
     FROM class_growths WHERE class_id = ANY($1) ORDER BY class_id, level_from`,
    [BASE_CLASS_IDS]
  );
  const growthsByClass = {};
  for (const g of growthsRes.rows) {
    (growthsByClass[g.class_id] = growthsByClass[g.class_id] || []).push(g);
  }

  const usedNames = [];
  const npcs = [];
  for (let i = 0; i < NPC_POOL_SIZE; i++) {
    const cls = classesRes.rows[Math.floor(Math.random() * classesRes.rows.length)];
    const available = NPC_NAMES.filter((n) => !usedNames.includes(n));
    const name = available[Math.floor(Math.random() * available.length)];
    usedNames.push(name);
    const minLevel = Math.max(1, heroLevel - 1);
    const level = Math.floor(Math.random() * (heroLevel - minLevel + 1)) + minLevel;
    const stats = leveling.computeStatsAtLevel(cls, growthsByClass[cls.id] || [], level);
    npcs.push({ name, classId: cls.id, className: cls.name, level, stats, hireCost: level * HIRE_COST_PER_LEVEL });
  }
  return npcs;
}

function formatNpc(npc, extra = {}) {
  return {
    npcId: npc.id,
    name: npc.name,
    className: npc.class_name,
    classId: npc.class_id,
    level: npc.level,
    xp: npc.xp,
    hp: npc.hp, maxHp: npc.max_hp,
    mana: npc.mana, maxMana: npc.max_mana,
    atk: npc.atk, def: npc.def, int: npc.mag,
    magicDef: npc.magic_def, spd: npc.spd, crit: npc.crit,
    hiredAt: npc.hired_at,
    ...extra,
  };
}

// GET /api/player/:playerId/party
// Slot 1 = héroe, slots 2-3 = NPCs contratados.
router.get('/:playerId/party', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const [heroRes, partyRes] = await Promise.all([
      db.query(
        `SELECT p.nickname, p.level, p.hp, p.max_hp, p.mana, p.max_mana,
                p.atk, p.def, p.mag, p.magic_def, p.spd, p.crit,
                p.current_class_id, p.evolution_class_id,
                c.id AS class_id, c.name AS class_name, c.code AS class_code, c.base_evasion
         FROM players p JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
         WHERE p.id = $1`,
        [playerId]
      ),
      db.query(
        `SELECT pn.*, pp.id AS party_row_id, pp.slot
         FROM player_party pp
         JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.player_id = $1
         ORDER BY pp.slot`,
        [playerId]
      ),
    ]);
    if (!heroRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const hero = heroRes.rows[0];

    const npcClassIds = partyRes.rows.map((n) => n.class_id);
    const heroChain = await evolution.getClassAncestorChain(hero.evolution_class_id || hero.current_class_id);
    const [heroEquip, heroPassives, heroBaseCritDamage, npcResistances, npcBonuses, classXpRates] = await Promise.all([
      getEquipmentBonuses(Number(playerId)),
      getClassPassiveBonuses(heroChain, hero.level),
      leveling.getClassBaseCritDamage(hero.class_id),
      npcClassIds.length
        ? db.query(
            `SELECT cer.class_id, e.name AS element, e.code AS element_code, cer.resistance_percent
             FROM class_element_resistances cer JOIN elements e ON e.id = cer.element_id
             WHERE cer.class_id = ANY($1) ORDER BY cer.class_id, e.id`,
            [npcClassIds]
          )
        : Promise.resolve({ rows: [] }),
      npcClassIds.length
        ? db.query(
            `SELECT cedb.class_id, e.name AS element, e.code AS element_code, cedb.damage_bonus
             FROM class_elemental_damage_bonus cedb JOIN elements e ON e.id = cedb.element_id
             WHERE cedb.class_id = ANY($1) ORDER BY cedb.class_id, e.id`,
            [npcClassIds]
          )
        : Promise.resolve({ rows: [] }),
      npcClassIds.length
        ? db.query('SELECT id, xp_rate, base_evasion FROM classes WHERE id = ANY($1)', [npcClassIds])
        : Promise.resolve({ rows: [] }),
    ]);

    // Pasivos/critDamage batcheados por (class_id, level) y equipo batcheado por npc_id, en vez
    // de una query por NPC (ver getNpcCombatExtrasBatch más arriba).
    const npcDataMap = {};
    const [partyExtras, partyEquip] = await Promise.all([
      getNpcCombatExtrasBatch(partyRes.rows),
      getNpcEquipmentBonusesBatch(partyRes.rows.map((n) => n.id)),
    ]);
    for (const n of partyRes.rows) {
      npcDataMap[n.id] = { passives: partyExtras[n.id].passives, equip: partyEquip[n.id], baseCritDamage: partyExtras[n.id].baseCritDamage };
    }

    res.json({
      maxSlots: PARTY_MAX_NPC_SLOTS + 1,
      members: [
        {
          slot: 1,
          isHero: true,
          name: hero.nickname,
          className: hero.class_name,
          classCode: hero.class_code,
          level: hero.level,
          hp: Math.min(hero.hp, Math.round(hero.max_hp * (1 + heroPassives.hp / 100))),
          maxHp: Math.round(hero.max_hp * (1 + heroPassives.hp / 100)),
          mana: hero.mana, maxMana: hero.max_mana,
          atk: Math.round(hero.atk * (1 + heroPassives.atk / 100)) + (heroEquip.atk || 0),
          def: Math.round(hero.def * (1 + heroPassives.def / 100)) + (heroEquip.def || 0),
          int: Math.round(hero.mag * (1 + heroPassives.mag / 100)) + (heroEquip.mag || 0),
          magicDef: hero.magic_def + (heroEquip.magic_def || 0),
          spd: Math.round(hero.spd * (1 + heroPassives.spd / 100)) + (heroEquip.spd || 0),
          crit: (Number(hero.crit) + heroPassives.crit_chance + (heroEquip.crit_chance || 0)).toFixed(2),
          evasion: Number(hero.base_evasion) + heroPassives.evasion + (heroEquip.evasion || 0),
          critDamage: heroBaseCritDamage + heroPassives.crit_damage + (heroEquip.crit_damage || 0),
          magicDamageBonus: heroPassives.magic_damage_bonus,
          uniqueSkill: heroPassives.uniqueSkill,
        },
        ...partyRes.rows.map((n) => {
          const classRow = classXpRates.rows.find((c) => c.id === n.class_id);
          const xpRate = classRow ? Number(classRow.xp_rate) : 1;
          const npcBaseEvasion = classRow ? Number(classRow.base_evasion) : 0;
          const xpCurrent = leveling.xpThreshold(n.level, xpRate);
          const xpNext = leveling.xpThreshold(n.level + 1, xpRate);
          const { passives: np, equip: ne, baseCritDamage: npcBaseCritDamage } = npcDataMap[n.id] || { passives: { atk: 0, mag: 0, hp: 0, spd: 0, def: 0, crit_chance: 0, crit_damage: 0, evasion: 0, magic_damage_bonus: 0, uniqueSkill: null }, equip: {}, baseCritDamage: 150 };
          const npcMaxHp = Math.round(n.max_hp * (1 + np.hp / 100));
          return formatNpc(n, {
            slot: n.slot,
            partyRowId: n.party_row_id,
            isHero: false,
            hp: Math.min(n.hp, npcMaxHp),
            maxHp: npcMaxHp,
            xpIntoLevel: Number(n.xp) - xpCurrent,
            xpNeededForLevel: xpNext - xpCurrent,
            atk: Math.round(n.atk * (1 + np.atk / 100)) + (ne.atk || 0),
            def: Math.round(n.def * (1 + np.def / 100)) + (ne.def || 0),
            int: Math.round(n.mag * (1 + np.mag / 100)) + (ne.mag || 0),
            magicDef: n.magic_def + (ne.magic_def || 0),
            spd: Math.round(n.spd * (1 + np.spd / 100)) + (ne.spd || 0),
            crit: (Number(n.crit) + np.crit_chance + (ne.crit_chance || 0)).toFixed(2),
            evasion: npcBaseEvasion + np.evasion + (ne.evasion || 0),
            critDamage: npcBaseCritDamage + np.crit_damage + (ne.crit_damage || 0),
            magicDamageBonus: np.magic_damage_bonus,
            uniqueSkill: np.uniqueSkill,
            resistances: npcResistances.rows
              .filter((r) => r.class_id === n.class_id)
              .map((r) => ({ element: r.element, elementCode: r.element_code, percent: Number(r.resistance_percent) })),
            elementalBonuses: npcBonuses.rows
              .filter((r) => r.class_id === n.class_id)
              .map((r) => ({ element: r.element, elementCode: r.element_code, bonus: Number(r.damage_bonus) })),
          });
        }),
      ],
    });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/party/pool
// Pool de aventureros disponibles. Se auto-regenera gratis cada 30 minutos; el jugador
// puede refrescar antes pagando NPC_REFRESH_COST oro (POST /pool/refresh).
// La respuesta incluye secondsUntilFreeRefresh para que el front pueda mostrar un timer.
router.get('/:playerId/party/pool', async (req, res, next) => {
  const { playerId } = req.params;
  const POOL_AUTO_REFRESH_MS = 30 * 60 * 1000;
  try {
    const [playerRes, poolRes] = await Promise.all([
      db.query('SELECT level, pool_last_generated_at FROM players WHERE id = $1', [playerId]),
      db.query('SELECT * FROM player_npc_pool WHERE player_id = $1 ORDER BY id', [playerId]),
    ]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const { level, pool_last_generated_at } = playerRes.rows[0];

    const lastGen = pool_last_generated_at ? new Date(pool_last_generated_at).getTime() : 0;
    const expired = (Date.now() - lastGen) >= POOL_AUTO_REFRESH_MS;
    let rows = poolRes.rows;
    let genTimestamp = lastGen;

    if (rows.length === 0 || expired) {
      const npcs = await buildNpcPool(level);
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM player_npc_pool WHERE player_id = $1', [playerId]);
        for (const n of npcs) {
          await client.query(
            `INSERT INTO player_npc_pool(player_id, name, class_id, class_name, level,
               hp, mana, atk, def, mag, magic_def, spd, crit, hire_cost)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [playerId, n.name, n.classId, n.className, n.level,
             n.stats.hp, n.stats.mana, n.stats.atk, n.stats.def,
             n.stats.mag, n.stats.magicDef, n.stats.spd, n.stats.crit, n.hireCost]
          );
        }
        await client.query('UPDATE players SET pool_last_generated_at = now() WHERE id = $1', [playerId]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      const freshRes = await db.query('SELECT * FROM player_npc_pool WHERE player_id = $1 ORDER BY id', [playerId]);
      rows = freshRes.rows;
      genTimestamp = Date.now();
    }

    const secondsUntilFreeRefresh = Math.ceil(Math.max(0, (genTimestamp + POOL_AUTO_REFRESH_MS - Date.now()) / 1000));

    const classIds = [...new Set(rows.map((n) => n.class_id))];
    const classEvasionRes = await db.query('SELECT id, base_evasion FROM classes WHERE id = ANY($1)', [classIds]);
    const classEvasionMap = Object.fromEntries(classEvasionRes.rows.map((r) => [r.id, Number(r.base_evasion)]));

    const poolExtras = await getNpcCombatExtrasBatch(rows);
    const npcs = rows.map((n) => {
      const { passives, baseCritDamage } = poolExtras[n.id];
      return {
        poolNpcId: n.id,
        name: n.name,
        className: n.class_name,
        level: n.level,
        hp: n.hp, mana: n.mana, atk: n.atk, def: n.def,
        int: n.mag, magicDef: n.magic_def, spd: n.spd,
        crit: Number(n.crit) + passives.crit_chance,
        evasion: (classEvasionMap[n.class_id] || 0) + passives.evasion,
        critDamage: baseCritDamage + passives.crit_damage,
        hireCost: n.hire_cost,
      };
    });
    res.json({ refreshCost: NPC_REFRESH_COST, secondsUntilFreeRefresh, npcs });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/pool/refresh
// Paga NPC_REFRESH_COST oro y genera 5 NPCs nuevos.
router.post('/:playerId/party/pool/refresh', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const playerRes = await db.query('SELECT level, gold FROM players WHERE id = $1', [playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerRes.rows[0];
    if (Number(player.gold) < NPC_REFRESH_COST) {
      return res.status(400).json({ error: `Necesitas ${NPC_REFRESH_COST} oro para buscar nuevos aventureros` });
    }

    const poolData = await buildNpcPool(player.level);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE players SET gold = gold - $1, pool_last_generated_at = now() WHERE id = $2',
        [NPC_REFRESH_COST, playerId]
      );
      await client.query('DELETE FROM player_npc_pool WHERE player_id = $1', [playerId]);
      for (const n of poolData) {
        await client.query(
          `INSERT INTO player_npc_pool(player_id, name, class_id, class_name, level,
            hp, mana, atk, def, mag, magic_def, spd, crit, hire_cost)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [playerId, n.name, n.classId, n.className, n.level,
           n.stats.hp, n.stats.mana, n.stats.atk, n.stats.def,
           n.stats.mag, n.stats.magicDef, n.stats.spd, n.stats.crit, n.hireCost]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const newGoldRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    const poolRes = await db.query('SELECT * FROM player_npc_pool WHERE player_id = $1 ORDER BY id', [playerId]);
    const refreshClassIds = [...new Set(poolRes.rows.map((n) => n.class_id))];
    const refreshEvasionRes = await db.query('SELECT id, base_evasion FROM classes WHERE id = ANY($1)', [refreshClassIds]);
    const refreshEvasionMap = Object.fromEntries(refreshEvasionRes.rows.map((r) => [r.id, Number(r.base_evasion)]));
    const refreshExtras = await getNpcCombatExtrasBatch(poolRes.rows);
    const npcs = poolRes.rows.map((n) => {
      const { passives, baseCritDamage } = refreshExtras[n.id];
      return {
        poolNpcId: n.id,
        name: n.name,
        className: n.class_name,
        level: n.level,
        hp: n.hp, mana: n.mana, atk: n.atk, def: n.def,
        int: n.mag, magicDef: n.magic_def, spd: n.spd,
        crit: Number(n.crit) + passives.crit_chance,
        evasion: (refreshEvasionMap[n.class_id] || 0) + passives.evasion,
        critDamage: baseCritDamage + passives.crit_damage,
        hireCost: n.hire_cost,
      };
    });
    res.json({ gold: Number(newGoldRes.rows[0].gold), refreshCost: NPC_REFRESH_COST, npcs });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/hire/:poolNpcId
// Contrata un NPC del pool. Crea una entidad en player_npcs; si hay slot libre va al grupo
// activo, si el grupo está lleno va al banco (siempre que el banco no supere BENCH_CAP).
router.post('/:playerId/party/hire/:poolNpcId', requireNear('registro'), async (req, res, next) => {
  const { playerId, poolNpcId } = req.params;
  try {
    const [playerRes, npcRes, partyRes, benchRes] = await Promise.all([
      db.query('SELECT gold FROM players WHERE id = $1', [playerId]),
      db.query('SELECT * FROM player_npc_pool WHERE id = $1 AND player_id = $2', [poolNpcId, playerId]),
      db.query('SELECT slot FROM player_party WHERE player_id = $1', [playerId]),
      db.query('SELECT COUNT(*)::int AS cnt FROM player_bench WHERE player_id = $1', [playerId]),
    ]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el pool' });

    const npc = npcRes.rows[0];
    if (Number(playerRes.rows[0].gold) < npc.hire_cost) {
      return res.status(400).json({ error: `Necesitas ${npc.hire_cost} oro para contratar a ${npc.name}` });
    }

    const takenSlots = partyRes.rows.map((r) => r.slot);
    const freeSlot = [2, 3].find((s) => !takenSlots.includes(s));
    const goToBench = !freeSlot;

    if (goToBench && benchRes.rows[0].cnt >= BENCH_CAP) {
      return res.status(400).json({
        error: `El banco está lleno (máximo ${BENCH_CAP}). Despide a alguien antes de contratar más.`,
      });
    }

    const client = await db.pool.connect();
    let npcId;
    try {
      await client.query('BEGIN');
      await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [npc.hire_cost, playerId]);
      // Crear entidad maestra en player_npcs
      const classXpRate = await client.query('SELECT xp_rate FROM classes WHERE id = $1', [npc.class_id]);
      const xpRate = classXpRate.rows.length ? Number(classXpRate.rows[0].xp_rate) : 1;
      const startingXp = leveling.xpThreshold(npc.level, xpRate);
      const npcInsert = await client.query(
        `INSERT INTO player_npcs(player_id, name, class_id, class_name, level, xp,
           hp, max_hp, mana, max_mana, atk, def, mag, magic_def, spd, crit)
         VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [playerId, npc.name, npc.class_id, npc.class_name, npc.level, startingXp,
         npc.hp, npc.mana, npc.atk, npc.def, npc.mag, npc.magic_def, npc.spd, npc.crit]
      );
      npcId = npcInsert.rows[0].id;
      if (goToBench) {
        await client.query(
          'INSERT INTO player_bench(player_id, npc_id) VALUES($1,$2)',
          [playerId, npcId]
        );
      } else {
        await client.query(
          'INSERT INTO player_party(player_id, npc_id, slot) VALUES($1,$2,$3)',
          [playerId, npcId, freeSlot]
        );
      }
      await client.query('DELETE FROM player_npc_pool WHERE id = $1', [poolNpcId]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const newGoldRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    const destination = goToBench ? 'bench' : 'party';
    res.json({
      destination,
      npcId,
      message: goToBench
        ? `${npc.name} fue al banco de reserva (grupo lleno)`
        : `${npc.name} se unió al grupo en el slot ${freeSlot}`,
      gold: Number(newGoldRes.rows[0].gold),
      ...(freeSlot && { slot: freeSlot }),
    });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/bench
// NPCs en el banco de reserva.
router.get('/:playerId/bench', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const r = await db.query(
      `SELECT pn.*, pb.id AS bench_row_id
       FROM player_bench pb
       JOIN player_npcs pn ON pn.id = pb.npc_id
       WHERE pb.player_id = $1
       ORDER BY pn.hired_at`,
      [playerId]
    );
    const benchClassIds = [...new Set(r.rows.map((n) => n.class_id))];
    const benchEvasionRes = benchClassIds.length
      ? await db.query('SELECT id, base_evasion FROM classes WHERE id = ANY($1)', [benchClassIds])
      : { rows: [] };
    const benchEvasionMap = Object.fromEntries(benchEvasionRes.rows.map((c) => [c.id, Number(c.base_evasion)]));

    const [benchExtras, benchEquip] = await Promise.all([
      getNpcCombatExtrasBatch(r.rows),
      getNpcEquipmentBonusesBatch(r.rows.map((n) => n.id)),
    ]);
    const members = r.rows.map((n) => {
      const { passives, baseCritDamage } = benchExtras[n.id];
      const equip = benchEquip[n.id];
      return formatNpc(n, {
        benchRowId: n.bench_row_id,
        crit: Number(n.crit) + passives.crit_chance + (equip.crit_chance || 0),
        evasion: (benchEvasionMap[n.class_id] || 0) + passives.evasion + (equip.evasion || 0),
        critDamage: baseCritDamage + passives.crit_damage + (equip.crit_damage || 0),
      });
    });
    res.json({ cap: BENCH_CAP, count: r.rows.length, members });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/swap
// Intercambia los NPCs de los slots 2 y 3 dentro del grupo activo.
// body: { slotA: 2, slotB: 3 }
router.post('/:playerId/party/swap', async (req, res, next) => {
  const { playerId } = req.params;
  const { slotA, slotB } = req.body;
  if (!slotA || !slotB || slotA === slotB) {
    return res.status(400).json({ error: 'Proporciona dos slots distintos (2 y 3)' });
  }
  if (![2, 3].includes(Number(slotA)) || ![2, 3].includes(Number(slotB))) {
    return res.status(400).json({ error: 'Solo se pueden intercambiar los slots 2 y 3 (el slot 1 es el héroe)' });
  }
  try {
    const partyRes = await db.query(
      'SELECT id, slot, npc_id FROM player_party WHERE player_id = $1 AND slot = ANY($2)',
      [playerId, [Number(slotA), Number(slotB)]]
    );
    if (partyRes.rows.length !== 2) {
      return res.status(400).json({ error: 'Ambos slots deben tener un NPC para poder intercambiar' });
    }
    const [a, b] = partyRes.rows.sort((x, y) => x.slot - y.slot);
    // Intercambiar npc_id entre las dos filas de slot fijo — atómico, sin tocar los slots.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE player_party SET npc_id=$1 WHERE player_id=$2 AND slot=$3', [b.npc_id, playerId, a.slot]);
      await client.query('UPDATE player_party SET npc_id=$1 WHERE player_id=$2 AND slot=$3', [a.npc_id, playerId, b.slot]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ message: `Posiciones de slot ${slotA} y slot ${slotB} intercambiadas` });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/swap-bench
// Intercambia un NPC activo por uno del banco.
// body: { partyRowId, benchRowId }
router.post('/:playerId/party/swap-bench', async (req, res, next) => {
  const { playerId } = req.params;
  const { partyRowId, benchRowId } = req.body;
  if (!partyRowId || !benchRowId) {
    return res.status(400).json({ error: 'partyRowId y benchRowId son requeridos' });
  }
  try {
    const [activeRes, benchMemberRes] = await Promise.all([
      db.query(
        `SELECT pp.id, pp.slot, pp.npc_id, pn.name
         FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.id = $1 AND pp.player_id = $2`,
        [partyRowId, playerId]
      ),
      db.query(
        `SELECT pb.id, pb.npc_id, pn.name
         FROM player_bench pb JOIN player_npcs pn ON pn.id = pb.npc_id
         WHERE pb.id = $1 AND pb.player_id = $2`,
        [benchRowId, playerId]
      ),
    ]);
    if (!activeRes.rows.length) return res.status(404).json({ error: 'NPC activo no encontrado en tu grupo' });
    if (!benchMemberRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el banco' });

    const active = activeRes.rows[0];
    const bench = benchMemberRes.rows[0];

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Actualizar los npc_id en cada tabla — las entidades en player_npcs no se mueven
      await client.query('UPDATE player_party SET npc_id = $1 WHERE id = $2', [bench.npc_id, active.id]);
      await client.query('UPDATE player_bench SET npc_id = $1 WHERE id = $2', [active.npc_id, bench.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.json({
      message: `${bench.name} entró al grupo (slot ${active.slot}), ${active.name} pasó al banco`,
      slot: active.slot,
    });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/bench/:benchRowId
// Despide un NPC del banco permanentemente (sin devolución de oro).
router.delete('/:playerId/bench/:benchRowId', async (req, res, next) => {
  const { playerId, benchRowId } = req.params;
  try {
    const r = await db.query(
      `SELECT pb.npc_id, pn.name FROM player_bench pb
       JOIN player_npcs pn ON pn.id = pb.npc_id
       WHERE pb.id = $1 AND pb.player_id = $2`,
      [benchRowId, playerId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el banco' });
    // Eliminar la entidad maestra; CASCADE limpia player_bench automáticamente
    await db.query('DELETE FROM player_npcs WHERE id = $1', [r.rows[0].npc_id]);
    res.json({ message: `${r.rows[0].name} fue despedido` });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/party/:partyRowId
// Despide un NPC del grupo (libera el slot, sin devolución de oro).
router.delete('/:playerId/party/:partyRowId', async (req, res, next) => {
  const { playerId, partyRowId } = req.params;
  try {
    const r = await db.query(
      `SELECT pp.npc_id, pp.slot, pn.name FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.id = $1 AND pp.player_id = $2`,
      [partyRowId, playerId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo' });
    await db.query('DELETE FROM player_npcs WHERE id = $1', [r.rows[0].npc_id]);
    res.json({ message: `${r.rows[0].name} abandonó el grupo (slot ${r.rows[0].slot} liberado)` });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/bench { partyRowId }
// Manda un NPC del grupo activo directo al banco, sin necesitar intercambiarlo por otro.
router.post('/:playerId/party/bench', async (req, res, next) => {
  const { playerId } = req.params;
  const { partyRowId } = req.body;
  if (!partyRowId) return res.status(400).json({ error: 'partyRowId es requerido' });
  try {
    const [partyRes, benchCountRes] = await Promise.all([
      db.query(
        `SELECT pp.id, pp.slot, pp.npc_id, pn.name FROM player_party pp
         JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.id = $1 AND pp.player_id = $2`,
        [partyRowId, playerId]
      ),
      db.query('SELECT COUNT(*)::int AS cnt FROM player_bench WHERE player_id = $1', [playerId]),
    ]);
    if (!partyRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo' });
    if (benchCountRes.rows[0].cnt >= BENCH_CAP) {
      return res.status(400).json({ error: `El banco está lleno (máximo ${BENCH_CAP}). Despide a alguien antes.` });
    }
    const party = partyRes.rows[0];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO player_bench(player_id, npc_id) VALUES($1,$2)', [playerId, party.npc_id]);
      await client.query('DELETE FROM player_party WHERE id = $1', [partyRowId]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ message: `${party.name} pasó al banco (slot ${party.slot} liberado)`, slot: party.slot });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/add-from-bench { benchRowId }
// Mueve un NPC del banco a un slot vacío del grupo activo.
router.post('/:playerId/party/add-from-bench', async (req, res, next) => {
  const { playerId } = req.params;
  const { benchRowId } = req.body;
  if (!benchRowId) return res.status(400).json({ error: 'benchRowId es requerido' });
  try {
    const [benchRes, partyRes] = await Promise.all([
      db.query(
        `SELECT pb.id, pb.npc_id, pn.name FROM player_bench pb
         JOIN player_npcs pn ON pn.id = pb.npc_id
         WHERE pb.id = $1 AND pb.player_id = $2`,
        [benchRowId, playerId]
      ),
      db.query('SELECT slot FROM player_party WHERE player_id = $1', [playerId]),
    ]);
    if (!benchRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el banco' });
    const takenSlots = partyRes.rows.map((r) => r.slot);
    const freeSlot = [2, 3].find((s) => !takenSlots.includes(s));
    if (!freeSlot) return res.status(400).json({ error: 'El grupo está lleno (máximo 2 NPCs)' });
    const bench = benchRes.rows[0];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO player_party(player_id, npc_id, slot) VALUES($1,$2,$3)', [playerId, bench.npc_id, freeSlot]);
      await client.query('DELETE FROM player_bench WHERE id = $1', [benchRowId]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ message: `${bench.name} entró al grupo en el slot ${freeSlot}`, slot: freeSlot, npcId: bench.npc_id });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/npcs/:npcId
// Stats completas de un NPC contratado, incluyendo bonos de equipo y progresión de XP.
router.get('/:playerId/npcs/:npcId', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const npcRes = await db.query(
      'SELECT * FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });
    const npc = npcRes.rows[0];

    const [classRes, eqBonus, npcPassives, resistRes, bonusRes] = await Promise.all([
      db.query('SELECT xp_rate, base_evasion FROM classes WHERE id = $1', [npc.class_id]),
      getNpcEquipmentBonuses(npcId),
      getClassPassiveBonuses(npc.class_id, npc.level),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cer.resistance_percent
         FROM class_element_resistances cer JOIN elements e ON e.id = cer.element_id
         WHERE cer.class_id = $1 ORDER BY e.id`,
        [npc.class_id]
      ),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cedb.damage_bonus
         FROM class_elemental_damage_bonus cedb JOIN elements e ON e.id = cedb.element_id
         WHERE cedb.class_id = $1 ORDER BY e.id`,
        [npc.class_id]
      ),
    ]);

    const xpRate = classRes.rows.length ? Number(classRes.rows[0].xp_rate) : 1;
    const npcBaseEvasion = classRes.rows.length ? Number(classRes.rows[0].base_evasion) : 0;
    const xpForNext = leveling.xpThreshold(npc.level + 1, xpRate);

    res.json({
      npcId: npc.id,
      name: npc.name,
      className: npc.class_name,
      classId: npc.class_id,
      level: npc.level,
      xp: npc.xp,
      xpForNextLevel: xpForNext,
      hp: npc.hp, maxHp: npc.max_hp,
      mana: npc.mana, maxMana: npc.max_mana,
      atk: npc.atk + (eqBonus.atk || 0),
      def: npc.def + (eqBonus.def || 0),
      int: npc.mag + (eqBonus.mag || 0),
      magicDef: npc.magic_def + (eqBonus.magic_def || 0),
      spd: npc.spd + (eqBonus.spd || 0),
      crit: Number(npc.crit) + npcPassives.crit_chance + (eqBonus.crit_chance || 0),
      evasion: npcBaseEvasion + npcPassives.evasion + (eqBonus.evasion || 0),
      equipmentBonuses: eqBonus,
      resistances: resistRes.rows.map((r) => ({
        element: r.element, elementCode: r.element_code, percent: Number(r.resistance_percent),
      })),
      elementalBonuses: bonusRes.rows.map((r) => ({
        element: r.element, elementCode: r.element_code, bonus: Number(r.damage_bonus),
      })),
      hiredAt: npc.hired_at,
    });
  } catch (error) { next(error); }
});

// ─── EQUIPO DE NPCs ──────────────────────────────────────────────────────────

// GET /api/player/:playerId/npcs/:npcId/equip
// Equipo actual del NPC.
router.get('/:playerId/npcs/:npcId/equip', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const npcRes = await db.query(
      'SELECT id FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });

    const equipRes = await db.query(
      `SELECT ne.slot, ne.enchant_level, ne.quality_tier, i.id AS item_id, i.name, i.rarity, i.slot AS item_slot
       FROM npc_equipment ne
       JOIN items i ON i.id = ne.item_id
       WHERE ne.npc_id = $1`,
      [npcId]
    );
    const RN = ['COMUN','POCO_COMUN','RARO','EPICO','LEGENDARIO'];
    res.json({
      npcId: Number(npcId),
      slots: EQUIPMENT_SLOTS.map((slot) => {
        const equipped = equipRes.rows.find((r) => r.slot === slot);
        return {
          slot,
          item: equipped ? {
            itemId: equipped.item_id,
            name: equipped.name,
            rarity: equipped.rarity,
            effectiveRarity: RN[Math.min(RN.indexOf(equipped.rarity) + (equipped.quality_tier || 0), 4)] ?? equipped.rarity,
            qualityTier: equipped.quality_tier || 0,
            enchantLevel: equipped.enchant_level,
          } : null,
        };
      }),
    });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/npcs/:npcId/equip
// Equipa un item del inventario del jugador al NPC. body: { itemId, enchantLevel? }
router.post('/:playerId/npcs/:npcId/equip', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  const { itemId, enchantLevel = 0, qualityTier: requestedTier = 0 } = req.body;
  try {
    const [itemRes, npcRes] = await Promise.all([
      db.query('SELECT * FROM items WHERE id = $1', [itemId]),
      db.query('SELECT id, class_id, level FROM player_npcs WHERE id = $1 AND player_id = $2', [npcId, playerId]),
    ]);
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });

    const item = itemRes.rows[0];
    const npc = npcRes.rows[0];

    if (item.item_type !== 'EQUIPMENT' || !item.slot) {
      return res.status(400).json({ error: 'Ese item no es equipable' });
    }
    const owned = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (owned < 1) {
      return res.status(400).json({ error: 'No tienes ese item en tu inventario' });
    }
    if (item.class_id) {
      const classChain = await evolution.getClassAncestorChain(npc.class_id);
      if (!classChain.includes(item.class_id)) {
        return res.status(400).json({ error: 'Ese item no es de la clase de este NPC' });
      }
    }
    if (item.required_level && npc.level < item.required_level) {
      return res.status(400).json({ error: `El NPC necesita nivel ${item.required_level} para equipar esto` });
    }
    if (item.slot === 'OFFHAND') {
      const weapon = await db.query(
        `SELECT i.is_two_handed FROM npc_equipment ne
         JOIN items i ON i.id = ne.item_id
         WHERE ne.npc_id = $1 AND ne.slot = 'WEAPON'`,
        [npcId]
      );
      if (weapon.rows.length && weapon.rows[0].is_two_handed) {
        return res.status(400).json({ error: 'El arma actual del NPC ocupa las dos manos' });
      }
    }

    const bonusBefore = await getNpcEquipmentBonuses(npcId);

    // Mismo criterio que el equip del heroe: todo el swap en una transaccion.
    const client = await db.pool.connect();
    let npcEquipQualityTier;
    try {
      await client.query('BEGIN');

      const previous = await client.query(
        'DELETE FROM npc_equipment WHERE npc_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier',
        [npcId, item.slot]
      );
      if (previous.rows.length) {
        await inventory.addItem(playerId, previous.rows[0].item_id, 1, previous.rows[0].enchant_level, previous.rows[0].quality_tier || 0, client);
      }
      if (item.is_two_handed) {
        const prevOffhand = await client.query(
          'DELETE FROM npc_equipment WHERE npc_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier',
          [npcId, 'OFFHAND']
        );
        if (prevOffhand.rows.length) {
          await inventory.addItem(playerId, prevOffhand.rows[0].item_id, 1, prevOffhand.rows[0].enchant_level, prevOffhand.rows[0].quality_tier || 0, client);
        }
      }

      npcEquipQualityTier = Number(requestedTier);
      const hasIt = await inventory.getQuantity(playerId, itemId, enchantLevel, npcEquipQualityTier);
      if (hasIt < 1) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'No tienes ese item con esa rareza en tu inventario' });
      }

      await inventory.removeItem(playerId, itemId, 1, enchantLevel, npcEquipQualityTier, client);
      await client.query(
        `INSERT INTO npc_equipment(npc_id, slot, item_id, enchant_level, quality_tier) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (npc_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id, enchant_level = EXCLUDED.enchant_level, quality_tier = EXCLUDED.quality_tier`,
        [npcId, item.slot, itemId, enchantLevel, npcEquipQualityTier]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const bonusAfter = await getNpcEquipmentBonuses(npcId);
    await applyNpcHpBonusDelta(npcId, (bonusAfter.hp || 0) - (bonusBefore.hp || 0));

    res.json({ npcId: Number(npcId), slot: item.slot, itemId: item.id, name: item.name });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/npcs/:npcId/equip/:slot
// Desequipa un item del NPC y lo devuelve al inventario del jugador.
router.delete('/:playerId/npcs/:npcId/equip/:slot', async (req, res, next) => {
  const { playerId, npcId, slot } = req.params;
  if (!EQUIPMENT_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Slot inválido' });
  }
  try {
    const npcRes = await db.query(
      'SELECT id FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });

    const removed = await db.query(
      'DELETE FROM npc_equipment WHERE npc_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier',
      [npcId, slot]
    );
    if (!removed.rows.length) {
      return res.status(400).json({ error: 'El NPC no tiene nada equipado en ese slot' });
    }
    await inventory.addItem(playerId, removed.rows[0].item_id, 1, removed.rows[0].enchant_level, removed.rows[0].quality_tier || 0);

    const removedHpBonus = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS hp_bonus FROM item_stat_bonuses
       WHERE item_id = $1 AND stat_code = 'HP'`,
      [removed.rows[0].item_id]
    );
    await applyNpcHpBonusDelta(npcId, -Number(removedHpBonus.rows[0].hp_bonus));

    res.json({ npcId: Number(npcId), slot, unequippedItemId: removed.rows[0].item_id });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/npcs/:npcId/skills
// Skills disponibles para este NPC: todas las de su clase que aprende por nivel hasta su
// nivel actual. A diferencia del héroe, los NPCs no tienen player_skills; aprenden todas
// las skills LEVEL de su clase automáticamente. supportedInCombat = el motor ya las resuelve.
router.get('/:playerId/npcs/:npcId/skills', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const npcRes = await db.query(
      'SELECT id, class_id, level FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });
    const npc = npcRes.rows[0];

    const skillsRes = await db.query(
      `SELECT s.id, s.code, s.name, s.skill_type, s.damage_school, s.description, s.mana_cost, s.target_type,
              s.cooldown_rounds, s.learn_level, s.base_value, s.scaling_stat, s.scaling_multiplier, s.hits,
              s.element_id, e.name AS element_name, e.code AS element_code,
              (s.skill_type IN ('ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESPECIAL', 'ESTADO_ALTERADO') AND NOT s.is_passive) AS supported_in_combat
       FROM skills s
       LEFT JOIN elements e ON e.id = s.element_id
       WHERE NOT s.is_passive
         AND (
           (s.class_id = $1 AND s.learn_method IN ('LEVEL', 'GOLD') AND s.learn_level <= $2)
           OR EXISTS (SELECT 1 FROM npc_skills ns WHERE ns.npc_id = $3 AND ns.skill_id = s.id)
         )
       ORDER BY s.learn_level, s.id`,
      [npc.class_id, npc.level, npc.id]
    );

    res.json(skillsRes.rows.map((s) => ({
      id: s.id,
      name: s.name,
      skillType: s.skill_type,
      description: s.description,
      manaCost: Number(s.mana_cost),
      targetType: s.target_type,
      learnLevel: s.learn_level,
      cooldownRounds: s.cooldown_rounds,
      baseValue: Number(s.base_value),
      scalingStat: s.scaling_stat,
      scalingMultiplier: Number(s.scaling_multiplier),
      hits: s.hits,
      elementId: s.element_id,
      elementName: s.element_name,
      elementCode: s.element_code,
      supportedInCombat: s.supported_in_combat,
    })));
  } catch (error) { next(error); }
});

// ─── ENCHANTING ──────────────────────────────────────────────────────────────

const ENCHANT_COSTS = [
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 1, gold:    200, rate: 95 }, // → +1
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 2, gold:    400, rate: 90 }, // → +2
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 3, gold:    600, rate: 85 }, // → +3
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 4, gold:   1500, rate: 75 }, // → +4
  { stone: 'PIEDRA_ENCANT_MAYOR',     qty: 1, gold:   3000, rate: 65 }, // → +5
  { stone: 'PIEDRA_ENCANT_MAYOR',     qty: 2, gold:   5000, rate: 55 }, // → +6
  { stone: 'PIEDRA_ENCANT_MAYOR',     qty: 3, gold:  10000, rate: 45 }, // → +7
  { stone: 'PIEDRA_ENCANT_SUPREMA',   qty: 1, gold:  18000, rate: 35 }, // → +8
  { stone: 'PIEDRA_ENCANT_SUPREMA',   qty: 2, gold:  30000, rate: 25 }, // → +9
  { stone: 'PIEDRA_ENCANT_LEGENDARIA',qty: 1, gold:  80000, rate: 15 }, // → +10
];

// GET /api/player/:playerId/enchant/info
// Devuelve el nivel de encantamiento de cada slot equipado y el costo del siguiente nivel.
router.get('/:playerId/enchant/info', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const equip = await db.query(
      `SELECT pe.slot, pe.enchant_level, i.name AS item_name, i.required_level AS item_level, pe.quality_tier
       FROM player_equipment pe
       JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = $1 ORDER BY pe.slot`,
      [playerId]
    );
    const slots = equip.rows.map((r) => {
      const lvl = r.enchant_level;
      const next = lvl < 10 ? ENCHANT_COSTS[lvl] : null;
      return {
        slot: r.slot,
        itemName: r.item_name,
        enchantLevel: lvl,
        maxLevel: 10,
        nextCost: next ? { stone: next.stone, quantity: next.qty, gold: precios.encantarOro(r.item_level, lvl), successRate: next.rate } : null,
        // la reforja de calidad (lib/precios.js): cuánto cuesta el siguiente escalón y con qué probabilidad
        qualityTier: r.quality_tier || 0,
        reforja: precios.reforjaCosto(r.item_level, r.quality_tier || 0),
      };
    });
    res.json(slots);
  } catch (error) { next(error); }
});

// Cristal de Estabilidad (docs/backend-spec-ciudad-del-abismo.md parte 4, se compra en la
// tienda del asentamiento): +15 puntos de éxito para UN intento de encantar, se consume se
// gane o se pierda, mismo criterio que las piedras normales.
const STABILITY_CRYSTAL_CODE = 'CRISTAL_ESTABILIDAD';
const STABILITY_CRYSTAL_RATE_BONUS = 15;
// Version mas fuerte, vendida en la tienda del World Boss (docs ya borrados, ver commit) — si el
// jugador tiene ambos cristales y pide useCrystal, se prioriza el Mayor.
const MAJOR_STABILITY_CRYSTAL_CODE = 'CRISTAL_ESTABILIDAD_MAYOR';
const MAJOR_STABILITY_CRYSTAL_RATE_BONUS = 30;

// POST /api/player/:playerId/enchant
// body: { slot, useCrystal? }  — intenta encantar el ítem equipado en ese slot
router.post('/:playerId/enchant', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  const { slot, useCrystal } = req.body;
  if (!slot) return res.status(400).json({ error: 'slot es requerido' });

  try {
    const equip = await db.query(
      `SELECT pe.id, pe.item_id, pe.enchant_level, i.name AS item_name, i.required_level AS item_level
       FROM player_equipment pe JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = $1 AND pe.slot = $2`,
      [playerId, slot]
    );
    if (!equip.rows.length) return res.status(400).json({ error: 'No tienes equipo en ese slot' });

    const { id: equipId, item_id: itemId, enchant_level: currentLevel, item_name: itemName, item_level: itemLevel } = equip.rows[0];
    if (currentLevel >= 10) return res.status(400).json({ error: 'El ítem ya está al nivel máximo (+10)' });

    // el oro sale del nivel de la pieza (lib/precios.js); las piedras y la probabilidad, de la tabla
    const cost = { ...ENCHANT_COSTS[currentLevel], gold: precios.encantarOro(itemLevel, currentLevel) };

    const playerRow = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (playerRow.rows[0].gold < cost.gold) {
      return res.status(400).json({ error: `Necesitas ${cost.gold} de oro. Tienes ${playerRow.rows[0].gold}.` });
    }

    const stoneRes = await db.query('SELECT id FROM items WHERE code = $1', [cost.stone]);
    if (!stoneRes.rows.length) return res.status(500).json({ error: 'Piedra de encantamiento no configurada' });
    const stoneId = stoneRes.rows[0].id;
    const stoneQty = await inventory.getQuantity(playerId, stoneId);
    if (stoneQty < cost.qty) {
      return res.status(400).json({ error: `Necesitas ${cost.qty}x ${cost.stone}. Tienes ${stoneQty}.` });
    }

    let crystalId = null;
    let crystalBonus = 0;
    if (useCrystal) {
      const [majorRes, regularRes] = await Promise.all([
        db.query('SELECT id FROM items WHERE code = $1', [MAJOR_STABILITY_CRYSTAL_CODE]),
        db.query('SELECT id FROM items WHERE code = $1', [STABILITY_CRYSTAL_CODE]),
      ]);
      const majorId = majorRes.rows[0]?.id ?? null;
      const regularId = regularRes.rows[0]?.id ?? null;
      const majorQty = majorId ? await inventory.getQuantity(playerId, majorId) : 0;
      if (majorQty >= 1) {
        crystalId = majorId;
        crystalBonus = MAJOR_STABILITY_CRYSTAL_RATE_BONUS;
      } else {
        const regularQty = regularId ? await inventory.getQuantity(playerId, regularId) : 0;
        if (regularQty < 1) {
          return res.status(400).json({ error: 'No tienes ningún Cristal de Estabilidad' });
        }
        crystalId = regularId;
        crystalBonus = STABILITY_CRYSTAL_RATE_BONUS;
      }
    }

    // Consumir recursos (siempre, incluso si falla) y aplicar el resultado en una sola
    // transaccion -- antes cada paso confirmaba por separado, asi que un fallo a mitad de camino
    // podia dejar el oro/materiales gastados sin haber subido el nivel (o viceversa).
    const effectiveRate = Math.min(100, cost.rate + crystalBonus);
    const success = Math.random() * 100 < effectiveRate;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [cost.gold, playerId]);
      await inventory.removeItem(playerId, stoneId, cost.qty, 0, null, client);
      if (crystalId) await inventory.removeItem(playerId, crystalId, 1, 0, null, client);

      if (success) {
        // Delta de HP si el ítem tiene bono de HP
        const hpBonus = await client.query(
          `SELECT amount FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP'`,
          [itemId]
        );
        if (hpBonus.rows.length) {
          const base = Number(hpBonus.rows[0].amount);
          const oldBonus = Math.round(base * (1 + currentLevel * 0.05));
          const newBonus = Math.round(base * (1 + (currentLevel + 1) * 0.05));
          const hpRes = await client.query('SELECT hp, max_hp FROM players WHERE id = $1', [playerId]);
          const delta = newBonus - oldBonus;
          const newMaxHp = Math.max(1, hpRes.rows[0].max_hp + delta);
          const newHp = Math.max(0, Math.min(newMaxHp, hpRes.rows[0].hp + delta));
          await client.query('UPDATE players SET hp = $1, max_hp = $2, updated_at = now() WHERE id = $3', [newHp, newMaxHp, playerId]);
        }
        await client.query('UPDATE player_equipment SET enchant_level = enchant_level + 1 WHERE id = $1', [equipId]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (success) {
      res.json({ success: true, message: `¡${itemName} mejorado a +${currentLevel + 1}!`, newLevel: currentLevel + 1 });
    } else {
      res.json({ success: false, message: `El encantamiento de ${itemName} falló. Los materiales se pierden.`, newLevel: currentLevel });
    }
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/reforjar { slot } — sube un escalón la calidad de la pieza equipada en ese hueco
// (lib/precios.js: cuesta horas de caza del nivel de la pieza; si falla, el oro se pierde y la pieza queda igual).
// La calidad multiplica todas las estadísticas de la pieza (lib/equipment.js QUALITY_TIER_MULTIPLIER).
router.post('/:playerId/reforjar', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  const slot = String(req.body?.slot ?? '');
  try {
    const eq = (await db.query(
      `SELECT pe.id, pe.item_id, pe.enchant_level, pe.quality_tier, i.name, i.required_level
       FROM player_equipment pe JOIN items i ON i.id = pe.item_id WHERE pe.player_id = $1 AND pe.slot = $2`,
      [playerId, slot])).rows[0];
    if (!eq) return res.status(400).json({ error: 'No tienes equipo en ese hueco' });
    const tier = eq.quality_tier || 0;
    const costo = precios.reforjaCosto(eq.required_level, tier);
    if (!costo) return res.status(400).json({ error: `${eq.name} ya tiene la mejor calidad` });
    const exito = Math.random() * 100 < costo.prob;
    const QUALITY = [1.0, 1.15, 1.35, 1.60, 2.0];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const paid = await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold', [costo.oro, playerId]);
      if (!paid.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Necesitas ${costo.oro.toLocaleString('es')} de oro` });
      }
      if (exito) {
        // la vida de la pieza sube con la calidad: se suma la diferencia (como al encantar)
        const hp = await client.query("SELECT amount FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP' AND NOT is_percent", [eq.item_id]);
        if (hp.rows.length) {
          const base = Number(hp.rows[0].amount) * (1 + (eq.enchant_level || 0) * 0.05);
          const delta = Math.round(base * QUALITY[tier + 1]) - Math.round(base * QUALITY[tier]);
          await client.query(
            'UPDATE players SET max_hp = GREATEST(1, max_hp + $1), hp = LEAST(GREATEST(1, max_hp + $1), GREATEST(0, hp + $1)), updated_at = now() WHERE id = $2',
            [delta, playerId]);
        }
        await client.query('UPDATE player_equipment SET quality_tier = quality_tier + 1 WHERE id = $1', [eq.id]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    const NOMBRE = ['común', 'poco común', 'rara', 'épica', 'legendaria'];
    res.json(exito
      ? { success: true, qualityTier: tier + 1, message: `¡${eq.name} sube a calidad ${NOMBRE[tier + 1]}! Sus estadísticas crecen.` }
      : { success: false, qualityTier: tier, message: `La reforja de ${eq.name} falló. El oro se perdió, la pieza está intacta.` });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/enchant/npc/:npcId/info
router.get('/:playerId/enchant/npc/:npcId/info', requireAuth, async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const partyCheck = await db.query(
      'SELECT 1 FROM player_party WHERE player_id = $1 AND npc_id = $2',
      [playerId, npcId]
    );
    if (!partyCheck.rows.length) return res.status(403).json({ error: 'Ese NPC no es de tu formación' });

    const equip = await db.query(
      `SELECT ne.slot, ne.enchant_level, i.name AS item_name, i.required_level AS item_level
       FROM npc_equipment ne
       JOIN items i ON i.id = ne.item_id
       WHERE ne.npc_id = $1 ORDER BY ne.slot`,
      [npcId]
    );
    const slots = equip.rows.map((r) => {
      const lvl = r.enchant_level;
      const next = lvl < 10 ? ENCHANT_COSTS[lvl] : null;
      return {
        slot: r.slot,
        itemName: r.item_name,
        enchantLevel: lvl,
        maxLevel: 10,
        nextCost: next ? { stone: next.stone, quantity: next.qty, gold: precios.encantarOro(r.item_level, lvl), successRate: next.rate } : null,
      };
    });
    res.json(slots);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/enchant/npc/:npcId  body: { slot }
router.post('/:playerId/enchant/npc/:npcId', requireAuth, async (req, res, next) => {
  const { playerId, npcId } = req.params;
  const { slot } = req.body;
  if (!slot) return res.status(400).json({ error: 'slot es requerido' });

  try {
    const partyCheck = await db.query(
      'SELECT 1 FROM player_party WHERE player_id = $1 AND npc_id = $2',
      [playerId, npcId]
    );
    if (!partyCheck.rows.length) return res.status(403).json({ error: 'Ese NPC no es de tu formación' });

    const equip = await db.query(
      `SELECT ne.item_id, ne.enchant_level, i.name AS item_name, i.required_level AS item_level
       FROM npc_equipment ne JOIN items i ON i.id = ne.item_id
       WHERE ne.npc_id = $1 AND ne.slot = $2`,
      [npcId, slot]
    );
    if (!equip.rows.length) return res.status(400).json({ error: 'El NPC no tiene equipo en ese slot' });

    const { item_id: itemId, enchant_level: currentLevel, item_name: itemName, item_level: itemLevel } = equip.rows[0];
    if (currentLevel >= 10) return res.status(400).json({ error: 'El ítem ya está al nivel máximo (+10)' });

    const cost = { ...ENCHANT_COSTS[currentLevel], gold: precios.encantarOro(itemLevel, currentLevel) };

    const playerRow = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (playerRow.rows[0].gold < cost.gold) {
      return res.status(400).json({ error: `Necesitas ${cost.gold} de oro. Tienes ${playerRow.rows[0].gold}.` });
    }

    const stoneRes = await db.query('SELECT id FROM items WHERE code = $1', [cost.stone]);
    if (!stoneRes.rows.length) return res.status(500).json({ error: 'Piedra de encantamiento no configurada' });
    const stoneId = stoneRes.rows[0].id;
    const stoneQty = await inventory.getQuantity(playerId, stoneId);
    if (stoneQty < cost.qty) {
      return res.status(400).json({ error: `Necesitas ${cost.qty}x ${cost.stone}. Tienes ${stoneQty}.` });
    }

    const success = Math.random() * 100 < cost.rate;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [cost.gold, playerId]);
      await inventory.removeItem(playerId, stoneId, cost.qty, 0, null, client);

      if (success) {
        const hpBonus = await client.query(
          `SELECT amount FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP'`,
          [itemId]
        );
        if (hpBonus.rows.length) {
          const base = Number(hpBonus.rows[0].amount);
          const oldBonus = Math.round(base * (1 + currentLevel * 0.05));
          const newBonus = Math.round(base * (1 + (currentLevel + 1) * 0.05));
          const delta = newBonus - oldBonus;
          const npcHpRes = await client.query('SELECT hp, max_hp FROM player_npcs WHERE id = $1', [npcId]);
          if (npcHpRes.rows.length) {
            const newMaxHp = Math.max(1, npcHpRes.rows[0].max_hp + delta);
            const newHp = Math.max(0, Math.min(newMaxHp, npcHpRes.rows[0].hp + delta));
            await client.query('UPDATE player_npcs SET hp = $1, max_hp = $2 WHERE id = $3', [newHp, newMaxHp, npcId]);
          }
        }
        await client.query(
          'UPDATE npc_equipment SET enchant_level = enchant_level + 1 WHERE npc_id = $1 AND slot = $2',
          [npcId, slot]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    if (success) {
      res.json({ success: true, message: `¡${itemName} mejorado a +${currentLevel + 1}!`, newLevel: currentLevel + 1 });
    } else {
      res.json({ success: false, message: `El encantamiento de ${itemName} falló. Los materiales se pierden.`, newLevel: currentLevel });
    }
  } catch (error) { next(error); }
});

// ─── ARTISAN SHOP ─────────────────────────────────────────────────────────────


// zona del mapa → id de zona (artisans.zone_id): los mercaderes con zona solo venden en su tierra
const ZONE_ID_OF_DIR = { pradera: 1, montanas: 2, volcan: 3, costas: 4, tundra: 5, catacumbas: 6, ruinas: 7 };
const playerZoneId = (playerId) => ZONE_ID_OF_DIR[positionOf(Number(playerId))?.zone] ?? null;

// GET /api/player/:playerId/artisan-shop
// Devuelve los artesanos con su inventario y cuánto tiene el jugador de cada ítem. Los de siempre
// (sin zona) están en todos lados; los de una zona (Marga en Ascuaria) solo si estás en ella, y
// van primero (la ventana abre en su pestaña).
router.get('/:playerId/artisan-shop', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const here = playerZoneId(playerId);
    const artisans = await db.query(
      `SELECT code, name, specialty, zone_id, description FROM artisans
       WHERE zone_id IS NULL OR zone_id = $1
       ORDER BY (zone_id IS NULL), specialty`,
      [here]
    );
    const result = [];
    for (const art of artisans.rows) {
      const shopItems = await db.query(
        `SELECT i.id, i.code, i.name, i.rarity, i.description, s.price
         FROM artisan_shop s
         JOIN items i ON i.id = s.item_id
         WHERE s.artisan_code = $1 ORDER BY s.price`,
        [art.code]
      );
      const items = await Promise.all(shopItems.rows.map(async (it) => ({
        itemId: it.id,
        itemCode: it.code,
        name: it.name,
        rarity: it.rarity,
        description: it.description,
        price: it.price,
        playerOwns: await inventory.getQuantity(playerId, it.id),
      })));
      result.push({ code: art.code, name: art.name, specialty: art.specialty, local: art.zone_id != null, description: art.description, shop: items });
    }
    res.json(result);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/artisan-shop/buy
// body: { artisanCode, itemCode, quantity? }
router.post('/:playerId/artisan-shop/buy', requireAuth, requireNear('artesanos'), async (req, res, next) => {
  const { playerId } = req.params;
  const { artisanCode, itemCode } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!artisanCode || !itemCode) return res.status(400).json({ error: 'artisanCode e itemCode son requeridos' });
  try {
    const shopRow = await db.query(
      `SELECT s.price, i.id AS item_id, i.name, a.zone_id, a.name AS artisan_name
       FROM artisan_shop s JOIN items i ON i.id = s.item_id JOIN artisans a ON a.code = s.artisan_code
       WHERE s.artisan_code = $1 AND i.code = $2`,
      [artisanCode, itemCode]
    );
    if (!shopRow.rows.length) return res.status(404).json({ error: 'Ítem no disponible en esa tienda' });
    // un mercader de zona solo vende en su tierra
    if (shopRow.rows[0].zone_id != null && shopRow.rows[0].zone_id !== playerZoneId(playerId)) {
      return res.status(403).json({ error: `${shopRow.rows[0].artisan_name} solo vende en su tierra: búscala allá.`, lejos: true });
    }

    const { price, item_id: itemId, name } = shopRow.rows[0];
    const totalCost = price * qty;

    // UPDATE atomico con guard: evita el race de "leer oro, chequear, restar" en dos pasos
    // (dos compras casi simultaneas podian pasar el chequeo con el mismo saldo leido y dejar
    // el oro en negativo).
    const spend = await db.query(
      'UPDATE players SET gold = gold - $1 WHERE id = $2 AND gold >= $1 RETURNING gold',
      [totalCost, playerId]
    );
    if (!spend.rows.length) {
      const currentGold = (await db.query('SELECT gold FROM players WHERE id = $1', [playerId])).rows[0]?.gold ?? 0;
      return res.status(400).json({ error: `Necesitas ${totalCost} de oro. Tienes ${currentGold}.` });
    }
    await inventory.addItem(playerId, itemId, qty);

    res.json({ success: true, message: `Compraste ${qty}x ${name} por ${totalCost} de oro.`, goldSpent: totalCost });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/artisan-shop/sell
// body: { itemId, quantity?, enchantLevel? }  — vende ítems del inventario a precio fijo por rareza
router.post('/:playerId/artisan-shop/sell', requireAuth, requireNear('artesanos'), async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, enchantLevel = 0 } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!itemId) return res.status(400).json({ error: 'itemId es requerido' });
  try {
    const itemRow = await npcSell.itemForSale(itemId);
    if (!itemRow) return res.status(404).json({ error: 'Ítem no encontrado' });
    if (itemRow.is_quest_item) return res.status(400).json({ error: `${itemRow.name} es un objeto de misión: no se puede vender.` });

    const { name, item_type } = itemRow;
    // precio fijo por rareza, pero nunca más de la mitad de lo que cuesta en una tienda de oro
    const sellPrice = npcSell.artisanPrice(itemRow);
    if (!sellPrice) return res.status(400).json({ error: 'Este ítem no se puede vender' });

    const have = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (have < qty) return res.status(400).json({ error: `Solo tienes ${have}x ${name}` });
    if (await mochila.esFavorito(playerId, itemId, enchantLevel)) return res.status(400).json({ error: `${name} tiene candado: quítaselo en la mochila para venderlo.` });

    // No permitir vender si está equipado
    if (item_type === 'EQUIPMENT') {
      const equipped = await db.query(
        'SELECT slot FROM player_equipment WHERE player_id = $1 AND item_id = $2',
        [playerId, itemId]
      );
      if (equipped.rows.length) {
        return res.status(400).json({ error: `No puedes vender ${name} mientras está equipado` });
      }
    }

    const totalEarned = sellPrice * qty;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await inventory.removeItem(playerId, itemId, qty, enchantLevel, null, client);
      await client.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [totalEarned, playerId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ success: true, message: `Vendiste ${qty}x ${name} por ${totalEarned} de oro.`, goldEarned: totalEarned });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/artisan-shop/sell-batch { items: [{ itemId, enchantLevel, quantity }] }
// «Vender lo que no usas»: vende varias cosas de una vez a los artesanos, con las mismas reglas que una
// sola (precio fijo por rareza, nada equipado ni de misión). Lo que no se pueda vender se salta.
router.post('/:playerId/artisan-shop/sell-batch', requireAuth, requireNear('artesanos'), async (req, res, next) => {
  const { playerId } = req.params;
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
  if (!items.length) return res.status(400).json({ error: 'No elegiste nada para vender' });
  try {
    const equipped = new Set((await db.query('SELECT item_id FROM player_equipment WHERE player_id = $1', [playerId])).rows.map((r) => r.item_id));
    let total = 0;
    let count = 0;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const it of items) {
        const itemId = Number(it.itemId);
        const enchantLevel = Number(it.enchantLevel) || 0;
        const qty = Math.max(1, Math.min(999, parseInt(it.quantity) || 1));
        const itemRow = itemId ? await npcSell.itemForSale(itemId, client) : null;
        if (!itemRow || itemRow.is_quest_item || equipped.has(itemId)) continue;
        if (await mochila.esFavorito(playerId, itemId, enchantLevel, client)) continue;
        const price = npcSell.artisanPrice(itemRow);
        if (!price) continue;
        const have = Number((await client.query(
          'SELECT COALESCE(SUM(quantity), 0)::int AS n FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3',
          [playerId, itemId, enchantLevel])).rows[0].n);
        const n = Math.min(qty, have);
        if (n < 1) continue;
        await inventory.removeItem(playerId, itemId, n, enchantLevel, null, client);
        total += price * n;
        count += n;
      }
      if (total > 0) await client.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [total, playerId]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    if (!count) return res.status(400).json({ error: 'No había nada que se pudiera vender' });
    res.json({ success: true, goldEarned: total, sold: count, message: `Vendiste ${count} objeto${count === 1 ? '' : 's'} por ${total.toLocaleString('es')} de oro.` });
  } catch (error) { next(error); }
});

// GET /:playerId/stats/breakdown
// Devuelve, para cada stat de combate, la contribución individual de: clase base, crecimiento
// por nivel, pasivas (% sobre base+nivel) y cada pieza de equipo (con multiplicador de encantamiento).
router.get('/:playerId/stats/breakdown', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  if (Number(playerId) !== req.playerId) return res.status(403).json({ error: 'No autorizado' });
  try {
    const playerRes = await db.query(
      `SELECT p.level, p.class_id,
              c.name AS class_name,
              c.base_hp, c.base_atk, c.base_def, c.base_mag,
              c.base_magic_def, c.base_spd, c.base_crit_chance, c.base_mana
       FROM players p JOIN classes c ON c.id = p.class_id
       WHERE p.id = $1`,
      [playerId]
    );
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const pl = playerRes.rows[0];

    const [growthRes, equipRes, passiveRes] = await Promise.all([
      db.query(
        `SELECT level_from, level_to,
                hp_per_level, atk_per_level, def_per_level, mag_per_level,
                magic_def_per_level, spd_per_level, mana_per_level
         FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
        [pl.class_id]
      ),
      db.query(
        `SELECT pe.slot, i.name AS item_name, pe.enchant_level, isb.stat_code, isb.amount
         FROM player_equipment pe
         JOIN items i ON i.id = pe.item_id
         LEFT JOIN item_stat_bonuses isb ON isb.item_id = pe.item_id
         WHERE pe.player_id = $1
         ORDER BY pe.slot, isb.stat_code`,
        [playerId]
      ),
      db.query(
        `SELECT s.name, s.learn_level, se.stat_code, se.percent_amount
         FROM skills s
         JOIN skill_effects se ON se.skill_id = s.id
         WHERE s.class_id = $1
           AND s.is_passive = TRUE
           AND s.learn_method = 'LEVEL'
           AND s.learn_level <= $2
           AND se.effect_type = 'STAT_MOD'
         ORDER BY s.learn_level, s.id`,
        [pl.class_id, pl.level]
      ),
    ]);

    const atLevel = leveling.computeStatsAtLevel(
      {
        base_hp: pl.base_hp, base_atk: pl.base_atk, base_def: pl.base_def,
        base_mag: pl.base_mag, base_magic_def: pl.base_magic_def,
        base_spd: pl.base_spd, base_crit_chance: pl.base_crit_chance, base_mana: pl.base_mana,
      },
      growthRes.rows,
      pl.level
    );

    // Metadatos de cada slot equipado (para mostrar nombre + encantamiento)
    const slotMeta = {};
    for (const row of equipRes.rows) {
      if (!slotMeta[row.slot]) {
        slotMeta[row.slot] = { item_name: row.item_name, enchant_level: row.enchant_level || 0 };
      }
    }

    function equipSourcesFor(statCode) {
      const bySlot = {};
      for (const row of equipRes.rows) {
        if (!row.stat_code || row.stat_code !== statCode) continue;
        if (!bySlot[row.slot]) bySlot[row.slot] = 0;
        const mult = 1 + (row.enchant_level || 0) * 0.05;
        bySlot[row.slot] += Math.round(Number(row.amount) * mult);
      }
      return Object.entries(bySlot).map(([slot, value]) => {
        const meta = slotMeta[slot] || {};
        const enc = meta.enchant_level || 0;
        return { type: 'equipment', slot, label: `${meta.item_name || slot}${enc > 0 ? ` (+${enc})` : ''}`, value };
      });
    }

    function passiveSourcesFor(statCode, baseForPercent) {
      return passiveRes.rows
        .filter((r) => r.stat_code === statCode)
        .map((r) => {
          const pct = Number(r.percent_amount);
          return { type: 'passive', label: `${r.name} (pasiva nv${r.learn_level})`, percent: pct, value: Math.round(baseForPercent * pct / 100) };
        });
    }

    // Para HP: el pasivo se aplica sobre base+nivel+equipo (igual que en combat/party).
    // Para el resto: el pasivo se aplica solo sobre base+nivel y el equipo se suma plano después.
    const STATS = [
      { key: 'atk',       base: Number(pl.base_atk),       lvlVal: atLevel.atk,      statCode: 'ATK',         passiveCode: 'ATK'         },
      { key: 'def',       base: Number(pl.base_def),        lvlVal: atLevel.def,      statCode: 'DEF',         passiveCode: 'DEF'         },
      { key: 'int',       base: Number(pl.base_mag),        lvlVal: atLevel.mag,      statCode: 'MAG',         passiveCode: 'MAG'         },
      { key: 'magic_def', base: Number(pl.base_magic_def),  lvlVal: atLevel.magicDef, statCode: 'MAGIC_DEF',   passiveCode: 'MAGIC_DEF'   },
      { key: 'spd',       base: Number(pl.base_spd),        lvlVal: atLevel.spd,      statCode: 'SPD',         passiveCode: 'SPD'         },
      { key: 'crit',      base: Number(pl.base_crit_chance), lvlVal: atLevel.crit,     statCode: 'CRIT_CHANCE', passiveCode: 'CRIT_CHANCE' },
      { key: 'hp',        base: Number(pl.base_hp),         lvlVal: atLevel.hp,       statCode: 'HP',          passiveCode: 'HP',         hpSpecial: true },
      { key: 'mana',      base: Number(pl.base_mana),       lvlVal: atLevel.mana,     statCode: null,          passiveCode: null          },
      { key: 'evasion',   base: 0,                          lvlVal: 0,                statCode: 'EVASION',     passiveCode: 'EVASION'     },
    ];

    const breakdown = {};
    for (const stat of STATS) {
      const levelGrowth = stat.lvlVal - stat.base;
      const equipSources = stat.statCode ? equipSourcesFor(stat.statCode) : [];
      const equipTotal = equipSources.reduce((s, e) => s + e.value, 0);
      const passiveBase = stat.hpSpecial ? (stat.lvlVal + equipTotal) : stat.lvlVal;
      const passiveSources = stat.passiveCode ? passiveSourcesFor(stat.passiveCode, passiveBase) : [];
      const passiveTotal = passiveSources.reduce((s, p) => s + p.value, 0);
      const total = stat.base + levelGrowth + equipTotal + passiveTotal;

      const sources = [];
      if (stat.base > 0) sources.push({ type: 'base', label: `Clase base (${pl.class_name})`, value: stat.base });
      if (levelGrowth > 0) sources.push({ type: 'level', label: `Nivel ${pl.level}`, value: levelGrowth });
      sources.push(...passiveSources);
      sources.push(...equipSources);

      breakdown[stat.key] = { total, base: stat.base, fromLevel: levelGrowth, fromPassives: passiveTotal, fromEquipment: equipTotal, sources };
    }

    res.json({ className: pl.class_name, level: pl.level, breakdown });
  } catch (error) { next(error); }
});

// ─── RECOMPENSA DIARIA / RACHA DE LOGIN (docs/backend-spec-recompensa-diaria.md) ──────────────
// Por fecha de calendario UTC, no ventana rodante de 24h: se usa (now() AT TIME ZONE 'UTC')::date
// en vez de CURRENT_DATE crudo, para no depender de la config de timezone de la sesion.

// GET /api/player/:playerId/daily-reward
router.get('/:playerId/daily-reward', requireAuth, requireSelf, async (req, res, next) => {
  const { playerId } = req.params;
  try {
    await db.query('INSERT INTO player_daily_reward(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [playerId]);
    const stateRes = await db.query(
      `SELECT current_day,
              (last_claim_date = (now() AT TIME ZONE 'UTC')::date) AS claimed_today,
              (last_claim_date = (now() AT TIME ZONE 'UTC')::date - 1) AS claimed_yesterday
       FROM player_daily_reward WHERE player_id = $1`,
      [playerId]
    );
    const { current_day: currentDay, claimed_today: claimedToday, claimed_yesterday: claimedYesterday } = stateRes.rows[0];
    const nextClaimDay = claimedYesterday ? (currentDay % 28) + 1 : (claimedToday ? currentDay : 1);

    const catalogRes = await db.query(
      `SELECT c.day_number, c.reward_type, c.item_code, i.name AS item_name, c.quantity
       FROM daily_reward_catalog c LEFT JOIN items i ON i.code = c.item_code
       ORDER BY c.day_number`
    );

    res.json({
      currentDay,
      claimedToday,
      nextClaimDay,
      calendar: catalogRes.rows.map((r) => ({
        day: r.day_number,
        rewardType: r.reward_type,
        itemCode: r.item_code,
        itemName: r.item_name,
        quantity: r.quantity,
      })),
    });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/daily-reward/claim
router.post('/:playerId/daily-reward/claim', requireAuth, requireSelf, async (req, res, next) => {
  const { playerId } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO player_daily_reward(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [playerId]);
    const stateRes = await client.query(
      `SELECT current_day,
              (last_claim_date = (now() AT TIME ZONE 'UTC')::date) AS claimed_today,
              (last_claim_date = (now() AT TIME ZONE 'UTC')::date - 1) AS claimed_yesterday
       FROM player_daily_reward WHERE player_id = $1 FOR UPDATE`,
      [playerId]
    );
    const { current_day: previousDay, claimed_today: claimedToday, claimed_yesterday: claimedYesterday } = stateRes.rows[0];

    if (claimedToday) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Ya reclamaste la recompensa de hoy.' });
    }

    const dayToGive = claimedYesterday ? (previousDay % 28) + 1 : 1;
    const streakBroken = dayToGive === 1 && previousDay !== 0 && previousDay !== 28;

    const rewardRes = await client.query(
      'SELECT reward_type, item_code, quantity FROM daily_reward_catalog WHERE day_number = $1',
      [dayToGive]
    );
    const reward = rewardRes.rows[0];

    if (reward.reward_type === 'GOLD') {
      await client.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [reward.quantity, playerId]);
    } else if (reward.reward_type === 'DUNGEON_COINS') {
      await client.query('UPDATE players SET dungeon_coins = dungeon_coins + $1 WHERE id = $2', [reward.quantity, playerId]);
    } else if (reward.reward_type === 'COSMIC_SHARDS') {
      await client.query('UPDATE players SET cosmic_shards = cosmic_shards + $1 WHERE id = $2', [reward.quantity, playerId]);
    } else {
      const itemRow = await client.query('SELECT id, name FROM items WHERE code = $1', [reward.item_code]);
      await inventory.addItem(playerId, itemRow.rows[0].id, reward.quantity, 0, 0, client);
    }

    await client.query(
      'UPDATE player_daily_reward SET current_day = $1, last_claim_date = (now() AT TIME ZONE \'UTC\')::date WHERE player_id = $2',
      [dayToGive, playerId]
    );

    await client.query('COMMIT');

    let itemName = null;
    if (reward.reward_type === 'ITEM') {
      itemName = (await db.query('SELECT name FROM items WHERE code = $1', [reward.item_code])).rows[0]?.name ?? null;
    }

    res.json({
      day: dayToGive,
      rewardType: reward.reward_type,
      itemName,
      quantity: reward.quantity,
      streakBroken,
      currentDay: dayToGive,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
