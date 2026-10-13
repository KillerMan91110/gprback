// Presencia en el mundo 2D: quién está en cada zona, dónde y qué está haciendo. Todo vive en
// memoria (se pierde al reiniciar el servidor y no hace falta guardarlo): posiciones, globitos
// de chat "cerca", gestos, emojis, susurros y estados (en combate / ausente).
//
// Cliente → servidor                          Servidor → clientes de la misma zona
//   world:enter {zone,x,y,facing,cls} (ack)     world:roster (ack)  world:join  world:leave
//   world:move {x,y,f,flip,m}                   world:moved
//   world:typing bool                           world:typing {id,on}
//   world:say {text,loud} (ack)                 world:say {id,name,text,loud}   (solo a los que están cerca)
//   world:emote {emote} (ack)                   world:emote {id,emote}
//   world:emoji {emoji} (ack)                   world:emoji {id,emoji}
//   world:whisper {to,text} (ack)               world:whisper {from,to,text}    (solo a los dos)
//   world:state {state}                         world:state {id,state}
//   world:refresh  (subió de nivel, cambió de gremio)
//   world:leave
//   world:who (ack)                             → { here: jugadores de tu zona, friends: amigos conectados }
//   world:lfg bool ("busco grupo")              world:lfg {id,on}
//                                               social:friend-online / social:friend-offline (a tus amigos)
//
// Lazos de amistad: cada minuto, los amigos que están cerca en el mapa suman un punto (lib/socialHub).
const db = require('../db/db');
const { friendIdsOf, addBondMinutes } = require('./socialHub');

const TILE = 32;
const SAY_RADIUS = 14 * TILE; // "decir": los que te ven en pantalla, más o menos
const YELL_RADIUS = 45 * TILE; // "gritar": media zona
const MSG_INTERVAL_MS = 1000; // un mensaje (o gesto, o emoji) por segundo como mucho
const MOVE_INTERVAL_MS = 60;
const GESTURE_RADIUS = 28 * TILE; // gestos y emojis: un poco más que la pantalla
const MAX_TEXT = 150;

const EMOTES = ['saludar', 'bailar', 'reir', 'sentarse', 'aplaudir'];
const EMOJIS = ['❤️', '😂', '👍', '❗', '❓', '💤', '😮', '😡'];
const CLASSES = ['guerrero', 'mago', 'arquero', 'picaro', 'sacerdote'];
const FACINGS = ['down', 'up', 'side'];
// observando: mirando el combate de otro jugador (globito con un ojo; los monstruos no lo atacan
// y el grupo no lo mete en sus peleas mientras tanto)
const STATES = ['combate', 'ausente', 'observando'];
const BOND_RADIUS = 12 * TILE;
const BOND_TICK_MS = 60 * 1000;
const FRIENDS_REFRESH_MS = 5 * 60 * 1000;

// socket.id → jugador en el mundo
const present = new Map();

// Última posición conocida de un jugador en el mundo (zona y x, y locales a la zona), o null si no
// está conectado al mundo. La usa lib/cercania.js para los servicios que se piden en persona.
function positionOf(playerId) {
  let best = null;
  for (const o of present.values()) {
    if (o.id === playerId && (!best || (o.seenAt ?? 0) > (best.seenAt ?? 0))) best = o;
  }
  return best ? { zone: best.zone, x: best.x, y: best.y, at: best.seenAt } : null;
}

const room = (zone) => `world:${zone}`;
const num = (v, max = 100000) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Number(v))) : null);
const cleanText = (t) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
const publicOf = (p) => ({
  id: p.id, name: p.name, level: p.level, cls: p.cls, guild: p.guild,
  x: p.x, y: p.y, f: p.facing, flip: p.flip, m: p.moving, state: p.state, lfg: !!p.lfg,
});

// sockets de un jugador que está en el mundo
const socketsOf = (playerId) => [...present.entries()].filter(([, o]) => o.id === playerId).map(([sid]) => sid);

// avisa a los amigos conectados de `p` (en cualquier zona)
function notifyFriends(io, p, event, payload) {
  // se mira desde los dos lados: una amistad recién aceptada puede estar solo en la lista de uno
  for (const [sid, o] of present) if (o.id !== p.id && (p.friends?.has(o.id) || o.friends?.has(p.id))) io.to(sid).emit(event, payload);
}

async function loadFriends(p) {
  try { p.friends = new Set(await friendIdsOf(p.id)); p.friendsAt = Date.now(); } catch { p.friends = p.friends ?? new Set(); }
}

async function loadInfo(playerId) {
  const r = await db.query(
    `SELECT p.nickname, p.level, g.name AS guild_name, g.color AS guild_color
     FROM players p
     LEFT JOIN guild_members gm ON gm.player_id = p.id
     LEFT JOIN guilds g ON g.id = gm.guild_id
     WHERE p.id = $1`,
    [playerId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { name: row.nickname, level: row.level, guild: row.guild_name ? { name: row.guild_name, color: row.guild_color } : null };
}

// límite de mensajes por jugador (compartido entre decir, gritar, gestos, emojis y susurros)
function tooSoon(p) {
  const now = Date.now();
  if (now - (p.lastMsgAt ?? 0) < MSG_INTERVAL_MS) return true;
  p.lastMsgAt = now;
  return false;
}

// manda un evento a los jugadores de la zona que están a menos de `radius` (incluido quien lo hace)
function toNear(io, p, radius, event, payload) {
  for (const [sid, o] of present) {
    if (o.zone === p.zone && Math.hypot(o.x - p.x, o.y - p.y) <= radius) io.to(sid).emit(event, payload);
  }
}

// ¿tiene el juego abierto? (algún socket en su sala personal; no importa si está en el mundo o
// en otra página). Al instante, a diferencia de last_seen_at (última petición, 5 min de margen).
function isConnected(io, playerId) {
  return (io?.sockets?.adapter?.rooms?.get(`player:${playerId}`)?.size ?? 0) > 0;
}

// avisa a los de su grupo que se conectó o se desconectó (la lista del grupo lo pinta en gris)
async function notifyGroupPresence(io, playerId, online) {
  try {
    const r = await db.query(
      `SELECT gm2.player_id FROM player_coop_group_members gm
       JOIN player_coop_group_members gm2 ON gm2.group_id = gm.group_id AND gm2.player_id <> gm.player_id
       WHERE gm.player_id = $1`,
      [playerId]
    );
    for (const { player_id: pid } of r.rows) io.to(`player:${pid}`).emit('coop:presence', { id: playerId, online });
  } catch (err) { console.error('[grupo] presencia', err.message); }
}
// recargar la página corta y vuelve a abrir el socket: se espera un poco antes de avisar
const OFFLINE_GRACE_MS = 5000;

function attachWorldPresence(io) {
  // lazos: cada minuto, +1 a cada par de amigos que está cerca en la misma zona
  setInterval(async () => {
    const list = [...present.values()];
    const pairs = [];
    const seen = new Set();
    for (const p of list) {
      if (Date.now() - (p.friendsAt ?? 0) > FRIENDS_REFRESH_MS) loadFriends(p);
      for (const q of list) {
        if (p.id >= q.id || p.zone !== q.zone || !(p.friends?.has(q.id) || q.friends?.has(p.id))) continue;
        const key = `${p.id}:${q.id}`;
        if (seen.has(key) || Math.hypot(p.x - q.x, p.y - q.y) > BOND_RADIUS) continue;
        seen.add(key);
        pairs.push([p.id, q.id]);
      }
    }
    try { await addBondMinutes(pairs); } catch (err) { console.error('[lazos]', err.message); }
  }, BOND_TICK_MS).unref();

  io.on('connection', (socket) => {
    const me = () => present.get(socket.id);
    // sala personal: avisos dirigidos a este jugador (elogios, etc.)
    const wasConnected = isConnected(io, socket.playerId);
    socket.join(`player:${socket.playerId}`);
    if (!wasConnected) notifyGroupPresence(io, socket.playerId, true);
    socket.on('disconnect', () => {
      setTimeout(() => { if (!isConnected(io, socket.playerId)) notifyGroupPresence(io, socket.playerId, false); }, OFFLINE_GRACE_MS);
    });

    const leave = () => {
      const p = me();
      if (!p) return;
      present.delete(socket.id);
      socket.leave(room(p.zone));
      socket.to(room(p.zone)).emit('world:leave', { id: p.id });
      if (!socketsOf(p.id).length) notifyFriends(io, p, 'social:friend-offline', { id: p.id, name: p.name });
    };

    socket.on('world:enter', async (data, ack) => {
      try {
        const zone = String(data?.zone ?? '');
        if (!/^[a-z0-9_]{1,32}$/.test(zone)) return ack?.({ error: 'Zona inválida' });
        const info = await loadInfo(socket.playerId);
        if (!info) return ack?.({ error: 'Jugador no encontrado' });
        leave();
        // el mismo jugador en otra pestaña: se queda solo la última
        for (const [sid, other] of present) {
          if (other.id !== socket.playerId) continue;
          present.delete(sid);
          io.to(room(other.zone)).emit('world:leave', { id: other.id });
          io.sockets.sockets.get(sid)?.leave(room(other.zone));
          if (sid !== socket.id) io.to(sid).emit('world:replaced');
        }
        const wasHere = socketsOf(socket.playerId).length > 0;
        const p = {
          id: socket.playerId, ...info, zone,
          cls: CLASSES.includes(data?.cls) ? data.cls : 'guerrero',
          x: num(data?.x) ?? 0, y: num(data?.y) ?? 0, facing: FACINGS.includes(data?.facing) ? data.facing : 'down',
          flip: !!data?.flip, moving: false, state: null, lastMoveAt: 0, lastMsgAt: 0, seenAt: Date.now(),
        };
        await loadFriends(p);
        present.set(socket.id, p);
        if (!wasHere) notifyFriends(io, p, 'social:friend-online', { id: p.id, name: p.name, level: p.level, zone });
        const others = [...present.values()].filter((o) => o.zone === zone && o.id !== p.id).map(publicOf);
        socket.join(room(zone));
        socket.to(room(zone)).emit('world:join', publicOf(p));
        ack?.({ ok: true, me: publicOf(p), roster: others });
      } catch (err) {
        console.error('world:enter', err);
        ack?.({ error: 'No se pudo entrar al mundo' });
      }
    });

    // subió de nivel o cambió de gremio: los demás lo ven y el propio jugador recibe sus datos
    socket.on('world:refresh', async (_data, ack) => {
      const p = me();
      if (!p) return typeof ack === 'function' && ack({ error: 'No estás en el mundo' });
      try {
        Object.assign(p, await loadInfo(p.id));
        await loadFriends(p);
        socket.to(room(p.zone)).emit('world:join', publicOf(p));
        if (typeof ack === 'function') ack({ ok: true, me: publicOf(p) });
      } catch { /* sin cambios */ }
    });

    socket.on('world:move', (data) => {
      const p = me();
      if (!p) return;
      const now = Date.now();
      if (now - p.lastMoveAt < MOVE_INTERVAL_MS) return;
      p.lastMoveAt = now;
      const x = num(data?.x);
      const y = num(data?.y);
      if (x == null || y == null) return;
      Object.assign(p, { x, y, facing: FACINGS.includes(data?.f) ? data.f : p.facing, flip: !!data?.flip, moving: !!data?.m, seenAt: now });
      socket.volatile.to(room(p.zone)).emit('world:moved', { id: p.id, x, y, f: p.facing, flip: p.flip, m: p.moving });
    });

    socket.on('world:typing', (on) => {
      const p = me();
      if (p) socket.to(room(p.zone)).emit('world:typing', { id: p.id, on: !!on });
    });

    socket.on('world:say', (data, ack) => {
      const p = me();
      if (!p) return ack?.({ error: 'No estás en el mundo' });
      const text = cleanText(data?.text);
      if (!text) return ack?.({ error: 'Mensaje vacío' });
      if (tooSoon(p)) return ack?.({ error: 'Espera un segundo entre mensajes' });
      const loud = !!data?.loud;
      const radius = loud ? YELL_RADIUS : SAY_RADIUS;
      const msg = { id: p.id, name: p.name, level: p.level, text, loud, at: Date.now() };
      // solo lo reciben los que están cerca (el que habla también, para su propio globito)
      toNear(io, p, radius, 'world:say', msg);
      ack?.({ ok: true });
    });

    socket.on('world:emote', (data, ack) => {
      const p = me();
      if (!p) return ack?.({ error: 'No estás en el mundo' });
      const emote = String(data?.emote ?? '');
      if (!EMOTES.includes(emote)) return ack?.({ error: 'Ese gesto no existe' });
      if (tooSoon(p)) return ack?.({ error: 'Espera un segundo entre mensajes' });
      toNear(io, p, GESTURE_RADIUS, 'world:emote', { id: p.id, name: p.name, emote });
      ack?.({ ok: true });
    });

    socket.on('world:emoji', (data, ack) => {
      const p = me();
      if (!p) return ack?.({ error: 'No estás en el mundo' });
      const emoji = String(data?.emoji ?? '');
      if (!EMOJIS.includes(emoji)) return ack?.({ error: 'Ese emoji no existe' });
      if (tooSoon(p)) return ack?.({ error: 'Espera un segundo entre mensajes' });
      toNear(io, p, GESTURE_RADIUS, 'world:emoji', { id: p.id, emoji });
      ack?.({ ok: true });
    });

    socket.on('world:whisper', (data, ack) => {
      const p = me();
      if (!p) return ack?.({ error: 'No estás en el mundo' });
      const text = cleanText(data?.text);
      const toName = String(data?.to ?? '').trim().toLowerCase();
      if (!text || !toName) return ack?.({ error: 'Escribe: /s Nombre mensaje' });
      const targets = [...present.entries()].filter(([, o]) => o.name.toLowerCase() === toName);
      if (!targets.length) return ack?.({ error: `${data.to} no está en el mundo ahora` });
      if (targets[0][1].id === p.id) return ack?.({ error: 'No puedes susurrarte a ti mismo' });
      if (tooSoon(p)) return ack?.({ error: 'Espera un segundo entre mensajes' });
      const msg = { from: { id: p.id, name: p.name }, to: { id: targets[0][1].id, name: targets[0][1].name }, text, at: Date.now() };
      targets.forEach(([sid]) => io.to(sid).emit('world:whisper', msg));
      ack?.({ ok: true, msg });
    });

    socket.on('world:state', (data) => {
      const p = me();
      if (!p) return;
      const state = STATES.includes(data?.state) ? data.state : null;
      if (state === p.state) return;
      p.state = state;
      io.to(room(p.zone)).emit('world:state', { id: p.id, state });
    });

    socket.on('world:who', (_data, ack) => {
      const p = me();
      if (!p) return ack?.({ here: [], friends: [] });
      const here = [...present.values()].filter((o) => o.zone === p.zone && o.id !== p.id).map(publicOf);
      const friends = [...present.values()].filter((o) => p.friends?.has(o.id)).map((o) => ({ ...publicOf(o), zone: o.zone }));
      ack?.({ here, friends });
    });

    socket.on('world:lfg', (on) => {
      const p = me();
      if (!p) return;
      p.lfg = !!on;
      io.to(room(p.zone)).emit('world:lfg', { id: p.id, on: p.lfg });
    });

    socket.on('world:leave', leave);
    socket.on('disconnect', leave);
  });
}

module.exports = { attachWorldPresence, positionOf, isConnected, EMOTES, EMOJIS };
