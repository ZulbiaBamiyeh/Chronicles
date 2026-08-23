// Flow control: which screen is up, what the finger is doing, and the two
// animations (the path flipping left to right, and the duel playing out blow by
// blow). All the rules live in engine.js — this file only ever asks it questions
// and replays the answers.

import { ShaderBackground } from './bg.js';
import { AudioEngine } from './audio.js';
import { card, cardText, fxText } from './cards.js';
import {
  newRun, startRound, deal, resolvePath, duel, settleRound, toGhost,
  tiersForRound, rng, costFor, PATH_SLOTS, STASH_CAP, WINS_TO_COMPLETE,
} from './engine.js';
import { drawGhost, pathNames, randomName } from './ghosts.js';
import * as store from './storage.js';
import { $, el, cardEl, stashChip, renderHud, duelistEl, feedLine, ICON } from './ui.js';

const audio = new AudioEngine();
const bg = new ShaderBackground(document.getElementById('bg-canvas'));

// ---- run + round state ----------------------------------------------------

let run = null;          // the persisted run (see storage.js)
let dealt = [];          // this round's six card ids
let slots = [];          // PATH_SLOTS entries of {id, from, upgrade} | null
let roundSeed = 0;       // seeds this round's deal and its Spoil rolls
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
  renderPlan();
  show('run');
  audio.setStyle('plan');
}

// ---- planning -------------------------------------------------------------

function renderPlan() {
  renderHud(run, tierLabel(run.round));
  renderPath();
  renderHand();
  renderStash();
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

function renderStash() {
  const tray = $('#stash-tray');
  tray.textContent = '';
  tray.appendChild(el('span', 'stash-label', 'STASH'));
  if (!run.stash.length) {
    tray.appendChild(el('span', 'stash-empty', 'empty — kill monsters to fill it'));
    return;
  }
  // The Stash can legitimately hold two copies of the same Spoil, so "is this
  // one placed?" is a count, not a lookup: grey out as many chips of an id as
  // the path is currently using.
  const placing = new Map();
  for (const s of slots) {
    if (s && s.from === 'stash') placing.set(s.id, (placing.get(s.id) || 0) + 1);
  }
  for (const id of run.stash) {
    const chip = stashChip(id);
    const left = placing.get(id) || 0;
    if (left > 0) {
      placing.set(id, left - 1);
      chip.classList.add('placed');
    }
    tray.appendChild(chip);
  }
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
  const chip = target.closest('.chip');
  if (chip && !chip.classList.contains('placed')) return { kind: 'stash', id: chip.dataset.id };
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
    // A plain tap: into the path from hand or stash, back out from a slot.
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
    note.textContent = c.spoil
      ? `Fights for ${c.gold} gold. May drop ${card(c.spoil.id).name} (${Math.round(c.spoil.rate * 100)}%).`
      : `Fights for ${c.gold} gold.`;
  } else if (c.type === 'spoil') {
    note.textContent = `Dropped by ${c.from}. Costs nothing and never fizzles.`;
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
  outcome = resolvePath(run, slots, rng((roundSeed ^ 0x9e3779b9) >>> 0));
  scouted = outcome.usedWatchtower;
  // Half the opponents come out of the local bucket (characters this save has
  // finished a round with before), half are freshly generated. Leaning on
  // generated ghosts is what keeps the archetype spread wide — §12 wants no
  // archetype above 30% or below 15%, and a bucket of one player's own runs
  // drifts towards whatever they happen to build.
  const ghostSeed = (roundSeed ^ 0x2545f491) >>> 0;
  const gr = rng(ghostSeed);
  const player = { atk: outcome.state.atk, maxHp: outcome.state.maxHp };
  ghost = (gr() < 0.5 && store.drawStoredGhost(run.round, run.wins, gr))
       || drawGhost(run.round, run.wins, ghostSeed, player);

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
    audio.hit(Math.min(1, ev.damage / 12));
    float(cell, `−${ev.damage}`, 'bad');
    await sleep(420);
    audio.kill();
    audio.coin(2);
    float(cell, `+${ev.gold}◉`, 'gold');
    const bits = [`${c.name} falls in ${ev.exchanges} exchange${ev.exchanges === 1 ? '' : 's'}`,
                  `−${ev.damage} HP`, `+${ev.gold} gold`];
    if (ev.trophy) bits.push(fxText(ev.trophy));
    feedLine(log, `${bits.join(' · ')}.`, ev.damage > 0 ? '' : 'log-good');
    applySnap(ev.snap);
    if (ev.drop) {
      await sleep(420);
      audio.spoil();
      float(cell, ICON[ev.drop] || '★', 'spoil');
      feedLine(log, `${card(ev.drop).name} dropped — it goes to your Stash.`, 'log-spoil');
      await sleep(500);
    }
    await sleep(700);
    return;
  }

  // Gear, ally, place, spoil.
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

  // Replay the resolver's log. The numbers are already decided — this only
  // paces them out so the fight is readable.
  const hp = { a: result.me.hp, b: result.them.hp };
  const maxHp = { a: result.me.maxHp, b: result.them.maxHp };
  const side = { a: me, b: them };
  const who = { a: result.me.name, b: result.them.name };

  let ex = 0;
  for (const entry of result.log) {
    if (entry.ex !== ex) {
      ex = entry.ex;
      await sleep(560);
      feedLine(feed, `— exchange ${ex} —`, 'feed-ex');
    }
    hp[entry.target] -= entry.amount;
    side[entry.target].setHp(hp[entry.target], maxHp[entry.target]);
    side[entry.target].flash(entry.source === 'poison' ? 'poison' : 'hit');
    side[entry.target].float(`−${entry.amount}`, entry.source === 'poison' ? 'poison' : 'bad');

    if (entry.source === 'poison') audio.poison();
    else if (entry.source === 'thorns') audio.thorns();
    else if (entry.source === 'firstStrike') audio.firstStrike();
    else audio.hit(Math.min(1, entry.amount / Math.max(4, maxHp[entry.target] / 3)));

    const verb = {
      poison: 'poison eats at', thorns: 'thorns bite', firstStrike: 'strikes first at', attack: 'hits',
    }[entry.source];
    const attacker = entry.target === 'a' ? who.b : who.a;
    feedLine(feed, `${attacker} ${verb} ${who[entry.target]} for ${entry.amount}.`);
    await sleep(340);
  }

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

  // Spoils land in the Stash now, at the end of the round (§2.1 step 6). If the
  // Stash is full the player chooses what goes — one tap, and the run waits.
  const pending = outcome.spoilsWon.slice();
  for (const id of pending) {
    if (run.stash.length < STASH_CAP) { run.stash.push(id); continue; }
    const keep = await askStash(id);
    if (keep !== null) {
      run.stash.splice(keep, 1);
      run.stash.push(id);
    }
  }

  // Upload the character as a ghost for other players — here, for future runs.
  store.uploadGhost(toGhost(run, slots.filter(Boolean).map((s) => s.id)));

  run = settleRound(run, won);
  store.saveRun(run);

  $('#result-title').textContent = won ? 'VICTORY' : 'DEFEAT';
  $('#result-title').className = `result-title ${won ? 'win' : 'loss'}`;
  $('#result-sub').textContent = won
    ? `${duelResult.them.name} fades. ${run.wins}/${WINS_TO_COMPLETE} wins banked.`
    : `${duelResult.them.name} stands over you. ${run.hearts} heart${run.hearts === 1 ? '' : 's'} left.`;

  const spoilsBox = $('#result-spoils');
  spoilsBox.textContent = '';
  if (outcome.spoilsWon.length) {
    spoilsBox.classList.remove('hidden');
    spoilsBox.appendChild(el('p', 'spoils-label', 'SPOILS TAKEN'));
    const row = el('div', 'spoils-row');
    for (const id of outcome.spoilsWon) row.appendChild(stashChip(id));
    spoilsBox.appendChild(row);
  } else {
    spoilsBox.classList.add('hidden');
  }

  const stats = $('#result-stats');
  stats.textContent = '';
  const rows = [
    ['HP', `${run.hp} / ${run.maxHp}`],
    ['ATK', run.atk],
    ['Gold', run.gold],
    ['Hearts', '♥'.repeat(run.hearts) || '—'],
    ['Stash', run.stash.length ? run.stash.map((id) => card(id).name).join(', ') : 'empty'],
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

/** The §7.2 prompt: the Stash is full, so something has to go. */
function askStash(incoming) {
  return new Promise((resolve) => {
    const box = $('#stash-prompt');
    $('#stash-prompt-sub').textContent =
      `${card(incoming).name} dropped. Tap a Spoil to discard and make room.`;
    const mount = $('#stash-prompt-cards');
    mount.textContent = '';
    run.stash.forEach((id, i) => {
      const node = cardEl(id, { run, size: 'hand' });
      node.addEventListener('click', () => { close(); resolve(i); }, { once: true });
      mount.appendChild(node);
    });
    const discard = $('#stash-prompt-discard');
    const onDiscard = () => { close(); resolve(null); };
    discard.addEventListener('click', onDiscard, { once: true });
    function close() {
      box.classList.add('hidden');
      discard.removeEventListener('click', onDiscard);
    }
    box.classList.remove('hidden');
  });
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
