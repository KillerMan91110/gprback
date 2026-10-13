// Muñecos de venta: ver lib/puestos.js
// Montado en /api/player/:playerId/puestos
const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db/db');
const inventory = require('../lib/inventory');
const { spendCurrency, withTransaction } = require('../lib/currency');
const { requireAuth, requireSelf } = require('../lib/auth');
const { requireNear } = require('../lib/cercania');
const puestos = require('../lib/puestos');

router.use(requireAuth);
router.use(requireSelf);

const changed = (req, zone, extra = {}) => req.app.get('io')?.emit('stalls:changed', { zone, ...extra });

// GET ?zona=aurelia — muñecos plantados en la zona y dónde se pueden plantar
router.get('/', async (req, res, next) => {
  try {
    const zona = String(req.query.zona || 'aurelia');
    res.json({ mercados: puestos.MERCADOS.filter((m) => m.zona === zona), puestos: await puestos.listZone(zona) });
  } catch (err) { next(err); }
});

// GET /mio — tu muñeco abierto (con las ventas) y las reglas
router.get('/mio', async (req, res, next) => {
  try {
    res.json({
      puesto: await puestos.mine(req.playerId),
      reglas: { precioMuneco: puestos.PRECIO_MUNECO, horas: puestos.DURACION_H, maxEntradas: puestos.MAX_ENTRADAS, comision: puestos.COMISION, aspectos: puestos.ASPECTOS },
    });
  } catch (err) { next(err); }
});

// POST /muneco/comprar — Pip el titiritero te vende un muñeco
router.post('/muneco/comprar', requireNear('titiritero'), async (req, res, next) => {
  try {
    await puestos.ensureTables();
    const doll = await db.query('SELECT id FROM items WHERE code = $1', [puestos.MUNECO]);
    const gold = await withTransaction(async (client) => {
      const left = await spendCurrency(req.playerId, 'gold', puestos.PRECIO_MUNECO, client);
      if (left !== null) await inventory.addItem(req.playerId, doll.rows[0].id, 1, 0, 0, client);
      return left;
    });
    if (gold === null) return res.status(400).json({ error: `Un muñeco cuesta ${puestos.PRECIO_MUNECO} de oro.` });
    res.json({ message: `Compraste un Muñeco de Venta por ${puestos.PRECIO_MUNECO} de oro.`, gold });
  } catch (err) { next(err); }
});

// POST / { title, look, entries: [{ kind?, itemId|monsterId, enchantLevel?, qualityTier?, quantity, price }] }
router.post('/', async (req, res, next) => {
  try {
    const out = await puestos.open(req.playerId, req.body ?? {});
    changed(req, out.zone, { stallId: out.stallId });
    res.status(201).json({ message: '¡Tu muñeco ya atiende el puesto!', ...out });
  } catch (err) { next(err); }
});

// POST /cerrar — recoges tu muñeco; lo no vendido te llega por correo
router.post('/cerrar', async (req, res, next) => {
  try {
    const out = await puestos.closeMine(req.playerId);
    if (out) {
      changed(req, out.zone);
      req.app.get('io')?.to(`player:${req.playerId}`).emit('mail:new', { from: 'Pip el titiritero' });
    }
    res.json({ message: out?.returned ? 'Recogiste tu muñeco. Lo que no se vendió te espera en el buzón.' : 'Recogiste tu muñeco.', ...out });
  } catch (err) { next(err); }
});

// GET /:id — lo que vende un muñeco
router.get('/:id', async (req, res, next) => {
  try {
    const view = await puestos.stallView(Number(req.params.id));
    if (!view) return res.status(404).json({ error: 'Ese muñeco no existe' });
    res.json(view);
  } catch (err) { next(err); }
});

// POST /:id/comprar { entryId, quantity }
router.post('/:id/comprar', async (req, res, next) => {
  try {
    const out = await puestos.buy(req.playerId, Number(req.params.id), Number(req.body?.entryId), req.body?.quantity ?? 1);
    const io = req.app.get('io');
    const buyer = await db.query('SELECT nickname FROM players WHERE id = $1', [req.playerId]);
    io?.to(`player:${out.ownerId}`).emit('stall:sold', {
      buyer: buyer.rows[0]?.nickname, name: out.name, quantity: out.quantity, earned: out.total - out.fee,
    });
    changed(req, out.zone, { stallId: Number(req.params.id) });
    res.json({ message: `Compraste ${out.quantity}x ${out.name} por ${out.total.toLocaleString('es')} de oro.`, gold: out.gold });
  } catch (err) { next(err); }
});

module.exports = router;
