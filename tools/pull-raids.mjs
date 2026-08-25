import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.dreamms.gg/api/GMS/latest';
const MOBS = {
  curse_eye: 9300002,
  horny_mushroom: 2110200,
  iron_hog: 4230103,
  king_clang: 5220000,
  taurospear: 7130101,
  lucida: 7130000,
};

function extOf(buf) {
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'gif';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'webp';
  return null;
}
async function fetchBuf(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > 80 && extOf(buf) ? buf : null;
}
async function first(urls) {
  for (const u of urls) { const b = await fetchBuf(u); if (b) return b; }
  return null;
}
async function save(rel, urls) {
  const buf = await first(urls);
  if (!buf) return false;
  const dest = path.join(ROOT, `${rel}.${extOf(buf)}`);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  return true;
}
for (const [id, maple] of Object.entries(MOBS)) {
  const ok = await save(`assets/mobs/${id}`, [
    `${API}/mob/${maple}/render/stand?format=png`, `${API}/mob/${maple}/icon?format=png`,
  ]);
  await save(`assets/anims/mobs/${id}-stand`, [
    `${API}/mob/animated/${maple}/stand?format=gif`, `${API}/mob/${maple}/render/stand?format=png`,
  ]);
  await save(`assets/anims/mobs/${id}-attack`, [
    `${API}/mob/animated/${maple}/attack1?format=gif`, `${API}/mob/animated/${maple}/skill?format=gif`,
  ]);
  console.log(id, ok ? 'ok' : 'FAIL');
}
