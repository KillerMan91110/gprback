const mecanicas = require('./mecanicas');

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
// Diferencia de nivel contra monstruos: si el monstruo te pasa por más de LEVEL_GAP_FREE niveles,
// le haces menos daño y él te hace más (un LEVEL_GAP_STEP por nivel de más, con tope). Así un nivel
// 1 con buen equipo no puede limpiar una subzona de nivel 8. Ir por debajo no da bonus: solo castiga
// meterse donde todavía no toca. Entre jugadores (o si falta un nivel) no cambia nada.
// Daño mínimo: la defensa resta, pero nunca deja el golpe por debajo de este porcentaje (antes un
// Guerrero con buena defensa recibía 1-3 de daño de los monstruos de su nivel y aguantaba 25 golpes)
const DAMAGE_FLOOR = 0.35;

// parte del golpe básico de un monstruo con elemento que sale de su elemento (ver resolveAttack)
const MONSTER_ELEMENT_SHARE = 0.3;

// Monstruos de magia (MAG > ATK): su básico es físico y flojo, así que lanzan sus hechizos más seguido.
// Con sus probabilidades de siempre (use_chance_percent) lanzarían en P de sus turnos; este sorteo elige
// de antemano un hechizo para que en total lancen CASTER_CAST_RATE de sus turnos (los que ya lanzaban
// más, como los jefes, quedan igual). skills: las que tiene, ya ordenadas por prioridad.
// Devuelve la elegida o null.
const CASTER_CAST_RATE = 0.75;
function monsterForcedSkill(actor, skills) {
  if (!actor?.monster_code || (actor.mag || 0) <= (actor.atk || 0)) return null;
  const usable = skills.filter((s) => ['ENEMY', 'ALL_ENEMIES'].includes(s.target_type)
    && Number(actor.mana || 0) >= Number(s.mana_cost || 0) && Number(s.use_chance_percent) > 0);
  if (!usable.length) return null;
  const miss = usable.reduce((m, s) => m * (1 - Math.min(100, Number(s.use_chance_percent)) / 100), 1);
  const natural = 1 - miss;
  if (natural >= CASTER_CAST_RATE) return null;
  if (Math.random() >= (CASTER_CAST_RATE - natural) / (1 - natural)) return null;
  // el lanzamiento de más es un hechizo de daño de un solo objetivo si tiene (si no, mágico de área)
  const magic = usable.filter((s) => s.skill_type === 'ATAQUE' && s.damage_school === 'MAGICO');
  const single = magic.filter((s) => s.target_type === 'ENEMY');
  const pool = single.length ? single : magic.length ? magic : usable;
  let roll = Math.random() * pool.reduce((t, s) => t + Number(s.use_chance_percent), 0);
  for (const s of pool) {
    roll -= Number(s.use_chance_percent);
    if (roll <= 0) return s;
  }
  return pool[pool.length - 1];
}

const LEVEL_GAP_FREE = 2;
const LEVEL_GAP_STEP = 0.1;
const LEVEL_GAP_MAX_STEPS = 7; // tope: 30% del daño hecho, +70% del recibido

function levelGapMultiplier(actor, target) {
  if (!actor || !target || !!actor.monster_code === !!target.monster_code) return 1;
  const monster = actor.monster_code ? actor : target;
  const hero = actor.monster_code ? target : actor;
  if (!monster.level || !hero.level) return 1;
  const steps = Math.min(LEVEL_GAP_MAX_STEPS, Number(monster.level) - Number(hero.level) - LEVEL_GAP_FREE);
  if (steps <= 0) return 1;
  return actor.monster_code ? 1 + steps * LEVEL_GAP_STEP : 1 - steps * LEVEL_GAP_STEP;
}

function resolveAttack(actor, target, elementalMods, categoryBonusPercent = 0) {
  if (target.no_damage_window) return { evaded: true, crit: false, damage: 0 };
  // ceguera (blind_miss): el que ataca falla más
  const evaded = Math.random() * 100 < (target.evasion || 0) + (actor.blind_miss || 0);
  if (evaded) {
    return { evaded: true, crit: false, damage: 0 };
  }

  // El básico de todos (jugadores, NPCs y monstruos) es FÍSICO: escala con ATK y mitiga contra DEF.
  // La magia sale de las habilidades (damage_school MAGICO) o de la innata
  // basic_attack_extra_mag_percent / imbue de más abajo.
  let offense = actor.atk || 0;
  if (actor.basic_attack_extra_mag_percent) {
    offense += (actor.mag || 0) * Number(actor.basic_attack_extra_mag_percent) / 100;
  }
  const ignoreDef = (m) => (actor.ignore_def_percent ? m * (1 - Number(actor.ignore_def_percent) / 100) : m);
  let damage = Math.max(offense * 1.2 * DAMAGE_FLOOR, offense * 1.2 - ignoreDef(target.def || 0) * 0.5);

  // Monstruo con elemento: al golpe físico le suma una parte de su elemento (MONSTER_ELEMENT_SHARE de
  // un golpe con su MAG contra la DEF MAG). Solo esa parte depende de la resistencia del objetivo:
  // si la resiste baja (o se anula), neutra entra entera, si es débil entra con más daño.
  let elementPart = 0;
  if (elementalMods && actor.monster_code) {
    const mag = actor.mag || 0;
    const magicHit = Math.max(mag * 1.2 * DAMAGE_FLOOR, mag * 1.2 - ignoreDef(target.magic_def || 0) * 0.5);
    const bonusMultiplier = 1 + (elementalMods.damageBonusPercent || 0) / 100;
    const resistanceMultiplier = Math.max(0, 1 - (elementalMods.resistancePercent || 0) / 100);
    elementPart = magicHit * MONSTER_ELEMENT_SHARE * bonusMultiplier * resistanceMultiplier;
    damage += elementPart;
  } else if (elementalMods) {
    // jugadores y NPCs con el arma imbuida: el elemento afecta a todo el golpe
    const bonusMultiplier = 1 + (elementalMods.damageBonusPercent || 0) / 100;
    const resistanceMultiplier = 1 - (elementalMods.resistancePercent || 0) / 100;
    damage *= bonusMultiplier * resistanceMultiplier;
  }
  const elementShare = damage > 0 ? elementPart / damage : 0;

  if (categoryBonusPercent) {
    damage *= 1 + categoryBonusPercent / 100;
  }

  if (target.damage_taken_bonus) {
    damage *= 1 + Number(target.damage_taken_bonus) / 100;
  }

  if (target.damage_reduction) {
    damage *= 1 - Number(target.damage_reduction) / 100;
  }

  damage *= levelGapMultiplier(actor, target);

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
    if (!actor.ignores_defend_status) {
      damage = Math.max(1, Math.round(damage * 0.5));
      if (target.defend_bonus_reduction) {
        damage = Math.max(1, Math.round(damage * (1 - Number(target.defend_bonus_reduction) / 100)));
      }
    }
    target.is_defending = false;
    target.defend_bonus_reduction = 0;
  }

  // barrera, clon, contragolpe, juramento y semilla (lib/mecanicas.js)
  damage = mecanicas.recibirDanio(actor, target, damage, true);

  // elementDamage: cuánto de ese daño fue de su elemento (para el registro del combate)
  return { evaded: false, crit, damage, critPrevented, elementDamage: Math.round(damage * elementShare) };
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
  const evaded = Math.random() * 100 < (target.evasion || 0) + (actor.blind_miss || 0);
  if (evaded) return { amount: 0, evaded: true, crit: false };

  const effectiveMagicDef = elementalMods?.ignoreMagicDef ? 0 : (target.magic_def || 0);
  const rawMitigation = skill.damage_school === 'MAGICO'
    ? effectiveMagicDef
    : skill.damage_school === 'HIBRIDO'
      ? ((target.def || 0) + effectiveMagicDef) * 0.5
      : (target.def || 0);
  const mitigation = actor.ignore_def_percent ? rawMitigation * (1 - Number(actor.ignore_def_percent) / 100) : rawMitigation;
  let damage = Math.max(power * DAMAGE_FLOOR, power - mitigation * 0.5);

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

  damage *= levelGapMultiplier(actor, target);

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
    if (!actor.ignores_defend_status) {
      damage = Math.max(1, Math.round(damage * 0.5));
      if (target.defend_bonus_reduction) {
        damage = Math.max(1, Math.round(damage * (1 - Number(target.defend_bonus_reduction) / 100)));
      }
    }
    target.is_defending = false;
    target.defend_bonus_reduction = 0;
  }

  damage = mecanicas.recibirDanio(actor, target, damage, skill.damage_school !== 'MAGICO');
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
  levelGapMultiplier,
  monsterForcedSkill,
  DAMAGE_FLOOR,
  MONSTER_ELEMENT_SHARE,
};
