// Lo que la colección del cazador y el jefe mítico agregan al ganar un combate (lo llama
// routes/combat.js -> finalizeSession). Vive aparte para que finalizeSession no siga creciendo:
//   antes de repartir: fichas del bestiario, cuenta de la zona para el jefe mítico, esbirros
//                      cazados y los bonos de utilidad de cada héroe (amuletos + cartas)
//   después de repartir: la tirada de cartas de cada héroe y el resumen para la pantalla final
const coleccion = require('./coleccion');
const mythic = require('./mythic');
const aurelia = require('./aurelia');

async function beforeRewards(heroPs, enemies) {
  const ids = heroPs.map((hp) => hp.player_id);
  const bestiaryEvents = await coleccion.registerKills(ids, enemies);
  await mythic.registerZoneKills(enemies);
  await mythic.registerMinionKills(ids, enemies);
  const utilBy = new Map(await Promise.all(heroPs.map(async (hp) => [hp.player_id, await coleccion.utilityBonuses(hp.player_id)])));
  return { bestiaryEvents, utilBy };
}

async function afterRewards({ heroPs, heroP, enemies, utilBy, bestiaryEvents, rewards }) {
  for (const hp of heroPs) {
    const cards = await coleccion.rollCards(hp.player_id, enemies, utilBy.get(hp.player_id)?.card || 0);
    if (hp === heroP) rewards.cardsDropped = cards;
    for (const c of cards) {
      if (['MINIBOSS', 'LEGENDARY'].includes(c.rarity)) aurelia.addNews(`¡${hp.name} encontró la rarísima Carta de ${c.name}!`);
    }
  }
  rewards.bestiary = bestiaryEvents.get(heroP.player_id) ?? [];
}

module.exports = { beforeRewards, afterRewards };
