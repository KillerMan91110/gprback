const db = require('../db/db');
const { incrementCounter } = require('./counters');

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
  const itemRes = await queryable.query('SELECT rarity FROM items WHERE id = $1', [itemId]);
  if (itemRes.rows[0]?.rarity === 'UNICO') {
    await incrementCounter(playerId, 'TESOROS_UNICOS_ENCONTRADOS', quantity);
  }
  // libro de recetas (lib/recetas.js): tener un material descubre las recetas que lo usan. Nunca
  // falla hacia afuera: un error aquí no puede romper la entrega del objeto.
  const recetas = require('./recetas');
  if (queryable === db) {
    await recetas.discoverFromItems(playerId, [itemId]).catch(() => {});
    return;
  }
  // Dentro de una transacción va en LA MISMA conexión, con un punto de guardado. Antes iba por otra
  // conexión: si la transacción ya tenía bloqueada la fila del jugador (cobrar el oro de una compra),
  // la otra conexión esperaba a que terminara y la transacción esperaba a la otra conexión. Ninguna
  // terminaba nunca y la base quedaba trabada para todos (Postgres no lo detecta como deadlock).
  try {
    await queryable.query('SAVEPOINT descubrir_receta');
    await recetas.discoverFromItems(playerId, [itemId], queryable);
    await queryable.query('RELEASE SAVEPOINT descubrir_receta');
  } catch {
    await queryable.query('ROLLBACK TO SAVEPOINT descubrir_receta').catch(() => {});
  }
}

// Error "no te alcanza": el manejador de errores del server lo devuelve como 400 con este texto
function notEnough() {
  const err = new Error('No tienes suficientes objetos para eso');
  err.status = 400;
  err.expose = true;
  return err;
}

// Nunca descuenta más de lo que hay: si no alcanza, lanza notEnough() sin tocar nada (dentro de
// una transacción, el que llama hace ROLLBACK). Antes restaba igual y borraba la fila en negativo,
// así que validar una cosa y descontar otra (otro tier, el mismo ítem dos veces, dos pedidos a la
// vez) duplicaba objetos.
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
    if (rows.rows.reduce((sum, r) => sum + Number(r.quantity), 0) < quantity) throw notEnough();
    for (const row of rows.rows) {
      if (remaining <= 0) break;
      const toRemove = Math.min(remaining, row.quantity);
      const done = await queryable.query(
        `UPDATE player_inventory SET quantity = quantity - $3
         WHERE player_id = $1 AND item_id = $2 AND enchant_level = $4 AND quality_tier = $5 AND quantity >= $3`,
        [playerId, itemId, toRemove, enchantLevel, row.quality_tier]
      );
      if (!done.rowCount) throw notEnough(); // otro pedido se lo llevó entre medio
      remaining -= toRemove;
    }
  } else {
    const done = await queryable.query(
      `UPDATE player_inventory SET quantity = quantity - $3
       WHERE player_id = $1 AND item_id = $2 AND enchant_level = $4 AND quality_tier = $5 AND quantity >= $3`,
      [playerId, itemId, quantity, enchantLevel, qualityTier]
    );
    if (!done.rowCount) throw notEnough();
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
