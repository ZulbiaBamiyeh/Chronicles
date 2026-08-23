// The rival: one opponent, for the whole run.
//
// This is the change that makes the game interactive rather than a series of
// unrelated fights. Instead of drawing a fresh random ghost every round —
// where nothing you learned in round 2 helped you in round 3 — a run is
// matched with a single rival at the start, and you face *the same character*
// every day, as they were on that day of their own run.
//
// That's not a flourish; it's what async PvP actually looks like from the
// inside. A real player finishes a run and uploads it: five snapshots, one per
// day, plus whatever secrets they laid along the way. Somebody else is then
// matched against that run and fights it day by day. `drawRival` generates
// exactly that shape locally, so the day the network exists this file changes
// from "generate five days" to "fetch five days" and nothing above it moves.
//
// The snapshot promise from js/ghosts.js carries over unchanged and matters
// more here, not less: a rival's five days are a pure function of the rival's
// own seed. They are decided before the run's first card is dealt and they do
// not — cannot — react to how the player is doing.

import { rng, pick, tiersForRound, RUN_DAYS } from './engine.js';
import { drawGhost, ARCHETYPES } from './ghosts.js';
import { SECRETS, card } from './cards.js';

export { RUN_DAYS };

/**
 * How many secrets the rival has laid by a given day. They start clean and
 * get more devious as their run goes on, which gives the player a couple of
 * rounds to learn the rival's shape before having to worry about ambushes.
 */
// Day one is a clean read so the player learns the rival's shape before
// having to worry about ambushes; two only on the last day, where it should
// feel like they've brought everything.
const secretsOnDay = (day) => (day <= 1 ? 0 : day >= RUN_DAYS ? 2 : 1);

/**
 * Generate a rival's whole run: one build per day, each with the secrets they
 * laid that day.
 *
 * @param {number} seed
 * @returns {{name: string, seed: number, days: object[]}}
 */
export function drawRival(seed) {
  const r = rng(seed >>> 0);

  // One archetype and one name for the whole run — it's one person, not five
  // unrelated ghosts. This is the thing that makes a rival learnable: if their
  // build flipped from Aggro to Tank overnight, nothing you worked out on day
  // two would be worth anything on day three, and the counter-play the whole
  // feature exists for would have nothing to bite on.
  const archetype = pick(Object.keys(ARCHETYPES), r);
  const name = drawGhost(1, 0, mix(seed, 1)).name;

  // The rival had a run of their own, against their own opponents, and it
  // went however it went. `wins` is what feeds drawGhost's difficulty dial, so
  // this is what stops every rival being a 4–0 monster by day five: some had a
  // great week and are genuinely frightening, some were scraping through.
  //
  // Note what this is *not*: it is not a reaction to how the player is doing.
  // It's drawn from the rival's own seed before the run starts, so it varies
  // between rivals and never within one — the snapshot promise is intact, and
  // "is this a hard rival" becomes something you find out by fighting them.
  let theirWins = 0;
  const days = [];

  for (let day = 1; day <= RUN_DAYS; day++) {
    const build = drawGhost(day, theirWins, mix(seed, day), { archetype });
    days.push({
      ...build,
      name,
      day,
      theirWins,
      secrets: pickSecrets(day, secretsOnDay(day), r),
    });
    if (r() < 0.5) theirWins++;
  }

  return { name, seed: seed >>> 0, archetype, days };
}

/** The rival as they stood on a given day. Days run 1..RUN_DAYS. */
export function rivalOnDay(rival, day) {
  return rival.days[Math.min(RUN_DAYS, Math.max(1, day)) - 1];
}

/**
 * The secrets a rival laid on a given day, drawn from what that day's tiers
 * could actually offer. Weighted toward counters that answer what the *player*
 * generally has rather than at random — a rival who only ever laid Antidote
 * Draught against a player with no Poison would be no threat at all.
 */
function pickSecrets(day, count, r) {
  if (count <= 0) return [];
  const tiers = tiersForRound(day);
  const pool = SECRETS.filter((s) => tiers.includes(s.tier));
  if (!pool.length) return [];

  const out = [];
  const taken = new Set();
  for (let i = 0; i < count; i++) {
    const options = pool.filter((s) => !taken.has(s.id));
    if (!options.length) break;
    const chosen = pick(options, r);
    taken.add(chosen.id);
    out.push(chosen.id);
  }
  return out;
}

/** Deterministic per-day seed, so day N is always the same character. */
function mix(seed, day) {
  let h = (seed ^ (day * 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * What the player is allowed to know about the rival before planning.
 *
 * Their statline is open — that's the whole point of a fixed rival, and a
 * build you can't see is one you can't counter. Their *secrets* are not: the
 * asymmetry is the tension, and it's the reason Watchtower exists. Without
 * hidden secrets a duel is fully solved at planning time and there's nothing
 * left to find out.
 *
 * @param {object} rival
 * @param {number} day
 * @param {boolean} scouted  the player played a Watchtower this round
 */
export function intel(rival, day, scouted) {
  const d = rivalOnDay(rival, day);
  return {
    name: d.name,
    day,
    archetype: d.archetype,
    hp: d.hp,
    maxHp: d.maxHp,
    atk: d.atk,
    keywords: { ...d.keywords },
    inventory: [...(d.inventory || [])],
    // Revealed only by scouting. `secretCount` is always known — you can see
    // that they've laid *something*, which is what makes scouting a real
    // choice rather than a shot in the dark.
    secretCount: d.secrets.length,
    secrets: scouted ? [...d.secrets] : null,
  };
}

/** Pretty names for a set of secret ids. */
export const secretNames = (ids = []) => ids.map((id) => card(id)?.name).filter(Boolean);
