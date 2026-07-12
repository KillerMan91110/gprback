const db = require('../db/db');
const inventory = require('./inventory');

// Llamado desde combat.js cuando un monstruo muere en una pelea ganada. Busca, entre las
// quests que el jugador tiene ACEPTADAS (player_active_quests), los objetivos KILL_MONSTER/
// DEFEAT_BOSS que apunten a ese monstruo exacto, y los KILL_ANY_IN_ZONE de la misma zona
// cuando el monstruo es COMMON (las quests "comunes de la zona" solo cuentan rarity COMMON,
// ver descripciones en seed.sql). target_count clampea el contador para que no pase de la meta.
async function registerKill(playerId, monsterCode) {
  const monsterResult = await db.query(
    'SELECT id, zone_id, rarity FROM monsters WHERE code = $1',
    [monsterCode]
  );
  if (!monsterResult.rows.length) return;
  const monster = monsterResult.rows[0];
  const isCommon = monster.rarity === 'COMMON';

  const objectivesResult = await db.query(
    `SELECT qo.id AS objective_id, qo.quest_id, qo.target_count
     FROM player_active_quests paq
     JOIN quest_objectives qo ON qo.quest_id = paq.quest_id
     JOIN quests q ON q.id = qo.quest_id
     WHERE paq.player_id = $1
       AND (
         (qo.objective_type IN ('KILL_MONSTER', 'DEFEAT_BOSS') AND qo.monster_id = $2)
         OR (qo.objective_type = 'KILL_ANY_IN_ZONE' AND q.zone_id = $3 AND $4)
       )`,
    [playerId, monster.id, monster.zone_id, isCommon]
  );

  for (const objective of objectivesResult.rows) {
    await db.query(
      `INSERT INTO player_quest_progress(player_id, quest_id, quest_objective_id, current_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (player_id, quest_objective_id)
       DO UPDATE SET current_count = LEAST(player_quest_progress.current_count + 1, $4), updated_at = now()`,
      [playerId, objective.quest_id, objective.objective_id, objective.target_count]
    );
  }
}

// Progreso de cada objetivo de una quest para un jugador puntual: current_count en 0 si todavia
// no mato nada para ese objetivo (no hace falta insertar la fila al aceptar la quest).
async function getProgressForQuest(playerId, questId) {
  const result = await db.query(
    'SELECT quest_objective_id, current_count FROM player_quest_progress WHERE player_id = $1 AND quest_id = $2',
    [playerId, questId]
  );
  const byObjectiveId = new Map(result.rows.map((r) => [r.quest_objective_id, r.current_count]));
  return byObjectiveId;
}

async function clearProgressForQuest(playerId, questId) {
  await db.query('DELETE FROM player_quest_progress WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
}

// Adjunta a cada fila de `questRows` (debe traer .id) su lista de objetivos con el progreso
// real del jugador (`objectives: [...]`, cada uno con `current_count`). Usado por
// /quests/available y /quests/active para que el front (GuildQuests.js, MyQuests.js) pueda
// mostrar "3/10 matados" sin pegarle a /api/quests/:id por cada card. COLLECT_ITEM se resuelve
// contra player_inventory (mismo criterio que findUnmetObjective en routes/players.js);
// el resto contra player_quest_progress.
async function attachObjectives(playerId, questRows) {
  if (!questRows.length) return questRows.map((q) => ({ ...q, objectives: [] }));

  const questIds = questRows.map((q) => q.id);
  const objectivesResult = await db.query(
    `SELECT qo.id AS objective_id, qo.quest_id, qo.objective_type, qo.monster_id, qo.item_id,
            qo.target_count, qo.description, m.name AS monster_name, i.name AS item_name
     FROM quest_objectives qo
     LEFT JOIN monsters m ON m.id = qo.monster_id
     LEFT JOIN items i ON i.id = qo.item_id
     WHERE qo.quest_id = ANY($1::int[])
     ORDER BY qo.id`,
    [questIds]
  );

  const progressResult = await db.query(
    'SELECT quest_objective_id, current_count FROM player_quest_progress WHERE player_id = $1 AND quest_id = ANY($2::int[])',
    [playerId, questIds]
  );
  const progressByObjectiveId = new Map(progressResult.rows.map((r) => [r.quest_objective_id, r.current_count]));

  const itemIds = [...new Set(objectivesResult.rows.filter((o) => o.objective_type === 'COLLECT_ITEM').map((o) => o.item_id))];
  const inventoryByItemId = new Map();
  for (const itemId of itemIds) {
    inventoryByItemId.set(itemId, await inventory.getQuantity(playerId, itemId));
  }

  const objectivesByQuestId = new Map();
  for (const o of objectivesResult.rows) {
    const currentCount = o.objective_type === 'COLLECT_ITEM'
      ? Math.min(inventoryByItemId.get(o.item_id) || 0, o.target_count)
      : Math.min(progressByObjectiveId.get(o.objective_id) || 0, o.target_count);

    if (!objectivesByQuestId.has(o.quest_id)) objectivesByQuestId.set(o.quest_id, []);
    objectivesByQuestId.get(o.quest_id).push({ ...o, current_count: currentCount });
  }

  return questRows.map((q) => ({ ...q, objectives: objectivesByQuestId.get(q.id) || [] }));
}

module.exports = { registerKill, getProgressForQuest, clearProgressForQuest, attachObjectives };
