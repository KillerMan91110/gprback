// Guía del aventurero: la primera hora en el mundo 2D, paso a paso (hablar con Tomás, abrir la
// mochila, el Pilar, la piedra de regreso, salir por la Puerta Sur, el primer combate, recoger un
// recurso y llegar a la Aldea Espiga). Cada paso da una recompensa chica una sola vez. A los
// jugadores nuevos de verdad (nivel 1-2 al empezar) la barra del HUD se les va "encendiendo" a
// medida que avanzan (`progressive`); quien ya jugaba antes la ve completa como siempre.
const db = require('../db/db');
const leveling = require('./leveling');
const { cercaDe } = require('./cercania');
const piedra = require('./piedraRegreso');

const STEPS = [
  { id: 'tomas', title: 'Habla con Tomás', text: 'Tomás, el guía de Aurelia, te espera cerca de la plaza. Acércate y pulsa E.', gold: 30, xp: 40, unlocks: ['misiones', 'mapa'] },
  { id: 'mochila', title: 'Revisa tu mochila', text: 'Abre la mochila con la tecla I o con su botón de la barra.', gold: 20, xp: 30, unlocks: ['personaje'] },
  { id: 'pilar', title: 'Visita el Pilar de Aethra', text: 'Acércate al Pilar del centro de la plaza: si caes en combate, despertarás aquí.', gold: 30, xp: 40, unlocks: ['social'] },
  { id: 'piedra', title: 'Vincula la piedra de regreso', text: 'En la Estatua del Viajero vincula tu piedra: con la tecla V volverás a Aurelia desde cualquier lugar.', gold: 40, xp: 50, unlocks: [] },
  { id: 'puerta', title: 'Sal por la Puerta Sur', text: 'Camina hacia el sur de Aurelia y cruza la puerta abierta hacia la Pradera.', gold: 40, xp: 60, unlocks: [] },
  { id: 'combate', title: 'Gana tu primer combate', text: 'Toca un monstruo o camina por la hierba alta. En el combate, Atacar es la tecla 1.', gold: 60, xp: 100, unlocks: ['habilidades', 'formacion'] },
  { id: 'recurso', title: 'Recoge un recurso', text: 'Hierbas, vetas y cofres brillan en el mapa. Acércate y pulsa E.', gold: 40, xp: 60, unlocks: ['bestiario'] },
  { id: 'aldea', title: 'Llega a la Aldea Espiga', text: 'Sigue el camino hasta la fogata de la Aldea Espiga: será tu nuevo refugio.', gold: 100, xp: 150, unlocks: ['mercado', 'gremio', 'mascotas', 'logros', 'ranking'] },
];
// Comprobación de cada paso en el servidor: dónde tiene que estar el jugador (casillas locales) o
// qué tiene que haber hecho. La mochila no se puede comprobar (se abre en el navegador) y da poco.
const CHECKS = {
  tomas: (pid) => cercaDe(pid, 'aurelia', 57, 50, 6),
  pilar: (pid) => cercaDe(pid, 'aurelia', 60, 45, 7),
  piedra: async (pid) => !!(await piedra.get(pid)).vinculo,
  puerta: (pid) => cercaDe(pid, 'pradera'),
  combate: async (pid) => (await db.query('SELECT combat_wins FROM players WHERE id = $1', [pid])).rows[0]?.combat_wins > 0,
  recurso: async (pid) => (await db.query('SELECT 1 FROM world_node_gathers WHERE player_id = $1 LIMIT 1', [pid])).rows.length > 0,
  aldea: (pid) => cercaDe(pid, 'pradera', 78, 51, 8),
};

// lo que se ve desde el primer momento
const BASE_UNLOCKS = ['inventario'];

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_guide (
      player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      step        SMALLINT NOT NULL DEFAULT 0,
      progressive BOOLEAN NOT NULL DEFAULT FALSE,
      started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

function view(row) {
  const step = Math.min(row.step, STEPS.length);
  const done = step >= STEPS.length;
  const unlocked = !row.progressive || done ? null : [...BASE_UNLOCKS, ...STEPS.slice(0, step).flatMap((s) => s.unlocks)];
  const cur = STEPS[step];
  return {
    step, total: STEPS.length, done, progressive: row.progressive && !done, newPlayer: row.progressive, unlocked,
    current: cur ? { id: cur.id, title: cur.title, text: cur.text, gold: cur.gold, xp: cur.xp } : null,
  };
}

async function state(playerId) {
  await ensureTables();
  let r = await db.query('SELECT * FROM player_guide WHERE player_id = $1', [playerId]);
  if (!r.rows.length) {
    // primera vez: los de nivel 5+ ya conocen el mundo (la guía arranca terminada)
    const p = await db.query('SELECT level FROM players WHERE id = $1', [playerId]);
    const level = p.rows[0]?.level ?? 1;
    r = await db.query(
      `INSERT INTO player_guide (player_id, step, progressive) VALUES ($1, $2, $3)
       ON CONFLICT (player_id) DO UPDATE SET player_id = EXCLUDED.player_id RETURNING *`,
      [playerId, level >= 5 ? STEPS.length : 0, level <= 2]
    );
  }
  return view(r.rows[0]);
}

// Avanza si `id` es el paso actual (en orden); da su recompensa una sola vez
async function advance(playerId, id) {
  await state(playerId);
  const idx = STEPS.findIndex((s) => s.id === id);
  if (idx < 0) return { ...(await state(playerId)), reward: null };
  if (CHECKS[id] && !(await CHECKS[id](playerId))) return { ...(await state(playerId)), reward: null };
  const upd = await db.query('UPDATE player_guide SET step = step + 1 WHERE player_id = $1 AND step = $2 RETURNING *', [playerId, idx]);
  if (!upd.rows.length) return { ...(await state(playerId)), reward: null };
  const s = STEPS[idx];
  await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [s.gold, playerId]);
  const lv = await leveling.applyXpGain(playerId, s.xp).catch(() => null);
  return { ...view(upd.rows[0]), reward: { title: s.title, gold: s.gold, xp: s.xp, unlocks: s.unlocks, levelUp: lv?.leveledUp ? lv.newLevel : null } };
}

async function skip(playerId) {
  await state(playerId);
  const r = await db.query('UPDATE player_guide SET step = $2 WHERE player_id = $1 RETURNING *', [playerId, STEPS.length]);
  return view(r.rows[0]);
}

module.exports = { STEPS, ensureTables, state, advance, skip };
