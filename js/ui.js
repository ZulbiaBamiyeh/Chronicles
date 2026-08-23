// Rendering. Every card face in the game is built by cardEl(), so a card looks
// the same in your hand, in a path slot, and in the detail sheet — only the
// size class changes. Nothing here decides anything; main.js owns the flow
// and calls in.

import { card, cardText, keywordBadges, equipment, counterText } from './cards.js';
import { costFor } from './engine.js';

// One glyph per card. Emoji rather than 70 pieces of commissioned art is an
// honest prototype trade: it reads instantly at thumb size on a phone, it costs
// nothing, and it's the easiest thing in the project to replace later.
export const ICON = {
  // monsters
  field_mouse: '🐭', sewer_rat: '🐀', wild_boar: '🐗', goblin_scrapper: '👺',
  giant_spider: '🕷️', bandit_lookout: '🥷', bog_toad: '🐸', skeleton_picket: '💀',
  feral_hound: '🐺', cave_troll: '🧌', marsh_wraith: '🌫️', bandit_captain: '🪖',
  iron_golem: '⚙️', ogre_brute: '👹', wyvern_hatchling: '🥚', thornback_boar: '🦔',
  hill_giant: '🏔️', basilisk: '🐍', stone_warden: '🗿', chimera: '🦁',
  elder_wyrm: '🐉', flame_imp: '😈',
  // gear
  whetstone: '🔩', buckler: '🛡️', travellers_boots: '🥾', rusty_sword: '🗡️',
  leather_jerkin: '🎽', spiked_vambrace: '🦾', hunting_bow: '🏹', venom_flask: '🧪',
  chainmail: '⛓️', tower_shield: '🏰', steel_longsword: '⚔️', assassins_kris: '🔪',
  warhorn: '📯', serrated_axe: '🪓', basilisk_fang: '🦷', dragonplate: '🐲',
  runed_greatsword: '🔱', banner_of_the_vanguard: '🚩', executioners_blade: '☠️',
  plague_censer: '🏺', barbed_cuirass: '🌵', wyrmvenom_vial: '⚗️', bramble_aegis: '🛡',
  battle_drum: '🥁',
  // secrets
  caltrops: '🔻', rust_powder: '🧂', snare_wire: '🕸️', antidote_draught: '🍵',
  dousing_rain: '🌧️', barb_file: '🪒', hamstring: '🩸', ambush_pit: '🕳️',
  purge_ritual: '🔯', sabotage: '💣',
  // second rank
  dire_wolf: '🐕‍🦺', forest_troll: '🌲', grave_knight: '⚰', bog_horror: '🦑',
  frost_wraith: '❄️', warlord_of_ash: '🔥',
  iron_cap: '⛑️', leather_gloves: '🧤', hunting_knife: '🔪', sling: '🎯',
  kite_shield: '🛡️', war_pick: '⛏️', scale_hauberk: '🐟', twin_daggers: '⚔',
  coated_blade: '🗡', rally_standard: '🎌',
  titan_maul: '🔨', wyrmfang_spear: '🔱', berserkers_axe: '🪓',
  shadowsteel_blade: '🌑', aegis_of_dawn: '🌅', crown_of_command: '👑', reaver_plate: '🦿',
  scout: '🔭', venom_alchemist: '⚗️', war_priest: '✝️', master_smith: '⚒️', shield_maiden: '🛡',
  hidden_cache: '📦', the_arena: '🏟️', sacred_spring: '💧', war_camp: '⛺', dragon_altar: '🐲',
  // allies
  torchbearer: '🕯️', coin_clipper: '🪙', sparring_partner: '🥊', field_medic: '⚕️',
  shieldbearer: '🧱', houndmaster: '🐕', quartermaster: '📦', banner_squire: '🎖️',
  // places
  roadside_shrine: '⛩️', market_square: '🛒', blacksmith: '🔨', training_yard: '🎯',
  boneyard: '⚰️', watchtower: '🔭', ruined_chapel: '⛪', toll_bridge: '🌉',
  standing_stones: '🪨',
};

/** One monster glyph per fighting card, for the path-fight stage. */
export const MONSTER_GLYPH = {
  field_mouse: '🐭', sewer_rat: '🐀', wild_boar: '🐗', goblin_scrapper: '👺',
  giant_spider: '🕷️', bandit_lookout: '🥷', bog_toad: '🐸', skeleton_picket: '💀',
  feral_hound: '🐺', cave_troll: '🧌', marsh_wraith: '🌫️', bandit_captain: '🪖',
  iron_golem: '⚙️', ogre_brute: '👹', wyvern_hatchling: '🥚', thornback_boar: '🦔',
  hill_giant: '🏔️', basilisk: '🐍', stone_warden: '🗿', chimera: '🦁',
  elder_wyrm: '🐉', flame_imp: '😈',
};

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

export const $ = (sel) => document.querySelector(sel);

/**
 * A card face.
 *
 * @param {string} id
 * @param {object} [opts]
 * @param {object} [opts.run]      the run, so gear shows *your* discounted price
 * @param {'hand'|'slot'|'detail'} [opts.size]
 * @param {boolean} [opts.upgrade] the paid upgrade is armed
 * @param {boolean} [opts.dim]     fizzled / unaffordable
 */
export function cardEl(id, opts = {}) {
  const c = card(id);
  const size = opts.size || 'hand';
  const node = el('div', `card card-${c.type} tier-${c.tier} card-${size}`);
  node.dataset.id = id;

  // Cost sits top-left where a Hearthstone mana gem does — the number you read
  // first, because it's the one that decides whether the card is playable at
  // all. Free cards show no gem rather than a zero: an empty corner reads as
  // "nothing to pay" faster than a digit does.
  const cost = opts.run ? costFor(opts.run, c) : c.cost || 0;
  if (cost > 0) {
    const gem = el('div', 'card-gem gem-cost', String(cost));
    // A gear card the Quartermaster has marked down says so, so the discount is
    // visible at planning time rather than a surprise during resolution.
    if (cost !== (c.cost || 0)) gem.classList.add('cut');
    node.appendChild(gem);
  }
  node.appendChild(el('div', 'card-tier', `T${c.tier}`));

  const art = el('div', 'card-art');
  art.appendChild(el('span', 'card-art-glyph', ICON[id] || '❔'));
  node.appendChild(art);

  node.appendChild(el('div', 'card-name', c.name));

  const kws = keywordBadges(c.kw || c.fx || {});
  if (kws.length) {
    const row = el('div', 'card-kw');
    for (const k of kws) row.appendChild(el('span', `kw kw-${k.k}`, k.label));
    node.appendChild(row);
  }

  node.appendChild(el('div', 'card-text', cardText(c)));

  // Bottom corners, Hearthstone-style: what it hits for on the left, what it
  // can take on the right. A monster shows its real ATK and HP; a piece of
  // gear shows what it grants you, which is the same question asked from the
  // other side ("what will this put in those corners for me?").
  const fx = c.fx || {};
  const atkVal = c.type === 'monster' ? c.atk : fx.atk;
  const defVal = c.type === 'monster' ? c.hp : fx.armour;
  if (atkVal) node.appendChild(gem('atk', '⚔', atkVal));
  if (defVal) node.appendChild(gem(c.type === 'monster' ? 'hp' : 'def', c.type === 'monster' ? '♥' : '🛡', defVal));

  if (c.option) {
    const btn = el('button', `card-option${opts.upgrade ? ' on' : ''}`, c.option.label);
    btn.type = 'button';
    btn.dataset.role = 'upgrade';
    node.appendChild(btn);
  }
  if (opts.dim) node.classList.add('dim');
  return node;
}

function gem(kind, icon, value) {
  const g = el('div', `card-gem gem-${kind}`);
  g.appendChild(el('span', 'gem-icon', icon));
  g.appendChild(el('span', 'gem-value', String(value)));
  return g;
}

// ---- HUD ------------------------------------------------------------------

const KW_LABEL = {
  armour: 'Armour', thorns: 'Thorns', poison: 'Poison', rally: 'Rally',
};

export function renderHud(run, tierLabel) {
  $('#hud-round').textContent = `ROUND ${run.round} · ${tierLabel}`;

  const hearts = $('#hud-hearts');
  hearts.textContent = '';
  for (let i = 0; i < 3; i++) {
    hearts.appendChild(el('span', `heart${i < run.hearts ? '' : ' spent'}`, '♥'));
  }

  const wins = $('#hud-wins');
  wins.textContent = '';
  for (let i = 0; i < 5; i++) {
    wins.appendChild(el('span', `pip${i < run.wins ? ' won' : ''}`));
  }

  const pct = Math.max(0, Math.min(100, (run.hp / run.maxHp) * 100));
  const fill = $('#hud-hp-fill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('low', pct <= 30);
  $('#hud-hp-text').textContent = `${run.hp} / ${run.maxHp}`;
  $('#hud-atk').textContent = run.atk;
  $('#hud-gold').textContent = run.gold;

  const kw = $('#hud-kw');
  kw.textContent = '';
  for (const [k, label] of Object.entries(KW_LABEL)) {
    if (run.kw[k]) kw.appendChild(el('span', `kw kw-${k}`, `${label} ${run.kw[k]}`));
  }
  if (run.kw.firstStrike) kw.appendChild(el('span', 'kw kw-first', 'First Strike'));
  kw.classList.toggle('hidden', !kw.childElementCount);
}

// ---- equipment panel --------------------------------------------------
//
// A fixed grid of equip slots — filled or empty, like OSRS's worn-equipment
// screen or MapleStory's equip window — rather than a row of pill badges. The
// whole point is that a fighter's kit reads as a shape at a glance: which
// slots are lit tells you what they're carrying before you read a single
// number. ATK is always filled (every fighter swings something); the rest
// light up only if that fighter actually has the keyword.
const EQUIP_SLOTS = [
  { key: 'atk', kind: 'atk', icon: '👊', label: 'Weapon' },
  { key: 'armour', kind: 'armour', icon: '🛡️', label: 'Armour' },
  { key: 'poison', kind: 'poison', icon: '🧪', label: 'Poison' },
  { key: 'thorns', kind: 'thorns', icon: '🧤', label: 'Thorns' },
  { key: 'rally', kind: 'rally', icon: '🚩', label: 'Rally' },
  { key: 'firstStrike', kind: 'first', icon: '👢', label: 'First Strike' },
];

/**
 * Builds the slot grid for one fighter. Where the fighter is actually carrying
 * a named item for a slot, the slot shows *that item* — the Runed Greatsword
 * you bought, not a generic sword — which is what makes the panel read as
 * "here's what they're wearing" rather than a second copy of the statline.
 *
 * @returns {{node: HTMLElement, cells: Record<string, HTMLElement>}}
 */
function equipGrid(fighter) {
  const grid = el('div', 'equip-grid');
  const cells = {};
  const worn = equipment(fighter.gear || []);
  for (const slot of EQUIP_SLOTS) {
    const value = fighter[slot.key];
    const item = worn[slot.key];
    const active = slot.key === 'atk' ? true : Boolean(value);
    const cell = el('div', `equip-slot equip-${slot.kind}${active ? ' filled' : ' empty'}`);
    cell.appendChild(el('span', 'equip-icon', (active && item && ICON[item.id]) || slot.icon));
    if (active && slot.key !== 'firstStrike') cell.appendChild(el('span', 'equip-value', String(value)));

    const what = item ? item.name : slot.label;
    cell.title = active
      ? (slot.key === 'firstStrike' ? what : `${what} · ${slot.label} ${value}`)
      : `No ${slot.label}`;
    grid.appendChild(cell);
    cells[slot.key] = cell;
  }
  return { node: grid, cells };
}

// ---- rival intel ------------------------------------------------------
//
// Shown while planning, because the whole point of a fixed rival is that you
// build *against* them. Their statline and kit are open; their secrets are
// not — you can see how many they've laid but not what they are unless you
// spent a slot on a Watchtower. That gap is the tension: it's the difference
// between solving the duel at planning time and having to make a read.

const KW_SHORT = {
  armour: 'ARM', thorns: 'THN', poison: 'PSN', rally: 'RLY',
};

/**
 * @param {HTMLElement} mount
 * @param {object} info      from rival.js's intel()
 * @param {{wins:number, losses:number, days:number}} series
 */
export function rivalPanel(mount, info, series) {
  mount.textContent = '';

  const head = el('div', 'rival-head');
  head.appendChild(el('span', 'rival-glyph', '👻'));
  const id = el('div', 'rival-id');
  id.appendChild(el('div', 'rival-name', info.name));
  id.appendChild(el('div', 'rival-arch', `${info.archetype} · day ${info.day} of ${series.days}`));
  head.appendChild(id);

  // The series score, so "how am I doing against this person" is always on
  // screen rather than something you reconstruct from the heart count.
  const score = el('div', 'rival-score');
  score.appendChild(el('b', 'score-me', String(series.wins)));
  score.appendChild(el('span', 'score-sep', '–'));
  score.appendChild(el('b', 'score-them', String(series.losses)));
  head.appendChild(score);
  mount.appendChild(head);

  const stats = el('div', 'rival-stats');
  stats.appendChild(statChip('⚔', info.atk, 'atk'));
  stats.appendChild(statChip('♥', `${info.hp}/${info.maxHp}`, 'hp'));
  for (const [k, label] of Object.entries(KW_SHORT)) {
    if (info.keywords[k]) stats.appendChild(statChip(label, info.keywords[k], k));
  }
  if (info.keywords.firstStrike) stats.appendChild(statChip('FIRST', '', 'first'));
  mount.appendChild(stats);

  // What they're carrying, so a counter can be read off the kit as well as
  // the numbers.
  if (info.inventory.length) {
    const kit = el('div', 'rival-kit');
    for (const itemId of info.inventory) {
      const c = card(itemId);
      if (!c) continue;
      const chip = el('span', 'kit-item', ICON[itemId] || '❔');
      chip.title = c.name;
      kit.appendChild(chip);
    }
    mount.appendChild(kit);
  }

  mount.appendChild(secretRow(info));
  if (info.hasInvasion) mount.appendChild(invasionRow(info));
  return mount;
}

/**
 * The one thing on this panel that isn't a card either side plays: a rival's
 * invasion monster, forced onto today's path. Same reveal gate as secrets —
 * you know it's coming, not what it is, unless you've scouted.
 */
function invasionRow(info) {
  const row = el('div', `rival-invasion${info.invasion ? ' known' : ''}`);
  row.appendChild(el('span', 'invasion-icon', '⚔'));
  if (info.invasion) {
    const c = card(info.invasion);
    row.appendChild(el('span', 'invasion-label', `Sends ${c.name} today`));
  } else {
    row.appendChild(el('span', 'invasion-label', 'Something will ambush your path today'));
  }
  return row;
}

function secretRow(info) {
  const row = el('div', 'rival-secrets');
  if (!info.secretCount) {
    row.classList.add('none');
    row.appendChild(el('span', 'secret-label', 'No secrets laid'));
    return row;
  }
  if (info.secrets) {
    row.classList.add('known');
    row.appendChild(el('span', 'secret-label', 'Scouted:'));
    for (const id of info.secrets) {
      const c = card(id);
      const chip = el('span', 'secret-chip known', `${ICON[id] || '❔'} ${c.name}`);
      chip.title = `You: ${counterText(c.counter)}`;
      row.appendChild(chip);
    }
    return row;
  }
  row.classList.add('hidden-secrets');
  row.appendChild(el('span', 'secret-label',
    `${info.secretCount} secret${info.secretCount === 1 ? '' : 's'} laid`));
  for (let i = 0; i < info.secretCount; i++) {
    const chip = el('span', 'secret-chip unknown', '?');
    chip.title = 'Play a Watchtower to reveal';
    row.appendChild(chip);
  }
  return row;
}

function statChip(icon, value, kind) {
  const chip = el('span', `rival-stat rs-${kind}`);
  chip.appendChild(el('i', null, icon));
  if (value !== '') chip.appendChild(el('b', null, String(value)));
  return chip;
}

/** Glyph rained by each status-effect animation. */
const EFFECT_GLYPH = {
  poison: '☠', thorns: '✸', rally: '⬆', heal: '✚', gold: '◉', armour: '◈',
};

// ---- fight stage ------------------------------------------------------
//
// One side of a fight: portrait, name, HP bar, equipment grid. Used for the
// duel screen and, identically, for a path monster fight — same component,
// same clarity, because §4's whole premise is that path and duel share one
// resolver, so they should share one presentation too.
export function duelistEl(mount, fighter, { glyph, sub, facing = 'right' }) {
  mount.textContent = '';
  const portrait = el('div', 'duelist-portrait');
  portrait.appendChild(el('div', 'duelist-glyph', glyph));
  // Every blow, status tick and pickup animation is drawn into this layer,
  // over the portrait of whoever it happened to.
  const fx = el('div', 'fx-layer');
  portrait.appendChild(fx);
  mount.appendChild(portrait);

  mount.appendChild(el('div', 'duelist-name', fighter.name));
  if (sub) mount.appendChild(el('div', 'duelist-sub', sub));

  const bar = el('div', 'hpbar hpbar-duel');
  const fill = el('div', 'hpbar-fill');
  fill.style.width = '100%';
  const text = el('span', 'hpbar-text', `${fighter.hp} / ${fighter.maxHp}`);
  bar.append(fill, text);
  mount.appendChild(bar);

  let { node: equip, cells } = equipGrid(fighter);
  mount.appendChild(equip);

  const spawn = (cls, ttl, build) => {
    const n = el('div', cls);
    n.dataset.from = facing === 'right' ? 'left' : 'right';
    if (build) build(n);
    fx.appendChild(n);
    setTimeout(() => n.remove(), ttl);
    return n;
  };

  return {
    /**
     * Plays an incoming attack on this fighter, drawn in the style of the
     * weapon that threw it — a sword arc, an arrow in flight, a claw rake.
     * `kind` is the attacker's `anim` (see cards.js).
     */
    strike(kind) {
      spawn(`strike strike-${kind}`, 700, (n) => {
        if (kind === 'claw' || kind === 'bite') {
          for (let i = 0; i < 3; i++) n.appendChild(el('span', 'strike-mark'));
        } else if (kind === 'smash') {
          for (let i = 0; i < 2; i++) n.appendChild(el('span', 'strike-ring'));
        } else {
          n.appendChild(el('span', 'strike-mark'));
        }
      });
    },
    /** A status effect ticking on this fighter: poison, thorns, rally, heal, gold. */
    effect(kind) {
      spawn(`efx efx-${kind}`, 1000, (n) => {
        const count = kind === 'gold' || kind === 'poison' ? 4 : 3;
        for (let i = 0; i < count; i++) {
          const p = el('span', 'efx-bit', EFFECT_GLYPH[kind] || '✦');
          p.style.setProperty('--i', String(i));
          n.appendChild(p);
        }
      });
    },
    setHp(hp, maxHp) {
      const p = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      fill.style.width = `${p}%`;
      fill.classList.toggle('low', p <= 30);
      text.textContent = `${Math.max(0, hp)} / ${maxHp}`;
    },
    /**
     * Redraw the equipment grid against a changed statline — used when a
     * secret has stripped something off this fighter, so the panel shows what
     * they're actually going into the fight with rather than what they
     * brought to it.
     */
    setStats(next) {
      const rebuilt = equipGrid(next);
      mount.replaceChild(rebuilt.node, equip);
      equip = rebuilt.node;
      cells = rebuilt.cells;
    },
    flash(kind) {
      mount.classList.remove('hit', 'poisoned');
      // Force a reflow so the same class re-triggers its animation on a
      // consecutive hit rather than being ignored as "already applied".
      void mount.offsetWidth;
      mount.classList.add(kind === 'poison' ? 'poisoned' : 'hit');
    },
    /** Pulse the equip slot responsible for a blow, so the source of every
     *  point of damage is visibly traceable back to what's equipped. */
    pulseSlot(key) {
      const cell = cells[key];
      if (!cell) return;
      cell.classList.remove('pulse');
      void cell.offsetWidth;
      cell.classList.add('pulse');
    },
    float(text, kind) {
      const f = el('div', `floater floater-${kind}`, text);
      mount.appendChild(f);
      setTimeout(() => f.remove(), 1000);
    },
  };
}

export function feedLine(mount, text, cls = '') {
  const line = el('div', `feed-line ${cls}`.trim(), text);
  mount.appendChild(line);
  mount.scrollTop = mount.scrollHeight;
  return line;
}

export { el };
