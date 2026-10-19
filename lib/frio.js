// El frío de la Tundra Eterna: fuera de Fiordo Blanco el héroe pierde calor (lo lleva el front:
// gpr/src/game/world/frio.js); con la barra vacía queda entumecido y cada tanto el frío le quita un poco
// de vida. Aquí se cobra ese golpe: una parte de la vida máxima, nunca hasta 0 (como las brasas del
// Volcán y los rayos de las Montañas), y no más seguido que el front.
const db = require('../db/db');
const { positionOf } = require('./cercania');

const FRIO_PCT = 0.05;
const FRIO_COOLDOWN_MS = 10000;
// Fiordo Blanco (píxeles locales de la Tundra, como sus subzonas): ahí no hace frío
const FIORDO = [3840, 2816, 5120, 3840];
const lastHit = new Map();

async function golpe(playerId) {
  const pos = positionOf(Number(playerId));
  const libre = process.env.POSICION_LIBRE === '1';
  const enFiordo = pos && pos.x >= FIORDO[0] && pos.x < FIORDO[2] && pos.y >= FIORDO[1] && pos.y < FIORDO[3];
  if (!libre && (!pos || pos.zone !== 'tundra' || enFiordo)) return { status: 400, error: 'Aquí no hace tanto frío' };
  const now = Date.now();
  if (now - (lastHit.get(Number(playerId)) ?? 0) < FRIO_COOLDOWN_MS) return { ok: true, damage: 0 };
  const r = await db.query(
    `UPDATE players SET hp = GREATEST(1, hp - GREATEST(1, ROUND(max_hp * $2::numeric))::int), updated_at = now()
     WHERE id = $1 RETURNING hp, max_hp`,
    [playerId, FRIO_PCT]
  );
  const row = r.rows[0];
  if (row) lastHit.set(Number(playerId), now);
  return row ? { ok: true, damage: Math.round(row.max_hp * FRIO_PCT), hp: row.hp, maxHp: row.max_hp } : { status: 404, error: 'Jugador no encontrado' };
}

module.exports = { FRIO_PCT, golpe };
