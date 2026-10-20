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
  gaspar_aurelia: { zona: 'aurelia', x: 62, y: 82, nombre: 'la diligencia, junto a la Puerta Sur de Aurelia' },
  gaspar_aldea: { zona: 'pradera', x: 89, y: 55, nombre: 'la diligencia, en la Aldea Espiga' },
  brokk: { zona: 'aurelia', x: 101, y: 14, nombre: 'Brokk, en la forja de Aurelia' },
  goreth: { zona: 'pradera', x: 84, y: 51, nombre: 'Goreth, en la Aldea Espiga' },
  // la forja enana del Bastión de Hierro (Montañas Grises): se fabrica parado frente a ella
  forja_bastion: { zona: 'montanas', x: 72, y: 54, nombre: 'la forja del Bastión de Hierro, en las Montañas Grises' },
  // la Gran Forja de Ignar en Ascuaria (Volcán Rojo): la puerta del horno (art/mapas/generar_volcan.js)
  forja_ascuaria: { zona: 'volcan', x: 115, y: 24, nombre: 'la Gran Forja de Ascuaria, en el Volcán Rojo' },
  // el Astillero de Brea en el Puerto Antiguo (Costas Muertas): la puerta, sobre la calle del astillero
  // (art/mapas/generar_costas.js)
  astillero_puerto: { zona: 'costas', x: 130, y: 58, nombre: 'el Astillero del Puerto Antiguo, en las Costas Muertas' },
  // la Forja de la Casa Larga de Sigrún en Fiordo Blanco (Tundra Eterna): la puerta, debajo del edificio
  // (art/mapas/generar_tundra.js, P.forja)
  forja_fiordo: { zona: 'tundra', x: 151, y: 97, nombre: 'la Forja de la Casa Larga de Fiordo Blanco, en la Tundra Eterna' },
  // la Forja de Hueso de Osmund y la casa de Ilse, la sepulturera, en Vela Eterna (Catacumbas del Abismo):
  // las puertas, debajo de cada edificio (art/mapas/generar_catacumbas.js, P.forja y P.ilse)
  forja_vela: { zona: 'catacumbas', x: 86, y: 36, nombre: 'la Forja de Hueso de Vela Eterna, en las Catacumbas del Abismo' },
  posada_vela: { zona: 'catacumbas', x: 113, y: 36, nombre: 'Ilse, en su casa de Vela Eterna' },
  // Hollin, el mercader de reliquias de la plaza de Vela Eterna
  mercader_vela: { zona: 'catacumbas', x: 109, y: 47, nombre: 'Hollin, en la plaza de Vela Eterna' },
  // la barca de Óbolo (lib/barca.js): sus tres paradas
  obolo: { zona: 'catacumbas', x: 102, y: 51, nombre: 'Óbolo, en el muelle de Vela Eterna' },
  barca_lago: { zona: 'catacumbas', x: 58, y: 95, nombre: 'Óbolo, en el muelle del Lago Negro' },
  barca_rio: { zona: 'catacumbas', x: 25, y: 71, nombre: 'Óbolo, en la orilla del Río de las Almas' },
  // la forja y la posada del Santuario de las Lágrimas (Ruinas Ancestrales): las puertas, debajo de cada
  // edificio (art/mapas/generar_ruinas.js, P.forja y P.posada). Se usan desde el principio, en ruinas: la
  // historia (R5 y R9) solo las restaura a la vista
  forja_santuario: { zona: 'ruinas', x: 72, y: 69, nombre: 'la Forja del Santuario de las Lágrimas, en las Ruinas Ancestrales' },
  posada_santuario: { zona: 'ruinas', x: 46, y: 69, nombre: 'la posada del Santuario de las Lágrimas, en las Ruinas Ancestrales' },
  // las Escalinatas de Luz de las Ruinas (lib/escalinatas.js): los círculos de luz del Santuario, el Patio y las
  // Torres (art/mapas/generar_ruinas.js)
  escalinata_santuario: { zona: 'ruinas', x: 66, y: 84, nombre: 'la Escalinata de Luz del Santuario' },
  escalinata_patio: { zona: 'ruinas', x: 60, y: 48, nombre: 'la Escalinata de Luz del Patio de las Estatuas' },
  escalinata_torres: { zona: 'ruinas', x: 22, y: 18, nombre: 'la Escalinata de Luz de las Torres del Velo' },
  // Casio, el último peregrino, en la plaza del Santuario (llega en la R5)
  casio: { zona: 'ruinas', x: 56, y: 77, nombre: 'Casio, en la plaza del Santuario de las Lágrimas' },
  // los muelles de las balsas de pómez (lib/brasas.js)
  balsero_rios: { zona: 'volcan', x: 72, y: 47, nombre: 'Pumo, en el muelle de los Ríos de Lava' },
  balsero_cantera: { zona: 'volcan', x: 122, y: 62, nombre: 'Toba, en el muelle de la Cantera' },
  balsero_caldera: { zona: 'volcan', x: 79, y: 93, nombre: 'Lapilli, en el muelle de la Caldera' },
  // La Gaviota Insolente de Rhaegar, en el muelle del Puerto Antiguo y en el de Fiordo Blanco (lib/barco.js)
  rhaegar_puerto: { zona: 'costas', x: 138, y: 41, nombre: 'Rhaegar, en la punta del muelle del Puerto Antiguo' },
  rhaegar_fiordo: { zona: 'tundra', x: 144, y: 105, nombre: 'Rhaegar, en el muelle de Fiordo Blanco' },
  // los muelles de los botes de Marul en las Costas (lib/botes.js)
  barquero_coralia: { zona: 'costas', x: 145, y: 62, nombre: 'Marul, en el embarcadero de Coralia' },
  barquero_cala: { zona: 'costas', x: 18, y: 22, nombre: 'Sargo, en el muelle de la Cala' },
  barquero_cementerio: { zona: 'costas', x: 50, y: 111, nombre: 'Bagre, en el muelle del Cementerio' },
  // estaciones de vagonetas de las Montañas (los trillizos vagoneteros, ver lib/tormenta.js)
  vagonetero_bastion: { zona: 'montanas', x: 66, y: 38, nombre: 'Grun, en la estación de vagonetas del Bastión' },
  vagonetero_minas: { zona: 'montanas', x: 40, y: 18, nombre: 'Grat, en la estación de las Minas Abandonadas' },
  vagonetero_garganta: { zona: 'montanas', x: 36, y: 95, nombre: 'Grot, en la estación de la Garganta del Eco' },
  lyra: { zona: 'aurelia', x: 74, y: 44, nombre: 'Lyra, en el Barrio del Mercado' },
  mirna: { zona: 'pradera', x: 76, y: 50, nombre: 'Mirna, en la Aldea Espiga' },
  // Marga, la mercader de la plaza de Ascuaria (Volcán Rojo; art/mapas/generar_volcan.js)
  mercader_ascuaria: { zona: 'volcan', x: 115, y: 29, nombre: 'Marga, en la plaza de Ascuaria' },
  // Salitre, el mercader del muelle del Puerto Antiguo (Costas Muertas; art/mapas/generar_costas.js)
  mercader_puerto: { zona: 'costas', x: 112, y: 48, nombre: 'Salitre, en el muelle del Puerto Antiguo' },
  // Bjorn el Mudo, el mercader del muelle de Fiordo Blanco, y Gunnhild en la posada (art/mapas/generar_tundra.js)
  mercader_fiordo: { zona: 'tundra', x: 142, y: 103, nombre: 'Bjorn, en el muelle de Fiordo Blanco' },
  posada_fiordo: { zona: 'tundra', x: 140, y: 95, nombre: 'Gunnhild, en la posada de Fiordo Blanco' },
  // las paradas de los trineos de perros de la Tundra (lib/trineos.js)
  skadi: { zona: 'tundra', x: 123, y: 104, nombre: 'Skadi, en la perrera de Fiordo Blanco' },
  trineo_aldea: { zona: 'tundra', x: 103, y: 77, nombre: 'Kari, en la Aldea de los Mamuts' },
  trineo_campamento: { zona: 'tundra', x: 25, y: 70, nombre: 'Leif, en el Campamento de los Cazadores' },
  buzon_aurelia: { zona: 'aurelia', x: 67, y: 45, nombre: 'el buzón de la Plaza del Pilar' },
  buzon_aldea: { zona: 'pradera', x: 73, y: 50, nombre: 'el buzón de la Aldea Espiga' },
  titiritero: { zona: 'aurelia', x: 86, y: 52, nombre: 'Pip el titiritero, en el Barrio del Mercado' },
  pilar_aurelia: { zona: 'aurelia', x: 60, y: 45, nombre: 'el Pilar de Aethra, en la Plaza del Pilar de Aurelia' },
};

// grupos de lugares por servicio (cualquiera de la lista sirve); nombre: cómo se dice en el aviso
// cuando la lista es larga
const SERVICIOS = {
  maestros: { lugares: ['aldric', 'isolde', 'sylwen', 'nox', 'anselm'], nombre: 'tu maestro de orden, en Aurelia' },
  registro: { lugares: ['oswin'] },
  taller: { lugares: ['brokk', 'goreth', 'forja_bastion', 'forja_ascuaria', 'astillero_puerto', 'forja_fiordo', 'posada_fiordo', 'forja_vela', 'posada_vela', 'forja_santuario', 'posada_santuario'] },
  artesanos: { lugares: ['lyra', 'mirna', 'mercader_ascuaria', 'mercader_puerto', 'mercader_fiordo', 'mercader_vela', 'casio'] },
  correo: { lugares: ['buzon_aurelia', 'buzon_aldea'], nombre: 'un buzón (Plaza del Pilar o Aldea Espiga)' },
  titiritero: { lugares: ['titiritero'] },
  // crafteo: dónde se fabrica cada receta (crafting_recipes.station; sin lugar = en cualquier lado)
  forja: { lugares: ['brokk', 'goreth', 'forja_bastion', 'forja_ascuaria', 'astillero_puerto', 'forja_fiordo', 'forja_vela', 'forja_santuario'], nombre: 'una forja (Brokk en Aurelia, Goreth en la Aldea Espiga, la del Bastión de Hierro, la Gran Forja de Ascuaria, el Astillero del Puerto Antiguo, la Forja de la Casa Larga de Fiordo Blanco, la Forja de Hueso de Vela Eterna o la Forja del Santuario)' },
  pilar: { lugares: ['pilar_aurelia'] },
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
