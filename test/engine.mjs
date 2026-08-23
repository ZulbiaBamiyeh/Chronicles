// Rules tests. Everything the design document promises about resolution is
// asserted here, because "deterministic" is not a property you can eyeball —
// it's the one thing a player is entitled to rely on when they plan a path.
//
//   node test/engine.mjs

import assert from 'node:assert/strict';
import {
  resolveCombat, tiebreak, newRun, startRound, deal, resolvePath, duel,
  settleRound, tiersForRound, costFor, rng, monsterFighter, playerFighter, applySecrets,
  PATH_SLOTS, HAND_SIZE, HAND_REFILL, MIN_HAND_MONSTERS, START,
  refillHand, mulligan, MULLIGAN_LIMIT, resolveAmbush,
} from '../js/engine.js';
import * as deckLib from '../js/deck.js';
import {
  card, ALL_CARDS, DEAL_POOL, MONSTERS, GEAR, ALLIES, PLACES, SECRETS,
  equipment, attackAnim,
} from '../js/cards.js';
import { drawGhost, ARCHETYPES } from '../js/ghosts.js';
import { drawRival, rivalOnDay, intel, RUN_DAYS } from '../js/rival.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`\n✗ ${name}\n  ${err.message}\n`);
    process.exitCode = 1;
  }
};

const fighter = (o) => ({ name: 'x', hp: 10, atk: 1, ...o });

// ---------------------------------------------------------------------------
// The card pool
// ---------------------------------------------------------------------------

test('the pool is 106 cards, all of them dealable', () => {
  assert.equal(DEAL_POOL.length, 106);
  assert.equal(ALL_CARDS.length, 106);
  assert.equal(MONSTERS.length, 28);
  assert.equal(GEAR.length, 41);
  assert.equal(ALLIES.length, 13);
  assert.equal(PLACES.length, 14);
  assert.equal(SECRETS.length, 10);
});

test('every card has a unique id and a contiguous number', () => {
  const ids = new Set(ALL_CARDS.map((c) => c.id));
  assert.equal(ids.size, 106);
  const nos = ALL_CARDS.map((c) => c.no).sort((a, b) => a - b);
  nos.forEach((n, i) => assert.equal(n, i + 1));
});

test('every keyword worth countering has a secret that counters it', () => {
  // A secret is only worth a path slot if it answers something a rival can
  // actually bring, so every keyword the rival generator can roll needs an
  // answer somewhere in the pool.
  for (const key of ['atk', 'armour', 'thorns', 'poison', 'rally', 'firstStrike']) {
    assert.ok(SECRETS.some((s) => s.counter[key]), `nothing counters ${key}`);
  }
});

test('secrets stay available at every tier, so countering never runs dry', () => {
  for (const tier of [1, 2, 3]) {
    assert.ok(SECRETS.some((s) => s.tier === tier), `no tier ${tier} secret`);
  }
});

test('a keyword you can start building stays buildable to the end of a run', () => {
  // The gap this guards against was real: Poison and Thorns existed only as
  // Tier 1 gear, so a player committing to either had nothing left to buy
  // from round 4 on and the archetype quietly stranded halfway up. A keyword
  // is allowed to *start* at any tier, but once it's on offer it has to stay
  // on offer at every tier above — otherwise committing to it is a trap the
  // player can't see coming.
  for (const key of ['armour', 'poison', 'thorns', 'rally', 'firstStrike']) {
    const tiers = [1, 2, 3].filter((t) =>
      ALL_CARDS.some((c) => c.tier === t && c.fx?.[key]));
    assert.ok(tiers.length, `nothing grants ${key} at all`);
    const from = Math.min(...tiers);
    for (let t = from; t <= 3; t++) {
      assert.ok(tiers.includes(t), `${key} is buyable at tier ${from} but not tier ${t}`);
    }
  }
});

test('every Tier 2 and Tier 3 monster pays off — a trophy or a real item', () => {
  // The risk/reward shape of the path: the things that can hurt you are how
  // you pick up permanent upgrades, not just a bigger pile of coins. A drop
  // pays off the same promise a trophy does — you walk away with something
  // you didn't have — just as the item itself instead of a stat bump.
  for (const m of MONSTERS.filter((m) => m.tier >= 2)) {
    assert.ok(m.trophy || m.drop, `${m.id} is a tier ${m.tier} monster with no payoff`);
  }
  const t1WithPayoff = MONSTERS.filter((m) => m.tier === 1 && (m.trophy || m.drop)).length;
  assert.ok(t1WithPayoff <= 4, 'tier 1 should stay mostly a gold vending machine');
});

test('every monster drop names a real, worn slot of gear', () => {
  for (const m of MONSTERS) {
    if (!m.drop) continue;
    const dropped = card(m.drop);
    assert.ok(dropped, `${m.id} drops an unknown card`);
    assert.equal(dropped.type, 'gear', `${m.id} should drop equipment, not a ${dropped?.type}`);
    assert.ok(dropped.slot, `${m.drop} has no equipment slot`);
  }
});

test('average gold per monster still climbs with tier', () => {
  // Individual monsters vary now — a drop-carrier can pay less gold because
  // the item is the reward — so the promise is about the tier on average, not
  // every single fight being strictly better than every fight below it.
  const mean = (tier) => {
    const g = MONSTERS.filter((m) => m.tier === tier).map((m) => m.gold);
    return g.reduce((a, b) => a + b, 0) / g.length;
  };
  assert.ok(mean(2) > mean(1), 'T2 should out-pay T1 on average');
  assert.ok(mean(3) > mean(2), 'T3 should out-pay T2 on average');
});

// ---------------------------------------------------------------------------
// The combat resolver
// ---------------------------------------------------------------------------

test('combat is deterministic — same inputs, same result, every time', () => {
  const a = fighter({ hp: 24, atk: 6, poison: 2, thorns: 1 });
  const b = fighter({ hp: 30, atk: 5, armour: 2, rally: 1 });
  const first = JSON.stringify(resolveCombat(a, b));
  for (let i = 0; i < 50; i++) {
    assert.equal(JSON.stringify(resolveCombat(a, b)), first);
  }
});

test('damage is ATK minus Armour, floored at 1', () => {
  const r = resolveCombat(fighter({ hp: 100, atk: 3 }), fighter({ hp: 100, atk: 1, armour: 99 }));
  const toB = r.log.filter((e) => e.target === 'b' && e.source === 'attack');
  assert.ok(toB.length > 0);
  for (const e of toB) assert.equal(e.amount, 1, 'armour should never block the last point');
});

test('the §11 Cave Troll breakpoint table holds exactly', () => {
  const troll = monsterFighter(card('cave_troll'));         // 14 / 5
  for (const [atk, exchanges, damage] of [[3, 5, 25], [4, 4, 20], [5, 3, 15], [7, 2, 10], [14, 1, 5]]) {
    const r = resolveCombat(fighter({ hp: 999, atk }), troll);
    assert.equal(r.exchanges, exchanges, `${atk} ATK should take ${exchanges} exchanges`);
    assert.equal(999 - r.a.hp, damage, `${atk} ATK should cost ${damage} HP`);
  }
});

test('going from 5 ATK to 6 against the troll saves nothing — the non-linearity is real', () => {
  const troll = () => monsterFighter(card('cave_troll'));
  const at5 = resolveCombat(fighter({ hp: 999, atk: 5 }), troll());
  const at6 = resolveCombat(fighter({ hp: 999, atk: 6 }), troll());
  assert.equal(at5.a.hp, at6.a.hp);
});

test('mutual First Strike cancels', () => {
  const withBoth = resolveCombat(
    fighter({ hp: 20, atk: 4, firstStrike: true }),
    fighter({ hp: 20, atk: 4, firstStrike: true }),
  );
  const withNeither = resolveCombat(fighter({ hp: 20, atk: 4 }), fighter({ hp: 20, atk: 4 }));
  assert.equal(withBoth.a.hp, withNeither.a.hp);
  assert.equal(withBoth.b.hp, withNeither.b.hp);
  assert.equal(withBoth.log.filter((e) => e.source === 'firstStrike').length, 0);
});

test('First Strike lands once, before the first exchange, and only for one side', () => {
  const r = resolveCombat(fighter({ hp: 20, atk: 5, firstStrike: true }), fighter({ hp: 20, atk: 3 }));
  const fs = r.log.filter((e) => e.source === 'firstStrike');
  assert.equal(fs.length, 1);
  assert.equal(fs[0].target, 'b');
  assert.equal(fs[0].ex, 1);
  assert.equal(r.log[0], fs[0], 'nothing should resolve before First Strike here');
});

test('Poison ticks at the start of every exchange and ignores Armour', () => {
  const r = resolveCombat(
    fighter({ hp: 40, atk: 1, poison: 3 }),
    fighter({ hp: 40, atk: 1, armour: 10 }),
  );
  const ticks = r.log.filter((e) => e.source === 'poison' && e.target === 'b');
  assert.equal(ticks.length, r.exchanges);
  for (const t of ticks) assert.equal(t.amount, 3);
});

test('Thorns answer attacks but not poison', () => {
  const r = resolveCombat(
    fighter({ hp: 40, atk: 1, poison: 5 }),
    fighter({ hp: 40, atk: 1, thorns: 4 }),
  );
  const attacks = r.log.filter((e) => e.target === 'b' && e.source === 'attack');
  const reflected = r.log.filter((e) => e.source === 'thorns');
  // Exactly one reflection per attack A actually landed — never one per poison
  // tick, and none in the final exchange, which poison ended before step 5.
  assert.equal(reflected.length, attacks.length);
  assert.ok(reflected.length < r.exchanges, 'poison finished this one before the last attack');
  for (const e of reflected) {
    assert.equal(e.amount, 4);
    assert.equal(e.target, 'a');
  }
});

test('Rally compounds for the rest of the fight', () => {
  const r = resolveCombat(fighter({ hp: 999, atk: 2, rally: 3 }), fighter({ hp: 100, atk: 1 }));
  const hits = r.log.filter((e) => e.target === 'b' && e.source === 'attack').map((e) => e.amount);
  // 2, then 5, then 8 … each exchange adds the Rally value permanently.
  assert.deepEqual(hits.slice(0, 3), [2, 5, 8]);
});

test('defeat can be simultaneous', () => {
  const r = resolveCombat(fighter({ hp: 3, atk: 3 }), fighter({ hp: 3, atk: 3 }));
  assert.equal(r.winner, 'both');
});

test('the duel tiebreak runs max HP, then gold, then the ghost', () => {
  assert.equal(tiebreak({ maxHp: 30, gold: 0 }, { maxHp: 20, gold: 99 }), 'player');
  assert.equal(tiebreak({ maxHp: 20, gold: 9 }, { maxHp: 20, gold: 3 }), 'player');
  assert.equal(tiebreak({ maxHp: 20, gold: 3 }, { maxHp: 20, gold: 3 }), 'ghost');
  assert.equal(tiebreak({ maxHp: 19, gold: 99 }, { maxHp: 20, gold: 0 }), 'ghost');
});

test('on the path, a 1 ATK player still eventually kills every monster', () => {
  // The floor is what guarantees this: the player can't die, and deals at least
  // 1 a turn, so even the Elder Wyrm (32 HP, Rally 2 — which would grind a
  // 999 HP unfloored player down first) always goes over in the end.
  for (const m of MONSTERS) {
    const r = resolveCombat(fighter({ hp: 20, atk: 1 }), monsterFighter(m), { floorA: true });
    assert.ok(r.exchanges < 200, `${m.id} did not resolve`);
    assert.ok(r.b.hp <= 0, `${m.id} survived`);
    assert.ok(r.a.hp >= 1, `${m.id} dropped the player below the floor`);
  }
});

// ---------------------------------------------------------------------------
// The path
// ---------------------------------------------------------------------------

test('you cannot die on the path', () => {
  const run = { ...newRun(1), hp: 2, maxHp: 40, atk: 1 };
  const slots = [
    { id: 'hill_giant', from: 'hand' }, { id: 'chimera', from: 'hand' },
    { id: 'elder_wyrm', from: 'hand' }, { id: 'stone_warden', from: 'hand' },
  ];
  const out = resolvePath(run, slots);
  assert.equal(out.state.hp, 1, 'path damage should floor at 1 HP, never below');
  assert.ok(out.state.hearts === 3, 'the path must never touch hearts');
});

test('a card you cannot pay for fizzles and the slot does nothing', () => {
  const run = { ...newRun(2), gold: 0 };
  const out = resolvePath(run, [{ id: 'rusty_sword', from: 'hand' }, null, null, null]);
  assert.equal(out.events[0].kind, 'fizzle');
  assert.equal(out.state.atk, run.atk, 'a fizzled slot must not apply its effect');
  assert.equal(out.state.gold, 0, 'a fizzled slot must not spend gold');
});

test('the §11 fizzle trap: the same four cards pass or fail on order alone', () => {
  // Starting from 0 gold (matching Chronicle's own start), the trap has to be
  // built from cards that earn before they spend: Wild Boar's gold pays for
  // Rusty Sword exactly, leaving nothing — so Buckler only survives if Sewer
  // Rat's gold arrives before it does.
  const base = newRun(3);
  const boar = { id: 'wild_boar', from: 'hand' };
  const sword = { id: 'rusty_sword', from: 'hand' };
  const buckler = { id: 'buckler', from: 'hand' };
  const rat = { id: 'sewer_rat', from: 'hand' };

  const trap = resolvePath(base, [boar, sword, buckler, rat]);
  assert.equal(trap.events[2].kind, 'fizzle', 'Buckler at 0 gold should fizzle');
  assert.equal(trap.state.kw.armour, 0);

  const fixed = resolvePath(base, [boar, sword, rat, buckler]);
  assert.ok(fixed.events.every((e) => e.kind !== 'fizzle'), 'swapping the last two should fix it');
  assert.equal(fixed.state.kw.armour, 1);
});

test('a Place that counts earlier kills pays only for kills that came first', () => {
  const base = { ...newRun(4), atk: 6 };
  const rat = { id: 'sewer_rat', from: 'hand' };
  const boar = { id: 'wild_boar', from: 'hand' };
  const yard = { id: 'training_yard', from: 'hand' };

  const late = resolvePath(base, [rat, boar, yard, null]);
  assert.equal(late.state.atk, base.atk + 2, 'two earlier kills should give +2 ATK');

  const early = resolvePath(base, [yard, rat, boar, null]);
  assert.equal(early.state.atk, base.atk, 'no earlier kills should give nothing');
});

test('Standing Stones doubles in the fourth slot', () => {
  const base = newRun(5);
  const stones = { id: 'standing_stones', from: 'hand' };
  const early = resolvePath(base, [stones, null, null, null]);
  const last = resolvePath(base, [null, null, null, stones]);
  assert.equal(early.state.atk, base.atk + 1);
  assert.equal(early.state.maxHp, base.maxHp + 2);
  assert.equal(last.state.atk, base.atk + 2);
  assert.equal(last.state.maxHp, base.maxHp + 4);
});

test('the Quartermaster discount applies to gear and floors at 1', () => {
  const run = { ...newRun(11), perks: { ...newRun(11).perks, gearDiscount: 3 } };
  assert.equal(costFor(run, card('whetstone')), 1, '2 gold minus 3 should floor at 1');
  assert.equal(costFor(run, card('steel_longsword')), 6);
  assert.equal(costFor(run, card('roadside_shrine')), 0, 'places are free either way');
});

test('raising max HP is a ceiling, not a heal', () => {
  const hurt = { ...newRun(13), hp: 5, maxHp: 20, gold: 20 };
  const out = resolvePath(hurt, [{ id: 'chainmail', from: 'hand' }, null, null, null]);
  assert.equal(out.state.maxHp, 26);
  assert.equal(out.state.hp, 5, 'Chainmail says nothing about healing, so it heals nothing');
});

test('an armed paid upgrade fires only when the gold is actually there', () => {
  const rich = { ...newRun(20), gold: 10 };
  const poor = { ...newRun(20), gold: 3 };
  const smith = { id: 'blacksmith', from: 'hand', upgrade: true };

  const paid = resolvePath(rich, [smith, null, null, null]);
  assert.equal(paid.state.atk, rich.atk + 5, '+2 base and +3 for the 4 gold');
  assert.equal(paid.state.gold, 6);
  assert.equal(paid.events[0].upgraded, true);

  const unpaid = resolvePath(poor, [smith, null, null, null]);
  assert.equal(unpaid.state.atk, poor.atk + 2, 'the base effect still lands');
  assert.equal(unpaid.state.gold, 3, 'and no gold is taken for an upgrade you cannot afford');
  assert.equal(unpaid.events[0].upgraded, false);
});

test('an upgrade you did not arm never fires', () => {
  const run = { ...newRun(21), gold: 20 };
  const out = resolvePath(run, [{ id: 'blacksmith', from: 'hand', upgrade: false }, null, null, null]);
  assert.equal(out.state.atk, run.atk + 2);
  assert.equal(out.state.gold, 20);
});

test('Toll Bridge does nothing at all unless you pay', () => {
  const run = { ...newRun(22), gold: 20, hp: 10, maxHp: 30 };
  const skipped = resolvePath(run, [{ id: 'toll_bridge', from: 'hand' }, null, null, null]);
  assert.equal(skipped.state.maxHp, 30);
  assert.equal(skipped.state.hp, 10);
  const paid = resolvePath(run, [{ id: 'toll_bridge', from: 'hand', upgrade: true }, null, null, null]);
  assert.equal(paid.state.maxHp, 38);
  assert.equal(paid.state.hp, 18);
  assert.equal(paid.state.gold, 15);
});

test('Ruined Chapel heals to full and costs 2 ATK, never dropping below 0', () => {
  const run = { ...newRun(23), hp: 3, maxHp: 28, atk: 1 };
  const out = resolvePath(run, [{ id: 'ruined_chapel', from: 'hand' }, null, null, null]);
  assert.equal(out.state.hp, 28);
  assert.equal(out.state.atk, 0, 'ATK floors at 0 rather than going negative');
});

test('the Houndmaster grants First Strike to path fights too, not just the duel', () => {
  const run = { ...newRun(24), gold: 20, atk: 4 };
  const withAlly = resolvePath(run, [
    { id: 'houndmaster', from: 'hand' }, { id: 'wild_boar', from: 'hand' }, null, null,
  ]);
  const without = resolvePath({ ...run, gold: 20 }, [
    { id: 'wild_boar', from: 'hand' }, null, null, null,
  ]);
  const withDamage = withAlly.events[1].damage;
  const withoutDamage = without.events[0].damage;
  assert.ok(withDamage < withoutDamage, 'a free opening hit should cost you less HP');
});

test('the Shieldbearer only pays out on a duel you reached unhurt', () => {
  const run = { ...newRun(25), gold: 20 };
  const bought = resolvePath(run, [{ id: 'shieldbearer', from: 'hand' }, null, null, null]).state;
  const ghost = drawGhost(1, 0, 5);
  assert.equal(duel(bought, ghost, true).bonusArmour, 2);
  assert.equal(duel(bought, ghost, false).bonusArmour, 0);
});

test('worn gear is tracked, and the best item wins its slot', () => {
  const run = { ...newRun(30), gold: 40 };
  const out = resolvePath(run, [
    { id: 'rusty_sword', from: 'hand' },
    { id: 'steel_longsword', from: 'hand' },
    { id: 'buckler', from: 'hand' },
    null,
  ]);
  assert.deepEqual(out.state.gear, ['rusty_sword', 'steel_longsword', 'buckler']);
  const worn = equipment(out.state.gear);
  assert.equal(worn.atk.id, 'steel_longsword', 'the better weapon should be the one held');
  assert.equal(worn.armour.id, 'buckler');
  assert.equal(attackAnim(out.state.gear), 'slash');
});

test('a fizzled card is never worn, and monsters never enter the inventory', () => {
  const broke = { ...newRun(31), gold: 0 };
  const out = resolvePath(broke, [
    { id: 'rusty_sword', from: 'hand' }, { id: 'field_mouse', from: 'hand' }, null, null,
  ]);
  assert.equal(out.events[0].kind, 'fizzle');
  assert.deepEqual(out.state.gear, [], 'a card you could not pay for is not equipment');
});

test('an unarmed fighter throws a punch, not a phantom sword', () => {
  assert.equal(attackAnim([]), 'punch');
  assert.equal(attackAnim(['buckler']), 'punch', 'a shield is not a weapon');
});

test('presentation data never reaches the resolver', () => {
  // gear/anim ride along on a Fighter for the UI's benefit. snapshot() inside
  // resolveCombat drops everything it doesn't recognise, so this is the test
  // that keeps that guarantee honest as fields get added.
  const withKit = { name: 'a', hp: 20, atk: 4, gear: ['runed_greatsword'], anim: 'fire' };
  const bare = { name: 'a', hp: 20, atk: 4 };
  const foe = () => ({ name: 'b', hp: 20, atk: 3 });
  assert.equal(
    JSON.stringify(resolveCombat(withKit, foe())),
    JSON.stringify(resolveCombat(bare, foe())),
  );
});

test('a generated ghost carries an inventory that matches the stats it has', () => {
  for (let round = 1; round <= 5; round++) {
    for (let seed = 1; seed < 40; seed++) {
      const g = drawGhost(round, 2, seed * 613 + round);
      assert.ok(Array.isArray(g.inventory), 'every ghost needs an inventory');
      for (const id of g.inventory) assert.ok(card(id), `${id} is not a real card`);
      const worn = equipment(g.inventory);
      assert.ok(worn.atk, 'a ghost should always be holding a weapon');
      // A ghost with a keyword should be visibly carrying something that
      // explains it — that's the whole point of showing the panel.
      for (const key of ['armour', 'poison', 'thorns', 'rally']) {
        if (!g.keywords[key]) continue;
        const explains = g.inventory.some((id) => (card(id).fx?.[key] || 0) > 0);
        assert.ok(explains, `round ${round}: ghost has ${key} but nothing granting it`);
      }
    }
  }
});

test('a monster fight event carries a full, replayable exchange log', () => {
  const run = { ...newRun(26), atk: 5, hp: 20, maxHp: 20 };
  const out = resolvePath(run, [{ id: 'sewer_rat', from: 'hand' }, null, null, null]);
  const ev = out.events[0];
  assert.equal(ev.kind, 'fight');
  assert.ok(Array.isArray(ev.log) && ev.log.length > 0, 'a fight event needs a log to replay');
  assert.ok(ev.me && ev.monster, 'a fight event needs both starting fighters for the UI to render');
  assert.equal(typeof ev.exchanges, 'number');
});

// ---------------------------------------------------------------------------
// The persisted hand — Chronicle's own shape: a 6-card opener, then 3 fresh
// cards refilling whatever's left in hand every day after.
// ---------------------------------------------------------------------------

test('day one refills an empty hand up to six cards', () => {
  const run = newRun(70);
  const { hand } = refillHand(run, rng(1));
  assert.equal(hand.length, HAND_SIZE);
});

test('later days add three, on top of whatever is left in hand', () => {
  let run = { ...newRun(71), round: 2, hand: ['field_mouse', 'wild_boar'], seenCards: ['field_mouse', 'wild_boar'] };
  const { hand } = refillHand(run, rng(2));
  assert.equal(hand.length, 5, '2 leftover + 3 fresh');
  assert.ok(hand.includes('field_mouse') && hand.includes('wild_boar'), 'leftover cards must survive a refill');
});

test('a refill never deals the same card twice in one run', () => {
  let run = newRun(72);
  const seen = new Set();
  for (let round = 1; round <= 5; round++) {
    run = { ...run, round };
    const { hand, seenCards, drawn } = refillHand(run, rng(round * 97));
    for (const id of drawn) {
      assert.ok(!seen.has(id), `${id} was dealt twice in the same run`);
      seen.add(id);
    }
    run = { ...run, hand, seenCards };
  }
});

test('the floor holds across a refill, not just within one draw', () => {
  // A hand with zero monsters and zero spendables left over must come out of
  // a refill with the floor met by the *combined* hand — this is the failure
  // mode that would make a day literally unplayable: no way to earn gold, no
  // way to spend it, through no fault of the player.
  for (let round = 1; round <= 5; round++) {
    for (let seed = 1; seed <= 200; seed++) {
      const run = { ...newRun(seed), round, hand: [], seenCards: [] };
      const { hand } = refillHand(run, rng(seed * 31 + round));
      const kinds = hand.map((id) => card(id).type);
      assert.ok(kinds.filter((t) => t === 'monster').length >= MIN_HAND_MONSTERS || hand.length < MIN_HAND_MONSTERS,
        `round ${round} seed ${seed}: gold unreachable`);
      assert.ok(kinds.some((t) => t === 'gear' || t === 'place') || hand.length === 0,
        `round ${round} seed ${seed}: gold unspendable`);
    }
  }
});

test('a refill can come back short once a tier runs dry, without throwing', () => {
  // A 10-card tier pool drawn from on three separate days (up to 6+3+3=12
  // potential T1 draws) can run out before the third day's request is filled.
  // That has to degrade to a shorter hand, never crash and never repeat a card.
  const deck = deckLib.presetCards('balanced');
  let run = { ...newRun(73, 'x', deck), round: 1 };
  for (let round = 1; round <= 2; round++) {
    run = { ...run, round };
    const { hand, seenCards } = refillHand(run, rng(round * 41));
    run = { ...run, hand, seenCards };
  }
  assert.ok(run.hand.length <= HAND_SIZE + HAND_REFILL);
});

test('a played card leaves the hand; an unplayed one carries into the next day', () => {
  const run = { ...newRun(74), hand: ['wild_boar', 'rusty_sword', 'buckler'], gold: 20 };
  const out = resolvePath(run, [{ id: 'wild_boar', from: 'hand' }, { id: 'rusty_sword', from: 'hand' }, null, null]);
  assert.deepEqual(out.state.hand, ['buckler'], 'only the two played cards should leave the hand');
});

test('a fizzled card still leaves the hand — spent, not refunded', () => {
  const run = { ...newRun(75), hand: ['rusty_sword'], gold: 0 };
  const out = resolvePath(run, [{ id: 'rusty_sword', from: 'hand' }, null, null, null]);
  assert.equal(out.events[0].kind, 'fizzle');
  assert.deepEqual(out.state.hand, [], 'a card you could not afford is still gone');
});

test('mulligan swaps one card, is capped, and only works on day one', () => {
  const base = { ...newRun(76), hand: ['field_mouse', 'wild_boar'], seenCards: ['field_mouse', 'wild_boar'] };
  const after = mulligan(base, 'field_mouse', rng(9));
  assert.notEqual(after.hand[0], 'field_mouse');
  assert.ok(after.hand.includes('wild_boar'), 'only the targeted card should change');
  assert.equal(after.mulligansLeft, MULLIGAN_LIMIT - 1);

  const exhausted = { ...base, mulligansLeft: 0 };
  assert.deepEqual(mulligan(exhausted, 'wild_boar', rng(9)), exhausted, 'no swaps left');

  const lateRun = { ...base, round: 2 };
  assert.deepEqual(mulligan(lateRun, 'wild_boar', rng(9)), lateRun, 'day one only');
});

test('mulligan never deals a card the run has already seen', () => {
  let run = { ...newRun(77), hand: ['field_mouse'], seenCards: ['field_mouse', 'wild_boar', 'sewer_rat'] };
  for (let i = 0; i < MULLIGAN_LIMIT; i++) {
    run = mulligan(run, run.hand[0], rng(i * 7 + 1));
    assert.ok(!['wild_boar', 'sewer_rat'].includes(run.hand[0]), 'must not redeal an already-seen card');
  }
});

// ---------------------------------------------------------------------------
// Dealing and run structure
// ---------------------------------------------------------------------------

test('every hand is six cards with at least two monsters and one thing to buy', () => {
  for (let round = 1; round <= 8; round++) {
    for (let seed = 1; seed <= 400; seed++) {
      const hand = deal(round, rng(seed * 31 + round));
      assert.equal(hand.length, 6, `round ${round} seed ${seed}`);
      assert.equal(new Set(hand).size, 6, 'a hand should never contain duplicates');
      const kinds = hand.map((id) => card(id).type);
      assert.ok(kinds.filter((t) => t === 'monster').length >= 2, `round ${round} seed ${seed}: gold unreachable`);
      assert.ok(kinds.some((t) => t === 'gear' || t === 'place'), `round ${round} seed ${seed}: gold unspendable`);
      const tiers = tiersForRound(round);
      for (const id of hand) assert.ok(tiers.includes(card(id).tier), 'off-tier card dealt');
    }
  }
});

test('the same round of the same run always deals the same six cards', () => {
  const a = deal(3, rng(4242));
  const b = deal(3, rng(4242));
  assert.deepEqual(a, b);
});

test('rounds scale in tier the way §9 says', () => {
  assert.deepEqual(tiersForRound(1), [1]);
  assert.deepEqual(tiersForRound(2), [1]);
  assert.deepEqual(tiersForRound(3), [1, 2]);
  assert.deepEqual(tiersForRound(4), [2]);
  assert.deepEqual(tiersForRound(5), [2, 3]);
  assert.deepEqual(tiersForRound(9), [2, 3]);
});

test('between rounds you heal half your max, and keep gold and ATK', () => {
  const run = { ...newRun(14), round: 2, hp: 5, maxHp: 31, atk: 9, gold: 17, upkeepDone: false };
  const next = startRound(run);
  assert.equal(next.hp, 5 + 16, 'half of 31 rounds up to 16');
  assert.equal(next.atk, 9);
  assert.equal(next.gold, 17);
});

test('upkeep is idempotent, so resuming a saved run cannot double-heal', () => {
  const run = { ...newRun(15), round: 3, hp: 4, maxHp: 30 };
  const once = startRound(run);
  const twice = startRound(once);
  assert.equal(once.hp, 19);
  assert.equal(twice.hp, once.hp);
});

test('recurring allies pay out at the top of every future round', () => {
  let run = { ...newRun(16), gold: 20 };
  run = resolvePath(run, [
    { id: 'coin_clipper', from: 'hand' },
    { id: 'sparring_partner', from: 'hand' },
    null, null,
  ]).state;
  const goldAfterBuying = run.gold;
  const atkAfterBuying = run.atk;
  run = startRound({ ...run, round: 2, upkeepDone: false });
  assert.equal(run.gold, goldAfterBuying + 2);
  assert.equal(run.atk, atkAfterBuying + 1);
});

test('five wins completes a run, three losses ends it', () => {
  let run = newRun(17);
  for (let i = 0; i < 5; i++) run = settleRound(run, true);
  assert.ok(run.completed && run.over);

  let doomed = newRun(18);
  for (let i = 0; i < 3; i++) doomed = settleRound(doomed, false);
  assert.ok(doomed.over && !doomed.completed);
  assert.equal(doomed.hearts, 0);
});

test('only the duel can take a heart', () => {
  const run = { ...newRun(19), hp: 1 };
  const after = resolvePath(run, [{ id: 'hill_giant', from: 'hand' }, null, null, null]);
  assert.equal(after.state.hearts, 3);
  assert.equal(settleRound(after.state, false).hearts, 2);
});

// ---------------------------------------------------------------------------
// Ghosts
// ---------------------------------------------------------------------------

test('a generated ghost is always a legal, finite fighter', () => {
  for (let round = 1; round <= 7; round++) {
    for (let wins = 0; wins < 5; wins++) {
      for (let seed = 1; seed < 60; seed++) {
        const g = drawGhost(round, wins, seed * 977 + round);
        assert.ok(g.hp >= 1 && g.hp <= g.maxHp, `${round}/${wins}/${seed}: ${g.hp}/${g.maxHp}`);
        assert.ok(g.atk >= 1);
        assert.ok(Object.keys(ARCHETYPES).includes(g.archetype));
        assert.equal(g.path.length, 4);
        const r = duel({ ...newRun(1), hp: 30, maxHp: 30, atk: 8 }, g, false);
        assert.ok(r.exchanges < 200, 'a duel must always resolve');
      }
    }
  }
});

test('the same bucket and seed always draw the same ghost', () => {
  assert.deepEqual(drawGhost(4, 2, 99), drawGhost(4, 2, 99));
});

test('ghosts get harder as the round climbs', () => {
  const power = (round) => {
    let total = 0;
    for (let s = 1; s <= 200; s++) {
      const g = drawGhost(round, 2, s * 13);
      total += g.atk * 3 + g.maxHp;
    }
    return total / 200;
  };
  const curve = [1, 2, 3, 4, 5].map(power);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i] > curve[i - 1], `round ${i + 1} should out-scale round ${i}`);
  }
});

test('the ghost pool spreads across all four archetypes', () => {
  const counts = {};
  for (let s = 1; s <= 2000; s++) {
    const g = drawGhost(4, 2, s * 7919);
    counts[g.archetype] = (counts[g.archetype] || 0) + 1;
  }
  for (const key of Object.keys(ARCHETYPES)) {
    const share = (counts[key] || 0) / 2000;
    // §12 wants no archetype above 30% or below 15% of the pool at round 4.
    assert.ok(share >= 0.15 && share <= 0.30, `${key} is ${(share * 100).toFixed(1)}% of the pool`);
  }
});

test('a ghost is a pure function of (round, wins, seed) — never of who is about to fight it', () => {
  // This is the one property drawGhost is not allowed to trade away, for any
  // reason, including duel pacing: in real async PvP a ghost is a frozen
  // snapshot uploaded once and fought by strangers afterward, so two players
  // who draw "the same ghost" have to be fighting the literal same opponent.
  // A four-argument call is the regression this guards against — an earlier
  // version of drawGhost took the live player's stats as a fourth argument
  // and silently rescaled the ghost around them. Extra arguments here must
  // be inert.
  for (const [round, wins, seed] of [[1, 0, 1], [3, 2, 4242], [5, 4, 99]]) {
    const a = drawGhost(round, wins, seed);
    const b = drawGhost(round, wins, seed, { atk: 999, maxHp: 999 });
    const c = drawGhost(round, wins, seed, { atk: 1, maxHp: 1 });
    assert.deepEqual(a, b, `${round}/${wins}/${seed}: an extra argument changed the ghost`);
    assert.deepEqual(a, c, `${round}/${wins}/${seed}: an extra argument changed the ghost`);
  }
});

test('a duel against a ghost from its own band lands in the §12 window', () => {
  // Ghosts are paced against a *canonical* round-N character (see PACING in
  // js/ghosts.js) — never against whoever happens to be fighting them, since
  // that would break the snapshot promise the test above locks in. What this
  // checks instead: a character actually sitting in §9's band for that round,
  // with a keyword loadout a real path would plausibly leave them, gets a
  // competitive, multi-exchange fight against ghosts drawn normally for that
  // same (round, wins).
  const scenarios = [
    { label: 'round 1, low band', round: 1, wins: 0, atk: 3, maxHp: 20, kw: {}, band: [0.25, 0.75] },
    { label: 'round 3, mid band', round: 3, wins: 1, atk: 12, maxHp: 30, kw: { armour: 1 }, band: [0.25, 0.78] },
    { label: 'round 5, mid band, one keyword', round: 5, wins: 2, atk: 26, maxHp: 43, kw: { armour: 3 }, band: [0.25, 0.82] },
    // Two keywords stacked on top of an already-mid-band statline is a
    // genuinely strong hybrid build — the archetype-viability sweep backs
    // this up (tools/balance.mjs's README section, and the archetype
    // simulation behind it: a build that leans into a synergy consistently
    // outperforms one that spreads thin). It should win more than a
    // single-keyword build — just not be an unloseable lock.
    { label: 'round 5, mid band, Armour + Rally', round: 5, wins: 2, atk: 26, maxHp: 43, kw: { armour: 4, rally: 2 }, band: [0.55, 0.99] },
    // Top of the band plus a keyword no archetype gets "for free" (First
    // Strike is only ~34% of the pool, and cancels entirely against another
    // First Strike ghost) is a genuinely strong build. It should win more
    // than a mid-band one — just not be an unloseable lock.
    { label: 'round 3, high band, First Strike', round: 3, wins: 2, atk: 13, maxHp: 32, kw: { firstStrike: true }, band: [0.55, 0.97] },
  ];
  for (const { label, round, wins, atk, maxHp, kw, band } of scenarios) {
    let exchanges = 0, winCount = 0;
    const n = 500;
    for (let s = 1; s <= n; s++) {
      const g = drawGhost(round, wins, s * 12345);
      const base = newRun(1);
      const player = { ...base, atk, maxHp, hp: maxHp, kw: { ...base.kw, ...kw } };
      const d = duel(player, g, false);
      exchanges += d.exchanges;
      if (d.won) winCount++;
    }
    const mean = exchanges / n;
    const winRate = winCount / n;
    assert.ok(mean >= 2.0 && mean <= 7.5, `${label}: mean exchanges ${mean.toFixed(2)}`);
    assert.ok(winRate >= band[0] && winRate <= band[1], `${label}: win rate ${(winRate * 100).toFixed(1)}%`);
  }
});

test('Tank ghosts take longer to resolve than Aggro ghosts, on average', () => {
  const player = { atk: 14, maxHp: 30 };
  const meanFor = (archetype) => {
    let total = 0, n = 0;
    for (let s = 1; s <= 3000 && n < 300; s++) {
      const g = drawGhost(3, 1, s * 991);
      if (g.archetype !== archetype) continue;
      total += duel({ ...newRun(1), ...player, hp: player.maxHp }, g, false).exchanges;
      n++;
    }
    return total / n;
  };
  assert.ok(meanFor('tank') > meanFor('aggro'), 'a Tank ghost should out-stall an Aggro one');
});

// ---------------------------------------------------------------------------
// The rival, and secrets
// ---------------------------------------------------------------------------

test('a rival is one person: same name and archetype every day of the run', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rv = drawRival(seed * 7919);
    assert.equal(rv.days.length, RUN_DAYS);
    for (const d of rv.days) {
      assert.equal(d.name, rv.name, 'a rival must not change name mid-run');
      assert.equal(d.archetype, rv.archetype,
        'a rival whose build flips overnight cannot be learned or countered');
    }
  }
});

test('a rival is a pure function of their seed, fixed before the run begins', () => {
  // Same promise js/ghosts.js makes, and it matters more here: the rival is
  // chosen on day one and cannot react to how the player is doing.
  for (const seed of [1, 4242, 0xfeed]) {
    assert.deepEqual(drawRival(seed), drawRival(seed));
  }
});

test('a rival gets stronger across their five days', () => {
  // Averaged over many rivals — an individual archetype can wobble, but the
  // series has to escalate or the last day means nothing.
  const power = (day) => {
    let total = 0;
    for (let s = 1; s <= 300; s++) {
      const d = rivalOnDay(drawRival(s * 613), day);
      total += d.atk * 3 + d.maxHp;
    }
    return total / 300;
  };
  const curve = [1, 2, 3, 4, 5].map(power);
  for (let i = 1; i < curve.length; i++) {
    assert.ok(curve[i] > curve[i - 1], `day ${i + 1} should out-scale day ${i}`);
  }
});

test('the rival lays no secrets on day one, and more of them later', () => {
  for (let s = 1; s <= 100; s++) {
    const rv = drawRival(s * 31);
    assert.equal(rivalOnDay(rv, 1).secrets.length, 0,
      'day one should be a clean read, so the player learns the shape first');
    assert.ok(rivalOnDay(rv, 5).secrets.length >= rivalOnDay(rv, 2).secrets.length);
    for (const d of rv.days) {
      for (const id of d.secrets) {
        assert.ok(card(id), `${id} is not a real card`);
        assert.equal(card(id).type, 'secret');
      }
    }
  }
});

test('intel opens the statline but hides the secrets until you scout', () => {
  const rv = drawRival(999);
  for (let day = 1; day <= RUN_DAYS; day++) {
    const blind = intel(rv, day, false);
    const scout = intel(rv, day, true);
    const truth = rivalOnDay(rv, day);

    // The build is open — that's the whole point of a fixed rival.
    assert.equal(blind.atk, truth.atk);
    assert.deepEqual(blind.keywords, truth.keywords);

    // The secrets are not, but their *number* is: you always know something
    // is waiting, which is what makes scouting a decision instead of a shot
    // in the dark.
    assert.equal(blind.secrets, null, 'unscouted intel must not leak the secrets');
    assert.equal(blind.secretCount, truth.secrets.length);
    assert.deepEqual(scout.secrets, truth.secrets);
  }
});

test('a secret strips exactly what it names, and nothing else', () => {
  const base = { name: 'r', hp: 40, maxHp: 40, atk: 10, armour: 4, thorns: 3, poison: 3, rally: 2, firstStrike: true };
  const { fighter: f } = applySecrets(base, ['caltrops']);
  assert.equal(f.atk, 8, 'Caltrops takes 2 ATK');
  assert.equal(f.armour, 4, 'and touches nothing else');
  assert.equal(f.poison, 3);
  assert.equal(f.firstStrike, true);

  const { fighter: g } = applySecrets(base, ['snare_wire']);
  assert.equal(g.firstStrike, false);
  assert.equal(g.atk, 10);
});

test('secrets stack, and every strip has a floor', () => {
  const weak = { name: 'r', hp: 10, maxHp: 10, atk: 2, armour: 1, poison: 1, rally: 1, thorns: 1, firstStrike: true };
  const { fighter: f } = applySecrets(weak, ['sabotage', 'hamstring', 'purge_ritual', 'ambush_pit']);
  // No pile of secrets may produce a fighter who cannot fight, or a duel that
  // cannot resolve.
  assert.ok(f.atk >= 1, 'a fighter can always swing for at least 1');
  assert.ok(f.maxHp >= 1);
  assert.ok(f.hp >= 0 && f.hp <= f.maxHp);
  assert.equal(f.armour, 0);
  assert.equal(f.poison, 0);
});

test('a secret never mutates the snapshot it was played against', () => {
  // The async promise: your secret applies to *your copy* of the rival, the
  // way a real opponent's would apply to their copy of you. The stored
  // character has to come out the other side untouched.
  const rv = drawRival(2024);
  const day = rivalOnDay(rv, 4);
  const before = JSON.stringify(day);
  const player = { ...newRun(1), atk: 20, hp: 40, maxHp: 40 };
  duel(player, day, false, { mine: ['sabotage', 'ambush_pit'], theirs: day.secrets });
  assert.equal(JSON.stringify(rivalOnDay(rv, 4)), before, 'the rival snapshot was modified');
});

test('a duel applies each side’s secrets to the other, not to themselves', () => {
  const rv = drawRival(555);
  const them = rivalOnDay(rv, 3);
  const player = { ...newRun(1), atk: 14, hp: 30, maxHp: 30 };

  const clean = duel(player, them, false);
  const withMine = duel(player, them, false, { mine: ['hamstring'] });
  assert.equal(withMine.them.atk, Math.max(1, clean.them.atk - 5), 'Hamstring should hit the rival');
  assert.equal(withMine.me.atk, clean.me.atk, 'and must not touch the player');

  const withTheirs = duel(player, them, false, { theirs: ['hamstring'] });
  assert.equal(withTheirs.me.atk, Math.max(1, clean.me.atk - 5), 'their Hamstring should hit the player');
  assert.equal(withTheirs.them.atk, clean.them.atk);
});

test('a secret played on the path costs its slot and changes nothing about you', () => {
  const run = { ...newRun(40), gold: 10, atk: 5 };
  const out = resolvePath(run, [{ id: 'caltrops', from: 'hand' }, null, null, null]);
  assert.equal(out.events[0].kind, 'secret');
  assert.deepEqual(out.secrets, ['caltrops']);
  assert.equal(out.state.atk, run.atk, 'a secret does nothing to your own statline');
  assert.equal(out.state.gold, run.gold - card('caltrops').cost, 'but it is still paid for');
  assert.deepEqual(out.state.gear, [], 'a secret is spent, not worn');
});

test('a secret you cannot pay for fizzles and is never carried into the duel', () => {
  const broke = { ...newRun(41), gold: 0 };
  const out = resolvePath(broke, [{ id: 'sabotage', from: 'hand' }, null, null, null]);
  assert.equal(out.events[0].kind, 'fizzle');
  assert.deepEqual(out.secrets, []);
});

test('winning a day pays, and pays more the deeper into the series it is', () => {
  const early = settleRound({ ...newRun(60), round: 1, gold: 0 }, true);
  const late = settleRound({ ...newRun(60), round: 4, gold: 0 }, true);
  assert.ok(early.gold > 0, 'a duel win has to buy something back');
  assert.ok(late.gold > early.gold, 'later days should pay more');
  const lost = settleRound({ ...newRun(60), round: 4, gold: 0 }, false);
  assert.equal(lost.gold, 0, 'losing pays nothing');
});

test('invasions are switched off for now — no rival carries one, any day', () => {
  // Pulled from live play pending a UI and balance pass (README.md's
  // "Invasion, on hold"). hasInvasion(day) is the single switch; this locks
  // in that switching it back off is enough to keep it out of a run
  // end-to-end, without anything downstream (drawRival, intel) needing to
  // know why. resolveAmbush itself — the part that actually resolves a
  // fight — is still tested directly below, since that machinery is correct
  // and untouched; only the "does a rival have one today" decision changed.
  for (let seed = 1; seed <= 50; seed++) {
    const rv = drawRival(seed * 977);
    for (let day = 1; day <= RUN_DAYS; day++) {
      assert.equal(rivalOnDay(rv, day).invasion, null, `day ${day} should carry no invasion while this is off`);
      assert.equal(intel(rv, day, true).hasInvasion, false);
    }
  }
});

test('resolveAmbush pays off exactly like a monster from the path would', () => {
  const run = { ...newRun(80), atk: 6, hp: 20, maxHp: 20, gold: 0 };
  const ambush = resolveAmbush(run, 'cave_troll');
  assert.equal(ambush.event.kind, 'fight');
  assert.equal(ambush.event.gold, card('cave_troll').gold);
  assert.ok(ambush.state.gold > 0, 'the gold should actually be paid');
  assert.ok(Array.isArray(ambush.event.log) && ambush.event.log.length > 0);
  assert.ok(ambush.state.hp >= 1, 'the floor holds for an ambush too — it cannot kill the player before the duel');
});

test('an ambush never mutates the run it was fought against', () => {
  const run = { ...newRun(81), atk: 4, hp: 15, maxHp: 20 };
  const before = JSON.stringify(run);
  resolveAmbush(run, 'wild_boar');
  assert.equal(JSON.stringify(run), before);
});

test('a five-day series ends on day five, and three losses ends it sooner', () => {
  let run = newRun(50);
  for (let d = 0; d < RUN_DAYS; d++) {
    assert.ok(!run.over, `the run should still be live on day ${d + 1}`);
    run = settleRound(run, true);
  }
  assert.ok(run.over && run.completed, 'surviving five days wins the series');

  // Losing two of five and winning the rest still takes it — you finished
  // with hearts left, which is the same thing as winning more days.
  let mixed = newRun(51);
  for (const won of [false, true, false, true, true]) mixed = settleRound(mixed, won);
  assert.ok(mixed.over && mixed.completed);
  assert.equal(mixed.wins, 3);
  assert.equal(mixed.losses, 2);

  let doomed = newRun(52);
  for (let i = 0; i < 3; i++) doomed = settleRound(doomed, false);
  assert.ok(doomed.over && !doomed.completed, 'three losses ends it wherever you are');
  assert.equal(doomed.hearts, 0);
});

// ---------------------------------------------------------------------------
// Whole runs
// ---------------------------------------------------------------------------

test('a thousand random runs finish without throwing or stalling', () => {
  for (let seed = 1; seed <= 1000; seed++) {
    let run = newRun(seed);
    let guard = 0;
    while (!run.over) {
      assert.ok(++guard < 40, 'a run should end well inside 40 rounds');
      run = startRound(run);
      const hand = deal(run.round, rng(run.seed + run.round));
      // Play greedily and stupidly: whatever comes first.
      const slots = hand.slice(0, PATH_SLOTS).map((id) => ({ id, from: 'hand', upgrade: false }));
      const out = resolvePath(run, slots);
      assert.ok(out.state.hp >= 1, 'the path floor held');
      assert.ok(Number.isFinite(out.state.gold) && out.state.gold >= 0, 'gold went strange');
      const g = drawGhost(run.round, run.wins, (seed * 31 + run.round) >>> 0);
      const d = duel(out.state, g, out.cleanPath);
      run = settleRound(out.state, d.won);
    }
    assert.ok(run.completed || run.hearts === 0);
  }
});

test('the constants the UI leans on are what the design says', () => {
  assert.equal(PATH_SLOTS, 4);
  assert.equal(HAND_SIZE, 6);
  assert.deepEqual(START, { hp: 20, maxHp: 20, atk: 2, gold: 0, hearts: 3 });
});

console.log(`engine: ${passed} tests passed`);
