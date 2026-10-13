// Piedra de regreso: todo aventurero la lleva encima. Se vincula en una Estatua del Viajero y,
// desde cualquier lugar del continente, te devuelve junto a esa estatua. Tiene una recarga de 20
// minutos para que no sirva de atajo a cada rato: obliga a pensar cuándo volver a la ciudad.
// Solo las ciudades grandes tienen estatua (aldeas y campamentos no): hoy solo Aurelia.
const db = require('../db/db');

const RECARGA_MIN = 20;
// estatuas donde se puede vincular (una por ciudad grande): zona y posición (px, locales a la
// zona) donde te deja, justo delante de la estatua
const VINCULOS = {
  aurelia: { zona: 'aurelia', x: 52 * 32 + 16, y: 48 * 32 + 8, nombre: 'Aurelia', lugar: 'la Plaza del Pilar' },
};
// sin vincular todavía, la piedra lleva a la capital (ahí empiezan todos)
const VINCULO_INICIAL = 'aurelia';

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_hearthstones (
      player_id  INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      vinculo    TEXT NOT NULL DEFAULT 'aurelia',
      used_at    TIMESTAMPTZ
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

function estado(row) {
  const vinculo = VINCULOS[row?.vinculo] ? row.vinculo : VINCULO_INICIAL;
  const readyAt = row?.used_at ? new Date(new Date(row.used_at).getTime() + RECARGA_MIN * 60000) : null;
  return {
    vinculo,
    nombre: VINCULOS[vinculo].nombre,
    lugar: VINCULOS[vinculo].lugar,
    recargaMin: RECARGA_MIN,
    readyAt: readyAt && readyAt > new Date() ? readyAt.toISOString() : null,
  };
}

async function get(playerId) {
  await ensureTables();
  const r = await db.query('SELECT vinculo, used_at FROM player_hearthstones WHERE player_id = $1', [playerId]);
  return estado(r.rows[0]);
}

async function vincular(playerId, vinculo) {
  await ensureTables();
  const r = await db.query(
    `INSERT INTO player_hearthstones (player_id, vinculo) VALUES ($1, $2)
     ON CONFLICT (player_id) DO UPDATE SET vinculo = $2
     RETURNING vinculo, used_at`,
    [playerId, vinculo]
  );
  return estado(r.rows[0]);
}

// Reclamo atómico: solo pasa si nunca se usó o si ya terminó la recarga. Devuelve null si
// todavía está recargando.
async function usar(playerId) {
  await ensureTables();
  const r = await db.query(
    `INSERT INTO player_hearthstones (player_id, vinculo, used_at) VALUES ($1, $2, now())
     ON CONFLICT (player_id) DO UPDATE SET used_at = now()
     WHERE player_hearthstones.used_at IS NULL
        OR player_hearthstones.used_at <= now() - make_interval(mins => $3)
     RETURNING vinculo, used_at`,
    [playerId, VINCULO_INICIAL, RECARGA_MIN]
  );
  if (!r.rows.length) return null;
  const st = estado(r.rows[0]);
  const v = VINCULOS[st.vinculo];
  return { ...st, destino: { zona: v.zona, x: v.x, y: v.y } };
}

module.exports = { RECARGA_MIN, VINCULOS, VINCULO_INICIAL, ensureTables, get, vincular, usar };
