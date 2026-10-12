// Ventana Social del mundo 2D (tecla O): amigos con notas, favoritos, lazos y mensaje de estado;
// elogios diarios; ficha pública de un jugador. Montado en /api/player/:playerId/social.
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const { ensureSocialTables, bondInfo } = require('../lib/socialHub');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);
router.use((req, res, next) => ensureSocialTables().then(() => next(), next));

const KINDS = ['valiente', 'amable', 'guia'];

async function commendTotals(ids) {
  if (!ids.length) return {};
  const r = await db.query(
    `SELECT to_id, kind, COUNT(*)::int AS n FROM player_commends WHERE to_id = ANY($1::int[]) GROUP BY to_id, kind`,
    [ids]
  );
  const out = {};
  for (const row of r.rows) {
    out[row.to_id] = out[row.to_id] ?? { valiente: 0, amable: 0, guia: 0 };
    out[row.to_id][row.kind] = row.n;
  }
  return out;
}

// GET /social/overview — todo lo de la ventana de una vez
router.get('/overview', async (req, res, next) => {
  const me = req.playerId;
  try {
    const friends = await db.query(
      `SELECT p.id, p.nickname, p.level, c.name AS class_name, c.code AS class_code,
              p.last_seen_at AS last_seen, pf.updated_at AS friends_since,
              COALESCE(ps.status_text, '') AS status_text,
              COALESCE(fn.note, '') AS note, COALESCE(fn.favorite, FALSE) AS favorite,
              COALESCE(fb.points, 0) AS bond_points, fb.last_together,
              g.name AS guild_name
       FROM player_friends pf
       JOIN players p ON p.id = CASE WHEN pf.requester_id = $1 THEN pf.addressee_id ELSE pf.requester_id END
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       LEFT JOIN player_social ps ON ps.player_id = p.id
       LEFT JOIN friend_notes fn ON fn.player_id = $1 AND fn.friend_id = p.id
       LEFT JOIN friend_bonds fb ON fb.a_id = LEAST($1::int, p.id) AND fb.b_id = GREATEST($1::int, p.id)
       LEFT JOIN guild_members gm ON gm.player_id = p.id
       LEFT JOIN guilds g ON g.id = gm.guild_id
       WHERE (pf.requester_id = $1 OR pf.addressee_id = $1) AND pf.status = 'ACCEPTED'
       ORDER BY p.nickname`,
      [me]
    );
    const requests = await db.query(
      `SELECT p.id, p.nickname, p.level, c.name AS class_name, c.code AS class_code, pf.created_at AS requested_at
       FROM player_friends pf
       JOIN players p ON p.id = pf.requester_id
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE pf.addressee_id = $1 AND pf.status = 'PENDING'
       ORDER BY pf.created_at DESC`,
      [me]
    );
    const sent = await db.query(
      `SELECT p.id, p.nickname, p.level FROM player_friends pf JOIN players p ON p.id = pf.addressee_id
       WHERE pf.requester_id = $1 AND pf.status = 'PENDING' ORDER BY pf.created_at DESC`,
      [me]
    );
    const myStatus = await db.query('SELECT status_text FROM player_social WHERE player_id = $1', [me]);
    const commendsToday = await db.query(
      'SELECT to_id, kind FROM player_commends WHERE from_id = $1 AND day = CURRENT_DATE',
      [me]
    );
    const ids = friends.rows.map((f) => f.id);
    const totals = await commendTotals([me, ...ids]);
    res.json({
      me: { statusText: myStatus.rows[0]?.status_text ?? '', commends: totals[me] ?? { valiente: 0, amable: 0, guia: 0 } },
      friends: friends.rows.map((f) => ({
        ...f, bond: bondInfo(f.bond_points), commends: totals[f.id] ?? { valiente: 0, amable: 0, guia: 0 },
      })),
      requests: requests.rows,
      sent: sent.rows,
      commendedToday: Object.fromEntries(commendsToday.rows.map((r) => [r.to_id, r.kind])),
    });
  } catch (err) { next(err); }
});

// PUT /social/status { text } — "¿Qué estás haciendo?"
router.put('/status', async (req, res, next) => {
  const text = String(req.body?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  try {
    await db.query(
      `INSERT INTO player_social (player_id, status_text, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (player_id) DO UPDATE SET status_text = $2, updated_at = now()`,
      [req.playerId, text]
    );
    res.json({ statusText: text });
  } catch (err) { next(err); }
});

// PUT /social/friends/:friendId { note?, favorite? } — nota privada y favorito
router.put('/friends/:friendId', async (req, res, next) => {
  const friendId = Number(req.params.friendId);
  const note = req.body?.note != null ? String(req.body.note).trim().slice(0, 120) : null;
  const favorite = req.body?.favorite != null ? !!req.body.favorite : null;
  try {
    const isFriend = await db.query(
      `SELECT 1 FROM player_friends WHERE status = 'ACCEPTED'
       AND ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.playerId, friendId]
    );
    if (!isFriend.rows.length) return res.status(404).json({ error: 'No es tu amigo' });
    const r = await db.query(
      `INSERT INTO friend_notes (player_id, friend_id, note, favorite) VALUES ($1, $2, COALESCE($3, ''), COALESCE($4, FALSE))
       ON CONFLICT (player_id, friend_id) DO UPDATE SET
         note = COALESCE($3, friend_notes.note), favorite = COALESCE($4, friend_notes.favorite)
       RETURNING note, favorite`,
      [req.playerId, friendId, note, favorite]
    );
    res.json(r.rows[0]);
  } catch (err) { next(err); }
});

// POST /social/commend { targetId, kind } — un elogio por jugador y por día
router.post('/commend', async (req, res, next) => {
  const targetId = Number(req.body?.targetId);
  const kind = String(req.body?.kind ?? '');
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Elogio inválido' });
  if (!targetId || targetId === req.playerId) return res.status(400).json({ error: 'No puedes elogiarte a ti mismo' });
  try {
    const exists = await db.query('SELECT nickname FROM players WHERE id = $1', [targetId]);
    if (!exists.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const r = await db.query(
      `INSERT INTO player_commends (from_id, to_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT (from_id, to_id, day) DO NOTHING RETURNING id`,
      [req.playerId, targetId, kind]
    );
    if (!r.rows.length) return res.status(400).json({ error: `Ya elogiaste hoy a ${exists.rows[0].nickname}` });
    const totals = await commendTotals([targetId]);
    const io = req.app.get('io');
    // aviso en vivo al elogiado
    io?.to(`player:${targetId}`).emit('social:commended', { kind, from: req.playerId });
    res.json({ ok: true, commends: totals[targetId] });
  } catch (err) { next(err); }
});

// GET /social/card/:targetId — ficha pública (para el menú de un jugador del mapa)
router.get('/card/:targetId', async (req, res, next) => {
  const targetId = Number(req.params.targetId);
  try {
    const r = await db.query(
      `SELECT p.id, p.nickname, p.level, c.name AS class_name, c.code AS class_code,
              COALESCE(ps.status_text, '') AS status_text, g.name AS guild_name,
              pf.status AS friendship, CASE WHEN pf.requester_id = $1 THEN 'sent' WHEN pf.addressee_id = $1 THEN 'received' END AS direction,
              COALESCE(fb.points, 0) AS bond_points
       FROM players p
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       LEFT JOIN player_social ps ON ps.player_id = p.id
       LEFT JOIN guild_members gm ON gm.player_id = p.id
       LEFT JOIN guilds g ON g.id = gm.guild_id
       LEFT JOIN player_friends pf ON (pf.requester_id = $1 AND pf.addressee_id = p.id) OR (pf.requester_id = p.id AND pf.addressee_id = $1)
       LEFT JOIN friend_bonds fb ON fb.a_id = LEAST($1::int, p.id) AND fb.b_id = GREATEST($1::int, p.id)
       WHERE p.id = $2`,
      [req.playerId, targetId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const today = await db.query('SELECT kind FROM player_commends WHERE from_id = $1 AND to_id = $2 AND day = CURRENT_DATE', [req.playerId, targetId]);
    const totals = await commendTotals([targetId]);
    const row = r.rows[0];
    res.json({
      ...row, bond: bondInfo(row.bond_points), commends: totals[targetId] ?? { valiente: 0, amable: 0, guia: 0 },
      commendedToday: today.rows[0]?.kind ?? null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
