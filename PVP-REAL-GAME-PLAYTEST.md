# Block Royale friends PvP

This is the default friends mode: a two-player, host-authoritative Block Royale duel that reuses the solo game's content without changing the live solo runtime.

## Entry points and safety boundary

- Player route: `pvp-real/`
- The former `pvp-test/` tank lab is retired and redirects to `pvp-real/`, preserving invite hashes.
- The solo game still runs from the unchanged `index.html`.
- PvP may read `sr_save_v1` to show the player's saved appearance. It never writes coins, XP, inventory, mastery, challenges, or solo progress.

## Shared with the solo game

- All 10 arenas and their movement rules, lava, void falls, and timed hazards
- All 14 weapons, three-slot loadouts, damage models, ammo, reloads, and signature mechanics
- All 7 companions, targeting behavior, damage, passive perks, downing, and revival
- Saved hair, outfit, and accessory appearance

`scripts/sync-pve-content.js` extracts the content tables from `index.html` without evaluating the game and generates `shared/pve-content.generated.js`. `shared/world.js` is the deterministic world builder consumed by PvP. The solo game does not import either file, so this adapter cannot change existing PvE behavior.

Food, bots, rewards, progression, matchmaking, reconnects, host migration, spectators, rematches, anti-cheat, and ranked results remain outside this release. Rooms are public-but-unlisted and protected only by a random code; that is appropriate for this friends playtest, not for ranked identity or private access control.

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
