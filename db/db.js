const { Pool } = require('pg');

// Preferimos DATABASE_URL cuando está seteada (así conecta local sin tener que definir las PG*
// sueltas a mano — Supabase siempre requiere SSL, venga de local o de Render). Si no está, cae a
// las PG* sueltas (como está configurado hoy en Render) para no romper producción.
// El pooler de Supabase tiene un tope duro de 15 conexiones simultáneas para TODO el proyecto
// (todos los clientes juntos, no por proceso) -- y de esas 15, confirmado con pg_stat_activity que
// Supabase ya usa 5 fijas para sí mismo (pg_net, pg_cron, PostgREST, un admin idle, el exporter de
// métricas), así que en la práctica el margen real es de 10, no 15. Sin `max` acá, `pg` usa su
// default de 10 -- el servidor SOLO ya se comía el margen entero. Primer ajuste a 8 no alcanzó
// (Luminus, la última leyenda en arrancar en startLegendSchedule, seguía perdiendo la carrera por
// una conexión libre tras el redeploy); bajado a 6 para dejar colchón real para lo demás (scripts
// de prueba, psql, etc.).
const POOL_MAX = Number(process.env.PG_POOL_MAX) || 6;

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: POOL_MAX,
    })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'gpr',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '1234',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: POOL_MAX,
    });

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  query,
  pool,
};
