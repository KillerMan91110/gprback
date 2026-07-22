const express = require('express');
const db = require('../db/db');
const { rankAtLeast, getRankForReputation, getRankBonuses, applyPercentBonus } = require('../lib/ranks');
const inventory = require('../lib/inventory');
const leveling = require('../lib/leveling');
const questProgress = require('../lib/questProgress');
const achievements = require('../lib/achievements');
const { getEquipmentBonuses, applyHpBonusDelta, getNpcEquipmentBonuses, applyNpcHpBonusDelta } = require('../lib/equipment');
const { getClassPassiveBonuses } = require('../lib/passives');
const evolution = require('../lib/evolution');
const { fetchQuestDetail } = require('./quests');
const { requireAuth, requireSelf } = require('../lib/auth');
const { getActivePetBonuses } = require('../lib/pets');
const { incrementCounter } = require('../lib/counters');

const router = express.Router();

// Todas las rutas son /:playerId/..., asi que un solo middleware alcanza para exigir login
// y que el token corresponda exactamente a ese jugador (nadie craftea/completa quests por otro).
router.use(requireAuth);
router.use('/:playerId', requireSelf);

// Material que se pierde si falla el crafteo, por rareza del resultado (ver
// sistema_crafteo_gremios_completo.html: Comun/Poco Comun siempre tienen exito).
const FAILURE_LOSS_PERCENT = {
  COMUN: 0,
  POCO_COMUN: 0,
  RARO: 50,
  EPICO: 70,
  LEGENDARIO: 90,
};

// Probabilístico por unidad: cada unidad tiene lossPercent% de chance individual de perderse.
// Evita que Math.ceil convierta porcentajes parciales en 100% de pérdida en cantidades chicas
// (ej. 1 scroll al 70% = siempre perdido con ceil, pero con esto = 70% de chance).
function calcFailLoss(quantity, lossPercent) {
  let lost = 0;
  for (let i = 0; i < quantity; i++) {
    if (Math.random() * 100 < lossPercent) lost++;
  }
  return lost;
}

// Costo de curarse en el gremio: oro por punto de HP recuperado.
const GUILD_HEAL_GOLD_PER_HP = 1;

const EQUIPMENT_SLOTS = ['WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY'];

// Devuelve un Set con los IDs de zonas desbloqueadas para un jugador.
// Misma lógica que GET /:playerId/zones: primera zona siempre, las demás si el jefe de la
// zona anterior fue derrotado O el jugador ya alcanzó el nivel mínimo de esa zona.
async function getUnlockedZoneIds(playerId, playerLevel) {
  const zonesResult = await db.query(
    'SELECT id, min_level FROM monster_zones WHERE is_tower_zone = FALSE ORDER BY min_level'
  );
  const bossQuestsResult = await db.query(
    "SELECT id, zone_id FROM quests WHERE is_boss_quest = TRUE AND quest_type = 'PRINCIPAL'"
  );
  const bossQuestByZone = new Map(bossQuestsResult.rows.map((q) => [q.zone_id, q.id]));

  const completionsResult = await db.query(
    `SELECT quest_id FROM player_quest_completions
     WHERE player_id = $1 AND quest_id = ANY($2::int[])`,
    [playerId, [...bossQuestByZone.values()]]
  );
  const completedQuestIds = new Set(completionsResult.rows.map((r) => r.quest_id));

  let previousBossDefeated = true;
  const unlockedIds = new Set();
  for (const [index, zone] of zonesResult.rows.entries()) {
    const bossQuestId = bossQuestByZone.get(zone.id) || null;
    const bossDefeated = bossQuestId ? completedQuestIds.has(bossQuestId) : false;
    if (index === 0 || previousBossDefeated || playerLevel >= zone.min_level) {
      unlockedIds.add(zone.id);
    }
    previousBossDefeated = bossDefeated;
  }
  return unlockedIds;
}

// GET /api/players/:playerId/bestiary
// IDs de monstruos que el jugador ya enfrentó al menos una vez (para no ocultarles el nombre en el front).
router.get('/:playerId/bestiary', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const result = await db.query(
      'SELECT monster_id FROM player_monster_encounters WHERE player_id = $1',
      [playerId]
    );
    res.json(result.rows.map((r) => r.monster_id));
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/zones
// Una zona (salvo la primera) se desbloquea si el jugador ya derroto al jefe PRINCIPAL
// (is_boss_quest) de la zona anterior, o si ya alcanzo el nivel minimo de esta zona
// (asi un jugador que viene de otro lado/subio de nivel afuera no queda trabado).
// GET /api/player/:playerId/zones
// Devuelve todas las zonas con: estado de combate (boss, nivel), desbloqueo de crafteo y artesanos.
router.get('/:playerId/zones', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const playerResult = await db.query('SELECT level FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const playerLevel = playerResult.rows[0].level;

    const zonesResult = await db.query(
      'SELECT id, name, min_level, max_level, description FROM monster_zones WHERE is_tower_zone = FALSE ORDER BY min_level'
    );

    const bossQuestsResult = await db.query(
      "SELECT id, zone_id FROM quests WHERE is_boss_quest = TRUE"
    );
    const bossQuestByZone = new Map(bossQuestsResult.rows.map((q) => [q.zone_id, q.id]));

    const completionsResult = await db.query(
      `SELECT quest_id FROM player_quest_completions
       WHERE player_id = $1 AND quest_id = ANY($2::int[])`,
      [playerId, [...bossQuestByZone.values()]]
    );
    const completedQuestIds = new Set(completionsResult.rows.map((r) => r.quest_id));

    const craftUnlocksResult = await db.query(
      `SELECT zone_id, unlocked_at FROM player_zone_unlocks WHERE player_id = $1`,
      [playerId]
    );
    const craftUnlockByZone = new Map(craftUnlocksResult.rows.map((r) => [r.zone_id, r.unlocked_at]));

    const artisansResult = await db.query(
      `SELECT zone_id, json_agg(json_build_object('code',code,'name',name,'specialty',specialty) ORDER BY name) AS artisans
       FROM artisans GROUP BY zone_id`
    );
    const artisansByZone = new Map(artisansResult.rows.map((r) => [r.zone_id, r.artisans]));

    let previousBossDefeated = true;
    const zones = zonesResult.rows.map((zone, index) => {
      const bossQuestId = bossQuestByZone.get(zone.id) || null;
      const bossDefeated = bossQuestId ? completedQuestIds.has(bossQuestId) : false;
      const unlocked = index === 0 || previousBossDefeated || playerLevel >= zone.min_level;
      previousBossDefeated = bossDefeated;

      return {
        id: zone.id,
        name: zone.name,
        minLevel: zone.min_level,
        maxLevel: zone.max_level,
        levelRange: `${zone.min_level}-${zone.max_level}`,
        description: zone.description,
        bossDefeated,
        unlocked,
        craftingUnlocked: craftUnlockByZone.has(zone.id),
        craftingUnlockedAt: craftUnlockByZone.get(zone.id) || null,
        artisans: artisansByZone.get(zone.id) || [],
      };
    });

    res.json(zones);
  } catch (error) {
    next(error);
  }
});

// POST /api/player/:playerId/guild/heal
// body vacío           → greedy: cura héroe primero hasta full, luego NPCs en orden de slot.
// { heroOnly: true }   → cura solo al héroe.
// { npcId: N }         → cura solo al NPC N (debe estar en el grupo activo).
// En todos los casos se gasta solo el oro disponible: si no alcanza para el full se cura
// parcialmente (HP primero, mana después) y se cobra solo lo que se usó.
router.post('/:playerId/guild/heal', async (req, res, next) => {
  const { playerId } = req.params;
  const { npcId, heroOnly } = req.body || {};

  // Cuántos puntos de HP/mana cura con el oro dado; prioriza HP sobre maná.
  function calcHeal(missingHp, missingMana, gold) {
    const points = Math.min(missingHp + missingMana, Math.floor(gold / GUILD_HEAL_GOLD_PER_HP));
    const healHp = Math.min(missingHp, points);
    const healMana = Math.min(missingMana, points - healHp);
    return { healHp, healMana, cost: (healHp + healMana) * GUILD_HEAL_GOLD_PER_HP };
  }

  try {
    const [playerResult, petB] = await Promise.all([
      db.query('SELECT hp, max_hp, mana, max_mana, gold FROM players WHERE id = $1', [playerId]),
      getActivePetBonuses(Number(playerId)),
    ]);
    if (!playerResult.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerResult.rows[0];
    const effectiveMaxHp = player.max_hp + petB.hp;
    const effectiveMaxMana = player.max_mana + petB.mana;
    let gold = Number(player.gold);

    if (npcId) {
      const npcRes = await db.query(
        `SELECT pn.id, pn.name, pn.hp, pn.max_hp, pn.mana, pn.max_mana
         FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.player_id = $1 AND pn.id = $2`,
        [playerId, npcId]
      );
      if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo activo' });
      const npc = npcRes.rows[0];

      const { healHp, healMana, cost } = calcHeal(npc.max_hp - npc.hp, npc.max_mana - npc.mana, gold);
      if (healHp + healMana === 0) {
        return res.status(400).json({ error: gold < GUILD_HEAL_GOLD_PER_HP ? 'No tienes oro suficiente' : `${npc.name} ya está al máximo` });
      }
      await db.query('UPDATE player_npcs SET hp = hp + $1, mana = mana + $2 WHERE id = $3', [healHp, healMana, npc.id]);
      await db.query('UPDATE players SET gold = gold - $1, updated_at = now() WHERE id = $2', [cost, playerId]);
      return res.json({ npcId: npc.id, name: npc.name, healedHp: healHp, healedMana: healMana, cost, newGold: gold - cost });
    }

    if (heroOnly) {
      const { healHp, healMana, cost } = calcHeal(effectiveMaxHp - player.hp, effectiveMaxMana - player.mana, gold);
      if (healHp + healMana === 0) {
        return res.status(400).json({ error: gold < GUILD_HEAL_GOLD_PER_HP ? 'No tienes oro suficiente' : 'Ya estás al máximo' });
      }
      await db.query(
        'UPDATE players SET hp = hp + $1, mana = mana + $2, gold = gold - $3, updated_at = now() WHERE id = $4',
        [healHp, healMana, cost, playerId]
      );
      return res.json({ healedHp: healHp, healedMana: healMana, cost, newHp: player.hp + healHp, newMana: player.mana + healMana, newGold: gold - cost });
    }

    // --- Greedy: héroe primero, luego NPCs en orden de slot ---
    const npcRes = await db.query(
      `SELECT pn.id, pn.name, pn.hp, pn.max_hp, pn.mana, pn.max_mana
       FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = $1 ORDER BY pp.slot`,
      [playerId]
    );
    const npcs = npcRes.rows;

    const totalMissing = (effectiveMaxHp - player.hp) + (effectiveMaxMana - player.mana)
      + npcs.reduce((s, n) => s + (n.max_hp - n.hp) + (n.max_mana - n.mana), 0);
    if (totalMissing === 0) return res.status(400).json({ error: 'El héroe y todos los NPCs del grupo ya están al máximo' });
    if (gold < GUILD_HEAL_GOLD_PER_HP) return res.status(400).json({ error: 'No tienes oro suficiente para curar ni 1 punto' });

    let totalCost = 0;
    let heroHealed = null;
    const npcsHealed = [];

    const heroHeal = calcHeal(effectiveMaxHp - player.hp, effectiveMaxMana - player.mana, gold);
    if (heroHeal.healHp + heroHeal.healMana > 0) {
      await db.query('UPDATE players SET hp = hp + $1, mana = mana + $2, updated_at = now() WHERE id = $3', [heroHeal.healHp, heroHeal.healMana, playerId]);
      gold -= heroHeal.cost;
      totalCost += heroHeal.cost;
      heroHealed = { healedHp: heroHeal.healHp, healedMana: heroHeal.healMana };
    }

    for (const npc of npcs) {
      if (gold < GUILD_HEAL_GOLD_PER_HP) break;
      const h = calcHeal(npc.max_hp - npc.hp, npc.max_mana - npc.mana, gold);
      if (h.healHp + h.healMana === 0) continue;
      await db.query('UPDATE player_npcs SET hp = hp + $1, mana = mana + $2 WHERE id = $3', [h.healHp, h.healMana, npc.id]);
      gold -= h.cost;
      totalCost += h.cost;
      npcsHealed.push({ npcId: npc.id, name: npc.name, healedHp: h.healHp, healedMana: h.healMana });
    }

    await db.query('UPDATE players SET gold = gold - $1, updated_at = now() WHERE id = $2', [totalCost, playerId]);
    res.json({ totalCost, newGold: Number(player.gold) - totalCost, hero: heroHealed, npcsHealed });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/skills
// Skills que el jugador puede usar AHORA en combate (boton "Habilidades"): las que ya
// desbloqueo por nivel (LEVEL) o ya aprendio (player_skills, ej. comprada en el gremio), de su
// clase base o evolucionada. "supported" indica si el motor de combate ya sabe resolverla -
// hoy solo ATAQUE/CURACION (ver lib/combat.js resolveSkill); BUFF/DEBUFF con duracion y
// ESPECIAL/ESTADO_ALTERADO quedan listadas pero deshabilitadas hasta que exista ese motor.
router.get('/:playerId/skills', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const playerResult = await db.query(
      'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
      [playerId]
    );
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classIds = [player.current_class_id, player.evolution_class_id].filter(Boolean);

    const skillsResult = await db.query(
      `SELECT s.id, s.code, s.name, s.skill_type, s.damage_school, s.target_type, s.mana_cost,
              s.hits, s.description
       FROM skills s
       WHERE s.is_passive = FALSE AND s.skill_type != 'PASIVA'
         AND s.class_id = ANY($1::int[])
         AND (
           (s.learn_method = 'LEVEL' AND s.learn_level <= $2)
           OR EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = $3 AND ps.skill_id = s.id)
         )
       ORDER BY s.class_id, s.name`,
      [classIds, player.level, playerId]
    );

    const skills = skillsResult.rows.map((s) => {
      const supported = ['ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESPECIAL', 'ESTADO_ALTERADO'].includes(s.skill_type) && !s.is_passive;
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        skillType: s.skill_type,
        damageSchool: s.damage_school,
        targetType: s.target_type,
        manaCost: s.mana_cost,
        hits: s.hits,
        description: s.description,
        supported,
        unsupportedReason: supported ? null : 'Esta habilidad todavía no está disponible en combate.',
      };
    });

    res.json(skills);
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/class-skills?npcId=N
// Todas las skills de la clase del héroe (base + evolución) o de un NPC del grupo.
// Incluye pasivas y activas, aprendidas y no. Para pasivas incluye sus efectos para mostrar
// qué bono dan. Para el héroe "learned" incluye LEVEL y comprado (GOLD/QUEST). Para NPC
// solo LEVEL (los NPCs aprenden automáticamente todas las skills LEVEL de su clase).
router.get('/:playerId/class-skills', async (req, res, next) => {
  const { playerId } = req.params;
  const npcId = req.query.npcId ? Number(req.query.npcId) : null;

  try {
    let classIds, level, isNpc;

    if (npcId) {
      const npcRes = await db.query(
        'SELECT class_id, level FROM player_npcs WHERE id = $1 AND player_id = $2',
        [npcId, playerId]
      );
      if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });
      classIds = [npcRes.rows[0].class_id];
      level = npcRes.rows[0].level;
      isNpc = true;
    } else {
      const playerRes = await db.query(
        'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
        [playerId]
      );
      if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
      const p = playerRes.rows[0];
      classIds = [p.current_class_id, p.evolution_class_id].filter(Boolean);
      level = p.level;
      isNpc = false;
    }

    let skillsRes;
    if (isNpc) {
      skillsRes = await db.query(
        `SELECT s.id, s.name, s.skill_type, s.is_passive, s.learn_method, s.learn_level,
                s.mana_cost, s.target_type, s.damage_school, s.hits, s.description,
                TRUE AS learned
         FROM skills s
         WHERE s.class_id = ANY($1::int[])
           AND s.learn_method = 'LEVEL'
           AND s.learn_level <= $2
         ORDER BY s.is_passive DESC, s.learn_level, s.name`,
        [classIds, level]
      );
    } else {
      skillsRes = await db.query(
        `SELECT s.id, s.name, s.skill_type, s.is_passive, s.learn_method, s.learn_level,
                s.mana_cost, s.target_type, s.damage_school, s.hits, s.description,
                ((s.learn_method = 'LEVEL' AND s.learn_level <= $2)
                 OR EXISTS(SELECT 1 FROM player_skills ps WHERE ps.player_id = $1 AND ps.skill_id = s.id)
                ) AS learned
         FROM skills s
         WHERE s.class_id = ANY($3::int[])
         ORDER BY s.is_passive DESC, s.learn_level, s.name`,
        [playerId, level, classIds]
      );
    }

    if (!skillsRes.rows.length) return res.json([]);

    const skillIds = skillsRes.rows.map((s) => s.id);
    const effectsRes = await db.query(
      `SELECT skill_id, effect_type, stat_code, percent_amount, flat_amount, duration_turns
       FROM skill_effects
       WHERE skill_id = ANY($1::int[])
       ORDER BY skill_id, id`,
      [skillIds]
    );
    const effectsBySkillId = {};
    for (const e of effectsRes.rows) {
      if (!effectsBySkillId[e.skill_id]) effectsBySkillId[e.skill_id] = [];
      effectsBySkillId[e.skill_id].push({
        effectType: e.effect_type,
        statCode: e.stat_code,
        percentAmount: e.percent_amount != null ? Number(e.percent_amount) : null,
        flatAmount: e.flat_amount != null ? Number(e.flat_amount) : null,
        durationTurns: e.duration_turns,
      });
    }

    res.json(skillsRes.rows.map((s) => ({
      id: s.id,
      name: s.name,
      skillType: s.skill_type,
      isPassive: s.is_passive,
      learnMethod: s.learn_method,
      learnLevel: s.learn_level,
      learned: s.learned,
      manaCost: s.mana_cost,
      targetType: s.target_type,
      damageSchool: s.damage_school,
      hits: s.hits,
      description: s.description,
      effects: effectsBySkillId[s.id] || [],
    })));
  } catch (error) { next(error); }
});

// GET /api/players/:playerId/guild/skills?classId=N
// El "maestro de gremio" no es una entidad propia: cada clase es su propio maestro. Si no
// se pasa classId, devuelve las skills de la clase base del jugador (current_class_id, que
// no cambia al evolucionar). Si se pasa classId (para ver un maestro que no es el tuyo),
// se listan igual sus skills pero todas quedan bloqueadas para aprender.
router.get('/:playerId/guild/skills', async (req, res, next) => {
  const { playerId } = req.params;
  const requestedClassId = req.query.classId ? Number(req.query.classId) : null;

  try {
    const playerResult = await db.query('SELECT current_class_id, gold FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classId = requestedClassId || player.current_class_id;
    const isOwnClass = classId === player.current_class_id;

    const skillsResult = await db.query(
      `SELECT s.id, s.code, s.name, s.learn_method, s.learn_gold_cost, s.learn_requirement_text, s.description,
              ps.player_id IS NOT NULL AS learned,
              EXISTS (
                SELECT 1 FROM quests q
                JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
                WHERE q.name = s.learn_requirement_text
              ) AS quest_completed
       FROM skills s
       LEFT JOIN player_skills ps ON ps.skill_id = s.id AND ps.player_id = $1
       WHERE s.class_id = $2 AND s.learn_method IN ('GOLD', 'QUEST')
       ORDER BY s.learn_method, s.name`,
      [playerId, classId]
    );

    const skills = skillsResult.rows.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      description: s.description,
      learnMethod: s.learn_method,
      goldCost: s.learn_gold_cost,
      requirementText: s.learn_requirement_text,
      learned: s.learned,
      locked: !isOwnClass || (s.learn_method === 'QUEST' && !s.quest_completed),
      affordable: isOwnClass && s.learn_method === 'GOLD' ? Number(player.gold) >= s.learn_gold_cost : null,
    }));

    res.json({ gold: Number(player.gold), classId, isOwnClass, skills });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/guild/learn-skill { skillId }
router.post('/:playerId/guild/learn-skill', async (req, res, next) => {
  const { playerId } = req.params;
  const { skillId } = req.body;

  try {
    const skillResult = await db.query('SELECT * FROM skills WHERE id = $1', [skillId]);
    if (!skillResult.rows.length) {
      return res.status(404).json({ error: 'Skill no encontrada' });
    }
    const skill = skillResult.rows[0];

    const playerResult = await db.query('SELECT current_class_id, gold FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    if (skill.class_id !== player.current_class_id) {
      return res.status(400).json({ error: 'Esa skill no es de tu clase' });
    }
    if (!['GOLD', 'QUEST'].includes(skill.learn_method)) {
      return res.status(400).json({ error: 'Esa skill no se puede aprender en el gremio' });
    }

    const already = await db.query('SELECT 1 FROM player_skills WHERE player_id = $1 AND skill_id = $2', [playerId, skillId]);
    if (already.rows.length) {
      return res.status(400).json({ error: 'Ya aprendiste esa skill' });
    }

    if (skill.learn_method === 'QUEST') {
      const questCompleted = await db.query(
        `SELECT 1 FROM quests q
         JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
         WHERE q.name = $2`,
        [playerId, skill.learn_requirement_text]
      );
      if (!questCompleted.rows.length) {
        return res.status(400).json({ error: `Primero debes completar la misión: ${skill.learn_requirement_text}` });
      }
      await db.query('INSERT INTO player_skills(player_id, skill_id) VALUES ($1, $2)', [playerId, skillId]);
      return res.json({ learnedSkillId: skill.id, name: skill.name, cost: 0, newGold: Number(player.gold) });
    }

    const cost = skill.learn_gold_cost;
    if (Number(player.gold) < cost) {
      return res.status(400).json({ error: `No tienes suficiente oro (necesitas ${cost})`, cost, gold: Number(player.gold) });
    }

    const newGold = Number(player.gold) - cost;
    await db.query('UPDATE players SET gold = $1, updated_at = now() WHERE id = $2', [newGold, playerId]);
    await db.query('INSERT INTO player_skills(player_id, skill_id) VALUES ($1, $2)', [playerId, skillId]);

    res.json({ learnedSkillId: skill.id, name: skill.name, cost, newGold });
  } catch (error) {
    next(error);
  }
});

// Precio de venta al gremio para CUALQUIER item del inventario (no solo el set inicial),
// segun su rareza. No es columna de la tabla porque aplica a todos los items, no solo a
// los que tienen buy_price (que son solo el set "Pradera" que vende cada maestro).
const SELL_PRICE_BY_RARITY = {
  COMUN: 20,
  POCO_COMUN: 50,
  RARO: 120,
  EPICO: 300,
  LEGENDARIO: 700,
};

// GET /api/players/:playerId/guild/shop?classId=N
// Tienda del maestro de gremio: vende solo el set basico de nivel 1 de su clase (items con
// buy_price seteado, ver migracion). Igual que en guild/skills, se puede mirar la tienda de
// un maestro que no es el tuyo, pero solo se puede comprar en la de tu propia clase.
router.get('/:playerId/guild/shop', async (req, res, next) => {
  const { playerId } = req.params;
  const requestedClassId = req.query.classId ? Number(req.query.classId) : null;

  try {
    const playerResult = await db.query('SELECT current_class_id, gold FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];
    const classId = requestedClassId || player.current_class_id;
    const isOwnClass = classId === player.current_class_id;

    const itemsResult = await db.query(
      `SELECT id, code, name, slot, rarity, required_level, buy_price, description
       FROM items
       WHERE class_id = $1 AND buy_price IS NOT NULL
       ORDER BY slot`,
      [classId]
    );

    res.json({
      gold: Number(player.gold),
      classId,
      isOwnClass,
      items: itemsResult.rows.map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        slot: i.slot,
        rarity: i.rarity,
        requiredLevel: i.required_level,
        buyPrice: i.buy_price,
        description: i.description,
        affordable: Number(player.gold) >= i.buy_price,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/guild/shop/buy { itemId }
router.post('/:playerId/guild/shop/buy', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId } = req.body;

  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    const item = itemResult.rows[0];
    if (item.buy_price === null) {
      return res.status(400).json({ error: 'Ese item no está a la venta' });
    }

    const playerResult = await db.query('SELECT current_class_id, gold FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const cost = item.buy_price;
    if (Number(player.gold) < cost) {
      return res.status(400).json({ error: `No tienes suficiente oro (necesitas ${cost})`, cost, gold: Number(player.gold) });
    }

    const newGold = Number(player.gold) - cost;
    await db.query('UPDATE players SET gold = $1, updated_at = now() WHERE id = $2', [newGold, playerId]);
    await inventory.addItem(playerId, item.id, 1);

    res.json({ boughtItemId: item.id, name: item.name, cost, newGold });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/guild/shop/sell { itemId, quantity, enchantLevel? }
// Solo opera contra player_inventory (lo no equipado): un item equipado nunca aparece ahi,
// asi que no hace falta validacion extra para evitar vender lo que tienes puesto.
router.post('/:playerId/guild/shop/sell', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, quantity, enchantLevel = 0 } = req.body;
  const qty = Number(quantity) || 1;

  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    const item = itemResult.rows[0];

    const owned = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (owned < qty) {
      return res.status(400).json({ error: 'No tienes esa cantidad en tu inventario' });
    }

    // La venta siempre es la mitad del precio de compra (buy_price) cuando el item se vende
    // en algun gremio. Para items que no estan a la venta en ninguna tienda (drops, etc.) no
    // hay "costo" que reducir a la mitad, asi que se usa la tabla por rareza como respaldo.
    const unitPrice = item.buy_price !== null ? Math.round(item.buy_price / 2) : (SELL_PRICE_BY_RARITY[item.rarity] || 10);
    const total = unitPrice * qty;

    await inventory.removeItem(playerId, itemId, qty, enchantLevel);
    const updated = await db.query(
      'UPDATE players SET gold = gold + $1, updated_at = now() WHERE id = $2 RETURNING gold',
      [total, playerId]
    );

    res.json({ soldItemId: item.id, name: item.name, quantitySold: qty, goldGained: total, newGold: Number(updated.rows[0].gold) });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/evolutions
// Evoluciones posibles desde la clase efectiva actual (evolution_class_id si ya evoluciono antes,
// sino current_class_id), con el detalle de que requisito falta. Los requisitos tipo COUNTER
// (la mayoria, ej. "100 kills con fuego") quedan con available=false: todavia no existe sistema
// de contadores de jugador (ver lib/evolution.js).
router.get('/:playerId/evolutions', async (req, res, next) => {
  try {
    const result = await evolution.getAvailableEvolutions(req.params.playerId);
    if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/evolve { evolutionId }
router.post('/:playerId/evolve', async (req, res, next) => {
  const { evolutionId } = req.body;
  if (!evolutionId) return res.status(400).json({ error: 'evolutionId es requerido' });

  try {
    const result = await evolution.evolvePlayer(req.params.playerId, evolutionId);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/inventory?type=EQUIPMENT&slot=WEAPON&rarity=RARO
router.get('/:playerId/inventory', async (req, res, next) => {
  const { type, slot, rarity } = req.query;
  const conditions = ['pi.player_id = $1'];
  const params = [req.params.playerId];

  if (type) {
    params.push(type);
    conditions.push(`i.item_type = $${params.length}`);
  }
  if (slot) {
    params.push(slot);
    conditions.push(`i.slot = $${params.length}`);
  }
  if (rarity) {
    params.push(rarity);
    conditions.push(`i.rarity = $${params.length}`);
  }

  try {
    const result = await db.query(
      `SELECT pi.id AS inventory_id, pi.item_id, pi.enchant_level, pi.quality_tier, pi.quantity,
              i.code, i.name, i.item_type, i.slot, i.rarity, i.class_id,
              i.required_level, i.is_two_handed,
              (EXISTS (SELECT 1 FROM crafting_recipes cr2 WHERE cr2.scroll_item_id = i.id)) AS is_scroll,
              (
                EXISTS (SELECT 1 FROM crafting_recipes cr2 WHERE cr2.scroll_item_id = i.id)
                AND NOT EXISTS (
                  SELECT 1 FROM crafting_recipes cr3
                  WHERE cr3.scroll_item_id = i.id
                  AND NOT EXISTS (
                    SELECT 1 FROM player_learned_recipes plr2
                    WHERE plr2.recipe_id = cr3.id AND plr2.player_id = pi.player_id
                  )
                )
              ) AS recipe_already_learned
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY i.item_type, pi.quality_tier DESC, pi.enchant_level DESC, i.name`,
      params
    );
    const RARITY_NAMES = ['COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO'];
    res.json(result.rows.map((r) => ({
      ...r,
      effective_rarity: RARITY_NAMES[Math.min(RARITY_NAMES.indexOf(r.rarity) + r.quality_tier, 4)] ?? r.rarity,
    })));
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/inventory/use/:itemId — usar un scroll para aprender una receta
router.post('/:playerId/inventory/use/:itemId', async (req, res, next) => {
  const { playerId, itemId } = req.params;
  try {
    const owned = await inventory.getQuantity(playerId, itemId);
    if (owned < 1) return res.status(400).json({ error: 'No tienes ese item en tu inventario' });

    const recipeRes = await db.query(
      `SELECT cr.id AS recipe_id, res.name AS result_name
       FROM crafting_recipes cr
       JOIN items res ON res.id = cr.result_item_id
       WHERE cr.scroll_item_id = $1`,
      [itemId]
    );
    if (!recipeRes.rows.length) return res.status(400).json({ error: 'Este item no es un pergamino de receta' });

    const learnedRes = await db.query(
      'SELECT recipe_id FROM player_learned_recipes WHERE player_id = $1 AND recipe_id = ANY($2::int[])',
      [playerId, recipeRes.rows.map((r) => r.recipe_id)]
    );
    const alreadyLearnedIds = new Set(learnedRes.rows.map((r) => r.recipe_id));
    const newRecipes = recipeRes.rows.filter((r) => !alreadyLearnedIds.has(r.recipe_id));

    if (!newRecipes.length) {
      return res.json({ message: 'Ya conocías todas las recetas de este pergamino', alreadyLearned: true, learnedRecipes: [] });
    }

    await inventory.removeItem(playerId, itemId, 1);
    for (const r of newRecipes) {
      await db.query(
        'INSERT INTO player_learned_recipes(player_id, recipe_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [playerId, r.recipe_id]
      );
    }

    res.json({
      message: `Aprendiste ${newRecipes.length} receta(s) nueva(s)`,
      alreadyLearned: false,
      learnedRecipes: newRecipes.map((r) => ({ recipeId: r.recipe_id, resultName: r.result_name })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/equipment - los 7 slots, con el item puesto (o null) en cada uno.
router.get('/:playerId/equipment', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT pe.slot, pe.enchant_level, pe.quality_tier, i.id AS item_id, i.code, i.name, i.rarity, i.is_two_handed, i.required_level
       FROM player_equipment pe
       JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = $1`,
      [req.params.playerId]
    );
    const bySlot = {};
    for (const row of result.rows) bySlot[row.slot] = row;

    const equipment = EQUIPMENT_SLOTS.map((slot) => {
      const row = bySlot[slot];
      return {
        slot,
        item: row
          ? {
              itemId: row.item_id,
              code: row.code,
              name: row.name,
              rarity: row.rarity,
              effectiveRarity: (() => {
                const RN = ['COMUN','POCO_COMUN','RARO','EPICO','LEGENDARIO'];
                return RN[Math.min(RN.indexOf(row.rarity) + (row.quality_tier || 0), 4)] ?? row.rarity;
              })(),
              qualityTier: row.quality_tier || 0,
              isTwoHanded: row.is_two_handed,
              requiredLevel: row.required_level,
              enchantLevel: row.enchant_level,
            }
          : null,
      };
    });

    res.json(equipment);
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/equip { itemId, enchantLevel? }
// Saca el item del inventario y lo pone en su slot. Si ocupaba algo ese slot (o OFFHAND, en
// caso de un arma a dos manos), eso vuelve al inventario con su enchant_level original.
router.post('/:playerId/equip', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, enchantLevel = 0, qualityTier: requestedTier = 0 } = req.body;

  try {
    const itemResult = await db.query('SELECT * FROM items WHERE id = $1', [itemId]);
    if (!itemResult.rows.length) {
      return res.status(404).json({ error: 'Item no encontrado' });
    }
    const item = itemResult.rows[0];

    if (item.item_type !== 'EQUIPMENT' || !item.slot) {
      return res.status(400).json({ error: 'Ese item no es equipable' });
    }

    const owned = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (owned < 1) {
      return res.status(400).json({ error: 'No tienes ese item en tu inventario' });
    }

    const playerResult = await db.query(
      'SELECT current_class_id, level FROM players WHERE id = $1',
      [playerId]
    );
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    if (item.class_id && item.class_id !== player.current_class_id) {
      return res.status(400).json({ error: 'Ese item no es de tu clase' });
    }
    if (item.required_level && player.level < item.required_level) {
      return res.status(400).json({ error: `Necesitas nivel ${item.required_level} para equipar esto` });
    }

    if (item.slot === 'OFFHAND') {
      const weapon = await db.query(
        `SELECT i.is_two_handed FROM player_equipment pe
         JOIN items i ON i.id = pe.item_id
         WHERE pe.player_id = $1 AND pe.slot = 'WEAPON'`,
        [playerId]
      );
      if (weapon.rows.length && weapon.rows[0].is_two_handed) {
        return res.status(400).json({ error: 'Tu arma actual ocupa las dos manos' });
      }
    }

    // HP efectivo (ver lib/equipment.js): se mide el bono de equipo antes y despues del swap
    // para aplicar solo el delta a players.hp/max_hp, sin importar cuantos slots cambiaron
    // (ej. equipar un arma a dos manos tambien libera el offhand).
    const bonusBefore = await getEquipmentBonuses(playerId);

    const previous = await db.query(
      `DELETE FROM player_equipment WHERE player_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier`,
      [playerId, item.slot]
    );
    if (previous.rows.length) {
      await inventory.addItem(playerId, previous.rows[0].item_id, 1, previous.rows[0].enchant_level, previous.rows[0].quality_tier || 0);
    }

    if (item.is_two_handed) {
      const previousOffhand = await db.query(
        `DELETE FROM player_equipment WHERE player_id = $1 AND slot = 'OFFHAND' RETURNING item_id, enchant_level, quality_tier`,
        [playerId]
      );
      if (previousOffhand.rows.length) {
        await inventory.addItem(playerId, previousOffhand.rows[0].item_id, 1, previousOffhand.rows[0].enchant_level, previousOffhand.rows[0].quality_tier || 0);
      }
    }

    const equipQualityTier = Number(requestedTier);
    const hasIt = await inventory.getQuantity(playerId, itemId, enchantLevel, equipQualityTier);
    if (hasIt < 1) return res.status(400).json({ error: 'No tienes ese item con esa rareza en tu inventario' });

    await inventory.removeItem(playerId, itemId, 1, enchantLevel, equipQualityTier);
    await db.query(
      `INSERT INTO player_equipment(player_id, slot, item_id, enchant_level, quality_tier) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (player_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id, enchant_level = EXCLUDED.enchant_level, quality_tier = EXCLUDED.quality_tier`,
      [playerId, item.slot, itemId, enchantLevel, equipQualityTier]
    );

    const bonusAfter = await getEquipmentBonuses(playerId);
    await applyHpBonusDelta(playerId, (bonusAfter.hp || 0) - (bonusBefore.hp || 0));

    res.json({ slot: item.slot, itemId: item.id, name: item.name });
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/unequip { slot }
router.post('/:playerId/unequip', async (req, res, next) => {
  const { playerId } = req.params;
  const { slot } = req.body;

  if (!EQUIPMENT_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Slot inválido' });
  }

  try {
    const removed = await db.query(
      `DELETE FROM player_equipment WHERE player_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier`,
      [playerId, slot]
    );
    if (!removed.rows.length) {
      return res.status(400).json({ error: 'No tienes nada equipado en ese slot' });
    }
    await inventory.addItem(playerId, removed.rows[0].item_id, 1, removed.rows[0].enchant_level, removed.rows[0].quality_tier || 0);

    // HP efectivo (ver lib/equipment.js): resta exactamente el bono de HP del item sacado.
    const removedHpBonus = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS hp_bonus FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP'`,
      [removed.rows[0].item_id]
    );
    await applyHpBonusDelta(playerId, -Number(removedHpBonus.rows[0].hp_bonus));

    res.json({ slot, unequippedItemId: removed.rows[0].item_id });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/quests/available
router.get('/:playerId/quests/available', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const playerResult = await db.query('SELECT level, rank, current_class_id FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const [questsResult, unlockedZoneIds] = await Promise.all([
      db.query(
        `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
                q.min_level, q.max_level, q.min_rank_code, q.is_repeatable, q.repeat_cooldown_hours,
                q.difficulty_stars, q.description, q.npc_name, q.location_name, q.required_class_id,
                q.reputation_reward, q.gold_reward, q.xp_reward, q.requires_quest_id,
                pqc.times_completed, pqc.last_completed_at,
                paq.id IS NOT NULL AS accepted,
                (q.requires_quest_id IS NULL OR prereq.quest_id IS NOT NULL) AS prerequisite_met
         FROM quests q
         LEFT JOIN monster_zones mz ON mz.id = q.zone_id
         LEFT JOIN player_quest_completions pqc ON pqc.quest_id = q.id AND pqc.player_id = $1
         LEFT JOIN player_active_quests paq ON paq.quest_id = q.id AND paq.player_id = $1
         LEFT JOIN player_quest_completions prereq ON prereq.quest_id = q.requires_quest_id AND prereq.player_id = $1
         WHERE q.quest_type != 'OCULTA'
         ORDER BY q.difficulty_stars DESC, q.zone_id, q.chain_position`,
        [playerId]
      ),
      getUnlockedZoneIds(playerId, player.level),
    ]);

    const available = questsResult.rows.filter((q) => {
      // Quests de zona sólo visibles si esa zona está desbloqueada
      if (q.zone_id && !unlockedZoneIds.has(q.zone_id)) return false;
      if (q.required_class_id && q.required_class_id !== player.current_class_id) return false;
      if (q.min_rank_code && !rankAtLeast(player.rank, q.min_rank_code)) return false;
      if (!q.prerequisite_met) return false;
      // Ya completada: si NO es repetible, no vuelve a aparecer nunca mas (es de 1 sola vez).
      // Si es repetible, se oculta solo mientras dure el cooldown desde la ultima entrega.
      if (q.times_completed) {
        if (!q.is_repeatable) return false;
        if (q.repeat_cooldown_hours) {
          const cooldownMs = q.repeat_cooldown_hours * 60 * 60 * 1000;
          if (Date.now() - new Date(q.last_completed_at).getTime() < cooldownMs) return false;
        }
      }
      return true;
    }).map((q) => ({ ...q, meets_level: !q.min_level || player.level >= q.min_level }));

    res.json(await questProgress.attachObjectives(playerId, available));
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/quests/:questId/accept
// Marca una quest como "en curso" para que aparezca en /quests/active (panel Quests del
// dashboard). Mismas validaciones que completarla, asi no se puede aceptar algo que de
// todas formas no se podria entregar (nivel/rango/cooldown).
router.post('/:playerId/quests/:questId/accept', async (req, res, next) => {
  const { playerId, questId } = req.params;

  try {
    const playerResult = await db.query('SELECT level, rank, current_class_id FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const quest = await fetchQuestDetail(questId);
    if (!quest) return res.status(404).json({ error: 'Quest no encontrada' });

    if (quest.required_class_id && quest.required_class_id !== player.current_class_id) {
      return res.status(403).json({ error: 'Esta misión es solo para tu clase' });
    }
    if (quest.min_level && player.level < quest.min_level) {
      return res.status(400).json({ error: `Requiere nivel ${quest.min_level}` });
    }
    if (quest.min_rank_code && !rankAtLeast(player.rank, quest.min_rank_code)) {
      return res.status(400).json({ error: `Requiere rango ${quest.min_rank_code} o superior` });
    }
    if (quest.requires_quest_id) {
      const prereq = await db.query(
        'SELECT 1 FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
        [playerId, quest.requires_quest_id]
      );
      if (!prereq.rows.length) {
        return res.status(400).json({ error: 'Todavía no completaste la misión previa requerida' });
      }
    }

    const completionResult = await db.query(
      'SELECT times_completed, last_completed_at FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    if (completionResult.rows.length) {
      if (!quest.is_repeatable) {
        return res.status(400).json({ error: 'Ya completaste esta misión (es de una sola vez)' });
      }
      if (quest.repeat_cooldown_hours) {
        const cooldownMs = quest.repeat_cooldown_hours * 60 * 60 * 1000;
        if (Date.now() - new Date(completionResult.rows[0].last_completed_at).getTime() < cooldownMs) {
          return res.status(400).json({ error: 'Esta quest diaria todavía está en cooldown' });
        }
      }
    }

    const already = await db.query(
      'SELECT 1 FROM player_active_quests WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    if (already.rows.length) {
      return res.status(400).json({ error: 'Ya aceptaste esta quest' });
    }

    await db.query('INSERT INTO player_active_quests(player_id, quest_id) VALUES ($1, $2)', [playerId, questId]);

    res.json({ acceptedQuestId: quest.id, name: quest.name });
  } catch (error) {
    next(error);
  }
});

// GET /api/players/:playerId/quests/active
// Quests aceptadas y todavia no entregadas (panel "Mis Quests" del dashboard).
router.get('/:playerId/quests/active', async (req, res, next) => {
  const { playerId } = req.params;

  try {
    const result = await db.query(
      `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
              q.min_level, q.max_level, q.min_rank_code, q.is_repeatable,
              q.difficulty_stars, q.description, q.npc_name, q.location_name,
              q.reputation_reward, q.gold_reward, q.xp_reward, paq.accepted_at
       FROM player_active_quests paq
       JOIN quests q ON q.id = paq.quest_id
       LEFT JOIN monster_zones mz ON mz.id = q.zone_id
       WHERE paq.player_id = $1
       ORDER BY paq.accepted_at`,
      [playerId]
    );
    res.json(await questProgress.attachObjectives(playerId, result.rows));
  } catch (error) {
    next(error);
  }
});

// Valida que los objetivos de la quest (quest_objectives) ya se cumplieron antes de pagar
// recompensas. KILL_MONSTER/DEFEAT_BOSS/KILL_ANY_IN_ZONE se miran contra player_quest_progress
// (que combat.js llena via lib/questProgress.js al ganar peleas); COLLECT_ITEM se mira directo
// contra player_inventory porque ese conteo ya existe ahi. Las OCULTA no tienen quest_objectives
// (su condicion vive en quest_hidden_requirements, ver seed.sql) asi que no entran a este loop.
async function findUnmetObjective(playerId, quest) {
  if (!quest.objectives.length) return null;

  const progressByObjectiveId = await questProgress.getProgressForQuest(playerId, quest.id);

  for (const objective of quest.objectives) {
    if (objective.objective_type === 'COLLECT_ITEM') {
      const have = await inventory.getQuantity(playerId, objective.item_id);
      if (have < objective.target_count) return objective;
    } else {
      const current = progressByObjectiveId.get(objective.objective_id) || 0;
      if (current < objective.target_count) return objective;
    }
  }
  return null;
}

// POST /api/players/:playerId/quests/:questId/complete
router.post('/:playerId/quests/:questId/complete', async (req, res, next) => {
  const { playerId, questId } = req.params;

  try {
    const playerResult = await db.query('SELECT level, rank, xp, gold, reputation, current_class_id FROM players WHERE id = $1', [playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const quest = await fetchQuestDetail(questId);
    if (!quest) return res.status(404).json({ error: 'Quest no encontrada' });

    if (quest.required_class_id && quest.required_class_id !== player.current_class_id) {
      return res.status(403).json({ error: 'Esta misión es solo para tu clase' });
    }
    if (quest.min_level && player.level < quest.min_level) {
      return res.status(400).json({ error: `Requiere nivel ${quest.min_level}` });
    }
    if (quest.min_rank_code && !rankAtLeast(player.rank, quest.min_rank_code)) {
      return res.status(400).json({ error: `Requiere rango ${quest.min_rank_code} o superior` });
    }
    if (quest.requires_quest_id) {
      const prereq = await db.query(
        'SELECT 1 FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
        [playerId, quest.requires_quest_id]
      );
      if (!prereq.rows.length) {
        return res.status(400).json({ error: 'Todavía no completaste la misión previa requerida' });
      }
    }

    const completionResult = await db.query(
      'SELECT times_completed, last_completed_at FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );

    if (completionResult.rows.length) {
      if (!quest.is_repeatable) {
        return res.status(400).json({ error: 'Ya completaste esta misión (es de una sola vez)' });
      }
      if (quest.repeat_cooldown_hours) {
        const cooldownMs = quest.repeat_cooldown_hours * 60 * 60 * 1000;
        if (Date.now() - new Date(completionResult.rows[0].last_completed_at).getTime() < cooldownMs) {
          return res.status(400).json({ error: 'Esta quest diaria todavía está en cooldown' });
        }
      }
    }

    const unmetObjective = await findUnmetObjective(playerId, quest);
    if (unmetObjective) {
      return res.status(400).json({
        error: `Objetivo incompleto: ${unmetObjective.description || 'todavía faltan requisitos por cumplir'}`,
      });
    }

    // El bonus de XP/oro lo da el rango que el jugador tiene AL COMPLETAR la quest (antes de
    // que esta misma entrega lo suba de rango), igual que xpBonus/moneyBonus en
    // GET /api/player/:id/reputation.
    const { xpBonusPercent, rewardBonusPercent } = await getRankBonuses(player.rank);
    const questAchBonuses = await achievements.getPlayerBonuses(playerId);
    const bonusedGold = applyPercentBonus(applyPercentBonus(quest.gold_reward, rewardBonusPercent), questAchBonuses.goldEarned);
    const bonusedXp = applyPercentBonus(applyPercentBonus(quest.xp_reward, xpBonusPercent), questAchBonuses.xpEarned);

    const newGold = Number(player.gold) + bonusedGold;
    const newReputation = Number(player.reputation) + quest.reputation_reward;
    const newRank = await getRankForReputation(newReputation);

    await db.query(
      'UPDATE players SET gold = $1, reputation = $2, rank = $3, updated_at = now() WHERE id = $4',
      [newGold, newReputation, newRank, playerId]
    );
    if (quest.is_boss_quest) {
      await db.query('UPDATE players SET boss_kills = boss_kills + 1 WHERE id = $1', [playerId]);
    }
    const isCombatQuest = quest.objectives?.some((o) =>
      ['KILL_MONSTER', 'KILL_ANY_IN_ZONE', 'DEFEAT_BOSS'].includes(o.objective_type));
    if (isCombatQuest) await incrementCounter(playerId, 'MISIONES_COMBATE_COMPLETADAS');

    const levelResult = await leveling.applyXpGain(playerId, bonusedXp);

    // NPCs del grupo activo también reciben XP de la quest (mismo reparto que combate).
    const questPartyRes = await db.query(
      `SELECT pn.id AS npc_id, pn.name
       FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = $1`,
      [playerId]
    );
    const questNpcLevelUps = [];
    if (questPartyRes.rows.length > 0) {
      const questPartySize = 1 + questPartyRes.rows.length;
      const npcQuestXp = Math.floor(bonusedXp / questPartySize);
      for (const npc of questPartyRes.rows) {
        const npcResult = await leveling.applyNpcXpGain(npc.npc_id, npcQuestXp);
        if (npcResult && npcResult.leveledUp) {
          questNpcLevelUps.push({ npcId: npc.npc_id, npcName: npc.name, newLevel: npcResult.newLevel });
        }
      }
    }

    await db.query(
      `INSERT INTO player_quest_completions(player_id, quest_id, times_completed, last_completed_at)
       VALUES ($1, $2, 1, now())
       ON CONFLICT (player_id, quest_id)
       DO UPDATE SET times_completed = player_quest_completions.times_completed + 1, last_completed_at = now()`,
      [playerId, questId]
    );
    await db.query('DELETE FROM player_active_quests WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
    await questProgress.clearProgressForQuest(playerId, questId);

    for (const reward of quest.itemRewards) {
      await inventory.addItem(playerId, reward.item_id, reward.quantity);
    }

    const timesCompletedRes = await db.query(
      'SELECT times_completed FROM player_quest_completions WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    const timesCompleted = timesCompletedRes.rows[0]?.times_completed || 1;
    const unlockedAchievements = await achievements.checkQuestAchievements(playerId, questId, timesCompleted);

    res.json({
      questCompleted: quest.name,
      xpGained: bonusedXp,
      goldGained: bonusedGold,
      reputationGained: quest.reputation_reward,
      rankBonusApplied: { xpBonusPercent, rewardBonusPercent },
      newRank,
      leveledUp: levelResult ? levelResult.leveledUp : false,
      newLevel: levelResult ? levelResult.newLevel : undefined,
      itemsGained: quest.itemRewards,
      npcLevelUps: questNpcLevelUps,
      unlockedAchievements: unlockedAchievements.map((a) => ({
        code: a.code,
        name: a.name,
        description: a.description,
        bonusCategory: a.bonus_category,
        bonusPercent: a.bonus_percent,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/player/:playerId/quests/:questId/abandon
// Abandona una quest activa: borra el registro de player_active_quests y limpia el progreso
// de objetivos. No se puede abandonar una quest de jefe PRINCIPAL porque desbloquea la zona
// siguiente (aceptarla de nuevo pierde el progreso, pero no bloquea el juego).
router.delete('/:playerId/quests/:questId/abandon', async (req, res, next) => {
  const { playerId, questId } = req.params;
  try {
    const activeResult = await db.query(
      'SELECT 1 FROM player_active_quests WHERE player_id = $1 AND quest_id = $2',
      [playerId, questId]
    );
    if (!activeResult.rows.length) {
      return res.status(400).json({ error: 'No tienes esa quest activa' });
    }

    const questResult = await db.query(
      'SELECT name, is_boss_quest, quest_type FROM quests WHERE id = $1',
      [questId]
    );
    if (!questResult.rows.length) return res.status(404).json({ error: 'Quest no encontrada' });
    const quest = questResult.rows[0];

    if (quest.is_boss_quest && quest.quest_type === 'PRINCIPAL') {
      return res.status(400).json({ error: 'No puedes abandonar la quest de jefe principal — es necesaria para desbloquear la siguiente zona' });
    }

    await db.query('DELETE FROM player_active_quests WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
    await questProgress.clearProgressForQuest(playerId, questId);

    res.json({ abandoned: true, questName: quest.name });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/quests/completed
// Historial de quests completadas: cuántas veces y cuándo fue la última entrega.
// Ordenado por última completada desc (las más recientes primero).
router.get('/:playerId/quests/completed', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT q.id, q.code, q.name, q.quest_type, q.zone_id, mz.name AS zone_name,
              q.difficulty_stars, q.is_repeatable, q.repeat_cooldown_hours,
              q.reputation_reward, q.gold_reward, q.xp_reward,
              q.npc_name, q.location_name,
              pqc.times_completed, pqc.last_completed_at
       FROM player_quest_completions pqc
       JOIN quests q ON q.id = pqc.quest_id
       LEFT JOIN monster_zones mz ON mz.id = q.zone_id
       WHERE pqc.player_id = $1
       ORDER BY pqc.last_completed_at DESC`,
      [playerId]
    );

    const rewardsResult = await db.query(
      `SELECT qir.quest_id, i.name AS item_name, i.code AS item_code, qir.quantity
       FROM quest_item_rewards qir
       JOIN items i ON i.id = qir.item_id
       WHERE qir.quest_id = ANY($1::int[])`,
      [result.rows.map((q) => q.id)]
    );
    const rewardsByQuestId = new Map();
    for (const r of rewardsResult.rows) {
      if (!rewardsByQuestId.has(r.quest_id)) rewardsByQuestId.set(r.quest_id, []);
      rewardsByQuestId.get(r.quest_id).push({ itemCode: r.item_code, itemName: r.item_name, quantity: r.quantity });
    }

    res.json(result.rows.map((q) => ({
      id: q.id,
      code: q.code,
      name: q.name,
      questType: q.quest_type,
      zoneName: q.zone_name,
      difficultyStar: q.difficulty_stars,
      isRepeatable: q.is_repeatable,
      repeatCooldownHours: q.repeat_cooldown_hours,
      rewards: {
        reputation: q.reputation_reward,
        gold: q.gold_reward,
        xp: q.xp_reward,
        items: rewardsByQuestId.get(q.id) || [],
      },
      npcName: q.npc_name,
      locationName: q.location_name,
      timesCompleted: q.times_completed,
      lastCompletedAt: q.last_completed_at,
    })));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/achievements
// Lista todos los logros del juego con estado desbloqueado/bloqueado para el jugador.
// Incluye progreso de completaciones de la quest asociada para los bloqueados.
router.get('/:playerId/achievements', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const result = await db.query(
      `SELECT a.id, a.code, a.name, a.description,
              a.threshold, a.bonus_type, a.bonus_category, a.bonus_percent,
              pa.unlocked_at,
              pqc.times_completed
       FROM achievements a
       LEFT JOIN player_achievements pa ON pa.achievement_id = a.id AND pa.player_id = $1
       LEFT JOIN player_quest_completions pqc ON pqc.quest_id = a.quest_id AND pqc.player_id = $1
       ORDER BY a.id`,
      [playerId]
    );
    res.json(result.rows.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      description: a.description,
      threshold: a.threshold,
      bonus: { type: a.bonus_type, category: a.bonus_category, percent: a.bonus_percent },
      unlocked: !!a.unlocked_at,
      unlockedAt: a.unlocked_at,
      progress: { current: Number(a.times_completed || 0), required: a.threshold },
    })));
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/craft/available
// Solo recetas de zonas desbloqueadas + recetas scroll ya aprendidas.
// Incluye para cada ingrediente cuánto tiene vs cuánto necesita.
router.get('/:playerId/craft/available', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const recipesResult = await db.query(
      `SELECT cr.id, cr.code, i.name AS result_name, cr.result_quantity,
              cr.rarity, cr.success_rate_percent, cr.artisan_name, cr.description,
              cr.scroll_item_id, si.name AS scroll_item_name,
              cr.required_class_id, c.name AS required_class_name, c.code AS required_class_code,
              i.item_type AS result_item_type
       FROM crafting_recipes cr
       JOIN items i ON i.id = cr.result_item_id
       LEFT JOIN items si ON si.id = cr.scroll_item_id
       LEFT JOIN classes c ON c.id = cr.required_class_id
       WHERE (cr.zone_id IS NULL OR cr.zone_id IN (
         SELECT zone_id FROM player_zone_unlocks WHERE player_id = $1
       ))
       AND (cr.scroll_item_id IS NULL OR EXISTS (
         SELECT 1 FROM player_learned_recipes plr WHERE plr.player_id = $1 AND plr.recipe_id = cr.id
       ))
       ORDER BY cr.rarity, i.name`,
      [playerId]
    );

    const available = [];
    for (const recipe of recipesResult.rows) {
      const ingredients = await db.query(
        `SELECT ri.item_id, it.name AS item_name, ri.quantity
         FROM crafting_recipe_ingredients ri
         JOIN items it ON it.id = ri.item_id
         WHERE ri.recipe_id = $1`,
        [recipe.id]
      );

      const ingredientStatus = await Promise.all(
        ingredients.rows.map(async (ing) => {
          const have = await inventory.getQuantity(playerId, ing.item_id);
          return { itemId: ing.item_id, itemName: ing.item_name, need: ing.quantity, have };
        })
      );

      const canCraft = ingredientStatus.every((i) => i.have >= i.need);
      available.push({
        id: recipe.id,
        code: recipe.code,
        resultName: recipe.result_name,
        resultQuantity: recipe.result_quantity,
        resultType: recipe.result_item_type,
        rarity: recipe.rarity,
        successRate: Number(recipe.success_rate_percent),
        artisanName: recipe.artisan_name,
        description: recipe.description,
        classId: recipe.required_class_id,
        className: recipe.required_class_name,
        classCode: recipe.required_class_code,
        canCraft,
        ingredients: ingredientStatus,
      });
    }

    res.json(available);
  } catch (error) {
    next(error);
  }
});

// POST /api/players/:playerId/craft
// body: { recipeCode, quantity? }  — quantity por defecto 1, máx 99
router.post('/:playerId/craft', async (req, res, next) => {
  const { playerId } = req.params;
  const { recipeCode } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!recipeCode) {
    return res.status(400).json({ error: 'recipeCode es requerido' });
  }

  try {
    const recipeResult = await db.query(
      `SELECT cr.id, cr.result_item_id, i.name AS result_name, i.item_type AS result_item_type, cr.result_quantity,
              cr.rarity, cr.success_rate_percent, cr.zone_id, cr.scroll_item_id
       FROM crafting_recipes cr
       JOIN items i ON i.id = cr.result_item_id
       WHERE cr.code = $1`,
      [recipeCode]
    );
    if (!recipeResult.rows.length) {
      return res.status(404).json({ error: 'Receta no encontrada' });
    }
    const recipe = recipeResult.rows[0];

    // Verificar zona desbloqueada
    if (recipe.zone_id) {
      const zoneCheck = await db.query(
        `SELECT 1 FROM player_zone_unlocks WHERE player_id = $1 AND zone_id = $2`,
        [playerId, recipe.zone_id]
      );
      if (!zoneCheck.rows.length) {
        return res.status(403).json({ error: 'Zona no desbloqueada. Vence monstruos de esa zona primero.' });
      }
    }

    // Verificar receta scroll aprendida
    if (recipe.scroll_item_id) {
      const learnedCheck = await db.query(
        `SELECT 1 FROM player_learned_recipes WHERE player_id = $1 AND recipe_id = $2`,
        [playerId, recipe.id]
      );
      if (!learnedCheck.rows.length) {
        return res.status(403).json({ error: 'Receta no aprendida. Consigue el drop del MINIBOSS correspondiente.' });
      }
    }

    const ingredients = await db.query(
      `SELECT ri.item_id, i.name AS item_name, ri.quantity
       FROM crafting_recipe_ingredients ri
       JOIN items i ON i.id = ri.item_id
       WHERE ri.recipe_id = $1`,
      [recipe.id]
    );

    for (const ingredient of ingredients.rows) {
      const have = await inventory.getQuantity(playerId, ingredient.item_id);
      if (have < ingredient.quantity * qty) {
        return res.status(400).json({
          error: `Materiales insuficientes: necesitas ${ingredient.quantity * qty} x ${ingredient.item_name} (tienes ${have})`,
          missingItemId: ingredient.item_id,
        });
      }
    }

    // Luck total: base del jugador + equipo + pasivas del heroe + pasivas de NPCs en el grupo.
    const playerLuckRow = await db.query(
      'SELECT luck, current_class_id, level FROM players WHERE id = $1',
      [playerId]
    );
    const pd = playerLuckRow.rows[0] || {};
    const equipBonus = await getEquipmentBonuses(playerId);
    const heroPassives = await getClassPassiveBonuses(pd.current_class_id, pd.level);
    const partyNpcs = await db.query(
      `SELECT pn.class_id, pn.level FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = $1`,
      [playerId]
    );
    let partyLuck = 0;
    for (const npc of partyNpcs.rows) {
      const np = await getClassPassiveBonuses(npc.class_id, npc.level);
      partyLuck += np.luck || 0;
    }
    const totalLuck = Number(pd.luck || 0) + (equipBonus.luck || 0) + (heroPassives.luck || 0) + partyLuck;

    const RARITY_NAMES = ['COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO'];
    const baseRarityIdx = RARITY_NAMES.indexOf(recipe.rarity);

    // Roll independiente por cada unidad: éxito + luck por separado.
    // tierCounts[t] = cuántas unidades salieron con quality_tier=t.
    const tierCounts = {};
    let successCount = 0;
    let failCount = 0;
    for (let i = 0; i < qty; i++) {
      if (Math.random() * 100 >= Number(recipe.success_rate_percent)) { failCount++; continue; }
      successCount++;
      let tier = 0;
      if (totalLuck > 0 && baseRarityIdx < 4) {
        const maxJumps = 4 - baseRarityIdx;
        let currentChance = totalLuck;
        while (tier < maxJumps && Math.random() * 100 < currentChance) {
          tier++;
          currentChance *= 0.5;
        }
      }
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
    }
    const success = successCount > 0 || failCount < qty;

    // Ingredientes: los exitosos consumen cantidad completa, los fallidos consumen % según rareza.
    for (const ingredient of ingredients.rows) {
      const successCost = ingredient.quantity * successCount;
      const failCost = calcFailLoss(ingredient.quantity * failCount, FAILURE_LOSS_PERCENT[recipe.rarity] ?? 0);
      if (successCost + failCost > 0) await inventory.removeItem(playerId, ingredient.item_id, successCost + failCost);
    }

    // Agregar al inventario agrupado por tier
    const results = [];
    for (const [tier, count] of Object.entries(tierCounts)) {
      const t = Number(tier);
      const gained = recipe.result_quantity * count;
      await inventory.addItem(playerId, recipe.result_item_id, gained, 0, t);
      results.push({ qualityTier: t, quantity: gained, rarity: RARITY_NAMES[Math.min(baseRarityIdx + t, 4)] });
    }

    const totalGained = recipe.result_quantity * successCount;
    const luckyCount = Object.entries(tierCounts).filter(([t]) => Number(t) > 0).reduce((s, [, c]) => s + c, 0);

    if (totalGained > 0 && recipe.result_item_type === 'CONSUMABLE') {
      await incrementCounter(playerId, 'POCIONES_CRAFTEADAS', totalGained);
    }

    res.json({
      success: successCount > 0,
      successCount,
      failCount,
      quantity: qty,
      totalGained,
      luck: totalLuck,
      results,
      message: successCount === 0
        ? `El crafteo falló ${failCount} vez${failCount > 1 ? 'es' : ''}, perdiste parte de los materiales`
        : luckyCount > 0
          ? `¡${luckyCount} crafteo${luckyCount > 1 ? 's' : ''} con suerte! Obtuviste ${totalGained}x ${recipe.result_name}`
          : `Crafteo exitoso: obtuviste ${totalGained}x ${recipe.result_name}`,
      item: successCount > 0 ? { id: recipe.result_item_id, name: recipe.result_name } : null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/player/:playerId/dismantle
// body: { itemId, quantity? } — desmantela un ítem crafteado y devuelve materiales.
// POST /api/player/:playerId/use-item  body: { itemId, targetNpcId? }
// Usa un consumible fuera de combate sobre el héroe o un NPC del grupo.
// Ignora buffs de stats (ALL_STATS, BUFF_*) y HOT — solo tienen sentido en combate.
router.post('/:playerId/use-item', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, targetNpcId } = req.body;
  if (!itemId) return res.status(400).json({ error: 'itemId es requerido' });
  try {
    const itemRes = await db.query('SELECT id, name, item_type FROM items WHERE id = $1', [itemId]);
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    const item = itemRes.rows[0];
    if (item.item_type !== 'CONSUMABLE') {
      return res.status(400).json({ error: 'Ese item no es consumible' });
    }

    const bestTier = await inventory.getBestQualityTier(playerId, itemId);
    const have = await inventory.getQuantity(playerId, itemId, 0, bestTier);
    if (have < 1) return res.status(400).json({ error: 'No tienes ese item' });

    const bonuses = await db.query(
      'SELECT stat_code, amount, is_percent FROM item_stat_bonuses WHERE item_id = $1',
      [itemId]
    );
    const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];
    const qualityMult = QUALITY_TIER_MULTIPLIER[bestTier] ?? 1;

    // ── Determinar objetivo: héroe o NPC del grupo ──
    let target, targetName;
    if (targetNpcId) {
      const npcRes = await db.query(
        `SELECT pn.id, pn.name, pn.hp, pn.max_hp, pn.mana, pn.max_mana
         FROM player_npcs pn
         JOIN player_party pp ON pp.npc_id = pn.id
         WHERE pn.id = $1 AND pn.player_id = $2`,
        [targetNpcId, playerId]
      );
      if (!npcRes.rows.length) {
        return res.status(404).json({ error: 'Ese NPC no está en tu grupo activo' });
      }
      target = npcRes.rows[0];
      targetName = target.name;
    } else {
      const playerRes = await db.query('SELECT hp, max_hp, mana, max_mana FROM players WHERE id = $1', [playerId]);
      target = playerRes.rows[0];
      targetName = 'tu héroe';
    }

    let newHp = target.hp;
    let newMana = target.mana;
    const applied = [];

    for (const bonus of bonuses.rows) {
      const amount = Math.round(Number(bonus.amount) * qualityMult);
      if (bonus.stat_code === 'HEAL_HP') {
        const before = newHp;
        newHp = Math.min(target.max_hp, newHp + amount);
        if (newHp > before) applied.push(`+${newHp - before} HP`);
      } else if (bonus.stat_code === 'HEAL_MP' || bonus.stat_code === 'RESTORE_MANA') {
        const before = newMana;
        newMana = Math.min(target.max_mana, newMana + amount);
        if (newMana > before) applied.push(`+${newMana - before} Maná`);
      }
    }

    if (applied.length === 0) {
      return res.status(400).json({ error: `${targetName} ya tiene el HP y Maná al máximo` });
    }

    if (targetNpcId) {
      await db.query('UPDATE player_npcs SET hp = $1, mana = $2 WHERE id = $3', [newHp, newMana, targetNpcId]);
    } else {
      await db.query('UPDATE players SET hp = $1, mana = $2, updated_at = now() WHERE id = $3', [newHp, newMana, playerId]);
    }
    await inventory.removeItem(playerId, itemId, 1, 0, bestTier);

    // Construir mensaje descriptivo
    const effectDesc = applied.map((a) => {
      if (a.includes('HP')) return `recuperó ${a.replace('+', '')}`;
      if (a.includes('Maná')) return `restauró ${a.replace('+', '')}`;
      return a;
    }).join(' y ');

    let message;
    if (targetNpcId) {
      const casterRes = await db.query('SELECT nickname FROM players WHERE id = $1', [playerId]);
      const casterName = casterRes.rows[0]?.nickname ?? 'El jugador';
      message = `${casterName} usó ${item.name} en ${targetName}: ${targetName} ${effectDesc}`;
    } else {
      message = `Usaste ${item.name}: ${effectDesc}`;
    }

    res.json({
      message,
      targetNpcId: targetNpcId ?? null,
      hp: newHp,
      maxHp: target.max_hp,
      mana: newMana,
      maxMana: target.max_mana,
    });
  } catch (error) { next(error); }
});

// Primero busca override manual en dismantle_recipes; si no hay entrada, deriva los materiales
// de crafting_recipe_ingredients con 50% de retorno (mínimo 1 por material).
router.post('/:playerId/dismantle', async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!itemId) {
    return res.status(400).json({ error: 'itemId es requerido' });
  }

  try {
    let materials = [];

    const dismantleResult = await db.query(
      `SELECT dr.result_item_id, i.name AS result_name, dr.result_quantity
       FROM dismantle_recipes dr
       JOIN items i ON i.id = dr.result_item_id
       WHERE dr.item_id = $1`,
      [itemId]
    );

    if (dismantleResult.rows.length) {
      materials = dismantleResult.rows.map((row) => ({
        itemId: row.result_item_id,
        name: row.result_name,
        quantity: row.result_quantity * qty,
      }));
    } else {
      const ingredientsResult = await db.query(
        `SELECT ri.item_id, i.name AS item_name, ri.quantity
         FROM crafting_recipes cr
         JOIN crafting_recipe_ingredients ri ON ri.recipe_id = cr.id
         JOIN items i ON i.id = ri.item_id
         WHERE cr.result_item_id = $1`,
        [itemId]
      );
      materials = ingredientsResult.rows.map((row) => ({
        itemId: row.item_id,
        name: row.item_name,
        quantity: Math.max(1, Math.floor(row.quantity * qty * 0.5)),
      }));
    }

    if (!materials.length) {
      return res.status(400).json({ error: 'Este ítem no se puede desmantelar' });
    }

    const have = await inventory.getQuantity(playerId, itemId);
    if (have < qty) {
      return res.status(400).json({
        error: `No tienes suficientes unidades (tienes ${have}, necesitas ${qty})`,
      });
    }

    const equippedCheck = await db.query(
      `SELECT 1 FROM player_equipment WHERE player_id = $1 AND item_id = $2`,
      [playerId, itemId]
    );
    if (equippedCheck.rows.length) {
      return res.status(400).json({ error: 'No puedes desmantelar un ítem equipado. Desequípalo primero.' });
    }

    await inventory.removeItem(playerId, itemId, qty);

    const gained = [];
    for (const mat of materials) {
      await inventory.addItem(playerId, mat.itemId, mat.quantity);
      gained.push({ id: mat.itemId, name: mat.name, quantity: mat.quantity });
    }

    const itemNameRow = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    const itemName = itemNameRow.rows[0]?.name ?? 'Ítem';

    res.json({
      success: true,
      message: `Desmantelado exitoso: ${qty}x ${itemName}`,
      materials: gained,
    });
  } catch (error) {
    next(error);
  }
});

// ─── FORMACIÓN / PARTY ───────────────────────────────────────────────────────

const NPC_REFRESH_COST = 150;
const NPC_POOL_SIZE = 5;
const HIRE_COST_PER_LEVEL = 80;
const PARTY_MAX_NPC_SLOTS = 2;
const BENCH_CAP = 10;
const BASE_CLASS_IDS = [1, 2, 3, 4, 5];
const NPC_NAMES = [
  'Aldric', 'Bravos', 'Caelum', 'Draven', 'Eriel', 'Faeron', 'Goreth', 'Hadrix',
  'Ishan', 'Jorath', 'Kael', 'Lyron', 'Marek', 'Navar', 'Orynn', 'Pelion',
  'Riven', 'Solan', 'Tarak', 'Ulvan', 'Varek', 'Waran', 'Xael', 'Yoren', 'Zarek',
  'Aelith', 'Brenna', 'Caelia', 'Dara', 'Elyna', 'Faena', 'Gyra', 'Hessa',
  'Iyla', 'Jarra', 'Kira', 'Lyra', 'Mira', 'Nessa', 'Petra', 'Rhea', 'Sela',
  'Thela', 'Vela', 'Wren', 'Xara', 'Yasha', 'Zara', 'Bram', 'Cedric',
];

async function buildNpcPool(heroLevel) {
  const classesRes = await db.query(
    `SELECT id, name, base_hp, base_atk, base_def, base_mag, base_magic_def,
            base_spd, base_crit_chance, base_mana FROM classes WHERE id = ANY($1)`,
    [BASE_CLASS_IDS]
  );
  const growthsRes = await db.query(
    `SELECT class_id, level_from, level_to, hp_per_level, atk_per_level, def_per_level,
            mag_per_level, magic_def_per_level, spd_per_level, mana_per_level
     FROM class_growths WHERE class_id = ANY($1) ORDER BY class_id, level_from`,
    [BASE_CLASS_IDS]
  );
  const growthsByClass = {};
  for (const g of growthsRes.rows) {
    (growthsByClass[g.class_id] = growthsByClass[g.class_id] || []).push(g);
  }

  const usedNames = [];
  const npcs = [];
  for (let i = 0; i < NPC_POOL_SIZE; i++) {
    const cls = classesRes.rows[Math.floor(Math.random() * classesRes.rows.length)];
    const available = NPC_NAMES.filter((n) => !usedNames.includes(n));
    const name = available[Math.floor(Math.random() * available.length)];
    usedNames.push(name);
    const minLevel = Math.max(1, heroLevel - 1);
    const level = Math.floor(Math.random() * (heroLevel - minLevel + 1)) + minLevel;
    const stats = leveling.computeStatsAtLevel(cls, growthsByClass[cls.id] || [], level);
    npcs.push({ name, classId: cls.id, className: cls.name, level, stats, hireCost: level * HIRE_COST_PER_LEVEL });
  }
  return npcs;
}

function formatNpc(npc, extra = {}) {
  return {
    npcId: npc.id,
    name: npc.name,
    className: npc.class_name,
    classId: npc.class_id,
    level: npc.level,
    xp: npc.xp,
    hp: npc.hp, maxHp: npc.max_hp,
    mana: npc.mana, maxMana: npc.max_mana,
    atk: npc.atk, def: npc.def, int: npc.mag,
    magicDef: npc.magic_def, spd: npc.spd, crit: npc.crit,
    hiredAt: npc.hired_at,
    ...extra,
  };
}

// GET /api/player/:playerId/party
// Slot 1 = héroe, slots 2-3 = NPCs contratados.
router.get('/:playerId/party', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const [heroRes, partyRes] = await Promise.all([
      db.query(
        `SELECT p.nickname, p.level, p.hp, p.max_hp, p.mana, p.max_mana,
                p.atk, p.def, p.mag, p.magic_def, p.spd, p.crit,
                c.id AS class_id, c.name AS class_name, c.code AS class_code, c.base_evasion
         FROM players p JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
         WHERE p.id = $1`,
        [playerId]
      ),
      db.query(
        `SELECT pn.*, pp.id AS party_row_id, pp.slot
         FROM player_party pp
         JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.player_id = $1
         ORDER BY pp.slot`,
        [playerId]
      ),
    ]);
    if (!heroRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const hero = heroRes.rows[0];

    const npcClassIds = partyRes.rows.map((n) => n.class_id);
    const [heroEquip, heroPassives, heroBaseCritDamage, npcResistances, npcBonuses, classXpRates] = await Promise.all([
      getEquipmentBonuses(Number(playerId)),
      getClassPassiveBonuses(hero.class_id, hero.level),
      leveling.getClassBaseCritDamage(hero.class_id),
      npcClassIds.length
        ? db.query(
            `SELECT cer.class_id, e.name AS element, e.code AS element_code, cer.resistance_percent
             FROM class_element_resistances cer JOIN elements e ON e.id = cer.element_id
             WHERE cer.class_id = ANY($1) ORDER BY cer.class_id, e.id`,
            [npcClassIds]
          )
        : Promise.resolve({ rows: [] }),
      npcClassIds.length
        ? db.query(
            `SELECT cedb.class_id, e.name AS element, e.code AS element_code, cedb.damage_bonus
             FROM class_elemental_damage_bonus cedb JOIN elements e ON e.id = cedb.element_id
             WHERE cedb.class_id = ANY($1) ORDER BY cedb.class_id, e.id`,
            [npcClassIds]
          )
        : Promise.resolve({ rows: [] }),
      npcClassIds.length
        ? db.query('SELECT id, xp_rate, base_evasion FROM classes WHERE id = ANY($1)', [npcClassIds])
        : Promise.resolve({ rows: [] }),
    ]);

    // Pasivos y equipo de cada NPC (son pocos en party, max 2)
    const npcDataMap = {};
    await Promise.all(partyRes.rows.map(async (n) => {
      const [passives, equip, baseCritDamage] = await Promise.all([
        getClassPassiveBonuses(n.class_id, n.level),
        getNpcEquipmentBonuses(n.id),
        leveling.getClassBaseCritDamage(n.class_id),
      ]);
      npcDataMap[n.id] = { passives, equip, baseCritDamage };
    }));

    res.json({
      maxSlots: PARTY_MAX_NPC_SLOTS + 1,
      members: [
        {
          slot: 1,
          isHero: true,
          name: hero.nickname,
          className: hero.class_name,
          classCode: hero.class_code,
          level: hero.level,
          hp: Math.min(hero.hp, Math.round(hero.max_hp * (1 + heroPassives.hp / 100))),
          maxHp: Math.round(hero.max_hp * (1 + heroPassives.hp / 100)),
          mana: hero.mana, maxMana: hero.max_mana,
          atk: Math.round(hero.atk * (1 + heroPassives.atk / 100)) + (heroEquip.atk || 0),
          def: Math.round(hero.def * (1 + heroPassives.def / 100)) + (heroEquip.def || 0),
          int: Math.round(hero.mag * (1 + heroPassives.mag / 100)) + (heroEquip.mag || 0),
          magicDef: hero.magic_def + (heroEquip.magic_def || 0),
          spd: Math.round(hero.spd * (1 + heroPassives.spd / 100)) + (heroEquip.spd || 0),
          crit: (Number(hero.crit) + heroPassives.crit_chance + (heroEquip.crit_chance || 0)).toFixed(2),
          evasion: Number(hero.base_evasion) + heroPassives.evasion + (heroEquip.evasion || 0),
          critDamage: heroBaseCritDamage + heroPassives.crit_damage + (heroEquip.crit_damage || 0),
          magicDamageBonus: heroPassives.magic_damage_bonus,
          uniqueSkill: heroPassives.uniqueSkill,
        },
        ...partyRes.rows.map((n) => {
          const classRow = classXpRates.rows.find((c) => c.id === n.class_id);
          const xpRate = classRow ? Number(classRow.xp_rate) : 1;
          const npcBaseEvasion = classRow ? Number(classRow.base_evasion) : 0;
          const xpCurrent = leveling.xpThreshold(n.level, xpRate);
          const xpNext = leveling.xpThreshold(n.level + 1, xpRate);
          const { passives: np, equip: ne, baseCritDamage: npcBaseCritDamage } = npcDataMap[n.id] || { passives: { atk: 0, mag: 0, hp: 0, spd: 0, def: 0, crit_chance: 0, crit_damage: 0, evasion: 0, magic_damage_bonus: 0, uniqueSkill: null }, equip: {}, baseCritDamage: 150 };
          const npcMaxHp = Math.round(n.max_hp * (1 + np.hp / 100));
          return formatNpc(n, {
            slot: n.slot,
            partyRowId: n.party_row_id,
            isHero: false,
            hp: Math.min(n.hp, npcMaxHp),
            maxHp: npcMaxHp,
            xpIntoLevel: Number(n.xp) - xpCurrent,
            xpNeededForLevel: xpNext - xpCurrent,
            atk: Math.round(n.atk * (1 + np.atk / 100)) + (ne.atk || 0),
            def: Math.round(n.def * (1 + np.def / 100)) + (ne.def || 0),
            int: Math.round(n.mag * (1 + np.mag / 100)) + (ne.mag || 0),
            magicDef: n.magic_def + (ne.magic_def || 0),
            spd: Math.round(n.spd * (1 + np.spd / 100)) + (ne.spd || 0),
            crit: (Number(n.crit) + np.crit_chance + (ne.crit_chance || 0)).toFixed(2),
            evasion: npcBaseEvasion + np.evasion + (ne.evasion || 0),
            critDamage: npcBaseCritDamage + np.crit_damage + (ne.crit_damage || 0),
            magicDamageBonus: np.magic_damage_bonus,
            uniqueSkill: np.uniqueSkill,
            resistances: npcResistances.rows
              .filter((r) => r.class_id === n.class_id)
              .map((r) => ({ element: r.element, elementCode: r.element_code, percent: Number(r.resistance_percent) })),
            elementalBonuses: npcBonuses.rows
              .filter((r) => r.class_id === n.class_id)
              .map((r) => ({ element: r.element, elementCode: r.element_code, bonus: Number(r.damage_bonus) })),
          });
        }),
      ],
    });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/party/pool
// Pool de aventureros disponibles. Se auto-regenera gratis cada 30 minutos; el jugador
// puede refrescar antes pagando NPC_REFRESH_COST oro (POST /pool/refresh).
// La respuesta incluye secondsUntilFreeRefresh para que el front pueda mostrar un timer.
router.get('/:playerId/party/pool', async (req, res, next) => {
  const { playerId } = req.params;
  const POOL_AUTO_REFRESH_MS = 30 * 60 * 1000;
  try {
    const [playerRes, poolRes] = await Promise.all([
      db.query('SELECT level, pool_last_generated_at FROM players WHERE id = $1', [playerId]),
      db.query('SELECT * FROM player_npc_pool WHERE player_id = $1 ORDER BY id', [playerId]),
    ]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const { level, pool_last_generated_at } = playerRes.rows[0];

    const lastGen = pool_last_generated_at ? new Date(pool_last_generated_at).getTime() : 0;
    const expired = (Date.now() - lastGen) >= POOL_AUTO_REFRESH_MS;
    let rows = poolRes.rows;
    let genTimestamp = lastGen;

    if (rows.length === 0 || expired) {
      const npcs = await buildNpcPool(level);
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM player_npc_pool WHERE player_id = $1', [playerId]);
        for (const n of npcs) {
          await client.query(
            `INSERT INTO player_npc_pool(player_id, name, class_id, class_name, level,
               hp, mana, atk, def, mag, magic_def, spd, crit, hire_cost)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [playerId, n.name, n.classId, n.className, n.level,
             n.stats.hp, n.stats.mana, n.stats.atk, n.stats.def,
             n.stats.mag, n.stats.magicDef, n.stats.spd, n.stats.crit, n.hireCost]
          );
        }
        await client.query('UPDATE players SET pool_last_generated_at = now() WHERE id = $1', [playerId]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; }
      finally { client.release(); }
      const freshRes = await db.query('SELECT * FROM player_npc_pool WHERE player_id = $1 ORDER BY id', [playerId]);
      rows = freshRes.rows;
      genTimestamp = Date.now();
    }

    const secondsUntilFreeRefresh = Math.ceil(Math.max(0, (genTimestamp + POOL_AUTO_REFRESH_MS - Date.now()) / 1000));

    const classIds = [...new Set(rows.map((n) => n.class_id))];
    const classEvasionRes = await db.query('SELECT id, base_evasion FROM classes WHERE id = ANY($1)', [classIds]);
    const classEvasionMap = Object.fromEntries(classEvasionRes.rows.map((r) => [r.id, Number(r.base_evasion)]));

    const npcs = await Promise.all(rows.map(async (n) => {
      const [passives, baseCritDamage] = await Promise.all([
        getClassPassiveBonuses(n.class_id, n.level),
        leveling.getClassBaseCritDamage(n.class_id),
      ]);
      return {
        poolNpcId: n.id,
        name: n.name,
        className: n.class_name,
        level: n.level,
        hp: n.hp, mana: n.mana, atk: n.atk, def: n.def,
        int: n.mag, magicDef: n.magic_def, spd: n.spd,
        crit: Number(n.crit) + passives.crit_chance,
        evasion: (classEvasionMap[n.class_id] || 0) + passives.evasion,
        critDamage: baseCritDamage + passives.crit_damage,
        hireCost: n.hire_cost,
      };
    }));
    res.json({ refreshCost: NPC_REFRESH_COST, secondsUntilFreeRefresh, npcs });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/pool/refresh
// Paga NPC_REFRESH_COST oro y genera 5 NPCs nuevos.
router.post('/:playerId/party/pool/refresh', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const playerRes = await db.query('SELECT level, gold FROM players WHERE id = $1', [playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const player = playerRes.rows[0];
    if (Number(player.gold) < NPC_REFRESH_COST) {
      return res.status(400).json({ error: `Necesitas ${NPC_REFRESH_COST} oro para buscar nuevos aventureros` });
    }

    const poolData = await buildNpcPool(player.level);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'UPDATE players SET gold = gold - $1, pool_last_generated_at = now() WHERE id = $2',
        [NPC_REFRESH_COST, playerId]
      );
      await client.query('DELETE FROM player_npc_pool WHERE player_id = $1', [playerId]);
      for (const n of poolData) {
        await client.query(
          `INSERT INTO player_npc_pool(player_id, name, class_id, class_name, level,
            hp, mana, atk, def, mag, magic_def, spd, crit, hire_cost)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [playerId, n.name, n.classId, n.className, n.level,
           n.stats.hp, n.stats.mana, n.stats.atk, n.stats.def,
           n.stats.mag, n.stats.magicDef, n.stats.spd, n.stats.crit, n.hireCost]
        );
      }
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const newGoldRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    const poolRes = await db.query('SELECT * FROM player_npc_pool WHERE player_id = $1 ORDER BY id', [playerId]);
    const refreshClassIds = [...new Set(poolRes.rows.map((n) => n.class_id))];
    const refreshEvasionRes = await db.query('SELECT id, base_evasion FROM classes WHERE id = ANY($1)', [refreshClassIds]);
    const refreshEvasionMap = Object.fromEntries(refreshEvasionRes.rows.map((r) => [r.id, Number(r.base_evasion)]));
    const npcs = await Promise.all(poolRes.rows.map(async (n) => {
      const [passives, baseCritDamage] = await Promise.all([
        getClassPassiveBonuses(n.class_id, n.level),
        leveling.getClassBaseCritDamage(n.class_id),
      ]);
      return {
        poolNpcId: n.id,
        name: n.name,
        className: n.class_name,
        level: n.level,
        hp: n.hp, mana: n.mana, atk: n.atk, def: n.def,
        int: n.mag, magicDef: n.magic_def, spd: n.spd,
        crit: Number(n.crit) + passives.crit_chance,
        evasion: (refreshEvasionMap[n.class_id] || 0) + passives.evasion,
        critDamage: baseCritDamage + passives.crit_damage,
        hireCost: n.hire_cost,
      };
    }));
    res.json({ gold: Number(newGoldRes.rows[0].gold), refreshCost: NPC_REFRESH_COST, npcs });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/hire/:poolNpcId
// Contrata un NPC del pool. Crea una entidad en player_npcs; si hay slot libre va al grupo
// activo, si el grupo está lleno va al banco (siempre que el banco no supere BENCH_CAP).
router.post('/:playerId/party/hire/:poolNpcId', async (req, res, next) => {
  const { playerId, poolNpcId } = req.params;
  try {
    const [playerRes, npcRes, partyRes, benchRes] = await Promise.all([
      db.query('SELECT gold FROM players WHERE id = $1', [playerId]),
      db.query('SELECT * FROM player_npc_pool WHERE id = $1 AND player_id = $2', [poolNpcId, playerId]),
      db.query('SELECT slot FROM player_party WHERE player_id = $1', [playerId]),
      db.query('SELECT COUNT(*)::int AS cnt FROM player_bench WHERE player_id = $1', [playerId]),
    ]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el pool' });

    const npc = npcRes.rows[0];
    if (Number(playerRes.rows[0].gold) < npc.hire_cost) {
      return res.status(400).json({ error: `Necesitas ${npc.hire_cost} oro para contratar a ${npc.name}` });
    }

    const takenSlots = partyRes.rows.map((r) => r.slot);
    const freeSlot = [2, 3].find((s) => !takenSlots.includes(s));
    const goToBench = !freeSlot;

    if (goToBench && benchRes.rows[0].cnt >= BENCH_CAP) {
      return res.status(400).json({
        error: `El banco está lleno (máximo ${BENCH_CAP}). Despide a alguien antes de contratar más.`,
      });
    }

    const client = await db.pool.connect();
    let npcId;
    try {
      await client.query('BEGIN');
      await client.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [npc.hire_cost, playerId]);
      // Crear entidad maestra en player_npcs
      const classXpRate = await client.query('SELECT xp_rate FROM classes WHERE id = $1', [npc.class_id]);
      const xpRate = classXpRate.rows.length ? Number(classXpRate.rows[0].xp_rate) : 1;
      const startingXp = leveling.xpThreshold(npc.level, xpRate);
      const npcInsert = await client.query(
        `INSERT INTO player_npcs(player_id, name, class_id, class_name, level, xp,
           hp, max_hp, mana, max_mana, atk, def, mag, magic_def, spd, crit)
         VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id`,
        [playerId, npc.name, npc.class_id, npc.class_name, npc.level, startingXp,
         npc.hp, npc.mana, npc.atk, npc.def, npc.mag, npc.magic_def, npc.spd, npc.crit]
      );
      npcId = npcInsert.rows[0].id;
      if (goToBench) {
        await client.query(
          'INSERT INTO player_bench(player_id, npc_id) VALUES($1,$2)',
          [playerId, npcId]
        );
      } else {
        await client.query(
          'INSERT INTO player_party(player_id, npc_id, slot) VALUES($1,$2,$3)',
          [playerId, npcId, freeSlot]
        );
      }
      await client.query('DELETE FROM player_npc_pool WHERE id = $1', [poolNpcId]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const newGoldRes = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    const destination = goToBench ? 'bench' : 'party';
    res.json({
      destination,
      npcId,
      message: goToBench
        ? `${npc.name} fue al banco de reserva (grupo lleno)`
        : `${npc.name} se unió al grupo en el slot ${freeSlot}`,
      gold: Number(newGoldRes.rows[0].gold),
      ...(freeSlot && { slot: freeSlot }),
    });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/bench
// NPCs en el banco de reserva.
router.get('/:playerId/bench', async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const r = await db.query(
      `SELECT pn.*, pb.id AS bench_row_id
       FROM player_bench pb
       JOIN player_npcs pn ON pn.id = pb.npc_id
       WHERE pb.player_id = $1
       ORDER BY pn.hired_at`,
      [playerId]
    );
    const benchClassIds = [...new Set(r.rows.map((n) => n.class_id))];
    const benchEvasionRes = benchClassIds.length
      ? await db.query('SELECT id, base_evasion FROM classes WHERE id = ANY($1)', [benchClassIds])
      : { rows: [] };
    const benchEvasionMap = Object.fromEntries(benchEvasionRes.rows.map((c) => [c.id, Number(c.base_evasion)]));

    const members = await Promise.all(r.rows.map(async (n) => {
      const [passives, equip, baseCritDamage] = await Promise.all([
        getClassPassiveBonuses(n.class_id, n.level),
        getNpcEquipmentBonuses(n.id),
        leveling.getClassBaseCritDamage(n.class_id),
      ]);
      return formatNpc(n, {
        benchRowId: n.bench_row_id,
        crit: Number(n.crit) + passives.crit_chance + (equip.crit_chance || 0),
        evasion: (benchEvasionMap[n.class_id] || 0) + passives.evasion + (equip.evasion || 0),
        critDamage: baseCritDamage + passives.crit_damage + (equip.crit_damage || 0),
      });
    }));
    res.json({ cap: BENCH_CAP, count: r.rows.length, members });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/swap
// Intercambia los NPCs de los slots 2 y 3 dentro del grupo activo.
// body: { slotA: 2, slotB: 3 }
router.post('/:playerId/party/swap', async (req, res, next) => {
  const { playerId } = req.params;
  const { slotA, slotB } = req.body;
  if (!slotA || !slotB || slotA === slotB) {
    return res.status(400).json({ error: 'Proporciona dos slots distintos (2 y 3)' });
  }
  if (![2, 3].includes(Number(slotA)) || ![2, 3].includes(Number(slotB))) {
    return res.status(400).json({ error: 'Solo se pueden intercambiar los slots 2 y 3 (el slot 1 es el héroe)' });
  }
  try {
    const partyRes = await db.query(
      'SELECT id, slot, npc_id FROM player_party WHERE player_id = $1 AND slot = ANY($2)',
      [playerId, [Number(slotA), Number(slotB)]]
    );
    if (partyRes.rows.length !== 2) {
      return res.status(400).json({ error: 'Ambos slots deben tener un NPC para poder intercambiar' });
    }
    const [a, b] = partyRes.rows.sort((x, y) => x.slot - y.slot);
    // Intercambiar npc_id entre las dos filas de slot fijo — atómico, sin tocar los slots.
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE player_party SET npc_id=$1 WHERE player_id=$2 AND slot=$3', [b.npc_id, playerId, a.slot]);
      await client.query('UPDATE player_party SET npc_id=$1 WHERE player_id=$2 AND slot=$3', [a.npc_id, playerId, b.slot]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ message: `Posiciones de slot ${slotA} y slot ${slotB} intercambiadas` });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/swap-bench
// Intercambia un NPC activo por uno del banco.
// body: { partyRowId, benchRowId }
router.post('/:playerId/party/swap-bench', async (req, res, next) => {
  const { playerId } = req.params;
  const { partyRowId, benchRowId } = req.body;
  if (!partyRowId || !benchRowId) {
    return res.status(400).json({ error: 'partyRowId y benchRowId son requeridos' });
  }
  try {
    const [activeRes, benchMemberRes] = await Promise.all([
      db.query(
        `SELECT pp.id, pp.slot, pp.npc_id, pn.name
         FROM player_party pp JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.id = $1 AND pp.player_id = $2`,
        [partyRowId, playerId]
      ),
      db.query(
        `SELECT pb.id, pb.npc_id, pn.name
         FROM player_bench pb JOIN player_npcs pn ON pn.id = pb.npc_id
         WHERE pb.id = $1 AND pb.player_id = $2`,
        [benchRowId, playerId]
      ),
    ]);
    if (!activeRes.rows.length) return res.status(404).json({ error: 'NPC activo no encontrado en tu grupo' });
    if (!benchMemberRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el banco' });

    const active = activeRes.rows[0];
    const bench = benchMemberRes.rows[0];

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // Actualizar los npc_id en cada tabla — las entidades en player_npcs no se mueven
      await client.query('UPDATE player_party SET npc_id = $1 WHERE id = $2', [bench.npc_id, active.id]);
      await client.query('UPDATE player_bench SET npc_id = $1 WHERE id = $2', [active.npc_id, bench.id]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    res.json({
      message: `${bench.name} entró al grupo (slot ${active.slot}), ${active.name} pasó al banco`,
      slot: active.slot,
    });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/bench/:benchRowId
// Despide un NPC del banco permanentemente (sin devolución de oro).
router.delete('/:playerId/bench/:benchRowId', async (req, res, next) => {
  const { playerId, benchRowId } = req.params;
  try {
    const r = await db.query(
      `SELECT pb.npc_id, pn.name FROM player_bench pb
       JOIN player_npcs pn ON pn.id = pb.npc_id
       WHERE pb.id = $1 AND pb.player_id = $2`,
      [benchRowId, playerId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el banco' });
    // Eliminar la entidad maestra; CASCADE limpia player_bench automáticamente
    await db.query('DELETE FROM player_npcs WHERE id = $1', [r.rows[0].npc_id]);
    res.json({ message: `${r.rows[0].name} fue despedido` });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/party/:partyRowId
// Despide un NPC del grupo (libera el slot, sin devolución de oro).
router.delete('/:playerId/party/:partyRowId', async (req, res, next) => {
  const { playerId, partyRowId } = req.params;
  try {
    const r = await db.query(
      `SELECT pp.npc_id, pp.slot, pn.name FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.id = $1 AND pp.player_id = $2`,
      [partyRowId, playerId]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo' });
    await db.query('DELETE FROM player_npcs WHERE id = $1', [r.rows[0].npc_id]);
    res.json({ message: `${r.rows[0].name} abandonó el grupo (slot ${r.rows[0].slot} liberado)` });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/bench { partyRowId }
// Manda un NPC del grupo activo directo al banco, sin necesitar intercambiarlo por otro.
router.post('/:playerId/party/bench', async (req, res, next) => {
  const { playerId } = req.params;
  const { partyRowId } = req.body;
  if (!partyRowId) return res.status(400).json({ error: 'partyRowId es requerido' });
  try {
    const [partyRes, benchCountRes] = await Promise.all([
      db.query(
        `SELECT pp.id, pp.slot, pp.npc_id, pn.name FROM player_party pp
         JOIN player_npcs pn ON pn.id = pp.npc_id
         WHERE pp.id = $1 AND pp.player_id = $2`,
        [partyRowId, playerId]
      ),
      db.query('SELECT COUNT(*)::int AS cnt FROM player_bench WHERE player_id = $1', [playerId]),
    ]);
    if (!partyRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en tu grupo' });
    if (benchCountRes.rows[0].cnt >= BENCH_CAP) {
      return res.status(400).json({ error: `El banco está lleno (máximo ${BENCH_CAP}). Despide a alguien antes.` });
    }
    const party = partyRes.rows[0];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO player_bench(player_id, npc_id) VALUES($1,$2)', [playerId, party.npc_id]);
      await client.query('DELETE FROM player_party WHERE id = $1', [partyRowId]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ message: `${party.name} pasó al banco (slot ${party.slot} liberado)`, slot: party.slot });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/party/add-from-bench { benchRowId }
// Mueve un NPC del banco a un slot vacío del grupo activo.
router.post('/:playerId/party/add-from-bench', async (req, res, next) => {
  const { playerId } = req.params;
  const { benchRowId } = req.body;
  if (!benchRowId) return res.status(400).json({ error: 'benchRowId es requerido' });
  try {
    const [benchRes, partyRes] = await Promise.all([
      db.query(
        `SELECT pb.id, pb.npc_id, pn.name FROM player_bench pb
         JOIN player_npcs pn ON pn.id = pb.npc_id
         WHERE pb.id = $1 AND pb.player_id = $2`,
        [benchRowId, playerId]
      ),
      db.query('SELECT slot FROM player_party WHERE player_id = $1', [playerId]),
    ]);
    if (!benchRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado en el banco' });
    const takenSlots = partyRes.rows.map((r) => r.slot);
    const freeSlot = [2, 3].find((s) => !takenSlots.includes(s));
    if (!freeSlot) return res.status(400).json({ error: 'El grupo está lleno (máximo 2 NPCs)' });
    const bench = benchRes.rows[0];
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO player_party(player_id, npc_id, slot) VALUES($1,$2,$3)', [playerId, bench.npc_id, freeSlot]);
      await client.query('DELETE FROM player_bench WHERE id = $1', [benchRowId]);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }
    res.json({ message: `${bench.name} entró al grupo en el slot ${freeSlot}`, slot: freeSlot, npcId: bench.npc_id });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/npcs/:npcId
// Stats completas de un NPC contratado, incluyendo bonos de equipo y progresión de XP.
router.get('/:playerId/npcs/:npcId', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const npcRes = await db.query(
      'SELECT * FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });
    const npc = npcRes.rows[0];

    const [classRes, eqBonus, npcPassives, resistRes, bonusRes] = await Promise.all([
      db.query('SELECT xp_rate, base_evasion FROM classes WHERE id = $1', [npc.class_id]),
      getNpcEquipmentBonuses(npcId),
      getClassPassiveBonuses(npc.class_id, npc.level),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cer.resistance_percent
         FROM class_element_resistances cer JOIN elements e ON e.id = cer.element_id
         WHERE cer.class_id = $1 ORDER BY e.id`,
        [npc.class_id]
      ),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cedb.damage_bonus
         FROM class_elemental_damage_bonus cedb JOIN elements e ON e.id = cedb.element_id
         WHERE cedb.class_id = $1 ORDER BY e.id`,
        [npc.class_id]
      ),
    ]);

    const xpRate = classRes.rows.length ? Number(classRes.rows[0].xp_rate) : 1;
    const npcBaseEvasion = classRes.rows.length ? Number(classRes.rows[0].base_evasion) : 0;
    const xpForNext = leveling.xpThreshold(npc.level + 1, xpRate);

    res.json({
      npcId: npc.id,
      name: npc.name,
      className: npc.class_name,
      classId: npc.class_id,
      level: npc.level,
      xp: npc.xp,
      xpForNextLevel: xpForNext,
      hp: npc.hp, maxHp: npc.max_hp,
      mana: npc.mana, maxMana: npc.max_mana,
      atk: npc.atk + (eqBonus.atk || 0),
      def: npc.def + (eqBonus.def || 0),
      int: npc.mag + (eqBonus.mag || 0),
      magicDef: npc.magic_def + (eqBonus.magic_def || 0),
      spd: npc.spd + (eqBonus.spd || 0),
      crit: Number(npc.crit) + npcPassives.crit_chance + (eqBonus.crit_chance || 0),
      evasion: npcBaseEvasion + npcPassives.evasion + (eqBonus.evasion || 0),
      equipmentBonuses: eqBonus,
      resistances: resistRes.rows.map((r) => ({
        element: r.element, elementCode: r.element_code, percent: Number(r.resistance_percent),
      })),
      elementalBonuses: bonusRes.rows.map((r) => ({
        element: r.element, elementCode: r.element_code, bonus: Number(r.damage_bonus),
      })),
      hiredAt: npc.hired_at,
    });
  } catch (error) { next(error); }
});

// ─── EQUIPO DE NPCs ──────────────────────────────────────────────────────────

// GET /api/player/:playerId/npcs/:npcId/equip
// Equipo actual del NPC.
router.get('/:playerId/npcs/:npcId/equip', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const npcRes = await db.query(
      'SELECT id FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });

    const equipRes = await db.query(
      `SELECT ne.slot, ne.enchant_level, ne.quality_tier, i.id AS item_id, i.name, i.rarity, i.slot AS item_slot
       FROM npc_equipment ne
       JOIN items i ON i.id = ne.item_id
       WHERE ne.npc_id = $1`,
      [npcId]
    );
    const RN = ['COMUN','POCO_COMUN','RARO','EPICO','LEGENDARIO'];
    res.json({
      npcId: Number(npcId),
      slots: EQUIPMENT_SLOTS.map((slot) => {
        const equipped = equipRes.rows.find((r) => r.slot === slot);
        return {
          slot,
          item: equipped ? {
            itemId: equipped.item_id,
            name: equipped.name,
            rarity: equipped.rarity,
            effectiveRarity: RN[Math.min(RN.indexOf(equipped.rarity) + (equipped.quality_tier || 0), 4)] ?? equipped.rarity,
            qualityTier: equipped.quality_tier || 0,
            enchantLevel: equipped.enchant_level,
          } : null,
        };
      }),
    });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/npcs/:npcId/equip
// Equipa un item del inventario del jugador al NPC. body: { itemId, enchantLevel? }
router.post('/:playerId/npcs/:npcId/equip', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  const { itemId, enchantLevel = 0, qualityTier: requestedTier = 0 } = req.body;
  try {
    const [itemRes, npcRes] = await Promise.all([
      db.query('SELECT * FROM items WHERE id = $1', [itemId]),
      db.query('SELECT id, class_id, level FROM player_npcs WHERE id = $1 AND player_id = $2', [npcId, playerId]),
    ]);
    if (!itemRes.rows.length) return res.status(404).json({ error: 'Item no encontrado' });
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });

    const item = itemRes.rows[0];
    const npc = npcRes.rows[0];

    if (item.item_type !== 'EQUIPMENT' || !item.slot) {
      return res.status(400).json({ error: 'Ese item no es equipable' });
    }
    const owned = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (owned < 1) {
      return res.status(400).json({ error: 'No tienes ese item en tu inventario' });
    }
    if (item.class_id && item.class_id !== npc.class_id) {
      return res.status(400).json({ error: 'Ese item no es de la clase de este NPC' });
    }
    if (item.required_level && npc.level < item.required_level) {
      return res.status(400).json({ error: `El NPC necesita nivel ${item.required_level} para equipar esto` });
    }
    if (item.slot === 'OFFHAND') {
      const weapon = await db.query(
        `SELECT i.is_two_handed FROM npc_equipment ne
         JOIN items i ON i.id = ne.item_id
         WHERE ne.npc_id = $1 AND ne.slot = 'WEAPON'`,
        [npcId]
      );
      if (weapon.rows.length && weapon.rows[0].is_two_handed) {
        return res.status(400).json({ error: 'El arma actual del NPC ocupa las dos manos' });
      }
    }

    const bonusBefore = await getNpcEquipmentBonuses(npcId);

    const previous = await db.query(
      'DELETE FROM npc_equipment WHERE npc_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier',
      [npcId, item.slot]
    );
    if (previous.rows.length) {
      await inventory.addItem(playerId, previous.rows[0].item_id, 1, previous.rows[0].enchant_level, previous.rows[0].quality_tier || 0);
    }
    if (item.is_two_handed) {
      const prevOffhand = await db.query(
        'DELETE FROM npc_equipment WHERE npc_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier',
        [npcId, 'OFFHAND']
      );
      if (prevOffhand.rows.length) {
        await inventory.addItem(playerId, prevOffhand.rows[0].item_id, 1, prevOffhand.rows[0].enchant_level, prevOffhand.rows[0].quality_tier || 0);
      }
    }

    const npcEquipQualityTier = Number(requestedTier);
    const hasIt = await inventory.getQuantity(playerId, itemId, enchantLevel, npcEquipQualityTier);
    if (hasIt < 1) return res.status(400).json({ error: 'No tienes ese item con esa rareza en tu inventario' });

    await inventory.removeItem(playerId, itemId, 1, enchantLevel, npcEquipQualityTier);
    await db.query(
      `INSERT INTO npc_equipment(npc_id, slot, item_id, enchant_level, quality_tier) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (npc_id, slot) DO UPDATE SET item_id = EXCLUDED.item_id, enchant_level = EXCLUDED.enchant_level, quality_tier = EXCLUDED.quality_tier`,
      [npcId, item.slot, itemId, enchantLevel, npcEquipQualityTier]
    );

    const bonusAfter = await getNpcEquipmentBonuses(npcId);
    await applyNpcHpBonusDelta(npcId, (bonusAfter.hp || 0) - (bonusBefore.hp || 0));

    res.json({ npcId: Number(npcId), slot: item.slot, itemId: item.id, name: item.name });
  } catch (error) { next(error); }
});

// DELETE /api/player/:playerId/npcs/:npcId/equip/:slot
// Desequipa un item del NPC y lo devuelve al inventario del jugador.
router.delete('/:playerId/npcs/:npcId/equip/:slot', async (req, res, next) => {
  const { playerId, npcId, slot } = req.params;
  if (!EQUIPMENT_SLOTS.includes(slot)) {
    return res.status(400).json({ error: 'Slot inválido' });
  }
  try {
    const npcRes = await db.query(
      'SELECT id FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });

    const removed = await db.query(
      'DELETE FROM npc_equipment WHERE npc_id = $1 AND slot = $2 RETURNING item_id, enchant_level, quality_tier',
      [npcId, slot]
    );
    if (!removed.rows.length) {
      return res.status(400).json({ error: 'El NPC no tiene nada equipado en ese slot' });
    }
    await inventory.addItem(playerId, removed.rows[0].item_id, 1, removed.rows[0].enchant_level, removed.rows[0].quality_tier || 0);

    const removedHpBonus = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS hp_bonus FROM item_stat_bonuses
       WHERE item_id = $1 AND stat_code = 'HP'`,
      [removed.rows[0].item_id]
    );
    await applyNpcHpBonusDelta(npcId, -Number(removedHpBonus.rows[0].hp_bonus));

    res.json({ npcId: Number(npcId), slot, unequippedItemId: removed.rows[0].item_id });
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/npcs/:npcId/skills
// Skills disponibles para este NPC: todas las de su clase que aprende por nivel hasta su
// nivel actual. A diferencia del héroe, los NPCs no tienen player_skills; aprenden todas
// las skills LEVEL de su clase automáticamente. supportedInCombat = el motor ya las resuelve.
router.get('/:playerId/npcs/:npcId/skills', async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const npcRes = await db.query(
      'SELECT id, class_id, level FROM player_npcs WHERE id = $1 AND player_id = $2',
      [npcId, playerId]
    );
    if (!npcRes.rows.length) return res.status(404).json({ error: 'NPC no encontrado' });
    const npc = npcRes.rows[0];

    const skillsRes = await db.query(
      `SELECT s.id, s.name, s.skill_type, s.description, s.mana_cost, s.target_type,
              s.learn_level, s.base_value, s.scaling_stat, s.scaling_multiplier, s.hits,
              s.element_id, e.name AS element_name,
              (s.skill_type IN ('ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESPECIAL', 'ESTADO_ALTERADO') AND NOT s.is_passive) AS supported_in_combat
       FROM skills s
       LEFT JOIN elements e ON e.id = s.element_id
       WHERE NOT s.is_passive
         AND (
           (s.class_id = $1 AND s.learn_method = 'LEVEL' AND s.learn_level <= $2)
           OR EXISTS (SELECT 1 FROM npc_skills ns WHERE ns.npc_id = $3 AND ns.skill_id = s.id)
         )
       ORDER BY s.learn_level, s.id`,
      [npc.class_id, npc.level, npc.id]
    );

    res.json(skillsRes.rows.map((s) => ({
      id: s.id,
      name: s.name,
      skillType: s.skill_type,
      description: s.description,
      manaCost: Number(s.mana_cost),
      targetType: s.target_type,
      learnLevel: s.learn_level,
      baseValue: Number(s.base_value),
      scalingStat: s.scaling_stat,
      scalingMultiplier: Number(s.scaling_multiplier),
      hits: s.hits,
      elementId: s.element_id,
      elementName: s.element_name,
      supportedInCombat: s.supported_in_combat,
    })));
  } catch (error) { next(error); }
});

// ─── ENCHANTING ──────────────────────────────────────────────────────────────

const ENCHANT_COSTS = [
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 1, gold:    200, rate: 95 }, // → +1
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 2, gold:    400, rate: 90 }, // → +2
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 3, gold:    600, rate: 85 }, // → +3
  { stone: 'PIEDRA_ENCANT_MENOR',     qty: 4, gold:   1500, rate: 75 }, // → +4
  { stone: 'PIEDRA_ENCANT_MAYOR',     qty: 1, gold:   3000, rate: 65 }, // → +5
  { stone: 'PIEDRA_ENCANT_MAYOR',     qty: 2, gold:   5000, rate: 55 }, // → +6
  { stone: 'PIEDRA_ENCANT_MAYOR',     qty: 3, gold:  10000, rate: 45 }, // → +7
  { stone: 'PIEDRA_ENCANT_SUPREMA',   qty: 1, gold:  18000, rate: 35 }, // → +8
  { stone: 'PIEDRA_ENCANT_SUPREMA',   qty: 2, gold:  30000, rate: 25 }, // → +9
  { stone: 'PIEDRA_ENCANT_LEGENDARIA',qty: 1, gold:  80000, rate: 15 }, // → +10
];

// GET /api/player/:playerId/enchant/info
// Devuelve el nivel de encantamiento de cada slot equipado y el costo del siguiente nivel.
router.get('/:playerId/enchant/info', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const equip = await db.query(
      `SELECT pe.slot, pe.enchant_level, i.name AS item_name
       FROM player_equipment pe
       JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = $1 ORDER BY pe.slot`,
      [playerId]
    );
    const slots = equip.rows.map((r) => {
      const lvl = r.enchant_level;
      const next = lvl < 10 ? ENCHANT_COSTS[lvl] : null;
      return {
        slot: r.slot,
        itemName: r.item_name,
        enchantLevel: lvl,
        maxLevel: 10,
        nextCost: next ? { stone: next.stone, quantity: next.qty, gold: next.gold, successRate: next.rate } : null,
      };
    });
    res.json(slots);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/enchant
// body: { slot }  — intenta encantar el ítem equipado en ese slot
router.post('/:playerId/enchant', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  const { slot } = req.body;
  if (!slot) return res.status(400).json({ error: 'slot es requerido' });

  try {
    const equip = await db.query(
      `SELECT pe.id, pe.item_id, pe.enchant_level, i.name AS item_name
       FROM player_equipment pe JOIN items i ON i.id = pe.item_id
       WHERE pe.player_id = $1 AND pe.slot = $2`,
      [playerId, slot]
    );
    if (!equip.rows.length) return res.status(400).json({ error: 'No tienes equipo en ese slot' });

    const { id: equipId, item_id: itemId, enchant_level: currentLevel, item_name: itemName } = equip.rows[0];
    if (currentLevel >= 10) return res.status(400).json({ error: 'El ítem ya está al nivel máximo (+10)' });

    const cost = ENCHANT_COSTS[currentLevel];

    const playerRow = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (playerRow.rows[0].gold < cost.gold) {
      return res.status(400).json({ error: `Necesitas ${cost.gold} de oro. Tienes ${playerRow.rows[0].gold}.` });
    }

    const stoneRes = await db.query('SELECT id FROM items WHERE code = $1', [cost.stone]);
    if (!stoneRes.rows.length) return res.status(500).json({ error: 'Piedra de encantamiento no configurada' });
    const stoneId = stoneRes.rows[0].id;
    const stoneQty = await inventory.getQuantity(playerId, stoneId);
    if (stoneQty < cost.qty) {
      return res.status(400).json({ error: `Necesitas ${cost.qty}x ${cost.stone}. Tienes ${stoneQty}.` });
    }

    // Consumir recursos (siempre, incluso si falla)
    await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [cost.gold, playerId]);
    await inventory.removeItem(playerId, stoneId, cost.qty);

    const success = Math.random() * 100 < cost.rate;
    if (success) {
      // Delta de HP si el ítem tiene bono de HP
      const hpBonus = await db.query(
        `SELECT amount FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP'`,
        [itemId]
      );
      if (hpBonus.rows.length) {
        const base = Number(hpBonus.rows[0].amount);
        const oldBonus = Math.round(base * (1 + currentLevel * 0.05));
        const newBonus = Math.round(base * (1 + (currentLevel + 1) * 0.05));
        await applyHpBonusDelta(playerId, newBonus - oldBonus);
      }
      await db.query('UPDATE player_equipment SET enchant_level = enchant_level + 1 WHERE id = $1', [equipId]);
      res.json({ success: true, message: `¡${itemName} mejorado a +${currentLevel + 1}!`, newLevel: currentLevel + 1 });
    } else {
      res.json({ success: false, message: `El encantamiento de ${itemName} falló. Los materiales se pierden.`, newLevel: currentLevel });
    }
  } catch (error) { next(error); }
});

// GET /api/player/:playerId/enchant/npc/:npcId/info
router.get('/:playerId/enchant/npc/:npcId/info', requireAuth, async (req, res, next) => {
  const { playerId, npcId } = req.params;
  try {
    const partyCheck = await db.query(
      'SELECT 1 FROM player_party WHERE player_id = $1 AND npc_id = $2',
      [playerId, npcId]
    );
    if (!partyCheck.rows.length) return res.status(403).json({ error: 'Ese NPC no es de tu formación' });

    const equip = await db.query(
      `SELECT ne.slot, ne.enchant_level, i.name AS item_name
       FROM npc_equipment ne
       JOIN items i ON i.id = ne.item_id
       WHERE ne.npc_id = $1 ORDER BY ne.slot`,
      [npcId]
    );
    const slots = equip.rows.map((r) => {
      const lvl = r.enchant_level;
      const next = lvl < 10 ? ENCHANT_COSTS[lvl] : null;
      return {
        slot: r.slot,
        itemName: r.item_name,
        enchantLevel: lvl,
        maxLevel: 10,
        nextCost: next ? { stone: next.stone, quantity: next.qty, gold: next.gold, successRate: next.rate } : null,
      };
    });
    res.json(slots);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/enchant/npc/:npcId  body: { slot }
router.post('/:playerId/enchant/npc/:npcId', requireAuth, async (req, res, next) => {
  const { playerId, npcId } = req.params;
  const { slot } = req.body;
  if (!slot) return res.status(400).json({ error: 'slot es requerido' });

  try {
    const partyCheck = await db.query(
      'SELECT 1 FROM player_party WHERE player_id = $1 AND npc_id = $2',
      [playerId, npcId]
    );
    if (!partyCheck.rows.length) return res.status(403).json({ error: 'Ese NPC no es de tu formación' });

    const equip = await db.query(
      `SELECT ne.item_id, ne.enchant_level, i.name AS item_name
       FROM npc_equipment ne JOIN items i ON i.id = ne.item_id
       WHERE ne.npc_id = $1 AND ne.slot = $2`,
      [npcId, slot]
    );
    if (!equip.rows.length) return res.status(400).json({ error: 'El NPC no tiene equipo en ese slot' });

    const { item_id: itemId, enchant_level: currentLevel, item_name: itemName } = equip.rows[0];
    if (currentLevel >= 10) return res.status(400).json({ error: 'El ítem ya está al nivel máximo (+10)' });

    const cost = ENCHANT_COSTS[currentLevel];

    const playerRow = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (playerRow.rows[0].gold < cost.gold) {
      return res.status(400).json({ error: `Necesitas ${cost.gold} de oro. Tienes ${playerRow.rows[0].gold}.` });
    }

    const stoneRes = await db.query('SELECT id FROM items WHERE code = $1', [cost.stone]);
    if (!stoneRes.rows.length) return res.status(500).json({ error: 'Piedra de encantamiento no configurada' });
    const stoneId = stoneRes.rows[0].id;
    const stoneQty = await inventory.getQuantity(playerId, stoneId);
    if (stoneQty < cost.qty) {
      return res.status(400).json({ error: `Necesitas ${cost.qty}x ${cost.stone}. Tienes ${stoneQty}.` });
    }

    await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [cost.gold, playerId]);
    await inventory.removeItem(playerId, stoneId, cost.qty);

    const success = Math.random() * 100 < cost.rate;
    if (success) {
      const hpBonus = await db.query(
        `SELECT amount FROM item_stat_bonuses WHERE item_id = $1 AND stat_code = 'HP'`,
        [itemId]
      );
      if (hpBonus.rows.length) {
        const base = Number(hpBonus.rows[0].amount);
        const oldBonus = Math.round(base * (1 + currentLevel * 0.05));
        const newBonus = Math.round(base * (1 + (currentLevel + 1) * 0.05));
        await applyNpcHpBonusDelta(npcId, newBonus - oldBonus);
      }
      await db.query(
        'UPDATE npc_equipment SET enchant_level = enchant_level + 1 WHERE npc_id = $1 AND slot = $2',
        [npcId, slot]
      );
      res.json({ success: true, message: `¡${itemName} mejorado a +${currentLevel + 1}!`, newLevel: currentLevel + 1 });
    } else {
      res.json({ success: false, message: `El encantamiento de ${itemName} falló. Los materiales se pierden.`, newLevel: currentLevel });
    }
  } catch (error) { next(error); }
});

// ─── ARTISAN SHOP ─────────────────────────────────────────────────────────────

const SELL_BY_RARITY = { COMUN: 25, POCO_COMUN: 75, RARO: 200, EPICO: 600, LEGENDARIO: 2500 };

// GET /api/player/:playerId/artisan-shop
// Devuelve todos los artesanos con su inventario y cuánto tiene el jugador de cada ítem.
router.get('/:playerId/artisan-shop', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  try {
    const artisans = await db.query(
      `SELECT code, name, specialty FROM artisans ORDER BY specialty`
    );
    const result = [];
    for (const art of artisans.rows) {
      const shopItems = await db.query(
        `SELECT i.id, i.code, i.name, i.rarity, i.description, s.price
         FROM artisan_shop s
         JOIN items i ON i.id = s.item_id
         WHERE s.artisan_code = $1 ORDER BY s.price`,
        [art.code]
      );
      const items = await Promise.all(shopItems.rows.map(async (it) => ({
        itemId: it.id,
        itemCode: it.code,
        name: it.name,
        rarity: it.rarity,
        description: it.description,
        price: it.price,
        playerOwns: await inventory.getQuantity(playerId, it.id),
      })));
      result.push({ code: art.code, name: art.name, specialty: art.specialty, shop: items });
    }
    res.json(result);
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/artisan-shop/buy
// body: { artisanCode, itemCode, quantity? }
router.post('/:playerId/artisan-shop/buy', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  const { artisanCode, itemCode } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!artisanCode || !itemCode) return res.status(400).json({ error: 'artisanCode e itemCode son requeridos' });
  try {
    const shopRow = await db.query(
      `SELECT s.price, i.id AS item_id, i.name
       FROM artisan_shop s JOIN items i ON i.id = s.item_id
       WHERE s.artisan_code = $1 AND i.code = $2`,
      [artisanCode, itemCode]
    );
    if (!shopRow.rows.length) return res.status(404).json({ error: 'Ítem no disponible en esa tienda' });

    const { price, item_id: itemId, name } = shopRow.rows[0];
    const totalCost = price * qty;

    const playerRow = await db.query('SELECT gold FROM players WHERE id = $1', [playerId]);
    if (playerRow.rows[0].gold < totalCost) {
      return res.status(400).json({ error: `Necesitas ${totalCost} de oro. Tienes ${playerRow.rows[0].gold}.` });
    }

    await db.query('UPDATE players SET gold = gold - $1 WHERE id = $2', [totalCost, playerId]);
    await inventory.addItem(playerId, itemId, qty);

    res.json({ success: true, message: `Compraste ${qty}x ${name} por ${totalCost} de oro.`, goldSpent: totalCost });
  } catch (error) { next(error); }
});

// POST /api/player/:playerId/artisan-shop/sell
// body: { itemId, quantity?, enchantLevel? }  — vende ítems del inventario a precio fijo por rareza
router.post('/:playerId/artisan-shop/sell', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  const { itemId, enchantLevel = 0 } = req.body;
  const qty = Math.max(1, Math.min(99, parseInt(req.body.quantity) || 1));

  if (!itemId) return res.status(400).json({ error: 'itemId es requerido' });
  try {
    const itemRow = await db.query('SELECT id, name, rarity, item_type FROM items WHERE id = $1', [itemId]);
    if (!itemRow.rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });

    const { name, rarity, item_type } = itemRow.rows[0];
    const sellPrice = SELL_BY_RARITY[rarity];
    if (!sellPrice) return res.status(400).json({ error: 'Este ítem no se puede vender' });

    const have = await inventory.getQuantity(playerId, itemId, enchantLevel);
    if (have < qty) return res.status(400).json({ error: `Solo tienes ${have}x ${name}` });

    // No permitir vender si está equipado
    if (item_type === 'EQUIPMENT') {
      const equipped = await db.query(
        'SELECT slot FROM player_equipment WHERE player_id = $1 AND item_id = $2',
        [playerId, itemId]
      );
      if (equipped.rows.length) {
        return res.status(400).json({ error: `No puedes vender ${name} mientras está equipado` });
      }
    }

    const totalEarned = sellPrice * qty;
    await inventory.removeItem(playerId, itemId, qty, enchantLevel);
    await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [totalEarned, playerId]);

    res.json({ success: true, message: `Vendiste ${qty}x ${name} por ${totalEarned} de oro.`, goldEarned: totalEarned });
  } catch (error) { next(error); }
});

// GET /:playerId/stats/breakdown
// Devuelve, para cada stat de combate, la contribución individual de: clase base, crecimiento
// por nivel, pasivas (% sobre base+nivel) y cada pieza de equipo (con multiplicador de encantamiento).
router.get('/:playerId/stats/breakdown', requireAuth, async (req, res, next) => {
  const { playerId } = req.params;
  if (Number(playerId) !== req.playerId) return res.status(403).json({ error: 'No autorizado' });
  try {
    const playerRes = await db.query(
      `SELECT p.level, p.class_id,
              c.name AS class_name,
              c.base_hp, c.base_atk, c.base_def, c.base_mag,
              c.base_magic_def, c.base_spd, c.base_crit_chance, c.base_mana
       FROM players p JOIN classes c ON c.id = p.class_id
       WHERE p.id = $1`,
      [playerId]
    );
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const pl = playerRes.rows[0];

    const [growthRes, equipRes, passiveRes] = await Promise.all([
      db.query(
        `SELECT level_from, level_to,
                hp_per_level, atk_per_level, def_per_level, mag_per_level,
                magic_def_per_level, spd_per_level, mana_per_level
         FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
        [pl.class_id]
      ),
      db.query(
        `SELECT pe.slot, i.name AS item_name, pe.enchant_level, isb.stat_code, isb.amount
         FROM player_equipment pe
         JOIN items i ON i.id = pe.item_id
         LEFT JOIN item_stat_bonuses isb ON isb.item_id = pe.item_id
         WHERE pe.player_id = $1
         ORDER BY pe.slot, isb.stat_code`,
        [playerId]
      ),
      db.query(
        `SELECT s.name, s.learn_level, se.stat_code, se.percent_amount
         FROM skills s
         JOIN skill_effects se ON se.skill_id = s.id
         WHERE s.class_id = $1
           AND s.is_passive = TRUE
           AND s.learn_method = 'LEVEL'
           AND s.learn_level <= $2
           AND se.effect_type = 'STAT_MOD'
         ORDER BY s.learn_level, s.id`,
        [pl.class_id, pl.level]
      ),
    ]);

    const atLevel = leveling.computeStatsAtLevel(
      {
        base_hp: pl.base_hp, base_atk: pl.base_atk, base_def: pl.base_def,
        base_mag: pl.base_mag, base_magic_def: pl.base_magic_def,
        base_spd: pl.base_spd, base_crit_chance: pl.base_crit_chance, base_mana: pl.base_mana,
      },
      growthRes.rows,
      pl.level
    );

    // Metadatos de cada slot equipado (para mostrar nombre + encantamiento)
    const slotMeta = {};
    for (const row of equipRes.rows) {
      if (!slotMeta[row.slot]) {
        slotMeta[row.slot] = { item_name: row.item_name, enchant_level: row.enchant_level || 0 };
      }
    }

    function equipSourcesFor(statCode) {
      const bySlot = {};
      for (const row of equipRes.rows) {
        if (!row.stat_code || row.stat_code !== statCode) continue;
        if (!bySlot[row.slot]) bySlot[row.slot] = 0;
        const mult = 1 + (row.enchant_level || 0) * 0.05;
        bySlot[row.slot] += Math.round(Number(row.amount) * mult);
      }
      return Object.entries(bySlot).map(([slot, value]) => {
        const meta = slotMeta[slot] || {};
        const enc = meta.enchant_level || 0;
        return { type: 'equipment', slot, label: `${meta.item_name || slot}${enc > 0 ? ` (+${enc})` : ''}`, value };
      });
    }

    function passiveSourcesFor(statCode, baseForPercent) {
      return passiveRes.rows
        .filter((r) => r.stat_code === statCode)
        .map((r) => {
          const pct = Number(r.percent_amount);
          return { type: 'passive', label: `${r.name} (pasiva nv${r.learn_level})`, percent: pct, value: Math.round(baseForPercent * pct / 100) };
        });
    }

    // Para HP: el pasivo se aplica sobre base+nivel+equipo (igual que en combat/party).
    // Para el resto: el pasivo se aplica solo sobre base+nivel y el equipo se suma plano después.
    const STATS = [
      { key: 'atk',       base: Number(pl.base_atk),       lvlVal: atLevel.atk,      statCode: 'ATK',         passiveCode: 'ATK'         },
      { key: 'def',       base: Number(pl.base_def),        lvlVal: atLevel.def,      statCode: 'DEF',         passiveCode: 'DEF'         },
      { key: 'int',       base: Number(pl.base_mag),        lvlVal: atLevel.mag,      statCode: 'MAG',         passiveCode: 'MAG'         },
      { key: 'magic_def', base: Number(pl.base_magic_def),  lvlVal: atLevel.magicDef, statCode: 'MAGIC_DEF',   passiveCode: 'MAGIC_DEF'   },
      { key: 'spd',       base: Number(pl.base_spd),        lvlVal: atLevel.spd,      statCode: 'SPD',         passiveCode: 'SPD'         },
      { key: 'crit',      base: Number(pl.base_crit_chance), lvlVal: atLevel.crit,     statCode: 'CRIT_CHANCE', passiveCode: 'CRIT_CHANCE' },
      { key: 'hp',        base: Number(pl.base_hp),         lvlVal: atLevel.hp,       statCode: 'HP',          passiveCode: 'HP',         hpSpecial: true },
      { key: 'mana',      base: Number(pl.base_mana),       lvlVal: atLevel.mana,     statCode: null,          passiveCode: null          },
      { key: 'evasion',   base: 0,                          lvlVal: 0,                statCode: 'EVASION',     passiveCode: 'EVASION'     },
    ];

    const breakdown = {};
    for (const stat of STATS) {
      const levelGrowth = stat.lvlVal - stat.base;
      const equipSources = stat.statCode ? equipSourcesFor(stat.statCode) : [];
      const equipTotal = equipSources.reduce((s, e) => s + e.value, 0);
      const passiveBase = stat.hpSpecial ? (stat.lvlVal + equipTotal) : stat.lvlVal;
      const passiveSources = stat.passiveCode ? passiveSourcesFor(stat.passiveCode, passiveBase) : [];
      const passiveTotal = passiveSources.reduce((s, p) => s + p.value, 0);
      const total = stat.base + levelGrowth + equipTotal + passiveTotal;

      const sources = [];
      if (stat.base > 0) sources.push({ type: 'base', label: `Clase base (${pl.class_name})`, value: stat.base });
      if (levelGrowth > 0) sources.push({ type: 'level', label: `Nivel ${pl.level}`, value: levelGrowth });
      sources.push(...passiveSources);
      sources.push(...equipSources);

      breakdown[stat.key] = { total, base: stat.base, fromLevel: levelGrowth, fromPassives: passiveTotal, fromEquipment: equipTotal, sources };
    }

    res.json({ className: pl.class_name, level: pl.level, breakdown });
  } catch (error) { next(error); }
});

module.exports = router;
