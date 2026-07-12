const express = require('express');
const db = require('../db/db');

const router = express.Router();

// GET /api/ranks
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT code, name, min_reputation, max_reputation, xp_bonus_percent,
              shop_discount_percent, reward_bonus_percent, extra_inventory_slots, description
       FROM ranks
       ORDER BY min_reputation`
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
