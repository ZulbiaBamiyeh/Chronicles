// Simulates a lot of runs and reports against the tuning targets in §12 of the
// design document. Nothing here is a test — the numbers are supposed to move as
// cards get tuned. It exists so that "is 20 starting max HP right?" (the doc's
// own single riskiest number) is a question you answer with data.
//
//   node tools/balance.mjs [runs]

import {
  newRun, startRound, deal, resolvePath, duel, settleRound,
  rng, PATH_SLOTS, STASH_CAP,
} from '../js/engine.js';
import { card } from '../js/cards.js';
import { drawGhost } from '../js/ghosts.js';

const RUNS = Number(process.argv[2] || 600);

/**
 * A stand-in for a competent player: enumerate every ordered choice of four
 * from what's available and keep the one that scores best. It's brute force
 * (at most P(9,4) = 3024 paths), which is the point — a heuristic planner would
 * make the report a measurement of the heuristic instead of the cards.
 */
function bestPath(run, hand, score, r) {
  const available = [
    ...hand.map((id) => ({ id, from: 'hand' })),
    ...run.stash.map((id) => ({ id, from: 'stash' })),
  ];
  let best = null;
  const chosen = [];
  const used = new Set();

  const walk = () => {
    if (chosen.length === PATH_SLOTS) {
      // Drop rolls are held fixed across candidates so the planner is choosing
      // between paths, not fishing for a lucky Spoil roll.
      const out = resolvePath(run, chosen.slice(), rng(r));
      const value = score(out);
      if (!best || value > best.value) best = { value, slots: chosen.slice(), out };
      return;
    }
    for (let i = 0; i < available.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      chosen.push(available[i]);
      walk();
      chosen.pop();
      used.delete(i);
    }
  };
  walk();
  return best;
}

/** Rough duel strength, used only to rank candidate paths. */
const power = (s) =>
  s.atk * 2.6 + s.hp * 1.0 + s.maxHp * 0.35 + s.gold * 0.25 +
  s.kw.armour * 4 + s.kw.poison * 3 + s.kw.rally * 5.5 +
  s.kw.thorns * 2 + (s.kw.firstStrike ? 4 : 0);

const STYLES = {
  greedy: (out) => power(out.state),
  // The same player, but unwilling to arrive at a duel bleeding.
  cautious: (out) => power(out.state) + out.state.hp * 2.2 - out.pathDamage * 1.6,
};

function simulate(style) {
  const score = STYLES[style];
  const stats = {
    runs: 0, completed: 0, duels: 0, duelWins: 0,
    exchanges: [], pathDamagePct: [], fizzles: 0, slotsEarly: 0, fizzlesEarly: 0,
    slotsLate: 0, fizzlesLate: 0, slots: 0,
    spoilsWon: 0, spoilsUsed: 0, spoilsLost: 0,
    flooredAtOne: 0, rounds: 0, roundsByTier: {},
  };
  const usedSpoils = new Set();

  for (let seed = 1; seed <= RUNS; seed++) {
    let run = newRun(seed);
    stats.runs++;
    let guard = 0;
    while (!run.over && guard++ < 40) {
      run = startRound(run);
      const roundSeed = (seed * 7919 + run.round * 104729 + run.wins * 31) >>> 0;
      const hand = deal(run.round, rng(roundSeed));
      const chosen = bestPath(run, hand, score, roundSeed ^ 0x9e3779b9);
      const out = chosen.out;

      stats.rounds++;
      stats.slots += PATH_SLOTS;
      const fizzled = out.events.filter((e) => e.kind === 'fizzle').length;
      stats.fizzles += fizzled;
      if (run.round <= 3) { stats.slotsEarly += PATH_SLOTS; stats.fizzlesEarly += fizzled; }
      if (run.round >= 5) { stats.slotsLate += PATH_SLOTS; stats.fizzlesLate += fizzled; }
      stats.pathDamagePct.push(out.pathDamage / out.state.maxHp);
      if (out.state.hp === 1) stats.flooredAtOne++;

      for (const slot of chosen.slots) {
        if (slot.from === 'stash') { stats.spoilsUsed++; usedSpoils.add(card(slot.id).name); }
      }

      const ghost = drawGhost(run.round, run.wins, (roundSeed ^ 0x2545f491) >>> 0, out.state);
      const d = duel(out.state, ghost, out.cleanPath);
      stats.duels++;
      if (d.won) stats.duelWins++;
      stats.exchanges.push(d.exchanges);

      let next = { ...out.state };
      for (const id of out.spoilsWon) {
        stats.spoilsWon++;
        if (next.stash.length < STASH_CAP) next.stash.push(id);
        else stats.spoilsLost++;      // the cap forced a discard
      }
      run = settleRound(next, d.won);
    }
    if (run.completed) stats.completed++;
  }
  stats.distinctSpoilsUsed = usedSpoils.size;
  return stats;
}

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const share = (a, f) => a.filter(f).length / a.length;

function report(style) {
  const s = simulate(style);
  const dmg = mean(s.pathDamagePct);
  const ex = mean(s.exchanges);
  const completion = s.completed / s.runs;
  const spoilUse = s.spoilsWon ? s.spoilsUsed / s.spoilsWon : 0;

  const target = (ok) => (ok ? '  ok  ' : ' MISS ');
  console.log(`\n── ${style.toUpperCase()} PLAYER · ${s.runs} runs, ${s.rounds} rounds ──`);
  const rows = [
    ['path damage / max HP', pct(dmg),
      style === 'greedy' ? '30–50%' : '10–20%',
      style === 'greedy' ? dmg >= 0.30 && dmg <= 0.50 : dmg >= 0.10 && dmg <= 0.20],
    ['fizzle rate, rounds 1–3', pct(s.fizzlesEarly / (s.slotsEarly || 1)), '~15%',
      s.fizzlesEarly / (s.slotsEarly || 1) <= 0.22],
    ['fizzle rate, round 5+', pct(s.fizzlesLate / (s.slotsLate || 1)), 'under 3%',
      s.fizzlesLate / (s.slotsLate || 1) < 0.03],
    ['mean duel length', ex.toFixed(2), '3–6 exchanges', ex >= 3 && ex <= 6],
    ['duels 3–6 exchanges', pct(share(s.exchanges, (e) => e >= 3 && e <= 6)), 'most of them',
      share(s.exchanges, (e) => e >= 3 && e <= 6) >= 0.6],
    // §12's 25–35% was written for ghosts drawn from a fixed table. Ghosts are
    // now sized against the actual player they're about to fight (see
    // js/ghosts.js's PACING note), which is what makes a duel take a
    // handful of real exchanges regardless of how the path went — but it
    // also means a planner that maximizes every round, permutation by
    // permutation, keeps outrunning the ghosts it draws: the target here is
    // no longer a fixed pass/fail line, it's a sanity check that a perfect
    // optimizer isn't clearing literally every run.
    ['run completion', pct(completion), 'high, not total', completion < 0.97],
    ['duel win rate', pct(s.duelWins / s.duels), '—', true],
    ['Spoils used before the cap bit', pct(spoilUse), 'at least 60%', spoilUse >= 0.6],
    ['Spoils lost to a full Stash', String(s.spoilsLost), 'few', true],
    ['distinct Spoils ever played', `${s.distinctSpoilsUsed} / 12`, 'all 12', s.distinctSpoilsUsed === 12],
    ['rounds ending floored at 1 HP', pct(s.flooredAtOne / s.rounds), 'rare — §12 risk #1',
      s.flooredAtOne / s.rounds < 0.12],
  ];
  for (const [label, value, want, ok] of rows) {
    console.log(`${target(ok)} ${label.padEnd(32)} ${String(value).padStart(9)}   want ${want}`);
  }
  return s;
}

console.log(`Ghostwalk balance sweep — ${RUNS} runs per style`);
report('greedy');
report('cautious');
console.log('\nTargets are §12 of the design doc. A MISS is a tuning note, not a bug.');
console.log(
  'This planner brute-forces every round, so its "run completion" and "duel\n' +
  'win rate" run well above what a real player should expect — see\n' +
  'test/engine.mjs\'s "a duel lands in the §12 window regardless of how the\n' +
  'player built" for the number that actually matters: whether a *realistic*\n' +
  'build gets a competitive, multi-exchange fight, not whether a maximizer\n' +
  'can be beaten by ghosts at all.\n',
);
