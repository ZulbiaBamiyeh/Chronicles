// Flow control: which screen is up, what the finger is doing, and the two
// animations (the path flipping left to right, and the duel playing out blow by
// blow). All the rules live in engine.js — this file only ever asks it questions
// and replays the answers.

import { ShaderBackground } from './bg.js';
import { AudioEngine } from './audio.js';
import { card, cardText, fxText, attackAnim, counterText } from './cards.js';
import {
  newRun, startRound, resolvePath, duel, settleFinale, advanceDay,
  toGhost, spendCard, resolveSendFight, ghostFighter,
  tiersForRound, rng, PATH_SLOTS, RUN_DAYS,
  refillHand, mulliganHand, resolveAmbush,
} from './engine.js';
import { randomName } from './ghosts.js';
import { drawRival, rivalOnDay, intel, tickRivalHp } from './rival.js';
import * as deckLib from './deck.js';
import * as store from './storage.js';
import {
  $, el, glyphEl, cardEl, renderHud, duelistEl, feedLine, rivalPanel, MONSTER_GLYPH, ICON,
  PORTRAIT, portraitFor, ANIM,
} from './ui.js';

const audio = new AudioEngine();
const bg = new ShaderBackground(document.getElementById('bg-canvas'));

// ---- run + round state ----------------------------------------------------

let run = null;          // the persisted run (see storage.js)
let slots = [];          // PATH_SLOTS entries of {id, from, upgrade} | null
let send = null;         // {id, from} — the monster you play at the rival
let roundSeed = 0;       // seeds this round's deal
let outcome = null;      // the resolved path, kept for the duel and the result
let rival = null;        // one opponent for the whole run (see js/rival.js)
let ghost = null;        // that rival as they stood on today's day
let duelResult = null;
let scouted = false;     // Watchtower revealed the rival's secrets this round

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fights are paced to be read, which is right the first time and slow the
// twentieth. This divides every delay in the replay, and persists, so a player
// who has internalised the rules isn't made to sit through them.
const SPEEDS = [1, 2, 4];
let duelSpeed = 1;

const tierLabel = (round) => tiersForRound(round).map((t) => `T${t}`).join('+');

// ---- screens --------------------------------------------------------------

const SCREENS = ['title', 'run', 'duel', 'result', 'over', 'howto', 'deck'];
let current = 'title';

function show(name) {
  current = name;
  for (const s of SCREENS) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  window.scrollTo(0, 0);
}

// ---- title ----------------------------------------------------------------

function renderTitle() {
  const save = store.load();
  const resumable = save.run && !save.run.over;
  $('#btn-continue').classList.toggle('hidden', !resumable);
  $('#btn-start').textContent = resumable ? 'ABANDON & START OVER' : 'START RUN';
  $('#btn-start').classList.toggle('btn-gold', !resumable);
  $('#btn-start').classList.toggle('btn-ghost', Boolean(resumable));

  const lt = save.lifetime;
  $('#lifetime').textContent = lt.runs
    ? `${lt.runs} run${lt.runs === 1 ? '' : 's'} · ${lt.completed} completed · ${lt.duelsWon}W ${lt.duelsLost}L`
    : '';

  // §8.4's retention hook. In the prototype nobody is really fighting your
  // ghost while you're away, so this is flagged as a stand-in rather than
  // dressed up as a real overnight tally.
  const report = store.ghostReport();
  const line = $('#ghost-report');
  if (report && report.won > 0) {
    line.textContent = `${report.name} won ${report.won} duel${report.won === 1 ? '' : 's'} overnight.`;
    line.classList.remove('hidden');
  } else {
    line.classList.add('hidden');
  }
  show('title');
  audio.setStyle('menu');
}

// ---- deck builder ---------------------------------------------------------
//
// Thirty cards, ten per tier, assembled before a run. The tier split is what
// keeps this compatible with §9's difficulty curve: the day still decides
// which tiers it deals from, the deck decides what's in them.

let editing = [];        // the deck being edited, as card ids
let deckTierShown = 1;

function openDeck() {
  audio.click();
  editing = [...(store.deck() || deckLib.defaultDeck())];
  deckTierShown = 1;
  renderPresets();
  renderDeck();
  show('deck');
}

function renderPresets() {
  const row = $('#deck-preset-row');
  row.textContent = '';
  for (const key of deckLib.PRESET_KEYS) {
    const p = deckLib.preset(key);
    const btn = el('button', 'deck-preset');
    btn.type = 'button';
    btn.append(el('b', null, p.name), el('span', null, p.blurb));
    btn.addEventListener('click', () => {
      audio.click();
      editing = deckLib.presetCards(key);
      renderDeck();
    });
    row.appendChild(btn);
  }
}

function renderDeck() {
  const probs = deckLib.problems(editing);
  const status = $('#deck-status');
  status.textContent = '';
  status.classList.toggle('bad', probs.length > 0);
  if (probs.length) {
    for (const p of probs) status.appendChild(el('div', 'deck-problem', p));
  } else {
    status.appendChild(el('div', 'deck-ok', `Legal — ${editing.length} cards, ready to run.`));
  }
  $('#btn-deck-save').disabled = probs.length > 0;

  for (const tab of document.querySelectorAll('.deck-tab')) {
    const tier = Number(tab.dataset.tier);
    const n = deckLib.deckTier(editing, tier).length;
    tab.classList.toggle('on', tier === deckTierShown);
    tab.classList.toggle('full', n === deckLib.PER_TIER);
    tab.textContent = `TIER ${tier} · ${n}/${deckLib.PER_TIER}`;
  }

  const mount = $('#deck-pool');
  mount.textContent = '';
  const chosen = new Set(editing);
  for (const c of deckLib.pool(deckTierShown)) {
    const inDeck = chosen.has(c.id);
    const wrap = el('div', `deck-card${inDeck ? ' in' : ''}`);
    wrap.appendChild(cardEl(c.id, { size: 'hand' }));
    wrap.appendChild(el('div', 'deck-mark', inDeck ? '✓' : '+'));
    wrap.addEventListener('click', () => toggleCard(c.id));
    mount.appendChild(wrap);
  }

  renderChosenList();
}

/**
 * The desktop-only sidebar: everything currently in the deck, grouped by
 * tier, each entry removable with a tap — a second way to see and edit the
 * deck that doesn't require hunting the checkmark down in the picker grid.
 */
function renderChosenList() {
  const mount = $('#deck-chosen');
  mount.textContent = '';
  for (const tier of deckLib.TIERS) {
    const ids = deckLib.deckTier(editing, tier);
    const group = el('div', 'chosen-group');
    group.appendChild(el('div', 'chosen-tier-label', `TIER ${tier} · ${ids.length}/${deckLib.PER_TIER}`));
    for (const id of ids) {
      const c = card(id);
      const row = el('button', 'chosen-row');
      row.type = 'button';
      row.append(
        glyphEl('chosen-icon', ICON[id] || '❔', c.name),
        el('span', 'chosen-name', c.name),
        el('span', 'chosen-remove', '✕'),
      );
      row.addEventListener('click', () => toggleCard(id));
      group.appendChild(row);
    }
    mount.appendChild(group);
  }
}

function toggleCard(id) {
  const at = editing.indexOf(id);
  if (at >= 0) {
    editing.splice(at, 1);
    audio.lift2();
  } else {
    const tier = card(id).tier;
    if (deckLib.deckTier(editing, tier).length >= deckLib.PER_TIER) {
      // Full tier: say so rather than silently ignoring the tap.
      shake($('#deck-status'));
      audio.fizzle();
      return;
    }
    editing.push(id);
    audio.place();
  }
  renderDeck();
}

function saveDeck() {
  if (!deckLib.isLegal(editing)) return;
  store.saveDeck(editing);
  audio.victory();
  renderTitle();
}

// ---- starting a round -----------------------------------------------------

function beginRound() {
  run = startRound(run);   // no-op if this round's upkeep already ran (a resumed save)
  roundSeed = (run.seed + run.round * 7919 + run.wins * 104729 + run.losses * 15485863) >>> 0;
  // Idempotent the same way startRound() is: a hand already refilled for this
  // round (a resumed save) isn't drawn again — the opener you got is the
  // opener you keep, not a chance to reroll by leaving and coming back.
  if (run.handDrawnForRound !== run.round) {
    const { hand, seenCards } = refillHand(run, rng(roundSeed ^ 0x1357bd91));
    run = { ...run, hand, seenCards, handDrawnForRound: run.round };
  }
  slots = new Array(PATH_SLOTS).fill(null);
  send = null;
  outcome = null;
  scouted = false;
  // The rival was decided when the run started and doesn't change; today's
  // opponent is simply them, as they stood on this day of their own run.
  if (!rival) rival = drawRival(run.rivalSeed);
  ghost = rivalOnDay(rival, run.round);
  // HP carries across days the same way yours does — only tick once per day
  // so resuming a save doesn't heal them a second time.
  if (run.rivalTickedForRound !== run.round) {
    run = {
      ...run,
      rivalCombat: tickRivalHp(run.rivalCombat, ghost),
      rivalTickedForRound: run.round,
    };
  }
  store.saveRun(run);

  $('#plan-area').classList.remove('hidden');
  $('#resolve-area').classList.add('hidden');
  $('#rival-panel').classList.remove('hidden');
  $('#btn-to-duel').classList.add('hidden');
  $('#resolve-log').textContent = '';
  $('#path-fight-stage').classList.add('hidden');
  renderPlan();
  show('run');
  audio.setStyle('plan');
  if (run.round === 1 && !run.mulliganDone) openMulligan();
  else closeMulligan();
}

// ---- planning -------------------------------------------------------------

function renderPlan() {
  renderHud(run, tierLabel(run.round));
  renderRival();
  renderPath();
  renderHand();
  // A day's hand can legitimately come back thinner than the path is long —
  // late in a run, once a deck's tier pool is running dry — so embarking only
  // needs every placeable card placed, not literally four full slots.
  const pathPlaced = slots.filter(Boolean).length;
  const busy = pathPlaced + (send ? 1 : 0);
  const unplaced = run.hand.length - busy;
  const pathReady = slots.every(Boolean) || (pathPlaced > 0 && unplaced === 0);
  const sendReady = Boolean(send && card(send.id)?.type === 'monster');
  const full = pathReady && sendReady;
  $('#btn-embark').disabled = !full;
  $('#hand-hint').textContent = full
    ? 'Drag slots to reorder'
    : sendReady
      ? `Tap to place · ${pathPlaced}/${PATH_SLOTS}`
      : 'Send a monster at them to embark';
}

const mulliganPick = new Set();

function openMulligan() {
  mulliganPick.clear();
  $('#mulligan-overlay').classList.remove('hidden');
  document.querySelector('.path-wrap')?.classList.add('hidden');
  $('#plan-area').classList.add('hidden');
  $('#rival-panel').classList.add('hidden');
  renderMulliganHand();
}

function closeMulligan() {
  $('#mulligan-overlay')?.classList.add('hidden');
  document.querySelector('.path-wrap')?.classList.remove('hidden');
  $('#plan-area').classList.remove('hidden');
  $('#rival-panel').classList.remove('hidden');
}

function renderMulliganHand() {
  const mount = $('#mulligan-hand');
  mount.textContent = '';
  run.hand.forEach((id, i) => {
    const wrap = el('div', `mulligan-card${mulliganPick.has(i) ? ' replace' : ''}`);
    wrap.dataset.index = String(i);
    wrap.appendChild(cardEl(id, { run, size: 'hand' }));
    if (mulliganPick.has(i)) wrap.appendChild(el('div', 'mulligan-x', 'REPLACE'));
    wrap.addEventListener('click', () => {
      if (mulliganPick.has(i)) mulliganPick.delete(i);
      else mulliganPick.add(i);
      audio.click();
      renderMulliganHand();
    });
    mount.appendChild(wrap);
  });
  const n = mulliganPick.size;
  $('#btn-mulligan-confirm').textContent = n ? `CONFIRM · REPLACE ${n}` : 'KEEP ALL';
}

function confirmMulligan() {
  const spin = (roundSeed ^ 0x1357bd91) >>> 0;
  run = mulliganHand(run, [...mulliganPick], rng(spin));
  store.saveRun(run);
  audio.place();
  closeMulligan();
  renderPlan();
}

/**
 * The rival readout above the hand. A Watchtower placed anywhere in the path
 * reveals their secrets — and it updates live as you plan, so you can see
 * what scouting would buy you before you commit the slot.
 */
function renderRival() {
  const willScout = slots.some((s) => s && card(s.id)?.scout);
  const info = intel(rival, run.round, willScout);
  if (run.rivalCombat) {
    info.hp = run.rivalCombat.hp;
    info.maxHp = run.rivalCombat.maxHp;
  }
  rivalPanel($('#rival-panel'), info, {
    wins: run.wins, losses: run.losses, days: RUN_DAYS,
  });
}

function renderPath() {
  const mount = $('#path');
  mount.textContent = '';
  slots.forEach((slot, i) => {
    const cell = el('div', 'slot');
    cell.dataset.slot = String(i);
    if (slot) {
      cell.classList.add('filled');
      cell.appendChild(cardEl(slot.id, { run, size: 'slot', upgrade: slot.upgrade }));
    } else {
      cell.appendChild(el('span', 'slot-num', i + 1));
    }
    mount.appendChild(cell);
  });
  renderSend();
}

function renderSend() {
  const cell = $('#send-slot');
  if (!cell) return;
  const label = document.querySelector('.send-label');
  if (label) label.textContent = ghost ? `FOR ${ghost.name.split(' ')[0]}` : 'FOR THEM';
  cell.textContent = '';
  cell.classList.toggle('filled', Boolean(send));
  if (send) cell.appendChild(cardEl(send.id, { run, size: 'slot' }));
  else cell.appendChild(el('span', 'slot-num', '⚔'));
}

function renderHand() {
  const mount = $('#hand');
  mount.textContent = '';
  const placed = [
    ...slots.filter((s) => s && s.from === 'hand').map((s) => s.id),
    ...(send ? [send.id] : []),
  ];
  const spent = new Set();
  run.hand.forEach((id) => {
    const node = cardEl(id, { run, size: 'hand' });
    // A dealt card that's already in the path stays in place, greyed out, so
    // the grid never reflows under a finger mid-plan.
    const isPlaced = placed.includes(id) && !spent.has(id);
    if (isPlaced) {
      spent.add(id);
      node.classList.add('placed');
    }
    const wrap = el('div', 'hand-card');
    wrap.appendChild(node);
    mount.appendChild(wrap);
  });
}

/** Put a card in the first free path slot, or the send slot if it's a leftover monster. */
function place(id, from) {
  const free = slots.indexOf(null);
  if (free >= 0) {
    slots[free] = { id, from, upgrade: false };
    audio.place();
    renderPlan();
    return true;
  }
  if (!send && card(id)?.type === 'monster') {
    send = { id, from };
    audio.place();
    renderPlan();
    return true;
  }
  return false;
}

function unplace(index) {
  if (index === 'send') {
    if (!send) return;
    send = null;
    audio.lift2();
    renderPlan();
    return;
  }
  if (!slots[index]) return;
  slots[index] = null;
  audio.lift2();
  renderPlan();
}

function placeSend(id, from) {
  if (card(id)?.type !== 'monster') {
    shake($('#send-slot'));
    audio.fizzle();
    return false;
  }
  send = { id, from };
  audio.place();
  renderPlan();
  return true;
}

function placeAt(index, id, from) {
  const existing = slots[index];
  // Dropping onto an occupied slot sends the occupant back where it came from,
  // which is what "swap" means when one of the two is still in your hand.
  slots[index] = { id, from, upgrade: false };
  if (existing && existing.id === id && existing.from === from) return;
  audio.place();
  renderPlan();
}

function swapSlots(a, b) {
  if (a === b) return;
  [slots[a], slots[b]] = [slots[b], slots[a]];
  audio.place();
  renderPlan();
}

// ---- pointer handling: tap to place, drag to arrange ----------------------
//
// One gesture recogniser drives everything. A press that doesn't move is a tap;
// a press that moves more than a few pixels picks the card up and follows the
// finger; a press that stays put for half a second opens the detail sheet.
// Doing it in one place is what keeps the two interaction styles from fighting
// each other on a touchscreen.

const DRAG_THRESHOLD = 8;
let gesture = null;

function cardSource(target) {
  const sendCell = target.closest('#send-slot');
  if (sendCell && send) return { kind: 'send', id: send.id };
  const slotCell = target.closest('#path .slot');
  if (slotCell && slotCell.querySelector('.card')) {
    return { kind: 'slot', index: Number(slotCell.dataset.slot), id: slots[Number(slotCell.dataset.slot)].id };
  }
  const handCard = target.closest('#hand .card');
  if (handCard && !handCard.classList.contains('placed')) return { kind: 'hand', id: handCard.dataset.id };
  return null;
}

function onPointerDown(ev) {
  // Planning only — during resolution and on every other screen the path is
  // a readout, not a board.
  if (current !== 'run' || $('#plan-area').classList.contains('hidden')) return;

  // The paid-upgrade toggle on a placed Place card is a button, not a handle.
  if (ev.target.closest('[data-role="upgrade"]')) {
    const cell = ev.target.closest('.slot');
    if (cell) {
      const i = Number(cell.dataset.slot);
      slots[i].upgrade = !slots[i].upgrade;
      audio.click();
      renderPlan();
    }
    ev.preventDefault();
    return;
  }

  const src = cardSource(ev.target);
  if (!src) return;
  gesture = {
    src,
    x0: ev.clientX,
    y0: ev.clientY,
    dragging: false,
    node: null,
    longPress: setTimeout(() => {
      if (gesture && !gesture.dragging) {
        gesture.opened = true;
        openDetail(src.id);
      }
    }, 450),
  };
  ev.preventDefault();
}

function onPointerMove(ev) {
  if (!gesture) return;
  const dx = ev.clientX - gesture.x0;
  const dy = ev.clientY - gesture.y0;
  if (!gesture.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

  if (!gesture.dragging) {
    if (gesture.opened) { gesture = null; return; }
    clearTimeout(gesture.longPress);
    gesture.dragging = true;
    audio.lift();
    const ghostCard = cardEl(gesture.src.id, { run, size: 'slot' });
    ghostCard.classList.add('dragging');
    $('#drag-layer').appendChild(ghostCard);
    gesture.node = ghostCard;
    document.body.classList.add('is-dragging');
  }
  gesture.node.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%, -50%) rotate(-3deg)`;
  highlightSlotUnder(ev.clientX, ev.clientY);
}

function highlightSlotUnder(x, y) {
  const over = slotUnder(x, y);
  for (const cell of document.querySelectorAll('#path .slot, #send-slot')) {
    cell.classList.toggle('over', cell === over);
  }
}

function slotUnder(x, y) {
  const node = document.elementFromPoint(x, y);
  if (!node) return null;
  return node.closest('#send-slot') || node.closest('#path .slot');
}

function onPointerUp(ev) {
  if (!gesture) return;
  clearTimeout(gesture.longPress);
  const g = gesture;
  gesture = null;

  if (!g.dragging) {
    if (g.opened) return;
    // A plain tap: into the path from the hand, back out from a slot.
    if (g.src.kind === 'slot') unplace(g.src.index);
    else if (g.src.kind === 'send') unplace('send');
    else if (!place(g.src.id, g.src.kind)) shake($('#path'));
    return;
  }

  g.node.remove();
  document.body.classList.remove('is-dragging');
  for (const cell of document.querySelectorAll('#path .slot, #send-slot')) cell.classList.remove('over');

  const target = slotUnder(ev.clientX, ev.clientY);
  if (target && target.id === 'send-slot') {
    if (g.src.kind === 'slot') {
      const from = g.src.index;
      const occupant = send;
      if (card(slots[from].id)?.type !== 'monster') {
        shake(target);
        audio.fizzle();
      } else {
        send = { id: slots[from].id, from: slots[from].from };
        slots[from] = occupant ? { ...occupant, upgrade: false } : null;
        audio.place();
        renderPlan();
      }
    } else {
      placeSend(g.src.id, g.src.kind);
    }
  } else if (target) {
    const index = Number(target.dataset.slot);
    if (g.src.kind === 'slot') swapSlots(g.src.index, index);
    else if (g.src.kind === 'send') {
      const occupant = slots[index];
      slots[index] = { id: send.id, from: send.from, upgrade: false };
      send = occupant && card(occupant.id)?.type === 'monster'
        ? { id: occupant.id, from: occupant.from }
        : null;
      if (occupant && !send) {
        // Occupant wasn't a monster — it goes back to hand, send stays empty
        // unless we can keep it on the path. Already placed on the path.
      }
      audio.place();
      renderPlan();
    } else placeAt(index, g.src.id, g.src.kind);
  } else if (g.src.kind === 'slot') {
    // Dragged off the path entirely — put it back.
    unplace(g.src.index);
  } else if (g.src.kind === 'send') {
    unplace('send');
  }
}

function shake(node) {
  node.classList.remove('shake');
  void node.offsetWidth;
  node.classList.add('shake');
}

// ---- card detail ----------------------------------------------------------

function openDetail(id) {
  const c = card(id);
  const mount = $('#detail-card');
  mount.textContent = '';
  mount.appendChild(cardEl(id, { run, size: 'detail' }));
  const note = el('p', 'detail-note');
  if (c.type === 'monster') {
    note.textContent = `Fight it for ${c.gold} gold — or send it at your rival.`;
  } else if (c.type === 'gear' || c.type === 'ally') {
    note.textContent = 'Permanent for the rest of the run.';
  } else {
    note.textContent = 'Free to enter.';
  }
  mount.appendChild(note);
  $('#detail').classList.remove('hidden');
  audio.click();
}

// ---- embark: replay the path ---------------------------------------------

async function embark() {
  audio.click();
  outcome = resolvePath(run, slots);
  if (send) {
    outcome = { ...outcome, state: spendCard(outcome.state, send.id), sendId: send.id };
  }
  scouted = outcome.usedWatchtower;
  // No draw here any more: today's opponent has been fixed since the run
  // began. That's the point — the path you just committed to was planned
  // against this specific person.

  $('#plan-area').classList.add('hidden');
  $('#resolve-area').classList.remove('hidden');
  $('#rival-panel').classList.add('hidden');
  $('#resolve-log').textContent = '';
  audio.setStyle('path');

  // Face every slot down, then flip them one at a time.
  const cells = [...document.querySelectorAll('#path .slot')];
  for (const cell of cells) cell.classList.add('facedown');

  for (const ev of outcome.events) {
    await sleep(280);
    const cell = cells[ev.slot];
    cell.classList.remove('facedown');
    cell.classList.add('flipping');
    audio.flip();
    await sleep(260);
    cell.classList.remove('flipping');
    cell.classList.add('active');
    await playSlot(ev, cell);
    cell.classList.remove('active');
    cell.classList.add('done');
  }

  // The rival's invasion, if this day has one: a forced fifth fight, after
  // the planned path and before the duel. Not a card either side played —
  // the consequence of who you're matched against.
  if (ghost.invasion) {
    await sleep(400);
    const invCard = card(ghost.invasion);
    feedLine($('#resolve-log'), `${ghost.name} has sent ${invCard.name} to slow you down.`, 'log-invasion');
    const ambush = resolveAmbush(outcome.state, ghost.invasion);
    await playAmbush(ambush.event, invCard);
    outcome = {
      ...outcome,
      state: ambush.state,
      pathDamage: outcome.pathDamage + ambush.damage,
      cleanPath: outcome.cleanPath && ambush.damage === 0,
    };
    if (ambush.killed) audio.kill();
    else audio.defeat();
    const bits = [];
    if (ambush.killed) {
      bits.push(`${invCard.name} falls in ${ambush.event.exchanges} exchange${ambush.event.exchanges === 1 ? '' : 's'}`);
      bits.push(`−${ambush.damage} HP`);
      if (ambush.event.gold) bits.push(`+${ambush.event.gold} gold`);
      if (ambush.event.trophy) bits.push(fxText(ambush.event.trophy));
      if (ambush.event.drop) bits.push(`took ${card(ambush.event.drop).name}`);
    } else {
      bits.push(`You go down to ${invCard.name}`);
      bits.push('no spoils');
      bits.push("you won't heal tomorrow");
    }
    if (ambush.killed && ambush.down) bits.push("you fall with it — you won't heal tomorrow");
    feedLine($('#resolve-log'), `${bits.join(' · ')}.`,
      ambush.killed && !ambush.down ? 'log-good' : 'log-bad');
    renderHud(ambush.state, tierLabel(run.round));
    await sleep(500);
  }

  if (outcome.sendId) {
    await sleep(400);
    const sentCard = card(outcome.sendId);
    const them = ghostFighter({
      ...ghost,
      hp: run.rivalCombat?.hp ?? ghost.hp,
      maxHp: run.rivalCombat?.maxHp ?? ghost.maxHp,
    });
    const watched = resolveSendFight(them, outcome.sendId);
    outcome = {
      ...outcome,
      rivalCombat: { hp: watched.fighter.hp, maxHp: them.maxHp, bruised: watched.bruised },
      sendFight: watched,
    };
    feedLine($('#resolve-log'),
      `${ghost.name} faces the ${sentCard.name} you sent.`, 'log-ghost');
    await playWatchThem(watched.event, sentCard);
    const bits = [
      `${sentCard.name} vs ${ghost.name} · ${watched.event.exchanges} exchange${watched.event.exchanges === 1 ? '' : 's'}`,
    ];
    if (watched.down) bits.push('they go down — they won’t heal tomorrow');
    else bits.push(`they take ${watched.damage} · ${watched.fighter.hp}/${them.maxHp} left`);
    feedLine($('#resolve-log'), `${bits.join(' — ')}.`, watched.down ? 'log-good' : (watched.damage > 0 ? 'log-good' : ''));
    await sleep(400);
  }

  await sleep(300);
  const log = $('#resolve-log');
  const finale = run.round >= RUN_DAYS;
  if (scouted && ghost.secrets.length) {
    const names = ghost.secrets.map((id) => card(id).name).join(' and ');
    feedLine(log, `Orbis Tower shows ${ghost.name} has laid ${names}.`, 'log-ghost');
  } else if (finale) {
    feedLine(log, `Day ${RUN_DAYS}. ${ghost.name} is waiting in the open.`, 'log-ghost');
  } else {
    feedLine(log, `${ghost.name} walks off with ${outcome.rivalCombat?.hp ?? ghost.hp} HP. You fight after day ${RUN_DAYS}.`, 'log-ghost');
  }
  const btn = $('#btn-to-duel');
  btn.textContent = finale ? 'FINAL BATTLE' : 'END DAY';
  btn.classList.remove('hidden');
}

async function playSlot(ev, cell) {
  const log = $('#resolve-log');
  const c = ev.id ? card(ev.id) : null;

  if (ev.kind === 'empty') return;

  if (ev.kind === 'fizzle') {
    cell.classList.add('fizzled');
    audio.fizzle();
    feedLine(log, `${c.name} — can't afford ${ev.cost} gold. Fizzles.`, 'log-bad');
    await sleep(900);
    return;
  }

  if (ev.kind === 'secret') {
    cell.classList.add('secret-laid');
    audio.lift();
    burst(cell, 'secret', 4);
    float(cell, 'LAID', 'secret');
    feedLine(log, `${c.name} laid — ${cardText(c).replace(/\.$/, '')} in the duel.`, 'log-secret');
    await sleep(900);
    return;
  }

  if (ev.kind === 'fight') {
    await playPathFight(ev, c);
    audio.kill();
    audio.coin(2);
    burst(cell, 'gold', 6);
    float(cell, `+${ev.gold}◉`, 'gold');
    const bits = [`${c.name} falls in ${ev.exchanges} exchange${ev.exchanges === 1 ? '' : 's'}`,
                  `−${ev.damage} HP`, `+${ev.gold} gold`];
    if (ev.trophy) {
      bits.push(fxText(ev.trophy));
      // A trophy is the reason to pick the fight you didn't have to — give it
      // its own beat rather than letting it vanish into the gold shower.
      await sleep(320);
      audio.heal();
      burst(cell, 'trophy', 5);
      float(cell, fxText(ev.trophy), 'trophy');
    }
    feedLine(log, `${bits.join(' · ')}.`, ev.damage > 0 ? '' : 'log-good');
    applySnap(ev.snap);
    await sleep(500);
    return;
  }

  // Gear, ally, place.
  const fx = ev.fx || {};
  const shown = { ...fx };
  if (ev.upgraded) {
    for (const [k, v] of Object.entries(c.option.fx)) {
      shown[k] = typeof v === 'boolean' ? v : (shown[k] || 0) + v;
    }
  }
  if (fx.heal || fx.healFull) { audio.heal(); burst(cell, 'heal', 5); }
  else if (fx.gold) { audio.coin(3); burst(cell, 'gold', 6); }
  else { audio.place(); if (BUFF_BURST(shown)) burst(cell, BUFF_BURST(shown), 4); }
  // An ally whose whole effect is a recurring perk has no immediate fx to
  // print, so fall back to the card's own wording instead of an em dash.
  const line = fxText(shown);
  const summary = line === '—' ? cardText(c) : `${line}.`;
  float(cell, line === '—' ? c.name : line, 'good');
  const paid = ev.cost + (ev.upgraded ? c.option.cost : 0);
  feedLine(log, `${c.name}${paid ? ` (−${paid} gold)` : ''} — ${summary}`, 'log-good');
  applySnap(ev.snap);
  await sleep(900);
}

/**
 * Plays a monster fight out in the same equip-grid, exchange-by-exchange
 * presentation as the duel — §4's whole premise is one resolver for both, so
 * a creep fight deserves the same clarity as the one against a ghost, not a
 * single compressed damage number. Faster-paced than the duel (there can be
 * up to four of these in one path) but otherwise identical machinery.
 */
async function playPathFight(ev, c) {
  const stage = $('#path-fight-stage');
  stage.classList.remove('hidden');
  const me = duelistEl($('#path-fight-me'), ev.me, {
    glyph: PORTRAIT.player, anim: ANIM.player, sub: `day ${run.round}`, facing: 'right',
  });
  const monster = duelistEl($('#path-fight-them'), ev.monster, {
    glyph: MONSTER_GLYPH[ev.id] || ICON[ev.id] || '❔',
    anim: ANIM[ev.id],
    sub: `Tier ${c.tier} monster`,
    facing: 'left',
  });
  await sleep(400);
  await replayLog({
    side: { a: me, b: monster },
    fighter: { a: ev.me, b: ev.monster },
    log: ev.log,
    speed: 0.72,
  });
  await sleep(300);
  stage.classList.add('hidden');
}

/**
 * Plays the rival's invasion monster — the same stage and machinery as a
 * path fight, but framed as what it is: not a card the player chose, a
 * threat the rival sent. Full duel pace (not the path's hurried 0.72×), so
 * a fight nobody planned for still gets the weight of being forced.
 */
async function playAmbush(ev, c) {
  const stage = $('#path-fight-stage');
  stage.classList.remove('hidden');
  stage.classList.add('ambush');
  const me = duelistEl($('#path-fight-me'), ev.me, {
    glyph: PORTRAIT.player, anim: ANIM.player, sub: 'they sent this', facing: 'right',
  });
  const monster = duelistEl($('#path-fight-them'), ev.monster, {
    glyph: MONSTER_GLYPH[c.id] || ICON[c.id] || '❔',
    anim: ANIM[c.id],
    sub: `sent by ${ghost.name}`,
    facing: 'left',
  });
  await sleep(500);
  await replayLog({
    side: { a: me, b: monster },
    fighter: { a: ev.me, b: ev.monster },
    log: ev.log,
  });
  await sleep(300);
  stage.classList.remove('ambush');
  stage.classList.add('hidden');
}

/**
 * The rival fighting the monster you sent — same stage as a path fight, but
 * you are watching, not swinging. Their kit is on the panel so you can see
 * what they're actually wearing.
 */
async function playWatchThem(ev, c) {
  const stage = $('#path-fight-stage');
  stage.classList.remove('hidden');
  stage.classList.add('watch');
  // Left: the monster you sent. Right: the rival, kit visible.
  const monster = duelistEl($('#path-fight-me'), ev.monster, {
    glyph: MONSTER_GLYPH[c.id] || ICON[c.id] || '❔',
    anim: ANIM[c.id],
    sub: 'your send',
    facing: 'right',
  });
  const them = duelistEl($('#path-fight-them'), ev.me, {
    glyph: portraitFor(ghost.archetype),
    anim: ANIM[ghost.archetype],
    sub: `${ghost.archetype} · their kit`,
    facing: 'left',
  });
  await sleep(500);
  await replayLog({
    side: { a: them, b: monster },
    fighter: { a: ev.me, b: ev.monster },
    log: ev.log,
  });
  await sleep(300);
  stage.classList.remove('watch');
  stage.classList.add('hidden');
}

/**
 * Replays a resolved fight's exchange log into a feed, updating both fighter
 * panels — HP bar, hit flash, and a pulse on whichever equip slot dealt the
 * blow — as it goes. Shared by the duel and every path monster fight.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.feed
 * @param {{a: object, b: object}} opts.side  the two duelistEl() handles
 * @param {{a: string, b: string}} opts.who   display names
 * @param {Array} opts.log        resolveCombat's log, in order
 * @param {{a: number, b: number}} opts.startHp
 * @param {{a: number, b: number}} opts.maxHp
 * @param {number} [opts.speed]   pacing multiplier — 1 for the duel, faster for the path
 */
const SOURCE_SLOT = { attack: 'atk', firstStrike: 'atk', poison: 'poison', thorns: 'thorns' };

// Each step of §4's exchange order, as the player needs to understand it.
// Announcing the phase before it resolves is the single biggest thing that
// makes a fight readable: without it, poison, the trade, and the thorns
// reflection all land in one indistinguishable burst and the player is left
// watching numbers move for reasons they can't reconstruct.
const PHASE = {
  poison: { label: 'POISON', note: 'ignores Armour', icon: '☠' },
  firstStrike: { label: 'FIRST STRIKE', note: 'a free opening blow', icon: '👢' },
  attack: { label: 'ATTACK', note: 'both sides swing at once', icon: '⚔' },
  thorns: { label: 'THORNS', note: 'answers the blow that landed', icon: '✸' },
};

const VERB = {
  poison: 'poison eats at', thorns: 'thorns bite', firstStrike: 'strikes first at', attack: 'hits',
};

/** Groups a fight log into exchanges, and each exchange into its §4 phases. */
function phasesOf(log) {
  const out = [];
  for (const entry of log) {
    const last = out[out.length - 1];
    if (last && last.ex === entry.ex && last.source === entry.source) last.entries.push(entry);
    else out.push({ ex: entry.ex, source: entry.source, entries: [entry] });
  }
  return out;
}

/**
 * Replays a resolved fight, phase by phase — visually only. No text log:
 * what's happening is read off the animation itself — a strike shaped like
 * the weapon that threw it, a poison bubble rising off whoever it's eating,
 * an equip slot pulsing to say which stat did this — not narrated in a
 * scrolling feed alongside it. Pacing is unchanged and still does the real
 * work of legibility: everything that happens for one reason still lands
 * together, with a beat before and after, so a four-keyword exchange still
 * reads as four distinct things happening rather than a blur. `duelSpeed`
 * lets a player who's internalised the rules wind the whole thing forward.
 */
async function replayLog({ side, fighter, log, speed = 1 }) {
  const hp = { a: fighter.a.hp, b: fighter.b.hp };
  const maxHp = { a: fighter.a.maxHp, b: fighter.b.maxHp };
  const pace = (ms) => sleep((ms * speed) / duelSpeed);

  let ex = 0;
  for (const phase of phasesOf(log)) {
    if (phase.ex !== ex) {
      ex = phase.ex;
      await pace(520);
      await pace(360);
    }
    await pace(440);

    // Everything in a phase happens for the same reason, so it lands together
    // — but staggered just enough that two simultaneous hits read as two.
    for (const entry of phase.entries) {
      hp[entry.target] -= entry.amount;
      const target = side[entry.target];
      const dealer = entry.target === 'a' ? 'b' : 'a';

      target.setHp(hp[entry.target], maxHp[entry.target]);
      target.flash(entry.source === 'poison' ? 'poison' : 'hit');
      target.float(`−${entry.amount}`, entry.source === 'poison' ? 'poison' : 'bad');

      // The dealer of every log entry is the side other than its target —
      // true for a plain attack, First Strike, Poison, and Thorns alike (a
      // Thorns entry targets whoever just landed a hit, dealt by the other
      // side's Thorns keyword). Pulsing their equip slot is what makes "the
      // player's attack, armour, thorns" traceable in the moment, not just
      // stated in a log line.
      const slotKey = SOURCE_SLOT[entry.source];
      if (slotKey) side[dealer].pulseSlot(slotKey);

      // …and the blow itself is drawn in the shape of whatever threw it: the
      // weapon the dealer is actually holding, or the monster's own way of
      // hitting things. A Hunting Bow puts an arrow in flight, a Cave Troll
      // lands a shockwave, a Basilisk bites.
      if (entry.source === 'attack' || entry.source === 'firstStrike') {
        side[dealer].attack?.();
        target.strike(animFor(fighter[dealer]));
      } else {
        target.effect(entry.source);
      }

      if (entry.source === 'poison') audio.poison();
      else if (entry.source === 'thorns') audio.thorns();
      else if (entry.source === 'firstStrike') audio.firstStrike();
      else audio.hit(Math.min(1, entry.amount / Math.max(4, maxHp[entry.target] / 3)));

      await pace(entry === phase.entries[phase.entries.length - 1] ? 620 : 380);
    }
  }
}

/** How a fighter's blows are drawn: a monster's own style, or their weapon. */
const animFor = (f) => f.anim || attackAnim(f.gear || [], f.durability || {});

/**
 * Secrets firing, before the first exchange. Theirs go first — you find out
 * what was waiting for you before you get to see your own read pay off, which
 * is the right order emotionally and the right order mechanically too, since
 * a rival's secret is the one piece of information the planning screen
 * deliberately withheld.
 */
async function playSecrets(result, me, them) {
  const banner = $('#duel-secrets');
  banner.textContent = '';
  if (!result.mySecrets.length && !result.theirSecrets.length) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');

  const rounds = [
    { ids: result.theirSecrets, side: me, after: result.me, who: 'theirs' },
    { ids: result.mySecrets, side: them, after: result.them, who: 'mine' },
  ];

  for (const { ids, side, after, who } of rounds) {
    for (const id of ids) {
      const c = card(id);
      const row = el('div', `secret-fire secret-${who}`);
      row.append(
        glyphEl('secret-fire-icon', ICON[id] || '✦', c.name),
        el('span', 'secret-fire-name', c.name),
        el('span', 'secret-fire-effect', counterText(c.counter)),
      );
      banner.appendChild(row);
      audio.firstStrike();
      side.effect('secret');
      side.flash('hit');
      await sleep(760);
    }
    // Once a side's secrets have all landed, snap their panel to what they're
    // actually going into the fight with.
    if (ids.length) {
      side.setHp(after.hp, after.maxHp);
      side.setStats(after);
      await sleep(260);
    }
  }
  await sleep(420);
}

/** Tick the HUD forward to where a slot left the character. */
function applySnap(snap) {
  if (!snap) return;
  renderHud({ ...run, ...snap, kw: snap.kw }, tierLabel(run.round));
}

function float(cell, text, kind) {
  const f = el('div', `floater floater-${kind}`, text);
  cell.appendChild(f);
  setTimeout(() => f.remove(), 1100);
}

/** Which particle a stat card throws off, picked from what it actually gave. */
const BUFF_BURST = (fx) =>
  (fx.poison && 'poison') || (fx.thorns && 'thorns') || (fx.rally && 'rally') ||
  (fx.armour && 'armour') || (fx.atk > 0 && 'atk') || null;

const BURST_GLYPH = {
  gold: '◉', heal: '✚', trophy: '★', poison: '☠', thorns: '✸',
  rally: '⬆', armour: '◈', atk: '⚔', secret: '✦',
};

/** A shower of particles out of a path slot — coins, sparks, a trophy star. */
function burst(cell, kind, count) {
  const layer = el('div', `burst burst-${kind}`);
  for (let i = 0; i < count; i++) {
    const bit = el('span', 'burst-bit', BURST_GLYPH[kind] || '✦');
    bit.style.setProperty('--i', String(i));
    bit.style.setProperty('--n', String(count));
    layer.appendChild(bit);
  }
  cell.appendChild(layer);
  setTimeout(() => layer.remove(), 1200);
}

// ---- the duel -------------------------------------------------------------

function afterPath() {
  if (run.round >= RUN_DAYS) runDuel();
  else endDay();
}

function endDay() {
  audio.click();
  run = { ...outcome.state };
  if (outcome.rivalCombat) run.rivalCombat = outcome.rivalCombat;
  store.uploadGhost(toGhost(run, slots.filter(Boolean).map((s) => s.id)));
  const day = run.round;
  const sent = outcome.sendId ? card(outcome.sendId) : null;
  const theyHp = run.rivalCombat?.hp ?? ghost.hp;
  const theyMax = run.rivalCombat?.maxHp ?? ghost.maxHp;
  const youBruised = Boolean(run.bruised);
  const theyBruised = Boolean(run.rivalCombat?.bruised);
  run = advanceDay(run);
  store.saveRun(run);

  $('#result-title').textContent = `DAY ${day} ENDS`;
  $('#result-title').className = 'result-title';
  const notes = [];
  if (sent) notes.push(`${ghost.name} is on ${theyHp}/${theyMax} HP after your ${sent.name}.`);
  if (youBruised) notes.push("You went down — no heal tomorrow.");
  if (theyBruised) notes.push("They went down — they won't heal tomorrow.");
  $('#result-sub').textContent = notes.join(' ') || `${ghost.name} is still out there.`;

  const stats = $('#result-stats');
  stats.textContent = '';
  for (const [k, v] of [
    ['Day', `${day} of ${RUN_DAYS}`],
    ['Your HP', `${run.hp} / ${run.maxHp}${youBruised ? ' · bruised' : ''}`],
    ['Their HP', `${theyHp} / ${theyMax}${theyBruised ? ' · bruised' : ''}`],
    ['ATK', run.atk],
    ['Gold', run.gold],
  ]) {
    const r = el('div', 'stat-row');
    r.append(el('span', 'stat-key', k), el('span', 'stat-val', String(v)));
    stats.appendChild(r);
  }
  $('#btn-next-round').textContent = 'NEXT DAY';
  show('result');
  audio.setStyle('plan');
}

async function runDuel() {
  audio.click();
  show('duel');
  audio.setStyle('duel');
  audio.ghostRise();

  const s = outcome.state;
  const wounded = {
    ...ghost,
    hp: outcome.rivalCombat?.hp ?? run.rivalCombat?.hp ?? ghost.hp,
    maxHp: outcome.rivalCombat?.maxHp ?? run.rivalCombat?.maxHp ?? ghost.maxHp,
  };
  const result = duel(s, wounded, outcome.cleanPath, {
    mine: outcome.secrets,
    theirs: ghost.secrets,
  });

  const heading = $('#duel-heading');
  heading.textContent = 'THE FINAL BATTLE';
  heading.classList.add('final');
  heading.classList.remove('win', 'loss');

  const meSub = result.bonusArmour
    ? `untouched on the path · +${result.bonusArmour} Armour`
    : `day ${RUN_DAYS} · finale`;

  // Both fighters are drawn at their *pre-secret* strength, so a secret can be
  // seen taking something off them rather than arriving as a number that was
  // always there.
  const me = duelistEl($('#duel-me'), result.baseMe, {
    glyph: PORTRAIT.player, anim: ANIM.player, sub: meSub, facing: 'right',
  });
  const them = duelistEl($('#duel-them'), result.baseThem, {
    glyph: portraitFor(ghost.archetype),
    anim: ANIM[ghost.archetype],
    sub: `${ghost.archetype} · ${wounded.hp}/${wounded.maxHp} HP`,
    facing: 'left',
  });

  await sleep(900);
  await playSecrets(result, me, them);

  await replayLog({
    side: { a: me, b: them },
    fighter: { a: result.me, b: result.them },
    log: result.log,
  });

  await sleep(700);
  // No log line for this — the heading itself announces it, the way the
  // day count did a moment ago.
  if (result.won) {
    audio.victory();
    bg.pulse();
    heading.textContent = `${result.me.name} WINS`;
    heading.classList.add('win');
  } else {
    audio.defeat();
    heading.textContent = `${result.them.name} WINS`;
    heading.classList.add('loss');
  }

  duelResult = result;
  $('#btn-duel-result').classList.remove('hidden');
}

// ---- round result ---------------------------------------------------------

async function showResult() {
  audio.click();
  $('#btn-duel-result').classList.add('hidden');
  const won = duelResult.won;

  // Carry the resolved character forward, then bank the duel.
  run = { ...outcome.state };
  store.recordDuel(won);

  // Upload the character as a ghost for other players — here, for future runs.
  store.uploadGhost(toGhost(run, slots.filter(Boolean).map((s) => s.id)));

  run = settleFinale(run, won);
  store.saveRun(run);

  $('#result-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('#result-title').className = `result-title ${won ? 'win' : 'loss'}`;
  const rivalName = duelResult.them.name;
  $('#result-sub').textContent = won
    ? `${rivalName} falls. The series is yours.`
    : `${rivalName} stands over you. The run is over.`;

  const stats = $('#result-stats');
  stats.textContent = '';
  const rows = [
    ['Series', `${run.wins}–${run.losses} vs ${rivalName}`],
    ['HP', `${run.hp} / ${run.maxHp}`],
    ['ATK', run.atk],
    ['Gold', run.gold],
  ];
  for (const [k, v] of rows) {
    const r = el('div', 'stat-row');
    r.append(el('span', 'stat-key', k), el('span', 'stat-val', String(v)));
    stats.appendChild(r);
  }

  $('#btn-next-round').textContent = run.over ? 'SEE THE RUN' : 'NEXT ROUND';
  show('result');
  audio.setStyle(won ? 'plan' : 'gameover');
}

function nextRound() {
  audio.click();
  if (run.over) return showOver();
  beginRound();
}

function showOver() {
  store.recordRunEnd(run.completed);
  store.clearRun();
  const rivalName = rival ? rival.name : 'your rival';
  $('#over-title').textContent = run.completed ? 'SERIES WON' : 'RUN OVER';
  $('#over-title').className = `result-title ${run.completed ? 'win' : 'loss'}`;
  $('#over-sub').textContent = run.completed
    ? `Five days, then the fight. ${run.name} takes the series against ${rivalName}.`
    : `${rivalName} won the final battle on day ${run.round}.`;
  rival = null;

  const stats = $('#over-stats');
  stats.textContent = '';
  const lt = store.load().lifetime;
  for (const [k, v] of [
    ['Days fought', run.round],
    ['Series', `${run.wins}–${run.losses}`],
    ['Final ATK', run.atk],
    ['Final max HP', run.maxHp],
    ['Lifetime', `${lt.duelsWon}W ${lt.duelsLost}L over ${lt.runs} runs`],
  ]) {
    const r = el('div', 'stat-row');
    r.append(el('span', 'stat-key', k), el('span', 'stat-val', String(v)));
    stats.appendChild(r);
  }
  show('over');
  audio.setStyle(run.completed ? 'menu' : 'gameover');
}

function startRun() {
  store.recordRunStart();
  // The deck is snapshotted into the run, so editing it later never rewrites
  // a run already under way.
  const deck = store.deck() || deckLib.defaultDeck();
  run = newRun(undefined, randomName(), deck);
  rival = null;   // drawn fresh in beginRound() from the new run's rivalSeed
  beginRound();
}

// ---- boot -----------------------------------------------------------------

function wire() {
  const s = store.settings();
  $('#chk-music').checked = s.music;
  $('#chk-sfx').checked = s.sfx;
  audio.toggleMusic(s.music);
  audio.toggleSfx(s.sfx);

  $('#chk-music').addEventListener('change', (e) => {
    store.setSetting('music', e.target.checked);
    audio.toggleMusic(e.target.checked);
  });
  $('#chk-sfx').addEventListener('change', (e) => {
    store.setSetting('sfx', e.target.checked);
    audio.toggleSfx(e.target.checked);
  });

  $('#btn-start').addEventListener('click', startRun);
  $('#btn-continue').addEventListener('click', () => {
    audio.click();
    // A run saved mid-round resumes at the top of that round. The hand it was
    // holding isn't saved, and re-dealing from the same round seed gives the
    // same six cards back — so resuming costs the player nothing and can't be
    // used to reroll a bad hand either.
    run = store.load().run;
    // The rival is regenerated from the saved rivalSeed, so a resumed run
    // faces the same person on the same day, not a fresh opponent.
    rival = null;
    beginRound();
  });
  duelSpeed = store.settings().speed || 1;
  $('#btn-speed').textContent = `${duelSpeed}×`;
  $('#btn-speed').addEventListener('click', () => {
    duelSpeed = SPEEDS[(SPEEDS.indexOf(duelSpeed) + 1) % SPEEDS.length];
    $('#btn-speed').textContent = `${duelSpeed}×`;
    store.setSetting('speed', duelSpeed);
    audio.click();
  });
  $('#btn-howto').addEventListener('click', () => { audio.click(); show('howto'); });
  $('#btn-howto-back').addEventListener('click', () => { audio.click(); renderTitle(); });
  $('#btn-deck').addEventListener('click', openDeck);
  $('#btn-deck-save').addEventListener('click', saveDeck);
  $('#btn-deck-back').addEventListener('click', () => { audio.click(); renderTitle(); });
  $('#deck-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.deck-tab');
    if (!tab) return;
    deckTierShown = Number(tab.dataset.tier);
    audio.click();
    renderDeck();
  });
  $('#btn-mulligan-confirm').addEventListener('click', confirmMulligan);
  $('#btn-embark').addEventListener('click', embark);
  $('#btn-to-duel').addEventListener('click', afterPath);
  $('#btn-duel-result').addEventListener('click', showResult);
  $('#btn-next-round').addEventListener('click', nextRound);
  $('#btn-again').addEventListener('click', () => { audio.click(); startRun(); });
  $('#btn-to-title').addEventListener('click', () => { audio.click(); renderTitle(); });
  $('#detail-close').addEventListener('click', () => {
    audio.click();
    $('#detail').classList.add('hidden');
  });
  $('#detail').addEventListener('click', (e) => {
    if (e.target.id === 'detail') $('#detail').classList.add('hidden');
  });

  const app = $('#app');
  app.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  // The audio context can't start until the player touches the screen.
  const unlock = () => {
    audio.resume();
    audio.setStyle(audio.style || 'menu', true);
    window.removeEventListener('pointerdown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
}

bg.start();
wire();
renderTitle();
