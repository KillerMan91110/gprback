// La Cripta del Vigía: mazmorra hecha a mano bajo las Ruinas del Vigía (Pradera Dorada). Es una
// zona propia del mundo 2D (gpr/public/assets/mundo/cripta, generada por art/mapas/generar_cripta.js).
//
//   - Guardianes visibles que patrullan (como en Etrian Odyssey): si te ven, te persiguen. Cada
//     uno es un combate con escolta. Vencidos, no vuelven hasta que termine tu recorrido.
//   - Braseros de control (como en Dofus): al encender uno, si caes o sales retomas desde ahí.
//   - La Puerta del Vigía se abre al vencer a los tres guardianes.
//   - El jefe, el Vigía Caído, tiene dos mecánicas propias (ganchos en routes/combat.js):
//       · escudo cuya debilidad cambia cada vez que se recupera de una rotura (Octopath);
//       · el faro: marca a un héroe y al turno siguiente le lanza un rayo enorme, salvo que ese
//         héroe se haya puesto a Defender (una "trampa" anunciada, como en Wizard101).
//   - Al vencerlo se abre el cofre del Vigía (una vez cada 3 h por jugador) y la cripta queda
//     completada: no vuelve a salir nadie mientras sigas adentro. Al salir y volver a entrar se
//     recorre de nuevo. Un recorrido sin tocar en 24 h también se reinicia.
// Se puede entrar con los compañeros NPC (van en la formación) y en grupo con otros jugadores
// (los que estén a tu lado entran al combate, como en la hierba alta).
const db = require('../db/db');
const inventory = require('./inventory');
const { cercaDe, positionOf } = require('./cercania');
const { monsterRow } = require('./equilibrio');

const ZONE_DIR = 'cripta';
const MIN_LEVEL = Number(process.env.CRIPTA_NIVEL || 5);
const BOSS_CODE = 'CRIPTA_VIGIA';
// el cofre del Vigía se puede volver a abrir cada 3 horas (la cripta se repite cuando quieras)
const CHEST_HOURS = Number(process.env.CRIPTA_COFRE_HORAS ?? 3);
const RUN_RESET_HOURS = 24;

// Casillas locales de la cripta (iguales que en generar_cripta.js)
const BRASEROS = {
  1: { x: 16, y: 7, name: 'el Brasero de la Antesala' },
  2: { x: 12, y: 40, name: 'el Brasero del Osario' },
};
const GUARDIANES = {
  centinela_norte: { name: 'Centinela de Hueso', box: [5, 25, 34, 25], monsters: ['CRIPTA_CENTINELA', 'CRIPTA_CENTINELA'] },
  centinela_sur: { name: 'Centinela de Hueso', box: [5, 28, 34, 28], monsters: ['CRIPTA_CENTINELA', 'CRIPTA_ESPECTRO'] },
  espectro_osario: { name: 'Espectro de la Cripta', box: [11, 41, 28, 45], monsters: ['CRIPTA_ESPECTRO', 'CRIPTA_CENTINELA', 'CRIPTA_ESPECTRO'] },
};
const BOSS_SPOT = { x: 20, y: 54 };
// margen (casillas) para aceptar que estás junto a un guardián: patrulla y el socket va con retraso
const GUARD_MARGIN = 6;

// Debilidades que va tomando el escudo del Vigía (ids de la tabla elements)
const WEAK_CYCLE = [7, 1, 3]; // Luz → Fuego → Rayo → Luz…
const ELEMENT_NAME = { 1: 'el Fuego', 2: 'el Hielo', 3: 'el Rayo', 4: 'el Viento', 5: 'la Tierra', 6: 'el Agua', 7: 'la Luz', 8: 'la Oscuridad' };
const ELEMENT_CODE = { 1: 'FIRE', 2: 'ICE', 3: 'LIGHTNING', 4: 'WIND', 5: 'EARTH', 6: 'WATER', 7: 'LIGHT', 8: 'DARK' };
// El faro: cada tantos turnos marca a alguien; el rayo quita este % de la vida máxima
const BEAM_EVERY = 3;
const BEAM_PCT = 0.55;
const BEAM_GUARDED_PCT = 0.08;

const MONSTERS = [
  {
    code: 'CRIPTA_CENTINELA', name: 'Centinela de Hueso', rarity: 'RARE', category: 'MUERTO_VIVIENTE', base: 8, xp: 300, gold: 120,
    description: 'Soldados del Vigía que siguen haciendo la ronda siglos después de morir. Odian la luz y el fuego.',
    resist: { 7: -50, 1: -30, 8: 50 },
    // curva de lib/equilibrio.js: raro con mucha defensa física
    scalings: [5, 12].map((lv) => monsterRow(lv, 'RARE', { def: 1.25, magic_def: 0.85, spd: 0.9 })),
  },
  {
    code: 'CRIPTA_ESPECTRO', name: 'Espectro de la Cripta', rarity: 'RARE', category: 'ESPECTRO', base: 8, xp: 340, gold: 110,
    description: 'Un alma que vaga con un farol de luz fría. Los golpes la atraviesan, pero la luz y el hielo la deshacen.',
    resist: { 7: -50, 2: -30, 5: 40, 8: 60 },
    // raro mágico: pega con magia, aguanta la magia y esquiva
    scalings: [5, 12].map((lv) => monsterRow(lv, 'RARE', { magic: true, hp: 0.85, def: 0.7, magic_def: 1.3, spd: 1.2, evasion: 4, elemental_damage: 6 })),
  },
  {
    code: BOSS_CODE, name: 'El Vigía Caído', rarity: 'LEGENDARY', category: 'MUERTO_VIVIENTE', base: 10, xp: 2200, gold: 900,
    description: 'El guardián que vigilaba la Pradera desde su torre. Su faro aún arde en el pecho: cuando te apunta con él, cúbrete.',
    resist: { 8: 50 },
    // jefe de la mazmorra, pensado para pelearlo en grupo (además dispara su faro, ver bossTurn)
    scalings: [5, 12].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.9, def: 1.1, elemental_damage: 6 })),
  },
];
const CODES = MONSTERS.map((m) => m.code);
const isCryptMonster = (code) => CODES.includes(code);

// botín de los guardianes (materiales que ya existen)
const DROPS = [
  ['CRIPTA_CENTINELA', 'FRAGMENTO_PIEDRA_VIVA', 30, 1, 2],
  ['CRIPTA_CENTINELA', 'MINERAL_DE_HIERRO', 25, 1, 2],
  ['CRIPTA_ESPECTRO', 'ESENCIA_ESPECTRAL_HELADA', 35, 1, 2],
  ['CRIPTA_VIGIA', 'FRAGMENTO_DE_LUZ', 40, 1, 1],
];
// cofre del Vigía: oro + una cosa de esta lista (peso, códigos posibles, cantidad)
const CHEST_GOLD = (level) => 500 + 40 * level;
const CHEST_POOL = [
  { w: 45, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR', 'ELIXIR_DE_REGENERACION'], qty: 2 },
  { w: 35, codes: ['ESCUDO_DE_TITAN', 'BACULO_ANTIGUO', 'ARCO_DEL_CAZADOR', 'DAGA_DE_LA_SOMBRA', 'BACULO_DE_SANACION'], qty: 1 },
  { w: 20, codes: ['FRAGMENTO_DE_LUZ', 'ORO_PURO'], qty: 1 },
];

let ready = null;
function ensureTables() {
  ready ??= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS player_crypt_runs (
        player_id    INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
        braziers     SMALLINT NOT NULL DEFAULT 0,
        guardians    TEXT[] NOT NULL DEFAULT '{}',
        clears       INTEGER NOT NULL DEFAULT 0,
        chest_at     TIMESTAMPTZ,
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS crypt_target TEXT;
      ALTER TABLE player_crypt_runs ADD COLUMN IF NOT EXISTS cleared BOOLEAN NOT NULL DEFAULT FALSE;`);
    for (const m of MONSTERS) {
      // sin zona: así nunca salen en un encuentro normal de la Pradera
      const r = await db.query(
        `INSERT INTO monsters (code, name, zone_id, rarity, base_level, min_spawn_level, max_spawn_level, base_hp, base_atk, base_def,
           base_magic_atk, base_magic_def, base_spd, base_evasion, base_crit_chance, base_crit_damage, xp_reward, gold_reward, description, category)
         VALUES ($1, $2, NULL, $3, $4, 5, 12, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
         RETURNING id`,
        [m.code, m.name, m.rarity, m.base, m.scalings[1].hp, m.scalings[1].atk, m.scalings[1].def, m.scalings[1].magic_atk, m.scalings[1].magic_def,
          m.scalings[1].spd, m.scalings[1].evasion, m.scalings[1].crit_chance, m.scalings[1].crit_damage, m.xp, m.gold, m.description, m.category]
      );
      const id = r.rows[0].id;
      const has = await db.query('SELECT 1 FROM monster_level_scalings WHERE monster_id = $1 LIMIT 1', [id]);
      if (!has.rows.length) {
        for (const s of m.scalings) {
          await db.query(
            `INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [id, s.level, s.hp, s.atk, s.def, s.magic_atk, s.magic_def, s.spd, s.evasion, s.crit_chance, s.crit_damage, s.elemental_damage]
          );
        }
      }
      for (const [el, pct] of Object.entries(m.resist)) {
        await db.query(
          `INSERT INTO monster_element_resistances (monster_id, element_id, resistance_percent) VALUES ($1, $2, $3)
           ON CONFLICT (monster_id, element_id) DO NOTHING`,
          [id, Number(el), pct]
        );
      }
    }
    for (const [code, item, chance, min, max] of DROPS) {
      await db.query(
        `INSERT INTO monster_drops (monster_id, item_id, drop_chance_percent, min_quantity, max_quantity)
         SELECT m.id, i.id, $3, $4, $5 FROM monsters m, items i
         WHERE m.code = $1 AND i.code = $2
           AND NOT EXISTS (SELECT 1 FROM monster_drops d WHERE d.monster_id = m.id AND d.item_id = i.id)`,
        [code, item, chance, min, max]
      );
    }
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

// ---------------------------------------------------------------- recorrido del jugador
async function getRun(playerId, client = db) {
  await ensureTables();
  await client.query('INSERT INTO player_crypt_runs (player_id) VALUES ($1) ON CONFLICT DO NOTHING', [playerId]);
  // recorrido abandonado: se empieza de nuevo
  await client.query(
    `UPDATE player_crypt_runs SET braziers = 0, guardians = '{}', cleared = FALSE, updated_at = now()
     WHERE player_id = $1 AND updated_at < now() - make_interval(hours => $2) AND (braziers > 0 OR cardinality(guardians) > 0 OR cleared)`,
    [playerId, RUN_RESET_HOURS]
  );
  // cripta completada: queda así mientras sigas adentro; si ya saliste, la próxima vez empieza de cero
  const pos = positionOf(Number(playerId));
  if (pos && pos.zone !== ZONE_DIR) await resetIfCleared(playerId, client);
  return (await client.query('SELECT * FROM player_crypt_runs WHERE player_id = $1', [playerId])).rows[0];
}

// al salir de la cripta (o al volver a entrar desde afuera) un recorrido completado se reinicia
async function resetIfCleared(playerId, client = db) {
  await client.query(
    `UPDATE player_crypt_runs SET braziers = 0, guardians = '{}', cleared = FALSE, updated_at = now()
     WHERE player_id = $1 AND cleared`,
    [playerId]
  );
}

function publicRun(run) {
  const chestReadyAt = run.chest_at ? new Date(new Date(run.chest_at).getTime() + CHEST_HOURS * 3600000) : null;
  const down = run.guardians ?? [];
  const brazier = BRASEROS[run.braziers];
  return {
    braziers: run.braziers,
    guardians: down,
    totalGuardians: Object.keys(GUARDIANES).length,
    doorOpen: run.cleared || Object.keys(GUARDIANES).every((g) => down.includes(g)),
    // ya venciste al Vigía en este recorrido: no queda nadie (sal y vuelve a entrar para repetirla)
    cleared: !!run.cleared,
    clears: run.clears,
    chestReadyAt: chestReadyAt && chestReadyAt > new Date() ? chestReadyAt : null,
    // dónde retomas (casilla local de la cripta): el último brasero encendido o la entrada
    respawn: brazier ? { x: brazier.x, y: brazier.y + 1, name: brazier.name } : null,
    minLevel: MIN_LEVEL,
  };
}

// La Puerta del Vigía está sellada hasta que Aldren te da su llave en la misión «La torre que
// vigilaba» (o hasta que ya la completaste). Así la mazmorra se descubre con la historia.
const ACCESS_QUEST = 'PRADERA_HISTORIA_08_TORRE';
const KEY_ITEM = 'LLAVE_DEL_VIGIA';
async function hasAccess(playerId) {
  const r = await db.query(
    `SELECT EXISTS (SELECT 1 FROM player_quest_completions pqc JOIN quests q ON q.id = pqc.quest_id
                    WHERE pqc.player_id = $1 AND q.code = $2)
         OR EXISTS (SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
                    WHERE pi.player_id = $1 AND i.code = $3 AND pi.quantity > 0) AS ok`,
    [playerId, ACCESS_QUEST, KEY_ITEM]
  ).catch(() => ({ rows: [{ ok: true }] }));
  return !!r.rows[0]?.ok;
}
const SEALED = 'La Puerta del Vigía está sellada con símbolos que no entiendes. Quizás Aldren, en la Aldea Espiga, sepa algo.';

async function state(playerId) {
  return { ...publicRun(await getRun(playerId)), sealed: !(await hasAccess(playerId)), sealedText: SEALED };
}

async function lightBrazier(playerId, orden) {
  if (!(await hasAccess(playerId))) return { error: SEALED };
  const b = BRASEROS[orden];
  if (!b) return { error: 'Aquí no hay ningún brasero' };
  if (!cercaDe(playerId, ZONE_DIR, b.x, b.y, 4)) return { error: 'Acércate al brasero para encenderlo' };
  await getRun(playerId);
  const r = await db.query(
    'UPDATE player_crypt_runs SET braziers = GREATEST(braziers, $2), updated_at = now() WHERE player_id = $1 RETURNING *',
    [playerId, orden]
  );
  // el grupo comparte el recorrido: el brasero también queda encendido para los compañeros que
  // estén en la cripta (los guardianes ya se comparten al pelear juntos)
  const mates = (await db.query(
    `SELECT m2.player_id FROM player_coop_group_members m1
     JOIN player_coop_group_members m2 ON m2.group_id = m1.group_id AND m2.player_id <> m1.player_id
     WHERE m1.player_id = $1`,
    [playerId]
  ).catch(() => ({ rows: [] }))).rows.map((x) => x.player_id);
  for (const mate of mates) {
    if (!cercaDe(mate, ZONE_DIR)) continue;
    await getRun(mate);
    await db.query('UPDATE player_crypt_runs SET braziers = GREATEST(braziers, $2), updated_at = now() WHERE player_id = $1', [mate, orden]);
  }
  return { ...publicRun(r.rows[0]), lit: b.name };
}

// ---------------------------------------------------------------- combates
const fightLevel = (heroLevel, boss) => Math.max(boss ? 6 : 5, Math.min(boss ? 13 : 12, heroLevel + (boss ? 1 : 0)));

// ¿puede pelear contra este guardián / el jefe? Devuelve { error } o { specs, target }
async function prepareFight(playerId, target, heroLevel) {
  await ensureTables();
  if (heroLevel < MIN_LEVEL) return { error: `La cripta es peligrosa: necesitas nivel ${MIN_LEVEL}` };
  if (!(await hasAccess(playerId))) return { error: SEALED };
  if ((await getRun(playerId)).cleared) return { error: 'Ya limpiaste la cripta. Sal y vuelve a entrar para recorrerla otra vez.' };
  const run = await getRun(playerId);
  if (target === 'jefe') {
    if (!publicRun(run).doorOpen) return { error: 'La Puerta del Vigía sigue sellada: vence antes a los tres guardianes' };
    if (!cercaDe(playerId, ZONE_DIR, BOSS_SPOT.x, BOSS_SPOT.y, 7)) return { error: 'Acércate al Vigía para desafiarlo' };
    return { target: 'jefe', specs: [{ code: BOSS_CODE, level: fightLevel(heroLevel, true) }] };
  }
  const g = GUARDIANES[target];
  if (!g) return { error: 'Ese guardián no existe' };
  if ((run.guardians ?? []).includes(target)) return { error: 'Ese guardián ya cayó en este recorrido' };
  const [x0, y0, x1, y1] = g.box;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const radius = Math.hypot(x1 - x0, y1 - y0) / 2 + GUARD_MARGIN;
  if (!cercaDe(playerId, ZONE_DIR, cx, cy, radius)) return { error: 'Ese guardián está lejos' };
  const level = fightLevel(heroLevel, false);
  return { target, specs: g.monsters.map((code) => ({ code, level })) };
}

function pickChest() {
  const total = CHEST_POOL.reduce((s, p) => s + p.w, 0);
  let r = Math.random() * total;
  const p = CHEST_POOL.find((x) => (r -= x.w) < 0) ?? CHEST_POOL[0];
  return { code: p.codes[Math.floor(Math.random() * p.codes.length)], qty: p.qty };
}

// Al terminar un combate de la cripta: guardianes vencidos y, si cayó el Vigía, el cofre
async function handleFinalize(sessionId, status, participants, addNews) {
  const s = await db.query('SELECT crypt_target FROM combat_sessions WHERE id = $1', [sessionId]).catch(() => ({ rows: [] }));
  const target = s.rows[0]?.crypt_target;
  if (!target || status !== 'PLAYER_WON') return null;
  const abandoned = (await db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId])).rows.map((r) => r.player_id);
  const heroes = participants.player.filter((p) => p.player_id && !abandoned.includes(p.player_id));
  if (!heroes.length) return null;
  const out = { target };
  for (const h of heroes) {
    const mine = h === heroes[0];
    const run = await getRun(h.player_id);
    if (target !== 'jefe') {
      const upd = await db.query(
        `UPDATE player_crypt_runs SET guardians = array_append(guardians, $2), updated_at = now()
         WHERE player_id = $1 AND NOT ($2 = ANY(guardians)) RETURNING *`,
        [h.player_id, target]
      );
      if (mine) Object.assign(out, { guardian: GUARDIANES[target]?.name, ...publicRun(upd.rows[0] ?? run) });
      continue;
    }
    // el Vigía cayó: cofre (si ya pasó su espera) y recorrido nuevo
    const pub = publicRun(run);
    let chest = null;
    if (!pub.chestReadyAt) {
      const lvl = Number(h.level) || 1;
      const gold = CHEST_GOLD(lvl);
      const pick = pickChest();
      const item = (await db.query('SELECT id, name FROM items WHERE code = $1', [pick.code])).rows[0];
      await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [gold, h.player_id]);
      if (item) await inventory.addItem(h.player_id, item.id, pick.qty);
      chest = { gold, item: item ? { name: item.name, quantity: pick.qty } : null };
    }
    const upd = await db.query(
      `UPDATE player_crypt_runs SET cleared = TRUE, clears = clears + 1,
         chest_at = CASE WHEN $2 THEN now() ELSE chest_at END, updated_at = now()
       WHERE player_id = $1 RETURNING *`,
      [h.player_id, !!chest]
    );
    if (mine) Object.assign(out, { boss: true, chest, ...publicRun(upd.rows[0]) });
  }
  if (target === 'jefe' && addNews) {
    const names = heroes.map((h) => String(h.name ?? '').replace(/ Lv\.\d+$/, '')).filter(Boolean);
    if (names.length) addNews(`¡${names.join(' y ')} ${names.length > 1 ? 'han' : 'ha'} derrotado al Vigía Caído en la cripta bajo las ruinas!`);
  }
  return out;
}

// ---------------------------------------------------------------- mecánicas del Vigía
// Filas especiales en combat_participant_buffs del jefe: WEAK_ELEM (elemento de su debilidad
// actual) y FARO_N (cuántos turnos lleva); y FARO en el héroe marcado. No expiran solas (9999).
async function initBoss(sessionId) {
  const boss = await db.query('SELECT id FROM combat_participants WHERE session_id = $1 AND monster_code = $2', [sessionId, BOSS_CODE]);
  for (const b of boss.rows) {
    await db.query(
      `INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id)
       VALUES ($1,$2,'WEAK_ELEM',$3,9999,FALSE,NULL), ($1,$2,'FARO_N',0,9999,FALSE,NULL)`,
      [sessionId, b.id, WEAK_CYCLE[0]]
    );
  }
}

// elemento que hoy rompe el escudo de este combatiente (null = el de siempre, por resistencias)
async function weakElementOf(participantId) {
  const r = await db.query("SELECT applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'WEAK_ELEM'", [participantId]);
  return r.rows[0] ? Number(r.rows[0].applied_flat) : null;
}

// se recuperó de la rotura: el escudo cambia de debilidad
async function onBreakEnd(sessionId, p, round, insertLog) {
  if (p.monster_code !== BOSS_CODE) return;
  const cur = await weakElementOf(p.id);
  if (cur == null) return;
  const next = WEAK_CYCLE[(WEAK_CYCLE.indexOf(cur) + 1) % WEAK_CYCLE.length];
  await db.query("UPDATE combat_participant_buffs SET applied_flat = $1 WHERE participant_id = $2 AND stat_code = 'WEAK_ELEM'", [next, p.id]);
  await insertLog(sessionId, round, {
    actorId: p.id, targetId: p.id, action: 'SKILL',
    description: `El escudo de ${p.name} se rehace con otra forma: ahora lo rompe ${ELEMENT_NAME[next]}.`,
  });
}

// Turno del Vigía. Devuelve true si ya usó su turno (marcó o disparó el faro); false = ataca normal.
async function bossTurn({ sessionId, round, actor, participants, persistParticipant, insertLog, markNearDeathIfLow }) {
  if (actor.monster_code !== BOSS_CODE) return false;
  const heroes = participants.player.filter((p) => p.hp > 0 && !p.is_summon);
  const marked = await db.query(
    "SELECT id, participant_id FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'FARO'",
    [sessionId]
  );
  const mark = marked.rows[0];
  const done = async () => { actor.has_acted_this_round = true; await persistParticipant(actor); return true; };
  if (mark) {
    const target = participants.player.find((p) => p.id === mark.participant_id);
    if (!target || target.hp <= 0) {
      await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [mark.id]);
      return false;
    }
    // le da tiempo al marcado de actuar (y ponerse a Defender) antes de disparar
    if (!target.has_acted_this_round) return false;
    await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [mark.id]);
    const guarded = !!target.is_defending;
    const invisible = !!target.no_damage_window;
    const dmg = invisible ? 0 : Math.max(1, Math.round(Number(target.max_hp) * (guarded ? BEAM_GUARDED_PCT : BEAM_PCT)));
    target.hp = Math.max(0, target.hp - dmg);
    await persistParticipant(target);
    await markNearDeathIfLow(target);
    await insertLog(sessionId, round, {
      actorId: actor.id, action: 'SKILL', targetId: target.id, damage: dmg, evaded: invisible, hp_after: target.hp,
      description: invisible
        ? `El faro de ${actor.name} barre la sala, pero no encuentra a ${target.name}.`
        : guarded
          ? `¡El faro de ${actor.name} estalla sobre ${target.name}, que se cubrió a tiempo! Solo ${dmg} de daño.`
          : `¡El faro de ${actor.name} abrasa a ${target.name} por ${dmg}!`,
    });
    return done();
  }
  const n = await db.query(
    "UPDATE combat_participant_buffs SET applied_flat = applied_flat + 1 WHERE participant_id = $1 AND stat_code = 'FARO_N' RETURNING applied_flat",
    [actor.id]
  );
  const turn = Number(n.rows[0]?.applied_flat ?? 0);
  if (!heroes.length || turn % BEAM_EVERY !== 2) return false;
  const target = heroes[Math.floor(Math.random() * heroes.length)];
  await db.query(
    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES ($1,$2,'FARO',0,9999,TRUE,NULL)",
    [sessionId, target.id]
  );
  await insertLog(sessionId, round, {
    actorId: actor.id, action: 'SKILL', targetId: target.id,
    description: `${actor.name} fija la luz de su faro en ${target.name}… ¡Defiéndete en tu próximo turno!`,
  });
  return done();
}

module.exports = {
  resetIfCleared,
  ZONE_DIR, MIN_LEVEL, BOSS_CODE, CODES, MONSTERS, GUARDIANES, BRASEROS, ELEMENT_CODE,
  ensureTables, isCryptMonster, state, lightBrazier, prepareFight, handleFinalize,
  initBoss, weakElementOf, onBreakEnd, bossTurn,
};
