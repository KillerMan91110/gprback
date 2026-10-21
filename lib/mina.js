// La Mina Profunda: la mina enana que los abuelos de Durgan sellaron hace trescientos años, bajo las
// Minas Abandonadas (Montañas Grises). Abajo duerme el Segundo Sello. Zona propia del mundo 2D
// (gpr/public/assets/mundo/mina_profunda, generada por art/mapas/generar_mina.js). El motor es el
// molde de lib/mazmorra.js; aquí va lo propio:
//   - tres guardianes: dos Mineros Poseídos que patrullan la Galería de las Vagonetas y el Gólem de
//     Veta del Pozo de Cristal;
//   - el Gólem de Hierro Negro: su escudo cambia de debilidad (Rayo → Agua → Hielo) y cada tanto
//     golpea el techo apuntando a un héroe: si ese héroe no se defiende en su turno, se le cae encima;
//   - el cofre de los enanos (cada 3 h): oro y pociones, una pieza de Montañas de tu clase o Corazones
//     de Hierro Negro (para las armas de Hierro Negro).
// Se abre con la historia: la llave que Durgan te da en la M5 «Los guardianes de piedra» (db/schema.sql).
const { monsterRow } = require('./equilibrio');
const { crearMazmorra } = require('./mazmorra');

module.exports = crearMazmorra({
  zoneDir: 'mina_profunda',
  zoneId: 2,
  table: 'player_mina_runs',
  targetPrefix: 'mina',
  minLevel: Number(process.env.MINA_NIVEL || 19),
  // 19 (la llave llega en la M5) a 27: sin hueco hasta el Señor del Acantilado y el Rey
  levels: { min: 19, max: 27 },
  chestHours: 3,
  // casillas locales de la mina (iguales que en generar_mina.js)
  braseros: {
    1: { x: 16, y: 7, name: 'el Farol de la Entrada' },
    2: { x: 12, y: 40, name: 'el Farol del Pozo' },
  },
  guardianes: {
    minero_norte: { name: 'Minero Poseído', box: [5, 24, 34, 24], monsters: ['MINA_MINERO', 'MINA_MINERO'] },
    minero_sur: { name: 'Minero Poseído', box: [5, 29, 34, 29], monsters: ['MINA_MINERO', 'MINA_GOLEM_VETA'] },
    // dos, no tres: con tres el grupo caía antes de vencerlos (scripts/equilibrio/generar.js --simular)
    golem_pozo: { name: 'Gólem de Veta', box: [11, 41, 28, 45], monsters: ['MINA_GOLEM_VETA', 'MINA_MINERO'] },
  },
  bossSpot: { x: 20, y: 52 },
  boss: {
    code: 'MINA_GOLEM_NEGRO',
    weakCycle: [3, 6, 2], // Rayo → Agua → Hielo → Rayo…
    shieldText: (name, el) => `El hierro de ${name} se enfría y se endurece de otra forma: ahora lo rompe ${el}.`,
    // el derrumbe: cada 3 turnos apunta a alguien; las rocas quitan el 50% de la vida máxima (8% si se cubrió)
    beam: {
      every: 3, pct: 0.5, guardedPct: 0.08,
      markText: (a, t) => `${a} golpea el techo y señala a ${t}: las piedras empiezan a crujir… ¡Defiéndete en tu próximo turno!`,
      hitText: (a, t, dmg) => `¡El techo se derrumba sobre ${t}! ${dmg} de daño.`,
      guardedText: (a, t, dmg) => `¡Las rocas caen sobre ${t}, que se cubrió a tiempo! Solo ${dmg} de daño.`,
      missText: (a, t) => `El derrumbe cae donde estaba ${t}, pero ya no está ahí.`,
    },
  },
  monsters: [
    {
      code: 'MINA_MINERO', name: 'Minero Poseído', rarity: 'RARE', category: 'HUMANOIDE', base: 20, xp: 780, gold: 260,
      description: 'Un minero enano que se quedó demasiado tiempo junto a los cristales. Ya no recuerda su nombre, solo la orden de cavar.',
      resist: { 8: 40, 7: -50 },
      skills: [['MONSTRUO_GOLPE_PICO', 30]],
      scalings: [19, 27].map((lv) => monsterRow(lv, 'RARE', { atk: 1.1, def: 1.05, magic_def: 0.9 })),
    },
    {
      code: 'MINA_GOLEM_VETA', name: 'Gólem de Veta', rarity: 'RARE', category: 'ELEMENTAL', base: 20, xp: 820, gold: 240,
      description: 'Un pedazo de veta que se levantó y camina. Tiene cristales negros donde debería tener ojos.',
      resist: { 5: 40, 3: -30, 6: -30 },
      skills: [['MONSTRUO_PIEL_PIEDRA', 20], ['MONSTRUO_PIEDRAZO', 25]],
      scalings: [19, 27].map((lv) => monsterRow(lv, 'RARE', { hp: 1.15, def: 1.35, spd: 0.7 })),
    },
    {
      code: 'MINA_GOLEM_NEGRO', name: 'Gólem de Hierro Negro', rarity: 'LEGENDARY', category: 'ELEMENTAL', base: 22, xp: 5500, gold: 1800,
      description: 'El guardián que los enanos forjaron para cuidar el Segundo Sello. Alguien le clavó cristales de eclipse en el pecho.',
      resist: { 8: 40, 5: 30 },
      skills: [['MONSTRUO_TERREMOTO', 20], ['MONSTRUO_PIEL_PIEDRA', 15], ['MONSTRUO_GOLPE_BRUTAL', 20], ['JEFE_MINA_GOLEM_NEGRO_1', 25]],
      // jefe de la mazmorra, pensado para pelearlo en grupo (además derrumba el techo); 10% menos de vida
      // que al principio: duraba 8 rondas contra un grupo, ahora unas 7
      scalings: [19, 27].map((lv) => monsterRow(lv, 'LEGENDARY', { hp: 0.855, def: 1.15, elemental_damage: 8 })),
    },
  ],
  // botín: Mena de Hierro Negro en todos (armas de Hierro Negro), y el Corazón del gólem
  drops: [
    ['MINA_MINERO', 'MENA_HIERRO_NEGRO', 35, 1, 2],
    ['MINA_MINERO', 'MINERAL_DE_ACERO', 25, 1, 2],
    ['MINA_GOLEM_VETA', 'MENA_HIERRO_NEGRO', 40, 1, 2],
    ['MINA_GOLEM_VETA', 'FRAGMENTO_PIEDRA_VIVA', 25, 1, 2],
    ['MINA_GOLEM_NEGRO', 'CORAZON_HIERRO_NEGRO', 50, 1, 1],
    ['MINA_GOLEM_NEGRO', 'MENA_HIERRO_NEGRO', 100, 2, 3],
    ['MINA_GOLEM_NEGRO', 'PIEDRA_ENCANT_MAYOR', 20, 1, 1],
  ],
  chest: {
    gold: (level) => 900 + 60 * level,
    pool: [
      { w: 40, codes: ['POCION_DE_VIDA_MAYOR', 'POCION_DE_MANA_MAYOR'], qty: 3 },
      { w: 35, setSuffix: 'MONTANAS', qty: 1 },
      { w: 25, codes: ['CORAZON_HIERRO_NEGRO'], qty: [1, 2] },
    ],
  },
  // objetos propios (los crea el molde la primera vez): la llave de Durgan, la mena y el corazón del jefe
  items: [
    { code: 'LLAVE_MINA_PROFUNDA', name: 'Llave de la Mina Profunda', rarity: 'RARO', quest: true,
      description: 'Una llave de hierro negro, pesada como un martillo, con runas enanas en el paletón. Abre la puerta sellada bajo las Minas Abandonadas.' },
    { code: 'MENA_HIERRO_NEGRO', name: 'Mena de Hierro Negro', rarity: 'RARO',
      description: 'Roca oscura de la Mina Profunda con vetas que brillan azul. Solo los herreros enanos saben fundirla. Con ella se forjan las armas de Hierro Negro.' },
    { code: 'CORAZON_HIERRO_NEGRO', name: 'Corazón de Hierro Negro', rarity: 'EPICO',
      description: 'El núcleo todavía tibio del Gólem de Hierro Negro. Los herreros enanos pagarían mucho por trabajarlo.' },
  ],
  // se abre con la llave que Durgan te da en la M5 (o con la M6 «La Mina Profunda» ya completada)
  access: {
    quest: 'MONTANAS_HISTORIA_06_SELLO', key: 'LLAVE_MINA_PROFUNDA',
    sealedText: 'Una puerta de hierro negro, con runas enanas y un candado del tamaño de tu cabeza. Durgan, en el Bastión de Hierro, debe tener la llave.',
  },
  texts: {
    name: 'La Mina Profunda', bossName: 'el Gólem de Hierro Negro', doorName: 'la Reja del Sello', brazierWord: 'Farol',
    chestName: 'Cofre de los enanos', guardianWord: 'guardián de la mina', icon: 'mine-wagon', brazierIcon: 'old-lantern',
    bossIcon: 'metal-golem-head', bossDownText: '¡El Gólem de Hierro Negro se derrumba!',
    clearedText: 'Ya limpiaste la mina. Sal y vuelve a entrar para recorrerla otra vez.',
    doorClosedText: 'La Reja del Sello sigue cerrada: vence antes a los tres guardianes',
    doorHint: 'Una reja de hierro con runas enanas cierra el paso. Se abrirá cuando caigan los tres guardianes de la mina.',
    news: (names, many) => `¡${names} ${many ? 'han' : 'ha'} derrotado al Gólem de Hierro Negro en la Mina Profunda!`,
  },
});
