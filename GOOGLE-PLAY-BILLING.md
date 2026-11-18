# Google Play Billing: what was built, and what the founder must do

**Why this exists.** Play Console offered only "Upload a new APK" instead of
"Create subscription", because no uploaded build declared the
`com.android.vending.BILLING` permission. Play unlocks subscription products
for an app only after a build that uses the Play Billing Library has been
uploaded. This branch adds Play Billing properly, so a signed AAB for internal
testing can be produced, uploaded, and the subscription created against it.

**What it is not.** It does not change who gets access, the trial length, the
pause policy, one live subscription per athlete, or one trial per athlete
across all rails. `api/_entitlement.js` is untouched. Google Play is a new
**channel** (the `google` value on the existing provider axis) feeding the same
provider-neutral core the web rail feeds. See `STORE-COMMERCIAL-BOUNDARY.md`
and `COMMERCIAL-CORE.md`.

Nothing in this branch has been deployed, pushed, or configured in Vercel,
Supabase, Google Cloud or Play Console.

---

## 1. What was built

| Where | What |
|---|---|
| `android/app/build.gradle` | `com.android.billingclient:billing:9.1.0` (current stable, released 18 June 2026; Play requires 8 or later for new uploads). `versionCode 11`, `versionName "1.10"`. |
| `android/app/src/main/AndroidManifest.xml` | `<uses-permission android:name="com.android.vending.BILLING" />`, stated explicitly (the library also merges it). |
| `SacoroBillingPlugin.java` (registered in `MainActivity`) | Capacitor plugin `SacoroBilling`: `isReady`, `connect` (with retry), `getProducts({productId})`, `purchase({productId, basePlanId, offerToken, obfuscatedAccountId})`, the `purchaseUpdated` event, `queryActivePurchases`, `openManageSubscription`. **It never acknowledges a purchase.** |
| `.github/workflows/build-apk.yml` | A `play_store_build` input (default off) that adds `"appendUserAgent": "SACORO-Store-Build"` to the runner's copy of `capacitor.config.json` and names the signed artifact `velvet-viking-valhalla-PLAY-STORE`. |
| `api/_google.js` | The adapter: service-account sign-in (RS256 JWT, node crypto), `purchases.subscriptionsv2.get`, `purchases.subscriptions.acknowledge`, the state mapping, the Pub/Sub push token verification. |
| `api/_google-purchase.js` | "May this athlete buy" (prepare) and "may this purchase stand" (admit), shared by the app's verify call and Google's notifications. |
| `api/_subscription.js` | `POST /api/subscription {action:'google_prepare'}` and `{action:'google_verify', purchaseToken, productId}`, authenticated with the athlete's own token. |
| `api/billing-webhook.js` | The Google branch, chosen by `?rail=google` on the request URL. |
| `protected/velvet-viking-valhalla.html` | In the Android Play Store build only: the journey's trial screen and the Settings subscription controls use Play Billing. |

No new serverless function was added (both routes ride existing routers), and
no database change is needed: `subscriptions.provider`,
`billing_events.provider` and `account_commercial.trial_consumed_provider`
already accept `'google'` (`supabase-commercial-core.sql`).

### How a purchase flows

1. The app asks the server `google_prepare`. The server answers with the Play
   product and base plans it sells (from the environment), whether the
   athlete may buy (commerce switched on, Google configured, United Kingdom,
   the two agreements on record, no live subscription on any rail), whether
   they may have the free trial **under SACORO's own one-trial-per-athlete
   rule**, and the athlete's `obfuscatedAccountId`.
2. The app asks Play for the prices (localised, as Play returns them) and shows
   Annual and Monthly. It passes Play the **trial offer only if the server says
   the athlete is eligible and Play offers one**; otherwise the base plan's own
   offer (no trial).
3. Play's purchase sheet takes the payment. The app sends the purchase token to
   `google_verify` with the athlete's own access token.
4. The server reads the purchase **from Google**, checks the obfuscated id is
   this athlete's, applies the one-live-subscription and one-trial rules,
   writes it through `_billing-apply.js` (the same code the web rail uses:
   subscription row, agreed price, trial allowance spent, entitlement
   re-projected), and only then **acknowledges** it with Google.
5. The app asks `/api/session` again; the journey sees `subscription_trial` and
   moves to Welcome to SACORO, exactly as on the web rail.

**A purchase the server refuses is never acknowledged, and Google refunds and
revokes an unacknowledged purchase after three days.** That is the backstop for
somebody else's purchase, a second live subscription, or a second trial. If
you would rather refund such a purchase at once, refund and revoke it in Play
Console (Order management); the server does not do that by itself.

Any purchase Play holds that the server has not acknowledged (the app closed
under Play's sheet, no signal) is sent to the server again on every app start
and on every return to the foreground.

### The obfuscated account id

`obfuscatedAccountId` = base64url(HMAC-SHA256(`VVV_GOOGLE_ACCOUNT_ID_SECRET`,
`"sacoro-play-account:" + account id`)): 43 characters, one-way, never the
account id itself. The server hands each athlete their own value; the app never
computes it. A purchase is attached to an account only when the id Google
echoes back matches. **Choose the secret once and do not change it**: a
purchase already recorded keeps its owner, but a change would make the
server refuse new purchases made from an id handed out under the old secret,
and break attribution of a Play Store resubscribe to an old purchase.

### What each Google state becomes

| Google `subscriptionState` | SACORO condition |
|---|---|
| `ACTIVE`, free-trial phase (`offerPhase.freeTrial`) | `trialing` (trial ends at `expiryTime`) |
| `ACTIVE`, paid | `active` (`cancelled` if auto-renew is off) |
| `CANCELED`, still in the free trial | `trialing` with cancel-at-period-end, as Stripe reports a cancelled trial |
| `CANCELED`, expiry in the future | `cancelled` (access to `expiryTime`) |
| `CANCELED`, expiry passed | `expired` |
| `IN_GRACE_PERIOD` | `past_due`, grace until Google's `expiryTime` (nothing added by SACORO) |
| `ON_HOLD` | `past_due`, no grace, no access |
| `PAUSED` | `past_due`, no grace, no access (see "Pause" below) |
| `EXPIRED`, `PENDING_PURCHASE_CANCELED` | `expired` |
| revoked or refunded (notification type 12, or a voided-purchase notification) | `revoked`, but only when Google's own re-read shows the purchase is no longer entitled |
| `PENDING` or anything unknown | refused; nothing recorded |

---

## 2. The identifiers the code expects

Create exactly these in Play Console (Monetize with Play, Products,
Subscriptions):

| | ID | Details |
|---|---|---|
| Subscription product | `sacoro_standard` | name "SACORO Standard" |
| Base plan | `monthly` | auto-renewing, billing period **1 month (P1M)**, price **£11.99** (GBP, United Kingdom) |
| Base plan | `annual` | auto-renewing, billing period **1 year (P1Y)**, price **£79.99** |
| Offer on `monthly` | `free-trial-7d` | one phase: **free trial, 7 days**; eligibility **new customer acquisition** ("Never had this subscription") |
| Offer on `annual` | `free-trial-7d` | the same |

These match `api/_products.js`, which this branch does not change. Do not
create other offers on these base plans: the app treats an offer with a
free-trial phase as "the trial" and the base plan's own offer as "no trial".

Play's own eligibility is per Google account. SACORO's rule is per athlete
across every rail, and the server applies it on top: an athlete who already had
a trial (on the web or on Play) is offered the base plan, and a Play trial for
such an athlete is refused (never acknowledged).

**Pause.** SACORO's pause policy runs on SACORO's side. If Play Console offers
subscription pause for these base plans, turn it off; a Play pause is recorded
as no access (`past_due` with no grace) rather than as a SACORO pause.

**Grace period and account hold.** Leave Google's defaults or set your own; the
server honours whatever grace Google reports and adds nothing.

---

## 3. Order of operations

1. **Approve and merge this branch** (it is committed locally only, on
   `m16-play-billing`). Nothing works in production until it is deployed.
2. **Build the Play AAB in CI.** GitHub, Actions, "Build Android APK", "Run
   workflow": leave `ref` blank (or name the merged commit), tick
   **`play_store_build`**, run. The suite runs first; a red suite builds
   nothing. Download the artifact **`velvet-viking-valhalla-PLAY-STORE`**: the
   `.aab` inside is the one to upload. (The four `ANDROID_KEYSTORE_*` secrets
   are needed, as for any signed release.)
3. **Upload that AAB to internal testing first** (Play Console, Testing,
   Internal testing, Create new release). This is what unlocks "Create
   subscription": Play sees a build with the Billing Library and the BILLING
   permission. It can take a little while after the upload for the
   Subscriptions page to change.
4. **Create the subscription** exactly as in section 2, and activate both base
   plans and both offers.
5. **Google Cloud** (project `sacoro-billing`):
   1. Enable the **Google Play Android Developer API**.
   2. Create a service account for the server (for example
      `play-billing-server@sacoro-billing.iam.gserviceaccount.com`) and create a
      **JSON key** for it. This key is `VVV_GOOGLE_PLAY_SERVICE_ACCOUNT`.
   3. In **Play Console, Users and permissions, Invite new user**, invite that
      service account's email, give it access to the SACORO app with at least
      **View financial data, orders and cancellation survey responses** and
      **Manage orders and subscriptions**. (Granting new permissions can take
      up to a day to take effect for the API.)
6. **Real-time developer notifications.**
   1. The topic `projects/sacoro-billing/topics/sacoro-play-billing` exists.
      Grant **`google-play-developer-notifications@system.gserviceaccount.com`**
      the **Pub/Sub Publisher** role on it.
   2. Play Console, Monetize with Play, Monetization setup, Real-time developer
      notifications: topic name
      `projects/sacoro-billing/topics/sacoro-play-billing`; notifications for
      subscriptions (all of them).
   3. Create a **push subscription** on that topic:
      - endpoint **`https://app.velvetviking.co.uk/api/billing-webhook?rail=google`**
      - **Enable authentication**, with a service account for the push (for
        example `rtdn-push@sacoro-billing.iam.gserviceaccount.com`; the Pub/Sub
        service agent needs Service Account Token Creator on it if Google
        Cloud does not grant that automatically)
      - **Audience**: leave it as the endpoint URL or set it explicitly; either
        way, `VVV_GOOGLE_RTDN_AUDIENCE` must be exactly the same string
      - acknowledgement deadline 60 seconds, retry with exponential backoff.
7. **Vercel environment variables** (Production; Preview only if you test on a
   preview deployment). Names only; see section 4 for what goes in each.
8. **Redeploy** so the server reads them. Then in Play Console send a **test
   notification**: the server answers 200 and logs `GOOGLE_TEST_NOTIFICATION`,
   and applies nothing.
9. **Licence testers.** Play Console, Setup, License testing: add the testers'
   Google accounts. Add them to the internal testing track, have them accept
   the opt-in link and install SACORO **from Play** (not the website APK).
   With `VVV_COMMERCE_ENABLED` on (the server will not sell while commerce is
   off), sign in, reach the trial screen, buy with a test card. Expect:
   - Play's prices on the trial screen, and the free trial only for an athlete
     who has never had one;
   - after purchase, Welcome to SACORO; Settings shows **Manage in Google
     Play**;
   - in Supabase, a `subscriptions` row with `provider = 'google'` and
     `environment = 'sandbox'`, the trial spent on `account_commercial` with
     `trial_consumed_provider = 'google'`, and `billing_events` rows for the
     notifications;
   - test subscriptions renew on a shortened schedule, so renewals, cancel,
     grace and expiry can be watched in the logs (`GOOGLE_APPLIED ...`).
   Check also: an athlete with a live web subscription is refused in the app
   ("You already have a subscription on this account"), and the Play purchase
   is not acknowledged.
10. Only then promote a build to closed or production testing.

---

## 4. Vercel environment variables (names)

| Name | Value |
|---|---|
| `VVV_GOOGLE_PLAY_SERVICE_ACCOUNT` | the service account's JSON key file, pasted whole or base64-encoded |
| `VVV_GOOGLE_ACCOUNT_ID_SECRET` | a long random string generated once (for example `openssl rand -base64 48`); never change it after launch |
| `VVV_PRICE_GOOGLE_STANDARD_MONTHLY` | `sacoro_standard:monthly` |
| `VVV_PRICE_GOOGLE_STANDARD_YEARLY` | `sacoro_standard:annual` |
| `VVV_GOOGLE_RTDN_AUDIENCE` | the push subscription's audience, exactly (the endpoint URL above unless you set another) |
| `VVV_GOOGLE_RTDN_SERVICE_ACCOUNT` | the push subscription's service account email |

Existing switches still apply: `VVV_COMMERCE_ENABLED` must be on for the app
to sell, as for the web.

Everything fails closed. Missing service account, secret or price identifiers:
`google_prepare` reports `provider_not_configured` and the Play build shows
"Subscriptions are not available in the app yet" (today's behaviour). Missing
RTDN audience or service account: the webhook answers 503
`GOOGLE_RTDN_NOT_CONFIGURED` and names the missing variables (never their
values).

---

## 5. What was verified, and what was not

**Verified here:**

- The whole suite (`npm test`), including `test/m16-playBilling.test.js`:
  every Google state's mapping; the service-account assertion; the Pub/Sub
  token (valid, wrong audience, wrong email, expired, bad signature, edited
  claims, wrong algorithm, unknown or rotated key, nothing configured); the
  verify route through the real router against a fake Google and a fake
  Supabase (somebody else's purchase refused, a second live subscription
  refused, the trial spent once and a second Play trial refused, nothing
  refused ever acknowledged); the webhook branch chosen by the request, test
  notifications, duplicates, renewals, revocation, plan changes; the runtime
  (the Android Play Store build uses Play with Play's prices; iOS, the website
  and the website-distributed APK unchanged; the trial offer only when
  eligible; cancel and error messages; recovery); the manifest, versionCode
  and the workflow input.
- `SacoroBillingPlugin.java` and the `MainActivity` change compile with `javac`
  (JDK 21) against Android 16's `android-all` jar (Robolectric, Maven Central),
  Capacitor's real `JSObject`, `JSArray`, `PluginCall`, `PluginResult` and
  annotations, and **hand-written stubs of the Play Billing Library's documented
  9.x API** (the real AAR is on dl.google.com, which this environment cannot
  reach).

**Not verified (needs an Android SDK, Google credentials or a device):**

- a Gradle build (`assembleRelease` / `bundleRelease`) and the merged manifest;
- the plugin against the real Billing Library 9.1.0 binary (signatures were
  checked against its documentation only);
- any call to Google: the token exchange, `subscriptionsv2.get`,
  `subscriptions.acknowledge`, the Pub/Sub push's real token, Google's real
  certificate set;
- a purchase on a device, Play's offer eligibility, the `offerPhase` field on
  live responses (a fallback exists if it is absent), Play's handling of the
  `free-trial-7d` ids;
- the Play Console "Create subscription" unlock itself.

## 6. Decisions to confirm

- **Agreement wording.** The Play screens reuse the existing two ticks and the
  existing `{action:'agree'}` record, and the server requires them before Play
  is opened, exactly as the web checkout does. No new legal wording was
  written. But the immediate-start text (`IMMEDIATE_START_TEXT` in
  `api/_agreements.js`) says "Your 7-day free trial starts now" and promises a
  refund within 14 days: for a Play purchase **without** a trial (an athlete
  who already had theirs) the first sentence is not accurate, and a refund on a
  Play purchase has to be issued through Play Console. This needs a decision
  (and the solicitor's review already pending for that text).
- **The obfuscated account id scheme** above (HMAC of the account id under a
  dedicated server secret).
- **Refusal by non-acknowledgement** rather than an immediate server-side
  revoke-and-refund.
- **Play pause off**, and Play's pause recorded as no access.
- **Commerce switch.** The Play build sells only while `VVV_COMMERCE_ENABLED`
  is on, like the web.
