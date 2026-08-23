// Flow control: which screen is up, what the finger is doing, and the two
// animations (the path flipping left to right, and the duel playing out blow by
// blow). All the rules live in engine.js — this file only ever asks it questions
// and replays the answers.

import { ShaderBackground } from './bg.js';
import { AudioEngine } from './audio.js';
import { card, cardText, fxText, attackAnim, counterText } from './cards.js';
import {
  newRun, startRound, deal, resolvePath, duel, settleRound, toGhost,
  tiersForRound, rng, costFor, PATH_SLOTS, RUN_DAYS,
} from './engine.js';
import { randomName } from './ghosts.js';
import { drawRival, rivalOnDay, intel } from './rival.js';
import * as deckLib from './deck.js';
import * as store from './storage.js';
import {
  $, el, cardEl, renderHud, duelistEl, feedLine, rivalPanel, MONSTER_GLYPH, ICON,
} from './ui.js';

const audio = new AudioEngine();
const bg = new ShaderBackground(document.getElementById('bg-canvas'));

// ---- run + round state ----------------------------------------------------

let run = null;          // the persisted run (see storage.js)
let dealt = [];          // this round's six card ids
let slots = [];          // PATH_SLOTS entries of {id, from, upgrade} | null
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
  dealt = deal(run.round, rng(roundSeed), run.deck);
  slots = new Array(PATH_SLOTS).fill(null);
  outcome = null;
  scouted = false;
  // The rival was decided when the run started and doesn't change; today's
  // opponent is simply them, as they stood on this day of their own run.
  if (!rival) rival = drawRival(run.rivalSeed);
  ghost = rivalOnDay(rival, run.round);
  store.saveRun(run);

  $('#plan-area').classList.remove('hidden');
  $('#resolve-area').classList.add('hidden');
  $('#btn-to-duel').classList.add('hidden');
  $('#resolve-log').textContent = '';
  $('#path-fight-stage').classList.add('hidden');
  renderPlan();
  show('run');
  audio.setStyle('plan');
}

// ---- planning -------------------------------------------------------------

function renderPlan() {
  renderHud(run, tierLabel(run.round));
  renderRival();
  renderPath();
  renderHand();
  const full = slots.every(Boolean);
  $('#btn-embark').disabled = !full;
  $('#hand-hint').textContent = full
    ? 'Drag slots to reorder'
    : `Tap to place · ${slots.filter(Boolean).length}/${PATH_SLOTS}`;
}

/**
 * The rival readout above the hand. A Watchtower placed anywhere in the path
 * reveals their secrets — and it updates live as you plan, so you can see
 * what scouting would buy you before you commit the slot.
 */
function renderRival() {
  const willScout = slots.some((s) => s && card(s.id)?.scout);
  rivalPanel($('#rival-panel'), intel(rival, run.round, willScout), {
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
}

function renderHand() {
  const mount = $('#hand');
  mount.textContent = '';
  const placed = slots.filter((s) => s && s.from === 'hand').map((s) => s.id);
  const spent = new Set();
  dealt.forEach((id) => {
    const node = cardEl(id, { run, size: 'hand' });
    // A dealt card that's already in the path stays in place, greyed out, so
    // the grid never reflows under a finger mid-plan.
    if (placed.includes(id) && !spent.has(id)) {
      spent.add(id);
      node.classList.add('placed');
    }
    mount.appendChild(node);
  });
}

/** Put a card in the first free slot. Returns false if the path is full. */
function place(id, from) {
  const free = slots.indexOf(null);
  if (free < 0) return false;
  slots[free] = { id, from, upgrade: false };
  audio.place();
  renderPlan();
  return true;
}

function unplace(index) {
  if (!slots[index]) return;
  slots[index] = null;
  audio.lift2();
  renderPlan();
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
  const slotCell = target.closest('.slot');
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
  for (const cell of document.querySelectorAll('#path .slot')) {
    cell.classList.toggle('over', cell === over);
  }
}

function slotUnder(x, y) {
  const node = document.elementFromPoint(x, y);
  return node ? node.closest('#path .slot') : null;
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
    else if (!place(g.src.id, g.src.kind)) shake($('#path'));
    return;
  }

  g.node.remove();
  document.body.classList.remove('is-dragging');
  for (const cell of document.querySelectorAll('#path .slot')) cell.classList.remove('over');

  const target = slotUnder(ev.clientX, ev.clientY);
  if (target) {
    const index = Number(target.dataset.slot);
    if (g.src.kind === 'slot') swapSlots(g.src.index, index);
    else placeAt(index, g.src.id, g.src.kind);
  } else if (g.src.kind === 'slot') {
    // Dragged off the path entirely — put it back.
    unplace(g.src.index);
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
    note.textContent = `Fights for ${c.gold} gold.`;
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
  scouted = outcome.usedWatchtower;
  // No draw here any more: today's opponent has been fixed since the run
  // began. That's the point — the path you just committed to was planned
  // against this specific person.

  $('#plan-area').classList.add('hidden');
  $('#resolve-area').classList.remove('hidden');
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

  await sleep(500);
  const log = $('#resolve-log');
  if (scouted && ghost.secrets.length) {
    const names = ghost.secrets.map((id) => card(id).name).join(' and ');
    feedLine(log, `The Watchtower shows ${ghost.name} has laid ${names}.`, 'log-ghost');
  } else if (scouted) {
    feedLine(log, `The Watchtower shows ${ghost.name} has laid no secrets today.`, 'log-ghost');
  } else if (ghost.secrets.length) {
    feedLine(log, `${ghost.name} is waiting — and something has been laid for you.`, 'log-ghost');
  } else {
    feedLine(log, `${ghost.name} is waiting.`, 'log-ghost');
  }
  $('#btn-to-duel').classList.remove('hidden');
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
    glyph: '🧍', sub: `round ${run.round}`, facing: 'right',
  });
  const monster = duelistEl($('#path-fight-them'), ev.monster, {
    glyph: MONSTER_GLYPH[ev.id] || '❔',
    sub: `Tier ${c.tier} monster`,
    facing: 'left',
  });
  await sleep(400);
  await replayLog({
    feed: $('#resolve-log'),
    side: { a: me, b: monster },
    fighter: { a: ev.me, b: ev.monster },
    log: ev.log,
    speed: 0.72,
  });
  await sleep(300);
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
 * Replays a resolved fight, phase by phase.
 *
 * Pacing is deliberately unhurried, and grouped: everything that happens for
 * one reason resolves together, under a heading that says what that reason is.
 * The previous version stepped one log entry at a time at a fixed interval,
 * which meant a four-keyword exchange was eight numbers in two seconds — all
 * technically shown, none of it legible. `duelSpeed` lets a player who has
 * already read it wind the whole thing forward.
 */
async function replayLog({ feed, side, fighter, log, speed = 1 }) {
  const hp = { a: fighter.a.hp, b: fighter.b.hp };
  const maxHp = { a: fighter.a.maxHp, b: fighter.b.maxHp };
  const who = { a: fighter.a.name, b: fighter.b.name };
  const pace = (ms) => sleep((ms * speed) / duelSpeed);

  let ex = 0;
  for (const phase of phasesOf(log)) {
    if (phase.ex !== ex) {
      ex = phase.ex;
      await pace(520);
      feedLine(feed, `EXCHANGE ${ex}`, 'feed-ex');
      await pace(360);
    }

    const meta = PHASE[phase.source] || { label: phase.source, note: '', icon: '•' };
    const head = el('div', `feed-phase phase-${phase.source}`);
    head.append(
      el('span', 'phase-icon', meta.icon),
      el('span', 'phase-label', meta.label),
      el('span', 'phase-note', meta.note),
    );
    feed.appendChild(head);
    feed.scrollTop = feed.scrollHeight;
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
        target.strike(animFor(fighter[dealer]));
      } else {
        target.effect(entry.source);
      }

      if (entry.source === 'poison') audio.poison();
      else if (entry.source === 'thorns') audio.thorns();
      else if (entry.source === 'firstStrike') audio.firstStrike();
      else audio.hit(Math.min(1, entry.amount / Math.max(4, maxHp[entry.target] / 3)));

      const line = el('div', `feed-line hit-${entry.source}`);
      line.append(
        el('span', 'hit-who', who[dealer]),
        el('span', 'hit-verb', ` ${VERB[entry.source]} `),
        el('span', 'hit-whom', who[entry.target]),
        el('span', 'hit-amount', `−${entry.amount}`),
      );
      feed.appendChild(line);
      feed.scrollTop = feed.scrollHeight;
      await pace(entry === phase.entries[phase.entries.length - 1] ? 620 : 380);
    }
  }
}

/** How a fighter's blows are drawn: a monster's own style, or their weapon. */
const animFor = (f) => f.anim || attackAnim(f.gear || []);

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
        el('span', 'secret-fire-icon', ICON[id] || '✦'),
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

async function runDuel() {
  audio.click();
  show('duel');
  audio.setStyle('duel');
  audio.ghostRise();

  const s = outcome.state;
  const result = duel(s, ghost, outcome.cleanPath, {
    mine: outcome.secrets,
    theirs: ghost.secrets,
  });
  const feed = $('#duel-feed');
  feed.textContent = '';

  const isFinal = run.round >= RUN_DAYS;
  $('#duel-heading').textContent = isFinal
    ? `DAY ${run.round} — THE LAST DAY`
    : `DAY ${run.round} OF ${RUN_DAYS}`;
  $('#duel-heading').classList.toggle('final', isFinal);

  const meSub = result.bonusArmour
    ? `untouched on the path · +${result.bonusArmour} Armour`
    : `${run.wins}–${run.losses} in the series`;

  // Both fighters are drawn at their *pre-secret* strength, so a secret can be
  // seen taking something off them rather than arriving as a number that was
  // always there.
  const me = duelistEl($('#duel-me'), result.baseMe, { glyph: '🧍', sub: meSub, facing: 'right' });
  const them = duelistEl($('#duel-them'), result.baseThem, {
    glyph: '👻',
    sub: `day ${run.round} · ${ghost.archetype}`,
    facing: 'left',
  });

  await sleep(900);
  await playSecrets(result, me, them);

  const who = { a: result.me.name, b: result.them.name };
  await replayLog({
    feed,
    side: { a: me, b: them },
    fighter: { a: result.me, b: result.them },
    log: result.log,
  });

  await sleep(700);
  if (result.won) {
    audio.victory();
    bg.pulse();
    feedLine(feed, `${who.a} wins the duel.`, 'feed-win');
  } else {
    audio.defeat();
    feedLine(feed, `${who.b} wins the duel.`, 'feed-loss');
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

  run = settleRound(run, won);
  store.saveRun(run);

  $('#result-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('#result-title').className = `result-title ${won ? 'win' : 'loss'}`;
  const rivalName = duelResult.them.name;
  $('#result-sub').textContent = won
    ? `${rivalName} falls. You lead the series ${run.wins}–${run.losses}.`
    : `${rivalName} stands over you. ${run.hearts} heart${run.hearts === 1 ? '' : 's'} left.`;

  const stats = $('#result-stats');
  stats.textContent = '';
  const rows = [
    ['Series', `${run.wins}–${run.losses} vs ${rivalName}`],
    ['HP', `${run.hp} / ${run.maxHp}`],
    ['ATK', run.atk],
    ['Gold', run.gold],
    ['Hearts', '♥'.repeat(run.hearts) || '—'],
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
    ? `Five days survived. ${run.name} takes the series ${run.wins}–${run.losses} against ${rivalName}.`
    : `${rivalName} took it ${run.losses}–${run.wins}. Three hearts spent on day ${run.round}.`;
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
  $('#btn-embark').addEventListener('click', embark);
  $('#btn-to-duel').addEventListener('click', runDuel);
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
