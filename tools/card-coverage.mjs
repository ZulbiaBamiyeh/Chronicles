// Which cards, across a spread of committed strategies, never get chosen by
// any of them? A card no strategy ever wants is dead weight in the pool —
// "interesting items" means every card earns its slot for at least one way
// of playing, not that all 70 are equally good in every hand.
//
//   node tools/card-coverage.mjs [runs]

import {
  newRun, startRound, deal, resolvePath, duel, settleRound, rng, PATH_SLOTS,
} from '../js/engine.js';
import { ALL_CARDS } from '../js/cards.js';
import { drawGhost } from '../js/ghosts.js';

const STRATEGIES = {
  atk: (s) => s.atk * 6 + s.hp * 0.3 + s.maxHp * 0.15,
  tank: (s) => s.kw.armour * 6 + s.atk * 1.8 + s.maxHp * 0.5 + s.hp * 0.25,
  poison: (s) => s.kw.poison * 6 + s.atk * 2.2 + s.hp * 0.25 + s.kw.armour * 1.5,
  rally: (s) => s.kw.rally * 6 + s.atk * 2.2 + s.hp * 0.25 + s.maxHp * 0.3 + s.kw.armour * 1.5,
  thorns: (s) => s.kw.thorns * 6 + s.kw.armour * 2.5 + s.atk * 1.8 + s.hp * 0.25,
  balanced: (s) => s.atk * 2.6 + s.hp * 1.0 + s.maxHp * 0.35 + s.gold * 0.25 +
    s.kw.armour * 4 + s.kw.poison * 3 + s.kw.rally * 5.5 + s.kw.thorns * 2 + (s.kw.firstStrike ? 4 : 0),
};

function bestPath(run, hand, score) {
  const available = hand.map((id) => ({ id, from: 'hand' }));
  let best = null;
  const chosen = [];
  const used = new Set();
  const walk = () => {
    if (chosen.length === PATH_SLOTS) {
      const out = resolvePath(run, chosen.slice());
      const value = score(out.state);
      if (!best || value > best.value) best = { value, out, slots: chosen.slice() };
      return;
    }
    for (let i = 0; i < available.length; i++) {
      if (used.has(i)) continue;
      used.add(i); chosen.push(available[i]); walk(); chosen.pop(); used.delete(i);
    }
  };
  walk();
  return best;
}

const RUNS = Number(process.argv[2] || 400);
const counts = new Map();
const used = new Set();

for (const score of Object.values(STRATEGIES)) {
  for (let seed = 1; seed <= RUNS; seed++) {
    let run = newRun(seed);
    let guard = 0;
    while (!run.over && guard++ < 40) {
      run = startRound(run);
      const roundSeed = (seed * 7919 + run.round * 104729 + run.wins * 31) >>> 0;
      const hand = deal(run.round, rng(roundSeed));
      const chosen = bestPath(run, hand, score);
      const out = chosen.out;
      for (const slot of chosen.slots) { used.add(slot.id); counts.set(slot.id, (counts.get(slot.id) || 0) + 1); }
      const ghost = drawGhost(run.round, run.wins, (roundSeed ^ 0x2545f491) >>> 0);
      const d = duel(out.state, ghost, out.cleanPath);
      run = settleRound(out.state, d.won);
    }
  }
}

const dead = ALL_CARDS.filter((c) => !used.has(c.id));
const ranked = ALL_CARDS.map((c) => ({ c, n: counts.get(c.id) || 0 })).sort((a, b) => a.n - b.n);

console.log(`Card coverage — ${RUNS} runs × ${Object.keys(STRATEGIES).length} strategies\n`);
console.log(`${used.size} / ${ALL_CARDS.length} cards chosen or won by at least one strategy`);
if (dead.length) {
  console.log('\nnever chosen by any strategy — genuinely dead weight:');
  for (const c of dead) console.log(`  ${c.no}. ${c.name} (${c.type}, T${c.tier})`);
} else {
  console.log('no dead cards.');
}
console.log('\nrarest 15 (lower is expected for T3 — fewer runs ever reach round 5):');
for (const { c, n } of ranked.slice(0, 15)) {
  console.log(`  ${String(n).padStart(4)}  ${c.no}. ${c.name} (${c.type}, T${c.tier})`);
}
