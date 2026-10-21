const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const { getActivePetBonuses } = require('../lib/pets');
const { parseQuantity } = require('../lib/currency');
const huevos = require('../lib/huevos');
const logros = require('../lib/logros');
const { incrementCounter } = require('../lib/counters');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);

const HATCH_HOURS = {
  COMUN: 0.25, POCO_COMUN: 0.75, RARO: 1.5, EPICO: 2, LEGENDARIO: 4,
};

// los huevos de siempre (HUEVO_RARO) y los de cada zona (HUEVO_TUNDRA_RARO): ver lib/huevos.js

// Tienda del World Boss: sube el tope de nivel de UNA mascota puntual en vez de darle bond
// normal — por eso se maneja aparte del calculo de bond_points/nivel de mas abajo.
const TRANSCENDENCE_STONE_CODE = 'PIEDRA_TRASCENDENCIA';
const TRANSCENDENCE_STONE_LEVEL_BONUS = 3;

// GET /api/player/:playerId/pets
router.get('/', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const result = await db.query(
      `SELECT pp.id, pp.pet_id, p.code, p.name, p.rarity, p.description, p.element_id, p.zone_id,
              pp.level, pp.bond_points, pp.is_active, pp.hatched_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'stat_code', pb.stat_code,
                   'value', pb.base_amount + pb.per_level_amount * (pp.level - 1)
                 ))
                 FROM pet_bonuses pb WHERE pb.pet_id = pp.pet_id),
                '[]'
              ) AS bonuses
       FROM player_pets pp
       JOIN pets p ON p.id = pp.pet_id
       WHERE pp.player_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM player_market_listings l
           WHERE l.player_pet_id = pp.id AND l.status = 'ACTIVE'
         )
       ORDER BY pp.is_active DESC, pp.id`,
      [playerId]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/pets/:playerPetId/activate
router.post('/:playerPetId/activate', async (req, res, next) => {
  try {
    const { playerId, playerPetId } = req.params;
    const owns = await db.query(
      'SELECT id FROM player_pets WHERE id = $1 AND player_id = $2',
      [playerPetId, playerId]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Mascota no encontrada' });
    await db.query('UPDATE player_pets SET is_active = FALSE WHERE player_id = $1', [playerId]);
    await db.query('UPDATE player_pets SET is_active = TRUE WHERE id = $1', [playerPetId]);

    // Curar al jugador por el HP plano que da la nueva mascota activa
    const petB = await getActivePetBonuses(Number(playerId));
    if (petB.hp > 0) {
      await db.query(
        'UPDATE players SET hp = LEAST(max_hp + $1, hp + $1) WHERE id = $2',
        [petB.hp, playerId]
      );
    }

    res.json({ message: 'Mascota activada' });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/pets/:playerPetId/deactivate
router.post('/:playerPetId/deactivate', async (req, res, next) => {
  try {
    const { playerId, playerPetId } = req.params;
    const owns = await db.query(
      'SELECT id FROM player_pets WHERE id = $1 AND player_id = $2',
      [playerPetId, playerId]
    );
    if (!owns.rows.length) return res.status(404).json({ error: 'Mascota no encontrada' });
    await db.query('UPDATE player_pets SET is_active = FALSE WHERE id = $1', [playerPetId]);
    res.json({ message: 'Mascota desactivada' });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/pets/:playerPetId/feed
// body: { itemId, quantity? }
router.post('/:playerPetId/feed', async (req, res, next) => {
  try {
    const { playerId, playerPetId } = req.params;
    const { itemId } = req.body;
    // Entero >= 1: con una cantidad negativa el chequeo de stock pasaba y el UPDATE de abajo
    // SUMABA ese item al inventario (duplicaba cualquier item que tuvieras al menos 1).
    const quantity = parseQuantity(req.body.quantity, 9999);
    if (!itemId) return res.status(400).json({ error: 'Falta itemId' });

    const petRes = await db.query(
      'SELECT * FROM player_pets WHERE id = $1 AND player_id = $2',
      [playerPetId, playerId]
    );
    if (!petRes.rows.length) return res.status(404).json({ error: 'Mascota no encontrada' });
    const pet = petRes.rows[0];

    // lo que tiene candado en la mochila no se le da de comer (lib/mochila.js)
    if (await require('../lib/mochila').esFavorito(Number(playerId), Number(itemId))) {
      return res.status(400).json({ error: 'Eso tiene candado en tu mochila: quítaselo para dárselo a tu mascota.' });
    }
    const itemRes = await db.query('SELECT code FROM items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    const itemCode = itemRes.rows[0].code;

    const invRes = await db.query(
      'SELECT quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2',
      [playerId, itemId]
    );
    if (!invRes.rows.length || invRes.rows[0].quantity < quantity) {
      return res.status(400).json({ error: 'No tienes suficiente cantidad de ese item' });
    }

    // Guard en el propio UPDATE: dos alimentaciones simultaneas podian pasar el chequeo de
    // arriba con el mismo stock leido.
    const consumed = await db.query(
      'UPDATE player_inventory SET quantity = quantity - $1 WHERE player_id = $2 AND item_id = $3 AND quantity >= $1 RETURNING id',
      [quantity, playerId, itemId]
    );
    if (!consumed.rows.length) {
      return res.status(400).json({ error: 'No tienes suficiente cantidad de ese item' });
    }
    await db.query(
      'DELETE FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND quantity <= 0',
      [playerId, itemId]
    );

    if (itemCode === TRANSCENDENCE_STONE_CODE) {
      const bump = TRANSCENDENCE_STONE_LEVEL_BONUS * Number(quantity);
      const newLevel = pet.level + bump;
      const newBonusMaxLevel = pet.bonus_max_level + bump;
      await db.query(
        'UPDATE player_pets SET level = $1, bonus_max_level = $2 WHERE id = $3',
        [newLevel, newBonusMaxLevel, playerPetId]
      );
      return res.json({ level: newLevel, bonus_max_level: newBonusMaxLevel, leveled_up: true, transcended: true });
    }

    const BOND_PER_ITEM = 10;
    const BOND_PER_LEVEL = 100;
    const MAX_LEVEL = 20 + pet.bonus_max_level;
    const gained = BOND_PER_ITEM * Number(quantity);
    const total = pet.bond_points + gained;
    const levelsGained = Math.min(MAX_LEVEL - pet.level, Math.floor(total / BOND_PER_LEVEL));
    const newLevel = pet.level + levelsGained;
    const newBond = newLevel >= MAX_LEVEL ? 0 : total % BOND_PER_LEVEL;

    await db.query(
      'UPDATE player_pets SET bond_points = $1, level = $2 WHERE id = $3',
      [newBond, newLevel, playerPetId]
    );

    res.json({ bond_points: newBond, level: newLevel, leveled_up: levelsGained > 0 });
  } catch (err) { next(err); }
});

// GET /api/player/:playerId/pets/catalogo — todas las mascotas (con su zona) y cuánto tarda cada huevo:
// el panel de mascotas muestra qué puede nacer de cada huevo (lib/huevos.js)
router.get('/catalogo', async (req, res, next) => {
  try {
    const r = await db.query('SELECT id, code, name, rarity, zone_id FROM pets ORDER BY id');
    res.json({ pets: r.rows, hatchHours: HATCH_HOURS });
  } catch (err) { next(err); }
});

// La incubadora tiene lugares (ranuras): uno siempre y un segundo con el hito de 150 Puntos de Gesta
// (lib/logros.js HITOS). Las horas se guardan sin zona horaria: los segundos los cuenta la base
// (seconds_left / total_seconds) y el panel arma la cuenta regresiva con su propio reloj.
let incubadoraLista = null;
function ensureIncubadora() {
  incubadoraLista ??= db.query(`
    ALTER TABLE player_incubator ADD COLUMN IF NOT EXISTS ranura SMALLINT NOT NULL DEFAULT 1;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'player_incubator_pkey'
                     AND pg_get_constraintdef(oid) LIKE '%ranura%') THEN
        ALTER TABLE player_incubator DROP CONSTRAINT IF EXISTS player_incubator_pkey;
        ALTER TABLE player_incubator ADD CONSTRAINT player_incubator_pkey PRIMARY KEY (player_id, ranura);
      END IF;
    END $$`).catch((err) => { incubadoraLista = null; throw err; });
  return incubadoraLista;
}
const ranurasDe = async (playerId) => 1 + ((await logros.puntosDe(Number(playerId)).catch(() => 0)) >= logros.PUNTOS_INCUBADORA_DOBLE ? 1 : 0);
async function huevosIncubando(playerId) {
  await ensureIncubadora();
  return (await db.query(
    `SELECT pi.ranura, pi.egg_item_id, i.name AS egg_name, i.code AS egg_code, pi.egg_rarity,
            pi.started_at, pi.hatch_ready_at,
            GREATEST(0, EXTRACT(EPOCH FROM pi.hatch_ready_at - now()))::int AS seconds_left,
            GREATEST(1, EXTRACT(EPOCH FROM pi.hatch_ready_at - pi.started_at))::int AS total_seconds,
            (now() >= pi.hatch_ready_at) AS ready
     FROM player_incubator pi
     JOIN items i ON i.id = pi.egg_item_id
     WHERE pi.player_id = $1 ORDER BY pi.ranura`,
    [playerId]
  )).rows;
}

// GET /api/player/:playerId/pets/incubator — el huevo de la incubadora (si hay dos, el que esté listo primero);
// lo usa el aviso global de huevo listo
router.get('/incubator', async (req, res, next) => {
  try {
    const rows = await huevosIncubando(req.params.playerId);
    res.json(rows.find((r) => r.ready) ?? rows[0] ?? null);
  } catch (err) { next(err); }
});

// GET /api/player/:playerId/pets/incubadoras — todos los lugares: { max, huevos: [...], puntosParaOtra }
router.get('/incubadoras', async (req, res, next) => {
  try {
    const [huevosEnCurso, max] = await Promise.all([huevosIncubando(req.params.playerId), ranurasDe(req.params.playerId)]);
    res.json({ max, huevos: huevosEnCurso, puntosParaOtra: max < 2 ? logros.PUNTOS_INCUBADORA_DOBLE : null });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/pets/incubator  — poner un huevo en un lugar libre
// body: { itemId }
router.post('/incubator', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: 'Falta itemId' });

    const [ocupadas, max] = await Promise.all([huevosIncubando(playerId), ranurasDe(playerId)]);
    const libre = [1, 2].slice(0, max).find((n) => !ocupadas.some((o) => o.ranura === n));
    if (!libre) return res.status(400).json({ error: max > 1 ? 'Los dos lugares de la incubadora están ocupados' : 'La incubadora ya está ocupada' });

    const invRes = await db.query(
      `SELECT pi.quantity, i.code
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE pi.player_id = $1 AND pi.item_id = $2`,
      [playerId, itemId]
    );
    if (!invRes.rows.length || invRes.rows[0].quantity < 1) {
      return res.status(400).json({ error: 'No tienes ese huevo' });
    }

    const eggRarity = huevos.huevo(invRes.rows[0].code)?.rarity;
    if (!eggRarity) return res.status(400).json({ error: 'Ese item no es un huevo válido' });

    await db.query(
      'UPDATE player_inventory SET quantity = quantity - 1 WHERE player_id = $1 AND item_id = $2',
      [playerId, itemId]
    );
    await db.query(
      'DELETE FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND quantity <= 0',
      [playerId, itemId]
    );

    const hatchRes = await db.query(
      `INSERT INTO player_incubator(player_id, ranura, egg_item_id, egg_rarity, hatch_ready_at)
       VALUES($1, $2, $3, $4, now() + ($5 || ' hours')::interval)
       RETURNING hatch_ready_at`,
      [playerId, libre, itemId, eggRarity, HATCH_HOURS[eggRarity]]
    );

    res.status(201).json({ egg_rarity: eggRarity, ranura: libre, hatch_ready_at: hatchRes.rows[0].hatch_ready_at });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/pets/incubator/claim { ranura? } — reclamar la mascota (de ese lugar, o del primero listo)
router.post('/incubator/claim', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const ranura = req.body?.ranura ? Number(req.body.ranura) : null;
    await ensureIncubadora();

    const incRes = await db.query(
      `SELECT * FROM player_incubator WHERE player_id = $1 AND now() >= hatch_ready_at AND ($2::int IS NULL OR ranura = $2)
       ORDER BY ranura LIMIT 1`,
      [playerId, ranura]
    );
    if (!incRes.rows.length) {
      return res.status(400).json({ error: 'No hay huevo listo para eclosionar' });
    }
    const { egg_rarity, egg_item_id, ranura: lugar } = incRes.rows[0];

    // el huevo de una zona da una mascota de esa zona (lib/huevos.js)
    const eggCode = (await db.query('SELECT code FROM items WHERE id = $1', [egg_item_id])).rows[0]?.code;
    const petId = await huevos.mascotaDe(eggCode, egg_rarity);
    if (!petId) return res.status(500).json({ error: 'No hay mascotas de esa rareza' });

    const newPetRes = await db.query(
      'INSERT INTO player_pets(player_id, pet_id) VALUES($1, $2) RETURNING id',
      [playerId, petId]
    );

    await db.query('DELETE FROM player_incubator WHERE player_id = $1 AND ranura = $2', [playerId, lugar]);
    await incrementCounter(playerId, 'MASCOTAS_NACIDAS');
    const logrosNuevos = await logros.revisarSeguro(Number(playerId));

    const info = await db.query(
      `SELECT pp.id, p.code, p.name, p.rarity, p.description, pp.level, pp.bond_points, pp.is_active
       FROM player_pets pp JOIN pets p ON p.id = pp.pet_id WHERE pp.id = $1`,
      [newPetRes.rows[0].id]
    );
    res.status(201).json({ ...info.rows[0], logros: logrosNuevos });
  } catch (err) { next(err); }
});

module.exports = router;
