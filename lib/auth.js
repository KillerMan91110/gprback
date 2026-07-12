const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_EXPIRES_IN = '7d';

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(playerId) {
  return jwt.sign({ playerId }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

// Exige un Bearer token valido y deja el playerId disponible en req.playerId.
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Falta el token de autenticación' });
  }

  try {
    const payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET);
    req.playerId = payload.playerId;
    db.query('UPDATE players SET last_seen_at = now() WHERE id = $1', [payload.playerId]).catch(() => {});
    next();
  } catch {
    res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Exige que el :playerId de la ruta sea el mismo jugador del token, para que nadie pueda
// craftear/completar quests/pelear en nombre de otra cuenta.
function requireSelf(req, res, next) {
  const routeParam = req.params.playerId;
  if (String(req.playerId) !== String(routeParam)) {
    return res.status(403).json({ error: 'No podés actuar en nombre de otro jugador' });
  }
  next();
}

module.exports = { hashPassword, verifyPassword, signToken, requireAuth, requireSelf };
