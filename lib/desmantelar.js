// Qué devuelve desmantelar un objeto (POST /dismantle en routes/players.js):
//   - solo el equipo se desmantela (pociones, comidas y refinados no: se usan)
//   - si hay una regla manual (dismantle_recipes) manda esa, como siempre
//   - si no, cada pieza devuelve 1 o 2 de los materiales de su receta, AL AZAR (no la lista entera:
//     desmantelar recupera algo, no deshace el crafteo), y de cada uno la mitad de lo que llevaba,
//     por unidad del resultado (una receta que hace 2 cuenta la mitad para cada uno) y con la
//     fracción sorteada (de 3 colmillos salen 1 o 2, mitad y mitad)
//   - las piezas de jefe (Corona, Yelmo, Núcleo del Titán, Collar del Capitán, Ojo del Vigía,
//     Corazón de Hierro Negro…: lo que solo suelta un jefe) y los objetos de misión NUNCA vuelven
//   - según su rareza, a veces sale además una piedra de encantamiento (STONES): desmantelar
//     alimenta el encantamiento
// Cada unidad sortea por su cuenta (desmantelar 5 = 5 sorteos).
const db = require('../db/db');

const RETURN_RATE = 0.5;
// piedra que puede soltar cada rareza: [probabilidad %, código], en orden (la primera que salga)
const STONES = {
  RARO: [[15, 'PIEDRA_ENCANT_MENOR']],
  EPICO: [[10, 'PIEDRA_ENCANT_MAYOR'], [30, 'PIEDRA_ENCANT_MENOR']],
  LEGENDARIO: [[25, 'PIEDRA_ENCANT_MAYOR']],
};

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

let stoneItems = null;
async function stoneItemsByCode() {
  if (!stoneItems) {
    const codes = [...new Set(Object.values(STONES).flat().map(([, c]) => c))];
    const r = await db.query('SELECT id, code, name FROM items WHERE code = ANY($1::text[])', [codes]);
    stoneItems = Object.fromEntries(r.rows.map((x) => [x.code, x]));
  }
  return stoneItems;
}

// la fracción se sortea: 1,5 da 1 o 2 (mitad y mitad)
const roundRandom = (x) => Math.floor(x) + (Math.random() < x - Math.floor(x) ? 1 : 0);
const pickSome = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);

// { error } o { materials: [{ itemId, name, quantity }] } para desmantelar qty unidades de itemId
async function plan(itemId, qty) {
  const item = (await db.query('SELECT name, item_type, rarity FROM items WHERE id = $1', [itemId])).rows[0];
  if (!item) return { error: 'Ese objeto no existe' };

  const got = new Map();
  const add = (id, name, n) => {
    if (n <= 0) return;
    const cur = got.get(id) ?? { itemId: id, name, quantity: 0 };
    cur.quantity += n;
    got.set(id, cur);
  };

  const manual = await db.query(
    `SELECT dr.result_item_id, i.name AS result_name, dr.result_quantity
     FROM dismantle_recipes dr JOIN items i ON i.id = dr.result_item_id WHERE dr.item_id = $1`,
    [itemId]
  );
  if (manual.rows.length) {
    for (const r of manual.rows) add(r.result_item_id, r.result_name, r.result_quantity * qty);
  } else {
    if (item.item_type !== 'EQUIPMENT') return { error: 'Solo se desmantela el equipo: las pociones, comidas y materiales se usan' };
    const recipe = (await db.query(
      `SELECT cr.id, cr.result_quantity FROM crafting_recipes cr WHERE cr.result_item_id = $1
       ORDER BY (cr.scroll_item_id IS NULL) DESC, cr.id LIMIT 1`,
      [itemId]
    )).rows[0];
    if (!recipe) return { error: 'Este objeto no se puede desmantelar' };
    const boss = await bossOnlyItems();
    const ingredients = (await db.query(
      `SELECT ci.item_id, i.name, ci.quantity, i.is_quest_item
       FROM crafting_recipe_ingredients ci JOIN items i ON i.id = ci.item_id WHERE ci.recipe_id = $1`,
      [recipe.id]
    )).rows.filter((ing) => !ing.is_quest_item && !boss.has(ing.item_id));
    const per = Math.max(1, Number(recipe.result_quantity) || 1);
    for (let u = 0; u < qty; u++) {
      // 1 o 2 de sus materiales, al azar
      for (const ing of pickSome(ingredients, Math.random() < 0.5 ? 1 : 2)) {
        add(ing.item_id, ing.name, roundRandom((ing.quantity / per) * RETURN_RATE));
      }
    }
  }

  // la piedra de encantamiento, según la rareza de la pieza
  const table = STONES[item.rarity];
  if (table) {
    const stones = await stoneItemsByCode();
    for (let u = 0; u < qty; u++) {
      const roll = Math.random() * 100;
      let acc = 0;
      for (const [pct, code] of table) {
        acc += pct;
        if (roll < acc && stones[code]) { add(stones[code].id, stones[code].name, 1); break; }
      }
    }
  }
  return { materials: [...got.values()] };
}

// Lo que PUEDE salir de desmantelar una unidad, para mostrarlo antes de romperla (el Taller):
// { error } o { materiales: [{ itemId, code, name, hasta }], piedras: [{ itemId, code, name, prob }], cuantos }
// (cuantos: de cuántos materiales salen; en las reglas manuales salen todos)
async function preview(itemId) {
  const item = (await db.query('SELECT name, item_type, rarity FROM items WHERE id = $1', [itemId])).rows[0];
  if (!item) return { error: 'Ese objeto no existe' };
  const materiales = [];
  let cuantos = '1 o 2';
  const manual = await db.query(
    `SELECT dr.result_item_id, i.code, i.name, dr.result_quantity
     FROM dismantle_recipes dr JOIN items i ON i.id = dr.result_item_id WHERE dr.item_id = $1`,
    [itemId]
  );
  if (manual.rows.length) {
    cuantos = 'todos';
    for (const r of manual.rows) materiales.push({ itemId: r.result_item_id, code: r.code, name: r.name, hasta: r.result_quantity });
  } else {
    if (item.item_type !== 'EQUIPMENT') return { error: 'Solo se desmantela el equipo' };
    const recipe = (await db.query(
      `SELECT cr.id, cr.result_quantity FROM crafting_recipes cr WHERE cr.result_item_id = $1
       ORDER BY (cr.scroll_item_id IS NULL) DESC, cr.id LIMIT 1`,
      [itemId]
    )).rows[0];
    if (!recipe) return { error: 'Este objeto no se puede desmantelar' };
    const boss = await bossOnlyItems();
    const per = Math.max(1, Number(recipe.result_quantity) || 1);
    const ings = (await db.query(
      `SELECT ci.item_id, i.code, i.name, ci.quantity, i.is_quest_item
       FROM crafting_recipe_ingredients ci JOIN items i ON i.id = ci.item_id WHERE ci.recipe_id = $1`,
      [recipe.id]
    )).rows.filter((ing) => !ing.is_quest_item && !boss.has(ing.item_id));
    for (const ing of ings) materiales.push({ itemId: ing.item_id, code: ing.code, name: ing.name, hasta: Math.ceil((ing.quantity / per) * RETURN_RATE) });
  }
  const stones = await stoneItemsByCode();
  const piedras = (STONES[item.rarity] ?? []).filter(([, c]) => stones[c]).map(([pct, c]) => ({ itemId: stones[c].id, code: c, name: stones[c].name, prob: pct }));
  return { materiales, piedras, cuantos };
}

module.exports = { RETURN_RATE, STONES, plan, preview };
