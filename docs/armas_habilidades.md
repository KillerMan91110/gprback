# Armas y habilidades

Una habilidad cuyo nombre habla de un arma necesita esa arma en la mano. Sin ella, el botón sale apagado en
combate ("Falta arco o ballesta"), el libro de habilidades (H) dice "Requiere: Arco o ballesta (no la llevas)" y el
servidor la rechaza ("Necesitas un arco o una ballesta para usar Flecha Rápida.").

- **Dónde está**: la columna `skills.arma_requerida` (SQL al final de `db/schema.sql`, repetible) y `lib/armas.js`.
  La revisión está en `routes/combat.js` (acción SKILL del héroe, antes del maná) y la info para el front en
  `GET /:playerId/skills` (`armaRequerida`, `armaNombre`, `armaOk`, `armaMotivo`) y `GET /:playerId/class-skills`.
- **Cómo se reconoce el arma**: por la primera palabra del objeto equipado (la tabla `items` no tiene tipo de arma).
  - `ARCO`: arma que empieza con Arco o Ballesta.
  - `DAGA`: Daga o Estilete en la mano, o la Daga Gemela en la mano izquierda.
  - `FILO`: Espada, Gran Espada, Hacha, Gran Hacha, Filo, Excálibur, o una daga.
  - `ESCUDO`: un Escudo en la mano izquierda.
  - `ARMA`: cualquier arma en la mano.
  - Un arma nueva con otro nombre (por ejemplo "Lanza") hay que sumarla en `etiquetasDe`.
- **Quién no pide nada**: magos y sacerdotes pelean con hechizos, y los monjes con los puños. Las habilidades de trampas,
  venenos y explosiones de los pícaros tampoco piden arma.
- **El ataque básico sin arma** pega la mitad (`BASICO_SIN_ARMA_PCT`), salvo los monjes (`CLASES_MONJE`).
- **Arma inicial**: un personaje nuevo empieza con el arma de Pradera de su clase ya equipada (`routes/auth.js`).
- **Aviso**: al equipar o sacar algo, `POST /equip` y `POST /unequip` devuelven `avisoArmas` con las habilidades que
  quedaron sin poder usarse. La mochila, la ventana de Personaje y la página de Inventario lo muestran.
- **En el combate**, un arquero sin arco (o con espada) pelea cuerpo a cuerpo (`BattleScene`, `unit.ranged`).
- **Compañeros**: los compañeros (NPC) no se revisan, porque pelean con lo de su clase.
- **Al agregar una habilidad nueva**: vuelve a correr el bloque de "Habilidades que piden un arma" (clasifica por
  clase y por nombre), o pon `arma_requerida` a mano.

## La lista (cómo quedó la base)

### Arco o ballesta

- **Arquero**: Flecha Rápida, Flecha Perforante, Flecha Explosiva, Lluvia de Flechas, Flecha Sombría, Flecha Ponzoñosa, Flecha de Trueno, Tormenta de Flechas, Disparo Certero, Lluvia Infinita, Trampa de Flechas
- **Arquero Celestial**: Flecha del Alba, Flechazo de Luz, Lluvia de Luz
- **Arquero del Rayo**: Flecha Tormenta, Flecha del Trueno, Lluvia de Rayos
- **Arquero Umbrío**: Flecha Sifón, Flecha de Sombra, Tormenta Oscura de Flechas
- **Ballestero**: Virote Perforante, Perno de Acero, Tiro Pesado, Descarga de Ballesta
- **Cazador**: Flecha Mortifera, Lluvia de Flechas
- **Elfo Antiguo**: Flecha Ancestral, Arco Legendario
- **Elfo Silvestre**: Flecha Elfica, Tempestad de Hojas
- **Francotirador**: Tiro Perforante, Tiro de Elite, Bombardeo
- **Francotirador Fantasmal**: Disparo Fantasma, Tiro Espectral, Lluvia Espectral, Marca de Sombra
- **Maestro Cazador**: Golpe de Gracia, Caza Definitiva, Caza Masiva
- **Ranger**: Flecha Rastreadora, Andanada del Bosque
- **Ranger Primordial**: Tiro Primordial, Tempestad Primordial
- **Tirador de Veneno**: Flecha de la Plaga, Flecha Envenenada, Lluvia Venenosa, Flecha Venenosa
- **Tirador Explosivo**: Flecha Incendiaria, Barrage Explosivo

### Daga

- **Acróbata**: Baile de Cuchillas
- **Envenenador**: Inyeccion Letal
- **Ladrón Legendario**: Tajo Legendario
- **Ladrón Maestro**: Apunalada Traidora
- **Maestro de Venenos**: Filo Corrosivo
- **Pícaro**: Puñalada Rápida, Danza de Cuchillos

### Arma de filo

- **Berserker**: Desgarro Berserker
- **Espadachín**: Vendaval de Acero, Tajo Circular
- **Espadachín Arcano**: Corte del Tiempo, Corte de las Eras
- **Guerrero**: Tajo Sangrante, Filo Rúnico, Corte Divino
- **Guerrero Magus**: Runa Grabada, Filo Arcano
- **Maestro Espadachín**: Mil Cortes, Torbellino Maestro, Danza de Espadas
- **Mago Espada**: Filo de Runas

### Escudo

- **Caballero**: Golpe de Escudo, Escudo Leal, Avance de Escudo
- **Guerrero**: Golpe de Escudo, Escudo Defensivo

### Cualquier arma

- **Acróbata**: Giro Mortal
- **Asesino**: Ejecutar, Ejecucion, Asesinato Múltiple
- **Asesino de Élite**: Aniquilacion Total, Ejecución Masiva, Marca de la Muerte
- **Asesino Umbrío**: Flecha del Vacío, Flechazo Umbrio, Tormenta de Sombras
- **Berserker**: Sed de Sangre, Vendaval de Ira
- **Caballero Abisal**: Golpe del Abismo, Abismo Eterno
- **Caballero Blindado**: Embestida Blindada, Embestida Total
- **Caballero Oscuro**: Pacto de Sangre, Golpe Abisal, Vendaval Oscuro
- **Cazador de Reliquias**: Golpe de Mercenario, Asalto Mercenario
- **Elfo Señor del Bosque**: Flecha del Rey Silvestre, Tempestad Ancestral
- **Explorador de Mazmorras**: Emboscada Certera, Emboscada
- **Guardián Silvestre**: Flecha Guardiana, Tormenta Protectora
- **Guerrero**: Quiebra Armaduras, Golpe Devastador
- **Ladrón Legendario**: Gran Golpe, Gran Asalto
- **Ladrón Maestro**: Hurto de Fuerza, Golpe Bajo Masivo
- **Maestro Asesino**: Último Suspiro, Sentencia de Muerte, Eliminación Múltiple
- **Maestro de Venenos**: Golpe Elemental
- **Maestro del Sigilo**: Golpe desde la Nada, Golpe Invisible, Asalto Invisible
- **Maestro Envenenador**: Dosis Mortal
- **Ninja**: Golpe de Sombra, Torbellino de Sombra
- **Ninja Maestro**: Muerte Silenciosa, Tormenta de Sombra
- **Ninja Sombra**: Abrazo de las Sombras, Oscuridad Total
- **Paladín**: Golpe Purificador
- **Paladín Celestial**: Martillo Divino
- **Pícaro**: Golpe Letal, Asesinato, Ataque Silencioso, Danza Mortal
- **Saqueador de Tesoros**: Saqueo, Saqueo Definitivo, Saqueo Masivo
- **Titán del Caos**: Devastacion del Caos, Apocalipsis Berserker, Apocalipsis
- **Titán Furioso**: Furia del Titán, Golpe del Titan, Temblor del Titán
