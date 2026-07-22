const db = require('../db/db');

async function getInnateForClass(classId) {
  if (!classId) return null;
  const res = await db.query('SELECT * FROM class_innate_abilities WHERE class_id = $1', [classId]);
  return res.rows[0] || null;
}

function rollChance(innate, actorLuck) {
  if (innate.chance_percent == null) return true;
  const chance = innate.chance_scales_with_luck
    ? Number(innate.chance_percent) + Number(actorLuck || 0) * 0.5
    : Number(innate.chance_percent);
  return Math.random() * 100 < chance;
}

// ctx: { actor, target, allies, enemies } — allies/enemies son arrays de combat_participants vivos
// del bando del actor / del bando contrario, respectivamente (no incluyen al propio actor en allies).
function checkCondition(innate, ctx) {
  switch (innate.condition_type) {
    case 'SELF_HP_BELOW':
      return (ctx.actor.hp / ctx.actor.max_hp) * 100 < Number(innate.condition_value);
    case 'TARGET_HP_BELOW':
      return !!ctx.target && (ctx.target.hp / ctx.target.max_hp) * 100 < Number(innate.condition_value);
    case 'MORE_HP_THAN_ALLIES':
      return ctx.allies.every((a) => a.hp <= ctx.actor.hp);
    case 'ANY_ALLY_HP_BELOW':
      return ctx.allies.some((a) => (a.hp / a.max_hp) * 100 < Number(innate.condition_value));
    default:
      return true;
  }
}

// Llamado en cada uno de los puntos de enganche de combat.js, pasando el trigger_type
// correspondiente. Si la clase del actor no tiene innata, o es de otro trigger_type, no hace nada.
// Devuelve la fila de la innata si corresponde disparar el efecto (el caller ya sabe, por
// triggerType, qué efecto aplicar leyendo stat_code/percent_amount/extra_json).
async function applyInnateTrigger(triggerType, ctx) {
  const innate = await getInnateForClass(ctx.actor.class_id);
  if (!innate || innate.trigger_type !== triggerType) return null;
  if (!rollChance(innate, ctx.actor.luck)) return null;
  if (!checkCondition(innate, ctx)) return null;
  return innate;
}

// PASSIVE_CONDITIONAL y TEAM_AURA no son eventos puntuales: hay que re-evaluarlos en cada
// resolución de turno porque su condición (HP relativo, quién sigue vivo) cambia constantemente.
// Se llama una vez justo después de loadParticipants(sessionId), y ajusta los campos EN MEMORIA
// que el motor de daño ya lee (damage_reduction/damage_taken_bonus, temp_resist) — estos campos
// nunca se persisten en combat_participants (se recalculan desde cero en cada load), así que
// pisarlos acá no rompe nada ni necesita revertirse.
async function applyLiveInnateModifiers(participants) {
  const sides = { PLAYER: participants.player, ENEMY: participants.enemy };
  const innateCache = new Map();
  const getCached = async (classId) => {
    if (!classId) return null;
    if (!innateCache.has(classId)) innateCache.set(classId, await getInnateForClass(classId));
    return innateCache.get(classId);
  };

  for (const [, sideList] of Object.entries(sides)) {
    const alive = sideList.filter((p) => p.hp > 0);

    // PASSIVE_CONDITIONAL: cada participante vivo chequea su propia condición contra su bando.
    for (const p of alive) {
      const innate = await getCached(p.class_id);
      if (!innate || innate.trigger_type !== 'PASSIVE_CONDITIONAL') continue;
      const allies = alive.filter((a) => a.id !== p.id);
      if (!checkCondition(innate, { actor: p, allies })) continue;
      const pct = Number(innate.percent_amount || 0);
      if (innate.stat_code === 'DAMAGE_TAKEN' || innate.stat_code === 'DAMAGE_TAKEN_PHYSICAL') {
        p.damage_taken_bonus = (p.damage_taken_bonus || 0) + pct;
      }
    }

    // TEAM_AURA: mientras la fuente esté viva, todo su bando (incluida ella) recibe el bono.
    for (const source of alive) {
      const innate = await getCached(source.class_id);
      if (!innate || innate.trigger_type !== 'TEAM_AURA') continue;
      const pct = Number(innate.percent_amount || 0);
      const resistMatch = /^RESIST_(\w+)$/.exec(innate.stat_code || '');
      for (const ally of alive) {
        if (resistMatch) {
          ally.temp_resist = ally.temp_resist || {};
          ally.temp_resist[resistMatch[1]] = (ally.temp_resist[resistMatch[1]] || 0) + pct;
        }
      }
    }
  }
}

module.exports = { getInnateForClass, applyInnateTrigger, checkCondition, rollChance, applyLiveInnateModifiers };
