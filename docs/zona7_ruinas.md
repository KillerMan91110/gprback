# Zona 7 · Ruinas Ancestrales (86-100) — «Las lágrimas de Aethra»

Diseño de la zona final, como `zona5_tundra.md` y `zona6_catacumbas.md`. Sale de `historia_etheria.md`
(zona 7) y `mapa_etheria.md`. Marco aprobó el diseño con todas las propuestas de la sección 12, y **las siete
tandas están hechas** (ver la sección 14, por tandas). Si el código no coincide con esto, manda el código.

---

## 1. La zona en una frase

Al lado de Aurelia, detrás de una niebla que nadie pudo cruzar, está el templo más antiguo del mundo: ahí
**Aethra** encerró al **Devorador de Estrellas** y lo ató con siete Sellos. La **Última Sacerdotisa** de
los aethrinos cuida el **Séptimo Sello**, el último que queda entero. Y el **Gran Esqueleto del Abismo**,
que vigila el fondo del templo, es el cuerpo del **primer Vigía**, el antepasado de Aldren, poseído por
la oscuridad del Devorador. Con los siete Fragmentos, el jugador renueva los Sellos y se convierte en el
**Vigía de Etheria**.

---

## 2. Dónde va en el continente y cómo se entra

- **En el continente**, no bajo tierra: va en `etheria.json` en **(160, 90)**, 4×4 trozos como las demás.
  - Al oeste queda Aurelia.
  - Al sur, las Montañas Grises.
  - Al este, la Tundra.
- **El Velo de Aethra:** una niebla blanca que tapa los bordes de las Ruinas que tocan a las Montañas y a
  la Tundra. Desde las Montañas y desde Aurelia se ven las torres del templo detrás de la niebla.
  - Al chocar con el Velo sale un aviso: «Una niebla blanca y tibia. Detrás se ven torres. Algo te empuja
    suavemente hacia atrás.»
- **Primera entrada: el Velo se abre en la R1.** Elenya pone los seis Fragmentos en el Pilar de Aethra
  (A14 de las Catacumbas) y el Velo se adelgaza en un solo punto: la **Puerta del Velo**, en el borde sur
  de las Ruinas (casillas 63-65), justo encima del Pinar Nevado de las Montañas. Del lado de las Montañas
  se abrió un paso en la fila de picos del borde norte (casillas 63-65, filas 0-2). Hasta el paso 2 de la
  R1, una niebla (punto «escena» con fase) tapa el hueco.
- **Atajo desde las Catacumbas:** la escalera del fondo del Trono de Huesos sube a la **Cripta de los
  Heraldos**, dentro del templo. Se abre en la R4 (como dice el mapa: «el Trono de Huesos se abre al
  templo»).
- **El final** (R13) pasa en el **Pilar de Aethra de Aurelia**, no en las Ruinas: el ritual se hace donde
  empezó todo.

---

## 3. El mapa (4×4 trozos, norte arriba)

```
  ┌───────────────┬───────────────┬───────────────┬───────────────┐
  │ TORRES DEL    │ OBSERVATORIO  │ CORAZÓN DEL   │ GRIETA        │
  │ VELO (93-95)  │ ROTO ⛩        │ TEMPLO (98-100│ ESTELAR       │
  │               │ (mazmorra)    │ Séptimo Sello)│ (96-98)       │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ BOSQUE        │ PATIO DE LAS  │ TEMPLO        │ JARDINES DE   │
  │ PETRIFICADO   │ ESTATUAS      │ SAGRADO       │ LAS LÁGRIMAS  │
  │ (90-92)       │ (91-93)       │ (94-96)       │ (92-94)       │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ ESCALINATA DE │  SANTUARIO DE │ CRIPTA DE LOS │ LAGO DE LAS   │
  │ LOS PEREGRINOS│  LAS LÁGRIMAS │ HERALDOS      │ LÁGRIMAS      │
  │ (88-90)       │  (la ciudad)  │ (90-92) ⇣Trono│ (91-93)       │
  ├───────────────┼───────────────┼───────────────┼───────────────┤
  │ CAMPO DE LOS  │ PUERTA DEL    │ CANTERA DE    │ CAMINO DE LAS │
  │ VIGÍAS (87-89)│ VELO (86-87)  │ MÁRMOL (88-90)│ CUMBRES (89-91│
  │               │ ⇣ Montañas    │               │ (el Velo)     │
  └───────────────┴───────────────┴───────────────┴───────────────┘
```

- **Cómo se recorre:** se entra por el sur (la Puerta del Velo) y se sube hacia el norte. El Santuario de
  las Lágrimas queda justo encima de la entrada. Lo más hondo (el Corazón del Templo, con el Séptimo
  Sello) queda arriba, en el medio.
- **Campo de los Vigías:** un cementerio de piedra con las tumbas de los Vigías de cada tierra. Una está
  vacía: la del primer Vigía (su cuerpo es el Gran Esqueleto).
- **Grieta Estelar:** el cielo roto. Por ahí se escapa la oscuridad del Devorador; es la subzona más rara
  (el suelo flota, se ven estrellas abajo).
- **Camino de las Cumbres:** el Velo sigue por las cumbres hacia la Tundra. No se abre (es borde), salvo
  quizás después del final.
- **Terrenos nuevos (tileset v11):**
  - mármol blanco agrietado (suelo del templo);
  - césped dorado (el «pasto» de los combates);
  - agua de lágrimas (azul claro, brilla, no choca en los bajos);
  - piedra flotante y cielo estelar (la Grieta, choca);
  - escalinatas de mármol y losas de oro;
  - el Velo (niebla, choca).
- **Objetos:** columnas rotas, estatuas de Aethra y de los Vigías, fuentes de lágrimas (los refugios),
  arcos, árboles de piedra, el telescopio roto, altares de los Sellos, torres, peregrinos de piedra,
  cristales de eclipse grandes, y las casas del Santuario en tres estados (ver 4).

---

## 4. Lo que la hace única

- **Los eclipses (la mirada del Devorador):** cada tanto, el cielo de las Ruinas se oscurece en un
  **eclipse** que dura ~1 minuto. Hay aviso antes («El sol tiembla…»).
  - Durante el eclipse los monstruos salen **corrompidos**: +20% de fuerza y +25% de botín.
  - Junto a una **fuente de lágrimas** (los refugios) el eclipse no te alcanza: ahí no hay combates.
  - No quita vida.

  Es la mecánica propia de la zona, como el frío de la Tundra o la llama de las Catacumbas. Va en la
  tanda 6.
- **El Santuario que revive:** el Santuario de las Lágrimas empieza en ruinas, con la Sacerdotisa sola. A
  medida que avanzas en la historia, cambia en tres etapas (con fases, como los NPCs):
  1. Ruinas.
  2. Desde la R5, vuelven los peregrinos: se abren la posada y el mercader.
  3. Desde la R9, la fuente se enciende y la forja vuelve a funcionar.

  Los tiles y los NPCs de cada etapa se ponen con fases en el mapa.
- **Las Escalinatas de Luz:** viaje rápido entre el Santuario, el Patio de las Estatuas y las Torres del
  Velo, como la barca de Óbolo. Gratis: es luz de Aethra.
- **El final con tus aliados:** al final llegan a Aurelia los personajes que ayudaste, según lo que
  elegiste en el viaje (ver 10 y 12).

---

## 5. Monstruos

Se **reusan los 9 que ya existen** (repartidos y renovados con la escalera) y se agregan 7 comunes y 2
raros.

| Monstruo | Código | Nivel | Dónde | Tipo · elemento | Material |
|---|---|---|---|---|---|
| Peregrino de Piedra *(nuevo)* | `PEREGRINO_PIEDRA` | 86-88 | Puerta del Velo, Escalinata | HUMANOIDE · tierra | Polvo de Mármol |
| Grifo del Templo *(nuevo)* | `GRIFO_TEMPLO` | 87-89 | Campo de los Vigías, Cantera | BESTIA · viento | Pluma de Grifo |
| Guardián de Ruinas | `GUARDIAN_RUINAS` *(existe)* | 88-90 | Cantera, Escalinata | HUMANOIDE | (los suyos) |
| Serpiente de Lágrimas *(nueva)* | `SERPIENTE_LAGRIMAS` | 89-91 | Lago y Jardines | ACUATICO · agua | Escama de Lágrima |
| Centinela Antiguo | `CENTINELA_ANTIGUO` *(existe)* | 90-92 | Bosque Petrificado, Patio | HUMANOIDE | (los suyos) |
| Heraldo Olvidado *(nuevo, magia)* | `HERALDO_OLVIDADO` | 90-92 | Cripta de los Heraldos | ESPECTRO · luz | Trompeta Rota |
| Guardianes Elementales (fuego, hielo, agua) | `GUARDIAN_*_ANCESTRAL` *(existen)* | 91-94 | Jardines, Patio, Lago (uno por subzona) | ELEMENTAL | esencias ancestrales |
| Estrella Caída *(nueva, magia)* | `ESTRELLA_CAIDA` | 93-95 | Torres del Velo | COSMICO · luz | Polvo de Estrellas |
| Engendro del Devorador *(nuevo)* | `ENGENDRO_DEVORADOR` | 95-97 | Templo Sagrado, Grieta | DEMONIO · oscuro | Carne Estelar |
| Ojo Errante *(nuevo, magia)* | `OJO_ERRANTE` | 96-98 | Grieta Estelar | COSMICO · oscuro | Iris del Vacío |
| **Coloso de Mármol** (raro) *(nuevo)* | `COLOSO_MARMOL` | 90-93 | Cantera y Patio (aparece poco) | HUMANOIDE · tierra | **Corazón de Mármol** (llave del tier medio) |
| **Avatar del Eclipse** (raro) *(nuevo)* | `AVATAR_ECLIPSE` | 95-98 | Grieta y Corazón del Templo | COSMICO · oscuro | **Corona Eclipsada** |
| **Guardián Ancestral Primordial** | `GUARDIAN_ANCESTRAL` *(existe, raro)* | 94 | Templo Sagrado | HUMANOIDE | minijefe de la R3 |
| **Entidad Corrupta del Templo** (minijefe) | `ENTIDAD_CORRUPTA_TEMPLO` *(existe, hoy raro)* | 95 | Templo Sagrado | DEMONIO | historia (R5) |
| **Centinela Cósmico** (minijefe) | `CENTINELA_COSMICO` *(existe)* | 97 | la cima del Observatorio (afuera) | ELEMENTAL/COSMICO | Núcleo Cósmico + pergaminos |
| **Gran Esqueleto del Abismo** (legendario) | `GRAN_ESQUELETO_ABISMO` *(existe)* | 100 | Corazón del Templo | MUERTO_VIVIENTE · oscuro | Alma del Gran Esqueleto + pergaminos |

- Stats por fórmula y equilibrio como en la zona 6: los comunes caen en ~3-4 turnos con el equipo de la
  zona.
- Cada monstruo nuevo lleva sus habilidades con su estado (cegar con luz, gravedad que baja la velocidad,
  mirada que atonta, eclipse que baja la defensa…), con efectos nuevos en la lámina.

**Mazmorra (sección 8):** el Astrónomo Fantasma, los Autómatas del Cielo, la Constelación Viva y el jefe,
**el Ojo del Devorador**.

**Mítico:** **Astrea, la Ballena de las Estrellas**: una ballena enorme hecha de cielo nocturno que nada
por encima de las Torres las noches sin luna. Sus esbirros son **pececillos estelares**. Va en
`MITICOS[7]`.

---

## 6. Recursos, materiales y comida

| Recurso del mapa | Dónde | Da | Para qué |
|---|---|---|---|
| Bloque de mármol | Cantera, Patio | `MARMOL_SAGRADO` *(nuevo)* | equipo, el «material base» de la zona |
| Veta de oro primordial | Cantera, Torres | `ORO_PRIMORDIAL` *(existe)* | equipo (el «metal» de la zona) |
| Flor luminosa | Jardines, Bosque | `FLOR_LUMINOSA` *(existe)* | pociones y comida |
| Fuente de lágrimas (pozo) | Lago, Jardines | `LAGRIMA_AETHRA` *(nueva)* | joyas, encantar, comida |
| Cráter de estrella | Torres, Grieta | `POLVO_DE_ESTRELLAS` *(existe)* | magia, el set Cósmico |
| Relicario del templo | escondido | oro y reliquias (el cofre) | — |

**Comida** (la cocina del Santuario, cuando revive): Pan de Peregrino, Sopa de Flor Luminosa, Miel de las
Lágrimas, Pescado del Lago Asado, Guiso de los Vigías y, de alquimia, Agua de Lágrimas y Néctar Estelar.

---

## 7. Equipo y crafteo (escalera v2/v3)

En la **Forja del Santuario** (cuando revive, desde la R9) y, antes, en la de Aurelia:

| Tier | Código | Nivel | Qué pide |
|---|---|---|---|
| de las Ruinas | `_RUINAS` (las 36 piezas viejas, rehechas sobre la escalera) | 86 RARO | comunes de la Puerta, la Cantera y el Campo; mármol, oro primordial |
| Estelar | `_ESTELAR` *(nuevo)* | 91 ÉPICO | serpientes, heraldos, estrellas + **Corazón de Mármol** o **Corona Eclipsada** |
| del Observatorio (armas) | `_OBSERVATORIO` *(nuevo)* | 93 LEGENDARIO | material del Ojo del Devorador (la mazmorra) |
| Cósmico | `_COSMICO` *(set nuevo, con joyas)* | 97 ÉPICO | pergamino del Centinela Cósmico + Núcleo Cósmico |
| del Primer Vigía | `_VIGIA_PRIMERO` *(set nuevo)* | 100 LEGENDARIO | pergamino del Gran Esqueleto + Alma del Gran Esqueleto |
| **Lágrima de Aethra** (arma del final) | una por clase | 100 | **no se fabrica:** la forjan Brokk e Ignar juntos en la R13 |

Sets de color nuevos `estelar`, `observatorio`, `cosmico`, `vigia_primero` y `lagrima`.

---

## 8. La mazmorra: el Observatorio Roto (92-96)

- **Qué es:** el observatorio donde los aethrinos miraban las estrellas para vigilar al Devorador. Su
  gran telescopio se partió el día que el Devorador abrió un ojo, y desde entonces el ojo mira por él.
- **Se abre con:** la R6 (la Sacerdotisa te da la **Llave del Astrolabio**).
- **Puntos de control:** lámparas de cristal («Encender»).
- **Tres guardianes:**
  - el **Astrónomo Fantasma**, el último que miró por el telescopio y no dejó de mirar;
  - los **Autómatas del Cielo**, de a dos, que todavía giran las cúpulas;
  - la **Constelación Viva**, estrellas que se juntan con forma de cazador.
- **Jefe: el Ojo del Devorador.** Un ojo enorme que mira desde el otro lado del telescopio.
  - Su escudo cambia de Luz a Rayo.
  - Su golpe anunciado es la **Mirada del Vacío**: se esquiva defendiéndose.
- **Botín:** el **Fragmento de Lente** (armas del Observatorio), Polvo de Estrellas y piezas Estelares
  de tu clase en el cofre (cada 3 horas).
- Mismo molde que el Trono de Huesos (`lib/mazmorra.js`).

---

## 9. Pueblo y NPCs: el Santuario de las Lágrimas (los aethrinos)

| NPC | Dónde | Quién es | Para qué |
|---|---|---|---|
| **Seraphine, la Última Sacerdotisa** | el altar del Santuario | la última aethrina que sirvió en el templo; mil años cuidando el Séptimo Sello sola | historia principal |
| **Elenya** (en Aurelia) | la Catedral y el Pilar | recibe los Fragmentos y hace el ritual con Seraphine | historia, final |
| **Aldren** | llega en la R8 | el último de los Vigías; viene a ver la tumba vacía de su antepasado | historia |
| **Orin, el picapedrero** | la Cantera, después la forja (R9) | un aethrino joven que vuelve con los peregrinos; restaura estatuas | forja, encantar |
| **Madre Tilda** | la posada (desde la R5) | la peregrina más vieja; cocina para todos | comida |
| **Casio, el último peregrino** | la plaza (desde la R5) | un mercader que llegó siguiendo una canción | tienda propia (`MERCADER_SANTUARIO`) |
| **Ptolio, el astrónomo** | el Observatorio (afuera) | un fantasma amable, el aprendiz del Astrónomo de la mazmorra | historia, secundarias |
| **Brokk e Ignar** | llegan para la R13 | los dos herreros rivales, juntos por fin | el arma del final |

- **Maestros de evolución aethrinos** (Arquero Celestial, Invocador Celestial, Mago Estelar, Sanador
  Divino): ver la decisión 6.
- **Vuelven del viaje para el final** (R13), según lo que hiciste:
  - Ren y Tilo (Pradera);
  - Rhaegar (Costas);
  - Eirik, y Hela según la T14 (Tundra);
  - Velkan si perdonaste (Catacumbas);
  - Liora, que sube a ver el sol una vez, como pidió en la A14.

---

## 10. Misiones

### Principales (R1-R14), después de la A14 «Lo que el Lich dijo»

| # | Nombre | Quién | Qué pasa |
|---|---|---|---|
| R1 | El Velo de Aethra | Elenya | con los seis Fragmentos en el Pilar, el Velo se adelgaza; cruzar por la Puerta del Velo |
| R2 | La Última Sacerdotisa | Seraphine | llegar al Santuario en ruinas y conocer a Seraphine; la historia de las lágrimas |
| R3 | Los Guardianes del Templo | Seraphine | (la vieja Q1) los guardianes elementales y el Guardián Ancestral, que no reconocen a nadie |
| R4 | Los Heraldos Olvidados | Seraphine | (la vieja Q4) la Cripta de los Heraldos; se abre la escalera al Trono de Huesos |
| R5 | La Entidad Corrupta del Templo | Seraphine | un cristal de eclipse gigante en el Templo Sagrado (minijefe); vuelven los peregrinos |
| R6 | La llave del astrolabio | Ptolio | Seraphine te da la llave del Observatorio |
| R7 | El Observatorio Roto | Ptolio | la mazmorra; el Ojo del Devorador ya está despierto |
| R8 | La tumba vacía | Aldren | el Campo de los Vigías; la tumba del primer Vigía está vacía (conecta con el secreto de la zona 6) |
| R9 | Las lágrimas que faltan | Seraphine | juntar lágrimas para encender la fuente del Santuario; vuelve la forja |
| R10 | El Centinela Cósmico | Ptolio | (la vieja Q2) el Centinela que cierra el camino al Corazón del Templo (minijefe) |
| R11 | El primer Vigía | Aldren → Seraphine | el Gran Esqueleto del Abismo (legendario, la vieja Q3); Aldren le habla a su antepasado |
| R12 | El Séptimo Sello | Seraphine | el Séptimo Fragmento; el Devorador abre los dos ojos |
| R13 | Las lágrimas de Aethra | Elenya | el final en Aurelia (ver abajo) |
| R14 | El Vigía de Etheria | Elenya → Aldren | el título, el epílogo y la sombra del Devorador (el Jefe Mundial) |

**El final (R13):**
1. Llevas los siete Fragmentos al Pilar de Aethra.
2. Brokk e Ignar forjan juntos la **Lágrima de Aethra** (un arma para tu clase).
3. Elenya y Seraphine empiezan el ritual. Mientras cantan, la sombra del Devorador sale por las grietas
   de la plaza: **tres combates seguidos** en la Plaza del Pilar.
4. Los aliados que ayudaste pelean a tu lado como compañeros de formación (2 por combate, según lo que
   elegiste).
5. El último combate es contra la **Sombra del Devorador**.
6. Los Sellos se renuevan.

La R14 te nombra **el Vigía de Etheria** (título) y abre el Jefe Mundial.

### Secundarias (unas 14, en cadenas cortas)

- *Las estatuas que lloran* (3, Orin: restaurar las estatuas de Aethra del Patio).
- *El aprendiz del astrónomo* (2, Ptolio: graciosa; quiere terminar el mapa de estrellas que dejó su
  maestro hace mil años).
- *La canción de Casio* (Casio: de dónde viene la canción que lo trajo hasta aquí).
- *La cocina de Madre Tilda* (flores y pescado del lago).
- *Peregrinos perdidos* (2, guiar a los peregrinos de piedra que se despiertan).
- *Tres forjas, la última vez* (Orin, Brokk e Ignar).
- *Trueno y el Velo* (Gaspar otra vez: su caballo cruzó el Velo antes que nadie).
- *Las tumbas de los Vigías* (2, Aldren: una ofrenda en cada tumba del Campo).
- *El eco de Hela* (según la T14).
- *La primera lágrima* (recolección para Seraphine).
- Las dos ocultas viejas (*El Poder Cósmico* y *Ascensión a Dios*) se conservan como están.

### Diarias

3 nuevas (eclipses, estrellas caídas, peregrinos) y las 9 viejas de la zona, rehechas con su NPC.

---

## 11. Los demás sistemas

| Sistema | Qué lleva en las Ruinas |
|---|---|
| Bestiario y cartas | entran solos |
| Huevos | huevos de mascota en los drops (épicos en los raros) |
| Mítico | Astrea, la Ballena de las Estrellas, en `MITICOS[7]` |
| Exploración | `ZONES.ruinas`, premio por explorarla entera y 3 secretos: la tumba vacía del primer Vigía, el telescopio de Ptolio y la primera lágrima de Aethra |
| Música | `ruinas` (arpa y coro, luminoso), `observatorio` (caja de música y cuerdas) y `final` (el tema del ritual) |
| Fondos de combate | Ruinas (el templo al atardecer, con las torres), Observatorio y la Plaza del Pilar de noche (el final) |
| Viaje rápido | las Escalinatas de Luz |
| Encantador | Orin |
| Jefe Mundial | después de la R14, el Devorador de Estrellas (`WORLD_BOSS_DEVORADOR_ESTRELLAS`) se reescala a nivel 100 y sale cada tanto por las grietas |

---

## 12. Preguntas para Marco (antes de programar)

1. **El nombre de la Última Sacerdotisa:** propongo **Seraphine** (ya existe la «Armadura Celestial de
   Seraphine» en la base: así tiene sentido).
2. **La mecánica propia: los eclipses** (más fuerza y más botín, refugio en las fuentes, sin daño). ¿Te
   gusta o prefieres otra? Alternativa: «la gravedad rota» de la Grieta Estelar (el héroe flota y salta
   entre piedras).
3. **¿Cuántos Fragmentos abren el Velo?** Propongo **los seis** que ya tienes: el séptimo está dentro de
   las Ruinas (el mapa decía «los siete», pero así no se podría entrar).
4. **El final:** propongo que los aliados lleguen según lo que hiciste:
   - Hela pelea a tu lado si la perdonaste. Si elegiste la justicia, llega con Elenya desde la Catedral.
   - Velkan llega solo si lo perdonaste.
   - Todos los demás llegan siempre.

   ¿Está bien, o quieres una elección nueva en la zona 7?
5. **El Jefe Mundial** (el Devorador): reescalarlo a nivel 100 y abrirlo solo después de la R14.
6. **Los maestros de evolución aethrinos:** propongo dejarlos para cuando se repasen las evoluciones de
   todas las ciudades (como los de Vela Eterna), para no hacer solo los de una.
7. **Los huevos con tema y los sobres de cartas por zona** siguen aparte.

---

## 13. Tandas

Como las Catacumbas, con una tanda más para el final:

1. Tileset v11, mapa, el Santuario (en sus tres etapas), el Velo y las entradas (la Puerta del Velo y la
   escalera desde el Trono de Huesos). Poner las Ruinas en `etheria.json`.
2. Monstruos, sprites, efectos, fondo de combate y equilibrio.
3. Recursos, equipo, crafteo, sets de jefe y comida.
4. NPCs, misiones R1-R12, diálogos y fases.
5. El Observatorio Roto (la mazmorra).
6. Los eclipses, las Escalinatas de Luz, Astrea (el mítico), la música y los secretos.
7. **El final:**
   - la R13 (el ritual en Aurelia con tus aliados, la Sombra del Devorador) y la R14;
   - la Lágrima de Aethra;
   - el título;
   - el epílogo (qué dice cada personaje del viaje después del final);
   - el Jefe Mundial a nivel 100.

## 14. Estado (por tandas)

Marco aprobó el diseño con todas las propuestas de la sección 12.

**Tanda 1 — tileset, mapa, el Santuario, el Velo y las entradas: hecha** (sin commit).

- **Tileset v11** (`art/sprites/mundo/crear_mundo.lua`, al final): 260 tiles nuevos (1931 en total). Los 1671
  viejos se comprobaron idénticos píxel a píxel, y su índice no cambió.
  - **Terrenos:**
    - `prador`: el prado claro, el suelo de base, con tres variantes.
    - `marmol`: el mármol del templo; el pasto muerde su borde.
    - `caminom`: la calzada de mármol, con juntas doradas.
    - `losaoro`: losas de oro y mármol, a veces con el sol de Aethra.
    - `sagrada`: la hierba sagrada dorada, el «pasto» de los combates.
    - `lagrima`: el agua de lágrimas (choca).
    - `puenter`: el puente de mármol.
    - `cielo`: el cielo estelar de la Grieta, con borde de piedra que flota (choca).
    - `murot`: la pared del templo, con techo y cara con columnas y vitrales (choca).
    - `velo`: la niebla del Velo, con jirones de pasto en el borde (choca).
  - **Objetos:** flores de luz, escombros, banco, vasija de ofrendas, tumba de Vigía, la tumba vacía, farol,
    la escalinata de luz (el círculo del viaje rápido, tanda 6), columna rota, estatuas de Aethra (llora
    luz) y de los Vigías, árbol de piedra, fuente de lágrimas (el refugio) y fuente seca, arco del templo,
    altar del Sello, cristal del eclipse grande, el telescopio roto, la torre del Velo, la Puerta del Velo,
    la escalera de los Heraldos y el altar del Santuario.
  - **El Santuario:** la casa aethrina, la posada y la forja, cada una restaurada y en ruinas.
  - **Paleta nueva:** `jm*` (mármol), `jp*` (prado), `jh*` (hierba sagrada), `jl*` (lágrimas), `jc*`
    (cielo), `jv*` (Velo) y `jo3`.
- **Editor** (`src/editor/rules.js`): los 10 terrenos con sus pinceles.
  - El mármol, la calzada, las losas de oro y la pared se funden entre sí.
  - La pared muestra su cara (con columnas y vitrales al azar) donde abajo hay patio.
- **Mapa** (`art/mapas/generar_ruinas.js` → `public/assets/mundo/ruinas/`):
  - Al aire libre, `zona: 7`, 16 subzonas (15 con niveles, 86-100) y una calzada que une todo desde la
    Puerta.
  - Todo el borde es el Velo, salvo el hueco de la Puerta: el generador lo comprueba y falla si hay
    huecos.
  - 15 fuentes de lágrimas (refugios) y 37 grupos de monstruos pensados, apagados hasta la tanda 2
    (`COMBATES_LISTOS = false`; la hierba sagrada ya está pintada).
  - El generador comprueba que desde la Puerta se llegue caminando a todas las subzonas y a los puntos
    importantes.
  - Música por ahora `pradera`; la propia llega en la tanda 6.
- **Los lugares** (casillas):

  | Lugar | Casilla |
  |---|---|
  | Santuario: plaza de losas de oro | (52-68, 70-82) |
  | Santuario: altar | (59,66) |
  | Santuario: fuente | (59,74) |
  | Santuario: posada | (44,66) |
  | Santuario: forja | (71,66) |
  | Santuario: casas | (45,79) y (70,79) |
  | Santuario: inicio | (60,80) |
  | Templo Sagrado | recinto 84-116 × 32-57 |
  | Corazón del Templo | recinto 86-113 × 3-26; el altar del Séptimo Sello en (99,12) |
  | Cripta de los Heraldos | recinto 86-113 × 61-84; la escalera en (98,64) |
  | Telescopio | (58,10) |
  | Tumba vacía del primer Vigía | (21,101) |
  | Puerta del Velo | (63,113) |

- **El Santuario que revive:** en el mapa quedan las ruinas. Las casas restauradas se dibujan encima con
  puntos «escena» sólidos (`art/sprites/mundo/crear_escena_ruinas.lua` → `assets/mundo/escena/`), cada una
  con su fase:
  - `RUINAS_HISTORIA_05_ENTIDAD` (R5): la posada y las dos casas.
  - `RUINAS_HISTORIA_09_LAGRIMAS` (R9): la forja y la fuente encendida.

  Los códigos de las misiones se crean en la tanda 4. Mientras no existan, se ven las ruinas.
- **Las entradas:**
  - **La Puerta del Velo:** el hueco de la calzada en el borde sur (63-65). Lo tapa la `niebla_velo`
    (escena sólida) con fase `!RUINAS_HISTORIA_01_VELO@2+,!RUINAS_HISTORIA_01_VELO`: se abre desde el paso 2
    de la R1.
    - En las Montañas (mapa editado a mano) se sacó el grupo de picos de las casillas 63-65, filas 0-2, de
      `chunk_1_0.json`, y queda nieve caminable desde el Pinar Nevado.
    - Respaldo del trozo original: `gpr/_respaldo_claude/ruinas/montanas_chunk_1_0_antes.json`.
  - **La escalera de los Heraldos:**
    - Baja de la Cripta de los Heraldos (99,66) al Trono de Huesos (14,51).
    - En la Sala del Trono se agregó la subida (13-14, 49) a las Ruinas (99,68).
    - Las dos tienen la fase `RUINAS_Q4_HERALDOS_OLVIDADOS@3+|RUINAS_Q4_HERALDOS_OLVIDADOS` (se abren desde
      el paso 3 de la R4).
- **El continente:**
  - `etheria.json` tiene a `ruinas` en (160, 90).
  - El mapa del mundo (M) se regeneró (`generar_atlas.js` y `crear_atlas.lua`).
  - **Arreglo:** el generador y el pintor del atlas tomaban como agua todo lo que empezara con «mar», y el
    mármol también empieza así. Ahora es `mar_`; las demás zonas no cambian.
  - El texto de la zona 7 en `game/atlas.js` dice cómo se llega.
- **Front:**
  - Cartel al entrar: «Detrás del Velo · Ruinas Ancestrales» (`World.js`).
  - Los refugios se llaman «la fuente de lágrimas de…» (`world/refuges.js`).
- **Back:**
  - `ZONES.ruinas` y `ZONE_IDS.ruinas` (`lib/exploracion.js`; explorarla entera da 9000 de oro y 23000 de
    experiencia).
  - `ZONE_ID_OF_DIR.ruinas = 7` (`routes/players.js`).
- **Probado por API** (`_respaldo_claude/ruinas/probar_tanda1.js`, sin posición libre):
  - Parada en el Santuario por el socket, descubrirlo da 60 de experiencia (1 de 16).
  - El Corazón del Templo, lejos, no cuenta.
  - Una subzona que no existe, tampoco.

  Brisa quedó como estaba.
- **Sin probar en el navegador:** cómo se ve el mapa en el juego, la niebla de la Puerta y el paso de
  las Montañas.

**Tanda 2 — monstruos, sprites, efectos, fondo de combate y combates encendidos: hecha** (sin commit).

- **Monstruos** (`gpr/_respaldo_claude/ruinas/gen_ruinas.js` → `ruinas_monstruos.sql`, ya al final de
  `db/schema.sql` y de `db/pendiente_supabase.sql`, repetible).
  - **12 comunes (86-98):**

    | Monstruo | Niveles | Tipo · elemento | Habilidades | Material |
    |---|---|---|---|---|
    | Peregrino de Piedra | 86-88 | HUMANOIDE · tierra | Golpe del Peregrino, Piel de Piedra | Polvo de Mármol |
    | Grifo del Templo | 87-89 | BESTIA · viento | Picado del Grifo, Chillido | Pluma de Grifo |
    | Guardián de Ruinas *(viejo)* | 88-90 | HUMANOIDE · tierra | Golpe Brutal, Piel de Piedra | Piedra Rúnica |
    | Serpiente de Lágrimas | 89-91 | ACUATICO · agua | Chorro de Lágrimas, Abrazo Ahogado | Escama de Lágrima |
    | Centinela Antiguo *(viejo)* | 90-92 | HUMANOIDE · rayo | Lanzazo, Descarga | Núcleo Antiguo |
    | Heraldo Olvidado | 90-92 | ESPECTRO · luz | Trompeta del Heraldo, Rayo de Luz | Trompeta Rota |
    | Guardián Elemental de Fuego *(viejo)* | 91-93 | ELEMENTAL · fuego | Llamarada, Cadena de Fuego | Esencia Ancestral de Fuego |
    | Guardián Elemental de Agua *(viejo)* | 91-93 | ELEMENTAL · agua | Torrente de Agua, Maremoto | Esencia Ancestral de Agua |
    | Guardián Elemental de Hielo *(viejo)* | 92-94 | ELEMENTAL · hielo | Lanza de Hielo, Aliento Helado | Esencia Ancestral de Hielo |
    | Estrella Caída | 93-95 | COSMICO · luz | Lluvia de Estrellas, Rayo de Luz | Polvo de Estrellas (15%) |
    | Engendro del Devorador | 95-97 | DEMONIO · oscuridad | Abrazo del Vacío, Mordida Desgarradora | Carne Estelar |
    | Ojo Errante | 96-98 | COSMICO · oscuridad | Mirada del Vacío, Gravedad Rota | Iris del Vacío |

  - **2 raros**, que dan la llave del tier medio (Estelar):
    - el Coloso de Mármol (90-93): Corazón de Mármol 30%;
    - el Avatar del Eclipse (95-98): Corona Eclipsada 30%.
  - **4 jefes de la historia** (solo se cambia su material propio; lo demás de su botín queda):
    - el Guardián Ancestral Primordial: pasa de raro a minijefe, nv 94, R3;
    - la Entidad Corrupta del Templo: pasa de raro a minijefe, nv 95, R5;
    - el Centinela Cósmico: minijefe, nv 97, R10; suelta el Núcleo Cósmico, nuevo, para su set;
    - el Gran Esqueleto del Abismo: legendario, nv 100, R11.
  - Los 9 que ya existían conservan código, nombre y material (los usan recetas y misiones viejas); se
    les escribió una descripción de verdad.
  - **Materiales nuevos:** Polvo de Mármol, Pluma de Grifo, Escama de Lágrima, Trompeta Rota, Carne
    Estelar, Iris del Vacío, Corazón de Mármol, Corona Eclipsada y Núcleo Cósmico. Quedan creados para la
    tanda 3 el Mármol Sagrado y la Lágrima de Aethra (recursos del mapa).
- **10 habilidades nuevas** (con sus estados):

  | Habilidad | Efecto |
  |---|---|
  | Golpe del Peregrino | aturde |
  | Picado del Grifo | sangrado |
  | Chorro de Lágrimas | −25% velocidad |
  | Trompeta del Heraldo | a todos; ceguera: 20% de fallar |
  | Lluvia de Estrellas | a todos; quemadura |
  | Abrazo del Vacío | sangrado y −15% ataque |
  | Mirada del Vacío | aturde |
  | Gravedad Rota | a todos; −30% velocidad |
  | Eclipse Total | a todos; −20% defensa |
  | Derrumbe | a todos; aturde |

- **Equilibrio** (`scripts/equilibrio/generar.js`): perfiles de los 18 y `simulateRuinas`.
  - Tiers que simula: `_RUINAS` 86, Estelar 91, armas del Observatorio 93, Cósmico 97 y Primer Vigía 100.
    El `_RUINAS` viejo, de antes de la escalera, no cuenta. Mientras no existan, usa el set del Lich.
  - Con el set del Lich, los comunes caen en ~3 turnos (el Pícaro ~2,8, el Sacerdote ~3,5) y aguantas
    5-16 golpes, como las Catacumbas en su tanda 2. En la tanda 3, con el equipo nuevo, se les vuelve a
    subir la vida.
- **Sprites** (`gpr/art/sprites/enemigos/crear_enemigos_ruinas.lua` → `enemigos/zona7/` y
  `public/assets/sprites/combate/enemigos/`): los 18 con sus 5 animaciones, en `enemigos.json`. Ninguno de
  los 9 viejos tenía sprite.
  - Los tres Guardianes Elementales son una armadura de oro hueca con la máscara aethrina y su elemento
    adentro. El de hielo lleva puntas de hielo.
  - El Gran Esqueleto es el primer Vigía: el manto azul de los Vigías, la lanza y el ojo del eclipse en
    la frente.
- **Efectos** (`crear_efectos_monstruos.lua`, ahora 115): las 10 habilidades nuevas, al final de la lámina
  (las de antes no cambian ni un píxel), y las paletas `cosmos`, `lagrima` y `marmol`.
- **Fondo de combate** (`art/sprites/mundo/crear_fondo_ruinas.lua` → `combate/fondos/ruinas/`):
  - el atardecer con la grieta del cielo roto;
  - las torres blancas entre la niebla del Velo;
  - columnas rotas con hiedra;
  - la estatua de Aethra que llora luz;
  - losas de mármol con pasto.

  `ZONE_BACKGROUND[7] = 'ruinas'`.
- **Mapa:** `COMBATES_LISTOS = true`: 37 grupos en la hierba sagrada y los 4 jefes:

  | Jefe | Punto | Casilla |
  |---|---|---|
  | Guardián Ancestral | `puerta_guardian_ancestral` | (89,45) |
  | Entidad Corrupta | `templo_entidad` | (100,47) |
  | Centinela Cósmico | `paso_centinela_cosmico` | (100,29) |
  | Gran Esqueleto | `sello_gran_esqueleto` | (100,17) |

  El mapa del mundo se regeneró: los jefes ya aparecen.
- **Probado por API** (`_respaldo_claude/ruinas/probar_combates.js`, con Brisa):
  - Los 37 grupos arrancan con sus monstruos y niveles.
  - Los 4 jefes arrancan.
  - Un combate común contra el Peregrino se gana y suelta Polvo de Mármol.

  La prueba ahora también restaura los desbloqueos de zona, el bestiario, las cartas y la cuenta del
  mítico de la zona 7. Brisa quedó como estaba. El bloque de la zona 7 se aplicó dos veces sin errores.

**Tanda 3 — recursos, equipo, crafteo, sets de jefe y comida: hecha** (sin commit).

- **Recursos del mapa** (`art/sprites/mundo/crear_recursos9.lua` → `public/assets/mundo/recursos9.png`, 12
  cuadros, lleno y vacío):

  | Recurso | Dónde | Da | Vuelve en |
  |---|---|---|---|
  | `bloque_marmol` | Cantera (4 sitios) y Patio (3) | Mármol Sagrado 85% (1-2), Polvo de Mármol 20%, Piedra Rúnica 8% | 5 min |
  | `veta_oro_primordial` | Cantera (2) y Torres (3) | Oro Primordial 75%, Mineral Épico 12%, Hierro Primordial 4%, Piedra de Encantar Menor 10% | 6 min |
  | `flores_luminosas` | Jardines (4) y Bosque Petrificado (3), solo en el prado | Flor Luminosa 85% (1-2), Hierba Mágica 20%, Polvo Arcano 5% | 4 min |
  | `fuente_lagrimas` | Lago (3) y Jardines (2) | Lágrima de Aethra 85% (1-2), Escama de Lágrima 12%, Esencia Ancestral de Agua 4% | 6 min |
  | `crater_estrella` | Torres (2) y Grieta Estelar (4) | Polvo de Estrellas 70%, Polvo Arcano 25%, Fragmento de Eclipse 5% | 8 min |
  | `relicario_templo` (el cofre) | escondidos en tres esquinas: Campo, Torres y Jardines | 1000-1800 de oro, pociones mayores, Piedra de Encantar Mayor, Oro Primordial, a veces Fragmento de Luz, Corazón de Mármol o un huevo raro | 30 min |

  - Las tablas están en `lib/worldNodes.js`. Los sitios los pone `generar_ruinas.js`, que también escribe
    `worldNodes.zonas.json["7"]` y `art/mapas/recursos_ruinas.json`: 13 grupos y 33 sitios.
  - El generador pone cada recurso al lado de una casilla a la que se llega caminando desde la Puerta.
    Primero los cráteres de la Grieta caían en islas sueltas: ahora lo comprueba y avisa.
  - Registrados en el juego (`WorldScene.js`, `world/shared.js`) y en el editor (`editor/render.js`,
    `MapEditor.js`).
  - «¿Dónde?» (`lib/fuentes.js`) ya nombra las Ruinas Ancestrales (`ZONE_NAMES[7]`).
- **La forja y la posada del Santuario** (`lib/cercania.js`):
  - `forja_santuario` (72,69): forja y taller.
  - `posada_santuario` (46,69): taller (cocina).
  - **Decisión:** se usan desde el principio, aunque estén en ruinas. La historia (R5 y R9) solo las
    restaura a la vista; Orin y Madre Tilda llegan en la tanda 4.
- **Equipo** (`_respaldo_claude/ruinas/gen_equipo_ruinas.js` paso 1 y `gen_escalera_ruinas.js` paso 2,
  como en las Catacumbas). La forma de cada pieza sale de su par del Volcán. Se fabrica con Orin, en la
  Forja del Santuario.

  | Tier | Nivel · rareza · éxito | Piezas | Qué pide |
  |---|---|---|---|
  | de las Ruinas | 86 · raro · 90% | las 36 viejas `_RUINAS`, rehechas (eran legendarias de nv 86 sueltas; la Gran Espada era nv 63). Se llaman «… de las Ruinas» | Piedra Rúnica, Pluma de Grifo, Polvo de Mármol, Flor Luminosa, Lágrima de Aethra, Mármol Sagrado, Oro Primordial |
  | Estelar | 91 · épico · 80% | 32 nuevas (copian el set Sepulcral) | Núcleo Antiguo, Escama de Lágrima, Trompeta Rota, Esencias Ancestrales, Oro Primordial; las grandes, + Corazón de Mármol (guerrero, arquero, pícaro) o Corona Eclipsada (mago, sacerdote) |
  | del Observatorio | 93 · legendario · 75% | 6 armas (copian las del Trono) | Fragmento de Lente, 6 Bronce Celeste, 3 Oro Primordial y el material de la clase |
  | del Cosmos | 97 · épico · 70% | 32 + 5 joyas (copian el set del Centinela) | pergamino; las grandes, Núcleo Cósmico + Polvo de Estrellas + Oro Primordial + el material de la clase |
  | del Primer Vigía | 100 · legendario · 55% | 32 + 5 joyas (copian el set del Lich) | pergamino; Alma del Gran Esqueleto (1 por pieza), Polvo de Estrellas, Fragmento de Eclipse, la llave del tier medio y el material de la clase |

  - **Material de cada clase** en los sets de jefe y las armas del Observatorio: guerrero Núcleo Antiguo,
    arquero Escama de Lágrima, pícaro Iris del Vacío, mago Carne Estelar, sacerdote Trompeta Rota.
  - **Materiales nuevos:** Bronce Celeste y Fragmento de Lente. Ya existen, pero nadie los suelta hasta
    la tanda 5 (el Observatorio Roto).
  - **Pergaminos nuevos:** `SCROLL_COSMICO_<clase>` y `SCROLL_VIGIA_PRIMERO_<clase>`.
  - **Botín de los jefes:**
    - el Centinela Cósmico suelta los de su set (17,5%);
    - el Gran Esqueleto suelta los suyos (12,5%), Corazón de Mármol y Corona Eclipsada (60%, hasta 2) y
      Núcleo Cósmico (30%).
  - **Escalera (paso 2):** cada arma pega 7% más que la anterior a su nivel (las comunes) o 9% (las de
    mazmorra y jefe), encadenando con el Centinela y el Lich. El mago pega lo mismo que el guerrero.

    | Guerrero | Arma | Daño |
    |---|---|---|
    | de las Ruinas, nv 86 | ATK 2441 | 5545 (+7% sobre el Lich) |
    | Estelar, nv 91 | ATK 2633 | 5998 |
    | del Observatorio, nv 93 | ATK 2816 | 6564 |
    | del Cosmos, nv 97 | ATK 3162 | 7208 |
    | del Primer Vigía, nv 100 | ATK 3451 | 7897 |

    - Orbe 11 → 12,5% de maná por ronda; Símbolo 11 → 12,5% de curación.
    - Pecho de los sets de jefe:
      - mago, regeneración de vida 6 / 6,5%;
      - arquero y pícaro, evasión 7 / 7,5%;
      - sacerdote, curación 14 / 15%;
      - guerrero, 15% de su defensa pasada a vida.
    - **Arreglo:** el paso 2 de las Catacumbas buscaba el ataque hasta 3000 como mucho; a nivel 97-100 eso
      no alcanza. En el de las Ruinas el techo es 8000.
  - El resto del equipo de nivel 86-100 de clase base o sin clase sigue la misma fórmula: 8 piezas, entre
    ellas el Báculo del Cielo y las únicas `_L100`. Es lo mismo que se hizo con las `_L80` en las
    Catacumbas.
- **Colores de set nuevos** (`crear_equipo.lua`, `gear.js`; las columnas de antes no cambian):
  - `estelar`: oro primordial con el azul de la noche;
  - `observatorio`: bronce viejo con verdín;
  - `cosmico`: negro violeta con estrellas doradas;
  - `vigia_primero`: mármol blanco y oro.
- **Comida** (`_respaldo_claude/ruinas/gen_comidas_ruinas.js`; todas dejan «bien alimentado»). Cocina Madre
  Tilda, en la posada del Santuario:

  | Comida | Nivel | Efecto | Lleva |
  |---|---|---|---|
  | Pan de Peregrino | 86 | 600 de vida, +18% ataque | 2 Harina, 1 Flor Luminosa |
  | Sopa de Flor Luminosa | 87 | 620 de vida, +18% defensa | 3 Flor Luminosa, 1 Agua Purificada |
  | Agua de Lágrimas *(alquimia)* | 88 | 340 de maná, +16% inteligencia | Lágrima de Aethra, Flor Luminosa, Agua Purificada |
  | Pescado del Lago Asado | 89 | 650 de vida, +16% velocidad | 3 Pescado del Lago, 1 Aceite de Cocina |
  | Miel de las Lágrimas | 92 | 690 de vida, +20% ataque | Miel de Abeja Antigua, Lágrima de Aethra, 2 Flor Luminosa |
  | Néctar Estelar *(alquimia)* | 95 | 380 de maná, +18% inteligencia, +16% velocidad | Polvo de Estrellas, Lágrima de Aethra, Flor Luminosa |
  | Guiso de los Vigías | 96 | 760 de vida, +24% defensa | 2 Carne de Grifo, 2 Flor Luminosa, 1 Hierba Curativa |

  - Carne y pescado nuevos: la Carne de Grifo la suelta el Grifo del Templo (25%) y el Pescado del Lago,
    la Serpiente de Lágrimas (20%).
- **Venta a NPCs:** lo de las Ruinas vale ×7: 170 objetos, entre materiales, comidas y el equipo de los
  cinco escalones. Versión de equilibrio `ruinas_v1`.
- **Íconos** (`crear_objetos.lua`, ahora 265; los 229 de antes, idénticos píxel a píxel): 36 nuevos.
  - Los materiales de la zona, incluidos los viejos que no tenían ícono: Núcleo Antiguo, Piedra Rúnica,
    las tres Esencias Ancestrales, Núcleo Primordial, Oro y Hierro Primordial, Flor Luminosa, Polvo de
    Estrellas, Fragmento de Luz y otros.
  - Los recursos, la carne, el pescado, la Miel de Abeja Antigua y las 7 comidas.
  - Registrados en `OBJETOS` y `OBJETO_BY_NAME` de `gear.js`, en el mismo orden que el atlas.
- **Equilibrio otra vez** (`generar.js`): con el equipo nuevo los comunes caían en 2,1-3,3 turnos, así
  que se les subió la vida ×1,15 (Peregrino) → ×1,44 (Ojo Errante). Los raros suben ×1,25 y ×1,4.
  - Ahora caen en ~3,0-4,1 turnos, como las Catacumbas, y un común nunca gana el uno contra uno.
  - `ruinas_monstruos.sql` se regeneró y reemplazó el bloque de la tanda 2 en `schema.sql` y
    `pendiente_supabase.sql`.
  - El bloque de la tanda 3 va después; el orden importa, porque el de monstruos borra el botín de los
    comunes.
  - Los dos bloques se aplicaron dos veces sin errores.
- **Probado por API** (`_respaldo_claude/ruinas/probar_taller.js`, back temporal en 5098 con
  `POSICION_LIBRE=1`):
  - Los pergaminos del Cosmos y del Primer Vigía (mago) enseñan 8 recetas cada uno.
  - Se fabricaron una pieza de cada escalón, el Amuleto del Cosmos, el Guiso de los Vigías y el Néctar
    Estelar.
  - Se recolectó en los 6 tipos de recurso.
  - «¿Dónde?» da los recursos de las Ruinas: el Mármol Sagrado sale del bloque y el Oro Primordial, de la
    veta y del relicario.

  Brisa quedó como estaba.
- **Sin probar en el navegador:**
  - cómo se ven los recursos en el mapa y en el editor;
  - los íconos en la mochila;
  - los colores de los sets en el combate.

**Tanda 4 — NPCs, misiones R1-R12, diálogos, fases y la tienda de Casio: hecha** (sin commit).

- **Misiones** (`_respaldo_claude/ruinas/gen_misiones_ruinas.js` → `ruinas_misiones.sql`): 40 en total.
  - **Historia:** de la R1 a la R12. La R1 pide la A14 de las Catacumbas.
    - Las cuatro viejas conservan su código (por si algún jugador ya las tiene):
      - `RUINAS_Q1_GUARDIANES_TEMPLO` es la R3;
      - `RUINAS_Q4_HERALDOS_OLVIDADOS` es la R4;
      - `RUINAS_Q2_CENTINELA_COSMICO` es la R10;
      - `RUINAS_Q3_GRAN_ESQUELETO_ABISMO` es la R11.
    - Por eso la fase de la escalera de los Heraldos ahora es
      `RUINAS_Q4_HERALDOS_OLVIDADOS@3+|RUINAS_Q4_HERALDOS_OLVIDADOS` (antes decía `RUINAS_HISTORIA_04_HERALDOS`, que
      no existe). Se cambió en los dos generadores y en los mapas (`ruinas/chunk_2_2.json`,
      `trono_huesos/chunk_0_1.json`). El paso 2 de la R4 es tocar la trompeta de la losa, así que la escalera
      se abre justo ahí.
    - Las R13 y R14 (el final en Aurelia) llegan en la tanda 7.

    | # | Misión | Quién | Nivel | Lo que pasa |
    |---|---|---|---|---|
    | R1 | El Velo de Aethra | Elenya → Seraphine | 86 | Elenya en la Catedral, los seis fragmentos en el Pilar (la niebla de la Puerta se abre desde este paso), el paso en las Montañas (64,3), cruzar el Velo, llegar al Santuario y conocer a Seraphine |
    | R2 | La Última Sacerdotisa | Seraphine | 86 | la fuente seca y el altar, 4 Peregrinos de Piedra |
    | R3 | Los Guardianes del Templo | Seraphine | 90 | 3 guardianes de cada elemento, el Guardián Ancestral Primordial; al caer te llama «Vigía» |
    | R4 | Los Heraldos Olvidados | Seraphine | 91 | 5 Heraldos, tocar la trompeta de la losa, bajar al Trono de Huesos |
    | R5 | La Entidad Corrupta del Templo | Seraphine | 93 | 4 Engendros, la Entidad, romper el cristal; vuelven los peregrinos |
    | R6 | La llave del astrolabio | Seraphine → Ptolio | 92 | la Llave del Astrolabio, 4 Estrellas Caídas, la terraza del Observatorio |
    | R7 | El Observatorio Roto | Ptolio | 93 | las notas del Gran Astrónomo y mirar por la lente rota: el ojo del Devorador te mira. Después se entra a la mazmorra a cerrarle el ojo (tanda 5) |
    | R8 | La tumba vacía | Aldren | 88 | escoltar a Aldren al Campo, la lápida de Aedan (vacía, removida desde adentro), 4 Grifos |
    | R9 | Las lágrimas que faltan | Seraphine | 94 | 10 Lágrimas de Aethra, las tres primeras lágrimas (Lago, Jardines y la estatua del Patio), llenar la fuente; se encienden la forja y la fuente |
    | R10 | El Centinela Cósmico | Ptolio | 96 | 4 Ojos Errantes, 4 Engendros, el Centinela Cósmico |
    | R11 | El primer Vigía | Aldren → Seraphine | 98 | escoltar a Aldren al Corazón del Templo, el Gran Esqueleto; Aedan se acuerda de su nombre y se va |
    | R12 | El Séptimo Sello | Seraphine | 99 | 6 Ojos Errantes, sacar el fragmento (el Devorador abre los dos ojos), emboscada (Avatar del Eclipse y dos Engendros); Seraphine guarda el fragmento en la fuente hasta el ritual |

  - **Secundarias (15):**
    - Orin: *Las estatuas que lloran*, *Caras limpias*, *Remendadas con oro* y *Tres forjas, la última
      vez* (una carta para Brokk, que contesta con Ignar).
    - Ptolio: *El aprendiz del astrónomo* (las tres hojas del mapa de estrellas) y *Estrellas que se
      escaparon*.
    - Casio: *La canción de Casio* (era la canción de cuna de Aethra para el Devorador) y *Trueno y el
      Velo* (el caballo de Gaspar, metido en la niebla de las Cumbres).
    - Madre Tilda: *La cocina de Madre Tilda*, *Peregrinos perdidos* y *Los que no despiertan bien* (las
      dos con escolta de un peregrino de piedra).
    - Aldren: *Las tumbas de los Vigías* (flores en tres tumbas) y *Que descansen tranquilos*.
    - Seraphine: *El eco de Hela* y *La primera lágrima*.
  - **Diarias (13):** 3 nuevas (Hijos del eclipse, Estrellas en el camino, Los que esperan en la Puerta) y
    las 10 viejas rehechas, cada una con su NPC. Las que pedían cazar a los jefes de la historia como si
    fueran del pasto ahora piden al raro (el Coloso, el Avatar) o al jefe en su puesto.
  - **Las dos ocultas** (*El Poder Cósmico* y *Ascensión a Dios*) no se tocaron.
  - **Objetos de misión (3):** la Llave del Astrolabio, la Carta de Orin y la Respuesta de Brokk e Ignar.
  - **Recompensas:** las principales siguen a las Catacumbas: 44500 de experiencia la R1, +900 por
    misión.
- **Lo que depende de antes** (en los diálogos, `src/game/dialoguesRuinas.js`, no en misiones distintas):
  - Lo que Seraphine dice de Hela después de *El eco de Hela* cambia con la T14. Con el perdón, Hela va a
    querer pelear a tu lado; con la justicia, va a estar con Elenya.
  - Lo que dicen Seraphine y Aldren de Velkan cambia si vive (el perdón en la T14 y la A11 hecha).
- **NPCs en el mapa** (`generar_ruinas.js`; el generador los pone en la casilla libre más cercana):

  | NPC | Lugar | Casilla | Cuándo aparece |
  |---|---|---|---|
  | Seraphine | junto al altar | (60,69) | siempre |
  | Orin | la forja | (72,70) | siempre |
  | Madre Tilda | la posada | (46,70) | desde la R5 |
  | Casio | la plaza | (56,77) | desde la R5 |
  | Aldren (`aldren_ruinas`) | junto a la fuente | (63,75) | desde la R7 |
  | Ptolio | el telescopio roto | (59,15) | siempre |

  - **Decisión:** Orin está en la forja desde el principio, no en la Cantera. La forja ya se usaba desde el
    principio (tanda 3), y un NPC que se muda de lugar complica dónde se le habla en las misiones. Su
    diálogo cambia cuando la fuente se enciende en la R9.
  - Los recursos ya no pueden caer pegados a un NPC.
- **Arte** (Aseprite):
  - Sprites de caminar y retratos en `crear_npcs_misiones.lua`: Seraphine, Orin, Madre Tilda, Casio,
    Ptolio y el peregrino de piedra (para las escoltas).
  - Raza nueva `aethrino`: piel clara y tibia, una marca de oro en la frente y una lágrima celeste bajo cada
    ojo. Ptolio es un fantasma, con la raza `velado` de las Catacumbas.
  - Puntos de misión nuevos en `crear_puntos_mision.lua`: la estatua que llora, la lágrima en el suelo, el
    mapa de estrellas, la ofrenda en la tumba de un Vigía, el peregrino dormido, la lente rota, la losa de las
    siete trompetas y Trueno en el Velo. Los de antes salen idénticos.
- **Diálogos** (`src/game/dialoguesRuinas.js`, sumado en `dialogues.js`): cada NPC habla según tu historia.
  En `questGivers.js` está dónde vive cada uno. Desde los NPCs se abren estas ventanas:
  - Orin: forja y encantador.
  - Madre Tilda: cocina.
  - Casio: comercio.
- **Tienda de Casio** (`ruinas_mercader.sql`): `MERCADER_SANTUARIO`, solo en la zona 7.
  - Vende lo de la zona a 360: Mármol Sagrado, Lágrima de Aethra, Flor Luminosa, Pescado del Lago y Carne de
    Grifo.
  - También vende Harina (60), frascos, aceite y carbón.
  - En la ventana de comercio sale con su retrato (`MerchantPanel.js`).
  - La base no acepta una especialidad nueva, así que va como `SUPREMO`.
- **Back:**
  - `NPC_HOMES` de los 6 NPCs (`lib/questSteps.js`).
  - `casio` en los artesanos (`lib/cercania.js`).
- **SQL:** el bloque «tanda 4» va al final de `schema.sql` y de `pendiente_supabase.sql`. Se aplicó dos veces
  sin errores.
- **Revisado** (`revisar_misiones.js 7`): 40 misiones, 139 pasos y 36 puntos en el mapa, sin problemas.
- **Probado por API** (`_respaldo_claude/ruinas/probar_misiones.js`, con Brisa):
  - Sin la A14, la R1 no se puede aceptar.
  - La R1, R2, R4, R8, R9 y R12 se completan de punta a punta, incluidas la escolta de Aldren, las lágrimas
    (se gastan al entregar) y la emboscada del Sello, que se gana.
  - *Tres forjas* se completa con las entregas en Aurelia.
  - La tienda de Casio aparece estando en las Ruinas y vende.

  Brisa quedó como estaba.
- **Sin probar en el navegador:**
  - cómo se ven los NPCs, los retratos y los puntos de misión;
  - la niebla de la Puerta que se abre en la R1;
  - la escalera de los Heraldos que se abre en la R4;
  - el Santuario que se restaura en la R5 y la R9.

**Tanda 5 — el Observatorio Roto: hecha** (sin commit).

- **Back:** `lib/observatorio.js` usa el molde de `lib/mazmorra.js` y está registrado en `lib/mazmorras.js` y
  en `server.js` (`/api/player/:id/world/observatorio`). Es de nivel 92-96.
  - **Guardianes:** el servidor los siembra solo la primera vez que alguien entra (código `OBSERV_…`).
    - el Astrónomo Fantasma (el Gran Astrónomo), en la Sala de los Astrolabios, con un Autómata;
    - los Autómatas del Cielo, en la Pasarela Celeste, de a dos;
    - la Constelación Viva, en la Cámara de las Estrellas, con el Astrónomo.
  - **Puntos de control:** dos lámparas de cristal («Encender»): la de la Cúpula y la de los Mapas.
  - **Jefe: el Ojo del Devorador.** Su escudo cambia de Luz a Rayo. Cada 3 turnos lanza la **Mirada del
    Vacío** sobre un héroe: si ese héroe no se defiende, pierde la mitad de la vida.
  - **Botín:**
    - Bronce Celeste en todos.
    - Del Ojo: Fragmento de Lente (50%).
    - Cofre cada 3 h: pociones, una pieza Estelar de tu clase o Fragmentos de Lente.

    Con el Bronce Celeste y el Fragmento de Lente se fabrican las armas del Observatorio (tanda 3).
  - **Entrada:** con la R6 entregada (la Llave del Astrolabio) o la R7 completa.
  - La vida de los guardianes y del Ojo sigue la proporción del Trono de Huesos.
  - La mazmorra no necesita SQL propio: crea sus tablas y sus monstruos al usarse.
- **R7:** ahora baja de verdad, en 6 pasos:
  1. escuchar a Ptolio;
  2. las notas del Gran Astrónomo;
  3. mirar por la lente rota;
  4. cerrarle el ojo al Devorador (el jefe);
  5. escuchar al Gran Astrónomo, ya libre, junto a la Gran Lente (dentro del Observatorio);
  6. volver con Ptolio.

  Se reemplazó el bloque de la tanda 4 en `schema.sql` y `pendiente_supabase.sql`.
- **Arte** (Aseprite):
  - `crear_observatorio.lua`:
    - tileset con baldosas de mármol y estrellas de oro, y paredes de piedra azul con mapas del cielo;
    - el vacío estrellado de la cúpula rota, con la pasarela de bronce;
    - columnas de mármol, mesas de astrónomo, astrolabios, pilas de libros y vidrios de la lente;
    - estatuas de astrónomos con catalejo y el ocular del gran telescopio con el ojo detrás;
    - la lámpara de cristal y la Puerta de Bronce.
  - `crear_fondo_observatorio.lua` (fondo de combate): la cúpula partida con el ojo en el cielo, el gran
    telescopio, las estanterías y el astrolabio de oro en el piso.
  - Los 4 monstruos están en `crear_enemigos_ruinas.lua` (`enemigos.json` ahora tiene 156).
  - Mapa: `art/mapas/generar_observatorio.js`, con el mismo plano que el Trono de Huesos.
  - Música `observatorio` en `game/audio.js`: una caja de música en mi menor, cuerdas lentas y una nota
    que tiembla arriba, sin tambores.
- **Ruinas:** la entrada es la casilla de abajo del telescopio roto, (59,13). Al salir vuelves a (59,15),
  junto a Ptolio.
- **Front:** `DUNGEONS.observatorio` (`world/shared.js`), el fondo en `Battle.js` y `BattleScene.js`, y el
  cartel «Mazmorra · El Observatorio Roto» (`World.js`).
- **Probado por API** (`_respaldo_claude/ruinas/probar_observatorio.js`, con Brisa):
  - Sin nivel no se entra. Con la R6 entregada y nivel 94, sí.
  - El paso de jefe de la R7 queda enlazado con el Ojo.
  - Se encendió una lámpara. La puerta sigue cerrada hasta vencer a los tres guardianes.
  - Se ganó contra el Astrónomo, que soltó Bronce Celeste.
  - El Ojo arrancó con su escudo de Luz y soltó Bronce Celeste y una Piedra de Encantamiento Mayor. El
    cofre dio 2 Fragmentos de Lente.
  - El paso de la R7 contó al derribarlo.

  Brisa quedó como estaba. `revisar_misiones.js 7` no da problemas (141 pasos, 37 puntos).
- **Sin probar en el navegador:**
  - cómo se ve el Observatorio y su fondo de combate;
  - la puerta de bronce bajo el telescopio;
  - la música.

**Tanda 6 — los eclipses, las Escalinatas de Luz, Astrea, la música y los secretos: hecha** (sin commit).

- **Los eclipses** (la mirada del Devorador). Cada 9 minutos el cielo de las Ruinas se oscurece durante un
  minuto, con el reloj del servidor: todos lo ven al mismo tiempo.
  - **Back** (`lib/eclipse.js`):
    - Durante el eclipse, un combate que se arma en las Ruinas contra monstruos de la zona 7 los corrompe:
      +20% de ataque y magia, +25% de experiencia y oro, y «· del Eclipse» en el nombre.
    - Esos combates dan +25 puntos de probabilidad de botín (como la suerte). Se suma en `routes/combat.js`.
    - No se corrompen los de otras zonas, los de la mazmorra ni los míticos, y tampoco si peleas fuera de
      las Ruinas.
    - Hay 15 segundos de gracia por si el reloj del jugador va corrido.
    - `GET /world/marea` ahora trae también `eclipse` (el mismo reloj).
    - `ECLIPSE=siempre` lo deja puesto todo el tiempo, solo para probar el servidor.
  - **Front** (`game/world/eclipse.js`, mezclado en `WorldScene`):
    - Medio minuto antes sale el aviso «El sol tiembla…» con la campana.
    - Al empezar, un trueno lejano y el cartel. El cielo se pone morado oscuro con un fundido de 6 segundos
      (`eclipseTint` en `updateSky`), y los faroles se encienden solos porque se hace de noche.
    - Al terminar, otro cartel.
    - En el HUD, el bufo «Eclipse» con los segundos que faltan. Si estás junto a una fuente, dice que
      ahí no te alcanza.
    - **A 6 casillas de una fuente de lágrimas** (los refugios), durante el eclipse no hay combates en la
      hierba.
    - `World.js` le pasa la diferencia de reloj (`setEclipseOffset`, la misma de la marea).
- **Las Escalinatas de Luz** (`lib/escalinatas.js`, `POST /world/escalinata`): viaje rápido gratis entre el
  Santuario (66,84), el Patio de las Estatuas (60,48) y las Torres del Velo (22,18).
  - Solo te lleva a una subzona que ya pisaste (el Santuario siempre).
  - Hay que estar parado en otra escalinata (`lib/cercania.js`).
  - En el mapa son el círculo de luz (`escalinata_luz`) con un punto `poi` que abre su diálogo
    (`escalinata_santuario`, `escalinata_patio`, `escalinata_torres` en `dialoguesRuinas.js`). Te dejan al
    pie del círculo.
  - Su retrato es nuevo: `art/sprites/mundo/crear_retrato_escalinata.lua` → `retratos/escalinata_luz.png`.
- **Mítico:** Astrea, la Ballena de las Estrellas (`MITICOS[7]` en `lib/mythic.js`).
  - 60000 de vida, nivel 86-100, de tipo cósmico y de luz.
  - Hay 7 lugares donde puede aparecer: el Lago, los Jardines, el Patio, las Torres, el Campo, la Cantera y
    la Grieta. Nunca en el Santuario: las fuentes la espantan.
  - Sus esbirros son los peces estelares.
  - Su golpe anunciado es el canto que se vuelve una ola de luz.
  - Los sprites están en `crear_miticos.lua` (los míticos de antes salen idénticos); `enemigos.json` ahora
    tiene 158.
  - En el mapa, su rastro es de polvo de estrellas (`game/world/mythic.js`). En `MythicHunt.js` sus fases se
    llaman «El canto», «Huida» y «Ojo de sol».
- **Música** `ruinas` (`game/audio.js`): re mayor, un arpa en arpegios, un coro lejano de notas largas y una
  campanita arriba, sin tambores. El mapa ya no usa la de la Pradera.
- **Secretos** (`lib/exploracion.js` SECRETS; los pone `generar_ruinas.js`, al lado de una casilla a la que
  se llega caminando):
  - lo que dejó el primer Vigía detrás de su tumba vacía (23,93), con carta;
  - el catalejo que Ptolio escondió en lo alto de las Torres (33,5);
  - la primera lágrima de Aethra, en el rincón más escondido de los Jardines (154,56), con carta.
- **Probado por API** (`_respaldo_claude/ruinas/probar_tanda6.js`, back temporal con `POSICION_LIBRE=1` y
  `ECLIPSE=siempre`):
  - **El eclipse:**
    - un Peregrino en las Ruinas sale «del Eclipse», con ataque 362 → 434 y experiencia 3375 → 4219;
    - el mismo monstruo peleado fuera de las Ruinas no;
    - un monstruo de otra zona peleado en las Ruinas tampoco.
  - **Las escalinatas** llevan al Patio y a las Torres sin cobrar; una que no existe da error.
  - **Los tres secretos** dan su premio (dos con carta) y no se abren dos veces.
  - **Astrea:** una cacería forzada aparece en el Patio con 60000 de vida. Los combates contra el Pez
    Estelar y contra Astrea arrancan. La cacería se borró al terminar.

  Brisa quedó como estaba. `revisar_misiones.js 7` sigue sin problemas.
- **Sin probar en el navegador:**
  - cómo se ve el cielo durante el eclipse, los avisos y el bufo;
  - que junto a las fuentes no salgan combates;
  - las escalinatas en el mapa;
  - Astrea y su rastro;
  - la música.

**Tanda 7 — el final: la R13, la R14, la Lágrima de Aethra, el título, el epílogo y el Jefe Mundial a nivel 100: hecha** (sin commit). Con esto
las Ruinas Ancestrales, y la historia del juego, quedan completas.

- **La R13 «Las lágrimas de Aethra»** (Seraphine → Elenya, nivel 100), en 9 pasos:
  1. Seraphine te da el Séptimo Fragmento;
  2. Brokk e Ignar preparan la forja de Aurelia;
  3. le llevas el fragmento a Elenya;
  4. pones los siete en el Pilar y empieza el ritual;
  5. a 7. tres emboscadas en la Plaza del Pilar (abajo);
  8. recoges la última lágrima, que se vuelve la **Lágrima Cristalizada**;
  9. vuelves con Elenya.
- **Las tres emboscadas, con dos aliados cada una** (`lib/aliados.js`):

  | Combate | Enemigos (nv 100) | A tu lado |
  |---|---|---|
  | La primera grieta | 2 Engendros del Devorador y un Ojo Errante | Ren y Tilo |
  | La segunda grieta | Avatar del Eclipse, un Engendro y un Ojo | Rhaegar y Eirik |
  | La Sombra del Devorador | La Sombra del Devorador (jefe nuevo) | con el perdón en la T14: Hela y, si vive, Velkan; si no, Liora (que subió a ver el sol) y Aldren |

  - La emboscada trae `aliados: [{ nombre, clase, fase }]` en sus params. Al armar el combate (`POST /combat/sessions`),
    el servidor busca la emboscada pendiente con esos monstruos y suma los dos primeros que cumplen su fase.
  - Los aliados tienen el 70% de tu vida y el 60% de tu fuerza (la mayor entre ataque y magia), y no traen tu
    equipo.
  - Los maneja el servidor: atacan solos al enemigo más herido, con la línea «… pelea a tu lado», y salen
    marcados `is_ai_controlled`.
  - No ganan experiencia ni guardan vida. La formación tiene 4 lugares: con aliados, de tus compañeros viene
    solo el primero.
  - **La Sombra del Devorador** (`SOMBRA_DEVORADOR`, legendaria, nv 100, cósmica de oscuridad) está en
    `gen_ruinas.js` (sin zona: solo sale aquí) y en `generar.js`. Su sprite está en `crear_enemigos_ruinas.lua`
    (`enemigos.json` ahora tiene 159).
  - Fondo y música propios para estos tres combates (`isFinalFight` en `world/shared.js`: emboscada en Aurelia
    contra el Devorador o sus hijos):
    - fondo `final` (`crear_fondo_final.lua`): la Plaza del Pilar de noche, con siete estrellas, la Catedral,
      el Pilar encendido con los siete fragmentos, las dos sacerdotisas cantando y el empedrado partido por
      grietas moradas;
    - música `final` (`game/audio.js`): re menor que sube a re mayor, órgano, tambor de corazón y las dos voces
      del canto.
- **La Lágrima de Aethra** (`_respaldo_claude/ruinas/gen_final_ruinas.js` → `ruinas_final.sql`): un arma por clase,
  rareza única, nivel 100.
  - Espada, Báculo, Arco, Daga y Cetro Lágrima de Aethra.
  - Pega 9% más que la del Primer Vigía y tiene +4% de daño crítico.
  - **Se forja con Brokk e Ignar** (en el taller de la forja de Aurelia), con la receta `RECETA_LAGRIMA_<clase>`.
    Solo pide la Lágrima Cristalizada, es solo para tu clase y no falla. Como hay una sola lágrima, sale una
    sola arma.
  - Color de set nuevo `lagrima` (`crear_equipo.lua`, `gear.js`) e íconos de la Lágrima Cristalizada y del
    Séptimo Fragmento (`crear_objetos.lua`, ahora 267; los de antes, idénticos).
  - (La base no acepta rareza «única» en las recetas: la receta va como legendaria; el arma sí es única.)
- **La R14 «El Vigía de Etheria»** (Elenya → Aldren):
  1. Elenya te nombra en la Catedral;
  2. vuelves al Santuario;
  3. Seraphine;
  4. Aldren te da la última página del libro de los Vigías, con tu nombre.

  Da un huevo épico y 3 Piedras de Encantamiento Mayores.
- **El título:** el logro `ACH_VIGIA_ETHERIA` «Vigía de Etheria» se gana al entregar la R14, con +10% de daño
  contra lo cósmico. El juego no tiene un sistema de títulos aparte: es el logro, y los NPCs te llaman así.
- **El epílogo** (diálogos): después de la R13 y de la R14 cambian Elenya y Brokk (`dialoguesCiudad.js`; Brokk
  explica cómo se forja la Lágrima), Liora (`dialoguesCatacumbas.js`: vio el sol) y los del Santuario y Ptolio
  (`dialoguesRuinas.js`). Lo que dice Aldren depende de si Velkan vive.
- **El Jefe Mundial** (`routes/worldboss.js`): el Devorador de Estrellas ahora **solo lo enfrenta quien entregó la
  R14**, y su clon sale **siempre a nivel 100**.
  - La fila de nivel 100 de su escala sale de la fórmula de un jefe legendario de magia: ataque 289, magia 758,
    defensa 822, defensa mágica 772. Su vida sigue siendo la del evento (500000).
  - **Ojo:** antes lo enfrentaba cualquiera desde el nivel 10. Ahora los que todavía no terminaron la historia ven
    «Solo el Vigía de Etheria puede enfrentar al Devorador…». Es lo que se decidió en la sección 12. La página
    del Jefe Mundial (`WorldBoss.js`) todavía dice «Necesitas nivel 10», pero el error del servidor se muestra
    al intentar entrar.
- **SQL:**
  - El bloque de la tanda 2 se regeneró (trae a la Sombra del Devorador) y el de la tanda 4 también (trae la
    R13 y la R14).
  - El bloque «tanda 7» va al final de `schema.sql` y de `pendiente_supabase.sql`.
  - Todo el bloque de la zona 7 se aplicó dos veces seguidas sin errores.
  - `revisar_misiones.js 7`: 42 misiones, 154 pasos y 43 puntos, sin problemas.
- **Probado por API:**
  - `_respaldo_claude/ruinas/probar_final.js`, con Brisa, con el perdón y Velkan vivo:
    - antes de la R14, el Jefe Mundial da 403;
    - la R13 completa: las tres emboscadas se ganan, con Ren y Tilo, Rhaegar y Eirik, y Hela y Velkan al lado;
    - la Lágrima Cristalizada queda en la mochila y el Séptimo Fragmento se entrega;
    - Brokk e Ignar forjan el Báculo Lágrima de Aethra (Brisa es maga);
    - sin la lágrima, otra receta no se puede;
    - la R14 completa da el logro «Vigía de Etheria».
  - `_respaldo_claude/ruinas/probar_jefe_mundial.js`, con un evento forzado que se borra al terminar: con la R14,
    el Devorador sale a nivel 100.
  - Brisa quedó como estaba.
  - Una corrida falló a la mitad (a los aliados les faltaba el premio en 0) y dejó un combate abierto de Brisa;
    se borró a mano.
- **No probado:**
  - el camino de la justicia en el tercer combate (Liora y Aldren), aunque usa la misma regla de las fases;
  - que la receta de otra clase no aparezca;
  - en el navegador: cómo se ven los aliados en el combate, el fondo y la música del final, la Lágrima en la
    mochila y el epílogo.
- **Queda para después** (de la sección 12): los maestros de evolución aethrinos, y los huevos con tema y los
  sobres de cartas por zona.

**Tanda 8 — después del final: cabos sueltos, huevos y sobres por zona, la cerca de la Pradera y el Paso de las
Cumbres: hecha** (sin commit).

- **Cabos sueltos del final:**
  - **Los aliados en combate** (`battleGear.js` `ALLY_SETS`, `BattleScene.spawnHero`): cada uno va con la ropa del
    color de su gente, como el equipo pinta a tu héroe. Ren: pradera; Tilo: acero; Rhaegar: costas; Eirik: escarcha;
    Hela: reina; Velkan: lich; Liora: catacumbas; Aldren: sagrado.
  - **Epílogo:** líneas nuevas después de la R13 para Ren, Tilo (Pradera, Puerto y Tundra), Rhaegar (Puerto y
    Fiordo), Eirik, Hela (con el perdón peleó; con la justicia lo vio desde la enfermería), Velkan y Gaspar
    (Volcán y Costas). Seraphine, después de la R14, cuenta que el Velo se abrió al este.
  - **La página del Jefe Mundial** ya no dice «nivel 10»: `GET /worldboss/status` trae `vigia` y, sin la R14, la
    página explica que hay que terminar la historia de las Ruinas.
  - **La justicia, probada:** en el tercer combate pelean Liora y Aldren (`_respaldo_claude/ruinas/probar_justicia.js`).
  - **Arreglado:** el Taller mostraba las cinco recetas de la Lágrima (al conseguir la Lágrima Cristalizada se
    descubrían todas). Ahora las de un arma única de clase solo se descubren y se muestran para tu clase
    (`lib/recetas.js` y `GET /craft/available`).
- **Huevos por zona** (`lib/huevos.js`):
  - 35 huevos: siete zonas por cinco rarezas (`HUEVO_TUNDRA_RARO`, «Huevo Raro de la Tundra»…).
  - Cada una de las 55 mascotas tiene su zona (`pets.zone_id`). Del huevo de una zona nace una mascota de esa
    zona y esa rareza; si la zona no tiene ninguna de esa rareza, una cualquiera. Los huevos de siempre siguen
    igual.
  - Los monstruos de cada zona sueltan el huevo de su zona en vez del de siempre (misma rareza y chance). Las
    rarezas que nadie soltaba en una zona las sueltan sus comunes (el común, 2%), sus minijefes (el épico, 3%) y
    su jefe legendario (el legendario, 2%): las 35 se pueden conseguir. Los recursos del mapa siguen dando los
    de siempre.
  - Íconos en `crear_objetos.lua`: un huevo con dibujo por zona y la gema de su rareza, más los cinco de
    siempre (ahora con pixel art propio).
- **Sobres de cartas por zona:** `SOBRE_<ZONA>`.
  - Clic derecho en la mochila (o «Abrir sobre» en el inventario): da 3 cartas de monstruos de la zona.
    Probabilidad por rareza: comunes 70, raros 22, minijefes 6, legendarios 2. Ruta `POST /coleccion/cartas/sobre`.
  - Precios: Pradera 1.500 y Montañas 2.500 (los vende Cedric el Joyero: esas zonas no tienen mercader propio),
    Volcán 4.000 (Marga), Costas 6.000 (Salitre), Tundra 8.000 (Bjorn), Catacumbas 10.000 (Hollin) y Ruinas
    12.000 (Casio).
  - El cofre de cada mazmorra trae, además, el sobre de su zona una de cada cinco veces (`lib/mazmorra.js`).
  - Los sobres no se dan de comer a las mascotas.
- **La cerca de la Pradera:** en la parte 3 eliges (`lib/eleccion.js`, como el perdón y la justicia).
  - **«Un regalo envenenado»** (`PRADERA_SEC_CERCA_3`): le llevas las glándulas a Goreth. Te da la
    **Herradura de Goreth**, un accesorio raro para cualquier clase (nivel 8: +12 vida, +5 defensa, +4 defensa
    mágica, +2% crítico), con ícono propio.
  - **«La broma de Bruno»** (`PRADERA_SEC_CERCA_3_BRUNO`, nueva): le llevas las glándulas a Bruno y las echas en
    el guiso de Goreth, junto a la fragua. Te da 6 Panes de Campo, 4 Asados de Jabalí y 3 Tónicos de Miel.
  - El elegido te habla como amigo; el otro, ofendido (`dialogues.js`). La parte 4, la vaca de Mirna, sale con
    cualquiera de las dos, y al final se reconcilian igual.
  - Quien ya había hecho la parte 3 queda del lado de Goreth: esa parte siempre terminaba avisándole.
- **El Paso de las Cumbres:** después de la R14 se cruza a pie de las Ruinas a la Tundra.
  - Del lado de las Ruinas, tres filas de calzada (y 88-90) hasta el borde este. Las tapan tres nieblas del Velo
    con fase `!RUINAS_HISTORIA_14_VIGIA`.
  - Del lado de la Tundra, un puente de hielo sobre el mar helado del borde oeste, en las mismas filas.
  - Los dos generadores abren el paso **al final**, después de todo lo que usa el azar. Así el resto de los
    mapas salió idéntico: solo cambian 37 casillas en las Ruinas y 13 en la Tundra. En la Tundra, además, se
    actualizó la referencia al tileset, que creció con las zonas nuevas.
  - `etheria.json` cuenta el paso nuevo.
- **SQL:** dos bloques nuevos al final de `schema.sql` y de `pendiente_supabase.sql`, los dos repetibles:
  «huevos y sobres de cartas por zona» y «la elección de la cerca (Pradera)». Se aplicaron dos veces seguidas
  sin errores. Generadores: `_respaldo_claude/huevos/gen_huevos_sobres.js` y `_respaldo_claude/cerca/gen_cerca.js`.
- **Probado por API**, con Brisa, que quedó como estaba:
  - `probar_justicia.js`: con la justicia, Liora y Aldren en el tercer combate; en el Taller, solo la receta de
    su clase.
  - `probar_huevos.js`:
    - tres Huevos Raros de la Tundra dan la Serpiente de Hielo, la única rara de la Tundra;
    - el huevo común de siempre sigue andando;
    - dos sobres de las Ruinas dan 3 cartas cada uno, todas de las Ruinas;
    - sin sobre, da error;
    - el joyero vende los de la Pradera y las Montañas.
  - `probar_cerca.js`: los dos caminos. Al aceptar uno, el otro desaparece; cada uno da su regalo; después
    aparece la parte 4.
  - `/worldboss/status` trae `vigia: false` para Brisa.
  - `revisar_misiones.js` de las zonas 1, 5 y 7: sin problemas.
- **No probado:**
  - el sobre en el cofre de una mazmorra (no se jugó un jefe de mazmorra entero);
  - en el navegador: el color de los aliados, los íconos nuevos en la mochila, abrir un sobre con clic derecho,
    la niebla del Paso de las Cumbres y el cruce a pie a la Tundra.
