// Rendering. Every card face in the game is built by cardEl(), so a card looks
// the same in your hand, in a path slot, in the Stash tray, and in the detail
// sheet — only the size class changes. Nothing here decides anything; main.js
// owns the flow and calls in.

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
  // spoils
  wedge_of_cheese: '🧀', toxin_sac: '🧫', wolf_pelt_cloak: '🧣', stolen_purse: '👛',
  troll_hide_mantle: '🧥', wraithglass_vial: '⚗️', warlords_horn: '🎺', golem_fist: '👊',
  flaming_spear: '🔥', wyrmscale_aegis: '🪬', basilisk_eye: '👁️', chimera_fang: '🦴',
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
 * @param {'hand'|'slot'|'stash'|'detail'} [opts.size]
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
  } else if (c.type === 'spoil') {
    top.appendChild(el('span', 'card-cost card-cost-free', 'SPOIL'));
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

/** The small chip used for the Stash tray. */
export function stashChip(id) {
  const c = card(id);
  const node = el('div', `chip tier-${c.tier}`);
  node.dataset.id = id;
  node.appendChild(el('span', 'chip-icon', ICON[id] || '❔'));
  node.appendChild(el('span', 'chip-name', c.name));
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

// ---- duel -----------------------------------------------------------------

/** One side of the duel: portrait, name, HP bar, live stat line. */
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

  const stats = el('div', 'duelist-stats');
  stats.appendChild(el('span', 'stat stat-atk', `⚔ ${fighter.atk}`));
  for (const k of keywordBadges({
    armour: fighter.armour, thorns: fighter.thorns, poison: fighter.poison,
    rally: fighter.rally, firstStrike: fighter.firstStrike,
  })) {
    stats.appendChild(el('span', `kw kw-${k.k}`, k.label));
  }
  mount.appendChild(stats);

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
