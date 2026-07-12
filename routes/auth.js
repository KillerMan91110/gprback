const express = require('express');
const db = require('../db/db');
const { hashPassword, verifyPassword, signToken, requireAuth } = require('../lib/auth');

const router = express.Router();

// Las 5 clases base (Guerrero, Mago, Arquero, Pícaro, Sacerdote) son las únicas elegibles al
// crear personaje; el resto (ids 6+) son evoluciones tier 2/3 que solo se alcanzan jugando.
const BASE_CLASS_IDS = [1, 2, 3, 4, 5];
const STARTING_GOLD = 2500;

// POST /api/auth/register
// body: { email, password, nickname, classId }
router.post('/register', async (req, res, next) => {
  const { email, password, nickname, classId } = req.body;

  if (!email || !password || !nickname || !classId) {
    return res.status(400).json({ error: 'email, password, nickname y classId son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  if (!BASE_CLASS_IDS.includes(Number(classId))) {
    return res.status(400).json({ error: 'classId debe ser una de las 5 clases base (1-5)' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const emailTaken = await db.query('SELECT id FROM players WHERE email = $1', [normalizedEmail]);
    if (emailTaken.rows.length) {
      return res.status(409).json({ error: 'Ese email ya está registrado' });
    }

    const nicknameTaken = await db.query('SELECT id FROM players WHERE nickname = $1', [nickname]);
    if (nicknameTaken.rows.length) {
      return res.status(409).json({ error: 'Ese nickname ya está en uso' });
    }

    const classResult = await db.query(
      'SELECT base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd, base_crit_chance, base_mana FROM classes WHERE id = $1',
      [classId]
    );
    if (!classResult.rows.length) {
      return res.status(400).json({ error: 'Clase no encontrada' });
    }
    const base = classResult.rows[0];
    const passwordHash = await hashPassword(password);

    const result = await db.query(
      `INSERT INTO players(email, password_hash, nickname, current_class_id, hp, max_hp, mana, max_mana, atk, def, mag, magic_def, spd, crit, gold)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, nickname, current_class_id, level, rank`,
      [normalizedEmail, passwordHash, nickname, classId, base.base_hp, base.base_mana, base.base_atk, base.base_def, base.base_mag, base.base_magic_def, base.base_spd, base.base_crit_chance, STARTING_GOLD]
    );

    const player = result.rows[0];

    // Pradera Dorada desbloqueada desde el inicio para todos los jugadores nuevos.
    await db.query(
      `INSERT INTO player_zone_unlocks(player_id, zone_id)
       SELECT $1, id FROM monster_zones WHERE name = 'Pradera Dorada'
       ON CONFLICT DO NOTHING`,
      [player.id]
    );

    res.status(201).json({ token: signToken(player.id), player });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email o nickname ya en uso' });
    }
    next(error);
  }
});

// POST /api/auth/login
// body: { email, password }
router.post('/login', async (req, res, next) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son requeridos' });
  }

  try {
    const result = await db.query(
      'SELECT id, password_hash, nickname, rank FROM players WHERE email = $1',
      [email.toLowerCase().trim()]
    );
    if (!result.rows.length) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const player = result.rows[0];
    const valid = await verifyPassword(password, player.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    res.json({
      token: signToken(player.id),
      player: { id: player.id, nickname: player.nickname, rank: player.rank },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout — marca al jugador como offline (last_seen_at = NULL)
router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await db.query('UPDATE players SET last_seen_at = NULL WHERE id = $1', [req.playerId]);
    res.json({ message: 'Sesión cerrada' });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/check-nickname?nickname=...
// Para que el front pueda validar disponibilidad en vivo mientras el usuario escribe.
router.get('/check-nickname', async (req, res, next) => {
  const { nickname } = req.query;
  if (!nickname) return res.status(400).json({ error: 'nickname es requerido' });

  try {
    const result = await db.query('SELECT id FROM players WHERE nickname = $1', [nickname]);
    res.json({ available: result.rows.length === 0 });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
