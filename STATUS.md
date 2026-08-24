# Shooter's Royale — Build Status

**Version:** 1.4 · **Date:** 23 August 2026 · **File:** `index.html` (~216 KB, ~3,900 lines)

---

## Summary

0.5 is a weapon-design and retention pass, and it fixed two bugs that were quietly gutting the game.

The armory went from 11 weapons to 14. Every weapon now has a mechanic that is genuinely its own —
damage falloff, spray bloom, burst fire, a heat bar instead of a magazine, a bipod, a charge-up,
shell-by-shell loading, backstab, lifesteal, knockback — plus a one-line strength and a one-line
drawback printed on its shop card. Magazines came down across the board (AK-47 from 30 rounds to 20)
and reserve ammo is now finite, which is why slot 3 is always a melee weapon.

The Obsidian Reaper is no longer the end of the game. It is a three-shot-per-match execution tool with
a one-second charge that lights you up purple. In simulation it has the **lowest win rate of any firearm**
while still averaging 3.9 kills — a great tool, a bad crutch.

On top of that: daily challenges, a rank ladder, per-weapon mastery, match medals, multi-kill banners,
a doubled first win each day, and a training range where any weapon in the game can be test-fired for free.

**Everything below was verified in a real browser**, which 0.4 never was — with one exception:
pointer lock could not be exercised through the automation, so someone should confirm mouse capture
by hand. Details in Verification.

---

## The two bugs that mattered most

### 1. Progress was never saved

`saveState` only wrote to `window.storage`, which does not exist in an ordinary browser, and fell back to a
plain in-memory object. **Every coin, unlock and statistic was wiped by a page refresh.** For a game whose
entire progression is "earn coins, buy things, come back", this was the single most damaging bug in the build,
and it made every retention feature in this release pointless until it was fixed.

Saving is now three tiers: `window.storage` if a host provides it, then `localStorage`, then memory.
Verified by round-tripping coins, XP, rank, mastery, ownership and daily-challenge progress across a reload.

`loadState` also migrates 0.4 saves — a melee weapon or an unowned gun sitting in slot 1 gets corrected,
`eq.melee` is seeded, and the new fields are initialised without touching old stats.

### 2. The Bazooka had never worked

In `stepProjectiles`:

```js
const wd = rayWorld(p.pos, p.d, step + 0.4);
...
else if (wd <= step + 0.4) boom = true;
```

`rayWorld` returns its `max` argument when it hits nothing. So the "no wall ahead" sentinel was
*identical* to the "wall exactly at maximum range" case, and the comparison was true on every single frame.
**Every rocket detonated one frame after launch, roughly three metres from the firer's face.**

Instrumenting a match: 6 rockets fired, 6 explosions, all 6 inside the player's own splash radius,
0 enemies caught, average detonation 3.2 m from the player.

0.4's release notes recorded this as "Bazooka was suiciding its user" and treated the symptom by cutting
self-splash to 35%. The cause was a `<=` that should have been a `<`. After the fix the same instrumentation
shows rockets travelling 11–25 m and detonating on target. The 35% self-splash stays, because rocket-jumping
is fun and should survive.

---

## New in 1.4 — a death you can watch, and maps that fight back

**The outro.** The results screen used to slam in the instant the last shot landed. There is now a
beat in between: the world keeps simulating at **0.34× speed** while the camera lifts off the player
and orbits, the HUD fades to 22%, and a card names what got you — `FERRO · LONGSHOT RAIL · HEADSHOT`,
or `LAST ONE STANDING · 5 KILLS` on a win. 2.9 s on a death, 3.6 s on a win, click or space to skip.
Bots keep fighting through it. `endMatch` closes scoring immediately but leaves the world running,
and the loop routes to `tickOutro`.

**Natural props.** Every arena was boxes on boxes, so ten themes read as one place with a repainted
floor. Rocks, trees, dead trees, crystals and rivers now vary the silhouettes: Frostbite has ice
boulders, pines and a frozen creek; Sandpit has bleached rock and dead wood over a dry wash; Atrium
has real trees in its planters; Emberfall has obsidian and burnt trunks; Void Nexus has crystal
shards. Collision-box counts went from 132–174 to 138–203.

**Arena events — five maps now fight back.**

| Arena | Event | Every | Radius | Damage |
| --- | --- | --- | --- | --- |
| Sandpit | Sinkhole | 9–15 s | 5.2 m | 22 + stun |
| Frostbite | Ice spikes | 7–12 s | 4.4 m | 28 + launch |
| Emberfall | Meteor | 6–11 s | 5.0 m | 38 + launch |
| Bone Temple | Bone spikes | 8–13 s | 4.2 m | 26 + launch |
| Void Nexus | Void rift | 8–14 s | 4.8 m | 32 |

Damage is strongest in the centre and falls to ~38% at the rim. Events pick a spot near someone
still alive, and **bots are caught by the same code**.

Two things worth stating. Every event is **telegraphed for 1.2–1.5 s** first — a hazard nobody can
dodge is just a random tax. And the warning marker is deliberately **not themed**: the first version
tinted it to match the arena, which made Frostbite's pale cyan ring invisible on its white floor.
It is now the same hot orange everywhere with the whole danger area shaded, not just outlined —
one danger colour is something you learn once instead of five times.

Also fixed: the win card read `4 KILLs`, because the plural helper appends a lowercase suffix.

---

## New in 1.3 — the leaderboard ranks by difficulty

> **Your place on the board is the hardest difficulty you have ever won on. Ties are broken by how
> many wins you have at that level.**

One sentence, printed under the board and in How to Play.

This is the answer to a problem coins could never solve. On a hard tier you perform worse at
everything, so any reward tied to performance shrinks along with you, and any reward that does not
shrink can be farmed by loading Nightmare and walking into a wall. **Standing is not a rate**, so it
cannot be farmed at all.

Verified against a seeded database — a player with **530 Rookie wins ranks below** one with three
Veteran wins, who ranks below one with a single Nightmare win:

| # | Fighter | Beat | Wins at that level | Total wins |
| --- | --- | --- | --- | --- |
| 1 | ONESHOT | NIGHTMARE | 1 | 1 |
| 2 | CLIMBER | VETERAN | 3 | 13 |
| 3 | GRINDER | ROOKIE | 530 | 530 |
| 4 | NEWBIE | UNRANKED | 0 | 0 |

**Two alternatives rejected.** *Locking high-level players out of easy tiers* breaks playing beside
a lower-level friend and punishes improvement — the reward for getting good should not be that an
option is taken away. *Easy wins stop counting once you are high level* creates a cliff where your
wins counted last week and silently stop this week, and a beginner can still farm.

**Delivery: `supabase-rank-by-tier.sql`, no schema change**, one function replaced. Board rows are
colour-banded by tier and the rail carries a legend. If the SQL is never run the client falls back
to the old most-wins board with no errors and no missing UI — verified by stripping the tier fields
from live responses.

**Bug caught in testing:** `create or replace function` cannot change a function's return type, so
pasting the file as first written would have failed in the SQL editor. It now drops `sr_board`
first, which touches no data.

---

## New in 1.2 — bot weapons by role, and a difficulty reward

**A Nightmare lobby was seven bots carrying the three slowest guns in the game.** Bots drew from a
3-wide band of the cost-ordered weapon list, and that list is ordered by price — price buys
specialisation, not all-round quality, so the top of it is all heavy weapons. Minigun (0.78 move),
Bazooka (0.84), Longshot Rail (0.92), two of them firing at 55 RPM. Nothing ever closed the
distance and every fight played out the same way.

Bots are now assigned a **role**, and difficulty decides how good the weapon is within that role:

| Role | Weakest → strongest |
| --- | --- |
| rush | Slugger Bat · Whisper SMG · Scattergun · Leech Claws · Tesla Arc |
| mid | M9 Sidearm · Trident BR · AK-47 |
| range | M9 Sidearm · Trident BR · AK-47 · Longshot Rail |
| heavy | Scattergun · Bulwark LMG · Cyclone Minigun · Bazooka |

| | Rookie | Regular | Veteran | Elite | Nightmare |
| --- | --- | --- | --- | --- | --- |
| Average POWER | 2.2 | 3.1 | 4.0 | 5.1 | 6.2 |
| Average move speed | 1.09 | 1.05 | 1.01 | 1.00 | **0.97** (was 0.85) |
| Bots that move fast | 94% | 69% | 57% | 44% | 38% |

Nightmare now fields a Tesla rusher (21% of bots), an AK at mid, a Rail holding an angle and a
Bazooka for area. The Tesla Arc was also previously **unreachable** — Nightmare's band topped out
one index below it — so bots never carried it at all.

**Difficulty reward.** A per-tier multiplier (×1.0 → ×2.1) applied to kills and fighters-outlasted
only, never to the turn-up fee, damage, medals or challenges. Those two are the things you cannot
fake by loading Nightmare and walking into a wall, which rules out a flat participation bonus. It
appears on the results screen as one additive line, `VETERAN opponents +144`.

It narrows the gap without closing it, and closing it is not really possible: on a hard tier you
perform worse at everything, so any performance-linked bonus scales down with you, and anything that
does not scale down is farmable by dying on purpose. Rookie still pays about 2.7× Nightmare.

**Two bugs found building this.** `TIER_IX[sk] || 1` — Rookie's index is **0, which is falsy**, so
every Rookie lobby was being handed Regular's weapons, Miniguns included. And padding the role lists
with duplicate entries to shape the curve over-weighted the Trident BR to 24–30% at low tiers;
replaced with a proper index mapping.

---

## New in 1.1 — XP contribution gate, and difficulty that changes how bots think

**The XP win bonus ignored contribution while the coins did not.** Coins ran the survival payment
through a contribution curve in 1.0, but XP still handed out a flat 110 for winning — so surviving
while the bots wiped each other out earned the same rank progress as carrying the match. Both
systems now use the same curve. The participation terms stay ungated on purpose; that is what keeps
a struggling player climbing at all. Measured on Rookie: a 3+ kill win gives 405 XP, a sub-3 kill
win 306, a loss 241.

**`aggro` was declared for every difficulty tier and never read by anything.** Difficulty changed
accuracy, reaction time, burst discipline and foot speed — nothing about decision-making. A
Nightmare bot picked targets, pursued, strafed and healed exactly like a Rookie one. Five real
behaviour dials now:

| Field | Rookie → Nightmare | Effect |
| --- | --- | --- |
| `focus` | 1.6 → 0.88 | Player weighting when picking a target. Above 1 = "mostly brawl with each other", which stops a beginner being swarmed by seven bots |
| `think` | 0.55 → 0.14 s | Seconds between decisions; low tiers commit to bad choices longer |
| `memory` | 0.5 → 3.2 s | How long a lost target is chased. Bots previously tracked you through walls at every tier |
| `strafe` | 0.40 → 1.05 | Sidestep strength — the biggest factor in how hard a bot is to hit |
| `heal` | 55 → 105 HP | When it goes looking for food |

Result, against a strong simulated player over twelve matches each:

| | Rookie | Regular | Veteran | Elite | Nightmare |
| --- | --- | --- | --- | --- | --- |
| Win rate | 92% | 75% | 50% | 33% | **8%** |
| Damage taken | 26 | 95 | 144 | 154 | 193 |

A first pass with every dial at maximum produced a **0% win rate over ten matches** — a wall, not a
challenge. `focus`, `memory`, `strafe` and `heal` were pulled back until a strong player takes about
one match in twelve.

**Bot weapons already followed the design; now confirmed with data.** They are drawn from a tier
band scaled by accuracy and run through the identical `fire()` path, so every mechanic applies to
them as it does to the player. Verified directly: a Tesla bot builds 5.5 heat a shot and locks out
2.2 s at 100, an AK bot's cone blooms and recovers, a Trident bot queues all three rounds off one
pull, a Scattergun bot reloads shell by shell. Average POWER carried per tier: 2.3 · 3.6 · 4.6 ·
5.9 · 7.0.

---

## New in 1.0 — economy simplified, difficulty stays a choice

**Your settings no longer change your pay.** The opponent-skill and lobby-size multipliers are
gone. Between them they swung earnings about **7×**, which made the difficulty picker an
arithmetic puzzle and meant two kids could play the same match and take home wildly different
amounts. The rule is now simply: your settings do not change your pay, your play does.

Lobby size still matters, but honestly rather than as a multiplier — you are paid **20 per
fighter you outlasted, plus 120 for winning**. Beating seven people pays more than beating one
because you beat seven people. That framing also closes the farm that removing the multiplier
would otherwise have opened: a one-opponent win pays 267 against a seven-opponent win's 715.

The level catch-up is gone too. It was making a brand new player's very first match the richest
one they would play all week — the exact moment the economy already felt loose.

| | 0.9 | 1.0 |
| --- | --- | --- |
| Per kill / headshot | 38 / 14 | 25 / 10 |
| Damage | ÷32 | ÷45 |
| Skill × lobby multipliers | 0.46× – 3.26× | **removed** |
| Level catch-up | ×1.25 → 1.0 | **removed** |
| First win in arena | 400 | 150 |
| Daily double cap | 500 | 250 |
| Typical win | ~1,320 | **748** |
| Average / match | ~1,250 | ~850 |
| Every weapon owned | match 41, day 11 | **match 61, day 16** |

One win now buys one cheap weapon, which was the goal.

### Also

**Tyrant Rex shrunk 30%** (scale 1.9 → 1.33). It was 4.56 m tall and 8.07 m long — 2.4× the
player's height and longer than a bus. It is now 3.19 m tall and 5.65 m long: still 2.2× the
Razor Raptor in both height and length, and comfortably the largest pet in the game, but it
reads as a dinosaur rather than as scenery. Pet `scale` is purely cosmetic — it does not touch
bite range, damage, HP or hitboxes — so nothing about the balance moved.

### Difficulty: a toggle, not a curve

Asked whether opponents should scale with level. They should not, and the reason is specific to
this game: **auto-scaling would invert the leaderboard.** The board ranks total wins and kills,
so a level 8 player facing Elite bots would win less than a level 2 player facing Rookie and
slide *down* the board. It would also punish improvement (get better, game gets harder, felt
experience stays flat) and stop two friends at different levels sharing a setting.

Instead: new players now start on **Rookie against five opponents** instead of Regular against
seven, three straight wins puts a nudge toward the next tier on the results screen, and two of
the twelve daily challenges require Veteran or harder.

**Known trade-off, stated plainly.** Without the skill multiplier, harder tiers now pay *less*
(Nightmare 374 against Regular's 715) because you die more and kill less. Rookie through Veteran
sit within ~8% of each other so only the extremes lose out, but the honest fix is to move the
difficulty reward from the wallet to the **scoreboard** — weight leaderboard standing by the tier
you beat. That needs a database change and has not been done.

---

## New in 0.9 — the economy

Measured before changing anything. A match against Regular bots paid ~1,150, so the 1,500
starting balance was worth **more than a full match, handed over before you play**. It unlocked
26 items including the tier-4 Trident BR outright.

| | Before | After |
| --- | --- | --- |
| Starting coins | 1,500 | **250** (below every weapon, pet and arena) |
| Per kill | 60 | 38 |
| Per headshot | 25 | 14 |
| Damage | ÷20 | ÷32 |
| Win placement | 500 flat | 300 × contribution |
| Medals (each) | 110–200 | 80–150, two thresholds raised |
| Daily double cap | 1,400 | 500 |
| Average / match | ~1,640 | ~1,250 |
| Every weapon owned | match 26, day 7 | **match 41, day 11** |

**Contribution gate.** Placement paid flat, so hiding while the bots killed each other paid the
same as winning a firefight. Just over half of it is now earned by fighting — three kills unlocks
the full bonus. Measured at Regular: losing with 2+ kills (930) now pays nearly as much as winning
passively (965), which is the intended message.

**Level affects earnings once, gently.** Level 1 gets ×1.25, gone by level 4. A bonus for the new,
not a penalty for the experienced — the same arithmetic, but one reads as a welcome. Kept small
after a first attempt at ×1.35 made a brand new player out-earn a level 6 one.

**XP decoupled from coins.** They were driven by the same terms, so rank was a second wallet.
XP is now much flatter: coins say how well you played, rank says how much you have played. Measured
best-case against worst-case at Regular — coins spread 4.7:1, XP spread 3.2:1. The least confident
kid still climbs ranks by turning up.

**Bug found doing it:** the itemised results screen hardcoded its own copy of every rate, and had
drifted from the maths — it printed `× 60` per kill while the formula paid 38, so the lines did not
sum to the total shown beneath them. All rates now come from one `PAY` object used by both.

---

## New in 0.8 — readability, fonts and composition

A design pass driven by three things a playtester actually noticed: helper text was hard to read,
the layout felt unbalanced, and the fonts needed checking.

**Contrast, measured rather than eyeballed.** A script walked every visible text node on all six
screens, composited the real background stack, and computed WCAG ratios. One colour, `#6b6280`,
carried nearly all the helper text at 9–10px and measured **3.1–3.5:1** against a 4.5:1 requirement.
It is gone, replaced by a proper three-step scale (`--bone` / `--text2` 9.5:1 / `--dim` 5.6:1), and
no UI text renders below 10px any more. All six screens now return zero failures.

**Fonts would have broken on the target device.** ChromeOS ships Arimo, Tinos, Cousine, Roboto and
Noto, and none of Impact, Haettenschweiler, Arial Narrow or Oswald. The display stack fell through
to generic `sans-serif`, meaning the wordmark, every heading, the ammo counter and the kill banners
rendered as plain Roboto on exactly the school Chromebooks this game is for. Anton now loads from
Google Fonts with Impact behind it, headings are pinned to weight 400 with `font-synthesis-weight:none`,
and the mono and body stacks gained metric-compatible ChromeOS fallbacks.

**Composition.** Measurement showed the profile card stranded 372px from the content block with
282px of dead band above it and 303px below. The card now sits in the left rail directly above the
standings — "you", then "everyone" — so the three columns read as one composed unit. Dead space is
symmetric, the rails are equal width, and the wordmark clears both.

Two bugs found doing it: `renderDaily` assigned `className` wholesale and silently wiped the layout
class the markup had put on the right rail; and the mastery line read "UNRANKED · 1 kills · 9 to
BRONZE" — wrong plural, and a tier label that contradicted the count next to it. Pluralisation is
now a helper and applied across opponents, minutes, pellets, chain targets and heat shots.

---

## New in 0.7 — the main menu

Playtest feedback: everything below the Deploy button was hard to read, the level was invisible,
joining the club was buried at the bottom, and the leaderboard was a screen you had to go and find.

Rebuilt on the layout this genre already agreed on, rather than a new idea:

- **Profile card pinned top-left** — level badge, name, rank, XP bar, lifetime record.
- **Standings rail on the left** — top five, a `···` break, then your own row, footer reading
  `YOU ARE #7 OF 24`. Always on the title screen, tap for the full board.
- **Daily challenges rail on the right.**
- **A radial scrim** over the arena behind the menu. Contrast against a lit, moving 3D background
  cannot be fixed by picking better text colours; the background has to be knocked back.
- **Training range removed from the main menu**, kept under Match setup → Mode. New players should
  press Deploy and be in a fight. The kid who wants to test-fire the Reaper before spending 15,000
  coins will go and find it.

Menu is now four buttons: Deploy, Armory, Match setup, How to play.

Two bugs found while building it: `#scr-title>*{position:relative}` silently overrode the profile
card's `position:absolute` (ID selector beats class), so the card rendered centre-top instead of
pinned; and the wordmark at `7.2vw` crowded both rails, so it runs smaller when the rails are shown.

---

## New in 0.6 — the club

Optional online play: a handle, a 4-digit PIN, a shared leaderboard, and a save
that follows a kid to any computer. It is **off until somebody pastes a key in**,
and if it is off, or the wifi is down, or the school blocks Supabase, the entire
game still works and saves locally. Setup is in `ONLINE-SETUP.md`; the database
is one file, `supabase-setup.sql`.

**No personal data, at all.** A made-up handle, a bcrypt-hashed PIN, a club word
and game stats. No email, no real name, no age, no location, no device id. That
is what keeps this outside COPPA, and it is why there is no "forgot my PIN" link.

**Security shape.** Both tables have RLS on with zero policies, so the publishable
key shipped in the HTML cannot read or write them at all. Six `security definer`
functions are the only surface: `sr_register`, `sr_login`, `sr_submit`, `sr_save`,
`sr_board`, `sr_recent`. The internal `sr_auth` helper is explicitly revoked from
`anon`. Verified: as `anon`, direct selects and inserts on both tables are denied,
and so is `sr_auth`.

**Anti-cheat, and what it deliberately does not do.** Impossible values are
clipped (you cannot report more kills than there were opponents). Two rate limits
do the real work: 25 trials an hour, and you cannot claim more minutes of play in
an hour than an hour holds. An earlier version also had a per-match rule — "five
kills cannot happen in sixteen seconds" — and testing threw out a legitimate
5-kill run, which is precisely the run a kid wants on the board. Rate limits can
never do that to an honest match, so the per-match rule is gone. The remaining
defence is that everything is visible: the board shows trial counts next to kills.

---

## Feature status

| System | Status | Notes |
| --- | --- | --- |
| 3D rendering, arenas, characters | ✅ Complete | 10 arenas, all verified in-browser |
| First / third person camera | ✅ Complete | Plus melee swing and charge wobble on the view model |
| Movement, collision, step-up, jumping | ✅ Complete | Ice friction, low gravity, void falls |
| **14 weapons** | ✅ **Rebuilt in 0.5** | 11 firearms + 3 melee, each with a distinct mechanic |
| Weapon mechanics layer | ✅ New | Falloff, bloom, burst, heat, bipod, charge, shell reload, backstab, leech, knockback |
| Per-weapon visual + audio effects | ✅ Complete | 14 signatures, 4 new (`smash`, `leech`, `burst`, `supp`) |
| Synthesised audio | ✅ Complete | 4 new weapon timbres + overheat, charge, multi-kill, rank-up stings |
| Bot AI | ✅ Complete | Now handles heat, burst and melee weapons; engagement range derives from falloff |
| 7 pets with health and revive | ✅ Complete | Re-verified after the combat rewrite |
| Food and healing | ✅ Complete | Carries over between matches |
| Shop and purchasing | ✅ Complete | Melee weapons take slot 3; cards show role, limitation and mastery |
| **Save / load** | ✅ **Fixed in 0.5** | `localStorage` + migration + a reset button |
| **Daily challenges** | ✅ New | 3 a day, date-seeded so friends get the same three |
| **Ranks and XP** | ✅ New | 10 tiers, Scrap Rookie → Void Sovereign |
| **Weapon mastery** | ✅ New | 4 tiers per weapon, cosmetic charms only |
| **Match medals** | ✅ New | 7 medals on the results screen |
| **Multi-kill banners** | ✅ New | DOUBLE KILL → ABSOLUTE UNIT, plus kill-count sprees |
| **Training range** | ✅ New | No damage, infinite ammo, respawning dummies, T cycles every weapon |
| HUD, minimap, scoreboard | ✅ Complete | Heat bar, charge bar, status line, true-spread crosshair |
| Economy and payouts | ✅ Complete | Itemised, including medals, challenges and the daily double |
| **Balance harness** | ✅ New | `balance-sim.js`, runs inside the live page |
| Balance pass | ✅ Complete for 0.5 | Table below; see the caveats |
| **Online accounts** | ✅ New in 0.6 | Handle + 4-digit PIN, no personal data |
| **Shared leaderboard** | ✅ New in 0.6 | Per-club, with a live "just now" feed |
| **Cloud save** | ✅ New in 0.6 | Coins, unlocks and mastery follow you to any computer |
| **Offline fallback** | ✅ New in 0.6 | Blank key or dead wifi = the game just plays locally |

---

## Measured balance

`balance-sim.js`, 10 matches per weapon, Regular bots, 7 opponents, M9 Sidearm in slot 2, Leech Claws in slot 3.

| Weapon | Cost | Avg kills | Win % | Avg damage |
| --- | --- | --- | --- | --- |
| M9 Sidearm | 0 | 4.7 | 100% | 916 |
| Whisper SMG | 350 | 4.6 | 90% | 895 |
| Scattergun | 900 | 4.1 | 70% | 937 |
| Trident BR | 1,400 | 4.6 | 70% | 928 |
| AK-47 | 1,900 | 3.9 | 80% | 733 |
| Bulwark LMG | 2,600 | 3.5 | 60% | 754 |
| Cyclone Minigun | 4,200 | 3.4 | 70% | 594 |
| Longshot Rail | 5,200 | 5.3 | 90% | 959 |
| Bazooka | 7,000 | 5.5 | 90% | 946 |
| Tesla Arc | 8,600 | 4.1 | 70% | 844 |
| Obsidian Reaper | 15,000 | 3.9 | **40%** | 687 |

For contrast, 0.4's open issue was the Scattergun at a 33% win rate and the LMG at 25%, both below the
free pistol. Nothing sits below the pistol on kills any more, nothing is dead, and the mythic is at the
bottom of the win table on purpose.

**Read this as directional.** The harness's simulated player tracks with a smooth lag and never panics,
gets flanked on purpose, or deliberately ambushes. That flatters precise semi-autos — the M9's 100% is the
clearest artifact in the table — and punishes the Scattergun and melee, whose real strength is positional
and which a person plays completely differently. Ten matches is roughly ±15% noise.

---

## Verification performed

All in a real browser (Chromium, Three.js r128 loaded from CDN) against the running game.

| Test | Result |
| --- | --- |
| JavaScript syntax (`node --check` on the extracted script) | Pass |
| Boot, Three.js load, title screen render | Pass |
| All 14 weapons fired 50× each with random aim, ADS toggled every third shot | Pass, 0 errors |
| All 10 arenas build and run | Pass, 0 errors |
| All 7 pets run a full match | Pass, 0 errors |
| All 7 shop tabs, plus setup / help / title | Pass, 0 errors |
| ~200 simulated full matches across the whole roster | Pass, 0 errors |
| Particle pool under sustained fire | Capped at 461 against a 460 target, zero leaked |
| Save round-trip through a page reload | Pass — coins, XP, rank, mastery, ownership, dailies restored |
| Legacy 0.4 save migration | Pass — invalid loadout corrected, old stats preserved |
| Results screen: medals, daily completion, mastery tier-up, rank-up, XP bar | Pass, verified visually |
| Training range: no damage, infinite ammo, dummy respawn, T cycling | Pass, verified visually |
| Heat bar, charge bar, PLANTED indicator, multi-kill banner | Pass, verified visually |

### 0.6 online verification

Run against a throwaway Postgres 16 plus PostgREST in Docker, with a local proxy
so the game's real networking code ran unmodified and same-origin. The SQL, the
client and the wire format were tested together rather than separately.

| Test | Result |
| --- | --- |
| `supabase-setup.sql` applies to a clean database | Pass |
| As `anon`: direct read/write of `players` and `matches` | Denied, as designed |
| As `anon`: calling the internal `sr_auth` helper | Denied, as designed |
| Register: duplicate name, too-short name, rude name, malformed PIN | All four rejected correctly |
| Login with right PIN / wrong PIN / unknown handle | Correct in all three cases |
| PIN lockout after 8 wrong guesses | Locks 15 min, and the correct PIN is refused while locked |
| Impossible submission (9999 kills, 999999 damage) | Clipped to the lobby size |
| Score spam on a loop | Cut off by the hourly limits |
| Registering and playing through the real UI | Pass — handle stored, score on the board |
| Two players, seven trials, ranking and live feed | Pass |
| Cloud save round-trip onto a wiped machine | Pass — coins, unlocks, XP, rank, mastery, loadout restored |
| Blank key: both new screens, plus a full match | Pass — degrades quietly, saves locally, 0 errors |

### Also fixed while verifying 0.6

- **A dying beginner got a red error toast.** The submit rule rejected short
  trials, and dying twenty seconds in is completely normal. The floor is now
  5 seconds, and rejections the player cannot act on are silent.
- **Reset progress would have erased the online fighter too.** It wrote an empty
  save, which then synced upward. It signs out first now.
- **The results screen buttons wrapped mid-word** once a fourth button was added.
- **Quitting a match left the results overlay** sitting on top of the next screen.
| Clicking Deploy with a real mouse click starts a match and renders the HUD | Pass |
| **Pointer lock** | **Not verified** — see below |

**Pointer lock is the one thing still unconfirmed.** The automated browser used for these tests does not
grant `requestPointerLock`, so mouse-look and firing could not be exercised through the real input path
(they were exercised by driving the same functions directly, which proves the game logic but not the
capture). 0.5 adds a `pointerlockerror` handler that now tells the player *"This browser blocked mouse
capture — try opening the file in Chrome or Edge"* instead of dropping them into a match they cannot aim in.
**Someone should click Deploy on a normal desktop Chrome and confirm the cursor is captured and LMB fires.**

### Also fixed while verifying

- **Results screen payout list rendered on one line.** `.statlist div` set `display:flex` on every
  descendant, including the `.paysplit` container, so its rows became flex *items* laid out in a row.
- **Title screen clipped its own header** once the rank chip and daily panel were added —
  `justify-content: center` on an overflowing flex column cuts off the top. Now `safe center`.
- **Mastery charms filled half the screen.** They started life at the back of the gun, which in first
  person is ~25 cm from the camera. Moved forward onto the barrel.
- **The Reaper's charge effect blocked the crosshair.** Replaced a growing 0.65 m cube with a small
  core plus rings that collapse inward as the charge fills.
- **Impact sparks appeared in mid-air** at maximum range when a shot hit nothing, for the same
  `rayWorld` sentinel reason as the Bazooka bug.

---

## Open issues

### 1. Several kids on one laptop share one save

There are no named profiles, so a shared family or classroom machine means shared coins, rank and
challenges. This is now the most-requested-shaped gap, and it is a small change: a name prompt on first
run and a per-name save key. The **Reset progress** button on the How to Play screen is the stopgap.

### 2. No mobile or touch support

Pointer lock has no touch equivalent, so the game is desktop-only. For middle schoolers this is a real
audience limit — a lot of them are on phones or iPads. A touch scheme would need virtual sticks, auto-fire
and generous aim assist, which is a genuine project rather than a tweak.

### 3. The balance harness still has a shooter-shaped blind spot

It cannot express ambushes, cover discipline or panic, which are exactly what the Scattergun and melee
weapons are built around. Those two lines in the table should be trusted least. The right next step is
adding a "hold a corner and wait" behaviour to the simulated player rather than tuning shotgun numbers
against a harness that cannot play one.

### 4. Void arenas still have no edge warning

Skyport and Void Nexus kill the simulated player in seconds via falls. A real player can see the edges,
but a red rim light or an audible warning near a ledge would be kind.

### 5. Minor

- `G.dmgEls` is still a dead array left over from the pre-0.3 effects system.
- The scanline overlay sits over the HUD as well as the 3D view. Intentional, but worth a look.
- The bot weapon pool now includes the Slugger Bat and Leech Claws. Melee bots work, but their approach
  logic is the generic one and they can look indecisive at the edge of their reach.

---

## Recommended next steps

**Highest value first, and the first two are worth more than any new content:**

1. **Test it on an actual school Chromebook.** Managed Chromebooks sometimes
   block pointer lock and school networks sometimes block unfamiliar domains.
   If either bites, the leaderboard is moot. Cheapest thing to check, most
   expensive thing to discover late.
2. **Per-handle local save keys**, so two kids on one laptop stop overwriting
   each other's local copy (open issue 1).
3. **A weekly challenge** alongside the three dailies — something with a bigger number that takes several
   sessions, so there is a reason to come back on Thursday and not just tomorrow.
4. **Fix the harness before touching shotgun numbers again** (open issue 3).
5. **Edge warnings in the void arenas.**

**Deferred features, roughly in the order I would add them:**

- Weapon skins — reuses the entire existing shop and box-spec pipeline, and mastery already gives a
  natural unlock condition for them.
- A horde or wave survival mode.
- Bot pets and bot cosmetics, so lobbies look as varied as you do.
- Per-arena music.
