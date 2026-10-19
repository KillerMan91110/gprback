// Molde de mazmorra del mundo 2D (la Cripta del Vigía y la Mina Profunda salen de aquí). Cada mazmorra
// es una zona propia (gpr/public/assets/mundo/<dir>, generada por art/mapas/generar_<dir>.js) y se
// describe con un objeto de configuración (ver lib/cripta.js y lib/mina.js):
//
//   - Guardianes visibles que patrullan (como en Etrian Odyssey): si te ven, te persiguen. Cada
//     uno es un combate con escolta. Vencidos, no vuelven hasta que termine tu recorrido.
//   - Braseros (o faroles) de control (como en Dofus): al encender uno, si caes o sales retomas desde ahí.
//   - La puerta del jefe se abre al vencer a todos los guardianes.
//   - El jefe tiene dos mecánicas propias (ganchos en routes/combat.js):
//       · escudo cuya debilidad cambia cada vez que se recupera de una rotura (Octopath);
//       · un golpe anunciado: marca a un héroe y al turno siguiente le pega muy fuerte, salvo que ese
//         héroe se haya puesto a Defender (una "trampa" anunciada, como en Wizard101).
//   - Al vencerlo se abre su cofre (una vez cada N horas por jugador) y la mazmorra queda
//     completada: no vuelve a salir nadie mientras sigas adentro. Al salir y volver a entrar se
//     recorre de nuevo. Un recorrido sin tocar en 24 h también se reinicia.
// Se puede entrar con los compañeros NPC (van en la formación) y en grupo con otros jugadores
// (los que estén a tu lado entran al combate, como en la hierba alta).
//
// combat_sessions.crypt_target guarda a quién se enfrenta: en la Cripta el nombre del guardián
// ('centinela_norte', 'jefe'); en las demás, con su prefijo ('mina:capataz', 'mina:jefe').
const db = require('../db/db');
const inventory = require('./inventory');
const { cercaDe, positionOf } = require('./cercania');
const { getClassAncestorChain } = require('./evolution');

const ELEMENT_NAME = { 1: 'el Fuego', 2: 'el Hielo', 3: 'el Rayo', 4: 'el Viento', 5: 'la Tierra', 6: 'el Agua', 7: 'la Luz', 8: 'la Oscuridad' };
const ELEMENT_CODE = { 1: 'FIRE', 2: 'ICE', 3: 'LIGHTNING', 4: 'WIND', 5: 'EARTH', 6: 'WATER', 7: 'LIGHT', 8: 'DARK' };
const GUARD_MARGIN = 6; // margen (casillas) para aceptar que estás junto a un guardián
const SET_SLOTS = ['WEAPON', 'OFFHAND', 'HELMET', 'ARMOR', 'GLOVES', 'BOOTS'];

function crearMazmorra(def) {
  const ZONE_DIR = def.zoneDir;
  const MIN_LEVEL = def.minLevel;
  const BOSS_CODE = def.boss.code;
  const CHEST_HOURS = def.chestHours ?? 3;
  const RUN_RESET_HOURS = 24;
  // después de vencer al jefe, las pasadas de las próximas 20 h dan la mitad de XP y oro (por jugador)
  const FULL_REWARD_HOURS = def.fullRewardHours ?? 20;
  const REPEAT_REWARD_MULT = def.repeatRewardMult ?? 0.5;
  const TABLE = def.table;
  const prefix = def.targetPrefix ? `${def.targetPrefix}:` : '';
  const CODES = def.monsters.map((m) => m.code);
  const isMonster = (code) => CODES.includes(code);
  const encode = (target) => `${prefix}${target}`;
  // a quién se enfrentó en este combate (null si el combate no es de esta mazmorra)
  const decode = (stored) => {
    if (!stored) return null;
    if (!prefix) return stored.includes(':') ? null : stored;
    return stored.startsWith(prefix) ? stored.slice(prefix.length) : null;
  };

  let ready = null;
  function ensureTables() {
    ready ??= (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
          player_id    INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
          braziers     SMALLINT NOT NULL DEFAULT 0,
          guardians    TEXT[] NOT NULL DEFAULT '{}',
          clears       INTEGER NOT NULL DEFAULT 0,
          chest_at     TIMESTAMPTZ,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        ALTER TABLE combat_sessions ADD COLUMN IF NOT EXISTS crypt_target TEXT;
        ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS cleared BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE ${TABLE} ADD COLUMN IF NOT EXISTS full_reward_at TIMESTAMPTZ;`);
      for (const m of def.monsters) {
        // sin zona: así nunca salen en un encuentro normal
        const top = m.scalings[m.scalings.length - 1];
        const r = await db.query(
          `INSERT INTO monsters (code, name, zone_id, rarity, base_level, min_spawn_level, max_spawn_level, base_hp, base_atk, base_def,
             base_magic_atk, base_magic_def, base_spd, base_evasion, base_crit_chance, base_crit_damage, xp_reward, gold_reward, description, category)
           VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
           RETURNING id`,
          [m.code, m.name, m.rarity, m.base, def.levels.min, def.levels.max, top.hp, top.atk, top.def, top.magic_atk, top.magic_def,
            top.spd, top.evasion, top.crit_chance, top.crit_damage, m.xp, m.gold, m.description, m.category]
        );
        const id = r.rows[0].id;
        const has = await db.query('SELECT 1 FROM monster_level_scalings WHERE monster_id = $1 LIMIT 1', [id]);
        if (!has.rows.length) {
          for (const s of m.scalings) {
            await db.query(
              `INSERT INTO monster_level_scalings (monster_id, level, hp, atk, def, magic_atk, magic_def, spd, evasion, crit_chance, crit_damage, elemental_damage)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
              [id, s.level, s.hp, s.atk, s.def, s.magic_atk, s.magic_def, s.spd, s.evasion, s.crit_chance, s.crit_damage, s.elemental_damage]
            );
          }
        }
        // habilidades propias ([código, % de uso]); las que ya tenga no se tocan
        for (const [skill, pct] of m.skills ?? []) {
          await db.query(
            `INSERT INTO monster_skills (monster_id, skill_id, use_chance_percent)
             SELECT $1, s.id, $3 FROM skills s WHERE s.code = $2
               AND NOT EXISTS (SELECT 1 FROM monster_skills ms WHERE ms.monster_id = $1 AND ms.skill_id = s.id)`,
            [id, skill, pct]
          );
        }
        for (const [el, pct] of Object.entries(m.resist)) {
          await db.query(
            `INSERT INTO monster_element_resistances (monster_id, element_id, resistance_percent) VALUES ($1, $2, $3)
             ON CONFLICT (monster_id, element_id) DO NOTHING`,
            [id, Number(el), pct]
          );
        }
      }
      // objetos propios de la mazmorra (su llave, materiales del jefe): antes que el botín, que los usa
      for (const it of def.items ?? []) {
        await db.query(
          `INSERT INTO items (code, name, item_type, rarity, is_quest_item, description)
           SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS (SELECT 1 FROM items WHERE code = $1)`,
          [it.code, it.name, it.type ?? 'MATERIAL', it.rarity ?? 'RARO', !!it.quest, it.description]
        );
      }
      // los pasos de misión que apuntan a un monstruo de la mazmorra (target_code) se cargan antes de
      // que el monstruo exista (se crea arriba, la primera vez): aquí quedan enlazados
      await db.query(
        `UPDATE quest_objectives qo SET monster_id = m.id FROM monsters m
         WHERE qo.monster_id IS NULL AND qo.target_code = m.code AND m.code = ANY($1::text[])`,
        [def.monsters.map((m) => m.code)]
      );
      for (const [code, item, chance, min, max] of def.drops) {
        await db.query(
          `INSERT INTO monster_drops (monster_id, item_id, drop_chance_percent, min_quantity, max_quantity)
           SELECT m.id, i.id, $3, $4, $5 FROM monsters m, items i
           WHERE m.code = $1 AND i.code = $2
             AND NOT EXISTS (SELECT 1 FROM monster_drops d WHERE d.monster_id = m.id AND d.item_id = i.id)`,
          [code, item, chance, min, max]
        );
      }
    })().catch((err) => { ready = null; throw err; });
    return ready;
  }

  // ---------------------------------------------------------------- recorrido del jugador
  async function getRun(playerId, client = db) {
    await ensureTables();
    await client.query(`INSERT INTO ${TABLE} (player_id) VALUES ($1) ON CONFLICT DO NOTHING`, [playerId]);
    // recorrido abandonado: se empieza de nuevo
    await client.query(
      `UPDATE ${TABLE} SET braziers = 0, guardians = '{}', cleared = FALSE, updated_at = now()
       WHERE player_id = $1 AND updated_at < now() - make_interval(hours => $2) AND (braziers > 0 OR cardinality(guardians) > 0 OR cleared)`,
      [playerId, RUN_RESET_HOURS]
    );
    // completada: queda así mientras sigas adentro; si ya saliste, la próxima vez empieza de cero
    const pos = positionOf(Number(playerId));
    if (pos && pos.zone !== ZONE_DIR) await resetIfCleared(playerId, client);
    return (await client.query(`SELECT * FROM ${TABLE} WHERE player_id = $1`, [playerId])).rows[0];
  }

  // al salir (o al volver a entrar desde afuera) un recorrido completado se reinicia
  async function resetIfCleared(playerId, client = db) {
    await ensureTables();
    await client.query(
      `UPDATE ${TABLE} SET braziers = 0, guardians = '{}', cleared = FALSE, updated_at = now()
       WHERE player_id = $1 AND cleared`,
      [playerId]
    );
  }

  function publicRun(run) {
    const chestReadyAt = run.chest_at ? new Date(new Date(run.chest_at).getTime() + CHEST_HOURS * 3600000) : null;
    const down = run.guardians ?? [];
    const brazier = def.braseros[run.braziers];
    return {
      braziers: run.braziers,
      guardians: down,
      totalGuardians: Object.keys(def.guardianes).length,
      doorOpen: run.cleared || Object.keys(def.guardianes).every((g) => down.includes(g)),
      // ya venciste al jefe en este recorrido: no queda nadie (sal y vuelve a entrar para repetirla)
      cleared: !!run.cleared,
      clears: run.clears,
      chestReadyAt: chestReadyAt && chestReadyAt > new Date() ? chestReadyAt : null,
      // dónde retomas (casilla local): el último brasero encendido o la entrada
      respawn: brazier ? { x: brazier.x, y: brazier.y + 1, name: brazier.name } : null,
      minLevel: MIN_LEVEL,
      // textos para el HUD y el combate (el front es el mismo para todas las mazmorras)
      dir: ZONE_DIR, ...def.texts,
    };
  }

  // la puerta de la mazmorra se abre con la historia: su misión ya completada, su llave en la mochila
  // o la misión que te da la llave ya completada (la llave es objeto de misión: se va al entregar esa
  // misión, antes de que hayas podido bajar)
  async function hasAccess(playerId) {
    const r = await db.query(
      `SELECT EXISTS (SELECT 1 FROM player_quest_completions pqc JOIN quests q ON q.id = pqc.quest_id
                      WHERE pqc.player_id = $1 AND q.code = $2)
           OR EXISTS (SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
                      WHERE pi.player_id = $1 AND i.code = $3 AND pi.quantity > 0)
           OR EXISTS (SELECT 1 FROM player_quest_completions pqc JOIN quest_objectives o ON o.quest_id = pqc.quest_id
                      WHERE pqc.player_id = $1 AND o.params->'gives'->>'item' = $3) AS ok`,
      [playerId, def.access.quest, def.access.key]
    ).catch(() => ({ rows: [{ ok: true }] }));
    return !!r.rows[0]?.ok;
  }
  const SEALED = def.access.sealedText;

  async function state(playerId) {
    return { ...publicRun(await getRun(playerId)), sealed: !(await hasAccess(playerId)), sealedText: SEALED };
  }

  async function lightBrazier(playerId, orden) {
    if (!(await hasAccess(playerId))) return { error: SEALED };
    const b = def.braseros[orden];
    if (!b) return { error: `Aquí no hay ningún ${def.texts.brazierWord.toLowerCase()}` };
    if (!cercaDe(playerId, ZONE_DIR, b.x, b.y, 4)) return { error: `Acércate al ${def.texts.brazierWord.toLowerCase()} para encenderlo` };
    await getRun(playerId);
    const r = await db.query(
      `UPDATE ${TABLE} SET braziers = GREATEST(braziers, $2), updated_at = now() WHERE player_id = $1 RETURNING *`,
      [playerId, orden]
    );
    // el grupo comparte el recorrido: también queda encendido para los compañeros que estén adentro
    const mates = (await db.query(
      `SELECT m2.player_id FROM player_coop_group_members m1
       JOIN player_coop_group_members m2 ON m2.group_id = m1.group_id AND m2.player_id <> m1.player_id
       WHERE m1.player_id = $1`,
      [playerId]
    ).catch(() => ({ rows: [] }))).rows.map((x) => x.player_id);
    for (const mate of mates) {
      if (!cercaDe(mate, ZONE_DIR)) continue;
      await getRun(mate);
      await db.query(`UPDATE ${TABLE} SET braziers = GREATEST(braziers, $2), updated_at = now() WHERE player_id = $1`, [mate, orden]);
    }
    return { ...publicRun(r.rows[0]), lit: b.name };
  }

  // ---------------------------------------------------------------- combates
  const fightLevel = (heroLevel, boss) => Math.max(def.levels.min + (boss ? 1 : 0), Math.min(def.levels.max + (boss ? 1 : 0), heroLevel + (boss ? 1 : 0)));

  // ¿puede pelear contra este guardián / el jefe? Devuelve { error } o { specs, target }
  async function prepareFight(playerId, target, heroLevel) {
    await ensureTables();
    if (heroLevel < MIN_LEVEL) return { error: `${def.texts.name} es peligrosa: necesitas nivel ${MIN_LEVEL}` };
    if (!(await hasAccess(playerId))) return { error: SEALED };
    const run = await getRun(playerId);
    if (run.cleared) return { error: def.texts.clearedText };
    if (target === 'jefe') {
      if (!publicRun(run).doorOpen) return { error: def.texts.doorClosedText };
      if (!cercaDe(playerId, ZONE_DIR, def.bossSpot.x, def.bossSpot.y, 7)) return { error: `Acércate a ${def.texts.bossName} para desafiarlo` };
      return { target: encode('jefe'), specs: [{ code: BOSS_CODE, level: fightLevel(heroLevel, true) }] };
    }
    const g = def.guardianes[target];
    if (!g) return { error: 'Ese guardián no existe' };
    if ((run.guardians ?? []).includes(target)) return { error: 'Ese guardián ya cayó en este recorrido' };
    const [x0, y0, x1, y1] = g.box;
    const radius = Math.hypot(x1 - x0, y1 - y0) / 2 + GUARD_MARGIN;
    if (!cercaDe(playerId, ZONE_DIR, (x0 + x1) / 2, (y0 + y1) / 2, radius)) return { error: 'Ese guardián está lejos' };
    const level = fightLevel(heroLevel, false);
    return { target: encode(target), specs: g.monsters.map((code) => ({ code, level })) };
  }

  async function pickChest(classId) {
    const pool = def.chest.pool;
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = Math.random() * total;
    const p = pool.find((x) => (r -= x.w) < 0) ?? pool[0];
    const qty = Array.isArray(p.qty) ? p.qty[0] + Math.floor(Math.random() * (p.qty[1] - p.qty[0] + 1)) : p.qty;
    if (p.setSuffix) {
      // una pieza del set de su clase base (las evoluciones usan las de su clase base)
      const chain = classId ? await getClassAncestorChain(classId) : [];
      const base = (await db.query('SELECT code FROM classes WHERE id = $1', [chain[0] ?? classId])).rows[0]?.code;
      const slot = SET_SLOTS[Math.floor(Math.random() * SET_SLOTS.length)];
      const piece = base && (await db.query('SELECT code FROM items WHERE code = $1', [`${base}_${slot}_${p.setSuffix}`])).rows[0];
      if (piece) return { code: piece.code, qty: 1 };
      return { code: 'POCION_DE_VIDA_MAYOR', qty: 2 };
    }
    return { code: p.codes[Math.floor(Math.random() * p.codes.length)], qty };
  }

  // Al terminar un combate de esta mazmorra: guardianes vencidos y, si cayó el jefe, el cofre
  // Recompensa de la pasada para ESTE jugador: completa hasta que vence al jefe; después, durante
  // FULL_REWARD_HOURS, sus pasadas dan la mitad de XP y oro (el cofre y el botín no cambian). Así se
  // puede repetir para farmear materiales sin convertir la mazmorra en una mina de oro.
  // null si el combate no es de esta mazmorra.
  async function rewardMult(sessionId, playerId) {
    const s = await db.query('SELECT crypt_target FROM combat_sessions WHERE id = $1', [sessionId]).catch(() => ({ rows: [] }));
    if (!decode(s.rows[0]?.crypt_target)) return null;
    await ensureTables();
    const r = await db.query(
      `SELECT full_reward_at > now() - make_interval(hours => $2) AS repeated FROM ${TABLE} WHERE player_id = $1`,
      [playerId, FULL_REWARD_HOURS]
    );
    return r.rows[0]?.repeated ? REPEAT_REWARD_MULT : 1;
  }

  async function handleFinalize(sessionId, status, participants, addNews) {
    const s = await db.query('SELECT crypt_target FROM combat_sessions WHERE id = $1', [sessionId]).catch(() => ({ rows: [] }));
    const target = decode(s.rows[0]?.crypt_target);
    if (!target || status !== 'PLAYER_WON') return null;
    const abandoned = (await db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId])).rows.map((r) => r.player_id);
    const heroes = participants.player.filter((p) => p.player_id && !abandoned.includes(p.player_id));
    if (!heroes.length) return null;
    const out = { target, dir: ZONE_DIR };
    for (const h of heroes) {
      const mine = h === heroes[0];
      const run = await getRun(h.player_id);
      if (target !== 'jefe') {
        const upd = await db.query(
          `UPDATE ${TABLE} SET guardians = array_append(guardians, $2), updated_at = now()
           WHERE player_id = $1 AND NOT ($2 = ANY(guardians)) RETURNING *`,
          [h.player_id, target]
        );
        if (mine) Object.assign(out, { guardian: def.guardianes[target]?.name, ...publicRun(upd.rows[0] ?? run) });
        continue;
      }
      // cayó el jefe: cofre (si ya pasó su espera) y recorrido nuevo
      const pub = publicRun(run);
      let chest = null;
      if (!pub.chestReadyAt) {
        const lvl = Number(h.level) || 1;
        const gold = def.chest.gold(lvl);
        const pick = await pickChest(h.class_id);
        const item = (await db.query('SELECT id, name FROM items WHERE code = $1', [pick.code])).rows[0];
        await db.query('UPDATE players SET gold = gold + $1 WHERE id = $2', [gold, h.player_id]);
        if (item) await inventory.addItem(h.player_id, item.id, pick.qty);
        chest = { gold, item: item ? { name: item.name, quantity: pick.qty } : null };
      }
      // el jefe de la primera pasada (o la primera tras FULL_REWARD_HOURS) marca desde cuándo cobra la mitad
      const upd = await db.query(
        `UPDATE ${TABLE} SET cleared = TRUE, clears = clears + 1,
           chest_at = CASE WHEN $2 THEN now() ELSE chest_at END,
           full_reward_at = CASE WHEN full_reward_at IS NULL OR full_reward_at <= now() - make_interval(hours => $3) THEN now() ELSE full_reward_at END,
           updated_at = now()
         WHERE player_id = $1 RETURNING *`,
        [h.player_id, !!chest, FULL_REWARD_HOURS]
      );
      if (mine) Object.assign(out, { boss: true, chest, ...publicRun(upd.rows[0]) });
    }
    if (target === 'jefe' && addNews) {
      const names = heroes.map((h) => String(h.name ?? '').replace(/ Lv\.\d+$/, '')).filter(Boolean);
      if (names.length) addNews(def.texts.news(names.join(' y '), names.length > 1));
    }
    return out;
  }

  // ---------------------------------------------------------------- mecánicas del jefe
  // Filas especiales en combat_participant_buffs del jefe: WEAK_ELEM (elemento de su debilidad
  // actual) y FARO_N (cuántos turnos lleva); y FARO en el héroe marcado. No expiran solas (9999).
  const WEAK_CYCLE = def.boss.weakCycle;
  const beam = def.boss.beam;
  async function initBoss(sessionId) {
    const boss = await db.query('SELECT id FROM combat_participants WHERE session_id = $1 AND monster_code = $2', [sessionId, BOSS_CODE]);
    for (const b of boss.rows) {
      await db.query(
        `INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id)
         VALUES ($1,$2,'WEAK_ELEM',$3,9999,FALSE,NULL), ($1,$2,'FARO_N',0,9999,FALSE,NULL)`,
        [sessionId, b.id, WEAK_CYCLE[0]]
      );
    }
  }

  // se recuperó de la rotura: el escudo cambia de debilidad
  async function onBreakEnd(sessionId, p, round, insertLog) {
    if (p.monster_code !== BOSS_CODE) return;
    const cur = await weakElementOf(p.id);
    if (cur == null) return;
    const next = WEAK_CYCLE[(WEAK_CYCLE.indexOf(cur) + 1) % WEAK_CYCLE.length];
    await db.query("UPDATE combat_participant_buffs SET applied_flat = $1 WHERE participant_id = $2 AND stat_code = 'WEAK_ELEM'", [next, p.id]);
    await insertLog(sessionId, round, {
      actorId: p.id, targetId: p.id, action: 'SKILL',
      description: def.boss.shieldText(p.name, ELEMENT_NAME[next]),
    });
  }

  // Turno del jefe. Devuelve true si ya usó su turno (marcó o dio el golpe anunciado); false = ataca normal.
  async function bossTurn({ sessionId, round, actor, participants, persistParticipant, insertLog, markNearDeathIfLow }) {
    if (actor.monster_code !== BOSS_CODE) return false;
    const heroes = participants.player.filter((p) => p.hp > 0 && !p.is_summon);
    // la marca guarda (applied_flat) hasta qué línea del registro iba el combate cuando se puso
    const marked = await db.query("SELECT id, participant_id, applied_flat FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'FARO'", [sessionId]);
    const mark = marked.rows[0];
    const done = async () => { actor.has_acted_this_round = true; await persistParticipant(actor); return true; };
    if (mark) {
      const target = participants.player.find((p) => p.id === mark.participant_id);
      if (!target || target.hp <= 0) {
        await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [mark.id]);
        return false;
      }
      // le da tiempo al marcado de tener un turno (y ponerse a Defender) antes de pegar. Se mira el
      // registro y no la ronda: si el jefe es más rápido actúa primero en cada ronda, y "en guardia"
      // se borra al empezar la ronda; antes, con un jefe rápido, la marca no se cumplía nunca.
      const since = await db.query(
        `SELECT bool_or(action = 'DEFEND') AS defended, COUNT(*)::int AS turns FROM combat_log
         WHERE session_id = $1 AND actor_participant_id = $2 AND id > $3`,
        [sessionId, target.id, Number(mark.applied_flat) || 0]
      );
      if (!since.rows[0]?.turns) return false;
      await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [mark.id]);
      const guarded = !!since.rows[0].defended || !!target.is_defending;
      const invisible = !!target.no_damage_window;
      const dmg = invisible ? 0 : Math.max(1, Math.round(Number(target.max_hp) * (guarded ? beam.guardedPct : beam.pct)));
      target.hp = Math.max(0, target.hp - dmg);
      await persistParticipant(target);
      await markNearDeathIfLow(target);
      await insertLog(sessionId, round, {
        actorId: actor.id, action: 'SKILL', targetId: target.id, damage: dmg, evaded: invisible, hp_after: target.hp,
        description: invisible ? beam.missText(actor.name, target.name) : guarded ? beam.guardedText(actor.name, target.name, dmg) : beam.hitText(actor.name, target.name, dmg),
      });
      return done();
    }
    const n = await db.query(
      "UPDATE combat_participant_buffs SET applied_flat = applied_flat + 1 WHERE participant_id = $1 AND stat_code = 'FARO_N' RETURNING applied_flat",
      [actor.id]
    );
    const turn = Number(n.rows[0]?.applied_flat ?? 0);
    if (!heroes.length || turn % beam.every !== 2) return false;
    const target = heroes[Math.floor(Math.random() * heroes.length)];
    await insertLog(sessionId, round, { actorId: actor.id, action: 'SKILL', targetId: target.id, description: beam.markText(actor.name, target.name) });
    const last = await db.query('SELECT COALESCE(MAX(id), 0) AS id FROM combat_log WHERE session_id = $1', [sessionId]);
    await db.query(
      "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES ($1,$2,'FARO',$3,9999,TRUE,NULL)",
      [sessionId, target.id, Number(last.rows[0].id)]
    );
    return done();
  }

  return {
    ZONE_DIR, ZONE_ID: def.zoneId ?? 1, MIN_LEVEL, BOSS_CODE, CODES, MONSTERS: def.monsters, GUARDIANES: def.guardianes, BRASEROS: def.braseros, ELEMENT_CODE,
    texts: def.texts, decode, encode,
    resetIfCleared, ensureTables, isMonster, isCryptMonster: isMonster, state, lightBrazier, prepareFight, handleFinalize, rewardMult,
    initBoss, weakElementOf, onBreakEnd, bossTurn,
  };
}

// elemento que hoy rompe el escudo de este combatiente (null = el de siempre, por resistencias)
async function weakElementOf(participantId) {
  const r = await db.query("SELECT applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'WEAK_ELEM'", [participantId]);
  return r.rows[0] ? Number(r.rows[0].applied_flat) : null;
}

module.exports = { crearMazmorra, weakElementOf, ELEMENT_CODE, ELEMENT_NAME };
