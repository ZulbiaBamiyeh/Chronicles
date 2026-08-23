// Flow control: which screen is up, what the finger is doing, and the two
// animations (the path flipping left to right, and the duel playing out blow by
// blow). All the rules live in engine.js — this file only ever asks it questions
// and replays the answers.

import { ShaderBackground } from './bg.js';
import { AudioEngine } from './audio.js';
import { card, cardText, fxText } from './cards.js';
import {
  newRun, startRound, deal, resolvePath, duel, settleRound, toGhost,
  tiersForRound, rng, costFor, PATH_SLOTS, WINS_TO_COMPLETE,
} from './engine.js';
import { drawGhost, pathNames, randomName } from './ghosts.js';
import * as store from './storage.js';
import { $, el, cardEl, renderHud, duelistEl, feedLine, MONSTER_GLYPH } from './ui.js';

const audio = new AudioEngine();
const bg = new ShaderBackground(document.getElementById('bg-canvas'));

// ---- run + round state ----------------------------------------------------

let run = null;          // the persisted run (see storage.js)
let dealt = [];          // this round's six card ids
let slots = [];          // PATH_SLOTS entries of {id, from, upgrade} | null
let roundSeed = 0;       // seeds this round's deal
let outcome = null;      // the resolved path, kept for the duel and the result
let ghost = null;
let duelResult = null;
let scouted = false;     // Watchtower revealed the opponent this round

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tierLabel = (round) => tiersForRound(round).map((t) => `T${t}`).join('+');

// ---- screens --------------------------------------------------------------

const SCREENS = ['title', 'run', 'duel', 'result', 'over', 'howto'];
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

// ---- starting a round -----------------------------------------------------

function beginRound() {
  run = startRound(run);   // no-op if this round's upkeep already ran (a resumed save)
  roundSeed = (run.seed + run.round * 7919 + run.wins * 104729 + run.losses * 15485863) >>> 0;
  dealt = deal(run.round, rng(roundSeed));
  slots = new Array(PATH_SLOTS).fill(null);
  outcome = null;
  ghost = null;
  scouted = false;
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
  renderPath();
  renderHand();
  const full = slots.every(Boolean);
  $('#btn-embark').disabled = !full;
  $('#hand-hint').textContent = full
    ? 'Drag slots to reorder'
    : `Tap to place · ${slots.filter(Boolean).length}/${PATH_SLOTS}`;
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
  // Half the opponents come out of the local bucket (characters this save has
  // finished a round with before), half are freshly generated. Leaning on
  // generated ghosts is what keeps the archetype spread wide — §12 wants no
  // archetype above 30% or below 15%, and a bucket of one player's own runs
  // drifts towards whatever they happen to build.
  const ghostSeed = (roundSeed ^ 0x2545f491) >>> 0;
  const gr = rng(ghostSeed);
  ghost = (gr() < 0.5 && store.drawStoredGhost(run.round, run.wins, gr))
       || drawGhost(run.round, run.wins, ghostSeed);

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
  const line = scouted
    ? `The Watchtower shows ${ghost.name}: ${ghost.hp} HP, ${ghost.atk} ATK.`
    : `${ghost.name} is waiting.`;
  feedLine($('#resolve-log'), line, 'log-ghost');
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

  if (ev.kind === 'fight') {
    await playPathFight(ev, c);
    audio.kill();
    audio.coin(2);
    float(cell, `+${ev.gold}◉`, 'gold');
    const bits = [`${c.name} falls in ${ev.exchanges} exchange${ev.exchanges === 1 ? '' : 's'}`,
                  `−${ev.damage} HP`, `+${ev.gold} gold`];
    if (ev.trophy) bits.push(fxText(ev.trophy));
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
  if (fx.heal || fx.healFull) audio.heal();
  else if (fx.gold) audio.coin(3);
  else audio.place();
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
  const me = duelistEl($('#path-fight-me'), ev.me, { glyph: '🧍', sub: `round ${run.round}` });
  const monster = duelistEl($('#path-fight-them'), ev.monster, {
    glyph: MONSTER_GLYPH[ev.id] || '❔',
    sub: `Tier ${c.tier} monster`,
  });
  await sleep(400);
  await replayLog({
    feed: $('#resolve-log'),
    side: { a: me, b: monster },
    who: { a: ev.me.name, b: ev.monster.name },
    log: ev.log,
    startHp: { a: ev.me.hp, b: ev.monster.hp },
    maxHp: { a: ev.me.maxHp, b: ev.monster.maxHp },
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
async function replayLog({ feed, side, who, log, startHp, maxHp, speed = 1 }) {
  const hp = { ...startHp };
  const SOURCE_SLOT = { attack: 'atk', firstStrike: 'atk', poison: 'poison', thorns: 'thorns' };
  const VERB = {
    poison: 'poison eats at', thorns: 'thorns bite', firstStrike: 'strikes first at', attack: 'hits',
  };

  let ex = 0;
  for (const entry of log) {
    if (entry.ex !== ex) {
      ex = entry.ex;
      await sleep(560 * speed);
      feedLine(feed, `— exchange ${ex} —`, 'feed-ex');
    }
    hp[entry.target] -= entry.amount;
    side[entry.target].setHp(hp[entry.target], maxHp[entry.target]);
    side[entry.target].flash(entry.source === 'poison' ? 'poison' : 'hit');
    side[entry.target].float(`−${entry.amount}`, entry.source === 'poison' ? 'poison' : 'bad');

    // The dealer of every log entry is the side other than its target —
    // true for a plain attack, First Strike, Poison, and Thorns alike (a
    // Thorns entry targets whoever just landed a hit, dealt by the other
    // side's Thorns keyword). Pulsing their equip slot is what makes "the
    // player's attack, armour, thorns" traceable in the moment, not just
    // stated in a log line.
    const dealer = entry.target === 'a' ? 'b' : 'a';
    const slotKey = SOURCE_SLOT[entry.source];
    if (slotKey) side[dealer].pulseSlot(slotKey);

    if (entry.source === 'poison') audio.poison();
    else if (entry.source === 'thorns') audio.thorns();
    else if (entry.source === 'firstStrike') audio.firstStrike();
    else audio.hit(Math.min(1, entry.amount / Math.max(4, maxHp[entry.target] / 3)));

    feedLine(feed, `${who[dealer]} ${VERB[entry.source]} ${who[entry.target]} for ${entry.amount}.`);
    await sleep(340 * speed);
  }
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

// ---- the duel -------------------------------------------------------------

async function runDuel() {
  audio.click();
  show('duel');
  audio.setStyle('duel');
  audio.ghostRise();

  const s = outcome.state;
  const result = duel(s, ghost, outcome.cleanPath);
  const feed = $('#duel-feed');
  feed.textContent = '';

  const meSub = result.bonusArmour
    ? `untouched on the path · +${result.bonusArmour} Armour`
    : `round ${run.round} · ${run.wins}/${WINS_TO_COMPLETE} wins`;
  const me = duelistEl($('#duel-me'), result.me, { glyph: '🧍', sub: meSub });
  const them = duelistEl($('#duel-them'), result.them, {
    glyph: '👻',
    sub: pathNames(ghost.path).slice(0, 2).join(' · '),
  });

  await sleep(1100);

  const who = { a: result.me.name, b: result.them.name };
  await replayLog({
    feed,
    side: { a: me, b: them },
    who,
    log: result.log,
    startHp: { a: result.me.hp, b: result.them.hp },
    maxHp: { a: result.me.maxHp, b: result.them.maxHp },
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
  $('#result-sub').textContent = won
    ? `${duelResult.them.name} fades. ${run.wins}/${WINS_TO_COMPLETE} wins banked.`
    : `${duelResult.them.name} stands over you. ${run.hearts} heart${run.hearts === 1 ? '' : 's'} left.`;

  const stats = $('#result-stats');
  stats.textContent = '';
  const rows = [
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
  $('#over-title').textContent = run.completed ? 'RUN COMPLETE' : 'RUN OVER';
  $('#over-title').className = `result-title ${run.completed ? 'win' : 'loss'}`;
  $('#over-sub').textContent = run.completed
    ? `Five duels won. ${run.name} walks out of the fog.`
    : `Three hearts spent at ${run.wins} win${run.wins === 1 ? '' : 's'}.`;

  const stats = $('#over-stats');
  stats.textContent = '';
  const lt = store.load().lifetime;
  for (const [k, v] of [
    ['Rounds played', run.round],
    ['Duels won', run.wins],
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
  run = newRun(undefined, randomName());
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
    beginRound();
  });
  $('#btn-howto').addEventListener('click', () => { audio.click(); show('howto'); });
  $('#btn-howto-back').addEventListener('click', () => { audio.click(); renderTitle(); });
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
