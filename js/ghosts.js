// Ghosts: the opponents. In the shipped game these are real players' characters,
// serialised at the end of their round and read back out of a bucket keyed by
// (round, wins). In the prototype there are no other players, so every ghost is
// generated here — which is exactly how the real thing starts anyway. §8.2:
// "At launch, every bucket is 100% bots. Players cannot tell and it does not
// matter." Generating them locally also makes them the balance dial: the
// archetype mix is chosen, not hoped for.
//
// A generated ghost is built to the same targets the player is scaling against
// (§9), then pushed into one of the four archetypes so the rock-paper-scissors
// between them actually shows up in the ghost pool.

import { rng, pick, shuffle, tiersForRound } from './engine.js';
import { DEAL_POOL, card } from './cards.js';

/** Round → the band the player is expected to be in (§9). */
const TARGETS = {
  1: { atk: [3, 5], maxHp: [20, 24] },
  2: { atk: [6, 9], maxHp: [22, 28] },
  3: { atk: [10, 14], maxHp: [26, 32] },
  4: { atk: [15, 21], maxHp: [30, 36] },
  5: { atk: [22, 32], maxHp: [34, 44] },
};

const NAMES = [
  'Torvald', 'Bryn', 'Ashfen', 'Marrow', 'Kestrel', 'Dunmar', 'Sable', 'Orrin',
  'Vex', 'Halric', 'Nettle', 'Corvin', 'Ilse', 'Ragnar', 'Wick', 'Thessaly',
  'Gaunt', 'Pell', 'Ysolde', 'Brack', 'Mirelle', 'Odd', 'Cinder', 'Valla',
  'Grimm', 'Locke', 'Sorrel', 'Hew', 'Tamsin', 'Rook', 'Alder', 'Fenrick',
];

/**
 * The four archetypes from §5. Each takes the ghost's raw ATK/HP budget and
 * spends part of it on the keywords that define it, so a Tank really is
 * slower and harder, and Aggro really does hit first and hit hard.
 */
export const ARCHETYPES = {
  aggro: {
    label: 'Aggro',
    build: (g) => {
      g.atk = Math.round(g.atk * 1.25);
      g.maxHp = Math.round(g.maxHp * 0.85);
      g.keywords.firstStrike = true;
    },
  },
  tank: {
    label: 'Tank',
    build: (g, r, tier) => {
      g.atk = Math.round(g.atk * 0.75);
      g.maxHp = Math.round(g.maxHp * 1.2);
      g.keywords.armour = 1 + Math.floor(r() * 2) + tier;
      if (r() < 0.4) g.keywords.thorns = 1 + tier;
    },
  },
  poison: {
    label: 'Poison',
    build: (g, r, tier) => {
      g.atk = Math.round(g.atk * 0.8);
      g.keywords.poison = 1 + Math.floor(r() * 2) + tier;
      if (r() < 0.35) g.keywords.firstStrike = true;
    },
  },
  rally: {
    label: 'Rally',
    build: (g, r, tier) => {
      g.atk = Math.round(g.atk * 0.6);
      g.maxHp = Math.round(g.maxHp * 1.1);
      g.keywords.rally = tier + Math.floor(r() * 2);
    },
  },
};

const KEYS = Object.keys(ARCHETYPES);

const lerp = (band, t) => Math.round(band[0] + (band[1] - band[0]) * t);

/**
 * Draw an opponent for the (round, wins) bucket.
 *
 * Wins are a difficulty dial inside the bucket: a player on 4 wins has been
 * winning duels, so the ghosts at that point in a run should be the ones that
 * beat somebody. Nothing here is hidden from the player — Watchtower shows the
 * numbers, and every number it shows is one the resolver will actually use.
 *
 * @param {number} round
 * @param {number} wins
 * @param {number} seed
 */
export function drawGhost(round, wins, seed) {
  const r = rng(seed);
  const band = TARGETS[Math.min(5, Math.max(1, round))];
  const tier = Math.max(...tiersForRound(round));

  // Position in the band: partly the run's progress, partly noise, so a bucket
  // holds a spread of opponents rather than one repeated statline.
  const t = Math.min(1, wins / 4) * 0.55 + r() * 0.45;

  const g = {
    name: pick(NAMES, r),
    round,
    wins,
    atk: lerp(band.atk, t),
    maxHp: lerp(band.maxHp, t),
    hp: 0,
    gold: Math.floor(r() * 12),
    keywords: { armour: 0, thorns: 0, poison: 0, rally: 0, firstStrike: false },
    archetype: pick(KEYS, r),
  };

  ARCHETYPES[g.archetype].build(g, r, tier);

  // Ghosts arrive off a path of their own, so they are rarely at full health —
  // between 65% and 100%, the same range a player's own greedy line leaves them.
  g.maxHp = Math.max(8, g.maxHp);
  g.atk = Math.max(1, g.atk);
  g.hp = Math.max(1, Math.round(g.maxHp * (0.65 + r() * 0.35)));
  g.path = flavourPath(round, r);
  return g;
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
