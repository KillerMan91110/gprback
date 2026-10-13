// Cierres de combate de los eventos (los llama routes/combat.js -> finalizeSession):
//   handleWorldBossFinalize: resta el daño de la sesión al HP global del World Boss y reparte
//                            fragmentos cósmicos (y los bonos si cayó)
//   handleDailyEventFinalize: recompensa fija del Evento del Día para cada héroe que ganó
// Viven aparte para que finalizeSession no siga creciendo (ver también lib/huntRewards.js).
const db = require('../db/db');
const inventory = require('./inventory');
const leveling = require('./leveling');
const dailyEventBonus = require('./dailyEventBonus');

const WORLD_BOSS_CODE_PREFIX = 'WORLD_BOSS_';
const WORLD_BOSS_SHARDS_PER_DAMAGE_POINT = 1 / 400;
const WORLD_BOSS_KILL_BONUS_SHARDS = 500;
const WORLD_BOSS_TOP3_BONUS_SHARDS = [300, 200, 100];

// Evento del Día (docs/backend-spec-evento-del-dia.md): recompensa fija del catálogo de hoy (oro,
// monedas de mazmorra, material bonus con probabilidad) para cada héroe real que ganó, ADEMÁS de
// lo que ya reparte el bloque normal de arriba (xp/oro/drops propios del/los monstruo/s). El
// material bonus se sortea una sola vez por sesión y se replica a todos los héroes si sale,
// mismo criterio que itemsDropped más arriba (no un roll independiente por jugador). También suma
// el bono de nivel bajo (degradé, ver lib/dailyEventBonus) por héroe segun SU propio nivel, ya que
// el oro/xp escalado del bloque normal sale muy chico para niveles bajos. Devuelve el resumen del
// héroe líder (heroes[0]) para que finalizeSession lo pueda sumar al `rewards` que ve el front.
async function handleDailyEventFinalize(sessionId, status, participants) {
  if (status !== 'PLAYER_WON') return null;
  const sessRes = await db.query('SELECT daily_event_code FROM combat_sessions WHERE id = $1', [sessionId]);
  const code = sessRes.rows[0]?.daily_event_code;
  if (!code) return null;

  const entryRes = await db.query('SELECT * FROM daily_event_catalog WHERE code = $1', [code]);
  const entry = entryRes.rows[0];
  if (!entry) return null;

  const abandonedRes = await db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]);
  const abandonedIds = abandonedRes.rows.map((r) => r.player_id);
  const heroes = participants.player.filter((p) => p.player_id && !abandonedIds.includes(p.player_id));
  if (!heroes.length) return null;

  let materialItemId = null;
  let materialName = null;
  if (entry.bonus_material_item_code && Math.random() * 100 < entry.bonus_material_chance_percent) {
    const itemRes = await db.query('SELECT id, name FROM items WHERE code = $1', [entry.bonus_material_item_code]);
    materialItemId = itemRes.rows[0]?.id ?? null;
    materialName = itemRes.rows[0]?.name ?? null;
  }

  let leaderSummary = null;
  for (const hero of heroes) {
    const bonus = dailyEventBonus.lowLevelBonus(hero.level);
    const heroExtraGold = entry.gold_reward + bonus.gold;
    await db.query(
      'UPDATE players SET gold = gold + $1, dungeon_coins = dungeon_coins + $2 WHERE id = $3',
      [heroExtraGold, entry.dungeon_coins_reward, hero.player_id]
    );
    if (bonus.xp > 0) await leveling.applyXpGain(hero.player_id, bonus.xp);
    if (materialItemId) await inventory.addItem(hero.player_id, materialItemId, entry.bonus_material_quantity || 1);

    if (!leaderSummary) {
      leaderSummary = {
        extraGold: heroExtraGold,
        extraDungeonCoins: entry.dungeon_coins_reward,
        extraXp: bonus.xp,
        bonusMaterial: materialItemId ? { itemName: materialName, quantity: entry.bonus_material_quantity } : null,
      };
    }
  }
  return leaderSummary;
}

// World Boss (docs/backend-spec-world-boss.md sección 4): si esta sesión es un clon de World
// Boss, resta el daño hecho del HP global compartido y reparte fragmentos cósmicos por jugador
// real (agrupando por dueño — hero o NPCs propios — via combat_log, que ya tiene el actor exacto
// de cada golpe). Corre en cierres ganados o perdidos, NO en ESCAPED: si el jugador huye, pierde
// todo el crédito de esta sub-sesión (ni resta del HP global ni suma a su daño/fragmentos).
async function handleWorldBossFinalize(sessionId, status, participants) {
  if (status === 'ESCAPED') return;
  const sessRes = await db.query('SELECT world_boss_event_id FROM combat_sessions WHERE id = $1', [sessionId]);
  const eventId = sessRes.rows[0]?.world_boss_event_id;
  if (!eventId) return;

  const boss = participants.enemy.find((e) => e.monster_code?.startsWith(WORLD_BOSS_CODE_PREFIX));
  if (!boss) return;

  const damageDealt = Math.max(0, Math.round(Number(boss.max_hp) - Number(boss.hp)));
  if (damageDealt <= 0) return;

  // Igual que ya hace finalizeSession con las recompensas normales de XP/oro: quien abandonó el
  // grupo (combat_abandoned_players) no cobra nada de esta sesión, aunque la IA haya seguido
  // jugando en su nombre y le haya seguido pegando de verdad al jefe.
  const abandonedRes = await db.query(
    'SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]
  );
  const abandonedIds = abandonedRes.rows.map((r) => r.player_id);

  const dmgByOwner = await db.query(
    `SELECT COALESCE(cp.player_id, cp.owner_player_id) AS owner_id, SUM(cl.damage) AS dmg
     FROM combat_log cl
     JOIN combat_participants cp ON cp.id = cl.actor_participant_id
     WHERE cl.session_id = $1 AND cl.damage IS NOT NULL AND cl.damage > 0 AND cp.side = 'PLAYER'
       AND COALESCE(cp.player_id, cp.owner_player_id) IS NOT NULL
       AND COALESCE(cp.player_id, cp.owner_player_id) != ALL($2::int[])
     GROUP BY COALESCE(cp.player_id, cp.owner_player_id)`,
    [sessionId, abandonedIds]
  );

  const hpRes = await db.query(
    'UPDATE world_boss_events SET hp_remaining = GREATEST(0, hp_remaining - $1) WHERE id = $2 RETURNING hp_remaining',
    [damageDealt, eventId]
  );
  const hpRemaining = hpRes.rows[0]?.hp_remaining ?? 0;

  for (const row of dmgByOwner.rows) {
    const dmg = Number(row.dmg);
    if (dmg <= 0) continue;
    await db.query(
      `INSERT INTO world_boss_damage_log(event_id, player_id, total_damage, last_attempt_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (event_id, player_id) DO UPDATE
         SET total_damage = world_boss_damage_log.total_damage + EXCLUDED.total_damage, last_attempt_at = now()`,
      [eventId, row.owner_id, dmg]
    );
    const shards = Math.round(dmg * WORLD_BOSS_SHARDS_PER_DAMAGE_POINT);
    if (shards > 0) await db.query('UPDATE players SET cosmic_shards = cosmic_shards + $1 WHERE id = $2', [shards, row.owner_id]);
  }

  if (hpRemaining <= 0) {
    // "WHERE status='ACTIVE'" es la guarda atomica: si 2 sesiones cierran casi al mismo tiempo
    // y ambas ven hp_remaining<=0, solo la primera en llegar a la DB gana el claim y reparte
    // bonos; la otra hace un no-op acá (rows.length === 0).
    const lastHitRes = await db.query(
      `SELECT COALESCE(cp.player_id, cp.owner_player_id) AS owner_id
       FROM combat_log cl JOIN combat_participants cp ON cp.id = cl.actor_participant_id
       WHERE cl.session_id = $1 AND cl.damage IS NOT NULL AND cl.damage > 0 AND cp.side = 'PLAYER'
         AND COALESCE(cp.player_id, cp.owner_player_id) != ALL($2::int[])
       ORDER BY cl.id DESC LIMIT 1`,
      [sessionId, abandonedIds]
    );
    const killerPlayerId = lastHitRes.rows[0]?.owner_id ?? null;

    const claim = await db.query(
      `UPDATE world_boss_events SET status = 'KILLED', closed_at = now(), killed_by_player_id = $1
       WHERE id = $2 AND status = 'ACTIVE' RETURNING id`,
      [killerPlayerId, eventId]
    );
    if (claim.rows.length) {
      if (killerPlayerId) {
        await db.query('UPDATE players SET cosmic_shards = cosmic_shards + $1 WHERE id = $2', [WORLD_BOSS_KILL_BONUS_SHARDS, killerPlayerId]);
      }
      const top3 = await db.query(
        'SELECT player_id FROM world_boss_damage_log WHERE event_id = $1 ORDER BY total_damage DESC LIMIT 3',
        [eventId]
      );
      for (let i = 0; i < top3.rows.length; i += 1) {
        const bonus = WORLD_BOSS_TOP3_BONUS_SHARDS[i];
        if (bonus) await db.query('UPDATE players SET cosmic_shards = cosmic_shards + $1 WHERE id = $2', [bonus, top3.rows[i].player_id]);
      }
    }
  }
}

module.exports = { handleWorldBossFinalize, handleDailyEventFinalize, WORLD_BOSS_CODE_PREFIX };
