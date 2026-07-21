const db = require('../db/db');

const GUILD_EMBLEMS = ['🐉','🦁','⚔️','🛡️','🔥','❄️','👑','🦅','🐺','☠️','⭐','🌙'];
const GUILD_COLORS = ['#d4af37','#e0394f','#4fa0e0','#5fd97e','#b572e0','#f0a93a','#7a1020','#143a66','#ece3cf','#b9b3c4'];

// XP que necesita un gremio para subir DESDE el nivel dado al siguiente.
function guildXpForLevel(level) {
  return level * 1000;
}

// Cupo de miembros según el nivel del gremio (ver sección 7 del spec de gremio).
function guildMemberCap(level) {
  if (level >= 5) return 30;
  if (level >= 4) return 20;
  return 10;
}

// Multiplicadores de recompensa de combate por nivel de gremio: +1% oro / +0.5% xp por nivel,
// tope en nivel 20. Sin gremio, no hay bonus.
function combatBonusMultipliers(guildLevel) {
  if (!guildLevel) return { gold: 1, xp: 1 };
  const level = Math.min(guildLevel, 20);
  return { gold: 1 + level * 0.01, xp: 1 + level * 0.005 };
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
  if (leveled) {
    await logGuildActivity(guildId, 'LEVEL_UP', null, null, { newLevel: level });
  }
  return { level, leveled };
}

// Devuelve la fila de guild_members + guild del jugador, o null si no está en ninguno.
async function getPlayerGuildRow(playerId) {
  const res = await db.query(
    `SELECT g.id, g.name, g.description, g.level, g.xp, g.type, g.leader_id,
            g.created_at, g.emblem, g.color, g.bank_gold,
            gm.role, gm.joined_at
     FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.player_id = $1`,
    [playerId]
  );
  return res.rows[0] || null;
}

// Nivel de gremio de cada jugador de la lista (0 si no está en gremio). Para aplicar el bonus
// de combate por gremio a cada uno según SU PROPIO gremio (no el de quien inició el combate).
async function getGuildLevelsForPlayers(playerIds) {
  const levels = new Map(playerIds.map((id) => [id, 0]));
  if (!playerIds.length) return levels;
  const res = await db.query(
    `SELECT gm.player_id, g.level
     FROM guild_members gm
     JOIN guilds g ON g.id = gm.guild_id
     WHERE gm.player_id = ANY($1::int[])`,
    [playerIds]
  );
  for (const row of res.rows) levels.set(row.player_id, row.level);
  return levels;
}

// Registra un evento en el historial de actividad del gremio. No falla el flujo llamador si
// el insert falla (el log es best-effort, no debe tumbar la acción principal).
async function logGuildActivity(guildId, type, actorId = null, targetId = null, meta = null) {
  try {
    await db.query(
      `INSERT INTO guild_activity_log(guild_id, type, actor_id, target_id, meta) VALUES ($1, $2, $3, $4, $5)`,
      [guildId, type, actorId, targetId, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('No se pudo registrar actividad de gremio:', err);
  }
}

module.exports = {
  GUILD_EMBLEMS,
  GUILD_COLORS,
  guildXpForLevel,
  guildMemberCap,
  combatBonusMultipliers,
  applyGuildXp,
  getPlayerGuildRow,
  getGuildLevelsForPlayers,
  logGuildActivity,
};
