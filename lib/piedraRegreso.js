// Piedra de regreso: todo aventurero la lleva encima. Se vincula en una Estatua del Viajero y,
// desde cualquier lugar del continente, te devuelve junto a esa estatua. Tiene una recarga de 20
// minutos para que no sirva de atajo a cada rato: obliga a pensar cuándo volver a la ciudad.
// Solo las ciudades grandes tienen estatua (aldeas y campamentos no): hoy solo Aurelia.
// El aventurero nuevo la recibe SIN vincular: la guía le pide ir a la estatua a vincularla, y hasta
// entonces no sirve (las cuentas de antes quedaron vinculadas a Aurelia, como estaban).
const db = require('../db/db');

const RECARGA_MIN = 20;
// estatuas donde se puede vincular (una por ciudad grande): zona y posición (px, locales a la
// zona) donde te deja, justo delante de la estatua
const VINCULOS = {
  aurelia: { zona: 'aurelia', x: 52 * 32 + 16, y: 48 * 32 + 8, nombre: 'Aurelia', lugar: 'la Plaza del Pilar' },
};
// estatua de la capital (donde empiezan todos): la que nombran los avisos de "sin vincular"
const VINCULO_INICIAL = 'aurelia';

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_hearthstones (
      player_id  INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      vinculo    TEXT NOT NULL DEFAULT 'aurelia',
      used_at    TIMESTAMPTZ
    );
    -- sin vincular = NULL (la de un aventurero nuevo hasta que pasa por la estatua)
    ALTER TABLE player_hearthstones ALTER COLUMN vinculo DROP NOT NULL;
    ALTER TABLE player_hearthstones ALTER COLUMN vinculo DROP DEFAULT;`).catch((err) => { ready = null; throw err; });
  return ready;
}

function estado(row) {
  const vinculo = VINCULOS[row?.vinculo] ? row.vinculo : null;
  const readyAt = row?.used_at ? new Date(new Date(row.used_at).getTime() + RECARGA_MIN * 60000) : null;
  return {
    vinculo,
    nombre: vinculo ? VINCULOS[vinculo].nombre : null,
    lugar: vinculo ? VINCULOS[vinculo].lugar : null,
    // dónde se vincula si todavía no lo está
    estatua: { nombre: VINCULOS[VINCULO_INICIAL].nombre, lugar: VINCULOS[VINCULO_INICIAL].lugar },
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

// La piedra del aventurero nuevo: sin vincular (si ya tenía una, no se toca)
async function entregar(playerId) {
  await ensureTables();
  await db.query('INSERT INTO player_hearthstones (player_id, vinculo) VALUES ($1, NULL) ON CONFLICT DO NOTHING', [playerId]);
}

// Reclamo atómico: solo pasa si está vinculada y nunca se usó o ya terminó la recarga. Devuelve
// { sinVincular: true } si todavía no se vinculó, o null si está recargando.
async function usar(playerId) {
  await ensureTables();
  const r = await db.query(
    `UPDATE player_hearthstones SET used_at = now()
     WHERE player_id = $1 AND vinculo IS NOT NULL
       AND (used_at IS NULL OR used_at <= now() - make_interval(mins => $2))
     RETURNING vinculo, used_at`,
    [playerId, RECARGA_MIN]
  );
  if (!r.rows.length) {
    const st = await get(playerId);
    return st.vinculo ? null : { sinVincular: true, ...st };
  }
  const st = estado(r.rows[0]);
  const v = VINCULOS[st.vinculo];
  return { ...st, destino: { zona: v.zona, x: v.x, y: v.y } };
}

module.exports = { RECARGA_MIN, VINCULOS, VINCULO_INICIAL, ensureTables, get, vincular, entregar, usar };
