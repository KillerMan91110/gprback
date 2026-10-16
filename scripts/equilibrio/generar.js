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
  // nuevos de la historia (cada subzona alta con su enemigo propio)
  JABALI_CORNUDO: { hp: 1.25, atk: 1.05, def: 1.15, magic_def: 0.85, spd: 0.85 },
  SAPO_DE_LODO: { hp: 1.1, atk: 0.9, def: 0.9, magic_def: 1.1, spd: 0.8 },
  ESQUELETO_VIGIA: { hp: 0.9, atk: 1.05, def: 1.3, magic_def: 0.8 },
  ACOLITO_ECLIPSE: { magic: true, hp: 0.85, def: 0.8, magic_def: 1.2 },
  BESTIA_GRIETA: { atk: 1.15, def: 0.9, spd: 1.25, crit_chance: 4 },
  GOLEM_MENHIR: { hp: 1.1, def: 1.4, magic_def: 1.1, spd: 0.7 },
  // Montañas Grises (zona 2, nivel 16-30)
  CABRA_MONTES: { hp: 0.95, atk: 1.05, def: 0.95, spd: 1.3, evasion: 4 },
  ORCO_MONTANA: { hp: 1.1, atk: 1.1, def: 1.05, magic_def: 0.85, spd: 0.95 },
  LOBO_NIEVE: { spd: 1.25, magic_def: 0.95, crit_chance: 3 },
  MINERO_CORROMPIDO: { atk: 1.05, def: 1.1, magic_def: 0.9 },
  MURCIELAGO_CAVERNA: { hp: 0.8, atk: 0.9, def: 0.8, spd: 1.45, evasion: 6 },
  CENTINELA_PIEDRA: { hp: 1.1, def: 1.4, magic_def: 1.05, spd: 0.7 },
  ESPECTRO_HELADO: { magic: true, hp: 0.85, def: 0.75, magic_def: 1.3, evasion: 4 },
  OSO_CUMBRES: { hp: 1.35, atk: 1.15, def: 1.1, magic_def: 0.85, spd: 0.85 },
  SIERPE_HIELO: { magic: true, hp: 1.05, magic_def: 1.15, spd: 1.05 },
  TROLL_SALVAJE: { hp: 1.4, atk: 1.1, def: 0.95, magic_def: 0.8, spd: 0.75 },
  ARPIA_ECO: { hp: 0.85, atk: 1.05, def: 0.85, spd: 1.35, evasion: 5, crit_chance: 3 },
  ELEMENTAL_TORMENTA: { magic: true, hp: 0.95, def: 0.9, magic_def: 1.25, spd: 1.15 },
  GIGANTE_HIELO: { hp: 1.2, atk: 1.1, def: 1.15, spd: 0.75 },
  BRUJO_MONTANA: { magic: true, hp: 0.9, def: 0.85, magic_def: 1.25 },
  SENOR_ACANTILADO: { magic_def: 0.95 },
  REY_MONTANA: {},
  GUARDIA_TORMENTA: { hp: 1.05, atk: 1.1, def: 1.2, spd: 0.9 },
};

const SIM_LEVELS = [1, 3, 5, 8, 10, 12, 14, 15];
const { DAMAGE_FLOOR } = require('../../lib/combat');
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
    gear[c.code] = {
      pradera: setTotals(items, c.id, ' de Pradera'), guardia: setTotals(items, c.id, ' de la Guardia'),
      capitan: setTotals(items, c.id, ' del Capitán'), titan: setTotals(items, c.id, ' del Titán'),
    };
  }
  const monsters = (await db.query(`SELECT code, name, rarity, min_spawn_level, max_spawn_level FROM monsters WHERE zone_id = 1 ORDER BY min_spawn_level, code`)).rows;
  return { classes, gear, monsters, items };
}

// stats de un héroe de la clase en ese nivel con el crecimiento NUEVO y el set de Pradera
function heroAt(c, lv, gear) {
  const g = EQ.CLASS_GROWTH[c.code];
  const k = lv - 1;
  const tiers = gear[c.code] || {};
  const e = (lv >= 14 ? tiers.titan : lv >= 10 ? tiers.capitan : lv >= 6 ? tiers.guardia : tiers.pradera) || {};
  return {
    hp: Number(c.base_hp) + g.hp * k + (e.HP || 0),
    atk: Number(c.base_atk) + g.atk * k + (e.ATK || 0),
    mag: Number(c.base_mag) + g.mag * k + (e.MAG || 0),
    def: Number(c.base_def) + g.def * k + (e.DEF || 0),
    magic_def: Number(c.base_magic_def) + g.magic_def * k + (e.MAGIC_DEF || 0),
    crit: 10 + (PASSIVE_CRIT[c.code] || 0) + (e.CRIT_CHANCE || 0),
  };
}

async function simulate({ classes, gear, monsters }) {
  console.log('Equipo: set de Pradera (nv 1-5), de la Guardia (6-9), del Capitán (10-13), del Titán (14-15), con las stats NUEVAS.');
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
        const raw = sk.base + sk.mult * main;
        const dmg = Math.max(raw * DAMAGE_FLOOR, raw - 0.5 * (magic ? row.magic_def : row.def)) * (1 + Math.min(100, h.crit) / 100 * 0.5);
        const ttk = Math.ceil(row.hp / dmg);
        const monMagic = row.magic_atk > row.atk;
        const rawHit = 1.2 * (monMagic ? row.magic_atk : row.atk);
        const hit = Math.max(rawHit * DAMAGE_FLOOR, rawHit - 0.5 * (monMagic ? h.magic_def : h.def)) * (1 + row.crit_chance / 100 * 0.5);
        const ttd = Math.ceil(h.hp / hit);
        worstTtk = Math.max(worstTtk, ttk); worstTtd = Math.min(worstTtd, ttd);
      }
      cells.push(`nv${lv} ${worstTtk}/${worstTtd}`);
    }
    console.log(c.code.padEnd(10), cells.join('  '));
  }
  simulateCripta(classes, gear);
  await simulateMontanas(classes);
  await simulateMina(classes);
  // jefes y raros contra un grupo de 3 héroes promedio de su nivel
  console.log('\nRaros y jefes (nivel típico): vida / ataque / defensa');
  for (const m of monsters.filter((x) => x.rarity !== 'COMMON')) {
    const lv = m.min_spawn_level;
    const row = EQ.monsterRow(lv, m.rarity, PERFILES[m.code]);
    console.log(`${m.name} (${m.rarity}, nv ${lv}): ${row.hp} / ${Math.max(row.atk, row.magic_atk)} / ${row.def}`);
  }
}

// Montañas Grises (zona 2, nivel 16-30) con el equipo de la base: llega con el set del Titán (o sin él,
// con el del Capitán y luego el de Montañas), después Escarcha (21), Acantilado (26) y Rey (30).
// Meta: escala de 4 turnos (nv 16) a 5-6 (nv 30) y un común nunca gana el uno contra uno.
async function simulateMontanas(classes) {
  const rows = (await db.query(`SELECT i.id, i.code, i.class_id, i.slot, b.stat_code, b.amount
    FROM items i JOIN item_stat_bonuses b ON b.item_id = i.id
    WHERE i.item_type = 'EQUIPMENT' AND i.class_id <= 5 AND i.code ~ '_(CAPITAN|TITAN_P|MONTANAS|ESCARCHA|ACANT|REY_MONT)$'
      AND i.code !~ '(WEAPON2H|OFFHAND_CRYSTAL|ACCESSORY)'`)).rows;
  const sets = {};
  for (const r of rows) {
    const set = r.code.match(/_(CAPITAN|TITAN_P|MONTANAS|ESCARCHA|ACANT|REY_MONT)$/)[1];
    const g = ((sets[r.class_id] ??= {})[set] ??= { slots: new Set() });
    if (g.slots.has(r.slot) && !g.ids?.has(r.id)) continue;
    g.slots.add(r.slot); (g.ids ??= new Set()).add(r.id);
    g[r.stat_code] = (g[r.stat_code] || 0) + Number(r.amount);
  }
  const PATHS = {
    'con el set del Titán': (lv) => (lv >= 30 ? 'REY_MONT' : lv >= 26 ? 'ACANT' : lv >= 21 ? 'ESCARCHA' : 'TITAN_P'),
    'sin el set del Titán': (lv) => (lv >= 30 ? 'REY_MONT' : lv >= 26 ? 'ACANT' : lv >= 21 ? 'ESCARCHA' : lv >= 17 ? 'MONTANAS' : 'CAPITAN'),
  };
  const mons = (await db.query(`SELECT code, min_spawn_level mn, max_spawn_level mx FROM monsters WHERE zone_id = 2 AND rarity = 'COMMON'`)).rows;
  montanasGear = { sets, PATHS };
  console.log('\nMontañas Grises · turnos para matar / golpes que aguanta (peor común que vive a ese nivel). Meta: 4 → 5-6, nunca perder');
  for (const [name, path] of Object.entries(PATHS)) {
    console.log(`  ${name}`);
    for (const c of classes) {
      const cells = [16, 18, 20, 21, 23, 25, 26, 28, 30].map((lv) => {
        const g = EQ.CLASS_GROWTH[c.code]; const k = lv - 1; const e = sets[c.id]?.[path(lv)] ?? {};
        const h = {
          hp: Number(c.base_hp) + g.hp * k + (e.HP || 0), atk: Number(c.base_atk) + g.atk * k + (e.ATK || 0), mag: Number(c.base_mag) + g.mag * k + (e.MAG || 0),
          def: Number(c.base_def) + g.def * k + (e.DEF || 0), magic_def: Number(c.base_magic_def) + g.magic_def * k + (e.MAGIC_DEF || 0),
          crit: 10 + (PASSIVE_CRIT[c.code] || 0) + (e.CRIT_CHANCE || 0),
        };
        const sk = EQ.skillTier(10);
        const magic = EQ.MAIN_STAT[c.code] === 'mag';
        let ttk = 0; let ttd = 99;
        for (const m of mons.filter((x) => x.mn <= lv && x.mx >= lv)) {
          const row = EQ.monsterRow(lv, 'COMMON', PERFILES[m.code]);
          const raw = sk.base + sk.mult * h[EQ.MAIN_STAT[c.code]];
          const dmg = Math.max(raw * DAMAGE_FLOOR, raw - 0.5 * (magic ? row.magic_def : row.def)) * (1 + Math.min(100, h.crit) / 100 * 0.5);
          const mm = row.magic_atk > row.atk;
          const rh = 1.2 * (mm ? row.magic_atk : row.atk);
          const hit = Math.max(rh * DAMAGE_FLOOR, rh - 0.5 * (mm ? h.magic_def : h.def)) * (1 + row.crit_chance / 100 * 0.5);
          ttk = Math.max(ttk, Math.ceil(row.hp / dmg)); ttd = Math.min(ttd, Math.ceil(h.hp / hit));
        }
        return `nv${lv} ${ttk}/${ttd}`;
      });
      console.log(`  ${c.code.padEnd(10)} ${cells.join('  ')}`);
    }
  }
}

// el héroe de las Montañas a un nivel, con el equipo de ese camino (lo arma simulateMontanas)
let montanasGear = null;
function heroMontanas(c, lv, pathName = 'sin el set del Titán', weapon = null) {
  const { sets, PATHS } = montanasGear;
  const g = EQ.CLASS_GROWTH[c.code]; const k = lv - 1; const e = { ...(sets[c.id]?.[PATHS[pathName](lv)] ?? {}) };
  // otra arma (las de Hierro Negro): se cambia la del set por esa
  if (weapon) for (const [s, v] of Object.entries(weapon)) e[s] = (e[s] || 0) + v;
  return {
    hp: Number(c.base_hp) + g.hp * k + (e.HP || 0), atk: Number(c.base_atk) + g.atk * k + (e.ATK || 0), mag: Number(c.base_mag) + g.mag * k + (e.MAG || 0),
    def: Number(c.base_def) + g.def * k + (e.DEF || 0), magic_def: Number(c.base_magic_def) + g.magic_def * k + (e.MAGIC_DEF || 0),
    crit: 10 + (PASSIVE_CRIT[c.code] || 0) + (e.CRIT_CHANCE || 0),
  };
}

// Mina Profunda (lib/mina.js): igual que la Cripta pero con el equipo de las Montañas (nv 18-24).
// Además: los raros y jefes de la zona 2 contra el grupo de 3 a su nivel.
async function simulateMina(classes) {
  const mina = require('../../lib/mina');
  const rowAt = (m, lv) => {
    const [a, b] = m.scalings;
    const t = Math.max(0, Math.min(1, (lv - a.level) / (b.level - a.level)));
    const out = {};
    for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * t : a[k];
    return out;
  };
  const sk = EQ.skillTier(10);
  const heroHit = (c, h, row) => {
    const magic = EQ.MAIN_STAT[c.code] === 'mag';
    const raw = sk.base + sk.mult * h[EQ.MAIN_STAT[c.code]];
    return Math.max(raw * DAMAGE_FLOOR, raw - 0.5 * (magic ? row.magic_def : row.def)) * (1 + Math.min(100, h.crit) / 100 * 0.5);
  };
  const monHit = (row, h) => {
    const magic = row.magic_atk > row.atk;
    const raw = 1.2 * (magic ? row.magic_atk : row.atk);
    return Math.max(raw * DAMAGE_FLOOR, raw - 0.5 * (magic ? h.magic_def : h.def)) * (1 + row.crit_chance / 100 * 0.5);
  };
  const byCode = Object.fromEntries(mina.MONSTERS.map((m) => [m.code, m]));
  const LEVELS = [19, 21, 23, 25, 27];
  console.log('\nMina Profunda · guardianes contra un héroe solo: turnos para vencerlos / rondas que aguanta (meta: vence antes de caer)');
  for (const [key, g] of Object.entries(mina.GUARDIANES)) {
    const cells = LEVELS.map((lv) => {
      const per = classes.map((c) => {
        const h = heroMontanas(c, lv);
        const rows = g.monsters.map((code) => rowAt(byCode[code], lv));
        const ttk = rows.reduce((sum, r) => sum + Math.ceil(r.hp / heroHit(c, h, r)), 0);
        const ttd = Math.floor(h.hp / rows.reduce((sum, r) => sum + monHit(r, h), 0));
        return `${c.code.slice(0, 3)} ${ttk}/${ttd}`;
      });
      return `nv${lv}: ${per.join(' ')}`;
    });
    console.log(`${key.padEnd(13)} ${cells.join(' | ')}`);
  }
  const party = ['GUERRERO', 'MAGO', 'SACERDOTE'].map((code) => classes.find((c) => c.code === code));
  console.log('Guardianes contra guerrero + mago + sacerdote: rondas para vencerlos / rondas que aguanta el grupo');
  for (const [key, g] of Object.entries(mina.GUARDIANES)) {
    const cells = LEVELS.map((lv) => {
      const rows = g.monsters.map((code) => rowAt(byCode[code], lv));
      const heroes = party.map((c) => ({ c, h: heroMontanas(c, lv) }));
      const ttk = rows.reduce((sum, r) => sum + r.hp / heroes.reduce((t, x) => t + heroHit(x.c, x.h, r), 0), 0);
      const hpTotal = heroes.reduce((t, x) => t + x.h.hp, 0);
      const perRound = rows.reduce((sum, r) => sum + heroes.reduce((t, x) => t + monHit(r, x.h), 0) / heroes.length, 0);
      return `nv${lv}: ${Math.ceil(ttk)}/${Math.floor(hpTotal / perRound)}`;
    });
    console.log(`  ${key.padEnd(13)} ${cells.join(' | ')}`);
  }
  // el jefe pega a uno; además cada 3 rondas el derrumbe quita el 50% (8% si se cubrió)
  console.log('Gólem de Hierro Negro (nivel del héroe + 1) contra guerrero + mago + sacerdote: rondas para vencerlo / golpes que aguanta el guerrero');
  console.log('  ' + LEVELS.map((lv) => {
    const row = rowAt(byCode[mina.BOSS_CODE], lv + 1);
    const dmg = party.reduce((sum, c) => sum + heroHit(c, heroMontanas(c, lv), row), 0);
    const tank = heroMontanas(party[0], lv);
    return `nv${lv}: ${Math.ceil(row.hp / dmg)} rondas / ${Math.floor(tank.hp / monHit(row, tank))} golpes`;
  }).join(' | '));
  // un héroe solo contra el jefe (no es la idea, pero para saber cuánto se estira)
  console.log('  un héroe solo, nv 22: ' + classes.map((c) => {
    const row = rowAt(byCode[mina.BOSS_CODE], 23);
    const h = heroMontanas(c, 22);
    return `${c.code.slice(0, 3)} ${Math.ceil(row.hp / heroHit(c, h, row))}/${Math.floor(h.hp / monHit(row, h))}`;
  }).join(' '));

  // las armas de Hierro Negro (nv 22) contra la de Escarcha (nv 21): turnos para matar al peor común de nv 22
  const hn = (await db.query(`SELECT i.class_id, b.stat_code, b.amount FROM items i JOIN item_stat_bonuses b ON b.item_id = i.id
    WHERE i.code ~ '^[A-Z]+_WEAPON_(HIERRO_NEGRO|ESCARCHA)$'`)).rows;
  const esc = (await db.query(`SELECT i.class_id, b.stat_code, b.amount, i.code FROM items i JOIN item_stat_bonuses b ON b.item_id = i.id
    WHERE i.code ~ '^[A-Z]+_WEAPON_(HIERRO_NEGRO|ESCARCHA)$'`)).rows;
  const weaponOf = (cid, suf) => Object.fromEntries(esc.filter((r) => r.class_id === cid && r.code.endsWith(suf)).map((r) => [r.stat_code, Number(r.amount)]));
  const mons = (await db.query(`SELECT code FROM monsters WHERE zone_id = 2 AND rarity = 'COMMON' AND min_spawn_level <= 22 AND max_spawn_level >= 22`)).rows;
  console.log('Arma de Escarcha (nv 21) → de Hierro Negro (nv 22): turnos para matar al peor común de nv 22');
  console.log('  ' + classes.map((c) => {
    const ttk = (wpn) => {
      // el set de Escarcha con su arma cambiada por esta
      const base = weaponOf(c.id, '_ESCARCHA');
      const swap = Object.fromEntries(Object.keys({ ...base, ...wpn }).map((s) => [s, (wpn[s] || 0) - (base[s] || 0)]));
      const h = heroMontanas(c, 22, 'sin el set del Titán', swap);
      return Math.max(...mons.map((m) => Math.ceil(EQ.monsterRow(22, 'COMMON', PERFILES[m.code]).hp / heroHit(c, h, EQ.monsterRow(22, 'COMMON', PERFILES[m.code])))));
    };
    return `${c.code.slice(0, 3)} ${ttk(weaponOf(c.id, '_ESCARCHA'))}→${ttk(weaponOf(c.id, '_HIERRO_NEGRO'))}`;
  }).join('  '));
  void hn;

  // raros y jefes de la zona 2 contra el grupo de 3 a su nivel
  const tough = (await db.query(`SELECT code, name, rarity, min_spawn_level lv FROM monsters WHERE zone_id = 2 AND rarity <> 'COMMON' ORDER BY min_spawn_level`)).rows;
  console.log('Raros y jefes de las Montañas contra guerrero + mago + sacerdote a su nivel: rondas para vencerlo / golpes que aguanta el guerrero');
  for (const m of tough) {
    const row = EQ.monsterRow(m.lv, m.rarity, PERFILES[m.code]);
    const dmg = party.reduce((sum, c) => sum + heroHit(c, heroMontanas(c, m.lv), row), 0);
    const tank = heroMontanas(party[0], m.lv);
    console.log(`  ${m.name} (${m.rarity}, nv ${m.lv}): ${Math.ceil(row.hp / dmg)} rondas / ${Math.floor(tank.hp / monHit(row, tank))} golpes`);
  }
}

// Cripta del Vigía (lib/cripta.js): los guardianes pelean en grupos de 2-3 a tu nivel y el Vigía
// Caído a tu nivel + 1. Guardianes: un héroe solo (turnos para vencer al grupo / rondas que aguanta
// recibiendo todos los golpes). Jefe: grupo de 3 (guerrero, mago y sacerdote).
function simulateCripta(classes, gear) {
  const cripta = require('../../lib/cripta');
  const rowAt = (m, lv) => {
    const [a, b] = m.scalings;
    const t = Math.max(0, Math.min(1, (lv - a.level) / (b.level - a.level)));
    const out = {};
    for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * t : a[k];
    return out;
  };
  const byCode = Object.fromEntries(cripta.MONSTERS.map((m) => [m.code, m]));
  const heroHit = (c, h, lv, row) => {
    const sk = EQ.skillTier(lv >= 10 ? 10 : lv >= 5 ? 5 : 1);
    const magic = EQ.MAIN_STAT[c.code] === 'mag';
    const raw = sk.base + sk.mult * h[EQ.MAIN_STAT[c.code]];
    return Math.max(raw * DAMAGE_FLOOR, raw - 0.5 * (magic ? row.magic_def : row.def)) * (1 + Math.min(100, h.crit) / 100 * 0.5);
  };
  const monHit = (row, h) => {
    const magic = row.magic_atk > row.atk;
    const raw = 1.2 * (magic ? row.magic_atk : row.atk);
    return Math.max(raw * DAMAGE_FLOOR, raw - 0.5 * (magic ? h.magic_def : h.def)) * (1 + row.crit_chance / 100 * 0.5);
  };
  console.log('\nCripta del Vigía · guardianes contra un héroe solo: turnos para vencerlos / rondas que aguanta (meta: vence antes de caer)');
  for (const [key, g] of Object.entries(cripta.GUARDIANES)) {
    const cells = [];
    for (const lv of [7, 10, 12, 14]) {
      const per = classes.map((c) => {
        const h = heroAt(c, lv, gear);
        const rows = g.monsters.map((code) => rowAt(byCode[code], lv));
        const ttk = rows.reduce((sum, r) => sum + Math.ceil(r.hp / heroHit(c, h, lv, r)), 0);
        const ttd = Math.floor(h.hp / rows.reduce((sum, r) => sum + monHit(r, h), 0));
        return `${c.code.slice(0, 3)} ${ttk}/${ttd}`;
      });
      cells.push(`nv${lv}: ${per.join(' ')}`);
    }
    console.log(`${key.padEnd(17)} ${cells.join(' | ')}`);
  }
  const party = ['GUERRERO', 'MAGO', 'SACERDOTE'].map((code) => classes.find((c) => c.code === code));
  // el grupo de 3 contra cada grupo de guardianes: rondas para vencerlos / rondas que aguanta el grupo
  // (los golpes se reparten entre los tres; sin contar curas ni pociones)
  console.log('Guardianes contra guerrero + mago + sacerdote: rondas para vencerlos / rondas que aguanta el grupo');
  for (const [key, g] of Object.entries(cripta.GUARDIANES)) {
    const cells = [];
    for (const lv of [7, 10, 12, 14]) {
      const rows = g.monsters.map((code) => rowAt(byCode[code], lv));
      const heroes = party.map((c) => ({ c, h: heroAt(c, lv, gear) }));
      const ttk = rows.reduce((sum, r) => sum + r.hp / heroes.reduce((t, x) => t + heroHit(x.c, x.h, lv, r), 0), 0);
      const hpTotal = heroes.reduce((t, x) => t + x.h.hp, 0);
      const perRound = rows.reduce((sum, r) => sum + heroes.reduce((t, x) => t + monHit(r, x.h), 0) / heroes.length, 0);
      cells.push(`nv${lv}: ${Math.ceil(ttk)}/${Math.floor(hpTotal / perRound)}`);
    }
    console.log(`  ${key.padEnd(17)} ${cells.join(' | ')}`);
  }
  console.log('Vigía Caído (nivel del héroe + 1) contra guerrero + mago + sacerdote: rondas para vencerlo / golpes que aguanta el guerrero');
  const cells = [];
  for (const lv of [7, 10, 12, 14]) {
    const row = rowAt(byCode[cripta.BOSS_CODE], lv + 1);
    const dmg = party.reduce((sum, c) => sum + heroHit(c, heroAt(c, lv, gear), lv, row), 0);
    const tank = heroAt(party[0], lv, gear);
    cells.push(`nv${lv}: ${Math.ceil(row.hp / dmg)} rondas / ${Math.floor(tank.hp / monHit(row, tank))} golpes`);
  }
  console.log('  ' + cells.join(' | '));
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
  parts.push('-- monstruos de la Pradera (filas en su nivel mínimo, en el 9 y en el 15: la curva es lineal entre filas)');
  for (const m of monsters) {
    const rows = [m.min_spawn_level, EQ.HP_KNEE_LEVEL, 15].filter((v, i, a) => v >= m.min_spawn_level && a.indexOf(v) === i).map((lv) => EQ.monsterRow(lv, m.rarity, PERFILES[m.code]));
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
    // por nivel o enseñadas por el maestro desde un nivel: valor del tramo de ese nivel
    if (sk.learn_method === 'LEVEL' || (sk.learn_method === 'GOLD' && sk.learn_level != null)) {
      const t = EQ.skillTier(sk.learn_level ?? 1);
      const f = sk.target_type === 'ALL_ENEMIES' || sk.target_type === 'ALL_ALLIES' ? EQ.AOE_FACTOR : 1;
      v = { base: Math.round(t.base * f), mult: Math.round(t.mult * f * 100) / 100 };
    } else {
      v = EQ.specialSkill(sk);
    }
    parts.push(`UPDATE skills SET base_value = ${v.base}, scaling_multiplier = ${sqlNum(v.mult)} WHERE code = '${sk.code}';`);
  }

  // equipo de la Pradera por fórmula (lib/equilibrio.js itemStats): se escriben TODAS las stats que
  // maneja la fórmula (no solo las que cambian), así el bloque deja lo mismo en cualquier base, tenga
  // o no aplicada la versión anterior
  parts.push('-- equipo de nivel 1-15 de las clases base: stats por fórmula según su nivel y rareza');
  for (const it of data.items) {
    for (let i = 0; i < it.stats.length; i += 1) {
      const before = Number(it.stats[i].amount); const after = Number(it.newStats[i].amount);
      // por código de objeto y stat (los id de item_stat_bonuses cambian entre bases)
      if (it.newStats[i] !== it.stats[i]) parts.push(`UPDATE item_stat_bonuses b SET amount = ${sqlNum(after)} FROM items i WHERE i.id = b.item_id AND i.code = '${it.code}' AND b.stat_code = '${it.stats[i].stat_code}' AND b.is_percent = ${it.stats[i].is_percent ? 'TRUE' : 'FALSE'}; -- ${before} -> ${after}`);
    }
  }

  // las stats guardadas de jugadores y compañeros se recalculan solas (lib/equilibrio.js)
  parts.push('-- pide recalcular las stats guardadas de jugadores y compañeros (lo hace el servidor)');
  parts.push(`CREATE TABLE IF NOT EXISTS balance_versions (version TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_at TIMESTAMPTZ);
INSERT INTO balance_versions (version) SELECT 'pradera_v1' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_v1');
INSERT INTO balance_versions (version) SELECT 'pradera_equipo_v1' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_equipo_v1');
INSERT INTO balance_versions (version) SELECT 'pradera_v2' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_v2');`);
  return parts.join('\n');
}

const CLASS_IDS_BY_ID = Object.fromEntries(Object.entries(CLASS_IDS).map(([k, v]) => [v, k]));

(async () => {
  const data = await loadData();
  if (process.argv.includes('--simular')) await simulate(data);
  if (process.argv.includes('--sql')) process.stdout.write(`${await buildSql(data)}
`);
  process.exit();
})().catch((err) => { console.error(err); process.exit(1); });

module.exports = { PERFILES, CLASS_IDS };
