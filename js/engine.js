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

// Matches Chronicle: RuneScape Legends' own starting line (2 ATK, 0 gold, no
// weapon) rather than easing the player in with a free head start. Zero gold
// is the point, not an oversight: it's what forces the first slot of day one
// to be a monster or a free Place rather than a shopping trip, and it's why
// the deckbuilder's floor (§ js/deck.js MIN_MONSTERS) isn't decoration — a
// deck that couldn't reach gold on day one would be unplayable from turn one,
// not just weak.
export const START = { hp: 20, maxHp: 20, atk: 2, gold: 0, hearts: 3 };
/** A run is five days against one rival — see js/rival.js. */
export const RUN_DAYS = 5;
export const WINS_TO_COMPLETE = RUN_DAYS;
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

export function newRun(seed = (Math.random() * 2 ** 32) >>> 0, name = 'Wanderer', deck = null) {
  return {
    seed: seed >>> 0,
    // The thirty cards this run draws its hands from. Saved with the run so
    // resuming keeps the deck you started with, and so editing your deck
    // between runs never rewrites one already in progress.
    deck: deck ? [...deck] : null,
    // Who you're up against for the whole run. Fixed here, before a single
    // card is dealt, so the rival can never be a reaction to how you're
    // doing — see js/rival.js. Saved with the run, so resuming faces the same
    // person.
    rivalSeed: (Math.imul(seed >>> 0, 0x9e3779b1) ^ 0x5bf03635) >>> 0,
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
    // Every gear and ally card actually bought, in the order they were bought.
    // The rules never read this — stats are what the rules care about — but the
    // equipment panel and the attack animations do, so the fight can show the
    // weapon you're really holding rather than a generic sword.
    gear: [],
    // The cards currently held, unplayed — persisted across days, refilled by
    // refillHand() rather than re-dealt from scratch every round. `seenCards`
    // is the full draw history (everything ever dealt, played or not), so
    // nothing is ever handed to the same run twice.
    hand: [],
    seenCards: [],
    mulligansLeft: MULLIGAN_LIMIT,
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

export const MIN_HAND_MONSTERS = 2;
export const MIN_HAND_SPENDABLE = 1;
/** After the opening hand, later days draw this many fresh cards — Chronicle's
 *  own shape: a full 6-card opener, then 3 new cards refilling whatever's
 *  left in hand every chapter after. */
export const HAND_REFILL = 3;
/** How many cards of the opening hand a player may swap for a fresh draw. */
export const MULLIGAN_LIMIT = 3;

/**
 * Draws `count` new cards from the tiers a day allows, topping up whatever the
 * hand is short of — at least two monsters (so gold is always reachable) and
 * at least one gear or place (so gold is always spendable). `already` is what
 * the hand already has of each, so refilling on top of a hand that's still
 * holding two monsters doesn't force a third: the floor is a property of the
 * whole hand across the run, not a rule about any one draw.
 *
 * A hand can come back short of `count` if the tier's pool has run dry — a
 * 10-card tier deck drawn from on three separate days can empty out — and
 * that's fine: a short hand is still legal to plan from, just with fewer
 * choices, and never an unplayable one, since the floor is still honoured
 * with whatever's left.
 */
function drawCards(tiers, deck, exclude, r, count, already) {
  const source = deck && deck.length ? deck.map((id) => card(id)).filter(Boolean) : DEAL_POOL;
  const pool = source.filter((c) => tiers.includes(c.tier) && !exclude.has(c.id));
  const monsters = pool.filter((c) => c.type === 'monster');
  const spendable = pool.filter((c) => c.type === 'gear' || c.type === 'place');

  const drawn = [];
  const taken = new Set();
  const take = (c) => { drawn.push(c.id); taken.add(c.id); };
  const draw = (from) => {
    const options = from.filter((c) => !taken.has(c.id));
    return options.length ? pick(options, r) : null;
  };

  const needMonsters = Math.max(0, MIN_HAND_MONSTERS - already.monsters);
  const needSpendable = Math.max(0, MIN_HAND_SPENDABLE - already.spendable);
  for (let i = 0; i < needMonsters && drawn.length < count; i++) {
    const c = draw(monsters); if (c) take(c);
  }
  for (let i = 0; i < needSpendable && drawn.length < count; i++) {
    const c = draw(spendable); if (c) take(c);
  }
  while (drawn.length < count) {
    const c = draw(pool);
    if (!c) break;
    take(c);
  }
  return shuffle(drawn, r);
}

const handCounts = (hand) => ({
  monsters: hand.filter((id) => card(id)?.type === 'monster').length,
  spendable: hand.filter((id) => ['gear', 'place'].includes(card(id)?.type)).length,
});

/**
 * A standalone opening hand: six cards from the round's tier pool, with the
 * floor guaranteed from nothing. This is what a day-1 hand is, and it's also
 * the tool used throughout tools/ and test/ wherever a single, stateless hand
 * is all that's needed rather than a whole run's worth of persisted state.
 */
export function deal(round, r, deck = null) {
  return drawCards(tiersForRound(round), deck, new Set(), r, HAND_SIZE, { monsters: 0, spendable: 0 });
}

/**
 * Refills a run's persisted hand for the day about to be played: the opening
 * 6 on day one, or 3 fresh cards added to whatever's left in hand on every
 * day after. Cards are never dealt twice in the same run — `run.seenCards` is
 * the full history of everything ever drawn, so a card that's sitting unused
 * in hand, or one that's already been played and discarded, is equally off
 * the table for a future refill.
 *
 * @param {object} run
 * @param {function} r
 */
export function refillHand(run, r) {
  const tiers = tiersForRound(run.round);
  const hand = [...(run.hand || [])];
  const seen = new Set(run.seenCards || []);
  const want = run.round <= 1 ? Math.max(0, HAND_SIZE - hand.length) : HAND_REFILL;
  const drawn = drawCards(tiers, run.deck, seen, r, want, handCounts(hand));
  return {
    hand: shuffle([...hand, ...drawn], r),
    seenCards: [...seen, ...drawn],
    drawn,
  };
}

/**
 * Swaps one card out of the opening hand for a fresh draw from the same
 * eligible pool — Chronicle's own mulligan, capped at `MULLIGAN_LIMIT` swaps
 * so it thins a bad opener without turning into "reroll until perfect."
 */
export function mulligan(run, cardId, r) {
  if (run.round > 1 || (run.mulligansLeft ?? MULLIGAN_LIMIT) <= 0) return run;
  const at = (run.hand || []).indexOf(cardId);
  if (at < 0) return run;
  const seen = new Set(run.seenCards || []);
  const [fresh] = drawCards(tiersForRound(run.round), run.deck, seen, r, 1, { monsters: 99, spendable: 99 });
  if (!fresh) return run;
  const hand = [...run.hand];
  hand[at] = fresh;
  return {
    ...run,
    hand,
    seenCards: [...seen, fresh],
    mulligansLeft: (run.mulligansLeft ?? MULLIGAN_LIMIT) - 1,
  };
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
 * Fights one monster and applies the result to `s` in place: gold, trophy,
 * a drop if it has one, healPerKill. Shared by resolvePath's own monster
 * slots and resolveAmbush below, so a rival's invasion monster pays off
 * exactly the same way a monster from the player's own hand would — there's
 * no second, quietly-diverging copy of "what happens when you beat something."
 *
 * @returns {object} everything a `fight` event needs to animate and summarise
 */
function fightMonster(s, c) {
  const me = playerFighter(s);
  const monster = monsterFighter(c);
  const fight = resolveCombat(me, monster, { floorA: true });
  const before = s.hp;
  s.hp = fight.a.hp;
  s.gold += c.gold;
  if (c.trophy) applyFx(s, c.trophy);
  const dropped = c.drop ? card(c.drop) : null;
  if (dropped) {
    applyFx(s, dropped.fx);
    s.gear.push(dropped.id);
  }
  if (s.perks.healPerKill) s.hp = Math.min(s.maxHp, s.hp + s.perks.healPerKill);
  return {
    damage: before - s.hp, exchanges: fight.exchanges, gold: c.gold,
    trophy: c.trophy || null, drop: dropped ? dropped.id : null,
    me, monster, log: fight.log,
  };
}

/**
 * A rival's invasion: one monster, forced onto the player's path after the
 * four planned slots resolve and before the duel. Not a card either side
 * played — a consequence of who you're matched against, the same way a real
 * opponent's build affects you whether or not you have an answer for it.
 * Uses the player's stats *as they stood after the path*, so an invasion
 * genuinely costs something if the path already left them hurt.
 *
 * @param {object} run  the post-path state (resolvePath's `out.state`)
 * @param {string} monsterId
 */
export function resolveAmbush(run, monsterId) {
  const c = card(monsterId);
  const s = { ...run, kw: { ...run.kw }, gear: [...(run.gear || [])] };
  const startHp = s.hp;
  const result = fightMonster(s, c);
  return {
    state: s,
    event: { kind: 'fight', id: c.id, ...result },
    damage: Math.max(0, startHp - s.hp),
  };
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
    gear: [...(run.gear || [])],
    hand: [...(run.hand || [])],
    perks: { ...run.perks, roundStart: { ...run.perks.roundStart } },
  };
  const startHp = s.hp;
  const events = [];
  const secrets = [];
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
    // Every card that occupies a slot leaves the hand, win, lose, or fizzle —
    // a card you tried to play and couldn't afford is still spent, the same
    // as it would be at a real table.
    const at = s.hand.indexOf(slot.id);
    if (at >= 0) s.hand.splice(at, 1);

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
      const result = fightMonster(s, c);
      monstersDefeated++;
      push({ slot: i, kind: 'fight', id: c.id, ...result });
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
    if (c.type === 'gear' || c.type === 'ally') s.gear.push(c.id);
    // A secret does nothing to you — it's spent here and fires in the duel.
    if (c.type === 'secret') {
      secrets.push(c.id);
      push({ slot: i, kind: 'secret', id: c.id, cost });
      return;
    }
    push({ slot: i, kind: 'card', id: c.id, fx, upgraded, cost, scout: Boolean(c.scout) });
  });

  return {
    state: s,
    events,
    secrets,
    usedWatchtower,
    pathDamage: Math.max(0, startHp - s.hp),
    cleanPath: s.hp >= startHp,
  };
}

// `gear` and `anim` ride along on a Fighter for presentation only — the
// resolver's snapshot() drops everything it doesn't recognise, so nothing here
// can reach the rules even by accident.

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
    gear: [...(s.gear || [])],
  };
}

export function monsterFighter(c) {
  return { name: c.name, hp: c.hp, maxHp: c.hp, atk: c.atk, ...(c.kw || {}), anim: c.anim };
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
    gear: [...(g.inventory || [])],
  };
}

/**
 * Applies a set of secrets to the fighter they were laid against. Pure, and
 * scoped to this one fight: the stored snapshot is never touched, so a secret
 * you lay against a rival affects *your* copy of them, exactly as a real
 * opponent's secret would affect their copy of you.
 *
 * Every strip has a floor. A fighter can always swing for at least 1 and can
 * never be reduced below 1 max HP, so no stack of secrets can produce an
 * unloseable duel or a fight that can't resolve.
 */
export function applySecrets(fighter, secretIds = []) {
  const f = { ...fighter };
  const landed = [];
  for (const id of secretIds) {
    const c = card(id);
    if (!c || !c.counter) continue;
    const k = c.counter;
    if (k.atk) f.atk = Math.max(1, f.atk - k.atk);
    if (k.armour) f.armour = Math.max(0, (f.armour || 0) - k.armour);
    if (k.thorns) f.thorns = Math.max(0, (f.thorns || 0) - k.thorns);
    if (k.poison) f.poison = Math.max(0, (f.poison || 0) - k.poison);
    if (k.rally) f.rally = Math.max(0, (f.rally || 0) - k.rally);
    if (k.firstStrike) f.firstStrike = false;
    if (k.maxHp) {
      f.maxHp = Math.max(1, (f.maxHp || f.hp) - k.maxHp);
      f.hp = Math.min(f.hp, f.maxHp);
    }
    landed.push(id);
  }
  return { fighter: f, landed };
}

/**
 * The duel. Damage taken on the path carries in, so a greedy path is a real
 * cost. Only this fight can take a heart.
 *
 * Secrets fire before the first exchange — yours onto them, theirs onto you —
 * which is why they're worth a path slot despite doing nothing for your own
 * statline.
 *
 * @param {object} s          the player's post-path state
 * @param {object} ghost      the opponent snapshot
 * @param {boolean} cleanPath
 * @param {{mine?: string[], theirs?: string[]}} [secrets]
 */
export function duel(s, ghost, cleanPath, secrets = {}) {
  const bonus = cleanPath ? (s.perks.cleanPathArmour || 0) : 0;
  const baseMe = playerFighter(s, bonus);
  const baseThem = ghostFighter(ghost);

  const onThem = applySecrets(baseThem, secrets.mine || []);
  const onMe = applySecrets(baseMe, secrets.theirs || []);
  const me = onMe.fighter;
  const them = onThem.fighter;

  const fight = resolveCombat(me, them);
  let won;
  if (fight.winner === 'both') {
    won = tiebreak({ maxHp: s.maxHp, gold: s.gold }, ghost) === 'player';
  } else won = fight.winner === 'a';

  return {
    ...fight,
    won,
    bonusArmour: bonus,
    me,
    them,
    // Both the before and after, so the duel screen can show a secret landing
    // rather than just presenting an already-weakened opponent.
    baseMe,
    baseThem,
    mySecrets: onThem.landed,
    theirSecrets: onMe.landed,
  };
}

/** Gold for winning a day of the series. */
export const duelReward = (day) => 4 + 2 * Math.min(RUN_DAYS, Math.max(1, day));

/**
 * Applies the duel result: bank a win, or lose a heart.
 *
 * A run is a five-day series against one rival. Three losses ends it there and
 * then — they beat you, and there's no point playing out days you can't win
 * back. Otherwise the run goes the distance and finishing day five *is*
 * completing it: surviving all five days means at most two losses against at
 * least three wins, so reaching the end with a heart left is already having
 * won the series. That keeps the last day genuinely decisive without making
 * the first four free — every day can still take a heart.
 */
export function settleRound(run, won) {
  const s = { ...run, kw: { ...run.kw }, upkeepDone: false };
  if (won) {
    s.wins++;
    // Taking a day off your rival pays, and pays more the deeper into the
    // series you are. Without this the duel is pure downside — a heart to
    // lose and nothing to gain — while the rival's secrets are a standing tax
    // on you from day two. Winning has to buy something back, and gold is the
    // right currency: it's spent on the next day's path, so a day you won
    // makes the next one easier to plan rather than simply not hurting.
    s.gold += duelReward(s.round);
  } else { s.losses++; s.hearts--; }
  if (s.hearts <= 0) { s.over = true; s.completed = false; }
  else if (s.round >= RUN_DAYS) { s.over = true; s.completed = true; }
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
    inventory: [...(run.gear || [])],
    path,
  };
}

export const MONSTER_BY_ID = new Map(MONSTERS.map((m) => [m.id, m]));
