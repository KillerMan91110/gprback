// La marea de las Costas Muertas. Cada 6 minutos sube o baja, con el reloj del servidor (así todos la
// ven igual; el front hace la misma cuenta en gpr/src/game/world/marea.js):
//   - marea baja: aparecen los bancos de arena que unen las Rocas de las Sirenas con sus islotes, y
//     se pueden recolectar las pozas de marea;
//   - marea alta: el agua cubre los bancos y las pozas quedan bajo el agua.
const PERIODO_MS = 12 * 60 * 1000; // una vuelta completa: 6 minutos de baja y 6 de alta
// margen por si el reloj del jugador va un poco corrido: unos segundos después de subir, todavía vale
const GRACIA_MS = 20 * 1000;

const fase = (now = Date.now()) => now % PERIODO_MS;
const esBaja = (now = Date.now()) => fase(now) < PERIODO_MS / 2;

// ¿se puede recolectar algo que solo aparece con la marea baja?
const bajaConGracia = (now = Date.now()) => esBaja(now) || esBaja(now - GRACIA_MS);

// para el front: cómo está la marea y cuánto falta para que cambie
function estado(now = Date.now()) {
  const f = fase(now);
  const baja = f < PERIODO_MS / 2;
  return { baja, cambiaEnMs: (baja ? PERIODO_MS / 2 : PERIODO_MS) - f, periodoMs: PERIODO_MS };
}

// recursos que solo se pueden recolectar con la marea baja
const SOLO_BAJA = new Set(['poza_marea']);

module.exports = { PERIODO_MS, esBaja, bajaConGracia, estado, SOLO_BAJA };
