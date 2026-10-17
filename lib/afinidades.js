// Afinidades descubiertas (estilo Octopath): las debilidades y resistencias de cada TIPO de monstruo
// se descubren golpeándolo con ese elemento, y quedan sabidas para siempre (también lo neutro, así
// sabes que no hace falta volver a probar). Completar su entrada del Bestiario lo revela todo. En
// un combate de grupo se ve lo que sepa cualquiera de los héroes. Lo usa routes/combat.js:
// learn() al golpear (applyBreakAndFury) y filter() al armar el estado del combate.
const db = require('../db/db');

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_known_affinities (
      player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      monster_code TEXT NOT NULL,
      element_code TEXT NOT NULL,
      learned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, monster_code, element_code)
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

// el héroe golpeó a ese tipo de monstruo con ese elemento: ya sabe cómo le afecta
async function learn(playerId, monsterCode, elementCode) {
  if (!playerId || !monsterCode || !elementCode) return;
  await ensureTables();
  await db.query(
    `INSERT INTO player_known_affinities (player_id, monster_code, element_code)
     SELECT $1, $2, $3 WHERE NOT EXISTS (
       SELECT 1 FROM player_known_affinities WHERE player_id = $1 AND monster_code = $2 AND element_code = $3)`,
    [playerId, monsterCode, elementCode]
  );
}

// qué sabe el grupo de estos monstruos: Map monster_code → Set de elementos, o 'ALL' si alguno
// completó su entrada del Bestiario
async function knownFor(playerIds, monsterCodes) {
  const out = new Map();
  if (!playerIds.length || !monsterCodes.length) return out;
  await ensureTables();
  const rows = (await db.query(
    `SELECT DISTINCT monster_code, element_code FROM player_known_affinities
     WHERE player_id = ANY($1::int[]) AND monster_code = ANY($2::text[])`,
    [playerIds, monsterCodes]
  )).rows;
  for (const r of rows) {
    if (!out.has(r.monster_code)) out.set(r.monster_code, new Set());
    out.get(r.monster_code).add(r.element_code);
  }
  const done = (await db.query(
    `SELECT DISTINCT m.code FROM player_bestiary b JOIN monsters m ON m.id = b.monster_id
     WHERE b.player_id = ANY($1::int[]) AND b.completed AND m.code = ANY($2::text[])`,
    [playerIds, monsterCodes]
  ).catch(() => ({ rows: [] }))).rows;
  for (const r of done) out.set(r.code, 'ALL');
  return out;
}

// las resistencias que ya conoce el grupo y cuántas siguen ocultas
function filter(resistances, known) {
  if (known === 'ALL') return { shown: resistances, hidden: 0 };
  const shown = {};
  let hidden = 0;
  for (const [el, v] of Object.entries(resistances ?? {})) {
    if (known?.has(el)) shown[el] = v;
    else hidden += 1;
  }
  return { shown, hidden };
}

module.exports = { ensureTables, learn, knownFor, filter };
