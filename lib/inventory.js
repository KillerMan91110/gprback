const db = require('../db/db');

// qualityTier=null en getQuantity/removeItem significa "todos los tiers" (suma o consume desde
// el más bajo). Se usa para ingredientes de crafteo y ventas, donde el tier no importa.

async function addItem(playerId, itemId, quantity, enchantLevel = 0, qualityTier = 0, queryable = db) {
  if (quantity <= 0) return;
  await queryable.query(
    `INSERT INTO player_inventory(player_id, item_id, quantity, enchant_level, quality_tier)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (player_id, item_id, enchant_level, quality_tier)
     DO UPDATE SET quantity = player_inventory.quantity + $3`,
    [playerId, itemId, quantity, enchantLevel, qualityTier]
  );
}

async function removeItem(playerId, itemId, quantity, enchantLevel = 0, qualityTier = null, queryable = db) {
  if (quantity <= 0) return;
  if (qualityTier === null) {
    // Consume desde el tier más bajo (conserva los crafteados con suerte)
    let remaining = quantity;
    const rows = await queryable.query(
      `SELECT quality_tier, quantity FROM player_inventory
       WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3 AND quantity > 0
       ORDER BY quality_tier ASC`,
      [playerId, itemId, enchantLevel]
    );
    for (const row of rows.rows) {
      if (remaining <= 0) break;
      const toRemove = Math.min(remaining, row.quantity);
      await queryable.query(
        `UPDATE player_inventory SET quantity = quantity - $3
         WHERE player_id = $1 AND item_id = $2 AND enchant_level = $4 AND quality_tier = $5`,
        [playerId, itemId, toRemove, enchantLevel, row.quality_tier]
      );
      remaining -= toRemove;
    }
  } else {
    await queryable.query(
      `UPDATE player_inventory SET quantity = quantity - $3
       WHERE player_id = $1 AND item_id = $2 AND enchant_level = $4 AND quality_tier = $5`,
      [playerId, itemId, quantity, enchantLevel, qualityTier]
    );
  }
  await queryable.query(
    `DELETE FROM player_inventory
     WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3 AND quantity <= 0`,
    [playerId, itemId, enchantLevel]
  );
}

async function getQuantity(playerId, itemId, enchantLevel = 0, qualityTier = null) {
  if (qualityTier === null) {
    const result = await db.query(
      `SELECT COALESCE(SUM(quantity), 0) AS quantity FROM player_inventory
       WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3`,
      [playerId, itemId, enchantLevel]
    );
    return Number(result.rows[0].quantity);
  }
  const result = await db.query(
    `SELECT quantity FROM player_inventory
     WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3 AND quality_tier = $4`,
    [playerId, itemId, enchantLevel, qualityTier]
  );
  return result.rows[0] ? result.rows[0].quantity : 0;
}

// Para USE_ITEM en combate: devuelve el tier más alto disponible del item.
async function getBestQualityTier(playerId, itemId, enchantLevel = 0) {
  const result = await db.query(
    `SELECT quality_tier FROM player_inventory
     WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3 AND quantity > 0
     ORDER BY quality_tier DESC LIMIT 1`,
    [playerId, itemId, enchantLevel]
  );
  return result.rows[0] ? result.rows[0].quality_tier : 0;
}

module.exports = { addItem, removeItem, getQuantity, getBestQualityTier };
