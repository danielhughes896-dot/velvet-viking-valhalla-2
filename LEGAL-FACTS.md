# Implementation facts for the Website legal pack

This file states **what the system does**, so the legal copy does not have to
guess. It is deliberately not legal prose and makes no legal conclusions.

Every fact below is either enforced by a test in this repository or was proven
on a disposable Postgres 16 cluster rebuilt from the migrations in order. Where
something is not yet true, it says so.

Last reconciled against `main` at the commit that added this file.

---

## 1. Health-indicating data and explicit consent

**What is collected.** The coaching engine holds, per athlete: planned and
completed training sessions, distances, paces, durations, heart rate where a
connected device supplies it, RPE (a self-reported effort score), and free-text
notes the athlete writes. It derives readiness/adaptation signals from those.

**Where it lives.** `public.plans` (the plan document, one row per athlete) and
`public.strava_activities` (objective activity payloads staged for ingestion).
Both are protected by row-level security scoped to the athlete's own id; both
CASCADE-delete with the account.

**Whether it is health data.** Resting/exercise heart rate, HRV where present,
self-reported effort and free-text notes about how training felt are capable of
indicating physical condition. The system treats the whole coaching record as
health-indicating and applies the strictest handling it has, rather than
attempting a field-by-field split — a split that would have to be re-argued
every time a field is added.

**Facts relevant to whether explicit consent is required:**
- The data is supplied by the athlete, for the athlete, to produce their own
  training plan. There is no secondary use.
- It is **never** transmitted to monday.com. See §2 — this is enforced by an
  allow list and a test, not by policy.
- It is **never** transmitted to Stripe. The payment path carries a price id, an
  account uuid in metadata and an email for the receipt. Nothing else.
- It is not sold, shared, or used for advertising, profiling beyond the
  athlete's own plan, or automated decision-making with legal effects.
- There is no analytics warehouse and no event log of athlete behaviour. The
  only behavioural signal retained is a single overwritten timestamp (§5).
- Strava data is ingested only with the athlete's explicit OAuth authorisation,
  at the scope in §8, and is deleted on disconnect.

**Not settled by System, and correctly a legal decision:** whether the consent
already obtained at signup is specific enough to constitute explicit consent for
special-category data, and whether an additional consent step is needed before
first use of the coaching engine. System can add such a step; nothing in the
architecture prevents it.

---

## 2. The exact monday.com payload

Full contract: `MONDAY-OPERATIONAL-CONTRACT.md`.

**What crosses:** an opaque account reference, account created date, last active
date, trial active / ends / started, paid active, billing period, paid through,
commercial state, cancelling flag, cancelled date, paused flag, pause resume
date, access state, access reason, provider rail, admin-grant flag, and a synced
timestamp. Nineteen fields, and that is the complete list.

**The account reference is not the account id.** It is
`VVV-` + 20 hex characters of `HMAC-SHA256(account_id, salt)`, with the salt held
only in Vercel. It cannot be reversed to an account without the salt.

**What never crosses:** email, name, phone, address, date of birth, any training
session, pace, heart rate, RPE, readiness, athlete state, note, coaching
evidence, training history, symptom, injury, weight, HRV, sleep, VDOT, distance,
plan, race, goal, Strava or Garmin data, IP address, user agent, device,
location, card detail, or any Stripe customer or subscription identifier.

**Direction:** one-way. Nothing is read back from monday into any access,
entitlement or billing decision.

**Status:** the contract and the code exist and are tested. The board itself is
not yet created and the sync is **off** (`VVV_MONDAY_OPERATIONAL` unset). Nothing
has ever been sent to an operational board.

---

## 3. Cancellation mechanics

- Cancelling is **always** available and takes effect at the end of the period
  already paid for. Nothing is clawed back and no early-termination charge
  exists.
- **Cancelling during the 14-day trial**: access continues to the end of the
  fourteen days and **no payment is taken**. The subscription simply does not
  renew.
- **Cancelling after conversion**: access continues to the end of the current
  paid month or year. `cancelled` is not `ended` — the period bought is the
  period delivered.
- **Cancelling while paused**: ends the relationship immediately, because no
  period is running and nothing is being collected.
- A cancelled subscription that later ends produces no further charge of any
  kind.
- Cancellation is performed through the payment provider's own management
  surface for the rail the athlete bought on (`web` → Stripe's customer portal).
  Valhalla never holds a card.
- **Refunds are not automated.** A refund is an operator action. A refund
  accompanied by a payment dispute revokes access immediately (§4).

---

## 4. Access states, and what ends access

| State | Means |
|---|---|
| `trial` | inside the 14 days |
| `paid` | inside a paid period |
| `grace_period` | the provider has told us it is retrying until a stated date. Valhalla adds no grace of its own. |
| `paused` | inside a pause window: no billing, no access |
| `expired` | the period ran out, nothing owed |
| `payment_hold` | a payment failed and the paid period is over |
| `revoked` | the provider pulled the purchase — a dispute or chargeback |

**Revocation outranks every date.** A disputed payment removes access
immediately even if the period ran to next year. This comes from Stripe's
documented `cancellation_details.reason = payment_disputed`, and only that
value — an ordinary cancellation or a failed card is not a revocation.

---

## 5. `last_active_at`

**What it is:** one nullable timestamp per account, recording when the athlete
last opened Valhalla. Written when a delivery lease is minted.

**What makes it minimal, as a schema decision rather than a policy note:**
- It is **overwritten, never appended**, so it cannot accumulate into a movement
  or session history by accretion.
- It refuses to write again inside the same hour, so it cannot be used to
  reconstruct a session-by-session timeline.
- It records **no** IP address, user agent, device, location or referrer.
- It lives on `account_commercial` and CASCADE-deletes with the account.

**Why it exists:** it is the only signal distinguishing a subscriber from a
churn risk. It is used for operations, not marketing.

---

## 6. Account deletion and anonymisation

Proven on a fresh cluster against the completed commercial schema. Nine
foreign keys reference `auth.users`:

| Table | On delete |
|---|---|
| `plans` | CASCADE |
| `strava_connections` | CASCADE |
| `strava_activities` | CASCADE |
| `entitlements` | CASCADE |
| `access_leases` | CASCADE |
| `account_commercial` | CASCADE |
| `subscriptions` | CASCADE |
| `entitlement_grants` | CASCADE |
| `billing_events` | **SET NULL** |

**Website can safely state:**
- Deleting an account removes the athlete's training plan, every staged
  activity, any connected-service tokens, their entitlement, their access
  credentials, their commercial account record and their subscription records.
- One category survives: the **billing event ledger**. Those rows are the record
  that a payment provider told us something happened, and they are retained for
  financial and audit purposes. On deletion the account reference and the
  subscription reference on those rows are **set to NULL** — the row remains as
  a record that a transaction occurred, with nobody attached to it.
- The ledger rows contain no name, no email, no address, no card detail and no
  training data. After deletion they contain no identifier that links back to a
  person.
- Deletion is self-service, performed by the athlete from their own signed-in
  session. It is technically impossible to point it at another account: the
  function takes no arguments and every statement in it is scoped to the
  caller's own verified id. An unauthenticated caller cannot execute it at all.
- Deletion is immediate, not queued.

---

## 7. Payment processor facts

- **Processor:** Stripe. Valhalla never sees, receives, stores or transmits a
  card number, a last-four, an expiry or a brand. Checkout is hosted by Stripe.
- **What Valhalla sends Stripe:** a price identifier, the account uuid in
  metadata, and the athlete's email address so Stripe can send the receipt.
  Nothing else. No training data, no health data, no name.
- **What Valhalla stores about the payment relationship:** an opaque Stripe
  customer id and subscription id, the offer bought, the billing period, the
  condition, the period dates, and the agreed price. No instrument data.
- **What Valhalla never does:** construct an amount or a currency for a charge.
  Prices exist only as Stripe price identifiers configured by a human.
- **Live charging is OFF.** No live key is configured and liveness is not
  derived from a key being present.

---

## 8. Strava

- **Scopes requested:** `read,activity:read_all` — and nothing else. `read` is
  the minimum Strava requires to identify the athlete; `activity:read_all`
  is what makes a private activity readable, which is the whole purpose (an
  athlete whose runs are private would otherwise connect successfully and see
  nothing sync). No write scope, no profile scope, no `read_all`.
- **Tokens** live in `public.strava_connections`, which has row-level security
  **on with no policies** — deny-all to every browser role including the
  athlete's own session. Only the server's service key reaches them. A Strava
  token is not reachable from any browser, export or other athlete's session.
- **Refresh** is server-side; the athlete's browser never holds a Strava token.
- **Disconnect** deletes the connection row *and every staged activity*, and
  deauthorises at Strava. Deleting the tokens while keeping the derived payloads
  is neither what "disconnect" means nor defensible under Strava's retention
  terms.
- **Account deletion** removes both, by CASCADE.
- Activities already ingested into the training plan remain part of the
  athlete's own plan document, which is deleted with the account.

---

## 9. Garmin

**The statement that is currently true:** Garmin is not connected, not enabled,
and no Garmin data has ever been received or transmitted. `VVV_GARMIN_ENABLED`
is unset and the integration refuses at the boundary.

Valhalla's side of the integration is built and provider-isolated; Garmin's side
requires approved Developer Program membership and a contract Garmin supplies
only to approved members. Nothing about the blocker is internal.

Website should say Garmin is **not currently available**, and must not describe
it as supported, coming soon with a date, or in beta.

---

## 10. Auth and email processor facts

- **Sign-in is a magic link.** There is no password anywhere in the product: no
  password field, no password reset, no password storage. A test fails if any
  server file grows a password path.
- **Auth processor:** Supabase Auth. It holds the email address, the issued
  link tokens and the session records.
- **Email:** magic links are currently sent by Supabase's built-in mail sender,
  from a Supabase-operated domain, on Supabase's shared rate limits. Moving to a
  branded sender requires an SMTP provider (§ *Exact user-only actions* in the
  System report) — that is a configuration and contract step, not a code change.
- **Public signup is CLOSED.** An address that is not on the beta allowlist
  cannot become an account at all: the refusal is a database trigger on user
  creation, not a UI check.
- One legacy account carries a bcrypt password hash from before sign-in was a
  magic link. No product surface can use it.

---

## 11. The pause

- **Monthly subscribers only.** An annual subscriber has already paid for the
  year; there is no collection to suspend.
- **One to three whole months**, chosen by the athlete.
- **Once per rolling 365 days**, measured from the start of the previous pause —
  not per calendar year, which would allow December and January to be two
  allowances.
- **Access and billing stop together and resume together.** A pause is not a
  free month.
- **It resumes itself** on the stated date. Nothing needs to be pressed and no
  job needs to run — access is derived from whether "now" is inside the window,
  so it cannot fail to expire.
- **No invoice is raised or collected for the paused period, and none is owed
  afterwards.** It is a pause, not a deferral and not a write-off.
- **The price agreement survives a pause unchanged** (§12).
- Cancelling during a pause ends the relationship immediately.

**Status:** the policy and the provider adapter are implemented and tested. The
athlete-facing surface that triggers it is not yet built, so **no pause can be
taken today**. Website must not publish the pause as an available feature yet.

---

## 12. The founding price

- The price an athlete agreed to is stored **on their subscription** as an
  integer amount, a currency and the catalogue version that sold it, together
  with the instant it was locked.
- It is **written once**. The write is conditional on the lock instant being
  empty, so a redelivered or later provider event cannot rewrite it. A catalogue
  price change cannot reach an existing agreement.
- It is **recorded, never billed from.** Stripe bills from its own price object.
  The stored figure is the record of what the athlete was told they would pay.
- **A new subscription after cancellation is a new agreement at the current
  price.** The old agreement ended with the old subscription row.
- **Switching monthly ↔ annual is a new agreement** at the current price for that
  interval, because it is a different offer.
- **A valid pause preserves the agreement**, because a pause does not end the
  subscription row that holds it.

**Status:** implemented and tested end to end. **The claim must not be published
yet** — no athlete has a real agreement recorded, because live charging is off.
It becomes publishable on the day the first real subscription locks a price.

---

## 13. What Website must NOT say yet

- That the pause is available.
- That the founding-price guarantee is in effect.
- That Garmin is supported or coming on a date.
- That signup is open.
- Any price as chargeable today.
