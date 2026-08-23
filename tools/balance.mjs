// Simulates a lot of runs and reports against the tuning targets in §12 of the
// design document. Nothing here is a test — the numbers are supposed to move as
// cards get tuned. It exists so that "is 20 starting max HP right?" (the doc's
// own single riskiest number) is a question you answer with data.
//
//   node tools/balance.mjs [runs]

import {
  newRun, startRound, resolvePath, duel, settleRound,
  rng, PATH_SLOTS, refillHand, resolveAmbush,
} from '../js/engine.js';
import { drawRival, rivalOnDay } from '../js/rival.js';

const RUNS = Number(process.argv[2] || 600);

/**
 * A stand-in for a competent player: enumerate every ordered choice of four
 * from what's dealt and keep the one that scores best. It's brute force (at
 * most P(6,4) = 360 paths), which is the point — a heuristic planner would
 * make the report a measurement of the heuristic instead of the cards.
 *
 * The planner is *rival-aware*, because the player now is: today's opponent is
 * on screen while you plan. Each candidate path is scored by actually
 * resolving the duel it leads to, which is the only way a secret can ever
 * score at all — a secret adds nothing to your own statline, so a planner
 * that only weighed stats would correctly conclude it was a wasted slot and
 * the whole mechanic would go unmeasured.
 *
 * The hand is no longer always six: it's whatever refillHand() left after
 * carrying yesterday's leftovers forward, which can run short late in a run
 * as a deck's tier pool empties. The planner fills as many slots as the hand
 * allows and leaves the rest empty, same as a real player would.
 */
function bestPath(run, hand, score, ctx) {
  const available = hand.map((id) => ({ id, from: 'hand' }));
  const target = Math.min(PATH_SLOTS, available.length);
  let best = null;
  const chosen = [];
  const used = new Set();

  const walk = () => {
    if (chosen.length === target) {
      const slots = [...chosen];
      while (slots.length < PATH_SLOTS) slots.push(null);
      let out = resolvePath(run, slots);
      // The rival's invasion — if this day has one — lands between the path
      // and the duel, same as it does for a real player. Folding it in here
      // is what makes the planner's own choice of path (and whether a secret
      // is worth a slot) reflect the fight it's actually walking into.
      let ambushDamage = 0;
      if (ctx.rivalDay.invasion) {
        const ambush = resolveAmbush(out.state, ctx.rivalDay.invasion);
        ambushDamage = ambush.damage;
        out = { ...out, state: ambush.state, pathDamage: out.pathDamage + ambush.damage,
          cleanPath: out.cleanPath && ambush.damage === 0 };
      }
      const d = duel(out.state, ctx.rivalDay, out.cleanPath, {
        mine: out.secrets,
        theirs: ctx.rivalDay.secrets,
      });
      const value = score(out, d);
      if (!best || value > best.value) best = { value, slots, out, duel: d, ambushDamage };
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

// Winning today's duel dominates everything else a path could buy you — a
// heart is worth more than any statline. Below that, the styles differ in how
// much they'll bleed to get there.
const WIN = 500;

const STYLES = {
  greedy: (out, d) => (d.won ? WIN : 0) + power(out.state),
  // The same player, but unwilling to arrive at a duel bleeding.
  cautious: (out, d) =>
    (d.won ? WIN : 0) + power(out.state) + out.state.hp * 2.2 - out.pathDamage * 1.6,
};

function simulate(style) {
  const score = STYLES[style];
  const stats = {
    runs: 0, completed: 0, duels: 0, duelWins: 0,
    exchanges: [], pathDamagePct: [], fizzles: 0, slotsEarly: 0, fizzlesEarly: 0,
    slotsLate: 0, fizzlesLate: 0, slots: 0,
    flooredAtOne: 0, rounds: 0,
    secretsPlayed: 0, secretRounds: 0, scoutRounds: 0,
    invasionRounds: 0, invasionDamagePct: [],
  };

  for (let seed = 1; seed <= RUNS; seed++) {
    let run = newRun(seed);
    const rival = drawRival(run.rivalSeed);
    stats.runs++;
    let guard = 0;
    while (!run.over && guard++ < 40) {
      run = startRound(run);
      const roundSeed = (seed * 7919 + run.round * 104729 + run.wins * 31) >>> 0;
      const { hand, seenCards } = refillHand(run, rng(roundSeed));
      run = { ...run, hand, seenCards };
      const rivalDay = rivalOnDay(rival, run.round);
      const chosen = bestPath(run, run.hand, score, { rivalDay });
      const out = chosen.out;
      const d = chosen.duel;

      stats.rounds++;
      stats.slots += PATH_SLOTS;
      const fizzled = out.events.filter((e) => e.kind === 'fizzle').length;
      stats.fizzles += fizzled;
      if (run.round <= 3) { stats.slotsEarly += PATH_SLOTS; stats.fizzlesEarly += fizzled; }
      if (run.round >= 5) { stats.slotsLate += PATH_SLOTS; stats.fizzlesLate += fizzled; }
      stats.pathDamagePct.push(out.pathDamage / out.state.maxHp);
      if (out.state.hp === 1) stats.flooredAtOne++;
      stats.secretsPlayed += out.secrets.length;
      if (out.secrets.length) stats.secretRounds++;
      if (out.usedWatchtower) stats.scoutRounds++;
      if (rivalDay.invasion) {
        stats.invasionRounds++;
        stats.invasionDamagePct.push(chosen.ambushDamage / out.state.maxHp);
      }

      stats.duels++;
      if (d.won) stats.duelWins++;
      stats.exchanges.push(d.exchanges);

      run = settleRound(out.state, d.won);
    }
    if (run.completed) stats.completed++;
  }
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
    // §12's 25–35% assumes ghosts roughly matched to the player. Ghosts are
    // anchored to a canonical round-N character (see js/ghosts.js's PACING
    // note), never to the specific player about to fight them — so a
    // planner that maximizes every round, permutation by permutation, keeps
    // outrunning the band it's calibrated against, the same way a real,
    // heavily-optimizing human player would outrun a same-bucket peer. The
    // target here is a sanity check, not a fixed pass/fail line: a perfect
    // optimizer shouldn't be clearing literally every run.
    ['run completion', pct(completion), 'high, not total', completion < 0.97],
    ['duel win rate', pct(s.duelWins / s.duels), '—', true],
    ['rounds ending floored at 1 HP', pct(s.flooredAtOne / s.rounds), 'rare — §12 risk #1',
      s.flooredAtOne / s.rounds < 0.12],
    // A secret costs a whole path slot and gives you nothing, so if a
    // duel-aware planner never chooses one they're priced wrong and the
    // mechanic is dead. Never expected to be *most* rounds — that would mean
    // countering beats building, which is the opposite failure.
    ['rounds laying a secret', pct(s.secretRounds / s.rounds), '10–45%',
      s.secretRounds / s.rounds >= 0.10 && s.secretRounds / s.rounds <= 0.45],
    ['rounds scouting (Watchtower)', pct(s.scoutRounds / s.rounds), '—', true],
    ['mean invasion damage / max HP', pct(mean(s.invasionDamagePct)), 'a real but survivable tax',
      mean(s.invasionDamagePct) < 0.25],
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
  'win rate" run above what a real player should expect. See tools/archetypes.mjs\n' +
  'for whether a realistic, single-strategy build gets a competitive fight.\n',
);
