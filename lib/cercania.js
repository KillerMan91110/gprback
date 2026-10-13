// Cercanía: los servicios de la ciudad se piden en persona. El servidor mira la última posición
// que el jugador mandó por socket en el mundo 2D (lib/worldPresence.js) y rechaza la acción si no
// está junto a quien la ofrece. Así no se puede aprender, contratar o fundar un gremio desde
// cualquier lado (ni desde las páginas clásicas, ni llamando a la API a mano).
//
// La enfermería y el encantador NO pasan por aquí: también se usan dentro del Abismo (la torre),
// que está fuera del mapa 2D.
//
// Para probar sin el mundo (páginas clásicas, curl): POSICION_LIBRE=1 desactiva el control.
const { positionOf } = require('./worldPresence');

const TILE = 32;
// a cuántas casillas del NPC se acepta (cubre el paseo de los de la aldea y el retraso del socket)
const RADIO = 5 * TILE;

// lugar → zona, casilla del NPC (locales a la zona, como en el mapa) y cómo se le nombra
const LUGARES = {
  oswin: { zona: 'aurelia', x: 43, y: 22, nombre: 'Oswin, en el Registro de Gremios de Aurelia' },
  aldric: { zona: 'aurelia', x: 12, y: 44, nombre: 'Sir Aldric, en el Cuartel del Acero' },
  isolde: { zona: 'aurelia', x: 20, y: 44, nombre: 'Isolde, en la Torre Arcana' },
  sylwen: { zona: 'aurelia', x: 26, y: 44, nombre: 'Sylwen, en el Campo del Halcón' },
  nox: { zona: 'aurelia', x: 24, y: 60, nombre: 'Nox, en La Sombra Callada' },
  anselm: { zona: 'aurelia', x: 68, y: 15, nombre: 'el Padre Anselm, en la Capilla de la Luz' },
  estatua_aurelia: { zona: 'aurelia', x: 52, y: 46, nombre: 'la Estatua del Viajero de Aurelia' },
  gaspar_aurelia: { zona: 'aurelia', x: 62, y: 82, nombre: 'Gaspar, junto a la Puerta Sur de Aurelia' },
  gaspar_aldea: { zona: 'pradera', x: 89, y: 55, nombre: 'Gaspar, en la Aldea Espiga' },
  brokk: { zona: 'aurelia', x: 101, y: 14, nombre: 'Brokk, en la forja de Aurelia' },
  goreth: { zona: 'pradera', x: 84, y: 51, nombre: 'Goreth, en la Aldea Espiga' },
  lyra: { zona: 'aurelia', x: 74, y: 44, nombre: 'Lyra, en el Barrio del Mercado' },
  mirna: { zona: 'pradera', x: 76, y: 50, nombre: 'Mirna, en la Aldea Espiga' },
  buzon_aurelia: { zona: 'aurelia', x: 67, y: 45, nombre: 'el buzón de la Plaza del Pilar' },
  buzon_aldea: { zona: 'pradera', x: 73, y: 50, nombre: 'el buzón de la Aldea Espiga' },
  titiritero: { zona: 'aurelia', x: 86, y: 52, nombre: 'Pip el titiritero, en el Barrio del Mercado' },
};

// grupos de lugares por servicio (cualquiera de la lista sirve); nombre: cómo se dice en el aviso
// cuando la lista es larga
const SERVICIOS = {
  maestros: { lugares: ['aldric', 'isolde', 'sylwen', 'nox', 'anselm'], nombre: 'tu maestro de orden, en Aurelia' },
  registro: { lugares: ['oswin'] },
  taller: { lugares: ['brokk', 'goreth'] },
  artesanos: { lugares: ['lyra', 'mirna'] },
  correo: { lugares: ['buzon_aurelia', 'buzon_aldea'], nombre: 'un buzón (Plaza del Pilar o Aldea Espiga)' },
  titiritero: { lugares: ['titiritero'] },
};

const libre = () => process.env.POSICION_LIBRE === '1';

// null si está cerca de alguno de los lugares; si no, el mensaje para el jugador
function lejosDe(playerId, lugares, nombre = null) {
  if (libre()) return null;
  const ls = lugares.map((l) => LUGARES[l]).filter(Boolean);
  const quien = nombre ?? ls.map((l) => l.nombre).join(' o ');
  const pos = positionOf(Number(playerId));
  if (!pos) return `Para hacer esto entra al mundo y acércate a ${quien}.`;
  const cerca = ls.some((l) => l.zona === pos.zone && Math.hypot(pos.x - (l.x * TILE + 16), pos.y - (l.y * TILE + 16)) <= RADIO);
  return cerca ? null : `Para hacer esto tienes que estar junto a ${quien}.`;
}

// ¿está el jugador en `zona`, a lo sumo a `radio` casillas de (tx, ty)? (casillas locales de la zona;
// sin tx/ty basta con estar en la zona). Lo usan la guía, la exploración y el mercader ambulante.
function cercaDe(playerId, zona, tx = null, ty = null, radio = 5) {
  if (libre()) return true;
  const pos = positionOf(Number(playerId));
  if (!pos || pos.zone !== zona) return false;
  if (tx == null) return true;
  return Math.hypot(pos.x - (tx * TILE + 16), pos.y - (ty * TILE + 16)) <= radio * TILE;
}

// middleware: requireNear('maestros') o requireNear(['oswin'])
function requireNear(servicio) {
  const { lugares, nombre } = Array.isArray(servicio) ? { lugares: servicio } : SERVICIOS[servicio];
  return (req, res, next) => {
    const msg = lejosDe(req.playerId, lugares, nombre);
    if (msg) return res.status(403).json({ error: msg, lejos: true });
    next();
  };
}

module.exports = { LUGARES, SERVICIOS, RADIO, lejosDe, requireNear, cercaDe, positionOf };
