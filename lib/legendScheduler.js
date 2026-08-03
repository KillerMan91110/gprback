// lib/legendScheduler.js
// "Leyendas": 5 personajes jugables (uno por clase base, players.is_bot = TRUE) controlados por el
// sistema en vez de por una persona -- juegan solas de a poco (curan, evento del día, misiones,
// craftean/encantan/equipan, incuban huevos, evolucionan, exploran y pelean usando skills) para ir
// subiendo de nivel con el tiempo real, como si fueran jugadores normales. No hay superficie nueva
// para verlas: al ser filas normales de `players`, ya aparecen solas en /api/leaderboard y
// /api/leaderboard/wealth. server.js llama a tickLegendSchedule() cada LEGEND_TICK_INTERVAL_MS.
//
// Cada tick hace COMO MUCHO una tarea por leyenda (la primera que aplique, en orden de prioridad),
// nunca todo junto -- así cada corrida es simple, barata y si algo falla no arrastra al resto de
// tareas. La mayoría de las tareas se resuelven invocando los mismos handlers de Express que ya usa
// el front (extraídos de router.stack y llamados directo, sin pasar por HTTP/auth, mismo patrón que
// los scripts de prueba de esta sesión) en vez de duplicar su lógica de validación.

const db = require('../db/db');
const combatEngine = require('../routes/combat');
const evolution = require('./evolution');
const inventory = require('./inventory');
const playersRouter = require('../routes/players');
const petsRouter = require('../routes/pets');
const dailyEventRouter = require('../routes/dailyEvent');

const LEGEND_TICK_INTERVAL_MS = 5 * 60 * 1000; // ~5 min por leyenda
const CRITICAL_HP_RATIO = 0.3;
const MAX_FIGHT_ACTIONS = 90; // hasta 3 acciones/ronda (heroe + 2 npcs) x ~30 rondas
const MAX_ESCAPE_ATTEMPTS = 10;

const EGG_CODES_BY_RARITY_DESC = ['HUEVO_LEGENDARIO', 'HUEVO_EPICO', 'HUEVO_RARO', 'HUEVO_POCO_COMUN', 'HUEVO_COMUN'];

// ---------- Invocar handlers de Express directo, sin pasar por HTTP/middleware de auth ----------
function findHandler(router, method, path) {
  for (const layer of router.stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  throw new Error(`legendScheduler: handler no encontrado ${method} ${path}`);
}
function makeRes() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; } };
}
async function callRoute(handler, playerId, { params = {}, body = {} } = {}) {
  const req = { params: { playerId: String(playerId), ...params }, playerId, body, app: { get: () => null } };
  const res = makeRes();
  let error = null;
  await handler(req, res, (e) => { error = e; });
  return { status: res.statusCode, body: res.body, error };
}

const H = {
  useItem: findHandler(playersRouter, 'post', '/:playerId/use-item'),
  guildHeal: findHandler(playersRouter, 'post', '/:playerId/guild/heal'),
  partyPool: findHandler(playersRouter, 'get', '/:playerId/party/pool'),
  partyHire: findHandler(playersRouter, 'post', '/:playerId/party/hire/:poolNpcId'),
  dailyRewardClaim: findHandler(playersRouter, 'post', '/:playerId/daily-reward/claim'),
  learnSkill: findHandler(playersRouter, 'post', '/:playerId/guild/learn-skill'),
  questsAvailable: findHandler(playersRouter, 'get', '/:playerId/quests/available'),
  questsActive: findHandler(playersRouter, 'get', '/:playerId/quests/active'),
  questAccept: findHandler(playersRouter, 'post', '/:playerId/quests/:questId/accept'),
  questComplete: findHandler(playersRouter, 'post', '/:playerId/quests/:questId/complete'),
  craft: findHandler(playersRouter, 'post', '/:playerId/craft'),
  enchantInfo: findHandler(playersRouter, 'get', '/:playerId/enchant/info'),
  enchant: findHandler(playersRouter, 'post', '/:playerId/enchant'),
  equip: findHandler(playersRouter, 'post', '/:playerId/equip'),
  incubatorGet: findHandler(petsRouter, 'get', '/incubator'),
  incubatorPost: findHandler(petsRouter, 'post', '/incubator'),
  incubatorClaim: findHandler(petsRouter, 'post', '/incubator/claim'),
  petActivate: findHandler(petsRouter, 'post', '/:playerPetId/activate'),
  dailyEventGet: findHandler(dailyEventRouter, 'get', '/'),
  dailyEventEnter: findHandler(dailyEventRouter, 'post', '/enter'),
  explore: findHandler(combatEngine, 'post', '/zones/:zoneId/explore'),
  action: findHandler(combatEngine, 'post', '/sessions/:id/action'),
};

// ---------- Heurística de "¿este equipo es mejor?" (no existe en el resto del código, ver spec
// docs/backend-... de las leyendas) -- puntaje simple ponderado por stat, ajustado por
// calidad/encantamiento. No busca ser óptimo por clase, solo "mejor en general". ----------
const STAT_WEIGHT = {
  ATK: 1, MAG: 1, DEF: 0.5, MAGIC_DEF: 0.5, SPD: 0.3,
  CRIT_CHANCE: 2, CRIT_DAMAGE: 1, EVASION: 1, HP: 0.1, LUCK: 1,
};
const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];

async function scoreItem(itemId, enchantLevel = 0, qualityTier = 0) {
  const bonuses = await db.query('SELECT stat_code, amount FROM item_stat_bonuses WHERE item_id = $1', [itemId]);
  let score = 0;
  for (const b of bonuses.rows) score += Number(b.amount) * (STAT_WEIGHT[b.stat_code] || 0);
  score *= QUALITY_TIER_MULTIPLIER[qualityTier] ?? 1;
  score *= 1 + Number(enchantLevel) * 0.05;
  return score;
}

async function scoreEquippedSlot(playerId, slot) {
  const row = (await db.query(
    'SELECT item_id, enchant_level, quality_tier FROM player_equipment WHERE player_id = $1 AND slot = $2',
    [playerId, slot]
  )).rows[0];
  if (!row) return 0;
  return scoreItem(row.item_id, row.enchant_level, row.quality_tier);
}

// ---------- Contexto básico del tick ----------
async function getLegendContext(playerId) {
  const row = await db.query(
    `SELECT id, level, hp, max_hp, mana, max_mana, gold, current_class_id, evolution_class_id
     FROM players WHERE id = $1`,
    [playerId]
  );
  return row.rows[0] || null;
}

// ---------- 1) Curarse (crítico o muerta, héroe o cualquier NPC del grupo) ----------
// IMPORTANTE: guild/heal se llama SIN heroOnly -- el modo "greedy" (héroe primero, después los
// NPCs por slot) es el único que también revive/cura a los NPCs. Con heroOnly=true un NPC que
// llegara a 0 HP en una pelea se quedaba muerto para siempre (hydratePartyNpcs excluye a los NPCs
// con hp<=0 de toda pelea futura), degradando al grupo entero de vuelta a "el héroe solo" sin
// que nada lo notara ni lo arreglara -- confirmado en producción: los 10 NPCs de las 5 leyendas
// terminaron en hp=0 por este mismo motivo.
async function tryHeal(playerId, ctx) {
  const potion = (await db.query(
    `SELECT pi.item_id FROM player_inventory pi
     JOIN item_stat_bonuses isb ON isb.item_id = pi.item_id AND isb.stat_code = 'HEAL_HP'
     WHERE pi.player_id = $1 AND pi.quantity > 0
     ORDER BY isb.amount DESC LIMIT 1`,
    [playerId]
  )).rows[0];
  if (potion) {
    const r = await callRoute(H.useItem, playerId, { body: { itemId: potion.item_id } });
    if (r.status < 400) return true;
  }
  if (Number(ctx.gold) >= 1) {
    const r = await callRoute(H.guildHeal, playerId, { body: {} });
    if (r.status < 400) return true;
  }
  return false;
}

// ¿Hace falta curar? No alcanza con mirar al héroe -- un NPC caído en 0 HP también necesita
// guild/heal para poder volver a pelear, y si nadie lo detecta se queda muerto para siempre.
async function partyNeedsHealing(playerId, ctx) {
  if (Number(ctx.hp) <= 0 || Number(ctx.hp) / Number(ctx.max_hp) < CRITICAL_HP_RATIO) return true;
  const npcs = await db.query(
    `SELECT pn.hp, pn.max_hp FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = $1`,
    [playerId]
  );
  return npcs.rows.some((n) => Number(n.hp) <= 0 || Number(n.hp) / Number(n.max_hp) < CRITICAL_HP_RATIO);
}

// ---------- 2) Huevo: reclamar si está listo, o meter uno nuevo a incubar ----------
async function maybeEquipBetterPet(playerId, newPlayerPetId) {
  const pets = (await db.query(
    `SELECT pp.id, pp.is_active,
            COALESCE(SUM(pb.base_amount + pb.per_level_amount * (pp.level - 1)), 0) AS score
     FROM player_pets pp LEFT JOIN pet_bonuses pb ON pb.pet_id = pp.pet_id
     WHERE pp.player_id = $1
     GROUP BY pp.id`,
    [playerId]
  )).rows;
  const current = pets.find((p) => p.is_active);
  const candidate = pets.find((p) => p.id === newPlayerPetId);
  if (!candidate) return;
  if (!current || Number(candidate.score) > Number(current.score)) {
    await callRoute(H.petActivate, playerId, { params: { playerPetId: candidate.id } });
  }
}

async function tryPetTasks(playerId) {
  const inc = await callRoute(H.incubatorGet, playerId);
  if (inc.body && inc.body.ready) {
    const claim = await callRoute(H.incubatorClaim, playerId);
    if (claim.status < 400 && claim.body?.id) await maybeEquipBetterPet(playerId, claim.body.id);
    return true;
  }
  if (!inc.body) {
    const egg = (await db.query(
      `SELECT pi.item_id, i.code FROM player_inventory pi JOIN items i ON i.id = pi.item_id
       WHERE pi.player_id = $1 AND i.code = ANY($2::text[]) AND pi.quantity > 0
       ORDER BY array_position($2::text[], i.code) LIMIT 1`,
      [playerId, EGG_CODES_BY_RARITY_DESC]
    )).rows[0];
    if (egg) {
      const r = await callRoute(H.incubatorPost, playerId, { body: { itemId: egg.item_id } });
      return r.status < 400;
    }
  }
  return false;
}

// ---------- 2.5) Reclutar NPC para el grupo (si hay slot libre y le alcanza el oro) ----------
// No lo pidió explícitamente el usuario, pero salió necesario en la práctica: una leyenda
// completamente sola (sin party) pierde peleas de zona 1 con normalidad -- el sistema de
// party/NPCs ya existe para exactamente esto (cualquier jugador real lo usa), no reinventar nada
// nuevo, solo usarlo. Se queda con el NPC mas caro que pueda pagar como proxy simple de "el mejor".
const PARTY_MAX_NPC_SLOTS = 2;

async function tryRecruitNpc(playerId, ctx) {
  const activeCount = (await db.query('SELECT COUNT(*) FROM player_party WHERE player_id = $1', [playerId])).rows[0].count;
  if (Number(activeCount) >= PARTY_MAX_NPC_SLOTS) return false;

  const pool = await callRoute(H.partyPool, playerId);
  const npcs = pool.body?.npcs;
  if (!Array.isArray(npcs) || !npcs.length) return false;

  const affordable = npcs.filter((n) => Number(n.hireCost) <= Number(ctx.gold)).sort((a, b) => b.hireCost - a.hireCost)[0];
  if (!affordable) return false;

  const r = await callRoute(H.partyHire, playerId, { params: { poolNpcId: String(affordable.poolNpcId) } });
  return r.status < 400;
}

// ---------- 3) Evolucionar (primera opción elegible, sin política de personalidad) ----------
async function tryEvolve(playerId) {
  const data = await evolution.getAvailableEvolutions(playerId);
  if (!data) return false;
  const pick = data.evolutions.find((e) => e.canEvolve);
  if (!pick) return false;
  const result = await evolution.evolvePlayer(playerId, pick.evolutionId);
  return !result.error;
}

// ---------- 4) Recompensa diaria ----------
async function tryDailyReward(playerId) {
  const r = await callRoute(H.dailyRewardClaim, playerId);
  return r.status < 400;
}

// ---------- 5) Evento del Día ----------
// Tier JEFE (2.8x stats) escala al nivel de quien entra, pero puede seguir siendo una pelea
// perdida de verdad para un nivel muy bajo (confirmado con la propia leyenda Arquero: 4 derrotas
// seguidas contra un Demonio de Lava · Jefe Corrupto, gastando oro en curarse entre intento e
// intento sin ganar nunca xp/oro real) -- una leyenda recién creada no debería apostar sus 5
// intentos diarios ahí. MINI_JEFE/ELITE sí se dejan intentar (ya probado en esta sesión que son
// "duro pero justo" incluso a nivel 1, no una derrota garantizada).
const DAILY_EVENT_JEFE_MIN_LEVEL = 15;

async function tryDailyEvent(playerId, ctx) {
  const info = await callRoute(H.dailyEventGet, playerId);
  if (!info.body || !info.body.canEnter) return false;
  if (info.body.forcedRarity === 'JEFE' && ctx.level < DAILY_EVENT_JEFE_MIN_LEVEL) return false;
  if (!(await hasAttackSkill(playerId, ctx))) return false;
  const enter = await callRoute(H.dailyEventEnter, playerId, { body: {} });
  if (enter.status >= 400 || !enter.body?.session) return false;
  await playOutCombat(playerId, enter.body.session.id);
  return true;
}

// ---------- 6) Aprender skill (oro o misión ya cumplida) ----------
async function tryLearnSkill(playerId, ctx) {
  const classChain = await evolution.getClassAncestorChain(ctx.evolution_class_id || ctx.current_class_id);
  const candidates = (await db.query(
    `SELECT s.id FROM skills s
     WHERE s.class_id = ANY($1::int[])
       AND s.learn_method IN ('GOLD', 'QUEST')
       AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $2 AND ps.skill_id = s.id)
     ORDER BY s.learn_level NULLS LAST, s.id`,
    [classChain, playerId]
  )).rows;
  for (const c of candidates) {
    const r = await callRoute(H.learnSkill, playerId, { body: { skillId: c.id } });
    if (r.status < 400) return true;
  }
  return false;
}

// ---------- 7) Misiones: completar una activa lista, o aceptar una nueva ----------
async function tryQuests(playerId) {
  const active = await callRoute(H.questsActive, playerId);
  if (Array.isArray(active.body)) {
    for (const quest of active.body) {
      const r = await callRoute(H.questComplete, playerId, { params: { questId: String(quest.id) } });
      if (r.status < 400) return true;
    }
  }
  const available = await callRoute(H.questsAvailable, playerId);
  if (Array.isArray(available.body) && available.body.length) {
    const r = await callRoute(H.questAccept, playerId, { params: { questId: String(available.body[0].id) } });
    if (r.status < 400) return true;
  }
  return false;
}

// ---------- 8) Craftear una mejora de equipo de su clase, y ponérsela ----------
async function tryCraftUpgrade(playerId, ctx) {
  const classChain = await evolution.getClassAncestorChain(ctx.evolution_class_id || ctx.current_class_id);
  const candidates = (await db.query(
    `SELECT cr.id AS recipe_id, cr.code, cr.result_item_id, i.slot
     FROM crafting_recipes cr JOIN items i ON i.id = cr.result_item_id
     WHERE i.item_type = 'EQUIPMENT' AND i.slot IS NOT NULL
       AND (i.class_id IS NULL OR i.class_id = ANY($1::int[]))
       AND (i.required_level IS NULL OR i.required_level <= $2)
       AND (cr.zone_id IS NULL OR cr.zone_id IN (SELECT zone_id FROM player_zone_unlocks WHERE player_id = $3))
       AND (cr.scroll_item_id IS NULL OR EXISTS (SELECT 1 FROM player_learned_recipes plr WHERE plr.player_id = $3 AND plr.recipe_id = cr.id))`,
    [classChain, ctx.level, playerId]
  )).rows;

  for (const c of candidates) {
    const ingredients = (await db.query(
      'SELECT item_id, quantity FROM crafting_recipe_ingredients WHERE recipe_id = $1',
      [c.recipe_id]
    )).rows;
    let canCraft = true;
    for (const ing of ingredients) {
      const have = await inventory.getQuantity(playerId, ing.item_id);
      if (have < ing.quantity) { canCraft = false; break; }
    }
    if (!canCraft) continue;

    const newScore = await scoreItem(c.result_item_id, 0, 0);
    const currentScore = await scoreEquippedSlot(playerId, c.slot);
    if (newScore <= currentScore) continue;

    const craftRes = await callRoute(H.craft, playerId, { body: { recipeCode: c.code, quantity: 1 } });
    if (craftRes.status >= 400) continue;

    const bestTier = (await inventory.getBestQualityTier(playerId, c.result_item_id, 0)) ?? 0;
    await callRoute(H.equip, playerId, { body: { itemId: c.result_item_id, enchantLevel: 0, qualityTier: bestTier } });
    return true;
  }
  return false;
}

// ---------- 9) Encantar equipo puesto (si alcanza el oro/piedras) ----------
async function tryEnchant(playerId) {
  const info = await callRoute(H.enchantInfo, playerId);
  if (!Array.isArray(info.body)) return false;
  for (const slotInfo of info.body) {
    if (!slotInfo.nextCost) continue;
    const r = await callRoute(H.enchant, playerId, { body: { slot: slotInfo.slot, useCrystal: true } });
    if (r.status < 400) return true;
  }
  return false;
}

// ---------- 10) Explorar y pelear (tarea por defecto) ----------
async function pickZoneForLevel(level) {
  const row = (await db.query(
    `SELECT id FROM monster_zones WHERE is_tower_zone = FALSE AND min_level <= $1 ORDER BY min_level DESC LIMIT 1`,
    [level]
  )).rows[0];
  return row ? row.id : 1;
}

// Si la clase todavía no tiene NINGUNA skill de tipo ATAQUE disponible (aprendida o desbloqueada
// por nivel), depende del golpe básico nomás -- mucho más débil (ver Sacerdote: su única ATAQUE,
// "Rayo Sagrado", recién se aprende en nivel 8). Se usa para no arriesgar al Evento del Día en ese
// caso, no para bloquear el combate en general (misiones/exploración ya siguen andando).
async function hasAttackSkill(playerId, ctx) {
  const classChain = await evolution.getClassAncestorChain(ctx.evolution_class_id || ctx.current_class_id);
  const rows = await db.query(
    `SELECT 1 FROM skills s
     WHERE s.skill_type = 'ATAQUE' AND s.is_passive = FALSE
       AND (s.class_id IS NULL OR s.class_id = ANY($1::int[]))
       AND ((s.learn_method = 'LEVEL' AND s.learn_level <= $2)
            OR EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $3 AND ps.skill_id = s.id))
     LIMIT 1`,
    [classChain, ctx.level, playerId]
  );
  return rows.rows.length > 0;
}

async function bestUsableSkill(playerId, actor, skillType) {
  if (!actor.class_id) return null;
  const classChain = await evolution.getClassAncestorChain(actor.class_id);
  const rows = (await db.query(
    `SELECT s.id, s.mana_cost FROM skills s
     WHERE s.skill_type = $1 AND s.is_passive = FALSE
       AND (s.class_id IS NULL OR s.class_id = ANY($2::int[]))
       AND ((s.learn_method = 'LEVEL' AND s.learn_level <= (SELECT level FROM players WHERE id = $3))
            OR EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $3 AND ps.skill_id = s.id))
     ORDER BY s.mana_cost DESC`,
    [skillType, classChain, playerId]
  )).rows;
  return rows.find((r) => Number(actor.mana) >= Number(r.mana_cost)) || null;
}

// Decide la accion del turno: se cura si esta baja de HP y tiene con que; si esta muy mal (<25%)
// y no se puede curar, mejor escapar (no siempre sale, ver combat.escapeChance, pero un intento
// fallido cuesta lo mismo que igual seguir atacando) que seguir peleando a muerte -- salvo que el
// enemigo mas debil tambien este casi muerto, ahi vale la pena arriesgar el ultimo golpe en vez de
// huir de una pelea que ya estaba prácticamente ganada. ESCAPE solo lo puede pedir el héroe (nunca
// un NPC del grupo, el motor lo rechaza con 400 "Solo el héroe puede intentar escapar") -- un NPC
// bajo de HP simplemente sigue atacando/curando, no puede sacar a todo el grupo del combate por su
// cuenta. Si no aplica nada de lo anterior, ataca con la skill mas cara que le alcance la mana
// (proxy simple de "mas fuerte"), o basico si no tiene ninguna.
async function decideCombatAction(playerId, actor, enemies) {
  const hpRatio = Number(actor.hp) / Number(actor.max_hp);
  if (hpRatio < 0.4) {
    const healSkill = await bestUsableSkill(playerId, actor, 'CURACION');
    if (healSkill) return { participantId: actor.id, action: 'SKILL', skillId: healSkill.id };
  }
  if (actor.player_id === playerId && hpRatio < 0.25 && enemies.length) {
    const weakestEnemyRatio = Math.min(...enemies.map((e) => Number(e.hp) / Number(e.max_hp)));
    if (weakestEnemyRatio > 0.15) return { participantId: actor.id, action: 'ESCAPE' };
  }
  const atkSkill = await bestUsableSkill(playerId, actor, 'ATAQUE');
  if (atkSkill) return { participantId: actor.id, action: 'SKILL', skillId: atkSkill.id };
  return { participantId: actor.id, action: 'ATTACK' };
}

// Compartido por explorar y por el Evento del Día: juega turno a turno hasta que la sesión
// resuelva. Si un SKILL falla (maná/cooldown corridos entre la decisión y el intento), reintenta
// ese mismo turno con un ataque básico antes de rendirse. MAX_FIGHT_ACTIONS cuenta ACCIONES
// individuales, no rondas completas -- con hasta 2 NPCs en el grupo, cada ronda son hasta 3
// acciones del lado del jugador, así que hace falta más margen que con un héroe solo. Si aun así
// la sesión sigue IN_PROGRESS al terminar, intenta escapar en varias vueltas más (solo funciona
// cuando le toca el turno al héroe -- ver decideCombatAction) para no dejar
// player_active_combat_session trabada.
async function playOutCombat(playerId, sessionId) {
  let guard = 0;
  while (guard++ < MAX_FIGHT_ACTIONS) {
    const sess = (await db.query('SELECT status FROM combat_sessions WHERE id = $1', [sessionId])).rows[0];
    if (!sess || sess.status !== 'IN_PROGRESS') return;

    // GET /sessions/:id llama advanceEnemyTurns antes de leer el estado (así el front "empuja" el
    // turno enemigo con cada poll) -- fetchSessionState solo, sin esto, puede devolver
    // nextActorId=null en fights con varios enemigos donde el motor procesa uno por vez.
    await combatEngine.advanceEnemyTurns(sessionId);
    const state = await combatEngine.fetchSessionState(sessionId);
    if (!state || !state.nextActorId) break;
    const actor = state.participants.find((p) => p.id === state.nextActorId);
    if (!actor) break;
    const aliveEnemies = state.participants.filter((p) => p.side === 'ENEMY' && p.hp > 0);
    if (!aliveEnemies.length) break;

    const action = await decideCombatAction(playerId, actor, aliveEnemies);
    let r = await callRoute(H.action, playerId, { params: { id: String(sessionId) }, body: action });
    if (r.status >= 400 && action.action === 'SKILL') {
      r = await callRoute(H.action, playerId, { params: { id: String(sessionId) }, body: { participantId: actor.id, action: 'ATTACK' } });
    }
    if (r.status >= 400) break;
  }

  // No se resolvió sola en MAX_FIGHT_ACTIONS (no debería pasar) -- forzar la salida escapando,
  // pero ESCAPE solo lo puede pedir el héroe cuando es SU turno (nunca un NPC). Si el turno que
  // sigue es de un NPC, lo deja atacar normal nomás para que la ronda avance hasta que le toque
  // al héroe, y ahí sí intenta escapar (puede fallar por chance, reintenta las vueltas que hagan
  // falta dentro del límite).
  let escapeGuard = 0;
  while (escapeGuard++ < MAX_ESCAPE_ATTEMPTS) {
    const sess = (await db.query('SELECT status FROM combat_sessions WHERE id = $1', [sessionId])).rows[0];
    if (!sess || sess.status !== 'IN_PROGRESS') return;

    await combatEngine.advanceEnemyTurns(sessionId);
    const state = await combatEngine.fetchSessionState(sessionId);
    if (!state || !state.nextActorId) break;
    const actor = state.participants.find((p) => p.id === state.nextActorId);
    if (!actor) break;

    const body = actor.player_id === playerId
      ? { participantId: actor.id, action: 'ESCAPE' }
      : { participantId: actor.id, action: 'ATTACK' };
    const r = await callRoute(H.action, playerId, { params: { id: String(sessionId) }, body });
    if (r.status >= 400 && body.action !== 'ESCAPE') break;
  }
}

async function exploreAndFight(playerId, ctx) {
  const zoneId = await pickZoneForLevel(ctx.level);
  const enter = await callRoute(H.explore, playerId, { params: { zoneId: String(zoneId) }, body: {} });
  if (enter.status >= 400 || !enter.body?.session) return false;
  await playOutCombat(playerId, enter.body.session.id);
  return true;
}

// Si un tick anterior se cortó a la mitad de un combate (ej. una caída de red, ya pasó en esta
// sesión de trabajo dos veces), la sesión queda IN_PROGRESS para siempre y
// hasActiveCombatSession() bloquea a la leyenda en TODOS los ticks futuros -- processLegendTick
// nunca vuelve a hacer nada por ella. Ninguna pelea real tarda cerca de STALE_SESSION_MINUTES, así
// que una sesión que lleva ese tiempo sin tocarse es sin duda una huérfana, no una en curso.
const STALE_SESSION_MINUTES = 10;

async function recoverStaleSession(playerId) {
  const stale = await db.query(
    `SELECT cs.id FROM combat_sessions cs
     JOIN player_active_combat_session pacs ON pacs.session_id = cs.id AND pacs.player_id = $1
     WHERE cs.status = 'IN_PROGRESS' AND cs.updated_at < now() - interval '${STALE_SESSION_MINUTES} minutes'`,
    [playerId]
  );
  if (!stale.rows.length) return;
  await db.query(
    `UPDATE combat_sessions SET status = 'ESCAPED', updated_at = now() WHERE id = ANY($1::int[])`,
    [stale.rows.map((r) => r.id)]
  );
  await db.query('DELETE FROM player_active_combat_session WHERE player_id = $1', [playerId]);
}

// ---------- Tick por leyenda: una sola tarea, la primera que aplique en orden de prioridad ----------
async function processLegendTick(playerId) {
  await recoverStaleSession(playerId);
  if (await combatEngine.hasActiveCombatSession(playerId)) return;
  if (await combatEngine.hasAbandonedActiveSession(playerId)) return;

  const ctx = await getLegendContext(playerId);
  if (!ctx) return;

  // Si el héroe o cualquier NPC del grupo esta critico, intenta curar al grupo entero y listo por
  // este tick. Pero si NO se pudo curar (sin oro ni pociones -- puede pasar tras una mala racha),
  // no cortar del todo: nada más abajo de acá arriesga otra pelea salvo daily-event/explorar (esos
  // sí quedan bloqueados si el HÉROE especificamente esta critico), así que igual puede reclamar
  // recompensa diaria, aceptar/completar misión, craftear, etc. -- caminos reales para juntar oro
  // y curarse en un tick futuro en vez de quedar trabada para siempre.
  const heroCritical = Number(ctx.hp) <= 0 || Number(ctx.hp) / Number(ctx.max_hp) < CRITICAL_HP_RATIO;
  if ((await partyNeedsHealing(playerId, ctx)) && (await tryHeal(playerId, ctx))) return;

  if (await tryPetTasks(playerId)) return;
  if (await tryRecruitNpc(playerId, ctx)) return;
  if (await tryEvolve(playerId)) return;
  if (await tryDailyReward(playerId)) return;
  if (!heroCritical && (await tryDailyEvent(playerId, ctx))) return;
  if (await tryLearnSkill(playerId, ctx)) return;
  if (await tryQuests(playerId)) return;
  if (await tryCraftUpgrade(playerId, ctx)) return;
  if (await tryEnchant(playerId)) return;
  if (!heroCritical) await exploreAndFight(playerId, ctx);
}

async function tickLegendSchedule() {
  const legends = await db.query('SELECT id FROM players WHERE is_bot = TRUE ORDER BY id');
  for (const row of legends.rows) {
    try {
      await processLegendTick(row.id);
    } catch (err) {
      console.error(`[legendScheduler] error procesando leyenda ${row.id}:`, err.message);
    }
  }
}

module.exports = { tickLegendSchedule, processLegendTick, LEGEND_TICK_INTERVAL_MS };
