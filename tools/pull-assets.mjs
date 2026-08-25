// Pull MapleStory sprites used by maples.im (maplestory.io / DreamMS API)
// into assets/{mobs,items,skills,chars}/ so the game runs offline.
// Allies, places, and rites use item or skill icons — not NPC stand sprites.
//
//   node tools/pull-assets.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.dreamms.gg/api/GMS/latest';

const MOBS = {
  field_mouse: [100100, 100101, 120100],
  sewer_rat: [100101, 100100, 1210102],
  wild_boar: [1210100, 1210101, 3210100],
  goblin_scrapper: [120100, 1110100, 1210102],
  giant_spider: [2230100, 2230101, 1110100],
  bandit_lookout: [1120100, 1210101, 3210800],
  bog_toad: [1210103, 1110100, 120100],
  skeleton_picket: [1110101, 2130100, 130100],
  feral_hound: [1210101, 1210100, 1120100],
  cave_troll: [5100000, 5100001, 5140000],
  marsh_wraith: [2230101, 2230100, 1110100],
  bandit_captain: [3210800, 1210100, 1120100],
  iron_golem: [5150000, 5150001, 1110101],
  ogre_brute: [3210100, 1210100, 2130100],
  wyvern_hatchling: [4130100, 4230100, 3220000],
  thornback_boar: [2130100, 1110101, 130100],
  hill_giant: [3220000, 120100, 130100],
  basilisk: [4230100, 2230100, 2230101],
  stone_warden: [5150000, 5150001, 1110101],
  chimera: [8180001, 8180000, 4130100],
  elder_wyrm: [8180000, 8180001, 4130100],
  flame_imp: [3210100, 4230100, 120100],
  dire_wolf: [5130104, 5140000, 5100000],
  forest_troll: [5140000, 5100000, 5130104],
  grave_knight: [5150001, 5150000, 1110101],
  bog_horror: [6220000, 1210103, 2230101],
  frost_wraith: [5140000, 5100000, 5130104],
  warlord_of_ash: [8130100, 3220000, 5150000],
};

const ITEMS = {
  whetstone: [4130000, 4031624, 4030001, 4011000],
  buckler: [1092008, 1092005, 1092000],
  travellers_boots: [1072001, 1072005, 1072031],
  rusty_sword: [1302000, 1302001, 1302007],
  leather_jerkin: [1050018, 1051017, 1040002],
  spiked_vambrace: [1082002, 1082000, 1082003],
  hunting_bow: [1452000, 1452001, 1452002],
  venom_flask: [2000003, 2022000, 2050004],
  battle_drum: [1002080, 1002082, 1102000],
  chainmail: [1040080, 1040005, 1050000],
  tower_shield: [1092003, 1092005, 1092008],
  steel_longsword: [1402000, 1402001, 1302007],
  assassins_kris: [1332000, 1332001, 1332002],
  warhorn: [1102000, 1102001, 1302021],
  serrated_axe: [1312000, 1312001, 1412000],
  basilisk_fang: [1332011, 1332007, 1332000],
  dragonplate: [1050099, 1050018, 1040103],
  runed_greatsword: [1402005, 1402002, 1402000],
  banner_of_the_vanguard: [1102041, 1102000, 1092046],
  executioners_blade: [1312015, 1402046, 1412000],
  plague_censer: [1382000, 1372000, 1322000],
  barbed_cuirass: [1041000, 1050000, 1040005],
  wyrmvenom_vial: [2020013, 2022000, 2002000],
  bramble_aegis: [1092010, 1092008, 1092003],
  iron_cap: [1002019, 1002080, 1002001],
  leather_gloves: [1082000, 1082001, 1082002],
  hunting_knife: [1332000, 1332005, 1332001],
  sling: [2070006, 2070000, 2070007],
  kite_shield: [1092002, 1092003, 1092000],
  war_pick: [1422000, 1432000, 1312000],
  scale_hauberk: [1050000, 1041040, 1040005],
  twin_daggers: [1332005, 1332001, 1332000],
  coated_blade: [1332007, 1332011, 1332000],
  rally_standard: [1102000, 1102041, 1092046],
  titan_maul: [1422011, 1442000, 1422000],
  wyrmfang_spear: [1432000, 1432001, 1432002],
  berserkers_axe: [1412000, 1312015, 1412001],
  shadowsteel_blade: [1402009, 1402005, 1332007],
  aegis_of_dawn: [1092049, 1092010, 1092008],
  crown_of_command: [1002006, 1002010, 1002001],
  reaver_plate: [1050018, 1050099, 1040103],
  grindstone: [4030001, 4130000, 4011001],
  venomfang_dagger: [1332011, 1332007, 1332000],
  serpent_scale_mail: [1041047, 1050000, 1041000],
  vanguards_edge: [1302007, 1402000, 1302001],
  vanguards_banner: [1102041, 1102000, 1092046],
  sentinel_plate: [1050090, 1050018, 1040103],
  sentinel_spikes: [1082102, 1082002, 1092010],
  berserkers_pact: [4031161, 2022000, 2040002],
  reckless_charge: [2040002, 2043000, 1302000],
  glass_cannon: [1372000, 1382000, 2040002],
  bramblelord: [4031347, 4000016, 1092010],
  wardens_oath: [4031039, 1092003, 4030001],
  toxinsmith: [4031913, 2022000, 1382000],
  ironblood_rite: [4031161, 2000003, 2022000],
  armsmaster: [1302007, 1402000, 4030001],
  masters_forge: [4031348, 1402005, 1022003],
  reckless_thirst: [2022000, 2000003, 4031161],
  caltrops: [2070000, 2060000, 4000016],
  rust_powder: [4031456, 4004000, 4011000],
  snare_wire: [4006000, 2070000, 4030001],
  antidote_draught: [2050004, 2050000, 2000003],
  dousing_rain: [2020013, 2000006, 2022000],
  barb_file: [4030001, 4130000, 1312000],
  hamstring: [4000016, 2070000, 1332000],
  ambush_pit: [4031161, 4006000, 2070000],
  purge_ritual: [2020015, 2050000, 2022000],
  sabotage: [4031456, 2070000, 4006000],
  coin_clipper: [4001129, 4031039, 4001208],
  roadside_shrine: [3010019, 4031475, 2020015],
  market_square: [4001208, 4001129, 4031138],
  blacksmith: [1302021, 1422027, 4011001],
  boneyard: [4000208, 4000206, 4000207],
  watchtower: [2060000, 4001019, 1462000],
  toll_bridge: [2030000, 2030001, 4001019],
  standing_stones: [4011007, 4021007, 4005000],
  hidden_cache: [4001016, 2100000, 4031138],
  the_arena: [4001259, 2044000, 1302021],
  sacred_spring: [2022000, 2000005, 2000006],
  war_camp: [1012025, 1002018, 1102000],
  dragon_altar: [4001017, 4001018, 2041200],
  scavengers_cache: [4000000, 4000002, 2100000],
  ritual_circle: [2049100, 4006000, 4005000],
};

// Skill icons come from /job/skill/{id} JSON (base64 PNG), not NPC sprites.
const SKILLS = {
  torchbearer: [1111006, 2301002, 4101005],
  sparring_partner: [1101006, 1001004, 1111008],
  field_medic: [2301002, 2301004, 2311001],
  shieldbearer: [1001003, 1301006, 1201006],
  houndmaster: [3111005, 3211005, 3111003],
  quartermaster: [4101003, 4201003, 4201004],
  banner_squire: [1121000, 1111002, 1301007],
  venom_alchemist: [2111003, 2101005, 2111002],
  war_priest: [2301004, 2311003, 2321008],
  master_smith: [1101004, 1100000, 1001004],
  scout: [3000002, 4001003, 3221007],
  shield_maiden: [1221011, 1221004, 1001003],
  training_yard: [1001004, 1101006, 1001005],
  ruined_chapel: [2311003, 2321008, 2311001],
  flanking_strike: [1121008, 1001005, 4121004],
  ambushers_nook: [4221001, 4001003, 4121004],
  berserkers_rite: [1111008, 1311006, 1121002],
  bloodforge: [1311008, 1311005, 1121010],
  gilded_edge: [4211006, 4201004, 4001344],
  vein_drain: [4101005, 1111005, 1311005],
  marked_quarry: [3221007, 3101005, 3001004],
  arcane_surge: [2121007, 2001005, 2221006],
  hollow_vigor: [1301007, 1301006, 2001003],
  wither: [2101005, 2111003, 2311001],
};

const CHARS = {
  player: '2000/30030,20000,1040002,1060002,1072001,1302000',
  aggro: '2000/30020,20004,1002001,1040080,1060005,1072005,1402000',
  tank: '2000/30000,20000,1002002,1050000,1072015,1092003,1302007',
  poison: '2000/30060,20008,1002008,1041000,1061000,1072001,1332000',
  rally: '2000/30040,20001,1002006,1040036,1060026,1072005,1102000,1412000',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { Accept: 'image/png,image/webp,*/*' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 80) return null;
  // PNG magic or WEBP 'RIFF'
  if (buf[0] === 0x89 && buf[1] === 0x50) return buf;
  if (buf[0] === 0x52 && buf[1] === 0x49) return buf;
  return null;
}

async function firstHit(urls) {
  for (const url of urls) {
    const buf = await fetchBuf(url);
    if (buf) return buf;
  }
  return null;
}

async function save(kind, id, ids, buildUrls) {
  const dest = path.join(ROOT, 'assets', kind, `${id}.png`);
  if (existsSync(dest)) return { id, kind, ok: true, cached: true };
  const buf = await firstHit(ids.flatMap(buildUrls));
  if (!buf) return { id, kind, ok: false };
  await writeFile(dest, buf);
  return { id, kind, ok: true, bytes: buf.length };
}

async function saveSkill(id, skillIds) {
  const dest = path.join(ROOT, 'assets', 'skills', `${id}.png`);
  if (existsSync(dest)) return { id, kind: 'skills', ok: true, cached: true };
  for (const skillId of skillIds) {
    const res = await fetch(`${API}/job/skill/${skillId}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) continue;
    const json = await res.json();
    let b64 = json.icon || json.iconRaw;
    if (!b64 || typeof b64 !== 'string') continue;
    if (b64.includes(',')) b64 = b64.slice(b64.indexOf(',') + 1);
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < 80 || buf[0] !== 0x89 || buf[1] !== 0x50) continue;
    await writeFile(dest, buf);
    return { id, kind: 'skills', ok: true, bytes: buf.length };
  }
  return { id, kind: 'skills', ok: false };
}

async function main() {
  for (const d of ['mobs', 'items', 'skills', 'chars']) {
    await mkdir(path.join(ROOT, 'assets', d), { recursive: true });
  }

  const jobs = [];
  for (const [id, mapleIds] of Object.entries(MOBS)) {
    jobs.push(() => save('mobs', id, mapleIds, (m) => [
      `${API}/mob/${m}/render/stand?format=png`,
      `${API}/mob/${m}/icon?format=png`,
    ]));
  }
  for (const [id, mapleIds] of Object.entries(ITEMS)) {
    jobs.push(() => save('items', id, mapleIds, (m) => [
      `${API}/item/${m}/icon?format=png`,
    ]));
  }
  for (const [id, skillIds] of Object.entries(SKILLS)) {
    jobs.push(() => saveSkill(id, skillIds));
  }
  for (const [id, items] of Object.entries(CHARS)) {
    jobs.push(() => save('chars', id, [items], (m) => [
      `${API}/character/${m}/stand1/0?format=png&resize=2`,
    ]));
  }

  let ok = 0;
  let fail = 0;
  const failed = [];
  // Modest concurrency so we don't trip the public API.
  const CONCURRENCY = 6;
  let i = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      const result = await job();
      if (result.ok) {
        ok++;
        process.stdout.write(result.cached ? '.' : '+');
      } else {
        fail++;
        failed.push(`${result.kind}/${result.id}`);
        process.stdout.write('x');
      }
      await sleep(40);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write('\n');
  console.log(`saved ${ok}, missed ${fail}`);
  if (failed.length) console.log('missed:', failed.join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
