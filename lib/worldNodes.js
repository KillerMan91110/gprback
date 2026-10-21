// Recursos que se recolectan caminando por el mundo 2D (hierbas, setas, troncos, nidos, vetas,
// restos de aventureros y cofres). El mapa del front (puntos "recurso" de cada trozo) dice DÓNDE
// puede aparecer cada uno; qué da, cada cuánto reaparece y en cuál de sus sitios aparece lo decide
// el servidor, para que el cliente no pueda inventarse botín. Cada jugador tiene su propio
// cooldown y su propio sitio por recurso (tabla world_node_gathers): lo que recoge uno no se lo
// quita a otro.

const NODE_TYPES = {
  hierba: {
    respawnSeconds: 180,
    loot: [
      { item: 'HIERBA_MAGICA', chance: 0.7, min: 1, max: 2 },
      { item: 'HIERBA_CURATIVA', chance: 0.35, min: 1, max: 1 },
      { item: 'FLOR_LUMINOSA', chance: 0.06, min: 1, max: 1 },
    ],
    fallback: { item: 'HIERBA_MAGICA', min: 1, max: 1 },
  },
  setas: {
    respawnSeconds: 240,
    loot: [
      { item: 'HIERBA_CURATIVA', chance: 0.8, min: 1, max: 2 },
      { item: 'POLVO_ARCANO', chance: 0.15, min: 1, max: 1 },
    ],
    fallback: { item: 'HIERBA_CURATIVA', min: 1, max: 1 },
  },
  flor_luz: {
    respawnSeconds: 600,
    loot: [
      { item: 'FLOR_LUMINOSA', chance: 1, min: 1, max: 2 },
      { item: 'POLVO_ARCANO', chance: 0.25, min: 1, max: 1 },
    ],
  },
  tronco: {
    respawnSeconds: 300,
    loot: [
      { item: 'MADERA_DE_ROBLE', chance: 1, min: 1, max: 3 },
      { item: 'MIEL_ABEJA_ANTIGUA', chance: 0.08, min: 1, max: 1 },
      // el símbolo del Elfo Silvestre (docs/evoluciones_pruebas.md): una rama viva del roble viejo
      { item: 'RAMA_ROBLEVIEJO', chance: 0.04, min: 1, max: 1 },
    ],
  },
  nido: {
    respawnSeconds: 900,
    loot: [
      { item: 'PLUMA', chance: 0.9, min: 1, max: 3 },
      { item: 'HUEVO_COMUN', chance: 0.12, min: 1, max: 1 },
      { item: 'HUEVO_POCO_COMUN', chance: 0.03, min: 1, max: 1 },
    ],
    fallback: { item: 'PLUMA', min: 1, max: 1 },
  },
  mineral: {
    respawnSeconds: 300,
    loot: [
      { item: 'MINERAL_DE_HIERRO', chance: 0.75, min: 1, max: 2 },
      { item: 'POLVO_DE_PIEDRA', chance: 0.4, min: 1, max: 2 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'POLVO_DE_PIEDRA', min: 1, max: 1 },
  },
  // recolección v4: lino (tela de lino), cuarzo de río (se pule en Gema Común) y trigo (pan)
  lino: {
    respawnSeconds: 240,
    loot: [
      { item: 'FIBRA_LINO', chance: 1, min: 1, max: 3 },
      { item: 'HIERBA_CURATIVA', chance: 0.1, min: 1, max: 1 },
    ],
  },
  cuarzo: {
    respawnSeconds: 420,
    loot: [
      { item: 'CUARZO_RIO', chance: 1, min: 1, max: 2 },
      { item: 'POLVO_DE_PIEDRA', chance: 0.3, min: 1, max: 1 },
      { item: 'AGUA_FRESCA', chance: 0.15, min: 1, max: 1 },
    ],
  },
  trigo: {
    respawnSeconds: 240,
    loot: [
      { item: 'TRIGO', chance: 1, min: 2, max: 3 },
    ],
  },
  restos: {
    respawnSeconds: 1200,
    gold: { min: 30, max: 90 },
    loot: [
      { item: 'POCION_DE_VIDA_MENOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.15, min: 1, max: 1 },
      { item: 'LINGOTE_BRONCE', chance: 0.25, min: 1, max: 1 },
    ],
  },
  cofre: {
    respawnSeconds: 1800,
    gold: { min: 80, max: 200 },
    loot: [
      { item: 'POCION_DE_VIDA_MENOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MENOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.3, min: 1, max: 1 },
      { item: 'HUEVO_COMUN', chance: 0.05, min: 1, max: 1 },
    ],
  },
  // Montañas Grises (zona 2): lo que pide el crafteo de la zona y botín a su nivel
  veta_montana: {
    respawnSeconds: 300,
    loot: [
      { item: 'MINERAL_DE_ACERO', chance: 0.75, min: 1, max: 2 },
      { item: 'CARBON', chance: 0.55, min: 1, max: 2 },
      { item: 'MINERAL_DE_HIERRO', chance: 0.25, min: 1, max: 2 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'CARBON', min: 1, max: 1 },
  },
  pino: {
    respawnSeconds: 300,
    loot: [
      { item: 'MADERA_PINO', chance: 1, min: 1, max: 3 },
      { item: 'PLUMA', chance: 0.1, min: 1, max: 1 },
    ],
  },
  flor_nieve: {
    respawnSeconds: 240,
    loot: [
      { item: 'FLOR_DE_NIEVE', chance: 0.85, min: 1, max: 2 },
      { item: 'HIERBA_CURATIVA', chance: 0.3, min: 1, max: 1 },
      { item: 'HIERBA_MAGICA', chance: 0.2, min: 1, max: 1 },
    ],
    fallback: { item: 'FLOR_DE_NIEVE', min: 1, max: 1 },
  },
  cristal_lago: {
    respawnSeconds: 420,
    loot: [
      { item: 'CUARZO_RIO', chance: 0.8, min: 1, max: 2 },
      { item: 'GEMA_COMUN', chance: 0.2, min: 1, max: 1 },
      { item: 'AGUA_FRESCA', chance: 0.3, min: 1, max: 1 },
    ],
    fallback: { item: 'CUARZO_RIO', min: 1, max: 1 },
  },
  restos_montana: {
    respawnSeconds: 1200,
    gold: { min: 90, max: 220 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.4, min: 1, max: 1 },
      { item: 'ACERO_REFINADO', chance: 0.3, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.1, min: 1, max: 1 },
    ],
  },
  cofre_montana: {
    respawnSeconds: 1800,
    gold: { min: 220, max: 480 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.3, min: 1, max: 1 },
      { item: 'CRISTAL_GIGANTE_HIELO', chance: 0.08, min: 1, max: 1 },
      { item: 'HUEVO_POCO_COMUN', chance: 0.05, min: 1, max: 1 },
    ],
  },
  // Volcán Rojo (zona 3): lo que pide el crafteo de la zona y botín a su nivel
  veta_obsidiana: {
    respawnSeconds: 300,
    loot: [
      { item: 'OBSIDIANA_BRUTA', chance: 0.8, min: 1, max: 2 },
      { item: 'CARBON', chance: 0.35, min: 1, max: 2 },
      { item: 'MINERAL_DE_ACERO', chance: 0.25, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'OBSIDIANA_BRUTA', min: 1, max: 1 },
  },
  fumarola: {
    respawnSeconds: 240,
    loot: [
      { item: 'AZUFRE', chance: 0.9, min: 1, max: 3 },
      { item: 'POLVO_DE_PIEDRA', chance: 0.25, min: 1, max: 1 },
    ],
    fallback: { item: 'AZUFRE', min: 1, max: 1 },
  },
  flor_ceniza: {
    respawnSeconds: 240,
    loot: [
      { item: 'FLOR_DE_CENIZA', chance: 0.85, min: 1, max: 2 },
      { item: 'HIERBA_CURATIVA', chance: 0.25, min: 1, max: 1 },
      { item: 'HIERBA_MAGICA', chance: 0.2, min: 1, max: 1 },
    ],
    fallback: { item: 'FLOR_DE_CENIZA', min: 1, max: 1 },
  },
  // los nidos de las salamandras: piedra pómez del anillo y, a veces, un huevo para el incubador
  nido_salamandra: {
    respawnSeconds: 420,
    loot: [
      { item: 'PIEDRA_POMEZ', chance: 0.9, min: 1, max: 2 },
      { item: 'ESCAMA_DE_FUEGO', chance: 0.35, min: 1, max: 1 },
      { item: 'HUEVO_POCO_COMUN', chance: 0.06, min: 1, max: 1 },
    ],
    fallback: { item: 'PIEDRA_POMEZ', min: 1, max: 1 },
  },
  // geodas: pocas y lentas; la Gema de Fuego y el Corazón de Brasa salen muy de vez en cuando
  geoda_ardiente: {
    respawnSeconds: 900,
    loot: [
      { item: 'OBSIDIANA_BRUTA', chance: 0.6, min: 1, max: 2 },
      { item: 'GEMA_DE_FUEGO', chance: 0.12, min: 1, max: 1 },
      { item: 'CORAZON_DE_BRASA', chance: 0.1, min: 1, max: 1 },
      { item: 'GEMA_COMUN', chance: 0.3, min: 1, max: 1 },
    ],
    fallback: { item: 'OBSIDIANA_BRUTA', min: 1, max: 1 },
  },
  restos_volcan: {
    respawnSeconds: 1200,
    gold: { min: 160, max: 340 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'ACERO_REFINADO', chance: 0.3, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.12, min: 1, max: 1 },
    ],
  },
  cofre_volcan: {
    respawnSeconds: 1800,
    gold: { min: 380, max: 760 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.35, min: 1, max: 1 },
      { item: 'CORAZON_DE_BRASA', chance: 0.1, min: 1, max: 1 },
      { item: 'HUEVO_RARO', chance: 0.04, min: 1, max: 1 },
    ],
  },
  // Costas Muertas (zona 4): el coral es el metal de la costa; las algas, la planta; las ostras, la carne
  veta_coral: {
    respawnSeconds: 300,
    loot: [
      { item: 'CORAL_ROJO', chance: 0.8, min: 1, max: 2 },
      { item: 'MINERAL_DE_ACERO', chance: 0.25, min: 1, max: 1 },
      { item: 'GEMA_COMUN', chance: 0.12, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'CORAL_ROJO', min: 1, max: 1 },
  },
  alga_salina: {
    respawnSeconds: 240,
    loot: [
      { item: 'ALGA_SALINA', chance: 0.85, min: 1, max: 2 },
      { item: 'HIERBA_CURATIVA', chance: 0.2, min: 1, max: 1 },
      { item: 'SAL_DE_CRISTAL', chance: 0.15, min: 1, max: 1 },
    ],
    fallback: { item: 'ALGA_SALINA', min: 1, max: 1 },
  },
  ostras: {
    respawnSeconds: 360,
    loot: [
      { item: 'CARNE_OSTRA', chance: 0.9, min: 1, max: 2 },
      { item: 'SAL_DE_CRISTAL', chance: 0.2, min: 1, max: 1 },
      { item: 'PERLA_MARINA', chance: 0.04, min: 1, max: 1 },
    ],
    fallback: { item: 'CARNE_OSTRA', min: 1, max: 1 },
  },
  // los restos de los barcos: madera que no se pudre y cabos con brea (arcos, carcajes y escudos)
  restos_naufragio: {
    respawnSeconds: 420,
    gold: { min: 60, max: 160 },
    loot: [
      { item: 'MADERA_NAUFRAGIO', chance: 0.8, min: 1, max: 2 },
      { item: 'CUERDA_ALQUITRAN', chance: 0.5, min: 1, max: 1 },
      { item: 'ACERO_REFINADO', chance: 0.15, min: 1, max: 1 },
    ],
    fallback: { item: 'MADERA_NAUFRAGIO', min: 1, max: 1 },
  },
  // las pozas de los islotes de las Rocas (con la marea baja): estrellas de mar y sal
  poza_marea: {
    respawnSeconds: 360,
    loot: [
      { item: 'SAL_DE_CRISTAL', chance: 0.75, min: 1, max: 2 },
      { item: 'ESTRELLA_DE_MAR', chance: 0.6, min: 1, max: 1 },
      { item: 'CARNE_OSTRA', chance: 0.25, min: 1, max: 1 },
      { item: 'HUEVO_POCO_COMUN', chance: 0.04, min: 1, max: 1 },
    ],
    fallback: { item: 'SAL_DE_CRISTAL', min: 1, max: 1 },
  },
  // conchas gigantes: pocas y lentas; la Perla Marina es la otra llave del set de Coral
  concha_gigante: {
    respawnSeconds: 900,
    loot: [
      { item: 'CARNE_OSTRA', chance: 0.6, min: 1, max: 3 },
      { item: 'PERLA_MARINA', chance: 0.3, min: 1, max: 1 },
      { item: 'GEMA_COMUN', chance: 0.25, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.05, min: 1, max: 1 },
    ],
    fallback: { item: 'CARNE_OSTRA', min: 1, max: 1 },
  },
  cofre_costas: {
    respawnSeconds: 1800,
    gold: { min: 600, max: 1100 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.35, min: 1, max: 1 },
      { item: 'PERLA_MARINA', chance: 0.1, min: 1, max: 1 },
      { item: 'HUEVO_RARO', chance: 0.04, min: 1, max: 1 },
    ],
  },
  // Tundra Eterna (zona 5): el hielo eterno es el metal; la flor de escarcha, la planta; el pescado
  // glacial, la carne; el pino blanco, la madera; los menhires sueltan runas
  veta_hielo: {
    respawnSeconds: 300,
    loot: [
      { item: 'HIELO_ETERNO', chance: 0.8, min: 1, max: 2 },
      { item: 'MINERAL_DE_ACERO', chance: 0.2, min: 1, max: 1 },
      { item: 'GEMA_HELADA', chance: 0.08, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'HIELO_ETERNO', min: 1, max: 1 },
  },
  flor_escarcha: {
    respawnSeconds: 240,
    loot: [
      { item: 'FLOR_ESCARCHA', chance: 0.85, min: 1, max: 2 },
      { item: 'HIERBA_CURATIVA', chance: 0.2, min: 1, max: 1 },
      { item: 'HIERBA_MAGICA', chance: 0.15, min: 1, max: 1 },
    ],
    fallback: { item: 'FLOR_ESCARCHA', min: 1, max: 1 },
  },
  // pinos blancos: la madera de los arcos; a veces cae una pluma de un búho que dormía arriba
  pino_blanco: {
    respawnSeconds: 300,
    loot: [
      { item: 'MADERA_PINO_BLANCO', chance: 0.85, min: 1, max: 2 },
      { item: 'PLUMA_NIVEA', chance: 0.15, min: 1, max: 1 },
    ],
    fallback: { item: 'MADERA_PINO_BLANCO', min: 1, max: 1 },
  },
  // los agujeros en el hielo del Lago de Cristal
  agujero_pesca: {
    respawnSeconds: 300,
    loot: [
      { item: 'PESCADO_GLACIAL', chance: 0.9, min: 1, max: 2 },
      { item: 'GEMA_HELADA', chance: 0.05, min: 1, max: 1 },
      { item: 'HUEVO_POCO_COMUN', chance: 0.03, min: 1, max: 1 },
    ],
    fallback: { item: 'PESCADO_GLACIAL', min: 1, max: 1 },
  },
  menhir_runas: {
    respawnSeconds: 420,
    loot: [
      { item: 'RUNA_NORTENA', chance: 0.8, min: 1, max: 2 },
      { item: 'POLVO_ARCANO', chance: 0.2, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.08, min: 1, max: 1 },
    ],
    fallback: { item: 'RUNA_NORTENA', min: 1, max: 1 },
  },
  // los trineos abandonados de los cazadores y los viajeros: madera, grasa y algo de oro
  restos_trineo: {
    respawnSeconds: 420,
    gold: { min: 80, max: 200 },
    loot: [
      { item: 'MADERA_PINO_BLANCO', chance: 0.6, min: 1, max: 2 },
      { item: 'GRASA_FOCA', chance: 0.4, min: 1, max: 1 },
      { item: 'HIELO_ETERNO', chance: 0.2, min: 1, max: 1 },
      { item: 'ACERO_REFINADO', chance: 0.15, min: 1, max: 1 },
      { item: 'COLMILLO_MAMUT', chance: 0.05, min: 1, max: 1 },
    ],
    fallback: { item: 'MADERA_PINO_BLANCO', min: 1, max: 1 },
  },
  cofre_tundra: {
    respawnSeconds: 1800,
    gold: { min: 800, max: 1400 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.35, min: 1, max: 1 },
      { item: 'COLMILLO_MAMUT', chance: 0.1, min: 1, max: 1 },
      { item: 'PELAJE_AURORA', chance: 0.1, min: 1, max: 1 },
      { item: 'HUEVO_RARO', chance: 0.04, min: 1, max: 1 },
    ],
  },
  // Catacumbas del Abismo (zona 6): las pilas del Osario y los Nichos, a veces con algo del muerto
  pila_huesos: {
    respawnSeconds: 300,
    loot: [
      { item: 'HUESO_ANTIGUO', chance: 0.85, min: 1, max: 2 },
      { item: 'ESPADA_ROTA_ESQUELETO', chance: 0.12, min: 1, max: 1 },
      { item: 'ORO_ANTIGUO', chance: 0.08, min: 1, max: 1 },
    ],
    fallback: { item: 'HUESO_ANTIGUO', min: 1, max: 1 },
  },
  setas_palidas: {
    respawnSeconds: 240,
    loot: [
      { item: 'SETA_PALIDA', chance: 0.85, min: 1, max: 2 },
      { item: 'ESPORAS_PALIDAS', chance: 0.15, min: 1, max: 1 },
      { item: 'HIERBA_MAGICA', chance: 0.15, min: 1, max: 1 },
    ],
    fallback: { item: 'SETA_PALIDA', min: 1, max: 1 },
  },
  // la plata sepulcral: el metal de las Catacumbas (el Abismo y la Biblioteca)
  veta_plata: {
    respawnSeconds: 300,
    loot: [
      { item: 'PLATA_SEPULCRAL', chance: 0.8, min: 1, max: 2 },
      { item: 'MINERAL_DE_ACERO', chance: 0.2, min: 1, max: 1 },
      { item: 'GEMA_COMUN', chance: 0.08, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'PLATA_SEPULCRAL', min: 1, max: 1 },
  },
  // los candelabros que nadie vino a encender: cera eterna y, a veces, cera de sellado
  candelabro_olvidado: {
    respawnSeconds: 240,
    loot: [
      { item: 'CERA_ETERNA', chance: 0.85, min: 1, max: 2 },
      { item: 'CERA_SELLADO', chance: 0.1, min: 1, max: 1 },
      { item: 'ORO_ANTIGUO', chance: 0.05, min: 1, max: 1 },
    ],
    fallback: { item: 'CERA_ETERNA', min: 1, max: 1 },
  },
  // el agua azul del Río de las Almas, en los pozos de su orilla
  pozo_almas: {
    respawnSeconds: 420,
    loot: [
      { item: 'ESENCIA_DE_ALMA', chance: 0.8, min: 1, max: 2 },
      { item: 'LAMENTO_CRISTALIZADO', chance: 0.15, min: 1, max: 1 },
      { item: 'ALMA_REDIMIDA', chance: 0.05, min: 1, max: 1 },
    ],
    fallback: { item: 'ESENCIA_DE_ALMA', min: 1, max: 1 },
  },
  // el cofre de las Catacumbas: un sarcófago que alguien dejó a medio abrir
  sarcofago_tesoro: {
    respawnSeconds: 1800,
    gold: { min: 900, max: 1600 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.35, min: 1, max: 1 },
      { item: 'ORO_ANTIGUO', chance: 0.3, min: 1, max: 2 },
      { item: 'DIENTE_GUSANO', chance: 0.1, min: 1, max: 1 },
      { item: 'YELMO_VACIO', chance: 0.1, min: 1, max: 1 },
      { item: 'HUEVO_RARO', chance: 0.04, min: 1, max: 1 },
    ],
  },
  // Ruinas Ancestrales (zona 7): los bloques que quedaron a medio sacar en la Cantera y el Patio
  bloque_marmol: {
    respawnSeconds: 300,
    loot: [
      { item: 'MARMOL_SAGRADO', chance: 0.85, min: 1, max: 2 },
      { item: 'POLVO_MARMOL', chance: 0.2, min: 1, max: 1 },
      { item: 'PIEDRA_RUNICA', chance: 0.08, min: 1, max: 1 },
    ],
    fallback: { item: 'MARMOL_SAGRADO', min: 1, max: 1 },
  },
  // el oro primordial: el metal de las Ruinas (la Cantera y las Torres)
  veta_oro_primordial: {
    respawnSeconds: 360,
    loot: [
      { item: 'ORO_PRIMORDIAL', chance: 0.75, min: 1, max: 1 },
      { item: 'MINERAL_EPICO', chance: 0.12, min: 1, max: 1 },
      { item: 'HIERRO_PRIMORDIAL', chance: 0.04, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'ORO_PRIMORDIAL', min: 1, max: 1 },
  },
  flores_luminosas: {
    respawnSeconds: 240,
    loot: [
      { item: 'FLOR_LUMINOSA', chance: 0.85, min: 1, max: 2 },
      { item: 'HIERBA_MAGICA', chance: 0.2, min: 1, max: 1 },
      { item: 'POLVO_ARCANO', chance: 0.05, min: 1, max: 1 },
    ],
    fallback: { item: 'FLOR_LUMINOSA', min: 1, max: 1 },
  },
  // el agua que no se evapora, en los pocitos del Lago y los Jardines
  fuente_lagrimas: {
    respawnSeconds: 360,
    loot: [
      { item: 'LAGRIMA_AETHRA', chance: 0.85, min: 1, max: 2 },
      { item: 'ESCAMA_LAGRIMA', chance: 0.12, min: 1, max: 1 },
      { item: 'ESENCIA_ANCESTRAL_AGUA', chance: 0.04, min: 1, max: 1 },
    ],
    fallback: { item: 'LAGRIMA_AETHRA', min: 1, max: 1 },
  },
  // donde cayó una estrella: queda el polvo plateado (las Torres y la Grieta)
  crater_estrella: {
    respawnSeconds: 480,
    loot: [
      { item: 'POLVO_DE_ESTRELLAS', chance: 0.7, min: 1, max: 1 },
      { item: 'POLVO_ARCANO', chance: 0.25, min: 1, max: 1 },
      { item: 'FRAGMENTO_ECLIPSE', chance: 0.05, min: 1, max: 1 },
    ],
    fallback: { item: 'POLVO_DE_ESTRELLAS', min: 1, max: 1 },
  },
  // el cofre de las Ruinas: un relicario aethrino escondido
  relicario_templo: {
    respawnSeconds: 1800,
    gold: { min: 1000, max: 1800 },
    loot: [
      { item: 'POCION_DE_VIDA_MAYOR', chance: 0.8, min: 1, max: 2 },
      { item: 'POCION_DE_MANA_MAYOR', chance: 0.5, min: 1, max: 1 },
      { item: 'PIEDRA_ENCANT_MAYOR', chance: 0.4, min: 1, max: 1 },
      { item: 'ORO_PRIMORDIAL', chance: 0.3, min: 1, max: 2 },
      { item: 'FRAGMENTO_DE_LUZ', chance: 0.06, min: 1, max: 1 },
      { item: 'CORAZON_MARMOL', chance: 0.06, min: 1, max: 1 },
      { item: 'HUEVO_RARO', chance: 0.05, min: 1, max: 1 },
    ],
  },
};

// Recursos por zona: { zona: { id: { tipo, sitios } } }. Lo escribe el editor de mapas del front
// (página /editor) al guardar una zona, a partir de los puntos "recurso" del mapa: el id y la
// cantidad de sitios tienen que coincidir con el mapa. Se relee solo cuando el archivo cambia, así
// que no hace falta reiniciar el servidor después de guardar un mapa.
const fs = require('fs');
const path = require('path');

const ZONES_FILE = path.join(__dirname, 'worldNodes.zonas.json');
let cache = { mtime: 0, nodes: {} };

function allNodes() {
  try {
    const { mtimeMs } = fs.statSync(ZONES_FILE);
    if (mtimeMs !== cache.mtime) {
      const raw = JSON.parse(fs.readFileSync(ZONES_FILE, 'utf8'));
      const nodes = {};
      for (const [zone, list] of Object.entries(raw)) {
        nodes[zone] = {};
        for (const [id, n] of Object.entries(list)) if (NODE_TYPES[n.tipo]) nodes[zone][id] = [n.tipo, n.sitios];
      }
      cache = { mtime: mtimeMs, nodes };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[worldNodes] no se pudo leer', ZONES_FILE, err.message);
  }
  return cache.nodes;
}

// id → [tipo, cantidad de sitios] de una zona
const nodesOf = (zoneId) => allNodes()[zoneId] ?? {};

function findNode(nodeId) {
  for (const [zoneId, nodes] of Object.entries(allNodes())) {
    if (nodes[nodeId]) {
      const [type, spots] = nodes[nodeId];
      return { zoneId: Number(zoneId), type, spots, def: NODE_TYPES[type] };
    }
  }
  return null;
}

// En qué sitio aparece el recurso para este jugador: cambia cada vez que se recolecta, sin
// guardar nada extra (sale de un hash del jugador, el recurso y la última recolección).
function spotFor(playerId, nodeId, spots, gatheredAt) {
  const key = `${playerId}:${nodeId}:${gatheredAt ? new Date(gatheredAt).getTime() : 0}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % Math.max(1, spots);
}

const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

function rollLoot(def) {
  const drops = [];
  for (const l of def.loot) {
    if (Math.random() < l.chance) drops.push({ item: l.item, quantity: between(l.min, l.max) });
  }
  if (!drops.length && def.fallback) drops.push({ item: def.fallback.item, quantity: between(def.fallback.min, def.fallback.max) });
  const gold = def.gold ? between(def.gold.min, def.gold.max) : 0;
  return { drops, gold };
}

module.exports = { nodesOf, NODE_TYPES, findNode, rollLoot, spotFor };
