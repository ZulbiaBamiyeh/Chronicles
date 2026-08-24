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
import { weaponAtk } from '../js/cards.js';
import * as deckLib from '../js/deck.js';

// Weapon ATK stopped being part of the permanent s.atk stat once durability
// shipped — it's only ever added live, from whichever weapon is currently
// held and unbroken (see README's "Weapon durability capped the ceiling").
// Every strategy below reads s.atk directly to score a candidate path; blind
// to a weapon's live contribution, a purchase reads as pure downside (gold
// spent, nothing gained) and gets systematically avoided. Harmless for a
// deck with plenty of other atk sources to fall back on; it silently
// starved The Fence and The Bloodbound of the only real atk either deck
// has, before this was caught (both measured at 0% completion, 0.1% duel
// win — losing essentially every duel because the planner never once chose
// to equip the sword it was holding).
const effectiveAtk = (s) => s.atk + weaponAtk(s.gear, s.durability);

// Every themed strategy weighted current HP far below the generalist's own
// 1.0 (0.25-0.5 here against 1.0 there), which let the planner walk into path
// damage a "balanced" run of the same numbers would have routed around — a
// Poison build was measured arriving at duels on a third of its max HP,
// making its own real strength (Poison ticks every exchange regardless of
// Armour) moot when the fight is over in two hits either way. Bringing every
// themed weight up near the generalist's own keeps the lean toward the
// signature stat without that self-inflicted fragility being what the sweep
// actually measures.
const STRATEGIES = {
  atk: (s) => effectiveAtk(s) * 6 + s.hp * 0.9 + s.maxHp * 0.3,
  tank: (s) => s.kw.armour * 6 + effectiveAtk(s) * 1.8 + s.maxHp * 0.5 + s.hp * 0.9,
  poison: (s) => s.kw.poison * 6 + effectiveAtk(s) * 2.2 + s.hp * 0.9 + s.kw.armour * 1.5,
  rally: (s) => s.kw.rally * 6 + effectiveAtk(s) * 2.2 + s.hp * 0.9 + s.maxHp * 0.3 + s.kw.armour * 1.5,
  thorns: (s) => s.kw.thorns * 6 + s.kw.armour * 2.5 + effectiveAtk(s) * 1.8 + s.hp * 0.9,
  // The generalist from tools/balance.mjs, included as the reference point
  // every themed strategy is measured against.
  balanced: (s) => effectiveAtk(s) * 2.6 + s.hp * 1.0 + s.maxHp * 0.35 + s.gold * 0.25 +
    s.kw.armour * 4 + s.kw.poison * 3 + s.kw.rally * 5.5 + s.kw.thorns * 2 + (s.kw.firstStrike ? 4 : 0),
  // The four hero-inspired decks (see js/deck.js) don't lean on a permanent
  // kw stack the way the §5 four do — their payoff cards (Gilded Edge, Vein
  // Drain, Marked Quarry, ...) all convert into plain atk/hp/maxHp the
  // moment they resolve, so there's nothing extra for these scores to read:
  // whatever their signature card earned is already sitting in effectiveAtk
  // by the time a path is scored. Each still weights gold or maxHp a bit
  // above the generalist's own, to prefer the paths that actually lean into
  // the theme when two orderings would otherwise score close to even.
  fence: (s) => effectiveAtk(s) * 3 + s.hp * 0.9 + s.maxHp * 0.4 + s.gold * 0.9 + s.kw.armour * 2,
  bloodbound: (s) => effectiveAtk(s) * 3.2 + s.hp * 1.0 + s.maxHp * 0.7 + s.kw.armour * 2.5,
  hunter: (s) => effectiveAtk(s) * 4 + s.hp * 0.9 + s.maxHp * 0.3 + s.gold * 0.4 + s.kw.armour * 1.5,
  adept: (s) => effectiveAtk(s) * 2 + s.hp * 1.0 + s.maxHp * 0.4 + s.gold * 0.4 + s.kw.armour * 1.5,
};

// This tool used to draw every strategy from the full 119-card pool instead of
// the deck a real player actually plays with — which meant "leaning into
// Aggro" was diluted by dozens of unrelated cards the Duellist preset would
// never carry, and the sweep read as far more moderate than real play. A
// preset deck concentrates the theme's own synergy cards; this maps each
// strategy to the preset that actually represents it. Thorns has no preset of
// its own — The Bulwark carries both Armour and Thorns — so it borrows tank's.
const STRATEGY_DECK = {
  atk: 'aggro', tank: 'tank', poison: 'poison', rally: 'rally',
  thorns: 'tank', balanced: 'balanced',
  fence: 'fence', bloodbound: 'bloodbound', hunter: 'hunter', adept: 'adept',
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
  const deck = deckLib.presetCards(STRATEGY_DECK[strategyName]);
  let completed = 0, duels = 0, wins = 0;
  const finalByRound = {};
  for (let seed = 1; seed <= runs; seed++) {
    let run = newRun(seed, 'x', deck);
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

const allThemed = Object.keys(STRATEGIES).filter((k) => k !== 'balanced' && k !== 'atk')
  .map((k) => results[k].completed);
const allSpread = Math.max(...allThemed) - Math.min(...allThemed);
console.log(
  `Spread across every themed archetype, hero decks included: ${(allSpread * 100).toFixed(1)} points of completion.`,
);
