# Win-recording audit, 13 September 2026

## Deployment status

Prepared and tested locally. At the last read-only production check, the new
`sr_submit_once` endpoint returned HTTP 404 / PGRST202 and the public main client
still used the old submission path. Applying SQL and publishing GitHub Pages
are separate steps. Use `supabase/manual/win-sync-fix.sql` before client rollout.

## Scoring rules reviewed

| Rule | Effect after these migrations |
| --- | --- |
| 25 matches per rolling hour | Removed by the earlier quota migrations |
| 3,600 accumulated reported seconds per rolling hour | Removed by the earlier quota migrations |
| Minimum five-second match duration | Removed for both old and versioned submission endpoints |
| Zero eliminations, easy opponents, one opponent | Completed solo wins still count |
| Challenge tier mismatch, nonstandard setup, no active season | Lifetime result counts; seasonal qualification remains false, with a reason |
| Challenge elimination target and six wins per tier | Visible progression requirements; do not discard lifetime wins |
| PIN authentication, malformed payloads, conflicting reuse of an ID | Still checked; errors are visible |
| Upper bounds on stored kills, headshots, damage, duration | Clip those fields; do not reject or cap wins |
| Board and recent-history row limits | Display limits; do not change stored totals |
| Daily first-win coin bonus ceiling | Reward calculation only; does not change wins |
| Optional 30-minute reminder | Dismissible; does not impose a cooldown |
| Training | No completed competitive result or lifetime win |
| Friends PvP | Separate room scoreboard; not part of solo Stats or solo win submissions |
| Guest play | Local Stats only; menu says to sign in before playing to record leaderboard results |

## Verified behavior

- Main: 70 JavaScript tests. Feature: 81 JavaScript tests. Generated PvP content unchanged.
- Legacy-only, original Challenge, and six-win Challenge database configurations tested in disposable local databases.
- 62 distinct zero-to-four-second wins per receipt endpoint accepted; identical retries leave exactly one match and one increment per ID.
- More than 60 submissions and more than 3,600 reported seconds in one transaction accepted through the legacy endpoint.
- All six opponent presets, 1/11 opponent boundaries, zero kills, and 0/2,000 reported seconds accepted as wins through the legacy RPC.
- Eight concurrent requests for the same ID produced one win, one match and one receipt. A rolled-back submission can subsequently be retried and committed once.
- Authentication, conflict detection, private receipt ACLs, stale-save protection, account switches, local storage failure, and network backoff checked.
- Synthetic browser completion used the actual main `endMatch(true)` handler with zero elapsed seconds and zero kills. The local server committed the win but withheld its acknowledgement. After reload and retry, the menu showed one Stats win, one leaderboard win, and “Result recorded on the leaderboard”; the database had one match and one receipt.
- Challenge mismatch, nonstandard setup and a simulated calendar gap each preserved the lifetime win while leaving seasonal qualification false. Existing six-win progression regression passed.
- Both migrations are rerunnable. The combined manual script is atomic and ends with a read-only function check.

The browser check simulated completion; it does not certify physical combat or a
production write. No real player totals, saves, or history were changed. Past
missing submissions cannot be reconstructed from the limited saved recent log,
and this patch does not backfill them.

The CLI security advisor could not connect to the disposable database because it
attempted TLS against the local non-TLS listener, including with sslmode=disable.
SQL checks verified receipt RLS, denied direct client table access, authorized
RPC execution, and PIN checks on both initial submissions and receipt replays.
