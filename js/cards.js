// The whole card pool: 124 cards that can be dealt to a hand.
//
// Cards are data, not behaviour. A card describes *what* it does with an `fx`
// bag of stat deltas; the handful of cards whose value depends on the state of
// the path at the moment they resolve carry a `dyn(ctx)` instead, which returns
// the same shape. Keeping it declarative is what lets test/engine.mjs assert on
// the pool without simulating a whole run.
//
// fx keys — every one is optional:
//   atk, maxHp, heal, healFull, gold   flat deltas
//   armour, thorns, poison, rally      keyword stacks (additive, permanent)
//   firstStrike                        boolean, sticky once granted
//
// ctx passed to dyn() — see resolvePath() in js/engine.js for exactly what
// each one is:
//   { slot, slots, gold, monstersDefeated, usedWatchtower, paidUpgrade,
//     left, right, kw, atk, hp, maxHp, gear, durability, heartsLost, round }
//
// `anim` is purely presentational — which attack animation this fighter or
// weapon plays when it lands a blow. It never touches resolution; a Runed
// Greatsword and an Executioner's Blade swing differently and do exactly what
// their numbers say. Kinds: slash, chop, stab, arrow, claw, bite, smash,
// magic, fire, lash.
//
// The design doc's §7 Spoils-and-Stash system (named item drops from
// monsters, held until spent) is deliberately not implemented here — cut for
// this prototype pass so the fight itself could get the attention instead.
// See README.md.

/** @typedef {'monster'|'gear'|'ally'|'place'|'secret'} CardType */

// Every Tier 2 and Tier 3 monster leaves a `trophy` — a permanent upgrade on
// top of its gold. That's the whole risk/reward shape of the path: a Tier 1
// monster is a gold vending machine, while the things that can actually hurt
// you are how you pick up Armour, Poison, Thorns and Rally in the first
// place. Fighting up a tier should feel like a decision with a prize at the
// end of it, not just a bigger number of coins.
export const MONSTERS = [
  // ---- Tier 1 ----
  { no: 1, id: 'field_mouse', name: 'Field Mouse', tier: 1, hp: 2, atk: 1, kw: {}, gold: 2, anim: 'bite' },
  { no: 2, id: 'sewer_rat', name: 'Sewer Rat', tier: 1, hp: 3, atk: 1, kw: {}, gold: 3, anim: 'bite' },
  { no: 3, id: 'wild_boar', name: 'Wild Boar', tier: 1, hp: 5, atk: 2, kw: {}, gold: 4, anim: 'stab' },
  { no: 4, id: 'goblin_scrapper', name: 'Goblin Scrapper', tier: 1, hp: 4, atk: 2, kw: {},
    gold: 3, trophy: { atk: 1 }, anim: 'slash' },
  { no: 5, id: 'giant_spider', name: 'Giant Spider', tier: 1, hp: 4, atk: 1, kw: { poison: 1 },
    gold: 2, drop: 'venom_flask', anim: 'bite' },
  { no: 6, id: 'bandit_lookout', name: 'Bandit Lookout', tier: 1, hp: 6, atk: 2, kw: {}, gold: 5, anim: 'slash' },
  { no: 7, id: 'bog_toad', name: 'Bog Toad', tier: 1, hp: 8, atk: 1, kw: {},
    gold: 4, trophy: { maxHp: 2 }, anim: 'lash' },
  { no: 8, id: 'skeleton_picket', name: 'Skeleton Picket', tier: 1, hp: 5, atk: 3, kw: { armour: 1 },
    gold: 3, drop: 'buckler', anim: 'stab' },
  { no: 9, id: 'feral_hound', name: 'Feral Hound', tier: 1, hp: 3, atk: 2, kw: { firstStrike: true }, gold: 4, anim: 'claw' },

  // ---- Tier 2 ----
  { no: 10, id: 'cave_troll', name: 'Cave Troll', tier: 2, hp: 14, atk: 5, kw: {},
    gold: 9, trophy: { maxHp: 3 }, anim: 'smash' },
  { no: 11, id: 'marsh_wraith', name: 'Marsh Wraith', tier: 2, hp: 10, atk: 3, kw: { poison: 3 },
    gold: 8, trophy: { poison: 2 }, anim: 'magic' },
  { no: 12, id: 'bandit_captain', name: 'Bandit Captain', tier: 2, hp: 12, atk: 6, kw: {},
    gold: 6, drop: 'rusty_sword', anim: 'slash' },
  { no: 13, id: 'iron_golem', name: 'Iron Golem', tier: 2, hp: 16, atk: 4, kw: { armour: 3 },
    gold: 6, drop: 'tower_shield', anim: 'smash' },
  { no: 14, id: 'ogre_brute', name: 'Ogre Brute', tier: 2, hp: 18, atk: 7, kw: {},
    gold: 12, trophy: { maxHp: 3 }, anim: 'smash' },
  { no: 15, id: 'wyvern_hatchling', name: 'Wyvern Hatchling', tier: 2, hp: 11, atk: 5, kw: { firstStrike: true },
    gold: 9, trophy: { atk: 1 }, anim: 'fire' },
  { no: 16, id: 'thornback_boar', name: 'Thornback Boar', tier: 2, hp: 13, atk: 4, kw: { thorns: 3 },
    gold: 8, trophy: { thorns: 2 }, anim: 'stab' },

  // ---- Tier 3 ----
  { no: 17, id: 'hill_giant', name: 'Hill Giant', tier: 3, hp: 26, atk: 9, kw: {},
    gold: 16, trophy: { maxHp: 4 }, anim: 'smash' },
  { no: 18, id: 'basilisk', name: 'Basilisk', tier: 3, hp: 22, atk: 7, kw: { poison: 6 },
    gold: 9, drop: 'basilisk_fang', anim: 'bite' },
  { no: 19, id: 'stone_warden', name: 'Stone Warden', tier: 3, hp: 30, atk: 8, kw: { armour: 5 },
    gold: 18, trophy: { armour: 2 }, anim: 'smash' },
  { no: 20, id: 'chimera', name: 'Chimera', tier: 3, hp: 24, atk: 11, kw: { firstStrike: true },
    gold: 17, trophy: { atk: 2 }, anim: 'claw' },
  { no: 21, id: 'elder_wyrm', name: 'Elder Wyrm', tier: 3, hp: 32, atk: 10, kw: { rally: 3 },
    gold: 12, drop: 'dragonplate', anim: 'fire' },
  { no: 22, id: 'flame_imp', name: 'Flame Imp', tier: 3, hp: 20, atk: 8, kw: {},
    gold: 14, trophy: { atk: 2 }, anim: 'fire' },

  // A monster that carries something worth taking. `drop` hands you the actual
  // gear card — it goes into your inventory, shows up in the equipment panel,
  // and if it's a weapon you start swinging it. Gold buys what you choose;
  // drops give you what you *took*, which is a different kind of reward and
  // the reason to pick a fight you could have walked past.
  { no: 74, id: 'dire_wolf', name: 'Dire Wolf', tier: 2, hp: 12, atk: 6, kw: { firstStrike: true },
    gold: 7, trophy: { atk: 1 }, anim: 'claw' },
  { no: 75, id: 'forest_troll', name: 'Forest Troll', tier: 2, hp: 15, atk: 5, kw: { thorns: 2 },
    gold: 6, drop: 'spiked_vambrace', anim: 'smash' },
  { no: 76, id: 'grave_knight', name: 'Grave Knight', tier: 2, hp: 17, atk: 6, kw: { armour: 2 },
    gold: 5, drop: 'steel_longsword', anim: 'slash' },
  { no: 77, id: 'bog_horror', name: 'Bog Horror', tier: 3, hp: 28, atk: 8, kw: { poison: 5 },
    gold: 12, trophy: { maxHp: 4 }, anim: 'lash' },
  { no: 78, id: 'frost_wraith', name: 'Frost Wraith', tier: 3, hp: 23, atk: 9, kw: { armour: 2 },
    gold: 9, drop: 'chainmail', anim: 'magic' },
  { no: 79, id: 'warlord_of_ash', name: 'Warlord of Ash', tier: 3, hp: 27, atk: 10, kw: { rally: 2 },
    gold: 8, drop: 'executioners_blade', anim: 'chop' },
].map((m) => ({ ...m, type: 'monster' }));

// `slot` is which equipment-panel slot a piece of gear fills when it's worn —
// the panel shows the real item you're carrying rather than a generic keyword
// icon, and the weapon you're holding is what picks your attack animation. A
// fighter with no weapon at all swings a fist.
//
// `durability` (weapons only) is what stopped ATK from ever being a running
// total: a weapon's `fx.atk` used to add permanently the moment it was
// bought, so five weapons across a run gave the sum of all five forever, no
// matter which one the equipment panel showed as worn. Real weapon ATK is
// solved live every fight instead, from whichever weapon currently wins the
// slot *and* still has durability left — see `weaponAtk()` below — and every
// attack it lands costs it one point of durability. At zero it breaks and
// drops out of the slot, same as it never mattered which sword you were
// technically still carrying in your bag. Roughly durability ≈ 0.55–0.75×
// the weapon's own ATK, so a cheap early sword is a couple of good fights
// and a Titan Maul is a real investment, not an annuity.
export const GEAR = [
  // ---- Tier 1 ----
  { no: 23, id: 'whetstone', name: 'Whetstone', tier: 1, cost: 2, fx: { atk: 2 } },
  { no: 24, id: 'buckler', name: 'Buckler', tier: 1, cost: 3, fx: { armour: 1 }, slot: 'armour' },
  { no: 25, id: 'travellers_boots', name: "Traveller's Boots", tier: 1, cost: 3, fx: { maxHp: 4, heal: 4 } },
  { no: 26, id: 'rusty_sword', name: 'Rusty Sword', tier: 1, cost: 4, fx: { atk: 3 }, slot: 'atk', durability: 2, anim: 'slash' },
  { no: 27, id: 'leather_jerkin', name: 'Leather Jerkin', tier: 1, cost: 4, fx: { armour: 1, maxHp: 3 }, slot: 'armour' },
  { no: 28, id: 'spiked_vambrace', name: 'Spiked Vambrace', tier: 1, cost: 4, fx: { thorns: 3 }, slot: 'thorns' },
  { no: 29, id: 'hunting_bow', name: 'Hunting Bow', tier: 1, cost: 5, fx: { atk: 2, firstStrike: true }, slot: 'atk', durability: 2, anim: 'arrow' },
  { no: 30, id: 'venom_flask', name: 'Venom Flask', tier: 1, cost: 5, fx: { poison: 3 }, slot: 'poison' },
  { no: 63, id: 'battle_drum', name: 'Battle Drum', tier: 1, cost: 5, fx: { rally: 3 }, slot: 'rally' },

  // ---- Tier 2 ----
  { no: 31, id: 'chainmail', name: 'Chainmail', tier: 2, cost: 8, fx: { armour: 2, maxHp: 6 }, slot: 'armour' },
  { no: 32, id: 'tower_shield', name: 'Tower Shield', tier: 2, cost: 9, fx: { armour: 3 }, slot: 'armour' },
  { no: 33, id: 'steel_longsword', name: 'Steel Longsword', tier: 2, cost: 9, fx: { atk: 6 }, slot: 'atk', durability: 4, anim: 'slash' },
  { no: 34, id: 'assassins_kris', name: "Assassin's Kris", tier: 2, cost: 10, fx: { atk: 4, firstStrike: true, poison: 3 }, slot: 'atk', durability: 3, anim: 'stab' },
  { no: 35, id: 'warhorn', name: 'Warhorn', tier: 2, cost: 10, fx: { rally: 3 }, slot: 'rally' },
  { no: 36, id: 'serrated_axe', name: 'Serrated Axe', tier: 2, cost: 11, fx: { atk: 5, thorns: 3 }, slot: 'atk', durability: 3, anim: 'chop' },

  // ---- Tier 3 ----
  { no: 37, id: 'basilisk_fang', name: 'Basilisk Fang', tier: 3, cost: 16, fx: { atk: 5, poison: 7 }, slot: 'atk', durability: 3, anim: 'stab' },
  { no: 38, id: 'dragonplate', name: 'Dragonplate', tier: 3, cost: 17, fx: { armour: 5, maxHp: 10 }, slot: 'armour' },
  { no: 39, id: 'runed_greatsword', name: 'Runed Greatsword', tier: 3, cost: 18, fx: { atk: 11 }, slot: 'atk', durability: 6, anim: 'slash' },
  { no: 40, id: 'banner_of_the_vanguard', name: 'Banner of the Vanguard', tier: 3, cost: 20, fx: { rally: 8 }, slot: 'rally' },
  { no: 41, id: 'executioners_blade', name: "Executioner's Blade", tier: 3, cost: 22, fx: { atk: 9, firstStrike: true }, slot: 'atk', durability: 5, anim: 'chop' },

  // Poison and Thorns used to exist only as Tier 1 gear (Venom Flask, Spiked
  // Vambrace) plus a couple of weapons that happen to carry them. That left a
  // player who wanted to *keep* building either keyword past round 3 with
  // nothing to buy — the archetype was reachable early and then quietly
  // stranded. These four are the missing rungs.
  { no: 59, id: 'plague_censer', name: 'Plague Censer', tier: 2, cost: 9, fx: { poison: 4 }, slot: 'poison' },
  { no: 60, id: 'barbed_cuirass', name: 'Barbed Cuirass', tier: 2, cost: 10, fx: { armour: 1, thorns: 4 }, slot: 'thorns' },
  { no: 61, id: 'wyrmvenom_vial', name: 'Wyrmvenom Vial', tier: 3, cost: 16, fx: { poison: 8 }, slot: 'poison' },
  { no: 62, id: 'bramble_aegis', name: 'Bramble Aegis', tier: 3, cost: 18, fx: { armour: 3, thorns: 5 }, slot: 'thorns' },

  // A second, deeper rank of equipment. With a deck to build (see js/deck.js)
  // a shallow pool means every deck looks the same, so each tier needs enough
  // gear that choosing ten of them is a real decision — and enough *hybrid*
  // gear that a build can commit to two keywords at once rather than picking
  // one and topping up with raw ATK.
  { no: 80, id: 'iron_cap', name: 'Iron Cap', tier: 1, cost: 2, fx: { armour: 1, maxHp: 1 }, slot: 'armour' },
  { no: 81, id: 'leather_gloves', name: 'Leather Gloves', tier: 1, cost: 2, fx: { thorns: 2 }, slot: 'thorns' },
  { no: 82, id: 'hunting_knife', name: 'Hunting Knife', tier: 1, cost: 3, fx: { atk: 2 }, slot: 'atk', durability: 2, anim: 'stab' },
  { no: 83, id: 'sling', name: 'Sling', tier: 1, cost: 3, fx: { atk: 1, firstStrike: true }, slot: 'atk', durability: 1, anim: 'arrow' },

  { no: 84, id: 'kite_shield', name: 'Kite Shield', tier: 2, cost: 8, fx: { armour: 2, thorns: 1 }, slot: 'armour' },
  { no: 85, id: 'war_pick', name: 'War Pick', tier: 2, cost: 9, fx: { atk: 5 }, slot: 'atk', durability: 3, anim: 'stab' },
  { no: 86, id: 'scale_hauberk', name: 'Scale Hauberk', tier: 2, cost: 9, fx: { armour: 2, maxHp: 5 }, slot: 'armour' },
  { no: 87, id: 'twin_daggers', name: 'Twin Daggers', tier: 2, cost: 10, fx: { atk: 4, firstStrike: true }, slot: 'atk', durability: 3, anim: 'stab' },
  { no: 88, id: 'coated_blade', name: 'Coated Blade', tier: 2, cost: 11, fx: { atk: 3, poison: 4 }, slot: 'atk', durability: 2, anim: 'slash' },
  { no: 89, id: 'rally_standard', name: 'Rally Standard', tier: 2, cost: 11, fx: { rally: 2, maxHp: 5 }, slot: 'rally' },

  { no: 90, id: 'titan_maul', name: 'Titan Maul', tier: 3, cost: 21, fx: { atk: 12 }, slot: 'atk', durability: 7, anim: 'smash' },
  { no: 91, id: 'wyrmfang_spear', name: 'Wyrmfang Spear', tier: 3, cost: 17, fx: { atk: 7, poison: 4 }, slot: 'atk', durability: 4, anim: 'stab' },
  { no: 92, id: 'berserkers_axe', name: "Berserker's Axe", tier: 3, cost: 19, fx: { atk: 8, rally: 4 }, slot: 'atk', durability: 5, anim: 'chop' },
  { no: 93, id: 'shadowsteel_blade', name: 'Shadowsteel Blade', tier: 3, cost: 20, fx: { atk: 8, firstStrike: true, poison: 3 }, slot: 'atk', durability: 5, anim: 'slash' },
  { no: 94, id: 'aegis_of_dawn', name: 'Aegis of Dawn', tier: 3, cost: 19, fx: { armour: 4, maxHp: 8, thorns: 2 }, slot: 'armour' },
  { no: 95, id: 'crown_of_command', name: 'Crown of Command', tier: 3, cost: 18, fx: { rally: 5, maxHp: 6 }, slot: 'rally' },
  { no: 96, id: 'reaver_plate', name: 'Reaver Plate', tier: 3, cost: 20, fx: { armour: 4, atk: 3 }, slot: 'armour' },

  // ---- Cards that read the character you've been building -----------------
  //
  // Everything above is a flat stat stick: it gives the same number in every
  // deck, on every day, to every player. That's why a path of four of them is
  // four unrelated numbers rather than a build. These pay off *in proportion
  // to what you've already committed to*, which is what makes a keyword a
  // direction worth going in rather than a label.
  //
  // They deliberately convert one investment into a *different* axis rather
  // than compounding a stat into itself. Poison that doubles Poison spirals
  // out of the game's own maths in two buys; Thorns paid out of Armour makes
  // the Armour you bought mean something new without ever running away.
  { no: 107, id: 'bramblelord', name: 'Bramblelord', tier: 2, cost: 10,
    dyn: (ctx) => ({ thorns: ctx.kw.armour }), slot: 'thorns',
    text: 'Thorns equal to your Armour.' },
  { no: 108, id: 'wardens_oath', name: "Warden's Oath", tier: 2, cost: 10,
    dyn: (ctx) => ({ armour: Math.ceil(ctx.kw.thorns / 2) }), slot: 'armour',
    text: 'Armour equal to half your Thorns, rounded up.' },
  { no: 109, id: 'toxinsmith', name: 'Toxinsmith', tier: 2, cost: 9,
    dyn: (ctx) => ({ poison: 1 + itemsWith(ctx.gear, 'poison') }), slot: 'poison',
    text: 'Poison 1, and 1 more for each Poison item you carry.' },
  { no: 110, id: 'ironblood_rite', name: 'Ironblood Rite', tier: 3, cost: 12,
    dyn: (ctx) => ({ maxHp: ctx.kw.armour, heal: ctx.kw.armour }),
    text: '+1 max HP and heal 1 for each point of Armour you have.' },

  // ---- The weapon you carry -----------------------------------------------
  //
  // A weapon was previously interchangeable: every one you bought added its
  // ATK and the panel drew whichever was biggest, so "trading up to a great
  // blade" was arithmetic, not an arc. These three read the weapon actually in
  // your hand, so committing to one and making it enormous is a real strategy
  // with a real payoff — and carrying one great weapon beats hoarding four
  // mediocre ones.
  { no: 111, id: 'grindstone', name: 'Grindstone', tier: 1, cost: 3,
    dyn: (ctx) => ({ atk: weaponAtk(ctx.gear, ctx.durability) > 0 ? 4 : 2 }),
    text: '+2 ATK, or +4 instead if you are carrying a weapon.' },
  // Deliberately not a weapon itself. A weapon whose ATK is dynamic has no
  // printed number for `weaponAtk()` to read, so if it ever won the weapon
  // slot it would silently zero out every card that pays off the blade you're
  // holding. A trainer who makes your whole arsenal count sidesteps that and
  // reads better anyway.
  // Capped at 3 weapons' worth. Uncapped, this directly rewarded hoarding
  // every cheap weapon a themed deck could draw — including ones handed over
  // free as monster drops — which is the opposite of "carry one great weapon"
  // and had no ceiling: a maxed-out Aggro run reached ATK nearly triple a
  // ghost's own band from this card alone. A small bonus for a broad arsenal
  // is still the idea; it just can't be the run's main ATK source on its own.
  { no: 112, id: 'armsmaster', name: 'Armsmaster', tier: 2, cost: 8,
    dyn: (ctx) => ({ atk: 2 + 2 * Math.min(3, weaponCount(ctx.gear, ctx.durability)) }),
    text: '+2 ATK, and 2 more per weapon you own (up to 3).' },
  // Was a straight 1:1 copy of your weapon's ATK — on top of already wearing
  // that weapon, that's doubling your single biggest number, and doubling
  // compounds badly with everything else a weapon-arc build stacks on. Halved
  // to match the discount every other cross-stat payoff in the pool runs at
  // (Warden's Oath pays Armour at half Thorns, rounded up) — still a real
  // reward for carrying something enormous, not a second copy of it.
  { no: 113, id: 'masters_forge', name: "Master's Forge", tier: 3, cost: 14,
    dyn: (ctx) => ({ atk: Math.ceil(weaponAtk(ctx.gear, ctx.durability) / 2) }),
    text: 'ATK equal to half the weapon you are carrying, rounded up.' },

  // Reckless Thirst is one card of a five-card batch (the other four are in
  // PLACES below) giving the pool routes to playstyles no existing keyword
  // covers — deliberately not a sixth keyword axis. A new stat axis needs
  // its own resolveCombat support, its own ghost archetype, its own
  // equip-panel slot and its own re-pacing of every TARGETS band (see
  // README's "Weapon durability capped the ceiling" section for what that
  // cost, once); these five are built entirely from primitives — dyn(),
  // ctx.gold/hp/monstersDefeated/left — the pool already had. A fighter who
  // has taken real damage this run swings harder for it: the wound is the
  // resource, not something to avoid.
  { no: 120, id: 'reckless_thirst', name: 'Reckless Thirst', tier: 3, cost: 14,
    dyn: (ctx) => ({ atk: Math.floor((ctx.maxHp - ctx.hp) / 3) }),
    text: 'ATK equal to a third of the damage you have taken this run, rounded down.' },

  // ---- Cursed gear -----------------------------------------------------
  //
  // Everything above costs gold. These cost something that isn't gold — max
  // HP, permanently — for real ATK. A curse read purely on its own number is
  // a trap; read against the rest of a build ("I'm already stacking HP, I
  // can afford this" vs "I'm at 20 max HP and about to fight a Tier 3") it's
  // a real decision with a real wrong answer, which flat stat sticks never
  // are. max HP is floored at 4 (see applyFx in js/engine.js) so no
  // combination of these can ever push a character to zero or below.
  //
  // First pass gave roughly double a normal card's ATK per gold, on the
  // theory that the max HP cost was the balancing force. It wasn't: in this
  // combat model a duel that ends two exchanges sooner from extra ATK saves
  // more total damage than the max HP it cost, so the "trade" was a strict
  // upgrade rather than a real one — an Aggro-leaning sweep measured its
  // completion rate *nearly double* just from carrying these, round-5 max HP
  // crashing to 12 and winning anyway. Retuned so the ATK side costs more
  // max HP than it's worth on a naive trade, which is what makes "can my
  // build actually afford this" a real question instead of a formality.
  { no: 125, id: 'berserkers_pact', name: "Berserker's Pact", tier: 1, cost: 3,
    fx: { atk: 3, maxHp: -5 }, curse: true,
    text: '+3 ATK. −5 max HP, permanently.' },
  { no: 127, id: 'reckless_charge', name: 'Reckless Charge', tier: 2, cost: 9,
    fx: { atk: 5, maxHp: -8 }, curse: true,
    text: '+5 ATK. −8 max HP, permanently.' },
  { no: 129, id: 'glass_cannon', name: 'Glass Cannon', tier: 3, cost: 16,
    fx: { atk: 8, maxHp: -12 }, curse: true,
    text: '+8 ATK. −12 max HP, permanently.' },

  // ---- Item sets ---------------------------------------------------------
  //
  // Everything above pays off in proportion to *a stat you already have*.
  // A set instead pays off for a *specific other card* — the second half of
  // the pair reads `ctx.gear` for the first half's id and adds a bonus on
  // top of its own effect if it's there. That's a different kind of
  // decision: not "how far do I lean into Poison" but "do I have the other
  // half of this, or am I one card away from a pair that isn't coming."
  // Deliberately never the *weapon* half of a pair carrying the dyn() — a
  // weapon's own fx.atk has to stay a printed number for weaponAtk() to
  // read (see the note on Grindstone above); the bonus always sits on the
  // non-weapon half instead.
  { no: 130, id: 'venomfang_dagger', name: 'Venomfang Dagger', tier: 2, cost: 10,
    fx: { atk: 3, poison: 3 }, slot: 'atk', durability: 3, anim: 'stab' },
  { no: 131, id: 'serpent_scale_mail', name: 'Serpent Scale Mail', tier: 2, cost: 10,
    dyn: (ctx) => ({ armour: 2, maxHp: 3, poison: ctx.gear.includes('venomfang_dagger') ? 2 : 0 }),
    slot: 'armour',
    text: 'Armour 2, +3 max HP. +2 more Poison if you also carry a Venomfang Dagger.' },
  { no: 132, id: 'vanguards_edge', name: "Vanguard's Edge", tier: 2, cost: 11,
    fx: { atk: 6 }, slot: 'atk', durability: 4, anim: 'slash' },
  { no: 133, id: 'vanguards_banner', name: "Vanguard's Banner", tier: 2, cost: 10,
    dyn: (ctx) => ({ rally: 3, atk: ctx.gear.includes('vanguards_edge') ? 3 : 0 }),
    slot: 'rally',
    text: 'Rally 3. +3 more ATK if you also carry a Vanguard\'s Edge.' },
  { no: 134, id: 'sentinel_plate', name: 'Sentinel Plate', tier: 3, cost: 18,
    fx: { armour: 4, maxHp: 6 }, slot: 'armour' },
  { no: 135, id: 'sentinel_spikes', name: 'Sentinel Spikes', tier: 3, cost: 17,
    dyn: (ctx) => ({ thorns: 4, armour: ctx.gear.includes('sentinel_plate') ? 3 : 0 }),
    slot: 'thorns',
    text: 'Thorns 4. +3 more Armour if you also carry Sentinel Plate.' },
].map((g) => ({ ...g, type: 'gear' }));

// Allies are permanent like gear, but their value is conditional or recurring.
// `perk` marks the ones the engine has to remember and re-apply later:
//   healPerKill   heal after every monster defeated, for the rest of the run
//   roundStart    stat deltas applied at the top of every future round
//   gearDiscount  gold knocked off every gear card (floored at 1)
//   cleanPathArmour  bonus Armour in the duel if the path cost you no HP
export const ALLIES = [
  { no: 42, id: 'torchbearer', name: 'Torchbearer', tier: 1, cost: 3,
    perk: { healPerKill: 2 }, text: 'After each monster you defeat, heal 2.' },
  { no: 43, id: 'coin_clipper', name: 'Coin Clipper', tier: 1, cost: 4,
    perk: { roundStart: { gold: 2 } }, text: '+2 gold at the start of each future round.' },
  { no: 44, id: 'sparring_partner', name: 'Sparring Partner', tier: 1, cost: 5,
    perk: { roundStart: { atk: 1 } }, text: '+1 ATK at the start of each future round.' },
  { no: 45, id: 'field_medic', name: 'Field Medic', tier: 1, cost: 6, fx: { heal: 5 },
    perk: { roundStart: { heal: 3 } }, text: 'Heal 5 now. Heal 3 at the start of each future round.' },
  { no: 46, id: 'shieldbearer', name: 'Shieldbearer', tier: 2, cost: 8, fx: { armour: 1 }, slot: 'armour',
    perk: { cleanPathArmour: 2 }, text: 'Armour 1. Before each duel, +2 Armour if you took no path damage that round.' },
  { no: 47, id: 'houndmaster', name: 'Houndmaster', tier: 2, cost: 9, fx: { firstStrike: true }, slot: 'firstStrike',
    text: 'Your first attack in every fight gains First Strike.' },
  { no: 48, id: 'quartermaster', name: 'Quartermaster', tier: 2, cost: 12,
    perk: { gearDiscount: 3 }, text: 'Gear costs 3 less (minimum 1).' },
  // A recurring roundStart perk needs at least one future day to ever pay
  // off — and Tier 3 only unlocks on day five, the run's last day, where it
  // pays off nothing at all. These four were originally Tier 3 and were
  // genuinely worthless there once hands got tighter and every gold coin had
  // to earn its keep; Tier 2 (days 3-5) gives the recurring ones one or two
  // real future days to compound into.
  { no: 49, id: 'banner_squire', name: 'Banner Squire', tier: 2, cost: 11, fx: { rally: 3 }, slot: 'rally',
    perk: { roundStart: { rally: 1 } }, text: 'Rally 3. +1 Rally at the start of each future day.' },
  { no: 98, id: 'venom_alchemist', name: 'Venom Alchemist', tier: 2, cost: 10, fx: { poison: 3 }, slot: 'poison',
    perk: { roundStart: { poison: 1 } }, text: 'Poison 3. +1 Poison at the start of each future day.' },
  { no: 99, id: 'war_priest', name: 'War Priest', tier: 2, cost: 10, fx: { heal: 8 },
    perk: { roundStart: { heal: 4 } }, text: 'Heal 8 now. Heal 4 at the start of each future day.' },
  { no: 100, id: 'master_smith', name: 'Master Smith', tier: 2, cost: 11,
    perk: { roundStart: { atk: 1 } }, text: '+1 ATK at the start of each future day.' },

  { no: 97, id: 'scout', name: 'Scout', tier: 1, cost: 3, fx: { gold: 1 }, scout: true,
    text: "Reveal your rival's secrets this day. +1 gold." },
  // Shield Maiden's problem wasn't timing, it was value: Armour 2 for 14 gold
  // at Tier 3 loses outright to a Tier 2 Tower Shield (Armour 3 for 9). Kept
  // at Tier 3 but strengthened to actually compete there.
  { no: 101, id: 'shield_maiden', name: 'Shield Maiden', tier: 3, cost: 11, fx: { armour: 4 }, slot: 'armour',
    perk: { cleanPathArmour: 3 }, text: 'Armour 4. Before each duel, +3 Armour if you took no path damage.' },
].map((a) => ({ ...a, type: 'ally' }));

// Places are free to enter. Two of them (`option`) offer a paid upgrade the
// player arms during planning, so the choice is made with the whole path in
// view rather than mid-animation.
export const PLACES = [
  { no: 50, id: 'roadside_shrine', name: 'Roadside Shrine', tier: 1, cost: 0, fx: { heal: 6 }, text: 'Heal 6.' },
  { no: 51, id: 'market_square', name: 'Market Square', tier: 1, cost: 0, fx: { gold: 5 }, text: '+5 gold.' },
  { no: 52, id: 'blacksmith', name: 'Blacksmith', tier: 1, cost: 0, fx: { atk: 2 },
    option: { cost: 4, label: 'Pay 4 for +3 ATK', fx: { atk: 3 } },
    text: '+2 ATK. May pay 4 gold for +3 more ATK.' },
  { no: 53, id: 'training_yard', name: 'Training Yard', tier: 1, cost: 0,
    dyn: (ctx) => ({ atk: ctx.monstersDefeated }),
    text: '+1 ATK for each monster defeated earlier this path.' },
  { no: 54, id: 'boneyard', name: 'Boneyard', tier: 1, cost: 0,
    dyn: (ctx) => ({ gold: 3 * ctx.monstersDefeated }),
    text: '+3 gold for each monster defeated earlier this path.' },
  { no: 55, id: 'watchtower', name: 'Watchtower', tier: 2, cost: 0, fx: { gold: 3 }, scout: true,
    text: "Reveal this round's opponent's HP and ATK. +3 gold." },
  { no: 56, id: 'ruined_chapel', name: 'Ruined Chapel', tier: 2, cost: 0, fx: { healFull: true, atk: -2 },
    text: 'Heal to full. −2 ATK.' },
  // Used to be worth literally nothing if you didn't arm the upgrade, which
  // made it the one card in the pool that could eat a path slot and give
  // back zero — a trap rather than a decision, and it read as one in play.
  // The floor is small enough that paying is still clearly the point.
  { no: 57, id: 'toll_bridge', name: 'Toll Bridge', tier: 2, cost: 0,
    fx: { maxHp: 2 },
    option: { cost: 5, label: 'Pay 5 for +6 max HP', fx: { maxHp: 6, heal: 8 } },
    text: '+2 max HP. May pay 5 gold for +6 more max HP and heal 8.' },
  { no: 58, id: 'standing_stones', name: 'Standing Stones', tier: 3, cost: 0,
    dyn: (ctx) => (ctx.slot === 3 ? { maxHp: 4, atk: 2 } : { maxHp: 2, atk: 1 }),
    text: '+2 max HP and +1 ATK. Doubled if this is your fourth slot.' },

  { no: 102, id: 'hidden_cache', name: 'Hidden Cache', tier: 2, cost: 0, fx: { gold: 8 }, text: '+8 gold.' },
  { no: 103, id: 'the_arena', name: 'The Arena', tier: 2, cost: 0,
    dyn: (ctx) => ({ atk: ctx.monstersDefeated * 2 }),
    text: '+2 ATK for each monster defeated earlier this path.' },
  { no: 104, id: 'sacred_spring', name: 'Sacred Spring', tier: 3, cost: 0, fx: { healFull: true, maxHp: 5 },
    text: '+5 max HP, then heal to full.' },
  { no: 105, id: 'war_camp', name: 'War Camp', tier: 3, cost: 0, fx: { atk: 3, armour: 1 },
    text: '+3 ATK and Armour 1.' },
  { no: 106, id: 'dragon_altar', name: 'Dragon Altar', tier: 3, cost: 0,
    option: { cost: 8, label: 'Pay 8 for Rally 2', fx: { rally: 2 } },
    fx: { atk: 2 }, text: '+2 ATK. May pay 8 gold for Rally 2.' },

  // ---- Cards that read their neighbours in the path ------------------------
  //
  // The path resolves left to right, but until now that order only ever
  // decided what you could *afford* — sequencing was an accounting problem.
  // These make a slot's value depend on what sits beside it, so laying out a
  // path becomes a puzzle with a right answer worth finding: the same four
  // cards can be worth noticeably more in a different order.
  //
  // Neighbours are read from where cards were placed rather than from what
  // survived resolving, so the payoff is visible while you're still planning
  // instead of being a surprise at the end.
  { no: 114, id: 'flanking_strike', name: 'Flanking Strike', tier: 1, cost: 0,
    dyn: (ctx) => ({ atk: 2 + (ctx.left?.type === 'monster' ? 3 : 0) }),
    text: '+2 ATK. +3 more if the card to its left is a monster.' },
  { no: 115, id: 'scavengers_cache', name: "Scavenger's Cache", tier: 1, cost: 0,
    dyn: (ctx) => ({ gold: 3 + (ctx.left?.type === 'monster' ? 5 : 0) }),
    text: '+3 gold. +5 more if the card to its left is a monster.' },
  { no: 116, id: 'ambushers_nook', name: "Ambusher's Nook", tier: 2, cost: 0,
    dyn: (ctx) => ({ thorns: 3 + (ctx.right?.type === 'monster' ? 4 : 0) }),
    text: 'Thorns 3. Thorns 4 more if the card to its right is a monster.' },
  { no: 117, id: 'ritual_circle', name: 'Ritual Circle', tier: 2, cost: 0,
    dyn: (ctx) => {
      const flanked = ctx.left?.type === 'place' && ctx.right?.type === 'place';
      return flanked ? { atk: 4, maxHp: 4 } : { atk: 2, maxHp: 2 };
    },
    text: '+2 ATK and +2 max HP. Doubled if both neighbours are places.' },

  // A comeback card: the only thing in the pool that pays you for losing. A
  // five-day series you're down 0–2 in is otherwise a formality you have to
  // sit through, and that's the worst state a run can be in. This makes the
  // back foot a place you can actually fight from.
  { no: 118, id: 'berserkers_rite', name: "Berserker's Rite", tier: 2, cost: 0,
    dyn: (ctx) => ({ atk: 3 * ctx.heartsLost }),
    text: '+3 ATK for each heart you have lost.' },
  { no: 119, id: 'bloodforge', name: 'Bloodforge', tier: 3, cost: 0,
    dyn: (ctx) => ({ atk: Math.floor(Math.max(0, ctx.maxHp - 20) / 4) }),
    text: '+1 ATK for every 4 max HP you have above 20.' },

  // The other four cards of the batch described above Reckless Thirst in
  // GEAR — a rogue who reads wealth as power, a hunter who reads the tier of
  // what they killed, and a caster who reads the board itself.
  { no: 121, id: 'gilded_edge', name: 'Gilded Edge', tier: 2, cost: 0,
    dyn: (ctx) => ({ atk: Math.min(6, Math.floor(ctx.gold / 4)) }),
    text: '+1 ATK for every 4 gold you are holding, up to +6.' },
  { no: 122, id: 'vein_drain', name: 'Vein Drain', tier: 2, cost: 0,
    dyn: (ctx) => ({ heal: 2 + 3 * ctx.monstersDefeated, maxHp: ctx.monstersDefeated }),
    text: 'Heal 2, plus 3 more and +1 max HP for each monster defeated earlier this path.' },
  { no: 123, id: 'marked_quarry', name: 'Marked Quarry', tier: 1, cost: 0,
    dyn: (ctx) => ({ atk: 1 + (ctx.left?.type === 'monster' ? ctx.left.tier * 2 : 0) }),
    text: '+1 ATK. +2 more per tier of the monster to its left.' },
  { no: 124, id: 'arcane_surge', name: 'Arcane Surge', tier: 2, cost: 0,
    dyn: (ctx) => ({ atk: 1 + (ctx.usedWatchtower ? 3 : 0) + (ctx.slot === 3 ? 2 : 0) }),
    text: '+1 ATK. +3 more if you scouted with Watchtower this round. +2 more if this is your fourth slot.' },

  // The other shape a curse takes: ATK for max HP, instead of max HP for
  // ATK — the same trade, read from the opposite side of a build. See the
  // note on the cursed gear in the GEAR array above.
  { no: 126, id: 'hollow_vigor', name: 'Hollow Vigor', tier: 1, cost: 0,
    fx: { maxHp: 6, heal: 6, atk: -2 }, curse: true,
    text: '+6 max HP, heal 6. −2 ATK, permanently.' },
  { no: 128, id: 'wither', name: 'Wither', tier: 2, cost: 0,
    fx: { atk: 4, gold: 5, maxHp: -6 }, curse: true,
    text: '+4 ATK, +5 gold. −6 max HP, permanently.' },
].map((p) => ({ ...p, type: 'place' }));

// Secrets are the one card type that reaches across the table. A secret is
// laid during planning, costs a path slot like anything else, and fires at the
// start of the duel — stripping something specific off your rival for that
// fight only.
//
// They are deliberately *counters*, not generic debuffs: `counter` names the
// exact stat it takes away, so a secret is only worth its slot if you've read
// what your rival actually brings. Caltrops against a Tank is nearly wasted;
// against an Aggro rival it's the difference in the fight. That read is the
// whole point — it's what turns "here is my rival's build" from a readout into
// a decision.
//
// Nothing here touches the stored snapshot. A secret applies inside one fight,
// to your copy of the rival, the same way a real player's secret would apply
// to their copy of yours.
export const SECRETS = [
  // ---- Tier 1 ----
  { no: 64, id: 'caltrops', name: 'Caltrops', tier: 1, cost: 1, counter: { atk: 2 } },
  { no: 65, id: 'rust_powder', name: 'Rust Powder', tier: 1, cost: 1, counter: { armour: 2 } },
  { no: 66, id: 'snare_wire', name: 'Snare Wire', tier: 1, cost: 1, counter: { firstStrike: true } },

  // ---- Tier 2 ----
  { no: 67, id: 'antidote_draught', name: 'Antidote Draught', tier: 2, cost: 1, counter: { poison: 3 } },
  { no: 68, id: 'dousing_rain', name: 'Dousing Rain', tier: 2, cost: 1, counter: { rally: 2 } },
  { no: 69, id: 'barb_file', name: 'Barb File', tier: 2, cost: 1, counter: { thorns: 3 } },
  { no: 70, id: 'hamstring', name: 'Hamstring', tier: 2, cost: 3, counter: { atk: 5 } },

  // ---- Tier 3 ----
  { no: 71, id: 'ambush_pit', name: 'Ambush Pit', tier: 3, cost: 3, counter: { maxHp: 10 } },
  { no: 72, id: 'purge_ritual', name: 'Purge Ritual', tier: 3, cost: 2, counter: { poison: 6, rally: 3 } },
  { no: 73, id: 'sabotage', name: 'Sabotage', tier: 3, cost: 5, counter: { atk: 7, armour: 3 } },
].map((s) => ({ ...s, type: 'secret' }));

/** Everything a hand can be dealt from — the whole pool, since there's no
 *  Spoils tier held back for monster drops. */
export const DEAL_POOL = [...MONSTERS, ...GEAR, ...ALLIES, ...PLACES, ...SECRETS];

export const ALL_CARDS = DEAL_POOL;

const BY_ID = new Map(ALL_CARDS.map((c) => [c.id, c]));

/** @returns {object} the card definition, or undefined for an unknown id. */
export const card = (id) => BY_ID.get(id);

/**
 * Human-readable effect line. Monsters and cards with hand-written `text` use
 * theirs; everything else is generated from `fx` so the two can never drift.
 */
export function cardText(c) {
  if (c.text) return c.text;
  if (c.type === 'monster') {
    const parts = [`+${c.gold} gold`];
    if (c.trophy) parts.push(fxText(c.trophy));
    if (c.drop) parts.push(`take ${card(c.drop)?.name ?? c.drop}`);
    return parts.join(', ');
  }
  if (c.type === 'secret') return `Your rival: ${counterText(c.counter)}.`;
  return fxText(c.fx || {});
}

/** What a secret strips, in the rival's terms. */
export function counterText(k = {}) {
  const parts = [];
  if (k.atk) parts.push(`−${k.atk} ATK`);
  if (k.maxHp) parts.push(`−${k.maxHp} max HP`);
  if (k.armour) parts.push(`−${k.armour} Armour`);
  if (k.thorns) parts.push(`−${k.thorns} Thorns`);
  if (k.poison) parts.push(`−${k.poison} Poison`);
  if (k.rally) parts.push(`−${k.rally} Rally`);
  if (k.firstStrike) parts.push('loses First Strike');
  return parts.join(', ') || 'unchanged';
}

export function fxText(fx) {
  const parts = [];
  if (fx.atk) parts.push(`${fx.atk > 0 ? '+' : '−'}${Math.abs(fx.atk)} ATK`);
  if (fx.maxHp) parts.push(`${fx.maxHp > 0 ? '+' : '−'}${Math.abs(fx.maxHp)} max HP`);
  if (fx.healFull) parts.push('heal to full');
  else if (fx.heal) parts.push(`heal ${fx.heal}`);
  if (fx.gold) parts.push(`+${fx.gold} gold`);
  if (fx.armour) parts.push(`Armour ${fx.armour}`);
  if (fx.thorns) parts.push(`Thorns ${fx.thorns}`);
  if (fx.poison) parts.push(`Poison ${fx.poison}`);
  if (fx.rally) parts.push(`Rally ${fx.rally}`);
  if (fx.firstStrike) parts.push('First Strike');
  return parts.join(', ') || '—';
}

// ---------------------------------------------------------------------------
// Worn equipment
// ---------------------------------------------------------------------------

/** Higher is "better gear" — used only to decide which item wins a slot. */
const rank = (c) => c.tier * 100 + (c.cost || 0);

/**
 * A weapon still counts as "held" only if it has durability left. Every other
 * slot (armour, poison, thorns, rally) never breaks, so this only matters for
 * `atk` — a broken weapon is worth exactly what an empty slot is worth: the
 * fist you're left swinging.
 *
 * @param {object} c
 * @param {Record<string, number>} durability id → uses remaining
 */
const isBroken = (c, durability) => c.slot === 'atk' && c.durability && (durability[c.id] ?? c.durability) <= 0;

/**
 * Resolves a list of owned card ids into the item actually shown in each
 * equipment slot. Better gear wins its slot outright, so buying a Runed
 * Greatsword visibly replaces the Rusty Sword you opened the run with — the
 * stats still stack for everything except ATK (that's the engine's business),
 * but you only ever *hold* one weapon. A weapon at 0 durability doesn't win
 * the slot at all, the same as if you'd never bought it.
 *
 * @param {string[]} ids
 * @param {Record<string, number>} [durability] id → uses remaining, weapons only
 * @returns {Record<string, object>} slot key → card
 */
export function equipment(ids = [], durability = {}) {
  const worn = {};
  for (const id of ids) {
    const c = card(id);
    if (!c || !c.slot || isBroken(c, durability)) continue;
    if (!worn[c.slot] || rank(c) > rank(worn[c.slot])) worn[c.slot] = c;
  }
  return worn;
}

/** The attack animation a fighter plays, taken from the weapon they hold. */
export function attackAnim(ids = [], durability = {}) {
  return equipment(ids, durability).atk?.anim || 'punch';
}

/**
 * The printed ATK of the weapon a fighter is actually holding — the one that
 * wins the `atk` slot and still has durability, not the sum of every weapon
 * they ever bought.
 *
 * This is what makes a weapon an *investment* rather than another stat stick.
 * Cards that read it pay off in proportion to the weapon you committed to, so
 * carrying one great blade beats carrying four mediocre ones, and the run-long
 * arc of trading up to something enormous has a payoff at the end of it. It's
 * also what the resolver itself adds to base ATK every fight — see
 * `playerFighter()` in engine.js — since a weapon's ATK was never a thing you
 * could bank and keep once it broke.
 */
export function weaponAtk(ids = [], durability = {}) {
  return equipment(ids, durability).atk?.fx?.atk || 0;
}

/** How many distinct, unbroken weapons a fighter currently owns. */
export function weaponCount(ids = [], durability = {}) {
  return new Set(ids.filter((id) => {
    const c = card(id);
    return c?.slot === 'atk' && !isBroken(c, durability);
  })).size;
}

/** How many owned cards carry a given keyword — "each Poison item you carry". */
export function itemsWith(ids = [], key) {
  return ids.filter((id) => card(id)?.fx?.[key]).length;
}

/**
 * Every owned card that actually contributes to one stat, individually —
 * "Armour 4" on its own says nothing about *why*; this is the answer. Used
 * by the equipment panel's tooltip so mousing over a slot shows exactly
 * which items are adding to it, not just the total.
 *
 * Only counts what's traceable to a specific card: base stats, monster
 * trophies, and recurring ally perks all feed the same total but aren't
 * card-shaped, so they're summarised as a single remainder line by the
 * caller rather than guessed at here.
 *
 * @param {string[]} ids
 * @param {string} key  'atk' | 'armour' | 'poison' | 'thorns' | 'rally' | 'firstStrike'
 * @returns {{id: string, name: string, amount: number|true}[]}
 */
export function contributionsFor(ids = [], key) {
  const out = [];
  for (const id of ids) {
    const c = card(id);
    // A weapon's own ATK isn't part of the flat stat total any more — it's
    // solved live from whichever weapon is currently held, durability and
    // all, and shown as its own line by the caller rather than folded in
    // here as if it were still a permanent purchase.
    if (key === 'atk' && c?.slot === 'atk') continue;
    const amount = c?.fx?.[key];
    if (amount) out.push({ id, name: c.name, amount });
  }
  return out.sort((a, b) => (b.amount === true ? 1 : b.amount) - (a.amount === true ? 1 : a.amount));
}

/** Keyword badges to draw on a card face. */
export function keywordBadges(kw = {}) {
  const out = [];
  if (kw.firstStrike) out.push({ k: 'first', label: 'First Strike' });
  if (kw.armour) out.push({ k: 'armour', label: `Armour ${kw.armour}` });
  if (kw.thorns) out.push({ k: 'thorns', label: `Thorns ${kw.thorns}` });
  if (kw.poison) out.push({ k: 'poison', label: `Poison ${kw.poison}` });
  if (kw.rally) out.push({ k: 'rally', label: `Rally ${kw.rally}` });
  return out;
}
