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
      { item: 'POLVO_PIEDRA', chance: 0.4, min: 1, max: 2 },
      { item: 'PIEDRA_ENCANT_MENOR', chance: 0.1, min: 1, max: 1 },
    ],
    fallback: { item: 'POLVO_PIEDRA', min: 1, max: 1 },
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
};

// Recursos por zona: id → [tipo, cantidad de sitios posibles]. Tiene que coincidir con lo que
// genera art/mapas/generar_pradera.js del front (ver art/mapas/recursos_pradera.json).
const NODES = {
  1: {
    hierba_camino: ['hierba', 3], hierba_campos: ['hierba', 3], hierba_lago: ['hierba', 3], hierba_sur: ['hierba', 3],
    hierba_este: ['hierba', 3], hierba_robleviejo: ['hierba', 3],
    flor_lago: ['flor_luz', 2], flor_piedras: ['flor_luz', 2],
    setas_robleviejo: ['setas', 3], setas_manada: ['setas', 3],
    tronco_robleviejo: ['tronco', 3], tronco_bosque_sur: ['tronco', 3],
    nido_robleviejo: ['nido', 2], nido_lago: ['nido', 2],
    mineral_molino: ['mineral', 3], mineral_este: ['mineral', 3], mineral_loma: ['mineral', 3], mineral_heridas: ['mineral', 3],
    restos_ruinas: ['restos', 3], restos_heridas: ['restos', 3],
    cofre_bosque: ['cofre', 2], cofre_lago: ['cofre', 2], cofre_heridas: ['cofre', 2],
  },
};

function findNode(nodeId) {
  for (const [zoneId, nodes] of Object.entries(NODES)) {
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

module.exports = { NODES, NODE_TYPES, findNode, rollLoot, spotFor };
