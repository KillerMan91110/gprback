// La Fisura Infernal: la forja secreta de los Ocultos, bajo la Grieta Ardiente (Volcán Rojo). Ahí
// Morvak, el Forjador de Eclipses, convierte los moldes que le roban a Ignar en Cristales de Eclipse.
// Zona propia del mundo 2D (gpr/public/assets/mundo/fisura, generada por art/mapas/generar_fisura.js).
// El motor es el molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes: el Fundidor Oculto de la Sala de Fundición, los Diablillos de Fragua del
//     Puente de Escoria y el Gólem de Escoria del Foso;
//   - las cubas de metal fundido (los "braseros" de esta mazmorra): al volcarlas se enfría el paso y,
//     si caes, retomas desde la última;
//   - Morvak: templa su armadura en el metal (el escudo cambia de debilidad: Agua → Hielo) y cada tanto
//     levanta el crisol sobre un héroe: si ese héroe no se defiende en su turno, le cae el metal encima;
//   - el cofre de la forja (cada 3 h): oro y pociones, una pieza de Obsidiana de tu clase o Corazones
//     de la Forja Negra (para las armas de Forja Negra).
// Se abre con la historia: la Llave de Brasa que Ignar forja en la V9 «El Maestro de la Lava».
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'fisura',
  zoneId: 3,
  table: 'player_fisura_runs',
  targetPrefix: 'fisura',
  minLevel: Number(process.env.FISURA_NIVEL || 36),
  // 36 (la llave llega en la V9) a 42: sin hueco hasta el Señor de la Caldera
  levels: { min: 36, max: 42 },
  chestHours: 3,
  // casillas locales de la fisura (iguales que en generar_fisura.js)
  braseros: {
    1: { x: 13, y: 9, name: 'la Cuba de la Entrada' },
    2: { x: 27, y: 33, name: 'la Cuba del Puente' },
  },
  guardianes: {
    fundidor: { name: 'Fundidor Oculto', box: [6, 18, 33, 18], monsters: ['FISURA_FUNDIDOR', 'FISURA_DIABLILLO'] },
    diablillos: { name: 'Diablillos de Fragua', box: [8, 26, 31, 26], monsters: ['FISURA_DIABLILLO', 'FISURA_DIABLILLO'] },
    golem_foso: { name: 'Gólem de Escoria', box: [11, 40, 28, 44], monsters: ['FISURA_GOLEM_ESCORIA', 'FISURA_FUNDIDOR'] },
  },
  bossSpot: { x: 20, y: 53 },
  boss: {
    code: 'FISURA_MORVAK',
    weakCycle: [6, 2], // Agua → Hielo → Agua…
    shieldText: (name, el) => `${name} hunde la armadura en el metal fundido y la templa otra vez: ahora la rompe ${el}.`,
    // el crisol: cada 3 turnos apunta a alguien; el metal quita el 50% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.5, guardedPct: 0.08,
      markText: (a, t) => `${a} levanta el crisol sobre ${t}: el metal fundido empieza a desbordarse… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡${a} vuelca el crisol sobre ${t}! ${dmg} de daño.`,
      guardedText: (a, t, dmg) => `¡El metal cae sobre ${t}, que se cubrió a tiempo! Solo ${dmg} de daño.`,
      missText: (a, t) => `El metal fundido cae donde estaba ${t}, pero ya no está ahí.`,
    },
  },
  monsters: [
    {
      code: 'FISURA_FUNDIDOR', name: 'Fundidor Oculto', rarity: 'RARE', category: 'HUMANOIDE', base: 37, xp: 1330, gold: 400,
      description: 'Un Oculto con delantal de cuero y máscara de hierro. Vierte el metal en los moldes robados sin hacer preguntas.',
      resist: { 1: 40, 8: 30, 6: -40 },
      skills: [['MONSTRUO_BOTELLA_INCENDIARIA', 25], ['MONSTRUO_GOLPE_INFERNAL', 25]],
      scalings: [36, 42].map((lv) => monsterRow(lv, 'RARE', { atk: 1.1, def: 1.1, magic_def: 0.9 })),
    },
    {
      code: 'FISURA_DIABLILLO', name: 'Diablillo de Fragua', rarity: 'RARE', category: 'DEMONIO', base: 37, xp: 1200, gold: 380,
      description: 'Un diablillo que aviva los fuegos de la forja soplando. Se ríe cada vez que algo se quema.',
      resist: { 1: 50, 8: 20, 2: -40, 7: -30 },
      skills: [['MONSTRUO_PINCHAZO', 30], ['MONSTRUO_RISA_DIABLILLO', 20]],
      scalings: [36, 42].map((lv) => monsterRow(lv, 'RARE', { hp: 0.85, spd: 1.35, evasion: 5 })),
    },
    {
      code: 'FISURA_GOLEM_ESCORIA', name: 'Gólem de Escoria', rarity: 'RARE', category: 'ELEMENTAL', base: 38, xp: 1400, gold: 380,
      description: 'Montaña de escoria y metal derretido que se levantó sola en el Foso. Huele a hierro quemado.',
      resist: { 1: 50, 5: 30, 6: -40, 2: -30 },
      skills: [['MONSTRUO_PIEL_VIDRIO', 25], ['MONSTRUO_PUNO_LAVA', 25]],
      scalings: [36, 42].map((lv) => monsterRow(lv, 'RARE', { hp: 1.15, def: 1.35, spd: 0.7 })),
    },
    {
      code: 'FISURA_MORVAK', name: 'Morvak, el Forjador de Eclipses', rarity: 'LEGENDARY', category: 'HUMANOIDE', base: 39, xp: 9000, gold: 2800,
      description: 'El maestro herrero de los Ocultos. Aprendió a forjar mirando a Ignar de joven, y ahora usa sus moldes para fabricar Cristales de Eclipse.',
      resist: { 1: 50, 8: 30 },
      skills: [['MONSTRUO_CADENA_FUEGO', 30], ['MONSTRUO_GOLPE_INFERNAL', 30], ['MONSTRUO_CORAZA_MAGMA', 15]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además vuelca el crisol): misma vida que el
      // Gólem de Hierro Negro de la Mina, en proporción
      scalings: [36, 42].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.855, def: 1.15, elemental_damage: 8 })),
    },
  ],
  // botín: Escoria Negra en todos (armas de Forja Negra) y el Corazón de la forja
  drops: [
    ['FISURA_FUNDIDOR', 'ESCORIA_NEGRA', 35, 1, 2],
    ['FISURA_FUNDIDOR', 'ACERO_REFINADO', 20, 1, 1],
    ['FISURA_DIABLILLO', 'ESCORIA_NEGRA', 30, 1, 2],
    ['FISURA_DIABLILLO', 'AZUFRE', 25, 1, 2],
    ['FISURA_GOLEM_ESCORIA', 'ESCORIA_NEGRA', 40, 1, 2],
    ['FISURA_GOLEM_ESCORIA', 'OBSIDIANA_BRUTA', 25, 1, 2],
    ['FISURA_MORVAK', 'CORAZON_FORJA_NEGRA', 50, 1, 1],
    ['FISURA_MORVAK', 'ESCORIA_NEGRA', 100, 2, 3],
    ['FISURA_MORVAK', 'PIEDRA_ENCANT_MAYOR', 20, 1, 1],
  ],
  chest: {
    gold: (level) => 1800 + 80 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 3 },
      { w: 35, setSuffix: 'OBSIDIANA', qty: 1 },
      { w: 25, codes: ['CORAZON_FORJA_NEGRA'], qty: [1, 2] },
    ],
  },
  // objetos propios (los crea el molde la primera vez): la llave de Ignar, la escoria y el corazón del jefe
  items: [
    { code: 'LLAVE_FISURA', name: 'Llave de Brasa', rarity: 'RARO', quest: true,
      description: 'Una llave forjada por Ignar con el molde del Maestro de la Lava. Sigue tibia. Abre el portón de hierro de la Fisura Infernal.' },
    { code: 'ESCORIA_NEGRA', name: 'Escoria Negra', rarity: 'POCO_COMUN',
      description: 'Restos de metal que salen de la forja de los Ocultos. Todavía brillan por dentro. Con ella se forjan las armas de Forja Negra.' },
    { code: 'CORAZON_FORJA_NEGRA', name: 'Corazón de la Forja Negra', rarity: 'EPICO',
      description: 'El núcleo ardiente de la forja de Morvak. Con él se forjan las armas de Forja Negra.' },
  ],
  // se abre con la llave que Ignar te da en la V9 (o con la V10 «La Fisura Infernal» ya completada)
  access: {
    quest: 'VOLCAN_HISTORIA_10_FISURA', key: 'LLAVE_FISURA',
    sealedText: 'Un portón de hierro al rojo vivo con el eclipse grabado. No tiene cerradura que reconozcas: Ignar, en Ascuaria, sabrá cómo abrirlo.',
  },
  texts: {
    name: 'La Fisura Infernal', bossName: 'Morvak, el Forjador de Eclipses', doorName: 'el Portón de la Forja', brazierWord: 'Cuba',
    chestName: 'Cofre de la forja', guardianWord: 'guardián de la forja', icon: 'furnace', brazierIcon: 'melting-metal',
    bossIcon: 'furnace', bossDownText: '¡Morvak cae de rodillas junto a su forja!',
    clearedText: 'Ya limpiaste la Fisura. Sal y vuelve a entrar para recorrerla otra vez.',
    doorClosedText: 'El Portón de la Forja sigue cerrado: vence antes a los tres guardianes',
    doorHint: 'Un portón de hierro al rojo cierra el paso. Se abrirá cuando caigan los tres guardianes de la forja.',
    news: (names, many) => `¡${names} ${many ? 'han' : 'ha'} derrotado a Morvak, el Forjador de Eclipses, en la Fisura Infernal!`,
  },
});
