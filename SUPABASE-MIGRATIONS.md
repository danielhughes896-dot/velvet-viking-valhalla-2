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
| 12 | `supabase-welcome-email.sql` | `account_welcome_email` — the one-per-athlete lock behind the founder welcome email |

Applied in this order against an empty database plus the Supabase substrate
(`auth.users`, `auth.uid()`, `auth.jwt()`, the platform roles, and the default
table grants to `anon`/`authenticated`/`service_role`), all twelve apply cleanly
and are individually re-runnable.

Files 11 and 12 go **after** file 10 rather than anywhere convenient. File 10 asserts
that every table in `public` has row-level security enabled, so a new table
created before it would have to be added to that file's reasoning to pass.
Created after it, with RLS on from their first statement and their own
assertions, they agree with file 10 whichever order they are re-run in.

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
| `supabase-pre-beta-least-privilege.sql` | The record of a hand-applied production hardening. See above. |
