const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../lib/auth');
const { guildXpForLevel, getPlayerGuildRow } = require('../lib/guilds');

const router = express.Router();
router.use(requireAuth);

const GUILD_CREATE_COST = 50000;

// GET /api/guilds - lista de gremios con búsqueda opcional por nombre
router.get('/', async (req, res, next) => {
  try {
    const { search, limit = 20, offset = 0 } = req.query;
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE g.name ILIKE $${params.length}`;
    }
    params.push(Number(limit), Number(offset));
    const result = await db.query(
      `SELECT g.id, g.name, g.description, g.level, g.xp, g.type,
              p.nickname AS leader_name,
              COUNT(gm.player_id)::int AS member_count
       FROM guilds g
       JOIN players p ON p.id = g.leader_id
       LEFT JOIN guild_members gm ON gm.guild_id = g.id
       ${where}
       GROUP BY g.id, p.nickname
       ORDER BY g.level DESC, g.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(result.rows.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      level: g.level,
      xp: Number(g.xp),
      xpToNextLevel: guildXpForLevel(g.level),
      type: g.type,
      leaderName: g.leader_name,
      memberCount: g.member_count,
    })));
  } catch (error) {
    next(error);
  }
});

// GET /api/guilds/mine - gremio del jugador autenticado (para saber si está en uno)
router.get('/mine', async (req, res, next) => {
  try {
    const guild = await getPlayerGuildRow(req.playerId);
    if (!guild) return res.status(404).json({ error: 'No estás en ningún gremio' });

    const membersRes = await db.query(
      `SELECT p.id, p.nickname, p.level, p.rank, p.last_seen_at, gm.role, gm.joined_at,
              c.name AS class_name
       FROM guild_members gm
       JOIN players p ON p.id = gm.player_id
       LEFT JOIN classes c ON c.id = p.current_class_id
       WHERE gm.guild_id = $1
       ORDER BY CASE gm.role WHEN 'LEADER' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END, p.level DESC`,
      [guild.id]
    );

    res.json({
      id: guild.id,
      name: guild.name,
      description: guild.description,
      level: guild.level,
      xp: Number(guild.xp),
      xpToNextLevel: guildXpForLevel(guild.level),
      type: guild.type,
      myRole: guild.role,
      members: membersRes.rows,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/guilds/:id - detalle de un gremio específico
router.get('/:id', async (req, res, next) => {
  try {
    const guildRes = await db.query(
      `SELECT g.*, p.nickname AS leader_name FROM guilds g JOIN players p ON p.id = g.leader_id WHERE g.id = $1`,
      [req.params.id]
    );
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
    const guild = guildRes.rows[0];

    const membersRes = await db.query(
      `SELECT p.id, p.nickname, p.level, p.rank, p.last_seen_at, gm.role, gm.joined_at,
              c.name AS class_name
       FROM guild_members gm
       JOIN players p ON p.id = gm.player_id
       LEFT JOIN classes c ON c.id = p.current_class_id
       WHERE gm.guild_id = $1
       ORDER BY CASE gm.role WHEN 'LEADER' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END, p.level DESC`,
      [guild.id]
    );

    res.json({
      id: guild.id,
      name: guild.name,
      description: guild.description,
      level: guild.level,
      xp: Number(guild.xp),
      xpToNextLevel: guildXpForLevel(guild.level),
      type: guild.type,
      leaderName: guild.leader_name,
      members: membersRes.rows,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/guilds - crear gremio (cuesta 50.000 de oro)
router.post('/', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { name, description, type = 'OPEN' } = req.body;

    if (!name || name.trim().length < 3 || name.trim().length > 50) {
      return res.status(400).json({ error: 'El nombre debe tener entre 3 y 50 caracteres' });
    }
    if (!['OPEN', 'CLOSED'].includes(type)) {
      return res.status(400).json({ error: "Tipo inválido: usa 'OPEN' o 'CLOSED'" });
    }

    const existing = await getPlayerGuildRow(playerId);
    if (existing) return res.status(409).json({ error: 'Ya perteneces a un gremio' });

    const playerRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (Number(playerRes.rows[0].gold) < GUILD_CREATE_COST) {
      return res.status(400).json({ error: `Se necesitan ${GUILD_CREATE_COST.toLocaleString()} de oro para crear un gremio` });
    }

    await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [GUILD_CREATE_COST, playerId]);
    const guildRes = await db.query(
      `INSERT INTO guilds(name, description, leader_id, type) VALUES($1, $2, $3, $4) RETURNING id`,
      [name.trim(), description?.trim() || null, playerId, type]
    );
    const guildId = guildRes.rows[0].id;
    await db.query(
      `INSERT INTO guild_members(guild_id, player_id, role) VALUES($1, $2, 'LEADER')`,
      [guildId, playerId]
    );

    res.status(201).json({ id: guildId, name: name.trim(), message: 'Gremio creado exitosamente' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un gremio con ese nombre' });
    next(error);
  }
});

// POST /api/guilds/:id/join - unirse a un gremio abierto
router.post('/:id/join', async (req, res, next) => {
  try {
    const playerId = req.playerId;

    const existing = await getPlayerGuildRow(playerId);
    if (existing) return res.status(409).json({ error: 'Ya perteneces a un gremio' });

    const guildRes = await db.query('SELECT id, name, type FROM guilds WHERE id = $1', [req.params.id]);
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
    const guild = guildRes.rows[0];

    if (guild.type === 'CLOSED') {
      return res.status(403).json({ error: 'Este gremio es cerrado; necesitas una invitación' });
    }

    await db.query(
      `INSERT INTO guild_members(guild_id, player_id, role) VALUES($1, $2, 'MEMBER')`,
      [guild.id, playerId]
    );
    res.json({ message: `Te uniste al gremio "${guild.name}"` });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya eres miembro de este gremio' });
    next(error);
  }
});

// DELETE /api/guilds/:id/leave - salir del gremio
router.delete('/:id/leave', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length) return res.status(404).json({ error: 'No eres miembro de este gremio' });

    if (memberRes.rows[0].role === 'LEADER') {
      const othersRes = await db.query(
        `SELECT player_id FROM guild_members WHERE guild_id = $1 AND player_id != $2 LIMIT 1`,
        [guildId, playerId]
      );
      if (othersRes.rows.length) {
        return res.status(400).json({ error: 'Transfiere el liderazgo antes de salir' });
      }
      await db.query('DELETE FROM guilds WHERE id = $1', [guildId]);
      return res.json({ message: 'Gremio disuelto (eras el único miembro)' });
    }

    await db.query('DELETE FROM guild_members WHERE guild_id = $1 AND player_id = $2', [guildId, playerId]);
    res.json({ message: 'Saliste del gremio' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/guilds/:id/kick/:targetPlayerId - expulsar miembro
router.delete('/:id/kick/:targetPlayerId', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId, targetPlayerId } = req.params;

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });
    const actorRole = actorRes.rows[0].role;
    if (!['LEADER', 'OFFICER'].includes(actorRole)) {
      return res.status(403).json({ error: 'Sin permiso para expulsar miembros' });
    }

    const targetRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, targetPlayerId]
    );
    if (!targetRes.rows.length) return res.status(404).json({ error: 'El jugador no es miembro del gremio' });

    const targetRole = targetRes.rows[0].role;
    if (targetRole === 'LEADER') return res.status(403).json({ error: 'No se puede expulsar al líder' });
    if (targetRole === 'OFFICER' && actorRole !== 'LEADER') {
      return res.status(403).json({ error: 'Solo el líder puede expulsar oficiales' });
    }

    await db.query('DELETE FROM guild_members WHERE guild_id = $1 AND player_id = $2', [guildId, targetPlayerId]);
    res.json({ message: 'Miembro expulsado' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/guilds/:id - editar info del gremio (solo líder)
router.put('/:id', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;
    const { name, description, type } = req.body;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length || memberRes.rows[0].role !== 'LEADER') {
      return res.status(403).json({ error: 'Solo el líder puede editar el gremio' });
    }

    const updates = [];
    const params = [];
    if (name !== undefined) {
      if (name.trim().length < 3 || name.trim().length > 50) {
        return res.status(400).json({ error: 'El nombre debe tener entre 3 y 50 caracteres' });
      }
      params.push(name.trim()); updates.push(`name = $${params.length}`);
    }
    if (description !== undefined) {
      params.push(description?.trim() || null); updates.push(`description = $${params.length}`);
    }
    if (type !== undefined) {
      if (!['OPEN', 'CLOSED'].includes(type)) return res.status(400).json({ error: "Tipo inválido: usa 'OPEN' o 'CLOSED'" });
      params.push(type); updates.push(`type = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(guildId);
    await db.query(`UPDATE guilds SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    res.json({ message: 'Gremio actualizado' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un gremio con ese nombre' });
    next(error);
  }
});

// PUT /api/guilds/:id/promote/:targetPlayerId - ascender/degradar miembro (solo líder)
router.put('/:id/promote/:targetPlayerId', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId, targetPlayerId } = req.params;
    const { role } = req.body;

    if (!['OFFICER', 'MEMBER'].includes(role)) {
      return res.status(400).json({ error: "El rol debe ser 'OFFICER' o 'MEMBER'" });
    }

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length || actorRes.rows[0].role !== 'LEADER') {
      return res.status(403).json({ error: 'Solo el líder puede cambiar roles' });
    }

    const targetRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, targetPlayerId]
    );
    if (!targetRes.rows.length) return res.status(404).json({ error: 'Miembro no encontrado' });
    if (targetRes.rows[0].role === 'LEADER') {
      return res.status(400).json({ error: 'Usa /transfer para cambiar el liderazgo' });
    }

    await db.query(
      `UPDATE guild_members SET role = $1 WHERE guild_id = $2 AND player_id = $3`,
      [role, guildId, targetPlayerId]
    );
    res.json({ message: `Rol actualizado a ${role}` });
  } catch (error) {
    next(error);
  }
});

// PUT /api/guilds/:id/transfer/:targetPlayerId - transferir liderazgo
router.put('/:id/transfer/:targetPlayerId', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId, targetPlayerId } = req.params;

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length || actorRes.rows[0].role !== 'LEADER') {
      return res.status(403).json({ error: 'Solo el líder puede transferir el liderazgo' });
    }

    const targetRes = await db.query(
      `SELECT player_id FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, targetPlayerId]
    );
    if (!targetRes.rows.length) return res.status(404).json({ error: 'El jugador objetivo no es miembro del gremio' });

    await db.query('UPDATE guilds SET leader_id = $1 WHERE id = $2', [targetPlayerId, guildId]);
    await db.query(`UPDATE guild_members SET role = 'MEMBER' WHERE guild_id = $1 AND player_id = $2`, [guildId, actorId]);
    await db.query(`UPDATE guild_members SET role = 'LEADER' WHERE guild_id = $1 AND player_id = $2`, [guildId, targetPlayerId]);

    res.json({ message: 'Liderazgo transferido exitosamente' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/guilds/:id - disolver gremio (solo líder)
router.delete('/:id', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length || memberRes.rows[0].role !== 'LEADER') {
      return res.status(403).json({ error: 'Solo el líder puede disolver el gremio' });
    }

    await db.query('DELETE FROM guilds WHERE id = $1', [guildId]);
    res.json({ message: 'Gremio disuelto' });
  } catch (error) {
    next(error);
  }
});

// POST /api/guilds/:id/request - solicitar unirse a un gremio CLOSED
router.post('/:id/request', async (req, res, next) => {
  try {
    const playerId = req.playerId;

    const existing = await getPlayerGuildRow(playerId);
    if (existing) return res.status(409).json({ error: 'Ya perteneces a un gremio' });

    const guildRes = await db.query('SELECT id, name, type FROM guilds WHERE id = $1', [req.params.id]);
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
    const guild = guildRes.rows[0];

    if (guild.type === 'OPEN') {
      return res.status(400).json({ error: 'Este gremio es abierto; usa /join para unirte directamente' });
    }

    const pendingRes = await db.query(
      `SELECT id, status FROM guild_join_requests WHERE guild_id = $1 AND player_id = $2`,
      [guild.id, playerId]
    );
    if (pendingRes.rows.length) {
      const s = pendingRes.rows[0].status;
      if (s === 'PENDING') return res.status(409).json({ error: 'Ya tienes una solicitud pendiente en este gremio' });
      if (s === 'REJECTED') {
        // Permitir reintentar: actualizar la solicitud existente a PENDING
        await db.query(
          `UPDATE guild_join_requests SET status = 'PENDING', created_at = now(), resolved_at = NULL WHERE id = $1`,
          [pendingRes.rows[0].id]
        );
        return res.status(201).json({ message: `Solicitud reenviada al gremio "${guild.name}"` });
      }
    }

    await db.query(
      `INSERT INTO guild_join_requests(guild_id, player_id) VALUES($1, $2)`,
      [guild.id, playerId]
    );
    res.status(201).json({ message: `Solicitud enviada al gremio "${guild.name}"` });
  } catch (error) {
    next(error);
  }
});

// GET /api/guilds/:id/requests - ver solicitudes pendientes (líder/oficial)
router.get('/:id/requests', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId } = req.params;

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });
    if (!['LEADER', 'OFFICER'].includes(actorRes.rows[0].role)) {
      return res.status(403).json({ error: 'Solo el líder y los oficiales pueden ver las solicitudes' });
    }

    const requestsRes = await db.query(
      `SELECT gjr.id, gjr.player_id, p.nickname, p.level, p.rank, gjr.created_at,
              c.name AS class_name
       FROM guild_join_requests gjr
       JOIN players p ON p.id = gjr.player_id
       LEFT JOIN classes c ON c.id = p.current_class_id
       WHERE gjr.guild_id = $1 AND gjr.status = 'PENDING'
       ORDER BY gjr.created_at ASC`,
      [guildId]
    );
    res.json(requestsRes.rows);
  } catch (error) {
    next(error);
  }
});

// PUT /api/guilds/:id/requests/:requestId/accept - aceptar solicitud
router.put('/:id/requests/:requestId/accept', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId, requestId } = req.params;

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });
    if (!['LEADER', 'OFFICER'].includes(actorRes.rows[0].role)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar solicitudes' });
    }

    const reqRes = await db.query(
      `SELECT * FROM guild_join_requests WHERE id = $1 AND guild_id = $2 AND status = 'PENDING'`,
      [requestId, guildId]
    );
    if (!reqRes.rows.length) return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta' });
    const joinReq = reqRes.rows[0];

    const alreadyIn = await db.query('SELECT player_id FROM guild_members WHERE player_id = $1', [joinReq.player_id]);
    if (alreadyIn.rows.length) {
      await db.query('DELETE FROM guild_join_requests WHERE id = $1', [requestId]);
      return res.status(409).json({ error: 'El jugador ya pertenece a un gremio' });
    }

    await db.query(
      `INSERT INTO guild_members(guild_id, player_id, role) VALUES($1, $2, 'MEMBER')`,
      [guildId, joinReq.player_id]
    );
    await db.query('DELETE FROM guild_join_requests WHERE id = $1', [requestId]);
    res.json({ message: 'Solicitud aceptada' });
  } catch (error) {
    next(error);
  }
});

// PUT /api/guilds/:id/requests/:requestId/reject - rechazar solicitud
router.put('/:id/requests/:requestId/reject', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId, requestId } = req.params;

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });
    if (!['LEADER', 'OFFICER'].includes(actorRes.rows[0].role)) {
      return res.status(403).json({ error: 'Sin permiso para gestionar solicitudes' });
    }

    const result = await db.query(
      `UPDATE guild_join_requests SET status = 'REJECTED', resolved_at = now()
       WHERE id = $1 AND guild_id = $2 AND status = 'PENDING'`,
      [requestId, guildId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Solicitud no encontrada o ya resuelta' });
    res.json({ message: 'Solicitud rechazada' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
