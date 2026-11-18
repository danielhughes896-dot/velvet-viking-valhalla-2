#!/usr/bin/env bash
# Prove a migration on a disposable Postgres: make a cluster, apply the
# Supabase substrate, apply the migration TWICE (it must be re-runnable), run
# its proof as real users, then delete the cluster.
#   tools/db-proof/run.sh supabase-circles.sql tools/db-proof/circles-proof.sql
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
migration="$root/$1"; proof="$root/$2"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -x "$bin/initdb" ] || { echo "Postgres is not installed here."; exit 2; }
dir="$(mktemp -d)"; port=$(( 54000 + RANDOM % 900 ))
cleanup(){ run_pg "'$bin/pg_ctl' -D '$dir/data' -m fast -w stop" >/dev/null 2>&1 || true; rm -rf "$dir"; }
trap cleanup EXIT
run_pg(){ if [ "$(id -u)" = 0 ]; then chown -R postgres "$dir"; su postgres -c "$*"; else bash -c "$*"; fi; }
run_pg "'$bin/initdb' -D '$dir/data' -U postgres -A trust >/dev/null"
run_pg "'$bin/pg_ctl' -D '$dir/data' -o '-p $port -k $dir -c listen_addresses=' -l '$dir/log' -w start >/dev/null"
psql_(){ psql -X -q -o /dev/null -v ON_ERROR_STOP=1 -h "$dir" -p "$port" -U postgres -d postgres "$@"; }
psql_ -f "$here/substrate.sql"
psql_ -f "$migration"
psql_ -f "$migration"            # re-runnable
psql_ -f "$proof"
echo "PROOF PASSED: $1"
