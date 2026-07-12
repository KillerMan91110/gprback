// recalc_stats.js
// Recalcula base_* de classes y *_per_level de class_growths para las 95 clases evolucionadas.
// Cadena: R1 toma de clase base ×1.25 (principal ×1.30)
//         R2 toma de R1 ×1.20 (principal ×1.28)
//         R3 toma de R2 ×1.23 (principal ×1.33)
// crit_chance y evasion no crecen por nivel; se mejoran solo con items/pasivas.
//
// Uso: node recalc_stats.js          → dry run
//      node recalc_stats.js --write  → aplica cambios en la DB

const { Pool } = require('pg');
require('dotenv').config({ path: 'c:\\Users\\meroc\\OneDrive\\Documentos\\Proyecto\\PKM\\gprback\\.env' });

const db = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});

const WRITE = process.argv[2] === '--write';

const TIER_MULT   = { 1: 1.25, 2: 1.20, 3: 1.23 };
const PRIN_BONUS  = { 1: 0.05, 2: 0.08, 3: 0.10 };
const SEC_BONUS   = { 1: 0.025, 2: 0.04, 3: 0.05 }; // secundaria = mitad del bono principal
const SCALE = ['hp', 'atk', 'def', 'mag', 'magic_def', 'spd', 'mana'];

// Stat principal por ID de clase — basado en nombre + temática.
// Puede ser string (1 principal) o [principal, secundaria].
// Secundaria recibe la mitad del bono: R1 +2.5%, R2 +4%, R3 +5%.
const CLASS_PRINCIPAL = {
  // ── R1: GUERRERO ──────────────────────────────────────────────────────────
  6:  ['def', 'atk'], // Monje             — equilibrio golpe/defensa
  7:  'atk',          // Espadachín        — espadachín puro
  8:  'def',          // Caballero         — defensa pura
  9:  'atk',          // Berserker         — daño bruto
  10: ['mag', 'atk'], // Guerrero Magus    — híbrido mago-guerrero

  // ── R1: MAGO ──────────────────────────────────────────────────────────────
  12: 'mag',      // Nigromante        — magia oscura
  13: 'mag',      // Invocador         — invocación (mag)
  14: 'mag',      // Elemental         — daño elemental mágico
  15: 'mag',      // Mago Divino       — poder mágico supremo

  // ── R1: ESPECIALISTAS ELEMENTALES (branch del Mago) ───────────────────────
  31: 'mag',      // Mago Piromántico  — fuego
  32: 'mag',      // Mago Criomántico  — hielo
  33: 'mag',      // Mago Electromántico — rayo
  34: 'mag',      // Mago Hidromante   — agua
  35: 'mag',      // Mago Geomántico   — tierra
  36: 'spd',      // Mago Aeromante    — viento = velocidad (tropo clásico)
  37: 'mag',      // Mago Luminoso     — luz sagrada

  // ── R1: ARQUERO ──────────────────────────────────────────────────────────
  16: 'atk',           // Cazador           — precisión física
  17: 'atk',           // Francotirador     — penetración máxima
  18: ['atk', 'spd'],  // Ranger            — versatilidad: daño + velocidad
  19: ['mag', 'spd'],  // Asesino Arcano    — magia crítica + velocidad
  20: ['mag', 'spd'],  // Elfo Silvestre    — magia de bosque + agilidad élfica

  // ── R1: PÍCARO ───────────────────────────────────────────────────────────
  21: 'spd',      // Ninja             — velocidad pura
  22: 'atk',      // Asesino           — letalidad de ataque
  23: 'spd',      // Ladrón Maestro    — agilidad para robar
  24: 'spd',      // Envenenador       — aplica veneno gracias a la velocidad
  25: 'mag',      // Especialista en Trampas — control/ingenio mágico

  // ── R1: SACERDOTE ────────────────────────────────────────────────────────
  26: 'mag',      // Clérigo           — curación mágica
  27: 'mag',      // Druida            — magia de la naturaleza
  28: ['magic_def', 'def'], // Templario    — escudo mágico + armadura física
  29: 'mag',      // Sanador Divino    — curación suprema
  30: 'magic_def',// Inquisidor        — anti-magia = resistencia mágica

  // ── R2: GUERRERO ──────────────────────────────────────────────────────────
  38: 'def',      // Maestro Monje         — dominio defensivo del puño
  39: 'atk',      // Monje Oscuro          — puño oscuro, golpe ofensivo
  40: 'atk',      // Monje Sísmico         — puño sísmico, golpes que sacuden la tierra
  41: 'mag',      // Monje Divino          — poder divino/espiritual
  43: 'atk',      // Maestro Espadachín    — espada maestra
  44: 'atk',      // Caballero Oscuro      — espada oscura ofensiva
  45: 'def',      // Paladín               — defensa sagrada
  47: 'def',      // Paladín Oscuro        — defensa corrupta, sigue siendo tanque
  48: 'def',      // Caballero Blindado    — armadura de titán
  50: 'atk',      // Titán Furioso         — furia bruta
  51: 'atk',      // Berserker del Caos    — furia oscura caótica
  52: ['mag', 'atk'], // Mago Espada       — híbrido: magia + espada
  53: 'mag',          // Arqueólogo Mágico — saber arcano ancestral

  // ── R2: MAGO ─────────────────────────────────────────────────────────────
  54: 'mag',      // Rey Nigromante        — oscuridad suprema
  55: 'mag',      // Lich                  — inmortalidad arcana (trasciende la muerte por magia)
  56: 'mag',      // Invocador Demoníaco   — pactos oscuros mágicos
  57: 'mag',      // Invocador Celestial   — aliados divinos mágicos
  58: 'mag',      // Invocador Salvaje     — sigue siendo invocador (mag) con bestias
  59: 'mag',      // Maestro Elemental     — dominio total elemental
  60: 'mag',      // Mago Cósmico          — poder cósmico arcano
  61: 'mag',      // Mago Estelar          — poder estelar

  // ── R2: ARQUERO ──────────────────────────────────────────────────────────
  62: 'spd',      // Francotirador Fantasmal — sigilo letal, velocidad fantasmal
  63: 'atk',      // Tirador Explosivo     — flechas explosivas, daño en área
  64: 'atk',      // Tirador de Veneno     — disparo físico + veneno
  65: 'atk',      // Maestro del Arco      — precisión suprema
  66: 'mag',      // Arquero Celestial     — flechas de luz sagrada
  67: 'atk',      // Ballestero            — disparo pesado físico
  68: 'mag',      // Arquero del Rayo      — flechas de rayo elemental
  69: 'atk',      // Maestro Cazador       — caza suprema
  70: 'mag',      // Elfo Antiguo          — sabiduría élfica ancestral
  71: 'mag',      // Ranger Primordial     — naturaleza pura mágica
  72: 'def',      // Guardián Silvestre    — protector del bosque, defensivo
  73: 'mag',      // Maestro Asesino Oscuro — sombra arcana mágica

  // ── R2: PÍCARO ───────────────────────────────────────────────────────────
  75: 'atk',      // Maestro Asesino       — golpe perfecto
  76: 'atk',      // Asesino de Élite      — cazador de jefes, daño máximo
  77: 'spd',      // Maestro Envenenador   — aplica toxinas con velocidad
  78: 'spd',      // Ninja Maestro         — sombra perfecta, velocidad suprema
  79: ['atk', 'spd'], // Ninja Sombra      — técnica oscura: golpe rápido y certero
  80: 'spd',      // Ladrón Legendario     — saqueo legendario, agilidad
  81: 'spd',      // Saqueador de Tesoros  — cazatesoros, velocidad
  82: 'atk',      // Mercenario            — combate a sueldo, ATK directo
  83: 'spd',      // Explorador de Mazmorras — navegación y exploración rápida
  84: 'spd',      // Maestro del Sigilo    — sigilo absoluto
  85: 'spd',      // Buscador de Trampas   — detección ágil y precisa
  86: ['mag', 'atk'], // Pícaro Elemental  — filo elemental: magia + golpe
  87: 'spd',      // Acróbata              — evasión perfecta, agilidad pura

  // ── R2: SACERDOTE ────────────────────────────────────────────────────────
  88: 'mag',      // Obispo                — curación mayor
  90: 'mag',      // Druida Primordial     — naturaleza ancestral
  91: 'def',      // Protector del Bosque  — guardián natural, defensivo
  92: ['def', 'magic_def'], // Caballero Templario — armadura física + escudo mágico
  93: 'def',              // Paladín Divino        — fe suprema, defensa divina
  94: ['magic_def', 'mag'], // Gran Inquisidor     — purga mágica + poder sagrado
  95: 'mag',      // Asceta                — meditación total = poder espiritual
  96: 'mag',      // Exorcista             — purificación mágica sagrada
  97: 'mag',      // Bendito               — bendición eterna divina
  98: 'mag',      // Herbolario Sagrado    — alquimia sagrada
  99: 'mag',      // Sacerdote del Caos    — fe corrompida, magia oscura

  // ── R3 ────────────────────────────────────────────────────────────────────
  42: 'def',      // Maestro Monje Supremo — cúspide defensiva del monje
  46: 'def',      // Caballero Sagrado     — defensa celestial máxima
  49: 'hp',       // Dragón Caballero      — sangre de dragón = vitalidad/resistencia
  74: 'mag',      // Elfo Señor del Bosque — corona ancestral, magia élfica suprema
  89: 'mag',      // Sanador Legendario    — milagro divino
  100: 'mag',     // Apóstol               — fe inquebrantable divina
  101: 'mag',     // Vidente               — visión del futuro, adivinación
};

// Devuelve [primary, secondary|null]
function principal(id, name) {
  const p = CLASS_PRINCIPAL[id];
  if (!p) { console.warn(`  ⚠ Sin mapeo para clase ${id} "${name}" → ATK`); return ['atk', null]; }
  return Array.isArray(p) ? [p[0], p[1]] : [p, null];
}

function statMult(s, prin, mult, bonus, secBonus) {
  if (s === prin[0]) return mult + bonus;
  if (prin[1] && s === prin[1]) return mult + secBonus;
  return mult;
}

async function main() {
  const { rows: classes } = await db.query(
    'SELECT id, name, role, base_hp, base_atk, base_def, base_mag, base_magic_def, base_spd, base_mana FROM classes ORDER BY id'
  );
  const live = {};
  for (const c of classes) live[c.id] = { ...c };

  const { rows: evos } = await db.query('SELECT class_id, evolves_to_class_id FROM class_evolutions');
  const parentOf = {};
  for (const e of evos) parentOf[e.evolves_to_class_id] = e.class_id;

  const BASE_IDS = new Set([1, 2, 3, 4, 5]);
  function tier(id) {
    if (BASE_IDS.has(id)) return 0;
    let t = 0, cur = id;
    while (!BASE_IDS.has(cur)) { cur = parentOf[cur]; t++; if (t > 10) break; }
    return t;
  }

  const { rows: growthRows } = await db.query('SELECT * FROM class_growths ORDER BY class_id, level_from');
  const liveGrowth = {};
  for (const g of growthRows) liveGrowth[g.class_id] = { ...g };

  const classUpdates = [];
  const growthUpdates = [];

  for (let t = 1; t <= 3; t++) {
    const mult    = TIER_MULT[t];
    const bonus   = PRIN_BONUS[t];
    const secBon  = SEC_BONUS[t];

    for (const cls of classes) {
      if (tier(cls.id) !== t) continue;

      const pid  = parentOf[cls.id];
      const par  = live[pid];
      const prin = principal(cls.id, cls.name);

      const upd = { id: cls.id };
      for (const s of SCALE) {
        const col = `base_${s}`;
        upd[col] = Math.round(Number(par[col]) * statMult(s, prin, mult, bonus, secBon));
      }
      live[cls.id] = { ...live[cls.id], ...upd };
      classUpdates.push(upd);

      const pg = liveGrowth[pid];
      const cg = liveGrowth[cls.id];
      if (!pg || !cg) { console.warn(`  ⚠ Sin growth para clase ${cls.id} o su padre ${pid}`); continue; }

      const gudp = { id: cg.id };
      for (const s of SCALE) {
        const col = `${s}_per_level`;
        gudp[col] = Math.round(Number(pg[col]) * statMult(s, prin, mult, bonus, secBon) * 100) / 100;
      }
      liveGrowth[cls.id] = { ...liveGrowth[cls.id], ...gudp };
      growthUpdates.push(gudp);
    }
  }

  console.log(`\nClases a actualizar: ${classUpdates.length}`);
  console.log(`Growth rows a actualizar: ${growthUpdates.length}\n`);

  const tierLabel = (id) => `R${tier(id)}`;
  for (const u of classUpdates) {
    const c = classes.find(x => x.id === u.id);
    const prin = principal(c.id, c.name);
    const prinLabel = prin[1] ? `${prin[0]}+${prin[1]}` : prin[0];
    console.log(`  [${tierLabel(u.id)}] ${String(u.id).padStart(3)} ${c.name.padEnd(26)} ${prinLabel.padEnd(14)} HP=${String(u.base_hp).padStart(4)} ATK=${String(u.base_atk).padStart(3)} DEF=${String(u.base_def).padStart(3)} MAG=${String(u.base_mag).padStart(3)} MDEF=${String(u.base_magic_def).padStart(3)} SPD=${String(u.base_spd).padStart(3)} MANA=${String(u.base_mana).padStart(4)}`);
  }

  if (!WRITE) {
    console.log('\nDry run — pasá --write para aplicar.');
    await db.end(); return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const u of classUpdates) {
      await client.query(
        `UPDATE classes SET base_hp=$1, base_atk=$2, base_def=$3, base_mag=$4,
           base_magic_def=$5, base_spd=$6, base_mana=$7 WHERE id=$8`,
        [u.base_hp, u.base_atk, u.base_def, u.base_mag, u.base_magic_def, u.base_spd, u.base_mana, u.id]
      );
    }
    for (const g of growthUpdates) {
      await client.query(
        `UPDATE class_growths SET hp_per_level=$1, atk_per_level=$2, def_per_level=$3,
           mag_per_level=$4, magic_def_per_level=$5, spd_per_level=$6,
           mana_per_level=$7 WHERE id=$8`,
        [g.hp_per_level, g.atk_per_level, g.def_per_level, g.mag_per_level,
         g.magic_def_per_level, g.spd_per_level, g.mana_per_level, g.id]
      );
    }

    await client.query('COMMIT');
    console.log('\n✓ DB actualizada.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR — rollback:', err.message);
  } finally {
    client.release();
  }

  await db.end();
}

main().catch(console.error);
