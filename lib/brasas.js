// El Volcán Rojo: las balsas de Pumo y la lluvia de brasas (como lib/tormenta.js en las Montañas).
//   - Balsas de piedra pómez: viaje rápido entre los muelles de los Ríos de Lava, la Cantera de
//     Obsidiana y la Caldera del Titán (Pumo y sus primas Toba y Lapilli). Cuesta un poco de oro y solo
//     te lleva a un muelle de una subzona que ya descubriste caminando.
//   - Brasas: en los Ríos de Lava, la Grieta Ardiente y la Caldera del Titán el volcán escupe piedras
//     ardientes (el front las dibuja y avisa con una sombra; bajo los arcos de basalto y junto a las
//     fogatas no te apuntan). Si una te alcanza, el servidor te quita una parte de la vida (nunca te deja en 0).
const db = require('../db/db');
const { lejosDe, positionOf } = require('./cercania');
const { spendCurrency } = require('./currency');

const BALSA_COST = 20;
// x, y: casilla donde te deja (locales del Volcán, junto a la balsera; art/mapas/generar_volcan.js)
const MUELLES = {
  rios: { lugar: 'balsero_rios', subzona: 'Ríos de Lava', nombre: 'el muelle de los Ríos de Lava', x: 71, y: 48 },
  cantera: { lugar: 'balsero_cantera', subzona: 'Cantera de Obsidiana', nombre: 'el muelle de la Cantera', x: 122, y: 63 },
  caldera: { lugar: 'balsero_caldera', subzona: 'Caldera del Titán', nombre: 'el muelle de la Caldera', x: 79, y: 94 },
};

async function viajar(playerId, destino) {
  const dest = MUELLES[destino];
  if (!dest) return { status: 400, error: 'Ese muelle no existe' };
  // hay que estar junto a otro muelle
  const lejos = lejosDe(playerId, Object.values(MUELLES).filter((e) => e !== dest).map((e) => e.lugar), 'un muelle de balsas');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  const exp = await db.query("SELECT subzones FROM player_exploration WHERE player_id = $1 AND zone_dir = 'volcan'", [playerId]).catch(() => ({ rows: [] }));
  if (!(exp.rows[0]?.subzones ?? []).includes(dest.subzona) && process.env.POSICION_LIBRE !== '1') {
    return { status: 400, error: `Todavía no conoces ${dest.nombre}: llega caminando una vez y después la balsa te lleva.` };
  }
  const gold = await spendCurrency(playerId, 'gold', BALSA_COST);
  if (gold == null) return { status: 400, error: `El viaje cuesta ${BALSA_COST} de oro` };
  return { ok: true, gold, zona: 'volcan', x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

// ---------------------------------------------------------------- brasas
// dónde caen (píxeles locales del Volcán, como las subzonas del mapa)
const LLUVIA = [[1600, 1376, 3840, 2752], [0, 2752, 1920, 3840], [1920, 2752, 3712, 3840]];
const BRASA_PCT = 0.12;
const BRASA_COOLDOWN_MS = 15000;
const lastHit = new Map();

async function brasa(playerId) {
  const pos = positionOf(Number(playerId));
  const libre = process.env.POSICION_LIBRE === '1';
  if (!libre && (!pos || pos.zone !== 'volcan' || !LLUVIA.some(([x0, y0, x1, y1]) => pos.x >= x0 && pos.x < x1 && pos.y >= y0 && pos.y < y1))) {
    return { status: 400, error: 'Aquí no caen brasas' };
  }
  const now = Date.now();
  if (now - (lastHit.get(Number(playerId)) ?? 0) < BRASA_COOLDOWN_MS) return { ok: true, damage: 0 };
  // te deja con al menos 1 de vida: la brasa quema y asusta, pero no te mata
  const r = await db.query(
    `UPDATE players SET hp = GREATEST(1, hp - GREATEST(1, ROUND(max_hp * $2::numeric))::int), updated_at = now()
     WHERE id = $1 RETURNING hp, max_hp`,
    [playerId, BRASA_PCT]
  );
  const row = r.rows[0];
  if (row) lastHit.set(Number(playerId), now);
  return row ? { ok: true, damage: Math.round(row.max_hp * BRASA_PCT), hp: row.hp, maxHp: row.max_hp } : { status: 404, error: 'Jugador no encontrado' };
}

module.exports = { MUELLES, BALSA_COST, viajar, brasa };
