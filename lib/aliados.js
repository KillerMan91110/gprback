// Los aliados del final (R13 «Las lágrimas de Aethra», en la Plaza del Pilar de Aurelia): en cada una de las tres
// emboscadas pelean a tu lado dos de los personajes que ayudaste en el viaje, según lo que elegiste (ver
// gprback/docs/zona7_ruinas.md, sección 10). Van en la formación como compañeros, pero los maneja el servidor
// (atacan solos, como un jugador que se fue: routes/combat.js) y no son tuyos: no ganan experiencia ni
// guardan la vida al terminar.
//
// La emboscada los trae en sus params: aliados: [{ nombre, clase, fase? }]. «fase» elige quién viene: códigos
// de misión separados por coma (todas tienen que estar entregadas; con «!» delante, que no lo esté). De la
// lista vienen los dos primeros que cumplen.
const db = require('../db/db');

const CLASE_ID = { guerrero: 1, mago: 2, arquero: 3, picaro: 4, sacerdote: 5 };
// cuánto de tu fuerza tiene cada aliado (no traen tu equipo, pero sí lo que aprendieron en el viaje)
const FUERZA = 0.6;
const VIDA = 0.7;

const cumple = (fase, hechas) => !fase || fase.split(',').every((c) => {
  const code = c.trim();
  return code.startsWith('!') ? !hechas.has(code.slice(1)) : hechas.has(code);
});

// Los aliados de la emboscada pendiente que corresponde a estos monstruos (o [] si no es una con aliados).
// hero: el combatiente del jugador ya hidratado (hydratePlayers), del que salen sus números.
async function deEmboscada(playerId, monsterCodes, hero) {
  if (!hero || !monsterCodes?.length) return [];
  const r = await db.query(
    `SELECT qo.params FROM player_quest_ambushes a JOIN quest_objectives qo ON qo.id = a.objective_id
     WHERE a.player_id = $1 AND qo.params ? 'aliados'`,
    [playerId]
  ).catch(() => ({ rows: [] }));
  const want = [...monsterCodes].sort().join(',');
  const amb = r.rows.find((x) => (x.params.monsters ?? []).map((m) => m.code).sort().join(',') === want);
  if (!amb) return [];
  const hechas = new Set((await db.query(
    'SELECT q.code FROM player_quest_completions c JOIN quests q ON q.id = c.quest_id WHERE c.player_id = $1',
    [playerId]
  )).rows.map((x) => x.code));
  const elegidos = (amb.params.aliados ?? []).filter((a) => cumple(a.fase, hechas)).slice(0, 2);
  const fuerza = Math.max(Number(hero.atk) || 0, Number(hero.mag) || 0);
  return elegidos.map((a) => ({
    side: 'PLAYER',
    player_id: null,
    npc_id: null,
    class_id: CLASE_ID[a.clase] ?? 1,
    monster_code: null,
    name: a.nombre,
    level: hero.level,
    hp: Math.round(Number(hero.max_hp) * VIDA),
    max_hp: Math.round(Number(hero.max_hp) * VIDA),
    mana: 0,
    max_mana: 0,
    atk: Math.round(fuerza * FUERZA),
    mag: Math.round(fuerza * FUERZA),
    def: Math.round(Number(hero.def) * FUERZA),
    magic_def: Math.round(Number(hero.magic_def) * FUERZA),
    spd: Math.round(Number(hero.spd) * 0.95),
    luck: 0,
    crit_chance: 10,
    crit_damage: 150,
    evasion: 5,
    magic_damage_bonus: 0,
    hot_hp_percent: 0,
    // no dan premio: no son enemigos
    xp_reward: 0,
    gold_reward: 0,
    owner_player_id: playerId,
  }));
}

// ¿es un aliado del final? (del lado de los héroes, sin jugador, sin compañero propio, sin ser un invocado)
const esAliado = (p) => p?.side === 'PLAYER' && !p.player_id && !p.npc_id && !p.is_summon && !p.monster_code;

module.exports = { deEmboscada, esAliado };
