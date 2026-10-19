// Las Costas Muertas: los botes de Marul. Viaje rápido entre el embarcadero de Coralia (Marul), la
// Cala de los Piratas (su primo Sargo) y el Cementerio de Barcos (su primo Bagre), como las balsas de
// Pumo en el Volcán (lib/brasas.js). Cuesta un poco de oro y solo te lleva a un muelle de una subzona
// que ya descubriste caminando.
const db = require('../db/db');
const { lejosDe } = require('./cercania');
const { spendCurrency } = require('./currency');

const BOTE_COST = 25;
// x, y: casilla donde te deja (locales de las Costas, junto al barquero; art/mapas/generar_costas.js)
const MUELLES = {
  coralia: { lugar: 'barquero_coralia', subzona: 'Coralia', nombre: 'el embarcadero de Coralia', x: 144, y: 63 },
  cala: { lugar: 'barquero_cala', subzona: 'Cala de los Piratas', nombre: 'la Cala de los Piratas', x: 19, y: 23 },
  cementerio: { lugar: 'barquero_cementerio', subzona: 'Cementerio de Barcos', nombre: 'el Cementerio de Barcos', x: 49, y: 112 },
};

async function viajar(playerId, destino) {
  const dest = MUELLES[destino];
  if (!dest) return { status: 400, error: 'Ese muelle no existe' };
  // hay que estar junto a otro muelle
  const lejos = lejosDe(playerId, Object.values(MUELLES).filter((e) => e !== dest).map((e) => e.lugar), 'un muelle de los botes');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  const exp = await db.query("SELECT subzones FROM player_exploration WHERE player_id = $1 AND zone_dir = 'costas'", [playerId]).catch(() => ({ rows: [] }));
  if (!(exp.rows[0]?.subzones ?? []).includes(dest.subzona) && process.env.POSICION_LIBRE !== '1') {
    return { status: 400, error: `Todavía no conoces ${dest.nombre}: llega caminando una vez y después el bote te lleva.` };
  }
  const gold = await spendCurrency(playerId, 'gold', BOTE_COST);
  if (gold == null) return { status: 400, error: `El viaje cuesta ${BOTE_COST} de oro` };
  return { ok: true, gold, zona: 'costas', x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

module.exports = { MUELLES, BOTE_COST, viajar };
