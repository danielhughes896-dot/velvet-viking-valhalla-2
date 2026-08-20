# Valhalla commercial core

The provider-neutral foundation that web billing, Apple StoreKit and Google Play
Billing all feed. It sells nothing. It charges nothing. It starts no trial.

Everything below is implemented and tested; nothing in it depends on a payment
provider existing yet.

---

## The one rule

**Account ≠ Subscription ≠ Entitlement.**

| | what it is | where it lives | mutable? |
|---|---|---|---|
| **Account** | an athlete | `auth.users.id` | never — the uuid is the identity |
| **Subscription** | a purchase, mirrored from the provider that owns it | `public.subscriptions` | the provider changes it; we mirror |
| **Entitlement** | may this athlete use Standard *right now* | **nowhere — derived** | recomputed on every read |

Collapsing any two of these is the mistake the whole design exists to prevent.

```
ATHLETE ACCOUNT                      auth.users.id
      ↓
PURCHASE / SUBSCRIPTION              subscriptions   +   entitlement_grants
      ↓                              (bought)            (given)
ENTITLEMENT                          derived by resolveStandardEntitlement()
      ↓
VALHALLA ACCESS                      the delivery gate in _access.js
```

**Email is never any part of this.** It is mutable, it is not an identity, and
no table in the commercial schema has an `email` column. An athlete who changes
their address keeps their subscriptions, their trial history, their plans, their
completed sessions and their integrations, because none of those were ever
attached to the address.

---

## The product

One product. Two ways to pay for it.

| | code | period | price | trial |
|---|---|---|---|---|
| product | `VALHALLA_STANDARD` | — | — | 14 days |
| offer | `STANDARD_MONTHLY` | monthly | £11.99 | 14 days |
| offer | `STANDARD_YEARLY` | yearly | £89.99 | 14 days |

`api/_products.js`.

**Entitlement is keyed on the PRODUCT, never on an offer and never on a price.**
A yearly subscriber and a monthly subscriber have identical access. Adding a
quarterly offer, changing a price or running a regional promotion touches that
one file and nothing downstream.

Prices are recorded in **integer minor units** so money never passes through a
float, and they are **display only** — the provider charges, and the provider's
amount is the true one. Nothing in the entitlement path branches on a price.

**There are no provider identifiers in the repository.** No Stripe price id, no
App Store product id, no Play base plan id. Those are created by a human in a
provider console, and inventing plausible ones now would produce a catalogue
that looks configured and sells nothing. `providerRef(provider, offer)` reads
them from the environment:

```
VVV_PRICE_WEB_STANDARD_MONTHLY
VVV_PRICE_APPLE_STANDARD_YEARLY
VVV_PRICE_GOOGLE_STANDARD_MONTHLY
```

An unset variable makes the offer **unpurchasable**, not "purchasable with a
placeholder". Fail closed.

---

## Subscriptions

`public.subscriptions`. Many per account, over time and across providers.

**Who owns what.** Every column except `account_id` is a *mirror* of a fact the
provider owns. We never invent a period end, never extend a trial, never decide
a subscription renewed. When we disagree with the provider, the provider is
right and a reconciliation overwrites us.

`account_id` is the one column that is **ours**, and it is deliberately absent
from `SUBSCRIPTION_COLUMNS` — the list a provider payload may write. That is
what stops a crafted webhook re-pointing somebody's purchase at another athlete.

### The lifecycle vocabulary is ours

Six conditions, normalised at each provider adapter. No provider's enum ever
reaches the resolver.

| condition | meaning |
|---|---|
| `trialing` | introductory period running |
| `active` | paid, auto-renewing |
| `cancelled` | auto-renew off; **the paid period is still running** |
| `past_due` | payment failed; access depends on a **provider-supplied** grace end |
| `expired` | period over, nothing owed, no access |
| `revoked` | provider pulled it — refund, chargeback, fraud |

Stripe's `past_due`, Apple's billing-retry and Google's `SUBSCRIPTION_ON_HOLD`
all arrive as `past_due`.

**There is no `grace` condition.** Grace is `grace_period_end`, a timestamp the
provider supplies. Making it a state would let a bug put an athlete into grace
forever with no provider fact behind it.

Uniqueness is `(provider, provider_subscription_id)` — the provider's own
identity for the purchase, and the only thing stable across redeliveries. That
is what makes an upsert from a redelivered event land on the same row.

**No card data anywhere.** Not a PAN, not a last-four, not an expiry, not a
brand. The provider holds the instrument; we hold an opaque customer id at most.

---

## Entitlement grants

`public.entitlement_grants`. Access that was **given** rather than bought:
`admin_beta`, `admin_comp`.

**Why these are not subscriptions.** A beta tester is not a customer on a
strange price. Writing them into `subscriptions` would put fiction into every
revenue question anyone ever asks, and would consume the introductory trial of
somebody who has bought nothing.

**Why a table and not a column.** An athlete can legitimately hold more than one
source at once — a beta grant *and* a new paid subscription during the
changeover. With one override column, removing either takes access away. With
rows, resolution folds over what remains and removing one grant is safe **by
construction**, not by a rule someone has to remember.

Revocation is a timestamp, never a delete. A partial unique index on
`(account_id, source) where revoked_at is null` permits one live grant of each
kind, which is what makes the beta migration idempotent.

Grants are issued through the **existing** owner boundary — `VVV_OWNER_USER_ID`
plus a token verified against Supabase, the same one `admin-user.js` and
`strava-admin.js` use. There is no second notion of "admin" in this codebase.

---

## Effective entitlement resolution

`resolveStandardEntitlement()` in `api/_entitlement.js`. **The** canonical
decision. Pure function of `(facts, now)` — no network, no clock, no
environment, so every boundary is testable.

Resolution is a **fold, not a priority list**. Every source is evaluated
independently and access is the union: if any source grants, access is granted.

Returns:

```js
{ active, product, reason, validUntil, commercialState, managementProvider, sources }
```

| reason | when |
|---|---|
| `trial` | trial running |
| `paid` | inside a paid period, including a cancelled one |
| `grace_period` | inside the provider's retry window |
| `admin_beta` / `admin_comp` | an administrative grant |
| `none` / `expired` / `payment_hold` / `revoked` / `invalid` | refusals |

`validUntil` is the furthest-reaching granting source; **`null` means
open-ended and wins**, so an indefinite comp grant is never expired by a dated
subscription. `reason` belongs to that same furthest source — it is what the
athlete will still be relying on tomorrow.

### Lifecycle semantics

- **Cancel during trial** — access continues to the trial end, then stops
  unless another source grants.
- **Cancel a paid subscription** — cancellation stops *renewal*. Access runs to
  `current_period_end`. Taking the product away when somebody clicks cancel is
  both wrong and the fastest route to a chargeback.
- **Payment failure** — access continues through the **provider's**
  `grace_period_end`. **Valhalla adds no grace of its own**: a `past_due` row
  with no provider grace end grants nothing. A failure *inside* an already-paid
  period does not end that period.
- **Expiry** — entitlement goes inactive. The account, the plans, the completed
  sessions and the integrations all remain.
- **Reactivation** — a later subscription against the *same* account id
  restores Standard. No new identity, no fresh coaching onboarding.
- **Revoked** — beats every timestamp on the row.

### Derived product-facing state

`derivedCommercialState()` → `none | trial | paid | cancelled_active | expired`.

**Authority ordering**, stated once and tested:

1. A commercial subscription **granting access right now** decides the state,
   and its own condition names it (`trialing`→`trial`, `cancelled` in
   period→`cancelled_active`, `active`/`past_due`→`paid`).
2. Otherwise, if the account has *ever* had a commercial subscription →
   `expired`.
3. Otherwise → `none`.

**Administrative grants do not appear here.** A beta tester's commercial state
is `none` — they have bought nothing — while their entitlement is *active*.
Those are different questions, and that pair is exactly what a single
`user_status` column cannot represent without lying about one half of it.

Nothing is stored, so nothing can drift. There is deliberately no
`user_status` column anywhere, and a test asserts one has not appeared.

---

## Trial eligibility

**One introductory trial per athlete, across every provider.**

The allowance lives on `account_commercial`, at **account** level — not on a
provider's record of it. Apple does not know about a trial taken on the web,
Google knows about neither, and an athlete who could take one of each would get
six weeks free by changing which button they press.

- Account creation records the allowance as **unused**. It does not start a
  trial, and the signup trigger is asserted to write no trial timestamp.
- A **beta or comp grant does not consume it.** A tester who later subscribes
  still gets their fourteen days.
- The **migration does not consume it.** Every migrated beta athlete keeps it.
- There is **no reset** anywhere in the application. A trial you can reset is a
  trial you can farm.

Consumption is guarded twice:

1. `E.consumeTrial()` refuses when the account row already records one — this
   makes a *replayed* activation obviously correct;
2. the UPDATE carries `trial_consumed_at=is.null` in its filter — this makes two
   *simultaneous* activations safe. The first matches the row; the second
   matches nothing and is told the allowance is gone.

A test drives two genuinely interleaved activations and asserts exactly one
consumes it.

---

## Duplicate purchase prevention

`mayStartStandardPurchase()`. **One** server-side answer that every future
checkout asks — web, StoreKit, Play Billing — so the rule is not re-implemented
in three clients that drift apart.

The failure it prevents: an athlete subscribes on the web, later installs the
iOS app, does not realise they already subscribe, and buys again. Now they pay
twice, only one is cancellable from where they are looking, and the refund goes
through a provider we do not control.

| | |
|---|---|
| **blocks** | any commercial subscription currently granting access, on **any** provider, including one in provider grace |
| **does not block** | an expired subscription (legitimate reactivation), a revoked one, an administrative grant |

`reason` distinguishes `already_subscribed_here` from
`already_subscribed_elsewhere` so a client can say the right sentence. The
response also carries the trial verdict, so a client cannot accidentally offer a
second free fortnight.

Fails closed: if the datastore cannot be read, the purchase is refused.

`allowExceptional` is a documented door for provider migration. **The workflow
is not built** — the parameter exists so the future one has a door rather than a
reason to weaken the rule.

---

## Provider event idempotency

`public.billing_events`, unique on `(provider, provider_event_id)`.

Every provider redelivers. A webhook retries until it gets a 2xx; an Apple
notification arrives again because the first response was slow; a Google RTDN
comes back because a Pub/Sub ack was lost. Applying one event twice is how a
single payment becomes two months of access.

A handler **claims** an event by inserting it. The database decides who won,
because the database is the only participant that sees both requests. A
collision returns `{ claimed:false, duplicate:true }` and the correct response to
the provider is **200** — an endpoint that answers 500 to a duplicate receives
that duplicate forever.

`environment` (`production` | `sandbox`) is recorded from the first row. Sandbox
and production notifications are indistinguishable once the column does not
exist, and telling them apart afterwards means guessing from identifier shapes.

**The raw payload is deliberately not stored.** It carries customer identifiers,
sometimes an email, sometimes a partial instrument, and it is exactly what ends
up in a log export. We keep the id, the type and a short outcome word.

Claiming an event says nothing about whether it is **authentic**. Signature
verification belongs to each provider's adapter and is not built here.

---

## Security

| principle | how |
|---|---|
| client claims never establish entitlement | every commercial write uses the service key; the athlete's token never writes |
| RLS denies all writes | `account_commercial`, `subscriptions`, `entitlement_grants` have **read-own only**; `billing_events` has **no policy at all** |
| provider ids never replace identity | `account_id` is not a provider-writable column |
| email never becomes subscription identity | no `email` column; no lookup by email in the commercial path |
| no card data | asserted against the schema |
| no billing secret in the client | asserted against the runtime bundle |
| admin grants use the existing boundary | `VVV_OWNER_USER_ID` + verified token |
| trial consumption is server authoritative | conditional UPDATE, service key only |
| unknown provider / condition / product / environment | **fails closed** |
| malformed dates | **fail closed** — a present-but-unparseable date is refused, never fallen back from |
| event replay | unique `(provider, provider_event_id)` |
| test vs production billing | `environment` column on subscriptions and events |

The coaching runtime references none of these tables and names no payment
provider. Both are asserted.

---

## The bridge to the live gate

The deployed account gate (`api/_access.js`) reads one denormalised
`entitlements` row and is already the single place the runtime is handed over.

**This phase does not re-point it.** Swapping the enforcement path and
introducing the model it enforces in one change is how a beta cohort gets locked
out on a Tuesday. Instead the resolution is *projected* onto that row's shape by
`projectToEntitlementRow()`, so the gate keeps working unchanged while
subscriptions and grants become the source of truth behind it.

The arrow points one way: **`entitlements` is a cache of the resolver's output
and never an input to it.** A test asserts the resolver never reads it.

A nine-case test drives resolver and gate side by side and asserts they never
disagree.

---

## Future provider adapters

```
WEB BILLING ─┐
APPLE ───────┼→ normalise → subscriptions → resolveStandardEntitlement() → access
GOOGLE ──────┘
```

Each adapter is responsible for exactly four things, and nothing else:

1. **verify** the payload's authenticity (signature, JWS, Pub/Sub token);
2. **claim** the event via `claimBillingEvent()`;
3. **normalise** the provider's vocabulary into our six conditions and upsert
   via `upsertSubscription()`;
4. **mark** the event processed.

An adapter never decides entitlement, never writes `account_id` from a payload,
never invents a grace period and never touches the trial except through
`consumeTrialForAccount()`.

**Apple, Google and web billing must feed this shared model.** None of them may
create its own athlete system, its own entitlement notion or its own trial
allowance. If a future provider integration needs a concept this model cannot
express, the model changes once — here — rather than the provider getting its
own parallel one.

---

## Files

| file | what |
|---|---|
| `api/_products.js` | catalogue: product, offers, prices, provider refs |
| `api/_entitlement.js` | the resolver, trial eligibility, duplicate purchase, projection — all pure |
| `api/_commercial-store.js` | Supabase IO, idempotency, race-safe trial consumption |
| `supabase-commercial-core.sql` | schema, RLS, triggers, beta backfill |
| `test/commercialCore.test.js` | 96 tests |
| `test/fakeSupabase.js` | in-memory PostgREST that enforces the real unique constraints |

All three modules are underscore-prefixed, so no Vercel serverless function was
added and the deployment budget is unchanged.
