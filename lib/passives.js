const db = require('../db/db');

// Retorna bonuses acumulados de todas las skills pasivas (LEVEL) de una clase hasta cierto nivel.
// uniqueSkill = la pasiva de learn_level=1 (la "Habilidad Unica" innata de la clase base).
async function getClassPassiveBonuses(classId, level) {
  if (!classId || !level) {
    return {
      atk: 0, mag: 0, hp: 0, spd: 0, def: 0, crit_chance: 0, evasion: 0,
      magic_damage_bonus: 0, hot_hp_percent: 0,
      magic_def: 0, crit_damage: 0,
      physical_damage: 0, magical_damage: 0, elemental_damage: 0,
      gold_bonus: 0, xp_bonus: 0, drop_rate_bonus: 0, heal_bonus: 0,
      luck: 0,
      uniqueSkill: null,
    };
  }

  const res = await db.query(
    `SELECT s.name, s.description, s.learn_level, se.stat_code, se.effect_type, se.percent_amount
     FROM skills s
     JOIN skill_effects se ON se.skill_id = s.id
     WHERE s.class_id = $1
       AND s.is_passive = TRUE
       AND s.learn_method = 'LEVEL'
       AND s.learn_level <= $2
       AND se.effect_type IN ('STAT_MOD', 'HOT')
     ORDER BY s.learn_level, s.id`,
    [classId, level]
  );

  const bonuses = {
    atk: 0, mag: 0, hp: 0, spd: 0, def: 0, crit_chance: 0, evasion: 0,
    magic_damage_bonus: 0, hot_hp_percent: 0,
    magic_def: 0, crit_damage: 0,
    physical_damage: 0, magical_damage: 0, elemental_damage: 0,
    gold_bonus: 0, xp_bonus: 0, drop_rate_bonus: 0, heal_bonus: 0,
    luck: 0,
    uniqueSkill: null,
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
    // La pasiva innata es la de learn_level=1 (puede tener varios skill_effects; solo guardamos una vez)
    if (Number(row.learn_level) === 1 && !bonuses.uniqueSkill) {
      bonuses.uniqueSkill = { name: row.name, description: row.description };
    }
  }

  return bonuses;
}

module.exports = { getClassPassiveBonuses };
