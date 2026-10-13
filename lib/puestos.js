// Muñecos de venta (puestos de jugador), al estilo del Hired Merchant de MapleStory y la tienda
// sentada de NosTale: le compras un muñeco a Pip el titiritero, lo plantas en el Barrio del
// Mercado de Aurelia con un cartel y tus objetos a la venta, y el muñeco vende por ti aunque te
// desconectes.
//  - lo que pones a la venta sale de tu mochila/álbum y queda guardado en el puesto
//  - cada venta te paga al momento (menos una comisión del mercado, que sale del juego)
//  - dura DURACION_H horas; al cerrarlo (o al vencer) lo que no se vendió te llega por correo
//  - el muñeco se gasta al plantarlo
const db = require('../db/db');
const inventory = require('./inventory');
const col = require('./coleccion');
const correo = require('./correo');
const { positionOf } = require('./worldPresence');
const { LUGARES } = require('./cercania');

const TILE = 32;
const MUNECO = 'MUNECO_DE_VENTA';
const PRECIO_MUNECO = 200;
const DURACION_H = 24;
const MAX_ENTRADAS = 10;
const MAX_PUESTOS_ZONA = 40;
const COMISION = 0.03;
const MAX_PRECIO = 100000000;
const SEPARACION = 2 * TILE; // entre muñecos
const ALCANCE = 4 * TILE; // para comprar hay que estar junto al muñeco
// donde se pueden plantar (casillas locales de la zona, bordes incluidos)
const MERCADOS = [{ zona: 'aurelia', x0: 66, y0: 46, x1: 87, y1: 56, nombre: 'el Barrio del Mercado de Aurelia' }];
const ASPECTOS = ['oso', 'conejo', 'gato'];

let ready = null;
function ensureTables() {
  ready ??= (async () => {
    await correo.ensureTables();
    await db.query(`
      CREATE TABLE IF NOT EXISTS player_stalls (
        id         SERIAL PRIMARY KEY,
        owner_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        zone       TEXT NOT NULL,
        x          INTEGER NOT NULL,
        y          INTEGER NOT NULL,
        title      TEXT NOT NULL,
        look       TEXT NOT NULL DEFAULT 'oso',
        opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        closed_at  TIMESTAMPTZ,
        earned     BIGINT NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_stall_owner_open ON player_stalls(owner_id) WHERE closed_at IS NULL;
      CREATE TABLE IF NOT EXISTS player_stall_items (
        id            SERIAL PRIMARY KEY,
        stall_id      INTEGER NOT NULL REFERENCES player_stalls(id) ON DELETE CASCADE,
        item_id       INTEGER REFERENCES items(id),
        monster_id    INTEGER REFERENCES monsters(id),
        enchant_level INTEGER NOT NULL DEFAULT 0,
        quality_tier  SMALLINT NOT NULL DEFAULT 0,
        quantity      INTEGER NOT NULL CHECK (quantity >= 0),
        sold          INTEGER NOT NULL DEFAULT 0,
        price         BIGINT NOT NULL CHECK (price > 0)
      );
      CREATE TABLE IF NOT EXISTS player_stall_sales (
        id         SERIAL PRIMARY KEY,
        stall_id   INTEGER NOT NULL REFERENCES player_stalls(id) ON DELETE CASCADE,
        buyer_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
        entry_id   INTEGER REFERENCES player_stall_items(id) ON DELETE SET NULL,
        name       TEXT NOT NULL,
        quantity   INTEGER NOT NULL,
        total      BIGINT NOT NULL,
        fee        BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      INSERT INTO items (code, name, item_type, rarity, is_craftable, obtain_method, buy_price, description)
      VALUES ('${MUNECO}', 'Muñeco de Venta', 'CONSUMABLE', 'POCO_COMUN', FALSE, 'SHOP', ${PRECIO_MUNECO},
              'Un muñeco de trapo que atiende tu puesto en el Barrio del Mercado de Aurelia durante ${DURACION_H} horas, aunque no estés. Úsalo allí para montar tu puesto.')
      ON CONFLICT (code) DO NOTHING;
    `);
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

const mercadoDe = (pos) => MERCADOS.find((m) => m.zona === pos.zone
  && pos.x >= m.x0 * TILE && pos.x < (m.x1 + 1) * TILE && pos.y >= m.y0 * TILE && pos.y < (m.y1 + 1) * TILE);

function userError(msg) {
  const err = new Error(msg);
  err.status = 400;
  err.expose = true;
  return err;
}

// lo que se muestra de cada entrada
const ENTRY_SQL = `
  SELECT e.id, e.item_id, e.monster_id, e.enchant_level, e.quality_tier, e.quantity, e.sold, e.price,
         COALESCE(i.name, 'Carta de ' || m.name) AS name, i.rarity, i.item_type, i.slot, i.code,
         m.rarity AS card_rarity, m.code AS card_code, m.category AS card_category
  FROM player_stall_items e
  LEFT JOIN items i ON i.id = e.item_id
  LEFT JOIN monsters m ON m.id = e.monster_id`;

function entryView(e) {
  const base = {
    id: e.id, name: e.name, quantity: e.quantity, sold: e.sold, price: Number(e.price),
  };
  if (e.monster_id) {
    const m = { code: e.card_code, rarity: e.card_rarity, category: e.card_category };
    return { ...base, kind: 'card', monsterId: e.monster_id, rarity: col.rarityOf(m), ...col.cardOf(m) };
  }
  return { ...base, kind: 'item', itemId: e.item_id, enchantLevel: e.enchant_level, qualityTier: e.quality_tier, rarity: e.rarity, itemType: e.item_type, slot: e.slot, code: e.code };
}

// Puestos abiertos de una zona (para dibujar los muñecos)
async function listZone(zone) {
  await ensureTables();
  const r = await db.query(
    `SELECT s.id, s.owner_id, p.nickname AS owner, s.x, s.y, s.title, s.look, s.expires_at,
            (SELECT COUNT(*) FROM player_stall_items e WHERE e.stall_id = s.id AND e.quantity > 0)::int AS entries
     FROM player_stalls s JOIN players p ON p.id = s.owner_id
     WHERE s.zone = $1 AND s.closed_at IS NULL AND s.expires_at > now()
     ORDER BY s.id`,
    [zone]
  );
  return r.rows;
}

async function stallView(stallId) {
  await ensureTables();
  const s = await db.query(
    `SELECT s.*, p.nickname AS owner FROM player_stalls s JOIN players p ON p.id = s.owner_id WHERE s.id = $1`,
    [stallId]
  );
  if (!s.rows.length) return null;
  const st = s.rows[0];
  const entries = await db.query(`${ENTRY_SQL} WHERE e.stall_id = $1 ORDER BY e.id`, [stallId]);
  return {
    id: st.id, ownerId: st.owner_id, owner: st.owner, title: st.title, look: st.look, zone: st.zone, x: st.x, y: st.y,
    open: !st.closed_at && new Date(st.expires_at) > new Date(), expiresAt: st.expires_at, earned: Number(st.earned),
    entries: entries.rows.map(entryView),
  };
}

// Tu puesto abierto (con sus últimas ventas) o null
async function mine(playerId) {
  await ensureTables();
  const s = await db.query('SELECT id FROM player_stalls WHERE owner_id = $1 AND closed_at IS NULL', [playerId]);
  if (!s.rows.length) return null;
  const view = await stallView(s.rows[0].id);
  const sales = await db.query(
    `SELECT ss.name, ss.quantity, ss.total, ss.fee, ss.created_at, p.nickname AS buyer
     FROM player_stall_sales ss LEFT JOIN players p ON p.id = ss.buyer_id
     WHERE ss.stall_id = $1 ORDER BY ss.id DESC LIMIT 30`,
    [s.rows[0].id]
  );
  return { ...view, sales: sales.rows.map((r) => ({ ...r, total: Number(r.total), fee: Number(r.fee) })) };
}

// Plantar el muñeco donde está el jugador
async function open(playerId, { title, look, entries }) {
  await ensureTables();
  const pos = positionOf(playerId);
  if (!pos) throw userError('Entra al mundo para montar tu puesto.');
  const mercado = mercadoDe(pos);
  if (!mercado) throw userError(`Los muñecos solo se pueden plantar en ${MERCADOS.map((m) => m.nombre).join(' o ')}.`);
  const name = String(title ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (name.length < 3) throw userError('Ponle un cartel a tu puesto (al menos 3 letras).');
  const aspect = ASPECTOS.includes(look) ? look : 'oso';
  if (!Array.isArray(entries) || !entries.length) throw userError('Pon algo a la venta.');
  if (entries.length > MAX_ENTRADAS) throw userError(`Tu muñeco puede ofrecer hasta ${MAX_ENTRADAS} cosas.`);

  // casilla donde queda el muñeco: la del jugador
  const x = Math.floor(pos.x / TILE) * TILE + TILE / 2;
  const y = Math.floor(pos.y / TILE) * TILE + TILE / 2;
  const others = await listZone(pos.zone);
  if (others.length >= MAX_PUESTOS_ZONA) throw userError('El mercado está lleno de muñecos. Prueba más tarde.');
  if (others.some((o) => Math.hypot(o.x - x, o.y - y) < SEPARACION)) throw userError('Hay otro muñeco demasiado cerca: muévete un poco.');
  // que no tape a Pip ni a otros NPC con servicio
  const npc = Object.values(LUGARES).find((l) => l.zona === pos.zone && Math.hypot(l.x * TILE + TILE / 2 - x, l.y * TILE + TILE / 2 - y) < SEPARACION);
  if (npc) throw userError(`Estás pegado a ${npc.nombre.split(',')[0]}: aléjate un par de pasos para no taparle el puesto.`);

  const seen = new Set();
  const list = entries.map((e) => {
    const card = e.kind === 'card';
    const v = {
      card, itemId: Number(e.itemId) || null, monsterId: Number(e.monsterId) || null,
      enchantLevel: Number(e.enchantLevel) || 0, qualityTier: Number(e.qualityTier) || 0,
      quantity: Math.floor(Number(e.quantity)), price: Math.floor(Number(e.price)),
    };
    const key = card ? `c:${v.monsterId}` : `${v.itemId}:${v.enchantLevel}:${v.qualityTier}`;
    if ((card ? !v.monsterId : !v.itemId) || !(v.quantity > 0) || seen.has(key)) throw userError('Hay algo repetido o inválido en tu puesto.');
    if (!(v.price > 0) || v.price > MAX_PRECIO) throw userError('Cada precio tiene que ser mayor que 0.');
    seen.add(key);
    return v;
  });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const taken = await client.query('SELECT 1 FROM player_stalls WHERE owner_id = $1 AND closed_at IS NULL FOR UPDATE', [playerId]);
    if (taken.rows.length) throw userError('Ya tienes un muñeco atendiendo. Ciérralo antes de plantar otro.');
    const doll = await client.query('SELECT id FROM items WHERE code = $1', [MUNECO]);
    try {
      await inventory.removeItem(playerId, doll.rows[0].id, 1, 0, null, client);
    } catch {
      throw userError('Necesitas un Muñeco de Venta. Pip el titiritero los vende en el Barrio del Mercado.');
    }
    const st = await client.query(
      `INSERT INTO player_stalls (owner_id, zone, x, y, title, look, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(hours => $7)) RETURNING id`,
      [playerId, pos.zone, x, y, name, aspect, DURACION_H]
    );
    const stallId = st.rows[0].id;
    for (const v of list) {
      if (v.card) {
        const took = await client.query(
          'UPDATE player_cards SET quantity = quantity - $3 WHERE player_id = $1 AND monster_id = $2 AND quantity >= $3 RETURNING quantity',
          [playerId, v.monsterId, v.quantity]
        );
        if (!took.rows.length) throw userError('No tienes tantas copias de una de las cartas.');
      } else {
        try {
          await inventory.removeItem(playerId, v.itemId, v.quantity, v.enchantLevel, v.qualityTier, client);
        } catch {
          throw userError('No tienes tanto de uno de los objetos.');
        }
      }
      await client.query(
        `INSERT INTO player_stall_items (stall_id, item_id, monster_id, enchant_level, quality_tier, quantity, price)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [stallId, v.card ? null : v.itemId, v.card ? v.monsterId : null, v.enchantLevel, v.qualityTier, v.quantity, v.price]
      );
    }
    await client.query('COMMIT');
    return { stallId, zone: pos.zone };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Comprar de un muñeco
async function buy(buyerId, stallId, entryId, quantity) {
  await ensureTables();
  const qty = Math.floor(Number(quantity));
  if (!(qty > 0)) throw userError('Cantidad inválida.');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const st = await client.query(
      'SELECT * FROM player_stalls WHERE id = $1 AND closed_at IS NULL AND expires_at > now() FOR UPDATE', [stallId]
    );
    if (!st.rows.length) throw userError('Este muñeco ya recogió sus cosas.');
    const stall = st.rows[0];
    if (stall.owner_id === buyerId) throw userError('No puedes comprarte a ti mismo.');
    const pos = positionOf(buyerId);
    if (process.env.POSICION_LIBRE !== '1' && (!pos || pos.zone !== stall.zone || Math.hypot(pos.x - stall.x, pos.y - stall.y) > ALCANCE)) {
      throw userError('Acércate al muñeco para comprarle.');
    }
    const en = await client.query(`${ENTRY_SQL} WHERE e.id = $1 AND e.stall_id = $2 FOR UPDATE OF e`, [entryId, stallId]);
    if (!en.rows.length) throw userError('Eso ya no está a la venta.');
    const e = en.rows[0];
    if (e.quantity < qty) throw userError(e.quantity ? `Solo quedan ${e.quantity}.` : 'Se agotó.');
    const total = Number(e.price) * qty;
    const fee = Math.ceil(total * COMISION);
    const paid = await client.query('UPDATE players SET gold = gold - $1, updated_at = now() WHERE id = $2 AND gold >= $1 RETURNING gold', [total, buyerId]);
    if (!paid.rows.length) throw userError('No te alcanza el oro.');
    await client.query('UPDATE players SET gold = gold + $1, updated_at = now() WHERE id = $2', [total - fee, stall.owner_id]);
    await client.query('UPDATE player_stall_items SET quantity = quantity - $1, sold = sold + $1 WHERE id = $2', [qty, e.id]);
    await client.query('UPDATE player_stalls SET earned = earned + $1 WHERE id = $2', [total - fee, stall.id]);
    if (e.monster_id) await col.giveCard(buyerId, e.monster_id, qty, client);
    else await inventory.addItem(buyerId, e.item_id, qty, e.enchant_level, e.quality_tier, client);
    await client.query(
      'INSERT INTO player_stall_sales (stall_id, buyer_id, entry_id, name, quantity, total, fee) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [stall.id, buyerId, e.id, e.name, qty, total, fee]
    );
    await client.query('COMMIT');
    return { ownerId: stall.owner_id, zone: stall.zone, name: e.name, quantity: qty, total, fee, gold: Number(paid.rows[0].gold) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Cierra un puesto: lo no vendido vuelve por correo
async function close(stallId, reason) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const st = await client.query('UPDATE player_stalls SET closed_at = now() WHERE id = $1 AND closed_at IS NULL RETURNING *', [stallId]);
    if (!st.rows.length) { await client.query('ROLLBACK'); return null; }
    const stall = st.rows[0];
    // RETURNING devuelve la fila ya cambiada: la cantidad de antes sale de la subconsulta
    const left = await client.query(
      `UPDATE player_stall_items e SET quantity = 0
       FROM (SELECT id, quantity AS before FROM player_stall_items WHERE stall_id = $1 AND quantity > 0 FOR UPDATE) o
       WHERE e.id = o.id
       RETURNING e.item_id, e.monster_id, e.enchant_level, e.quality_tier, o.before AS quantity`,
      [stallId]
    );
    const items = left.rows.map((r) => (r.monster_id
      ? { kind: 'card', monsterId: r.monster_id, quantity: r.quantity }
      : { itemId: r.item_id, quantity: r.quantity, enchantLevel: r.enchant_level, qualityTier: r.quality_tier }));
    const earned = Number(stall.earned);
    await correo.sendSystemMail(client, stall.owner_id, {
      from: 'Pip el titiritero',
      subject: `Tu muñeco «${stall.title}» cerró`,
      body: `${reason} Ganaste ${earned.toLocaleString('es')} de oro con tus ventas (ya están en tu bolsa).${items.length ? ' Te devuelvo lo que no se vendió: recógelo en un buzón.' : ' ¡Lo vendiste todo!'}`,
      items,
    });
    await client.query('COMMIT');
    return { ownerId: stall.owner_id, zone: stall.zone, returned: items.length, earned };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function closeMine(playerId) {
  await ensureTables();
  const s = await db.query('SELECT id FROM player_stalls WHERE owner_id = $1 AND closed_at IS NULL', [playerId]);
  if (!s.rows.length) throw userError('No tienes ningún muñeco atendiendo.');
  return close(s.rows[0].id, 'Lo recogiste tú.');
}

function startPuestos(io) {
  ensureTables().catch((err) => console.error('[puestos]', err.message));
  // los muñecos que vencen se recogen solos
  setInterval(async () => {
    try {
      const due = await db.query('SELECT id FROM player_stalls WHERE closed_at IS NULL AND expires_at <= now() LIMIT 20');
      for (const r of due.rows) {
        const out = await close(r.id, `Pasaron sus ${DURACION_H} horas de trabajo.`);
        if (out) {
          io.emit('stalls:changed', { zone: out.zone });
          io.to(`player:${out.ownerId}`).emit('mail:new', { from: 'Pip el titiritero' });
        }
      }
    } catch (err) { console.error('[puestos]', err.message); }
  }, 60 * 1000);
}

module.exports = {
  MUNECO, PRECIO_MUNECO, DURACION_H, MAX_ENTRADAS, COMISION, MERCADOS, ASPECTOS,
  ensureTables, listZone, stallView, mine, open, buy, closeMine, startPuestos,
};
