# Garmin Developer Program — everything the application needs

Garmin is **OFF**. Nothing has ever been received from or sent to Garmin, and
the integration refuses at its own boundary until `VVV_GARMIN_ENABLED=1` and
both credentials are present.

This file exists so the application can be submitted and, after approval,
credentials supplied — with no further architecture phase. Valhalla's side is
built (`GARMIN-INTEGRATION.md` has the design); this is the paperwork.

**Apple Health and Samsung Health are explicitly out of scope** and appear
nowhere in this repository or this application.

---

## 1. Integration purpose — the sentence to give Garmin

> Velvet Viking Valhalla is an adaptive running-coaching application. Athletes
> receive a personalised training programme and log what they actually did.
> The Garmin integration does two things: it sends the athlete's scheduled
> workout to their watch so they can run it as prescribed, and it reads the
> completed activity back so the programme can adapt to how the session
> actually went. The athlete initiates the connection, the athlete can end it
> at any time, and nothing is used for any purpose other than producing that
> athlete's own training plan.

**Which Garmin APIs this needs:**

| API | Why |
|---|---|
| **Health API** *(not requested at first pass)* | Not needed for the launch integration. Do **not** request it unless daily wellness data is genuinely wanted — asking for more than the integration uses is how an application gets delayed or refused. |
| **Activity API** | Reads completed activities. This is the read half. |
| **Training API** | Pushes the scheduled workout to the watch. This is the write half. |

If the form forces a single choice, the honest answer is **Activity API +
Training API**.

## 2. Data requested — exactly

**Read from Garmin:**
- activity date and start time
- activity type (to identify runs)
- distance
- moving/elapsed time
- pace, derived from the two above
- average and maximum heart rate — **only for an athlete who has given explicit
  health-and-readiness consent** (see §4)
- cadence and elevation, if supplied

**Written to Garmin:**
- the scheduled workout: its structure, target paces, and the date it belongs on

## 3. Data NOT requested

- daily wellness, steps, stress, body battery, Pulse Ox, respiration
- sleep data
- weight, body composition
- blood pressure or any clinical measurement
- continuous or resting heart rate outside a recorded activity
- location, GPS tracks or route data
- women's health data
- anything about anybody who is not the connecting athlete

## 4. Consent and privacy position

Valhalla treats heart rate as health-indicating and processes it **only** with
the athlete's separate, explicit, affirmative consent — recorded against
`health_data_consent_v1`, default off, withdrawable in one step, and separate
from accepting the Terms. Authorising Garmin is **not** that consent, and is not
treated as it.

The seam is enforced where the row is written. `api/_garmin.js` `ingestGuard()`
strips heart rate before storage for a non-consenting athlete, then **asserts
its own result and throws** if a covered field survived — so the integration
cannot be completed in a way that bypasses the boundary, including by a future
implementer who forgets. Distance, pace, time and cadence import normally
either way.

Garmin data is **never** sent to monday.com or to Stripe. No covered field is
on the monday allow list, and a payload carrying one is refused rather than
trimmed.

## 5. Storage position

- Tokens live in a table with row-level security **on and no policies**, which
  in Postgres is deny-all to every browser role including the athlete's own
  session. Only the server's service key reaches them. Identical posture to
  `strava_connections`, which is proven on a fresh database in the test suite.
- Activity payloads are staged in a per-athlete table under row-level security
  scoped to the athlete's own id.
- No Garmin data is stored anywhere else, exported, or shared.

## 6. Disconnect and deletion

- **Disconnect** deletes the stored tokens, deletes every staged activity
  derived from Garmin, and deauthorises at Garmin. Deleting the tokens while
  keeping the derived data is neither what "disconnect" means to an athlete nor
  defensible under a provider's retention terms.
- **Account deletion** removes both by database CASCADE, along with the plan,
  the entitlement and the consent history.
- **Erasure request**: covered values including Garmin-derived heart rate can be
  removed from an athlete's record while leaving their training history intact
  (`api/_health-erasure.js`).

## 7. Security posture

- OAuth secrets held in the deployment environment only; never in the
  repository, never in a client, never in a log.
- The OAuth `state` parameter is an HMAC over the athlete's id, a nonce and an
  expiry, keyed by the client secret — so a bare callback cannot be replayed at
  an athlete.
- Tokens refreshed server-side; the browser never holds one.
- A rejected refresh **clears the connection** rather than reporting a
  connection that no longer works.
- All traffic over HTTPS. No cleartext anywhere, asserted in the Android
  manifest as well as by platform default.
- No provider error body is ever logged; a code is.

## 8. Callback and webhook needs

| What | Value |
|---|---|
| OAuth callback | `https://app.velvetviking.co.uk/api/garmin?resource=callback` |
| Push/ping endpoint | `https://app.velvetviking.co.uk/api/garmin?resource=webhook` |
| Deregistration endpoint | same host — Garmin requires one; the exact path is fixed at implementation |

Garmin issues the exact contract only to approved members, so these paths are
Valhalla's side of it and may need one line changed to match what Garmin
specifies. That is configuration, not architecture.

## 9. Development vs production

Garmin issues **separate credentials** for the evaluation/sandbox environment
and for production, and production access is granted only after a review of a
working integration. Plan for both:

- evaluation credentials → a Vercel **preview** deployment
- production credentials → the production deployment

The code already records which billing/provider environment a row came from, so
sandbox and production data are distinguishable rather than guessed at from
identifier shapes.

## 10. Company and app details the form asks for

| Field | Answer |
|---|---|
| Application name | Velvet Viking Valhalla |
| Company | *(the registered entity — user supplies)* |
| Website | `https://velvetviking.co.uk` |
| Application URL | `https://app.velvetviking.co.uk` |
| Platforms | Web, Android (Google Play). iOS not at launch. |
| Category | Health & Fitness / Running |
| Distribution | Public, subscription |
| Expected user volume | *(user supplies — be honest and small; an inflated number invites scrutiny)* |
| Privacy policy URL | `https://velvetviking.co.uk/privacy` |
| Terms URL | `https://velvetviking.co.uk/terms` |
| Support/contact | `support@velvetviking.co.uk` |

**The privacy policy must be live and must mention Garmin before the
application is submitted.** A reviewer checks. It currently must not claim
Garmin is available — the correct wording is that Garmin *may be* connected by
the athlete, described in future/optional terms, and Website's legal pack is
where that lands.

## 11. Evidence a reviewer may ask for

- screenshots of the connect screen, the disconnect control, and where the
  athlete is told what is read
- a description of where Garmin data appears in the product (the training log
  and the adaptation the coach makes from it — nowhere else)
- confirmation that data is not sold, shared or used for advertising

## 12. Credentials Garmin will issue, and where each goes

| Issued | Goes to | Vercel variable |
|---|---|---|
| Consumer Key | app deployment | `VVV_GARMIN_CLIENT_ID` |
| Consumer Secret | app deployment, **secret** | `VVV_GARMIN_CLIENT_SECRET` |
| *(then, and only then)* | | `VVV_GARMIN_ENABLED=1` |

Until all three are set the integration refuses at its boundary and the product
says Garmin is unavailable. There is no partial state.

---

## The statement that is true today

> Garmin is not currently available.

Not "supported". Not "coming soon" with a date. Not "in beta". Nothing about
Garmin may be published until credentials exist and the switch is on.
