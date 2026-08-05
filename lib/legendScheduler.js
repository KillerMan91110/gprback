// lib/legendScheduler.js
// "Leyendas": 5 personajes jugables (uno por clase base, players.is_bot = TRUE) controlados por el
// sistema en vez de por una persona -- juegan solas de a poco (curan, evento del día, misiones,
// craftean/encantan/equipan, incuban huevos, evolucionan, exploran y pelean usando skills) para ir
// subiendo de nivel con el tiempo real, como si fueran jugadores normales. No hay superficie nueva
// para verlas: al ser filas normales de `players`, ya aparecen solas en /api/leaderboard y
// /api/leaderboard/wealth. server.js llama a startLegendSchedule() una sola vez al arrancar --
// cada leyenda corre su propio bucle independiente (tick -> esperar LEGEND_TICK_WAIT_MS -> tick
// de nuevo...), no un setInterval compartido. Se reagenda recién cuando su tick anterior terminó
// del todo, así que una misma leyenda nunca se puede solapar consigo misma por construcción (ver
// tambien legendTicksInFlight mas abajo, que sigue protegiendo contra llamadas externas sueltas,
// ej. un script de prueba). Las leyendas se leen una vez al arrancar el servidor -- si se agrega
// una nueva is_bot=TRUE mas tarde, hace falta reiniciar el servidor para que arranque su bucle.
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
const { globalRouter: worldBossGlobalRouter, playerRouter: worldBossPlayerRouter } = require('../routes/worldboss');
const towerRouter = require('../routes/tower');

const LEGEND_TICK_WAIT_MS = 60 * 1000; // 1 min de espera entre el fin de un tick y el siguiente, por leyenda
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
async function callRoute(handler, playerId, { params = {}, body = {}, query = {} } = {}) {
  const req = { params: { playerId: String(playerId), ...params }, playerId, body, query, app: { get: () => null } };
  const res = makeRes();
  let error = null;
  await handler(req, res, (e) => { error = e; });
  return { status: res.statusCode, body: res.body, error };
}

const H = {
  useItem: findHandler(playersRouter, 'post', '/:playerId/use-item'),
  learnRecipe: findHandler(playersRouter, 'post', '/:playerId/inventory/use/:itemId'),
  guildHeal: findHandler(playersRouter, 'post', '/:playerId/guild/heal'),
  partyPool: findHandler(playersRouter, 'get', '/:playerId/party/pool'),
  partyPoolRefresh: findHandler(playersRouter, 'post', '/:playerId/party/pool/refresh'),
  partyHire: findHandler(playersRouter, 'post', '/:playerId/party/hire/:poolNpcId'),
  partyDismiss: findHandler(playersRouter, 'delete', '/:playerId/party/:partyRowId'),
  dailyRewardClaim: findHandler(playersRouter, 'post', '/:playerId/daily-reward/claim'),
  learnSkill: findHandler(playersRouter, 'post', '/:playerId/guild/learn-skill'),
  learnSkillNpc: findHandler(playersRouter, 'post', '/:playerId/npcs/:npcId/learn-skill'),
  questsAvailable: findHandler(playersRouter, 'get', '/:playerId/quests/available'),
  questsActive: findHandler(playersRouter, 'get', '/:playerId/quests/active'),
  questAccept: findHandler(playersRouter, 'post', '/:playerId/quests/:questId/accept'),
  questComplete: findHandler(playersRouter, 'post', '/:playerId/quests/:questId/complete'),
  craft: findHandler(playersRouter, 'post', '/:playerId/craft'),
  enchantInfo: findHandler(playersRouter, 'get', '/:playerId/enchant/info'),
  enchant: findHandler(playersRouter, 'post', '/:playerId/enchant'),
  enchantNpc: findHandler(playersRouter, 'post', '/:playerId/enchant/npc/:npcId'),
  equip: findHandler(playersRouter, 'post', '/:playerId/equip'),
  npcEquip: findHandler(playersRouter, 'post', '/:playerId/npcs/:npcId/equip'),
  guildShopGet: findHandler(playersRouter, 'get', '/:playerId/guild/shop'),
  guildShopBuy: findHandler(playersRouter, 'post', '/:playerId/guild/shop/buy'),
  guildShopSell: findHandler(playersRouter, 'post', '/:playerId/guild/shop/sell'),
  artisanShopBuy: findHandler(playersRouter, 'post', '/:playerId/artisan-shop/buy'),
  incubatorGet: findHandler(petsRouter, 'get', '/incubator'),
  incubatorPost: findHandler(petsRouter, 'post', '/incubator'),
  incubatorClaim: findHandler(petsRouter, 'post', '/incubator/claim'),
  petActivate: findHandler(petsRouter, 'post', '/:playerPetId/activate'),
  dailyEventGet: findHandler(dailyEventRouter, 'get', '/'),
  dailyEventEnter: findHandler(dailyEventRouter, 'post', '/enter'),
  worldBossStatus: findHandler(worldBossGlobalRouter, 'get', '/status'),
  worldBossEnter: findHandler(worldBossPlayerRouter, 'post', '/enter'),
  towerRun: findHandler(towerRouter, 'get', '/run'),
  towerStart: findHandler(towerRouter, 'post', '/start'),
  towerAdvance: findHandler(towerRouter, 'post', '/advance'),
  towerExtract: findHandler(towerRouter, 'post', '/extract'),
  towerEventChoice: findHandler(towerRouter, 'post', '/event-choice'),
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

async function scoreNpcEquippedSlot(npcId, slot) {
  const row = (await db.query(
    'SELECT item_id, enchant_level, quality_tier FROM npc_equipment WHERE npc_id = $1 AND slot = $2',
    [npcId, slot]
  )).rows[0];
  if (!row) return 0;
  return scoreItem(row.item_id, row.enchant_level, row.quality_tier);
}

// No gastar TODO el oro en piedras de encantar / equipo de tienda -- dejar un colchón para poder
// seguir curándose en el tick que haga falta (pedido explícito: "ser eficiente y no gastar mucho
// para poder curarse"). Guild/heal cuesta 1 oro por punto, así que esto alcanza para una curación
// completa de emergencia del grupo entero aunque el gasto de este tick se lleve el resto.
const GOLD_RESERVE_FOR_HEALING = 300;

// ---------- Contexto básico del tick ----------
async function getLegendContext(playerId) {
  const row = await db.query(
    `SELECT id, level, hp, max_hp, mana, max_mana, gold, current_class_id, evolution_class_id
     FROM players WHERE id = $1`,
    [playerId]
  );
  return row.rows[0] || null;
}

// La mejor poción de HP que tenga en el inventario (compartida entre curarse fuera de combate y
// la curación táctica dentro de combate más abajo).
async function bestHealPotionItemId(playerId) {
  const potion = (await db.query(
    `SELECT pi.item_id FROM player_inventory pi
     JOIN item_stat_bonuses isb ON isb.item_id = pi.item_id AND isb.stat_code = 'HEAL_HP'
     WHERE pi.player_id = $1 AND pi.quantity > 0
     ORDER BY isb.amount DESC LIMIT 1`,
    [playerId]
  )).rows[0];
  return potion?.item_id ?? null;
}

// ---------- 1) Curarse (crítico o muerta, héroe o cualquier NPC del grupo) ----------
// IMPORTANTE: guild/heal se llama SIN heroOnly -- el modo "greedy" (héroe primero, después los
// NPCs por slot) es el único que también revive/cura a los NPCs. Con heroOnly=true un NPC que
// llegara a 0 HP en una pelea se quedaba muerto para siempre (hydratePartyNpcs excluye a los NPCs
// con hp<=0 de toda pelea futura), degradando al grupo entero de vuelta a "el héroe solo" sin
// que nada lo notara ni lo arreglara -- confirmado en producción: los 10 NPCs de las 5 leyendas
// terminaron en hp=0 por este mismo motivo.
async function tryHeal(playerId, ctx) {
  const potionItemId = await bestHealPotionItemId(playerId);
  if (potionItemId) {
    const r = await callRoute(H.useItem, playerId, { body: { itemId: potionItemId } });
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
// Ojo: mira HP *y* maná -- antes solo miraba HP, así que un grupo con HP sano pero maná casi en
// cero (ej. 87% HP / 3% maná, visto en producción con Elyndor) nunca disparaba tryHeal, y entraba
// a pelear sin maná para ninguna skill desde la ronda 2. guild/heal ya cura HP y maná juntos (HP
// primero), así que basta con incluir maná en este chequeo para que se dispare cuando haga falta.
function isCriticalPool(current, max) {
  return Number(max) > 0 && (Number(current) <= 0 || Number(current) / Number(max) < CRITICAL_HP_RATIO);
}

async function partyNeedsHealing(playerId, ctx) {
  if (isCriticalPool(ctx.hp, ctx.max_hp) || isCriticalPool(ctx.mana, ctx.max_mana)) return true;
  const npcs = await db.query(
    `SELECT pn.hp, pn.max_hp, pn.mana, pn.max_mana FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = $1`,
    [playerId]
  );
  return npcs.rows.some((n) => isCriticalPool(n.hp, n.max_hp) || isCriticalPool(n.mana, n.max_mana));
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

// ---------- 2.5) Reclutar NPC para el grupo (si hay slot libre, o para armar mejor build) ----------
// No lo pidió explícitamente el usuario al principio, pero salió necesario en la práctica: una
// leyenda completamente sola (sin party) pierde peleas de zona 1 con normalidad -- el sistema de
// party/NPCs ya existe para exactamente esto (cualquier jugador real lo usa), no reinventar nada
// nuevo, solo usarlo.
//
// Pedido explícito del usuario, en capas:
// 1) El equipo (héroe + 2 NPCs) siempre tiene que tener un curador -- de las 5 clases base, solo
//    Sacerdote tiene una skill de tipo CURACION (la aprende ya en nivel 1, automática, ver
//    decideCombatAction).
// 2) "que arme su propia composición": tampoco puede repetir clase -- ni la del héroe ni la de otro
//    NPC ya en el grupo (con 5 clases base y 3 lugares, siempre alcanza para 3 distintas).
// 3) "que puedan usar refrescar para buscar y contratar lo que buscan": si el pool actual no ofrece
//    ninguna clase nueva/curador contratable, paga por refrescarlo (NPC_REFRESH_COST) en vez de
//    esperar hasta 30 min al refresh gratis.
//
// Si el grupo ya está lleno y necesita arreglo (sin curador, o con alguna clase repetida), despide
// al NPC menos útil (preferí uno de clase duplicada) y lo reemplaza en el MISMO tick, pero solo si
// ya hay un reemplazo real contratable (del pool actual o recién refrescado) -- así nunca deja un
// slot vacío esperando, ni despide a nadie sin tener ya con qué reemplazarlo.
const PARTY_MAX_NPC_SLOTS = 2;
const HEALER_CLASS_NAME = 'Sacerdote'; // classes.name -- unica de las 5 clases base con skill CURACION
const NPC_REFRESH_COST = 150; // debe coincidir con NPC_REFRESH_COST de routes/players.js

function pickNpcToReplace(heroClassName, npcs) {
  const counts = { [heroClassName]: 1 };
  for (const n of npcs) counts[n.class_name] = (counts[n.class_name] || 0) + 1;
  return npcs.find((n) => counts[n.class_name] > 1) || npcs[0];
}

async function tryRecruitNpc(playerId, ctx) {
  const heroClassId = ctx.evolution_class_id || ctx.current_class_id;
  const heroClassName = (await db.query('SELECT name FROM classes WHERE id = $1', [heroClassId])).rows[0]?.name;

  const partyRows = (await db.query(
    `SELECT pp.id AS party_row_id, c.name AS class_name
     FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id JOIN classes c ON c.id = pn.class_id
     WHERE pp.player_id = $1 ORDER BY pp.slot`,
    [playerId]
  )).rows;
  const teamClasses = [heroClassName, ...partyRows.map((n) => n.class_name)];
  const hasHealer = teamClasses.includes(HEALER_CLASS_NAME);
  const teamNeedsFix = !hasHealer || new Set(teamClasses).size < teamClasses.length;

  // De una lista de candidatos contratables: si falta curador, ese gana siempre; si no, el más caro
  // entre los de clase todavía no representada en el equipo (build diversa, no duplicar).
  const pickBest = (candidates) => {
    if (!hasHealer) {
      const healer = candidates.find((n) => n.className === HEALER_CLASS_NAME);
      if (healer) return healer;
    }
    return candidates.filter((n) => !teamClasses.includes(n.className)).sort((a, b) => b.hireCost - a.hireCost)[0];
  };

  let gold = Number(ctx.gold);
  const pool = await callRoute(H.partyPool, playerId);
  let npcs = pool.body?.npcs;
  if (!Array.isArray(npcs)) return false;

  if (partyRows.length < PARTY_MAX_NPC_SLOTS) {
    const affordable = npcs.filter((n) => Number(n.hireCost) <= gold);
    const pick = pickBest(affordable) || affordable.sort((a, b) => b.hireCost - a.hireCost)[0];
    if (!pick) return false;
    const r = await callRoute(H.partyHire, playerId, { params: { poolNpcId: String(pick.poolNpcId) } });
    return r.status < 400;
  }

  if (!teamNeedsFix) return false;

  let replacement = pickBest(npcs.filter((n) => Number(n.hireCost) <= gold));
  if (!replacement && gold - NPC_REFRESH_COST >= GOLD_RESERVE_FOR_HEALING) {
    const refreshRes = await callRoute(H.partyPoolRefresh, playerId, { body: {} });
    if (refreshRes.status >= 400) return false;
    gold = Number(refreshRes.body.gold);
    npcs = refreshRes.body.npcs;
    replacement = pickBest(npcs.filter((n) => Number(n.hireCost) <= gold));
    if (!replacement) return true; // gastó el oro en refrescar y buscar; vuelve a intentar otro tick
  }
  if (!replacement) return false;

  const toReplace = pickNpcToReplace(heroClassName, partyRows);
  const dismissRes = await callRoute(H.partyDismiss, playerId, { params: { partyRowId: String(toReplace.party_row_id) } });
  if (dismissRes.status >= 400) return false;
  const r = await callRoute(H.partyHire, playerId, { params: { poolNpcId: String(replacement.poolNpcId) } });
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
  await playOutCombat(playerId, enter.body.session.id, ctx.level);
  return true;
}

// ---------- 5.5) Aprender receta de un scroll que tenga en el inventario ----------
async function tryLearnRecipe(playerId) {
  const scrolls = await db.query(
    `SELECT pi.item_id FROM player_inventory pi
     JOIN crafting_recipes cr ON cr.scroll_item_id = pi.item_id
     WHERE pi.player_id = $1 AND pi.quantity > 0
       AND NOT EXISTS (SELECT 1 FROM player_learned_recipes lr WHERE lr.player_id = pi.player_id AND lr.recipe_id = cr.id)`,
    [playerId]
  );
  for (const s of scrolls.rows) {
    const r = await callRoute(H.learnRecipe, playerId, { params: { itemId: String(s.item_id) } });
    if (r.status < 400) return true;
  }
  return false;
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

// ---------- 6.5) Aprender skill para cada NPC del grupo, igual que un jugador de su clase ----------
// Mismo criterio que tryLearnSkill de arriba pero por NPC (tabla npc_skills en vez de player_skills)
// -- QUEST se revisa contra las misiones que YA completó el jugador dueño (los NPCs no hacen quests
// propias, no tienen de donde sacar esa info) y el costo en oro sale siempre del jugador (los NPCs
// no tienen oro propio). Antes de este cambio no existía forma de que un NPC aprendiera nada más
// allá de lo automático por nivel -- POST /npcs/:npcId/learn-skill es nuevo.
async function tryLearnSkillNpc(playerId) {
  const npcs = (await db.query(
    `SELECT pn.id, pn.class_id FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = $1`,
    [playerId]
  )).rows;
  for (const npc of npcs) {
    const classChain = await evolution.getClassAncestorChain(npc.class_id);
    const candidates = (await db.query(
      `SELECT s.id FROM skills s
       WHERE s.class_id = ANY($1::int[])
         AND s.learn_method IN ('GOLD', 'QUEST')
         AND NOT EXISTS (SELECT 1 FROM npc_skills ns WHERE ns.npc_id = $2 AND ns.skill_id = s.id)
       ORDER BY s.id`,
      [classChain, npc.id]
    )).rows;
    for (const c of candidates) {
      const r = await callRoute(H.learnSkillNpc, playerId, { params: { npcId: String(npc.id) }, body: { skillId: c.id } });
      if (r.status < 400) return true;
    }
  }
  return false;
}

// ---------- 7) Misiones: completar una activa lista, o aceptar una nueva ----------
// /quests/available devuelve TODAS las misiones elegibles por zona/clase/rango/cooldown, incluidas
// las que su nivel todavía no alcanza (solo las marca con meets_level=false, no las saca de la
// lista) -- si se aceptara la primera nomás (la de más estrellas, por el ORDER BY del endpoint) el
// accept se rechaza con 400 "Requiere nivel N" y ese tick no logra nada. Por eso se recorre la
// lista buscando la primera que sí cumple nivel. Las repetibles (misiones diarias del gremio, etc.)
// ya vuelven a aparecer solas en este mismo endpoint apenas se cumple el cooldown desde la última
// entrega -- no hace falta lógica extra para "volver a aceptarlas".
async function tryQuests(playerId) {
  const active = await callRoute(H.questsActive, playerId);
  if (Array.isArray(active.body)) {
    for (const quest of active.body) {
      const r = await callRoute(H.questComplete, playerId, { params: { questId: String(quest.id) } });
      if (r.status < 400) return true;
    }
  }
  const available = await callRoute(H.questsAvailable, playerId);
  if (Array.isArray(available.body)) {
    for (const quest of available.body) {
      if (quest.meets_level === false) continue;
      const r = await callRoute(H.questAccept, playerId, { params: { questId: String(quest.id) } });
      if (r.status < 400) return true;
    }
  }
  return false;
}

// ---------- 8) Craftear una mejora de equipo (del héroe o de un NPC), y ponérsela ----------
// classId/level son los de QUIEN se va a equipar (el héroe o el NPC puntual, pueden ser de clases
// distintas) -- los materiales siempre salen del inventario del JUGADOR (los NPCs no tienen
// inventario propio). Evalúa: ¿tiene los materiales? ¿el resultado puntúa mejor que lo que ya
// tiene puesto en ese slot? Solo craftea si las dos son sí -- nunca "porque sí".
async function craftUpgradeFor(playerId, { classId, level, npcId }) {
  const classChain = await evolution.getClassAncestorChain(classId);
  const candidates = (await db.query(
    `SELECT cr.id AS recipe_id, cr.code, cr.result_item_id, i.slot
     FROM crafting_recipes cr JOIN items i ON i.id = cr.result_item_id
     WHERE i.item_type = 'EQUIPMENT' AND i.slot IS NOT NULL
       AND (i.class_id IS NULL OR i.class_id = ANY($1::int[]))
       AND (i.required_level IS NULL OR i.required_level <= $2)
       AND (cr.zone_id IS NULL OR cr.zone_id IN (SELECT zone_id FROM player_zone_unlocks WHERE player_id = $3))
       AND (cr.scroll_item_id IS NULL OR EXISTS (SELECT 1 FROM player_learned_recipes plr WHERE plr.player_id = $3 AND plr.recipe_id = cr.id))`,
    [classChain, level, playerId]
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
    const currentScore = npcId ? await scoreNpcEquippedSlot(npcId, c.slot) : await scoreEquippedSlot(playerId, c.slot);
    if (newScore <= currentScore) continue;

    const craftRes = await callRoute(H.craft, playerId, { body: { recipeCode: c.code, quantity: 1 } });
    if (craftRes.status >= 400) continue;

    const bestTier = (await inventory.getBestQualityTier(playerId, c.result_item_id, 0)) ?? 0;
    if (npcId) {
      await callRoute(H.npcEquip, playerId, { params: { npcId: String(npcId) }, body: { itemId: c.result_item_id, enchantLevel: 0, qualityTier: bestTier } });
    } else {
      await callRoute(H.equip, playerId, { body: { itemId: c.result_item_id, enchantLevel: 0, qualityTier: bestTier } });
    }
    return true;
  }
  return false;
}

// NPCs primero, héroe después: el héroe tiene DOS caminos para equiparse (craftear o comprar en
// la tienda del gremio, que no gasta materiales, solo oro) pero el NPC solo tiene este -- la
// tienda del gremio es exclusiva del héroe (rechaza compras para otra clase, ver
// tryBuyGuildShopUpgrade). Con el héroe primero, los materiales (compartidos desde el inventario
// del jugador) siempre se los llevaba él mientras tuviera algo nuevo para craftear, y los NPCs se
// quedaban sin equipar por hs de juego reales aunque hubiera receta valida -- confirmado en
// producción: los 10 NPCs de las 5 leyendas seguian en 0 de equipo tras horas, mientras los 5
// héroes ya tenian las 6 ranuras llenas.
async function tryCraftUpgrade(playerId, ctx) {
  const npcs = (await db.query(
    `SELECT pn.id, pn.class_id, pn.level FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = $1`,
    [playerId]
  )).rows;
  for (const npc of npcs) {
    if (await craftUpgradeFor(playerId, { classId: npc.class_id, level: npc.level, npcId: npc.id })) return true;
  }

  const heroClassId = ctx.evolution_class_id || ctx.current_class_id;
  if (await craftUpgradeFor(playerId, { classId: heroClassId, level: ctx.level })) return true;

  return false;
}

// ---------- 8.2) Vender al gremio los materiales de crafteo sobrantes ----------
// El inventario acumula materiales comunes sin tope cada vez que gana una pelea (30% de drop de
// varios monstruos comunes de zona 1) -- una vez que ya craftearon con eso lo que tenían que
// craftear (tryCraftUpgrade/tryCraftPotion ya corrieron antes en la cadena), el resto se queda
// ahí sin usarse para nada. Vender el sobrante por encima de un piso fijo (para no quedarse sin
// nada si mas adelante hace falta craftear algo nuevo) convierte ese loot muerto en oro real, sin
// arriesgar ninguna receta futura -- pedido explícito del usuario.
const SURPLUS_MATERIAL_RESERVE = 10;

async function trySellSurplusLoot(playerId) {
  const materials = (await db.query(
    `SELECT pi.item_id, pi.quantity FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND i.item_type = 'MATERIAL' AND pi.quantity > $2`,
    [playerId, SURPLUS_MATERIAL_RESERVE]
  )).rows;
  for (const m of materials) {
    const surplus = m.quantity - SURPLUS_MATERIAL_RESERVE;
    const r = await callRoute(H.guildShopSell, playerId, { body: { itemId: m.item_id, quantity: surplus } });
    if (r.status < 400) return true;
  }
  return false;
}

// ---------- 8.5) Comprar el ingrediente comprable de las pociones, mantener stock mínimo ----------
// AGUA_PURIFICADA ("agua destilada apta para pociones") se vende en el artesano ALQUIMISTA y es el
// ingrediente base de las 4 recetas de poción (vida/mana, menor/mayor) -- las hierbas
// (HIERBA_CURATIVA/HIERBA_MAGICA/FLOR_LUMINOSA/POLVO_ARCANO) sí siguen saliendo solo de farmear
// zonas, esas no se compran. Mantiene un colchón fijo en vez de comprar bajo demanda para no
// depender de que el craft se acuerde de comprar antes de intentar.
const POTION_INGREDIENT_ARTISAN_CODE = 'ALQUIMISTA';
const POTION_INGREDIENT_BUYABLE_CODE = 'AGUA_PURIFICADA';
const MIN_POTION_INGREDIENT_STOCK = 3;

async function tryBuyPotionIngredient(playerId, ctx) {
  const item = (await db.query('SELECT id FROM items WHERE code = $1', [POTION_INGREDIENT_BUYABLE_CODE])).rows[0];
  if (!item) return false;
  const have = await inventory.getQuantity(playerId, item.id);
  if (have >= MIN_POTION_INGREDIENT_STOCK) return false;
  const needed = MIN_POTION_INGREDIENT_STOCK - have;

  const priceRow = (await db.query(
    'SELECT price FROM artisan_shop WHERE artisan_code = $1 AND item_id = $2',
    [POTION_INGREDIENT_ARTISAN_CODE, item.id]
  )).rows[0];
  if (!priceRow) return false;
  if (Number(ctx.gold) - priceRow.price * needed < GOLD_RESERVE_FOR_HEALING) return false;

  const r = await callRoute(H.artisanShopBuy, playerId, { body: { artisanCode: POTION_INGREDIENT_ARTISAN_CODE, itemCode: POTION_INGREDIENT_BUYABLE_CODE, quantity: needed } });
  return r.status < 400;
}

// ---------- 8.7) Craftear pociones de HP o de mana si le quedan pocas de alguna ----------
const POTION_RECIPES = [
  { code: 'RECETA_POCION_DE_VIDA_MENOR', statCode: 'HEAL_HP' },
  { code: 'RECETA_POCION_DE_VIDA_MAYOR', statCode: 'HEAL_HP' },
  { code: 'RECETA_POCION_DE_MANA_MENOR', statCode: 'HEAL_MP' },
  { code: 'RECETA_POCION_DE_MANA_MAYOR', statCode: 'HEAL_MP' },
];
const MIN_POTION_STOCK = 3;

async function potionStock(playerId, statCode) {
  const row = (await db.query(
    `SELECT COALESCE(SUM(pi.quantity), 0) AS total FROM player_inventory pi
     JOIN item_stat_bonuses isb ON isb.item_id = pi.item_id AND isb.stat_code = $2
     WHERE pi.player_id = $1`,
    [playerId, statCode]
  )).rows[0];
  return Number(row.total);
}

async function tryCraftPotion(playerId) {
  for (const statCode of ['HEAL_HP', 'HEAL_MP']) {
    if ((await potionStock(playerId, statCode)) >= MIN_POTION_STOCK) continue;

    for (const { code } of POTION_RECIPES.filter((p) => p.statCode === statCode)) {
      const recipe = (await db.query('SELECT id, zone_id FROM crafting_recipes WHERE code = $1', [code])).rows[0];
      if (!recipe) continue;
      if (recipe.zone_id) {
        const unlocked = await db.query('SELECT 1 FROM player_zone_unlocks WHERE player_id = $1 AND zone_id = $2', [playerId, recipe.zone_id]);
        if (!unlocked.rows.length) continue;
      }
      const ingredients = (await db.query('SELECT item_id, quantity FROM crafting_recipe_ingredients WHERE recipe_id = $1', [recipe.id])).rows;
      let canCraft = true;
      for (const ing of ingredients) {
        const have = await inventory.getQuantity(playerId, ing.item_id);
        if (have < ing.quantity) { canCraft = false; break; }
      }
      if (!canCraft) continue;
      const r = await callRoute(H.craft, playerId, { body: { recipeCode: code, quantity: 1 } });
      if (r.status < 400) return true;
    }
  }
  return false;
}

// ---------- 8.7) Comprar equipo en la tienda del gremio (solo su propia clase) ----------
// El backend rechaza con 403 comprar un ítem que no sea de la clase del jugador (routes/players.js
// guild/shop/buy) -- no hay forma real de usar esta tienda para equipar a un NPC de otra clase, así
// que esto solo cubre al héroe.
async function tryBuyGuildShopUpgrade(playerId, ctx) {
  const shop = await callRoute(H.guildShopGet, playerId);
  const items = shop.body?.items;
  if (!Array.isArray(items)) return false;

  for (const item of items) {
    if (!item.affordable) continue;
    if (Number(shop.body.gold) - item.buyPrice < GOLD_RESERVE_FOR_HEALING) continue;
    const newScore = await scoreItem(item.id, 0, 0);
    const currentScore = await scoreEquippedSlot(playerId, item.slot);
    if (newScore <= currentScore) continue;

    const buyRes = await callRoute(H.guildShopBuy, playerId, { body: { itemId: item.id, quantity: 1 } });
    if (buyRes.status >= 400) continue;
    const bestTier = (await inventory.getBestQualityTier(playerId, item.id, 0)) ?? 0;
    await callRoute(H.equip, playerId, { body: { itemId: item.id, enchantLevel: 0, qualityTier: bestTier } });
    return true;
  }
  return false;
}

// ---------- 9) Comprar piedra de encantar si le falta para el próximo nivel ----------
// Solo PIEDRA_ENCANT_MENOR vive en el artesano (HERRERO) -- las demás piedras/cristales están en
// la tienda del asentamiento de la Torre o la del World Boss, que hoy las leyendas no visitan.
const ENCHANT_STONE_ARTISAN_CODE = 'HERRERO';
const ENCHANT_STONE_BUYABLE_CODE = 'PIEDRA_ENCANT_MENOR';

// Tope de encantamiento -- pedido explícito del usuario para no gastar de más: se detiene en +2
// (solo cuesta 200+400=600 oro en total, 95%/90% de éxito). De +3 en adelante el costo empieza a
// escalar fuerte (1500 oro para +4 con solo 75% de éxito, y de +5 en adelante ni se puede: pide
// Piedra de Encantamiento MAYOR, que no vive en el artesano y las leyendas no visitan ni Torre ni
// World Boss para conseguirla). Sin este tope, el sistema insistía en subir cada ranura hasta
// donde pudiera en vez de repartir ese oro en pociones/curación, que rinden más por punto (ver
// commits de balance anteriores).
const ENCHANT_LEVEL_CAP = 2;

// Encantar (comprar piedra o gastar el oro de la mejora en sí) solo si le sobra plata de verdad --
// pedido explícito del usuario: por encima de 5000 de oro sí, por debajo no. Deja el oro por
// debajo de ese piso libre para lo esencial (pociones, equipo, aprender skills) en vez de
// competir por turno con el encantamiento, que ya de por sí es "extra" ahora que curarse es
// gratis para las leyendas.
const ENCHANT_MIN_GOLD_THRESHOLD = 5000;

async function tryBuyEnchantStone(playerId, ctx) {
  if (Number(ctx.gold) <= ENCHANT_MIN_GOLD_THRESHOLD) return false;
  const info = await callRoute(H.enchantInfo, playerId);
  if (!Array.isArray(info.body)) return false;
  for (const slotInfo of info.body) {
    if (!slotInfo.nextCost || slotInfo.nextCost.stone !== ENCHANT_STONE_BUYABLE_CODE || slotInfo.enchantLevel >= ENCHANT_LEVEL_CAP) continue;
    const stoneItem = (await db.query('SELECT id FROM items WHERE code = $1', [ENCHANT_STONE_BUYABLE_CODE])).rows[0];
    if (!stoneItem) continue;
    const have = await inventory.getQuantity(playerId, stoneItem.id);
    if (have >= slotInfo.nextCost.quantity) continue;
    const needed = slotInfo.nextCost.quantity - have;
    const priceRow = (await db.query(
      'SELECT price FROM artisan_shop WHERE artisan_code = $1 AND item_id = $2',
      [ENCHANT_STONE_ARTISAN_CODE, stoneItem.id]
    )).rows[0];
    if (!priceRow) continue;
    if (Number(ctx.gold) - priceRow.price * needed < GOLD_RESERVE_FOR_HEALING) continue;

    const r = await callRoute(H.artisanShopBuy, playerId, { body: { artisanCode: ENCHANT_STONE_ARTISAN_CODE, itemCode: ENCHANT_STONE_BUYABLE_CODE, quantity: needed } });
    if (r.status < 400) return true;
  }
  return false;
}

// ---------- 10) Encantar equipo puesto (héroe y NPCs) si alcanza el oro/piedras ----------
// useCrystal NO significa "usar la piedra de encantar" (esa se cobra siempre, sea lo que sea
// useCrystal) -- pide ADEMAS un Cristal de Estabilidad (item aparte, mas raro) para subir el
// % de éxito, y si no tiene ninguno la ruta rechaza con 400 ANTES de mirar si tiene la piedra.
// Con useCrystal:true fijo, cada intento del héroe fallaba siempre (nunca consiguieron un
// cristal) aunque sí tuvieran piedra y oro de sobra -- confirmado en producción: las 5 leyendas
// tenían 1 piedra de encantar menor comprada (250 oro reales) y nunca usada, encantamiento del
// héroe en 0 tras horas. La rama de NPCs de mas abajo nunca mandó useCrystal y por eso sí
// funcionaba.
async function tryEnchant(playerId, ctx) {
  if (Number(ctx.gold) <= ENCHANT_MIN_GOLD_THRESHOLD) return false;
  const info = await callRoute(H.enchantInfo, playerId);
  if (Array.isArray(info.body)) {
    for (const slotInfo of info.body) {
      if (!slotInfo.nextCost || slotInfo.enchantLevel >= ENCHANT_LEVEL_CAP) continue;
      const r = await callRoute(H.enchant, playerId, { body: { slot: slotInfo.slot } });
      if (r.status < 400) return true;
    }
  }

  const npcs = (await db.query(
    `SELECT pn.id FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = $1`,
    [playerId]
  )).rows;
  for (const npc of npcs) {
    const equipped = (await db.query('SELECT slot, enchant_level FROM npc_equipment WHERE npc_id = $1', [npc.id])).rows;
    for (const eq of equipped) {
      if (eq.enchant_level >= ENCHANT_LEVEL_CAP) continue;
      const r = await callRoute(H.enchantNpc, playerId, { params: { npcId: String(npc.id) }, body: { slot: eq.slot } });
      if (r.status < 400) return true;
    }
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

// El nivel y las skills "aprendidas" (GOLD/QUEST) son del ACTOR puntual, no siempre del héroe -- un
// NPC tiene su propio player_npcs.level y su propia tabla npc_skills, aparte de las del jugador
// dueño (ver tryLearnSkillNpc). Antes esto siempre miraba el nivel y player_skills del héroe sin
// importar quién actuara, así que ninguna skill GOLD/QUEST que aprendiera un NPC llegaba a usarse
// nunca en combate -- el gasto de oro era real pero invisible para decideCombatAction. Mismo
// criterio que ya usa el endpoint real de combate (POST /sessions/:id/action, rama SKILL) para
// validar si un actor puede usar una skill.
// Potencia estimada de una skill para EL ACTOR puntual (su propio ATK/MAG, ya con equipo/buffs
// aplicados) -- mana_cost NO es un proxy de daño real, confirmado comparando dos partidas de la
// MISMA pelea (Test vs Capitán de los Lobos): la IA vieja elegía Maelstrom (70 de maná, base 20,
// x0.7 MAG) y pegaba 1 de daño contra la defensa del Capitán; un humano jugando el mismo grupo
// eligió Tajo (25 de maná nomás, base 120, x1.0 ATK) y pegó 141. Mana_cost y poder real de una
// skill no tienen relación en absoluto en este diseño.
function skillPower(actor, skill) {
  if (!skill.scaling_stat) return Number(skill.base_value) || 0;
  const stat = skill.scaling_stat === 'ATK' ? Number(actor.atk)
    : skill.scaling_stat === 'MAG' ? Number(actor.mag)
    : (Number(actor.atk) + Number(actor.mag)) / 2;
  return (Number(skill.base_value || 0) + Number(skill.scaling_multiplier || 0) * stat) * (skill.hits || 1);
}

async function bestUsableSkill(playerId, actor, skillType) {
  if (!actor.class_id) return null;
  const classChain = await evolution.getClassAncestorChain(actor.class_id);

  const rows = actor.npc_id
    ? (await db.query(
        `SELECT s.id, s.mana_cost, s.target_type, s.base_value, s.scaling_stat, s.scaling_multiplier, s.hits FROM skills s
         WHERE s.skill_type = $1 AND s.is_passive = FALSE
           AND (s.class_id IS NULL OR s.class_id = ANY($2::int[]))
           AND ((s.learn_method = 'LEVEL' AND s.learn_level <= (SELECT level FROM player_npcs WHERE id = $3))
                OR EXISTS (SELECT 1 FROM npc_skills ns WHERE ns.npc_id = $3 AND ns.skill_id = s.id))`,
        [skillType, classChain, actor.npc_id]
      )).rows
    : (await db.query(
        `SELECT s.id, s.mana_cost, s.target_type, s.base_value, s.scaling_stat, s.scaling_multiplier, s.hits FROM skills s
         WHERE s.skill_type = $1 AND s.is_passive = FALSE
           AND (s.class_id IS NULL OR s.class_id = ANY($2::int[]))
           AND ((s.learn_method = 'LEVEL' AND s.learn_level <= (SELECT level FROM players WHERE id = $3))
                OR EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $3 AND ps.skill_id = s.id))`,
        [skillType, classChain, playerId]
      )).rows;

  const affordable = rows.filter((r) => Number(actor.mana) >= Number(r.mana_cost));
  if (!affordable.length) return null;
  return affordable.reduce((best, r) => (skillPower(actor, r) > skillPower(actor, best) ? r : best));
}

// ¿El actor ya tiene un buff propio activo? Evita gastar maná re-casteando el mismo buff cada
// turno en vez de atacar -- una vez activo, alcanza con dejarlo correr hasta que expire.
async function hasActiveBuff(sessionId, participantId) {
  const r = await db.query(
    `SELECT 1 FROM combat_participant_buffs WHERE session_id = $1 AND participant_id = $2 AND is_debuff = FALSE AND rounds_remaining > 0 LIMIT 1`,
    [sessionId, participantId]
  );
  return r.rows.length > 0;
}

// Umbral para curar a CUALQUIER aliado (uno mismo incluido) que este por debajo -- pedido
// explicito del usuario ("menos del 50% de vida o 40%"), tomamos el mas generoso de los dos para
// reaccionar antes.
const ALLY_HEAL_HP_RATIO = 0.5;

// combat_participants no guarda el nivel del monstruo en una columna propia, pero hydrateMonsters
// (routes/combat.js) siempre arma el nombre como "<nombre> Lv.<nivel>" (menos World Boss, que las
// leyendas no pelean) -- se parsea desde ahí en vez de agregar una columna nueva solo para esto.
function parseMonsterLevel(name) {
  const m = /Lv\.(\d+)/.exec(name || '');
  return m ? Number(m[1]) : null;
}

// Pedido explícito del usuario: escapar (y volver a explorar en un tick futuro, ya que
// exploreAndFight vuelve a intentar solo) si el enemigo es de nivel mayor al del héroe -- una
// pelea de zona puede tocar un monstruo por encima del propio nivel (confirmado: Luminus nivel 1
// contra un Bandido Corrupto/Araña Venenosa Lv.2, pelea perdida del todo pese a tener curador).
// Solo aplica cuando le toca el turno al HÉROE (ESCAPE es la única accion que el motor le rechaza
// a un NPC) y se revisa antes que la curación -- no tiene sentido curarse para seguir en una
// pelea que de entrada convenía evitar.
async function decideCombatAction(playerId, actor, allies, enemies, heroLevel) {
  if (actor.player_id === playerId && enemies?.length) {
    const overLeveled = enemies.some((e) => {
      const lvl = parseMonsterLevel(e.name);
      return lvl !== null && lvl > heroLevel;
    });
    if (overLeveled) return { participantId: actor.id, action: 'ESCAPE' };
  }

  const aliveAllies = allies.filter((a) => Number(a.hp) > 0);
  const neediest = aliveAllies.reduce(
    (worst, a) => (Number(a.hp) / Number(a.max_hp) < Number(worst.hp) / Number(worst.max_hp) ? a : worst),
    aliveAllies[0]
  );
  if (neediest && Number(neediest.hp) / Number(neediest.max_hp) < ALLY_HEAL_HP_RATIO) {
    const healSkill = await bestUsableSkill(playerId, actor, 'CURACION');
    if (healSkill) {
      const body = { participantId: actor.id, action: 'SKILL', skillId: healSkill.id };
      if (healSkill.target_type === 'ALLY' && neediest.id !== actor.id) body.targetParticipantId = neediest.id;
      return body;
    }
    const potionItemId = await bestHealPotionItemId(playerId);
    if (potionItemId) {
      const body = { participantId: actor.id, action: 'USE_ITEM', itemId: potionItemId };
      if (neediest.id !== actor.id) body.targetParticipantId = neediest.id;
      return body;
    }
  }

  // Buffearse antes de atacar si hay una skill de BUFF disponible y todavía no tiene una activa
  // -- la IA nunca usaba este tipo de skill, y un humano jugando la MISMA pelea la abrió con dos
  // buffs de ATK (+20%/+15%) antes de atacar, lo que explica buena parte de la diferencia de
  // daño real contra el mismo enemigo. Sin target explícito casteamos sobre el aliado con más
  // ATK vivo (el que más se beneficia de un buff ofensivo), salvo que la skill sea SELF/grupal.
  const buffSkill = await bestUsableSkill(playerId, actor, 'BUFF');
  if (buffSkill && !(await hasActiveBuff(actor.session_id, actor.id))) {
    const body = { participantId: actor.id, action: 'SKILL', skillId: buffSkill.id };
    if (buffSkill.target_type === 'ALLY') {
      const bestAttacker = aliveAllies.reduce((best, a) => (Number(a.atk) > Number(best.atk) ? a : best), actor);
      if (bestAttacker.id !== actor.id) body.targetParticipantId = bestAttacker.id;
    }
    return body;
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
async function playOutCombat(playerId, sessionId, heroLevel) {
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
    const allies = state.participants.filter((p) => p.side === 'PLAYER');

    const action = await decideCombatAction(playerId, actor, allies, aliveEnemies, heroLevel);
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

// ---------- World Boss (si el evento esta activo y llega al nivel minimo) ----------
// Mismo motor de combate que cualquier pelea normal (combat_sessions/combat_participants via
// POST /sessions/:id/action), asi que playOutCombat/decideCombatAction se reusan tal cual, sin
// loop propio. Un solo clon nunca le gana a 500.000 HP -- lo normal es ENEMY_WON (el grupo cae),
// que igual reparte cosmic_shards por el daño hecho (solo ESCAPED pierde el credito, ver
// handleWorldBossFinalize en routes/combat.js). El cooldown es 60s por evento (no diario) y no
// hay endpoint para chequearlo antes -- se intenta directo y un 400 (cooldown, evento no activo,
// nivel insuficiente) simplemente no hace nada este tick.
async function tryWorldBoss(playerId, ctx) {
  if (Number(ctx.level) < combatEngine.WORLD_BOSS_MIN_LEVEL_TO_ENTER) return false;
  const status = await callRoute(H.worldBossStatus, playerId);
  if (!status.body?.active) return false;
  const enter = await callRoute(H.worldBossEnter, playerId, { body: {} });
  if (enter.status >= 400 || !enter.body?.session) return false;
  await playOutCombat(playerId, enter.body.session.id, ctx.level);
  return true;
}

// ---------- El Abismo / Torre (si llega al nivel minimo, requiere estar con HP al máximo) ----------
// Nivel mínimo mucho más alto que el resto del contenido (30) -- ninguna leyenda lo alcanza
// todavía, pero queda listo para cuando llegue. Una corrida son VARIOS pasos (sala tras sala,
// piso tras piso) que se resuelven todos en el mismo tick, en un loop acotado -- entrar,
// resolver salas (pelea con playOutCombat, o evento narrativo con la mejor elección obvia:
// SANCTUARY cura gratis y SECRET da monedas gratis, así que siempre 'A'; TRAP hace daño y
// VENDOR abre una compra que no evaluamos acá, así que siempre 'B'), y decidir entre seguir
// avanzando de piso o retirarse.
//
// Cuándo retirarse (pedido explícito del usuario, "para no perder lo extraído"): las monedas de
// mazmorra (coins_earned) recién quedan seguras al llamar /extract -- si el grupo pierde una
// pelea habiendo pasado ya un checkpoint (piso múltiplo de 15), la corrida NO termina pero pierde
// las monedas ganadas desde ese checkpoint (vuelve al checkpoint, revivido, en 0 de nuevo); si
// pierde ANTES de pasar el primer checkpoint, la corrida entera se pierde. Por eso, apenas el
// héroe o algún NPC queda por debajo de ALLY_HEAL_HP_RATIO entre salas (no hay forma de curarse
// gratis dentro de la torre salvo un evento SANCTUARY con suerte), se extrae en vez de arriesgar
// la próxima sala malherido -- mejor asegurar lo ganado que perderlo por avaricia.
const TOWER_MAX_ROOMS_PER_TICK = 20;

// Debe coincidir con MIN_LEVEL de routes/tower.js -- ese archivo no lo exporta (solo exporta el
// router), así que queda espejado acá a mano.
const TOWER_MIN_LEVEL = 30;

async function resolveTowerEventChoice(playerId, eventType) {
  const choice = eventType === 'SANCTUARY' || eventType === 'SECRET' || eventType === 'STORY' ? 'A' : 'B';
  return callRoute(H.towerEventChoice, playerId, { body: { choice } });
}

// Entre salas no hay sesión de combate de la que leer HP (fetchSessionState devuelve null sin
// current_session_id) -- se lee directo de la base, no del ctx del inicio del tick (que ya está
// desactualizado después de una o más peleas dentro del mismo loop).
async function towerPartyNeedsRetreat(playerId) {
  const hero = (await db.query('SELECT hp, max_hp FROM players WHERE id = $1', [playerId])).rows[0];
  if (Number(hero.hp) / Number(hero.max_hp) < ALLY_HEAL_HP_RATIO) return true;
  const npcs = await db.query(
    `SELECT pn.hp, pn.max_hp FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = $1`,
    [playerId]
  );
  return npcs.rows.some((n) => Number(n.hp) > 0 && Number(n.hp) / Number(n.max_hp) < ALLY_HEAL_HP_RATIO);
}

async function tryAbismo(playerId, ctx) {
  if (Number(ctx.level) < TOWER_MIN_LEVEL) return false;

  let run = await callRoute(H.towerRun, playerId);
  if (!run.body?.run) {
    const start = await callRoute(H.towerStart, playerId, { body: { difficulty: 1 } });
    if (start.status >= 400 || !start.body?.run) return false;
    run = { body: start.body };
  }

  for (let i = 0; i < TOWER_MAX_ROOMS_PER_TICK; i++) {
    const { run: towerRun, session, pendingEvent } = run.body;
    if (!towerRun || towerRun.status !== 'IN_PROGRESS') return true;

    if (pendingEvent) {
      await resolveTowerEventChoice(playerId, pendingEvent.event_type);
    } else if (session && session.status === 'IN_PROGRESS') {
      await playOutCombat(playerId, session.id, ctx.level);
    } else {
      // Entre salas: nada pendiente -- decidir si seguir de piso o retirarse con lo ganado.
      const needsRetreat = await towerPartyNeedsRetreat(playerId);
      const action = needsRetreat
        ? await callRoute(H.towerExtract, playerId, { body: {} })
        : await callRoute(H.towerAdvance, playerId, { body: {} });
      if (action.status >= 400) {
        // No se pudo avanzar (ej. piso siguiente no configurado) ni tiene sentido reintentar --
        // extraer para no dejar la corrida colgada.
        await callRoute(H.towerExtract, playerId, { body: {} });
        return true;
      }
      if (needsRetreat) return true;
    }

    run = await callRoute(H.towerRun, playerId);
  }
  // Se acabaron las vueltas permitidas en este tick sin terminar -- extraer para no dejar la
  // corrida a mitad y perder lo ganado si el proximo tick tarda en retomarla.
  await callRoute(H.towerExtract, playerId, { body: {} });
  return true;
}

async function exploreAndFight(playerId, ctx) {
  const zoneId = await pickZoneForLevel(ctx.level);
  const enter = await callRoute(H.explore, playerId, { params: { zoneId: String(zoneId) }, body: {} });
  if (enter.status >= 400 || !enter.body?.session) return false;
  await playOutCombat(playerId, enter.body.session.id, ctx.level);
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

// Qué leyendas tienen un tick propio en curso ahora mismo, dentro de ESTE proceso -- si un tick
// tarda mas que el intervalo entre corridas (ej. una pelea larga) y el siguiente setInterval
// dispara antes de que el anterior termine, la misma leyenda podria procesarse dos veces en
// paralelo y competir consigo misma (dos INSERT a player_active_combat_session, dos acciones de
// combate a la vez, etc. -- ya paso una vez con un script de prueba corriendo en paralelo al
// scheduler en vivo). Solo protege corridas DENTRO de este mismo proceso Node -- un script aparte
// pegandole a produccion en simultaneo no lo ve, esa sigue siendo responsabilidad de quien prueba.
const legendTicksInFlight = new Set();

// ---------- Tick por leyenda: una sola tarea, la primera que aplique en orden de prioridad ----------
async function processLegendTick(playerId) {
  if (legendTicksInFlight.has(playerId)) return;
  legendTicksInFlight.add(playerId);
  try {
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

    // Reponer pociones va justo despues de la curacion de emergencia, antes que cualquier otra
    // cosa -- pedido explicito del usuario tras confirmar que salen mas baratas por punto que la
    // enfermeria (Poción de Vida Menor: ~0.375 oro/HP vs 0.5 oro/HP en guild/heal), asi el colchon
    // barato se repone primero en vez de competir por turno con gastos menos urgentes.
    if (await tryBuyPotionIngredient(playerId, ctx)) return;
    if (await tryCraftPotion(playerId)) return;

    if (await tryPetTasks(playerId)) return;
    if (await tryRecruitNpc(playerId, ctx)) return;
    // tryEvolve apagado a pedido explícito del usuario -- todavía no quiere que las leyendas
    // evolucionen, se retoma más adelante. Función intacta más abajo, solo se saca de la cola.
    // if (await tryEvolve(playerId)) return;
    if (await tryDailyReward(playerId)) return;
    if (await tryLearnRecipe(playerId)) return;
    if (!heroCritical && (await tryDailyEvent(playerId, ctx))) return;
    if (await tryLearnSkill(playerId, ctx)) return;
    if (await tryLearnSkillNpc(playerId)) return;
    if (await tryQuests(playerId, ctx)) return;
    if (await tryCraftUpgrade(playerId, ctx)) return;
    if (await trySellSurplusLoot(playerId)) return;
    if (await tryBuyGuildShopUpgrade(playerId, ctx)) return;
    if (await tryBuyEnchantStone(playerId, ctx)) return;
    if (await tryEnchant(playerId, ctx)) return;
    if (!heroCritical && (await tryWorldBoss(playerId, ctx))) return;
    if (!heroCritical && (await tryAbismo(playerId, ctx))) return;
    if (!heroCritical) await exploreAndFight(playerId, ctx);
  } finally {
    legendTicksInFlight.delete(playerId);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Bucle propio de UNA leyenda: tick, esperar LEGEND_TICK_WAIT_MS, tick de nuevo, para siempre.
// No usa setInterval a propósito -- como espera a que processLegendTick termine (el await de
// arriba) antes de programar la siguiente espera, nunca puede solaparse consigo misma, ni
// siquiera si un tick puntual tarda más que LEGEND_TICK_WAIT_MS (una pelea larga, por ejemplo):
// simplemente esa vuelta tarda más, y la que sigue arranca recién cuando la anterior de verdad
// terminó. El error de una vuelta se atrapa y se loguea, pero el bucle sigue -- una leyenda que
// falle una vez no se queda trabada para siempre.
async function legendLoop(playerId) {
  for (;;) {
    try {
      await processLegendTick(playerId);
    } catch (err) {
      console.error(`[legendScheduler] error procesando leyenda ${playerId}:`, err.message);
    }
    await sleep(LEGEND_TICK_WAIT_MS);
  }
}

// Arranca un bucle independiente por cada leyenda (players.is_bot = TRUE) y no espera a que
// terminen -- son bucles infinitos por diseño, corren en paralelo entre sí durante toda la vida
// del proceso. Cada una usa como mucho una conexión del pool a la vez (son secuenciales puertas
// adentro), así que 5 en paralelo son a lo sumo 5 conexiones simultáneas, dentro del límite
// default del pool (10).
async function startLegendSchedule() {
  const legends = await db.query('SELECT id FROM players WHERE is_bot = TRUE ORDER BY id');
  for (const row of legends.rows) {
    legendLoop(row.id);
  }
}

// decideCombatAction/playOutCombat quedan exportadas ademas de lo que ya se usaba (solo aditivo,
// no cambia nada del comportamiento en vivo) para poder simular peleas puntuales contra cualquier
// jugador/composicion de monstruos desde un script de prueba, sin duplicar esta logica.
module.exports = {
  startLegendSchedule, processLegendTick, LEGEND_TICK_WAIT_MS, decideCombatAction, playOutCombat,
};
