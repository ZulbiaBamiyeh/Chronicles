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
//
// Every deck below deliberately carries the cards that read the rest of your
// build (see the scaling and adjacency sections of js/cards.js). That isn't
// flavour: a preset made only of flat stat sticks plays as four unrelated
// numbers a day, and since these are what almost everyone actually plays with,
// a synergy absent from them is a synergy that effectively doesn't exist. Each
// deck is built so its own theme has something to compound into — the Bulwark
// can turn Armour into Thorns and back, the Duellist can grow one blade all
// run, the Alchemist's Poison feeds itself.

const PRESETS = {
  balanced: {
    name: 'The Wanderer',
    blurb: 'A little of everything. The deck to learn the game with.',
    cards: [
      // T1 — a weapon to start sharpening, and the two adjacency cards, so the
      // first thing a new player learns is that order changes what a path pays.
      'sewer_rat', 'wild_boar', 'goblin_scrapper',
      'grindstone', 'rusty_sword', 'leather_jerkin',
      'roadside_shrine', 'blacksmith', 'flanking_strike', 'scavengers_cache',
      // T2
      'cave_troll', 'bandit_captain', 'grave_knight',
      'steel_longsword', 'chainmail', 'armsmaster',
      'toll_bridge', 'hidden_cache', 'ritual_circle', 'hamstring',
      // T3 — the payoff end of the weapon arc.
      'hill_giant', 'flame_imp', 'chimera',
      'runed_greatsword', 'dragonplate', 'masters_forge',
      'war_camp', 'sacred_spring', 'bloodforge', 'sabotage',
    ],
  },
  aggro: {
    name: 'The Duellist',
    blurb: 'Hit first, hit hardest. One blade, sharpened all run.',
    cards: [
      'feral_hound', 'goblin_scrapper', 'wild_boar',
      'hunting_bow', 'rusty_sword', 'hunting_knife', 'grindstone',
      'blacksmith', 'training_yard', 'flanking_strike',
      'dire_wolf', 'wyvern_hatchling', 'bandit_captain', 'grave_knight',
      'twin_daggers', 'steel_longsword', 'assassins_kris', 'armsmaster',
      'the_arena', 'hamstring',
      'chimera', 'flame_imp', 'warlord_of_ash', 'hill_giant',
      'executioners_blade', 'runed_greatsword', 'shadowsteel_blade', 'masters_forge',
      'war_camp', 'sabotage',
    ],
  },
  tank: {
    name: 'The Bulwark',
    blurb: 'Armour into Thorns and back. Nothing gets through, everything bleeds.',
    // Used to carry zero weapons and zero flat-ATK gear at all — every card
    // in the deck was Armour, Thorns, or max HP. A duel deals damage = ATK
    // minus Armour, so a fighter parked at their starting ATK cannot actually
    // kill anything: this deck won the war of attrition on paper and lost the
    // duel in practice. One card per tier (Rusty Sword, War Pick, Reaver
    // Plate — the last a hybrid Armour+ATK piece) gives it a real, if modest,
    // way to finish a fight while keeping the theme intact.
    cards: [
      'bog_toad', 'skeleton_picket', 'wild_boar', 'sewer_rat',
      'buckler', 'leather_jerkin', 'rusty_sword', 'spiked_vambrace',
      'travellers_boots', 'roadside_shrine',
      'iron_golem', 'forest_troll', 'thornback_boar', 'cave_troll',
      'chainmail', 'tower_shield', 'war_pick',
      'bramblelord', 'wardens_oath', 'ambushers_nook',
      'stone_warden', 'bog_horror', 'hill_giant',
      'dragonplate', 'reaver_plate', 'bramble_aegis', 'ironblood_rite',
      'shield_maiden', 'sacred_spring', 'standing_stones',
    ],
  },
  poison: {
    name: 'The Alchemist',
    blurb: 'Poison ignores Armour, and every vial you carry makes the next one worse.',
    cards: [
      'giant_spider', 'bog_toad', 'sewer_rat',
      'venom_flask', 'leather_jerkin', 'hunting_knife', 'travellers_boots',
      'roadside_shrine', 'rust_powder', 'whetstone',
      'marsh_wraith', 'cave_troll', 'grave_knight',
      'ritual_circle', 'plague_censer', 'coated_blade', 'venom_alchemist', 'toxinsmith',
      'hidden_cache', 'barb_file',
      'basilisk', 'bog_horror', 'hill_giant',
      'wyrmvenom_vial', 'wyrmfang_spear', 'shadowsteel_blade', 'dragonplate',
      'sacred_spring', 'war_camp', 'purge_ritual',
    ],
  },
  rally: {
    name: 'The Warlord',
    blurb: 'Weak on the first exchange. Terrifying by the fourth — and worse when losing.',
    cards: [
      'bog_toad', 'skeleton_picket', 'wild_boar',
      'battle_drum', 'leather_jerkin', 'hunting_knife', 'travellers_boots',
      'roadside_shrine', 'whetstone', 'snare_wire',
      'cave_troll', 'ogre_brute', 'iron_golem', 'grave_knight',
      'warhorn', 'rally_standard',
      'berserkers_rite', 'ritual_circle', 'dousing_rain',
      // Banner Squire is Tier 2, not Tier 3 — it sits here because it reads as
      // a late-game card, which is exactly how this deck ended up 11/9 and
      // illegal. Counted where it actually belongs, the tier blocks below are
      // nine Tier 2 above and ten Tier 3 here.
      'elder_wyrm', 'hill_giant', 'warlord_of_ash',
      'banner_of_the_vanguard', 'crown_of_command', 'berserkers_axe', 'banner_squire',
      'dragonplate', 'sacred_spring', 'war_camp', 'ambush_pit',
    ],
  },

  // Four more, each pointed at a playstyle none of the five above cover —
  // loosely after Chronicle's own Legends, translated into what this game's
  // systems can actually support rather than ported keyword-for-keyword.
  // The Raptor (armour/defence) already is the Bulwark above, and Linza
  // (gear durability, striking power) already is the Duellist's weapon arc —
  // neither needed a new deck. These four did.
  fence: {
    name: 'The Fence',
    blurb: "Ozan's trade: hoard gold, spend it fast, and let the pile itself hit harder.",
    cards: [
      'sewer_rat', 'wild_boar', 'bandit_lookout',
      'coin_clipper', 'leather_jerkin', 'flanking_strike',
      'rusty_sword', 'grindstone', 'scout', 'blacksmith',
      'bandit_captain', 'ogre_brute', 'grave_knight',
      'quartermaster', 'hidden_cache', 'gilded_edge',
      'watchtower', 'the_arena', 'war_pick', 'kite_shield',
      'flame_imp', 'hill_giant', 'warlord_of_ash',
      'dragon_altar', 'sacred_spring', 'war_camp',
      'runed_greatsword', 'shield_maiden', 'bloodforge', 'sabotage',
    ],
  },
  bloodbound: {
    name: 'The Bloodbound',
    blurb: "Vanescula's wager: a max HP pool nobody else builds, cashed in the worse it's dented.",
    cards: [
      'bog_toad', 'wild_boar', 'feral_hound',
      'travellers_boots', 'leather_jerkin', 'field_medic',
      'whetstone', 'rusty_sword', 'blacksmith', 'grindstone',
      'cave_troll', 'ogre_brute', 'bandit_captain',
      'chainmail', 'scale_hauberk', 'war_priest', 'berserkers_rite',
      'armsmaster', 'steel_longsword', 'vein_drain',
      'hill_giant', 'bog_horror', 'flame_imp',
      'dragonplate', 'aegis_of_dawn', 'sacred_spring', 'bloodforge',
      'reckless_thirst', 'runed_greatsword', 'ironblood_rite',
    ],
  },
  hunter: {
    name: 'The Hunter',
    blurb: "Morvran's trade: fight more of the path than anyone, and get paid per kill for it.",
    cards: [
      'field_mouse', 'sewer_rat', 'wild_boar', 'goblin_scrapper', 'bandit_lookout',
      'flanking_strike', 'scavengers_cache', 'training_yard', 'marked_quarry', 'rusty_sword',
      'cave_troll', 'bandit_captain', 'iron_golem', 'dire_wolf', 'grave_knight',
      'ambushers_nook', 'the_arena', 'war_pick', 'houndmaster', 'watchtower',
      'hill_giant', 'chimera', 'flame_imp', 'warlord_of_ash', 'bog_horror',
      'runed_greatsword', 'war_camp', 'standing_stones', 'dragon_altar', 'shield_maiden',
    ],
  },
  adept: {
    name: 'The Adept',
    blurb: "Ariane's trade: barely any gear at all, everything staked on reading the fight right.",
    cards: [
      'field_mouse', 'sewer_rat', 'wild_boar',
      'roadside_shrine', 'market_square', 'blacksmith', 'training_yard', 'boneyard',
      'rusty_sword', 'caltrops',
      'cave_troll', 'bandit_captain', 'grave_knight',
      'watchtower', 'ritual_circle', 'arcane_surge', 'steel_longsword',
      'hamstring', 'dousing_rain', 'kite_shield',
      'hill_giant', 'chimera', 'elder_wyrm',
      'standing_stones', 'sacred_spring', 'dragon_altar', 'runed_greatsword',
      'sabotage', 'purge_ritual', 'ambush_pit',
    ],
  },
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const preset = (key) => PRESETS[key];
export const presetCards = (key) => [...(PRESETS[key]?.cards || [])];

/** The deck a player starts with before they've built one. */
export const defaultDeck = () => presetCards('balanced');
