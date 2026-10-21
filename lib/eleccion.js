// Misiones que se excluyen: elecciones de la historia (la T14 de la Tundra, «El perdón» o «La
// justicia»; en la Pradera, la parte 3 de la cerca: avisarle a Goreth o seguirle la broma a Bruno). Aceptar una esconde la otra; al entregarla la elección queda para siempre (si la
// abandonas antes de entregarla, la otra vuelve a aparecer).
const db = require('../db/db');

const PARES = [
  ['TUNDRA_HISTORIA_14_PERDON', 'TUNDRA_HISTORIA_14_JUSTICIA'],
  ['PRADERA_SEC_CERCA_3', 'PRADERA_SEC_CERCA_3_BRUNO'],
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

// Lo que sigue a una elección acepta cualquiera de las dos: si una misión pide «El perdón», también vale
// haber entregado «La justicia» (así la zona 6 no depende de qué elegiste en la Tundra).
// ¿completó el jugador la misión previa (id) o su rival?
async function previaCumplida(playerId, questId) {
  if (!questId) return true;
  const r = await db.query(
    `SELECT 1 FROM player_quest_completions c JOIN quests q ON q.id = c.quest_id
     WHERE c.player_id = $1 AND (c.quest_id = $2 OR q.code = ANY($3::text[])) LIMIT 1`,
    [playerId, questId, await rivalesDe(questId)]
  );
  return r.rows.length > 0;
}
// los códigos rivales de la misión (id), para la consulta de arriba
async function rivalesDe(questId) {
  const r = await db.query('SELECT code FROM quests WHERE id = $1', [questId]);
  const rival = rivalDe(r.rows[0]?.code);
  return rival ? [rival] : [];
}
// ids de las misiones con rival cuya rival ya entregó el jugador (cuentan como cumplidas como previa)
async function cumplidasPorRival(playerId) {
  const r = await db.query(
    `SELECT q.code FROM player_quest_completions c JOIN quests q ON q.id = c.quest_id
     WHERE c.player_id = $1 AND q.code = ANY($2::text[])`,
    [playerId, [...RIVAL.keys()]]
  );
  const rivales = r.rows.map((x) => rivalDe(x.code));
  if (!rivales.length) return new Set();
  const ids = await db.query('SELECT id FROM quests WHERE code = ANY($1::text[])', [rivales]);
  return new Set(ids.rows.map((x) => x.id));
}

module.exports = { PARES, rivalDe, elegidas, tapada, previaCumplida, cumplidasPorRival };
