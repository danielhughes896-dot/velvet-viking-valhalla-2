# Supabase migrations — apply order

Order matters, and nothing in the files themselves says so. A fresh environment
that applies them alphabetically fails halfway: `supabase-commercial-core.sql`
reads `public.beta_allowlist` when it migrates the beta cohort, and that table
is created by `supabase-beta-gate.sql`.

This was found by actually reconstructing the schema on a disposable Postgres 16
cluster rather than by reading the files, which is the only way that class of
dependency shows up.

## Order

| # | File | Creates / does |
|---|---|---|
| 1 | `supabase-setup.sql` | `plans`, `strava_connections`, `strava_activities` |
| 2 | `supabase-beta-gate.sql` | `beta_allowlist`, the signup gate, beta RLS |
| 3 | `supabase-entitlement.sql` | `entitlements`, `access_leases`, lease revocation |
| 4 | `supabase-commercial-core.sql` | `account_commercial`, `subscriptions`, `entitlement_grants`, `billing_events` — **reads `beta_allowlist`** |
| 5 | `supabase-retire-legacy-beta-autogrant.sql` | removes the signup auto-grant; refuses if anyone depends on it |
| 6 | `supabase-trial-grant-source.sql` | `trial` grant source, `start_standard_trial()` |
| 7 | `supabase-account-activity.sql` | `last_active_at`, `touch_last_active()`, `account_operational_state` |
| 8 | `supabase-trial-via-provider.sql` | retires the card-free trial; founding-price and pause columns |
| 9 | `supabase-operational-view-provider-trial.sql` | rebuilds `account_operational_state` so the trial is read from `subscriptions` |
| 10 | `supabase-security-posture.sql` | InitPlan policy rewrite, service-only assertions, definer search paths, `rls_auto_enable()` |
| 11 | `supabase-health-consent.sql` | `health_data_consent` — the append-only explicit-consent record for health and readiness information |
| 12 | `supabase-circles.sql` | Circles: `circles`, `circle_members`, `circle_invites`, `circle_days`, `circle_cheers`, `circle_sharing_log` — a private group of 2 to 8 that sees whether each member did their own plan; consent recorded on joining, everything else through checked functions |
| 13 | `supabase-coach-memory.sql` | `coach_memory` — Coach Memory's one-line notes (a decision, a conversation or a flag; at most 200 characters; never Strava). Owner reads only; written and cleared only by the server; newest 100 kept |
| 14 | `supabase-public-signup.sql` | The public sign-up switch: `signup_settings` (one row, service-read-only), `public_signup_open()`, and `enforce_beta_allowlist()` / `is_beta_approved()` redefined to consult it; the `beta_allowlist_gate` trigger kept. Seeds the switch to what the database already does, so applying it opens nothing |

Applied in this order against an empty database plus the Supabase substrate
(`auth.users`, `auth.uid()`, `auth.jwt()`, the platform roles, and the default
table grants to `anon`/`authenticated`/`service_role`), all eleven apply cleanly
and are individually re-runnable.

File 11 goes **after** file 10 rather than anywhere convenient. File 10 asserts
that every table in `public` has row-level security enabled, so a new table
created before it would have to be added to that file's reasoning to pass.
Created last, with RLS on from its first statement and its own append-only
assertions, the two agree whichever order they are re-run in.

The default table grants matter and are easy to leave out of a rebuild. Supabase
grants the browser roles table privileges and lets ROW-LEVEL SECURITY do the
deciding. A cluster without them refuses at the GRANT layer instead, so every
RLS proof run against it proves the wrong refusal — "permission denied" for a
reason production does not have.

Files 6 and 8 are a pair worth reading together: 6 introduced a card-free trial
as a third grant source, and 8 retires it after HQ moved the trial onto a real
provider subscription. 6 is kept rather than edited away because an existing
database has already run it, and a migration that quietly changes what it did
last time is a migration nobody can reason about.

File 9 is the same change catching up with file 7. `account_operational_state`
was written while the trial was a grant, and once 8 retired that source the view
was reading something that could no longer exist — so it reported every real
trial as inactive, confidently, on the metrics surface. Two things were done,
not one: **file 7 was corrected in place**, so a fresh environment builds the
right view first time, and **file 9 exists**, so a database that already ran the
old file 7 can be corrected without replaying anything. That is not the mistake
file 6 avoids. A view is derived, not data: re-running the corrected 7 and
running 9 leave a database in exactly the same state, and neither touches a row.
The two definitions are asserted identical by test, not compared by eye.

File 12 was applied to production on 14 November 2026. Its first live
application came from outside this file and added a "done must be real" check
that copied the plan's distance into the shared row after the km gate, so km
reached the circle with km switched off. No circle existed yet. The check now
in the file (STEP 4b) confirms a done day against the athlete's own plan and
never sets km or the session name; it was applied over the live one the same
day, and every circle function in production now matches this file exactly.

File 12 is the first table where one athlete's data is visible to another,
so it is the first migration proved by ACTING AS PEOPLE rather than by reading
the SQL: see "Proving a migration" below. Like 11 it goes after 10, is created
with RLS on, and asserts its own posture (every circle policy for signed-in
users only and scoped to the caller or their circle, no client writes to
membership, invites, Nice work or the consent log, every circle function on
the empty search path and closed to the anonymous key).

File 13 is Coach Memory (Phase 4). It follows the posture of 11 and 12: after
10, row-level security on in the statement after the table exists, and a
closing block that refuses — *"Nothing has been changed."* — if RLS is off, if
any policy other than the owner's SELECT exists, if a policy reaches beyond
signed-in users or is not scoped to the caller, if the browser roles hold
INSERT/UPDATE/DELETE (or the anonymous key SELECT) at the GRANT layer, if a
line check is missing, or if the prune function is callable or unpinned. There
is deliberately no client write policy of any kind: the server builds every
line from a fixed sentence or the athlete's own question and checks it
(`api/_coach-memory-lines.js`), and "Clear memory" is a server call scoped to
the verified uid, the same one account deletion makes. The line checks are in
the table too (1–200 characters, one line, never the word Strava, one of three
kinds), so a server bug cannot store what the rules forbid. The app treats a
missing table as "nothing kept", so the code can ship before this file is
applied; nothing is kept until it is. Proved by acting as people:
`tools/db-proof/run.sh supabase-coach-memory.sql tools/db-proof/coach-memory-proof.sql`,
and it is in `full-chain.sh`, after which file 10 re-runs cleanly.

File 14 is the public sign-up switch (founder, 18 November 2026: "make it as
if it's ready to go"). It goes after 10, like 11 to 13, and file 10 re-runs
cleanly after it. It does not edit any file above: it redefines the gate
function and the row predicate in place, keeps the trigger, and refuses unless
file 2 is installed. Applying it changes nobody's ability to sign up; the
separate `update public.signup_settings set public_signup = true` does, and
`false` turns it back. Proved by acting as people:
`tools/db-proof/full-chain.sh tools/db-proof/public-signup-proof.sql` (switch
off, on, off again, and over a database the cutover had already opened).
Steps: `AUTH-AND-EMAIL.md` → "Public sign-up".

## Deployment parameters

Three values are substituted by the operator, not by the files:

- **`REPLACE-WITH-VVV_OWNER_USER_ID`** in `supabase-entitlement.sql` — the owner
  account's uid, held in Vercel as `VVV_OWNER_USER_ID`. The file aborts rather
  than run with the placeholder, and aborts again if no auth user has that id.
- **The `@example.com` tester rows** in `supabase-beta-gate.sql` — replaced with
  real addresses. The file refuses to run while a placeholder remains.
- **`p_trial_days`** is *not* a file parameter: it is passed at call time from
  `TRIAL_DAYS` in `api/_products.js`, so the duration has one source of truth.

Those aborts are features. Each one refuses with *"Nothing has been changed."*

## Closed gap — `rls_auto_enable()`

`supabase-pre-beta-least-privilege.sql` revokes EXECUTE on
`public.rls_auto_enable()`, an event-trigger function that turns RLS on for any
newly created table. That function was created by hand in production and its
definition was never in this repository, so a database rebuilt from these files
could not run that migration and the repository could not reproduce production.

File 10 closes it, and closes it in the larger half first. Every table these
migrations create already carries an explicit `enable row level security`, so a
fresh rebuild reaches the intended posture from the explicit statements without
the trigger. File 10 therefore **asserts** that every table in `public` has RLS
on — that is the guarantee — and additionally supplies the helper and the
`ensure_rls` event trigger as a net under tables added later by hand in the
dashboard, which is a real thing that happens and exactly when somebody forgets.

Creating an event trigger requires superuser and a managed Postgres may refuse.
That refusal is caught and reported rather than failing the migration, because
the assertion is the part that guarantees the posture.

With file 10 applied, `supabase-pre-beta-least-privilege.sql` can be run against
a fresh database. It stays out of the numbered order because it is a record of
what was applied to production by hand, not a step in building a new one.

## Not in the order, on purpose

| File | Why |
|---|---|
| `supabase-commercial-activation.sql` | **Dismantles the private-beta gate** so the public can be charged. Applying it opens public signup. Not until HQ says so. |
| `supabase-beta-hardening.sql` | Optional narrowing behind its own `STEP 0` authorisation switch. STEP 1 was applied via the least-privilege file; STEP 2 has not been authorised. |
| `supabase-beta-verification.sql` | Read-only reporting. |
| `supabase-web-billing-verification.sql` | Read-only reporting. Answers "is this database ready to sell" — which of the files above are actually applied, whether the two gates that close the product are still closed, and whether anybody's access exists only in the legacy override column. Safe to paste into production. |
| `supabase-pre-beta-least-privilege.sql` | The record of a hand-applied production hardening. See above. |

## Proving a migration

`tools/db-proof/` builds a disposable Postgres, gives it just enough of the
Supabase substrate (the platform roles, `auth.users`, `auth.uid()` read from
the request claims, and the default grants that leave the deciding to RLS),
applies a migration twice to prove it re-runs, then acts as real users to try
every thing the rules forbid, and deletes the cluster.

- `tools/db-proof/run.sh supabase-circles.sql tools/db-proof/circles-proof.sql`
  proves circles on its own.
- `tools/db-proof/run.sh supabase-coach-memory.sql tools/db-proof/coach-memory-proof.sql`
  proves Coach Memory on its own: the owner reads only their own lines, no
  browser write gets through even with the grants put back, the line checks
  refuse, only the newest 100 are kept, and the lines go with the account.
- `tools/db-proof/full-chain.sh tools/db-proof/public-signup-proof.sql` proves
  the public sign-up switch on top of the whole chain.
- `tools/db-proof/full-chain.sh` rebuilds the whole order above (the two
  operator placeholders get throwaway test values in a temporary copy, never
  in these files), applies circles, re-runs file 10 after it, and proves
  circles on top.

`substrate.sql` must never be run against a real Supabase project.
