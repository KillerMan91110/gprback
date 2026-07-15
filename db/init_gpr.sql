-- Inicializa la base de datos gpr y crea las tablas necesarias para clases y evoluciones.
-- PASOS:
-- 1) Crear la base de datos gpr si no existe:
--    psql -d postgres -c "CREATE DATABASE gpr;"
-- 2) Ejecutar este script desde la carpeta del proyecto:
--    psql -d gpr -f db/init_gpr.sql
-- 3) Si quieres cargar datos de semilla automáticamente, puedes ejecutar:
--    psql -d gpr -f db/seed.sql

-- Si se requiere reiniciar la estructura, descomentar las siguientes líneas.
-- DROP TABLE IF EXISTS player_class_progress CASCADE;
-- DROP TABLE IF EXISTS players CASCADE;
-- DROP TABLE IF EXISTS class_evolutions CASCADE;
-- DROP TABLE IF EXISTS class_growths CASCADE;
-- DROP TABLE IF EXISTS classes CASCADE;

CREATE TABLE IF NOT EXISTS classes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  description TEXT,
  xp_rate NUMERIC(5,2) NOT NULL DEFAULT 1.00,
  base_hp INT NOT NULL DEFAULT 0,
  base_atk INT NOT NULL DEFAULT 0,
  base_def INT NOT NULL DEFAULT 0,
  base_mag INT NOT NULL DEFAULT 0,
  base_magic_def INT NOT NULL DEFAULT 0,
  base_spd INT NOT NULL DEFAULT 0,
  base_evasion NUMERIC(5,2) NOT NULL DEFAULT 0,
  base_crit_chance NUMERIC(5,2) NOT NULL DEFAULT 0,
  base_crit_damage NUMERIC(5,2) NOT NULL DEFAULT 0,
  base_mana INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS class_growths (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  level_from INT NOT NULL,
  level_to INT NOT NULL,
  hp_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  atk_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  def_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  mag_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  magic_def_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  spd_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  mana_per_level NUMERIC(5,2) NOT NULL DEFAULT 0,
  bonus_description TEXT
);

ALTER TABLE class_growths ADD COLUMN IF NOT EXISTS magic_def_per_level NUMERIC(5,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS class_evolutions (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  evolves_to_class_id INT NOT NULL REFERENCES classes(id),
  required_level INT NOT NULL DEFAULT 1,
  extra_hp_rate NUMERIC(5,2) DEFAULT 0,
  extra_atk_rate NUMERIC(5,2) DEFAULT 0,
  extra_def_rate NUMERIC(5,2) DEFAULT 0,
  extra_mag_rate NUMERIC(5,2) DEFAULT 0,
  extra_spd_rate NUMERIC(5,2) DEFAULT 0,
  extra_crit_rate NUMERIC(5,2) DEFAULT 0,
  description TEXT,
  UNIQUE(class_id, evolves_to_class_id)
);

-- Requisitos adicionales por evolución (0 a N por fila de class_evolutions).
-- El nivel sigue viviendo en required_level; aquí va todo lo demás: item, equipo,
-- contador (incluye kills con una habilidad/elemento específico) o umbral de stat.
CREATE TABLE IF NOT EXISTS class_evolution_requirements (
  id SERIAL PRIMARY KEY,
  evolution_id INT NOT NULL REFERENCES class_evolutions(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('COUNTER', 'ITEM', 'EQUIPMENT', 'NO_WEAPON', 'STAT_THRESHOLD')),
  counter_code TEXT,
  comparison TEXT NOT NULL DEFAULT '>=',
  target_value INT,
  item_code TEXT,
  equipment_type TEXT,
  stat_code TEXT,
  description TEXT
);

CREATE TABLE IF NOT EXISTS elements (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS class_element_resistances (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  element_id INT NOT NULL REFERENCES elements(id),
  resistance_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE(class_id, element_id)
);

-- Sustituye al antiguo classes.base_elemental_damage (un solo numero generico para
-- todos los elementos). Cada clase solo tiene fila aqui en el/los elementos con los
-- que realmente tiene una skill o tema (ej. Mago Piromantico solo en FIRE).
CREATE TABLE IF NOT EXISTS class_elemental_damage_bonus (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  element_id INT NOT NULL REFERENCES elements(id),
  damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE(class_id, element_id)
);

-- Habilidades por clase. El daño/curación se calcula como base_value + (scaling_stat * scaling_multiplier),
-- usando el stat real del jugador (players.atk o players.mag) repetido "hits" veces (ej. Danza de Cuchillos = 4 hits).
-- damage_school indica qué resistencia elemental/física aplica el combate; element_id solo se usa en ataques elementales.
CREATE TABLE IF NOT EXISTS skills (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL REFERENCES classes(id),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  skill_type TEXT NOT NULL CHECK (skill_type IN ('ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESTADO_ALTERADO', 'ESPECIAL', 'PASIVA')),
  damage_school TEXT CHECK (damage_school IN ('FISICO', 'MAGICO')),
  element_id INT REFERENCES elements(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('SELF', 'ALLY', 'ALL_ALLIES', 'ENEMY', 'ALL_ENEMIES')),
  base_value NUMERIC(6,2),
  scaling_stat TEXT CHECK (scaling_stat IN ('ATK', 'MAG')),
  scaling_multiplier NUMERIC(4,2),
  hits INT NOT NULL DEFAULT 1,
  mana_cost INT NOT NULL DEFAULT 0,
  is_passive BOOLEAN NOT NULL DEFAULT FALSE,
  learn_method TEXT NOT NULL CHECK (learn_method IN ('LEVEL', 'GOLD', 'QUEST', 'DROP', 'ITEM')),
  learn_level INT,
  learn_gold_cost INT,
  learn_requirement_text TEXT,
  description TEXT
);

-- Efectos secundarios de una habilidad (0 a N por skill): permite que una sola skill module
-- varios stats a la vez (ej. Poder Sagrado: +Daño Luz y +DEF MAG juntos) sin inflar columnas en skills.
CREATE TABLE IF NOT EXISTS skill_effects (
  id SERIAL PRIMARY KEY,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL CHECK (effect_type IN ('STAT_MOD', 'DOT', 'HOT', 'REVIVE', 'CLEANSE', 'NO_DAMAGE_WINDOW', 'GUARANTEED_CRIT', 'CONDITIONAL_DAMAGE')),
  stat_code TEXT,
  percent_amount NUMERIC(5,2),
  flat_amount NUMERIC(6,2),
  duration_turns INT,
  condition_stat TEXT,
  condition_comparison TEXT,
  condition_value NUMERIC(6,2),
  description TEXT
);

-- Items de equipamiento (de momento solo armas/offhand/accesorios, ver sistema_items_equipamento.html).
-- item_type distingue equipables de materiales de crafteo (sin slot ni stats propios).
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('EQUIPMENT', 'MATERIAL', 'CONSUMABLE')),
  slot TEXT CHECK (slot IN ('WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY')),
  is_two_handed BOOLEAN NOT NULL DEFAULT FALSE,
  rarity TEXT CHECK (rarity IN ('COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO')),
  class_id INT REFERENCES classes(id),
  required_level INT,
  is_craftable BOOLEAN NOT NULL DEFAULT FALSE,
  obtain_method TEXT,
  description TEXT,
  buy_price INT
);

-- Bonos de stat de un item (0 a N por item): tabla flexible porque cada item trae un set
-- distinto de stats (crítico%, regen de maná, daño vs dragones, etc), igual patrón que skill_effects.
CREATE TABLE IF NOT EXISTS item_stat_bonuses (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  stat_code TEXT NOT NULL,
  amount NUMERIC(6,2) NOT NULL,
  is_percent BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT
);

-- Habilidad que se desbloquea/otorga al equipar un item (ej. Excalibur -> "Corte Divino").
-- Tambien sirve para items que desbloquean antes una skill que normalmente requeriria mas nivel.
CREATE TABLE IF NOT EXISTS item_unlocks_skill (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE(item_id, skill_id)
);

CREATE TABLE IF NOT EXISTS monster_zones (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  min_level INT NOT NULL DEFAULT 1,
  max_level INT NOT NULL DEFAULT 10,
  description TEXT
);

CREATE TABLE IF NOT EXISTS monsters (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  zone_id INT REFERENCES monster_zones(id),
  element_id INT REFERENCES elements(id),
  rarity TEXT NOT NULL DEFAULT 'COMMON',
  base_level INT NOT NULL DEFAULT 1,
  min_spawn_level INT NOT NULL DEFAULT 1,
  max_spawn_level INT NOT NULL DEFAULT 1,
  base_hp INT NOT NULL DEFAULT 0,
  base_atk INT NOT NULL DEFAULT 0,
  base_def INT NOT NULL DEFAULT 0,
  base_magic_atk INT NOT NULL DEFAULT 0,
  base_magic_def INT NOT NULL DEFAULT 0,
  base_spd INT NOT NULL DEFAULT 0,
  base_evasion NUMERIC(5,2) NOT NULL DEFAULT 0,
  base_crit_chance NUMERIC(5,2) NOT NULL DEFAULT 0,
  base_crit_damage NUMERIC(5,2) NOT NULL DEFAULT 0,
  xp_reward INT DEFAULT 0,
  gold_reward INT DEFAULT 0,
  description TEXT
);

ALTER TABLE IF EXISTS monsters ADD COLUMN IF NOT EXISTS element_id INT REFERENCES elements(id);
ALTER TABLE IF EXISTS monsters ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'COMMON';

CREATE TABLE IF NOT EXISTS monster_element_resistances (
  id SERIAL PRIMARY KEY,
  monster_id INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  element_id INT NOT NULL REFERENCES elements(id),
  resistance_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE(monster_id, element_id)
);

-- Sustituye al antiguo monsters.base_elemental_damage (un solo numero generico para
-- todos los elementos), mismo patron que class_elemental_damage_bonus.
CREATE TABLE IF NOT EXISTS monster_elemental_damage_bonus (
  id SERIAL PRIMARY KEY,
  monster_id INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  element_id INT NOT NULL REFERENCES elements(id),
  damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE(monster_id, element_id)
);

CREATE TABLE IF NOT EXISTS monster_level_scalings (
  id SERIAL PRIMARY KEY,
  monster_id INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  level INT NOT NULL,
  hp INT NOT NULL DEFAULT 0,
  atk INT NOT NULL DEFAULT 0,
  def INT NOT NULL DEFAULT 0,
  magic_atk INT NOT NULL DEFAULT 0,
  magic_def INT NOT NULL DEFAULT 0,
  spd INT NOT NULL DEFAULT 0,
  evasion NUMERIC(5,2) NOT NULL DEFAULT 0,
  crit_chance NUMERIC(5,2) NOT NULL DEFAULT 0,
  crit_damage NUMERIC(5,2) NOT NULL DEFAULT 0,
  elemental_damage NUMERIC(5,2) NOT NULL DEFAULT 0,
  UNIQUE(monster_id, level)
);

CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL UNIQUE,
  current_class_id INT REFERENCES classes(id),
  evolution_class_id INT REFERENCES class_evolutions(id),
  level INT NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0,
  gold BIGINT NOT NULL DEFAULT 0,
  rank TEXT,
  reputation BIGINT DEFAULT 0,
  hp INT DEFAULT 0,
  max_hp INT DEFAULT 0,
  mana INT DEFAULT 0,
  max_mana INT DEFAULT 0,
  atk INT DEFAULT 0,
  def INT DEFAULT 0,
  mag INT DEFAULT 0,
  magic_def INT DEFAULT 0,
  spd INT DEFAULT 0,
  crit NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS magic_def INT DEFAULT 0;

-- Migracion para DBs creadas antes de tener login con email/password (la tabla players
-- solo tenia "username" como nombre publico). Si la columna vieja existe, se renombra a
-- nickname (mismo proposito: nombre con el que se identifica el jugador) y se agregan
-- email/password_hash para el login.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'players' AND column_name = 'username') THEN
    ALTER TABLE players RENAME COLUMN username TO nickname;
  END IF;
END $$;

ALTER TABLE players ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pool_last_generated_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE players ADD CONSTRAINT players_email_key UNIQUE (email);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

-- Solo aplica de verdad si no hay filas con NULL (tabla nueva, o ya migrada).
DO $$
BEGIN
  ALTER TABLE players ALTER COLUMN email SET NOT NULL;
  ALTER TABLE players ALTER COLUMN password_hash SET NOT NULL;
EXCEPTION WHEN not_null_violation THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS player_class_progress (
  player_id INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  class_id INT NOT NULL REFERENCES classes(id),
  level INT NOT NULL DEFAULT 1,
  xp BIGINT NOT NULL DEFAULT 0,
  evolution_id INT REFERENCES class_evolutions(id),
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Rangos de reputacion (sistema_quests_misionnes_reputacion_completo.html): todo jugador
-- empieza en F (players.rank default) y el maximo actual es S. Cada rango da bonus de
-- XP/descuento en tienda/recompensas y slots extra de inventario.
CREATE TABLE IF NOT EXISTS ranks (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  min_reputation BIGINT NOT NULL,
  max_reputation BIGINT,
  xp_bonus_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  shop_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  reward_bonus_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  extra_inventory_slots INT NOT NULL DEFAULT 0,
  description TEXT
);

ALTER TABLE players ALTER COLUMN rank SET DEFAULT 'F';

DO $$
BEGIN
  ALTER TABLE players ADD CONSTRAINT players_rank_fkey FOREIGN KEY (rank) REFERENCES ranks(code);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Misiones de las 7 zonas. Cada zona tiene una cadena de 3 quests PRINCIPAL (kill comun ->
-- miniboss -> jefe legendario de zona), 1 DIARIA repetible y 1+ OCULTA con requisitos
-- especiales (ver quest_hidden_requirements). requires_quest_id encadena el progreso
-- (quest 2 exige quest 1 completada, etc).
CREATE TABLE IF NOT EXISTS quests (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  quest_type TEXT NOT NULL CHECK (quest_type IN ('PRINCIPAL', 'DIARIA', 'OCULTA')),
  zone_id INT NOT NULL REFERENCES monster_zones(id),
  chain_position INT,
  chain_total INT,
  is_boss_quest BOOLEAN NOT NULL DEFAULT FALSE,
  requires_quest_id INT REFERENCES quests(id),
  min_level INT,
  max_level INT,
  difficulty_stars INT NOT NULL DEFAULT 1 CHECK (difficulty_stars BETWEEN 1 AND 5),
  min_rank_code TEXT REFERENCES ranks(code),
  npc_name TEXT,
  location_name TEXT,
  is_repeatable BOOLEAN NOT NULL DEFAULT FALSE,
  repeat_cooldown_hours INT,
  reputation_reward INT NOT NULL DEFAULT 0,
  gold_reward INT NOT NULL DEFAULT 0,
  xp_reward INT NOT NULL DEFAULT 0,
  hidden_unlock_text TEXT,
  description TEXT,
  required_class_id INT REFERENCES classes(id)
);

-- Objetivos de cada quest (0 a N). USE_ACTION = acción de combate (atacar/defender/skill);
-- el resto apuntan a monstruos o items concretos.
CREATE TABLE IF NOT EXISTS quest_objectives (
  id SERIAL PRIMARY KEY,
  quest_id INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  objective_type TEXT NOT NULL CHECK (objective_type IN ('KILL_MONSTER', 'KILL_ANY_IN_ZONE', 'DEFEAT_BOSS', 'COLLECT_ITEM', 'USE_ACTION')),
  monster_id INT REFERENCES monsters(id),
  item_id INT REFERENCES items(id),
  target_count INT NOT NULL DEFAULT 1,
  description TEXT,
  required_skill_id INT REFERENCES skills(id),
  required_damage_school TEXT,
  required_elemental BOOLEAN,
  required_base_action TEXT,
  requires_kill BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS quest_item_rewards (
  id SERIAL PRIMARY KEY,
  quest_id INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  quantity INT NOT NULL DEFAULT 1
);

-- Requisitos de desbloqueo de quests OCULTAS, mismo patron que class_evolution_requirements.
-- DEFEAT_ALL_ZONE_BOSSES es una bandera semantica (sin monster_id) para "Ascension a Dios".
CREATE TABLE IF NOT EXISTS quest_hidden_requirements (
  id SERIAL PRIMARY KEY,
  quest_id INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  requirement_type TEXT NOT NULL CHECK (requirement_type IN ('DEFEAT_MONSTER', 'COLLECT_ITEM', 'MIN_RANK', 'DEFEAT_ALL_ZONE_BOSSES', 'HP_BELOW_PERCENT')),
  monster_id INT REFERENCES monsters(id),
  item_id INT REFERENCES items(id),
  target_count INT,
  rank_code TEXT REFERENCES ranks(code),
  percent_value NUMERIC(5,2),
  description TEXT
);

CREATE TABLE IF NOT EXISTS player_quest_completions (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_id INT NOT NULL REFERENCES quests(id),
  times_completed INT NOT NULL DEFAULT 1,
  last_completed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_id, quest_id)
);

-- Inventario real del jugador (items de items, no equipamiento equipado todavia - eso
-- requeriria slots por personaje y queda para otra pasada). Usado por crafteo y recompensas
-- de quests para tener donde sumar/restar items.
CREATE TABLE IF NOT EXISTS player_inventory (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  UNIQUE(player_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_player_inventory_player_id ON player_inventory(player_id);

-- Equipamiento puesto: una fila por slot ocupado (maximo 1 item por slot, ver items.slot).
-- Un arma a dos manos (items.is_two_handed) ocupa WEAPON y libera/bloquea OFFHAND en routes/players.js.
CREATE TABLE IF NOT EXISTS player_equipment (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY')),
  item_id INT NOT NULL REFERENCES items(id),
  UNIQUE(player_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_player_equipment_player_id ON player_equipment(player_id);

-- Sesiones de combate por turnos. status IN_PROGRESS mientras se resuelve turno a turno via
-- POST /api/combat/sessions/:id/action; el back es quien decide el resultado de cada accion
-- (ATTACK/DEFEND/ESCAPE/USE_ITEM), el front solo manda la eleccion.
CREATE TABLE IF NOT EXISTS combat_sessions (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'PLAYER_WON', 'ENEMY_WON', 'ESCAPED')),
  current_round INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 1 fila por combatiente (jugador o monstruo) de la sesion. has_acted_this_round se resetea
-- al empezar cada ronda nueva; is_defending se consume en el siguiente golpe que recibe.
CREATE TABLE IF NOT EXISTS combat_participants (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('PLAYER', 'ENEMY')),
  player_id INT REFERENCES players(id),
  npc_id INT REFERENCES player_npcs(id),
  class_id INT REFERENCES classes(id),
  monster_code TEXT,
  name TEXT NOT NULL,
  hp INT NOT NULL,
  max_hp INT NOT NULL,
  mana INT NOT NULL DEFAULT 0,
  max_mana INT NOT NULL DEFAULT 0,
  atk INT NOT NULL DEFAULT 0,
  mag INT NOT NULL DEFAULT 0,
  def INT NOT NULL DEFAULT 0,
  magic_def INT NOT NULL DEFAULT 0,
  spd INT NOT NULL DEFAULT 0,
  crit_chance NUMERIC(5,2) NOT NULL DEFAULT 0,
  crit_damage NUMERIC(5,2) NOT NULL DEFAULT 50,
  evasion NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_defending BOOLEAN NOT NULL DEFAULT FALSE,
  has_acted_this_round BOOLEAN NOT NULL DEFAULT FALSE,
  xp_reward INT NOT NULL DEFAULT 0,
  gold_reward INT NOT NULL DEFAULT 0
);

ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS magic_def INT NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS npc_id INT REFERENCES player_npcs(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS class_id INT REFERENCES classes(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS magic_damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS hot_hp_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS imbued_element_id INT REFERENCES elements(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS imbued_damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS heal INT;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS hp_after INT;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS mana_after INT;

CREATE TABLE IF NOT EXISTS combat_log (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  round INT NOT NULL,
  actor_participant_id INT REFERENCES combat_participants(id),
  action TEXT NOT NULL CHECK (action IN ('ATTACK', 'DEFEND', 'ESCAPE', 'USE_ITEM', 'SKILL')),
  target_participant_id INT REFERENCES combat_participants(id),
  item_id INT REFERENCES items(id),
  damage INT,
  evaded BOOLEAN NOT NULL DEFAULT FALSE,
  crit BOOLEAN NOT NULL DEFAULT FALSE,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_combat_participants_session_id ON combat_participants(session_id);
CREATE INDEX IF NOT EXISTS idx_combat_log_session_id ON combat_log(session_id);

-- Efectos de buff/debuff activos durante un combate. Se insertan al usar la skill y se
-- eliminan (revirtiendo el applied_flat sobre el stat del participante) cuando expiran.
CREATE TABLE IF NOT EXISTS combat_participant_buffs (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  participant_id INT NOT NULL REFERENCES combat_participants(id) ON DELETE CASCADE,
  stat_code TEXT NOT NULL,
  applied_flat INT NOT NULL DEFAULT 0,
  rounds_remaining INT NOT NULL,
  is_debuff BOOLEAN NOT NULL DEFAULT FALSE,
  skill_id INT REFERENCES skills(id)
);

-- Skills que pueden usar los monstruos en combate (independientes del sistema de clases).
CREATE TABLE IF NOT EXISTS monster_skills (
  id SERIAL PRIMARY KEY,
  monster_id INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id),
  use_chance_percent NUMERIC(5,2) NOT NULL DEFAULT 30,
  UNIQUE(monster_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_monster_skills_monster_id ON monster_skills(monster_id);
CREATE INDEX IF NOT EXISTS idx_combat_participant_buffs_session_id ON combat_participant_buffs(session_id);

CREATE INDEX IF NOT EXISTS idx_quests_zone_id ON quests(zone_id);
CREATE INDEX IF NOT EXISTS idx_quest_objectives_quest_id ON quest_objectives(quest_id);
CREATE INDEX IF NOT EXISTS idx_quest_item_rewards_quest_id ON quest_item_rewards(quest_id);
CREATE INDEX IF NOT EXISTS idx_quest_hidden_requirements_quest_id ON quest_hidden_requirements(quest_id);
CREATE INDEX IF NOT EXISTS idx_player_quest_completions_player_id ON player_quest_completions(player_id);

CREATE INDEX IF NOT EXISTS idx_player_current_class ON players(current_class_id);
CREATE INDEX IF NOT EXISTS idx_class_growth_class_id ON class_growths(class_id);
CREATE INDEX IF NOT EXISTS idx_class_evolution_class_id ON class_evolutions(class_id);
CREATE INDEX IF NOT EXISTS idx_skill_class_id ON skills(class_id);
CREATE INDEX IF NOT EXISTS idx_skill_effect_skill_id ON skill_effects(skill_id);
CREATE INDEX IF NOT EXISTS idx_class_elemental_damage_class_id ON class_elemental_damage_bonus(class_id);
CREATE INDEX IF NOT EXISTS idx_monster_elemental_damage_monster_id ON monster_elemental_damage_bonus(monster_id);
CREATE INDEX IF NOT EXISTS idx_item_class_id ON items(class_id);
CREATE INDEX IF NOT EXISTS idx_item_stat_bonus_item_id ON item_stat_bonuses(item_id);
CREATE INDEX IF NOT EXISTS idx_item_unlocks_skill_item_id ON item_unlocks_skill(item_id);

-- Drops de monstruos: cada monstruo puede soltar su propio material de crafteo unico al
-- morir (items.item_type = 'MATERIAL'), con una probabilidad y cantidad fija. Ver sistema
-- de seed: la rareza y % de drop del material siguen la rareza del monstruo (COMMON/RARE/
-- MINIBOSS/LEGENDARY).
CREATE TABLE IF NOT EXISTS monster_drops (
  id SERIAL PRIMARY KEY,
  monster_id INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  drop_chance_percent NUMERIC(5,2) NOT NULL,
  min_quantity INT NOT NULL DEFAULT 1,
  max_quantity INT NOT NULL DEFAULT 1,
  UNIQUE(monster_id, item_id)
);

-- Recetas de crafteo (sistema_crafteo_gremios_completo.html): cada receta produce un item
-- (result_item_id) a partir de N ingredientes en crafting_recipe_ingredients. required_class_id
-- queda NULL cuando la receta admite mas de una clase (el detalle exacto va en description).
CREATE TABLE IF NOT EXISTS crafting_recipes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  result_item_id INT NOT NULL REFERENCES items(id),
  result_quantity INT NOT NULL DEFAULT 1,
  rarity TEXT NOT NULL CHECK (rarity IN ('COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO')),
  required_level INT,
  required_class_id INT REFERENCES classes(id),
  required_rank TEXT,
  success_rate_percent NUMERIC(5,2) NOT NULL DEFAULT 100,
  craft_time_minutes INT NOT NULL DEFAULT 1,
  artisan_name TEXT,
  zone_id INT REFERENCES monster_zones(id),
  description TEXT
);

CREATE TABLE IF NOT EXISTS crafting_recipe_ingredients (
  id SERIAL PRIMARY KEY,
  recipe_id INT NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  quantity INT NOT NULL,
  CONSTRAINT crafting_recipe_ingredients_recipe_item_unique UNIQUE (recipe_id, item_id)
);

-- Gremios de jugadores
CREATE TABLE IF NOT EXISTS guilds (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  leader_id INT NOT NULL REFERENCES players(id),
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  type VARCHAR(6) NOT NULL DEFAULT 'OPEN' CHECK (type IN ('OPEN', 'CLOSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un jugador solo puede pertenecer a un gremio a la vez (UNIQUE player_id).
CREATE TABLE IF NOT EXISTS guild_members (
  guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role VARCHAR(7) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('LEADER', 'OFFICER', 'MEMBER')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, player_id),
  UNIQUE (player_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_members_guild_id ON guild_members(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_player_id ON guild_members(player_id);

ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();

-- Solicitudes para unirse a gremios cerrados (type='CLOSED')
CREATE TABLE IF NOT EXISTS guild_join_requests (
  id SERIAL PRIMARY KEY,
  guild_id INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status VARCHAR(8) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (guild_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_guild_join_requests_guild_id ON guild_join_requests(guild_id);

CREATE INDEX IF NOT EXISTS idx_monster_drops_monster_id ON monster_drops(monster_id);
CREATE INDEX IF NOT EXISTS idx_crafting_recipe_ingredients_recipe_id ON crafting_recipe_ingredients(recipe_id);

-- Pool de NPCs disponibles para contratar (se reemplaza al hacer refresh, persiste entre sesiones).
CREATE TABLE IF NOT EXISTS player_npc_pool (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class_id INT NOT NULL REFERENCES classes(id),
  class_name TEXT NOT NULL,
  level INT NOT NULL,
  hp INT NOT NULL,
  mana INT NOT NULL,
  atk INT NOT NULL,
  def INT NOT NULL,
  mag INT NOT NULL,
  magic_def INT NOT NULL,
  spd INT NOT NULL,
  crit NUMERIC(5,2) NOT NULL,
  hire_cost INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Entidad maestra de cada NPC contratado (persiste a través de swaps bench↔party).
-- hp/max_hp se manejan igual que en players: max_hp incluye bonos de equipo; hp es el actual.
DROP TABLE IF EXISTS player_party CASCADE;
DROP TABLE IF EXISTS player_bench CASCADE;
DROP TABLE IF EXISTS npc_equipment CASCADE;
DROP TABLE IF EXISTS player_npcs CASCADE;

CREATE TABLE IF NOT EXISTS player_npcs (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  class_id INT NOT NULL REFERENCES classes(id),
  class_name TEXT NOT NULL,
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  hp INT NOT NULL,
  max_hp INT NOT NULL,
  mana INT NOT NULL,
  max_mana INT NOT NULL,
  atk INT NOT NULL,
  def INT NOT NULL,
  mag INT NOT NULL,
  magic_def INT NOT NULL,
  spd INT NOT NULL,
  crit NUMERIC(5,2) NOT NULL,
  hired_at TIMESTAMPTZ DEFAULT now()
);

-- Equipo que lleva un NPC contratado (mismos slots que el héroe).
CREATE TABLE IF NOT EXISTS npc_equipment (
  id SERIAL PRIMARY KEY,
  npc_id INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('WEAPON','OFFHAND','HELMET','ARMOR','GLOVES','BOOTS','ACCESSORY')),
  item_id INT NOT NULL REFERENCES items(id),
  UNIQUE(npc_id, slot)
);

-- NPCs contratados en reserva (máx BENCH_CAP=10; se intercambian con el grupo activo).
CREATE TABLE IF NOT EXISTS player_bench (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_id INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  UNIQUE(player_id, npc_id)
);

-- Skills asignadas directamente a un NPC (bypass de learn_level; útil para test/admin).
CREATE TABLE IF NOT EXISTS npc_skills (
  npc_id INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (npc_id, skill_id)
);

-- NPCs activos en el grupo (máx 2, slots 2 y 3; slot 1 siempre es el héroe).
CREATE TABLE IF NOT EXISTS player_party (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_id INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  slot INT NOT NULL CHECK (slot IN (2, 3)),
  UNIQUE(player_id, slot)
);

ALTER TABLE combat_participant_buffs ADD COLUMN IF NOT EXISTS is_debuff BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_participant_buffs ADD COLUMN IF NOT EXISTS skill_id INT REFERENCES skills(id);
-- Permite class_id=NULL en skills para habilidades universales (cualquier clase puede usarlas).
ALTER TABLE skills ALTER COLUMN class_id DROP NOT NULL;

-- Migración: extiende el CHECK de skill_type para incluir 'PASIVA' y convierte
-- las skills pasivas al nuevo tipo (idempotente: seguro de re-ejecutar).
DO $$ BEGIN
  ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_skill_type_check;
  ALTER TABLE skills ADD CONSTRAINT skills_skill_type_check
    CHECK (skill_type IN ('ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESTADO_ALTERADO', 'ESPECIAL', 'PASIVA'));
  UPDATE skills SET skill_type = 'PASIVA' WHERE is_passive = TRUE AND skill_type = 'BUFF';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Artesanos NPC vinculados a zonas (display y agrupación de recetas).
CREATE TABLE IF NOT EXISTS artisans (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL CHECK (specialty IN ('HERRERO','PELETERO','SASTRE','JOYERO','ALQUIMISTA','COCINERO','FUEGO','MARINO','OSCURO','SUPREMO')),
  zone_id INT REFERENCES monster_zones(id),
  description TEXT
);

-- Zonas desbloqueadas por el jugador (primera victoria en la zona).
CREATE TABLE IF NOT EXISTS player_zone_unlocks (
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  zone_id INT NOT NULL REFERENCES monster_zones(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, zone_id)
);

-- Recetas que el jugador aprendió al obtener el drop de un MINIBOSS/LEGENDARY.
CREATE TABLE IF NOT EXISTS player_learned_recipes (
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipe_id INT NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,
  learned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, recipe_id)
);

-- Qué drop de MINIBOSS enseña esta receta (NULL = acceso directo por zona).
ALTER TABLE crafting_recipes ADD COLUMN IF NOT EXISTS scroll_item_id INT REFERENCES items(id);

CREATE INDEX IF NOT EXISTS idx_player_zone_unlocks_player_id ON player_zone_unlocks(player_id);
CREATE INDEX IF NOT EXISTS idx_player_learned_recipes_player_id ON player_learned_recipes(player_id);

-- Materiales que devuelve desmantelar un ítem (un ítem puede dar varios materiales distintos).
CREATE TABLE IF NOT EXISTS dismantle_recipes (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  result_item_id INT NOT NULL REFERENCES items(id),
  result_quantity INT NOT NULL DEFAULT 1,
  UNIQUE(item_id, result_item_id)
);
CREATE INDEX IF NOT EXISTS idx_dismantle_recipes_item_id ON dismantle_recipes(item_id);

-- Sistema de suerte en crafteo: luck en jugadores, quality_tier en inventario/equipo.
-- luck default 1%: base para todos los jugadores nuevos.
ALTER TABLE players ADD COLUMN IF NOT EXISTS luck NUMERIC(5,2) NOT NULL DEFAULT 1.0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS luck NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE item_stat_bonuses ADD COLUMN IF NOT EXISTS duration_turns INT DEFAULT NULL;
ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS quality_tier SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE player_inventory DROP CONSTRAINT IF EXISTS player_inventory_unique;
ALTER TABLE player_inventory ADD CONSTRAINT player_inventory_unique UNIQUE (player_id, item_id, enchant_level, quality_tier);
ALTER TABLE player_equipment ADD COLUMN IF NOT EXISTS quality_tier SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE npc_equipment ADD COLUMN IF NOT EXISTS quality_tier SMALLINT NOT NULL DEFAULT 0;

-- Sistema social: amigos, mensajes y regalos.
CREATE TABLE IF NOT EXISTS player_friends (
  id SERIAL PRIMARY KEY,
  requester_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  addressee_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'BLOCKED')) DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_friend CHECK (requester_id != addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_friendship ON player_friends (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_friends_addressee ON player_friends(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON player_friends(requester_id);

CREATE TABLE IF NOT EXISTS player_messages (
  id SERIAL PRIMARY KEY,
  sender_id INT REFERENCES players(id) ON DELETE SET NULL,
  receiver_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  gold_amount INT NOT NULL DEFAULT 0,
  gold_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_sender BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_receiver BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 days'
);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON player_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON player_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON player_messages(expires_at);

CREATE TABLE IF NOT EXISTS player_message_items (
  id SERIAL PRIMARY KEY,
  message_id INT NOT NULL REFERENCES player_messages(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  quantity INT NOT NULL DEFAULT 1,
  enchant_level INT NOT NULL DEFAULT 0,
  quality_tier SMALLINT NOT NULL DEFAULT 0,
  claimed BOOLEAN NOT NULL DEFAULT FALSE
);

-- Sistema co-op: grupos, invitaciones y ready check.
ALTER TABLE combat_sessions    ADD COLUMN IF NOT EXISTS guest_player_id     INT REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE combat_sessions    ADD COLUMN IF NOT EXISTS guest_player_id_2   INT REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS owner_player_id     INT REFERENCES players(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS player_coop_groups (
  id          SERIAL PRIMARY KEY,
  leader_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS player_coop_group_members (
  group_id    INT NOT NULL REFERENCES player_coop_groups(id) ON DELETE CASCADE,
  player_id   INT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_coop_invites (
  id          SERIAL PRIMARY KEY,
  leader_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id    INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED')),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coop_invites_guest ON player_coop_invites(guest_id);

CREATE TABLE IF NOT EXISTS player_coop_party (
  id          SERIAL PRIMARY KEY,
  leader_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id    INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_coop_leader UNIQUE (leader_id),
  CONSTRAINT unique_coop_guest  UNIQUE (guest_id)
);

CREATE TABLE IF NOT EXISTS player_coop_ready (
  player_id   INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  zone_id     INT NOT NULL,
  ready_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS player_coop_group_messages (
  id         SERIAL PRIMARY KEY,
  group_id   INT NOT NULL REFERENCES player_coop_groups(id) ON DELETE CASCADE,
  sender_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coop_group_messages_group ON player_coop_group_messages(group_id, id);

-- Mercado de jugadores: venta player-to-player. Se guarda enchant_level y quality_tier
-- porque el inventario es granular por esos dos campos (ver player_inventory) — así el
-- comprador recibe exactamente el mismo ítem (con su suerte de crafteo) que se listó.
CREATE TABLE IF NOT EXISTS player_market_listings (
  id             SERIAL PRIMARY KEY,
  seller_id      INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id        INT NOT NULL REFERENCES items(id),
  enchant_level  INT NOT NULL DEFAULT 0,
  quality_tier   SMALLINT NOT NULL DEFAULT 0,
  quantity       INT NOT NULL CHECK (quantity > 0),
  price_per_unit BIGINT NOT NULL CHECK (price_per_unit > 0),
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SOLD', 'CANCELLED')),
  buyer_id       INT REFERENCES players(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_market_listings_active ON player_market_listings(item_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON player_market_listings(seller_id);

-- Opcional: si ejecutas con psql desde la carpeta raíz del proyecto,
-- puedes importar los datos de seed manualmente con:
-- psql -d gpr -f db/seed.sql

-- ============================================================
-- EPICO/LEGENDARIO EQUIPMENT (zonas 1-6, 5 clases) - 320 items
-- ============================================================
-- ============================================================
-- EPICO/LEGENDARIO EQUIPMENT ITEMS - Zones 1-6
-- Items 417-736 | Recipes 281-600
-- ============================================================

-- ITEMS
INSERT INTO items (id, code, name, item_type, slot, is_two_handed, rarity, class_id, required_level, is_craftable, obtain_method)
VALUES
-- ========= Z1 EPICO lv20 "del Capitán" (scroll=45) =========
-- Guerrero 417-423
(417,'GUERRERO_WEAPON_CAPITAN','Espada del Capitán','EQUIPMENT','WEAPON',false,'EPICO',1,20,true,'CRAFT'),
(418,'GUERRERO_WEAPON2H_CAPITAN','Gran Espada del Capitán','EQUIPMENT','WEAPON',true,'EPICO',1,20,true,'CRAFT'),
(419,'GUERRERO_OFFHAND_CAPITAN','Escudo del Capitán','EQUIPMENT','OFFHAND',false,'EPICO',1,20,true,'CRAFT'),
(420,'GUERRERO_HELMET_CAPITAN','Yelmo del Capitán','EQUIPMENT','HELMET',false,'EPICO',1,20,true,'CRAFT'),
(421,'GUERRERO_ARMOR_CAPITAN','Armadura del Capitán','EQUIPMENT','ARMOR',false,'EPICO',1,20,true,'CRAFT'),
(422,'GUERRERO_GLOVES_CAPITAN','Guanteletes del Capitán','EQUIPMENT','GLOVES',false,'EPICO',1,20,true,'CRAFT'),
(423,'GUERRERO_BOOTS_CAPITAN','Botas del Capitán','EQUIPMENT','BOOTS',false,'EPICO',1,20,true,'CRAFT'),
-- Mago 424-430
(424,'MAGO_WEAPON_CAPITAN','Varita del Capitán','EQUIPMENT','WEAPON',false,'EPICO',2,20,true,'CRAFT'),
(425,'MAGO_OFFHAND_ORB_CAPITAN','Orbe del Capitán','EQUIPMENT','OFFHAND',false,'EPICO',2,20,true,'CRAFT'),
(426,'MAGO_OFFHAND_CRYSTAL_CAPITAN','Cristal del Capitán','EQUIPMENT','OFFHAND',false,'EPICO',2,20,true,'CRAFT'),
(427,'MAGO_HELMET_CAPITAN','Capirote del Capitán','EQUIPMENT','HELMET',false,'EPICO',2,20,true,'CRAFT'),
(428,'MAGO_ARMOR_CAPITAN','Túnica del Capitán','EQUIPMENT','ARMOR',false,'EPICO',2,20,true,'CRAFT'),
(429,'MAGO_GLOVES_CAPITAN','Guantes del Capitán','EQUIPMENT','GLOVES',false,'EPICO',2,20,true,'CRAFT'),
(430,'MAGO_BOOTS_CAPITAN','Sandalias del Capitán','EQUIPMENT','BOOTS',false,'EPICO',2,20,true,'CRAFT'),
-- Arquero 431-436
(431,'ARQUERO_WEAPON_CAPITAN','Arco del Capitán','EQUIPMENT','WEAPON',false,'EPICO',3,20,true,'CRAFT'),
(432,'ARQUERO_OFFHAND_CAPITAN','Carcaj del Capitán','EQUIPMENT','OFFHAND',false,'EPICO',3,20,true,'CRAFT'),
(433,'ARQUERO_HELMET_CAPITAN','Capucha del Capitán','EQUIPMENT','HELMET',false,'EPICO',3,20,true,'CRAFT'),
(434,'ARQUERO_ARMOR_CAPITAN','Gabán del Capitán','EQUIPMENT','ARMOR',false,'EPICO',3,20,true,'CRAFT'),
(435,'ARQUERO_GLOVES_CAPITAN','Guantes del Capitán','EQUIPMENT','GLOVES',false,'EPICO',3,20,true,'CRAFT'),
(436,'ARQUERO_BOOTS_CAPITAN','Botas del Capitán','EQUIPMENT','BOOTS',false,'EPICO',3,20,true,'CRAFT'),
-- Pícaro 437-442
(437,'PICARO_WEAPON_CAPITAN','Daga del Capitán','EQUIPMENT','WEAPON',false,'EPICO',4,20,true,'CRAFT'),
(438,'PICARO_OFFHAND_CAPITAN','Daga Gemela del Capitán','EQUIPMENT','OFFHAND',false,'EPICO',4,20,true,'CRAFT'),
(439,'PICARO_HELMET_CAPITAN','Máscara del Capitán','EQUIPMENT','HELMET',false,'EPICO',4,20,true,'CRAFT'),
(440,'PICARO_ARMOR_CAPITAN','Cuero del Capitán','EQUIPMENT','ARMOR',false,'EPICO',4,20,true,'CRAFT'),
(441,'PICARO_GLOVES_CAPITAN','Guantes del Capitán','EQUIPMENT','GLOVES',false,'EPICO',4,20,true,'CRAFT'),
(442,'PICARO_BOOTS_CAPITAN','Botas del Capitán','EQUIPMENT','BOOTS',false,'EPICO',4,20,true,'CRAFT'),
-- Sacerdote 443-448
(443,'SACERDOTE_WEAPON_CAPITAN','Báculo del Capitán','EQUIPMENT','WEAPON',false,'EPICO',5,20,true,'CRAFT'),
(444,'SACERDOTE_OFFHAND_CAPITAN','Símbolo del Capitán','EQUIPMENT','OFFHAND',false,'EPICO',5,20,true,'CRAFT'),
(445,'SACERDOTE_HELMET_CAPITAN','Diadema del Capitán','EQUIPMENT','HELMET',false,'EPICO',5,20,true,'CRAFT'),
(446,'SACERDOTE_ARMOR_CAPITAN','Vestidura del Capitán','EQUIPMENT','ARMOR',false,'EPICO',5,20,true,'CRAFT'),
(447,'SACERDOTE_GLOVES_CAPITAN','Guantes del Capitán','EQUIPMENT','GLOVES',false,'EPICO',5,20,true,'CRAFT'),
(448,'SACERDOTE_BOOTS_CAPITAN','Sandalias del Capitán','EQUIPMENT','BOOTS',false,'EPICO',5,20,true,'CRAFT'),

-- ========= Z1 LEGENDARIO lv25 "del Titán" (scroll=46) =========
-- Guerrero 449-455
(449,'GUERRERO_WEAPON_TITAN_P','Espada del Titán','EQUIPMENT','WEAPON',false,'LEGENDARIO',1,25,true,'CRAFT'),
(450,'GUERRERO_WEAPON2H_TITAN_P','Gran Espada del Titán','EQUIPMENT','WEAPON',true,'LEGENDARIO',1,25,true,'CRAFT'),
(451,'GUERRERO_OFFHAND_TITAN_P','Escudo del Titán','EQUIPMENT','OFFHAND',false,'LEGENDARIO',1,25,true,'CRAFT'),
(452,'GUERRERO_HELMET_TITAN_P','Yelmo del Titán','EQUIPMENT','HELMET',false,'LEGENDARIO',1,25,true,'CRAFT'),
(453,'GUERRERO_ARMOR_TITAN_P','Armadura del Titán','EQUIPMENT','ARMOR',false,'LEGENDARIO',1,25,true,'CRAFT'),
(454,'GUERRERO_GLOVES_TITAN_P','Guanteletes del Titán','EQUIPMENT','GLOVES',false,'LEGENDARIO',1,25,true,'CRAFT'),
(455,'GUERRERO_BOOTS_TITAN_P','Botas del Titán','EQUIPMENT','BOOTS',false,'LEGENDARIO',1,25,true,'CRAFT'),
-- Mago 456-462
(456,'MAGO_WEAPON_TITAN_P','Varita del Titán','EQUIPMENT','WEAPON',false,'LEGENDARIO',2,25,true,'CRAFT'),
(457,'MAGO_OFFHAND_ORB_TITAN_P','Orbe del Titán','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,25,true,'CRAFT'),
(458,'MAGO_OFFHAND_CRYSTAL_TITAN_P','Cristal del Titán','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,25,true,'CRAFT'),
(459,'MAGO_HELMET_TITAN_P','Capirote del Titán','EQUIPMENT','HELMET',false,'LEGENDARIO',2,25,true,'CRAFT'),
(460,'MAGO_ARMOR_TITAN_P','Túnica del Titán','EQUIPMENT','ARMOR',false,'LEGENDARIO',2,25,true,'CRAFT'),
(461,'MAGO_GLOVES_TITAN_P','Guantes del Titán','EQUIPMENT','GLOVES',false,'LEGENDARIO',2,25,true,'CRAFT'),
(462,'MAGO_BOOTS_TITAN_P','Sandalias del Titán','EQUIPMENT','BOOTS',false,'LEGENDARIO',2,25,true,'CRAFT'),
-- Arquero 463-468
(463,'ARQUERO_WEAPON_TITAN_P','Arco del Titán','EQUIPMENT','WEAPON',false,'LEGENDARIO',3,25,true,'CRAFT'),
(464,'ARQUERO_OFFHAND_TITAN_P','Carcaj del Titán','EQUIPMENT','OFFHAND',false,'LEGENDARIO',3,25,true,'CRAFT'),
(465,'ARQUERO_HELMET_TITAN_P','Capucha del Titán','EQUIPMENT','HELMET',false,'LEGENDARIO',3,25,true,'CRAFT'),
(466,'ARQUERO_ARMOR_TITAN_P','Gabán del Titán','EQUIPMENT','ARMOR',false,'LEGENDARIO',3,25,true,'CRAFT'),
(467,'ARQUERO_GLOVES_TITAN_P','Guantes del Titán','EQUIPMENT','GLOVES',false,'LEGENDARIO',3,25,true,'CRAFT'),
(468,'ARQUERO_BOOTS_TITAN_P','Botas del Titán','EQUIPMENT','BOOTS',false,'LEGENDARIO',3,25,true,'CRAFT'),
-- Pícaro 469-474
(469,'PICARO_WEAPON_TITAN_P','Daga del Titán','EQUIPMENT','WEAPON',false,'LEGENDARIO',4,25,true,'CRAFT'),
(470,'PICARO_OFFHAND_TITAN_P','Daga Gemela del Titán','EQUIPMENT','OFFHAND',false,'LEGENDARIO',4,25,true,'CRAFT'),
(471,'PICARO_HELMET_TITAN_P','Máscara del Titán','EQUIPMENT','HELMET',false,'LEGENDARIO',4,25,true,'CRAFT'),
(472,'PICARO_ARMOR_TITAN_P','Cuero del Titán','EQUIPMENT','ARMOR',false,'LEGENDARIO',4,25,true,'CRAFT'),
(473,'PICARO_GLOVES_TITAN_P','Guantes del Titán','EQUIPMENT','GLOVES',false,'LEGENDARIO',4,25,true,'CRAFT'),
(474,'PICARO_BOOTS_TITAN_P','Botas del Titán','EQUIPMENT','BOOTS',false,'LEGENDARIO',4,25,true,'CRAFT'),
-- Sacerdote 475-480
(475,'SACERDOTE_WEAPON_TITAN_P','Báculo del Titán','EQUIPMENT','WEAPON',false,'LEGENDARIO',5,25,true,'CRAFT'),
(476,'SACERDOTE_OFFHAND_TITAN_P','Símbolo del Titán','EQUIPMENT','OFFHAND',false,'LEGENDARIO',5,25,true,'CRAFT'),
(477,'SACERDOTE_HELMET_TITAN_P','Diadema del Titán','EQUIPMENT','HELMET',false,'LEGENDARIO',5,25,true,'CRAFT'),
(478,'SACERDOTE_ARMOR_TITAN_P','Vestidura del Titán','EQUIPMENT','ARMOR',false,'LEGENDARIO',5,25,true,'CRAFT'),
(479,'SACERDOTE_GLOVES_TITAN_P','Guantes del Titán','EQUIPMENT','GLOVES',false,'LEGENDARIO',5,25,true,'CRAFT'),
(480,'SACERDOTE_BOOTS_TITAN_P','Sandalias del Titán','EQUIPMENT','BOOTS',false,'LEGENDARIO',5,25,true,'CRAFT'),

-- ========= Z2 EPICO lv30 "del Acantilado" (scroll=54) =========
-- Guerrero 481-487
(481,'GUERRERO_WEAPON_ACANT','Espada del Acantilado','EQUIPMENT','WEAPON',false,'EPICO',1,30,true,'CRAFT'),
(482,'GUERRERO_WEAPON2H_ACANT','Gran Espada del Acantilado','EQUIPMENT','WEAPON',true,'EPICO',1,30,true,'CRAFT'),
(483,'GUERRERO_OFFHAND_ACANT','Escudo del Acantilado','EQUIPMENT','OFFHAND',false,'EPICO',1,30,true,'CRAFT'),
(484,'GUERRERO_HELMET_ACANT','Yelmo del Acantilado','EQUIPMENT','HELMET',false,'EPICO',1,30,true,'CRAFT'),
(485,'GUERRERO_ARMOR_ACANT','Armadura del Acantilado','EQUIPMENT','ARMOR',false,'EPICO',1,30,true,'CRAFT'),
(486,'GUERRERO_GLOVES_ACANT','Guanteletes del Acantilado','EQUIPMENT','GLOVES',false,'EPICO',1,30,true,'CRAFT'),
(487,'GUERRERO_BOOTS_ACANT','Botas del Acantilado','EQUIPMENT','BOOTS',false,'EPICO',1,30,true,'CRAFT'),
-- Mago 488-494
(488,'MAGO_WEAPON_ACANT','Varita del Acantilado','EQUIPMENT','WEAPON',false,'EPICO',2,30,true,'CRAFT'),
(489,'MAGO_OFFHAND_ORB_ACANT','Orbe del Acantilado','EQUIPMENT','OFFHAND',false,'EPICO',2,30,true,'CRAFT'),
(490,'MAGO_OFFHAND_CRYSTAL_ACANT','Cristal del Acantilado','EQUIPMENT','OFFHAND',false,'EPICO',2,30,true,'CRAFT'),
(491,'MAGO_HELMET_ACANT','Capirote del Acantilado','EQUIPMENT','HELMET',false,'EPICO',2,30,true,'CRAFT'),
(492,'MAGO_ARMOR_ACANT','Túnica del Acantilado','EQUIPMENT','ARMOR',false,'EPICO',2,30,true,'CRAFT'),
(493,'MAGO_GLOVES_ACANT','Guantes del Acantilado','EQUIPMENT','GLOVES',false,'EPICO',2,30,true,'CRAFT'),
(494,'MAGO_BOOTS_ACANT','Sandalias del Acantilado','EQUIPMENT','BOOTS',false,'EPICO',2,30,true,'CRAFT'),
-- Arquero 495-500
(495,'ARQUERO_WEAPON_ACANT','Arco del Acantilado','EQUIPMENT','WEAPON',false,'EPICO',3,30,true,'CRAFT'),
(496,'ARQUERO_OFFHAND_ACANT','Carcaj del Acantilado','EQUIPMENT','OFFHAND',false,'EPICO',3,30,true,'CRAFT'),
(497,'ARQUERO_HELMET_ACANT','Capucha del Acantilado','EQUIPMENT','HELMET',false,'EPICO',3,30,true,'CRAFT'),
(498,'ARQUERO_ARMOR_ACANT','Gabán del Acantilado','EQUIPMENT','ARMOR',false,'EPICO',3,30,true,'CRAFT'),
(499,'ARQUERO_GLOVES_ACANT','Guantes del Acantilado','EQUIPMENT','GLOVES',false,'EPICO',3,30,true,'CRAFT'),
(500,'ARQUERO_BOOTS_ACANT','Botas del Acantilado','EQUIPMENT','BOOTS',false,'EPICO',3,30,true,'CRAFT'),
-- Pícaro 501-506
(501,'PICARO_WEAPON_ACANT','Daga del Acantilado','EQUIPMENT','WEAPON',false,'EPICO',4,30,true,'CRAFT'),
(502,'PICARO_OFFHAND_ACANT','Daga Gemela del Acantilado','EQUIPMENT','OFFHAND',false,'EPICO',4,30,true,'CRAFT'),
(503,'PICARO_HELMET_ACANT','Máscara del Acantilado','EQUIPMENT','HELMET',false,'EPICO',4,30,true,'CRAFT'),
(504,'PICARO_ARMOR_ACANT','Cuero del Acantilado','EQUIPMENT','ARMOR',false,'EPICO',4,30,true,'CRAFT'),
(505,'PICARO_GLOVES_ACANT','Guantes del Acantilado','EQUIPMENT','GLOVES',false,'EPICO',4,30,true,'CRAFT'),
(506,'PICARO_BOOTS_ACANT','Botas del Acantilado','EQUIPMENT','BOOTS',false,'EPICO',4,30,true,'CRAFT'),
-- Sacerdote 507-512
(507,'SACERDOTE_WEAPON_ACANT','Báculo del Acantilado','EQUIPMENT','WEAPON',false,'EPICO',5,30,true,'CRAFT'),
(508,'SACERDOTE_OFFHAND_ACANT','Símbolo del Acantilado','EQUIPMENT','OFFHAND',false,'EPICO',5,30,true,'CRAFT'),
(509,'SACERDOTE_HELMET_ACANT','Diadema del Acantilado','EQUIPMENT','HELMET',false,'EPICO',5,30,true,'CRAFT'),
(510,'SACERDOTE_ARMOR_ACANT','Vestidura del Acantilado','EQUIPMENT','ARMOR',false,'EPICO',5,30,true,'CRAFT'),
(511,'SACERDOTE_GLOVES_ACANT','Guantes del Acantilado','EQUIPMENT','GLOVES',false,'EPICO',5,30,true,'CRAFT'),
(512,'SACERDOTE_BOOTS_ACANT','Sandalias del Acantilado','EQUIPMENT','BOOTS',false,'EPICO',5,30,true,'CRAFT'),

-- ========= Z2 LEGENDARIO lv35 "del Rey de las Montañas" (scroll=55) =========
-- Guerrero 513-519
(513,'GUERRERO_WEAPON_REY_MONT','Espada del Rey de las Montañas','EQUIPMENT','WEAPON',false,'LEGENDARIO',1,35,true,'CRAFT'),
(514,'GUERRERO_WEAPON2H_REY_MONT','Gran Espada del Rey de las Montañas','EQUIPMENT','WEAPON',true,'LEGENDARIO',1,35,true,'CRAFT'),
(515,'GUERRERO_OFFHAND_REY_MONT','Escudo del Rey de las Montañas','EQUIPMENT','OFFHAND',false,'LEGENDARIO',1,35,true,'CRAFT'),
(516,'GUERRERO_HELMET_REY_MONT','Yelmo del Rey de las Montañas','EQUIPMENT','HELMET',false,'LEGENDARIO',1,35,true,'CRAFT'),
(517,'GUERRERO_ARMOR_REY_MONT','Armadura del Rey de las Montañas','EQUIPMENT','ARMOR',false,'LEGENDARIO',1,35,true,'CRAFT'),
(518,'GUERRERO_GLOVES_REY_MONT','Guanteletes del Rey de las Montañas','EQUIPMENT','GLOVES',false,'LEGENDARIO',1,35,true,'CRAFT'),
(519,'GUERRERO_BOOTS_REY_MONT','Botas del Rey de las Montañas','EQUIPMENT','BOOTS',false,'LEGENDARIO',1,35,true,'CRAFT'),
-- Mago 520-526
(520,'MAGO_WEAPON_REY_MONT','Varita del Rey de las Montañas','EQUIPMENT','WEAPON',false,'LEGENDARIO',2,35,true,'CRAFT'),
(521,'MAGO_OFFHAND_ORB_REY_MONT','Orbe del Rey de las Montañas','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,35,true,'CRAFT'),
(522,'MAGO_OFFHAND_CRYSTAL_REY_MONT','Cristal del Rey de las Montañas','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,35,true,'CRAFT'),
(523,'MAGO_HELMET_REY_MONT','Capirote del Rey de las Montañas','EQUIPMENT','HELMET',false,'LEGENDARIO',2,35,true,'CRAFT'),
(524,'MAGO_ARMOR_REY_MONT','Túnica del Rey de las Montañas','EQUIPMENT','ARMOR',false,'LEGENDARIO',2,35,true,'CRAFT'),
(525,'MAGO_GLOVES_REY_MONT','Guantes del Rey de las Montañas','EQUIPMENT','GLOVES',false,'LEGENDARIO',2,35,true,'CRAFT'),
(526,'MAGO_BOOTS_REY_MONT','Sandalias del Rey de las Montañas','EQUIPMENT','BOOTS',false,'LEGENDARIO',2,35,true,'CRAFT'),
-- Arquero 527-532
(527,'ARQUERO_WEAPON_REY_MONT','Arco del Rey de las Montañas','EQUIPMENT','WEAPON',false,'LEGENDARIO',3,35,true,'CRAFT'),
(528,'ARQUERO_OFFHAND_REY_MONT','Carcaj del Rey de las Montañas','EQUIPMENT','OFFHAND',false,'LEGENDARIO',3,35,true,'CRAFT'),
(529,'ARQUERO_HELMET_REY_MONT','Capucha del Rey de las Montañas','EQUIPMENT','HELMET',false,'LEGENDARIO',3,35,true,'CRAFT'),
(530,'ARQUERO_ARMOR_REY_MONT','Gabán del Rey de las Montañas','EQUIPMENT','ARMOR',false,'LEGENDARIO',3,35,true,'CRAFT'),
(531,'ARQUERO_GLOVES_REY_MONT','Guantes del Rey de las Montañas','EQUIPMENT','GLOVES',false,'LEGENDARIO',3,35,true,'CRAFT'),
(532,'ARQUERO_BOOTS_REY_MONT','Botas del Rey de las Montañas','EQUIPMENT','BOOTS',false,'LEGENDARIO',3,35,true,'CRAFT'),
-- Pícaro 533-538
(533,'PICARO_WEAPON_REY_MONT','Daga del Rey de las Montañas','EQUIPMENT','WEAPON',false,'LEGENDARIO',4,35,true,'CRAFT'),
(534,'PICARO_OFFHAND_REY_MONT','Daga Gemela del Rey de las Montañas','EQUIPMENT','OFFHAND',false,'LEGENDARIO',4,35,true,'CRAFT'),
(535,'PICARO_HELMET_REY_MONT','Máscara del Rey de las Montañas','EQUIPMENT','HELMET',false,'LEGENDARIO',4,35,true,'CRAFT'),
(536,'PICARO_ARMOR_REY_MONT','Cuero del Rey de las Montañas','EQUIPMENT','ARMOR',false,'LEGENDARIO',4,35,true,'CRAFT'),
(537,'PICARO_GLOVES_REY_MONT','Guantes del Rey de las Montañas','EQUIPMENT','GLOVES',false,'LEGENDARIO',4,35,true,'CRAFT'),
(538,'PICARO_BOOTS_REY_MONT','Botas del Rey de las Montañas','EQUIPMENT','BOOTS',false,'LEGENDARIO',4,35,true,'CRAFT'),
-- Sacerdote 539-544
(539,'SACERDOTE_WEAPON_REY_MONT','Báculo del Rey de las Montañas','EQUIPMENT','WEAPON',false,'LEGENDARIO',5,35,true,'CRAFT'),
(540,'SACERDOTE_OFFHAND_REY_MONT','Símbolo del Rey de las Montañas','EQUIPMENT','OFFHAND',false,'LEGENDARIO',5,35,true,'CRAFT'),
(541,'SACERDOTE_HELMET_REY_MONT','Diadema del Rey de las Montañas','EQUIPMENT','HELMET',false,'LEGENDARIO',5,35,true,'CRAFT'),
(542,'SACERDOTE_ARMOR_REY_MONT','Vestidura del Rey de las Montañas','EQUIPMENT','ARMOR',false,'LEGENDARIO',5,35,true,'CRAFT'),
(543,'SACERDOTE_GLOVES_REY_MONT','Guantes del Rey de las Montañas','EQUIPMENT','GLOVES',false,'LEGENDARIO',5,35,true,'CRAFT'),
(544,'SACERDOTE_BOOTS_REY_MONT','Sandalias del Rey de las Montañas','EQUIPMENT','BOOTS',false,'LEGENDARIO',5,35,true,'CRAFT'),

-- ========= Z3 EPICO lv40 "de la Caldera" (scroll=63) =========
-- Guerrero 545-551
(545,'GUERRERO_WEAPON_CALDERA','Espada de la Caldera','EQUIPMENT','WEAPON',false,'EPICO',1,40,true,'CRAFT'),
(546,'GUERRERO_WEAPON2H_CALDERA','Gran Espada de la Caldera','EQUIPMENT','WEAPON',true,'EPICO',1,40,true,'CRAFT'),
(547,'GUERRERO_OFFHAND_CALDERA','Escudo de la Caldera','EQUIPMENT','OFFHAND',false,'EPICO',1,40,true,'CRAFT'),
(548,'GUERRERO_HELMET_CALDERA','Yelmo de la Caldera','EQUIPMENT','HELMET',false,'EPICO',1,40,true,'CRAFT'),
(549,'GUERRERO_ARMOR_CALDERA','Armadura de la Caldera','EQUIPMENT','ARMOR',false,'EPICO',1,40,true,'CRAFT'),
(550,'GUERRERO_GLOVES_CALDERA','Guanteletes de la Caldera','EQUIPMENT','GLOVES',false,'EPICO',1,40,true,'CRAFT'),
(551,'GUERRERO_BOOTS_CALDERA','Botas de la Caldera','EQUIPMENT','BOOTS',false,'EPICO',1,40,true,'CRAFT'),
-- Mago 552-558
(552,'MAGO_WEAPON_CALDERA','Varita de la Caldera','EQUIPMENT','WEAPON',false,'EPICO',2,40,true,'CRAFT'),
(553,'MAGO_OFFHAND_ORB_CALDERA','Orbe de la Caldera','EQUIPMENT','OFFHAND',false,'EPICO',2,40,true,'CRAFT'),
(554,'MAGO_OFFHAND_CRYSTAL_CALDERA','Cristal de la Caldera','EQUIPMENT','OFFHAND',false,'EPICO',2,40,true,'CRAFT'),
(555,'MAGO_HELMET_CALDERA','Capirote de la Caldera','EQUIPMENT','HELMET',false,'EPICO',2,40,true,'CRAFT'),
(556,'MAGO_ARMOR_CALDERA','Túnica de la Caldera','EQUIPMENT','ARMOR',false,'EPICO',2,40,true,'CRAFT'),
(557,'MAGO_GLOVES_CALDERA','Guantes de la Caldera','EQUIPMENT','GLOVES',false,'EPICO',2,40,true,'CRAFT'),
(558,'MAGO_BOOTS_CALDERA','Sandalias de la Caldera','EQUIPMENT','BOOTS',false,'EPICO',2,40,true,'CRAFT'),
-- Arquero 559-564
(559,'ARQUERO_WEAPON_CALDERA','Arco de la Caldera','EQUIPMENT','WEAPON',false,'EPICO',3,40,true,'CRAFT'),
(560,'ARQUERO_OFFHAND_CALDERA','Carcaj de la Caldera','EQUIPMENT','OFFHAND',false,'EPICO',3,40,true,'CRAFT'),
(561,'ARQUERO_HELMET_CALDERA','Capucha de la Caldera','EQUIPMENT','HELMET',false,'EPICO',3,40,true,'CRAFT'),
(562,'ARQUERO_ARMOR_CALDERA','Gabán de la Caldera','EQUIPMENT','ARMOR',false,'EPICO',3,40,true,'CRAFT'),
(563,'ARQUERO_GLOVES_CALDERA','Guantes de la Caldera','EQUIPMENT','GLOVES',false,'EPICO',3,40,true,'CRAFT'),
(564,'ARQUERO_BOOTS_CALDERA','Botas de la Caldera','EQUIPMENT','BOOTS',false,'EPICO',3,40,true,'CRAFT'),
-- Pícaro 565-570
(565,'PICARO_WEAPON_CALDERA','Daga de la Caldera','EQUIPMENT','WEAPON',false,'EPICO',4,40,true,'CRAFT'),
(566,'PICARO_OFFHAND_CALDERA','Daga Gemela de la Caldera','EQUIPMENT','OFFHAND',false,'EPICO',4,40,true,'CRAFT'),
(567,'PICARO_HELMET_CALDERA','Máscara de la Caldera','EQUIPMENT','HELMET',false,'EPICO',4,40,true,'CRAFT'),
(568,'PICARO_ARMOR_CALDERA','Cuero de la Caldera','EQUIPMENT','ARMOR',false,'EPICO',4,40,true,'CRAFT'),
(569,'PICARO_GLOVES_CALDERA','Guantes de la Caldera','EQUIPMENT','GLOVES',false,'EPICO',4,40,true,'CRAFT'),
(570,'PICARO_BOOTS_CALDERA','Botas de la Caldera','EQUIPMENT','BOOTS',false,'EPICO',4,40,true,'CRAFT'),
-- Sacerdote 571-576
(571,'SACERDOTE_WEAPON_CALDERA','Báculo de la Caldera','EQUIPMENT','WEAPON',false,'EPICO',5,40,true,'CRAFT'),
(572,'SACERDOTE_OFFHAND_CALDERA','Símbolo de la Caldera','EQUIPMENT','OFFHAND',false,'EPICO',5,40,true,'CRAFT'),
(573,'SACERDOTE_HELMET_CALDERA','Diadema de la Caldera','EQUIPMENT','HELMET',false,'EPICO',5,40,true,'CRAFT'),
(574,'SACERDOTE_ARMOR_CALDERA','Vestidura de la Caldera','EQUIPMENT','ARMOR',false,'EPICO',5,40,true,'CRAFT'),
(575,'SACERDOTE_GLOVES_CALDERA','Guantes de la Caldera','EQUIPMENT','GLOVES',false,'EPICO',5,40,true,'CRAFT'),
(576,'SACERDOTE_BOOTS_CALDERA','Sandalias de la Caldera','EQUIPMENT','BOOTS',false,'EPICO',5,40,true,'CRAFT'),

-- ========= Z3 LEGENDARIO lv45 "del Titán de Fuego" (scroll=64) =========
-- Guerrero 577-583
(577,'GUERRERO_WEAPON_TITAN_F','Espada del Titán de Fuego','EQUIPMENT','WEAPON',false,'LEGENDARIO',1,45,true,'CRAFT'),
(578,'GUERRERO_WEAPON2H_TITAN_F','Gran Espada del Titán de Fuego','EQUIPMENT','WEAPON',true,'LEGENDARIO',1,45,true,'CRAFT'),
(579,'GUERRERO_OFFHAND_TITAN_F','Escudo del Titán de Fuego','EQUIPMENT','OFFHAND',false,'LEGENDARIO',1,45,true,'CRAFT'),
(580,'GUERRERO_HELMET_TITAN_F','Yelmo del Titán de Fuego','EQUIPMENT','HELMET',false,'LEGENDARIO',1,45,true,'CRAFT'),
(581,'GUERRERO_ARMOR_TITAN_F','Armadura del Titán de Fuego','EQUIPMENT','ARMOR',false,'LEGENDARIO',1,45,true,'CRAFT'),
(582,'GUERRERO_GLOVES_TITAN_F','Guanteletes del Titán de Fuego','EQUIPMENT','GLOVES',false,'LEGENDARIO',1,45,true,'CRAFT'),
(583,'GUERRERO_BOOTS_TITAN_F','Botas del Titán de Fuego','EQUIPMENT','BOOTS',false,'LEGENDARIO',1,45,true,'CRAFT'),
-- Mago 584-590
(584,'MAGO_WEAPON_TITAN_F','Varita del Titán de Fuego','EQUIPMENT','WEAPON',false,'LEGENDARIO',2,45,true,'CRAFT'),
(585,'MAGO_OFFHAND_ORB_TITAN_F','Orbe del Titán de Fuego','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,45,true,'CRAFT'),
(586,'MAGO_OFFHAND_CRYSTAL_TITAN_F','Cristal del Titán de Fuego','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,45,true,'CRAFT'),
(587,'MAGO_HELMET_TITAN_F','Capirote del Titán de Fuego','EQUIPMENT','HELMET',false,'LEGENDARIO',2,45,true,'CRAFT'),
(588,'MAGO_ARMOR_TITAN_F','Túnica del Titán de Fuego','EQUIPMENT','ARMOR',false,'LEGENDARIO',2,45,true,'CRAFT'),
(589,'MAGO_GLOVES_TITAN_F','Guantes del Titán de Fuego','EQUIPMENT','GLOVES',false,'LEGENDARIO',2,45,true,'CRAFT'),
(590,'MAGO_BOOTS_TITAN_F','Sandalias del Titán de Fuego','EQUIPMENT','BOOTS',false,'LEGENDARIO',2,45,true,'CRAFT'),
-- Arquero 591-596
(591,'ARQUERO_WEAPON_TITAN_F','Arco del Titán de Fuego','EQUIPMENT','WEAPON',false,'LEGENDARIO',3,45,true,'CRAFT'),
(592,'ARQUERO_OFFHAND_TITAN_F','Carcaj del Titán de Fuego','EQUIPMENT','OFFHAND',false,'LEGENDARIO',3,45,true,'CRAFT'),
(593,'ARQUERO_HELMET_TITAN_F','Capucha del Titán de Fuego','EQUIPMENT','HELMET',false,'LEGENDARIO',3,45,true,'CRAFT'),
(594,'ARQUERO_ARMOR_TITAN_F','Gabán del Titán de Fuego','EQUIPMENT','ARMOR',false,'LEGENDARIO',3,45,true,'CRAFT'),
(595,'ARQUERO_GLOVES_TITAN_F','Guantes del Titán de Fuego','EQUIPMENT','GLOVES',false,'LEGENDARIO',3,45,true,'CRAFT'),
(596,'ARQUERO_BOOTS_TITAN_F','Botas del Titán de Fuego','EQUIPMENT','BOOTS',false,'LEGENDARIO',3,45,true,'CRAFT'),
-- Pícaro 597-602
(597,'PICARO_WEAPON_TITAN_F','Daga del Titán de Fuego','EQUIPMENT','WEAPON',false,'LEGENDARIO',4,45,true,'CRAFT'),
(598,'PICARO_OFFHAND_TITAN_F','Daga Gemela del Titán de Fuego','EQUIPMENT','OFFHAND',false,'LEGENDARIO',4,45,true,'CRAFT'),
(599,'PICARO_HELMET_TITAN_F','Máscara del Titán de Fuego','EQUIPMENT','HELMET',false,'LEGENDARIO',4,45,true,'CRAFT'),
(600,'PICARO_ARMOR_TITAN_F','Cuero del Titán de Fuego','EQUIPMENT','ARMOR',false,'LEGENDARIO',4,45,true,'CRAFT'),
(601,'PICARO_GLOVES_TITAN_F','Guantes del Titán de Fuego','EQUIPMENT','GLOVES',false,'LEGENDARIO',4,45,true,'CRAFT'),
(602,'PICARO_BOOTS_TITAN_F','Botas del Titán de Fuego','EQUIPMENT','BOOTS',false,'LEGENDARIO',4,45,true,'CRAFT'),
-- Sacerdote 603-608
(603,'SACERDOTE_WEAPON_TITAN_F','Báculo del Titán de Fuego','EQUIPMENT','WEAPON',false,'LEGENDARIO',5,45,true,'CRAFT'),
(604,'SACERDOTE_OFFHAND_TITAN_F','Símbolo del Titán de Fuego','EQUIPMENT','OFFHAND',false,'LEGENDARIO',5,45,true,'CRAFT'),
(605,'SACERDOTE_HELMET_TITAN_F','Diadema del Titán de Fuego','EQUIPMENT','HELMET',false,'LEGENDARIO',5,45,true,'CRAFT'),
(606,'SACERDOTE_ARMOR_TITAN_F','Vestidura del Titán de Fuego','EQUIPMENT','ARMOR',false,'LEGENDARIO',5,45,true,'CRAFT'),
(607,'SACERDOTE_GLOVES_TITAN_F','Guantes del Titán de Fuego','EQUIPMENT','GLOVES',false,'LEGENDARIO',5,45,true,'CRAFT'),
(608,'SACERDOTE_BOOTS_TITAN_F','Sandalias del Titán de Fuego','EQUIPMENT','BOOTS',false,'LEGENDARIO',5,45,true,'CRAFT'),

-- ========= Z4 EPICO lv50 "del Océano" (scroll=72) =========
-- Guerrero 609-615
(609,'GUERRERO_WEAPON_OCEANO','Espada del Océano','EQUIPMENT','WEAPON',false,'EPICO',1,50,true,'CRAFT'),
(610,'GUERRERO_WEAPON2H_OCEANO','Gran Espada del Océano','EQUIPMENT','WEAPON',true,'EPICO',1,50,true,'CRAFT'),
(611,'GUERRERO_OFFHAND_OCEANO','Escudo del Océano','EQUIPMENT','OFFHAND',false,'EPICO',1,50,true,'CRAFT'),
(612,'GUERRERO_HELMET_OCEANO','Yelmo del Océano','EQUIPMENT','HELMET',false,'EPICO',1,50,true,'CRAFT'),
(613,'GUERRERO_ARMOR_OCEANO','Armadura del Océano','EQUIPMENT','ARMOR',false,'EPICO',1,50,true,'CRAFT'),
(614,'GUERRERO_GLOVES_OCEANO','Guanteletes del Océano','EQUIPMENT','GLOVES',false,'EPICO',1,50,true,'CRAFT'),
(615,'GUERRERO_BOOTS_OCEANO','Botas del Océano','EQUIPMENT','BOOTS',false,'EPICO',1,50,true,'CRAFT'),
-- Mago 616-622
(616,'MAGO_WEAPON_OCEANO','Varita del Océano','EQUIPMENT','WEAPON',false,'EPICO',2,50,true,'CRAFT'),
(617,'MAGO_OFFHAND_ORB_OCEANO','Orbe del Océano','EQUIPMENT','OFFHAND',false,'EPICO',2,50,true,'CRAFT'),
(618,'MAGO_OFFHAND_CRYSTAL_OCEANO','Cristal del Océano','EQUIPMENT','OFFHAND',false,'EPICO',2,50,true,'CRAFT'),
(619,'MAGO_HELMET_OCEANO','Capirote del Océano','EQUIPMENT','HELMET',false,'EPICO',2,50,true,'CRAFT'),
(620,'MAGO_ARMOR_OCEANO','Túnica del Océano','EQUIPMENT','ARMOR',false,'EPICO',2,50,true,'CRAFT'),
(621,'MAGO_GLOVES_OCEANO','Guantes del Océano','EQUIPMENT','GLOVES',false,'EPICO',2,50,true,'CRAFT'),
(622,'MAGO_BOOTS_OCEANO','Sandalias del Océano','EQUIPMENT','BOOTS',false,'EPICO',2,50,true,'CRAFT'),
-- Arquero 623-628
(623,'ARQUERO_WEAPON_OCEANO','Arco del Océano','EQUIPMENT','WEAPON',false,'EPICO',3,50,true,'CRAFT'),
(624,'ARQUERO_OFFHAND_OCEANO','Carcaj del Océano','EQUIPMENT','OFFHAND',false,'EPICO',3,50,true,'CRAFT'),
(625,'ARQUERO_HELMET_OCEANO','Capucha del Océano','EQUIPMENT','HELMET',false,'EPICO',3,50,true,'CRAFT'),
(626,'ARQUERO_ARMOR_OCEANO','Gabán del Océano','EQUIPMENT','ARMOR',false,'EPICO',3,50,true,'CRAFT'),
(627,'ARQUERO_GLOVES_OCEANO','Guantes del Océano','EQUIPMENT','GLOVES',false,'EPICO',3,50,true,'CRAFT'),
(628,'ARQUERO_BOOTS_OCEANO','Botas del Océano','EQUIPMENT','BOOTS',false,'EPICO',3,50,true,'CRAFT'),
-- Pícaro 629-634
(629,'PICARO_WEAPON_OCEANO','Daga del Océano','EQUIPMENT','WEAPON',false,'EPICO',4,50,true,'CRAFT'),
(630,'PICARO_OFFHAND_OCEANO','Daga Gemela del Océano','EQUIPMENT','OFFHAND',false,'EPICO',4,50,true,'CRAFT'),
(631,'PICARO_HELMET_OCEANO','Máscara del Océano','EQUIPMENT','HELMET',false,'EPICO',4,50,true,'CRAFT'),
(632,'PICARO_ARMOR_OCEANO','Cuero del Océano','EQUIPMENT','ARMOR',false,'EPICO',4,50,true,'CRAFT'),
(633,'PICARO_GLOVES_OCEANO','Guantes del Océano','EQUIPMENT','GLOVES',false,'EPICO',4,50,true,'CRAFT'),
(634,'PICARO_BOOTS_OCEANO','Botas del Océano','EQUIPMENT','BOOTS',false,'EPICO',4,50,true,'CRAFT'),
-- Sacerdote 635-640
(635,'SACERDOTE_WEAPON_OCEANO','Báculo del Océano','EQUIPMENT','WEAPON',false,'EPICO',5,50,true,'CRAFT'),
(636,'SACERDOTE_OFFHAND_OCEANO','Símbolo del Océano','EQUIPMENT','OFFHAND',false,'EPICO',5,50,true,'CRAFT'),
(637,'SACERDOTE_HELMET_OCEANO','Diadema del Océano','EQUIPMENT','HELMET',false,'EPICO',5,50,true,'CRAFT'),
(638,'SACERDOTE_ARMOR_OCEANO','Vestidura del Océano','EQUIPMENT','ARMOR',false,'EPICO',5,50,true,'CRAFT'),
(639,'SACERDOTE_GLOVES_OCEANO','Guantes del Océano','EQUIPMENT','GLOVES',false,'EPICO',5,50,true,'CRAFT'),
(640,'SACERDOTE_BOOTS_OCEANO','Sandalias del Océano','EQUIPMENT','BOOTS',false,'EPICO',5,50,true,'CRAFT'),

-- ========= Z4 LEGENDARIO lv55 "de las Profundidades" (scroll=73) =========
-- Guerrero 641-647
(641,'GUERRERO_WEAPON_PROFU','Espada de las Profundidades','EQUIPMENT','WEAPON',false,'LEGENDARIO',1,55,true,'CRAFT'),
(642,'GUERRERO_WEAPON2H_PROFU','Gran Espada de las Profundidades','EQUIPMENT','WEAPON',true,'LEGENDARIO',1,55,true,'CRAFT'),
(643,'GUERRERO_OFFHAND_PROFU','Escudo de las Profundidades','EQUIPMENT','OFFHAND',false,'LEGENDARIO',1,55,true,'CRAFT'),
(644,'GUERRERO_HELMET_PROFU','Yelmo de las Profundidades','EQUIPMENT','HELMET',false,'LEGENDARIO',1,55,true,'CRAFT'),
(645,'GUERRERO_ARMOR_PROFU','Armadura de las Profundidades','EQUIPMENT','ARMOR',false,'LEGENDARIO',1,55,true,'CRAFT'),
(646,'GUERRERO_GLOVES_PROFU','Guanteletes de las Profundidades','EQUIPMENT','GLOVES',false,'LEGENDARIO',1,55,true,'CRAFT'),
(647,'GUERRERO_BOOTS_PROFU','Botas de las Profundidades','EQUIPMENT','BOOTS',false,'LEGENDARIO',1,55,true,'CRAFT'),
-- Mago 648-654
(648,'MAGO_WEAPON_PROFU','Varita de las Profundidades','EQUIPMENT','WEAPON',false,'LEGENDARIO',2,55,true,'CRAFT'),
(649,'MAGO_OFFHAND_ORB_PROFU','Orbe de las Profundidades','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,55,true,'CRAFT'),
(650,'MAGO_OFFHAND_CRYSTAL_PROFU','Cristal de las Profundidades','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,55,true,'CRAFT'),
(651,'MAGO_HELMET_PROFU','Capirote de las Profundidades','EQUIPMENT','HELMET',false,'LEGENDARIO',2,55,true,'CRAFT'),
(652,'MAGO_ARMOR_PROFU','Túnica de las Profundidades','EQUIPMENT','ARMOR',false,'LEGENDARIO',2,55,true,'CRAFT'),
(653,'MAGO_GLOVES_PROFU','Guantes de las Profundidades','EQUIPMENT','GLOVES',false,'LEGENDARIO',2,55,true,'CRAFT'),
(654,'MAGO_BOOTS_PROFU','Sandalias de las Profundidades','EQUIPMENT','BOOTS',false,'LEGENDARIO',2,55,true,'CRAFT'),
-- Arquero 655-660
(655,'ARQUERO_WEAPON_PROFU','Arco de las Profundidades','EQUIPMENT','WEAPON',false,'LEGENDARIO',3,55,true,'CRAFT'),
(656,'ARQUERO_OFFHAND_PROFU','Carcaj de las Profundidades','EQUIPMENT','OFFHAND',false,'LEGENDARIO',3,55,true,'CRAFT'),
(657,'ARQUERO_HELMET_PROFU','Capucha de las Profundidades','EQUIPMENT','HELMET',false,'LEGENDARIO',3,55,true,'CRAFT'),
(658,'ARQUERO_ARMOR_PROFU','Gabán de las Profundidades','EQUIPMENT','ARMOR',false,'LEGENDARIO',3,55,true,'CRAFT'),
(659,'ARQUERO_GLOVES_PROFU','Guantes de las Profundidades','EQUIPMENT','GLOVES',false,'LEGENDARIO',3,55,true,'CRAFT'),
(660,'ARQUERO_BOOTS_PROFU','Botas de las Profundidades','EQUIPMENT','BOOTS',false,'LEGENDARIO',3,55,true,'CRAFT'),
-- Pícaro 661-666
(661,'PICARO_WEAPON_PROFU','Daga de las Profundidades','EQUIPMENT','WEAPON',false,'LEGENDARIO',4,55,true,'CRAFT'),
(662,'PICARO_OFFHAND_PROFU','Daga Gemela de las Profundidades','EQUIPMENT','OFFHAND',false,'LEGENDARIO',4,55,true,'CRAFT'),
(663,'PICARO_HELMET_PROFU','Máscara de las Profundidades','EQUIPMENT','HELMET',false,'LEGENDARIO',4,55,true,'CRAFT'),
(664,'PICARO_ARMOR_PROFU','Cuero de las Profundidades','EQUIPMENT','ARMOR',false,'LEGENDARIO',4,55,true,'CRAFT'),
(665,'PICARO_GLOVES_PROFU','Guantes de las Profundidades','EQUIPMENT','GLOVES',false,'LEGENDARIO',4,55,true,'CRAFT'),
(666,'PICARO_BOOTS_PROFU','Botas de las Profundidades','EQUIPMENT','BOOTS',false,'LEGENDARIO',4,55,true,'CRAFT'),
-- Sacerdote 667-672
(667,'SACERDOTE_WEAPON_PROFU','Báculo de las Profundidades','EQUIPMENT','WEAPON',false,'LEGENDARIO',5,55,true,'CRAFT'),
(668,'SACERDOTE_OFFHAND_PROFU','Símbolo de las Profundidades','EQUIPMENT','OFFHAND',false,'LEGENDARIO',5,55,true,'CRAFT'),
(669,'SACERDOTE_HELMET_PROFU','Diadema de las Profundidades','EQUIPMENT','HELMET',false,'LEGENDARIO',5,55,true,'CRAFT'),
(670,'SACERDOTE_ARMOR_PROFU','Vestidura de las Profundidades','EQUIPMENT','ARMOR',false,'LEGENDARIO',5,55,true,'CRAFT'),
(671,'SACERDOTE_GLOVES_PROFU','Guantes de las Profundidades','EQUIPMENT','GLOVES',false,'LEGENDARIO',5,55,true,'CRAFT'),
(672,'SACERDOTE_BOOTS_PROFU','Sandalias de las Profundidades','EQUIPMENT','BOOTS',false,'LEGENDARIO',5,55,true,'CRAFT'),

-- ========= Z5 LEGENDARIO lv70 "del Rey del Hielo" (scroll=82) =========
-- Guerrero 673-679
(673,'GUERRERO_WEAPON_REY_HIELO','Espada del Rey del Hielo','EQUIPMENT','WEAPON',false,'LEGENDARIO',1,70,true,'CRAFT'),
(674,'GUERRERO_WEAPON2H_REY_HIELO','Gran Espada del Rey del Hielo','EQUIPMENT','WEAPON',true,'LEGENDARIO',1,70,true,'CRAFT'),
(675,'GUERRERO_OFFHAND_REY_HIELO','Escudo del Rey del Hielo','EQUIPMENT','OFFHAND',false,'LEGENDARIO',1,70,true,'CRAFT'),
(676,'GUERRERO_HELMET_REY_HIELO','Yelmo del Rey del Hielo','EQUIPMENT','HELMET',false,'LEGENDARIO',1,70,true,'CRAFT'),
(677,'GUERRERO_ARMOR_REY_HIELO','Armadura del Rey del Hielo','EQUIPMENT','ARMOR',false,'LEGENDARIO',1,70,true,'CRAFT'),
(678,'GUERRERO_GLOVES_REY_HIELO','Guanteletes del Rey del Hielo','EQUIPMENT','GLOVES',false,'LEGENDARIO',1,70,true,'CRAFT'),
(679,'GUERRERO_BOOTS_REY_HIELO','Botas del Rey del Hielo','EQUIPMENT','BOOTS',false,'LEGENDARIO',1,70,true,'CRAFT'),
-- Mago 680-686
(680,'MAGO_WEAPON_REY_HIELO','Varita del Rey del Hielo','EQUIPMENT','WEAPON',false,'LEGENDARIO',2,70,true,'CRAFT'),
(681,'MAGO_OFFHAND_ORB_REY_HIELO','Orbe del Rey del Hielo','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,70,true,'CRAFT'),
(682,'MAGO_OFFHAND_CRYSTAL_REY_HIELO','Cristal del Rey del Hielo','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,70,true,'CRAFT'),
(683,'MAGO_HELMET_REY_HIELO','Capirote del Rey del Hielo','EQUIPMENT','HELMET',false,'LEGENDARIO',2,70,true,'CRAFT'),
(684,'MAGO_ARMOR_REY_HIELO','Túnica del Rey del Hielo','EQUIPMENT','ARMOR',false,'LEGENDARIO',2,70,true,'CRAFT'),
(685,'MAGO_GLOVES_REY_HIELO','Guantes del Rey del Hielo','EQUIPMENT','GLOVES',false,'LEGENDARIO',2,70,true,'CRAFT'),
(686,'MAGO_BOOTS_REY_HIELO','Sandalias del Rey del Hielo','EQUIPMENT','BOOTS',false,'LEGENDARIO',2,70,true,'CRAFT'),
-- Arquero 687-692
(687,'ARQUERO_WEAPON_REY_HIELO','Arco del Rey del Hielo','EQUIPMENT','WEAPON',false,'LEGENDARIO',3,70,true,'CRAFT'),
(688,'ARQUERO_OFFHAND_REY_HIELO','Carcaj del Rey del Hielo','EQUIPMENT','OFFHAND',false,'LEGENDARIO',3,70,true,'CRAFT'),
(689,'ARQUERO_HELMET_REY_HIELO','Capucha del Rey del Hielo','EQUIPMENT','HELMET',false,'LEGENDARIO',3,70,true,'CRAFT'),
(690,'ARQUERO_ARMOR_REY_HIELO','Gabán del Rey del Hielo','EQUIPMENT','ARMOR',false,'LEGENDARIO',3,70,true,'CRAFT'),
(691,'ARQUERO_GLOVES_REY_HIELO','Guantes del Rey del Hielo','EQUIPMENT','GLOVES',false,'LEGENDARIO',3,70,true,'CRAFT'),
(692,'ARQUERO_BOOTS_REY_HIELO','Botas del Rey del Hielo','EQUIPMENT','BOOTS',false,'LEGENDARIO',3,70,true,'CRAFT'),
-- Pícaro 693-698
(693,'PICARO_WEAPON_REY_HIELO','Daga del Rey del Hielo','EQUIPMENT','WEAPON',false,'LEGENDARIO',4,70,true,'CRAFT'),
(694,'PICARO_OFFHAND_REY_HIELO','Daga Gemela del Rey del Hielo','EQUIPMENT','OFFHAND',false,'LEGENDARIO',4,70,true,'CRAFT'),
(695,'PICARO_HELMET_REY_HIELO','Máscara del Rey del Hielo','EQUIPMENT','HELMET',false,'LEGENDARIO',4,70,true,'CRAFT'),
(696,'PICARO_ARMOR_REY_HIELO','Cuero del Rey del Hielo','EQUIPMENT','ARMOR',false,'LEGENDARIO',4,70,true,'CRAFT'),
(697,'PICARO_GLOVES_REY_HIELO','Guantes del Rey del Hielo','EQUIPMENT','GLOVES',false,'LEGENDARIO',4,70,true,'CRAFT'),
(698,'PICARO_BOOTS_REY_HIELO','Botas del Rey del Hielo','EQUIPMENT','BOOTS',false,'LEGENDARIO',4,70,true,'CRAFT'),
-- Sacerdote 699-704
(699,'SACERDOTE_WEAPON_REY_HIELO','Báculo del Rey del Hielo','EQUIPMENT','WEAPON',false,'LEGENDARIO',5,70,true,'CRAFT'),
(700,'SACERDOTE_OFFHAND_REY_HIELO','Símbolo del Rey del Hielo','EQUIPMENT','OFFHAND',false,'LEGENDARIO',5,70,true,'CRAFT'),
(701,'SACERDOTE_HELMET_REY_HIELO','Diadema del Rey del Hielo','EQUIPMENT','HELMET',false,'LEGENDARIO',5,70,true,'CRAFT'),
(702,'SACERDOTE_ARMOR_REY_HIELO','Vestidura del Rey del Hielo','EQUIPMENT','ARMOR',false,'LEGENDARIO',5,70,true,'CRAFT'),
(703,'SACERDOTE_GLOVES_REY_HIELO','Guantes del Rey del Hielo','EQUIPMENT','GLOVES',false,'LEGENDARIO',5,70,true,'CRAFT'),
(704,'SACERDOTE_BOOTS_REY_HIELO','Sandalias del Rey del Hielo','EQUIPMENT','BOOTS',false,'LEGENDARIO',5,70,true,'CRAFT'),

-- ========= Z6 LEGENDARIO lv80 "del Lich" (scroll=91) =========
-- Guerrero 705-711
(705,'GUERRERO_WEAPON_LICH','Espada del Lich','EQUIPMENT','WEAPON',false,'LEGENDARIO',1,80,true,'CRAFT'),
(706,'GUERRERO_WEAPON2H_LICH','Gran Espada del Lich','EQUIPMENT','WEAPON',true,'LEGENDARIO',1,80,true,'CRAFT'),
(707,'GUERRERO_OFFHAND_LICH','Escudo del Lich','EQUIPMENT','OFFHAND',false,'LEGENDARIO',1,80,true,'CRAFT'),
(708,'GUERRERO_HELMET_LICH','Yelmo del Lich','EQUIPMENT','HELMET',false,'LEGENDARIO',1,80,true,'CRAFT'),
(709,'GUERRERO_ARMOR_LICH','Armadura del Lich','EQUIPMENT','ARMOR',false,'LEGENDARIO',1,80,true,'CRAFT'),
(710,'GUERRERO_GLOVES_LICH','Guanteletes del Lich','EQUIPMENT','GLOVES',false,'LEGENDARIO',1,80,true,'CRAFT'),
(711,'GUERRERO_BOOTS_LICH','Botas del Lich','EQUIPMENT','BOOTS',false,'LEGENDARIO',1,80,true,'CRAFT'),
-- Mago 712-718
(712,'MAGO_WEAPON_LICH','Varita del Lich','EQUIPMENT','WEAPON',false,'LEGENDARIO',2,80,true,'CRAFT'),
(713,'MAGO_OFFHAND_ORB_LICH','Orbe del Lich','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,80,true,'CRAFT'),
(714,'MAGO_OFFHAND_CRYSTAL_LICH','Cristal del Lich','EQUIPMENT','OFFHAND',false,'LEGENDARIO',2,80,true,'CRAFT'),
(715,'MAGO_HELMET_LICH','Capirote del Lich','EQUIPMENT','HELMET',false,'LEGENDARIO',2,80,true,'CRAFT'),
(716,'MAGO_ARMOR_LICH','Túnica del Lich','EQUIPMENT','ARMOR',false,'LEGENDARIO',2,80,true,'CRAFT'),
(717,'MAGO_GLOVES_LICH','Guantes del Lich','EQUIPMENT','GLOVES',false,'LEGENDARIO',2,80,true,'CRAFT'),
(718,'MAGO_BOOTS_LICH','Sandalias del Lich','EQUIPMENT','BOOTS',false,'LEGENDARIO',2,80,true,'CRAFT'),
-- Arquero 719-724
(719,'ARQUERO_WEAPON_LICH','Arco del Lich','EQUIPMENT','WEAPON',false,'LEGENDARIO',3,80,true,'CRAFT'),
(720,'ARQUERO_OFFHAND_LICH','Carcaj del Lich','EQUIPMENT','OFFHAND',false,'LEGENDARIO',3,80,true,'CRAFT'),
(721,'ARQUERO_HELMET_LICH','Capucha del Lich','EQUIPMENT','HELMET',false,'LEGENDARIO',3,80,true,'CRAFT'),
(722,'ARQUERO_ARMOR_LICH','Gabán del Lich','EQUIPMENT','ARMOR',false,'LEGENDARIO',3,80,true,'CRAFT'),
(723,'ARQUERO_GLOVES_LICH','Guantes del Lich','EQUIPMENT','GLOVES',false,'LEGENDARIO',3,80,true,'CRAFT'),
(724,'ARQUERO_BOOTS_LICH','Botas del Lich','EQUIPMENT','BOOTS',false,'LEGENDARIO',3,80,true,'CRAFT'),
-- Pícaro 725-730
(725,'PICARO_WEAPON_LICH','Daga del Lich','EQUIPMENT','WEAPON',false,'LEGENDARIO',4,80,true,'CRAFT'),
(726,'PICARO_OFFHAND_LICH','Daga Gemela del Lich','EQUIPMENT','OFFHAND',false,'LEGENDARIO',4,80,true,'CRAFT'),
(727,'PICARO_HELMET_LICH','Máscara del Lich','EQUIPMENT','HELMET',false,'LEGENDARIO',4,80,true,'CRAFT'),
(728,'PICARO_ARMOR_LICH','Cuero del Lich','EQUIPMENT','ARMOR',false,'LEGENDARIO',4,80,true,'CRAFT'),
(729,'PICARO_GLOVES_LICH','Guantes del Lich','EQUIPMENT','GLOVES',false,'LEGENDARIO',4,80,true,'CRAFT'),
(730,'PICARO_BOOTS_LICH','Botas del Lich','EQUIPMENT','BOOTS',false,'LEGENDARIO',4,80,true,'CRAFT'),
-- Sacerdote 731-736
(731,'SACERDOTE_WEAPON_LICH','Báculo del Lich','EQUIPMENT','WEAPON',false,'LEGENDARIO',5,80,true,'CRAFT'),
(732,'SACERDOTE_OFFHAND_LICH','Símbolo del Lich','EQUIPMENT','OFFHAND',false,'LEGENDARIO',5,80,true,'CRAFT'),
(733,'SACERDOTE_HELMET_LICH','Diadema del Lich','EQUIPMENT','HELMET',false,'LEGENDARIO',5,80,true,'CRAFT'),
(734,'SACERDOTE_ARMOR_LICH','Vestidura del Lich','EQUIPMENT','ARMOR',false,'LEGENDARIO',5,80,true,'CRAFT'),
(735,'SACERDOTE_GLOVES_LICH','Guantes del Lich','EQUIPMENT','GLOVES',false,'LEGENDARIO',5,80,true,'CRAFT'),
(736,'SACERDOTE_BOOTS_LICH','Sandalias del Lich','EQUIPMENT','BOOTS',false,'LEGENDARIO',5,80,true,'CRAFT');

SELECT setval('items_id_seq', 736);

-- ============================================================
-- ITEM STAT BONUSES for items 417-736
-- ============================================================
INSERT INTO item_stat_bonuses (item_id, stat_code, amount, is_percent) VALUES
-- ===== Z1 EPICO lv20 "del Capitán" =====
-- Guerrero
(417,'ATK',45,false),(417,'CRIT_CHANCE',11,true),
(418,'ATK',95,false),
(419,'DEF',15,false),(419,'HP',19,false),
(420,'DEF',19,false),(420,'HP',18,false),(420,'MAGIC_DEF',6,false),
(421,'DEF',30,false),(421,'HP',47,false),(421,'MAGIC_DEF',9,false),
(422,'ATK',25,false),(422,'CRIT_CHANCE',11,true),
(423,'SPD',35,false),(423,'HP',9,false),(423,'DEF',11,false),(423,'EVASION',5,true),
-- Mago
(424,'MAG',48,false),(424,'CRIT_CHANCE',13,true),
(425,'MAG',20,false),(425,'SPD',16,false),
(426,'MAG',27,false),(426,'CRIT_CHANCE',13,true),
(427,'DEF',7,false),(427,'HP',18,false),(427,'MAGIC_DEF',25,false),
(428,'DEF',11,false),(428,'HP',65,false),(428,'MAGIC_DEF',36,false),
(429,'MAG',26,false),(429,'CRIT_CHANCE',13,true),
(430,'SPD',35,false),(430,'HP',9,false),(430,'MAGIC_DEF',15,false),(430,'EVASION',5,true),
-- Arquero
(431,'ATK',37,false),(431,'CRIT_CHANCE',21,true),
(432,'ATK',16,false),(432,'SPD',16,false),
(433,'DEF',23,false),(433,'HP',18,false),(433,'MAGIC_DEF',8,false),
(434,'DEF',37,false),(434,'HP',65,false),(434,'MAGIC_DEF',11,false),
(435,'ATK',20,false),(435,'CRIT_CHANCE',21,true),
(436,'SPD',35,false),(436,'HP',9,false),(436,'DEF',14,false),(436,'EVASION',5,true),
-- Pícaro
(437,'ATK',37,false),(437,'CRIT_CHANCE',24,true),
(438,'ATK',16,false),(438,'SPD',16,false),
(439,'DEF',21,false),(439,'HP',18,false),(439,'MAGIC_DEF',7,false),
(440,'DEF',34,false),(440,'HP',65,false),(440,'MAGIC_DEF',10,false),
(441,'ATK',20,false),(441,'CRIT_CHANCE',24,true),
(442,'SPD',35,false),(442,'HP',9,false),(442,'DEF',14,false),(442,'EVASION',5,true),
-- Sacerdote
(443,'MAG',54,false),(443,'CRIT_CHANCE',9,true),
(444,'HP',21,false),(444,'MAGIC_DEF',16,false),
(445,'DEF',6,false),(445,'HP',18,false),(445,'MAGIC_DEF',21,false),
(446,'DEF',9,false),(446,'HP',47,false),(446,'MAGIC_DEF',29,false),
(447,'MAG',30,false),(447,'CRIT_CHANCE',10,true),
(448,'SPD',35,false),(448,'HP',9,false),(448,'MAGIC_DEF',11,false),(448,'EVASION',5,true),

-- ===== Z1 LEGENDARIO lv25 "del Titán" (×1.15) =====
-- Guerrero
(449,'ATK',52,false),(449,'CRIT_CHANCE',13,true),
(450,'ATK',109,false),
(451,'DEF',17,false),(451,'HP',22,false),
(452,'DEF',22,false),(452,'HP',21,false),(452,'MAGIC_DEF',7,false),
(453,'DEF',35,false),(453,'HP',54,false),(453,'MAGIC_DEF',10,false),
(454,'ATK',29,false),(454,'CRIT_CHANCE',13,true),
(455,'SPD',40,false),(455,'HP',10,false),(455,'DEF',13,false),(455,'EVASION',6,true),
-- Mago
(456,'MAG',55,false),(456,'CRIT_CHANCE',15,true),
(457,'MAG',23,false),(457,'SPD',18,false),
(458,'MAG',31,false),(458,'CRIT_CHANCE',15,true),
(459,'DEF',8,false),(459,'HP',21,false),(459,'MAGIC_DEF',29,false),
(460,'DEF',13,false),(460,'HP',75,false),(460,'MAGIC_DEF',41,false),
(461,'MAG',30,false),(461,'CRIT_CHANCE',15,true),
(462,'SPD',40,false),(462,'HP',10,false),(462,'MAGIC_DEF',17,false),(462,'EVASION',6,true),
-- Arquero
(463,'ATK',43,false),(463,'CRIT_CHANCE',24,true),
(464,'ATK',18,false),(464,'SPD',18,false),
(465,'DEF',26,false),(465,'HP',21,false),(465,'MAGIC_DEF',9,false),
(466,'DEF',43,false),(466,'HP',75,false),(466,'MAGIC_DEF',13,false),
(467,'ATK',23,false),(467,'CRIT_CHANCE',24,true),
(468,'SPD',40,false),(468,'HP',10,false),(468,'DEF',16,false),(468,'EVASION',6,true),
-- Pícaro
(469,'ATK',43,false),(469,'CRIT_CHANCE',28,true),
(470,'ATK',18,false),(470,'SPD',18,false),
(471,'DEF',24,false),(471,'HP',21,false),(471,'MAGIC_DEF',8,false),
(472,'DEF',39,false),(472,'HP',75,false),(472,'MAGIC_DEF',12,false),
(473,'ATK',23,false),(473,'CRIT_CHANCE',28,true),
(474,'SPD',40,false),(474,'HP',10,false),(474,'DEF',16,false),(474,'EVASION',6,true),
-- Sacerdote
(475,'MAG',62,false),(475,'CRIT_CHANCE',10,true),
(476,'HP',24,false),(476,'MAGIC_DEF',18,false),
(477,'DEF',7,false),(477,'HP',21,false),(477,'MAGIC_DEF',24,false),
(478,'DEF',10,false),(478,'HP',54,false),(478,'MAGIC_DEF',33,false),
(479,'MAG',35,false),(479,'CRIT_CHANCE',12,true),
(480,'SPD',40,false),(480,'HP',10,false),(480,'MAGIC_DEF',13,false),(480,'EVASION',6,true),

-- ===== Z2 EPICO lv30 "del Acantilado" (×1.25) =====
-- Guerrero
(481,'ATK',56,false),(481,'CRIT_CHANCE',14,true),
(482,'ATK',119,false),
(483,'DEF',19,false),(483,'HP',24,false),
(484,'DEF',24,false),(484,'HP',23,false),(484,'MAGIC_DEF',8,false),
(485,'DEF',38,false),(485,'HP',59,false),(485,'MAGIC_DEF',11,false),
(486,'ATK',31,false),(486,'CRIT_CHANCE',14,true),
(487,'SPD',44,false),(487,'HP',11,false),(487,'DEF',14,false),(487,'EVASION',6,true),
-- Mago
(488,'MAG',60,false),(488,'CRIT_CHANCE',16,true),
(489,'MAG',25,false),(489,'SPD',20,false),
(490,'MAG',34,false),(490,'CRIT_CHANCE',16,true),
(491,'DEF',9,false),(491,'HP',23,false),(491,'MAGIC_DEF',31,false),
(492,'DEF',14,false),(492,'HP',81,false),(492,'MAGIC_DEF',45,false),
(493,'MAG',33,false),(493,'CRIT_CHANCE',16,true),
(494,'SPD',44,false),(494,'HP',11,false),(494,'MAGIC_DEF',19,false),(494,'EVASION',6,true),
-- Arquero
(495,'ATK',46,false),(495,'CRIT_CHANCE',26,true),
(496,'ATK',20,false),(496,'SPD',20,false),
(497,'DEF',29,false),(497,'HP',23,false),(497,'MAGIC_DEF',10,false),
(498,'DEF',46,false),(498,'HP',81,false),(498,'MAGIC_DEF',14,false),
(499,'ATK',25,false),(499,'CRIT_CHANCE',26,true),
(500,'SPD',44,false),(500,'HP',11,false),(500,'DEF',18,false),(500,'EVASION',6,true),
-- Pícaro
(501,'ATK',46,false),(501,'CRIT_CHANCE',30,true),
(502,'ATK',20,false),(502,'SPD',20,false),
(503,'DEF',26,false),(503,'HP',23,false),(503,'MAGIC_DEF',9,false),
(504,'DEF',43,false),(504,'HP',81,false),(504,'MAGIC_DEF',13,false),
(505,'ATK',25,false),(505,'CRIT_CHANCE',30,true),
(506,'SPD',44,false),(506,'HP',11,false),(506,'DEF',18,false),(506,'EVASION',6,true),
-- Sacerdote
(507,'MAG',68,false),(507,'CRIT_CHANCE',11,true),
(508,'HP',26,false),(508,'MAGIC_DEF',20,false),
(509,'DEF',8,false),(509,'HP',23,false),(509,'MAGIC_DEF',26,false),
(510,'DEF',11,false),(510,'HP',59,false),(510,'MAGIC_DEF',36,false),
(511,'MAG',38,false),(511,'CRIT_CHANCE',13,true),
(512,'SPD',44,false),(512,'HP',11,false),(512,'MAGIC_DEF',14,false),(512,'EVASION',6,true),

-- ===== Z2 LEGENDARIO lv35 "del Rey de las Montañas" (×1.4375) =====
-- Guerrero
(513,'ATK',65,false),(513,'CRIT_CHANCE',16,true),
(514,'ATK',137,false),
(515,'DEF',22,false),(515,'HP',27,false),
(516,'DEF',27,false),(516,'HP',26,false),(516,'MAGIC_DEF',9,false),
(517,'DEF',43,false),(517,'HP',68,false),(517,'MAGIC_DEF',13,false),
(518,'ATK',36,false),(518,'CRIT_CHANCE',16,true),
(519,'SPD',50,false),(519,'HP',13,false),(519,'DEF',16,false),(519,'EVASION',7,true),
-- Mago
(520,'MAG',69,false),(520,'CRIT_CHANCE',19,true),
(521,'MAG',29,false),(521,'SPD',23,false),
(522,'MAG',39,false),(522,'CRIT_CHANCE',19,true),
(523,'DEF',10,false),(523,'HP',26,false),(523,'MAGIC_DEF',36,false),
(524,'DEF',16,false),(524,'HP',94,false),(524,'MAGIC_DEF',52,false),
(525,'MAG',37,false),(525,'CRIT_CHANCE',19,true),
(526,'SPD',50,false),(526,'HP',13,false),(526,'MAGIC_DEF',22,false),(526,'EVASION',7,true),
-- Arquero
(527,'ATK',53,false),(527,'CRIT_CHANCE',30,true),
(528,'ATK',23,false),(528,'SPD',23,false),
(529,'DEF',33,false),(529,'HP',26,false),(529,'MAGIC_DEF',12,false),
(530,'DEF',53,false),(530,'HP',94,false),(530,'MAGIC_DEF',16,false),
(531,'ATK',29,false),(531,'CRIT_CHANCE',30,true),
(532,'SPD',50,false),(532,'HP',13,false),(532,'DEF',20,false),(532,'EVASION',7,true),
-- Pícaro
(533,'ATK',53,false),(533,'CRIT_CHANCE',35,true),
(534,'ATK',23,false),(534,'SPD',23,false),
(535,'DEF',30,false),(535,'HP',26,false),(535,'MAGIC_DEF',10,false),
(536,'DEF',49,false),(536,'HP',94,false),(536,'MAGIC_DEF',14,false),
(537,'ATK',29,false),(537,'CRIT_CHANCE',35,true),
(538,'SPD',50,false),(538,'HP',13,false),(538,'DEF',20,false),(538,'EVASION',7,true),
-- Sacerdote
(539,'MAG',78,false),(539,'CRIT_CHANCE',13,true),
(540,'HP',30,false),(540,'MAGIC_DEF',23,false),
(541,'DEF',9,false),(541,'HP',26,false),(541,'MAGIC_DEF',30,false),
(542,'DEF',13,false),(542,'HP',68,false),(542,'MAGIC_DEF',42,false),
(543,'MAG',43,false),(543,'CRIT_CHANCE',14,true),
(544,'SPD',50,false),(544,'HP',13,false),(544,'MAGIC_DEF',16,false),(544,'EVASION',7,true),

-- ===== Z3 EPICO lv40 "de la Caldera" (×1.5625) =====
-- Guerrero
(545,'ATK',70,false),(545,'CRIT_CHANCE',17,true),
(546,'ATK',148,false),
(547,'DEF',23,false),(547,'HP',30,false),
(548,'DEF',30,false),(548,'HP',28,false),(548,'MAGIC_DEF',9,false),
(549,'DEF',47,false),(549,'HP',73,false),(549,'MAGIC_DEF',14,false),
(550,'ATK',39,false),(550,'CRIT_CHANCE',17,true),
(551,'SPD',55,false),(551,'HP',14,false),(551,'DEF',17,false),(551,'EVASION',8,true),
-- Mago
(552,'MAG',75,false),(552,'CRIT_CHANCE',20,true),
(553,'MAG',31,false),(553,'SPD',25,false),
(554,'MAG',42,false),(554,'CRIT_CHANCE',20,true),
(555,'DEF',11,false),(555,'HP',28,false),(555,'MAGIC_DEF',39,false),
(556,'DEF',17,false),(556,'HP',102,false),(556,'MAGIC_DEF',56,false),
(557,'MAG',41,false),(557,'CRIT_CHANCE',20,true),
(558,'SPD',55,false),(558,'HP',14,false),(558,'MAGIC_DEF',23,false),(558,'EVASION',8,true),
-- Arquero
(559,'ATK',58,false),(559,'CRIT_CHANCE',33,true),
(560,'ATK',25,false),(560,'SPD',25,false),
(561,'DEF',36,false),(561,'HP',28,false),(561,'MAGIC_DEF',13,false),
(562,'DEF',58,false),(562,'HP',102,false),(562,'MAGIC_DEF',17,false),
(563,'ATK',31,false),(563,'CRIT_CHANCE',33,true),
(564,'SPD',55,false),(564,'HP',14,false),(564,'DEF',22,false),(564,'EVASION',8,true),
-- Pícaro
(565,'ATK',58,false),(565,'CRIT_CHANCE',38,true),
(566,'ATK',25,false),(566,'SPD',25,false),
(567,'DEF',33,false),(567,'HP',28,false),(567,'MAGIC_DEF',11,false),
(568,'DEF',53,false),(568,'HP',102,false),(568,'MAGIC_DEF',16,false),
(569,'ATK',31,false),(569,'CRIT_CHANCE',38,true),
(570,'SPD',55,false),(570,'HP',14,false),(570,'DEF',22,false),(570,'EVASION',8,true),
-- Sacerdote
(571,'MAG',84,false),(571,'CRIT_CHANCE',14,true),
(572,'HP',33,false),(572,'MAGIC_DEF',25,false),
(573,'DEF',9,false),(573,'HP',28,false),(573,'MAGIC_DEF',33,false),
(574,'DEF',14,false),(574,'HP',73,false),(574,'MAGIC_DEF',45,false),
(575,'MAG',47,false),(575,'CRIT_CHANCE',16,true),
(576,'SPD',55,false),(576,'HP',14,false),(576,'MAGIC_DEF',17,false),(576,'EVASION',8,true),

-- ===== Z3 LEGENDARIO lv45 "del Titán de Fuego" (×1.7969) =====
-- Guerrero
(577,'ATK',81,false),(577,'CRIT_CHANCE',20,true),
(578,'ATK',171,false),
(579,'DEF',27,false),(579,'HP',34,false),
(580,'DEF',34,false),(580,'HP',32,false),(580,'MAGIC_DEF',11,false),
(581,'DEF',54,false),(581,'HP',84,false),(581,'MAGIC_DEF',16,false),
(582,'ATK',45,false),(582,'CRIT_CHANCE',20,true),
(583,'SPD',63,false),(583,'HP',16,false),(583,'DEF',20,false),(583,'EVASION',9,true),
-- Mago
(584,'MAG',86,false),(584,'CRIT_CHANCE',23,true),
(585,'MAG',36,false),(585,'SPD',29,false),
(586,'MAG',49,false),(586,'CRIT_CHANCE',23,true),
(587,'DEF',13,false),(587,'HP',32,false),(587,'MAGIC_DEF',45,false),
(588,'DEF',20,false),(588,'HP',117,false),(588,'MAGIC_DEF',65,false),
(589,'MAG',47,false),(589,'CRIT_CHANCE',23,true),
(590,'SPD',63,false),(590,'HP',16,false),(590,'MAGIC_DEF',27,false),(590,'EVASION',9,true),
-- Arquero
(591,'ATK',66,false),(591,'CRIT_CHANCE',38,true),
(592,'ATK',29,false),(592,'SPD',29,false),
(593,'DEF',41,false),(593,'HP',32,false),(593,'MAGIC_DEF',14,false),
(594,'DEF',66,false),(594,'HP',117,false),(594,'MAGIC_DEF',20,false),
(595,'ATK',36,false),(595,'CRIT_CHANCE',38,true),
(596,'SPD',63,false),(596,'HP',16,false),(596,'DEF',25,false),(596,'EVASION',9,true),
-- Pícaro
(597,'ATK',66,false),(597,'CRIT_CHANCE',43,true),
(598,'ATK',29,false),(598,'SPD',29,false),
(599,'DEF',38,false),(599,'HP',32,false),(599,'MAGIC_DEF',13,false),
(600,'DEF',61,false),(600,'HP',117,false),(600,'MAGIC_DEF',18,false),
(601,'ATK',36,false),(601,'CRIT_CHANCE',43,true),
(602,'SPD',63,false),(602,'HP',16,false),(602,'DEF',25,false),(602,'EVASION',9,true),
-- Sacerdote
(603,'MAG',97,false),(603,'CRIT_CHANCE',16,true),
(604,'HP',38,false),(604,'MAGIC_DEF',29,false),
(605,'DEF',11,false),(605,'HP',32,false),(605,'MAGIC_DEF',38,false),
(606,'DEF',16,false),(606,'HP',84,false),(606,'MAGIC_DEF',52,false),
(607,'MAG',54,false),(607,'CRIT_CHANCE',18,true),
(608,'SPD',63,false),(608,'HP',16,false),(608,'MAGIC_DEF',20,false),(608,'EVASION',9,true),

-- ===== Z4 EPICO lv50 "del Océano" (×1.9531) =====
-- Guerrero
(609,'ATK',88,false),(609,'CRIT_CHANCE',21,true),
(610,'ATK',186,false),
(611,'DEF',29,false),(611,'HP',37,false),
(612,'DEF',37,false),(612,'HP',35,false),(612,'MAGIC_DEF',12,false),
(613,'DEF',59,false),(613,'HP',92,false),(613,'MAGIC_DEF',18,false),
(614,'ATK',49,false),(614,'CRIT_CHANCE',21,true),
(615,'SPD',68,false),(615,'HP',18,false),(615,'DEF',21,false),(615,'EVASION',10,true),
-- Mago
(616,'MAG',94,false),(616,'CRIT_CHANCE',25,true),
(617,'MAG',39,false),(617,'SPD',31,false),
(618,'MAG',53,false),(618,'CRIT_CHANCE',25,true),
(619,'DEF',14,false),(619,'HP',35,false),(619,'MAGIC_DEF',49,false),
(620,'DEF',21,false),(620,'HP',127,false),(620,'MAGIC_DEF',70,false),
(621,'MAG',51,false),(621,'CRIT_CHANCE',25,true),
(622,'SPD',68,false),(622,'HP',18,false),(622,'MAGIC_DEF',29,false),(622,'EVASION',10,true),
-- Arquero
(623,'ATK',72,false),(623,'CRIT_CHANCE',41,true),
(624,'ATK',31,false),(624,'SPD',31,false),
(625,'DEF',45,false),(625,'HP',35,false),(625,'MAGIC_DEF',16,false),
(626,'DEF',72,false),(626,'HP',127,false),(626,'MAGIC_DEF',21,false),
(627,'ATK',39,false),(627,'CRIT_CHANCE',41,true),
(628,'SPD',68,false),(628,'HP',18,false),(628,'DEF',27,false),(628,'EVASION',10,true),
-- Pícaro
(629,'ATK',72,false),(629,'CRIT_CHANCE',47,true),
(630,'ATK',31,false),(630,'SPD',31,false),
(631,'DEF',41,false),(631,'HP',35,false),(631,'MAGIC_DEF',14,false),
(632,'DEF',66,false),(632,'HP',127,false),(632,'MAGIC_DEF',20,false),
(633,'ATK',39,false),(633,'CRIT_CHANCE',47,true),
(634,'SPD',68,false),(634,'HP',18,false),(634,'DEF',27,false),(634,'EVASION',10,true),
-- Sacerdote
(635,'MAG',105,false),(635,'CRIT_CHANCE',18,true),
(636,'HP',41,false),(636,'MAGIC_DEF',31,false),
(637,'DEF',12,false),(637,'HP',35,false),(637,'MAGIC_DEF',41,false),
(638,'DEF',18,false),(638,'HP',92,false),(638,'MAGIC_DEF',57,false),
(639,'MAG',59,false),(639,'CRIT_CHANCE',20,true),
(640,'SPD',68,false),(640,'HP',18,false),(640,'MAGIC_DEF',21,false),(640,'EVASION',10,true),

-- ===== Z4 LEGENDARIO lv55 "de las Profundidades" (×2.2461) =====
-- Guerrero
(641,'ATK',101,false),(641,'CRIT_CHANCE',25,true),
(642,'ATK',213,false),
(643,'DEF',34,false),(643,'HP',43,false),
(644,'DEF',43,false),(644,'HP',40,false),(644,'MAGIC_DEF',13,false),
(645,'DEF',67,false),(645,'HP',106,false),(645,'MAGIC_DEF',20,false),
(646,'ATK',56,false),(646,'CRIT_CHANCE',25,true),
(647,'SPD',79,false),(647,'HP',20,false),(647,'DEF',25,false),(647,'EVASION',11,true),
-- Mago
(648,'MAG',108,false),(648,'CRIT_CHANCE',29,true),
(649,'MAG',45,false),(649,'SPD',36,false),
(650,'MAG',61,false),(650,'CRIT_CHANCE',29,true),
(651,'DEF',16,false),(651,'HP',40,false),(651,'MAGIC_DEF',56,false),
(652,'DEF',25,false),(652,'HP',146,false),(652,'MAGIC_DEF',81,false),
(653,'MAG',58,false),(653,'CRIT_CHANCE',29,true),
(654,'SPD',79,false),(654,'HP',20,false),(654,'MAGIC_DEF',34,false),(654,'EVASION',11,true),
-- Arquero
(655,'ATK',83,false),(655,'CRIT_CHANCE',47,true),
(656,'ATK',36,false),(656,'SPD',36,false),
(657,'DEF',52,false),(657,'HP',40,false),(657,'MAGIC_DEF',18,false),
(658,'DEF',83,false),(658,'HP',146,false),(658,'MAGIC_DEF',25,false),
(659,'ATK',45,false),(659,'CRIT_CHANCE',47,true),
(660,'SPD',79,false),(660,'HP',20,false),(660,'DEF',31,false),(660,'EVASION',11,true),
-- Pícaro
(661,'ATK',83,false),(661,'CRIT_CHANCE',54,true),
(662,'ATK',36,false),(662,'SPD',36,false),
(663,'DEF',47,false),(663,'HP',40,false),(663,'MAGIC_DEF',16,false),
(664,'DEF',76,false),(664,'HP',146,false),(664,'MAGIC_DEF',22,false),
(665,'ATK',45,false),(665,'CRIT_CHANCE',54,true),
(666,'SPD',79,false),(666,'HP',20,false),(666,'DEF',31,false),(666,'EVASION',11,true),
-- Sacerdote
(667,'MAG',121,false),(667,'CRIT_CHANCE',20,true),
(668,'HP',47,false),(668,'MAGIC_DEF',36,false),
(669,'DEF',13,false),(669,'HP',40,false),(669,'MAGIC_DEF',47,false),
(670,'DEF',20,false),(670,'HP',106,false),(670,'MAGIC_DEF',65,false),
(671,'MAG',67,false),(671,'CRIT_CHANCE',22,true),
(672,'SPD',79,false),(672,'HP',20,false),(672,'MAGIC_DEF',25,false),(672,'EVASION',11,true),

-- ===== Z5 LEGENDARIO lv70 "del Rey del Hielo" (interpolado t=0.36) =====
-- Guerrero
(673,'ATK',140,false),(673,'CRIT_CHANCE',25,true),
(674,'ATK',295,false),
(675,'DEF',39,false),(675,'HP',47,false),
(676,'DEF',48,false),(676,'HP',47,false),(676,'MAGIC_DEF',15,false),
(677,'DEF',77,false),(677,'HP',117,false),(677,'MAGIC_DEF',24,false),
(678,'ATK',64,false),(678,'CRIT_CHANCE',25,true),
(679,'SPD',88,false),(679,'HP',23,false),(679,'DEF',29,false),(679,'EVASION',13,true),
-- Mago
(680,'MAG',149,false),(680,'CRIT_CHANCE',29,true),
(681,'MAG',50,false),(681,'SPD',35,false),
(682,'MAG',66,false),(682,'CRIT_CHANCE',29,true),
(683,'DEF',17,false),(683,'HP',47,false),(683,'MAGIC_DEF',58,false),
(684,'DEF',29,false),(684,'HP',164,false),(684,'MAGIC_DEF',97,false),
(685,'MAG',66,false),(685,'CRIT_CHANCE',29,true),
(686,'SPD',88,false),(686,'HP',23,false),(686,'MAGIC_DEF',39,false),(686,'EVASION',13,true),
-- Arquero
(687,'ATK',114,false),(687,'CRIT_CHANCE',47,true),
(688,'ATK',38,false),(688,'SPD',35,false),
(689,'DEF',58,false),(689,'HP',47,false),(689,'MAGIC_DEF',17,false),
(690,'DEF',97,false),(690,'HP',164,false),(690,'MAGIC_DEF',29,false),
(691,'ATK',51,false),(691,'CRIT_CHANCE',47,true),
(692,'SPD',88,false),(692,'HP',23,false),(692,'DEF',39,false),(692,'EVASION',13,true),
-- Pícaro
(693,'ATK',114,false),(693,'CRIT_CHANCE',55,true),
(694,'ATK',38,false),(694,'SPD',35,false),
(695,'DEF',53,false),(695,'HP',47,false),(695,'MAGIC_DEF',16,false),
(696,'DEF',88,false),(696,'HP',164,false),(696,'MAGIC_DEF',26,false),
(697,'ATK',51,false),(697,'CRIT_CHANCE',55,true),
(698,'SPD',88,false),(698,'HP',23,false),(698,'DEF',35,false),(698,'EVASION',13,true),
-- Sacerdote
(699,'MAG',168,false),(699,'CRIT_CHANCE',22,true),
(700,'HP',47,false),(700,'MAGIC_DEF',39,false),
(701,'DEF',15,false),(701,'HP',47,false),(701,'MAGIC_DEF',48,false),
(702,'DEF',24,false),(702,'HP',117,false),(702,'MAGIC_DEF',77,false),
(703,'MAG',76,false),(703,'CRIT_CHANCE',22,true),
(704,'SPD',88,false),(704,'HP',23,false),(704,'MAGIC_DEF',29,false),(704,'EVASION',13,true),

-- ===== Z6 LEGENDARIO lv80 "del Lich" (interpolado t=0.76) =====
-- Guerrero
(705,'ATK',158,false),(705,'CRIT_CHANCE',29,true),
(706,'ATK',333,false),
(707,'DEF',44,false),(707,'HP',54,false),
(708,'DEF',54,false),(708,'HP',54,false),(708,'MAGIC_DEF',17,false),
(709,'DEF',88,false),(709,'HP',134,false),(709,'MAGIC_DEF',26,false),
(710,'ATK',72,false),(710,'CRIT_CHANCE',29,true),
(711,'SPD',99,false),(711,'HP',27,false),(711,'DEF',33,false),(711,'EVASION',15,true),
-- Mago
(712,'MAG',168,false),(712,'CRIT_CHANCE',33,true),
(713,'MAG',56,false),(713,'SPD',39,false),
(714,'MAG',75,false),(714,'CRIT_CHANCE',33,true),
(715,'DEF',20,false),(715,'HP',54,false),(715,'MAGIC_DEF',65,false),
(716,'DEF',33,false),(716,'HP',188,false),(716,'MAGIC_DEF',110,false),
(717,'MAG',75,false),(717,'CRIT_CHANCE',33,true),
(718,'SPD',99,false),(718,'HP',27,false),(718,'MAGIC_DEF',44,false),(718,'EVASION',15,true),
-- Arquero
(719,'ATK',129,false),(719,'CRIT_CHANCE',53,true),
(720,'ATK',43,false),(720,'SPD',39,false),
(721,'DEF',65,false),(721,'HP',54,false),(721,'MAGIC_DEF',20,false),
(722,'DEF',110,false),(722,'HP',188,false),(722,'MAGIC_DEF',33,false),
(723,'ATK',58,false),(723,'CRIT_CHANCE',53,true),
(724,'SPD',99,false),(724,'HP',27,false),(724,'DEF',44,false),(724,'EVASION',15,true),
-- Pícaro
(725,'ATK',129,false),(725,'CRIT_CHANCE',62,true),
(726,'ATK',43,false),(726,'SPD',39,false),
(727,'DEF',60,false),(727,'HP',54,false),(727,'MAGIC_DEF',18,false),
(728,'DEF',99,false),(728,'HP',188,false),(728,'MAGIC_DEF',30,false),
(729,'ATK',58,false),(729,'CRIT_CHANCE',62,true),
(730,'SPD',99,false),(730,'HP',27,false),(730,'DEF',40,false),(730,'EVASION',15,true),
-- Sacerdote
(731,'MAG',190,false),(731,'CRIT_CHANCE',24,true),
(732,'HP',54,false),(732,'MAGIC_DEF',44,false),
(733,'DEF',17,false),(733,'HP',54,false),(733,'MAGIC_DEF',54,false),
(734,'DEF',26,false),(734,'HP',134,false),(734,'MAGIC_DEF',88,false),
(735,'MAG',86,false),(735,'CRIT_CHANCE',24,true),
(736,'SPD',99,false),(736,'HP',27,false),(736,'MAGIC_DEF',33,false),(736,'EVASION',15,true);

-- ============================================================
-- CRAFTING RECIPES (320 recipes, scroll-locked)
-- EPICO: success_rate=70, required_rank='D'
-- LEGENDARIO: success_rate=55, required_rank='C'
-- ============================================================
INSERT INTO crafting_recipes (code, result_item_id, result_quantity, rarity, required_level, required_class_id, required_rank, success_rate_percent, craft_time_minutes, artisan_name, zone_id, scroll_item_id) VALUES
-- ===== Z1 EPICO lv20 scroll=45 =====
('RECIPE_GUERRERO_WEAPON_CAPITAN',417,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_GUERRERO_WEAPON2H_CAPITAN',418,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_GUERRERO_OFFHAND_CAPITAN',419,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_GUERRERO_HELMET_CAPITAN',420,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_GUERRERO_ARMOR_CAPITAN',421,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_GUERRERO_GLOVES_CAPITAN',422,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_GUERRERO_BOOTS_CAPITAN',423,1,'EPICO',15,1,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_WEAPON_CAPITAN',424,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_OFFHAND_ORB_CAPITAN',425,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_OFFHAND_CRYSTAL_CAPITAN',426,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_HELMET_CAPITAN',427,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_ARMOR_CAPITAN',428,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_GLOVES_CAPITAN',429,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_MAGO_BOOTS_CAPITAN',430,1,'EPICO',15,2,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_ARQUERO_WEAPON_CAPITAN',431,1,'EPICO',15,3,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_ARQUERO_OFFHAND_CAPITAN',432,1,'EPICO',15,3,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_ARQUERO_HELMET_CAPITAN',433,1,'EPICO',15,3,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_ARQUERO_ARMOR_CAPITAN',434,1,'EPICO',15,3,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_ARQUERO_GLOVES_CAPITAN',435,1,'EPICO',15,3,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_ARQUERO_BOOTS_CAPITAN',436,1,'EPICO',15,3,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_PICARO_WEAPON_CAPITAN',437,1,'EPICO',15,4,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_PICARO_OFFHAND_CAPITAN',438,1,'EPICO',15,4,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_PICARO_HELMET_CAPITAN',439,1,'EPICO',15,4,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_PICARO_ARMOR_CAPITAN',440,1,'EPICO',15,4,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_PICARO_GLOVES_CAPITAN',441,1,'EPICO',15,4,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_PICARO_BOOTS_CAPITAN',442,1,'EPICO',15,4,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_SACERDOTE_WEAPON_CAPITAN',443,1,'EPICO',15,5,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_SACERDOTE_OFFHAND_CAPITAN',444,1,'EPICO',15,5,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_SACERDOTE_HELMET_CAPITAN',445,1,'EPICO',15,5,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_SACERDOTE_ARMOR_CAPITAN',446,1,'EPICO',15,5,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_SACERDOTE_GLOVES_CAPITAN',447,1,'EPICO',15,5,'D',70,10,'Maestro Artesano',1,45),
('RECIPE_SACERDOTE_BOOTS_CAPITAN',448,1,'EPICO',15,5,'D',70,10,'Maestro Artesano',1,45),
-- ===== Z1 LEGENDARIO lv25 scroll=46 =====
('RECIPE_GUERRERO_WEAPON_TITAN_P',449,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_GUERRERO_WEAPON2H_TITAN_P',450,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_GUERRERO_OFFHAND_TITAN_P',451,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_GUERRERO_HELMET_TITAN_P',452,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_GUERRERO_ARMOR_TITAN_P',453,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_GUERRERO_GLOVES_TITAN_P',454,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_GUERRERO_BOOTS_TITAN_P',455,1,'LEGENDARIO',20,1,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_WEAPON_TITAN_P',456,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_OFFHAND_ORB_TITAN_P',457,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_OFFHAND_CRYSTAL_TITAN_P',458,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_HELMET_TITAN_P',459,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_ARMOR_TITAN_P',460,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_GLOVES_TITAN_P',461,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_MAGO_BOOTS_TITAN_P',462,1,'LEGENDARIO',20,2,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_ARQUERO_WEAPON_TITAN_P',463,1,'LEGENDARIO',20,3,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_ARQUERO_OFFHAND_TITAN_P',464,1,'LEGENDARIO',20,3,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_ARQUERO_HELMET_TITAN_P',465,1,'LEGENDARIO',20,3,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_ARQUERO_ARMOR_TITAN_P',466,1,'LEGENDARIO',20,3,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_ARQUERO_GLOVES_TITAN_P',467,1,'LEGENDARIO',20,3,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_ARQUERO_BOOTS_TITAN_P',468,1,'LEGENDARIO',20,3,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_PICARO_WEAPON_TITAN_P',469,1,'LEGENDARIO',20,4,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_PICARO_OFFHAND_TITAN_P',470,1,'LEGENDARIO',20,4,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_PICARO_HELMET_TITAN_P',471,1,'LEGENDARIO',20,4,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_PICARO_ARMOR_TITAN_P',472,1,'LEGENDARIO',20,4,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_PICARO_GLOVES_TITAN_P',473,1,'LEGENDARIO',20,4,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_PICARO_BOOTS_TITAN_P',474,1,'LEGENDARIO',20,4,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_SACERDOTE_WEAPON_TITAN_P',475,1,'LEGENDARIO',20,5,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_SACERDOTE_OFFHAND_TITAN_P',476,1,'LEGENDARIO',20,5,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_SACERDOTE_HELMET_TITAN_P',477,1,'LEGENDARIO',20,5,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_SACERDOTE_ARMOR_TITAN_P',478,1,'LEGENDARIO',20,5,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_SACERDOTE_GLOVES_TITAN_P',479,1,'LEGENDARIO',20,5,'C',55,20,'Maestro Artesano',1,46),
('RECIPE_SACERDOTE_BOOTS_TITAN_P',480,1,'LEGENDARIO',20,5,'C',55,20,'Maestro Artesano',1,46),
-- ===== Z2 EPICO lv30 scroll=54 =====
('RECIPE_GUERRERO_WEAPON_ACANT',481,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_GUERRERO_WEAPON2H_ACANT',482,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_GUERRERO_OFFHAND_ACANT',483,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_GUERRERO_HELMET_ACANT',484,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_GUERRERO_ARMOR_ACANT',485,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_GUERRERO_GLOVES_ACANT',486,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_GUERRERO_BOOTS_ACANT',487,1,'EPICO',25,1,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_WEAPON_ACANT',488,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_OFFHAND_ORB_ACANT',489,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_OFFHAND_CRYSTAL_ACANT',490,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_HELMET_ACANT',491,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_ARMOR_ACANT',492,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_GLOVES_ACANT',493,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_MAGO_BOOTS_ACANT',494,1,'EPICO',25,2,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_ARQUERO_WEAPON_ACANT',495,1,'EPICO',25,3,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_ARQUERO_OFFHAND_ACANT',496,1,'EPICO',25,3,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_ARQUERO_HELMET_ACANT',497,1,'EPICO',25,3,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_ARQUERO_ARMOR_ACANT',498,1,'EPICO',25,3,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_ARQUERO_GLOVES_ACANT',499,1,'EPICO',25,3,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_ARQUERO_BOOTS_ACANT',500,1,'EPICO',25,3,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_PICARO_WEAPON_ACANT',501,1,'EPICO',25,4,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_PICARO_OFFHAND_ACANT',502,1,'EPICO',25,4,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_PICARO_HELMET_ACANT',503,1,'EPICO',25,4,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_PICARO_ARMOR_ACANT',504,1,'EPICO',25,4,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_PICARO_GLOVES_ACANT',505,1,'EPICO',25,4,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_PICARO_BOOTS_ACANT',506,1,'EPICO',25,4,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_SACERDOTE_WEAPON_ACANT',507,1,'EPICO',25,5,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_SACERDOTE_OFFHAND_ACANT',508,1,'EPICO',25,5,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_SACERDOTE_HELMET_ACANT',509,1,'EPICO',25,5,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_SACERDOTE_ARMOR_ACANT',510,1,'EPICO',25,5,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_SACERDOTE_GLOVES_ACANT',511,1,'EPICO',25,5,'D',70,10,'Maestro Artesano',2,54),
('RECIPE_SACERDOTE_BOOTS_ACANT',512,1,'EPICO',25,5,'D',70,10,'Maestro Artesano',2,54),
-- ===== Z2 LEGENDARIO lv35 scroll=55 =====
('RECIPE_GUERRERO_WEAPON_REY_MONT',513,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_GUERRERO_WEAPON2H_REY_MONT',514,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_GUERRERO_OFFHAND_REY_MONT',515,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_GUERRERO_HELMET_REY_MONT',516,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_GUERRERO_ARMOR_REY_MONT',517,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_GUERRERO_GLOVES_REY_MONT',518,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_GUERRERO_BOOTS_REY_MONT',519,1,'LEGENDARIO',30,1,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_WEAPON_REY_MONT',520,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_OFFHAND_ORB_REY_MONT',521,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_OFFHAND_CRYSTAL_REY_MONT',522,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_HELMET_REY_MONT',523,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_ARMOR_REY_MONT',524,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_GLOVES_REY_MONT',525,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_MAGO_BOOTS_REY_MONT',526,1,'LEGENDARIO',30,2,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_ARQUERO_WEAPON_REY_MONT',527,1,'LEGENDARIO',30,3,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_ARQUERO_OFFHAND_REY_MONT',528,1,'LEGENDARIO',30,3,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_ARQUERO_HELMET_REY_MONT',529,1,'LEGENDARIO',30,3,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_ARQUERO_ARMOR_REY_MONT',530,1,'LEGENDARIO',30,3,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_ARQUERO_GLOVES_REY_MONT',531,1,'LEGENDARIO',30,3,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_ARQUERO_BOOTS_REY_MONT',532,1,'LEGENDARIO',30,3,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_PICARO_WEAPON_REY_MONT',533,1,'LEGENDARIO',30,4,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_PICARO_OFFHAND_REY_MONT',534,1,'LEGENDARIO',30,4,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_PICARO_HELMET_REY_MONT',535,1,'LEGENDARIO',30,4,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_PICARO_ARMOR_REY_MONT',536,1,'LEGENDARIO',30,4,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_PICARO_GLOVES_REY_MONT',537,1,'LEGENDARIO',30,4,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_PICARO_BOOTS_REY_MONT',538,1,'LEGENDARIO',30,4,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_SACERDOTE_WEAPON_REY_MONT',539,1,'LEGENDARIO',30,5,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_SACERDOTE_OFFHAND_REY_MONT',540,1,'LEGENDARIO',30,5,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_SACERDOTE_HELMET_REY_MONT',541,1,'LEGENDARIO',30,5,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_SACERDOTE_ARMOR_REY_MONT',542,1,'LEGENDARIO',30,5,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_SACERDOTE_GLOVES_REY_MONT',543,1,'LEGENDARIO',30,5,'C',55,20,'Maestro Artesano',2,55),
('RECIPE_SACERDOTE_BOOTS_REY_MONT',544,1,'LEGENDARIO',30,5,'C',55,20,'Maestro Artesano',2,55),
-- ===== Z3 EPICO lv40 scroll=63 =====
('RECIPE_GUERRERO_WEAPON_CALDERA',545,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_GUERRERO_WEAPON2H_CALDERA',546,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_GUERRERO_OFFHAND_CALDERA',547,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_GUERRERO_HELMET_CALDERA',548,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_GUERRERO_ARMOR_CALDERA',549,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_GUERRERO_GLOVES_CALDERA',550,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_GUERRERO_BOOTS_CALDERA',551,1,'EPICO',35,1,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_WEAPON_CALDERA',552,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_OFFHAND_ORB_CALDERA',553,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_OFFHAND_CRYSTAL_CALDERA',554,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_HELMET_CALDERA',555,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_ARMOR_CALDERA',556,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_GLOVES_CALDERA',557,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_MAGO_BOOTS_CALDERA',558,1,'EPICO',35,2,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_ARQUERO_WEAPON_CALDERA',559,1,'EPICO',35,3,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_ARQUERO_OFFHAND_CALDERA',560,1,'EPICO',35,3,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_ARQUERO_HELMET_CALDERA',561,1,'EPICO',35,3,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_ARQUERO_ARMOR_CALDERA',562,1,'EPICO',35,3,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_ARQUERO_GLOVES_CALDERA',563,1,'EPICO',35,3,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_ARQUERO_BOOTS_CALDERA',564,1,'EPICO',35,3,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_PICARO_WEAPON_CALDERA',565,1,'EPICO',35,4,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_PICARO_OFFHAND_CALDERA',566,1,'EPICO',35,4,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_PICARO_HELMET_CALDERA',567,1,'EPICO',35,4,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_PICARO_ARMOR_CALDERA',568,1,'EPICO',35,4,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_PICARO_GLOVES_CALDERA',569,1,'EPICO',35,4,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_PICARO_BOOTS_CALDERA',570,1,'EPICO',35,4,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_SACERDOTE_WEAPON_CALDERA',571,1,'EPICO',35,5,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_SACERDOTE_OFFHAND_CALDERA',572,1,'EPICO',35,5,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_SACERDOTE_HELMET_CALDERA',573,1,'EPICO',35,5,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_SACERDOTE_ARMOR_CALDERA',574,1,'EPICO',35,5,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_SACERDOTE_GLOVES_CALDERA',575,1,'EPICO',35,5,'D',70,10,'Maestro Artesano',3,63),
('RECIPE_SACERDOTE_BOOTS_CALDERA',576,1,'EPICO',35,5,'D',70,10,'Maestro Artesano',3,63),
-- ===== Z3 LEGENDARIO lv45 scroll=64 =====
('RECIPE_GUERRERO_WEAPON_TITAN_F',577,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_GUERRERO_WEAPON2H_TITAN_F',578,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_GUERRERO_OFFHAND_TITAN_F',579,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_GUERRERO_HELMET_TITAN_F',580,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_GUERRERO_ARMOR_TITAN_F',581,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_GUERRERO_GLOVES_TITAN_F',582,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_GUERRERO_BOOTS_TITAN_F',583,1,'LEGENDARIO',40,1,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_WEAPON_TITAN_F',584,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_OFFHAND_ORB_TITAN_F',585,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_OFFHAND_CRYSTAL_TITAN_F',586,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_HELMET_TITAN_F',587,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_ARMOR_TITAN_F',588,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_GLOVES_TITAN_F',589,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_MAGO_BOOTS_TITAN_F',590,1,'LEGENDARIO',40,2,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_ARQUERO_WEAPON_TITAN_F',591,1,'LEGENDARIO',40,3,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_ARQUERO_OFFHAND_TITAN_F',592,1,'LEGENDARIO',40,3,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_ARQUERO_HELMET_TITAN_F',593,1,'LEGENDARIO',40,3,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_ARQUERO_ARMOR_TITAN_F',594,1,'LEGENDARIO',40,3,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_ARQUERO_GLOVES_TITAN_F',595,1,'LEGENDARIO',40,3,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_ARQUERO_BOOTS_TITAN_F',596,1,'LEGENDARIO',40,3,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_PICARO_WEAPON_TITAN_F',597,1,'LEGENDARIO',40,4,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_PICARO_OFFHAND_TITAN_F',598,1,'LEGENDARIO',40,4,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_PICARO_HELMET_TITAN_F',599,1,'LEGENDARIO',40,4,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_PICARO_ARMOR_TITAN_F',600,1,'LEGENDARIO',40,4,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_PICARO_GLOVES_TITAN_F',601,1,'LEGENDARIO',40,4,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_PICARO_BOOTS_TITAN_F',602,1,'LEGENDARIO',40,4,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_SACERDOTE_WEAPON_TITAN_F',603,1,'LEGENDARIO',40,5,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_SACERDOTE_OFFHAND_TITAN_F',604,1,'LEGENDARIO',40,5,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_SACERDOTE_HELMET_TITAN_F',605,1,'LEGENDARIO',40,5,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_SACERDOTE_ARMOR_TITAN_F',606,1,'LEGENDARIO',40,5,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_SACERDOTE_GLOVES_TITAN_F',607,1,'LEGENDARIO',40,5,'C',55,20,'Maestro Artesano',3,64),
('RECIPE_SACERDOTE_BOOTS_TITAN_F',608,1,'LEGENDARIO',40,5,'C',55,20,'Maestro Artesano',3,64),
-- ===== Z4 EPICO lv50 scroll=72 =====
('RECIPE_GUERRERO_WEAPON_OCEANO',609,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_GUERRERO_WEAPON2H_OCEANO',610,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_GUERRERO_OFFHAND_OCEANO',611,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_GUERRERO_HELMET_OCEANO',612,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_GUERRERO_ARMOR_OCEANO',613,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_GUERRERO_GLOVES_OCEANO',614,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_GUERRERO_BOOTS_OCEANO',615,1,'EPICO',45,1,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_WEAPON_OCEANO',616,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_OFFHAND_ORB_OCEANO',617,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_OFFHAND_CRYSTAL_OCEANO',618,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_HELMET_OCEANO',619,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_ARMOR_OCEANO',620,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_GLOVES_OCEANO',621,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_MAGO_BOOTS_OCEANO',622,1,'EPICO',45,2,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_ARQUERO_WEAPON_OCEANO',623,1,'EPICO',45,3,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_ARQUERO_OFFHAND_OCEANO',624,1,'EPICO',45,3,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_ARQUERO_HELMET_OCEANO',625,1,'EPICO',45,3,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_ARQUERO_ARMOR_OCEANO',626,1,'EPICO',45,3,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_ARQUERO_GLOVES_OCEANO',627,1,'EPICO',45,3,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_ARQUERO_BOOTS_OCEANO',628,1,'EPICO',45,3,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_PICARO_WEAPON_OCEANO',629,1,'EPICO',45,4,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_PICARO_OFFHAND_OCEANO',630,1,'EPICO',45,4,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_PICARO_HELMET_OCEANO',631,1,'EPICO',45,4,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_PICARO_ARMOR_OCEANO',632,1,'EPICO',45,4,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_PICARO_GLOVES_OCEANO',633,1,'EPICO',45,4,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_PICARO_BOOTS_OCEANO',634,1,'EPICO',45,4,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_SACERDOTE_WEAPON_OCEANO',635,1,'EPICO',45,5,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_SACERDOTE_OFFHAND_OCEANO',636,1,'EPICO',45,5,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_SACERDOTE_HELMET_OCEANO',637,1,'EPICO',45,5,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_SACERDOTE_ARMOR_OCEANO',638,1,'EPICO',45,5,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_SACERDOTE_GLOVES_OCEANO',639,1,'EPICO',45,5,'D',70,10,'Maestro Artesano',4,72),
('RECIPE_SACERDOTE_BOOTS_OCEANO',640,1,'EPICO',45,5,'D',70,10,'Maestro Artesano',4,72),
-- ===== Z4 LEGENDARIO lv55 scroll=73 =====
('RECIPE_GUERRERO_WEAPON_PROFU',641,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_GUERRERO_WEAPON2H_PROFU',642,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_GUERRERO_OFFHAND_PROFU',643,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_GUERRERO_HELMET_PROFU',644,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_GUERRERO_ARMOR_PROFU',645,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_GUERRERO_GLOVES_PROFU',646,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_GUERRERO_BOOTS_PROFU',647,1,'LEGENDARIO',50,1,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_WEAPON_PROFU',648,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_OFFHAND_ORB_PROFU',649,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_OFFHAND_CRYSTAL_PROFU',650,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_HELMET_PROFU',651,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_ARMOR_PROFU',652,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_GLOVES_PROFU',653,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_MAGO_BOOTS_PROFU',654,1,'LEGENDARIO',50,2,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_ARQUERO_WEAPON_PROFU',655,1,'LEGENDARIO',50,3,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_ARQUERO_OFFHAND_PROFU',656,1,'LEGENDARIO',50,3,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_ARQUERO_HELMET_PROFU',657,1,'LEGENDARIO',50,3,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_ARQUERO_ARMOR_PROFU',658,1,'LEGENDARIO',50,3,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_ARQUERO_GLOVES_PROFU',659,1,'LEGENDARIO',50,3,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_ARQUERO_BOOTS_PROFU',660,1,'LEGENDARIO',50,3,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_PICARO_WEAPON_PROFU',661,1,'LEGENDARIO',50,4,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_PICARO_OFFHAND_PROFU',662,1,'LEGENDARIO',50,4,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_PICARO_HELMET_PROFU',663,1,'LEGENDARIO',50,4,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_PICARO_ARMOR_PROFU',664,1,'LEGENDARIO',50,4,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_PICARO_GLOVES_PROFU',665,1,'LEGENDARIO',50,4,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_PICARO_BOOTS_PROFU',666,1,'LEGENDARIO',50,4,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_SACERDOTE_WEAPON_PROFU',667,1,'LEGENDARIO',50,5,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_SACERDOTE_OFFHAND_PROFU',668,1,'LEGENDARIO',50,5,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_SACERDOTE_HELMET_PROFU',669,1,'LEGENDARIO',50,5,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_SACERDOTE_ARMOR_PROFU',670,1,'LEGENDARIO',50,5,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_SACERDOTE_GLOVES_PROFU',671,1,'LEGENDARIO',50,5,'C',55,20,'Maestro Artesano',4,73),
('RECIPE_SACERDOTE_BOOTS_PROFU',672,1,'LEGENDARIO',50,5,'C',55,20,'Maestro Artesano',4,73),
-- ===== Z5 LEGENDARIO lv70 scroll=82 =====
('RECIPE_GUERRERO_WEAPON_REY_HIELO',673,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_GUERRERO_WEAPON2H_REY_HIELO',674,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_GUERRERO_OFFHAND_REY_HIELO',675,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_GUERRERO_HELMET_REY_HIELO',676,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_GUERRERO_ARMOR_REY_HIELO',677,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_GUERRERO_GLOVES_REY_HIELO',678,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_GUERRERO_BOOTS_REY_HIELO',679,1,'LEGENDARIO',65,1,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_WEAPON_REY_HIELO',680,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_OFFHAND_ORB_REY_HIELO',681,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_OFFHAND_CRYSTAL_REY_HIELO',682,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_HELMET_REY_HIELO',683,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_ARMOR_REY_HIELO',684,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_GLOVES_REY_HIELO',685,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_MAGO_BOOTS_REY_HIELO',686,1,'LEGENDARIO',65,2,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_ARQUERO_WEAPON_REY_HIELO',687,1,'LEGENDARIO',65,3,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_ARQUERO_OFFHAND_REY_HIELO',688,1,'LEGENDARIO',65,3,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_ARQUERO_HELMET_REY_HIELO',689,1,'LEGENDARIO',65,3,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_ARQUERO_ARMOR_REY_HIELO',690,1,'LEGENDARIO',65,3,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_ARQUERO_GLOVES_REY_HIELO',691,1,'LEGENDARIO',65,3,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_ARQUERO_BOOTS_REY_HIELO',692,1,'LEGENDARIO',65,3,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_PICARO_WEAPON_REY_HIELO',693,1,'LEGENDARIO',65,4,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_PICARO_OFFHAND_REY_HIELO',694,1,'LEGENDARIO',65,4,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_PICARO_HELMET_REY_HIELO',695,1,'LEGENDARIO',65,4,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_PICARO_ARMOR_REY_HIELO',696,1,'LEGENDARIO',65,4,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_PICARO_GLOVES_REY_HIELO',697,1,'LEGENDARIO',65,4,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_PICARO_BOOTS_REY_HIELO',698,1,'LEGENDARIO',65,4,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_SACERDOTE_WEAPON_REY_HIELO',699,1,'LEGENDARIO',65,5,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_SACERDOTE_OFFHAND_REY_HIELO',700,1,'LEGENDARIO',65,5,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_SACERDOTE_HELMET_REY_HIELO',701,1,'LEGENDARIO',65,5,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_SACERDOTE_ARMOR_REY_HIELO',702,1,'LEGENDARIO',65,5,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_SACERDOTE_GLOVES_REY_HIELO',703,1,'LEGENDARIO',65,5,'C',55,20,'Maestro Artesano',5,82),
('RECIPE_SACERDOTE_BOOTS_REY_HIELO',704,1,'LEGENDARIO',65,5,'C',55,20,'Maestro Artesano',5,82),
-- ===== Z6 LEGENDARIO lv80 scroll=91 =====
('RECIPE_GUERRERO_WEAPON_LICH',705,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_GUERRERO_WEAPON2H_LICH',706,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_GUERRERO_OFFHAND_LICH',707,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_GUERRERO_HELMET_LICH',708,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_GUERRERO_ARMOR_LICH',709,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_GUERRERO_GLOVES_LICH',710,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_GUERRERO_BOOTS_LICH',711,1,'LEGENDARIO',75,1,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_WEAPON_LICH',712,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_OFFHAND_ORB_LICH',713,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_OFFHAND_CRYSTAL_LICH',714,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_HELMET_LICH',715,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_ARMOR_LICH',716,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_GLOVES_LICH',717,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_MAGO_BOOTS_LICH',718,1,'LEGENDARIO',75,2,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_ARQUERO_WEAPON_LICH',719,1,'LEGENDARIO',75,3,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_ARQUERO_OFFHAND_LICH',720,1,'LEGENDARIO',75,3,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_ARQUERO_HELMET_LICH',721,1,'LEGENDARIO',75,3,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_ARQUERO_ARMOR_LICH',722,1,'LEGENDARIO',75,3,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_ARQUERO_GLOVES_LICH',723,1,'LEGENDARIO',75,3,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_ARQUERO_BOOTS_LICH',724,1,'LEGENDARIO',75,3,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_PICARO_WEAPON_LICH',725,1,'LEGENDARIO',75,4,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_PICARO_OFFHAND_LICH',726,1,'LEGENDARIO',75,4,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_PICARO_HELMET_LICH',727,1,'LEGENDARIO',75,4,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_PICARO_ARMOR_LICH',728,1,'LEGENDARIO',75,4,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_PICARO_GLOVES_LICH',729,1,'LEGENDARIO',75,4,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_PICARO_BOOTS_LICH',730,1,'LEGENDARIO',75,4,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_SACERDOTE_WEAPON_LICH',731,1,'LEGENDARIO',75,5,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_SACERDOTE_OFFHAND_LICH',732,1,'LEGENDARIO',75,5,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_SACERDOTE_HELMET_LICH',733,1,'LEGENDARIO',75,5,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_SACERDOTE_ARMOR_LICH',734,1,'LEGENDARIO',75,5,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_SACERDOTE_GLOVES_LICH',735,1,'LEGENDARIO',75,5,'C',55,20,'Maestro Artesano',6,91),
('RECIPE_SACERDOTE_BOOTS_LICH',736,1,'LEGENDARIO',75,5,'C',55,20,'Maestro Artesano',6,91);

-- ============================================================
-- RECIPE INGREDIENTS (CROSS JOIN pattern — same ingredients per zone-rarity)
-- ============================================================

-- Z1 EPICO: 45×2, 40×5, 41×4, 38×3
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (45,2),(40,5),(41,4),(38,3)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_CAPITAN','RECIPE_GUERRERO_WEAPON2H_CAPITAN','RECIPE_GUERRERO_OFFHAND_CAPITAN',
  'RECIPE_GUERRERO_HELMET_CAPITAN','RECIPE_GUERRERO_ARMOR_CAPITAN','RECIPE_GUERRERO_GLOVES_CAPITAN','RECIPE_GUERRERO_BOOTS_CAPITAN',
  'RECIPE_MAGO_WEAPON_CAPITAN','RECIPE_MAGO_OFFHAND_ORB_CAPITAN','RECIPE_MAGO_OFFHAND_CRYSTAL_CAPITAN',
  'RECIPE_MAGO_HELMET_CAPITAN','RECIPE_MAGO_ARMOR_CAPITAN','RECIPE_MAGO_GLOVES_CAPITAN','RECIPE_MAGO_BOOTS_CAPITAN',
  'RECIPE_ARQUERO_WEAPON_CAPITAN','RECIPE_ARQUERO_OFFHAND_CAPITAN','RECIPE_ARQUERO_HELMET_CAPITAN',
  'RECIPE_ARQUERO_ARMOR_CAPITAN','RECIPE_ARQUERO_GLOVES_CAPITAN','RECIPE_ARQUERO_BOOTS_CAPITAN',
  'RECIPE_PICARO_WEAPON_CAPITAN','RECIPE_PICARO_OFFHAND_CAPITAN','RECIPE_PICARO_HELMET_CAPITAN',
  'RECIPE_PICARO_ARMOR_CAPITAN','RECIPE_PICARO_GLOVES_CAPITAN','RECIPE_PICARO_BOOTS_CAPITAN',
  'RECIPE_SACERDOTE_WEAPON_CAPITAN','RECIPE_SACERDOTE_OFFHAND_CAPITAN','RECIPE_SACERDOTE_HELMET_CAPITAN',
  'RECIPE_SACERDOTE_ARMOR_CAPITAN','RECIPE_SACERDOTE_GLOVES_CAPITAN','RECIPE_SACERDOTE_BOOTS_CAPITAN'
);

-- Z1 LEGENDARIO: 46×1, 45×1, 44×2, 43×1, 41×6
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (46,1),(45,1),(44,2),(43,1),(41,6)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_TITAN_P','RECIPE_GUERRERO_WEAPON2H_TITAN_P','RECIPE_GUERRERO_OFFHAND_TITAN_P',
  'RECIPE_GUERRERO_HELMET_TITAN_P','RECIPE_GUERRERO_ARMOR_TITAN_P','RECIPE_GUERRERO_GLOVES_TITAN_P','RECIPE_GUERRERO_BOOTS_TITAN_P',
  'RECIPE_MAGO_WEAPON_TITAN_P','RECIPE_MAGO_OFFHAND_ORB_TITAN_P','RECIPE_MAGO_OFFHAND_CRYSTAL_TITAN_P',
  'RECIPE_MAGO_HELMET_TITAN_P','RECIPE_MAGO_ARMOR_TITAN_P','RECIPE_MAGO_GLOVES_TITAN_P','RECIPE_MAGO_BOOTS_TITAN_P',
  'RECIPE_ARQUERO_WEAPON_TITAN_P','RECIPE_ARQUERO_OFFHAND_TITAN_P','RECIPE_ARQUERO_HELMET_TITAN_P',
  'RECIPE_ARQUERO_ARMOR_TITAN_P','RECIPE_ARQUERO_GLOVES_TITAN_P','RECIPE_ARQUERO_BOOTS_TITAN_P',
  'RECIPE_PICARO_WEAPON_TITAN_P','RECIPE_PICARO_OFFHAND_TITAN_P','RECIPE_PICARO_HELMET_TITAN_P',
  'RECIPE_PICARO_ARMOR_TITAN_P','RECIPE_PICARO_GLOVES_TITAN_P','RECIPE_PICARO_BOOTS_TITAN_P',
  'RECIPE_SACERDOTE_WEAPON_TITAN_P','RECIPE_SACERDOTE_OFFHAND_TITAN_P','RECIPE_SACERDOTE_HELMET_TITAN_P',
  'RECIPE_SACERDOTE_ARMOR_TITAN_P','RECIPE_SACERDOTE_GLOVES_TITAN_P','RECIPE_SACERDOTE_BOOTS_TITAN_P'
);

-- Z2 EPICO: 54×2, 50×5, 47×4, 48×3
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (54,2),(50,5),(47,4),(48,3)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_ACANT','RECIPE_GUERRERO_WEAPON2H_ACANT','RECIPE_GUERRERO_OFFHAND_ACANT',
  'RECIPE_GUERRERO_HELMET_ACANT','RECIPE_GUERRERO_ARMOR_ACANT','RECIPE_GUERRERO_GLOVES_ACANT','RECIPE_GUERRERO_BOOTS_ACANT',
  'RECIPE_MAGO_WEAPON_ACANT','RECIPE_MAGO_OFFHAND_ORB_ACANT','RECIPE_MAGO_OFFHAND_CRYSTAL_ACANT',
  'RECIPE_MAGO_HELMET_ACANT','RECIPE_MAGO_ARMOR_ACANT','RECIPE_MAGO_GLOVES_ACANT','RECIPE_MAGO_BOOTS_ACANT',
  'RECIPE_ARQUERO_WEAPON_ACANT','RECIPE_ARQUERO_OFFHAND_ACANT','RECIPE_ARQUERO_HELMET_ACANT',
  'RECIPE_ARQUERO_ARMOR_ACANT','RECIPE_ARQUERO_GLOVES_ACANT','RECIPE_ARQUERO_BOOTS_ACANT',
  'RECIPE_PICARO_WEAPON_ACANT','RECIPE_PICARO_OFFHAND_ACANT','RECIPE_PICARO_HELMET_ACANT',
  'RECIPE_PICARO_ARMOR_ACANT','RECIPE_PICARO_GLOVES_ACANT','RECIPE_PICARO_BOOTS_ACANT',
  'RECIPE_SACERDOTE_WEAPON_ACANT','RECIPE_SACERDOTE_OFFHAND_ACANT','RECIPE_SACERDOTE_HELMET_ACANT',
  'RECIPE_SACERDOTE_ARMOR_ACANT','RECIPE_SACERDOTE_GLOVES_ACANT','RECIPE_SACERDOTE_BOOTS_ACANT'
);

-- Z2 LEGENDARIO: 55×1, 54×1, 53×2, 49×2, 50×6
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (55,1),(54,1),(53,2),(49,2),(50,6)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_REY_MONT','RECIPE_GUERRERO_WEAPON2H_REY_MONT','RECIPE_GUERRERO_OFFHAND_REY_MONT',
  'RECIPE_GUERRERO_HELMET_REY_MONT','RECIPE_GUERRERO_ARMOR_REY_MONT','RECIPE_GUERRERO_GLOVES_REY_MONT','RECIPE_GUERRERO_BOOTS_REY_MONT',
  'RECIPE_MAGO_WEAPON_REY_MONT','RECIPE_MAGO_OFFHAND_ORB_REY_MONT','RECIPE_MAGO_OFFHAND_CRYSTAL_REY_MONT',
  'RECIPE_MAGO_HELMET_REY_MONT','RECIPE_MAGO_ARMOR_REY_MONT','RECIPE_MAGO_GLOVES_REY_MONT','RECIPE_MAGO_BOOTS_REY_MONT',
  'RECIPE_ARQUERO_WEAPON_REY_MONT','RECIPE_ARQUERO_OFFHAND_REY_MONT','RECIPE_ARQUERO_HELMET_REY_MONT',
  'RECIPE_ARQUERO_ARMOR_REY_MONT','RECIPE_ARQUERO_GLOVES_REY_MONT','RECIPE_ARQUERO_BOOTS_REY_MONT',
  'RECIPE_PICARO_WEAPON_REY_MONT','RECIPE_PICARO_OFFHAND_REY_MONT','RECIPE_PICARO_HELMET_REY_MONT',
  'RECIPE_PICARO_ARMOR_REY_MONT','RECIPE_PICARO_GLOVES_REY_MONT','RECIPE_PICARO_BOOTS_REY_MONT',
  'RECIPE_SACERDOTE_WEAPON_REY_MONT','RECIPE_SACERDOTE_OFFHAND_REY_MONT','RECIPE_SACERDOTE_HELMET_REY_MONT',
  'RECIPE_SACERDOTE_ARMOR_REY_MONT','RECIPE_SACERDOTE_GLOVES_REY_MONT','RECIPE_SACERDOTE_BOOTS_REY_MONT'
);

-- Z3 EPICO: 63×2, 60×5, 58×4, 57×3
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (63,2),(60,5),(58,4),(57,3)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_CALDERA','RECIPE_GUERRERO_WEAPON2H_CALDERA','RECIPE_GUERRERO_OFFHAND_CALDERA',
  'RECIPE_GUERRERO_HELMET_CALDERA','RECIPE_GUERRERO_ARMOR_CALDERA','RECIPE_GUERRERO_GLOVES_CALDERA','RECIPE_GUERRERO_BOOTS_CALDERA',
  'RECIPE_MAGO_WEAPON_CALDERA','RECIPE_MAGO_OFFHAND_ORB_CALDERA','RECIPE_MAGO_OFFHAND_CRYSTAL_CALDERA',
  'RECIPE_MAGO_HELMET_CALDERA','RECIPE_MAGO_ARMOR_CALDERA','RECIPE_MAGO_GLOVES_CALDERA','RECIPE_MAGO_BOOTS_CALDERA',
  'RECIPE_ARQUERO_WEAPON_CALDERA','RECIPE_ARQUERO_OFFHAND_CALDERA','RECIPE_ARQUERO_HELMET_CALDERA',
  'RECIPE_ARQUERO_ARMOR_CALDERA','RECIPE_ARQUERO_GLOVES_CALDERA','RECIPE_ARQUERO_BOOTS_CALDERA',
  'RECIPE_PICARO_WEAPON_CALDERA','RECIPE_PICARO_OFFHAND_CALDERA','RECIPE_PICARO_HELMET_CALDERA',
  'RECIPE_PICARO_ARMOR_CALDERA','RECIPE_PICARO_GLOVES_CALDERA','RECIPE_PICARO_BOOTS_CALDERA',
  'RECIPE_SACERDOTE_WEAPON_CALDERA','RECIPE_SACERDOTE_OFFHAND_CALDERA','RECIPE_SACERDOTE_HELMET_CALDERA',
  'RECIPE_SACERDOTE_ARMOR_CALDERA','RECIPE_SACERDOTE_GLOVES_CALDERA','RECIPE_SACERDOTE_BOOTS_CALDERA'
);

-- Z3 LEGENDARIO: 64×1, 63×1, 61×2, 58×2, 60×6
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (64,1),(63,1),(61,2),(58,2),(60,6)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_TITAN_F','RECIPE_GUERRERO_WEAPON2H_TITAN_F','RECIPE_GUERRERO_OFFHAND_TITAN_F',
  'RECIPE_GUERRERO_HELMET_TITAN_F','RECIPE_GUERRERO_ARMOR_TITAN_F','RECIPE_GUERRERO_GLOVES_TITAN_F','RECIPE_GUERRERO_BOOTS_TITAN_F',
  'RECIPE_MAGO_WEAPON_TITAN_F','RECIPE_MAGO_OFFHAND_ORB_TITAN_F','RECIPE_MAGO_OFFHAND_CRYSTAL_TITAN_F',
  'RECIPE_MAGO_HELMET_TITAN_F','RECIPE_MAGO_ARMOR_TITAN_F','RECIPE_MAGO_GLOVES_TITAN_F','RECIPE_MAGO_BOOTS_TITAN_F',
  'RECIPE_ARQUERO_WEAPON_TITAN_F','RECIPE_ARQUERO_OFFHAND_TITAN_F','RECIPE_ARQUERO_HELMET_TITAN_F',
  'RECIPE_ARQUERO_ARMOR_TITAN_F','RECIPE_ARQUERO_GLOVES_TITAN_F','RECIPE_ARQUERO_BOOTS_TITAN_F',
  'RECIPE_PICARO_WEAPON_TITAN_F','RECIPE_PICARO_OFFHAND_TITAN_F','RECIPE_PICARO_HELMET_TITAN_F',
  'RECIPE_PICARO_ARMOR_TITAN_F','RECIPE_PICARO_GLOVES_TITAN_F','RECIPE_PICARO_BOOTS_TITAN_F',
  'RECIPE_SACERDOTE_WEAPON_TITAN_F','RECIPE_SACERDOTE_OFFHAND_TITAN_F','RECIPE_SACERDOTE_HELMET_TITAN_F',
  'RECIPE_SACERDOTE_ARMOR_TITAN_F','RECIPE_SACERDOTE_GLOVES_TITAN_F','RECIPE_SACERDOTE_BOOTS_TITAN_F'
);

-- Z4 EPICO: 72×2, 65×5, 68×4, 66×3
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (72,2),(65,5),(68,4),(66,3)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_OCEANO','RECIPE_GUERRERO_WEAPON2H_OCEANO','RECIPE_GUERRERO_OFFHAND_OCEANO',
  'RECIPE_GUERRERO_HELMET_OCEANO','RECIPE_GUERRERO_ARMOR_OCEANO','RECIPE_GUERRERO_GLOVES_OCEANO','RECIPE_GUERRERO_BOOTS_OCEANO',
  'RECIPE_MAGO_WEAPON_OCEANO','RECIPE_MAGO_OFFHAND_ORB_OCEANO','RECIPE_MAGO_OFFHAND_CRYSTAL_OCEANO',
  'RECIPE_MAGO_HELMET_OCEANO','RECIPE_MAGO_ARMOR_OCEANO','RECIPE_MAGO_GLOVES_OCEANO','RECIPE_MAGO_BOOTS_OCEANO',
  'RECIPE_ARQUERO_WEAPON_OCEANO','RECIPE_ARQUERO_OFFHAND_OCEANO','RECIPE_ARQUERO_HELMET_OCEANO',
  'RECIPE_ARQUERO_ARMOR_OCEANO','RECIPE_ARQUERO_GLOVES_OCEANO','RECIPE_ARQUERO_BOOTS_OCEANO',
  'RECIPE_PICARO_WEAPON_OCEANO','RECIPE_PICARO_OFFHAND_OCEANO','RECIPE_PICARO_HELMET_OCEANO',
  'RECIPE_PICARO_ARMOR_OCEANO','RECIPE_PICARO_GLOVES_OCEANO','RECIPE_PICARO_BOOTS_OCEANO',
  'RECIPE_SACERDOTE_WEAPON_OCEANO','RECIPE_SACERDOTE_OFFHAND_OCEANO','RECIPE_SACERDOTE_HELMET_OCEANO',
  'RECIPE_SACERDOTE_ARMOR_OCEANO','RECIPE_SACERDOTE_GLOVES_OCEANO','RECIPE_SACERDOTE_BOOTS_OCEANO'
);

-- Z4 LEGENDARIO: 73×1, 72×1, 70×2, 67×2, 65×6
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (73,1),(72,1),(70,2),(67,2),(65,6)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_PROFU','RECIPE_GUERRERO_WEAPON2H_PROFU','RECIPE_GUERRERO_OFFHAND_PROFU',
  'RECIPE_GUERRERO_HELMET_PROFU','RECIPE_GUERRERO_ARMOR_PROFU','RECIPE_GUERRERO_GLOVES_PROFU','RECIPE_GUERRERO_BOOTS_PROFU',
  'RECIPE_MAGO_WEAPON_PROFU','RECIPE_MAGO_OFFHAND_ORB_PROFU','RECIPE_MAGO_OFFHAND_CRYSTAL_PROFU',
  'RECIPE_MAGO_HELMET_PROFU','RECIPE_MAGO_ARMOR_PROFU','RECIPE_MAGO_GLOVES_PROFU','RECIPE_MAGO_BOOTS_PROFU',
  'RECIPE_ARQUERO_WEAPON_PROFU','RECIPE_ARQUERO_OFFHAND_PROFU','RECIPE_ARQUERO_HELMET_PROFU',
  'RECIPE_ARQUERO_ARMOR_PROFU','RECIPE_ARQUERO_GLOVES_PROFU','RECIPE_ARQUERO_BOOTS_PROFU',
  'RECIPE_PICARO_WEAPON_PROFU','RECIPE_PICARO_OFFHAND_PROFU','RECIPE_PICARO_HELMET_PROFU',
  'RECIPE_PICARO_ARMOR_PROFU','RECIPE_PICARO_GLOVES_PROFU','RECIPE_PICARO_BOOTS_PROFU',
  'RECIPE_SACERDOTE_WEAPON_PROFU','RECIPE_SACERDOTE_OFFHAND_PROFU','RECIPE_SACERDOTE_HELMET_PROFU',
  'RECIPE_SACERDOTE_ARMOR_PROFU','RECIPE_SACERDOTE_GLOVES_PROFU','RECIPE_SACERDOTE_BOOTS_PROFU'
);

-- Z5 LEGENDARIO: 82×1, 81×2, 78×6, 80×1, 77×4
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (82,1),(81,2),(78,6),(80,1),(77,4)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_REY_HIELO','RECIPE_GUERRERO_WEAPON2H_REY_HIELO','RECIPE_GUERRERO_OFFHAND_REY_HIELO',
  'RECIPE_GUERRERO_HELMET_REY_HIELO','RECIPE_GUERRERO_ARMOR_REY_HIELO','RECIPE_GUERRERO_GLOVES_REY_HIELO','RECIPE_GUERRERO_BOOTS_REY_HIELO',
  'RECIPE_MAGO_WEAPON_REY_HIELO','RECIPE_MAGO_OFFHAND_ORB_REY_HIELO','RECIPE_MAGO_OFFHAND_CRYSTAL_REY_HIELO',
  'RECIPE_MAGO_HELMET_REY_HIELO','RECIPE_MAGO_ARMOR_REY_HIELO','RECIPE_MAGO_GLOVES_REY_HIELO','RECIPE_MAGO_BOOTS_REY_HIELO',
  'RECIPE_ARQUERO_WEAPON_REY_HIELO','RECIPE_ARQUERO_OFFHAND_REY_HIELO','RECIPE_ARQUERO_HELMET_REY_HIELO',
  'RECIPE_ARQUERO_ARMOR_REY_HIELO','RECIPE_ARQUERO_GLOVES_REY_HIELO','RECIPE_ARQUERO_BOOTS_REY_HIELO',
  'RECIPE_PICARO_WEAPON_REY_HIELO','RECIPE_PICARO_OFFHAND_REY_HIELO','RECIPE_PICARO_HELMET_REY_HIELO',
  'RECIPE_PICARO_ARMOR_REY_HIELO','RECIPE_PICARO_GLOVES_REY_HIELO','RECIPE_PICARO_BOOTS_REY_HIELO',
  'RECIPE_SACERDOTE_WEAPON_REY_HIELO','RECIPE_SACERDOTE_OFFHAND_REY_HIELO','RECIPE_SACERDOTE_HELMET_REY_HIELO',
  'RECIPE_SACERDOTE_ARMOR_REY_HIELO','RECIPE_SACERDOTE_GLOVES_REY_HIELO','RECIPE_SACERDOTE_BOOTS_REY_HIELO'
);

-- Z6 LEGENDARIO: 91×1, 90×2, 83×6, 88×1, 87×4
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT r.id, v.item_id, v.qty FROM crafting_recipes r
CROSS JOIN (VALUES (91,1),(90,2),(83,6),(88,1),(87,4)) v(item_id,qty)
WHERE r.code IN (
  'RECIPE_GUERRERO_WEAPON_LICH','RECIPE_GUERRERO_WEAPON2H_LICH','RECIPE_GUERRERO_OFFHAND_LICH',
  'RECIPE_GUERRERO_HELMET_LICH','RECIPE_GUERRERO_ARMOR_LICH','RECIPE_GUERRERO_GLOVES_LICH','RECIPE_GUERRERO_BOOTS_LICH',
  'RECIPE_MAGO_WEAPON_LICH','RECIPE_MAGO_OFFHAND_ORB_LICH','RECIPE_MAGO_OFFHAND_CRYSTAL_LICH',
  'RECIPE_MAGO_HELMET_LICH','RECIPE_MAGO_ARMOR_LICH','RECIPE_MAGO_GLOVES_LICH','RECIPE_MAGO_BOOTS_LICH',
  'RECIPE_ARQUERO_WEAPON_LICH','RECIPE_ARQUERO_OFFHAND_LICH','RECIPE_ARQUERO_HELMET_LICH',
  'RECIPE_ARQUERO_ARMOR_LICH','RECIPE_ARQUERO_GLOVES_LICH','RECIPE_ARQUERO_BOOTS_LICH',
  'RECIPE_PICARO_WEAPON_LICH','RECIPE_PICARO_OFFHAND_LICH','RECIPE_PICARO_HELMET_LICH',
  'RECIPE_PICARO_ARMOR_LICH','RECIPE_PICARO_GLOVES_LICH','RECIPE_PICARO_BOOTS_LICH',
  'RECIPE_SACERDOTE_WEAPON_LICH','RECIPE_SACERDOTE_OFFHAND_LICH','RECIPE_SACERDOTE_HELMET_LICH',
  'RECIPE_SACERDOTE_ARMOR_LICH','RECIPE_SACERDOTE_GLOVES_LICH','RECIPE_SACERDOTE_BOOTS_LICH'
);

-- ─── combat_abandoned_players ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS combat_abandoned_players (
  session_id   INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  player_id    INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  penalized    BOOLEAN NOT NULL DEFAULT FALSE,
  abandoned_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id)
);

-- =============================================================================
-- MIGRACIÓN: Scrolls de clase + Accesorios de set de boss
-- =============================================================================
-- Parte 1: 50 scrolls de clase (IDs 737-786)
-- Parte 2: 50 accesorios (IDs 787-836)
-- Parte 3: stats de accesorios
-- Parte 4: recetas de accesorios
-- Parte 5: ingredientes de recetas
-- Parte 6: reasignar scroll_item_id en recetas de equipo existentes
-- Parte 7: monster_drops para scrolls de clase
-- Parte 8: fix rollMonsterDrops (en combat.js, no SQL)
-- =============================================================================

-- PARTE 1: Scrolls de clase (MATERIAL, no craftable, obtenido por DROP)
INSERT INTO items(id, code, name, item_type, rarity, is_craftable, obtain_method, description) VALUES
-- Capitán (EPICO) — scroll_original=45
(737,'SCROLL_CAPITAN_GUERRERO','Collar del Capitán (Guerrero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Capitán. Desbloquea el set Épico del Capitán para Guerrero.'),
(738,'SCROLL_CAPITAN_MAGO','Collar del Capitán (Mago)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Capitán. Desbloquea el set Épico del Capitán para Mago.'),
(739,'SCROLL_CAPITAN_ARQUERO','Collar del Capitán (Arquero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Capitán. Desbloquea el set Épico del Capitán para Arquero.'),
(740,'SCROLL_CAPITAN_PICARO','Collar del Capitán (Pícaro)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Capitán. Desbloquea el set Épico del Capitán para Pícaro.'),
(741,'SCROLL_CAPITAN_SACERDOTE','Collar del Capitán (Sacerdote)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Capitán. Desbloquea el set Épico del Capitán para Sacerdote.'),
-- Titán de la Pradera (LEGENDARIO) — scroll_original=46
(742,'SCROLL_TITAN_GUERRERO','Núcleo del Titán (Guerrero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán. Desbloquea el set Legendario del Titán para Guerrero.'),
(743,'SCROLL_TITAN_MAGO','Núcleo del Titán (Mago)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán. Desbloquea el set Legendario del Titán para Mago.'),
(744,'SCROLL_TITAN_ARQUERO','Núcleo del Titán (Arquero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán. Desbloquea el set Legendario del Titán para Arquero.'),
(745,'SCROLL_TITAN_PICARO','Núcleo del Titán (Pícaro)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán. Desbloquea el set Legendario del Titán para Pícaro.'),
(746,'SCROLL_TITAN_SACERDOTE','Núcleo del Titán (Sacerdote)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán. Desbloquea el set Legendario del Titán para Sacerdote.'),
-- Señor del Acantilado (EPICO) — scroll_original=54
(747,'SCROLL_ACANTILADO_GUERRERO','Yelmo del Acantilado (Guerrero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Acantilado. Desbloquea el set Épico del Acantilado para Guerrero.'),
(748,'SCROLL_ACANTILADO_MAGO','Yelmo del Acantilado (Mago)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Acantilado. Desbloquea el set Épico del Acantilado para Mago.'),
(749,'SCROLL_ACANTILADO_ARQUERO','Yelmo del Acantilado (Arquero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Acantilado. Desbloquea el set Épico del Acantilado para Arquero.'),
(750,'SCROLL_ACANTILADO_PICARO','Yelmo del Acantilado (Pícaro)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Acantilado. Desbloquea el set Épico del Acantilado para Pícaro.'),
(751,'SCROLL_ACANTILADO_SACERDOTE','Yelmo del Acantilado (Sacerdote)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Acantilado. Desbloquea el set Épico del Acantilado para Sacerdote.'),
-- Rey de Montaña (LEGENDARIO) — scroll_original=55
(752,'SCROLL_REY_MONTANA_GUERRERO','Corona del Rey de Montaña (Guerrero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey. Desbloquea el set Legendario del Rey de Montaña para Guerrero.'),
(753,'SCROLL_REY_MONTANA_MAGO','Corona del Rey de Montaña (Mago)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey. Desbloquea el set Legendario del Rey de Montaña para Mago.'),
(754,'SCROLL_REY_MONTANA_ARQUERO','Corona del Rey de Montaña (Arquero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey. Desbloquea el set Legendario del Rey de Montaña para Arquero.'),
(755,'SCROLL_REY_MONTANA_PICARO','Corona del Rey de Montaña (Pícaro)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey. Desbloquea el set Legendario del Rey de Montaña para Pícaro.'),
(756,'SCROLL_REY_MONTANA_SACERDOTE','Corona del Rey de Montaña (Sacerdote)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey. Desbloquea el set Legendario del Rey de Montaña para Sacerdote.'),
-- Señor de la Caldera (EPICO) — scroll_original=63
(757,'SCROLL_CALDERA_GUERRERO','Corazón de la Caldera (Guerrero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder de la Caldera. Desbloquea el set Épico de la Caldera para Guerrero.'),
(758,'SCROLL_CALDERA_MAGO','Corazón de la Caldera (Mago)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder de la Caldera. Desbloquea el set Épico de la Caldera para Mago.'),
(759,'SCROLL_CALDERA_ARQUERO','Corazón de la Caldera (Arquero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder de la Caldera. Desbloquea el set Épico de la Caldera para Arquero.'),
(760,'SCROLL_CALDERA_PICARO','Corazón de la Caldera (Pícaro)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder de la Caldera. Desbloquea el set Épico de la Caldera para Pícaro.'),
(761,'SCROLL_CALDERA_SACERDOTE','Corazón de la Caldera (Sacerdote)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder de la Caldera. Desbloquea el set Épico de la Caldera para Sacerdote.'),
-- Titán de Fuego (LEGENDARIO) — scroll_original=64
(762,'SCROLL_TITAN_FUEGO_GUERRERO','Núcleo del Titán de Fuego (Guerrero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán de Fuego. Desbloquea el set Legendario del Titán de Fuego para Guerrero.'),
(763,'SCROLL_TITAN_FUEGO_MAGO','Núcleo del Titán de Fuego (Mago)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán de Fuego. Desbloquea el set Legendario del Titán de Fuego para Mago.'),
(764,'SCROLL_TITAN_FUEGO_ARQUERO','Núcleo del Titán de Fuego (Arquero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán de Fuego. Desbloquea el set Legendario del Titán de Fuego para Arquero.'),
(765,'SCROLL_TITAN_FUEGO_PICARO','Núcleo del Titán de Fuego (Pícaro)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán de Fuego. Desbloquea el set Legendario del Titán de Fuego para Pícaro.'),
(766,'SCROLL_TITAN_FUEGO_SACERDOTE','Núcleo del Titán de Fuego (Sacerdote)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Titán de Fuego. Desbloquea el set Legendario del Titán de Fuego para Sacerdote.'),
-- Señor del Océano (EPICO) — scroll_original=72
(767,'SCROLL_OCEANO_GUERRERO','Tridente del Océano (Guerrero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Océano. Desbloquea el set Épico del Océano para Guerrero.'),
(768,'SCROLL_OCEANO_MAGO','Tridente del Océano (Mago)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Océano. Desbloquea el set Épico del Océano para Mago.'),
(769,'SCROLL_OCEANO_ARQUERO','Tridente del Océano (Arquero)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Océano. Desbloquea el set Épico del Océano para Arquero.'),
(770,'SCROLL_OCEANO_PICARO','Tridente del Océano (Pícaro)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Océano. Desbloquea el set Épico del Océano para Pícaro.'),
(771,'SCROLL_OCEANO_SACERDOTE','Tridente del Océano (Sacerdote)','MATERIAL','EPICO',FALSE,'DROP','Fragmento del poder del Océano. Desbloquea el set Épico del Océano para Sacerdote.'),
-- Bestia de las Profundidades (LEGENDARIO) — scroll_original=73
(772,'SCROLL_BESTIA_GUERRERO','Núcleo de las Profundidades (Guerrero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder de la Bestia. Desbloquea el set Legendario de las Profundidades para Guerrero.'),
(773,'SCROLL_BESTIA_MAGO','Núcleo de las Profundidades (Mago)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder de la Bestia. Desbloquea el set Legendario de las Profundidades para Mago.'),
(774,'SCROLL_BESTIA_ARQUERO','Núcleo de las Profundidades (Arquero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder de la Bestia. Desbloquea el set Legendario de las Profundidades para Arquero.'),
(775,'SCROLL_BESTIA_PICARO','Núcleo de las Profundidades (Pícaro)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder de la Bestia. Desbloquea el set Legendario de las Profundidades para Pícaro.'),
(776,'SCROLL_BESTIA_SACERDOTE','Núcleo de las Profundidades (Sacerdote)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder de la Bestia. Desbloquea el set Legendario de las Profundidades para Sacerdote.'),
-- Rey del Hielo (LEGENDARIO) — scroll_original=82
(777,'SCROLL_REY_HIELO_GUERRERO','Corona del Rey del Hielo (Guerrero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey del Hielo. Desbloquea el set Legendario del Rey del Hielo para Guerrero.'),
(778,'SCROLL_REY_HIELO_MAGO','Corona del Rey del Hielo (Mago)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey del Hielo. Desbloquea el set Legendario del Rey del Hielo para Mago.'),
(779,'SCROLL_REY_HIELO_ARQUERO','Corona del Rey del Hielo (Arquero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey del Hielo. Desbloquea el set Legendario del Rey del Hielo para Arquero.'),
(780,'SCROLL_REY_HIELO_PICARO','Corona del Rey del Hielo (Pícaro)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey del Hielo. Desbloquea el set Legendario del Rey del Hielo para Pícaro.'),
(781,'SCROLL_REY_HIELO_SACERDOTE','Corona del Rey del Hielo (Sacerdote)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Rey del Hielo. Desbloquea el set Legendario del Rey del Hielo para Sacerdote.'),
-- Lich Ancestral (LEGENDARIO) — scroll_original=91
(782,'SCROLL_LICH_GUERRERO','Corazón del Lich (Guerrero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Lich. Desbloquea el set Legendario del Lich para Guerrero.'),
(783,'SCROLL_LICH_MAGO','Corazón del Lich (Mago)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Lich. Desbloquea el set Legendario del Lich para Mago.'),
(784,'SCROLL_LICH_ARQUERO','Corazón del Lich (Arquero)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Lich. Desbloquea el set Legendario del Lich para Arquero.'),
(785,'SCROLL_LICH_PICARO','Corazón del Lich (Pícaro)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Lich. Desbloquea el set Legendario del Lich para Pícaro.'),
(786,'SCROLL_LICH_SACERDOTE','Corazón del Lich (Sacerdote)','MATERIAL','LEGENDARIO',FALSE,'DROP','Fragmento del poder del Lich. Desbloquea el set Legendario del Lich para Sacerdote.');

-- PARTE 2: Accesorios (slot=ACCESSORY, class_id=NULL, is_craftable=TRUE)
-- Brazalete=Guerrero  Amuleto=Mago  Colgante=Arquero  Medallón=Pícaro  Relicario=Sacerdote
INSERT INTO items(id, code, name, item_type, slot, rarity, class_id, required_level, is_craftable, obtain_method, description) VALUES
-- Capitán (EPICO, lv20)
(787,'BRAZALETE_CAPITAN','Brazalete del Capitán','EQUIPMENT','ACCESSORY','EPICO',NULL,20,TRUE,'CRAFT','Brazalete forjado con el poder del Capitán de los Lobos.'),
(788,'AMULETO_CAPITAN_MAGO','Amuleto del Capitán','EQUIPMENT','ACCESSORY','EPICO',NULL,20,TRUE,'CRAFT','Amuleto imbuido con la magia del Capitán de los Lobos.'),
(789,'COLGANTE_CAPITAN','Colgante del Capitán','EQUIPMENT','ACCESSORY','EPICO',NULL,20,TRUE,'CRAFT','Colgante tallado con la precisión del Capitán de los Lobos.'),
(790,'MEDALLON_CAPITAN','Medallón del Capitán','EQUIPMENT','ACCESSORY','EPICO',NULL,20,TRUE,'CRAFT','Medallón forjado con la agilidad del Capitán de los Lobos.'),
(791,'RELICARIO_CAPITAN','Relicario del Capitán','EQUIPMENT','ACCESSORY','EPICO',NULL,20,TRUE,'CRAFT','Relicario sagrado bendecido por el Capitán de los Lobos.'),
-- Titán de la Pradera (LEGENDARIO, lv25)
(792,'BRAZALETE_TITAN','Brazalete del Titán','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,25,TRUE,'CRAFT','Brazalete forjado con el poder del Titán de la Pradera.'),
(793,'AMULETO_TITAN_MAGO','Amuleto del Titán','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,25,TRUE,'CRAFT','Amuleto imbuido con la magia del Titán de la Pradera.'),
(794,'COLGANTE_TITAN','Colgante del Titán','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,25,TRUE,'CRAFT','Colgante tallado con la precisión del Titán de la Pradera.'),
(795,'MEDALLON_TITAN','Medallón del Titán','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,25,TRUE,'CRAFT','Medallón forjado con la agilidad del Titán de la Pradera.'),
(796,'RELICARIO_TITAN','Relicario del Titán','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,25,TRUE,'CRAFT','Relicario sagrado del Titán de la Pradera.'),
-- Señor del Acantilado (EPICO, lv30)
(797,'BRAZALETE_ACANTILADO','Brazalete del Acantilado','EQUIPMENT','ACCESSORY','EPICO',NULL,30,TRUE,'CRAFT','Brazalete forjado con el poder del Señor del Acantilado.'),
(798,'AMULETO_ACANTILADO_MAGO','Amuleto del Acantilado','EQUIPMENT','ACCESSORY','EPICO',NULL,30,TRUE,'CRAFT','Amuleto imbuido con la magia del Señor del Acantilado.'),
(799,'COLGANTE_ACANTILADO','Colgante del Acantilado','EQUIPMENT','ACCESSORY','EPICO',NULL,30,TRUE,'CRAFT','Colgante tallado con la precisión del Señor del Acantilado.'),
(800,'MEDALLON_ACANTILADO','Medallón del Acantilado','EQUIPMENT','ACCESSORY','EPICO',NULL,30,TRUE,'CRAFT','Medallón forjado con la agilidad del Señor del Acantilado.'),
(801,'RELICARIO_ACANTILADO','Relicario del Acantilado','EQUIPMENT','ACCESSORY','EPICO',NULL,30,TRUE,'CRAFT','Relicario sagrado del Señor del Acantilado.'),
-- Rey de Montaña (LEGENDARIO, lv35)
(802,'BRAZALETE_REY_MONTANA','Brazalete del Rey de las Montañas','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,35,TRUE,'CRAFT','Brazalete forjado con el poder del Rey de Montaña.'),
(803,'AMULETO_REY_MONTANA_MAGO','Amuleto del Rey de las Montañas','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,35,TRUE,'CRAFT','Amuleto imbuido con la magia del Rey de Montaña.'),
(804,'COLGANTE_REY_MONTANA','Colgante del Rey de las Montañas','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,35,TRUE,'CRAFT','Colgante tallado con la precisión del Rey de Montaña.'),
(805,'MEDALLON_REY_MONTANA','Medallón del Rey de las Montañas','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,35,TRUE,'CRAFT','Medallón forjado con la agilidad del Rey de Montaña.'),
(806,'RELICARIO_REY_MONTANA','Relicario del Rey de las Montañas','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,35,TRUE,'CRAFT','Relicario sagrado del Rey de Montaña.'),
-- Señor de la Caldera (EPICO, lv40)
(807,'BRAZALETE_CALDERA','Brazalete de la Caldera','EQUIPMENT','ACCESSORY','EPICO',NULL,40,TRUE,'CRAFT','Brazalete forjado con el poder del Señor de la Caldera.'),
(808,'AMULETO_CALDERA_MAGO','Amuleto de la Caldera','EQUIPMENT','ACCESSORY','EPICO',NULL,40,TRUE,'CRAFT','Amuleto imbuido con la magia del Señor de la Caldera.'),
(809,'COLGANTE_CALDERA','Colgante de la Caldera','EQUIPMENT','ACCESSORY','EPICO',NULL,40,TRUE,'CRAFT','Colgante tallado con la precisión del Señor de la Caldera.'),
(810,'MEDALLON_CALDERA','Medallón de la Caldera','EQUIPMENT','ACCESSORY','EPICO',NULL,40,TRUE,'CRAFT','Medallón forjado con la agilidad del Señor de la Caldera.'),
(811,'RELICARIO_CALDERA','Relicario de la Caldera','EQUIPMENT','ACCESSORY','EPICO',NULL,40,TRUE,'CRAFT','Relicario sagrado de la Caldera.'),
-- Titán de Fuego (LEGENDARIO, lv45)
(812,'BRAZALETE_TITAN_FUEGO','Brazalete del Titán de Fuego','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,45,TRUE,'CRAFT','Brazalete forjado con el poder del Titán de Fuego.'),
(813,'AMULETO_TITAN_FUEGO_MAGO','Amuleto del Titán de Fuego','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,45,TRUE,'CRAFT','Amuleto imbuido con la magia del Titán de Fuego.'),
(814,'COLGANTE_TITAN_FUEGO','Colgante del Titán de Fuego','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,45,TRUE,'CRAFT','Colgante tallado con la precisión del Titán de Fuego.'),
(815,'MEDALLON_TITAN_FUEGO','Medallón del Titán de Fuego','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,45,TRUE,'CRAFT','Medallón forjado con la agilidad del Titán de Fuego.'),
(816,'RELICARIO_TITAN_FUEGO','Relicario del Titán de Fuego','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,45,TRUE,'CRAFT','Relicario sagrado del Titán de Fuego.'),
-- Señor del Océano (EPICO, lv50)
(817,'BRAZALETE_OCEANO','Brazalete del Océano','EQUIPMENT','ACCESSORY','EPICO',NULL,50,TRUE,'CRAFT','Brazalete forjado con el poder del Señor del Océano.'),
(818,'AMULETO_OCEANO_MAGO','Amuleto del Océano','EQUIPMENT','ACCESSORY','EPICO',NULL,50,TRUE,'CRAFT','Amuleto imbuido con la magia del Señor del Océano.'),
(819,'COLGANTE_OCEANO','Colgante del Océano','EQUIPMENT','ACCESSORY','EPICO',NULL,50,TRUE,'CRAFT','Colgante tallado con la precisión del Señor del Océano.'),
(820,'MEDALLON_OCEANO','Medallón del Océano','EQUIPMENT','ACCESSORY','EPICO',NULL,50,TRUE,'CRAFT','Medallón forjado con la agilidad del Señor del Océano.'),
(821,'RELICARIO_OCEANO','Relicario del Océano','EQUIPMENT','ACCESSORY','EPICO',NULL,50,TRUE,'CRAFT','Relicario sagrado del Océano.'),
-- Bestia de las Profundidades (LEGENDARIO, lv55)
(822,'BRAZALETE_PROFUNDIDADES','Brazalete de las Profundidades','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,55,TRUE,'CRAFT','Brazalete forjado con el poder de la Bestia de las Profundidades.'),
(823,'AMULETO_PROFUNDIDADES_MAGO','Amuleto de las Profundidades','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,55,TRUE,'CRAFT','Amuleto imbuido con la magia de la Bestia de las Profundidades.'),
(824,'COLGANTE_PROFUNDIDADES','Colgante de las Profundidades','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,55,TRUE,'CRAFT','Colgante tallado con la precisión de la Bestia de las Profundidades.'),
(825,'MEDALLON_PROFUNDIDADES','Medallón de las Profundidades','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,55,TRUE,'CRAFT','Medallón forjado con la agilidad de la Bestia de las Profundidades.'),
(826,'RELICARIO_PROFUNDIDADES','Relicario de las Profundidades','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,55,TRUE,'CRAFT','Relicario sagrado de las Profundidades.'),
-- Rey del Hielo (LEGENDARIO, lv70)
(827,'BRAZALETE_REY_HIELO','Brazalete del Rey del Hielo','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,70,TRUE,'CRAFT','Brazalete forjado con el poder del Rey del Hielo.'),
(828,'AMULETO_REY_HIELO_MAGO','Amuleto del Rey del Hielo','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,70,TRUE,'CRAFT','Amuleto imbuido con la magia del Rey del Hielo.'),
(829,'COLGANTE_REY_HIELO','Colgante del Rey del Hielo','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,70,TRUE,'CRAFT','Colgante tallado con la precisión del Rey del Hielo.'),
(830,'MEDALLON_REY_HIELO','Medallón del Rey del Hielo','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,70,TRUE,'CRAFT','Medallón forjado con la agilidad del Rey del Hielo.'),
(831,'RELICARIO_REY_HIELO','Relicario del Rey del Hielo','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,70,TRUE,'CRAFT','Relicario sagrado del Rey del Hielo.'),
-- Lich Ancestral (LEGENDARIO, lv80)
(832,'BRAZALETE_LICH','Brazalete del Lich','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,80,TRUE,'CRAFT','Brazalete forjado con el poder del Lich Ancestral.'),
(833,'AMULETO_LICH_MAGO','Amuleto del Lich','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,80,TRUE,'CRAFT','Amuleto imbuido con la magia del Lich Ancestral.'),
(834,'COLGANTE_LICH','Colgante del Lich','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,80,TRUE,'CRAFT','Colgante tallado con la precisión del Lich Ancestral.'),
(835,'MEDALLON_LICH','Medallón del Lich','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,80,TRUE,'CRAFT','Medallón forjado con la agilidad del Lich Ancestral.'),
(836,'RELICARIO_LICH','Relicario del Lich','EQUIPMENT','ACCESSORY','LEGENDARIO',NULL,80,TRUE,'CRAFT','Relicario sagrado del Lich Ancestral.');

SELECT setval('items_id_seq', 836);

-- PARTE 3: Stats de accesorios
-- Brazalete (Guerrero): ATK + HP
-- Amuleto (Mago): MAG + MAGIC_DEF
-- Colgante (Arquero): SPD + CRIT_CHANCE%
-- Medallón (Pícaro): EVASION% + CRIT_CHANCE%
-- Relicario (Sacerdote): HEALING% + HP
INSERT INTO item_stat_bonuses(item_id, stat_code, amount, is_percent) VALUES
-- Capitán EPICO lv20
(787,'ATK',18,FALSE),(787,'HP',25,FALSE),
(788,'MAG',18,FALSE),(788,'MAGIC_DEF',12,FALSE),
(789,'SPD',28,FALSE),(789,'CRIT_CHANCE',14,TRUE),
(790,'EVASION',8,TRUE),(790,'CRIT_CHANCE',14,TRUE),
(791,'HEALING',10,TRUE),(791,'HP',25,FALSE),
-- Titán Pradera LEGENDARIO lv25
(792,'ATK',21,FALSE),(792,'HP',29,FALSE),
(793,'MAG',21,FALSE),(793,'MAGIC_DEF',14,FALSE),
(794,'SPD',32,FALSE),(794,'CRIT_CHANCE',16,TRUE),
(795,'EVASION',9,TRUE),(795,'CRIT_CHANCE',16,TRUE),
(796,'HEALING',12,TRUE),(796,'HP',29,FALSE),
-- Señor Acantilado EPICO lv30
(797,'ATK',22,FALSE),(797,'HP',31,FALSE),
(798,'MAG',22,FALSE),(798,'MAGIC_DEF',15,FALSE),
(799,'SPD',35,FALSE),(799,'CRIT_CHANCE',17,TRUE),
(800,'EVASION',10,TRUE),(800,'CRIT_CHANCE',17,TRUE),
(801,'HEALING',13,TRUE),(801,'HP',31,FALSE),
-- Rey Montaña LEGENDARIO lv35
(802,'ATK',26,FALSE),(802,'HP',36,FALSE),
(803,'MAG',26,FALSE),(803,'MAGIC_DEF',17,FALSE),
(804,'SPD',40,FALSE),(804,'CRIT_CHANCE',20,TRUE),
(805,'EVASION',11,TRUE),(805,'CRIT_CHANCE',20,TRUE),
(806,'HEALING',15,TRUE),(806,'HP',36,FALSE),
-- Caldera EPICO lv40
(807,'ATK',28,FALSE),(807,'HP',39,FALSE),
(808,'MAG',28,FALSE),(808,'MAGIC_DEF',19,FALSE),
(809,'SPD',44,FALSE),(809,'CRIT_CHANCE',22,TRUE),
(810,'EVASION',12,TRUE),(810,'CRIT_CHANCE',22,TRUE),
(811,'HEALING',16,TRUE),(811,'HP',39,FALSE),
-- Titán Fuego LEGENDARIO lv45
(812,'ATK',32,FALSE),(812,'HP',45,FALSE),
(813,'MAG',32,FALSE),(813,'MAGIC_DEF',22,FALSE),
(814,'SPD',50,FALSE),(814,'CRIT_CHANCE',25,TRUE),
(815,'EVASION',14,TRUE),(815,'CRIT_CHANCE',25,TRUE),
(816,'HEALING',18,TRUE),(816,'HP',45,FALSE),
-- Señor Océano EPICO lv50
(817,'ATK',35,FALSE),(817,'HP',49,FALSE),
(818,'MAG',35,FALSE),(818,'MAGIC_DEF',24,FALSE),
(819,'SPD',55,FALSE),(819,'CRIT_CHANCE',27,TRUE),
(820,'EVASION',15,TRUE),(820,'CRIT_CHANCE',27,TRUE),
(821,'HEALING',20,TRUE),(821,'HP',49,FALSE),
-- Bestia Profundidades LEGENDARIO lv55
(822,'ATK',40,FALSE),(822,'HP',56,FALSE),
(823,'MAG',40,FALSE),(823,'MAGIC_DEF',27,FALSE),
(824,'SPD',63,FALSE),(824,'CRIT_CHANCE',31,TRUE),
(825,'EVASION',17,TRUE),(825,'CRIT_CHANCE',31,TRUE),
(826,'HEALING',23,TRUE),(826,'HP',56,FALSE),
-- Rey Hielo LEGENDARIO lv70
(827,'ATK',46,FALSE),(827,'HP',64,FALSE),
(828,'MAG',46,FALSE),(828,'MAGIC_DEF',31,FALSE),
(829,'SPD',72,FALSE),(829,'CRIT_CHANCE',36,TRUE),
(830,'EVASION',20,TRUE),(830,'CRIT_CHANCE',36,TRUE),
(831,'HEALING',26,TRUE),(831,'HP',64,FALSE),
-- Lich Ancestral LEGENDARIO lv80
(832,'ATK',52,FALSE),(832,'HP',72,FALSE),
(833,'MAG',52,FALSE),(833,'MAGIC_DEF',35,FALSE),
(834,'SPD',81,FALSE),(834,'CRIT_CHANCE',40,TRUE),
(835,'EVASION',23,TRUE),(835,'CRIT_CHANCE',40,TRUE),
(836,'HEALING',30,TRUE),(836,'HP',72,FALSE);

-- PARTE 4: Recetas de crafteo para accesorios
-- scroll_item_id = scroll de clase correspondiente
-- required_class_id = NULL (cualquier clase puede craftear si tiene el scroll)
-- EPICO: success_rate=70, required_rank='D'
-- LEGENDARIO: success_rate=55, required_rank='C'
INSERT INTO crafting_recipes(id, code, result_item_id, scroll_item_id, required_class_id, success_rate, required_rank) VALUES
-- Capitán EPICO (scrolls 737-741, acc 787-791)
(601,'RECIPE_GUERRERO_ACC_CAPITAN',787,737,NULL,70,'D'),
(602,'RECIPE_MAGO_ACC_CAPITAN',788,738,NULL,70,'D'),
(603,'RECIPE_ARQUERO_ACC_CAPITAN',789,739,NULL,70,'D'),
(604,'RECIPE_PICARO_ACC_CAPITAN',790,740,NULL,70,'D'),
(605,'RECIPE_SACERDOTE_ACC_CAPITAN',791,741,NULL,70,'D'),
-- Titán Pradera LEGENDARIO (scrolls 742-746, acc 792-796)
(606,'RECIPE_GUERRERO_ACC_TITAN',792,742,NULL,55,'C'),
(607,'RECIPE_MAGO_ACC_TITAN',793,743,NULL,55,'C'),
(608,'RECIPE_ARQUERO_ACC_TITAN',794,744,NULL,55,'C'),
(609,'RECIPE_PICARO_ACC_TITAN',795,745,NULL,55,'C'),
(610,'RECIPE_SACERDOTE_ACC_TITAN',796,746,NULL,55,'C'),
-- Señor Acantilado EPICO (scrolls 747-751, acc 797-801)
(611,'RECIPE_GUERRERO_ACC_ACANTILADO',797,747,NULL,70,'D'),
(612,'RECIPE_MAGO_ACC_ACANTILADO',798,748,NULL,70,'D'),
(613,'RECIPE_ARQUERO_ACC_ACANTILADO',799,749,NULL,70,'D'),
(614,'RECIPE_PICARO_ACC_ACANTILADO',800,750,NULL,70,'D'),
(615,'RECIPE_SACERDOTE_ACC_ACANTILADO',801,751,NULL,70,'D'),
-- Rey Montaña LEGENDARIO (scrolls 752-756, acc 802-806)
(616,'RECIPE_GUERRERO_ACC_REY_MONTANA',802,752,NULL,55,'C'),
(617,'RECIPE_MAGO_ACC_REY_MONTANA',803,753,NULL,55,'C'),
(618,'RECIPE_ARQUERO_ACC_REY_MONTANA',804,754,NULL,55,'C'),
(619,'RECIPE_PICARO_ACC_REY_MONTANA',805,755,NULL,55,'C'),
(620,'RECIPE_SACERDOTE_ACC_REY_MONTANA',806,756,NULL,55,'C'),
-- Caldera EPICO (scrolls 757-761, acc 807-811)
(621,'RECIPE_GUERRERO_ACC_CALDERA',807,757,NULL,70,'D'),
(622,'RECIPE_MAGO_ACC_CALDERA',808,758,NULL,70,'D'),
(623,'RECIPE_ARQUERO_ACC_CALDERA',809,759,NULL,70,'D'),
(624,'RECIPE_PICARO_ACC_CALDERA',810,760,NULL,70,'D'),
(625,'RECIPE_SACERDOTE_ACC_CALDERA',811,761,NULL,70,'D'),
-- Titán Fuego LEGENDARIO (scrolls 762-766, acc 812-816)
(626,'RECIPE_GUERRERO_ACC_TITAN_FUEGO',812,762,NULL,55,'C'),
(627,'RECIPE_MAGO_ACC_TITAN_FUEGO',813,763,NULL,55,'C'),
(628,'RECIPE_ARQUERO_ACC_TITAN_FUEGO',814,764,NULL,55,'C'),
(629,'RECIPE_PICARO_ACC_TITAN_FUEGO',815,765,NULL,55,'C'),
(630,'RECIPE_SACERDOTE_ACC_TITAN_FUEGO',816,766,NULL,55,'C'),
-- Señor Océano EPICO (scrolls 767-771, acc 817-821)
(631,'RECIPE_GUERRERO_ACC_OCEANO',817,767,NULL,70,'D'),
(632,'RECIPE_MAGO_ACC_OCEANO',818,768,NULL,70,'D'),
(633,'RECIPE_ARQUERO_ACC_OCEANO',819,769,NULL,70,'D'),
(634,'RECIPE_PICARO_ACC_OCEANO',820,770,NULL,70,'D'),
(635,'RECIPE_SACERDOTE_ACC_OCEANO',821,771,NULL,70,'D'),
-- Bestia Profundidades LEGENDARIO (scrolls 772-776, acc 822-826)
(636,'RECIPE_GUERRERO_ACC_BESTIA',822,772,NULL,55,'C'),
(637,'RECIPE_MAGO_ACC_BESTIA',823,773,NULL,55,'C'),
(638,'RECIPE_ARQUERO_ACC_BESTIA',824,774,NULL,55,'C'),
(639,'RECIPE_PICARO_ACC_BESTIA',825,775,NULL,55,'C'),
(640,'RECIPE_SACERDOTE_ACC_BESTIA',826,776,NULL,55,'C'),
-- Rey Hielo LEGENDARIO (scrolls 777-781, acc 827-831)
(641,'RECIPE_GUERRERO_ACC_REY_HIELO',827,777,NULL,55,'C'),
(642,'RECIPE_MAGO_ACC_REY_HIELO',828,778,NULL,55,'C'),
(643,'RECIPE_ARQUERO_ACC_REY_HIELO',829,779,NULL,55,'C'),
(644,'RECIPE_PICARO_ACC_REY_HIELO',830,780,NULL,55,'C'),
(645,'RECIPE_SACERDOTE_ACC_REY_HIELO',831,781,NULL,55,'C'),
-- Lich Ancestral LEGENDARIO (scrolls 782-786, acc 832-836)
(646,'RECIPE_GUERRERO_ACC_LICH',832,782,NULL,55,'C'),
(647,'RECIPE_MAGO_ACC_LICH',833,783,NULL,55,'C'),
(648,'RECIPE_ARQUERO_ACC_LICH',834,784,NULL,55,'C'),
(649,'RECIPE_PICARO_ACC_LICH',835,785,NULL,55,'C'),
(650,'RECIPE_SACERDOTE_ACC_LICH',836,786,NULL,55,'C');

SELECT setval('crafting_recipes_id_seq', 650);

-- PARTE 5: Ingredientes de recetas de accesorios
-- 3 ingredientes por receta: scroll compartido ×1 + 2 materiales de zona
-- scroll_original=45 mat1=41(PielLobo) mat2=40(OrejaGoblin)
-- scroll_original=46 mat1=41(PielLobo) mat2=44(ColmilloLoboFeroz)
-- scroll_original=54 mat1=47(FragmentoPiedraViva) mat2=48(EsenciaEspectral)
-- scroll_original=55 mat1=50(ColmilloOrco) mat2=53(CristalGiganteHielo)
-- scroll_original=63 mat1=60(EscamaFuego) mat2=57(NucleoInfernal)
-- scroll_original=64 mat1=60(EscamaFuego) mat2=61(EscamaDragonCorrupto)
-- scroll_original=72 mat1=65(CaparazonCangrejo) mat2=66(AmuletMarinero)
-- scroll_original=73 mat1=65(CaparazonCangrejo) mat2=67(DientePirana)
-- scroll_original=82 mat1=78(PielLoboHielo) mat2=77(ColmilloJabali)
-- scroll_original=91 mat1=83(HuesoReanimado) mat2=87(CarneAncestral)
INSERT INTO crafting_recipe_ingredients(recipe_id, item_id, quantity) VALUES
-- 601 Guerrero Capitán
(601,45,1),(601,41,2),(601,40,2),
-- 602 Mago Capitán
(602,45,1),(602,41,2),(602,40,2),
-- 603 Arquero Capitán
(603,45,1),(603,41,2),(603,40,2),
-- 604 Pícaro Capitán
(604,45,1),(604,41,2),(604,40,2),
-- 605 Sacerdote Capitán
(605,45,1),(605,41,2),(605,40,2),
-- 606 Guerrero Titán
(606,46,1),(606,41,2),(606,44,1),
-- 607 Mago Titán
(607,46,1),(607,41,2),(607,44,1),
-- 608 Arquero Titán
(608,46,1),(608,41,2),(608,44,1),
-- 609 Pícaro Titán
(609,46,1),(609,41,2),(609,44,1),
-- 610 Sacerdote Titán
(610,46,1),(610,41,2),(610,44,1),
-- 611 Guerrero Acantilado
(611,54,1),(611,47,2),(611,48,1),
-- 612 Mago Acantilado
(612,54,1),(612,47,2),(612,48,1),
-- 613 Arquero Acantilado
(613,54,1),(613,47,2),(613,48,1),
-- 614 Pícaro Acantilado
(614,54,1),(614,47,2),(614,48,1),
-- 615 Sacerdote Acantilado
(615,54,1),(615,47,2),(615,48,1),
-- 616 Guerrero Rey Montaña
(616,55,1),(616,50,2),(616,53,1),
-- 617 Mago Rey Montaña
(617,55,1),(617,50,2),(617,53,1),
-- 618 Arquero Rey Montaña
(618,55,1),(618,50,2),(618,53,1),
-- 619 Pícaro Rey Montaña
(619,55,1),(619,50,2),(619,53,1),
-- 620 Sacerdote Rey Montaña
(620,55,1),(620,50,2),(620,53,1),
-- 621 Guerrero Caldera
(621,63,1),(621,60,2),(621,57,1),
-- 622 Mago Caldera
(622,63,1),(622,60,2),(622,57,1),
-- 623 Arquero Caldera
(623,63,1),(623,60,2),(623,57,1),
-- 624 Pícaro Caldera
(624,63,1),(624,60,2),(624,57,1),
-- 625 Sacerdote Caldera
(625,63,1),(625,60,2),(625,57,1),
-- 626 Guerrero Titán Fuego
(626,64,1),(626,60,2),(626,61,1),
-- 627 Mago Titán Fuego
(627,64,1),(627,60,2),(627,61,1),
-- 628 Arquero Titán Fuego
(628,64,1),(628,60,2),(628,61,1),
-- 629 Pícaro Titán Fuego
(629,64,1),(629,60,2),(629,61,1),
-- 630 Sacerdote Titán Fuego
(630,64,1),(630,60,2),(630,61,1),
-- 631 Guerrero Océano
(631,72,1),(631,65,2),(631,66,1),
-- 632 Mago Océano
(632,72,1),(632,65,2),(632,66,1),
-- 633 Arquero Océano
(633,72,1),(633,65,2),(633,66,1),
-- 634 Pícaro Océano
(634,72,1),(634,65,2),(634,66,1),
-- 635 Sacerdote Océano
(635,72,1),(635,65,2),(635,66,1),
-- 636 Guerrero Bestia
(636,73,1),(636,65,2),(636,67,1),
-- 637 Mago Bestia
(637,73,1),(637,65,2),(637,67,1),
-- 638 Arquero Bestia
(638,73,1),(638,65,2),(638,67,1),
-- 639 Pícaro Bestia
(639,73,1),(639,65,2),(639,67,1),
-- 640 Sacerdote Bestia
(640,73,1),(640,65,2),(640,67,1),
-- 641 Guerrero Rey Hielo
(641,82,1),(641,78,2),(641,77,1),
-- 642 Mago Rey Hielo
(642,82,1),(642,78,2),(642,77,1),
-- 643 Arquero Rey Hielo
(643,82,1),(643,78,2),(643,77,1),
-- 644 Pícaro Rey Hielo
(644,82,1),(644,78,2),(644,77,1),
-- 645 Sacerdote Rey Hielo
(645,82,1),(645,78,2),(645,77,1),
-- 646 Guerrero Lich
(646,91,1),(646,83,2),(646,87,1),
-- 647 Mago Lich
(647,91,1),(647,83,2),(647,87,1),
-- 648 Arquero Lich
(648,91,1),(648,83,2),(648,87,1),
-- 649 Pícaro Lich
(649,91,1),(649,83,2),(649,87,1),
-- 650 Sacerdote Lich
(650,91,1),(650,83,2),(650,87,1);

-- PARTE 6: Reasignar scroll_item_id en recetas de equipo existentes
-- Capitán (shared=45): G=737, M=738, A=739, P=740, S=741
UPDATE crafting_recipes SET scroll_item_id=737 WHERE scroll_item_id=45 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=738 WHERE scroll_item_id=45 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=739 WHERE scroll_item_id=45 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=740 WHERE scroll_item_id=45 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=741 WHERE scroll_item_id=45 AND required_class_id=5;
-- Titán (shared=46): G=742, M=743, A=744, P=745, S=746
UPDATE crafting_recipes SET scroll_item_id=742 WHERE scroll_item_id=46 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=743 WHERE scroll_item_id=46 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=744 WHERE scroll_item_id=46 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=745 WHERE scroll_item_id=46 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=746 WHERE scroll_item_id=46 AND required_class_id=5;
-- Acantilado (shared=54): G=747, M=748, A=749, P=750, S=751
UPDATE crafting_recipes SET scroll_item_id=747 WHERE scroll_item_id=54 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=748 WHERE scroll_item_id=54 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=749 WHERE scroll_item_id=54 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=750 WHERE scroll_item_id=54 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=751 WHERE scroll_item_id=54 AND required_class_id=5;
-- Rey Montaña (shared=55): G=752, M=753, A=754, P=755, S=756
UPDATE crafting_recipes SET scroll_item_id=752 WHERE scroll_item_id=55 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=753 WHERE scroll_item_id=55 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=754 WHERE scroll_item_id=55 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=755 WHERE scroll_item_id=55 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=756 WHERE scroll_item_id=55 AND required_class_id=5;
-- Caldera (shared=63): G=757, M=758, A=759, P=760, S=761
UPDATE crafting_recipes SET scroll_item_id=757 WHERE scroll_item_id=63 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=758 WHERE scroll_item_id=63 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=759 WHERE scroll_item_id=63 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=760 WHERE scroll_item_id=63 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=761 WHERE scroll_item_id=63 AND required_class_id=5;
-- Titán Fuego (shared=64): G=762, M=763, A=764, P=765, S=766
UPDATE crafting_recipes SET scroll_item_id=762 WHERE scroll_item_id=64 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=763 WHERE scroll_item_id=64 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=764 WHERE scroll_item_id=64 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=765 WHERE scroll_item_id=64 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=766 WHERE scroll_item_id=64 AND required_class_id=5;
-- Océano (shared=72): G=767, M=768, A=769, P=770, S=771
UPDATE crafting_recipes SET scroll_item_id=767 WHERE scroll_item_id=72 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=768 WHERE scroll_item_id=72 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=769 WHERE scroll_item_id=72 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=770 WHERE scroll_item_id=72 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=771 WHERE scroll_item_id=72 AND required_class_id=5;
-- Bestia (shared=73): G=772, M=773, A=774, P=775, S=776
UPDATE crafting_recipes SET scroll_item_id=772 WHERE scroll_item_id=73 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=773 WHERE scroll_item_id=73 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=774 WHERE scroll_item_id=73 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=775 WHERE scroll_item_id=73 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=776 WHERE scroll_item_id=73 AND required_class_id=5;
-- Rey Hielo (shared=82): G=777, M=778, A=779, P=780, S=781
UPDATE crafting_recipes SET scroll_item_id=777 WHERE scroll_item_id=82 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=778 WHERE scroll_item_id=82 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=779 WHERE scroll_item_id=82 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=780 WHERE scroll_item_id=82 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=781 WHERE scroll_item_id=82 AND required_class_id=5;
-- Lich (shared=91): G=782, M=783, A=784, P=785, S=786
UPDATE crafting_recipes SET scroll_item_id=782 WHERE scroll_item_id=91 AND required_class_id=1;
UPDATE crafting_recipes SET scroll_item_id=783 WHERE scroll_item_id=91 AND required_class_id=2;
UPDATE crafting_recipes SET scroll_item_id=784 WHERE scroll_item_id=91 AND required_class_id=3;
UPDATE crafting_recipes SET scroll_item_id=785 WHERE scroll_item_id=91 AND required_class_id=4;
UPDATE crafting_recipes SET scroll_item_id=786 WHERE scroll_item_id=91 AND required_class_id=5;

-- PARTE 7: Monster drops para scrolls de clase
-- MINIBOSS (Capitán, Acantilado, Caldera, Océano): 15% por class scroll
-- LEGENDARY (Titán, Rey Montaña, Titán Fuego, Bestia, Rey Hielo, Lich): 25% por class scroll
INSERT INTO monster_drops(monster_id, item_id, drop_chance_percent, min_quantity, max_quantity)
SELECT m.id, s.item_id, s.chance, 1, 1
FROM monsters m
CROSS JOIN (VALUES
  -- Capitán de los Lobos (MINIBOSS)
  ('CAPITAN_LOBOS', 737, 15.00),('CAPITAN_LOBOS', 738, 15.00),('CAPITAN_LOBOS', 739, 15.00),('CAPITAN_LOBOS', 740, 15.00),('CAPITAN_LOBOS', 741, 15.00),
  -- Titán de la Pradera (LEGENDARY)
  ('TITAN_PRADERA', 742, 25.00),('TITAN_PRADERA', 743, 25.00),('TITAN_PRADERA', 744, 25.00),('TITAN_PRADERA', 745, 25.00),('TITAN_PRADERA', 746, 25.00),
  -- Señor del Acantilado (MINIBOSS)
  ('SENOR_ACANTILADO', 747, 15.00),('SENOR_ACANTILADO', 748, 15.00),('SENOR_ACANTILADO', 749, 15.00),('SENOR_ACANTILADO', 750, 15.00),('SENOR_ACANTILADO', 751, 15.00),
  -- Rey de Montaña (LEGENDARY)
  ('REY_MONTANA', 752, 25.00),('REY_MONTANA', 753, 25.00),('REY_MONTANA', 754, 25.00),('REY_MONTANA', 755, 25.00),('REY_MONTANA', 756, 25.00),
  -- Señor de la Caldera (MINIBOSS)
  ('SENOR_CALDERA', 757, 15.00),('SENOR_CALDERA', 758, 15.00),('SENOR_CALDERA', 759, 15.00),('SENOR_CALDERA', 760, 15.00),('SENOR_CALDERA', 761, 15.00),
  -- Titán de Fuego (LEGENDARY)
  ('TITAN_FUEGO', 762, 25.00),('TITAN_FUEGO', 763, 25.00),('TITAN_FUEGO', 764, 25.00),('TITAN_FUEGO', 765, 25.00),('TITAN_FUEGO', 766, 25.00),
  -- Señor del Océano (MINIBOSS)
  ('SENOR_OCEANO', 767, 15.00),('SENOR_OCEANO', 768, 15.00),('SENOR_OCEANO', 769, 15.00),('SENOR_OCEANO', 770, 15.00),('SENOR_OCEANO', 771, 15.00),
  -- Bestia de las Profundidades (LEGENDARY)
  ('BESTIA_PROFUNDIDADES', 772, 25.00),('BESTIA_PROFUNDIDADES', 773, 25.00),('BESTIA_PROFUNDIDADES', 774, 25.00),('BESTIA_PROFUNDIDADES', 775, 25.00),('BESTIA_PROFUNDIDADES', 776, 25.00),
  -- Rey del Hielo (LEGENDARY)
  ('REY_HIELO', 777, 25.00),('REY_HIELO', 778, 25.00),('REY_HIELO', 779, 25.00),('REY_HIELO', 780, 25.00),('REY_HIELO', 781, 25.00),
  -- Lich Ancestral (LEGENDARY)
  ('LICH_ANCESTRAL', 782, 25.00),('LICH_ANCESTRAL', 783, 25.00),('LICH_ANCESTRAL', 784, 25.00),('LICH_ANCESTRAL', 785, 25.00),('LICH_ANCESTRAL', 786, 25.00)
) AS s(monster_code, item_id, chance)
WHERE m.code = s.monster_code
ON CONFLICT (monster_id, item_id) DO NOTHING;
