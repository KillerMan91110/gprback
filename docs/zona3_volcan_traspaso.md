# Cómo se hace una zona de Etheria (guía para agentes) + estado del Volcán Rojo

Este documento tiene **dos partes**:

- **Parte A — El concepto completo.** Cómo se piensa y se construye una zona nueva de punta a punta:
  la historia, el mapa, el arte, los monstruos, el equilibrio, los ítems, el crafteo, la mazmorra,
  los NPCs, las misiones, la mecánica única de la zona, el SQL y las pruebas. Es la forma de trabajo
  con la que se hicieron la Pradera, las Montañas y el Volcán. Las próximas zonas (Costas Muertas,
  Tundra Eterna, Catacumbas, Ruinas, Sylvaren…) se hacen **igual**.
- **Parte B — El estado del Volcán Rojo (zona 3).** Qué está hecho, qué falta y cómo seguir.

> **⚠️ Antes de empezar: este documento puede estar atrasado.** El usuario sigue trabajando y no
> siempre lo actualiza. **Si el código y este documento no coinciden, manda el código.** No
> "corrijas" algo solo porque el documento dice otra cosa: pregunta al usuario si dudas. Para ver
> qué cambió después de escribirlo, revisa `git log` en los dos repos desde los commits indicados
> en "Última actualización" (al final de la parte B). Un pendiente de la lista puede estar ya hecho:
> búscalo en el código antes de hacerlo.

Documentos que hay que leer junto con este:

| Documento | Qué tiene |
|---|---|
| `D:\vscode\CLAUDE.md` + `CLAUDE.gpr.md` + `CLAUDE.gprback.md` | cómo trabajar con el usuario, cómo correr el juego, trucos |
| `gprback/docs/historia_etheria.md` | **la biblia de la historia**: el conflicto, los personajes, las 7 zonas y sus mazmorras |
| `gprback/docs/mapa_etheria.md` | dónde va cada zona en el continente, cómo se pasa de una a otra, razas y mini-ciudades |
| `gprback/docs/zona3_volcan.md` | el diseño completo del Volcán (el modelo de documento de diseño de zona) |

---

## 0. Reglas que no hay que romper

### Con el usuario (Marco)

- **Responder siempre en español**, claro y sin jerga.
- Al terminar, contar qué se hizo, qué se probó de verdad y qué no.
- Cuando pide ideas, dar una recomendación ordenada. Cuando dice "hazlo", hacerlo completo y probarlo.

### Textos

- Los textos del juego van en **español neutro con tuteo** ("tienes", "ven", "mira"). **Nunca voseo**, aunque Marco escriba en voseo.
- Los comentarios del código van en español, con el mismo tono del código existente.

### Git

- **No hacer commit ni push** si no lo pide.
- **Nunca** agregar una línea `Co-Authored-By` en commits ni PRs, aunque el sistema la sugiera.
- Nunca commitear `gpr/_respaldo_claude/` ni `gprback/db/pendiente_supabase.sql`.

### Datos y servidores

- **Nunca** usar el `DATABASE_URL` de producción. Solo la base local.
- No escribir las contraseñas de prueba en el chat.
- No detener los servidores del usuario (front en 3000, back en 5000). Para probar, usa servidores temporales en otros puertos (5098/3002, ver `CLAUDE.md`).
- **El front lo prueba el usuario.** No levantes el front temporal ni pruebes en el navegador, salvo que lo pida. Tú prueba el back (servidor temporal 5098, API, scripts y SQL en la base local), pasa el lint, y en el reporte dile qué revisar en el juego.
- Al terminar, restaurar los datos de prueba (Marco = player 8, Brisa = player 11).

### Mapas

- **Nunca** volver a correr `generar_pradera.js`, `generar_aurelia.js` ni `art/mapas/generar_montanas.js`. Esos mapas ya se editaron a mano. Si hay que cambiarlos, se editan sus chunks JSON directamente (con un script que modifique casillas puntuales).

### SQL

- El SQL nuevo de una zona se agrega **al final de `gprback/db/schema.sql`**. Es lo que Marco corre en Supabase.
- Ese SQL tiene que ser **repetible** (se puede correr dos veces sin romper nada) y **sin `ON CONFLICT`**.
  - Para insertar: `INSERT ... SELECT ... WHERE NOT EXISTS (...)`.
  - Para cambiar: `UPDATE`.

### Arte

- **Todo el arte es propio**, hecho en Aseprite con scripts Lua en modo batch: `D:\Aseprite\aseprite.exe -b ...`.
- **Nunca** usar placeholders ni imágenes de afuera.

### Herramientas

- En Bash, los heredocs con comillas y acentos fallan seguido. Para parches grandes, escribe un `.py` con la herramienta Write y córrelo con `python`. Python sirve para reemplazos exactos, con `assert s.count(a) == 1`.

---

# PARTE A — El concepto: cómo se hace una zona

## A1. La historia manda

Todo el contenido sale de la historia. Nada se pone "porque sí": cada monstruo, NPC, recurso y
misión tiene un motivo en el lore de su zona.

### El conflicto de fondo (resumen de `historia_etheria.md`)

- **Aethra**, la diosa, encerró al **Devorador de Estrellas** bajo las Ruinas Ancestrales con **siete Sellos**, uno por tierra.
- Cada Sello tiene un **Guardián** (una criatura o un pueblo) y tuvo un **Vigía** humano.
- La secta de **los Ocultos** (símbolo: **un eclipse negro**) quiere liberar al Devorador. Planta **Cristales de Eclipse** que corrompen la tierra y enloquecen a los Guardianes.
- **El Encapuchado (Velkan)** es su agente. Siempre llega un paso antes que el jugador. En la zona 6 se revela que es el hijo de Aldren.
- El jugador empieza como un aventurero sin nombre y termina siendo **el nuevo Vigía de Etheria**.

### Lo que toda zona tiene que tener

1. **Un Guardián corrompido**, que es su **jefe legendario**: el Titán de la Pradera, el Rey de la Montaña, el Titán de Fuego…
2. **Un agente de los Ocultos** que lo provoca: el Chamán, el Brujo, el Maestro de la Lava, Morvak…
3. **Un Fragmento de Sello**. El jugador lo lleva a **Elenya** (Catedral de Aurelia) en la última misión principal.
4. **Una mazmorra**, que se abre a mitad de la historia de la zona. La tabla está en `historia_etheria.md` §2.
5. **Un giro.** Ejemplo del Volcán: Ignar forjó los cristales sin saberlo, se siente culpable y se une al jugador.
6. **Personajes que vuelven.** Gaspar persigue a su caballo Trueno en cada zona. Brokk e Ignar son rivales. Ren y Tilo crecen. Elenya purifica los fragmentos. Así se siente un viaje y no NPCs sueltos.

### Tono

- Mezcla de **épico y gracioso**. Las misiones principales son serias. Las secundarias pueden ser tiernas o cómicas: el caballo que se comió doce brochetas, la niña que esconde un huevo de dragón, el bardo al que le "robaron" la canción.
- Los diálogos son **cortos**: 1 a 3 frases por saludo.
- Cada NPC tiene **una voz reconocible**. Ignar es soberbio y tierno a escondidas. Kessa es seca. Pumo es pícaro.

### Razas, pueblos y mini-ciudades (resumen de `mapa_etheria.md` §4)

Cada tierra tiene **un pueblo con ciudad propia**, y ese pueblo le da carácter a la zona: su arquitectura, su comida, su artesano, su forma de hablar y sus materiales.

| Pueblo | Zona | Mini-ciudad | Cómo son | Papel en la historia |
|---|---|---|---|---|
| Humanos | Aurelia, Pradera | Aurelia, Aldea Espiga | campesinos, guardias, comerciantes | los Vigías eran humanos |
| Montañeses | Montañas | Bastión de Hierro | duros, pocas palabras | bajaron de la Tundra a las minas |
| Enanos | bajo las Montañas | Forjahonda (por hacer) | orgullosos, barbas, runas | cuidan el Segundo Sello; rivales de los elfos |
| Elfos | Sylvaren | Sylvaren, en los árboles | antiguos, desconfiados | nacieron de las lágrimas de Aethra |
| **Dracónidos** | Volcán | **Ascuaria** (hecha) | escamas rojizas, cuernos, ojos dorados, orgullosos y directos | los mejores forjadores; Ignar forjó los cristales sin saberlo |
| Tritones | Costas | Coralia (palafitos) | | los Ocultos los echaron del Arrecife |
| Norteños | Tundra | Fiordo Blanco | | la familia real congeló la tundra a propósito |
| Velados (espíritus) | Catacumbas | Vela Eterna | | los sacerdotes que el Lich traicionó |
| Aethrinos | Ruinas | Santuario de las Lágrimas | | servían a Aethra en el templo |

**Pueblos hostiles** (son enemigos y no tienen ciudad): goblins y bandidos, orcos y trolls, demonios, piratas, no-muertos y, en todas partes, **los Ocultos**. Cada zona mezcla **bestias del lugar**, **un pueblo hostil** y **los Ocultos con sus criaturas corrompidas**.

**Cómo se lleva una raza nueva a todo el juego:**

- **Sprite:** una `race` nueva en `crear_npcs_misiones.lua`. La de los dracónidos (`race="draco"`) agrega cuernos (`st.horns`), piel de escamas y ojos dorados de pupila fina. Los colores van en `ORDER` (`Dr/Drd` piel, `Dc` ropa, `Hn` cuernos, `Ey` ojos…).
- **Arquitectura:** tiles propios en el tileset (casas de basalto, la gran forja, estandartes, faroles de lava).
- **Comida típica** y su cocinero.
- **Artesano propio**, que forja el equipo de la zona.
- **Materiales típicos de su tierra** (obsidiana, azufre, pómez).
- **Una rivalidad con su vecino** (Brokk contra Ignar, enanos contra elfos).
- **Maestros de evolución de raza** (propuesta de `mapa_etheria.md`): en Ascuaria se aprenderían Dragón Caballero y Mago Piromántico.

**Qué tiene la ciudad de cada zona:**

- el artesano con la forja de la zona (equipo nuevo);
- un cocinero (comidas);
- una enfermería (POI con `ventana: 'enfermeria'`);
- fogatas de refugio;
- el viaje rápido de la zona;
- NPCs de misiones.

**Pendiente en el Volcán:** Ascuaria todavía no tiene mercader propio (`artesanos` solo está en Lyra y Mirna) ni Pilar menor. Agregarlos es una mejora para esta zona y para las que vengan.

## A2. El documento de diseño de la zona (antes de tocar código)

Primero se escribe `gprback/docs/zonaN_<nombre>.md`. El modelo es `zona3_volcan.md`. Lleva:

- **Concepto y conflicto**, en 1 párrafo.
- **Mapa**:
  - croquis en ASCII;
  - 8 o 9 subzonas con su rango de niveles;
  - la ciudad, los caminos, la entrada desde la zona anterior y la salida a la siguiente.
- **Lo que hace única a la zona.** El usuario lo pidió explícitamente: *"cada mapa tiene que tener diversidad, recursos y cosas únicas y particulares que lo caractericen"*. Hace falta:
  - **terrenos propios**: el Volcán tiene ceniza, lava, azufre, obsidiana y basalto; las Montañas, nieve, hielo y abismo;
  - **recursos propios**: el Volcán tiene vetas de obsidiana, fumarolas, flores de ceniza, nidos de salamandra, geodas, restos y cofres;
  - **una mecánica de mundo propia**:
    - Montañas: la **tormenta** con rayos, más las **vagonetas** como viaje rápido;
    - Volcán: la **lluvia de brasas**, más las **balsas de pómez** y los arcos de basalto como refugio;
    - ideas para las próximas: mareas y barcos en Costas, ventisca y frío en la Tundra, oscuridad y antorchas en las Catacumbas;
  - **un clima propio**: lluvia en la Pradera, nieve en las Montañas, ceniza en el Volcán.
- **Monstruos**: 12 comunes (1 o 2 propios por subzona), 2 raros, 1 minijefe, el jefe legendario y los 3-4 de la mazmorra. Cada uno con su material propio.
- **Equipo y crafteo**: los tiers de la zona (ver A6).
- **Pueblo y NPCs**: tabla con quién es, dónde está y para qué sirve.
- **Misiones**: unas 14 principales, unas 16 secundarias (en cadenas cortas) y 3 diarias nuevas.
- **Mazmorra**: salas, guardianes, puntos de control, jefe y su mecánica.

## A3. El mapa del mundo

### Cómo está armado

- El continente es **una sola escena continua**. `gpr/public/assets/mundo/etheria.json` pone cada zona en su posición, en casillas: `{ "dir": "volcan", "x": 160, "y": 210 }`.
- Cada zona guarda sus coordenadas **locales**. `WorldScene.toLocal()` y `toGlobal()` traducen entre las dos. Por eso mover el continente no rompe nada.
- Una zona tiene **4x4 trozos de 40x30 casillas de 32 px**. Vive en `public/assets/mundo/<dir>/chunk_<cx>_<cy>.json` (formato Tiled) más un `mundo.json`.
- Cada chunk tiene las capas `suelo`, `objetos` (choca), `encima` (se dibuja sobre el héroe) y `puntos` (objetos con propiedades), además de `terreno`: un código por casilla que indexa `mundo.json.terrenos` y que usa el editor.
- Las mazmorras e interiores son mapas aparte, fuera del continente. Ver la Mina: 1x2 trozos con `interior: true`.

### El generador

Cada zona se genera con `gpr/art/mapas/generar_<zona>.js`. **Copia `generar_volcan.js`**, que es el más completo. Sus secciones, en orden:

1. Semilla y ruido suave, para que salga siempre igual.
2. **Terreno lógico**: una matriz de nombres de terreno (meseta, caminos, ríos, lagos, picos del borde…).
3. **Capas de tiles**: los autotiles se eligen con una máscara de vecinos (1 arriba, 2 derecha, 4 abajo, 8 izquierda), y hay variantes aleatorias.
4. **Objetos**: la ciudad (`placeGrid` para edificios de varias casillas), decoraciones, árboles, rocas y picos.
5. **Encuentros**: tiles de hierba de combate por subzona (`POBLAR`, con los monstruos de cada una).
6. **Puntos**: `npc`, `poi`, `jefe`, `luz` (con `tipo: fogata` es un refugio donde reapareces), `salida`, `recurso` (`tipo` y `sitio`), `encuentro` (monstruos y cantidad), `secreto`, `spawn`.
7. **Partir en trozos** y escribir `mundo.json`, con `subzonas`, `clima`, `gids`, `inicio` y `encuentroHierba`.

### Reglas del mapa

- El generador **no pisa** una zona con `mundo.json.editado` (editada en la página `/editor`), salvo con `--forzar`.
- Para unir la zona con la anterior se edita el borde de la vecina **a mano en sus chunks** con un script puntual (el Paso del Humo se hizo así en las Montañas). No se regenera la vecina.
- Cada punto que el servidor necesita (forjas, muelles, NPCs) tiene que tener **las mismas casillas** en el back:
  - `lib/cercania.js` (`LUGARES`, `SERVICIOS`);
  - `lib/questSteps.js` (`NPC_HOMES`);
  - `lib/exploracion.js` (subzonas y secretos);
  - `lib/worldNodes.zonas.json` (recursos);
  - la definición de la mazmorra.
- Revisar los encuentros por subzona y que haya **caminos transitables**. Usa `--preview` y `art/mapas/bmp.js` para ver el mapa.

### El editor (`src/editor/rules.js`)

Para que la página `/editor` pinte los terrenos nuevos de la zona, hay que agregarlos en:

- `TERRAIN_LIST` y los pinceles;
- `GROUND_NAME` y `terrainOfName`;
- los `case` de `groundGid`.

## A4. El arte (concepto y técnica)

### Estilo

- **Pixel art de 32 px por casilla**, colores planos con 2 a 4 tonos por material y **contorno oscuro `#141420`**.
- Las paletas se definen como tokens cortos (`f1..f5` fuego, `rk1..rk4` roca…). Los colores que brillan (fuego, cristal, ojos) van en una tabla `GLOW` y **no llevan contorno**.
- Los dibujos se hacen **por código** en Lua, con primitivas: `px`, `rect`, `line`, `thick`, `ellipse`, `ridge` (lomo iluminado), `flame`, `vein`, `bolt`. Una semilla fija hace que el resultado salga igual cada vez.
- **Siempre se revisa con una lámina de vista previa.** Un Lua aparte junta los frames, escala x3 o x4 y exporta un PNG al scratchpad, y se mira con Read antes de instalar. Si algo se ve mal (muy claro, rayas, poco contraste), se corrige y se repite.

### Scripts y salidas

| Qué | Script (modelo) | Salida |
|---|---|---|
| Tileset del mundo, **compartido por todas las zonas** | `art/sprites/mundo/crear_mundo.lua` | `public/assets/mundo/tileset_pradera.png` + `art/sprites/mundo/tileset_pradera.json/.aseprite` |
| Recursos (frames de nodo lleno y vacío) | `crear_recursos5.lua` | `public/assets/mundo/recursosN.png` |
| NPCs (caminar 9 frames de 32x32 + retrato 64x64) | `crear_npcs_misiones.lua` (tabla de NPCs con raza, estilo y colores) | `public/assets/mundo/caminar/npc_<id>.png`, `retratos/<id>.png` |
| Enemigos de combate | `art/sprites/enemigos/crear_enemigos_<zona>.lua` | `public/assets/sprites/combate/enemigos/<clave>.png` + entrada en `enemigos.json` |
| Fondos de combate (5 capas de 640x360 con parallax; el suelo empieza en y=248) | `crear_fondo_montanas.lua`, `crear_fondo_volcan.lua` | `public/assets/combate/fondos/<zona>/1_cielo…5_primer_plano.png` |
| Mazmorra (tileset propio, brasero de control 5x32, puerta 3x128x64) | `crear_mina.lua` | `public/assets/tileset_<x>.png`, `mundo/mazmorra/*.png` |
| Peligro de clima (tormenta, brasas) | `crear_tormenta.lua`, `crear_brasas.lua` | `public/assets/mundo/clima/*.png` |
| Equipo: íconos de las piezas y lo que se ve en combate (forma + set de color) | `art/sprites/combate/crear_equipo.lua` + `src/game/gear.js` (`SHAPES`, `SETS`, `SET_BY_CODE`) | `public/assets/sprites/equipo/` (`iconos.png`, `paletas.json`, `combate/*.png`) |

### Reglas del tileset compartido (muy importante)

- Los tiles nuevos se agregan **al final**. Los ids existentes **no pueden cambiar**, porque todos los mapas guardan gids.
- Después de regenerar, compara que los tiles viejos queden idénticos: recorte con Aseprite de la parte vieja, comparado contra el original.
- Cada tile lleva `colision` y `encima` en el JSON.
- En los objetos de varias casillas (`nombre_fila_col`), la fila de arriba es `encima` y las de abajo chocan.
- Copia el script a `D:/Sprites/mundo/crear_mundo.lua`, como se hizo con los anteriores.

### Enemigos

- Se dibujan **mirando a la derecha** y el script los voltea (en combate miran a la izquierda).
- Tamaños: comunes de 48x48 (suelo en y=45), raros de 56x56 (suelo en 53), minijefes y jefes de 64x64 (suelo en 61).
- Animaciones: `idle` (2 frames, en bucle), `attack` (3), `cast` (3, solo si usa magia o skills), `hurt` (1), `die` (2, el último es el cuerpo en el suelo). El parámetro `P` controla las poses (`dx`, `bob`, `hx`/`hy` de la cabeza, `pain`, `dead` y flags propios como `swing`, `cast`, `wing`…).
- En `enemigos.json` cada entrada lleva `name`, `rank` (`comun` / `raro` / `miniboss` / `jefe` / `mitico`), `sheet`, `frameSize`, `anchor` (`{ x: size/2, y: size-2 }`) y `animations` (las da el script en `enemigos_<zona>.json`).
- La **clave es el código del monstruo** en la base (`SALAMANDRA_ROJA`), y el archivo es el código en minúsculas.

### NPCs

- Siguen la paleta de `crear_npcs_misiones.lua`.
- Una **raza nueva** se agrega como `race` (ver `"draco"`: cuernos, ojos dorados de pupila fina y cola) con sus colores en `ORDER`.
- Para generar solo algunos NPCs: `--script-param solo=npc_a,npc_b`.
- Un NPC puede reusar el sprite de otro con el override `sprite` en el punto del mapa (Gaspar usa `npc_cochero`; las balseras usan `npc_pumo`).

## A5. Monstruos y equilibrio

### La fórmula (`gprback/lib/equilibrio.js`)

**Un común de nivel L** sale de `monsterBase(L)`. Desde el nivel 16 la vida y las defensas suben más despacio:

- vida: +75 por nivel;
- defensa: +5 por nivel;
- defensa mágica: +4.5 por nivel;
- ataque: `14 + 4(L-1)`;
- velocidad: `10 + 2(L-1)`.

**Las rarezas** multiplican al común (`RARITY_MULT`):

| Rareza | Vida | Ataque | Defensas | Velocidad |
|---|---|---|---|---|
| RARE | ×1.8 | ×1.2 | ×1.1 | ×1.05 |
| MINIBOSS | ×3.5 | ×1.4 | ×1.2 | ×1.3 |
| LEGENDARY | ×6 | ×1.6 | ×1.3 | ×1.2 |

**El perfil** es el carácter de cada monstruo: `monsterRow(nivel, rareza, perfil)`.

- Multiplicadores: `hp`, `atk`, `def`, `magic_def`, `spd`.
- Extras: `evasion`, `crit_chance`, `elemental_damage`.
- `magic: true` si pega con magia.
- Ejemplos: un gólem lleva `{ hp: 1.15, def: 1.35, spd: 0.7 }`; un diablillo, `{ hp: 0.85, spd: 1.35, evasion: 5 }`.
- Los perfiles de cada zona van en `PERFILES`, dentro de `scripts/equilibrio/generar.js`.

### El objetivo de diseño

En un combate 1 contra 1, a tu nivel y con el equipo de tu tramo:

- **matas en 3-5 turnos** con la habilidad principal;
- **aguantas unos 6-8 golpes** (el Guerrero, bastante más).

Un monstruo solo es tranquilo, dos piden cuidado y tres piden pociones o compañeros.

### Cómo se comprueba: el simulador

```bash
node scripts/equilibrio/generar.js --simular
```

Hay que agregar una función `simulate<Zona>`, como `simulateVolcan`. Mide el tiempo para matar (TTK) y los golpes que aguantas, para las 5 clases, en varios niveles del rango y con el equipo del tier de cada nivel.

Resultado del Volcán: unos 4 turnos y entre 5 y 9 golpes. A nivel 45 con el set del Titán, 2-3 turnos (aceptado: es el final de la zona).

### Cómo se escribe el SQL de monstruos

Copia `gen_volcan.js`. Por cada monstruo define:

- `code`, `name`, `rarity`;
- `lo`-`hi`: los niveles en que aparece;
- `cat`: BESTIA, HUMANOIDE, ELEMENTAL, DEMONIO, DRACOIDE…;
- `elem` y `res`: resistencias por elemento, en positivo y negativo. Tienen que tener sentido: el fuego resiste fuego y es débil al agua y al hielo;
- `desc`: 1-2 frases con lore;
- `drops`: `[ítem, %, mín, máx]`. **Su material propio al 30%**, un material secundario al 8-12% y a veces un huevo de mascota al 3%;
- `skills`: `[código, % de uso]`.

Las filas de `monster_level_scalings` se calculan con `monsterRow`.

Las recompensas de los jefes escalan con el nivel. Referencias:

- Señor de la Caldera (minijefe 42): 4000 xp / 750 de oro.
- Titán de Fuego (legendario 45): 13000 xp / 5400 de oro.

### Cambios de equilibrio

Cuando se cambian fórmulas que afectan a stats ya guardadas, se agrega una fila en `balance_versions` (por ejemplo `'volcan_v1'`). El servidor recalcula los personajes (`lib/equilibrio.js`, `recalcularPersonajes`).

## A6. Ítems, equipo y crafteo

### El poder de una pieza

`itemPower(nivel, rareza) = (10 + 1.5·nivel) × rareza`. La rareza multiplica así:

| COMÚN | POCO_COMÚN | RARO | ÉPICO | LEGENDARIO |
|---|---|---|---|---|
| 1 | 1.1 | 1.2 | 1.3 | 1.45 |

Sobre ese poder:

- **Cada slot toma una parte** (`SLOT_WEIGHT`): arma 1, armadura 0.9, mano izquierda 0.55, casco, guantes y botas 0.45, accesorio 0.4.
- Un arma **a dos manos** vale ×1.5.
- Una pieza **fabricada** vale como si fuera de **+2 niveles** (`CRAFTED_BONUS`).
- `itemStats()` reparte ese presupuesto respetando **qué stats da cada objeto y en qué proporción** (su carácter). La fórmula solo fija **cuánto** da en total. Los costos están en `STAT_COST`: DEF 0.4, HP 4, SPD 0.6…

### Reglas del equipo v2/v3 (las pidió el usuario)

- **El arma lleva TODO el daño.** El resto del equipo es supervivencia: defensa, vida, maná, regeneración.
- **Cada arma pega más que la anterior a su nivel**: +7% las comunes, +8% las de mazmorra y +9% las de jefe. Se encadena con las armas finales de la zona anterior.
- **El Mago pega lo mismo que el Guerrero** en cada escalón (crecimiento de MAG 7.6). El Sacerdote pega un poco menos y cura más.
- **La mano izquierda define el estilo de juego**:

| Pieza | Para quién | Qué da |
|---|---|---|
| Escudo | Guerrero | aguante |
| Cristal | Mago que quiere daño | +8% de daño |
| Orbe | Mago que quiere aguantar | aguante + maná por ronda (`MANA_REGEN`, 4-5.5%) |
| Símbolo | Sacerdote | aguante + `HEALING` (4-5.5%) |
| Carcaj | Arquero | ataque + daño crítico + velocidad |
| Daga gemela | Pícaro | ataque + crítico + evasión + velocidad |

  Una daga con defensa sería ilógica, y no se hace.
- **Los guantes** dan aguante.
- **Las piezas de jefe** llevan un extra de clase en el pecho: `HP_REGEN` para el mago, `EVASION` para arquero y pícaro, `HEALING` para el sacerdote.
- Las stats `HEALING`, `HP_REGEN` y `MANA_REGEN` del equipo **ya funcionan en combate** (`lib/equipment.js`, `routes/combat.js`).
- Los nombres de las armas tienen que reflejar su lugar en la escalera. No puede haber una arma de nivel 5 mejor que una "crafteada" de nivel 7.

### Los tiers de una zona

Cada zona tiene unos 5 tiers. El modelo es el Volcán:

| Tier | Nivel | Rareza | Éxito | De dónde salen los materiales |
|---|---|---|---|---|
| Volcán | 31 | RARO | 90% | monstruos de las primeras subzonas |
| Obsidiana | 36 | ÉPICO | 80% | subzonas medias + un material especial (Corazón de Brasa) |
| Forja Negra | 37 | LEGENDARIO | 75% | solo armas; un material de la mazmorra (Corazón de la Forja Negra) |
| Caldera | 40 | ÉPICO | 70% | pergamino + drop del minijefe |
| Titán de Fuego | 45 | LEGENDARIO | 55% | pergamino + núcleo del jefe legendario |

- Cada tier trae las **5 clases base** y todos los slots.
- **Los materiales siguen la dificultad.** La pieza grande pide 3 + 2 + 2 materiales; la chica, 2 + 1. Cada clase usa materiales que tienen sentido: el arquero usa pelajes y colmillos, el sacerdote flores, el mago esencias.
- Las recetas se fabrican en la **forja de la ciudad de la zona** (`station: 'forja'`, el lugar se agrega a `SERVICIOS.forja` en `lib/cercania.js`) y nombran al **artesano** de la zona (`ARTISAN`).
- **Proceso en dos pasos:**
  1. `gen_equipo_<zona>.js`: piezas, stats por fórmula y recetas.
  2. `gen_escalera_<zona>.js`: aplica las reglas v2/v3, resolviendo la stat principal de cada arma con un solver para que el daño siga la escalera.
  - Al final, `EQUIPO_V2` (regex en `generar.js`) tiene que incluir las armas nuevas para que el simulador las use.
- **Los sets de jefe** (piezas que da el cofre) se registran en `lib/piezasSet.js` (`MAESTRO_LAVA: 'OBSIDIANA'`).

### La cadena de materiales: de dónde sale cada cosa y en qué se convierte

Este es el corazón de la economía. **Cada ítem tiene una identidad**: viene de un monstruo o de un recurso concreto, y su nombre y su descripción lo dicen. Por ejemplo: «Escama de Salamandra: escama roja que sigue tibia horas después de caer. La sueltan las Salamandras Rojas de la Ladera de Ceniza y los Ríos de Lava».

El jugador tiene que poder adivinar **qué monstruo matar o qué recurso picar** para lo que quiere fabricar.

```
 MONSTRUOS ──drop──▶ MATERIAL DE MONSTRUO ───────────┐
 (cada uno, el suyo)  (escama, pelaje, colmillo,     │
                       esencia, núcleo, ala, sello…)  ├──▶ EQUIPO de la zona (forja)
 RECURSOS ──picar──▶ MATERIAL DE RECOLECCIÓN ────────┤     5 clases × todos los slots
 (vetas, plantas,     (obsidiana, azufre, flor,      ├──▶ POCIONES y ELIXIRES (alquimia)
  nidos, geodas)       pómez, gema, carne)           ├──▶ COMIDAS (el cocinero de la zona)
                              │                      │
                              └──refinar──▶ MATERIAL REFINADO (lingote, acero, cuero, tela, carbón)
 JEFES ──drop──▶ PIEZA DE JEFE / NÚCLEO / PERGAMINO ──▶ sets de jefe (Caldera, Titán)
 MAZMORRA ──drop/cofre──▶ material especial (Corazón de la Forja Negra, Escoria Negra) ──▶ armas de mazmorra
 EQUIPO ──desmantelar──▶ algo de sus materiales + a veces una PIEDRA DE ENCANTAMIENTO ──▶ encantar
```

**1. Materiales de monstruo.** Cada monstruo común tiene **su material propio**:

- se suelta al ~30%;
- un material secundario se suelta al 8-12%;
- a veces sale un huevo de mascota (`HUEVO_POCO_COMUN`, ~3%).

Ejemplos del Volcán:

| Monstruo | Material propio |
|---|---|
| Salamandra Roja | `ESCAMA_DE_FUEGO` |
| Lobo de Ceniza | `PELAJE_CENIZA` |
| Escarabajo de Azufre | `CAPARAZON_AZUFRE` |
| Bandido de Fuego | `BRASA_DE_BANDIDO` |
| Elemental de Fuego | `ESENCIA_DE_FUEGO` |
| Serpiente de Magma | `COLMILLO_MAGMA` |
| Gólem de Obsidiana | `ESQUIRLA_OBSIDIANA` |
| Centinela Infernal | `NUCLEO_INFERNAL_MENOR` |
| Draco de Brasa | `ALA_DRACO` |
| Fanático del Eclipse | `SELLO_ECLIPSE` |
| Demonio de Lava | `CUERNO_DEMONIO_LAVA` |
| Diablillo de la Caldera | `COLA_DIABLILLO` |

Los raros sueltan algo mejor (POCO_COMÚN):

- `CORAZON_DE_BRASA`: lo sueltan los dracos (6%) y el Dragón Menor, y a veces sale de las geodas;
- `CRISTAL_DE_LAVA`: lo suelta el Maestro de la Lava;
- `ESCAMA_DRAGON_CORRUPTO`: la suelta el Dragón Menor.

Estos son la **llave del tier medio**: sin Corazón de Brasa no se forja el set de Obsidiana.

**2. Materiales de recolección.** Salen de los nodos del mapa (A6, "Recursos"). Ejemplos del Volcán:

| Material | De dónde sale |
|---|---|
| `AZUFRE` | fumarolas |
| `OBSIDIANA_BRUTA` | vetas |
| `FLOR_DE_CENIZA` | flores |
| `PIEDRA_POMEZ` | nidos y orillas |
| `GEMA_DE_FUEGO` | geodas (rara) |
| `CARNE_SALAMANDRA` | nidos de salamandra |

Cada zona tiene **su planta** (para pociones y comidas), **su mineral** (para el equipo) y **su carne** (para comidas).

**3. Refinados** (`MATERIAL` que se fabrica):

- Pradera: `LINGOTE_DE_HIERRO` (mineral + carbón, en la forja), `CUERO_TRATADO`, `TELA_LINO`, `TABLA_DE_ROBLE`, `HARINA`, `CARBON`, `GEMA_COMUN`.
- Montañas: `ACERO_REFINADO` (en la forja del Bastión).
- `AGUA_PURIFICADA`: se hace en el **Pilar de Aethra** (`station: 'pilar'`, el doble durante el Festival). Es la base de todas las pociones.

Una zona nueva puede agregar **su refinado** si tiene sentido (por ejemplo, "Obsidiana Pulida").

**4. Equipo** (`EQUIPMENT`, `station: 'forja'`). Ver los tiers arriba.

- La **pieza grande** pide 3 del material principal + 2 + 2. La **pieza chica** pide 2 + 1.
- **Cada clase usa los materiales de "su" monstruo**, y eso le da identidad al set:

| Clase | Materiales |
|---|---|
| Guerrero | metal, brasas de bandido, núcleos |
| Arquero | pelajes, escamas, madera, alas |
| Pícaro | caparazones, colmillos, esquirlas |
| Mago | esencias, azufre, pómez |
| Sacerdote | flores, esencias |

- Los tiers altos suman **el material especial** (Corazón de Brasa), **un drop de jefe** (Corazón de la Caldera, Núcleo del Titán) o **un material de la mazmorra** (Corazón de la Forja Negra).
- La receta lleva `artisan_name` (por ejemplo "Ignar, en la Gran Forja de Ascuaria"), `zone_id`, `success_rate_percent` (90 → 55 según el tier), `required_level` y `rarity`.

**5. Pergaminos de set de jefe** (`scroll_item_id`):

- Los sets de jefe (Caldera, Titán) piden además un **pergamino por clase** (`SCROLL_CALDERA_GUERRERO`, `SCROLL_TITAN_FUEGO_MAGO`…).
- El pergamino lo suelta el jefe. Al usarlo, el jugador **aprende** la receta (`player_learned_recipes`).
- Así el set de jefe exige vencer al jefe, no solo juntar materiales.

**6. Consumibles** (`CONSUMABLE`, sin estación: se fabrican en el taller):

- **Pociones de alquimia** (artesano "Lyra la Alquimista" o "Alquimia"): hierba + agua purificada, en versión menor o mayor. Ejemplos: Vida Menor = 2 Hierba Curativa + 1 Agua Purificada; Maná Mayor = 5 Hierba Mágica + 2 Agua + 1 Polvo Arcano.
- **Elixires y tés de zona**: material de la zona + agua. Ejemplos: Té de Flor de Ceniza (3 Flor de Ceniza + Agua); Elixir de Magma (Esencia de Fuego + Colmillo de Magma + Agua); en las Montañas, Té de Flor de Nieve y Elixir de Tormenta.
- **Comidas** (artesano = el cocinero de la ciudad): Tuli en Ascuaria, Hilda en el Bastión, Aldric en Aurelia. Mezclan la carne o un material de monstruo de la zona con la planta de la zona. Ejemplos: Asado de Salamandra (3 Carne de Salamandra + Flor de Ceniza); Estofado de Draco (2 Ala de Draco + 2 Carne + Flor); Chile de Azufre (2 Flor + Azufre + Aceite).
- Cada zona trae **1 carne, unas 5 comidas, 1 té y 1 elixir** (`gen_comidas_<zona>.js`). Las comidas dan buffs que duran un rato.

**7. Desmantelar** (`lib/desmantelar.js`, en el taller):

- Solo se desmantela equipo.
- Devuelve 1 o 2 materiales de su receta **al azar**, la mitad de lo que llevaba.
- Las piezas de jefe y los objetos de misión **nunca vuelven**.
- Según la rareza, a veces sale una **piedra de encantamiento**: RARO 15% Menor; ÉPICO 10% Mayor o 30% Menor; LEGENDARIO 25% Mayor.
- Así el equipo viejo alimenta el **encantamiento**, que es la otra forma de mejorar.

**8. Otros:**

- `dismantle_recipes`: reglas manuales de desmantelado.
- `player_known_recipes` (`lib/recetas.js`): las recetas que el jugador "descubre" se marcan como NUEVO en el Taller.
- Las misiones pueden dar materiales y comidas de la zona como recompensa (`rewards`).
- Las diarias piden materiales de recolección (6 de Azufre, 6 de Obsidiana, 4 Colas de Salamandra).

**Checklist de materiales de una zona nueva:**

- [ ] 1 material propio por cada monstruo común, con nombre y descripción que diga quién lo suelta y dónde.
- [ ] 2-3 materiales POCO_COMÚN de los raros, que sean la llave del tier medio.
- [ ] Drops de jefe: núcleo o corazón y pergaminos por clase.
- [ ] Materiales de la mazmorra para sus armas.
- [ ] ~7 recursos de recolección: planta, mineral, carne, piedra, gema rara, restos y cofre.
- [ ] Recetas de equipo de los ~5 tiers × 5 clases, usando esos materiales de forma lógica por clase.
- [ ] 1 carne, ~5 comidas, 1 té y 1 elixir con materiales de la zona.
- [ ] Ningún material "huérfano": todos se usan en al menos una receta o misión.
- [ ] Ninguna receta pide algo que no se pueda conseguir en esa zona o antes.

### Cada crafteo tiene que estar equilibrado (costo contra recompensa)

No alcanza con que las **stats** del resultado estén bien (eso lo hace la fórmula). También el **costo** de la receta tiene que estar a la altura de lo que da. La medida es: **¿cuántos combates o recolecciones hacen falta para juntar los materiales?**

**Fórmula para calcularlo.** Por cada material:

```
combates esperados = cantidad pedida / (probabilidad × cantidad media por drop)
```

Ejemplo: 3 Brasas de Bandido, que salen al 30% de 1 a 2 (media 1.5), dan 3 / (0.30 × 1.5) ≈ **6.7 bandidos**.

Para un recurso, lo mismo con su `chance` y su `min`/`max` en `NODE_TYPES`, más su tiempo de reaparición.

**Objetivo de costo** (sumando todos los materiales de la receta):

| Qué se fabrica | Esfuerzo objetivo |
|---|---|
| Poción, té o comida | 2-4 combates o recolecciones (se gasta seguido: tiene que ser barato) |
| Refinado (lingote, acero, cuero) | 1-3 recolecciones |
| Pieza chica de un tier común (casco, guantes, botas, accesorio) | ~8-12 combates |
| Pieza grande de un tier común (arma, armadura, 2 manos) | ~15-20 combates |
| Tier medio (con material POCO_COMÚN de un raro) | ~25-35 combates por pieza grande |
| Arma de mazmorra | 1-2 recorridos de la mazmorra |
| Set de jefe | pergamino del jefe (varios intentos) + su núcleo + materiales |

**El éxito baja con el tier:** 90% → 80% → 75% → 70% → 55%. Un fallo pierde los materiales, así que el costo real es costo / éxito. Tenlo en cuenta: un tier al 55% ya cuesta casi el doble.

**Comparación con lo que hay en la zona:**

- El arma fabricada de un tier tiene que ser **mejor que cualquier drop común** de ese nivel. Por eso existe `CRAFTED_BONUS` (+2 niveles).
- **No puede costar más que el tier siguiente.**
- Cada tier tiene que valer la pena **al nivel en que se desbloquea**. Si un jugador puede saltar un tier sin perder nada, el tier sobra o está mal puesto.

**Precio de venta** (`buy_price` / `max_sell_price`): el oro por vender lo fabricado tiene que ser **menor** que el valor de los materiales comprados. Si no, se abre un bucle de oro infinito.

**Revisión:** hacer una tabla (como la que se hizo para las armas: nivel, daño, % sobre la anterior y costo) y comprobar que la curva sube pareja, sin saltos ni retrocesos. El usuario lo pidió explícito: *"compara con la siguiente arma del siguiente nivel si es rentable el crafteo cuando el jugador va subiendo"*.

### Cómo se desbloquean las recetas: descubrir, candado y nivel

Así funciona hoy (`gprback/lib/recetas.js`, `routes/players.js` `/craft/available`, `gpr/src/components/world/CraftingPanel.js`):

**1. Recetas básicas (sin pergamino): se DESCUBREN.**

- Una receta aparece en el Taller **cuando el jugador consigue cualquiera de sus materiales, o la pieza que fabrica**, por cualquier vía: botín, recolección, misión o compra. Todo pasa por `inventory.addItem` → `discoverFromItems`.
- Queda descubierta para siempre (`player_known_recipes`), aunque después gaste el material.
- Al descubrirla sale el aviso **«¡Descubriste un crafteo nuevo!»** y en el Taller aparece con la marca **NUEVO** hasta que la abre (`seen`).
- Las que todavía no descubrió **no se muestran**. Solo se cuentan como "por descubrir" (`hidden`).
- **Diseño:** por eso el **primer material de cada zona tiene que ser fácil de conseguir**. Al matar el primer monstruo de la zona, el jugador ya ve aparecer sus recetas y entiende qué puede hacer.

**2. Recetas de pergamino (sets de jefe): se ven con CANDADO.**

- Muestran el ícono de candado, el nombre "???", la clase y el nivel, y el texto **«🔒 Receta sin aprender. Se aprende leyendo <Pergamino>. Lo suelta <Jefe> · X%»**.
- Solo aparecen si el pergamino lo suelta un jefe de una **zona que el jugador ya abrió** (`player_zone_unlocks`), para no adelantar el contenido de zonas futuras.
- Se ven las de **todas las clases**: el equipo de otra clase se puede fabricar para venderlo o regalarlo.
- Al **usar** el pergamino se aprende la receta (`player_learned_recipes`) y se quita el candado.
- El filtro **"Sin candado"** las oculta.

**3. Dentro de una receta visible**, el Taller muestra:

- los materiales, cada uno con `tienes / necesitas` (en rojo si falta), y un contador de cuántas puedes hacer;
- el **% de éxito** y la cantidad que obtienes;
- **dónde se fabrica**: forja, Pilar o en cualquier lado, con un aviso si no estás ahí;
- el **nivel para equipar** (verde si puedes, rojo con «todavía no puedes equiparlo»);
- la **comparación de stats con lo que llevas puesto**, en verde o rojo por stat (`StatCompare`);
- los filtros: tipo de pieza, "Puedo fabricar", "Para mi nivel" y "Sin candado".
- Orden de la lista: primero las nuevas, después las que puedes hacer y al final las de candado.

**Al hacer una zona nueva, hay que revisar que:**

- [ ] los materiales de los primeros monstruos descubran recetas del primer tier;
- [ ] cada pergamino esté en `monster_drops` de su jefe (si no, la receta con candado **no aparece nunca**);
- [ ] el jefe esté en la zona correcta (`zone_id`) para que el filtro de zonas abiertas lo muestre.

### Dónde se consigue cada cosa y con qué probabilidad (drops)

**Cómo funcionan los drops** (`routes/combat.js`, `rollMonsterDrops`):

- Los drops se guardan en `monster_drops` (`monster_id`, `item_id`, `drop_chance_percent`, `min_quantity`, `max_quantity`).
- **Cada enemigo tira sus drops por separado** (2 lobos son 2 tiradas) y cada entrada de drop se tira independiente.
- La probabilidad real es `drop_chance_percent × (1 + bono de drop %)`, con tope de 100.
- Los **pergaminos de tu propia clase** salen al **doble** (`OWN_CLASS_SCROLL_MULT = 2`), así a cada uno le cae el suyo más seguido.

**Valores de referencia de `drop_chance_percent`:**

| Qué | % |
|---|---|
| Material propio de un común | 30 (1-2 unidades) |
| Material secundario de un común | 8-12 |
| Huevo de mascota | 3-4 |
| Material de un raro | ~15 |
| Material de un minijefe | ~8 |
| Material POCO_COMÚN "llave" desde un común | ~6 (el Corazón de Brasa en los dracos) |
| Drop principal de un jefe legendario | 100 (garantizado) |
| Pergaminos | los define cada jefe |
| Pieza de set desde un raro | `lib/piezasSet.js` |

**Dónde se le muestra al jugador:**

- **Taller, receta con candado:** «Lo suelta X · %» del pergamino (`scrollSources`).
- **Bestiario** (`routes/coleccion.js` → `BestiarioPanel`): cada monstruo lista sus drops con su % y cantidades.
- **API del ítem** (`GET /api/items/:id`): trae `droppedBy` (monstruo, % y cantidades).
- **Misiones de juntar objetos** (`lib/questProgress.js`): el rastreador sabe de dónde sale cada objeto (monstruos, recursos del mapa, o si se fabrica) y lo marca en el mapa.
- **Descripción del material:** siempre dice quién lo suelta y dónde. Es la pista más directa y se escribe a mano en cada material. Por ejemplo: «La sueltan los Gólems de Obsidiana de la Cantera».

**Mejora pendiente:** en el Taller, un **material que te falta** no dice dónde conseguirlo. Sería bueno que al pasar el mouse por el material mostrara sus fuentes: monstruos con %, recursos del mapa y receta si se fabrica. Los datos ya existen (`droppedBy`, `NODE_TYPES`, recetas). Hace falta agregarlos a `/craft/available` o pedirlos con el detalle del ítem.

**Al hacer una zona nueva, hay que revisar que:**

- [ ] cada material tenga **al menos una fuente** (drop o recurso) **en esa zona o antes**;
- [ ] los % sigan la tabla de arriba;
- [ ] la descripción de cada material diga **quién lo suelta y dónde**;
- [ ] el costo de cada receta, calculado con esos %, caiga en la tabla de esfuerzo.

Un script de chequeo útil: recorrer todas las recetas de la zona y calcular sus combates esperados con `monster_drops` y `NODE_TYPES`.

### Comidas

Cada zona tiene **su carne y 5 comidas** propias con buffs (`gen_comidas_<zona>.js`). Las cocina el cocinero de la ciudad: opción `Cocinar` → ventana `taller`.

### Recursos de recolección

- Se definen tipos nuevos en `gprback/lib/worldNodes.js` (`NODE_TYPES`: loot, chance, respawn) y se colocan en `worldNodes.zonas.json` bajo la clave del id de la zona. Tienen que coincidir con `art/mapas/recursos_<zona>.json`, que escribe el generador del mapa.
- En el front se agregan en `RESOURCES` (`src/game/world/shared.js`, con `sheet` y frames), `editor/render.js` (`RESOURCE_FRAMES`), en la carga de `WorldScene.js` y `MapEditor.js`, y en la lista de golpes de `resources.js`.
- Cada zona tiene **unos 7 recursos únicos**: una veta, una planta, un nido, una geoda rara, restos y cofres.

## A6b. Cómo se equilibra el equipo de una zona, paso a paso (con los números reales del Volcán)

Este es el procedimiento completo que se usó en las Montañas y en el Volcán, para que el equipo de cada zona sea **justo en combate** y **rentable de fabricar**, venga el material de monstruos comunes, de la mazmorra o de los jefes. Hay que seguirlo en este orden.

### Paso 0. El objetivo (qué es "equilibrado")

Es un combate 1 contra 1, a tu nivel, con el equipo del tier que corresponde a ese nivel, contra el **peor monstruo común** que vive en ese nivel:

- **matar en 3-5 turnos** con la habilidad principal (lo ideal son 4);
- **aguantar unos 5-9 golpes** (el Guerrero, más);
- **nunca perder** contra un común.

El simulador escribe la meta como «4 → 5-6».

### Paso 1. Decidir los tiers de la zona

Cada zona tiene unos 5 escalones, puestos en los niveles donde el jugador **llega** a ellos, y cada uno pide algo más difícil:

| Escalón | Nivel | Rareza | Éxito | De dónde sale lo que pide | Regla |
|---|---|---|---|---|---|
| común de entrada (Volcán) | el primero de la zona (31) | RARO | 90% | comunes de las primeras subzonas | barato: se arma al llegar |
| tier medio (Obsidiana) | mitad de la zona (36) | ÉPICO | 80% | comunes de las subzonas medias + **un material POCO_COMÚN** de un raro o de un recurso raro (Corazón de Brasa) | el material raro es la "llave" |
| armas de mazmorra (Forja Negra) | 1 nivel después del medio (37) | LEGENDARIO | 75% | **solo armas**, con el material del jefe de la mazmorra (Corazón de la Forja Negra) y su escoria | premia hacer la mazmorra |
| set del minijefe (Caldera) | el nivel del minijefe (40) | ÉPICO | 70% | **pergamino** del minijefe + su núcleo | hay que vencerlo |
| set del jefe (Titán de Fuego) | el último de la zona (45) | LEGENDARIO | 55% | **pergamino** del jefe legendario + su núcleo | el mejor equipo de la zona |

Lo genera `gen_equipo_<zona>.js` (paso 1 del SQL), con los materiales por clase de A6.

### Paso 2. Stats base por fórmula (`lib/equilibrio.js`)

- `itemPower(nivel, rareza) = (10 + 1.5 × nivel) × rareza`. Rareza: COMÚN 1, POCO_COMÚN 1.1, RARO 1.2, ÉPICO 1.3, LEGENDARIO 1.45.
- Las piezas **fabricadas** cuentan como **+2 niveles** (`CRAFTED_BONUS`). Por eso lo fabricado le gana a cualquier drop del mismo nivel.
- Cada slot toma su parte (`SLOT_WEIGHT`): arma 1, armadura 0.9, mano izquierda 0.55, casco, guantes y botas 0.45, accesorio 0.4. Las armas **a dos manos**, ×1.5.
- `itemStats` reparte ese presupuesto **respetando qué stats da cada pieza y en qué proporción**. Los costos están en `STAT_COST`: 1 de ATK o MAG vale lo mismo que 2.5 de DEF o 0.25 de HP.
- Crítico, evasión y daño crítico salen de la rareza.

Esto da piezas "parejas", pero todavía no garantiza que **el arma nueva le gane a la anterior** a su nivel. Eso lo hace el paso 3.

### Paso 3. La escalera de daño (`gen_escalera_<zona>.js`)

**Regla v2/v3:** el **arma lleva todo el daño** y cada arma pega un **porcentaje fijo más que la mejor arma anterior, medido al nivel de la nueva**:

- +7% las comunes;
- +8% (o +9%) las de mazmorra;
- +9% las de jefe.

El resto del equipo es supervivencia.

**El modelo de daño** (función `damage` del script) es el golpe con la habilidad del tramo alto contra un común de ese nivel:

```
crudo  = 50 + 1.7 × (stat base de la clase + crecimiento × (nivel − 1) + stat del arma)
golpe  = max(crudo × 0.35, crudo − 0.5 × defensa del común de ese nivel)   (0.35 = DAMAGE_FLOOR)
daño   = golpe × (1 + prob. de crítico × daño crítico)
         prob. de crítico = 10% + pasiva (Arquero 15, Pícaro 25) + crítico del equipo
         daño crítico     = 50% + extra del arma (15 en mazmorra y minijefe, 18 en el jefe final)
```

Para la defensa usa la de `ATK` contra `def`, o `MAG` contra `magic_def` en el Mago y el Sacerdote.

**Cómo se calcula cada arma:**

1. **Objetivo** = el daño de la **mejor arma anterior** (incluidas las finales de la zona anterior: Acantilado y Rey de la Montaña), **calculado al nivel del arma nueva**, × (1 + %).
2. Un **solver** (búsqueda binaria, `solveMain`) encuentra la stat principal que da exactamente ese daño.
3. Casos especiales:
   - **Mago:** su arma da el **mismo daño que la del Guerrero** en ese escalón (paridad). Su **Cristal** suma +8% aparte.
   - **Arquero y Pícaro:** arma + mano izquierda llegan juntos al objetivo. El carcaj o la daga gemela se lleva una parte (`SHARE = 0.5` de `itemPower(nivel+2) × 0.55` en ATK), más crítico o daño crítico y evasión.
   - **A dos manos:** misma proporción que tenía sobre la de una mano.
   - **Guantes, Orbe y Símbolo:** salen de la defensa y la vida de la armadura del set, más su extra: Orbe `MANA_REGEN` 4-5.5%, Símbolo `HEALING` 4-5.5%.

**Resultado real en el Volcán** (la stat principal del arma de una mano):

| Clase | Acantilado 26 | Rey Mont. 30 | **Volcán 31** | **Obsidiana 36** | **Forja Negra 37** | **Caldera 40** | **Titán F 45** |
|---|---|---|---|---|---|---|---|
| Guerrero (ATK) | 136 (+12% cd) | 161 (+15% cd) | 175 | 210 | 247 (+15% cd) | 285 (+15% cd) | 326 (+18% cd) |
| Mago (MAG) | 130 | 152 | 178 | 214 | 252 | 290 | 333 |
| Arquero (ATK, sin el carcaj) | 119 | 134 | 162 | 189 | 217 | 250 | 277 |

Se lee así:

- La Forja Negra está **solo 1 nivel** después de la Obsidiana, pero pega +9% y suma daño crítico: el premio de hacer la mazmorra se siente **enseguida**.
- La Caldera y el Titán F siguen subiendo aunque el jugador también sube de nivel, porque el % se mide al nivel de la pieza nueva.

Al terminar, agrega las armas nuevas a la expresión `EQUIPO_V2` de `scripts/equilibrio/generar.js`, para que el simulador las use.

### Paso 4. Validar con el simulador

```bash
node scripts/equilibrio/generar.js --simular
```

Agrega una función `simulate<Zona>` (modelo: `simulateVolcan`). Para cada clase y nivel, arma el equipo del tier de ese nivel y pelea contra **el peor común que vive a ese nivel**. Resultado real del Volcán, en *turnos para matar / golpes que aguanta*:

| Clase | nv31 | nv33 | nv35 | nv36 | nv37 | nv39 | nv40 | nv42 | nv44 | nv45 |
|---|---|---|---|---|---|---|---|---|---|---|
| Guerrero | 4/9 | 4/8 | 4/8 | 4/9 | 4/9 | 4/9 | 4/9 | 4/9 | 4/13 | 3/14 |
| Mago | 4/7 | 4/6 | 4/6 | 4/6 | 4/6 | 4/6 | 4/5 | 4/5 | 4/5 | 3/6 |
| Arquero | 3/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/6 | 2/7 |
| Pícaro | 3/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/5 | 4/6 | 2/8 |
| Sacerdote | 4/7 | 4/6 | 5/6 | 4/6 | 4/6 | 4/6 | 4/6 | 4/6 | 4/6 | 3/7 |

**Cómo leerlo:**

- Todo está en 4 turnos y entre 5 y 9 golpes: está bien.
- A nivel 45, con el set del Titán (el mejor de la zona), baja a 2-3 turnos. Está **aceptado**, porque es el premio final y la zona siguiente empieza más fuerte.
- **Si algo se sale** (6 o más turnos, o menos de 4 golpes):
  - si es en todos los niveles, ajusta el **perfil del monstruo** (`PERFILES`);
  - si es en un tramo, el **% del escalón** o el **nivel del tier**.
  - Nunca toques la fórmula general por una zona.

### Paso 5. Que fabricarlo sea rentable (costo en combates)

Para cada receta, calcula cuántos combates cuesta juntar sus materiales:

```
combates por material = cantidad / (probabilidad de drop × cantidad media por drop)
costo de la receta    = suma de los materiales / probabilidad de éxito
```

**Ojo: usa la fuente REALISTA a ese nivel**, no la más generosa. El Corazón de Brasa sale al 100% del Titán (nivel 45), pero quien fabrica Obsidiana a nivel 36 lo saca de los **Dracos de Brasa al 6%** (≈17 combates) o de las geodas. El Acero Refinado no se caza: se **refina** con mineral y carbón (recolección), así que cuenta como recolección, no como combates.

**Números del Guerrero en el Volcán:**

| Receta | Lo que pide | Costo aproximado | ¿Cae en la tabla de esfuerzo (A6)? |
|---|---|---|---|
| Casco Volcán (pieza chica) | 2 Brasas de Bandido (30%, 1-2) + 1 Acero | ≈4-5 combates + refinar, /0.9 | sí, en el borde bajo: la pieza chica es barata a propósito |
| Arma Volcán (pieza grande) | 3 Brasas + 2 Caparazones de Azufre + 2 Acero | ≈11 combates + refinar, /0.9 ≈ 13 | sí (se suma la recolección del acero) |
| Arma Obsidiana (tier medio) | 3 Esquirlas + 2 Núcleos + 1 Corazón de Brasa + 2 Acero | ≈6.7 + 4.4 + 17 ≈ 28, /0.8 ≈ **35** | sí, 25-35 |
| Arma Forja Negra (mazmorra) | 1 Corazón de la Forja Negra (Morvak 50%) + 6 Escoria Negra (Morvak 100% 2-3, guardianes 30-40%) + 2 Esquirlas + 3 Acero | ≈2 recorridos de la Fisura + unos combates | sí, 1-2 recorridos |
| Sets de Caldera / Titán | pergamino del jefe (varios intentos) + su núcleo + materiales | lo marca el jefe | sí |

**Preguntas de rentabilidad que hay que contestar con "sí" antes de dar una zona por terminada:**

1. ¿Lo fabricado le gana a **cualquier drop** de su nivel? (Sí, por el +2 de `CRAFTED_BONUS` y la escalera.)
2. ¿Cada tier **vale la pena al nivel en que se desbloquea**? Si un jugador puede saltarse un tier sin perder nada, ese tier sobra o está mal puesto.
3. ¿Ningún tier **cuesta más** que el siguiente?
4. ¿La **mazmorra** da algo que no se consigue fuera, y vale más que farmear comunes? (Forja Negra: +9% y daño crítico, un nivel después del tier medio.)
5. ¿Los **jefes** dan el mejor equipo, protegido por el pergamino, para que haya que vencerlos?
6. ¿Ninguna receta pide un material que **no se consigue** en esa zona o antes (o que solo da un jefe de más adelante)?
7. ¿Vender lo fabricado da **menos** oro que comprar sus materiales? (Si no, hay oro infinito.)

### Paso 6. Lo que NO entra en la escalera (pero hay que tener en cuenta)

- **Calidad** de la pieza (`QUALITY_TIER_MULTIPLIER`): ×1 / ×1.15 / ×1.35 / ×1.6 / ×2.0.
- **Encantamiento:** +5% por nivel, hasta +10 (+50%).

La escalera compara piezas **base** (calidad 0, +0). Un arma vieja muy encantada y de calidad alta puede pegar más que la siguiente base. Eso está bien: es el premio por haber invertido. Pero **no se equilibra contando con eso**: el jugador normal tiene que poder avanzar con piezas base.

### Paso 7. Cerrar

1. Aplica el SQL (equipo, escalera) en local, con `aplicar_sql.js`, dos veces.
2. Agrega una fila nueva en `balance_versions` (por ejemplo `'zonaN_v1'`), para que el servidor recalcule las stats guardadas de jugadores y compañeros.
3. Vuelve a correr el simulador.
4. Revisa en el Taller del juego, o pídele al usuario que lo revise, que la comparación verde/rojo con lo equipado sea coherente.
5. Agrega el SQL a `schema.sql`.

## A7. La mazmorra

### El motor

El motor es `gprback/lib/mazmorra.js` (`crearMazmorra(def)`). Cada mazmorra es un archivo `lib/<nombre>.js`. **Copia `lib/fisura.js`.** Define:

- `zoneDir`, `zoneId`, la tabla de recorridos (`player_<x>_runs`), `levels { min, max }` y `minLevel`;
- **los puntos de control** (`braseros`): cubas, faroles…; si caes, retomas desde el último;
- **tres guardianes** que patrullan, cada uno con su caja `box` en casillas y sus monstruos. Si te ven, te persiguen;
- **el jefe** (`bossSpot`, `boss`) con su mecánica:
  - `weakCycle`: el escudo cambia de debilidad;
  - `beam`: un ataque marcado que se esquiva defendiéndose;
- `monsters`: con `scalings` sacados de `monsterRow` y `skills`;
- `drops`, el `chest` (cada X horas: oro, pociones, una pieza del set de la zona o el material especial), los `items` propios, `access` (misión y llave) y `texts`.

### Cómo se conecta

- Se registra en `lib/mazmorras.js`.
- Se monta en `server.js`: `app.use('/api/player/:playerId/world/<x>', require('./routes/mazmorra')(require('./lib/<x>')))`.
- Los monstruos, ítems y drops se siembran solos al arrancar.

### En el front

- El mapa se genera con `art/mapas/generar_<x>.js` (modelo `generar_mina.js`):
  - **las casillas de braseros, guardianes, puerta (`sello`) y jefe (`vigia`) tienen que coincidir con el back**;
  - `mundo.json` lleva `interior: true`, `mazmorra: '<x>'` y `mazmorraArte` (brasero, puerta, luzPuerta).
- `src/game/world/shared.js`: `DUNGEONS.<x> = { min, max, codePrefix }`.
- `Battle.js`: `DUNGEON_BACKGROUND` si tiene fondo propio.
- `World.js`: `ZONE_TITLES`.

## A8. NPCs

Cada NPC nuevo necesita **todo esto**, o queda roto:

1. **Sprite** de caminar y **retrato** (A4).
2. **Punto en el mapa**: `npc(...)` en el generador, con `nombre`, `sprite`, `dialogo`, `etiqueta` y `pasea` (0 = quieto, más = radio).
3. **Diálogo** en `src/game/dialogues.js` (o `dialoguesCiudad.js` en Aurelia):
   - `name`, `role`, `portrait`, `ambient` (3-4 frases cortas en globito);
   - `greet(ctx)`: según `mark` (`'?'` para entregar, `'!'` para aceptar), según las misiones hechas con `hecho(ctx, 'CODIGO')` y según `night`;
   - `options`: con `window` (`taller`, `encantador`, `artesanos`, `enfermeria`…), `next` (una línea de lore) o `action` (`viaje`, `vagoneta`, `balsa`…);
   - `lines`: el lore que abre `next`.
4. **Casa** en `gprback/lib/questSteps.js` (`NPC_HOMES`, en casillas locales) para que los pasos de misión sepan dónde está.
5. **Lugar** en `src/game/questGivers.js` (`NPC_LUGAR`): el texto "Entrégasela a X, en …".
6. Si da un servicio (forja, viaje): una entrada en `gprback/lib/cercania.js`.

### Phasing: NPCs que aparecen, se van o se reemplazan según la historia de CADA jugador

El mundo cambia con la historia, pero solo para quien la vivió. Dos jugadores parados en el mismo lugar pueden ver NPCs distintos.

**Aparecer y desaparecer.** En el punto del NPC del mapa (`src/game/world/npcs.js`, `story`):

- `requiere: 'CODIGO_MISION'`: el NPC **no está hasta que completas esa misión**. Ejemplo: Dora y Kili están perdidos en las minas hasta que los rescatas.
- `oculto_tras: 'CODIGO_MISION'`: el NPC **se va cuando la completas**. Ejemplo: Ren y Tilo se van de la Aldea al terminar «Hacia las montañas».
- Mientras no se sabe qué misiones hizo el jugador, los NPCs con condición no se muestran.

**Reemplazos** (`STAND_INS` en `src/game/questGivers.js`):

- Cuando un NPC se va con la historia, otro atiende su puesto y sus misiones. Ejemplo: Brin, la aprendiza de Ren, toma su tablón.
- `npcFor()` traduce quién da las misiones. `questTargetsOf()` hace que el servidor "oiga" al original.

**El mismo personaje en otra zona.** Se crea **otra clave de NPC** con su propio diálogo y casa:

- `ren_bastion` y `tilo_bastion` en las Montañas;
- `gaspar_volcan` en el Volcán, además de `cochero` y `cochero_aldea`.

Con `requiere` aparece en el lugar nuevo después de la misión que lo lleva ahí, y con `oculto_tras` desaparece del lugar viejo. Así **los personajes viajan con la historia**.

**Diálogos que cambian.** `greet(ctx)` usa `hecho(ctx, 'CODIGO')`, así que nadie te agradece algo que no hiciste. Pon un saludo distinto **después de cada misión importante** de ese NPC: el mundo "recuerda" lo que hiciste.

**Ideas para usar más el phasing:**

- un pueblo que se reconstruye (casas quemadas → reparadas tras la misión);
- un campamento enemigo que desaparece al vencer a su jefe;
- la cría de dragón (Brasita) que aparece junto a Chispa al terminar «¡Crac!».

Para esto, los **objetos del mapa** necesitan la misma condición `requiere` / `oculto_tras` que ya tienen los NPCs. Hoy solo la tienen los NPCs: está pendiente.

**Los NPCs no se tiran sueltos por el mapa.** Cada uno vive donde tiene sentido según su historia:

- el alquimista, entre las fumarolas;
- la guardabosque, en el bosque quemado;
- el balsero, en el muelle;
- el anciano, en el nido del dragón que crió.

## A9. Misiones

### El generador

`gen_misiones_<zona>.js` (modelo en `_respaldo_claude/volcan/`) usa un helper `quest({ ... })` con:

- `code`: `ZONA_HISTORIA_NN_X`, `ZONA_QN_X` (las que tienen jefe), `ZONA_SEC_X` o `ZONA_DIARIA_X`;
- `name`, `type` (`PRINCIPAL` / `SECUNDARIA` / `DIARIA`), `lv`, `stars`, `chain`;
- `req`: la misión anterior. **La primera de la zona pide la última de la zona anterior**;
- `giver` y `turn` (los NPCs que la dan y la reciben), `loc`, `xp`, `gold`, `rep`, `rewards`;
- `desc`: el pedido, con la voz del NPC y entre comillas «»;
- `entrega`: lo que dice al recibirla;
- `obj`: la lista de objetivos.

Tipos de objetivo:

| Tipo | Parámetros |
|---|---|
| `KILL_MONSTER` | monstruo y cantidad |
| `INVESTIGATE` | punto en el mapa (`V(x, y, { label, speaker, dialog, sprite, gives })`) |
| `TALK` | `npc`, y opcional `gives` |
| `DELIVER` | `npc`, `item`, `n` |
| `COLLECT_ITEM` | ítem y cantidad |
| `AMBUSH` | `monsters` |
| `DEFEAT_BOSS` | jefe |
| `VISIT` | lugar |

- Los puntos se corren solos a la casilla libre más cercana (`freeNear`, usando `mapa_<zona>.js`).
- Los **ítems de misión** van en `QUEST_ITEMS`, con descripción con lore.

### Estructura de una zona

- **Unas 14 principales.** Son la historia de A1, en orden, y cada una lleva a la subzona siguiente:
  - la mazmorra se abre a la mitad;
  - el minijefe va cerca del final;
  - la última es el jefe legendario y llevar el Fragmento a Elenya.
- **Unas 16 secundarias**, en cadenas de 2 a 4: rivalidades (Brokk contra Ignar), amistad, ternura (el huevo de dragón), humor (Trueno) y recolección/fabricación.
- **3 diarias nuevas**, más las diarias viejas de esa zona reasignadas a sus NPCs.

### Las marcas sobre los NPCs (`!` y `?`)

Hoy (`src/game/questGivers.js` → `questMarks`, colores en `src/game/world/npcs.js` → `setNpcMarks`):

- **`!` amarillo** (`#ffd84a`): tiene una misión que ya puedes aceptar.
- **`?` verde** (`#7dff9a`): tienes una misión suya lista para entregar.
- **`!` gris**: tendrá una misión dentro de poco (te faltan 3 niveles o menos, `SOON_LEVELS`).
- Las misiones triviales (6 niveles por debajo de ti, `TRIVIAL_LEVELS`) no se marcan.

**Regla que pidió el usuario:** las misiones **principales (historia, `quest_type = 'PRINCIPAL'`) llevan el `!` en ROJO**, y las secundarias, diarias y demás llevan el `!` **amarillo**. Así el jugador distingue de un vistazo qué hace avanzar la historia.

**Ya está hecho.** Así funciona:

1. `questMarks` pone la marca `'!!'` cuando la misión disponible es `q.quest_type === 'PRINCIPAL'`. Le gana a la amarilla y queda por debajo del `?`: `rank = { gris: 1, '!': 2, '!!': 3, '?': 4 }`.
2. `setNpcMarks` (`npcs.js`) la dibuja como un `!` rojo (`#ff5a4a`) y pinta del mismo color el punto del minimapa.
3. El mapa (M) usa la clase `mp-npc--historia` y el marco del objetivo, `hud-target-mark--historia`.
4. Los diálogos siguen recibiendo `mark: '!'`: `World.js` normaliza `'!!'` y además pasa `story: true`, por si un saludo quiere distinguirlas.

`quest_type` viene en la lista de misiones disponibles de `routes/players.js`.

### Qué tipos de misión hay y cómo hacerlas entretenidas

Los tipos de **objetivo** están en la tabla de arriba. Las misiones de una zona se arman combinándolos en estos **estilos**:

| Estilo | Cómo es | Ejemplo real |
|---|---|---|
| **Historia** (PRINCIPAL) | avanza el conflicto de la zona; mezcla investigar, pelear, hablar y un jefe | V9 «El Maestro de la Lava» |
| **Caza** | matar X de un monstruo que molesta, con motivo | limpiar la Ladera de salamandras (V2) |
| **Recolección** | juntar recursos (`COLLECT_ITEM`) y llevarlos | 6 de Azufre para Sulfo |
| **Entrega / mandado** | llevar un ítem de misión de un NPC a otro (`DELIVER` / `TALK` con `gives`), a veces cruzando zonas | la carta de Ignar a Brokk, en Aurelia |
| **Investigación** | examinar puntos del mapa (`INVESTIGATE`) que cuentan una historia con pistas | seguir las huellas de Trueno |
| **Emboscada** | al llegar a un punto empieza un combate fijo (`AMBUSH`) | los bandidos que vuelven al Bosque |
| **Fabricación** | fabricar algo en el taller o llevar materiales para que el NPC forje | las pruebas de forja de Ignar (V5) |
| **Cadena de personaje** | 3-4 misiones con el mismo NPC que cuentan su historia | el huevo de Chispa: frío → calor de dragón → ¡Crac! |
| **Rivalidad / amistad** | dos NPCs que se pelean y tú haces de mensajero | Brokk contra Ignar (×4) |
| **Diaria** | corta y repetible, recolección o caza; se sortean 3 por jugador por día | Colas para la parrilla |

**El condimento: cada misión necesita algo memorable.** No basta con "trae 5 cosas". Al menos una de estas:

- **Un toque gracioso:**
  - Trueno dormido junto al horno con doce brochetas en la panza;
  - Ignar que llora con el chile «y dice que es el humo»;
  - Pumo que cobra igual pero con una sonrisa;
  - Sulfo que no siente el olor.
- **Un giro:**
  - el que parecía malo no lo era (en Costas, Rhaegar cazaba Ocultos);
  - el que ayudaba era culpable sin saberlo (Ignar forjó los cristales);
  - el monstruo sufre en vez de ser malo (el dragón que lloraba fuego).
- **Ternura o emoción:** el Viejo Escamas y el último vuelo de Llamita; la guardabosque que replanta el bosque quemado.
- **Una recompensa con sentido:** la cocinera te da su comida; el herrero, piedras de encantamiento; la niña, el huevo de mascota (`HUEVO_RARO`).

**La voz:**

- La descripción (`desc`) es el **pedido dicho por el NPC**, entre «», con su personalidad.
- La `entrega` es su reacción.
- Los diálogos de `INVESTIGATE` cuentan lo que ves o lo que dice otro (`speaker`).
- Todo es corto, en tuteo neutro.

### Revisión

```bash
node revisar_misiones.js <zoneId>
```

Revisa NPCs, puntos, ítems y cadenas. Tiene que dar **0 problemas**.

## A10. La mecánica única y el clima

### Peligro del mundo

Es un módulo del front `src/game/world/<x>.js`, mezclado en `WorldScene` con `Object.assign` y llamado en `update`. Modelos: `tormenta.js` y `brasas.js`.

- Zona y subzonas afectadas.
- Aviso visual: una sombra que crece.
- Golpe que emite un evento al bus.
- Refugios seguros: fogatas y arcos.

En el back, `lib/<x>.js` aplica el daño de verdad, con espera entre golpes y **sin matar nunca** (deja 1 de vida). Su ruta va en `routes/world.js`.

### Viaje rápido

Cada zona tiene uno que tenga sentido: diligencia, vagonetas, balsas…

- Se paga en oro (15-20).
- Solo lleva a lugares que **ya visitaste caminando**: se comprueba con `player_exploration`.

### Clima

- Va en `mundo.json.clima`: `lluvia`, `nieve` o `ceniza` (probabilidad).
- Las partículas y el tinte del cielo están en `WorldScene.createWeather` / `updateSky`.
- El ícono va en el HUD de `World.js`.

### Exploración

`lib/exploracion.js`:

- `ZONES.<zona>`: subzonas con rectángulos y recompensa al completarla.
- `SECRETS`: unos 3 secretos escondidos por zona.

## A11. Evoluciones de clase (cómo están e ideas)

### Cómo están hoy

- 5 clases base (Guerrero, Mago, Arquero, Pícaro, Sacerdote) y **94 evoluciones**: 99 clases en total en `classes`.
- **El árbol** está en `class_evolutions` (`class_id` → `evolves_to_class_id`, `required_level`). Hay evoluciones en los niveles 15, 20, 25, 30, 35, 40, 45, 50 y 70. Por ejemplo, a nivel 15: Guerrero → Monje / Espadachín / Caballero.
- **Los requisitos** están en `class_evolution_requirements` (`requirement_type`):
  - `COUNTER`: el más usado. Contadores de cosas que hiciste, como matar X o usar Y.
  - `ITEM`: tener un objeto.
  - `EQUIPMENT`: llevar cierto equipo, por ejemplo «un set completo de armadura pesada».
  - `STAT_THRESHOLD`: por ejemplo «ATK mayor a 150».
  - `NO_WEAPON`: el Monje.
- **Las evoluciones se descubren** (`player_evolution_discoveries`).
- **Los maestros:** cada evolución tiene su maestro (`class_masters`) con diálogo y tienda. El detalle está en `docs/backend-spec-maestros-evolucion-contenido.md`. Faltan sus skills y misiones.
- **Las stats** de una evolución se derivan de su clase base (`lib/equilibrio.js`, `CLASS_GROWTH`).

### Ideas para conectar las evoluciones con las zonas

Son propuestas, no están hechas. Antes de hacerlas, consultarlas con el usuario.

1. **Las evoluciones de raza se aprenden en la ciudad de esa raza** (`mapa_etheria.md` §4):
   - Ascuaria: Paladín Dracónido (`DRAGON_CABALLERO`) y Mago Piromántico;
   - Fiordo Blanco: Berserker, Titán Furioso y Mago Criomántico;
   - Sylvaren: las élficas.

   Así viajar tiene premio: el maestro está en esa ciudad, no en Aurelia.
2. **Un requisito que viene de la zona.** Que el requisito de la evolución sea algo de su zona temática. Por ejemplo, el Mago Piromántico pediría:
   - `COUNTER`: vencer 50 elementales de fuego;
   - `ITEM`: una Gema de Fuego de las geodas del Volcán;
   - una misión de clase con Ignar.
3. **Una misión de prueba por evolución**, dada por su maestro, con lore propio. Por ejemplo, el Paladín Dracónido tiene que domar a un Draco de Brasa en el Nido.
4. **Un arma o pieza de "rito"**: la primera arma de la evolución, que se forja con la receta del maestro y materiales de su zona.
5. **Que coincida con los niveles de zona:**
   - las evoluciones de nivel 15 llegan al final de la Pradera;
   - las de 30, al final de las Montañas;
   - las de 45, al final del Volcán.

   Cada zona puede **cerrar con una evolución** como recompensa de su arco.
6. **El equilibrio:** antes de abrir una evolución nueva, correr el simulador con su clase para que no rompa el objetivo de turnos.

## A12. Los demás sistemas del juego y qué hacer con cada uno en una zona nueva

Una zona no termina en el mapa, los monstruos y las misiones. El juego tiene más sistemas que la tocan. Aquí está **cómo funciona cada uno por dentro** (con los números reales del código) y **qué hay que hacer** al agregar una zona. Están marcados los que hoy están **incompletos**.

Resumen rápido:

| # | Sistema | ¿Se arregla solo con la zona nueva? |
|---|---|---|
| 1 | Bestiario, amuletos y cartas | casi solo (revisar la categoría de los monstruos) |
| 2 | Mascotas y huevos | hay que poner huevos en los drops; idealmente, mascotas nuevas |
| 3 | Jefe mítico | **no**: hoy solo existe en la Pradera |
| 4 | Eventos del calendario | no hace falta, salvo que la zona tenga uno propio |
| 5 | Encantamiento | solo (las piedras salen de desmantelar y de recompensas) |
| 6 | Reputación y rangos | solo (las misiones dan `rep`) |
| 7 | Diarias | hay que crear 3 y reasignar las viejas |
| 8 | Torre | no (es aparte), pero se abre con capítulos de historia |
| 9 | Exploración y secretos | **sí**: subzonas, premio y 3 secretos |
| 10 | Música | **sí**: cada zona tiene su tema (Pradera, ciudad, mazmorra, Montañas y Volcán) |
| 11 | Carteles de zona | **sí**: `ZONE_TITLES` |
| 12 | Guía y flechas de rastreo | casi solo |
| 13 | Mercader y venta a NPC | **sí**: un mercader en la ciudad de la zona (Lyra, Mirna, Marga en Ascuaria) |
| 14 | Dónde despiertas al caer | solo, con las fogatas del mapa |
| 15 | Fondos de combate | **sí** |
| 16 | Editor de mapas | **sí**: terrenos y recursos nuevos |
| 17 | Mapa del mundo (M) | **sí**: `atlas.js` |
| 18 | Gremio | solo (los encargos cuentan en cualquier zona) |
| 19 | Paso entre zonas y desbloqueo | **sí** |

---

### 1. Bestiario, amuletos y cartas (la "Colección del cazador")

**Archivos:** `gprback/lib/coleccion.js`, `routes/coleccion.js`, `lib/huntRewards.js`; front `BestiarioPanel.js` y `coleccionArt.js`.

**Cómo funciona:**

- **El bestiario** (estilo Tibia): cada monstruo tiene una ficha por jugador, que avanza con las muertes (`player_bestiary`). Las etapas son: 1 = ves sus estadísticas, 2 = ves su botín con los %, 3 = **dominado**, que da puntos.

| Rareza | Muertes por etapa | Puntos al dominarlo |
|---|---|---|
| COMMON | 20 / 75 / 200 | 5 |
| RARE | 10 / 30 / 80 | 10 |
| MINIBOSS | 2 / 6 / 15 | 20 |
| LEGENDARY | 1 / 3 / 8 | 40 |
| MYTHIC | 1 / 2 / 3 | 60 |

- **Los amuletos** se compran con esos puntos y tienen 3 niveles:
  - Bolsa del Mercader: +oro.
  - Pluma del Erudito: +experiencia.
  - Ojo del Rastreador: +botín.
  - Trébol del Coleccionista: +cartas.
  - Hoja de Respiro: curarse al ganar.
- **Las cartas** (estilo Ragnarok): cada monstruo puede soltar **su carta**, que se engarza en una ranura del equipo, una por slot.
  - Probabilidad de que salga: común 0.25%, raro 0.5%, minijefe 2%, legendario 4%.
  - **El efecto sale de la categoría del monstruo:**

| Categoría | Efecto |
|---|---|
| BESTIA, INSECTOIDE | +botín |
| HUMANOIDE, DEMONIO | +oro |
| ESPECTRO, MUERTO_VIVIENTE | +experiencia |
| ACUÁTICO | vida al ganar |
| ELEMENTAL | maná al ganar |
| DRACOIDE | −daño recibido |
| CÓSMICO | +cartas |

  - La rareza multiplica la fuerza. Un monstruo puede tener carta propia con `CARD_EFFECT_BY_CODE`.
  - Las cartas se venden en el mercado.
- **Regla de diseño:** todo da bonos de **utilidad** (oro, experiencia, botín, recuperarse, aguantar), **nunca ataque puro**, para no romper el equilibrio del equipo.
- **El arte de la carta** es el retrato del monstruo, sacado de su hoja de combate (`enemigos.json`), con el marco de su rareza (`crear_coleccion.lua`).

**En una zona nueva:**

- Los monstruos entran solos al bestiario al estar en `monsters`.
- Revisa que **cada uno tenga `category`** (define su carta) y sprite en `enemigos.json` (si no, la carta queda sin retrato).
- Variedad: que la zona tenga monstruos de **varias categorías**, para que haya cartas distintas. El Volcán tiene bestias, humanoides, elementales, demonios y dracoides.
- Opcional: el **sobre de cartas** del mercader ambulante es de la Pradera (`lib/eventos.js`, `CARD_PACK`). Se podría hacer uno por zona.

### 2. Mascotas y huevos

**Archivos:** `gprback/routes/pets.js`, `lib/pets.js`; front `PetsPanel.js`, `src/game/pets.js`, `public/assets/mundo/mascotas.png`.

**Cómo funciona:**

- Los monstruos sueltan **huevos** por rareza: `HUEVO_COMUN`, `HUEVO_POCO_COMUN`, `HUEVO_RARO`, `HUEVO_EPICO`, `HUEVO_LEGENDARIO`. El `HUEVO_COSMICO` sale de la tienda del World Boss.
- El huevo va a la **incubadora** (una sola, `player_incubator`). Tarda en eclosionar según su rareza: común 15 min, poco común 45 min, raro 1.5 h, épico 2 h, legendario 4 h.
- Al eclosionar sale **una mascota al azar de esa rareza** (tabla `pets`, hoy 55).
- La mascota activa da **bonos** (`pet_bonuses`: un valor base más uno por nivel). Por ejemplo `ATK_FLAT`, `GOLD_PERCENT`, `DROP_RATE_PERCENT`, `HEAL_BONUS_PERCENT`, `PASSIVE_REVIVE`…
- Sube de nivel con el vínculo (`bond_points`). La Piedra de Trascendencia sube su tope.
- **En el mapa** la mascota te sigue con un sprite de `mascotas.png`. Hay 8 especies: lobo, ave, limo, gato, dragón, zorro, tortuga y araña. La especie **se elige por palabras del nombre** (`src/game/pets.js`): "salamandra" o "fénix" usan el sprite de dragón; si no coincide nada, sale limo.

**En una zona nueva:**

- Pon **huevos en los drops** de los monstruos de la zona: `HUEVO_POCO_COMUN` al ~3% en los comunes; los raros y minijefes, un huevo mejor.
- Una **mascota temática** es un gran premio de historia. Ejemplo: `HUEVO_RARO` en «¡Crac!» de Chispa, y la cría de dragón.
- Para mascotas nuevas de la zona: agrega filas en `pets` y `pet_bonuses` (SQL repetible). Si su especie es nueva, dibuja 2 frames y súmalos al final de `mascotas.png` y a `PET_SPECIES` en `shared.js`, con su regla de nombre en `src/game/pets.js`.
- **Ojo:** hoy la eclosión elige **cualquier** mascota de la rareza, de cualquier zona. Si se quiere "mascotas de la zona", haría falta guardar en el huevo de dónde vino. Es una mejora posible.

### 3. Jefe mítico de zona (cacería entre todos)

**Archivos:** `gprback/lib/mythic.js`; front `src/game/world/mythic.js` y `components/world/MythicHunt.js`.

**Cómo funciona** (estilo "S-rank Hunt" de FFXIV):

1. Entre **todos los jugadores** se cazan monstruos de la zona. Cuando la cuenta llega a `killsNeeded` (150), **al caer la noche del juego** (21:00 a 5:00; un día dura 24 minutos reales) aparece el jefe mítico en uno de sus `spots`.
2. Antes se ven **rumores** (`rumors`).
3. Se avisa a todos los que están en esa zona.
4. Tiene **vida compartida** (`maxHp`): cada intento es un combate contra un clon con la vida que le queda. Hay 30 s de espera entre intentos y dura 20 minutos.
5. **Fases** al 75%, 50% y 25%:
   - llama **esbirros** (cada esbirro cazado le baja la defensa un 2%, hasta un 40%, y cuenta como aporte);
   - **huye** a otro lugar;
   - **luna roja**: pega ×1.3 y suelta ×1.25 de botín.
6. Al morir, **reparte el botín según cuánto aportó cada uno**: oro, experiencia, carta mítica y experiencia de gremio.
7. Después la zona descansa 60 minutos.

Su sprite tiene `rank: 'mitico'` en `enemigos.json`.

**⚠️ Hoy solo existe en la Pradera** (`MITICOS[1]`: Aullaluna, el Lobo Espectral). Las Montañas y el Volcán no tienen.

**En una zona nueva:** agrega una entrada en `MITICOS[zoneId]` con:

- `code` (`MITICO_*`), `name`, `killsNeeded`, `maxHp` (escalado al nivel de la zona), `minLevel`;
- `spots` (casillas de la zona) y `rumors`;
- su monstruo y su esbirro con `monsterRow(…, 'LEGENDARY', perfil)`;
- su sprite de 64x64 y su carta.

Ideas:

- **Montañas:** «Thrym, el Coloso de Escarcha».
- **Volcán:** «Ignivora, la Madre Salamandra». Aparece en una noche de lluvia de brasas y sus esbirros son salamandras.

Revisar que el código no suponga una sola zona (algunas constantes, como `MINION`, son únicas hoy). Habría que llevarlas dentro de cada entrada de `MITICOS`.

### 4. Eventos del calendario

**Archivos:** `gprback/lib/eventos.js`; front `src/game/world/events.js` y `EventsHud.js`. Se usa la hora del servidor.

**Cómo funciona:**

- **Festival de Aethra:** los domingos, todo el día. La ofrenda al Pilar da el doble y las recetas del Pilar dan el doble.
- **Noche de caza:** todos los días de 20:00 a 22:00, +25% de experiencia en combate.
- **Mercader ambulante (Varo):** miércoles y sábados de 18:00 a 21:00, junto al Pilar de Aurelia. Tiene ofertas que cambian cada día (2 por jugador) y un sobre de cartas de la Pradera.
- **Evento del Día** (`routes/dailyEvent.js`, `lib/dailyEventBonus.js`): bono para niveles bajos.
- **World Boss** (`lib/worldBossScheduler.js`): 3 h activo y 1 h de pausa, para siempre; tiene su tienda propia.
- Los avisos de evento se muestran **solo en su zona** (pedido del usuario).

**En una zona nueva:** no hace falta tocar nada. Si se quiere un evento propio: agrégalo a `EVENTS` y su efecto en el mapa a `events.js`. Ideas: una "Erupción" en el Volcán (más brasas y más botín) o la "Feria de la forja" de Ascuaria.

### 5. Encantamiento

**Archivos:** `gprback/routes/players.js` (`ENCHANT_COSTS`, `POST /enchant`); front `EnchantPanel.js`. Lo hacen los NPC encantadores (Aelin en Aurelia; en Ascuaria, Ignar).

**Cómo funciona:**

- Cada nivel de encantamiento (+1 a +10) sube **un 5%** todas las stats de la pieza.
- Cuesta piedras y oro, y la probabilidad baja:

| Nivel | Piedras | Oro | Éxito |
|---|---|---|---|
| +1 a +4 | 1-4 Menor | 200 - 1500 | 95% - 75% |
| +5 a +7 | 1-3 Mayor | 3000 - 10000 | 65% - 45% |
| +8 a +9 | 1-2 Suprema | 18000 - 30000 | 35% - 25% |
| +10 | 1 Legendaria | 80000 | 15% |

- **Si falla, se pierden el oro y las piedras** (la pieza no baja).
- Los Cristales de Estabilidad suman probabilidad.
- **Las piedras** salen de la tienda, de **desmantelar** equipo (ver A6) y de recompensas de misión (por ejemplo, `PIEDRA_ENCANT_MENOR` en V5 o `PIEDRA_ENCANT_MAYOR` en Brokk contra Ignar).

**En una zona nueva:** pon piedras como recompensa en las misiones de herreros y artesanos, y en los drops de los jefes (Morvak suelta `PIEDRA_ENCANT_MAYOR` al 20%). La ciudad de la zona debería tener **un encantador**, como Ignar en el Volcán.

### 6. Reputación y rangos de aventurero

**Archivos:** `gprback/lib/ranks.js`, tabla `ranks`, `routes/players.js` (al completar una misión).

**Cómo funciona:**

- Cada misión da `reputation_reward` (el campo `rep` del generador).
- La reputación sube el **rango**: F (0), E (501), D (1501), C (3501), B (6501), A (10001), S (15001).
- Cada rango da bonos (columnas de `ranks`): `xp_bonus_percent`, `reward_bonus_percent` (más oro de misiones), `shop_discount_percent` y `extra_inventory_slots`.
- Algunas misiones o tiendas piden un rango mínimo.

**En una zona nueva:** dale `rep` a las misiones, más a las principales y a las de jefe:

| Tipo de misión | `rep` |
|---|---|
| Principales del Volcán | 150 - 300 |
| Secundarias | 0 - 50 |
| Diarias | poca o ninguna |

Que la suma de la zona lleve al jugador **más o menos un rango arriba**.

**Idea:** reputación por pueblo (Ascuaria, Bastión) con descuentos en su ciudad. Hoy la reputación es una sola, global.

### 7. Misiones diarias

**Archivos:** `gprback/routes/players.js` (`dailyPickIds`, `DAILY_PICKS = 3`, `DAILY_TRIVIAL_LEVELS = 6`).

**Cómo funciona:**

- Cada jugador ve **3 diarias por día**, sorteadas con una semilla de *día + jugador*: son las mismas todo el día y distintas para cada uno.
- Solo entran las de su nivel (sin las triviales).
- Al completarlas vuelven a estar disponibles al día siguiente.
- Las de `COLLECT_ITEM` **se cobran**: se te quitan los objetos al entregar.

**En una zona nueva:**

- Crea **3 diarias nuevas** con NPCs de la zona (`type: 'DIARIA'`), preferentemente de recolección o caza con los materiales de la zona.
- **Reasigna las diarias viejas** de ese rango de nivel a NPCs de la zona (giver y turn), para que no las dé un NPC de otra zona. En el Volcán se reasignaron 11.

### 8. La Torre (mazmorra infinita)

**Archivos:** `gprback/routes/tower.js`, tabla `tower_floors`.

**Cómo funciona:**

- Se entra **desde nivel 30**. Hay 3 dificultades (Normal, Difícil y Muy Difícil, que multiplican las monedas ×1 / ×1.5 / ×2).
- Se sube piso por piso. Cada piso tiene salas y algunos son de jefe.
- Da **monedas de mazmorra** (`dungeon_coins`), que se gastan en su tienda.
- Cada 15 pisos hay una **Ciudad del Abismo** (punto de control que guarda lo ganado).
- Hay eventos de vendedor por piso y es un bucle infinito.

**Con la historia:** cada tramo se abre al terminar un capítulo (`historia_etheria.md` §5), y los maestros de las órdenes dan misiones de clase ligadas al mundo.

**En una zona nueva:** no hace falta tocarla. Si la zona cierra un capítulo, se puede abrir el tramo de la Torre que corresponde, con monstruos de esa zona como tema del tramo.

### 9. Exploración, niebla del mapa y cofres secretos

**Archivos:** `gprback/lib/exploracion.js`; front `src/game/world/explore.js` y `useExploration.js`.

**Cómo funciona:**

- **El mapa (M) empieza tapado** y se descubre al caminar, por cuadros de 4x4 casillas guardados por jugador.
- Cada **subzona** descubierta da **60 de experiencia**. Descubrir **todas** las de la zona da un premio (`complete`):

| Zona | Premio por explorarla entera |
|---|---|
| Pradera | 600 de oro / 500 de experiencia |
| Montañas | 1500 / 2500 |
| Volcán | 2600 / 5500 |

  El servidor comprueba que de verdad estés ahí, con los rectángulos de cada subzona (`rects`).
- Hay **cofres secretos** escondidos en rincones: se abren una sola vez y dan oro, experiencia y a veces una carta (`card: true`). El punto del mapa (`type: 'secreto'`) lleva el mismo nombre que la clave en `SECRETS`.
- Las balsas y las vagonetas solo te llevan a subzonas que ya exploraste.

**⚠️ Las Montañas no tienen cofres secretos** (la Pradera tiene 4 y el Volcán 3).

**En una zona nueva:**

- Agrega `ZONES.<dir>` con todas las subzonas (los mismos nombres del `mundo.json`), sus `rects` en píxeles y un `complete` que crezca con el nivel.
- Agrega **unos 3 secretos** en lugares que premien explorar (detrás de algo, en un rincón sin camino), con nombre de lore. Que 1 o 2 den carta.
- Ponlos también en el mapa.

### 10. Música y sonidos

**Archivos:** `gpr/src/game/audio.js`. La música **se genera por código** (chiptune): cada tema (`TRACKS`) tiene `bpm`, voces con ondas (`triangle` / `square`), una lista de notas por compás y batería opcional. Los efectos (`sfx`) también se sintetizan, como `trueno` o `brasa`.

**Cómo funciona:**

- Cada zona elige su tema con `musica` en su `mundo.json`. Aurelia usa `ciudad`; la Cripta y la Mina usan `cripta`.
- En combate suena `batalla`, y `jefe` contra jefes o míticos.
- Hay temas cortos para victoria, derrota, subir de nivel y misión.

Hoy hay temas para la Pradera, la ciudad, las mazmorras (`cripta`), las **Montañas** (`montanas`) y el **Volcán** (`volcan`). Una zona sin `musica` usa el de la Pradera.

**En una zona nueva:**

- Escribe un tema propio en `TRACKS`, con la misma estructura, en una escala y un ritmo que cuenten la zona. Ejemplos: Montañas con algo grave y lento en modo menor (gaitas y tambores); Volcán con percusión pesada, escala frigia y bajo marcado.
- Pon `musica: '<tema>'` en su `mundo.json`.
- Para la mazmorra, un tema propio o `cripta`.
- Cada mecánica única tiene **su sonido** (`sfx`): el trueno de la tormenta, el golpe de la brasa.

### 11. Carteles de zona y subzona

**Archivo:** `gpr/src/pages/World.js` (`ZONE_TITLES`).

**Cómo funciona:**

- Al entrar a una zona o subzona aparece un **cartel** con el título. Va sin «Zona 1/2», que se quitó por pedido del usuario.
- Encima puede llevar una línea chica (`'La capital'`, `'Mazmorra'`).
- La subzona se muestra junto a la zona.

**En una zona nueva:** agrega `dir: ['línea chica', 'Nombre']` para la zona y para su mazmorra. Ya están el Volcán y la Fisura.

### 12. Guía del aventurero y flechas de rastreo

**Archivos:** `gprback/lib/guia.js`; front `useGuide.js`, `GuideTracker.js`, `src/game/world/guide.js` y `tracking.js`.

**Cómo funciona:**

- **La guía** es la primera hora del juego, paso a paso:
  1. hablar con Tomás;
  2. abrir la mochila;
  3. el Pilar;
  4. la piedra de regreso;
  5. el maestro de tu clase;
  6. la Catedral;
  7. Brokk;
  8. salir por la Puerta Sur;
  9. el primer combate;
  10. un recurso;
  11. la Aldea Espiga.

  Cada paso da una recompensa chica, y una flecha te lleva al objetivo.
- **El rastreo de misiones:** con el botón 📍 del diario, una flecha alrededor del héroe apunta al objetivo del paso actual. El objetivo puede ser un punto del mapa, un NPC (aunque se haya movido), el área más cercana de un monstruo, un jefe o el recurso más cercano de un tipo. Muestra la distancia y deja un marcador en el minimapa.
- **Los servicios** (forja, encantador, viajes…) se buscan por `cercania.js` (`SERVICIOS`), y la guía del gremio te lleva al más cercano.

**En una zona nueva:**

- Los puntos, NPCs, monstruos y recursos se rastrean solos si están bien cargados en el mapa y en `NPC_HOMES`.
- Agrega los **servicios** de la ciudad nueva a `SERVICIOS`, para que las flechas también lleven ahí.

### 13. Mercader, tiendas y venta a NPCs

**Archivos:** tabla `artisan_shop` (`artisan_code`: ALQUIMISTA, COCINERO, HERRERO…), `gprback/lib/npcSell.js`; front `MerchantPanel.js`; tiendas de los maestros de clase en `class_master_shop_items`.

**Cómo funciona:**

- Los **artesanos** (Lyra en Aurelia, Mirna en la Aldea) venden materiales básicos: hierbas, aceite, sal, carbón, mineral. Hay 18 productos.
- También **te compran** tu botín.
- **Regla de oro anti-trampa:** ningún NPC paga más de **la mitad** del precio más barato de ese ítem en cualquier tienda (y como mucho su `max_sell_price`). Así no se puede comprar barato y revender caro.

| Rareza | Lo que paga el artesano | Lo que paga el maestro |
|---|---|---|
| COMÚN | 25 | 20 |
| POCO_COMÚN | 75 | 50 |
| RARO | 200 | 120 |
| ÉPICO | 600 | 300 |
| LEGENDARIO | 2500 | 700 |

  Los Únicos no se venden.
- El **mercado de jugadores** y los **puestos** son el otro canal. El "Mercader del Reino" repone pociones en el mercado.
- `lib/economia.js` registra el oro que entra y sale para vigilar la inflación.

En el Volcán, **Marga** (`mercader_ascuaria`, en el puesto de la plaza de Ascuaria) es el lugar de comercio: está en `SERVICIOS.artesanos` y su diálogo abre la ventana `artesanos`. La ventana muestra todas las tiendas de `artisan_shop` juntas, así que hoy vende lo mismo que los artesanos de Aurelia.

**En una zona nueva:**

- Pon **un mercader en la ciudad**: agrégalo a `SERVICIOS.artesanos` en `cercania.js`, con su opción `window: 'artesanos'` en el diálogo.
- Si vende cosas propias, cárgalas en `artisan_shop` con un `artisan_code` nuevo. Ideas: frascos y aceite; en el Volcán, carbón, pómez barata y agua.
- **Nunca** vendas en tienda un material que un NPC compre más caro. Respeta la regla de la mitad.

### 14. Dónde despiertas al caer (refugios, Pilar y piedra de regreso)

**Archivos:** front `src/game/world/refuges.js` (`REFUGE_RADIUS = 80`), `WorldScene.js` (al morir); `gprback/lib/piedraRegreso.js`.

**Cómo funciona:**

- Los **refugios** son el **Pilar de Aethra** y cada **fogata** del mapa (punto `luz` con `tipo: 'fogata'`, fuera de las ciudades).
- Al pasar a menos de 80 px de uno, queda guardado como tu refugio.
- **Si caes en combate, despiertas en el último refugio** que tocaste. Dentro de una mazmorra, despiertas en el último brasero o cuba encendido.
- Cerca de una fogata tampoco te apuntan los rayos ni las brasas.
- **La piedra de regreso** se vincula en una **Estatua del Viajero** (hoy solo en Aurelia) y te devuelve ahí desde cualquier lugar. Tiene 20 minutos de recarga.

**En una zona nueva:**

- Pon **fogatas** en los puestos y campamentos del camino, más o menos una por subzona. Así caer no te manda lejos, y sirven de refugio contra la mecánica de clima.
- Idea (de `mapa_etheria.md`): un **Pilar menor y una Estatua del Viajero** en la ciudad de cada zona. Requiere agregar la estatua a `piedraRegreso.js` y su punto `pilar` al mapa.

### 15. Fondos de combate

Explicado en A4. Hay que dibujar el fondo de la zona y el de su mazmorra (5 capas), y conectarlos en `BattleScene.js` (`BACKGROUNDS`, `FILL_COLORS`) y `Battle.js` (`ZONE_BACKGROUND`, `DUNGEON_BACKGROUND`). El Volcán y la Fisura ya están hechos.

### 16. Editor de mapas (página `/editor`)

**Archivos:** front `src/pages/MapEditor.js`, `src/editor/rules.js` y `render.js`.

**Cómo funciona:**

- Permite pintar terrenos (con bordes automáticos), poner objetos, puntos, NPCs, recursos y encuentros, y guardar el mapa.
- Al guardar, el `mundo.json` queda `editado: true`. Desde ahí **el generador no lo pisa** (salvo con `--forzar`).

**En una zona nueva:**

- Agrega los terrenos (`TERRAIN_LIST`, pinceles, `GROUND_NAME`, `terrainOfName`, los `case` de `groundGid`).
- Agrega sus recursos (`RESOURCE_FRAMES` en `render.js`) y carga sus hojas en `MapEditor.js`.
- Prueba pintar un poco de cada terreno y que los bordes salgan bien.

### 17. Mapa del mundo (tecla M)

**Archivos:** front `MapPanel.js` y `src/game/atlas.js`.

**Cómo funciona:**

- **Pestaña Zona:** el mapa de la zona entera, con subzonas coloreadas por nivel respecto al tuyo (rojo = 5 o más por encima; gris = muy fácil), NPCs, jefes, salidas, tu posición y la niebla de lo no explorado.
- **Pestaña Mundo:** un atlas dibujado a mano (SVG) con todas las zonas, los caminos que las unen y un texto de "cómo se llega". Los datos están en `ATLAS_ZONES`, `ATLAS_ROADS` y `ZONE_EXITS`.

El Volcán ya está corregido: zona 3 con `dir: 'volcan'`, al sur de las Montañas (Paso del Humo). Las Costas ocupan toda la costa sur. Se pasa caminando, así que no lleva `ZONE_EXITS`.

**En una zona nueva:** en `atlas.js`, pon la zona con su `dir`, su posición (`x`, `y`) coherente con `etheria.json`, su color, su ícono y su texto de ruta. Agrega su camino en `ATLAS_ROADS` y las salidas en `ZONE_EXITS`.

### 18. Gremio

**Archivos:** `gprback/routes/guilds.js`, `lib/guilds.js` y `lib/guildContracts.js`; front `GuildPanel.js`.

**Cómo funciona:**

- El gremio sube de nivel con experiencia que generan sus miembros al combatir. Tiene banco y tienda desde el nivel 2, y maestros de clase propios (`guild_class_masters`).
- **Encargos semanales:** 3 por semana, sacados de esta lista:
  - cazar 40 monstruos;
  - 10 raros;
  - 2 jefes;
  - recolectar 20 recursos;
  - donar 1500 de oro.

  La meta crece con la cantidad de miembros. Cada encargo da 300 de experiencia al gremio, y los 3 juntos dan 500 más.

**En una zona nueva:** no hay que tocar nada, porque los encargos cuentan en cualquier zona. Idea: encargos de zona ("cazar 5 Dracos de Brasa") para que los gremios vayan juntos a las zonas nuevas.

### 19. Paso entre zonas y desbloqueo de zona

**Archivos:** `etheria.json` (posición), los chunks de la zona vecina (el camino), `gprback/routes/combat.js` (`player_zone_unlocks`) y `mapa_etheria.md` §3.

**Cómo funciona:**

- Como el continente es continuo, **se pasa caminando** si hay camino transitable entre las dos zonas. Al cruzar, cambian la música, el clima, los recursos, la sala de jugadores y las misiones.
- La zona queda **"abierta"** para el jugador (`player_zone_unlocks`) cuando **gana un combate contra un monstruo de esa zona**. Eso habilita, por ejemplo, ver las recetas con candado de sus jefes.
- Las mazmorras se entran por un punto `salida` con `destino`.
- Lo que **justifica** el paso en la historia es la primera misión principal de la zona (V1 «El Paso del Humo», que pide terminar la historia de las Montañas).

**En una zona nueva:**

- Ponla en `etheria.json` pegada a su vecina.
- **Abre el camino** en el borde de la vecina, editando sus chunks a mano con un script; nunca regenerándola.
- Haz que la primera misión principal lleve ahí.
- Revisa el texto del atlas (punto 17) y la tabla de pasos de `mapa_etheria.md`.
- **Ojo con los niveles:** el camino no debería meter a alguien de nivel bajo en una zona alta por accidente. Pon el paso en un lugar del final de la zona anterior.

## A13. SQL, Supabase y pruebas

### Orden de trabajo

1. Generar el SQL por partes y aplicarlo **en local** (`aplicar_sql.js`).
2. Probar.
3. Pegarlo al final de `schema.sql` en este orden: monstruos → equipo (paso 1) → escalera (paso 2) → comidas → misiones → `balance_versions`.

### Pruebas

- `npm run revisar` en los dos repos.
- `npx eslint <archivos>` sin salida.
- Comprobar que el back carga: `node -e "require('./routes/world')"`.
- Servidores temporales y navegador integrado:
  - teletransportarse con `sessionStorage.setItem('mundo_posicion_v2', JSON.stringify({ x, y, zona }))`;
  - probar el camino, los NPCs, un combate, la forja, la mecánica única y la mazmorra.

### Al terminar

- Detener los servidores temporales.
- Limpiar los datos de prueba.
- Contarle al usuario qué se hizo, qué se probó y qué SQL tiene que correr en Supabase.

---

# PARTE B — Estado del Volcán Rojo (zona 3, nivel 31-45)

**Historia de la zona:** *"El fuego que forja cadenas"*.

- Los Ocultos le roban moldes a **Ignar**, el Forjador de Fuego de **Ascuaria** (ciudad de los dracónidos).
- Con esos moldes, el **Maestro de la Lava** y **Morvak** (en la Fisura Infernal) forjan Cristales de Eclipse.
- Uno de esos cristales está clavado en el pecho del **Dragón Menor**, al que crió el Viejo Escamas.
- El **Titán de Fuego**, Guardián del Tercer Sello, está encadenado en la Caldera.

Las misiones principales:

| # | Misión | Quién la da | De qué trata |
|---|---|---|---|
| V1 | El Paso del Humo | Durgan → Gaspar | bajar de las Montañas por el paso nuevo |
| V2 | Ceniza que quema | Gaspar | limpiar la Ladera |
| V3 | Las puertas de Ascuaria | Ascalia | ganarse la entrada a la ciudad |
| V4 | El cargamento de Ignar | | recuperar lo que robaron los bandidos |
| V5 | El orgullo del forjador | Ignar | pruebas de forja |
| V6 | Moldes con eclipse | | |
| V7 | Fuego que camina | Pumo | |
| V8 | Vidrio negro | Kessa | los gólems despertados |
| V9 | El Maestro de la Lava | | giro: Ignar forjó los cristales sin saberlo; forja la Llave de Brasa |
| V10 | La Fisura Infernal | | se abre la mazmorra; Morvak |
| V11 | El dragón que lloraba fuego | Escamas | |
| V12 | Las puertas de la Caldera | Ascalia | el Señor de la Caldera |
| V13 | La ofrenda de Ascuaria | Ignar | forja el talismán |
| V14 | El corazón del volcán | | el Titán de Fuego; el Tercer Fragmento va a Elenya |

Las secundarias:

- Brokk contra Ignar (×4);
- el huevo de dragón de Chispa (×3);
- ¿Picante? (Tuli);
- el Bosque Calcinado de Ceniza (×3);
- Pómez de calidad (Pumo);
- Artesana, no (Kessa);
- El olor del éxito (Sulfo);
- El último vuelo (Escamas);
- ¿Dónde está Trueno? (otra vez).

**Estado:** el Volcán está **completo en código y datos**. Falta que el usuario lo pruebe en el juego y que corra el SQL en Supabase.

- Front: rama `feat/2d`.
- Back: rama `fix/compras-atomicas`.

## B1. Archivos de trabajo

Están en **`D:\vscode\gpr\_respaldo_claude\volcan\`** (sin seguimiento de git). Ahí están:

- los generadores (`gen_*.js`), que escriben SQL por la salida estándar;
- `aplicar_sql.js`, que aplica un `.sql` dos veces seguidas en la base local para comprobar que es repetible (pásale la ruta absoluta);
- `revisar_misiones.js` y `mapa_volcan.js`.

| Archivo | Qué es | ¿En local? | ¿En `schema.sql`? |
|---|---|---|---|
| `volcan_monstruos.sql` (`gen_volcan.js`) | 16 monstruos, materiales, skills, recompensas de jefes | sí | sí |
| `volcan_equipo1.sql` (`gen_equipo_volcan.js`) | tiers Volcán, Obsidiana, Forja Negra, Caldera y Titán F; recetas en la forja de Ignar; accesorios de jefes; drops | sí | sí |
| `volcan_equipo2.sql` (`gen_escalera_volcan.js`) | escalera v2/v3, 79 piezas | sí | sí |
| `volcan_comidas.sql` (`gen_comidas_volcan.js`) | Carne de Salamandra y 5 comidas | sí | sí |
| `volcan_misiones.sql` (`gen_misiones_volcan.js`) | V1-V14, 16 secundarias, 3 diarias nuevas, 11 reasignadas, 14 ítems de misión. Regenerado después de los arcos y el puesto de Marga; checker: 44 misiones, 0 problemas | sí | sí |

**SQL para Supabase:**

- Está en `db/schema.sql`, **líneas 9574 a 13390** (el bloque «VOLCÁN ROJO»), con la fila `balance_versions 'volcan_v1'` al final.
- Se probó entero, dos veces seguidas, en la base local sin errores.
- Después de correrlo en Supabase hay que **reiniciar el servidor una vez**. La Fisura se siembra sola al arrancar (`lib/fisura.js`) y así sus monstruos toman las habilidades nuevas.
- El mismo bloque está al final de `db/pendiente_supabase.sql`, que no se commitea.

## B2. Lo que está hecho

### Back

- `lib/fisura.js` (la mazmorra, niveles 36-42) y el soporte de `skills` en `lib/mazmorra.js`.
- La mazmorra registrada en `lib/mazmorras.js` y en `server.js`.
- `lib/piezasSet.js`: OBSIDIANA para el Maestro de la Lava y el Dragón Menor.
- `lib/worldNodes.js` + `worldNodes.zonas.json["3"]`: 7 tipos de recurso y 24 nodos.
- `lib/exploracion.js`: `ZONES.volcan` (9 subzonas) y 3 secretos.
- `lib/cercania.js`: la Gran Forja de Ascuaria, los 3 muelles y **Marga** (`mercader_ascuaria`, en 115,29) como lugar del servicio `artesanos` (comprar y vender).
- `lib/questSteps.js`: `NPC_HOMES`.
- `lib/brasas.js` y las rutas `POST /balsa` y `POST /brasa`.
- Simulador: `PERFILES` del Volcán y `simulateVolcan`.
- `db/schema.sql`: el bloque del Volcán (ver B1).
- Docs:
  - `zona3_volcan.md`, al día: Fisura 36-42, balseras, brasas, Marga.
  - `mapa_etheria.md`: el Volcán está hecho y se llega por el Paso del Humo.

### Front

- **Tileset compartido v6:** 892 tiles; los 668 viejos quedaron idénticos.
- **Recursos:** `recursos5.png`.
- **Mapa del Volcán:** `generar_volcan.js` → `public/assets/mundo/volcan/`. Tiene los 17 arcos de basalto que sirven de refugio, el puesto de Marga en la plaza y `musica: 'volcan'`. Está en `etheria.json` en (160, 210).
- **Paso del Humo** abierto en los chunks de las Montañas.
- **Editor:** `rules.js` con los terrenos v6.
- **NPCs:** raza draco y 10 NPCs nuevos con sprite y retrato: Ignar, Ascalia, Tuli, Chispa, Escamas, Kessa, Ceniza, Pumo, Sulfo y **Marga**, la mercader.
- **Diálogos** de todos los NPCs del Volcán, incluidas las balseras Toba y Lapilli y Marga (con la opción `Comerciar`), y su `NPC_LUGAR`.
- **Balsas:** `client.js` (`balsa`, `brasa`) y los manejadores en `World.js`.
- **Lluvia de brasas** (`src/game/world/brasas.js`, arte de `crear_brasas.lua`, sonido `brasa`) y **clima de ceniza** (`WorldScene` y el ícono del HUD).
- **20 enemigos de combate** (`crear_enemigos_volcan.lua`, en `enemigos.json`).
- **Fondos de combate** del Volcán y de la Fisura (`crear_fondo_volcan.lua`), conectados en `BattleScene.js` y `Battle.js`. La Fisura usa su fondo por `DUNGEON_BACKGROUND`, también en las peleas con los guardianes.
- **La Fisura Infernal:**
  - **Arte** (`art/sprites/mundo/crear_fisura.lua`):
    - tileset propio (`tileset_fisura.png` + json): puente ancho con `puente_n` / `puente_c` / `puente_s`, hornos 2x2, yunque, molde, escoria…;
    - la **cuba** (`mazmorra/cuba.png`: llena / volcada con vapor);
    - el **portón** (`mazmorra/porton_forja.png`).
  - **Mapa** (`art/mapas/generar_fisura.js` → `public/assets/mundo/fisura/`, 1x2 trozos):
    - usa las mismas casillas que `lib/fisura.js`: cubas en 13,9 y 27,33; las rondas de los 3 guardianes; el portón en 18,47; Morvak en 20,53;
    - el generador comprueba que las rondas y las cubas caigan en casillas libres;
    - las salidas vuelven al Volcán en la casilla 33,99, dos más abajo del portal, para no volver a entrar.
  - **Conexión:** `DUNGEONS.fisura` en `shared.js`. Con `mazmorraArte.accion: 'Volcar'` la cuba dice «Volcar: …»; en `cripta.js`, las demás mazmorras siguen con «Encender» por defecto.
- **Carteles:** `ZONE_TITLES` del Volcán y de la Fisura.
- **Música:** temas nuevos en `audio.js`, puestos en el `mundo.json` de cada zona:
  - `volcan`: mi frigio, con tambores de forja;
  - `montanas`: mi menor, con gaita y cuerno. Su `mundo.json` se editó a mano, porque las Montañas no se regeneran.
- **`!` rojo para las misiones de historia:**
  - `questMarks` marca `'!!'` cuando la misión disponible es `PRINCIPAL`.
  - Se dibuja como un `!` rojo (`#ff5a4a`) sobre el NPC, en el minimapa, en el mapa (M) y en el marco del objetivo.
  - Los diálogos siguen viendo `mark === '!'`: `World.js` normaliza `'!!'` y pasa `story: true`.
- **Atlas del mapa (M):** la zona 3 ahora es `volcan`, al sur de las Montañas (Paso del Humo). Las Costas ocupan toda la costa sur.

## B3. Lo que queda (son propuestas: consultarlas con el usuario antes)

1. **Jefe mítico del Volcán** (y de las Montañas): hoy solo existe en la Pradera (A12.3). Idea: «Ignivora, la Madre Salamandra», que aparece en las noches de brasas. Hay que generalizar `lib/mythic.js`, porque algunas constantes suponen una sola zona.
2. **Cofres secretos de las Montañas**: tienen 0 (A12.9).
3. **Pilar menor y Estatua del Viajero en Ascuaria** (A12.14).
4. **Tienda propia de Ascuaria** en `artisan_shop`. Hoy Marga vende lo mismo que los artesanos de Aurelia, porque la ventana de comercio muestra todas las tiendas juntas.
5. En el Taller, mostrar **de dónde sale un material que te falta** (A6, "Mejora pendiente").
6. **Objetos del mapa con `requiere` / `oculto_tras`**, como los NPCs (A8, phasing).
7. **Colores de equipo propios para la Obsidiana y la Forja Negra.** Hoy caen por rareza en los sets
   "arcano" y "ancestral" (`gear.js`). Hay que agregar los sets `obsidiana` y `forja_negra` al
   final de `crear_equipo.lua` y de `SETS`, con su sufijo en `SET_BY_CODE` (ver `CLAUDE.gpr.md`,
   "Arte del equipo"). **Esto se hace con cada tier nuevo de cada zona.**

## B4. Qué se probó y qué no

**Probado:**

- el simulador de equilibrio;
- el checker de misiones, después de regenerarlas: 44 misiones, 0 problemas;
- todo el SQL del Volcán: aplicado dos veces seguidas en local, sin errores;
- que el tileset viejo quedó idéntico y que el camino `caminov` del editor funciona;
- el lint de todos los archivos del front que se tocaron, y que el back carga;
- el back temporal por API:
  - arranca y recalcula `volcan_v1`;
  - la Fisura responde: sellada sin la llave, con la palabra «Cuba» y 3 guardianes;
  - la tienda de artesanos responde;
  - las misiones traen `quest_type`;
- el arte (brasas, 20 enemigos, 2 fondos, tileset de la Fisura, cuba, portón y Marga) y el mapa entero de la Fisura, revisados con láminas renderizadas.

**El usuario prueba el front él mismo.** No levantes el front temporal ni pruebes en el navegador, salvo que lo pida.

Lo que le queda para probar en el juego:

- entrar al Volcán por el Paso del Humo;
- la ceniza y la música;
- las brasas y los arcos;
- hablar con los NPCs;
- cruzar en balsa;
- venderle a Marga;
- los `!` rojos;
- un combate (sprites y fondo);
- recorrer la Fisura. Necesita la Llave de Brasa de la V9 o completar la V10. Para probar rápido, se le puede dar la llave a un personaje de prueba en la base local y quitarla al terminar.

## Última actualización

- Primera parte del Volcán: front `de56449`, back `0642b7b`.
- Segunda parte (la Fisura, Marga, música, `!` rojo, atlas, misiones regeneradas y el SQL en `schema.sql`): front `2fc9088`, back `247ba7f`. **El usuario ya corrió el SQL del Volcán en Supabase.**
- Para ver qué se hizo después, revisa `git log` en los dos repos desde esos commits.
