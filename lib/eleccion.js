// Misiones que se excluyen: elecciones de la historia (la T14 de la Tundra, «El perdón» o «La
// justicia»). Aceptar una esconde la otra; al entregarla la elección queda para siempre (si la
// abandonas antes de entregarla, la otra vuelve a aparecer).
const db = require('../db/db');

const PARES = [
  ['TUNDRA_HISTORIA_14_PERDON', 'TUNDRA_HISTORIA_14_JUSTICIA'],
];
const RIVAL = new Map(PARES.flatMap(([a, b]) => [[a, b], [b, a]]));

// la rival de una misión (código), o null
const rivalDe = (code) => RIVAL.get(code) ?? null;

// códigos de las misiones con rival que el jugador tiene en curso o ya entregó
async function elegidas(playerId) {
  const codes = [...RIVAL.keys()];
  const r = await db.query(
    `SELECT q.code FROM quests q
     WHERE q.code = ANY($2::text[]) AND (
       EXISTS (SELECT 1 FROM player_active_quests a WHERE a.player_id = $1 AND a.quest_id = q.id)
       OR EXISTS (SELECT 1 FROM player_quest_completions c WHERE c.player_id = $1 AND c.quest_id = q.id))`,
    [playerId, codes]
  );
  return new Set(r.rows.map((x) => x.code));
}

// ¿está tapada esta misión porque el jugador ya eligió la otra?
const tapada = (code, yaElegidas) => { const r = rivalDe(code); return !!r && yaElegidas.has(r); };

module.exports = { PARES, rivalDe, elegidas, tapada };
