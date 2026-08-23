// Ghosts: the opponents. In the shipped game these are real players' characters,
// serialised at the end of their round and read back out of a bucket keyed by
// (round, wins). In the prototype there are no other players, so every ghost is
// generated here — which is exactly how the real thing starts anyway. §8.2:
// "At launch, every bucket is 100% bots. Players cannot tell and it does not
// matter." Generating them locally also makes them the balance dial: the
// archetype mix is chosen, not hoped for.
//
// A generated ghost is built relative to the player it's about to face, then
// pushed into one of the four archetypes so the rock-paper-scissors between
// them actually shows up in the pool. See PACING below for why "relative to
// the player" rather than a fixed table.

import { rng, pick, shuffle, tiersForRound } from './engine.js';
import { DEAL_POOL, card } from './cards.js';

/** Round → the band the player is expected to be in (§9). Used as a fallback
 *  when a ghost is drawn with no player state to scale against, and to keep
 *  a very over- or under-built player meeting something that still reads as
 *  "round N" rather than a trivial pushover or a wall. */
const TARGETS = {
  1: { atk: [3, 5], maxHp: [20, 24] },
  2: { atk: [6, 9], maxHp: [22, 28] },
  3: { atk: [10, 14], maxHp: [26, 32] },
  4: { atk: [15, 21], maxHp: [30, 36] },
  5: { atk: [22, 32], maxHp: [34, 44] },
};

// ---------------------------------------------------------------------------
// PACING
//
// §9's own band lets ATK outgrow max HP as the rounds climb, and ATK is
// permanent — every gear card ever bought stays on the sheet all run. A path
// that leans into ATK (which a rational player has every reason to, since
// it's what wins duels) compounds it round over round, so by round 3 or 4 a
// player can be swinging for several times what a fixed target table assumed.
// A ghost built off that table alone gets one-shot; a ghost built defensively
// tough enough to survive a maxed-out player instead flattens anyone who
// *didn't* min-max ATK. Neither reads as a fight — one's a coin flip, the
// other's a wall.
//
// So a ghost's core stats aren't drawn from the table at all. They're set
// directly to take a target number of exchanges to resolve against whatever
// this particular player's ATK and max HP actually are, post-path, right now
// — the way Chronicle's own climactic "fight to the death" plays out over
// several real exchanges regardless of how the chapters before it went. The
// target itself is exactly §12's own duel-length window (3–6), so hitting it
// isn't a coincidence of tuning, it's the thing being solved for. Everything
// downstream of that (archetype keywords, First Strike, Poison, Rally, Thorns)
// still applies normally and still swings an individual fight — a Poison
// ghost still eats through Armour, a Tank still grinds — this only sets the
// baseline the archetypes bend.
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

// A ghost built purely off the player's ATK hands a defensive, low-ATK build
// a paper-thin opponent (easy to finish quickly) while that same build's own
// high HP and Armour make it slow to bring down in return — pacing survives
// that fine, but the fight stops being one. This is the floor (a third of the
// player's own max HP) below which a ghost's HP is never allowed to fall,
// regardless of how little raw ATK the player is bringing to the fight.
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
 * Draw an opponent for the (round, wins) bucket, sized to actually fight the
 * player handed in.
 *
 * Wins are a difficulty dial inside the bucket: a player on 4 wins has been
 * winning duels, so the ghosts at that point in a run should be the ones that
 * beat somebody. Nothing here is hidden from the player — Watchtower shows the
 * numbers, and every number it shows is one the resolver will actually use.
 *
 * @param {number} round
 * @param {number} wins
 * @param {number} seed
 * @param {{atk:number, maxHp:number}} [player] the player's post-path stats.
 *   Omit only when there's no real player to scale against (a bare flavour
 *   draw, or a test) — the §9 band is used as a stand-in instead.
 */
export function drawGhost(round, wins, seed, player) {
  const r = rng(seed);
  const tier = Math.max(...tiersForRound(round));
  const band = TARGETS[Math.min(5, Math.max(1, round))];
  const t = Math.min(1, wins / 4) * 0.55 + r() * 0.45;

  const pAtk = Math.max(1, player ? player.atk : lerp(band.atk, t));
  const pMaxHp = Math.max(8, player ? player.maxHp : lerp(band.maxHp, t));

  const archetype = pick(KEYS, r);
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

  // The ghost's own Armour comes off the player's ATK before the "how many
  // hits to kill the ghost" target is applied — a Tank ghost is meant to be
  // this tanky on purpose, not tanky *and* still die on schedule. Set a floor
  // of 1 so a heavily armoured ghost can never demand literally infinite
  // damage to reach zero.
  const dmgToGhost = Math.max(1, pAtk - g.keywords.armour);
  // A player who built defensively — low ATK, high max HP — would otherwise
  // hand every ghost a paper-thin HP pool, since it's sized off their (small)
  // ATK alone: easy to finish quickly, while their own high HP and Armour
  // make them slow to bring down in return. Pacing survives that fine, but
  // the fight stops being one — a floor tied to the encounter's overall
  // scale (a third of the player's own max HP) keeps a tanky build from
  // trivialising the ghost's side of the fight even when its ATK is modest.
  const targetHp = Math.max(6, dmgToGhost * killGhostIn, pMaxHp * HP_FLOOR);

  // The reverse is deliberately *not* compensated for the player's own
  // Armour, Thorns, Poison, Rally, or First Strike — those are the player's
  // own build decisions paying off, not something a ghost should be
  // calibrated to erase. It *is* compensated for the ghost's own Poison,
  // Thorns, Rally, and First Strike, which is not the same thing: those are
  // all extra damage on top of raw ATK that this round's archetype rolled
  // for the player, not anything the player chose or can see coming, so
  // left alone they'd quietly tilt every archetype's "even on paper"
  // EXCHANGE_TARGET range toward the ghost — a Poison tick and a Thorns
  // reflection both land on top of a normal attack, not instead of it, and
  // Rally means the opening ATK understates the fight's average. Solve for
  // the base ATK that, added to those extras over killPlayerIn exchanges,
  // totals pMaxHp — so the target is a promise about total damage dealt,
  // not about one stat in isolation.
  const kw = g.keywords;
  const extraPerExchange = kw.poison + kw.thorns;                 // land every exchange
  const rallyGrowth = kw.rally * killPlayerIn * (killPlayerIn - 1) / 2; // triangular sum
  const strikes = killPlayerIn + (kw.firstStrike ? 1 : 0);         // one bonus hit, free
  const baseAtk = (pMaxHp - extraPerExchange * killPlayerIn - rallyGrowth) / strikes;
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
