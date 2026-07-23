const db = require('../db/db');

async function getInnateForClass(classId) {
  if (!classId) return null;
  const res = await db.query('SELECT * FROM class_innate_abilities WHERE class_id = $1', [classId]);
  return res.rows[0] || null;
}

// MODIFIES_SKILL: innata que altera el comportamiento de UN skill_code puntual (ver
// extra_json.skill_code), no dispara por evento genérico. Devuelve la fila si la clase del actor
// tiene una innata MODIFIES_SKILL para exactamente ese skill_code, o null.
async function getSkillModifier(classId, skillCode) {
  const innate = await getInnateForClass(classId);
  if (!innate || innate.trigger_type !== 'MODIFIES_SKILL' || innate.extra_json?.skill_code !== skillCode) return null;
  return innate;
}

function rollChance(innate, actorLuck) {
  if (innate.chance_percent == null) return true;
  const chance = innate.chance_scales_with_luck
    ? Number(innate.chance_percent) + Number(actorLuck || 0) * 0.5
    : Number(innate.chance_percent);
  return Math.random() * 100 < chance;
}

// ctx: { actor, target, allies, enemies, zoneCode, alreadyFoughtCategoriesThisCombat }
// allies/enemies son arrays de combat_participants vivos del bando del actor / del bando
// contrario (allies NO incluye al propio actor). Los campos que dependen del contexto de un
// ataque puntual (target, zoneCode, alreadyFought...) los arma el caller en combat.js.
function checkCondition(innate, ctx) {
  switch (innate.condition_type) {
    case 'SELF_HP_BELOW':
      return (ctx.actor.hp / ctx.actor.max_hp) * 100 < Number(innate.condition_value);
    case 'SELF_HP_ABOVE':
      return (ctx.actor.hp / ctx.actor.max_hp) * 100 > Number(innate.condition_value);
    case 'TARGET_HP_BELOW':
      return !!ctx.target && (ctx.target.hp / ctx.target.max_hp) * 100 < Number(innate.condition_value);
    case 'TARGET_HP_ABOVE_SELF':
      return !!ctx.target && ctx.target.hp > ctx.actor.hp;
    case 'MORE_HP_THAN_ALLIES':
      return ctx.allies.every((a) => a.hp <= ctx.actor.hp);
    case 'ANY_ALLY_HP_BELOW':
      return ctx.allies.some((a) => (a.hp / a.max_hp) * 100 < Number(innate.condition_value));
    case 'TARGET_CATEGORY_IN':
      return !!ctx.target?.monster_category && (innate.extra_json?.categories || []).includes(ctx.target.monster_category);
    case 'TARGET_IS_BOSS':
      return ctx.target?.is_boss === true;
    case 'IS_INVISIBLE':
      return ctx.actor.no_damage_window === true;
    case 'ZONE_IN':
      return !!ctx.zoneCode && (innate.extra_json?.zones || []).includes(ctx.zoneCode);
    case 'MULTIPLE_SUMMONS_ACTIVE':
      return ctx.allies.filter((a) => a.is_summon && a.summoner_id === ctx.actor.id).length > 1;
    case 'ALREADY_FOUGHT_TYPE':
      return !!ctx.target?.monster_category && !!ctx.alreadyFoughtCategoriesThisCombat?.has(ctx.target.monster_category);
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

const LIVE_CONDITION_TYPES = [
  'MORE_HP_THAN_ALLIES', 'SELF_HP_BELOW', 'SELF_HP_ABOVE', 'ANY_ALLY_HP_BELOW',
  'ZONE_IN', 'MULTIPLE_SUMMONS_ACTIVE', null,
];

function applyStatBonus(p, statCode, pct) {
  if (statCode === 'ATK') p.atk = (p.atk || 0) + Math.round((p.atk || 0) * pct / 100);
  else if (statCode === 'DEF') p.def = (p.def || 0) + Math.round((p.def || 0) * pct / 100);
  else if (statCode === 'MAG') p.mag = (p.mag || 0) + Math.round((p.mag || 0) * pct / 100);
  else if (statCode === 'MAGIC_DEF') p.magic_def = (p.magic_def || 0) + Math.round((p.magic_def || 0) * pct / 100);
  else if (statCode === 'SPD') p.spd = (p.spd || 0) + Math.round((p.spd || 0) * pct / 100);
  else if (statCode === 'CRIT_CHANCE') p.crit_chance = (p.crit_chance || 0) + pct;
  else if (statCode === 'EVASION') p.evasion = (p.evasion || 0) + pct;
  else if (statCode === 'DAMAGE_TAKEN' || statCode === 'DAMAGE_TAKEN_PHYSICAL') p.damage_taken_bonus = (p.damage_taken_bonus || 0) + pct;
  else if (statCode === 'DAMAGE_DEALT' || statCode === 'ALL_DAMAGE') {
    p.physical_damage_bonus = (p.physical_damage_bonus || 0) + pct;
    p.magic_damage_bonus = (p.magic_damage_bonus || 0) + pct;
  } else if (statCode === 'HEAL_POWER') p.heal_bonus = (p.heal_bonus || 0) + pct;
}

// PASSIVE_STAT / PASSIVE_CONDITIONAL (con condición "de bando", no de target puntual) / TEAM_AURA
// se re-evalúan en cada resolución de turno, no son eventos puntuales. Se llama una vez justo
// después de loadParticipants(sessionId) y ajusta los campos EN MEMORIA que el motor de daño ya
// lee (atk/def/mag/spd/crit_chance/evasion/damage_taken_bonus/physical_damage_bonus/
// magic_damage_bonus/heal_bonus/temp_resist) — ninguno de estos se persiste en
// combat_participants (se recalculan desde cero en cada load), así que pisarlos acá es seguro.
// Los PASSIVE_CONDITIONAL con condición "de target" (TARGET_HP_BELOW, TARGET_CATEGORY_IN, etc.)
// NO se resuelven acá — se evalúan puntualmente en el momento de pegar, ver getTargetDamageBonus.
async function applyLiveInnateModifiers(participants, zoneCode = null) {
  const sides = { PLAYER: participants.player, ENEMY: participants.enemy };
  const innateCache = new Map();
  const getCached = async (classId) => {
    if (!classId) return null;
    if (!innateCache.has(classId)) innateCache.set(classId, await getInnateForClass(classId));
    return innateCache.get(classId);
  };

  for (const [, sideList] of Object.entries(sides)) {
    const alive = sideList.filter((p) => p.hp > 0);

    for (const p of alive) {
      const innate = await getCached(p.class_id);
      if (!innate) continue;

      // Nivel 3: stacks que escalan en combate. Ira Creciente (stack_per_hp_lost_percent) se
      // recalcula en vivo a partir del HP actual (se "resetea" solo al curarse por completo).
      // Sed de Sangre/Caos Encarnado/Trofeos de Caza incrementan p.innate_stacks de forma
      // persistente vía ON_KILL/ON_DAMAGE_TAKEN (ver combat.js) y no vuelven a bajar en el combate.
      if (innate.is_stacking) {
        let stacks = Number(p.innate_stacks || 0);
        if (innate.extra_json?.stack_per_hp_lost_percent) {
          const hpLostPercent = (1 - p.hp / p.max_hp) * 100;
          stacks = Math.floor(hpLostPercent / Number(innate.extra_json.stack_per_hp_lost_percent));
        }
        if (stacks > 0 && innate.stat_code) {
          applyStatBonus(p, innate.stat_code, Number(innate.percent_amount || 0) * stacks);
        }
        if (stacks > 0 && innate.extra_json?.also_stat_code) {
          applyStatBonus(p, innate.extra_json.also_stat_code, Number(innate.extra_json.also_percent_per_stack || 0) * stacks);
        }
        continue;
      }

      const allies = alive.filter((a) => a.id !== p.id);
      if (innate.trigger_type === 'PASSIVE_STAT') {
        if (innate.stat_code) applyStatBonus(p, innate.stat_code, Number(innate.percent_amount || 0));
        // Efectos PASSIVE_STAT cuya magnitud vive en extra_json (no en stat_code/percent_amount):
        // se leen acá como flags/campos efímeros que lib/combat.js y el motor de daño consultan.
        if (innate.extra_json?.ignore_def_percent) p.ignore_def_percent = Number(innate.extra_json.ignore_def_percent);
        // Filo Arcano: "escala también con MAG" no trae número — 30% es un valor inventado
        // (ver aviso al usuario), aplicado solo cuando el ataque básico rutea por ATK.
        if (innate.extra_json?.basic_attack_also_scales_with === 'MAG') p.basic_attack_extra_mag_percent = 30;
        if (innate.extra_json?.ignore_defend_status) p.ignores_defend_status = true;
        if (innate.extra_json?.tie_break_spd_always_first) p.spd = (p.spd || 0) + 0.01;
        if (innate.extra_json?.element && innate.extra_json?.ignore_all_resistance) {
          p.ignore_resistance_element = innate.extra_json.element;
        }
        if (innate.extra_json?.effect === 'copy_ally_resistances_percent' && innate.percent_amount) {
          const copyPct = Number(innate.percent_amount) / 100;
          p.temp_resist = p.temp_resist || {};
          for (const ally of allies) {
            for (const [elemCode, val] of Object.entries(ally.temp_resist || {})) {
              p.temp_resist[elemCode] = (p.temp_resist[elemCode] || 0) + Number(val) * copyPct;
            }
          }
        }
      } else if (innate.trigger_type === 'PASSIVE_CONDITIONAL' && LIVE_CONDITION_TYPES.includes(innate.condition_type)) {
        if (checkCondition(innate, { actor: p, allies, zoneCode }) && innate.stat_code) {
          applyStatBonus(p, innate.stat_code, Number(innate.percent_amount || 0));
        }
      }
    }

    // Instinto de Manada (y similares "applies_to: summons"): el bono no es para el invocador,
    // es para SUS invocados — el invocado no tiene class_id propio, así que se resuelve desde el
    // lado del invocador y se aplica a los summon_id que le pertenecen.
    for (const owner of alive) {
      const innate = await getCached(owner.class_id);
      if (!innate || innate.trigger_type !== 'PASSIVE_CONDITIONAL' || innate.extra_json?.applies_to !== 'summons') continue;
      const ownSummons = alive.filter((s) => s.is_summon && s.summoner_id === owner.id);
      const allies = alive.filter((a) => a.id !== owner.id);
      if (checkCondition(innate, { actor: owner, allies, zoneCode }) && innate.stat_code) {
        for (const summon of ownSummons) applyStatBonus(summon, innate.stat_code, Number(innate.percent_amount || 15));
      }
    }

    // TEAM_AURA: mientras la fuente esté viva, su bando recibe el bono (todo el bando, o solo el
    // aliado con menos HP si extra_json.target apunta a un solo aliado protegido).
    for (const source of alive) {
      const innate = await getCached(source.class_id);
      if (!innate || innate.trigger_type !== 'TEAM_AURA') continue;
      const pct = Number(innate.percent_amount || 0);
      const singleTarget = ['lowest_hp_ally', 'protected_ally'].includes(innate.extra_json?.target);
      const recipients = singleTarget
        ? [alive.reduce((min, a) => (a.hp / a.max_hp < min.hp / min.max_hp ? a : min), alive[0])].filter(Boolean)
        : alive;

      const resistMatch = /^RESIST_(\w+)$/.exec(innate.stat_code || '');
      for (const ally of recipients) {
        if (resistMatch) {
          ally.temp_resist = ally.temp_resist || {};
          ally.temp_resist[resistMatch[1]] = (ally.temp_resist[resistMatch[1]] || 0) + pct;
        } else if (innate.stat_code === 'ALL_ELEMENTAL_RESIST') {
          ally.temp_resist = ally.temp_resist || {};
          for (const el of ['FIRE', 'ICE', 'LIGHTNING', 'WIND', 'EARTH', 'WATER', 'LIGHT', 'DARK', 'COSMIC']) {
            ally.temp_resist[el] = (ally.temp_resist[el] || 0) + pct;
          }
        } else if (innate.stat_code) {
          applyStatBonus(ally, innate.stat_code, pct);
        }
      }
    }
  }
}

// Bonus de daño/crit "por target" para PASSIVE_CONDITIONAL cuyo condition_type depende de QUIÉN
// es el objetivo puntual de este golpe (no del estado general del actor/bando). Se llama en el
// momento de resolver daño, antes de aplicar el golpe, y devuelve { damagePercent, critChancePercent }
// a sumar SOLO a este golpe (no se persiste).
async function getTargetDamageBonus(actor, target, ctx = {}) {
  const result = { damagePercent: 0, critChancePercent: 0, guaranteedCrit: false, ignoreResistance: false, ignoreMagicDef: false };
  const innate = await getInnateForClass(actor.class_id);
  if (!innate || innate.trigger_type !== 'PASSIVE_CONDITIONAL') return result;
  const targetCtx = { actor, target, allies: ctx.allies || [], alreadyFoughtCategoriesThisCombat: ctx.alreadyFoughtCategoriesThisCombat };
  const perTargetConditions = ['TARGET_HP_BELOW', 'TARGET_HP_ABOVE_SELF', 'TARGET_CATEGORY_IN', 'TARGET_IS_BOSS', 'ALREADY_FOUGHT_TYPE'];
  if (!perTargetConditions.includes(innate.condition_type)) return result;
  if (!checkCondition(innate, targetCtx)) return result;

  if (innate.stat_code === 'DAMAGE_DEALT' || innate.stat_code === 'ALL_DAMAGE') {
    result.damagePercent = Number(innate.percent_amount || 0);
  } else if (innate.stat_code === 'CRIT_CHANCE') {
    result.critChancePercent = Number(innate.percent_amount || 0);
  }
  if (innate.extra_json?.effect === 'guarantee_crit') result.guaranteedCrit = true;
  if (innate.extra_json?.effect === 'ignore_all_resistance') result.ignoreResistance = true;
  if (innate.extra_json?.effect === 'ignore_magic_resistance') result.ignoreMagicDef = true;
  return result;
}

module.exports = {
  getInnateForClass, applyInnateTrigger, checkCondition, rollChance,
  applyLiveInnateModifiers, getTargetDamageBonus, applyStatBonus, getSkillModifier,
};
