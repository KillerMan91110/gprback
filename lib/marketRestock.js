// lib/marketRestock.js
// "Mercader del Reino" (players.email = SYSTEM_SELLER_EMAIL): vendedor de sistema dentro del
// mercado de jugadores, no un jugador real -- pedido explícito del usuario para que cualquiera
// (héroes incluidos) pueda comprar pociones de vida/maná con oro, sin depender de farmear las
// hierbas que las recetas de crafteo necesitan (ver tryCraftPotion en legendScheduler.js, suele
// quedarse sin stock por eso). No tiene contraseña usable (hash aleatorio, nadie la conoce) y
// nunca corre su propio bucle porque is_bot se queda en su default FALSE -- startLegendSchedule
// solo arranca leyendas con is_bot=TRUE.
//
// El mercado (routes/market.js) no soporta "comprar 3 de un lote de 15" -- /listings/:id/buy
// vende la publicación ENTERA, siempre. Pedido explícito del usuario: UNA sola publicación de 15
// por poción (no 15 filas sueltas de "1 poción", se veía mal) -- quien compre se lleva las 15
// juntas, y se repone apenas se vende esa publicación entera.
const db = require('../db/db');
const crypto = require('crypto');
const { hashPassword } = require('./auth');

const SYSTEM_SELLER_EMAIL = 'sistema-mercado@gpr.internal';
const POTION_CODES = ['POCION_DE_VIDA_MENOR', 'POCION_DE_MANA_MENOR'];
const LISTING_QUANTITY = 15;
const LISTING_COUNT_TARGET = 1; // una sola publicación de 15 por poción
const RESTOCK_THRESHOLD = 0; // repone apenas no quede ninguna activa
const PRICE_PER_UNIT = 500;

// Autosuficiente a propósito: si la cuenta no existe (primera vez, o una BD recién creada desde
// schema.sql+seed.sql) se crea sola acá, no depende de un script aparte que alguien se pueda
// olvidar de correr. La contraseña es un hash aleatorio que nadie conoce -- esta cuenta nunca
// necesita loguearse, solo existir como seller_id de player_market_listings.
let sellerIdCache = null;
async function getSystemSellerId() {
  if (sellerIdCache) return sellerIdCache;
  const existing = (await db.query('SELECT id FROM players WHERE email = $1', [SYSTEM_SELLER_EMAIL])).rows[0];
  if (existing) {
    sellerIdCache = existing.id;
    return sellerIdCache;
  }
  const hash = await hashPassword(crypto.randomBytes(24).toString('hex'));
  const created = await db.query(
    `INSERT INTO players(email, password_hash, nickname, gold) VALUES ($1, $2, 'Mercader del Reino', 0)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [SYSTEM_SELLER_EMAIL, hash]
  );
  sellerIdCache = created.rows[0].id;
  return sellerIdCache;
}

// Reabastece cada poción por separado: si le quedan RESTOCK_THRESHOLD o menos publicaciones
// ACTIVE, repone hasta LISTING_COUNT_TARGET packs de LISTING_QUANTITY unidades. Se llama
// periódicamente desde server.js (mismo patrón que tickWorldBossSchedule) y una vez al arrancar.
async function restockPotions() {
  const sellerId = await getSystemSellerId();
  for (const code of POTION_CODES) {
    const item = (await db.query('SELECT id FROM items WHERE code = $1', [code])).rows[0];
    if (!item) continue;

    const activeCountRes = await db.query(
      `SELECT COUNT(*) FROM player_market_listings WHERE seller_id = $1 AND item_id = $2 AND status = 'ACTIVE'`,
      [sellerId, item.id]
    );
    const activeCount = Number(activeCountRes.rows[0].count);
    if (activeCount > RESTOCK_THRESHOLD) continue;

    const toCreate = LISTING_COUNT_TARGET - activeCount;
    for (let i = 0; i < toCreate; i++) {
      await db.query(
        `INSERT INTO player_market_listings(seller_id, item_id, enchant_level, quality_tier, quantity, price_per_unit, currency)
         VALUES ($1, $2, 0, 0, $3, $4, 'GOLD')`,
        [sellerId, item.id, LISTING_QUANTITY, PRICE_PER_UNIT]
      );
    }
  }
}

module.exports = { restockPotions, getSystemSellerId, SYSTEM_SELLER_EMAIL, POTION_CODES, LISTING_QUANTITY };
