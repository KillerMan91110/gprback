const db = require('../db/db');
const { getEquipmentBonuses } = require('./equipment');
const { computeStatsAtLevel } = require('./leveling');
const { getCounter, COUNTER_ALIASES, countMasteredElements, countSeenCodes } = require('./counters');

// Devuelve la cadena completa de clases de un jugador, de la base a la clase EFECTIVA actual,
// caminando class_evolutions hacia arriba (evolves_to_class_id -> class_id) las veces que haga
// falta. Necesario porque las evoluciones tienen hasta 3 niveles de profundidad (ej. Guerrero ->
// Monje -> Maestro Monje) pero players solo guarda 2 columnas (current_class_id, evolution_class_id
// = la clase MAS RECIENTE, se pisa en cada evolución) — un [current_class_id, evolution_class_id]
// se salta las pasivas de los niveles intermedios. effectiveClassId = evolution_class_id si ya
// evolucionó, sino current_class_id.
async function getClassAncestorChain(effectiveClassId) {
  const chain = [];
  let current = effectiveClassId;
  while (current) {
    chain.unshift(current);
    const parentRes = await db.query('SELECT class_id FROM class_evolutions WHERE evolves_to_class_id = $1', [current]);
    current = parentRes.rows[0]?.class_id || null;
  }
  return chain;
}

// Compara un valor calculado contra class_evolution_requirements.target_value. Solo existen estos
// 3 operadores en la data (ver db/seed.sql).
function compareValues(actual, comparison, target) {
  switch (comparison) {
    case '>':
      return actual > target;
    case '>=':
      return actual >= target;
    case '=':
      return actual === target;
    default:
      return false;
  }
}

// Stats "efectivos" (base + bono de equipo) que puede pedir un requisito STAT_THRESHOLD. El
// jugador no tiene columnas propias de evasion/crit_chance (a diferencia de las clases/monstruos):
// crit ya representa "probabilidad de critico" y evasion sale 100% del equipo.
async function getCheckableStats(playerId) {
  const playerResult = await db.query(
    'SELECT atk, def, mag, magic_def, spd, crit FROM players WHERE id = $1',
    [playerId]
  );
  if (!playerResult.rows.length) return null;
  const player = playerResult.rows[0];
  const bonus = await getEquipmentBonuses(playerId);

  return {
    ATK: player.atk + (bonus.atk || 0),
    DEF: player.def + (bonus.def || 0),
    MAG: player.mag + (bonus.mag || 0),
    MAGIC_DEF: player.magic_def + (bonus.magic_def || 0),
    SPD: player.spd + (bonus.spd || 0),
    CRIT_CHANCE: Number(player.crit) + (bonus.crit_chance || 0),
    EVASION: bonus.evasion || 0,
  };
}

// Evalua una fila de class_evolution_requirements.
async function checkRequirement(playerId, req) {
  switch (req.requirement_type) {
    case 'NO_WEAPON': {
      const equipped = await db.query(
        `SELECT 1 FROM player_equipment WHERE player_id = $1 AND slot = 'WEAPON'`,
        [playerId]
      );
      return { met: !equipped.rows.length, available: true };
    }

    case 'ITEM': {
      const owned = await db.query(
        `SELECT COALESCE(SUM(pi.quantity), 0) AS qty FROM player_inventory pi
         JOIN items i ON i.id = pi.item_id
         WHERE pi.player_id = $1 AND i.code = $2`,
        [playerId, req.item_code]
      );
      const qty = Number(owned.rows[0].qty);
      const target = req.target_value == null ? 1 : Number(req.target_value);
      return { met: compareValues(qty, req.comparison, target), available: true, current: qty, target };
    }

    // equipment_type matchea items.code, igual que ITEM pero contra lo EQUIPADO en vez del
    // inventario (ver routes/players.js GET /equipment para el join equivalente).
    case 'EQUIPMENT': {
      const equipped = await db.query(
        `SELECT 1 FROM player_equipment pe JOIN items i ON i.id = pe.item_id
         WHERE pe.player_id = $1 AND i.code = $2`,
        [playerId, req.equipment_type]
      );
      return { met: equipped.rows.length > 0, available: true };
    }

    case 'STAT_THRESHOLD': {
      if (req.target_value == null) return { met: false, available: true };
      const stats = await getCheckableStats(playerId);
      const actual = stats ? stats[req.stat_code] : undefined;
      if (actual === undefined) return { met: false, available: true };
      return { met: compareValues(actual, req.comparison, Number(req.target_value)), available: true };
    }

    case 'COUNTER': {
      if (req.counter_code === 'ELEMENTOS_DOMINADOS') {
        const mastered = await countMasteredElements(playerId);
        const target = Number(req.target_value);
        return { met: compareValues(mastered, req.comparison, target), available: true, current: mastered, target };
      }
      if (req.counter_code === 'CUROS_Y_ATAQUES') {
        const ataques = await getCounter(playerId, '_CURA_ATAQUE_ATAQUES');
        const curas = await getCounter(playerId, '_CURA_ATAQUE_CURAS');
        const value = Math.min(ataques, curas);
        const target = Number(req.target_value);
        return { met: compareValues(value, req.comparison, target), available: true, current: value, target };
      }
      if (req.counter_code === 'VENENOS_DOMINADOS') {
        const current = await countSeenCodes(playerId, 'VENENOS_DOMINADOS');
        const target = Number(req.target_value);
        return { met: compareValues(current, req.comparison, target), available: true, current, target };
      }
      const code = COUNTER_ALIASES[req.counter_code] || req.counter_code;
      const value = await getCounter(playerId, code);
      const target = Number(req.target_value);
      const elementMatch = /^KILLS_(FIRE|ICE|LIGHTNING|WATER|EARTH|WIND|LIGHT|DARK|COSMIC)$/.exec(code);
      return {
        met: compareValues(value, req.comparison, target),
        available: true,
        current: value,
        target,
        elementCode: elementMatch ? elementMatch[1] : null,
      };
    }

    default:
      return { met: false, available: false };
  }
}

// Lista las evoluciones posibles desde la clase EFECTIVA del jugador (evolution_class_id si ya
// evoluciono antes, sino current_class_id -- asi se encadenan evoluciones de tier 2 a tier 3,
// ej. Monje -> Maestro Monje -> Maestro Monje Supremo).
async function getAvailableEvolutions(playerId) {
  const playerResult = await db.query(
    'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
    [playerId]
  );
  if (!playerResult.rows.length) return null;
  const player = playerResult.rows[0];
  const effectiveClassId = player.evolution_class_id || player.current_class_id;

  const evolutionsResult = await db.query(
    `SELECT ce.id, ce.required_level, ce.description, c.id AS to_class_id, c.name AS to_class_name, c.role AS to_class_role
     FROM class_evolutions ce
     JOIN classes c ON c.id = ce.evolves_to_class_id
     WHERE ce.class_id = $1
     ORDER BY ce.id`,
    [effectiveClassId]
  );

  const evolutions = [];
  for (const evo of evolutionsResult.rows) {
    const reqsResult = await db.query(
      'SELECT * FROM class_evolution_requirements WHERE evolution_id = $1 ORDER BY id',
      [evo.id]
    );

    const requirements = [];
    for (const req of reqsResult.rows) {
      const checked = await checkRequirement(playerId, req);
      requirements.push({
        type: req.requirement_type,
        description: req.description,
        met: checked.met,
        available: checked.available,
        current: checked.current ?? null,
        target: checked.target ?? null,
        elementCode: checked.elementCode ?? null,
      });
    }

    const levelMet = player.level >= evo.required_level;
    const allAvailable = requirements.every((r) => r.available);
    const allMet = levelMet && requirements.every((r) => r.met);

    evolutions.push({
      evolutionId: evo.id,
      toClassId: evo.to_class_id,
      toClassName: evo.to_class_name,
      toClassRole: evo.to_class_role,
      description: evo.description,
      requiredLevel: evo.required_level,
      levelMet,
      requirements,
      available: allAvailable,
      canEvolve: allAvailable && allMet,
    });
  }

  return { effectiveClassId, level: player.level, evolutions };
}

// Ejecuta la evolucion: re-valida todo server-side (nunca confia en lo que ya mostro el GET) y,
// si pasa, pisa evolution_class_id y recalcula stats con la base+growth de la clase NUEVA al
// nivel actual del jugador (mismo mecanismo que lib/leveling.js usa al subir de nivel), sumando
// el bono de HP del equipo puesto. El nivel y el XP no se tocan: evolucionar cambia de clase, no
// de nivel.
async function evolvePlayer(playerId, evolutionId) {
  const playerResult = await db.query(
    'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
    [playerId]
  );
  if (!playerResult.rows.length) return { error: 'Jugador no encontrado', status: 404 };
  const player = playerResult.rows[0];
  const effectiveClassId = player.evolution_class_id || player.current_class_id;

  const evoResult = await db.query('SELECT * FROM class_evolutions WHERE id = $1', [evolutionId]);
  if (!evoResult.rows.length) return { error: 'Evolución no encontrada', status: 404 };
  const evo = evoResult.rows[0];

  if (evo.class_id !== effectiveClassId) {
    return { error: 'Esa evolución no corresponde a tu clase actual', status: 400 };
  }
  if (player.level < evo.required_level) {
    return { error: `Necesitas nivel ${evo.required_level} para evolucionar`, status: 400 };
  }

  const reqsResult = await db.query('SELECT * FROM class_evolution_requirements WHERE evolution_id = $1', [evolutionId]);
  for (const req of reqsResult.rows) {
    const checked = await checkRequirement(playerId, req);
    if (!checked.available) {
      return { error: `Ese requisito todavía no está disponible: ${req.description}`, status: 400 };
    }
    if (!checked.met) {
      return { error: `No cumples el requisito: ${req.description}`, status: 400 };
    }
  }

  const classResult = await db.query(
    'SELECT base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd, base_crit_chance, base_mana, xp_rate FROM classes WHERE id = $1',
    [evo.evolves_to_class_id]
  );
  const classBase = classResult.rows[0];

  const growthResult = await db.query(
    `SELECT level_from, level_to, hp_per_level, atk_per_level, def_per_level, mag_per_level,
            magic_def_per_level, spd_per_level, mana_per_level
     FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
    [evo.evolves_to_class_id]
  );

  const stats = computeStatsAtLevel(classBase, growthResult.rows, player.level);
  const hpBonus = (await getEquipmentBonuses(playerId)).hp || 0;
  const newMaxHp = stats.hp + hpBonus;

  await db.query(
    `UPDATE players SET evolution_class_id = $1, hp = $2, max_hp = $2, mana = $3, max_mana = $3,
       atk = $4, def = $5, mag = $6, magic_def = $7, spd = $8, crit = $9, updated_at = now()
     WHERE id = $10`,
    [
      evo.evolves_to_class_id, newMaxHp, stats.mana, stats.atk, stats.def, stats.mag,
      stats.magicDef, stats.spd, stats.crit, playerId,
    ]
  );

  return {
    evolutionClassId: evo.evolves_to_class_id,
    stats: { ...stats, hp: newMaxHp, maxHp: newMaxHp },
  };
}

module.exports = { getAvailableEvolutions, evolvePlayer, checkRequirement, getClassAncestorChain };
