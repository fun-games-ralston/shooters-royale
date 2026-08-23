# Shooter's Royale — Game Design & Technical Specification

**Version:** 0.6 · **Date:** 23 August 2026 · **Build:** `index.html` (single file, ~204 KB)
· `supabase-setup.sql` · `ONLINE-SETUP.md` · `balance-sim.js`

---

## 1. Concept

A 3D browser arena shooter with blocky Minecraft-style fighters. One life, 200 HP, last one standing wins. You spend coins earned in matches on weapons, pets, cosmetics and new arenas, and the loop is dodge → shoot → eat to heal → win.

**Design pillars**

1. **One life means every fight matters.** No respawns. Health never regenerates passively — you have to buy food beforehand and eat it mid-fight, which turns healing into a resource decision under fire.
2. **Price equals power, visibly.** Every weapon and pet carries a 1–10 POWER rating shown as a bar in the shop, and it rises monotonically with cost. Real balance underneath is more nuanced (a sniper trades sustained damage for lethality), but the player-facing promise is never violated.
3. **Every weapon has to feel different, and every weapon has to hurt to carry.** Not just different numbers — different light, sound, particles, *and a named drawback printed on the shop card*. A rail beam and a rocket should not read as the same event, and neither should be the obvious answer to every situation.
4. **Nothing you buy ends the game.** The most expensive weapon in the armory is a three-shot execution tool, not a win button. Buying it should make you want to play more, not less.
5. **Coming back tomorrow has to be worth something.** Coins alone stop mattering once you own things. Rank, weapon mastery, daily challenges and a doubled first win each day are what keep the tenth session as interesting as the first.

---

## 2. Core rules

| Rule | Value |
| --- | --- |
| Starting health | 200 HP for everyone, player and bots |
| Lives | 1, no respawns |
| Win condition | Last fighter standing, or most kills when the clock runs out |
| Grace period | 3.2 s at match start; nobody can fire |
| Headshot multiplier | ×2.5 |
| Torso multiplier | ×1.0 |
| Leg multiplier | ×0.65 |
| Passive regen | None (except the Ashen Cat pet's perk) |
| Absorption | Gold overshield stacked on top of 200 HP; depletes before HP |
| Fall damage | Fatal in void arenas only (Skyport, Void Nexus) |

**Hitboxes** — three axis-aligned boxes per fighter: HEAD (y 1.42–1.96), BODY (0.84–1.42), LEGS (0–0.84).

---

## 3. Controls

| Input | Action |
| --- | --- |
| W A S D | Move, relative to look direction |
| Mouse | Aim (click the arena once to lock the cursor) |
| LMB | Fire |
| RMB | Aim down sights |
| R | Reload |
| Space | Jump |
| Shift | Sprint |
| 1 / 2 / 3 | Weapon slots |
| F | Eat |
| Q | Swap which food is selected |
| V | Toggle first / third person |
| T | Next weapon — **training range only** |
| Tab | Scoreboard |
| Esc | Release cursor and pause |

Mouse and keyboard only — pointer lock has no touch equivalent, so there is no mobile control scheme.

**Modes.** *Trial* is the ranked mode: one life, coins, XP, challenges. *Training range* is a safe sandbox — you take no damage, ammo never runs down, the dummies never shoot back and respawn two seconds after you drop them, and **T cycles through every weapon in the game whether you own it or not.** Nothing in training pays out. It exists so a new player can learn a gun, and so anyone can feel the Obsidian Reaper before deciding to save fifteen thousand coins for it.

---

## 4. Weapons

**Fourteen weapons — eleven firearms and three melee.** Slot 1 and slot 2 hold firearms; slot 3 always holds
your chosen melee weapon, so you are never completely disarmed when a magazine runs dry.

| # | Weapon | Class | Cost | PWR | Damage | RPM | Mag / spare | Reload | Full power to | Move | Fire |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Combat Knife | Melee | 0 | 1 | 55 (×2.2 from behind) | 190 | — | — | 3.0 m | 1.18× | auto |
| 2 | M9 Sidearm | Pistol | 0 | 1 | 30 | 300 | 12 / 72 | 1.15 s | 26 m → 60% at 55 m | 1.12× | semi |
| 3 | Whisper SMG | SMG | 350 | 2 | 20 | 900 | 30 / 120 | 1.45 s | 14 m → 45% at 32 m | 1.14× | auto |
| 4 | Slugger Bat | Melee | 600 | 2 | 105 + launch | 62 | — | — | 4.2 m | 1.10× | semi |
| 5 | Scattergun | Shotgun | 900 | 3 | 16 × 9 pellets | 85 | 5 / 30 | shell-by-shell | 11 m → 30% at 24 m | 1.06× | semi |
| 6 | Trident BR | Burst rifle | 1,400 | 4 | 28 × 3-round burst | 900 | 21 / 84 | 1.7 s | 55 m → 75% at 85 m | 1.06× | burst |
| 7 | AK-47 | Rifle | 1,900 | 4 | 32 | 600 | **20** / 80 | 2.0 s | 60 m → 70% at 90 m | 0.98× | auto |
| 8 | Bulwark LMG | Machine gun | 2,600 | 5 | 27 | 720 | 60 / 120 | 3.2 s | 65 m → 70% at 95 m | 0.92× | auto |
| 9 | Leech Claws | Melee | 3,200 | 5 | 38, heals you 15 | 400 | — | — | 3.2 m | 1.16× | auto |
| 10 | Cyclone Minigun | Heavy | 4,200 | 6 | 18 | 1200 | 150 / 150 | 5.5 s | 40 m → 55% at 70 m | 0.78× | auto |
| 11 | Longshot Rail | Sniper | 5,200 | 7 | 110 / **275 head** | 55 | 4 / 20 | 2.7 s | no falloff, 250 m | 0.92× | semi |
| 12 | Bazooka | Launcher | 7,000 | 8 | 95 + 85 splash | 55 | 2 / 6 | 3.2 s | no falloff, 150 m | 0.84× | semi |
| 13 | Tesla Arc | Energy | 8,600 | 9 | 46 + 2 chains | 300 | **heat bar** | — | no falloff, 42 m | 1.04× | auto |
| 14 | Obsidian Reaper | Mythic | 15,000 | 10 | lethal on any hit | 30 | 1 / 2 | 3.2 s | no falloff, 260 m | 0.90× | charged |

### 4.1 Mechanics glossary

These are the levers that make weapons behave differently rather than just score differently.
Every one of them is surfaced on the shop card as a green ▲ *what it is for* line and a red ▼ *what it costs you* line.

| Mechanic | Field | What it does |
| --- | --- | --- |
| **Damage falloff** | `fall:[near, far, min]` | Full damage out to `near`, then a linear slide down to `min` at `far`. This is what makes the SMG a room-clearer and the Rail a lane-holder rather than two guns with different numbers. |
| **Spread bloom** | `bloom:{per, max, rec}` | Every shot widens the cone by `per`, capped at `max`, recovering at `rec`/s. The AK climbs hard — hold the trigger and you hit sky. |
| **Burst fire** | `burst`, `burstGap` | One trigger pull always delivers the whole burst, even if you let go. Then a forced pause. |
| **Heat** | `heat:{per, cool, lock}` | No magazine at all. Each shot adds heat; at 100 the coils lock for `lock` seconds and drain. Cooling only starts 0.35 s after your last shot. |
| **Charge** | `charge`, `chargeSlow` | Hold the trigger to charge. You move at `chargeSlow` speed and glow purple at the muzzle the whole time. Release early and it fizzles. |
| **Bipod** | `bipod:{still, spread}` | Stand still for `still` seconds and spread collapses to `spread`×. The HUD prints **▬ PLANTED — SPREAD LOCKED** so the mechanic is discoverable. |
| **Hip penalty** | `hipMult` | Multiplies spread when you are *not* aiming down sights. The Rail's ×26 is why it has to be scoped. |
| **No ADS** | `noAds` | Right mouse does nothing. The Minigun cannot be aimed, only pointed. |
| **Shell reload** | `shellReload` | Loads one shell at a time and **breaks off the instant you pull the trigger**, so a half-loaded Scattergun is still a Scattergun. |
| **Backstab** | `backstab` | Damage multiplier when you hit someone from behind (dot product of their facing vs. your approach < −0.25). |
| **Knockback / stun** | `knock`, `stun` | Impulse along the shot direction plus a brief slow. |
| **Lifesteal** | `leech` | Heals the attacker per hit landed. |
| **Spin-up / spin slow** | `spinup`, `spinSlow` | Barrels must reach speed before the first round, and you walk slower while spun up. Player only; bots fire immediately. |

### 4.2 Weapon roles

- **Combat Knife** (free) — fastest movement in the game and double damage from behind. Three metres of reach.
- **M9 Sidearm** (free) — one shot per click, tight cone, lightest gun. Fades past 26 m.
- **Whisper SMG** — 15 rounds a second and the best hip-fire. Collapses to 45% damage past 32 m.
- **Slugger Bat** — 105 damage and a real launch. Best weapon in the game on any map with a hole in it. One swing per second.
- **Scattergun** — 144 damage in a shell inside 11 m, and pellets that roll for headshots independently. Five shells, shell-by-shell loading.
- **Trident BR** — 84 per burst, 210 if you find a head. Laser-accurate, but you cannot hold the trigger.
- **AK-47** — the honest answer to most problems. **Twenty-round magazine** and hard climb: tap it in fours.
- **Bulwark LMG** — sixty rounds without reloading, and planting yourself drops spread to 0.62°. Slow to carry and slow to reload.
- **Leech Claws** — 38 a rake, six times a second, healing 15 a hit. You are your own health pack, if you can close.
- **Cyclone Minigun** — the highest sustained damage anywhere, out of one 150-round belt. Half a second of spin-up, no ADS, and you walk like a fridge.
- **Longshot Rail** — 275 to the head at 250 m. Four shots, and un-scoped it could miss a wall.
- **Bazooka** — two rockets a tube, 5.6 m splash, hits people behind cover, and rocket-jumping works (self-splash is 35%). Eight rockets a life.
- **Tesla Arc** — never reloads, chains to two more fighters within 9 m at 55%. Overheats after 18 shots, and only reaches 42 m.
- **Obsidian Reaper** — kills on any hit to any body part. **Three shots per match.** A full second of charging at half speed, glowing purple, before each one.

### 4.3 Why the Reaper is not the end of the game

This is the single most important balance decision in 0.5. In 0.4 the Reaper was a 300 m one-shot rifle
with nine shots and no cast time, which meant that the moment a player saved 15,000 coins there was
nothing left to want. It is now:

- **three shots per match**, with no reserve refill;
- **a one-second charge** during which you move at half speed and emit a purple muzzle glow anyone can see;
- **0.90× move speed** and a 3.2 s reload between shots.

The simulated result (10 matches, Regular bots, 7 opponents, M9 in slot 2) is **40% win rate — the lowest
of any firearm in the armory** — while still averaging 3.9 kills, so it is a great tool and a bad crutch.
You need a real primary for the other five minutes of the match, which is exactly the intended feel.

### 4.4 Measured balance

From `balance-sim.js`: 10 matches per weapon, Regular bots, 7 opponents, M9 Sidearm in slot 2,
Leech Claws in slot 3. Read this as directional — the harness's caveats are in §16.

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

Nothing is dead, nothing dominates, and the mythic sits at the bottom of the win table by design.
The Sidearm's 100% is the clearest harness artifact: a simulated player with smooth tracking and no
panic is the best case a precise semi-auto will ever see.

---

## 5. Weapon effects

Each weapon has a distinct visual and audio signature, both named on its shop card so you can see what you're buying.

| Weapon | Effect key | Sound | What it does |
| --- | --- | --- | --- |
| Combat Knife | `slash` | `slash` | Spinning crescent blade arc sweeps in front of you |
| M9 Sidearm | `bullet` | `pop` | Directional muzzle flare, brass casing ejects and bounces |
| Whisper SMG | `bullet` | `tick` | Rapid strobe flashes, heavy casing spray |
| Slugger Bat | `smash` | `thwack` | Wide horizontal swing arc, twin shockwave rings, sparks and a camera thump |
| Scattergun | `buck` | `boom` | Smoke cone, shockwave ring at the barrel, 9 visible pellets |
| Trident BR | `burst` | `trip` | Three sharp blue flashes with a white-cored tracer per round |
| AK-47 | `bullet` | `crack` | Larger flash, heavier brass |
| Bulwark LMG | `supp` | `thud` | Fat orange tracers, suppression ring and barrel sparks every round |
| Leech Claws | `leech` | `rake` | Three green claw streaks, then green motes fly from the victim into you |
| Cyclone Minigun | `stream` | `brr` | Thick molten tracers plus a spark stream off the spinning barrels |
| Longshot Rail | `rail` | `thump` | Lingering laser beam with a white-hot core and a muzzle ring pulse |
| Bazooka | `rocket` | `launch` | Modelled rocket with flickering flame and smoke trail; fireball, double shockwave rings, tumbling debris |
| Tesla Arc | `arc` | `zap` | Jagged forked lightning (7 jittered segments), chain arcs to secondary targets |
| Obsidian Reaper | `void` | `reap` | Purple charge core that pulses tighter as it fills, then a violet void beam; victims burst into souls |

Shared effects: muzzle flash lights the arena via a single pooled `PointLight`, kills explode fighters into
blocky debris tinted by the killing weapon, headshots pop a red ring, impacts throw sparks and dust.

**Mastery charms.** From ten kills with a weapon onward, small glowing pips appear along its barrel in the
mastery tier's colour — bronze, silver, gold, diamond. They are decoration and never touch a damage number.
They sit forward on the barrel deliberately: anything near the camera in first person blows up to fill half the screen.

---

## 6. Pets

Seven pets. One equipped at a time. They follow you, engage nearby enemies, and grant a passive perk while alive.

| Pet | Cost | PWR | Bite | Cooldown | DPS | HP | Perk |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Scrap Terrier | 900 | 1 | 8 | 1.2 s | 6.7 | 70 | Marks every enemy within 30 blocks on the minimap, through walls |
| Ashen Cat | 1,200 | 2 | 7 | 1.0 s | 7.0 | 60 | Regenerates 1.5 HP/s while out of combat for 3 s |
| Venom Coil | 1,800 | 3 | 9 | 1.3 s | 6.9 | 60 | Bites poison for 4 dmg/s over 3 s |
| Frost Wolf | 2,600 | 5 | 13 | 1.15 s | 11.3 | 90 | You move 7% faster while it lives |
| Ironhide Bear | 3,800 | 6 | 22 | 2.0 s | 11.0 | 150 | All incoming damage reduced by 10% while it stands |
| Razor Raptor | 5,200 | 8 | 11 | 0.75 s | 14.7 | 80 | Bites every 0.75 s, sprints far ahead to harass |
| Tyrant Rex | 10,000 | 10 | 34 | 2.6 s | 13.1 | 190 | 34 dmg per bite and enemies are thrown back |

**Pet health and counterplay.** Pets are not free permanent damage. Biting an armed fighter draws return fire — the pet takes `max(7, weapon damage × 0.55)` per bite it lands. Explosions damage them too. At zero HP the pet goes down for **18 seconds**, and its perk goes down with it. This is the main lever keeping high-tier pets from replacing the player.

Pet HP and the revive countdown show in the HUD pet bar bottom-left.

---

## 7. Food

Health never comes back on its own. Everything is bought in the Armory before a match and eaten with **F**; **Q** cycles what's selected. Unused food carries over between matches.

| Food | Cost | Heal | Absorption | Other |
| --- | --- | --- | --- | --- |
| Bread | 20 | +25 | — | — |
| Cooked Steak | 45 | +50 | — | — |
| Honey Bottle | 70 | +35 | — | +25% move speed for 5 s |
| Golden Apple | 130 | +90 | +20 | — |
| Enchanted Golden Apple | 320 | +200 | +60 | Regen 3 HP/s for 8 s |
| Chorus Fruit | 110 | +10 | — | Blinks you up to 14 blocks in a random direction |

The Enchanted Golden Apple is the comeback button: a full heal plus 60 gold absorption stacked over your 200 cap, plus a regen tail.

---

## 8. Arenas

Ten arenas, procedurally built each match from a themed definition. Foundry is free; the rest unlock with coins.

| Arena | Cost | Modifier |
| --- | --- | --- |
| Foundry | 0 | — |
| Sandpit | 550 | — |
| The Grid | 1,100 | +12% move speed |
| Atrium | 1,750 | — |
| Frostbite | 2,500 | Slick ice (0.42× friction) |
| Emberfall | 3,300 | Lava hazard, 14 dmg/s |
| Skyport | 4,200 | 0.82× gravity, fatal falls |
| Neon Bazaar | 5,200 | — |
| Bone Temple | 6,400 | — |
| Void Nexus | 8,000 | 0.55× gravity, fatal falls |

**Generation.** Each arena is built at runtime: floor (or floating island chunks for void arenas), perimeter walls, 16–24 cover obstacles, up to 4 upper decks with generated staircases, a centre structure with two stairways, hazard pools, themed decor, and a 12-point spawn ring. Typical result is 132–174 collision boxes. Weather particles (snow, embers, dust, motes) are driven by the theme.

---

## 9. Bots

| Skill | Accuracy | Reaction | Fire discipline | Move | Aggro | Coin multiplier |
| --- | --- | --- | --- | --- | --- | --- |
| Rookie | 0.24 | 0.85 s | 0.55 | 0.72× | 0.50 | ×0.6 |
| Regular | 0.42 | 0.55 s | 0.75 | 0.86× | 0.70 | ×1.0 |
| Veteran | 0.58 | 0.36 s | 0.90 | 0.96× | 0.85 | ×1.4 |
| Elite | 0.72 | 0.24 s | 1.00 | 1.04× | 0.95 | ×1.8 |
| Nightmare | 0.86 | 0.15 s | 1.10 | 1.12× | 1.00 | ×2.4 |
| Mixed | per bot | — | — | — | — | ×1.25 |

**Behaviour.** Bots pick targets on a think timer, with a **1.25× bias toward each other rather than the player** — they fight one another, which is what makes a 7-bot lobby survivable. They strafe and approach to their weapon's preferred range, jump when stuck, heal when hurt, and use burst discipline on automatic weapons (2 + round(fire × 5) shots, then a 0.55–1.5 s pause). Engagement is capped at 46 m, or 110 m for the Rail and Reaper. Aim error scales with distance and target speed.

---

## 10. Economy and progression

### 10.1 Coins

**Payout formula, evaluated at the end of every trial:**

```
subtotal = 40                       (turning up)
         + kills      × 60
         + headshots  × 25
         + damageDealt ÷ 20         (overkill does not count)
         + placement bonus

placement = 500 (win) | 260 (2nd) | 170 (3rd) | 100 (4th) | 40 (else)

coins = round( subtotal
             × skillMultiplier      (0.6 – 2.4)
             × fieldMultiplier      (0.7 + bots × 0.06)
             × streakMultiplier )   (1 + 0.1 per consecutive win, capped 1.5)
      + multi-kill bonus            (15 × the size of each multi-kill)
      + medals                      (110 – 200 each)
      + daily challenges            (150 – 300 each)
      + 400 the first time you win in each arena
      × 2 on your first win of the day
```

The results screen itemises every line so the player can see exactly where the money came from.

### 10.2 Multi-kills

Two kills inside five seconds of each other chain. A banner and a rising three-note sting fire at
DOUBLE KILL → TRIPLE KILL → QUAD KILL → MEGA KILL → KILLTACULAR → ABSOLUTE UNIT, each worth
15 × the chain length in coins. Separately, reaching 3 / 5 / 7 / 10 kills in a match pops
RAMPAGE / UNSTOPPABLE / GODLIKE / LEGENDARY.

### 10.3 Medals

Seven per-match medals, awarded on the results screen and counted forever in `S.stats.medals`.
They reward *how* you played, not just whether you won, so a losing match can still feel like it went somewhere.

| Medal | Condition | Coins |
| --- | --- | --- |
| Sharpshooter | 3+ headshots | 120 |
| Executioner | 5+ kills | 150 |
| Untouchable | won above 150 HP | 200 |
| Brawler | 2+ melee kills | 110 |
| Quartermaster | killed with 3 different weapons | 130 |
| Clutch | won after dropping below 40 HP | 180 |
| Rampage | a 3-kill chain | 140 |

### 10.4 Daily challenges

Three challenges a day, drawn deterministically from a pool of ten by hashing the date, so every
player on the same day gets the same three and friends can compare. Progress persists across
matches within the day and resets at midnight. Worth 150–300 coins each.

The pool: 6 kills · 4 headshots · win a trial · 3 melee kills · 2,500 damage · play 3 trials ·
kill with 3 different weapons · 2 splash-or-lightning kills · finish top 3 twice · win without eating anything.

**Your first win of each day pays double** (capped at +1,400). This is the single strongest
reason to open the game tomorrow.

### 10.5 Rank

XP is separate from coins and cannot be spent, which is the point — it keeps meaning something
after you own everything.

```
xp = kills × 40 + headshots × 15 + damage ÷ 40 + (win ? 250 : 60) + medals × 30
```

Ten ranks: Scrap Rookie (0) → Block Runner (600) → Trench Regular (1,600) → Deck Hunter (3,200)
→ Ironside (5,600) → Arena Veteran (9,000) → Cinder Champion (13,500) → Rail Master (19,500)
→ Obsidian Elite (27,000) → Void Sovereign (37,000). Shown as a coloured chip with an XP bar on
the title screen and on every results screen.

### 10.6 Weapon mastery

Every weapon counts its own kills. Ten kills earns BRONZE, thirty SILVER, seventy-five GOLD,
one hundred and fifty DIAMOND. Each tier adds a glowing charm to that weapon's barrel and prints
the tier on its shop card.

Mastery never changes a damage number. Its whole job is to give a reason to pick up the cheap guns
again after you own the expensive ones — which is the failure mode a pure coin economy always has.

### 10.7 Content cost totals

| Category | Total |
| --- | --- |
| Weapons (14) | 50,950 |
| Pets | 25,500 |
| Arenas | 33,000 |
| Cosmetics (hair, outfits, accessories) | 37,480 |
| **Everything** | **146,930** |

Starting balance is 1,500 coins. A competent player earns roughly 1,300–2,500 coins per match against
Regular bots depending on medals and challenges, which puts full completion around 70–90 matches and a
genuinely usable loadout (good gun + melee + pet + a second arena) inside about 10.

---

## 10.8 The club (optional online play)

Off by default. The game ships with a blank key in the `CLOUD` block near the top
of the script; fill it in and the leaderboard turns on. Everything degrades
quietly — a blank key, dead wifi or a school firewall leaves the whole game
playable and saving locally, with the two online screens explaining themselves.

**Identity is a made-up handle and a 4-digit PIN. Nothing else, ever.**
No email, no OAuth, no real name, no age, no location, no device id. This is a
design constraint, not an oversight: the players are under 13, and collecting
anything identifying would put the project under COPPA and require verifiable
parental consent. There is consequently no "forgot my PIN" flow, which is the
price of that choice and is worth paying.

**Shape.** Two tables (`players`, `matches`), both with RLS on and **zero
policies**, so the publishable key embedded in the HTML cannot touch them.
Six `security definer` functions are the entire API surface:

| Function | Does |
| --- | --- |
| `sr_register(handle, pin, club)` | Claims a handle. Length, charset and rude-word checks; bcrypt via pgcrypto |
| `sr_login(handle, pin)` | Returns the stored save so progress follows a kid to any computer |
| `sr_submit(handle, pin, …match…, save)` | Records one finished trial and updates the totals |
| `sr_save(handle, pin, save)` | Pushes progress up without finishing a trial (after shopping) |
| `sr_board(club, limit)` | Public ranking. Never returns a PIN hash |
| `sr_recent(club, limit)` | A live "just now" feed of finished trials |

An internal `sr_auth` helper does PIN verification and lockout, and is explicitly
revoked from `anon`. It returns a status string rather than raising, because a
raised exception in Postgres rolls back the transaction — including the
failed-attempt counter that the lockout depends on.

**Anti-cheat.** The game is client-side JavaScript, so a kid with DevTools can
edit their own numbers, and that is not fixable in a game of this shape. What the
database does instead:

- clips the physically impossible (kills can never exceed the lobby size);
- rate-limits: 25 trials an hour, and you cannot claim more minutes of play in an
  hour than an hour contains;
- makes it visible — the board shows each player's trial count beside their kills,
  and every submission leaves an audited row in `matches`.

**A rule that was written and then deliberately removed:** "the trial must be
long enough for the kills claimed to be possible". It sounded obviously correct
and then rejected a real 5-kill run during testing, which is exactly the run a
kid wants on the board. Rate limits can never do that to an honest match, so the
per-match rule went and the rate limits stayed. Refusing a real achievement is a
much worse failure than letting an inflated one through where everyone can see it.

**Conflict rule.** On sign-in and at boot, whichever save has played more matches
wins. A fresh registration always keeps whatever is already on the computer.
Resetting progress signs out first, so an empty save is never pushed upward.

Setup, deployment (GitHub Pages) and the club-running SQL live in `ONLINE-SETUP.md`.

---

## 11. Cosmetics

Purely visual, all visible in third person and in the menu scene.

- **Hair (7):** Recruit Crop (0), Blaze Spikes (280), Iron Braids (420), Neon Mohawk (520), Raider Helm (900), Voidflame Crown (2,600), Molten Crown (5,000)
- **Outfits (8):** Recruit Fatigues (0) → Reaper's Kit (6,400)
- **Accessories (7):** None (0), Combat Shades (220), Field Headset (340), Tattered Cape (550), Scrap Jetpack (1,500), Soulfire Halo (2,800), Ashen Wings (4,200)

Capes flare when sprinting, wings spread on jump, the halo spins faster the more kills you have.

---

## 12. UI

**Screens:** Title → Match Setup → Armory → How to Play, plus in-match Pause and Results overlays.

**Title** follows the layout convention this genre settled on years ago (Krunker, Shell Shockers,
Brawl Stars) rather than inventing one:

- **Profile card pinned top-left** — level badge, fighter name, rank, XP bar and lifetime record.
  Always visible, one glance, no reading. Clicking it opens the account screen.
- **Coins top-right.**
- **Standings rail on the left** — top five, then a `···` break, then *your* row wherever you
  actually sit, with a footer reading `YOU ARE #7 OF 24`. Clicking opens the full board.
- **Daily challenges rail on the right**, compact, with progress on each.
- **Centre column**: wordmark, then Deploy / Armory / Match setup / How to play.

Below 1080px the two rails drop under the centre column and the profile card rejoins the flow.

The title screen also paints a radial scrim over the 3D scene behind it. Menu text over a lit,
moving arena was the single biggest readability complaint, and no amount of colour tuning fixes
contrast against a background that changes every frame.

**The training range is no longer a main-menu button.** It lives under Match setup → Mode. A first
time player should press Deploy and be in a fight; the range matters to the kid who wants to feel
the Obsidian Reaper before saving fifteen thousand coins for it, and that kid will go looking.

**Match Setup** mirrors the reference screenshot's information architecture but is restructured as a two-column card grid with chip selectors instead of one long list: Arena, Opponents (1–7), Opponent Skill, Time Limit, Mouse Sensitivity, Field of View, Camera, Sound, Nametags, plus a live loadout summary.

**Armory** is a left tab rail (Weapons / Hair / Outfits / Accessories / Pets / Food / Arenas), a card grid, and a right-hand preview pane with a rotating 3D model and a stat readout.

**In-match HUD:** minimap top-left with arena name and legend; alive count, clock and kill count top-centre;
kill feed upper-right; health bar with gold absorption overlay bottom-left with the food strip beneath it;
pet bar with health and revive timer; weapon name, ammo and slot chips bottom-right; dynamic crosshair that
opens with the *real* spread including bloom and the hip-fire penalty; hit markers, floating damage numbers,
scope overlay, damage vignette.

New in 0.5:

- **Heat bar** under the ammo counter, cyan → gold → red, shown only for heat weapons. The ammo readout
  becomes `n% COILS` instead of a magazine count.
- **Charge bar** under the crosshair while a charged weapon is winding up.
- **Status line** above the weapon name, which reports `▬ PLANTED — SPREAD LOCKED`, `OVERHEATED — n.n s`,
  `CHARGING…`, `LOADING SHELLS…`, `LAST MAGAZINE` or `OUT OF AMMO — PRESS 1 / 2 / 3`. Every new
  mechanic announces itself here rather than hiding in a spec.
- **Multi-kill banner** centred at 23% height with a scale-pop animation.
- Slot 3 is always the equipped melee weapon, and an empty slot 2 renders greyed rather than collapsing,
  so `SLOT 3` in the armory always means the 3 key in a match.

**Armory purchasing rule** (unchanged): the buy button lives **only on the card**, never in the preview pane.
Melee weapons show a single `Slot 3` button; firearms show `Slot 1` / `Slot 2`. Every weapon card now carries a
green ▲ role line, a red ▼ limitation line and its mastery progress.

---

## 13. Art direction

Minecraft-Dungeons arcade cabinet. Obsidian and void palette with beveled "block" edges as the signature device.

```
--void  #0d0a14    --stone #1b1626    --slate #2c2439    --edge  #3d3352
--gold  #f2b134    --ember #e0553a    --ench  #a97bff    --leaf  #7fd45b
--bone  #ece3d2    --dim   #8e849e
```

Display type is **Anton**, loaded from Google Fonts with `font-display:swap`, falling back to
Impact and the Haettenschweiler / Arial Narrow family. Data is Courier New (with Cousine and
DejaVu Sans Mono behind it), body is Verdana (DejaVu Sans, Arimo).

The webfont exists for one reason: the target device is a school Chromebook, and ChromeOS ships
Arimo, Tinos, Cousine, Roboto and Noto — none of Impact, Haettenschweiler, Arial Narrow or Oswald.
The display stack was falling all the way through to generic `sans-serif`, so every heading, the
wordmark, the ammo counter and the kill banners rendered in plain Roboto and the arcade-poster
identity disappeared on exactly the machines the game was built for. Anton is a single-weight face,
so headings are pinned to `font-weight:400` with `font-synthesis-weight:none` rather than letting
the browser smear a fake bold over it.

**Text colour scale.** Three steps, all of which clear WCAG AA against the panel background:
`--bone #ece3d2` for primary, `--text2 #b9afc6` (9.5:1) for secondary reading copy, `--dim #8e849e`
(5.6:1) for labels and captions. A fourth value, `#6b6280`, used to carry most of the helper text at
9–10px and measured **3.1–3.5:1**; it is gone. Nothing in the UI now renders below 10px. Every panel carries the `.blk` bevel (inset light top-left, dark bottom-right). Mythic and legendary shop cards get an "enchantment glint" sweep. A soft CRT scanline overlay sits over everything at 12% opacity.

**Shared model format.** Characters, weapons, and pets are all declared as arrays of box specs `{w, h, d, x, y, z, c, e}` with forward = −z. The same data drives both the Three.js meshes and the 2D canvas shop icons, so an item can never look different in the shop than it does in the arena.

---

## 14. Technical architecture

**Single self-contained HTML file.** No build step, no bundler, no assets. Three.js r128 from cdnjs is the only external dependency; if it fails to load the player gets a clear message instead of a hung loading screen.

**Saving.** Three tiers under the key `sr_save_v1`, tried in order: a host-provided `window.storage`
bridge if one exists, then the browser's own `localStorage`, then memory.

Until 0.5 only the first and third existed, and since `window.storage` is undefined in an ordinary browser,
**every coin, rank and challenge was wiped by a page refresh.** That single line was worth more to retention
than any content in this document. `loadState` also migrates old saves: a melee weapon or an unowned gun sitting
in slot 1 is corrected, `eq.melee` is defaulted, and the new `xp` / `mastery` / `daily` / `log` fields are seeded.

A **Reset progress** button on the How to Play screen wipes the save behind a two-press confirm, for a
shared family laptop.

**Audio is fully synthesised** via WebAudio — no files. Each weapon has its own timbre (`pop`, `tick`, `crack`, `boom`, `brr`, `thump`, `launch`, `zap`, `reap`, `slash`), plus hit, kill, explode, reload, footstep, eat, UI, hurt, win and lose sounds.

### File map

| Lines | Section |
| --- | --- |
| 1–444 | HTML head, full CSS design system, HUD markup, all screens |
| 446–867 | Data tables — `WEAPONS`, ranks, mastery, medals, challenges, `FOODS`, cosmetics, `PETS`, `ARENAS`, `SKILLS` |
| 869–924 | State object `S`, three-tier save/load, `wipeSave` |
| 926–942 | Utilities |
| 944–1012 | `AU` — synthesised audio engine |
| 1014–1137 | 2D icon painters |
| 1139–1257 | Three.js core — material cache, `boxMesh`, `buildGun` (+ mastery charms), `buildCharacter`, `buildPet` |
| 1259–1435 | `makeWorld` — procedural arena construction, `makeFX` weather |
| 1437–1466 | Match runtime globals, tracer pool, collision |
| 1468–1908 | Effects engine — particles, rings, beams, bolts, `fxSmash`, `fxRake`, `fxLeechMotes`, `fxCharge`, `shotFx` |
| 1910–2282 | Combat — `falloff`, `effSpread`, `isBehind`, `weaponTick`, `fire`, reload, projectiles, `explode`, `damage`, `kill`, `banner` |
| 2284–2386 | Player update — heat, charge, bloom, bipod timer, mode handling |
| 2388–2473 | Bot AI |
| 2475–2548 | Pet AI, health, revive |
| 2550–2647 | Camera and model animation, melee swing, charge wobble |
| 2649–2747 | HUD and minimap — heat bar, charge bar, status line |
| 2749–2921 | Main loop, `respawnDummy`, `trainCycle`, `endMatch`, payout, medals, XP, `challengeUpdate` |
| 2923–3000 | Input and pointer lock |
| 3002–3065 | Menu scene and armory preview renderer |
| 3067–3414 | Screens, rank chip, daily panel, shop rendering, purchase flow |
| 3416–end | Match flow, UI wiring, boot |

Line numbers drift with every edit; they are a map, not a contract.

### Key data structures

```js
S = {                          // persisted save
  coins, own:{weapons,hair,outfit,acc,pet,arena},
  eq:{primary,secondary,melee,hair,outfit,acc,pet},
  food:{id:count},
  cfg:{arena,bots,skill,time,sens,fov,sound,nametags,cam,mode},
  stats:{matches,wins,kills,best,cleared[],streak,bestStreak,medals{}},
  xp,                          // rank progress, never spendable
  mastery:{weaponId:kills},
  daily:{day,ids[],prog{},done{},firstWin},
  log:[{d,a,k,w,c}]            // last 12 matches
}

G = {                          // per-match runtime, discarded on quit
  on, over, paused, training, t, left, grace, yaw, pitch, cam, camD,
  ents[], pl, pet, world, fx, fxp[], tracers[], projs[],
  kills, hs, dmgDone, lastDamageT, plight, shake, recoil, swing,
  wepKills{}, meleeKills, bigKills, mk, lastKillT, bestStreak,
  streakCoins, lowHp, ate
}

// per-entity weapon state, on both the player and every bot
e = { ..., ammo, res, reloadT, fireT,
      heat, heatLock, bloom, stillT, stunT, burstLeft, chargeT, lastShotT }
```

---

## 15. Balance philosophy

Five rules govern every number in this game.

1. **Nothing you buy may be a downgrade.** A 2,600-coin LMG must beat a free pistol in at least one clearly
   defined situation, and that situation must be *stated on the card*. This is the rule most likely to be
   violated by accident, and the one worth testing hardest.
2. **Nothing you buy may be a win button.** The inverse of rule 1, and the one 0.4 got wrong. If owning an
   item removes the reason to play, the item is broken no matter what it costs. The Reaper's three shots,
   charge time and visible glow all exist to serve this rule.
3. **Every strength is paid for by a named weakness.** Range is paid for with falloff, damage with magazine
   size, accuracy with a bipod that demands you stand still, infinite ammo with overheating. If you cannot
   write the drawback in one short sentence for the shop card, the weapon is not designed yet.
4. **Passive systems never out-perform the player.** Pets change how a fight goes, they do not win it.
   Pet DPS is capped at 14.7 and pets can be killed. Mastery is cosmetic — no tier has ever added damage,
   and none ever should, because progression that makes you stronger makes the game easier over time,
   which is backwards.
5. **Overkill is not damage.** Payouts count only damage actually removed from a fighter. A previous build
   let the Obsidian Reaper bank 99,999 damage per shot and pay out 20,000 coins a match.

---

## 16. Testing

Verification is now done **in a real browser against the real running game**, which is a change from 0.4
(where nothing had ever been opened in a browser at all).

```bash
python3 -m http.server 8123
# open http://localhost:8123/index.html
```

`balance-sim.js` drives a simulated player inside the live page. Paste this into the console:

```js
fetch('/balance-sim.js').then(r => r.text()).then(t => eval(t))
sweep(['ak47','smg','sniper'], 10)                    // 10 matches each
simMatch('bazooka', 'sidearm', 'claws', 'regular', 7) // one match, full detail
```

The simulated player tracks with a smoothed lag, has a distance-scaled error cone, takes a
re-acquire delay when its target changes, walks to a range that suits the gun it is holding,
aims down sights at distance, aims splash weapons at the feet, swaps to melee inside four metres,
reloads out of contact, and eats when hurt.

**What the harness is good at:** catching runtime errors across every weapon, pet and arena; spotting a
weapon doing almost nothing; rough cost-vs-power ordering.

**What it is bad at, and this matters when reading §4.4:** it never panics, never gets flanked on purpose,
never deliberately ambushes, and its slot 1 / slot 2 choice is cruder than a person's. That flatters precise
semi-autos (hence the M9's 100%) and punishes the Scattergun and melee, whose real strength is positional.
Ten matches is roughly ±15% noise. Treat every number as directional.

### Verification performed for 0.5

| Test | Result |
| --- | --- |
| JavaScript syntax (`node --check` on the extracted script) | Pass |
| Real browser boot, Three.js load, title screen render | Pass |
| All 14 weapons fired 50× each with random aim, ADS toggled | Pass, 0 errors |
| All 10 arenas build and run in-browser | Pass, 0 errors |
| All 7 pets run a full match | Pass, 0 errors |
| All 7 shop tabs render; setup, help and title screens render | Pass, 0 errors |
| ~200 simulated full matches across the roster | Pass, 0 errors |
| Particle pool under sustained fire | Capped at 461 against a 460 target, zero leaked |
| Save round-trip through `localStorage` across a page reload | Pass — coins, XP, rank, mastery, ownership, dailies all restored |
| Legacy 0.4 save migration (knife in slot 1, no `eq.melee`) | Pass — corrected to a valid loadout, old stats preserved |
| Results screen: medals, daily completion, mastery tier-up, rank-up, XP bar | Pass, verified visually |
| Training range: no damage taken, infinite ammo, dummy respawn, T cycling | Pass, verified visually |
| Pointer lock (mouse capture) | **Not verified** — the automated browser refuses `requestPointerLock`. A `pointerlockerror` handler now explains the failure to the player instead of leaving them unable to aim. Confirm by hand in desktop Chrome. |

---

## 17. Out of scope for this version

- Multiplayer or networking of any kind. All opponents are bots.
- Mobile or touch controls.
- Weapon skins or attachments. (Weapon *mastery charms* exist; a full skin system does not.)
- Per-handle local saves, so two kids sharing one laptop stop overwriting each other's local copy (their server copies are already separate).
- Game modes other than free-for-all last-man-standing and the training range.
- Bot pets and bot cosmetics.
- Per-arena music.
