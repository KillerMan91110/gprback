// La Tundra Eterna: los trineos de perros de Skadi. Viaje rápido entre la perrera de Fiordo Blanco
// (Skadi), la Aldea de los Mamuts (su hermana Kari) y el Campamento de los Cazadores (su hermano Leif),
// como los botes de Marul en las Costas (lib/botes.js). Cuesta un poco de oro y solo te lleva a una
// parada de una subzona que ya descubriste caminando.
const db = require('../db/db');
const { lejosDe } = require('./cercania');
const { spendCurrency } = require('./currency');

const TRINEO_COST = 30;
// x, y: casilla donde te deja (locales de la Tundra, junto al conductor; art/mapas/generar_tundra.js)
const PARADAS = {
  fiordo: { lugar: 'skadi', subzona: 'Fiordo Blanco', nombre: 'la perrera de Fiordo Blanco', x: 124, y: 104 },
  aldea: { lugar: 'trineo_aldea', subzona: 'Aldea de los Mamuts', nombre: 'la Aldea de los Mamuts', x: 104, y: 77 },
  campamento: { lugar: 'trineo_campamento', subzona: 'Campamento de los Cazadores', nombre: 'el Campamento de los Cazadores', x: 26, y: 70 },
};

async function viajar(playerId, destino) {
  const dest = PARADAS[destino];
  if (!dest) return { status: 400, error: 'Esa parada no existe' };
  // hay que estar junto a otra parada
  const lejos = lejosDe(playerId, Object.values(PARADAS).filter((e) => e !== dest).map((e) => e.lugar), 'una parada de trineos');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  // Fiordo Blanco se conoce al desembarcar; las otras dos, llegando a pie una vez
  if (destino !== 'fiordo' && process.env.POSICION_LIBRE !== '1') {
    const exp = await db.query("SELECT subzones FROM player_exploration WHERE player_id = $1 AND zone_dir = 'tundra'", [playerId]).catch(() => ({ rows: [] }));
    if (!(exp.rows[0]?.subzones ?? []).includes(dest.subzona)) {
      return { status: 400, error: `Todavía no conoces ${dest.nombre}: llega caminando una vez y después los perros te llevan.` };
    }
  }
  const gold = await spendCurrency(playerId, 'gold', TRINEO_COST);
  if (gold == null) return { status: 400, error: `El viaje cuesta ${TRINEO_COST} de oro` };
  return { ok: true, gold, zona: 'tundra', x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

module.exports = { PARADAS, TRINEO_COST, viajar };
