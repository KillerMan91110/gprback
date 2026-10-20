// Las Catacumbas del Abismo: la barca de Óbolo, el barquero de almas. Viaje rápido entre el muelle de Vela
// Eterna, el muelle del Lago Negro y la orilla del Río de las Almas, como los trineos de la Tundra
// (lib/trineos.js). Óbolo cobra una moneda, como manda la tradición (una moneda de las de antes: 40 de
// oro), y solo te lleva a una parada de una subzona que ya descubriste caminando.
const db = require('../db/db');
const { lejosDe } = require('./cercania');
const { spendCurrency } = require('./currency');

const BARCA_COST = 40;
// x, y: casilla donde te deja (locales de las Catacumbas, junto a Óbolo; art/mapas/generar_catacumbas.js)
const PARADAS = {
  vela: { lugar: 'obolo', subzona: 'Vela Eterna', nombre: 'el muelle de Vela Eterna', x: 101, y: 52 },
  lago: { lugar: 'barca_lago', subzona: 'Lago Negro', nombre: 'el muelle del Lago Negro', x: 58, y: 96 },
  rio: { lugar: 'barca_rio', subzona: 'Río de las Almas', nombre: 'la orilla del Río de las Almas', x: 25, y: 72 },
};

async function viajar(playerId, destino) {
  const dest = PARADAS[destino];
  if (!dest) return { status: 400, error: 'Esa parada no existe' };
  // hay que estar junto a otra parada
  const lejos = lejosDe(playerId, Object.values(PARADAS).filter((e) => e !== dest).map((e) => e.lugar), 'Óbolo y su barca');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  // Vela Eterna se conoce al llegar; las otras dos, llegando a pie una vez
  if (destino !== 'vela' && process.env.POSICION_LIBRE !== '1') {
    const exp = await db.query("SELECT subzones FROM player_exploration WHERE player_id = $1 AND zone_dir = 'catacumbas'", [playerId]).catch(() => ({ rows: [] }));
    if (!(exp.rows[0]?.subzones ?? []).includes(dest.subzona)) {
      return { status: 400, error: `Todavía no conoces ${dest.nombre}: llega caminando una vez y después Óbolo te lleva.` };
    }
  }
  const gold = await spendCurrency(playerId, 'gold', BARCA_COST);
  if (gold == null) return { status: 400, error: `Óbolo cobra una moneda: ${BARCA_COST} de oro` };
  return { ok: true, gold, zona: 'catacumbas', x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

module.exports = { PARADAS, BARCA_COST, viajar };
