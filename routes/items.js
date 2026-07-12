const express = require('express');
const db = require('../db/db');

const router = express.Router();

// GET /api/items?type=EQUIPMENT&slot=WEAPON&rarity=RARO&classId=1
router.get('/', async (req, res, next) => {
  const { type, slot, rarity, classId } = req.query;
  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`item_type = $${params.length}`);
  }
  if (slot) {
    params.push(slot);
    conditions.push(`slot = $${params.length}`);
  }
  if (rarity) {
    params.push(rarity);
    conditions.push(`rarity = $${params.length}`);
  }
  if (classId) {
    params.push(classId);
    conditions.push(`class_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `SELECT i.id, i.code, i.name, i.item_type, i.slot, i.is_two_handed, i.rarity,
              i.class_id, c.name AS class_name, i.required_level, i.is_craftable,
              i.obtain_method, i.description
       FROM items i
       LEFT JOIN classes c ON c.id = i.class_id
       ${where}
       ORDER BY i.item_type, i.rarity, i.name`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/items/:id
router.get('/:id', async (req, res, next) => {
  const { id } = req.params;

  try {
    const itemResult = await db.query(
      `SELECT i.id, i.code, i.name, i.item_type, i.slot, i.is_two_handed, i.rarity,
              i.class_id, c.name AS class_name, i.required_level, i.is_craftable,
              i.obtain_method, i.description
       FROM items i
       LEFT JOIN classes c ON c.id = i.class_id
       WHERE i.id = $1`,
      [id]
    );

    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }

    const [bonuses, unlocks, drops] = await Promise.all([
      db.query(
        `SELECT stat_code, amount, is_percent, description
         FROM item_stat_bonuses WHERE item_id = $1`,
        [id]
      ),
      db.query(
        `SELECT s.id, s.code, s.name, s.description
         FROM item_unlocks_skill iu
         JOIN skills s ON s.id = iu.skill_id
         WHERE iu.item_id = $1`,
        [id]
      ),
      db.query(
        `SELECT m.id, m.code, m.name, md.drop_chance_percent, md.min_quantity, md.max_quantity
         FROM monster_drops md
         JOIN monsters m ON m.id = md.monster_id
         WHERE md.item_id = $1`,
        [id]
      ),
    ]);

    res.json({
      ...itemResult.rows[0],
      statBonuses: bonuses.rows,
      unlockedSkills: unlocks.rows,
      droppedBy: drops.rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
