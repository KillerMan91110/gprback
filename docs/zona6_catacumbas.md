# Zona 6 · Catacumbas del Abismo (76-85) — «El primer traidor»

Diseño y estado de la zona, como `zona5_tundra.md`. Sale de `historia_etheria.md` (zona 6) y
`mapa_etheria.md`. **La zona está completa** (6 tandas, subidas en `gpr` 71bd3fd y `gprback` ccca5ba).
Las secciones 1 a 12 cuentan la zona tal como quedó en el juego. La 13 explica en detalle cada mecánica
nueva, la 14 dice qué archivo hace qué y la 15 es el registro de cada tanda. Si el código no coincide con
esto, manda el código.

---

## 1. La zona en una frase

Bajo Etheria hay una necrópolis enorme que construyeron los sacerdotes de Aethra hace mil años. Ahí abajo
tiene su corte el **Lich Ancestral**, que fue el **sumo sacerdote de Aethra**: traicionó a los suyos,
fundó a los Ocultos para robarle la inmortalidad al Devorador y custodia el **Sexto Sello** desde el
otro lado. Los sacerdotes que traicionó, los **Velados**, siguen ahí como espíritus y mantienen
encendida **Vela Eterna**, la única luz segura bajo tierra. Y el Encapuchado, **Velkan**, resulta ser
el hijo de Aldren.

---

## 2. Dónde va y cómo se entra

- **Bajo tierra:** es una zona propia **fuera del continente** (no va en `etheria.json`), de 4×4 trozos
  como las demás (160×120 casillas), con `interior: true` y `zona: 6`. La carpeta es
  `public/assets/mundo/catacumbas/`. La escena carga sola una zona que no está en el continente (como las
  mazmorras): al cruzar una salida se reinicia en la zona nueva.
- **Primera entrada: la escalera del fondo de la Cripta Congelada** (la tumba de la reina «baja al
  abismo»):
  - Está en (13-14, 58) de la Cripta Congelada y llega a la **Escalera Helada** (140, 5), arriba a la
    derecha del mapa.
  - Se abre cuando entregaste la T14, cualquiera de las dos (fase
    `TUNDRA_HISTORIA_14_PERDON|TUNDRA_HISTORIA_14_JUSTICIA`).
  - Para volver, la subida de la Escalera Helada te deja en (14, 56) de la Cripta Congelada.
- **Atajo a Aurelia: la cripta sellada bajo la Catedral:**
  - Está entre la Catedral y la capilla, en (63-65, 10-12) de Aurelia (`aurelia/chunk_1_0.json`).
  - Se abre desde el paso 3 de la A5 (fase
    `CATACUMBAS_HISTORIA_05_CATEDRAL@3+|CATACUMBAS_HISTORIA_05_CATEDRAL`).
  - Bajando llegas a (146, 101) de las Catacumbas. Subiendo llegas a (64, 14) de Aurelia.
  - Mientras está cerrada dice: «Una reja de hierro cierra la escalera. Del otro lado, alguien tendría que
    abrirla.»
- **La mazmorra:** el Trono de Huesos se entra por el arco de cráneos de la Antesala del Trono, en (20,35).
  Ver la sección 8.
- **Salida a la zona 7:** el Trono de Huesos se abrirá al templo de las Ruinas (A14, cuando exista la
  zona 7). Todavía no hay salida.
- En el mapa del mundo (M) aparece en «Más allá del mapa», con el texto de cómo se llega
  (`game/atlas.js`).

---

## 3. El mapa (4×4 trozos, norte arriba)

```
  ┌───────────────┬───────────────┬───────────────┬───────────────┐
  │ SALA DEL      │ BIBLIOTECA    │ ABISMO DE LAS │ ESCALERA      │
  │ SEXTO SELLO   │ PROHIBIDA     │ ALMAS         │ HELADA        │
  │ (84-85) Lich  │ (82-84)       │ (81-83)       │ (76-77) ⇡Cripta│
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ ANTESALA DEL  │ SANTUARIO     │  VELA ETERNA  │ OSARIO DE     │
  │ TRONO ⛩       │ PROFANADO     │  (la ciudad)  │ LOS REYES     │
  │ (83-85)       │ (80-82)       │               │ (77-79)       │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ RÍO DE LAS    │ JARDÍN DE     │ NICHOS DE LOS │ GALERÍA DE    │
  │ ALMAS (82-84) │ HONGOS (79-81)│ SACERDOTES    │ LAS MÁSCARAS  │
  │               │               │ (78-80)       │ (77-79)       │
  ├───────────────┴───────────────┼───────────────┴───────────────┤
  │   LAGO NEGRO (agua quieta,    │ CRIPTA DE LA CATEDRAL (77-79) │
  │   muelles e islotes) (80-83)  │                  ⇡ Aurelia     │
  └───────────────────────────────┴───────────────────────────────┘
```

Se entra por la derecha (la Escalera Helada arriba, la cripta de la Catedral abajo) y se avanza hacia el
oeste: cada subzona un poco más alta. Vela Eterna queda en el medio, a la mano de las dos entradas. Lo
más hondo (la Antesala del Trono y la Sala del Sexto Sello) queda en el rincón oeste.

**Las 14 subzonas** (casillas; `generar_catacumbas.js`):

| Subzona | Casillas (x0-x1, y0-y1) | Niveles |
|---|---|---|
| Vela Eterna | 80-119, 30-59 | segura (sin combates; la llama no se gasta) |
| Escalera Helada | 120-159, 0-29 | 76-77 |
| Osario de los Reyes | 120-159, 30-59 | 77-79 |
| Galería de las Máscaras | 120-159, 60-89 | 77-79 |
| Cripta de la Catedral | 80-159, 90-119 | 77-79 |
| Nichos de los Sacerdotes | 80-119, 60-89 | 78-80 |
| Jardín de Hongos | 40-79, 60-89 | 79-81 |
| Santuario Profanado | 40-79, 30-59 | 80-82 |
| Lago Negro | 0-79, 90-119 | 80-83 |
| Abismo de las Almas | 80-119, 0-29 | 81-83 |
| Río de las Almas | 0-39, 60-89 | 82-84 |
| Biblioteca Prohibida | 40-79, 0-29 | 82-84 |
| Antesala del Trono | 0-39, 30-59 | 83-85 |
| Sala del Sexto Sello | 0-39, 0-29 | 84-85 |

**Bajo tierra todo es pasillo y sala:** las subzonas son cavernas grandes unidas por galerías, con
paredes de catacumba (nichos con cráneos y velas) en vez de bordes de mar o montaña. A la Sala del Sexto
Sello se llega por la Biblioteca: la galería desde la Antesala la corta la pared del Trono.

**Terrenos (tileset v10):**
- `losac`: losas de catacumba, el suelo de base.
- `muroc`: la pared; muestra su cara de nichos donde abajo hay suelo.
- `tierrac` (tierra de tumba) y `huesosc` (huesos regados).
- `hongos`: hongos que brillan.
- `aguan`: agua negra (choca).
- `rioalma`: el río de almas (choca, brilla).
- `osario`: el «pasto» donde salen los combates.
- `losavel`: las losas de Vela Eterna.
- `puentec` (puente de hueso) y `muellec` (muelle del barquero).
- Se reusan el abismo y los puentes colgantes de las Montañas.

**Objetos:** sarcófagos, ataúdes, urnas, pilas de cráneos, candelabros y velas (luces), estatuas veladas,
columnas, cadenas, telarañas, el altar profanado, hongos gigantes, las 17 lámparas de alma (los refugios),
los mausoleos, la Gran Vela, la forja de hueso, la casa de Ilse, el puesto de Hollin, estanterías y
atriles, el arco de cráneos del Trono, las dos escaleras de subida y la barca.

---

## 4. Lo que la hace única

Cada una está explicada con sus números en la sección 13.

- **La oscuridad (13.3 y 13.4):** el héroe lleva su propia **llama**, que se gasta fuera de Vela Eterna.
  Las lámparas de alma y la **Vela de Sebo** la vuelven a encender. Con la llama apagada quedas **A
  oscuras**: ves mucho menos y los muertos te encuentran más seguido. No quita vida.
- **La barca de Óbolo (13.5):** viaje rápido entre el muelle de Vela Eterna, el muelle del Lago Negro y la
  orilla del Río de las Almas, por «una moneda».
- **Los Velados:** la ciudad es de espíritus. Algunos NPCs aparecen o desaparecen según tu historia
  (13.1): Aldren baja en la A5, Velkan aparece al final según la T14 y Don Osvaldo se va cuando descansa.
- **Padre e hijo (13.8):** Velkan es el hijo de Aldren. Lo que pasa con él depende de lo que elegiste en
  la Tundra.
- **Lo que viene de la Tundra (13.2):** la primera misión acepta cualquiera de las dos T14.

---

## 5. Monstruos

Los comunes y raros salen de `_respaldo_claude/catacumbas/gen_catacumbas.js` (`catacumbas_monstruos.sql`).
Se reusaron los 5 que ya existían (renovados) y se agregaron 7 comunes, 2 raros, y Velkan para la
historia.

| Monstruo | Código | Nivel | Tipo · elemento | Habilidades | Suelta |
|---|---|---|---|---|---|
| Rata de Osario | `RATA_OSARIO` | 76-78 | BESTIA · oscuro | Mordisco de la Peste | Cola de Rata 30%, Hueso Antiguo 10%, huevo 3% |
| Murciélago Vampiro | `MURCIELAGO_VAMPIRO` | 77-79 | BESTIA · viento | Chupasangre | Ala de Murciélago 30%, Cera Eterna 8%, huevo 3% |
| Esqueleto Guerrero | `ESQUELETO_GUERRERO` | 76-79 | MUERTO_VIVIENTE · oscuro | Golpe Brutal, Escudo de Huesos | Espada Rota 30%, Hueso Antiguo 12%, Oro Antiguo 5% |
| Zombie Anciano | `ZOMBIE_ANCIANO` | 77-80 | MUERTO_VIVIENTE · oscuro | Mordisco Putrefacto | Carne Putrefacta 30%, Seta Pálida 8%, Oro Antiguo 5% |
| Araña de Tumba | `ARANA_TUMBA` | 78-80 | INSECTOIDE · tierra | Telaraña de Tumba, Mordisco de la Peste | Seda de Tumba 30%, Hueso Antiguo 8%, huevo 3% |
| Hongo Pálido | `HONGO_PALIDO` | 79-81 | BESTIA · tierra | Nube de Esporas | Esporas Pálidas 30%, Seta Pálida 15%, Polvo Arcano 5% |
| Fantasma Encadenado | `FANTASMA_ENCADENADO` | 80-82 | ESPECTRO · oscuro | Cadenas Espectrales, Maldición Oscura | Cadena Espectral 30%, Esencia de Alma 8%, Alma Redimida 5% |
| Gul Hambriento | `GUL_HAMBRIENTO` | 80-83 | MUERTO_VIVIENTE · oscuro | Desgarro de Gul | Garra de Gul 30%, **Pescado Ciego 20%**, Hueso Antiguo 10%, huevo 3% |
| Cadáver Reanimado | `CADAVER_REANIMADO` | 81-83 | MUERTO_VIVIENTE · oscuro | Golpe Brutal, Mordisco Putrefacto | Hueso Reanimado 30%, Plata Sepulcral 10%, Oro Antiguo 5% |
| Alma en Pena (magia) | `ALMA_EN_PENA` | 81-84 | ESPECTRO · oscuro | Grito del Alma, Cadenas Espectrales | Lamento Cristalizado 30%, Esencia de Alma 12%, Polvo Arcano 6% |
| Sacerdote Maldito (magia) | `SACERDOTE_MALDITO` | 82-84 | HUMANOIDE · oscuro | Rayo Oscuro, Maldición Oscura | Reliquia Maldita 30%, Plata Sepulcral 10%, Alma Redimida 5% |
| Inquisidor del Eclipse (magia) | `INQUISIDOR_ECLIPSE` | 83-85 | HUMANOIDE · oscuro | Juicio del Eclipse, Rayo Oscuro | Sello del Eclipse Negro 30%, Polvo Arcano 10%, Fragmento del Eclipse 4% |
| **Gusano de las Criptas** (raro) | `GUSANO_CRIPTA` | 80-83 | BESTIA · tierra | Tragar, Pisotón | **Diente de Gusano 30%**, Hueso Antiguo 30%, **Carne de Gusano 60%**, piedra mayor 6%, huevo raro 4% |
| **Caballero sin Rostro** (raro) | `CABALLERO_SIN_ROSTRO` | 83-85 | MUERTO_VIVIENTE · oscuro | Tajo Sombrío, Escudo de Huesos | **Yelmo Vacío 30%**, Plata Sepulcral 25%, piedra mayor 8%, huevo raro 4% |
| **Guardián del Abismo** (minijefe, A3) | `GUARDIAN_ABISMO` | 78 | MUERTO_VIVIENTE · oscuro | Golpe Brutal, Escudo de Huesos, Maldición Oscura | Fragmento del Abismo 100%, Hueso Antiguo 60%, piedra mayor 20% |
| **Archimago Corrupto** (minijefe, A6) | `ARCHIMAGO_CORRUPTO` | 82 | HUMANOIDE · oscuro | Juicio del Eclipse, Rayo Oscuro, Maldición y Explosión Oscura | Grimorio Corrupto 100%, Plata Sepulcral 60%, piedra mayor 20% |
| **Centinela de la Muerte** (minijefe, A10) | `CENTINELA_MUERTE` | 84 | MUERTO_VIVIENTE · oscuro | Siega, Tajo Sombrío, Escudo de Huesos | Núcleo del Centinela 100%, Plata Sepulcral 60%, piedra mayor 20%, pergaminos del Centinela |
| **Lich Ancestral** (legendario, A13) | `LICH_ANCESTRAL` | 85 | MUERTO_VIVIENTE · oscuro | Explosión Oscura, Juicio del Eclipse, Grito del Alma, Maldición Oscura | Corazón del Lich 100%, pergaminos del Lich, Dientes, Yelmos y a veces un Núcleo |
| Velkan, el Encapuchado (historia, A11) | `VELKAN` | 84 | HUMANOIDE · oscuro | Tajo Sombrío, Juicio del Eclipse, Maldición Oscura | Sello del Eclipse Negro 60%, piedra mayor 20% |

- Velkan no tiene zona (`zone_id` nulo): solo sale en la emboscada de la A11.
- El Guardián del Abismo y el Archimago dejaron de salir en el osario: ahora son jefes de la historia.
  Los jefes están en el mapa en (140,30), (60,15), (36,14) y (20,14).
- Hay **31 grupos de monstruos** en el osario, repartidos por subzona.
- **Vida:** con el equipo nuevo, los comunes caen en ~3,1-3,9 turnos y aguantas 5-13 golpes, como en la
  Tundra (`node scripts/equilibrio/generar.js --simular --detalle`). A los comunes se les subió la vida
  ×1,3-×1,5.

**Las 13 habilidades nuevas** (`gen_catacumbas.js`):

| Habilidad | A quién | Qué hace además del daño |
|---|---|---|
| Mordisco de la Peste | uno | veneno 4% de la vida máxima por ronda (35%) |
| Chupasangre | uno · viento | sangrado (40%) |
| Escudo de Huesos | a sí mismo | +35% de defensa por 2 rondas |
| Mordisco Putrefacto | uno · oscuro | veneno 5% por ronda (35%) |
| Telaraña de Tumba | uno · tierra | −25% de velocidad por 3 rondas (35%) y veneno (25%) |
| Nube de Esporas | todos · tierra (magia) | veneno 3% por ronda (30%) |
| Cadenas Espectrales | uno · oscuro (magia) | atado: puede perder el turno 2 rondas (25%) |
| Desgarro de Gul | uno | sangrado (35%) |
| Grito del Alma | todos · oscuro (magia) | −15% de ataque por 3 rondas (30%) |
| Juicio del Eclipse | uno · oscuro (magia) | −20% de defensa por 3 rondas (30%) |
| Tragar | uno · tierra | aturdido: puede perder el turno 2 rondas (25%) |
| Tajo Sombrío | uno · oscuro | sangrado (30%) y −10% de ataque (25%) |
| Siega | todos · oscuro | sangrado (30%) |

Cada una tiene su efecto en la lámina de efectos (`crear_efectos_monstruos.lua`).

**Mazmorra (sección 8 y 13.6):** el Bufón de Hueso, la Guardia Real Esquelética, la Doncella Velada y el
jefe, el Coloso de Huesos (`TRONOH_…`).

**Mítico (13.7):** Morgath, la Polilla de la Vela Negra, y sus polillas de ceniza.

---

## 6. Recursos, materiales y comida

**Recursos del mapa** (`lib/worldNodes.js`; 6 tipos, 51 sitios en 26 nodos):

| Recurso | Vuelve en | Da |
|---|---|---|
| Pila de huesos (`pila_huesos`) | 5 min | Hueso Antiguo 85% (1-2), Espada Rota 12%, Oro Antiguo 8% |
| Setas pálidas (`setas_palidas`) | 4 min | Seta Pálida 85% (1-2), Esporas Pálidas 15%, Hierba Mágica 15% |
| Veta de plata (`veta_plata`) | 5 min | Plata Sepulcral 80% (1-2), Mineral de Acero 20%, Gema Común 8%, piedra menor 10% |
| Candelabro olvidado (`candelabro_olvidado`) | 4 min | Cera Eterna 85% (1-2), Cera de Sellado 10%, Oro Antiguo 5% |
| Pozo de almas (`pozo_almas`) | 7 min | Esencia de Alma 80% (1-2), Lamento Cristalizado 15%, Alma Redimida 5% |
| Sarcófago (`sarcofago_tesoro`, el cofre) | 30 min | 900-1600 de oro, pociones mayores, piedra mayor 35%, Oro Antiguo 30%, Diente de Gusano 10%, Yelmo Vacío 10%, huevo raro 4% |

**Comida** (Ilse cocina en su casa de Vela Eterna, `posada_vela`; dos son de alquimia). Comidas fuera de
combate te dejan «bien alimentado» 20 minutos.

| Comida | Nivel | Qué da | Receta |
|---|---|---|---|
| Sopa de Setas Pálidas | 76 | 420 de vida, +16% defensa | 3 Seta Pálida, 1 Agua Purificada |
| Pan de Ofrenda | 77 | 440 de vida, +16% ataque | 2 Harina, 1 Hierba Curativa |
| Pescado Ciego Asado | 78 | 450 de vida, +14% velocidad | 3 Pescado Ciego, 1 Aceite de Cocina |
| Té de Cera Eterna (alquimia) | 78 | 280 de maná, +14% inteligencia | 1 Cera Eterna, 1 Seta Pálida, 1 Agua Purificada |
| Guiso del Sepulturero | 80 | 500 de vida, +18% ataque | 2 Carne de Gusano, 2 Seta Pálida, 1 Hierba Curativa |
| Vino de los Velados (alquimia) | 82 | 300 de maná, +16% inteligencia y +14% velocidad | 1 Esencia de Alma, 1 Lamento Cristalizado, 1 Agua Purificada |
| Caldo de Hueso Antiguo | 84 | 560 de vida, +22% defensa | 3 Hueso Antiguo, 2 Seta Pálida, 1 Carne de Gusano |

Además, la **Vela de Sebo** (no es comida: enciende la llama; ver 13.4).

Lo de las Catacumbas se vende ×6 (`sell_zone_mult`).

---

## 7. Equipo y crafteo (escalera v2/v3)

En la **Forja de Hueso** de Vela Eterna, con Osmund (`forja_vela`, en (86,36)):

| Tier | Código | Nivel | Qué pide |
|---|---|---|---|
| de las Catacumbas | `_CATACUMBAS` (piezas viejas, recetas rehechas) | 76 RARO 90% | ratas, murciélagos, esqueletos, zombies, arañas; hueso antiguo, plata, cera y setas |
| Sepulcral | `_SEPULCRAL` (nuevo) | 81 ÉPICO 80% | gules, almas, cadáveres, sacerdotes + **Diente de Gusano** o **Yelmo Vacío** |
| del Trono (armas) | `_TRONO` (nuevo) | 82 LEGENDARIO 75% | **Corona de Huesos** + **Plata Sepulcral Pura** (las dos, del Trono de Huesos) |
| del Centinela | `_CENTINELA` (set nuevo, con joyas) | 84 ÉPICO 70% | pergamino del Centinela (17,5%) + **Núcleo del Centinela** |
| del Lich | `_LICH` (set viejo) | 85 LEGENDARIO 55% | pergamino del Lich (12,5%) + **Corazón del Lich Ancestral** |

- La forma de cada pieza sale de su par del Volcán, como en la Tundra.
- Las armas siguen la escalera sobre las del Guardián y el Rey del Hielo: +7% las comunes y +9% las de
  mazmorra y jefe.
- Los sets de jefe piden la mitad de materiales.
- Colores nuevos: `sepulcral`, `trono` y `centinela` (`crear_equipo.lua`, `gear.js`).
- Para fabricar hay que tener la zona 6 desbloqueada: se desbloquea con el primer combate ganado contra un
  monstruo de las Catacumbas.

---

## 8. La mazmorra: el Trono de Huesos (80-84)

- **Qué es:** la corte del Lich. Una sala del trono hecha con los huesos de los sacerdotes que traicionó.
- **Se abre con:** la A8 (la Llave de Hueso que te da Liora) o la A9 completa.
- **Puntos de control:** dos velas negras («Encender»).
- **Tres guardianes:**
  - el Bufón de Hueso;
  - la Guardia Real Esquelética, de a dos;
  - la Doncella Velada, una Velada que el Lich ató a su servicio; al vencerla queda libre.
- **Jefe: el Coloso de Huesos**, armado con mil huesos de sacerdotes. Su escudo cambia de elemento y
  levanta un golpe anunciado que se esquiva defendiéndose.
- **Botín:** Corona de Huesos (armas del Trono), Plata Sepulcral Pura y piezas Sepulcrales de tu clase
  en el cofre (cada 3 horas).

Todos los números, las salas y las casillas están en la sección 13.6.

---

## 9. Pueblo y NPCs

| NPC | Código | Dónde (casilla) | Cuándo está | Quién es | Para qué |
|---|---|---|---|---|---|
| **Liora, la Primera Vela** | `liora` | la Gran Vela (98,43) | siempre | la sacerdotisa velada que encendió la vela hace mil años | historia principal |
| **Osmund, el herrero velado** | `osmund` | Forja de Hueso (87,37) | siempre | forjaba las campanas del templo; ahora forja con huesos | forja y encantar |
| **Ilse, la sepulturera** | `ilse` | su casa (112,37) | siempre | una mujer viva que bajó a cuidar las tumbas de la Catedral; la única que cocina | cocina |
| **Hollin, el mercader de reliquias** | `mercader_vela` | la plaza (109,47) | siempre | un saqueador de tumbas que se quedó a vivir (y a vender) | tienda propia (`MERCADER_VELA`) |
| **Óbolo, el barquero** | `obolo` | muelle de Vela Eterna (102,51) | siempre | cobra una moneda por viaje, como manda la tradición | barca |
| Óbolo (otra parada) | `barca_lago` | muelle del Lago Negro (58,95) | siempre | el mismo Óbolo, que siempre llega antes que tú | barca |
| Óbolo (otra parada) | `barca_rio` | orilla del Río de las Almas (25,71) | siempre | ídem | barca |
| **Aldren** | `aldren_vela` | junto a la Gran Vela (95,44) | desde la A5 | el anciano de la Aldea, último de los Vigías | historia, *Padre e hijo* |
| **Velkan** | `velkan_vela` | junto a su padre (94,46) | después de la A11, solo con *El perdón* | el hijo de Aldren | el final de Velkan |
| Velkan herido | `velkan_herido` | el altar del Santuario (61,47) | solo en el paso 4 de la A11 | ídem | historia |
| **Don Osvaldo** | `osvaldo` | los Nichos (100,75) | hasta entregar *Osvaldo descansa* | un esqueleto que no sabe que está muerto | secundaria graciosa |
| **Elenya** (en Aurelia) | `elenya` | la Catedral | — | abre la puerta sellada; recibe el Sexto Fragmento | historia |
| **Brokk** (en Aurelia) | `brokk` | la forja de Aurelia | — | contesta la carta de Osmund | *Cuatro forjas* |

**Ventanas que abren:**
- Osmund: la forja y el encantador.
- Ilse: la cocina (taller).
- Hollin: comercio.
- Óbolo, en sus tres paradas: los viajes en barca.
- La Gran Vela es la enfermería (punto `enfermeria_vela`).

**La tienda de Hollin** (`MERCADER_VELA`, especialidad OSCURO, solo aparece estando en las Catacumbas):

| Objeto | Precio |
|---|---|
| Frasco Vacío | 10 |
| Aceite de Cocina | 18 |
| Carbón | 22 |
| Vela de Sebo | 90 |
| Hueso Antiguo, Pescado Ciego, Seta Pálida, Cera Eterna | 315 cada uno (más del doble de lo que pagan los NPCs) |

**Diálogos:** `src/game/dialoguesCatacumbas.js`. Cada NPC cambia lo que dice según tu historia:
- Liora: según la A1, A4, A11 (y la T14), A12 y el Lich.
- Aldren: según la A6, A7 y la A11, con líneas distintas para el perdón o la justicia.
- Ilse: según la A5 y *Trueno*.
- Hollin: según *Reliquias*.
- Óbolo: según *El barquero cobra*.
- Osmund: según *Cuatro forjas*.
- Osvaldo: según su cadena.

Dónde vive cada uno: `NPC_LUGAR` (`questGivers.js`) y `NPC_HOMES` (`lib/questSteps.js`).

**Pendiente:** los maestros de evolución de los Velados (Nigromante y Exorcista), para cuando se repasen
las evoluciones, como en las otras zonas.

---

## 10. Misiones

`_respaldo_claude/catacumbas/gen_misiones_catacumbas.js` → `catacumbas_misiones.sql`. Son 41 misiones
(14 principales, 14 secundarias y 13 diarias), con 120 pasos y 9 objetos de misión. Cada una tiene su
diálogo de entrega.

**Recompensas de la historia:** 33000 de experiencia + 800 por eslabón, 8800 de oro + 250 por eslabón, y
reputación 440 + 8 por eslabón.

### Principales (A1-A14), después de la T14 (cualquiera de las dos)

| # | Código | Nombre | Nivel | Da → recibe | Pasos | Qué pasa |
|---|---|---|---|---|---|---|
| A1 | `CATACUMBAS_HISTORIA_01_ESCALERA` | La escalera bajo la reina | 76 | Elenya → Liora | hablar, ir, ir, hablar | bajar por la escalera de la Cripta Congelada y seguir la luz azul hasta Vela Eterna |
| A2 | `…_02_LAMPARAS` | Los que no descansan | 76 | Liora | 3 lámparas, combate, hablar | encender tres lámparas de alma (aprendes la oscuridad) |
| A3 | `…_03_GUARDIAN` | El Guardián de las Catacumbas | 78 | Liora | hablar, combate, **jefe**, investigar, hablar | el Guardián del Abismo, enloquecido por un cristal de eclipse |
| A4 | `…_04_SANTUARIO` | El Santuario Profanado | 80 | Liora | combates, emboscada, investigar, entregar | acólitos del Eclipse en el santuario; un anillo con el nombre «Velkan» |
| A5 | `…_05_CATEDRAL` | La puerta bajo la Catedral | 79 | Liora → Elenya | Ilse, la reja oxidada, la puerta, Elenya | abrir la puerta sellada desde abajo (en el paso 3 se abre el atajo) |
| A6 | `…_06_ARCHIMAGO` | El Archimago Corrupto | 82 | Aldren | combate, **jefe**, investigar, entregar | en la Biblioteca Prohibida; la página del registro |
| A7 | `…_07_HIJO` | El nombre del hijo | 82 | Aldren | hablar, investigar, hablar | Aldren confiesa: Velkan es su hijo; el nicho «Velkan, hijo de nadie» (104,70) |
| A8 | `…_08_LLAVE` | La llave de hueso | 83 | Liora | combate, hablar | Liora te da la **Llave de Hueso** (abre el Trono) |
| A9 | `…_09_TRONO` | El Trono de Huesos | 83 | Liora | el arco, escuchar, **el Coloso**, la Doncella, Liora | la mazmorra; liberas a la Doncella Velada |
| A10 | `CATACUMBAS_Q2_CENTINELA_MUERTE` | El Centinela de la Muerte | 84 | Liora | hablar, combate, **jefe**, hablar | el Centinela que cierra el paso al Sexto Sello |
| A11 | `…_11_PADRE` | Padre e hijo | 84 | Aldren | hablar, escoltar, **emboscada con Velkan**, Velkan herido, Aldren | el encuentro con Velkan; su final según la T14 (13.8) |
| A12 | `…_12_VELA` | La última vela | 85 | Liora | 6 Cera Eterna, encender la sala, Liora | Liora gasta su luz para alumbrar la Sala del Sexto Sello |
| A13 | `CATACUMBAS_Q3_LICH_ANCESTRAL` | El Lich Ancestral | 85 | Liora | hablar, **jefe**, recoger el fragmento, hablar | el Lich; «el Devorador ya despierta» |
| A14 | `…_14_FRAGMENTO` | Lo que el Lich dijo | 85 | Aldren → Elenya | Liora te da el fragmento, entregarlo | el Sexto Fragmento a Elenya; el camino a las Ruinas |

- La A10 y la A13 conservan el código de las misiones viejas (`CATACUMBAS_Q2_…` y `CATACUMBAS_Q3_…`).
- La A1 pide `TUNDRA_HISTORIA_14_PERDON`, pero también se abre con *La justicia* (13.2).

### Secundarias (14)

| Código | Nombre | Nivel | Da → recibe | Después de | Premio extra |
|---|---|---|---|---|---|
| `CATACUMBAS_SEC_OSVALDO_1` | El esqueleto que no sabía | 78 | Don Osvaldo | A2 | — |
| `CATACUMBAS_SEC_OSVALDO_2` | Un espejo para Osvaldo | 79 | Don Osvaldo | Osvaldo 1 | — |
| `CATACUMBAS_SEC_OSVALDO_3` | Osvaldo descansa | 80 | Don Osvaldo → Liora | Osvaldo 2 | huevo poco común |
| `CATACUMBAS_SEC_VELAS` | Velas para los Velados | 77 | Liora | A2 | 3 Té de Cera Eterna |
| `CATACUMBAS_SEC_BARQUERO` | El barquero cobra | 80 | Óbolo | A4 | — |
| `CATACUMBAS_SEC_RELIQUIAS_1` | Lo que Hollin no pudo vender | 79 | Hollin → Liora | A2 | — |
| `CATACUMBAS_SEC_RELIQUIAS_2` | Hollin cambia de oficio | 82 | Hollin | Reliquias 1 | piedra de encantar mayor |
| `CATACUMBAS_SEC_COCINA` | La cocina de Ilse | 79 | Ilse | A1 | 2 Guiso del Sepulturero |
| `CATACUMBAS_SEC_TRUENO` | Trueno bajo tierra | 80 | Ilse | A5 | — |
| `CATACUMBAS_SEC_NICHOS_1` | Los nombres de los nichos | 78 | Liora | A3 | — |
| `CATACUMBAS_SEC_NICHOS_2` | Los que no se acuerdan | 80 | Liora | Nichos 1 | — |
| `CATACUMBAS_SEC_FORJAS` | Cuatro forjas | 80 | Osmund (con Brokk) | A5 | piedra de encantar mayor |
| `CATACUMBAS_Q1_CAZADOR_MUERTOS` | Cazador de muertos (vieja) | 77 | Liora | A1 | — |
| `CATACUMBAS_Q4_PACTO_ABISMAL` | El pacto de los abismales (vieja) | 82 | Aldren | A6 | — |

Los dibujos de búsqueda nuevos (`crear_puntos_mision.lua`) son la reja oxidada, el espejo roto, la moneda
en el barro y Trueno entre los hongos.

### Diarias (13, cada 20 h)

| Código | Nombre | Quién | Después de |
|---|---|---|---|
| `CATACUMBAS_DIARIA_VELAS` | Cera para la Gran Vela | Liora | A2 |
| `CATACUMBAS_DIARIA_GULES` | Gules en la orilla | Óbolo | A4 |
| `CATACUMBAS_DIARIA_ALMAS` | Almas río abajo | Aldren | A6 |
| `CATACUMBAS_DAILY_PURIFICACION_ALMAS` | Purificación de almas | Liora | A1 |
| `CATACUMBAS_DAILY_PLAGA_ALMAS` | Plaga de almas en pena | Liora | A4 |
| `CATA_COMUN_SACERDOTE` | La maldición del sacerdote | Aldren | A6 |
| `CATA_COMUN_FANTASMA` | Las cadenas espectrales | Liora | A4 |
| `CATA_COMUN_ZOMBIE` | Los ancestros reanimados | Ilse | A1 |
| `CATA_COMUN_CADAVER` | La fuerza del cadáver | Osmund | A4 |
| `CATA_CAZA_ARCHIMAGO` | El Gusano de las Criptas | Hollin | A4 |
| `CATA_CAZA_GUARDIAN_ABISMO` | El Caballero sin Rostro | Liora | A8 |
| `CATA_BOSS_CENTINELA` | El Centinela de la Muerte vuelve | Liora | A10 |
| `CATA_LEG_LICH` | El eco del Lich | Liora | A13 |

Las tres primeras son nuevas. Las demás son las viejas de la zona, rehechas con su NPC (conservan el
código).

**Objetos de misión (9):**
- Sello del Encapuchado (`SELLO_VELKAN`)
- Registro de aprendices (`REGISTRO_BIBLIOTECA`)
- Llave de Hueso (`LLAVE_HUESO`)
- Sexto Fragmento de Sello (`FRAGMENTO_SELLO_CATACUMBAS`)
- Espejo de bolsillo (`ESPEJO_VIEJO`)
- Moneda del barquero (`MONEDA_OBOLO`)
- Relicario de un Velado (`RELIQUIA_ROBADA`)
- Carta de Osmund (`CARTA_OSMUND`)
- Respuesta de Brokk para Osmund (`RESPUESTA_BROKK_OSMUND`)

---

## 11. Los demás sistemas

| Sistema | Qué lleva en las Catacumbas |
|---|---|
| Bestiario y cartas | entran solos |
| Huevos | huevos poco comunes y raros en los drops y el sarcófago |
| Mítico | Morgath, la Polilla de la Vela Negra, en `MITICOS[6]` (13.7) |
| Exploración | `ZONES.catacumbas`: 7500 de oro y 19000 de experiencia por explorarla entera, y 3 secretos (13.9) |
| Música | `catacumbas` (coro lejano y campana) y `trono_huesos` (marcha fúnebre) (13.10) |
| Fondos de combate | Catacumbas (nichos y velas) y Trono de Huesos (el trono y la alfombra roja) |
| Viaje rápido | la barca de Óbolo (13.5) |
| Encantador | Osmund |
| Refugios | las 17 lámparas de alma; en el juego se llaman «la lámpara de alma de …» |

---

## 12. Decisiones (tomadas)

1. **El final de Velkan depende de la T14:**
   - Si elegiste *El perdón*, Velkan se arrepiente y se queda con Aldren en Vela Eterna.
   - Si elegiste *La justicia*, muere protegiendo a su padre.

   (La historia decía «según Tilo y Ren», pero eso no quedó como una elección clara en el juego.) Ver 13.8.
2. **La oscuridad:** más combates y menos visión, **sin daño** (la Tundra ya quita vida con el frío).
3. **La primera misión acepta cualquiera de las dos T14.**
4. **La barca para en el Lago Negro, no en el Jardín de Hongos:** el jardín no tiene agua.
5. **Los huevos y sobres de cartas por zona** siguen aparte, para cuando se hagan en todas las zonas.

---

## 13. Las mecánicas nuevas, en detalle

### 13.1 Pasos cerrados por la historia (front)

Antes, solo los NPCs dependían de la historia. Ahora también una **salida** del mapa (un punto
`salida`) puede llevar:
- `fase`: la condición para poder cruzar.
- `sellada`: el aviso que sale si no se cumple. Sin aviso, dice «El paso está cerrado.».

Al chocar con un paso cerrado, el héroe da un paso atrás y sale el aviso (`WorldScene.js`).

Las fases (`game/story.js`) usan la misma sintaxis que los NPCs:

| Fase | Se cumple si… |
|---|---|
| `CODE` | completaste la misión |
| `!CODE` | no la completaste |
| `CODE@activa` | la tienes en curso |
| `CODE@2` / `CODE@2+` / `CODE@2-` | vas en el paso 2 / en el 2 o más / en el 2 o menos |
| `CODE@lista` | la tienes con todo cumplido, falta entregarla |
| `CODE@empezada` | la tienes en curso o ya la completaste |
| `A,B` | se cumplen las dos |
| `A\|B` | **(nuevo)** se cumple una u otra |

**Dónde se usa en la zona 6:**
- La escalera de la Cripta Congelada: `TUNDRA_HISTORIA_14_PERDON|TUNDRA_HISTORIA_14_JUSTICIA`.
- La cripta de la Catedral de Aurelia: `CATACUMBAS_HISTORIA_05_CATEDRAL@3+|CATACUMBAS_HISTORIA_05_CATEDRAL`.
- Los NPCs:
  - `aldren_vela`: `CATACUMBAS_HISTORIA_05_CATEDRAL`.
  - `velkan_vela`: `CATACUMBAS_HISTORIA_11_PADRE,TUNDRA_HISTORIA_14_PERDON`.
  - `velkan_herido`: `CATACUMBAS_HISTORIA_11_PADRE@4`.
  - `osvaldo`: `!CATACUMBAS_SEC_OSVALDO_3`.

### 13.2 La regla de la elección (back)

La T14 de la Tundra son dos misiones que se excluyen: *El perdón* y *La justicia* (`lib/eleccion.js`,
`PARES`). Lo que sigue a una elección tiene que aceptar cualquiera de las dos, y `requires_quest_id` solo
guarda una. Para eso hay dos funciones nuevas:

- `previaCumplida(playerId, questId)`: verdadero si el jugador completó la misión previa **o su rival**.
- `cumplidasPorRival(playerId)`: los ids de las misiones que cuentan como cumplidas porque el jugador
  entregó su rival.

`routes/players.js` las usa en tres lugares:
- en la lista de misiones disponibles (`prerequisite_met`);
- al aceptar;
- al entregar.

La consulta de las diarias no cambió. Así la A1 (que pide *El perdón*) aparece igual si elegiste *La
justicia*. Sin ninguna de las dos, no aparece y aceptarla da «Todavía no completaste la misión previa
requerida».

### 13.3 La oscuridad: la llama (front)

`gpr/src/game/world/llama.js`, métodos de la escena como el frío de la Tundra (`world/frio.js`). Se
engancha en tres lugares:
- `WorldScene.update` llama a `updateLlama`;
- `updateIndoorSky` (`world/cripta.js`) llama a `applyLlamaLight`;
- `checkGrassEncounter` multiplica la probabilidad de combate por `darkEncounterMul()`.

**Dónde se gasta:** en la zona `catacumbas`, fuera de una subzona segura (Vela Eterna). Las mazmorras
(el Trono de Huesos) no la gastan.

| Número | Valor |
|---|---|
| Barra | de 0 a 100; empieza en 100 |
| Cuánto baja | 0,42 por segundo (de 100 a 0 en ~4 minutos) |
| Con Morgath suelta en las Catacumbas | ×1,5 |
| Cuánto sube junto a una lámpara de alma (a menos de 6 casillas) o en Vela Eterna | 12 por segundo |
| Cuándo te deja A oscuras | al llegar a 0 |
| Cuándo vuelves a ver | al pasar de 15 |
| Combates en el osario A oscuras | ×1,6 |

**Cómo se ve:**
- La luz del héroe se achica con la llama: tamaño 0,8 + 1,1 × llama/100 y brillo 0,3 + 0,25 × llama/100.
- A oscuras queda en lo mínimo (0,8 y 0,3).
- El velo de la pantalla pasa de `#3c3858` (normal bajo tierra) a `#1e1c2c` (A oscuras).

**Avisos:**
- Al apagarse: cartel flotante «Tu llama se apagó» y el aviso «🕯️ Tu llama se apagó: estás a oscuras…».
- Al volver: «Tu llama vuelve a arder».
- Al llenarse junto a una lámpara suena `curar`.

**HUD** (`pages/World.js`): el bus emite `llama` con `{ luz, aOscuras, aqui }` cada vez que cambia de a
5%, o `null` fuera de las Catacumbas.
- Bufo «Llama: N%» con el ícono `candle-light`. Se marca en rojo si baja de 25%.
- A oscuras, bufo «A oscuras» con el ícono `candle-skull`.
- La descripción cambia si estás en zona segura.

**Guardado:** la llama se guarda en `sessionStorage` (`catacumbas_llama`), por pestaña, como el calor de la
Tundra.

No quita vida y no pasa por el servidor: es todo del cliente.

**Refugios:** los 17 refugios de las Catacumbas son luces `fogata`. En `world/refuges.js` ahora se llaman
«la lámpara de alma de <subzona>» en vez de «la fogata de…».

### 13.4 La Vela de Sebo

- **Objeto:** `VELA_SEBO`, CONSUMABLE común, sin nivel. Se vende ×6. El ícono `vela_sebo` es una vela
  gorda en un plato de hueso.
- **Cómo se consigue:**
  - Hollin la vende a 90.
  - Ilse la fabrica (`RECETA_VELA_SEBO`, nivel 76, 100% de éxito): 1 Cera Eterna + 1 Carne de Gusano da
    3 velas.
- **Cómo se usa:** desde la mochila («Clic derecho: usar») llama a `POST /player/:id/use-item`. Ese
  endpoint tiene un caso propio para `VELA_SEBO`:
  1. gasta una vela (no se puede usar en un NPC del grupo);
  2. devuelve `{ message, llama: true }`.

  `BagPanel.js` emite `llama-llena` por el bus y la llama vuelve a 100 (y sale de A oscuras).
- **En combate no aparece** en la lista de objetos (`Battle.js`).
- **SQL:** `catacumbas_oscuridad.sql` (bloque «tanda 6»).

### 13.5 La barca de Óbolo

`lib/barca.js` y `POST /api/player/:id/world/barca { destino }`, copia de los trineos de la Tundra.

| Parada | `destino` | NPC (`lugar`) | Te deja en | Subzona que hay que conocer |
|---|---|---|---|---|
| el muelle de Vela Eterna | `vela` | `obolo` (102,51) | (101,52) | ninguna (se conoce al llegar) |
| el muelle del Lago Negro | `lago` | `barca_lago` (58,95) | (58,96) | Lago Negro |
| la orilla del Río de las Almas | `rio` | `barca_rio` (25,71) | (25,72) | Río de las Almas |

- **Precio:** «una moneda»: 40 de oro (`BARCA_COST`).
- **Reglas:**
  - Hay que estar junto a otra parada (`lejosDe`, lugares en `lib/cercania.js`).
  - La parada de destino tiene que estar en una subzona que ya pisaste (`player_exploration`).
  - Con `POSICION_LIBRE=1` (pruebas) no se miran ni la distancia ni la exploración.
- **Errores:**
  - «Esa parada no existe».
  - «Todavía no conoces … llega caminando una vez y después Óbolo te lleva.».
  - «Óbolo cobra una moneda: 40 de oro».
- **Front:**
  - En los diálogos de las tres paradas, cada una ofrece «Cruzar a <parada> (una moneda: 40 de oro)»
    hacia las otras dos (`action: 'barca'`).
  - `World.js` llama a `api.barca`, cobra, muestra «🛶 Óbolo empuja la barca…» y cambia de lugar.
  - En las paradas del lago y del río, el diálogo «¿Cómo llegaste antes que yo?» explica que siempre es el
    mismo Óbolo.

### 13.6 El Trono de Huesos (la mazmorra)

`lib/trono_huesos.js`, con el molde de `lib/mazmorra.js`. Está registrado en `lib/mazmorras.js` y en
`server.js` (`/api/player/:id/world/trono_huesos`). La tabla del recorrido es `player_trono_huesos_runs` y
el prefijo de los combates es `trono_huesos:`.

**El mapa:** `art/mapas/generar_trono_huesos.js` → `public/assets/mundo/trono_huesos/`. Son 1×2 trozos
(40×60 casillas), con el mismo plano que la Cripta Congelada y su tileset propio.

| Sala | Casillas | Qué hay |
|---|---|---|
| Arco de Cráneos | 13-26, 3-14 | la entrada (escalones a las Catacumbas en 18-21, 3) y la **Vela del Arco** (13,9) |
| Galería del Bufón | 4-35, 15-23 | el **Bufón de Hueso** hace su ronda por la fila 18 (6→33), entre estatuas veladas y el canal de almas |
| Puente de Costillas | 4-35, 24-29 | el pozo de huesos con el puente; la **Guardia Real** cruza por la fila 26 (8→31) |
| Salón de las Ofrendas | 10-33, 30-38 | ataúdes abiertos y la **Vela de las Ofrendas** (27,33) |
| Cámara de la Doncella | 9-30, 39-48 | la **Doncella Velada** da la vuelta a la sala (11-28 × 40-44) |
| Puerta de Hueso | 18-21, 47-48 | sellada hasta vencer a los tres guardianes |
| Sala del Trono | 7-32, 49-58 | el **Coloso** (20,53) frente al trono; salida a las Catacumbas en (28-29, 49) |

**Cómo se entra y se sale:**
- Desde las Catacumbas, por el centro de abajo del arco de cráneos (20,35); llegas a (20,4).
- Al salir vuelves a (20,37).

**Acceso:**
- Nivel 80 (`TRONO_HUESOS_NIVEL`).
- Además, completaste la A9, tienes la Llave de Hueso en la mochila o completaste la misión que la da
  (la A8).
- Cerrado dice: «Un arco de cráneos, cientos, todos mirando hacia adentro. En el medio, una cerradura con
  forma de hueso. Liora, junto a la Gran Vela de Vela Eterna, guarda la llave.»

**Guardianes** (cada uno es un combate con escolta; vencidos no vuelven hasta terminar el recorrido):

| Guardián | Combate | Monstruo | Perfil | Resistencias | Habilidades | Exp / oro |
|---|---|---|---|---|---|---|
| `bufon` | Bufón + Guardia | `TRONOH_BUFON`, nv 80-84 | vida ×1,0, defensa ×0,85, magia ×1,3, defensa mágica ×1,15, velocidad ×1,2 | oscuridad 40, viento 20, luz −40, fuego −20 | Rayo Oscuro, Maldición Oscura | 4400 / 1050 |
| `guardia` | Guardia + Guardia | `TRONOH_GUARDIA` | vida ×1,15, ataque ×1,15, defensa ×1,3, velocidad ×0,85 | oscuridad 40, hielo 20, luz −40, tierra −20 | Tajo Sombrío, Escudo de Huesos | 4600 / 1080 |
| `doncella` | Doncella + Bufón | `TRONOH_DONCELLA` | vida ×1,0, defensa ×0,9, magia ×1,3, defensa mágica ×1,25, velocidad ×1,1 | oscuridad 30, hielo 30, luz −30, rayo −30 | Cadenas Espectrales, Grito del Alma | 4800 / 1120 |

**El jefe, `TRONOH_COLOSO`** (legendario, nivel 84):
- Perfil: vida ×0,95, ataque ×1,1, defensa ×1,15 y daño de elemento +8.
- Resistencias: oscuridad 50, tierra 30, hielo 20.
- Habilidades: Golpe Brutal, Pisotón y Explosión Oscura.
- 25000 de experiencia y 8000 de oro.
- **Escudo:** su debilidad cambia cada vez que se recupera de una rotura: Luz → Fuego → Luz…
- **El Garrote de los Mil:** cada 3 turnos marca a un héroe («…¡Defiéndete en tu próximo turno!»). Si ese
  héroe no se defiende, pierde el 50% de su vida máxima; si se defendió, solo el 8%.
- Al caer: «¡El ojo del eclipse del pecho del Coloso se apaga! Los mil huesos se sueltan a la vez…».

**Botín:**

| Monstruo | Objeto | Probabilidad | Cantidad |
|---|---|---|---|
| Bufón | Plata Sepulcral Pura | 35% | 1-2 |
| Bufón | Hueso Reanimado | 30% | 1-2 |
| Guardia | Plata Sepulcral Pura | 30% | 1-2 |
| Guardia | Yelmo Vacío | 12% | 1 |
| Doncella | Plata Sepulcral Pura | 40% | 1-2 |
| Doncella | Esencia de Alma | 35% | 1-2 |
| Coloso | Corona de Huesos | 50% | 1 |
| Coloso | Plata Sepulcral Pura | 100% | 2-3 |
| Coloso | piedra de encantar mayor | 20% | 1 |

**Cofre del trono** (cada 3 h por jugador): 4500 + 130 × nivel de oro, y uno de estos:
- 40%: 3 pociones mayores (vida o maná);
- 35%: una pieza Sepulcral de tu clase base (si no existe esa pieza, 2 pociones de vida);
- 25%: 1-2 Coronas de Huesos.

**Lo que hace el molde** (igual que en las otras mazmorras):
- Las velas guardan dónde despiertas si caes.
- La Puerta de Hueso se abre con los tres guardianes vencidos.
- Al vencer al jefe el recorrido queda completo hasta que sales.
- Durante 20 h después de vencerlo, las pasadas dan la mitad de experiencia y oro.
- Un recorrido sin tocar en 24 h se reinicia.
- Se puede entrar en grupo y con los compañeros NPC.

**Sin SQL propio:** la primera vez que alguien usa la mazmorra, el servidor crea sus monstruos, su tabla y
la Llave de Hueso (si falta). También engancha el paso de jefe de la A9 con el Coloso.

**Arte:**
- `crear_trono_huesos.lua`: el tileset (31 tiles), la vela negra (`mazmorra/vela_negra.png`) y la Puerta
  de Hueso (`mazmorra/puerta_hueso.png`).
- `crear_fondo_trono_huesos.lua`: el fondo de combate.
- Los 4 monstruos en `crear_enemigos_catacumbas.lua`.
- Música `trono_huesos`.
- En el front: `DUNGEONS.trono_huesos` (`world/shared.js`, nivel 80-84, prefijo `TRONOH_`), el cartel
  «Mazmorra · El Trono de Huesos» y el fondo en `Battle.js` y `BattleScene.js`.
- El HUD de la mazmorra usa los íconos `throne-king` y `candles`.

### 13.7 Morgath, la Polilla de la Vela Negra (el mítico)

`MITICOS[6]` en `lib/mythic.js`. El sistema es el mismo de los otros míticos.

| Dato | Valor |
|---|---|
| Código | `MITICO_MORGATH` (INSECTOIDE · oscuro) |
| Vida compartida | 50000 (`MITICO_HP_6`) |
| Nivel | 76-85; nivel recomendado 76 |
| Cuándo aparece | de noche, cuando la zona juntó 150 muertes (`MITICO_KILLS`) y no hubo otra cacería en la última hora |
| Cuánto dura | 20 minutos |
| Perfil | vida ×0,7, magia ×1,2, velocidad ×1,2, daño de elemento +8 |
| Habilidades | Nube de Esporas, Explosión Oscura, Maldición Oscura |
| Esbirro | `POLILLA_CENIZA`, Polilla de Ceniza (vida ×0,85, velocidad ×1,2, Nube de Esporas; 1300 de experiencia y 240 de oro) |
| Premio | oro ×3,6 y experiencia ×9 sobre la fórmula de los míticos |

**Dónde aparece** (casillas de las Catacumbas; nunca en Vela Eterna, porque la Gran Vela la espanta). Es
al azar, con más peso donde más se cazó:
- el Osario de los Reyes (140,45);
- la Galería de las Máscaras (140,75);
- los Nichos de los Sacerdotes (104,72);
- el Jardín de Hongos (60,75);
- el Santuario Profanado (64,48);
- la Cripta de la Catedral (120,106).

**Fases** (por la vida que le queda):
1. Al 75%: llama a sus polillas de ceniza. Cada polilla cazada le baja la defensa (hasta −40%).
2. Al 50%: se deshace en ceniza y aparece en otro lugar.
3. Al 25%: los ojos de sus alas se abren: pega ×1,3 y suelta ×1,25 de botín.

**El golpe anunciado:** «abre las alas y los dos ojos morados miran a todos a la vez… ¡Defiéndete en tu
próximo turno!». Si no te defiendes, «una tormenta de ceniza» te pega fuerte.

**Rumores:**
- Liora: «la Gran Vela tiembla aunque no haya viento».
- Hollin: «ceniza cayendo del techo del Osario».

**Cuando se va:** «La Gran Vela ardió más alta un momento, y Morgath se fue volando…».

**Cómo se pelea:** con `POST /player/:id/coleccion/mitico/enter` (un intento cada 30 s). Con
`/combat/sessions` no se puede enfrentar a Morgath, y a las polillas solo mientras su cacería está activa.

**Combina con la oscuridad:** mientras Morgath anda suelta por las Catacumbas, la llama se gasta ×1,5.

**Arte:**
- `mitico_morgath` (64×64) y `polilla_ceniza` (48×48) en `crear_miticos.lua`; los otros míticos
  salen idénticos.
- Tema del mapa en `game/world/mythic.js`: brillo `#c6a2ff`, rastro morado y esbirros grises.

### 13.8 El final de Velkan

Todo pasa en la A11 *Padre e hijo*:
1. Aldren te pide que lo acompañes.
2. Lo escoltas al Santuario Profanado. Por el camino dice cuatro frases sobre su hijo.
3. Emboscada frente al altar: Velkan (nv 84) y dos Inquisidores del Eclipse (nv 83).
4. Hablas con Velkan herido junto al altar (`velkan_herido`, solo en este paso). Le pregunta a su padre si
   todavía tiene la vela.
5. Vuelves con Aldren a Vela Eterna.

La entrega es la misma para todos. Lo que cambia según la T14 es lo que pasa después:

| | *El perdón* (`TUNDRA_HISTORIA_14_PERDON`) | *La justicia* |
|---|---|---|
| Velkan | se queda en Vela Eterna junto a su padre (`velkan_vela`): ayuda a los Velados con la cera y duerme con una vela encendida | murió protegiendo a Aldren; lo enterraron junto a su madre, en la Catedral |
| Aldren | le sirve té a su hijo; «Veinte años perdidos. Ahora tenemos los que quedan.» | da vueltas a la capucha de su hijo; «Se puso delante de mí. Delante del golpe.» |
| Liora | «Aldren y su hijo se sientan junto a la Vela cada noche.» | «Le grabamos un nombre a Velkan en los Nichos. No el que él había escrito. El suyo.» |

El diálogo «Háblame de Velkan» de Aldren cambia a `velkan_vive` o `velkan_muere`.

### 13.9 Los secretos

`lib/exploracion.js` (SECRETS). Son puntos `secreto` en el mapa, se abren una sola vez por jugador y hay
que estar a menos de 4 casillas.

| Secreto | Casilla | Premio |
|---|---|---|
| `secreto_tumba_vigia`: la tumba del primer Vigía, la familia de Aldren (el rincón más hondo de la Cripta de la Catedral) | (154,115) | 2600 de oro, 1600 de experiencia y una carta |
| `secreto_escondite_velkan`: el escondite de Velkan de chico, junto a su nicho vacío (la punta de los Nichos) | (116,72) | 2400 de oro y 1500 de experiencia |
| `secreto_barca_hundida`: la barca hundida al final del muelle viejo del Lago Negro | (20,104) | 2500 de oro, 1550 de experiencia y una carta |

La carta es de un monstruo común o raro de las Catacumbas, al azar. Abrir uno otra vez da «Ya abriste
este escondite».

### 13.10 La música

En `game/audio.js`, con el mismo motor de pasos que los otros temas:

- **`catacumbas`** (el mapa):
  - la menor, 56 por minuto;
  - un bajo que casi no se mueve, un coro lejano de notas largas y una campana del templo que suena sola
    de vez en cuando.
- **`trono_huesos`** (la mazmorra):
  - do menor, 60 por minuto;
  - marcha fúnebre: un órgano grave, un tambor sordo dos veces por compás y un coro de almas muy arriba.

### 13.11 El SQL de la zona

Todo es repetible y sin ON CONFLICT. Está al final de `db/schema.sql` y de `db/pendiente_supabase.sql`,
en bloques con su cabecera:

1. **Tanda 2:** monstruos, materiales y habilidades (con Velkan).
2. **Tanda 3:**
   - equipo y crafteo, paso 1;
   - la escalera v2/v3;
   - comidas y venta.
3. **Tanda 4:**
   - la tienda de Hollin;
   - misiones A1-A14, secundarias y diarias (con la A9 de la tanda 5).
4. **Tanda 6:** la Vela de Sebo.

**Ojo con el orden:**
- El bloque de monstruos borra los botines de la zona, y el de comidas (que va después) vuelve a poner
  la Carne de Gusano y el Pescado Ciego.
- La primera línea de `pendiente_supabase.sql` es un pedazo suelto
  (`AND d.drop_chance_percent <> …`): hay que borrarla antes de correr el archivo.

**No necesitan SQL:**
- el Trono de Huesos y Morgath (los crea el servidor al usarlos);
- la barca y los secretos (son código).

Todo el bloque de la zona 6 se aplicó dos veces seguidas sin errores.

---

## 14. Archivos y cómo regenerar

| Qué | Archivo | Cómo se corre |
|---|---|---|
| Tileset de la zona (v10) | `gpr/art/sprites/mundo/crear_mundo.lua` | Aseprite en modo batch (ver la guía del front) |
| Mapa de las Catacumbas | `gpr/art/mapas/generar_catacumbas.js` | `node art/mapas/generar_catacumbas.js` (también escribe `worldNodes.zonas.json["6"]`) |
| Mapa del Trono de Huesos | `gpr/art/mapas/generar_trono_huesos.js` | `node art/mapas/generar_trono_huesos.js` (no pisa uno editado; `--forzar`) |
| Tileset, vela y puerta del Trono | `gpr/art/sprites/mundo/crear_trono_huesos.lua` | `aseprite -b --script-param dir=art/sprites/mundo --script-param png=public/assets/mundo --script …` |
| Fondos de combate | `crear_fondo_catacumbas.lua`, `crear_fondo_trono_huesos.lua` | Aseprite; copiar las 5 capas a `public/assets/combate/fondos/<zona>/` |
| Monstruos (sprites) | `gpr/art/sprites/enemigos/crear_enemigos_catacumbas.lua` | Aseprite con `solo=clave1,clave2`; sumar a `enemigos.json` |
| Míticos | `gpr/art/sprites/enemigos/crear_miticos.lua` | Aseprite (`dir`, `png`) |
| NPCs, retratos y puntos de misión | `crear_npcs_misiones.lua`, `crear_puntos_mision.lua` | Aseprite |
| Íconos de objetos | `gpr/art/sprites/combate/crear_objetos.lua` | Aseprite; el orden tiene que coincidir con `OBJETOS` de `gear.js` |
| Recursos del mapa | `crear_recursos8.lua` | Aseprite |
| Monstruos y equilibrio (SQL) | `gpr/_respaldo_claude/catacumbas/gen_catacumbas.js` + `scripts/equilibrio/generar.js` | `node … > catacumbas_monstruos.sql` |
| Equipo (SQL) | `gen_equipo_catacumbas.js`, `gen_escalera_catacumbas.js` | ídem |
| Comidas (SQL) | `gen_comidas_catacumbas.js` | ídem |
| Misiones (SQL) | `gen_misiones_catacumbas.js` | ídem; revisar con `node _respaldo_claude/catacumbas/revisar_misiones.js 6` |
| Pruebas por API | `probar_combates.js`, `probar_taller.js`, `probar_misiones.js`, `probar_trono.js`, `probar_tanda6.js` | con el back temporal en 5098 (`POSICION_LIBRE=1`); dejan a Brisa como estaba |

Los generadores y las pruebas están en `gpr/_respaldo_claude/catacumbas/`, que **no se sube al repo**.

**Front:**
- `game/dialoguesCatacumbas.js`, `game/world/llama.js`.
- `game/story.js` (`|`), `game/questGivers.js`, `game/gear.js`, `game/audio.js`.
- `game/world/shared.js`, `game/world/refuges.js`, `game/world/mythic.js`.
- `pages/World.js`, `components/world/BagPanel.js`, `components/world/Battle.js`.
- `game/BattleScene.js`, `game/atlas.js`.

**Back:**
- `lib/eleccion.js`, `lib/trono_huesos.js`, `lib/barca.js`, `lib/mythic.js`, `lib/exploracion.js`.
- `lib/cercania.js`, `lib/questSteps.js`, `lib/worldNodes.js`, `lib/fuentes.js`.
- `routes/players.js` (la regla de la elección, la Vela de Sebo), `routes/world.js` (la barca).

---

## 15. Tandas

1. Tileset, mapa, Vela Eterna y las dos entradas (la Cripta Congelada y la Catedral).
2. Monstruos, sprites, fondo de combate y equilibrio.
3. Recursos, equipo, crafteo, sets de jefe y comida.
4. NPCs, misiones, diálogos y fases (con el final de Velkan).
5. El Trono de Huesos.
6. La oscuridad, la barca de Óbolo, el mítico, la música y los secretos.

Todas están hechas y subidas. Lo que queda para después:
- los maestros de evolución de los Velados;
- los huevos y sobres por zona;
- la salida a la zona 7 (con las Ruinas).

## 16. Registro de cada tanda

**Tanda 1 — tileset, mapa, Vela Eterna y las dos entradas: hecha** (subida en `gpr` 71bd3fd y `gprback` ccca5ba).

- **Tileset v10** (`art/sprites/mundo/crear_mundo.lua`, al final): 254 tiles nuevos (1671 en total; los
  1417 viejos, comprobados idénticos píxel a píxel). Terrenos: `losac` (losas de catacumba, el suelo de
  base), `muroc` (pared: techo con borde automático y cara con nichos de cráneos y velas), `tierrac`,
  `huesosc`, `hongos` (que brillan), `aguan` (agua negra, choca), `rioalma` (río de almas, choca),
  `osario` (el «pasto» de los combates), `losavel` (losas de Vela Eterna), `puentec` (puente de hueso) y
  `muellec` (muelle del barquero). Objetos: sarcófago, ataúd, estatua velada, columna, hongo gigante,
  altar profanado, lámpara de alma (refugio), barca, Gran Vela, mausoleos (dos), forja de hueso, casa de
  Ilse, puesto de reliquias, estantería y atril, la entrada del Trono de Huesos, las escaleras de subida
  (helada y de la Catedral), la cripta sellada de la Catedral (para Aurelia) y deco chica (pila de
  cráneos, urna, velas, candelabro, telaraña, hongos chicos, cadenas, lápida). Paleta nueva `cs*`, `te*`,
  `hu*`, `hg*`, `ag*`, `al*`, `cw*`, `vl*`, `vc*`; estilo de muro `cripta` y la opción `noWin` de los
  edificios.
- **Editor** (`src/editor/rules.js`): los 11 terrenos con sus pinceles. La tierra, los huesos y el osario se
  funden entre sí; la pared muestra su cara donde abajo hay suelo (con nichos y velas al azar).
- **Mapa** (`art/mapas/generar_catacumbas.js` → `public/assets/mundo/catacumbas/`): zona propia fuera del
  continente (`interior: true`, `zona: 6`), 14 subzonas (13 con niveles, 76-85) talladas como cavernas
  unidas por galerías, con el Abismo de las Almas (puentes colgantes), el Río de las Almas (puentes de
  hueso), el Lago Negro (muelles e islotes), el Jardín de Hongos, el Osario, la Biblioteca (estanterías),
  el Santuario Profanado (altar), la Sala del Sexto Sello (círculo de estatuas veladas) y la entrada del
  Trono de Huesos. 17 lámparas de alma (refugios) y 31 grupos de monstruos pensados (apagados hasta la
  tanda 2: `COMBATES_LISTOS = false`). El generador comprueba que desde la llegada se llegue caminando a
  todas las subzonas y a los puntos importantes. Música: por ahora la de la Cripta del Vigía (`cripta`).
- **Vela Eterna:** la Gran Vela en el medio de la plaza (enfermería), la forja de hueso, la casa de Ilse,
  cuatro mausoleos, el puesto de Hollin, dos estatuas veladas, candelabros, dos lámparas de alma y el
  estanque del barquero con su muelle y la barca.
- **Las dos entradas:**
  - **Cripta Congelada:** escalera al fondo de la tumba de la reina (13-14, 58), sellada hasta entregar la
    T14, cualquiera de las dos (`generar_cripta_congelada.js`). Llega a la Escalera Helada (140, 5).
  - **Catedral de Aurelia:** la cripta sellada entre la Catedral y la capilla (63-65, 10-12), agregada a
    mano en `aurelia/chunk_1_0.json` (el mapa está editado). Sellada hasta la A5
    (se abre desde su paso 3; ver la tanda 4). Se le
    actualizó la lista de choques del tileset a ese trozo (solo se agregaron los tiles nuevos).
- **Pasos cerrados por la historia** (front): una `salida` puede llevar `fase` (como los NPCs) y `sellada`
  (el aviso). Las fases aceptan «una u otra» con `|` (`TUNDRA_HISTORIA_14_PERDON|TUNDRA_HISTORIA_14_JUSTICIA`).
  Al chocar con un paso cerrado, el héroe da un paso atrás y sale el aviso.
- **Back:** `ZONES.catacumbas` y `ZONE_IDS.catacumbas` (`lib/exploracion.js`, premio por explorarla entera
  7500 de oro y 19000 de experiencia), `ZONE_ID_OF_DIR` (`routes/players.js`).
- **Front:** cartel al entrar («Bajo tierra · Catacumbas del Abismo») y el texto de cómo se llega en el mapa
  del mundo (`game/atlas.js`, también el de las Ruinas).
- **Probado por API:** descubrir Vela Eterna en las Catacumbas da su experiencia y el mapa la muestra (14
  subzonas); una subzona que no existe no cuenta. Brisa quedó como estaba.

**Tanda 2 — monstruos, sprites, efectos, fondo de combate y combates encendidos: hecha** (subida en `gpr` 71bd3fd y `gprback` ccca5ba).

- **Monstruos** (`gpr/_respaldo_claude/catacumbas/gen_catacumbas.js` → `catacumbas_monstruos.sql`, ya al final
  de `db/schema.sql` y de `db/pendiente_supabase.sql`, repetible): 12 comunes (76-85: los 5 viejos renovados
  y 7 nuevos), 2 raros (Gusano de las Criptas y Caballero sin Rostro) y los 4 jefes de la historia: el
  Guardián del Abismo (78) y el Archimago Corrupto (82) pasan de raros a minijefes, el Centinela de la
  Muerte (84) y el Lich Ancestral (85). 13 habilidades nuevas (con veneno, sangrado, cadenas que atan,
  debilidad y el grito de las almas) y 20 materiales (los 5 viejos conservan su código; los de los
  recursos del mapa, `HUESO_ANTIGUO`, `SETA_PALIDA`, `PLATA_SEPULCRAL`, `CERA_ETERNA` y `ESENCIA_DE_ALMA`,
  quedan creados para la tanda 3). El nuevo de magia de la Antesala se llama **Inquisidor del Eclipse**
  (`ACOLITO_ECLIPSE` ya era de la Pradera) y el del Lich es el `CORAZON_LICH_ANCESTRAL` que ya existía.
- **Equilibrio** (`scripts/equilibrio/generar.js`): perfiles de los 18 y `simulateCatacumbas`, que no cuenta
  los sets viejos `_CATACUMBAS` y `_LICH` (son de antes de la escalera: su arma tiene 147 de ataque contra
  1251 la del Rey del Hielo). Con el equipo del Rey del Hielo, los comunes caen en ~3 turnos y aguantas
  5-15 golpes; con el equipo nuevo de la tanda 3 se les sube la vida, como en la Tundra.
- **Sprites** (`gpr/art/sprites/enemigos/crear_enemigos_catacumbas.lua` → `enemigos/zona6/` y
  `public/assets/sprites/combate/enemigos/`): los 18 con sus 5 animaciones, en `enemigos.json`.
- **Efectos** (`crear_efectos_monstruos.lua`, ahora 105): las 13 habilidades nuevas, al final de la lámina
  (las de antes no cambian de cuadro), y las paletas `espora` y `alma`.
- **Fondo de combate** (`art/sprites/mundo/crear_fondo_catacumbas.lua` → `combate/fondos/catacumbas/`):
  muro de nichos con cráneos, el arco del medio con la luz azul del Río de las Almas, columnas con velas,
  losas con huesos regados. `ZONE_BACKGROUND[6] = 'catacumbas'`.
- **Mapa:** `COMBATES_LISTOS = true`: 31 grupos y los jefes `puerta_guardian_abismo` (140,30),
  `biblioteca_archimago` (60,15), `paso_centinela` (36,14) y `sello_lich` (20,14). A la Sala del Sexto
  Sello se llega por la Biblioteca (la galería desde la Antesala la corta la pared del Trono).
- **Probado por API** (`_respaldo_claude/catacumbas/probar_combates.js`): los 31 grupos arrancan con sus
  monstruos y niveles, los 4 jefes arrancan, y un combate común se gana. Brisa quedó como estaba y se
  borraron los combates de prueba.
- **Ojo:** la primera línea de `pendiente_supabase.sql` es el final suelto de una sentencia cortada
  (`AND d.drop_chance_percent <> …`): hay que borrarla antes de correr el archivo.

**Tanda 3 — recursos, equipo y crafteo, sets de jefe, comidas y venta: hecha** (subida en `gpr` 71bd3fd y `gprback` ccca5ba).

- **Recursos** (6 tipos, 51 sitios en 26 nodos): `pila_huesos` (Hueso Antiguo), `setas_palidas`, `veta_plata`
  (Plata Sepulcral), `candelabro_olvidado` (Cera Eterna), `pozo_almas` (Esencia de Alma) y `sarcofago_tesoro`
  (el cofre: oro, pociones y a veces un Diente de Gusano o un Yelmo Vacío). Arte en
  `gpr/art/sprites/mundo/crear_recursos8.lua` (`recursos8.png`, cargado en el juego y en el editor); qué da
  cada uno en `lib/worldNodes.js`; sus sitios los pone el generador del mapa, que también escribe
  `lib/worldNodes.zonas.json["6"]`.
- **Equipo** (`_respaldo_claude/catacumbas/gen_equipo_catacumbas.js` + `gen_escalera_catacumbas.js`), en la
  Forja de Hueso de Vela Eterna (`forja_vela` en `lib/cercania.js`, servicios `forja` y `taller`; artesano
  Osmund):
  | Tier | Código | Nivel | Qué pide |
  |---|---|---|---|
  | de las Catacumbas | `_CATACUMBAS` (piezas viejas, recetas rehechas) | 76 RARO 90% | ratas, murciélagos, esqueletos, zombies, arañas; hueso antiguo, plata, cera y setas |
  | Sepulcral | `_SEPULCRAL` (nuevo) | 81 ÉPICO 80% | gules, almas, cadáveres, sacerdotes + **Diente de Gusano** o **Yelmo Vacío** |
  | del Trono | `_TRONO` (armas nuevas) | 82 LEGENDARIO 75% | **Corona de Huesos** + Plata Sepulcral Pura (el Trono de Huesos, tanda 5) |
  | del Centinela | `_CENTINELA` (set nuevo, con joyas) | 84 ÉPICO 70% | pergamino del Centinela (17,5%) + **Núcleo del Centinela** |
  | del Lich | `_LICH` (set viejo) | 85 LEGENDARIO 55% | pergamino del Lich (12,5%) + **Corazón del Lich Ancestral** |
  La forma de cada pieza sale de su par del Volcán, como en la Tundra. Las armas siguen la escalera sobre
  las del Guardián y el Rey del Hielo (+7% comunes, +9% de mazmorra y jefe). Los sets de jefe piden la mitad
  de materiales. El Lich además suelta Dientes de Gusano, Yelmos Vacíos y a veces un Núcleo del Centinela.
- **Equilibrio:** con el equipo nuevo los comunes caían en 2-3 turnos; se les subió la vida (×1,3 a ×1,5,
  más a los de las últimas subzonas): ahora ~3,1-3,9 turnos para matar (4 redondeado; el Pícaro ~3) y 5-13
  golpes aguantados, como la Tundra (`node scripts/equilibrio/generar.js --simular --detalle`).
- **Comidas** (Ilse; `gen_comidas_catacumbas.js`): Sopa de Setas Pálidas, Pan de Ofrenda, Pescado Ciego
  Asado, Guiso del Sepulturero, Caldo de Hueso Antiguo y, de alquimia, Té de Cera Eterna y Vino de los
  Velados. El Gusano suelta Carne de Gusano y los Gules, Pescado Ciego. La cocina de Ilse es `posada_vela`.
- **Arte:** 34 íconos nuevos en `crear_objetos.lua` (los 27 materiales de la zona y las 7 comidas; los 194
  de antes, idénticos) y los sets de color `sepulcral`, `trono` y `centinela` (`crear_equipo.lua`, `gear.js`).
- **Otros:** `sell_zone_mult` ×6 para lo de las catacumbas, `ZONE_NAMES[6]` en `lib/fuentes.js`,
  `balance_versions 'catacumbas_v1'`.
- **Probado por API** (`_respaldo_claude/catacumbas/probar_taller.js`, con Brisa a nivel 85): el pergamino del
  Centinela enseña sus 8 recetas; se fabricaron una pieza de las Catacumbas, un arma Sepulcral, un arma del
  Trono, una pieza del Centinela y el Guiso del Sepulturero; se recolectó en los 6 tipos de recurso;
  «¿Dónde?» de la Plata Sepulcral lista sus monstruos y vetas. Brisa quedó como estaba. El bloque de la zona
  6 de `pendiente_supabase.sql` se aplicó dos veces sin errores.
- **Pendiente para otras tandas:** la Corona de Huesos y la Plata Sepulcral Pura las suelta el Trono de
  Huesos (tanda 5, hecha); Osmund, Ilse y Hollin en el mapa (tanda 4). Para fabricar hay que tener la
  zona 6 desbloqueada (se desbloquea con el primer combate ganado contra un monstruo de las Catacumbas).

**Tanda 4 — NPCs, misiones, diálogos, fases y el final de Velkan: hecha** (subida en `gpr` 71bd3fd y `gprback` ccca5ba).

- **La regla de la elección** (`lib/eleccion.js`): `previaCumplida` y `cumplidasPorRival`. Una misión que pide
  una de las dos de una elección (la T14) también se abre con la otra. `routes/players.js` lo usa en la lista,
  al aceptar y al entregar. Así la A1 se abre con *El perdón* o con *La justicia*.
- **Misiones** (`_respaldo_claude/catacumbas/gen_misiones_catacumbas.js` → `catacumbas_misiones.sql`):
  - **Historia:** A1-A14. Las viejas Centinela de la Muerte y Lich Ancestral pasan a ser la A10 y la A13, con
    el mismo código.
  - **Secundarias:** 14 nuevas (Osvaldo 1-3, Velas, Barquero, Reliquias 1-2, Cocina, Trueno, Nichos 1-2,
    Forjas y las dos viejas, ahora secundarias).
  - **Diarias:** 13 (3 nuevas y las viejas de la zona, cada una con su NPC).
  - **Objetos de misión:** 9.
  - **La A11** tiene una emboscada con **Velkan** (monstruo nuevo, nv 84, con su sprite) y dos inquisidores.
    Después hablas con `velkan_herido` junto al altar. Si en la Tundra elegiste *El perdón*, Velkan se queda
    en Vela Eterna con su padre (`velkan_vela`). Si elegiste *La justicia*, muere protegiendo a Aldren.
    Las entregas de la A11 no cambian; lo que cambia es lo que dicen después Aldren, Liora y el propio Velkan.
- **NPCs en el mapa** (`generar_catacumbas.js`):
  | NPC | Lugar | Cuándo aparece |
  |---|---|---|
  | Liora | Gran Vela (98,43) | siempre |
  | Osmund | forja (87,37) | siempre |
  | Ilse | su casa (112,37) | siempre |
  | Hollin (`mercader_vela`) | plaza (109,47) | siempre |
  | Óbolo | muelle | siempre |
  | Aldren (`aldren_vela`) | (95,44) | desde la A5 |
  | Velkan | (94,46) | después de la A11, solo con *El perdón* |
  | Velkan herido | Santuario | paso 4 de la A11 |
  | Don Osvaldo | Nichos | hasta terminar su cadena |

  Sprites de caminar y retratos en `crear_npcs_misiones.lua` (razas `velado` y `esqueleto`). Los puntos de
  misión nuevos (reja oxidada, espejo roto, moneda en el barro y Trueno entre los hongos) están en
  `crear_puntos_mision.lua`.
- **Diálogos** (`src/game/dialoguesCatacumbas.js`, sumado en `dialogues.js`): cada NPC habla según tu
  historia. En `questGivers.js` está dónde vive cada uno. Desde los NPCs se abren estas ventanas:
  - Osmund: forja y encantador.
  - Ilse: cocina.
  - Hollin: comercio.
- **Tienda de Hollin** (`catacumbas_mercader.sql`): `MERCADER_VELA`, solo en la zona 6. Vende lo de la zona
  a 315.
- **Back:** `NPC_HOMES` de los 9 NPCs (`lib/questSteps.js`) y `mercader_vela` en los artesanos
  (`lib/cercania.js`).
- **La puerta de la Catedral** (Aurelia, `chunk_1_0`) se abre desde el paso 3 de la A5:
  `CATACUMBAS_HISTORIA_05_CATEDRAL@3+|CATACUMBAS_HISTORIA_05_CATEDRAL`.
- **SQL:** el bloque «tanda 4» está al final de `schema.sql` y de `pendiente_supabase.sql`. Los monstruos de
  la tanda 2 se reemplazaron por los regenerados, que traen a VELKAN. Ojo con el orden: el bloque de
  monstruos borra los botines de la zona, y el de comidas (tanda 3), que va después, vuelve a poner la carne
  y el pescado. Todo el bloque de la zona 6 se aplicó dos veces seguidas sin errores.
- **Revisado** (`revisar_misiones.js 6`): 41 misiones, 119 pasos y 26 puntos en el mapa, sin problemas.
- **Probado por API** (`_respaldo_claude/catacumbas/probar_misiones.js`, con Brisa):
  - Sin la T14, la A1 no aparece y no se puede aceptar. Con *La justicia* sí, y se completa de punta a
    punta.
  - La A11 completa: escolta, emboscada con Velkan ganada, Velkan herido, Aldren y entrega.
  - La tienda de Hollin aparece estando en las Catacumbas y vende.

  Brisa quedó como estaba.
- **Pendiente:**
  - ~~La A9 lleva al Trono de Huesos, pero todavía sin jefe~~ (hecho en la tanda 5).
  - ~~La barca de Óbolo~~ (hecha en la tanda 6).
  - Los maestros de evolución de los Velados.

**Tanda 5 — el Trono de Huesos: hecha** (subida en `gpr` 71bd3fd y `gprback` ccca5ba).

- **Back:** `lib/trono_huesos.js` usa el molde de `lib/mazmorra.js` y está registrado en `lib/mazmorras.js` y
  en `server.js`. Es de nivel 80-84.
  - **Guardianes:** el servidor los siembra solo la primera vez que alguien entra (código `TRONOH_…`).
    - el Bufón de Hueso, en la Galería del Bufón, con un guardia;
    - la Guardia Real Esquelética, en el Puente de Costillas, de a dos;
    - la Doncella Velada, en su cámara, con el Bufón.
  - **Puntos de control:** dos velas negras («Encender»).
  - **Jefe: el Coloso de Huesos.** Su escudo cambia de Luz a Fuego. Cada 3 turnos levanta el **Garrote de
    los Mil** sobre un héroe: si ese héroe no se defiende, pierde la mitad de la vida.
  - **Botín:**
    - Plata Sepulcral Pura en todos.
    - Del Coloso: Corona de Huesos (50%).
    - Cofre cada 3 h: pociones, una pieza Sepulcral de tu clase o Coronas.
  - **Entrada:** con la A8 entregada (la Llave de Hueso) o la A9 completa.
  - La vida de los guardianes sigue la proporción de la Cripta Congelada.
  - La mazmorra no necesita SQL propio: crea sus tablas y sus monstruos al usarse.
- **A9:** ahora baja de verdad, en 5 pasos:
  1. llegar al arco;
  2. escuchar;
  3. derribar al Coloso;
  4. escuchar a la Doncella Velada, ya libre, junto al trono (dentro del Trono);
  5. volver con Liora.

  Se reemplazó el bloque de misiones de la tanda 4 en `schema.sql` y `pendiente_supabase.sql`.
- **Arte:**
  - `crear_trono_huesos.lua`:
    - tileset con losas violáceas y paredes con fémures y nichos de cráneos;
    - el pozo de huesos con almas y el puente de costillas;
    - columnas de hueso con oro, ataúdes abiertos, ofrendas de velas negras y pilas de cráneos;
    - estatuas de sacerdotes velados y el trono;
    - la vela negra y la Puerta de Hueso.
  - `crear_fondo_trono_huesos.lua` (fondo de combate): el trono en el arco del medio, columnas de hueso y
    la alfombra roja.
  - Los 4 monstruos están en `crear_enemigos_catacumbas.lua`.
  - Mapa: `art/mapas/generar_trono_huesos.js`, con el mismo plano que la Cripta Congelada.
  - Música `trono_huesos`, una marcha fúnebre con órgano, en `game/audio.js`.
- **Catacumbas:** la entrada es la casilla de abajo en el medio del arco de cráneos (20,35). Al salir vuelves
  a (20,37).
- **Probado por API** (`_respaldo_claude/catacumbas/probar_trono.js`, con Brisa):
  - Sin nivel no se entra; con la A8 entregada y nivel 83, sí.
  - El paso de jefe de la A9 queda enlazado con el Coloso.
  - Se encendió una vela. La puerta sigue cerrada hasta vencer a los tres guardianes.
  - Se ganó contra el Bufón, que soltó Plata Sepulcral Pura y Hueso Reanimado.
  - El Coloso arrancó con su escudo de Luz y soltó la Corona de Huesos y Plata Pura. El cofre dio una
    pieza Sepulcral.
  - El paso de la A9 contó al derribarlo.

  Brisa quedó como estaba. `revisar_misiones.js 6` no da problemas, y el bloque de la zona 6 se aplicó dos
  veces seguidas sin errores.

**Tanda 6 — la oscuridad, la barca de Óbolo, Morgath, la música y los secretos: hecha** (subida en `gpr` 71bd3fd y `gprback` ccca5ba). Con
esto las Catacumbas quedan completas.

- **La oscuridad** (`gpr/src/game/world/llama.js`): fuera de Vela Eterna la **llama** del héroe baja de 100
  a 0 en unos 4 minutos. Mientras Morgath anda suelta por las Catacumbas, baja ×1,5.
  - Se vuelve a encender junto a una **lámpara de alma** (los 17 refugios, que ahora se llaman «la lámpara de
    alma de…») y en Vela Eterna.
  - La **Vela de Sebo** la llena donde sea. Hollin la vende a 90, e Ilse fabrica tres con una Cera Eterna y
    una Carne de Gusano. Se usa desde la mochila: el servidor gasta la vela (`/use-item`) y avisa al juego.
    En combate no aparece.
  - Con la llama apagada quedas **A oscuras**: tu luz se achica mucho, la pantalla se oscurece y los
    combates en el osario salen ×1,6. No quita vida.
  - El HUD muestra la barra junto a los bufos (porcentaje y aviso cuando baja de 25%). La llama se guarda
    por pestaña.
- **La barca de Óbolo** (`lib/barca.js`, `POST /world/barca`): viaje rápido entre el muelle de Vela Eterna,
  el muelle del Lago Negro y la orilla del Río de las Almas.
  - Cuesta «una moneda»: 40 de oro.
  - Solo va a paradas de subzonas que ya pisaste.
  - En cada parada está el mismo Óbolo (`obolo`, `barca_lago`, `barca_rio`), que siempre llega antes que
    tú.
  - El diseño decía «el Jardín de Hongos», pero el jardín no tiene agua; quedó el Lago Negro.
- **Mítico:** Morgath, la Polilla de la Vela Negra (`MITICOS[6]` en `lib/mythic.js`).
  - 50000 de vida, nivel 76-85, con 6 lugares donde puede aparecer (nunca en Vela Eterna).
  - Sus esbirros son las polillas de ceniza.
  - Los sprites están en `crear_miticos.lua`; los míticos de antes salen idénticos.
  - En el mapa, su rastro es morado y gris (`game/world/mythic.js`).
- **Música** `catacumbas` (`game/audio.js`): un coro lejano, un bajo quieto y una campana que suena sola.
  El mapa ya no usa la de la Cripta del Vigía.
- **Secretos** (`lib/exploracion.js` SECRETS):
  - la tumba del primer Vigía, en el rincón más hondo de la Cripta de la Catedral;
  - el escondite de Velkan de chico, en la punta de los Nichos;
  - la barca hundida, al final del muelle viejo del Lago Negro.
- **Arte:** el ícono de la Vela de Sebo (`crear_objetos.lua`; los 228 de antes, idénticos).
- **SQL:** el bloque «tanda 6» (`catacumbas_oscuridad.sql`) está al final de `schema.sql` y de
  `pendiente_supabase.sql`.
- **Probado por API** (`_respaldo_claude/catacumbas/probar_tanda6.js`, con Brisa):
  - La barca va al Lago Negro y cobra 40. Sin oro o a una parada que no existe, da error.
  - Hollin vende la vela, Ilse fabrica 3 y usarla gasta una y enciende la llama.
  - Los tres secretos dan su premio y no se abren dos veces.
  - Con una cacería de Morgath forzada (borrada al terminar), aparece en uno de sus lugares, el estado
    público la muestra y los combates contra una polilla y contra Morgath arrancan. Fuera de la cacería,
    no.

  Brisa quedó como estaba y no quedó ninguna cacería. El bloque de la zona 6 se aplicó dos veces sin
  errores. La oscuridad, la luz y el HUD son del cliente: no se probaron en el navegador.
