# Data inventory — for Play Data Safety and Apple App Privacy

A factual inventory, not legal prose. Each row is what the code actually does,
traceable to the file that does it. Use it to answer the two store
questionnaires; do not paraphrase it into promises.

**Three answers apply to every row and are worth stating once:**

- **Shared with third parties: NO.** There is no analytics SDK, no advertising
  SDK, no crash reporter, no tracker and no advertising identifier anywhere in
  the product. `NSPrivacyTracking` is `false`, no `NSUserTrackingUsageDescription`
  exists, and no ATT prompt is shown because there is nothing to ask about.
- **Encrypted in transit: YES.** Supabase and Vercel are HTTPS only; the shell
  loads over `https://` and cleartext is off at the platform default.
- **Deletion: YES, in-app.** Settings → Delete Account calls
  `delete_own_account()` (`supabase-setup.sql`), which removes the `auth.users`
  row; `plans`, `entitlements`, `access_leases`, `strava_connections` and
  `strava_activities` all cascade from it. Also reachable with **zero
  entitlement** through `/api/account-delete`, so a lapsed athlete can still
  leave. This satisfies Apple 5.1.1(v).

---

## Collected

| Data | Collected | Linked to identity | Purpose | Required | Where it lives | Export | Delete |
|---|---|---|---|---|---|---|---|
| **Email address** | Yes | Yes | Account identity; magic-link sign-in. No password exists | Required to sync; the app works signed-out on one device | `auth.users` | Yes — `/api/account-data` | Yes |
| **Training plan** (goal distance, race date, weekly volume, benchmark time, goal times, schedule, experience level) | Yes | Yes | Generating and adapting the block | Required for the product to function | `plans.data` JSON | Yes | Yes |
| **Workout history** (per session: type, prescribed distance, completion) | Yes | Yes | Coaching decisions, execution scoring, trends | Required | `plans.data` | Yes | Yes |
| **Pace and distance** (actual, per session) | Yes | Yes | Execution scoring, pace-zone calibration | Optional — typed by the athlete or imported | `plans.data` | Yes | Yes |
| **Heart rate** (per session average/max; LTHR, max HR) | Yes | Yes | HR-zone scoring, easy-run baseline | **Optional** — the product works fully without it | `plans.data` | Yes | Yes |
| **Readiness / self-report** (sleep, legs, health; RPE; feel) | Yes | Yes | The coach's daily decision | Optional | `plans.data` | Yes | Yes |
| **Free-text session notes** | Yes | Yes | Detecting pain/illness/heat signals the numbers do not show | Optional | `plans.data` | Yes | Yes |
| **Strava activity data** (distance, moving/elapsed time, pace, HR, cadence, elevation, temperature, activity type) | **Only when the athlete connects Strava** | Yes | Automatic session logging | Optional; **off by default** — the integration is gated by `VVV_STRAVA_ENABLED` and is currently disabled | `strava_activities.payload`, staged then ingested | Plan data yes; staging rows are transient | Yes, cascade |
| **Strava OAuth tokens** | Yes, if connected | Yes | Fetching the athlete's own activities | n/a | `strava_connections` — **RLS on, zero policies**: unreachable from any browser session, including the athlete's own. Service key only | **No, deliberately** — a token is not the athlete's training data and must not travel in an export | Yes, cascade; also deauthorised with Strava on delete |
| **Subscription state** (state, tier, access_until, override) | Yes | Yes | Access decisions | n/a | `entitlements` | Yes, summarised — provider customer/subscription ids are deliberately excluded | Yes, cascade |
| **Delivery session** (opaque lease id, timestamps) | Yes | Yes | Serving the protected runtime | n/a | `access_leases` — RLS on, zero policies. Cookie carries an opaque id and nothing else | No | Yes, cascade; revoked on sign-out |
| **On-device storage** (the whole plan, a session snapshot with Supabase tokens, archived plans, theme/units) | Stays on the device | n/a | Offline-tolerant local operation | n/a | `localStorage` — **excluded from Android backup and device transfer** (`allowBackup="false"`) | In-app JSON backup, plus native share sheet | "Reset Plan" clears it; account deletion deliberately leaves it, and says so |

## Not collected

| | |
|---|---|
| Precise or coarse **location** | No location permission on either platform. Distance is typed in or comes from Strava server-side |
| **Advertising identifier** | None. No ads |
| **Analytics / usage telemetry** | None. No SDK |
| **Crash / diagnostic data** | None. No crash reporter. Server logs carry booleans, hostnames and status codes — `diagLine()` is asserted never to contain an address |
| **Contacts, photos, camera, microphone, calendar, Bluetooth** | No permission requested on either platform |
| **Health / fitness platform data** | No HealthKit, no Health Connect, no `ACTIVITY_RECOGNITION`, no `BODY_SENSORS` |
| **Payment information** | **None today.** Billing is unconfigured and `VVV_COMMERCIAL_REQUIRED` is off. If payment is added, the provider collects it — card data must never reach Valhalla, and the entitlement row is designed to hold opaque provider references only |
| **Push tokens** | None. There is no push service; the reminder is a local Web Notification, which a WebView does not implement (see `STORE-READINESS.md` §6) |

---

## Sensitive-category note

Heart rate and self-reported health signals ("felt ill", "sharp pain in my
knee") are **health-adjacent data**, and both stores have a specific category for
it. Declare it honestly:

- **Play Data Safety** → *Health and fitness* → *Health info* and *Fitness info*:
  collected, linked, not shared, optional, deletable.
- **Apple App Privacy** → *Health & Fitness*: **Linked to You**, used for **App
  Functionality** only. Not for tracking, not for advertising, not for analytics.

Do **not** declare it as *Sensitive Info* in the Apple sense (that category is
racial/ethnic, sexual orientation, religious, biometric, political). Heart rate
and a note saying a knee hurts belong in Health & Fitness.

Valhalla makes **no medical claim** about any of it — the non-medical boundary is
enforced and tested (`test/medicalBoundary.test.js`, 43 tests). Store copy must
not describe the app as diagnosing, clearing or medically assessing anyone.

---

## Retention

| Event | What happens to the data |
|---|---|
| Sign out | Cloud copy untouched. Local plan stays on the device, deliberately, and the athlete is told so. Delivery lease revoked |
| Trial/subscription expiry | **Nothing is deleted.** Access is refused; `plans` is untouched. Export, deletion, account management and legal pages stay reachable — asserted as a test |
| Cancellation | Same. `endsAccessNow()` revokes live leases; no training data is touched. Billing cannot write to `plans` at all |
| Account deletion | Server-side data removed by cascade. The device copy remains, and the confirmation dialog says so before the athlete confirms |
| Beta revocation | Cloud access ends at the next request; **data is not deleted** — "stop this person using the beta" and "erase this person" are two separate operations on purpose |
