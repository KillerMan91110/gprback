// routes/dailyEvent.js
// Evento del Día (docs/backend-spec-evento-del-dia.md): encuentro especial rotativo, igual para
// todos los jugadores el mismo día (rotación determinística por fecha calendario UTC), tope de 5
// entradas por jugador por día. Reusa el motor de combate normal (routes/combat.js) igual que
// World Boss / Torre; la rareza/mutación forzada de la plantilla del día se aplica sin sortear via
// combatEngine.applyForcedRarityAndMutation, y la recompensa fija del catálogo se entrega en
// finalizeSession -> handleDailyEventFinalize (vive en combat.js, no acá).

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const combatEngine = require('./combat');
const dailyEventBonus = require('../lib/dailyEventBonus');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);

const DAILY_EVENT_MAX_ATTEMPTS = 5;

// Referencia fija arbitraria: mismo criterio "por fecha, no ventana rodante" que la recompensa
// diaria, para que la rotación sea determinística y compartida por todos sin guardar estado.
const ROTATION_EPOCH_UTC = Date.UTC(2026, 0, 1);

function todayRotationIndex(templateCount) {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysSinceEpoch = Math.floor((todayUTC - ROTATION_EPOCH_UTC) / 86400000);
  return ((daysSinceEpoch % templateCount) + templateCount) % templateCount;
}

async function getTodayCatalogEntry() {
  const catalogRes = await db.query('SELECT * FROM daily_event_catalog ORDER BY rotation_index');
  if (!catalogRes.rows.length) return null;
  const index = todayRotationIndex(catalogRes.rows.length);
  return catalogRes.rows[index];
}

function emitCombatUpdate(req, sessionId, state) {
  req.app.get('io')?.to(`combat:${sessionId}`).emit('combat:update', state);
}

// GET /api/player/:playerId/daily-event
router.get('/', async (req, res, next) => {
  try {
    const entry = await getTodayCatalogEntry();
    if (!entry) return res.status(500).json({ error: 'No hay plantillas de Evento del Día configuradas' });

    await db.query('INSERT INTO player_daily_event(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.playerId]);
    const stateRes = await db.query(
      `SELECT CASE WHEN last_attempt_date = (now() AT TIME ZONE 'UTC')::date THEN attempts_used ELSE 0 END AS attempts_used
       FROM player_daily_event WHERE player_id = $1`,
      [req.playerId]
    );
    const attemptsUsed = stateRes.rows[0].attempts_used;

    let bonusMaterial = null;
    if (entry.bonus_material_item_code) {
      const itemRes = await db.query('SELECT name FROM items WHERE code = $1', [entry.bonus_material_item_code]);
      bonusMaterial = {
        itemName: itemRes.rows[0]?.name ?? entry.bonus_material_item_code,
        quantity: entry.bonus_material_quantity,
        chancePercent: entry.bonus_material_chance_percent,
      };
    }

    // Preview del XP/oro que da matar al/los monstruo/s en sí (no el bono fijo del catálogo de
    // arriba), calculado exactamente igual que /enter para que coincida con lo que va a pasar de
    // verdad: mismo hydrateMonsters + applyForcedRarityAndMutation, sin sortear nada nuevo. No
    // replica bonos posteriores del pipeline de victoria (rango, logros, xp_rate de clase) — es un
    // preview base, no el número final exacto.
    const playerRes = await db.query('SELECT level FROM players WHERE id = $1', [req.playerId]);
    const previewLevel = playerRes.rows[0]?.level;
    let previewXp = 0;
    let previewGold = 0;
    if (previewLevel) {
      const monsterSpecs = entry.monster_codes.map((code) => ({ code, level: previewLevel }));
      const previewMonsters = await combatEngine.hydrateMonsters(monsterSpecs);
      for (const m of previewMonsters) combatEngine.applyForcedRarityAndMutation(m, entry.forced_rarity, entry.forced_mutation);
      // + bono de nivel bajo (degradé hasta nivel 15, ver lib/dailyEventBonus): sin esto el
      // preview no coincidiría con lo que realmente entrega handleDailyEventFinalize al ganar.
      const bonus = dailyEventBonus.lowLevelBonus(previewLevel);
      previewXp = previewMonsters.reduce((sum, m) => sum + m.xp_reward, 0) + bonus.xp;
      previewGold = previewMonsters.reduce((sum, m) => sum + m.gold_reward, 0) + bonus.gold;
    }

    res.json({
      code: entry.code,
      name: entry.name,
      flavorText: entry.flavor_text,
      forcedRarity: entry.forced_rarity,
      forcedMutation: entry.forced_mutation,
      attemptsUsed,
      attemptsMax: DAILY_EVENT_MAX_ATTEMPTS,
      canEnter: attemptsUsed < DAILY_EVENT_MAX_ATTEMPTS,
      goldReward: entry.gold_reward,
      dungeonCoinsReward: entry.dungeon_coins_reward,
      bonusMaterial,
      previewXp,
      previewGold,
    });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/daily-event/enter   body: { coopPartnerIds? }
router.post('/enter', async (req, res, next) => {
  try {
    const entry = await getTodayCatalogEntry();
    if (!entry) return res.status(500).json({ error: 'No hay plantillas de Evento del Día configuradas' });

    const playerRes = await db.query('SELECT id, level FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerRes.rows[0];

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
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate sin terminar. Termínenlo antes de entrar al Evento del Día.' });
      }
    }

    // Guarda atómica de intentos (mismo patrón que las razas de oro de esta sesión): el WHERE
    // deja pasar si es un día nuevo (resetea a 1) o si sigue siendo hoy y todavía hay intentos
    // libres (attempts_used < 5); si ninguna de las dos se cumple, 0 filas y 400 más abajo, sin
    // que dos entradas casi simultáneas salten el límite.
    await db.query('INSERT INTO player_daily_event(player_id) VALUES ($1) ON CONFLICT DO NOTHING', [req.playerId]);
    const attemptRes = await db.query(
      `UPDATE player_daily_event
       SET attempts_used = CASE WHEN last_attempt_date = (now() AT TIME ZONE 'UTC')::date THEN attempts_used + 1 ELSE 1 END,
           last_attempt_date = (now() AT TIME ZONE 'UTC')::date
       WHERE player_id = $1
         AND (last_attempt_date IS DISTINCT FROM (now() AT TIME ZONE 'UTC')::date OR attempts_used < $2)
       RETURNING attempts_used`,
      [req.playerId, DAILY_EVENT_MAX_ATTEMPTS]
    );
    if (!attemptRes.rows.length) {
      return res.status(400).json({ error: 'Ya usaste tus 5 entradas del Evento del Día de hoy. Volvé mañana.' });
    }

    const [allCombatants, ...npcLists] = await Promise.all([
      combatEngine.hydratePlayers(allPlayerIds),
      ...allPlayerIds.map((id) => combatEngine.hydratePartyNpcs(id, id, coopPartnerIds.length ? 1 : null)),
    ]);
    const aliveCombatants = allCombatants.filter((p) => p.hp > 0);
    const aliveNpcs = npcLists.flat().filter((n) => n.hp > 0);
    if (!aliveCombatants.length && !aliveNpcs.length) {
      return res.status(400).json({ error: 'Toda la formación está derrotada.' });
    }

    const monsterSpecs = entry.monster_codes.map((code) => ({ code, level: player.level }));
    const enemyCombatants = await combatEngine.hydrateMonsters(monsterSpecs);
    if (!enemyCombatants.length) return res.status(500).json({ error: 'No se pudo cargar el Evento del Día' });
    for (const e of enemyCombatants) combatEngine.applyForcedRarityAndMutation(e, entry.forced_rarity, entry.forced_mutation);

    const sessionResult = await combatEngine.createCombatSessionWithClaim(
      (client) => client.query(
        'INSERT INTO combat_sessions(guest_player_id, guest_player_id_2, daily_event_code) VALUES($1,$2,$3) RETURNING *',
        [coopPartnerIds[0] ?? null, coopPartnerIds[1] ?? null, entry.code]
      ),
      allPlayerIds
    );
    const sessionId = sessionResult.rows[0].id;

    await combatEngine.insertParticipants(sessionId, [...aliveCombatants, ...aliveNpcs, ...enemyCombatants]);
    await combatEngine.advanceEnemyTurns(sessionId);

    const state = await combatEngine.fetchSessionState(sessionId);
    emitCombatUpdate(req, sessionId, state);
    res.status(201).json({ ...state, coopPartnerIds, eventName: entry.name });
  } catch (err) {
    if (err.isActiveCombatConflict) return res.status(409).json({ error: err.message });
    next(err);
  }
});

module.exports = router;
