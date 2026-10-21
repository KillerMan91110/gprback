# Economía: cuánto oro se gana y en qué se gasta

## Cuánto oro junta un jugador

Medido con los combates reales (`gpr/_respaldo_claude/economia/oro_por_zona.js`):
- un combate dura ~2 minutos y trae 1,6 monstruos;
- son unos **25 combates por hora**, contando lo que se camina;
- el botín se vende al artesano.

| Zona | Niveles | Oro por monstruo | Botín por monstruo | **Oro por hora de caza** | Misiones (una vez) | Diarias |
|---|---|---|---|---|---|---|
| Pradera | 1-15 | 140 | 33 | **~6.900** | 28.240 | 15.800 |
| Montañas | 16-30 | 244 | 38 | **~11.300** | 37.630 | 7.460 |
| Volcán | 31-45 | 381 | 51 | **~17.300** | 80.780 | 10.830 |
| Costas | 46-60 | 509 | 77 | **~23.400** | 108.250 | 14.320 |
| Tundra | 61-75 | 639 | 108 | **~29.900** | 162.600 | 24.800 |
| Catacumbas | 76-85 | 754 | 130 | **~35.400** | 201.500 | 27.700 |
| Ruinas | 86-100 | 852 | 109 | **~38.500** | 282.900 | 31.650 |

Antes de esto, casi todo lo que costaba oro tenía un precio fijo, sin importar el nivel. Un +1 del encantador
costaba 200, a nivel 5 y a nivel 95 por igual: a nivel 95 eso son 20 segundos de caza. Por eso el oro se
juntaba sin uso (Marco tenía 67.000 a nivel 75).

## Los precios (`gprback/lib/precios.js`)

Todo se mide en **horas de caza del nivel de la pieza**. Una hora de caza vale `6000 + 330 × nivel` de oro
(~6.300 a nivel 1 y ~39.000 a nivel 100), así que mejorar el equipo cuesta el mismo esfuerzo a nivel 10 que a
nivel 100.

| Qué | Costo | A nivel 100 |
|---|---|---|
| Encantar (de +n a +n+1) | 0,03 · 0,06 · 0,1 · 0,2 · 0,35 · 0,5 · 0,75 · 1 · 1,5 · 2,5 h | +1 ≈ 1.150 · +5 ≈ 13.600 · +10 ≈ 97.500 |
| **Reforjar calidad** (nuevo, en el Encantador) | 0,5 · 1 · 2 · 4 h, con éxito 80 · 65 · 50 · 35 %. Si falla, el oro se pierde y la pieza queda igual | 19.500 · 39.000 · 78.000 · 156.000 |
| Fabricar equipo (el trabajo del artesano, por intento) | Común 0,01 · Poco común 0,02 · Raro 0,05 · Épico 0,12 · Legendario 0,25 h | raro ≈ 1.950 · legendario ≈ 9.750 |

- La calidad multiplica todas las estadísticas de la pieza: ×1, ×1,15, ×1,35, ×1,6 y ×2.
- Dejar una pieza en +10 con la calidad al máximo cuesta unas 14 horas de caza en su zona, sin contar los
  fallos.
- Las piedras y la probabilidad del encantador no cambiaron.
- A nivel bajo el encantador quedó más barato que antes: a nivel 10, el +10 cuesta 23.000 en vez de 80.000.

La mochila no tiene límite y se queda así: cobrar por ampliarla sería un castigo artificial.

## Lo que sigue gastando oro igual que antes

- Curarse en el gremio.
- Las tiendas: artesanos, mercaderes y maestros.
- Aprender habilidades.
- Los viajes: barca, botes, balsas, trineos, vagonetas y el viaje del Pilar.
- La ofrenda del Pilar.
- Crear un gremio (50.000).
- El mercado entre jugadores.

Si la economía se sigue inflando, el próximo paso es revisar estos precios con la misma medida de horas de
caza.
