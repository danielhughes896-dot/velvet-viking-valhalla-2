# Garmin integration — what exists, and what waits for Garmin

Valhalla's side of the Garmin integration is built. Garmin's side is not, and
deliberately so: everything below the line marked *waiting* depends on a
contract Garmin supplies only to approved Developer Program members, and a
plausible guess at any of it produces code that looks finished, passes its own
tests, and is wrong.

This file records the two decisions that are easier to get wrong later than to
write down now: where Garmin credentials will live, and how a completed
activity gets back into the coaching engine.

---

## The shape

```
state.days                        the plan, and the only source of truth
  └─ providerWorkout(dd)          canonical machine workout: metres, seconds, m/s
       └─ scheduledTraining()     which workout belongs on which date
            └─ reconcileScheduledTraining()   create / update / remove / noop
                 └─ api/_garmin.js            ← the vendor boundary
                      └─ Garmin Connect       ← waiting
                           └─ the watch
```

Everything above `api/_garmin.js` is provider-neutral, unit-independent and
tested. It contains no Garmin vocabulary and would serve a second platform
without the workout engine being touched — which is the test of whether the
boundary is in the right place.

---

## Credential storage: prepared, not migrated

**Decision: do not create `garmin_connections` yet.**

The security posture is settled and is not in doubt — it is
`strava_connections`, exactly:

```sql
alter table public.garmin_connections enable row level security;
-- No policies. Deliberately.
```

RLS on with **zero policies** means every request made with the `anon` or
`authenticated` role is denied, including a correctly signed-in athlete's own
JWT. Only the service-role key held inside the Vercel functions can read or
write it. A Garmin token is then unreachable from any browser, any exported
backup and any other athlete's session — the same guarantee Strava tokens
already have, for the same reason, enforced the same way.

What is **not** settled is the column list, and it depends on Garmin's token
contract:

| unknown | why it changes the schema |
|---|---|
| refresh tokens issued? | a `refresh_token` column is required, or is dead weight |
| token lifetime | `expires_at` may be a timestamp, a TTL, or absent |
| user identity shape | Garmin's user id may be a UUID, an opaque string, or a number |
| revocation model | may need a `revoked_at`, or may be a delete |
| scope granularity | `scope text` may need to be a set |

Writing a table now means either inventing those columns or writing a shapeless
`jsonb` blob and calling it a schema. Both are worse than waiting: the migration
is a ten-minute job once the contract is known, and the security decision — the
part that is genuinely hard and genuinely dangerous to get wrong — is already
made and written above.

**Environment variables**, by contrast, are settled and already read:
`VVV_GARMIN_CLIENT_ID`, `VVV_GARMIN_CLIENT_SECRET`, `VVV_GARMIN_ENABLED`.
All three server-side only. `configured()` requires credentials **and** the
explicit switch, so holding staging credentials cannot start syncing athletes'
calendars.

---

## The activity return path

The loop Valhalla is built for:

```
scheduled training → Garmin Connect → watch → completed activity
    → Garmin Connect → Garmin Activity API → api/_garmin.js ingestActivity()
    → the EXISTING activity/evidence model
    → the EXISTING execution scoring and adaptation rules
    → legitimate plan evolution
    → reconcileScheduledTraining() → back to Garmin
```

**There is no Garmin-specific coaching path, and there must never be one.** A
run that came back from a watch is evidence like any other. `ingestActivity()`
normalises a Garmin payload into the same activity shape the Strava path
already produces, and hands it to the machinery that already exists — the same
execution scoring, the same evidence rules, the same adaptation logic. A test
asserts the adapter contains no coaching identifiers, so this cannot drift into
a second engine by accident.

Delivery mechanism (webhook push, ping-then-fetch, or polling) is Garmin's
choice and is not guessed here.

---

## Waiting on Garmin

Each of these is one unimplemented step inside a function that already exists,
has a real signature, and refuses with a tagged error rather than a
plausible-looking result:

| function | needs |
|---|---|
| `beginAuthorization` | authorize endpoint, scope names, parameter names |
| `completeAuthorization` | token endpoint, grant type, response schema |
| `disconnect` | revocation endpoint |
| `applyScheduledTraining` | workout schema, calendar schema, remote-ID semantics |
| `ingestActivity` | activity payload schema, delivery shape |

Garmin's public Developer Program material indicates **OAuth 2.0**, so that is
the authentication family this is shaped for. Nothing beyond the family is
assumed — not the grant type, not the endpoints, not the parameter names.

**Until all of that exists, the integration is inert**: `configured()` is false,
every adapter entry point refuses before doing anything, no Garmin host is
contacted, no token is read, and Settings shows *Not yet available* with no
control to press.

---

## Mapping decisions already made

These are Valhalla-side and did not need Garmin's contract. The adapter chooses
the closest supported representation once the schema is known.

| Valhalla | canonical form | note |
|---|---|---|
| qualitative recovery (`short`, `scaled to the rep`, `jog/walk back down`, `full recovery`) | `duration: {type:'open', advance:'manual', rule}` | no number is fabricated |
| timed cool-down (`complete 10km total`) | `{type:'open', rule:'complete_session_total', sessionTotalMetres}` | the remainder is not knowable in advance; the total is |
| ladder | discrete work steps in executable order | no ladder primitive needed |
| nested repeat (2 × 4 × 400m) | repeat inside repeat | never flattened to 8 × 400m |
| between-reps recovery | `omitOnFinalIteration: true` | N reps, N−1 recoveries |
| hill descent | no omission flag | happens after **every** rep |
| progressive tempo | `ramp: {fromIntensity, toIntensity}` | where the change happens is prose, not prescription |
| hills / fartlek / time trial | `targets: []`, `openReason` | run by feel; a pace window would be a fabricated instruction |
| pace | both sec/km **and** m/s | fast pace = **high** m/s; inversion is tested explicitly |
| race day | representable; whether it is sent is policy | left explicit until Garmin behaviour is verified |
