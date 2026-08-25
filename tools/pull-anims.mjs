// Attack/stand GIFs from the same MapleStory API maples.im uses.
//   node tools/pull-anims.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.dreamms.gg/api/GMS/latest';

const MOBS = {
  field_mouse: 100100, sewer_rat: 100101, wild_boar: 1210100, goblin_scrapper: 120100,
  giant_spider: 2230100, bandit_lookout: 1120100, bog_toad: 1210103, skeleton_picket: 1110101,
  feral_hound: 1210101, cave_troll: 5100000, marsh_wraith: 2230101, bandit_captain: 3210800,
  iron_golem: 5150000, ogre_brute: 3210100, wyvern_hatchling: 4130100, thornback_boar: 2130100,
  hill_giant: 3220000, basilisk: 4230100, stone_warden: 8160000, chimera: 8180001,
  elder_wyrm: 8180000, flame_imp: 4230126, dire_wolf: 5130104, forest_troll: 5140000,
  grave_knight: 5150001, bog_horror: 6220000, frost_wraith: 3230102, warlord_of_ash: 8130100,
};

const CHARS = {
  player: { path: '2000/30030,20000,1040002,1060002,1072001,1302000', attack: 'swingO1' },
  aggro: { path: '2000/30020,20004,1002001,1040080,1060005,1072005,1402000', attack: 'swingT1' },
  tank: { path: '2000/30000,20000,1002002,1050000,1072015,1092003,1302007', attack: 'swingO1' },
  poison: { path: '2000/30060,20008,1002008,1041000,1061000,1072001,1332000', attack: 'stabO1' },
  rally: { path: '2000/30040,20001,1002006,1040036,1060026,1072005,1102000,1412000', attack: 'swingT1' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extOf(buf) {
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'webp';
  return null;
}

async function fetchBuf(url) {
  const res = await fetch(url, { headers: { Accept: 'image/gif,image/webp,image/png,*/*' } });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 80) return null;
  return extOf(buf) ? buf : null;
}

async function firstHit(urls) {
  for (const url of urls) {
    const buf = await fetchBuf(url);
    if (buf) return buf;
  }
  return null;
}

async function save(rel, urls) {
  const gif = path.join(ROOT, rel.replace(/\.\w+$/, '.gif'));
  const webp = path.join(ROOT, rel.replace(/\.\w+$/, '.webp'));
  if (existsSync(gif) || existsSync(webp)) return { ok: true, cached: true };
  const buf = await firstHit(urls);
  if (!buf) return { ok: false };
  const ext = extOf(buf);
  const dest = path.join(ROOT, rel.replace(/\.\w+$/, `.${ext}`));
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return { ok: true, bytes: buf.length };
}

async function main() {
  await mkdir(path.join(ROOT, 'assets/anims/mobs'), { recursive: true });
  await mkdir(path.join(ROOT, 'assets/anims/chars'), { recursive: true });

  const jobs = [];
  for (const [id, maple] of Object.entries(MOBS)) {
    jobs.push(() => save(`assets/anims/mobs/${id}-stand.gif`, [
      `${API}/mob/animated/${maple}/stand?format=gif`,
      `${API}/mob/animated/${maple}/stand?format=webp`,
      `${API}/mob/${maple}/render/stand?format=png`,
    ]));
    jobs.push(() => save(`assets/anims/mobs/${id}-attack.gif`, [
      `${API}/mob/animated/${maple}/attack1?format=gif`,
      `${API}/mob/animated/${maple}/skill?format=gif`,
      `${API}/mob/animated/${maple}/attack2?format=gif`,
      `${API}/mob/animated/${maple}/attack1?format=webp`,
      `${API}/mob/${maple}/render/attack1?format=png`,
    ]));
  }
  for (const [id, c] of Object.entries(CHARS)) {
    jobs.push(() => save(`assets/anims/chars/${id}-stand.gif`, [
      `${API}/character/animated/${c.path}/stand1?format=gif`,
      `${API}/character/animated/${c.path}/stand1?format=webp`,
    ]));
    jobs.push(() => save(`assets/anims/chars/${id}-attack.gif`, [
      `${API}/character/animated/${c.path}/${c.attack}?format=gif`,
      `${API}/character/animated/${c.path}/swingO1?format=gif`,
      `${API}/character/animated/${c.path}/${c.attack}?format=webp`,
    ]));
  }

  let i = 0, ok = 0, fail = 0;
  const missed = [];
  async function worker() {
    while (i < jobs.length) {
      const job = jobs[i++];
      const r = await job();
      if (r.ok) { ok++; process.stdout.write(r.cached ? '.' : '+'); }
      else { fail++; missed.push(String(i)); process.stdout.write('x'); }
      await sleep(30);
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  process.stdout.write('\n');
  console.log(`saved ${ok}, missed ${fail}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
