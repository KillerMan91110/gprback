# Mapa de Etheria — dónde va cada zona y qué pueblos viven ahí

Complementa a `historia_etheria.md` (la historia) con la **geografía**: dónde se coloca cada zona en
el continente (`gpr/public/assets/mundo/etheria.json`), cómo se pasa de una a otra y qué **pueblo**
vive en cada tierra, con su **mini-ciudad**.

---

## 1. La idea

- **Un camino que se aleja de la capital**, no un anillo alrededor de ella. Cada zona toca a la
  anterior, y las de nivel alto quedan lejos de la Pradera (un jugador de nivel 3 nunca entra sin
  querer a una zona de nivel 60).
- **La geografía cuenta la historia**: la cordillera termina en el volcán, la lava baja al mar, el
  barco del pirata sube por la costa hasta el hielo, la cripta de la reina baja al abismo y el
  templo final siempre estuvo ahí, al lado de la capital, escondido tras un velo.
- **Cada tierra tiene su pueblo y su mini-ciudad**: un lugar seguro donde descansar sin volver a
  Aurelia (pilar, posada, forja, mercader, buzón y transporte), con gente que da misiones y
  maestros de las evoluciones que tienen que ver con ese pueblo.
- Las fronteras se abren con la historia (`requiere` / `oculto_tras` de los mapas, como Brin), no
  solo por nivel.

---

## 2. El continente

Cada zona nueva mide como la Pradera: 4×4 trozos (160×120 casillas). Coordenadas en casillas.

```
              x 0          160          320          480
      y  90  ┌────────────┬────────────┬────────────┐
             │  AURELIA   │  RUINAS    │  TUNDRA    │
             │  (capital) │ ANCESTRALES│  ETERNA    │
             │            │  86-100    │  61-75     │
      y 210  ├──Puerta Sur┼─(el Velo)──┼────────────┤
             │  PRADERA   │  MONTAÑAS  │ ≈ Mar del  │
             │  DORADA    │  GRISES    │   Norte ≈  │
             │  1-15      │  16-30     │            │
      y 330  ├─Senda élf.─┼─Garganta───┼────────────┤
             │  BOSQUE DE │  VOLCÁN    │ ≈ Mar de   │
             │  SYLVAREN  │  ROJO      │  Ceniza ≈  │
             │ (élfico)   │  31-45     │  (barco)   │
      y 450  ├─acantilado─┴─ríos lava──┼────────────┤
             │      COSTAS MUERTAS     │ Puerto     │
             │          46-60          │ Antiguo ⚓ │
      y 570  └─────────────────────────┴────────────┘
      Bajo tierra: CATACUMBAS DEL ABISMO (76-85), con dos entradas:
      la Cripta Congelada (Tundra) y la puerta sellada bajo la Catedral de Aurelia.
```

| Zona | Niveles | En `etheria.json` (x, y) | Tamaño | Estado |
|---|---|---|---|---|
| Aurelia | capital | 20, 120 | 3×3 trozos | hecha |
| Pradera Dorada | 1-15 | 0, 210 | 4×4 | hecha |
| Montañas Grises | 16-30 | 160, 210 | 4×4 | hecha |
| Volcán Rojo | 31-45 | 160, 330 | 4×4 | hecho |
| Bosque de Sylvaren | ciudad élfica (sin nivel) | 0, 330 | 4×4 | por hacer |
| Costas Muertas | 46-60 | 160, 450 | 4×4, debajo del Volcán (el oeste de la costa queda libre) | en construcción (`zona4_costas.md`) |
| Tundra Eterna | 61-75 | 320, 90 | 4×4 | en construcción (`zona5_tundra.md`) |
| Catacumbas del Abismo | 76-85 | bajo tierra (mapa aparte, como las mazmorras) | 4×4 | en construcción (`zona6_catacumbas.md`) |
| Ruinas Ancestrales | 86-100 | 160, 90 | 4×4 | por hacer |

**Coordenadas.** Con la Tundra (zona 5) se corrió **todo el continente 120 casillas hacia abajo** en
`etheria.json`, así que las coordenadas de la tabla ya son las de verdad. Fue seguro: cada zona guarda
sus posiciones en coordenadas propias (`toLocal`/`toGlobal` de `WorldScene.js`), así que no se tocó
ningún mapa ni ninguna partida guardada.

---

## 3. Cómo se pasa de una zona a otra

| De → a | Paso | Se abre con | Por qué tiene sentido |
|---|---|---|---|
| Aurelia → Pradera | Puerta Sur | desde el inicio | (ya existe) |
| Pradera → Montañas | Paso de la Montaña (Praderas del Este) | P14 *Hacia las montañas* | (ya existe) |
| Pradera → Sylvaren | **Senda Élfica** (sur del Bosque de Robleviejo) | desde el inicio (la ciudad se puede visitar) | los elfos dejan pasar a los viajeros, no a los monstruos |
| Montañas → Volcán | **el Paso del Humo**, que baja desde el sur de las Montañas a la Ladera de Ceniza | M14 *El trono de la cumbre* (la V1 «El Paso del Humo» lo abre) | "el Encapuchado escapa por los túneles hacia el calor" |
| Volcán → Costas | **la Bajada de Basalto**, que baja desde la Caldera del Titán (casillas x 102-110 del borde sur del Volcán) a la Playa de Ceniza Negra | V14 (la C1 la usa) | "la lava baja al mar": al lado, el río de lava de la Caldera se apaga en el Delta de Vapor |
| Sylvaren → Costas | escalera élfica en el acantilado | atajo: se abre al terminar C3 | los elfos te muestran el camino corto cuando ya conoces la costa |
| Costas → Tundra | **el barco de Rhaegar** (Puerto Antiguo → Fiordo Blanco) | C6 | igual que las vagonetas: un viaje, no una frontera caminable |
| Tundra → Catacumbas | la **Cripta Congelada** baja al abismo | T5 / T6 | "la tumba de la reina baja al abismo" |
| Aurelia → Catacumbas | **la puerta sellada bajo la Catedral** | A1 (atajo de vuelta) | el Lich fue sumo sacerdote de Aethra: su corte está bajo la Catedral |
| Catacumbas → Ruinas | el Trono de Huesos se abre al templo | A6 | (como en la historia) |
| Aurelia / Montañas → Ruinas | **el Velo de Aethra** | los siete Fragmentos | las torres del templo se ven desde Aurelia desde el primer día, tras una niebla que no deja pasar: el final siempre estuvo al lado de casa |

Fronteras cerradas que separan zonas que se tocan: Montañas ↔ Ruinas (el Velo), Sylvaren ↔
Volcán (un río de lava; los elfos no se acercan al fuego), Ruinas ↔ Tundra (el Velo sigue por las
cumbres).

---

## 4. Los pueblos de Etheria y sus mini-ciudades

| Pueblo | Dónde | Mini-ciudad | Quiénes (los que ya existen) | Qué papel tienen en la historia |
|---|---|---|---|---|
| **Humanos** | Aurelia, Pradera | **Aurelia** (capital) y **Aldea Espiga** | Aldren, Ren, Mirna, Goreth, Gaspar, Tilo, Brokk, Elenya, Marta… | los Vigías eran humanos; hoy casi nadie recuerda los Sellos |
| **Montañeses** (humanos del norte) | Montañas | **Bastión de Hierro** | Sven, Ingrid, Halvar, Ulfa | descienden de los norteños de la Tundra: bajaron a las minas hace generaciones |
| **Enanos** | Montañas, bajo la roca | **Forjahonda**, la ciudad excavada bajo las Minas Abandonadas | Durgan, Brund, Kili, Nori | cuidan con el Rey de Montaña el Segundo Sello; orgullosos, rivales de los elfos |
| **Elfos** | Bosque de Sylvaren | **Sylvaren**, ciudad en los árboles | Aelin, la encantadora (ya está en las Montañas) | nacieron donde cayeron las lágrimas de Aethra; recuerdan los Sellos mejor que nadie y no confían en los humanos que los olvidaron |
| **Dracónidos** (sangre de dragón) | Volcán | **Ascuaria**, en el borde del cráter | Ignar, el Forjador de Fuego | los mejores forjadores de Etheria; Ignar forjó sin saberlo los Cristales de Eclipse |
| **Tritones** | Costas | **Coralia**, aldea de palafitos junto al Puerto Antiguo | (nuevos) | su ciudad es el Arrecife Hundido; los Ocultos los echaron cuando encadenaron a la Bestia |
| **Norteños** | Tundra | **Fiordo Blanco**, donde atraca el barco | el Rey del Hielo, el Príncipe, la Bruja Congelada, la Anciana del Hielo | la familia real congeló la tundra a propósito para proteger el Quinto Sello |
| **Velados** (espíritus) | Catacumbas | **Vela Eterna**, una necrópolis iluminada con velas | (nuevos) | los sacerdotes de Aethra que el Lich traicionó; su luz es lo único seguro bajo tierra |
| **Aethrinos** (casi extintos) | Ruinas | **Santuario de las Lágrimas** | la Última Sacerdotisa | el pueblo que sirvió a Aethra en el templo; el santuario revive a medida que avanzas |

Pueblos hostiles (no tienen ciudad, son enemigos): goblins y bandidos (Pradera), orcos y trolls
(Montañas), demonios de la Caldera (Volcán), piratas (Costas, hasta que Rhaegar se vuelve aliado),
no-muertos (Catacumbas) y, en todas partes, los Ocultos.

### Qué tiene cada mini-ciudad

- **Pilar menor de Aethra**: despiertas ahí al caer (no en Aurelia) y es punto de viaje.
- **Posada**: curarse y comida típica del pueblo.
- **Forja o mesa de trabajo**: para fabricar el equipo de la zona sin volver a Aurelia.
- **Mercader del pueblo**: vende los materiales y recetas de la región.
- **Buzón** y **transporte** (vagoneta, barco o diligencia de Gaspar) a Aurelia.
- **Maestros de evolución** de las clases que tienen que ver con ese pueblo (ver abajo).
- Misiones del pueblo y una rivalidad con su vecino (enanos contra elfos, Brokk contra Ignar…).

### Las evoluciones se aprenden viajando (propuesta)

Las evoluciones básicas siguen en las órdenes de Aurelia. Las de raza se aprenden en su ciudad, así
viajar tiene un premio más:

| Ciudad | Maestros de… |
|---|---|
| Sylvaren (elfos) | Elfo Silvestre, Elfo Antiguo, Señor del Bosque, Guardián Silvestre, Protector del Bosque, Druida, Ranger Primordial |
| Forjahonda (enanos) | Caballero Blindado, Mago Geomántico, Monje Sísmico |
| Ascuaria (dracónidos) | Dragón Caballero, Mago Piromántico |
| Coralia (tritones) | Mago Hidromante |
| Fiordo Blanco (norteños) | Berserker, Titán Furioso, Mago Criomántico |
| Vela Eterna (velados) | Nigromante, Exorcista |
| Santuario de las Lágrimas (aethrinos) | Arquero Celestial, Invocador Celestial, Mago Estelar, Sanador Divino |

---

## 5. Orden para construirlo

1. **Volcán Rojo + Ascuaria**: es la zona 3 y sigue directo a las Montañas.
2. **Sylvaren** (solo la ciudad y el bosque tranquilo): da un lugar nuevo para visitar desde la
   Pradera y le pone cara a los elfos antes de que se necesiten.
3. **Costas + Coralia + Puerto Antiguo**, luego **Tundra + Fiordo Blanco**, **Catacumbas + Vela
   Eterna** y al final **Ruinas + Santuario**.
4. **Forjahonda** se puede agregar cuando se repasen las Montañas (es un mapa interior, como la Mina).
