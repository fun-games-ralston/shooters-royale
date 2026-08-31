# PvP networking spike

Status: **prototype only**. The authoritative simulation, transport boundary, latency
tests, and a standalone 2–4 player browser lab exist on the
`pvp-realtime-spike` branch. They are intentionally not wired into the full
Three.js match yet.

Open `pvp-spike.html` through a local HTTP server to run the live lab. One person
creates a room and sends the link or 12-character code to up to three friends.
The feature branch also adds **Play with friends · Beta** to the main menu. That
entry opens the same isolated lab; it does not change the normal solo Deploy flow.

The host creates the room, waits for every guest input channel to finish its
handshake, and is the only UI allowed to start. A synchronized start message then
moves all connected players from the roster into the test arena.

## What is ground truth?

| State | Authority | What a client may send |
| --- | --- | --- |
| Position and velocity | Host simulation | Movement direction only |
| Aim | Player input, validated by host | Yaw and shot time |
| Shot origin | Host position history | Nothing |
| Whether a bullet hit | Host ray test | Nothing |
| Damage, HP, and death | Host | Nothing |
| Weapon fire rate | Host | A monotonically increasing fire ID |
| Lobby join/leave | Supabase Presence | Slow-changing name and role only |

A client packet is reduced to `seq`, movement direction, yaw, `fireId`, and
`shotAtMs`. Fields such as `x`, `z`, `hp`, `damage`, `targetId`, or `hit` are
discarded. Inputs and snapshots carry increasing sequence numbers; old or
duplicate packets are ignored.

## How one bullet works

1. The shooter predicts the muzzle flash immediately and sends input plus a shot
   edge. It does not report a hit.
2. The host receives the packet and checks input order, player state, and weapon
   cadence.
3. The host clamps the claimed shot time to a maximum 200 ms rewind window.
4. The host samples its recorded positions for the shooter and targets at that
   validated time, then performs the ray test.
5. If the ray intersects a target, the host changes current HP/death state and
   broadcasts the result. All clients render that decision.
6. When only one fighter remains, the host assigns an authoritative round-end
   sequence, repeats the final snapshot and `round_end` event, and waits for every
   connected guest to acknowledge it. Gameplay and network traffic stop after all
   players confirm the result, or after a short timeout.

The short rewind prevents the common unfair result where a player aimed correctly
but the target moved before the packet reached the host. The cap prevents someone
with a very stale or forged timestamp from shooting arbitrarily far into the past.

## Transport shape

- One shared room channel carries 8 host snapshots per second, discrete game
  events, lobby Presence, and occasional clock-sync pings.
- Each guest gets a separate input channel subscribed to only by that guest and
  the host. This avoids fanning every input out to all four players.
- The host simulates at 60 Hz. Guests predict their own movement every render
  frame, reconcile against same-time host history, and render other players 125
  ms behind using interpolation.

At four players, the steady-state estimate is about 80 Realtime events per second:
32 for snapshot send/fan-out and 48 for three guest input send/deliver paths. This
leaves limited headroom under the current Supabase Free limit of 100 events per
second, so the product must measure real project traffic and must not increase the
8 Hz rates casually.

## Tests

Run:

```bash
node --test pvp-netcode.test.js pvp-realtime.test.js
node pvp-latency-sim.js
```

The automated suite covers:

- rejection of client-authored position/health/hit claims;
- duplicate and out-of-order input and snapshot rejection;
- host-owned movement and arena bounds;
- a target crossing the bullet line before the shot packet arrives;
- the 200 ms rewind cap;
- duplicate shot and fire-rate enforcement;
- prediction reconciliation and remote interpolation;
- live guest input reaching host authority, plus prediction stopping cleanly at 0 HP;
- reliable round-result delivery with guest acknowledgements before final traffic stops;
- separate guest input channels and host-only snapshots;
- convergence under deterministic latency, jitter, reordering, and packet loss.

The matrix includes 0–250 ms **one-way** simulated delay, up to 100 ms jitter,
and up to 10% packet loss. Movement converges to exact host truth after settling.
Crossing-target hit detection succeeds through the 200 ms rewind window and is
intentionally denied beyond it.

## What is not proven yet

- The lab is separate from the full game. Real arena collision, every weapon,
  rockets, pets, bots, pickups, match results, and reconnects are not synchronized.
- The room is public-but-unlisted. Anyone who learns a room code can subscribe or
  inject traffic. Productization requires anonymous Supabase Auth, private channels,
  a room-membership table with RLS, expiry, and a four-seat server-side rule.
- There is no host migration. A host disconnect ends the match.
- Automated browser testing was blocked in the current sandbox because it cannot
  open a local HTTP port or a `file:` page. The lab still needs a served-page test
  in two browsers and on the managed Chromebook/network.

## Merge gates

Do not integrate this into `index.html` until all of these pass:

1. Two-device room create/join, movement, shooting, damage, and leave behavior.
2. Four-device message-rate observation stays below 90 events/second with no
   Supabase disconnects for a 10-minute match.
3. Median RTT is recorded on the intended school network; play remains readable at
   the observed p95.
4. At 250+ ms one-way delay, the UI clearly shows a poor-connection state rather
   than silently expanding rewind.
5. The actual Three.js simulation is extracted behind the same host-authority
   boundary before syncing weapons or pets.

Kill criterion: if four managed Chromebooks cannot sustain the 8 Hz topology with
stable Realtime channels and acceptable corrections, stop extending this browser-
host approach and move the authoritative room to PartyKit or a Cloudflare Durable
Object.
