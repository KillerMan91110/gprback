const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const { getActivePetBonuses } = require('../lib/pets');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);

const HATCH_HOURS = {
  COMUN: 0.25, POCO_COMUN: 0.75, RARO: 1.5, EPICO: 2, LEGENDARIO: 4,
};

const EGG_CODE_TO_RARITY = {
  HUEVO_COMUN: 'COMUN', HUEVO_POCO_COMUN: 'POCO_COMUN',
  HUEVO_RARO: 'RARO', HUEVO_EPICO: 'EPICO', HUEVO_LEGENDARIO: 'LEGENDARIO',
};

// GET /api/player/:playerId/pets
router.get('/', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const result = await db.query(
      `SELECT pp.id, pp.pet_id, p.code, p.name, p.rarity, p.description, p.element_id,
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
    const { itemId, quantity = 1 } = req.body;
    if (!itemId) return res.status(400).json({ error: 'Falta itemId' });

    const petRes = await db.query(
      'SELECT * FROM player_pets WHERE id = $1 AND player_id = $2',
      [playerPetId, playerId]
    );
    if (!petRes.rows.length) return res.status(404).json({ error: 'Mascota no encontrada' });
    const pet = petRes.rows[0];

    const invRes = await db.query(
      'SELECT quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2',
      [playerId, itemId]
    );
    if (!invRes.rows.length || invRes.rows[0].quantity < quantity) {
      return res.status(400).json({ error: 'No tienes suficiente cantidad de ese item' });
    }

    await db.query(
      'UPDATE player_inventory SET quantity = quantity - $1 WHERE player_id = $2 AND item_id = $3',
      [quantity, playerId, itemId]
    );
    await db.query(
      'DELETE FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND quantity <= 0',
      [playerId, itemId]
    );

    const BOND_PER_ITEM = 10;
    const BOND_PER_LEVEL = 100;
    const MAX_LEVEL = 20;
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

// GET /api/player/:playerId/incubator
router.get('/incubator', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const result = await db.query(
      `SELECT pi.egg_item_id, i.name AS egg_name, pi.egg_rarity,
              pi.started_at, pi.hatch_ready_at,
              (now() >= pi.hatch_ready_at) AS ready
       FROM player_incubator pi
       JOIN items i ON i.id = pi.egg_item_id
       WHERE pi.player_id = $1`,
      [playerId]
    );
    res.json(result.rows[0] ?? null);
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/incubator  — poner huevo en incubadora
// body: { itemId }
router.post('/incubator', async (req, res, next) => {
  try {
    const { playerId } = req.params;
    const { itemId } = req.body;
    if (!itemId) return res.status(400).json({ error: 'Falta itemId' });

    const slot = await db.query('SELECT 1 FROM player_incubator WHERE player_id = $1', [playerId]);
    if (slot.rows.length) return res.status(400).json({ error: 'La incubadora ya está ocupada' });

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

    const eggRarity = EGG_CODE_TO_RARITY[invRes.rows[0].code];
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
      `INSERT INTO player_incubator(player_id, egg_item_id, egg_rarity, hatch_ready_at)
       VALUES($1, $2, $3, now() + ($4 || ' hours')::interval)
       RETURNING hatch_ready_at`,
      [playerId, itemId, eggRarity, HATCH_HOURS[eggRarity]]
    );

    res.status(201).json({ egg_rarity: eggRarity, hatch_ready_at: hatchRes.rows[0].hatch_ready_at });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/incubator/claim  — reclamar mascota eclosionada
router.post('/incubator/claim', async (req, res, next) => {
  try {
    const { playerId } = req.params;

    const incRes = await db.query(
      'SELECT * FROM player_incubator WHERE player_id = $1 AND now() >= hatch_ready_at',
      [playerId]
    );
    if (!incRes.rows.length) {
      return res.status(400).json({ error: 'No hay huevo listo para eclosionar' });
    }
    const { egg_rarity } = incRes.rows[0];

    const petRes = await db.query(
      'SELECT id FROM pets WHERE rarity = $1 ORDER BY random() LIMIT 1',
      [egg_rarity]
    );
    if (!petRes.rows.length) return res.status(500).json({ error: 'No hay mascotas de esa rareza' });

    const newPetRes = await db.query(
      'INSERT INTO player_pets(player_id, pet_id) VALUES($1, $2) RETURNING id',
      [playerId, petRes.rows[0].id]
    );

    await db.query('DELETE FROM player_incubator WHERE player_id = $1', [playerId]);

    const info = await db.query(
      `SELECT pp.id, p.code, p.name, p.rarity, p.description, pp.level, pp.bond_points, pp.is_active
       FROM player_pets pp JOIN pets p ON p.id = pp.pet_id WHERE pp.id = $1`,
      [newPetRes.rows[0].id]
    );
    res.status(201).json(info.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
