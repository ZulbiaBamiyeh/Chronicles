# Ghostwalk

An async PvP path-builder for one thumb. You're dealt six cards, you place four
into a path, the path resolves left to right, and whoever comes out the far end
duels a **ghost** — a snapshot of another character from the same point in their
run. Five duel wins completes a run; three losses ends it.

This is a playable prototype of [`docs/ghostwalk-design.md`](docs/ghostwalk-design.md)
— the card pool, the five keywords, the shared combat resolver, and the
whole run structure. It runs in a mobile browser and packages to an Android
APK via Capacitor.

Spoils and the Stash are cut from this pass: they were the only source of
randomness in path resolution, and dropping them keeps a path's outcome a
pure function of the four cards placed into it — one less thing to reconcile
once ghosts and paths are real snapshots read over the network instead of
local state.

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
| **Cards** | 119 — 28 monsters, 48 gear, 13 allies, 20 places, 10 secrets |
| **Builds** | Cards that read the rest of your character: Armour paid out as Thorns, a weapon you sharpen all run, payoffs that scale with what you already committed to |
| **Ordering** | Cards that read their neighbours in the path, so the same four cards are worth more in the right order |
| **Keywords** | First Strike, Armour, Thorns, Poison, Rally. There is no sixth. |
| **Combat** | One deterministic resolver, used identically for path fights and the duel |
| **Card faces** | Hearthstone's corner grammar: cost top-left, ATK bottom-left, HP/Armour bottom-right, art in a tinted well between them |
| **Animation** | Both fight types replay exchange-by-exchange off the resolver's own log, and every blow is drawn as the thing that threw it — sword arc, arrow in flight, claw rake, troll shockwave, dragon fire |
| **Equipment panel** | An OSRS/MapleStory-style fixed slot grid on each fighter showing the *actual item* worn in each slot, pulsing the slot a hit came from |
| **Path** | Four slots, fizzle on unpaid cost, paid upgrades armed at planning time |
| **Trophies** | Every Tier 2 and Tier 3 monster leaves a permanent upgrade on top of its gold |
| **Ghosts** | Bucketed by `(round, wins)`, half generated bots and half your own past characters, each carrying a generated inventory |
| **Run** | 5 wins / 3 hearts, tier scaling by round, saved between rounds |

## What's deliberately out

Card collection and deckbuilding, rarities beyond the tier system, energy or
timers, social features, a sixth keyword, Spoils and the Stash, cosmetics and
monetisation. All of it is additive later; none of it makes round one better,
and shipping without it means the core loop gets tested honestly.

---

## How the code is laid out

Rules and presentation are kept strictly apart — that's what makes the design
testable without a browser.

```
js/engine.js     the rules: combat resolver, path resolution, run state
js/cards.js      all 119 cards, as data
js/ghosts.js     opponent generation, the four archetypes
js/storage.js    localStorage: the run, ghost buckets, lifetime record
js/main.js       flow control, gestures, the shared exchange-by-exchange replay
js/ui.js         card faces, HUD, duel panels, the equipment slot grid
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

88 tests over the rules. They assert the things a player is entitled to rely on
when they plan a path: that combat is deterministic, that the §11 Cave Troll
breakpoint table holds exactly, that the fizzle trap in the same section is
reproducible, that you cannot die on the path, that mutual First Strike cancels,
that Thorns answer attacks and not poison, that every dealt hand can always
reach and spend gold, and that a thousand random runs finish without stalling.
They also pin down what each build-scaling card is actually worth, that every
day opens with more cards than the path has slots, that all five preset decks
are legal, and that no scaling card is left sitting in a deck nobody plays.

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
the 119 cards is dead weight nobody ever wants.

### Why the harder monsters are worth fighting

A path where every monster paid only gold made Tier 1 strictly correct: same
currency, less risk. So every Tier 2 and Tier 3 monster now leaves a
**trophy** — a permanent upgrade — and the keyword ones leave *their* keyword.
The Iron Golem gives Armour, the Basilisk gives Poison, the Thornback Boar
gives Thorns, the Elder Wyrm gives Rally. Fighting the scary thing is how you
become the thing that carries that keyword, which is the shape Chronicle's own
chapters have: the dangerous fight is the one that pays.

Two gaps fell out of checking this. Poison and Thorns existed **only** as Tier
1 gear, so a player committing to either had nothing left to buy from round 4
on — the archetype was reachable early and then quietly stranded. Rally had no
Tier 1 entry at all, so it could never be started early. Five cards close both
(Plague Censer, Barbed Cuirass, Wyrmvenom Vial, Bramble Aegis, Battle Drum),
and a test now asserts the general rule: a keyword you can *start* building has
to stay buyable at every tier above, or committing to it is a trap the player
can't see coming.

Trophies made characters climb faster than §9's table assumed, so the ghost
band is nudged up from round 3 to match. In the shipped game that corrects
itself for free — ghosts *are* real players, who collected the same trophies —
so this is the bot pool standing in for that, not a difficulty thumb on the
scale. After both changes: 32.0% run completion for the brute-force planner
(inside §9's own 25–35%), 40.9% duel win rate, 4.03 mean exchanges with 79.7%
of duels inside §12's 3–6 window.

### The hand used to shrink every day

The single worst bug the prototype had, and it hid in plain sight behind a
comment describing the intended shape. A day drew a fixed three cards against
a four-slot path, so a run went 6, 5, 4, 3 — and from day four on you held
*fewer cards than the path had slots*. The back half of every run asked you
nothing: you placed what you had because it was all you had. The draw now tops
the hand back up to a full six each day, so the choice-to-slots ratio is the
same on day five as on day one.

Fixing it made a real character enormously stronger — four *chosen* cards a
day instead of whatever remained.

### The balance tools were never measuring what a player actually plays

Every balance number in this file before this section was wrong, including
the ones this file itself reported earlier the same night. `tools/balance.mjs`
and `tools/archetypes.mjs` both called `newRun(seed)` with no deck argument,
which draws a hand from the entire 119-card pool undifferentiated — never
from the 30-card preset a real run is actually played on. A themed deck
concentrates exactly the cards its build depends on; measuring against the
full pool diluted that so heavily that the sweep read as moderate when real
play was a stomp. Fixed by passing an actual preset to every simulated run: a
default-deck ("The Wanderer") player immediately measured at **94% run
completion and an 84% duel win rate** — not the 25–35% the doc calls for by a
wide margin. This is what "I got 25 ATK easily on day 3" and "mobs are
laughably easy" actually was: the game had never been measured the way it was
being played.

Getting the ghost band to catch up to that also found a real bug in the
pacing math, not just a stale number. A ghost's max HP is solved from
`dmgToGhost * killGhostIn` — its canonical attacker's damage per hit times how
many hits it should take to kill it — with nothing holding that product down.
That's fine for Aggro ghosts, whose `killGhostIn` is small (2.5–3.8), but
Tank, Poison, and Rally all target 5–6.8 exchanges to kill, and that many
exchanges of canonical ATK compounds into HP with no relationship at all to
`canonMaxHp`, the number that's supposed to describe how tanky a round-N
character actually is. A Poison ghost at round 3 measured out at **113 max
HP** against a 24–32 canonical band for that round — about four times what
anyone at that point in a run could plausibly survive fighting, let alone
whittle down. Capped at a multiple of `canonMaxHp` now; see the `targetHp`
comment in `js/ghosts.js`.

With both of those fixed, the ghost band was retuned a final time directly
against what `balance.mjs`'s planner reaches on the default deck, day by day,
rather than against §9's original table (itself derived for a much shallower
card pool than this one has grown into). Landed at **27.0% run completion,
36.2% duel win rate**, nothing floored at 1 HP, and a day-by-day curve of
roughly 40/31/34/42/38 — no day is a formality, none of them is a wall.

### The four archetypes are not close to equally viable, and this file's earlier claim that they were is wrong

An earlier pass of this section reported all four themed archetypes within
4 points of run completion of each other. That number came from the same
undifferentiated-pool bug described above — every "themed" strategy was
diluted by the same 119-card pool a generalist drew from, so leaning into
Poison barely looked different from not leaning into anything. Measured
against the actual preset decks, the picture is not close:

```
atk       completion= 35.4%   duelWin= 40.3%
balanced  completion= 26.6%   duelWin= 36.0%
tank      completion=  9.0%   duelWin=  9.7%
thorns    completion=  4.4%   duelWin=  4.8%
rally     completion=  0.0%   duelWin=  0.9%
poison    completion=  0.0%   duelWin=  1.1%
```

ATK-stacking is the dominant strategy by a wide margin, and Poison and Rally
are, as measured, not a viable way to play — a themed Poison or Rally deck
essentially never wins a duel. This traces to the ghost-pacing math above in a
way that isn't fully resolved by the `targetHp` cap: a ghost's *offensive*
threat is solved from `canonMaxHp / killPlayerIn`, using the canonical
character's survivability, while its HP (the thing a themed build has to
overcome) is solved from `canonAtk`, the same canonical character's *raw ATK
stat alone* — never their total per-exchange damage. An ATK-stacking build's
own atk stat approximates that total, so the canonical band roughly describes
what it needs to overcome. A Poison or Rally build's real damage output is
mostly *not* in its ATK stat — it's in Poison ticks or Rally growth, neither
of which `canonAtk` accounts for — so a ghost sized to be a fair fight for an
ATK-stacker is sized far out of reach for a build that was never going to
win primarily through ATK. Reining in ATK's ceiling across the pool so a
single shared band can be fair to every archetype is the honest fix; it
touches enough cards, in enough decks, that it needs its own pass rather than
being folded into this one. Left as the clearest known gap in the game as it
stands, not swept into a number that reads better than the game plays.

### Why the path is easy and the duel is hard

`balance.mjs` reports path damage at ~11% of max HP against §12's 30–50%
target, and that MISS is deliberate. Path damage and duel outcome are the same
dial: §3 carries path damage *into* the duel, so every point the path takes is
a point you fight the ghost without. Sweeping monster ATK and HP upward to hit
the path-damage target drags run completion down sharply and starts flooring
runs at 1 HP — a game where the path mauls you and the duel is then a
formality. The current split (an easy path, a real duel) keeps the difficulty
where it's supposed to live. Re-measure it if monsters change; don't chase it
on its own.

### What a fighter is holding, and how it hits

`run.gear` records every gear and ally card actually bought. The rules never
read it — stats are what the resolver cares about — but the equipment panel
shows the real item in each slot (the Runed Greatsword you bought, not a
generic sword), and the weapon you're holding picks your attack animation.
Ghosts get the same treatment: `flavourInventory()` fits a plausible kit to
the statline a ghost already has, so a Poison 4 ghost is visibly carrying
something venomous.

Fitting the kit to the stats, rather than deriving stats from a drafted
inventory, is deliberate. Drafting would be the more authentic model of
"another player's run", but it would put the carefully-solved exchange-count
pacing at the mercy of whatever the draft rolled. The stats stay
authoritative; the kit explains them. A test asserts the presentation data
can never reach the resolver — `snapshot()` drops every field it doesn't
recognise, and that test is what keeps it honest as fields get added.

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
skill or luck in what got dealt — gets a fight that isn't perfectly matched
to them personally, the same way two real human players' snapshots wouldn't
be either. That's normal variance in an async PvP game, not something ghost
generation is responsible for erasing.

Where the numbers land, over 1000 runs of a greedy (brute-force) player:

- **Rounds ending floored at 1 HP: under 1%.** The doc calls starting max HP
  (20) the single riskiest number and asks for this to be checked before
  anything else. Tier 3 monsters are not routinely flooring players.
- **Duels run 4.06 exchanges on average, with ~80% landing in the §12 window.**
  Short duels (2.6 exchanges, well under half in-window) were the prototype's
  clearest early miss; fixed by the canonical-band pacing above.
- **Run completion: 32% for the maximizer, 23% for a cautious style** —
  inside §9's own 25–35%, without needing ghosts to bend around whoever's
  fighting them. Skill and playstyle produce a real, sensible spread; a
  perfect optimizer beating typical ghosts more than a cautious player does
  is the point, not a leak.
- **Duel win rate: 40%** — near even against a pool the player never gets to
  pick from.
- **Path damage is lighter than the 30–50% target**, which is partly the
  planner being better at ordering than a person will be.

A MISS in that report is a tuning note, not a bug.

### Every archetype is a real way to play, not just Aggro/ATK — this is a design goal the game does not currently meet

`§5`'s "loose triangle" — Aggro beats Poison, Tank beats Aggro, Poison beats
Tank, Rally beats Poison — only means something if committing to Tank,
Poison, or Rally is actually competitive with just stacking ATK. This section
used to report all four themed archetypes within 4 points of completion of
each other. That number was measured with the same undifferentiated-pool bug
described in "The balance tools were never measuring what a player actually
plays" above — the fix for that bug is what turned "close" into the real
numbers reported there: ATK-stacking dominant, Poison and Rally essentially
unplayable. That section is the current, correct account of archetype
viability; this one is left in place, corrected, so the history of the claim
isn't quietly erased.

### No dead cards — mostly

`tools/card-coverage.mjs` runs the same six strategies and records which of
the 119 cards each one ever actually chose. **117 of 119 get picked by at
least one strategy.** The rarest are almost entirely Tier 3 (fewer runs ever
reach round 5, so those cards get fewer opportunities to be dealt at all —
that's a sampling effect, not a balance problem) or cards that trade a
resource directly for their effect, like Ruined Chapel spending 2 ATK to heal
to full, which a strategy actively optimizing ATK correctly avoids.

The two genuinely dead ones, Berserker's Axe and Dragon Altar, are both Tier
3 cards in the Warlord (Rally) deck — not a coincidence. A strategy that
essentially never wins a duel (see the archetype-viability numbers above)
essentially never reaches round 5 either, so its own Tier 3 cards never get
the chance to be picked at all. This is downstream of the same unresolved
Rally weakness, not a separate problem with either card.

Four cards used to be picked by nobody. They aren't dead any more, and the fix
wasn't to the cards: a hand that stays full has room to spend a slot on a
secret or a situational Tier 3, where a shrinking one never could.

### Cards that read the rest of your build

The pool was, for a long time, entirely flat: every card printed a number and
gave that number to everyone, in every deck, on every day. A path of four was
four unrelated numbers, and no amount of tuning makes that feel like a build
coming together, because nothing ever *comes together* — it only adds up.

Three kinds of card fix that, and all three are in `js/cards.js` under their
own headings:

- **Cross-keyword payoffs.** Bramblelord pays Thorns out of your Armour;
  Warden's Oath pays Armour out of your Thorns; Ironblood Rite turns Armour
  into a bigger HP pool. They deliberately convert one investment into a
  *different* axis rather than compounding a stat into itself — Poison that
  doubles Poison leaves the game's own maths behind in about two buys.
- **The weapon arc.** Grindstone, Armsmaster and Master's Forge read the blade
  actually in your hand rather than the sum of every weapon you ever bought, so
  trading up to something enormous has a payoff at the end of it and carrying
  one great weapon beats hoarding four mediocre ones.
- **Adjacency.** Flanking Strike, Scavenger's Cache, Ambusher's Nook and Ritual
  Circle read their neighbours in the path. Before these, ordering only ever
  decided what you could *afford*; now the same four cards are worth
  measurably more in the right order, which is the difference between an
  accounting problem and a puzzle.

`dyn(ctx)` is what makes this possible: a card's effect can read the character
(keywords, ATK, max HP, owned gear, hearts lost) and its immediate neighbours.
Neighbours are read from where cards were *placed*, not from what survived
resolving, so an adjacency payoff is visible while you're still planning.

One trap worth naming: a synergy that isn't in a deck doesn't exist. These were
added to the pool and to no preset, which made them worth nothing — and three
of the four scaling cards the game already had (Training Yard, Boneyard,
Standing Stones) turned out to be in no preset either. Every preset now carries
the synergies its own theme compounds into, and a test fails if a scaling card
is left out of all of them.

### Invasion, on hold

`js/rival.js` still has a full ambush mechanic — the rival forcing a fight on
your path on a day of its choosing, resolved with `resolveAmbush`, revealed
through `intel()` — but `hasInvasion(day)` currently returns `false`
unconditionally, so no run ever draws one. It's switched off pending a UI
pass (a forced fight needs its own on-screen framing, not just reusing the
path-fight stage) and a fresh balance check once that framing exists — it
was a real gold/trophy swing for an optimizing planner, which is why the
ghost target bands in `TARGETS` were tuned assuming it ran and had to be
reverted when it was switched off. Nothing about the mechanic itself is
unfinished; `hasInvasion` is the one switch that turns it back on, and the
engine underneath is exercised directly by its own tests either way.

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

**Replacing it doesn't touch rendering code.** `js/ui.js`'s `glyphEl()` is
the one place every icon in the game passes through — card art, duelist
portraits, equip-panel slots, the rival's kit chips. It renders an emoji as
text today, but the moment an `ICON`/`MONSTER_GLYPH` map value looks like an
asset path (starts with `/`, `./`, `http`, or ends in `.png`/`.svg`/etc.) it
renders an `<img>` instead, sized to the same em-based footprint the emoji
had — no other file needs to change. Dropping in real art (OSRS-style
equipment icons, monster portraits, whatever) is a data edit in those two
maps, one card or monster at a time; nothing about the layout, the animation
system, or any other component needs to know art has arrived.

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
