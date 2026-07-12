// insert_evolutions.js
// Reconstruye las 63 entradas R1->R2 / R2->R3 en class_evolutions y renombra clases.
// Árbol histórico ajustado: cadenas narrativas (A->B->C), nuevos niveles, nuevos padres.
// Usar --write para aplicar; sin el flag hace dry-run.

const { Pool } = require('pg');
require('dotenv').config({ path: 'c:\\Users\\meroc\\OneDrive\\Documentos\\Proyecto\\PKM\\gprback\\.env' });

const db = new Pool({
  host: process.env.PGHOST, port: process.env.PGPORT,
  database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD,
});

const WRITE = process.argv[2] === '--write';

// Conexiones que ya no deben existir (padre cambió, fueron eliminadas, o nivel incorrecto).
// Se borran antes de reinsertar para garantizar estado correcto en BD existente.
const TO_DELETE = [
  // Padres cambiados
  [7,  44],  // Espadachín→C.Oscuro → ahora Caballero(8)→C.Oscuro
  [8,  47],  // Caballero→Caballero Abisal → ahora cadena C.Oscuro(44)→C.Abisal
  [9,  51],  // Berserker→Titán del Caos → ahora cadena Titán Furioso(50)→T.del Caos
  [31, 59],  // Piromántico→M.Elemental → ahora Elemental(14)→M.Elemental
  [15, 60],  // Mago Divino→Mago Cósmico → ahora cadena M.Estelar(61)→M.Cósmico
  [16, 65],  // Cazador→Maestro del Arco → eliminado del árbol
  [20, 66],  // Elfo Silvestre→Arquero Celestial → ahora Arquero Umbrío(19)→A.Celestial
  [20, 72],  // Elfo Silvestre→Guardián Silvestre → movido a Ranger(18)
  [22, 76],  // Asesino→Asesino de Élite → ahora cadena M.Asesino(75)→A.de Élite
  [22, 82],  // Asesino→Cazador de Reliquias → ahora Esp.Trampas(25)→C.de Reliquias
  [21, 84],  // Ninja→Maestro del Sigilo → ahora Esp.Trampas(25)→M.del Sigilo
  [27, 98],  // Druida→Archidruida → ahora cadena D.Primordial(90)→Archidruida
  [28, 93],  // Templario→Paladín Divino → ahora cadena C.Templario(92)→P.Divino
  [29, 95],  // S.Divino→Pontífice → ahora cadena S.Legendario(89)→Pontífice
  [30, 96],  // Inquisidor→Inquisidor Sagrado → ahora cadena G.Inquisidor(94)→I.Sagrado
  [30, 99],  // Inquisidor→S.del Caos → ahora cadena Vidente(101)→S.del Caos
  [88, 89],  // Obispo→Sanador Legendario → ahora S.Divino(29)→S.Legendario
  [93, 100], // Paladín Divino→Apóstol → ahora Obispo(88)→Apóstol
  // Nivel cambió (ON CONFLICT DO NOTHING no las actualiza, hay que reborrare reinsertar)
  [6,  39], [6,  40], [6,  41],
  [8,  45], [9,  50], [10, 53],
  [12, 54], [12, 55],
  [17, 62], [17, 68],
  [18, 71], [18, 72],
  [19, 73],
  [20, 70],
  [22, 75], [23, 80], [23, 81],
  [24, 77], [24, 86],
  [25, 85],
  [27, 91],
  [28, 92], [29, 101],
  [30, 94],
  [45, 46], [70, 74],
];

// [from_class_id, to_class_id, required_level]
const NEW_EVOLUTIONS = [
  // ── GUERRERO ──────────────────────────────────────────────────────────────
  [6, 38, 30], [6, 39, 35], [6, 40, 35], [6, 41, 40], // Monje R2
  [38, 42, 50],                                         // → Maestro Monje Supremo R3
  [7, 43, 30],                                          // Espadachín → Maestro Espadachín
  [8, 44, 35], [44, 47, 40],                            // Caballero → C.Oscuro → C.Abisal
  [8, 45, 25], [45, 46, 40],                            // Caballero → Paladín → Paladín Celestial
  [8, 48, 30], [48, 49, 50],                            // Caballero → C.Blindado → Paladín Dracónito
  [9, 50, 35], [50, 51, 45],                            // Berserker → Titán Furioso → Titán del Caos
  [10, 52, 35], [10, 53, 40],                           // Guerrero Magus → Mago Espada / Espadachín Arcano

  // ── MAGO ──────────────────────────────────────────────────────────────────
  [12, 54, 35], [12, 55, 50],                           // Nigromante → Rey Nigromante / Lich
  [13, 56, 30], [13, 57, 30], [13, 58, 30],             // Invocador R2s
  [14, 59, 35],                                         // Elemental → Maestro Elemental (R2 directo)
  [15, 61, 50], [61, 60, 70],                           // M.Divino → M.Estelar → M.Cósmico (lv70)

  // ── ARQUERO ───────────────────────────────────────────────────────────────
  [16, 67, 25], [16, 69, 30],                           // Cazador R2s
  [17, 62, 40], [17, 63, 30], [17, 64, 30], [17, 68, 30], // Francotirador R2s
  [18, 71, 35], [18, 72, 35],                           // Ranger → Ranger Primordial / Guardián Silvestre
  [19, 66, 35], [19, 73, 40],                           // Arquero Umbrío → Arquero Celestial / Asesino Umbrío
  [20, 70, 35], [70, 74, 45],                           // Elfo Silvestre → Elfo Antiguo → Elfo Señor del Bosque

  // ── PÍCARO ────────────────────────────────────────────────────────────────
  [21, 78, 30], [21, 79, 35], [21, 87, 25],             // Ninja R2s
  [22, 75, 35], [75, 76, 45],                           // Asesino → Maestro Asesino → Asesino de Élite
  [23, 80, 35], [23, 81, 40],                           // Ladrón Maestro R2s
  [24, 77, 35], [24, 86, 35],                           // Envenenador → M.Envenenador / Maestro de Venenos
  [25, 82, 30], [25, 83, 30], [25, 84, 35], [25, 85, 30], // Esp.Trampas R2s

  // ── SACERDOTE ─────────────────────────────────────────────────────────────
  [26, 88, 30], [26, 97, 30],                           // Clérigo → Obispo / Bendito
  [88, 100, 45],                                        // Obispo → Apóstol
  [27, 90, 30], [27, 91, 35],                           // Druida R2s
  [90, 98, 40],                                         // Druida Primordial → Archidruida
  [28, 92, 35], [92, 93, 45],                           // Templario → C.Templario → Paladín Divino
  [29, 89, 40], [29, 101, 35],                          // S.Divino → S.Legendario / Vidente
  [89, 95, 50],                                         // S.Legendario → Pontífice
  [101, 99, 50],                                        // Vidente → Sacerdote del Caos
  [30, 94, 40], [94, 96, 50],                           // Inquisidor → Gran Inquisidor → Inquisidor Sagrado
];

// Renombres de clases
const RENAMES = [
  [19, 'Arquero Umbrío'],
  [46, 'Paladín Celestial'],
  [47, 'Caballero Abisal'],
  [49, 'Paladín Dracónito'],
  [51, 'Titán del Caos'],
  [53, 'Espadachín Arcano'],
  [73, 'Asesino Umbrío'],
  [82, 'Cazador de Reliquias'],
  [85, 'Ingeniero de Trampas'],
  [86, 'Maestro de Venenos'],
  [95, 'Pontífice'],
  [96, 'Inquisidor Sagrado'],
  [98, 'Archidruida'],
];

async function main() {
  const { rows: classes } = await db.query('SELECT id, name FROM classes');
  const byId = Object.fromEntries(classes.map(c => [c.id, c.name]));

  console.log(`Conexiones a borrar: ${TO_DELETE.length}`);
  console.log(`Evoluciones a insertar: ${NEW_EVOLUTIONS.length}`);
  console.log(`Clases a renombrar: ${RENAMES.length}`);

  if (!WRITE) {
    console.log('\n── BORRAR ──');
    for (const [f, t] of TO_DELETE)
      console.log(`  (${f}) ${byId[f] || '?'} → (${t}) ${byId[t] || '?'}`);
    console.log('\n── INSERTAR ──');
    for (const [f, t, lv] of NEW_EVOLUTIONS)
      console.log(`  Lv${lv}  (${f}) ${byId[f]} → (${t}) ${byId[t]}`);
    console.log('\n── RENOMBRAR ──');
    for (const [id, name] of RENAMES)
      console.log(`  id ${id}: "${byId[id]}" → "${name}"`);
    console.log('\nDry run — pasá --write para aplicar.');
    await db.end(); return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    let deleted = 0;
    for (const [f, t] of TO_DELETE) {
      const r = await client.query(
        'DELETE FROM class_evolutions WHERE class_id=$1 AND evolves_to_class_id=$2', [f, t]
      );
      deleted += r.rowCount;
    }
    console.log(`✓ ${deleted} conexiones antiguas eliminadas.`);

    for (const [f, t, lv] of NEW_EVOLUTIONS) {
      await client.query(
        `INSERT INTO class_evolutions(class_id, evolves_to_class_id, required_level)
         VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [f, t, lv]
      );
    }
    console.log(`✓ ${NEW_EVOLUTIONS.length} evoluciones insertadas.`);

    for (const [id, name] of RENAMES) {
      await client.query('UPDATE classes SET name=$1 WHERE id=$2', [name, id]);
    }
    console.log(`✓ ${RENAMES.length} clases renombradas.`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ERROR — rollback:', err.message);
  } finally {
    client.release();
  }
  await db.end();
}

main().catch(console.error);
