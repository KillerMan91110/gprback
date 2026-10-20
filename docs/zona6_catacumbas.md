# Zona 6 · Catacumbas del Abismo (76-85) — «El primer traidor»

Diseño de la zona, como `zona5_tundra.md`. Sale de `historia_etheria.md` (zona 6) y `mapa_etheria.md`. Si
el código no coincide con esto, manda el código.

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
  como las demás, con `interior: true` y `zona: 6`. La escena ya sabe cargar sola una zona que no está
  en el continente (como las mazmorras): al cruzar una salida se reinicia en la zona nueva.
- **Primera entrada: la escalera sellada al fondo de la Cripta Congelada** (la tumba de la reina «baja al
  abismo»). Se abre cuando entregaste la T14, cualquiera de las dos (El perdón o La justicia). Se llega a
  la **Escalera Helada**, arriba a la derecha del mapa.
- **Atajo de vuelta: la puerta sellada bajo la Catedral de Aurelia.** Se abre desde abajo en la A5 (Elenya
  la abre del otro lado). Desde entonces se va y se vuelve de Aurelia caminando.
- **Salida a la zona 7:** el Trono de Huesos se abre al templo de las Ruinas (A14, cuando exista la zona 7).
- En el mapa del mundo (M) sigue apareciendo en «Más allá del mapa», con el texto de cómo se llega.

---

## 3. El mapa (4×4 trozos, norte arriba)

```
  ┌───────────────┬───────────────┬───────────────┬───────────────┐
  │ SALA DEL      │ BIBLIOTECA    │ ABISMO DE LAS │ ESCALERA      │
  │ SEXTO SELLO   │ PROHIBIDA     │ ALMAS         │ HELADA        │
  │ (84-85) Lich  │ (82-84)       │ (81-83)       │ (76-77) ⇡Cripta│
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ TRONO DE      │ SANTUARIO     │  VELA ETERNA  │ OSARIO DE     │
  │ HUESOS ⛩      │ PROFANADO     │  (la ciudad)  │ LOS REYES     │
  │ (83-85)       │ (80-82)       │               │ (77-79)       │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ RÍO DE LAS    │ JARDÍN DE     │ NICHOS DE LOS │ GALERÍA DE    │
  │ ALMAS (82-84) │ HONGOS (79-81)│ SACERDOTES    │ LAS MÁSCARAS  │
  │               │               │ (78-80)       │ (77-79)       │
  ├───────────────┴───────────────┼───────────────┼───────────────┤
  │   LAGO NEGRO (agua quieta,    │ CRIPTA DE LA  │ CAMINO DE LA  │
  │   el barquero de almas)       │ CATEDRAL      │ CATEDRAL      │
  │   (80-83)                     │ (76-78)       │ ⇡ Aurelia     │
  └───────────────────────────────┴───────────────┴───────────────┘
```

Se entra por la derecha (la Escalera Helada arriba, el Camino de la Catedral abajo) y se avanza hacia el
oeste: cada subzona un poco más alta. Vela Eterna queda en el medio, a la mano de las dos entradas. Lo
más hondo (el Trono de Huesos y la Sala del Sexto Sello) queda en el rincón oeste.

**Bajo tierra todo es pasillo y sala:** las subzonas son salas grandes de piedra unidas por galerías,
con paredes de catacumba (nichos con cráneos y velas) en vez de bordes de mar o montaña.

**Terrenos nuevos (tileset v10):** losas de catacumba (el suelo de base), pared de catacumba con su cara
de nichos, tierra de tumba, huesos regados, hongos pálidos que brillan, agua negra (choca) y el agua de
almas del río (choca, brilla). Se reusan el abismo y los puentes colgantes de las Montañas.
**Objetos:** sarcófagos, urnas, pilas de cráneos, candelabros y montones de velas (luces), estatuas de
sacerdotes velados, columnas, ataúdes abiertos, cadenas, telarañas, altares profanados, hongos gigantes,
lámparas de alma (los refugios), los mausoleos de Vela Eterna, la Gran Vela, la entrada del Trono de
Huesos, la escalera de subida a la Cripta y la puerta de la Catedral.

---

## 4. Lo que la hace única

- **La oscuridad.** Bajo tierra no hay día: la escena es oscura y el héroe lleva su propia luz. Fuera de
  Vela Eterna, la **llama** del héroe se va gastando (una barra, como el calor de la Tundra). Las
  **lámparas de alma** (los refugios de cada subzona) y Vela Eterna la vuelven a encender, y la **Vela de
  Sebo** (se compra o se fabrica) la llena donde sea. Con la llama apagada quedas **A oscuras**: ves
  mucho menos alrededor y los muertos te encuentran antes (más combates). No quita vida.
- **El barquero de almas:** Óbolo cruza el Lago Negro y el Río de las Almas en su barca (viaje rápido,
  como los botes de las Costas y los trineos de la Tundra): Vela Eterna, el Jardín de Hongos y el Río.
- **Los Velados:** la ciudad es de espíritus. Se ven medio transparentes y algunos solo aparecen según tu
  historia (los que vas liberando).
- **Padre e hijo:** Velkan es el hijo de Aldren. Su final depende de lo que elegiste en la Tundra (ver
  sección 12).

---

## 5. Monstruos

Se **reusan los 5 comunes que ya existen** (Esqueleto Guerrero, Zombie Anciano, Cadáver Reanimado,
Fantasma Encadenado, Sacerdote Maldito) repartidos por subzona y nivel, y se agregan 7.

| Monstruo | Código | Nivel | Dónde | Tipo · elemento | Material |
|---|---|---|---|---|---|
| Rata de Osario *(nueva)* | `RATA_OSARIO` | 76-78 | Escalera, Cripta de la Catedral | BESTIA · oscuro | Cola de Rata de Osario |
| Esqueleto Guerrero | `ESQUELETO_GUERRERO` *(existe)* | 76-79 | Osario, Galería | MUERTO_VIVIENTE | Hueso antiguo |
| Murciélago Vampiro *(nuevo)* | `MURCIELAGO_VAMPIRO` | 77-79 | Galería, Escalera | BESTIA · viento | Ala de Murciélago |
| Zombie Anciano | `ZOMBIE_ANCIANO` *(existe)* | 77-80 | Nichos, Osario | MUERTO_VIVIENTE | — |
| Araña de Tumba *(nueva)* | `ARANA_TUMBA` | 78-80 | Nichos, Jardín | BESTIA · veneno | Seda de Tumba |
| Hongo Pálido *(nuevo)* | `HONGO_PALIDO` | 79-81 | Jardín de Hongos | PLANTA · tierra | Esporas Pálidas |
| Fantasma Encadenado | `FANTASMA_ENCADENADO` *(existe)* | 80-82 | Santuario, Lago | ESPECTRO | — |
| Gul Hambriento *(nuevo)* | `GUL_HAMBRIENTO` | 80-83 | Lago Negro, Santuario | MUERTO_VIVIENTE | Garra de Gul |
| Cadáver Reanimado | `CADAVER_REANIMADO` *(existe)* | 81-83 | Abismo, Río | MUERTO_VIVIENTE | — |
| Alma en Pena *(nueva, magia)* | `ALMA_EN_PENA` | 81-84 | Río de las Almas, Abismo | ESPECTRO · oscuro | Lamento Cristalizado |
| Sacerdote Maldito | `SACERDOTE_MALDITO` *(existe)* | 82-84 | Biblioteca, Santuario | HUMANOIDE · oscuro | — |
| Inquisidor del Eclipse *(nuevo, magia)* | `INQUISIDOR_ECLIPSE` | 83-85 | Antesala del Trono, Sexto Sello | HUMANOIDE · oscuro | Sello del Eclipse Negro |
| **Gusano de las Criptas** (raro) | `GUSANO_CRIPTA` *(nuevo)* | 80-83 | Jardín y Lago (aparece poco) | BESTIA | **Diente de Gusano** (llave del tier medio) |
| **Caballero sin Rostro** (raro) | `CABALLERO_SIN_ROSTRO` *(nuevo)* | 83-85 | Trono y Sexto Sello | MUERTO_VIVIENTE | **Yelmo Vacío** |
| **Guardián del Abismo** (minijefe) | `GUARDIAN_ABISMO` *(existe, hoy raro)* | 78 | puerta del Osario | MUERTO_VIVIENTE | historia (A3) |
| **Archimago Corrupto** (minijefe) | `ARCHIMAGO_CORRUPTO` *(existe, hoy raro)* | 82 | Biblioteca Prohibida | HUMANOIDE · oscuro | historia (A6) |
| **Centinela de la Muerte** (minijefe) | `CENTINELA_MUERTE` *(existe)* | 84 | Trono de Huesos (afuera) | MUERTO_VIVIENTE | Núcleo del Centinela + pergaminos |
| **Lich Ancestral** (legendario) | `LICH_ANCESTRAL` *(existe)* | 85 | Sala del Sexto Sello | MUERTO_VIVIENTE · oscuro | Corazón del Lich Ancestral + pergaminos |

El Guardián del Abismo y el Archimago dejan de salir en el pasto: son jefes de la historia.

**Mazmorra (ver sección 8):** el Bufón de Hueso, la Guardia Real Esquelética, la Doncella Velada y el
jefe, **el Coloso de Huesos**.

**Mítico:** **Morgath, la Polilla de la Vela Negra**: una polilla enorme hecha de sombra que busca la
llama de Vela Eterna para apagarla. Esbirros: polillas de ceniza.

---

## 6. Recursos, materiales y comida

| Recurso del mapa | Dónde | Da | Para qué |
|---|---|---|---|
| Pila de huesos | Osario, Galería, Nichos | `HUESO_ANTIGUO` | equipo, el «material base» de la zona |
| Setas pálidas | Jardín de Hongos, Lago, Nichos | `SETA_PALIDA` | pociones y comida |
| Veta de plata sepulcral (mineral) | Abismo, Biblioteca | `PLATA_SEPULCRAL` | equipo (el «metal» de la zona) |
| Candelabro olvidado | por todas partes | `CERA_ETERNA` | Velas de Sebo, encantar |
| Pozo de almas | Río de las Almas | `ESENCIA_DE_ALMA` | joyas, magia |
| Sarcófago | escondido | oro y reliquias | — |

**Comida** (la cocina de Ilse, la sepulturera; los Velados no comen): Sopa de Hongos Pálidos, Pan de
Ofrenda, Guiso del Sepulturero, Té de Cera (calienta y da luz), Pescado Ciego del Lago Negro y el Vino
de los Velados.

---

## 7. Equipo y crafteo (escalera v2/v3)

En la **Forja de Hueso** de Vela Eterna (Osmund, el herrero velado):

| Tier | Código | Nivel | Qué pide |
|---|---|---|---|
| de las Catacumbas | `_CATACUMBAS` (se repasan las piezas viejas, si hay) | 76 RARO | comunes de la Escalera, el Osario y la Galería; hueso antiguo, plata sepulcral |
| Sepulcral | `_SEPULCRAL` (nuevo) | 81 ÉPICO | arañas, gules, almas + **Diente de Gusano** o **Yelmo Vacío** |
| del Trono (armas) | `_TRONO` (nuevo) | 82 LEGENDARIO | **Corona de Huesos** + Plata Sepulcral Pura (el Trono de Huesos) |
| del Centinela | set nuevo con los pergaminos del Centinela | 84 ÉPICO | pergamino + Núcleo del Centinela |
| del Lich | `_LICH` (pergaminos, si existen) | 85 LEGENDARIO | pergamino + Corazón del Lich Ancestral |

Sets de color nuevos `sepulcral`, `trono` y `lich`.

---

## 8. La mazmorra: el Trono de Huesos (80-84)

- **Qué es:** la corte del Lich. Una sala del trono hecha con los huesos de los sacerdotes que traicionó.
- **Se abre con:** la A8 (la Llave de Hueso que te da Liora).
- **Puntos de control:** velas negras («Encender»).
- **Tres guardianes:** el Bufón de Hueso, la Guardia Real Esquelética (de a dos) y la Doncella Velada
  (una Velada que el Lich ató a su servicio; al vencerla queda libre).
- **Jefe: el Coloso de Huesos**, armado con mil huesos de sacerdotes. Escudo que cambia de elemento y un
  golpe anunciado que se esquiva defendiéndose (como Escarcha).
- **Botín:** Corona de Huesos (armas del Trono), Plata Sepulcral Pura y piezas Sepulcrales de tu clase
  en el cofre (cada 3 horas).

---

## 9. Pueblo y NPCs: Vela Eterna (los Velados)

| NPC | Dónde | Quién es | Para qué |
|---|---|---|---|
| **Liora, la Primera Vela** | la Gran Vela | la sacerdotisa velada que encendió la vela hace mil años | historia principal |
| **Osmund, el herrero velado** | Forja de Hueso | forjaba las campanas del templo; ahora forja con huesos | equipo, encantar |
| **Ilse, la sepulturera** | su casa de madera, en Vela Eterna | una mujer viva que bajó a cuidar las tumbas de la Catedral; la única que cocina | comida |
| **Hollin, el mercader de reliquias** | la plaza | un saqueador de tumbas que se quedó a vivir (y a vender) | tienda propia (`MERCADER_VELA`) |
| **Óbolo, el barquero** | el muelle del Lago Negro | cobra una moneda por viaje, como manda la tradición | barca (viaje rápido) |
| **Aldren** | llega en la A5 | el anciano de la Aldea, último descendiente de los Vigías | historia, *Padre e hijo* |
| **Velkan (el Encapuchado)** | emboscadas; al final, según tu historia | el hijo de Aldren | historia |
| **Don Osvaldo** | los Nichos | un esqueleto que no sabe que está muerto | secundaria graciosa |
| **Elenya** (en Aurelia) | la Catedral | abre la puerta sellada; recibe el Sexto Fragmento | historia |

Maestros de evolución de los Velados (Nigromante, Exorcista): quedan para cuando se repasen las
evoluciones, como en las otras zonas.

---

## 10. Misiones

### Principales (A1-A14), después de la T14 (cualquiera de las dos)

| # | Nombre | Quién | Qué pasa |
|---|---|---|---|
| A1 | La escalera bajo la reina | Elenya | la reina sabía algo: bajar por la escalera sellada de la Cripta Congelada y llegar a la luz |
| A2 | Los que no descansan | Liora | encender tres lámparas de alma (aprendes la oscuridad) |
| A3 | El Guardián de las Catacumbas | Liora | el Guardián del Abismo, enloquecido por un cristal de eclipse (minijefe) |
| A4 | El Santuario Profanado | Liora | acólitos del Eclipse en el santuario: investigar; un sello con el nombre «Velkan» |
| A5 | La puerta bajo la Catedral | Ilse → Elenya | abrir la puerta sellada desde abajo; Aldren insiste en bajar contigo |
| A6 | El Archimago Corrupto | Aldren | en la Biblioteca Prohibida; antes de caer dice de dónde viene el Encapuchado |
| A7 | El nombre del hijo | Aldren | Aldren confiesa: Velkan es su hijo |
| A8 | La llave de hueso | Liora | Liora te da la Llave de Hueso |
| A9 | El Trono de Huesos | Liora | la mazmorra; liberas a la Doncella Velada |
| A10 | El Centinela de la Muerte | Liora | el Centinela que cierra el paso al Sexto Sello (minijefe) |
| A11 | Padre e hijo | Aldren | el encuentro con Velkan; su final según tu historia |
| A12 | La última vela | Liora | Liora gasta su luz para abrir la Sala del Sexto Sello |
| A13 | El Lich Ancestral | Liora | el Lich (legendario); el Sexto Fragmento; el Devorador ya despierta |
| A14 | Lo que el Lich dijo | Aldren → Elenya | llevar el fragmento a Elenya; el camino a las Ruinas |

### Secundarias (unas 16, en cadenas cortas)

*El esqueleto que no sabía que estaba muerto* (3, Don Osvaldo, graciosa); *Padre e hijo* (2, Aldren);
*Velas para los Velados* (recolección de cera para Liora); *El barquero cobra* (Óbolo y sus monedas
perdidas); *Reliquias* (2, Hollin: devolver lo saqueado o venderlo); *La cocina de Ilse* (hongos y
pescado ciego); *Trueno bajo tierra* (Gaspar, otra vez); *Los nombres de los nichos* (2, liberar Velados
leyendo sus nombres); *Tres forjas, otra vez* (Osmund y Brokk); *El eco de Hela* (según la T14).

### Diarias

3 nuevas (velas, gules, almas) y las viejas de la zona rehechas con su NPC.

---

## 11. Los demás sistemas

| Sistema | Qué lleva en las Catacumbas |
|---|---|
| Bestiario y cartas | entran solos |
| Huevos | huevos de mascota en los drops |
| Mítico | Morgath, la Polilla de la Vela Negra, en `MITICOS[6]` |
| Exploración | `ZONES.catacumbas`, premio por explorarla entera y 3 secretos (la tumba del primer Vigía, el nicho vacío de Velkan, la barca hundida) |
| Música | `catacumbas` (coro lejano y campanas) y `trono_huesos` |
| Fondos de combate | Catacumbas (nichos y velas) y Trono de Huesos |
| Viaje rápido | la barca de Óbolo |
| Encantador | Osmund |

---

## 12. Decisiones (con su valor por defecto)

1. **El final de Velkan:** propongo que dependa de la **T14**: si elegiste *El perdón*, Velkan se
   arrepiente y se queda con Aldren; si elegiste *La justicia*, muere protegiendo a su padre. Así la
   elección de la Tundra pesa también aquí. (La historia decía «según Tilo y Ren», pero eso no quedó como
   una elección clara en el juego.)
2. **La oscuridad:** más combates y menos visión, **sin daño** (la Tundra ya quita vida con el frío).
3. **La primera misión acepta cualquiera de las dos T14** (lo que quedó pendiente de la Tundra).
4. **Los huevos y sobres por zona** siguen aparte.

## 13. Tandas

1. Tileset, mapa, Vela Eterna y las dos entradas (la Cripta Congelada y la Catedral).
2. Monstruos, sprites, fondo de combate y equilibrio.
3. Recursos, equipo, crafteo, sets de jefe y comida.
4. NPCs, misiones, diálogos y fases (con el final de Velkan).
5. El Trono de Huesos.
6. La oscuridad, la barca de Óbolo, el mítico, la música y los secretos.

## 14. Estado (por tandas)

**Tanda 1 — tileset, mapa, Vela Eterna y las dos entradas: hecha** (sin commit).

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

**Tanda 2 — monstruos, sprites, efectos, fondo de combate y combates encendidos: hecha** (sin commit).

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

**Tanda 3 — recursos, equipo y crafteo, sets de jefe, comidas y venta: hecha** (sin commit).

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

**Tanda 4 — NPCs, misiones, diálogos, fases y el final de Velkan: hecha** (sin commit).

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
  - La barca de Óbolo (tanda 6).
  - Los maestros de evolución de los Velados.

**Tanda 5 — el Trono de Huesos: hecha** (sin commit).

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

**Tanda 6 — la oscuridad, la barca de Óbolo, Morgath, la música y los secretos: hecha** (sin commit). Con
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
