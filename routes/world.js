const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const inventory = require('../lib/inventory');
const { nodesOf, NODE_TYPES, findNode, rollLoot, spotFor } = require('../lib/worldNodes');
const { spendCurrency } = require('../lib/currency');
const aurelia = require('../lib/aurelia');

// Mundo 2D: recursos que se recolectan caminando (ver lib/worldNodes.js)
const router = express.Router({ mergeParams: true });
router.use(requireAuth);
router.use(requireSelf);

// La tabla se crea sola la primera vez (también está en db/schema.sql para instalaciones nuevas)
let ready = null;
function ensureTable() {
  ready ??= db.query(`
    CREATE TABLE IF NOT EXISTS world_node_gathers (
      player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      node_id     TEXT    NOT NULL,
      gathered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (player_id, node_id)
    )`).catch((err) => { ready = null; throw err; });
  return ready;
}

// GET /api/player/:playerId/world/nodes?zone=1 — estado de cada recurso de la zona para este jugador
router.get('/nodes', async (req, res, next) => {
  try {
    await ensureTable();
    const zone = Number(req.query.zone) || 1;
    const nodes = nodesOf(zone);
    const rows = await db.query(
      'SELECT node_id, gathered_at FROM world_node_gathers WHERE player_id = $1 AND node_id = ANY($2::text[])',
      [req.playerId, Object.keys(nodes)]
    );
    const last = Object.fromEntries(rows.rows.map((r) => [r.node_id, r.gathered_at]));
    const now = Date.now();
    // spot: en cuál de sus sitios posibles está ahora para este jugador
    res.json(Object.entries(nodes).map(([id, [type, spots]]) => {
      const readyAt = last[id] ? new Date(last[id]).getTime() + NODE_TYPES[type].respawnSeconds * 1000 : 0;
      return {
        id, type, ready: readyAt <= now, readyAt: readyAt > now ? new Date(readyAt).toISOString() : null,
        spot: spotFor(req.playerId, id, spots, last[id]),
      };
    }));
  } catch (err) { next(err); }
});

// POST /api/player/:playerId/world/nodes/:nodeId/gather — recolecta (una vez por reaparición)
router.post('/nodes/:nodeId/gather', async (req, res, next) => {
  try {
    await ensureTable();
    const node = findNode(req.params.nodeId);
    if (!node) return res.status(404).json({ error: 'Ese recurso no existe' });

    // reclamo atómico: solo pasa si nunca se recolectó o si ya reapareció
    const claim = await db.query(
      `INSERT INTO world_node_gathers (player_id, node_id, gathered_at) VALUES ($1, $2, now())
       ON CONFLICT (player_id, node_id) DO UPDATE SET gathered_at = now()
       WHERE world_node_gathers.gathered_at <= now() - make_interval(secs => $3::double precision)
       RETURNING gathered_at`,
      [req.playerId, req.params.nodeId, node.def.respawnSeconds]
    );
    if (!claim.rows.length) return res.status(409).json({ error: 'Todavía no ha vuelto a crecer.' });

    const { drops, gold } = rollLoot(node.def);
    const items = [];
    if (drops.length) {
      const found = await db.query('SELECT id, code, name, rarity FROM items WHERE code = ANY($1::text[])', [drops.map((d) => d.item)]);
      const byCode = Object.fromEntries(found.rows.map((r) => [r.code, r]));
      for (const d of drops) {
        const it = byCode[d.item];
        if (!it) continue;
        await inventory.addItem(req.playerId, it.id, d.quantity);
        items.push({ code: it.code, name: it.name, rarity: it.rarity, quantity: d.quantity });
      }
    }
    if (gold) await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [gold, req.playerId]);

    const readyAt = new Date(new Date(claim.rows[0].gathered_at).getTime() + node.def.respawnSeconds * 1000);
    // cuando reaparezca lo hará en otro de sus sitios
    const spot = spotFor(req.playerId, req.params.nodeId, node.spots, claim.rows[0].gathered_at);
    res.json({ node: req.params.nodeId, type: node.type, items, gold, readyAt: readyAt.toISOString(), spot });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- Aurelia
// GET /world/ofrenda — estado de la bendición del Pilar de Aethra
router.get('/ofrenda', async (req, res, next) => {
  try {
    await aurelia.ensureTables();
    const r = await db.query('SELECT bonus, expires_at, offered_day = CURRENT_DATE AS today FROM player_blessings WHERE player_id = $1', [req.playerId]);
    const b = r.rows[0];
    res.json({
      cost: aurelia.OFRENDA_COST, festival: aurelia.isFestival(),
      active: !!b && new Date(b.expires_at) > new Date(), bonus: b ? Number(b.bonus) : 0, expiresAt: b?.expires_at ?? null,
      offeredToday: !!b?.today,
    });
  } catch (err) { next(err); }
});

// POST /world/ofrenda — una ofrenda al día: cobra el oro y da la bendición (+XP en combate)
router.post('/ofrenda', async (req, res, next) => {
  try {
    await aurelia.ensureTables();
    const festival = aurelia.isFestival();
    const { bonus, minutes } = aurelia.blessingFor(festival);
    const done = await db.query('SELECT 1 FROM player_blessings WHERE player_id = $1 AND offered_day = CURRENT_DATE', [req.playerId]);
    if (done.rows.length) return res.status(400).json({ error: 'Ya hiciste tu ofrenda de hoy. Vuelve mañana.' });
    const gold = await spendCurrency(req.playerId, 'gold', aurelia.OFRENDA_COST);
    if (gold == null) return res.status(400).json({ error: `Necesitas ${aurelia.OFRENDA_COST} de oro para la ofrenda` });
    const r = await db.query(
      `INSERT INTO player_blessings (player_id, bonus, expires_at, offered_day)
       VALUES ($1, $2, now() + ($3 || ' minutes')::interval, CURRENT_DATE)
       ON CONFLICT (player_id) DO UPDATE SET bonus = $2, expires_at = now() + ($3 || ' minutes')::interval, offered_day = CURRENT_DATE
       RETURNING bonus, expires_at`,
      [req.playerId, bonus, String(minutes)]
    );
    res.json({ cost: aurelia.OFRENDA_COST, festival, active: true, bonus: Number(r.rows[0].bonus), expiresAt: r.rows[0].expires_at, offeredToday: true, gold });
  } catch (err) { next(err); }
});

// GET /world/libro — libro de visitas de El Grifo Dorado (las últimas firmas)
router.get('/libro', async (req, res, next) => {
  try {
    await aurelia.ensureTables();
    const r = await db.query(
      `SELECT g.id, g.text, g.created_at, p.nickname, p.level FROM world_guestbook g JOIN players p ON p.id = g.player_id
       ORDER BY g.id DESC LIMIT 40`
    );
    res.json(r.rows);
  } catch (err) { next(err); }
});

// POST /world/libro { text } — una firma cada 10 minutos por jugador
router.post('/libro', async (req, res, next) => {
  const text = String(req.body?.text ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
  if (!text) return res.status(400).json({ error: 'Escribe algo para firmar' });
  try {
    await aurelia.ensureTables();
    const last = await db.query("SELECT 1 FROM world_guestbook WHERE player_id = $1 AND created_at > now() - interval '10 minutes'", [req.playerId]);
    if (last.rows.length) return res.status(400).json({ error: 'Ya firmaste hace poco. Espera unos minutos.' });
    await db.query('INSERT INTO world_guestbook (player_id, text) VALUES ($1, $2)', [req.playerId, text]);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /world/viaje { destino } — la diligencia de Gaspar (cobra el pasaje y dice dónde te deja)
router.post('/viaje', async (req, res, next) => {
  const dest = aurelia.DESTINOS[req.body?.destino];
  if (!dest) return res.status(400).json({ error: 'Destino desconocido' });
  try {
    const gold = await spendCurrency(req.playerId, 'gold', aurelia.VIAJE_COST);
    if (gold == null) return res.status(400).json({ error: `El pasaje cuesta ${aurelia.VIAJE_COST} de oro` });
    res.json({ ok: true, gold, ...dest });
  } catch (err) { next(err); }
});

module.exports = router;
