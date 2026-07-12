const db = require('../db/db');

// XP que necesita un gremio para subir DESDE el nivel dado al siguiente.
function guildXpForLevel(level) {
  return level * 1000;
}

// Suma xpGain al gremio y sube de nivel si corresponde. No falla si el gremio no existe.
async function applyGuildXp(guildId, xpGain) {
  if (!xpGain || xpGain <= 0) return null;
  const res = await db.query('SELECT level, xp FROM guilds WHERE id = $1', [guildId]);
  if (!res.rows.length) return null;
  let { level, xp } = res.rows[0];
  xp = Number(xp) + xpGain;
  let leveled = false;
  while (xp >= guildXpForLevel(level)) {
    xp -= guildXpForLevel(level);
    level += 1;
    leveled = true;
  }
  await db.query('UPDATE guilds SET xp = $1, level = $2 WHERE id = $3', [xp, level, guildId]);
  return { level, leveled };
}

// Devuelve la fila de guild_members + guild del jugador, o null si no está en ninguno.
async function getPlayerGuildRow(playerId) {
  const res = await db.query(
    `SELECT g.id, g.name, g.description, g.level, g.xp, g.type, g.leader_id,
            gm.role, gm.joined_at
     FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.player_id = $1`,
    [playerId]
  );
  return res.rows[0] || null;
}

module.exports = { guildXpForLevel, applyGuildXp, getPlayerGuildRow };
