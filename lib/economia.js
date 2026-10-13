// Economía: cuánto oro entra y sale del juego cada día.
// Un trigger en players anota cada cambio de oro (solo la diferencia) en economy_gold_log. Lo que
// pasa de un jugador a otro (comercio, mercado, puestos, correo) suma lo mismo en entradas y
// salidas, así que el NETO del día es el oro que el juego creó (combates, misiones, ventas a NPC…)
// menos el que destruyó (tiendas, franqueo, comisiones…). Si el neto crece y crece, hay inflación.
// Se guarda fila por cambio (sin filas "calientes" que bloqueen) y se borra lo de más de 90 días.
// Las cuentas del sistema (las Leyendas y el Mercader del Reino, correo *.internal) se anotan
// aparte: no son jugadores y su oro no circula como el de los demás.
const db = require('../db/db');

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS economy_gold_log (
      id    BIGSERIAL PRIMARY KEY,
      at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      delta BIGINT NOT NULL
    );
    ALTER TABLE economy_gold_log ADD COLUMN IF NOT EXISTS sistema BOOLEAN NOT NULL DEFAULT FALSE;
    CREATE INDEX IF NOT EXISTS idx_economy_gold_log_at ON economy_gold_log(at);
    CREATE OR REPLACE FUNCTION economy_track_gold() RETURNS trigger AS $$
    BEGIN
      IF NEW.gold IS DISTINCT FROM OLD.gold THEN
        INSERT INTO economy_gold_log (delta, sistema) VALUES (NEW.gold - OLD.gold, COALESCE(NEW.email LIKE '%.internal', FALSE));
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS trg_economy_gold ON players;
    CREATE TRIGGER trg_economy_gold AFTER UPDATE OF gold ON players
      FOR EACH ROW EXECUTE FUNCTION economy_track_gold();
  `).catch((err) => { ready = null; throw err; });
  return ready;
}

async function prune() {
  await db.query("DELETE FROM economy_gold_log WHERE at < now() - INTERVAL '90 days'");
}

function startEconomia() {
  ensureTables().catch((err) => console.error('[economía]', err.message));
  setInterval(() => prune().catch(() => {}), 6 * 60 * 60 * 1000);
}

// Resumen para el panel de administración
async function report(days = 14) {
  await ensureTables();
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
  const REAL = "email NOT LIKE '%.internal'";
  const [totals, system, perDay, top, market, trades, stalls, mail] = await Promise.all([
    q(`SELECT COUNT(*)::int AS players, COALESCE(SUM(gold), 0)::bigint AS gold,
              COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY gold), 0)::bigint AS median
       FROM players WHERE ${REAL}`),
    q(`SELECT nickname, gold::bigint AS gold FROM players WHERE NOT (${REAL}) ORDER BY gold DESC`),
    q(`SELECT to_char(date_trunc('day', at), 'YYYY-MM-DD') AS day,
              SUM(GREATEST(delta, 0))::bigint AS gold_in, SUM(GREATEST(-delta, 0))::bigint AS gold_out,
              SUM(delta)::bigint AS net, COUNT(*)::int AS changes
       FROM economy_gold_log WHERE at >= now() - make_interval(days => $1) AND NOT sistema
       GROUP BY 1 ORDER BY 1 DESC`, [days]),
    q(`SELECT id, nickname, level, gold::bigint AS gold FROM players WHERE ${REAL} ORDER BY gold DESC LIMIT 10`),
    q(`SELECT COUNT(*)::int AS sales, COALESCE(SUM(quantity * price_per_unit), 0)::bigint AS volume
       FROM player_market_listings WHERE status = 'SOLD' AND currency = 'GOLD' AND sold_at >= now() - INTERVAL '7 days'`).catch(() => [{}]),
    q("SELECT COUNT(*)::int AS trades FROM player_trades WHERE created_at >= now() - INTERVAL '7 days'").catch(() => [{ trades: 0 }]),
    q(`SELECT COUNT(*) FILTER (WHERE closed_at IS NULL)::int AS open, COALESCE(SUM(earned), 0)::bigint AS earned
       FROM player_stalls WHERE opened_at >= now() - INTERVAL '7 days'`).catch(() => [{ open: 0, earned: 0 }]),
    q(`SELECT COUNT(*)::int AS letters, COALESCE(SUM(gold_amount), 0)::bigint AS gold
       FROM player_messages WHERE created_at >= now() - INTERVAL '7 days'`).catch(() => [{ letters: 0, gold: 0 }]),
  ]);
  return { totals: totals[0], system, perDay, top, week: { market: market[0], trades: trades[0], stalls: stalls[0], mail: mail[0] } };
}

module.exports = { ensureTables, startEconomia, report };
