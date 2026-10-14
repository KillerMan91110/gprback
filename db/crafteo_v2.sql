-- ============================================================================================
-- Crafteo v2 (mundo 2D). Se puede correr varias veces sin duplicar nada (también va al final
-- de schema.sql).
--
-- - Cada receta dice DÓNDE se fabrica (crafting_recipes.station):
--     NULL    = en cualquier lado (pociones, comidas, vendajes y refinados simples)
--     'forja' = junto a un herrero (Brokk en Aurelia o Goreth en la Aldea Espiga): equipo y lingotes
--     'pilar' = junto al Pilar de Aethra (Plaza del Pilar, Aurelia): llenar frascos de agua
-- - El Agua Purificada ya no se vende: el alquimista vende Frascos Vacíos y se llenan en el Pilar.
-- - Refinados: Lingote de Hierro (mineral + carbón, en la forja), Tabla de Roble (madera) y Cuero
--   Tratado (piel de lobo; el peletero lo sigue vendiendo).
-- - Consumibles nuevos de la Pradera: Antídoto, Tónico de Miel y Vendaje.
-- - El equipo de la Pradera pide además un material recolectado/refinado según de qué está hecho.
-- ============================================================================================

ALTER TABLE crafting_recipes ADD COLUMN IF NOT EXISTS station TEXT;

-- ---------------------------------------------------------------- objetos nuevos
INSERT INTO items (code, name, item_type, rarity, required_level, is_craftable, obtain_method, buy_price, description) VALUES
  ('FRASCO_VACIO', 'Frasco Vacío', 'MATERIAL', 'COMUN', NULL, FALSE, 'Tienda del alquimista', 8,
   'Un frasco de vidrio limpio. Llénalo en el Pilar de Aethra para obtener Agua Purificada.'),
  ('LINGOTE_HIERRO', 'Lingote de Hierro', 'MATERIAL', 'COMUN', NULL, TRUE, 'Crafteo (forja)', NULL,
   'Hierro fundido con carbón en la forja. Base de las armas y armaduras de metal.'),
  ('TABLA_ROBLE', 'Tabla de Roble', 'MATERIAL', 'COMUN', NULL, TRUE, 'Crafteo', NULL,
   'Madera de roble cepillada. Se usa en arcos, ballestas y báculos.'),
  ('ANTIDOTO', 'Antídoto', 'CONSUMABLE', 'COMUN', 1, TRUE, 'Crafteo', NULL,
   'Quita el veneno y cura un poco.'),
  ('TONICO_MIEL', 'Tónico de Miel', 'CONSUMABLE', 'POCO_COMUN', 1, TRUE, 'Crafteo', NULL,
   'Cura un poco al instante y regenera vida durante 3 rondas.'),
  ('VENDAJE', 'Vendaje', 'CONSUMABLE', 'COMUN', 1, TRUE, 'Crafteo', NULL,
   'Tela limpia con hierbas. Cura un poco, también fuera de combate.')
ON CONFLICT (code) DO NOTHING;

UPDATE items SET obtain_method = 'Crafteo en el Pilar de Aethra',
  description = 'Agua del Pilar de Aethra. Base de pociones y elixires.'
WHERE code = 'AGUA_PURIFICADA';
UPDATE items SET is_craftable = TRUE WHERE code IN ('AGUA_PURIFICADA', 'CUERO_TRATADO');

-- efectos de los consumibles nuevos (CURE_DOT: quita el veneno; HOT: % de la vida máx. por ronda)
INSERT INTO item_stat_bonuses (item_id, stat_code, amount, is_percent, description, duration_turns)
SELECT i.id, v.stat_code, v.amount, v.is_percent, v.description, v.duration_turns
FROM (VALUES
  ('ANTIDOTO', 'CURE_DOT', 1, FALSE, 'Quita el veneno', NULL),
  ('ANTIDOTO', 'HEAL_HP', 20, FALSE, 'Restaura 20 HP', NULL),
  ('TONICO_MIEL', 'HEAL_HP', 25, FALSE, 'Restaura 25 HP', NULL),
  ('TONICO_MIEL', 'HOT', 5, TRUE, 'Regenera 5% de la vida por ronda', 3),
  ('VENDAJE', 'HEAL_HP', 45, FALSE, 'Restaura 45 HP', NULL)
) AS v(code, stat_code, amount, is_percent, description, duration_turns)
JOIN items i ON i.code = v.code
WHERE NOT EXISTS (SELECT 1 FROM item_stat_bonuses b WHERE b.item_id = i.id AND b.stat_code = v.stat_code);

-- ---------------------------------------------------------------- recetas nuevas
INSERT INTO crafting_recipes (code, result_item_id, result_quantity, rarity, success_rate_percent, zone_id, artisan_name, description, station)
SELECT v.code, i.id, v.qty, v.rarity, v.ok, 1, v.artisan, v.descr, v.station
FROM (VALUES
  ('AGUA_PURIFICADA_PILAR', 'AGUA_PURIFICADA', 1, 'COMUN', 100, 'Pilar de Aethra', 'Llena un frasco en el Pilar de Aethra. Los domingos (Festival de Aethra) cada frasco rinde el doble.', 'pilar'),
  ('LINGOTE_HIERRO', 'LINGOTE_HIERRO', 1, 'COMUN', 100, 'Forja', 'Funde mineral de hierro con carbón.', 'forja'),
  ('TABLA_ROBLE', 'TABLA_ROBLE', 1, 'COMUN', 100, NULL, 'Cepilla la madera de roble.', NULL),
  ('CUERO_TRATADO_LOBO', 'CUERO_TRATADO', 1, 'COMUN', 100, NULL, 'Curte las pieles de lobo.', NULL),
  ('ANTIDOTO', 'ANTIDOTO', 1, 'COMUN', 100, 'Alquimia', NULL, NULL),
  ('TONICO_MIEL', 'TONICO_MIEL', 1, 'POCO_COMUN', 95, 'Alquimia', NULL, NULL),
  ('VENDAJE', 'VENDAJE', 2, 'COMUN', 100, NULL, NULL, NULL)
) AS v(code, item_code, qty, rarity, ok, artisan, descr, station)
JOIN items i ON i.code = v.item_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, v.qty
FROM (VALUES
  ('AGUA_PURIFICADA_PILAR', 'FRASCO_VACIO', 1),
  ('LINGOTE_HIERRO', 'MINERAL_DE_HIERRO', 3),
  ('LINGOTE_HIERRO', 'CARBON', 1),
  ('TABLA_ROBLE', 'MADERA_DE_ROBLE', 3),
  ('CUERO_TRATADO_LOBO', 'PIEL_DE_LOBO', 2),
  ('ANTIDOTO', 'VENENO_DE_ARANA', 1),
  ('ANTIDOTO', 'HIERBA_CURATIVA', 2),
  ('ANTIDOTO', 'AGUA_PURIFICADA', 1),
  ('TONICO_MIEL', 'MIEL_ABEJA_ANTIGUA', 1),
  ('TONICO_MIEL', 'HIERBA_CURATIVA', 2),
  ('TONICO_MIEL', 'AGUA_PURIFICADA', 1),
  ('VENDAJE', 'TELA_COMUN', 2),
  ('VENDAJE', 'HIERBA_CURATIVA', 1)
) AS v(recipe_code, item_code, qty)
JOIN crafting_recipes cr ON cr.code = v.recipe_code
JOIN items i ON i.code = v.item_code
ON CONFLICT (recipe_id, item_id) DO NOTHING;

-- todo el equipo se fabrica en la forja (las recetas que ya existían no tenían lugar)
UPDATE crafting_recipes cr SET station = 'forja'
FROM items i
WHERE i.id = cr.result_item_id AND i.item_type = 'EQUIPMENT' AND cr.station IS NULL;

-- ---------------------------------------------------------------- tienda del alquimista
-- el agua deja de venderse: en su lugar, frascos vacíos
UPDATE artisan_shop SET item_id = (SELECT id FROM items WHERE code = 'FRASCO_VACIO'), price = 8
WHERE item_id = (SELECT id FROM items WHERE code = 'AGUA_PURIFICADA');

-- ---------------------------------------------------------------- equipo de la Pradera
-- Además de los trofeos de monstruo, cada pieza pide un material según de qué está hecha
-- (1 en común/poco común, 2 en épico, 3 en legendario; las hierbas, el doble):
--   metal (guerrero, espadas, hachas, dagas, escudos, accesorios) → Lingote de Hierro
--   madera (arcos, ballestas, báculos, varitas)                    → Tabla de Roble
--   cuero (arquero, pícaro, carcaj)                                → Cuero Tratado
--   tela del mago (y orbe/cristal)                                 → Hierba Mágica
--   tela del sacerdote (y símbolo)                                 → Flor Luminosa
-- Las recetas que ya pedían mineral, acero o cuero crudo (las "Crafteadas") quedan como estaban.
CREATE TEMP TABLE IF NOT EXISTS tmp_pradera_extra (recipe_id INT, item_code TEXT, qty INT);
TRUNCATE tmp_pradera_extra;
INSERT INTO tmp_pradera_extra
SELECT cr.id,
  CASE
    WHEN i.slot = 'WEAPON' AND i.name ~* '(arco|ballesta|báculo|varita)' THEN 'TABLA_ROBLE'
    WHEN i.class_id = 1 OR i.slot = 'ACCESSORY'
      OR (i.slot = 'WEAPON' AND i.name ~* '(espada|hacha|daga)')
      OR (i.slot = 'OFFHAND' AND i.name ~* '(escudo|daga gemela)') THEN 'LINGOTE_HIERRO'
    WHEN i.class_id IN (3, 4) OR (i.slot = 'OFFHAND' AND i.name ~* 'carcaj') THEN 'CUERO_TRATADO'
    WHEN i.class_id = 2 THEN 'HIERBA_MAGICA'
    WHEN i.class_id = 5 THEN 'FLOR_LUMINOSA'
  END,
  CASE cr.rarity WHEN 'EPICO' THEN 2 WHEN 'LEGENDARIO' THEN 3 WHEN 'RARO' THEN 2 ELSE 1 END
FROM crafting_recipes cr
JOIN items i ON i.id = cr.result_item_id
WHERE cr.zone_id = 1 AND i.item_type = 'EQUIPMENT'
  AND NOT EXISTS (
    SELECT 1 FROM crafting_recipe_ingredients ri JOIN items x ON x.id = ri.item_id
    WHERE ri.recipe_id = cr.id AND x.code IN ('MINERAL_DE_HIERRO', 'ACERO_REFINADO', 'CUERO_CRUDO')
  );
UPDATE tmp_pradera_extra SET qty = qty * 2 WHERE item_code = 'HIERBA_MAGICA';
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT t.recipe_id, i.id, t.qty
FROM tmp_pradera_extra t JOIN items i ON i.code = t.item_code
WHERE t.item_code IS NOT NULL
ON CONFLICT (recipe_id, item_id) DO NOTHING;
DROP TABLE tmp_pradera_extra;
