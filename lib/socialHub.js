// Ventana Social del mundo 2D: mensaje de estado, notas y favoritos de amigos, lazos de amistad
// (crecen con el tiempo que pasan juntos en el mapa) y elogios diarios entre jugadores.
// Las tablas se crean solas la primera vez (ver también db/schema.sql).
const db = require('../db/db');

let ready = null;
function ensureSocialTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_social (
      player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      status_text VARCHAR(80) NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS friend_notes (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      friend_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      note      VARCHAR(120) NOT NULL DEFAULT '',
      favorite  BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (player_id, friend_id)
    );
    CREATE TABLE IF NOT EXISTS friend_bonds (
      a_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      b_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      points         INTEGER NOT NULL DEFAULT 0,
      last_together  TIMESTAMPTZ,
      PRIMARY KEY (a_id, b_id),
      CHECK (a_id < b_id)
    );
    CREATE TABLE IF NOT EXISTS player_commends (
      id        SERIAL PRIMARY KEY,
      from_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      to_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      kind      VARCHAR(10) NOT NULL CHECK (kind IN ('valiente', 'amable', 'guia')),
      day       DATE NOT NULL DEFAULT CURRENT_DATE,
      UNIQUE (from_id, to_id, day),
      CHECK (from_id <> to_id)
    );`).catch((err) => { ready = null; throw err; });
  return ready;
}

// Lazos: minutos que pasaron juntos en el mapa (cerca uno del otro)
const BOND_TIERS = [
  { min: 0, name: 'Conocidos' },
  { min: 30, name: 'Compañeros' },
  { min: 120, name: 'Camaradas' },
  { min: 300, name: 'Hermanos de armas' },
];
function bondInfo(points = 0) {
  let i = 0;
  while (i + 1 < BOND_TIERS.length && points >= BOND_TIERS[i + 1].min) i += 1;
  const next = BOND_TIERS[i + 1];
  return { points, tier: i, name: BOND_TIERS[i].name, next: next ? { name: next.name, at: next.min } : null, from: BOND_TIERS[i].min };
}

async function friendIdsOf(playerId) {
  const r = await db.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
     FROM player_friends WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'ACCEPTED'`,
    [playerId]
  );
  return r.rows.map((x) => x.id);
}

// +1 minuto juntos a cada par de amigos (lo llama la presencia del mundo cada minuto)
async function addBondMinutes(pairs) {
  if (!pairs.length) return;
  await ensureSocialTables();
  const a = pairs.map(([x, y]) => Math.min(x, y));
  const b = pairs.map(([x, y]) => Math.max(x, y));
  await db.query(
    `INSERT INTO friend_bonds (a_id, b_id, points, last_together)
     SELECT t.a, t.b, 1, now() FROM unnest($1::int[], $2::int[]) AS t(a, b)
     ON CONFLICT (a_id, b_id) DO UPDATE SET points = friend_bonds.points + 1, last_together = now()`,
    [a, b]
  );
}

module.exports = { ensureSocialTables, bondInfo, friendIdsOf, addBondMinutes, BOND_TIERS };
