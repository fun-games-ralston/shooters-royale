# Real-game PvP vertical slice

This feature-branch slice tests whether the actual Block Royale movement and combat model can support a two-player friends match before it is coupled back into the solo game.

## Entry point

- Browser route: `pvp-real/`
- Netcode lab entry: `pvp-test/` → **Play the real 3D Foundry beta**
- Branch: `pvp-realtime-spike`

The existing `index.html` solo game is unchanged.

## Included

- Two-player room creation, invite link, presence roster, and host start
- Deterministic Foundry geometry derived from the production arena
- First-person Three.js presentation and block fighters
- WASD movement, sprint, jump, world collision, mouse aim, reload, and weapon switching
- M9 Sidearm, AK-47, Scattergun, and Bazooka
- Host-authoritative positions, ammo, projectiles, damage, HP, death, and winner
- 200 ms maximum lag-compensation rewind for hitscan weapons
- Client prediction/reconciliation and 100 ms remote interpolation buffer
- Combat events bundled into 15 Hz snapshots
- Reliable round-result acknowledgement and traffic shutdown after game over
- Browser-visible role, RTT, message counts, observed message rate, HP, ammo, logs, and result state

## Deliberately excluded

- Bots, pets, food, hazards, coins, XP, inventory writes, and progression
- Four-player matches
- Reconnect or host migration
- Matchmaking, spectator mode, rematches, anti-cheat, and ranked results
- Supabase Auth and private-channel authorization

The current rooms are public-but-unlisted and rely on a random room code. That is acceptable for this friends-only playtest, not for production identity or access control.

## Timing and traffic budget

| Layer | Rate |
|---|---:|
| Host simulation | 30 Hz |
| Guest input | 20 Hz |
| Host snapshots | 15 Hz |
| Display rendering | browser refresh rate |
| Hitscan rewind cap | 200 ms |

For two players, the modeled project traffic is approximately 70 Supabase Realtime events per second after fan-out. The UI warns above 85 observed local send/receive events per second. Four players are still deferred because the current 20/15 Hz design models at approximately 180 events per second.

## Verification commands

```bash
node --check pvp-real/sim.js
node --check pvp-real/app.js
node --check pvp-real/e2e-peer.js
node --test pvp-real/sim.test.js pvp-netcode.test.js pvp-realtime.test.js
node pvp-latency-sim.js
node pvp-real-game-capacity.js
git diff --check
```

`pvp-real/e2e-peer.js` is a separate-process playtest peer. Install the pinned `@supabase/supabase-js@2.91.1` in a temporary runtime and expose that temporary `node_modules` through `NODE_PATH`; it is not a production dependency.

## Browser acceptance gates

Run both directions with distinct peer IDs and separate Supabase connections:

1. Browser host + independent Node guest.
2. Independent Node host + browser guest.
3. Confirm lobby roster and input-channel readiness before starting.
4. Move a guest and verify its authoritative snapshot changes without snap-back.
5. Fire hitscan and Bazooka weapons and verify the host alone changes HP.
6. Eliminate one fighter and verify both peers show the same winner and `roundEndSeq`.
7. Verify the guest acknowledges the result and the host stops final-state retries.
8. Wait at least four seconds and verify send/receive counters remain unchanged.
9. Verify the browser console has no application errors.

Do not describe the slice as production-ready until the same gates pass against an online feature-branch URL on two physical devices.
