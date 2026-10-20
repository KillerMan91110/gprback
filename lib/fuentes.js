// De dónde sale un objeto: los monstruos que lo sueltan (con su %), los recursos del mapa que lo dan,
// si se fabrica y si lo vende algún artesano. Lo usa el Taller para decirte dónde conseguir el
// material que te falta (routes/players.js, /craft/available).
//
// Para no adelantar el contenido de zonas futuras, los monstruos de zonas que el jugador todavía no
// abrió (player_zone_unlocks) no se nombran: solo se cuenta cuántos hay ("hidden").
const db = require('../db/db');
const { NODE_TYPES, nodesOf } = require('./worldNodes');
const mazmorras = require('./mazmorras');

const MAX_MONSTERS = 4;
// zonas del mapa con recursos (id → nombre que ve el jugador); los recursos viven por id de zona
const ZONE_NAMES = { 0: 'Aurelia', 1: 'Pradera Dorada', 2: 'Montañas Grises', 3: 'Volcán Rojo', 4: 'Costas Muertas', 5: 'Tundra Eterna', 6: 'Catacumbas del Abismo' };

// tipo de recurso → ids de zona donde hay al menos uno
function zonesOfNodeType() {
  const out = {};
  for (const zoneId of Object.keys(ZONE_NAMES)) {
    for (const [type] of Object.values(nodesOf(zoneId))) (out[type] ??= new Set()).add(Number(zoneId));
  }
  return out;
}

// itemIds: ids de ítems. Devuelve Map(itemId → { monsters, hidden, nodes, crafted, shop })
async function sourcesForItems(playerId, itemIds) {
  const ids = [...new Set(itemIds.map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const [items, drops, unlocks, crafted, shop] = await Promise.all([
    db.query('SELECT id, code FROM items WHERE id = ANY($1::int[])', [ids]),
    db.query(
      `SELECT d.item_id, m.code, m.name, m.rarity, m.zone_id, d.drop_chance_percent::float AS pct, d.min_quantity AS min, d.max_quantity AS max,
              z.name AS zone_name
       FROM monster_drops d JOIN monsters m ON m.id = d.monster_id LEFT JOIN monster_zones z ON z.id = m.zone_id
       WHERE d.item_id = ANY($1::int[])
       ORDER BY d.drop_chance_percent DESC, m.base_level`,
      [ids]
    ),
    db.query('SELECT zone_id FROM player_zone_unlocks WHERE player_id = $1', [playerId]),
    db.query(
      `SELECT DISTINCT ON (result_item_id) result_item_id, station, artisan_name FROM crafting_recipes
       WHERE result_item_id = ANY($1::int[]) ORDER BY result_item_id, required_level`,
      [ids]
    ),
    db.query('SELECT item_id, MIN(price)::int AS price FROM artisan_shop WHERE item_id = ANY($1::int[]) GROUP BY item_id', [ids]).catch(() => ({ rows: [] })),
  ]);
  // la Pradera (1) siempre está abierta: es donde se empieza
  const open = new Set([1, ...unlocks.rows.map((r) => r.zone_id)]);
  const codeOf = new Map(items.rows.map((r) => [r.id, r.code]));
  const nodeZones = zonesOfNodeType();
  const craftedBy = new Map(crafted.rows.map((r) => [r.result_item_id, { station: r.station, artisan: r.artisan_name }]));
  const priceOf = new Map(shop.rows.map((r) => [r.item_id, r.price]));

  for (const id of ids) {
    // los monstruos de una mazmorra no tienen zona en la base: cuentan como de la zona de su mazmorra
    // (la Fisura es del Volcán) y se nombran por la mazmorra
    const mine = drops.rows.filter((d) => d.item_id === id).map((d) => {
      const dungeon = d.zone_id == null ? mazmorras.ofMonster(d.code) : null;
      return dungeon ? { ...d, zone_id: dungeon.ZONE_ID, zone_name: dungeon.texts?.name ?? d.zone_name } : d;
    });
    const visible = mine.filter((d) => d.zone_id == null || open.has(d.zone_id));
    const code = codeOf.get(id);
    let hiddenNodes = 0;
    const nodes = Object.entries(NODE_TYPES)
      .map(([type, t]) => {
        const l = [...(t.loot ?? []), t.fallback].find((x) => x?.item === code);
        if (!l) return null;
        const all = [...(nodeZones[type] ?? [])];
        const zones = all.filter((z) => z === 0 || open.has(z));
        if (!zones.length) { if (all.length) hiddenNodes += 1; return null; }
        // fallback: lo que sale si no cae nada más (cuenta como seguro)
        return { type, chance: Math.round((l.chance ?? 1) * 100), zones: zones.map((z) => ZONE_NAMES[z]) };
      })
      .filter(Boolean);
    out.set(id, {
      monsters: visible.slice(0, MAX_MONSTERS).map((d) => ({
        name: d.name, rarity: d.rarity, chance: Math.round(d.pct * 10) / 10, min: d.min, max: d.max,
        zone: d.zone_name ?? 'una mazmorra',
      })),
      // more: otros monstruos de zonas abiertas que no entran en la lista
      more: Math.max(0, visible.length - MAX_MONSTERS),
      // hidden: monstruos y recursos de zonas que todavía no abriste (no se nombran)
      hidden: mine.length - visible.length + hiddenNodes,
      nodes,
      crafted: craftedBy.get(id) ?? null,
      shop: priceOf.has(id) ? { price: priceOf.get(id) } : null,
    });
  }
  return out;
}

module.exports = { sourcesForItems };
