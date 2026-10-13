// Colección del cazador: bestiario con metas (estilo Tibia), amuletos que se compran con los
// puntos del bestiario y cartas de monstruo que se engarzan en las ranuras del equipo (estilo
// Ragnarok). Todo da bonos de UTILIDAD (oro, experiencia, botín, recuperarse, aguantar), nunca
// ataque puro, para no romper el equilibrio del equipo.
const db = require('../db/db');

const SLOTS = ['WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY'];
const MYTHIC_PREFIX = 'MITICO_';
const isMythic = (code) => !!code?.startsWith(MYTHIC_PREFIX);
const rarityOf = (m) => (isMythic(m.code) ? 'MYTHIC' : m.rarity || 'COMMON');

// muertes para cada etapa de la ficha: 1 = estadísticas, 2 = botín, 3 = dominado (puntos)
const THRESHOLDS = { COMMON: [20, 75, 200], RARE: [10, 30, 80], MINIBOSS: [2, 6, 15], LEGENDARY: [1, 3, 8], MYTHIC: [1, 2, 3] };
const POINTS = { COMMON: 5, RARE: 10, MINIBOSS: 20, LEGENDARY: 40, MYTHIC: 60 };

// ---- cartas: el efecto sale de la categoría del monstruo y la fuerza de su rareza
const CARD_EFFECT_BY_CATEGORY = {
  BESTIA: 'drop', INSECTOIDE: 'drop', HUMANOIDE: 'gold', DEMONIO: 'gold', ESPECTRO: 'xp',
  MUERTO_VIVIENTE: 'xp', ACUATICO: 'regen', ELEMENTAL: 'mana', DRACOIDE: 'guard', COSMICO: 'card',
};
// algunos monstruos tienen su propia carta (más variedad que la de su categoría)
const CARD_EFFECT_BY_CODE = { CRIPTA_CENTINELA: 'guard', CRIPTA_ESPECTRO: 'mana', CRIPTA_VIGIA: 'regen' };
const CARD_POWER = { COMMON: 1, RARE: 2, MINIBOSS: 3, LEGENDARY: 5, MYTHIC: 5 };
const EFFECT_SCALE = { drop: 2, gold: 1.5, xp: 1, regen: 2, mana: 2, guard: 0.6, card: 10 };
const EFFECTS = {
  gold: { label: 'Fortuna', text: (v) => `+${v}% de oro en combate` },
  xp: { label: 'Sabiduría', text: (v) => `+${v}% de experiencia en combate` },
  drop: { label: 'Rastro', text: (v) => `+${v}% de probabilidad de botín` },
  regen: { label: 'Respiro', text: (v) => `Recuperas ${v}% de vida al ganar` },
  mana: { label: 'Serenidad', text: (v) => `Recuperas ${v}% de maná al ganar` },
  guard: { label: 'Aguante', text: (v) => `-${v}% de daño recibido` },
  card: { label: 'Coleccionista', text: (v) => `+${v}% de probabilidad de carta` },
};
// probabilidad base (%) de que un monstruo suelte su carta
const CARD_DROP = { COMMON: 0.25, RARE: 0.5, MINIBOSS: 2, LEGENDARY: 4, MYTHIC: 0 };
// solo para probar en local: CARD_DROP_MULT=100 hace que salgan casi siempre
const CARD_DROP_MULT = Number(process.env.CARD_DROP_MULT || 1);

function cardOf(m) {
  const rarity = rarityOf(m);
  if (rarity === 'MYTHIC') {
    // la carta mítica reparte un poco de todo
    return { effect: 'mitico', label: 'Reliquia mítica', value: 5, effects: { gold: 5, xp: 5, drop: 5 }, text: '+5% de oro, experiencia y botín' };
  }
  const effect = CARD_EFFECT_BY_CODE[m.code] ?? CARD_EFFECT_BY_CATEGORY[m.category] ?? 'drop';
  const value = Math.round(CARD_POWER[rarity] * EFFECT_SCALE[effect] * 10) / 10;
  return { effect, label: EFFECTS[effect].label, value, effects: { [effect]: value }, text: EFFECTS[effect].text(value) };
}

// ---- amuletos (se compran con los puntos de las fichas dominadas)
const CHARMS = [
  { code: 'bolsa', name: 'Bolsa del Mercader', effect: 'gold', per: [2, 4, 6], cost: [15, 30, 50] },
  { code: 'pluma', name: 'Pluma del Erudito', effect: 'xp', per: [2, 4, 6], cost: [15, 30, 50] },
  { code: 'ojo', name: 'Ojo del Rastreador', effect: 'drop', per: [4, 8, 12], cost: [15, 30, 50] },
  { code: 'trebol', name: 'Trébol del Coleccionista', effect: 'card', per: [20, 40, 60], cost: [20, 40, 60] },
  { code: 'hoja', name: 'Hoja de Respiro', effect: 'regen', per: [5, 10, 15], cost: [10, 25, 40] },
];

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_bestiary (
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      kills      INTEGER NOT NULL DEFAULT 0,
      completed  BOOLEAN NOT NULL DEFAULT FALSE,
      PRIMARY KEY (player_id, monster_id)
    );
    CREATE TABLE IF NOT EXISTS player_charm_points (
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      earned    INTEGER NOT NULL DEFAULT 0,
      spent     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS player_charms (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      code      TEXT NOT NULL,
      level     SMALLINT NOT NULL DEFAULT 0,
      PRIMARY KEY (player_id, code)
    );
    CREATE TABLE IF NOT EXISTS player_cards (
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      quantity   INTEGER NOT NULL DEFAULT 0,
      first_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, monster_id)
    );
    CREATE TABLE IF NOT EXISTS player_card_sockets (
      player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      slot       TEXT NOT NULL CHECK (slot IN ('WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY')),
      monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
      PRIMARY KEY (player_id, slot)
    );
    -- las cartas también se venden en el mercado (exactamente uno de ítem, mascota o carta)
    ALTER TABLE player_market_listings ADD COLUMN IF NOT EXISTS card_monster_id INTEGER REFERENCES monsters(id);
    ALTER TABLE player_market_listings DROP CONSTRAINT IF EXISTS chk_listing_target;
    ALTER TABLE player_market_listings ADD CONSTRAINT chk_listing_target CHECK (
      (item_id IS NOT NULL)::int + (player_pet_id IS NOT NULL)::int + (card_monster_id IS NOT NULL)::int = 1
    );
    -- lo ya cazado antes de que existiera el contador cuenta como 1 muerte
    INSERT INTO player_bestiary (player_id, monster_id, kills)
      SELECT player_id, monster_id, 1 FROM player_monster_kills
      ON CONFLICT DO NOTHING;`).catch((err) => { ready = null; throw err; });
  return ready;
}

const stageOf = (kills, t) => (kills >= t[2] ? 3 : kills >= t[1] ? 2 : kills >= t[0] ? 1 : 0);

// Suma las muertes de esta pelea a la ficha de cada jugador. Devuelve, por jugador, las fichas
// que subieron de etapa (para avisarlo en la pantalla de victoria).
async function registerKills(playerIds, enemies, { includeMythic = false } = {}) {
  const ids = [...new Set(playerIds)].filter(Boolean);
  const counts = new Map();
  for (const e of enemies) {
    if (!e.monster_code || (isMythic(e.monster_code) && !includeMythic)) continue;
    counts.set(e.monster_code, (counts.get(e.monster_code) || 0) + 1);
  }
  const out = new Map(ids.map((id) => [id, []]));
  if (!ids.length || !counts.size) return out;
  await ensureTables();
  const mons = await db.query('SELECT id, code, name, rarity FROM monsters WHERE code = ANY($1::text[])', [[...counts.keys()]]);
  for (const m of mons.rows) {
    const n = counts.get(m.code);
    const rarity = rarityOf(m);
    const t = THRESHOLDS[rarity] ?? THRESHOLDS.COMMON;
    for (const pid of ids) {
      const r = await db.query(
        `INSERT INTO player_bestiary (player_id, monster_id, kills) VALUES ($1, $2, $3)
         ON CONFLICT (player_id, monster_id) DO UPDATE SET kills = player_bestiary.kills + EXCLUDED.kills
         RETURNING kills, completed`,
        [pid, m.id, n]
      );
      const { kills, completed } = r.rows[0];
      const before = stageOf(kills - n, t);
      const after = stageOf(kills, t);
      if (after > before) out.get(pid).push({ monsterId: m.id, name: m.name, stage: after, points: after === 3 ? POINTS[rarity] : 0 });
      if (after === 3 && !completed) {
        await db.query('UPDATE player_bestiary SET completed = TRUE WHERE player_id = $1 AND monster_id = $2', [pid, m.id]);
        await db.query(
          `INSERT INTO player_charm_points (player_id, earned) VALUES ($1, $2)
           ON CONFLICT (player_id) DO UPDATE SET earned = player_charm_points.earned + EXCLUDED.earned`,
          [pid, POINTS[rarity]]
        );
      }
    }
  }
  return out;
}

// Bonos de utilidad del jugador: amuletos + cartas engarzadas (en %)
async function utilityBonuses(playerId) {
  const total = { gold: 0, xp: 0, drop: 0, regen: 0, mana: 0, guard: 0, card: 0 };
  try {
    await ensureTables();
    const [charms, cards] = await Promise.all([
      db.query('SELECT code, level FROM player_charms WHERE player_id = $1 AND level > 0', [playerId]),
      db.query(
        `SELECT m.code, m.rarity, m.category FROM player_card_sockets s JOIN monsters m ON m.id = s.monster_id WHERE s.player_id = $1`,
        [playerId]
      ),
    ]);
    for (const c of charms.rows) {
      const def = CHARMS.find((d) => d.code === c.code);
      if (def) total[def.effect] += def.per[c.level - 1] ?? 0;
    }
    for (const m of cards.rows) {
      for (const [k, v] of Object.entries(cardOf(m).effects)) total[k] += v;
    }
  } catch { /* sin bonos */ }
  total.guard = Math.min(total.guard, 25);
  return total;
}

// Tira la carta de cada monstruo derrotado (una tirada por monstruo y por héroe)
async function rollCards(playerId, enemies, cardBonusPct = 0) {
  const codes = [...new Set(enemies.map((e) => e.monster_code).filter((c) => c && !isMythic(c)))];
  if (!codes.length) return [];
  await ensureTables();
  const mons = await db.query('SELECT id, code, name, rarity, category FROM monsters WHERE code = ANY($1::text[])', [codes]);
  const byCode = new Map(mons.rows.map((m) => [m.code, m]));
  const got = [];
  for (const e of enemies) {
    const m = byCode.get(e.monster_code);
    if (!m) continue;
    const chance = (CARD_DROP[rarityOf(m)] ?? 0) * CARD_DROP_MULT * (1 + cardBonusPct / 100);
    if (Math.random() * 100 < chance) {
      await giveCard(playerId, m.id);
      got.push({ monsterId: m.id, code: m.code, name: m.name, rarity: rarityOf(m), ...cardOf(m) });
    }
  }
  return got;
}

async function giveCard(playerId, monsterId, qty = 1, client = db) {
  await client.query(
    `INSERT INTO player_cards (player_id, monster_id, quantity) VALUES ($1, $2, $3)
     ON CONFLICT (player_id, monster_id) DO UPDATE SET quantity = player_cards.quantity + EXCLUDED.quantity`,
    [playerId, monsterId, qty]
  );
}

// Lo que pasa al ganar una pelea con los bonos de respiro/serenidad
async function applyVictoryRecovery(playerId, bonus) {
  if (!bonus.regen && !bonus.mana) return;
  await db.query(
    `UPDATE players SET
       hp = LEAST(max_hp, hp + CEIL(max_hp * $1 / 100.0)::int),
       mana = LEAST(max_mana, mana + CEIL(max_mana * $2 / 100.0)::int)
     WHERE id = $3 AND hp > 0`,
    [bonus.regen, bonus.mana, playerId]
  );
}

module.exports = {
  SLOTS, CHARMS, THRESHOLDS, POINTS, EFFECTS, CARD_DROP, MYTHIC_PREFIX,
  isMythic, rarityOf, cardOf, stageOf, ensureTables,
  registerKills, utilityBonuses, rollCards, giveCard, applyVictoryRecovery,
};
