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
  class_id INT NOT NULL REFERENCES classes(id),
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
  class_id INT NOT NULL REFERENCES classes(id),
  evolves_to_class_id INT NOT NULL REFERENCES classes(id),
  required_level INT NOT NULL DEFAULT 1,
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

DO $$ BEGIN
  ALTER TABLE skill_effects DROP CONSTRAINT IF EXISTS skill_effects_effect_type_check;
  ALTER TABLE skill_effects ADD CONSTRAINT skill_effects_effect_type_check
    CHECK (effect_type IN ('STAT_MOD','DOT','HOT','REVIVE','CLEANSE','NO_DAMAGE_WINDOW','GUARANTEED_CRIT','CONDITIONAL_DAMAGE','SUMMON'));

  ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_damage_school_check;
  ALTER TABLE skills ADD CONSTRAINT skills_damage_school_check
    CHECK (damage_school IN ('FISICO','MAGICO','HIBRIDO'));

  ALTER TABLE skills DROP CONSTRAINT IF EXISTS skills_scaling_stat_check;
  ALTER TABLE skills ADD CONSTRAINT skills_scaling_stat_check
    CHECK (scaling_stat IN ('ATK','MAG','HYBRID'));
END $$;

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
  evolution_class_id INT REFERENCES classes(id),
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
  player_id INT PRIMARY KEY REFERENCES players(id),
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

-- Quests que el jugador acepto y todavia no entrego (separado de player_quest_completions,
-- que es historial de turn-ins), para listar "mis misiones activas".
CREATE TABLE IF NOT EXISTS player_active_quests (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_id INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_id, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_player_active_quests_player_id ON player_active_quests(player_id);

-- Progreso real de cada objetivo (KILL_MONSTER/DEFEAT_BOSS/KILL_ANY_IN_ZONE) de una quest
-- ACEPTADA. Se borra al completar la quest, asi las DIARIA repetibles arrancan en 0.
CREATE TABLE IF NOT EXISTS player_quest_progress (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_id INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  quest_objective_id INT NOT NULL REFERENCES quest_objectives(id) ON DELETE CASCADE,
  current_count INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_id, quest_objective_id)
);

CREATE INDEX IF NOT EXISTS idx_player_quest_progress_player_id ON player_quest_progress(player_id);
CREATE INDEX IF NOT EXISTS idx_player_quest_progress_quest_id ON player_quest_progress(quest_id);

-- Skills que el jugador ya aprendio (via LEVEL automatico, GOLD, QUEST, DROP o ITEM).
CREATE TABLE IF NOT EXISTS player_skills (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  learned_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_player_skills_player_id ON player_skills(player_id);

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

-- Puntero 1-a-1: en que sesion IN_PROGRESS esta cada jugador. player_id es PK, asi que
-- crear una segunda fila para el mismo jugador choca contra la constraint (evita sesiones
-- de combate duplicadas por una race condition entre el chequeo y el INSERT). Se borra la
-- fila cuando la sesion termina (finalizeSession).
CREATE TABLE IF NOT EXISTS player_active_combat_session (
  player_id INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  session_id INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE
);

-- 1 fila por combatiente (jugador o monstruo) de la sesion. has_acted_this_round se resetea
-- al empezar cada ronda nueva; is_defending se consume en el siguiente golpe que recibe.
CREATE TABLE IF NOT EXISTS combat_participants (
  id SERIAL PRIMARY KEY,
  session_id INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('PLAYER', 'ENEMY')),
  player_id INT REFERENCES players(id),
  npc_id INT,
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
  crit_damage NUMERIC(5,2) NOT NULL DEFAULT 150,
  evasion NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_defending BOOLEAN NOT NULL DEFAULT FALSE,
  has_acted_this_round BOOLEAN NOT NULL DEFAULT FALSE,
  xp_reward INT NOT NULL DEFAULT 0,
  gold_reward INT NOT NULL DEFAULT 0
);

ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS magic_def INT NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS npc_id INT;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS class_id INT REFERENCES classes(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS magic_damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS hot_hp_percent NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS imbued_element_id INT REFERENCES elements(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS imbued_damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS is_summon BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS summoner_id INT REFERENCES combat_participants(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS summon_rounds_remaining INT NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS element_id INT REFERENCES elements(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS physical_damage_bonus NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS elemental_damage_bonus NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS heal_bonus NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS pet_revive_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS damage_reduction NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS level INT;

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

ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS heal INT;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS hp_after INT;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS mana_after INT;

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
  crit INT NOT NULL,
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
  npc_id INT NOT NULL,
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

-- Monstruos que el jugador ya enfrentó al menos una vez (bestiario: oculta el nombre hasta el primer combate).
CREATE TABLE IF NOT EXISTS player_monster_encounters (
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  monster_id INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, monster_id)
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
CREATE INDEX IF NOT EXISTS idx_player_monster_encounters_player_id ON player_monster_encounters(player_id);

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
ALTER TABLE player_inventory ADD COLUMN IF NOT EXISTS enchant_level INT NOT NULL DEFAULT 0;
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
