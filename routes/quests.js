const express = require('express');
const db = require('../db/db');

const router = express.Router();

async function fetchQuestDetail(idOrCode, byCode = false) {
  const column = byCode ? 'q.code' : 'q.id';
  const questResult = await db.query(
    `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
            q.chain_position, q.chain_total, q.is_boss_quest, q.requires_quest_id,
            q.min_level, q.max_level, q.difficulty_stars, q.min_rank_code,
            q.npc_name, q.location_name, q.is_repeatable, q.repeat_cooldown_hours,
            q.reputation_reward, q.gold_reward, q.xp_reward, q.hidden_unlock_text, q.description,
            q.required_class_id
     FROM quests q
     LEFT JOIN monster_zones mz ON mz.id = q.zone_id
     WHERE ${column} = $1`,
    [idOrCode]
  );

  if (!questResult.rows.length) return null;
  const quest = questResult.rows[0];

  const [objectives, rewards, hiddenRequirements] = await Promise.all([
    db.query(
      `SELECT qo.id AS objective_id, qo.objective_type, qo.monster_id, qo.item_id, qo.target_count, qo.description,
              m.name AS monster_name, i.name AS item_name
       FROM quest_objectives qo
       LEFT JOIN monsters m ON m.id = qo.monster_id
       LEFT JOIN items i ON i.id = qo.item_id
       WHERE qo.quest_id = $1`,
      [quest.id]
    ),
    db.query(
      `SELECT i.id AS item_id, i.name AS item_name, qir.quantity
       FROM quest_item_rewards qir
       JOIN items i ON i.id = qir.item_id
       WHERE qir.quest_id = $1`,
      [quest.id]
    ),
    db.query(
      `SELECT qhr.requirement_type, qhr.target_count, qhr.rank_code, qhr.percent_value, qhr.description,
              m.name AS monster_name, i.name AS item_name
       FROM quest_hidden_requirements qhr
       LEFT JOIN monsters m ON m.id = qhr.monster_id
       LEFT JOIN items i ON i.id = qhr.item_id
       WHERE qhr.quest_id = $1`,
      [quest.id]
    ),
  ]);

  return {
    ...quest,
    objectives: objectives.rows,
    itemRewards: rewards.rows,
    hiddenRequirements: hiddenRequirements.rows,
  };
}

// GET /api/quests?zoneId=&type=PRINCIPAL
router.get('/', async (req, res, next) => {
  const { zoneId, type } = req.query;
  const conditions = [];
  const params = [];

  if (zoneId) {
    params.push(zoneId);
    conditions.push(`q.zone_id = $${params.length}`);
  }
  if (type) {
    params.push(type);
    conditions.push(`q.quest_type = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
              q.chain_position, q.is_boss_quest, q.min_level, q.max_level,
              q.difficulty_stars, q.min_rank_code, q.reputation_reward, q.gold_reward, q.xp_reward
       FROM quests q
       LEFT JOIN monster_zones mz ON mz.id = q.zone_id
       ${where}
       ORDER BY q.zone_id, q.quest_type, q.chain_position`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/quests/:id
router.get('/:id', async (req, res, next) => {
  try {
    const quest = await fetchQuestDetail(req.params.id);
    if (!quest) return res.status(404).json({ error: 'Quest no encontrada' });
    res.json(quest);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.fetchQuestDetail = fetchQuestDetail;
