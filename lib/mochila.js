// Marcas de la mochila, para no tener que pasar el ratón por cada casilla:
//   - mejora: una pieza que es una mejora CLARA para ti (es de tu clase, tienes el nivel, no baja ninguna
//     estadística de lo que llevas en ese hueco y sube al menos una; con su calidad y encantamiento).
//   - sobra: lo que no usas, para venderlo de una vez en el mercader («Vender lo que no usas», la lista se
//     revisa antes de confirmar): equipo de otra clase o claramente peor que lo que llevas, y botín que
//     ninguna receta ni misión pide. Nunca lo equipado, lo legendario o único, ni objetos de misión,
//     pergaminos, huevos o sobres, ni lo que marcaste como favorito.
//   - favorito: el candado que pone el jugador (player_inventory.favorito): no se vende, no entra en «lo que no
//     usas» y no se le da de comer a la mascota.
const db = require('../db/db');
const evolution = require('./evolution');

// mismos multiplicadores que lib/equipment.js
const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];
const multOf = (enchant, tier) => (1 + (enchant || 0) * 0.05) * (QUALITY_TIER_MULTIPLIER[tier || 0] ?? 1);
const statKey = (s) => `${s.stat_code}${s.is_percent ? '%' : ''}`;
const PRECIOSO = new Set(['LEGENDARIO', 'UNICO']);

let ready = null;
function ensureTables() {
  ready ??= db.query('ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS favorito BOOLEAN NOT NULL DEFAULT FALSE')
    .catch((err) => { ready = null; throw err; });
  return ready;
}

// pone o quita el candado de una fila de la mochila; devuelve el estado nuevo
async function alternarFavorito(playerId, inventoryId) {
  await ensureTables();
  const r = await db.query(
    'UPDATE player_inventory SET favorito = NOT favorito WHERE id = $1 AND player_id = $2 RETURNING favorito', [inventoryId, playerId]);
  return r.rows[0]?.favorito ?? null;
}

// ¿alguna fila de ese objeto (con ese encantamiento) tiene candado?
async function esFavorito(playerId, itemId, enchantLevel = null, queryable = db) {
  await ensureTables();
  const r = await queryable.query(
    `SELECT 1 FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND favorito AND ($3::int IS NULL OR enchant_level = $3) LIMIT 1`,
    [playerId, itemId, enchantLevel]);
  return r.rows.length > 0;
}

// a frente a b (Map stat → valor): ¿sube algo? ¿baja algo?
function comparar(a, b) {
  let up = false; let down = false;
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const d = (a.get(k) ?? 0) - (b.get(k) ?? 0);
    if (d > 0.01) up = true;
    if (d < -0.01) down = true;
  }
  return { up, down };
}

// rows: las filas del inventario (GET /inventory); les agrega `mejora` y `sobra`
async function marcar(playerId, rows) {
  if (!rows.length) return rows;
  const pl = (await db.query('SELECT level, current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId])).rows[0];
  if (!pl) return rows;
  const chain = await evolution.getClassAncestorChain(pl.evolution_class_id || pl.current_class_id);
  const equipped = (await db.query(
    `SELECT pe.slot, pe.item_id, pe.enchant_level, pe.quality_tier, i.is_two_handed
     FROM player_equipment pe JOIN items i ON i.id = pe.item_id WHERE pe.player_id = $1`, [playerId])).rows;
  const eqIds = new Set(equipped.map((e) => e.item_id));
  const ids = [...new Set([...rows.filter((r) => r.item_type === 'EQUIPMENT').map((r) => r.item_id), ...equipped.map((e) => e.item_id)])];
  const stats = new Map();
  if (ids.length) {
    for (const s of (await db.query('SELECT item_id, stat_code, amount, is_percent FROM item_stat_bonuses WHERE item_id = ANY($1::int[])', [ids])).rows) {
      if (!stats.has(s.item_id)) stats.set(s.item_id, []);
      stats.get(s.item_id).push(s);
    }
  }
  const totals = (list) => {
    const m = new Map();
    for (const { item_id: id, enchant_level: e, quality_tier: t } of list) {
      for (const s of stats.get(id) ?? []) m.set(statKey(s), (m.get(statKey(s)) ?? 0) + Number(s.amount) * multOf(e, t));
    }
    return m;
  };
  const bySlot = Object.fromEntries(equipped.map((e) => [e.slot, e]));
  // lo que reemplazaría una pieza: su hueco, y la mano izquierda si es a dos manos (o el arma a dos manos si
  // es una mano izquierda)
  const reemplaza = (r) => [bySlot[r.slot], r.is_two_handed && r.slot === 'WEAPON' ? bySlot.OFFHAND : null,
    r.slot === 'OFFHAND' && bySlot.WEAPON?.is_two_handed ? bySlot.WEAPON : null].filter(Boolean);

  // el botín que no pide ninguna receta ni misión
  const matIds = rows.filter((r) => r.item_type === 'MATERIAL').map((r) => r.item_id);
  const usados = new Set();
  if (matIds.length) {
    const u = await db.query(
      `SELECT item_id FROM crafting_recipe_ingredients WHERE item_id = ANY($1::int[])
       UNION SELECT item_id FROM quest_objectives WHERE item_id = ANY($1::int[])
       UNION SELECT item_id FROM quest_hidden_requirements WHERE item_id = ANY($1::int[])`, [matIds]).catch(() => ({ rows: [] }));
    u.rows.forEach((x) => usados.add(x.item_id));
  }

  return rows.map((r) => {
    let mejora = false;
    let sobra = false;
    const vendible = r.sell_artisan > 0 && !r.is_quest_item && !r.is_scroll && !PRECIOSO.has(r.rarity) && !r.favorito;
    if (r.item_type === 'EQUIPMENT' && r.slot) {
      const deClase = !r.class_id || chain.includes(r.class_id);
      const nivelOk = !r.required_level || pl.level >= r.required_level;
      const puesto = equipped.some((e) => e.item_id === r.item_id && (e.enchant_level || 0) === (r.enchant_level || 0)
        && (e.quality_tier || 0) === (r.quality_tier || 0));
      const actual = reemplaza(r);
      const { up, down } = comparar(totals([r]), totals(actual));
      if (deClase && nivelOk && !puesto) mejora = actual.length ? up && !down : (stats.get(r.item_id) ?? []).length > 0;
      sobra = vendible && !eqIds.has(r.item_id) && (!deClase || (actual.length > 0 && down && !up));
    } else if (r.item_type === 'MATERIAL') {
      sobra = vendible && ['COMUN', 'POCO_COMUN'].includes(r.rarity) && !usados.has(r.item_id)
        && !/^(HUEVO_|SOBRE_)/.test(String(r.code ?? ''));
    }
    return { ...r, mejora, sobra };
  });
}

module.exports = { marcar, ensureTables, alternarFavorito, esFavorito };
