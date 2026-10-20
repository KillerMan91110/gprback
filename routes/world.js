const express = require('express');
const db = require('../db/db');
const { requireAuth, requireSelf } = require('../lib/auth');
const inventory = require('../lib/inventory');
const { nodesOf, NODE_TYPES, findNode, rollLoot, spotFor } = require('../lib/worldNodes');
const { spendCurrency } = require('../lib/currency');
const aurelia = require('../lib/aurelia');
const guia = require('../lib/guia');
const exploracion = require('../lib/exploracion');
const eventos = require('../lib/eventos');
const piedra = require('../lib/piedraRegreso');
const guildContracts = require('../lib/guildContracts');
const { lejosDe } = require('../lib/cercania');
const tormenta = require('../lib/tormenta');
const brasas = require('../lib/brasas');
const frio = require('../lib/frio');
const trineos = require('../lib/trineos');
const barca = require('../lib/barca');
const botes = require('../lib/botes');
const barco = require('../lib/barco');
const marea = require('../lib/marea');

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
    // las pozas de marea quedan bajo el agua con la marea alta (lib/marea.js)
    if (marea.SOLO_BAJA.has(node.type) && !marea.bajaConGracia()) {
      return res.status(409).json({ error: 'La marea está alta: la poza está bajo el agua. Vuelve cuando baje.' });
    }

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
    // encargo semanal del gremio "Provisiones para el gremio" (si lo tiene esta semana)
    guildContracts.addProgressFor(req.playerId, 'recolectar', 1);

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
// Exploración (lib/exploracion.js): niebla del mapa, subzonas descubiertas y cofres secretos
// GET  /api/player/:playerId/world/mapa                 todo lo explorado (por zona) y secretos abiertos
// POST /api/player/:playerId/world/mapa/celdas          { zona, celdas (base64) } suma lo recorrido
// POST /api/player/:playerId/world/mapa/descubrir       { zona, subzona } primera visita (da XP)
// POST /api/player/:playerId/world/secreto              { id } abre un cofre secreto (una vez)
router.get('/mapa', async (req, res, next) => {
  try { res.json(await exploracion.state(req.playerId)); } catch (err) { next(err); }
});
router.post('/mapa/celdas', async (req, res, next) => {
  try {
    const r = await exploracion.saveCells(req.playerId, req.body?.zona, req.body?.celdas);
    if (!r) return res.status(400).json({ error: 'Datos de exploración inválidos' });
    res.json(r);
  } catch (err) { next(err); }
});
router.post('/mapa/descubrir', async (req, res, next) => {
  try { res.json(await exploracion.discover(req.playerId, String(req.body?.zona ?? ''), String(req.body?.subzona ?? ''))); } catch (err) { next(err); }
});
router.post('/secreto', async (req, res, next) => {
  try {
    const r = await exploracion.openSecret(req.playerId, String(req.body?.id ?? ''));
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (err) { next(err); }
});

// Mercader ambulante (lib/eventos.js): miércoles y sábados de 18 a 21 en la plaza de Aurelia
// GET  /api/player/:playerId/world/ambulante           ofertas de hoy (y cuántas te quedan)
// POST /api/player/:playerId/world/ambulante/comprar   { oferta }
router.get('/ambulante', async (req, res, next) => {
  try { res.json(await eventos.offers(req.playerId)); } catch (err) { next(err); }
});
router.post('/ambulante/comprar', async (req, res, next) => {
  try {
    const r = await eventos.buy(req.playerId, String(req.body?.oferta ?? ''));
    if (r.error) return res.status(400).json(r);
    res.json(r);
  } catch (err) { next(err); }
});

// Guía del aventurero (lib/guia.js): la primera hora del jugador, paso a paso
// GET  /api/player/:playerId/world/guia           estado (paso actual, ventanas encendidas)
// POST /api/player/:playerId/world/guia/avanzar   { paso } — si es el paso actual, avanza y paga
// POST /api/player/:playerId/world/guia/saltar    termina la guía (se enciende toda la barra)
router.get('/guia', async (req, res, next) => {
  try { res.json(await guia.state(req.playerId)); } catch (err) { next(err); }
});
router.post('/guia/avanzar', async (req, res, next) => {
  try { res.json(await guia.advance(req.playerId, String(req.body?.paso ?? ''))); } catch (err) { next(err); }
});
router.post('/guia/saltar', async (req, res, next) => {
  try { res.json(await guia.skip(req.playerId)); } catch (err) { next(err); }
});

// POST /api/player/:playerId/world/revivir — caíste en el mundo 2D: despiertas en tu refugio (el
// Pilar o la última fogata) con la mitad de la vida y del maná, igual tus compañeros caídos, y
// pierdes un 5% del oro (como mucho 100 por nivel). Solo si de verdad estás en 0.
const REVIVE_GOLD_PCT = 0.05;
router.post('/revivir', async (req, res, next) => {
  try {
    const r = await db.query('SELECT hp, gold, level FROM players WHERE id = $1', [req.playerId]);
    const p = r.rows[0];
    if (!p) return res.status(404).json({ error: 'Jugador no encontrado' });
    if (p.hp > 0) return res.json({ revived: false, goldLost: 0 });
    // caer contra el jefe mítico es parte de la cacería: no cuesta oro
    const last = await db.query(
      `SELECT cs.mythic_hunt_id, cs.world_boss_event_id FROM combat_sessions cs
       JOIN combat_participants cp ON cp.session_id = cs.id
       WHERE cp.player_id = $1 ORDER BY cs.id DESC LIMIT 1`,
      [req.playerId]
    );
    const huntFall = !!(last.rows[0]?.mythic_hunt_id || last.rows[0]?.world_boss_event_id);
    const lost = huntFall ? 0 : Math.min(Math.floor(Number(p.gold) * REVIVE_GOLD_PCT), 100 * p.level);
    const upd = await db.query(
      `UPDATE players SET hp = CEIL(max_hp * 0.5)::int, mana = GREATEST(mana, CEIL(max_mana * 0.5)::int),
         gold = GREATEST(0, gold - $2), updated_at = now()
       WHERE id = $1 AND hp <= 0 RETURNING hp, max_hp, gold`,
      [req.playerId, lost]
    );
    if (!upd.rows.length) return res.json({ revived: false, goldLost: 0 });
    await db.query('UPDATE player_npcs SET hp = CEIL(max_hp * 0.5)::int WHERE player_id = $1 AND hp <= 0', [req.playerId]);
    res.json({ revived: true, goldLost: lost, hp: upd.rows[0].hp, maxHp: upd.rows[0].max_hp, gold: upd.rows[0].gold });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- piedra de regreso
// GET /world/piedra — a qué estatua está vinculada y cuándo vuelve a estar lista
router.get('/piedra', async (req, res, next) => {
  try {
    res.json(await piedra.get(req.playerId));
  } catch (err) { next(err); }
});

// POST /world/piedra/vincular { vinculo } — vincula la piedra a la estatua de una ciudad grande
router.post('/piedra/vincular', async (req, res, next) => {
  const vinculo = String(req.body?.vinculo ?? '');
  if (!piedra.VINCULOS[vinculo]) return res.status(400).json({ error: 'Aquí no hay ninguna Estatua del Viajero' });
  const lejos = lejosDe(req.playerId, [`estatua_${vinculo}`]);
  if (lejos) return res.status(403).json({ error: lejos, lejos: true });
  try {
    res.json(await piedra.vincular(req.playerId, vinculo));
  } catch (err) { next(err); }
});

// POST /world/piedra/usar — gasta la carga (20 min de recarga) y dice adónde te lleva
router.post('/piedra/usar', async (req, res, next) => {
  try {
    const r = await piedra.usar(req.playerId);
    if (r?.sinVincular) {
      return res.status(409).json({ error: `Tu piedra todavía no está vinculada. Vincúlala en la Estatua del Viajero de ${r.estatua.nombre} (${r.estatua.lugar}).`, ...r });
    }
    if (!r) {
      const st = await piedra.get(req.playerId);
      const min = st.readyAt ? Math.max(1, Math.ceil((new Date(st.readyAt).getTime() - Date.now()) / 60000)) : 1;
      return res.status(409).json({ error: `La piedra todavía no tiene fuerza. Le falta${min === 1 ? '' : 'n'} ${min} min.`, ...st });
    }
    res.json(r);
  } catch (err) { next(err); }
});

router.post('/viaje', async (req, res, next) => {
  const dest = aurelia.DESTINOS[req.body?.destino];
  if (!dest) return res.status(400).json({ error: 'Destino desconocido' });
  // se sube a la diligencia donde está Gaspar: en la capital para ir a la aldea y al revés
  const lejos = lejosDe(req.playerId, [req.body.destino === 'aldea' ? 'gaspar_aurelia' : 'gaspar_aldea']);
  if (lejos) return res.status(403).json({ error: lejos, lejos: true });
  try {
    const gold = await spendCurrency(req.playerId, 'gold', aurelia.VIAJE_COST);
    if (gold == null) return res.status(400).json({ error: `El pasaje cuesta ${aurelia.VIAJE_COST} de oro` });
    res.json({ ok: true, gold, ...dest });
  } catch (err) { next(err); }
});

// POST /world/vagoneta { destino } — viaje rápido entre las estaciones de las Montañas (lib/tormenta.js)
router.post('/vagoneta', async (req, res, next) => {
  try {
    const r = await tormenta.viajar(req.playerId, String(req.body?.destino ?? ''));
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error, ...(r.lejos ? { lejos: true } : {}) });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/rayo — te alcanzó un rayo de la tormenta (Cumbre y Acantilados): te quita vida
router.post('/rayo', async (req, res, next) => {
  try {
    const r = await tormenta.rayo(req.playerId);
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/balsa { destino } — viaje rápido entre los muelles de los Ríos de Lava (lib/brasas.js)
router.post('/balsa', async (req, res, next) => {
  try {
    const r = await brasas.viajar(req.playerId, String(req.body?.destino ?? ''));
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error, ...(r.lejos ? { lejos: true } : {}) });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/bote { destino } — los botes de Marul entre Coralia, la Cala y el Cementerio (lib/botes.js)
router.post('/bote', async (req, res, next) => {
  try {
    const r = await botes.viajar(req.playerId, String(req.body?.destino ?? ''));
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error, ...(r.lejos ? { lejos: true } : {}) });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/barco { destino } — La Gaviota Insolente de Rhaegar: Puerto Antiguo ↔ Fiordo Blanco (lib/barco.js)
router.post('/barco', async (req, res, next) => {
  try {
    const r = await barco.viajar(req.playerId, String(req.body?.destino ?? ''));
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error, ...(r.lejos ? { lejos: true } : {}) });
    res.json(r);
  } catch (err) { next(err); }
});

// GET /world/marea — cómo está la marea de las Costas (lib/marea.js), para sincronizar el reloj del front
router.get('/marea', (req, res) => res.json({ ...marea.estado(), ahora: Date.now() }));

// POST /world/brasa — te alcanzó una brasa del volcán (Ríos, Grieta y Caldera): te quita vida
router.post('/brasa', async (req, res, next) => {
  try {
    const r = await brasas.brasa(req.playerId);
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/trineo { destino } — los trineos de Skadi: Fiordo Blanco, la Aldea y el Campamento (lib/trineos.js)
router.post('/trineo', async (req, res, next) => {
  try {
    const r = await trineos.viajar(req.playerId, String(req.body?.destino ?? ''));
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error, ...(r.lejos ? { lejos: true } : {}) });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/barca { destino } — la barca de Óbolo: Vela Eterna, el Lago Negro y el Río de las Almas (lib/barca.js)
router.post('/barca', async (req, res, next) => {
  try {
    const r = await barca.viajar(req.playerId, String(req.body?.destino ?? ''));
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error, ...(r.lejos ? { lejos: true } : {}) });
    res.json(r);
  } catch (err) { next(err); }
});

// POST /world/frio — entumecido por el frío de la Tundra: te quita un poco de vida (lib/frio.js)
router.post('/frio', async (req, res, next) => {
  try {
    const r = await frio.golpe(req.playerId);
    if (r.error) return res.status(r.status ?? 400).json({ error: r.error });
    res.json(r);
  } catch (err) { next(err); }
});

module.exports = router;
