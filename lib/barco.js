// La Gaviota Insolente: el barco de Rhaegar une el Puerto Antiguo (Costas Muertas) con el muelle de
// Fiordo Blanco (Tundra Eterna). Es un viaje entre zonas, como los botes de Marul o las balsas de Pumo,
// pero gratis: Rhaegar te lleva desde que terminaste la historia de las Costas (la C14, cuando el
// Encapuchado huye «al norte, hacia el hielo»). Rhaegar espera junto a su barco en los dos muelles.
const db = require('../db/db');
const { lejosDe } = require('./cercania');

// misión que abre el viaje (la última de las Costas)
const ABRE = 'COSTAS_Q3_BESTIA_PROFUNDIDADES';
// x, y: casilla donde te deja (locales de cada zona, junto al barco; art/mapas/generar_costas.js y
// generar_tundra.js). lugar: dónde tienes que estar para salir hacia el otro muelle.
const MUELLES = {
  fiordo: { zona: 'tundra', lugar: 'rhaegar_fiordo', nombre: 'el muelle de Fiordo Blanco', x: 146, y: 102 },
  puerto: { zona: 'costas', lugar: 'rhaegar_puerto', nombre: 'el muelle del Puerto Antiguo', x: 137, y: 44 },
};

async function viajar(playerId, destino) {
  const dest = MUELLES[destino];
  if (!dest) return { status: 400, error: 'Ese muelle no existe' };
  const desde = Object.values(MUELLES).find((m) => m !== dest);
  const lejos = lejosDe(playerId, [desde.lugar], 'Rhaegar, junto a La Gaviota Insolente');
  if (lejos) return { status: 403, error: lejos, lejos: true };
  const done = await db.query(
    `SELECT 1 FROM player_quest_completions pqc JOIN quests q ON q.id = pqc.quest_id WHERE pqc.player_id = $1 AND q.code = $2`,
    [playerId, ABRE]
  );
  if (!done.rows.length) return { status: 400, error: 'Rhaegar todavía no zarpa: primero hay que liberar a la Bestia de las Profundidades.' };
  return { ok: true, zona: dest.zona, x: dest.x * 32 + 16, y: dest.y * 32 + 16, nombre: dest.nombre };
}

module.exports = { MUELLES, ABRE, viajar };
