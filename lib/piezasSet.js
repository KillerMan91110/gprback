// Piezas de set que sueltan los monstruos raros: un poco de equipo mientras juntas para fabricarlo.
// Cada héroe tira por su cuenta y la pieza es de una clase base AL AZAR, como en los MMO: la que no
// te sirve se vende en tu puesto o se le pasa a un amigo. Como mucho una pieza por combate y héroe.
// Conseguirla también descubre su receta en el Taller (lib/recetas.js, por inventory.addItem).
// El set es el básico (sin pergamino) que la zona tiene por debajo del nivel del raro.
const db = require('../db/db');

const PIEZAS = {
  // Pradera (raros de nivel 8-11): el set de la Guardia (nv 6)
  CHAMAN_OSCURO: 'VIGIA', LOBO_FEROZ: 'VIGIA', GOLEM_MENHIR: 'VIGIA',
  // Montañas (raros de nivel 22-30): el set de la Escarcha (nv 21)
  BRUJO_MONTANA: 'ESCARCHA', GIGANTE_HIELO: 'ESCARCHA',
  // Volcán (raros de nivel 38-42): el set de Obsidiana (nv 36)
  MAESTRO_LAVA: 'OBSIDIANA', DRAGON_MENOR_CORRUPTO: 'OBSIDIANA',
  // Costas (raros de nivel 53-57): el set de Coral (nv 51)
  LEVIATAN_MENOR: 'CORAL', CAPITAN_PIRATA: 'CORAL',
};
const CHANCE = 4; // % por raro vencido, antes de los bonos de botín
const BASE_CLASSES = ['GUERRERO', 'MAGO', 'ARQUERO', 'PICARO', 'SACERDOTE'];

const piecesCache = new Map();
async function piecesOf(classCode, suffix) {
  const key = `${classCode}_${suffix}`;
  if (!piecesCache.has(key)) {
    const r = await db.query(
      `SELECT i.id, i.name FROM items i
       WHERE i.item_type = 'EQUIPMENT' AND i.code ~ $1
         AND EXISTS (SELECT 1 FROM crafting_recipes cr WHERE cr.result_item_id = i.id AND cr.scroll_item_id IS NULL)`,
      [`^${classCode}_[A-Z0-9]+_${suffix}$`]
    );
    piecesCache.set(key, r.rows);
  }
  return piecesCache.get(key);
}

// ¿le cae una pieza a este héroe? dropBonusPct: sus bonos de botín. La clase de la pieza, al azar.
async function rollFor(enemies, dropBonusPct = 0) {
  const chance = Math.min(100, CHANCE * (1 + dropBonusPct / 100));
  for (const e of enemies) {
    const suffix = PIEZAS[e.monster_code];
    if (!suffix || Math.random() * 100 >= chance) continue;
    const list = await piecesOf(BASE_CLASSES[Math.floor(Math.random() * BASE_CLASSES.length)], suffix);
    if (list.length) return list[Math.floor(Math.random() * list.length)];
  }
  return null;
}

module.exports = { PIEZAS, CHANCE, rollFor };
