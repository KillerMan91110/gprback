// El Trono de Huesos: la corte del Lich en las Catacumbas del Abismo, una sala del trono hecha con los
// huesos de los sacerdotes que traicionó. Ahí guardaba a su escolta y a una de las Veladas, la hermana de
// Liora, atada con cadenas del eclipse para que fuera los ojos de su corte.
// Zona propia del mundo 2D (gpr/public/assets/mundo/trono_huesos, generada por
// art/mapas/generar_trono_huesos.js). El motor es el molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes: el Bufón de Hueso de la Galería del Bufón, la Guardia Real (de a dos) del Puente de
//     Costillas y la Doncella Velada de su cámara (al vencerla queda libre);
//   - las velas negras (los "braseros" de esta mazmorra): al encenderlas, si caes o sales, retomas desde
//     la última;
//   - el Coloso de Huesos: su escudo de huesos cambia de debilidad (Luz → Fuego) y cada tanto levanta el
//     garrote sobre un héroe: si ese héroe no se defiende en su turno, le cae;
//   - el cofre del trono (cada 3 h): oro y pociones, una pieza Sepulcral de tu clase o Coronas de Huesos
//     (para las armas del Trono).
// Se abre con la historia: la Llave de Hueso que Liora te da en la A8 «La llave de hueso».
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'trono_huesos',
  zoneId: 6,
  table: 'player_trono_huesos_runs',
  targetPrefix: 'trono_huesos',
  minLevel: Number(process.env.TRONO_HUESOS_NIVEL || 80),
  // 80 (la llave llega en la A8, nivel 83; se puede entrar antes si ya tienes el nivel) a 84
  levels: { min: 80, max: 84 },
  chestHours: 3,
  // casillas locales del trono (iguales que en generar_trono_huesos.js)
  braseros: {
    1: { x: 13, y: 9, name: 'la Vela del Arco' },
    2: { x: 27, y: 33, name: 'la Vela de las Ofrendas' },
  },
  guardianes: {
    bufon: { name: 'Bufón de Hueso', box: [6, 18, 33, 18], monsters: ['TRONOH_BUFON', 'TRONOH_GUARDIA'] },
    guardia: { name: 'Guardia Real Esquelética', box: [8, 26, 31, 26], monsters: ['TRONOH_GUARDIA', 'TRONOH_GUARDIA'] },
    doncella: { name: 'Doncella Velada', box: [11, 40, 28, 44], monsters: ['TRONOH_DONCELLA', 'TRONOH_BUFON'] },
  },
  bossSpot: { x: 20, y: 53 },
  boss: {
    code: 'TRONOH_COLOSO',
    weakCycle: [7, 1], // Luz → Fuego → Luz…
    shieldText: (name, el) => `Los huesos sueltos vuelven a trepar por ${name} y lo cubren otra vez: ahora los rompe ${el}.`,
    // el Garrote de los Mil: cada 3 turnos apunta a alguien; quita el 50% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.5, guardedPct: 0.08,
      markText: (a, t) => `${a} levanta el garrote de columnas sobre ${t} y los cráneos de su cuerpo se ríen todos a la vez… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡El Garrote de los Mil de ${a} cae sobre ${t}! ${dmg} de daño.`,
      guardedText: (a, t, dmg) => `¡El Garrote de los Mil de ${a} rebota en el escudo de ${t}, que se cubrió a tiempo! Solo ${dmg} de daño.`,
      missText: (a, t) => `El Garrote de los Mil parte las losas donde estaba ${t}, pero ya no está ahí.`,
    },
  },
  monsters: [
    {
      code: 'TRONOH_BUFON', name: 'Bufón de Hueso', rarity: 'RARE', category: 'MUERTO_VIVIENTE', base: 81, xp: 4400, gold: 1050,
      description: 'Divertía al Lich en sus banquetes de mil años. Ya no le queda cara para sonreír, así que se ríe con los cráneos que tira.',
      resist: { 8: 40, 4: 20, 7: -40, 1: -20 },
      skills: [['MONSTRUO_RAYO_OSCURO', 30], ['MONSTRUO_MALDICION_OSCURA', 25]],
      scalings: [80, 84].map((lv) => monsterRow(lv, 'RARE', { hp: 1.0, def: 0.85, magic_atk: 1.3, magic_def: 1.15, spd: 1.2 })),
    },
    {
      code: 'TRONOH_GUARDIA', name: 'Guardia Real Esquelética', rarity: 'RARE', category: 'MUERTO_VIVIENTE', base: 82, xp: 4600, gold: 1080,
      description: 'Los soldados que juraron cuidar al sumo sacerdote hasta la muerte. Él se aseguró de que siguieran cuidándolo después.',
      resist: { 8: 40, 2: 20, 7: -40, 5: -20 },
      skills: [['MONSTRUO_TAJO_SOMBRIO', 30], ['MONSTRUO_ESCUDO_HUESOS', 20]],
      scalings: [80, 84].map((lv) => monsterRow(lv, 'RARE', { hp: 1.15, atk: 1.15, def: 1.3, spd: 0.85 })),
    },
    {
      code: 'TRONOH_DONCELLA', name: 'Doncella Velada', rarity: 'RARE', category: 'ESPECTRO', base: 83, xp: 4800, gold: 1120,
      description: 'Una de las Veladas, hermana de Liora. El Lich la ató al trono con cadenas del eclipse para que fuera los ojos de su corte. Pelea llorando.',
      resist: { 8: 30, 2: 30, 7: -30, 3: -30 },
      skills: [['MONSTRUO_CADENAS_ESPECTRALES', 30], ['MONSTRUO_GRITO_ALMA', 25]],
      scalings: [80, 84].map((lv) => monsterRow(lv, 'RARE', { hp: 1.0, def: 0.9, magic_atk: 1.3, magic_def: 1.25, spd: 1.1 })),
    },
    {
      code: 'TRONOH_COLOSO', name: 'Coloso de Huesos', rarity: 'LEGENDARY', category: 'MUERTO_VIVIENTE', base: 84, xp: 25000, gold: 8000,
      description: 'El Lich lo armó con los huesos de los mil sacerdotes que traicionó y le puso la mitra del sumo sacerdote, como burla. Los cráneos de su cuerpo todavía rezan.',
      resist: { 8: 50, 5: 30, 2: 20 },
      skills: [['MONSTRUO_GOLPE_BRUTAL', 30], ['MONSTRUO_PISOTON', 25], ['MONSTRUO_EXPLOSION_OSCURA', 20], ['JEFE_TRONOH_COLOSO_1', 25]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además levanta el Garrote de los Mil): la
      // misma vida en proporción que Escarcha en la Cripta Congelada, un poco más por el equipo de la zona
      scalings: [80, 84].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.95, atk: 1.1, def: 1.15, elemental_damage: 8 })),
    },
  ],
  // botín: Plata Sepulcral Pura en todos (armas del Trono) y la Corona de Huesos del Coloso
  drops: [
    ['TRONOH_BUFON', 'PLATA_SEPULCRAL_PURA', 35, 1, 2],
    ['TRONOH_BUFON', 'HUESO_REANIMADO', 30, 1, 2],
    ['TRONOH_GUARDIA', 'PLATA_SEPULCRAL_PURA', 30, 1, 2],
    ['TRONOH_GUARDIA', 'YELMO_VACIO', 12, 1, 1],
    ['TRONOH_DONCELLA', 'PLATA_SEPULCRAL_PURA', 40, 1, 2],
    ['TRONOH_DONCELLA', 'ESENCIA_DE_ALMA', 35, 1, 2],
    ['TRONOH_COLOSO', 'CORONA_HUESOS', 50, 1, 1],
    ['TRONOH_COLOSO', 'PLATA_SEPULCRAL_PURA', 100, 2, 3],
    ['TRONOH_COLOSO', 'PIEDRA_ENCANT_MAYOR', 20, 1, 1],
  ],
  chest: {
    gold: (level) => 4500 + 130 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 3 },
      { w: 35, setSuffix: 'SEPULCRAL', qty: 1 },
      { w: 25, codes: ['CORONA_HUESOS'], qty: [1, 2] },
    ],
  },
  // la llave la crea el SQL de las misiones; aquí por si el servidor arranca antes de correrlo
  items: [
    { code: 'LLAVE_HUESO', name: 'Llave de Hueso', rarity: 'RARO', quest: true,
      description: 'Una llave tallada en un solo hueso, larga como una mano. Liora la guardó mil años. Abre el Trono de Huesos.' },
  ],
  // se abre con la A8 (Liora te da la llave) o con la A9 «El Trono de Huesos» ya completada
  access: {
    quest: 'CATACUMBAS_HISTORIA_09_TRONO', key: 'LLAVE_HUESO',
    sealedText: 'Un arco de cráneos, cientos, todos mirando hacia adentro. En el medio, una cerradura con forma de hueso. Liora, junto a la Gran Vela de Vela Eterna, guarda la llave.',
  },
  texts: {
    name: 'El Trono de Huesos', bossName: 'el Coloso de Huesos', doorName: 'la Puerta de Hueso', brazierWord: 'Vela',
    chestName: 'Cofre del trono', guardianWord: 'guardián del trono', icon: 'throne-king', brazierIcon: 'candles',
    bossIcon: 'bone-mace', bossDownText: '¡El ojo del eclipse del pecho del Coloso se apaga! Los mil huesos se sueltan a la vez y caen como lluvia sobre las losas. Por un momento, los cráneos dejan de rezar. Después, muy bajito, empiezan a cantar.',
    clearedText: 'Ya recorriste el Trono. Sal y vuelve a entrar para bajar otra vez.',
    doorClosedText: 'La Puerta de Hueso sigue cerrada: vence antes a los tres guardianes',
    doorHint: 'Una puerta hecha de huesos largos atados con oro, sellada con el ojo del eclipse. Se abrirá cuando caigan los tres guardianes del trono.',
    news: (names, many) => `¡${names} ${many ? 'han' : 'ha'} derribado al Coloso de Huesos en el Trono de Huesos!`,
  },
});
