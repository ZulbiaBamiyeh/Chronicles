// The whole card pool: 58 cards that can be dealt to a hand.
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
// ctx passed to dyn():
//   { slot, slots, gold, monstersDefeated, usedWatchtower, paidUpgrade }
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
  { no: 11, id: 'marsh_wraith', name: 'Marsh Wraith', tier: 2, hp: 10, atk: 3, kw: { poison: 2 },
    gold: 8, trophy: { poison: 1 }, anim: 'magic' },
  { no: 12, id: 'bandit_captain', name: 'Bandit Captain', tier: 2, hp: 12, atk: 6, kw: {},
    gold: 6, drop: 'rusty_sword', anim: 'slash' },
  { no: 13, id: 'iron_golem', name: 'Iron Golem', tier: 2, hp: 16, atk: 4, kw: { armour: 3 },
    gold: 6, drop: 'tower_shield', anim: 'smash' },
  { no: 14, id: 'ogre_brute', name: 'Ogre Brute', tier: 2, hp: 18, atk: 7, kw: {},
    gold: 12, trophy: { maxHp: 3 }, anim: 'smash' },
  { no: 15, id: 'wyvern_hatchling', name: 'Wyvern Hatchling', tier: 2, hp: 11, atk: 5, kw: { firstStrike: true },
    gold: 9, trophy: { atk: 1 }, anim: 'fire' },
  { no: 16, id: 'thornback_boar', name: 'Thornback Boar', tier: 2, hp: 13, atk: 4, kw: { thorns: 2 },
    gold: 8, trophy: { thorns: 1 }, anim: 'stab' },

  // ---- Tier 3 ----
  { no: 17, id: 'hill_giant', name: 'Hill Giant', tier: 3, hp: 26, atk: 9, kw: {},
    gold: 16, trophy: { maxHp: 4 }, anim: 'smash' },
  { no: 18, id: 'basilisk', name: 'Basilisk', tier: 3, hp: 22, atk: 7, kw: { poison: 4 },
    gold: 9, drop: 'basilisk_fang', anim: 'bite' },
  { no: 19, id: 'stone_warden', name: 'Stone Warden', tier: 3, hp: 30, atk: 8, kw: { armour: 5 },
    gold: 18, trophy: { armour: 2 }, anim: 'smash' },
  { no: 20, id: 'chimera', name: 'Chimera', tier: 3, hp: 24, atk: 11, kw: { firstStrike: true },
    gold: 17, trophy: { atk: 2 }, anim: 'claw' },
  { no: 21, id: 'elder_wyrm', name: 'Elder Wyrm', tier: 3, hp: 32, atk: 10, kw: { rally: 2 },
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
  { no: 75, id: 'forest_troll', name: 'Forest Troll', tier: 2, hp: 15, atk: 5, kw: { thorns: 1 },
    gold: 6, drop: 'spiked_vambrace', anim: 'smash' },
  { no: 76, id: 'grave_knight', name: 'Grave Knight', tier: 2, hp: 17, atk: 6, kw: { armour: 2 },
    gold: 5, drop: 'steel_longsword', anim: 'slash' },
  { no: 77, id: 'bog_horror', name: 'Bog Horror', tier: 3, hp: 28, atk: 8, kw: { poison: 3 },
    gold: 12, trophy: { maxHp: 4 }, anim: 'lash' },
  { no: 78, id: 'frost_wraith', name: 'Frost Wraith', tier: 3, hp: 23, atk: 9, kw: { armour: 2 },
    gold: 9, drop: 'chainmail', anim: 'magic' },
  { no: 79, id: 'warlord_of_ash', name: 'Warlord of Ash', tier: 3, hp: 27, atk: 10, kw: { rally: 1 },
    gold: 8, drop: 'executioners_blade', anim: 'chop' },
].map((m) => ({ ...m, type: 'monster' }));

// `slot` is which equipment-panel slot a piece of gear fills when it's worn —
// the panel shows the real item you're carrying rather than a generic keyword
// icon, and the weapon you're holding is what picks your attack animation. A
// fighter with no weapon at all swings a fist.
export const GEAR = [
  // ---- Tier 1 ----
  { no: 23, id: 'whetstone', name: 'Whetstone', tier: 1, cost: 2, fx: { atk: 2 } },
  { no: 24, id: 'buckler', name: 'Buckler', tier: 1, cost: 3, fx: { armour: 1 }, slot: 'armour' },
  { no: 25, id: 'travellers_boots', name: "Traveller's Boots", tier: 1, cost: 3, fx: { maxHp: 4, heal: 4 } },
  { no: 26, id: 'rusty_sword', name: 'Rusty Sword', tier: 1, cost: 4, fx: { atk: 3 }, slot: 'atk', anim: 'slash' },
  { no: 27, id: 'leather_jerkin', name: 'Leather Jerkin', tier: 1, cost: 4, fx: { armour: 1, maxHp: 3 }, slot: 'armour' },
  { no: 28, id: 'spiked_vambrace', name: 'Spiked Vambrace', tier: 1, cost: 4, fx: { thorns: 2 }, slot: 'thorns' },
  { no: 29, id: 'hunting_bow', name: 'Hunting Bow', tier: 1, cost: 5, fx: { atk: 2, firstStrike: true }, slot: 'atk', anim: 'arrow' },
  { no: 30, id: 'venom_flask', name: 'Venom Flask', tier: 1, cost: 5, fx: { poison: 2 }, slot: 'poison' },
  { no: 63, id: 'battle_drum', name: 'Battle Drum', tier: 1, cost: 5, fx: { rally: 1 }, slot: 'rally' },

  // ---- Tier 2 ----
  { no: 31, id: 'chainmail', name: 'Chainmail', tier: 2, cost: 8, fx: { armour: 2, maxHp: 6 }, slot: 'armour' },
  { no: 32, id: 'tower_shield', name: 'Tower Shield', tier: 2, cost: 9, fx: { armour: 3 }, slot: 'armour' },
  { no: 33, id: 'steel_longsword', name: 'Steel Longsword', tier: 2, cost: 9, fx: { atk: 6 }, slot: 'atk', anim: 'slash' },
  { no: 34, id: 'assassins_kris', name: "Assassin's Kris", tier: 2, cost: 10, fx: { atk: 4, firstStrike: true, poison: 2 }, slot: 'atk', anim: 'stab' },
  { no: 35, id: 'warhorn', name: 'Warhorn', tier: 2, cost: 10, fx: { rally: 2 }, slot: 'rally' },
  { no: 36, id: 'serrated_axe', name: 'Serrated Axe', tier: 2, cost: 11, fx: { atk: 5, thorns: 3 }, slot: 'atk', anim: 'chop' },

  // ---- Tier 3 ----
  { no: 37, id: 'basilisk_fang', name: 'Basilisk Fang', tier: 3, cost: 16, fx: { atk: 5, poison: 5 }, slot: 'atk', anim: 'stab' },
  { no: 38, id: 'dragonplate', name: 'Dragonplate', tier: 3, cost: 17, fx: { armour: 5, maxHp: 10 }, slot: 'armour' },
  { no: 39, id: 'runed_greatsword', name: 'Runed Greatsword', tier: 3, cost: 18, fx: { atk: 11 }, slot: 'atk', anim: 'slash' },
  { no: 40, id: 'banner_of_the_vanguard', name: 'Banner of the Vanguard', tier: 3, cost: 20, fx: { rally: 4 }, slot: 'rally' },
  { no: 41, id: 'executioners_blade', name: "Executioner's Blade", tier: 3, cost: 22, fx: { atk: 9, firstStrike: true }, slot: 'atk', anim: 'chop' },

  // Poison and Thorns used to exist only as Tier 1 gear (Venom Flask, Spiked
  // Vambrace) plus a couple of weapons that happen to carry them. That left a
  // player who wanted to *keep* building either keyword past round 3 with
  // nothing to buy — the archetype was reachable early and then quietly
  // stranded. These four are the missing rungs.
  { no: 59, id: 'plague_censer', name: 'Plague Censer', tier: 2, cost: 9, fx: { poison: 3 }, slot: 'poison' },
  { no: 60, id: 'barbed_cuirass', name: 'Barbed Cuirass', tier: 2, cost: 10, fx: { armour: 1, thorns: 3 }, slot: 'thorns' },
  { no: 61, id: 'wyrmvenom_vial', name: 'Wyrmvenom Vial', tier: 3, cost: 16, fx: { poison: 6 }, slot: 'poison' },
  { no: 62, id: 'bramble_aegis', name: 'Bramble Aegis', tier: 3, cost: 18, fx: { armour: 3, thorns: 4 }, slot: 'thorns' },

  // A second, deeper rank of equipment. With a deck to build (see js/deck.js)
  // a shallow pool means every deck looks the same, so each tier needs enough
  // gear that choosing ten of them is a real decision — and enough *hybrid*
  // gear that a build can commit to two keywords at once rather than picking
  // one and topping up with raw ATK.
  { no: 80, id: 'iron_cap', name: 'Iron Cap', tier: 1, cost: 2, fx: { armour: 1, maxHp: 1 }, slot: 'armour' },
  { no: 81, id: 'leather_gloves', name: 'Leather Gloves', tier: 1, cost: 2, fx: { thorns: 1 }, slot: 'thorns' },
  { no: 82, id: 'hunting_knife', name: 'Hunting Knife', tier: 1, cost: 3, fx: { atk: 2 }, slot: 'atk', anim: 'stab' },
  { no: 83, id: 'sling', name: 'Sling', tier: 1, cost: 3, fx: { atk: 1, firstStrike: true }, slot: 'atk', anim: 'arrow' },

  { no: 84, id: 'kite_shield', name: 'Kite Shield', tier: 2, cost: 8, fx: { armour: 2, thorns: 1 }, slot: 'armour' },
  { no: 85, id: 'war_pick', name: 'War Pick', tier: 2, cost: 9, fx: { atk: 5 }, slot: 'atk', anim: 'stab' },
  { no: 86, id: 'scale_hauberk', name: 'Scale Hauberk', tier: 2, cost: 9, fx: { armour: 2, maxHp: 5 }, slot: 'armour' },
  { no: 87, id: 'twin_daggers', name: 'Twin Daggers', tier: 2, cost: 10, fx: { atk: 4, firstStrike: true }, slot: 'atk', anim: 'stab' },
  { no: 88, id: 'coated_blade', name: 'Coated Blade', tier: 2, cost: 11, fx: { atk: 3, poison: 3 }, slot: 'atk', anim: 'slash' },
  { no: 89, id: 'rally_standard', name: 'Rally Standard', tier: 2, cost: 11, fx: { rally: 1, maxHp: 5 }, slot: 'rally' },

  { no: 90, id: 'titan_maul', name: 'Titan Maul', tier: 3, cost: 21, fx: { atk: 12 }, slot: 'atk', anim: 'smash' },
  { no: 91, id: 'wyrmfang_spear', name: 'Wyrmfang Spear', tier: 3, cost: 17, fx: { atk: 7, poison: 3 }, slot: 'atk', anim: 'stab' },
  { no: 92, id: 'berserkers_axe', name: "Berserker's Axe", tier: 3, cost: 19, fx: { atk: 8, rally: 2 }, slot: 'atk', anim: 'chop' },
  { no: 93, id: 'shadowsteel_blade', name: 'Shadowsteel Blade', tier: 3, cost: 20, fx: { atk: 8, firstStrike: true, poison: 2 }, slot: 'atk', anim: 'slash' },
  { no: 94, id: 'aegis_of_dawn', name: 'Aegis of Dawn', tier: 3, cost: 19, fx: { armour: 4, maxHp: 8, thorns: 2 }, slot: 'armour' },
  { no: 95, id: 'crown_of_command', name: 'Crown of Command', tier: 3, cost: 18, fx: { rally: 3, maxHp: 6 }, slot: 'rally' },
  { no: 96, id: 'reaver_plate', name: 'Reaver Plate', tier: 3, cost: 20, fx: { armour: 4, atk: 3 }, slot: 'armour' },
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
  { no: 49, id: 'banner_squire', name: 'Banner Squire', tier: 2, cost: 11, fx: { rally: 1 }, slot: 'rally',
    perk: { roundStart: { rally: 1 } }, text: 'Rally 1. +1 Rally at the start of each future day.' },
  { no: 98, id: 'venom_alchemist', name: 'Venom Alchemist', tier: 2, cost: 10, fx: { poison: 2 }, slot: 'poison',
    perk: { roundStart: { poison: 1 } }, text: 'Poison 2. +1 Poison at the start of each future day.' },
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
  { no: 57, id: 'toll_bridge', name: 'Toll Bridge', tier: 2, cost: 0,
    option: { cost: 5, label: 'Pay 5 for +8 max HP', fx: { maxHp: 8, heal: 8 } },
    text: 'May pay 5 gold: +8 max HP and heal 8. Otherwise nothing.' },
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
  if (fx.maxHp) parts.push(`+${fx.maxHp} max HP`);
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
 * Resolves a list of owned card ids into the item actually shown in each
 * equipment slot. Better gear wins its slot outright, so buying a Runed
 * Greatsword visibly replaces the Rusty Sword you opened the run with — the
 * stats still stack (that's the engine's business), but you only ever *hold*
 * one weapon.
 *
 * @param {string[]} ids
 * @returns {Record<string, object>} slot key → card
 */
export function equipment(ids = []) {
  const worn = {};
  for (const id of ids) {
    const c = card(id);
    if (!c || !c.slot) continue;
    if (!worn[c.slot] || rank(c) > rank(worn[c.slot])) worn[c.slot] = c;
  }
  return worn;
}

/** The attack animation a fighter plays, taken from the weapon they hold. */
export function attackAnim(ids = []) {
  return equipment(ids).atk?.anim || 'punch';
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
