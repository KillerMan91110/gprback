# Habilidades firma y mecánicas nuevas del combate

Las clases evolucionadas tenían casi todas la misma plantilla (un ataque, una mejora y un ataque en área). Cada rama
tiene ahora una **habilidad firma** con una mecánica propia, que se aprende sola al evolucionar: las 24 ramas del
escalón 1 (nivel 20), las 56 del escalón 2 (nivel 50) y una Definitiva para cada una de las 14 del escalón 3 (nivel 90).

## Las mecánicas (`lib/mecanicas.js`)

Cada estado es una fila de `combat_participant_buffs` (como el veneno). `loadParticipants` los lee en `p.mec`; el daño
de `lib/combat.js` pasa por `recibirDanio`, y lo que cambia ahí se guarda en `persistParticipant`.

| Estado | Qué hace |
|---|---|
| Barrera | Absorbe daño antes de tocar la vida |
| Clon (señuelo) | Se lleva el próximo golpe entero |
| Contragolpe | El próximo golpe físico se desvía y se devuelve |
| Juramento (vínculo) | La mitad del daño lo paga quien protege |
| Semilla | Cura un poco cada vez que te pegan |
| Mojado | Para las reacciones elementales |
| Congelado / Enraizado | Pierde el próximo turno |
| Silencio | No puede usar habilidades (los monstruos solo pegan básico) |
| Chi (cargas) | Cada golpe del monje suma una carga, hasta 5 |
| Runa | El próximo golpe con elemento la hace estallar |
| Sentencia | Cada vez que actúa, la luz lo quema |
| Presa | Si muere marcado, el cazador recupera maná |
| Plaga | Veneno que se acumula (5 capas) y salta a otro al morir |

**Reacciones elementales**, con cualquier habilidad con elemento de un héroe, no solo las firma:

| Elemento | Sobre un enemigo… | Reacción |
|---|---|---|
| Agua | cualquiera | Lo deja mojado |
| Agua | quemado | **Vapor**: +50% de daño y apaga la quemadura |
| Rayo | mojado | **Electrocutado**: +50% de daño y parálisis |
| Hielo | mojado | **Congelado**: pierde el turno |
| Tierra | mojado | **Barro**: −30% de velocidad |
| Hielo | quemado | **Derretir**: daño doble |

## Las 24 habilidades (`_respaldo_claude/evoluciones/gen_firma.js`)

| Rama | Habilidad | Mecánica |
|---|---|---|
| Monje | Palma Liberada | Gasta el chi: +40% de daño por carga, ignora la mitad de la defensa |
| Espadachín | Contragolpe | Devuelve el próximo golpe físico al 120% |
| Caballero | Juramento | Recibe la mitad del daño de un aliado 3 rondas |
| Berserker | Sed de Sangre | Paga 15% de vida; +daño según la vida que falta; se cura el 30% |
| Guerrero Magus | Runa Grabada | Deja una runa: +60% al próximo golpe con elemento |
| Nigromante | Alzar Caído | El último enemigo caído pelea para ti 3 rondas |
| Invocador | Sacrificio | La invocación estalla: 80% de su vida a cada enemigo |
| Elemental | Catalizador | Ola de agua que moja a todos |
| Mago Divino | Sentencia | Cada vez que el enemigo actúa, 150% de tu magia en daño |
| Cazador | Marca de Presa | +20% de daño recibido; si muere, recuperas 15% de maná |
| Francotirador | Tiro Perforante | Ignora la mitad de la defensa y rompe barreras |
| Ranger | Red | Pierde el turno y −10 de esquiva |
| Arquero Umbrío | Flecha Sifón | Roba 15% de magia 3 rondas |
| Elfo Silvestre | Semilla | Cura 6% de la vida con cada golpe recibido |
| Ninja | Clon de Sombra | Un clon recibe el próximo golpe |
| Asesino | Ejecutar | Triple daño bajo 25% de vida; si mata, no gasta el turno |
| Ladrón Maestro | Hurto de Fuerza | Roba 15% de ataque y de velocidad |
| Envenenador | Plaga | Veneno acumulable que salta al morir |
| Especialista en Trampas | Trampa de Silencio | Silencia 2 rondas |
| Clérigo | Sobrecura | La cura que sobra queda como barrera |
| Druida | Raíces | Pierde el turno y sangra 4% por ronda |
| Templario | Barrera Sagrada | Barrera para todo el grupo |
| Sanador Divino | Vínculo Vital | Reparte la vida del grupo y suma 10% |
| Inquisidor | Anatema | Silencia y le quita una mejora |

## Íconos

Las siluetas de los estados están en `public/Icons/etheria` (`art/sprites/combate/crear_iconos_estados.lua`). Se
registran en `src/game/statuses.js`.

## Pruebas

`_respaldo_claude/evoluciones/probar_firma.js`: las 24 en combate de verdad, más la reacción de congelar.

## Escalón 2: 56 habilidades firma (nivel 50)

Se aprenden solas al llegar a la rama. Usan las mismas mecánicas y estas nuevas:

- **Quemar, cegar, paralizar y congelar** directos (los tres últimos con probabilidad).
- **Subir** una estadística del grupo o la propia, y **provocar** (atraer los golpes).
- **Cadena**: el golpe salta a otros enemigos (el doble sobre los mojados).
- **Último aliento** (Lich): el próximo golpe mortal te deja con 1 de vida.
- **Robar mejora**: le quitas mejoras al enemigo y te las quedas.
- **Revivir**, **curar al grupo** y **limpiar** males.
- **Detonar**: si el enemigo arde o está envenenado, el golpe estalla y se lleva el estado.
- **Ganar chi** de golpe.

| Rama (código) | Habilidad | Qué hace |
|---|---|---|
| MAGO_PIROMANTICO | Fuego Voraz | Fuego que se alimenta de fuego: si el enemigo ya ardía, estalla (+80% de daño). Si no, lo deja ardiendo (6% de su vida por ronda). |
| MAGO_CRIOMANTICO | Cero Absoluto | Una ola de frío sobre todos: 35% de probabilidad de congelar a cada uno (pierde el turno). Contra los mojados, congela seguro. |
| MAGO_ELECTROMANTICO | Rayo Encadenado | Un rayo que salta a dos enemigos más con el 60% del daño. Sobre un enemigo mojado, el salto hace el doble. |
| MAGO_HIDROMANTE | Marea Sanadora | Agua clara que cura a todo el grupo y se lleva un mal de cada uno. |
| MAGO_GEOMANTICO | Muro de Piedra | Un muro de roca delante del grupo: barrera del 15% de la vida de cada uno (más el 60% de tu magia) y +20% de defensa durante 3 rondas. |
| MAGO_AEROMANTE | Ojo del Huracán | Un huracán que golpea dos veces a todos y los ciega con polvo (20%). Tú quedas en el ojo, más rápido (+25% de velocidad). |
| MAGO_LUMINOSO | Prisma | La luz se abre en mil colores: ciega a todos los enemigos (25%) y cura al grupo el 5% de su vida. |
| MAESTRO_ELEMENTAL | Convergencia | Agua y tormenta a la vez: moja a todos y tiene 50% de paralizar a cada uno. Lo que sigue (rayo, hielo, tierra) reacciona. |
| MAESTRO_MONJE | Cien Puños | Cinco golpes tan rápidos que parecen cien. Cada uno junta chi: sumas 2 cargas de una vez. |
| MONJE_OSCURO | Palma del Vacío | Una palma de sombra que le roba el 15% del ataque al enemigo y te devuelve el 25% del daño como vida. |
| MONJE_SISMICO | Pisotón Sísmico | Un pisotón que parte el suelo: 35% de probabilidad de atrapar a cada enemigo (pierde el turno). Lo mojado se vuelve barro. |
| MONJE_DIVINO | Palma Bendita | Un golpe de luz que cura al grupo el 6% de su vida. |
| MAESTRO_ESPADACHIN | Mil Cortes | Cuatro cortes seguidos y terminas en guardia: el próximo golpe físico que recibas lo devuelves entero. |
| CABALLERO_OSCURO | Pacto de Sangre | Pagas el 10% de tu vida y la espada bebe: te curas el 40% del daño. |
| PALADIN | Escudo de la Fe | Juras proteger a un aliado (recibes la mitad de su daño) y lo cubres con una barrera del 10% de su vida. |
| CABALLERO_BLINDADO | Fortaleza | Te plantas delante de todos: atraes los golpes, te cubre una barrera del 20% de tu vida y +30% de defensa durante 3 rondas. |
| TITAN_FURIOSO | Furia del Titán | Pagas el 15% de tu vida y golpeas a todos con lo que te falta (+1% de daño por cada 1% de vida perdida). Te curas el 20%. |
| MAGO_ESPADA | Filo de Runas | Dos cortes que graban una runa grande: el próximo golpe con elemento la hace estallar (+80%). |
| ARQUEOLOGO_MAGICO | Corte del Tiempo | Un corte que atrasa el tiempo del enemigo (−30% de velocidad) y le arranca una mejora para ti. |
| REY_NIGROMANTE | Ejército Caído | El último enemigo caído se levanta con el 90% de lo que tenía y pelea para ti durante 4 rondas. |
| LICH | Filacteria | Guardas tu alma en una filacteria durante 5 rondas: el próximo golpe mortal te deja con 1 de vida. Y +20% de magia. |
| INVOCADOR_DEMONIACO | Pacto Infernal | Tu invocación se rompe en fuego del abismo: cada enemigo recibe el 100% de la vida que le quedaba y arde (5% por ronda). |
| INVOCADOR_CELESTIAL | Coro Celestial | Un coro que cura al grupo el 12% de su vida y lo cubre con una barrera del 8%. |
| INVOCADOR_SALVAJE | Llamado de la Manada | La manada huele sangre: el enemigo es la presa (+25% de daño recibido) y pierde el 20% de su defensa. |
| MAGO_ESTELAR | Lluvia de Estrellas | Tres oleadas de estrellas sobre todos, que dejan ciegos a los que miran (20%). |
| FRANCOTIRADOR_FANTASMAL | Disparo Fantasma | Una bala que no toca nada hasta llegar: ignora toda la defensa y rompe las barreras. |
| TIRADOR_EXPLOSIVO | Barril de Pólvora | Una flecha a un barril: estalla sobre todos (+60% contra los que ya ardían) y deja el fuego (5% por ronda). |
| TIRADOR_VENENO | Flecha de la Plaga | Una flecha que suma una capa de plaga (3% por capa, hasta 5). Cuando el enemigo muere, salta a otro. |
| ARQUERO_CELESTIAL | Flecha del Alba | Una flecha de luz que ciega al enemigo (20%) y cura al grupo el 5% de su vida. |
| BALLESTERO | Virote Perforante | Un virote pesado que atraviesa la fila: ignora el 40% de la defensa y la rompe (−15% durante 3 rondas). |
| ARQUERO_DEL_RAYO | Flecha Tormenta | Una flecha que se parte en rayos: salta a dos enemigos más con el 50% (el doble sobre los mojados). |
| MAESTRO_CAZADOR | Golpe de Gracia | Contra una presa con menos del 30% de vida, hace dos veces y media el daño. Si la mata, no gastas el turno. |
| ELFO_ANTIGUO | Canción del Bosque | Una canción antigua: una semilla en cada aliado (cura el 6% con cada golpe recibido) y +15% de velocidad. |
| RANGER_PRIMORDIAL | Enredaderas | Enredaderas con espinas en todo el campo: 40% de atrapar a cada enemigo y todos sangran savia (3% por ronda). |
| GUARDIAN_SILVESTRE | Guardia del Bosque | Juras proteger a un aliado (recibes la mitad de su daño) y le plantas una semilla que lo cura con cada golpe. |
| MAESTRO_ASESINO_OSCURO | Flecha del Vacío | Una flecha que se traga la voz y la magia: silencia 2 rondas y roba el 20% de la magia. |
| MAESTRO_ASESINO | Último Suspiro | Contra un enemigo con menos del 35% de vida, triple daño. Si lo mata, no gastas el turno. |
| MAESTRO_ENVENENADOR | Detonar Toxinas | Haces estallar todos los venenos: +150% de daño contra cada enemigo envenenado o con plaga (y se lleva el veneno). |
| NINJA_MAESTRO | Danza de Clones | Dos clones de sombra te rodean durante 3 rondas: cada uno se lleva un golpe entero. Y +20% de velocidad. |
| NINJA_SOMBRA | Sello de Sombra | Un sello en los ojos y en la boca: silenciado 2 rondas y ciego (30%). |
| LADRON_LEGENDARIO | Gran Golpe | El robo del siglo: le quitas dos mejoras al enemigo y te las quedas, y además el 15% de su velocidad. |
| SAQUEADOR_DE_TESOROS | Saqueo | Le arrancas la armadura a tirones: le robas el 20% de su defensa durante 3 rondas. |
| MERCENARIO | Contrato | Firmas un contrato por su cabeza: es la presa (+30% de daño recibido) y tú cobras por adelantado (+15% de ataque). |
| EXPLORADOR_MAZMORRAS | Ojo Experto | Ves los puntos débiles de todos: −20% de defensa y −10 de esquiva durante 3 rondas. |
| MAESTRO_DEL_SIGILO | Golpe desde la Nada | Apareces, ignoras la mitad de su defensa y desapareces: un clon queda en tu lugar para el próximo golpe. |
| BUSCADOR_DE_TRAMPAS | Campo Minado | Minas por todo el campo: dañan a todos y tienen 35% de paralizar a cada uno. |
| PICARO_ELEMENTAL | Filo Corrosivo | Un filo que se come la armadura: suma una capa de plaga y baja el 15% de la defensa. |
| ACROBATA | Pirueta | Una pirueta imposible: +15 de esquiva durante 3 rondas, y el próximo golpe físico lo esquivas y lo devuelves. |
| OBISPO | Resurrección Divina | Levantas a todos los aliados caídos con la mitad de su vida, y curas al resto el 10%. |
| SANADOR_LEGENDARIO | Milagro | Un milagro: el grupo recupera el 25% de su vida y se le quitan dos males a cada uno. |
| DRUIDA_PRIMORDIAL | Ira de Gaia | La tierra se levanta contra todos: sangran savia (3% por ronda) y 30% de quedar atrapados. |
| PROTECTOR_DEL_BOSQUE | Muralla de Raíces | Raíces que cubren al grupo: barrera del 12% de la vida de cada uno y una semilla que cura con cada golpe. |
| CABALLERO_TEMPLARIO | Juicio del Templario | Un golpe de luz y un desafío: atraes todos los golpes 2 rondas, cubierto por una barrera del 15% de tu vida. |
| GRAN_INQUISIDOR | Hoguera | A la hoguera: arde (8% por ronda), queda silenciado 2 rondas y pierde una mejora. |
| BENDITO | Bendición Mayor | Bendices al grupo: +15% de ataque y de magia durante 3 rondas, y le quitas un mal a cada uno. |
| VIDENTE | Presagio | Ves el golpe antes de que llegue: el próximo daño que iba a recibir cada aliado no llega. |

## Escalón 3: 14 Definitivas (nivel 90)

Un golpe enorme que se carga con el combate: se puede usar **desde la ronda 3 y una sola vez** por combate (mecánica DEFINITIVA, más un tiempo de espera de 99 rondas).

| Rama (código) | Definitiva | Qué hace |
|---|---|---|
| MAESTRO_MONJE_SUPREMO | Puño del Primer Vigía | Todo el chi en un solo golpe: +60% de daño por carga e ignora la mitad de la defensa. |
| CABALLERO_SAGRADO | Égida Celestial | El cielo se abre sobre el grupo: cura el 20% de la vida y una barrera del 30% (más tu magia). |
| PALADIN_OSCURO | Abismo Eterno | Pagas el 10% de tu vida y el abismo se traga a todos: te curas el 40% del daño y les quitas el 25% del ataque. |
| DRAGON_CABALLERO | Aliento del Dragón Antiguo | Fuego de dragón sobre todos (arden el 8% por ronda), y te plantas delante del grupo atrayendo los golpes. |
| BERSERKER_DEL_CAOS | Apocalipsis | Pagas el 30% de tu vida y lo devuelves todo: más daño cuanto menos vida te queda, y te curas el 30%. |
| MAGO_COSMICO | Colapso Estelar | Una estrella cae y se apaga: el tiempo se detiene y todos los enemigos pierden su próximo turno. |
| ELFO_SENOR_BOSQUE | Bosque Eterno | El bosque entero despierta: cura al grupo el 20%, una semilla en cada uno (8% por golpe) y +20% de velocidad. |
| ASESINO_DE_ELITE | Marca de la Muerte | Ignora toda la defensa. Contra un enemigo con menos del 40% de vida, triple daño; si muere, no gastas el turno. |
| PALADIN_DIVINO | Ira del Cielo | La luz juzga a todos: quedan ciegos (30%) y sentenciados (cada vez que actúen, tu magia los quema). |
| ASCETA | Iluminación | Levantas a los caídos con el 60% de su vida y repartes la vida del grupo, sumando un 30% a cada uno. |
| EXORCISTA | Destierro Sagrado | Echas al mal de todos: silenciados 3 rondas y pierden hasta tres mejoras cada uno. |
| HERBOLARIO_SAGRADO | Elixir de la Vida | El elixir perfecto: cura al grupo el 35%, le quita tres males a cada uno y planta una semilla. |
| SACERDOTE_DEL_CAOS | Eclipse | El sol se apaga: todos reciben cinco capas de plaga de golpe y quedan silenciados 2 rondas. |
| APOSTOL | Segunda Venida | Todos los caídos vuelven con la vida entera y el grupo queda cubierto por una barrera del 20%. |

El Último Aliento tiene su propio ícono (un ankh). Pruebas: probar_firma2.js (las 70; además, que la Definitiva no salga antes de la ronda 3).

## Arreglo de paso

La innata del Arquero del Rayo («siempre primero») le suma 0,01 de velocidad y eso rompía el guardado del combatiente en cualquier acción. persistParticipant ahora redondea las estadísticas al guardar.

## Cuándo se aprende cada habilidad (`_respaldo_claude/evoluciones/niveles_habilidades.sql`)

Antes, al evolucionar llegaban todas las habilidades de la clase de golpe, y del nivel 50 al 100 no se aprendía nada.
Ahora:

| Escalón | Al evolucionar | Después, en orden (ataque, apoyo, área, el resto) |
|---|---|---|
| 1 | firma y pasiva, nv 20 | 25, 32, 40, 45, 47, 49 |
| 2 | firma y pasiva, nv 50 | 56, 64, 74, 82, 85, 88 |
| 3 | pasiva y la primera, nv 90 | 93, 96, 97, 99 · la Definitiva en el 98 |

- Al subir de nivel, el cartel dice qué habilidades aprendiste (`World.js` las busca y `LevelUpBanner` las muestra).
- La ventana de Evolución muestra qué aprende cada senda y en qué nivel, y las próximas de tu clase actual
  (`habilidades` y `proximas` en `GET /evolutions`).
- Prueba: `probar_niveles.js`.

## Los jefes también usan las mecánicas (`_respaldo_claude/evoluciones/gen_jefes.js`)

`resolver` de `lib/mecanicas.js` funciona desde cualquier bando (aliados y rivales según quién la usa), y la IA de los
monstruos lo llama cuando elige una habilidad con mecánicas. Cada jefe y minijefe hasta el nivel 100 tiene una (el
Lich Ancestral, dos). Algunos ejemplos:

- **Rey de la Montaña:** Avalancha de Piedra (puede enterrarte: pierdes el turno).
- **Señor de la Caldera:** Lava Viva (si ya ardías, estalla).
- **Lich Ancestral:** Filacteria (sobrevive una vez) y Silencio de la Tumba (nadie usa habilidades).
- **Centinela Cósmico:** barrera y dos reflejos.
- **Gran Esqueleto del Abismo:** Último Juramento (sobrevive una vez y devuelve el próximo golpe).

Un monstruo solo puede salvarse una vez por combate con el Último Aliento. Congelado, enraizado y silencio también
afectan a los héroes: pierden el turno o solo pueden usar el ataque básico.

Prueba: `probar_jefes.js` fuerza cada habilidad. Los 7 jefes de mazmorra no se pueden empezar fuera de su mazmorra,
pero usan el mismo camino.

## Lo que se ve en el combate (`src/game/BattleScene.js`)

- **Definitiva:** la pantalla se oscurece y el nombre aparece en grande, con temblor, antes del golpe.
- **Reacciones:** «¡Electrocutado!», «¡Congelado!», «¡Vapor!», «¡Derretir!» o «¡Barro!» saltan sobre el objetivo.
- **Notas de las mecánicas** (contragolpe, clon, último aliento, barrera rota, juramento, sentencia, atrapado,
  congelado): un texto sobre quien corresponde, en vez de animar una habilidad.
- **Invocaciones:** antes no se dibujaban. Ahora aparecen al lado de quien las llamó, mirando a los enemigos, con la
  hoja de un monstruo parecido (lo alzado por el Nigromante, con la de ese mismo monstruo).

## Simulador de equilibrio

`_respaldo_claude/evoluciones/simulador.js` escribe `docs/equilibrio_simulacion.md`: el daño por turno de cada clase
en su nivel típico contra el monstruo promedio, y marca lo que se sale de su escalón.

## Misiones de práctica de cada clase

Las de Valdemar, Sylvan, Kira y Elrond (NPCs que no existen) las dan ahora Isolde, Sylwen, Nox y el Padre Anselm,
como secundarias (`misiones_clase_maestros.sql`).
