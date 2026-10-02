# Challenge record consistency candidate

Production remains 2.8.2. This candidate requires its database migration before
client deployment. No historical rows, receipts, player totals, inventory, or
cloud saves are rewritten. Missing historical submissions are not backfilled.

## What the numbers mean

| Display | Definition |
| --- | --- |
| Current tier | Next tier being played, starting at Rookie; six qualifying wins promote it. Nightmare remains the current tier after mastery. |
| Wins | All recorded Challenge victories in the selected season, including wins below the elimination target. |
| Runs | All completed Challenge games in that season, including losses. Abandoned games and Training are excluded. |
| Max kills / max damage | Independent single-game highs among standard Challenge games at the current tier, including losses. They can come from different games. They show zero until a game is recorded at a newly promoted tier. |
| Qualifying wins | Progress toward six at the current tier. Rookie/Regular need three eliminations; higher tiers need two. |
| Recorded lifetime Stats | The server player counters used by the lifetime board. They include Challenge, Custom, and historical legacy submissions. |
| Recent Challenges | The latest 20 recorded Challenge games in the selected club and season, with timestamps. Older games remain in totals after leaving this list. |

Ranking uses current tier descending, season wins descending, max kills
descending, max damage descending, then earliest participation and fighter name
for a stable tie. Runs are descriptive and do not reward repeated losses.
Preseason additionally retains old-version legacy matches.

For example, nine Challenge wins and one Custom win produce ten recorded
lifetime wins and nine season wins. Browser-save Stats can also include old
unsubmitted or guest games. Signed-in Stats now display recorded server totals;
those historical save values are preserved instead of merged into the board.

## Causes addressed

* The old board required a tier clear before showing a fighter, and displayed the hardest cleared tier rather than the current tier.
* Performance came from a selected tier-clearing match, rather than all games at the current tier. New-season legacy games polluted run totals and were mislabeled as tier clears in the feed.
* The six-second countdown ran while standings and authoritative progress loaded together. A slow standings request could leave a match starting from stale browser progress. Rematches skipped the progress refresh entirely.
* Choosing a larger browser save on sign-in could retain another fighter's state. The local save now tracks its owner, and existing fighters adopt their own remote save when ownership differs.
* Damage and headshot caps assumed fixed enemy health despite healing and life-drain. Future submissions retain nonnegative integer telemetry; authentication and supported-rule checks remain.

## Flow

Challenge entry asks guests to sign in with the existing fighter name/PIN flow.
Custom offers guest play, while Training remains available. Challenge flushes
pending receipts, reads authenticated progress, and only then starts its
countdown. An unresolved result or progress request presents Try again and Back.
Maps use a shuffled bag of every arena, with no repeat in a cycle and no
back-to-back repeat between cycles. All Challenge arenas are available; Custom
map ownership and settings are unchanged.

Recorded Stats and progress responses are guarded against account changes and
out-of-order reads. Stats polling stops on authentication errors until renewed
sign-in. Board and recent history refresh every 15 seconds while visible.

## Validation

Run JavaScript and PvP tests with:

```sh
node --test scripts/*.test.js pvp-real/*.test.js
```

Run real PostgreSQL integration tests with:

```sh
bash supabase/tests/run-local.sh
```

The runner builds the full migration chain in a fresh Unix-socket-only cluster,
reapplies this migration to check retries, and preserves a pre-migration legacy
save/history fixture. Cases cover first-run visibility, nonqualifying wins,
promotion, losses, independent current-tier highs, 61 Custom and 61 legacy games,
feed/board agreement, authenticated lifetime totals, no telemetry clipping,
receipt replay, inventory preservation, club scope, Preseason, eight concurrent
retries, and transaction rollback followed by retry.

Browser testing uses the actual client and RPC functions as the `anon` role
against local synthetic fighters. A temporary external harness finishes one
Challenge through the real `endMatch` handler, drops the response after commit,
and reloads. Verified: one new match and one receipt, ten recorded lifetime wins,
nine Challenge wins/runs, Regular 3/6, and a cleared pending queue. The harness
is outside the repository and is not shipped. This is a synthetic completion
test, not a certification of physical pointer-lock combat.

## Production rollout

1. Run `supabase/migrations/20261002060000_season_record_consistency.sql` in the production Supabase SQL Editor. It is transactional and safe to rerun against the existing migration chain.
2. Run `supabase/manual/verify-season-record-consistency.sql`. All function installation, old-cap removal, and club-scope checks should return true. Inspect the public board/feed for the named players.
3. Deploy the candidate client only after the new RPCs are installed. Cached 2.8 clients retain their compatible v2 responses, with corrected Challenge-only run counts and feed labels.
4. Complete one signed-in Challenge and one Custom game on the official site. Confirm only Challenge changes season wins/runs/recent history, while both change recorded lifetime Stats exactly once. A loss changes runs only; a qualifying win also changes the six-win progress.

Production write access was unavailable to the connected Supabase account during
this investigation. Production migration and browser acceptance are outstanding;
local tests do not establish that the deployed database is already fixed.
