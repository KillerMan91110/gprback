// Qué devuelve desmantelar un objeto (POST /dismantle en routes/players.js):
//   - solo el equipo se desmantela (pociones, comidas y refinados no: se usan)
//   - si hay una regla manual (dismantle_recipes) manda esa, como siempre
//   - si no, la MITAD de los materiales de su receta, en promedio: por unidad del resultado (una
//     receta que hace 2 vendajes cuenta la mitad para cada uno) y con la fracción sorteada (de 3
//     colmillos salen 1 o 2, mitad y mitad) en vez del "mínimo 1" de antes, que devolvía más de lo
//     que costaba en las recetas de varias unidades
//   - las piezas de jefe (Corona, Yelmo, Núcleo del Titán, Collar del Capitán, Ojo del Vigía,
//     Corazón de Hierro Negro…: lo que solo suelta un jefe) y los objetos de misión NUNCA vuelven:
//     antes una Corona se recuperaba entera y se reciclaba sin fin
const db = require('../db/db');

const RETURN_RATE = 0.5;

// los objetos que solo sueltan los jefes (ningún común ni raro los suelta)
let bossOnly = null;
async function bossOnlyItems() {
  if (!bossOnly) {
    const r = await db.query(
      `SELECT d.item_id FROM monster_drops d JOIN monsters m ON m.id = d.monster_id
       GROUP BY d.item_id
       HAVING bool_and(m.rarity IN ('LEGENDARY', 'MINIBOSS'))`
    );
    bossOnly = new Set(r.rows.map((x) => x.item_id));
    setTimeout(() => { bossOnly = null; }, 10 * 60 * 1000).unref?.();
  }
  return bossOnly;
}

// la fracción se sortea: 1,5 da 1 o 2 (mitad y mitad)
const roundRandom = (x) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0);

// { error } o { materials: [{ itemId, name, quantity }] } para desmantelar qty unidades de itemId
async function plan(itemId, qty) {
  const item = (await db.query('SELECT name, item_type FROM items WHERE id = $1', [itemId])).rows[0];
  if (!item) return { error: 'Ese objeto no existe' };

  const manual = await db.query(
    `SELECT dr.result_item_id, i.name AS result_name, dr.result_quantity
     FROM dismantle_recipes dr JOIN items i ON i.id = dr.result_item_id WHERE dr.item_id = $1`,
    [itemId]
  );
  if (manual.rows.length) {
    return { materials: manual.rows.map((r) => ({ itemId: r.result_item_id, name: r.result_name, quantity: r.result_quantity * qty })) };
  }
  if (item.item_type !== 'EQUIPMENT') return { error: 'Solo se desmantela el equipo: las pociones, comidas y materiales se usan' };

  const recipe = (await db.query(
    `SELECT cr.id, cr.result_quantity FROM crafting_recipes cr WHERE cr.result_item_id = $1
     ORDER BY (cr.scroll_item_id IS NULL) DESC, cr.id LIMIT 1`,
    [itemId]
  )).rows[0];
  if (!recipe) return { error: 'Este objeto no se puede desmantelar' };
  const ingredients = (await db.query(
    `SELECT ci.item_id, i.name, ci.quantity, i.is_quest_item
     FROM crafting_recipe_ingredients ci JOIN items i ON i.id = ci.item_id WHERE ci.recipe_id = $1`,
    [recipe.id]
  )).rows;
  const boss = await bossOnlyItems();
  const per = Math.max(1, Number(recipe.result_quantity) || 1);
  const materials = [];
  for (const ing of ingredients) {
    if (ing.is_quest_item || boss.has(ing.item_id)) continue;
    const quantity = roundRandom((ing.quantity / per) * qty * RETURN_RATE);
    if (quantity > 0) materials.push({ itemId: ing.item_id, name: ing.name, quantity });
  }
  return { materials };
}

module.exports = { RETURN_RATE, plan };
