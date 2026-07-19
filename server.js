const express = require('express');
const cors = require('cors');
require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const db = require('./db/db');
const { getEquipmentBonuses } = require('./lib/equipment');
const { requireAuth, requireSelf } = require('./lib/auth');
const { xpThreshold, getClassBaseCritDamage, syncPlayerLevel } = require('./lib/leveling');
const { getRankProgress } = require('./lib/ranks');
const { getClassPassiveBonuses } = require('./lib/passives');
const authRouter = require('./routes/auth');
const itemsRouter = require('./routes/items');
const craftingRouter = require('./routes/crafting');
const questsRouter = require('./routes/quests');
const ranksRouter = require('./routes/ranks');
const playerRouter = require('./routes/players');
const combatRouter = require('./routes/combat');
const guildsRouter = require('./routes/guilds');
const socialRouter = require('./routes/social');
const coopRouter = require('./routes/coop');
const marketRouter = require('./routes/market');
const petsRouter = require('./routes/pets');
const towerRouter = require('./routes/tower');
const chatRouter = require('./routes/chat');
const { getActivePetBonuses } = require('./lib/pets');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// Autentica el socket con el mismo JWT que usa requireAuth (lib/auth.js).
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Falta el token de autenticación'));
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    socket.playerId = payload.playerId;
    next();
  } catch {
    next(new Error('Token inválido o expirado'));
  }
});

io.on('connection', (socket) => {
  socket.on('combat:join', (sessionId) => {
    if (sessionId) socket.join(`combat:${sessionId}`);
  });

  // channel: 'GENERAL' | 'TRADE' | 'GUILD:<guildId>' | 'COOP:<groupId>'
  socket.on('chat:join', async (channel) => {
    if (typeof channel !== 'string') return;
    try {
      if (channel.startsWith('GUILD:')) {
        const guildId = channel.slice('GUILD:'.length);
        const result = await db.query(
          'SELECT 1 FROM guild_members WHERE guild_id = $1 AND player_id = $2',
          [guildId, socket.playerId]
        );
        if (!result.rows.length) return;
      } else if (channel.startsWith('COOP:')) {
        const groupId = channel.slice('COOP:'.length);
        const result = await db.query(
          'SELECT 1 FROM player_coop_group_members WHERE group_id = $1 AND player_id = $2',
          [groupId, socket.playerId]
        );
        if (!result.rows.length) return;
      } else if (!['GENERAL', 'TRADE'].includes(channel)) {
        return;
      }
      socket.join(`chat:${channel}`);
    } catch (err) {
      console.error('chat:join error', err);
    }
  });
});

app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());

// ========== RUTAS REALES (auth, items, crafteo, quests, rangos, jugador, combate) ==========
app.use('/api/auth', authRouter);
app.use('/api/items', itemsRouter);
app.use('/api/crafting', craftingRouter);
app.use('/api/quests', questsRouter);
app.use('/api/ranks', ranksRouter);
app.use('/api/player', playerRouter);
app.use('/api/combat', combatRouter);
app.use('/api/guilds', guildsRouter);
app.use('/api/player/:playerId/friends', socialRouter);
app.use('/api/player/:playerId', socialRouter);
app.use('/api/player/:playerId/coop', coopRouter);
app.use('/api/player/:playerId/market', marketRouter);
app.use('/api/player/:playerId/pets', petsRouter);
app.use('/api/player/:playerId/tower', towerRouter);
app.use('/api/player/:playerId/chat', chatRouter);

// ========== RUTAS DE PRUEBA ==========

// 1. Ruta básica de prueba
app.get('/', (req, res) => {
  res.json({
    message: 'Backend RPG Disgaea - Servidor activo ✅',
    version: '1.0.0',
    status: 'running'
  });
});

// 2. Ruta de stats del jugador desde PostgreSQL
app.get('/api/player/:playerId/stats', requireAuth, requireSelf, async (req, res, next) => {
  const playerId = req.params.playerId;

  try {
    const result = await db.query(
      `SELECT p.id,
              p.nickname,
              p.level,
              p.xp,
              p.gold,
              p.rank,
              p.reputation,
              p.hp,
              p.max_hp,
              p.mana,
              p.max_mana,
              p.atk,
              p.def,
              p.mag,
              p.magic_def,
              p.spd,
              p.crit,
              c.base_evasion,
              p.current_class_id,
              c.name AS class_name,
              c.code AS class_code,
              c.role AS class_role,
              c.description AS class_description,
              c.xp_rate,
              p.evolution_class_id,
              ce.name AS evolution_class_name
       FROM players p
       LEFT JOIN classes c ON p.current_class_id = c.id
       LEFT JOIN class_evolutions e ON e.class_id = p.current_class_id AND e.evolves_to_class_id = p.evolution_class_id
       LEFT JOIN classes ce ON ce.id = p.evolution_class_id
       WHERE p.id = $1`,
      [playerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }

    const player = result.rows[0];
    // player.hp/max_hp ya incluyen el bono de equipo (lo aplican equip/unequip directamente,
    // ver lib/equipment.js applyHpBonusDelta), a diferencia de atk/def/mag/etc que si se
    // recalculan al vuelo aca porque nunca se persisten.
    const effectiveClassId = player.evolution_class_id || player.current_class_id;
    const [bonus, passives, baseCritDamage, resistancesResult, bonusesResult, petB] = await Promise.all([
      getEquipmentBonuses(player.id),
      getClassPassiveBonuses(effectiveClassId, player.level),
      getClassBaseCritDamage(effectiveClassId),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cer.resistance_percent
         FROM class_element_resistances cer
         JOIN elements e ON e.id = cer.element_id
         WHERE cer.class_id = $1
         ORDER BY e.id`,
        [effectiveClassId]
      ),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cedb.damage_bonus
         FROM class_elemental_damage_bonus cedb
         JOIN elements e ON e.id = cedb.element_id
         WHERE cedb.class_id = $1
         ORDER BY e.id`,
        [effectiveClassId]
      ),
      getActivePetBonuses(player.id),
    ]);

    const xpRate = Number(player.xp_rate || 1);
    const xpForCurrentLevel = xpThreshold(player.level, xpRate);
    const xpForNextLevel = xpThreshold(player.level + 1, xpRate);
    const rankProgress = await getRankProgress(Number(player.reputation));

    res.json({
      id: player.id,
      nickname: player.nickname,
      level: player.level,
      xp: player.xp,
      xpForNextLevel,
      xpIntoLevel: player.xp - xpForCurrentLevel,
      xpNeededForLevel: xpForNextLevel - xpForCurrentLevel,
      gold: player.gold,
      rank: player.rank,
      reputation: player.reputation,
      reputationForNextRank: rankProgress.reputationForNextRank,
      isMaxRank: rankProgress.isMaxRank,
      class: {
        id: player.current_class_id,
        name: player.class_name,
        code: player.class_code,
        role: player.class_role,
        description: player.class_description,
        portrait: `${player.class_name}.png`,
      },
      evolution: {
        id: player.evolution_class_id,
        name: player.evolution_class_name
      },
      hp: Math.min(player.hp, Math.round(player.max_hp * (1 + passives.hp / 100)) + petB.hp),
      maxHp: Math.round(player.max_hp * (1 + passives.hp / 100)) + petB.hp,
      mana: Math.min(player.mana, player.max_mana + petB.mana),
      maxMana: player.max_mana + petB.mana,
      atk: Math.round(player.atk * (1 + passives.atk / 100)) + (bonus.atk || 0) + petB.atk,
      def: Math.round(player.def * (1 + passives.def / 100)) + (bonus.def || 0) + petB.def,
      int: Math.round(player.mag * (1 + passives.mag / 100)) + (bonus.mag || 0) + petB.mag,
      magicDef: player.magic_def + (bonus.magic_def || 0) + petB.magic_def,
      spd: Math.round(player.spd * (1 + passives.spd / 100)) + (bonus.spd || 0) + petB.spd,
      crit: (Number(player.crit) + passives.crit_chance + (bonus.crit_chance || 0) + petB.crit_chance).toFixed(2),
      evasion: Number(player.base_evasion) + passives.evasion + (bonus.evasion || 0) + petB.evasion,
      critDamage: baseCritDamage + passives.crit_damage + (bonus.crit_damage || 0) + petB.crit_damage,
      magicDamageBonus: passives.magic_damage_bonus,
      uniqueSkill: passives.uniqueSkill,
      resistances: resistancesResult.rows.map((r) => ({
        element: r.element,
        elementCode: r.element_code,
        percent: Number(r.resistance_percent),
      })),
      elementalBonuses: bonusesResult.rows.map((r) => ({
        element: r.element,
        elementCode: r.element_code,
        bonus: Number(r.damage_bonus),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Rutas para clases y evoluciones
app.get('/api/classes', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, code, name, role, description, xp_rate,
              base_hp, base_atk, base_def, base_mag, base_magic_def,
              base_spd, base_evasion, base_crit_chance, base_crit_damage, base_mana
       FROM classes ORDER BY id`
    );
    res.json(result.rows.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      role: c.role,
      description: c.description,
      xpRate: Number(c.xp_rate),
      baseHp: c.base_hp,
      baseAtk: c.base_atk,
      baseDef: c.base_def,
      baseMag: c.base_mag,
      baseMagicDef: c.base_magic_def,
      baseSpd: c.base_spd,
      baseEvasion: Number(c.base_evasion),
      baseCritChance: Number(c.base_crit_chance),
      baseCritDamage: Number(c.base_crit_damage),
      baseMana: c.base_mana,
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/classes/:id/growth', async (req, res, next) => {
  const classId = req.params.id;

  try {
    const result = await db.query(
      `SELECT stage, level_from, level_to, hp_per_level, atk_per_level, def_per_level,
              mag_per_level, magic_def_per_level, spd_per_level, mana_per_level, bonus_description
       FROM class_growths
       WHERE class_id = $1
       ORDER BY level_from`,
      [classId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Crecimiento no encontrado para esta clase' });
    }

    res.json(result.rows.map((r) => ({
      stage: r.stage,
      levelFrom: r.level_from,
      levelTo: r.level_to,
      hpPerLevel: Number(r.hp_per_level),
      atkPerLevel: Number(r.atk_per_level),
      defPerLevel: Number(r.def_per_level),
      magPerLevel: Number(r.mag_per_level),
      magicDefPerLevel: Number(r.magic_def_per_level),
      spdPerLevel: Number(r.spd_per_level),
      manaPerLevel: Number(r.mana_per_level),
      bonusDescription: r.bonus_description,
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/classes/:id/evolutions', async (req, res, next) => {
  const classId = req.params.id;

  try {
    const result = await db.query(
      `SELECT ce.id, ce.evolves_to_class_id, c.name AS evolves_to_name, ce.required_level, ce.description,
              COALESCE(
                (SELECT json_agg(json_build_object(
                   'type', r.requirement_type,
                   'counterCode', r.counter_code,
                   'comparison', r.comparison,
                   'targetValue', r.target_value,
                   'itemCode', r.item_code,
                   'equipmentType', r.equipment_type,
                   'statCode', r.stat_code,
                   'description', r.description
                 ))
                 FROM class_evolution_requirements r
                 WHERE r.evolution_id = ce.id),
                '[]'
              ) AS requirements
       FROM class_evolutions ce
       LEFT JOIN classes c ON ce.evolves_to_class_id = c.id
       WHERE ce.class_id = $1`,
      [classId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Evoluciones no encontradas para esta clase' });
    }

    res.json(result.rows.map((r) => ({
      evolutionId: r.id,
      toClassId: r.evolves_to_class_id,
      toClassName: r.evolves_to_name,
      requiredLevel: r.required_level,
      description: r.description,
      requirements: r.requirements,
    })));
  } catch (error) {
    next(error);
  }
});

app.get('/api/classes/:id/elementals', async (req, res, next) => {
  const classId = req.params.id;
  try {
    const [resistancesResult, bonusesResult] = await Promise.all([
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cer.resistance_percent
         FROM class_element_resistances cer
         JOIN elements e ON e.id = cer.element_id
         WHERE cer.class_id = $1
         ORDER BY e.id`,
        [classId]
      ),
      db.query(
        `SELECT e.name AS element, e.code AS element_code, cedb.damage_bonus
         FROM class_elemental_damage_bonus cedb
         JOIN elements e ON e.id = cedb.element_id
         WHERE cedb.class_id = $1
         ORDER BY e.id`,
        [classId]
      ),
    ]);
    res.json({
      resistances: resistancesResult.rows.map((r) => ({
        element: r.element,
        elementCode: r.element_code,
        percent: Number(r.resistance_percent),
      })),
      elementalBonuses: bonusesResult.rows.map((r) => ({
        element: r.element,
        elementCode: r.element_code,
        bonus: Number(r.damage_bonus),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/leaderboard/guilds — Top 30 gremios por nivel. Público, sin auth.
app.get('/api/leaderboard/guilds', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT g.id, g.name, g.level, g.xp, g.type,
              COUNT(gm.player_id)::int AS member_count
       FROM guilds g
       LEFT JOIN guild_members gm ON gm.guild_id = g.id
       GROUP BY g.id
       ORDER BY g.level DESC, g.xp DESC
       LIMIT 30`
    );
    res.json(result.rows.map((r, i) => ({
      position: i + 1,
      id: r.id,
      name: r.name,
      level: r.level,
      type: r.type,
      memberCount: r.member_count,
    })));
  } catch (error) { next(error); }
});

// GET /api/leaderboard
// Top 30 jugadores por nivel (desempate: mayor XP). Público, sin auth.
app.get('/api/leaderboard', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT p.nickname, p.level, p.xp, c.name AS class_name, p.rank
       FROM players p
       JOIN classes c ON c.id = p.current_class_id
       ORDER BY p.level DESC, p.xp DESC
       LIMIT 30`
    );
    res.json(result.rows.map((r, i) => ({
      position: i + 1,
      nickname: r.nickname,
      level: r.level,
      className: r.class_name,
      rank: r.rank,
    })));
  } catch (error) {
    next(error);
  }
});

// GET /api/leaderboard/tower — ranking de la Torre Infinita, separado por modo. Solo cuenta
// una corrida si status='EXTRACTED' (si el grupo murió, no entra aunque hayan llegado lejos).
// El modo sale de cuántos guest_player_id tiene la corrida: 0=solo, 1=dúo, 2=trío.
app.get('/api/leaderboard/tower', async (req, res, next) => {
  try {
    async function fetchMode(whereExtra) {
      // participants_key agrupa por el mismo conjunto exacto de jugadores sin importar el
      // orden ni quién inició la corrida, así el mismo jugador/equipo no aparece 2 veces:
      // DISTINCT ON se queda con su mejor piso (el resto ya ordenado por piso desc primero).
      const result = await db.query(
        `SELECT current_floor, difficulty, ended_at, player_nickname, guest_nickname, guest2_nickname
         FROM (
           SELECT DISTINCT ON (pkey.participants_key)
                  ptr.current_floor, ptr.difficulty, ptr.ended_at,
                  p1.nickname AS player_nickname, p2.nickname AS guest_nickname, p3.nickname AS guest2_nickname
           FROM player_tower_runs ptr
           JOIN players p1 ON p1.id = ptr.player_id
           LEFT JOIN players p2 ON p2.id = ptr.guest_player_id
           LEFT JOIN players p3 ON p3.id = ptr.guest_player_id_2
           JOIN LATERAL (
             SELECT string_agg(x::text, ',' ORDER BY x) AS participants_key
             FROM unnest(ARRAY[ptr.player_id, ptr.guest_player_id, ptr.guest_player_id_2]) AS x
             WHERE x IS NOT NULL
           ) pkey ON true
           WHERE ptr.status = 'EXTRACTED' AND ${whereExtra}
           ORDER BY pkey.participants_key, ptr.current_floor DESC, ptr.ended_at ASC
         ) best
         ORDER BY current_floor DESC, ended_at ASC
         LIMIT 30`
      );
      return result.rows.map((r, i) => ({
        position: i + 1,
        floor: r.current_floor,
        difficulty: r.difficulty,
        members: [r.player_nickname, r.guest_nickname, r.guest2_nickname].filter(Boolean),
      }));
    }

    const [solo, duo, trio] = await Promise.all([
      fetchMode('ptr.guest_player_id IS NULL AND ptr.guest_player_id_2 IS NULL'),
      fetchMode('ptr.guest_player_id IS NOT NULL AND ptr.guest_player_id_2 IS NULL'),
      fetchMode('ptr.guest_player_id_2 IS NOT NULL'),
    ]);

    res.json({ solo, duo, trio });
  } catch (error) {
    next(error);
  }
});

// 4. Quests reales -> ver routes/quests.js (montado en /api/quests)
// 5. Inventario real -> ver routes/players.js (montado en /api/player/:playerId/inventory)

// 7. Ruta de zones
app.get('/api/zones', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT id, name, min_level, max_level, description
       FROM monster_zones
       ORDER BY min_level`
    );

    const zones = result.rows.map(zone => ({
      id: zone.id,
      name: zone.name,
      levelRange: `${zone.min_level}-${zone.max_level}`,
      description: zone.description,
      enemiesCount: 0
    }));

    res.json(zones);
  } catch (error) {
    next(error);
  }
});

app.get('/api/monsters', async (req, res, next) => {
  try {
    const { category } = req.query;
    const params = [];
    let where = '';
    if (category) { params.push(category); where = `WHERE m.category = $1`; }

    const result = await db.query(
      `SELECT m.id, m.code, m.name, m.base_level, m.rarity, m.category,
              m.base_hp, m.base_atk, m.base_def, m.base_magic_atk, m.base_magic_def,
              m.base_spd, m.base_evasion, m.base_crit_chance, m.base_crit_damage,
              m.xp_reward, m.gold_reward, m.description,
              mz.name AS zone_name, e.name AS element_name
       FROM monsters m
       LEFT JOIN monster_zones mz ON mz.id = m.zone_id
       LEFT JOIN elements e ON e.id = m.element_id
       ${where}
       ORDER BY m.base_level, m.name`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/zones/:zoneId/monsters - pool de monstruos de una zona para generar encuentros
// aleatorios en el front (excluye nada aca; el front decide si usa o no los LEGENDARY).
app.get('/api/zones/:zoneId/monsters', async (req, res, next) => {
  try {
    const { category } = req.query;
    const params = [req.params.zoneId];
    let extra = '';
    if (category) { params.push(category); extra = `AND m.category = $2`; }

    const result = await db.query(
      `SELECT m.id, m.code, m.name, m.rarity, m.category,
              m.base_level, m.min_spawn_level, m.max_spawn_level,
              m.base_hp, m.base_atk, m.base_def, m.base_magic_atk, m.base_magic_def, m.base_spd,
              m.base_evasion, m.base_crit_chance, m.base_crit_damage, m.xp_reward, m.gold_reward,
              m.description, e.name AS element_name
       FROM monsters m
       LEFT JOIN elements e ON e.id = m.element_id
       WHERE m.zone_id = $1 ${extra}
       ORDER BY m.rarity, m.base_level`,
      params
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// Probabilidad de rareza y de tamaño de grupo para un encuentro aleatorio (max 3 unidades
// enemigas). MINIBOSS y LEGENDARY siempre aparecen solos, como mini-jefe o jefe de zona.
const ENCOUNTER_RARITY_WEIGHTS = { COMMON: 65, RARE: 25, MINIBOSS: 8, LEGENDARY: 2 };
const ENCOUNTER_GROUP_SIZE_WEIGHTS = {
  COMMON: [{ size: 1, weight: 50 }, { size: 2, weight: 30 }, { size: 3, weight: 20 }],
  RARE: [{ size: 1, weight: 70 }, { size: 2, weight: 30 }],
  MINIBOSS: [{ size: 1, weight: 100 }],
  LEGENDARY: [{ size: 1, weight: 100 }],
};

// Un monstruo no aparece si su nivel mínimo ya supera al jugador por más de esto. No hay piso:
// monstruos de nivel menor al del jugador siempre pueden salir (de esa zona, según su rareza).
const ENCOUNTER_MAX_LEVEL_GAP = 4;

function weightedPick(entries, weightKey, valueKey) {
  const total = entries.reduce((sum, e) => sum + e[weightKey], 0);
  let roll = Math.random() * total;
  for (const entry of entries) {
    roll -= entry[weightKey];
    if (roll <= 0) return entry[valueKey];
  }
  return entries[entries.length - 1][valueKey];
}

function rollRarity() {
  const entries = Object.entries(ENCOUNTER_RARITY_WEIGHTS).map(([rarity, weight]) => ({ rarity, weight }));
  return weightedPick(entries, 'weight', 'rarity');
}

function rollGroupSize(rarity) {
  const options = ENCOUNTER_GROUP_SIZE_WEIGHTS[rarity] || ENCOUNTER_GROUP_SIZE_WEIGHTS.COMMON;
  return weightedPick(options, 'weight', 'size');
}

// GET /api/player/:playerId/zones/:zoneId/encounter - genera un encuentro aleatorio real
// (rareza ponderada + grupo de 1 a 3 monstruos). Cada miembro del grupo se rolea por separado
// (puede tocar un monstruo distinto y un nivel distinto dentro de su propio rango), no son
// copias del mismo. Los monstruos cuyo min_spawn_level supera al jugador por mas de
// ENCOUNTER_MAX_LEVEL_GAP quedan afuera del pool (los de nivel menor siempre entran). El
// resultado.monsters se pasa directo al body de POST /api/combat/sessions. El roll y el nivel
// del jugador se resuelven en el back para que el cliente no pueda elegir que monstruo le toca
// ni mentir su propio nivel.
app.get('/api/player/:playerId/zones/:zoneId/encounter', requireAuth, requireSelf, async (req, res, next) => {
  try {
    const playerResult = await db.query('SELECT level FROM players WHERE id = $1', [req.params.playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const playerLevel = playerResult.rows[0].level;
    const maxAllowedLevel = playerLevel + ENCOUNTER_MAX_LEVEL_GAP;

    let rarity = rollRarity();
    let pool = await db.query(
      `SELECT code, name, rarity, min_spawn_level, max_spawn_level
       FROM monsters WHERE zone_id = $1 AND rarity = $2 AND min_spawn_level <= $3`,
      [req.params.zoneId, rarity, maxAllowedLevel]
    );

    // Si la zona no tiene monstruos de esa rareza dentro del rango (zonas chicas, sin jefe, o
    // el jefe todavia le queda muy alto), caemos a COMMON.
    if (!pool.rows.length && rarity !== 'COMMON') {
      rarity = 'COMMON';
      pool = await db.query(
        `SELECT code, name, rarity, min_spawn_level, max_spawn_level
         FROM monsters WHERE zone_id = $1 AND rarity = $2 AND min_spawn_level <= $3`,
        [req.params.zoneId, rarity, maxAllowedLevel]
      );
    }

    // Si ni los comunes entran en el rango (zona muy por encima del jugador), ignoramos el
    // tope de nivel para no dejarlo sin encuentro.
    if (!pool.rows.length) {
      pool = await db.query(
        `SELECT code, name, rarity, min_spawn_level, max_spawn_level
         FROM monsters WHERE zone_id = $1 AND rarity = $2`,
        [req.params.zoneId, rarity]
      );
    }

    if (!pool.rows.length) {
      return res.status(404).json({ error: 'Esta zona no tiene monstruos cargados' });
    }

    const groupSize = rollGroupSize(rarity);
    const monsters = Array.from({ length: groupSize }, () => {
      const pick = pool.rows[Math.floor(Math.random() * pool.rows.length)];
      const upperLevel = Math.min(pick.max_spawn_level, maxAllowedLevel);
      const lowerLevel = Math.min(pick.min_spawn_level, upperLevel);
      const level = Math.floor(Math.random() * (upperLevel - lowerLevel + 1)) + lowerLevel;
      return { code: pick.code, name: pick.name, level };
    });

    res.json({
      zoneId: Number(req.params.zoneId),
      playerLevel,
      rarity,
      groupSize,
      monsters,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/zones/monsters - bestiario completo: todas las zonas con todos sus monstruos,
// la rareza de cada uno (= spawn rate, ver ENCOUNTER_RARITY_WEIGHTS), su rango de nivel
// random (min_spawn_level/max_spawn_level) y la tabla de drops con su drop rate. Pensado
// para que el front pinte el bestiario sin pedir zona por zona.
app.get('/api/zones/monsters', async (req, res, next) => {
  try {
    const zonesResult = await db.query(
      `SELECT id, name, min_level, max_level, description
       FROM monster_zones
       ORDER BY min_level`
    );

    const monstersResult = await db.query(
      `SELECT m.id, m.zone_id, m.code, m.name, m.rarity, m.base_level, m.min_spawn_level, m.max_spawn_level,
              m.base_hp, m.base_atk, m.base_def, m.base_magic_atk, m.base_magic_def, m.base_spd,
              m.base_evasion, m.base_crit_chance, m.base_crit_damage, m.xp_reward, m.gold_reward,
              m.description, e.name AS element_name
       FROM monsters m
       LEFT JOIN elements e ON e.id = m.element_id
       ORDER BY m.zone_id, m.rarity, m.base_level`
    );

    const dropsResult = await db.query(
      `SELECT md.monster_id, i.code AS item_code, i.name AS item_name, i.rarity AS item_rarity,
              md.drop_chance_percent, md.min_quantity, md.max_quantity
       FROM monster_drops md
       JOIN items i ON i.id = md.item_id
       ORDER BY md.drop_chance_percent DESC`
    );

    const dropsByMonster = new Map();
    for (const drop of dropsResult.rows) {
      if (!dropsByMonster.has(drop.monster_id)) dropsByMonster.set(drop.monster_id, []);
      dropsByMonster.get(drop.monster_id).push({
        itemCode: drop.item_code,
        itemName: drop.item_name,
        itemRarity: drop.item_rarity,
        dropChancePercent: Number(drop.drop_chance_percent),
        minQuantity: drop.min_quantity,
        maxQuantity: drop.max_quantity,
      });
    }

    const monstersByZone = new Map();
    for (const m of monstersResult.rows) {
      const entry = {
        id: m.id,
        code: m.code,
        name: m.name,
        rarity: m.rarity,
        spawnRatePercent: ENCOUNTER_RARITY_WEIGHTS[m.rarity] ?? null,
        elementName: m.element_name,
        levelRange: { min: m.min_spawn_level, max: m.max_spawn_level },
        baseLevel: m.base_level,
        stats: {
          hp: m.base_hp,
          atk: m.base_atk,
          def: m.base_def,
          magicAtk: m.base_magic_atk,
          magicDef: m.base_magic_def,
          spd: m.base_spd,
          evasion: Number(m.base_evasion),
          critChance: Number(m.base_crit_chance),
          critDamage: Number(m.base_crit_damage),
        },
        xpReward: m.xp_reward,
        goldReward: m.gold_reward,
        description: m.description,
        drops: dropsByMonster.get(m.id) || [],
      };
      if (!monstersByZone.has(m.zone_id)) monstersByZone.set(m.zone_id, []);
      monstersByZone.get(m.zone_id).push(entry);
    }

    const zones = zonesResult.rows.map((zone) => ({
      id: zone.id,
      name: zone.name,
      levelRange: { min: zone.min_level, max: zone.max_level },
      description: zone.description,
      monsters: monstersByZone.get(zone.id) || [],
    }));

    res.json(zones);
  } catch (error) {
    next(error);
  }
});

// 8. Ruta de reputación (real: lee players.reputation/rank y la tabla ranks)
app.get('/api/player/:playerId/reputation', requireAuth, requireSelf, async (req, res, next) => {
  try {
    const playerResult = await db.query('SELECT reputation, rank FROM players WHERE id = $1', [req.params.playerId]);
    if (!playerResult.rows.length) {
      return res.status(404).json({ error: 'Jugador no encontrado' });
    }
    const player = playerResult.rows[0];

    const ranksResult = await db.query('SELECT * FROM ranks ORDER BY min_reputation');
    const ranks = ranksResult.rows;
    const currentIndex = ranks.findIndex((r) => r.code === player.rank);
    const current = ranks[currentIndex];
    const nextRank = ranks[currentIndex + 1] || null;

    res.json({
      rank: player.rank,
      points: Number(player.reputation),
      nextRank: nextRank ? nextRank.code : null,
      pointsToNextRank: nextRank ? Math.max(0, nextRank.min_reputation - player.reputation) : 0,
      bonuses: {
        xpBonus: `+${current.xp_bonus_percent}%`,
        moneyBonus: `+${current.reward_bonus_percent}%`,
        shopDiscount: `-${current.shop_discount_percent}%`,
        itemSlots: `+${current.extra_inventory_slots}`,
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/elements — listado de todos los elementos del juego
app.get('/api/elements', async (req, res, next) => {
  try {
    const result = await db.query('SELECT id, code, name FROM elements ORDER BY id');
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

// GET /api/players/search?nickname=xxx — busca jugadores por nickname (parcial, hasta 20 resultados)
app.get('/api/players/search', requireAuth, async (req, res, next) => {
  const { nickname } = req.query;
  if (!nickname || nickname.trim().length < 2) {
    return res.status(400).json({ error: 'nickname debe tener al menos 2 caracteres' });
  }
  try {
    const result = await db.query(
      `SELECT p.id, p.nickname, p.level, p.rank, c.name AS class_name,
              gm.guild_id,
              g.name AS guild_name
       FROM players p
       LEFT JOIN classes c ON c.id = p.current_class_id
       LEFT JOIN guild_members gm ON gm.player_id = p.id
       LEFT JOIN guilds g ON g.id = gm.guild_id
       WHERE p.nickname ILIKE $1
       ORDER BY p.level DESC
       LIMIT 20`,
      [`%${nickname.trim()}%`]
    );
    res.json(result.rows.map((r) => ({
      id: r.id,
      nickname: r.nickname,
      level: r.level,
      rank: r.rank,
      className: r.class_name,
      guildId: r.guild_id,
      guildName: r.guild_name,
    })));
  } catch (error) {
    next(error);
  }
});

// GET /api/player/:playerId/profile — perfil público de cualquier jugador (sin requireSelf)
app.get('/api/player/:playerId/profile', requireAuth, async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT p.id, p.nickname, p.level, p.rank, p.reputation, p.last_seen_at,
              c.name AS class_name, c.code AS class_code, c.role AS class_role,
              ce.name AS evolution_class_name,
              gm.role AS guild_role,
              g.id AS guild_id, g.name AS guild_name, g.level AS guild_level
       FROM players p
       LEFT JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       LEFT JOIN class_evolutions cev ON cev.class_id = p.current_class_id AND cev.evolves_to_class_id = p.evolution_class_id
       LEFT JOIN classes ce ON ce.id = p.evolution_class_id
       LEFT JOIN guild_members gm ON gm.player_id = p.id
       LEFT JOIN guilds g ON g.id = gm.guild_id
       WHERE p.id = $1`,
      [req.params.playerId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    const p = result.rows[0];
    res.json({
      id: p.id,
      nickname: p.nickname,
      level: p.level,
      rank: p.rank,
      reputation: p.reputation,
      lastSeenAt: p.last_seen_at,
      class: { name: p.class_name, code: p.class_code, role: p.class_role },
      evolutionClassName: p.evolution_class_name,
      guild: p.guild_id ? { id: p.guild_id, name: p.guild_name, level: p.guild_level, role: p.guild_role } : null,
    });
  } catch (error) {
    next(error);
  }
});

// 9. Rutas de gremios -> ver routes/guilds.js (montado en /api/guilds)

// POST /api/player/:playerId/admin/sync-level
// Recalcula las stats del jugador según su nivel actual en la DB (útil tras subir de nivel por SQL).
app.post('/api/player/:playerId/admin/sync-level', requireAuth, requireSelf, async (req, res, next) => {
  try {
    const playerId = Number(req.params.playerId);
    const result = await syncPlayerLevel(playerId);
    if (!result) return res.status(404).json({ error: 'Jugador no encontrado' });
    res.json({
      synced: true,
      level: result.level,
      newXp: result.newXp,
      stats: {
        maxHp: result.newMaxHp,
        mana: result.stats.mana,
        atk: result.stats.atk,
        def: result.stats.def,
        mag: result.stats.mag,
        magicDef: result.stats.magicDef,
        spd: result.stats.spd,
        crit: result.stats.crit,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ========== MANEJO DE ERRORES ==========

app.use((req, res) => {
  res.status(404).json({
    error: 'Ruta no encontrada',
    path: req.path,
    method: req.method
  });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: err.message
  });
});

// ========== INICIAR SERVIDOR ==========

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════╗
║   🎮 RPG DISGAEA - Backend Activo 🎮   ║
║   Servidor corriendo en:               ║
║   http://localhost:${PORT}              ║
║                                        ║
║   Endpoints disponibles:               ║
║   POST /api/auth/register              ║
║   POST /api/auth/login                 ║
║   GET  /api/player/:id/stats           ║
║   GET  /api/player/:id/inventory       ║
║   POST /api/player/:id/craft           ║
║   GET  /api/player/:id/quests/available║
║   POST /api/player/:id/quests/:q/complete║
║   GET  /api/items                      ║
║   GET  /api/crafting/recipes           ║
║   GET  /api/quests                     ║
║   GET  /api/ranks                      ║
║   POST /api/combat/sessions            ║
║   POST /api/combat/sessions/:id/action ║
║   GET  /api/zones                      ║
║   ... y más!                           ║
╚════════════════════════════════════════╝
  `);
});

module.exports = app;
