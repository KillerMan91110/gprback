// routes/admin.js
// Panel de administración para editar las stats reales de combate de los monstruos, zona por
// zona -- pedido explícito del usuario para poder rebalancear sin pasar por mí cada vez (ver
// el nerf manual que le aplicamos al Titán de la Pradera esta sesión). Devuelve TANTO
// monsters.base_* como monster_level_scalings, porque el motor de combate (hydrateMonsters en
// routes/combat.js) usa monster_level_scalings interpolado por nivel si el monstruo tiene filas
// ahí, y solo cae a monsters.base_* como fallback si no tiene ninguna -- confirmado que ambas
// tablas pueden desincronizarse entre sí sin que nada lo avise, por eso el endpoint de listado
// marca cuál de las dos es la que realmente pesa en combate (usesScaling).
//
// NO sincroniza seed.sql solo -- eso lo hace Claude a mano cuando se le pregunta por el estado
// de una zona, comparando esto contra seed.sql y aplicando el mismo patrón ya usado con el
// Titán. Automatizar ese diff quedó fuera de este alcance (ver conversación).
const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { requireAuth } = require('../lib/auth');
const { computeStatsAtLevel } = require('../lib/leveling');

// Cuentas con permiso de admin -- juego de un solo desarrollador (Marco, id 1), pero
// configurable por env sin tener que tocar código si alguna vez hace falta sumar otra.
const ADMIN_PLAYER_IDS = (process.env.ADMIN_PLAYER_IDS || '1').split(',').map(Number);

function requireAdmin(req, res, next) {
  if (!ADMIN_PLAYER_IDS.includes(Number(req.playerId))) {
    return res.status(403).json({ error: 'No tenés permiso de administrador' });
  }
  next();
}

router.use(requireAuth);
router.use(requireAdmin);

const BASE_STAT_COLUMNS = {
  hp: 'base_hp', atk: 'base_atk', def: 'base_def', magicAtk: 'base_magic_atk',
  magicDef: 'base_magic_def', spd: 'base_spd', evasion: 'base_evasion',
  critChance: 'base_crit_chance', critDamage: 'base_crit_damage',
};
const SCALING_STAT_COLUMNS = {
  hp: 'hp', atk: 'atk', def: 'def', magicAtk: 'magic_atk', magicDef: 'magic_def',
  spd: 'spd', evasion: 'evasion', critChance: 'crit_chance', critDamage: 'crit_damage',
  elementalDamage: 'elemental_damage',
};

function mapBaseRow(m) {
  return {
    hp: m.base_hp, atk: m.base_atk, def: m.base_def, magicAtk: m.base_magic_atk,
    magicDef: m.base_magic_def, spd: m.base_spd, evasion: Number(m.base_evasion),
    critChance: Number(m.base_crit_chance), critDamage: Number(m.base_crit_damage),
  };
}
function mapScalingRow(s) {
  return {
    level: s.level, hp: s.hp, atk: s.atk, def: s.def, magicAtk: s.magic_atk,
    magicDef: s.magic_def, spd: s.spd, evasion: Number(s.evasion),
    critChance: Number(s.crit_chance), critDamage: Number(s.crit_damage),
    elementalDamage: Number(s.elemental_damage),
  };
}

// GET /api/admin/monsters?zoneId= -- todas las zonas (para armar el filtro/navegación) + todos
// los monstruos con sus stats reales. Sin zoneId devuelve todo (no son tantas filas).
router.get('/monsters', async (req, res, next) => {
  try {
    const zones = (await db.query(
      `SELECT id, name, min_level, max_level, is_tower_zone FROM monster_zones ORDER BY min_level`
    )).rows;

    const { zoneId } = req.query;
    const monstersRes = await db.query(
      `SELECT m.*, z.name AS zone_name FROM monsters m
       JOIN monster_zones z ON z.id = m.zone_id
       ${zoneId ? 'WHERE m.zone_id = $1' : ''}
       ORDER BY z.min_level, m.base_level, m.name`,
      zoneId ? [zoneId] : []
    );

    const monsterIds = monstersRes.rows.map((m) => m.id);
    const scalingsRes = monsterIds.length
      ? await db.query(
          `SELECT * FROM monster_level_scalings WHERE monster_id = ANY($1::int[]) ORDER BY monster_id, level`,
          [monsterIds]
        )
      : { rows: [] };
    const scalingsByMonster = new Map();
    for (const s of scalingsRes.rows) {
      if (!scalingsByMonster.has(s.monster_id)) scalingsByMonster.set(s.monster_id, []);
      scalingsByMonster.get(s.monster_id).push(mapScalingRow(s));
    }

    res.json({
      zones: zones.map((z) => ({
        id: z.id, name: z.name, minLevel: z.min_level, maxLevel: z.max_level, isTowerZone: z.is_tower_zone,
      })),
      monsters: monstersRes.rows.map((m) => {
        const scalings = scalingsByMonster.get(m.id) || [];
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          zoneId: m.zone_id,
          zoneName: m.zone_name,
          rarity: m.rarity,
          baseLevel: m.base_level,
          minSpawnLevel: m.min_spawn_level,
          maxSpawnLevel: m.max_spawn_level,
          base: mapBaseRow(m),
          // Si tiene filas de scaling, ESAS son las que de verdad se usan en combate (ver
          // hydrateMonsters) -- base queda como referencia/fallback nomás.
          usesScaling: scalings.length > 0,
          scalings,
        };
      }),
    });
  } catch (error) { next(error); }
});

// GET /api/admin/monsters/:id -- detalle de un solo monstruo (mismo shape que un item de arriba).
router.get('/monsters/:id', async (req, res, next) => {
  try {
    const m = (await db.query(
      `SELECT m.*, z.name AS zone_name FROM monsters m JOIN monster_zones z ON z.id = m.zone_id WHERE m.id = $1`,
      [req.params.id]
    )).rows[0];
    if (!m) return res.status(404).json({ error: 'Monstruo no encontrado' });

    const scalings = (await db.query(
      `SELECT * FROM monster_level_scalings WHERE monster_id = $1 ORDER BY level`, [m.id]
    )).rows.map(mapScalingRow);

    res.json({
      id: m.id, code: m.code, name: m.name, zoneId: m.zone_id, zoneName: m.zone_name,
      rarity: m.rarity, baseLevel: m.base_level, minSpawnLevel: m.min_spawn_level,
      maxSpawnLevel: m.max_spawn_level, base: mapBaseRow(m), usesScaling: scalings.length > 0, scalings,
    });
  } catch (error) { next(error); }
});

// PATCH /api/admin/monsters/:id/base -- body: subset de BASE_STAT_COLUMNS (keys en camelCase).
// Ojo: si el monstruo YA tiene filas en monster_level_scalings para su rango de spawn, tocar
// esto no cambia nada en combate real -- lo devuelve el response (usesScaling) para que el
// front pueda avisarlo.
router.patch('/monsters/:id/base', async (req, res, next) => {
  try {
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(BASE_STAT_COLUMNS)) {
      if (req.body[key] === undefined) continue;
      params.push(req.body[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(req.params.id);
    const result = await db.query(
      `UPDATE monsters SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Monstruo no encontrado' });

    const scalingCount = (await db.query(
      `SELECT COUNT(*) FROM monster_level_scalings WHERE monster_id = $1`, [req.params.id]
    )).rows[0].count;

    res.json({ base: mapBaseRow(result.rows[0]), usesScaling: Number(scalingCount) > 0 });
  } catch (error) { next(error); }
});

// PUT /api/admin/monsters/:id/scalings/:level -- upsert de la fila de ESE nivel puntual. Body:
// subset de SCALING_STAT_COLUMNS. Si el nivel no existía, lo crea (hace falta al menos un valor
// para las columnas NOT NULL sin default explícito en el body -- todas tienen DEFAULT 0 en el
// schema, así que un create parcial es válido, solo quedan en 0 las que no se mandaron).
router.put('/monsters/:id/scalings/:level', async (req, res, next) => {
  try {
    const monsterId = Number(req.params.id);
    const level = Number(req.params.level);
    if (!Number.isInteger(level) || level < 1) {
      return res.status(400).json({ error: 'level inválido' });
    }

    const monsterExists = (await db.query('SELECT 1 FROM monsters WHERE id = $1', [monsterId])).rows.length;
    if (!monsterExists) return res.status(404).json({ error: 'Monstruo no encontrado' });

    const columns = ['monster_id', 'level'];
    const values = [monsterId, level];
    const updateSets = [];
    for (const [key, column] of Object.entries(SCALING_STAT_COLUMNS)) {
      if (req.body[key] === undefined) continue;
      columns.push(column);
      values.push(req.body[key]);
      updateSets.push(`${column} = EXCLUDED.${column}`);
    }
    if (!updateSets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    const placeholders = values.map((_, i) => `$${i + 1}`);
    const result = await db.query(
      `INSERT INTO monster_level_scalings(${columns.join(', ')})
       VALUES (${placeholders.join(', ')})
       ON CONFLICT (monster_id, level) DO UPDATE SET ${updateSets.join(', ')}
       RETURNING *`,
      values
    );
    res.json(mapScalingRow(result.rows[0]));
  } catch (error) { next(error); }
});

// DELETE /api/admin/monsters/:id/scalings/:level -- saca ese nivel puntual (vuelve a caer al
// fallback de monsters.base_* si era el único nivel que tenía cargado).
router.delete('/monsters/:id/scalings/:level', async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM monster_level_scalings WHERE monster_id = $1 AND level = $2 RETURNING id`,
      [req.params.id, req.params.level]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No había una fila de ese nivel' });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// ---------- Panel de admin: equipo (items.item_type = 'EQUIPMENT') ----------
// Pedido explícito del usuario: poder editar cualquier ítem de equipo (arma/offhand/armadura/etc)
// sin pasar por mí -- clase/rareza/nivel requerido/dos manos/precio/etc, más sus bonos de stat.
// `class_id` puede apuntar a una evolución (evolves_to_class_id de class_evolutions), no solo a una
// de las 5 clases base -- no hay una tabla separada "evoluciones", cada evolución es OTRA fila de
// `classes`, encadenada por class_evolutions. Por eso el front arma 2 dropdowns (clase raíz +
// evolución de esa rama) con `classes` y `evolutions` de este mismo GET, en vez de un solo select.
const ITEM_COLUMNS = {
  name: 'name', slot: 'slot', isTwoHanded: 'is_two_handed', rarity: 'rarity',
  classId: 'class_id', requiredLevel: 'required_level', isCraftable: 'is_craftable',
  obtainMethod: 'obtain_method', buyPrice: 'buy_price', description: 'description',
};

function mapItemRow(i) {
  return {
    id: i.id, code: i.code, name: i.name, slot: i.slot, isTwoHanded: i.is_two_handed,
    rarity: i.rarity, classId: i.class_id, className: i.class_name ?? undefined,
    requiredLevel: i.required_level, isCraftable: i.is_craftable,
    obtainMethod: i.obtain_method, buyPrice: i.buy_price, description: i.description,
  };
}
function mapStatBonusRow(b) {
  return {
    id: b.id, statCode: b.stat_code, amount: Number(b.amount), isPercent: b.is_percent,
    description: b.description, durationTurns: b.duration_turns,
  };
}

// GET /api/admin/items?slot=<opcional> -- sin slot devuelve TODO el equipo del juego (varios
// cientos de filas entre las 7 zonas), por eso el front navega filtrando por slot como filtro
// principal (no hay zone_id en items, a diferencia de monsters).
router.get('/items', async (req, res, next) => {
  try {
    const { slot } = req.query;
    const itemsRes = await db.query(
      `SELECT i.*, c.name AS class_name FROM items i LEFT JOIN classes c ON c.id = i.class_id
       WHERE i.item_type = 'EQUIPMENT' ${slot ? 'AND i.slot = $1' : ''}
       ORDER BY i.rarity, i.name`,
      slot ? [slot] : []
    );

    const itemIds = itemsRes.rows.map((i) => i.id);
    const bonusesRes = itemIds.length
      ? await db.query(`SELECT * FROM item_stat_bonuses WHERE item_id = ANY($1::int[]) ORDER BY id`, [itemIds])
      : { rows: [] };
    const bonusesByItem = new Map();
    for (const b of bonusesRes.rows) {
      if (!bonusesByItem.has(b.item_id)) bonusesByItem.set(b.item_id, []);
      bonusesByItem.get(b.item_id).push(mapStatBonusRow(b));
    }

    const classesRes = await db.query('SELECT id, code, name FROM classes ORDER BY id');
    const evolutionsRes = await db.query('SELECT class_id, evolves_to_class_id FROM class_evolutions');

    res.json({
      classes: classesRes.rows,
      evolutions: evolutionsRes.rows.map((e) => ({ classId: e.class_id, evolvesToClassId: e.evolves_to_class_id })),
      items: itemsRes.rows.map((i) => ({ ...mapItemRow(i), statBonuses: bonusesByItem.get(i.id) || [] })),
    });
  } catch (error) { next(error); }
});

// PATCH /api/admin/items/:id -- body: cualquier subconjunto de ITEM_COLUMNS (camelCase).
// Ojo: cambiar slot/isTwoHanded de un ítem que YA está equipado en player_equipment/npc_equipment
// no reacomoda esas filas (guardan su propio slot al momento de equipar) -- puede dejar equipo
// puesto bajo un slot que ya no coincide con items.slot. Uso consciente, sin guardas automáticas.
router.patch('/items/:id', async (req, res, next) => {
  try {
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(ITEM_COLUMNS)) {
      if (req.body[key] === undefined) continue;
      params.push(req.body[key]);
      sets.push(`${column} = $${params.length}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(req.params.id);
    const result = await db.query(
      `UPDATE items SET ${sets.join(', ')} WHERE id = $${params.length} AND item_type = 'EQUIPMENT' RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
    res.json(mapItemRow(result.rows[0]));
  } catch (error) { next(error); }
});

// POST /api/admin/items/:id/stat-bonuses -- crea un bono nuevo. body: { statCode, amount, isPercent?, durationTurns? }
// stat_code es TEXT libre (sin tabla de enum, mismo criterio que skill_effects) -- el admin escribe
// el código tal cual lo esperan el motor de combate/legendScheduler (ver STAT_WEIGHT ahí).
router.post('/items/:id/stat-bonuses', async (req, res, next) => {
  try {
    const { statCode, amount, isPercent = false, durationTurns = null } = req.body;
    if (!statCode || amount === undefined) return res.status(400).json({ error: 'statCode y amount son requeridos' });
    const result = await db.query(
      `INSERT INTO item_stat_bonuses(item_id, stat_code, amount, is_percent, duration_turns)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, statCode, amount, isPercent, durationTurns]
    );
    res.json(mapStatBonusRow(result.rows[0]));
  } catch (error) { next(error); }
});

// PUT /api/admin/items/:id/stat-bonuses/:bonusId -- edita un bono existente. body: subset de
// { statCode, amount, isPercent, durationTurns }.
router.put('/items/:id/stat-bonuses/:bonusId', async (req, res, next) => {
  try {
    const { statCode, amount, isPercent, durationTurns } = req.body;
    const sets = [];
    const params = [];
    if (statCode !== undefined) { params.push(statCode); sets.push(`stat_code = $${params.length}`); }
    if (amount !== undefined) { params.push(amount); sets.push(`amount = $${params.length}`); }
    if (isPercent !== undefined) { params.push(isPercent); sets.push(`is_percent = $${params.length}`); }
    if (durationTurns !== undefined) { params.push(durationTurns); sets.push(`duration_turns = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Nada para actualizar' });

    params.push(req.params.bonusId, req.params.id);
    const result = await db.query(
      `UPDATE item_stat_bonuses SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND item_id = $${params.length} RETURNING *`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Bono no encontrado' });
    res.json(mapStatBonusRow(result.rows[0]));
  } catch (error) { next(error); }
});

// DELETE /api/admin/items/:id/stat-bonuses/:bonusId
router.delete('/items/:id/stat-bonuses/:bonusId', async (req, res, next) => {
  try {
    const result = await db.query(
      `DELETE FROM item_stat_bonuses WHERE id = $1 AND item_id = $2 RETURNING id`,
      [req.params.bonusId, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Bono no encontrado' });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

// ---------- Panel de admin: visor de stats por clase base, nivel 1 a 100 ----------
// Pedido explícito del usuario: ver de un vistazo cómo escalan las 5 clases base (sin evolucionar)
// a lo largo de todos los niveles, para poder comparar/balancear. Reusa computeStatsAtLevel
// (lib/leveling.js), la misma función pura que ya usa el motor real al subir de nivel -- así el
// visor nunca se desincroniza de cómo se calculan las stats de verdad, no es una copia paralela de
// la fórmula. Cada class_id (base o evolución) tiene sus propias filas en class_growths cubriendo
// 1-100 de punta a punta (confirmado: no hay huecos que rellenar encadenando evoluciones acá).
// Evasión y daño crítico no tienen columna de crecimiento por nivel (quedan fijos en base_*), por
// eso van aparte en `class`, no repetidos en cada fila de `levels`.
const BASE_CLASS_IDS = [1, 2, 3, 4, 5]; // Guerrero, Mago, Arquero, Pícaro, Sacerdote

router.get('/class-stats', async (req, res, next) => {
  try {
    const classesRes = await db.query(
      'SELECT id, code, name FROM classes WHERE id = ANY($1::int[]) ORDER BY id', [BASE_CLASS_IDS]
    );

    const classId = Number(req.query.classId) || BASE_CLASS_IDS[0];
    if (!BASE_CLASS_IDS.includes(classId)) {
      return res.status(400).json({ error: 'classId debe ser una de las 5 clases base' });
    }

    const classRow = (await db.query(
      `SELECT id, name, base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd,
              base_mana, base_crit_chance, base_crit_damage, base_evasion
       FROM classes WHERE id = $1`,
      [classId]
    )).rows[0];
    const growthRows = (await db.query(
      `SELECT level_from, level_to, hp_per_level, atk_per_level, def_per_level, mag_per_level,
              magic_def_per_level, spd_per_level, mana_per_level
       FROM class_growths WHERE class_id = $1 ORDER BY level_from`,
      [classId]
    )).rows;

    const levels = [];
    for (let level = 1; level <= 100; level += 1) {
      levels.push({ level, ...computeStatsAtLevel(classRow, growthRows, level) });
    }

    res.json({
      classes: classesRes.rows,
      class: {
        id: classRow.id,
        name: classRow.name,
        baseEvasion: Number(classRow.base_evasion),
        baseCritDamage: Number(classRow.base_crit_damage),
      },
      levels,
    });
  } catch (error) { next(error); }
});

module.exports = router;
