const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const inventory = require('../lib/inventory');
const { requireAuth, requireSelf } = require('../lib/auth');

router.use(requireAuth);
router.use(requireSelf);

// Comisión que se cobra al vendedor en cada venta concretada: saca oro de circulación
// (sink), si no la economía solo suma oro de combate/quests sin ningún costo real.
const MARKET_FEE_PERCENT = 5;

// GET /api/player/:playerId/market/listings?search=&rarity=&sortBy=price_asc|price_desc|recent
router.get('/listings', async (req, res, next) => {
  const { playerId } = req.params;
  const { search, rarity, sortBy } = req.query;
  const conditions = [`l.status = 'ACTIVE'`];
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(`i.name ILIKE $${params.length}`);
  }
  if (rarity) {
    params.push(rarity);
    conditions.push(`i.rarity = $${params.length}`);
  }

  const orderBy = sortBy === 'price_desc' ? 'l.price_per_unit DESC'
    : sortBy === 'price_asc' ? 'l.price_per_unit ASC'
    : 'l.created_at DESC';

  try {
    params.push(playerId);
    const result = await db.query(
      `SELECT l.id, l.item_id, i.code, i.name, i.item_type, i.slot, i.rarity, i.required_level,
              l.enchant_level, l.quality_tier, l.quantity, l.price_per_unit,
              (l.price_per_unit * l.quantity) AS total_price,
              l.seller_id, p.nickname AS seller_nickname, l.created_at,
              (l.seller_id = $${params.length}) AS is_mine
       FROM player_market_listings l
       JOIN items i ON i.id = l.item_id
       JOIN players p ON p.id = l.seller_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}`,
      params
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/market/mine — publicaciones propias, activas primero.
router.get('/mine', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT l.id, l.item_id, i.name, i.rarity, l.enchant_level, l.quality_tier,
              l.quantity, l.price_per_unit, (l.price_per_unit * l.quantity) AS total_price,
              l.status, l.buyer_id, pb.nickname AS buyer_nickname, l.created_at, l.sold_at
       FROM player_market_listings l
       JOIN items i ON i.id = l.item_id
       LEFT JOIN players pb ON pb.id = l.buyer_id
       WHERE l.seller_id = $1
       ORDER BY (l.status = 'ACTIVE') DESC, l.created_at DESC
       LIMIT 50`,
      [playerId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/market/listings  body: { itemId, enchantLevel?, qualityTier?, quantity, pricePerUnit }
router.post('/listings', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, enchantLevel = 0, qualityTier = 0 } = req.body;
  const quantity = parseInt(req.body.quantity);
  const pricePerUnit = parseInt(req.body.pricePerUnit);

  if (!itemId || !quantity || quantity <= 0 || !pricePerUnit || pricePerUnit <= 0) {
    return res.status(400).json({ error: 'itemId, quantity y pricePerUnit (mayores a 0) son requeridos' });
  }

  try {
    const itemRow = await db.query('SELECT id, name, item_type FROM items WHERE id = $1', [itemId]);
    if (!itemRow.rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    const { name, item_type } = itemRow.rows[0];

    const have = await inventory.getQuantity(playerId, itemId, enchantLevel, qualityTier);
    if (have < quantity) return res.status(400).json({ error: `Solo tienes ${have}x ${name} de esa calidad` });

    if (item_type === 'EQUIPMENT') {
      const equipped = await db.query(
        'SELECT slot FROM player_equipment WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3 AND quality_tier = $4',
        [playerId, itemId, enchantLevel, qualityTier]
      );
      if (equipped.rows.length) return res.status(400).json({ error: `No puedes publicar ${name} mientras está equipado` });
    }

    const client = await db.pool.connect();
    let listingId;
    try {
      await client.query('BEGIN');
      await inventory.removeItem(playerId, itemId, quantity, enchantLevel, qualityTier, client);
      const insert = await client.query(
        `INSERT INTO player_market_listings(seller_id, item_id, enchant_level, quality_tier, quantity, price_per_unit)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [playerId, itemId, enchantLevel, qualityTier, quantity, pricePerUnit]
      );
      listingId = insert.rows[0].id;
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.json({ success: true, listingId, message: `Publicaste ${quantity}x ${name} a ${pricePerUnit} de oro c/u.` });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/market/listings/:id — cancela una publicación propia y devuelve el ítem.
router.delete('/listings/:id', async (req, res, next) => {
  const { playerId, id } = req.params;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const listingRes = await client.query(
      `UPDATE player_market_listings SET status = 'CANCELLED'
       WHERE id = $1 AND seller_id = $2 AND status = 'ACTIVE'
       RETURNING item_id, enchant_level, quality_tier, quantity`,
      [id, playerId]
    );
    if (!listingRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Publicación no encontrada o ya no está activa' });
    }
    const listing = listingRes.rows[0];
    await inventory.addItem(playerId, listing.item_id, listing.quantity, listing.enchant_level, listing.quality_tier, client);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Publicación cancelada, ítem devuelto a tu inventario.' });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

// POST /api/player/:playerId/market/listings/:id/buy
// El punto más delicado de todo el feature: si dos jugadores compran el mismo listing a la
// vez, SELECT ... FOR UPDATE serializa el acceso, así el segundo espera y luego ve status
// ya en SOLD (chequeo explícito abajo) en lugar de vender el mismo stack dos veces.
router.post('/listings/:id/buy', async (req, res, next) => {
  const { playerId, id } = req.params;
  const buyerId = Number(playerId);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const listingRes = await client.query(
      `SELECT l.*, i.name AS item_name
       FROM player_market_listings l
       JOIN items i ON i.id = l.item_id
       WHERE l.id = $1
       FOR UPDATE`,
      [id]
    );
    if (!listingRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Publicación no encontrada' });
    }
    const listing = listingRes.rows[0];
    if (listing.status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Esta publicación ya no está disponible' });
    }
    if (listing.seller_id === buyerId) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'No puedes comprar tu propia publicación' });
    }

    const total = Number(listing.price_per_unit) * listing.quantity;
    const buyerRow = await client.query('SELECT gold FROM players WHERE id = $1 FOR UPDATE', [buyerId]);
    if (Number(buyerRow.rows[0].gold) < total) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Necesitas ${total} de oro. Tienes ${buyerRow.rows[0].gold}.` });
    }

    const fee = Math.floor(total * MARKET_FEE_PERCENT / 100);
    const sellerProceeds = total - fee;

    await client.query(
      `UPDATE player_market_listings SET status = 'SOLD', buyer_id = $1, sold_at = now() WHERE id = $2`,
      [buyerId, id]
    );
    await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [total, buyerId]);
    await client.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [sellerProceeds, listing.seller_id]);
    await inventory.addItem(buyerId, listing.item_id, listing.quantity, listing.enchant_level, listing.quality_tier, client);

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Compraste ${listing.quantity}x ${listing.item_name} por ${total} de oro.`,
      totalPaid: total,
      itemName: listing.item_name,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
