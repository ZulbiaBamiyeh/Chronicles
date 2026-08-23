// Ghosts: the opponents. In the shipped game these are real players' characters,
// serialised at the end of their round and read back out of a bucket keyed by
// (round, wins). In the prototype there are no other players, so every ghost is
// generated here — which is exactly how the real thing starts anyway. §8.2:
// "At launch, every bucket is 100% bots. Players cannot tell and it does not
// matter." Generating them locally also makes them the balance dial: the
// archetype mix is chosen, not hoped for.
//
// CRITICAL: a ghost's stats are a pure function of (round, wins, seed) and
// nothing else. §2.1 and §8.1 aren't decoration — a ghost really is a frozen
// snapshot, uploaded once and fought by strangers afterward, same as a real
// player's would be. Two different players who draw the same ghost have to
// fight the *same* opponent; a ghost that quietly resized itself around
// whoever showed up would make that a lie, and would have no equivalent at
// all once this stops being a solo prototype and starts reading real
// snapshots over the network. (An earlier version of this file took the
// player's own post-path stats as an input and solved for a ghost sized to
// them specifically. It produced great duel pacing and was flatly wrong for
// that reason — see the git history if you're tempted to bring it back.)
//
// A generated ghost is built to the round's target band — see PACING below —
// then pushed into one of the four archetypes so the rock-paper-scissors
// between them actually shows up in the pool.

import { rng, pick, shuffle, tiersForRound } from './engine.js';
import { DEAL_POOL, GEAR, ALLIES, card } from './cards.js';

/** Round → the band a character at that point in a run is expected to be in
 *  (§9). This is the *only* thing a generated ghost's power is anchored to —
 *  never the specific player it's about to fight. */
// Nudged above §9's literal numbers, and nudged twice: once because every
// Tier 2 and Tier 3 monster leaves a permanent trophy, and again because the
// gear pool grew a great deal deeper (drops that hand over a free weapon or
// suit of armour on top of a trophy, plus a second rank of stronger Tier 3
// equipment) without the rival pool growing with it. A real character now
// climbs well past what §9's original table assumed, and a rival pinned to
// the old numbers falls further behind every round. In the shipped game this
// corrects itself for free — a rival is a real player, who found the same
// gear — so this is the bot pool standing in for that, not a difficulty
// thumb: it exists to be re-measured with tools/balance.mjs after every pool
// change, not tuned once and forgotten.
const TARGETS = {
  1: { atk: [3, 5], maxHp: [20, 24] },
  2: { atk: [7, 11], maxHp: [24, 30] },
  3: { atk: [12, 17], maxHp: [30, 37] },
  4: { atk: [18, 25], maxHp: [36, 45] },
  5: { atk: [26, 38], maxHp: [43, 55] },
};

// ---------------------------------------------------------------------------
// PACING
//
// §9's own band lets ATK outgrow max HP as the rounds climb, which on its
// own would make a duel between two *equally*-built round-N characters end
// in one or two blows well before round 5. A ghost is still only ever built
// to this band, never to a specific opponent (see the note at the top of
// this file) — but within that constraint, a ghost's ATK and max HP aren't
// simply lerped from the band's min/max. They're set to take a target
// number of exchanges (§12's own 3–6 window) to resolve against a *canonical
// round-N character* — one sitting at the same point in the band this ghost
// itself was drawn from — the way Chronicle's own climactic "fight to the
// death" plays out over several real exchanges rather than one. Everything
// downstream of that (archetype keywords, First Strike, Poison, Rally,
// Thorns) still applies normally and still swings an individual fight — a
// Poison ghost still eats through Armour, a Tank still grinds — this only
// sets the baseline the archetypes bend.
//
// A real player who over- or under-shoots that canonical band — by playing
// unusually well, unusually badly, or just having a lucky Spoil run — gets a
// duel that isn't perfectly paced against *them specifically*, the same way
// two real human players' snapshots wouldn't be perfectly matched either.
// That's normal variance, not a bug this file is responsible for fixing; see
// README.md's Balance section for where that variance actually lives and
// what, if anything, is worth doing about it.
//
// Both sides of every archetype's range below are equal, or close to it — the
// asymmetry an archetype is supposed to have comes from its actual keyword
// (Armour, Poison, Rally, First Strike), applied for real by the resolver,
// not from thumbing the pacing target itself. Set these unevenly and a
// "coin flip" archetype quietly becomes a guaranteed loss no card choice can
// fix, independent of how well the player built — exactly the thing this
// whole scheme exists to avoid. (An earlier pass here learned that the hard
// way: the numbers looked "fair" as a symmetric average, but derived from the
// same random draw for both sides they moved in lockstep, so most duels
// landed as a near-tie — and ties resolve toward the ghost by design, §8.3 —
// which meant the ghost was winning almost everything anyway. Two independent
// draws below fix it; see the comment at killGhostIn/killPlayerIn.)
const EXCHANGE_TARGET = {
  //            [to kill the ghost, to kill the player]
  aggro:  [[2.5, 3.8], [2.5, 3.8]],
  tank:   [[5.0, 6.8], [5.0, 6.8]],
  poison: [[3.6, 5.0], [3.6, 5.0]],
  rally:  [[4.2, 5.8], [4.2, 5.8]],
};

const baseArmour = (tier) => Math.max(0, tier - 1);   // T1 → 0, T2 → 1, T3 → 2

// A ghost built purely off the canonical ATK for its band would, at the low
// end of a band where ATK sits far below max HP, end up with an oddly
// paper-thin HP pool itself. This is the floor (a third of the canonical max
// HP for the round) below which a ghost's HP is never allowed to fall,
// regardless of how low the round's canonical ATK is.
const HP_FLOOR = 0.35;

const NAMES = [
  'Torvald', 'Bryn', 'Ashfen', 'Marrow', 'Kestrel', 'Dunmar', 'Sable', 'Orrin',
  'Vex', 'Halric', 'Nettle', 'Corvin', 'Ilse', 'Ragnar', 'Wick', 'Thessaly',
  'Gaunt', 'Pell', 'Ysolde', 'Brack', 'Mirelle', 'Odd', 'Cinder', 'Valla',
  'Grimm', 'Locke', 'Sorrel', 'Hew', 'Tamsin', 'Rook', 'Alder', 'Fenrick',
];

/**
 * The four archetypes from §5, each spending part of its EXCHANGE_TARGET
 * budget on the keyword that defines it, so a Tank really is slower and
 * harder and Aggro really does hit first and hit hard.
 */
export const ARCHETYPES = {
  aggro: {
    label: 'Aggro',
    build: (g) => {
      g.keywords.firstStrike = true;
    },
  },
  tank: {
    label: 'Tank',
    build: (g, r, tier) => {
      g.keywords.armour += 1 + Math.floor(r() * 2) + Math.floor(tier / 2);
      if (r() < 0.4) g.keywords.thorns = 1 + Math.floor(tier / 2);
    },
  },
  poison: {
    label: 'Poison',
    build: (g, r, tier) => {
      g.keywords.poison = 1 + Math.floor(r() * 2) + Math.floor(tier / 2);
      if (r() < 0.35) g.keywords.firstStrike = true;
    },
  },
  rally: {
    label: 'Rally',
    build: (g, r, tier) => {
      // Rally opens weak on purpose — the whole point of the archetype is
      // that it isn't a threat until it's already lived through a few
      // exchanges, which the wide EXCHANGE_TARGET band above guarantees it
      // gets to.
      g.keywords.rally = 1 + Math.floor(tier / 2) + Math.floor(r() * 2);
    },
  },
};

const KEYS = Object.keys(ARCHETYPES);

const lerp = (band, t) => band[0] + (band[1] - band[0]) * t;

/**
 * Draw an opponent for the (round, wins) bucket. Deterministic in (round,
 * wins, seed) alone — the same three inputs always produce the exact same
 * ghost, byte for byte, which is the one property this function is not
 * allowed to trade away for anything, including better duel pacing.
 *
 * Wins are a difficulty dial inside the bucket: a player on 4 wins has been
 * winning duels, so the ghosts at that point in a run should be the ones that
 * beat somebody. Nothing here is hidden from the player — Watchtower shows the
 * numbers, and every number it shows is one the resolver will actually use.
 *
 * The fourth argument is *not* a way to size a ghost against an opponent, and
 * never becomes one. The only key it honours is `archetype`, which pins which
 * of the four builds this ghost is — that's the ghost's own identity, decided
 * before anyone has been matched against it, and it exists so js/rival.js can
 * hold one character's archetype steady across the five days of their run.
 * Anything else in that object is ignored, and the test suite asserts it.
 *
 * @param {number} round
 * @param {number} wins
 * @param {number} seed
 * @param {{archetype?: string}} [opts]
 */
export function drawGhost(round, wins, seed, opts = {}) {
  const r = rng(seed);
  const tier = Math.max(...tiersForRound(round));
  const band = TARGETS[Math.min(5, Math.max(1, round))];
  const t = Math.min(1, wins / 4) * 0.55 + r() * 0.45;

  // The canonical round-N character this ghost is paced against — not the
  // ghost's own stats (those are what's being solved for below) and never
  // the player who happens to be about to fight it.
  const canonAtk = Math.max(1, lerp(band.atk, t));
  const canonMaxHp = Math.max(8, lerp(band.maxHp, t));

  // Drawn either way, so pinning the archetype never shifts the rest of the
  // random stream — a pinned ghost and a free one differ in archetype alone.
  const rolled = pick(KEYS, r);
  const archetype = KEYS.includes(opts?.archetype) ? opts.archetype : rolled;
  const [[killGhostLo, killGhostHi], [killPlayerLo, killPlayerHi]] = EXCHANGE_TARGET[archetype];

  // Difficulty ramps with wins inside the bucket: at higher wins, both sides
  // of the range lean a little harder on the player. Each side also gets its
  // *own* random draw rather than sharing one, which matters more than it
  // looks: pulling both from a single value makes them move in lockstep
  // opposite directions, so whenever one lands easy the other lands hard by
  // construction, every time — a duel is a near-tie on almost every draw, and
  // ties resolve toward the ghost (§8.3, deliberately), so "almost every duel
  // is a near-tie" quietly means "the ghost wins almost every duel." Two
  // independent draws let the two sides actually vary relative to each
  // other, so most duels get decided well before the tiebreak, and the
  // tiebreak is left doing the occasional, deliberate job §8.3 gives it.
  const wins01 = Math.min(1, wins / 4);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const killGhostIn = killGhostLo + (killGhostHi - killGhostLo) * clamp01(wins01 * 0.35 + r() * 0.85);
  const killPlayerIn = killPlayerHi - (killPlayerHi - killPlayerLo) * clamp01(wins01 * 0.35 + r() * 0.85);

  const g = {
    name: pick(NAMES, r),
    round,
    wins,
    atk: 1,       // set below, once this archetype's Armour is known
    maxHp: 1,
    hp: 0,
    gold: Math.floor(r() * 12),
    keywords: { armour: baseArmour(tier), thorns: 0, poison: 0, rally: 0, firstStrike: false },
    archetype,
  };

  ARCHETYPES[archetype].build(g, r, tier);

  // The ghost's own Armour comes off the canonical ATK before the "how many
  // hits to kill the ghost" target is applied — a Tank ghost is meant to be
  // this tanky on purpose, not tanky *and* still die on schedule. Set a floor
  // of 1 so a heavily armoured ghost can never demand literally infinite
  // damage to reach zero.
  const dmgToGhost = Math.max(1, canonAtk - g.keywords.armour);
  const targetHp = Math.max(6, dmgToGhost * killGhostIn, canonMaxHp * HP_FLOOR);

  // g.atk is *not* solved to be compensated for the real player's own
  // Armour, Thorns, Poison, Rally, or First Strike, because it can't be — a
  // ghost is fixed the moment it's drawn, before anyone knows who's about to
  // fight it. A well-built player still gets the benefit of every point of
  // Armour or Poison they earned, same as they would against a real human
  // opponent's snapshot. What *is* solved for is the ghost's own Poison,
  // Thorns, Rally, and First Strike — extra damage this archetype rolled for
  // itself, on top of raw ATK, that the canonical-band target below would
  // otherwise silently overshoot. A Poison tick and a Thorns reflection both
  // land on top of a normal attack, not instead of it, and Rally means the
  // opening ATK understates the fight's average — solve for the base ATK
  // that, added to those extras over killPlayerIn exchanges, totals
  // canonMaxHp, so the target is a promise about total damage dealt against
  // the canonical band, not about one stat in isolation.
  const kw = g.keywords;
  const extraPerExchange = kw.poison + kw.thorns;                 // land every exchange
  const rallyGrowth = kw.rally * killPlayerIn * (killPlayerIn - 1) / 2; // triangular sum
  const strikes = killPlayerIn + (kw.firstStrike ? 1 : 0);         // one bonus hit, free
  const baseAtk = (canonMaxHp - extraPerExchange * killPlayerIn - rallyGrowth) / strikes;
  g.atk = Math.max(1, Math.round(baseAtk));

  // Ghosts arrive off a path of their own, so they are rarely at full health —
  // between 65% and 100%, the same range a player's own greedy line leaves
  // them. That has to be priced into maxHp, not subtracted from it after the
  // fact: the exchange-count target above is a promise about the fight that's
  // about to happen, i.e. about g.hp, so maxHp is inflated by however much
  // this roll is about to take back off.
  const freshness = 0.8 + r() * 0.2;
  g.maxHp = Math.max(6, Math.round(targetHp / freshness));
  g.hp = Math.max(1, Math.round(g.maxHp * freshness));
  g.path = flavourPath(round, r);
  // Everything above is settled before the kit is chosen, so an inventory can
  // never move a number the pacing math already solved for.
  g.inventory = flavourInventory(g, round, r);
  return g;
}

/**
 * The gear a ghost is "wearing". Chosen to explain the statline it already
 * has — a ghost with Poison 4 is carrying something venomous, a ghost with
 * Armour 5 is in real plate, and its weapon is one a character with that much
 * ATK could plausibly be swinging at that point in a run.
 *
 * This is flavour, in the same sense as `path` above: it drives the equipment
 * panel and which attack animation the ghost plays, and nothing else. Deriving
 * the stats *from* a drafted inventory instead would be the more authentic
 * model, but it would put the carefully-solved exchange-count pacing at the
 * mercy of whatever the draft happened to roll — so the stats stay
 * authoritative and the kit is fitted to them, not the other way round.
 */
function flavourInventory(g, round, r) {
  const tiers = tiersForRound(round);
  const affordable = [...GEAR, ...ALLIES].filter((c) => tiers.includes(c.tier));
  const worn = [];

  // One item per keyword the ghost actually has, preferring the strongest
  // version of it this round could have produced.
  for (const key of ['armour', 'poison', 'thorns', 'rally']) {
    if (!g.keywords[key]) continue;
    const options = affordable.filter((c) => c.slot === key);
    if (!options.length) continue;
    const best = options.reduce((a, b) => ((b.fx?.[key] || 0) > (a.fx?.[key] || 0) ? b : a));
    // The strongest fitting item, or a weaker one when the ghost's stack is
    // small — so an Armour 1 ghost isn't drawn wearing Dragonplate.
    const fit = options.filter((c) => (c.fx?.[key] || 0) <= g.keywords[key]);
    worn.push((fit.length ? pick(fit, r) : best).id);
  }

  // A weapon whose ATK is the closest match to what this ghost hits for.
  const weapons = affordable.filter((c) => c.slot === 'atk');
  if (weapons.length) {
    const closest = weapons.reduce((a, b) =>
      Math.abs((b.fx.atk || 0) - g.atk) < Math.abs((a.fx.atk || 0) - g.atk) ? b : a);
    worn.push(closest.id);
  }

  // First Strike is a property of the kit too — if the ghost has it and isn't
  // already carrying something that grants it, give it the item that does.
  if (g.keywords.firstStrike && !worn.some((id) => card(id)?.fx?.firstStrike)) {
    const fs = affordable.filter((c) => c.fx?.firstStrike);
    if (fs.length) worn.push(pick(fs, r).id);
  }

  return [...new Set(worn)];
}

/**
 * Four card names for the ghost's "how they got here" line. Purely cosmetic —
 * the ghost's stats are generated, not derived from these — but it sells the
 * fiction that the opponent walked a path like yours, and it reads better on
 * the duel screen than a bare statline.
 */
function flavourPath(round, r) {
  const tiers = tiersForRound(round);
  const pool = DEAL_POOL.filter((c) => tiers.includes(c.tier));
  return shuffle(pool, r).slice(0, 4).map((c) => c.id);
}

/** A name for the player's own character, drawn from the same pool as ghosts. */
export const randomName = () => NAMES[Math.floor(Math.random() * NAMES.length)];

/** Pretty names for a ghost's path, for the duel screen. */
export const pathNames = (ids = []) => ids.map((id) => card(id)?.name).filter(Boolean);
