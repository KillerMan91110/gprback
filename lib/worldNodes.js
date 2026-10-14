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
      { item: 'POLVO_PIEDRA', chance: 0.3, min: 1, max: 1 },
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
