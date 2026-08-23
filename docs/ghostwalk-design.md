# Ghostwalk — Prototype Design Document

**Version:** 0.2 (prototype scope)
**Genre:** Async PvP path-builder
**Session length:** ~75–90 seconds per round, ~7–8 minutes per run
**Platform:** Mobile, portrait, one-thumb

**Changelog since v0.1:** added the Spoils & Stash system (named item drops from monsters, held until you choose to use them); added Field Mouse (T1) and Flame Imp (T3) monsters; 70 named cards total.

---

## 1. Overview

You are dealt six cards and place four of them into a left-to-right **path**. The path resolves one card at a time: you fight monsters, buy gear, hire allies, visit places. Some monsters, when killed, may also drop a **Spoil** — a named item that goes into your **Stash** rather than your stats, so you decide which future round it's worth using in. Your character comes out the other side of the path with a set of stats, and then automatically duels a **ghost** — a snapshot of another player's character from the same point in their run.

Win five duels to complete a run. Lose three and it ends.

### Design pillars

**One rule, used everywhere.** The same combat resolver runs path monsters and the PvP duel. Players learn the duel by playing the path.

**Ordering is the game.** Every dealt card is available to everyone. The only decision is sequence, and sequence changes everything — what you can afford, what you can survive, what compounds.

**Loot has a name and a moment, not just a number.** A Spoil isn't a silent stat bump — it's a card with an identity, and choosing *when* to cash it in is its own decision, separate from the luck of getting it.

**No live opponent, ever.** Matches resolve against stored snapshots. There is never a queue, never a wait, never a disconnect.

**Fully deterministic combat.** No dice, no crits, in either the path or the duel. Breakpoint planning is only meaningful if the player can compute it exactly. All randomness in the game lives in *acquisition* — what you're dealt, what drops — never in *resolution*.

> **Naming note:** all card names in this document are generic fantasy. No RuneScape-specific proper nouns are used anywhere in the prototype — the reference is to the *structure* of Chronicle, not its setting or IP.

---

## 2. The loops

### 2.1 Session loop (~75–90 seconds)

1. **Open app.** Resume mid-run or start a new one. No energy gate, no daily reset.
2. **Deal.** Six cards fan into hand. If your Stash holds any Spoils, they sit in a tray alongside the hand — available, not mandatory.
3. **Plan.** Drag four cards — from hand or Stash, in any mix — into the path's four slots. Reorder freely. No timer.
4. **Embark.** Cards flip left to right, ~2s each, resolving as they go. Path fights are compressed.
5. **Duel.** A ghost is drawn and the fight plays out at full presentation, ~10s. No input.
6. **Result.** Win banked or heart lost. Any Spoils earned this round are added to your Stash. Your character uploads as a ghost for other players.
7. **Close.** Everything is saved between rounds.

### 2.2 Run loop (5–7 rounds)

A run ends at **5 wins** (complete) or **3 losses** (over). Both outcomes return you to the menu with a summary and roll straight into a fresh run if you want one.

Rounds scale in card tier as you progress — see §9. The Stash resets to empty at the start of every new run (see §7.4 for why).

### 2.3 Meta loop (prototype: minimal)

Between runs: a results screen showing your ghost's overnight record, lifetime wins, and a **Start Run** button. That is the entire meta for the prototype. Deliberately thin — see §13.

---

## 3. Stats

Four numbers. The player never sees a fifth.

| Stat | Start | Role |
|---|---|---|
| **HP** | 20 / 20 | Current and max. Damage taken on the path carries into the duel. |
| **ATK** | 1 | Damage per exchange. Used on the path *and* in the duel. |
| **Gold** | 3 | Spent inside the path. Carries between rounds. |
| **Hearts** | 3 | Run-level lives, lost only on a duel defeat. |

**Between rounds:** heal 50% of max HP (rounded up). Gold and ATK carry over in full.

**The HP / Hearts split is load-bearing.** HP is a resource you spend aggressively inside a round. Hearts are run-level and can only be lost in the duel. This means a bad path never spirals you into an unwinnable run — you arrive weak, you probably lose one duel, you heal, you continue.

---

## 4. The combat resolver

Used identically for path monsters and PvP duels.

Both sides have HP, ATK, and any keywords. Repeat until one side reaches 0:

```
EXCHANGE:
  1. Poison ticks on both sides (ignores Armour)
  2. Check for defeat
  3. First Strike attacks resolve (first exchange only)
  4. Check for defeat
  5. Both sides attack simultaneously
       damage = attacker ATK − defender Armour, minimum 1
  6. Thorns reflect onto whoever dealt damage in step 5
  7. Rally applies (+X ATK, permanent for this fight)
  8. Check for defeat
```

**Defeat is simultaneous.** If both sides hit 0 in the same exchange, both lose — resolved in the duel by tiebreak (§8.3).

**On the path you cannot die.** Damage floors you at 1 HP. Arriving at the duel on 1 HP is punishment enough; losing a heart to a rat before you ever see an opponent is not.

---

## 5. Keywords

Five. There is no sixth in the prototype.

| Keyword | Effect |
|---|---|
| **First Strike** | One free attack before the first exchange. If both sides have it, they cancel. |
| **Armour X** | Reduce incoming attack damage by X (minimum 1 damage still gets through). |
| **Thorns X** | When an enemy damages you with an attack, deal X back to them. |
| **Poison X** | At the start of each exchange, deal X to the enemy. Ignores Armour. Poison values stack. |
| **Rally X** | Gain +X ATK at the end of each exchange, for the rest of that fight. |

These four archetypes fall out naturally and beat each other in a loose triangle:

- **Aggro** (high ATK, First Strike) — beats Poison, loses to Tank
- **Tank** (Armour, max HP) — beats Aggro, loses to Poison
- **Poison** (chip) — beats Tank, loses to Rally
- **Rally** (late scaling) — beats Poison, loses to Aggro

---

## 6. The path

### 6.1 Dealing

Six cards from the round's tier pool. Every hand is guaranteed to contain:

- at least **2 monsters** (so gold is always reachable)
- at least **1 gear or place** (so gold is always spendable)

This guarantee applies to the six *dealt* cards only. Stash contents are extra, on top.

### 6.2 Placement

Four slots, left to right. Drag any four cards in — from your hand of six, from your Stash, or a mix of both. Reorder as much as you like — nothing commits until **Embark**. Unused dealt cards are discarded; unused Stash cards simply stay in the Stash.

**Stash cards compete for the same four slots — they don't add extra ones.** With a full Stash of three, you could in theory fill three of your four slots with Spoils and only one with a dealt card. Nothing stops you; it's rarely optimal, since you'd be skipping the round's gold-generating monsters.

### 6.3 Fizzle

If a card's cost cannot be paid when its slot resolves, **the slot does nothing.** The card greys out, the path continues. This only applies to gold-cost cards — Spoils are already paid for and never fizzle.

### 6.4 Resolution

Slots flip left to right. Monster fights animate at ~2s regardless of exchange count — compressed, with the damage total shown as a single number. Save the slow, readable, blow-by-blow presentation for the duel.

---

## 7. Spoils and the Stash

### 7.1 The idea

Some monsters, when defeated, have a chance to drop a **Spoil** — a named item card with its own art and flavor text, distinct from the monster's guaranteed gold. A Spoil does **not** attach automatically. It goes into your **Stash**, and stays there — through this round, and every round after — until you choose to place it into a path slot, at which point it resolves exactly like a gear card and is consumed.

This is the whole point: you don't just get lucky, you get to decide *when* the luck pays off. Holding a healing Spoil for the round you actually need it is a real decision, not a formality.

### 7.2 The Stash

- **Capacity: 3.** If a new Spoil drops while the Stash is full, you get a quick prompt — keep the new one (and discard an old one of your choice) or discard the new one. One tap, doesn't interrupt the flow.
- Stash contents are shown as a small tray next to your dealt hand on every planning screen, for every round of the run.
- Placing a Spoil costs no gold. It applies its effect immediately when its slot resolves, then is removed from the Stash permanently — same lifecycle as gear, just pre-paid.
- The Stash is **private.** Other players' ghosts only carry your resolved stats, never your unused Stash — nobody can see what you're holding, including your own past self as a ghost.
- The Stash **resets to empty at the start of every new run** (see §7.4).

### 7.3 Power level: stronger, but narrower

Because a Spoil isn't guaranteed and has to be earned *and* correctly timed, it's allowed to be meaningfully better than a same-tier gear card — roughly **25% more effect** for a comparable cost tier. That extra power is paid for in one of two ways, sometimes both:

- **A conditional bonus** tied to something the player controls — path position, gold remaining, whether they scouted the opponent — so full value takes planning, not just possession.
- **A lean into a situational keyword** (Poison, Thorns, Rally) rather than flat ATK or Armour, which are close to always-good. A Poison-heavy Spoil is excellent against Armour-stacked opponents and mediocre against Poison-resistant ones — the power is real, but it's matchup-dependent, not universal.

This keeps the same discipline as the rest of the game: RNG decides your *flavor* of powerful, and now also *when* you get to cash it in — never *whether* you win.

### 7.4 Why the Stash resets each run

Carrying Spoils across runs would turn the Stash into a slow-building permanent advantage — the opposite of what keeps ghost matchmaking fair, since ghosts are bucketed by `(round, wins)` on the assumption that players at the same point in a run are roughly comparable. A ten-run veteran walking into round 1 with a full Stash of T3 Spoils breaks that assumption immediately. Resetting keeps every run self-contained. (Whether some *smaller* piece of this should persist as a meta-progression hook is an open question — see §14.)

---

## 8. The duel and ghosts

### 8.1 Ghost creation

At the end of every round — win or lose — your character is serialised and uploaded. Spoils you've *used* show up baked into your stats, same as gear; unused Stash contents are never included.

```json
{
  "name": "Torvald",
  "round": 3,
  "wins": 2,
  "hp": 24, "maxHp": 31, "atk": 11,
  "keywords": { "armour": 2, "poison": 0, "thorns": 3,
                "firstStrike": false, "rally": 1 },
  "path": ["cave_troll", "steel_longsword", "market_square", "wedge_of_cheese"]
}
```

### 8.2 Matchmaking

Ghosts are bucketed by `(round, wins)`. A round-3 player on 2 wins only ever draws from the round-3 / 2-win bucket. Retrieval is instant — a database read, not a matchmaking queue.

**Thin buckets are seeded with designer-authored bots.** At launch, every bucket is 100% bots. Players cannot tell and it does not matter. Bots are also the balance tool: hand-tuned bots let you guarantee that each archetype appears at a known rate.

### 8.3 Tiebreak

Mutual defeat resolves in this order: higher max HP → higher gold → the ghost wins.

Deterministic, and biased slightly against the live player so that ghosts feel dangerous.

### 8.4 The retention hook

Your ghost keeps fighting for other players while you are away. This generates free, honest, non-manipulative push notifications:

> *Torvald won 6 duels overnight.*

Costs nothing to produce, is literally true, and gives players a reason to reopen that isn't a timer.

---

## 9. Run structure and scaling

| Round | Card tier | Target player ATK | Target max HP |
|---|---|---|---|
| 1 | T1 | 3–5 | 20–24 |
| 2 | T1 | 6–9 | 22–28 |
| 3 | T1 + T2 | 10–14 | 26–32 |
| 4 | T2 | 15–21 | 30–36 |
| 5+ | T2 + T3 | 22–32 | 34–44 |

**The tier system solves the late-monster problem.** Because everything gets easier as you scale, a monster that rewards being fought *late* is normally hard to design. Tiering sidesteps it: monsters get harder at the same rate you do. Within-round late value is handled by the counting Place cards (§10.4) and by Spoils held for the right moment.

---

## 10. Card list

**70 named cards:** 58 in the shared deal pool (drawn from directly) + 12 Spoils (drawn only via monster kills). Costs in gold. Monsters are written `HP / ATK`.

### 10.1 Monsters (22)

Defeating a monster grants its gold. Some grant a permanent stat as a trophy. A "Spoil" entry means there's a chance of an additional named item — see §10.5 for full effects.

#### Tier 1

| # | Name | Stats | Keywords | Reward | Spoil (rate) |
|---|---|---|---|---|---|
| 1 | Field Mouse | 2 / 1 | — | +2 gold | Wedge of Cheese (20%) |
| 2 | Sewer Rat | 3 / 1 | — | +3 gold | — |
| 3 | Wild Boar | 5 / 2 | — | +4 gold | — |
| 4 | Goblin Scrapper | 4 / 2 | — | +3 gold, +1 ATK | — |
| 5 | Giant Spider | 4 / 1 | Poison 1 | +4 gold | Toxin Sac (15%) |
| 6 | Bandit Lookout | 6 / 2 | — | +5 gold | Stolen Purse (15%) |
| 7 | Bog Toad | 8 / 1 | — | +4 gold, +2 max HP | — |
| 8 | Skeleton Picket | 5 / 3 | Armour 1 | +6 gold | — |
| 9 | Feral Hound | 3 / 2 | First Strike | +4 gold | Wolf Pelt Cloak (18%) |

#### Tier 2

| # | Name | Stats | Keywords | Reward | Spoil (rate) |
|---|---|---|---|---|---|
| 10 | Cave Troll | 14 / 5 | — | +9 gold | Troll-Hide Mantle (14%) |
| 11 | Marsh Wraith | 10 / 3 | Poison 2 | +8 gold | Wraithglass Vial (12%) |
| 12 | Bandit Captain | 12 / 6 | — | +10 gold, +1 ATK | Warlord's Horn (12%) |
| 13 | Iron Golem | 16 / 4 | Armour 3 | +11 gold | Golem Fist (10%) |
| 14 | Ogre Brute | 18 / 7 | — | +12 gold, +3 max HP | — |
| 15 | Wyvern Hatchling | 11 / 5 | First Strike | +9 gold | — |
| 16 | Thornback Boar | 13 / 4 | Thorns 2 | +8 gold | — |

#### Tier 3

| # | Name | Stats | Keywords | Reward | Spoil (rate) |
|---|---|---|---|---|---|
| 17 | Hill Giant | 26 / 9 | — | +16 gold | — |
| 18 | Basilisk | 22 / 7 | Poison 4 | +15 gold | Basilisk Eye (9%) |
| 19 | Stone Warden | 30 / 8 | Armour 5 | +18 gold | — |
| 20 | Chimera | 24 / 11 | First Strike | +17 gold | Chimera Fang (8%) |
| 21 | Elder Wyrm | 32 / 10 | Rally 2 | +20 gold, +2 ATK | Wyrmscale Aegis (8%) |
| 22 | Flame Imp | 20 / 8 | — | +14 gold | Flaming Spear (10%) |

### 10.2 Gear (19)

Permanent for the rest of the run. Keywords stack additively.

#### Tier 1

| # | Name | Cost | Effect |
|---|---|---|---|
| 23 | Whetstone | 2 | +2 ATK |
| 24 | Buckler | 3 | Armour 1 |
| 25 | Traveller's Boots | 3 | +4 max HP, heal 4 |
| 26 | Rusty Sword | 4 | +3 ATK |
| 27 | Leather Jerkin | 4 | Armour 1, +3 max HP |
| 28 | Spiked Vambrace | 4 | Thorns 2 |
| 29 | Hunting Bow | 5 | +2 ATK, First Strike |
| 30 | Venom Flask | 5 | Poison 2 |

#### Tier 2

| # | Name | Cost | Effect |
|---|---|---|---|
| 31 | Chainmail | 8 | Armour 2, +6 max HP |
| 32 | Tower Shield | 9 | Armour 3 |
| 33 | Steel Longsword | 9 | +6 ATK |
| 34 | Assassin's Kris | 10 | +4 ATK, First Strike, Poison 2 |
| 35 | Warhorn | 10 | Rally 2 |
| 36 | Serrated Axe | 11 | +5 ATK, Thorns 3 |

#### Tier 3

| # | Name | Cost | Effect |
|---|---|---|---|
| 37 | Basilisk Fang | 16 | +5 ATK, Poison 5 |
| 38 | Dragonplate | 17 | Armour 5, +10 max HP |
| 39 | Runed Greatsword | 18 | +11 ATK |
| 40 | Banner of the Vanguard | 20 | Rally 4 |
| 41 | Executioner's Blade | 22 | +9 ATK, First Strike |

### 10.3 Allies (8)

Permanent, but conditional or recurring rather than flat stats.

| # | Name | Cost | Tier | Effect |
|---|---|---|---|---|
| 42 | Torchbearer | 3 | T1 | After each monster you defeat, heal 2. |
| 43 | Coin Clipper | 4 | T1 | +2 gold at the start of each future round. |
| 44 | Sparring Partner | 5 | T1 | +1 ATK at the start of each future round. |
| 45 | Field Medic | 6 | T1 | Heal 5 now. Heal 3 at the start of each future round. |
| 46 | Shieldbearer | 8 | T2 | Armour 1. Before each duel, +2 Armour if you took no path damage that round. |
| 47 | Houndmaster | 9 | T2 | Your first attack in every fight gains First Strike. |
| 48 | Quartermaster | 12 | T2 | Gear costs 3 less (minimum 1). |
| 49 | Banner Squire | 14 | T3 | Rally 1. Increases by 1 each round. |

### 10.4 Places (9)

Free to enter. Some offer an optional paid upgrade.

| # | Name | Tier | Effect |
|---|---|---|---|
| 50 | Roadside Shrine | T1 | Heal 6. |
| 51 | Market Square | T1 | +5 gold. |
| 52 | Blacksmith | T1 | +2 ATK. May pay 4 gold for +3 more ATK. |
| 53 | Training Yard | T1 | +1 ATK for each monster defeated earlier this path. |
| 54 | Boneyard | T1 | +3 gold for each monster defeated earlier this path. |
| 55 | Watchtower | T2 | Reveal this round's opponent's HP and ATK. +3 gold. |
| 56 | Ruined Chapel | T2 | Heal to full. −2 ATK. |
| 57 | Toll Bridge | T2 | May pay 5 gold: +8 max HP and heal 8. Otherwise nothing. |
| 58 | Standing Stones | T3 | +2 max HP and +1 ATK. Doubled if this is your fourth slot. |

### 10.5 Spoils (12)

Never dealt directly — only earned via the drop rates in §10.1, held in the Stash, and placed at the player's discretion. All are free to play (no gold cost) and never fizzle.

#### Tier 1

| # | Name | Source | Effect |
|---|---|---|---|
| 59 | Wedge of Cheese | Field Mouse | Heal 8. Heal 14 instead if this is your last path slot. |
| 60 | Toxin Sac | Giant Spider | Poison 3. Poison 6 instead if you've used Watchtower this round. |
| 61 | Wolf Pelt Cloak | Feral Hound | Armour 2, Thorns 2. |
| 62 | Stolen Purse | Bandit Lookout | +10 gold instantly, usable by later slots in the same path. |

#### Tier 2

| # | Name | Source | Effect |
|---|---|---|---|
| 63 | Troll-Hide Mantle | Cave Troll | Armour 3, +8 max HP. |
| 64 | Wraithglass Vial | Marsh Wraith | Poison 4, First Strike. |
| 65 | Warlord's Horn | Bandit Captain | Rally 3. |
| 66 | Golem Fist | Iron Golem | +8 ATK. +6 more (14 total) if played with 0 gold remaining. |

#### Tier 3

| # | Name | Source | Effect |
|---|---|---|---|
| 67 | Flaming Spear | Flame Imp | +12 ATK, Poison 3. |
| 68 | Wyrmscale Aegis | Elder Wyrm | Armour 6, Rally 2. |
| 69 | Basilisk Eye | Basilisk | Poison 6. Poison 10 instead if you've used Watchtower this round. |
| 70 | Chimera Fang | Chimera | +10 ATK, First Strike, Thorns 2. |

**Benchmark:** each Spoil compares against a same-tier gear card of similar gold cost and runs roughly 25% stronger in raw stat total — paid for by rarity, by a timing condition, by leaning on a matchup-dependent keyword, or some combination of the three.

---

## 11. Worked round

**Round 1.** 20/20 HP, 1 ATK, 3 gold, empty Stash.

**Hand:** Field Mouse, Wild Boar, Rusty Sword, Feral Hound, Buckler, Roadside Shrine

### Line A — greedy, banking a Spoil for later

`Field Mouse → Rusty Sword → Wild Boar → Feral Hound`

- **Field Mouse** (2/1) at 1 ATK: 2 exchanges, take 2. → **18 HP, 5 gold.** Spoil roll succeeds — **Wedge of Cheese** enters the Stash.
- **Rusty Sword** (4g): → **1 gold, 4 ATK**
- **Wild Boar** (5/2) at 4 ATK: 2 exchanges, take 4. → **14 HP, 5 gold**
- **Feral Hound** (3/2, First Strike) at 4 ATK: free hit for 2, then 1 exchange, take 2. → **12 HP, 9 gold**

**Result: 12/20 HP, 4 ATK, 9 gold, Stash: [Wedge of Cheese].** A workable line, and the Cheese is now available for whenever it's needed most — not necessarily this run's easiest round.

### Line B — the fizzle trap

`Field Mouse → Rusty Sword → Buckler → Wild Boar`

- Field Mouse → 18 HP, 5 gold (Spoil roll fails this time — no Cheese)
- Rusty Sword (4g) → 1 gold, 4 ATK
- **Buckler (3g) — cannot afford. FIZZLES.** Slot wasted.
- Wild Boar → 14 HP, 5 gold

Same cards, one slot thrown away. Swapping Buckler and Wild Boar fixes it entirely.

### Spoils in practice — two rounds later

Say Round 1 ends 18/24 HP after the duel, and Round 2's hand is rough: two monsters worth 15 combined HP in damage and no healing card in sight. Normally that's a forced trip into Round 3 already hurt. Instead, the Wedge of Cheese from the Stash gets slotted as the **last** card in the path — its bonus condition — for a full 14 heal right before the duel. The player didn't get lucky twice; they got lucky once and *chose* the moment it mattered.

### Breakpoints — Cave Troll (14 / 5)

| Your ATK | Exchanges | Damage taken |
|---|---|---|
| 3 | 5 | 25 |
| 4 | 4 | 20 |
| 5 | 3 | 15 |
| 7 | 2 | 10 |
| 14 | 1 | 5 |

Going from 4 ATK to 5 saves 5 HP. Going from 5 to 6 saves nothing. That non-linearity is the puzzle, and it only exists because combat is deterministic.

---

## 12. Tuning targets

Numbers above are first-pass and will need a balance sweep. Targets to tune against:

- **Path damage per round:** 30–50% of max HP on a greedy line, 10–20% on a cautious one
- **Fizzle rate:** ~15% of new players' first three rounds, under 3% by round ten
- **Duel length:** 3–6 exchanges. Under 3 is unreadable, over 6 is boring
- **Run completion:** 25–35% of runs reach 5 wins
- **Archetype spread:** no archetype above 30% or below 15% of ghost pool at round 4
- **Spoil utilization:** at least 60% of earned Spoils get used before the Stash cap forces a discard — if it's much lower, the Stash is too generous or the drop rates too high and players are drowning in unused loot
- **Spoil-vs-gear power gap:** a run that gets zero Spoils should still comfortably reach 5 wins; a run that gets several should feel noticeably smoother, not trivial

The single riskiest number is **starting max HP (20)**. If Tier 3 monsters at 8–11 ATK routinely floor players at 1 HP, either max HP growth needs to be steeper or Tier 3 ATK needs to come down. Test this before anything else.

---

## 13. Prototype scope

### In

Full 70-card pool (58 dealt + 12 Spoils) · four dealt card types plus Spoils · five keywords · shared combat resolver · path placement and fizzle · Spoils and the Stash · ghost upload and bucketed retrieval · bot-seeded pools · 5-win / 3-heart run structure · results screen

### Out (deliberately)

- **Card collection and deckbuilding.** Everyone draws from the same pool. Roughly a third of the build cost and dramatically easier to balance.
- **Rarities** beyond the implicit tier system
- **Energy or timers.** Nothing gates play.
- **Guilds, chat, friends, leaderboards**
- **A sixth keyword.** Every request for one should be answered with a card that combines two existing ones.
- **Cross-run Stash persistence.** Resets every run for now — see §14.
- **Cosmetics and monetisation**

All of these are additive later. None of them make round one better, and shipping without them means the core loop gets tested honestly.

---

## 14. Open questions

1. **Shared pool vs. owned collection.** The big fork. Collection gives long-tail progression and a monetisation surface, but it is where Chronicle's balance genuinely broke down and it roughly triples scope. Prototype answers this by proving the loop first.
2. **Should the Stash carry a small amount between runs as a meta-progression hook** — e.g., one Spoil slot persists — once the base loop is validated? Tempting for retention, risky for ghost-matchup fairness (§7.4).
3. **Should the player see their opponent before placing cards?** Watchtower currently sells this as a card effect, and two Spoils (Toxin Sac, Basilisk Eye) already key off it. Making it free and universal would turn the path into a counter-building puzzle — richer, but slower, and it undermines Watchtower and those Spoils both.
4. **Is 4 slots right?** 3 is tighter and faster; 5 gives combo room but pushes rounds past 90 seconds, worse now that Stash decisions add planning time. Test 4 first.
5. **Ghost staleness.** If a bucket holds ghosts from months ago against a rebalanced card pool, they may be trivially weak or unbeatable. Probably needs a rolling window — 30 days, or last N thousand entries.
6. **Does losing feel bad enough to quit?** Three hearts over ~7–8 minutes is a fast failure. Watch early retention closely; a fourth heart is the obvious lever.
