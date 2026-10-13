// Correo del reino (sobre player_messages, el de siempre entre amigos):
//  - con oro, objetos o cartas adjuntos, o a alguien que no es tu amigo, se manda desde un buzón
//    (Aurelia o la Aldea Espiga) y se paga el franqueo: FRANQUEO de oro + COMISION del oro que
//    envías (ese oro sale del juego: es uno de los "sumideros" de la economía)
//  - lo adjunto se recoge en un buzón
//  - si nadie lo recoge antes de que venza, vuelve al remitente (antes se perdía)
//  - el sistema también manda cartas: lo que no vendió tu muñeco de venta, por ejemplo
const db = require('../db/db');
const inventory = require('./inventory');
const col = require('./coleccion');

const FRANQUEO = 10;
const COMISION = 0.05;
const MAX_ADJUNTOS = 6;
const DIAS = 15; // días que espera una carta con adjuntos
const DIAS_SISTEMA = 30;

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    ALTER TABLE player_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
    ALTER TABLE player_messages ADD COLUMN IF NOT EXISTS returned BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE player_message_items ALTER COLUMN item_id DROP NOT NULL;
    ALTER TABLE player_message_items ADD COLUMN IF NOT EXISTS monster_id INTEGER REFERENCES monsters(id);
  `).catch((err) => { ready = null; throw err; });
  return ready;
}

const postage = (gold) => FRANQUEO + Math.ceil(Math.max(0, gold) * COMISION);

// Guarda los adjuntos de una carta (ya descontados del remitente) dentro de la transacción
async function attach(client, messageId, items) {
  for (const it of items) {
    if (it.kind === 'card') {
      await client.query('INSERT INTO player_message_items (message_id, monster_id, quantity) VALUES ($1, $2, $3)', [messageId, it.monsterId, it.quantity]);
    } else {
      await client.query(
        'INSERT INTO player_message_items (message_id, item_id, quantity, enchant_level, quality_tier) VALUES ($1, $2, $3, $4, $5)',
        [messageId, it.itemId, it.quantity, it.enchantLevel ?? 0, it.qualityTier ?? 0]
      );
    }
  }
}

// Carta del sistema (sin remitente jugador) con oro y adjuntos que todavía no son de nadie
async function sendSystemMail(client, toId, { from = 'Correo del Reino', subject, body = '', gold = 0, items = [] }) {
  await ensureTables();
  const r = await client.query(
    `INSERT INTO player_messages (sender_id, sender_name, receiver_id, subject, body, gold_amount, expires_at)
     VALUES (NULL, $1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id`,
    [from, toId, subject, body, Math.floor(gold), DIAS_SISTEMA]
  );
  await attach(client, r.rows[0].id, items);
  return r.rows[0].id;
}

// Da al jugador lo que queda sin recoger de una carta. Devuelve la lista de lo recogido.
async function claimInto(client, messageId, playerId) {
  const got = [];
  const g = await client.query(
    'UPDATE player_messages SET gold_claimed = TRUE WHERE id = $1 AND gold_claimed = FALSE AND gold_amount > 0 RETURNING gold_amount',
    [messageId]
  );
  if (g.rows.length) {
    await client.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [g.rows[0].gold_amount, playerId]);
    got.push(`${Number(g.rows[0].gold_amount).toLocaleString('es')} de oro`);
  }
  const rows = await client.query(
    `UPDATE player_message_items pmi SET claimed = TRUE
     WHERE message_id = $1 AND claimed = FALSE
     RETURNING pmi.item_id, pmi.monster_id, pmi.quantity, pmi.enchant_level, pmi.quality_tier,
               (SELECT name FROM items WHERE id = pmi.item_id) AS item_name,
               (SELECT name FROM monsters WHERE id = pmi.monster_id) AS monster_name`,
    [messageId]
  );
  for (const it of rows.rows) {
    if (it.monster_id) {
      await col.giveCard(playerId, it.monster_id, it.quantity, client);
      got.push(`${it.quantity}x Carta de ${it.monster_name}`);
    } else {
      await inventory.addItem(playerId, it.item_id, it.quantity, it.enchant_level, it.quality_tier, client);
      got.push(`${it.quantity}x ${it.item_name}`);
    }
  }
  return got;
}

// Cartas vencidas con cosas sin recoger: vuelven a quien las mandó (como carta del sistema).
// Las del sistema que vencen sin recoger se pierden (avisan con 30 días).
async function returnExpired(io) {
  await ensureTables();
  const due = await db.query(
    `SELECT pm.id, pm.sender_id, pm.receiver_id, pm.subject, p.nickname AS receiver_name
     FROM player_messages pm JOIN players p ON p.id = pm.receiver_id
     WHERE pm.expires_at <= now() AND pm.returned = FALSE AND pm.sender_id IS NOT NULL
       AND ((pm.gold_amount > 0 AND pm.gold_claimed = FALSE)
            OR EXISTS (SELECT 1 FROM player_message_items i WHERE i.message_id = pm.id AND i.claimed = FALSE))
     LIMIT 50`
  );
  for (const m of due.rows) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const mark = await client.query('UPDATE player_messages SET returned = TRUE WHERE id = $1 AND returned = FALSE RETURNING id', [m.id]);
      if (!mark.rows.length) { await client.query('ROLLBACK'); continue; }
      const g = await client.query(
        'UPDATE player_messages SET gold_claimed = TRUE WHERE id = $1 AND gold_claimed = FALSE RETURNING gold_amount', [m.id]
      );
      const items = await client.query(
        `UPDATE player_message_items SET claimed = TRUE WHERE message_id = $1 AND claimed = FALSE
         RETURNING item_id, monster_id, quantity, enchant_level, quality_tier`, [m.id]
      );
      await sendSystemMail(client, m.sender_id, {
        subject: `Devuelto: ${m.subject || 'tu carta'}`,
        body: `${m.receiver_name} no recogió lo que le mandaste a tiempo, así que el cartero te lo devuelve.`,
        gold: g.rows[0]?.gold_amount ?? 0,
        items: items.rows.map((r) => (r.monster_id
          ? { kind: 'card', monsterId: r.monster_id, quantity: r.quantity }
          : { itemId: r.item_id, quantity: r.quantity, enchantLevel: r.enchant_level, qualityTier: r.quality_tier })),
      });
      await client.query('COMMIT');
      io?.to(`player:${m.sender_id}`).emit('mail:new', { from: 'Correo del Reino' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('[correo] no se pudo devolver la carta', m.id, err.message);
    } finally {
      client.release();
    }
  }
}

function startCorreoJobs(io) {
  ensureTables().catch((err) => console.error('[correo]', err.message));
  setInterval(() => returnExpired(io).catch((err) => console.error('[correo]', err.message)), 10 * 60 * 1000);
}

module.exports = { FRANQUEO, COMISION, MAX_ADJUNTOS, DIAS, postage, ensureTables, attach, sendSystemMail, claimInto, startCorreoJobs };
