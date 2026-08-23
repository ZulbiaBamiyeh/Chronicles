// Stages the static site into www/ for Capacitor's webDir. There is no build
// step for the game itself — this just copies the files the app actually loads
// at runtime and leaves out everything that's only there for development
// (test/, tools/, docs/, resources/, node_modules, .git).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const www = join(root, 'www');

rmSync(www, { recursive: true, force: true });
mkdirSync(www, { recursive: true });

const files = ['index.html'];
const dirs = ['css', 'js', 'fonts', 'Music'];

for (const f of files) {
  const src = join(root, f);
  if (existsSync(src)) cpSync(src, join(www, f));
}
for (const d of dirs) {
  const src = join(root, d);
  if (existsSync(src)) cpSync(src, join(www, d), { recursive: true });
}

console.log(`Staged the site into ${www}`);
