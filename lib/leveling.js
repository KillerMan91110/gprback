const db = require('../db/db');
const { getEquipmentBonuses } = require('./equipment');

// Curva de XP ("Medio"): calibrada contra el XP real de monstruos comunes de cada zona, no una
// formula pareja. kills(L) = cuantos comunes de ESA zona equivaldria subir el nivel L, crece
// lineal de ~8.5 en nivel 1 a ~32.5 en nivel 15 (fin de Pradera Dorada) y sigue con la misma
// pendiente mas alla; se multiplica por el XP real del comun de la zona en la que cae ese nivel.
// Resultado: nivel 1->2 ~111xp, nivel 15->16 ~423xp, nivel 30->31 ~2270xp, ~1.82M acumulado a
// nivel 100. Se escala por xp_rate de la clase igual que antes (mas alto = sube mas lento).
const ZONE_COMMON_XP = [
  { lo: 1, hi: 15, xp: 13 },
  { lo: 16, hi: 30, xp: 39 },
  { lo: 31, hi: 45, xp: 75 },
  { lo: 46, hi: 60, xp: 117 },
  { lo: 61, hi: 75, xp: 170 },
  { lo: 76, hi: 85, xp: 250 },
  { lo: 86, hi: 100, xp: 370 },
];
function commonXpAt(level) {
  const zone = ZONE_COMMON_XP.find((z) => level >= z.lo && level <= z.hi);
  return zone ? zone.xp : ZONE_COMMON_XP[ZONE_COMMON_XP.length - 1].xp;
}
const KILLS_AT_LEVEL_1 = 8.5;
const KILLS_AT_LEVEL_15 = 32.5;
const KILLS_SLOPE = (KILLS_AT_LEVEL_15 - KILLS_AT_LEVEL_1) / 14;
function killsNeeded(level) {
  return KILLS_AT_LEVEL_1 + KILLS_SLOPE * (level - 1);
}

// Cuanto XP acumulado total hace falta para LLEGAR a un nivel dado (nivel 1 = 0).
function xpThreshold(level, xpRate) {
  if (level <= 1) return 0;
  let cumulative = 0;
  for (let lvl = 1; lvl < level; lvl += 1) {
    cumulative += killsNeeded(lvl) * commonXpAt(lvl);
  }
  return Math.round(cumulative * xpRate);
}

function levelForXp(xp, xpRate) {
  let level = 1;
  while (xpThreshold(level + 1, xpRate) <= xp) {
    level += 1;
  }
  return level;
}

// Recalcula las stats de una clase en un nivel dado sumando los incrementos de class_growths
// tramo por tramo, siempre desde la base (no de forma incremental) para no acumular errores de
// redondeo si se llama varias veces. Si el nivel supera el ultimo tramo cargado (ej. una clase
// base sin evolucionar todavia mas alla de nivel 24), las stats simplemente dejan de crecer.
function computeStatsAtLevel(base, growthRows, level) {
  const stats = {
    hp: Number(base.base_hp),
    atk: Number(base.base_atk),
    def: Number(base.base_def),
    mag: Number(base.base_mag),
    magicDef: Number(base.base_magic_def),
    spd: Number(base.base_spd),
    crit: Number(base.base_crit_chance),
    mana: Number(base.base_mana),
  };

  for (let lvl = 2; lvl <= level; lvl += 1) {
    const row = growthRows.find((r) => lvl >= r.level_from && lvl <= r.level_to);
    if (!row) continue;
    stats.hp += Number(row.hp_per_level);
    stats.atk += Number(row.atk_per_level);
    stats.def += Number(row.def_per_level);
    stats.mag += Number(row.mag_per_level);
    stats.magicDef += Number(row.magic_def_per_level);
    stats.spd += Number(row.spd_per_level);
    stats.mana += Number(row.mana_per_level);
  }

  return {
    hp: Math.round(stats.hp),
    atk: Math.round(stats.atk),
    def: Math.round(stats.def),
    mag: Math.round(stats.mag),
    magicDef: Math.round(stats.magicDef),
    spd: Math.round(stats.spd),
    crit: Math.round(stats.crit),
    mana: Math.round(stats.mana),
  };
}

// Devuelve el crit_damage% base de la clase (classes.base_crit_damage). No tiene crecimiento
// por nivel como crit_chance, asi que no hace falta persistirlo por jugador/NPC.
async function getClassBaseCritDamage(classId) {
  if (!classId) return 150;
  const result = await db.query('SELECT base_crit_damage FROM classes WHERE id = $1', [classId]);
  return result.rows.length ? Number(result.rows[0].base_crit_damage) : 150;
}

// Suma XP a un jugador y, si junta lo suficiente para subir de nivel, recalcula sus stats desde
// classes + class_growths y lo cura del todo (HP/mana al nuevo maximo). La usan tanto el combate
// (al ganar una pelea) como las quests (al completarse) para que el nivel salga de un solo lugar.
async function applyXpGain(playerId, xpGained) {
  if (!xpGained) return null;

  const playerResult = await db.query('SELECT xp, level, current_class_id FROM players WHERE id = $1', [playerId]);
  if (!playerResult.rows.length) return null;
  const player = playerResult.rows[0];

  const classResult = await db.query(
    'SELECT base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd, base_crit_chance, base_mana, xp_rate FROM classes WHERE id = $1',
    [player.current_class_id]
  );
  if (!classResult.rows.length) return null;
  const classBase = classResult.rows[0];

  const newXp = Number(player.xp) + xpGained;
  const newLevel = levelForXp(newXp, Number(classBase.xp_rate));
  const leveledUp = newLevel > player.level;

  if (!leveledUp) {
    await db.query('UPDATE players SET xp = $1, updated_at = now() WHERE id = $2', [newXp, playerId]);
    return { newXp, newLevel: player.level, leveledUp: false };
  }

  const growthResult = await db.query(
    `SELECT level_from, level_to, hp_per_level, atk_per_level, def_per_level, mag_per_level,
            magic_def_per_level, spd_per_level, mana_per_level
     FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
    [player.current_class_id]
  );

  const stats = computeStatsAtLevel(classBase, growthResult.rows, newLevel);

  // computeStatsAtLevel solo conoce clase+nivel: hay que sumarle el bono de HP del equipo
  // actual (players.hp/max_hp lo incluyen, ver lib/equipment.js) o subir de nivel "resetearia"
  // el HP perdiendo el bono de la armadura puesta.
  const hpBonus = (await getEquipmentBonuses(playerId)).hp || 0;
  const newMaxHp = stats.hp + hpBonus;

  await db.query(
    `UPDATE players SET xp = $1, level = $2, hp = $3, max_hp = $3, mana = $4, max_mana = $4,
       atk = $5, def = $6, mag = $7, magic_def = $8, spd = $9, crit = $10, updated_at = now()
     WHERE id = $11`,
    [
      newXp, newLevel, newMaxHp, stats.mana, stats.atk, stats.def, stats.mag,
      stats.magicDef, stats.spd, stats.crit, playerId,
    ]
  );

  return { newXp, newLevel, leveledUp: true, stats };
}

// Igual que applyXpGain pero para NPCs contratados (tabla player_npcs).
// Se llama desde finalizeSession al repartir el XP de combate entre los miembros del grupo.
async function applyNpcXpGain(npcId, xpGained) {
  if (!xpGained) return null;

  const npcResult = await db.query(
    'SELECT xp, level, class_id FROM player_npcs WHERE id = $1',
    [npcId]
  );
  if (!npcResult.rows.length) return null;
  const npc = npcResult.rows[0];

  const classResult = await db.query(
    'SELECT base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd, base_crit_chance, base_mana, xp_rate FROM classes WHERE id = $1',
    [npc.class_id]
  );
  if (!classResult.rows.length) return null;
  const classBase = classResult.rows[0];

  const newXp = Number(npc.xp) + xpGained;
  const newLevel = levelForXp(newXp, Number(classBase.xp_rate));
  const leveledUp = newLevel > npc.level;

  if (!leveledUp) {
    await db.query('UPDATE player_npcs SET xp = $1 WHERE id = $2', [newXp, npcId]);
    return { newXp, newLevel: npc.level, leveledUp: false };
  }

  const growthResult = await db.query(
    `SELECT level_from, level_to, hp_per_level, atk_per_level, def_per_level, mag_per_level,
            magic_def_per_level, spd_per_level, mana_per_level
     FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
    [npc.class_id]
  );

  const stats = computeStatsAtLevel(classBase, growthResult.rows, newLevel);
  // Mismo patron que applyXpGain: incluir el bono de HP del equipo actual del NPC.
  const { getNpcEquipmentBonuses } = require('./equipment');
  const hpBonus = (await getNpcEquipmentBonuses(npcId)).hp || 0;
  const newMaxHp = stats.hp + hpBonus;

  await db.query(
    `UPDATE player_npcs SET xp = $1, level = $2, hp = $3, max_hp = $3,
       mana = $4, max_mana = $4, atk = $5, def = $6, mag = $7,
       magic_def = $8, spd = $9, crit = $10
     WHERE id = $11`,
    [newXp, newLevel, newMaxHp, stats.mana, stats.atk, stats.def,
     stats.mag, stats.magicDef, stats.spd, stats.crit, npcId]
  );

  return { newXp, newLevel, leveledUp: true };
}

// Recalcula todas las stats de un jugador para que coincidan con su nivel actual en la DB.
// Útil cuando el nivel se modificó directamente por SQL sin pasar por applyXpGain.
// Ajusta también el XP al mínimo del nivel actual para que no haya desincronía.
async function syncPlayerLevel(playerId) {
  const playerResult = await db.query(
    'SELECT id, level, xp, current_class_id, hp, max_hp FROM players WHERE id = $1',
    [playerId]
  );
  if (!playerResult.rows.length) return null;
  const player = playerResult.rows[0];

  const classResult = await db.query(
    `SELECT base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd,
            base_crit_chance, base_mana, xp_rate FROM classes WHERE id = $1`,
    [player.current_class_id]
  );
  if (!classResult.rows.length) return null;
  const classBase = classResult.rows[0];

  const growthResult = await db.query(
    `SELECT level_from, level_to, hp_per_level, atk_per_level, def_per_level, mag_per_level,
            magic_def_per_level, spd_per_level, mana_per_level
     FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
    [player.current_class_id]
  );

  const stats = computeStatsAtLevel(classBase, growthResult.rows, player.level);
  const hpBonus = (await getEquipmentBonuses(playerId)).hp || 0;
  const newMaxHp = stats.hp + hpBonus;
  const newHp = Math.min(Number(player.hp), newMaxHp);

  // Ajustar XP al mínimo del nivel actual para que applyXpGain calcule bien en el futuro.
  const minXpForLevel = xpThreshold(player.level, Number(classBase.xp_rate));
  const newXp = Math.max(Number(player.xp), minXpForLevel);

  await db.query(
    `UPDATE players SET xp = $1, hp = $2, max_hp = $3, mana = $4, max_mana = $4,
       atk = $5, def = $6, mag = $7, magic_def = $8, spd = $9, crit = $10, updated_at = now()
     WHERE id = $11`,
    [newXp, newHp, newMaxHp, stats.mana, stats.atk, stats.def, stats.mag,
     stats.magicDef, stats.spd, stats.crit, playerId]
  );

  return { level: player.level, stats, newMaxHp, newXp };
}

module.exports = { xpThreshold, levelForXp, computeStatsAtLevel, getClassBaseCritDamage, applyXpGain, applyNpcXpGain, syncPlayerLevel };
