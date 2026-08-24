# Shooter's Royale

A 3D browser arena shooter, built by Ethan. One life, 200 HP, last block standing.

**▶ Play: https://fun-games-ralston.github.io/shooters-royale/**

What's changed and when: [RELEASE-LOG.md](RELEASE-LOG.md)

Mouse and keyboard, desktop browser. Click the arena once to lock the cursor.

---

## What's in it

- **14 weapons**, and every one of them works differently — damage that fades
  with distance, spray that climbs, burst fire, a heat bar instead of a
  magazine, a bipod you have to plant, a charge-up, shell-by-shell reloading,
  backstab, lifesteal, knockback. Each has a strength and a drawback printed
  on its shop card.
- **10 procedural arenas** with ice, lava, low gravity and killable drops.
- **7 pets** that fight alongside you and can be shot down.
- **Daily challenges, ranks, weapon mastery, medals and multi-kill banners.**
- A **training range** where you can test-fire every weapon in the game for
  free before deciding to save up for it.
- An optional **club leaderboard** — a made-up name and a 4-digit PIN, no email
  and nothing that identifies anyone.

## Controls

| | |
| --- | --- |
| `W A S D` | Move |
| Mouse / `LMB` / `RMB` | Aim / fire / aim down sights |
| `R` `Space` `Shift` | Reload / jump / sprint |
| `1` `2` `3` | Weapon slots (3 is always melee) |
| `F` `Q` | Eat / switch food |
| `V` `Tab` `Esc` | Camera / scores / pause |
| `T` | Next weapon — training range only |

## Files

| File | What it is |
| --- | --- |
| `index.html` | The whole game. One file, no build step. |
| `RELEASE-LOG.md` | Every change, newest first. Start here. |
| `supabase-setup.sql` | Database for the leaderboard. Paste into Supabase once. |
| `ONLINE-SETUP.md` | How to switch the leaderboard on. |
| `SPEC.md` | Game design and technical spec. |
| `STATUS.md` | Build status, balance numbers, known issues. |
| `balance-sim.js` | Balance harness — drives a simulated player inside the live game. |

## Running it locally

```bash
python3 -m http.server 8123
# then open http://localhost:8123/
```

Opening `index.html` by double-clicking works too, but a local server is closer
to how it behaves when published.
