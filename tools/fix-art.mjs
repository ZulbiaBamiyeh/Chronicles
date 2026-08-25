// Overwrite mismatched MapleStory sprites with ones that actually look
// like the cards. Same API as maples.im.
import { mkdir, writeFile } from 'node:fs/promises';
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
  stone_warden: 8160000,
  chimera: 8180001,
  elder_wyrm: 8180000,
  flame_imp: 4230126,
  dire_wolf: 5130104,
  forest_troll: 5140000,
  grave_knight: 5150001,
  bog_horror: 6220000,
  frost_wraith: 3230102,
  warlord_of_ash: 8130100,
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
  basilisk_fang: 1332000,
  dragonplate: 1040103,
  runed_greatsword: 1402005,
  banner_of_the_vanguard: 1102051,
  executioners_blade: 1402002,
  plague_censer: 1382000,
  barbed_cuirass: 1050090,
  wyrmvenom_vial: 2050004,
  bramble_aegis: 1092010,
  iron_cap: 1002019,
  leather_gloves: 1082000,
  hunting_knife: 1332005,
  sling: 2070006,
  kite_shield: 1092004,
  war_pick: 1422000,
  scale_hauberk: 1050000,
  twin_daggers: 1332001,
  coated_blade: 1332007,
  rally_standard: 1102001,
  titan_maul: 1422010,
  wyrmfang_spear: 1432000,
  berserkers_axe: 1412000,
  shadowsteel_blade: 1402037,
  aegis_of_dawn: 1092014,
  crown_of_command: 1002006,
  reaver_plate: 1040103,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extOf(buf) {
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'webp';
  return null;
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { Accept: 'image/*' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 80 && extOf(buf) ? buf : null;
}

async function firstHit(urls) {
  for (const url of urls) {
    const buf = await fetchBuf(url);
    if (buf) return buf;
  }
  return null;
}

async function save(relNoExt, urls) {
  const buf = await firstHit(urls);
  if (!buf) return false;
  const ext = extOf(buf);
  const dest = path.join(ROOT, `${relNoExt}.${ext}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return true;
}

async function main() {
  const jobs = [];
  for (const [id, maple] of Object.entries(MOBS)) {
    jobs.push(async () => {
      const ok = await save(`assets/mobs/${id}`, [
        `${API}/mob/${maple}/render/stand?format=png`,
        `${API}/mob/${maple}/icon?format=png`,
      ]);
      const stand = await save(`assets/anims/mobs/${id}-stand`, [
        `${API}/mob/animated/${maple}/stand?format=gif`,
        `${API}/mob/${maple}/render/stand?format=png`,
      ]);
      const atk = await save(`assets/anims/mobs/${id}-attack`, [
        `${API}/mob/animated/${maple}/attack1?format=gif`,
        `${API}/mob/animated/${maple}/skill?format=gif`,
        `${API}/mob/${maple}/render/attack1?format=png`,
      ]);
      return [id, ok, stand, atk];
    });
  }
  for (const [id, maple] of Object.entries(ITEMS)) {
    jobs.push(async () => {
      const ok = await save(`assets/items/${id}`, [
        `${API}/item/${maple}/icon?format=png`,
      ]);
      return [id, ok];
    });
  }

  let i = 0, ok = 0, fail = 0;
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      const r = await job();
      if (r[1]) { ok++; process.stdout.write('+'); }
      else { fail++; process.stdout.write('x'); console.log(' miss', r[0]); }
      await sleep(25);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`\ndone ok=${ok} fail=${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
