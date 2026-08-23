# Phase 2 — web billing and trial activation

Stripe as the first billing-provider adapter to the commercial core that
[COMMERCIAL-CORE.md](COMMERCIAL-CORE.md) describes. Nothing in this phase makes
Stripe the commercial authority, adds a second entitlement system, or changes
what the resolver decides. It adds the rail, closes the gaps between the rail
and the core, and stops at the point where a human has to create things in a
Stripe account.

**Commerce is OFF.** `VVV_COMMERCE_ENABLED` and `VVV_COMMERCIAL_REQUIRED` are
both unset, no migration has been applied, no Stripe object exists, and no
identifier in this repository is real.

---

## The vocabulary boundary

The single most load-bearing decision in this phase, restated because getting it
wrong later is a migration of every subscription row.

**The provider is `web`. Stripe is never a provider value.**

The provider axis answers *which commercial rail did this arrive on* — `web`,
`apple`, `google` — because that is the axis the product, the entitlement
resolver and the store-policy rules turn on. Stripe is the processor *beneath*
the web rail, not a peer of the App Store. An athlete who paid by card on a
website has bought the same thing whoever processed it, and changing processor
must not be a data migration.

Everything Stripe-shaped stops in `api/_stripe.js`.

### What Stripe says → what Valhalla records

| Stripe | Valhalla `condition` | Note |
|---|---|---|
| `trialing` | `trialing` | access to `trial_end` |
| `active` | `active` | |
| `past_due` | `past_due` | see *paid-through* below |
| `unpaid` | `past_due` | same thing later in the dunning cycle |
| `incomplete` | `past_due` | the first payment never completed |
| `incomplete_expired` | `expired` | |
| `canceled` | `expired` | …unless disputed, below |
| `paused` | `past_due` | **not** our pause. Stripe's `paused` status means a trial that ended with no payment method, which is a payment problem. Valhalla's pause is `pause_collection` plus our own `paused_at` / `pause_resumes_at` window, and the subscription status does not change while it runs. |
| anything else | *refused* | `conditionOf()` returns null and the event is dropped and recorded. An unmapped status must never be guessed into one that grants access. |

Two conditions have no Stripe status behind them and are reached from a field
rather than from the enum:

- **`revoked`** — `cancellation_details.reason === 'payment_disputed'`. A
  dispute or chargeback outranks every date on the row, because a refunded
  subscription whose period ends next month must not keep granting for a month.
  `cancellation_requested` and `payment_failed` are ordinary endings and stay
  `expired`.
- **`cancelled`** — never written from a Stripe event. Stripe expresses "will
  not renew" as the boolean `cancel_at_period_end`, which is mirrored as-is.
  `cancelled` exists in the vocabulary for providers that express it as a state.

### Other fields

| Valhalla column | Stripe source |
|---|---|
| `provider_subscription_id` | `subscription.id` |
| `provider_customer_id` | `subscription.customer` |
| `account_id` | `metadata.vvv_account_id`, falling back to `client_reference_id` — **both set by us at checkout, never read from a request body** |
| `offer_code` | `metadata.vvv_offer`, falling back to the price's recurring interval |
| `billing_period` | `metadata.vvv_period`, same fallback |
| `trial_start` / `trial_end` | the same fields, seconds → ISO |
| `current_period_start` | `current_period_start` |
| `current_period_end` | **paid-through**, see below — *not* a verbatim mirror |
| `grace_period_end` | **always null.** Stripe's subscription object carries no retry deadline, so the web rail has no provider grace. Written explicitly rather than left unset, so "no grace" is a recorded fact rather than a missing one. |
| `agreed_price_minor` / `agreed_currency` / `catalogue_version` | **not from Stripe.** Read from `api/_products.js` and locked once under a `price_locked_at IS NULL` filter. Stripe reports what it will charge, which is the same number today and not necessarily the same fact. |
| `environment` | derived from the key shape: `sk_live_` → `production`, anything else → `sandbox` |

### `current_period_end` is paid-through, and Stripe's is not

Stripe defines `current_period_end` as the end of the period the subscription
has been **invoiced** for. Those are the same instant while invoices are being
paid, and they come apart the moment one is not: at renewal Stripe raises the
next invoice, advances the period, attempts the card, and moves the subscription
to `past_due` when the attempt fails.

A row mirrored verbatim then carries a period end a month in the future that
nobody has paid for — and the resolver's *"a card that fails on day two of a
paid month does not end the month"* branch reads it as paid. That is Valhalla
inventing grace again, arriving through the mirror instead of through a
constant. The architecture recovery deleted seven invented days; this would have
been thirty, on every failed renewal, automatically.

`paidThroughOf()` in `api/_stripe.js` translates it: a `past_due` or `unpaid`
subscription reports the **start** of the unpaid period as its end, because the
last period anybody actually paid for ended when this one began.

**Why this is safe even if Stripe does not advance the period.** If the period
had not advanced, the invoice covering it is the one that was paid — and a
subscription whose current invoice is paid is not `past_due`. Valhalla sells one
price with no add-ons, no metering, no prorations and no plan switching, so
there is no second invoice that could fail mid-period. Both readings reach the
same answer.

**If a mid-period invoice is ever introduced** — an add-on, a proration, an
upgrade — `paidThroughOf()` is the function that has to learn the difference,
because from then on `past_due` no longer implies the current period is unpaid.

This is nevertheless **owner verification item 1** below: it is reasoning about
another company's system, and reasoning is not evidence.

---

## Schema

**Phase 2 requires no new migration.** Every column the web billing code writes
already exists in SQL committed to this repository. What it requires is that
those files have been **applied**, and two of them have deliberately not been.

Run [`supabase-web-billing-verification.sql`](supabase-web-billing-verification.sql)
to find out. It is read-only — no `INSERT`, `UPDATE`, `DELETE`, `CREATE`,
`DROP`, `ALTER` or `GRANT` anywhere in it — so it needs no approval, and every
column heading names the value that means ready.

| Needed by | File | Status |
|---|---|---|
| the four core tables and their unique indexes | `supabase-commercial-core.sql` | applied (production shows `account_commercial` and `admin_beta` grants) |
| `agreed_price_minor`, `agreed_currency`, `price_locked_at`, `catalogue_version`, `paused_at`, `pause_resumes_at`, `last_pause_started_at` | `supabase-trial-via-provider.sql` | **unverified — check before launch** |
| the operational view reading the trial from `subscriptions` | `supabase-operational-view-provider-trial.sql` | **unverified** |
| the signup auto-grant being gone | `supabase-retire-legacy-beta-autogrant.sql` | **unverified, and required** |
| public signup, and paying customers reaching their own plans | `supabase-commercial-activation.sql` | **deliberately not applied. Requires HQ approval and an explicit edit.** |

### The two that close the product

Both fail in the direction of *looks fine, sells nothing*, and neither is
something this phase may apply on its own.

**`supabase-retire-legacy-beta-autogrant.sql`.** A trigger on `auth.users` gives
every new account `entitlements.override = 'beta'`. `resolveAccess()` checks the
override *before* any commercial rule, so while it lives, every athlete who
signs up is granted permanent free access and never meets a trial, a preview
gate or a paywall. The front door cannot be opened while it exists. The file
refuses to run unless every current `override='beta'` holder also holds a
canonical `admin_beta` grant, so it cannot take a tester's access away — section
6 of the verification script is that same query, run in advance.

**`supabase-commercial-activation.sql`.** `beta_allowlist_gate` is a
`BEFORE INSERT` trigger on `auth.users` that raises `42501` for any address not
on the allowlist: a paying customer cannot create an account at all. The
ownership policies on `plans` and `strava_activities` read
`auth.uid() = user_id AND is_beta_approved()`, so a customer who paid and is not
on the allowlist is refused their own training data and the app falls back to
local-only with an error they cannot act on.

That file **refuses to run** until a human edits `STEP 0` from `'no'` to
`'yes'`, because running it is the act of opening the product to the public.
That is HQ's decision and it is not being made here. **STOP: it requires
explicit approval before it is applied to production.**

---

## What was found and fixed

Seven things, in the order they would have bitten.

1. **`/api/checkout` could never sell anything.** It called
   `mayStartStandardPurchase()` without naming a provider. That rule validates
   the provider before it looks at a single subscription, so an unnamed one came
   back `unknown_provider` and the decision function turned it into `409` — for
   every athlete, in every configuration. The existing suite exercised the
   decision as a pure function with a purchase check handed to it, so the one
   call site that had to supply the argument was the only thing uncovered.

2. **Every call to it was refused.** `start.html`'s "Start my 14-day trial"
   button already POSTed to `/api/checkout` — and always got `409`, because of
   defect 1. The account shell meanwhile had no path to it at all: its only
   purchase control POSTed `{action:'resubscribe'}` to `/api/subscription`,
   which read a URL out of `VVV_CHECKOUT_URL` and sent the browser there —
   checking no commerce flag, refusing no live key in an uncommissioned
   deployment, validating no offer, never asking whether the athlete already
   subscribed somewhere, and creating no provider customer. A second purchase
   path is a second commercial authority wearing a different hat. It now
   answers `410` and names `/api/checkout`, and the shell renders the offers
   the server says are purchasable.

3. **A failed renewal bought an unpaid month.** See *paid-through* above.

4. **Two writers of the trial allowance.** The webhook issued its own `PATCH`
   against `account_commercial` while `Store.consumeTrialForAccount()` — the
   canonical implementation, tested, with its own race-lost handling — sat
   unused beside it. There is now exactly one, asserted by test.

5. **A beta tester who also subscribed was described wrongly.** The projection
   read `state` off the overall resolution reason, and an open-ended beta grant
   reaches furthest, so a tester's trial projected as `state='active'` and their
   screen said *"Active until…"* during a fortnight that was a trial. Nobody's
   access changed; `state` now describes the commercial source it is about.

6. **A purchase could be re-pointed at another athlete.** The schema says
   *"account_id is the one column that is OURS, and it is never written from a
   provider payload — that is what stops a crafted webhook re-pointing somebody's
   purchase at another athlete."* The store's column list says the same. Neither
   was implemented: `normaliseSubscription()` writes `account_id` on every row
   and the upsert merges every column it is handed, so a second event for the
   same provider subscription carrying different metadata moved the purchase.
   One row, no error, and one athlete's card paying for another athlete's
   access. Not browser-reachable — the metadata is ours and changing it needs
   the provider's dashboard — which is exactly why it survived review as prose.
   `upsertSubscription()` now reads the existing owner and refuses a mismatch;
   the event is recorded as `account_mismatch` and answered `200`, because
   redelivering it cannot make it attributable.

7. **The preview answered an athlete's question for a stranger.** After main
   moved the preview in front of authentication, resolving eligibility with no
   uid fails closed — so every anonymous prospect on the acquisition surface
   would have been told there is no free trial. And the other half: reading
   only `trialEligibility()` offered a free trial to an athlete who already
   subscribes, because a paying subscriber has usually never spent their
   allowance. `trialOffer()` separates the offer from the athlete; see the
   contract table below.

And one thing added because the journey needs it: **reconcile**. A webhook is a
notification and notifications are late — queued behind an outage, dropped by a
deployment mid-rollout, arriving after the athlete's browser already came back.
`POST /api/subscription {action:'reconcile', session_id}` treats the session id
as nothing more than a lookup key, fetches the Checkout Session from Stripe
server-side, refuses it if its metadata does not name the authenticated athlete,
and applies the facts through the same `_billing-apply.js` the webhook uses. The
browser never says "I paid".

---

## Contracts for APP and WEBSITE

This phase deliberately did not redesign either surface. What it did was give
them a stable server contract to build against. The one change made to a surface
was the account shell's purchase control, because retiring the second purchase
door left the product with no path to buy at all — it is functional wiring, not
a design, and APP may redesign it freely as long as it keeps to the contract
below.

**`GET /api/checkout`** — public shape for a pricing surface.

```json
{ "catalogue": { "product": { "code": "VALHALLA_STANDARD", "name": "Valhalla Standard" },
                 "trialDays": 14,
                 "offers": [ { "code": "STANDARD_MONTHLY", "billingPeriod": "monthly",
                               "priceMinor": 1199, "currency": "GBP", "trialDays": 14,
                               "available": false } ] },
  "commerce_enabled": false, "provider_configured": false }
```

`available` is honest about configuration. An offer with no provider identifier
is **listed, priced and marked unavailable** rather than hidden — *"£89.99/year,
not open yet"* is information; a missing row is a bug report. Render prices from
this, never from a literal in a page: a price typed into a screen drifts from
the one that will be charged.

**`POST /api/checkout {period}`** → `{ url, period, trial_days }`, or a named
refusal. The refusals a surface must be able to say a sentence for:
`already_subscribed_here`, `already_subscribed_elsewhere` (with
`existing_provider`), `commerce_disabled`, `provider_not_configured`,
`unknown_billing_period`, `not_signed_in`. *"You already subscribe through the
App Store"* is a different screen from *"payments are not open"*.

**`GET /api/subscription`** — everything an account screen needs and nothing
that identifies the athlete to a third party. No provider customer id, no
subscription id, no event sequence. `access`, `reason`, `state`,
`access_until`, `cancel_at_period_end`, `override`, `tier`, `capabilities`,
`locked_capabilities`, `checkout_configured`, `catalogue`,
`management_provider`, `manageable_here`.

`manageable_here` is the one to branch on for a cancel control: false means the
subscription belongs to a store and the athlete must be sent there.

**`POST /api/subscription {action}`** — `reconcile` (with `session_id`),
`cancel`, `reactivate`. All three return the same view shape as `GET`, plus a
`result` field, so a surface never has to make a second request to find out what
changed. `resubscribe` is `410 Gone`.

**What a surface may never do.** Infer entitlement from a checkout redirect, a
query string, or its own storage. The only unlock in the product is `/api/app`
resolving the delivery cookie against the entitlement row, server-side.

### The value-first journey, as the server supports it

```
WEBSITE → BUILD MY PLAN → PLAN BUILDER → POST /api/preview   (no account needed
                                                              beyond sign-in;
                                                              spends nothing)
        → SAVE MY PLAN / AUTHENTICATE
        → POST /api/checkout {period}   → provider
        → return to /account?checkout=complete&session_id=…
        → POST /api/subscription {action:'reconcile', session_id}
        → GET /api/app                  → ENTER VALHALLA
```

**`POST /api/preview`** answers two different questions depending on whether it
knows who is asking, and the payload says which:

```json
{ "preview": { … }, "build": { … },
  "trial": { "available": true, "days": 14, "reason": "anonymous", "resolved": false } }
```

| caller | `available` | `reason` | `resolved` |
|---|---|---|---|
| anonymous | `true` | `anonymous` | `false` |
| signed in, allowance unspent | `true` | `eligible` | `true` |
| signed in, fortnight already used | `false` | `already_used` | `true` |
| signed in, already subscribes | `false` | `already_subscribed_here` / `…_elsewhere` | `true` |
| signed in, core unreadable | `false` | `unavailable` | `true` |

**`resolved: false` means nobody was looked up** — there was no athlete to look
up. It is the public offer from the catalogue, and it is **presentation, not
entitlement**: no commercial table is read for an anonymous caller, and the
answer cannot start a trial, spend an allowance or create a subscription.
Eligibility is re-decided by `mayStartStandardPurchase()` when a checkout is
opened, and the allowance is spent only when a provider says a trialing
subscription exists.

A surface may show *"start your 14-day trial"* whenever `available` is true. On
`false`, `reason` is the sentence to say, and it names **whichever half
blocked it** — "you have already used your free trial" and "you already have a
subscription" are different sentences to different people.

`start.html` does not yet read this field: its trial card is gated on
authentication alone, so a signed-in athlete who has already used their trial,
or who already subscribes, is shown the button and told no only after pressing
it. That is a WEBSITE presentation matter and this contract is what fixes it.
Not changed here — Phase 2 does not redesign WEBSITE surfaces.

---

## The endpoints

Nothing here costs a serverless function. Everything is a module behind the
existing `/api/account` router, which is what the underscore convention is for —
the plan allows twelve and twelve are used.

| Route | Method | Does |
|---|---|---|
| `/api/checkout` | `GET` | the catalogue, and whether it is purchasable |
| `/api/checkout` | `POST {period}` | starts a Checkout Session. **The browser names a period and nothing else** — no price, amount, currency, trial length, customer, tier or entitlement crosses the wire from a client. |
| `/api/subscription` | `GET` | the athlete's own state, for rendering. 200 even with no access. |
| `/api/subscription` | `POST {action:'reconcile', session_id}` | ask the provider what happened |
| `/api/subscription` | `POST {action:'cancel'}` | stop the renewal, keep the paid period |
| `/api/subscription` | `POST {action:'reactivate'}` | undo it before the period ends |
| `/api/subscription` | `POST {action:'resubscribe'}` | **410 Gone.** Use `/api/checkout`. |
| `/api/billing-webhook` | `POST` | Stripe deliveries only. Anything without a `stripe-signature` header is `501`. |

Cancelling stops the renewal. It does not end access, delete anything, or touch
training history — plans, activities, execution records and programme history
are the athlete's and survive every commercial state there is. No file that can
cancel can address the tables that hold them, and that is asserted by test.

---

## Security

| Requirement | How |
|---|---|
| server-side secret use only | the key lives behind a getter on a server module; no page names it, and `JSON.stringify(config())` cannot serialise it |
| verified webhook signatures | Stripe's own scheme over the raw bytes, constant-time, tolerant of a rotation (several `v1` values), five-minute skew |
| replay / idempotency | the event is CLAIMED by an insert against a unique `(provider, provider_event_id)` before anything is applied; a replay answers `200` so the provider stops retrying |
| authenticated athlete binding | the account comes from the bearer token, or from metadata we set at checkout — never from a request body. Reconcile refuses a session whose metadata names anybody else. |
| no client authority over entitlement | the only unlock in the product is `/api/app` resolving the cookie against the entitlement row, server-side |
| no trusting query-string success | the session id is a lookup key; the facts come back from Stripe |
| no price manipulation | the price id is resolved from configuration by offer code; an unset one refuses rather than charging something |
| no secret leakage | provider errors are reduced to a code — Stripe's error bodies echo the request, and the request carries the customer and the price. Identifiers in logs are eight characters and an ellipsis. |
| fail-closed | an unreadable commercial core refuses a purchase; an unrecognised status is dropped; a malformed date refuses; a missing account row is not an unused trial |
| duplicate / out-of-order events | facts, not transitions. A late event restates what the subscription was; `provider_updated_at` records which telling was newer. There is no reducer to get out of step. |

## One trial per athlete

The allowance lives on `account_commercial.trial_consumed_at`, at **account**
level — not per provider, per device or per email address — and it is spent by a
single write filtered on `trial_consumed_at IS NULL`. Two simultaneous
activations both read "eligible"; exactly one `UPDATE` matches a row.

It is spent when a provider says a **trialing subscription exists**, never when
somebody opens Checkout. Reaching the payment screen and changing your mind does
not cost a fortnight.

There is deliberately **no code path anywhere that clears it**, which is
asserted as an absence rather than as the correctness of a reset. The eight
routes the brief names — cancelling, expiry, monthly↔annual, recreating
checkout, deleting and reinstalling, another device, duplicate webhooks,
reconnecting — all arrive at the same write and all find the column already
written. Each is a case in `test/webBilling.test.js`.

---

## The beta cohort

Two live testers, holding `admin_beta` grants and nothing else: no subscription,
no trial, no consumed allowance.

- They keep access when `VVV_COMMERCIAL_REQUIRED` is switched on, through
  `override='beta'`, which `resolveAccess()` checks before any commercial rule.
- Nothing starts a trial for them. Reading their state does not change it.
- Nothing converts them into paid subscriptions.
- If one of them buys, the grant is untouched and both sources resolve together
  — resolution is a fold, so removing either later is safe by construction.
- An operator's `override_note` survives every projection.

The one thing that would hurt them is retiring the legacy auto-grant while
somebody's access exists **only** in the `entitlements.override` column. Section
6 of the verification script lists exactly those accounts, and the retirement
file refuses to run while one exists.

---

## OWNER ACTIONS — the commissioning boundary

Everything below needs a human with access to a Stripe account, the Vercel
project, or the Supabase project. **None of it has been done, and no value in
this repository is real.** No Stripe account id, product id, price id, webhook
secret, API key, production domain or Vercel environment value has been invented
anywhere — `providerRef()` reads them from the environment and returns null when
they are absent, and every caller treats null as *this cannot be purchased yet*.

### 1. Stripe, in test mode first

- [ ] Create the product **Valhalla Standard**.
- [ ] Create two recurring prices: **£11.99/month** and **£89.99/year**, GBP.
      Do **not** put a trial on the Price — the trial is set on the Checkout
      Session (`trial_period_days: 14`) so that one number has one source.
- [ ] Create a webhook endpoint pointing at
      `https://<deployment>/api/billing-webhook`, subscribed to
      `customer.subscription.created`, `.updated` and `.deleted`. Nothing else
      is read; other event types are acknowledged and ignored.
- [ ] Copy the signing secret.

### 2. Vercel environment

| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_…` first. The key shape decides whether rows are recorded as `sandbox` or `production`. |
| `STRIPE_WEBHOOK_SECRET` | the signing secret from the endpoint above |
| `VVV_PRICE_WEB_STANDARD_MONTHLY` | the monthly `price_…` id |
| `VVV_PRICE_WEB_STANDARD_YEARLY` | the yearly `price_…` id |
| `VVV_SITE_ORIGIN` | the deployment origin Checkout returns to. Checkout **refuses** rather than guessing it. |
| `VVV_MARKETING_ORIGIN` | where a cancelled checkout returns to |
| `VVV_COMMERCE_ENABLED` | `1` — **may anyone be charged.** Leave unset until the test-mode pass below is green. |
| `VVV_COMMERCIAL_REQUIRED` | `1` — **is entitlement enforced.** Separate switch, switched on at a different moment: enforcement first with beta overrides in place, selling second. |

A live key with `VVV_COMMERCIAL_REQUIRED` off is refused outright. A
configuration accident involving real money reads as an accident.

### 3. Database

- [ ] Run `supabase-web-billing-verification.sql`. Read every column.
- [ ] Apply anything section 1 or 2 of it reports missing.
- [ ] **Approval gate:** `supabase-retire-legacy-beta-autogrant.sql`, once
      section 6 returns zero rows.
- [ ] **Approval gate:** `supabase-commercial-activation.sql`, after editing
      `STEP 0` to `'yes'`. This opens public signup.

### 4. Verify against Stripe test mode

The repository cannot do any of this. **No end-to-end Stripe checkout has been
proven and none is claimed.**

1. **The paid-through question.** Create a test subscription, let a renewal fail
   (Stripe's `4000 0000 0000 0341` fails on the second charge), and read the
   resulting subscription object. Confirm `current_period_end` advanced past the
   failure. If it did **not**, `paidThroughOf()` needs the mid-period case and
   the reasoning above needs correcting — see item 1 of *Owner verification*.
2. Monthly checkout → card `4242 4242 4242 4242` → confirm a `trialing`
   subscription, `trial_consumed_at` stamped once, entitlement `state='trial'`.
3. Annual checkout on a second test account → same, with `STANDARD_YEARLY`.
4. Abandon a checkout → confirm the allowance is **not** spent.
5. Advance the trial clock in Stripe → confirm conversion to `active` with no
   second decision anywhere.
6. Cancel from `/account` → confirm `cancel_at_period_end`, access continuing to
   the period end, and the athlete's plan still readable.
7. Reactivate → confirm one row, no second trial.
8. Replay a webhook from the Stripe dashboard → confirm `200 already_applied`
   and no second application.
9. Send a deliberately mis-signed delivery → confirm `401` and no row written.
10. Confirm both beta testers still have access throughout, with no trial spent
    and no subscription created for them.

Only after all ten: switch `STRIPE_SECRET_KEY` to a live key, re-create the
products, prices and webhook endpoint in live mode, and re-point the four
identifier variables.

---

## Owner verification — open questions

1. **Does Stripe advance `current_period_end` on a failed renewal?** The
   translation above is safe under both answers for Valhalla's catalogue, and
   the argument for why is written out in `api/_stripe.js`. It is still
   reasoning about another company's system. Verify it (step 4.1) before launch.
2. **Which migrations are actually applied?** Unknowable from here. Section 1–3
   of the verification script answers it in one paste.

## What is proven, and by what

`test/webBilling.test.js` — 59 cases, organised as the verification matrix, run
through the real `/api/account` router against a fake Stripe that answers the
REST shapes the adapter actually sends. A mock of our own calls would pass
whatever we wrote; this fails on the wrong path, method or form body, which is
most of what an adapter can get wrong.

`test/stripeFoundation.test.js`, `test/stripeLifecycle.test.js`,
`test/commercialCore.test.js`, `test/commercialAuthority.test.js`,
`test/providerTrial.test.js`, `test/billingWebhook.test.js` — the parts.

**2211 tests, 0 failures.**

`test/mutation/run.js` — 13 web-billing cases and 29 commercial cases, all
killed. A mutation pass is what proves the tests *would* fail: a guard nothing
detects is a guard that is not there. It found two of the six defects above.

None of them talk to Stripe.
