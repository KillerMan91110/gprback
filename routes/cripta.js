// La Cripta del Vigía (ver lib/cripta.js): estado del recorrido, braseros y combates contra los
// guardianes y el jefe. Montado en /api/player/:playerId/world/cripta.
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const cripta = require('../lib/cripta');
const combatEngine = require('./combat');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);

// GET /world/cripta — braseros encendidos, guardianes vencidos, puerta, cofre
router.get('/', async (req, res, next) => {
  try { res.json(await cripta.state(req.playerId)); } catch (err) { next(err); }
});

// POST /world/cripta/brasero { orden }
router.post('/brasero', async (req, res, next) => {
  try {
    const r = await cripta.lightBrazier(req.playerId, Number(req.body?.orden));
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/cripta/combate { objetivo: 'centinela_norte' | … | 'jefe' }
router.post('/combate', async (req, res, next) => {
  try {
    const target = String(req.body?.objetivo ?? '');
    const pr = await db.query('SELECT level FROM players WHERE id = $1', [req.playerId]);
    const level = pr.rows[0]?.level ?? 1;
    const plan = await cripta.prepareFight(req.playerId, target, level);
    if (plan.error) return res.status(400).json({ error: plan.error });
    if (await combatEngine.hasAbandonedActiveSession(req.playerId) || await combatEngine.hasActiveCombatSession(req.playerId)) {
      return res.status(400).json({ error: 'Tienes un combate sin terminar' });
    }
    // los del grupo que estén a tu lado entran contigo (como en la hierba alta)
    const leftOut = [];
    const partners = await combatEngine.worldGroupPartners(req.playerId, leftOut);
    const ids = [req.playerId, ...partners];
    // como mucho 3 por lado: primero los jugadores y, en los puestos que sobren, los compañeros NPC
    const [heroes, ...npcLists] = await Promise.all([
      combatEngine.hydratePlayers(ids),
      ...ids.map((id) => combatEngine.hydratePartyNpcs(id, id, partners.length ? 1 : undefined)),
    ]);
    const aliveHeroes = heroes.filter((p) => p.hp > 0);
    if (!aliveHeroes.some((p) => p.player_id === req.playerId)) return res.status(400).json({ error: 'Estás sin fuerzas: cúrate antes de pelear' });
    const npcs = npcLists.flat().filter((n) => n.hp > 0).slice(0, Math.max(0, 3 - aliveHeroes.length));
    const enemies = await combatEngine.hydrateMonsters(plan.specs);
    if (!enemies.length) return res.status(500).json({ error: 'No se pudo cargar a los guardianes' });
    const sess = await combatEngine.createCombatSessionWithClaim(
      (client) => client.query(
        'INSERT INTO combat_sessions (crypt_target, world_zone, guest_player_id, guest_player_id_2) VALUES ($1, $2, $3, $4) RETURNING *',
        [plan.target, cripta.ZONE_DIR, partners[0] ?? null, partners[1] ?? null]
      ),
      aliveHeroes.map((p) => p.player_id)
    );
    const sessionId = sess.rows[0].id;
    await combatEngine.insertParticipants(sessionId, [...aliveHeroes, ...npcs, ...enemies]);
    if (plan.target === 'jefe') await cripta.initBoss(sessionId);
    await combatEngine.notifyLeftOut(req, leftOut, sessionId).catch(() => {});
    await combatEngine.advanceEnemyTurns(sessionId);
    const state = await combatEngine.fetchSessionState(sessionId);
    const io = req.app.get('io');
    io?.to(`combat:${sessionId}`).emit('combat:update', state);
    // los del grupo entran al mismo combate al instante (igual que en la hierba alta)
    if (partners.length) {
      const who = await db.query('SELECT nickname FROM players WHERE id = $1', [req.playerId]);
      for (const pid of partners) io?.to(`player:${pid}`).emit('coop:battle', { sessionId, zoneId: 1, leaderId: req.playerId, leaderName: who.rows[0]?.nickname });
    }
    res.status(201).json({ ...state, crypt: { target: plan.target } });
  } catch (err) {
    if (err.isActiveCombatConflict) return res.status(409).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
