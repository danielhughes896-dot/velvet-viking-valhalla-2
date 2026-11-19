# Apple In-App Purchase (StoreKit 2): what was built, and what the founder must do

**The decision.** Founder, 18 November 2026, after Google Play Billing: "once
this is done you need to do the same for iOS". That settles the open question
in `IOS-READINESS.md` as **option B, StoreKit / In-App Purchase**. The founder's
conditions for it:

1. keep SACORO's rule of **one seven-day trial per person** across Stripe,
   Google Play and Apple;
2. find out whether separate trial and no-trial Apple products are actually
   needed, and check the answer against Apple's subscription-group rules,
   plan switching, Restore Purchases and Apple's own subscription management;
3. choose the **simplest reliable, Apple-compliant** design;
4. build, test and document it locally. Nothing deployed, pushed or configured.

**What it is not.** It does not change who gets access, the trial length, the
pause policy, one live subscription per athlete, or one trial per athlete.
`api/_entitlement.js` is untouched. Apple is a new **channel** (the `apple`
value already on the provider axis) feeding the same provider-neutral core as
the web and Play rails. See `STORE-COMMERCIAL-BOUNDARY.md` and
`COMMERCIAL-CORE.md`.

Nothing in this branch has been deployed, pushed, or configured in Vercel,
Supabase, App Store Connect or the Apple Developer account. No schema change is
needed: `subscriptions.provider`, `billing_events.provider` and
`account_commercial.trial_consumed_provider` already accept `'apple'`
(`supabase-commercial-core.sql`).

---

## 1. The trial question, and why there are only two products

### The problem

Apple decides introductory-offer eligibility itself, per Apple Account and per
**subscription group**: "You can make introductory offers to customers who
haven't previously received an introductory offer for the given product, or
for any products in the same subscription group" (Apple, *Implementing
introductory offers in your app*). Apple knows nothing about a trial taken on
the web or on Google Play, so by Apple's rule alone an athlete who had their
seven days on the web would get seven more on an iPhone. SACORO's rule is one
trial per **athlete** across every rail.

### What was investigated

**A. Four products** (monthly and annual with the free trial, monthly and
annual without one, all in one group; the app shows the pair the server
chooses). It works with Apple's rules: products in one group share one
intro-offer history, and a product with no introductory offer simply has none
to apply. Its cost: two extra products to create, price in every storefront,
localise and get through review, two more environment variables, two more
product ids to map back to our two offers, a group ranking with four entries,
and an app that must pick a product pair correctly forever.

**B. Two products plus a server-signed eligibility (chosen).** StoreKit 2 has a
purchase option that lets the developer's server decide introductory-offer
eligibility for a purchase:
`Product.PurchaseOption.introductoryOfferEligibility(compactJWS:)`. Confirmed in
Apple's documentation:

- **It exists, and what it does.** "Set the eligibility of an introductory
  offer for a purchase." Apple's SwiftUI counterpart states the effect: "If the
  signature passes validation, the system applies or removes the offer to the
  purchases according to the offer eligibility preference. If the signature
  fails validation, the purchase will fail with `invalidOfferSignature`."
- **Minimum iOS.** Declared `@backDeployed(before: iOS 18.4, ...)` with
  availability **iOS 15.0+**: it runs on iOS 15 and later when the app is built
  with the iOS 18.4 SDK or newer (Xcode 16.3+; `build-ios.yml` selects the
  newest Xcode on the runner).
- **The JWS.** Signed on the server with the **In-App Purchase key** (not the
  App Store Connect API key), ES256. Header `alg: ES256`, `kid: <key id>`,
  `typ: JWT`. Payload: `iss` (issuer id), `iat`, `aud:
  "introductory-offer-eligibility"`, `bid` (bundle id), `nonce` (a one-time
  UUID), `productId`, `allowIntroductoryOffer` (true or false), `transactionId`.
  **No `exp`**: "Don't include an exp field in your payload, because including
  it makes the request fail. The App Store server enforces an expiration time
  based on your iat value." Apple's own App Store Server Library builds exactly
  this in `IntroductoryOfferEligibilitySignatureCreator` (checked in
  `@apple/app-store-server-library` 3.1.0).
- **`transactionId` and the real minimum iOS.** The claim is "the unique
  identifier of any transaction that belongs to the customer. You can use the
  customer's `appTransactionID`, even for customers who haven't made any Apple
  In-App Purchases in your app." A new customer has no other transaction, so
  the app needs `AppTransaction.appTransactionID`, which is **iOS 16.0+**
  (back-deployed before iOS 18.4).

**Decision: B.** One subscription group, **two** products (monthly, annual),
each with the seven-day free-trial introductory offer. Before every purchase
the server signs, for each product, `allowIntroductoryOffer` = SACORO's own
trial verdict for this athlete (`mayStartStandardPurchase().trial.eligible`,
which reads the `account_commercial` allowance). The App Store then applies or
removes the free trial accordingly. An athlete who had a trial on the web or
Play is charged by Apple from day one; nothing in the app has to choose between
products.

**Older iOS: raise the deployment target to iOS 16.0 (done).** That is the
simplest reliable answer. On iOS 15 the option itself would work, but a
customer with no purchases has no transaction id to sign for, so the trial
rule could not be applied to exactly the customers who matter (new ones). A
fallback for iOS 15 (for example the four-product design for that version only)
would bring back all of design A's cost for a version very few iPhones still
run. Capacitor 8 needs iOS 15 anyway; no SACORO iOS version has been released
publicly, so nobody is left on an older build. The app requires iOS 16.0.

### How it behaves with Apple's other rules

| | What happens |
|---|---|
| **Monthly to annual, annual to monthly** | Done in Apple's own subscription management (the app offers no in-app switching: `apple_prepare` refuses a purchase while the athlete has a live subscription, as on every rail). Both products are in one group, so a switch is an upgrade, downgrade or crossgrade of the **same** subscription: the `originalTransactionId` stays the same, so it stays one SACORO `subscriptions` row, whose offer is re-read from Apple. Rank **Annual at level 1 and Monthly at level 2**: monthly to annual is then an upgrade (immediate, Apple refunds the unused part of the month); annual to monthly a downgrade (from the next renewal). Apple: existing subscribers "are not eligible if they are upgrading, downgrading, or crossgrading their subscription from another product", so a switch never brings a second trial. No signed JWS is involved or needed. |
| **Restore Purchases** | `AppStore.sync()`, then `Transaction.currentEntitlements`; each subscription is sent to the server like any purchase. A restore buys nothing, so no JWS is involved. The server attaches it only to its recorded owner, or, if new, only when Apple's `appAccountToken` is this athlete's. |
| **Apple's subscription management** (Settings, Apple Account, Subscriptions; or `AppStore.showManageSubscriptions` from the app's **Manage Subscriptions** button) | Cancel, switch and resubscribe there change the same subscription, and reach the server through App Store Server Notifications V2 and through the app's `Transaction.updates` listener. |
| **Resubscribe outside the app after lapsing** | The one place no signed eligibility can reach: Apple applies its own rule, and a lapsed subscriber who never used an introductory offer **in the group** is eligible. Example: trial on the web, paid on Apple with the trial signed away, lapsed, resubscribed in Settings: Apple gives seven free days. The server refuses to record that as a second SACORO trial (`secondTrialOnKnown` in `_apple-purchase.js`): no access for Apple's free days, and the first paid renewal is admitted as an ordinary paid period. **Founder to confirm** (section 7). |
| **Family Sharing** | Leave it **off** for these products. A family member's access would arrive with no `appAccountToken` of their own and would not be attached to any SACORO account. |

### The appAccountToken

Every purchase carries `Product.PurchaseOption.appAccountToken(UUID)`. The UUID
is derived on the server: the first 16 bytes of
HMAC-SHA256(`VVV_APPLE_ACCOUNT_TOKEN_SECRET`, `"sacoro-apple-account:" +
account id`), shaped as an RFC 4122 version-4 UUID. One-way, keyed, never the
account id. A purchase is attached to an account only when the token Apple
holds matches. **Choose the secret once and do not change it** (a recorded
purchase keeps its owner, but new purchases made under the old token would be
refused).

One Apple subscription belongs to one SACORO account for ever (the core already
enforces this). If two SACORO accounts share one Apple Account, the
subscription stays with the first; the second is told "That App Store
subscription belongs to a different SACORO account."

---

## 2. What was built

| Where | What |
|---|---|
| `ios/App/App/SacoroAppStorePlugin.swift` | Capacitor plugin `SacoroAppStore` (StoreKit 2): `getProducts({productIds})` (id, displayName, displayPrice, price, currency, period, introductory offer with free trial yes/no and its length, `isEligibleForIntroOffer`), `appTransactionId()`, `purchase({productId, appAccountToken, introOfferEligibilityJWS})` with `.appAccountToken` and `.introductoryOfferEligibility(compactJWS:)` (returns `success` with the signed transaction `jwsRepresentation`, `userCancelled` or `pending`), `finish({transactionId})`, `unfinishedTransactions()`, `currentEntitlements()`, `restorePurchases()` (`AppStore.sync()`), `showManageSubscriptions()` (`AppStore.showManageSubscriptions(in:)`), and the `transactionUpdated` event from a `Transaction.updates` listener started at launch (retained until the page listens). **It finishes a transaction only when `finish` is called**, and the page calls it only after the server has admitted the transaction. |
| `ios/App/App/SacoroBridgeViewController.swift` | `CAPBridgeViewController` subclass; `capacitorDidLoad()` registers the plugin instance (`bridge?.registerPluginInstance`), Capacitor 8's documented way to register a plugin that lives in the App target. Used by `SceneDelegate.swift` and `Main.storyboard`. |
| `ios/App/App.xcodeproj/project.pbxproj` | Both Swift files in the App group and the App target's Sources phase; `IPHONEOS_DEPLOYMENT_TARGET = 16.0`; `MARKETING_VERSION = 1.1` (the build number stays `CURRENT_PROJECT_VERSION`, set per run by `build-ios.yml` from `github.run_number`). `ios/App/Podfile`: `platform :ios, '16.0'`. |
| `api/_apple.js` | The adapter: Apple-signed data (JWS) verification, the App Store Server API (Get All Subscription Statuses), the ES256 API token, the signed introductory-offer eligibility, the state mapping, notification targets. Embeds **Apple Root CA - G3** (source and fingerprint below). |
| `api/_apple-purchase.js` | `prepare` (may this athlete buy; the products; the appAccountToken; the signed trial verdict per product) and `admit` (verify, re-read from Apple, owner, the two rules, `_billing-apply.js`), shared by the app's verify call and Apple's notifications. |
| `api/_subscription.js` | `POST /api/subscription {action:'apple_prepare', appTransactionId}` and `{action:'apple_verify', signedTransaction}` with the athlete's own token. The answer carries `finish: true` and `transaction_id` only for an admitted purchase. |
| `api/billing-webhook.js` | The Apple branch, chosen by `?rail=apple` on the request URL. |
| `protected/velvet-viking-valhalla.html` | In the iOS build with the plugin: the journey's trial screen and the Settings subscription controls use the App Store, with the 3.1.2 disclosures, **Restore Purchases** and **Manage Subscriptions**. |
| `test/m17-appleInAppPurchase.test.js` | Section 6. |

No new serverless function (both routes ride existing routers). No StoreKit
configuration file was added: Xcode StoreKit testing signs with a local
certificate, which the server (correctly) does not trust, so it can only test
the app's screens, not the server path. Use Sandbox testers instead (section 4).

### How a purchase flows

1. The app reads `AppTransaction.appTransactionID` and asks the server
   `apple_prepare`. The server answers: may the athlete buy (commerce on, Apple
   configured, United Kingdom, both agreements on record, no live subscription
   on any rail: the same questions in the same order as the web checkout and
   Play), the two product ids, the athlete's `app_account_token`, whether they
   may have the trial under SACORO's rule, and one signed eligibility JWS per
   product.
2. The app asks StoreKit for the products and shows Apple's localised prices.
   It shows the free trial only when the server says the athlete may have it
   and the product carries the free-trial offer.
3. StoreKit's sheet takes the payment, with the appAccountToken and the signed
   eligibility attached. The app sends the signed transaction to `apple_verify`
   with the athlete's own access token.
4. The server verifies Apple's signature on it, then **re-reads the
   subscription from the App Store Server API** (the device's copy is only a
   lookup key), re-verifies the two signed fields Apple returns, checks the
   appAccountToken, applies one-live-subscription and one-trial, and writes it
   through `_billing-apply.js` (subscription row, agreed price, trial allowance
   spent, entitlement re-projected).
5. Only then does the server say `finish: true`; the app finishes the
   transaction and asks `/api/session` again. The journey sees
   `subscription_trial` and moves to Welcome to SACORO, as on the other rails.

An unfinished transaction (the app closed under the sheet, no signal, a server
error) is sent again on every start and resume, and StoreKit's update stream
(renewals, Ask to Buy approvals, purchases made elsewhere) is sent as it
arrives.

**A refusal after payment cannot be undone by the server.** Unlike Play
(where an unacknowledged purchase is refunded after three days), Apple does not
refund an unfinished transaction. `apple_prepare` refuses before the sheet opens
in every case it can (a live subscription, no agreements, wrong country, a
spent trial is signed away), so a refusal after payment needs a race or a
second device. Then the app says so plainly and points to **Manage
Subscriptions** to cancel; a refund is the customer's to request from Apple
(reportaproblem.apple.com) or, in Production, SACORO can answer Apple's
consumption request. The transaction stays unfinished.

### What each App Store status becomes

| App Store (Get All Subscription Statuses `status`, transaction, renewal info) | SACORO condition |
|---|---|
| 1 active, transaction is the free trial (`offerType` 1, `offerDiscountType` FREE_TRIAL) | `trialing` (trial ends at `expiresDate`; cancel at period end when auto-renew is off) |
| 1 active, paid, auto-renew on | `active` |
| 1 active, paid, auto-renew off | `cancelled` (access to `expiresDate`) |
| 2 expired | `expired` |
| 3 billing retry | `past_due`, no grace, no access |
| 4 billing grace period | `past_due`, grace until Apple's `gracePeriodExpiresDate` (nothing added by SACORO) |
| 5 revoked, or `revocationDate` on the transaction (refund) | `revoked` |
| a REFUND or REVOKE notification | `revoked` only when Apple's own re-read shows it is no longer entitled |
| any other status, another product, not an auto-renewable subscription | refused; nothing recorded |

### Apple-signed data

Every JWS from Apple (the device's signed transaction, the API's signed
transaction and renewal info, a notification's `signedPayload`) is accepted
only when, in this order: `alg` is ES256; `x5c` holds exactly three
certificates; the intermediate is signed by **Apple Root CA - G3** and names it
(the root inside `x5c` is never trusted for being there); the leaf is signed by
the intermediate and names it; the intermediate is a CA; the leaf carries OID
`1.2.840.113635.100.6.11.1` and the intermediate `1.2.840.113635.100.6.2.1`;
`signedDate` is not in the future and all three certificates were valid at
`signedDate`; the ES256 signature verifies with the leaf key. Then the bundle id
must be `com.velvetviking.valhalla`, the environment one this deployment
accepts, and for a Production notification the app's Apple ID must match. These
are the checks Apple's own App Store Server Library makes, minus its optional
online (OCSP) revocation check, which is not implemented.

**The root.** `APPLE_ROOT_CA_G3_BASE64` in `api/_apple.js` is Apple's public
root, published at https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
(Apple PKI: https://www.apple.com/certificateauthority/). apple.com was not
reachable from the build environment, so the copy was taken from Apple's own
App Store Server Library test resources (`REAL_APPLE_ROOT_BASE64_ENCODED`,
`@apple/app-store-server-library` 3.1.0, MIT) and pinned by its published
SHA-256 fingerprint
`63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:5C:75:6F:30:17:B3:A8:C4:88:C3:65:3E:91:79`,
which an independent package (`app-store-server-api` 1.0.0) states
identically. If the constant were ever edited, nothing verifies. Valid to 30
April 2039.

---

## 3. App Store Connect: exactly what to set up

Product ids are permanent in App Store Connect and can never be reused, so
check them before saving.

1. **Agreements.** App Store Connect, **Business** (formerly Agreements, Tax,
   and Banking): accept the **Paid Apps Agreement**, and complete **tax** forms
   and **banking**. In-App Purchases cannot be sold, or even tested in Sandbox
   reliably, until this is active.
2. **The app record** for `com.velvetviking.valhalla` exists (needed for
   TestFlight already). Note its **Apple ID** (App Information, General
   Information, Apple ID; a number). That is `VVV_APPLE_APP_APPLE_ID`.
3. **The subscription group.** Your app, **Monetization, Subscriptions**,
   create a subscription group: reference name **SACORO Standard**; add a
   group display name localisation (English (U.K.)): **SACORO Standard**.
4. **The two subscriptions**, in that group:

   | Reference name | Product ID | Duration | Price (United Kingdom) | Level |
   |---|---|---|---|---|
   | SACORO Standard Annual | `sacoro.standard.annual` | 1 year | **£79.99** | 1 |
   | SACORO Standard Monthly | `sacoro.standard.monthly` | 1 month | **£11.99** | 2 |

   For each: set the price in the **United Kingdom** storefront at the figure
   above (`api/_products.js`; Apple suggests other storefronts' prices; SACORO
   sells only in the United Kingdom, so set **Availability** to the United
   Kingdom only, which matches the server's own country check); add a display
   name (English (U.K.)) **SACORO Standard** and a short description; add the
   **review screenshot** (the purchase screen) and **review notes**; leave
   **Family Sharing off**.
5. **The introductory offer** on **each** of the two products: Subscription
   Prices, **Introductory Offers**, create: countries **United Kingdom**, start
   date now, no end date, type **Free**, duration **1 week** (seven days). Do
   not create any other introductory, promotional or win-back offer: the app
   treats the product's introductory offer as "the trial".
6. **The In-App Purchase key.** **Users and Access, Integrations, In-App
   Purchase**: generate a key (name it, for example, "SACORO server"). Download
   the `.p8` **once** (Apple will not offer it again). Note the **Key ID** and
   the **Issuer ID** shown at the top of that page. This one key signs both the
   App Store Server API calls and the trial eligibility.
7. **App Store Server Notifications V2.** Your app, **App Information, App Store
   Server Notifications**:
   - Production Server URL: `https://app.velvetviking.co.uk/api/billing-webhook?rail=apple`
   - Sandbox Server URL: `https://app.velvetviking.co.uk/api/billing-webhook?rail=apple`
   - Version: **Version 2**.
8. **Vercel environment variables** (section 5), then **redeploy**.
9. **Test notification.** With the App Store Server API (or App Store
   Connect's own **Request a Test Notification** where offered) send a TEST
   notification: the server answers 200, logs `APPLE_TEST_NOTIFICATION`, and
   applies nothing.
10. **Sandbox testers.** **Users and Access, Sandbox, Test Accounts**: create
    testers (each needs an email address not used for any Apple Account). On
    the iPhone: Settings, Developer (or App Store), **Sandbox Account**, sign in
    with the tester. Sandbox subscriptions renew on a shortened schedule (a
    month is minutes), so renewals, cancel, grace and expiry can be watched in
    the logs (`APPLE_APPLIED ...`). Sandbox and TestFlight purchases are in the
    **Sandbox** environment, so the deployment they reach must accept it
    (`VVV_APPLE_ENVIRONMENTS=Production,Sandbox`).
11. **TestFlight.** GitHub, Actions, **Build iOS app**, Run workflow (leave
    `ref` blank or name the merged commit), tick **upload_testflight**. The
    suite runs first; the Mac builds for the Simulator (this is what compiles
    the new Swift) and, with the signing secrets, archives and uploads. Install
    from TestFlight, sign in, reach the trial screen. Expect:
    - Apple's prices; **Start My Free Trial** for an athlete who has never had a
      trial, **Subscribe** (charged today) for one who has had it on the web or
      Play;
    - Apple's sheet shows the free week, or no free week, to match;
    - after purchase, Welcome to SACORO; Settings shows **Manage Subscriptions**;
    - in Supabase, a `subscriptions` row with `provider = 'apple'`,
      `environment = 'sandbox'`, `provider_subscription_id` = the
      originalTransactionId; the trial spent on `account_commercial` with
      `trial_consumed_provider = 'apple'`; `billing_events` rows for the
      notifications;
    - **Restore Purchases** after a reinstall restores it; on a different SACORO
      account it is refused.
12. **Provisioning.** StoreKit 2 needs no entitlements file and no capability
    beyond **In-App Purchase**, which is enabled by default for App IDs. With
    cloud signing (`build-ios.yml`, automatic, `-allowProvisioningUpdates`)
    Xcode regenerates the profile itself. With **manual** signing, regenerate
    the App Store provisioning profile after confirming In-App Purchase is
    ticked on the App ID, and update `IOS_PROFILE_BASE64`.
13. **Submit the subscriptions with the app version** (the first In-App
    Purchases must be submitted for review together with a new app version).

### App Review notes (suggested text; edit as needed)

> SACORO sells one auto-renewable subscription, SACORO Standard, monthly
> (£11.99) or annually (£79.99), with a 7-day free trial for new customers.
> SACORO allows one free trial per customer across all platforms, so a
> customer who already had the trial on our website receives no trial in the
> app. Sign-in is by emailed link. Demo account: `<address>`. To see the
> purchase screen: sign in, complete the short onboarding, and the plans are
> shown on the "Start Your 7-Day Free Trial" screen; they are also in
> Settings. Restore Purchases is on both screens.

### Guideline 3.1.2 disclosures (what the app shows)

On the trial screen and in Settings, beside the purchase button:

- the subscription's **title** (Apple's display name, "SACORO Standard"), its
  **length** ("1 year" / "1 month") and **price per period** (Apple's localised
  price, "per year" / "per month");
- that it **renews automatically** ("then it renews annually until you
  cancel", reusing the account page's existing sentence), with the free days
  when the trial applies, and "Payment is handled by the App Store.";
- links to the **Terms of Service** (https://velvetviking.co.uk/terms) and the
  **Privacy Policy** (https://velvetviking.co.uk/privacy), the same targets the
  agreements in force already name;
- the two existing agreement ticks, unchanged, required before purchase;
- **Restore Purchases**.

App Store Connect also needs: the Privacy Policy URL (App Privacy) and a Terms
of Use (EULA) link (section 7) in the app description or the custom EULA field.

---

## 4. The identifiers the code expects

| | Value |
|---|---|
| Bundle id | `com.velvetviking.valhalla` (fixed in code) |
| Monthly product | `sacoro.standard.monthly` |
| Annual product | `sacoro.standard.annual` |
| Capacitor plugin | `SacoroAppStore` |
| Notification URL | `https://app.velvetviking.co.uk/api/billing-webhook?rail=apple` |

---

## 5. Vercel environment variables (names)

| Name | Value |
|---|---|
| `VVV_APPLE_IAP_KEY_ID` | the In-App Purchase key's Key ID |
| `VVV_APPLE_IAP_ISSUER_ID` | the Issuer ID from the In-App Purchase keys page |
| `VVV_APPLE_IAP_PRIVATE_KEY` | the `.p8` file's contents, pasted whole or base64-encoded |
| `VVV_APPLE_ACCOUNT_TOKEN_SECRET` | a long random string generated once (`openssl rand -base64 48`); never change it after launch |
| `VVV_APPLE_APP_APPLE_ID` | the app's numeric Apple ID (required while Production is accepted) |
| `VVV_APPLE_ENVIRONMENTS` | `Production` (default) or `Production,Sandbox` for a deployment used with TestFlight and Sandbox testers |
| `VVV_PRICE_APPLE_STANDARD_MONTHLY` | `sacoro.standard.monthly` |
| `VVV_PRICE_APPLE_STANDARD_YEARLY` | `sacoro.standard.annual` |

`VVV_COMMERCE_ENABLED` must be on for the app to sell, as for the other rails.

Everything fails closed. Anything missing: `apple_prepare` reports
`provider_not_configured`, the app shows "Subscriptions are not available in
the app yet", and the webhook answers 503 `APPLE_NOT_CONFIGURED` naming the
missing variables (never their values).

**Production and TestFlight on one deployment.** If the production deployment
accepts `Sandbox` so that TestFlight testers can buy, any TestFlight tester can
create a sandbox subscription that grants real access on production. Either
accept that for the testing period and remove `Sandbox` before launch, or test
on a preview deployment (a TestFlight build always loads
`https://app.velvetviking.co.uk`, so that would need a separate build).
**Founder to decide** (section 7).

---

## 6. What was verified, and what was not

**Verified here:**

- The whole suite (`npm test`), including `test/m17-appleInAppPurchase.test.js`:
  Apple-signed data against a locally generated test CA built like Apple's
  (valid; wrong root; a trusted root copied into `x5c` but not the signer; bad
  signature; edited payload; wrong bundle id; wrong environment, including
  Xcode-signed data; expired leaf; data signed before expiry; signed in the
  future; each missing Apple OID; wrong chain length; wrong algorithm); the
  embedded root's fingerprint; **Apple's real WWDR G6 intermediate and an Apple
  App Store signing leaf chain to the embedded root and carry the two OIDs**
  (they fail only at the signature, which the test forges); the API token and
  the eligibility JWS claims; the appAccountToken; every status's mapping; the
  routes through the real router against a fake App Store Server API and a fake
  Supabase (somebody else's purchase refused and not finished; the device's own
  copy not believed over Apple's; a purchase never changes hands; a second live
  subscription refused; the trial spent once and every later signature says
  "not eligible"; a trial that slips through refused; a plan change stays one
  row; a resubscribe outside the app does not become a second trial; forged and
  wrong-environment transactions refused before Apple is asked); the webhook
  branch chosen by the request, TEST, duplicates, renewals, refunds; the runtime
  (iOS with the plugin uses StoreKit, iOS without it and Play, the website and
  the website APK are unchanged; disclosures; signatures passed to StoreKit;
  finish only after the server admits; recovery, updates, Restore Purchases;
  Settings); the Xcode project includes and compiles both Swift files; the
  deployment target.
- The current Apple documentation for the purchase option, its availability,
  the JWS claims and `appTransactionID` availability (sources below), and
  Apple's own App Store Server Library 3.1.0 for the verification steps, the
  status values, the API hosts and the eligibility signature.

**Not verified (needs a Mac, Apple credentials or a device):**

- **The Swift has not been compiled.** There is no Swift toolchain here. It was
  written against the documented StoreKit 2 and Capacitor 8 APIs (and Capacitor
  8.5.0's own sources for `registerPluginInstance`, `capacitorDidLoad`,
  `CAPBridgedPlugin` and `notifyListeners(_:data:retainUntilConsumed:)`). The
  first `build-ios.yml` run's Simulator step is the compile check. The parts
  most worth watching: `introductoryOfferEligibility(compactJWS:)` (needs the
  iOS 18.4 SDK; guarded with `#if compiler(>=6.1)`, and without it the purchase
  is refused rather than made on Apple's own trial rule),
  `AppTransaction.appTransactionID`, and Swift concurrency warnings in the
  `Transaction.updates` task.
- Any call to Apple: the App Store Server API, a real notification, Apple's
  real signed data (only Apple's real certificate chain was checked);
- a purchase on a device: that the App Store applies or removes the free week
  as signed, the sheet, Ask to Buy, Restore Purchases, the manage sheet;
- **whether `allowIntroductoryOffer: true` grants the trial to an Apple Account
  that Apple itself considers ineligible** (for example one that had a trial
  under a different SACORO account). Apple's text says the system "applies or
  removes the offer"; the app shows the trial on SACORO's verdict. Test this in
  Sandbox; if Apple does not apply it, the athlete is charged on day one while
  the screen promised a trial, and the screen must then also require
  `isEligibleForIntroOffer` (one line in `appleFigures`);
- OCSP revocation checking of Apple's certificates (Apple's library makes it
  optional; not implemented).

## 7. Decisions the founder must confirm

- **Legal wording.** No new legal wording was written. The disclosures reuse
  the account page's "renews ... until you cancel" sentence and the existing
  links. But: (a) the immediate-start text (`IMMEDIATE_START_TEXT`, not yet
  solicitor-reviewed) says "Your 7-day free trial starts now" and promises a
  refund within 14 days: for an Apple purchase **without** a trial the first
  sentence is untrue, and **refunds of Apple purchases are made by Apple, not
  SACORO**; (b) the new in-app sentences ("Payment is handled by the App
  Store.", "Use Manage Subscriptions to cancel it.") need the same review.
- **EULA.** Apple requires a Terms of Use (EULA) link. Either use Apple's
  **Standard EULA** (and link it,
  https://www.apple.com/legal/internet-services/itunes/dev/stdeula/, in the
  description) or enter SACORO's Terms of Service as a **custom EULA** in App
  Store Connect. The app links SACORO's Terms of Service; if the Standard EULA
  is chosen, say so in the description too.
- **Refusal after payment** is not refunded by the server (Apple has no
  equivalent of Play's unacknowledged-purchase refund); the athlete is told to
  cancel in Manage Subscriptions. Confirm, or decide on a support process.
- **Apple's free week on a resubscribe outside the app** (section 1) is not
  granted as SACORO access. Confirm, or decide to accept it.
- **Sandbox on the production deployment** during TestFlight (section 5).
- **Two SACORO accounts on one Apple Account**: the subscription stays with the
  first.
- **The appAccountToken scheme** (HMAC of the account id under a dedicated
  secret).
- **Apple's commission** (15% under the Small Business Program, otherwise 30%,
  15% after a subscriber's first year) is out of scope here but now real.
- **Commerce switch.** The iOS build sells only while `VVV_COMMERCE_ENABLED`
  is on.

## Sources

- Apple, `Product.PurchaseOption.introductoryOfferEligibility(compactJWS:)`:
  https://developer.apple.com/documentation/storekit/product/purchaseoption/introductoryoffereligibility(compactjws:)
- Apple, *Generating JWS to sign App Store requests* (header, claims, no exp,
  the `introductory-offer-eligibility` audience):
  https://developer.apple.com/documentation/storekit/generating-jws-to-sign-app-store-requests
- Apple, SwiftUI `subscriptionIntroductoryOffer(applyOffer:compactJWS:)` ("applies
  or removes the offer ... according to the offer eligibility preference"):
  https://developer.apple.com/documentation/swiftui/view/subscriptionintroductoryoffer(applyoffer:compactjws:)
- Apple, `AppTransaction.appTransactionID` (iOS 16.0+):
  https://developer.apple.com/documentation/storekit/apptransaction/apptransactionid
- Apple, *Implementing introductory offers in your app* (eligibility per
  subscription group; no intro offer on upgrade, downgrade or crossgrade):
  https://developer.apple.com/documentation/storekit/implementing-introductory-offers-in-your-app
- Apple, *Get All Subscription Statuses*:
  https://developer.apple.com/documentation/appstoreserverapi/get-all-subscription-statuses
- Apple App Store Server Library (Node), `jws_verification.js`,
  `jws_signature_creator.js`, `models/Status.js`, API hosts:
  https://github.com/apple/app-store-server-library-node (npm
  `@apple/app-store-server-library` 3.1.0)
- Apple PKI, Apple Root CA - G3: https://www.apple.com/certificateauthority/
