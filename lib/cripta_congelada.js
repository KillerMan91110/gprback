// La Cripta Congelada: la tumba de la reina bajo el Cementerio Real (Tundra Eterna). La reina era la
// madre de Eirik y de Hela; antes de morir le pidió al Rey que congelara el norte para frenar el Quinto
// Sello. Los Ocultos profanaron la tumba para llegar al Sello por debajo y enloquecieron a su mascota.
// Zona propia del mundo 2D (gpr/public/assets/mundo/cripta_congelada, generada por
// art/mapas/generar_cripta_congelada.js). El motor es el molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes: las Doncellas de Hielo de la Galería de la Reina (de a dos), la Gárgola Glacial
//     del Puente del Abismo y la Escolta de la Reina de la Cámara;
//   - las velas de hielo (los "braseros" de esta mazmorra): al encenderlas, si caes o sales, retomas
//     desde la última;
//   - Escarcha, la Sierpe de la Reina: su escudo de hielo cambia de debilidad (Fuego → Rayo) y cada
//     tanto sopla el Aliento de la Tumba sobre un héroe: si ese héroe no se defiende en su turno, le cae;
//   - el cofre de la tumba (cada 3 h): oro y pociones, una pieza Glaciar de tu clase o Lágrimas de la
//     Reina (para las armas de la Reina).
// Se abre con la historia: la Llave de la Reina que la Anciana te da en la T9 «La llave de la reina».
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'cripta_congelada',
  zoneId: 5,
  table: 'player_cripta_congelada_runs',
  targetPrefix: 'cripta_congelada',
  minLevel: Number(process.env.CRIPTA_CONGELADA_NIVEL || 67),
  // 67 (la llave llega en la T9, nivel 70; se puede entrar antes si ya tienes el nivel) a 73
  levels: { min: 67, max: 73 },
  chestHours: 3,
  // casillas locales de la cripta (iguales que en generar_cripta_congelada.js)
  braseros: {
    1: { x: 13, y: 9, name: 'la Vela del Vestíbulo' },
    2: { x: 27, y: 33, name: 'la Vela de los Sarcófagos' },
  },
  guardianes: {
    doncellas: { name: 'Doncellas de Hielo', box: [6, 18, 33, 18], monsters: ['CRIPTAH_DONCELLA', 'CRIPTAH_DONCELLA'] },
    gargola: { name: 'Gárgola Glacial', box: [8, 26, 31, 26], monsters: ['CRIPTAH_GARGOLA', 'CRIPTAH_DONCELLA'] },
    escolta: { name: 'Escolta de la Reina', box: [11, 40, 28, 44], monsters: ['CRIPTAH_ESCOLTA', 'CRIPTAH_GARGOLA'] },
  },
  bossSpot: { x: 20, y: 53 },
  boss: {
    code: 'CRIPTAH_ESCARCHA',
    weakCycle: [1, 3], // Fuego → Rayo → Fuego…
    shieldText: (name, el) => `${name} se enrosca y la escarcha la cubre otra vez: ahora la rompe ${el}.`,
    // el Aliento de la Tumba: cada 3 turnos apunta a alguien; quita el 50% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.5, guardedPct: 0.08,
      markText: (a, t) => `${a} abre la boca y el aire de la tumba se congela frente a ${t}… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡El Aliento de la Tumba de ${a} envuelve a ${t}! ${dmg} de daño.`,
      guardedText: (a, t, dmg) => `¡El Aliento de la Tumba choca contra el escudo de ${t}, que se cubrió a tiempo! Solo ${dmg} de daño.`,
      missText: (a, t) => `El Aliento de la Tumba congela el suelo donde estaba ${t}, pero ya no está ahí.`,
    },
  },
  monsters: [
    {
      code: 'CRIPTAH_DONCELLA', name: 'Doncella de Hielo', rarity: 'RARE', category: 'ESPECTRO', base: 68, xp: 3300, gold: 820,
      description: 'Una de las damas de compañía de la reina, enterrada a su lado. El eclipse la despertó con los ojos vacíos y una lanza de hielo en la mano.',
      resist: { 2: 40, 6: 30, 1: -40 },
      skills: [['MONSTRUO_LANZA_HIELO', 30], ['MONSTRUO_TOQUE_GELIDO', 25]],
      scalings: [67, 73].map((lv) => monsterRow(lv, 'RARE', { hp: 0.95, def: 0.9, magic_atk: 1.25, magic_def: 1.2, spd: 1.1 })),
    },
    {
      code: 'CRIPTAH_GARGOLA', name: 'Gárgola Glacial', rarity: 'RARE', category: 'ELEMENTAL', base: 69, xp: 3400, gold: 840,
      description: 'Una gárgola de piedra que cuidaba el puente de la cripta. El hielo se le metió en las grietas y ahora vuela sobre el abismo, chillando.',
      resist: { 2: 30, 5: 30, 3: -40 },
      skills: [['MONSTRUO_PICADO_SILENCIOSO', 30], ['MONSTRUO_AVALANCHA', 25]],
      scalings: [67, 73].map((lv) => monsterRow(lv, 'RARE', { hp: 1.05, atk: 1.15, def: 1.25, spd: 1.05 })),
    },
    {
      code: 'CRIPTAH_ESCOLTA', name: 'Escolta de la Reina', rarity: 'RARE', category: 'MUERTO_VIVIENTE', base: 70, xp: 3600, gold: 880,
      description: 'El capitán de la guardia de la reina, que juró no separarse de ella ni muerto. Lo cumplió. Ahora no deja pasar a nadie, ni a su familia.',
      resist: { 2: 40, 5: 20, 1: -30, 3: -20 },
      skills: [['MONSTRUO_TAJO_GLACIAL', 30], ['MONSTRUO_ESCUDO_HIELO', 20]],
      scalings: [67, 73].map((lv) => monsterRow(lv, 'RARE', { hp: 1.2, atk: 1.15, def: 1.35, spd: 0.85 })),
    },
    {
      code: 'CRIPTAH_ESCARCHA', name: 'Escarcha, la Sierpe de la Reina', rarity: 'LEGENDARY', category: 'DRACOIDE', base: 70, xp: 19000, gold: 6000,
      description: 'La sierpe de hielo que la reina crió desde que era un huevo. Durmió enroscada en su tumba diez años, hasta que los Ocultos le clavaron un cristal en la frente.',
      resist: { 2: 50, 6: 30, 8: 20 },
      skills: [['MONSTRUO_ALIENTO_HELADO', 30], ['MONSTRUO_MORDIDA_HELADA', 25], ['MONSTRUO_INVIERNO_ETERNO', 20], ['JEFE_CRIPTAH_ESCARCHA_1', 30]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además sopla el Aliento de la Tumba): la
      // misma vida en proporción que el Señor del Océano en el Arrecife
      scalings: [67, 73].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.855, magic_atk: 1.15, magic_def: 1.15, elemental_damage: 8 })),
    },
  ],
  // botín: Hielo Eterno Puro en todos (armas de la Reina) y la Lágrima de la Reina de Escarcha
  drops: [
    ['CRIPTAH_DONCELLA', 'HIELO_ETERNO_PURO', 35, 1, 2],
    ['CRIPTAH_DONCELLA', 'ESENCIA_CONGELADA', 20, 1, 1],
    ['CRIPTAH_GARGOLA', 'HIELO_ETERNO_PURO', 30, 1, 2],
    ['CRIPTAH_GARGOLA', 'HIELO_ETERNO', 30, 1, 2],
    ['CRIPTAH_ESCOLTA', 'HIELO_ETERNO_PURO', 40, 1, 2],
    ['CRIPTAH_ESCOLTA', 'PLACA_ESCARCHA', 35, 1, 2],
    ['CRIPTAH_ESCARCHA', 'LAGRIMA_REINA', 50, 1, 1],
    ['CRIPTAH_ESCARCHA', 'HIELO_ETERNO_PURO', 100, 2, 3],
    ['CRIPTAH_ESCARCHA', 'PIEDRA_ENCANT_MAYOR', 20, 1, 1],
  ],
  chest: {
    gold: (level) => 3600 + 110 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 3 },
      { w: 35, setSuffix: 'GLACIAR', qty: 1 },
      { w: 25, codes: ['LAGRIMA_REINA'], qty: [1, 2] },
    ],
  },
  // la llave la crea el SQL de las misiones; aquí por si el servidor arranca antes de correrlo
  items: [
    { code: 'LLAVE_REINA', name: 'Llave de la Reina', rarity: 'RARO', quest: true,
      description: 'Una llave de hielo azul que no se derrite en la mano. La Anciana la guardó desde que su nuera murió. Abre la Cripta Congelada.' },
  ],
  // se abre con la T9 (la Anciana te da la llave) o con la T10 «La Cripta Congelada» ya completada
  access: {
    quest: 'TUNDRA_HISTORIA_10_CRIPTA', key: 'LLAVE_REINA',
    sealedText: 'Una puerta de hielo azul con la corona real tallada y un ojo de cerradura en forma de copo. La Anciana del Hielo, en Fiordo Blanco, guarda la llave.',
  },
  texts: {
    name: 'La Cripta Congelada', bossName: 'Escarcha, la Sierpe de la Reina', doorName: 'la Compuerta Helada', brazierWord: 'Vela',
    chestName: 'Cofre de la tumba', guardianWord: 'guardián de la cripta', icon: 'graveyard', brazierIcon: 'candles',
    bossIcon: 'grave-flowers', bossDownText: '¡El cristal de la frente de Escarcha se parte! La sierpe se enrosca alrededor de la tumba de la reina y se queda quieta, como un perro viejo que por fin vuelve a casa. Sobre la tumba, la voz de la reina canta una canción de cuna.',
    clearedText: 'Ya recorriste la Cripta. Sal y vuelve a entrar para bajar otra vez.',
    doorClosedText: 'La Compuerta Helada sigue cerrada: vence antes a los tres guardianes',
    doorHint: 'Una compuerta de hielo sellada con un cristal de eclipse. Se abrirá cuando caigan los tres guardianes de la cripta.',
    news: (names, many) => `¡${names} ${many ? 'han' : 'ha'} calmado a Escarcha, la Sierpe de la Reina, en la Cripta Congelada!`,
  },
});
