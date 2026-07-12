const db = require('../db/db');

const RANK_ORDER = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];

function rankAtLeast(rankCode, minRankCode) {
  if (!minRankCode) return true;
  if (!rankCode) return false;
  return RANK_ORDER.indexOf(rankCode) >= RANK_ORDER.indexOf(minRankCode);
}

async function getRankForReputation(reputation) {
  const result = await db.query(
    `SELECT code FROM ranks
     WHERE min_reputation <= $1 AND (max_reputation IS NULL OR max_reputation >= $1)
     ORDER BY min_reputation DESC
     LIMIT 1`,
    [reputation]
  );
  return result.rows[0] ? result.rows[0].code : 'F';
}

// Progreso de rango para mostrar "reputación / reputación necesaria" en el front (igual patron
// que xp/xpThreshold de nivel en leveling.js). Si ya esta en el rango mas alto (max_reputation
// NULL, hoy 'S'), reputationForNextRank queda null para que el front muestre "rango maximo".
async function getRankProgress(reputation) {
  const result = await db.query('SELECT code, min_reputation, max_reputation FROM ranks ORDER BY min_reputation');
  const ranks = result.rows;

  let current = ranks[0];
  for (const r of ranks) {
    if (Number(r.min_reputation) <= reputation) current = r;
  }

  const currentIndex = ranks.findIndex((r) => r.code === current.code);
  const next = ranks[currentIndex + 1] || null;

  return {
    rankCode: current.code,
    reputation,
    reputationForNextRank: next ? Number(next.min_reputation) : null,
    isMaxRank: !next,
  };
}

// Bonus de XP/recompensa que da el rango actual (ranks.xp_bonus_percent / reward_bonus_percent),
// usado para escalar el oro y la XP que otorgan quests y combates (ver routes/players.js y
// routes/combat.js). Antes estos campos solo se mostraban en /api/player/:id/reputation sin
// afectar ninguna recompensa real.
async function getRankBonuses(rankCode) {
  const result = await db.query(
    'SELECT xp_bonus_percent, reward_bonus_percent FROM ranks WHERE code = $1',
    [rankCode]
  );
  if (!result.rows.length) return { xpBonusPercent: 0, rewardBonusPercent: 0 };
  return {
    xpBonusPercent: Number(result.rows[0].xp_bonus_percent),
    rewardBonusPercent: Number(result.rows[0].reward_bonus_percent),
  };
}

function applyPercentBonus(amount, percent) {
  return Math.round(amount * (1 + percent / 100));
}

module.exports = {
  RANK_ORDER,
  rankAtLeast,
  getRankForReputation,
  getRankProgress,
  getRankBonuses,
  applyPercentBonus,
};
