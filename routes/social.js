const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const inventory = require('../lib/inventory');
const { requireAuth, requireSelf } = require('../lib/auth');

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
    const result = await db.query(
      `SELECT pm.id, pm.subject, pm.body, pm.read, pm.gold_amount, pm.gold_claimed,
              pm.created_at, pm.expires_at,
              p.id AS sender_id, p.nickname AS sender_nickname,
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
      `SELECT pm.*, p.nickname AS sender_nickname
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
      `SELECT pmi.id, pmi.item_id, i.name AS item_name, i.rarity, pmi.quantity,
              pmi.enchant_level, pmi.quality_tier, pmi.claimed
       FROM player_message_items pmi
       JOIN items i ON i.id = pmi.item_id
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
// Enviar mensaje. body: { receiverId, subject, body, goldAmount?, items?: [{itemId, quantity, enchantLevel?, qualityTier?}] }
// Solo entre amigos. El oro e items se descuentan del remitente al enviar.
router.post('/messages', async (req, res, next) => {
  const { playerId } = req.params;
  const { receiverId, subject = '', body = '', goldAmount = 0, items = [] } = req.body;
  if (!receiverId) return res.status(400).json({ error: 'Falta receiverId' });
  if (Number(receiverId) === Number(playerId)) return res.status(400).json({ error: 'No puedes enviarte mensajes a ti mismo' });
  if (!subject.trim() && !body.trim() && goldAmount <= 0 && items.length === 0) {
    return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  }
  try {
    // Verificar amistad
    const friendship = await friendshipRow(playerId, receiverId);
    if (!friendship.rows.length || friendship.rows[0].status !== 'ACCEPTED') {
      return res.status(403).json({ error: 'Solo puedes enviar mensajes a tus amigos' });
    }

    // Verificar y descontar oro
    const gold = Math.floor(Number(goldAmount) || 0);
    if (gold < 0) return res.status(400).json({ error: 'El oro no puede ser negativo' });
    if (gold > 0) {
      const playerRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
      if (playerRes.rows[0].gold < gold) return res.status(400).json({ error: 'No tienes suficiente oro' });
    }

    // Verificar items adjuntos
    for (const it of items) {
      const qty = await inventory.getQuantity(playerId, it.itemId, it.enchantLevel || 0, it.qualityTier ?? null);
      if (qty < (it.quantity || 1)) {
        const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [it.itemId]);
        return res.status(400).json({ error: `No tienes suficientes ${itemRes.rows[0]?.name || 'items'}` });
      }
    }

    // Descontar oro
    if (gold > 0) await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [gold, playerId]);

    // Descontar items del inventario
    for (const it of items) {
      await inventory.removeItem(playerId, it.itemId, it.quantity || 1, it.enchantLevel || 0, it.qualityTier ?? 0);
    }

    // Crear mensaje
    const msgRes = await db.query(
      `INSERT INTO player_messages (sender_id, receiver_id, subject, body, gold_amount)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [playerId, receiverId, subject.trim(), body.trim(), gold]
    );
    const messageId = msgRes.rows[0].id;

    // Adjuntar items
    for (const it of items) {
      await db.query(
        `INSERT INTO player_message_items (message_id, item_id, quantity, enchant_level, quality_tier)
         VALUES ($1, $2, $3, $4, $5)`,
        [messageId, it.itemId, it.quantity || 1, it.enchantLevel || 0, it.qualityTier ?? 0]
      );
    }

    res.status(201).json({ message: 'Mensaje enviado', messageId });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/messages/:messageId/claim
// Reclamar oro e items del mensaje. Solo el receptor puede reclamar.
router.post('/messages/:messageId/claim', async (req, res, next) => {
  const { playerId, messageId } = req.params;
  try {
    const msgRes = await db.query(
      `SELECT * FROM player_messages WHERE id = $1 AND receiver_id = $2 AND expires_at > now()`,
      [messageId, playerId]
    );
    if (!msgRes.rows.length) return res.status(404).json({ error: 'Mensaje no encontrado o expirado' });
    const msg = msgRes.rows[0];

    const claimed = [];

    // Reclamar oro
    if (msg.gold_amount > 0 && !msg.gold_claimed) {
      await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [msg.gold_amount, playerId]);
      await db.query('UPDATE player_messages SET gold_claimed = TRUE WHERE id = $1', [messageId]);
      claimed.push(`${msg.gold_amount} oro`);
    }

    // Reclamar items no reclamados
    const unclaimedItems = await db.query(
      `SELECT * FROM player_message_items WHERE message_id = $1 AND claimed = FALSE`,
      [messageId]
    );
    for (const it of unclaimedItems.rows) {
      await inventory.addItem(playerId, it.item_id, it.quantity, it.enchant_level, it.quality_tier);
      await db.query('UPDATE player_message_items SET claimed = TRUE WHERE id = $1', [it.id]);
      const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [it.item_id]);
      claimed.push(`${it.quantity}x ${itemRes.rows[0]?.name}`);
    }

    if (claimed.length === 0) return res.status(400).json({ error: 'No hay nada para reclamar' });

    res.json({ message: `Reclamaste: ${claimed.join(', ')}`, claimed });
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
