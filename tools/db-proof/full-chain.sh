#!/usr/bin/env bash
# Rebuild the WHOLE schema on a disposable Postgres, in the documented order,
# then prove circles on top of it. The two operator placeholders get throwaway
# test values in a temporary copy only; the repository files are not touched.
#   tools/db-proof/full-chain.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
out="$here/.combined.sql"; trap 'rm -f "$out"' EXIT
owner=f0000000-0000-0000-0000-00000000000f
{
  echo "insert into auth.users (id, email) select '$owner','owner@test.invalid' where not exists (select 1 from auth.users where id = '$owner');"
  cat "$root/supabase-setup.sql"
  sed "s/tester\([0-9]\)@example.com/tester\1@test.invalid/g" "$root/supabase-beta-gate.sql"
  sed "s/REPLACE-WITH-VVV_OWNER_USER_ID/$owner/" "$root/supabase-entitlement.sql"
  for f in supabase-commercial-core.sql supabase-retire-legacy-beta-autogrant.sql \
           supabase-trial-grant-source.sql supabase-account-activity.sql \
           supabase-trial-via-provider.sql supabase-operational-view-provider-trial.sql \
           supabase-security-posture.sql supabase-health-consent.sql \
           supabase-account-agreements.sql supabase-circles.sql \
           supabase-security-posture.sql; do
    cat "$root/$f"; echo
  done
} > "$out"
"$here/run.sh" tools/db-proof/.combined.sql tools/db-proof/circles-proof.sql
