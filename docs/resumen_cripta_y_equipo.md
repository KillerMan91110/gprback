# Resumen: Cripta del Vigía, arreglos del mundo 2D y arte del equipo

Trabajo hecho en `D:\vscode\gpr` (front) y `D:\vscode\gprback` (back). **No hay commits**: el
usuario los hace cuando termina la tanda.

---

## 1. La Cripta del Vigía (mazmorra)

Mazmorra hecha a mano bajo las **Ruinas del Vigía** (Pradera Dorada). Es una **zona fuera del
continente**: no está en `etheria.json`, se entra por una `salida` y la escena se reinicia.

### Cómo se juega

- **Entrada:** boca de cripta con escaleras en las Ruinas (Pradera, casillas 30-31, 104).
- **Recorrido** (se baja hacia el sur):
  1. Antesala: escaleras de vuelta y **brasero 1**.
  2. Galería de los Centinelas: dos **Centinelas de Hueso** que patrullan de lado a lado.
  3. Osario: **brasero 2** y el **Espectro de la Cripta**, que da vueltas.
  4. Puerta del Vigía: **sellada** hasta vencer a los tres guardianes.
  5. Cámara del Faro: **el Vigía Caído** (jefe) y unas escaleras de salida a las ruinas.
- **Guardianes visibles** (estilo Etrian Odyssey):
  - Cada uno tiene un **cono de luz**. Si entras en él, sale un "!" y te persigue.
  - Te persigue a 80 de velocidad; el héroe va a 110, así que si corres a tiempo te escapas.
  - Si te alcanza, peleas contra él y su escolta.
  - Los que vences no vuelven durante ese recorrido.
- **Braseros** (estilo Dofus): se encienden con E. Si caes, despiertas junto al último encendido y
  los guardianes vencidos siguen vencidos.
- **El Vigía Caído**, con dos mecánicas propias:
  - **El faro:** marca a un héroe y lo avisa. En su próximo turno le dispara: si ese héroe usó
    **Defender**, recibe 8% de su vida; si no, 55%. Sobre el marcado se ve un ícono de faro y un
    anillo de luz.
  - **Escudo de 7 que cambia de debilidad** cada vez que se recupera de una rotura:
    Luz → Fuego → Rayo.
  - Además entra en **furia** a media vida, como los demás jefes.
- **Cofre del Vigía:**
  - Una vez cada 20 h por jugador: oro (500 + 40 × nivel) y un objeto al azar (pociones, un arma
    rara o un material épico).
  - Al vencerlo, el recorrido vuelve a empezar y el pregonero lo anuncia.
  - Un recorrido sin tocar en 24 h también se reinicia.
- **Grupo:** entras con tus compañeros NPC. Los jugadores de tu grupo que estén a tu lado entran
  contigo al combate (esto no se probó con dos jugadores reales).
- **Cartas de utilidad:** Centinela → Aguante, Espectro → Serenidad, Vigía → Respiro. Los tres
  monstruos aparecen en el Bestiario de la Pradera.

### Archivos

**Back (`gprback`)**

| Archivo | Qué hace |
|---|---|
| `lib/cripta.js` | Crea monstruos, escalados, resistencias y botín (`CRIPTA_*`, sin zona, así nunca salen en la Pradera). Guarda el recorrido (`player_crypt_runs`) y los braseros, prepara los combates, entrega el cofre y tiene las mecánicas del jefe (`initBoss`, `weakElementOf`, `onBreakEnd`, `bossTurn`). |
| `routes/cripta.js` | Rutas en `/api/player/:id/world/cripta`: `GET /` (estado), `POST /brasero`, `POST /combate { objetivo }`. Comprueba que estés cerca (`cercaDe`). |
| `routes/combat.js` | Ganchos de las mecánicas del jefe y cierre del combate (`rewards.crypt`). Bloquea los `CRIPTA_*` en `/sessions` y exporta `worldGroupPartners` y `notifyLeftOut`. |
| `lib/coleccion.js` | Agrega cartas por código de monstruo (`CARD_EFFECT_BY_CODE`). |
| `routes/coleccion.js` | Muestra los de la cripta en el bestiario. |
| `server.js` | Monta la ruta de la cripta. |
| `db/schema.sql` | Copia de `player_crypt_runs` y de `combat_sessions.crypt_target`. |

**Front (`gpr`)**

| Archivo | Qué hace |
|---|---|
| `art/mapas/generar_cripta.js` | Genera `public/assets/mundo/cripta/` (1x2 trozos, `interior: true`, `mazmorra: 'cripta'`). Todavía no está editada a mano, se puede regenerar. |
| `src/game/world/cripta.js` | Escena: boca de la cripta, guardianes con ronda y cono, braseros, puerta, jefe, oscuridad del interior y dónde despiertas si caes. |
| `src/components/world/CryptHud.js` (+ `.css`) | `useCrypt` (estado, braseros, puerta) y `CryptTracker` (recuadro bajo el minimapa). |
| `Battle.js`, `World.js` | Combate `kind: 'cripta'`, cartel del jefe, textos del encuentro y premios. |
| `audio.js` | Tema `cripta`. |
| `statuses.js`, `BattleScene.js` | Estado `FARO`. |
| `BattleScene.js` | Fondos por zona (`fondos/cripta`), con la clave de textura con el nombre del fondo. |
| Editor (`editor/zone.js`, `editor/render.js`, `pages/MapEditor.js`) | Puntos `guardian`, `brasero`, `sello` y `vigia`, y casilla de sí/no para las propiedades booleanas. |
| `public/assets/mundo/pradera/chunk_0_3.json` | Salida `entrada_cripta`. |

**Arte (Aseprite)**

- `crear_cripta.lua`: tileset de la cripta, brasero, puerta sellada, boca de la cripta,
  Centinela, Espectro y Vigía.
- `crear_fondo_cripta.lua`: fondo de combate en 5 capas.
- Ambos están copiados en `gpr/art/sprites/mundo/`.

> Si mueves braseros, guardianes, puerta o jefe en el mapa, cambia también sus casillas en
> `gprback/lib/cripta.js`: el servidor comprueba que estés cerca.

### Variables para probar (no van en producción)

| Variable | Efecto |
|---|---|
| `CRIPTA_NIVEL=1` | Nivel mínimo para entrar (normal: 5). |
| `CRIPTA_COFRE_HORAS=0` | Horas de espera entre cofres (normal: 20). |
| `POSICION_LIBRE=1` | Desactiva el control de cercanía, para probar con curl. |

---

## 2. Arreglos del mundo 2D

| Problema | Causa | Arreglo |
|---|---|---|
| **El héroe quedaba quieto al entrar o salir de la cripta** (había que apretar F5). | Al saltar de zona la escena se reinicia, y el teclado apagado y la marca de "cambiando de zona" quedaban de la escena anterior. | `init` los reinicia y `create` vuelve a encender el teclado. También se quitan al cerrar los oyentes `wake` y `postupdate`, que se duplicaban. |
| **Bucle de combates al huir** de un monstruo con sprite. | El respiro de 5 s se contaba con el reloj de la escena, que se para durante el combate: al volver ya había pasado. | El respiro se cuenta desde el primer cuadro de vuelta en el mapa. Al huir son **3 s** y el héroe parpadea. El guardián de la cripta del que huiste te ignora **8 s** (se ve semitransparente). |
| **`Cannot read properties of null (reading 'tint')`** al caer derrotado. | La niebla del jefe mítico (y otras cosas creadas una sola vez) seguía apuntando a objetos de la escena anterior, ya destruidos. | `init` reinicia `mythicFog`, `mythicTrail`, `minions`, `wanderer` (Varo), `city`, `crypt` y `mythic`. |
| El escudo del jefe de la cripta salía con 3 en vez de 7. | La caché de rarezas de `combat.js` se llenaba antes de que existieran los monstruos nuevos. | `getMonsterRarities(code)` recarga si falta el código. |

Archivos: `game/WorldScene.js`, `game/world/shared.js` (`ESCAPE_GRACE_MS`) y
`game/world/cripta.js`.

---

## 3. Arte del equipo de las 5 clases base (íconos y combate)

> ⚠️ **No probado en el navegador.** El código pasa el lint y `npm run revisar`, y el reparto de
> formas y sets se comprobó contra la base (ver abajo). La prueba visual quedó interrumpida.
> Falta mirar la mochila, la ficha del personaje y un combate con equipo puesto.

### Idea

Cada pieza tiene una **forma** y un **set**. Las formas se dibujan una vez con "papeles" de color
(metal, adorno, tela, gema, madera) y cada set pone sus colores en esos papeles.

- **33 formas:**
  - Armas: espada, gran espada, hacha, espada rúnica, daga, arco, ballesta, báculo arcano,
    varita, báculo sagrado.
  - Mano secundaria: escudo, carcaj, orbe, cristal, daga gemela, símbolo sagrado.
  - Cabeza: yelmo, capucha, capirote, máscara, diadema.
  - Torso: placas, gabán, túnica, cuero, vestidura.
  - Manos: guanteletes, guantes, guantes de tela, guantes bendecidos.
  - Pies: botas pesadas, botas, sandalias.
- **21 sets de color:**
  - Genéricos: hierro, acero.
  - De zona: pradera, montaña, capitán, titán, acantilado, volcán, rey de las montañas,
    caldera, titán de fuego, costas, océano, profundidades, tundra, rey del hielo, catacumbas,
    lich, ancestral.
  - Especiales: arcano, sagrado.
- La forma y el set salen del **código** del ítem (`GUERRERO_ARMOR_VOLCAN`) o, si no viene, del
  **nombre**. El hueco (cabeza, torso…) y la clase deciden la forma; por ejemplo, unas "Botas de
  Pradera" del guerrero son botas pesadas.
- **Resultado contra la base:** las 629 piezas de las clases base tienen arte, salvo los
  accesorios, que no estaban en el pedido y siguen con el ícono de game-icons. Las demás clases
  también siguen con game-icons.

### Combate

- El servidor manda en el estado del combate lo que lleva puesto cada héroe
  (`participants[].gear = { weapon, offhand, armor }`).
- `BattleScene` dibuja:
  - el **arma equipada**, con su forma y su color de set;
  - la **mano secundaria** en la mano de atrás (escudo, carcaj, orbe, cristal, daga gemela,
    símbolo);
  - el **cuerpo de la clase con la ropa pintada del color de la armadura**: la placa y la capa
    del guerrero, la túnica del mago, el gabán del arquero, el cuero y la bufanda del pícaro.
    La vestidura del sacerdote solo toma un tinte, para que siga siendo clara.
- Las hojas de combate vienen en colores "llave" y se repintan con la paleta del set una sola vez
  por combinación (`game/battleGear.js`).
- Los compañeros NPC siguen con el arma de su clase.

### Archivos

**Arte**

- Script: `D:\Sprites\v2\crear_equipo.lua`, copiado en `gpr/art/sprites/combate/crear_equipo.lua`.
- Salida en `gpr/public/assets/sprites/equipo/`:
  - `iconos.png` y `iconos.json`: atlas de 32x32, con una fila por forma y una columna por set.
  - `paletas.json`: colores de cada set y colores llave.
  - `combate/<forma>.png`: 16 hojas de 19 cuadros, con las mismas poses que `crear_sprites_v2.lua`.

**Front**

| Archivo | Qué hace |
|---|---|
| `src/game/gear.js` | `gearArt(item)` devuelve la forma y el set. Tiene las listas `SHAPES` y `SETS` (en el mismo orden que el atlas) e `iconCell`. |
| `src/game/battleGear.js` | Carga y repinta las hojas de combate y el cuerpo según la armadura. |
| `src/components/world/ItemIcon.js` (+ `.css`) | Dibuja el pixel art o, si la pieza no tiene, el ícono de game-icons. |
| `components/world/itemIcons.js` | `iconForItem` ahora devuelve también `art`. |
| Paneles | Mochila, Personaje, Taller, Encantar, Inspeccionar, Mercado, Mercader, Encargos y Adjuntar usan `ItemIcon` y le pasan el ítem completo (con código y clase). |
| `BattleScene.js` | Mueve, voltea y tiñe la mano secundaria junto al cuerpo y el arma. |

**Back:** `routes/combat.js` (`fetchSessionState` agrega `gear` a cada jugador).

> Si cambias el orden de las formas o de los sets en `crear_equipo.lua`, cámbialo también en
> `SHAPES` y `SETS` de `game/gear.js`.

### Pendiente

1. Probar en el navegador:
   - la mochila y la ficha del personaje, para ver que los íconos se vean bien de tamaño;
   - un combate con equipo puesto de las 5 clases, para ver que las armas, la mano secundaria y
     la ropa salgan bien pintadas.
2. Revisar que `textures.addSpriteSheet` acepte el canvas en Phaser 3.80. Si no, usar
   `addBase64` o `addCanvas`.
3. Accesorios y equipo de las clases avanzadas: todavía usan game-icons.

---

## 4. Datos de prueba y limpieza

- **Marco (id 8):**
  - Quedó como antes de las pruebas de la cripta: nivel 5, 10.759 XP, 16.923 de oro,
    113/161 de vida y 45/120 de maná.
  - Puede tener algunos Minerales de Hierro de más, sacados de los centinelas: la mochila no
    guarda historial.
  - El oro y la vida que perdió después (al caer contra los centinelas en sus propias partidas)
    **no** fueron de las pruebas.
- **Brisa (id 11):** quedó igual: nivel 1, sin oro, sin equipo y sin objetos. Se le quitó el
  equipo de prueba y su fila de la cripta.
- **Combate de prueba abierto:** el 6207 se cerró.
- **Servidores temporales:** detenidos.
- **Aullaluna:** salió porque el contador de la Pradera llegó a 150 con otra actividad en la base
  compartida, no por las pruebas. Los monstruos de la cripta no cuentan para el jefe mítico.

## 5. Revisiones

`npm run revisar` pasa en los dos proyectos (front con lint limpio). La documentación para otros
agentes está en `D:\vscode\CLAUDE.gpr.md` y `CLAUDE.gprback.md` (sección de la cripta y variables
de prueba). El arte del equipo **todavía no está documentado ahí**.
