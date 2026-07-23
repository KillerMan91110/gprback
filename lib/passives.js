const db = require('../db/db');

// Retorna bonuses acumulados de todas las skills pasivas (LEVEL) de una clase hasta cierto nivel.
// classIds acepta un solo id (compatibilidad) o un array: para un jugador evolucionado hay que
// pasar [current_class_id, evolution_class_id] — evolucionar NO borra las pasivas que ya tenías
// de la clase base (siguen listadas en skills con class_id = la clase base), así que si acá solo
// se consulta la clase efectiva esas pasivas dejan de sumar aunque el jugador las siga "teniendo".
// uniqueSkill = la primera pasiva única en aparecer (ver nota mas abajo, no siempre es learn_level=1).
async function getClassPassiveBonuses(classIds, level) {
  const ids = (Array.isArray(classIds) ? classIds : [classIds]).filter(Boolean);
  if (!ids.length || !level) {
    return {
      atk: 0, mag: 0, hp: 0, spd: 0, def: 0, crit_chance: 0, evasion: 0,
      magic_damage_bonus: 0, hot_hp_percent: 0,
      magic_def: 0, crit_damage: 0,
      physical_damage: 0, magical_damage: 0, elemental_damage: 0,
      gold_bonus: 0, xp_bonus: 0, drop_rate_bonus: 0, heal_bonus: 0,
      luck: 0,
      uniqueSkill: null,
      innate: null,
    };
  }

  // La clase EFECTIVA (evolucionada si hay una, si no la base) es el último id del array — se
  // usa para elegir la "pasiva única" que muestra la ficha y para buscar la innata más abajo.
  const effectiveClassId = ids[ids.length - 1];

  const res = await db.query(
    `SELECT s.class_id, s.name, s.description, s.learn_level, se.stat_code, se.effect_type, se.percent_amount
     FROM skills s
     JOIN skill_effects se ON se.skill_id = s.id
     WHERE s.class_id = ANY($1::int[])
       AND s.is_passive = TRUE
       AND s.learn_method = 'LEVEL'
       AND s.learn_level <= $2
       AND se.effect_type IN ('STAT_MOD', 'HOT')
     ORDER BY s.learn_level, s.id`,
    [ids, level]
  );

  const bonuses = {
    atk: 0, mag: 0, hp: 0, spd: 0, def: 0, crit_chance: 0, evasion: 0,
    magic_damage_bonus: 0, hot_hp_percent: 0,
    magic_def: 0, crit_damage: 0,
    physical_damage: 0, magical_damage: 0, elemental_damage: 0,
    gold_bonus: 0, xp_bonus: 0, drop_rate_bonus: 0, heal_bonus: 0,
    luck: 0,
    uniqueSkill: null,
    innate: null,
  };

  for (const row of res.rows) {
    const pct = Number(row.percent_amount || 0);
    if (row.effect_type === 'HOT' && row.stat_code === 'HP') {
      bonuses.hot_hp_percent += pct;
    } else if (row.effect_type === 'STAT_MOD') {
      if (row.stat_code === 'ATK') bonuses.atk += pct;
      else if (row.stat_code === 'MAG') bonuses.mag += pct;
      else if (row.stat_code === 'HP') bonuses.hp += pct;
      else if (row.stat_code === 'SPD') bonuses.spd += pct;
      else if (row.stat_code === 'DEF') bonuses.def += pct;
      else if (row.stat_code === 'CRIT_CHANCE') bonuses.crit_chance += pct;
      else if (row.stat_code === 'EVASION') bonuses.evasion += pct;
      else if (row.stat_code === 'MAGIC_DAMAGE_DEALT') bonuses.magic_damage_bonus += pct;
      else if (row.stat_code === 'MAGIC_DEF') bonuses.magic_def += pct;
      else if (row.stat_code === 'CRIT_DAMAGE') bonuses.crit_damage += pct;
      else if (row.stat_code === 'PHYSICAL_DAMAGE') bonuses.physical_damage += pct;
      else if (row.stat_code === 'MAGICAL_DAMAGE') bonuses.magical_damage += pct;
      else if (row.stat_code === 'ELEMENTAL_DAMAGE') bonuses.elemental_damage += pct;
      else if (row.stat_code === 'GOLD_BONUS') bonuses.gold_bonus += pct;
      else if (row.stat_code === 'XP_BONUS') bonuses.xp_bonus += pct;
      else if (row.stat_code === 'DROP_RATE_BONUS') bonuses.drop_rate_bonus += pct;
      else if (row.stat_code === 'HEAL_BONUS') bonuses.heal_bonus += pct;
      else if (row.stat_code === 'LUCK') bonuses.luck += pct;
    }
    // La pasiva única mostrada en la ficha es la primera pasiva de la clase EFECTIVA en aparecer
    // (filtrando por class_id, no cualquiera del array) — no necesariamente en nivel 1: para una
    // clase evolucionada, su propio "Don de X" se aprende recién al nivel donde esa clase se
    // desbloquea (ver docs/backend-fix-uniqueskill-post-evolution.md). Si se tomara la primera del
    // array sin filtrar, con clases evolucionadas terminaría mostrando el "Don de X" de la clase
    // BASE (learn_level más bajo) en vez del de la clase evolucionada actual.
    if (!bonuses.uniqueSkill && row.class_id === effectiveClassId) {
      bonuses.uniqueSkill = { name: row.name, description: row.description };
    }
  }

  // Innata de clase evolucionada (ver backend-spec-class-innates.md sección 8). Si es PASSIVE_STAT
  // (bono plano, sin condición) suma a la ficha además de pesar en combate. PASSIVE_CONDITIONAL/
  // TEAM_AURA/triggers de evento quedan afuera del cálculo de stats a propósito — dependen del
  // estado de otros participantes en combate, no tiene sentido "hornear" un número fijo para la
  // ficha fuera de pelea — pero igual se expone name/description para que el front la muestre.
  // La innata solo existe en la clase EVOLUCIONADA — se busca con effectiveClassId.
  const innateRes = await db.query(
    `SELECT name, description, trigger_type, stat_code, percent_amount
     FROM class_innate_abilities WHERE class_id = $1`,
    [effectiveClassId]
  );
  if (innateRes.rows.length) {
    const innate = innateRes.rows[0];
    bonuses.innate = { name: innate.name, description: innate.description };
    if (innate.trigger_type === 'PASSIVE_STAT') {
      const pct = Number(innate.percent_amount || 0);
      if (innate.stat_code === 'ATK') bonuses.atk += pct;
      else if (innate.stat_code === 'MAG') bonuses.mag += pct;
      else if (innate.stat_code === 'SPD') bonuses.spd += pct;
      else if (innate.stat_code === 'DEF') bonuses.def += pct;
      else if (innate.stat_code === 'CRIT_CHANCE') bonuses.crit_chance += pct;
      else if (innate.stat_code === 'EVASION') bonuses.evasion += pct;
      else if (innate.stat_code === 'MAGIC_DEF') bonuses.magic_def += pct;
    }
  }

  return bonuses;
}

module.exports = { getClassPassiveBonuses };
