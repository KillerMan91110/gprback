// La tormenta de las Montañas Grises.
//   - Vagonetas: viaje rápido entre las estaciones del Bastión, las Minas Abandonadas y la Garganta
//     del Eco (los trillizos Grun, Grat y Grot). Cuesta un poco de oro y solo te lleva a una
//     estación de una subzona que ya descubriste caminando.
//   - Rayos: en la Cumbre del Rey y los Acantilados del Trueno caen rayos (el front los dibuja y avisa
//     con una sombra). Si uno te alcanza, el servidor te quita una parte de la vida (nunca te deja en 0).
const db = require('../db/db');
const { lejosDe, positionOf } = require('./cercania');
const { spendCurrency } = require('./currency');

const VAGONETA_COST = 15;
// x, y: casilla donde te deja (locales de las Montañas, junto al vagonetero)
const ESTACIONES = {
  bastion: { lugar: 'vagonetero_bastion', subzona: 'Bastión de Hierro', nombre: 'el Bastión de Hierro', x: 66, y: 40 },
  minas: { lugar: 'vagonetero_minas', subzona: 'Minas Abandonadas', nombre: 'las Minas Abandonadas', x: 40, y: 20 },
  garganta: { lugar: 'vagonetero_garganta', subzona: 'Garganta del Eco', nombre: 'la Garganta del Eco', x: 37, y: 97 },
};

async function viajar(playerId, destino) {
  const dest = ESTACIONES[destino];
  if (!dest) return { status: 400, error: 'Esa estación no existe' };
  // hay que estar junto a otra estación
  const lejos = lejosDe(playerId, Object.values(ESTACIONES).filter((e) => e !== dest).map((e) => e.lugar), 'una estación de vagonetas');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  const exp = await db.query("SELECT subzones FROM player_exploration WHERE player_id = $1 AND zone_dir = 'montanas'", [playerId]).catch(() => ({ rows: [] }));
  if (!(exp.rows[0]?.subzones ?? []).includes(dest.subzona) && process.env.POSICION_LIBRE !== '1') {
    return { status: 400, error: `Todavía no conoces ${dest.nombre}: llega caminando una vez y después la vagoneta te lleva.` };
  }
  const gold = await spendCurrency(playerId, 'gold', VAGONETA_COST);
  if (gold == null) return { status: 400, error: `El viaje cuesta ${VAGONETA_COST} de oro` };
  return { ok: true, gold, zona: 'montanas', x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

// ---------------------------------------------------------------- rayos
// dónde caen (píxeles locales de las Montañas, como las subzonas del mapa)
const TORMENTA = [[3328, 2688, 5120, 3840], [2592, 1216, 5120, 2688]];
const RAYO_PCT = 0.12;
const RAYO_COOLDOWN_MS = 15000;
const lastHit = new Map();

async function rayo(playerId) {
  const pos = positionOf(Number(playerId));
  const libre = process.env.POSICION_LIBRE === '1';
  if (!libre && (!pos || pos.zone !== 'montanas' || !TORMENTA.some(([x0, y0, x1, y1]) => pos.x >= x0 && pos.x < x1 && pos.y >= y0 && pos.y < y1))) {
    return { status: 400, error: 'Aquí no hay tormenta' };
  }
  const now = Date.now();
  if (now - (lastHit.get(Number(playerId)) ?? 0) < RAYO_COOLDOWN_MS) return { ok: true, damage: 0 };
  // te deja con al menos 1 de vida: el rayo asusta y duele, pero no te mata
  const r = await db.query(
    `UPDATE players SET hp = GREATEST(1, hp - GREATEST(1, ROUND(max_hp * $2::numeric))::int), updated_at = now()
     WHERE id = $1 RETURNING hp, max_hp`,
    [playerId, RAYO_PCT]
  );
  const row = r.rows[0];
  if (row) lastHit.set(Number(playerId), now);
  return row ? { ok: true, damage: Math.round(row.max_hp * RAYO_PCT), hp: row.hp, maxHp: row.max_hp } : { status: 404, error: 'Jugador no encontrado' };
}

module.exports = { ESTACIONES, VAGONETA_COST, viajar, rayo };
