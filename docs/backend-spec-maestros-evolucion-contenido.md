# Spec — Contenido de maestros de clase evolucionados (tienda, skills, quests)

## Estado actual (ya shippeado, para contexto — no repetir)

- `class_masters`: las 94 clases evolucionadas ya tienen `name`, `intro_dialogue`, `guild_dialogue`
  completos (commit `bf9c642`). Nada que hacer acá.
- Fix de clase efectiva (`425b7e2`, `4be9c19`): equipar, quests y skills de gremio ya comparan
  contra `getClassAncestorChain(evolution_class_id || current_class_id)` en vez de
  `current_class_id` exacto. Ya no hace falta tocar código para que una clase evolucionada
  pueda usar su propio equipo/skills.
- Endpoints nuevos (`6edc595`), scopeados por `masterId` y gateados por `guild_class_masters`:
  - `GET /api/guilds/:id/masters/:masterId/skills`
  - `POST /api/guilds/:id/masters/:masterId/learn-skill`
  - `GET /api/guilds/:id/masters/:masterId/quests` (preview; aceptar/completar sigue por los
    endpoints normales de quests)

Todo lo de arriba es código, ya está. De **contenido**, la tienda (sección 1) ya está completa
para los 96 maestros (commit `71a53fb`, aplicado y verificado contra producción). Quedan
pendientes las secciones 2 y 3 (skills y quests), sin regla acordada todavía.

## 1. Tienda — items por maestro evolucionado — ✅ HECHO (commit `71a53fb`)

Los 91 maestros evolucionados que faltaban (94 evoluciones totales − 3 piloto que ya tenían
tienda: Isolde, Aurelio, Seraphine — Kadric y Thelen son clase base, no evolución) ya tienen
1 pieza de equipo (rareza COMÚN) + 1 material, mismo patrón que los 5 piloto (`items` +
`item_stat_bonuses` + `class_master_shop_items`, ver `seed.sql` líneas ~14005-14042 como
referencia de formato, y el bloque nuevo al final del archivo).

Regla aplicada (no había precedente de COMÚN a estos niveles, se calibró como fracción de la
curva RARO real del juego a cada nivel — ver conversación):
- `required_level` del item = **piso** (nivel de evolución a esa clase).
- Stat bonus = piso × 1 (armas/guantes) o piso × 0.6 (armadura/offhand/casco/accesorio).
- Precio equipo = piso × 10 oro. Material = 37.5% del precio del equipo (misma proporción que
  los 5 piloto).
- El "techo" (piso + 20 si es tier final, o el `required_level` más alto entre las ramas
  siguientes si evoluciona más) no se guarda en ningún campo — fue solo referencia para calibrar
  qué tan fuerte debía sentirse cada item.

**Rareza**: COMÚN para las 89. (Los 5 piloto quedan en ÚNICO como están, no se tocan.)

**Rango de nivel** (`required_level` del item):
- **Piso** = el `required_level` de la evolución de ese maestro (el nivel en el que evolucionás
  a esa clase).
- **Techo**:
  - Si la clase tiene evolución(es) siguiente(s): el `required_level` **más alto** entre todas
    las ramas siguientes posibles desde ahí (no el más bajo — así cubre a cualquier jugador sin
    importar qué rama termine eligiendo, incluso si tarda en decidir y sigue en esa clase más
    allá del nivel de la rama más temprana).
  - Si es clase de tier final (sin evolución siguiente): su propio `required_level` + **20**.

  Ejemplo con la cadena real de Guerrero: evolucionás a Caballero (clase 8) a nivel 15 →
  Caballero puede evolucionar a 3 ramas distintas (niveles 25, 30, 35) → el techo de la tienda
  de Caballero es 35 (la más alta), no 25. Si una de esas ramas es tier final a nivel 40, el
  techo de SU tienda es 40 + 20 = 60.

  Ejemplo de cadena más larga (Mago → Elemental → tier final): la cadena de Mago llega hasta
  nivel 70 en su última rama — el margen de +20 se aplica sobre ESE piso (70), no sobre un
  número fijo universal. Cada cadena tiene su propio rango, calculado con esta misma regla.

## 2. Skills — GOLD/QUEST por clase evolucionada

Sin definir todavía cuáles clases evolucionadas tienen skills aprendibles por oro o por misión
(hoy `skills.learn_method IN ('GOLD', 'QUEST')` no tiene ninguna fila con `class_id` de una
clase evolucionada). Queda pendiente decidir esto — no hay regla acordada todavía, a diferencia
de la tienda.

## 3. Quests — exclusivas por clase evolucionada

Mismo caso que las skills: falta cargar `quests` con `required_class_id` apuntando a clases
evolucionadas. El filtro y el flujo de aceptar/completar ya funcionan (reusan el sistema normal
de quests), solo falta la data.

## Front

Ya especificado y confirmado — se implementa del lado del front (`gpr`) una vez que haya
contenido real para probar contra los endpoints de arriba: cambiar el botón "Ver tienda" de
`GuildMy.js` para que abra una vista con 3 pestañas (Skills / Quests / Tienda), mismo diseño que
`GuildMasterDetail.js`, pegándole a los endpoints por `masterId`.
