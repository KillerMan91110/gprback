const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');

router.use(requireAuth);
router.use(requireSelf);

const VALID_CHANNELS = ['GENERAL', 'TRADE', 'GUILD'];
const MAX_BODY_LEN = 300;
const CHANNEL_INACTIVITY_MS = 15 * 60 * 1000;

async function resolveGuildId(playerId) {
  const res = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [playerId]);
  return res.rows[0]?.guild_id ?? null;
}

// Los 3 canales se vacian solos tras 15min sin mensajes nuevos, para no acumular charla vieja
// para siempre (GUILD por guild_id, cada gremio independiente de los demas). Se llama antes de
// leer o escribir en el canal; si no hace falta limpiar, es un solo SELECT barato.
async function clearIfInactive(io, channel, guildId) {
  const params = channel === 'GUILD' ? [channel, guildId] : [channel];
  const guildFilter = channel === 'GUILD' ? 'AND guild_id = $2' : '';

  const maxRes = await db.query(
    `SELECT MAX(created_at) AS last_at FROM chat_messages WHERE channel = $1 ${guildFilter}`,
    params
  );
  const lastAt = maxRes.rows[0].last_at;
  if (!lastAt || Date.now() - new Date(lastAt).getTime() < CHANNEL_INACTIVITY_MS) return;

  await db.query(`DELETE FROM chat_messages WHERE channel = $1 ${guildFilter}`, params);

  const room = channel === 'GUILD' ? `chat:GUILD:${guildId}` : `chat:${channel}`;
  io?.to(room).emit('chat:cleared', { channel, guildId: channel === 'GUILD' ? guildId : null });
}

// GET /api/player/:playerId/chat/:channel?afterId=0
router.get('/:channel', async (req, res) => {
  const channel = req.params.channel.toUpperCase();
  if (!VALID_CHANNELS.includes(channel)) {
    return res.status(400).json({ error: 'Canal inválido' });
  }

  const afterId = parseInt(req.query.afterId, 10) || 0;

  try {
    let rows;
    if (channel === 'GUILD') {
      const guildId = await resolveGuildId(req.playerId);
      if (!guildId) return res.json({ messages: [] });
      await clearIfInactive(req.app.get('io'), channel, guildId);
      if (afterId === 0) {
        const result = await db.query(
          `SELECT * FROM (
             SELECT cm.id, cm.body, cm.created_at, p.nickname, p.level
             FROM chat_messages cm
             JOIN players p ON p.id = cm.sender_id
             WHERE cm.channel = 'GUILD' AND cm.guild_id = $1
             ORDER BY cm.id DESC LIMIT 20
           ) sub ORDER BY id ASC`,
          [guildId]
        );
        rows = result.rows;
      } else {
        const result = await db.query(
          `SELECT cm.id, cm.body, cm.created_at, p.nickname, p.level
           FROM chat_messages cm
           JOIN players p ON p.id = cm.sender_id
           WHERE cm.channel = 'GUILD' AND cm.guild_id = $1 AND cm.id > $2
           ORDER BY cm.id ASC LIMIT 50`,
          [guildId, afterId]
        );
        rows = result.rows;
      }
    } else {
      await clearIfInactive(req.app.get('io'), channel, null);
      if (afterId === 0) {
        const result = await db.query(
          `SELECT * FROM (
             SELECT cm.id, cm.body, cm.created_at, p.nickname, p.level
             FROM chat_messages cm
             JOIN players p ON p.id = cm.sender_id
             WHERE cm.channel = $1
             ORDER BY cm.id DESC LIMIT 20
           ) sub ORDER BY id ASC`,
          [channel]
        );
        rows = result.rows;
      } else {
        const result = await db.query(
          `SELECT cm.id, cm.body, cm.created_at, p.nickname, p.level
           FROM chat_messages cm
           JOIN players p ON p.id = cm.sender_id
           WHERE cm.channel = $1 AND cm.id > $2
           ORDER BY cm.id ASC LIMIT 50`,
          [channel, afterId]
        );
        rows = result.rows;
      }
    }

    res.json({ messages: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener mensajes' });
  }
});

// POST /api/player/:playerId/chat/:channel
router.post('/:channel', async (req, res) => {
  const channel = req.params.channel.toUpperCase();
  if (!VALID_CHANNELS.includes(channel)) {
    return res.status(400).json({ error: 'Canal inválido' });
  }

  const body = String(req.body.body || '').trim().slice(0, MAX_BODY_LEN);
  if (!body) return res.status(400).json({ error: 'Mensaje vacío' });

  try {
    let guildId = null;
    if (channel === 'GUILD') {
      guildId = await resolveGuildId(req.playerId);
      if (!guildId) return res.status(403).json({ error: 'No perteneces a ningún gremio' });
    }
    await clearIfInactive(req.app.get('io'), channel, guildId);

    const insert = await db.query(
      `INSERT INTO chat_messages(channel, guild_id, sender_id, body)
       VALUES ($1, $2, $3, $4)
       RETURNING id, body, created_at`,
      [channel, guildId, req.playerId, body]
    );

    const msg = insert.rows[0];
    const player = await db.query('SELECT nickname, level FROM players WHERE id = $1', [req.playerId]);
    const { nickname, level } = player.rows[0];
    const message = { ...msg, nickname, level, channel };

    const room = channel === 'GUILD' ? `chat:GUILD:${guildId}` : `chat:${channel}`;
    req.app.get('io')?.to(room).emit('chat:message', message);

    res.status(201).json({ message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

module.exports = router;
