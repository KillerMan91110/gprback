const express = require('express');
const db = require('../db/db');

const router = express.Router();

// GET /api/crafting/recipes?rarity=&zoneId=&classId=
router.get('/recipes', async (req, res, next) => {
  const { rarity, zoneId, classId } = req.query;
  const conditions = [];
  const params = [];

  if (rarity) {
    params.push(rarity);
    conditions.push(`cr.rarity = $${params.length}`);
  }
  if (zoneId) {
    params.push(zoneId);
    conditions.push(`cr.zone_id = $${params.length}`);
  }
  if (classId) {
    params.push(classId);
    conditions.push(`cr.required_class_id = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const result = await db.query(
      `SELECT cr.id, cr.code, i.name AS result_name, cr.result_quantity, cr.rarity,
              cr.required_level, cr.required_class_id, c.name AS required_class_name,
              cr.required_rank, cr.success_rate_percent, cr.craft_time_minutes,
              cr.artisan_name, mz.name AS zone_name, cr.description
       FROM crafting_recipes cr
       JOIN items i ON i.id = cr.result_item_id
       LEFT JOIN classes c ON c.id = cr.required_class_id
       LEFT JOIN monster_zones mz ON mz.id = cr.zone_id
       ${where}
       ORDER BY cr.rarity, i.name`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/crafting/recipes/:id
router.get('/recipes/:id', async (req, res, next) => {
  const { id } = req.params;

  try {
    const recipeResult = await db.query(
      `SELECT cr.id, cr.code, cr.result_item_id, i.name AS result_name, cr.result_quantity,
              cr.rarity, cr.required_level, cr.required_class_id, c.name AS required_class_name,
              cr.required_rank, cr.success_rate_percent, cr.craft_time_minutes,
              cr.artisan_name, mz.name AS zone_name, cr.description
       FROM crafting_recipes cr
       JOIN items i ON i.id = cr.result_item_id
       LEFT JOIN classes c ON c.id = cr.required_class_id
       LEFT JOIN monster_zones mz ON mz.id = cr.zone_id
       WHERE cr.id = $1`,
      [id]
    );

    if (!recipeResult.rows.length) {
      return res.status(404).json({ error: 'Receta no encontrada' });
    }

    const ingredients = await db.query(
      `SELECT ri.item_id, i.name AS item_name, ri.quantity
       FROM crafting_recipe_ingredients ri
       JOIN items i ON i.id = ri.item_id
       WHERE ri.recipe_id = $1`,
      [id]
    );

    res.json({ ...recipeResult.rows[0], ingredients: ingredients.rows });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
