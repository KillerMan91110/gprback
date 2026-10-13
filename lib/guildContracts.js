// Encargos semanales del gremio: cada semana (de lunes a domingo, hora UTC) un gremio recibe tres
// encargos sacados de una lista (cazar, raros, jefes, recolectar, donar). Los miembros los van
// cumpliendo jugando normal: ganando combates (lib/huntRewards.js), recolectando recursos en el
// mundo (routes/world.js) y donando al banco (routes/guilds.js). Cada encargo cumplido da
// experiencia al gremio, y completar los tres da un premio extra.
//
// La meta crece con la cantidad de miembros, para que un gremio grande no lo tenga regalado.
const db = require('../db/db');
const { applyGuildXp, logGuildActivity } = require('./guilds');

const XP_POR_ENCARGO = 300;
const XP_BONO_COMPLETO = 500;
const ENCARGOS_POR_SEMANA = 3;

// meta base (para un gremio de un miembro) y texto; minLevel: nivel de gremio necesario
const TIPOS = {
  cazar: { base: 40, titulo: 'Limpiar los caminos', texto: (n) => `Derrotar ${n} monstruos en combate` },
  raros: { base: 10, titulo: 'Presas difíciles', texto: (n) => `Derrotar ${n} monstruos raros` },
  jefes: { base: 2, titulo: 'Cazadores de jefes', texto: (n) => `Abatir ${n} jefes o minijefes` },
  recolectar: { base: 20, titulo: 'Provisiones para el gremio', texto: (n) => `Recolectar ${n} recursos en el mundo` },
  donar: { base: 1500, titulo: 'Arcas llenas', texto: (n) => `Donar ${n.toLocaleString('es')} de oro al banco`, minLevel: 2 },
};
const BONO = '_bono'; // fila interna que marca que ya se pagó el premio de los tres

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS guild_contracts (
      guild_id  INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      week      TEXT    NOT NULL,
      code      TEXT    NOT NULL,
      target    INTEGER NOT NULL,
      progress  INTEGER NOT NULL DEFAULT 0,
      done_at   TIMESTAMPTZ,
      PRIMARY KEY (guild_id, week, code)
    );
    -- el registro de actividad del gremio acepta los encargos cumplidos
    ALTER TABLE guild_activity_log DROP CONSTRAINT IF EXISTS guild_activity_log_type_check;
    ALTER TABLE guild_activity_log ADD CONSTRAINT guild_activity_log_type_check CHECK (type IN
      ('JOIN','LEAVE','KICK','PROMOTE','DEMOTE','TRANSFER','LEVEL_UP','EDIT','DONATION','SHOP_PURCHASE','CONTRACT','CONTRACT_ALL'));`).catch((err) => { ready = null; throw err; });
  return ready;
}

// semana ISO en UTC ("2026-W42") y cuándo termina (lunes siguiente 00:00 UTC)
function weekOf(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
function weekEndsAt(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 8 - day);
  return t;
}

// número pseudoaleatorio estable a partir de un texto (mismo gremio + semana = mismos encargos)
function seeded(str) {
  let h = 2166136261;
  for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

// Crea los encargos de la semana si todavía no existen (la primera vez que alguien los mira o
// suma progreso). Devuelve el gremio con su semana.
async function ensureWeek(guildId) {
  await ensureTables();
  const week = weekOf();
  const have = await db.query('SELECT 1 FROM guild_contracts WHERE guild_id = $1 AND week = $2 LIMIT 1', [guildId, week]);
  if (have.rows.length) return week;
  const g = await db.query(
    `SELECT g.level, COUNT(gm.player_id)::int AS members FROM guilds g
     LEFT JOIN guild_members gm ON gm.guild_id = g.id WHERE g.id = $1 GROUP BY g.id`,
    [guildId]
  );
  if (!g.rows.length) return week;
  const { level, members } = g.rows[0];
  const rand = seeded(`${guildId}:${week}`);
  const pool = Object.keys(TIPOS).filter((c) => (TIPOS[c].minLevel ?? 1) <= level);
  const chosen = [];
  while (chosen.length < Math.min(ENCARGOS_POR_SEMANA, pool.length)) {
    const c = pool[Math.floor(rand() * pool.length)];
    if (!chosen.includes(c)) chosen.push(c);
  }
  // un miembro: la meta base; cada miembro más suma un 40% (hasta 10 miembros)
  const scale = 0.6 + 0.4 * Math.min(Math.max(members, 1), 10);
  for (const code of chosen) {
    const target = Math.max(1, Math.round(TIPOS[code].base * scale));
    await db.query(
      `INSERT INTO guild_contracts (guild_id, week, code, target) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [guildId, week, code, target]
    );
  }
  return week;
}

// Suma progreso a un encargo de la semana (si el gremio lo tiene). Paga la experiencia al
// cumplirlo y el premio extra si con eso completa los tres. Nunca rompe la acción que lo llamó.
async function addProgress(guildId, code, amount, actorId = null) {
  if (!guildId || !amount || amount <= 0 || !TIPOS[code]) return;
  try {
    const week = await ensureWeek(guildId);
    const upd = await db.query(
      `UPDATE guild_contracts SET progress = LEAST(target, progress + $4)
       WHERE guild_id = $1 AND week = $2 AND code = $3 AND done_at IS NULL
       RETURNING progress, target`,
      [guildId, week, code, Math.floor(amount)]
    );
    if (!upd.rows.length || upd.rows[0].progress < upd.rows[0].target) return;
    // reclamo atómico: solo una llamada marca el encargo como cumplido y paga
    const done = await db.query(
      `UPDATE guild_contracts SET done_at = now()
       WHERE guild_id = $1 AND week = $2 AND code = $3 AND done_at IS NULL AND progress >= target
       RETURNING code`,
      [guildId, week, code]
    );
    if (!done.rows.length) return;
    await applyGuildXp(guildId, XP_POR_ENCARGO);
    await logGuildActivity(guildId, 'CONTRACT', actorId, null, { code, titulo: TIPOS[code].titulo, xp: XP_POR_ENCARGO });

    const pending = await db.query(
      `SELECT count(*)::int AS n FROM guild_contracts WHERE guild_id = $1 AND week = $2 AND code <> $3 AND done_at IS NULL`,
      [guildId, week, BONO]
    );
    if (pending.rows[0].n > 0) return;
    const bono = await db.query(
      `INSERT INTO guild_contracts (guild_id, week, code, target, progress, done_at) VALUES ($1, $2, $3, 1, 1, now())
       ON CONFLICT DO NOTHING RETURNING code`,
      [guildId, week, BONO]
    );
    if (!bono.rows.length) return;
    await applyGuildXp(guildId, XP_BONO_COMPLETO);
    await logGuildActivity(guildId, 'CONTRACT_ALL', actorId, null, { xp: XP_BONO_COMPLETO });
  } catch (err) {
    console.error('[encargos de gremio]', err.message);
  }
}

// mismo, pero a partir de un jugador (busca su gremio)
async function addProgressFor(playerId, code, amount) {
  try {
    const r = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [playerId]);
    if (r.rows.length) await addProgress(r.rows[0].guild_id, code, amount, playerId);
  } catch (err) {
    console.error('[encargos de gremio]', err.message);
  }
}

// Un combate ganado: cuenta los monstruos para cada gremio que participó (una vez por gremio,
// aunque vayan varios miembros juntos).
async function onCombatWon(playerIds, enemies) {
  try {
    const codes = enemies.map((e) => e.monster_code).filter(Boolean);
    if (!codes.length || !playerIds.length) return;
    const [mons, guilds] = await Promise.all([
      db.query('SELECT code, rarity FROM monsters WHERE code = ANY($1::text[])', [codes]),
      db.query('SELECT DISTINCT ON (guild_id) guild_id, player_id FROM guild_members WHERE player_id = ANY($1::int[])', [playerIds]),
    ]);
    if (!guilds.rows.length) return;
    const rarity = new Map(mons.rows.map((m) => [m.code, m.rarity]));
    const raros = codes.filter((c) => rarity.get(c) === 'RARE').length;
    const jefes = codes.filter((c) => ['MINIBOSS', 'LEGENDARY'].includes(rarity.get(c))).length;
    for (const { guild_id: gid, player_id: pid } of guilds.rows) {
      await addProgress(gid, 'cazar', codes.length, pid);
      if (raros) await addProgress(gid, 'raros', raros, pid);
      if (jefes) await addProgress(gid, 'jefes', jefes, pid);
    }
  } catch (err) {
    console.error('[encargos de gremio]', err.message);
  }
}

// lo que ve el panel del gremio
async function listFor(guildId) {
  const week = await ensureWeek(guildId);
  const r = await db.query(
    'SELECT code, target, progress, done_at FROM guild_contracts WHERE guild_id = $1 AND week = $2 ORDER BY code',
    [guildId, week]
  );
  const rows = r.rows.filter((x) => x.code !== BONO && TIPOS[x.code]);
  return {
    week,
    endsAt: weekEndsAt().toISOString(),
    xpPorEncargo: XP_POR_ENCARGO,
    xpBono: XP_BONO_COMPLETO,
    bonoCobrado: r.rows.some((x) => x.code === BONO),
    encargos: rows.map((x) => ({
      code: x.code,
      titulo: TIPOS[x.code].titulo,
      texto: TIPOS[x.code].texto(x.target),
      target: x.target,
      progress: x.progress,
      done: !!x.done_at,
    })),
  };
}

module.exports = { ensureTables, weekOf, addProgress, addProgressFor, onCombatWon, listFor };
