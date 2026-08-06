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

module.exports = router;
