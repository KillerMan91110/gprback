// routes/tower.js
// Fase 2+3 de la Torre/Mazmorra infinita: motor de corridas + economía de dungeon_coins.

const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const combatEngine = require('./combat');
const inventory = require('../lib/inventory');
const { incrementCounter } = require('../lib/counters');

router.use(requireAuth);
router.use(requireSelf);

const MIN_LEVEL = 30;
const DIFFICULTIES = {
  1: { label: 'Normal',      coinMult: 1   },
  2: { label: 'Difícil',     coinMult: 1.5 },
  3: { label: 'Muy Difícil', coinMult: 2   },
};

async function getActiveRun(playerId) {
  const res = await db.query(
    `SELECT * FROM player_tower_runs
     WHERE status = 'IN_PROGRESS' AND (player_id = $1 OR guest_player_id = $1 OR guest_player_id_2 = $1)`,
    [playerId]
  );
  let run = res.rows[0] || null;
  if (run?.current_session_id) run = await reconcileStaleSession(run);
  return run;
}

// Si el proceso se reinicia (deploy) a mitad de un finalizeSession, la sesión de combate ya queda
// resuelta (status != IN_PROGRESS) pero la corrida de torre nunca llega a cerrarse/avanzar de sala
// — current_session_id se queda apuntando a algo que ya terminó, bloqueando al jugador para
// siempre. Se repara sola la próxima vez que alguien pide el estado de su corrida.
async function reconcileStaleSession(run) {
  const sessRes = await db.query('SELECT status FROM combat_sessions WHERE id = $1', [run.current_session_id]);
  const sessionStatus = sessRes.rows[0]?.status;
  if (!sessionStatus || sessionStatus === 'IN_PROGRESS') return run;
  await combatEngine.handleTowerSessionEnd(run.current_session_id, sessionStatus);
  const fresh = await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id]);
  return fresh.rows[0] || null;
}

async function getFloor(floorNumber) {
  const { queryFloor, lap } = combatEngine.resolveInfiniteFloor(floorNumber);
  const res = await db.query('SELECT * FROM tower_floors WHERE floor_number = $1', [queryFloor]);
  if (!res.rows[0]) return null;
  return { ...res.rows[0], floor_number: floorNumber, lap };
}

// El líder de la corrida (quien la inició, run.player_id) controla Seguir/Extraer mientras
// esté vivo. Si murió en la sala/piso, cualquier otro participante vivo puede decidir en su
// lugar — esto NO cambia el liderazgo real del grupo co-op, solo el control de estos botones.
async function canControlRun(run, callerId) {
  const participantIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
  const hpRes = await db.query('SELECT id, hp FROM players WHERE id = ANY($1::int[])', [participantIds]);
  const hpById = Object.fromEntries(hpRes.rows.map((r) => [r.id, r.hp]));

  const leaderAlive = (hpById[run.player_id] ?? 0) > 0;
  if (leaderAlive) return callerId === run.player_id;
  return (hpById[callerId] ?? 0) > 0;
}

// Vendedor ambulante del evento narrativo VENDOR (distinto del vendedor persistente de
// tower_vendor_shop): ofrece 10 items al azar (CONSUMABLE/MATERIAL) pesados por rareza, con
// precio en dungeon_coins que escala segun rareza y que tan profundo esta el piso actual.
const VENDOR_EVENT_RARITY_WEIGHTS = { COMUN: 40, POCO_COMUN: 30, RARO: 18, EPICO: 9, LEGENDARIO: 3 };
const VENDOR_EVENT_RARITY_PRICE = { COMUN: 5, POCO_COMUN: 15, RARO: 35, EPICO: 80, LEGENDARIO: 200 };
const VENDOR_EVENT_OFFER_SIZE = 10;

function rollVendorEventRarity() {
  const entries = Object.entries(VENDOR_EVENT_RARITY_WEIGHTS);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let roll = Math.random() * total;
  for (const [rarity, w] of entries) {
    if (roll < w) return rarity;
    roll -= w;
  }
  return entries[0][0];
}

// Mismo multiplicador por profundidad que ya usaba vendorEventPrice, extraido para reusar
// tambien en la tienda del asentamiento (docs/backend-spec-ciudad-del-abismo.md parte 4).
function depthPriceMultiplier(floorNumber) {
  return 1 + Math.floor(floorNumber / 30) * 0.5;
}

function vendorEventPrice(rarity, floorNumber) {
  const base = VENDOR_EVENT_RARITY_PRICE[rarity] || VENDOR_EVENT_RARITY_PRICE.COMUN;
  return Math.round(base * depthPriceMultiplier(floorNumber));
}

// Ciudades del Abismo: asentamiento cada 15 pisos (docs/backend-spec-ciudad-del-abismo.md).
// "Estar parado en el asentamiento" ya es el estado que existe hoy entre limpiar la ultima sala
// de un piso multiplo de 15 y llamar a /advance: current_session_id NULL, current_floor sin
// incrementar todavia. No hace falta tocar el flujo piso a piso, solo detectar este estado.
const SETTLEMENT_FLOOR_INTERVAL = 15;

function isAtCheckpoint(run) {
  return !run.current_session_id && !run.pending_event_id && run.current_floor % SETTLEMENT_FLOOR_INTERVAL === 0;
}

function toRoman(num) {
  const numerals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let n = num;
  let result = '';
  for (const [value, symbol] of numerals) {
    while (n >= value) { result += symbol; n -= value; }
  }
  return result;
}

function checkpointInfo(run) {
  if (!isAtCheckpoint(run)) return null;
  const index = run.current_floor / SETTLEMENT_FLOOR_INTERVAL;
  return { index, name: `Ciudad del Abismo ${toRoman(index)}`, floor: run.current_floor };
}

// Banca lo acumulado (coins_earned) al llegar a un piso checkpoint, sin cerrar la corrida ni
// pedir accion del jugador -- mismo mecanismo que /extract pero automatico. last_banked_floor
// evita bancar de nuevo si el jugador consulta /run varias veces parado en el mismo checkpoint,
// o si vuelve a pasar por el mismo piso en otra vuelta del loop infinito.
async function bankIfNewCheckpoint(run) {
  if (!isAtCheckpoint(run) || run.current_floor <= run.last_banked_floor) return run;

  const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
  for (const pid of allPlayerIds) {
    await db.query('UPDATE players SET dungeon_coins = dungeon_coins + $1 WHERE id = $2', [run.coins_earned, pid]);
  }
  const updated = await db.query(
    `UPDATE player_tower_runs SET coins_earned = 0, last_banked_floor = $1 WHERE id = $2 RETURNING *`,
    [run.current_floor, run.id]
  );
  return updated.rows[0];
}

// Cierra una corrida acreditando lo acumulado -- mismo mecanismo que POST /extract, extraido
// para reusar en el reagrupe de la parte 6 (cada uno cierra la suya antes de compartir una nueva).
async function closeRunAsExtracted(run) {
  await db.query(`UPDATE player_tower_runs SET status = 'EXTRACTED', ended_at = now() WHERE id = $1`, [run.id]);
  const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
  for (const pid of allPlayerIds) {
    await db.query('UPDATE players SET dungeon_coins = dungeon_coins + $1 WHERE id = $2', [run.coins_earned, pid]);
    await incrementCounter(pid, 'MAZMORRAS_EXPLORADAS');
  }
}

async function rollVendorEventOffer(floorNumber) {
  const offer = [];
  const usedIds = [];
  for (let i = 0; i < VENDOR_EVENT_OFFER_SIZE; i += 1) {
    const rarity = rollVendorEventRarity();
    let itemRes = await db.query(
      `SELECT id, code, name, description, item_type, rarity FROM items
       WHERE item_type IN ('CONSUMABLE','MATERIAL') AND COALESCE(rarity,'COMUN') = $1
         AND NOT (id = ANY($2::int[]))
       ORDER BY random() LIMIT 1`,
      [rarity, usedIds]
    );
    if (!itemRes.rows.length) {
      // Esa rareza ya no tiene items sin repetir disponibles: cualquier CONSUMABLE/MATERIAL sirve.
      itemRes = await db.query(
        `SELECT id, code, name, description, item_type, rarity FROM items
         WHERE item_type IN ('CONSUMABLE','MATERIAL') AND NOT (id = ANY($1::int[]))
         ORDER BY random() LIMIT 1`,
        [usedIds]
      );
    }
    const item = itemRes.rows[0];
    if (!item) break; // no quedan mas items distintos para ofrecer
    usedIds.push(item.id);
    offer.push({
      itemId: item.id,
      code: item.code,
      name: item.name,
      description: item.description,
      itemType: item.item_type,
      rarity: item.rarity || 'COMUN',
      price: vendorEventPrice(item.rarity || 'COMUN', floorNumber),
    });
  }
  return offer;
}

const READY_TTL_MS = 15000;

async function getMyGroupId(playerId) {
  const res = await db.query('SELECT gm.group_id FROM player_coop_group_members gm WHERE gm.player_id = $1', [playerId]);
  return res.rows[0]?.group_id ?? null;
}

async function getGroupMemberIds(groupId) {
  const res = await db.query('SELECT player_id FROM player_coop_group_members WHERE group_id = $1', [groupId]);
  return res.rows.map((r) => r.player_id);
}

// POST /api/player/:playerId/tower/ready
router.post('/ready', async (req, res, next) => {
  try {
    const groupId = await getMyGroupId(req.playerId);
    if (!groupId) return res.status(400).json({ error: 'No estás en un grupo co-op' });

    await db.query(
      `INSERT INTO player_tower_ready(player_id, ready_at) VALUES($1, now())
       ON CONFLICT (player_id) DO UPDATE SET ready_at = now()`,
      [req.playerId]
    );

    const memberIds = await getGroupMemberIds(groupId);
    const readyRows = await db.query(
      `SELECT player_id FROM player_tower_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );

    const allReady = readyRows.rows.length === memberIds.length;
    if (!allReady) return res.json({ allReady: false });

    const otherIds = memberIds.filter((id) => id !== req.playerId);
    await db.query('DELETE FROM player_tower_ready WHERE player_id = ANY($1::int[])', [memberIds]);
    res.json({ allReady: true, coopPartnerIds: otherIds });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/player/:playerId/tower/ready
router.delete('/ready', async (req, res, next) => {
  try {
    await db.query('DELETE FROM player_tower_ready WHERE player_id = $1', [req.playerId]);
    res.json({ cancelled: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/ready-status
router.get('/ready-status', async (req, res, next) => {
  try {
    const groupId = await getMyGroupId(req.playerId);
    if (!groupId) return res.json({ inParty: false, members: [] });

    const memberIds = await getGroupMemberIds(groupId);
    const otherIds = memberIds.filter((id) => id !== req.playerId);

    const rows = await db.query(
      `SELECT player_id FROM player_tower_ready
       WHERE player_id = ANY($1::int[]) AND ready_at > now() - INTERVAL '${READY_TTL_MS / 1000} seconds'`,
      [memberIds]
    );
    const readyIds = new Set(rows.rows.map((r) => r.player_id));
    const members = otherIds.map((id) => ({ playerId: id, ready: readyIds.has(id) }));
    res.json({ inParty: true, myReady: readyIds.has(req.playerId), members });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/start   body: { difficulty, coopPartnerIds? }
router.post('/start', async (req, res, next) => {
  try {
    const difficulty = Number(req.body?.difficulty) || 1;
    if (!DIFFICULTIES[difficulty]) {
      return res.status(400).json({ error: 'Dificultad inválida' });
    }

    const coopPartnerIds = Array.isArray(req.body?.coopPartnerIds)
      ? [...new Set(req.body.coopPartnerIds.map(Number))].filter((id) => id !== req.playerId)
      : [];
    if (coopPartnerIds.length > 2) {
      return res.status(400).json({ error: 'Máximo 2 compañeros' });
    }

    const allIds = [req.playerId, ...coopPartnerIds];
    const levelRes = await db.query('SELECT id, nickname, level, hp, max_hp FROM players WHERE id = ANY($1::int[])', [allIds]);
    if (levelRes.rows.length !== allIds.length) {
      return res.status(404).json({ error: 'Algún jugador no fue encontrado' });
    }
    const belowLevel = levelRes.rows.filter((r) => r.level < MIN_LEVEL);
    if (belowLevel.length) {
      return res.status(400).json({
        error: `${belowLevel.map((r) => r.nickname).join(', ')} no tiene el nivel ${MIN_LEVEL} necesario para entrar a la torre — nadie del grupo puede entrar.`,
      });
    }

    const notFullHp = levelRes.rows.filter((r) => r.hp < r.max_hp).map((r) => r.nickname);
    const npcHpRes = await db.query(
      `SELECT pn.name, pn.hp, pn.max_hp
       FROM player_party pp
       JOIN player_npcs pn ON pn.id = pp.npc_id
       WHERE pp.player_id = ANY($1::int[])`,
      [allIds]
    );
    const npcNotFull = npcHpRes.rows.filter((r) => r.hp < r.max_hp).map((r) => r.name);
    if (notFullHp.length || npcNotFull.length) {
      return res.status(400).json({
        error: `Recuerda que todos deben estar con la vida al máximo antes de entrar a la Torre. (${[...notFullHp, ...npcNotFull].join(', ')} no está${notFullHp.length + npcNotFull.length > 1 ? 'n' : ''} al máximo)`,
      });
    }

    if (await getActiveRun(req.playerId)) {
      return res.status(400).json({ error: 'Ya tienes una corrida de torre en curso' });
    }

    for (const pid of [req.playerId, ...coopPartnerIds]) {
      if (await combatEngine.hasAbandonedActiveSession(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate anterior sin resolver. Esperen a que termine.' });
      }
      if (await combatEngine.hasActiveCombatSession(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero tiene un combate sin terminar. Termínenlo antes de entrar a la Torre.' });
      }
      if (await getActiveRun(pid)) {
        return res.status(400).json({ error: 'Tú o algún compañero ya tiene una corrida de torre en curso' });
      }
    }

    if (coopPartnerIds.length) {
      const allPlayerIds = [req.playerId, ...coopPartnerIds];
      const groupCheck = await db.query(
        `SELECT gm.group_id FROM player_coop_group_members gm
         WHERE gm.player_id = ANY($1::int[])
         GROUP BY gm.group_id
         HAVING COUNT(DISTINCT gm.player_id) = $2`,
        [allPlayerIds, allPlayerIds.length]
      );
      if (!groupCheck.rows.length) {
        return res.status(403).json({ error: 'No estás en el mismo grupo co-op que esos jugadores' });
      }
    }

    const runResult = await db.query(
      `INSERT INTO player_tower_runs(player_id, guest_player_id, guest_player_id_2, difficulty, current_floor, current_room, coins_earned, status)
       VALUES ($1,$2,$3,$4,1,1,0,'IN_PROGRESS') RETURNING *`,
      [req.playerId, coopPartnerIds[0] ?? null, coopPartnerIds[1] ?? null, difficulty]
    );
    const run = runResult.rows[0];

    await combatEngine.buildTowerRoom(run, 1, 1);

    const updatedRun = (await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id])).rows[0];
    const session = await combatEngine.fetchSessionState(updatedRun.current_session_id);
    res.status(201).json({ run: updatedRun, session });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/run — estado de la corrida activa
router.get('/run', async (req, res, next) => {
  try {
    let run = await getActiveRun(req.playerId);
    if (!run) return res.json({ run: null });
    run = await bankIfNewCheckpoint(run);

    const floorRow = await getFloor(run.current_floor);
    const session = run.current_session_id ? await combatEngine.fetchSessionState(run.current_session_id) : null;
    const canControl = await canControlRun(run, req.playerId);
    const pendingEvent = run.pending_event_id
      ? (await db.query('SELECT * FROM tower_room_events WHERE id = $1', [run.pending_event_id])).rows[0]
      : null;
    res.json({ run, floor: floorRow, session, canControl, pendingEvent, checkpoint: checkpointInfo(run) });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/event-choice   body: { choice: 'A' | 'B' }
// Resuelve el evento narrativo pendiente de la sala actual (docs/backend-spec-abismo-eventos-
// narrativos.md sección 3). Solo B siempre es "sin efecto"; A aplica el efecto según event_type.
router.post('/event-choice', async (req, res, next) => {
  try {
    const { choice } = req.body;
    if (!['A', 'B'].includes(choice)) return res.status(400).json({ error: "choice debe ser 'A' o 'B'" });

    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!run.pending_event_id) return res.status(400).json({ error: 'No hay ningún evento pendiente en esta sala' });
    if (!(await canControlRun(run, req.playerId))) {
      return res.status(403).json({ error: 'Solo quien tiene el control de la corrida (el líder, o alguien vivo si el líder murió) puede decidir esto.' });
    }

    const eventRes = await db.query('SELECT * FROM tower_room_events WHERE id = $1', [run.pending_event_id]);
    const event = eventRes.rows[0];
    if (!event) return res.status(500).json({ error: 'Evento no encontrado' });

    const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
    let message = 'Seguiste de largo, sin efecto.';

    if (choice === 'A' && event.event_type === 'VENDOR') {
      // El vendedor no se resuelve solo: abre un pop-up de compra (ver POST /vendor-event-buy).
      // El evento sigue pendiente hasta que el jugador compre 1 item o decida con choice: 'B'.
      const offer = await rollVendorEventOffer(run.current_floor);
      const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
      return res.json({
        vendorOffer: offer,
        dungeon_coins: Number(playerRes.rows[0].dungeon_coins),
        run,
      });
    }

    if (choice === 'A') {
      if (event.event_type === 'TRAP') {
        const pct = combatEngine.TOWER_EVENT_TRAP_DAMAGE_PERCENT;
        const playersRes = await db.query('SELECT id, hp, max_hp FROM players WHERE id = ANY($1::int[])', [allPlayerIds]);
        for (const p of playersRes.rows) {
          const dmg = Math.max(1, Math.round(Number(p.max_hp) * pct / 100));
          await db.query('UPDATE players SET hp = $1 WHERE id = $2', [Math.max(1, p.hp - dmg), p.id]);
        }
        const npcsRes = await db.query(
          `SELECT pn.id, pn.hp, pn.max_hp FROM player_party pp
           JOIN player_npcs pn ON pn.id = pp.npc_id WHERE pp.player_id = ANY($1::int[])`,
          [allPlayerIds]
        );
        for (const n of npcsRes.rows) {
          const dmg = Math.max(1, Math.round(Number(n.max_hp) * pct / 100));
          await db.query('UPDATE player_npcs SET hp = $1 WHERE id = $2', [Math.max(1, n.hp - dmg), n.id]);
        }
        message = `La trampa golpeó a todo el grupo por ${pct}% de su HP máximo.`;
      } else if (event.event_type === 'SANCTUARY') {
        await db.query('UPDATE players SET hp = max_hp, mana = max_mana WHERE id = ANY($1::int[])', [allPlayerIds]);
        await db.query(
          `UPDATE player_npcs SET hp = max_hp, mana = max_mana
           WHERE id IN (SELECT npc_id FROM player_party WHERE player_id = ANY($1::int[]))`,
          [allPlayerIds]
        );
        message = 'Todo el grupo descansó y recuperó HP y maná al máximo.';
      } else if (event.event_type === 'SECRET') {
        await db.query('UPDATE player_tower_runs SET coins_earned = coins_earned + 2 WHERE id = $1', [run.id]);
        message = '+2 monedas de mazmorra.';
      } else if (event.event_type === 'STORY') {
        await incrementCounter(req.playerId, 'HISTORIAS_DEL_ABISMO_LEIDAS');
        message = 'Una historia más del Abismo, guardada en tu memoria.';
      }
    }

    await db.query('UPDATE player_tower_runs SET pending_event_id = NULL WHERE id = $1', [run.id]);

    const floorRow = await getFloor(run.current_floor);
    await combatEngine.advanceTowerRoomOrFloor(run, floorRow);

    const updatedRun = (await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id])).rows[0];
    const session = updatedRun.current_session_id ? await combatEngine.fetchSessionState(updatedRun.current_session_id) : null;
    const pendingEvent = updatedRun.pending_event_id
      ? (await db.query('SELECT * FROM tower_room_events WHERE id = $1', [updatedRun.pending_event_id])).rows[0]
      : null;

    res.json({ message, run: updatedRun, session, pendingEvent });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/vendor-event-buy   body: { itemId }
// Compra 1 item del pop-up abierto por event-choice (choice:'A' sobre un evento VENDOR). El
// precio se recalcula server-side (rareza del item + piso actual), nunca se confía en el que
// mostró el pop-up. Comprar cierra el evento y avanza la sala, igual que cualquier otra decisión.
router.post('/vendor-event-buy', async (req, res, next) => {
  try {
    const itemId = Number(req.body?.itemId);
    if (!itemId) return res.status(400).json({ error: 'itemId requerido' });

    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!run.pending_event_id) return res.status(400).json({ error: 'No hay ningún evento pendiente en esta sala' });
    if (!(await canControlRun(run, req.playerId))) {
      return res.status(403).json({ error: 'Solo quien tiene el control de la corrida (el líder, o alguien vivo si el líder murió) puede decidir esto.' });
    }

    const eventRes = await db.query('SELECT event_type FROM tower_room_events WHERE id = $1', [run.pending_event_id]);
    if (eventRes.rows[0]?.event_type !== 'VENDOR') {
      return res.status(400).json({ error: 'El evento pendiente no es un vendedor' });
    }

    const itemRes = await db.query(
      `SELECT id, name, item_type, rarity FROM items WHERE id = $1 AND item_type IN ('CONSUMABLE','MATERIAL')`,
      [itemId]
    );
    const item = itemRes.rows[0];
    if (!item) return res.status(404).json({ error: 'Ítem no disponible en este vendedor' });

    const price = vendorEventPrice(item.rarity || 'COMUN', run.current_floor);

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    const currentCoins = Number(playerRes.rows[0].dungeon_coins);
    if (currentCoins < price) {
      return res.status(400).json({ error: `Monedas insuficientes (necesitas ${price}, tienes ${currentCoins})` });
    }

    await db.query('UPDATE players SET dungeon_coins = dungeon_coins - $1 WHERE id = $2', [price, req.playerId]);
    await inventory.addItem(req.playerId, item.id, 1);

    await db.query('UPDATE player_tower_runs SET pending_event_id = NULL WHERE id = $1', [run.id]);
    const floorRow = await getFloor(run.current_floor);
    await combatEngine.advanceTowerRoomOrFloor(run, floorRow);

    const updatedRun = (await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id])).rows[0];
    const session = updatedRun.current_session_id ? await combatEngine.fetchSessionState(updatedRun.current_session_id) : null;
    const pendingEvent = updatedRun.pending_event_id
      ? (await db.query('SELECT * FROM tower_room_events WHERE id = $1', [updatedRun.pending_event_id])).rows[0]
      : null;
    const newCoins = currentCoins - price;

    res.json({
      message: `Compraste: ${item.name} por ${price} monedas de mazmorra.`,
      bought: { itemId: item.id, name: item.name, price },
      dungeon_coins: newCoins,
      run: updatedRun,
      session,
      pendingEvent,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/advance — banca la moneda del piso y arma el siguiente
router.post('/advance', async (req, res, next) => {
  try {
    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!(await canControlRun(run, req.playerId))) {
      return res.status(403).json({ error: 'Solo quien tiene el control de la corrida (el líder, o alguien vivo si el líder murió) puede decidir esto.' });
    }
    if (run.current_session_id) {
      return res.status(400).json({ error: 'Todavía hay una sala en curso' });
    }
    if (run.pending_event_id) {
      return res.status(400).json({ error: 'Todavía tienes un evento pendiente por resolver en esta sala' });
    }

    const nextFloor = run.current_floor + 1;
    if (!(await getFloor(nextFloor))) {
      return res.status(500).json({ error: `Piso ${nextFloor} no configurado` });
    }

    await combatEngine.buildTowerRoom(run, nextFloor, 1);

    const updatedRun = (await db.query('SELECT * FROM player_tower_runs WHERE id = $1', [run.id])).rows[0];
    const session = updatedRun.current_session_id ? await combatEngine.fetchSessionState(updatedRun.current_session_id) : null;
    const pendingEvent = updatedRun.pending_event_id
      ? (await db.query('SELECT * FROM tower_room_events WHERE id = $1', [updatedRun.pending_event_id])).rows[0]
      : null;
    res.json({ run: updatedRun, session, pendingEvent });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/extract — cierra la corrida y acredita dungeon_coins
router.post('/extract', async (req, res, next) => {
  try {
    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!(await canControlRun(run, req.playerId))) {
      return res.status(403).json({ error: 'Solo quien tiene el control de la corrida (el líder, o alguien vivo si el líder murió) puede decidir esto.' });
    }
    if (run.current_session_id) {
      return res.status(400).json({ error: 'Todavía hay una sala en curso' });
    }

    await db.query(
      `UPDATE player_tower_runs SET status = 'EXTRACTED', ended_at = now() WHERE id = $1`,
      [run.id]
    );

    // Acreditar dungeon_coins al jugador principal (y a los guests si los hay)
    const allPlayerIds = [run.player_id, run.guest_player_id, run.guest_player_id_2].filter(Boolean);
    const coinsEach = run.coins_earned;
    for (const pid of allPlayerIds) {
      await db.query('UPDATE players SET dungeon_coins = dungeon_coins + $1 WHERE id = $2', [coinsEach, pid]);
      await incrementCounter(pid, 'MAZMORRAS_EXPLORADAS');
    }

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [run.player_id]);
    res.json({
      extracted: true,
      coinsEarned: coinsEach,
      floorReached: run.current_floor,
      dungeon_coins: playerRes.rows[0].dungeon_coins,
    });
  } catch (err) {
    next(err);
  }
});

const SETTLEMENT_HEAL_COST = 10;

// POST /api/player/:playerId/tower/settlement/heal   body: { targetType: 'HERO' | 'NPC', npcId? }
// Enfermera del asentamiento: cura al 100% (no gradual como /guild/heal) por 10 dungeon_coins
// por cabeza, jugador o NPC, sin importar que tan golpeado estaba.
router.post('/settlement/heal', async (req, res, next) => {
  try {
    const { targetType, npcId } = req.body || {};
    if (!['HERO', 'NPC'].includes(targetType)) {
      return res.status(400).json({ error: "targetType debe ser 'HERO' o 'NPC'" });
    }

    const run = await getActiveRun(req.playerId);
    if (!run) return res.status(400).json({ error: 'No tienes una corrida de torre activa' });
    if (!isAtCheckpoint(run)) {
      return res.status(400).json({ error: 'Solo se puede curar en un asentamiento (Ciudad del Abismo)' });
    }

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    const currentCoins = Number(playerRes.rows[0].dungeon_coins);
    if (currentCoins < SETTLEMENT_HEAL_COST) {
      return res.status(400).json({ error: `Necesitas ${SETTLEMENT_HEAL_COST} monedas de mazmorra (tienes ${currentCoins})` });
    }

    let healedState;
    if (targetType === 'HERO') {
      const updated = await db.query(
        'UPDATE players SET hp = max_hp, mana = max_mana WHERE id = $1 RETURNING hp, max_hp, mana, max_mana',
        [req.playerId]
      );
      healedState = updated.rows[0];
    } else {
      const npcCheck = await db.query(
        'SELECT 1 FROM player_party WHERE player_id = $1 AND npc_id = $2',
        [req.playerId, npcId]
      );
      if (!npcCheck.rows.length) return res.status(403).json({ error: 'Ese NPC no es de tu formación' });
      const updated = await db.query(
        'UPDATE player_npcs SET hp = max_hp, mana = max_mana WHERE id = $1 RETURNING hp, max_hp, mana, max_mana',
        [npcId]
      );
      healedState = updated.rows[0];
    }

    const newCoinsRes = await db.query(
      'UPDATE players SET dungeon_coins = dungeon_coins - $1 WHERE id = $2 RETURNING dungeon_coins',
      [SETTLEMENT_HEAL_COST, req.playerId]
    );

    res.json({
      healed: true,
      targetType,
      npcId: targetType === 'NPC' ? Number(npcId) : null,
      hp: healedState.hp,
      maxHp: healedState.max_hp,
      mana: healedState.mana,
      maxMana: healedState.max_mana,
      dungeon_coins: newCoinsRes.rows[0].dungeon_coins,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/vendor — catálogo del vendedor de la torre
router.get('/vendor', async (req, res, next) => {
  try {
    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });

    const shopRes = await db.query(
      `SELECT tvs.id, tvs.price, i.id AS item_id, i.code, i.name, i.description, i.item_type, i.rarity
       FROM tower_vendor_shop tvs
       JOIN items i ON i.id = tvs.item_id
       ORDER BY tvs.price`
    );

    res.json({
      dungeon_coins: playerRes.rows[0].dungeon_coins,
      shop: shopRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/vendor/buy   body: { itemId, quantity? }
router.post('/vendor/buy', async (req, res, next) => {
  try {
    const itemId = Number(req.body?.itemId);
    const quantity = Math.max(1, Number(req.body?.quantity) || 1);
    if (!itemId) return res.status(400).json({ error: 'itemId requerido' });

    const shopRes = await db.query('SELECT price FROM tower_vendor_shop WHERE item_id = $1', [itemId]);
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Ítem no disponible en el vendedor de la torre' });

    const totalCost = shopRes.rows[0].price * quantity;

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (playerRes.rows[0].dungeon_coins < totalCost) {
      return res.status(400).json({ error: `Monedas insuficientes (necesitas ${totalCost}, tienes ${playerRes.rows[0].dungeon_coins})` });
    }

    await db.query('UPDATE players SET dungeon_coins = dungeon_coins - $1 WHERE id = $2', [totalCost, req.playerId]);
    await inventory.addItem(req.playerId, itemId, quantity);

    const newCoins = (await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId])).rows[0].dungeon_coins;
    const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    res.json({
      bought: true,
      item: itemRes.rows[0].name,
      quantity,
      cost: totalCost,
      dungeon_coins: newCoins,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/settlement/shop — catálogo fijo (no random) de los artesanos
// del abismo, precio base escalado por profundidad (mismo criterio que vendorEventPrice). Usa
// el piso de la corrida activa; sin corrida activa no hay profundidad que aplicar.
router.get('/settlement/shop', async (req, res, next) => {
  try {
    const run = await getActiveRun(req.playerId);
    const floorNumber = run ? run.current_floor : 1;
    const mult = depthPriceMultiplier(floorNumber);

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });

    const shopRes = await db.query(
      `SELECT tss.id, tss.base_price, i.id AS item_id, i.code, i.name, i.description, i.item_type, i.rarity
       FROM tower_settlement_shop tss
       JOIN items i ON i.id = tss.item_id
       ORDER BY tss.base_price`
    );

    res.json({
      dungeon_coins: playerRes.rows[0].dungeon_coins,
      floor: floorNumber,
      shop: shopRes.rows.map((r) => ({
        id: r.id,
        itemId: r.item_id,
        code: r.code,
        name: r.name,
        description: r.description,
        itemType: r.item_type,
        rarity: r.rarity,
        price: Math.round(r.base_price * mult),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/settlement/shop/buy   body: { itemId, quantity? }
router.post('/settlement/shop/buy', async (req, res, next) => {
  try {
    const itemId = Number(req.body?.itemId);
    const qty = Math.max(1, Math.min(99, parseInt(req.body?.quantity) || 1));
    if (!itemId) return res.status(400).json({ error: 'itemId requerido' });

    const run = await getActiveRun(req.playerId);
    const floorNumber = run ? run.current_floor : 1;
    const mult = depthPriceMultiplier(floorNumber);

    const shopRes = await db.query('SELECT base_price FROM tower_settlement_shop WHERE item_id = $1', [itemId]);
    if (!shopRes.rows.length) return res.status(404).json({ error: 'Ítem no disponible en esta tienda' });
    const totalCost = Math.round(shopRes.rows[0].base_price * mult) * qty;

    const playerRes = await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId]);
    if (!playerRes.rows.length) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (playerRes.rows[0].dungeon_coins < totalCost) {
      return res.status(400).json({ error: `Monedas insuficientes (necesitas ${totalCost}, tienes ${playerRes.rows[0].dungeon_coins})` });
    }

    await db.query('UPDATE players SET dungeon_coins = dungeon_coins - $1 WHERE id = $2', [totalCost, req.playerId]);
    await inventory.addItem(req.playerId, itemId, qty);

    const newCoins = (await db.query('SELECT dungeon_coins FROM players WHERE id = $1', [req.playerId])).rows[0].dungeon_coins;
    const itemRes = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
    res.json({
      bought: true,
      item: itemRes.rows[0].name,
      quantity: qty,
      cost: totalCost,
      dungeon_coins: newCoins,
    });
  } catch (err) {
    next(err);
  }
});

// ===== Parte 6: reagruparse en el asentamiento (docs/backend-spec-ciudad-del-abismo.md) =====
// No reusa el sistema de invitacion co-op normal (POST /coop/invite) porque ese exige amistad
// -- acá el otro jugador puede ser un desconocido parado al lado en el mismo checkpoint. Al
// aceptar SI se crea el player_coop_group correspondiente (mismo bloque que ya usa
// POST /coop/invite/:id/accept), para que abandonar el grupo despues funcione igual que con
// cualquier otro par co-op -- sin esto quedarian pegados a la corrida compartida para siempre.
const SETTLEMENT_INVITE_TTL_SECONDS = 60;

async function hasCoopGroup(playerId) {
  const res = await db.query('SELECT 1 FROM player_coop_group_members WHERE player_id = $1', [playerId]);
  return res.rows.length > 0;
}

// GET /api/player/:playerId/tower/settlement/nearby — otros jugadores solos (sin grupo co-op)
// parados ahora mismo en el mismo checkpoint que el que pregunta.
router.get('/settlement/nearby', async (req, res, next) => {
  try {
    const myRun = await getActiveRun(req.playerId);
    if (!myRun || !isAtCheckpoint(myRun)) return res.json({ nearby: [] });

    const nearbyRes = await db.query(
      `SELECT p.id AS "playerId", p.nickname, p.level, c.name AS "className"
       FROM player_tower_runs ptr
       JOIN players p ON p.id = ptr.player_id
       JOIN classes c ON c.id = COALESCE(p.evolution_class_id, p.current_class_id)
       WHERE ptr.status = 'IN_PROGRESS' AND ptr.current_session_id IS NULL AND ptr.pending_event_id IS NULL
         AND ptr.guest_player_id IS NULL AND ptr.guest_player_id_2 IS NULL
         AND ptr.current_floor = $1 AND ptr.player_id != $2`,
      [myRun.current_floor, req.playerId]
    );
    res.json({ floor: myRun.current_floor, nearby: nearbyRes.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/settlement/invite   body: { targetPlayerId }
router.post('/settlement/invite', async (req, res, next) => {
  try {
    const targetPlayerId = Number(req.body?.targetPlayerId);
    if (!targetPlayerId) return res.status(400).json({ error: 'targetPlayerId requerido' });
    if (targetPlayerId === req.playerId) return res.status(400).json({ error: 'No puedes invitarte a ti mismo' });

    const myRun = await getActiveRun(req.playerId);
    if (!myRun || !isAtCheckpoint(myRun)) {
      return res.status(400).json({ error: 'Tienes que estar parado en un asentamiento para invitar' });
    }
    const targetRun = await getActiveRun(targetPlayerId);
    if (!targetRun || !isAtCheckpoint(targetRun) || targetRun.current_floor !== myRun.current_floor) {
      return res.status(400).json({ error: 'Ese jugador no está en tu mismo asentamiento ahora mismo' });
    }

    if (await hasCoopGroup(req.playerId)) return res.status(400).json({ error: 'Ya estás en un grupo co-op' });
    if (await hasCoopGroup(targetPlayerId)) return res.status(400).json({ error: 'Ese jugador ya está en un grupo co-op' });

    await db.query(
      `UPDATE tower_settlement_invites SET status='DECLINED'
       WHERE ((leader_id=$1 AND guest_id=$2) OR (leader_id=$2 AND guest_id=$1)) AND status='PENDING'`,
      [req.playerId, targetPlayerId]
    );

    const inv = await db.query(
      `INSERT INTO tower_settlement_invites(leader_id, guest_id, floor, expires_at)
       VALUES ($1, $2, $3, now() + INTERVAL '${SETTLEMENT_INVITE_TTL_SECONDS} seconds')
       RETURNING id, floor, expires_at`,
      [req.playerId, targetPlayerId, myRun.current_floor]
    );
    res.status(201).json(inv.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/player/:playerId/tower/settlement/invite/pending — mismo patron que
// GET /coop/invite/pending, no lo pedia el spec explicitamente pero sin esto no hay forma de
// que el invitado se entere de la invitacion para poder aceptarla.
router.get('/settlement/invite/pending', async (req, res, next) => {
  try {
    const inv = await db.query(
      `SELECT tsi.id, tsi.floor, tsi.expires_at, p.id AS "leaderId", p.nickname AS "leaderNickname", p.level AS "leaderLevel"
       FROM tower_settlement_invites tsi
       JOIN players p ON p.id = tsi.leader_id
       WHERE tsi.guest_id = $1 AND tsi.status = 'PENDING' AND tsi.expires_at > now()
       ORDER BY tsi.created_at DESC LIMIT 1`,
      [req.playerId]
    );
    res.json(inv.rows[0] || null);
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/settlement/invite/:inviteId/decline
router.post('/settlement/invite/:inviteId/decline', async (req, res, next) => {
  try {
    await db.query(
      `UPDATE tower_settlement_invites SET status='DECLINED' WHERE id=$1 AND guest_id=$2 AND status='PENDING'`,
      [req.params.inviteId, req.playerId]
    );
    res.json({ declined: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/player/:playerId/tower/settlement/invite/:inviteId/accept
router.post('/settlement/invite/:inviteId/accept', async (req, res, next) => {
  try {
    const inv = await db.query(
      `UPDATE tower_settlement_invites SET status='ACCEPTED'
       WHERE id=$1 AND guest_id=$2 AND status='PENDING' AND expires_at > now()
       RETURNING leader_id, guest_id, floor`,
      [req.params.inviteId, req.playerId]
    );
    if (!inv.rows.length) return res.status(404).json({ error: 'Invitación no encontrada o expirada' });
    const { leader_id: leaderId, guest_id: guestId, floor } = inv.rows[0];

    // Revalidar: pueden haber avanzado, extraido o muerto mientras la invitacion esperaba.
    const leaderRun = await getActiveRun(leaderId);
    const guestRun = await getActiveRun(guestId);
    if (!leaderRun || !isAtCheckpoint(leaderRun) || leaderRun.current_floor !== floor ||
        !guestRun || !isAtCheckpoint(guestRun) || guestRun.current_floor !== floor) {
      return res.status(400).json({ error: 'Ya no están los dos parados en ese mismo asentamiento' });
    }
    if (await hasCoopGroup(leaderId)) return res.status(400).json({ error: 'El líder ya está en un grupo co-op' });
    if (await hasCoopGroup(guestId)) return res.status(400).json({ error: 'Ya estás en un grupo co-op' });

    await closeRunAsExtracted(leaderRun);
    await closeRunAsExtracted(guestRun);

    const newRunRes = await db.query(
      `INSERT INTO player_tower_runs(player_id, guest_player_id, difficulty, current_floor, current_room, coins_earned, last_banked_floor, status)
       VALUES ($1, $2, 1, $3, 1, 0, $3, 'IN_PROGRESS') RETURNING *`,
      [leaderId, guestId, floor]
    );
    const newRun = newRunRes.rows[0];

    // Agruparlos como cualquier otro par co-op (mismo bloque que POST /coop/invite/:id/accept).
    const group = await db.query('INSERT INTO player_coop_groups(leader_id) VALUES($1) RETURNING id', [leaderId]);
    await db.query(
      'INSERT INTO player_coop_group_members(group_id, player_id) VALUES ($1,$2), ($1,$3)',
      [group.rows[0].id, leaderId, guestId]
    );

    res.json({ run: newRun, checkpoint: checkpointInfo(newRun) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
