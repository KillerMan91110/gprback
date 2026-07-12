const db = require('../db/db');

// Bono/resistencia elemental por clase o monstruo (ver schema.sql: class_element_resistances,
// monster_element_resistances, class_elemental_damage_bonus, monster_elemental_damage_bonus).
// Cada clase/monstruo tiene una fila COMPLETA por elemento (no son deltas sobre la clase base),
// asi que un jugador evolucionado usa solo la fila de su clase evolucionada, nunca la suma con
// la de su clase base (ver getPlayerElementalClassId).

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

async function getMonsterElementResistance(monsterCode, elementId) {
  const result = await db.query(
    `SELECT mr.resistance_percent FROM monster_element_resistances mr
     JOIN monsters m ON m.id = mr.monster_id
     WHERE m.code = $1 AND mr.element_id = $2`,
    [monsterCode, elementId]
  );
  return result.rows.length ? Number(result.rows[0].resistance_percent) : 0;
}

// Clase que representa la afinidad elemental ACTUAL del jugador: si ya evoluciono, su clase
// evolucionada reemplaza a la base (no se suman, ver comentario de arriba).
async function getPlayerElementalClassId(playerId) {
  const result = await db.query('SELECT current_class_id, evolution_class_id FROM players WHERE id = $1', [playerId]);
  if (!result.rows.length) return null;
  return result.rows[0].evolution_class_id || result.rows[0].current_class_id;
}

async function getPlayerElementResistance(playerId, elementId) {
  return getClassElementResistance(await getPlayerElementalClassId(playerId), elementId);
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
};
