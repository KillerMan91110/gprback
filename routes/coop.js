const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');

router.use(requireAuth);
router.use(requireSelf);

const INVITE_TTL_SECONDS = 60;
const READY_TTL_MS = 15000;
const MAX_GROUP_SIZE = 3;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getMyGroup(playerId) {
  const res = await db.query(
    `SELECT g.id, g.leader_id
     FROM player_coop_group_members gm
     JOIN player_coop_groups g ON g.id = gm.group_id
     WHERE gm.player_id = $1`,
    [playerId]
  );
  return res.rows[0] || null;
}

async function getGroupMemberIds(groupId) {
  const res = await db.query('SELECT player_id FROM player_coop_group_members WHERE group_id = $1', [groupId]);
  return res.rows.map((r) => r.player_id);
}

async function getActiveCombatSessionId(playerId) {
  const res = await db.query(
    `SELECT cs.id FROM combat_sessions cs
     JOIN combat_participants cp ON cp.session_id = cs.id
     WHERE cs.status = 'IN_PROGRESS' AND cp.player_id = $1
     LIMIT 1`,
    [playerId]
  );
  return res.rows[0]?.id ?? null;
}

// ─── INVITACIONES ─────────────────────────────────────────────────────────────

// POST /api/player/:playerId/coop/invite  body: { friendId }
router.post('/invite', async (req, res, next) => {
  const { playerId } = req.params;
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: 'Falta friendId' });
  if (Number(friendId) === Number(playerId)) return res.status(400).json({ error: 'No podés invitarte a vos mismo' });
  try {
    const friendship = await db.query(
      `SELECT id FROM player_friends
       WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
         AND status='ACCEPTED'`,
      [playerId, friendId]
    );
    if (!friendship.rows.length) return res.status(403).json({ error: 'Solo podés invitar a un amigo' });

    const guestInGroup = await db.query('SELECT 1 FROM player_coop_group_members WHERE player_id=$1', [friendId]);
    if (guestInGroup.rows.length) return res.status(400).json({ error: 'Ese jugador ya está en un grupo co-op' });

    const myGroup = await getMyGroup(playerId);
    if (myGroup) {
      if (myGroup.leader_id !== Number(playerId)) {
        return res.status(403).json({ error: 'Solo el líder del grupo puede invitar' });
      }
      const memberIds = await getGroupMemberIds(myGroup.id);
      if (memberIds.length >= MAX_GROUP_SIZE) {
        return res.status(400).json({ error: `El grupo ya está lleno (máx ${MAX_GROUP_SIZE})` });
      }
    }

    await db.query(
      `UPDATE player_coop_invites SET status='DECLINED'
       WHERE ((leader_id=$1 AND guest_id=$2) OR (leader_id=$2 AND guest_id=$1))
         AND status='PENDING'`,
      [playerId, friendId]
    );

    const inv = await db.query(
      `INSERT INTO player_coop_invites(leader_id, guest_id, expires_at)
       VALUES($1,$2, now() + INTERVAL '${INVITE_TTL_SECONDS} seconds') RETURNING id, expires_at`,
      [playerId, friendId]
    );
    res.status(201).json({ inviteId: inv.rows[0].id, expiresAt: inv.rows[0].expires_at });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/coop/invite/pending
router.get('/invite/pending', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const inv = await db.query(
      `SELECT ci.id, ci.leader_id, ci.expires_at,
              p.nickname AS leader_nickname, p.level AS leader_level,
              c.name AS leader_class
       FROM player_coop_invites ci
       JOIN players p ON p.id = ci.leader_id
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE ci.guest_id = $1 AND ci.status = 'PENDING' AND ci.expires_at > now()
       ORDER BY ci.created_at DESC LIMIT 1`,
      [playerId]
    );
    if (!inv.rows.length) return res.json(null);

    const invite = inv.rows[0];
    const existingGroup = await getMyGroup(invite.leader_id);
    let existingMembers = [];
    if (existingGroup) {
      const members = await db.query(
        `SELECT p.id, p.nickname FROM player_coop_group_members gm
         JOIN players p ON p.id = gm.player_id
         WHERE gm.group_id = $1 AND gm.player_id != $2`,
        [existingGroup.id, invite.leader_id]
      );
      existingMembers = members.rows;
    }
    res.json({ ...invite, existingMembers });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/coop/invite/:inviteId/accept
router.post('/invite/:inviteId/accept', async (req, res, next) => {
  const { playerId, inviteId } = req.params;
  try {
    const inv = await db.query(
      `UPDATE player_coop_invites SET status='ACCEPTED'
       WHERE id=$1 AND guest_id=$2 AND status='PENDING' AND expires_at > now()
       RETURNING leader_id, guest_id`,
      [inviteId, playerId]
    );
    if (!inv.rows.length) return res.status(404).json({ error: 'Invitación no encontrada o expirada' });

    const { leader_id, guest_id } = inv.rows[0];

    await db.query('DELETE FROM player_coop_group_members WHERE player_id=$1', [guest_id]);

    let group = await getMyGroup(leader_id);
    if (!group) {
      const created = await db.query(
        'INSERT INTO player_coop_groups(leader_id) VALUES($1) RETURNING id, leader_id',
        [leader_id]
      );
      group = created.rows[0];
      await db.query('INSERT INTO player_coop_group_members(group_id, player_id) VALUES($1,$2)', [group.id, leader_id]);
    } else {
      const memberIds = await getGroupMemberIds(group.id);
      if (memberIds.length >= MAX_GROUP_SIZE) {
        return res.status(400).json({ error: `El grupo ya está lleno (máx ${MAX_GROUP_SIZE})` });
      }
    }
    await db.query('INSERT INTO player_coop_group_members(group_id, player_id) VALUES($1,$2)', [group.id, guest_id]);

    const leaderRes = await db.query(
      `SELECT p.nickname, p.level, c.name AS class_name
       FROM players p JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE p.id = $1`,
      [leader_id]
    );
    res.json({ message: 'Te uniste al grupo co-op', leader: leaderRes.rows[0] });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/coop/invite/:inviteId/decline
router.post('/invite/:inviteId/decline', async (req, res, next) => {
  const { playerId, inviteId } = req.params;
  try {
    await db.query(
      `UPDATE player_coop_invites SET status='DECLINED'
       WHERE id=$1 AND guest_id=$2 AND status='PENDING'`,
      [inviteId, playerId]
    );
    res.json({ message: 'Invitación rechazada' });
  } catch (error) { next(error); }
});

// ─── GRUPO ACTIVO ─────────────────────────────────────────────────────────────

// GET /api/player/:playerId/coop/party
router.get('/party', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const group = await getMyGroup(playerId);
    if (!group) return res.json(null);

    const membersRes = await db.query(
      `SELECT p.id, p.nickname, p.level, p.hp, p.max_hp, p.mana, p.max_mana,
              c.name AS class_name, c.code AS class_code, p.last_seen_at
       FROM player_coop_group_members gm
       JOIN players p ON p.id = gm.player_id
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE gm.group_id = $1 AND gm.player_id != $2
       ORDER BY gm.joined_at`,
      [group.id, playerId]
    );
    res.json({
      groupId: group.id,
      isLeader: group.leader_id === Number(playerId),
      members: membersRes.rows,
    });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/coop/party — salir del grupo
router.delete('/party', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const group = await getMyGroup(playerId);
    let goldPenalty = 0;
    let sessionId = null;
    if (group) {
      sessionId = await getActiveCombatSessionId(playerId);
      if (sessionId) {
        const goldRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
        goldPenalty = Math.floor(Number(goldRes.rows[0].gold) * 0.10);
        await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [goldPenalty, playerId]);
        await db.query(
          `INSERT INTO combat_abandoned_players(session_id, player_id, penalized)
           VALUES ($1, $2, TRUE) ON CONFLICT DO NOTHING`,
          [sessionId, playerId]
        );
        await db.query(
          `UPDATE player_tower_runs SET abandoned_player_ids = array_append(abandoned_player_ids, $1)
           WHERE status = 'IN_PROGRESS' AND (player_id = $1 OR guest_player_id = $1 OR guest_player_id_2 = $1)
             AND NOT ($1 = ANY(abandoned_player_ids))`,
          [playerId]
        );
      }
      await db.query('DELETE FROM player_coop_group_members WHERE group_id=$1 AND player_id=$2', [group.id, playerId]);
      const remaining = await getGroupMemberIds(group.id);
      if (remaining.length <= 1) {
        await db.query('DELETE FROM player_coop_groups WHERE id=$1', [group.id]);
        if (remaining.length === 1) {
          await db.query('DELETE FROM player_coop_ready WHERE player_id=$1', [remaining[0]]);
        }
      } else if (group.leader_id === Number(playerId)) {
        const nextLeaderRes = await db.query(
          `SELECT player_id FROM player_coop_group_members WHERE group_id=$1 ORDER BY joined_at LIMIT 1`,
          [group.id]
        );
        await db.query('UPDATE player_coop_groups SET leader_id=$1 WHERE id=$2', [nextLeaderRes.rows[0].player_id, group.id]);
      }
    }
    await db.query('DELETE FROM player_coop_ready WHERE player_id=$1', [playerId]);
    res.json({ message: 'Saliste del grupo co-op', leftDuringCombat: !!sessionId, goldPenalty });
  } catch (error) { next(error); }
});

// ─── READY CHECK ──────────────────────────────────────────────────────────────

// POST /api/player/:playerId/coop/ready  body: { zoneId }
router.post('/ready', async (req, res, next) => {
  const { playerId } = req.params;
  const { zoneId } = req.body;
  if (!zoneId) return res.status(400).json({ error: 'Falta zoneId' });
  try {
    const group = await getMyGroup(playerId);
    if (!group) return res.status(400).json({ error: 'No estás en un grupo co-op' });

    await db.query(
      `INSERT INTO player_coop_ready(player_id, zone_id, ready_at)
       VALUES($1,$2,now())
       ON CONFLICT(player_id) DO UPDATE SET zone_id=$2, ready_at=now()`,
      [playerId, zoneId]
    );

    const memberIds = await getGroupMemberIds(group.id);
    const readyRows = await db.query(
      `SELECT player_id, zone_id FROM player_coop_ready
       WHERE player_id = ANY($1::int[]) AND zone_id=$2
         AND ready_at > now() - INTERVAL '${READY_TTL_MS / 1000} seconds'`,
      [memberIds, zoneId]
    );

    const allReady = readyRows.rows.length === memberIds.length;
    if (!allReady) {
      return res.json({ bothReady: false, allReady: false, waiting: true });
    }

    const otherIds = memberIds.filter((id) => id !== Number(playerId));
    await db.query('DELETE FROM player_coop_ready WHERE player_id = ANY($1::int[])', [memberIds]);
    res.json({
      bothReady: true,
      allReady: true,
      coopPartnerId: otherIds[0] ?? null,
      coopPartnerIds: otherIds,
      groupId: group.id,
    });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/coop/ready
router.delete('/ready', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    await db.query('DELETE FROM player_coop_ready WHERE player_id=$1', [playerId]);
    res.json({ message: 'Ready cancelado' });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/coop/ready-status
router.get('/ready-status', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const group = await getMyGroup(playerId);
    if (!group) return res.json({ inParty: false });

    const memberIds = await getGroupMemberIds(group.id);
    const otherIds = memberIds.filter((id) => id !== Number(playerId));

    const rows = await db.query(
      `SELECT player_id, zone_id FROM player_coop_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );
    const byPlayer = new Map(rows.rows.map((r) => [r.player_id, r.zone_id]));
    const myZoneId = byPlayer.get(Number(playerId)) ?? null;

    const others = otherIds.map((id) => ({ playerId: id, ready: byPlayer.has(id), zoneId: byPlayer.get(id) ?? null }));
    const allReady = myZoneId != null && others.every((o) => o.ready && o.zoneId === myZoneId);

    res.json({
      inParty: true,
      isLeader: group.leader_id === Number(playerId),
      partnerId: otherIds[0] ?? null,
      myReady: myZoneId != null,
      myZoneId,
      partnerReady: others[0]?.ready ?? false,
      partnerZoneId: others[0]?.zoneId ?? null,
      bothReady: allReady,
      members: others,
      allReady,
    });
  } catch (error) { next(error); }
});

// ─── CHAT DE GRUPO ────────────────────────────────────────────────────────────

// POST /api/player/:playerId/coop/messages  body: { body }
router.post('/messages', async (req, res, next) => {
  const { playerId } = req.params;
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'El mensaje no puede estar vacío' });
  try {
    const group = await getMyGroup(playerId);
    if (!group) return res.status(400).json({ error: 'No estás en un grupo co-op' });
    const inserted = await db.query(
      `INSERT INTO player_coop_group_messages(group_id, sender_id, body)
       VALUES($1,$2,$3) RETURNING id, sender_id, body, created_at`,
      [group.id, playerId, body.trim().slice(0, 500)]
    );
    const row = inserted.rows[0];
    const senderRes = await db.query('SELECT nickname FROM players WHERE id=$1', [playerId]);
    res.status(201).json({ ...row, senderNickname: senderRes.rows[0]?.nickname });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/coop/messages?afterId=123 — solo mensajes nuevos (para polling)
router.get('/messages', async (req, res, next) => {
  const { playerId } = req.params;
  const afterId = req.query.afterId ? Number(req.query.afterId) : 0;
  try {
    const group = await getMyGroup(playerId);
    if (!group) return res.json({ groupId: null, messages: [] });
    const rows = await db.query(
      `SELECT m.id, m.sender_id, p.nickname AS sender_nickname, m.body, m.created_at
       FROM player_coop_group_messages m
       JOIN players p ON p.id = m.sender_id
       WHERE m.group_id = $1 AND m.id > $2
       ORDER BY m.id
       LIMIT 100`,
      [group.id, afterId]
    );
    res.json({ groupId: group.id, messages: rows.rows });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/coop/party/members/:targetId — expulsar a un miembro (solo el líder)
router.delete('/party/members/:targetId', async (req, res, next) => {
  const { playerId, targetId } = req.params;
  try {
    const group = await getMyGroup(playerId);
    if (!group) return res.status(400).json({ error: 'No estás en un grupo co-op' });
    if (group.leader_id !== Number(playerId)) {
      return res.status(403).json({ error: 'Solo el líder puede expulsar miembros' });
    }
    if (Number(targetId) === Number(playerId)) {
      return res.status(400).json({ error: 'No podés expulsarte a vos mismo, usá "Salir del grupo"' });
    }
    const removed = await db.query(
      'DELETE FROM player_coop_group_members WHERE group_id=$1 AND player_id=$2 RETURNING player_id',
      [group.id, targetId]
    );
    if (!removed.rows.length) return res.status(404).json({ error: 'Ese jugador no está en tu grupo' });
    await db.query('DELETE FROM player_coop_ready WHERE player_id=$1', [targetId]);

    const sessionId = await getActiveCombatSessionId(targetId);
    if (sessionId) {
      await db.query(
        `INSERT INTO combat_abandoned_players(session_id, player_id, penalized)
         VALUES ($1, $2, FALSE) ON CONFLICT DO NOTHING`,
        [sessionId, targetId]
      );
      await db.query(
        `UPDATE player_tower_runs SET abandoned_player_ids = array_append(abandoned_player_ids, $1)
         WHERE status = 'IN_PROGRESS' AND (player_id = $1 OR guest_player_id = $1 OR guest_player_id_2 = $1)
           AND NOT ($1 = ANY(abandoned_player_ids))`,
        [targetId]
      );
    }

    const remaining = await getGroupMemberIds(group.id);
    if (remaining.length <= 1) {
      await db.query('DELETE FROM player_coop_groups WHERE id=$1', [group.id]);
      if (remaining.length === 1) {
        await db.query('DELETE FROM player_coop_ready WHERE player_id=$1', [remaining[0]]);
      }
    }
    res.json({ message: 'Jugador expulsado del grupo' });
  } catch (error) { next(error); }
});

module.exports = router;
