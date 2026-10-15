const db = require('../db/db');
const inventory = require('./inventory');
const { NODE_TYPES } = require('./worldNodes');
// misiones por pasos: solo avanza lo del paso actual (ver lib/questSteps.js). Se pide perezoso
// porque questSteps también usa inventory.
const steps = () => require('./questSteps');

// Llamado desde combat.js cuando un monstruo muere en una pelea ganada. Busca, entre las
// quests que el jugador tiene ACEPTADAS (player_active_quests), los objetivos KILL_MONSTER/
// DEFEAT_BOSS que apunten a ese monstruo exacto, y los KILL_ANY_IN_ZONE de la misma zona
// cuando el monstruo es COMMON (las quests "comunes de la zona" solo cuentan rarity COMMON,
// ver descripciones en seed.sql). target_count clampea el contador para que no pase de la meta.
async function registerKill(playerId, monsterCode) {
  const monsterResult = await db.query(
    'SELECT id, zone_id, rarity FROM monsters WHERE code = $1',
    [monsterCode]
  );
  if (!monsterResult.rows.length) return;
  const monster = monsterResult.rows[0];
  const isCommon = monster.rarity === 'COMMON';

  const objectivesResult = await db.query(
    `SELECT qo.id AS objective_id, qo.quest_id, qo.target_count
     FROM player_active_quests paq
     JOIN quest_objectives qo ON qo.quest_id = paq.quest_id
     JOIN quests q ON q.id = qo.quest_id
     WHERE paq.player_id = $1
       AND (
         (qo.objective_type IN ('KILL_MONSTER', 'DEFEAT_BOSS') AND qo.monster_id = $2)
         OR (qo.objective_type = 'KILL_ANY_IN_ZONE' AND q.zone_id = $3 AND $4)
       )`,
    [playerId, monster.id, monster.zone_id, isCommon]
  );
  if (!objectivesResult.rows.length) return;
  const allowed = await steps().objectivesInCurrentStep(playerId, [...new Set(objectivesResult.rows.map((o) => o.quest_id))]);

  for (const objective of objectivesResult.rows) {
    if (!allowed.has(objective.objective_id)) continue;
    await db.query(
      `INSERT INTO player_quest_progress(player_id, quest_id, quest_objective_id, current_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (player_id, quest_objective_id)
       DO UPDATE SET current_count = LEAST(player_quest_progress.current_count + 1, $4), updated_at = now()`,
      [playerId, objective.quest_id, objective.objective_id, objective.target_count]
    );
  }
}

// Progreso de cada objetivo de una quest para un jugador puntual: current_count en 0 si todavia
// no mato nada para ese objetivo (no hace falta insertar la fila al aceptar la quest).
async function getProgressForQuest(playerId, questId) {
  const result = await db.query(
    'SELECT quest_objective_id, current_count FROM player_quest_progress WHERE player_id = $1 AND quest_id = $2',
    [playerId, questId]
  );
  const byObjectiveId = new Map(result.rows.map((r) => [r.quest_objective_id, r.current_count]));
  return byObjectiveId;
}

async function clearProgressForQuest(playerId, questId) {
  await db.query('DELETE FROM player_quest_progress WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
}

// Adjunta a cada fila de `questRows` (debe traer .id) su lista de objetivos con el progreso
// real del jugador (`objectives: [...]`, cada uno con `current_count`). Usado por
// /quests/available y /quests/active para que el front (GuildQuests.js, MyQuests.js) pueda
// mostrar "3/10 matados" sin pegarle a /api/quests/:id por cada card. COLLECT_ITEM se resuelve
// contra player_inventory (mismo criterio que findUnmetObjective en routes/players.js);
// el resto contra player_quest_progress.
async function attachObjectives(playerId, questRows) {
  if (!questRows.length) return questRows.map((q) => ({ ...q, objectives: [] }));

  const questIds = questRows.map((q) => q.id);
  const objectivesResult = await db.query(
    `SELECT qo.id AS objective_id, qo.quest_id, qo.objective_type, qo.monster_id, qo.item_id,
            qo.target_count, qo.description, qo.step, qo.target_code, qo.params,
            m.name AS monster_name, m.code AS monster_code, i.name AS item_name, i.code AS item_code
     FROM quest_objectives qo
     LEFT JOIN monsters m ON m.id = qo.monster_id
     LEFT JOIN items i ON i.id = qo.item_id
     WHERE qo.quest_id = ANY($1::int[])
     ORDER BY qo.step, qo.id`,
    [questIds]
  );

  const progressResult = await db.query(
    'SELECT quest_objective_id, current_count FROM player_quest_progress WHERE player_id = $1 AND quest_id = ANY($2::int[])',
    [playerId, questIds]
  );
  const progressByObjectiveId = new Map(progressResult.rows.map((r) => [r.quest_objective_id, r.current_count]));

  const itemIds = [...new Set(objectivesResult.rows.filter((o) => o.item_id).map((o) => o.item_id))];
  const inventoryByItemId = new Map();
  for (const itemId of itemIds) {
    inventoryByItemId.set(itemId, await inventory.getQuantity(playerId, itemId));
  }
  // de dónde sale cada objeto (para el rastreo del mapa): monstruos que lo sueltan, recursos del
  // mapa que lo dan y si se fabrica
  const sourcesByItemId = new Map();
  if (itemIds.length) {
    const drops = (await db.query(
      `SELECT md.item_id, m.code FROM monster_drops md JOIN monsters m ON m.id = md.monster_id
       WHERE md.item_id = ANY($1::int[]) ORDER BY md.drop_chance_percent DESC`, [itemIds])).rows;
    const crafted = new Set((await db.query('SELECT DISTINCT result_item_id FROM crafting_recipes WHERE result_item_id = ANY($1::int[])', [itemIds])).rows.map((r) => r.result_item_id));
    const codes = new Map(objectivesResult.rows.filter((o) => o.item_id).map((o) => [o.item_id, o.item_code]));
    for (const id of itemIds) {
      const nodes = Object.entries(NODE_TYPES)
        .filter(([, t]) => [...(t.loot ?? []), t.fallback].some((l) => l?.item === codes.get(id)))
        .map(([tipo]) => tipo);
      sourcesByItemId.set(id, { monsters: drops.filter((d) => d.item_id === id).map((d) => d.code).slice(0, 6), nodes, crafted: crafted.has(id) });
    }
  }

  const objectivesByQuestId = new Map();
  for (const o of objectivesResult.rows) {
    const currentCount = o.objective_type === 'COLLECT_ITEM'
      ? Math.min(inventoryByItemId.get(o.item_id) || 0, o.target_count)
      : Math.min(progressByObjectiveId.get(o.objective_id) || 0, o.target_count);

    // del lugar solo se manda lo que el mapa necesita para marcarlo (nada de diálogos ni premios)
    const p = o.params ?? {};
    // sprite: lo que se ve en el mapa (Trueno, el bolso…); las emboscadas sin dibujo muestran a su
    // primer monstruo ("mon:CODIGO"). huye: se va corriendo al cumplirlo.
    const sprite = p.sprite ?? (o.objective_type === 'AMBUSH' && p.monsters?.[0]?.code ? `mon:${p.monsters[0].code}` : null);
    const place = p.zone ? { zone: p.zone, x: p.x, y: p.y, radius: p.radius ?? 3, label: p.label ?? null, sprite, huye: !!p.huye } : null;
    const { params, ...rest } = o;
    if (!objectivesByQuestId.has(o.quest_id)) objectivesByQuestId.set(o.quest_id, []);
    const extra = o.item_id ? { have: inventoryByItemId.get(o.item_id) || 0, sources: sourcesByItemId.get(o.item_id) ?? null } : {};
    objectivesByQuestId.get(o.quest_id).push({ ...rest, ...extra, place, current_count: currentCount });
  }

  // paso actual de cada misión: el más bajo con algo sin cumplir. Los objetivos de pasos
  // posteriores van marcados (future) para que el diario no adelante la historia.
  return questRows.map((q) => {
    const list = objectivesByQuestId.get(q.id) || [];
    const pending = list.filter((o) => o.current_count < o.target_count);
    const currentStep = pending.length ? Math.min(...pending.map((o) => o.step ?? 1)) : null;
    return {
      ...q,
      current_step: currentStep,
      objectives: list.map((o) => ({ ...o, future: currentStep != null && (o.step ?? 1) > currentStep })),
    };
  });
}

// Llamado desde combat.js cuando el héroe usa ATTACK, SKILL o DEFEND. Busca, entre las
// quests ACTIVAS del jugador, los objetivos USE_ACTION cuyos filtros no-nulos coincidan
// y hace el mismo UPSERT que registerKill. Si requires_kill=TRUE y killCount=0, no suma.
async function registerAction(playerId, { baseAction, skillId, damageSchool, isElemental, killCount }) {
  const objectivesResult = await db.query(
    `SELECT qo.id AS objective_id, qo.quest_id, qo.target_count, qo.requires_kill
     FROM player_active_quests paq
     JOIN quest_objectives qo ON qo.quest_id = paq.quest_id
     WHERE paq.player_id = $1
       AND qo.objective_type = 'USE_ACTION'
       AND (qo.required_skill_id IS NULL OR qo.required_skill_id = $2)
       AND (qo.required_damage_school IS NULL OR qo.required_damage_school = $3)
       AND (qo.required_elemental IS NULL OR qo.required_elemental = $4)
       AND (qo.required_base_action IS NULL OR qo.required_base_action = $5)`,
    [playerId, skillId ?? null, damageSchool ?? null, !!isElemental, baseAction ?? null]
  );
  if (!objectivesResult.rows.length) return;
  const allowed = await steps().objectivesInCurrentStep(playerId, [...new Set(objectivesResult.rows.map((o) => o.quest_id))]);
  for (const o of objectivesResult.rows) {
    if (!allowed.has(o.objective_id)) continue;
    if (o.requires_kill && killCount <= 0) continue;
    const inc = o.requires_kill ? killCount : 1;
    await db.query(
      `INSERT INTO player_quest_progress(player_id, quest_id, quest_objective_id, current_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id, quest_objective_id)
       DO UPDATE SET current_count = LEAST(player_quest_progress.current_count + $4, $5), updated_at = now()`,
      [playerId, o.quest_id, o.objective_id, inc, o.target_count]
    );
  }
}

module.exports = { registerKill, registerAction, getProgressForQuest, clearProgressForQuest, attachObjectives };
