# Zona 5 · Tundra Eterna (61-75) — «El invierno que protege»

Diseño para aprobar antes de programar, como se hizo con las Costas (`zona4_costas.md`). Sale de
`historia_etheria.md` (zona 5) y `mapa_etheria.md`. Si el código no coincide con esto, manda el código.

---

## 1. La zona en una frase

Un reino del norte congelado **a propósito**: el **Rey del Hielo** cubrió la tundra de invierno para
frenar la corrupción del **Quinto Sello**. Su hija, la **Bruja Congelada**, se unió a los Ocultos por
odio a su padre, y el **Príncipe del Hielo** quiere salvarlos a los dos. Llegas en el barco de
Rhaegar, persiguiendo al Encapuchado, que huyó «al norte, hacia el hielo» (final de la C14).

---

## 2. Dónde va en el continente y cómo se entra

- **Lugar:** arriba a la derecha del continente, en (320, 90) de `mapa_etheria.md`. Para que la fila
  norte no quede en coordenadas negativas se **corre todo el continente 120 casillas hacia abajo** en
  `etheria.json`, como ya estaba previsto. Es seguro: cada zona y cada posición guardada usan
  coordenadas propias de su zona (lo comprobé: `mundo_posicion_v2`, `cercania.js` y los míticos).
- **Se entra en barco:** **La Gaviota Insolente** de Rhaegar, desde la punta del muelle del Puerto
  Antiguo hasta el **muelle del Fiordo Blanco**. Es un viaje, como las balsas y los botes, no una
  frontera caminable. Se abre al terminar la C14; Rhaegar queda con su barco en los dos muelles (ida y
  vuelta).
- **Bordes:** acantilados de hielo y mar helado por los cuatro lados. No toca a pie ninguna otra zona
  (las Ruinas quedan al oeste, tras el Velo).
- **Salida hacia la zona 6:** la Cripta Congelada «baja al abismo» (queda cerrada hasta las Catacumbas).

---

## 3. El mapa (4×4 trozos, norte arriba)

```
  ┌───────────────┬───────────────┬───────────────┬───────────────┐
  │ PALACIO DE    │  GRIETA DEL   │  CEMENTERIO   │  TORRE DE     │
  │ HIELO (73-75) │  GLACIAR      │  REAL ⛩ Cripta│  CRISTAL      │
  │ el Rey        │  (70-73)      │  Congelada    │  (66-68)      │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ VALLE DE LOS  │ SANTUARIO DEL │  LAGO DE      │  BOSQUE DE    │
  │ GIGANTES      │ QUINTO SELLO  │  CRISTAL      │  PINOS BLANCOS│
  │ (68-71)       │ Guardián 72   │  (64-67)      │  (62-65)      │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ CAMPAMENTO DE │  ESTEPA DE LA │  ALDEA DE LOS │  COSTA        │
  │ LOS CAZADORES │  AURORA       │  MAMUTS       │  HELADA       │
  │ (65-68)       │  (63-66)      │  (62-64)      │  (61-63)      │
  ├───────────────┴───────────────┴───────────────┼───────────────┤
  │            MAR HELADO (témpanos, islotes)     │ FIORDO BLANCO │
  │                                               │ ⚓ (ciudad)    │
  └───────────────────────────────────────────────┴───────────────┘
```

El camino sube del Fiordo (abajo a la derecha) hacia el oeste y el norte, y cada subzona es un poco
más alta que la anterior. El **Palacio de Hielo** queda en el rincón más lejano.

**Terrenos:** se reusan los de nieve, hielo y roca de las Montañas (ya están en el tileset). Se agregan
nieve profunda (más lenta), agua helada del fiordo (choca), hielo del lago (resbala, ver sección 4),
musgo de la tundra, piedra rúnica y muelles nevados. Objetos: pinos blancos, casas largas norteñas,
el palacio, la Torre de Cristal, mamuts de piedra, menhires rúnicos, tiendas de cazadores y hogueras.

---

## 4. Lo que la hace única

- **El frío.** Fuera de la ciudad, una barra de **calor** baja despacio (más rápido con ventisca y de
  noche). Las **hogueras** (refugios), las fogatas de los campamentos y la comida caliente la llenan.
  Con la barra vacía quedas **Entumecido**: caminas más lento y pierdes un poco de vida (nunca llega a
  0, como las brasas del Volcán). Es como la tormenta y las brasas: módulo `frio.js` en el front y
  `lib/frio.js` en el back.
- **El hielo del Lago de Cristal:** sobre el hielo **resbalas** (sigues de largo hasta chocar). Los
  peces y un cofre están en el medio: hay que pensar el camino.
- **La aurora:** de noche el cielo se pinta de verde y morado (solo se ve), y el **mítico** sale en
  noches de aurora.
- **Trineos de perros** (viaje rápido dentro de la zona, como los botes de Marul): Fiordo Blanco,
  Aldea de los Mamuts y Campamento de los Cazadores.
- **Una elección que cambia el final de la zona:** perdonar a la Bruja o entregarla (sección 10).

---

## 5. Monstruos

Se **reusan los 5 comunes que ya existen** (Espíritu Congelado, Lobo de Hielo, Gigante de Nieve,
Cazador del Hielo, Jabalí Helado) repartidos por subzona y nivel, y se agregan 7. Uno o dos por
subzona, en grupos que se sienten (una manada, un campamento), no regados por todo el mapa.

| Monstruo | Código | Nivel | Dónde | Tipo · elemento | Material | Habilidad |
|---|---|---|---|---|---|---|
| Foca Colmilluda *(nuevo)* | `FOCA_COLMILLO` | 61-63 | Costa Helada | BESTIA · agua | Grasa de Foca | Mordisco en el hielo |
| Jabalí Helado | `JABALI_HELADO` *(existe)* | 62-64 | Aldea de los Mamuts | BESTIA · hielo | Colmillo de Jabalí Helado | Embestida |
| Lobo de Hielo | `LOBO_HIELO` *(existe)* | 62-65 | Bosque de Pinos Blancos | BESTIA · hielo | Piel de Lobo de Hielo | Mordida Helada (congelación) |
| Búho Níveo *(nuevo)* | `BUHO_NIVEO` | 63-66 | Bosque, Estepa | BESTIA · viento | Pluma Nívea | Picado silencioso (ceguera) |
| Espíritu Congelado | `ESPIRITU_CONGELADO` *(existe)* | 64-67 | Lago de Cristal | ESPECTRO · hielo | Esencia Congelada | Toque Gélido |
| Elemental de Escarcha *(nuevo, magia)* | `ELEMENTAL_ESCARCHA` | 65-68 | Torre de Cristal | ELEMENTAL · hielo | Núcleo de Escarcha | Lanza de Hielo + Armadura de Escarcha |
| Cazador del Hielo | `CAZADOR_HIELO` *(existe)* | 65-68 | Campamento de los Cazadores | HUMANOIDE | Trampa de Cazador | Trampa de oso (inmoviliza) |
| Oso de las Nieves *(nuevo)* | `OSO_NIEVES` | 67-70 | Valle de los Gigantes | BESTIA · hielo | Zarpa de Oso Blanco | Abrazo de Oso (aturde) |
| Gigante de Nieve | `GIGANTE_NIEVE` *(existe)* | 68-71 | Valle de los Gigantes | HUMANOIDE · hielo | Puño de Gigante | Avalancha (a todos) |
| Cultista del Eclipse Helado *(nuevo, magia)* | `CULTISTA_HELADO` | 69-72 | Grieta del Glaciar | HUMANOIDE · oscuro | Sello del Eclipse Helado | Rezo Helado (maldición) |
| Caballero de Escarcha *(nuevo)* | `CABALLERO_ESCARCHA` | 71-74 | Cementerio Real, Palacio | MUERTO_VIVIENTE · hielo | Placa de Escarcha | Tajo Glacial |
| Sierpe Glacial *(nueva)* | `SIERPE_GLACIAL` | 72-75 | Grieta, Palacio | BESTIA · hielo | Escama Glacial | Aliento Helado (a todos) |
| **Mamut Lanudo** (raro) | `MAMUT_LANUDO` *(nuevo)* | 66-69 | Estepa y Aldea (aparece poco) | BESTIA | **Colmillo de Mamut** (llave del tier medio) | Pisotón (a todos) |
| **Lobo de la Aurora** (raro) | `LOBO_AURORA` *(nuevo)* | 70-73 | Grieta, de noche | ESPECTRO · luz | **Pelaje de Aurora** | Aullido de la Aurora |
| **Guardián del Hielo** (minijefe) | `GUARDIAN_HIELO` *(existe)* | 72 | Santuario del Quinto Sello | ELEMENTAL · hielo | Núcleo del Guardián + pergaminos | Escudo de Hielo; Martillo Glaciar |
| **Rey del Hielo** (legendario) | `REY_HIELO` *(existe)* | 75 | Palacio de Hielo | HUMANOIDE · hielo | Corona del Rey del Hielo + pergaminos | Invierno Eterno (a todos); Trono Congelado |

**La Bruja Congelada y el Príncipe** (`BRUJA_CONGELADA`, `PRINCIPE_HIELO`, hoy raros del pasto) dejan
de salir en el pasto (sin zona, como el Señor del Océano): son personajes. La Bruja se pelea en la
historia (emboscadas y su duelo en la T12); el Príncipe es un aliado que te acompaña en las escoltas.

**Mazmorra (4 propios, ver sección 8):** Doncella de Hielo, Gárgola Glacial, Escolta de la Reina y el
jefe, **Escarcha, la Sierpe de la Reina**.

**Mítico de la zona:** **Hrimgar, el Lobo de la Aurora Eterna**: un lobo enorme hecho de luz verde que
solo sale en las noches de aurora. Esbirro: Cachorro de la Aurora. Unos 45.000 de vida.

---

## 6. Recursos, materiales y comida

| Recurso del mapa | Dónde | Da | Para qué |
|---|---|---|---|
| **Flor de Escarcha** (planta) | Bosque, Estepa, Lago | `FLOR_ESCARCHA` | pociones, té caliente; la secundaria de recolección |
| Veta de Hielo Eterno (mineral) | Torre, Grieta | `HIELO_ETERNO` | equipo (el «metal» de la zona) |
| Pino Blanco (madera) | Bosque de Pinos Blancos | `MADERA_PINO_BLANCO` | arcos, bastones, escudos |
| Agujero de pesca (en el hielo) | Lago de Cristal (resbaloso) | `PESCADO_GLACIAL` + a veces una perla de hielo | comida |
| Menhir rúnico | Estepa, Cementerio | `RUNA_NORTENA` | encantar, joyas |
| Cofre de la tundra | escondido | oro y materiales | — |

**Comida caliente** (la posada del Fiordo): Estofado de Mamut, Pescado Glacial a la Brasa, Hidromiel
Caliente, Pan de Centeno con Grasa de Foca, Sopa de Raíces, Té de Flor de Escarcha. Todas llenan la
barra de **calor** además de su bono.

---

## 7. Equipo y crafteo (con la escalera v2/v3)

Cinco escalones, como las Costas, en la **Forja de la Casa Larga** del Fiordo Blanco:

| Tier | Código | Nivel | Qué pide |
|---|---|---|---|
| de la Tundra | `_TUNDRA` (piezas viejas, se repasan) | 61 RARO | comunes de la Costa, el Bosque y la Aldea; pino blanco, hielo eterno |
| Glaciar | `_GLACIAR` (nuevo) | 66 ÉPICO | osos, gigantes, elementales + **Colmillo de Mamut** o **Pelaje de Aurora** |
| de la Reina (armas) | `_REINA` (nuevo) | 67 LEGENDARIO | **Lágrima de la Reina** + Hielo Eterno Puro (la Cripta Congelada) |
| del Guardián | set nuevo con los pergaminos del Guardián | 70 ÉPICO | pergamino + Núcleo del Guardián |
| del Rey del Hielo | `_HIELO` (pergaminos que ya existen) | 75 LEGENDARIO | pergamino + Corona del Rey del Hielo |

Sets de color nuevos `glaciar`, `reina` y `rey_hielo` para el arte del equipo. Los sets de jefe piden
la mitad de materiales, y los pergaminos salen **uno solo por jefe** (la regla nueva).

---

## 8. La mazmorra: la Cripta Congelada (67-73)

- **Qué es:** la tumba de la reina, madre del Príncipe y de la Bruja. Los Ocultos la profanaron para
  llegar al Sello por debajo. **Baja al abismo:** al fondo, una escalera sellada (las Catacumbas).
- **Se abre con:** la T9 (la Anciana te da la **Llave de la Reina**).
- **Puntos de control: velas de hielo azul** («Encender»). Si caes, vuelves a la última.
- **Tres guardianes:** las Doncellas de Hielo (de a dos), la Gárgola Glacial y la Escolta de la Reina.
- **Jefe: Escarcha, la Sierpe de la Reina**, la mascota de la reina, enloquecida con un cristal.
  Escudo Fuego → Rayo; **Aliento de la Tumba** anunciado (se esquiva defendiéndose). Al caer aparece
  el **eco de la reina**, que te cuenta por qué el Rey congeló la tundra.
- **Botín:** Lágrima de la Reina (armas de la Reina), Hielo Eterno Puro, piezas Glaciar de tu clase en
  el cofre (cada 3 horas).
- **Arte:** tileset propio (hielo azul, sarcófagos, estatuas de la reina), vela de hielo, compuerta
  helada, fondo de combate y el tema `cripta_congelada`.

---

## 9. Pueblo y NPCs: Fiordo Blanco (los norteños)

| NPC | Dónde | Quién es | Para qué |
|---|---|---|---|
| **Hrafna, la Anciana del Hielo** | casa larga del jarl | la abuela de la familia real; seca y sabia | historia principal |
| **Eirik, el Príncipe del Hielo** | primero en el Lago; después en el Fiordo | quiere salvar a su padre y a su hermana | historia, escoltas, *Rencor de hermanos* |
| **Sigrún** | Forja de la Casa Larga | herrera norteña; desafía a Brokk e Ignar | equipo, encantar |
| **Gunnhild** | la posada «El Cuerno Caliente» | posadera que grita brindis | comida caliente |
| **Bjorn el Mudo** | el muelle | mercader que habla por señas (y su loro no) | tienda propia (`MERCADER_FIORDO`) |
| **Rhaegar** | muelle, con su barco | sigue contigo | barco de vuelta, una secundaria |
| **Ren** | en el Bosque de Pinos Blancos | el guardabosque de la Pradera, de explorador | secundaria con Marta |
| **Tilo** | llega en un barco después de la T4 | ya es soldado; quiere ver la nieve | *El muñeco de nieve de Tilo* |
| **Skadi** | perrera de los trineos | domadora de perros de trineo | trineos (viaje rápido) |
| **Vigdis** | Torre de Cristal | astrónoma que estudia la aurora | T3, la aurora, el mítico |
| **Ulrich** | Campamento de los Cazadores | cazador que vendió el mapa a los Ocultos | historia, arrepentido |
| **la Bruja Congelada (Hela)** | aparece en emboscadas y en el Palacio | la hija | historia y la elección |

Maestros de evolución de los norteños (Berserker, Titán Furioso, Mago Criomántico): quedan para cuando
se repasen las evoluciones, como dice `mapa_etheria.md`.

---

## 10. Misiones

### Principales (T1-T14), después de C14 «La Bestia de las Profundidades»

| # | Nombre | Quién | Qué pasa |
|---|---|---|---|
| T1 | Rumbo al norte | Rhaegar | subir al barco, llegar al Fiordo, hablar con la Anciana |
| T2 | El invierno no es un castigo | Hrafna | encender tres hogueras del camino (aprendes el frío) y escuchar su historia |
| T3 | La Torre de Cristal | Hrafna → Vigdis | la torre brilla en eclipse: elementales, un cristal en la cúpula |
| T4 | El Príncipe del Hielo | Vigdis → Eirik | encontrar a Eirik en el Lago (hielo resbaloso) y escoltarlo al Fiordo |
| T5 | Cabezas por oro | Eirik | los Cazadores venden mapas a los Ocultos: limpiar el campamento, hablar con Ulrich |
| T6 | La Bruja en la ventisca | Ulrich → Eirik | la Bruja intenta romper el hielo del Sello: emboscada; huye |
| T7 | Los gigantes despiertan | Eirik | la ventisca de la Bruja despertó a los gigantes del Valle |
| T8 | El Guardián del Hielo | Hrafna | el Guardián del Quinto Sello, enloquecido (minijefe) |
| T9 | La llave de la reina | Hrafna | la Anciana te da la Llave de la Reina |
| T10 | La Cripta Congelada | Hrafna | la mazmorra; el eco de la reina |
| T11 | Lo que la reina sabía | Eirik | el Rey congeló la tundra para frenar el Sello; la Bruja no lo sabe |
| T12 | Hermanos en la nieve | Eirik | duelo con la Bruja en la Grieta del Glaciar; Eirik la detiene antes del golpe final |
| T13 | El Rey del Hielo | Hrafna | el Rey pide morir para que el Sello se renueve (legendario); Quinto Fragmento |
| T14 | Perdón o justicia | Eirik | **eliges**: *El perdón* (la Bruja se queda con la Anciana) o *La justicia* (la entregas a Elenya). Llevar el fragmento a Elenya |

**La elección:** la T14 son dos misiones que se excluyen (aceptar una esconde la otra). Lo que elegiste
queda guardado: cambia diálogos del Fiordo, dónde aparece la Bruja (en la casa larga o en una celda de
Aurelia) y quién llega con refuerzos al final del juego.

### Secundarias (14, en cadenas cortas)

*Rencor de hermanos* (3, Eirik y la Bruja: cartas que nunca se mandaron); *El muñeco de nieve de Tilo*
(2, graciosa: el muñeco termina con el yelmo de Tilo y un pañuelo de Anka); *Flores de escarcha*
(recolección para Gunnhild); *El explorador* (2, Ren y una carta para Marta); *¿Dónde está Trueno? (en la
nieve)* (Trueno se escapó en el barco, otra vez); *Tres forjas* (Sigrún desafía a Brokk e Ignar: cartas
de ida y vuelta); *Pesca en el hielo* (Bjorn); *El mamut perdido* (una cría separada de su manada, en la
Aldea); *La aurora* (2, Vigdis: medir la aurora con un cristal); *El cazador arrepentido* (Ulrich).

### Diarias

3 nuevas (pesca, hogueras, osos) y las 11 que ya existen, cada una con su NPC (como en las Costas).

### Reglas que se cumplen en todas

Cada búsqueda y emboscada con su dibujo (nada de «?» sobre la nada); cada NPC donde tiene sentido; las
fases cambian el mundo según tu historia (el lago se deshiela un poco, la Torre deja de brillar en
eclipse, el Palacio se abre, la Bruja aparece o no según tu elección).

---

## 11. Los demás sistemas

| Sistema | Qué lleva en la Tundra |
|---|---|
| Bestiario y cartas | entran solos |
| Huevos | huevos de mascota en los drops (y el huevo de la Tundra si sale lo de los huevos por zona) |
| Mítico | Hrimgar, el Lobo de la Aurora Eterna, en `MITICOS[5]` |
| Exploración | `ZONES.tundra` (12 subzonas), premio por explorarla entera (~5500 de oro y 13000 de experiencia) y 3 secretos: el barco atrapado en el hielo, la cueva del mamut de piedra y el nido del búho gigante |
| Música | `tundra` (cuernos y viento) y `cripta_congelada` |
| Carteles | Tundra, Fiordo Blanco y la Cripta |
| Mercader | Bjorn (`MERCADER_FIORDO`) |
| Refugios | una hoguera por subzona (además dan calor) |
| Fondos de combate | Tundra (nieve y aurora) y Cripta Congelada (hielo azul), 5 capas cada uno |
| Editor | terrenos y recursos nuevos |
| Atlas (M) | la Tundra en su lugar, con la ruta del barco |
| Encantador | Sigrún |
| Viaje rápido | el barco de Rhaegar (Costas ↔ Fiordo) y los trineos de Skadi |

---

## 12. Preguntas para Marco (antes de programar)

1. **La elección de la T14** es para siempre (no se puede cambiar después). ¿Está bien así?
2. **El frío:** ¿con daño leve y lentitud (como propongo) o solo lentitud?
3. **Mover el continente 120 casillas hacia abajo** para poner la Tundra al norte, como dice
   `mapa_etheria.md`. ¿Seguimos ese plan?
4. **Los huevos con tema y los sobres de cartas por zona** siguen aparte (la tarjeta que quedó); cuando
   se hagan, la Tundra recibe los suyos.

## 13. Tandas (como en las Costas)

1. Mapa, tileset, el barco de Rhaegar, mover el continente y Fiordo Blanco.
2. Monstruos, sprites, fondo de combate y equilibrio.
3. Recursos, equipo, crafteo, sets de jefe y comida.
4. NPCs, misiones (con la elección), diálogos y fases.
5. La Cripta Congelada.
6. El frío, el hielo resbaloso, los trineos, el mítico, la aurora, la música y los secretos.

## 14. Estado (por tandas)

**Tanda 1 — mapa, tileset, el barco de Rhaegar, mover el continente y Fiordo Blanco: hecha** (sin commit).

- **Tileset v9** (`art/sprites/mundo/crear_mundo.lua`, al final): 200 tiles nuevos (1417 en total; los
  1217 viejos, comprobados idénticos píxel a píxel). Terrenos con bordes automáticos: `nieveh` (nieve
  profunda), `fiordo` (agua helada; choca), `musgo`, `muellen` (muelle nevado), `lago` (el hielo del
  Lago de Cristal: mismo dibujo que el lago de las Montañas, pero se camina) y `losah` (losas de hielo).
  Objetos: abeto blanco, menhir rúnico, tienda de cazador, perrera, estandarte norteño, mamut de piedra,
  Torre de Cristal, Palacio de Hielo, la entrada de la Cripta Congelada, hoguera norteña, leña, trineo,
  témpano, escudo, cuerno de hidromiel, flores de escarcha y las casas norteñas (casa larga, casa,
  posada y forja; muro de troncos «nordico»). Se reusan la nieve, la roca, los picos, los pinos nevados,
  la hierba nevada (combates), los abismos y los puentes colgantes de las Montañas.
- **Editor** (`src/editor/rules.js`): los terrenos nuevos con sus pinceles. La nieve junto a ellos va
  entera (ellos dibujan su borde) y el camino entre la nieve profunda, el musgo o el lago lleva orilla
  de roca.
- **Mapa** (`art/mapas/generar_tundra.js` → `public/assets/mundo/tundra/`): 15 subzonas (12 con niveles),
  la pared de roca al norte y el mar helado alrededor, el Lago de Cristal, la Grieta del Glaciar con
  puentes colgantes, el Santuario con su círculo de menhires, el Palacio de Hielo con su explanada, el
  Cementerio Real con la entrada de la Cripta, la Torre de Cristal, el campamento de los cazadores, los
  mamuts de piedra, el círculo de la Estepa, una hoguera (refugio) por subzona y 29 grupos de monstruos
  pensados (apagados hasta la tanda 2: `COMBATES_LISTOS = false`). Desde el muelle se llega caminando a
  todo, salvo a los islotes del Mar Helado (el secreto del barco atrapado, tanda 6).
- **Fiordo Blanco:** la casa larga de la Anciana, la posada, la forja, casas, la perrera de los
  trineos, la plaza con la hoguera (enfermería), el muelle con La Gaviota Insolente atracada y Rhaegar.
- **Continente:** `etheria.json` corrido 120 casillas hacia abajo, con la Tundra en (320, 90).
  `ZONE_TITLES`, atlas (M) con la ruta del barco desde las Costas.
- **El barco** (`lib/barco.js`, `POST /world/barco`): Rhaegar te lleva del muelle del Puerto Antiguo al
  de Fiordo Blanco y de vuelta, gratis, desde que terminaste la C14. Opción en los diálogos de
  `rhaegar_puerto` y de `rhaegar_fiordo` (`src/game/dialoguesTundra.js`).
- **Back:** `lib/exploracion.js` (`ZONES.tundra`, `ZONE_IDS.tundra`), `ZONE_ID_OF_DIR` en
  `routes/players.js`, los muelles en `lib/cercania.js` y `rhaegar_fiordo` en `NPC_HOMES`.
- **Probado por API:** sin la C14 Rhaegar no zarpa; con la C14 lleva al Fiordo y trae de vuelta;
  exploración conoce la Tundra. Brisa quedó como estaba.
- **La música** es por ahora la de las Montañas (la `tundra` llega en la tanda 6).

**Tanda 2 — monstruos, sprites, efectos, fondo de combate y combates encendidos: hecha** (sin commit).

- **Monstruos** (`gpr/_respaldo_claude/tundra/gen_tundra.js` → `tundra_monstruos.sql`, ya al final de
  `db/schema.sql` y de `db/pendiente_supabase.sql`, repetible): 12 comunes (61-75), 2 raros (Mamut
  Lanudo y Lobo de la Aurora), el Guardián del Hielo (minijefe 72) y el Rey del Hielo (jefe 75). La
  Bruja Congelada y el Príncipe de Hielo quedan sin zona (son de la historia, tanda 4). 15 habilidades
  nuevas y materiales nuevos (grasa de foca, pluma nívea, núcleo de escarcha, zarpa de oso blanco…).
- **Equilibrio** (`scripts/equilibrio/generar.js`): perfiles de los 17 y `simulateTundra`. Hoy usa los
  sets viejos TUNDRA/HIELO; se reajusta con el equipo nuevo en la tanda 3.
- **Sprites** (`gpr/art/sprites/enemigos/crear_enemigos_tundra.lua` → `enemigos/zona5/` y
  `public/assets/sprites/combate/enemigos/`): los 17 con sus 5 animaciones, en `enemigos.json`. El
  Príncipe de Hielo todavía no tiene (llega con la historia).
- **Efectos** (`crear_efectos_monstruos.lua`, ahora 92): las 15 habilidades nuevas con su animación y
  la paleta `aurora`.
- **Fondo de combate** (`art/sprites/mundo/crear_fondo_tundra.lua` → `combate/fondos/tundra/`): noche
  con aurora, glaciares con la Torre de Cristal detrás, lomas con abetos blancos y un menhir, nieve con
  placas de hielo y témpanos. `ZONE_BACKGROUND[5] = 'tundra'`.
- **Mapa:** `COMBATES_LISTOS = true`: 32 grupos (todas las subzonas con los suyos; en el Cementerio y la
  Grieta se aceptan grupos más chicos) y los jefes `santuario_guardian` (58,39) y `trono_rey_hielo`
  (17,18). Todo alcanzable desde el muelle.
- **Probado por API:** los 32 grupos arrancan con sus monstruos y niveles; los dos jefes arrancan y se
  ganan (botín y carta del Rey); un combate común se gana. Brisa quedó como estaba y se borraron los
  combates de prueba.

**Tanda 3 — recursos, equipo y crafteo, sets de jefe, comidas y venta: hecha** (sin commit).

- **Recursos** (7 tipos, 61 sitios en 22 nodos): `veta_hielo` (Hielo Eterno), `flor_escarcha`,
  `pino_blanco`, `agujero_pesca` (en el hielo del Lago), `menhir_runas` (Runa Norteña), `restos_trineo`
  (oro, madera, grasa y a veces un Colmillo de Mamut) y `cofre_tundra`. Arte en
  `gpr/art/sprites/mundo/crear_recursos7.lua` (`recursos7.png`); qué da cada uno en `lib/worldNodes.js`;
  sus sitios los pone el generador del mapa, que también escribe `lib/worldNodes.zonas.json["5"]`.
- **Equipo** (`_respaldo_claude/tundra/gen_equipo_tundra.js` + `gen_escalera_tundra.js`), en la Forja
  de la Casa Larga de Fiordo Blanco (`forja_fiordo` en `lib/cercania.js`, servicios `forja` y `taller`;
  artesana Sigrún):
  | Tier | Código | Nivel | Qué pide |
  |---|---|---|---|
  | de la Tundra | `_TUNDRA` (piezas viejas, recetas rehechas) | 61 RARO 90% | jabalíes, lobos, búhos, espíritus, focas, hielo eterno, pino blanco y flores |
  | Glaciar | `_GLACIAR` (nuevo) | 66 ÉPICO 80% | gigantes, osos, cazadores, elementales, runas + **Colmillo de Mamut** o **Pelaje de Aurora** |
  | de la Reina | `_REINA` (armas nuevas) | 67 LEGENDARIO 75% | **Lágrima de la Reina** + Hielo Eterno Puro (los suelta la Cripta Congelada, tanda 5) |
  | del Guardián | `_GUARDIAN` (set nuevo, con joyas) | 70 ÉPICO 70% | pergamino del Guardián (17,5%) + **Núcleo del Guardián del Hielo** |
  | del Rey del Hielo | `_REY_HIELO` (set viejo) | 75 LEGENDARIO 55% | pergamino del Rey (12,5%) + **Corona del Rey del Hielo** |
  La forma de cada pieza sale de su par del Volcán (Tundra ← Volcán, Glaciar ← Obsidiana, Guardián ←
  Caldera, Rey ← Titán de Fuego; la Reina ← Hierro Negro), como en las Costas. Las armas siguen la
  escalera sobre las de la Bestia (+7% comunes, +9% de mazmorra y jefe). Los sets de jefe piden la mitad
  de materiales. Se quitaron de las recetas viejas el Anillo del Príncipe y el Báculo de la Bruja. El
  Rey además suelta Colmillos de Mamut, Pelajes de Aurora y a veces un Núcleo del Guardián.
- **Equilibrio:** se subió la vida de los comunes (×1,15 a ×1,35, más a los de las primeras subzonas):
  con el equipo de cada tramo, ~3-3,8 turnos para matar (4 redondeado; el Pícaro ~3, como en las Costas)
  y 5-14 golpes aguantados (`node scripts/equilibrio/generar.js --simular --detalle`).
- **Costo de fabricar** (combates o recolecciones esperados): piezas chicas 4-8, grandes de la Tundra
  10-15, grandes Glaciares 23-28 (la llave, ~10), Guardián 7-14 + su núcleo y el pergamino, comidas 2-5
  (la Sopa de Raíces 11 y el Estofado de Mamut 13: la carne sale de un raro).
- **Comidas** (Gunnhild; `gen_comidas_tundra.js`): Pescado Glacial a la Brasa, Pan de Centeno con Grasa
  de Foca, Sopa de Raíces, Hidromiel Caliente, Estofado de Mamut, Té de Flor de Escarcha y Elixir de la
  Aurora. El Mamut suelta Carne de Mamut y el Jabalí Helado, Carne de Jabalí. Que llenen la barra de
  calor queda para la tanda 6 (el frío).
- **Otros:** `sell_zone_mult` ×5 para lo de la tundra, `ZONE_NAMES[5]` en `lib/fuentes.js`,
  `balance_versions 'tundra_v1'`, sets de color `glaciar`, `reina` y `guardian` (`crear_equipo.lua`,
  `gear.js`). Los materiales usan los íconos por palabra (como los del Volcán y las Costas).
- **Probado por API:** con Brisa a nivel 70: leer el pergamino del Guardián enseña sus 8 recetas; se
  fabricaron una pieza de la Tundra, un arma Glaciar, una pieza del Guardián y el Estofado de Mamut;
  se recolectó en 5 tipos de recurso de la Tundra; «¿Dónde?» del Hielo Eterno lista sus monstruos y
  vetas. Brisa quedó como estaba. Todo el bloque de la Tundra de `pendiente_supabase.sql` se aplicó dos
  veces sin errores.
- **Pendiente para otras tandas:** la Lágrima de la Reina y el Hielo Eterno Puro todavía no los suelta
  nadie (la Cripta Congelada, tanda 5); Sigrún y Gunnhild en el mapa (tanda 4).

**Tanda 4 — NPCs, misiones con la elección, diálogos y fases: hecha** (sin commit).

- **Misiones** (`_respaldo_claude/tundra/gen_misiones_tundra.js` → `tundra_misiones.sql`): las 14
  principales T1-T14 (la T1 pide la C14 de las Costas; las viejas Guardián de Hielo y Rey del Hielo son la
  T8 y la T13 con su mismo código; la vieja Cazador de Espíritus pasó a secundaria), 16 secundarias
  (Rencor de hermanos ×3, el muñeco de nieve de Tilo ×2 —termina en un huevo—, Flores de escarcha, El
  explorador ×2 con la carta de Ren a Marta, Trueno en la nieve, Tres forjas con Brokk, Pesca en el
  hielo, El mamut perdido, La aurora ×2, El cazador arrepentido y Los espíritus del lago), 3 diarias
  nuevas y las 11 viejas rehechas con su NPC (Plaga y Cacería no tenían objetivos; las del Príncipe y la
  Bruja ahora piden al Lobo de la Aurora y al Mamut Lanudo). 10 objetos de misión.
- **La elección (T14):** «El perdón» (Hela se queda en la casa larga con su abuela) o «La justicia» (Rhaegar
  la lleva a Aurelia y queda junto a Elenya). `lib/eleccion.js` guarda los pares de misiones que se
  excluyen: si aceptaste o entregaste una, la otra no aparece y no se puede aceptar (si la abandonas
  antes de entregarla, la otra vuelve). Los diálogos de Rhaegar, Hrafna, Eirik, Gunnhild y Hela cambian
  según lo que elegiste. **Ojo para la zona 6:** lo que siga a la T14 tiene que aceptar cualquiera de las
  dos (hoy `requires_quest_id` es una sola).
- **T10 (la Cripta Congelada):** por ahora es abrir la puerta, escuchar el eco de la reina y vencer a
  los Caballeros de Escarcha; la bajada a la mazmorra y su jefe se suman en la tanda 5.
- **NPCs** (12 en la Tundra, generados con el mapa): Hrafna, Eirik (en el Lago hasta la T4; después en la
  casa larga), Hela (desde la T13, según la elección), Sigrún (forja y encantar), Gunnhild (cocinar),
  Bjorn (`MERCADER_FIORDO`, `tundra_mercader.sql`), Skadi, Tilo (después de la T4), Vigdis, Ulrich y Ren.
  En Aurelia, `hela_aurelia` junto a Elenya (se agregó solo ese punto al mapa editado). Sprites y retratos
  nuevos en `crear_npcs_misiones.lua`; 4 dibujos nuevos de búsquedas (hoguera apagada, Trueno en la
  nieve, el muñeco de Tilo y la cría de mamut) en `crear_puntos_mision.lua`.
- `NPC_HOMES` (`lib/questSteps.js`), `NPC_LUGAR` (`questGivers.js`), `cercania.js` (Bjorn y la posada),
  diálogos en `gpr/src/game/dialoguesTundra.js`.
- **Probado:** `revisar_misiones.js 5` sin problemas (45 misiones, 126 pasos); por API con Brisa: la T1
  entera, y la T14: se ven las dos, aceptar «El perdón» esconde «La justicia» (y aceptarla igual da
  error), sus 4 pasos y la entrega a Elenya; después «La justicia» no vuelve. Brisa quedó como estaba.

**Tanda 5 — la Cripta Congelada: hecha** (sin commit).

- **Back:** `lib/cripta_congelada.js` (molde de `lib/mazmorra.js`, en `lib/mazmorras.js` y `server.js`),
  nivel 67-73. Guardianes: las Doncellas de Hielo (Galería de la Reina, de a dos), la Gárgola Glacial
  (Puente del Abismo) y la Escolta de la Reina (Cámara de la Escolta); los siembra el servidor al
  arrancar (código `CRIPTAH_…`). Puntos de control: velas de hielo («Encender»). Jefe: **Escarcha, la
  Sierpe de la Reina**, con escudo Fuego → Rayo y el Aliento de la Tumba anunciado (se esquiva
  defendiéndose). Botín: Hielo Eterno Puro (todos) y la Lágrima de la Reina (Escarcha, 50%); cofre cada
  3 h con pociones, una pieza Glaciar de tu clase o Lágrimas. Se entra con la T9 entregada (la Llave de
  la Reina) o la T10 completa.
- **Arreglo del molde (vale para todas las mazmorras):** las llaves son objetos de misión y se van al
  entregar la misión que te las da; la Mina, la Fisura y el Arrecife pedían la llave en la mochila o la
  misión siguiente (la de bajar) ya completa, así que después de entregar la misión de la llave no se
  podía entrar. Ahora la puerta también se abre si completaste la misión que **da** la llave.
- **T10:** ahora baja de verdad: abrir la puerta, calmar a Escarcha y escuchar el eco de la reina junto a
  su tumba (dentro de la Cripta).
- **Arte:** `crear_cripta_congelada.lua` (tileset con losas de hielo, paredes de piedra con velas y
  runas, el abismo helado con su puente, sarcófagos, urnas, estatuas de la reina y su tumba; la vela de
  hielo y la Compuerta Helada), `crear_fondo_cripta_congelada.lua` (fondo de combate) y los 4 monstruos en
  `crear_enemigos_tundra.lua`. Mapa: `art/mapas/generar_cripta_congelada.js` (mismo plano que el
  Arrecife). Música `cripta_congelada` (la canción de cuna de la reina) en `game/audio.js`.
- **Tundra:** la entrada es la casilla de abajo en el medio del portal del Cementerio Real (100,10).
- **Probado por API:** sin nivel no se entra; el Arrecife se abre con la C7 entregada; el paso de jefe de
  la T10 queda enlazado con Escarcha; vela; compuerta cerrada hasta los tres guardianes; guardián; jefe
  con su escudo de Fuego; su botín (Lágrima de la Reina y Hielo Eterno Puro); cofre; y el paso de la T10
  cuenta al calmarla. Brisa quedó como estaba.

**Tanda 6 — el frío, el hielo, los trineos, el mítico, la aurora, la música y los escondites: hecha**
(sin commit). Con esto la Tundra queda completa.

- **El frío** (`gpr/src/game/world/frio.js` y `lib/frio.js`, `POST /world/frio`): fuera de Fiordo Blanco
  la barra de **calor** baja de 100 a 0 en unos 4 minutos (×1,5 de noche y ×1,3 con nevada). Junto a una
  hoguera (los refugios de cada subzona) y en Fiordo Blanco sube; comer cualquier comida la llena. Con la
  barra vacía quedas **Entumecido**: caminas un 30% más lento y cada 12 s el servidor te quita un 5% de
  la vida (nunca hasta 0, no más de una vez cada 10 s). El HUD la muestra junto a los bufos (porcentaje y
  aviso en azul cuando baja de 25%). El calor se guarda por pestaña (sessionStorage).
- **El hielo del Lago de Cristal** (tiles `lago_*`): el héroe resbala, arranca y frena despacio y sigue de
  largo un poco al soltar las teclas. No es un rompecabezas de «deslizarse hasta chocar»: en el medio del
  lago están Eirik y los agujeros de pesca y hay que poder pararse.
- **Trineos de Skadi** (`lib/trineos.js`, `POST /world/trineo`): la perrera de Fiordo Blanco (Skadi), la
  Aldea de los Mamuts (su hermana Kari) y el Campamento de los Cazadores (su hermano Leif), 30 de oro,
  solo a paradas ya descubiertas a pie. Sprites nuevos de Kari y Leif.
- **Mítico:** Hrimgar, el Lobo de la Aurora Eterna, y sus lobeznos (`MITICOS[5]` en `lib/mythic.js`,
  sprites en `crear_miticos.lua`; los otros míticos salen idénticos). Tema de colores de aurora en
  `game/world/mythic.js`.
- **La aurora:** de noche, en la Tundra, cintas verdes y moradas ondulan en lo alto de la pantalla.
- **Música** `tundra` (cuernos y un tambor lento) en `game/audio.js`; el mapa ya no usa la de las Montañas.
- **Escondites** (`lib/exploracion.js` SECRETS): el barco atrapado en el hielo (en el islote del medio del
  Mar Helado; la lengua de hielo ahora llega a la costa y al islote), las ofrendas de la cueva del mamut de
  piedra (Aldea) y el nido del búho gigante (Bosque). El premio por explorar la zona entera ya estaba.
- **Probado por API:** trineos (viaje, parada que no existe, sin oro), el frío (−5%, el segundo seguido no
  cuenta, con 2 de vida queda en 1), los tres escondites (una sola vez) y Hrimgar (sembrado, nivel 68,
  y una cacería forzada en el Valle que después se borró). `revisar_misiones.js 5` sin problemas. Brisa
  quedó como estaba.
- **Quedó afuera:** el sobre de cartas y el huevo con tema de la Tundra (siguen con la idea de los huevos
  y sobres por zona); que la zona 6 acepte cualquiera de las dos T14.
