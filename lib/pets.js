const db = require('../db/db');

const DEFAULTS = {
  atk: 0, def: 0, mag: 0, magic_def: 0, spd: 0,
  crit_chance: 0, crit_damage: 0, evasion: 0, hp: 0, mana: 0, luck: 0,
  heal_bonus: 0, hot_hp_percent: 0,
  gold_percent: 0, xp_percent: 0, drop_rate_percent: 0,
  physical_damage: 0, magical_damage: 0, elemental_damage: 0,
  damage_reduction: 0, elemental_resistance: 0,
  mana_cost_reduction: 0, escape_bonus: 0,
  guild_xp_percent: 0, passive_revive: false,
};

async function getActivePetBonuses(playerId) {
  const res = await db.query(
    `SELECT pb.stat_code, pb.base_amount, pb.per_level_amount, pp.level
     FROM player_pets pp
     JOIN pet_bonuses pb ON pb.pet_id = pp.pet_id
     WHERE pp.player_id = $1 AND pp.is_active = TRUE`,
    [playerId]
  );

  const b = { ...DEFAULTS };
  for (const row of res.rows) {
    const v = Number(row.base_amount) + Number(row.per_level_amount) * (row.level - 1);
    switch (row.stat_code) {
      case 'ATK_FLAT':                     b.atk               += v; break;
      case 'DEF_FLAT':                     b.def               += v; break;
      case 'MAG_FLAT':                     b.mag               += v; break;
      case 'MAGIC_DEF_FLAT':              b.magic_def          += v; break;
      case 'SPD_FLAT':                     b.spd               += v; break;
      case 'CRIT_CHANCE_FLAT':             b.crit_chance       += v; break;
      case 'CRIT_DMG_FLAT':               b.crit_damage        += v; break;
      case 'EVASION_FLAT':                 b.evasion           += v; break;
      case 'HP_FLAT':                      b.hp                += v; break;
      case 'MANA_FLAT':                    b.mana              += v; break;
      case 'LUCK_FLAT':                    b.luck              += v; break;
      case 'HEAL_BONUS_PERCENT':           b.heal_bonus        += v; break;
      case 'HOT_HP_PERCENT':              b.hot_hp_percent     += v; break;
      case 'GOLD_PERCENT':                 b.gold_percent      += v; break;
      case 'XP_PERCENT':                   b.xp_percent        += v; break;
      case 'DROP_RATE_PERCENT':            b.drop_rate_percent += v; break;
      case 'PHYSICAL_DAMAGE_PERCENT':      b.physical_damage   += v; break;
      case 'MAGICAL_DAMAGE_PERCENT':       b.magical_damage    += v; break;
      case 'ELEMENTAL_DAMAGE_PERCENT':     b.elemental_damage  += v; break;
      case 'DAMAGE_REDUCTION_PERCENT':     b.damage_reduction  += v; break;
      case 'ELEMENTAL_RESISTANCE_PERCENT': b.elemental_resistance += v; break;
      case 'MANA_COST_REDUCTION_PERCENT':  b.mana_cost_reduction += v; break;
      case 'ESCAPE_BONUS_FLAT':            b.escape_bonus      += v; break;
      case 'GUILD_XP_PERCENT':            b.guild_xp_percent   += v; break;
      case 'PASSIVE_REVIVE':               b.passive_revive     = v >= 1; break;
    }
  }
  return b;
}

module.exports = { getActivePetBonuses };
