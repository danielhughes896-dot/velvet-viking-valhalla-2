# Strava → Valhalla: the data contract

What Valhalla consumes when it reasons about a completed run, what Strava can
supply under the scopes we request, and what happens to the difference.

Written from the code on both sides: the Valhalla column is what
`ACTUAL_MANUAL_FIELDS` / `ACTUAL_IMPORTED_FIELDS` declare and what the coaching
layer actually reads; the Strava column is what `normaliseActivity()` in
`api/_strava.js` maps. Where the two disagree, the disagreement is written down
rather than papered over.

**The rule that governs the whole table: a missing metric never becomes zero.**
Strava creates an activity record and fires its `create` webhook *before* the
uploaded file is processed, so a device upload is routinely readable for a few
seconds with `distance: 0` and `moving_time: 0`. Recording that as a genuine
zero would invent a measurement out of its absence, and a 0 km run would be
offered to the matcher as evidence. Distance, times, cadence and heart rate are
therefore absent when zero. Elevation gain is not: a flat run really does climb
0 m, and treating that as missing would discard a true reading.

---

## The matrix

| Valhalla field | Strava source | Available | Scope | Transformation | Required? | Fallback if absent | Downstream if absent |
|---|---|---|---|---|---|---|---|
| `stravaActivityId` | `id` | ✅ | `activity:read_all` | to string | **required** | not staged | — the identity every idempotency rule keys on |
| — (ownership) | `owner_id` / token | ✅ | `read` | matched to `strava_connections.strava_athlete_id` | **required** | event dropped | cross-athlete isolation |
| provenance | implicit | ✅ | — | `dd.stravaActivityId` set on the day | **required** | — | distinguishes Strava from manual and future Garmin |
| `activityType` | `sport_type` ?? `type` | ✅ | `activity:read_all` | verbatim | **required** | not staged | matcher refuses a non-run |
| `date` | `start_date_local` | ✅ | `activity:read_all` | first 10 chars | **required** | not staged | matching is date-anchored |
| start time | `start_date_local` | ✅ | `activity:read_all` | first 19 chars | optional | absent | ordering of same-day activities |
| timezone | `timezone` | ✅ (unused) | `activity:read_all` | — | **not requested** | — | `start_date_local` is already local; a second clock would only disagree |
| `km` | `distance` (m) | ✅ | `activity:read_all` | ÷100, round, ÷10 → 0.1 km | **required** | not staged | distance score, matcher plausibility |
| `movingTimeSec` | `moving_time` | ✅ | `activity:read_all` | positive only | optional | absent | pace derivation, session duration |
| `elapsedTimeSec` | `elapsed_time` | ✅ | `activity:read_all` | positive only | optional | absent | nothing scored; recorded for completeness |
| `pace` | *derived* | ✅ | `activity:read_all` | `moving_time / (distance/1000)` | optional | absent | **pace score omitted, not zeroed** |
| — | `average_speed` | ✅ (unused) | `activity:read_all` | — | **not requested** | — | pace is derived from the two primitives so it agrees with the imported distance exactly; the rounded average would not |
| — | `max_speed` | ✅ (unused) | `activity:read_all` | — | **not requested** | — | nothing in Valhalla reads a peak speed |
| `hr` | `average_heartrate` | ✅ | `activity:read_all` | round; gated on `has_heartrate` | optional | absent | **HR score omitted**; drift, efficiency and HR-cost evidence stand down |
| `maxHR` | `max_heartrate` | ✅ | `activity:read_all` | round; gated on `has_heartrate` | optional | absent | as above |
| HR availability | `has_heartrate` | ✅ | `activity:read_all` | gate, not stored | **required for HR** | HR treated as absent | stops a 0 bpm being read as a measurement |
| `cadence` | `average_cadence` | ✅ | `activity:read_all` | **×2** — Strava reports one leg | optional | absent | recorded; no score depends on it |
| `elevationGainM` | `total_elevation_gain` | ✅ | `activity:read_all` | round; **0 is real** | optional | absent | context only |
| `splits` | `splits_metric[]` | ✅ *(detail endpoint only)* | `activity:read_all` | per-km → `{km, sec, paceSec, hr}` | optional | absent | **`coachSplitMetrics()` returns null** — no consistency %, no fade %, no split type |
| `trainer` | `trainer` | ✅ | `activity:read_all` | boolean | optional | false | treadmill context |
| `manual` | `manual` | ✅ | `activity:read_all` | boolean | optional | false | a manual Strava entry carries no device evidence |
| activity name | `name` | ✅ | `activity:read_all` | **not imported** | — | — | deliberate: it is athlete prose, and Valhalla writes its own titles |
| device / gear | `device_name`, `gear_id` | ✅ | `activity:read_all` | **not requested** | — | — | nothing consumes it |
| calories | `calories` | detail only | `activity:read_all` | **not requested** | — | — | Valhalla has no energy model and must not imply one |
| laps | `laps[]` | detail only | `activity:read_all` | **not requested** | — | — | `splits_metric` already answers the only question asked of per-segment data |
| streams | `/streams` | separate call | `activity:read_all` | **not requested** | — | — | a much larger request for data that would be reduced back to `splits_metric` |
| `rpe` | — | ❌ | — | — | optional | athlete enters it | **effort score omitted** — Strava has no opinion on how a run felt |
| `feel` | — | ❌ | — | — | optional | athlete enters it | readiness/feel evidence stands down |
| `notes` | — | ❌ | — | — | optional | athlete enters it | the notes wand, environment parsing |
| `tempC`, `humidity` | — | ❌ | — | — | optional | parsed from the athlete's own notes | heat/humidity context in Execution Review |

### What Valhalla wants that Strava cannot give

Three of the four scoring components are objective and imported. **The fourth
is not, and never can be:** `rpe` and `feel` are the athlete's own account of
the session, and no external source has an opinion about them. This is already
how the product behaves — `computeExecutionBreakdown()` scores over whichever
components are present and renames the missing ones rather than substituting a
value — so an imported run is scored on distance, pace and (with consent) heart
rate, and says so.

`tempC` / `humidity` are declared in `ACTUAL_IMPORTED_FIELDS` and Strava does
not supply them. They are parsed from the athlete's own notes instead. No
change is proposed: buying weather from a third party to fill a field would be
inventing evidence the athlete never gave.

**Nothing here degrades into a fabricated number.** Every absent field stays
absent, and every consumer already handles absence — that is the existing
evidence philosophy and this integration inherits it rather than working
around it.

---

## Scopes — and why each one is requested

`STRAVA_SCOPE = 'read,activity:read_all'` (`api/_strava.js`).

| Scope | Why Valhalla needs it | Feature that requires it |
|---|---|---|
| `read` | The athlete's own name, to show *which* Strava account is connected in Settings and in the builder offer. | "Connected as …" — an athlete with more than one Strava login cannot otherwise tell which they authorised. |
| `activity:read_all` | The activities themselves, **including ones the athlete marked private**. | Every import: matching, Execution Review, training history, athlete state, plan evolution. |

**Why `activity:read_all` and not `activity:read`.** `activity:read` omits
activities the athlete has marked private, and a private run is still training
that happened. Importing a partial history would leave silent holes in the
evidence the coaching engine reasons from — a missed session that was actually
run, scored as missed.

**No write scope is requested at all.** Valhalla never creates, edits or
uploads a Strava activity, and `activity:write` would grant a capability the
product has no use for.

---

## Callback domain — the values to configure

`redirectUri()` is `VVV_SITE_ORIGIN + '/api/strava-callback'`, and
`VVV_SITE_ORIGIN` is `https://app.velvetviking.co.uk` (see `ENVIRONMENT.md`).

| | Value |
|---|---|
| **Redirect URI** (built by the server) | `https://app.velvetviking.co.uk/api/strava-callback` |
| **Authorization Callback Domain** (Strava dashboard) | `app.velvetviking.co.uk` |

Bare domain — **no scheme, no path, no trailing slash**. Strava matches the
host of the redirect URI against this string.

**This is a correction.** `STRAVA-SETUP.md` documented the callback domain as
`velvet-viking-valhalla-1.vercel.app`, which is wrong twice over: it is a
temporary Vercel hostname rather than the production domain, and `-1` is the
**marketing website** project, not the app. The app is `-2`, served at
`app.velvetviking.co.uk`. An OAuth return to the website project would not
reach `/api/strava-callback` at all.

---

## Rate limits

Allowance: **400 requests / 15 min, 4,000 / day** overall; **200 / 15 min,
2,000 / day** read.

| Operation | Requests | Notes |
|---|---|---|
| OAuth token exchange | 1 per connection | once per athlete |
| Token refresh | 1 per ~6 h per active athlete | only when a call is actually made |
| Manual sync (backfill) | **1** | one list call, `per_page=100`, `after=` a 60-day window (max 400 days) |
| Webhook delivery | **1** per activity | one detail read, which is also where `splits_metric` comes from |
| Deauthorization | 1 | on disconnect |

**Ten beta athletes fit with room to spare.** The realistic steady state is one
webhook read per run — roughly 5 per athlete per week, so ~50 reads/week across
the beta against a 2,000/day read allowance. The manual sync is a single
request no matter how many activities it returns, which is why it exists in
that shape rather than as a per-activity walk.

---

## Provenance, and the future Garmin case

`dd.stravaActivityId` marks a day as Strava-derived. The staging table is keyed
`(user_id, activity_id)`, so a re-import, a webhook replay, an `update` event
and a retry all land on the same row rather than creating a second one.

An athlete may eventually have **both** Garmin and Strava connected, and the
same physical run could arrive from both. Nothing here forecloses reconciling
that: the canonical day model carries a single completed record with a source
marker, so a future Garmin ingest resolves against the same day rather than
creating a parallel one. What must not happen — and does not — is a
Strava-specific field becoming mandatory in the canonical activity model.
