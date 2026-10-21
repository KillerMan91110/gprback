// Logros (gprback/docs/logros_propuesta.md): 62 hazañas en 9 grupos. Cada una tiene un nombre, una línea de
// lore, cómo se gana y su premio. Hay tres capas de premios, para que se noten sin romper el juego:
//   - Cacería: siempre activa, +5% de daño contra esa familia (un logro por familia: no se apila).
//   - Título: los demás dan un título. Se equipa uno solo, se ve sobre el nombre del héroe y trae un
//     bono chico de utilidad (a veces solo en una zona o mazmorra). Los Secretos dan solo el título.
//   - Puntos de Gesta: cada logro da 5, 10 o 25. Al juntar puntos se ganan mejoras permanentes chicas
//     con tope (HITOS: +2% experiencia, +2% oro y +4% de vida en total).
// Los bonos de título y de Gesta entran por los bonos de utilidad del combate (lib/coleccion.js
// utilityBonuses): oro, experiencia, botín, recuperarse, defensa, cartas y vida.
//
// Los logros se revisan con revisar(playerId) después de cada combate, misión, fabricación, huevo,
// sobre o secreto, y al abrir la ventana de Logros (así se dan también los que se ganaron antes de
// que existieran). En la base viven en `achievements` (generados por
// gpr/_respaldo_claude/logros/gen_logros.js); las condiciones viven aquí.
const db = require('../db/db');
const { positionOf } = require('./worldPresence');

// ---------------------------------------------------------------- los logros
const HISTORIA = (code, nombre, lore, como, quests, puntos, bono) => ({ code, grupo: 'historia', nombre, lore, como, cond: { t: 'quest', any: quests }, puntos, bono });
const PRIMERA = (code, nombre, lore, jefe, monster, dir) => ({ code, grupo: 'primera', nombre, lore, como: `Matar por primera vez a ${jefe}`, cond: { t: 'kill', monster }, puntos: 10, bono: { drop: 5, dir, donde: 'en su zona' } });
const MAZMORRA = (code, nombre, lore, mazmorra, table, dir) => ({ code, grupo: 'mazmorras', nombre, lore, como: `Vencer al jefe de ${mazmorra}`, cond: { t: 'mazmorra', table }, puntos: 10, bono: { gold: 5, dir, donde: 'en esa mazmorra' } });
const CACERIA = (code, nombre, lore, cat, n, familia) => ({ code, grupo: 'caceria', nombre, lore, como: `Derrotar ${n} ${familia}`, cond: { t: 'categoria', cat, n }, puntos: 10, caceria: cat });

const LOGROS = [
  // 1. Historia
  HISTORIA('LOG_HIST_PRADERA', 'El Primer Fuego', 'La Pradera vuelve a oler a hierba, no a ceniza.', 'Terminar la historia de la Pradera', ['PRADERA_HISTORIA_14_MONTANAS'], 10, { xp: 5, dir: 'montanas', donde: 'en las Montañas' }),
  HISTORIA('LOG_HIST_MONTANAS', 'Barba de Piedra', 'Los enanos del Bastión brindan con tu nombre. Mal pronunciado, pero brindan.', 'Terminar la historia de las Montañas', ['MONTANAS_HISTORIA_13_GUARDIA'], 10, { xp: 5, dir: 'volcan', donde: 'en el Volcán' }),
  HISTORIA('LOG_HIST_VOLCAN', 'Corazón de Brasa', 'El volcán se durmió. Tú no tanto.', 'Terminar la historia del Volcán', ['VOLCAN_HISTORIA_13_OFRENDA'], 10, { xp: 5, dir: 'costas', donde: 'en las Costas' }),
  HISTORIA('LOG_HIST_COSTAS', 'El Mar Te Debe Una', 'Rhaegar jura que la Gaviota Insolente lleva tu nombre en la proa. No es cierto.', 'Terminar la historia de las Costas', ['COSTAS_HISTORIA_13_FARO'], 10, { xp: 5, dir: 'tundra', donde: 'en la Tundra' }),
  HISTORIA('LOG_HIST_TUNDRA', 'Hielo en las Venas', 'El norte no da las gracias. Te da una manta.', 'Terminar la historia de la Tundra', ['TUNDRA_HISTORIA_14_PERDON', 'TUNDRA_HISTORIA_14_JUSTICIA'], 10, { xp: 5, dir: 'catacumbas', donde: 'en las Catacumbas' }),
  HISTORIA('LOG_HIST_CATACUMBAS', 'La Luz Bajo la Tierra', 'En Vela Eterna dejaron una vela encendida para ti.', 'Terminar la historia de las Catacumbas', ['CATACUMBAS_HISTORIA_14_FRAGMENTO'], 10, { xp: 5, dir: 'ruinas', donde: 'en las Ruinas' }),
  // el Vigía ya existía (ACH_VIGIA_ETHERIA: +10% contra lo cósmico, siempre); ahora también es título
  HISTORIA('ACH_VIGIA_ETHERIA', 'Vigía de Etheria', 'Los siete Sellos cantan otra vez.', 'Entregar «El Vigía de Etheria»', ['RUINAS_HISTORIA_14_VIGIA'], 25, { drop: 3 }),
  HISTORIA('LOG_PERDON', 'Mano Tendida', 'Le diste a Hela lo que nadie le dio: otra oportunidad.', 'Elegir el perdón en la Tundra', ['TUNDRA_HISTORIA_14_PERDON'], 5, { regen: 3 }),
  HISTORIA('LOG_JUSTICIA', 'Balanza de Aurelia', 'La justicia duele. Por eso pesa.', 'Elegir la justicia en la Tundra', ['TUNDRA_HISTORIA_14_JUSTICIA'], 5, { guard: 2 }),
  HISTORIA('LOG_GORETH', 'Amigo del Yunque', 'Goreth te forjó una herradura. Goreth no le forja nada a nadie.', 'Avisarle a Goreth del plan de Bruno', ['PRADERA_SEC_CERCA_3'], 5, { gold: 3 }),
  HISTORIA('LOG_BRUNO', 'Cómplice de Calabazas', 'Lo que pasó en el guiso de Goreth, queda en el guiso de Goreth.', 'Seguirle la broma a Bruno', ['PRADERA_SEC_CERCA_3_BRUNO'], 5, { mana: 3 }),

  // 2. Primera sangre
  PRIMERA('LOG_JEFE_PRADERA', 'Matatitanes', 'Era grande. Ahora es grande y está en el suelo.', 'el Titán de la Pradera', 'TITAN_PRADERA', 'pradera'),
  PRIMERA('LOG_JEFE_MONTANAS', 'Destronador', 'La montaña tuvo un rey. Ahora tiene una historia.', 'el Rey de la Montaña', 'REY_MONTANA', 'montanas'),
  PRIMERA('LOG_JEFE_VOLCAN', 'Apagafuegos', 'Hace falta mucho valor para pelear con un volcán que camina.', 'el Titán de Fuego', 'TITAN_FUEGO', 'volcan'),
  PRIMERA('LOG_JEFE_COSTAS', 'Lo Que Duerme Abajo', 'Bajaste donde no llega la luz y volviste para contarlo.', 'la Bestia de las Profundidades', 'BESTIA_PROFUNDIDADES', 'costas'),
  PRIMERA('LOG_JEFE_TUNDRA', 'Deshielo', 'Un rey de hielo, una corona rota y un invierno menos.', 'el Rey del Hielo', 'REY_HIELO', 'tundra'),
  PRIMERA('LOG_JEFE_CATACUMBAS', 'Fin de la Eternidad', 'El Lich creía que era eterno. Se equivocó por poco.', 'el Lich Ancestral', 'LICH_ANCESTRAL', 'catacumbas'),
  PRIMERA('LOG_JEFE_RUINAS', 'Huesos de Estrella', 'Hasta los gigantes del abismo tienen un último día.', 'el Gran Esqueleto del Abismo', 'GRAN_ESQUELETO_ABISMO', 'ruinas'),
  { code: 'LOG_JEFES_TODOS', grupo: 'primera', nombre: 'Cazador de Leyendas', lore: 'Hay bestias de las que solo se habla en las tabernas. Tú las conociste a todas.', como: 'Matar a los 7 jefes de zona',
    cond: { t: 'kills', monsters: ['TITAN_PRADERA', 'REY_MONTANA', 'TITAN_FUEGO', 'BESTIA_PROFUNDIDADES', 'REY_HIELO', 'LICH_ANCESTRAL', 'GRAN_ESQUELETO_ABISMO'] }, puntos: 25, bono: { drop: 3 } },

  // 3. Mazmorras
  MAZMORRA('LOG_MAZ_CRIPTA', 'La Cripta Calla', 'El Vigía Caído descansa. Los braseros, no.', 'la Cripta del Vigía', 'player_crypt_runs', 'cripta'),
  MAZMORRA('LOG_MAZ_MINA', 'Minero de Fondo', 'En la Mina Profunda ya no se escuchan martillazos que no son de nadie.', 'la Mina Profunda', 'player_mina_runs', 'mina_profunda'),
  MAZMORRA('LOG_MAZ_FISURA', 'Cruzar la Fisura', 'Bajaste al infierno con una antorcha. Volviste con dos.', 'la Fisura Infernal', 'player_fisura_runs', 'fisura'),
  MAZMORRA('LOG_MAZ_ARRECIFE', 'Aire Prestado', 'En el Arrecife Hundido aprendiste a contener la respiración. Y la rabia.', 'el Arrecife Hundido', 'player_arrecife_runs', 'arrecife'),
  MAZMORRA('LOG_MAZ_CRIPTA_CONGELADA', 'La Reina Ya No Llora', 'En la Cripta Congelada, el hielo por fin se derritió un poco.', 'la Cripta Congelada', 'player_cripta_congelada_runs', 'cripta_congelada'),
  MAZMORRA('LOG_MAZ_TRONO', 'Sin Trono', 'Le quitaste la silla a la muerte. No le gustó.', 'el Trono de Huesos', 'player_trono_huesos_runs', 'trono_huesos'),
  MAZMORRA('LOG_MAZ_OBSERVATORIO', 'El Ojo Se Cierra', 'En el Observatorio Roto, por fin, nadie te mira.', 'el Observatorio Roto', 'player_observatorio_runs', 'observatorio'),
  { code: 'LOG_MAZ_50', grupo: 'mazmorras', nombre: 'Rata de Mazmorra', lore: 'Ya no le temes a la oscuridad. La oscuridad te tiene un poco de miedo a ti.', como: 'Vencer 50 jefes de mazmorra (sumando todas)',
    cond: { t: 'mazmorras', n: 50 }, puntos: 25, bono: { gold: 3 } },

  // 4. Solitario (los cuenta el combate: lib/logros.js despuesDelCombate)
  { code: 'LOG_SOLO_JEFE', grupo: 'solitario', nombre: 'Lobo Solitario', lore: 'Nadie te cubrió la espalda. Nadie hizo falta.', como: 'Matar a un jefe de zona tú solo', cond: { t: 'contador', code: 'JEFES_SOLO', n: 1 }, puntos: 10, bono: { guard: 3 } },
  { code: 'LOG_SOLO_MAZMORRA', grupo: 'solitario', nombre: 'Una Sola Antorcha', lore: 'Entraste solo, saliste solo. La mazmorra quedó vacía.', como: 'Vencer al jefe de una mazmorra tú solo', cond: { t: 'contador', code: 'MAZMORRAS_SOLO', n: 1 }, puntos: 10, bono: { guard: 3 } },
  { code: 'LOG_SOLO_100', grupo: 'solitario', nombre: 'Cien Duelos', lore: 'Cien peleas a solas. Ya ni te tiembla la mano.', como: 'Ganar 100 combates tú solo', cond: { t: 'contador', code: 'COMBATES_SOLO', n: 100 }, puntos: 10, bono: { regen: 3 } },
  { code: 'LOG_AL_FILO', grupo: 'solitario', nombre: 'Al Filo', lore: 'Un golpe más y no lo cuentas. Pero lo cuentas.', como: 'Ganarle a un jefe con menos del 5% de vida', cond: { t: 'contador', code: 'AL_FILO', n: 1 }, puntos: 25, bono: { regen: 5 } },

  // 5. Cacería (+5% de daño contra la familia, siempre)
  CACERIA('LOG_CAZA_BESTIA', 'Rey de la Manada', 'Los lobos aúllan cuando pasas. De respeto.', 'BESTIA', 300, 'bestias'),
  CACERIA('LOG_CAZA_HUMANOIDE', 'Terror de los Caminos', 'Los bandidos cambian de ruta cuando te ven.', 'HUMANOIDE', 300, 'humanoides'),
  CACERIA('LOG_CAZA_MUERTO', 'Descansen en Paz', 'Les diste a los muertos lo que buscaban: silencio.', 'MUERTO_VIVIENTE', 300, 'muertos vivientes'),
  CACERIA('LOG_CAZA_ELEMENTAL', 'Domador de Elementos', 'El fuego, el agua y la piedra te reconocen.', 'ELEMENTAL', 200, 'elementales'),
  CACERIA('LOG_CAZA_ACUATICO', 'Lobo de Mar', 'Ya no le temes a nada que tenga escamas o tentáculos.', 'ACUATICO', 150, 'acuáticos'),
  CACERIA('LOG_CAZA_ESPECTRO', 'Cazafantasmas', 'Los espectros cruzan la calle cuando te ven venir.', 'ESPECTRO', 100, 'espectros'),
  CACERIA('LOG_CAZA_DEMONIO', 'Exorcista', 'Los demonios tienen tu nombre en una lista. Arriba de todo.', 'DEMONIO', 100, 'demonios'),
  CACERIA('LOG_CAZA_DRACOIDE', 'Matadragones', 'Las escamas de dragón quedan bien en cualquier pared.', 'DRACOIDE', 50, 'dracoides'),
  CACERIA('LOG_CAZA_COSMICO', 'Ojo del Cosmos', 'Miraste al vacío y el vacío parpadeó primero.', 'COSMICO', 100, 'cósmicos'),
  CACERIA('LOG_CAZA_INSECTOIDE', 'Pisotón', 'Arañas, escarabajos, cosas con muchas patas: ninguna se salvó.', 'INSECTOIDE', 100, 'insectoides'),

  // 6. Míticos y el Devorador
  { code: 'LOG_MITICO', grupo: 'miticos', nombre: 'Algo Más Grande', lore: 'Lo viste aparecer en el cielo. Y fuiste igual.', como: 'Participar en la caída de un jefe mítico', cond: { t: 'miticos', n: 1 }, puntos: 10, bono: { xp: 3 } },
  { code: 'LOG_MITICOS_7', grupo: 'miticos', nombre: 'Los Siete Míticos', lore: 'Siete criaturas que no deberían existir. Siete que ya no existen.', como: 'Participar en los 7 míticos (uno por zona)', cond: { t: 'miticos', n: 7 }, puntos: 25, bono: { drop: 4 } },
  { code: 'LOG_DEVORADOR', grupo: 'miticos', nombre: 'Un Rasguño a las Estrellas', lore: 'El Devorador sintió tu golpe. Uno de tantos, pero lo sintió.', como: 'Pegarle al Devorador de Estrellas', cond: { t: 'devorador' }, puntos: 5, bono: { xp: 2 } },
  { code: 'LOG_DEVORADOR_FINAL', grupo: 'miticos', nombre: 'El Último Golpe', lore: 'Cuando el Devorador cayó, la última espada fue la tuya.', como: 'Dar el golpe final al Devorador de Estrellas', cond: { t: 'devorador_final' }, puntos: 25, bono: { gold: 5 } },

  // 7. Artesanía
  { code: 'LOG_FABRICA_1', grupo: 'artesania', nombre: 'Manos de Aprendiz', lore: 'La primera pieza nunca sale derecha. La tuya casi.', como: 'Fabricar tu primera pieza', cond: { t: 'contador', code: 'OBJETOS_FABRICADOS', n: 1 }, puntos: 5, bono: { gold: 2 } },
  { code: 'LOG_FABRICA_100', grupo: 'artesania', nombre: 'Oficio', lore: 'Brokk dice que tienes buena mano. Ignar dice que la suya es mejor.', como: 'Fabricar 100 cosas', cond: { t: 'contador', code: 'OBJETOS_FABRICADOS', n: 100 }, puntos: 10, bono: { gold: 3 } },
  { code: 'LOG_FABRICA_LEGENDARIA', grupo: 'artesania', nombre: 'Obra Maestra', lore: 'Hay herreros que trabajan toda la vida y nunca forjan algo así.', como: 'Fabricar una pieza legendaria', cond: { t: 'contador', code: 'LEGENDARIOS_FABRICADOS', n: 1 }, puntos: 25, bono: { gold: 3 } },
  { code: 'LOG_LAGRIMA', grupo: 'artesania', nombre: 'Lágrima de Aethra', lore: 'Una sola lágrima, una sola arma. Es tuya.', como: 'Forjar la Lágrima de Aethra', cond: { t: 'contador', code: 'LAGRIMA_FORJADA', n: 1 }, puntos: 25, bono: { drop: 3 } },
  { code: 'LOG_POCIONES_50', grupo: 'artesania', nombre: 'Alquimista de Bolsillo', lore: 'Huele a hierbas y a algo quemado. Funciona.', como: 'Preparar 50 pociones', cond: { t: 'contador', code: 'POCIONES_CRAFTEADAS', n: 50 }, puntos: 10, bono: { mana: 3 } },

  // 8. Exploración y colección
  { code: 'LOG_SECRETO_1', grupo: 'exploracion', nombre: 'Ojos Curiosos', lore: 'Etheria guarda secretos. Tú ya encontraste uno.', como: 'Encontrar tu primer secreto', cond: { t: 'secretos', n: 1 }, puntos: 5, bono: { card: 10 } },
  { code: 'LOG_SECRETOS_TODOS', grupo: 'exploracion', nombre: 'Nada Se Te Escapa', lore: 'Si estaba escondido, ya no lo está.', como: 'Encontrar todos los secretos del mundo', cond: { t: 'secretos', n: 'todos' }, puntos: 25, bono: { card: 15 } },
  { code: 'LOG_SUBZONAS', grupo: 'exploracion', nombre: 'Cada Rincón', lore: 'Has caminado cada subzona de Etheria. Tus botas lo saben.', como: 'Pisar todas las subzonas de las 7 zonas', cond: { t: 'subzonas' }, puntos: 25, bono: { xp: 3 } },
  { code: 'LOG_BESTIARIO_ZONA', grupo: 'exploracion', nombre: 'Bestiario Vivo', lore: 'Conoces a cada criatura de una zona por su nombre. Y por sus mañas.', como: 'Dominar todas las fichas del bestiario de una zona', cond: { t: 'bestiario' }, puntos: 25, bono: { drop: 3 } },
  { code: 'LOG_CARTAS_50', grupo: 'exploracion', nombre: 'Coleccionista', lore: 'Tu álbum pesa más que tu mochila.', como: 'Tener 50 cartas distintas', cond: { t: 'cartas', n: 50 }, puntos: 10, bono: { card: 15 } },
  { code: 'LOG_MASCOTAS_ZONAS', grupo: 'exploracion', nombre: 'Arca de Etheria', lore: 'De cada rincón del mundo, un compañero.', como: 'Tener una mascota de cada zona', cond: { t: 'mascotas_zonas', n: 7 }, puntos: 25, bono: { regen: 3 } },
  { code: 'LOG_MASCOTAS_25', grupo: 'exploracion', nombre: 'Nido Lleno', lore: 'Incubar es esperar. Tú esperaste mucho.', como: 'Hacer nacer 25 mascotas', cond: { t: 'contador', code: 'MASCOTAS_NACIDAS', n: 25 }, puntos: 10, bono: { card: 10 } },
  { code: 'LOG_SOBRES_10', grupo: 'exploracion', nombre: 'Sobre Sorpresa', lore: 'Rompes el sello y contienes la respiración. Cada vez.', como: 'Abrir 10 sobres de cartas', cond: { t: 'contador', code: 'SOBRES_ABIERTOS', n: 10 }, puntos: 10, bono: { card: 10 } },

  // 9. Secretos (se ven como «???» hasta ganarlos; solo dan el título)
  { code: 'LOG_TRUENO', grupo: 'secretos', secreto: true, nombre: 'Amigo de Trueno', lore: 'Ese caballo te sigue a todos lados. O tú a él.', como: 'Encontrar a Trueno en todas sus escapadas',
    cond: { t: 'quests', all: ['PRADERA_SEC_TRUENO', 'VOLCAN_SEC_TRUENO', 'COSTAS_SEC_TRUENO', 'TUNDRA_SEC_TRUENO', 'CATACUMBAS_SEC_TRUENO', 'RUINAS_SEC_TRUENO'] }, puntos: 10 },
  { code: 'LOG_CAIDAS_50', grupo: 'secretos', secreto: true, nombre: 'El Pilar Te Conoce', lore: 'Aethra ya sabe tu nombre de tanto verte despertar.', como: 'Caer en combate 50 veces', cond: { t: 'caidas', n: 50 }, puntos: 10 },
  { code: 'LOG_COMIDAS_100', grupo: 'secretos', secreto: true, nombre: 'Buen Diente', lore: 'Comer bien también es una aventura.', como: 'Comer 100 comidas', cond: { t: 'contador', code: 'COMIDAS', n: 100 }, puntos: 10 },
  { code: 'LOG_NIVEL_100', grupo: 'secretos', secreto: true, nombre: '¿Y Ahora Qué?', lore: 'Salvaste el mundo. Te queda toda la vida por delante.', como: 'Llegar al nivel 100', cond: { t: 'nivel', n: 100 }, puntos: 25 },
];
const BY_CODE = new Map(LOGROS.map((l) => [l.code, l]));
// el Vigía, además, da siempre +10% de daño contra lo cósmico (bono de la base, como la Cacería)
BY_CODE.get('ACH_VIGIA_ETHERIA').extra = '+10% de daño contra lo cósmico, siempre';

const GRUPOS = [
  ['historia', 'Historia'], ['primera', 'Primera sangre'], ['mazmorras', 'Mazmorras'], ['solitario', 'Solitario'], ['caceria', 'Cacería'],
  ['miticos', 'Míticos'], ['artesania', 'Artesanía'], ['exploracion', 'Exploración'], ['secretos', 'Secretos'],
];

// Puntos de Gesta: los hitos (se suman, con tope; el último es solo para lucir)
const HITOS = [
  { puntos: 50, xp: 1, texto: '+1% de experiencia' },
  { puntos: 100, gold: 1, texto: '+1% de oro' },
  { puntos: 200, hp: 2, texto: '+2% de vida máxima en combate' },
  { puntos: 300, xp: 1, gold: 1, texto: '+1% de experiencia y +1% de oro' },
  { puntos: 450, hp: 2, texto: '+2% de vida máxima en combate' },
  { puntos: 600, aura: true, texto: 'Un aura dorada alrededor de tu héroe' },
];

// el texto del bono de un título
const BONO_TEXTO = { xp: 'de experiencia', gold: 'de oro', drop: 'de botín', regen: 'de vida al ganar', mana: 'de maná al ganar', guard: 'menos de daño recibido', card: 'de probabilidad de carta' };
function bonoTexto(b) {
  if (!b) return null;
  const partes = Object.entries(BONO_TEXTO).filter(([k]) => b[k]).map(([k, t]) => (k === 'guard' ? `-${b[k]}% de daño recibido` : `+${b[k]}% ${t}`));
  return partes.length ? `${partes.join(', ')}${b.donde ? ` ${b.donde}` : ''}` : null;
}

// ---------------------------------------------------------------- tablas
let ready = null;
function ensureTables() {
  ready ??= db.query(`
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS grupo TEXT;
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS lore TEXT;
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS puntos INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS secreto BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE achievements ADD COLUMN IF NOT EXISTS orden INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS titulo_logro TEXT`).catch((err) => { ready = null; throw err; });
  return ready;
}

// ---------------------------------------------------------------- lo que hizo el jugador (se carga solo lo que haga falta)
function snapshot(playerId) {
  const memo = {};
  const once = (k, fn) => (memo[k] ??= fn());
  return {
    quests: () => once('quests', async () => new Set((await db.query(
      'SELECT q.code FROM player_quest_completions c JOIN quests q ON q.id = c.quest_id WHERE c.player_id = $1', [playerId])).rows.map((r) => r.code))),
    bestiario: () => once('bestiario', async () => (await db.query(
      `SELECT m.code, m.category, m.zone_id, b.kills, b.completed FROM player_bestiary b JOIN monsters m ON m.id = b.monster_id WHERE b.player_id = $1`,
      [playerId])).rows.map((r) => ({ ...r, kills: Number(r.kills) }))),
    contadores: () => once('contadores', async () => new Map((await db.query(
      'SELECT counter_code, value FROM player_counters WHERE player_id = $1', [playerId])).rows.map((r) => [r.counter_code, Number(r.value)]))),
    clears: (table) => once(`clears_${table}`, async () => Number((await db.query(
      `SELECT COALESCE(clears, 0) AS n FROM ${table} WHERE player_id = $1`, [playerId]).catch(() => ({ rows: [] }))).rows[0]?.n ?? 0)),
    miticos: () => once('miticos', async () => (await db.query(
      `SELECT DISTINCT h.zone_id FROM mythic_hunt_damage d JOIN mythic_hunts h ON h.id = d.hunt_id
       WHERE d.player_id = $1 AND h.status = 'KILLED'`, [playerId]).catch(() => ({ rows: [] }))).rows.length),
    devorador: () => once('devorador', async () => {
      const [golpes, finales] = await Promise.all([
        db.query('SELECT 1 FROM world_boss_damage_log WHERE player_id = $1 AND total_damage > 0 LIMIT 1', [playerId]).catch(() => ({ rows: [] })),
        db.query('SELECT 1 FROM world_boss_events WHERE killed_by_player_id = $1 LIMIT 1', [playerId]).catch(() => ({ rows: [] })),
      ]);
      return { golpe: golpes.rows.length > 0, final: finales.rows.length > 0 };
    }),
    secretos: () => once('secretos', async () => Number((await db.query(
      'SELECT count(*)::int AS n FROM player_secrets WHERE player_id = $1', [playerId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n)),
    exploracion: () => once('exploracion', async () => new Map((await db.query(
      'SELECT zone_dir, subzones FROM player_exploration WHERE player_id = $1', [playerId]).catch(() => ({ rows: [] }))).rows.map((r) => [r.zone_dir, new Set(r.subzones ?? [])]))),
    cartas: () => once('cartas', async () => Number((await db.query(
      'SELECT count(*)::int AS n FROM player_cards WHERE player_id = $1', [playerId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n)),
    mascotasZonas: () => once('mascotas', async () => Number((await db.query(
      'SELECT count(DISTINCT p.zone_id)::int AS n FROM player_pets pp JOIN pets p ON p.id = pp.pet_id WHERE pp.player_id = $1 AND p.zone_id IS NOT NULL',
      [playerId]).catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n)),
    jugador: () => once('jugador', async () => (await db.query('SELECT level, combat_losses FROM players WHERE id = $1', [playerId])).rows[0] ?? {}),
    monstruosZona: () => once('monstruosZona', async () => (await db.query(
      `SELECT zone_id, count(*)::int AS n FROM monsters WHERE zone_id BETWEEN 1 AND 7 AND code NOT LIKE 'MITICO_%' GROUP BY zone_id`)).rows),
  };
}

const MAZMORRA_TABLES = LOGROS.filter((l) => l.cond.t === 'mazmorra').map((l) => l.cond.table);
const ZONAS_DIR = ['pradera', 'montanas', 'volcan', 'costas', 'tundra', 'catacumbas', 'ruinas'];

// avance de una condición: { cur, max }
async function avance(cond, s) {
  switch (cond.t) {
    case 'quest': { const q = await s.quests(); return { cur: cond.any.some((c) => q.has(c)) ? 1 : 0, max: 1 }; }
    case 'quests': { const q = await s.quests(); return { cur: cond.all.filter((c) => q.has(c)).length, max: cond.all.length }; }
    case 'kill': { const b = await s.bestiario(); return { cur: b.some((r) => r.code === cond.monster && r.kills > 0) ? 1 : 0, max: 1 }; }
    case 'kills': { const b = await s.bestiario(); return { cur: cond.monsters.filter((c) => b.some((r) => r.code === c && r.kills > 0)).length, max: cond.monsters.length }; }
    case 'categoria': { const b = await s.bestiario(); return { cur: b.filter((r) => r.category === cond.cat).reduce((t, r) => t + r.kills, 0), max: cond.n }; }
    case 'mazmorra': return { cur: Math.min(1, await s.clears(cond.table)), max: 1 };
    case 'mazmorras': { let t = 0; for (const tb of MAZMORRA_TABLES) t += await s.clears(tb); return { cur: t, max: cond.n }; }
    case 'contador': return { cur: (await s.contadores()).get(cond.code) ?? 0, max: cond.n };
    case 'miticos': return { cur: await s.miticos(), max: cond.n };
    case 'devorador': return { cur: (await s.devorador()).golpe ? 1 : 0, max: 1 };
    case 'devorador_final': return { cur: (await s.devorador()).final ? 1 : 0, max: 1 };
    case 'secretos': {
      const { SECRETS } = require('./exploracion');
      return { cur: await s.secretos(), max: cond.n === 'todos' ? Object.keys(SECRETS).length : cond.n };
    }
    case 'subzonas': {
      const { ZONES } = require('./exploracion');
      const ex = await s.exploracion();
      let cur = 0; let max = 0;
      for (const dir of ZONAS_DIR) {
        const all = ZONES[dir]?.subzones ?? [];
        max += all.length;
        cur += all.filter((n) => ex.get(dir)?.has(n)).length;
      }
      return { cur, max };
    }
    case 'bestiario': {
      // la zona más avanzada: fichas dominadas / monstruos de la zona
      const b = await s.bestiario();
      const zonas = await s.monstruosZona();
      let best = { cur: 0, max: zonas[0]?.n ?? 1 };
      for (const z of zonas) {
        const cur = b.filter((r) => r.zone_id === z.zone_id && r.completed).length;
        if (cur / z.n > best.cur / best.max) best = { cur, max: z.n };
      }
      return best;
    }
    case 'cartas': return { cur: await s.cartas(), max: cond.n };
    case 'mascotas_zonas': return { cur: await s.mascotasZonas(), max: cond.n };
    case 'caidas': return { cur: Number((await s.jugador()).combat_losses ?? 0), max: cond.n };
    case 'nivel': return { cur: Number((await s.jugador()).level ?? 1), max: cond.n };
    default: return { cur: 0, max: 1 };
  }
}

// ids de la base por código (los logros viven en `achievements`)
async function idsPorCodigo() {
  const r = await db.query('SELECT id, code FROM achievements WHERE code = ANY($1::text[])', [LOGROS.map((l) => l.code)]);
  return new Map(r.rows.map((x) => [x.code, x.id]));
}

const publico = (l) => ({ code: l.code, name: l.nombre, lore: l.lore, grupo: l.grupo, puntos: l.puntos, titulo: l.nombre, bono: bonoTexto(l.bono) });

// Revisa los logros que le faltan al jugador y da los que ya cumple. Devuelve los nuevos.
async function revisar(playerId) {
  if (!playerId) return [];
  await ensureTables();
  const ids = await idsPorCodigo();
  const tiene = new Set((await db.query('SELECT achievement_id FROM player_achievements WHERE player_id = $1', [playerId])).rows.map((r) => r.achievement_id));
  const faltan = LOGROS.filter((l) => ids.has(l.code) && !tiene.has(ids.get(l.code)));
  if (!faltan.length) return [];
  const s = snapshot(playerId);
  const nuevos = [];
  for (const l of faltan) {
    const { cur, max } = await avance(l.cond, s);
    if (cur < max) continue;
    const r = await db.query(
      'INSERT INTO player_achievements (player_id, achievement_id) VALUES ($1, $2) ON CONFLICT (player_id, achievement_id) DO NOTHING RETURNING id',
      [playerId, ids.get(l.code)]
    );
    if (r.rows.length) nuevos.push(publico(l));
  }
  return nuevos;
}

// Lo mismo, sin que un error en los logros rompa lo que lo llamó
const revisarSeguro = (playerId) => revisar(playerId).catch((err) => { console.error('[logros]', err.message); return []; });

// puntos de Gesta y los hitos alcanzados
function gesta(puntos) {
  const alcanzados = HITOS.filter((h) => puntos >= h.puntos);
  const total = alcanzados.reduce((t, h) => ({ xp: t.xp + (h.xp ?? 0), gold: t.gold + (h.gold ?? 0), hp: t.hp + (h.hp ?? 0) }), { xp: 0, gold: 0, hp: 0 });
  return { puntos, hitos: HITOS.map((h) => ({ ...h, logrado: puntos >= h.puntos })), total, aura: alcanzados.some((h) => h.aura) };
}

async function puntosDe(playerId) {
  const r = await db.query(
    'SELECT a.code FROM player_achievements pa JOIN achievements a ON a.id = pa.achievement_id WHERE pa.player_id = $1', [playerId]);
  return r.rows.reduce((t, x) => t + (BY_CODE.get(x.code)?.puntos ?? 0), 0);
}

// La ventana de Logros: todo, con el avance, los grupos, los puntos y el título equipado
async function estado(playerId) {
  await revisarSeguro(playerId);
  const ids = await idsPorCodigo();
  const ganados = new Map((await db.query(
    'SELECT a.code, pa.unlocked_at FROM player_achievements pa JOIN achievements a ON a.id = pa.achievement_id WHERE pa.player_id = $1', [playerId]))
    .rows.map((r) => [r.code, r.unlocked_at]));
  const s = snapshot(playerId);
  const list = [];
  for (const l of LOGROS) {
    if (!ids.has(l.code)) continue;
    const unlocked = ganados.has(l.code);
    const { cur, max } = unlocked ? { cur: 1, max: 1 } : await avance(l.cond, s);
    const oculto = l.secreto && !unlocked;
    list.push({
      code: l.code, grupo: l.grupo, unlocked, unlockedAt: ganados.get(l.code) ?? null, puntos: l.puntos, secreto: !!l.secreto,
      name: oculto ? '???' : l.nombre, lore: oculto ? 'Un logro secreto. Sigue jugando y quizás lo descubras.' : l.lore,
      como: oculto ? null : l.como,
      premio: l.caceria ? `+5% de daño contra ${l.como.replace(/^Derrotar \d+ /, '')}, siempre` : [l.extra, bonoTexto(l.bono)].filter(Boolean).join(' · ') || 'Solo el título',
      caceria: !!l.caceria,
      progress: { current: unlocked ? max : Math.min(cur, max), required: max },
    });
  }
  const titulo = (await db.query('SELECT titulo_logro FROM players WHERE id = $1', [playerId])).rows[0]?.titulo_logro ?? null;
  const puntos = list.filter((x) => x.unlocked).reduce((t, x) => t + x.puntos, 0);
  // (la lista va en «lista», no en «logros»: «logros» es lo que el front anuncia como recién ganado)
  return { grupos: GRUPOS.map(([id, name]) => ({ id, name })), lista: list, titulo, gesta: gesta(puntos), totalPuntos: LOGROS.reduce((t, l) => t + l.puntos, 0) };
}

// equipar un título (el nombre de un logro ganado que no sea de cacería) o quitarlo (code null)
async function equiparTitulo(playerId, code) {
  await ensureTables();
  if (code) {
    const l = BY_CODE.get(code);
    if (!l || l.caceria) return { error: 'Ese logro no da título' };
    const ok = await db.query(
      'SELECT 1 FROM player_achievements pa JOIN achievements a ON a.id = pa.achievement_id WHERE pa.player_id = $1 AND a.code = $2', [playerId, code]);
    if (!ok.rows.length) return { error: 'Todavía no ganaste ese logro' };
  }
  await db.query('UPDATE players SET titulo_logro = $2 WHERE id = $1', [playerId, code ?? null]);
  return { ok: true, titulo: code ? BY_CODE.get(code).nombre : null };
}

// el título que se ve sobre el nombre (y el aura de los 600 puntos), para el mundo
async function tituloVisible(playerId) {
  await ensureTables();
  const code = (await db.query('SELECT titulo_logro FROM players WHERE id = $1', [playerId])).rows[0]?.titulo_logro;
  const aura = gesta(await puntosDe(playerId)).aura;
  return { titulo: code ? BY_CODE.get(code)?.nombre ?? null : null, aura };
}

// Los bonos de utilidad de los logros: el del título equipado (si es de una zona, solo ahí) y los de Gesta.
// Los suma lib/coleccion.js utilityBonuses.
async function bonos(playerId) {
  const out = { gold: 0, xp: 0, drop: 0, regen: 0, mana: 0, guard: 0, card: 0, hp: 0 };
  try {
    await ensureTables();
    const code = (await db.query('SELECT titulo_logro FROM players WHERE id = $1', [playerId])).rows[0]?.titulo_logro;
    const b = code && BY_CODE.get(code)?.bono;
    if (b && (!b.dir || positionOf(Number(playerId))?.zone === b.dir)) {
      for (const k of Object.keys(out)) out[k] += Number(b[k] ?? 0);
    }
    const g = gesta(await puntosDe(playerId)).total;
    out.xp += g.xp; out.gold += g.gold; out.hp += g.hp;
  } catch { /* sin bonos */ }
  return out;
}

// ---------------------------------------------------------------- al terminar un combate
// Anota lo que solo el combate sabe (si peleaste solo, si fue un jefe, si quedaste al filo) y revisa
// los logros de cada héroe. Devuelve los nuevos de cada uno (playerId → lista).
async function despuesDelCombate({ status, participants, heroPs, isBoss }) {
  const { incrementCounter } = require('./counters');
  const out = new Map();
  const heroes = heroPs ?? [];
  if (status === 'PLAYER_WON' && heroes.length) {
    // solo: un solo héroe en el lado de los jugadores (sin compañeros ni aliados; las invocaciones no cuentan)
    const solo = participants.player.filter((p) => !p.is_summon).length === 1;
    const codes = participants.enemy.map((e) => e.monster_code).filter(Boolean);
    const rar = codes.length ? (await db.query('SELECT code, rarity, zone_id FROM monsters WHERE code = ANY($1::text[])', [codes])).rows : [];
    const jefeZona = rar.some((m) => m.rarity === 'LEGENDARY' && m.zone_id >= 1 && m.zone_id <= 7);
    const jefeMazmorra = codes.some((c) => isBoss?.(c));
    const esJefe = jefeZona || jefeMazmorra || rar.some((m) => m.rarity === 'LEGENDARY' || m.rarity === 'MINIBOSS');
    for (const hp of heroes) {
      if (solo) {
        await incrementCounter(hp.player_id, 'COMBATES_SOLO');
        if (jefeZona) await incrementCounter(hp.player_id, 'JEFES_SOLO');
        if (jefeMazmorra) await incrementCounter(hp.player_id, 'MAZMORRAS_SOLO');
      }
      if (esJefe && hp.max_hp > 0 && hp.hp > 0 && hp.hp / hp.max_hp < 0.05) await incrementCounter(hp.player_id, 'AL_FILO');
    }
  }
  for (const hp of heroes) out.set(hp.player_id, await revisarSeguro(hp.player_id));
  return out;
}

module.exports = {
  LOGROS, GRUPOS, HITOS, BY_CODE, bonoTexto, ensureTables, revisar, revisarSeguro, estado, equiparTitulo, tituloVisible, bonos, despuesDelCombate,
};
