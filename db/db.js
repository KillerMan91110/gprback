const { Pool } = require('pg');

// Preferimos DATABASE_URL cuando está seteada (así conecta local sin tener que definir las PG*
// sueltas a mano — Supabase siempre requiere SSL, venga de local o de Render). Si no está, cae a
// las PG* sueltas (como está configurado hoy en Render) para no romper producción.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'gpr',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || '1234',
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = {
  query,
  pool,
};
