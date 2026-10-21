// Precios en oro de mejorar el equipo, medidos en HORAS DE CAZA del nivel de la pieza: así cuestan lo mismo
// en esfuerzo a nivel 10 que a nivel 100, y el oro se siente útil toda la aventura.
// El oro por hora se midió con los combates reales (gpr/_respaldo_claude/economia/oro_por_zona.js: un combate
// dura ~2 min, 1,6 monstruos, unos 25 por hora, más el botín vendido): ~6.300 a nivel 1 y ~39.000 a nivel 100.
// Todos los números para ajustar están aquí.

// oro que junta un jugador en una hora de caza a ese nivel
const oroHora = (nivel) => 6000 + 330 * Math.max(1, Math.min(100, Number(nivel) || 1));
// redondeo a números «de tienda»
const redondo = (n) => (n < 1000 ? Math.max(10, Math.round(n / 10) * 10) : Math.round(n / 50) * 50);
const horas = (h, nivel) => redondo(oroHora(nivel) * h);

// Encantar: horas para pasar de +n a +n+1 (el índice es el nivel actual). Las piedras y la probabilidad no cambian.
const ENCANTAR_HORAS = [0.03, 0.06, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2.5];
const encantarOro = (nivelPieza, encanteActual) => horas(ENCANTAR_HORAS[encanteActual] ?? 0, nivelPieza);

// Reforjar la calidad (en la forja): sube un escalón (Común → Poco común… hasta +4). Si falla, el oro se pierde
// pero la pieza queda igual.
const REFORJA = [
  { horas: 0.5, prob: 80 }, // calidad 0 → 1
  { horas: 1, prob: 65 }, // 1 → 2
  { horas: 2, prob: 50 }, // 2 → 3
  { horas: 4, prob: 35 }, // 3 → 4
];
const CALIDAD_MAX = REFORJA.length;
const reforjaCosto = (nivelPieza, calidadActual) => {
  const r = REFORJA[calidadActual];
  return r ? { oro: horas(r.horas, nivelPieza), prob: r.prob } : null;
};

// Fabricar equipo: lo que cobra el artesano por su trabajo, según la rareza (por cada intento)
const FABRICAR_HORAS = { COMUN: 0.01, POCO_COMUN: 0.02, RARO: 0.05, EPICO: 0.12, LEGENDARIO: 0.25, UNICO: 0.25 };
const fabricarOro = (nivelPieza, rareza) => horas(FABRICAR_HORAS[rareza] ?? 0.01, nivelPieza);

module.exports = { oroHora, ENCANTAR_HORAS, encantarOro, REFORJA, CALIDAD_MAX, reforjaCosto, FABRICAR_HORAS, fabricarOro };
