// Motor de combate por turnos (logica pura, sin tocar la DB). La orquestacion con sesiones
// persistidas vive en routes/combat.js; este archivo solo resuelve calculos.
//
// Reglas:
// - Cada ronda, el lado con mayor velocidad de GRUPO (promedio de SPD de los vivos) actua primero.
// - Los turnos se ALTERNAN entre lados dentro de la ronda: actua el miembro vivo de mayor SPD
//   del lado en turno (que no haya actuado ya esta ronda), termina su turno, pasa al otro lado,
//   y asi hasta que todos los vivos de ambos lados actuaron una vez.
// - Solo un combatiente actua por turno. Si un lado se queda sin miembros por actuar, el otro
//   sigue actuando solo hasta cerrar la ronda.
// - El jugador elige ATTACK/DEFEND/ESCAPE/USE_ITEM en su turno; los enemigos siempre atacan
//   (IA basica) y se resuelven automaticamente.

function averageSpeed(participants) {
  const alive = participants.filter((p) => p.hp > 0);
  if (alive.length === 0) return 0;
  return alive.reduce((sum, p) => sum + p.spd, 0) / alive.length;
}

function aliveNotActed(participants) {
  return participants.filter((p) => p.hp > 0 && !p.has_acted_this_round);
}

// Decide que lado actua a continuacion. lastActingSide=null significa "inicio de ronda"
// (se decide por velocidad de grupo); si no, se alterna respecto al ultimo que actuo.
// Devuelve null si la ronda ya esta completa (nadie vivo le queda por actuar).
function determineActingSide(playerParticipants, enemyParticipants, lastActingSide) {
  const playerPending = aliveNotActed(playerParticipants);
  const enemyPending = aliveNotActed(enemyParticipants);

  if (playerPending.length === 0 && enemyPending.length === 0) return null;
  if (playerPending.length === 0) return 'ENEMY';
  if (enemyPending.length === 0) return 'PLAYER';

  if (!lastActingSide) {
    const playerSpeed = averageSpeed(playerParticipants);
    const enemySpeed = averageSpeed(enemyParticipants);
    return enemySpeed > playerSpeed ? 'ENEMY' : 'PLAYER';
  }

  return lastActingSide === 'PLAYER' ? 'ENEMY' : 'PLAYER';
}

// Siguiente actor dentro de un lado: el vivo que no actuo esta ronda con mayor SPD.
function nextActor(sideParticipants) {
  const eligible = aliveNotActed(sideParticipants);
  if (!eligible.length) return null;
  return eligible.sort((a, b) => b.spd - a.spd || a.id - b.id)[0];
}

// Un lado está aniquilado cuando todos sus participantes REALES (no invocados) tienen hp=0.
// Los invocados no cuentan: si el ultimo jugador muere, el combate termina aunque el invocado siga vivo.
function isWiped(sideParticipants) {
  return sideParticipants.every((p) => p.hp <= 0 || p.is_summon);
}

function pickRandomAliveTarget(opposingParticipants) {
  const alive = opposingParticipants.filter((p) => p.hp > 0);
  if (!alive.length) return null;
  return alive[Math.floor(Math.random() * alive.length)];
}

// Resuelve un ataque basico. Si target.is_defending, el golpe se reduce y se consume la defensa.
// elementalMods (opcional, ver lib/elements.js) = { damageBonusPercent, resistancePercent }: solo
// lo pasa routes/combat.js cuando el actor tiene element_id (monstruos elementales, ej. un dragon
// de fuego). El elemento es independiente de si el golpe es FISICO o MAGICO (igual que en skills,
// ver damage_school): la mitigacion sigue siendo DEF/MAGIC_DEF segun corresponda, el elemento se
// aplica encima.
function resolveAttack(actor, target, elementalMods, categoryBonusPercent = 0) {
  if (target.no_damage_window) return { evaded: true, crit: false, damage: 0 };
  const evaded = Math.random() * 100 < (target.evasion || 0);
  if (evaded) {
    return { evaded: true, crit: false, damage: 0 };
  }

  const isMagic = (actor.mag || 0) > (actor.atk || 0);
  const offense = isMagic ? actor.mag || 0 : actor.atk || 0;
  const mitigation = isMagic ? target.magic_def || 0 : target.def || 0;
  let damage = offense * 1.2 - mitigation * 0.5;

  if (elementalMods) {
    const bonusMultiplier = 1 + (elementalMods.damageBonusPercent || 0) / 100;
    const resistanceMultiplier = 1 - (elementalMods.resistancePercent || 0) / 100;
    damage *= bonusMultiplier * resistanceMultiplier;
  }

  if (categoryBonusPercent) {
    damage *= 1 + categoryBonusPercent / 100;
  }

  if (target.damage_taken_bonus) {
    damage *= 1 + Number(target.damage_taken_bonus) / 100;
  }

  if (target.damage_reduction) {
    damage *= 1 - Number(target.damage_reduction) / 100;
  }

  let crit = Math.random() * 100 < (actor.crit_chance || 0);
  let critPrevented = false;
  if (crit && target.crit_immune) {
    crit = false;
    critPrevented = true;
  } else if (crit) {
    damage *= 1 + (actor.crit_damage || 50) / 100;
  }

  damage = Math.max(1, Math.round(damage));

  if (target.is_defending) {
    damage = Math.max(1, Math.round(damage * 0.5));
    target.is_defending = false;
    if (target.defend_bonus_reduction) {
      damage = Math.max(1, Math.round(damage * (1 - Number(target.defend_bonus_reduction) / 100)));
      target.defend_bonus_reduction = 0;
    }
  }

  target.hp = Math.max(0, target.hp - damage);

  return { evaded: false, crit, damage, critPrevented };
}

// % de exito de escapar: base 50%, +2% por cada punto de SPD que el actor tenga sobre el
// promedio del equipo rival, acotado entre 10% y 90%.
function escapeChance(actor, opposingParticipants) {
  const opposingSpeed = averageSpeed(opposingParticipants);
  const chance = 50 + (actor.spd - opposingSpeed) * 2 + (actor.luck || 0);
  return Math.min(90, Math.max(10, chance));
}

function scalingStatValue(actor, scalingStat) {
  if (scalingStat === 'MAG') return (actor.mag || 0);
  if (scalingStat === 'HYBRID') return ((actor.atk || 0) + (actor.mag || 0)) * 0.5;
  return (actor.atk || 0);
}

// Un solo "hit" de una skill ATAQUE/CURACION contra un objetivo (las skills con hits>1, ej.
// Danza de Cuchillos, llaman esto varias veces). damage_school de la skill decide la mitigacion
// (DEF o DEF MAG o promedio para HIBRIDO) en vez de inferirla de los stats del actor como hace
// resolveAttack. elementalMods (opcional, ver lib/elements.js) = { damageBonusPercent,
// resistancePercent } del elemento de la skill; se aplican como multiplicador despues de la
// mitigacion y antes del critico. Solo lo calcula routes/combat.js cuando skill.element_id != null.
function resolveSkillHit(actor, target, skill, elementalMods, categoryBonusPercent = 0) {
  const power = Number(skill.base_value || 0) + scalingStatValue(actor, skill.scaling_stat) * Number(skill.scaling_multiplier || 0);

  if (skill.skill_type === 'CURACION') {
    const amount = Math.max(0, Math.round(power));
    target.hp = Math.min(target.max_hp, target.hp + amount);
    return { amount, evaded: false, crit: false };
  }

  if (target.no_damage_window) return { amount: 0, evaded: true, crit: false };
  const evaded = Math.random() * 100 < (target.evasion || 0);
  if (evaded) return { amount: 0, evaded: true, crit: false };

  const mitigation = skill.damage_school === 'MAGICO'
    ? (target.magic_def || 0)
    : skill.damage_school === 'HIBRIDO'
      ? ((target.def || 0) + (target.magic_def || 0)) * 0.5
      : (target.def || 0);
  let damage = power - mitigation * 0.5;

  if (skill.damage_school === 'MAGICO' && actor.magic_damage_bonus) {
    damage *= 1 + Number(actor.magic_damage_bonus) / 100;
  }

  if (elementalMods) {
    const bonusMultiplier = 1 + (elementalMods.damageBonusPercent || 0) / 100;
    const resistanceMultiplier = 1 - (elementalMods.resistancePercent || 0) / 100;
    damage *= bonusMultiplier * resistanceMultiplier;
  }

  if (elementalMods?.conditionalBonusPercent) {
    damage *= 1 + elementalMods.conditionalBonusPercent / 100;
  }

  if (categoryBonusPercent) {
    damage *= 1 + categoryBonusPercent / 100;
  }

  if (target.damage_taken_bonus) {
    damage *= 1 + Number(target.damage_taken_bonus) / 100;
  }

  if (target.damage_reduction) {
    damage *= 1 - Number(target.damage_reduction) / 100;
  }

  let crit = elementalMods?.guaranteedCrit || Math.random() * 100 < (actor.crit_chance || 0);
  let critPrevented = false;
  if (crit && target.crit_immune) {
    crit = false;
    critPrevented = true;
  } else if (crit) {
    damage *= 1 + (actor.crit_damage || 50) / 100;
  }

  damage = Math.max(1, Math.round(damage));

  if (target.is_defending) {
    damage = Math.max(1, Math.round(damage * 0.5));
    target.is_defending = false;
    if (target.defend_bonus_reduction) {
      damage = Math.max(1, Math.round(damage * (1 - Number(target.defend_bonus_reduction) / 100)));
      target.defend_bonus_reduction = 0;
    }
  }

  target.hp = Math.max(0, target.hp - damage);
  return { amount: damage, evaded: false, crit, critPrevented };
}

// Resuelve una skill ATAQUE/CURACION contra 1+ objetivos, repitiendo skill.hits veces por
// objetivo. Solo soporta estos dos skill_type por ahora: BUFF/DEBUFF con duracion y el resto de
// ESPECIAL (revivir, limpiar, dano condicional, etc.) todavia no tienen motor de resolucion
// (quedan deshabilitados en GET /api/players/:playerId/skills hasta la siguiente pasada).
function resolveSkill(actor, targets, skill, elementalModsByTargetId = {}, categoryBonusByTargetId = {}) {
  return targets.map((target) => {
    let total = 0;
    let anyCrit = false;
    let anyCritPrevented = false;
    let allEvaded = true;
    const elementalMods = elementalModsByTargetId[target.id];
    const categoryBonusPercent = categoryBonusByTargetId[target.id] || 0;

    for (let i = 0; i < (skill.hits || 1); i += 1) {
      if (skill.skill_type !== 'CURACION' && target.hp <= 0) break;
      const hit = resolveSkillHit(actor, target, skill, elementalMods, categoryBonusPercent);
      total += hit.amount;
      if (!hit.evaded) allEvaded = false;
      if (hit.crit) anyCrit = true;
      if (hit.critPrevented) anyCritPrevented = true;
    }

    return { target, amount: total, evaded: allEvaded, crit: anyCrit, critPrevented: anyCritPrevented };
  });
}

module.exports = {
  averageSpeed,
  determineActingSide,
  nextActor,
  isWiped,
  pickRandomAliveTarget,
  resolveAttack,
  escapeChance,
  resolveSkill,
};
