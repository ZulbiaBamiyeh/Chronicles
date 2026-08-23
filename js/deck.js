// Deckbuilding.
//
// In Chronicle you don't draw from "the game's cards", you draw from *yours* —
// a deck you assembled before the run, which is where most of the strategy
// actually lives. A hand is only interesting if you chose what could be in it.
//
// The shape here is thirty cards, ten from each tier. Keeping the tier split
// is what lets deckbuilding sit on top of the existing balance model rather
// than replacing it: js/engine.js still deals a day's hand from the tiers that
// day allows (§9's curve, unchanged), it just draws from your ten for that
// tier instead of the whole pool. Five days × six cards = thirty, so a run
// sees your entire deck exactly once — no reshuffle, no dead draws late, and
// every card you put in is a card you will actually be handed.
//
// The legality rules exist to protect the one guarantee a hand can't lose:
// §9's floor that a hand always contains a way to earn gold and a way to spend
// it. A deck with two monsters in it could not honour that, so the builder
// won't let you make one.

import { ALL_CARDS, card } from './cards.js';

export const TIERS = [1, 2, 3];
export const PER_TIER = 10;
export const DECK_SIZE = PER_TIER * TIERS.length;

/** Per tier: enough monsters to fill a hand's gold floor, and enough to spend it on. */
export const MIN_MONSTERS = 3;
export const MIN_SPENDABLE = 3;

const byTier = (tier) => ALL_CARDS.filter((c) => c.tier === tier);
const isSpendable = (c) => c.type === 'gear' || c.type === 'place' || c.type === 'ally';

/** Every card legal at a tier, in a stable display order. */
export function pool(tier) {
  const order = { monster: 0, gear: 1, ally: 2, place: 3, secret: 4 };
  return byTier(tier).slice().sort((a, b) =>
    (order[a.type] - order[b.type]) || (a.cost || 0) - (b.cost || 0) || a.no - b.no);
}

/**
 * What's wrong with a deck, as a list of human-readable problems. Empty means
 * it's legal.
 *
 * @param {string[]} ids
 */
export function problems(ids) {
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) out.push(`${card(id)?.name ?? id} is in the deck twice`);
    seen.add(id);
  }
  for (const tier of TIERS) {
    const inTier = ids.map(card).filter((c) => c && c.tier === tier);
    if (inTier.length !== PER_TIER) {
      out.push(`Tier ${tier}: ${inTier.length} of ${PER_TIER} cards`);
      continue;
    }
    const monsters = inTier.filter((c) => c.type === 'monster').length;
    const spendable = inTier.filter(isSpendable).length;
    if (monsters < MIN_MONSTERS) {
      out.push(`Tier ${tier}: needs ${MIN_MONSTERS} monsters to earn gold (has ${monsters})`);
    }
    if (spendable < MIN_SPENDABLE) {
      out.push(`Tier ${tier}: needs ${MIN_SPENDABLE} cards to spend gold on (has ${spendable})`);
    }
  }
  return out;
}

export const isLegal = (ids) => problems(ids).length === 0;

/** The cards in a deck that belong to a given tier. */
export const deckTier = (ids, tier) => ids.filter((id) => card(id)?.tier === tier);

// ---------------------------------------------------------------------------
// Preset decks
// ---------------------------------------------------------------------------
//
// Chronicle shipped its Legends with decks already built, which is the right
// call: "assemble thirty cards" is a terrible first thing to ask of someone
// who has never played. These are five legal, coherent starting points — one
// per archetype plus a generalist — that a player can take as-is, or open in
// the builder and start changing a card at a time.

const PRESETS = {
  balanced: {
    name: 'The Wanderer',
    blurb: 'A little of everything. The deck to learn the game with.',
    cards: [
      // T1
      'sewer_rat', 'wild_boar', 'goblin_scrapper', 'bandit_lookout',
      'whetstone', 'rusty_sword', 'leather_jerkin',
      'roadside_shrine', 'blacksmith', 'caltrops',
      // T2
      'cave_troll', 'bandit_captain', 'ogre_brute', 'grave_knight',
      'steel_longsword', 'chainmail', 'war_pick',
      'toll_bridge', 'hidden_cache', 'hamstring',
      // T3
      'hill_giant', 'flame_imp', 'chimera', 'warlord_of_ash',
      'runed_greatsword', 'dragonplate', 'titan_maul',
      'war_camp', 'sacred_spring', 'sabotage',
    ],
  },
  aggro: {
    name: 'The Duellist',
    blurb: 'Hit first, hit hardest. Weapons, First Strike, and no patience.',
    cards: [
      'feral_hound', 'goblin_scrapper', 'wild_boar', 'bandit_lookout',
      'hunting_bow', 'sling', 'rusty_sword', 'hunting_knife', 'whetstone', 'blacksmith',
      'dire_wolf', 'wyvern_hatchling', 'bandit_captain', 'grave_knight',
      'twin_daggers', 'steel_longsword', 'war_pick', 'assassins_kris',
      'the_arena', 'hamstring',
      'chimera', 'flame_imp', 'warlord_of_ash', 'hill_giant',
      'executioners_blade', 'runed_greatsword', 'titan_maul', 'shadowsteel_blade',
      'war_camp', 'sabotage',
    ],
  },
  tank: {
    name: 'The Bulwark',
    blurb: 'Armour, Thorns, and more HP than anyone wants to chew through.',
    cards: [
      'bog_toad', 'skeleton_picket', 'wild_boar', 'sewer_rat',
      'buckler', 'leather_jerkin', 'iron_cap', 'spiked_vambrace',
      'travellers_boots', 'roadside_shrine',
      'iron_golem', 'forest_troll', 'thornback_boar', 'cave_troll',
      'chainmail', 'tower_shield', 'kite_shield', 'barbed_cuirass',
      'scale_hauberk', 'toll_bridge',
      'stone_warden', 'bog_horror', 'frost_wraith', 'hill_giant',
      'dragonplate', 'aegis_of_dawn', 'bramble_aegis', 'reaver_plate',
      'shield_maiden', 'sacred_spring',
    ],
  },
  poison: {
    name: 'The Alchemist',
    blurb: 'Poison ignores Armour. Let it do the work while you stay alive.',
    cards: [
      'giant_spider', 'bog_toad', 'sewer_rat', 'wild_boar',
      'venom_flask', 'leather_jerkin', 'buckler', 'travellers_boots',
      'roadside_shrine', 'rust_powder',
      'marsh_wraith', 'cave_troll', 'thornback_boar', 'grave_knight',
      'plague_censer', 'coated_blade', 'venom_alchemist', 'chainmail',
      'hidden_cache', 'barb_file',
      'basilisk', 'bog_horror', 'hill_giant', 'stone_warden',
      'wyrmvenom_vial', 'wyrmfang_spear', 'shadowsteel_blade', 'dragonplate',
      'sacred_spring', 'purge_ritual',
    ],
  },
  rally: {
    name: 'The Warlord',
    blurb: 'Weak on the first exchange. Terrifying by the fourth.',
    cards: [
      'bog_toad', 'skeleton_picket', 'wild_boar', 'bandit_lookout',
      'battle_drum', 'leather_jerkin', 'buckler', 'travellers_boots',
      'roadside_shrine', 'snare_wire',
      'cave_troll', 'ogre_brute', 'iron_golem', 'grave_knight',
      'warhorn', 'rally_standard', 'chainmail', 'scale_hauberk',
      'toll_bridge', 'dousing_rain',
      'elder_wyrm', 'stone_warden', 'hill_giant', 'warlord_of_ash',
      'banner_of_the_vanguard', 'crown_of_command', 'berserkers_axe', 'banner_squire',
      'sacred_spring', 'ambush_pit',
    ],
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const preset = (key) => PRESETS[key];
export const presetCards = (key) => [...(PRESETS[key]?.cards || [])];

/** The deck a player starts with before they've built one. */
export const defaultDeck = () => presetCards('balanced');
