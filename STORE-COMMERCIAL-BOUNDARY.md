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

There are two kinds of Android build, and they are told apart by an explicit
marker, never by guessing.

**Website-distributed (today's APK).** The APK is downloaded from the website,
not from Google Play. It is a Capacitor shell whose `server.url` is the live
site, so it runs exactly the page the website runs. Google Play's Payments
policy governs apps distributed through Google Play; it does not govern an
APK the athlete downloads from our own website. **Founder, 18 November 2026:**
the installed Android app must take payment too: new sign-ups get the 7-day
free trial and "it takes the money at that point" (card at the trial step,
first charge on day 8). So this build sells through the **web rail**, the same
Stripe Checkout as the website. Nothing about the `subscriptions` row differs:
the provider is `web`, because that is the channel it was bought on.

**Store builds (Google Play, or the App Store).** A build distributed through a
store must not present the web checkout. Such a build carries the marker
**`"appendUserAgent": "SACORO-Store-Build"`** in its Capacitor config (set in
that build's `capacitor.config.json` before `npx cap sync`; Capacitor appends
it to the WebView's user agent, which is how a page loaded from the live site
can read a build-time fact). The marker is set **only** in store builds.
`capacitor.config.json` in this repository does not carry it, and
`test/m10-androidPayment.test.js` fails if it ever does, because that file
builds today's website-distributed APK.

| Question | Asked by | Answer |
|---|---|---|
| Is this an installed app at all? | `isNativeApp()` | Capacitor says it is native |
| Is it a store build? | `storeDistributedApp()` (runtime), `storeBuild()` (`account.html`) | native **and** (the user agent carries `SACORO-Store-Build` **or** the platform is iOS) |
| Is it the website-distributed app? | `websiteDistributedApp()` | native and not a store build |

iOS counts as a store build with or without the marker: there is no
website-distributed iPhone app (an iOS binary only reaches people through the
App Store or TestFlight), and iPhone athletes use the website or its Home
Screen web app, which is not native and already gets the web checkout.

The marker is not a security boundary and does not need to be: it decides only
whether in-app screens offer the web checkout. Every purchase is still decided
by `/api/checkout` from the athlete's own token, and
`mayStartStandardPurchase()` still refuses a second live subscription on any
rail.

If Play Billing is later required or wanted for a Play build, `_google.js` is
the only new server file and the journey's `store` provider is the only
runtime change.

### How the website-distributed app takes payment, step by step

1. **The trial screen** is the website's: Annual and Monthly from
   `GET /api/checkout` (the catalogue in `_products.js`), the timeline (today
   £0, day 8 the first charge), the two agreement ticks, each recorded at the
   tick as `{action:'agree', surface:'checkout'}`, and **Start My Free Trial**.
   Under the button it says *"Secure payment setup opens in your browser, then
   brings you back here."*
2. **Start My Free Trial** posts `{period, return:'app'}` to `/api/checkout`
   with the athlete's own token. The server decides everything it decides for
   the website (commerce on, legal evidence, country, one subscription per
   athlete, one trial per athlete) and creates the Checkout Session with
   `trial_period_days: 7` and `payment_method_collection: 'always'`. The only
   difference `return:'app'` makes is which of two fixed return addresses
   (`returnUrls()` in `_stripe.js`) Stripe is given:
   - success: `/account?checkout=complete&session_id={CHECKOUT_SESSION_ID}&return=app`
   - cancel: `/account?checkout=cancelled&return=app`
3. **Stripe Checkout opens in the phone's browser.** It is off-origin, and the
   Capacitor bridge (`Bridge.launchIntent`) hands any address whose host is not
   `app.velvetviking.co.uk` to the system as an `ACTION_VIEW` intent. The app
   stays on the trial screen, which now reads *"Finish setting up payment in
   your browser. SACORO brings you back here when it is done."*
4. **The athlete enters a card and confirms.** £0 is taken; Stripe creates a
   `trialing` subscription and sends the webhook (`/api/billing-webhook`),
   which writes it to `subscriptions` and spends the trial allowance.
5. **Stripe returns to `/account?...&return=app` in the browser.** The browser
   holds none of the app's sign-in, so the page does not try to sign anybody in.
   It shows **Back to the App** (*"Open the SACORO app to finish. It confirms
   your free trial and takes you straight in."*) with **Open the SACORO App**,
   and tries the hand-off once by itself:
   `com.velvetviking.valhalla://auth/checkout?status=complete&session_id=cs_…`.
   The manifest's existing custom-scheme filter (host `auth`, any path)
   delivers that to the app, so **no new APK is needed**. A phone that wants a
   tap before leaving the browser gets the button.
6. **The app reconciles and lets the athlete in.** `handleCheckoutDeepLink()`
   (runtime; `account.html` has the same listener for a checkout started from
   the account page) hands the session id to
   `POST /api/subscription {action:'reconcile'}` with the app's own token (the
   server fetches the session from Stripe and refuses one that is not this
   athlete's), then asks `/api/session` again. Granted, journey-only mode
   reloads into the full app, the journey sees `subscription_trial`, and the
   athlete reads the toast *"Your free trial has started"* and **Welcome to
   SACORO**, then **Let's Go** into Today.
7. **If the hand-off never happens** (the athlete switches back by hand), the
   app asks `/api/session` again whenever it comes to the front
   (`revalidateDeliverySession()` on `visibilitychange`), so once the webhook
   has landed the same reload happens.
8. **Cancelled**: the browser shows **Checkout Cancelled** (*"Nothing has been
   charged. Open the SACORO app to carry on from where you were."*); the app
   says *"Checkout cancelled. Nothing has been charged"* and stays on the
   trial screen.

Managing the subscription later (Settings, **Manage or cancel subscription**)
works the same way: `/api/portal` is asked with `return:'app'`, the Stripe
portal opens in the browser and returns to `/account?portal=returned&return=app`,
which hands back to `com.velvetviking.valhalla://auth/checkout?status=portal`.

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

---

## The first-time journey's payment step (18 November 2026)

The founder's journey has a "Start your 7-day free trial" screen and then
"payment confirmation: website = the existing Stripe checkout; installed store
apps = Apple / Google store billing". The runtime has one seam for it,
`JOURNEY_PAYMENT` with `journeyPaymentProvider()`, and what each side does
today is:

| Where | Provider | What the athlete sees | What happens |
|---|---|---|---|
| Website (and the iPhone Home Screen web app), commerce on | `web` | Annual and Monthly from `GET /api/checkout` (the catalogue in `_products.js`), the two existing agreement ticks, Start My Free Trial | `POST /api/checkout {period}` opens Stripe Checkout; Stripe returns to `/account?checkout=complete`, which reconciles and enters the app; the journey sees `subscription_trial` and moves to Welcome to SACORO |
| Website-distributed Android app (today's APK), commerce on | `app` | exactly the website's screen, plus "Secure payment setup opens in your browser, then brings you back here" | `POST /api/checkout {period, return:'app'}`; Stripe opens in the phone's browser and returns into the app through `com.velvetviking.valhalla://auth/checkout` (the steps above) |
| Website or website-distributed app, commerce off | `web` / `app` | the same prices as information, "Subscriptions are not open yet", Continue | nothing is charged and no agreement is recorded; access is the open gate (`pre_commercial`) |
| Store build (the `SACORO-Store-Build` marker, or iOS) | `store` | no price, no tickbox, no link to the web checkout; "Subscriptions are not available in the app yet", Continue | `store.start()` answers `store_unavailable`; nothing is sold, which is the rule above |

When Play Billing or StoreKit is approved, the `store` provider's `start()`
is the one thing in the runtime that changes, beside the `_google.js` /
`_apple.js` adapter this file already describes. Until then there is still no
Apple or Google purchase code in the repository.
