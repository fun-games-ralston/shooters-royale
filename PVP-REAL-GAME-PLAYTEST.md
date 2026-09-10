# Block Royale friends PvP

This is the default friends mode: a two-player, host-authoritative Block Royale match that reuses the solo game's content.

## Entry points and safety boundary

- Player route: `pvp-real/`
- The former `pvp-test/` tank lab is retired and redirects to `pvp-real/`, preserving invite hashes.
- The solo game runs from `index.html`; control-readiness, draw rules, copy, and readability fixes are separate from the PvP simulation.
- PvP reads `sr_save_v1` to carry the player's equipped weapons, companion, and appearance. It never writes coins, XP, inventory, mastery, challenges, or solo progress.

## Shared with the solo game

- All 10 arenas and their movement rules, lava, void falls, and timed hazards
- All 14 weapons, three-slot loadouts, damage models, ammo, reloads, and signature mechanics
- All 7 companions, targeting behavior, damage, passive perks, downing, and revival
- Saved hair, outfit, and accessory appearance

`scripts/sync-pve-content.js` extracts the content tables from `index.html` without evaluating the game and generates `shared/pve-content.generated.js`. `shared/world.js` is the deterministic world builder consumed by PvP. The solo game does not import either file, so this adapter cannot change existing PvE behavior.

Food, bots, rewards, progression, matchmaking, reconnects, host migration, spectators, anti-cheat, and ranked results remain outside this release. Rooms are public-but-unlisted and protected only by a random code; that is appropriate for this friends playtest, not for ranked identity or private access control.

## Timed rounds and rematches

- Three minutes, unlimited respawns after three seconds. Most kills wins; equal scores draw.
- Respawns refill health/ammo and clear status effects. Brief protection ends on firing. Spawns favor distance from the opponent and avoid blocked positions and lava where possible.
- Setup shows saved equipment instead of weapon/pet selectors. Empty secondary slots remain empty. No additional weapons are granted.
- Invite links prefill the room and show only the join form. Manual join accepts a code or a complete invite URL.
- Both players choose Play again to restart in the same room, on the same arena, with the same equipment. Session win/draw counts persist until leaving.
- Ready messages, input, snapshots, and result acknowledgements are scoped to a round identity. Delayed messages cannot affect a subsequent round. Old clients fail the match-version check.
- Connection details are collapsed; the score, timer, health, and ammo stay prominent.

## Authority and timing

The host is the ground truth for positions, weapon state, projectiles, pets, hazards, damage, death, and the winner. Guests predict their own movement, reconcile against host snapshots, interpolate remote fighters, and receive up to 200 ms of rewind compensation for hitscan shots.

| Layer | Rate |
| --- | ---: |
| Host simulation | 30 Hz |
| Guest input | 20 Hz |
| Host snapshots | 15 Hz |
| Display rendering | browser refresh rate |
| Hitscan rewind cap | 200 ms |

For two players, modeled active traffic is about 80 Supabase Realtime deliveries per second after fan-out. Four players at the same responsiveness model at about 180 deliveries per second and remain intentionally disabled.

## Verification

```bash
node --check pvp-real/app.js
node --check pvp-real/e2e-peer.js
node --check pvp-real/sim.js
node --test pvp-real/*.test.js scripts/*.test.js
node scripts/sync-pve-content.js --check
git diff --check
```

`pvp-real/e2e-peer.js` is a separate-process test peer. Install pinned `@supabase/supabase-js@2.91.1` in a temporary runtime and expose only that temporary `node_modules` through `NODE_PATH`.

Browser acceptance requires both host directions with separate Supabase clients and peer IDs. The guest must move without snap-back, the host alone must apply weapon/pet/hazard damage, both clients must agree on `winnerId` and `roundEndSeq`, the guest must acknowledge the result, counters must stop after game over, and the browser error log must stay empty.

## September 9 verification

The automated suite covers timed scoring, draw results, repeated respawns, protection, full ammo/health resets, old-round input rejection, client reconciliation across lives, all ten arenas, scoped readiness/acks, and solo control/draw regressions. Browser acceptance also checks invite entry, the saved empty slot, synchronized timer/results, and same-room rematches. The separate-process peer accepts an optional round duration in milliseconds as its sixth argument for accelerated testing; the browser host always uses three minutes.

Live transport acceptance used two browser clients and a separate Node host: both clients completed full-length draws and rematched in the same room; guest movement and weapon damage synchronized; a host-side elimination fixture produced a respawn at 200 HP with 12/72 ammo, and the timed result retained the kill. Browser error logs were empty. This is not a physical two-network latency test. The test peer's `test_eliminate` command is a simulation fixture, not a player-facing capability.
