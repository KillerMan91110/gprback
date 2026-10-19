# Zona 4 · Costas Muertas (niveles 46-60) — "El barco sin bandera"

Diseño de la zona 4, hecho sobre `historia_etheria.md` (zona 4), `mapa_etheria.md` y el modelo del
Volcán (`zona3_volcan.md`). Se construye siguiendo `zona3_volcan_traspaso.md` (parte A). **Es un
borrador para que Marco lo apruebe antes de programar.** Las preguntas abiertas están al final.

---

## 1. La zona en una frase

Donde los ríos de lava del Volcán llegan al mar, la arena se vuelve negra y el agua hierve. Más al
sur está el **Puerto Antiguo**, el último puerto humano de Etheria, y pegada a él **Coralia**, la
aldea de palafitos de los **tritones**: los Ocultos los echaron del **Arrecife Hundido**, su ciudad
bajo el mar, cuando encadenaron ahí a la **Bestia de las Profundidades**, Guardiana del Cuarto
Sello. Cada noche se ve en la bruma un **barco sin bandera** con velas negras. En el puerto todos
culpan a los piratas del **Capitán Rhaegar**… pero Rhaegar es el único que lo está cazando.

- **Guardián corrompido (jefe legendario):** la Bestia de las Profundidades.
- **Agente de los Ocultos:** la **Capitana Velanegra**, que manda el barco sin bandera y levanta a
  los marineros ahogados.
- **Fragmento:** el Cuarto Fragmento de Sello, que se lleva a Elenya.
- **Mazmorra:** el Arrecife Hundido. Se abre a mitad de la historia (C7).
- **Giro:** Rhaegar no saqueaba el puerto: robaba a los barcos de los Ocultos y se quedaba con
  sus Cristales de Eclipse para hundirlos en la fosa. Además, el «Capitán del Puerto», tan honrado,
  les vendía a los Ocultos el permiso de amarre sin preguntar qué llevaban: no es malo, es aburrido
  y le daba igual. Se siente culpable, como Ignar.
- **Personajes que vuelven:** Tilo, ya soldado del puerto. Gaspar, porque Trueno se subió a un
  barco. Ignar le manda a Brokk una carta «por mar» que nunca llega (la encuentras tú). Elenya
  purifica el fragmento. El Encapuchado escapa al norte en el barco sin bandera, hacia la Tundra.

## 2. Dónde va en el continente y cómo se entra

- **En `etheria.json`:** `{ "dir": "costas", "x": 160, "y": 330 }`, justo debajo del Volcán y del
  mismo tamaño (4×4 trozos, 160×120 casillas). El oeste de la costa (debajo de Sylvaren, que no
  existe todavía) queda libre para más adelante. `mapa_etheria.md` habla de una costa de 8×4, pero
  es el doble de trabajo. Ver la pregunta 1.
- **El paso: la Bajada de Basalto.** El borde sur del Volcán ya tiene un hueco de ceniza abierto
  en las casillas **x 102-110, y 118-119**, al sureste de la Caldera del Titán. Es la parte más
  alta del Volcán (43-45), así que nadie de nivel bajo llega por accidente. En las Costas el camino
  sigue en la misma x (102-110, y 0) y baja por una escalinata de basalto hasta la playa negra. Al
  lado, el río de lava de la Caldera (x 86-91) desemboca en el mar y se enfría en un **delta de
  vapor**: «la lava baja al mar», como dice la historia.
- **Historia:** la C1 pide terminar la V14 «El corazón del volcán». El Encapuchado escapó por los
  ríos de lava hacia el mar: lo sigues.
- No se toca ningún chunk del Volcán. Si al final hace falta abrir algo más, se hace con un script
  de casillas puntuales, nunca regenerando la zona.

## 3. El mapa (4×4 trozos, norte arriba)

```
 x→ 0          40          80          120        160
 0 ┌───────────┬───────────┬──────▼─────┬──────────┐   ▼ Bajada de Basalto (desde la Caldera)
   │ CALA DE   │  PLAYA DE CENIZA NEGRA  │ DELTA DE  │
   │ LOS       │  (46-48) entrada,       │ VAPOR     │
30 │ PIRATAS   │  arena negra, vapor     │ (47-49)   │
   │ (47-51)   ├───────────┬─────────────┴───────────┤
   │ cueva de  │ MANGLAR DE│  PUERTO ANTIGUO  ⚓ │ ≈≈ │
60 │ Rhaegar   │ LOS       │  + CORALIA       │ ≈≈ │
   ├───────────┤ SUSURROS  │  (ciudad)        │ mar │
   │ CEMENTERIO│ (48-52)   ├──────────────────┤ ≈≈ │
90 │ DE BARCOS │           │ ROCAS DE LAS     │ARRECIFE│
   │ (54-58)   ├───────────┤ SIRENAS (51-55)  │BLANCO │
   │ barco sin │ FARO NEGRO│ islotes, marea   │(53-57)│
120└───────────┴─(55-59)───┴──FOSA DEL ABISMO (58-60)─┘
                                ≈ mar abierto ≈
```

| Subzona | Niveles | Dónde | Qué la hace única |
|---|---|---|---|
| **Playa de Ceniza Negra** | 46-48 | norte (entrada) | arena negra, piedras de lava que humean al tocar el agua, cangrejos y gaviotas |
| **Delta de Vapor** | 47-49 | noreste | el río de lava se apaga en el mar: nubes de vapor, roca nueva, pozas tibias |
| **Puerto Antiguo** | ciudad | centro-este, en la orilla | puerto humano: muelles, almacenes, faroles, el astillero, la capitanía, el mercado de pescado |
| **Coralia** | ciudad | pegada al puerto, sobre el agua | palafitos de los tritones unidos por pasarelas, redes, lámparas de medusa; sin murallas |
| **Cala de los Piratas** | 47-51 | noroeste | acantilado con cuevas, la guarida de Rhaegar, su barco *La Gaviota Insolente* |
| **Manglar de los Susurros** | 48-52 | centro-oeste | raíces sobre el agua, barro, niebla baja, cocodrilos y pirañas |
| **Rocas de las Sirenas** | 51-55 | centro-sur | islotes y **bancos de arena que aparecen con la marea baja** |
| **Arrecife Blanco** | 53-57 | este | coral blanco y rosado, gólems de coral, **la entrada al Arrecife Hundido** |
| **Cementerio de Barcos** | 54-58 | suroeste | cascos encallados, mástiles rotos, niebla; el barco sin bandera fondea aquí de noche |
| **Faro Negro** | 55-59 | sur | el faro abandonado que los Ocultos usan con una luz negra; su campamento |
| **Fosa del Abismo** | 58-60 | sur, en el mar | plataforma de roca sobre la fosa: ahí está encadenada la Bestia |

**Los monstruos se agrupan, no se tiran por todo el mapa.** Cada subzona tiene 2 o 3 **parches de
encuentro** con sentido (la colonia de cangrejos en la playa, el campamento pirata, el banco de
pirañas del manglar, el grupo de acólitos alrededor de su fogata). Entre parches quedan caminos
tranquilos. Así se siente que *ahí* hay monstruos, en lugar de un combate cada tres pasos en todo
el mapa. En el generador se hace con `POBLAR` por parches y no por subzona entera, y se revisa con
`--preview`.

## 4. Lo que la hace única

- **La marea (mecánica de mundo).** Cada 6 minutos de juego la marea sube o baja, y se avisa con
  un cartel («La marea está bajando…»).
  - **Marea baja:** aparecen **bancos de arena** que unen las Rocas de las Sirenas con islotes donde
    hay pozas de marea con recursos y un cofre secreto.
  - **Marea alta:** el agua cubre los bancos. Si te quedas en uno, la ola te empuja a la orilla y te
    quita un 10% de la vida (nunca te deja en 0).
  - Por dentro es como la tormenta y las brasas: un módulo `src/game/world/marea.js` que cambia la
    colisión de las casillas `banco` y el agua de la capa `suelo`, más `lib/marea.js` en el back.
    La hora de la marea sale del reloj del servidor, así todos la ven igual.
- **Viaje rápido: los botes de Marul.** Un tritón te lleva en bote (20 de oro) entre 4 muelles: el
  Puerto, el Manglar, el Arrecife Blanco y el Cementerio. Solo a muelles que ya visitaste
  caminando, como las balsas.
- **Clima: bruma marina.** Un clima nuevo, `bruma`: niebla blanca que pasa a ras del suelo, más
  espesa en el Cementerio y en el Faro. De noche, la luz negra del faro.
- **Terrenos nuevos:** arena negra, arena clara, agua baja, banco de arena (de marea), coral,
  manglar y barro, muelle y pasarela de palafito, además del agua de siempre. Todos van al tileset
  compartido (al final, sin mover los ids) y al editor.
- **Recursos (7):** ver la sección 6.
- **Música:** tema `costas` en modo dórico, en 6/8 como un balanceo de barco, con flauta y un bajo
  que sube y baja como las olas. Para el Arrecife Hundido, un tema propio, `arrecife`, lento y con
  eco. Efectos de sonido: `ola` y `campana` (la campana del puerto avisa la marea).

## 5. Monstruos

Se **reusan los 9 monstruos viejos de la zona 4** que ya están en la base (cambiándoles el nombre,
la descripción, las skills y los drops, como se hizo en el Volcán) y se crean los que faltan. **Hoy
ninguno tiene sprite de combate**: hay que dibujarlos todos en Aseprite
(`crear_enemigos_costas.lua`). Cada uno lleva su material propio al 30%.

| Monstruo | Código | Nivel | Dónde (parche) | Categoría · elemento | Material propio | Habilidad |
|---|---|---|---|---|---|---|
| Cangrejo Gigante | `CANGREJO_GIGANTE` *(existe)* | 46-49 | Playa: la colonia | ACUÁTICO · agua | Pinza de Cangrejo | Tenaza (sangrado) + caparazón (+def) |
| Gaviota Carroñera *(nueva)* | `GAVIOTA_CARRONERA` | 46-50 | Playa, Delta | BESTIA · viento | Pluma Salada | Picotazo en picada (ceguera) |
| Pirata Sin Nombre | `PIRATA_SIN_NOMBRE` *(existe)* | 47-51 | Cala: el campamento | HUMANOIDE | Pólvora Húmeda | Botella Rota + Pistolón |
| Cangrejo de Vapor *(nuevo)* | `CANGREJO_VAPOR` | 47-50 | Delta: las pozas tibias | ACUÁTICO · fuego | Caparazón Hervido | Chorro de Vapor (quemadura) |
| Piraña de Agua | `PIRANA_AGUA` *(existe)* | 48-52 | Manglar: el banco | ACUÁTICO · agua | Diente de Piraña | Frenesí (varios golpes) |
| Cocodrilo del Manglar *(nuevo)* | `COCODRILO_MANGLAR` | 49-53 | Manglar: los barrizales | BESTIA · agua | Cuero de Cocodrilo | Giro Mortal (sangrado) |
| Medusa Abisal *(nueva, magia)* | `MEDUSA_ABISAL` | 50-54 | Rocas, Arrecife | ELEMENTAL · rayo | Gel de Medusa | Toque Urticante (parálisis), hechizo de rayo |
| Sirena Corrupta *(magia)* | `SIRENA_CORRUPTA` *(existe)* | 51-55 | Rocas de las Sirenas | ACUÁTICO · agua | Escama de Sirena | Canto Hechizante (lentitud a todos) + Lanza de Agua |
| Gólem de Coral *(nuevo)* | `GOLEM_CORAL` | 53-57 | Arrecife Blanco | ELEMENTAL · tierra | Fragmento de Coral | Piel de Coral (+def) y Coral Cortante |
| Marinero Maldito | `MARINERO_MALDITO` *(existe)* | 54-58 | Cementerio | MUERTO_VIVIENTE · oscuro | Cadena Ahogada | Abrazo del Ahogado (lentitud) |
| Acólito de la Marea *(nuevo, magia)* | `ACOLITO_MAREA` | 55-59 | Faro Negro | HUMANOIDE · oscuro | Sello de la Marea | Rezo Abisal (maldición) + hechizo de agua oscura |
| Calamar del Abismo *(nuevo)* | `CALAMAR_ABISMO` | 57-60 | Fosa, Faro | ACUÁTICO · agua | Tinta Abisal | Chorro de Tinta (ceguera a todos) |
| **Leviatán Menor** (raro) | `LEVIATAN_MENOR` *(existe)* | 53-56 | Rocas y Arrecife (aparece poco) | ACUÁTICO · agua | **Escama de Leviatán** (llave del tier medio) | Coletazo de Ola (a todos) |
| **Capitana Velanegra** (rara, agente de los Ocultos) | `CAPITAN_PIRATA` *(existe, se renombra)* | 54-57 | Cementerio, de noche | HUMANOIDE · oscuro | Brújula del Eclipse | Andanada + Marea Negra |
| **Almirante Ahogado** (minijefe) | `ALMIRANTE_AHOGADO` *(nuevo)* | 57 | cubierta del barco sin bandera | MUERTO_VIVIENTE · agua | Ancla del Almirante + pergaminos | llama Marineros; Ancla Giratoria |
| **Bestia de las Profundidades** (legendaria) | `BESTIA_PROFUNDIDADES` *(existe)* | 60 | Fosa del Abismo | ACUÁTICO · agua | Corazón Abisal + pergaminos | Guardiana del Cuarto Sello |

Variedad de cartas: acuáticos (vida al ganar), bestias (botín), humanoides (oro), elementales (maná),
muertos vivientes (experiencia).

**Mazmorra (4 monstruos propios, ver sección 8):** Tritón Corrompido, Medusa Guardiana, Coloso de
Coral y el jefe, el **Señor del Océano** (`SENOR_OCEANO`, existe).

**Mítico de la zona:** **Rey Pinzas, el Ermitaño Colosal**. Es un cangrejo ermitaño gigante que
lleva de caparazón un barco hundido entero. Esbirro: Cangrejo Ermitaño. Unos 35.000 de vida. Lleva
sus rumores («los pescadores dicen que una isla se movió anoche…») y su ataque anunciado
(«¡Rey Pinzas cierra la tenaza!»).

**Lo que no se usa:** `SENOR_OCEANO` pasa a ser el jefe de la mazmorra. Las 15 misiones viejas de
las Costas se reusan o se reasignan, como pasó con las del Volcán (ver la sección 9).

## 6. Recursos, materiales y comida

| Recurso del mapa | Dónde | Da | Para qué |
|---|---|---|---|
| Algas Salinas (planta) | Playa, Manglar | `ALGA_SALINA` | pociones, té, comidas |
| Veta de Coral (mineral) | Arrecife Blanco, Rocas | `CORAL_ROJO` | equipo (el «metal» de la zona) |
| Ostras (carne) | Delta, Rocas | `CARNE_OSTRA` + a veces `PERLA` | comidas; perla para joyería |
| Restos de naufragio | Cementerio, Playa | `MADERA_NAUFRAGIO`, `CUERDA_ALQUITRAN` | arcos, carcajes, escudos |
| Poza de marea (solo con marea baja) | islotes de las Rocas | `ESTRELLA_DE_MAR`, `SAL_MARINA` | alquimia |
| Concha Gigante (rara) | Arrecife, Fosa | `PERLA_NEGRA` (POCO_COMÚN) | segunda llave del tier medio |
| Cofre de aventurero | por la zona | lo de siempre | — |

- **Refinado nuevo:** `SAL_MARINA` + agua → *Salmuera Curada*, para curtir el Cuero de Cocodrilo
  (`CUERO_SALADO`, el cuero de la zona).
- **Comidas** (las cocina **Doña Almeja**, del mercado de pescado): Sopa de Mariscos, Ceviche de
  Piraña, Ostras a la Brasa, Guiso de Cocodrilo y Brocheta de Calamar, más el **Té de Alga** y el
  **Elixir de la Marea** (Gel de Medusa + Escama de Sirena + agua: resistencia al agua).
- Cada material dice en su descripción quién lo suelta y dónde.

## 7. Equipo y crafteo (con la escalera v2/v3)

| Tier | Nivel | Rareza | Éxito | De dónde sale |
|---|---|---|---|---|
| **de la Marea** | 46 | RARO | 90% | comunes de la Playa, el Delta, la Cala y el Manglar |
| **de Coral** | 51 | ÉPICO | 80% | Rocas y Arrecife + **Escama de Leviatán** o **Perla Negra** (la llave) |
| **armas del Abismo** (mazmorra) | 52 | LEGENDARIO | 75% | solo armas: **Perla del Abismo** del Señor del Océano + Arena Abisal |
| **del Almirante** | 55 | ÉPICO | 70% | pergamino + Ancla del Almirante |
| **de la Bestia** | 60 | LEGENDARIO | 55% | pergamino + Corazón Abisal |

- Se fabrica en el **Astillero del Puerto**, con **Brea**, la carpintera de ribera, que trabaja el
  coral, el hierro de ancla y la madera de naufragio. La joyería (accesorios) la hace **Nácar**, la
  orfebre tritona de Coralia.
- Materiales por clase. Guerrero: pinzas, pólvora, cadenas, coral. Arquero: plumas, madera de
  naufragio, cuero de cocodrilo. Pícaro: dientes de piraña, caparazones, tinta. Mago: gel de medusa,
  escamas de sirena, sal. Sacerdote: algas, perlas, escamas de sirena.
- Las armas siguen la escalera (+7% / +9% / +9%) **encadenadas con las del Titán de Fuego**. Se
  valida con `simulateCostas` en el simulador.
- **Arte del equipo:** sets de color nuevos `marea`, `coral`, `abismo`, `almirante` y `bestia` en
  `crear_equipo.lua` y en `SETS`.
- `sell_zone_mult` de las Costas: ×4. `ZONE_NAMES` en `lib/fuentes.js`. Una fila
  `balance_versions 'costas_v1'`.

## 8. La mazmorra: el Arrecife Hundido (52-58)

La antigua ciudad de los tritones bajo el Arrecife Blanco. Es un mapa interior de 1×2 trozos, como
la Fisura, con tileset propio: piedra de coral, columnas tritonas caídas, burbujas y algas que se
mecen.

- **Se abre con:** la C7. Nerea, la anciana de Coralia, te da la **Caracola del Rey** (la llave).
- **Puntos de control: las caracolas.** Hay que soplarlas: el agua de esa sala baja y deja ver el
  paso (la acción dice «Soplar»). Si caes, vuelves a la última que soplaste.
- **Tres guardianes que patrullan:** el Tritón Corrompido (de a dos, con lanzas y un cristal en el
  pecho), la Medusa Guardiana (flota sola y paraliza) y el Coloso de Coral (lento y muy duro).
- **Jefe: el Señor del Océano.** Era el rey de los tritones, el padre de Nerea. Los Ocultos le
  clavaron un Cristal de Eclipse para que vigilara a la Bestia encadenada.
  - `weakCycle`: su escudo cambia entre rayo y tierra cada vez que se recupera de una rotura.
  - `beam`: **la Gran Ola**, que se anuncia y se esquiva defendiéndose.
  - Al caer vuelve en sí, se despide de su hija y te da la **Perla del Abismo**.
- **Botín:** Perla del Abismo (armas del Abismo), Arena Abisal, la Corona del Rey Tritón (objeto de
  misión), oro, pociones, piedras de encantamiento. Cofre cada 3 horas.
- **Arte:** tileset, caracola (llena / soplada), compuerta de coral, fondo de combate propio y el
  tema `arrecife`.

## 9. Pueblo y NPCs

Cada NPC vive donde tiene sentido según su historia y sus misiones, nunca suelto en el mapa.

**Puerto Antiguo (humanos)**

| NPC | Dónde | Quién es | Para qué |
|---|---|---|---|
| **Capitán Osvaldo Bastida** | capitanía, en el muelle mayor | capitán del puerto: honrado, aburrido, habla de reglamentos | historia principal |
| **Tilo** (`tilo_puerto`) | puesto de guardia del muelle | ya es soldado; quiere probarse | historia (C1), escolta, *Amor entre bandos* |
| **Brea** | astillero | carpintera de ribera, ruda y práctica | forja de la zona, equipo |
| **Doña Almeja** | mercado de pescado | cocinera que grita los precios | comidas, *¿Fresco?* |
| **Salitre** | puesto del mercado | mercader viejo que lo ha visto todo | comerciar (`artesanos`); vende el **sobre de cartas de las Costas** |
| **Gaspar** (`gaspar_costas`) | muelle de los pescadores | sigue a Trueno, que se subió a un barco | *¿Dónde está Trueno? (en el mar)* |

**Coralia (tritones)**

| NPC | Dónde | Quién es | Para qué |
|---|---|---|---|
| **Nerea, la Anciana Cantora** | palafito mayor | líder de los tritones, hija del Señor del Océano | historia principal, la mazmorra |
| **Marul** | muelle de Coralia | tritón barquero, risueño | botes (viaje rápido), *Red rota* |
| **Nácar** | taller de palafito | orfebre de perlas y coral | accesorios, encantadora de la zona |
| **Ondina** | pasarelas | niña tritona que colecciona cosas «del mundo seco» | *Tesoros secos* (tierna) |

**En el resto del mapa**

| NPC | Dónde | Por qué ahí |
|---|---|---|
| **Capitán Rhaegar** | Cala de los Piratas (después, en el puerto) | es su guarida; con la alianza su barco atraca en el puerto |
| **Galleta, el loro** | sobre Rhaegar, o perdido por el mapa | *El loro que sabe demasiado* |
| **Anka, la pirata** | Cala | *Amor entre bandos* con un soldado del puerto |
| **Viejo Faro (Bartolo)** | cabaña al pie del Faro Negro | el farero al que echaron los Ocultos |
| **Cieno, el pescador del manglar** | choza del Manglar | conoce el pantano; pesca y comida |
| **Elenya** | Catedral de Aurelia | recibe el Cuarto Fragmento (como siempre) |

Los tritones son una **raza nueva** (`race="triton"` en `crear_npcs_misiones.lua`): piel
verde-azulada con escamas, aletas en vez de orejas, branquias y ojos grandes. Hay que dibujar los
caminados y retratos de todos los NPCs nuevos (unos 14).

## 10. Misiones

### Principales (C1-C14), después de V14 «El corazón del volcán»

| # | Misión | Quién | De qué trata (y en qué subzona) |
|---|---|---|---|
| C1 | La Bajada de Basalto | Ignar → Tilo | sigues al Encapuchado por la lava hasta la Playa; Tilo te da la bienvenida. *Escolta:* Tilo te lleva al puerto |
| C2 | Puerto en alerta | Bastida | el puerto teme a los piratas: defiende el almacén (emboscada) en el muelle |
| C3 | Velas en la noche | Bastida | investiga los restos de un barco quemado en la Playa: huellas que van a la Cala |
| C4 | La Cala de los Piratas | Bastida | entra a la Cala, vence a los piratas y captura a Rhaegar |
| C5 | El pirata que cazaba sombras | Rhaegar | **giro:** sus cofres están llenos de Cristales de Eclipse robados a los Ocultos; el loro repite «¡Velanegra! ¡Velanegra!» |
| C6 | Los que perdieron el mar | Nerea | Coralia: los tritones cuentan cómo los echaron. Junta algas y coral para sus heridos |
| C7 | La Caracola del Rey | Nerea | en el Manglar, recupera la caracola que robaron los cocodrilos (sí, los cocodrilos). **Se abre el Arrecife Hundido** |
| C8 | El Arrecife Hundido | Nerea | la mazmorra: vence al **Señor del Océano** (escena triste: era el padre de Nerea) |
| C9 | Alianza incómoda | Rhaegar ↔ Bastida | junta a los dos en la capitanía. **Giro 2:** Bastida le vendía amarre al barco sin bandera |
| C10 | El canto de las rocas | Rhaegar | en las Rocas de las Sirenas, con la marea baja, encuentra el mapa del fondeadero de Velanegra |
| C11 | La Capitana Velanegra | Rhaegar | de noche, en el Cementerio: vence a Velanegra (rara) |
| C12 | El barco sin bandera | Rhaegar | sube con *La Gaviota Insolente* al barco sin bandera: el **Almirante Ahogado** (minijefe) |
| C13 | La luz del faro | Bartolo | apaga la luz negra del Faro Negro; los acólitos guardan las cadenas de la Bestia |
| C14 | La Bestia de las Profundidades | Nerea + Rhaegar | en la Fosa: rompe las cadenas, vence a la **Bestia** y el Cuarto Fragmento va a Elenya. El Encapuchado huye al norte; Rhaegar promete llevarte «cuando el hielo se abra» → Tundra |

Las 3 misiones principales viejas (`COSTAS_Q1_CAZADOR_PIRATAS`, `COSTAS_Q2_TRIDENTE_PERDIDO` y
`COSTAS_Q3_BESTIA_PROFUNDIDADES`) se reusan con su id, como en el Volcán (C4, C8 y C14).

### Secundarias (16, en cadenas cortas; nunca más de 3 abiertas a la vez)

- **El loro que sabe demasiado** (Rhaegar, ×3, graciosa): Galleta se escapa y repite secretos de los
  Ocultos por todo el mapa. Lo encuentras en un mástil, en el mercado insultando a Doña Almeja…
- **Amor entre bandos** (Tilo y Anka, ×3): un soldado del puerto y una pirata. Tú llevas las cartas;
  al final, con la alianza, se ven en el muelle.
- **¿Dónde está Trueno? (en el mar)** (Gaspar): Trueno se subió a un barco pesquero, después aparece
  comiendo algas en el Manglar y al final nadando con los tritones.
- **La carta que no llegó** (Brokk e Ignar): una botella en la Playa trae la carta de Ignar a Brokk.
  La llevas a Aurelia. Sigue la rivalidad.
- **Red rota** (Marul, ×2): los cangrejos rompen las redes; trae cuerda y pinzas.
- **Tesoros secos** (Ondina, ×2, tierna): quiere «cosas del mundo seco». Le llevas una herradura de
  Trueno y una flor de la Pradera; al final te regala un huevo.
- **¿Fresco?** (Doña Almeja): ostras y alga para su sopa; la sopa te la da a ti.
- **El farero sin faro** (Bartolo, ×2): después de la C13, vuelve a encender el faro con aceite y
  vidrio de coral.
- **Lo que esconde el manglar** (Cieno): un cocodrilo enorme le roba la pesca (emboscada).

### Diarias

3 nuevas: ostras para Doña Almeja, coral para Brea y cazar pirañas para Cieno. Las 12 diarias
viejas de las Costas se reasignan a NPCs de la zona.

### Reglas que se cumplen en todas

- **Todo punto de `INVESTIGATE` y `AMBUSH` tiene su dibujo**: la botella, los restos del barco,
  las huellas, el cofre de cristales, la caracola. Se dibujan en `crear_puntos_mision.lua` o se usa
  `mon:CODIGO`. **Nunca un `?` flotando sobre una casilla vacía.** El checker de misiones lo revisa:
  un punto sin `sprite` o con un dibujo que no existe es un error.
- Los `COLLECT_ITEM` se rastrean solos (monstruo o recurso más cercano). Sus recursos y monstruos
  están en la misma zona.
- Los NPCs que da una misión están **cerca de lo que piden**: Cieno en el Manglar pide cosas del
  Manglar, y Bartolo vive al pie del faro.

### Phasing (el mundo cambia con la historia de cada jugador)

| Qué | Antes | Después |
|---|---|---|
| El almacén del muelle | barricadas y cajas rotas | reparado (C2) |
| Rhaegar | en su Cala, tras unas rejas (capturado en C4) | en el muelle del puerto con su barco (C9) |
| *La Gaviota Insolente* | fondeada en la Cala | atracada en el puerto (C9) |
| Tritones heridos | en esteras en el muelle de Coralia | curados, en sus palafitos (C6) |
| Faro Negro | luz negra, acólitos | luz normal y Bartolo vuelve a su cabaña (C13) |
| El barco sin bandera | fondeado en el Cementerio (de noche) | hundido, con el mástil asomando (C12) |
| Coralia | sin lámparas | lámparas de medusa encendidas (C14) |
| Tilo | en su puesto | se va contigo como escolta (C1) y vuelve |

Se hace con `fase` en los NPCs y con puntos `escena`, como en el Volcán.

## 11. Los demás sistemas (la lista de la guía, A12)

| Sistema | Qué lleva en las Costas |
|---|---|
| Bestiario y cartas | entran solos; revisar la `category` de cada monstruo y su sprite |
| Huevos | huevos de mascota en los drops (y, si sale lo de los **huevos con dibujo de su zona**, el huevo de las Costas) |
| Mítico | Rey Pinzas en `MITICOS[4]` |
| Exploración | `ZONES.costas` (10 subzonas), premio por explorarla entera de unos 4000 de oro y 9000 de experiencia, y 3 secretos: el islote de marea, la bodega del barco hundido y la cueva tras la cascada de la Cala |
| Música | `costas` y `arrecife` |
| Carteles | `ZONE_TITLES` de las Costas y del Arrecife |
| Mercader | Salitre (`MERCADER_PUERTO`, especialidad `MARINO`) |
| Sobre de cartas | lo vende Salitre: cartas de los monstruos de las Costas |
| Refugios | una fogata por subzona, más los palafitos |
| Fondos de combate | Costas (playa y mar) y Arrecife (bajo el agua), 5 capas cada uno |
| Editor | terrenos y recursos nuevos |
| Atlas (M) | `costas` en su posición, el camino desde la Caldera y el texto de ruta |
| Encantador | Nácar |
| Viaje rápido | los botes de Marul |

## 12. Preguntas para Marco (antes de programar)

1. **Tamaño:** ¿4×4 trozos, debajo del Volcán (lo recomiendo: igual que las otras zonas, y el oeste
   queda para Sylvaren), o la costa entera de 8×4 que dice `mapa_etheria.md`?
2. **La marea:** ¿te gusta como mecánica de la zona, con bancos de arena que aparecen y la ola que
   empuja? La alternativa más simple es solo el oleaje que golpea en la playa, sin cambiar caminos.
3. **El giro del Capitán del Puerto** (le vendía amarre a los Ocultos sin preguntar): ¿lo dejamos o
   lo quieres limpio?
4. **El orden de trabajo:** propongo hacerlo **en tandas**, cada una probada y lista para tu commit:
   1. mapa, terrenos, tileset, paso desde el Volcán y ciudad;
   2. monstruos, sprites, fondos de combate y equilibrio;
   3. recursos, ítems, comidas y equipo con la escalera;
   4. NPCs con sprites, diálogos, misiones y phasing;
   5. la mazmorra;
   6. la marea, los botes, el mítico, la música y la exploración.

## 13. Estado (por tandas)

**Tanda 1 — mapa, terrenos, tileset, paso desde el Volcán y ciudad: hecha** (sin commit).

- **Tileset v8** (`art/sprites/mundo/crear_mundo.lua`, al final): 261 tiles nuevos (1217 en total; los
  956 viejos, comprobados idénticos píxel a píxel). Terrenos con bordes automáticos: `arena` (suelo de
  base), `arenan`, `pastoc`, `coral`, `barro`, `caminoc` (camino de conchas), `bajo` (agua baja, se
  camina), `mar` (choca; su borde se aclara hacia el agua baja), `banco` / `banco_alta` (marea),
  `hierba_salada` (combates) y `muelle_0…15`. Objetos: palmera, mangle, roca marina, mástil roto,
  casco de barco, La Gaviota Insolente, capitanía, casas del puerto, almacén, astillero, palafito,
  Faro Negro, cueva pirata, portal del Arrecife y decoración (conchas, estrellas, redes, anclas,
  boyas, botes, lámparas de medusa, la campana del puerto).
- **Editor** (`src/editor/rules.js`): los terrenos nuevos con sus pinceles. El estilo de un camino sale
  de lo que hay hasta dos casillas a la redonda (antes, el medio de un camino ancho salía con el
  camino de la Pradera).
- **Mapa** (`art/mapas/generar_costas.js` → `public/assets/mundo/costas/`): usa las mismas reglas
  del editor para el suelo. 11 subzonas; 24 grupos de monstruos (de 1 a 4 por subzona) con caminos
  tranquilos entre ellos; la pared de basalto cierra todo el borde norte salvo la Bajada (x 101-112).
  Se comprobó que desde la entrada se llega caminando a todos los lugares y grupos.
- **Continente:** `etheria.json` (160, 330), `ZONE_TITLES`, atlas (M).
- **Back:** `lib/exploracion.js` (`ZONES.costas`, `ZONE_IDS.costas`) y `ZONE_ID_OF_DIR` en
  `routes/players.js`.
- **Apagado hasta la tanda 2:** `COMBATES_LISTOS = false` en el generador (`encuentroHierba: 0`). Los
  grupos nombran a los monstruos nuevos, que todavía no existen. Los NPCs, los recursos, los secretos,
  la salida al Arrecife y los jefes se agregan en sus tandas (sus lugares ya están pensados en `P`).

**Tanda 2 — monstruos, sprites, fondo de combate y equilibrio: hecha** (sin commit).

- **Monstruos** (`gpr/_respaldo_claude/costas/gen_costas.js` → `costas_monstruos.sql`, al final de
  `db/schema.sql` y de `db/pendiente_supabase.sql`): los 12 comunes, los 2 raros y los 2 jefes de la
  sección 5, con stats por fórmula, resistencias, botín (material propio al 30%), 24 habilidades
  nuevas con sus estados y recompensas (Almirante 5300 xp / 975 de oro; Bestia 17000 / 6900). Se
  reusaron los códigos y materiales viejos de la zona 4 (Capitán Pirata → Capitana Velanegra,
  Colmillo de Leviatán y Perla Marina como llaves del tier medio, Núcleo de la Bestia → Corazón
  Abisal). Los jefes conservan su botín viejo de pergaminos hasta la tanda 3.
- **El Señor del Océano queda sin zona** (`zone_id = NULL`), como los monstruos de las otras mazmorras:
  así no sale en el 15% de jefes de los combates del pasto. Se rehace como jefe del Arrecife (tanda 5).
- **Equilibrio:** perfiles en `scripts/equilibrio/generar.js` y `simulateCostas` (usa el set de cada
  tramo; mientras no exista, el del Titán de Fuego). Resultado: 3-5 turnos para matar y 5-9 golpes
  aguantados en todo el rango 46-60, para las 5 clases.
- **Arte:** `gpr/art/sprites/enemigos/crear_enemigos_costas.lua` (16 monstruos, `zona4/*.aseprite`,
  entradas en `enemigos.json`) y `gpr/art/sprites/mundo/crear_fondo_costas.lua` (fondo de 5 capas:
  bruma, el mar con el Faro Negro y el barco sin bandera, acantilados con palmeras, arena mojada).
- **Front:** `BattleScene.js` (fondo `costas` y el efecto de cada habilidad nueva) y `Battle.js`
  (`ZONE_BACKGROUND[4]`).
- **Mapa:** combates prendidos (`COMBATES_LISTOS = true`) y los jefes en el mapa: el Almirante en el
  fondeadero del Cementerio (12,108) y la Bestia en la plataforma de la Fosa (123,111).
- **Probado:** combates por API en 7 subzonas (cada monstruo usa sus habilidades y estados; el golpe
  básico suma su parte de elemento); Brisa restaurada y las sesiones de prueba borradas.

**Tanda 3 — recursos, equipo y crafteo, sets de jefe, comidas y venta: hecha** (sin commit).

- **Recursos** (7 tipos, 70 sitios en 23 nodos): `veta_coral`, `alga_salina`, `ostras`,
  `restos_naufragio`, `poza_marea` (en los islotes de las Rocas), `concha_gigante` (rara: Perla Marina)
  y `cofre_costas`. Arte en `gpr/art/sprites/mundo/crear_recursos6.lua` (`recursos6.png`); qué da cada
  uno en `lib/worldNodes.js`; sus sitios los pone el generador del mapa, que también escribe
  `lib/worldNodes.zonas.json["4"]`.
- **Equipo** (`_respaldo_claude/costas/gen_equipo_costas.js` + `gen_escalera_costas.js`), en el
  Astillero del Puerto Antiguo (`astillero_puerto` en `lib/cercania.js`, servicios `forja` y `taller`):
  | Tier | Código | Nivel | Qué pide |
  |---|---|---|---|
  | Marea | `_COSTAS` (piezas viejas, renombradas) | 46 RARO 90% | cangrejos, gaviotas, pirañas, cangrejos de vapor, algas, madera y cuerda |
  | Coral | `_CORAL` (nuevo) | 51 ÉPICO 80% | gólems, cocodrilos, medusas, sirenas, coral + **Colmillo de Leviatán** o **Perla Marina** |
  | Abismo | `_ABISMO` (armas nuevas) | 52 LEGENDARIO 75% | **Perla del Abismo** + Arena Abisal (los suelta el Arrecife Hundido, tanda 5) |
  | Almirante | `_OCEANO` (set viejo del Océano) | 55 ÉPICO 70% | pergamino del Almirante + **Ancla del Almirante** |
  | Bestia | `_PROFU` (set viejo de las Profundidades) | 60 LEGENDARIO 55% | pergamino de la Bestia + **Corazón Abisal** |
  La forma de cada pieza sale de su par del Volcán (Marea ← Volcán, Coral ← Obsidiana, Almirante ←
  Caldera, Bestia ← Titán de Fuego): así regenerar da siempre lo mismo. Los sets de jefe piden la mitad
  de materiales (como los del Volcán). Los pergaminos del Océano pasaron al Almirante (17,5%).
- **Equilibrio:** se subió la vida de los monstruos de las subzonas altas (la escalera les ganaba en
  menos de 3 turnos). Con el equipo de cada tramo: ~3-3,7 turnos para matar (4 redondeado) y 5-10 golpes
  aguantados, para las 5 clases (`node scripts/equilibrio/generar.js --simular --detalle`).
- **Costo de fabricar** (combates o recolecciones esperados): piezas chicas 6-12, grandes de la Marea
  ~14, grandes de Coral ~20-33 (la llave, ~13), Almirante ~17 + su ancla, Bestia ~34-44, comidas 3-6.
- **Comidas** (Doña Almeja; `gen_comidas_costas.js`): Sopa de Cangrejo, Ostras a la Brasa, Ceviche de
  Ostras, Guiso de Cocodrilo (el cocodrilo suelta su carne), Brocheta de Calamar en su Tinta, Té de Alga
  y Elixir de la Marea.
- **Otros:** `sell_zone_mult` ×4 para lo de la costa, `ZONE_NAMES[4]` en `lib/fuentes.js`, los raros
  (Leviatán y Velanegra) sueltan piezas de Coral (`lib/piezasSet.js`), `balance_versions 'costas_v1'`,
  sets de color `coral` y `abismo` (`crear_equipo.lua`, `gear.js`).
- **Pendiente para otras tandas:** la Perla del Abismo y la Arena Abisal todavía no las suelta nadie
  (Arrecife Hundido, tanda 5); las pozas de marea serán solo con marea baja (tanda 6). No se hizo el
  refinado «Cuero Salado» de la sección 6: no hacía falta para ninguna receta.

**Tanda 4 — NPCs, misiones, diálogos y fases: hecha** (sin commit).

- **Misiones** (`_respaldo_claude/costas/gen_misiones_costas.js` → `costas_misiones.sql`): las 14
  principales C1-C14 (la C1 pide la V14 del Volcán; las viejas Cazador de Piratas, El Tridente Perdido y
  Bestia de las Profundidades son la C4, la C8 y la C14 con su mismo código), 16 secundarias (Trueno en
  el mar, la carta de Ignar a Brokk, ¿Fresco?, la red de Marul, los tesoros de Ondina —termina en un
  huevo—, el cocodrilo grande, el loro Galleta, Tilo y Anka, el faro de Bartolo), 3 diarias nuevas y las
  11 viejas de la zona, cada una con su NPC. La diaria del Señor del Océano pasó a ser del Almirante. 10
  objetos de misión. Cada investigación y cada emboscada tiene su dibujo (comprobado).
- **NPCs:** 17 puntos en el mapa (Rhaegar en tres lugares, Anka en dos, Tilo y Gaspar según la
  historia). Al llegar a la costa, Tilo deja el Bastión y Gaspar deja el Volcán (se cambió solo la fase
  de esos dos puntos con `_respaldo_claude/costas/fase_punto.js`; los mapas editados no se regeneraron).
- **Diálogos:** `gpr/src/game/dialoguesCostas.js` (se suma a `dialogues.js`), con lo que cambia según
  la historia. Brea abre el astillero, Doña Almeja cocina, Nácar encanta, Salitre comercia.
- **Salitre** (`MERCADER_PUERTO`, `costas_mercader.sql`): tienda propia de la costa (como Marga).
- `NPC_HOMES` (`lib/questSteps.js`), `NPC_LUGAR` (`questGivers.js`), `cercania.js` (Salitre).
- **Probado:** `revisar_misiones.js 4` sin problemas; por API, la C1 entera (charla, playa, escolta de
  Tilo, entrega) y la emboscada de la C2.

**Tanda 5 — el Arrecife Hundido: hecha** (sin commit).

- **Back:** `lib/arrecife.js` (molde de `lib/mazmorra.js`, en `lib/mazmorras.js` y `server.js`), nivel
  52-58. Guardianes: Tritones Corrompidos, Medusa Guardiana y Coloso de Coral (los siembra el servidor
  al arrancar). Puntos de control: caracolas («Soplar»). Jefe: el **Señor del Océano** con escudo
  Rayo → Tierra y la Gran Ola anunciada; sus números de jefe los pone `costas_arrecife.sql` (el molde no
  pisa a un monstruo que ya existe). Botín: Arena Abisal (todos) y Perla del Abismo (el rey, 50%); cofre
  cada 3 h con pociones, una pieza de Coral de tu clase o Perlas. Se entra con la Caracola del Rey (C7).
- **Arte:** `crear_arrecife.lua` (tileset, caracola, compuerta de coral), `crear_fondo_arrecife.lua`
  (fondo de combate bajo el agua) y `crear_enemigos_arrecife.lua` (los 4, incluido el Señor del Océano,
  que no tenía sprite). Mapa: `art/mapas/generar_arrecife.js` (mismo plano que la Fisura). Música
  `arrecife`.
- **Costas:** la entrada es la casilla de abajo en el medio del portal (131,83).
- **Arreglo del combate (vale para todo el juego):** consultar un combate ya ganado volvía a repartir
  la experiencia, el oro y el botín (`GET /combat/sessions/:id` → `advanceEnemyTurns` → otra vez
  `finalizeSession`). Ahora un combate se cierra una sola vez.
- **Probado por API:** sin llave y sin nivel no se entra; caracola; puerta cerrada hasta los tres
  guardianes; guardián; jefe con su escudo; cofre (dio una pieza de Coral) y botín una sola vez.

**Tanda 6 — botes, marea, mítico, música, bruma y escondites: hecha** (sin commit).

- **Botes de Marul** (`lib/botes.js`, `POST /world/bote`): Coralia (Marul), la Cala (su primo Sargo) y
  el Cementerio (su primo Bagre), 25 de oro, solo a muelles ya descubiertos.
- **Marea** (`lib/marea.js` y `src/game/world/marea.js`): 6 minutos baja y 6 alta, con el reloj del
  servidor. Con la alta, los bancos se cubren y chocan, y si estás en uno una ola te lleva a la orilla;
  la campana avisa 30 s antes. Las pozas solo se recolectan con la marea baja (el servidor lo comprueba).
- **Mítico:** Rey Pinzas, el Ermitaño Colosal, y sus cangrejos ermitaños (`MITICOS[4]` en
  `lib/mythic.js`, sprites en `crear_miticos.lua`; los cuatro míticos viejos salen idénticos).
- **Música** `costas` (vals de puerto en 6/8) y `arrecife`; sonidos `ola` y `campana`.
- **Clima:** bruma marina (`clima.bruma`, 35%).
- **Escondites:** el islote del este (con la marea baja), la bodega del barco hundido y el fondo de la
  Cala.
- **Probado por API:** botes, marea, poza, escondite (una sola vez) y míticos.
- **Quedó afuera:** el sobre de cartas de la costa y los sprites de huevo por zona (las dos ideas de
  Marco de antes de empezar la zona).
