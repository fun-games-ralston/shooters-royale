# Shooter's Royale — Build Status

**Version:** 0.6 · **Date:** 23 August 2026 · **File:** `index.html` (~204 KB, ~3,700 lines)

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
