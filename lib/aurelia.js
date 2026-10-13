// Aurelia, la capital: bendición del Pilar de Aethra (ofrenda diaria que da más experiencia en
// combate), libro de visitas de la posada, diligencia entre la capital y la Aldea Espiga y las
// noticias que pregona el pregonero de la plaza (subidas de nivel recientes, festival).
const db = require('../db/db');

const OFRENDA_COST = 50;
const VIAJE_COST = 20;
// Festival de Aethra: los domingos la bendición es doble y dura el doble
const isFestival = (d = new Date()) => d.getDay() === 0;
const blessingFor = (festival) => (festival ? { bonus: 0.1, minutes: 60 } : { bonus: 0.05, minutes: 30 });

// destinos de la diligencia: zona y posición (px) donde te deja
const DESTINOS = {
  aldea: { zona: 'pradera', x: 88 * 32 + 16, y: 56 * 32 + 16, nombre: 'Aldea Espiga' },
  aurelia: { zona: 'aurelia', x: 62 * 32 + 16, y: 82 * 32 + 16, nombre: 'Aurelia' },
};

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_blessings (
      player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      bonus       NUMERIC(5,3) NOT NULL DEFAULT 0,
      expires_at  TIMESTAMPTZ NOT NULL,
      offered_day DATE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS world_guestbook (
      id         SERIAL PRIMARY KEY,
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      text       VARCHAR(160) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );`).catch((err) => { ready = null; throw err; });
  return ready;
}

// multiplicador de experiencia por la bendición activa (1 si no hay)
async function xpBlessingMult(playerId) {
  try {
    await ensureTables();
    const r = await db.query('SELECT bonus FROM player_blessings WHERE player_id = $1 AND expires_at > now()', [playerId]);
    return r.rows.length ? 1 + Number(r.rows[0].bonus) : 1;
  } catch {
    return 1;
  }
}

// ---- noticias del pregonero (en memoria: se pierden al reiniciar, no importa)
const news = [];
function addNews(text) {
  news.unshift({ text, at: Date.now() });
  news.length = Math.min(news.length, 12);
}
async function announceLevelUp(playerId, level) {
  if (level < 2) return;
  try {
    const r = await db.query('SELECT nickname FROM players WHERE id = $1', [playerId]);
    if (r.rows[0]) addNews(`¡Oíd, oíd! ¡${r.rows[0].nickname} ha alcanzado el nivel ${level}!`);
  } catch { /* sin noticia */ }
}
function currentNews() {
  const out = news.filter((n) => Date.now() - n.at < 6 * 3600 * 1000).map((n) => n.text);
  if (isFestival()) out.unshift('¡Oíd, oíd! ¡Hoy es el Festival de Aethra! ¡Las ofrendas al Pilar bendicen el doble!');
  return out;
}

module.exports = { OFRENDA_COST, VIAJE_COST, DESTINOS, isFestival, blessingFor, ensureTables, xpBlessingMult, announceLevelUp, currentNews, addNews };
