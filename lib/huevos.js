// Huevos y sobres de cartas de cada zona.
//   - Huevos: cada zona tiene el suyo, en las cinco rarezas (HUEVO_TUNDRA_RARO…). Los sueltan los monstruos
//     de esa zona, y al incubarlo nace una mascota de esa rareza de las de esa zona (pets.zone_id; si la
//     zona no tiene ninguna de esa rareza, una cualquiera). Los huevos de siempre (HUEVO_RARO…) siguen igual.
//   - Sobres: SOBRE_<ZONA>. Los vende el mercader de la zona (los de la Pradera y las Montañas, el joyero de
//     Aurelia) y a veces salen en el cofre de la mazmorra de la zona. Al abrirlo dan tres cartas de monstruos
//     de la zona; las raras salen menos (SOBRE_PESOS).
// Los nombres de los objetos los arma este archivo (y los usa el front para los íconos: src/game/gear.js).
const db = require('../db/db');
const col = require('./coleccion');

const ZONAS = [
  { code: 'PRADERA', id: 1, de: 'de la Pradera' },
  { code: 'MONTANA', id: 2, de: 'de las Montañas' },
  { code: 'VOLCAN', id: 3, de: 'del Volcán' },
  { code: 'COSTAS', id: 4, de: 'de las Costas' },
  { code: 'TUNDRA', id: 5, de: 'de la Tundra' },
  { code: 'CATACUMBAS', id: 6, de: 'de las Catacumbas' },
  { code: 'RUINAS', id: 7, de: 'de las Ruinas' },
];
const RAREZAS = [
  { code: 'COMUN', name: 'Común', adj: 'común' },
  { code: 'POCO_COMUN', name: 'Poco Común', adj: 'poco común' },
  { code: 'RARO', name: 'Raro', adj: 'rara' },
  { code: 'EPICO', name: 'Épico', adj: 'épica' },
  { code: 'LEGENDARIO', name: 'Legendario', adj: 'legendaria' },
];
const zonaPorId = (id) => ZONAS.find((z) => z.id === Number(id)) ?? null;

// HUEVO_RARO → { rarity: 'RARO', zoneId: null }; HUEVO_TUNDRA_RARO → { rarity: 'RARO', zoneId: 5 }; si no es huevo, null
function huevo(code) {
  const c = String(code ?? '');
  if (!c.startsWith('HUEVO_')) return null;
  const rest = c.slice('HUEVO_'.length);
  const generic = RAREZAS.find((r) => r.code === rest);
  if (generic) return { rarity: generic.code, zoneId: null };
  const z = ZONAS.find((x) => rest.startsWith(`${x.code}_`));
  const r = z && RAREZAS.find((x) => x.code === rest.slice(z.code.length + 1));
  return r ? { rarity: r.code, zoneId: z.id } : null;
}
const huevoCode = (zoneId, rarity) => `HUEVO_${zonaPorId(zoneId).code}_${rarity}`;

// SOBRE_TUNDRA → 5 (o null si no es un sobre)
function sobreZona(code) {
  const c = String(code ?? '');
  return ZONAS.find((z) => c === `SOBRE_${z.code}`)?.id ?? null;
}
const sobreCode = (zoneId) => `SOBRE_${zonaPorId(zoneId).code}`;

// cuántas cartas trae un sobre y qué tan seguido sale cada rareza de monstruo
const CARTAS_POR_SOBRE = 3;
const SOBRE_PESOS = { COMMON: 70, RARE: 22, MINIBOSS: 6, LEGENDARY: 2 };
// probabilidad de que el cofre de la mazmorra traiga, además, el sobre de su zona
const SOBRE_EN_COFRE = 0.2;

// la mascota que nace de un huevo: de su rareza y, si es de una zona, de las de esa zona
async function mascotaDe(code, fallbackRarity) {
  const h = huevo(code) ?? { rarity: fallbackRarity, zoneId: null };
  if (h.zoneId) {
    const r = await db.query('SELECT id FROM pets WHERE rarity = $1 AND zone_id = $2 ORDER BY random() LIMIT 1', [h.rarity, h.zoneId]);
    if (r.rows.length) return r.rows[0].id;
  }
  const r = await db.query('SELECT id FROM pets WHERE rarity = $1 ORDER BY random() LIMIT 1', [h.rarity]);
  return r.rows[0]?.id ?? null;
}

// abre un sobre: tres cartas de monstruos de la zona (sin míticos), sorteadas por rareza
async function abrirSobre(playerId, zoneId, client = db) {
  const mons = (await client.query(
    `SELECT id, code, name, rarity, category FROM monsters
     WHERE zone_id = $1 AND rarity = ANY($2::text[]) AND code NOT LIKE $3`,
    [zoneId, Object.keys(SOBRE_PESOS), `${col.MYTHIC_PREFIX}%`]
  )).rows;
  if (!mons.length) return [];
  const byRarity = {};
  for (const m of mons) (byRarity[m.rarity] ??= []).push(m);
  const pesos = Object.entries(SOBRE_PESOS).filter(([r]) => byRarity[r]);
  const total = pesos.reduce((s, [, w]) => s + w, 0);
  const got = [];
  for (let i = 0; i < CARTAS_POR_SOBRE; i++) {
    let roll = Math.random() * total;
    const [rarity] = pesos.find(([, w]) => (roll -= w) < 0) ?? pesos[0];
    const list = byRarity[rarity];
    const m = list[Math.floor(Math.random() * list.length)];
    await col.giveCard(playerId, m.id, 1, client);
    got.push({ monsterId: m.id, code: m.code, name: m.name, rarity: col.rarityOf(m), ...col.cardOf(m) });
  }
  return got;
}

module.exports = {
  ZONAS, RAREZAS, zonaPorId, huevo, huevoCode, sobreZona, sobreCode, mascotaDe, abrirSobre,
  CARTAS_POR_SOBRE, SOBRE_PESOS, SOBRE_EN_COFRE,
};
