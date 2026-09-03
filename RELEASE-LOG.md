# Block Royale — Release Log

**Developer:** Ethan
**Play:** https://fun-games-ralston.github.io/shooters-royale/

Newest first. Each entry is one change: a feature that made the game better, or a problem that got solved.

---

## 2.1 — 2 Sep 2026

* New: Friends PvP is now the one supported multiplayer test. Two players can share a room link and fight with the same ten maps, fourteen weapons, seven companions, hazards and saved appearance as the solo game.
* Fixed: guest movement is predicted locally and reconciled to host-authoritative snapshots without the old snap-back loop. The host remains ground truth for bullets, rockets, pets, hazards, HP, elimination and the winner.
* Fixed: game over is broadcast and acknowledged by both players, then movement, shooting and network counters stop. The retired top-down tank lab now redirects to Friends PvP.
* Safe boundary: solo `index.html` is unchanged. PvP reads appearance only and cannot write coins, XP, inventory, mastery or solo progress.

## 2.0 — 24 Aug 2026

* New: the four signature weapons now build an effect instead of flashing once. Longshot Rail fires a white-hot layered beam through moving cyan pulse rings; Tesla Arc leaves readable forked lightning and chain halos; Bazooka rockets drag a plasma wake into a shock-sphere blast; Obsidian Reaper gathers a spiral charge and tears open a purple soul vortex.
* Changed: ordinary gunfire stays restrained so these weapons remain special. All added effects use the same capped particle pool, so a busy fight cannot keep spawning visual debris forever.

## 1.9 — 24 Aug 2026

* Fixed: fighters killed during a jump, fall or knockback froze sideways in mid-air. Corpses now fall onto the floor or platform below; bodies that fall into the void disappear.

## 1.8 — 23 Aug 2026

* Fixed: the Change buttons on Your Fighter looked like purchases and did not change anything — they were gold, the colour used for buying, and all they did was open a tab the left rail already lists.
* Changed: Your Fighter is now a full-width look at yourself rather than a grid of cards. Tap any item in the list beside you to go and change it.
* New: tap Slot 1, 2 or 3 on Your Fighter to see that weapon in your hands. An empty slot shows you unarmed; tapping the weapon name still takes you to change it.
* Changed: weapon cards are shorter and easier to compare. They keep damage, firing and ammo, range, one strength, one drawback and mastery; tap one for the complete breakdown. On a narrow screen, details open in a drawer instead of disappearing.
* Fixed: pets no longer circle your feet or choose enemies through walls. They follow in a camera-safe formation, pursue visible targets, remember them briefly and recover when stuck. The T-Rex follows farther behind and fades if it crosses the camera.
* Fixed: enemies can now actually see, target and shoot pets. The old fake damage charged on every bite is gone; pet and poison kills count for the match without being credited to the weapon in your hands.
* Changed: every pet now has a distinct combat role, and Pet cards show it in green beside a purple special-skill callout. Tap a card for the full behavior and counterplay.
* Changed: Match Setup listed your loadout a third time. One line now, turning red when you have no food.

## 1.7 — 23 Aug 2026

* Changed: the game is called **Block Royale**. "Shooter's" was the first word anyone saw, including parents and teachers, and it described the least interesting thing about the game.
* The link, your save and the leaderboard are all unchanged — nothing was lost in the rename.

## 1.6 — 23 Aug 2026

* Fixed: the fighter preview showed the back of your head. Every preview now opens facing you, with weapons side-on instead of pointing down the lens.
* Fixed: the Sandpit sinkhole was invisible — sand-coloured debris on a sand floor. It was firing fifteen times a match and hurting people the whole time, and now opens a dark pit.
* Fixed: you almost never met a hazard, because they picked a target evenly among everyone alive. Half now land near you instead of one in eight.
* Fixed: nothing told you a map was dangerous. Hazards are now listed on the arena card, in the preview, on the setup chip, and named a second after you land.
* New: Atrium and Neon Bazaar have hazards — falling glass and a power surge. They were the only paid arenas with nothing at all.
* Fixed: Bone Temple's spikes were labelled "Ice spikes".

## 1.5 — 23 Aug 2026

* Changed: matches are 3 minutes, adjustable 1–6. They were 6 by default and could run to 15.
* New: Your Fighter. The Armory's first tab shows your character holding your actual weapon, with one card per slot and a button straight to where you change it.
* Removed: the field-of-view slider. Anyone who set it to 130° could see round corners other players could not.
* Fixed: Match Setup repeated itself. The footer restated the arena, opponents, skill and time — all buttons a few centimetres above it.

## 1.4 — 23 Aug 2026

* New: the end of a match is something you watch. The world runs on in slow motion, the camera lifts off your body, and a card names what killed you — space skips it.
* New: five maps fight back — meteors, ice spikes, sinkholes, bone spikes and void rifts, 22–38 damage. Each is telegraphed with an orange ring for over a second, and bots get hit too.
* New: maps look like places. Every arena was boxes on boxes; there are now rocks, trees, crystals and rivers, different per map.
* Fixed: the victory card read "4 KILLs".

## 1.3 — 23 Aug 2026

* New: the leaderboard ranks by the hardest difficulty you have beaten, then by wins at that level. Grinding the easiest setting no longer moves you up — a test player with 530 Rookie wins still sits below three Veteran wins.

## 1.2 — 23 Aug 2026

* Fixed: a Nightmare lobby was seven bots carrying the three slowest guns in the game, so nothing ever closed the distance. Bots now get a role — rusher, mid, marksman, heavy — and difficulty sets how good their weapon is.
* Fixed: Rookie lobbies were being handed Regular's weapons, Miniguns included.
* Fixed: bots could never carry the Tesla Arc at any difficulty.
* New: harder opponents pay more, on kills and fighters outlasted — the two things you cannot fake by dying on purpose.

## 1.1 — 23 Aug 2026

* Fixed: winning without doing anything paid full XP. If the bots wiped each other out and you survived, you earned the same as someone who carried the match.
* Fixed: difficulty only changed how straight bots shot. A Nightmare bot chased, dodged and healed exactly like a Rookie one; now five things change, including whether they hunt you or each other.
* Fixed: bots tracked you through walls at every difficulty. A Rookie now loses you almost immediately.
* Balance: win rates across the five settings are 92 / 75 / 50 / 33 / 8 per cent. The first attempt made Nightmare unwinnable, so the top two were pulled back.

## 1.0 — 23 Aug 2026

* Changed: your settings no longer change your pay. Opponent skill and lobby size swung earnings sevenfold, so two kids could play the same match for wildly different money.
* Changed: winning while hiding pays less. Three kills unlocks the full win bonus, and losing with two kills now pays nearly as much as winning passively.
* Changed: starting coins cut from 1,500 to 250. The old balance unlocked 26 items before you had fired a shot; 250 is less than every weapon in the shop.
* Balance: a typical win pays about 750, roughly one cheap weapon. Owning every gun takes about 60 matches instead of 26.
* Changed: opponents do not get harder as you level up. That would punish you for improving and push good players down the leaderboard.
* Fixed: the payout screen showed the wrong numbers — its lines did not add up to the total underneath them.

## 0.9 — 23 Aug 2026

* Balance: coins cut across the board. A single match was paying more than the entire starting balance, so nothing ever felt earned.
* Balance: medals were firing three a match for ordinary play and quietly paying a quarter of the purse. Halved, with two made harder.

## 0.8 — 23 Aug 2026

* Fixed: the fonts would have broken on school Chromebooks. The title, headings, ammo counter and kill banners would all have rendered in plain Roboto on exactly the machines this game is for.
* Fixed: small text was too faint to read — most of it scored 3.1 against a 4.5 minimum. New colours, nothing under 10px, and all six screens now pass.
* Fixed: the profile card sat stranded in a corner with a large dead gap above the menu. The layout is one balanced block now.

## 0.7 — 23 Aug 2026

* New: a proper main menu. Profile card top-left with your level and XP, the leaderboard always visible showing the top five and your position, daily challenges on the right.
* Fixed: everything below the Deploy button was hard to read over the moving arena behind it. The background is dimmed behind the menu now.
* Changed: the training range moved out of the main menu into Match Setup. A first-time player should press Deploy and be in a fight.

## 0.6 — 23 Aug 2026

* New: the club. Pick a fighter name and a 4-digit PIN and your scores join a shared leaderboard, with your coins, unlocks and mastery following you to any computer.
* New: no email, no real names, no ages — nothing stored can identify a child. That is also why there is no "forgot my PIN" link.
* New: anti-cheat. Impossible numbers are clipped, and you cannot claim more minutes of play in an hour than an hour contains.
* New: everything still works offline. No wifi, blocked school network, or no leaderboard at all — the game plays and saves normally.

## 0.5 — 23 Aug 2026

* Fixed: the game never saved anything. Every coin, unlock and statistic was wiped by a page refresh.
* Fixed: the Bazooka had never worked. Every rocket exploded a metre or two from your own face — six fired, six hitting the shooter and nobody else.
* Fixed: the Obsidian Reaper ended the game. Buying it left nothing to want, so it is now three shots a match, each needing a second of charging while glowing purple where everyone can see you.
* New: 14 weapons, each behaving differently — damage that fades with distance, spray that climbs, burst fire, a heat bar instead of a magazine, a bipod, a charge-up, shell-by-shell reloading, backstabs, lifesteal, knockback.
* New: three melee weapons — the knife, a bat that punts people off ledges, and claws that heal you 15 HP a hit. Slot 3 is always melee, so an empty magazine is never the end.
* Changed: magazines are smaller and spare ammo is finite. The AK-47 went from 30 rounds to 20.
* New: daily challenges. Three a day, the same three for everyone, reset each morning.
* New: your first win each day pays double.
* New: ranks. Ten of them, earned on XP that cannot be spent, so they still mean something once you own everything.
* New: weapon mastery. Every gun counts its own kills and earns charms on the barrel — decoration only, so it never makes the game easier.
* New: multi-kill banners. Two kills in five seconds chains into DOUBLE KILL and upward, with a bonus.
* New: match medals — Sharpshooter, Executioner, Clutch and more — so a losing match can still go somewhere.
* New: the training range. Nothing hurts you, ammo never runs out, and you can test-fire every weapon in the game before saving up for it.

## 0.4 — 23 Aug 2026

* Fixed: shop cards were cut in half — weapon cards showed an icon and a name with no stats and no buy button. Everything is visible now.
* Fixed: two places to buy things. The duplicate buy button in the preview pane is gone — purchasing lives only on the card, and every card footer looks the same.
* Fixed: a 20,000-coin exploit. Payouts counted the Reaper's 99,999 overkill as real damage, so only damage actually taken off a fighter pays out now.
* New: pets can be killed, so they are no longer free permanent damage. They take return fire when they bite and stay down 18 seconds, perk included.
* Balance: the Minigun did double the damage of the Tesla Arc at half the price. Cut by a third, so the price ladder means something again.
* Balance: the Tesla Arc cost 8,600 coins for less range and damage than a 1,500-coin rifle. More of both now.
* Fixed: Bazooka killed its owner. Own-rocket splash cut to 35%, so rocket-jumping works without being suicide.
* Fixed: arena prices were scrambled — Neon Bazaar cost less than Skyport, Bone Temple more than Void Nexus. The unlock ladder rises properly again.
* New: itemised payout screen. Results now break down exactly where every coin came from, including a win-streak bonus and a first-win-per-arena bounty.
* Fixed: toast messages were landing on top of the ARMORY header. Moved to the bottom of the screen.

## 0.3 — 22 Aug 2026

* Fixed: your fighter never turned in third person. The body stayed frozen at its spawn angle while the camera orbited it, so you always saw yourself from the side.
* Fixed: in third person your shots came from four metres behind you, at the camera. They now leave your barrel and hit what the crosshair is on.
* New: every weapon has its own effect. Rail laser beams, forked lightning, rocket trails and fireballs, void beams, buckshot cones, brass casings, a spinning blade arc for the knife.
* New: kills explode into blocky debris tinted by whatever killed you, and headshots pop a red ring.
* New: muzzle flashes light the arena. A pooled point light fires on every shot and explosion.
* Fixed: buy buttons were tiny and easy to miss. Now full-width gold with the price inside, and they turn red with a "you need X more" tooltip when you can't afford it.
* Fixed: long guns drew outside their shop icons, and hair icons rendered completely off-canvas.
* Fixed: the minimap arrow pointed backwards, so the map showed you facing the opposite way to the one you were.

## 0.2 — 22 Aug 2026

* New: POWER rating on every weapon. A 1–10 bar that rises with price, so the shop ladder is legible at a glance.
* Fixed: you died in under 5 seconds, because all 7 bots dogpiled you with near-perfect aim. They now prefer fighting each other, react slower, and burst-fire instead of holding the trigger.
* New: 3.2-second grace period at match start so nobody gets shot before they've found cover.
* Fixed: guns pointed backwards out of the character's hand.
* Fixed: graceful failure if the 3D engine can't load, instead of a hung loading screen.

## 0.1 — 22 Aug 2026

* Initial playable build. One life, 200 HP, last one standing across 10 procedural arenas with cover, upper decks and stairs.
* 11 weapons from a free pistol to the 15,000-coin Obsidian Reaper that kills on any hit.
* 7 pets that follow, fight and grant a passive perk — dog, cat, snake, wolf, bear, raptor, T-Rex.
* Coin economy and armory with weapons, hair, outfits, accessories, pets, food and arena unlocks, all with 3D previews.
* Food-based healing. Health never regenerates on its own; you buy it beforehand and eat mid-fight.
* Bot AI across 5 skill tiers plus Mixed, with headshot/torso/leg damage zones.
* Fully synthesised audio — every weapon has its own timbre, no asset files.
