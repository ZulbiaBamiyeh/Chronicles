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
// The design doc's §7 Spoils-and-Stash system (named item drops from
// monsters, held until spent) is deliberately not implemented here — cut for
// this prototype pass so the fight itself could get the attention instead.
// See README.md.

/** @typedef {'monster'|'gear'|'ally'|'place'} CardType */

export const MONSTERS = [
  // ---- Tier 1 ----
  { no: 1, id: 'field_mouse', name: 'Field Mouse', tier: 1, hp: 2, atk: 1, kw: {}, gold: 2 },
  { no: 2, id: 'sewer_rat', name: 'Sewer Rat', tier: 1, hp: 3, atk: 1, kw: {}, gold: 3 },
  { no: 3, id: 'wild_boar', name: 'Wild Boar', tier: 1, hp: 5, atk: 2, kw: {}, gold: 4 },
  { no: 4, id: 'goblin_scrapper', name: 'Goblin Scrapper', tier: 1, hp: 4, atk: 2, kw: {},
    gold: 3, trophy: { atk: 1 } },
  { no: 5, id: 'giant_spider', name: 'Giant Spider', tier: 1, hp: 4, atk: 1, kw: { poison: 1 }, gold: 4 },
  { no: 6, id: 'bandit_lookout', name: 'Bandit Lookout', tier: 1, hp: 6, atk: 2, kw: {}, gold: 5 },
  { no: 7, id: 'bog_toad', name: 'Bog Toad', tier: 1, hp: 8, atk: 1, kw: {},
    gold: 4, trophy: { maxHp: 2 } },
  { no: 8, id: 'skeleton_picket', name: 'Skeleton Picket', tier: 1, hp: 5, atk: 3, kw: { armour: 1 }, gold: 6 },
  { no: 9, id: 'feral_hound', name: 'Feral Hound', tier: 1, hp: 3, atk: 2, kw: { firstStrike: true }, gold: 4 },

  // ---- Tier 2 ----
  { no: 10, id: 'cave_troll', name: 'Cave Troll', tier: 2, hp: 14, atk: 5, kw: {}, gold: 9 },
  { no: 11, id: 'marsh_wraith', name: 'Marsh Wraith', tier: 2, hp: 10, atk: 3, kw: { poison: 2 }, gold: 8 },
  { no: 12, id: 'bandit_captain', name: 'Bandit Captain', tier: 2, hp: 12, atk: 6, kw: {},
    gold: 10, trophy: { atk: 1 } },
  { no: 13, id: 'iron_golem', name: 'Iron Golem', tier: 2, hp: 16, atk: 4, kw: { armour: 3 }, gold: 11 },
  { no: 14, id: 'ogre_brute', name: 'Ogre Brute', tier: 2, hp: 18, atk: 7, kw: {},
    gold: 12, trophy: { maxHp: 3 } },
  { no: 15, id: 'wyvern_hatchling', name: 'Wyvern Hatchling', tier: 2, hp: 11, atk: 5, kw: { firstStrike: true }, gold: 9 },
  { no: 16, id: 'thornback_boar', name: 'Thornback Boar', tier: 2, hp: 13, atk: 4, kw: { thorns: 2 }, gold: 8 },

  // ---- Tier 3 ----
  { no: 17, id: 'hill_giant', name: 'Hill Giant', tier: 3, hp: 26, atk: 9, kw: {}, gold: 16 },
  { no: 18, id: 'basilisk', name: 'Basilisk', tier: 3, hp: 22, atk: 7, kw: { poison: 4 }, gold: 15 },
  { no: 19, id: 'stone_warden', name: 'Stone Warden', tier: 3, hp: 30, atk: 8, kw: { armour: 5 }, gold: 18 },
  { no: 20, id: 'chimera', name: 'Chimera', tier: 3, hp: 24, atk: 11, kw: { firstStrike: true }, gold: 17 },
  { no: 21, id: 'elder_wyrm', name: 'Elder Wyrm', tier: 3, hp: 32, atk: 10, kw: { rally: 2 },
    gold: 20, trophy: { atk: 2 } },
  { no: 22, id: 'flame_imp', name: 'Flame Imp', tier: 3, hp: 20, atk: 8, kw: {}, gold: 14 },
].map((m) => ({ ...m, type: 'monster' }));

export const GEAR = [
  // ---- Tier 1 ----
  { no: 23, id: 'whetstone', name: 'Whetstone', tier: 1, cost: 2, fx: { atk: 2 } },
  { no: 24, id: 'buckler', name: 'Buckler', tier: 1, cost: 3, fx: { armour: 1 } },
  { no: 25, id: 'travellers_boots', name: "Traveller's Boots", tier: 1, cost: 3, fx: { maxHp: 4, heal: 4 } },
  { no: 26, id: 'rusty_sword', name: 'Rusty Sword', tier: 1, cost: 4, fx: { atk: 3 } },
  { no: 27, id: 'leather_jerkin', name: 'Leather Jerkin', tier: 1, cost: 4, fx: { armour: 1, maxHp: 3 } },
  { no: 28, id: 'spiked_vambrace', name: 'Spiked Vambrace', tier: 1, cost: 4, fx: { thorns: 2 } },
  { no: 29, id: 'hunting_bow', name: 'Hunting Bow', tier: 1, cost: 5, fx: { atk: 2, firstStrike: true } },
  { no: 30, id: 'venom_flask', name: 'Venom Flask', tier: 1, cost: 5, fx: { poison: 2 } },

  // ---- Tier 2 ----
  { no: 31, id: 'chainmail', name: 'Chainmail', tier: 2, cost: 8, fx: { armour: 2, maxHp: 6 } },
  { no: 32, id: 'tower_shield', name: 'Tower Shield', tier: 2, cost: 9, fx: { armour: 3 } },
  { no: 33, id: 'steel_longsword', name: 'Steel Longsword', tier: 2, cost: 9, fx: { atk: 6 } },
  { no: 34, id: 'assassins_kris', name: "Assassin's Kris", tier: 2, cost: 10, fx: { atk: 4, firstStrike: true, poison: 2 } },
  { no: 35, id: 'warhorn', name: 'Warhorn', tier: 2, cost: 10, fx: { rally: 2 } },
  { no: 36, id: 'serrated_axe', name: 'Serrated Axe', tier: 2, cost: 11, fx: { atk: 5, thorns: 3 } },

  // ---- Tier 3 ----
  { no: 37, id: 'basilisk_fang', name: 'Basilisk Fang', tier: 3, cost: 16, fx: { atk: 5, poison: 5 } },
  { no: 38, id: 'dragonplate', name: 'Dragonplate', tier: 3, cost: 17, fx: { armour: 5, maxHp: 10 } },
  { no: 39, id: 'runed_greatsword', name: 'Runed Greatsword', tier: 3, cost: 18, fx: { atk: 11 } },
  { no: 40, id: 'banner_of_the_vanguard', name: 'Banner of the Vanguard', tier: 3, cost: 20, fx: { rally: 4 } },
  { no: 41, id: 'executioners_blade', name: "Executioner's Blade", tier: 3, cost: 22, fx: { atk: 9, firstStrike: true } },
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
  { no: 46, id: 'shieldbearer', name: 'Shieldbearer', tier: 2, cost: 8, fx: { armour: 1 },
    perk: { cleanPathArmour: 2 }, text: 'Armour 1. Before each duel, +2 Armour if you took no path damage that round.' },
  { no: 47, id: 'houndmaster', name: 'Houndmaster', tier: 2, cost: 9, fx: { firstStrike: true },
    text: 'Your first attack in every fight gains First Strike.' },
  { no: 48, id: 'quartermaster', name: 'Quartermaster', tier: 2, cost: 12,
    perk: { gearDiscount: 3 }, text: 'Gear costs 3 less (minimum 1).' },
  { no: 49, id: 'banner_squire', name: 'Banner Squire', tier: 3, cost: 14, fx: { rally: 1 },
    perk: { roundStart: { rally: 1 } }, text: 'Rally 1. Increases by 1 each round.' },
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
].map((p) => ({ ...p, type: 'place' }));

/** Everything a hand can be dealt from — the whole pool, since there's no
 *  Spoils tier held back for monster drops. */
export const DEAL_POOL = [...MONSTERS, ...GEAR, ...ALLIES, ...PLACES];

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
    if (c.trophy?.atk) parts.push(`+${c.trophy.atk} ATK`);
    if (c.trophy?.maxHp) parts.push(`+${c.trophy.maxHp} max HP`);
    return parts.join(', ');
  }
  return fxText(c.fx || {});
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
