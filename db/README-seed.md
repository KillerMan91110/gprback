# Cómo crear una base nueva (Supabase o local)

Dos formas de seedear una base vacía. Las dos requieren correr `schema.sql` primero (crea las
~98 tablas y aplica todos los `ALTER TABLE` acumulados) y después un archivo de contenido.

## Opción recomendada: `schema.sql` + `seed_v2.sql`

`seed_v2.sql` es un volcado directo y actual de lo que hay en producción (Supabase), regenerado
con `node` contra la base real — no es texto escrito a mano. Solo tiene contenido puro del juego
(clases, items, skills, quests, monstruos, maestros de clase, tiendas, catálogos) más la plantilla
de las 5 Leyendas en sus stats base de nivel 1. Cero jugadores reales, gremios, partidas en curso,
inventario/equipo o progreso actual de las Leyendas — arranca todo desde cero, como un install
limpio.

Cada `INSERT` trae sus IDs explícitos (copiados de producción) y termina con
`ON CONFLICT DO NOTHING`, y cada tabla con PK serial tiene su `SELECT setval(...)` correspondiente
para que la secuencia de autoincremento no choque con las próximas filas reales que inserte el
juego (un jugador registrándose, etc.). Por eso es re-corrible sin romper nada si se ejecuta dos
veces contra la misma base.

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed_v2.sql
```

O con el script del proyecto (hoy apunta a `seed.sql`, ver más abajo por qué no se tocó):

```bash
python db/run_sql.py
```

## Opción legacy: `schema.sql` + `seed.sql`

`seed.sql` es el archivo histórico, escrito a mano incrementalmente a lo largo de todo el
desarrollo (usa subqueries tipo `(SELECT id FROM classes WHERE code = 'GUERRERO')` en vez de IDs
explícitos). Sigue funcionando y es lo que usa `db/run_sql.py` hoy (`SQL_FILES = ['schema.sql',
'seed.sql']`) — **no se cambió ese default a `seed_v2.sql` en esta pasada**, porque es una decisión
aparte (cuál archivo queda como fuente de verdad going forward) y no algo para asumir sin
confirmarlo primero.

## Regenerar `seed_v2.sql` a futuro

Cuando `seed.sql` reciba cambios de contenido nuevos (nuevos items, monstruos, balance, etc.) y se
quiera refrescar `seed_v2.sql` para que refleje el estado real de producción otra vez, hay que
volver a exportar desde la base viva — no copiar a mano los cambios de `seed.sql`. La lista de
tablas de contenido (y su orden, que ya respeta las dependencias FK) está en el propio
`seed_v2.sql`, tabla por tabla, en el mismo orden en que aparecen los `INSERT INTO` en `seed.sql`.
El bloque de las 5 Leyendas al final es la excepción: no se vuelca tal cual desde producción (eso
traería su nivel/oro/equipo actual) — se reconstruye siempre en sus stats base de nivel 1, igual
que como se lo escribe en `seed.sql`.
