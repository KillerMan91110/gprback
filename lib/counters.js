const db = require('../db/db');

async function incrementCounter(playerId, code, amount = 1) {
  if (!amount) return;
  await db.query(
    `INSERT INTO player_counters(player_id, counter_code, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (player_id, counter_code)
     DO UPDATE SET value = player_counters.value + $3, updated_at = now()`,
    [playerId, code, amount]
  );
}

async function getCounter(playerId, code) {
  const res = await db.query(
    'SELECT value FROM player_counters WHERE player_id = $1 AND counter_code = $2',
    [playerId, code]
  );
  return res.rows[0]?.value ?? 0;
}

// KILLS_DIVINO/KILLS_NATURALEZA no se incrementan como códigos propios: se resuelven contra
// el contador elemental real al chequear el requisito (no se crearon elementos nuevos).
const COUNTER_ALIASES = {
  KILLS_DIVINO: 'KILLS_LIGHT',
  KILLS_NATURALEZA: 'KILLS_EARTH',
};

// Elementos "clásicos" para Maestro Elemental / Pícaro Elemental. COSMIC no cuenta para
// "dominar los 8 elementos" — es un 9no elemento aparte.
const MASTERY_ELEMENTS = ['FIRE', 'ICE', 'LIGHTNING', 'WATER', 'EARTH', 'WIND', 'LIGHT', 'DARK'];
const MASTERY_THRESHOLD = 50;

async function countMasteredElements(playerId) {
  let count = 0;
  for (const el of MASTERY_ELEMENTS) {
    const v = await getCounter(playerId, `KILLS_${el}`);
    if (v >= MASTERY_THRESHOLD) count++;
  }
  return count;
}

// Para contadores de "variedad" (ej. VENENOS_DOMINADOS: cuántos códigos de veneno DISTINTOS
// impactaron con éxito al menos una vez, no cuántas veces en total). Idempotente: aplicar el
// mismo veneno repetidas veces no infla el conteo.
async function markCounterCodeSeen(playerId, counterCode, subCode) {
  await db.query(
    `INSERT INTO player_counter_seen_codes(player_id, counter_code, sub_code)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [playerId, counterCode, subCode]
  );
}

async function countSeenCodes(playerId, counterCode) {
  const res = await db.query(
    'SELECT COUNT(*)::int AS n FROM player_counter_seen_codes WHERE player_id = $1 AND counter_code = $2',
    [playerId, counterCode]
  );
  return res.rows[0].n;
}

module.exports = {
  incrementCounter,
  getCounter,
  COUNTER_ALIASES,
  MASTERY_ELEMENTS,
  MASTERY_THRESHOLD,
  countMasteredElements,
  markCounterCodeSeen,
  countSeenCodes,
};
