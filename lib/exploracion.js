// Exploración del mundo 2D: el mapa (M) empieza tapado y se descubre al caminar. Se guarda por
// jugador y por zona:
//   - qué cuadros del mapa ya pisó (cuadros de 4x4 casillas, como bits en base64)
//   - qué subzonas descubrió (cada una da un poco de XP; descubrir todas las de una zona, un premio)
//   - qué cofres secretos abrió (escondidos en rincones del mapa; se abren una sola vez)
const db = require('../db/db');
const leveling = require('./leveling');
const coleccion = require('./coleccion');
const { withTransaction } = require('./currency');
const { cercaDe, positionOf } = require('./cercania');

// subzonas que cuentan para "explorar toda la zona" (las de la zona entera no cuentan)
const ZONES = {
  pradera: {
    name: 'la Pradera Dorada',
    subzones: ['Aldea Espiga', 'Colina del Molino', 'Lago Cristalino', 'Camino Real', 'Guarida de la Manada', 'Bosque de Robleviejo',
      'Campos de Espiga', 'Ruinas del Vigía', 'Círculo de Piedras', 'Corazón de la Pradera', 'Tierras Heridas', 'Praderas del Este'],
    complete: { gold: 600, xp: 500 },
    // rectángulos de cada subzona en píxeles locales (copiados de public/assets/mundo/pradera/mundo.json
    // del front): para comprobar que el jugador de verdad está ahí al descubrirla
    rects: {
      'Aldea Espiga': [2048, 1216, 3104, 1952], 'Colina del Molino': [2752, 640, 3808, 1440],
      'Lago Cristalino': [3200, 64, 4256, 992], 'Camino Real': [1920, 64, 3232, 1216],
      'Guarida de la Manada': [4096, 64, 5120, 1504], 'Bosque de Robleviejo': [0, 64, 1920, 1216],
      'Campos de Espiga': [0, 1216, 2048, 2464], 'Ruinas del Vigía': [0, 2464, 1632, 3840],
      'Círculo de Piedras': [1632, 2464, 3072, 3840], 'Corazón de la Pradera': [4096, 3008, 5120, 3840],
      'Tierras Heridas': [3072, 2112, 5120, 3840], 'Praderas del Este': [3104, 1440, 5120, 2112],
    },
  },
};
// margen por el retraso del socket (la última posición conocida puede ir un poco atrás)
const MARGEN_PX = 3 * 32;
const SUBZONE_XP = 60;
// cofres secretos (el punto "secreto" del mapa lleva el mismo nombre)
// x, y: casilla del cofre (locales de su zona, como en el mapa)
const SECRETS = {
  secreto_robleviejo: { zone: 'pradera', x: 22, y: 18, name: 'Tocón hueco del bosque', gold: 220, xp: 120 },
  secreto_ruinas: { zone: 'pradera', x: 2, y: 99, name: 'Cripta bajo las ruinas', gold: 320, xp: 160, card: true },
  secreto_lago: { zone: 'pradera', x: 119, y: 23, name: 'Cofre varado del lago', gold: 260, xp: 140 },
  secreto_heridas: { zone: 'pradera', x: 148, y: 69, name: 'Alijo del soldado caído', gold: 400, xp: 220, card: true },
};
const MAX_CELLS_BYTES = 4096;

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_exploration (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      zone_dir  TEXT NOT NULL,
      cells     TEXT NOT NULL DEFAULT '',
      subzones  TEXT[] NOT NULL DEFAULT '{}',
      PRIMARY KEY (player_id, zone_dir)
    );
    CREATE TABLE IF NOT EXISTS player_secrets (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      secret_id TEXT NOT NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, secret_id)
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

const validZone = (z) => typeof z === 'string' && /^[a-z0-9_]{1,32}$/.test(z);

async function state(playerId) {
  await ensureTables();
  const [rows, secrets] = await Promise.all([
    db.query('SELECT zone_dir, cells, subzones FROM player_exploration WHERE player_id = $1', [playerId]),
    db.query('SELECT secret_id FROM player_secrets WHERE player_id = $1', [playerId]),
  ]);
  const zones = {};
  for (const r of rows.rows) {
    const def = ZONES[r.zone_dir];
    zones[r.zone_dir] = { cells: r.cells, subzones: r.subzones, total: def?.subzones.length ?? null };
  }
  for (const [dir, def] of Object.entries(ZONES)) zones[dir] ??= { cells: '', subzones: [], total: def.subzones.length };
  return { zones, secrets: secrets.rows.map((s) => s.secret_id) };
}

// suma (OR) los cuadros nuevos a lo que ya tenía guardado
async function saveCells(playerId, zone, b64) {
  if (!validZone(zone) || typeof b64 !== 'string') return null;
  const add = Buffer.from(b64, 'base64');
  if (add.length > MAX_CELLS_BYTES) return null;
  await ensureTables();
  // leer y escribir con la fila bloqueada: dos guardados seguidos no se pisan los cuadros
  await withTransaction(async (client) => {
    await client.query(
      'INSERT INTO player_exploration (player_id, zone_dir) VALUES ($1, $2) ON CONFLICT DO NOTHING', [playerId, zone]
    );
    const cur = await client.query(
      'SELECT cells FROM player_exploration WHERE player_id = $1 AND zone_dir = $2 FOR UPDATE', [playerId, zone]
    );
    const old = Buffer.from(cur.rows[0]?.cells ?? '', 'base64');
    const out = Buffer.alloc(Math.max(old.length, add.length));
    for (let i = 0; i < out.length; i++) out[i] = (old[i] ?? 0) | (add[i] ?? 0);
    await client.query('UPDATE player_exploration SET cells = $3 WHERE player_id = $1 AND zone_dir = $2', [playerId, zone, out.toString('base64')]);
  });
  return { ok: true };
}

async function reward(playerId, gold, xp) {
  if (gold) await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [gold, playerId]);
  const lv = xp ? await leveling.applyXpGain(playerId, xp).catch(() => null) : null;
  return lv?.leveledUp ? lv.newLevel : null;
}

// Descubriste una subzona: XP la primera vez; si con esta completas la zona, premio grande
async function discover(playerId, zone, subzone) {
  const def = ZONES[zone];
  if (!def || !def.subzones.includes(subzone)) return { nuevo: false };
  // hay que estar dentro de la subzona (con un margen por el retraso del socket)
  const rect = def.rects?.[subzone];
  if (rect && process.env.POSICION_LIBRE !== '1') {
    const pos = positionOf(Number(playerId));
    const inside = pos && pos.zone === zone && pos.x >= rect[0] - MARGEN_PX && pos.x < rect[2] + MARGEN_PX
      && pos.y >= rect[1] - MARGEN_PX && pos.y < rect[3] + MARGEN_PX;
    if (!inside) return { nuevo: false };
  }
  await ensureTables();
  const r = await db.query(
    `INSERT INTO player_exploration (player_id, zone_dir, subzones) VALUES ($1, $2, ARRAY[$3])
     ON CONFLICT (player_id, zone_dir) DO UPDATE SET subzones = array_append(player_exploration.subzones, $3)
       WHERE NOT ($3 = ANY(player_exploration.subzones))
     RETURNING subzones`,
    [playerId, zone, subzone]
  );
  if (!r.rows.length) return { nuevo: false };
  const found = r.rows[0].subzones.length;
  const total = def.subzones.length;
  let levelUp = await reward(playerId, 0, SUBZONE_XP);
  const out = { nuevo: true, subzona: subzone, found, total, xp: SUBZONE_XP };
  if (found >= total) {
    levelUp = (await reward(playerId, def.complete.gold, def.complete.xp)) ?? levelUp;
    out.completa = { zona: def.name, ...def.complete };
  }
  out.levelUp = levelUp;
  return out;
}

// Abriste un cofre secreto (una sola vez por jugador)
async function openSecret(playerId, id) {
  const def = SECRETS[id];
  if (!def) return { error: 'Aquí no hay nada' };
  if (!cercaDe(playerId, def.zone, def.x, def.y, 4)) return { error: 'Acércate al escondite para examinarlo' };
  await ensureTables();
  const ins = await db.query('INSERT INTO player_secrets (player_id, secret_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING 1', [playerId, id]);
  if (!ins.rows.length) return { error: 'Ya abriste este escondite' };
  const levelUp = await reward(playerId, def.gold, def.xp);
  let card = null;
  if (def.card) {
    // una carta al azar de los monstruos de esa zona
    const m = await db.query(
      `SELECT m.id, m.code, m.name, m.rarity, m.category FROM monsters m JOIN monster_zones z ON z.id = m.zone_id
       WHERE z.id = 1 AND m.rarity IN ('COMMON', 'RARE') ORDER BY random() LIMIT 1`
    );
    if (m.rows[0]) {
      await coleccion.giveCard(playerId, m.rows[0].id);
      card = { name: m.rows[0].name, rarity: coleccion.rarityOf(m.rows[0]) };
    }
  }
  return { ok: true, name: def.name, gold: def.gold, xp: def.xp, card, levelUp };
}

module.exports = { ZONES, SECRETS, ensureTables, state, saveCells, discover, openSecret };
