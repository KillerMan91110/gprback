// scripts/spawnWorldBoss.js
// Lanza manualmente un evento de World Boss (docs/backend-spec-world-boss.md sección 8). Sin
// panel de admin todavía, así que por ahora es un script que corrés vos cuando quieras arrancar
// el evento: node scripts/spawnWorldBoss.js
//
// Usa --force para lanzar uno nuevo aunque ya haya un evento ACTIVE (lo normal es dejar que
// termine solo, esto es solo para pruebas).

require('dotenv').config();

const url = new URL(process.env.DATABASE_URL);
process.env.PGHOST = url.hostname;
process.env.PGPORT = url.port;
process.env.PGUSER = decodeURIComponent(url.username);
process.env.PGPASSWORD = decodeURIComponent(url.password);
process.env.PGDATABASE = url.pathname.slice(1);
process.env.NODE_ENV = 'production';

const db = require('../db/db');

const WORLD_BOSS_MONSTER_CODE = 'WORLD_BOSS_DEVORADOR_ESTRELLAS';
const WORLD_BOSS_MAX_HP = 40000;
const EVENT_DURATION_HOURS = 3;

async function main() {
  const force = process.argv.includes('--force');

  const activeRes = await db.query("SELECT id, ends_at FROM world_boss_events WHERE status = 'ACTIVE'");
  if (activeRes.rows.length && !force) {
    console.error(`Ya hay un evento ACTIVE (id=${activeRes.rows[0].id}, termina ${activeRes.rows[0].ends_at}). Usá --force si igual querés lanzar otro.`);
    process.exit(1);
  }

  const monsterRes = await db.query('SELECT code FROM monsters WHERE code = $1', [WORLD_BOSS_MONSTER_CODE]);
  if (!monsterRes.rows.length) {
    console.error(`No existe el monstruo ${WORLD_BOSS_MONSTER_CODE} en la tabla monsters — corré la migración de seed.sql primero.`);
    process.exit(1);
  }

  const insertRes = await db.query(
    `INSERT INTO world_boss_events (monster_code, max_hp, hp_remaining, status, ends_at)
     VALUES ($1, $2, $2, 'ACTIVE', now() + interval '${EVENT_DURATION_HOURS} hours')
     RETURNING *`,
    [WORLD_BOSS_MONSTER_CODE, WORLD_BOSS_MAX_HP]
  );
  const event = insertRes.rows[0];
  console.log(`Evento de World Boss lanzado: id=${event.id}, HP=${event.max_hp}, termina ${event.ends_at}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('SPAWN_FAILED', e);
  process.exit(1);
});
