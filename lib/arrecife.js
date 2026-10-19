// El Arrecife Hundido: la ciudad de coral de los tritones, bajo el Arrecife Blanco (Costas Muertas). Los
// Ocultos echaron a los tritones, hechizaron a su rey con un Cristal de Eclipse y lo dejaron cuidando
// el trono mientras encadenaban a la Bestia de las Profundidades.
// Zona propia del mundo 2D (gpr/public/assets/mundo/arrecife, generada por art/mapas/generar_arrecife.js).
// El motor es el molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes: los Tritones Corrompidos de la Plaza de las Estatuas (de a dos), la Medusa
//     Guardiana del Jardín de las Medusas y el Coloso de Coral de la Bóveda;
//   - las caracolas (los "braseros" de esta mazmorra): al soplarlas, si caes o sales, retomas desde la
//     última;
//   - el Señor del Océano: su escudo de agua cambia de debilidad (Rayo → Tierra) y cada tanto levanta
//     la Gran Ola sobre un héroe: si ese héroe no se defiende en su turno, la ola le cae encima;
//   - el cofre del trono (cada 3 h): oro y pociones, una pieza de Coral de tu clase o Perlas del Abismo
//     (para las armas del Abismo).
// Se abre con la historia: la Caracola del Rey que Nerea afina en la C7 «La Caracola del Rey».
// El Señor del Océano ya existía (era un monstruo de la zona): sus números de jefe de mazmorra los pone
// el SQL de las Costas (sin zona, nivel 52-58), porque el molde no pisa a un monstruo que ya existe.
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'arrecife',
  zoneId: 4,
  table: 'player_arrecife_runs',
  targetPrefix: 'arrecife',
  minLevel: Number(process.env.ARRECIFE_NIVEL || 52),
  // 52 (la caracola llega en la C7, nivel 50) a 58: antes del Almirante y la Bestia
  levels: { min: 52, max: 58 },
  chestHours: 3,
  // casillas locales del arrecife (iguales que en generar_arrecife.js)
  braseros: {
    1: { x: 13, y: 9, name: 'la Caracola de la Entrada' },
    2: { x: 27, y: 33, name: 'la Caracola de la Galería' },
  },
  guardianes: {
    tritones: { name: 'Tritones Corrompidos', box: [6, 18, 33, 18], monsters: ['ARRECIFE_TRITON', 'ARRECIFE_TRITON'] },
    medusa: { name: 'Medusa Guardiana', box: [8, 26, 31, 26], monsters: ['ARRECIFE_MEDUSA', 'ARRECIFE_TRITON'] },
    coloso: { name: 'Coloso de Coral', box: [11, 40, 28, 44], monsters: ['ARRECIFE_COLOSO', 'ARRECIFE_MEDUSA'] },
  },
  bossSpot: { x: 20, y: 53 },
  boss: {
    code: 'SENOR_OCEANO',
    weakCycle: [3, 5], // Rayo → Tierra → Rayo…
    shieldText: (name, el) => `${name} levanta el tridente y el agua lo envuelve otra vez: ahora la rompe ${el}.`,
    // la Gran Ola: cada 3 turnos apunta a alguien; quita el 50% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.5, guardedPct: 0.08,
      markText: (a, t) => `${a} alza el tridente: el agua del salón se recoge en una Gran Ola sobre ${t}… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡La Gran Ola de ${a} cae sobre ${t}! ${dmg} de daño.`,
      guardedText: (a, t, dmg) => `¡La Gran Ola revienta contra ${t}, que se cubrió a tiempo! Solo ${dmg} de daño.`,
      missText: (a, t) => `La Gran Ola cae donde estaba ${t}, pero ya no está ahí.`,
    },
  },
  monsters: [
    {
      code: 'ARRECIFE_TRITON', name: 'Tritón Corrompido', rarity: 'RARE', category: 'ACUATICO', base: 53, xp: 2350, gold: 600,
      description: 'Un guardia del rey de los tritones con un Cristal de Eclipse clavado en el pecho. Sigue haciendo su ronda, pero ya no sabe a quién protege.',
      resist: { 6: 40, 1: 20, 3: -40 },
      skills: [['MONSTRUO_LANZA_AGUA', 30], ['MONSTRUO_GOLPE_BAJO', 20]],
      scalings: [52, 58].map((lv) => monsterRow(lv, 'RARE', { atk: 1.15, def: 1.05, spd: 1.1 })),
    },
    {
      code: 'ARRECIFE_MEDUSA', name: 'Medusa Guardiana', rarity: 'RARE', category: 'ELEMENTAL', base: 54, xp: 2300, gold: 580,
      description: 'Una medusa enorme que flota sobre el Jardín. Antes los tritones la usaban de farol; ahora brilla morado y paraliza a quien la roza.',
      resist: { 3: 40, 6: 30, 5: -40 },
      skills: [['MONSTRUO_TOQUE_URTICANTE', 30], ['MONSTRUO_DESCARGA_MEDUSA', 30]],
      scalings: [52, 58].map((lv) => monsterRow(lv, 'RARE', { hp: 0.9, def: 0.8, magic_atk: 1.3, magic_def: 1.2, evasion: 4 })),
    },
    {
      code: 'ARRECIFE_COLOSO', name: 'Coloso de Coral', rarity: 'RARE', category: 'ELEMENTAL', base: 55, xp: 2500, gold: 620,
      description: 'Una estatua de coral blanco del tamaño de una casa. Los Ocultos le clavaron un cristal en la frente y se levantó del pedestal.',
      resist: { 5: 40, 6: 30, 3: -30, 1: -20 },
      skills: [['MONSTRUO_PIEL_CORAL', 25], ['MONSTRUO_CORAL_CORTANTE', 30]],
      scalings: [52, 58].map((lv) => monsterRow(lv, 'RARE', { hp: 1.2, def: 1.4, spd: 0.7 })),
    },
    {
      code: 'SENOR_OCEANO', name: 'Señor del Océano', rarity: 'LEGENDARY', category: 'ACUATICO', base: 55, xp: 14000, gold: 4200,
      description: 'El rey de los tritones y padre de Nerea. Cuidó a la Bestia de las Profundidades toda su vida, hasta que los Ocultos le clavaron un Cristal de Eclipse en la frente.',
      resist: { 6: 50, 2: 30, 1: 20 },
      skills: [['MONSTRUO_TORRENTE_AGUA', 30], ['MONSTRUO_MAELSTROM', 25], ['MONSTRUO_COLETAZO_OLA', 20]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además lanza la Gran Ola): misma vida que
      // Morvak en la Fisura, en proporción
      scalings: [52, 58].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.855, magic_atk: 1.15, magic_def: 1.15, elemental_damage: 8 })),
    },
  ],
  // botín: Arena Abisal en todos (armas del Abismo) y la Perla del Abismo del rey
  drops: [
    ['ARRECIFE_TRITON', 'ARENA_ABISAL', 35, 1, 2],
    ['ARRECIFE_TRITON', 'ESCAMA_SIRENA_CORRUPTA', 20, 1, 1],
    ['ARRECIFE_MEDUSA', 'ARENA_ABISAL', 30, 1, 2],
    ['ARRECIFE_MEDUSA', 'GEL_MEDUSA', 30, 1, 2],
    ['ARRECIFE_COLOSO', 'ARENA_ABISAL', 40, 1, 2],
    ['ARRECIFE_COLOSO', 'CORAL_ROJO', 35, 1, 3],
    ['SENOR_OCEANO', 'PERLA_DEL_ABISMO', 50, 1, 1],
    ['SENOR_OCEANO', 'ARENA_ABISAL', 100, 2, 3],
    ['SENOR_OCEANO', 'PIEDRA_ENCANT_MAYOR', 20, 1, 1],
  ],
  chest: {
    gold: (level) => 2600 + 90 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 3 },
      { w: 35, setSuffix: 'CORAL', qty: 1 },
      { w: 25, codes: ['PERLA_DEL_ABISMO'], qty: [1, 2] },
    ],
  },
  // la llave (la Caracola del Rey afinada) la crea el SQL de las misiones; aquí por si el servidor
  // arranca antes de correrlo
  items: [
    { code: 'LLAVE_ARRECIFE', name: 'Caracola del Rey (afinada)', rarity: 'RARO', quest: true,
      description: 'La caracola del rey de los tritones, limpia y afinada por Nerea. Su canto abre las compuertas de coral del Arrecife Hundido.' },
  ],
  // se abre con la caracola que Nerea te da en la C7 (o con la C8 «El Arrecife Hundido» ya completada)
  access: {
    quest: 'COSTAS_Q2_TRIDENTE_PERDIDO', key: 'LLAVE_ARRECIFE',
    sealedText: 'Un arco de coral cerrado con una compuerta que no se mueve. En el centro hay un hueco con forma de caracola: Nerea, en Coralia, sabrá qué hacer.',
  },
  texts: {
    name: 'El Arrecife Hundido', bossName: 'el Señor del Océano', doorName: 'la Compuerta de Coral', brazierWord: 'Caracola',
    chestName: 'Cofre del trono', guardianWord: 'guardián del arrecife', icon: 'coral', brazierIcon: 'sea-star',
    bossIcon: 'trident-shield', bossDownText: '¡El cristal de la frente del Señor del Océano se parte! El rey cae de rodillas y, por primera vez en años, te mira con sus propios ojos.',
    clearedText: 'Ya limpiaste el Arrecife. Sal y vuelve a entrar para recorrerlo otra vez.',
    doorClosedText: 'La Compuerta de Coral sigue cerrada: vence antes a los tres guardianes',
    doorHint: 'Una compuerta de coral sellada con un cristal de eclipse. Se abrirá cuando caigan los tres guardianes del arrecife.',
    news: (names, many) => `¡${names} ${many ? 'han' : 'ha'} liberado al Señor del Océano en el Arrecife Hundido!`,
  },
});
