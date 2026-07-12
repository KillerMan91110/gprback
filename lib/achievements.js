const db = require('../db/db');

async function checkQuestAchievements(playerId, questId, timesCompleted) {
  const eligible = await db.query(
    `SELECT id, code, name, description, bonus_type, bonus_category, bonus_stat, bonus_percent
     FROM achievements
     WHERE quest_id = $1 AND threshold <= $2 AND condition_type = 'QUEST_COMPLETIONS'`,
    [questId, timesCompleted]
  );
  if (!eligible.rows.length) return [];

  const unlocked = [];
  for (const ach of eligible.rows) {
    const res = await db.query(
      `INSERT INTO player_achievements(player_id, achievement_id)
       VALUES($1, $2) ON CONFLICT(player_id, achievement_id) DO NOTHING RETURNING id`,
      [playerId, ach.id]
    );
    if (res.rows.length) unlocked.push(ach);
  }
  return unlocked;
}

// Devuelve todos los bonus activos del jugador organizados por tipo.
// bonus_type soportados:
//   DAMAGE_VS_CATEGORY  → categoryDamage[cat]   (BESTIA, HUMANOIDE, etc.)
//   DAMAGE_PHYSICAL     → physicalDamage         (ataques físicos, básicos y skills FISICO)
//   DAMAGE_MAGICAL      → magicalDamage          (ataques mágicos, básicos y skills MAGICO)
//   DAMAGE_ELEMENTAL    → elementalDamage        (cualquier ataque con elemento)
//   DAMAGE_ELEMENT      → elementDamage[code]    (elemento específico: FIRE, ICE, etc.)
//   GOLD_EARNED         → goldEarned             (quests y combate)
//   XP_EARNED           → xpEarned               (quests y combate)
async function getPlayerBonuses(playerId) {
  const result = await db.query(
    `SELECT a.bonus_type, a.bonus_category, a.bonus_stat, SUM(a.bonus_percent) AS total_percent
     FROM player_achievements pa
     JOIN achievements a ON a.id = pa.achievement_id
     WHERE pa.player_id = $1
     GROUP BY a.bonus_type, a.bonus_category, a.bonus_stat`,
    [playerId]
  );

  const bonuses = {
    categoryDamage: {},
    physicalDamage: 0,
    magicalDamage: 0,
    elementalDamage: 0,
    elementDamage: {},
    goldEarned: 0,
    xpEarned: 0,
  };

  for (const row of result.rows) {
    const pct = Number(row.total_percent);
    switch (row.bonus_type) {
      case 'DAMAGE_VS_CATEGORY':
        if (row.bonus_category) bonuses.categoryDamage[row.bonus_category] = (bonuses.categoryDamage[row.bonus_category] || 0) + pct;
        break;
      case 'DAMAGE_PHYSICAL':
        bonuses.physicalDamage += pct;
        break;
      case 'DAMAGE_MAGICAL':
        bonuses.magicalDamage += pct;
        break;
      case 'DAMAGE_ELEMENTAL':
        bonuses.elementalDamage += pct;
        break;
      case 'DAMAGE_ELEMENT':
        if (row.bonus_stat) bonuses.elementDamage[row.bonus_stat] = (bonuses.elementDamage[row.bonus_stat] || 0) + pct;
        break;
      case 'GOLD_EARNED':
        bonuses.goldEarned += pct;
        break;
      case 'XP_EARNED':
        bonuses.xpEarned += pct;
        break;
    }
  }

  return bonuses;
}

module.exports = { checkQuestAchievements, getPlayerBonuses };
