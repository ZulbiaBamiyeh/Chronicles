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
npm run archetypes       # or: node tools/archetypes.mjs 2000
npm run card-coverage    # or: node tools/card-coverage.mjs 800
```

Three tools, three different questions. `balance.mjs` simulates runs with a
brute-force planner — it enumerates every ordered choice of four cards and
keeps the single best-scoring one, every round — and scores the result
against §12's tuning targets. `archetypes.mjs` asks whether each of the
game's four named strategies (Aggro, Tank, Poison, Rally) is actually worth
playing, not just a flavour label. `card-coverage.mjs` asks whether any of
the 70 cards is dead weight nobody ever wants.

### Ghosts are fixed snapshots, not opponents sized to fit

A ghost's stats are a pure function of `(round, wins, seed)` — see the
`PACING` note at the top of `js/ghosts.js`. This isn't a stylistic choice:
§2.1 and §8.1 describe ghosts as characters *uploaded once and fought by
strangers afterward*, and once this stops being a solo prototype and starts
reading real snapshots over the network, "two players draw the same ghost"
has to mean they fight the literal same opponent. A ghost that quietly
resized itself around whoever showed up to fight it would make that
impossible — it would still be single-player difficulty scaling, just
wearing async PvP's name. An earlier draft of this file took the *live*
player's post-path stats as an input and solved a ghost specifically sized
to them. It produced excellent duel pacing and was flatly incompatible with
the game this is a prototype *of* — worth calling out here because it's an
easy trap to fall back into while chasing a pacing number.

Duel pacing instead comes from anchoring every ghost to a *canonical*
round-N character — one sitting at the same point in §9's own ATK/max-HP
band the ghost itself was drawn from — and solving for the ATK, max HP, and
archetype keywords that make the fight against *that* character take a
target number of exchanges (§12's own 3–6 window), the way Chronicle's own
climactic "fight to the death" plays out over several real exchanges rather
than one. A real player who's well above or below that canonical band — from
skill, luck, or a good Spoil run — gets a fight that isn't perfectly matched
to them personally, the same way two real human players' snapshots wouldn't
be either. That's normal variance in an async PvP game, not something ghost
generation is responsible for erasing.

Where the numbers land, over 1000 runs of a greedy (brute-force) player:

- **Rounds ending floored at 1 HP: under 1%.** The doc calls starting max HP
  (20) the single riskiest number and asks for this to be checked before
  anything else. Tier 3 monsters are not routinely flooring players.
- **Duels run 4.4 exchanges on average, with ~80% landing in the §12 window.**
  Short duels (2.6 exchanges, well under half in-window) were the prototype's
  clearest early miss; fixed by the canonical-band pacing above.
- **Run completion: 42% for the maximizer, 20% for a cautious style** —
  close to §9's own 25–35%, without needing ghosts to bend around whoever's
  fighting them. Skill and playstyle produce a real, sensible spread; a
  perfect optimizer beating typical ghosts more than a cautious player does
  is the point, not a leak.
- **Path damage is lighter than the 30–50% target**, which is partly the
  planner being better at ordering than a person will be.

A MISS in that report is a tuning note, not a bug.

### Every archetype is a real way to play, not just Aggro/ATK

`§5`'s "loose triangle" — Aggro beats Poison, Tank beats Aggro, Poison beats
Tank, Rally beats Poison — only means something if committing to Tank,
Poison, or Rally is actually competitive with just stacking ATK. An earlier
check of this simulated *exclusive* single-keyword strategies (a "Tank" that
literally never buys an ATK card) and found Tank and Thorns crippled — 2–3%
run completion against 12–15%+ for everything else. That result was real but
misleading: no sane player plays that way, since ATK is on nearly every
useful card regardless of theme. `tools/archetypes.mjs` instead models a
player who *leans* into a stat family while still picking up the obviously
good cards along the way — a realistic committed build, not a synthetic
extreme — and the picture changes completely:

```
atk       completion= 21.8%  duelWin= 40.6%
tank      completion= 34.2%  duelWin= 47.8%
poison    completion= 31.7%  duelWin= 47.2%
rally     completion= 32.3%  duelWin= 47.0%
thorns    completion= 31.8%  duelWin= 47.2%
balanced  completion= 36.8%  duelWin= 50.2%
```

All four themed archetypes land within **2.5 points of completion** of each
other — Tank and Thorns are not just viable, they're indistinguishable in
strength from Poison and Rally. Pure ATK-stacking with no keyword synergy at
all is the *weakest* strategy of the six, meaning there's no "just buy ATK
gear and ignore keywords" dominant line to find. The balanced generalist
naturally does a little better than any single theme, which is expected —
adapting to what a hand actually deals should beat a fixed plan — but not
by enough to make committing to a theme feel like a trap.

### No dead cards

`tools/card-coverage.mjs` runs the same six strategies and records which of
the 70 cards each one ever actually chose. **All 70 get picked by at least
one strategy.** The rarest are almost entirely Tier 3 (fewer runs ever reach
round 5, so those cards get fewer opportunities to be dealt at all — that's
a sampling effect, not a balance problem) or cards that trade a resource
directly for their effect, like Ruined Chapel spending 2 ATK to heal to
full, which a strategy actively optimizing ATK correctly avoids.

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
