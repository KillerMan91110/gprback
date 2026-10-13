// Calendario de eventos del mundo 2D (hora del servidor):
//   - Festival de Aethra: los domingos todo el día (ofrenda doble, ver lib/aurelia.js)
//   - Noche de caza: todos los días de 20:00 a 22:00, +25% de experiencia en combate
//   - Mercader ambulante: miércoles y sábados de 18:00 a 21:00, en la plaza de Aurelia, con
//     ofertas que cambian cada día (cosas poco comunes y un sobre de cartas)
const db = require('../db/db');
const { withTransaction, spendCurrency } = require('./currency');
const inventory = require('./inventory');
const coleccion = require('./coleccion');
const aurelia = require('./aurelia');
const { cercaDe } = require('./cercania');

const HUNT_XP = 0.25;
const EVENTS = [
  { id: 'festival', name: 'Festival de Aethra', icon: 'sun', desc: 'Las ofrendas al Pilar bendicen el doble y duran el doble.', days: [0], from: 0, to: 24 },
  { id: 'noche_caza', name: 'Noche de caza', icon: 'wolf-howl', desc: '+25% de experiencia en todos los combates.', days: [0, 1, 2, 3, 4, 5, 6], from: 20, to: 22 },
  { id: 'mercader', name: 'Mercader ambulante', icon: 'shop', desc: 'Un mercader de paso vende rarezas junto al Pilar de Aethra.', days: [3, 6], from: 18, to: 21 },
];
// solo para probar en local: EVENTOS_FORZAR=noche_caza,mercader los deja siempre activos
const forced = () => new Set(String(process.env.EVENTOS_FORZAR || '').split(',').map((s) => s.trim()).filter(Boolean));

function isActive(ev, d = new Date()) {
  if (forced().has(ev.id)) return true;
  if (ev.id === 'festival') return aurelia.isFestival(d);
  const h = d.getHours() + d.getMinutes() / 60;
  return ev.days.includes(d.getDay()) && h >= ev.from && h < ev.to;
}
const at = (d, hour) => { const x = new Date(d); x.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0); return x; };

// eventos activos y los próximos 7 días
function calendar(now = new Date()) {
  const active = EVENTS.filter((ev) => isActive(ev, now)).map((ev) => ({
    id: ev.id, name: ev.name, icon: ev.icon, desc: ev.desc,
    endsAt: forced().has(ev.id) ? null : at(now, ev.to === 24 ? 23.99 : ev.to),
  }));
  const upcoming = [];
  for (let k = 0; k < 7; k++) {
    const day = new Date(now);
    day.setDate(now.getDate() + k);
    for (const ev of EVENTS) {
      if (!ev.days.includes(day.getDay())) continue;
      const start = at(day, ev.from);
      if (start <= now && k === 0) continue;
      upcoming.push({ id: ev.id, name: ev.name, icon: ev.icon, desc: ev.desc, startsAt: start, endsAt: at(day, ev.to === 24 ? 23.99 : ev.to) });
    }
  }
  upcoming.sort((a, b) => a.startsAt - b.startsAt);
  return { active, upcoming: upcoming.slice(0, 12) };
}

// multiplicador de XP en combate por los eventos activos
const xpMult = () => (isActive(EVENTS[1]) ? 1 + HUNT_XP : 1);

// ---- mercader ambulante
const POOL = [
  { code: 'POCION_DE_VIDA_MAYOR', price: 380 }, { code: 'POCION_DE_MANA_MAYOR', price: 380 },
  { code: 'ELIXIR_DE_REGENERACION', price: 950 }, { code: 'ESENCIA_RESTAURADORA', price: 720 },
  { code: 'CRISTAL_VIAJE', price: 1200 }, { code: 'CRISTAL_ESTABILIDAD', price: 2100 },
  { code: 'ASADO_SALAMANDRA', price: 260 }, { code: 'GUISO_TROLL', price: 260 }, { code: 'SOPA_CANGREJO', price: 480 },
];
const CARD_PACK = { id: 'sobre', name: 'Sobre de cartas de la Pradera', desc: 'Una carta al azar de un monstruo de la Pradera (común o rara).', price: 650 };
const PER_PLAYER = 2;

const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function seeded(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_wanderer_buys (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      day       TEXT NOT NULL,
      offer     TEXT NOT NULL,
      qty       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, day, offer)
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

// las ofertas de hoy (las mismas para todos): 3 cosas del catálogo + el sobre de cartas
async function offers(playerId) {
  await ensureTables();
  const rnd = seeded(dayKey());
  const pick = [...POOL].sort(() => rnd() - 0.5).slice(0, 3);
  const items = await db.query('SELECT id, code, name, rarity, description FROM items WHERE code = ANY($1::text[])', [pick.map((p) => p.code)]);
  const byCode = new Map(items.rows.map((i) => [i.code, i]));
  const bought = playerId
    ? new Map((await db.query('SELECT offer, qty FROM player_wanderer_buys WHERE player_id = $1 AND day = $2', [playerId, dayKey()])).rows.map((r) => [r.offer, r.qty]))
    : new Map();
  const list = pick.filter((p) => byCode.has(p.code)).map((p) => {
    const it = byCode.get(p.code);
    return { id: p.code, itemId: it.id, name: it.name, rarity: it.rarity, desc: it.description, price: p.price, left: PER_PLAYER - (bought.get(p.code) ?? 0) };
  });
  list.push({ ...CARD_PACK, card: true, left: PER_PLAYER - (bought.get(CARD_PACK.id) ?? 0) });
  return { active: isActive(EVENTS[2]), offers: list };
}

async function buy(playerId, offerId) {
  if (!isActive(EVENTS[2])) return { error: 'El mercader ambulante ya siguió su camino' };
  // Varo se pone a un costado del Pilar de Aethra (casilla 60,45 de Aurelia)
  if (!cercaDe(playerId, 'aurelia', 63, 47, 7)) return { error: 'Varo está junto al Pilar de Aethra: acércate para comprarle' };
  const { offers: list } = await offers(playerId);
  const o = list.find((x) => x.id === offerId);
  if (!o) return { error: 'Esa oferta no está hoy' };
  if (o.left <= 0) return { error: `Ya compraste ${PER_PLAYER} de esto hoy` };
  const res = await withTransaction(async (client) => {
    // el límite se cuenta acá, con la fila bloqueada (dos compras a la vez no se pasan del máximo)
    const count = await client.query(
      `INSERT INTO player_wanderer_buys (player_id, day, offer, qty) VALUES ($1, $2, $3, 1)
       ON CONFLICT (player_id, day, offer) DO UPDATE SET qty = player_wanderer_buys.qty + 1
         WHERE player_wanderer_buys.qty < $4
       RETURNING qty`,
      [playerId, dayKey(), o.id, PER_PLAYER]
    );
    if (!count.rows.length) return { error: `Ya compraste ${PER_PLAYER} de esto hoy`, abort: true };
    const gold = await spendCurrency(playerId, 'gold', o.price, client);
    if (gold === null) return { error: `Te faltan monedas: cuesta ${o.price} de oro`, abort: true };
    let got = o.name;
    if (o.card) {
      const m = await client.query(
        `SELECT id, code, name, rarity, category FROM monsters WHERE zone_id = 1 AND rarity IN ('COMMON', 'RARE')
         ORDER BY (CASE WHEN rarity = 'RARE' THEN random() * 3 ELSE random() END) LIMIT 1`
      );
      await coleccion.giveCard(playerId, m.rows[0].id, 1, client);
      got = `Carta de ${m.rows[0].name}`;
    } else {
      await inventory.addItem(playerId, o.itemId, 1, 0, 0, client);
    }
    return { ok: true, got, gold };
  });
  if (res.error) return { error: res.error };
  return res;
}

module.exports = { EVENTS, calendar, xpMult, offers, buy, ensureTables, isActive };
