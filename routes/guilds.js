const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../lib/auth');
const {
  guildXpForLevel, guildMemberCap, getPlayerGuildRow, logGuildActivity,
  GUILD_EMBLEMS, GUILD_COLORS,
} = require('../lib/guilds');

const router = express.Router();
router.use(requireAuth);

const GUILD_CREATE_COST = 50000;
const DEPOSIT_COOLDOWN_HOURS = 24;

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

    const [membersRes, combatStatsRes] = await Promise.all([
      db.query(
        `SELECT p.id, p.nickname, p.level, p.rank, p.last_seen_at, gm.role, gm.joined_at,
                c.name AS class_name
         FROM guild_members gm
         JOIN players p ON p.id = gm.player_id
         LEFT JOIN classes c ON c.id = p.current_class_id
         WHERE gm.guild_id = $1
         ORDER BY CASE gm.role WHEN 'LEADER' THEN 1 WHEN 'OFFICER' THEN 2 ELSE 3 END, p.level DESC`,
        [guild.id]
      ),
      db.query(
        `SELECT COALESCE(SUM(p.combat_wins), 0)::int AS wins,
                COALESCE(SUM(p.combat_losses), 0)::int AS losses,
                COALESCE(SUM(p.boss_kills), 0)::int AS boss_kills
         FROM guild_members gm
         JOIN players p ON p.id = gm.player_id
         WHERE gm.guild_id = $1`,
        [guild.id]
      ),
    ]);

    res.json({
      id: guild.id,
      name: guild.name,
      description: guild.description,
      level: guild.level,
      xp: Number(guild.xp),
      xpToNextLevel: guildXpForLevel(guild.level),
      type: guild.type,
      myRole: guild.role,
      foundedAt: guild.created_at,
      emblem: guild.emblem,
      color: guild.color,
      bankGold: Number(guild.bank_gold),
      memberCap: guildMemberCap(guild.level),
      combatStats: {
        wins: combatStatsRes.rows[0].wins,
        losses: combatStatsRes.rows[0].losses,
        bossKills: combatStatsRes.rows[0].boss_kills,
      },
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
      foundedAt: guild.created_at,
      emblem: guild.emblem,
      color: guild.color,
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

    const guildRes = await db.query('SELECT id, name, type, level FROM guilds WHERE id = $1', [req.params.id]);
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
    const guild = guildRes.rows[0];

    if (guild.type === 'CLOSED') {
      return res.status(403).json({ error: 'Este gremio es cerrado; necesitas una invitación' });
    }

    const memberCountRes = await db.query('SELECT COUNT(*)::int AS count FROM guild_members WHERE guild_id = $1', [guild.id]);
    if (memberCountRes.rows[0].count >= guildMemberCap(guild.level)) {
      return res.status(400).json({ error: 'El gremio está lleno' });
    }

    await db.query(
      `INSERT INTO guild_members(guild_id, player_id, role) VALUES($1, $2, 'MEMBER')`,
      [guild.id, playerId]
    );
    await logGuildActivity(guild.id, 'JOIN', null, playerId);
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
    await logGuildActivity(guildId, 'LEAVE', playerId, playerId);
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
    await logGuildActivity(guildId, 'KICK', actorId, targetPlayerId);
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
    const { name, description, type, emblem, color } = req.body;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length || memberRes.rows[0].role !== 'LEADER') {
      return res.status(403).json({ error: 'Solo el líder puede editar el gremio' });
    }

    const updates = [];
    const params = [];
    let infoChanged = false;
    if (name !== undefined) {
      if (name.trim().length < 3 || name.trim().length > 50) {
        return res.status(400).json({ error: 'El nombre debe tener entre 3 y 50 caracteres' });
      }
      params.push(name.trim()); updates.push(`name = $${params.length}`);
      infoChanged = true;
    }
    if (description !== undefined) {
      params.push(description?.trim() || null); updates.push(`description = $${params.length}`);
      infoChanged = true;
    }
    if (type !== undefined) {
      if (!['OPEN', 'CLOSED'].includes(type)) return res.status(400).json({ error: "Tipo inválido: usa 'OPEN' o 'CLOSED'" });
      params.push(type); updates.push(`type = $${params.length}`);
      infoChanged = true;
    }
    if (emblem !== undefined || color !== undefined) {
      const guildRes = await db.query('SELECT level FROM guilds WHERE id = $1', [guildId]);
      if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
      if (guildRes.rows[0].level < 3) {
        return res.status(400).json({ error: 'El gremio necesita nivel 3 para elegir emblema' });
      }
    }
    if (emblem !== undefined) {
      if (!GUILD_EMBLEMS.includes(emblem)) return res.status(400).json({ error: 'Emblema inválido' });
      params.push(emblem); updates.push(`emblem = $${params.length}`);
    }
    if (color !== undefined) {
      if (!GUILD_COLORS.includes(color)) return res.status(400).json({ error: 'Color inválido' });
      params.push(color); updates.push(`color = $${params.length}`);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada que actualizar' });

    params.push(guildId);
    await db.query(`UPDATE guilds SET ${updates.join(', ')} WHERE id = $${params.length}`, params);
    if (infoChanged) await logGuildActivity(guildId, 'EDIT', playerId);
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
    await logGuildActivity(guildId, role === 'OFFICER' ? 'PROMOTE' : 'DEMOTE', actorId, targetPlayerId);
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
    await logGuildActivity(guildId, 'TRANSFER', actorId, targetPlayerId);

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

    const guildRes = await db.query('SELECT level FROM guilds WHERE id = $1', [guildId]);
    const memberCountRes = await db.query('SELECT COUNT(*)::int AS count FROM guild_members WHERE guild_id = $1', [guildId]);
    if (memberCountRes.rows[0].count >= guildMemberCap(guildRes.rows[0].level)) {
      return res.status(400).json({ error: 'El gremio está lleno' });
    }

    await db.query(
      `INSERT INTO guild_members(guild_id, player_id, role) VALUES($1, $2, 'MEMBER')`,
      [guildId, joinReq.player_id]
    );
    await db.query('DELETE FROM guild_join_requests WHERE id = $1', [requestId]);
    await logGuildActivity(guildId, 'JOIN', actorId, joinReq.player_id);
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

// GET /api/guilds/:id/activity - historial paginado (solo miembros)
router.get('/:id/activity', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const before = req.query.before ? Number(req.query.before) : null;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });

    const params = [guildId];
    let where = 'gal.guild_id = $1';
    if (before) {
      params.push(before);
      where += ` AND gal.id < $${params.length}`;
    }
    params.push(limit);

    const activityRes = await db.query(
      `SELECT gal.id, gal.type, gal.actor_id, actor.nickname AS actor_nickname,
              gal.target_id, target.nickname AS target_nickname, gal.meta, gal.created_at
       FROM guild_activity_log gal
       LEFT JOIN players actor ON actor.id = gal.actor_id
       LEFT JOIN players target ON target.id = gal.target_id
       WHERE ${where}
       ORDER BY gal.id DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(activityRes.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/guilds/:id/bank - estado del banco (solo miembros)
router.get('/:id/bank', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });

    const guildRes = await db.query('SELECT bank_gold FROM guilds WHERE id = $1', [guildId]);
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });

    const [topContributorsRes, weeklyRes, myLastDonationRes] = await Promise.all([
      db.query(
        `SELECT gbt.player_id, p.nickname, SUM(gbt.amount)::bigint AS total_donated
         FROM guild_bank_transactions gbt
         JOIN players p ON p.id = gbt.player_id
         WHERE gbt.guild_id = $1 AND gbt.type = 'DEPOSIT'
         GROUP BY gbt.player_id, p.nickname
         ORDER BY total_donated DESC
         LIMIT 10`,
        [guildId]
      ),
      db.query(
        `SELECT COALESCE(SUM(amount), 0)::bigint AS total
         FROM guild_bank_transactions
         WHERE guild_id = $1 AND type = 'DEPOSIT' AND created_at > now() - INTERVAL '7 days'`,
        [guildId]
      ),
      db.query(
        `SELECT created_at FROM guild_bank_transactions
         WHERE guild_id = $1 AND player_id = $2 AND type = 'DEPOSIT'
         ORDER BY created_at DESC LIMIT 1`,
        [guildId, playerId]
      ),
    ]);

    res.json({
      bankGold: Number(guildRes.rows[0].bank_gold),
      topContributors: topContributorsRes.rows.map((r) => ({
        playerId: r.player_id, nickname: r.nickname, totalDonated: Number(r.total_donated),
      })),
      weeklyContribution: Number(weeklyRes.rows[0].total),
      myLastDonationAt: myLastDonationRes.rows[0]?.created_at || null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/guilds/:id/bank/deposit - donar oro propio al banco (1x/día, requiere nivel >= 2)
router.post('/:id/bank/deposit', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;
    const amount = Math.floor(Number(req.body?.amount));

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Monto de donación inválido' });
    }

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });

    const guildRes = await db.query('SELECT level FROM guilds WHERE id = $1', [guildId]);
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
    if (guildRes.rows[0].level < 2) {
      return res.status(400).json({ error: 'El gremio necesita nivel 2 para tener banco' });
    }

    const lastDepositRes = await db.query(
      `SELECT created_at FROM guild_bank_transactions
       WHERE guild_id = $1 AND player_id = $2 AND type = 'DEPOSIT'
       ORDER BY created_at DESC LIMIT 1`,
      [guildId, playerId]
    );
    if (lastDepositRes.rows.length) {
      const elapsedMs = Date.now() - new Date(lastDepositRes.rows[0].created_at).getTime();
      if (elapsedMs < DEPOSIT_COOLDOWN_HOURS * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Ya donaste hoy; podés volver a donar en 24hs' });
      }
    }

    const playerRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (Number(playerRes.rows[0].gold) < amount) {
      return res.status(400).json({ error: 'No tienes suficiente oro' });
    }

    await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [amount, playerId]);
    await db.query('UPDATE guilds SET bank_gold = bank_gold + $1 WHERE id = $2', [amount, guildId]);
    await db.query(
      `INSERT INTO guild_bank_transactions(guild_id, player_id, type, amount) VALUES ($1, $2, 'DEPOSIT', $3)`,
      [guildId, playerId, amount]
    );
    await logGuildActivity(guildId, 'DONATION', playerId, null, { amount });

    res.json({ message: `Donaste ${amount.toLocaleString()} de oro al banco del gremio` });
  } catch (error) {
    next(error);
  }
});

// GET /api/guilds/:id/shop - catálogo de la tienda de gremio (mismo catálogo con buy_price)
router.get('/:id/shop', async (req, res, next) => {
  try {
    const playerId = req.playerId;
    const { id: guildId } = req.params;

    const memberRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, playerId]
    );
    if (!memberRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });

    const itemsRes = await db.query('SELECT * FROM items WHERE buy_price IS NOT NULL ORDER BY buy_price');
    res.json(itemsRes.rows);
  } catch (error) {
    next(error);
  }
});

// POST /api/guilds/:id/shop/buy - comprar con oro de gremio y enviar a un miembro (Líder/Oficial)
router.post('/:id/shop/buy', async (req, res, next) => {
  try {
    const actorId = req.playerId;
    const { id: guildId } = req.params;
    const { itemId, recipientPlayerId } = req.body;
    const quantity = Math.floor(Number(req.body?.quantity)) || 1;

    if (quantity <= 0) return res.status(400).json({ error: 'Cantidad inválida' });

    const actorRes = await db.query(
      `SELECT role FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, actorId]
    );
    if (!actorRes.rows.length) return res.status(403).json({ error: 'No eres miembro de este gremio' });
    if (!['LEADER', 'OFFICER'].includes(actorRes.rows[0].role)) {
      return res.status(403).json({ error: 'Solo el líder y los oficiales pueden comprar en la tienda del gremio' });
    }

    const guildRes = await db.query('SELECT level, bank_gold, name FROM guilds WHERE id = $1', [guildId]);
    if (!guildRes.rows.length) return res.status(404).json({ error: 'Gremio no encontrado' });
    const guild = guildRes.rows[0];
    if (guild.level < 2) {
      return res.status(400).json({ error: 'El gremio necesita nivel 2 para tener tienda de gremio' });
    }

    const recipientRes = await db.query(
      `SELECT player_id FROM guild_members WHERE guild_id = $1 AND player_id = $2`,
      [guildId, recipientPlayerId]
    );
    if (!recipientRes.rows.length) return res.status(400).json({ error: 'El destinatario debe ser miembro del gremio' });

    const itemRes = await db.query('SELECT id, name, buy_price FROM items WHERE id = $1 AND buy_price IS NOT NULL', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Item no disponible en la tienda' });
    const item = itemRes.rows[0];

    const totalCost = item.buy_price * quantity;
    if (Number(guild.bank_gold) < totalCost) {
      return res.status(400).json({ error: 'El banco del gremio no tiene oro suficiente' });
    }

    await db.query('UPDATE guilds SET bank_gold = bank_gold - $1 WHERE id = $2', [totalCost, guildId]);

    const msgRes = await db.query(
      `INSERT INTO player_messages (sender_id, receiver_id, subject, body)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [actorId, recipientPlayerId, 'Compra del banco de gremio', `${item.name} x${quantity}`]
    );
    await db.query(
      `INSERT INTO player_message_items (message_id, item_id, quantity) VALUES ($1, $2, $3)`,
      [msgRes.rows[0].id, item.id, quantity]
    );

    await db.query(
      `INSERT INTO guild_bank_transactions(guild_id, player_id, type, amount, item_id, quantity, recipient_id)
       VALUES ($1, $2, 'PURCHASE', $3, $4, $5, $6)`,
      [guildId, actorId, totalCost, item.id, quantity, recipientPlayerId]
    );
    await logGuildActivity(guildId, 'SHOP_PURCHASE', actorId, recipientPlayerId, { itemId: item.id, quantity });

    res.json({ message: `Comprado ${item.name} x${quantity} y enviado por correo` });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
