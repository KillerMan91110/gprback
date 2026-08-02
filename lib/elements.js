const db = require('../db/db');
const { getActivePetBonuses } = require('./pets');

// Bono/resistencia elemental por clase o monstruo (ver schema.sql: class_element_resistances,
// monster_element_resistances, class_elemental_damage_bonus, monster_elemental_damage_bonus).
// Cada clase/monstruo tiene una fila COMPLETA por elemento (no son deltas sobre la clase base),
// asi que un jugador evolucionado usa solo la fila de su clase evolucionada, nunca la suma con
// la de su clase base (ver getPlayerElementalClassId).

// Rueda elemental: "fuerte contra" = ese elemento le hace MAS daño a un objetivo de elemento
// débil (la resistencia efectiva del objetivo baja), "débil contra" = le hace MENOS (resistencia
// efectiva sube). Simétrica por diseño -- WEAK_AGAINST no es una tabla aparte, se deriva mirando
// quién tiene a quién en su propio STRONG_AGAINST, así nunca puede quedar inconsistente entre sí.
// Solo se aplica contra el elemento FIJO de un monstruo (monsters.element_id) -- un jugador no
// tiene un único "tipo", tiene resistencia/daño por elemento, así que del lado jugador no hay
// contra qué comparar la rueda. Luz/Oscuridad se ganan y pierden mutuamente entre sí (par aparte,
// no forman parte de la rueda de 6); Cósmico es neutro contra todo (no aparece en ningún lado).
const WHEEL_STRONG_AGAINST = {
  FIRE: ['ICE', 'WIND'],
  ICE: ['WATER', 'EARTH', 'WIND'],
  LIGHTNING: ['WATER'],
  WIND: ['EARTH', 'WATER'],
  EARTH: ['LIGHTNING', 'FIRE'],
  WATER: ['FIRE', 'EARTH'],
  LIGHT: ['DARK'],
  DARK: ['LIGHT'],
};
const WHEEL_MODIFIER_PERCENT = 25;

// Cuánto ajustar la resistencia EFECTIVA de defenderCode contra un ataque de attackerCode.
// Negativo = el objetivo resiste menos (recibe más daño), positivo = resiste más (recibe menos).
function wheelResistanceDelta(attackerCode, defenderCode) {
  if (!attackerCode || !defenderCode || attackerCode === defenderCode) return 0;
  if (WHEEL_STRONG_AGAINST[attackerCode]?.includes(defenderCode)) return -WHEEL_MODIFIER_PERCENT;
  if (WHEEL_STRONG_AGAINST[defenderCode]?.includes(attackerCode)) return WHEEL_MODIFIER_PERCENT;
  return 0;
}

async function getClassElementalDamageBonus(classId, elementId) {
  if (!classId) return 0;
  const result = await db.query(
    'SELECT damage_bonus FROM class_elemental_damage_bonus WHERE class_id = $1 AND element_id = $2',
    [classId, elementId]
  );
  return result.rows.length ? Number(result.rows[0].damage_bonus) : 0;
}

async function getClassElementResistance(classId, elementId) {
  if (!classId) return 0;
  const result = await db.query(
    'SELECT resistance_percent FROM class_element_resistances WHERE class_id = $1 AND element_id = $2',
    [classId, elementId]
  );
  return result.rows.length ? Number(result.rows[0].resistance_percent) : 0;
}

async function getMonsterElementalDamageBonus(monsterCode, elementId) {
  const result = await db.query(
    `SELECT mb.damage_bonus FROM monster_elemental_damage_bonus mb
     JOIN monsters m ON m.id = mb.monster_id
     WHERE m.code = $1 AND mb.element_id = $2`,
    [monsterCode, elementId]
  );
  return result.rows.length ? Number(result.rows[0].damage_bonus) : 0;
}

async function getMonsterElementResistance(monsterCode, elementId, lapBonus = 0) {
  const result = await db.query(
    `SELECT m.element_id AS monster_element_id, mer.resistance_percent
     FROM monsters m
     LEFT JOIN monster_element_resistances mer ON mer.monster_id = m.id AND mer.element_id = $2
     WHERE m.code = $1`,
    [monsterCode, elementId]
  );
  if (!result.rows.length) return 0;
  const row = result.rows[0];
  let base = row.resistance_percent != null ? Number(row.resistance_percent) : 0;

  if (row.monster_element_id) {
    const codesResult = await db.query('SELECT id, code FROM elements WHERE id = ANY($1::int[])', [[elementId, row.monster_element_id]]);
    const codeById = Object.fromEntries(codesResult.rows.map((r) => [r.id, r.code]));
    base += wheelResistanceDelta(codeById[elementId], codeById[row.monster_element_id]);
  }

  if (lapBonus <= 0 || base <= 0) return base;
  return Math.min(50, base + lapBonus);
}

// Clase que representa la afinidad elemental ACTUAL del jugador: si ya evoluciono, su clase
// evolucionada reemplaza a la base (no se suman, ver comentario de arriba).
async function getPlayerElementalClassId(playerId) {
  const result = await db.query('SELECT current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId]);
  if (!result.rows.length) return null;
  return result.rows[0].evolution_class_id || result.rows[0].current_class_id;
}

async function getPlayerElementResistance(playerId, elementId) {
  const [classResist, petBonuses] = await Promise.all([
    getClassElementResistance(await getPlayerElementalClassId(playerId), elementId),
    getActivePetBonuses(playerId),
  ]);
  return classResist + petBonuses.elemental_resistance;
}

async function getElementIdByCode(code) {
  const res = await db.query('SELECT id FROM elements WHERE code = $1', [code]);
  return res.rows.length ? res.rows[0].id : null;
}

async function getElementCodeById(elementId) {
  const res = await db.query('SELECT code FROM elements WHERE id = $1', [elementId]);
  return res.rows.length ? res.rows[0].code : null;
}

module.exports = {
  getClassElementalDamageBonus,
  getClassElementResistance,
  getMonsterElementalDamageBonus,
  getMonsterElementResistance,
  getPlayerElementalClassId,
  getPlayerElementResistance,
  getElementIdByCode,
  getElementCodeById,
  wheelResistanceDelta,
  WHEEL_STRONG_AGAINST,
  WHEEL_MODIFIER_PERCENT,
};
