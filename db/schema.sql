-- PostgreSQL schema para RPG Disgaea
-- Tablas estáticas de clases, crecimientos y evoluciones

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
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  lore TEXT
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
  class_id INT REFERENCES classes(id),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  skill_type TEXT NOT NULL CHECK (skill_type IN ('ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESTADO_ALTERADO', 'ESPECIAL', 'PASIVA')),
  damage_school TEXT CHECK (damage_school IN ('FISICO', 'MAGICO', 'HIBRIDO')),
  element_id INT REFERENCES elements(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('SELF', 'ALLY', 'ALL_ALLIES', 'ENEMY', 'ALL_ENEMIES')),
  base_value NUMERIC(6,2),
  scaling_stat TEXT CHECK (scaling_stat IN ('ATK', 'MAG', 'HYBRID')),
  scaling_multiplier NUMERIC(4,2),
  hits INT NOT NULL DEFAULT 1,
  mana_cost INT NOT NULL DEFAULT 0,
  is_passive BOOLEAN NOT NULL DEFAULT FALSE,
  learn_method TEXT NOT NULL CHECK (learn_method IN ('LEVEL', 'GOLD', 'QUEST', 'DROP', 'ITEM')),
  learn_level INT,
  learn_gold_cost INT,
  learn_requirement_text TEXT,
  description TEXT,
  cooldown_rounds INT
);

-- Efectos secundarios de una habilidad (0 a N por skill): permite que una sola skill module
-- varios stats a la vez (ej. Poder Sagrado: +Daño Luz y +DEF MAG juntos) sin inflar columnas en skills.
CREATE TABLE IF NOT EXISTS skill_effects (
  id SERIAL PRIMARY KEY,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL CHECK (effect_type IN ('STAT_MOD', 'DOT', 'HOT', 'REVIVE', 'CLEANSE', 'NO_DAMAGE_WINDOW', 'GUARANTEED_CRIT', 'CONDITIONAL_DAMAGE', 'SUMMON')),
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
  rarity TEXT CHECK (rarity IN ('COMUN', 'POCO_COMUN', 'RARO', 'EPICO', 'LEGENDARIO', 'UNICO')),
  class_id INT REFERENCES classes(id),
  required_level INT,
  is_craftable BOOLEAN NOT NULL DEFAULT FALSE,
  obtain_method TEXT,
  buy_price INT,
  description TEXT
);

-- Bonos de stat de un item (0 a N por item): tabla flexible porque cada item trae un set
-- distinto de stats (crítico%, regen de maná, daño vs dragones, etc), igual patrón que skill_effects.
CREATE TABLE IF NOT EXISTS item_stat_bonuses (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  stat_code TEXT NOT NULL,
  amount NUMERIC(6,2) NOT NULL,
  is_percent BOOLEAN NOT NULL DEFAULT FALSE,
  description TEXT,
  duration_turns INT
);

-- Habilidad que se desbloquea/otorga al equipar un item (ej. Excalibur -> "Corte Divino").
-- Tambien sirve para items que desbloquean antes una skill que normalmente requeriria mas nivel.
CREATE TABLE IF NOT EXISTS item_unlocks_skill (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE(item_id, skill_id)
);

-- Libros de hechizo: consumibles que enseñan permanentemente una skill (INSERT en player_skills)
-- al usarse desde el inventario, a diferencia de item_unlocks_skill que es solo informativo.
CREATE TABLE IF NOT EXISTS item_teaches_skill (
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
  combat_wins INT NOT NULL DEFAULT 0,
  combat_losses INT NOT NULL DEFAULT 0,
  boss_kills INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Contadores de jugador para requisitos de evolución de clase tipo COUNTER.
CREATE TABLE IF NOT EXISTS player_counters (
  player_id    INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  counter_code TEXT NOT NULL,
  value        INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, counter_code)
);

-- World Boss (docs/backend-spec-world-boss.md): jefe unico server-wide con HP compartido.
-- Movido a despues de "players" (bug de orden encontrado y corregido 2026-07-28: referenciaba
-- players(id) antes de que la tabla existiera, hacia fallar schema.sql corrido standalone).
CREATE TABLE IF NOT EXISTS world_boss_events (
  id            SERIAL PRIMARY KEY,
  monster_code  TEXT NOT NULL REFERENCES monsters(code),
  max_hp        INT NOT NULL,
  hp_remaining  INT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'KILLED', 'EXPIRED')),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at       TIMESTAMPTZ NOT NULL,
  closed_at     TIMESTAMPTZ,
  killed_by_player_id INT REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS world_boss_damage_log (
  event_id     INT NOT NULL REFERENCES world_boss_events(id) ON DELETE CASCADE,
  player_id    INT NOT NULL REFERENCES players(id),
  total_damage BIGINT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  PRIMARY KEY (event_id, player_id)
);

CREATE TABLE IF NOT EXISTS world_boss_shop (
  id      SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id),
  price   INT NOT NULL
);
-- Unique en vez de solo PK(id): sin esto un ON CONFLICT DO NOTHING sobre item_id no tiene
-- target valido y un re-run del seed duplica filas (paso real, corregido en produccion).
CREATE UNIQUE INDEX IF NOT EXISTS world_boss_shop_item_id_key ON world_boss_shop(item_id);

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
  required_class_id INT REFERENCES classes(id),
  hidden_unlock_text TEXT,
  description TEXT
);

-- Objetivos de cada quest (0 a N). KILL_ANY_IN_ZONE = cualquier monstruo comun de la zona
-- (no uno especifico); el resto apuntan a un monstruo o item concreto.
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

-- Quests "en curso": el jugador las aceptó pero todavía no las completó. Separado de
-- player_quest_completions (que es historial de turn-ins) para listar "mis misiones
-- activas" en el dashboard sin mezclarlas con las ya entregadas.
CREATE TABLE IF NOT EXISTS player_active_quests (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_id INT NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
  accepted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_id, quest_id)
);

-- Progreso real de cada objetivo (KILL_MONSTER/DEFEAT_BOSS/KILL_ANY_IN_ZONE) de una quest
-- ACEPTADA (ver player_active_quests). Se incrementa desde combat.js cuando un monstruo muere
-- en una pelea ganada (ver lib/questProgress.js) y se borra al completar la quest, asi las
-- DIARIA repetibles arrancan en 0 la proxima vez. COLLECT_ITEM no usa esta tabla: se valida
-- directo contra player_inventory porque ese conteo ya existe ahi.
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

-- Inventario real del jugador (items de items, sin equipar). Usado por crafteo y recompensas
-- de quests para tener donde sumar/restar items. El equipamiento puesto vive en player_equipment.
CREATE TABLE IF NOT EXISTS player_inventory (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  quantity INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  enchant_level INT NOT NULL DEFAULT 0,
  quality_tier SMALLINT NOT NULL DEFAULT 0,
  UNIQUE(player_id, item_id, enchant_level, quality_tier)
);

CREATE INDEX IF NOT EXISTS idx_player_inventory_player_id ON player_inventory(player_id);

-- Un item equipado por slot por jugador (1 a 1). El offhand se libera aparte cuando se
-- equipa un arma a dos manos (ver routes/players.js).
CREATE TABLE IF NOT EXISTS player_equipment (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot TEXT NOT NULL CHECK (slot IN ('WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY')),
  item_id INT NOT NULL REFERENCES items(id),
  enchant_level INT NOT NULL DEFAULT 0,
  quality_tier SMALLINT NOT NULL DEFAULT 0,
  UNIQUE(player_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_player_equipment_player_id ON player_equipment(player_id);

-- Skills que el jugador ya aprendio (via LEVEL automatico, GOLD del maestro de gremio de su
-- clase, QUEST, DROP o ITEM). El maestro de gremio no es una entidad propia: es simplemente
-- el class_id del jugador, ver POST /api/players/:playerId/guild/learn-skill.
CREATE TABLE IF NOT EXISTS player_skills (
  id SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  learned_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_player_skills_player_id ON player_skills(player_id);

-- Sesiones de combate por turnos. status IN_PROGRESS mientras se resuelve turno a turno via
-- POST /api/combat/sessions/:id/action; el back es quien decide el resultado de cada accion
-- (ATTACK/DEFEND/ESCAPE/USE_ITEM), el front solo manda la eleccion.
CREATE TABLE IF NOT EXISTS combat_sessions (
  id SERIAL PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS', 'PLAYER_WON', 'ENEMY_WON', 'ESCAPED')),
  current_round INT NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  guest_player_id INT REFERENCES players(id) ON DELETE SET NULL,
  guest_player_id_2 INT REFERENCES players(id) ON DELETE SET NULL,
  had_near_death BOOLEAN NOT NULL DEFAULT FALSE,
  world_boss_event_id INT REFERENCES world_boss_events(id)
);

-- Puntero 1-a-1: en que sesion IN_PROGRESS esta cada jugador. player_id es PK, asi que
-- crear una segunda fila para el mismo jugador choca contra la constraint (evita sesiones
-- de combate duplicadas por una race condition entre el chequeo y el INSERT). Se borra la
-- fila cuando la sesion termina (finalizeSession).
CREATE TABLE IF NOT EXISTS player_active_combat_session (
  player_id  INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
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
  gold_reward INT NOT NULL DEFAULT 0,
  magic_damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0,
  hot_hp_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  imbued_element_id INT REFERENCES elements(id),
  imbued_damage_bonus NUMERIC(5,2) NOT NULL DEFAULT 0,
  is_summon BOOLEAN NOT NULL DEFAULT FALSE,
  summoner_id INT REFERENCES combat_participants(id),
  summon_rounds_remaining INT NOT NULL DEFAULT 0,
  element_id INT REFERENCES elements(id),
  physical_damage_bonus NUMERIC NOT NULL DEFAULT 0,
  elemental_damage_bonus NUMERIC NOT NULL DEFAULT 0,
  heal_bonus NUMERIC NOT NULL DEFAULT 0
);

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

CREATE INDEX IF NOT EXISTS idx_quests_zone_id ON quests(zone_id);
CREATE INDEX IF NOT EXISTS idx_quest_objectives_quest_id ON quest_objectives(quest_id);
CREATE INDEX IF NOT EXISTS idx_quest_item_rewards_quest_id ON quest_item_rewards(quest_id);
CREATE INDEX IF NOT EXISTS idx_quest_hidden_requirements_quest_id ON quest_hidden_requirements(quest_id);
CREATE INDEX IF NOT EXISTS idx_player_quest_completions_player_id ON player_quest_completions(player_id);
CREATE INDEX IF NOT EXISTS idx_player_active_quests_player_id ON player_active_quests(player_id);

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
  description TEXT,
  scroll_item_id INT REFERENCES items(id)
);

CREATE TABLE IF NOT EXISTS crafting_recipe_ingredients (
  id SERIAL PRIMARY KEY,
  recipe_id INT NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,
  item_id INT NOT NULL REFERENCES items(id),
  quantity INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_monster_drops_monster_id ON monster_drops(monster_id);


CREATE INDEX IF NOT EXISTS idx_crafting_recipe_ingredients_recipe_id ON crafting_recipe_ingredients(recipe_id);

CREATE TABLE IF NOT EXISTS guilds (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  leader_id   INT NOT NULL REFERENCES players(id),
  level       INT NOT NULL DEFAULT 1,
  xp          INT NOT NULL DEFAULT 0,
  type        VARCHAR(6) NOT NULL DEFAULT 'OPEN' CHECK (type IN ('OPEN','CLOSED')),
  emblem      VARCHAR(8),
  color       VARCHAR(7),
  bank_gold   BIGINT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id   INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  role       VARCHAR(7) NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('LEADER','OFFICER','MEMBER')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, player_id),
  UNIQUE (player_id)
);
CREATE INDEX IF NOT EXISTS idx_guild_members_guild_id  ON guild_members(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_members_player_id ON guild_members(player_id);

CREATE TABLE IF NOT EXISTS guild_join_requests (
  id          SERIAL PRIMARY KEY,
  guild_id    INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status      VARCHAR(8) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (guild_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_guild_join_requests_guild_id ON guild_join_requests(guild_id);

-- Historial de actividad del gremio (join/leave/kick/promote/demote/transfer/level up/edit/banco).
CREATE TABLE IF NOT EXISTS guild_activity_log (
  id          SERIAL PRIMARY KEY,
  guild_id    INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  type        VARCHAR(20) NOT NULL CHECK (type IN
    ('JOIN','LEAVE','KICK','PROMOTE','DEMOTE','TRANSFER','LEVEL_UP','EDIT','DONATION','SHOP_PURCHASE')),
  actor_id    INT REFERENCES players(id),
  target_id   INT REFERENCES players(id),
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guild_activity_log_guild_id ON guild_activity_log(guild_id, created_at DESC);

-- Banco de gremio: depósitos de miembros + compras en la tienda exclusiva.
CREATE TABLE IF NOT EXISTS guild_bank_transactions (
  id            SERIAL PRIMARY KEY,
  guild_id      INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  player_id     INT NOT NULL REFERENCES players(id),
  type          VARCHAR(10) NOT NULL CHECK (type IN ('DEPOSIT','PURCHASE')),
  amount        INT NOT NULL,
  item_id       INT REFERENCES items(id),
  quantity      INT,
  recipient_id  INT REFERENCES players(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_guild_bank_tx_guild_id  ON guild_bank_transactions(guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guild_bank_tx_player_id ON guild_bank_transactions(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         SERIAL PRIMARY KEY,
  channel    TEXT NOT NULL CHECK (channel IN ('GENERAL','TRADE','GUILD')),
  guild_id   INT REFERENCES guilds(id) ON DELETE CASCADE,
  sender_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_guild_channel_consistency CHECK (
    (channel = 'GUILD' AND guild_id IS NOT NULL) OR (channel != 'GUILD' AND guild_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel ON chat_messages(channel, id) WHERE channel != 'GUILD';
CREATE INDEX IF NOT EXISTS idx_chat_messages_guild   ON chat_messages(guild_id, id) WHERE channel = 'GUILD';

CREATE TABLE IF NOT EXISTS player_zone_unlocks (
  player_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  zone_id     INT NOT NULL REFERENCES monster_zones(id),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, zone_id)
);
CREATE INDEX IF NOT EXISTS idx_player_zone_unlocks_player_id ON player_zone_unlocks(player_id);

CREATE TABLE IF NOT EXISTS player_monster_encounters (
  player_id     INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  monster_id    INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, monster_id)
);
CREATE INDEX IF NOT EXISTS idx_player_monster_encounters_player_id ON player_monster_encounters(player_id);

-- "Jefe derrotado" basado en kill real, no en mision completada (ver GET /:playerId/zones).
CREATE TABLE IF NOT EXISTS player_monster_kills (
  player_id       INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  monster_id      INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  first_killed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, monster_id)
);
CREATE INDEX IF NOT EXISTS idx_player_monster_kills_player_id ON player_monster_kills(player_id);

CREATE TABLE IF NOT EXISTS monster_skills (
  id                 SERIAL PRIMARY KEY,
  monster_id         INT NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  skill_id           INT NOT NULL REFERENCES skills(id),
  use_chance_percent NUMERIC(5,2) NOT NULL DEFAULT 30,
  UNIQUE (monster_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_monster_skills_monster_id ON monster_skills(monster_id);

CREATE TABLE IF NOT EXISTS combat_participant_buffs (
  id               SERIAL PRIMARY KEY,
  session_id       INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  participant_id   INT NOT NULL REFERENCES combat_participants(id) ON DELETE CASCADE,
  stat_code        TEXT NOT NULL,
  applied_flat     INT NOT NULL DEFAULT 0,
  rounds_remaining INT NOT NULL,
  is_debuff        BOOLEAN NOT NULL DEFAULT FALSE,
  skill_id         INT REFERENCES skills(id)
);
CREATE INDEX IF NOT EXISTS idx_combat_participant_buffs_session_id ON combat_participant_buffs(session_id);

CREATE TABLE IF NOT EXISTS artisans (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  specialty   TEXT NOT NULL CHECK (specialty IN ('HERRERO','PELETERO','SASTRE','JOYERO','ALQUIMISTA','COCINERO','FUEGO','MARINO','OSCURO','SUPREMO')),
  zone_id     INT REFERENCES monster_zones(id),
  description TEXT
);

CREATE TABLE IF NOT EXISTS artisan_shop (
  id           SERIAL PRIMARY KEY,
  artisan_code TEXT NOT NULL REFERENCES artisans(code) ON DELETE CASCADE,
  item_id      INT NOT NULL REFERENCES items(id),
  price        INT NOT NULL,
  UNIQUE (artisan_code, item_id)
);
CREATE INDEX IF NOT EXISTS idx_artisan_shop_code ON artisan_shop(artisan_code);

CREATE TABLE IF NOT EXISTS dismantle_recipes (
  id              SERIAL PRIMARY KEY,
  item_id         INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  result_item_id  INT NOT NULL REFERENCES items(id),
  result_quantity INT NOT NULL DEFAULT 1,
  UNIQUE (item_id, result_item_id)
);
CREATE INDEX IF NOT EXISTS idx_dismantle_recipes_item_id ON dismantle_recipes(item_id);

CREATE TABLE IF NOT EXISTS player_learned_recipes (
  player_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  recipe_id  INT NOT NULL REFERENCES crafting_recipes(id) ON DELETE CASCADE,
  learned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, recipe_id)
);
CREATE INDEX IF NOT EXISTS idx_player_learned_recipes_player_id ON player_learned_recipes(player_id);

CREATE TABLE IF NOT EXISTS player_npcs (
  id         SERIAL PRIMARY KEY,
  player_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  class_id   INT NOT NULL REFERENCES classes(id),
  class_name TEXT NOT NULL,
  level      INT NOT NULL DEFAULT 1,
  xp         INT NOT NULL DEFAULT 0,
  hp         INT NOT NULL,
  max_hp     INT NOT NULL,
  mana       INT NOT NULL,
  max_mana   INT NOT NULL,
  atk        INT NOT NULL,
  def        INT NOT NULL,
  mag        INT NOT NULL,
  magic_def  INT NOT NULL,
  spd        INT NOT NULL,
  crit       NUMERIC(5,2) NOT NULL,
  hired_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_equipment (
  id            SERIAL PRIMARY KEY,
  npc_id        INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  slot          TEXT NOT NULL CHECK (slot IN ('WEAPON','OFFHAND','HELMET','ARMOR','GLOVES','BOOTS','ACCESSORY')),
  item_id       INT NOT NULL REFERENCES items(id),
  quality_tier  SMALLINT NOT NULL DEFAULT 0,
  enchant_level INT NOT NULL DEFAULT 0,
  UNIQUE (npc_id, slot)
);

CREATE TABLE IF NOT EXISTS npc_skills (
  npc_id   INT NOT NULL,
  skill_id INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (npc_id, skill_id)
);

CREATE TABLE IF NOT EXISTS player_npc_pool (
  id         SERIAL PRIMARY KEY,
  player_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  class_id   INT NOT NULL REFERENCES classes(id),
  class_name TEXT NOT NULL,
  level      INT NOT NULL,
  hp         INT NOT NULL,
  mana       INT NOT NULL,
  atk        INT NOT NULL,
  def        INT NOT NULL,
  mag        INT NOT NULL,
  magic_def  INT NOT NULL,
  spd        INT NOT NULL,
  crit       INT NOT NULL,
  hire_cost  INT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_player_npc_pool_player_id ON player_npc_pool(player_id);

CREATE TABLE IF NOT EXISTS player_party (
  id        SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_id    INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  slot      INT NOT NULL CHECK (slot IN (2, 3)),
  UNIQUE (player_id, slot)
);

CREATE TABLE IF NOT EXISTS player_bench (
  id        SERIAL PRIMARY KEY,
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  npc_id    INT NOT NULL REFERENCES player_npcs(id) ON DELETE CASCADE,
  UNIQUE (player_id, npc_id)
);

CREATE TABLE IF NOT EXISTS player_friends (
  id           SERIAL PRIMARY KEY,
  requester_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  addressee_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','BLOCKED')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_friend CHECK (requester_id != addressee_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_friendship ON player_friends (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
CREATE INDEX IF NOT EXISTS idx_friends_addressee ON player_friends(addressee_id);
CREATE INDEX IF NOT EXISTS idx_friends_requester ON player_friends(requester_id);

CREATE TABLE IF NOT EXISTS player_messages (
  id                 SERIAL PRIMARY KEY,
  sender_id          INT REFERENCES players(id) ON DELETE SET NULL,
  receiver_id        INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject            TEXT NOT NULL DEFAULT '',
  body               TEXT NOT NULL DEFAULT '',
  gold_amount        INT NOT NULL DEFAULT 0,
  gold_claimed       BOOLEAN NOT NULL DEFAULT FALSE,
  read               BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_sender  BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_by_receiver BOOLEAN NOT NULL DEFAULT FALSE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '10 days'
);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON player_messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender   ON player_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_expires  ON player_messages(expires_at);

CREATE TABLE IF NOT EXISTS player_message_items (
  id            SERIAL PRIMARY KEY,
  message_id    INT NOT NULL REFERENCES player_messages(id) ON DELETE CASCADE,
  item_id       INT NOT NULL REFERENCES items(id),
  quantity      INT NOT NULL DEFAULT 1,
  enchant_level INT NOT NULL DEFAULT 0,
  quality_tier  SMALLINT NOT NULL DEFAULT 0,
  claimed       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS achievements (
  id             SERIAL PRIMARY KEY,
  code           TEXT UNIQUE NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  condition_type TEXT NOT NULL DEFAULT 'QUEST_COMPLETIONS',
  quest_id       INT REFERENCES quests(id) ON DELETE SET NULL,
  threshold      INT NOT NULL DEFAULT 100,
  bonus_type     TEXT,
  bonus_category TEXT,
  bonus_stat     TEXT,
  bonus_percent  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_achievements (
  id             SERIAL PRIMARY KEY,
  player_id      INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_id INT NOT NULL REFERENCES achievements(id),
  unlocked_at    TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (player_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_player_achievements_player ON player_achievements(player_id);

CREATE TABLE IF NOT EXISTS player_coop_groups (
  id         SERIAL PRIMARY KEY,
  leader_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_coop_group_members (
  group_id  INT NOT NULL REFERENCES player_coop_groups(id) ON DELETE CASCADE,
  player_id INT NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, player_id)
);

CREATE TABLE IF NOT EXISTS player_coop_invites (
  id         SERIAL PRIMARY KEY,
  leader_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coop_invites_guest ON player_coop_invites(guest_id);

CREATE TABLE IF NOT EXISTS player_coop_party (
  id         SERIAL PRIMARY KEY,
  leader_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_coop_leader UNIQUE (leader_id),
  CONSTRAINT unique_coop_guest  UNIQUE (guest_id)
);

CREATE TABLE IF NOT EXISTS player_coop_ready (
  player_id INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  zone_id   INT NOT NULL,
  ready_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS player_coop_group_messages (
  id         SERIAL PRIMARY KEY,
  group_id   INT NOT NULL REFERENCES player_coop_groups(id) ON DELETE CASCADE,
  sender_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coop_group_messages_group ON player_coop_group_messages(group_id, id);

-- item_id es NULL cuando la publicacion es de una mascota (player_pet_id) en su lugar --
-- chk_listing_target obliga a que sea exactamente uno de los dos, nunca ambos ni ninguno.
CREATE TABLE IF NOT EXISTS player_market_listings (
  id             SERIAL PRIMARY KEY,
  seller_id      INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id        INT REFERENCES items(id),
  enchant_level  INT NOT NULL DEFAULT 0,
  quality_tier   SMALLINT NOT NULL DEFAULT 0,
  quantity       INT NOT NULL CHECK (quantity > 0),
  price_per_unit BIGINT NOT NULL CHECK (price_per_unit > 0),
  currency       TEXT NOT NULL DEFAULT 'GOLD' CHECK (currency IN ('GOLD', 'DUNGEON_COINS', 'COSMIC_SHARDS')),
  status         TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SOLD','CANCELLED')),
  buyer_id       INT REFERENCES players(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  sold_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_market_listings_active ON player_market_listings(item_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_market_listings_seller ON player_market_listings(seller_id);
-- Soporta el browse principal (WHERE status='ACTIVE' ORDER BY created_at DESC) -- el indice
-- parcial de arriba (idx_market_listings_active) solo ayuda a busquedas por item_id puntual.
CREATE INDEX IF NOT EXISTS idx_market_listings_status_created ON player_market_listings(status, created_at DESC);

CREATE TABLE IF NOT EXISTS combat_abandoned_players (
  session_id   INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  player_id    INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  penalized    BOOLEAN NOT NULL DEFAULT FALSE,
  abandoned_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, player_id)
);

CREATE TABLE IF NOT EXISTS pets (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  rarity      TEXT NOT NULL CHECK (rarity IN ('COMUN','POCO_COMUN','RARO','EPICO','LEGENDARIO')),
  element_id  INT REFERENCES elements(id),
  description TEXT
);

CREATE TABLE IF NOT EXISTS pet_bonuses (
  id               SERIAL PRIMARY KEY,
  pet_id           INT NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  stat_code        TEXT NOT NULL,
  base_amount      NUMERIC NOT NULL,
  per_level_amount NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS player_pets (
  id          SERIAL PRIMARY KEY,
  player_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  pet_id      INT NOT NULL REFERENCES pets(id),
  level       INT NOT NULL DEFAULT 1,
  bond_points INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT FALSE,
  hatched_at  TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_pet_per_player ON player_pets(player_id) WHERE is_active;
-- El indice de arriba es parcial (solo filas is_active); GET /pets y otras queries filtran por
-- player_id sin ese predicado, asi que necesitan este tambien.
CREATE INDEX IF NOT EXISTS idx_player_pets_player_id ON player_pets(player_id);

-- Tienda del World Boss: cuanto sube la Piedra de Trascendencia el tope de 20 de ESA mascota.
ALTER TABLE player_pets ADD COLUMN IF NOT EXISTS bonus_max_level INT NOT NULL DEFAULT 0;

-- Mercado multi-moneda + venta de mascotas. player_pet_id va despues de player_pets porque la
-- referencia -- item_id ya quedo NULLABLE en su CREATE TABLE (arriba) para esto mismo.
ALTER TABLE player_market_listings ADD COLUMN IF NOT EXISTS player_pet_id INT REFERENCES player_pets(id);
ALTER TABLE player_market_listings DROP CONSTRAINT IF EXISTS chk_listing_target;
ALTER TABLE player_market_listings ADD CONSTRAINT chk_listing_target CHECK (
  (item_id IS NOT NULL AND player_pet_id IS NULL) OR
  (item_id IS NULL AND player_pet_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_market_listings_pet ON player_market_listings(player_pet_id) WHERE status = 'ACTIVE';

-- Mercado multi-moneda + venta de mascotas: player_market_listings ya existe (línea ~974) pero
-- referencia player_pets, que se crea recién acá arriba, por eso van como ALTER en vez de estar
-- en el CREATE TABLE original.
ALTER TABLE player_market_listings
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'GOLD'
    CHECK (currency IN ('GOLD', 'DUNGEON_COINS', 'COSMIC_SHARDS'));
ALTER TABLE player_market_listings ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE player_market_listings ADD COLUMN IF NOT EXISTS player_pet_id INT REFERENCES player_pets(id);
ALTER TABLE player_market_listings DROP CONSTRAINT IF EXISTS chk_listing_target;
ALTER TABLE player_market_listings ADD CONSTRAINT chk_listing_target CHECK (
  (item_id IS NOT NULL AND player_pet_id IS NULL) OR
  (item_id IS NULL AND player_pet_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_market_listings_pet ON player_market_listings(player_pet_id) WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS player_incubator (
  player_id     INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  egg_item_id   INT NOT NULL REFERENCES items(id),
  egg_rarity    TEXT NOT NULL,
  started_at    TIMESTAMP NOT NULL DEFAULT now(),
  hatch_ready_at TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS tower_floors (
  floor_number         INT PRIMARY KEY,
  tower_zone_id        INT NOT NULL REFERENCES monster_zones(id),
  is_boss_floor        BOOLEAN NOT NULL DEFAULT FALSE,
  room_count           INT NOT NULL DEFAULT 3,
  boss_monster_code    TEXT REFERENCES monsters(code),
  escort_monster_codes TEXT[]
);

-- Eventos narrativos de sala (docs/backend-spec-abismo-eventos-narrativos.md): alternativa al
-- combate garantizado, ponderada por Luck del grupo (ver rollRoomCategory en routes/combat.js).
CREATE TABLE IF NOT EXISTS tower_room_events (
  id             SERIAL PRIMARY KEY,
  event_type     TEXT NOT NULL CHECK (event_type IN ('TRAP','VENDOR','SANCTUARY','SECRET','STORY')),
  prompt_text    TEXT NOT NULL,
  choice_a_label TEXT NOT NULL,
  choice_b_label TEXT NOT NULL,
  weight         INT NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS player_tower_runs (
  id                  SERIAL PRIMARY KEY,
  player_id           INT NOT NULL REFERENCES players(id),
  guest_player_id     INT REFERENCES players(id) ON DELETE SET NULL,
  guest_player_id_2   INT REFERENCES players(id) ON DELETE SET NULL,
  current_session_id  INT REFERENCES combat_sessions(id) ON DELETE SET NULL,
  difficulty          INT NOT NULL DEFAULT 1,
  current_floor       INT NOT NULL DEFAULT 1,
  current_room        INT NOT NULL DEFAULT 1,
  coins_earned        INT NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','EXTRACTED','WIPED')),
  abandoned_player_ids INT[] NOT NULL DEFAULT '{}',
  started_at          TIMESTAMP DEFAULT now(),
  ended_at            TIMESTAMP,
  pending_event_id    INT REFERENCES tower_room_events(id)
);

CREATE TABLE IF NOT EXISTS tower_vendor_shop (
  id      SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id),
  price   INT NOT NULL,
  UNIQUE (item_id)
);

CREATE TABLE IF NOT EXISTS player_tower_ready (
  player_id INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  ready_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ready-check del World Boss, mismo patron que player_tower_ready (tabla separada, "por actividad").
CREATE TABLE IF NOT EXISTS player_worldboss_ready (
  player_id INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  ready_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Columnas y constraints añadidas tras el schema inicial ──────────────────
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS heal INT;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS hp_after INT;
ALTER TABLE combat_log ADD COLUMN IF NOT EXISTS mana_after INT;

ALTER TABLE monsters ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'BESTIA';

ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS owner_player_id INT REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS pet_revive_used BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS damage_reduction NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS level INT;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS luck NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS is_preparing_trap BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS trap_rounds_remaining INT NOT NULL DEFAULT 0;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS cd_skill_id INT REFERENCES skills(id);
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS cd_round INT;

ALTER TABLE monster_zones ADD COLUMN IF NOT EXISTS is_tower_zone BOOLEAN NOT NULL DEFAULT FALSE;

-- Distintos códigos de veneno (u otros "logros de variedad") que un jugador ya aplicó con éxito
-- al menos una vez. VENENOS_DOMINADOS = COUNT(*) de sub_code para ese counter_code.
CREATE TABLE IF NOT EXISTS player_counter_seen_codes (
  player_id    INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  counter_code TEXT NOT NULL,
  sub_code     TEXT NOT NULL,
  PRIMARY KEY (player_id, counter_code, sub_code)
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS dungeon_coins INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS cosmic_shards INT NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS luck NUMERIC(5,2) NOT NULL DEFAULT 1.0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS pool_last_generated_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now();

ALTER TABLE crafting_recipe_ingredients
  ADD CONSTRAINT crafting_recipe_ingredients_recipe_item_unique UNIQUE (recipe_id, item_id);

ALTER TABLE items ADD COLUMN IF NOT EXISTS buy_price INT;
ALTER TABLE quests ADD COLUMN IF NOT EXISTS required_class_id INT REFERENCES classes(id);

DO $$ BEGIN
  ALTER TABLE skill_effects DROP CONSTRAINT IF EXISTS skill_effects_effect_type_check;
  ALTER TABLE skill_effects ADD CONSTRAINT skill_effects_effect_type_check
    CHECK (effect_type IN ('STAT_MOD','DOT','HOT','REVIVE','CLEANSE','NO_DAMAGE_WINDOW','GUARANTEED_CRIT','CONDITIONAL_DAMAGE','SUMMON'));
END $$;

-- Innata de clase evolucionada (a lo sumo 1 por clase). Ver docs/backend-spec-class-innates.md.
-- is_stacking=TRUE = Nivel 3 (Ira Creciente, Sed de Sangre, Caos Encarnado, Trofeos de Caza):
-- el bono real es percent_amount * combat_participants.innate_stacks, recalculado en cada lectura.
CREATE TABLE IF NOT EXISTS class_innate_abilities (
  id SERIAL PRIMARY KEY,
  class_id INT NOT NULL UNIQUE REFERENCES classes(id),
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN (
    'ON_CRIT', 'ON_KILL', 'ON_HEAL_CAST', 'ON_DODGE', 'ON_DOT_APPLY', 'ON_COMBAT_START',
    'ON_VICTORY_REWARD', 'PASSIVE_STAT', 'PASSIVE_CONDITIONAL', 'TEAM_AURA', 'ONCE_PER_COMBAT',
    'ON_BASIC_ATTACK_HIT', 'ON_SPELL_DAMAGE', 'ON_SPELL_CAST', 'ON_AOE_HIT', 'ON_CRIT_RECEIVED',
    'ON_DAMAGE_TAKEN', 'ON_DEFEND', 'ON_IMBUE', 'ON_TURN_START', 'ON_ENEMY_TARGETS_ME',
    'ON_REVIVE_CAST', 'ON_CRAFT', 'MODIFIES_SKILL'
  )),
  chance_percent NUMERIC(5,2),
  chance_scales_with_luck BOOLEAN NOT NULL DEFAULT FALSE,
  stat_code TEXT,
  percent_amount NUMERIC(6,2),
  condition_type TEXT,
  condition_value NUMERIC(6,2),
  extra_json JSONB,
  description TEXT NOT NULL,
  is_stacking BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_class_innate_abilities_class_id ON class_innate_abilities(class_id);

ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS innate_used_this_combat BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS innate_stacks INT NOT NULL DEFAULT 0;

-- Rareza de encuentro + mutaciones en El Abismo (docs/backend-spec-abismo-rareza-mutaciones.md).
ALTER TABLE combat_participants ADD COLUMN IF NOT EXISTS mutation_code TEXT;

-- Maestros de clase, piloto de 5 clases (docs/backend-spec-maestros-de-clase.md).
CREATE TABLE IF NOT EXISTS class_masters (
  id             SERIAL PRIMARY KEY,
  class_id       INT NOT NULL REFERENCES classes(id) UNIQUE,
  name           TEXT NOT NULL,
  intro_dialogue TEXT NOT NULL,
  guild_dialogue TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS class_master_shop_items (
  id         SERIAL PRIMARY KEY,
  master_id  INT NOT NULL REFERENCES class_masters(id) ON DELETE CASCADE,
  item_id    INT NOT NULL REFERENCES items(id),
  price      INT NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_class_masters (
  guild_id              INT NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  master_id             INT NOT NULL REFERENCES class_masters(id),
  unlocked_by_player_id INT REFERENCES players(id),
  unlocked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, master_id)
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS pending_master_id INT REFERENCES class_masters(id);

-- ===== Ciudades del Abismo: asentamientos cada 15 pisos de la Torre =====
-- docs/backend-spec-ciudad-del-abismo.md. Parte 2: banking automatico necesita saber si ese
-- checkpoint puntual ya se banco, para no volver a bancar en cada GET /tower/run.
ALTER TABLE player_tower_runs ADD COLUMN IF NOT EXISTS last_banked_floor INT NOT NULL DEFAULT 0;

-- Parte 4: tienda de artesanos del abismo -- catalogo fijo (no random) con mejor rareza que
-- tower_vendor_shop, precio base que se multiplica por profundidad al mostrar (mismo criterio
-- que vendorEventPrice, ver routes/tower.js depthPriceMultiplier).
CREATE TABLE IF NOT EXISTS tower_settlement_shop (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id),
  base_price INT NOT NULL,
  UNIQUE (item_id)
);

-- Parte 6: reagruparse en el asentamiento -- invitacion sin exigir amistad (a diferencia de
-- player_coop_invites), basada en estar los dos parados ahora mismo en el mismo checkpoint.
CREATE TABLE IF NOT EXISTS tower_settlement_invites (
  id         SERIAL PRIMARY KEY,
  leader_id  INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id   INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  floor      INT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','DECLINED')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settlement_invites_guest ON tower_settlement_invites(guest_id);

-- Parte 7: Cristal de Viaje -- memoria permanente de que asentamientos descubrio cada jugador,
-- se llena sola desde bankIfNewCheckpoint (routes/tower.js parte 2).
CREATE TABLE IF NOT EXISTS player_discovered_checkpoints (
  player_id INT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  floor     INT NOT NULL,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, floor)
);

-- Recompensa diaria / racha de login (docs/backend-spec-recompensa-diaria.md). Calendario de 28
-- dias por fecha calendario UTC, no ventana rodante -- ver routes/players.js.
CREATE TABLE IF NOT EXISTS player_daily_reward (
  player_id       INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  current_day     INT NOT NULL DEFAULT 0 CHECK (current_day BETWEEN 0 AND 28),
  last_claim_date DATE
);

CREATE TABLE IF NOT EXISTS daily_reward_catalog (
  day_number  INT PRIMARY KEY CHECK (day_number BETWEEN 1 AND 28),
  reward_type TEXT NOT NULL CHECK (reward_type IN ('GOLD', 'DUNGEON_COINS', 'COSMIC_SHARDS', 'ITEM')),
  item_code   TEXT REFERENCES items(code),
  quantity    INT NOT NULL,
  CHECK ((reward_type = 'ITEM') = (item_code IS NOT NULL))
);

-- Evento del Dia (docs/backend-spec-evento-del-dia.md): encuentro especial rotativo, igual para
-- todos los jugadores el mismo dia (rotacion deterministica por fecha calendario UTC, ver
-- routes/dailyEvent.js), tope de 5 entradas por jugador por dia. Rareza/mutacion forzada reusa
-- ENCOUNTER_RARITY_STAT_MULT/MUTATIONS de El Abismo (routes/combat.js) sin sortear.
CREATE TABLE IF NOT EXISTS player_daily_event (
  player_id         INT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  attempts_used      INT NOT NULL DEFAULT 0,
  last_attempt_date  DATE
);

CREATE TABLE IF NOT EXISTS daily_event_catalog (
  rotation_index    INT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  flavor_text       TEXT,
  monster_codes     TEXT[] NOT NULL,
  forced_rarity     TEXT NOT NULL CHECK (forced_rarity IN ('ELITE', 'MINI_JEFE', 'JEFE')),
  forced_mutation   TEXT CHECK (forced_mutation IN ('FRENETICO', 'GIGANTE', 'DORADO', 'CORRUPTO')),
  gold_reward       INT NOT NULL,
  dungeon_coins_reward INT NOT NULL,
  bonus_material_item_code TEXT REFERENCES items(code),
  bonus_material_chance_percent INT NOT NULL DEFAULT 0,
  bonus_material_quantity INT NOT NULL DEFAULT 0
);

-- Marca de sesion (mismo patron que world_boss_event_id): que sesiones de combate son un intento
-- del Evento del Dia, para que finalizeSession sepa entregar la recompensa fija del catalogo.
ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS daily_event_code TEXT REFERENCES daily_event_catalog(code);

-- "Leyendas" (ver lib/legendScheduler.js): 5 personajes jugables (uno por clase base) controlados
-- por el sistema en vez de por una persona -- filas normales de players, is_bot solo identifica
-- cuales procesa el scheduler. No cambia nada de como el resto del codigo trata a un jugador.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_bot BOOLEAN NOT NULL DEFAULT FALSE;

-- Mundo 2D: cuándo recolectó cada jugador cada recurso del mapa (lib/worldNodes.js)
CREATE TABLE IF NOT EXISTS world_node_gathers (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  node_id     TEXT    NOT NULL,
  gathered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, node_id)
);

-- Ventana Social del mundo 2D (lib/socialHub.js, routes/socialHub.js)
-- mensaje de estado ("¿Qué estás haciendo?")
CREATE TABLE IF NOT EXISTS player_social (
  player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  status_text VARCHAR(80) NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- nota privada y favorito que cada jugador le pone a cada amigo
CREATE TABLE IF NOT EXISTS friend_notes (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  note      VARCHAR(120) NOT NULL DEFAULT '',
  favorite  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_id, friend_id)
);
-- lazos de amistad: minutos que dos amigos pasaron juntos en el mapa (a_id < b_id)
CREATE TABLE IF NOT EXISTS friend_bonds (
  a_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  b_id           INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points         INTEGER NOT NULL DEFAULT 0,
  last_together  TIMESTAMPTZ,
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id)
);
-- elogios: uno por jugador elogiado y por día
CREATE TABLE IF NOT EXISTS player_commends (
  id        SERIAL PRIMARY KEY,
  from_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  kind      VARCHAR(10) NOT NULL CHECK (kind IN ('valiente', 'amable', 'guia')),
  day       DATE NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (from_id, to_id, day),
  CHECK (from_id <> to_id)
);

-- ============================================================================
-- Colección del cazador (lib/coleccion.js) y jefe mítico de zona (lib/mythic.js).
-- Se crean solas la primera vez que se usan; quedan acá para instalaciones nuevas.
-- ============================================================================
CREATE TABLE IF NOT EXISTS player_bestiary (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  kills      INTEGER NOT NULL DEFAULT 0,
  completed  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_id, monster_id)
);
CREATE TABLE IF NOT EXISTS player_charm_points (
  player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  earned    INTEGER NOT NULL DEFAULT 0,
  spent     INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS player_charms (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  level     SMALLINT NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, code)
);
CREATE TABLE IF NOT EXISTS player_cards (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 0,
  first_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, monster_id)
);
CREATE TABLE IF NOT EXISTS player_card_sockets (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  slot       TEXT NOT NULL CHECK (slot IN ('WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS', 'ACCESSORY')),
  monster_id INTEGER NOT NULL REFERENCES monsters(id) ON DELETE CASCADE,
  PRIMARY KEY (player_id, slot)
);
CREATE TABLE IF NOT EXISTS mythic_zone_progress (
  zone_id INTEGER PRIMARY KEY,
  kills   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mythic_hunts (
  id           SERIAL PRIMARY KEY,
  zone_id      INTEGER NOT NULL,
  monster_code TEXT NOT NULL,
  spot_name    TEXT NOT NULL,
  spot_x       INTEGER NOT NULL,
  spot_y       INTEGER NOT NULL,
  max_hp       INTEGER NOT NULL,
  hp_remaining INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at      TIMESTAMPTZ NOT NULL,
  closed_at    TIMESTAMPTZ,
  killed_by    INTEGER REFERENCES players(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS mythic_hunt_damage (
  hunt_id         INTEGER NOT NULL REFERENCES mythic_hunts(id) ON DELETE CASCADE,
  player_id       INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  total_damage    INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (hunt_id, player_id)
);
ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS mythic_hunt_id INTEGER;
-- fases del jefe mítico (aullido, huida, luna roja) y esbirros cazados (le bajan la defensa)
ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS phase SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE mythic_hunts ADD COLUMN IF NOT EXISTS minion_kills INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS uq_mythic_hunts_active ON mythic_hunts ((status)) WHERE status = 'ACTIVE';
-- las cartas de monstruo también se venden en el mercado (una publicación es de un ítem, una mascota o una carta)
ALTER TABLE player_market_listings ADD COLUMN IF NOT EXISTS card_monster_id INTEGER REFERENCES monsters(id);
ALTER TABLE player_market_listings DROP CONSTRAINT IF EXISTS chk_listing_target;
ALTER TABLE player_market_listings ADD CONSTRAINT chk_listing_target CHECK (
  (item_id IS NOT NULL)::int + (player_pet_id IS NOT NULL)::int + (card_monster_id IS NOT NULL)::int = 1
);

-- Piedra de regreso del mundo 2D: a qué Estatua del Viajero está vinculada y cuándo se usó por
-- última vez (20 min de recarga). La crea también lib/piedraRegreso.js la primera vez.
CREATE TABLE IF NOT EXISTS player_hearthstones (
  player_id  INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  vinculo    TEXT NOT NULL DEFAULT 'aurelia',
  used_at    TIMESTAMPTZ
);

-- Encargos semanales del gremio (lib/guildContracts.js, que también crea la tabla la primera vez).
-- code "_bono" marca que ya se pagó el premio por completar los tres de la semana.
CREATE TABLE IF NOT EXISTS guild_contracts (
  guild_id  INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  week      TEXT    NOT NULL,
  code      TEXT    NOT NULL,
  target    INTEGER NOT NULL,
  progress  INTEGER NOT NULL DEFAULT 0,
  done_at   TIMESTAMPTZ,
  PRIMARY KEY (guild_id, week, code)
);
-- el registro de actividad acepta los encargos cumplidos (CONTRACT) y el bono de los tres (CONTRACT_ALL)
ALTER TABLE guild_activity_log DROP CONSTRAINT IF EXISTS guild_activity_log_type_check;
ALTER TABLE guild_activity_log ADD CONSTRAINT guild_activity_log_type_check CHECK (type IN
  ('JOIN','LEAVE','KICK','PROMOTE','DEMOTE','TRANSFER','LEVEL_UP','EDIT','DONATION','SHOP_PURCHASE','CONTRACT','CONTRACT_ALL'));

-- Historial del comercio directo entre jugadores (lib/trade.js, que también crea la tabla).
CREATE TABLE IF NOT EXISTS player_trades (
  id         SERIAL PRIMARY KEY,
  player_a   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  player_b   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  offer_a    JSONB NOT NULL,
  offer_b    JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Materiales que no tenían rareza (no se podían vender a los artesanos): se les asigna una según
-- el equipo que fabrican. Solo toca los que siguen en NULL.
UPDATE items SET rarity = 'COMUN' WHERE rarity IS NULL AND code IN ('MINERAL_DE_HIERRO', 'CARBON', 'PIEL', 'POLVO_DE_PIEDRA', 'MADERA_DE_ROBLE', 'CUERO_CRUDO', 'TELA_COMUN', 'GEMA_COMUN', 'HIERBA_CURATIVA', 'AGUA_FRESCA', 'HIERBA_MAGICA');
UPDATE items SET rarity = 'POCO_COMUN' WHERE rarity IS NULL AND code IN ('ACERO_REFINADO', 'GEMA_DE_PRECISION', 'PLUMA', 'MINERAL_DE_ACERO', 'ORO_ANTIGUO', 'HILO_DE_PLATA', 'FLOR_LUMINOSA', 'POLVO_ARCANO');
UPDATE items SET rarity = 'RARO' WHERE rarity IS NULL AND code IN ('MINERAL_EPICO', 'GEMA_HELADA', 'CUERO_EPICO', 'ORO_PRIMORDIAL', 'PERLA_MARINA', 'FRAGMENTO_DE_PODER', 'HILO_DE_MITHRIL', 'MIEL_ABEJA_ANTIGUA');
UPDATE items SET rarity = 'EPICO' WHERE rarity IS NULL AND code IN ('HIERRO_PRIMORDIAL', 'ESENCIA_DE_PODER', 'ALMA_REDIMIDA', 'ORO_PURO', 'ALMA_COSMICA', 'FRAGMENTO_DE_LUZ');

-- Correo del reino (lib/correo.js): remitente del sistema, devolución de lo no recogido y cartas
-- de monstruo como adjunto
ALTER TABLE player_messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE player_messages ADD COLUMN IF NOT EXISTS returned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE player_message_items ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE player_message_items ADD COLUMN IF NOT EXISTS monster_id INTEGER REFERENCES monsters(id);

-- Muñecos de venta (lib/puestos.js)
CREATE TABLE IF NOT EXISTS player_stalls (
  id         SERIAL PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  zone       TEXT NOT NULL,
  x          INTEGER NOT NULL,
  y          INTEGER NOT NULL,
  title      TEXT NOT NULL,
  look       TEXT NOT NULL DEFAULT 'oso',
  opened_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at  TIMESTAMPTZ,
  earned     BIGINT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stall_owner_open ON player_stalls(owner_id) WHERE closed_at IS NULL;
CREATE TABLE IF NOT EXISTS player_stall_items (
  id            SERIAL PRIMARY KEY,
  stall_id      INTEGER NOT NULL REFERENCES player_stalls(id) ON DELETE CASCADE,
  item_id       INTEGER REFERENCES items(id),
  monster_id    INTEGER REFERENCES monsters(id),
  enchant_level INTEGER NOT NULL DEFAULT 0,
  quality_tier  SMALLINT NOT NULL DEFAULT 0,
  quantity      INTEGER NOT NULL CHECK (quantity >= 0),
  sold          INTEGER NOT NULL DEFAULT 0,
  price         BIGINT NOT NULL CHECK (price > 0)
);
CREATE TABLE IF NOT EXISTS player_stall_sales (
  id         SERIAL PRIMARY KEY,
  stall_id   INTEGER NOT NULL REFERENCES player_stalls(id) ON DELETE CASCADE,
  buyer_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  entry_id   INTEGER REFERENCES player_stall_items(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  quantity   INTEGER NOT NULL,
  total      BIGINT NOT NULL,
  fee        BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Economía (lib/economia.js): cada cambio de oro de un jugador, para ver cuánto entra y sale por día
CREATE TABLE IF NOT EXISTS economy_gold_log (
  id    BIGSERIAL PRIMARY KEY,
  at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delta BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_economy_gold_log_at ON economy_gold_log(at);
ALTER TABLE economy_gold_log ADD COLUMN IF NOT EXISTS sistema BOOLEAN NOT NULL DEFAULT FALSE;
-- Guía del aventurero (lib/guia.js): paso actual de la primera hora en el mundo 2D
CREATE TABLE IF NOT EXISTS player_guide (
  player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  step        SMALLINT NOT NULL DEFAULT 0,
  progressive BOOLEAN NOT NULL DEFAULT FALSE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Exploración del mundo 2D (lib/exploracion.js): niebla del mapa, subzonas descubiertas y cofres secretos
CREATE TABLE IF NOT EXISTS player_exploration (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  zone_dir  TEXT NOT NULL,
  cells     TEXT NOT NULL DEFAULT '',
  subzones  TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (player_id, zone_dir)
);
CREATE TABLE IF NOT EXISTS player_secrets (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  secret_id TEXT NOT NULL,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, secret_id)
);
-- Mercader ambulante (lib/eventos.js): cuántas compras de cada oferta hizo cada jugador por día
CREATE TABLE IF NOT EXISTS player_wanderer_buys (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  offer     TEXT NOT NULL,
  qty       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, day, offer)
);

-- La Cripta del Vigía (lib/cripta.js también la crea sola): recorrido de cada jugador y a qué
-- guardián o jefe corresponde cada combate. Los monstruos los inserta lib/cripta.js.
CREATE TABLE IF NOT EXISTS player_crypt_runs (
  player_id    INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  braziers     SMALLINT NOT NULL DEFAULT 0,
  guardians    TEXT[] NOT NULL DEFAULT '{}',
  clears       INTEGER NOT NULL DEFAULT 0,
  chest_at     TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS crypt_target TEXT;

-- Piedra de regreso: la del aventurero nuevo empieza sin vincular (vinculo NULL)
ALTER TABLE player_hearthstones ALTER COLUMN vinculo DROP NOT NULL;
ALTER TABLE player_hearthstones ALTER COLUMN vinculo DROP DEFAULT;

-- ============================================================================================
-- Crafteo v2 (mundo 2D). Se puede correr varias veces sin duplicar nada. No usa ON CONFLICT: en
-- bases viejas puede faltar la restricción única de crafting_recipe_ingredients, así que cada
-- insert mira antes si ya existe.
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
INSERT INTO items (code, name, item_type, rarity, required_level, is_craftable, obtain_method, buy_price, description)
SELECT v.* FROM (VALUES
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
) AS v(code, name, item_type, rarity, required_level, is_craftable, obtain_method, buy_price, description)
WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.code = v.code);

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
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipes c2 WHERE c2.code = v.code);

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
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);

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
  AND NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = t.recipe_id AND x.item_id = i.id);
DROP TABLE tmp_pradera_extra;

-- ============================================================================================
-- Crafteo: arreglos de nombres y recetas (se puede correr varias veces; sin ON CONFLICT)
-- ============================================================================================
-- Los pergaminos de receta se llamaban como materiales ("Collar del Capitán (Guerrero)" junto al
-- material "Collar del Capitán de los Lobos"): ahora "Pergamino: Set del Capitán (Guerrero)".
UPDATE items i SET
  name = 'Pergamino: Set ' || s.label || ' (' || c.label || ')',
  description = 'Pergamino de recetas: léelo desde la mochila para aprender a fabricar el set ' || s.label || ' de ' || c.label || '.'
FROM (VALUES
  ('CAPITAN', 'del Capitán'), ('TITAN', 'del Titán'), ('TITAN_FUEGO', 'del Titán de Fuego'),
  ('ACANTILADO', 'del Acantilado'), ('BESTIA', 'de las Profundidades'), ('CALDERA', 'de la Caldera'),
  ('LICH', 'del Lich'), ('OCEANO', 'del Océano'), ('REY_HIELO', 'del Rey del Hielo'), ('REY_MONTANA', 'del Rey de Montaña')
) AS s(k, label),
(VALUES ('GUERRERO', 'Guerrero'), ('MAGO', 'Mago'), ('ARQUERO', 'Arquero'), ('PICARO', 'Pícaro'), ('SACERDOTE', 'Sacerdote')) AS c(k, label)
WHERE i.code = 'SCROLL_' || s.k || '_' || c.k;

-- dos "Amuleto del Capitán" distintos (el crafteado con colmillos y el que suelta el Capitán)
UPDATE items SET name = 'Amuleto de Colmillos' WHERE code = 'AMULETO_DEL_CAPITAN';

-- la Daga de Precisión Crafteada (Pradera) pedía Acero Refinado, que solo cae en las Montañas
UPDATE crafting_recipe_ingredients ri SET item_id = (SELECT id FROM items WHERE code = 'LINGOTE_HIERRO')
FROM crafting_recipes cr
WHERE ri.recipe_id = cr.id AND cr.code = 'RECETA_DAGA_DE_PRECISION_CRAFTEADA'
  AND ri.item_id = (SELECT id FROM items WHERE code = 'ACERO_REFINADO')
  AND NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = (SELECT id FROM items WHERE code = 'LINGOTE_HIERRO'));

-- Piel y Cuero Crudo (casi sin uso) también se curten en Cuero Tratado
INSERT INTO crafting_recipes (code, result_item_id, result_quantity, rarity, success_rate_percent, zone_id, description, station)
SELECT v.code, i.id, 1, 'COMUN', 100, 1, v.descr, NULL
FROM (VALUES
  ('CUERO_TRATADO_PIEL', 'Curte las pieles sueltas.'),
  ('CUERO_TRATADO_CRUDO', 'Curte el cuero crudo.')
) AS v(code, descr)
JOIN items i ON i.code = 'CUERO_TRATADO'
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipes c2 WHERE c2.code = v.code);

INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, 2
FROM (VALUES ('CUERO_TRATADO_PIEL', 'PIEL'), ('CUERO_TRATADO_CRUDO', 'CUERO_CRUDO')) AS v(recipe_code, item_code)
JOIN crafting_recipes cr ON cr.code = v.recipe_code
JOIN items i ON i.code = v.item_code
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);

-- ============================================================================================
-- Botín de la Pradera que no servía para nada: ahora tiene uso (repetible; sin ON CONFLICT)
-- ============================================================================================
-- Insignia de Bandido (Bandido Corrupto, 30%): la piden los accesorios de la Pradera y se
-- entregan en el tablón de Ren ("Recompensa por bandidos", diaria).
-- Gema Común (Araña, Chamán): anillo y collar de la Pradera.
-- Polvo Arcano (Chamán): orbe y cristal del mago (Pradera, Capitán y Titán).
-- Agua Fresca (Rata): también se purifica en el Pilar de Aethra.
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, x.id, v.qty
FROM (VALUES
  ('Anillo de Pradera', 'INSIGNIA_DE_BANDIDO', 2), ('Amuleto de Pradera', 'INSIGNIA_DE_BANDIDO', 2),
  ('Collar de Pradera', 'INSIGNIA_DE_BANDIDO', 2), ('Brazalete de Pradera', 'INSIGNIA_DE_BANDIDO', 2),
  ('Anillo de Pradera', 'GEMA_COMUN', 1), ('Collar de Pradera', 'GEMA_COMUN', 1),
  ('Orbe de Pradera', 'POLVO_ARCANO', 1), ('Cristal de Pradera', 'POLVO_ARCANO', 1),
  ('Orbe del Capitán', 'POLVO_ARCANO', 2), ('Cristal del Capitán', 'POLVO_ARCANO', 2),
  ('Orbe del Titán', 'POLVO_ARCANO', 3), ('Cristal del Titán', 'POLVO_ARCANO', 3)
) AS v(result_name, item_code, qty)
JOIN items r ON r.name = v.result_name AND r.item_type = 'EQUIPMENT'
JOIN crafting_recipes cr ON cr.result_item_id = r.id AND cr.zone_id = 1
JOIN items x ON x.code = v.item_code
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients e WHERE e.recipe_id = cr.id AND e.item_id = x.id);

INSERT INTO crafting_recipes (code, result_item_id, result_quantity, rarity, success_rate_percent, zone_id, artisan_name, description, station)
SELECT 'AGUA_PURIFICADA_FRESCA', i.id, 1, 'COMUN', 100, 1, 'Pilar de Aethra',
  'Purifica el agua fresca en el Pilar de Aethra. Los domingos (Festival de Aethra) rinde el doble.', 'pilar'
FROM items i
WHERE i.code = 'AGUA_PURIFICADA' AND NOT EXISTS (SELECT 1 FROM crafting_recipes c2 WHERE c2.code = 'AGUA_PURIFICADA_FRESCA');
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, 1 FROM crafting_recipes cr JOIN items i ON i.code = 'AGUA_FRESCA'
WHERE cr.code = 'AGUA_PURIFICADA_FRESCA'
  AND NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);
UPDATE items SET description = 'Agua de manantial. Purifícala en el Pilar de Aethra para usarla en pociones.' WHERE code = 'AGUA_FRESCA';
UPDATE items SET description = 'Insignia de un bandido de la Pradera. Ren paga por ellas (tablón de la Aldea Espiga) y sirve para los accesorios de la Pradera.' WHERE code = 'INSIGNIA_DE_BANDIDO';

-- Recompensa por bandidos: misión diaria del tablón de Ren (entregar 8 insignias)
INSERT INTO quests (code, name, quest_type, zone_id, min_level, npc_name, location_name, is_repeatable, repeat_cooldown_hours,
  reputation_reward, gold_reward, xp_reward, difficulty_stars, description)
SELECT 'PRADERA_DAILY_RECOMPENSA_BANDIDOS', 'Recompensa por Bandidos', 'DIARIA', 1, 3, 'Guardabosque Local', 'Aldea Espiga', TRUE, 6,
  15, 350, 700, 1,
  'Los bandidos corruptos asaltan los caminos de la Pradera. Ren paga por cada lote de insignias que le traigas como prueba.'
WHERE NOT EXISTS (SELECT 1 FROM quests WHERE code = 'PRADERA_DAILY_RECOMPENSA_BANDIDOS');
INSERT INTO quest_objectives (quest_id, objective_type, item_id, target_count, description)
SELECT q.id, 'COLLECT_ITEM', i.id, 8, 'Entrega 8 Insignias de Bandido.'
FROM quests q JOIN items i ON i.code = 'INSIGNIA_DE_BANDIDO'
WHERE q.code = 'PRADERA_DAILY_RECOMPENSA_BANDIDOS'
  AND NOT EXISTS (SELECT 1 FROM quest_objectives o WHERE o.quest_id = q.id);

-- ============================================================================================
-- Carbón desde madera y piezas sueltas con materiales refinados (repetible; sin ON CONFLICT)
-- ============================================================================================
-- El Carbón solo se compraba en la tienda y todo lo de metal depende de él (Lingote de Hierro).
-- Ahora también se hace en la forja con Madera de Roble (troncos del mapa).
UPDATE items SET is_craftable = TRUE, obtain_method = 'Tienda del herrero o crafteo (forja)',
  description = 'Carbón para la forja. Se compra al herrero o se hace quemando madera de roble en la forja.'
WHERE code = 'CARBON';
INSERT INTO crafting_recipes (code, result_item_id, result_quantity, rarity, success_rate_percent, zone_id, artisan_name, description, station)
SELECT 'CARBON_MADERA', i.id, 1, 'COMUN', 100, 1, 'Forja', 'Quema madera de roble en la forja.', 'forja'
FROM items i WHERE i.code = 'CARBON' AND NOT EXISTS (SELECT 1 FROM crafting_recipes WHERE code = 'CARBON_MADERA');
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, 2 FROM crafting_recipes cr JOIN items i ON i.code = 'MADERA_DE_ROBLE'
WHERE cr.code = 'CARBON_MADERA' AND NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);

-- Espada de Hierro Crafteada: 3 Mineral + 1 Carbón → 1 Lingote de Hierro (lo mismo, ya refinado)
DELETE FROM crafting_recipe_ingredients ri USING crafting_recipes cr, items x
WHERE ri.recipe_id = cr.id AND x.id = ri.item_id AND cr.code = 'RECETA_ESPADA_DE_HIERRO_CRAFTEADA'
  AND x.code IN ('MINERAL_DE_HIERRO', 'CARBON');
-- Peto de Cuero Reforzado: 8 Cuero Crudo → 4 Cuero Tratado y 3 Mineral → 1 Lingote de Hierro
DELETE FROM crafting_recipe_ingredients ri USING crafting_recipes cr, items x
WHERE ri.recipe_id = cr.id AND x.id = ri.item_id AND cr.code = 'RECETA_PETO_CUERO_REFORZADO'
  AND x.code IN ('CUERO_CRUDO', 'MINERAL_DE_HIERRO');
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, v.qty
FROM (VALUES
  ('RECETA_ESPADA_DE_HIERRO_CRAFTEADA', 'LINGOTE_HIERRO', 1),
  ('RECETA_PETO_CUERO_REFORZADO', 'CUERO_TRATADO', 4),
  ('RECETA_PETO_CUERO_REFORZADO', 'LINGOTE_HIERRO', 1)
) AS v(recipe_code, item_code, qty)
JOIN crafting_recipes cr ON cr.code = v.recipe_code
JOIN items i ON i.code = v.item_code
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);
UPDATE items SET description = 'Material de crafteo. Pieles sueltas: se curten en Cuero Tratado.' WHERE code = 'PIEL';

-- ============================================================================================
-- Recolección v4: lino, cuarzo de río y trigo (repetible; sin ON CONFLICT)
-- ============================================================================================
-- Puntos nuevos del mapa (lib/worldNodes.js): lino → Fibra de Lino, cuarzo → Cuarzo de Río,
-- trigo → Trigo. Con ellos: Tela de Lino (reemplaza a la Tela Común, que solo caía de monstruos,
-- y a la Piel de Lobo en la ropa de tela), Gema Común pulida en la forja y Pan de Campo.
INSERT INTO items (code, name, item_type, rarity, required_level, is_craftable, obtain_method, buy_price, description)
SELECT v.* FROM (VALUES
  ('FIBRA_LINO', 'Fibra de Lino', 'MATERIAL', 'COMUN', NULL::int, FALSE, 'Recolección (lino)', NULL::int, 'Fibra del lino silvestre de la Pradera. Se hila en Tela de Lino.'),
  ('TELA_LINO', 'Tela de Lino', 'MATERIAL', 'COMUN', NULL, TRUE, 'Crafteo', NULL, 'Tela tejida con fibra de lino. Para la ropa de tela y los vendajes.'),
  ('CUARZO_RIO', 'Cuarzo de Río', 'MATERIAL', 'COMUN', NULL, FALSE, 'Recolección (orillas)', NULL, 'Cristales de cuarzo de las orillas. Se pulen en la forja hasta dar una Gema Común.'),
  ('TRIGO', 'Trigo', 'MATERIAL', 'COMUN', NULL, FALSE, 'Recolección (Campos de Espiga)', NULL, 'Espigas de trigo de la Pradera. Se muelen en harina.'),
  ('HARINA', 'Harina', 'MATERIAL', 'COMUN', NULL, TRUE, 'Crafteo', NULL, 'Harina de trigo para hornear pan.'),
  ('PAN_CAMPO', 'Pan de Campo', 'CONSUMABLE', 'COMUN', 1, TRUE, 'Crafteo', NULL, 'Hogaza recién horneada. Cura un poco, también fuera de combate.')
) AS v(code, name, item_type, rarity, required_level, is_craftable, obtain_method, buy_price, description)
WHERE NOT EXISTS (SELECT 1 FROM items i WHERE i.code = v.code);

INSERT INTO item_stat_bonuses (item_id, stat_code, amount, is_percent, description, duration_turns)
SELECT i.id, 'HEAL_HP', 60, FALSE, 'Restaura 60 HP', NULL FROM items i
WHERE i.code = 'PAN_CAMPO' AND NOT EXISTS (SELECT 1 FROM item_stat_bonuses b WHERE b.item_id = i.id AND b.stat_code = 'HEAL_HP');

INSERT INTO crafting_recipes (code, result_item_id, result_quantity, rarity, success_rate_percent, zone_id, artisan_name, description, station)
SELECT v.code, i.id, v.qty, 'COMUN', 100, 1, v.artisan, v.descr, v.station
FROM (VALUES
  ('TELA_LINO', 'TELA_LINO', 1, NULL, 'Hila y teje la fibra de lino.', NULL),
  ('GEMA_CUARZO', 'GEMA_COMUN', 1, 'Forja', 'Pule el cuarzo de río en la forja.', 'forja'),
  ('HARINA', 'HARINA', 1, NULL, 'Muele el trigo.', NULL),
  ('PAN_CAMPO', 'PAN_CAMPO', 2, 'Cocina', 'Hornea pan con harina y agua.', NULL)
) AS v(code, item_code, qty, artisan, descr, station)
JOIN items i ON i.code = v.item_code
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipes c2 WHERE c2.code = v.code);

INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, v.qty
FROM (VALUES
  ('TELA_LINO', 'FIBRA_LINO', 3), ('GEMA_CUARZO', 'CUARZO_RIO', 3), ('HARINA', 'TRIGO', 3),
  ('PAN_CAMPO', 'HARINA', 1), ('PAN_CAMPO', 'AGUA_PURIFICADA', 1)
) AS v(recipe_code, item_code, qty)
JOIN crafting_recipes cr ON cr.code = v.recipe_code
JOIN items i ON i.code = v.item_code
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);
UPDATE items SET is_craftable = TRUE WHERE code = 'GEMA_COMUN';

-- Vendaje (2 Tela Común → 1 Tela de Lino) y Peto de Cuero Reforzado (5 Tela Común → 3 Tela de Lino)
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, i.id, v.qty
FROM (VALUES ('VENDAJE', 1), ('RECETA_PETO_CUERO_REFORZADO', 3)) AS v(recipe_code, qty)
JOIN crafting_recipes cr ON cr.code = v.recipe_code
JOIN items i ON i.code = 'TELA_LINO'
WHERE NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = i.id);
DELETE FROM crafting_recipe_ingredients ri USING crafting_recipes cr, items x
WHERE ri.recipe_id = cr.id AND x.id = ri.item_id AND cr.code IN ('VENDAJE', 'RECETA_PETO_CUERO_REFORZADO') AND x.code = 'TELA_COMUN';

-- Ropa de tela del mago y el sacerdote (Pradera, Capitán y Titán): la Piel de Lobo pasa a ser
-- Tela de Lino (la mitad, redondeando hacia arriba)
INSERT INTO crafting_recipe_ingredients (recipe_id, item_id, quantity)
SELECT cr.id, tl.id, (ri.quantity + 1) / 2
FROM crafting_recipes cr
JOIN items r ON r.id = cr.result_item_id
JOIN crafting_recipe_ingredients ri ON ri.recipe_id = cr.id
JOIN items pl ON pl.id = ri.item_id AND pl.code = 'PIEL_DE_LOBO'
JOIN items tl ON tl.code = 'TELA_LINO'
WHERE cr.zone_id = 1 AND r.item_type = 'EQUIPMENT' AND r.class_id IN (2, 5) AND r.slot IN ('ARMOR', 'HELMET', 'GLOVES', 'BOOTS')
  AND NOT EXISTS (SELECT 1 FROM crafting_recipe_ingredients x WHERE x.recipe_id = cr.id AND x.item_id = tl.id);
DELETE FROM crafting_recipe_ingredients ri USING crafting_recipes cr, items r, items pl
WHERE ri.recipe_id = cr.id AND r.id = cr.result_item_id AND pl.id = ri.item_id AND pl.code = 'PIEL_DE_LOBO'
  AND cr.zone_id = 1 AND r.item_type = 'EQUIPMENT' AND r.class_id IN (2, 5) AND r.slot IN ('ARMOR', 'HELMET', 'GLOVES', 'BOOTS')
  AND EXISTS (SELECT 1 FROM crafting_recipe_ingredients x JOIN items tl ON tl.id = x.item_id AND tl.code = 'TELA_LINO' WHERE x.recipe_id = cr.id);

-- ============================================================================================
-- Equilibrio del crafteo de la Pradera (repetible; sin ON CONFLICT)
-- ============================================================================================
-- El set del Capitán pedía ~195 victorias contra el Capitán de los Lobos (minijefe que reaparece
-- cada 5 min): el Collar caía al 8% y cada pieza pedía 2. Ahora cae al 40% y las piezas del set del
-- Capitán piden 1 (≈20 victorias por set; el del Titán ≈26).
UPDATE monster_drops md SET drop_chance_percent = 40
FROM monsters m, items x
WHERE md.monster_id = m.id AND md.item_id = x.id AND m.code = 'CAPITAN_LOBOS' AND x.code = 'COLLAR_CAPITAN_LOBOS'
  AND md.drop_chance_percent < 40;
UPDATE crafting_recipe_ingredients ri SET quantity = 1
FROM crafting_recipes cr, items r, items x
WHERE ri.recipe_id = cr.id AND r.id = cr.result_item_id AND x.id = ri.item_id
  AND cr.zone_id = 1 AND r.name LIKE '% del Capitán' AND x.code = 'COLLAR_CAPITAN_LOBOS' AND ri.quantity > 1;

-- Tope de venta propio por objeto (lib/npcSell.js). El Agua Purificada se hace con un Frasco de 8
-- de oro y se vendía a 25: oro infinito. Ahora un NPC paga como mucho 4.
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_sell_price INT;
UPDATE items SET max_sell_price = 4 WHERE code = 'AGUA_PURIFICADA';

-- ============================================================================================
-- Equilibrio, fase A (repetible; sin ON CONFLICT)
-- ============================================================================================
-- El Sacerdote no tenía ningún ataque hasta el nivel 8 (Rayo Sagrado): ataque mágico de luz de nv 1.
INSERT INTO skills (class_id, code, name, skill_type, damage_school, element_id, target_type, base_value, scaling_stat,
  scaling_multiplier, hits, mana_cost, is_passive, learn_method, learn_level, description)
SELECT 5, 'SACERDOTE_LUZ', 'Luz Sagrada', 'ATAQUE', 'MAGICO', (SELECT id FROM elements WHERE code = 'LIGHT'), 'ENEMY', 20, 'MAG',
  1.10, 1, 12, FALSE, 'LEVEL', 1, 'Un destello de luz sagrada que quema al enemigo.'
WHERE NOT EXISTS (SELECT 1 FROM skills WHERE code = 'SACERDOTE_LUZ');

-- Los sets del Capitán (minijefe nv 10-12) y del Titán (jefe nv 14-15) pedían nivel 20 y 25: no se
-- podían usar en la Pradera, que llega al 15. Ahora nivel 10 y 14 (equipo y recetas).
UPDATE items SET required_level = 10 WHERE item_type = 'EQUIPMENT' AND name LIKE '% del Capitán' AND required_level = 20;
UPDATE items SET required_level = 14 WHERE item_type = 'EQUIPMENT' AND name LIKE '% del Titán' AND required_level = 25;
UPDATE crafting_recipes cr SET required_level = 10 FROM items i
WHERE i.id = cr.result_item_id AND i.name LIKE '% del Capitán' AND cr.required_level IS DISTINCT FROM 10;
UPDATE crafting_recipes cr SET required_level = 14 FROM items i
WHERE i.id = cr.result_item_id AND i.name LIKE '% del Titán' AND cr.required_level IS DISTINCT FROM 14;

-- El crítico sumaba solo +10% de daño: ahora +50% (todas las clases, también las evoluciones)
UPDATE classes SET base_crit_damage = 50 WHERE base_crit_damage = 10;

-- Todas las clases suben igual de rápido (Mago 1.2 y Sacerdote 1.1 eran justo las que peor peleaban
-- solas; y una evolución con otra velocidad que su clase base frenaba la subida al evolucionar).
UPDATE classes SET xp_rate = 1.00 WHERE xp_rate <> 1.00;

-- ============================================================================================
-- Equilibrio, fases B y C: la Pradera por fórmulas (lib/equilibrio.js; generado con
-- node scripts/equilibrio/generar.js --sql): monstruos (también la cripta y la cacería mítica),
-- crecimiento de las clases y sus evoluciones, habilidades de las clases base y equipo de nivel 1-15.
-- v2: rareza más baja en el equipo épico/legendario, monstruos con más vida desde el nivel 10 y
-- habilidad del tramo alto más suave. Valores fijos: se puede correr varias veces. Al final deja
-- pendientes las versiones de balance_versions y el servidor recalcula las stats guardadas de
-- jugadores y compañeros.
-- ============================================================================================
-- monstruos de la Pradera (filas en su nivel mínimo, en el 9 y en el 15: la curva es lineal entre filas)
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'ARANA_VENENOSA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'ARANA_VENENOSA'), v.* FROM (VALUES
  (1, 119, 13, 20, 7, 16, 13, 5, 10, 50, 0),
  (9, 425, 44, 73, 22, 60, 34, 7.4, 11.6, 50, 0),
  (15, 935, 67, 112, 33, 93, 49, 9.2, 12.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'ARANA_VENENOSA') IS NOT NULL;
UPDATE monsters SET base_hp = 119, base_atk = 13, base_def = 20, base_magic_atk = 7, base_magic_def = 16, base_spd = 13, base_evasion = 5, base_crit_chance = 10, base_crit_damage = 50 WHERE code = 'ARANA_VENENOSA';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'BANDIDO_CORRUPTO');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'BANDIDO_CORRUPTO'), v.* FROM (VALUES
  (1, 140, 15, 19, 8, 15, 10, 5, 6, 50, 0),
  (9, 500, 51, 69, 25, 57, 26, 7.4, 7.6, 50, 0),
  (15, 1100, 77, 107, 39, 88, 38, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'BANDIDO_CORRUPTO') IS NOT NULL;
UPDATE monsters SET base_hp = 140, base_atk = 15, base_def = 19, base_magic_atk = 8, base_magic_def = 15, base_spd = 10, base_evasion = 5, base_crit_chance = 6, base_crit_damage = 50 WHERE code = 'BANDIDO_CORRUPTO';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'GOBLIN_SAQUEADOR');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'GOBLIN_SAQUEADOR'), v.* FROM (VALUES
  (1, 140, 15, 16, 7, 12, 11, 5, 6, 50, 0),
  (9, 500, 48, 59, 24, 48, 29, 7.4, 7.6, 50, 0),
  (15, 1100, 74, 92, 37, 74, 42, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'GOBLIN_SAQUEADOR') IS NOT NULL;
UPDATE monsters SET base_hp = 140, base_atk = 15, base_def = 16, base_magic_atk = 7, base_magic_def = 12, base_spd = 11, base_evasion = 5, base_crit_chance = 6, base_crit_damage = 50 WHERE code = 'GOBLIN_SAQUEADOR';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'LOBO_PRADERA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'LOBO_PRADERA'), v.* FROM (VALUES
  (1, 140, 14, 18, 7, 14, 12, 5, 6, 50, 0),
  (9, 500, 46, 66, 23, 54, 31, 7.4, 7.6, 50, 0),
  (15, 1100, 70, 102, 35, 83, 46, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'LOBO_PRADERA') IS NOT NULL;
UPDATE monsters SET base_hp = 140, base_atk = 14, base_def = 18, base_magic_atk = 7, base_magic_def = 14, base_spd = 12, base_evasion = 5, base_crit_chance = 6, base_crit_damage = 50 WHERE code = 'LOBO_PRADERA';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'RATA_ALCANTARILLA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'RATA_ALCANTARILLA'), v.* FROM (VALUES
  (1, 112, 12, 15, 6, 16, 14, 8, 6, 50, 0),
  (9, 400, 39, 56, 20, 60, 36, 10.4, 7.6, 50, 0),
  (15, 880, 60, 87, 30, 93, 53, 12.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'RATA_ALCANTARILLA') IS NOT NULL;
UPDATE monsters SET base_hp = 112, base_atk = 12, base_def = 15, base_magic_atk = 6, base_magic_def = 16, base_spd = 14, base_evasion = 8, base_crit_chance = 6, base_crit_damage = 50 WHERE code = 'RATA_ALCANTARILLA';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'CHAMAN_OSCURO');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'CHAMAN_OSCURO'), v.* FROM (VALUES
  (8, 819, 20, 56, 53, 71, 25, 7.1, 7.4, 50, 0),
  (9, 900, 22, 62, 58, 79, 27, 7.4, 7.6, 50, 0),
  (15, 1980, 34, 95, 88, 122, 40, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'CHAMAN_OSCURO') IS NOT NULL;
UPDATE monsters SET base_hp = 819, base_atk = 20, base_def = 56, base_magic_atk = 53, base_magic_def = 71, base_spd = 25, base_evasion = 7.1, base_crit_chance = 7.4, base_crit_damage = 50 WHERE code = 'CHAMAN_OSCURO';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'LOBO_FEROZ');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'LOBO_FEROZ'), v.* FROM (VALUES
  (8, 819, 50, 66, 25, 53, 32, 7.1, 7.4, 50, 0),
  (9, 900, 55, 73, 28, 59, 34, 7.4, 7.6, 50, 0),
  (15, 1980, 84, 112, 42, 92, 50, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'LOBO_FEROZ') IS NOT NULL;
UPDATE monsters SET base_hp = 819, base_atk = 50, base_def = 66, base_magic_atk = 25, base_magic_def = 53, base_spd = 32, base_evasion = 7.1, base_crit_chance = 7.4, base_crit_damage = 50 WHERE code = 'LOBO_FEROZ';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'CAPITAN_LOBOS');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'CAPITAN_LOBOS'), v.* FROM (VALUES
  (10, 2100, 70, 86, 35, 74, 36, 7.7, 7.8, 50, 0),
  (15, 3850, 98, 122, 49, 105, 49, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'CAPITAN_LOBOS') IS NOT NULL;
UPDATE monsters SET base_hp = 2100, base_atk = 70, base_def = 86, base_magic_atk = 35, base_magic_def = 74, base_spd = 36, base_evasion = 7.7, base_crit_chance = 7.8, base_crit_damage = 50 WHERE code = 'CAPITAN_LOBOS';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'TITAN_PRADERA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'TITAN_PRADERA'), v.* FROM (VALUES
  (14, 6000, 106, 125, 53, 113, 43, 8.9, 8.6, 50, 0),
  (15, 6600, 112, 133, 56, 120, 46, 9.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'TITAN_PRADERA') IS NOT NULL;
UPDATE monsters SET base_hp = 6000, base_atk = 106, base_def = 125, base_magic_atk = 53, base_magic_def = 113, base_spd = 43, base_evasion = 8.9, base_crit_chance = 8.6, base_crit_damage = 50 WHERE code = 'TITAN_PRADERA';
-- cripta del Vigía y cacería mítica (definidos en lib/cripta.js y lib/mythic.js con la misma curva)
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'CRIPTA_CENTINELA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'CRIPTA_CENTINELA'), v.* FROM (VALUES
  (5, 576, 36, 58, 18, 35, 17, 6.2, 6.8, 50, 0),
  (12, 1440, 70, 116, 35, 71, 30, 8.3, 8.2, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'CRIPTA_CENTINELA') IS NOT NULL;
UPDATE monsters SET base_hp = 576, base_atk = 36, base_def = 58, base_magic_atk = 18, base_magic_def = 35, base_spd = 17, base_evasion = 6.2, base_crit_chance = 6.8, base_crit_damage = 50 WHERE code = 'CRIPTA_CENTINELA';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'CRIPTA_ESPECTRO');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'CRIPTA_ESPECTRO'), v.* FROM (VALUES
  (5, 490, 14, 32, 38, 54, 23, 10.2, 6.8, 50, 6),
  (12, 1224, 28, 65, 73, 109, 40, 12.3, 8.2, 50, 6)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'CRIPTA_ESPECTRO') IS NOT NULL;
UPDATE monsters SET base_hp = 490, base_atk = 14, base_def = 32, base_magic_atk = 38, base_magic_def = 54, base_spd = 23, base_evasion = 10.2, base_crit_chance = 6.8, base_crit_damage = 50 WHERE code = 'CRIPTA_ESPECTRO';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'CRIPTA_VIGIA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'CRIPTA_VIGIA'), v.* FROM (VALUES
  (5, 1728, 48, 60, 24, 49, 22, 6.2, 6.8, 50, 6),
  (12, 4320, 93, 120, 46, 99, 38, 8.3, 8.2, 50, 6)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'CRIPTA_VIGIA') IS NOT NULL;
UPDATE monsters SET base_hp = 1728, base_atk = 48, base_def = 60, base_magic_atk = 24, base_magic_def = 49, base_spd = 22, base_evasion = 6.2, base_crit_chance = 6.8, base_crit_damage = 50 WHERE code = 'CRIPTA_VIGIA';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'LOBO_ESPECTRAL');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'LOBO_ESPECTRAL'), v.* FROM (VALUES
  (1, 119, 13, 18, 6, 16, 12, 6, 6, 50, 0),
  (15, 935, 63, 102, 32, 93, 46, 10.2, 8.8, 50, 0)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'LOBO_ESPECTRAL') IS NOT NULL;
UPDATE monsters SET base_hp = 119, base_atk = 13, base_def = 18, base_magic_atk = 6, base_magic_def = 16, base_spd = 12, base_evasion = 6, base_crit_chance = 6, base_crit_damage = 50 WHERE code = 'LOBO_ESPECTRAL';
DELETE FROM monster_level_scalings WHERE monster_id = (SELECT id FROM monsters WHERE code = 'MITICO_AULLALUNA');
INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
SELECT (SELECT id FROM monsters WHERE code = 'MITICO_AULLALUNA'), v.* FROM (VALUES
  (1, 588, 22, 23, 11, 22, 13, 5, 6, 50, 6),
  (15, 4620, 112, 133, 56, 132, 50, 9.2, 8.8, 50, 6)
) AS v(level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage) WHERE (SELECT id FROM monsters WHERE code = 'MITICO_AULLALUNA') IS NOT NULL;
UPDATE monsters SET base_hp = 588, base_atk = 22, base_def = 23, base_magic_atk = 11, base_magic_def = 22, base_spd = 13, base_evasion = 5, base_crit_chance = 6, base_crit_damage = 50 WHERE code = 'MITICO_AULLALUNA';
-- crecimiento por nivel (las 5 clases base y sus evoluciones)
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.66, mana_per_level = 18 WHERE class_id = 78;
UPDATE class_growths SET hp_per_level = 22, atk_per_level = 8, def_per_level = 6, mag_per_level = 1, magic_def_per_level = 4, spd_per_level = 2.5, mana_per_level = 10 WHERE class_id = 1;
UPDATE class_growths SET hp_per_level = 13, atk_per_level = 7.3, def_per_level = 4, mag_per_level = 1, magic_def_per_level = 3.5, spd_per_level = 3.5, mana_per_level = 12 WHERE class_id = 3;
UPDATE class_growths SET hp_per_level = 12, atk_per_level = 7.5, def_per_level = 4.5, mag_per_level = 1, magic_def_per_level = 3.5, spd_per_level = 4, mana_per_level = 12 WHERE class_id = 4;
UPDATE class_growths SET hp_per_level = 27.5, atk_per_level = 10.2, def_per_level = 7.8, mag_per_level = 1.25, magic_def_per_level = 4.33, spd_per_level = 3.13, mana_per_level = 12.5 WHERE class_id = 6;
UPDATE class_growths SET hp_per_level = 27.5, atk_per_level = 10.4, def_per_level = 7.5, mag_per_level = 1.25, magic_def_per_level = 4.33, spd_per_level = 3.13, mana_per_level = 12.5 WHERE class_id = 7;
UPDATE class_growths SET hp_per_level = 27.5, atk_per_level = 10, def_per_level = 7.8, mag_per_level = 1.25, magic_def_per_level = 4.33, spd_per_level = 3.13, mana_per_level = 12.5 WHERE class_id = 8;
UPDATE class_growths SET hp_per_level = 27.5, atk_per_level = 10.4, def_per_level = 7.5, mag_per_level = 1.25, magic_def_per_level = 4.33, spd_per_level = 3.13, mana_per_level = 12.5 WHERE class_id = 9;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 9.1, def_per_level = 5, mag_per_level = 1.25, magic_def_per_level = 2.92, spd_per_level = 4.38, mana_per_level = 15 WHERE class_id = 16;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 9.1, def_per_level = 5, mag_per_level = 1.25, magic_def_per_level = 2.92, spd_per_level = 4.38, mana_per_level = 15 WHERE class_id = 17;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 9.1, def_per_level = 5, mag_per_level = 1.25, magic_def_per_level = 2.92, spd_per_level = 4.46, mana_per_level = 15 WHERE class_id = 18;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 8.75, def_per_level = 5, mag_per_level = 1.3, magic_def_per_level = 2.92, spd_per_level = 4.46, mana_per_level = 15 WHERE class_id = 19;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 8.75, def_per_level = 5, mag_per_level = 1.3, magic_def_per_level = 2.92, spd_per_level = 4.46, mana_per_level = 15 WHERE class_id = 20;
UPDATE class_growths SET hp_per_level = 15, atk_per_level = 10, def_per_level = 5.63, mag_per_level = 1.25, magic_def_per_level = 3.89, spd_per_level = 5.2, mana_per_level = 15 WHERE class_id = 21;
UPDATE class_growths SET hp_per_level = 15, atk_per_level = 10.4, def_per_level = 5.63, mag_per_level = 1.25, magic_def_per_level = 3.89, spd_per_level = 5, mana_per_level = 15 WHERE class_id = 22;
UPDATE class_growths SET hp_per_level = 15, atk_per_level = 10, def_per_level = 5.63, mag_per_level = 1.25, magic_def_per_level = 3.89, spd_per_level = 5.2, mana_per_level = 15 WHERE class_id = 23;
UPDATE class_growths SET hp_per_level = 13, atk_per_level = 1.5, def_per_level = 4.5, mag_per_level = 8, magic_def_per_level = 6, spd_per_level = 2.5, mana_per_level = 25 WHERE class_id = 2;
UPDATE class_growths SET hp_per_level = 15, atk_per_level = 10, def_per_level = 5.63, mag_per_level = 1.25, magic_def_per_level = 3.89, spd_per_level = 5.2, mana_per_level = 15 WHERE class_id = 24;
UPDATE class_growths SET hp_per_level = 15, atk_per_level = 10, def_per_level = 5.63, mag_per_level = 1.3, magic_def_per_level = 3.89, spd_per_level = 5, mana_per_level = 15 WHERE class_id = 25;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12.24, def_per_level = 9.98, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 38;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 13.06, def_per_level = 9.36, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 39;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 13.06, def_per_level = 9.36, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 40;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12.24, def_per_level = 9.36, mag_per_level = 1.6, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 41;
UPDATE class_growths SET hp_per_level = 40.6, atk_per_level = 15.06, def_per_level = 13.27, mag_per_level = 1.85, magic_def_per_level = 6.39, spd_per_level = 4.61, mana_per_level = 18.45 WHERE class_id = 42;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 13.31, def_per_level = 9, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 43;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 13.31, def_per_level = 9, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 44;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12, def_per_level = 9.98, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 45;
UPDATE class_growths SET hp_per_level = 40.6, atk_per_level = 14.76, def_per_level = 13.27, mag_per_level = 1.85, magic_def_per_level = 6.39, spd_per_level = 4.61, mana_per_level = 18.45 WHERE class_id = 46;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12, def_per_level = 9.98, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 47;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12, def_per_level = 9.98, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 48;
UPDATE class_growths SET hp_per_level = 43.9, atk_per_level = 14.76, def_per_level = 12.28, mag_per_level = 1.85, magic_def_per_level = 6.39, spd_per_level = 4.61, mana_per_level = 18.45 WHERE class_id = 49;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 13.31, def_per_level = 9, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 50;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 13.31, def_per_level = 9, mag_per_level = 1.5, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 51;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.92, def_per_level = 6, mag_per_level = 1.5, magic_def_per_level = 3.5, spd_per_level = 5.6, mana_per_level = 18 WHERE class_id = 62;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 11.65, def_per_level = 6, mag_per_level = 1.5, magic_def_per_level = 3.5, spd_per_level = 5.25, mana_per_level = 18 WHERE class_id = 63;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 11.65, def_per_level = 6, mag_per_level = 1.5, magic_def_per_level = 3.5, spd_per_level = 5.25, mana_per_level = 18 WHERE class_id = 64;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.5, def_per_level = 6, mag_per_level = 1.66, magic_def_per_level = 3.5, spd_per_level = 5.36, mana_per_level = 18 WHERE class_id = 66;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 11.65, def_per_level = 6, mag_per_level = 1.5, magic_def_per_level = 3.5, spd_per_level = 5.25, mana_per_level = 18 WHERE class_id = 67;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.92, def_per_level = 6, mag_per_level = 1.6, magic_def_per_level = 3.5, spd_per_level = 5.25, mana_per_level = 18 WHERE class_id = 68;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 11.65, def_per_level = 6, mag_per_level = 1.5, magic_def_per_level = 3.5, spd_per_level = 5.25, mana_per_level = 18 WHERE class_id = 69;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.5, def_per_level = 6, mag_per_level = 1.66, magic_def_per_level = 3.5, spd_per_level = 5.36, mana_per_level = 18 WHERE class_id = 70;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.92, def_per_level = 6, mag_per_level = 1.6, magic_def_per_level = 3.5, spd_per_level = 5.36, mana_per_level = 18 WHERE class_id = 71;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.92, def_per_level = 6.4, mag_per_level = 1.5, magic_def_per_level = 3.5, spd_per_level = 5.36, mana_per_level = 18 WHERE class_id = 72;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 10.5, def_per_level = 6, mag_per_level = 1.66, magic_def_per_level = 3.5, spd_per_level = 5.36, mana_per_level = 18 WHERE class_id = 73;
UPDATE class_growths SET hp_per_level = 23.99, atk_per_level = 12.92, def_per_level = 7.38, mag_per_level = 2.21, magic_def_per_level = 4.31, spd_per_level = 6.59, mana_per_level = 22.14 WHERE class_id = 74;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 13.31, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6, mana_per_level = 18 WHERE class_id = 75;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 13.31, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6, mana_per_level = 18 WHERE class_id = 76;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.66, mana_per_level = 18 WHERE class_id = 77;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12.8, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.45, mana_per_level = 18 WHERE class_id = 79;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.66, mana_per_level = 18 WHERE class_id = 80;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.66, mana_per_level = 18 WHERE class_id = 81;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 13.31, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6, mana_per_level = 18 WHERE class_id = 82;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.56, magic_def_per_level = 4.67, spd_per_level = 6.4, mana_per_level = 18 WHERE class_id = 83;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.66, mana_per_level = 18 WHERE class_id = 84;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.56, magic_def_per_level = 4.67, spd_per_level = 6.4, mana_per_level = 18 WHERE class_id = 85;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12.4, def_per_level = 6.75, mag_per_level = 1.6, magic_def_per_level = 4.67, spd_per_level = 6.24, mana_per_level = 18 WHERE class_id = 86;
UPDATE class_growths SET hp_per_level = 18, atk_per_level = 12, def_per_level = 6.75, mag_per_level = 1.5, magic_def_per_level = 4.67, spd_per_level = 6.66, mana_per_level = 18 WHERE class_id = 87;
UPDATE class_growths SET hp_per_level = 14, atk_per_level = 1.5, def_per_level = 4.5, mag_per_level = 7, magic_def_per_level = 6.7, spd_per_level = 2.5, mana_per_level = 25 WHERE class_id = 5;
UPDATE class_growths SET hp_per_level = 27.5, atk_per_level = 10.2, def_per_level = 7.5, mag_per_level = 1.3, magic_def_per_level = 4.33, spd_per_level = 3.13, mana_per_level = 12.5 WHERE class_id = 10;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 1.44, def_per_level = 5.63, mag_per_level = 10.4, magic_def_per_level = 8.75, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 12;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 1.44, def_per_level = 5.63, mag_per_level = 10.4, magic_def_per_level = 8.75, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 13;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 1.44, def_per_level = 5.63, mag_per_level = 10.4, magic_def_per_level = 8.75, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 14;
UPDATE class_growths SET hp_per_level = 16.25, atk_per_level = 1.44, def_per_level = 5.63, mag_per_level = 10.4, magic_def_per_level = 8.75, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 15;
UPDATE class_growths SET hp_per_level = 17.5, atk_per_level = 1.39, def_per_level = 4.17, mag_per_level = 9.1, magic_def_per_level = 6.25, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 26;
UPDATE class_growths SET hp_per_level = 17.5, atk_per_level = 1.39, def_per_level = 4.17, mag_per_level = 9.1, magic_def_per_level = 6.25, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 27;
UPDATE class_growths SET hp_per_level = 17.5, atk_per_level = 1.39, def_per_level = 4.25, mag_per_level = 8.75, magic_def_per_level = 6.5, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 28;
UPDATE class_growths SET hp_per_level = 17.5, atk_per_level = 1.39, def_per_level = 4.17, mag_per_level = 9.1, magic_def_per_level = 6.25, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 29;
UPDATE class_growths SET hp_per_level = 17.5, atk_per_level = 1.39, def_per_level = 4.17, mag_per_level = 8.75, magic_def_per_level = 6.5, spd_per_level = 3.13, mana_per_level = 31.25 WHERE class_id = 30;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 31;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 32;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 33;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 34;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 35;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 12.48, magic_def_per_level = 10.5, spd_per_level = 4, mana_per_level = 37.5 WHERE class_id = 36;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 37;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12.65, def_per_level = 9, mag_per_level = 1.66, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 52;
UPDATE class_growths SET hp_per_level = 33, atk_per_level = 12.24, def_per_level = 9, mag_per_level = 1.66, magic_def_per_level = 5.2, spd_per_level = 3.75, mana_per_level = 15 WHERE class_id = 53;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 54;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 55;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 56;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 57;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 58;
UPDATE class_growths SET hp_per_level = 23.99, atk_per_level = 2.13, def_per_level = 8.31, mag_per_level = 17.7, magic_def_per_level = 12.92, spd_per_level = 4.62, mana_per_level = 46.13 WHERE class_id = 59;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 60;
UPDATE class_growths SET hp_per_level = 19.5, atk_per_level = 1.73, def_per_level = 6.75, mag_per_level = 13.31, magic_def_per_level = 10.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 61;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.65, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 88;
UPDATE class_growths SET hp_per_level = 25.83, atk_per_level = 2.05, def_per_level = 6.15, mag_per_level = 15.49, magic_def_per_level = 9.23, spd_per_level = 4.62, mana_per_level = 46.13 WHERE class_id = 89;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.65, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 90;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5.33, mag_per_level = 10.92, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 91;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5.44, mag_per_level = 10.5, magic_def_per_level = 8.06, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 92;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5.44, mag_per_level = 10.5, magic_def_per_level = 7.8, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 93;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 10.85, magic_def_per_level = 8.32, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 94;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.65, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 95;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.2, magic_def_per_level = 7.8, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 96;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.65, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 97;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.65, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 98;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.2, magic_def_per_level = 7.8, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 99;
UPDATE class_growths SET hp_per_level = 25.83, atk_per_level = 2.05, def_per_level = 6.69, mag_per_level = 13.97, magic_def_per_level = 9.59, spd_per_level = 4.62, mana_per_level = 46.13 WHERE class_id = 100;
UPDATE class_growths SET hp_per_level = 21, atk_per_level = 1.67, def_per_level = 5, mag_per_level = 11.65, magic_def_per_level = 7.5, spd_per_level = 3.75, mana_per_level = 37.5 WHERE class_id = 101;
-- habilidades de las clases base: menos número fijo, más escala con la stat principal
UPDATE skills SET base_value = 40, scaling_multiplier = 1.6 WHERE code = 'MAGO_ESCARCHA';
UPDATE skills SET base_value = 50, scaling_multiplier = 1.7 WHERE code = 'MAGO_RAYO';
UPDATE skills SET base_value = 40, scaling_multiplier = 1.37 WHERE code = 'MAGO_TORMENTA_ELEMENTAL';
UPDATE skills SET base_value = 63, scaling_multiplier = 2.13 WHERE code = 'MAGO_EXPLOSION_MAGICA';
UPDATE skills SET base_value = 20, scaling_multiplier = 1.1 WHERE code = 'ARQUERO_FLECHA_BASICA';
UPDATE skills SET base_value = 40, scaling_multiplier = 1.6 WHERE code = 'ARQUERO_DISPARO_PRECISO';
UPDATE skills SET base_value = 35, scaling_multiplier = 1.19 WHERE code = 'ARQUERO_LLUVIA_DE_FLECHAS';
UPDATE skills SET base_value = 40, scaling_multiplier = 1.6 WHERE code = 'ARQUERO_FLECHA_EXPLOSIVA';
UPDATE skills SET base_value = 57, scaling_multiplier = 1.95 WHERE code = 'ARQUERO_DISPARO_CERTERO';
UPDATE skills SET base_value = 20, scaling_multiplier = 1.1 WHERE code = 'GUERRERO_GOLPE_BASICO';
UPDATE skills SET base_value = 40, scaling_multiplier = 1.6 WHERE code = 'GUERRERO_TAJO';
UPDATE skills SET base_value = 50, scaling_multiplier = 1.7 WHERE code = 'GUERRERO_GOLPE_MORTAL';
UPDATE skills SET base_value = 20, scaling_multiplier = 1.1 WHERE code = 'MAGO_BOLA_DE_FUEGO';
UPDATE skills SET base_value = 44, scaling_multiplier = 1.49 WHERE code = 'ARQUERO_TORMENTA_DE_FLECHAS';
UPDATE skills SET base_value = 20, scaling_multiplier = 1.1 WHERE code = 'PICARO_PUNALADA_RAPIDA';
UPDATE skills SET base_value = 40, scaling_multiplier = 1.6 WHERE code = 'PICARO_GOLPE_LETAL';
UPDATE skills SET base_value = 57, scaling_multiplier = 1.95 WHERE code = 'PICARO_ATAQUE_SILENCIOSO';
UPDATE skills SET base_value = 57, scaling_multiplier = 1.95 WHERE code = 'PICARO_ASESINATO';
UPDATE skills SET base_value = 57, scaling_multiplier = 1.95 WHERE code = 'GUERRERO_GOLPE_DEVASTADOR';
UPDATE skills SET base_value = 20, scaling_multiplier = 0.69 WHERE code = 'PICARO_DANZA_DE_CUCHILLOS';
UPDATE skills SET base_value = 20, scaling_multiplier = 1.1 WHERE code = 'SACERDOTE_CURACION';
UPDATE skills SET base_value = 35, scaling_multiplier = 1.19 WHERE code = 'SACERDOTE_CURACION_DE_GRUPO';
UPDATE skills SET base_value = 68, scaling_multiplier = 2.3 WHERE code = 'GUERRERO_CORTE_DIVINO';
UPDATE skills SET base_value = 47, scaling_multiplier = 1.61 WHERE code = 'MAGO_TORMENTA_COSMICA';
UPDATE skills SET base_value = 10, scaling_multiplier = 0.35 WHERE code = 'ARQUERO_LLUVIA_INFINITA';
UPDATE skills SET base_value = 18, scaling_multiplier = 0.6 WHERE code = 'PICARO_DANZA_MORTAL';
UPDATE skills SET base_value = 47, scaling_multiplier = 1.61 WHERE code = 'SACERDOTE_MILAGRO_DIVINO';
UPDATE skills SET base_value = 40, scaling_multiplier = 1.6 WHERE code = 'SACERDOTE_ATAQUE';
UPDATE skills SET base_value = 20, scaling_multiplier = 1.1 WHERE code = 'SACERDOTE_LUZ';
-- equipo de nivel 1-15 de las clases base: stats por fórmula según su nivel y rareza
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'ESPADA_DE_HIERRO' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'ESPADA_DE_HIERRO' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 29 FROM items i WHERE i.id = b.item_id AND i.code = 'GRAN_ESPADA_DE_HIERRO' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 29 -> 29
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'GRAN_ESPADA_DE_HIERRO' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 3.8 FROM items i WHERE i.id = b.item_id AND i.code = 'GRAN_ESPADA_DE_HIERRO' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 3.8 -> 3.8
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'BACULO_DE_APRENDIZ' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'BACULO_DE_APRENDIZ' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'ORBE_DE_FUEGO' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'ORBE_DE_FUEGO' AND b.stat_code = 'ELEMENTAL_ATK' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_MADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_MADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_MADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 17 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_PRECISION' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 18 -> 17
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_PRECISION' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 3.8 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_PRECISION' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 3.8 -> 3.8
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARCO_DE_PRECISION' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_HIERRO' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_HIERRO' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_HIERRO' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_HIERRO' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_PRECISION' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 17 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_PRECISION' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 17 -> 17
UPDATE item_stat_bonuses b SET amount = 3.8 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_PRECISION' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 3.8 -> 3.8
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'DAGA_DE_PRECISION' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'BACULO_DE_CURACION' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 9 -> 8
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'BACULO_DE_CURACION' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 23 FROM items i WHERE i.id = b.item_id AND i.code = 'BACULO_SAGRADO' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 22 -> 23
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'BACULO_SAGRADO' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 39 FROM items i WHERE i.id = b.item_id AND i.code = 'ESPADA_ACERO_TEMPLADO' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 39 -> 39
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'ESPADA_ACERO_TEMPLADO' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 11 FROM items i WHERE i.id = b.item_id AND i.code = 'PETO_CUERO_REFORZADO' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 11 -> 11
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'PETO_CUERO_REFORZADO' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 14 FROM items i WHERE i.id = b.item_id AND i.code = 'ANILLO_FUERZA_MENOR' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 14 -> 14
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_OFFHAND_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_OFFHAND_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PRADERA' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ACCESSORY_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ACCESSORY_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_OFFHAND_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_OFFHAND_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 14 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 13 -> 14
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_GLOVES_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_GLOVES_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_PRADERA' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ACCESSORY_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ACCESSORY_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_WEAPON_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_WEAPON_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_OFFHAND_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_OFFHAND_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 14 -> 15
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_GLOVES_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_GLOVES_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_PRADERA' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ACCESSORY_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ACCESSORY_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_WEAPON_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_WEAPON_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 14 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 13 -> 14
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_GLOVES_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_GLOVES_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_PRADERA' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ACCESSORY_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ACCESSORY_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_WEAPON_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 2.3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_WEAPON_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 2.3 -> 2.3
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_OFFHAND_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_OFFHAND_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_GLOVES_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_GLOVES_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_PRADERA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_PRADERA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_PRADERA' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_PRADERA' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ACCESSORY_PRADERA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ACCESSORY_PRADERA' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 64 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_MONTANAS' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 64 -> 64
UPDATE item_stat_bonuses b SET amount = -19 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_MONTANAS' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- -19 -> -19
UPDATE item_stat_bonuses b SET amount = -14 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_MONTANAS' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- -14 -> -14
UPDATE item_stat_bonuses b SET amount = 34 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_PRADERA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 34 -> 34
UPDATE item_stat_bonuses b SET amount = -8 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_PRADERA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- -8 -> -8
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_DEL_BRUJO' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_DEL_BRUJO' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_DEL_BRUJO' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_DEL_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_DEL_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_DEL_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 8 -> 7
UPDATE item_stat_bonuses b SET amount = 36 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 36 -> 36
UPDATE item_stat_bonuses b SET amount = 6.8 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 6.8 -> 6.8
UPDATE item_stat_bonuses b SET amount = 55 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 55 -> 55
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_OFFHAND_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 11 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_OFFHAND_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 11 -> 11
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 21 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 21 -> 21
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 2.5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_CAPITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 2.5 -> 2.5
UPDATE item_stat_bonuses b SET amount = 36 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_WEAPON_CAPITAN' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 36 -> 36
UPDATE item_stat_bonuses b SET amount = 6.8 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_WEAPON_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 6.8 -> 6.8
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_ORB_CAPITAN' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_ORB_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 20 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_CRYSTAL_CAPITAN' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 20 -> 20
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_CRYSTAL_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 24 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 24 -> 24
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_GLOVES_CAPITAN' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_GLOVES_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 2.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_CAPITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 2.5 -> 2.5
UPDATE item_stat_bonuses b SET amount = 36 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 36 -> 36
UPDATE item_stat_bonuses b SET amount = 6.8 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 6.8 -> 6.8
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_OFFHAND_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_OFFHAND_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 24 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 24 -> 24
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_GLOVES_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_GLOVES_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 2.5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_CAPITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 2.5 -> 2.5
UPDATE item_stat_bonuses b SET amount = 36 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_WEAPON_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 36 -> 36
UPDATE item_stat_bonuses b SET amount = 6.8 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_WEAPON_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 6.8 -> 6.8
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_OFFHAND_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_OFFHAND_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 25 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 25 -> 25
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_GLOVES_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_GLOVES_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 2.5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_CAPITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 2.5 -> 2.5
UPDATE item_stat_bonuses b SET amount = 36 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_WEAPON_CAPITAN' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 36 -> 36
UPDATE item_stat_bonuses b SET amount = 6.8 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_WEAPON_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 6.8 -> 6.8
UPDATE item_stat_bonuses b SET amount = 11 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_OFFHAND_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 11 -> 11
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_OFFHAND_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_CAPITAN' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 22 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 22 -> 22
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_GLOVES_CAPITAN' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_GLOVES_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_CAPITAN' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 2.5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_CAPITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 2.5 -> 2.5
UPDATE item_stat_bonuses b SET amount = 49 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 49 -> 49
UPDATE item_stat_bonuses b SET amount = 8.3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 8.3 -> 8.3
UPDATE item_stat_bonuses b SET amount = 74 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 74 -> 74
UPDATE item_stat_bonuses b SET amount = 11 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_OFFHAND_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 11 -> 11
UPDATE item_stat_bonuses b SET amount = 14 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_OFFHAND_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 14 -> 14
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 28 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 28 -> 28
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 22 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 22 -> 22
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_TITAN_P' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 49 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_WEAPON_TITAN_P' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 49 -> 49
UPDATE item_stat_bonuses b SET amount = 8.3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_WEAPON_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 8.3 -> 8.3
UPDATE item_stat_bonuses b SET amount = 20 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_ORB_TITAN_P' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 20 -> 20
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_ORB_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 27 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_CRYSTAL_TITAN_P' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 27 -> 27
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_OFFHAND_CRYSTAL_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_HELMET_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 33 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 33 -> 33
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_ARMOR_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 22 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_GLOVES_TITAN_P' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 22 -> 22
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_GLOVES_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'MAGO_BOOTS_TITAN_P' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 49 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 49 -> 49
UPDATE item_stat_bonuses b SET amount = 8.3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 8.3 -> 8.3
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_OFFHAND_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_OFFHAND_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_HELMET_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 31 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 31 -> 31
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_ARMOR_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 22 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_GLOVES_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 22 -> 22
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_GLOVES_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_BOOTS_TITAN_P' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 49 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_WEAPON_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 49 -> 49
UPDATE item_stat_bonuses b SET amount = 8.3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_WEAPON_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 8.3 -> 8.3
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_OFFHAND_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 16 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_OFFHAND_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 16 -> 16
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_HELMET_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 35 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 35 -> 35
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_ARMOR_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 22 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_GLOVES_TITAN_P' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 22 -> 22
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_GLOVES_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'PICARO_BOOTS_TITAN_P' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 49 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_WEAPON_TITAN_P' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 49 -> 49
UPDATE item_stat_bonuses b SET amount = 8.3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_WEAPON_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 8.3 -> 8.3
UPDATE item_stat_bonuses b SET amount = 14 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_OFFHAND_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 14 -> 14
UPDATE item_stat_bonuses b SET amount = 11 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_OFFHAND_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 11 -> 11
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_HELMET_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_TITAN_P' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 30 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 30 -> 30
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_ARMOR_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 22 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_GLOVES_TITAN_P' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 22 -> 22
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_GLOVES_TITAN_P' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 13 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_TITAN_P' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 13 -> 13
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_TITAN_P' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_TITAN_P' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'SACERDOTE_BOOTS_TITAN_P' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 15 FROM items i WHERE i.id = b.item_id AND i.code = 'BRAZALETE_CAPITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 15 -> 15
UPDATE item_stat_bonuses b SET amount = 19 FROM items i WHERE i.id = b.item_id AND i.code = 'BRAZALETE_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 20 -> 19
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_CAPITAN_MAGO' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_CAPITAN_MAGO' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'COLGANTE_CAPITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'COLGANTE_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 2.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MEDALLON_CAPITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 2.5 -> 2.5
UPDATE item_stat_bonuses b SET amount = 4.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MEDALLON_CAPITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 4.5 -> 4.5
UPDATE item_stat_bonuses b SET amount = 58 FROM items i WHERE i.id = b.item_id AND i.code = 'RELICARIO_CAPITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 58 -> 58
UPDATE item_stat_bonuses b SET amount = 20 FROM items i WHERE i.id = b.item_id AND i.code = 'BRAZALETE_TITAN' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 20 -> 20
UPDATE item_stat_bonuses b SET amount = 27 FROM items i WHERE i.id = b.item_id AND i.code = 'BRAZALETE_TITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 27 -> 27
UPDATE item_stat_bonuses b SET amount = 11 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_TITAN_MAGO' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 11 -> 11
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'AMULETO_TITAN_MAGO' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'COLGANTE_TITAN' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'COLGANTE_TITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'MEDALLON_TITAN' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 5.5 FROM items i WHERE i.id = b.item_id AND i.code = 'MEDALLON_TITAN' AND b.stat_code = 'CRIT_CHANCE' AND b.is_percent = TRUE; -- 5.5 -> 5.5
UPDATE item_stat_bonuses b SET amount = 79 FROM items i WHERE i.id = b.item_id AND i.code = 'RELICARIO_TITAN' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 79 -> 79
UPDATE item_stat_bonuses b SET amount = 17 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_HACHA_L1' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 17 -> 17
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_HACHA_L1' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 41 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_HACHA_L10' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 41 -> 41
UPDATE item_stat_bonuses b SET amount = -11 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON2H_HACHA_L10' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- -11 -> -11
UPDATE item_stat_bonuses b SET amount = 17 FROM items i WHERE i.id = b.item_id AND i.code = 'BALLESTA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 17 -> 17
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'BALLESTA' AND b.stat_code = 'CRIT_DAMAGE' AND b.is_percent = TRUE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 41 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON2H_BALLESTA_L10' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 41 -> 41
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'ARQUERO_WEAPON2H_BALLESTA_L10' AND b.stat_code = 'CRIT_DAMAGE' AND b.is_percent = TRUE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'ARMADURA_PESADA_COMPLETA' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 8 FROM items i WHERE i.id = b.item_id AND i.code = 'ARMADURA_PESADA_COMPLETA' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 8 -> 8
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'ARMADURA_PESADA_COMPLETA' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PESADA_L1' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PESADA_L1' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PESADA_L1' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_PESADA_L1' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_PESADA_L1' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L1' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L1' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L1' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 1 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L1' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 1 -> 1
UPDATE item_stat_bonuses b SET amount = 3 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_PESADA_L10' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 3 -> 3
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_PESADA_L10' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 10 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_ARMOR_PESADA_L10' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 10 -> 10
UPDATE item_stat_bonuses b SET amount = 2 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PESADA_L10' AND b.stat_code = 'MAGIC_DEF' AND b.is_percent = FALSE; -- 2 -> 2
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PESADA_L10' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_HELMET_PESADA_L10' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 6 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_PESADA_L10' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 6 -> 6
UPDATE item_stat_bonuses b SET amount = 5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_GLOVES_PESADA_L10' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 5 -> 5
UPDATE item_stat_bonuses b SET amount = 1.5 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L10' AND b.stat_code = 'EVASION' AND b.is_percent = TRUE; -- 1.5 -> 1.5
UPDATE item_stat_bonuses b SET amount = 7 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L10' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 7 -> 7
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L10' AND b.stat_code = 'HP' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 4 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_BOOTS_PESADA_L10' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 4 -> 4
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'ESPADA_MAGICA' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 12 FROM items i WHERE i.id = b.item_id AND i.code = 'ESPADA_MAGICA' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 12 -> 12
UPDATE item_stat_bonuses b SET amount = 27 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_MAGICA_L10' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 27 -> 27
UPDATE item_stat_bonuses b SET amount = 28 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_MAGICA_L10' AND b.stat_code = 'MAG' AND b.is_percent = FALSE; -- 28 -> 28
UPDATE item_stat_bonuses b SET amount = 9 FROM items i WHERE i.id = b.item_id AND i.code = 'GUERRERO_WEAPON_MAGICA_L10' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 9 -> 9
UPDATE item_stat_bonuses b SET amount = 42 FROM items i WHERE i.id = b.item_id AND i.code = 'KADRIC_ESPADA_VETERANO' AND b.stat_code = 'ATK' AND b.is_percent = FALSE; -- 43 -> 42
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'KADRIC_ESPADA_VETERANO' AND b.stat_code = 'DEF' AND b.is_percent = FALSE; -- 18 -> 18
UPDATE item_stat_bonuses b SET amount = 18 FROM items i WHERE i.id = b.item_id AND i.code = 'KADRIC_ESPADA_VETERANO' AND b.stat_code = 'SPD' AND b.is_percent = FALSE; -- 18 -> 18
-- pide recalcular las stats guardadas de jugadores y compañeros (lo hace el servidor)
CREATE TABLE IF NOT EXISTS balance_versions (version TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_at TIMESTAMPTZ);
INSERT INTO balance_versions (version) SELECT 'pradera_v1' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_v1');
INSERT INTO balance_versions (version) SELECT 'pradera_equipo_v1' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_equipo_v1');
INSERT INTO balance_versions (version) SELECT 'pradera_v2' WHERE NOT EXISTS (SELECT 1 FROM balance_versions WHERE version = 'pradera_v2');

-- ============================================================================================
-- Habilidades v2 (clases base, repetible; sin ON CONFLICT)
-- * Las habilidades de nivel 1 y las pasivas se siguen recibiendo gratis. El resto las enseña el
--   maestro de tu clase a cambio de oro desde cierto nivel (learn_method GOLD + learn_level). Los
--   compañeros (NPC) las aprenden solos al llegar a ese nivel.
-- * Efectos secundarios: las habilidades de daño pueden dejar un estado con 35% de probabilidad
--   (skill_effects.chance_percent; status_code agrupa las filas de un mismo estado). Las
--   habilidades de estado (Envenenamiento) siempre aplican.
-- * Estados nuevos: parálisis (25% de perder el turno) y ceguera (20% de fallar los golpes).
-- Los valores de daño los pone el bloque "Equilibrio, fases B y C" (por tramo de nivel).
-- ============================================================================================
ALTER TABLE skill_effects ADD COLUMN IF NOT EXISTS chance_percent NUMERIC(5,2);
ALTER TABLE skill_effects ADD COLUMN IF NOT EXISTS status_code TEXT;
ALTER TABLE combat_participant_buffs ADD COLUMN IF NOT EXISTS status_code TEXT;
DO $$ BEGIN
  ALTER TABLE skill_effects DROP CONSTRAINT IF EXISTS skill_effects_effect_type_check;
  ALTER TABLE skill_effects ADD CONSTRAINT skill_effects_effect_type_check
    CHECK (effect_type IN ('STAT_MOD','DOT','HOT','REVIVE','CLEANSE','NO_DAMAGE_WINDOW','GUARANTEED_CRIT','CONDITIONAL_DAMAGE','SUMMON','PARALYZE','BLIND'));
END $$;

-- Quien ya tenía una habilidad por nivel no la pierde al pasar al maestro (solo corre mientras
-- todavía son LEVEL: la segunda vez ya no hace nada)
INSERT INTO player_skills (player_id, skill_id)
SELECT p.id, s.id FROM players p JOIN skills s ON s.class_id = p.current_class_id
WHERE s.learn_method = 'LEVEL' AND p.level >= s.learn_level
  AND s.code IN ('GUERRERO_TAJO', 'GUERRERO_GRITO_DE_GUERRA', 'GUERRERO_ESCUDO_DEFENSIVO',
    'MAGO_ESCARCHA', 'MAGO_RAYO', 'MAGO_ESCUDO_MAGICO',
    'ARQUERO_DISPARO_PRECISO', 'ARQUERO_LLUVIA_DE_FLECHAS', 'ARQUERO_ENFOQUE',
    'PICARO_GOLPE_LETAL', 'PICARO_ROBAR', 'PICARO_INVISIBILIDAD', 'PICARO_VELOCIDAD_EXTREMA',
    'SACERDOTE_BENDICION', 'SACERDOTE_ATAQUE', 'SACERDOTE_PROTECCION_DIVINA', 'SACERDOTE_CURACION_DE_GRUPO')
  AND NOT EXISTS (SELECT 1 FROM player_skills ps WHERE ps.player_id = p.id AND ps.skill_id = s.id);

-- nombre, cómo se aprende, nivel, precio, elemento, objetivo y descripción
UPDATE skills k SET name = v.name, learn_method = v.method, learn_level = v.lvl, learn_gold_cost = v.cost,
  element_id = COALESCE((SELECT id FROM elements WHERE code = v.elem), k.element_id),
  target_type = COALESCE(v.target, k.target_type), description = v.descr
FROM (VALUES
  ('GUERRERO_GOLPE_BASICO', 'Golpe de Escudo', 'LEVEL', 1, NULL::INT, NULL, NULL, 'Golpeas con el escudo. 35% de probabilidad de debilitar al enemigo: -10% de ataque por 2 turnos.'),
  ('GUERRERO_TAJO', 'Tajo Sangrante', 'GOLD', 5, 400, NULL, NULL, 'Un tajo profundo. 35% de probabilidad de causar sangrado: pierde 5% de su vida máxima por turno durante 3 turnos.'),
  ('GUERRERO_GRITO_DE_GUERRA', 'Grito de Guerra', 'GOLD', 8, 800, NULL, 'ALL_ALLIES', 'Un grito que enardece a todo tu grupo: +20% de ataque por 3 turnos.'),
  ('GUERRERO_GOLPE_MORTAL', 'Quiebra Armaduras', 'GOLD', 10, 1500, NULL, NULL, 'Un golpe pesado que parte armaduras: +40% de daño contra enemigos con mucha defensa (más de 80).'),
  ('GUERRERO_ESCUDO_DEFENSIVO', 'Escudo Defensivo', 'GOLD', 15, 2500, NULL, NULL, 'Te cubres tras el escudo: +30% de defensa por 3 turnos. Se suma con tu pasiva.'),
  ('MAGO_BOLA_DE_FUEGO', 'Bola de Fuego', 'LEVEL', 1, NULL, 'FIRE', NULL, 'Una bola de fuego. 35% de probabilidad de causar quemadura: pierde 4% de su vida por turno y -15% de ataque durante 2 turnos.'),
  ('MAGO_ESCARCHA', 'Lanza de Escarcha', 'GOLD', 5, 400, 'ICE', NULL, 'Una lanza de hielo. 35% de probabilidad de ralentizar al enemigo: -25% de velocidad por 2 turnos.'),
  ('MAGO_AMPLIFICACION', 'Concentración Arcana', 'GOLD', 8, 800, NULL, 'SELF', 'Concentras tu poder: +25% de magia por 3 turnos.'),
  ('MAGO_RAYO', 'Rayo', 'GOLD', 10, 1500, 'LIGHTNING', NULL, 'Un rayo fulminante. 35% de probabilidad de paralizar: durante 3 turnos puede perder su turno (25%).'),
  ('MAGO_ESCUDO_MAGICO', 'Escudo Mágico', 'GOLD', 15, 2500, NULL, NULL, 'Una barrera arcana: +20% de defensa mágica por 3 turnos.'),
  ('ARQUERO_FLECHA_BASICA', 'Flecha Rápida', 'LEVEL', 1, NULL, 'WIND', NULL, 'Una flecha veloz de viento.'),
  ('ARQUERO_DISPARO_PRECISO', 'Flecha Perforante', 'GOLD', 5, 400, NULL, NULL, 'Una flecha que atraviesa armaduras: +30% de daño contra enemigos con mucha defensa (más de 60).'),
  ('ARQUERO_FLECHA_EXPLOSIVA', 'Flecha Explosiva', 'GOLD', 8, 800, 'FIRE', NULL, 'Una flecha que estalla en llamas. 35% de probabilidad de causar quemadura: pierde 4% de su vida por turno y -15% de ataque durante 2 turnos.'),
  ('ARQUERO_LLUVIA_DE_FLECHAS', 'Lluvia de Flechas', 'GOLD', 10, 1500, 'WIND', NULL, 'Una lluvia de flechas de viento sobre todos los enemigos.'),
  ('ARQUERO_ENFOQUE', 'Enfoque', 'GOLD', 15, 2500, NULL, NULL, 'Afinas la puntería: +30% de probabilidad de crítico por 3 turnos.'),
  ('PICARO_PUNALADA_RAPIDA', 'Puñalada Rápida', 'LEVEL', 1, NULL, NULL, NULL, 'Una puñalada veloz. 35% de probabilidad de causar sangrado: pierde 3% de su vida máxima por turno durante 2 turnos.'),
  ('PICARO_ENVENENAMIENTO', 'Envenenamiento', 'GOLD', 3, 300, NULL, NULL, 'Envenena al enemigo: pierde 6% de su vida máxima por turno durante 3 turnos.'),
  ('PICARO_GOLPE_LETAL', 'Golpe Letal', 'GOLD', 5, 400, NULL, NULL, 'Un golpe a un punto vital: siempre es crítico.'),
  ('PICARO_ROBAR', 'Robar', 'GOLD', 8, 800, NULL, NULL, 'Intenta robarle un objeto al enemigo. No hace daño.'),
  ('PICARO_INVISIBILIDAD', 'Invisibilidad', 'GOLD', 10, 1500, NULL, NULL, 'Te desvaneces: no recibes daño durante 1 turno y tu ataque sube 50% los 2 turnos siguientes.'),
  ('PICARO_VELOCIDAD_EXTREMA', 'Velocidad Extrema', 'GOLD', 15, 2500, NULL, NULL, 'Te mueves como una sombra: +40% de velocidad por 3 turnos.'),
  ('SACERDOTE_BENDICION', 'Bendición de Batalla', 'GOLD', 5, 400, NULL, NULL, 'Bendices a un aliado: +15% de ataque y de magia por 3 turnos.'),
  ('SACERDOTE_ATAQUE', 'Rayo Sagrado', 'GOLD', 8, 800, 'LIGHT', NULL, 'Un rayo de luz sagrada. 35% de probabilidad de cegar: durante 2 turnos falla el 20% de sus golpes.'),
  ('SACERDOTE_PROTECCION_DIVINA', 'Protección Divina', 'GOLD', 10, 1500, NULL, NULL, 'Proteges a un aliado: +25% de defensa por 3 turnos.'),
  ('SACERDOTE_PURIFICACION', 'Purificación', 'GOLD', 12, 2000, NULL, NULL, 'Quita todos los efectos negativos de un aliado.'),
  ('SACERDOTE_CURACION_DE_GRUPO', 'Curación de Grupo', 'GOLD', 15, 2500, NULL, NULL, 'Cura a todo tu grupo.'),
  ('SACERDOTE_PASIVA_BENDICION', 'Gracia Divina', 'LEVEL', 1, NULL, NULL, NULL, 'Regeneras 5% de tu vida por turno.')
) AS v(code, name, method, lvl, cost, elem, target, descr)
WHERE k.code = v.code;

-- efectos: se reescriben enteros para las habilidades que cambian
DELETE FROM skill_effects WHERE skill_id IN (SELECT id FROM skills WHERE code IN (
  'GUERRERO_GOLPE_BASICO', 'GUERRERO_TAJO', 'GUERRERO_GOLPE_MORTAL', 'MAGO_BOLA_DE_FUEGO', 'MAGO_ESCARCHA', 'MAGO_RAYO',
  'ARQUERO_DISPARO_PRECISO', 'ARQUERO_FLECHA_EXPLOSIVA', 'PICARO_PUNALADA_RAPIDA', 'PICARO_ENVENENAMIENTO', 'PICARO_GOLPE_LETAL',
  'SACERDOTE_BENDICION', 'SACERDOTE_ATAQUE'));
INSERT INTO skill_effects (skill_id, effect_type, stat_code, percent_amount, duration_turns, condition_stat, condition_comparison, condition_value, chance_percent, status_code, description)
SELECT (SELECT id FROM skills WHERE code = v.code), v.etype, v.stat, v.pct, v.dur, v.cstat, v.ccmp, v.cval, v.chance, v.status, v.descr
FROM (VALUES
  ('GUERRERO_GOLPE_BASICO', 'STAT_MOD', 'ATK', -10.0, 2, NULL, NULL, NULL::NUMERIC, 35.0, 'WEAKEN', '35%: -10% de ataque al enemigo por 2 turnos.'),
  ('GUERRERO_TAJO', 'DOT', NULL, 5.0, 3, NULL, NULL, NULL, 35.0, 'BLEED', '35%: sangrado, 5% de vida por turno durante 3 turnos.'),
  ('GUERRERO_GOLPE_MORTAL', 'CONDITIONAL_DAMAGE', NULL, 40.0, NULL, 'DEF', '>', 80, NULL, NULL, '+40% de daño si la defensa del enemigo es mayor a 80.'),
  ('MAGO_BOLA_DE_FUEGO', 'DOT', NULL, 4.0, 2, NULL, NULL, NULL, 35.0, 'BURN', '35%: quemadura, 4% de vida por turno durante 2 turnos.'),
  ('MAGO_BOLA_DE_FUEGO', 'STAT_MOD', 'ATK', -15.0, 2, NULL, NULL, NULL, 35.0, 'BURN', 'La quemadura baja 15% el ataque.'),
  ('MAGO_ESCARCHA', 'STAT_MOD', 'SPD', -25.0, 2, NULL, NULL, NULL, 35.0, 'SLOW', '35%: -25% de velocidad por 2 turnos.'),
  ('MAGO_RAYO', 'PARALYZE', NULL, NULL, 3, NULL, NULL, NULL, 35.0, 'PARALYZE', '35%: parálisis por 3 turnos (25% de perder el turno).'),
  ('ARQUERO_DISPARO_PRECISO', 'CONDITIONAL_DAMAGE', NULL, 30.0, NULL, 'DEF', '>', 60, NULL, NULL, '+30% de daño si la defensa del enemigo es mayor a 60.'),
  ('ARQUERO_FLECHA_EXPLOSIVA', 'DOT', NULL, 4.0, 2, NULL, NULL, NULL, 35.0, 'BURN', '35%: quemadura, 4% de vida por turno durante 2 turnos.'),
  ('ARQUERO_FLECHA_EXPLOSIVA', 'STAT_MOD', 'ATK', -15.0, 2, NULL, NULL, NULL, 35.0, 'BURN', 'La quemadura baja 15% el ataque.'),
  ('PICARO_PUNALADA_RAPIDA', 'DOT', NULL, 3.0, 2, NULL, NULL, NULL, 35.0, 'BLEED', '35%: sangrado, 3% de vida por turno durante 2 turnos.'),
  ('PICARO_ENVENENAMIENTO', 'DOT', NULL, 6.0, 3, NULL, NULL, NULL, NULL, 'POISON', 'Veneno: 6% de vida por turno durante 3 turnos.'),
  ('PICARO_GOLPE_LETAL', 'GUARANTEED_CRIT', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Siempre es crítico.'),
  ('SACERDOTE_BENDICION', 'STAT_MOD', 'ATK', 15.0, 3, NULL, NULL, NULL, NULL, NULL, '+15% de ataque a un aliado por 3 turnos.'),
  ('SACERDOTE_BENDICION', 'STAT_MOD', 'MAG', 15.0, 3, NULL, NULL, NULL, NULL, NULL, '+15% de magia a un aliado por 3 turnos.'),
  ('SACERDOTE_ATAQUE', 'BLIND', NULL, 20.0, 2, NULL, NULL, NULL, 35.0, 'BLIND', '35%: ceguera por 2 turnos (falla el 20% de sus golpes).')
) AS v(code, etype, stat, pct, dur, cstat, ccmp, cval, chance, status, descr)
WHERE (SELECT id FROM skills WHERE code = v.code) IS NOT NULL;

-- ============================================================================================
-- Tiempos de espera y Provocar (repetible; sin ON CONFLICT)
-- * skills.cooldown_rounds = cada cuántas rondas se puede usar la habilidad (2 = una ronda sí y
--   otra no). Se lleva por combatiente en combat_skill_cooldowns. Las de nivel 1 no tienen.
-- * Escudo Defensivo del Guerrero además provoca: durante 2 turnos los enemigos lo atacan a él.
-- ============================================================================================
CREATE TABLE IF NOT EXISTS combat_skill_cooldowns (
  session_id     INT NOT NULL REFERENCES combat_sessions(id) ON DELETE CASCADE,
  participant_id INT NOT NULL REFERENCES combat_participants(id) ON DELETE CASCADE,
  skill_id       INT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  ready_round    INT NOT NULL,
  PRIMARY KEY (participant_id, skill_id)
);
CREATE INDEX IF NOT EXISTS idx_combat_skill_cooldowns_session ON combat_skill_cooldowns(session_id);
DO $$ BEGIN
  ALTER TABLE skill_effects DROP CONSTRAINT IF EXISTS skill_effects_effect_type_check;
  ALTER TABLE skill_effects ADD CONSTRAINT skill_effects_effect_type_check
    CHECK (effect_type IN ('STAT_MOD','DOT','HOT','REVIVE','CLEANSE','NO_DAMAGE_WINDOW','GUARANTEED_CRIT','CONDITIONAL_DAMAGE','SUMMON','PARALYZE','BLIND','TAUNT'));
END $$;

UPDATE skills k SET cooldown_rounds = v.cd FROM (VALUES
  ('GUERRERO_TAJO', 2), ('GUERRERO_GRITO_DE_GUERRA', 3), ('GUERRERO_GOLPE_MORTAL', 3), ('GUERRERO_ESCUDO_DEFENSIVO', 4),
  ('MAGO_ESCARCHA', 2), ('MAGO_AMPLIFICACION', 3), ('MAGO_RAYO', 3), ('MAGO_ESCUDO_MAGICO', 3),
  ('ARQUERO_DISPARO_PRECISO', 2), ('ARQUERO_FLECHA_EXPLOSIVA', 2), ('ARQUERO_LLUVIA_DE_FLECHAS', 3), ('ARQUERO_ENFOQUE', 3),
  ('PICARO_ENVENENAMIENTO', 3), ('PICARO_GOLPE_LETAL', 2), ('PICARO_ROBAR', 3), ('PICARO_INVISIBILIDAD', 4), ('PICARO_VELOCIDAD_EXTREMA', 3),
  ('SACERDOTE_BENDICION', 3), ('SACERDOTE_ATAQUE', 2), ('SACERDOTE_PROTECCION_DIVINA', 3), ('SACERDOTE_PURIFICACION', 2), ('SACERDOTE_CURACION_DE_GRUPO', 3)
) AS v(code, cd) WHERE k.code = v.code;

-- Provocar
DELETE FROM skill_effects WHERE effect_type = 'TAUNT' AND skill_id = (SELECT id FROM skills WHERE code = 'GUERRERO_ESCUDO_DEFENSIVO');
INSERT INTO skill_effects (skill_id, effect_type, duration_turns, status_code, description)
SELECT id, 'TAUNT', 2, 'TAUNT', 'Provocas: durante 2 turnos los enemigos te atacan a ti.' FROM skills WHERE code = 'GUERRERO_ESCUDO_DEFENSIVO';
UPDATE skills SET description = 'Te cubres tras el escudo y provocas: +30% de defensa por 3 turnos y durante 2 turnos los enemigos te atacan a ti.'
WHERE code = 'GUERRERO_ESCUDO_DEFENSIVO';
