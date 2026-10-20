// El Observatorio Roto: donde los aethrinos miraban las estrellas para vigilar al Devorador. Su gran
// telescopio se partió el día que el Devorador abrió un ojo, y desde entonces el ojo mira por él. El Gran
// Astrónomo se quedó adentro, mirándolo, mil años.
// Zona propia del mundo 2D (gpr/public/assets/mundo/observatorio, generada por
// art/mapas/generar_observatorio.js). El motor es el molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes: el Astrónomo Fantasma de la Sala de los Astrolabios, los Autómatas del Cielo (de a
//     dos) de la Pasarela Celeste y la Constelación Viva de la Cámara de las Estrellas;
//   - las lámparas de cristal (los "braseros" de esta mazmorra): al encenderlas, si caes o sales, retomas
//     desde la última;
//   - el Ojo del Devorador: su escudo cambia de debilidad (Luz → Rayo) y cada tanto mira fijo a un héroe
//     (la Mirada del Vacío): si ese héroe no se defiende en su turno, le cae;
//   - el cofre del telescopio (cada 3 h): oro y pociones, una pieza Estelar de tu clase o Fragmentos de
//     Lente (para las armas del Observatorio).
// Se abre con la historia: la Llave del Astrolabio que Seraphine te da en la R6 «La llave del astrolabio».
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'observatorio',
  zoneId: 7,
  table: 'player_observatorio_runs',
  targetPrefix: 'observatorio',
  minLevel: Number(process.env.OBSERVATORIO_NIVEL || 92),
  // 92 (la llave llega en la R6, nivel 92) a 96
  levels: { min: 92, max: 96 },
  chestHours: 3,
  // casillas locales del observatorio (iguales que en generar_observatorio.js)
  braseros: {
    1: { x: 13, y: 9, name: 'la Lámpara de la Cúpula' },
    2: { x: 27, y: 33, name: 'la Lámpara de los Mapas' },
  },
  guardianes: {
    astronomo: { name: 'Astrónomo Fantasma', box: [6, 18, 33, 18], monsters: ['OBSERV_ASTRONOMO', 'OBSERV_AUTOMATA'] },
    automatas: { name: 'Autómatas del Cielo', box: [8, 26, 31, 26], monsters: ['OBSERV_AUTOMATA', 'OBSERV_AUTOMATA'] },
    constelacion: { name: 'Constelación Viva', box: [11, 40, 28, 44], monsters: ['OBSERV_CONSTELACION', 'OBSERV_ASTRONOMO'] },
  },
  bossSpot: { x: 20, y: 53 },
  boss: {
    code: 'OBSERV_OJO',
    weakCycle: [7, 3], // Luz → Rayo → Luz…
    shieldText: (name, el) => `${name} entrecierra el párpado y el vacío lo cubre otra vez: ahora lo rompe ${el}.`,
    // la Mirada del Vacío: cada 3 turnos mira fijo a alguien; quita el 50% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.5, guardedPct: 0.08,
      markText: (a, t) => `${a} deja de girar y se queda mirando fijo a ${t}. La pupila se abre hasta tapar todo el iris… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡La Mirada del Vacío de ${a} atraviesa a ${t}! ${dmg} de daño.`,
      guardedText: (a, t, dmg) => `¡${t} se cubre a tiempo y la Mirada del Vacío de ${a} se le resbala por el escudo! Solo ${dmg} de daño.`,
      missText: (a, t) => `La Mirada del Vacío quema las baldosas donde estaba ${t}, pero ya no está ahí.`,
    },
  },
  monsters: [
    {
      code: 'OBSERV_ASTRONOMO', name: 'Astrónomo Fantasma', rarity: 'RARE', category: 'ESPECTRO', base: 93, xp: 5200, gold: 1250,
      description: 'El Gran Astrónomo, el último que miró por el telescopio. No dejó de mirar al Devorador en mil años, y de tanto mirarlo se le parece un poco. Todavía anota en el aire.',
      resist: { 7: 30, 9: 40, 8: -40, 3: -20 },
      skills: [['MONSTRUO_LLUVIA_ESTRELLAS', 30], ['MONSTRUO_RAYO_LUZ', 25]],
      scalings: [92, 96].map((lv) => monsterRow(lv, 'RARE', { hp: 1.0, def: 0.85, magic_atk: 1.3, magic_def: 1.2, spd: 1.15 })),
    },
    {
      code: 'OBSERV_AUTOMATA', name: 'Autómata del Cielo', rarity: 'RARE', category: 'HUMANOIDE', base: 94, xp: 5400, gold: 1280,
      description: 'Muñecos de bronce que giraban las cúpulas del Observatorio. Nadie les dijo que pararan, así que siguen girando todo lo que se les acerca.',
      resist: { 5: 30, 1: 20, 3: -40, 6: -20 },
      skills: [['MONSTRUO_CADENA_RAYO', 30], ['MONSTRUO_GOLPE_BRUTAL', 25]],
      scalings: [92, 96].map((lv) => monsterRow(lv, 'RARE', { hp: 1.15, atk: 1.15, def: 1.3, spd: 0.85 })),
    },
    {
      code: 'OBSERV_CONSTELACION', name: 'Constelación Viva', rarity: 'RARE', category: 'COSMICO', base: 95, xp: 5600, gold: 1320,
      description: 'Estrellas que se cayeron por la lente rota y se juntaron con la forma de un cazador. Apuntan con un arco de luz a todo lo que respira.',
      resist: { 7: 40, 9: 40, 8: -40, 6: -20 },
      skills: [['MONSTRUO_LLUVIA_ESTRELLAS', 30], ['MONSTRUO_GRAVEDAD_ROTA', 25]],
      scalings: [92, 96].map((lv) => monsterRow(lv, 'RARE', { hp: 1.0, def: 0.9, magic_atk: 1.3, magic_def: 1.25, spd: 1.2 })),
    },
    {
      code: 'OBSERV_OJO', name: 'Ojo del Devorador', rarity: 'LEGENDARY', category: 'COSMICO', base: 96, xp: 30000, gold: 9500,
      description: 'Un ojo morado, enorme, que mira desde el otro lado del gran telescopio. Es solo un ojo del Devorador de Estrellas, y aun así no cabe en la sala.',
      resist: { 8: 50, 9: 40, 2: 20 },
      skills: [['MONSTRUO_MIRADA_VACIO', 30], ['MONSTRUO_GRAVEDAD_ROTA', 25], ['MONSTRUO_ECLIPSE_TOTAL', 20]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además lanza la Mirada del Vacío): la misma vida
      // en proporción que el Coloso de Huesos del Trono
      scalings: [92, 96].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.95, magic: true, magic_atk: 1.15, magic_def: 1.15, def: 1.0, elemental_damage: 8 })),
    },
  ],
  // botín: Bronce Celeste en todos (armas del Observatorio) y el Fragmento de Lente del Ojo
  drops: [
    ['OBSERV_ASTRONOMO', 'BRONCE_CELESTE', 30, 1, 2],
    ['OBSERV_ASTRONOMO', 'POLVO_DE_ESTRELLAS', 20, 1, 1],
    ['OBSERV_AUTOMATA', 'BRONCE_CELESTE', 40, 1, 2],
    ['OBSERV_AUTOMATA', 'CORAZON_MARMOL', 10, 1, 1],
    ['OBSERV_CONSTELACION', 'BRONCE_CELESTE', 35, 1, 2],
    ['OBSERV_CONSTELACION', 'POLVO_DE_ESTRELLAS', 35, 1, 2],
    ['OBSERV_OJO', 'FRAGMENTO_LENTE', 50, 1, 1],
    ['OBSERV_OJO', 'BRONCE_CELESTE', 100, 2, 3],
    ['OBSERV_OJO', 'PIEDRA_ENCANT_MAYOR', 20, 1, 1],
  ],
  chest: {
    gold: (level) => 5200 + 140 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 3 },
      { w: 35, setSuffix: 'ESTELAR', qty: 1 },
      { w: 25, codes: ['FRAGMENTO_LENTE'], qty: [1, 2] },
    ],
  },
  // la llave la crea el SQL de las misiones; aquí por si el servidor arranca antes de correrlo
  items: [
    { code: 'LLAVE_ASTROLABIO', name: 'Llave del Astrolabio', rarity: 'RARO', quest: true,
      description: 'Una llave de bronce con un astrolabio diminuto en el mango, que todavía gira. Seraphine la guardó mil años. Abre el Observatorio Roto.' },
  ],
  // se abre con la R6 (Seraphine te da la llave) o con la R7 «El Observatorio Roto» ya completada
  access: {
    quest: 'RUINAS_HISTORIA_07_OBSERVATORIO', key: 'LLAVE_ASTROLABIO',
    sealedText: 'Una puerta de bronce bajo el gran telescopio, con un astrolabio tallado en el medio que no gira. Seraphine, en el Santuario de las Lágrimas, guarda la llave.',
  },
  texts: {
    name: 'El Observatorio Roto', bossName: 'el Ojo del Devorador', doorName: 'la Puerta de Bronce', brazierWord: 'Lámpara',
    chestName: 'Cofre del telescopio', guardianWord: 'guardián del Observatorio', icon: 'star-altar', brazierIcon: 'old-lantern',
    bossIcon: 'all-seeing-eye', bossDownText: '¡El Ojo del Devorador se cierra! El párpado baja despacio, como el de alguien que se duerme, y la lente rota se vuelve a ver negra. Por el agujero de la cúpula, por primera vez en mil años, entra la luz de una estrella de verdad.',
    clearedText: 'Ya recorriste el Observatorio. Sal y vuelve a entrar para subir otra vez.',
    doorClosedText: 'La Puerta de Bronce sigue cerrada: vence antes a los tres guardianes',
    doorHint: 'Una puerta de bronce con siete constelaciones grabadas, sellada con un ojo morado. Se abrirá cuando caigan los tres guardianes del Observatorio.',
    news: (names, many) => `¡${names} le ${many ? 'han' : 'ha'} cerrado el ojo al Devorador en el Observatorio Roto!`,
  },
});
