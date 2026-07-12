const express = require('express');
const db = require('../db/db');
const combat = require('../lib/combat');
const inventory = require('../lib/inventory');
const leveling = require('../lib/leveling');
const { getEquipmentBonuses, getNpcEquipmentBonuses } = require('../lib/equipment');
const { getClassPassiveBonuses } = require('../lib/passives');
const elements = require('../lib/elements');
const { getRankBonuses, applyPercentBonus } = require('../lib/ranks');
const questProgress = require('../lib/questProgress');
const achievements = require('../lib/achievements');
const { requireAuth } = require('../lib/auth');
const { applyGuildXp } = require('../lib/guilds');
const pets = require('../lib/pets');

const router = express.Router();
router.use(requireAuth);

// players no tiene evasion como columna propia (solo "crit" como numero plano para chance),
// a diferencia de classes/monsters. Evasion se arma 100% de pasivas+equipo con base 0;
// crit_damage sale de classes.base_crit_damage (ver lib/leveling.js) + pasivas/equipo.
const DEFAULT_PLAYER_EVASION = 0;

// ---------- Helpers de carga/persistencia ----------

async function hasAbandonedActiveSession(playerId) {
  const res = await db.query(
    `SELECT 1 FROM combat_abandoned_players cap
     JOIN combat_sessions cs ON cs.id = cap.session_id
     WHERE cap.player_id = $1 AND cs.status = 'IN_PROGRESS'
     LIMIT 1`,
    [playerId]
  );
  return res.rows.length > 0;
}

async function hydratePlayers(playerIds) {
  const result = await db.query(
    `SELECT id, nickname, hp, max_hp, mana, max_mana, atk, def, mag, magic_def, spd, crit, luck,
            level, COALESCE(evolution_class_id, current_class_id) AS class_id
     FROM players WHERE id = ANY($1::int[])`,
    [playerIds]
  );
  return Promise.all(result.rows.map(async (p) => {
    // p.hp/max_hp ya incluyen el bono de equipo (ver lib/equipment.js applyHpBonusDelta);
    // sumarlo de nuevo aca lo duplicaba en cada pelea.
    const [bonus, passives, baseCritDamage, petB] = await Promise.all([
      getEquipmentBonuses(p.id),
      getClassPassiveBonuses(p.class_id, p.level),
      leveling.getClassBaseCritDamage(p.class_id),
      pets.getActivePetBonuses(p.id),
    ]);

    const playerMaxHp = Math.round(p.max_hp * (1 + passives.hp / 100)) + petB.hp;
    const luck = Number(p.luck || 0) + (passives.luck || 0) + (bonus.luck || 0) + petB.luck;
    return {
      side: 'PLAYER',
      player_id: p.id,
      monster_code: null,
      name: p.nickname,
      hp: Math.min(p.hp, playerMaxHp),
      max_hp: playerMaxHp,
      mana: Math.min(p.mana, p.max_mana + petB.mana),
      max_mana: p.max_mana + petB.mana,
      atk: Math.round(p.atk * (1 + passives.atk / 100)) + (bonus.atk || 0) + petB.atk,
      mag: Math.round(p.mag * (1 + passives.mag / 100)) + (bonus.mag || 0) + petB.mag,
      def: Math.round(p.def * (1 + passives.def / 100)) + (bonus.def || 0) + petB.def,
      magic_def: Math.round(p.magic_def * (1 + passives.magic_def / 100)) + (bonus.magic_def || 0) + petB.magic_def,
      spd: Math.round(p.spd * (1 + passives.spd / 100)) + (bonus.spd || 0) + petB.spd,
      luck,
      crit_chance: Number(p.crit) + passives.crit_chance + (bonus.crit_chance || 0) + luck * 0.5 + petB.crit_chance,
      crit_damage: baseCritDamage + passives.crit_damage + (bonus.crit_damage || 0) + petB.crit_damage,
      evasion: DEFAULT_PLAYER_EVASION + passives.evasion + (bonus.evasion || 0) + petB.evasion,
      magic_damage_bonus: passives.magic_damage_bonus + passives.magical_damage,
      hot_hp_percent: passives.hot_hp_percent + petB.hot_hp_percent,
      physical_damage_bonus: passives.physical_damage,
      elemental_damage_bonus: passives.elemental_damage,
      heal_bonus: passives.heal_bonus + petB.heal_bonus,
      damage_reduction: petB.damage_reduction,
      npc_id: null,
      class_id: p.class_id,
      xp_reward: 0,
      gold_reward: 0,
      owner_player_id: p.id,
    };
  }));
}

async function hydratePartyNpcs(playerId, ownerPlayerId = null, slotLimit = null) {
  const result = await db.query(
    `SELECT pn.id, pn.name, pn.class_id, pn.level, pn.hp, pn.max_hp, pn.mana, pn.max_mana,
            pn.atk, pn.def, pn.mag, pn.magic_def, pn.spd, pn.crit
     FROM player_party pp
     JOIN player_npcs pn ON pn.id = pp.npc_id
     WHERE pp.player_id = $1
     ORDER BY pp.slot
     ${slotLimit ? `LIMIT ${slotLimit}` : ''}`,
    [playerId]
  );

  return Promise.all(result.rows.map(async (npc) => {
    const [bonus, passives, baseCritDamage] = await Promise.all([
      getNpcEquipmentBonuses(npc.id),
      getClassPassiveBonuses(npc.class_id, npc.level),
      leveling.getClassBaseCritDamage(npc.class_id),
    ]);
    return {
      side: 'PLAYER',
      player_id: null,
      npc_id: npc.id,
      class_id: npc.class_id,
      monster_code: null,
      name: npc.name,
      hp: Math.min(npc.hp, Math.round(npc.max_hp * (1 + passives.hp / 100))),
      max_hp: Math.round(npc.max_hp * (1 + passives.hp / 100)),
      mana: npc.mana,
      max_mana: npc.max_mana,
      atk: Math.round(npc.atk * (1 + passives.atk / 100)) + (bonus.atk || 0),
      mag: Math.round(npc.mag * (1 + passives.mag / 100)) + (bonus.mag || 0),
      def: Math.round(npc.def * (1 + passives.def / 100)) + (bonus.def || 0),
      magic_def: Math.round(npc.magic_def * (1 + passives.magic_def / 100)) + (bonus.magic_def || 0),
      spd: Math.round(npc.spd * (1 + passives.spd / 100)) + (bonus.spd || 0),
      luck: (passives.luck || 0) + (bonus.luck || 0),
      crit_chance: Number(npc.crit) + passives.crit_chance + (bonus.crit_chance || 0) + ((passives.luck || 0) + (bonus.luck || 0)) * 0.5,
      crit_damage: baseCritDamage + passives.crit_damage + (bonus.crit_damage || 0),
      evasion: DEFAULT_PLAYER_EVASION + passives.evasion + (bonus.evasion || 0),
      magic_damage_bonus: passives.magic_damage_bonus + passives.magical_damage,
      hot_hp_percent: passives.hot_hp_percent,
      physical_damage_bonus: passives.physical_damage,
      elemental_damage_bonus: passives.elemental_damage,
      heal_bonus: passives.heal_bonus,
      xp_reward: 0,
      gold_reward: 0,
      owner_player_id: ownerPlayerId ?? playerId,
    };
  }));
}

// Interpola linealmente un stat entre las dos filas de monster_level_scalings que rodean al
// nivel pedido (normalmente solo hay 2 filas guardadas: min_spawn_level y max_spawn_level).
function interpolateStat(level, low, high, key) {
  const lowVal = Number(low[key]);
  const highVal = Number(high[key]);
  if (low.level === high.level) return lowVal;
  const t = (level - low.level) / (high.level - low.level);
  return lowVal + (highVal - lowVal) * t;
}

async function hydrateMonsters(monsterSpecs) {
  const combatants = [];

  for (const spec of monsterSpecs) {
    const monsterResult = await db.query('SELECT * FROM monsters WHERE code = $1', [spec.code]);
    if (!monsterResult.rows.length) continue;
    const monster = monsterResult.rows[0];
    const level = spec.level || monster.base_level;

    const scalingResult = await db.query(
      'SELECT * FROM monster_level_scalings WHERE monster_id = $1 ORDER BY level',
      [monster.id]
    );
    const rows = scalingResult.rows;

    // low = la fila de nivel mas alto que sea <= level; high = la de nivel mas bajo que sea >= level.
    // Si "level" cae fuera del rango cargado, ambas terminan apuntando a la punta mas cercana.
    let low = null;
    let high = null;
    for (const row of rows) {
      if (row.level <= level) low = row;
      if (row.level >= level && !high) high = row;
    }
    if (!low) low = high;
    if (!high) high = low;

    const stat = (key, fallback) => (low ? Math.round(interpolateStat(level, low, high, key)) : fallback);
    const statRaw = (key, fallback) => (low ? interpolateStat(level, low, high, key) : fallback);

    const hp = stat('hp', monster.base_hp);
    const levelRange = monster.max_spawn_level - monster.min_spawn_level;

    combatants.push({
      side: 'ENEMY',
      player_id: null,
      monster_code: monster.code,
      element_id: monster.element_id,
      name: `${monster.name} Lv.${level}`,
      hp,
      max_hp: hp,
      mana: level * 10,
      max_mana: level * 10,
      atk: stat('atk', monster.base_atk),
      mag: stat('magic_atk', monster.base_magic_atk),
      def: stat('def', monster.base_def),
      magic_def: stat('magic_def', monster.base_magic_def),
      spd: stat('spd', monster.base_spd),
      crit_chance: statRaw('crit_chance', monster.base_crit_chance),
      crit_damage: statRaw('crit_damage', monster.base_crit_damage),
      evasion: statRaw('evasion', monster.base_evasion),
      // XP y oro escalan linealmente desde min_spawn_level (+0%) hasta max_spawn_level (+50%).
      xp_reward: Math.round(monster.xp_reward * (1 + (levelRange > 0 ? (level - monster.min_spawn_level) / levelRange : 0) * 0.5)),
      gold_reward: Math.round(monster.gold_reward * (1 + (levelRange > 0 ? (level - monster.min_spawn_level) / levelRange : 0) * 0.5)),
    });
  }

  return combatants;
}

async function insertParticipants(sessionId, combatants) {
  const inserted = [];
  for (const c of combatants) {
    const result = await db.query(
      `INSERT INTO combat_participants(
         session_id, side, player_id, npc_id, class_id, monster_code, name, hp, max_hp, mana, max_mana,
         atk, mag, def, magic_def, spd, crit_chance, crit_damage, evasion,
         magic_damage_bonus, hot_hp_percent, xp_reward, gold_reward,
         physical_damage_bonus, elemental_damage_bonus, heal_bonus, luck, owner_player_id, damage_reduction
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29)
       RETURNING *`,
      [
        sessionId, c.side, c.player_id ?? null, c.npc_id ?? null, c.class_id ?? null,
        c.monster_code, c.name, c.hp, c.max_hp, c.mana, c.max_mana,
        c.atk, c.mag, c.def, c.magic_def, c.spd, c.crit_chance, c.crit_damage, c.evasion,
        c.magic_damage_bonus ?? 0, c.hot_hp_percent ?? 0, c.xp_reward, c.gold_reward,
        c.physical_damage_bonus ?? 0, c.elemental_damage_bonus ?? 0, c.heal_bonus ?? 0, c.luck ?? 0,
        c.owner_player_id ?? null, c.damage_reduction ?? 0,
      ]
    );
    inserted.push(result.rows[0]);
  }
  return inserted;
}

async function loadParticipants(sessionId) {
  const [participantsResult, buffsResult] = await Promise.all([
    db.query(
      `SELECT cp.*, c.name AS class_name
       FROM combat_participants cp
       LEFT JOIN classes c ON c.id = cp.class_id
       WHERE cp.session_id = $1
       ORDER BY cp.id`,
      [sessionId]
    ),
    db.query('SELECT participant_id, stat_code, applied_flat FROM combat_participant_buffs WHERE session_id = $1', [sessionId]),
  ]);
  const all = participantsResult.rows;
  for (const p of all) {
    p.temp_resist = {};
    p.no_damage_window = false;
    p.damage_taken_bonus = 0;
    for (const buff of buffsResult.rows) {
      if (buff.participant_id !== p.id) continue;
      if (buff.stat_code.startsWith('RESIST_')) {
        const elemCode = buff.stat_code.replace('RESIST_', '');
        p.temp_resist[elemCode] = (p.temp_resist[elemCode] || 0) + Number(buff.applied_flat);
      } else if (buff.stat_code === 'NO_DAMAGE') {
        p.no_damage_window = true;
      } else if (buff.stat_code === 'DAMAGE_TAKEN') {
        p.damage_taken_bonus += Number(buff.applied_flat);
      }
    }
  }
  return {
    all,
    player: all.filter((p) => p.side === 'PLAYER'),
    enemy: all.filter((p) => p.side === 'ENEMY'),
  };
}

async function persistParticipant(p) {
  await db.query(
    `UPDATE combat_participants SET hp=$1, mana=$2, is_defending=$3, has_acted_this_round=$4,
       atk=$5, mag=$6, def=$7, spd=$8, magic_def=$9, crit_chance=$10,
       imbued_element_id=$11, imbued_damage_bonus=$12
     WHERE id=$13`,
    [p.hp, p.mana, p.is_defending, p.has_acted_this_round, p.atk, p.mag, p.def, p.spd, p.magic_def, p.crit_chance,
     p.imbued_element_id ?? null, p.imbued_damage_bonus ?? 0, p.id]
  );
}

// Crea un invocado como combat_participant del lado PLAYER con has_acted_this_round=TRUE
// (el invocado no tiene turno propio; actua como bonus action del invocador).
// Aplica el aura de resistencia elemental a todos los aliados vivos.
async function createSummonParticipant(sessionId, actor, summonEffect, skill, participants) {
  let invokerLevel = 1;
  if (actor.player_id) {
    const r = await db.query('SELECT level FROM players WHERE id = $1', [actor.player_id]);
    invokerLevel = r.rows[0]?.level || 1;
  } else if (actor.npc_id) {
    const r = await db.query('SELECT level FROM player_npcs WHERE id = $1', [actor.npc_id]);
    invokerLevel = r.rows[0]?.level || 1;
  }

  const summonName     = summonEffect.stat_code;
  const summonHp       = Math.round(Number(actor.max_hp) * 0.40);
  const summonDef      = Math.round(invokerLevel * 3);
  const summonRounds   = Number(summonEffect.duration_turns || 5);
  const auraStrength   = Number(summonEffect.percent_amount || 25);

  const ins = await db.query(
    `INSERT INTO combat_participants(
       session_id, side, player_id, npc_id, class_id, monster_code,
       name, hp, max_hp, mana, max_mana, atk, mag, def, magic_def, spd,
       crit_chance, crit_damage, evasion, magic_damage_bonus, hot_hp_percent,
       xp_reward, gold_reward,
       is_summon, summoner_id, summon_rounds_remaining, element_id, has_acted_this_round
     ) VALUES ($1,'PLAYER',NULL,NULL,NULL,NULL,$2,$3,$3,0,0,0,$4,$5,$5,0,
               0,150,0,0,0,0,0, TRUE,$6,$7,$8,TRUE)
     RETURNING *`,
    [sessionId, summonName, summonHp, Number(actor.mag), summonDef,
     actor.id, summonRounds, skill.element_id ?? null]
  );
  const summon = ins.rows[0];
  summon.temp_resist      = {};
  summon.no_damage_window = false;
  summon.damage_taken_bonus = 0;

  // Aura de resistencia elemental para todos los aliados vivos
  if (skill.element_id) {
    const elemCode = await elements.getElementCodeById(skill.element_id);
    if (elemCode) {
      const statCode    = `RESIST_${elemCode}`;
      const alivePlayers = participants.player.filter((p) => p.hp > 0);
      for (const p of alivePlayers) {
        p.temp_resist[elemCode] = (p.temp_resist[elemCode] || 0) + auraStrength;
        await db.query(
          'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,FALSE,$6)',
          [sessionId, p.id, statCode, auraStrength, summonRounds, skill.id]
        );
      }
    }
  }

  participants.player.push(summon);
  participants.all.push(summon);
  return { summon, auraStrength };
}

// Ejecuta el ataque automatico del invocado activo del actor (bonus action).
// No tiene turno propio; se llama justo despues de que el invocador actue.
async function execSummonBonusAttack(sessionId, actorParticipantId, round, participants) {
  const summon = participants.player.find(
    (p) => p.is_summon && Number(p.summoner_id) === actorParticipantId && p.hp > 0
  );
  if (!summon) return null;

  const aliveEnemies = participants.enemy.filter((e) => e.hp > 0);
  if (!aliveEnemies.length) return null;

  const target    = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
  const synthSkill = {
    base_value: 30, scaling_stat: 'MAG', scaling_multiplier: 0.75,
    hits: 1, skill_type: 'ATAQUE', damage_school: 'MAGICO',
    element_id: summon.element_id,
  };

  let elemModsByTarget = {};
  if (summon.element_id) {
    const elemCode  = await elements.getElementCodeById(summon.element_id);
    const baseResist = target.monster_code
      ? await elements.getMonsterElementResistance(target.monster_code, summon.element_id)
      : target.player_id
        ? await elements.getPlayerElementResistance(target.player_id, summon.element_id)
        : await elements.getClassElementResistance(target.class_id, summon.element_id);
    const tempResist = (elemCode && target.temp_resist?.[elemCode]) || 0;
    elemModsByTarget[target.id] = { damageBonusPercent: 0, resistancePercent: baseResist + tempResist };
  }

  const [result] = combat.resolveSkill(summon, [target], synthSkill, elemModsByTarget);
  await persistParticipant(target);

  const elemCode = summon.element_id ? await elements.getElementCodeById(summon.element_id) : null;
  const hitDesc  = result.evaded
    ? `${target.name} esquiva`
    : `${target.name} por ${result.amount}${result.crit ? ' (¡crítico!)' : ''}${elemCode ? ` [${elemCode}]` : ''}`;

  await insertLog(sessionId, round, {
    actorId:  summon.id,
    action:   'ATTACK',
    targetId: target.id,
    damage:   result.evaded ? 0 : result.amount,
    evaded:   result.evaded,
    crit:     result.crit,
    description: `${summon.name} ataca a ${hitDesc}.`,
    hp_after: target.hp,
  });

  return result;
}

function getParticipantStat(participant, statCode) {
  if (statCode === 'ATK') return Number(participant.atk || 0);
  if (statCode === 'MAG') return Number(participant.mag || 0);
  if (statCode === 'DEF') return Number(participant.def || 0);
  if (statCode === 'MAGIC_DEF') return Number(participant.magic_def || 0);
  if (statCode === 'SPD') return Number(participant.spd || 0);
  if (statCode === 'CRIT_CHANCE') return Number(participant.crit_chance || 0);
  return 0;
}

function applyStatDelta(participant, statCode, delta) {
  if (statCode === 'ATK') participant.atk = (participant.atk || 0) + delta;
  else if (statCode === 'MAG') participant.mag = (participant.mag || 0) + delta;
  else if (statCode === 'DEF') participant.def = (participant.def || 0) + delta;
  else if (statCode === 'MAGIC_DEF') participant.magic_def = (participant.magic_def || 0) + delta;
  else if (statCode === 'SPD') participant.spd = (participant.spd || 0) + delta;
  else if (statCode === 'CRIT_CHANCE') participant.crit_chance = (participant.crit_chance || 0) + delta;
}

// Aplica un efecto STAT_MOD (imbue, resist, DAMAGE_TAKEN, o stat regular) a un participante.
// skillId: si se pasa, la misma skill no puede acumular el mismo efecto (solo refresca duración).
// Distintas skills con el mismo stat_code SÍ pueden acumularse (ej. dos imbues distintos de fuego).
async function applyStatModBuff(sessionId, target, effect, isDebuff, descParts, skillId = null) {
  const ELEMENT_CODES = ['FIRE', 'ICE', 'LIGHTNING', 'WIND', 'EARTH', 'WATER', 'LIGHT', 'DARK', 'COSMIC'];
  const SUPPORTED_BUFF_STATS = ['ATK', 'MAG', 'DEF', 'MAGIC_DEF', 'SPD', 'CRIT_CHANCE'];
  const pct = Number(effect.percent_amount || 0);
  const durationTurns = Number(effect.duration_turns);

  const resistElemCode = ELEMENT_CODES.find((ec) => effect.stat_code === `RESIST_${ec}`);
  if (resistElemCode) {
    if (skillId) {
      const ex = await db.query(
        'SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code=$3',
        [target.id, skillId, effect.stat_code]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} resist ${resistElemCode} refrescado (${durationTurns}T)`);
        return;
      }
    }
    target.temp_resist = target.temp_resist || {};
    target.temp_resist[resistElemCode] = (target.temp_resist[resistElemCode] || 0) + pct;
    await db.query(
      'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [sessionId, target.id, effect.stat_code, pct, durationTurns, isDebuff, skillId]
    );
    descParts.push(`${target.name} +${pct}% resist ${resistElemCode} (${durationTurns}T)`);
    return;
  }

  const imbueElemCode = ELEMENT_CODES.find((ec) => effect.stat_code === `${ec}_DAMAGE`);
  if (imbueElemCode) {
    const imbueStatCode = `IMBUE_${imbueElemCode}`;
    if (skillId) {
      const ex = await db.query(
        'SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code=$3',
        [target.id, skillId, imbueStatCode]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} imbue ${imbueElemCode} refrescado (${durationTurns}T)`);
        return;
      }
    }
    const elemId = await elements.getElementIdByCode(imbueElemCode);
    if (elemId) {
      target.imbued_element_id = elemId;
      target.imbued_damage_bonus = pct;
      await persistParticipant(target);
      await db.query(
        'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [sessionId, target.id, imbueStatCode, pct, durationTurns, false, skillId]
      );
      descParts.push(`${target.name} imbuído con ${imbueElemCode} +${pct}% daño (${durationTurns}T)`);
    }
    return;
  }

  if (effect.stat_code === 'DAMAGE_TAKEN') {
    if (skillId) {
      const ex = await db.query(
        "SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code='DAMAGE_TAKEN'",
        [target.id, skillId]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} maldición refrescada (${durationTurns}T)`);
        return;
      }
    }
    target.damage_taken_bonus = (target.damage_taken_bonus || 0) + pct;
    await db.query(
      "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DAMAGE_TAKEN',$3,$4,$5,$6)",
      [sessionId, target.id, pct, durationTurns, isDebuff, skillId]
    );
    const sign = pct >= 0 ? '+' : '';
    descParts.push(`${target.name} ${sign}${pct}% daño recibido (${durationTurns}T)`);
    return;
  }

  if (SUPPORTED_BUFF_STATS.includes(effect.stat_code)) {
    if (skillId) {
      const ex = await db.query(
        'SELECT id FROM combat_participant_buffs WHERE participant_id=$1 AND skill_id=$2 AND stat_code=$3',
        [target.id, skillId, effect.stat_code]
      );
      if (ex.rows.length) {
        await db.query('UPDATE combat_participant_buffs SET rounds_remaining=$1 WHERE id=$2', [durationTurns, ex.rows[0].id]);
        descParts.push(`${target.name} ${effect.stat_code} refrescado (${durationTurns}T)`);
        return;
      }
    }
    const appliedFlat = Math.round(getParticipantStat(target, effect.stat_code) * pct / 100);
    applyStatDelta(target, effect.stat_code, appliedFlat);
    await persistParticipant(target);
    await db.query(
      'INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [sessionId, target.id, effect.stat_code, appliedFlat, durationTurns, isDebuff, skillId]
    );
    const sign = pct >= 0 ? '+' : '';
    descParts.push(`${target.name} ${sign}${pct}% ${effect.stat_code} (${durationTurns}T)`);
  }
}

async function getLastActingSide(sessionId, round) {
  const result = await db.query(
    `SELECT cp.side FROM combat_log cl
     JOIN combat_participants cp ON cp.id = cl.actor_participant_id
     WHERE cl.session_id = $1 AND cl.round = $2
     ORDER BY cl.id DESC LIMIT 1`,
    [sessionId, round]
  );
  return result.rows[0] ? result.rows[0].side : null;
}

async function insertLog(sessionId, round, entry) {
  await db.query(
    `INSERT INTO combat_log(session_id, round, actor_participant_id, action, target_participant_id, item_id, damage, heal, evaded, crit, success, description, hp_after, mana_after)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      sessionId, round, entry.actorId, entry.action, entry.targetId || null, entry.itemId || null,
      entry.damage ?? null, entry.heal ?? null, entry.evaded || false, entry.crit || false, entry.success !== false, entry.description,
      entry.hp_after ?? null, entry.mana_after ?? null,
    ]
  );
}

async function startNewRound(sessionId, participants) {
  await db.query('UPDATE combat_sessions SET current_round = current_round + 1, updated_at = now() WHERE id = $1', [sessionId]);
  const roundRes = await db.query('SELECT current_round FROM combat_sessions WHERE id = $1', [sessionId]);
  const newRound = roundRes.rows[0].current_round;
  // Los invocados tienen has_acted_this_round=TRUE permanente (actuan como bonus action, no turno propio)
  await db.query(
    'UPDATE combat_participants SET has_acted_this_round = FALSE, is_defending = FALSE WHERE session_id = $1 AND hp > 0 AND NOT is_summon',
    [sessionId]
  );
  participants.all.forEach((p) => {
    if (p.hp > 0 && !p.is_summon) {
      p.has_acted_this_round = false;
      p.is_defending = false;
    }
  });

  // DOT tick: daño por veneno antes de expirar buffs (percent_amount % del HP máximo por ronda).
  const dotRows = await db.query(
    "SELECT * FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'DOT'",
    [sessionId]
  );
  for (const dot of dotRows.rows) {
    const p = participants.all.find((x) => x.id === dot.participant_id);
    if (p && p.hp > 0) {
      const dotDmg = Math.max(1, Math.round(Number(p.max_hp) * Number(dot.applied_flat) / 100));
      p.hp = Math.max(0, p.hp - dotDmg);
      await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
    }
  }

  // Tick de buffs/debuffs: decrementar turns restantes y revertir los que expiran.
  const buffsResult = await db.query(
    'SELECT * FROM combat_participant_buffs WHERE session_id = $1',
    [sessionId]
  );
  for (const buff of buffsResult.rows) {
    const newRounds = buff.rounds_remaining - 1;
    const p = participants.all.find((x) => x.id === buff.participant_id);
    if (newRounds <= 0) {
      if (p) {
        if (buff.stat_code.startsWith('IMBUE_')) {
          p.imbued_element_id = null;
          p.imbued_damage_bonus = 0;
          await persistParticipant(p);
        } else if (buff.stat_code.startsWith('RESIST_') || buff.stat_code === 'DOT' || buff.stat_code === 'NO_DAMAGE' || buff.stat_code === 'DAMAGE_TAKEN' || buff.stat_code === 'HOT') {
          // Solo borrar la fila: estos efectos no tienen stat persistido que revertir
        } else {
          applyStatDelta(p, buff.stat_code, -Number(buff.applied_flat));
          await persistParticipant(p);
        }
      }
      await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [buff.id]);
    } else {
      await db.query('UPDATE combat_participant_buffs SET rounds_remaining = $1 WHERE id = $2', [newRounds, buff.id]);
    }
  }

  // HOT tick desde skills temporales (stat_code='HOT', applied_flat = % del max_hp).
  const hotSkillRows = await db.query(
    "SELECT * FROM combat_participant_buffs WHERE session_id = $1 AND stat_code = 'HOT'",
    [sessionId]
  );
  for (const hot of hotSkillRows.rows) {
    const p = participants.all.find((x) => x.id === hot.participant_id);
    if (p && p.hp > 0) {
      const healAmt = Math.max(1, Math.round(Number(p.max_hp) * Number(hot.applied_flat) / 100));
      p.hp = Math.min(Number(p.max_hp), p.hp + healAmt);
      await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
    }
  }

  // HOT (Heal Over Time): participantes vivos con hot_hp_percent > 0 se curan al final de cada ronda.
  for (const p of participants.all) {
    if (p.hp > 0 && Number(p.hot_hp_percent) > 0) {
      const heal = Math.max(1, Math.round(Number(p.max_hp) * Number(p.hot_hp_percent) / 100));
      p.hp = Math.min(Number(p.max_hp), p.hp + heal);
      await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
    }
  }

  // Expiración de invocados: decrementar rondas restantes; al llegar a 0, desaparecer
  const activeSummons = await db.query(
    'SELECT id, name, summon_rounds_remaining FROM combat_participants WHERE session_id = $1 AND is_summon = TRUE AND hp > 0',
    [sessionId]
  );
  for (const row of activeSummons.rows) {
    const remaining = Number(row.summon_rounds_remaining) - 1;
    const sp = participants.all.find((p) => p.id === row.id);
    if (remaining <= 0) {
      await db.query('UPDATE combat_participants SET hp = 0 WHERE id = $1', [row.id]);
      if (sp) sp.hp = 0;
      await insertLog(sessionId, newRound, {
        actorId: row.id, action: 'SKILL',
        description: `${row.name} ha cumplido su tiempo y regresa a su plano.`,
      });
    } else {
      await db.query('UPDATE combat_participants SET summon_rounds_remaining = $1 WHERE id = $2', [remaining, row.id]);
      if (sp) sp.summon_rounds_remaining = remaining;
    }
  }
}

// Cada monstruo (ver seed.sql: monster_drops) tiene exactamente 1 material propio con su
// drop_chance_percent (COMMON 30%, RARE 15%, MINIBOSS 8%, LEGENDARY 100% garantizado) y una
// cantidad min/max. Se rolea independiente por CADA enemigo de la sesion (no por codigo unico),
// asi que matar 2 Lobos de Pradera en la misma pelea son 2 tiradas separadas de su drop.
async function rollMonsterDrops(enemies, dropRateBonusPct = 0) {
  const codes = [...new Set(enemies.map((e) => e.monster_code))];
  if (!codes.length) return [];

  const dropsResult = await db.query(
    `SELECT m.code AS monster_code, md.item_id, i.name AS item_name, md.drop_chance_percent, md.min_quantity, md.max_quantity
     FROM monster_drops md
     JOIN monsters m ON m.id = md.monster_id
     JOIN items i ON i.id = md.item_id
     WHERE m.code = ANY($1::text[])`,
    [codes]
  );
  // Agrupa drops por monstruo: monstruos normales tienen 1 entrada, bosses con scrolls
  // de clase tienen 6 (1 compartido + 5 de clase). Cada entrada se testea INDEPENDIENTEMENTE.
  const dropsByCode = new Map();
  for (const row of dropsResult.rows) {
    if (!dropsByCode.has(row.monster_code)) dropsByCode.set(row.monster_code, []);
    dropsByCode.get(row.monster_code).push(row);
  }

  const dropped = [];
  for (const enemy of enemies) {
    const drops = dropsByCode.get(enemy.monster_code);
    if (!drops) continue;
    for (const drop of drops) {
    const effectiveChance = Math.min(100, Number(drop.drop_chance_percent) * (1 + dropRateBonusPct / 100));
    if (Math.random() * 100 >= effectiveChance) continue;

    const quantity = drop.min_quantity + Math.floor(Math.random() * (drop.max_quantity - drop.min_quantity + 1));
    dropped.push({ itemId: drop.item_id, itemName: drop.item_name, quantity });
    }
  }
  return dropped;
}

async function finalizeSession(sessionId, status, participants) {
  await db.query('UPDATE combat_sessions SET status = $1, updated_at = now() WHERE id = $2', [status, sessionId]);
  await db.query('DELETE FROM combat_participant_buffs WHERE session_id = $1', [sessionId]);

  let rewards = null;
  if (status === 'PLAYER_WON') {
    rewards = participants.enemy.reduce(
      (acc, m) => ({ gold: acc.gold + (m.gold_reward || 0), xp: acc.xp + (m.xp_reward || 0) }),
      { gold: 0, xp: 0 }
    );
    rewards.levelUps = [];
  }

  const abandonedRes = await db.query(
    'SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]
  );
  const abandonedIds = abandonedRes.rows.map((r) => r.player_id);

  // heroPs[0] es el líder (quien llamó a explore); en solo hay uno.
  // Excluir jugadores que abandonaron el combate: no cobran oro/xp/items.
  const heroPs = participants.player.filter((p) => p.player_id && !abandonedIds.includes(p.player_id));
  const heroP  = heroPs[0] ?? null;
  const npcPs  = participants.player.filter((p) => p.npc_id && !abandonedIds.includes(p.owner_player_id));

  if (heroP) {
    if (rewards) {
      for (const enemy of participants.enemy) {
        await questProgress.registerKill(heroP.player_id, enemy.monster_code);
      }

      const rankResult = await db.query('SELECT rank FROM players WHERE id = $1', [heroP.player_id]);
      const { xpBonusPercent, rewardBonusPercent } = await getRankBonuses(rankResult.rows[0].rank);
      const [combatAchBonuses, heroPetBonuses] = await Promise.all([
        achievements.getPlayerBonuses(heroP.player_id),
        pets.getActivePetBonuses(heroP.player_id),
      ]);

      const heroClassRes = await db.query(
        'SELECT COALESCE(evolution_class_id, current_class_id) AS class_id, level FROM players WHERE id = $1',
        [heroP.player_id]
      );
      const heroPassives = await getClassPassiveBonuses(heroClassRes.rows[0]?.class_id, heroClassRes.rows[0]?.level);

      rewards.gold = applyPercentBonus(applyPercentBonus(applyPercentBonus(applyPercentBonus(rewards.gold, rewardBonusPercent), combatAchBonuses.goldEarned), heroPassives.gold_bonus), heroPetBonuses.gold_percent);
      rewards.xp   = applyPercentBonus(applyPercentBonus(applyPercentBonus(applyPercentBonus(rewards.xp,   xpBonusPercent),     combatAchBonuses.xpEarned),   heroPassives.xp_bonus),   heroPetBonuses.xp_percent);
      const heroLuckRow = await db.query('SELECT luck FROM players WHERE id = $1', [heroP.player_id]);
      const heroLuck = Number(heroLuckRow.rows[0]?.luck || 0);
      rewards.itemsDropped = await rollMonsterDrops(participants.enemy, heroPassives.drop_rate_bonus + heroLuck + heroPetBonuses.drop_rate_percent);

      // Co-op: oro dividido en partes iguales entre todos los héroes (1 a 3).
      const goldPerHero = Math.floor(rewards.gold / heroPs.length);
      rewards.gold = goldPerHero;

      for (const hp of heroPs) {
        await db.query(
          'UPDATE players SET hp = $1, mana = $2, gold = gold + $3, updated_at = now() WHERE id = $4',
          [hp.hp, hp.mana, goldPerHero, hp.player_id]
        );
      }

      const partySize = heroPs.length + npcPs.length;
      const splitXp = Math.floor(rewards.xp / partySize);

      for (const hp of heroPs) {
        const levelResult = await leveling.applyXpGain(hp.player_id, splitXp);
        if (levelResult && levelResult.leveledUp) {
          rewards.levelUps.push({ playerId: hp.player_id, newLevel: levelResult.newLevel });
        }
        if (hp !== heroP) {
          for (const enemy of participants.enemy) {
            await questProgress.registerKill(hp.player_id, enemy.monster_code);
          }
        }
      }
      for (const npc of npcPs) {
        const npcLevelResult = await leveling.applyNpcXpGain(npc.npc_id, splitXp);
        if (npcLevelResult && npcLevelResult.leveledUp) {
          rewards.levelUps.push({ npcId: npc.npc_id, npcName: npc.name, newLevel: npcLevelResult.newLevel });
        }
      }

      for (const drop of rewards.itemsDropped) {
        for (const hp of heroPs) {
          await inventory.addItem(hp.player_id, drop.itemId, drop.quantity);
        }
      }

      const monsterCodes = participants.enemy.map((e) => e.monster_code).filter(Boolean);
      if (monsterCodes.length) {
        const zoneRows = await db.query(
          `SELECT DISTINCT zone_id FROM monsters WHERE code = ANY($1::text[]) AND zone_id IS NOT NULL`,
          [monsterCodes]
        );
        for (const { zone_id } of zoneRows.rows) {
          for (const hp of heroPs) {
            await db.query(
              `INSERT INTO player_zone_unlocks(player_id, zone_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,
              [hp.player_id, zone_id]
            );
          }
        }
      }

      const guildMemberRes = await db.query('SELECT guild_id FROM guild_members WHERE player_id = $1', [heroP.player_id]);
      if (guildMemberRes.rows.length) {
        const codes = participants.enemy.map((e) => e.monster_code).filter(Boolean);
        if (codes.length) {
          const rarityRes = await db.query(`SELECT code, rarity FROM monsters WHERE code = ANY($1::text[])`, [codes]);
          const rarityByCode = new Map(rarityRes.rows.map((r) => [r.code, r.rarity]));
          const GUILD_XP_BY_RARITY = { COMMON: 5, RARE: 15, MINIBOSS: 50, LEGENDARY: 120 };
          const baseGuildXp = participants.enemy.reduce((sum, e) => sum + (GUILD_XP_BY_RARITY[rarityByCode.get(e.monster_code)] || 0), 0);
          const guildXpGained = Math.round(applyPercentBonus(baseGuildXp, heroPetBonuses.guild_xp_percent));
          if (guildXpGained > 0) await applyGuildXp(guildMemberRes.rows[0].guild_id, guildXpGained);
        }
      }
    } else {
      for (const hp of heroPs) {
        await db.query(
          'UPDATE players SET hp = $1, mana = $2, updated_at = now() WHERE id = $3',
          [hp.hp, hp.mana, hp.player_id]
        );
      }
    }
  }

  for (const npc of npcPs) {
    await db.query('UPDATE player_npcs SET hp = $1, mana = $2 WHERE id = $3', [npc.hp, npc.mana, npc.npc_id]);
  }

  return rewards;
}

async function resolveAbandonedPlayerTurn(sessionId, round, actor, participants) {
  const target = combat.pickRandomAliveTarget(participants.enemy);
  if (!target) return;
  const result = combat.resolveAttack(actor, target);
  actor.has_acted_this_round = true;
  await persistParticipant(actor);
  await persistParticipant(target);
  await insertLog(sessionId, round, {
    actorId: actor.id, action: 'ATTACK', targetId: target.id,
    damage: result.damage, evaded: result.evaded, crit: result.crit,
    description: result.evaded
      ? `${actor.name} (IA) ataca a ${target.name} pero esquiva el golpe.`
      : `${actor.name} (IA) ataca a ${target.name} por ${result.damage} de daño${result.crit ? ' (¡crítico!)' : ''}.`,
    hp_after: target.hp,
  });
}

// Auto-resuelve turnos de ENEMY y de jugadores abandonados (IA básica), y transiciones de
// ronda hasta que sea turno de un PLAYER activo o termine la pelea. Devuelve { ended, status }.
async function advanceEnemyTurns(sessionId) {
  for (let safety = 0; safety < 200; safety += 1) {
    const participants = await loadParticipants(sessionId);

    if (combat.isWiped(participants.player)) {
      // Revivir pasiva de mascota: si un héroe tiene mascota con PASSIVE_REVIVE y no la usó aún
      let revived = false;
      for (const p of participants.player) {
        if (!p.player_id || p.is_summon) continue;
        const reviveRes = await db.query(
          'SELECT pet_revive_used FROM combat_participants WHERE id = $1', [p.id]
        );
        if (reviveRes.rows[0]?.pet_revive_used) continue;
        const petB = await pets.getActivePetBonuses(p.player_id);
        if (!petB.passive_revive) continue;
        p.hp = Math.max(1, Math.round(Number(p.max_hp) * 0.30));
        await db.query(
          'UPDATE combat_participants SET hp = $1, pet_revive_used = TRUE WHERE id = $2',
          [p.hp, p.id]
        );
        revived = true;
        break;
      }
      if (!revived) {
        await finalizeSession(sessionId, 'ENEMY_WON', participants);
        return { ended: true, status: 'ENEMY_WON' };
      }
    }
    if (combat.isWiped(participants.enemy)) {
      await finalizeSession(sessionId, 'PLAYER_WON', participants);
      return { ended: true, status: 'PLAYER_WON' };
    }

    const sessionResult = await db.query('SELECT current_round FROM combat_sessions WHERE id = $1', [sessionId]);
    const round = sessionResult.rows[0].current_round;
    const lastActingSide = await getLastActingSide(sessionId, round);
    const side = combat.determineActingSide(participants.player, participants.enemy, lastActingSide);

    if (side === null) {
      await startNewRound(sessionId, participants);
      continue;
    }
    if (side === 'PLAYER') {
      const actor = combat.nextActor(participants.player);
      const ownerId = actor.player_id ?? actor.owner_player_id;
      const abandonedRes = await db.query(
        'SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]
      );
      const abandonedIds = abandonedRes.rows.map((r) => r.player_id);
      if (ownerId != null && abandonedIds.includes(ownerId)) {
        await resolveAbandonedPlayerTurn(sessionId, round, actor, participants);
        continue;
      }
      return { ended: false };
    }

    const actor = combat.nextActor(participants.enemy);

    // === IA de skills de monstruo ===
    let skillActionDone = false;
    if (actor.monster_code) {
      const monsterSkillsRes = await db.query(
        `SELECT s.*, ms.use_chance_percent
         FROM monster_skills ms
         JOIN skills s ON s.id = ms.skill_id
         WHERE ms.monster_id = (SELECT id FROM monsters WHERE code = $1)`,
        [actor.monster_code]
      );

      const aliveEnemies = participants.enemy.filter((p) => p.hp > 0);
      const deadEnemies = participants.enemy.filter((p) => p.hp <= 0);
      const alivePlayers = participants.player.filter((p) => p.hp > 0);
      const actorHpPct = actor.max_hp > 0 ? (actor.hp / actor.max_hp) * 100 : 0;
      const hasDeadAlly = deadEnemies.some((p) => p.id !== actor.id);
      const numAlivePlayers = alivePlayers.length;
      // Prioridad de skill según contexto táctico (menor = más urgente).
      // La IA prefiere curarse si está crítico, revivir aliados si está bien, debuffear
      // en rondas tempranas, AoE cuando hay múltiples objetivos, y atacar el resto del tiempo.
      // Si ninguna skill pasa su use_chance_percent, se hace ataque básico.
      const skillPriority = (s) => {
        if (s.skill_type === 'CURACION' && actorHpPct < 25) return 0;
        if (s.skill_type === 'ESPECIAL' && hasDeadAlly && actorHpPct > 35) return 1;
        if (s.skill_type === 'DEBUFF' && round <= 3) return 2;
        if (s.target_type === 'ALL_ENEMIES' && numAlivePlayers >= 2) return 3;
        if (s.skill_type === 'BUFF' && round <= 2) return 4;
        if (s.skill_type === 'ATAQUE') return 5;
        return 6;
      };
      const sortedSkills = monsterSkillsRes.rows.slice().sort((a, b) => skillPriority(a) - skillPriority(b));

      for (const skill of sortedSkills) {
        if (Number(actor.mana || 0) < Number(skill.mana_cost || 0)) continue;
        if (Math.random() * 100 >= Number(skill.use_chance_percent)) continue;

        let specialEffects = [];
        let isReviveSkill = false;
        if (skill.skill_type === 'ESPECIAL') {
          const effRes = await db.query(
            'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
            [skill.id]
          );
          specialEffects = effRes.rows;
          isReviveSkill = specialEffects.some((e) => e.effect_type === 'REVIVE');
        }

        let skillTargets = [];
        if (skill.target_type === 'SELF') {
          skillTargets = [actor];
        } else if (skill.target_type === 'ALLY') {
          if (isReviveSkill) {
            const dead = deadEnemies.filter((p) => p.id !== actor.id);
            if (!dead.length) continue;
            skillTargets = [dead[Math.floor(Math.random() * dead.length)]];
          } else {
            const others = aliveEnemies.filter((p) => p.id !== actor.id);
            if (!others.length) continue;
            skillTargets = [others[Math.floor(Math.random() * others.length)]];
          }
        } else if (skill.target_type === 'ALL_ALLIES') {
          skillTargets = aliveEnemies;
        } else if (skill.target_type === 'ENEMY') {
          if (!alivePlayers.length) continue;
          skillTargets = [alivePlayers[Math.floor(Math.random() * alivePlayers.length)]];
        } else if (skill.target_type === 'ALL_ENEMIES') {
          skillTargets = alivePlayers;
        }
        if (!skillTargets.length) continue;

        actor.mana = Math.max(0, (actor.mana || 0) - Number(skill.mana_cost || 0));
        const skillDescParts = [];

        if (['BUFF', 'DEBUFF'].includes(skill.skill_type)) {
          const isDebuff = skill.skill_type === 'DEBUFF';
          const buffEffects = await db.query(
            "SELECT effect_type, stat_code, percent_amount, duration_turns FROM skill_effects WHERE skill_id = $1 AND duration_turns IS NOT NULL",
            [skill.id]
          );
          for (const effect of buffEffects.rows) {
            if (effect.effect_type === 'STAT_MOD') {
              for (const t of skillTargets) {
                await applyStatModBuff(sessionId, t, effect, isDebuff, skillDescParts, skill.id);
              }
            } else if (effect.effect_type === 'HOT') {
              const pct = Number(effect.percent_amount || 0);
              const dur = Number(effect.duration_turns);
              for (const t of skillTargets) {
                await db.query(
                  "DELETE FROM combat_participant_buffs WHERE participant_id=$1 AND stat_code='HOT' AND skill_id=$2",
                  [t.id, skill.id]
                );
                await db.query(
                  "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'HOT',$3,$4,FALSE,$5)",
                  [sessionId, t.id, pct, dur, skill.id]
                );
                skillDescParts.push(`${t.name} regeneración: ${pct}% HP/turno (${dur}T)`);
              }
            }
          }
        } else if (skill.skill_type === 'ESTADO_ALTERADO') {
          const altEffects = await db.query(
            'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
            [skill.id]
          );
          for (const effect of altEffects.rows) {
            if (effect.effect_type === 'DOT') {
              const pct = Number(effect.percent_amount || 0);
              const dur = Number(effect.duration_turns);
              for (const t of skillTargets) {
                await db.query(
                  "DELETE FROM combat_participant_buffs WHERE participant_id=$1 AND stat_code='DOT' AND skill_id=$2",
                  [t.id, skill.id]
                );
                await db.query(
                  "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',$3,$4,TRUE,$5)",
                  [sessionId, t.id, pct, dur, skill.id]
                );
                skillDescParts.push(`${t.name} envenenado: ${pct}% HP/turno (${dur}T)`);
              }
            }
          }
        } else if (skill.skill_type === 'ESPECIAL') {
          for (const effect of specialEffects) {
            if (effect.effect_type === 'REVIVE') {
              const pct = Number(effect.percent_amount || 30);
              for (const t of skillTargets) {
                t.hp = Math.max(1, Math.round(Number(t.max_hp) * pct / 100));
                await persistParticipant(t);
                skillDescParts.push(`${t.name} revivido con ${t.hp} HP`);
              }
            } else if (effect.effect_type === 'CLEANSE') {
              for (const t of skillTargets) {
                const debuffRows = await db.query(
                  'SELECT * FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE',
                  [t.id]
                );
                for (const debuff of debuffRows.rows) {
                  const sc = debuff.stat_code;
                  if (sc !== 'DOT' && sc !== 'NO_DAMAGE' && !sc.startsWith('RESIST_') && !sc.startsWith('IMBUE_')) {
                    applyStatDelta(t, sc, -Number(debuff.applied_flat));
                  }
                }
                await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE', [t.id]);
                await persistParticipant(t);
                skillDescParts.push(`${t.name}: ${debuffRows.rows.length} debuff(s) eliminado(s)`);
              }
            } else if (effect.effect_type === 'STAT_MOD' && effect.duration_turns) {
              for (const t of skillTargets) {
                await applyStatModBuff(sessionId, t, effect, false, skillDescParts, skill.id);
              }
            }
          }
        } else if (['ATAQUE', 'CURACION'].includes(skill.skill_type)) {
          let elemModsByTargetId = {};
          if (skill.element_id) {
            const elemCode = await elements.getElementCodeById(skill.element_id);
            const damageBonusPercent = await elements.getMonsterElementalDamageBonus(actor.monster_code, skill.element_id);
            for (const t of skillTargets) {
              const baseResist = t.monster_code
                ? await elements.getMonsterElementResistance(t.monster_code, skill.element_id)
                : t.player_id
                  ? await elements.getPlayerElementResistance(t.player_id, skill.element_id)
                  : await elements.getClassElementResistance(t.class_id, skill.element_id);
              const tempResist = (elemCode && t.temp_resist?.[elemCode]) || 0;
              elemModsByTargetId[t.id] = { damageBonusPercent, resistancePercent: baseResist + tempResist };
            }
          }
          const results = combat.resolveSkill(actor, skillTargets, skill, elemModsByTargetId);
          for (const r of results) await persistParticipant(r.target);
          const verb = skill.skill_type === 'CURACION' ? 'cura' : 'daña';
          const summary = results.map((r) => (r.evaded ? `${r.target.name} esquiva` : `${r.target.name} por ${r.amount}${r.crit ? ' (¡crítico!)' : ''}`)).join(', ');
          skillDescParts.push(`${verb} a ${summary}`);
        }

        actor.has_acted_this_round = true;
        await persistParticipant(actor);
        await insertLog(sessionId, round, {
          actorId: actor.id,
          action: 'SKILL',
          targetId: skillTargets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${skillDescParts.join(', ') || 'sin efecto'}.`,
          hp_after: skillTargets[0]?.hp ?? null,
        });
        skillActionDone = true;
        break;
      }
    }

    if (!skillActionDone) {
    // Ataque básico
    const target = combat.pickRandomAliveTarget(participants.player);

    if (target.no_damage_window) {
      actor.has_acted_this_round = true;
      await persistParticipant(actor);
      await insertLog(sessionId, round, {
        actorId: actor.id,
        action: 'ATTACK',
        targetId: target.id,
        damage: 0,
        evaded: true,
        description: `${actor.name} ataca a ${target.name} pero el ataque no tiene efecto (invisible).`,
        hp_after: target.hp,
      });
      continue;
    }

    // Bono elemental propio del monstruo (ej. Dragon de Fuego, ver monsters.element_id) y
    // resistencia del jugador objetivo a ese elemento. Monstruos sin element_id (la mayoria)
    // pegan sin modificador, igual que antes.
    let elementalMods;
    if (actor.element_id) {
      const damageBonusPercent = await elements.getMonsterElementalDamageBonus(actor.monster_code, actor.element_id);
      const baseResist = target.player_id
        ? await elements.getPlayerElementResistance(target.player_id, actor.element_id)
        : await elements.getClassElementResistance(target.class_id, actor.element_id);
      const elemCode = await elements.getElementCodeById(actor.element_id);
      const tempResist = (elemCode && target.temp_resist?.[elemCode]) || 0;
      elementalMods = { damageBonusPercent, resistancePercent: baseResist + tempResist };
    }

    const result = combat.resolveAttack(actor, target, elementalMods);
    actor.has_acted_this_round = true;

    await persistParticipant(actor);
    await persistParticipant(target);
    await insertLog(sessionId, round, {
      actorId: actor.id,
      action: 'ATTACK',
      targetId: target.id,
      damage: result.damage,
      evaded: result.evaded,
      crit: result.crit,
      description: result.evaded
        ? `${actor.name} ataca a ${target.name} pero esquiva el golpe.`
        : `${actor.name} ataca a ${target.name} por ${result.damage} de daño${result.crit ? ' (¡crítico!)' : ''}.`,
      hp_after: target.hp,
    });
    } // end !skillActionDone
  }

  throw new Error('Combate excedió el límite de turnos automáticos');
}

async function fetchSessionState(sessionId) {
  const sessionResult = await db.query('SELECT * FROM combat_sessions WHERE id = $1', [sessionId]);
  if (!sessionResult.rows.length) return null;

  const [participants, abandonedRes] = await Promise.all([
    loadParticipants(sessionId),
    db.query('SELECT player_id FROM combat_abandoned_players WHERE session_id = $1', [sessionId]),
  ]);
  const abandonedIds = abandonedRes.rows.map((r) => r.player_id);

  const logResult = await db.query(
    `SELECT cl.id, cl.round, cl.action, cl.damage, cl.heal, cl.evaded, cl.crit, cl.success, cl.description,
            cl.hp_after, cl.mana_after, cl.actor_participant_id, cl.target_participant_id,
            a.name AS actor_name, t.name AS target_name
     FROM combat_log cl
     LEFT JOIN combat_participants a ON a.id = cl.actor_participant_id
     LEFT JOIN combat_participants t ON t.id = cl.target_participant_id
     WHERE cl.session_id = $1
     ORDER BY cl.id`,
    [sessionId]
  );

  let nextActor = null;
  if (sessionResult.rows[0].status === 'IN_PROGRESS') {
    const lastActingSide = await getLastActingSide(sessionId, sessionResult.rows[0].current_round);
    const side = combat.determineActingSide(participants.player, participants.enemy, lastActingSide);
    if (side === 'PLAYER') {
      nextActor = combat.nextActor(participants.player);
    }
  }

  const enrichedParticipants = participants.all.map((p) => ({
    ...p,
    is_ai_controlled: abandonedIds.includes(p.player_id ?? p.owner_player_id),
  }));

  return {
    session: sessionResult.rows[0],
    round: sessionResult.rows[0].current_round,
    participants: enrichedParticipants,
    log: logResult.rows,
    nextActorId: nextActor ? nextActor.id : null,
  };
}

// ---------- Endpoints ----------

// POST /api/combat/sessions
// body: { monsters: [{ code: 'LOBO_PRADERA', level: 9 }] }
// Carga al heroe + todos los NPCs activos del grupo del jugador como participantes PLAYER.
// POST /api/combat/zones/:zoneId/explore — genera encuentro aleatorio al explorar una zona
router.post('/zones/:zoneId/explore', async (req, res, next) => {
  try {
    const zoneResult = await db.query(
      `SELECT id, name, min_level, max_level FROM monster_zones WHERE id = $1`,
      [req.params.zoneId]
    );
    if (!zoneResult.rows.length) {
      return res.status(404).json({ error: 'Zona no encontrada' });
    }
    const zone = zoneResult.rows[0];

    const formationResult = await db.query(
      `SELECT p.level AS hero_level,
              COUNT(pn.id) AS npc_count,
              COALESCE(MAX(pn.level), 0) AS max_npc_level
       FROM players p
       LEFT JOIN player_party pp ON pp.player_id = p.id
       LEFT JOIN player_npcs pn ON pn.id = pp.npc_id AND pn.hp > 0
       WHERE p.id = $1
       GROUP BY p.level`,
      [req.playerId]
    );
    const { hero_level, npc_count, max_npc_level } = formationResult.rows[0];
    const formationSize = 1 + parseInt(npc_count, 10);
    const maxFormationLevel = Math.max(parseInt(hero_level, 10), parseInt(max_npc_level, 10));

    const minMonsterLevel = zone.min_level;
    const maxMonsterLevel = Math.min(maxFormationLevel + 1, zone.max_level);

    // Decide rareza del encuentro: LEGENDARY 5%, MINIBOSS 10%, RARE 25%, COMMON 60%
    const roll = Math.random() * 100;
    let targetRarity = roll < 5 ? 'LEGENDARY' : roll < 15 ? 'MINIBOSS' : roll < 40 ? 'RARE' : 'COMMON';

    let eligible = await db.query(
      `SELECT code, min_spawn_level, max_spawn_level, rarity
       FROM monsters
       WHERE zone_id = $1 AND rarity = $2
         AND min_spawn_level <= $3 AND max_spawn_level >= $4`,
      [zone.id, targetRarity, maxMonsterLevel, minMonsterLevel]
    );

    // Si no hay de esa rareza, baja a COMMON
    if (!eligible.rows.length) {
      eligible = await db.query(
        `SELECT code, min_spawn_level, max_spawn_level, rarity
         FROM monsters
         WHERE zone_id = $1 AND rarity = 'COMMON'
           AND min_spawn_level <= $2 AND max_spawn_level >= $3`,
        [zone.id, maxMonsterLevel, minMonsterLevel]
      );
    }

    if (!eligible.rows.length) {
      return res.status(400).json({ error: 'No hay monstruos disponibles en esta zona para tu nivel' });
    }

    // Cantidad de monstruos según rareza y tamaño de formación
    const actualRarity = eligible.rows[0].rarity;
    let monsterCount;
    if (actualRarity === 'LEGENDARY' || actualRarity === 'MINIBOSS') {
      monsterCount = 1;
    } else if (actualRarity === 'RARE') {
      monsterCount = formationSize === 1 ? 1 : Math.floor(Math.random() * 2) + 1;
    } else {
      const maxCount = formationSize === 1 ? 2 : 3;
      monsterCount = Math.floor(Math.random() * maxCount) + 1;
    }

    // Elige monstruos aleatorios con nivel dentro del rango válido
    const monsterSpecs = [];
    for (let i = 0; i < monsterCount; i++) {
      const m = eligible.rows[Math.floor(Math.random() * eligible.rows.length)];
      const lo = Math.max(m.min_spawn_level, minMonsterLevel);
      const hi = Math.min(m.max_spawn_level, maxMonsterLevel);
      const level = lo + Math.floor(Math.random() * (hi - lo + 1));
      monsterSpecs.push({ code: m.code, level });
    }

    // ─── Co-op: cargar combatientes de hasta 2 compañeros si vienen coopPartnerIds ───
    const coopPartnerIds = Array.isArray(req.body?.coopPartnerIds)
      ? [...new Set(req.body.coopPartnerIds.map(Number))].filter((id) => id !== req.playerId)
      : [];

    for (const pid of [req.playerId, ...coopPartnerIds]) {
      if (await hasAbandonedActiveSession(pid)) {
        return res.status(400).json({
          error: 'Todavía tenés (o tu compañero tiene) un combate anterior en curso que la IA está resolviendo. Esperen a que termine.',
        });
      }
    }

    if (coopPartnerIds.length) {
      const allPlayerIds = [req.playerId, ...coopPartnerIds];
      const groupCheck = await db.query(
        `SELECT gm.group_id
         FROM player_coop_group_members gm
         WHERE gm.player_id = ANY($1::int[])
         GROUP BY gm.group_id
         HAVING COUNT(DISTINCT gm.player_id) = $2`,
        [allPlayerIds, allPlayerIds.length]
      );
      if (!groupCheck.rows.length) {
        return res.status(403).json({ error: 'No estás en el mismo grupo co-op que esos jugadores' });
      }

      const [allCombatants, enemyCombatants, ...npcLists] = await Promise.all([
        hydratePlayers(allPlayerIds),
        hydrateMonsters(monsterSpecs),
        ...allPlayerIds.map((id) => hydratePartyNpcs(id, id, 1)),
      ]);

      const aliveCombatants = allCombatants.filter((p) => p.hp > 0);
      const aliveNpcs = npcLists.flat().filter((n) => n.hp > 0);

      if (!aliveCombatants.length && !aliveNpcs.length) {
        return res.status(400).json({ error: 'Toda la formación está derrotada.' });
      }

      const sessionResult = await db.query(
        'INSERT INTO combat_sessions(guest_player_id, guest_player_id_2) VALUES($1,$2) RETURNING *',
        [coopPartnerIds[0] ?? null, coopPartnerIds[1] ?? null]
      );
      const sessionId = sessionResult.rows[0].id;

      await insertParticipants(sessionId, [...aliveCombatants, ...aliveNpcs, ...enemyCombatants]);
      await advanceEnemyTurns(sessionId);
      const state = await fetchSessionState(sessionId);
      return res.status(201).json({ ...state, coopPartnerIds });
    }

    const [playerCombatants, npcCombatants, enemyCombatants] = await Promise.all([
      hydratePlayers([req.playerId]),
      hydratePartyNpcs(req.playerId, req.playerId),
      hydrateMonsters(monsterSpecs),
    ]);

    const aliveHero = playerCombatants.filter((p) => p.hp > 0);
    const aliveNpcs = npcCombatants.filter((n) => n.hp > 0);

    if (aliveHero.length === 0 && aliveNpcs.length === 0) {
      return res.status(400).json({ error: 'Toda tu formación está derrotada. Ve al gremio a curarte.' });
    }

    const sessionResult = await db.query("INSERT INTO combat_sessions DEFAULT VALUES RETURNING *");
    const sessionId = sessionResult.rows[0].id;

    await insertParticipants(sessionId, [...aliveHero, ...aliveNpcs, ...enemyCombatants]);
    await advanceEnemyTurns(sessionId);

    const state = await fetchSessionState(sessionId);
    res.status(201).json(state);
  } catch (err) {
    next(err);
  }
});

// POST /api/combat/sessions — inicia combate con monstruos específicos (NPC battles, boss manual, etc.)
router.post('/sessions', async (req, res, next) => {
  const { monsters } = req.body;
  const playerIds = [req.playerId];

  if (!Array.isArray(monsters) || monsters.length < 1 || monsters.length > 3) {
    return res.status(400).json({ error: 'monsters debe tener entre 1 y 3 (formato: { code, level })' });
  }

  try {
    if (await hasAbandonedActiveSession(req.playerId)) {
      return res.status(400).json({ error: 'Todavía tenés un combate anterior en curso que la IA está resolviendo. Esperá a que termine.' });
    }

    const [playerCombatants, npcCombatants, enemyCombatants] = await Promise.all([
      hydratePlayers(playerIds),
      hydratePartyNpcs(req.playerId),
      hydrateMonsters(monsters),
    ]);

    if (playerCombatants.length !== playerIds.length) {
      return res.status(404).json({ error: 'Algún jugador no fue encontrado' });
    }
    if (enemyCombatants.length !== monsters.length) {
      return res.status(404).json({ error: 'Algún monstruo no fue encontrado' });
    }
    const aliveHero = playerCombatants.filter((p) => p.hp > 0);
    const aliveNpcs = npcCombatants.filter((n) => n.hp > 0);

    if (aliveHero.length === 0 && aliveNpcs.length === 0) {
      return res.status(400).json({ error: 'Toda tu formación está derrotada. Ve al gremio a curarte.' });
    }

    const sessionResult = await db.query("INSERT INTO combat_sessions DEFAULT VALUES RETURNING *");
    const sessionId = sessionResult.rows[0].id;

    await insertParticipants(sessionId, [...aliveHero, ...aliveNpcs, ...enemyCombatants]);
    await advanceEnemyTurns(sessionId);

    const state = await fetchSessionState(sessionId);
    res.status(201).json(state);
  } catch (error) {
    next(error);
  }
});

// GET /api/combat/sessions/active — sesión ACTIVE del jugador autenticado, si existe
router.get('/sessions/active', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT cs.id FROM combat_sessions cs
       JOIN combat_participants cp ON cp.session_id = cs.id
       WHERE cs.status = 'IN_PROGRESS' AND cp.player_id = $1
       LIMIT 1`,
      [req.playerId]
    );
    if (!result.rows.length) return res.json(null);
    await advanceEnemyTurns(result.rows[0].id);
    const state = await fetchSessionState(result.rows[0].id);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

// GET /api/combat/sessions/:id
router.get('/sessions/:id', async (req, res, next) => {
  try {
    const ownershipRes = await db.query(
      `SELECT 1 FROM combat_participants WHERE session_id = $1 AND player_id = $2 LIMIT 1`,
      [req.params.id, req.playerId]
    );
    if (!ownershipRes.rows.length) return res.status(404).json({ error: 'Sesión de combate no encontrada' });
    await advanceEnemyTurns(req.params.id);
    const state = await fetchSessionState(req.params.id);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

// GET /api/combat/sessions/:id/log — historial de turnos de una sesión
router.get('/sessions/:id/log', async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    const sessionRes = await db.query(
      `SELECT cs.id, cs.status FROM combat_sessions cs
       JOIN combat_participants cp ON cp.session_id = cs.id
       WHERE cs.id = $1 AND cp.player_id = $2
       LIMIT 1`,
      [sessionId, req.playerId]
    );
    if (!sessionRes.rows.length) return res.status(404).json({ error: 'Sesión no encontrada o no te pertenece' });

    const logRes = await db.query(
      `SELECT cl.round, cl.action, cl.damage, cl.heal, cl.evaded, cl.crit, cl.success,
              cl.description, cl.created_at,
              actor.name AS actor_name, actor.side AS actor_side,
              target.name AS target_name
       FROM combat_log cl
       LEFT JOIN combat_participants actor ON actor.id = cl.actor_participant_id
       LEFT JOIN combat_participants target ON target.id = cl.target_participant_id
       WHERE cl.session_id = $1
       ORDER BY cl.id ASC`,
      [sessionId]
    );
    res.json({ sessionId: Number(sessionId), status: sessionRes.rows[0].status, log: logRes.rows });
  } catch (error) {
    next(error);
  }
});

// POST /api/combat/sessions/:id/action
// body: { participantId, action: 'ATTACK'|'DEFEND'|'ESCAPE'|'USE_ITEM', targetParticipantId?, itemId? }
router.post('/sessions/:id/action', async (req, res, next) => {
  const sessionId = req.params.id;
  const { participantId, action, targetParticipantId, itemId } = req.body;

  if (!['ATTACK', 'DEFEND', 'ESCAPE', 'USE_ITEM', 'SKILL'].includes(action)) {
    return res.status(400).json({ error: 'action debe ser ATTACK, DEFEND, ESCAPE, USE_ITEM o SKILL' });
  }

  try {
    const sessionResult = await db.query('SELECT * FROM combat_sessions WHERE id = $1', [sessionId]);
    if (!sessionResult.rows.length) return res.status(404).json({ error: 'Sesión de combate no encontrada' });
    const session = sessionResult.rows[0];
    if (session.status !== 'IN_PROGRESS') {
      return res.status(400).json({ error: `La pelea ya terminó (${session.status})` });
    }

    const participants = await loadParticipants(sessionId);
    const lastActingSide = await getLastActingSide(sessionId, session.current_round);
    const side = combat.determineActingSide(participants.player, participants.enemy, lastActingSide);

    if (side !== 'PLAYER') {
      return res.status(400).json({ error: 'No es el turno del jugador' });
    }

    const expectedActor = combat.nextActor(participants.player);
    const actor = participants.player.find((p) => p.id === Number(participantId));

    if (!actor || !expectedActor || actor.id !== expectedActor.id) {
      return res.status(400).json({ error: 'No es el turno de ese personaje' });
    }
    if (actor.player_id !== null && actor.player_id !== req.playerId) {
      return res.status(403).json({ error: 'No podés actuar por un personaje que no es tuyo' });
    }
    // Co-op: en sesiones con dos jugadores, el NPC pertenece a uno solo.
    if (actor.player_id === null && actor.owner_player_id !== null && actor.owner_player_id !== req.playerId) {
      return res.status(403).json({ error: 'Ese NPC pertenece a tu compañero' });
    }

    const actorPetBonuses = actor.player_id === req.playerId
      ? await pets.getActivePetBonuses(req.playerId)
      : null;

    let logEntry;

    if (action === 'ATTACK') {
      const target = targetParticipantId
        ? participants.enemy.find((e) => e.id === Number(targetParticipantId) && e.hp > 0)
        : combat.pickRandomAliveTarget(participants.enemy);
      if (!target) return res.status(400).json({ error: 'Objetivo inválido' });

      if (target.no_damage_window) {
        logEntry = {
          actorId: actor.id, action,
          targetId: target.id,
          damage: 0, evaded: true,
          description: `${actor.name} ataca a ${target.name} pero no tiene efecto (invisible).`,
          hp_after: target.hp, mana_after: actor.mana,
        };
      } else {

      let attackElementalMods;
      let attackImbueElemCode = null;
      if (actor.imbued_element_id) {
        // Clase del actor: para héroe está en players, para NPC en combat_participants.class_id
        let actorClassId = actor.class_id;
        if (!actorClassId && actor.player_id) {
          const pRes = await db.query(
            'SELECT COALESCE(evolution_class_id, current_class_id) AS class_id FROM players WHERE id = $1',
            [actor.player_id]
          );
          actorClassId = pRes.rows[0]?.class_id || null;
        }
        const classElemBonus = actorClassId
          ? await elements.getClassElementalDamageBonus(actorClassId, actor.imbued_element_id)
          : 0;
        const damageBonusPercent = classElemBonus + Number(actor.imbued_damage_bonus || 0);
        const baseResistance = target.monster_code
          ? await elements.getMonsterElementResistance(target.monster_code, actor.imbued_element_id)
          : target.player_id
            ? await elements.getPlayerElementResistance(target.player_id, actor.imbued_element_id)
            : await elements.getClassElementResistance(target.class_id, actor.imbued_element_id);
        attackImbueElemCode = await elements.getElementCodeById(actor.imbued_element_id);
        const targetTempResist = (attackImbueElemCode && target.temp_resist?.[attackImbueElemCode]) || 0;
        attackElementalMods = { damageBonusPercent, resistancePercent: baseResistance + targetTempResist };
      }

      let attackBonusPercent = 0;
      const isMagicAttack = (actor.mag || 0) > (actor.atk || 0);
      if (actor.player_id === req.playerId) {
        const playerBonuses = await achievements.getPlayerBonuses(req.playerId);
        attackBonusPercent += isMagicAttack ? playerBonuses.magicalDamage : playerBonuses.physicalDamage;
        if (attackImbueElemCode) {
          attackBonusPercent += playerBonuses.elementalDamage;
          attackBonusPercent += playerBonuses.elementDamage[attackImbueElemCode] || 0;
        }
        if (target.monster_code) {
          const catRes = await db.query('SELECT category FROM monsters WHERE code = $1', [target.monster_code]);
          attackBonusPercent += playerBonuses.categoryDamage[catRes.rows[0]?.category] || 0;
        }
        if (actorPetBonuses) {
          attackBonusPercent += isMagicAttack ? actorPetBonuses.magical_damage : actorPetBonuses.physical_damage;
          if (attackImbueElemCode) attackBonusPercent += actorPetBonuses.elemental_damage;
        }
      }
      // Bonuses de pasivas de clase (aplican a cualquier actor PLAYER, incluyendo NPCs)
      if (isMagicAttack) attackBonusPercent += Number(actor.magic_damage_bonus || 0);
      else attackBonusPercent += Number(actor.physical_damage_bonus || 0);
      if (attackImbueElemCode) attackBonusPercent += Number(actor.elemental_damage_bonus || 0);

      const result = combat.resolveAttack(actor, target, attackElementalMods, attackBonusPercent);
      await persistParticipant(target);
      logEntry = {
        actorId: actor.id,
        action,
        targetId: target.id,
        damage: result.damage,
        evaded: result.evaded,
        crit: result.crit,
        description: result.evaded
          ? `${actor.name} ataca a ${target.name} pero esquiva el golpe.`
          : `${actor.name} ataca a ${target.name} por ${result.damage} de daño${attackElementalMods ? ' elemental' : ''}${result.crit ? ' (¡crítico!)' : ''}.`,
        hp_after: target.hp, mana_after: actor.mana,
      };
      } // end else (no_damage_window)
    } else if (action === 'SKILL') {
      const { skillId } = req.body;
      if (!skillId) return res.status(400).json({ error: 'skillId es requerido para SKILL' });

      const skillResult = await db.query('SELECT * FROM skills WHERE id = $1', [skillId]);
      if (!skillResult.rows.length) return res.status(404).json({ error: 'Skill no encontrada' });
      const skill = skillResult.rows[0];

      if (skill.is_passive || skill.skill_type === 'PASIVA') {
        return res.status(400).json({ error: 'Esa habilidad es pasiva y siempre está activa.' });
      }
      if (!['ATAQUE', 'CURACION', 'BUFF', 'DEBUFF', 'ESTADO_ALTERADO', 'ESPECIAL'].includes(skill.skill_type)) {
        return res.status(400).json({ error: 'Esa habilidad todavía no está disponible en combate.' });
      }

      let actorClassId;

      if (actor.npc_id) {
        // NPCs: skills con class_id = NULL son universales (cualquier NPC puede usarlas si tiene nivel)
        if (skill.class_id !== null && actor.class_id !== skill.class_id) {
          return res.status(400).json({ error: 'Esa habilidad no es de la clase de este NPC' });
        }
        const npcLvlRes = await db.query('SELECT level FROM player_npcs WHERE id = $1', [actor.npc_id]);
        if (!npcLvlRes.rows.length) return res.status(400).json({ error: 'NPC no encontrado' });
        const npcMeetsLevel = npcLvlRes.rows[0].level >= (skill.learn_level || 1);
        if (!npcMeetsLevel) {
          const npcSkillRow = await db.query(
            'SELECT 1 FROM npc_skills WHERE npc_id = $1 AND skill_id = $2',
            [actor.npc_id, skillId]
          );
          if (!npcSkillRow.rows.length) {
            return res.status(400).json({ error: `Este NPC necesita nivel ${skill.learn_level} para usar esa habilidad` });
          }
        }
        actorClassId = actor.class_id;
      } else {
        const playerRowResult = await db.query(
          'SELECT current_class_id, evolution_class_id, level FROM players WHERE id = $1',
          [actor.player_id]
        );
        const playerRow = playerRowResult.rows[0];
        // class_id = NULL → skill universal, cualquier clase puede usarla
        if (skill.class_id !== null) {
          const knownClassIds = [playerRow.current_class_id, playerRow.evolution_class_id].filter(Boolean);
          if (!knownClassIds.includes(skill.class_id)) {
            return res.status(400).json({ error: 'Esa habilidad no es de tu clase' });
          }
        }
        const unlockedByLevel = skill.learn_method === 'LEVEL' && playerRow.level >= (skill.learn_level || 1);
        if (!unlockedByLevel) {
          const learned = await db.query(
            'SELECT 1 FROM player_skills WHERE player_id = $1 AND skill_id = $2',
            [actor.player_id, skillId]
          );
          if (!learned.rows.length) return res.status(400).json({ error: 'Todavía no aprendiste esa habilidad' });
        }
        actorClassId = playerRow.evolution_class_id || playerRow.current_class_id;
      }

      if (actor.mana < skill.mana_cost) {
        return res.status(400).json({ error: `No te alcanza el maná (necesitás ${skill.mana_cost})` });
      }

      // Efectos de skills ESPECIAL necesarios antes de seleccionar objetivo (REVIVE apunta a muertos)
      let specialEffects = [];
      if (skill.skill_type === 'ESPECIAL') {
        const r = await db.query(
          'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
          [skillId]
        );
        specialEffects = r.rows;
      }
      const isReviveSkill   = specialEffects.some((e) => e.effect_type === 'REVIVE');
      const hasSummonEffect = specialEffects.some((e) => e.effect_type === 'SUMMON');

      // Validación anticipada: no puede haber dos invocados del mismo invocador a la vez
      if (hasSummonEffect) {
        const existingSummon = participants.player.find(
          (p) => p.is_summon && Number(p.summoner_id) === actor.id && p.hp > 0
        );
        if (existingSummon) {
          return res.status(400).json({ error: `${existingSummon.name} ya está activo. Espera a que expire o muera.` });
        }
      }

      let targets;
      if (skill.target_type === 'SELF') {
        targets = [actor];
      } else if (skill.target_type === 'ALLY') {
        if (isReviveSkill) {
          const deadAlly = targetParticipantId
            ? participants.player.find((p) => p.id === Number(targetParticipantId) && p.hp === 0)
            : participants.player.find((p) => p.hp === 0);
          targets = deadAlly ? [deadAlly] : [];
        } else {
          const ally = targetParticipantId
            ? participants.player.find((p) => p.id === Number(targetParticipantId) && p.hp > 0)
            : actor;
          targets = ally ? [ally] : [];
        }
      } else if (skill.target_type === 'ALL_ALLIES') {
        targets = participants.player.filter((p) => p.hp > 0);
      } else if (skill.target_type === 'ALL_ENEMIES') {
        targets = participants.enemy.filter((e) => e.hp > 0);
      } else {
        const enemy = targetParticipantId
          ? participants.enemy.find((e) => e.id === Number(targetParticipantId) && e.hp > 0)
          : combat.pickRandomAliveTarget(participants.enemy);
        targets = enemy ? [enemy] : [];
      }
      if (!targets.length) return res.status(400).json({ error: 'Objetivo inválido' });

      const manaCostReduction = actorPetBonuses ? actorPetBonuses.mana_cost_reduction : 0;
      const effectiveManaCost = Math.max(0, Math.ceil(skill.mana_cost * (1 - manaCostReduction / 100)));
      actor.mana -= effectiveManaCost;

      // Bono elemental del atacante (por clase) y resistencia de cada objetivo. Para objetivos
      // NPC (player_id = null) se usa class_id guardado en combat_participants.
      let elementalModsByTargetId = {};
      let skillElemCode = null;
      if (skill.element_id) {
        const damageBonusPercent = (await elements.getClassElementalDamageBonus(actorClassId, skill.element_id))
          + Number(actor.elemental_damage_bonus || 0);
        skillElemCode = await elements.getElementCodeById(skill.element_id);
        for (const t of targets) {
          const baseResist = t.monster_code
            ? await elements.getMonsterElementResistance(t.monster_code, skill.element_id)
            : t.player_id
              ? await elements.getPlayerElementResistance(t.player_id, skill.element_id)
              : await elements.getClassElementResistance(t.class_id, skill.element_id);
          const tempResist = (skillElemCode && t.temp_resist?.[skillElemCode]) || 0;
          elementalModsByTargetId[t.id] = { damageBonusPercent, resistancePercent: baseResist + tempResist };
        }
      }

      // Daño condicional y crítico garantizado para skills ATAQUE
      if (skill.skill_type === 'ATAQUE') {
        const atkSpecialRes = await db.query(
          `SELECT effect_type, stat_code, percent_amount, condition_stat, condition_comparison, condition_value
           FROM skill_effects WHERE skill_id = $1 AND effect_type IN ('CONDITIONAL_DAMAGE', 'GUARANTEED_CRIT')`,
          [skillId]
        );
        for (const effect of atkSpecialRes.rows) {
          for (const t of targets) {
            const mods = elementalModsByTargetId[t.id] || {};
            if (effect.effect_type === 'GUARANTEED_CRIT') {
              mods.guaranteedCrit = true;
            } else if (effect.effect_type === 'CONDITIONAL_DAMAGE') {
              const tStatVal = getParticipantStat(t, effect.condition_stat);
              const condVal = Number(effect.condition_value);
              const op = effect.condition_comparison;
              const met = op === '<' ? tStatVal < condVal
                : op === '>' ? tStatVal > condVal
                : op === '<=' ? tStatVal <= condVal
                : op === '>=' ? tStatVal >= condVal
                : op === '=' ? tStatVal === condVal : false;
              if (met) mods.conditionalBonusPercent = (mods.conditionalBonusPercent || 0) + Number(effect.percent_amount || 0);
            }
            elementalModsByTargetId[t.id] = mods;
          }
        }
      }

      if (['BUFF', 'DEBUFF'].includes(skill.skill_type)) {
        const isDebuff = skill.skill_type === 'DEBUFF';
        const effectsResult = await db.query(
          `SELECT effect_type, stat_code, percent_amount, duration_turns FROM skill_effects
           WHERE skill_id = $1 AND duration_turns IS NOT NULL`,
          [skillId]
        );
        const buffDescParts = [];
        for (const effect of effectsResult.rows) {
          if (effect.effect_type === 'STAT_MOD') {
            for (const target of targets) {
              await applyStatModBuff(sessionId, target, effect, isDebuff, buffDescParts, skillId);
            }
          } else if (effect.effect_type === 'HOT') {
            const pct = Number(effect.percent_amount || 0);
            const dur = Number(effect.duration_turns);
            for (const target of targets) {
              await db.query(
                "DELETE FROM combat_participant_buffs WHERE participant_id=$1 AND stat_code='HOT' AND skill_id=$2",
                [target.id, skillId]
              );
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'HOT',$3,$4,FALSE,$5)",
                [sessionId, target.id, pct, dur, skillId]
              );
              buffDescParts.push(`${target.name} regeneración: ${pct}% HP/turno (${dur}T)`);
            }
          }
        }
        logEntry = {
          actorId: actor.id, action,
          targetId: targets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${buffDescParts.join(', ') || 'sin efecto'}.`,
        };
      } else if (skill.skill_type === 'ESTADO_ALTERADO') {
        const altEffectsRes = await db.query(
          'SELECT effect_type, stat_code, percent_amount, flat_amount, duration_turns FROM skill_effects WHERE skill_id = $1',
          [skillId]
        );
        const altDescParts = [];
        for (const effect of altEffectsRes.rows) {
          if (effect.effect_type === 'DOT') {
            const pct = Number(effect.percent_amount || 0);
            const dur = Number(effect.duration_turns);
            for (const target of targets) {
              await db.query(
                "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'DOT' AND skill_id = $2",
                [target.id, skillId]
              );
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'DOT',$3,$4,TRUE,$5)",
                [sessionId, target.id, pct, dur, skillId]
              );
              altDescParts.push(`${target.name} envenenado: ${pct}% HP/turno (${dur}T)`);
            }
          } else if (effect.effect_type === 'STAT_MOD' && effect.duration_turns) {
            for (const target of targets) {
              await applyStatModBuff(sessionId, target, effect, true, altDescParts, skillId);
            }
          }
        }
        logEntry = {
          actorId: actor.id, action,
          targetId: targets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${altDescParts.join(', ') || 'sin efecto'}.`,
        };
      } else if (skill.skill_type === 'ESPECIAL') {
        // specialEffects ya fue cargado antes de la selección de objetivo
        const espDescParts = [];
        for (const effect of specialEffects) {
          if (effect.effect_type === 'REVIVE') {
            const pct = Number(effect.percent_amount || 30);
            for (const target of targets) {
              target.hp = Math.max(1, Math.round(Number(target.max_hp) * pct / 100));
              await persistParticipant(target);
              espDescParts.push(`${target.name} revivido con ${target.hp} HP`);
            }
          } else if (effect.effect_type === 'CLEANSE') {
            for (const target of targets) {
              const debuffRows = await db.query(
                'SELECT * FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE',
                [target.id]
              );
              for (const debuff of debuffRows.rows) {
                const sc = debuff.stat_code;
                if (sc !== 'DOT' && sc !== 'NO_DAMAGE' && !sc.startsWith('RESIST_') && !sc.startsWith('IMBUE_')) {
                  applyStatDelta(target, sc, -Number(debuff.applied_flat));
                }
              }
              await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE', [target.id]);
              await persistParticipant(target);
              espDescParts.push(`${target.name}: ${debuffRows.rows.length} debuff(s) eliminado(s)`);
            }
          } else if (effect.effect_type === 'NO_DAMAGE_WINDOW') {
            const dur = Number(effect.duration_turns || 1);
            for (const target of targets) {
              await db.query(
                "DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'NO_DAMAGE' AND skill_id = $2",
                [target.id, skillId]
              );
              await db.query(
                "INSERT INTO combat_participant_buffs(session_id,participant_id,stat_code,applied_flat,rounds_remaining,is_debuff,skill_id) VALUES($1,$2,'NO_DAMAGE',0,$3,FALSE,$4)",
                [sessionId, target.id, dur, skillId]
              );
              target.no_damage_window = true;
              espDescParts.push(`${target.name} invisible por ${dur} turno(s)`);
            }
          } else if (effect.effect_type === 'STAT_MOD' && effect.duration_turns) {
            for (const target of targets) {
              await applyStatModBuff(sessionId, target, effect, false, espDescParts, skillId);
            }
          } else if (effect.effect_type === 'SUMMON') {
            const { summon, auraStrength } = await createSummonParticipant(sessionId, actor, effect, skill, participants);
            const elemCode = skill.element_id ? await elements.getElementCodeById(skill.element_id) : null;
            espDescParts.push(`¡${summon.name} invocado! Atacará ${effect.duration_turns} rondas. Equipo +${auraStrength}% resist ${elemCode || ''}.`);
          }
        }
        logEntry = {
          actorId: actor.id, action,
          targetId: targets[0]?.id || null,
          description: `${actor.name} usa ${skill.name}: ${espDescParts.join(', ') || 'sin efecto'}.`,
          mana_after: actor.mana,
        };
      } else {
        let categoryBonusByTargetId = {};
        if (skill.skill_type === 'ATAQUE') {
          // Bonus de clase pasiva: físico aplica a cualquier actor; mágico ya está en resolveSkillHit
          let baseSkillBonus = 0;
          if (skill.damage_school === 'FISICO') baseSkillBonus += Number(actor.physical_damage_bonus || 0);

          if (actor.player_id === req.playerId) {
            const playerBonuses = await achievements.getPlayerBonuses(req.playerId);
            if (skill.damage_school === 'FISICO') baseSkillBonus += playerBonuses.physicalDamage;
            else if (skill.damage_school === 'MAGICO') baseSkillBonus += playerBonuses.magicalDamage;
            if (skillElemCode) {
              baseSkillBonus += playerBonuses.elementalDamage;
              baseSkillBonus += playerBonuses.elementDamage[skillElemCode] || 0;
            }
            if (actorPetBonuses) {
              if (skill.damage_school === 'FISICO') baseSkillBonus += actorPetBonuses.physical_damage;
              else if (skill.damage_school === 'MAGICO') baseSkillBonus += actorPetBonuses.magical_damage;
              if (skillElemCode) baseSkillBonus += actorPetBonuses.elemental_damage;
            }
            for (const t of targets) {
              let targetBonus = baseSkillBonus;
              if (t.monster_code) {
                const catRes = await db.query('SELECT category FROM monsters WHERE code = $1', [t.monster_code]);
                targetBonus += playerBonuses.categoryDamage[catRes.rows[0]?.category] || 0;
              }
              if (targetBonus) categoryBonusByTargetId[t.id] = targetBonus;
            }
          } else if (baseSkillBonus > 0) {
            for (const t of targets) categoryBonusByTargetId[t.id] = baseSkillBonus;
          }
        }

        const results = combat.resolveSkill(actor, targets, skill, elementalModsByTargetId, categoryBonusByTargetId);

        // Bonus de curación de clase pasiva (HEAL_BONUS % sobre el total curado)
        if (skill.skill_type === 'CURACION' && Number(actor.heal_bonus || 0) > 0) {
          for (const r of results) {
            const extra = Math.round(r.amount * Number(actor.heal_bonus) / 100);
            if (extra > 0) {
              r.amount += extra;
              r.target.hp = Math.min(Number(r.target.max_hp), r.target.hp + extra);
            }
          }
        }

        for (const r of results) await persistParticipant(r.target);

        const verb = skill.skill_type === 'CURACION' ? 'cura' : 'daña';
        const summary = results
          .map((r) => (r.evaded ? `${r.target.name} esquiva` : `${r.target.name} por ${r.amount}${r.crit ? ' (¡crítico!)' : ''}`))
          .join(', ');

        const totalAmount = results.reduce((sum, r) => sum + r.amount, 0);
        logEntry = {
          actorId: actor.id,
          action,
          targetId: results[0].target.id,
          damage: skill.skill_type === 'CURACION' ? null : totalAmount,
          heal: skill.skill_type === 'CURACION' ? totalAmount : null,
          evaded: results.every((r) => r.evaded),
          crit: results.some((r) => r.crit),
          description: `${actor.name} usa ${skill.name}: ${verb} a ${summary}.`,
          hp_after: results[0].target.hp,
          mana_after: actor.mana,
        };
      }
    } else if (action === 'DEFEND') {
      actor.is_defending = true;
      logEntry = { actorId: actor.id, action, description: `${actor.name} se pone en guardia.`, mana_after: actor.mana };
    } else if (action === 'ESCAPE') {
      if (!actor.player_id) {
        return res.status(400).json({ error: 'Solo el héroe puede intentar escapar' });
      }
      const petEscapeBonus = actorPetBonuses ? actorPetBonuses.escape_bonus : 0;
      const chance = Math.min(90, combat.escapeChance(actor, participants.enemy) + petEscapeBonus);
      const success = Math.random() * 100 < chance;

      if (success) {
        actor.has_acted_this_round = true;
        await persistParticipant(actor);
        await insertLog(sessionId, session.current_round, {
          actorId: actor.id,
          action,
          success: true,
          description: `${actor.name} escapa del combate. El grupo huye.`,
        });
        const rewards = await finalizeSession(sessionId, 'ESCAPED', participants);
        const state = await fetchSessionState(sessionId);
        return res.json({ ...state, rewards });
      }

      logEntry = { actorId: actor.id, action, success: false, description: `${actor.name} intenta escapar pero falla.`, mana_after: actor.mana };
    } else if (action === 'USE_ITEM') {
      if (!itemId) return res.status(400).json({ error: 'itemId es requerido para USE_ITEM' });

      // Si el actor es un NPC (player_id = null), el inventario pertenece al jugador dueño.
      const itemOwnerId = actor.player_id ?? req.playerId;
      const bestTier = await inventory.getBestQualityTier(itemOwnerId, itemId);
      const have = await inventory.getQuantity(itemOwnerId, itemId, 0, bestTier);
      if (have < 1) return res.status(400).json({ error: 'No tienes ese item' });

      const targetParticipant = targetParticipantId
        ? participants.player.find((p) => p.id === Number(targetParticipantId))
        : actor;
      if (!targetParticipant) return res.status(400).json({ error: 'Objetivo inválido' });

      const bonuses = await db.query(
        'SELECT stat_code, amount, is_percent, duration_turns FROM item_stat_bonuses WHERE item_id = $1',
        [itemId]
      );
      const itemNameResult = await db.query('SELECT name FROM items WHERE id = $1', [itemId]);
      const itemName = itemNameResult.rows[0] ? itemNameResult.rows[0].name : 'item';

      // Multiplicador por quality_tier del item crafteado con suerte
      const QUALITY_TIER_MULTIPLIER = [1.0, 1.15, 1.35, 1.60, 2.0];
      const qualityMult = QUALITY_TIER_MULTIPLIER[bestTier] ?? 1;

      const BUFF_STAT_MAP = { BUFF_ATK: 'ATQ', BUFF_DEF: 'DEF', BUFF_MAG: 'MAG', BUFF_SPD: 'VEL' };
      const BUFF_STAT_KEY = { BUFF_ATK: 'atk', BUFF_DEF: 'def', BUFF_MAG: 'mag', BUFF_SPD: 'spd' };
      let hpRestored = 0;
      let manaRestored = 0;
      const buffParts = [];
      for (const bonus of bonuses.rows) {
        const amount = Math.round(Number(bonus.amount) * qualityMult);
        if (bonus.stat_code === 'HOT' && bonus.duration_turns) {
          // Regen por ronda con duración. quality_tier sube el % Y extiende 1 ronda por tier.
          const hotDuration = Number(bonus.duration_turns) + bestTier;
          await db.query(
            `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining)
             VALUES ($1, $2, 'HOT', $3, $4)`,
            [sessionId, targetParticipant.id, amount, hotDuration]
          );
          buffParts.push(`obtuvo regeneración por ${hotDuration} rondas`);
        } else if (bonus.stat_code === 'HEAL_HP') {
          const before = targetParticipant.hp;
          targetParticipant.hp = Math.min(targetParticipant.max_hp, targetParticipant.hp + amount);
          hpRestored += targetParticipant.hp - before;
        } else if (bonus.stat_code === 'RESTORE_MANA' || bonus.stat_code === 'HEAL_MP') {
          const before = targetParticipant.mana;
          targetParticipant.mana = Math.min(targetParticipant.max_mana, targetParticipant.mana + amount);
          manaRestored += targetParticipant.mana - before;
        } else if (bonus.stat_code === 'ALL_STATS' && bonus.is_percent) {
          const multiplier = 1 + amount / 100;
          targetParticipant.atk = Math.round(targetParticipant.atk * multiplier);
          targetParticipant.mag = Math.round(targetParticipant.mag * multiplier);
          targetParticipant.def = Math.round(targetParticipant.def * multiplier);
          targetParticipant.spd = Math.round(targetParticipant.spd * multiplier);
          buffParts.push(`aumentó ${amount}% todas las stats`);
        } else if (BUFF_STAT_MAP[bonus.stat_code]) {
          const key = BUFF_STAT_KEY[bonus.stat_code];
          if (bonus.is_percent) {
            targetParticipant[key] = Math.round(targetParticipant[key] * (1 + amount / 100));
          } else {
            targetParticipant[key] += amount;
          }
          buffParts.push(`aumentó ${amount}${bonus.is_percent ? '%' : ''} ${BUFF_STAT_MAP[bonus.stat_code]}`);
        }
      }

      const effectParts = [];
      if (hpRestored > 0) effectParts.push(`recuperó ${hpRestored} HP`);
      if (manaRestored > 0) effectParts.push(`restauró ${manaRestored} Maná`);
      effectParts.push(...buffParts);
      const effectText =
        effectParts.length === 0
          ? 'no tuvo efecto'
          : effectParts.length === 1
          ? effectParts[0]
          : `${effectParts.slice(0, -1).join(', ')} y ${effectParts[effectParts.length - 1]}`;

      await inventory.removeItem(itemOwnerId, itemId, 1, 0, bestTier);
      await persistParticipant(targetParticipant);

      const isSelfTarget = targetParticipant.id === actor.id;
      const description = isSelfTarget
        ? actor.player_id
          ? `Usaste ${itemName}: ${effectText}.`
          : `${actor.name} usó ${itemName} en sí mismo: ${effectText}.`
        : `${actor.name} usó ${itemName} en ${targetParticipant.name}: ${targetParticipant.name} ${effectText}.`;

      logEntry = {
        actorId: actor.id,
        action,
        targetId: targetParticipant.id,
        itemId,
        description,
        hp_after: targetParticipant.hp,
        mana_after: targetParticipant.mana,
      };
    }

    actor.has_acted_this_round = true;
    await persistParticipant(actor);
    await insertLog(sessionId, session.current_round, logEntry);

    // Bonus action del invocado: si el actor tiene un invocado activo, ataca automaticamente
    await execSummonBonusAttack(sessionId, actor.id, session.current_round, participants);

    const refreshed = await loadParticipants(sessionId);
    if (combat.isWiped(refreshed.enemy)) {
      const rewards = await finalizeSession(sessionId, 'PLAYER_WON', refreshed);
      const state = await fetchSessionState(sessionId);
      return res.json({ ...state, rewards });
    }
    if (combat.isWiped(refreshed.player)) {
      await finalizeSession(sessionId, 'ENEMY_WON', refreshed);
      const state = await fetchSessionState(sessionId);
      return res.json({ ...state, rewards: null });
    }

    await advanceEnemyTurns(sessionId);
    const state = await fetchSessionState(sessionId);
    res.json(state);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
