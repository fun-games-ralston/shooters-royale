#!/usr/bin/env bash
set -euo pipefail
# Real PostgreSQL integration tests, isolated from all production data.
# Requires PostgreSQL 17+ binaries (e.g. brew install postgresql@17) and Python 3.
task_repo=$(cd "$(dirname "$0")/../.." && pwd)
task_pg_bin=${POSTGRES_BIN:-/opt/homebrew/opt/postgresql@17/bin}
if [[ ! -x "$task_pg_bin/psql" ]]; then
 task_pg_bin=$(dirname "$(command -v psql)")
fi
task_db=$(mktemp -d "${TMPDIR:-/tmp}/ethan-score-tests.XXXXXX")
task_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
cleanup(){ "$task_pg_bin/pg_ctl" -D "$task_db/data" stop -m fast >/dev/null 2>&1 || true; rm -rf "$task_db"; }
trap cleanup EXIT
"$task_pg_bin/initdb" -D "$task_db/data" -A trust --no-locale > "$task_db/init.log"
"$task_pg_bin/pg_ctl" -D "$task_db/data" -l "$task_db/server.log" -o "-k $task_db -h '' -p $task_port" start >/dev/null
psql_test(){ "$task_pg_bin/psql" -X -h "$task_db" -p "$task_port" -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_test -c 'create schema extensions; create role anon; create role authenticated;' > "$task_db/setup.log"
psql_test -f "$task_repo/supabase-setup.sql" >> "$task_db/setup.log"
psql_test -f "$task_repo/supabase-rank-by-tier.sql" >> "$task_db/setup.log"
psql_test -c "select sr_register('LEGACY_TEST','1234','test'); update players set save='{\"marker\":\"keep-me\"}' where handle='LEGACY_TEST'; insert into matches(handle,skill,won,played_at) values('LEGACY_TEST','rookie',true,'2026-09-01');" >> "$task_db/setup.log"
for task_migration in "$task_repo"/supabase/migrations/*.sql; do psql_test -f "$task_migration" >> "$task_db/setup.log"; done
# Apply twice: manual retries must be safe and must preserve all records.
psql_test -f "$task_repo/supabase/migrations/20261002060000_season_record_consistency.sql" >> "$task_db/setup.log"
for task_test in unlimited_legacy_matches unlimited_matches score_rules_audit score_receipts season_record_consistency; do
 psql_test -f "$task_repo/supabase/tests/$task_test.test.sql"
done
# The Challenge file's behavior/security assertions are PL/pgSQL exceptions;
# strip only its pgTAP reporting wrapper, so no pgTAP installation is needed.
sed -E '/^select plan\(/d; /^select pass\(/d; /^select \* from finish\(/d' "$task_repo/supabase/tests/challenge_seasons.test.sql" > "$task_db/challenge.sql"
psql_test -f "$task_db/challenge.sql"
export SCORE_TEST_SOCKET="$task_db" SCORE_TEST_PORT="$task_port" SCORE_TEST_PSQL="$task_pg_bin/psql"
python3 "$task_repo/supabase/tests/concurrent_receipts.py"
