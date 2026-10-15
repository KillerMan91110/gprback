// Equilibrio del juego por fórmulas (en vez de número por número). Una sola fuente para:
//   - la curva del monstruo común por nivel y cuánto más fuertes son raros, minijefes y jefes;
//   - el crecimiento por nivel de las 5 clases base (las evoluciones se derivan de su clase base);
//   - el poder de las habilidades de las clases base por tramo de nivel.
// La usan scripts/equilibrio/generar.js (escribe el SQL de la base y lo valida con el simulador),
// lib/cripta.js y lib/mythic.js (sus monstruos se definen en código).
//
// Objetivo de diseño (combate 1 contra 1 a tu nivel con el equipo de tu tramo): matar en 3-5 turnos
// con tu habilidad principal y aguantar ~6-8 golpes (el Guerrero bastante más). Así un monstruo
// solo es tranquilo, dos se pelean con cuidado y tres piden pociones o compañeros.
//
// Hoy cubre la Pradera (nivel 1-15); para otra zona se usa la misma curva con su rango de niveles.

// ---------------------------------------------------------------- monstruos
// monstruo común de nivel L (antes de su rareza y su perfil)
const HP_EXTRA_FROM_10 = 55;
// nivel donde cambia la pendiente de la vida: el generador guarda una fila ahí (la curva entre filas
// es lineal)
const HP_KNEE_LEVEL = 9;

// Desde el nivel 16 (Montañas Grises en adelante) la vida y las defensas suben más despacio: las
// habilidades de las clases base no mejoran después del nivel 10, así que el daño del héroe crece
// solo por su nivel y su equipo. Las peleas igual se alargan un poco al subir (de 4 a 5-6 turnos),
// pero un común nunca le gana a un héroe de su nivel bien equipado.
const HIGH_FROM_LEVEL = 15;
const HIGH_PER_LEVEL = { hp: 75, def: 5, magic_def: 4.5 };

function monsterBase(level) {
  const L = Math.max(1, level);
  if (L > HIGH_FROM_LEVEL) {
    const top = monsterBase(HIGH_FROM_LEVEL);
    const up = L - HIGH_FROM_LEVEL;
    return {
      ...top,
      atk: 14 + 4 * (L - 1),
      spd: 10 + 2 * (L - 1),
      evasion: 5 + 0.3 * (L - 1),
      crit_chance: 6 + 0.2 * (L - 1),
      hp: top.hp + HIGH_PER_LEVEL.hp * up,
      def: top.def + HIGH_PER_LEVEL.def * up,
      magic_def: top.magic_def + HIGH_PER_LEVEL.magic_def * up,
    };
  }
  return {
    // desde el nivel 10 sube más rápido: ahí llegan la habilidad del tramo alto y el set del Capitán
    hp: 140 + 45 * (L - 1) + HP_EXTRA_FROM_10 * Math.max(0, L - 9),
    atk: 14 + 4 * (L - 1),
    def: 12 + 6 * L,
    magic_def: 10 + 5.5 * L,
    spd: 10 + 2 * (L - 1),
    evasion: 5 + 0.3 * (L - 1),
    crit_chance: 6 + 0.2 * (L - 1),
    crit_damage: 50,
  };
}

// cuánto más fuerte es cada rareza que un común del mismo nivel
const RARITY_MULT = {
  COMMON: { hp: 1, atk: 1, def: 1, magic_def: 1, spd: 1 },
  RARE: { hp: 1.8, atk: 1.2, def: 1.1, magic_def: 1.1, spd: 1.05 },
  MINIBOSS: { hp: 3.5, atk: 1.4, def: 1.2, magic_def: 1.2, spd: 1.3 },
  LEGENDARY: { hp: 6, atk: 1.6, def: 1.3, magic_def: 1.3, spd: 1.2 },
};

// Fila de monster_level_scalings para un monstruo de esa rareza y perfil en ese nivel.
// perfil: multiplicadores propios (hp, atk, def, magic_def, spd), extras (evasion, crit_chance) y
// magic: true si pega con magia (su básico usa magic_atk contra la defensa mágica).
function monsterRow(level, rarity = 'COMMON', perfil = {}) {
  const b = monsterBase(level);
  const r = RARITY_MULT[rarity] ?? RARITY_MULT.COMMON;
  const p = { hp: 1, atk: 1, def: 1, magic_def: 1, spd: 1, evasion: 0, crit_chance: 0, ...perfil };
  const power = b.atk * r.atk * p.atk;
  return {
    level,
    hp: Math.round(b.hp * r.hp * p.hp),
    atk: Math.round(p.magic ? power * 0.4 : power),
    magic_atk: Math.round(p.magic ? power * 1.05 : power * 0.5),
    def: Math.round(b.def * r.def * p.def),
    magic_def: Math.round(b.magic_def * r.magic_def * p.magic_def),
    spd: Math.round(b.spd * r.spd * p.spd),
    evasion: Math.round((b.evasion + p.evasion) * 10) / 10,
    crit_chance: Math.round((b.crit_chance + p.crit_chance) * 10) / 10,
    crit_damage: b.crit_damage,
    elemental_damage: p.elemental_damage ?? 0,
  };
}

// ---------------------------------------------------------------- clases base
// Crecimiento por nivel: cada clase sube sobre todo lo que usa; lo que no usa crece poco. Más vida
// por nivel que antes (los monstruos pegaban cada vez más y la vida casi no subía).
const CLASS_GROWTH = {
  GUERRERO: { hp: 22, atk: 8, def: 6, mag: 1, magic_def: 4, spd: 2.5, mana: 10 },
  MAGO: { hp: 13, atk: 1.5, def: 4.5, mag: 8, magic_def: 6, spd: 2.5, mana: 25 },
  ARQUERO: { hp: 13, atk: 7.3, def: 4, mag: 1, magic_def: 3.5, spd: 3.5, mana: 12 },
  PICARO: { hp: 12, atk: 7.5, def: 4.5, mag: 1, magic_def: 3.5, spd: 4, mana: 12 },
  SACERDOTE: { hp: 14, atk: 1.5, def: 4.5, mag: 7, magic_def: 6.7, spd: 2.5, mana: 25 },
};
// stat principal de cada clase base (escalan con ella sus habilidades y su básico)
const MAIN_STAT = { GUERRERO: 'atk', MAGO: 'mag', ARQUERO: 'atk', PICARO: 'atk', SACERDOTE: 'mag' };

// ---------------------------------------------------------------- habilidades de las clases base
// Antes: número fijo grande + 1×stat, así que subir de nivel casi no subía el daño. Ahora menos
// número fijo y más escala con la stat principal, por tramo de nivel en que se aprende.
function skillTier(learnLevel) {
  if (learnLevel >= 10) return { base: 50, mult: 1.7 };
  if (learnLevel >= 5) return { base: 40, mult: 1.6 };
  return { base: 20, mult: 1.1 };
}
// habilidades a todos los enemigos: algo menos por objetivo
const AOE_FACTOR = 0.7;
// las que no se aprenden por nivel (oro, misión, botín, objeto legendario): el tramo alto y un
// extra según lo difícil que es conseguirlas. Valores fijos (no dependen de lo que tenían), así que
// generar el SQL dos veces da lo mismo. Las de varios golpes reparten el daño (en total, un 30% más).
const SPECIAL_FACTOR = { GOLD: 1.05, QUEST: 1.15, DROP: 1.25, ITEM: 1.35 };
function specialSkill({ learn_method: method, target_type: target, hits }) {
  const t = skillTier(10);
  let f = SPECIAL_FACTOR[method] ?? 1;
  if (target === 'ALL_ENEMIES' || target === 'ALL_ALLIES') f *= AOE_FACTOR;
  const n = Math.max(1, Number(hits) || 1);
  if (n > 1) f *= 1.3 / n;
  return { base: Math.round(t.base * f), mult: Math.round(t.mult * f * 100) / 100 };
}

module.exports = { HP_KNEE_LEVEL, monsterBase, RARITY_MULT, monsterRow, CLASS_GROWTH, MAIN_STAT, skillTier, AOE_FACTOR, specialSkill };

// ---------------------------------------------------------------- recálculo de stats guardadas
// Jugadores y compañeros NPC guardan sus stats (se calculan al subir de nivel o evolucionar). Cuando
// cambian las curvas, el SQL deja una fila pendiente en balance_versions y el servidor recalcula a
// todos una vez: stats de su clase y nivel + la vida de su equipo, conservando el % de vida y maná
// que tenían. Como ahora todas las clases suben igual de rápido, también se les sube el nivel si su
// XP ya alcanza (nunca se baja). Se revisa al arrancar y cada 10 minutos (por si el SQL se corre
// con el servidor ya encendido, como en Supabase + Render).
const RECALC_EVERY_MS = 10 * 60 * 1000;

async function recalcularPersonajes() {
  const db = require('../db/db');
  const leveling = require('./leveling');
  const { getEquipmentBonuses, getNpcEquipmentBonuses } = require('./equipment');
  const pending = await db.query('SELECT version FROM balance_versions WHERE applied_at IS NULL ORDER BY created_at')
    .catch(() => ({ rows: [] }));
  if (!pending.rows.length) return null;

  const classes = new Map((await db.query('SELECT * FROM classes')).rows.map((c) => [c.id, c]));
  const growthBy = new Map();
  for (const g of (await db.query('SELECT * FROM class_growths ORDER BY level_from')).rows) {
    if (!growthBy.has(g.class_id)) growthBy.set(g.class_id, []);
    growthBy.get(g.class_id).push(g);
  }
  const keepRatio = (cur, oldMax, newMax) => (Number(oldMax) > 0 ? Math.max(1, Math.round(newMax * Math.min(1, Number(cur) / Number(oldMax)))) : newMax);

  let players = 0;
  for (const p of (await db.query('SELECT id, xp, level, hp, max_hp, mana, max_mana, current_class_id, evolution_class_id FROM players')).rows) {
    const cls = classes.get(p.evolution_class_id || p.current_class_id);
    if (!cls) continue;
    const level = Math.max(p.level, leveling.levelForXp(Number(p.xp), Number(cls.xp_rate)));
    const s = leveling.computeStatsAtLevel(cls, growthBy.get(cls.id) ?? [], level);
    const maxHp = s.hp + ((await getEquipmentBonuses(p.id)).hp || 0);
    await db.query(
      `UPDATE players SET level = $2, max_hp = $3, hp = $4, max_mana = $5, mana = $6, atk = $7, def = $8, mag = $9,
         magic_def = $10, spd = $11, crit = $12, updated_at = now() WHERE id = $1`,
      [p.id, level, maxHp, p.hp <= 0 ? 0 : keepRatio(p.hp, p.max_hp, maxHp), s.mana, keepRatio(p.mana, p.max_mana, s.mana),
        s.atk, s.def, s.mag, s.magicDef, s.spd, s.crit]
    );
    players += 1;
  }
  let npcs = 0;
  for (const n of (await db.query('SELECT id, level, hp, max_hp, mana, max_mana, class_id FROM player_npcs')).rows) {
    const cls = classes.get(n.class_id);
    if (!cls) continue;
    const s = leveling.computeStatsAtLevel(cls, growthBy.get(cls.id) ?? [], n.level);
    const maxHp = s.hp + ((await getNpcEquipmentBonuses(n.id)).hp || 0);
    await db.query(
      `UPDATE player_npcs SET max_hp = $2, hp = $3, max_mana = $4, mana = $5, atk = $6, def = $7, mag = $8,
         magic_def = $9, spd = $10, crit = $11 WHERE id = $1`,
      [n.id, maxHp, n.hp <= 0 ? 0 : keepRatio(n.hp, n.max_hp, maxHp), s.mana, keepRatio(n.mana, n.max_mana, s.mana),
        s.atk, s.def, s.mag, s.magicDef, s.spd, s.crit]
    );
    npcs += 1;
  }
  await db.query('UPDATE balance_versions SET applied_at = now() WHERE version = ANY($1::text[])', [pending.rows.map((r) => r.version)]);
  console.log(`[equilibrio] ${pending.rows.map((r) => r.version).join(', ')}: recalculadas las stats de ${players} jugadores y ${npcs} compañeros`);
  return { players, npcs };
}

function iniciarRecalculo() {
  const run = () => recalcularPersonajes().catch((err) => console.error('[equilibrio]', err.message));
  run();
  setInterval(run, RECALC_EVERY_MS).unref();
}

module.exports.recalcularPersonajes = recalcularPersonajes;
module.exports.iniciarRecalculo = iniciarRecalculo;

// ---------------------------------------------------------------- equipo
// Poder de una pieza según su nivel requerido y su rareza; cada tipo de pieza toma una parte. Cada
// objeto conserva QUÉ stats da y en qué proporción (su carácter); la fórmula fija CUÁNTO da en total.
// la rareza es un plus, no el doble: con épico 1.5 / legendario 1.75 los sets del Capitán y del
// Titán mataban todo en 2 turnos
const ITEM_RARITY = { COMUN: 1, POCO_COMUN: 1.1, RARO: 1.2, EPICO: 1.3, LEGENDARIO: 1.45, UNICO: 1.35 };
const RARITY_STEP = { COMUN: 0, POCO_COMUN: 1, RARO: 2, EPICO: 3, LEGENDARIO: 4, UNICO: 3 };
const SLOT_WEIGHT = { WEAPON: 1, ARMOR: 0.9, OFFHAND: 0.55, HELMET: 0.45, GLOVES: 0.45, BOOTS: 0.45, ACCESSORY: 0.4 };
const TWO_HANDED = 1.5;
// cuánto vale 1 punto de cada stat plana frente a 1 de ATK/MAG
const STAT_COST = { ATK: 1, MAG: 1, DEF: 0.4, MAGIC_DEF: 0.4, HP: 4, SPD: 0.6, ELEMENTAL_ATK: 1 };
const itemPower = (level, rarity) => (10 + 1.5 * Math.max(1, level)) * (ITEM_RARITY[rarity] ?? 1);

// stats nuevas de un objeto. stats: [{ stat_code, amount, is_percent }]. Las planas se reescalan
// manteniendo su proporción (y su signo: las armas a dos manos que restan defensa lo siguen haciendo);
// crítico, esquiva y daño crítico salen de la rareza; el resto (curación, regeneración, daño de un
// elemento…) queda como estaba.
// el equipo fabricado vale como uno de CRAFTED_BONUS niveles más (premio por fabricarlo)
const CRAFTED_BONUS = 2;
function itemStats({ slot, rarity, required_level: level, is_two_handed: twoHanded, is_craftable: crafted }, stats) {
  const budget = itemPower(level + (crafted ? CRAFTED_BONUS : 0), rarity) * (SLOT_WEIGHT[slot] ?? 0.5) * (slot === 'WEAPON' && twoHanded ? TWO_HANDED : 1);
  const flat = stats.filter((s) => !s.is_percent && STAT_COST[s.stat_code]);
  const norm = (s) => Number(s.amount) / STAT_COST[s.stat_code];
  const top = Math.max(1e-9, ...flat.map((s) => Math.abs(norm(s))));
  const step = RARITY_STEP[rarity] ?? 0;
  const big = (SLOT_WEIGHT[slot] ?? 0) >= 0.9;
  return stats.map((s) => {
    if (!s.is_percent && STAT_COST[s.stat_code]) {
      return { ...s, amount: Math.round(STAT_COST[s.stat_code] * budget * (norm(s) / top)) };
    }
    if (s.stat_code === 'CRIT_CHANCE') return { ...s, amount: Math.round((1.5 + step) * (big ? 1.5 : 1) * 10) / 10 };
    if (s.stat_code === 'EVASION') return { ...s, amount: Math.round((1 + 0.5 * step) * 10) / 10 };
    if (s.stat_code === 'CRIT_DAMAGE') return { ...s, amount: 5 + 2 * step };
    return s;
  });
}

module.exports.itemPower = itemPower;
module.exports.itemStats = itemStats;
