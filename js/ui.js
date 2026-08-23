// Rendering. Every card face in the game is built by cardEl(), so a card looks
// the same in your hand, in a path slot, and in the detail sheet — only the
// size class changes. Nothing here decides anything; main.js owns the flow
// and calls in.

import { card, cardText, keywordBadges } from './cards.js';
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

  const top = el('div', 'card-top');
  const cost = opts.run ? costFor(opts.run, c) : c.cost || 0;
  if (c.type === 'gear' || (c.cost || 0) > 0) {
    const tag = el('span', 'card-cost', `${cost}◉`);
    // A gear card the Quartermaster has marked down says so, so the discount is
    // visible at planning time rather than a surprise during resolution.
    if (cost !== (c.cost || 0)) tag.classList.add('card-cost-cut');
    top.appendChild(tag);
  } else {
    top.appendChild(el('span', 'card-cost card-cost-free', c.type === 'monster' ? 'FIGHT' : 'FREE'));
  }
  top.appendChild(el('span', 'card-tier', `T${c.tier}`));
  node.appendChild(top);

  node.appendChild(el('div', 'card-icon', ICON[id] || '❔'));
  node.appendChild(el('div', 'card-name', c.name));

  if (c.type === 'monster') {
    const stats = el('div', 'card-stats');
    stats.appendChild(el('b', 'st-hp', c.hp));
    stats.appendChild(el('span', 'st-sep', '/'));
    stats.appendChild(el('b', 'st-atk', c.atk));
    node.appendChild(stats);
  }

  const kws = keywordBadges(c.kw || {});
  if (kws.length) {
    const row = el('div', 'card-kw');
    for (const k of kws) row.appendChild(el('span', `kw kw-${k.k}`, k.label));
    node.appendChild(row);
  }

  node.appendChild(el('div', 'card-text', cardText(c)));

  if (c.option) {
    const btn = el('button', `card-option${opts.upgrade ? ' on' : ''}`, c.option.label);
    btn.type = 'button';
    btn.dataset.role = 'upgrade';
    node.appendChild(btn);
  }
  if (opts.dim) node.classList.add('dim');
  return node;
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
  { key: 'atk', kind: 'atk', icon: '⚔️', label: 'Weapon' },
  { key: 'armour', kind: 'armour', icon: '🛡️', label: 'Armour' },
  { key: 'poison', kind: 'poison', icon: '🧪', label: 'Poison' },
  { key: 'thorns', kind: 'thorns', icon: '🧤', label: 'Thorns' },
  { key: 'rally', kind: 'rally', icon: '🚩', label: 'Rally' },
  { key: 'firstStrike', kind: 'first', icon: '👢', label: 'First Strike' },
];

/**
 * Builds the slot grid for one fighter.
 * @returns {{node: HTMLElement, cells: Record<string, HTMLElement>}}
 */
function equipGrid(fighter) {
  const grid = el('div', 'equip-grid');
  const cells = {};
  for (const slot of EQUIP_SLOTS) {
    const value = fighter[slot.key];
    const active = slot.key === 'atk' ? true : Boolean(value);
    const cell = el('div', `equip-slot equip-${slot.kind}${active ? ' filled' : ' empty'}`);
    cell.appendChild(el('span', 'equip-icon', slot.icon));
    if (active && slot.key !== 'firstStrike') cell.appendChild(el('span', 'equip-value', String(value)));
    cell.title = active
      ? (slot.key === 'firstStrike' ? slot.label : `${slot.label} ${value}`)
      : `No ${slot.label}`;
    grid.appendChild(cell);
    cells[slot.key] = cell;
  }
  return { node: grid, cells };
}

// ---- fight stage ------------------------------------------------------
//
// One side of a fight: portrait, name, HP bar, equipment grid. Used for the
// duel screen and, identically, for a path monster fight — same component,
// same clarity, because §4's whole premise is that path and duel share one
// resolver, so they should share one presentation too.
export function duelistEl(mount, fighter, { glyph, sub }) {
  mount.textContent = '';
  mount.appendChild(el('div', 'duelist-glyph', glyph));
  mount.appendChild(el('div', 'duelist-name', fighter.name));
  if (sub) mount.appendChild(el('div', 'duelist-sub', sub));

  const bar = el('div', 'hpbar hpbar-duel');
  const fill = el('div', 'hpbar-fill');
  fill.style.width = '100%';
  const text = el('span', 'hpbar-text', `${fighter.hp} / ${fighter.maxHp}`);
  bar.append(fill, text);
  mount.appendChild(bar);

  const { node: equip, cells } = equipGrid(fighter);
  mount.appendChild(equip);

  return {
    setHp(hp, maxHp) {
      const p = Math.max(0, Math.min(100, (hp / maxHp) * 100));
      fill.style.width = `${p}%`;
      fill.classList.toggle('low', p <= 30);
      text.textContent = `${Math.max(0, hp)} / ${maxHp}`;
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
