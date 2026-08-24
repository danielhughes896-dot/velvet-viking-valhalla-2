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

**Whether it is health data.** Heart rate, the morning readiness answers, how a
session felt, and body/sleep readings derived from free-text notes are capable
of indicating physical condition.

**Two different boundaries, deliberately.** *Storage and handling* stay uniform:
the whole coaching record gets the strictest handling the system has — own-row
RLS, CASCADE deletion, no third-party transmission — because a field-by-field
storage split would have to be re-argued every time a field is added.
*Processing under explicit consent* is narrow and named, because the opposite
error is real: disabling ordinary training data would take away the product the
athlete came for, for no privacy gain. §1a is that list.

**Consent mechanism: implemented.** See §1a. The open question this section
previously carried — whether an additional, separate consent step was needed —
has been answered in the product rather than left to policy.

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

---

## 1a. The health and readiness consent mechanism

Consent version identifier: **`health_data_consent_v1`**. Consent is recorded
against this identifier, not against screen wording. If the material purpose
changes, the identifier changes and every stored agreement to the old one stops
counting — enforced by a version comparison that fails closed, so no migration
or backfill is involved.

**The wording the athlete sees**, verbatim and in one place in the code
(`HEALTH_CONSENT_COPY`):

> **Use my health and readiness information**
>
> If you choose to share things like heart rate, sleep, aches, pain, illness or
> how a session felt, Valhalla can read how you are responding to training and
> adjust your programme around it.
>
> Valhalla works without any of it. Your paces, distances and sessions are
> enough to run your programme. You can change your mind at any time in
> Settings.
>
> *(Settings adds:)* Withdrawing stops Valhalla using this information from that
> moment on. It does not undo anything it was lawfully used for before.

**Covered — processed only with consent:**
- heart rate: session average, per-lap and per-segment, and max HR, from any
  source (typed, Strava, file/CSV import, and Garmin when it exists)
- the athlete's LTHR and max-HR profile values, and every target HR range
  derived from them
- the morning readiness answers: legs, sleep, health
- session "feel"
- readings the notes parser derives about the body or sleep — pain, niggle,
  illness, soreness, stiffness, heavy legs, tiredness, fresh legs, poor/good
  sleep, life stress

**Not covered — ordinary training data, unaffected:** distance, pace, time,
splits, completion, RPE, benchmarks, race results, pace zones, plan history,
adherence, streaks, execution scores, and the text of the athlete's own notes.

**RPE is deliberately outside the boundary** — see "Remaining legal decisions"
below.

**Where consent is asked.** One unticked checkbox in the plan builder, on the
same panel as the LTHR/Max HR fields and above them. An athlete who already had
a plan when this shipped is asked once, on Today, by a card with two real
buttons. Neither is a modal and neither blocks anything.

**What is never inferred as consent:** accepting the Terms, creating an
account, starting or paying for a trial, entering a heart rate, connecting
Strava, or reaching the end of onboarding. Leaving the builder box unticked is
recorded as a decision *not* to consent, which is why the athlete is not asked
again.

**Where the commercial agreements are recorded.** `public.account_agreements` —
append-only, one row per decision (`user_id`, `agreement_type`,
`agreement_version`, `decision`, `surface`, `privacy_version`, `offer_code`,
`decided_at`, `created_at`). Two types and only two: **`terms`**, acceptance of
the published Terms; and **`immediate_start`**, the acknowledgement that the
athlete is asking Valhalla to begin the service inside the statutory
cancellation period for a distance contract. RLS allows the athlete to SELECT
and INSERT their own rows only; there is no UPDATE and no DELETE policy, so the
history cannot be rewritten by the person it describes.

This table is **not** where health consent lives, and privacy is **not** an
agreement in it. A privacy notice is information rather than a decision, so the
version presented alongside an accepted Terms is recorded as context on that
row and nothing is ever "consented to". Marketing consent does not exist.

The immediate-start wording is versioned (`immediate_start_v1`) for the same
reason consent is: it is currently HQ's business draft, and a solicitor's
revision becomes `immediate_start_v2`, at which point every athlete is asked
again at their next checkout and the v1 evidence stays exactly as it is.

**Where consent is recorded.** `public.health_data_consent` — append-only, one
row per decision (`user_id`, `decision`, `consent_version`, `decided_at`,
`created_at`). RLS allows the athlete to SELECT and INSERT their own rows only;
there is no UPDATE and no DELETE policy, so the athlete cannot rewrite their own
consent history. The device also holds the current record (decision, version,
granted_at, withdrawn_at) so the gate works offline.

**How it is withdrawn.** One switch in Settings → Health & Readiness, the same
control in both directions, no confirmation step.

**Effect of declining.** Valhalla remains fully usable. The two covered input
controls (Avg HR, Feel) and the readiness block are not shown, with one line
saying why; every other control is unchanged. Sessions are still scored — the
Execution Score re-normalises over the components present, so withholding heart
rate produces exactly the score an athlete who never owned a strap receives, and
confidence is likewise unaffected. Absence is never read as poor readiness.

**Effect of withdrawal.** Covered information stops reaching any adaptation
decision immediately, and stops being collected: typed, imported and
provider-delivered heart rate are all refused, and the LTHR/max-HR profile
values are cleared. Subscription, account, plan and training history are
untouched.

**Historical covered values.** Retained but inert — excluded from every
computation while consent is absent, and never deleted by withdrawal. See
"Remaining legal decisions".

**Strava.** Provider authorisation is not Article 9 consent. Without consent,
`hr` and `maxHR` are stripped **before** the activity row is written to
`strava_activities`, so they are never stored rather than stored and ignored.
Distance, pace, cadence, elevation and timing import normally.

**Garmin.** Off, and unchanged by this work. The ingest seam carries a guard
(`ingestGuard`) that applies the same strip and then throws if a covered field
survives it, so the integration cannot be completed in a way that bypasses the
boundary.

**Manual imports.** File and CSV imports go through the same rule.

**monday.com.** No covered field is on the allow list, and a payload carrying
one is refused rather than trimmed. The consent record itself is not sent.

**Stripe.** No covered field, and no consent record, appears anywhere in the
billing path.

**Existing athletes.** Not retrospectively consented. An account with no consent
record — which is every account that predates this — reads as *un-asked*, which
is distinct from *declined* and produces no consent. Their plan, history and
programme continue unchanged.

---

**Decisions HQ has now taken, and the code matches them:**

1. **RPE stays OUTSIDE the boundary.** Rating of perceived exertion is ordinary
   training-effort and execution evidence: it measures how hard prescribed work
   felt relative to the prescription, and it is what the engine falls back to
   for load when heart rate is absent. It is processed for every athlete,
   consented or not. It is named in the runtime's own not-covered list and in
   the erasure module's, and a test fails if it moves.
2. **"Life stress" stays INSIDE the boundary.** It is included conservatively,
   on the basis that it can indicate mental health. It is the one item on the
   covered list that is there by caution rather than by obvious necessity, and
   that is the deliberate direction to be wrong in.
3. **Withdrawal does not delete history.** Withdrawing consent stops future
   collection and use immediately; covered values already logged are retained
   and become inert — excluded from every adaptation, coaching decision, target
   and longitudinal reading while consent is absent. Ordinary training history
   is unaffected. No new lawful basis is invented to keep processing them: they
   are not processed at all.

**Erasure is a separate right, and is supported separately.**

Withdrawal of consent is not by itself a request for erasure, and the two are
implemented as the different things they are. Where erasure of the covered
values is legally required, `api/_health-erasure.js` performs it:

- It removes `setup.lthr`, `setup.maxHR`, every day's `readiness`, and every
  day's logged `hr` and `feel` from the plan document, and `hr` and `maxHR` from
  every staged provider activity.
- It removes **nothing else**. Distances, paces, times, splits, RPE, the
  athlete's own note text, benchmarks, race results, adherence and the whole
  programme history are untouched — and that is not a promise, it is a check:
  the run compares before and after and **refuses** if anything was added,
  changed, reordered, shortened, or removed that is not a named covered field.
- The **consent record survives** an erasure. It holds no value about the
  athlete's body, and destroying it would remove the evidence that the
  processing which already happened was lawful at the time.
- It is an **operator action**, not a button. There is no endpoint, nothing
  routes to it, and a test fails if anything imports it. An erasure request is
  assessed by a person and carried out by a person. An irreversible deletion one
  mis-click away from an athlete who meant to *withdraw consent* is exactly the
  confusion the split between the two exists to prevent.
- It offers a **dry run by default**, reporting exactly what would be removed
  before anything is.

**Account deletion** remains the complete route: it removes the plan, every
staged activity, the connection tokens, the entitlement, the leases, the
commercial record, the subscriptions **and the consent history**, by CASCADE.

**Still not settled by System, and correctly a legal decision:** whether the
consent obtained at signup is specific enough for special-category data on its
own, and whether the separate health-and-readiness consent described here
discharges that. System has implemented the separate consent; whether it is
sufficient is not System's call.


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

Proven on a fresh cluster against the completed commercial schema. Ten
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
| `health_data_consent` | CASCADE |
| `account_agreements` | CASCADE |
| `billing_events` | **SET NULL** |

**Website can safely state:**
- Deleting an account removes the athlete's training plan, every staged
  activity, any connected-service tokens, their entitlement, their access
  credentials, their commercial account record, their subscription records and
  their health-and-readiness consent history.
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
