const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const inventory = require('../lib/inventory');
const { requireAuth, requireSelf } = require('../lib/auth');

router.use(requireAuth);
router.use(requireSelf);

// Comisión que se cobra al vendedor en cada venta concretada: saca de circulación esa moneda
// (sink), si no la economía solo suma oro/monedas de combate/quests sin ningún costo real.
const MARKET_FEE_PERCENT = 5;

const CURRENCY_COLUMN = { GOLD: 'gold', DUNGEON_COINS: 'dungeon_coins', COSMIC_SHARDS: 'cosmic_shards' };
const CURRENCY_LABEL = { GOLD: 'de oro', DUNGEON_COINS: 'monedas del abismo', COSMIC_SHARDS: 'fragmentos cósmicos' };

const PET_BONUSES_SUBQUERY = `(
  SELECT COALESCE(json_agg(json_build_object(
    'stat_code', pb.stat_code,
    'value', pb.base_amount + pb.per_level_amount * (pp.level - 1)
  )), '[]')
  FROM pet_bonuses pb WHERE pb.pet_id = pp.pet_id
)`;

function mapListingRow(r) {
  const base = {
    id: r.id,
    type: r.item_id ? 'ITEM' : 'PET',
    currency: r.currency,
    quantity: r.quantity,
    price_per_unit: r.price_per_unit,
    total_price: r.total_price,
    seller_id: r.seller_id,
    seller_nickname: r.seller_nickname,
    created_at: r.created_at,
  };
  if ('is_mine' in r) base.is_mine = r.is_mine;
  if (r.status) { base.status = r.status; base.buyer_id = r.buyer_id; base.buyer_nickname = r.buyer_nickname; base.sold_at = r.sold_at; }

  if (r.item_id) {
    base.item = {
      id: r.item_id, code: r.item_code, name: r.item_name, item_type: r.item_type,
      slot: r.slot, rarity: r.item_rarity, required_level: r.required_level,
      enchant_level: r.enchant_level, quality_tier: r.quality_tier,
    };
  } else {
    base.pet = {
      id: r.player_pet_id, code: r.pet_code, name: r.pet_name, rarity: r.pet_rarity,
      description: r.pet_description, level: r.pet_level, bond_points: r.pet_bond_points,
      bonuses: r.pet_bonuses,
    };
  }
  return base;
}

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
      `SELECT l.id, l.currency, l.quantity, l.price_per_unit,
              (l.price_per_unit * l.quantity) AS total_price,
              l.seller_id, p.nickname AS seller_nickname, l.created_at,
              (l.seller_id = $${params.length}) AS is_mine,
              l.item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.slot,
              i.rarity AS item_rarity, i.required_level, l.enchant_level, l.quality_tier,
              l.player_pet_id, pt.code AS pet_code, pt.name AS pet_name, pt.rarity AS pet_rarity,
              pt.description AS pet_description, pp.level AS pet_level, pp.bond_points AS pet_bond_points,
              ${PET_BONUSES_SUBQUERY} AS pet_bonuses
       FROM player_market_listings l
       LEFT JOIN items i ON i.id = l.item_id
       LEFT JOIN player_pets pp ON pp.id = l.player_pet_id
       LEFT JOIN pets pt ON pt.id = pp.pet_id
       JOIN players p ON p.id = l.seller_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderBy}`,
      params
    );
    res.json(result.rows.map(mapListingRow));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/market/mine — publicaciones propias, activas primero.
router.get('/mine', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT l.id, l.currency, l.quantity, l.price_per_unit,
              (l.price_per_unit * l.quantity) AS total_price,
              l.seller_id, l.status, l.buyer_id, pb.nickname AS buyer_nickname, l.created_at, l.sold_at,
              l.item_id, i.code AS item_code, i.name AS item_name, i.item_type, i.slot,
              i.rarity AS item_rarity, i.required_level, l.enchant_level, l.quality_tier,
              l.player_pet_id, pt.code AS pet_code, pt.name AS pet_name, pt.rarity AS pet_rarity,
              pt.description AS pet_description, pp.level AS pet_level, pp.bond_points AS pet_bond_points,
              ${PET_BONUSES_SUBQUERY} AS pet_bonuses
       FROM player_market_listings l
       LEFT JOIN items i ON i.id = l.item_id
       LEFT JOIN player_pets pp ON pp.id = l.player_pet_id
       LEFT JOIN pets pt ON pt.id = pp.pet_id
       LEFT JOIN players pb ON pb.id = l.buyer_id
       WHERE l.seller_id = $1
       ORDER BY (l.status = 'ACTIVE') DESC, l.created_at DESC
       LIMIT 50`,
      [playerId]
    );
    res.json(result.rows.map(mapListingRow));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/market/history?itemId=X&enchantLevel=Y&qualityTier=Z
// GET /api/player/:playerId/market/history?petId=X
// Referencia de precio: últimas ventas concretadas de ese ítem (por calidad exacta) o de esa
// especie de mascota (petId = pets.id, no player_pet_id — cada mascota puntual es única, lo que
// importa es a cuánto se viene vendiendo la especie). Mutuamente excluyente, igual que al publicar.
router.get('/history', async (req, res, next) => {
  const { itemId, petId } = req.query;
  const enchantLevel = parseInt(req.query.enchantLevel) || 0;
  const qualityTier = parseInt(req.query.qualityTier) || 0;

  if (itemId && petId) {
    return res.status(400).json({ error: 'itemId y petId son mutuamente excluyentes' });
  }
  if (!itemId && !petId) {
    return res.status(400).json({ error: 'Falta itemId o petId' });
  }

  try {
    let result;
    if (petId) {
      result = await db.query(
        `SELECT l.price_per_unit, l.currency, l.quantity, l.sold_at
         FROM player_market_listings l
         JOIN player_pets pp ON pp.id = l.player_pet_id
         WHERE pp.pet_id = $1 AND l.status = 'SOLD'
         ORDER BY l.sold_at DESC
         LIMIT 20`,
        [petId]
      );
    } else {
      result = await db.query(
        `SELECT price_per_unit, currency, quantity, sold_at
         FROM player_market_listings
         WHERE item_id = $1 AND enchant_level = $2 AND quality_tier = $3 AND status = 'SOLD'
         ORDER BY sold_at DESC
         LIMIT 20`,
        [itemId, enchantLevel, qualityTier]
      );
    }
    res.json({
      sales: result.rows.map((r) => ({
        pricePerUnit: r.price_per_unit,
        currency: r.currency,
        quantity: r.quantity,
        soldAt: r.sold_at,
      })),
    });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/market/listings
// body (ítem):   { itemId, enchantLevel?, qualityTier?, quantity, pricePerUnit, currency? }
// body (mascota): { playerPetId, pricePerUnit, currency? }
router.post('/listings', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, playerPetId, enchantLevel = 0, qualityTier = 0, currency = 'GOLD' } = req.body;
  const pricePerUnit = parseInt(req.body.pricePerUnit);

  if (!CURRENCY_COLUMN[currency]) return res.status(400).json({ error: 'Moneda inválida' });
  if (!pricePerUnit || pricePerUnit <= 0) {
    return res.status(400).json({ error: 'pricePerUnit (mayor a 0) es requerido' });
  }
  if (itemId && playerPetId) {
    return res.status(400).json({ error: 'No puedes publicar un ítem y una mascota en la misma publicación' });
  }
  if (!itemId && !playerPetId) {
    return res.status(400).json({ error: 'Falta itemId o playerPetId' });
  }

  try {
    if (playerPetId) {
      const petRes = await db.query(
        `SELECT pp.id, pp.is_active, p.name
         FROM player_pets pp JOIN pets p ON p.id = pp.pet_id
         WHERE pp.id = $1 AND pp.player_id = $2`,
        [playerPetId, playerId]
      );
      if (!petRes.rows.length) return res.status(404).json({ error: 'Mascota no encontrada' });
      const pet = petRes.rows[0];
      if (pet.is_active) {
        return res.status(400).json({ error: `No puedes publicar a ${pet.name} mientras está activa. Desactívala primero.` });
      }
      const existing = await db.query(
        `SELECT 1 FROM player_market_listings WHERE player_pet_id = $1 AND status = 'ACTIVE'`,
        [playerPetId]
      );
      if (existing.rows.length) return res.status(400).json({ error: 'Esa mascota ya tiene una publicación activa' });

      const insert = await db.query(
        `INSERT INTO player_market_listings(seller_id, player_pet_id, quantity, price_per_unit, currency)
         VALUES ($1,$2,1,$3,$4) RETURNING id`,
        [playerId, playerPetId, pricePerUnit, currency]
      );
      return res.json({
        success: true,
        listingId: insert.rows[0].id,
        message: `Publicaste a ${pet.name} por ${pricePerUnit} ${CURRENCY_LABEL[currency]}.`,
      });
    }

    const quantity = parseInt(req.body.quantity);
    if (!quantity || quantity <= 0) return res.status(400).json({ error: 'quantity (mayor a 0) es requerido' });

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
        `INSERT INTO player_market_listings(seller_id, item_id, enchant_level, quality_tier, quantity, price_per_unit, currency)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [playerId, itemId, enchantLevel, qualityTier, quantity, pricePerUnit, currency]
      );
      listingId = insert.rows[0].id;
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.json({ success: true, listingId, message: `Publicaste ${quantity}x ${name} a ${pricePerUnit} ${CURRENCY_LABEL[currency]} c/u.` });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/market/listings/:id — cancela una publicación propia.
// Si era un ítem, lo devuelve al inventario; si era una mascota, la fila de player_pets nunca
// se tocó, así que solo hace falta sacar la publicación de ACTIVE.
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
    if (listing.item_id) {
      await inventory.addItem(playerId, listing.item_id, listing.quantity, listing.enchant_level, listing.quality_tier, client);
    }
    await client.query('COMMIT');
    res.json({
      success: true,
      message: listing.item_id ? 'Publicación cancelada, ítem devuelto a tu inventario.' : 'Publicación cancelada.',
    });
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
// ya en SOLD (chequeo explícito abajo) en lugar de vender el mismo stack/mascota dos veces.
router.post('/listings/:id/buy', async (req, res, next) => {
  const { playerId, id } = req.params;
  const buyerId = Number(playerId);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const listingRes = await client.query(
      `SELECT l.*, i.name AS item_name, pt.name AS pet_name
       FROM player_market_listings l
       LEFT JOIN items i ON i.id = l.item_id
       LEFT JOIN player_pets pp ON pp.id = l.player_pet_id
       LEFT JOIN pets pt ON pt.id = pp.pet_id
       WHERE l.id = $1
       FOR UPDATE OF l`,
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
    const currencyColumn = CURRENCY_COLUMN[listing.currency];
    const buyerRow = await client.query(`SELECT ${currencyColumn} AS balance FROM players WHERE id = $1 FOR UPDATE`, [buyerId]);
    if (Number(buyerRow.rows[0].balance) < total) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Necesitas ${total} ${CURRENCY_LABEL[listing.currency]}. Tienes ${buyerRow.rows[0].balance}.` });
    }

    const fee = Math.floor(total * MARKET_FEE_PERCENT / 100);
    const sellerProceeds = total - fee;

    await client.query(
      `UPDATE player_market_listings SET status = 'SOLD', buyer_id = $1, sold_at = now() WHERE id = $2`,
      [buyerId, id]
    );
    await client.query(`UPDATE players SET ${currencyColumn} = ${currencyColumn} - $1 WHERE id = $2`, [total, buyerId]);
    await client.query(`UPDATE players SET ${currencyColumn} = ${currencyColumn} + $1 WHERE id = $2`, [sellerProceeds, listing.seller_id]);

    let itemName;
    if (listing.item_id) {
      await inventory.addItem(buyerId, listing.item_id, listing.quantity, listing.enchant_level, listing.quality_tier, client);
      itemName = listing.item_name;
    } else {
      await client.query('UPDATE player_pets SET player_id = $1, is_active = FALSE WHERE id = $2', [buyerId, listing.player_pet_id]);
      itemName = listing.pet_name;
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Compraste ${listing.item_id ? listing.quantity + 'x ' : ''}${itemName} por ${total} ${CURRENCY_LABEL[listing.currency]}.`,
      totalPaid: total,
      itemName,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
});

module.exports = router;
