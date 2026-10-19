// Jefe mítico de zona (como las "S-rank Hunts" de FFXIV): cuando entre todos los jugadores cazan
// suficientes monstruos de una zona, al caer la noche aparece un jefe mítico en un lugar al azar.
// Se avisa a todo el mundo, tiene vida COMPARTIDA (cada intento es un combate normal contra un
// clon con la vida que le queda) y al morir reparte el botín según cuánto aportó cada uno.
const db = require('../db/db');
const leveling = require('./leveling');
const { monsterRow } = require('./equilibrio');
const { applyGuildXp } = require('./guilds');
const coleccion = require('./coleccion');

// Un jefe mítico por zona del continente. Cada uno trae su monstruo y su esbirro (con su curva de
// niveles), sus escondites, los rumores, los textos de sus fases y cuánto rinde su botín (goldMul /
// xpMul: lo que valen los monstruos de su zona comparado con la Pradera). Para sumar otra zona:
// agregarla aquí, con su arte en enemigos.json (gpr/art/sprites/enemigos/crear_miticos.lua).
// Solo un jefe mítico ronda Etheria a la vez; cada zona lleva su propia cuenta.
const MITICOS = {
  1: {
    zoneId: 1,
    zoneDir: 'pradera',
    zoneName: 'la Pradera Dorada',
    code: 'MITICO_AULLALUNA',
    name: 'Aullaluna, el Lobo Espectral',
    killsNeeded: Number(process.env.MITICO_KILLS || 150),
    maxHp: Number(process.env.MITICO_HP || 4000),
    minLevel: Number(process.env.MITICO_NIVEL || 5),
    minutes: 20,
    // casillas (de la zona) donde puede aparecer; el cliente lo acomoda en la casilla libre más cercana
    spots: [
      { name: 'el Círculo de Piedras', x: 73, y: 98 },
      { name: 'las Ruinas del Vigía', x: 25, y: 98 },
      { name: 'las Praderas del Este', x: 128, y: 55 },
      { name: 'la Colina del Molino', x: 102, y: 32 },
      { name: 'el Bosque de Robleviejo', x: 30, y: 22 },
    ],
    rumors: [
      'Dicen que los lobos de la Pradera aúllan distinto estas noches…',
      'Los granjeros juran haber visto una sombra pálida entre las espigas. ¡Algo grande ronda la Pradera de noche!',
    ],
    levels: [1, 15],
    goldMul: 1, xpMul: 1,
    monster: {
      category: 'ESPECTRO', element: null,
      description: 'Un lobo enorme hecho de luz de luna. Solo aparece de noche, cuando la Pradera se llena de sangre.',
      curve: { hp: 0.7, magic_def: 1.1, spd: 1.1, elemental_damage: 6 },
      skills: [['MONSTRUO_AULLIDO_MANADA', 20], ['MONSTRUO_MORDIDA_DESGARRADORA', 30]],
    },
    minion: {
      code: 'LOBO_ESPECTRAL', name: 'Lobo Espectral', plural: 'lobos espectrales', category: 'ESPECTRO', xp: 90, gold: 40,
      description: 'Un lobo de niebla que Aullaluna llama con su aullido. Cada uno que cae debilita a su señor.',
      // curva de lib/equilibrio.js: un común algo más débil pero rápido (se cazan muchos)
      curve: { hp: 0.85, atk: 0.9, spd: 1.2, evasion: 1 },
      skills: [['MONSTRUO_TOQUE_GELIDO', 20]],
    },
    texts: {
      p1News: '¡Aullaluna aulló a la luna! Lobos espectrales recorren la Pradera.',
      p1: '¡Aúlla a la luna! Lobos espectrales salen de la niebla. Cada uno que caces lo debilita.',
      p2News: '¡Aullaluna huyó herido dejando un rastro de luz! Los cazadores siguen sus huellas.',
      p2: 'Huyó herido y se escondió. Sigue sus huellas brillantes para encontrarlo.',
      p3News: '¡La luna se tiñe de rojo sobre Aullaluna! Está furioso… y su botín será mayor.',
      p3: '¡Luna roja! Pega más fuerte, pero su botín será mayor.',
      gone: 'Al amanecer, Aullaluna se desvaneció entre la niebla…',
    },
    telegraph: {
      charge: (a) => `${a} levanta el hocico hacia la luna y empieza a aullar… ¡Defiéndete en tu próximo turno!`,
      hit: (a, t, d) => `¡El aullido de ${a} estalla como un trueno de luz! ${t} recibe ${d} de daño.`,
      guard: (a, t, d) => `${t} se cubre del aullido de ${a}: solo ${d} de daño.`,
    },
  },
  2: {
    zoneId: 2,
    zoneDir: 'montanas',
    zoneName: 'las Montañas Grises',
    code: 'MITICO_TRUENOCUERNO',
    name: 'Truenocuerno, el Carnero de la Tormenta',
    killsNeeded: Number(process.env.MITICO_KILLS || 150),
    maxHp: Number(process.env.MITICO_HP_2 || 15000),
    minLevel: 18,
    minutes: 20,
    spots: [
      { name: 'el Pinar Nevado', x: 82, y: 18 },
      { name: 'el Lago Helado', x: 134, y: 19 },
      { name: 'los Acantilados del Trueno', x: 120, y: 61 },
      { name: 'la Garganta del Eco', x: 52, y: 95 },
      { name: 'el Paso de la Montaña', x: 40, y: 51 },
    ],
    rumors: [
      'Los pastores dicen que las cabras de la montaña miran al cielo y no comen…',
      'Halvar jura que un rayo cayó tres veces en el mismo lugar y se quedó ahí, bramando. ¡Algo grande ronda las Montañas!',
    ],
    levels: [16, 30],
    goldMul: 1.75, xpMul: 3.9,
    monster: {
      category: 'BESTIA', element: 'LIGHTNING',
      description: 'El carnero más viejo de la montaña. Dicen que el Rey Thorvald lo montaba y que aprendió a bramar como el trueno. Su lana es de nube y sus cuernos atraen los rayos.',
      curve: { hp: 0.7, def: 1.1, spd: 1.05, elemental_damage: 6 },
      skills: [['MONSTRUO_CORNADA', 30], ['MONSTRUO_DESCARGA', 20], ['MONSTRUO_ESCUDO_TORMENTA', 15]],
    },
    minion: {
      code: 'CABRA_TRONADORA', name: 'Cabra Tronadora', plural: 'cabras tronadoras', category: 'BESTIA', xp: 350, gold: 70,
      description: 'Una cabra montés cargada de tormenta que baja de las cumbres cuando Truenocuerno brama. Cada una que cae lo debilita.',
      curve: { hp: 0.85, atk: 0.9, spd: 1.2, evasion: 1 },
      skills: [['MONSTRUO_EMBESTIDA', 25], ['MONSTRUO_LANZAZO', 15]],
    },
    texts: {
      p1News: '¡Truenocuerno bramó y la tormenta le respondió! Cabras tronadoras bajan por las laderas.',
      p1: '¡Brama a la tormenta! Cabras tronadoras bajan de las cumbres. Cada una que caces lo debilita.',
      p2News: '¡Truenocuerno salió a la carrera entre los rayos! Los cazadores siguen sus huellas chamuscadas.',
      p2: 'Herido, salió corriendo entre los rayos. Sigue sus huellas chamuscadas para encontrarlo.',
      p3News: '¡El cielo de las Montañas se vuelve verde sobre Truenocuerno! Está furioso… y su botín será mayor.',
      p3: '¡Tormenta verde! Pega más fuerte, pero su botín será mayor.',
      gone: 'Al amanecer la tormenta se disipó, y Truenocuerno con ella…',
    },
    telegraph: {
      charge: (a) => `Los rayos se juntan entre los cuernos de ${a}: la tormenta va a estallar… ¡Defiéndete en tu próximo turno!`,
      hit: (a, t, d) => `¡${a} descarga la tormenta! Un rayo cae sobre ${t}: ${d} de daño.`,
      guard: (a, t, d) => `${t} aguanta el rayo de ${a} detrás de su guardia: solo ${d} de daño.`,
    },
  },
  3: {
    zoneId: 3,
    zoneDir: 'volcan',
    zoneName: 'el Volcán Rojo',
    code: 'MITICO_IGNIVORA',
    name: 'Ignivora, la Madre Salamandra',
    killsNeeded: Number(process.env.MITICO_KILLS || 150),
    maxHp: Number(process.env.MITICO_HP_3 || 25000),
    minLevel: 33,
    minutes: 20,
    spots: [
      { name: 'los Campos de Azufre', x: 25, y: 22 },
      { name: 'el Bosque Calcinado', x: 25, y: 65 },
      { name: 'los Ríos de Lava', x: 85, y: 64 },
      { name: 'la Cantera de Obsidiana', x: 140, y: 64 },
      { name: 'la Grieta Ardiente', x: 30, y: 103 },
    ],
    rumors: [
      'Las salamandras del Volcán se juntan de noche y miran hacia la lava, como esperando a alguien…',
      'Pumo jura que la lava se movió sola y tenía ojos. ¡Algo enorme ronda el Volcán en las noches de brasas!',
    ],
    levels: [31, 45],
    goldMul: 2.75, xpMul: 6.5,
    monster: {
      category: 'BESTIA', element: 'FIRE',
      description: 'La madre de todas las salamandras del Volcán. Vieja como la primera erupción, duerme en la lava y sale las noches de brasas a buscar a sus crías.',
      curve: { hp: 0.7, magic_atk: 1.1, magic_def: 1.1, elemental_damage: 8 },
      skills: [['MONSTRUO_ESCUPITAJO_IGNEO', 25], ['MONSTRUO_OLA_MAGMA', 20], ['MONSTRUO_REGENERACION', 10]],
    },
    minion: {
      code: 'CRIA_IGNIVORA', name: 'Cría de Ignivora', plural: 'crías de Ignivora', category: 'BESTIA', xp: 580, gold: 110,
      description: 'Una salamandra recién salida de la lava que corre a defender a su madre. Cada una que cae la debilita.',
      curve: { hp: 0.85, atk: 0.9, spd: 1.2, evasion: 1 },
      skills: [['MONSTRUO_MORDIDA_ARDIENTE', 25]],
    },
    texts: {
      p1News: '¡Ignivora chilló y la lava hirvió! Sus crías salen de las grietas.',
      p1: '¡Llama a sus crías! Salamandras de fuego salen de las grietas. Cada una que caces la debilita.',
      p2News: '¡Ignivora se hundió en la lava y salió en otro lado! Los cazadores siguen su rastro de brasas.',
      p2: 'Herida, se hundió en la lava y salió en otro lugar. Sigue su rastro de brasas para encontrarla.',
      p3News: '¡El Volcán entra en erupción alrededor de Ignivora! Está furiosa… y su botín será mayor.',
      p3: '¡Erupción! Pega más fuerte, pero su botín será mayor.',
      gone: 'Al amanecer, Ignivora volvió a hundirse en la lava…',
    },
    telegraph: {
      charge: (a) => `La lava hierve bajo las patas de ${a}: el suelo empieza a resquebrajarse… ¡Defiéndete en tu próximo turno!`,
      hit: (a, t, d) => `¡El suelo revienta en un géiser de magma bajo ${t}! ${d} de daño.`,
      guard: (a, t, d) => `${t} se aparta a tiempo del magma de ${a}: solo ${d} de daño.`,
    },
  },
  4: {
    zoneId: 4,
    zoneDir: 'costas',
    zoneName: 'las Costas Muertas',
    code: 'MITICO_REY_PINZAS',
    name: 'Rey Pinzas, el Ermitaño Colosal',
    killsNeeded: Number(process.env.MITICO_KILLS || 150),
    maxHp: Number(process.env.MITICO_HP_4 || 35000),
    minLevel: 48,
    minutes: 20,
    spots: [
      { name: 'la Playa de Ceniza Negra', x: 130, y: 15 },
      { name: 'el Delta de Vapor', x: 75, y: 25 },
      { name: 'el Manglar de los Susurros', x: 40, y: 60 },
      { name: 'las Rocas de las Sirenas', x: 62, y: 92 },
      { name: 'el Arrecife Blanco', x: 135, y: 80 },
      { name: 'el Cementerio de Barcos', x: 25, y: 100 },
    ],
    rumors: [
      'Los pescadores dicen que una isla se movió anoche frente a la Playa de Ceniza Negra… y que tenía patas.',
      'Marul jura que vio un barco hundido caminando por el fondo del mar. Doña Almeja dice que tomó mucho sol.',
    ],
    levels: [46, 60],
    goldMul: 3, xpMul: 7,
    monster: {
      category: 'ACUATICO', element: 'WATER',
      description: 'Un cangrejo ermitaño tan viejo y tan grande que usa de caparazón un barco hundido entero. Sale del mar las noches de marea alta a buscar un barco más grande.',
      curve: { hp: 0.7, def: 1.3, spd: 0.8, elemental_damage: 8 },
      skills: [['MONSTRUO_TENAZA', 30], ['MONSTRUO_CAPARAZON', 15], ['MONSTRUO_COLETAZO_OLA', 20]],
    },
    minion: {
      code: 'CANGREJO_ERMITANO', name: 'Cangrejo Ermitaño', plural: 'cangrejos ermitaños', category: 'ACUATICO', xp: 820, gold: 150,
      description: 'Un cangrejo que vive en una caracola y sigue al Rey Pinzas a todos lados. Cada uno que cae lo debilita.',
      curve: { hp: 0.85, def: 1.2, spd: 1.1 },
      skills: [['MONSTRUO_TENAZA', 25]],
    },
    texts: {
      p1News: '¡Rey Pinzas golpeó el agua con la tenaza! Sus cangrejos ermitaños salen de la arena.',
      p1: '¡Llama a los suyos! Cangrejos ermitaños salen de la arena. Cada uno que caces lo debilita.',
      p2News: '¡Rey Pinzas se hundió en el mar y salió en otra playa! Los cazadores siguen sus huellas en la arena.',
      p2: 'Herido, se hundió en el mar y salió en otro lugar. Sigue sus huellas en la arena para encontrarlo.',
      p3News: '¡Rey Pinzas levanta su barco y truena las tenazas! Está furioso… y su botín será mayor.',
      p3: '¡Furia del ermitaño! Pega más fuerte, pero su botín será mayor.',
      gone: 'Cuando bajó la marea, Rey Pinzas volvió al fondo del mar con su barco…',
    },
    telegraph: {
      charge: (a) => `${a} abre la tenaza gigante y la levanta sobre su barco… ¡Defiéndete en tu próximo turno!`,
      hit: (a, t, d) => `¡${a} cierra la tenaza sobre ${t}! ${d} de daño.`,
      guard: (a, t, d) => `${t} se cubre a tiempo de la tenaza de ${a}: solo ${d} de daño.`,
    },
  },
};
// Nivel del clon de cada intento (y de los esbirros): el de quien pelea, pero nunca por debajo del
// recomendado de la zona ni por encima de su máximo. Antes era siempre el tuyo: un nivel 1 contra
// Ignivora peleaba contra una salamandra de nivel 1 achicada (ataque 7) y sin penalización por
// diferencia de nivel. Ahora pelea contra una de nivel 33 que le pega de verdad.
const cloneLevel = (def, playerLevel) => Math.min(def.levels[1], Math.max(Number(playerLevel) || 1, def.minLevel));
// los esbirros de todas las zonas (solo existen mientras su jefe está suelto)
const MINION_CODES = new Set(Object.values(MITICOS).map((d) => d.minion.code));
const minionOf = (zoneId) => MITICOS[zoneId]?.minion ?? null;
const ATTEMPT_COOLDOWN_S = 30;
// Fases según la vida compartida: 1 = aúlla y llama a sus esbirros, 2 = huye a otro lugar,
// 3 = luna roja (pega más fuerte y suelta más botín)
const PHASES = [0.75, 0.5, 0.25];
// el de la Pradera (lo usaban todos antes de que hubiera un mítico por zona)
const MINION_CODE = MITICOS[1].minion.code;
// cada esbirro cazado le baja la defensa al jefe para todos (hasta un 40%) y cuenta como aporte
const MINION_DEF_DOWN = 0.02;
const MINION_DEF_DOWN_MAX = 0.4;
const MINION_CREDIT = 40;
const RED_MOON_ATK = 1.3;
const RED_MOON_LOOT = 1.25;
// escalado de cada monstruo mítico y de su esbirro, a lo largo de los niveles de su zona
const scalingsOf = (def, kind) => def.levels.map((lv) => (kind === 'boss'
  ? monsterRow(lv, 'LEGENDARY', def.monster.curve)
  : monsterRow(lv, 'COMMON', def.minion.curve)));
const MINION = { ...MITICOS[1].minion, scalings: scalingsOf(MITICOS[1], 'minion') };
// después de una cacería (muerto o ido) la zona descansa este rato antes de volver a contar
const REST_MINUTES = Number(process.env.MITICO_ESPERA ?? 60);
// clon por intento: jefe escalado al nivel de quien pelea (la vida de verdad es la compartida)
const MONSTER = { code: MITICOS[1].code, name: MITICOS[1].name, ...MITICOS[1].monster, scalings: scalingsOf(MITICOS[1], 'boss') };

// hora del juego: igual que el cliente (WorldScene.gameHour), un día de 24 minutos reales
const gameHour = () => (Date.now() / 60000) % 24;
// MITICO_NOCHE=1 solo para probar en local (siempre es de noche)
const isNight = () => { if (process.env.MITICO_NOCHE === '1') return true; const h = gameHour(); return h >= 21 || h < 5; };

let io = null;
let ready = null;
function ensureTables() {
  ready ??= (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS mythic_zone_progress (
        zone_id INTEGER PRIMARY KEY,
        kills   INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS mythic_hunts (
        id           SERIAL PRIMARY KEY,
        zone_id      INTEGER NOT NULL,
        monster_code TEXT NOT NULL,
        spot_name    TEXT NOT NULL,
        spot_x       INTEGER NOT NULL,
        spot_y       INTEGER NOT NULL,
        max_hp       INTEGER NOT NULL,
        hp_remaining INTEGER NOT NULL,
        status       TEXT NOT NULL DEFAULT 'ACTIVE',
        started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        ends_at      TIMESTAMPTZ NOT NULL,
        closed_at    TIMESTAMPTZ,
        killed_by    INTEGER REFERENCES players(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS mythic_hunt_damage (
        hunt_id         INTEGER NOT NULL REFERENCES mythic_hunts(id) ON DELETE CASCADE,
        player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        total_damage    INTEGER NOT NULL DEFAULT 0,
        last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (hunt_id, player_id)
      );
      ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS mythic_hunt_id INTEGER;
      ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS phase SMALLINT NOT NULL DEFAULT 0;
      ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS minion_kills INTEGER NOT NULL DEFAULT 0;
      -- una sola cacería activa a la vez aunque corran varios servidores (si dos intentan crearla
      -- en el mismo instante, el segundo choca con este índice y no hace nada)
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mythic_hunts_active ON mythic_hunts ((status)) WHERE status = 'ACTIVE';
      -- dónde fue cada combate del mundo 2D (casilla local de su zona) y cuánto se cazó cerca de
      -- cada escondite: el jefe aparece con más probabilidad donde más se ha cazado
      ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS world_zone TEXT;
      ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS world_x INTEGER;
      ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS world_y INTEGER;
      CREATE TABLE IF NOT EXISTS mythic_spot_kills (
        zone_id INTEGER NOT NULL,
        spot    SMALLINT NOT NULL,
        kills   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (zone_id, spot)
      );
      -- de dónde huyó (para las huellas que llevan a su nuevo escondite)
      ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS prev_x INTEGER;
      ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS prev_y INTEGER;`);
    // cada jefe mítico y su esbirro (sin zona: así nunca salen en un encuentro normal) con su escalado
    for (const def of Object.values(MITICOS)) await ensureMonsters(def);
  })().catch((err) => { ready = null; throw err; });
  return ready;
}

// el jefe mítico de una zona y su esbirro en la tabla de monstruos, con sus curvas de nivel. Las
// columnas base son las del nivel medio de la zona (las de verdad salen de monster_level_scalings).
async function ensureMonsters(def) {
  const mid = Math.round((def.levels[0] + def.levels[1]) / 2);
  const element = def.monster.element
    ? (await db.query('SELECT id FROM elements WHERE code = $1', [def.monster.element])).rows[0]?.id ?? null
    : null;
  const rows = [
    { code: def.code, name: def.name, rarity: 'LEGENDARY', m: def.monster, base: monsterRow(mid, 'LEGENDARY', def.monster.curve), xp: 0, gold: 0, element, scalings: scalingsOf(def, 'boss') },
    { code: def.minion.code, name: def.minion.name, rarity: 'RARE', m: def.minion, base: monsterRow(mid, 'COMMON', def.minion.curve), xp: def.minion.xp, gold: def.minion.gold, element: null, scalings: scalingsOf(def, 'minion') },
  ];
  for (const r of rows) {
    const b = r.base;
    const ins = await db.query(
      `INSERT INTO monsters (code, name, zone_id, rarity, base_level, min_spawn_level, max_spawn_level, base_hp, base_atk, base_def,
         base_magic_atk, base_magic_def, base_spd, base_evasion, base_crit_chance, base_crit_damage, xp_reward, gold_reward, description, category, element_id)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       RETURNING id`,
      [r.code, r.name, r.rarity, mid, def.levels[0], def.levels[1], b.hp, b.atk, b.def, b.magic_atk, b.magic_def, b.spd, b.evasion,
        b.crit_chance, b.crit_damage, r.xp, r.gold, r.m.description, r.m.category, r.element]
    );
    const id = ins.rows[0].id;
    // sus habilidades ([código, % de uso]); las que ya tenga no se tocan
    for (const [skill, pct] of r.m.skills ?? []) {
      await db.query(
        `INSERT INTO monster_skills (monster_id, skill_id, use_chance_percent)
         SELECT $1, s.id, $3 FROM skills s WHERE s.code = $2
           AND NOT EXISTS (SELECT 1 FROM monster_skills ms WHERE ms.monster_id = $1 AND ms.skill_id = s.id)`,
        [id, skill, pct]
      );
    }
    const has = await db.query('SELECT 1 FROM monster_level_scalings WHERE monster_id = $1 LIMIT 1', [id]);
    if (has.rows.length) continue;
    for (const s of r.scalings) {
      await db.query(
        `INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [id, s.level, s.hp, s.atk, s.def, s.magic_atk, s.magic_def, s.spd, s.evasion, s.crit_chance, s.crit_damage, s.elemental_damage]
      );
    }
  }
}

async function activeHunt() {
  await ensureTables();
  const r = await db.query("SELECT * FROM mythic_hunts WHERE status = 'ACTIVE' ORDER BY id DESC LIMIT 1");
  const h = r.rows[0];
  if (h && new Date(h.ends_at) <= new Date()) {
    await db.query("UPDATE mythic_hunts SET status = 'EXPIRED', closed_at = now() WHERE id = $1 AND status = 'ACTIVE'", [h.id]);
    await db.query('UPDATE mythic_zone_progress SET kills = 0 WHERE zone_id = $1', [h.zone_id]);
    const def = MITICOS[h.zone_id];
    addNews?.(def?.texts.gone ?? 'Al amanecer, el jefe mítico se desvaneció…');
    broadcast();
    return null;
  }
  return h ?? null;
}

async function publicState() {
  await ensureTables();
  const hunt = await activeHunt();
  const prog = await db.query('SELECT zone_id, kills FROM mythic_zone_progress');
  const kills = new Map(prog.rows.map((r) => [r.zone_id, r.kills]));
  const last = await db.query(
    `SELECT h.id, h.zone_id, h.status, h.closed_at, p.nickname AS killer FROM mythic_hunts h
     LEFT JOIN players p ON p.id = h.killed_by WHERE h.status <> 'ACTIVE' ORDER BY h.id DESC LIMIT 1`
  );
  return {
    night: isNight(),
    zones: Object.values(MITICOS).map((d) => ({
      zoneId: d.zoneId, zoneDir: d.zoneDir, name: d.name, code: d.code,
      kills: Math.min(kills.get(d.zoneId) ?? 0, d.killsNeeded), needed: d.killsNeeded,
    })),
    hunt: hunt && {
      id: hunt.id, zoneId: hunt.zone_id, zoneDir: MITICOS[hunt.zone_id]?.zoneDir, code: hunt.monster_code,
      name: MITICOS[hunt.zone_id]?.name, spot: hunt.spot_name, x: hunt.spot_x, y: hunt.spot_y,
      hp: hunt.hp_remaining, maxHp: hunt.max_hp, endsAt: hunt.ends_at, minLevel: MITICOS[hunt.zone_id]?.minLevel,
      phase: hunt.phase, minionKills: hunt.minion_kills, minionCode: minionOf(hunt.zone_id)?.code ?? MINION_CODE,
      minionName: minionOf(hunt.zone_id)?.name ?? null,
      from: hunt.prev_x != null ? { x: hunt.prev_x, y: hunt.prev_y } : null,
      defDown: Math.round(defDownOf(hunt) * 100), redMoon: hunt.phase >= 3,
    },
    last: last.rows[0] ? { status: last.rows[0].status, killer: last.rows[0].killer, at: last.rows[0].closed_at } : null,
  };
}

const defDownOf = (hunt) => Math.min(MINION_DEF_DOWN_MAX, (hunt?.minion_kills ?? 0) * MINION_DEF_DOWN);

// Vida que escala con los cazadores: con HUNTERS_FREE o menos tiene su vida base; cada cazador nuevo
// que lo ataca por primera vez le suma HP_PER_HUNTER de la base (sube también la que le queda), hasta
// HP_CAP_MULT veces la base. Así dura parecido con 3 o con 30 jugadores. Lo llama la ruta del
// intento (routes/coleccion.js) con los que entran; devuelve la cacería actualizada.
const HUNTERS_FREE = 3;
const HP_PER_HUNTER = 0.3;
const HP_CAP_MULT = 6;
async function joinHunters(hunt, playerIds) {
  const def = MITICOS[hunt.zone_id];
  if (!def) return hunt;
  const known = new Set((await db.query('SELECT player_id FROM mythic_hunt_damage WHERE hunt_id = $1', [hunt.id])).rows.map((r) => r.player_id));
  const fresh = playerIds.filter((pid) => !known.has(pid));
  if (!fresh.length) return hunt;
  for (const pid of fresh) {
    // sin tiempo de espera: todavía no intentó
    await db.query(
      `INSERT INTO mythic_hunt_damage (hunt_id, player_id, total_damage, last_attempt_at) VALUES ($1, $2, 0, now() - interval '1 hour')
       ON CONFLICT (hunt_id, player_id) DO NOTHING`,
      [hunt.id, pid]
    );
  }
  const hunters = known.size + fresh.length;
  const target = Math.min(def.maxHp * HP_CAP_MULT, Math.round(def.maxHp * (1 + HP_PER_HUNTER * Math.max(0, hunters - HUNTERS_FREE))));
  if (target <= hunt.max_hp) return hunt;
  const r = await db.query(
    "UPDATE mythic_hunts SET hp_remaining = hp_remaining + ($1 - max_hp), max_hp = $1 WHERE id = $2 AND status = 'ACTIVE' AND max_hp < $1 RETURNING *",
    [target, hunt.id]
  );
  await broadcast();
  return r.rows[0] ?? hunt;
}

// Al pasar cada umbral de vida: aullido + esbirros, huida a otro lugar, luna roja
async function advancePhase(huntId) {
  const h = (await db.query("SELECT * FROM mythic_hunts WHERE id = $1 AND status = 'ACTIVE'", [huntId])).rows[0];
  if (!h) return;
  const pct = h.hp_remaining / h.max_hp;
  const target = PHASES.filter((t) => pct <= t).length;
  if (target <= h.phase) return;
  const def = MITICOS[h.zone_id];
  for (let p = h.phase + 1; p <= target; p++) {
    if (p === 1) {
      addNews?.(def.texts.p1News);
      io?.emit('mythic:phase', { zoneDir: def.zoneDir, phase: 1, name: def.name, text: def.texts.p1 });
    } else if (p === 2) {
      const others = def.spots.filter((s) => s.name !== h.spot_name);
      const spot = others[Math.floor(Math.random() * others.length)] ?? def.spots[0];
      await db.query('UPDATE mythic_hunts SET spot_name = $1, spot_x = $2, spot_y = $3, prev_x = spot_x, prev_y = spot_y WHERE id = $4', [spot.name, spot.x, spot.y, h.id]);
      addNews?.(def.texts.p2News);
      io?.emit('mythic:phase', { zoneDir: def.zoneDir, phase: 2, name: def.name, text: def.texts.p2 });
    } else if (p === 3) {
      addNews?.(def.texts.p3News);
      io?.emit('mythic:phase', { zoneDir: def.zoneDir, phase: 3, name: def.name, text: def.texts.p3 });
    }
  }
  await db.query('UPDATE mythic_hunts SET phase = $1 WHERE id = $2', [target, h.id]);
}

// Esbirros cazados durante la cacería (lo llama finalizeSession al ganar)
async function registerMinionKills(playerIds, enemies) {
  if (!enemies.some((e) => MINION_CODES.has(e.monster_code))) return;
  try {
    const hunt = await activeHunt();
    if (!hunt) return;
    const n = enemies.filter((e) => e.monster_code === minionOf(hunt.zone_id)?.code).length;
    if (!n) return;
    await db.query('UPDATE mythic_hunts SET minion_kills = minion_kills + $1 WHERE id = $2', [n, hunt.id]);
    for (const pid of [...new Set(playerIds)].filter(Boolean)) {
      await db.query(
        `INSERT INTO mythic_hunt_damage (hunt_id, player_id, total_damage, last_attempt_at) VALUES ($1, $2, $3, now() - interval '1 hour')
         ON CONFLICT (hunt_id, player_id) DO UPDATE SET total_damage = mythic_hunt_damage.total_damage + EXCLUDED.total_damage`,
        [hunt.id, pid, MINION_CREDIT * n]
      );
    }
    await broadcast();
  } catch (err) { console.error('[mythic] minions', err.message); }
}

async function broadcast() {
  if (!io) return;
  try { io.emit('mythic:update', await publicState()); } catch { /* nada */ }
}

let addNews = null;

// Guarda dónde fue un combate del mundo 2D (lo llama la ruta de explorar). pos = {x, y, zona} en
// píxeles locales de la zona.
async function rememberSpot(sessionId, pos) {
  if (!pos || typeof pos.zona !== 'string' || !Number.isFinite(Number(pos.x)) || !Number.isFinite(Number(pos.y))) return;
  try {
    await ensureTables();
    await db.query('UPDATE combat_sessions SET world_zone = $2, world_x = $3, world_y = $4 WHERE id = $1',
      [sessionId, pos.zona.slice(0, 32), Math.floor(Number(pos.x) / 32), Math.floor(Number(pos.y) / 32)]);
  } catch { /* sin posición: solo afecta a dónde aparece el jefe */ }
}

// Escondite al azar, con más peso donde más se cazó desde la última cacería (1 + muertes)
async function pickSpot(def) {
  const r = await db.query('SELECT spot, kills FROM mythic_spot_kills WHERE zone_id = $1', [def.zoneId]);
  const kills = new Map(r.rows.map((x) => [x.spot, x.kills]));
  const weights = def.spots.map((_, i) => 1 + (kills.get(i) ?? 0));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (const [i, w] of weights.entries()) { roll -= w; if (roll <= 0) return def.spots[i]; }
  return def.spots[def.spots.length - 1];
}

async function spawn(def) {
  const spot = await pickSpot(def);
  const r = await db.query(
    `INSERT INTO mythic_hunts (zone_id, monster_code, spot_name, spot_x, spot_y, max_hp, hp_remaining, ends_at)
     SELECT $1, $2, $3, $4, $5, $6, $6, now() + ($7 || ' minutes')::interval
     WHERE NOT EXISTS (SELECT 1 FROM mythic_hunts WHERE status = 'ACTIVE')
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [def.zoneId, def.code, spot.name, spot.x, spot.y, def.maxHp, String(def.minutes)]
  );
  if (!r.rows.length) return false;
  await db.query('UPDATE mythic_zone_progress SET kills = 0 WHERE zone_id = $1', [def.zoneId]);
  await db.query('DELETE FROM mythic_spot_kills WHERE zone_id = $1', [def.zoneId]);
  addNews?.(`¡Oíd, oíd! ¡${def.name} ha aparecido en ${spot.name}, en ${def.zoneName}! ¡Cazadores, a las armas!`);
  if (io) io.emit('mythic:spawn', { name: def.name, spot: spot.name, zoneDir: def.zoneDir, zoneName: def.zoneName });
  await broadcast();
  return true;
}

// Si la zona ya juntó las muertes y es de noche, aparece
async function resting(zoneId) {
  const r = await db.query(
    `SELECT 1 FROM mythic_hunts WHERE zone_id = $1 AND status <> 'ACTIVE' AND closed_at > now() - ($2 || ' minutes')::interval LIMIT 1`,
    [zoneId, String(REST_MINUTES)]
  );
  return r.rows.length > 0;
}

async function maybeSpawn(zoneId) {
  const def = MITICOS[zoneId];
  if (!def || !isNight()) return;
  if (await activeHunt()) return;
  if (await resting(zoneId)) return;
  const r = await db.query('SELECT kills FROM mythic_zone_progress WHERE zone_id = $1', [zoneId]);
  if ((r.rows[0]?.kills ?? 0) >= def.killsNeeded) await spawn(def);
}

// Cada pelea ganada suma a la cuenta de su zona (lo llama finalizeSession)
async function registerZoneKills(enemies, sessionId = null) {
  try {
    await ensureTables();
    const codes = enemies.map((e) => e.monster_code).filter((c) => c && !coleccion.isMythic(c));
    if (!codes.length) return;
    // mientras el jefe está suelto (o la zona descansa) no se cuenta: si no, reaparecería apenas muere
    if (await activeHunt()) return;
    const r = await db.query('SELECT code, zone_id FROM monsters WHERE code = ANY($1::text[])', [codes]);
    const zoneOf = new Map(r.rows.map((m) => [m.code, m.zone_id]));
    const perZone = new Map();
    for (const c of codes) { const z = zoneOf.get(c); if (MITICOS[z]) perZone.set(z, (perZone.get(z) || 0) + 1); }
    // ¿cerca de qué escondite fue este combate? (si la sesión guardó su casilla)
    const where = sessionId
      ? (await db.query('SELECT world_zone, world_x, world_y FROM combat_sessions WHERE id = $1', [sessionId])).rows[0]
      : null;
    for (const [z, n] of perZone) {
      if (await resting(z)) continue;
      const def = MITICOS[z];
      if (where?.world_zone === def.zoneDir && where.world_x != null) {
        let best = 0;
        def.spots.forEach((s, i) => {
          const d = Math.hypot(s.x - where.world_x, s.y - where.world_y);
          if (d < Math.hypot(def.spots[best].x - where.world_x, def.spots[best].y - where.world_y)) best = i;
        });
        await db.query(
          `INSERT INTO mythic_spot_kills (zone_id, spot, kills) VALUES ($1, $2, $3)
           ON CONFLICT (zone_id, spot) DO UPDATE SET kills = mythic_spot_kills.kills + EXCLUDED.kills`,
          [z, best, n]
        );
      }
      const before = await db.query(
        `INSERT INTO mythic_zone_progress (zone_id, kills) VALUES ($1, $2)
         ON CONFLICT (zone_id) DO UPDATE SET kills = mythic_zone_progress.kills + EXCLUDED.kills RETURNING kills`,
        [z, n]
      );
      const k = before.rows[0].kills;
      const need = MITICOS[z].killsNeeded;
      // los rumores avisan que se acerca (a la mitad y casi lleno)
      if (k - n < need * 0.5 && k >= need * 0.5) addNews?.(MITICOS[z].rumors[0]);
      if (k - n < need * 0.9 && k >= need * 0.9) addNews?.(MITICOS[z].rumors[1]);
      await maybeSpawn(z);
    }
    await broadcast();
  } catch (err) { console.error('[mythic] registerZoneKills', err.message); }
}

// ---- después de cada intento: restar la vida compartida y, si murió, repartir
async function handleFinalize(sessionId, participants) {
  await ensureTables();
  const s = await db.query('SELECT mythic_hunt_id FROM combat_sessions WHERE id = $1', [sessionId]);
  const huntId = s.rows[0]?.mythic_hunt_id;
  if (!huntId) return null;
  const boss = participants.enemy.find((e) => coleccion.isMythic(e.monster_code));
  if (!boss) return null;
  const dealt = Math.max(0, Math.round(Number(boss.max_hp) - Number(boss.hp)));

  const abandoned = (await db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId])).rows.map((r) => r.player_id);
  const dmgByOwner = await db.query(
    `SELECT COALESCE(cp.player_id, cp.owner_player_id) AS owner_id, SUM(cl.damage) AS dmg
     FROM combat_log cl JOIN combat_participants cp ON cp.id = cl.actor_participant_id
     WHERE cl.session_id = $1 AND cl.damage > 0 AND cp.side = 'PLAYER'
       AND COALESCE(cp.player_id, cp.owner_player_id) IS NOT NULL
       AND COALESCE(cp.player_id, cp.owner_player_id) != ALL($2::int[])
     GROUP BY 1`,
    [sessionId, abandoned]
  );
  // aunque no le haya pegado, el intento cuenta para el tiempo de espera
  for (const p of participants.player.filter((x) => x.player_id)) {
    await db.query(
      `INSERT INTO mythic_hunt_damage (hunt_id, player_id, total_damage) VALUES ($1, $2, 0)
       ON CONFLICT (hunt_id, player_id) DO UPDATE SET last_attempt_at = now()`,
      [huntId, p.player_id]
    );
  }
  for (const row of dmgByOwner.rows) {
    await db.query(
      'UPDATE mythic_hunt_damage SET total_damage = total_damage + $1 WHERE hunt_id = $2 AND player_id = $3',
      [Math.round(Number(row.dmg)), huntId, row.owner_id]
    );
  }
  const mine = participants.player.find((p) => p.player_id)?.player_id;
  const myDmg = Math.round(Number(dmgByOwner.rows.find((r) => r.owner_id === mine)?.dmg ?? 0));
  if (dealt <= 0) { await broadcast(); return { dealt: 0 }; }
  const hp = await db.query(
    "UPDATE mythic_hunts SET hp_remaining = GREATEST(0, hp_remaining - $1) WHERE id = $2 AND status = 'ACTIVE' RETURNING hp_remaining",
    [dealt, huntId]
  );
  const left = hp.rows[0]?.hp_remaining;
  if (left > 0) await advancePhase(huntId);
  let summary = { dealt, hpRemaining: left ?? 0 };
  if (mine) io?.to(`player:${mine}`).emit('mythic:attempt', { dealt: myDmg || dealt, hpRemaining: left ?? 0, name: MITICOS[(await db.query('SELECT zone_id FROM mythic_hunts WHERE id = $1', [huntId])).rows[0]?.zone_id]?.name });
  if (left != null && left <= 0) {
    const last = await db.query(
      `SELECT COALESCE(cp.player_id, cp.owner_player_id) AS owner_id FROM combat_log cl
       JOIN combat_participants cp ON cp.id = cl.actor_participant_id
       WHERE cl.session_id = $1 AND cl.damage > 0 AND cp.side = 'PLAYER' ORDER BY cl.id DESC LIMIT 1`,
      [sessionId]
    );
    const killer = last.rows[0]?.owner_id ?? participants.player.find((p) => p.player_id)?.player_id ?? null;
    const claim = await db.query(
      "UPDATE mythic_hunts SET status = 'KILLED', closed_at = now(), killed_by = $1 WHERE id = $2 AND status = 'ACTIVE' RETURNING *",
      [killer, huntId]
    );
    if (claim.rows.length) {
      await db.query('UPDATE mythic_zone_progress SET kills = 0 WHERE zone_id = $1', [claim.rows[0].zone_id]);
      summary = { ...summary, killed: true, ...(await distribute(claim.rows[0], killer)) };
    }
  }
  await broadcast();
  return summary;
}

// Botín según el aporte: oro y experiencia escalan con tu parte del daño; la carta mítica es
// segura para quien más pegó y para el resto es una probabilidad que crece con su aporte.
async function distribute(hunt, killerId) {
  const def = MITICOS[hunt.zone_id];
  const rows = (await db.query(
    `SELECT d.player_id, d.total_damage, p.nickname FROM mythic_hunt_damage d JOIN players p ON p.id = d.player_id
     WHERE d.hunt_id = $1 AND d.total_damage > 0 ORDER BY d.total_damage DESC`,
    [hunt.id]
  )).rows;
  const total = rows.reduce((s, r) => s + Number(r.total_damage), 0) || 1;
  const mon = (await db.query('SELECT id FROM monsters WHERE code = $1', [hunt.monster_code])).rows[0];
  const rewards = [];
  for (const [i, r] of rows.entries()) {
    const share = Number(r.total_damage) / total;
    if (share < 0.01 && i > 0) continue;
    // luna roja: el botín es mayor
    const moon = hunt.phase >= 3 ? RED_MOON_LOOT : 1;
    // pensado para que quien más aportó saque lo de unos 15-20 monstruos de la zona (un lobo da
    // ~85 de oro): antes eran 400-4000 de oro y subía de nivel de golpe a los de nivel bajo
    // (en las Montañas y el Volcán, en proporción a lo que dan sus monstruos: goldMul / xpMul)
    const gold = Math.round((150 + 1350 * share) * moon * (def?.goldMul ?? 1));
    const xp = Math.round((200 + 1800 * share) * moon * (def?.xpMul ?? 1));
    const card = i === 0 || Math.random() < 0.15 + share;
    await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [gold, r.player_id]);
    const lv = await leveling.applyXpGain(r.player_id, xp).catch(() => null);
    if (card && mon) await coleccion.giveCard(r.player_id, mon.id);
    await coleccion.registerKills([r.player_id], [{ monster_code: hunt.monster_code }], { includeMythic: true });
    // el gremio de cada cazador también gana (más cuanto más aportó)
    const guildXp = Math.round((50 + 450 * share) * moon);
    const gm = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [r.player_id]);
    if (gm.rows[0]) await applyGuildXp(gm.rows[0].guild_id, guildXp).catch(() => null);
    const reward = { playerId: r.player_id, name: r.nickname, share: Math.round(share * 1000) / 10, gold, xp, card, guildXp: gm.rows[0] ? guildXp : 0, levelUp: lv?.leveledUp ? lv.newLevel : null };
    rewards.push(reward);
    io?.to(`player:${r.player_id}`).emit('mythic:reward', { ...reward, boss: def?.name, killer: killerId === r.player_id });
  }
  const killerName = rows.find((r) => r.player_id === killerId)?.nickname ?? 'Un cazador';
  addNews?.(`¡${killerName} asestó el golpe final a ${def?.name ?? 'el jefe mítico'}! ${rows.length} cazadores participaron.`);
  io?.emit('mythic:killed', { name: def?.name, zoneDir: def?.zoneDir, zoneName: def?.zoneName, killer: killerName, hunters: rows.length, top: rows.slice(0, 3).map((r) => r.nickname) });
  return { rewards };
}

// ---- ranking semanal de cazadores (últimos 7 días): daño total a jefes míticos, cacerías en las
// que participaste y golpes finales. Los primeros llevan título.
const TITLES = ['Cazador de Lunas', 'Rastreador Espectral', 'Rastreador Espectral'];
async function weeklyHunters(limit = 10) {
  await ensureTables();
  const r = await db.query(
    `SELECT p.id, p.nickname, p.level, SUM(d.total_damage)::int AS damage, COUNT(*)::int AS hunts,
            COUNT(*) FILTER (WHERE h.killed_by = p.id)::int AS final_blows
     FROM mythic_hunt_damage d
     JOIN mythic_hunts h ON h.id = d.hunt_id
     JOIN players p ON p.id = d.player_id
     WHERE h.started_at > now() - interval '7 days' AND d.total_damage > 0
     GROUP BY p.id ORDER BY damage DESC LIMIT $1`,
    [limit]
  );
  return r.rows.map((x, i) => ({ ...x, rank: i + 1, title: TITLES[i] ?? 'Cazador' }));
}

// ---- ataque anunciado (como el faro del Vigía, pero a todo el grupo): cada TELEGRAPH_EVERY turnos el
// mítico anuncia su golpe; los héroes tienen un turno para Defender y en su siguiente turno pega
// TELEGRAPH_PCT de la vida máxima a quien no se cubrió (TELEGRAPH_GUARDED_PCT a quien sí). Filas en
// combat_participant_buffs del jefe: MYTH_N (turnos que lleva) y MYTH_CHARGE (anuncio pendiente; guarda
// hasta qué línea del registro iba el combate). Lo llama routes/combat.js en el turno del jefe.
const TELEGRAPH_EVERY = 3;
const TELEGRAPH_PCT = 0.35;
const TELEGRAPH_GUARDED_PCT = 0.08;
async function bossTurn({ sessionId, round, actor, participants, persistParticipant, insertLog, markNearDeathIfLow }) {
  const def = Object.values(MITICOS).find((d) => d.code === actor.monster_code);
  if (!def?.telegraph) return false;
  const heroes = participants.player.filter((p) => p.hp > 0 && !p.is_summon);
  if (!heroes.length) return false;
  const done = async () => { actor.has_acted_this_round = true; await persistParticipant(actor); return true; };
  const mark = (await db.query(
    "SELECT id, applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'MYTH_CHARGE'", [actor.id]
  )).rows[0];
  if (mark) {
    // que los héroes hayan tenido su turno para cubrirse
    const acted = (await db.query(
      `SELECT cl.actor_participant_id AS id, bool_or(cl.action = 'DEFEND') AS defended FROM combat_log cl
       JOIN combat_participants cp ON cp.id = cl.actor_participant_id
       WHERE cl.session_id = $1 AND cl.id > $2 AND cp.side = 'PLAYER' GROUP BY 1`,
      [sessionId, Number(mark.applied_flat) || 0]
    )).rows;
    if (!acted.length) return false;
    await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [mark.id]);
    const defended = new Map(acted.map((r) => [r.id, r.defended]));
    for (const h of heroes) {
      const guarded = !!defended.get(h.id) || !!h.is_defending;
      const invisible = !!h.no_damage_window;
      const dmg = invisible ? 0 : Math.max(1, Math.round(Number(h.max_hp) * (guarded ? TELEGRAPH_GUARDED_PCT : TELEGRAPH_PCT)));
      h.hp = Math.max(0, h.hp - dmg);
      await persistParticipant(h);
      await markNearDeathIfLow(h);
      await insertLog(sessionId, round, {
        actorId: actor.id, action: 'SKILL', targetId: h.id, damage: dmg, evaded: invisible, hp_after: h.hp,
        description: guarded ? def.telegraph.guard(actor.name, h.name, dmg) : def.telegraph.hit(actor.name, h.name, dmg),
      });
    }
    return done();
  }
  // cuenta sus turnos y, cuando toca, anuncia
  const n = await db.query(
    "UPDATE combat_participant_buffs SET applied_flat = applied_flat + 1 WHERE participant_id = $1 AND stat_code = 'MYTH_N' RETURNING applied_flat",
    [actor.id]
  );
  let turn = Number(n.rows[0]?.applied_flat ?? 0);
  if (!n.rows.length) {
    await db.query(
      "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES ($1,$2,'MYTH_N',1,9999,FALSE,NULL)",
      [sessionId, actor.id]
    );
    turn = 1;
  }
  if (turn % TELEGRAPH_EVERY !== 2) return false;
  await insertLog(sessionId, round, { actorId: actor.id, action: 'SKILL', targetId: actor.id, description: def.telegraph.charge(actor.name) });
  const last = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM combat_log WHERE session_id = $1', [sessionId]);
  await db.query(
    "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES ($1,$2,'MYTH_CHARGE',$3,9999,FALSE,NULL)",
    [sessionId, actor.id, Number(last.rows[0].id)]
  );
  return done();
}

// Revisa cada 30 s: aparece si ya era hora y se cerró la noche, o vence la cacería
function start(ioInstance, newsFn) {
  io = ioInstance;
  addNews = newsFn;
  ensureTables().catch((err) => console.error('[mythic] ensureTables', err.message));
  setInterval(async () => {
    try {
      await activeHunt();
      for (const z of Object.keys(MITICOS)) await maybeSpawn(Number(z));
    } catch { /* reintenta en la próxima vuelta */ }
  }, 30000).unref?.();
}

module.exports = {
  MITICOS, MINION_CODES, minionOf, cloneLevel, bossTurn, joinHunters, ATTEMPT_COOLDOWN_S, MINION_CODE, MINION, MONSTER, RED_MOON_ATK, defDownOf, registerMinionKills, isNight, gameHour, ensureTables, activeHunt, publicState, broadcast,
  registerZoneKills, handleFinalize, spawn, start, weeklyHunters, rememberSpot,
};
