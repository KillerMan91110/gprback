// Los eclipses de las Ruinas Ancestrales: la mirada del Devorador. Cada 9 minutos el cielo de las Ruinas se
// oscurece durante un minuto, con el reloj del servidor (así todos lo ven igual; el front hace la misma
// cuenta en gpr/src/game/world/eclipse.js, con la diferencia de reloj que toma de GET /world/marea):
//   - medio minuto antes hay aviso («El sol tiembla…»);
//   - durante el eclipse, los monstruos de las Ruinas salen corrompidos: +20% de fuerza (ataque y magia),
//     +25% de experiencia y oro, y +25% de botín;
//   - junto a una fuente de lágrimas (los refugios) el eclipse no te alcanza: ahí no hay combates (eso lo
//     cuida el front, que es el que tira los encuentros de la hierba).
// No quita vida. Ver gprback/docs/zona7_ruinas.md, sección 4.
const { positionOf } = require('./worldPresence');

const PERIODO_MS = 9 * 60 * 1000;
const DURA_MS = 60 * 1000;
// margen por si el reloj del jugador va un poco corrido: unos segundos después de terminar, todavía vale
const GRACIA_MS = 15 * 1000;
const ZONA_DIR = 'ruinas';
const ZONA_ID = 7;
const FUERZA = 1.2;
const PREMIO = 1.25;
// el botín extra, en puntos de «probabilidad de botín» (como la suerte)
const BOTIN_PCT = 25;
// así quedan marcados en el combate los monstruos corrompidos (el nombre lo muestra)
const MARCA = ' · del Eclipse';

const fase = (now = Date.now()) => now % PERIODO_MS;
// el eclipse es el último minuto de cada vuelta
// (ECLIPSE=siempre lo deja puesto todo el tiempo: para probar el servidor sin esperar 9 minutos)
const activo = (now = Date.now()) => process.env.ECLIPSE === 'siempre' || fase(now) >= PERIODO_MS - DURA_MS;
const activoConGracia = (now = Date.now()) => activo(now) || activo(now - GRACIA_MS);

// para el front: si hay eclipse y cuánto falta para que empiece o termine
function estado(now = Date.now()) {
  const f = fase(now);
  const on = f >= PERIODO_MS - DURA_MS;
  return { activo: on, cambiaEnMs: on ? PERIODO_MS - f : PERIODO_MS - DURA_MS - f, periodoMs: PERIODO_MS, duraMs: DURA_MS };
}

// Corrompe en el lugar a los enemigos (ya hidratados) de un combate que se arma en las Ruinas durante el
// eclipse. Solo los monstruos de la zona 7 (no los de la mazmorra ni los jefes míticos).
async function corromper(db, playerId, enemies, now = Date.now()) {
  if (!activoConGracia(now) || !enemies?.length) return false;
  if (positionOf(playerId)?.zone !== ZONA_DIR) return false;
  const codes = [...new Set(enemies.map((e) => e.monster_code).filter(Boolean))];
  const r = await db.query('SELECT code FROM monsters WHERE code = ANY($1::text[]) AND zone_id = $2', [codes, ZONA_ID]);
  const deZona = new Set(r.rows.map((x) => x.code));
  let alguno = false;
  for (const e of enemies) {
    if (!deZona.has(e.monster_code) || String(e.name ?? '').endsWith(MARCA)) continue;
    e.atk = Math.round(e.atk * FUERZA);
    e.mag = Math.round(e.mag * FUERZA);
    e.xp_reward = Math.round((e.xp_reward ?? 0) * PREMIO);
    e.gold_reward = Math.round((e.gold_reward ?? 0) * PREMIO);
    e.name = `${e.name}${MARCA}`;
    alguno = true;
  }
  return alguno;
}

// puntos de botín extra de un combate (si algún enemigo salió corrompido por el eclipse)
const botinExtra = (enemies) => ((enemies ?? []).some((e) => String(e.name ?? '').endsWith(MARCA)) ? BOTIN_PCT : 0);

module.exports = { PERIODO_MS, DURA_MS, activo, activoConGracia, estado, corromper, botinExtra, MARCA };
