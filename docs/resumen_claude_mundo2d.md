# Resumen de lo que hizo Claude en el mundo 2D (front `gpr/` y back `gprback/`)

Este documento junta todo lo trabajado en la sesión: qué se hizo, en qué archivos, cómo se probó
y qué quedó pendiente. Está ordenado por tema, de lo más viejo a lo más nuevo.

> **Estado del commit**
> - Ya está en commit: grupo en el mundo, comercio, correo, muñecos de venta, economía y las
>   correcciones de la primera revisión. Están en los commits `383dfd8` (front) y `6d7dd12` (back).
> - **Sin commit todavía:**
>   - los arreglos de seguridad de guía, exploración y mercader;
>   - las ventanas que no mostraban todo;
>   - el modo celular y tablet;
>   - el combate en celular vertical;
>   - los arreglos de sprites.
>
> Además están sin commit los cambios que agregó otra sesión: eventos, guía, exploración, atajos
> de teclado, joystick, ranking de cazadores y la partición de `WorldScene`.
>
> **Antes de probar:** reiniciar el back del puerto 5000 (el back no se recarga solo).

---

## 1. Grupo y combate en el mundo 2D (ya en commit)

- **Combate de grupo:** máximo 3 personajes por lado. Puede ser 3 jugadores, 2 jugadores + 1
  compañero o 1 jugador + 2 compañeros; manda el compañero del primer puesto del líder.
- **Quién entra al combate:** los miembros del grupo a menos de 3 casillas entran solos, sea un
  combate de hierba o con un monstruo del mapa. Si no hay nadie cerca, es combate normal.
- **Tope de enemigos:** 3. Se corrigió el bug del 4.º enemigo.
- **Globito de combate:** un globito animado (hecho en Aseprite) sobre la cabeza de quien está
  peleando.
- **Bugs corregidos:**
  - al fallar la huida, los héroes desaparecían;
  - "Huir" de los NPC se rechazaba sin avisar;
  - un jugador caído quedaba atrapado en el combate del grupo (ahora tiene "Seguir mirando" y
    "Volver a mi refugio").
- **Invitar al grupo:** se puede invitar estando cerca sin ser amigos. Se agregaron seguir al
  líder, ventana de inspeccionar, misiones compartidas y saltar el turno de quien no juega.
- **Archivos:**
  - back: `routes/combat.js`, `routes/coop.js`
  - front: `components/world/Battle.js`, `components/world/Battle.css`,
    `components/world/InspectPanel.js`, `components/world/WorldSocial.js`,
    `game/BattleScene.js`, `game/socialLayer.js`

## 2. Comercio entre jugadores (ya en commit)

- **Inspiración:**
  - [WoW](https://warcraft.wiki.gg/wiki/Trading): dos columnas que se ponen verdes con "Listo".
  - [RuneScape](https://oldschool.runescape.wiki/w/Trading): pantalla de confirmación y aviso en
    rojo si el otro quita algo de su oferta.
- **Funcionamiento:**
  - todo va por socket (`trade:request`, `respond`, `offer`, `ready`, `unready`, `confirm`,
    `cancel`);
  - el intercambio se hace en una sola transacción: o pasa todo o no pasa nada;
  - se pueden comerciar objetos, oro y **cartas de monstruo** (solo las que no están engarzadas).
- **Archivos:**
  - back: `lib/trade.js` y la tabla `player_trades`
  - front: `components/world/TradePanel.js` y su `.css`
  - arte: ícono `public/assets/mundo/comercio.png`

## 3. Economía (ya en commit)

- **Duplicación de objetos (grave):** `lib/inventory.js` → `removeItem` ahora nunca descuenta
  más de lo que hay; si no alcanza, lanza un error 400 y no toca nada. Esto cerraba la
  duplicación en el correo entre amigos (adjuntar el mismo objeto dos veces, o uno de otra
  calidad) y cualquier caso parecido, incluidos dos pedidos al mismo tiempo.
- **Errores para el jugador:** `server.js` devuelve como 400, con su mensaje, los errores marcados
  `expose`.
- **Oro infinito con los artesanos:** el artesano compraba a 25 lo que vendía a 15.
  `lib/npcSell.js` hace que ningún NPC pague más de la mitad de lo que cuesta ese objeto en una
  tienda de oro. La mochila trae `sell_artisan` y `sell_master`, calculados en el back.
- **Rareza de materiales:** 33 materiales no tenían rareza. Se les asignó en la base, en
  `seed.sql`, en `seed_v2.sql` y con un `UPDATE` en `schema.sql`.
- **Panel de economía:**
  - qué hace: muestra oro en circulación, entradas, salidas y neto por día, actividad semanal y
    los 10 más ricos;
  - dónde está: `lib/economia.js` (trigger y tabla `economy_gold_log`), ruta
    `GET /api/admin/economia` y página `/admin/economia`;
  - las cuentas del sistema (las Leyendas y el Mercader del Reino) se muestran aparte;
  - **para verlo hay que agregar `ADMIN_PLAYER_IDS=8` en `gprback/.env`**: hoy el admin es el
    id 1, que es una Leyenda.

## 4. Correo del reino (ya en commit)

- Reusa `player_messages`.
- **Reglas:**
  - escribir solo texto a un amigo: gratis y desde cualquier lado;
  - mandar oro, objetos o cartas, o escribirle a alguien que no es tu amigo: hay que estar junto
    a un **buzón** y pagar franqueo (10 de oro + 5 % del oro enviado);
  - lo adjunto se recoge en un buzón;
  - si nadie lo recoge antes de que venza, **vuelve al remitente** (antes se perdía).
- **Buzones:** en la Plaza del Pilar (Aurelia, casilla 67,45) y en la Aldea Espiga (pradera,
  73,50). Hechos en Aseprite, levantan la banderita cuando tienes cartas sin leer.
- **Archivos:**
  - back: `lib/correo.js`, `routes/social.js`
  - front: `components/world/MailPanel.js` (ventana `buzon`), `components/world/AttachPicker.js`

## 5. Muñecos de venta (ya en commit)

- **Inspiración:** el Hired Merchant de MapleStory, la tienda sentada de NosTale y el vending de
  Ragnarok.
- **Pip el titiritero:** NPC nuevo en el Barrio del Mercado (86,52), con sprite y retrato hechos
  en Aseprite. Vende el muñeco a 200 de oro.
- **El puesto:**
  - el muñeco se usa desde la mochila y se planta en el Barrio del Mercado;
  - le pones un cartel, eliges el aspecto (osito, conejito o gatito) y hasta 10 cosas con su
    cantidad y precio;
  - vende por ti durante 24 h, aunque no estés conectado;
  - cada venta te paga al momento, menos un 3 % de comisión, y te avisa;
  - al recogerlo, o al vencer, lo que no se vendió te llega por correo.
- **Restricciones:**
  - solo se planta en el mercado;
  - tiene que estar separado de otros muñecos y de los NPC;
  - uno por jugador;
  - para comprarle hay que estar al lado.
- **Archivos:**
  - back: `lib/puestos.js`, `routes/puestos.js` y las tablas `player_stalls`,
    `player_stall_items`, `player_stall_sales`
  - front: `components/world/StallPanel.js`, `components/world/MyStallPanel.js`,
    `game/stallLayer.js`, `components/world/Puestos.css`

## 6. Arreglos de la revisión de lo que agregó otra sesión (sin commit)

**Back:**

- `lib/cercania.js`: nueva función `cercaDe(jugador, zona, x, y, radio)`.
- **Guía** (`lib/guia.js`): cada paso se comprueba en el servidor.
  - Tomás, el Pilar, la Estatua y la Aldea: se mira dónde estás.
  - Puerta: hay que estar en la Pradera.
  - Combate: hay que tener `combat_wins > 0`.
  - Recurso: hay que haber recogido algo.
  - La mochila no se puede comprobar y da poco.
  - Antes se podían cobrar todos los pasos desde la API sin moverse.
- **Exploración** (`lib/exploracion.js`):
  - los cofres secretos tienen su casilla y exigen estar cerca;
  - las subzonas tienen su rectángulo (copiado de `pradera/mundo.json`) y exigen estar dentro;
  - el guardado del mapa explorado se hace con la fila bloqueada, así dos guardados no se pisan.
- **Mercader ambulante** (`lib/eventos.js`):
  - hay que estar junto a Varo (al lado del Pilar);
  - el límite de 2 compras por día se cuenta dentro de la transacción.

**Front:**

- **Columna derecha del HUD:** eventos, guía y misiones van en una sola columna bajo el minimapa
  (`.hud-right`), así no se pisan. El botón de sonido pasó al lado del minimapa.
- **Tutorial viejo:** `TutorialTour` ya no aparece en `/mundo`; ahí está la guía del aventurero.
- **Guía:** `useGuide` reintenta hasta 3 veces si el servidor todavía no sabe que llegaste.

**Pendiente:** `/api/world/mitico` sigue diciendo públicamente dónde está el jefe aunque esté
escondido. Para ocultarlo, la detección de "lo encontraste" tendría que pasar al servidor.

## 7. Ventanas que no mostraban todo su contenido (sin commit)

- **Causa:** las ventanas (`.wp-panel`) no tenían alto máximo y su cuerpo no se desplazaba.
- **Arreglo:**
  - alto y ancho máximos del tamaño de la pantalla;
  - el cuerpo se desplaza por dentro;
  - la ventana se reacomoda si el contenido crece (`ResizeObserver` en `FloatingPanel.js`);
  - en pantallas angostas no se guarda la posición, para que no quede corrida en la computadora.
- **Prueba:** se revisaron las 31 ventanas en 375×812, 731×698 y 1366×768. Ninguna queda fuera ni
  se desborda a lo ancho.

## 8. Modo celular y tablet (sin commit)

Todo está en `components/world/WorldMobile.css`, más cambios chicos en `pages/World.js`.

- **Celular vertical (≤600 px):**
  - la barra muestra Mochila, Misiones, Mapa, Piedra y un botón **☰** que abre una cuadrícula
    con todas las ventanas;
  - arriba: retrato con chat y sonido a la izquierda, minimapa con la columna de eventos, guía y
    misiones a la derecha;
  - las ventanas van a todo el ancho y lo que estaba en dos columnas pasa a una (ficha, lista y
    detalle, formación, mascotas, logros, taller, comercio, puesto, correo);
  - las pestañas que no caben se deslizan de lado.
- **Celular horizontal (alto ≤520 px):** barra compacta abajo a la derecha, ventanas casi a
  pantalla completa y la guía oculta.
- **Tablet y pantallas de 601 a 760 px:** ventanas a todo el ancho y la barra se desliza de lado.
- **Laptop (761 a 1600 px):** la barra va a la derecha para no pisar el chat. Por debajo de
  1180 px los botones son más chicos.
- **Táctil:** se ocultan el botón de atajos y las teclas de los botones.
- **Combate en celular vertical:**
  - `game/BattleScene.js` ahora encuadra a lo ancho los dos bandos y rellena arriba y abajo con
    el cielo y la tierra del fondo (antes no se veía ni al héroe ni al monstruo);
  - en `Battle.css`: tu grupo arriba a la izquierda, los enemigos arriba a la derecha, el menú
    abajo a la izquierda, lo que va pasando abajo a la derecha, y las tarjetas de héroe en
    versión compacta.
- **Pendiente:** se probó emulando los tamaños en el navegador, no en un celular real. Entre 761 y
  unos 960 px de ancho (ventanas de escritorio muy angostas) la barra todavía puede rozar el chat.

## 9. Sprites de NPCs (sin commit)

| Personaje | Problema | Arreglo |
|---|---|---|
| **Varo** (mercader ambulante) | La mochila se dibujaba encima de la cara: la franja tapaba la frente en el sprite y cruzaba la cara en el retrato | Ahora se dibuja detrás del personaje (`crear_ambulante.lua`) |
| **Maestra maga** | El sombrero estaba al revés (como un embudo), el pelo asomaba por encima del ala y la cara estaba torcida (sombra de un solo lado); el retrato tenía orejas que parecían bloques | Cono hacia arriba, pelo bajo el ala, cara pareja con boca, retrato con orejas más cortas y rubor |
| **Aelin, Elenya, Lyra y la maga, de espaldas** | La punta del pelo largo era un rectángulo oscuro que parecía una mochila | La punta se afina y tiene mechones |
| **Ciudadano `cit_11`** | Túnica y piel del mismo marrón: no se veía la cara | Túnica clara con ribete marrón |

- **Cómo se hizo:** con dos scripts chicos que regeneran solo estos personajes,
  `art/sprites/mundo/arreglar_npcs.lua` y `art/sprites/mundo/arreglar_lyra.lua`. Los scripts
  grandes (`crear_ciudad.lua`, `crear_extras.lua`) generan la ciudad entera, los recursos y las
  mascotas, así que no se volvieron a correr.
- **Control:** Tomás y Ren, que no se tocaron, salieron byte a byte iguales a los que ya estaban.
- **Para el futuro:** los arreglos también se pasaron a los scripts originales. El retoque de la
  maga vive en `arreglar_npcs.lua`; si alguien vuelve a correr `crear_ciudad.lua`, hay que correr
  `arreglar_npcs.lua` después.
- **Revisión:** se revisaron los 46 sprites de caminar y los 24 retratos. El resto está bien.

## 10. Cómo se probó

- **Servidores temporales** en 5097/3003, con `EVENTOS_FORZAR=mercader,noche_caza` para tener los
  eventos activos.
- **Varias sesiones a la vez:** Brisa y una cuenta temporal (`tercera.prueba@local.test`).
- **Scripts de socket y API** para comercio, puestos, correo, guía, cofres y el mercader:
  - se comprobó que se rechaza lo indebido (estar lejos, repetir objetos, pasarse del límite);
  - se comprobó que en la base las cantidades y el oro quedan bien.
- **Navegador** para la interfaz: ventanas, celular, tablet, combate vertical y menú ☰.
- **Al terminar:**
  - se restauró a Brisa (oro 0, XP 0, mochila vacía, solo su carta original);
  - se borraron la cuenta temporal, sus filas y los combates de prueba;
  - se detuvieron los servidores temporales.
- **Revisiones:** `npm run revisar` pasa en los dos proyectos (front con el lint limpio).

## 11. Ideas que quedaron propuestas

1. **Equilibrio base** antes de agregar contenido: medir el oro y la XP por hora de cada
   actividad y juntar todos los premios en un solo lugar del back.
2. **La Cripta del Vigía:** mazmorra de grupo hecha a mano en el mundo 2D.
   - guardianes visibles que patrullan (Etrian Odyssey);
   - jefes con "trampas" (Wizard101) y escudos que cambian de debilidad (Octopath);
   - retomar desde la última sala (Dofus);
   - se puede entrar con compañeros NPC;
   - versión recortada para empezar: 1 jefe.
3. **Después:** llaves con niveles y afijos (estilo Mythic+), la zona de nivel 15 a 30 (Montañas
   Grises) y el ajuste fino con el panel de Economía cuando haya jugadores.
