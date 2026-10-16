// Todas las mazmorras del mundo 2D (molde de lib/mazmorra.js). El combate y la presencia las recorren
// para sus ganchos (jefe, escudo, final del combate, salida de la zona).
const cripta = require('./cripta');
const mina = require('./mina');
const fisura = require('./fisura');
const { weakElementOf, ELEMENT_CODE } = require('./mazmorra');

const ALL = [cripta, mina, fisura];
const byDir = Object.fromEntries(ALL.map((m) => [m.ZONE_DIR, m]));

// multiplicador de recompensa de un héroe en un combate de mazmorra (null si no es de ninguna)
async function rewardMult(sessionId, playerId) {
  for (const m of ALL) {
    const r = await m.rewardMult(sessionId, playerId);
    if (r != null) return r;
  }
  return null;
}

module.exports = {
  ALL,
  byDir,
  rewardMult,
  ELEMENT_CODE,
  weakElementOf,
  isMonster: (code) => ALL.some((m) => m.isMonster(code)),
  ofMonster: (code) => ALL.find((m) => m.isMonster(code)) ?? null,
  isBoss: (code) => ALL.some((m) => m.BOSS_CODE === code),
  async onBreakEnd(...args) { for (const m of ALL) await m.onBreakEnd(...args); },
  async bossTurn(ctx) {
    for (const m of ALL) if (await m.bossTurn(ctx)) return true;
    return false;
  },
  async handleFinalize(...args) {
    for (const m of ALL) {
      const r = await m.handleFinalize(...args);
      if (r) return r;
    }
    return null;
  },
};
