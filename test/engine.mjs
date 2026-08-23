// Rules tests. Everything the design document promises about resolution is
// asserted here, because "deterministic" is not a property you can eyeball —
// it's the one thing a player is entitled to rely on when they plan a path.
//
//   node test/engine.mjs

import assert from 'node:assert/strict';
import {
  resolveCombat, tiebreak, newRun, startRound, deal, resolvePath, duel,
  settleRound, tiersForRound, costFor, rng, monsterFighter, playerFighter,
  PATH_SLOTS, HAND_SIZE, START,
} from '../js/engine.js';
import { card, ALL_CARDS, DEAL_POOL, MONSTERS, GEAR, ALLIES, PLACES } from '../js/cards.js';
import { drawGhost, ARCHETYPES } from '../js/ghosts.js';

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

test('the pool is 58 cards, all of them dealable', () => {
  assert.equal(DEAL_POOL.length, 58);
  assert.equal(ALL_CARDS.length, 58);
  assert.equal(MONSTERS.length, 22);
  assert.equal(GEAR.length, 19);
  assert.equal(ALLIES.length, 8);
  assert.equal(PLACES.length, 9);
});

test('every card has a unique id and a contiguous number', () => {
  const ids = new Set(ALL_CARDS.map((c) => c.id));
  assert.equal(ids.size, 58);
  const nos = ALL_CARDS.map((c) => c.no).sort((a, b) => a - b);
  nos.forEach((n, i) => assert.equal(n, i + 1));
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
  const base = newRun(3);
  const mouse = { id: 'field_mouse', from: 'hand' };
  const sword = { id: 'rusty_sword', from: 'hand' };
  const buckler = { id: 'buckler', from: 'hand' };
  const boar = { id: 'wild_boar', from: 'hand' };

  const trap = resolvePath(base, [mouse, sword, buckler, boar]);
  assert.equal(trap.events[2].kind, 'fizzle', 'Buckler at 1 gold should fizzle');
  assert.equal(trap.state.kw.armour, 0);

  const fixed = resolvePath(base, [mouse, sword, boar, buckler]);
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
    { label: 'round 3, mid band', round: 3, wins: 1, atk: 12, maxHp: 28, kw: { armour: 1 }, band: [0.25, 0.75] },
    { label: 'round 5, mid band, one keyword', round: 5, wins: 2, atk: 27, maxHp: 39, kw: { armour: 2 }, band: [0.25, 0.8] },
    // Two keywords stacked on top of an already-mid-band statline is a
    // genuinely strong hybrid build — the archetype-viability sweep backs
    // this up (tools/balance.mjs's README section, and the archetype
    // simulation behind it: a build that leans into a synergy consistently
    // outperforms one that spreads thin). It should win more than a
    // single-keyword build — just not be an unloseable lock.
    { label: 'round 5, mid band, Armour + Rally', round: 5, wins: 2, atk: 27, maxHp: 39, kw: { armour: 3, rally: 2 }, band: [0.55, 0.98] },
    // Top of the band plus a keyword no archetype gets "for free" (First
    // Strike is only ~34% of the pool, and cancels entirely against another
    // First Strike ghost) is a genuinely strong build. It should win more
    // than a mid-band one — just not be an unloseable lock.
    { label: 'round 3, high band, First Strike', round: 3, wins: 2, atk: 14, maxHp: 30, kw: { firstStrike: true }, band: [0.55, 0.97] },
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
  assert.deepEqual(START, { hp: 20, maxHp: 20, atk: 1, gold: 3, hearts: 3 });
});

console.log(`engine: ${passed} tests passed`);
