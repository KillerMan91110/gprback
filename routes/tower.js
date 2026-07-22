// routes/tower.js
// Fase 2+3 de la Torre/Mazmorra infinita: motor de corridas + economía de dungeon_coins.

const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const combatEngine = require('./combat');
const inventory = require('../lib/inventory');
const { incrementCounter } = require('../lib/counters');

router.use(requireAuth);
router.use(requireSelf);

const MIN_LEVEL = 30;
const DIFFICULTIES = {
  1: { label: 'Normal',      coinMult: 1   },
  2: { label: 'Difícil',     coinMult: 1.5 },
  3: { label: 'Muy Difícil', coinMult: 2   },
};

async function getActiveRun(playerId) {
  const res = await db.query(
    `SELECT * FROM player_tower_runs
     WHERE status = 'IN_PROGRESS' AND (player_id = $1 OR guest_player_id = $1 OR guest_player_id_2 = $1)`,
    [playerId]
  );
  return res.rows[0] || null;
}

async function getFloor(floorNumber) {
  const { queryFloor, lap } = combatEngine.resolveInfiniteFloor(floorNumber);
  const res = await db.query('SELECT * FROM tower_floors WHERE floor_number = $1', [queryFloor]);
  if (!res.rows[0]) return null;
  return { ...res.rows[0], floor_number: floorNumber, lap };
}

// El líder de la corrida (quien la inició, run.player_id) controla Seguir/Extraer mientras
// esté vivo. Si murió en la sala/piso, cualquier otro participante vivo puede decidir en su
// lugar — esto NO cambia el liderazgo real del grupo co-op, solo el control de estos botones.
async function canControlRun(run, callerId) {
  const participantIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
  const hpRes = await db.query('SELECT id, hp FROM players WHERE id = ANY($1::int[])', [participantIds]);
  const hpById = Object.fromEntries(hpRes.rows.map((r) => [r.id, r.hp]));

  const leaderAlive = (hpById[run.player_id] ?? 0) > 0;
  if (leaderAlive) return callerId === run.player_id;
  return (hpById[callerId] ?? 0) > 0;
}

const READY_TTL_MS = 15000;

async function getMyGroupId(playerId) {
  const res = await db.query('SELECT gm.group_id FROM player_coop_group_members gm WHERE gm.player_id = $1', [playerId]);
  return res.rows[0]?.group_id ?? null;
}

async function getGroupMemberIds(groupId) {
  const res = await db.query('SELECT player_id FROM player_coop_group_members WHERE group_id = $1', [groupId]);
  return res.rows.map((r) => r.player_id);
}

// POST /api/player/:playerId/tower/ready
router.post('/ready', async (req, res, next) => {
  try {
    const groupId = await getMyGroupId(req.playerId);
    if (!groupId) return res.status(400).json({ error: 'No estás en un grupo co-op' });

    await db.query(
      `INSERT INTO player_tower_ready(player_id, ready_at) VALUES($1, now())
       ON CONFLICT (player_id) DO UPDATE SET ready_at = now()`,
      [req.playerId]
    );

    const memberIds = await getGroupMemberIds(groupId);
    const readyRows = await db.query(
      `SELECT player_id FROM player_tower_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );

    const allReady = readyRows.rows.length === memberIds.length;
    if (!allReady) return res.json({ allReady: false });

    const otherIds = memberIds.filter((id) => id !== req.playerId);
    await db.query('DELETE FROM player_tower_ready WHERE player_id = ANY($1::int[])', [memberIds]);
    res.json({ allReady: true, coopPartnerIds: otherIds });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/player/:playerId/tower/ready
router.delete('/ready', async (req, res, next) => {
  try {
    await db.query('DELETE FROM player_tower_ready WHERE player_id = $1', [req.playerId]);
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/ready-status
router.get('/ready-status', async (req, res, next) => {
  try {
    const groupId = await getMyGroupId(req.playerId);
    if (!groupId) return res.json({ inParty: false, members: [] });

    const memberIds = await getGroupMemberIds(groupId);
    const otherIds = memberIds.filter((id) => id !== req.playerId);

    const rows = await db.query(
      `SELECT player_id FROM player_tower_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );
    const readyIds = new Set(rows.rows.map((r) => r.player_id));
    const members = otherIds.map((id) => ({ playerId: id, ready: readyIds.has(id) }));
    res.json({ inParty: true, myReady: readyIds.has(req.playerId), members });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/start   body: { difficulty, coopPartnerIds? }
router.post('/start', async (req, res, next) => {
  try {
    const difficulty = Number(req.body?.difficulty) || 1;
    if (!DIFFICULTIES[difficulty]) {
      return res.status(400).json({ error: 'Dificultad inválida' });
    }

    const coopPartnerIds = Array.isArray(req.body?.coopPartnerIds)
      ? [...new Set(req.body.coopPartnerIds.map(Number))].filter((id) => id !== req.playerId)
      : [];
    if (coopPartnerIds.length > 2) {
      return res.status(400).json({ error: 'Máximo 2 compañeros' });
    }

    const allIds = [req.playerId, ...coopPartnerIds];
    const levelRes = await db.query('SELECT id, nickname, level, hp, max_hp FROM players WHERE id = ANY($1::int[])', [allIds]);
    if (levelRes.rows.length !== allIds.length) {
      return res.status(404).json({ error: 'Algún jugador no fue encontrado' });
    }
    const belowLevel = levelRes.rows.filter((r) => r.level < MIN_LEVEL);
    if (belowLevel.length) {
      return res.status(400).json({
        error: `${belowLevel.map((r) => r.nickname).join(', ')} no tiene el nivel ${MIN_LEVEL} necesario para entrar a la torre — nadie del grupo puede entrar.`,
      });
    }

    const notFullHp = levelRes.rows.filter((r) => r.hp < r.max_hp).map((r) => r.nickname);
    const npcHpRes = await db.query(
      `SELECT pn.name, pn.hp, pn.max_hp
       FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = ANY($1::int[])`,
      [allIds]
    );
    const npcNotFull = npcHpRes.rows.filter((r) => r.hp < r.max_hp).map((r) => r.name);
    if (notFullHp.length || npcNotFull.length) {
      return res.status(400).json({
        error: `Recuerda que todos deben estar con la vida al máximo antes de entrar a la Torre. (${[...notFullHp, ...npcNotFull].join(', ')} no está${notFullHp.length + npcNotFull.length > 1 ? 'n' : ''} al máximo)`,
      });
    }

    if (await getActiveRun(req.playerId)) {
      return res.status(400).json({ error: 'Ya tienes una corrida de torre en curso' });
    }

    for (const pid of [req.playerId, ...coopPartnerIds]) {
      if (await combatEngine.hasAbandonedActiveSession(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate anterior sin resolver. Esperen a que termine.' });
      }
      if (await combatEngine.hasActiveCombatSession(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate sin terminar. Termínenlo antes de entrar a la Torre.' });
      }
      if (await getActiveRun(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero ya tiene una corrida de torre en curso' });
      }
    }

    if (coopPartnerIds.length) {
      const allPlayerIds = [req.playerId, ...coopPartnerIds];
      const groupCheck = await db.query(
        `SELECT gm.group_id FROM player_coop_group_members gm
         WHERE gm.player_id = ANY($1::int[])
         GROUP BY gm.group_id
         HAVING COUNT(DISTINCT gm.player_id) = $2`,
        [allPlayerIds, allPlayerIds.length]
      );
      if (!groupCheck.rows.length) {
        return res.status(403).json({ error: 'No estás en el mismo grupo co-op que esos jugadores' });
      }
    }

    const runResult = await db.query(
      `INSERT INTO player_tower_runs(player_id, guest_player_id, guest_player_id_2, difficulty, current_floor, current_room, coins_earned, status)
       VALUES ($1,$2,$3,$4,1,1,0,'IN_PROGRESS') RETURNING *`,
      [req.playerId, coopPartnerIds[0] ?? null, coopPartnerIds[1] ?? null, difficulty]
    );
    const run = runResult.rows[0];

    await combatEngine.buildTowerRoom(run, 1, 1);

    const updatedRun = (await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id])).rows[0];
    const session = await combatEngine.fetchSessionState(updatedRun.current_session_id);
    res.status(201).json({ run: updatedRun, session });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/run — estado de la corrida activa
router.get('/run', async (req, res, next) => {
  try {
    const run = await getActiveRun(req.playerId);
    if (!run) return res.json({ run: null });

    const floorRow = await getFloor(run.current_floor);
    const session = run.current_session_id ? await combatEngine.fetchSessionState(run.current_session_id) : null;
    const canControl = await canControlRun(run, req.playerId);
    res.json({ run, floor: floorRow, session, canControl });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/advance — banca la moneda del piso y arma el siguiente
router.post('/advance', async (req, res, next) => {
  try {
    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!(await canControlRun(run, req.playerId))) {
      return res.status(403).json({ error: 'Solo quien tiene el control de la corrida (el líder, o alguien vivo si el líder murió) puede decidir esto.' });
    }
    if (run.current_session_id) {
      return res.status(400).json({ error: 'Todavía hay una sala en curso' });
    }

    const nextFloor = run.current_floor + 1;
    if (!(await getFloor(nextFloor))) {
      return res.status(500).json({ error: `Piso ${nextFloor} no configurado` });
    }

    await combatEngine.buildTowerRoom(run, nextFloor, 1);

    const updatedRun = (await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id])).rows[0];
    const session = await combatEngine.fetchSessionState(updatedRun.current_session_id);
    res.json({ run: updatedRun, session });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/extract — cierra la corrida y acredita dungeon_coins
router.post('/extract', async (req, res, next) => {
  try {
    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!(await canControlRun(run, req.playerId))) {
      return res.status(403).json({ error: 'Solo quien tiene el control de la corrida (el líder, o alguien vivo si el líder murió) puede decidir esto.' });
    }
    if (run.current_session_id) {
      return res.status(400).json({ error: 'Todavía hay una sala en curso' });
    }

    await db.query(
      `UPDATE player_tower_runs SET status = 'EXTRACTED', ended_at = now() WHERE id = $1`,
      [run.id]
    );

    // Acreditar dungeon_coins al jugador principal (y a los guests si los hay)
    const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
    const coinsEach = run.coins_earned;
    for (const pid of allPlayerIds) {
      await db.query('UPDATE players SET dungeon_coins = dungeon_coins + $1 WHERE id = $2', [coinsEach, pid]);
      await incrementCounter(pid, 'MAZMORRAS_EXPLORADAS');
    }

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [run.player_id]);
    res.json({
      extracted: true,
      coinsEarned: coinsEach,
      floorReached: run.current_floor,
      dungeon_coins: playerRes.rows[0].dungeon_coins,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/vendor — catálogo del vendedor de la torre
router.get('/vendor', async (req, res, next) => {
  try {
    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });

    const shopRes = await db.query(
      `SELECT tvs.id, tvs.price, i.id AS item_id, i.code, i.name, i.description, i.item_type, i.rarity
       FROM tower_vendor_shop tvs
       JOIN items i ON i.id = tvs.item_id
       ORDER BY tvs.price`
    );

    res.json({
      dungeon_coins: playerRes.rows[0].dungeon_coins,
      shop: shopRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/vendor/buy   body: { itemId, quantity? }
router.post('/vendor/buy', async (req, res, next) => {
  try {
    const itemId = Number(req.body?.itemId);
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);
    if (!itemId) return res.status(400).json({ error: 'itemId requerido' });

    const shopRes = await db.query('SELECT price FROM tower_vendor_shop WHERE item_id = $1', [itemId]);
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Ítem no disponible en el vendedor de la torre' });

    const totalCost = shopRes.rows[0].price * quantity;

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (playerRes.rows[0].dungeon_coins < totalCost) {
      return res.status(400).json({ error: `Monedas insuficientes (necesitas ${totalCost}, tienes ${playerRes.rows[0].dungeon_coins})` });
    }

    await db.query('UPDATE players SET dungeon_coins = dungeon_coins - $1 WHERE id = $2', [totalCost, req.playerId]);
    await inventory.addItem(req.playerId, itemId, quantity);

    const newCoins = (await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId])).rows[0].dungeon_coins;
    const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    res.json({
      bought: true,
      item: itemRes.rows[0].name,
      quantity,
      cost: totalCost,
      dungeon_coins: newCoins,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
