// Evento del Día: bono de oro/xp para niveles bajos. El oro/xp que da hydrateMonsters escala con
// el nivel de quien entra, asi que a nivel 1-10 el numero real termina siendo muy chico comparado
// con niveles altos. En vez de un corte duro en algun nivel arbitrario (que crea un salto grande
// de un nivel al siguiente, ej. nivel 4 gana mucho mas que nivel 5), el bono arranca completo en
// nivel 1 y baja lineal hasta 0 en LOW_LEVEL_BONUS_MAX_LEVEL, asi se autoresuelve solo a medida
// que el jugador sube en vez de desaparecer de golpe.
const LOW_LEVEL_BONUS_MAX_LEVEL = 15;
const LOW_LEVEL_BONUS_GOLD = 1000;
const LOW_LEVEL_BONUS_XP = 150;

function lowLevelBonus(level) {
  const ratio = Math.max(0, (LOW_LEVEL_BONUS_MAX_LEVEL - level) / (LOW_LEVEL_BONUS_MAX_LEVEL - 1));
  return {
    gold: Math.round(LOW_LEVEL_BONUS_GOLD * ratio),
    xp: Math.round(LOW_LEVEL_BONUS_XP * ratio),
  };
}

module.exports = { lowLevelBonus, LOW_LEVEL_BONUS_MAX_LEVEL, LOW_LEVEL_BONUS_GOLD, LOW_LEVEL_BONUS_XP };
