// Libro de recetas de cada jugador: las recetas básicas (sin pergamino) se DESCUBREN. Una receta
// aparece en el Taller cuando consigues cualquiera de sus materiales (botín, recolección, misión o
// compra: todo entra por inventory.addItem) o la pieza que fabrica, y queda para siempre aunque
// gastes el material. Las de los sets de jefe y de mazmorra (las que tienen scroll_item_id) se
// aprenden de dos formas: leyendo el PERGAMINO del set (la receta de todo el set de esa clase) o
// consiguiendo una pieza, que enseña solo esa pieza. Los jefes sueltan las dos cosas por separado
// (routes/combat.js rollMonsterDrops). Antes de aprenderlas se ven en el Taller con candado.
//   player_known_recipes: qué recetas descubrió (seen: ya la abrió en el Taller → sin "NUEVO";
//                         notified: ya se le avisó con el "¡Descubriste un crafteo nuevo!")
//   player_recipe_book:   la primera vez se le descubren, sin avisos sueltos, las recetas de lo
//                         que ya tenía en la mochila (los que jugaban antes de esto)
const db = require('../db/db');

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_known_recipes (
      player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      recipe_id     INTEGER NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,
      discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      seen          BOOLEAN NOT NULL DEFAULT FALSE,
      notified      BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (player_id, recipe_id)
    );
    CREATE TABLE IF NOT EXISTS player_recipe_book (
      player_id      INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      bootstrapped_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

// descubre las recetas básicas que usan alguno de estos objetos (o que los fabrican); devuelve las nuevas.
// Las de un arma única de clase (la Lágrima de Aethra: una sola lágrima, una sola arma) se descubren
// solo para tu clase: las de las otras no se pueden hacer y no tienen por qué aparecer.
async function discoverFromItems(playerId, itemIds, queryable = db, { seen = false } = {}) {
  if (!itemIds?.length) return [];
  await ensureTables();
  const r = await queryable.query(
    `INSERT INTO player_known_recipes (player_id, recipe_id, seen)
     SELECT $1, cr.id, $3 FROM crafting_recipes cr JOIN items ri ON ri.id = cr.result_item_id
     WHERE cr.scroll_item_id IS NULL
       AND NOT (ri.rarity = 'UNICO' AND cr.required_class_id IS NOT NULL
                AND cr.required_class_id IS DISTINCT FROM (SELECT current_class_id FROM players WHERE id = $1))
       AND (cr.result_item_id = ANY($2::int[])
            OR EXISTS (SELECT 1 FROM crafting_recipe_ingredients ci WHERE ci.recipe_id = cr.id AND ci.item_id = ANY($2::int[])))
     ON CONFLICT DO NOTHING
     RETURNING recipe_id`,
    [playerId, itemIds, seen]
  );
  // una pieza de set de jefe enseña a fabricar esa misma pieza (el set entero lo enseña el pergamino)
  const learned = await queryable.query(
    `INSERT INTO player_learned_recipes (player_id, recipe_id)
     SELECT DISTINCT $1::int, cr.id FROM crafting_recipes cr
     WHERE cr.scroll_item_id IS NOT NULL AND cr.result_item_id = ANY($2::int[])
     ON CONFLICT DO NOTHING
     RETURNING recipe_id`,
    [playerId, itemIds]
  );
  // y quedan como NUEVO en el Taller, con el aviso de crafteo nuevo
  if (learned.rows.length) {
    await queryable.query(
      `INSERT INTO player_known_recipes (player_id, recipe_id, seen)
       SELECT $1::int, x, FALSE FROM unnest($2::int[]) x ON CONFLICT DO NOTHING`,
      [playerId, learned.rows.map((x) => x.recipe_id)]
    );
  }
  return [...r.rows.map((x) => x.recipe_id), ...learned.rows.map((x) => x.recipe_id)];
}

// primera vez: lo que ya tiene en la mochila descubre sus recetas (sin el "NUEVO" en cada una)
async function ensureBook(playerId) {
  await ensureTables();
  const r = await db.query('INSERT INTO player_recipe_book (player_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING player_id', [playerId]);
  if (!r.rows.length) return;
  const inv = await db.query('SELECT DISTINCT item_id FROM player_inventory WHERE player_id = $1 AND quantity > 0', [playerId]);
  await discoverFromItems(playerId, inv.rows.map((x) => x.item_id), db, { seen: true });
}

// descubrimientos que todavía no se le avisaron (y quedan avisados)
async function novedades(playerId) {
  await ensureBook(playerId);
  const r = await db.query(
    `UPDATE player_known_recipes pk SET notified = TRUE
     FROM crafting_recipes cr JOIN items i ON i.id = cr.result_item_id
     WHERE pk.player_id = $1 AND NOT pk.notified AND cr.id = pk.recipe_id
     RETURNING cr.code, i.name`,
    [playerId]
  );
  return r.rows.map((x) => ({ code: x.code, name: x.name }));
}

async function markSeen(playerId, recipeCode) {
  await ensureTables();
  await db.query(
    `UPDATE player_known_recipes pk SET seen = TRUE FROM crafting_recipes cr
     WHERE pk.player_id = $1 AND pk.recipe_id = cr.id AND cr.code = $2`,
    [playerId, recipeCode]
  );
}

module.exports = { ensureTables, ensureBook, discoverFromItems, novedades, markSeen };
