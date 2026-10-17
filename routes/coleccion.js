// Colección del cazador (ver lib/coleccion.js y lib/mythic.js): bestiario con metas, amuletos,
// cartas de monstruo engarzables y el jefe mítico de zona.
const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const { withTransaction } = require('../lib/currency');
const col = require('../lib/coleccion');
const mythic = require('../lib/mythic');
const mazmorras = require('../lib/mazmorras');
const combatEngine = require('./combat');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);

const SLOT_NAMES = { WEAPON: 'Arma', OFFHAND: 'Mano izquierda', HELMET: 'Casco', ARMOR: 'Armadura', GLOVES: 'Guantes', BOOTS: 'Botas', ACCESSORY: 'Accesorio' };

function charmList(levels) {
  return col.CHARMS.map((c) => {
    const level = levels.get(c.code) ?? 0;
    return {
      code: c.code, name: c.name, effect: c.effect, level, max: c.per.length,
      value: level ? c.per[level - 1] : 0,
      text: level ? col.EFFECTS[c.effect].text(c.per[level - 1]) : null,
      next: level < c.per.length ? { value: c.per[level], cost: c.cost[level], text: col.EFFECTS[c.effect].text(c.per[level]) } : null,
    };
  });
}

async function pointsOf(playerId) {
  const r = await db.query('SELECT earned, spent FROM player_charm_points WHERE player_id = $1', [playerId]);
  const earned = r.rows[0]?.earned ?? 0;
  const spent = r.rows[0]?.spent ?? 0;
  return { earned, spent, available: earned - spent };
}

// GET /api/player/:playerId/coleccion/bestiario
router.get('/bestiario', async (req, res, next) => {
  try {
    await col.ensureTables();
    await mythic.ensureTables();
    for (const m of mazmorras.ALL) await m.ensureTables();
    const pid = req.playerId;
    const [zones, mons, kills, seen, drops, cards, charms, points] = await Promise.all([
      db.query('SELECT id, name, min_level, max_level FROM monster_zones WHERE is_tower_zone = FALSE ORDER BY min_level'),
      db.query(
        `SELECT m.*, e.name AS element FROM monsters m LEFT JOIN elements e ON e.id = m.element_id
         WHERE m.zone_id IN (SELECT id FROM monster_zones WHERE is_tower_zone = FALSE) OR m.code LIKE $1 OR m.code = ANY($2::text[]) OR m.code = ANY($3::text[])
         ORDER BY m.base_level, m.id`,
        [`${col.MYTHIC_PREFIX}%`, [...mythic.MINION_CODES], mazmorras.ALL.flatMap((m) => m.CODES)]
      ),
      db.query('SELECT monster_id, kills, completed FROM player_bestiary WHERE player_id = $1', [pid]),
      db.query('SELECT monster_id FROM player_monster_encounters WHERE player_id = $1', [pid]),
      db.query(
        `SELECT md.monster_id, i.name, i.rarity, i.item_type, md.drop_chance_percent, md.min_quantity, md.max_quantity
         FROM monster_drops md JOIN items i ON i.id = md.item_id ORDER BY md.drop_chance_percent DESC`
      ),
      db.query('SELECT monster_id, quantity FROM player_cards WHERE player_id = $1', [pid]),
      db.query('SELECT code, level FROM player_charms WHERE player_id = $1', [pid]),
      pointsOf(pid),
    ]);
    const killsBy = new Map(kills.rows.map((r) => [r.monster_id, r]));
    const seenSet = new Set(seen.rows.map((r) => r.monster_id));
    const dropsBy = new Map();
    for (const d of drops.rows) {
      if (!dropsBy.has(d.monster_id)) dropsBy.set(d.monster_id, []);
      dropsBy.get(d.monster_id).push({ name: d.name, rarity: d.rarity, type: d.item_type, chance: Number(d.drop_chance_percent), min: d.min_quantity, max: d.max_quantity });
    }
    const cardQty = new Map(cards.rows.map((r) => [r.monster_id, r.quantity]));
    const mythicZone = Object.fromEntries(Object.values(mythic.MITICOS).flatMap((d) => [[d.code, d.zoneId], [d.minion.code, d.zoneId]]));
    // los de las mazmorras (sin zona en la base) se ven con la zona donde está su mazmorra
    for (const m of mazmorras.ALL) for (const c of m.CODES) mythicZone[c] = m.ZONE_ID;

    const list = mons.rows.map((m) => {
      const rarity = col.rarityOf(m);
      const t = col.THRESHOLDS[rarity];
      const k = killsBy.get(m.id)?.kills ?? 0;
      const stage = col.stageOf(k, t);
      const known = k > 0 || seenSet.has(m.id);
      const card = col.cardOf(m);
      return {
        id: m.id, code: m.code, zoneId: m.zone_id ?? mythicZone[m.code] ?? null, rarity, mythic: col.isMythic(m.code),
        known, name: known ? m.name : null, category: known ? m.category : null,
        kills: k, thresholds: t, stage, points: col.POINTS[rarity],
        description: stage >= 1 ? m.description : null,
        stats: stage >= 1 ? {
          level: m.base_level, hp: m.base_hp, atk: m.base_atk, def: m.base_def, mag: m.base_magic_atk, mdef: m.base_magic_def,
          spd: m.base_spd, evasion: Number(m.base_evasion), crit: Number(m.base_crit_chance), element: m.element,
          levels: `${m.min_spawn_level}-${m.max_spawn_level}`,
        } : null,
        drops: stage >= 2 ? (dropsBy.get(m.id) ?? []) : null,
        card: known ? { ...card, owned: cardQty.get(m.id) ?? 0, chance: col.isMythic(m.code) ? null : col.CARD_DROP[rarity] } : null,
      };
    });
    res.json({
      points,
      charms: charmList(new Map(charms.rows.map((r) => [r.code, r.level]))),
      zones: zones.rows.map((z) => ({
        id: z.id, name: z.name, levels: `${z.min_level}-${z.max_level}`,
        monsters: list.filter((m) => m.zoneId === z.id),
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/coleccion/amuleto { code } — sube un nivel el amuleto
router.post('/amuleto', async (req, res, next) => {
  try {
    await col.ensureTables();
    const def = col.CHARMS.find((c) => c.code === req.body?.code);
    if (!def) return res.status(400).json({ error: 'Ese amuleto no existe' });
    const result = await withTransaction(async (client) => {
      const cur = await client.query('SELECT level FROM player_charms WHERE player_id = $1 AND code = $2 FOR UPDATE', [req.playerId, def.code]);
      const level = cur.rows[0]?.level ?? 0;
      if (level >= def.per.length) return { error: 'Ya está al máximo', abort: true };
      const cost = def.cost[level];
      const paid = await client.query(
        `UPDATE player_charm_points SET spent = spent + $1 WHERE player_id = $2 AND earned - spent >= $1 RETURNING earned - spent AS left`,
        [cost, req.playerId]
      );
      if (!paid.rows.length) return { error: `Te faltan puntos de bestiario (necesitas ${cost})`, abort: true };
      await client.query(
        `INSERT INTO player_charms (player_id, code, level) VALUES ($1, $2, 1)
         ON CONFLICT (player_id, code) DO UPDATE SET level = player_charms.level + 1`,
        [req.playerId, def.code]
      );
      return { ok: true };
    });
    if (result.error) return res.status(400).json({ error: result.error });
    const charms = await db.query('SELECT code, level FROM player_charms WHERE player_id = $1', [req.playerId]);
    res.json({ points: await pointsOf(req.playerId), charms: charmList(new Map(charms.rows.map((r) => [r.code, r.level]))) });
  } catch (err) { next(err); }
});

async function cardsState(pid) {
  await col.ensureTables();
  const [owned, sockets, equip, bonus] = await Promise.all([
    db.query(
      `SELECT m.id, m.code, m.name, m.rarity, m.category, c.quantity, c.first_at
       FROM player_cards c JOIN monsters m ON m.id = c.monster_id WHERE c.player_id = $1 AND c.quantity > 0
       ORDER BY c.first_at DESC`,
      [pid]
    ),
    db.query(
      `SELECT s.slot, m.id, m.code, m.name, m.rarity, m.category FROM player_card_sockets s
       JOIN monsters m ON m.id = s.monster_id WHERE s.player_id = $1`,
      [pid]
    ),
    db.query('SELECT pe.slot, i.name FROM player_equipment pe JOIN items i ON i.id = pe.item_id WHERE pe.player_id = $1', [pid]),
    col.utilityBonuses(pid),
  ]);
  const card = (m) => ({ monsterId: m.id, code: m.code, name: m.name, rarity: col.rarityOf(m), category: m.category, ...col.cardOf(m) });
  const bySlot = new Map(sockets.rows.map((s) => [s.slot, card(s)]));
  const itemBy = new Map(equip.rows.map((e) => [e.slot, e.name]));
  return {
    owned: owned.rows.map((m) => ({ ...card(m), quantity: m.quantity })),
    slots: col.SLOTS.map((slot) => ({ slot, label: SLOT_NAMES[slot], item: itemBy.get(slot) ?? null, card: bySlot.get(slot) ?? null })),
    bonus,
  };
}

// GET /api/player/:playerId/coleccion/cartas
router.get('/cartas', async (req, res, next) => {
  try { res.json(await cardsState(req.playerId)); } catch (err) { next(err); }
});

// POST /api/player/:playerId/coleccion/cartas/engarzar { slot, monsterId }
// La carta queda en la ranura del equipo aunque cambies la pieza; si ya había otra, vuelve al álbum.
router.post('/cartas/engarzar', async (req, res, next) => {
  try {
    await col.ensureTables();
    const slot = String(req.body?.slot ?? '');
    const monsterId = Number(req.body?.monsterId);
    if (!col.SLOTS.includes(slot) || !monsterId) return res.status(400).json({ error: 'Ranura o carta inválida' });
    const out = await withTransaction(async (client) => {
      const take = await client.query(
        'UPDATE player_cards SET quantity = quantity - 1 WHERE player_id = $1 AND monster_id = $2 AND quantity > 0 RETURNING quantity',
        [req.playerId, monsterId]
      );
      if (!take.rows.length) return { error: 'No tienes esa carta', abort: true };
      const prev = await client.query('DELETE FROM player_card_sockets WHERE player_id = $1 AND slot = $2 RETURNING monster_id', [req.playerId, slot]);
      if (prev.rows[0]) await col.giveCard(req.playerId, prev.rows[0].monster_id, 1, client);
      await client.query('INSERT INTO player_card_sockets (player_id, slot, monster_id) VALUES ($1, $2, $3)', [req.playerId, slot, monsterId]);
      return { ok: true };
    });
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(await cardsState(req.playerId));
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/coleccion/cartas/quitar { slot } — la carta vuelve al álbum
router.post('/cartas/quitar', async (req, res, next) => {
  try {
    await col.ensureTables();
    const slot = String(req.body?.slot ?? '');
    await withTransaction(async (client) => {
      const prev = await client.query('DELETE FROM player_card_sockets WHERE player_id = $1 AND slot = $2 RETURNING monster_id', [req.playerId, slot]);
      if (prev.rows[0]) await col.giveCard(req.playerId, prev.rows[0].monster_id, 1, client);
    });
    res.json(await cardsState(req.playerId));
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/coleccion/mitico/enter — un intento contra el jefe mítico activo
router.post('/mitico/enter', async (req, res, next) => {
  try {
    const hunt = await mythic.activeHunt();
    if (!hunt) return res.status(400).json({ error: 'No hay ningún jefe mítico suelto ahora' });
    const def = mythic.MITICOS[hunt.zone_id];
    const cooldownLeft = async (pid) => {
      const cd = await db.query('SELECT last_attempt_at FROM mythic_hunt_damage WHERE hunt_id = $1 AND player_id = $2', [hunt.id, pid]);
      const since = cd.rows[0] ? (Date.now() - new Date(cd.rows[0].last_attempt_at).getTime()) / 1000 : Infinity;
      return since < mythic.ATTEMPT_COOLDOWN_S ? Math.ceil(mythic.ATTEMPT_COOLDOWN_S - since) : 0;
    };
    // def.minLevel es solo el nivel recomendado (lo muestra el front): se puede intentar igual
    const wait = await cooldownLeft(req.playerId);
    if (wait) return res.status(400).json({ error: `Recupera el aliento: ${wait} s` });
    if (await combatEngine.hasAbandonedActiveSession(req.playerId) || await combatEngine.hasActiveCombatSession(req.playerId)) {
      return res.status(400).json({ error: 'Tienes un combate sin terminar' });
    }
    // Formación: tú y TODOS tus compañeros contratados primero; si sobra lugar (COMBAT_SIDE_MAX por
    // lado), entran los jugadores de tu grupo del mundo que estén cerca. Si tu formación ya está
    // completa, ellos no entran (se les avisa) y pueden hacer su propio intento.
    const [leader, leaderNpcs] = await Promise.all([
      combatEngine.hydratePlayers([req.playerId]),
      combatEngine.hydratePartyNpcs(req.playerId, req.playerId),
    ]);
    const own = [...leader, ...leaderNpcs].filter((p) => p.hp > 0);
    if (!own.length) return res.status(400).json({ error: 'Toda la formación está derrotada.' });
    const leftOut = [];
    const candidates = req.body?.worldGroup === true ? await combatEngine.worldGroupPartners(req.playerId, leftOut) : [];
    let freeSlots = Math.max(0, combatEngine.COMBAT_SIDE_MAX - own.length);
    const partners = [];
    for (const pid of candidates) {
      if (!freeSlots) { leftOut.push({ pid, why: 'lleno' }); continue; }
      if (await cooldownLeft(pid)) { leftOut.push({ pid, why: 'aliento' }); continue; }
      partners.push(pid);
      freeSlots -= 1;
    }
    const partnerHeroes = partners.length ? (await combatEngine.hydratePlayers(partners)).filter((p) => p.hp > 0) : [];
    const playerIds = [req.playerId, ...partnerHeroes.map((p) => p.player_id)];
    const pr = await db.query('SELECT id, level, nickname FROM players WHERE id = ANY($1::int[])', [playerIds]);
    const nick = Object.fromEntries(pr.rows.map((p) => [p.id, p.nickname]));
    // el clon sale al nivel más alto de los que entran (así un grupo no lo baja trayendo a alguien chico)
    const level = Math.max(1, ...pr.rows.map((p) => Number(p.level) || 1));
    // más cazadores = más vida (lib/mythic.js joinHunters)
    const huntNow = await mythic.joinHunters(hunt, playerIds);
    // el clon nunca baja del nivel recomendado de su zona (mythic.cloneLevel)
    const enemies = await combatEngine.hydrateMonsters([{ code: hunt.monster_code, level: mythic.cloneLevel(def, level) }]);
    if (!enemies.length) return res.status(500).json({ error: 'No se pudo cargar al jefe mítico' });
    const guests = playerIds.slice(1);
    const sess = await combatEngine.createCombatSessionWithClaim(
      (client) => client.query('INSERT INTO combat_sessions (mythic_hunt_id, guest_player_id, guest_player_id_2) VALUES ($1, $2, $3) RETURNING *',
        [hunt.id, guests[0] ?? null, guests[1] ?? null]),
      playerIds
    );
    const sessionId = sess.rows[0].id;
    await combatEngine.insertParticipants(sessionId, [...own, ...partnerHeroes, ...enemies]);
    // vida compartida; los esbirros cazados le bajan la defensa y la luna roja le sube el ataque
    const down = 1 - mythic.defDownOf(huntNow);
    const atkMul = huntNow.phase >= 3 ? mythic.RED_MOON_ATK : 1;
    await db.query(
      `UPDATE combat_participants SET hp = $1, max_hp = $1, def = ROUND(def * $4::numeric)::int, magic_def = ROUND(magic_def * $4::numeric)::int, atk = ROUND(atk * $5::numeric)::int
       WHERE session_id = $2 AND monster_code = $3`,
      [huntNow.hp_remaining, sessionId, hunt.monster_code, down, atkMul]
    );
    await combatEngine.advanceEnemyTurns(sessionId);
    const state = await combatEngine.fetchSessionState(sessionId);
    const io = req.app.get('io');
    io?.to(`combat:${sessionId}`).emit('combat:update', state);
    // los del grupo que entran lo hacen al instante; los que quedaron afuera reciben un aviso
    await combatEngine.notifyLeftOut(req, leftOut, sessionId);
    for (const pid of guests) {
      io?.to(`player:${pid}`).emit('coop:battle', { sessionId, zoneId: hunt.zone_id, leaderId: req.playerId, leaderName: nick[req.playerId] });
    }
    res.status(201).json({
      ...state, coopPartnerIds: guests,
      mythic: { name: def.name, hp: huntNow.hp_remaining, maxHp: huntNow.max_hp, phase: huntNow.phase, defDown: Math.round(mythic.defDownOf(huntNow) * 100) },
    });
  } catch (err) {
    if (err.isActiveCombatConflict) return res.status(409).json({ error: err.message });
    next(err);
  }
});

// GET /api/player/:playerId/coleccion/mitico/aporte — tu daño en la cacería activa
router.get('/mitico/aporte', async (req, res, next) => {
  try {
    const hunt = await mythic.activeHunt();
    if (!hunt) return res.json(null);
    const r = await db.query(
      `SELECT d.player_id, p.nickname, d.total_damage FROM mythic_hunt_damage d JOIN players p ON p.id = d.player_id
       WHERE d.hunt_id = $1 AND d.total_damage > 0 ORDER BY d.total_damage DESC LIMIT 10`,
      [hunt.id]
    );
    const mine = await db.query('SELECT total_damage, last_attempt_at FROM mythic_hunt_damage WHERE hunt_id = $1 AND player_id = $2', [hunt.id, req.playerId]);
    res.json({ top: r.rows, mine: mine.rows[0] ?? null, cooldown: mythic.ATTEMPT_COOLDOWN_S });
  } catch (err) { next(err); }
});

module.exports = router;
