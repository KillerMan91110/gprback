// Cuánto pagan los NPC por tus cosas (artesanos y maestros de gremio).
// Regla de oro: ningún NPC te paga más de la mitad de lo que cuesta ese mismo objeto en alguna
// tienda de oro. Si no, comprarle barato al artesano y revenderle al maestro (o al mismo
// artesano) daría oro infinito.
const db = require('../db/db');

const ARTISAN_BY_RARITY = { COMUN: 25, POCO_COMUN: 75, RARO: 200, EPICO: 600, LEGENDARIO: 2500 };
const MASTER_BY_RARITY = { COMUN: 20, POCO_COMUN: 50, RARO: 120, EPICO: 300, LEGENDARIO: 700 };

// tope de venta de un ítem (columna i.id): la mitad del precio más barato en una tienda de oro, y
// como mucho su tope propio (items.max_sell_price: para lo que se fabrica con cosas compradas, p. ej.
// el Agua Purificada se hace con un Frasco de 8 y no puede venderse por más). LEAST ignora el NULL.
const SELL_CAP_SQL = `(SELECT LEAST(FLOOR(MIN(s.p) / 2), i.max_sell_price) FROM (
    SELECT price AS p FROM artisan_shop WHERE item_id = i.id
    UNION ALL SELECT price FROM class_master_shop_items WHERE item_id = i.id
    UNION ALL SELECT i.buy_price WHERE i.buy_price IS NOT NULL
  ) s)`;

const capped = (value, cap) => (cap == null ? value : Math.max(1, Math.min(value, Number(cap))));

// row: { rarity, buy_price, sell_cap }
function artisanPrice(row) {
  const base = ARTISAN_BY_RARITY[row.rarity];
  return base ? capped(base, row.sell_cap) : null; // los Únicos no se venden
}

function masterPrice(row) {
  const base = row.buy_price != null ? Math.round(row.buy_price / 2) : (MASTER_BY_RARITY[row.rarity] || 10);
  return capped(base, row.sell_cap);
}

async function itemForSale(itemId, queryable = db) {
  const r = await queryable.query(`SELECT i.*, ${SELL_CAP_SQL} AS sell_cap FROM items i WHERE i.id = $1`, [itemId]);
  return r.rows[0] ?? null;
}

module.exports = { SELL_CAP_SQL, artisanPrice, masterPrice, itemForSale };
