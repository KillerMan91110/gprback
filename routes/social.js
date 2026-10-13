const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const inventory = require('../lib/inventory');
const { spendCurrency } = require('../lib/currency');
const { requireAuth, requireSelf } = require('../lib/auth');
const correo = require('../lib/correo');
const { lejosDe, SERVICIOS } = require('../lib/cercania');

router.use(requireAuth);
router.use(requireSelf);

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function friendshipRow(playerId, targetId) {
  return db.query(
    `SELECT * FROM player_friends
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)`,
    [playerId, targetId]
  );
}

function playerPublicInfo(playerId) {
  return db.query(
    `SELECT p.id, p.nickname, p.level,
            c.name AS class_name, c.code AS class_code, c.role AS class_role,
            p.last_seen_at AS last_seen
     FROM players p
     JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
     WHERE p.id = $1`,
    [playerId]
  );
}

// ─── AMIGOS ───────────────────────────────────────────────────────────────────

// GET /api/player/:playerId/friends
// Lista de amigos aceptados con info pública.
router.get('/', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT p.id, p.nickname, p.level,
              c.name AS class_name, c.code AS class_code, c.role AS class_role,
              p.last_seen_at AS last_seen,
              pf.created_at AS friends_since
       FROM player_friends pf
       JOIN players p ON p.id = CASE WHEN pf.requester_id = $1 THEN pf.addressee_id ELSE pf.requester_id END
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE (pf.requester_id = $1 OR pf.addressee_id = $1)
         AND pf.status = 'ACCEPTED'
       ORDER BY p.nickname`,
      [playerId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/friends/requests
// Solicitudes pendientes entrantes (otros me enviaron).
router.get('/requests', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT p.id, p.nickname, p.level,
              c.name AS class_name, c.code AS class_code, c.role AS class_role,
              pf.id AS request_id, pf.created_at AS requested_at
       FROM player_friends pf
       JOIN players p ON p.id = pf.requester_id
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE pf.addressee_id = $1 AND pf.status = 'PENDING'
       ORDER BY pf.created_at DESC`,
      [playerId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/friends/search?q=nickname
// Buscar jugadores por nickname (excluye al propio jugador y bloqueados).
router.get('/search', async (req, res, next) => {
  const { playerId } = req.params;
  const { q } = req.query;
  if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Ingresa al menos 2 caracteres' });
  try {
    const result = await db.query(
      `SELECT p.id, p.nickname, p.level,
              c.name AS class_name, c.code AS class_code, c.role AS class_role,
              pf.status AS friendship_status,
              CASE WHEN pf.requester_id = $1 THEN 'sent' WHEN pf.addressee_id = $1 THEN 'received' ELSE NULL END AS friendship_direction
       FROM players p
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       LEFT JOIN player_friends pf ON (
         (pf.requester_id = $1 AND pf.addressee_id = p.id) OR
         (pf.requester_id = p.id AND pf.addressee_id = $1)
       )
       WHERE p.id != $1
         AND p.nickname ILIKE $2
         AND (pf.status IS NULL OR pf.status != 'BLOCKED')
       ORDER BY p.nickname
       LIMIT 20`,
      [playerId, `%${q.trim()}%`]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/friends
// Enviar solicitud de amistad. body: { targetId }
router.post('/', async (req, res, next) => {
  const { playerId } = req.params;
  const { targetId } = req.body;
  if (!targetId) return res.status(400).json({ error: 'Falta targetId' });
  if (Number(targetId) === Number(playerId)) return res.status(400).json({ error: 'No puedes agregarte a ti mismo' });
  try {
    const targetRes = await playerPublicInfo(targetId);
    if (!targetRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });

    const existing = await friendshipRow(playerId, targetId);
    if (existing.rows.length) {
      const f = existing.rows[0];
      if (f.status === 'ACCEPTED') return res.status(400).json({ error: 'Ya son amigos' });
      if (f.status === 'BLOCKED') return res.status(400).json({ error: 'No puedes enviar solicitud a este jugador' });
      if (f.status === 'PENDING') {
        // Si el otro me había mandado solicitud, la acepto directamente
        if (f.addressee_id === Number(playerId)) {
          await db.query(
            `UPDATE player_friends SET status = 'ACCEPTED', updated_at = now() WHERE id = $1`,
            [f.id]
          );
          return res.json({ message: 'Solicitud aceptada automáticamente', status: 'ACCEPTED' });
        }
        return res.status(400).json({ error: 'Ya enviaste una solicitud a este jugador' });
      }
    }

    await db.query(
      `INSERT INTO player_friends (requester_id, addressee_id, status) VALUES ($1, $2, 'PENDING')`,
      [playerId, targetId]
    );
    res.status(201).json({ message: 'Solicitud enviada', target: targetRes.rows[0] });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/friends/:targetId/accept
// Aceptar solicitud entrante.
router.post('/:targetId/accept', async (req, res, next) => {
  const { playerId, targetId } = req.params;
  try {
    const result = await db.query(
      `UPDATE player_friends SET status = 'ACCEPTED', updated_at = now()
       WHERE requester_id = $1 AND addressee_id = $2 AND status = 'PENDING'
       RETURNING id`,
      [targetId, playerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    res.json({ message: 'Solicitud aceptada' });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/friends/:targetId
// Rechazar solicitud, eliminar amigo o cancelar solicitud enviada.
router.delete('/:targetId', async (req, res, next) => {
  const { playerId, targetId } = req.params;
  try {
    const result = await db.query(
      `DELETE FROM player_friends
       WHERE ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))
         AND status != 'BLOCKED'
       RETURNING status`,
      [playerId, targetId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Relación no encontrada' });
    const wasAccepted = result.rows[0].status === 'ACCEPTED';
    res.json({ message: wasAccepted ? 'Amigo eliminado' : 'Solicitud rechazada/cancelada' });
  } catch (error) { next(error); }
});

// ─── MENSAJES ─────────────────────────────────────────────────────────────────

// GET /api/player/:playerId/messages/unread-count
router.get('/messages/unread-count', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT COUNT(*) AS unread FROM player_messages
       WHERE receiver_id = $1 AND read = FALSE
         AND deleted_by_receiver = FALSE
         AND expires_at > now()`,
      [playerId]
    );
    const pending = await db.query(
      `SELECT COUNT(*) AS pending FROM player_friends
       WHERE addressee_id = $1 AND status = 'PENDING'`,
      [playerId]
    );
    res.json({
      unreadMessages: Number(result.rows[0].unread),
      pendingFriendRequests: Number(pending.rows[0].pending),
    });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/messages/inbox
router.get('/messages/inbox', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    await correo.ensureTables();
    const result = await db.query(
      `SELECT pm.id, pm.subject, pm.body, pm.read, pm.gold_amount, pm.gold_claimed,
              pm.created_at, pm.expires_at,
              p.id AS sender_id, COALESCE(p.nickname, pm.sender_name, 'Correo del Reino') AS sender_nickname,
              (pm.sender_id IS NULL) AS from_system,
              EXISTS (
                SELECT 1 FROM player_message_items pmi WHERE pmi.message_id = pm.id AND pmi.claimed = FALSE
              ) AS has_unclaimed_items
       FROM player_messages pm
       LEFT JOIN players p ON p.id = pm.sender_id
       WHERE pm.receiver_id = $1
         AND pm.deleted_by_receiver = FALSE
         AND pm.expires_at > now()
       ORDER BY pm.created_at DESC`,
      [playerId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/messages/sent
router.get('/messages/sent', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT pm.id, pm.subject, pm.body, pm.read, pm.gold_amount, pm.gold_claimed,
              pm.created_at, pm.expires_at,
              p.id AS receiver_id, p.nickname AS receiver_nickname
       FROM player_messages pm
       LEFT JOIN players p ON p.id = pm.receiver_id
       WHERE pm.sender_id = $1
         AND pm.deleted_by_sender = FALSE
         AND pm.expires_at > now()
       ORDER BY pm.created_at DESC`,
      [playerId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

// ─── TYPING (en memoria, no persiste) ────────────────────────────────────────
const typingState = new Map(); // key `${fromId}-${toId}` -> timestamp
const TYPING_TTL_MS = 4000;

// POST /api/player/:playerId/messages/typing  body: { toId }
router.post('/messages/typing', (req, res) => {
  const { playerId } = req.params;
  const { toId } = req.body;
  if (!toId) return res.status(400).json({ error: 'Falta toId' });
  typingState.set(`${playerId}-${toId}`, Date.now());
  res.json({ ok: true });
});

// GET /api/player/:playerId/messages/typing?fromId=X
router.get('/messages/typing', (req, res) => {
  const { playerId } = req.params;
  const { fromId } = req.query;
  if (!fromId) return res.status(400).json({ error: 'Falta fromId' });
  const ts = typingState.get(`${fromId}-${playerId}`);
  res.json({ typing: !!ts && (Date.now() - ts) < TYPING_TTL_MS });
});

// GET /api/player/:playerId/messages/:messageId
// Leer mensaje completo (marca como leído).
router.get('/messages/:messageId', async (req, res, next) => {
  const { playerId, messageId } = req.params;
  try {
    const result = await db.query(
      `SELECT pm.*, COALESCE(p.nickname, pm.sender_name, 'Correo del Reino') AS sender_nickname
       FROM player_messages pm
       LEFT JOIN players p ON p.id = pm.sender_id
       WHERE pm.id = $1
         AND (pm.receiver_id = $2 OR pm.sender_id = $2)
         AND pm.expires_at > now()`,
      [messageId, playerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const msg = result.rows[0];

    const items = await db.query(
      `SELECT pmi.id, pmi.item_id, pmi.monster_id,
              COALESCE(i.name, 'Carta de ' || m.name) AS item_name, i.rarity, i.item_type, i.slot,
              m.rarity AS card_rarity, m.code AS card_code, pmi.quantity,
              pmi.enchant_level, pmi.quality_tier, pmi.claimed
       FROM player_message_items pmi
       LEFT JOIN items i ON i.id = pmi.item_id
       LEFT JOIN monsters m ON m.id = pmi.monster_id
       WHERE pmi.message_id = $1`,
      [messageId]
    );

    if (msg.receiver_id === Number(playerId) && !msg.read) {
      await db.query(`UPDATE player_messages SET read = TRUE WHERE id = $1`, [messageId]);
    }

    res.json({ ...msg, items: items.rows });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/messages
// Enviar carta. body: { receiverId | receiverName, subject, body, goldAmount?,
//   items?: [{itemId, quantity, enchantLevel?, qualityTier?}], cards?: [{monsterId, quantity}] }
// Solo texto a un amigo: desde cualquier lado y gratis. Con oro/objetos/cartas, o a alguien que no
// es tu amigo: desde un buzón y pagando el franqueo (ver lib/correo.js).
router.post('/messages', async (req, res, next) => {
  const { playerId } = req.params;
  const { receiverId, receiverName, subject = '', body = '', goldAmount = 0, items = [], cards = [] } = req.body;
  try {
    await correo.ensureTables();
    let toId = Number(receiverId) || null;
    if (!toId && receiverName) {
      const r = await db.query('SELECT id FROM players WHERE lower(nickname) = lower($1)', [String(receiverName).trim()]);
      toId = r.rows[0]?.id ?? null;
    }
    if (!toId) return res.status(404).json({ error: 'No hay ningún aventurero con ese nombre' });
    if (toId === Number(playerId)) return res.status(400).json({ error: 'No puedes enviarte cartas a ti mismo' });

    const gold = Math.floor(Number(goldAmount) || 0);
    if (gold < 0) return res.status(400).json({ error: 'El oro no puede ser negativo' });
    if (!Array.isArray(items) || !Array.isArray(cards)) return res.status(400).json({ error: 'Adjuntos inválidos' });
    if (items.length + cards.length > correo.MAX_ADJUNTOS) return res.status(400).json({ error: `Puedes adjuntar hasta ${correo.MAX_ADJUNTOS} cosas` });
    const hasAttach = gold > 0 || items.length > 0 || cards.length > 0;
    if (!String(subject).trim() && !String(body).trim() && !hasAttach) {
      return res.status(400).json({ error: 'La carta no puede estar vacía' });
    }

    const friendship = await friendshipRow(playerId, toId);
    const friends = friendship.rows.length && friendship.rows[0].status === 'ACCEPTED';
    const postal = hasAttach || !friends;
    if (postal) {
      const msg = lejosDe(playerId, SERVICIOS.correo.lugares, SERVICIOS.correo.nombre);
      if (msg) return res.status(403).json({ error: hasAttach ? `Para mandar cosas: ${msg}` : `Solo puedes escribir a tus amigos desde cualquier lado. ${msg}`, lejos: true });
    }
    const fee = postal ? correo.postage(gold) : 0;

    // adjuntos: mismo tier que el que se descuenta, sin repetir (antes se duplicaban objetos)
    const seen = new Set();
    const list = [];
    for (const it of items) {
      const e = { itemId: Number(it.itemId), quantity: Math.floor(Number(it.quantity) || 1), enchantLevel: Number(it.enchantLevel) || 0, qualityTier: Number(it.qualityTier) || 0 };
      const key = `${e.itemId}:${e.enchantLevel}:${e.qualityTier}`;
      if (!e.itemId || e.quantity <= 0 || seen.has(key)) return res.status(400).json({ error: 'Adjunto inválido o repetido' });
      seen.add(key);
      const have = await inventory.getQuantity(playerId, e.itemId, e.enchantLevel, e.qualityTier);
      if (have < e.quantity) {
        const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [e.itemId]);
        return res.status(400).json({ error: `No tienes suficientes ${itemRes.rows[0]?.name || 'objetos'}` });
      }
      list.push(e);
    }
    for (const c of cards) {
      const e = { kind: 'card', monsterId: Number(c.monsterId), quantity: Math.floor(Number(c.quantity) || 1) };
      if (!e.monsterId || e.quantity <= 0 || seen.has(`c:${e.monsterId}`)) return res.status(400).json({ error: 'Carta inválida o repetida' });
      seen.add(`c:${e.monsterId}`);
      list.push(e);
    }

    // Descontar todo y crear la carta en una sola transacción
    const client = await db.pool.connect();
    let messageId;
    try {
      await client.query('BEGIN');
      if (gold + fee > 0 && (await spendCurrency(playerId, 'gold', gold + fee, client)) === null) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: fee ? `No te alcanza el oro (el franqueo cuesta ${fee})` : 'No tienes suficiente oro' });
      }
      for (const e of list) {
        if (e.kind === 'card') {
          const took = await client.query(
            'UPDATE player_cards SET quantity = quantity - $3 WHERE player_id = $1 AND monster_id = $2 AND quantity >= $3 RETURNING quantity',
            [playerId, e.monsterId, e.quantity]
          );
          if (!took.rows.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No tienes tantas copias de esa carta en el álbum' });
          }
        } else {
          await inventory.removeItem(playerId, e.itemId, e.quantity, e.enchantLevel, e.qualityTier, client);
        }
      }
      const msgRes = await client.query(
        `INSERT INTO player_messages (sender_id, receiver_id, subject, body, gold_amount, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(days => $6)) RETURNING id`,
        [playerId, toId, String(subject).trim().slice(0, 80), String(body).trim().slice(0, 1000), gold, hasAttach ? correo.DIAS : 10]
      );
      messageId = msgRes.rows[0].id;
      await correo.attach(client, messageId, list);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    const me = await db.query('SELECT nickname FROM players WHERE id = $1', [playerId]);
    req.app.get('io')?.to(`player:${toId}`).emit('mail:new', { from: me.rows[0]?.nickname, attach: hasAttach });
    res.status(201).json({ message: fee ? `Carta enviada (franqueo: ${fee} de oro)` : 'Carta enviada', messageId, fee });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/messages/:messageId/claim
// Recoger el oro, los objetos y las cartas de una carta. Solo el destinatario y en un buzón.
router.post('/messages/:messageId/claim', async (req, res, next) => {
  const { playerId, messageId } = req.params;
  try {
    await correo.ensureTables();
    const msgRes = await db.query(
      `SELECT id FROM player_messages WHERE id = $1 AND receiver_id = $2 AND expires_at > now()`,
      [messageId, playerId]
    );
    if (!msgRes.rows.length) return res.status(404).json({ error: 'Carta no encontrada o vencida' });
    const lejos = lejosDe(playerId, SERVICIOS.correo.lugares, SERVICIOS.correo.nombre);
    if (lejos) return res.status(403).json({ error: `Lo adjunto se recoge en un buzón. ${lejos}`, lejos: true });

    const client = await db.pool.connect();
    let claimed;
    try {
      await client.query('BEGIN');
      claimed = await correo.claimInto(client, messageId, Number(playerId));
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    if (claimed.length === 0) return res.status(400).json({ error: 'No hay nada para recoger' });
    res.json({ message: `Recogiste: ${claimed.join(', ')}`, claimed });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/messages/:messageId
// Eliminar mensaje (soft delete por lado del jugador).
router.delete('/messages/:messageId', async (req, res, next) => {
  const { playerId, messageId } = req.params;
  try {
    const msgRes = await db.query(
      `SELECT * FROM player_messages WHERE id = $1 AND (sender_id = $2 OR receiver_id = $2)`,
      [messageId, playerId]
    );
    if (!msgRes.rows.length) return res.status(404).json({ error: 'Mensaje no encontrado' });
    const msg = msgRes.rows[0];

    if (msg.receiver_id === Number(playerId)) {
      await db.query('UPDATE player_messages SET deleted_by_receiver = TRUE WHERE id = $1', [messageId]);
    } else {
      await db.query('UPDATE player_messages SET deleted_by_sender = TRUE WHERE id = $1', [messageId]);
    }

    res.json({ message: 'Mensaje eliminado' });
  } catch (error) { next(error); }
});

module.exports = router;
