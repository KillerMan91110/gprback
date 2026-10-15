// Comercio directo entre dos jugadores del mundo 2D (como la ventana de comercio de WoW, con la
// pantalla de confirmación de RuneScape). Todo pasa por socket:
//
// Cliente → servidor (todos con ack)            Servidor → clientes
//   trade:request  { to }                         trade:requested { from: {id, name} }   (al invitado)
//   trade:respond  { from, accept }               trade:open / trade:update { ...estado } (a los dos)
//   trade:offer    { items: [...], gold }         trade:declined { by }                   (al que pidió)
//   trade:ready                                   trade:closed { reason, by }             (a los dos)
//   trade:unready  (volver a la oferta)           trade:done { received, given }          (a cada uno)
//   trade:confirm
//   trade:cancel
//
// Reglas:
//  - solo entre jugadores que están en el mundo, en la misma zona y cerca (REQUEST_PX)
//  - nadie en combate; un comercio a la vez por jugador
//  - hasta MAX_SLOTS objetos (pilas) y el oro que tengas; también cartas de monstruo del álbum
//    (las engarzadas no: hay que quitarlas primero, igual que en el mercado)
//  - paso 1 "Listo": cualquier cambio en cualquiera de las dos ofertas lo apaga para los dos
//  - si alguien QUITA algo de su oferta, el otro lo ve marcado (contra las estafas)
//  - paso 2 "Confirmar": ya no se puede cambiar nada; cuando los dos confirman, el servidor
//    vuelve a comprobar todo y hace el cambio en una sola transacción (o no hace nada)
const db = require('../db/db');
const inventory = require('./inventory');
const { positionOf } = require('./worldPresence');
const col = require('./coleccion');

const TILE = 32;
const REQUEST_PX = 6 * TILE; // para pedir y aceptar: a la vista, uno al lado del otro
const KEEP_PX = 12 * TILE; // si se alejan más que esto, el comercio se cancela al confirmar
const MAX_SLOTS = 8;
const REQUEST_TTL_MS = 30 * 1000;
const MAX_GOLD = 1e12;

// tradeId → comercio; playerId → tradeId; invitado → { from, at }
const trades = new Map();
const byPlayer = new Map();
const requests = new Map();
let nextId = 1;

let ready = null;
function ensureTables() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS player_trades (
      id         SERIAL PRIMARY KEY,
      player_a   INTEGER REFERENCES players(id) ON DELETE SET NULL,
      player_b   INTEGER REFERENCES players(id) ON DELETE SET NULL,
      offer_a    JSONB NOT NULL,
      offer_b    JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

const near = (a, b, px) => {
  const pa = positionOf(a);
  const pb = positionOf(b);
  return !!pa && !!pb && pa.zone === pb.zone && Math.hypot(pa.x - pb.x, pa.y - pb.y) <= px;
};

async function inCombat(playerId) {
  const r = await db.query(
    `SELECT 1 FROM combat_participants cp JOIN combat_sessions cs ON cs.id = cp.session_id
     WHERE cp.player_id = $1 AND cs.status = 'IN_PROGRESS' AND cp.hp > 0
       AND NOT EXISTS (SELECT 1 FROM combat_abandoned_players cap WHERE cap.session_id = cs.id AND cap.player_id = $1)
     LIMIT 1`,
    [playerId]
  );
  return r.rows.length > 0;
}

async function nameOf(playerId) {
  const r = await db.query('SELECT nickname FROM players WHERE id = $1', [playerId]);
  return r.rows[0]?.nickname ?? 'Alguien';
}

const keyOf = (it) => (it.kind === 'card' ? `c:${it.monsterId}` : `${it.itemId}:${it.enchantLevel}:${it.qualityTier}`);
const emptyOffer = () => ({ items: [], gold: 0, removed: [] });

// lo que ve cada uno: su lado y el del otro
function viewFor(t, pid) {
  const other = pid === t.a ? t.b : t.a;
  return {
    id: t.id,
    stage: t.stage,
    me: { id: pid, name: t.names[pid], ...t.offers[pid], ready: !!t.ready[pid], confirmed: !!t.confirmed[pid] },
    them: { id: other, name: t.names[other], ...t.offers[other], ready: !!t.ready[other], confirmed: !!t.confirmed[other] },
  };
}

function attachTrade(io) {
  const emitTo = (pid, ev, payload) => io.to(`player:${pid}`).emit(ev, payload);
  const broadcast = (t, ev = 'trade:update') => { emitTo(t.a, ev, viewFor(t, t.a)); emitTo(t.b, ev, viewFor(t, t.b)); };

  const close = (t, reason, by) => {
    if (!t || !trades.has(t.id)) return;
    trades.delete(t.id);
    byPlayer.delete(t.a);
    byPlayer.delete(t.b);
    emitTo(t.a, 'trade:closed', { reason, by });
    emitTo(t.b, 'trade:closed', { reason, by });
  };

  // cualquier cambio de oferta apaga el "Listo" y la confirmación de los dos
  const reset = (t) => { t.ready = {}; t.confirmed = {}; t.stage = 'offer'; };

  // Valida y arma la oferta con los datos de cada objeto (para que el otro lo dibuje)
  async function buildOffer(pid, raw) {
    const list = Array.isArray(raw?.items) ? raw.items.slice(0, MAX_SLOTS + 1) : [];
    if (list.length > MAX_SLOTS) throw new Error(`Puedes ofrecer hasta ${MAX_SLOTS} objetos`);
    const merged = new Map();
    for (const it of list) {
      const quantity = Math.floor(Number(it?.quantity));
      const e = it?.kind === 'card'
        ? { kind: 'card', monsterId: Number(it?.monsterId), quantity }
        : { itemId: Number(it?.itemId), enchantLevel: Number(it?.enchantLevel) || 0, qualityTier: Number(it?.qualityTier) || 0, quantity };
      const id = e.kind === 'card' ? e.monsterId : e.itemId;
      if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(quantity) || quantity <= 0) throw new Error('Objeto inválido');
      const k = keyOf(e);
      merged.set(k, { ...e, quantity: (merged.get(k)?.quantity ?? 0) + quantity });
    }
    const items = [];
    for (const e of merged.values()) {
      if (e.kind === 'card') {
        // solo las copias sueltas del álbum (las engarzadas están en player_card_sockets)
        const c = await db.query(
          `SELECT m.id, m.code, m.name, m.rarity, m.category, COALESCE(pc.quantity, 0) AS quantity
           FROM monsters m LEFT JOIN player_cards pc ON pc.monster_id = m.id AND pc.player_id = $1 WHERE m.id = $2`,
          [pid, e.monsterId]
        );
        if (!c.rows.length) throw new Error('Esa carta no existe');
        const m = c.rows[0];
        if (Number(m.quantity) < e.quantity) throw new Error('No tienes tantas copias de esa carta en el álbum');
        items.push({ ...e, name: `Carta de ${m.name}`, monsterName: m.name, code: m.code, rarity: col.rarityOf(m), ...col.cardOf(m) });
        continue;
      }
      const have = await inventory.getQuantity(pid, e.itemId, e.enchantLevel, e.qualityTier);
      if (have < e.quantity) throw new Error('No tienes esa cantidad en la mochila');
      const info = await db.query('SELECT name, rarity, item_type, slot, code, is_quest_item FROM items WHERE id = $1', [e.itemId]);
      if (!info.rows.length) throw new Error('Ese objeto no existe');
      const r = info.rows[0];
      if (r.is_quest_item) throw new Error(`${r.name} es un objeto de misión: no se puede regalar ni comerciar.`);
      items.push({ ...e, name: r.name, rarity: r.rarity, itemType: r.item_type, slot: r.slot, code: r.code });
    }
    const gold = Math.max(0, Math.min(MAX_GOLD, Math.floor(Number(raw?.gold) || 0)));
    const g = await db.query('SELECT gold FROM players WHERE id = $1', [pid]);
    if (Number(g.rows[0]?.gold ?? 0) < gold) throw new Error('No tienes tanto oro');
    return { items, gold };
  }

  // El intercambio de verdad: todo o nada
  async function execute(t) {
    await ensureTables();
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      // bloquea a los dos jugadores en orden fijo (evita interbloqueos)
      await client.query('SELECT id, gold FROM players WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE', [[t.a, t.b]]);
      for (const [from, to] of [[t.a, t.b], [t.b, t.a]]) {
        const o = t.offers[from];
        for (const it of o.items) {
          if (it.kind === 'card') {
            const took = await client.query(
              'UPDATE player_cards SET quantity = quantity - $3 WHERE player_id = $1 AND monster_id = $2 AND quantity >= $3 RETURNING quantity',
              [from, it.monsterId, it.quantity]
            );
            if (!took.rows.length) throw new Error(`${t.names[from]} ya no tiene ${it.quantity}x ${it.name}`);
            await col.giveCard(to, it.monsterId, it.quantity, client);
            continue;
          }
          const have = await client.query(
            `SELECT quantity FROM player_inventory WHERE player_id = $1 AND item_id = $2 AND enchant_level = $3 AND quality_tier = $4 FOR UPDATE`,
            [from, it.itemId, it.enchantLevel, it.qualityTier]
          );
          if (Number(have.rows[0]?.quantity ?? 0) < it.quantity) throw new Error(`${t.names[from]} ya no tiene ${it.quantity}x ${it.name}`);
          await inventory.removeItem(from, it.itemId, it.quantity, it.enchantLevel, it.qualityTier, client);
          await inventory.addItem(to, it.itemId, it.quantity, it.enchantLevel, it.qualityTier, client);
        }
        if (o.gold > 0) {
          const paid = await client.query('UPDATE players SET gold = gold - $1, updated_at = now() WHERE id = $2 AND gold >= $1 RETURNING gold', [o.gold, from]);
          if (!paid.rows.length) throw new Error(`${t.names[from]} ya no tiene ese oro`);
          await client.query('UPDATE players SET gold = gold + $1, updated_at = now() WHERE id = $2', [o.gold, to]);
        }
      }
      const strip = (o) => ({ gold: o.gold, items: o.items.map(({ kind, monsterId, itemId, name, quantity, enchantLevel, qualityTier }) => (kind === 'card' ? { kind, monsterId, name, quantity } : { itemId, name, quantity, enchantLevel, qualityTier })) });
      await client.query('INSERT INTO player_trades (player_a, player_b, offer_a, offer_b) VALUES ($1, $2, $3, $4)',
        [t.a, t.b, JSON.stringify(strip(t.offers[t.a])), JSON.stringify(strip(t.offers[t.b]))]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  io.on('connection', (socket) => {
    const me = socket.playerId;
    const tradeOf = () => trades.get(byPlayer.get(me));
    const fail = (ack, msg) => (typeof ack === 'function' ? ack({ error: msg }) : null);
    const ok = (ack, extra = {}) => (typeof ack === 'function' ? ack({ ok: true, ...extra }) : null);

    socket.on('trade:request', async (data, ack) => {
      try {
        const to = Number(data?.to);
        if (!to || to === me) return fail(ack, 'Elige a otro jugador');
        if (byPlayer.has(me)) return fail(ack, 'Ya estás comerciando');
        if (byPlayer.has(to)) return fail(ack, 'Ese jugador ya está comerciando con alguien');
        if (!near(me, to, REQUEST_PX)) return fail(ack, 'Acércate más para comerciar');
        if (await inCombat(me) || await inCombat(to)) return fail(ack, 'No se puede comerciar en combate');
        requests.set(to, { from: me, at: Date.now() });
        emitTo(to, 'trade:requested', { from: { id: me, name: await nameOf(me) } });
        ok(ack);
      } catch (err) { fail(ack, err.message); }
    });

    socket.on('trade:respond', async (data, ack) => {
      try {
        const from = Number(data?.from);
        const req = requests.get(me);
        if (!req || req.from !== from || Date.now() - req.at > REQUEST_TTL_MS) return fail(ack, 'La solicitud ya no está vigente');
        requests.delete(me);
        if (!data?.accept) { emitTo(from, 'trade:declined', { by: await nameOf(me) }); return ok(ack); }
        if (byPlayer.has(me) || byPlayer.has(from)) return fail(ack, 'Uno de los dos ya está comerciando');
        if (!near(me, from, REQUEST_PX)) return fail(ack, 'Se alejaron demasiado para comerciar');
        const t = {
          id: nextId++, a: from, b: me, stage: 'offer',
          names: { [from]: await nameOf(from), [me]: await nameOf(me) },
          offers: { [from]: emptyOffer(), [me]: emptyOffer() }, ready: {}, confirmed: {},
        };
        trades.set(t.id, t);
        byPlayer.set(from, t.id);
        byPlayer.set(me, t.id);
        broadcast(t, 'trade:open');
        ok(ack);
      } catch (err) { fail(ack, err.message); }
    });

    socket.on('trade:offer', async (data, ack) => {
      const t = tradeOf();
      if (!t) return fail(ack, 'No estás comerciando');
      if (t.stage !== 'offer') return fail(ack, 'Ya están confirmando: vuelve a la oferta para cambiarla');
      try {
        const prev = t.offers[me];
        const next = await buildOffer(me, data);
        // lo que quitó (o bajó de cantidad) queda marcado para el otro
        const nowKeys = new Map(next.items.map((i) => [keyOf(i), i.quantity]));
        const removed = prev.items
          .filter((i) => (nowKeys.get(keyOf(i)) ?? 0) < i.quantity)
          .map((i) => ({ kind: i.kind, name: i.name, rarity: i.rarity, itemType: i.itemType, slot: i.slot, quantity: i.quantity - (nowKeys.get(keyOf(i)) ?? 0) }));
        if (next.gold < prev.gold) removed.push({ name: 'Oro', gold: prev.gold - next.gold });
        t.offers[me] = { ...next, removed: [...prev.removed, ...removed].slice(-6) };
        reset(t);
        broadcast(t);
        ok(ack);
      } catch (err) { fail(ack, err.message); }
    });

    socket.on('trade:ready', (_d, ack) => {
      const t = tradeOf();
      if (!t || t.stage !== 'offer') return fail(ack, 'No se puede ahora');
      if (!t.offers[t.a].items.length && !t.offers[t.a].gold && !t.offers[t.b].items.length && !t.offers[t.b].gold) {
        return fail(ack, 'Ofrezcan algo primero');
      }
      t.ready[me] = true;
      if (t.ready[t.a] && t.ready[t.b]) t.stage = 'confirm';
      broadcast(t);
      ok(ack);
    });

    socket.on('trade:unready', (_d, ack) => {
      const t = tradeOf();
      if (!t) return fail(ack, 'No estás comerciando');
      reset(t);
      broadcast(t);
      ok(ack);
    });

    socket.on('trade:confirm', async (_d, ack) => {
      const t = tradeOf();
      if (!t || t.stage !== 'confirm') return fail(ack, 'Primero tienen que estar los dos listos');
      t.confirmed[me] = true;
      if (!(t.confirmed[t.a] && t.confirmed[t.b])) { broadcast(t); return ok(ack); }
      // los dos confirmaron: se comprueba todo de nuevo y se hace el cambio
      try {
        if (!near(t.a, t.b, KEEP_PX)) throw new Error('Se alejaron demasiado');
        if (await inCombat(t.a) || await inCombat(t.b)) throw new Error('Alguien entró en combate');
        t.stage = 'done';
        await execute(t);
        trades.delete(t.id);
        byPlayer.delete(t.a);
        byPlayer.delete(t.b);
        const summary = (pid) => {
          const other = pid === t.a ? t.b : t.a;
          return { with: t.names[other], received: t.offers[other], given: t.offers[pid] };
        };
        emitTo(t.a, 'trade:done', summary(t.a));
        emitTo(t.b, 'trade:done', summary(t.b));
        ok(ack);
      } catch (err) {
        close(t, `No se pudo completar: ${err.message}`);
        fail(ack, err.message);
      }
    });

    socket.on('trade:cancel', async (_d, ack) => {
      const t = tradeOf();
      if (t) close(t, 'cancelado', await nameOf(me));
      requests.delete(me);
      ok(ack);
    });

    // si se va del mundo (cierra la pestaña, se corta) el comercio se cancela
    socket.on('disconnect', () => {
      const t = tradeOf();
      if (!t) return;
      // otra pestaña del mismo jugador sigue conectada: no se cancela
      const stillHere = [...io.sockets.sockets.values()].some((s) => s.playerId === me && s.id !== socket.id);
      if (!stillHere) close(t, 'se desconectó', t.names[me]);
    });
  });
}

module.exports = { attachTrade, ensureTables };
