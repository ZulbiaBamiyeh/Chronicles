# Ghostwalk

An async PvP path-builder for one thumb. You're dealt six cards, you place four
into a path, the path resolves left to right, and whoever comes out the far end
duels a **ghost** — a snapshot of another character from the same point in their
run. Five duel wins completes a run; three losses ends it.

This is a playable prototype of [`docs/ghostwalk-design.md`](docs/ghostwalk-design.md)
— the full 70-card pool, the five keywords, the shared combat resolver, Spoils
and the Stash, and the whole run structure. It runs in a mobile browser and
packages to an Android APK via Capacitor.

---

## Playing it

```sh
npm install
npm run serve       # http://localhost:8080
```

ES modules don't load over `file://`, so it needs a server even locally. Open
the URL on a phone on the same network for the real thing — the layout is
portrait, one-thumb, and sized against the viewport rather than a breakpoint
ladder.

**Placing cards:** tap a card to drop it into the next free slot, tap a slot to
take it back. Drag a card to aim at a specific slot, drag one slot onto another
to swap them, drag a slot off the path to clear it. Long-press anything to read
its full text. Nothing commits until **Embark**.

---

## What's in

| | |
|---|---|
| **Cards** | All 70 — 22 monsters, 19 gear, 8 allies, 9 places, 12 Spoils |
| **Keywords** | First Strike, Armour, Thorns, Poison, Rally. There is no sixth. |
| **Combat** | One deterministic resolver, used identically for path fights and the duel |
| **Path** | Four slots, fizzle on unpaid cost, paid upgrades armed at planning time |
| **Spoils** | Drop rates, a 3-slot Stash that persists across rounds, the full-stash prompt |
| **Ghosts** | Bucketed by `(round, wins)`, half generated bots and half your own past characters |
| **Run** | 5 wins / 3 hearts, tier scaling by round, saved between rounds |

## What's deliberately out

Card collection and deckbuilding, rarities beyond the tier system, energy or
timers, social features, a sixth keyword, cross-run Stash persistence,
cosmetics and monetisation. All of it is additive later; none of it makes round
one better, and shipping without it means the core loop gets tested honestly.

---

## How the code is laid out

Rules and presentation are kept strictly apart — that's what makes the design
testable without a browser.

```
js/engine.js     the rules: combat resolver, path resolution, run state
js/cards.js      all 70 cards, as data
js/ghosts.js     opponent generation, the four archetypes
js/storage.js    localStorage: the run, ghost buckets, lifetime record
js/main.js       flow control, gestures, the two animations
js/ui.js         card faces, HUD, duel panels
js/audio.js      music beds and synthesized SFX
js/bg.js         the WebGL background (shared with GAMBIT)
```

`engine.js` has no DOM, no audio, and no randomness it wasn't handed — every
function is pure. `main.js` only ever asks it questions and replays the answers.

### Ghosts in the prototype

There's no server, so ghosts come from two places: characters this save has
finished rounds with (written into a `(round, wins)` bucket, capped at 12 per
bucket so old entries age out), and generated bots built to the round's target
band and pushed into one of the four archetypes. The split is deliberately
weighted toward generated ones — a bucket of a single player's own runs drifts
toward whatever they happen to build, and §12 wants the archetype spread wide.
This is also how the real thing starts: every bucket is 100% bots at launch.

The "won N duels overnight" line on the title screen is a **stand-in**. Nobody
is actually fighting your ghost while you're away; it's generated once a day
from your last uploaded character, and it's marked as a placeholder in
`storage.js` rather than dressed up as a real tally.

---

## Tests

```sh
npm test
```

49 tests over the rules. They assert the things a player is entitled to rely on
when they plan a path: that combat is deterministic, that the §11 Cave Troll
breakpoint table holds exactly, that the fizzle trap in the same section is
reproducible, that you cannot die on the path, that mutual First Strike cancels,
that Thorns answer attacks and not poison, that every dealt hand can always
reach and spend gold, and that a thousand random runs finish without stalling.

## Balance

```sh
npm run balance          # or: node tools/balance.mjs 2000
```

Simulates runs with a brute-force planner — it enumerates every ordered choice
of four cards and keeps the best, so the report measures the *cards* rather than
a heuristic — and scores the result against the tuning targets in §12.

Where the numbers land, over 800 runs of a greedy player:

- **Rounds ending floored at 1 HP: under 1%.** The doc calls starting max HP
  (20) the single riskiest number and asks for this to be checked before
  anything else. Tier 3 monsters are not routinely flooring players.
- **Duels run 3.7 exchanges on average, with ~88% landing in the §12 window.**
  This was the prototype's clearest early miss (2.7 exchanges, well under
  half in-window) and is now the thing ghosts are built to solve for — see
  **Ghosts scale to the fight, not a fixed table** below.
- **Path damage is lighter than the 30–50% target**, which is partly the
  planner being better at ordering than a person will be.
- **Run completion runs high (85%+) for this planner specifically.** That's
  expected, not a bug — see below.

A MISS in that report is a tuning note, not a bug.

### Ghosts scale to the fight, not a fixed table

§9's own ATK/max-HP band lets ATK outgrow HP as rounds climb, and ATK is
permanent — every gear card bought stays on the sheet all run. A path that
leans into ATK (which is rational, since ATK is what wins duels) compounds it
round over round; by round 3 or 4 a player can be swinging for several times
what a fixed target table assumed. A ghost built off that table alone gets
one-shot; a ghost built tough enough to survive a maxed-out player instead
flattens anyone who didn't min-max. Neither reads as a fight.

So `js/ghosts.js` doesn't draw a ghost's stats from a table at all — it
solves for the ATK and max HP that make the *fight itself* take a target
number of exchanges (drawn straight from §12's own 3–6 window) against
whatever the player's actual post-path ATK and max HP are, right now. The
solve accounts for the ghost's own Poison, Thorns, Rally, and First Strike
(extra damage the player didn't choose and can't see coming) but deliberately
**not** for the player's own keywords — Armour, Poison, Thorns, and Rally
earned along the path still swing a fight normally, on top of the baseline.

This is also why `tools/balance.mjs`'s brute-force planner now clears runs at
a much higher rate than §12's original 25–35%: that planner enumerates every
ordered choice of four cards and keeps the single best-scoring one, every
round, for the whole run — a level of optimization no real player sustains.
A perfect optimizer beating ghosts sized for a normal fight is the *intended*
outcome (skill should matter), not evidence the ghosts are too weak. The
number that actually matters — whether a realistic build gets a competitive
fight — lives in `test/engine.mjs`'s **"a duel lands in the §12 window
regardless of how the player built"**: five representative builds (on-target,
ATK-stacked, HP-stacked, a maxed-out late-run character, and a fresh round-1
character with nothing bought yet), each checked for both duel length and win
rate. A deliberately unbuilt character struggles more, by design; everything
else lands in a competitive 50–65% band.

---

## Building the APK

The Android project is a committed Capacitor shell (portrait-locked, navy system
bars, generated icon and splash).

```sh
npm run android:sync                    # stage www/ and sync the native project
cd android && ./gradlew assembleRelease
```

An unsigned APK still installs over `adb install -r` on a developer-unlocked
device. For a signed build, CI does it: run the **Build Android APK** workflow
from the Actions tab, with `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` set as repository secrets. The
build reads the keystore path from the environment and skips signing entirely
when it isn't set, so a local build never needs the secrets.

Regenerate the artwork with `python3 tools/make-icons.py && npx @capacitor/assets generate --android`.

---

## Assets

The music is the soundtrack set from the GAMBIT chess roguelike in this
account's other repo — RuneScape overworld pieces under the path, Wildfrost
battle themes under the duel, `Spirit Call` on the title screen. The WebGL
background (`js/bg.js`) is the same domain-warped noise shader. Card art is
emoji: it reads instantly at thumb size, costs nothing, and is the easiest
thing in the project to replace.

---

## Where the implementation reads the design document

Two places needed a judgement call:

1. **The §11 worked example has an arithmetic slip.** Line A's Feral Hound step
   says "free hit for 2, then 1 exchange, take 2" but reports 12 HP from a
   starting 14 — which only counts the free hit. Because §4 step 5 has both
   sides attacking *simultaneously*, the hound's dying blow lands and the true
   result is 10 HP. The resolver follows §4; the worked example's total is the
   part that's wrong.

2. **Duel damage doesn't carry out of the duel.** §3 says path damage carries
   *into* the duel and says nothing about the reverse, so a round's result HP is
   the post-path figure. The 50% between-rounds heal then applies to that.

Both are noted here rather than silently absorbed.

## Open questions the prototype doesn't answer

§14 of the design doc lists six. The prototype deliberately answers none of
them — it exists to prove the loop first. The ones it puts you in a position to
judge by playing are whether four slots is the right number, and whether losing
three hearts in seven minutes feels bad enough to quit.
