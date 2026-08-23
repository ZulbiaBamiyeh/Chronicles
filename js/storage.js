// Everything is saved between rounds — §2.1 step 7. There is no server in the
// prototype, so the "ghost upload" is a local record: your character at the end
// of each round is written to a bucket keyed by (round, wins), and future runs
// can draw from it. That makes the very first thing you fight in a fresh run a
// previous version of yourself, which is a decent stand-in for a real pool.

const KEY = 'ghostwalk.v1';

const BLANK = {
  run: null,               // the in-progress run, or null
  lifetime: { runs: 0, completed: 0, duelsWon: 0, duelsLost: 0 },
  ghosts: {},              // "round:wins" -> ghost[]
  lastGhostReport: null,   // the "won N duels overnight" line for the menu
  settings: { music: true, sfx: true, speed: 1 },
  deck: null,              // the player's 30-card deck, or null for the default
};

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...structuredClone(BLANK), ...JSON.parse(raw) } : structuredClone(BLANK);
  } catch {
    cache = structuredClone(BLANK);
  }
  return cache;
}

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // A full or blocked storage quota shouldn't take the game down with it —
    // the run just won't survive a reload.
  }
}

export const load = () => read();

export function saveRun(run) {
  read().run = run;
  write();
}

export function clearRun() {
  read().run = null;
  write();
}

/** The player's saved deck, or null if they've never built one. */
export const deck = () => read().deck;

export function saveDeck(ids) {
  read().deck = [...ids];
  write();
}

export function settings() {
  return read().settings;
}

export function setSetting(key, value) {
  read().settings[key] = value;
  write();
}

export function recordDuel(won) {
  const s = read();
  if (won) s.lifetime.duelsWon++;
  else s.lifetime.duelsLost++;
  write();
}

export function recordRunStart() {
  read().lifetime.runs++;
  write();
}

export function recordRunEnd(completed) {
  const s = read();
  if (completed) s.lifetime.completed++;
  write();
}

/**
 * Store a ghost in its (round, wins) bucket. Buckets are capped so a long-lived
 * save doesn't grow without bound, and new entries push out old ones — the
 * cheap version of the rolling window §14.5 asks for, so a ghost built against
 * an older balance pass eventually ages out.
 */
export function uploadGhost(ghost) {
  const s = read();
  const key = `${ghost.round}:${ghost.wins}`;
  const bucket = (s.ghosts[key] ||= []);
  bucket.push(ghost);
  if (bucket.length > 12) bucket.splice(0, bucket.length - 12);
  write();
}

/** A stored ghost from the bucket, or null if the bucket is thin. */
export function drawStoredGhost(round, wins, r) {
  const bucket = read().ghosts[`${round}:${wins}`];
  if (!bucket || !bucket.length) return null;
  return structuredClone(bucket[Math.floor(r() * bucket.length)]);
}

/**
 * §8.4 — "Torvald won 6 duels overnight." In the prototype nobody is actually
 * fighting your ghost while you're away, so the line is generated from your own
 * last uploaded ghost the first time you open the app on a new day. It's a
 * placeholder for a real server tally, and it's marked as one in the README
 * rather than dressed up as a real result.
 */
export function ghostReport(rand = Math.random) {
  const s = read();
  const today = new Date().toISOString().slice(0, 10);
  if (s.lastGhostReport?.day === today) return s.lastGhostReport;

  const all = Object.values(s.ghosts).flat();
  if (!all.length) return null;
  const latest = all[all.length - 1];
  const report = {
    day: today,
    name: latest.name,
    won: Math.floor(rand() * 9),
    simulated: true,
  };
  s.lastGhostReport = report;
  write();
  return report;
}
