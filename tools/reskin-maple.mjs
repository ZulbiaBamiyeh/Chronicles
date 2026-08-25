// Force-overwrite card art with classic MapleStory sprites/icons.
//   node tools/reskin-maple.mjs

import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.dreamms.gg/api/GMS/latest';

const MOBS = {
  field_mouse: 100100,
  sewer_rat: 100101,
  wild_boar: 1210100,
  goblin_scrapper: 120100,
  giant_spider: 2230100,
  bandit_lookout: 1120100,
  bog_toad: 1210103,
  skeleton_picket: 1110101,
  feral_hound: 1210101,
  cave_troll: 5100000,
  marsh_wraith: 2230101,
  bandit_captain: 3210800,
  iron_golem: 5150000,
  ogre_brute: 3210100,
  wyvern_hatchling: 4130100,
  thornback_boar: 2130100,
  hill_giant: 3220000,
  basilisk: 4230100,
  dire_wolf: 5130104,
  forest_troll: 5140000,
  grave_knight: 5150001,
};

const ITEMS = {
  whetstone: 4130000,
  buckler: 1092008,
  travellers_boots: 1072001,
  rusty_sword: 1302000,
  leather_jerkin: 1050018,
  spiked_vambrace: 1082002,
  hunting_bow: 1452000,
  venom_flask: 2011000,
  battle_drum: 1002080,
  chainmail: 1050000,
  tower_shield: 1092014,
  steel_longsword: 1402000,
  assassins_kris: 1332001,
  warhorn: 1102001,
  serrated_axe: 1312000,
  basilisk_fang: 1332002,
  dragonplate: 1040103,
  runed_greatsword: 1402005,
  banner_of_the_vanguard: 1102051,
  executioners_blade: 1402002,
  plague_censer: 1382000,
  barbed_cuirass: 1050090,
  wyrmvenom_vial: 4000015,
  bramble_aegis: 1092000,
  iron_cap: 1002019,
  leather_gloves: 1082000,
  hunting_knife: 1332005,
  sling: 2070006,
  kite_shield: 1092003,
  war_pick: 1422000,
  scale_hauberk: 1051018,
  twin_daggers: 1332001,
  coated_blade: 1332007,
  rally_standard: 1002082,
  titan_maul: 1422010,
  wyrmfang_spear: 1432000,
  berserkers_axe: 1412000,
  shadowsteel_blade: 1402037,
  aegis_of_dawn: 1092046,
  crown_of_command: 1002006,
  reaver_plate: 1051017,
  grindstone: 1302021,
  venomfang_dagger: 1332002,
  serpent_scale_mail: 1041000,
  vanguards_edge: 1302020,
  vanguards_banner: 1092030,
  sentinel_plate: 1050000,
  sentinel_spikes: 4000015,
  berserkers_pact: 2049100,
  glass_cannon: 1382009,
  masters_forge: 1422027,
  coin_clipper: 4001129,
  rust_powder: 2040001,
  antidote_draught: 2050004,
  barb_file: 3010000,
};

const SKILLS = {
  torchbearer: 1111006,
  sparring_partner: 1101006,
  field_medic: 2301002,
  shieldbearer: 1001003,
  houndmaster: 3111005,
  quartermaster: 4101003,
  banner_squire: 1121000,
  venom_alchemist: 2111003,
  war_priest: 2301004,
  master_smith: 1101004,
  scout: 3000002,
  shield_maiden: 1221011,
  flanking_strike: 4001344,
  ambushers_nook: 4221001,
  berserkers_rite: 1311006,
  bloodforge: 1301007,
  gilded_edge: 4211006,
  vein_drain: 4101005,
  marked_quarry: 3221007,
  arcane_surge: 2121007,
  hollow_vigor: 2201004,
  wither: 2101005,
  training_yard: 1001004,
  ruined_chapel: 2311003,
  bramblelord: 1101007,
  wardens_oath: 1301006,
  toxinsmith: 2110001,
  ironblood_rite: 1311008,
  armsmaster: 1100000,
  reckless_thirst: 1320006,
  reckless_charge: 1121006,
  caltrops: 1201006,
  snare_wire: 4111004,
  dousing_rain: 2311001,
  hamstring: 2101003,
  ambush_pit: 4221001,
  purge_ritual: 2321008,
  sabotage: 4001002,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extOf(buf) {
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'webp';
  return null;
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { Accept: 'image/*,application/json' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 80 && extOf(buf) ? buf : null;
}

async function writePng(rel, buf) {
  const dest = path.join(ROOT, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  if (existsSync(dest)) await unlink(dest);
  await writeFile(dest, buf);
}

async function itemIcon(mapleId) {
  return fetchBuf(`${API}/item/${mapleId}/icon?format=png`);
}

async function mobStand(mapleId) {
  return (await fetchBuf(`${API}/mob/${mapleId}/render/stand?format=png`))
    || fetchBuf(`${API}/mob/${mapleId}/icon?format=png`);
}

async function skillIcon(skillId) {
  const res = await fetch(`${API}/job/skill/${skillId}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const json = await res.json();
  let b64 = json?.icon || json?.iconRaw;
  if (!b64 || typeof b64 !== 'string') return null;
  if (b64.includes(',')) b64 = b64.slice(b64.indexOf(',') + 1);
  const buf = Buffer.from(b64, 'base64');
  return buf.length > 80 && buf[0] === 0x89 ? buf : null;
}

async function mobAnim(mapleId, action) {
  return (await fetchBuf(`${API}/mob/animated/${mapleId}/${action}?format=gif`))
    || fetchBuf(`${API}/mob/animated/${mapleId}/${action}?format=webp`);
}

const SKILL_FOLDERS = new Set([
  'torchbearer', 'sparring_partner', 'field_medic', 'shieldbearer', 'houndmaster',
  'quartermaster', 'banner_squire', 'venom_alchemist', 'war_priest', 'master_smith',
  'scout', 'shield_maiden', 'flanking_strike', 'ambushers_nook', 'berserkers_rite',
  'bloodforge', 'gilded_edge', 'vein_drain', 'marked_quarry', 'arcane_surge',
  'hollow_vigor', 'wither', 'training_yard', 'ruined_chapel',
]);

async function main() {
  const jobs = [];

  for (const [id, maple] of Object.entries(MOBS)) {
    jobs.push(async () => {
      const buf = await mobStand(maple);
      if (!buf) return `${id} mob MISS`;
      await writePng(`assets/mobs/${id}.png`, buf);
      for (const [kind, action] of [['stand', 'stand'], ['attack', 'attack1']]) {
        const anim = await mobAnim(maple, action);
        if (!anim) continue;
        const ext = extOf(anim);
        const dest = path.join(ROOT, `assets/anims/mobs/${id}-${kind}.${ext}`);
        for (const old of ['gif', 'webp', 'png']) {
          const p = path.join(ROOT, `assets/anims/mobs/${id}-${kind}.${old}`);
          if (existsSync(p)) await unlink(p);
        }
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, anim);
      }
      return `${id} mob ok`;
    });
  }

  for (const [id, maple] of Object.entries(ITEMS)) {
    jobs.push(async () => {
      const buf = await itemIcon(maple);
      if (!buf) return `${id} item MISS`;
      await writePng(`assets/items/${id}.png`, buf);
      return `${id} item ok`;
    });
  }

  for (const [id, maple] of Object.entries(SKILLS)) {
    jobs.push(async () => {
      const buf = await skillIcon(maple);
      if (!buf) return `${id} skill MISS`;
      const folder = SKILL_FOLDERS.has(id) ? 'skills' : 'items';
      await writePng(`assets/${folder}/${id}.png`, buf);
      return `${id} skill ok`;
    });
  }

  let i = 0;
  const CONCURRENCY = 5;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      const msg = await job();
      const bad = /MISS/.test(msg);
      process.stdout.write(bad ? 'x' : '+');
      if (bad) console.log(' ', msg);
      await sleep(30);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
