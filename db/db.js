const { Pool } = require('pg');

// Preferimos DATABASE_URL cuando está seteada (así conecta local sin tener que definir las PG*
// sueltas a mano — Supabase siempre requiere SSL, venga de local o de Render). Si no está, cae a
// las PG* sueltas (como está configurado hoy en Render) para no romper producción.
// El pooler de Supabase tiene un tope duro de 15 conexiones simultáneas para TODO el proyecto
// (todos los clientes juntos, no por proceso). Sin `max` acá, `pg` usa su default de 10 -- el
// servidor SOLO ya casi agota el cupo entero, así que cualquier otra cosa conectada al mismo
// tiempo (un script de prueba, psql) tira EMAXCONNSESSION -- confirmado en producción, con las 5
// leyendas tickeando cada 1 min fallaban tick tras tick. 8 deja margen real para el resto.
const POOL_MAX = Number(process.env.PG_POOL_MAX) || 8;

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
