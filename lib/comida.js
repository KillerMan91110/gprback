// "Bien alimentado": las comidas y elixires que dan bonos de combate (BUFF_ATK, BUFF_DEF, BUFF_MAG,
// BUFF_SPD, ALL_STATS) se pueden tomar ANTES de salir. Fuera de combate curan lo suyo y dejan al héroe
// bien alimentado un rato: cada combate que empiece mientras dure arranca con esos bonos (los aplica
// hydratePlayers en routes/combat.js). Una sola comida a la vez: la nueva reemplaza a la anterior.
// Dentro del combate se siguen usando como siempre (efecto inmediato en esa pelea).
const db = require('../db/db');

const FOOD_MINUTES = 20;
const BUFF_STATS = { BUFF_ATK: 'atk', BUFF_DEF: 'def', BUFF_MAG: 'mag', BUFF_SPD: 'spd' };
const STAT_LABEL = { atk: 'ataque', def: 'defensa', mag: 'inteligencia', spd: 'velocidad', all: 'todas las stats' };

let ready = null;
function ensureTable() {
  ready ??= db.query(`CREATE TABLE IF NOT EXISTS player_food_buffs (
    player_id  INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    item_id    INT REFERENCES items(id) ON DELETE SET NULL,
    item_name  TEXT NOT NULL,
    effects    JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
  )`).catch((err) => { ready = null; throw err; });
  return ready;
}

// bonos de combate de una comida: [{ stat: 'atk'|'def'|'mag'|'spd'|'all', amount, percent }]
function effectsOf(bonuses, qualityMult = 1) {
  const out = [];
  for (const b of bonuses) {
    const amount = Math.round(Number(b.amount) * qualityMult);
    if (BUFF_STATS[b.stat_code]) out.push({ stat: BUFF_STATS[b.stat_code], amount, percent: !!b.is_percent });
    else if (b.stat_code === 'ALL_STATS' && b.is_percent) out.push({ stat: 'all', amount, percent: true });
  }
  return out;
}

const describe = (effects) => effects.map((e) => `+${e.amount}${e.percent ? '%' : ''} de ${STAT_LABEL[e.stat]}`).join(', ');

async function eat(playerId, item, effects, client = db) {
  await ensureTable();
  const r = await client.query(
    `INSERT INTO player_food_buffs (player_id, item_id, item_name, effects, expires_at)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
     ON CONFLICT (player_id) DO UPDATE SET item_id = EXCLUDED.item_id, item_name = EXCLUDED.item_name,
       effects = EXCLUDED.effects, expires_at = EXCLUDED.expires_at
     RETURNING expires_at`,
    [playerId, item.id, item.name, JSON.stringify(effects), FOOD_MINUTES]
  );
  return { name: item.name, effects, text: describe(effects), expiresAt: r.rows[0].expires_at };
}

// comida activa de cada jugador: { playerId: { name, effects, text, expiresAt } }
async function activeFor(playerIds) {
  await ensureTable();
  const r = await db.query('SELECT player_id, item_name, effects, expires_at FROM player_food_buffs WHERE player_id = ANY($1::int[]) AND expires_at > now()', [playerIds]);
  return Object.fromEntries(r.rows.map((x) => [x.player_id, { name: x.item_name, effects: x.effects, text: describe(x.effects), expiresAt: x.expires_at }]));
}

// suma los bonos a un combatiente recién armado (los porcentajes, sobre sus stats con equipo)
function applyTo(c, effects) {
  for (const e of effects ?? []) {
    const keys = e.stat === 'all' ? ['atk', 'mag', 'def', 'spd'] : [e.stat];
    for (const k of keys) c[k] = e.percent ? Math.round(c[k] * (1 + e.amount / 100)) : c[k] + e.amount;
  }
  return c;
}

module.exports = { FOOD_MINUTES, ensureTable, effectsOf, describe, eat, activeFor, applyTo };
