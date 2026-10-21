// Las mecánicas nuevas del combate y las habilidades firma de las evoluciones (docs/habilidades_firma.md).
//
// Cada estado es una fila de combat_participant_buffs con su stat_code (como el veneno o la invisibilidad), y
// loadParticipants (routes/combat.js) lo lee en p.mec con leerBuff:
//   BARRERA    absorbe daño antes de tocar la vida (applied_flat = lo que le queda)
//   SENUELO    un clon recibe el próximo golpe entero
//   CONTRA     el próximo golpe físico se esquiva y se devuelve (applied_flat = % que devuelve)
//   VINCULO    la mitad del daño que recibe lo paga quien lo protege (applied_flat = id de ese participante)
//   SEMILLA    se cura un poco cada vez que le pegan (applied_flat = % de su vida máxima)
//   MOJADO     para las reacciones elementales (ver reaccionar)
//   CONGELADO  pierde su próximo turno
//   ENRAIZADO  pierde su próximo turno
//   SILENCIO   no puede usar habilidades
//   CARGAS     las cargas de chi del monje (applied_flat = cuántas, hasta 5)
//   RUNA       el próximo golpe con elemento la hace estallar (applied_flat = % de daño extra)
//   SENTENCIA  cada vez que actúa, la luz lo quema (applied_flat = daño)
//   PRESA      marcado por un cazador: si muere, el cazador recupera maná (applied_flat = id del cazador)
//   ALIENTO    último aliento: el golpe que lo mataría lo deja con 1 de vida (una vez)
//
// Las habilidades firma llevan filas de skill_effects con effect_type 'MECANICA' y stat_code = qué hacen
// (LIBERAR, CONTRA, VINCULO, SED, RUNA, ALZAR, SACRIFICIO, MOJAR, SENTENCIA, PRESA, PERFORAR, ENRAIZAR, BAJAR,
// HURTO, SEMILLA, SENUELO, EJECUTAR, PLAGA, DRENAR, SILENCIAR, DISIPAR, SOBRECURA, BARRERA, IGUALAR, y desde el escalón 2:
// QUEMAR, CEGAR, PARALIZAR, CONGELAR, MOJAR, SUBIR, PROVOCAR, CADENA, ALIENTO, ROBAR_MEJORA, REVIVIR, CURAR_GRUPO, LIMPIAR,
// DETONAR, GANAR_CHI y DEFINITIVA); las resuelve resolver(). Las que mejoran (BARRERA, SEMILLA, SENUELO, SUBIR) van a
// los objetivos si son aliados, y a quien la usa si la habilidad apunta a enemigos.
//
// El daño de lib/combat.js pasa por recibirDanio (barrera, clon, contraataque, vínculo y semilla). Lo que cambia
// ahí se guarda después, cuando routes/combat.js llama a persistParticipant (ver guardar).
const db = require('../db/db');

const MAX_CARGAS = 5;
const VINCULO_PCT = 50;
const PRESA_MANA_PCT = 15;
const BARRERA_TOPE_PCT = 30;
// las clases de la rama del monje juntan cargas de chi con cada golpe
const CLASES_CHI = new Set([6, 38, 39, 40, 41, 42]);
// stats que se pueden robar, bajar o quitar al disipar (las mismas de applyStatDelta en routes/combat.js)
const STATS = { ATK: 'atk', MAG: 'mag', DEF: 'def', MAGIC_DEF: 'magic_def', SPD: 'spd', CRIT_CHANCE: 'crit_chance', EVASION: 'evasion' };
const INMUNES_PLAGA = ['ELEMENTAL', 'ESPECTRO', 'MUERTO_VIVIENTE'];

const sinNivel = (name) => String(name ?? '').replace(/ Lv\.(\d+|\?\?\?)$/, '');

// ---------------------------------------------------------------- lectura de los estados
function iniciar(p, todos) {
  p.mec = {};
  // la lista de todos los combatientes (para el vínculo); no enumerable para que no viaje al cliente
  Object.defineProperty(p, '_todos', { value: todos, enumerable: false, configurable: true, writable: true });
}

function leerBuff(p, buff) {
  const v = { id: buff.id, valor: Number(buff.applied_flat) };
  switch (buff.stat_code) {
    case 'BARRERA': p.mec.barrera = p.mec.barrera ? { ...p.mec.barrera, valor: p.mec.barrera.valor + v.valor } : v; return true;
    case 'SENUELO': p.mec.senuelo = v; return true;
    case 'CONTRA': p.mec.contra = v; return true;
    case 'VINCULO': p.mec.vinculo = v; return true;
    case 'SEMILLA': p.mec.semilla = v; return true;
    case 'MOJADO': p.mec.mojado = v; return true;
    case 'CONGELADO': p.mec.congelado = v; return true;
    case 'ENRAIZADO': p.mec.enraizado = v; return true;
    case 'SILENCIO': p.mec.silencio = v; return true;
    case 'CARGAS': p.mec.cargas = v; return true;
    case 'RUNA': p.mec.runa = v; return true;
    case 'SENTENCIA': p.mec.sentencia = v; return true;
    case 'PRESA': p.mec.presa = v; return true;
    case 'ALIENTO': p.mec.aliento = v; return true;
    default: return false;
  }
}

// ---------------------------------------------------------------- daño recibido (lo llama lib/combat.js)
const PEND = new WeakMap();
const pend = (p) => { if (!PEND.has(p)) PEND.set(p, []); return PEND.get(p); };
const nota = (p, texto, actorId = null) => pend(p).push({ nota: texto, actorId: actorId ?? p.id });

function recibirDanio(actor, target, damage, fisico) {
  const m = target.mec;
  if (!m || damage <= 0) {
    target.hp = Math.max(0, target.hp - damage);
    return damage;
  }
  // el clon de sombra se lleva el golpe entero
  if (m.senuelo) {
    m.senuelo.valor -= 1;
    if (m.senuelo.valor > 0) pend(target).push({ valor: m.senuelo });
    else pend(target).push({ quitar: m.senuelo.id });
    if (m.senuelo.valor <= 0) m.senuelo = null;
    nota(target, `El clon de ${sinNivel(target.name)} recibe el golpe y se deshace en humo.`);
    return 0;
  }
  // contragolpe: esquiva el golpe físico y lo devuelve
  if (m.contra && fisico && actor && actor.id !== target.id && actor.hp > 0) {
    const vuelta = Math.max(1, Math.round(damage * m.contra.valor / 100));
    actor.hp = Math.max(0, actor.hp - vuelta);
    pend(target).push({ quitar: m.contra.id }, { hp: actor });
    m.contra = null;
    nota(target, `¡${sinNivel(target.name)} desvía el golpe y contraataca a ${sinNivel(actor.name)} por ${vuelta}!`);
    return 0;
  }
  // juramento: quien lo protege paga la mitad
  if (m.vinculo) {
    const protector = target._todos?.find((p) => p.id === m.vinculo.valor && p.hp > 0 && p.id !== target.id);
    if (protector) {
      const parte = Math.round(damage * VINCULO_PCT / 100);
      protector.hp = Math.max(0, protector.hp - parte);
      damage -= parte;
      pend(target).push({ hp: protector });
      nota(target, `${sinNivel(protector.name)} recibe ${parte} del golpe por su juramento.`, protector.id);
    }
  }
  // barrera: absorbe antes de tocar la vida
  if (m.barrera && m.barrera.valor > 0) {
    const absorbido = Math.min(m.barrera.valor, damage);
    m.barrera.valor -= absorbido;
    damage -= absorbido;
    pend(target).push({ barrera: m.barrera });
    if (m.barrera.valor <= 0) nota(target, `La barrera de ${sinNivel(target.name)} se rompe.`);
  }
  target.hp = Math.max(0, target.hp - damage);
  // último aliento: el golpe que lo mataría lo deja con 1 de vida
  if (target.hp <= 0 && m.aliento) {
    target.hp = 1;
    pend(target).push({ quitar: m.aliento.id });
    m.aliento = null;
    nota(target, `¡${sinNivel(target.name)} se niega a caer y queda con 1 de vida!`);
  }
  // semilla: florece con cada golpe
  if (m.semilla && target.hp > 0 && damage > 0) {
    target.hp = Math.min(Number(target.max_hp), target.hp + Math.max(1, Math.round(Number(target.max_hp) * m.semilla.valor / 100)));
  }
  return damage;
}

async function rondaDe(sessionId) {
  return (await db.query('SELECT current_round FROM combat_sessions WHERE id = $1', [sessionId])).rows[0]?.current_round ?? 1;
}
async function log(sessionId, round, { actorId, targetId = null, damage = null, description }) {
  await db.query(
    `INSERT INTO combat_log(session_id, round, actor_participant_id, action, target_participant_id, damage, success, description)
     VALUES ($1, $2, $3, 'SKILL', $4, $5, TRUE, $6)`,
    [sessionId, round, actorId, targetId, damage, description]
  );
}

// guarda lo que cambió en recibirDanio (lo llama persistParticipant)
async function guardar(p) {
  const ops = PEND.get(p);
  if (!ops?.length) return;
  PEND.delete(p);
  let round = null;
  for (const op of ops) {
    if (op.quitar) await db.query('DELETE FROM combat_participant_buffs WHERE id = $1', [op.quitar]);
    else if (op.valor) await db.query('UPDATE combat_participant_buffs SET applied_flat = $1 WHERE id = $2', [op.valor.valor, op.valor.id]);
    else if (op.barrera) {
      if (op.barrera.valor > 0) await db.query('UPDATE combat_participant_buffs SET applied_flat = $1 WHERE id = $2', [op.barrera.valor, op.barrera.id]);
      else await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'BARRERA'", [p.id]);
    } else if (op.hp) await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [op.hp.hp, op.hp.id]);
    else if (op.nota) {
      round ??= await rondaDe(p.session_id);
      await log(p.session_id, round, { actorId: op.actorId, targetId: p.id, description: op.nota });
    }
  }
}

// ---------------------------------------------------------------- poner y quitar estados
async function poner(sessionId, p, code, valor, rondas, debuff, skillId = null, status = null) {
  await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = $2', [p.id, code]);
  const r = await db.query(
    `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [sessionId, p.id, code, Math.round(valor), rondas, debuff, skillId, status]
  );
  p.mec ??= {};
  const clave = { BARRERA: 'barrera', SENUELO: 'senuelo', CONTRA: 'contra', VINCULO: 'vinculo', SEMILLA: 'semilla', MOJADO: 'mojado', CONGELADO: 'congelado', ENRAIZADO: 'enraizado', SILENCIO: 'silencio', CARGAS: 'cargas', RUNA: 'runa', SENTENCIA: 'sentencia', PRESA: 'presa', ALIENTO: 'aliento' }[code];
  if (clave) p.mec[clave] = { id: r.rows[0].id, valor: Math.round(valor) };
}
async function quitar(p, code) {
  await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = $2', [p.id, code]);
  const clave = { MOJADO: 'mojado', RUNA: 'runa', CARGAS: 'cargas', BARRERA: 'barrera' }[code];
  if (clave && p.mec) p.mec[clave] = null;
}
// sube o baja una estadística por unas rondas (al vencer, startNewRound la devuelve con applyStatDelta)
async function cambiarStat(sessionId, p, stat, delta, rondas, debuff, skillId) {
  const col = STATS[stat];
  if (!col || !delta) return;
  p[col] = Number(p[col] || 0) + delta;
  await db.query(
    `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [sessionId, p.id, stat, Math.round(delta), rondas, debuff, skillId]
  );
}
const tieneQuemadura = async (p) => (await db.query("SELECT 1 FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'BURN' LIMIT 1", [p.id])).rows.length > 0;

// ---------------------------------------------------------------- antes de usar una habilidad
const cacheFirma = new Map();
async function efectosFirma(skillId) {
  if (!cacheFirma.has(skillId)) {
    const r = await db.query("SELECT * FROM skill_effects WHERE skill_id = $1 AND effect_type = 'MECANICA' ORDER BY id", [skillId]);
    cacheFirma.set(skillId, r.rows);
  }
  return cacheFirma.get(skillId);
}

// lo que impide usarla (antes de gastar maná y de poner el tiempo de espera)
function validar(firma, actor, participants, round = 1) {
  if (actor.mec?.silencio) return `${sinNivel(actor.name)} está silenciado y no puede usar habilidades.`;
  const definitiva = firma.find((e) => e.stat_code === 'DEFINITIVA');
  if (definitiva && round < Number(definitiva.flat_amount || 3)) {
    return `La definitiva se carga con el combate: estará lista en la ronda ${Number(definitiva.flat_amount || 3)}.`;
  }
  if (firma.some((e) => e.stat_code === 'ALZAR')) {
    if (!participants.enemy.some((e) => e.hp <= 0 && !e.is_summon)) return 'Todavía no cayó ningún enemigo que puedas levantar.';
    if (participants.player.some((p) => p.is_summon && Number(p.summoner_id) === actor.id && p.hp > 0)) return 'Ya tienes a alguien peleando a tu lado.';
  }
  if (firma.some((e) => e.stat_code === 'SACRIFICIO')
    && !participants.player.some((p) => p.is_summon && Number(p.summoner_id) === actor.id && p.hp > 0)) {
    return 'No tienes ninguna invocación para sacrificar.';
  }
  return null;
}

// ---------------------------------------------------------------- reacciones elementales y golpes
// Después de cada golpe con elemento de un héroe (habilidad firma o normal): el agua moja, y lo mojado o quemado
// reacciona con el elemento siguiente. También estalla la runa y el monje junta chi. Devuelve las frases para el
// registro del combate.
async function trasGolpe({ sessionId, actor, elemCode, results, participants, liberando = false }) {
  const partes = [];
  if (!actor || !actor.player_id && !actor.npc_id) return partes;
  for (const r of results.filter((x) => !x.evaded && x.amount > 0 && x.target.side === 'ENEMY')) {
    const t = r.target;
    if (t.hp > 0 && elemCode) {
      let extra = 0;
      const m = t.mec ?? {};
      if (m.runa) {
        extra += Math.round(r.amount * m.runa.valor / 100);
        await quitar(t, 'RUNA');
        partes.push(`¡La runa de ${sinNivel(t.name)} estalla!`);
      }
      if (elemCode === 'WATER') {
        if (await tieneQuemadura(t)) {
          extra += Math.round(r.amount * 0.5);
          await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'BURN'", [t.id]);
          partes.push(`¡Vapor! ${sinNivel(t.name)} deja de arder entre una nube que quema.`);
        } else {
          await poner(sessionId, t, 'MOJADO', 1, 3, true);
          partes.push(`${sinNivel(t.name)} se moja.`);
        }
      } else if (m.mojado && elemCode === 'LIGHTNING') {
        extra += Math.round(r.amount * 0.5);
        await quitar(t, 'MOJADO');
        await db.query(
          `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, status_code)
           VALUES ($1, $2, 'PARALYZE', 0, 2, TRUE, 'PARALYZE')`, [sessionId, t.id]);
        partes.push(`¡Electrocutado! El rayo recorre el agua de ${sinNivel(t.name)}.`);
      } else if (m.mojado && elemCode === 'ICE') {
        await quitar(t, 'MOJADO');
        await poner(sessionId, t, 'CONGELADO', 1, 2, true);
        partes.push(`¡Congelado! El hielo atrapa a ${sinNivel(t.name)}.`);
      } else if (m.mojado && elemCode === 'EARTH') {
        await quitar(t, 'MOJADO');
        await cambiarStat(sessionId, t, 'SPD', -Math.round(Number(t.spd || 0) * 0.3), 2, true, null);
        partes.push(`¡Barro! ${sinNivel(t.name)} se hunde y va más lento.`);
      } else if (m.mojado && elemCode === 'FIRE') {
        await quitar(t, 'MOJADO');
        partes.push(`El fuego seca a ${sinNivel(t.name)}.`);
      } else if (elemCode === 'ICE' && await tieneQuemadura(t)) {
        extra += r.amount;
        await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'BURN'", [t.id]);
        partes.push(`¡Derretir! El hielo choca con las llamas de ${sinNivel(t.name)}.`);
      }
      if (extra > 0) {
        t.hp = Math.max(0, t.hp - extra);
        r.amount += extra;
        await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [t.hp, t.id]);
      }
    }
  }
  // chi: cada golpe del monje que pega suma una carga (la que las libera no)
  if (!liberando && CLASES_CHI.has(Number(actor.class_id)) && results.some((x) => !x.evaded && x.target.side === 'ENEMY')) {
    const n = Math.min(MAX_CARGAS, (actor.mec?.cargas?.valor ?? 0) + 1);
    if (n !== actor.mec?.cargas?.valor) {
      await poner(sessionId, actor, 'CARGAS', n, 100, false);
      partes.push(`Chi ${n}/${MAX_CARGAS}.`);
    }
  }
  // los que cayeron: la presa le devuelve maná al cazador y la plaga salta a otro
  for (const r of results.filter((x) => x.target.hp <= 0)) partes.push(...await alMorir(r.target, participants, sessionId));
  return partes;
}

async function alMorir(p, participants, sessionId) {
  const partes = [];
  if (p.mec?.presa) {
    const cazador = participants.all.find((x) => x.id === p.mec.presa.valor && x.hp > 0);
    if (cazador) {
      const mana = Math.round(Number(cazador.max_mana) * PRESA_MANA_PCT / 100);
      cazador.mana = Math.min(Number(cazador.max_mana), Number(cazador.mana) + mana);
      await db.query('UPDATE combat_participants SET mana = $1 WHERE id = $2', [cazador.mana, cazador.id]);
      partes.push(`${sinNivel(cazador.name)} se cobra la presa: +${mana} de maná.`);
    }
    p.mec.presa = null;
  }
  const plaga = (await db.query("SELECT applied_flat, rounds_remaining, skill_id FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'PLAGA' LIMIT 1", [p.id])).rows[0];
  if (plaga) {
    const vivos = participants.enemy.filter((e) => e.hp > 0 && e.id !== p.id && !e.is_summon);
    const otro = vivos[Math.floor(Math.random() * vivos.length)];
    if (otro && !(await inmuneAPlaga(otro))) {
      await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'PLAGA'", [otro.id]);
      await db.query(
        `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
         VALUES ($1, $2, 'DOT', $3, $4, TRUE, $5, 'PLAGA')`,
        [sessionId, otro.id, plaga.applied_flat, Math.max(2, plaga.rounds_remaining), plaga.skill_id]
      );
      partes.push(`La plaga salta de ${sinNivel(p.name)} a ${sinNivel(otro.name)}.`);
    }
  }
  return partes;
}
async function inmuneAPlaga(p) {
  if (!p.monster_code) return false;
  const r = await db.query('SELECT category FROM monsters WHERE code = $1', [p.monster_code]);
  return INMUNES_PLAGA.includes(r.rows[0]?.category);
}

// ---------------------------------------------------------------- turnos del enemigo
// Congelado o enraizado: pierde el turno (una vez). Lo llama paralysisSkip.
async function pierdeTurno(p) {
  const m = p.mec ?? {};
  const estado = m.congelado ? 'CONGELADO' : m.enraizado ? 'ENRAIZADO' : null;
  if (!estado) return null;
  await quitar(p, estado);
  m.congelado = null;
  m.enraizado = null;
  return estado === 'CONGELADO' ? `El hielo no deja moverse a ${sinNivel(p.name)}.` : `${sinNivel(p.name)} no puede moverse y pierde el turno.`;
}
// Sentencia: cada vez que actúa, la luz lo quema. Devuelve la frase (o null).
async function alActuar(p) {
  if (!p.mec?.sentencia || p.hp <= 0) return null;
  const dmg = Math.max(1, p.mec.sentencia.valor);
  p.hp = Math.max(0, p.hp - dmg);
  await db.query('UPDATE combat_participants SET hp = $1 WHERE id = $2', [p.hp, p.id]);
  return { dmg, texto: `La sentencia quema a ${sinNivel(p.name)} por ${dmg} al intentar moverse.` };
}

// ---------------------------------------------------------------- las habilidades firma
// ctx = { sessionId, round, actor, targets, skill, firma, participants, elementalModsByTargetId, elemCode,
//         persistParticipant, registerKillCounters, playerId }. Devuelve el logEntry de routes/combat.js.
async function resolver(ctx) {
  const combat = require('./combat');
  const { sessionId, actor, skill, firma, participants, persistParticipant } = ctx;
  // los dos bandos desde quien la usa (un héroe o un monstruo: los jefes también tienen mecánicas)
  const rival = (x) => x.side !== actor.side;
  const rivales = participants.all.filter(rival);
  const amigos = participants.all.filter((x) => !rival(x));
  let targets = ctx.targets;
  const mods = { ...(ctx.elementalModsByTargetId ?? {}) };
  const ef = (code) => firma.find((e) => e.stat_code === code);
  const partes = [];
  let results = [];
  let liberando = false;
  let curaTotal = null;

  // ajustes antes de pegar
  const quitarDefensaAntes = actor.ignore_def_percent;
  if (ef('LIBERAR')) {
    const cargas = actor.mec?.cargas?.valor ?? 0;
    liberando = true;
    actor.ignore_def_percent = 50;
    for (const t of targets) mods[t.id] = { ...(mods[t.id] ?? {}), conditionalBonusPercent: (mods[t.id]?.conditionalBonusPercent ?? 0) + Number(ef('LIBERAR').percent_amount) * cargas };
    if (cargas) await quitar(actor, 'CARGAS');
    partes.push(cargas ? `Libera ${cargas} ${cargas === 1 ? 'carga' : 'cargas'} de chi.` : 'Sin chi acumulado, el golpe sale solo.');
  }
  if (ef('PERFORAR')) {
    actor.ignore_def_percent = Number(ef('PERFORAR').percent_amount);
    for (const t of targets) {
      if (t.mec?.barrera) { await quitar(t, 'BARRERA'); partes.push(`La barrera de ${sinNivel(t.name)} se rompe.`); }
    }
  }
  if (ef('SED')) {
    const e = ef('SED');
    const costo = Math.round(Number(actor.max_hp) * Number(e.percent_amount) / 100);
    actor.hp = Math.max(1, actor.hp - costo);
    const falta = Math.round((1 - actor.hp / Number(actor.max_hp)) * 100);
    for (const t of targets) mods[t.id] = { ...(mods[t.id] ?? {}), conditionalBonusPercent: (mods[t.id]?.conditionalBonusPercent ?? 0) + falta };
    if (costo > 0) partes.push(`Paga ${costo} de vida (+${falta}% de daño).`);
  }
  // detonar: si el enemigo arde o está envenenado, el golpe lo hace estallar (y se lleva el estado)
  const detonar = ef('DETONAR');
  const detonados = [];
  if (detonar) {
    const estados = String(detonar.status_code).split(',');
    for (const t of targets) {
      const r = await db.query('SELECT 1 FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = ANY($2::text[]) LIMIT 1', [t.id, estados]);
      if (!r.rows.length) continue;
      mods[t.id] = { ...(mods[t.id] ?? {}), conditionalBonusPercent: (mods[t.id]?.conditionalBonusPercent ?? 0) + Number(detonar.percent_amount) };
      detonados.push(t);
    }
  }
  if (ef('EJECUTAR')) {
    const e = ef('EJECUTAR');
    for (const t of targets) {
      if (t.hp / Number(t.max_hp) * 100 < Number(e.percent_amount)) {
        mods[t.id] = { ...(mods[t.id] ?? {}), conditionalBonusPercent: (mods[t.id]?.conditionalBonusPercent ?? 0) + (Number(e.flat_amount) - 1) * 100 };
        partes.push(`¡${sinNivel(t.name)} está a merced!`);
      }
    }
  }
  if (ef('VINCULO') && targets[0]?.id === actor.id) {
    const otros = amigos.filter((p) => p.hp > 0 && p.id !== actor.id && !p.is_summon);
    const masHerido = otros.sort((a, b) => a.hp / a.max_hp - b.hp / b.max_hp)[0];
    targets = masHerido ? [masHerido] : [];
  }

  // el golpe o la cura
  const pega = ['ATAQUE', 'CURACION'].includes(skill.skill_type) && skill.base_value != null;
  if (pega && targets.length) {
    const antes = new Map(targets.map((t) => [t.id, t.hp]));
    results = combat.resolveSkill(actor, targets, skill, mods);
    if (skill.skill_type === 'CURACION') {
      curaTotal = results.reduce((s, r) => s + r.amount, 0);
      const sobre = ef('SOBRECURA');
      if (sobre) {
        for (const r of results) {
          const curado = r.target.hp - antes.get(r.target.id);
          const exceso = Math.round((r.amount - curado) * Number(sobre.percent_amount) / 100);
          if (exceso > 0) {
            const tope = Math.round(Number(r.target.max_hp) * BARRERA_TOPE_PCT / 100);
            const valor = Math.min(tope, exceso + (r.target.mec?.barrera?.valor ?? 0));
            await poner(sessionId, r.target, 'BARRERA', valor, Number(sobre.duration_turns), false, skill.id);
            partes.push(`La cura que sobra queda como barrera de ${valor} en ${sinNivel(r.target.name)}.`);
          }
        }
      }
    }
    for (const r of results) await persistParticipant(r.target);
    if (ef('SED') && results.length) {
      const robo = Math.round(results.reduce((s, r) => s + r.amount, 0) * Number(ef('SED').flat_amount) / 100);
      actor.hp = Math.min(Number(actor.max_hp), actor.hp + robo);
      if (robo) partes.push(`Bebe ${robo} de vida.`);
    }
  }
  actor.ignore_def_percent = quitarDefensaAntes;
  if (detonar) {
    for (const t of detonados) {
      await db.query('DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = ANY($2::text[])', [t.id, String(detonar.status_code).split(',')]);
      partes.push(`¡${sinNivel(t.name)} estalla!`);
    }
  }
  // a quién van las mejoras: a los objetivos si son aliados, a quien la usa si apunta a enemigos
  const aliados = targets.length && !rival(targets[0]) ? targets : [actor];
  const sale = (pct) => pct == null || pct >= 100 || Math.random() * 100 < pct;

  // efectos sobre los objetivos
  for (const e of firma) {
    const dur = Number(e.duration_turns || 0);
    const pct = Number(e.percent_amount || 0);
    switch (e.stat_code) {
      case 'CONTRA':
        await poner(sessionId, actor, 'CONTRA', pct, dur, false, skill.id);
        partes.push(`${sinNivel(actor.name)} toma postura de contragolpe.`);
        break;
      case 'VINCULO':
        if (!targets.length) { partes.push('No hay ningún aliado a quien jurar protección.'); break; }
        await poner(sessionId, targets[0], 'VINCULO', actor.id, dur, false, skill.id);
        partes.push(`${sinNivel(actor.name)} jura proteger a ${sinNivel(targets[0].name)}: recibirá la mitad de sus golpes.`);
        break;
      case 'RUNA':
        for (const t of targets.filter((x) => x.hp > 0)) await poner(sessionId, t, 'RUNA', pct, dur, true, skill.id);
        partes.push('Una runa queda grabada en el enemigo: el próximo golpe con elemento la hará estallar.');
        break;
      case 'ALZAR': {
        const caido = rivales.filter((x) => x.hp <= 0 && !x.is_summon).sort((a, b) => b.id - a.id)[0];
        if (!caido) break;
        const hp = Math.max(1, Math.round(Number(caido.max_hp) * pct / 100));
        const nombre = `${sinNivel(caido.name)} alzado`;
        await db.query(
          `INSERT INTO combat_participants(session_id, side, name, hp, max_hp, mana, max_mana, atk, mag, def, magic_def, spd,
             crit_chance, crit_damage, evasion, xp_reward, gold_reward, is_summon, summoner_id, summon_rounds_remaining, element_id, has_acted_this_round)
           VALUES ($1, 'PLAYER', $2, $3, $3, 0, 0, $4, $5, $6, $7, 0, 0, 150, 0, 0, 0, TRUE, $8, $9, $10, TRUE)`,
          [sessionId, nombre, hp, Math.round(Number(caido.atk) * pct / 100), Math.round(Math.max(Number(caido.atk), Number(caido.mag)) * pct / 100),
            Math.round(Number(caido.def) * pct / 100), Math.round(Number(caido.magic_def) * pct / 100), actor.id, dur, caido.element_id ?? null]
        );
        partes.push(`${sinNivel(caido.name)} se levanta del suelo y pelea para ${sinNivel(actor.name)} durante ${dur} rondas.`);
        break;
      }
      case 'SACRIFICIO': {
        const inv = amigos.find((p) => p.is_summon && Number(p.summoner_id) === actor.id && p.hp > 0);
        if (!inv) break;
        const dmg = Math.max(1, Math.round(inv.hp * pct / 100));
        for (const t of rivales.filter((x) => x.hp > 0)) {
          const hecho = recibirDanio(actor, t, dmg, false);
          await persistParticipant(t);
          results.push({ target: t, amount: hecho, evaded: false, crit: false });
        }
        inv.hp = 0;
        await db.query('UPDATE combat_participants SET hp = 0 WHERE id = $1', [inv.id]);
        partes.push(`${sinNivel(inv.name)} estalla en luz: ${dmg} de daño a cada enemigo.`);
        break;
      }
      case 'SENTENCIA':
        for (const t of targets) await poner(sessionId, t, 'SENTENCIA', Math.round(Number(actor.mag) * pct / 100), dur, true, skill.id);
        partes.push(`Sentencia sobre ${sinNivel(targets[0].name)}: cada vez que actúe, la luz le quemará.`);
        break;
      case 'PRESA':
        for (const t of targets) {
          await poner(sessionId, t, 'PRESA', actor.id, dur, true, skill.id);
          await db.query(
            `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id)
             VALUES ($1, $2, 'DAMAGE_TAKEN', $3, $4, TRUE, $5)`, [sessionId, t.id, pct, dur, skill.id]);
        }
        partes.push(`${sinNivel(targets[0].name)} es la presa: recibe +${pct}% de daño de todos.`);
        break;
      case 'ENRAIZAR': {
        const hit = targets.filter((x) => x.hp > 0 && rival(x) && sale(e.flat_amount));
        for (const t of hit) await poner(sessionId, t, 'ENRAIZADO', 1, dur, true, skill.id);
        if (hit.length) partes.push(`${hit.length > 1 ? `${hit.length} rivales no pueden moverse y pierden` : `${sinNivel(hit[0].name)} no puede moverse y pierde`} su próximo turno.`);
        break;
      }
      case 'BAJAR':
        for (const t of targets.filter((x) => x.hp > 0)) {
          const col = STATS[e.status_code];
          const delta = e.flat_amount != null ? -Number(e.flat_amount) : -Math.round(Number(t[col] || 0) * pct / 100);
          await cambiarStat(sessionId, t, e.status_code, delta, dur, true, skill.id);
        }
        break;
      case 'HURTO':
        for (const t of targets.filter((x) => x.hp > 0)) {
          const col = STATS[e.status_code];
          const cuanto = Math.max(1, Math.round(Number(t[col] || 0) * pct / 100));
          await cambiarStat(sessionId, t, e.status_code, -cuanto, dur, true, skill.id);
          await cambiarStat(sessionId, actor, e.status_code, cuanto, dur, false, skill.id);
          partes.push(`Roba ${cuanto} de ${{ ATK: 'ataque', MAG: 'magia', SPD: 'velocidad', DEF: 'defensa' }[e.status_code] ?? e.status_code.toLowerCase()} a ${sinNivel(t.name)}.`);
        }
        break;
      case 'SEMILLA':
        for (const t of aliados) await poner(sessionId, t, 'SEMILLA', pct, dur, false, skill.id);
        partes.push(`Una semilla brota en ${aliados.length > 1 ? 'el grupo' : sinNivel(aliados[0].name)}: cada golpe recibido le dará vida.`);
        break;
      case 'SENUELO': {
        const copias = Number(e.flat_amount || 1);
        for (const t of aliados) await poner(sessionId, t, 'SENUELO', copias, dur, false, skill.id);
        partes.push(aliados.length > 1 ? 'Una sombra protectora se pone delante de cada aliado.'
          : `${copias > 1 ? `${copias} clones de sombra se ponen` : 'Un clon de sombra se pone'} delante de ${sinNivel(aliados[0].name)}.`);
        break;
      }
      case 'QUEMAR':
        for (const t of targets.filter((x) => x.hp > 0 && rival(x))) {
          await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'BURN' AND stat_code = 'DOT'", [t.id]);
          await db.query(`INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
            VALUES ($1, $2, 'DOT', $3, $4, TRUE, $5, 'BURN')`, [sessionId, t.id, pct, dur, skill.id]);
        }
        partes.push(`Arde (${pct}% de su vida por ronda).`);
        break;
      case 'CEGAR':
        for (const t of targets.filter((x) => x.hp > 0 && rival(x))) {
          await db.query(`INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
            VALUES ($1, $2, 'BLIND', $3, $4, TRUE, $5, 'BLIND')`, [sessionId, t.id, pct, dur, skill.id]);
        }
        partes.push(`Ceguera: falla el ${pct}% de sus golpes.`);
        break;
      case 'PARALIZAR': {
        const hit = targets.filter((x) => x.hp > 0 && rival(x) && sale(e.flat_amount));
        for (const t of hit) {
          await db.query(`INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
            VALUES ($1, $2, 'PARALYZE', 0, $3, TRUE, $4, 'PARALYZE')`, [sessionId, t.id, dur, skill.id]);
        }
        if (hit.length) partes.push(`Parálisis sobre ${hit.length > 1 ? `${hit.length} rivales` : sinNivel(hit[0].name)}.`);
        break;
      }
      case 'CONGELAR': {
        const hit = targets.filter((x) => x.hp > 0 && rival(x) && sale(e.flat_amount));
        for (const t of hit) await poner(sessionId, t, 'CONGELADO', 1, dur, true, skill.id);
        if (hit.length) partes.push(`El hielo atrapa a ${hit.length > 1 ? `${hit.length} rivales` : sinNivel(hit[0].name)}: ${hit.length > 1 ? 'pierden' : 'pierde'} su próximo turno.`);
        break;
      }
      case 'MOJAR':
        for (const t of targets.filter((x) => x.hp > 0 && rival(x) && !x.mec?.mojado)) await poner(sessionId, t, 'MOJADO', 1, dur || 3, true, skill.id);
        break;
      case 'SUBIR':
        for (const t of aliados) {
          const col = STATS[e.status_code];
          const delta = e.flat_amount != null ? Number(e.flat_amount) : Math.round(Number(t[col] || 0) * pct / 100);
          await cambiarStat(sessionId, t, e.status_code, delta, dur, false, skill.id);
          await persistParticipant(t);
        }
        partes.push(`+${e.flat_amount ?? `${pct}%`} de ${{ ATK: 'ataque', MAG: 'magia', SPD: 'velocidad', DEF: 'defensa', MAGIC_DEF: 'defensa mágica', EVASION: 'esquiva', CRIT_CHANCE: 'crítico' }[e.status_code]} para ${aliados.length > 1 ? 'el grupo' : sinNivel(aliados[0].name)}.`);
        break;
      case 'PROVOCAR':
        await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND stat_code = 'TAUNT'", [actor.id]);
        await db.query(`INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
          VALUES ($1, $2, 'TAUNT', 0, $3, FALSE, $4, 'TAUNT')`, [sessionId, actor.id, dur, skill.id]);
        partes.push(`${sinNivel(actor.name)} atrae todos los golpes.`);
        break;
      case 'CADENA': {
        const principal = results.find((r) => rival(r.target) && !r.evaded);
        if (!principal) break;
        const otros = rivales.filter((x) => x.hp > 0 && !results.some((r) => r.target.id === x.id)).slice(0, Number(e.flat_amount || 2));
        for (const t of otros) {
          let dmg = Math.max(1, Math.round(principal.amount * pct / 100));
          if (t.mec?.mojado) { dmg *= 2; await quitar(t, 'MOJADO'); }
          const hecho = recibirDanio(actor, t, dmg, false);
          await persistParticipant(t);
          results.push({ target: t, amount: hecho, evaded: false, crit: false, cadena: true });
        }
        if (otros.length) partes.push(`El golpe salta a ${otros.map((t) => sinNivel(t.name)).join(' y ')}.`);
        break;
      }
      case 'ALIENTO':
        // un monstruo se salva una sola vez por combate (si no, un jefe lo volvería a lanzar sin fin)
        if (actor.monster_code && (await db.query("SELECT 1 FROM combat_log WHERE session_id = $1 AND description LIKE $2 LIMIT 1",
          [sessionId, `%${sinNivel(actor.name)} se niega a caer%`])).rows.length) break;
        await poner(sessionId, actor, 'ALIENTO', 1, dur, false, skill.id);
        partes.push(`${sinNivel(actor.name)} guarda su vida en otra parte: sobrevivirá al próximo golpe mortal.`);
        break;
      case 'ROBAR_MEJORA':
        for (const t of targets.filter((x) => x.hp > 0 && rival(x))) {
          const robadas = (await db.query(
            `DELETE FROM combat_participant_buffs WHERE id IN (SELECT id FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = FALSE
               AND stat_code = ANY($2::text[]) ORDER BY id DESC LIMIT $3) RETURNING stat_code, applied_flat, rounds_remaining`,
            [t.id, Object.keys(STATS), Number(e.flat_amount || 1)])).rows;
          for (const b of robadas) {
            t[STATS[b.stat_code]] = Number(t[STATS[b.stat_code]] || 0) - Number(b.applied_flat);
            await cambiarStat(sessionId, actor, b.stat_code, Number(b.applied_flat), b.rounds_remaining, false, skill.id);
          }
          await persistParticipant(t);
          partes.push(robadas.length ? `Le roba ${robadas.length === 1 ? 'una mejora' : `${robadas.length} mejoras`} a ${sinNivel(t.name)} y se las queda.` : `${sinNivel(t.name)} no tenía mejoras que robar.`);
        }
        break;
      case 'REVIVIR': {
        const caidos = amigos.filter((p) => p.hp <= 0 && !p.is_summon);
        for (const p of caidos) {
          p.hp = Math.max(1, Math.round(Number(p.max_hp) * pct / 100));
          p.has_acted_this_round = true;
          await persistParticipant(p);
        }
        if (caidos.length) partes.push(`${caidos.map((p) => sinNivel(p.name)).join(' y ')} ${caidos.length > 1 ? 'vuelven' : 'vuelve'} a levantarse.`);
        break;
      }
      case 'CURAR_GRUPO': {
        let total = 0;
        for (const p of amigos.filter((x) => x.hp > 0 && !x.is_summon)) {
          const antes = p.hp;
          p.hp = Math.min(Number(p.max_hp), p.hp + Math.round(Number(p.max_hp) * pct / 100));
          total += p.hp - antes;
          await persistParticipant(p);
        }
        if (total > 0) {
          curaTotal = (curaTotal ?? 0) + total;
          partes.push(`El grupo recupera ${total} de vida.`);
        }
        break;
      }
      case 'LIMPIAR': {
        let n = 0;
        for (const p of amigos.filter((x) => x.hp > 0)) {
          const quitados = (await db.query(
            `DELETE FROM combat_participant_buffs WHERE id IN (SELECT id FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = TRUE
               ORDER BY id DESC LIMIT $2) RETURNING stat_code, applied_flat`, [p.id, Number(e.flat_amount || 1)])).rows;
          for (const q of quitados) if (STATS[q.stat_code]) p[STATS[q.stat_code]] = Number(p[STATS[q.stat_code]] || 0) - Number(q.applied_flat);
          if (quitados.length) { n += quitados.length; await persistParticipant(p); }
        }
        if (n) partes.push(`Limpia ${n === 1 ? 'un mal' : `${n} males`} del grupo.`);
        break;
      }
      case 'GANAR_CHI': {
        const n = Math.min(MAX_CARGAS, (actor.mec?.cargas?.valor ?? 0) + Number(e.flat_amount || 1));
        await poner(sessionId, actor, 'CARGAS', n, 100, false);
        partes.push(`Chi ${n}/${MAX_CARGAS}.`);
        break;
      }
      case 'DEFINITIVA':
        partes.unshift('¡DEFINITIVA!');
        break;
      case 'PLAGA':
        for (const t of targets.filter((x) => x.hp > 0)) {
          if (await inmuneAPlaga(t)) { partes.push(`${sinNivel(t.name)} es inmune a la plaga.`); continue; }
          const prev = (await db.query("SELECT applied_flat FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'PLAGA' LIMIT 1", [t.id])).rows[0];
          // TODAS: pone todas las capas de una vez (el Eclipse del Sacerdote del Caos)
          const capas = e.status_code === 'TODAS' ? Number(e.flat_amount || 5) : Math.min(Number(e.flat_amount || 5), Math.round(Number(prev?.applied_flat ?? 0) / pct) + 1);
          await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'PLAGA'", [t.id]);
          await db.query(
            `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
             VALUES ($1, $2, 'DOT', $3, $4, TRUE, $5, 'PLAGA')`, [sessionId, t.id, pct * capas, dur, skill.id]);
          partes.push(`Plaga en ${sinNivel(t.name)}: ${capas} ${capas === 1 ? 'capa' : 'capas'} (${pct * capas}% de su vida por ronda).`);
        }
        break;
      case 'DRENAR':
        for (const t of targets.filter((x) => x.hp > 0)) {
          await db.query("DELETE FROM combat_participant_buffs WHERE participant_id = $1 AND status_code = 'RAICES'", [t.id]);
          await db.query(
            `INSERT INTO combat_participant_buffs(session_id, participant_id, stat_code, applied_flat, rounds_remaining, is_debuff, skill_id, status_code)
             VALUES ($1, $2, 'DOT', $3, $4, TRUE, $5, 'RAICES')`, [sessionId, t.id, pct, dur, skill.id]);
        }
        partes.push(`Las espinas le sacan ${pct}% de vida por ronda.`);
        break;
      case 'SILENCIAR':
        for (const t of targets.filter((x) => x.hp > 0)) await poner(sessionId, t, 'SILENCIO', 1, dur, true, skill.id);
        partes.push(`Silencio sobre ${targets.length > 1 ? 'todos' : sinNivel(targets[0].name)}: no ${targets.length > 1 ? 'pueden' : 'puede'} usar habilidades.`);
        break;
      case 'DISIPAR':
        for (const t of targets.filter((x) => x.hp > 0)) {
          const quitados = (await db.query(
            `DELETE FROM combat_participant_buffs WHERE id IN (SELECT id FROM combat_participant_buffs WHERE participant_id = $1 AND is_debuff = FALSE
               AND stat_code NOT IN ('SHIELD', 'BREAK', 'FURY', 'WEAK_ELEM', 'FARO_N', 'MYTH_N', 'MYTH_CHARGE') ORDER BY id DESC LIMIT $2)
             RETURNING stat_code, applied_flat`, [t.id, Number(e.flat_amount || 1)])).rows;
          for (const q of quitados) if (STATS[q.stat_code]) t[STATS[q.stat_code]] = Number(t[STATS[q.stat_code]] || 0) - Number(q.applied_flat);
          if (quitados.length) partes.push(`Le arranca ${quitados.length === 1 ? 'una mejora' : `${quitados.length} mejoras`} a ${sinNivel(t.name)}.`);
        }
        break;
      case 'BARRERA':
        for (const t of aliados) {
          const valor = Math.round(Number(t.max_hp) * pct / 100 + Number(actor.mag || 0) * Number(e.flat_amount || 0) / 100);
          await poner(sessionId, t, 'BARRERA', Math.max(valor, t.mec?.barrera?.valor ?? 0), dur, false, skill.id);
        }
        partes.push(`Una barrera cubre ${aliados.length > 1 ? 'al grupo' : `a ${sinNivel(aliados[0].name)}`}.`);
        break;
      case 'IGUALAR': {
        const grupo = amigos.filter((p) => p.hp > 0 && !p.is_summon);
        const media = grupo.reduce((s, p) => s + p.hp / Number(p.max_hp), 0) / grupo.length;
        for (const p of grupo) {
          p.hp = Math.min(Number(p.max_hp), Math.round(Number(p.max_hp) * (media + pct / 100)));
          await persistParticipant(p);
        }
        partes.push(`Las vidas del grupo se reparten: todos quedan al ${Math.round(Math.min(1, media + pct / 100) * 100)}%.`);
        break;
      }
      default:
        break;
    }
  }

  // reacciones, runa, chi y muertes (presa y plaga)
  if (results.length) partes.push(...await trasGolpe({ sessionId, actor, elemCode: ctx.elemCode, results, participants, liberando }));
  const muertos = results.filter((r) => r.target.hp <= 0 && rival(r.target)).map((r) => r.target);
  if (ef('EJECUTAR') && muertos.length) {
    actor.grants_extra_action = true;
    partes.push('¡No gasta el turno!');
  }
  if (ctx.playerId && actor.player_id === ctx.playerId && muertos.length) await ctx.registerKillCounters(ctx.playerId, sessionId, muertos, skill, actor, participants);
  await persistParticipant(actor);

  const golpes = results.filter((r) => rival(r.target));
  const resumen = golpes.length && pega && skill.skill_type === 'ATAQUE'
    ? ` sobre ${golpes.map((r) => (r.evaded ? `${r.target.name} esquiva` : `${r.target.name}, haciéndole ${r.amount} de daño${r.crit ? ' (¡Crítico!)' : ''}`)).join('; ')}.`
    : curaTotal ? ` y cura ${curaTotal} de vida.` : '.';
  const total = golpes.reduce((s, r) => s + (r.amount || 0), 0);
  return {
    actorId: actor.id,
    action: 'SKILL',
    targetId: (golpes[0]?.target ?? targets[0] ?? actor).id,
    damage: total || null,
    heal: curaTotal,
    evaded: golpes.length > 0 && golpes.every((r) => r.evaded),
    crit: golpes.some((r) => r.crit),
    description: `${actor.name} usa ${skill.name}${resumen}${partes.length ? ` ${partes.join(' ')}` : ''}`,
    hp_after: (golpes[0]?.target ?? targets[0] ?? actor).hp,
    mana_after: actor.mana,
  };
}

module.exports = {
  iniciar, leerBuff, recibirDanio, guardar, efectosFirma, validar, resolver, trasGolpe, alMorir, pierdeTurno, alActuar,
  CLASES_CHI, MAX_CARGAS,
};
