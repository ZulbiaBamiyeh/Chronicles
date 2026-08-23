// Simulates five committed build strategies across full runs, to check
// whether each of the game's intended archetypes (§5's loose triangle —
// Aggro, Tank, Poison, Rally) is actually a viable way to play, not just a
// flavour label on cards nobody has a reason to pick.
//
//   node tools/archetypes.mjs [runs]
//
// Each strategy scores a candidate path by how much it *leans into* one
// stat family — not exclusively, since no real player zeroes out ATK to
// chase Armour with nothing else; leaning weights model a player who favours
// a direction while still picking up the obviously good cards along the way.
// An earlier, exclusive-weight version of this sweep made Tank and Thorns
// look badly broken (2–3% completion against everything else's 12–15%+);
// under realistic leaning weights they're competitive with everything else
// (see README.md's Balance section for the actual numbers). That gap is the
// reason this tool exists as a committed script rather than a one-off check:
// "is this build viable" depends entirely on what a real, sane player
// building that way would actually do, and it's worth being able to re-run
// after any card change.
import {
  newRun, startRound, resolvePath, duel, settleRound, rng, PATH_SLOTS, refillHand, resolveAmbush,
} from '../js/engine.js';
import { drawRival, rivalOnDay } from '../js/rival.js';

const STRATEGIES = {
  atk: (s) => s.atk * 6 + s.hp * 0.3 + s.maxHp * 0.15,
  tank: (s) => s.kw.armour * 6 + s.atk * 1.8 + s.maxHp * 0.5 + s.hp * 0.25,
  poison: (s) => s.kw.poison * 6 + s.atk * 2.2 + s.hp * 0.25 + s.kw.armour * 1.5,
  rally: (s) => s.kw.rally * 6 + s.atk * 2.2 + s.hp * 0.25 + s.maxHp * 0.3 + s.kw.armour * 1.5,
  thorns: (s) => s.kw.thorns * 6 + s.kw.armour * 2.5 + s.atk * 1.8 + s.hp * 0.25,
  // The generalist from tools/balance.mjs, included as the reference point
  // every themed strategy is measured against.
  balanced: (s) => s.atk * 2.6 + s.hp * 1.0 + s.maxHp * 0.35 + s.gold * 0.25 +
    s.kw.armour * 4 + s.kw.poison * 3 + s.kw.rally * 5.5 + s.kw.thorns * 2 + (s.kw.firstStrike ? 4 : 0),
};

/**
 * Same brute-force best-of-permutations planner as tools/balance.mjs, and
 * rival-aware for the same reason: winning today's duel beats any statline,
 * and a secret only ever scores if candidate paths are judged by the fight
 * they lead to rather than by the stats they leave behind.
 */
function bestPath(run, hand, score, rivalDay) {
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
      if (rivalDay.invasion) {
        const ambush = resolveAmbush(out.state, rivalDay.invasion);
        out = { ...out, state: ambush.state, pathDamage: out.pathDamage + ambush.damage,
          cleanPath: out.cleanPath && ambush.damage === 0 };
      }
      const d = duel(out.state, rivalDay, out.cleanPath, {
        mine: out.secrets, theirs: rivalDay.secrets,
      });
      const value = (d.won ? 500 : 0) + score(out.state);
      if (!best || value > best.value) best = { value, out, duel: d };
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

function simulate(strategyName, runs) {
  const score = STRATEGIES[strategyName];
  let completed = 0, duels = 0, wins = 0;
  const finalByRound = {};
  for (let seed = 1; seed <= runs; seed++) {
    let run = newRun(seed);
    const rival = drawRival(run.rivalSeed);
    let guard = 0;
    while (!run.over && guard++ < 40) {
      run = startRound(run);
      const roundSeed = (seed * 7919 + run.round * 104729 + run.wins * 31) >>> 0;
      const { hand, seenCards } = refillHand(run, rng(roundSeed));
      run = { ...run, hand, seenCards };
      const chosen = bestPath(run, run.hand, score, rivalOnDay(rival, run.round));
      const out = chosen.out;
      (finalByRound[run.round] ||= []).push(out.state);
      const d = chosen.duel;
      duels++; if (d.won) wins++;
      run = settleRound(out.state, d.won);
    }
    if (run.completed) completed++;
  }
  return { completed: completed / runs, winRate: wins / duels, finalByRound };
}

const RUNS = Number(process.argv[2] || 600);
const mean = (arr, f) => (arr.length ? (arr.reduce((a, s) => a + f(s), 0) / arr.length).toFixed(1) : '—');

console.log(`Archetype viability — ${RUNS} runs each, best-of-permutations planner leaning into one stat family\n`);
const results = {};
for (const name of Object.keys(STRATEGIES)) {
  results[name] = simulate(name, RUNS);
}
for (const [name, r] of Object.entries(results)) {
  const r5 = r.finalByRound[5] || [];
  console.log(
    `${name.padEnd(9)} completion=${(r.completed * 100).toFixed(1).padStart(5)}%  duelWin=${(r.winRate * 100).toFixed(1).padStart(5)}%` +
    `  round5: atk=${mean(r5, s => s.atk)} maxHp=${mean(r5, s => s.maxHp)} armour=${mean(r5, s => s.kw.armour)}` +
    ` poison=${mean(r5, s => s.kw.poison)} rally=${mean(r5, s => s.kw.rally)} thorns=${mean(r5, s => s.kw.thorns)} (n=${r5.length})`,
  );
}

const themed = ['tank', 'poison', 'rally', 'thorns'].map((k) => results[k].completed);
const spread = Math.max(...themed) - Math.min(...themed);
console.log(
  `\nSpread across the four themed archetypes: ${(spread * 100).toFixed(1)} points of completion.` +
  ' A wide spread here means one keyword archetype is dead weight or dominant; a narrow one means the §5 "loose triangle" is actually holding.',
);
