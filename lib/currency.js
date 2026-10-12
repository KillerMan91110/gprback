const db = require('../db/db');

// Columnas de moneda que se pueden gastar. Lista cerrada porque el nombre de columna se interpola
// en el SQL (los parametros $n no sirven para identificadores).
const CURRENCY_COLUMNS = new Set(['gold', 'dungeon_coins', 'cosmic_shards']);

// Descuenta `amount` de la moneda del jugador SOLO si le alcanza, en un unico UPDATE atomico
// (mismo patron que /bank/deposit en routes/guilds.js). Leer el saldo, chequearlo y despues
// restar en pasos separados dejaba pasar compras simultaneas con el mismo saldo leido y el
// saldo terminaba en negativo. Devuelve el saldo nuevo, o null si no alcanzaba.
async function spendCurrency(playerId, column, amount, queryable = db) {
  if (!CURRENCY_COLUMNS.has(column)) throw new Error(`Moneda desconocida: ${column}`);
  const res = await queryable.query(
    `UPDATE players SET ${column} = ${column} - $1, updated_at = now()
     WHERE id = $2 AND ${column} >= $1 RETURNING ${column} AS balance`,
    [amount, playerId]
  );
  return res.rows.length ? Number(res.rows[0].balance) : null;
}

// Corre fn(client) dentro de una transaccion: si algo tira error a mitad de camino (por ejemplo
// addItem despues de haber cobrado), se revierte todo y el jugador no pierde la moneda.
// Si fn devuelve un objeto con `abort` (ej. { abort: true, status: 400, error: '...' }) tambien
// se revierte, sin tirar error: para los "no te alcanza" que se detectan despues de haber
// escrito algo en la misma transaccion.
async function withTransaction(fn) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query(result?.abort ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Aprender una skill pagando oro: insertar + cobrar en la misma transaccion. El INSERT va primero
// y se apoya en la clave unica de la tabla (player_skills o npc_skills): antes se pisaba el oro
// con un valor absoluto (gold = saldo_leido - costo), asi que dos requests simultaneos cobraban
// mal y cualquier oro ganado en el medio se perdia.
// table/ownerColumn/ownerId: a quien se le enseña la skill (el jugador o uno de sus NPCs).
async function learnSkillForGold(playerId, cost, { table, ownerColumn, ownerId, skillId }) {
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO ${table}(${ownerColumn}, skill_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING skill_id`,
      [ownerId, skillId]
    );
    if (!inserted.rows.length) return { abort: true, status: 400, error: 'Ya aprendiste esa skill' };
    const balance = await spendCurrency(playerId, 'gold', cost, client);
    if (balance === null) return { abort: true, status: 400, error: `No tienes suficiente oro (necesitas ${cost})` };
    return { balance };
  });
}

// Cantidad pedida por el cliente: entero entre 1 y max. Number('1.5') o valores negativos
// llegaban tal cual a los UPDATE de inventario/moneda.
function parseQuantity(raw, max = 99) {
  return Math.max(1, Math.min(max, parseInt(raw) || 1));
}

module.exports = { spendCurrency, withTransaction, learnSkillForGold, parseQuantity };
