// Las Ruinas Ancestrales: las Escalinatas de Luz. Viaje rápido entre el Santuario de las Lágrimas, el Patio de
// las Estatuas y las Torres del Velo, como la barca de Óbolo en las Catacumbas (lib/barca.js). Es gratis: es
// luz de Aethra. Solo te lleva a una escalinata de una subzona que ya descubriste caminando.
const db = require('../db/db');
const { lejosDe } = require('./cercania');

// x, y: casilla donde te deja (locales de las Ruinas, al pie del círculo de luz; art/mapas/generar_ruinas.js)
const PARADAS = {
  santuario: { lugar: 'escalinata_santuario', subzona: 'Santuario de las Lágrimas', nombre: 'el Santuario de las Lágrimas', x: 66, y: 85 },
  patio: { lugar: 'escalinata_patio', subzona: 'Patio de las Estatuas', nombre: 'el Patio de las Estatuas', x: 60, y: 49 },
  torres: { lugar: 'escalinata_torres', subzona: 'Torres del Velo', nombre: 'las Torres del Velo', x: 22, y: 19 },
};

async function viajar(playerId, destino) {
  const dest = PARADAS[destino];
  if (!dest) return { status: 400, error: 'Esa escalinata no existe' };
  // hay que estar parado en otra escalinata
  const lejos = lejosDe(playerId, Object.values(PARADAS).filter((e) => e !== dest).map((e) => e.lugar), 'una Escalinata de Luz');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  // el Santuario se conoce al llegar; las otras dos, llegando a pie una vez
  if (destino !== 'santuario' && process.env.POSICION_LIBRE !== '1') {
    const exp = await db.query("SELECT subzones FROM player_exploration WHERE player_id = $1 AND zone_dir = 'ruinas'", [playerId]).catch(() => ({ rows: [] }));
    if (!(exp.rows[0]?.subzones ?? []).includes(dest.subzona)) {
      return { status: 400, error: `Todavía no conoces ${dest.nombre}: llega caminando una vez y después la escalinata te lleva.` };
    }
  }
  return { ok: true, zona: 'ruinas', x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

module.exports = { PARADAS, viajar };
