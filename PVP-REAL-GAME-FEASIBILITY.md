# Real-game PvP feasibility

Status: **feasible after a simulation refactor, not a drop-in replacement for bots**.

The current PvP lab proves room lifecycle, host authority, client prediction,
interpolation, rewind hit detection, and reliable round completion. It does not
prove the production Three.js game, because that game currently combines
simulation, rendering, audio, effects, UI, progression, and bot/pet AI inside the
same browser functions.

Examples:

- `fire()` both creates audiovisual effects and changes authoritative damage;
- `damage()` also updates HUD, stats, pets, kill feeds, and match results;
- `tick()` directly advances players, bots, pets, hazards, rockets, effects, and
  the camera every render frame;
- pets and bots reference the local `G.pl` object rather than an owner or player ID.

Replacing bots with remote character models would look multiplayer, but each
browser would still disagree about collisions, rockets, damage, pet targets,
food, hazards, and the winner. The first product step is a pure host simulation
boundary shared by solo and PvP modes.

## Recommended timing

- Render: display refresh, normally 60 Hz.
- Host simulation: fixed 30 Hz initially.
- Guest input: 20 Hz.
- Authoritative snapshots: 15 Hz.
- Local movement and muzzle effects: predict immediately.
- Remote movement: interpolate buffered snapshots.
- Hitscan: host validates against 200 ms of position history.
- Rockets: replicate spawn ID, origin, direction, speed, and host time; simulate
  locally and let the host decide impact/explosion.
- Minigun and other automatic weapons: replicate trigger start/stop plus a spread
  seed, not one network broadcast per bullet.
- Pets, hazards, HP, ammo, food, death, and match result: host authoritative and
  included in compact snapshots/events.

The host simulation rate and the network send rate are intentionally different.
A 30 Hz authority can send 15 snapshots per second while clients render at 60 Hz.

## Current Supabase event budget

Supabase counts both the sender and every receiver as events. With `N` players:

```text
events/s = N * snapshotHz + 2 * (N - 1) * inputHz + N * sharedEventsHz
```

When gameplay events are bundled into snapshots:

| Players | Inputs | Snapshots | Baseline events/s | Free 100/s |
| ---: | ---: | ---: | ---: | --- |
| 2 | 20 Hz | 15 Hz | 70 | yes, with modest headroom |
| 3 | 20 Hz | 15 Hz | 125 | no |
| 4 | 20 Hz | 15 Hz | 180 | no |
| 4 | 8 Hz | 8 Hz | 80 | technically, but too little event and responsiveness headroom |

Four players at 8 Hz leave only 20 events/s of project headroom, equal to five
shared broadcasts per second. Four sidearms can produce 20 shots per second;
four miniguns can produce 80. Per-bullet messages therefore fail even before
pets, rockets, hits, food, or hazards are considered.

Compact payload size is not the constraint. A modeled snapshot containing four
players, four pets, four rockets, a hazard, and two gameplay events is under 4 KB,
well below Supabase's Free broadcast payload limit. Event fan-out is the limit.

Official references:

- Supabase Realtime limits: <https://supabase.com/docs/guides/realtime/limits>
- Supabase event accounting: <https://supabase.com/docs/guides/realtime/settings>
- Authoritative client/server model: <https://dev.epicgames.com/documentation/unreal-engine/networking-overview-for-unreal-engine>
- Simulation tick versus render rate: <https://doc.photonengine.com/fusion/current/concepts-and-patterns/network-simulation-loop>

## Smallest credible product slice

1. Two players only on the Foundry arena.
2. Sidearm, AK-47, Scattergun, and Bazooka.
3. No bots, pets, food, arena events, or progression writes during the first
   network test.
4. Fixed 30 Hz host simulation, 20 Hz inputs, 15 Hz snapshots.
5. One compact snapshot broadcast; inputs remain point-to-point.
6. Reintroduce systems one at a time: weapon roster, food, hazards, then pets.

This is enough to prove real Three.js movement, world collision, jumping,
hitscan, rocket timing, damage, death, and round results without pretending the
entire solo game is synchronized.

## Four-player gate

Do not enable four real-game players on the current Free 100 events/s limit.
Use one of these paths first:

1. Raise the project ceiling to at least 500 events/s and keep events bundled.
2. Move match traffic to a game transport/server and use Supabase only for auth,
   rooms, presence, and durable results.

WebRTC host-to-peer data channels avoid Supabase match-message fan-out but add
NAT traversal, TURN relay, host migration, and abuse/fairness work. It is not the
simplest next implementation for this codebase.

Run the evidence table with:

```bash
node pvp-real-game-capacity.js
```

