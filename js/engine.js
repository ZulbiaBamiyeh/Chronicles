// The rules. No DOM, no audio, no randomness that isn't handed in — everything
// here is a pure function of its arguments, which is what makes the whole game
// testable from node (see test/engine.mjs).
//
// The single most important property: combat is fully deterministic. Same two
// fighters in, same result out, every time. Breakpoint planning ("4 ATK costs
// me 20 HP, 5 ATK costs me 15") is only a real decision if the player can
// compute it exactly, so there are no dice anywhere in resolution. The only
// randomness in Ghostwalk is in what you're dealt — never in what happens
// once the cards are down.

import { card, DEAL_POOL, MONSTERS } from './cards.js';

export const START = { hp: 20, maxHp: 20, atk: 1, gold: 3, hearts: 3 };
export const WINS_TO_COMPLETE = 5;
export const PATH_SLOTS = 4;
export const HAND_SIZE = 6;

// ---------------------------------------------------------------------------
// Seeded RNG
// ---------------------------------------------------------------------------

/** mulberry32 — small, fast, and good enough that a run replays identically. */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

export function shuffle(arr, r) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The combat resolver — used identically for path monsters and the PvP duel
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Fighter
 * @property {string} name
 * @property {number} hp
 * @property {number} atk
 * @property {number} [armour]
 * @property {number} [thorns]
 * @property {number} [poison]
 * @property {number} [rally]
 * @property {boolean} [firstStrike]
 */

const dmg = (atk, armour) => Math.max(1, atk - (armour || 0));

/**
 * Runs a fight to its conclusion.
 *
 * The exchange order is fixed and reads top to bottom:
 *   1. poison ticks on both sides (ignores Armour)
 *   2. check for defeat
 *   3. First Strike resolves (first exchange only; mutual First Strike cancels)
 *   4. check for defeat
 *   5. both sides attack simultaneously — damage = ATK − Armour, minimum 1
 *   6. Thorns reflect onto whoever dealt damage in step 5
 *   7. Rally applies (+X ATK, permanent for this fight)
 *   8. check for defeat
 *
 * Defeat is simultaneous: if both sides reach 0 in the same exchange, both
 * lose and the caller decides what that means (§8.3 tiebreak in a duel).
 *
 * @param {Fighter} A the player's side
 * @param {Fighter} B the opposing side
 * @param {{floorA?: boolean}} [opts] floorA stops A dropping below 1 HP — the
 *   path uses it so a rat can never end a run before the player sees a duel.
 * @returns {{winner:'a'|'b'|'both', exchanges:number, a:object, b:object, log:object[]}}
 */
export function resolveCombat(A, B, opts = {}) {
  const a = snapshot(A);
  const b = snapshot(B);
  const floorA = Boolean(opts.floorA);
  const log = [];
  let exchanges = 0;

  const hurt = (side, amount, source) => {
    if (amount <= 0) return 0;
    const isA = side === a;
    const before = side.hp;
    side.hp -= amount;
    if (isA && floorA && side.hp < 1) side.hp = 1;
    const dealt = before - side.hp;
    if (dealt > 0) log.push({ ex: exchanges, target: isA ? 'a' : 'b', amount: dealt, source });
    return dealt;
  };

  const settled = () => a.hp <= 0 || b.hp <= 0;

  // Both sides deal at least 1 per exchange, so this always terminates; the cap
  // is pure paranoia against a future card that could stall it.
  while (exchanges < 200) {
    exchanges++;

    // 1–2. Poison, ignoring Armour entirely.
    if (a.poison) hurt(b, a.poison, 'poison');
    if (b.poison) hurt(a, b.poison, 'poison');
    if (settled()) break;

    // 3–4. First Strike, once, and only if exactly one side has it.
    if (exchanges === 1 && a.firstStrike !== b.firstStrike) {
      if (a.firstStrike) hurt(b, dmg(a.atk, b.armour), 'firstStrike');
      else hurt(a, dmg(b.atk, a.armour), 'firstStrike');
      if (settled()) break;
    }

    // 5. Simultaneous attacks — both are computed before either lands, so a
    //    fighter who dies this exchange still gets their blow in.
    const toB = dmg(a.atk, b.armour);
    const toA = dmg(b.atk, a.armour);
    const dealtB = hurt(b, toB, 'attack');
    const dealtA = hurt(a, toA, 'attack');

    // 6. Thorns answer the attack from step 5, not poison or First Strike.
    if (b.thorns && dealtB > 0) hurt(a, b.thorns, 'thorns');
    if (a.thorns && dealtA > 0) hurt(b, a.thorns, 'thorns');

    // 7. Rally — permanent for the rest of this fight only.
    if (a.rally) a.atk += a.rally;
    if (b.rally) b.atk += b.rally;

    // 8.
    if (settled()) break;
  }

  const aDown = a.hp <= 0;
  const bDown = b.hp <= 0;
  const winner = aDown && bDown ? 'both' : aDown ? 'b' : bDown ? 'a' : 'a';
  return { winner, exchanges, a, b, log };
}

function snapshot(f) {
  return {
    name: f.name || '',
    hp: f.hp,
    maxHp: f.maxHp ?? f.hp,
    atk: f.atk,
    armour: f.armour || 0,
    thorns: f.thorns || 0,
    poison: f.poison || 0,
    rally: f.rally || 0,
    firstStrike: Boolean(f.firstStrike),
  };
}

/** §8.3 — mutual defeat goes to higher max HP, then higher gold, then the ghost. */
export function tiebreak(player, ghost) {
  if ((player.maxHp || 0) > (ghost.maxHp || 0)) return 'player';
  if ((player.maxHp || 0) < (ghost.maxHp || 0)) return 'ghost';
  if ((player.gold || 0) > (ghost.gold || 0)) return 'player';
  if ((player.gold || 0) < (ghost.gold || 0)) return 'ghost';
  return 'ghost';
}

// ---------------------------------------------------------------------------
// Run state
// ---------------------------------------------------------------------------

export function newRun(seed = (Math.random() * 2 ** 32) >>> 0, name = 'Wanderer') {
  return {
    seed: seed >>> 0,
    name,
    round: 1,
    wins: 0,
    losses: 0,
    hp: START.hp,
    maxHp: START.maxHp,
    atk: START.atk,
    gold: START.gold,
    hearts: START.hearts,
    kw: { armour: 0, thorns: 0, poison: 0, rally: 0, firstStrike: false },
    perks: { healPerKill: 0, gearDiscount: 0, cleanPathArmour: 0, roundStart: {} },
    // Marks that this round's upkeep (the between-rounds heal and every
    // recurring ally) has already been applied, so resuming a save mid-round
    // doesn't hand out a second helping of it.
    upkeepDone: false,
    over: false,
    completed: false,
  };
}

/** The tiers a given round deals from (§9). */
export function tiersForRound(round) {
  if (round <= 2) return [1];
  if (round === 3) return [1, 2];
  if (round === 4) return [2];
  return [2, 3];
}

/**
 * Six cards from the round's tier pool, guaranteed to contain at least two
 * monsters (so gold is always reachable) and at least one gear or place (so
 * gold is always spendable). Without that floor a hand can be unplayable
 * through no fault of the player, which is the one kind of unfair this game
 * can't afford — every other bad outcome here is a decision.
 */
export function deal(round, r) {
  const tiers = tiersForRound(round);
  const pool = DEAL_POOL.filter((c) => tiers.includes(c.tier));
  const monsters = pool.filter((c) => c.type === 'monster');
  const spendable = pool.filter((c) => c.type === 'gear' || c.type === 'place');

  const hand = [];
  const taken = new Set();
  const take = (c) => { hand.push(c.id); taken.add(c.id); };
  const draw = (from) => {
    const options = from.filter((c) => !taken.has(c.id));
    return options.length ? pick(options, r) : null;
  };

  for (let i = 0; i < 2; i++) { const c = draw(monsters); if (c) take(c); }
  { const c = draw(spendable); if (c) take(c); }
  while (hand.length < HAND_SIZE) {
    const c = draw(pool);
    if (!c) break;
    take(c);
  }
  return shuffle(hand, r);
}

/** Start-of-round upkeep: heal 50% of max, then apply every recurring ally. */
export function startRound(run) {
  if (run.upkeepDone) return run;
  const s = { ...run, kw: { ...run.kw }, upkeepDone: true };
  if (s.round > 1) s.hp = Math.min(s.maxHp, s.hp + Math.ceil(s.maxHp / 2));
  const rs = s.perks.roundStart || {};
  if (rs.gold) s.gold += rs.gold;
  if (rs.atk) s.atk += rs.atk;
  if (rs.heal) s.hp = Math.min(s.maxHp, s.hp + rs.heal);
  if (rs.rally) s.kw.rally += rs.rally;
  return s;
}

/** The gold a card actually costs this player (Quartermaster floors at 1). */
export function costFor(run, c) {
  const base = c.cost || 0;
  if (!base || c.type !== 'gear') return base;
  return Math.max(1, base - (run.perks.gearDiscount || 0));
}

function applyFx(s, fx) {
  if (!fx) return;
  // Max HP is a ceiling, not a heal — Toll Bridge and Traveller's Boots both
  // spell out a separate heal, which would be redundant if raising the max
  // filled it. Current HP is untouched.
  if (fx.maxHp) s.maxHp += fx.maxHp;
  if (fx.atk) s.atk = Math.max(0, s.atk + fx.atk);
  if (fx.gold) s.gold += fx.gold;
  if (fx.healFull) s.hp = s.maxHp;
  if (fx.heal) s.hp = Math.min(s.maxHp, s.hp + fx.heal);
  if (fx.armour) s.kw.armour += fx.armour;
  if (fx.thorns) s.kw.thorns += fx.thorns;
  if (fx.poison) s.kw.poison += fx.poison;
  if (fx.rally) s.kw.rally += fx.rally;
  if (fx.firstStrike) s.kw.firstStrike = true;
}

/**
 * Walks the four slots left to right and returns the character who comes out
 * the other side, plus an event per slot for the animation to replay. A
 * `fight` event carries the resolver's own exchange-by-exchange log and both
 * fighters' starting stats — not just the final damage total — so a monster
 * fight can be replayed blow by blow exactly like the duel, not summarised.
 *
 * @param {object} run
 * @param {Array<{id:string, from:'hand', upgrade?:boolean}|null>} slots
 */
export function resolvePath(run, slots) {
  const s = {
    ...run,
    kw: { ...run.kw },
    perks: { ...run.perks, roundStart: { ...run.perks.roundStart } },
  };
  const startHp = s.hp;
  const events = [];
  let monstersDefeated = 0;
  let usedWatchtower = false;

  // Each event carries the stats as they stood the moment that slot finished,
  // so the resolution animation can tick the HUD along with the flips instead
  // of jumping to the final numbers at the end.
  const snap = () => ({ hp: s.hp, maxHp: s.maxHp, atk: s.atk, gold: s.gold, kw: { ...s.kw } });
  const push = (e) => events.push({ ...e, snap: snap() });

  slots.forEach((slot, i) => {
    if (!slot) { push({ slot: i, kind: 'empty' }); return; }
    const c = card(slot.id);
    if (!c) { push({ slot: i, kind: 'empty' }); return; }

    const ctx = {
      slot: i,
      slots,
      gold: s.gold,
      monstersDefeated,
      usedWatchtower,
      paidUpgrade: Boolean(slot.upgrade),
    };

    // Fizzle: the cost can't be paid when the slot resolves, so the slot does
    // nothing at all.
    const cost = costFor(s, c);
    if (cost > s.gold) {
      push({ slot: i, kind: 'fizzle', id: c.id, cost });
      return;
    }
    if (cost) s.gold -= cost;

    if (c.type === 'monster') {
      const me = playerFighter(s);
      const monster = monsterFighter(c);
      const fight = resolveCombat(me, monster, { floorA: true });
      const before = s.hp;
      s.hp = fight.a.hp;
      s.gold += c.gold;
      if (c.trophy) applyFx(s, c.trophy);
      monstersDefeated++;
      if (s.perks.healPerKill) s.hp = Math.min(s.maxHp, s.hp + s.perks.healPerKill);

      push({
        slot: i, kind: 'fight', id: c.id, damage: before - s.hp,
        exchanges: fight.exchanges, gold: c.gold, trophy: c.trophy || null,
        me, monster, log: fight.log,
      });
      return;
    }

    // Everything else is a stat card: gear, ally, or place.
    const fx = c.dyn ? c.dyn(ctx) : c.fx;
    applyFx(s, fx);
    let upgraded = false;
    if (c.option && slot.upgrade && s.gold >= c.option.cost) {
      s.gold -= c.option.cost;
      applyFx(s, c.option.fx);
      upgraded = true;
    }
    if (c.perk) {
      const p = s.perks;
      if (c.perk.healPerKill) p.healPerKill += c.perk.healPerKill;
      if (c.perk.gearDiscount) p.gearDiscount += c.perk.gearDiscount;
      if (c.perk.cleanPathArmour) p.cleanPathArmour += c.perk.cleanPathArmour;
      for (const [k, v] of Object.entries(c.perk.roundStart || {})) {
        p.roundStart[k] = (p.roundStart[k] || 0) + v;
      }
    }
    if (c.scout) usedWatchtower = true;
    push({ slot: i, kind: 'card', id: c.id, fx, upgraded, cost, scout: Boolean(c.scout) });
  });

  return {
    state: s,
    events,
    usedWatchtower,
    pathDamage: Math.max(0, startHp - s.hp),
    cleanPath: s.hp >= startHp,
  };
}

/** The player as a Fighter. `bonusArmour` carries Shieldbearer into the duel. */
export function playerFighter(s, bonusArmour = 0) {
  return {
    name: s.name || 'You',
    hp: s.hp,
    maxHp: s.maxHp,
    atk: s.atk,
    armour: s.kw.armour + bonusArmour,
    thorns: s.kw.thorns,
    poison: s.kw.poison,
    rally: s.kw.rally,
    firstStrike: s.kw.firstStrike,
  };
}

export function monsterFighter(c) {
  return { name: c.name, hp: c.hp, maxHp: c.hp, atk: c.atk, ...(c.kw || {}) };
}

export function ghostFighter(g) {
  return {
    name: g.name,
    hp: g.hp,
    maxHp: g.maxHp,
    atk: g.atk,
    armour: g.keywords.armour,
    thorns: g.keywords.thorns,
    poison: g.keywords.poison,
    rally: g.keywords.rally,
    firstStrike: g.keywords.firstStrike,
  };
}

/**
 * The duel. Damage taken on the path carries in, so a greedy path is a real
 * cost. Only this fight can take a heart.
 */
export function duel(s, ghost, cleanPath) {
  const bonus = cleanPath ? (s.perks.cleanPathArmour || 0) : 0;
  const me = playerFighter(s, bonus);
  const them = ghostFighter(ghost);
  const fight = resolveCombat(me, them);
  let won;
  if (fight.winner === 'both') won = tiebreak({ maxHp: s.maxHp, gold: s.gold }, ghost) === 'player';
  else won = fight.winner === 'a';
  return { ...fight, won, bonusArmour: bonus, me, them };
}

/** Applies the duel result: bank a win, or lose a heart. */
export function settleRound(run, won) {
  const s = { ...run, kw: { ...run.kw }, upkeepDone: false };
  if (won) s.wins++;
  else { s.losses++; s.hearts--; }
  if (s.wins >= WINS_TO_COMPLETE) { s.completed = true; s.over = true; }
  else if (s.hearts <= 0) { s.over = true; }
  else s.round++;
  return s;
}

/** Serialised character uploaded as a ghost at the end of every round. */
export function toGhost(run, path) {
  return {
    name: run.name,
    round: run.round,
    wins: run.wins,
    hp: run.hp,
    maxHp: run.maxHp,
    atk: run.atk,
    gold: run.gold,
    keywords: { ...run.kw },
    path,
  };
}

export const MONSTER_BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));
