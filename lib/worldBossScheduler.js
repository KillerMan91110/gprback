// lib/worldBossScheduler.js
// Ciclo automático del World Boss (docs/backend-followup-world-boss-cycle-ready.md sección 1):
// 3hs activo -> 1h de pausa -> vuelve a aparecer, para siempre. server.js llama a
// tickWorldBossSchedule() cada 1 minuto; scripts/spawnWorldBoss.js llama a spawnWorldBossEvent()
// directo para forzar uno manual.

const db = require('../db/db');

const WORLD_BOSS_MONSTER_CODE = 'WORLD_BOSS_DEVORADOR_ESTRELLAS';
const WORLD_BOSS_MAX_HP = 40000;
const EVENT_DURATION_HOURS = 3;
const PAUSE_HOURS = 1;

async function spawnWorldBossEvent() {
  const res = await db.query(
    `INSERT INTO world_boss_events (monster_code, max_hp, hp_remaining, ends_at)
     VALUES ($1, $2, $2, now() + interval '${EVENT_DURATION_HOURS} hours')
     RETURNING *`,
    [WORLD_BOSS_MONSTER_CODE, WORLD_BOSS_MAX_HP]
  );
  return res.rows[0];
}

// Se llama periódicamente. Hace 2 cosas: cierra el evento ACTIVE si ya venció (mismo criterio
// que expireIfNeeded en routes/worldboss.js, pero acá SIN esperar a que alguien entre a la
// página — así la pausa de 1h arranca puntual), y si no queda ninguno ACTIVE y ya pasó la pausa
// desde que cerró el último (o nunca hubo uno), spawnea el siguiente.
async function tickWorldBossSchedule() {
  await db.query(
    "UPDATE world_boss_events SET status = 'EXPIRED', closed_at = now() WHERE status = 'ACTIVE' AND ends_at <= now()"
  );

  const activeRes = await db.query("SELECT 1 FROM world_boss_events WHERE status = 'ACTIVE'");
  if (activeRes.rows.length) return;

  const lastRes = await db.query('SELECT closed_at FROM world_boss_events ORDER BY id DESC LIMIT 1');
  const lastClosedAt = lastRes.rows[0]?.closed_at;
  if (lastClosedAt && Date.now() - new Date(lastClosedAt).getTime() < PAUSE_HOURS * 3600 * 1000) return;

  await spawnWorldBossEvent();
}

module.exports = { spawnWorldBossEvent, tickWorldBossSchedule };
