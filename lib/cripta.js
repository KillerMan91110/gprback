// La Cripta del Vigía: mazmorra hecha a mano bajo las Ruinas del Vigía (Pradera Dorada). Es una
// zona propia del mundo 2D (gpr/public/assets/mundo/cripta, generada por art/mapas/generar_cripta.js).
// El motor (guardianes, braseros, puerta, jefe, cofre) es el molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes (dos Centinelas de Hueso que patrullan la galería y el Espectro del Osario);
//   - el Vigía Caído: su escudo cambia de debilidad (Luz → Fuego → Rayo) y su faro marca a un héroe
//     y al turno siguiente le lanza un rayo enorme, salvo que ese héroe se haya puesto a Defender;
//   - el cofre del Vigía (cada 3 h): oro y pociones, una pieza de la Guardia de tu clase u Ojos del Vigía.
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'cripta',
  table: 'player_crypt_runs',
  targetPrefix: '', // 'centinela_norte', 'jefe' (los combates viejos ya están guardados así)
  minLevel: Number(process.env.CRIPTA_NIVEL || 7),
  // 7 (se abre con «La torre que vigilaba») a 14: sin hueco hasta el Titán
  levels: { min: 7, max: 14 },
  chestHours: Number(process.env.CRIPTA_COFRE_HORAS ?? 3),
  // casillas locales de la cripta (iguales que en generar_cripta.js)
  braseros: {
    1: { x: 16, y: 7, name: 'el Brasero de la Antesala' },
    2: { x: 12, y: 40, name: 'el Brasero del Osario' },
  },
  guardianes: {
    centinela_norte: { name: 'Centinela de Hueso', box: [5, 25, 34, 25], monsters: ['CRIPTA_CENTINELA', 'CRIPTA_CENTINELA'] },
    centinela_sur: { name: 'Centinela de Hueso', box: [5, 28, 34, 28], monsters: ['CRIPTA_CENTINELA', 'CRIPTA_ESPECTRO'] },
    espectro_osario: { name: 'Espectro de la Cripta', box: [11, 41, 28, 45], monsters: ['CRIPTA_ESPECTRO', 'CRIPTA_CENTINELA', 'CRIPTA_ESPECTRO'] },
  },
  bossSpot: { x: 20, y: 54 },
  boss: {
    code: 'CRIPTA_VIGIA',
    weakCycle: [7, 1, 3], // Luz → Fuego → Rayo → Luz…
    shieldText: (name, el) => `El escudo de ${name} se rehace con otra forma: ahora lo rompe ${el}.`,
    // el faro: cada 3 turnos marca a alguien; el rayo quita el 55% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.55, guardedPct: 0.08,
      markText: (a, t) => `${a} fija la luz de su faro en ${t}… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡El faro de ${a} abrasa a ${t} por ${dmg}!`,
      guardedText: (a, t, dmg) => `¡El faro de ${a} estalla sobre ${t}, que se cubrió a tiempo! Solo ${dmg} de daño.`,
      missText: (a, t) => `El faro de ${a} barre la sala, pero no encuentra a ${t}.`,
    },
  },
  monsters: [
    {
      code: 'CRIPTA_CENTINELA', name: 'Centinela de Hueso', rarity: 'RARE', category: 'MUERTO_VIVIENTE', base: 8, xp: 300, gold: 120,
      description: 'Soldados del Vigía que siguen haciendo la ronda siglos después de morir. Odian la luz y el fuego.',
      resist: { 7: -50, 1: -30, 8: 50 },
      skills: [['MONSTRUO_ESCUDO_HUESO', 25], ['MONSTRUO_GOLPE_BRUTAL', 20]],
      // curva de lib/equilibrio.js: raro con mucha defensa física
      scalings: [7, 14].map((lv) => monsterRow(lv, 'RARE', { def: 1.25, magic_def: 0.85, spd: 0.9 })),
    },
    {
      code: 'CRIPTA_ESPECTRO', name: 'Espectro de la Cripta', rarity: 'RARE', category: 'ESPECTRO', base: 8, xp: 340, gold: 110,
      description: 'Un alma que vaga con un farol de luz fría. Los golpes la atraviesan, pero la luz y el hielo la deshacen.',
      resist: { 7: -50, 2: -30, 5: 40, 8: 60 },
      skills: [['MONSTRUO_TOQUE_GELIDO', 25], ['MONSTRUO_MALDICION_OSCURA', 15]],
      // raro mágico: pega con magia, aguanta la magia y esquiva
      scalings: [7, 14].map((lv) => monsterRow(lv, 'RARE', { magic: true, hp: 0.85, def: 0.7, magic_def: 1.3, spd: 1.2, evasion: 4, elemental_damage: 6 })),
    },
    {
      code: 'CRIPTA_VIGIA', name: 'El Vigía Caído', rarity: 'LEGENDARY', category: 'MUERTO_VIVIENTE', base: 10, xp: 2200, gold: 900,
      description: 'El guardián que vigilaba la Pradera desde su torre. Su faro aún arde en el pecho: cuando te apunta con él, cúbrete.',
      resist: { 8: 50 },
      skills: [['MONSTRUO_MALDICION_OSCURA', 15], ['MONSTRUO_GOLPE_BRUTAL', 20], ['MONSTRUO_ESCUDO_HUESO', 15]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además dispara su faro)
      scalings: [7, 14].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.9, def: 1.1, elemental_damage: 6 })),
    },
  ],
  // botín: todo de su nivel (5-12). Los guardianes eran soldados de la guardia del Vigía (medallas para
  // el set de la Guardia) y el Vigía suelta su Ojo (armas del Vigía Caído)
  drops: [
    ['CRIPTA_CENTINELA', 'MEDALLA_VIGIA', 35, 1, 2],
    ['CRIPTA_CENTINELA', 'MINERAL_DE_HIERRO', 25, 1, 2],
    ['CRIPTA_ESPECTRO', 'MEDALLA_VIGIA', 30, 1, 2],
    ['CRIPTA_ESPECTRO', 'POLVO_ARCANO', 15, 1, 1],
    ['CRIPTA_VIGIA', 'OJO_DEL_VIGIA', 50, 1, 1],
    ['CRIPTA_VIGIA', 'MEDALLA_VIGIA', 100, 2, 3],
    ['CRIPTA_VIGIA', 'PIEDRA_ENCANT_MENOR', 20, 1, 1],
  ],
  // cofre del Vigía: oro + una cosa (peso, qué da). setSuffix: una pieza del set de la Guardia de tu clase
  chest: {
    gold: (level) => 500 + 40 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 2 },
      { w: 35, setSuffix: 'VIGIA', qty: 1 },
      { w: 25, codes: ['OJO_DEL_VIGIA'], qty: [1, 2] },
    ],
  },
  // la Puerta del Vigía está sellada hasta que Aldren te da su llave en «La torre que vigilaba»
  access: {
    quest: 'PRADERA_HISTORIA_08_TORRE', key: 'LLAVE_DEL_VIGIA',
    sealedText: 'La Puerta del Vigía está sellada con símbolos que no entiendes. Quizás Aldren, en la Aldea Espiga, sepa algo.',
  },
  texts: {
    name: 'La Cripta del Vigía', bossName: 'el Vigía Caído', doorName: 'la Puerta del Vigía', brazierWord: 'Brasero',
    chestName: 'Cofre del Vigía', guardianWord: 'guardián de la cripta', icon: 'crypt-entrance', brazierIcon: 'lighthouse',
    bossIcon: 'lighthouse', bossDownText: '¡El Vigía Caído se apaga!',
    clearedText: 'Ya limpiaste la cripta. Sal y vuelve a entrar para recorrerla otra vez.',
    doorClosedText: 'La Puerta del Vigía sigue sellada: vence antes a los tres guardianes',
    doorHint: 'Una runa de luz sella la puerta. Se abrirá cuando caigan los tres guardianes de la cripta.',
    news: (names, many) => `¡${names} ${many ? 'han' : 'ha'} derrotado al Vigía Caído en la cripta bajo las ruinas!`,
  },
});
