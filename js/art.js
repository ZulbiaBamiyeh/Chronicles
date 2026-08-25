// MapleStory sprites pulled from the same API maples.im uses
// (maplestory.io / api.dreamms.gg). Paths are local so the game runs offline.

const png = (folder, id) => `assets/${folder}/${id}.png`;

const ids = (folder, list) =>
  Object.fromEntries(list.map((id) => [id, png(folder, id)]));

export const ART = {
  ...ids('mobs', [
    'field_mouse', 'sewer_rat', 'wild_boar', 'goblin_scrapper', 'giant_spider',
    'bandit_lookout', 'bog_toad', 'skeleton_picket', 'feral_hound', 'cave_troll',
    'marsh_wraith', 'bandit_captain', 'iron_golem', 'ogre_brute', 'wyvern_hatchling',
    'thornback_boar', 'hill_giant', 'basilisk', 'stone_warden', 'chimera',
    'elder_wyrm', 'flame_imp', 'dire_wolf', 'forest_troll', 'grave_knight',
    'bog_horror', 'frost_wraith', 'warlord_of_ash',
    'curse_eye', 'horny_mushroom', 'iron_hog', 'king_clang', 'taurospear', 'lucida',
  ]),
  ...ids('items', [
    'whetstone', 'buckler', 'travellers_boots', 'rusty_sword', 'leather_jerkin',
    'spiked_vambrace', 'hunting_bow', 'venom_flask', 'battle_drum', 'chainmail',
    'tower_shield', 'steel_longsword', 'assassins_kris', 'warhorn', 'serrated_axe',
    'basilisk_fang', 'dragonplate', 'runed_greatsword', 'banner_of_the_vanguard',
    'executioners_blade', 'plague_censer', 'barbed_cuirass', 'wyrmvenom_vial',
    'bramble_aegis', 'iron_cap', 'leather_gloves', 'hunting_knife', 'sling',
    'kite_shield', 'war_pick', 'scale_hauberk', 'twin_daggers', 'coated_blade',
    'rally_standard', 'titan_maul', 'wyrmfang_spear', 'berserkers_axe',
    'shadowsteel_blade', 'aegis_of_dawn', 'crown_of_command', 'reaver_plate',
    'grindstone', 'venomfang_dagger', 'serpent_scale_mail', 'vanguards_edge',
    'vanguards_banner', 'sentinel_plate', 'sentinel_spikes', 'berserkers_pact',
    'reckless_charge', 'glass_cannon', 'bramblelord', 'wardens_oath', 'toxinsmith',
    'ironblood_rite', 'armsmaster', 'masters_forge', 'reckless_thirst',
    'caltrops', 'rust_powder', 'snare_wire', 'antidote_draught', 'dousing_rain',
    'barb_file', 'hamstring', 'ambush_pit', 'purge_ritual', 'sabotage',
    'coin_clipper',
    'roadside_shrine', 'market_square', 'blacksmith', 'boneyard', 'watchtower',
    'toll_bridge', 'standing_stones', 'hidden_cache', 'the_arena', 'sacred_spring',
    'war_camp', 'dragon_altar', 'scavengers_cache', 'ritual_circle',
  ]),
  ...ids('skills', [
    'torchbearer', 'sparring_partner', 'field_medic', 'shieldbearer', 'houndmaster',
    'quartermaster', 'banner_squire', 'venom_alchemist', 'war_priest', 'master_smith',
    'scout', 'shield_maiden', 'training_yard', 'ruined_chapel', 'flanking_strike',
    'ambushers_nook', 'berserkers_rite', 'bloodforge', 'gilded_edge', 'vein_drain',
    'marked_quarry', 'arcane_surge', 'hollow_vigor', 'wither',
  ]),
};

export const PORTRAIT = {
  player: png('chars', 'player'),
  aggro: png('chars', 'aggro'),
  tank: png('chars', 'tank'),
  poison: png('chars', 'poison'),
  rally: png('chars', 'rally'),
};

export const portraitFor = (archetype) => PORTRAIT[archetype] || PORTRAIT.player;

const gif = (folder, id, kind) => `assets/anims/${folder}/${id}-${kind}.gif`;

const MOB_IDS = [
  'field_mouse', 'sewer_rat', 'wild_boar', 'goblin_scrapper', 'giant_spider',
  'bandit_lookout', 'bog_toad', 'skeleton_picket', 'feral_hound', 'cave_troll',
  'marsh_wraith', 'bandit_captain', 'iron_golem', 'ogre_brute', 'wyvern_hatchling',
  'thornback_boar', 'hill_giant', 'basilisk', 'stone_warden', 'chimera',
  'elder_wyrm', 'flame_imp', 'dire_wolf', 'forest_troll', 'grave_knight',
  'bog_horror', 'frost_wraith', 'warlord_of_ash',
  'curse_eye', 'horny_mushroom', 'iron_hog', 'king_clang', 'taurospear', 'lucida',
];

export const ANIM = {
  ...Object.fromEntries(MOB_IDS.map((id) => [id, {
    stand: gif('mobs', id, 'stand'),
    attack: gif('mobs', id, 'attack'),
  }])),
  player: { stand: gif('chars', 'player', 'stand'), attack: gif('chars', 'player', 'attack') },
  aggro: { stand: gif('chars', 'aggro', 'stand'), attack: gif('chars', 'aggro', 'attack') },
  tank: { stand: gif('chars', 'tank', 'stand'), attack: gif('chars', 'tank', 'attack') },
  poison: { stand: gif('chars', 'poison', 'stand'), attack: gif('chars', 'poison', 'attack') },
  rally: { stand: gif('chars', 'rally', 'stand'), attack: gif('chars', 'rally', 'attack') },
};

export const animForId = (id) => ANIM[id] || null;
