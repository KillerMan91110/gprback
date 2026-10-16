# Zona 3 · Volcán Rojo (niveles 31-45) — "El fuego que forja cadenas"

Diseño completo de la zona 3, sobre `historia_etheria.md` (la historia) y `mapa_etheria.md` (dónde
va). Es la referencia para el mapa, los monstruos, el equipo, la mazmorra, los NPCs y las misiones.

---

## 1. La zona en una frase

Una cordillera que termina en un volcán vivo. Arriba, los **dracónidos** de **Ascuaria** forjan el
mejor acero de Etheria; abajo, en la **Fisura Infernal**, los Ocultos usan esas mismas forjas para
fabricar los Cristales de Eclipse. **Ignar**, el orgulloso Forjador de Fuego, no sabe que los
moldes que vende terminan ahí. En la Caldera duerme el **Titán de Fuego**, Guardián del Tercer
Sello, cada vez más inquieto.

## 2. El mapa (4×4 trozos, norte arriba)

Se pega al borde sur de las Montañas (`etheria.json`: x 160, y 210 con las coordenadas de hoy). Se
entra por el **Paso del Humo**, que se abre en el sur de las Montañas entre la Garganta del Eco y la
Cumbre del Rey.

| Subzona | Niveles | Dónde | Qué la hace única |
|---|---|---|---|
| **Ladera de Ceniza** | 31-33 | norte (entrada) | ceniza gris que cae siempre, pinos quemados, piedras pómez; se ve el humo del volcán al fondo |
| **Ascuaria** | ciudad | centro-norte, sobre una meseta de basalto | ciudad dracónida: casas de basalto con faroles de lava, la Gran Forja, el estanque de magma enfriado |
| **Campos de Azufre** | 32-35 | noroeste | suelo amarillo, **fumarolas** que escupen vapor, charcos verdes que burbujean, cristales de azufre |
| **Bosque Calcinado** | 33-36 | oeste | árboles negros con brasas en las ramas, troncos que todavía humean, el campamento de los bandidos |
| **Ríos de Lava** | 35-39 | centro | ríos de lava con **puentes de basalto** y las **balsas de piedra pómez** del balsero |
| **Cantera de Obsidiana** | 36-40 | este | agujas de vidrio negro que reflejan la luz, la cantera vieja de los dracónidos y sus grúas |
| **Nido del Dragón** | 38-41 | sureste | huesos enormes, huevos de piedra caliente, el Dragón Menor Corrupto |
| **Grieta Ardiente** | 39-42 | suroeste | la tierra partida con luz roja, el campamento de los Ocultos y la entrada a la **Fisura Infernal** |
| **Caldera del Titán** | 43-45 | sur | el cráter: un lago de lava con una isla de roca donde espera el Titán de Fuego |

**Cosas propias que no tiene ninguna otra zona:**
- **Lluvia de brasas** (como la tormenta de las Montañas): de vez en cuando caen piedras ardientes
  y queman un poco al que esté al descubierto; los **arcos de basalto** y los techos protegen.
- **Fumarolas** en los Campos de Azufre: escupen vapor cada tanto (se ve y suena); al lado se
  recoge **Azufre**.
- **Balsas de piedra pómez** en los Ríos de Lava: el balsero Pumo te cruza a otra orilla que ya
  descubriste por unas monedas (como las vagonetas de las Montañas).
- **Recursos de la zona:** veta de obsidiana, fumarola (azufre), flor de ceniza (una flor que solo
  crece en la ceniza tibia), nido de salamandra (huevos y escamas sueltas) y geoda ardiente (rara:
  Gema de Fuego). Además los cofres de aventurero de siempre.
- Clima: siempre gris de ceniza, sin lluvia; de noche el resplandor rojo de la lava.

## 3. Monstruos

Stats por fórmula (`lib/equilibrio.js`, perfiles en `scripts/equilibrio/generar.js`). Cada uno
suelta su material propio y tiene su habilidad con su estado (quemadura, miedo, ceguera…).

| Monstruo | Nivel | Dónde | Material | Habilidad |
|---|---|---|---|---|
| Salamandra Roja | 31-34 | Ladera, Ríos | Escama de Salamandra | Escupitajo Ígneo (quema) |
| Lobo de Ceniza *(nuevo)* | 31-35 | Ladera, Bosque | Pelaje de Ceniza | Mordida Ardiente (quema) + aullido |
| Escarabajo de Azufre *(nuevo)* | 32-35 | Campos | Caparazón de Azufre | Nube Sulfurosa (veneno a todos) |
| Bandido de Fuego | 32-36 | Bosque, caminos | Brasa de Bandido | Botella Incendiaria |
| Elemental de Fuego | 34-38 | Campos, Ríos | Núcleo Ígneo | Llamarada (quema) |
| Serpiente de Magma *(nueva)* | 35-39 | Ríos | Colmillo de Magma | Ola de Magma (a todos) |
| Gólem de Obsidiana *(nuevo)* | 36-40 | Cantera | Esquirla de Obsidiana | Piel de Vidrio (+defensa) y Astillas |
| Centinela Infernal | 37-41 | Cantera, Grieta | Placa Infernal | Golpe Infernal |
| Draco de Brasa *(nuevo)* | 38-42 | Nido | Ala de Draco | Aliento de Brasa (a todos) |
| Fanático del Eclipse *(nuevo)* | 38-42 | Grieta | Sello de Eclipse | Rezo Oscuro (maldición) |
| Demonio de Lava | 40-44 | Grieta, Caldera | Cuerno de Demonio | Puño de Lava |
| Diablillo de la Caldera *(nuevo)* | 41-45 | Caldera | Cola de Diablillo | Pinchazo (quema) + risa que asusta |
| **Maestro de la Lava** (raro) | 39-42 | Grieta | Molde de los Ocultos | agente de los Ocultos; cadena de fuego |
| **Dragón Menor Corrupto** (raro) | 38-41 | Nido | Escama de Dragón | aliento y zarpazo |
| **Señor de la Caldera** (minijefe) | 42 | puertas de la Caldera | Cetro de la Caldera + pergaminos | comanda a los demonios |
| **Titán de Fuego** (legendario) | 45 | Caldera del Titán | Corazón del Titán de Fuego + pergaminos | Guardián del Tercer Sello |

## 4. Equipo de las clases base (con las reglas del equipo v2/v3)

El arma lleva el daño; guantes, cascos, armaduras y botas dan aguante; la mano izquierda define el
estilo (escudo, Cristal de daño u Orbe de maná, carcaj, daga gemela, símbolo).

| Set | Nivel | Rareza | Cómo se consigue | El arma pega… |
|---|---|---|---|---|
| **del Volcán** | 31 | raro | materiales de la Ladera, Campos y Bosque | +7% sobre la del Acantilado |
| **de Obsidiana** *(nuevo)* | 36 | épico | Ríos y Cantera + un Corazón de Brasa (Dragón o geoda) | +7% sobre la mejor de antes (Rey o Volcán) |
| **armas de Forja Negra** *(nuevas)* | 37 | legendario | la Fisura Infernal (Corazón de la Forja Negra) | +9% sobre la de Obsidiana |
| **de la Caldera** | 40 | épico | pergamino y Cetro del Señor de la Caldera | +9% sobre Forja Negra |
| **del Titán de Fuego** | 45 | legendario | pergamino y Corazón del Titán | +9% sobre la de la Caldera |

Se fabrican en la **Gran Forja de Ascuaria**. Las piezas de jefe traen su extra (daño crítico en el
arma; en el pecho: vida, regeneración, evasión o curación según la clase).

Comidas de Ascuaria (la parrilla de Tuli): Brocheta de Salamandra, Chile de Azufre (picante: +ataque)
y Té de Flor de Ceniza (resistencia al fuego / aguante).

## 5. La mazmorra: la Fisura Infernal (34-42)

La forja secreta de los Ocultos, bajo la Grieta Ardiente. Como la Mina Profunda (`lib/mazmorra.js`):
guardianes que patrullan, monstruos que se ajustan a tu nivel dentro del rango, cofre del jefe cada
20 h y la mitad de XP y oro en las pasadas siguientes.

- **Guardianes:** Fundidor Oculto (forjador encapuchado), Diablillos de Fragua (de a dos) y el
  Gólem de Escoria.
- **Mecánica:** las **cubas de metal fundido**: hay que volcarlas (como los braseros de la Cripta)
  para enfriar el paso a la sala del jefe.
- **Jefe: Morvak, el Forjador de Eclipses**, el que convirtió los moldes de Ignar en Cristales de
  Eclipse. En combate "templa" su armadura: hay que romperle el escudo con agua o hielo.
- **Botín:** Corazón de la Forja Negra (armas de Forja Negra), Moldes de Eclipse para la misión de
  Ignar, oro y pociones.

## 6. Pueblo y NPCs (con su historia)

**Ascuaria (dracónidos).** Gente de escamas rojizas, orgullosa y directa, que trabaja el fuego.

| NPC | Dónde | Quién es | Para qué |
|---|---|---|---|
| **Ignar, el Forjador de Fuego** | Gran Forja | el mejor forjador de Etheria (según él) y rival de Brokk | historia principal, la Gran Forja, *Brokk contra Ignar* |
| **Matriarca Ascalia** | plaza de Ascuaria | líder de Ascuaria, fría con los forasteros | historia principal (te deja quedarte) |
| **Tuli, la parrillera** | parrilla de la plaza | cocina todo lo que tenga escamas | comidas y *¿Picante?* |
| **Chispa** | por la ciudad | niña dracónida obsesionada con los dragones | *El huevo de dragón* |
| **Gaspar** | Ladera (entrada) | el cochero, que llegó persiguiendo a Trueno | *¿Dónde está Trueno?* (otra vez) |
| **Sulfo, el alquimista** | Campos de Azufre | humano que vive entre fumarolas y ya no siente el olor | recolección de azufre, poción de resistencia |
| **Ceniza** | Bosque Calcinado | guardabosque dracónida que replanta el bosque quemado | amistad, semillas, los bandidos |
| **Pumo, el balsero** | Ríos de Lava | pícaro que te cruza la lava en balsas de pómez | balsas, *Pómez de calidad* |
| **Kessa, la talladora** | Cantera de Obsidiana | talla obsidiana y odia que Ignar la llame "artesana" | Obsidiana, rivalidad con Ignar |
| **Viejo Escamas** | Nido del Dragón | anciano que crió al dragón cuando era cría | el Dragón Menor (triste) |
| **Brokk** | viaja a Ascuaria | el herrero de Aurelia | *Brokk contra Ignar* (cadena) |
| **El Encapuchado** | aparece en la historia | el agente de los Ocultos | historia principal |

## 7. Misiones

**Principales (V1-V14),** después de *El trono de la cumbre* (M14):
1. **V1 El Paso del Humo** (Durgan → Gaspar): baja por el paso nuevo al sur de las Montañas.
2. **V2 Ceniza que quema** (Gaspar): limpia la Ladera de salamandras y lobos de ceniza.
3. **V3 Las puertas de Ascuaria** (Ascalia): los dracónidos no dejan entrar forasteros; prueba que
   vienes en paz trayendo el cargamento que los bandidos le robaron a Ignar.
4. **V4 El orgullo del forjador** (Ignar): pruebas de forja: junta azufre y obsidiana y forja con él.
5. **V5 Lo que se llevaron los bandidos** (Ceniza): en el Bosque Calcinado los bandidos tienen moldes
   de Ignar… marcados con el eclipse.
6. **V6 Moldes con eclipse** (Ignar): Ignar no quiere creerlo. Investiga en los Ríos de Lava.
7. **V7 Fuego que camina** (Pumo): cruza los Ríos de Lava y vence a los elementales que custodian
   un cargamento de moldes.
8. **V8 Vidrio negro** (Kessa): en la Cantera, los gólems de obsidiana fueron despertados por alguien.
9. **V9 El Maestro de la Lava** (Kessa → Ignar): vence al Maestro de la Lava (raro); lleva su
   molde: **giro: Ignar forjó sin saberlo los cristales.** Se siente culpable y se une.
10. **V10 La Fisura Infernal** (Ignar): se abre la mazmorra; vence a Morvak.
11. **V11 El dragón que lloraba fuego** (Viejo Escamas): el Dragón Menor está corrompido por un
    cristal; derrótalo para liberarlo.
12. **V12 Las puertas de la Caldera** (Ascalia): vence al **Señor de la Caldera**.
13. **V13 La ofrenda de Ascuaria** (Ascalia + Ignar): Ignar forja la Llave de Brasa con los moldes
    purificados; Ascuaria entera te despide.
14. **V14 El corazón del volcán** (Ignar): vence al **Titán de Fuego**. Al caer, vuelve en sí;
    Tercer Fragmento de Sello. El Encapuchado escapa por los ríos de lava hacia el mar → Costas.

**Secundarias:**
- **¿Dónde está Trueno? (otra vez)** (Gaspar): Trueno está calentándose junto a una fumarola,
  después robándole brochetas a Tuli y al final dormido en la Gran Forja.
- **Brokk contra Ignar** (cadena de 4): los dos te encargan la misma espada; eliges quién la forja
  y al final la forjan juntos (la primera vez que se dan la mano).
- **El huevo de dragón** (Chispa, cadena de 3): un huevo de piedra caliente que hay que mantener
  tibio con brasas; al final se abre.
- **¿Picante?** (Tuli): Tuli quiere un chile que haga llorar a un dracónido: Flor de Ceniza + Azufre.
- **Bosque que vuelve** (Ceniza, cadena de 3): junta semillas, riégalas con agua del Pilar y espanta
  a los lobos de ceniza.
- **Pómez de calidad** (Pumo): las balsas se hunden; tráele pómez y escamas de salamandra.
- **Artesana, no** (Kessa): talla una pieza de obsidiana mejor que la de Ignar (rivalidad).
- **El olor del éxito** (Sulfo): junta azufre para su poción; resulta que el olor era él.
- **El último vuelo** (Viejo Escamas, después de V11): lleva una escama del dragón a la Caldera.
- **Diarias:** cazas, recolección (azufre, obsidiana, flor de ceniza) y entregas en Ascuaria.
