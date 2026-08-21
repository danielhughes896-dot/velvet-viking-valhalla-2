# Web, Android and iOS — the commercial boundary

The canonical model already has a provider axis: **`web` | `apple` | `google`**.
That axis is the CHANNEL an athlete bought on, not the vendor who processed the
card. Stripe is the processor beneath the web rail, never a provider value —
naming the processor there would make the column mean two things at once and
force a translation every time a web subscription was compared with an Apple
one.

This file records where the boundary sits and what each rail requires, so iOS
uncertainty cannot become a reason to delay the web and Android launch.

---

## What is already provider-neutral

Everything except one file per rail.

| Layer | Knows about a store? |
|---|---|
| `_products.js` — the catalogue, offers, prices, trial length | no |
| `_entitlement.js` — the access decision | no |
| `_commercial-store.js` — reads and writes the canonical rows | no |
| `_pause.js` — the pause policy | no |
| `_access.js` — leases and delivery | no |
| the runtime (`protected/…html`) | no |
| `_stripe.js` | **the web rail, and only that** |
| *(future)* `_apple.js` | the Apple rail |
| *(future)* `_google.js` | the Google rail |

A subscription from any rail lands in the same `subscriptions` row shape, with
the same six-word `condition` vocabulary — `trialing`, `active`, `cancelled`,
`past_due`, `expired`, `revoked`. Apple's billing-retry, Google's
`SUBSCRIPTION_ON_HOLD` and Stripe's `past_due` all arrive as `past_due`. No
provider's enum becomes this application's model.

## What each new rail needs, and nothing more

1. **An adapter module** that turns that store's notification into the same
   facts `_stripe.js` produces: account, subscription reference, condition,
   offer, period dates, trial dates.
2. **A branch in `billing-webhook.js`** chosen by the REQUEST (a header),
   never by sniffing the body — letting a payload's shape select its own
   verifier is how a forged body picks the verifier it can satisfy.
3. **Price identifiers in the environment**, under the existing mechanical
   convention: `VVV_PRICE_APPLE_STANDARD_MONTHLY`,
   `VVV_PRICE_GOOGLE_STANDARD_YEARLY`. No code change is needed to add one.

Nothing downstream moves. That is the test of whether the boundary is in the
right place, and it is checked by `test/stripeFoundation.test.js` and
`test/commercialCore.test.js`.

---

## The rails, and their actual rules

### Web (Stripe) — the launch rail

Subscriptions sold on the website and in the browser. Stripe hosts checkout,
holds the instrument, and is the processor of record. This is the rail that is
built, tested and waiting on live credentials.

### Android

Google Play's Payments policy requires Google Play Billing for **digital content
consumed within the app**. It does **not** require it for a subscription an
athlete buys on the open web and then signs in to use, and — since the 2021
policy updates and subsequent regulatory settlements — it permits an app to
inform users of alternative purchase options in most jurisdictions.

**The Android decision, stated plainly:** Valhalla ships on Android with the web
subscription only. The app does not sell anything in-app, so Play Billing is not
engaged. The `google` provider value exists so that adding Play Billing later is
an adapter, not a migration of every subscription row.

If Play Billing is later required or wanted, `_google.js` is the only new file.

### iOS — the one that is genuinely uncertain

Apple's App Store Review Guideline 3.1.1 requires in-app purchase for digital
content used within an app. Guideline 3.1.3(b) ("multiplatform services") allows
an app to let users access content they bought elsewhere, and the 2024–2025
US injunction changed what may be linked and said about external purchase — but
what is permitted varies by jurisdiction and has changed more than once.

**The decision:** iOS is not on the launch path, and no work here is blocked on
resolving it. When it is taken up, it is a `_apple.js` adapter plus App Store
Server Notifications V2, plus a commercial judgement about the 15–30% fee that
is HQ's to make, not System's.

**What must not happen in the meantime:** no unapproved store purchase flow is
enabled anywhere. There is no Apple or Google purchase code in the repository at
all, and `mayStartStandardPurchase()` refuses an unknown provider before it
looks at anything else.

---

## The rule that survives all three

**One athlete, one live subscription, whichever rail it arrived on.**
`mayStartStandardPurchase()` refuses a second purchase while any rail holds a
blocking subscription, and names WHICH rail so the product can say the right
sentence: *"you already subscribe here, manage it in Settings"* is a different
screen from *"you subscribe through the App Store, manage it there"*.

A pause counts as blocking. Pausing is not leaving.

**One trial per athlete, across every rail.** The allowance lives on
`account_commercial`, not on a provider's record of it — Apple does not know
about a trial taken on the web, Google does not know about either, and an
athlete who could take one of each would get six weeks free by changing which
button they press.
