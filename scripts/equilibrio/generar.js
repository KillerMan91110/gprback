// Generador del equilibrio de la Pradera (lib/equilibrio.js).
//   node scripts/equilibrio/generar.js --simular   valida: cada clase contra cada monstruo de su nivel
//   node scripts/equilibrio/generar.js --sql       escribe el SQL (monstruos, clases, habilidades)
// El SQL va al final de db/schema.sql: se aplica en local y en Supabase igual que las demás
// migraciones (valores fijos, se puede correr varias veces).
require('dotenv').config({ quiet: true });
const db = require('../../db/db');
const L = require('../../lib/leveling');
const EQ = require('../../lib/equilibrio');

// Perfil de cada monstruo de la Pradera: su personalidad sobre la curva (los multiplicadores de
// rareza los pone lib/equilibrio.js según la columna rarity).
const PERFILES = {
  LOBO_PRADERA: { spd: 1.2, magic_def: 0.9 },
  BANDIDO_CORRUPTO: { atk: 1.1, def: 1.05, magic_def: 0.95 },
  RATA_ALCANTARILLA: { hp: 0.8, atk: 0.85, def: 0.85, spd: 1.4, evasion: 3 },
  ARANA_VENENOSA: { hp: 0.85, atk: 0.95, def: 1.1, spd: 1.3, crit_chance: 4 },
  GOBLIN_SAQUEADOR: { atk: 1.05, def: 0.9, magic_def: 0.8, spd: 1.1 },
  LOBO_FEROZ: { spd: 1.25, magic_def: 0.9 },
  CHAMAN_OSCURO: { magic: true, def: 0.85, magic_def: 1.2 },
  CAPITAN_LOBOS: { magic_def: 0.95 },
  TITAN_PRADERA: {},
};

const SIM_LEVELS = [1, 3, 5, 8, 10, 12, 15];
const CLASS_IDS = { GUERRERO: 1, MAGO: 2, ARQUERO: 3, PICARO: 4, SACERDOTE: 5 };
const PASSIVE_CRIT = { ARQUERO: 15, PICARO: 25 };

// Equipo de la Pradera que entra en la fórmula: todo lo de nivel 1-15 de las clases base o sin clase
async function loadItems() {
  const rows = (await db.query(`SELECT i.id, i.code, i.name, i.class_id, i.slot, i.rarity, i.required_level, i.is_two_handed, i.is_craftable,
      b.id AS bonus_id, b.stat_code, b.amount, b.is_percent
    FROM items i JOIN item_stat_bonuses b ON b.item_id = i.id
    WHERE i.item_type = 'EQUIPMENT' AND i.required_level <= 15 AND (i.class_id IS NULL OR i.class_id <= 5)
    ORDER BY i.id, b.id`)).rows;
  const items = new Map();
  for (const r of rows) {
    if (!items.has(r.id)) items.set(r.id, { ...r, stats: [] });
    items.get(r.id).stats.push({ bonus_id: r.bonus_id, stat_code: r.stat_code, amount: Number(r.amount), is_percent: r.is_percent });
  }
  for (const it of items.values()) it.newStats = EQ.itemStats(it, it.stats);
  return [...items.values()];
}

// totales de un set (una pieza por hueco, una sola arma) con las stats NUEVAS
function setTotals(items, classId, suffix) {
  const g = {}; const seen = new Set();
  for (const it of items.filter((x) => x.class_id === classId && x.name.endsWith(suffix))) {
    if (seen.has(it.slot)) continue; seen.add(it.slot);
    for (const s of it.newStats) g[s.stat_code] = (g[s.stat_code] || 0) + Number(s.amount);
  }
  return g;
}

async function loadData() {
  const classes = (await db.query('SELECT * FROM classes WHERE id <= 5 ORDER BY id')).rows;
  const items = await loadItems();
  // equipo de cada tramo: Pradera (nv 1-9), Capitán (10-13), Titán (14-15)
  const gear = {};
  for (const c of classes) {
    gear[c.code] = { pradera: setTotals(items, c.id, ' de Pradera'), capitan: setTotals(items, c.id, ' del Capitán'), titan: setTotals(items, c.id, ' del Titán') };
  }
  const monsters = (await db.query(`SELECT code, name, rarity, min_spawn_level, max_spawn_level FROM monsters WHERE zone_id = 1 ORDER BY min_spawn_level, code`)).rows;
  return { classes, gear, monsters, items };
}

// stats de un héroe de la clase en ese nivel con el crecimiento NUEVO y el set de Pradera
function heroAt(c, lv, gear) {
  const g = EQ.CLASS_GROWTH[c.code];
  const k = lv - 1;
  const tiers = gear[c.code] || {};
  const e = (lv >= 14 ? tiers.titan : lv >= 10 ? tiers.capitan : tiers.pradera) || {};
  return {
    hp: Number(c.base_hp) + g.hp * k + (e.HP || 0),
    atk: Number(c.base_atk) + g.atk * k + (e.ATK || 0),
    mag: Number(c.base_mag) + g.mag * k + (e.MAG || 0),
    def: Number(c.base_def) + g.def * k + (e.DEF || 0),
    magic_def: Number(c.base_magic_def) + g.magic_def * k + (e.MAGIC_DEF || 0),
    crit: 10 + (PASSIVE_CRIT[c.code] || 0) + (e.CRIT_CHANCE || 0),
  };
}

function simulate({ classes, gear, monsters }) {
  console.log('Equipo: set de Pradera (nv 1-9), del Capitán (10-13), del Titán (14-15), con las stats NUEVAS.');
  console.log('Cada celda: turnos para matar / golpes que aguanta (peor monstruo común de ese nivel). Meta: 3-5 / 6+');
  for (const c of classes) {
    const cells = [];
    for (const lv of SIM_LEVELS) {
      const h = heroAt(c, lv, gear);
      const sk = EQ.skillTier(lv >= 10 ? 10 : lv >= 5 ? 5 : 1);
      const main = h[EQ.MAIN_STAT[c.code]];
      const magic = EQ.MAIN_STAT[c.code] === 'mag';
      let worstTtk = 0; let worstTtd = 99;
      for (const m of monsters.filter((x) => x.rarity === 'COMMON')) {
        const row = EQ.monsterRow(lv, 'COMMON', PERFILES[m.code]);
        const dmg = Math.max(1, sk.base + sk.mult * main - 0.5 * (magic ? row.magic_def : row.def)) * (1 + Math.min(100, h.crit) / 100 * 0.5);
        const ttk = Math.ceil(row.hp / dmg);
        const monMagic = row.magic_atk > row.atk;
        const hit = Math.max(1, 1.2 * (monMagic ? row.magic_atk : row.atk) - 0.5 * (monMagic ? h.magic_def : h.def)) * (1 + row.crit_chance / 100 * 0.5);
        const ttd = Math.ceil(h.hp / hit);
        worstTtk = Math.max(worstTtk, ttk); worstTtd = Math.min(worstTtd, ttd);
      }
      cells.push(`nv${lv} ${worstTtk}/${worstTtd}`);
    }
    console.log(c.code.padEnd(10), cells.join('  '));
  }
  // jefes y raros contra un grupo de 3 héroes promedio de su nivel
  console.log('\nRaros y jefes (nivel típico): vida / ataque / defensa');
  for (const m of monsters.filter((x) => x.rarity !== 'COMMON')) {
    const lv = m.min_spawn_level;
    const row = EQ.monsterRow(lv, m.rarity, PERFILES[m.code]);
    console.log(`${m.name} (${m.rarity}, nv ${lv}): ${row.hp} / ${Math.max(row.atk, row.magic_atk)} / ${row.def}`);
  }
}

// ---------------------------------------------------------------- SQL
const sqlNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const ROW_COLS = ['level', 'hp', 'atk', 'def', 'magic_atk', 'magic_def', 'spd', 'evasion', 'crit_chance', 'crit_damage', 'elemental_damage'];

// filas de un monstruo: borrar las suyas e insertar las de la fórmula (y su base = la primera)
function monsterSql(code, rows) {
  const id = `(SELECT id FROM monsters WHERE code = '${code}')`;
  const out = [`DELETE FROM monster_level_scalings WHERE monster_id = ${id};`];
  const values = rows.map((r) => `  (${ROW_COLS.map((c) => sqlNum(r[c])).join(', ')})`).join(',\n');
  out.push(`INSERT INTO monster_level_scalings (monster_id, ${ROW_COLS.join(', ')})
SELECT ${id}, v.* FROM (VALUES
${values}
) AS v(${ROW_COLS.join(', ')}) WHERE ${id} IS NOT NULL;`);
  const f = rows[0];
  out.push(`UPDATE monsters SET base_hp = ${f.hp}, base_atk = ${f.atk}, base_def = ${f.def}, base_magic_atk = ${f.magic_atk}, base_magic_def = ${f.magic_def}, base_spd = ${f.spd}, base_evasion = ${sqlNum(f.evasion)}, base_crit_chance = ${sqlNum(f.crit_chance)}, base_crit_damage = ${f.crit_damage} WHERE code = '${code}';`);
  return out.join('\n');
}

async function buildSql(data) {
  const { monsters } = data;
  const parts = [];
  parts.push('-- monstruos de la Pradera (filas en su nivel mínimo y en el 15: la curva es lineal)');
  for (const m of monsters) {
    const rows = [m.min_spawn_level, 15].filter((v, i, a) => a.indexOf(v) === i).map((lv) => EQ.monsterRow(lv, m.rarity, PERFILES[m.code]));
    parts.push(monsterSql(m.code, rows));
  }
  parts.push('-- cripta del Vigía y cacería mítica (definidos en lib/cripta.js y lib/mythic.js con la misma curva)');
  const cripta = require('../../lib/cripta');
  const mythic = require('../../lib/mythic');
  for (const m of [...cripta.MONSTERS, mythic.MINION, mythic.MONSTER]) parts.push(monsterSql(m.code, m.scalings));

  // crecimiento por nivel: clases base con la tabla de lib/equilibrio.js; cada evolución conserva
  // cuánto más (o menos) que su clase base crecía en cada stat
  const COLS = { hp: 'hp_per_level', atk: 'atk_per_level', def: 'def_per_level', mag: 'mag_per_level', magic_def: 'magic_def_per_level', spd: 'spd_per_level', mana: 'mana_per_level' };
  const classes = (await db.query('SELECT id, code FROM classes')).rows;
  const growth = new Map((await db.query('SELECT * FROM class_growths')).rows.map((r) => [r.class_id, r]));
  const parentOf = new Map((await db.query('SELECT class_id, evolves_to_class_id FROM class_evolutions ORDER BY id')).rows.reverse().map((r) => [r.evolves_to_class_id, r.class_id]));
  const rootOf = (id) => { let cur = id; for (let i = 0; i < 10 && !CLASS_IDS_BY_ID[cur] && parentOf.has(cur); i += 1) cur = parentOf.get(cur); return CLASS_IDS_BY_ID[cur] ? cur : null; };
  parts.push('-- crecimiento por nivel (las 5 clases base y sus evoluciones)');
  for (const c of classes) {
    const root = rootOf(c.id);
    const g = growth.get(c.id);
    if (!root || !g) continue;
    const baseCode = CLASS_IDS_BY_ID[root];
    const target = EQ.CLASS_GROWTH[baseCode];
    const rootOld = growth.get(root);
    const sets = Object.entries(COLS).map(([k, col]) => {
      const val = c.id === root || !Number(rootOld[col]) ? target[k] : target[k] * Number(g[col]) / Number(rootOld[col]);
      return `${col} = ${sqlNum(Math.round(val * 100) / 100)}`;
    });
    parts.push(`UPDATE class_growths SET ${sets.join(', ')} WHERE class_id = ${c.id};`);
  }

  // habilidades de daño y curación de las clases base
  parts.push('-- habilidades de las clases base: menos número fijo, más escala con la stat principal');
  const skills = (await db.query(`SELECT code, skill_type, target_type, hits, base_value, scaling_multiplier, learn_method, learn_level FROM skills
    WHERE class_id <= 5 AND base_value IS NOT NULL AND skill_type IN ('ATAQUE', 'CURACION')`)).rows;
  for (const sk of skills) {
    let v;
    if (sk.learn_method === 'LEVEL') {
      const t = EQ.skillTier(sk.learn_level ?? 1);
      const f = sk.target_type === 'ALL_ENEMIES' || sk.target_type === 'ALL_ALLIES' ? EQ.AOE_FACTOR : 1;
      v = { base: Math.round(t.base * f), mult: Math.round(t.mult * f * 100) / 100 };
    } else {
      v = EQ.specialSkill(sk);
    }
    parts.push(`UPDATE skills SET base_value = ${v.base}, scaling_multiplier = ${sqlNum(v.mult)} WHERE code = '${sk.code}';`);
  }

  // equipo de la Pradera por fórmula (lib/equilibrio.js itemStats): solo las stats que cambian
  parts.push('-- equipo de nivel 1-15 de las clases base: stats por fórmula según su nivel y rareza');
  for (const it of data.items) {
    for (let i = 0; i < it.stats.length; i += 1) {
      const before = Number(it.stats[i].amount); const after = Number(it.newStats[i].amount);
      // por código de objeto y stat (los id de item_stat_bonuses cambian entre bases)
      if (before !== after) parts.push(`UPDATE item_stat_bonuses b SET amount = ${sqlNum(after)} FROM items i WHERE i.id = b.item_id AND i.code = '${it.code}' AND b.stat_code = '${it.stats[i].stat_code}' AND b.is_percent = ${it.stats[i].is_percent ? 'TRUE' : 'FALSE'}; -- ${before} -> ${after}`);
    }
  }

  // las stats guardadas de jugadores y compañeros se recalculan solas (lib/equilibrio.js)
  parts.push('-- pide recalcular las stats guardadas de jugadores y compañeros (lo hace el servidor)');
  parts.push(`CREATE TABLE IF NOT EXISTS balance_versions (version TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_at TIMESTAMPTZ);
INSERT INTO balance_versions (version) SELECT 'pradera_v1' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_v1');
INSERT INTO balance_versions (version) SELECT 'pradera_equipo_v1' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_equipo_v1');`);
  return parts.join('\n');
}

const CLASS_IDS_BY_ID = Object.fromEntries(Object.entries(CLASS_IDS).map(([k, v]) => [v, k]));

(async () => {
  const data = await loadData();
  if (process.argv.includes('--simular')) simulate(data);
  if (process.argv.includes('--sql')) process.stdout.write(`${await buildSql(data)}
`);
  process.exit();
})().catch((err) => { console.error(err); process.exit(1); });

module.exports = { PERFILES, CLASS_IDS };
