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
| `_apple.js` (+ `_apple-purchase.js`) | **the App Store rail** (built 18 November 2026; see [APPLE-IN-APP-PURCHASE.md](APPLE-IN-APP-PURCHASE.md)) |
| `_google.js` (+ `_google-purchase.js`) | **the Google Play rail** (built 18 November 2026; see [GOOGLE-PLAY-BILLING.md](GOOGLE-PLAY-BILLING.md)) |

A subscription from any rail lands in the same `subscriptions` row shape, with
the same six-word `condition` vocabulary — `trialing`, `active`, `cancelled`,
`past_due`, `expired`, `revoked`. Apple's billing-retry, Google's
`SUBSCRIPTION_ON_HOLD` and Stripe's `past_due` all arrive as `past_due`. No
provider's enum becomes this application's model.

## What each new rail needs, and nothing more

1. **An adapter module** that turns that store's notification into the same
   facts `_stripe.js` produces: account, subscription reference, condition,
   offer, period dates, trial dates.
2. **A branch in `billing-webhook.js`** chosen by the REQUEST (a header, or
   the endpoint URL), never by sniffing the body — letting a payload's shape
   select its own verifier is how a forged body picks the verifier it can
   satisfy. The Google branch is chosen by `?rail=google` on the Pub/Sub push
   subscription's endpoint URL and verified by the push's OIDC token; the
   Apple branch by `?rail=apple` on the notification URL entered in App Store
   Connect, verified by Apple's signature (the x5c chain to Apple Root CA -
   G3).
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

**Play Billing is built for the Play Store build (18 November 2026).**
`_google.js` is the adapter, `_google-purchase.js` the admission path shared
by the app's verify call and Google's notifications, and in the runtime the
journey's `store` provider (plus the Settings controls) uses the
`SacoroBilling` plugin when, and only when, the build is a store build on
Android and the installed APK carries the plugin. iOS builds use the App
Store instead (see "iOS" below), and store builds without their plugin are
unchanged (`store_unavailable`). How it works,
what Play Console and Google Cloud need, and what is still unverified:
[GOOGLE-PLAY-BILLING.md](GOOGLE-PLAY-BILLING.md).

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

### iOS — StoreKit, decided and built

Apple's App Store Review Guideline 3.1.1 requires in-app purchase for digital
content used within an app. The reader-style alternative (3.1.3(b)) was the
other option. **The decision (founder, 18 November 2026): StoreKit / In-App
Purchase**, "once this [Google Play] is done you need to do the same for iOS",
on the condition that SACORO's one seven-day trial per person across Stripe,
Google Play and Apple is kept, with the simplest compliant design.

**What was built.** `_apple.js` is the adapter (Apple-signed data verified to
Apple Root CA - G3, the App Store Server API, the state mapping, the signed
introductory-offer eligibility); `_apple-purchase.js` the admission path shared
by the app's `apple_verify` call and App Store Server Notifications V2
(`/api/billing-webhook?rail=apple`); the `SacoroAppStore` plugin (StoreKit 2)
in the iOS App target; and in the runtime the journey's `store` provider and
the Settings controls use it when, and only when, the app is the iOS shell with
the plugin. An iOS build without the plugin is unchanged (`store_unavailable`).

**One trial across rails, on Apple.** Two products in one subscription group,
each with the seven-day free-trial introductory offer. Before every purchase
the server signs, per product, Apple's introductory-offer eligibility
(`Product.PurchaseOption.introductoryOfferEligibility(compactJWS:)`) with
SACORO's own verdict from the `account_commercial` allowance, and the App Store
applies or removes the free week accordingly. The server also refuses a trial
it did not allow (including Apple's own free week on a resubscribe made outside
the app). Details, sources, App Store Connect steps and what is unverified:
[APPLE-IN-APP-PURCHASE.md](APPLE-IN-APP-PURCHASE.md). Apple's commission (15%
to 30%) applies to every App Store subscription.

**What must not happen in the meantime:** no unapproved store purchase flow is
enabled anywhere. Google Play and App Store purchase code exists for the two
approved store rails only, each in its own files; `mayStartStandardPurchase()`
still refuses an unknown provider before it looks at anything else, and the
one-live-subscription and one-trial rules apply to Play and App Store purchases
through the same functions as to the web.

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
| Play Store build (the `SACORO-Store-Build` marker, Android, `SacoroBilling` plugin present), commerce on | `store` | Annual and Monthly at **Play's own localised prices**, the timeline, the same two agreement ticks, Start My Free Trial (only when the server says the athlete may have a trial and Play offers one; otherwise Subscribe), "Payment is handled by Google Play." | `POST /api/subscription {action:'google_prepare'}`, then Play's purchase sheet with the server-derived `obfuscatedAccountId`, then `{action:'google_verify', purchaseToken}`; the server reads the purchase from Google, writes it through `_billing-apply.js`, acknowledges it; the app asks `/api/session` again and the journey sees `subscription_trial` |
| iOS build with the `SacoroAppStore` plugin, commerce on | `store` | Annual and Monthly at **the App Store's own localised prices**, the timeline, the same two agreement ticks, Start My Free Trial (only when the server says the athlete may have a trial; otherwise Subscribe), the Guideline 3.1.2 disclosures (title, length, price per period, auto-renewal, Terms of Service and Privacy Policy links), "Payment is handled by the App Store.", **Restore Purchases** | `POST /api/subscription {action:'apple_prepare', appTransactionId}`, then StoreKit's purchase with the server-derived `appAccountToken` and the server-signed trial eligibility, then `{action:'apple_verify', signedTransaction}`; the server re-reads the subscription from the App Store Server API and writes it through `_billing-apply.js`; only then does the app finish the transaction and ask `/api/session` again |
| Any other store build (a store build without its billing plugin) | `store` | no price, no tickbox, no link to the web checkout; "Subscriptions are not available in the app yet", Continue | `store.start()` answers `store_unavailable`; nothing is sold, which is the rule above |

Play Billing and then StoreKit have been built exactly that way: the `store`
provider's `start()` (and the Settings controls beside it) is what changed in
the runtime, beside the `_google.js` and `_apple.js` adapters.
