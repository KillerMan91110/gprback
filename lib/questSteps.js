// Misiones por pasos (misiones v2). Cada objetivo de una misión tiene un paso (quest_objectives.step):
// solo cuentan los objetivos del paso actual, que es el más bajo con algo sin cumplir. Así una
// misión puede pedir "habla con Aldren en la puerta de la Cripta" y recién después "vence al Vigía".
//
// Tipos de objetivo nuevos (además de matar, jefe, juntar y usar acción):
//   TALK        hablar con un NPC                      target_code = id de diálogo del NPC
//   DELIVER     entregarle objetos a un NPC            target_code = NPC, item_id + target_count
//   VISIT       llegar a un lugar del mapa             params { zone, x, y, radius }
//   INVESTIGATE examinar algo en el mapa (con la E)    params { zone, x, y, radius, label }
//   CRAFT       fabricar un objeto                     item_id + target_count
//   AMBUSH      ganar el combate que sale en un lugar  params { zone, x, y, radius, monsters: [{code, level}] }
// En params también puede ir: dialog (lo que dice el NPC al cumplirlo), speaker (quién lo dice) y
// gives { item: CODE, qty } (lo que te entrega, por ejemplo una llave).
//
// Todo lo decide el servidor: el cliente solo avisa "hablé con X" o "llegué / examiné el punto N" y
// aquí se comprueba que estés de verdad ahí (lib/cercania.js) y en ese paso de la misión.
const db = require('../db/db');
const inventory = require('./inventory');
const { cercaDe } = require('./cercania');

// dónde vive cada NPC que da o recibe misiones (id de diálogo → zona y casilla). Un NPC puede
// aparecer en otro lado mientras dure un paso (quest_npc_spots), por ejemplo Aldren en la puerta
// de la Cripta.
const NPC_HOMES = {
  anciano: { zone: 'pradera', x: 80, y: 49, name: 'Aldren' },
  ren: { zone: 'pradera', x: 82, y: 48, name: 'Ren' },
  mirna: { zone: 'pradera', x: 76, y: 50, name: 'Mirna' },
  goreth: { zone: 'pradera', x: 84, y: 51, name: 'Goreth' },
  cochero_aldea: { zone: 'pradera', x: 89, y: 55, name: 'Gaspar' },
  tilo: { zone: 'pradera', x: 74, y: 53, name: 'Tilo' },
  bruno: { zone: 'pradera', x: 88, y: 50, name: 'Bruno' },
  tobias: { zone: 'pradera', x: 95, y: 30, name: 'Tobías' },
  // puestos de la Pradera (un NPC por subzona)
  brenna: { zone: 'pradera', x: 34, y: 34, name: 'Brenna' },
  nilo: { zone: 'pradera', x: 126, y: 25, name: 'Nilo' },
  orlan: { zone: 'pradera', x: 14, y: 102, name: 'Maese Orlan' },
  sela: { zone: 'pradera', x: 135, y: 49, name: 'Sela' },
  vera: { zone: 'pradera', x: 132, y: 80, name: 'Vera' },
  elenya: { zone: 'aurelia', x: 58, y: 16, name: 'Elenya' },
  marta: { zone: 'aurelia', x: 78, y: 63, name: 'Marta' },
};
// radio para hablar con un NPC (casillas); el mismo margen que los servicios de la ciudad
const TALK_RADIUS = 5;

const PROGRESS_TYPES = ['TALK', 'DELIVER', 'VISIT', 'INVESTIGATE', 'CRAFT', 'AMBUSH'];

// Estado de pasos de varias misiones activas de un jugador:
// Map questId → { current: número de paso actual (null = todo cumplido), objectives: [...] }
async function stepState(playerId, questIds) {
  const out = new Map();
  if (!questIds.length) return out;
  const objs = (await db.query(
    `SELECT qo.id, qo.quest_id, qo.objective_type, qo.item_id, qo.target_count, qo.step, qo.target_code, qo.params,
            COALESCE(p.current_count, 0) AS progress
     FROM quest_objectives qo
     LEFT JOIN player_quest_progress p ON p.quest_objective_id = qo.id AND p.player_id = $1
     WHERE qo.quest_id = ANY($2::int[])
     ORDER BY qo.step, qo.id`,
    [playerId, questIds]
  )).rows;
  const haveCache = new Map();
  for (const o of objs) {
    let count = Number(o.progress);
    if (o.objective_type === 'COLLECT_ITEM' && o.item_id) {
      if (!haveCache.has(o.item_id)) haveCache.set(o.item_id, await inventory.getQuantity(playerId, o.item_id));
      count = haveCache.get(o.item_id);
    }
    o.count = Math.min(count, o.target_count);
    o.done = count >= o.target_count;
    if (!out.has(o.quest_id)) out.set(o.quest_id, { current: null, objectives: [] });
    out.get(o.quest_id).objectives.push(o);
  }
  for (const st of out.values()) {
    const pending = st.objectives.filter((o) => !o.done);
    st.current = pending.length ? Math.min(...pending.map((o) => o.step)) : null;
  }
  return out;
}

// ids de objetivo que pueden avanzar ahora (los del paso actual de cada misión)
async function objectivesInCurrentStep(playerId, questIds) {
  const st = await stepState(playerId, questIds);
  const ids = new Set();
  for (const s of st.values()) {
    for (const o of s.objectives) if (o.step === s.current) ids.add(o.id);
  }
  return ids;
}

async function setProgress(playerId, questId, objectiveId, count, target) {
  await db.query(
    `INSERT INTO player_quest_progress(player_id, quest_id, quest_objective_id, current_count)
     VALUES ($1, $2, $3, LEAST($4::int, $5::int))
     ON CONFLICT (player_id, quest_objective_id)
     DO UPDATE SET current_count = LEAST(GREATEST(player_quest_progress.current_count, $4::int), $5::int), updated_at = now()`,
    [playerId, questId, objectiveId, count, target]
  );
}

async function itemIdByCode(code) {
  const r = await db.query('SELECT id, name FROM items WHERE code = $1', [code]);
  return r.rows[0] ?? null;
}

// ¿está cerca del NPC? Mira primero si en este paso el NPC está en otro lugar (quest_npc_spots)
async function nearNpc(playerId, npc, questId, step) {
  if (questId != null && step != null) {
    const spot = (await db.query('SELECT zone, x, y FROM quest_npc_spots WHERE quest_id = $1 AND step = $2 AND npc = $3', [questId, step, npc])).rows[0];
    if (spot) return cercaDe(playerId, spot.zone, spot.x, spot.y, TALK_RADIUS);
  }
  const home = NPC_HOMES[npc];
  return home ? cercaDe(playerId, home.zone, home.x, home.y, TALK_RADIUS) : false;
}

const nearPoint = (playerId, p) => !!p && cercaDe(playerId, p.zone, p.x, p.y, p.radius ?? 3);

// Lo que el cliente avisa: { kind: 'TALK', target: 'anciano' } o { kind: 'VISIT'|'INVESTIGATE'|'AMBUSH', target: objectiveId }.
// Devuelve lo que pasó, para que el cliente muestre el diálogo y recargue el diario.
async function interact(playerId, { kind, target }) {
  const active = (await db.query(
    `SELECT q.id, q.name, q.giver_npc FROM player_active_quests paq JOIN quests q ON q.id = paq.quest_id WHERE paq.player_id = $1`,
    [playerId]
  )).rows;
  const events = [];
  const notes = [];
  if (!active.length) return { events, notes };
  const states = await stepState(playerId, active.map((q) => q.id));
  let ambush = null;

  for (const q of active) {
    const st = states.get(q.id);
    if (!st || st.current == null) continue;
    for (const o of st.objectives) {
      if (o.step !== st.current || o.done) continue;
      const p = o.params ?? {};
      if (kind === 'TALK' && ['TALK', 'DELIVER'].includes(o.objective_type) && o.target_code === target) {
        if (!(await nearNpc(playerId, target, q.id, st.current))) {
          const moved = (await db.query('SELECT 1 FROM quest_npc_spots WHERE quest_id = $1 AND step = $2 AND npc = $3', [q.id, st.current, target])).rows.length;
          const who = NPC_HOMES[target]?.name ?? 'Esa persona';
          notes.push(moved ? `${who} te espera en otro lugar (míralo en el mapa).` : `Acércate más a ${who}.`);
          continue;
        }
        if (o.objective_type === 'DELIVER') {
          const have = await inventory.getQuantity(playerId, o.item_id);
          if (have < o.target_count) {
            const it = (await db.query('SELECT name FROM items WHERE id = $1', [o.item_id])).rows[0];
            notes.push(`Te faltan ${o.target_count - have} × ${it?.name ?? 'objetos'} para «${q.name}».`);
            continue;
          }
          await inventory.removeItem(playerId, o.item_id, o.target_count, 0, null);
        }
      } else if (['VISIT', 'INVESTIGATE', 'AMBUSH'].includes(kind) && o.objective_type === kind && Number(target) === o.id) {
        if (!nearPoint(playerId, p)) { notes.push('Todavía no estás en el lugar.'); continue; }
        if (kind === 'AMBUSH') {
          // el objetivo se cumple al ganar ese combate (lo marca combat.js al terminar)
          await db.query(
            `INSERT INTO player_quest_ambushes (player_id, objective_id)
             SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM player_quest_ambushes WHERE player_id = $1 AND objective_id = $2)`,
            [playerId, o.id]
          );
          ambush = { questId: q.id, objectiveId: o.id, monsters: p.monsters ?? [], text: p.dialog ?? null };
          continue;
        }
      } else {
        continue;
      }
      await setProgress(playerId, q.id, o.id, o.target_count, o.target_count);
      if (p.gives?.item) {
        const it = await itemIdByCode(p.gives.item);
        if (it) {
          await inventory.addItem(playerId, it.id, p.gives.qty ?? 1);
          events.push({ questId: q.id, gave: { name: it.name, qty: p.gives.qty ?? 1 } });
        }
      }
      events.push({
        questId: q.id, questName: q.name, objectiveId: o.id, type: o.objective_type,
        speaker: p.speaker ?? NPC_HOMES[o.target_code]?.name ?? null, dialog: p.dialog ?? null,
      });
    }
    // ¿perdiste algo que te dio el que te dio la misión? al hablarle te lo vuelve a dar
    if (kind === 'TALK' && q.giver_npc === target) {
      for (const o of st.objectives) {
        const gives = o.params?.gives;
        if (!o.done || !gives?.item) continue;
        const it = await itemIdByCode(gives.item);
        if (it && (await inventory.getQuantity(playerId, it.id)) === 0 && await stillNeeded(playerId, q.id, it.id)) {
          await inventory.addItem(playerId, it.id, gives.qty ?? 1);
          events.push({ questId: q.id, questName: q.name, speaker: NPC_HOMES[target]?.name ?? null, dialog: `¿Perdiste ${it.name}? Toma, ten más cuidado esta vez.`, gave: { name: it.name, qty: gives.qty ?? 1 } });
        }
      }
    }
  }

  // estado nuevo: qué misiones quedaron listas para entregar
  const after = await stepState(playerId, active.map((q) => q.id));
  for (const e of events) {
    const st = after.get(e.questId);
    e.questReady = !!st && st.current == null;
    e.step = st?.current ?? null;
  }
  return { events, notes, ambush };
}

// un objeto de misión sigue haciendo falta si un objetivo pendiente lo pide (entregarlo, juntarlo).
// Si ningún objetivo lo nombra (la llave del Vigía: abre la Cripta), hace falta hasta entregar la
// misión. Así, cuando ya le diste a Tilo su palo, Tilo no te regala otro.
async function stillNeeded(playerId, questId, itemId) {
  const r = await db.query('SELECT is_quest_item FROM items WHERE id = $1', [itemId]);
  if (!r.rows[0]?.is_quest_item) return false;
  const st = (await stepState(playerId, [questId])).get(questId);
  if (!st) return false;
  const users = st.objectives.filter((o) => o.item_id === itemId);
  return users.length ? users.some((o) => !o.done) : true;
}

// al fabricar: objetivos CRAFT del paso actual que piden ese objeto
async function registerCraft(playerId, itemId, qty) {
  const rows = (await db.query(
    `SELECT qo.id, qo.quest_id, qo.target_count FROM player_active_quests paq
     JOIN quest_objectives qo ON qo.quest_id = paq.quest_id
     WHERE paq.player_id = $1 AND qo.objective_type = 'CRAFT' AND qo.item_id = $2`,
    [playerId, itemId]
  )).rows;
  if (!rows.length) return;
  const allowed = await objectivesInCurrentStep(playerId, [...new Set(rows.map((r) => r.quest_id))]);
  for (const o of rows) {
    if (!allowed.has(o.id)) continue;
    await db.query(
      `INSERT INTO player_quest_progress(player_id, quest_id, quest_objective_id, current_count)
       VALUES ($1, $2, $3, LEAST($4::int, $5::int))
       ON CONFLICT (player_id, quest_objective_id)
       DO UPDATE SET current_count = LEAST(player_quest_progress.current_count + $4::int, $5::int), updated_at = now()`,
      [playerId, o.quest_id, o.id, qty, o.target_count]
    );
  }
}

// al ganar un combate: las emboscadas pendientes del jugador cuyos monstruos estaban en la pelea
async function registerAmbushWin(playerId, enemyCodes) {
  const rows = (await db.query(
    `SELECT a.objective_id, qo.quest_id, qo.target_count, qo.params FROM player_quest_ambushes a
     JOIN quest_objectives qo ON qo.id = a.objective_id
     JOIN player_active_quests paq ON paq.player_id = a.player_id AND paq.quest_id = qo.quest_id
     WHERE a.player_id = $1`,
    [playerId]
  )).rows;
  for (const r of rows) {
    const need = (r.params?.monsters ?? []).map((m) => m.code);
    if (need.length && !need.every((c) => enemyCodes.includes(c))) continue;
    await setProgress(playerId, r.quest_id, r.objective_id, r.target_count, r.target_count);
    await db.query('DELETE FROM player_quest_ambushes WHERE player_id = $1 AND objective_id = $2', [playerId, r.objective_id]);
  }
}

// Al abandonar o reiniciar: se borra el progreso, las emboscadas pendientes y los objetos de misión
// que esta misión entrega o pide (la llave, las cartas…), para que vuelva a empezar limpia.
async function resetQuestState(playerId, questId) {
  await db.query('DELETE FROM player_quest_progress WHERE player_id = $1 AND quest_id = $2', [playerId, questId]);
  await db.query(
    `DELETE FROM player_quest_ambushes WHERE player_id = $1
       AND objective_id IN (SELECT id FROM quest_objectives WHERE quest_id = $2)`,
    [playerId, questId]
  );
  const objs = (await db.query('SELECT item_id, params FROM quest_objectives WHERE quest_id = $1', [questId])).rows;
  const ids = new Set(objs.map((o) => o.item_id).filter(Boolean));
  for (const o of objs) {
    if (o.params?.gives?.item) {
      const it = await itemIdByCode(o.params.gives.item);
      if (it) ids.add(it.id);
    }
  }
  if (!ids.size) return;
  await db.query(
    `DELETE FROM player_inventory WHERE player_id = $1 AND item_id = ANY($2::int[])
       AND item_id IN (SELECT id FROM items WHERE is_quest_item)`,
    [playerId, [...ids]]
  );
}

// Dónde están los NPCs que se movieron por una misión (para el mapa): solo los del paso actual de
// las misiones activas del jugador.
async function npcSpotsFor(playerId) {
  const active = (await db.query('SELECT quest_id FROM player_active_quests WHERE player_id = $1', [playerId])).rows.map((r) => r.quest_id);
  if (!active.length) return [];
  const states = await stepState(playerId, active);
  const spots = (await db.query('SELECT * FROM quest_npc_spots WHERE quest_id = ANY($1::int[])', [active])).rows;
  return spots
    .filter((s) => states.get(s.quest_id)?.current === s.step)
    .map((s) => ({ questId: s.quest_id, npc: s.npc, zone: s.zone, x: s.x, y: s.y, hideHome: s.hide_home }));
}

// Error amable si alguno es objeto de misión (no se vende, regala, publica ni manda por correo)
async function assertNotQuestItems(itemIds) {
  const ids = [...new Set(itemIds.filter(Boolean).map(Number))];
  if (!ids.length) return;
  const r = await db.query('SELECT name FROM items WHERE id = ANY($1::int[]) AND is_quest_item LIMIT 1', [ids]);
  if (r.rows.length) {
    const err = new Error(`${r.rows[0].name} es un objeto de misión: no se puede vender, regalar ni enviar.`);
    err.status = 400;
    throw err;
  }
}

module.exports = {
  NPC_HOMES, PROGRESS_TYPES, stepState, objectivesInCurrentStep, interact, registerCraft, registerAmbushWin,
  resetQuestState, npcSpotsFor, assertNotQuestItems,
};
