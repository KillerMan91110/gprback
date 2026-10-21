// Armas y habilidades: una habilidad de flechas necesita un arco, una de dagas una daga, un tajo un arma de filo y un
// golpe de escudo un escudo (skills.arma_requerida, ver docs/armas_habilidades.md). El arma se reconoce por el nombre
// del objeto equipado (no hay un tipo de arma en la tabla items): «Arco de Pradera», «Gran Hacha de Leñador»…
const db = require('../db/db');

// los monjes pelean con los puños: su básico no se debilita sin arma
const CLASES_MONJE = new Set([6, 38, 39, 40, 41, 42]);
// el básico sin arma pega la mitad (se resta como porcentaje de bono de daño)
const BASICO_SIN_ARMA_PCT = -50;

const NECESITAS = {
  ARCO: 'un arco o una ballesta',
  DAGA: 'una daga',
  FILO: 'un arma de filo (espada, hacha o daga)',
  ESCUDO: 'un escudo',
  ARMA: 'un arma',
};
// el nombre corto para el libro de habilidades («Requiere: Arco»)
const NOMBRE = { ARCO: 'Arco o ballesta', DAGA: 'Daga', FILO: 'Arma de filo', ESCUDO: 'Escudo', ARMA: 'Un arma' };

// qué cuenta cada objeto equipado: un set con ARMA, ARCO, DAGA, FILO, ESCUDO
function etiquetasDe(equipo) {
  const t = new Set();
  for (const { slot, name } of equipo) {
    const n = String(name ?? '');
    if (slot === 'WEAPON') {
      t.add('ARMA');
      if (/^(Arco|Ballesta)\b/i.test(n)) t.add('ARCO');
      if (/^(Daga|Estilete)\b/i.test(n)) { t.add('DAGA'); t.add('FILO'); }
      if (/^(Espada|Gran Espada|Gran Hacha|Hacha|Filo|Excálibur)\b/i.test(n)) t.add('FILO');
    } else if (slot === 'OFFHAND') {
      if (/^Escudo\b/i.test(n)) t.add('ESCUDO');
      if (/^Daga\b/i.test(n)) { t.add('DAGA'); t.add('FILO'); }
    }
  }
  return t;
}

async function armasDe(playerId) {
  const r = await db.query(
    `SELECT pe.slot, i.name FROM player_equipment pe JOIN items i ON i.id = pe.item_id
     WHERE pe.player_id = $1 AND pe.slot IN ('WEAPON', 'OFFHAND')`,
    [playerId]
  );
  return etiquetasDe(r.rows);
}

// la columna se agrega sola la primera vez: el back no se cae si se despliega antes del SQL (sin clasificar, no
// pide ningún arma hasta que se corra docs/armas_habilidades.md)
let columna = null;
const asegurarColumna = () => (columna ??= db.query('ALTER TABLE skills ADD COLUMN IF NOT EXISTS arma_requerida TEXT')
  .catch((err) => { columna = null; throw err; }));

const cumple = (requerida, etiquetas) => !requerida || etiquetas.has(requerida);

// null si puede; si no, el mensaje para el jugador
function motivo(skill, etiquetas) {
  if (cumple(skill.arma_requerida, etiquetas)) return null;
  return `Necesitas ${NECESITAS[skill.arma_requerida] ?? 'un arma'} para usar ${skill.name}.`;
}

// las habilidades aprendidas (activas) que quedarían sin poder usarse con este equipo
async function habilidadesSinArma(playerId, etiquetas) {
  await asegurarColumna();
  const r = await db.query(
    `SELECT DISTINCT s.name, s.arma_requerida FROM skills s
     JOIN players p ON p.id = $1
     WHERE s.arma_requerida IS NOT NULL AND NOT s.is_passive
       AND (EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = p.id AND ps.skill_id = s.id)
         OR (s.learn_method = 'LEVEL' AND s.learn_level <= p.level
           AND s.class_id IN (SELECT unnest($2::int[]))))`,
    [playerId, await cadenaDe(playerId)]
  );
  return r.rows.filter((s) => !cumple(s.arma_requerida, etiquetas)).map((s) => s.name);
}

async function cadenaDe(playerId) {
  const { getClassAncestorChain } = require('./evolution');
  const p = await db.query('SELECT COALESCE(evolution_class_id, current_class_id) AS c FROM players WHERE id = $1', [playerId]);
  return p.rows.length ? getClassAncestorChain(p.rows[0].c) : [];
}

module.exports = { asegurarColumna, CLASES_MONJE, BASICO_SIN_ARMA_PCT, NECESITAS, NOMBRE, etiquetasDe, armasDe, cumple, motivo, habilidadesSinArma };
