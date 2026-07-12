const db = require('../db/db');

const EQUIPMENT_STAT_FIELD = {
  ATK: 'atk',
  DEF: 'def',
  MAG: 'mag',
  MAGIC_DEF: 'magic_def',
  SPD: 'spd',
  CRIT_CHANCE: 'crit_chance',
  CRIT_DAMAGE: 'crit_damage',
  EVASION: 'evasion',
  HP: 'hp',
  LUCK: 'luck',
};

// Multiplicador de stats según el tier de calidad del item crafteado.
// tier 0 = base (no crafteado con suerte), tier 1-4 = rarity upgrade x1-x4.
const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];

async function getEquipmentBonuses(playerId) {
  const result = await db.query(
    `SELECT isb.stat_code, isb.amount, pe.enchant_level, pe.quality_tier
     FROM player_equipment pe
     JOIN item_stat_bonuses isb ON isb.item_id = pe.item_id
     WHERE pe.player_id = $1`,
    [playerId]
  );
  const bonuses = {};
  for (const row of result.rows) {
    const field = EQUIPMENT_STAT_FIELD[row.stat_code];
    if (!field) continue;
    const enchantMult = 1 + (row.enchant_level || 0) * 0.05;
    const qualityMult = QUALITY_TIER_MULTIPLIER[row.quality_tier || 0] ?? 1;
    bonuses[field] = (bonuses[field] || 0) + Math.round(Number(row.amount) * enchantMult * qualityMult);
  }
  return bonuses;
}

// players.hp/max_hp guardan el valor EFECTIVO (clase+nivel + bono de equipo ya incluido), a
// diferencia de atk/def/mag/etc que se recalculan al vuelo en cada lectura y nunca se persisten.
// HP necesita persistirse porque "hp actual" sobrevive entre peleas; por eso equip/unequip (los
// unicos lugares donde el bono de equipo cambia) son los unicos que deben tocar esta columna,
// aplicando el delta exacto: equipar +100 HP también cura +100 al toque, sacarse el item resta
// esos +100 tanto del maximo como del actual (clampeado a 0..nuevoMax). Antes de este fix,
// server.js y combat.js sumaban el bono de equipo ENCIMA del valor ya guardado en cada lectura,
// lo que lo iba duplicando en cada pelea y ocultaba un HP real en 0 hasta que te sacabas el item.
async function applyHpBonusDelta(playerId, delta) {
  if (!delta) return;

  const result = await db.query('SELECT hp, max_hp FROM players WHERE id = $1', [playerId]);
  if (!result.rows.length) return;
  const { hp, max_hp } = result.rows[0];

  const newMaxHp = Math.max(1, max_hp + delta);
  const newHp = Math.max(0, Math.min(newMaxHp, hp + delta));

  await db.query('UPDATE players SET hp = $1, max_hp = $2, updated_at = now() WHERE id = $3', [newHp, newMaxHp, playerId]);
}

async function getNpcEquipmentBonuses(npcId) {
  const result = await db.query(
    `SELECT isb.stat_code, isb.amount, ne.enchant_level, ne.quality_tier
     FROM npc_equipment ne
     JOIN item_stat_bonuses isb ON isb.item_id = ne.item_id
     WHERE ne.npc_id = $1`,
    [npcId]
  );
  const bonuses = {};
  for (const row of result.rows) {
    const field = EQUIPMENT_STAT_FIELD[row.stat_code];
    if (!field) continue;
    const enchantMult = 1 + (row.enchant_level || 0) * 0.05;
    const qualityMult = QUALITY_TIER_MULTIPLIER[row.quality_tier || 0] ?? 1;
    bonuses[field] = (bonuses[field] || 0) + Math.round(Number(row.amount) * enchantMult * qualityMult);
  }
  return bonuses;
}

async function applyNpcHpBonusDelta(npcId, delta) {
  if (!delta) return;
  const result = await db.query('SELECT hp, max_hp FROM player_npcs WHERE id = $1', [npcId]);
  if (!result.rows.length) return;
  const { hp, max_hp } = result.rows[0];
  const newMaxHp = Math.max(1, max_hp + delta);
  const newHp = Math.max(0, Math.min(newMaxHp, hp + delta));
  await db.query('UPDATE player_npcs SET hp = $1, max_hp = $2 WHERE id = $3', [newHp, newMaxHp, npcId]);
}

module.exports = {
  getEquipmentBonuses, applyHpBonusDelta,
  getNpcEquipmentBonuses, applyNpcHpBonusDelta,
  EQUIPMENT_STAT_FIELD, QUALITY_TIER_MULTIPLIER,
};
