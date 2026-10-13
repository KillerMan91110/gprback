// Jefe mítico de zona (como las "S-rank Hunts" de FFXIV): cuando entre todos los jugadores cazan
// suficientes monstruos de una zona, al caer la noche aparece un jefe mítico en un lugar al azar.
// Se avisa a todo el mundo, tiene vida COMPARTIDA (cada intento es un combate normal contra un
// clon con la vida que le queda) y al morir reparte el botín según cuánto aportó cada uno.
const db = require('../db/db');
const leveling = require('./leveling');
const coleccion = require('./coleccion');

const MITICOS = {
  1: {
    zoneId: 1,
    zoneDir: 'pradera',
    zoneName: 'la Pradera Dorada',
    code: 'MITICO_AULLALUNA',
    name: 'Aullaluna, el Lobo Espectral',
    killsNeeded: Number(process.env.MITICO_KILLS || 150),
    maxHp: Number(process.env.MITICO_HP || 4000),
    minLevel: Number(process.env.MITICO_NIVEL || 5),
    minutes: 20,
    // casillas (de la zona) donde puede aparecer; el cliente lo acomoda en la casilla libre más cercana
    spots: [
      { name: 'el Círculo de Piedras', x: 73, y: 98 },
      { name: 'las Ruinas del Vigía', x: 25, y: 98 },
      { name: 'las Praderas del Este', x: 128, y: 55 },
      { name: 'la Colina del Molino', x: 102, y: 32 },
      { name: 'el Bosque de Robleviejo', x: 30, y: 22 },
    ],
    rumors: [
      'Dicen que los lobos de la Pradera aúllan distinto estas noches…',
      'Los granjeros juran haber visto una sombra pálida entre las espigas. ¡Algo grande ronda la Pradera de noche!',
    ],
  },
};
const ATTEMPT_COOLDOWN_S = 30;
// Fases según la vida compartida: 1 = aúlla y llama a sus esbirros, 2 = huye a otro lugar,
// 3 = luna roja (pega más fuerte y suelta más botín)
const PHASES = [0.75, 0.5, 0.25];
const MINION_CODE = 'LOBO_ESPECTRAL';
// cada esbirro cazado le baja la defensa al jefe para todos (hasta un 40%) y cuenta como aporte
const MINION_DEF_DOWN = 0.02;
const MINION_DEF_DOWN_MAX = 0.4;
const MINION_CREDIT = 40;
const RED_MOON_ATK = 1.3;
const RED_MOON_LOOT = 1.25;
const MINION = {
  code: MINION_CODE, name: 'Lobo Espectral', category: 'ESPECTRO',
  description: 'Un lobo de niebla que Aullaluna llama con su aullido. Cada uno que cae debilita a su señor.',
  scalings: [
    { level: 1, hp: 80, atk: 8, def: 14, magic_atk: 4, magic_def: 14, spd: 9, evasion: 6, crit_chance: 5, crit_damage: 10, elemental_damage: 0 },
    { level: 15, hp: 340, atk: 64, def: 110, magic_atk: 20, magic_def: 80, spd: 20, evasion: 9, crit_chance: 8, crit_damage: 10, elemental_damage: 4 },
  ],
};
// después de una cacería (muerto o ido) la zona descansa este rato antes de volver a contar
const REST_MINUTES = Number(process.env.MITICO_ESPERA ?? 60);
const MONSTER = {
  code: 'MITICO_AULLALUNA', name: 'Aullaluna, el Lobo Espectral', category: 'ESPECTRO', element: null,
  description: 'Un lobo enorme hecho de luz de luna. Solo aparece de noche, cuando la Pradera se llena de sangre.',
  // clon escalado al nivel de quien pelea (la vida de verdad es la compartida)
  scalings: [
    { level: 1, hp: 300, atk: 12, def: 26, magic_atk: 8, magic_def: 26, spd: 10, evasion: 6, crit_chance: 6, crit_damage: 10, elemental_damage: 0 },
    { level: 15, hp: 600, atk: 118, def: 210, magic_atk: 40, magic_def: 140, spd: 22, evasion: 10, crit_chance: 10, crit_damage: 20, elemental_damage: 8 },
  ],
};

// hora del juego: igual que el cliente (WorldScene.gameHour), un día de 24 minutos reales
const gameHour = () => (Date.now() / 60000) % 24;
// MITICO_NOCHE=1 solo para probar en local (siempre es de noche)
const isNight = () => { if (process.env.MITICO_NOCHE === '1') return true; const h = gameHour(); return h >= 21 || h < 5; };

let io = null;
let ready = null;
function ensureTables() {
  ready ??= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS mythic_zone_progress (
        zone_id INTEGER PRIMARY KEY,
        kills   INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS mythic_hunts (
        id           SERIAL PRIMARY KEY,
        zone_id      INTEGER NOT NULL,
        monster_code TEXT NOT NULL,
        spot_name    TEXT NOT NULL,
        spot_x       INTEGER NOT NULL,
        spot_y       INTEGER NOT NULL,
        max_hp       INTEGER NOT NULL,
        hp_remaining INTEGER NOT NULL,
        status       TEXT NOT NULL DEFAULT 'ACTIVE',
        started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        ends_at      TIMESTAMPTZ NOT NULL,
        closed_at    TIMESTAMPTZ,
        killed_by    INTEGER REFERENCES players(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS mythic_hunt_damage (
        hunt_id         INTEGER NOT NULL REFERENCES mythic_hunts(id) ON DELETE CASCADE,
        player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        total_damage    INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (hunt_id, player_id)
      );
      ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS mythic_hunt_id INTEGER;
      ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS phase SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS minion_kills INTEGER NOT NULL DEFAULT 0;
      -- una sola cacería activa a la vez aunque corran varios servidores (si dos intentan crearla
      -- en el mismo instante, el segundo choca con este índice y no hace nada)
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mythic_hunts_active ON mythic_hunts ((status)) WHERE status = 'ACTIVE';`);
    // el monstruo mítico (sin zona: así nunca sale en un encuentro normal) y su escalado
    const m = await db.query(
      `INSERT INTO monsters (code, name, zone_id, rarity, base_level, min_spawn_level, max_spawn_level, base_hp, base_atk, base_def,
         base_magic_atk, base_magic_def, base_spd, base_evasion, base_crit_chance, base_crit_damage, xp_reward, gold_reward, description, category)
       VALUES ($1, $2, NULL, 'LEGENDARY', 12, 1, 15, 600, 118, 210, 40, 140, 22, 10, 10, 20, 0, 0, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [MONSTER.code, MONSTER.name, MONSTER.description, MONSTER.category]
    );
    const monsterId = m.rows[0].id;
    // los esbirros (raros, sin zona: solo salen durante la cacería)
    const mm = await db.query(
      `INSERT INTO monsters (code, name, zone_id, rarity, base_level, min_spawn_level, max_spawn_level, base_hp, base_atk, base_def,
         base_magic_atk, base_magic_def, base_spd, base_evasion, base_crit_chance, base_crit_damage, xp_reward, gold_reward, description, category)
       VALUES ($1, $2, NULL, 'RARE', 8, 1, 15, 340, 64, 110, 20, 80, 20, 9, 8, 10, 90, 40, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [MINION.code, MINION.name, MINION.description, MINION.category]
    );
    for (const [id, def] of [[monsterId, MONSTER], [mm.rows[0].id, MINION]]) {
      const has = await db.query('SELECT 1 FROM monster_level_scalings WHERE monster_id = $1 LIMIT 1', [id]);
      if (has.rows.length) continue;
      for (const s of def.scalings) {
        await db.query(
          `INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [id, s.level, s.hp, s.atk, s.def, s.magic_atk, s.magic_def, s.spd, s.evasion, s.crit_chance, s.crit_damage, s.elemental_damage]
        );
      }
    }
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

async function activeHunt() {
  await ensureTables();
  const r = await db.query("SELECT * FROM mythic_hunts WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1");
  const h = r.rows[0];
  if (h && new Date(h.ends_at) <= new Date()) {
    await db.query("UPDATE mythic_hunts SET status = 'EXPIRED', closed_at = now() WHERE id = $1 AND status = 'ACTIVE'", [h.id]);
    await db.query('UPDATE mythic_zone_progress SET kills = 0 WHERE zone_id = $1', [h.zone_id]);
    const def = MITICOS[h.zone_id];
    addNews?.(`Al amanecer, ${def?.name ?? 'el jefe mítico'} se desvaneció entre la niebla…`);
    broadcast();
    return null;
  }
  return h ?? null;
}

async function publicState() {
  await ensureTables();
  const hunt = await activeHunt();
  const prog = await db.query('SELECT zone_id, kills FROM mythic_zone_progress');
  const kills = new Map(prog.rows.map((r) => [r.zone_id, r.kills]));
  const last = await db.query(
    `SELECT h.id, h.zone_id, h.status, h.closed_at, p.nickname AS killer FROM mythic_hunts h
     LEFT JOIN players p ON p.id = h.killed_by WHERE h.status <> 'ACTIVE' ORDER BY h.id DESC LIMIT 1`
  );
  return {
    night: isNight(),
    zones: Object.values(MITICOS).map((d) => ({
      zoneId: d.zoneId, zoneDir: d.zoneDir, name: d.name, code: d.code,
      kills: Math.min(kills.get(d.zoneId) ?? 0, d.killsNeeded), needed: d.killsNeeded,
    })),
    hunt: hunt && {
      id: hunt.id, zoneId: hunt.zone_id, zoneDir: MITICOS[hunt.zone_id]?.zoneDir, code: hunt.monster_code,
      name: MITICOS[hunt.zone_id]?.name, spot: hunt.spot_name, x: hunt.spot_x, y: hunt.spot_y,
      hp: hunt.hp_remaining, maxHp: hunt.max_hp, endsAt: hunt.ends_at, minLevel: MITICOS[hunt.zone_id]?.minLevel,
      phase: hunt.phase, minionKills: hunt.minion_kills, minionCode: MINION_CODE,
      defDown: Math.round(defDownOf(hunt) * 100), redMoon: hunt.phase >= 3,
    },
    last: last.rows[0] ? { status: last.rows[0].status, killer: last.rows[0].killer, at: last.rows[0].closed_at } : null,
  };
}

const defDownOf = (hunt) => Math.min(MINION_DEF_DOWN_MAX, (hunt?.minion_kills ?? 0) * MINION_DEF_DOWN);

// Al pasar cada umbral de vida: aullido + esbirros, huida a otro lugar, luna roja
async function advancePhase(huntId) {
  const h = (await db.query("SELECT * FROM mythic_hunts WHERE id = $1 AND status = 'ACTIVE'", [huntId])).rows[0];
  if (!h) return;
  const pct = h.hp_remaining / h.max_hp;
  const target = PHASES.filter((t) => pct <= t).length;
  if (target <= h.phase) return;
  const def = MITICOS[h.zone_id];
  for (let p = h.phase + 1; p <= target; p++) {
    if (p === 1) {
      addNews?.(`¡${def.name} aulló a la luna! Lobos espectrales recorren la Pradera.`);
      io?.emit('mythic:phase', { phase: 1, name: def.name, text: '¡Aulla a la luna! Lobos espectrales salen de la niebla. Cada uno que caces lo debilita.' });
    } else if (p === 2) {
      const others = def.spots.filter((s) => s.name !== h.spot_name);
      const spot = others[Math.floor(Math.random() * others.length)] ?? def.spots[0];
      await db.query('UPDATE mythic_hunts SET spot_name = $1, spot_x = $2, spot_y = $3 WHERE id = $4', [spot.name, spot.x, spot.y, h.id]);
      addNews?.(`¡${def.name} huyó herido hacia ${spot.name}!`);
      io?.emit('mythic:phase', { phase: 2, name: def.name, text: `¡Huyó herido hacia ${spot.name}! Síguele el rastro.` });
    } else if (p === 3) {
      addNews?.(`¡La luna se tiñe de rojo sobre ${def.name}! Está furioso… y su botín será mayor.`);
      io?.emit('mythic:phase', { phase: 3, name: def.name, text: '¡Luna roja! Pega más fuerte, pero su botín será mayor.' });
    }
  }
  await db.query('UPDATE mythic_hunts SET phase = $1 WHERE id = $2', [target, h.id]);
}

// Esbirros cazados durante la cacería (lo llama finalizeSession al ganar)
async function registerMinionKills(playerIds, enemies) {
  const n = enemies.filter((e) => e.monster_code === MINION_CODE).length;
  if (!n) return;
  try {
    const hunt = await activeHunt();
    if (!hunt) return;
    await db.query('UPDATE mythic_hunts SET minion_kills = minion_kills + $1 WHERE id = $2', [n, hunt.id]);
    for (const pid of [...new Set(playerIds)].filter(Boolean)) {
      await db.query(
        `INSERT INTO mythic_hunt_damage (hunt_id, player_id, total_damage, last_attempt_at) VALUES ($1, $2, $3, now() - interval '1 hour')
         ON CONFLICT (hunt_id, player_id) DO UPDATE SET total_damage = mythic_hunt_damage.total_damage + EXCLUDED.total_damage`,
        [hunt.id, pid, MINION_CREDIT * n]
      );
    }
    await broadcast();
  } catch (err) { console.error('[mythic] minions', err.message); }
}

async function broadcast() {
  if (!io) return;
  try { io.emit('mythic:update', await publicState()); } catch { /* nada */ }
}

let addNews = null;

async function spawn(def) {
  const spot = def.spots[Math.floor(Math.random() * def.spots.length)];
  const r = await db.query(
    `INSERT INTO mythic_hunts (zone_id, monster_code, spot_name, spot_x, spot_y, max_hp, hp_remaining, ends_at)
     SELECT $1, $2, $3, $4, $5, $6, $6, now() + ($7 || ' minutes')::interval
     WHERE NOT EXISTS (SELECT 1 FROM mythic_hunts WHERE status = 'ACTIVE')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [def.zoneId, def.code, spot.name, spot.x, spot.y, def.maxHp, String(def.minutes)]
  );
  if (!r.rows.length) return false;
  await db.query('UPDATE mythic_zone_progress SET kills = 0 WHERE zone_id = $1', [def.zoneId]);
  addNews?.(`¡Oíd, oíd! ¡${def.name} ha aparecido en ${spot.name}, en ${def.zoneName}! ¡Cazadores, a las armas!`);
  if (io) io.emit('mythic:spawn', { name: def.name, spot: spot.name, zoneDir: def.zoneDir, zoneName: def.zoneName });
  await broadcast();
  return true;
}

// Si la zona ya juntó las muertes y es de noche, aparece
async function resting(zoneId) {
  const r = await db.query(
    `SELECT 1 FROM mythic_hunts WHERE zone_id = $1 AND status <> 'ACTIVE' AND closed_at > now() - ($2 || ' minutes')::interval LIMIT 1`,
    [zoneId, String(REST_MINUTES)]
  );
  return r.rows.length > 0;
}

async function maybeSpawn(zoneId) {
  const def = MITICOS[zoneId];
  if (!def || !isNight()) return;
  if (await activeHunt()) return;
  if (await resting(zoneId)) return;
  const r = await db.query('SELECT kills FROM mythic_zone_progress WHERE zone_id = $1', [zoneId]);
  if ((r.rows[0]?.kills ?? 0) >= def.killsNeeded) await spawn(def);
}

// Cada pelea ganada suma a la cuenta de su zona (lo llama finalizeSession)
async function registerZoneKills(enemies) {
  try {
    await ensureTables();
    const codes = enemies.map((e) => e.monster_code).filter((c) => c && !coleccion.isMythic(c));
    if (!codes.length) return;
    // mientras el jefe está suelto (o la zona descansa) no se cuenta: si no, reaparecería apenas muere
    if (await activeHunt()) return;
    const r = await db.query('SELECT code, zone_id FROM monsters WHERE code = ANY($1::text[])', [codes]);
    const zoneOf = new Map(r.rows.map((m) => [m.code, m.zone_id]));
    const perZone = new Map();
    for (const c of codes) { const z = zoneOf.get(c); if (MITICOS[z]) perZone.set(z, (perZone.get(z) || 0) + 1); }
    for (const [z, n] of perZone) {
      if (await resting(z)) continue;
      const before = await db.query(
        `INSERT INTO mythic_zone_progress (zone_id, kills) VALUES ($1, $2)
         ON CONFLICT (zone_id) DO UPDATE SET kills = mythic_zone_progress.kills + EXCLUDED.kills RETURNING kills`,
        [z, n]
      );
      const k = before.rows[0].kills;
      const need = MITICOS[z].killsNeeded;
      // los rumores avisan que se acerca (a la mitad y casi lleno)
      if (k - n < need * 0.5 && k >= need * 0.5) addNews?.(MITICOS[z].rumors[0]);
      if (k - n < need * 0.9 && k >= need * 0.9) addNews?.(MITICOS[z].rumors[1]);
      await maybeSpawn(z);
    }
    await broadcast();
  } catch (err) { console.error('[mythic] registerZoneKills', err.message); }
}

// ---- después de cada intento: restar la vida compartida y, si murió, repartir
async function handleFinalize(sessionId, participants) {
  await ensureTables();
  const s = await db.query('SELECT mythic_hunt_id FROM combat_sessions WHERE id = $1', [sessionId]);
  const huntId = s.rows[0]?.mythic_hunt_id;
  if (!huntId) return null;
  const boss = participants.enemy.find((e) => coleccion.isMythic(e.monster_code));
  if (!boss) return null;
  const dealt = Math.max(0, Math.round(Number(boss.max_hp) - Number(boss.hp)));

  const abandoned = (await db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId])).rows.map((r) => r.player_id);
  const dmgByOwner = await db.query(
    `SELECT COALESCE(cp.player_id, cp.owner_player_id) AS owner_id, SUM(cl.damage) AS dmg
     FROM combat_log cl JOIN combat_participants cp ON cp.id = cl.actor_participant_id
     WHERE cl.session_id = $1 AND cl.damage > 0 AND cp.side = 'PLAYER'
       AND COALESCE(cp.player_id, cp.owner_player_id) IS NOT NULL
       AND COALESCE(cp.player_id, cp.owner_player_id) != ALL($2::int[])
     GROUP BY 1`,
    [sessionId, abandoned]
  );
  // aunque no le haya pegado, el intento cuenta para el tiempo de espera
  for (const p of participants.player.filter((x) => x.player_id)) {
    await db.query(
      `INSERT INTO mythic_hunt_damage (hunt_id, player_id, total_damage) VALUES ($1, $2, 0)
       ON CONFLICT (hunt_id, player_id) DO UPDATE SET last_attempt_at = now()`,
      [huntId, p.player_id]
    );
  }
  for (const row of dmgByOwner.rows) {
    await db.query(
      'UPDATE mythic_hunt_damage SET total_damage = total_damage + $1 WHERE hunt_id = $2 AND player_id = $3',
      [Math.round(Number(row.dmg)), huntId, row.owner_id]
    );
  }
  const mine = participants.player.find((p) => p.player_id)?.player_id;
  const myDmg = Math.round(Number(dmgByOwner.rows.find((r) => r.owner_id === mine)?.dmg ?? 0));
  if (dealt <= 0) { await broadcast(); return { dealt: 0 }; }
  const hp = await db.query(
    "UPDATE mythic_hunts SET hp_remaining = GREATEST(0, hp_remaining - $1) WHERE id = $2 AND status = 'ACTIVE' RETURNING hp_remaining",
    [dealt, huntId]
  );
  const left = hp.rows[0]?.hp_remaining;
  if (left > 0) await advancePhase(huntId);
  let summary = { dealt, hpRemaining: left ?? 0 };
  if (mine) io?.to(`player:${mine}`).emit('mythic:attempt', { dealt: myDmg || dealt, hpRemaining: left ?? 0, name: MITICOS[(await db.query('SELECT zone_id FROM mythic_hunts WHERE id = $1', [huntId])).rows[0]?.zone_id]?.name });
  if (left != null && left <= 0) {
    const last = await db.query(
      `SELECT COALESCE(cp.player_id, cp.owner_player_id) AS owner_id FROM combat_log cl
       JOIN combat_participants cp ON cp.id = cl.actor_participant_id
       WHERE cl.session_id = $1 AND cl.damage > 0 AND cp.side = 'PLAYER' ORDER BY cl.id DESC LIMIT 1`,
      [sessionId]
    );
    const killer = last.rows[0]?.owner_id ?? participants.player.find((p) => p.player_id)?.player_id ?? null;
    const claim = await db.query(
      "UPDATE mythic_hunts SET status = 'KILLED', closed_at = now(), killed_by = $1 WHERE id = $2 AND status = 'ACTIVE' RETURNING *",
      [killer, huntId]
    );
    if (claim.rows.length) {
      await db.query('UPDATE mythic_zone_progress SET kills = 0 WHERE zone_id = $1', [claim.rows[0].zone_id]);
      summary = { ...summary, killed: true, ...(await distribute(claim.rows[0], killer)) };
    }
  }
  await broadcast();
  return summary;
}

// Botín según el aporte: oro y experiencia escalan con tu parte del daño; la carta mítica es
// segura para quien más pegó y para el resto es una probabilidad que crece con su aporte.
async function distribute(hunt, killerId) {
  const def = MITICOS[hunt.zone_id];
  const rows = (await db.query(
    `SELECT d.player_id, d.total_damage, p.nickname FROM mythic_hunt_damage d JOIN players p ON p.id = d.player_id
     WHERE d.hunt_id = $1 AND d.total_damage > 0 ORDER BY d.total_damage DESC`,
    [hunt.id]
  )).rows;
  const total = rows.reduce((s, r) => s + Number(r.total_damage), 0) || 1;
  const mon = (await db.query('SELECT id FROM monsters WHERE code = $1', [hunt.monster_code])).rows[0];
  const rewards = [];
  for (const [i, r] of rows.entries()) {
    const share = Number(r.total_damage) / total;
    if (share < 0.01 && i > 0) continue;
    // luna roja: el botín es mayor
    const moon = hunt.phase >= 3 ? RED_MOON_LOOT : 1;
    const gold = Math.round((400 + 3600 * share) * moon);
    const xp = Math.round((300 + 2700 * share) * moon);
    const card = i === 0 || Math.random() < 0.15 + share;
    await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [gold, r.player_id]);
    const lv = await leveling.applyXpGain(r.player_id, xp).catch(() => null);
    if (card && mon) await coleccion.giveCard(r.player_id, mon.id);
    await coleccion.registerKills([r.player_id], [{ monster_code: hunt.monster_code }], { includeMythic: true });
    const reward = { playerId: r.player_id, name: r.nickname, share: Math.round(share * 1000) / 10, gold, xp, card, levelUp: lv?.leveledUp ? lv.newLevel : null };
    rewards.push(reward);
    io?.to(`player:${r.player_id}`).emit('mythic:reward', { ...reward, boss: def?.name, killer: killerId === r.player_id });
  }
  const killerName = rows.find((r) => r.player_id === killerId)?.nickname ?? 'Un cazador';
  addNews?.(`¡${killerName} asestó el golpe final a ${def?.name ?? 'el jefe mítico'}! ${rows.length} cazadores participaron.`);
  io?.emit('mythic:killed', { name: def?.name, zoneName: def?.zoneName, killer: killerName, hunters: rows.length, top: rows.slice(0, 3).map((r) => r.nickname) });
  return { rewards };
}

// Revisa cada 30 s: aparece si ya era hora y se cerró la noche, o vence la cacería
function start(ioInstance, newsFn) {
  io = ioInstance;
  addNews = newsFn;
  ensureTables().catch((err) => console.error('[mythic] ensureTables', err.message));
  setInterval(async () => {
    try {
      await activeHunt();
      for (const z of Object.keys(MITICOS)) await maybeSpawn(Number(z));
    } catch { /* reintenta en la próxima vuelta */ }
  }, 30000).unref?.();
}

module.exports = {
  MITICOS, ATTEMPT_COOLDOWN_S, MINION_CODE, RED_MOON_ATK, defDownOf, registerMinionKills, isNight, gameHour, ensureTables, activeHunt, publicState, broadcast,
  registerZoneKills, handleFinalize, spawn, start,
};
