// routes/worldboss.js
// World Boss server-wide (docs/backend-spec-world-boss.md): jefe unico con HP compartido entre
// todos los jugadores. Reusa el motor de combate normal (routes/combat.js) para la sub-sesion de
// cada jugador contra un clon escalado a su nivel; el hook que resta danio del HP global y reparte
// fragmentos cosmicos vive en combat.js (finalizeSession -> handleWorldBossFinalize), no aca.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const inventory = require('../lib/inventory');
const combatEngine = require('./combat');

const globalRouter = express.Router();
globalRouter.use(requireAuth);

const playerRouter = express.Router({ mergeParams: true });
playerRouter.use(requireAuth);
playerRouter.use(requireSelf);

function emitCombatUpdate(req, sessionId, state) {
  req.app.get('io')?.to(`combat:${sessionId}`).emit('combat:update', state);
}

// Ready-check de grupo (docs/backend-followup-world-boss-cycle-ready.md sección 3): mismo patrón
// que routes/tower.js (player_tower_ready), tabla separada porque es "por actividad".
const WORLDBOSS_READY_TTL_MS = 15000;

async function getMyGroupId(playerId) {
  const res = await db.query('SELECT gm.group_id FROM player_coop_group_members gm WHERE gm.player_id = $1', [playerId]);
  return res.rows[0]?.group_id ?? null;
}

async function getGroupMemberIds(groupId) {
  const res = await db.query('SELECT player_id FROM player_coop_group_members WHERE group_id = $1', [groupId]);
  return res.rows.map((r) => r.player_id);
}

async function getActiveOrLastEvent() {
  const activeRes = await db.query("SELECT * FROM world_boss_events WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1");
  if (activeRes.rows.length) return activeRes.rows[0];
  const lastRes = await db.query('SELECT * FROM world_boss_events ORDER BY id DESC LIMIT 1');
  return lastRes.rows[0] || null;
}

// Cierre por tiempo (sección 6): chequeo perezoso, se resuelve la primera vez que algo toca el
// evento después de vencido (acá y en /enter), no hace falta un cron dedicado.
async function expireIfNeeded(event) {
  if (!event || event.status !== 'ACTIVE') return event;
  if (new Date(event.ends_at) > new Date()) return event;
  const res = await db.query(
    "UPDATE world_boss_events SET status = 'EXPIRED', closed_at = now() WHERE id = $1 AND status = 'ACTIVE' RETURNING *",
    [event.id]
  );
  return res.rows[0] || event;
}

async function getTop3(eventId) {
  const res = await db.query(
    `SELECT wbd.player_id, p.nickname, wbd.total_damage
     FROM world_boss_damage_log wbd JOIN players p ON p.id = wbd.player_id
     WHERE wbd.event_id = $1 ORDER BY wbd.total_damage DESC LIMIT 3`,
    [eventId]
  );
  return res.rows;
}

// GET /api/worldboss/status
globalRouter.get('/status', async (req, res, next) => {
  try {
    let event = await getActiveOrLastEvent();
    if (!event) return res.json({ active: false, status: null });
    event = await expireIfNeeded(event);
    const top3 = await getTop3(event.id);
    res.json({
      active: event.status === 'ACTIVE',
      status: event.status,
      monsterCode: event.monster_code,
      hpRemaining: event.hp_remaining,
      maxHp: event.max_hp,
      startedAt: event.started_at,
      endsAt: event.ends_at,
      closedAt: event.closed_at,
      killedByPlayerId: event.killed_by_player_id,
      top3,
    });
  } catch (err) { next(err); }
});

// GET /api/worldboss/leaderboard
globalRouter.get('/leaderboard', async (req, res, next) => {
  try {
    const event = await getActiveOrLastEvent();
    if (!event) return res.json({ eventId: null, entries: [] });
    const entries = await db.query(
      `SELECT wbd.player_id, p.nickname, wbd.total_damage, wbd.last_attempt_at
       FROM world_boss_damage_log wbd JOIN players p ON p.id = wbd.player_id
       WHERE wbd.event_id = $1 ORDER BY wbd.total_damage DESC`,
      [event.id]
    );
    res.json({ eventId: event.id, status: event.status, entries: entries.rows });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/worldboss/enter   body: { coopPartnerIds? }
// Mismo flujo que POST /api/combat/sessions (coop de hasta 3 jugadores reales via
// player_coop_group_members), con 3 diferencias: valida nivel mínimo + cooldown de intento,
// arranca el clon con hp_remaining REAL del evento en vez del HP escalado por nivel, y marca la
// sesión con world_boss_event_id para que finalizeSession sepa qué hacer al cerrarse.
playerRouter.post('/enter', async (req, res, next) => {
  try {
    const playerRes = await db.query('SELECT id, level FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerRes.rows[0];
    if (player.level < combatEngine.WORLD_BOSS_MIN_LEVEL_TO_ENTER) {
      return res.status(400).json({ error: `Necesitas nivel ${combatEngine.WORLD_BOSS_MIN_LEVEL_TO_ENTER} para enfrentar al World Boss` });
    }

    let event = await getActiveOrLastEvent();
    if (!event) return res.status(400).json({ error: 'No hay ningún evento de World Boss activo' });
    event = await expireIfNeeded(event);
    if (event.status !== 'ACTIVE') return res.status(400).json({ error: 'El evento de World Boss ya cerró' });

    const cooldownRes = await db.query(
      'SELECT last_attempt_at FROM world_boss_damage_log WHERE event_id = $1 AND player_id = $2',
      [event.id, req.playerId]
    );
    const lastAttempt = cooldownRes.rows[0]?.last_attempt_at;
    if (lastAttempt) {
      const secondsSince = (Date.now() - new Date(lastAttempt).getTime()) / 1000;
      if (secondsSince < combatEngine.WORLD_BOSS_ATTEMPT_COOLDOWN_SECONDS) {
        const wait = Math.ceil(combatEngine.WORLD_BOSS_ATTEMPT_COOLDOWN_SECONDS - secondsSince);
        return res.status(400).json({ error: `Espera ${wait}s antes de volver a intentarlo contra el World Boss` });
      }
    }

    const coopPartnerIds = Array.isArray(req.body?.coopPartnerIds)
      ? [...new Set(req.body.coopPartnerIds.map(Number))].filter((id) => id !== req.playerId)
      : [];
    if (coopPartnerIds.length > 2) return res.status(400).json({ error: 'Máximo 2 compañeros' });
    const allPlayerIds = [req.playerId, ...coopPartnerIds];

    if (coopPartnerIds.length) {
      const groupCheck = await db.query(
        `SELECT gm.group_id FROM player_coop_group_members gm
         WHERE gm.player_id = ANY($1::int[])
         GROUP BY gm.group_id
         HAVING COUNT(DISTINCT gm.player_id) = $2`,
        [allPlayerIds, allPlayerIds.length]
      );
      if (!groupCheck.rows.length) return res.status(403).json({ error: 'No estás en el mismo grupo co-op que esos jugadores' });
    }

    for (const pid of allPlayerIds) {
      if (await combatEngine.hasAbandonedActiveSession(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate anterior sin resolver. Esperen a que termine.' });
      }
      if (await combatEngine.hasActiveCombatSession(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate sin terminar. Termínenlo antes de enfrentar al World Boss.' });
      }
    }

    // Igual que la rama coop de POST /combat/sessions: en coop cada jugador aporta 1 NPC (no 2),
    // para no inflar la formación combinada; en solo lleva su party completa.
    const [allCombatants, ...npcLists] = await Promise.all([
      combatEngine.hydratePlayers(allPlayerIds),
      ...allPlayerIds.map((id) => combatEngine.hydratePartyNpcs(id, id, coopPartnerIds.length ? 1 : null)),
    ]);
    const aliveCombatants = allCombatants.filter((p) => p.hp > 0);
    const aliveNpcs = npcLists.flat().filter((n) => n.hp > 0);
    if (!aliveCombatants.length && !aliveNpcs.length) {
      return res.status(400).json({ error: 'Toda la formación está derrotada.' });
    }

    const enemyCombatants = await combatEngine.hydrateMonsters([{ code: event.monster_code, level: player.level }]);
    if (!enemyCombatants.length) return res.status(500).json({ error: 'No se pudo cargar el World Boss' });

    const sessionResult = await combatEngine.createCombatSessionWithClaim(
      (client) => client.query(
        'INSERT INTO combat_sessions(guest_player_id, guest_player_id_2, world_boss_event_id) VALUES($1,$2,$3) RETURNING *',
        [coopPartnerIds[0] ?? null, coopPartnerIds[1] ?? null, event.id]
      ),
      allPlayerIds
    );
    const sessionId = sessionResult.rows[0].id;

    await combatEngine.insertParticipants(sessionId, [...aliveCombatants, ...aliveNpcs, ...enemyCombatants]);

    // Pisa el HP del clon con el HP REAL que le queda al boss global (sección 3, paso 3) — el
    // HP escalado por nivel que trajo hydrateMonsters se descarta.
    await db.query(
      'UPDATE combat_participants SET hp = $1, max_hp = $1 WHERE session_id = $2 AND monster_code = $3',
      [event.hp_remaining, sessionId, event.monster_code]
    );

    await combatEngine.advanceEnemyTurns(sessionId);

    const state = await combatEngine.fetchSessionState(sessionId);
    emitCombatUpdate(req, sessionId, state);
    res.status(201).json({ ...state, coopPartnerIds });
  } catch (err) {
    if (err.isActiveCombatConflict) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// POST /api/player/:playerId/worldboss/ready
playerRouter.post('/ready', async (req, res, next) => {
  try {
    const groupId = await getMyGroupId(req.playerId);
    if (!groupId) return res.status(400).json({ error: 'No estás en un grupo co-op' });

    await db.query(
      `INSERT INTO player_worldboss_ready(player_id, ready_at) VALUES($1, now())
       ON CONFLICT (player_id) DO UPDATE SET ready_at = now()`,
      [req.playerId]
    );

    const memberIds = await getGroupMemberIds(groupId);
    const readyRows = await db.query(
      `SELECT player_id FROM player_worldboss_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${WORLDBOSS_READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );

    const allReady = readyRows.rows.length === memberIds.length;
    if (!allReady) return res.json({ allReady: false });

    const otherIds = memberIds.filter((id) => id !== req.playerId);
    await db.query('DELETE FROM player_worldboss_ready WHERE player_id = ANY($1::int[])', [memberIds]);
    res.json({ allReady: true, coopPartnerIds: otherIds });
  } catch (err) { next(err); }
});

// DELETE /api/player/:playerId/worldboss/ready
playerRouter.delete('/ready', async (req, res, next) => {
  try {
    await db.query('DELETE FROM player_worldboss_ready WHERE player_id = $1', [req.playerId]);
    res.json({ cancelled: true });
  } catch (err) { next(err); }
});

// GET /api/player/:playerId/worldboss/ready-status
playerRouter.get('/ready-status', async (req, res, next) => {
  try {
    const groupId = await getMyGroupId(req.playerId);
    if (!groupId) return res.json({ inParty: false, members: [] });

    const memberIds = await getGroupMemberIds(groupId);
    const otherIds = memberIds.filter((id) => id !== req.playerId);

    const rows = await db.query(
      `SELECT player_id FROM player_worldboss_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${WORLDBOSS_READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );
    const readyIds = new Set(rows.rows.map((r) => r.player_id));
    const members = otherIds.map((id) => ({ playerId: id, ready: readyIds.has(id) }));
    res.json({ inParty: true, myReady: readyIds.has(req.playerId), members });
  } catch (err) { next(err); }
});

// GET /api/player/:playerId/worldboss/shop
playerRouter.get('/shop', async (req, res, next) => {
  try {
    const playerRes = await db.query('SELECT cosmic_shards FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const shopRes = await db.query(
      `SELECT wbs.id, wbs.price, i.id AS item_id, i.code, i.name, i.description, i.item_type, i.rarity
       FROM world_boss_shop wbs JOIN items i ON i.id = wbs.item_id
       ORDER BY wbs.price`
    );
    res.json({ cosmic_shards: playerRes.rows[0].cosmic_shards, shop: shopRes.rows });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/worldboss/shop/buy   body: { itemId, quantity? }
playerRouter.post('/shop/buy', async (req, res, next) => {
  try {
    const itemId = Number(req.body?.itemId);
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);
    if (!itemId) return res.status(400).json({ error: 'itemId requerido' });

    const shopRes = await db.query('SELECT price FROM world_boss_shop WHERE item_id = $1', [itemId]);
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Ítem no disponible en la tienda del World Boss' });
    const totalCost = shopRes.rows[0].price * quantity;

    const playerRes = await db.query('SELECT cosmic_shards FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (playerRes.rows[0].cosmic_shards < totalCost) {
      return res.status(400).json({ error: `Fragmentos insuficientes (necesitas ${totalCost}, tienes ${playerRes.rows[0].cosmic_shards})` });
    }

    await db.query('UPDATE players SET cosmic_shards = cosmic_shards - $1 WHERE id = $2', [totalCost, req.playerId]);
    await inventory.addItem(req.playerId, itemId, quantity);

    const newShards = (await db.query('SELECT cosmic_shards FROM players WHERE id = $1', [req.playerId])).rows[0].cosmic_shards;
    const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    res.json({ bought: true, item: itemRes.rows[0].name, quantity, cost: totalCost, cosmic_shards: newShards });
  } catch (err) { next(err); }
});

module.exports = { globalRouter, playerRouter };
