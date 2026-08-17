# Store readiness — Google Play and the Apple App Store

State of the native shells as release artifacts, and everything that has to
happen outside this repository. Written against the actual project, not against
a generic checklist: where something does not exist, this says so.

Nothing here changes the product. The web app, the private beta, the Supabase
schema, the coaching engine and both commercial flags are untouched.

---

## 1. What exists today

| | Android | iOS |
|---|---|---|
| Native project | `android/`, Capacitor 8.5.0 | `ios/`, created in this workstream |
| Identifier | `com.velvetviking.valhalla` | `com.velvetviking.valhalla` |
| SDK floor / target | minSdk 24, target/compile 36 | deployment target 15.0 |
| Toolchain | AGP 8.13.0, Gradle 8.14.3, JDK 21 | Xcode 26 + iOS 26 SDK required by Apple from 28 Apr 2026 |
| Auth callback | intent-filter, custom scheme + https App Link | `CFBundleURLTypes`, custom scheme |
| Deep-link verification | `assetlinks.json` served, **unverified** | `apple-app-site-association` **not served** — needs a Team ID |
| Signing | plumbing complete, secrets **not set** | **nothing** — needs an Apple team |
| Store artifact | AAB built by CI when secrets exist | **blocked on macOS + Xcode** |
| Privacy manifest | n/a | `PrivacyInfo.xcprivacy` present |
| Permissions | `INTERNET` only | none |

**The shell is a WebView pointed at `https://velvet-viking-valhalla-1.vercel.app`.**
It does not bundle the app. `www/index.html` is a one-paragraph "you need a
connection" page and `sw.js` says of itself: *"No caching/offline behavior is
implemented."* That single fact drives most of section 5.

---

## 2. Android — Play readiness

### Release format
Play requires an **Android App Bundle** for new apps. CI already runs
`bundleRelease` and uploads the `.aab`; the release APK beside it is for direct
device verification only and must not be uploaded. Both are named
`velvet-viking-<shellVersion>-<versionCode>-<shortSha>.{aab,apk}` with a
`SHA256SUMS.txt` and a `PROVENANCE.txt`.

### Signing — the one thing that matters most
The four `VVV_KEYSTORE_*` secrets are **not set**, so:
- CI builds a debug APK signed with a throwaway key that changes every run;
- `bundleRelease` is skipped rather than attempted, because the release build
  type has no debug fallback and fails loudly without them.

`vvv-release.keystore` exists outside the repository. Adding the four secrets
(`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD` — see `ANDROID-APP-LINKS.md`) turns the release build on.

> **The App Links fingerprint will change once Play is involved, and this is the
> trap.** With **Play App Signing** — which is mandatory for new apps — Google
> re-signs the AAB with an *app signing key* it holds. The certificate on a
> Play-installed build is therefore **not** `vvv-release.keystore`; that becomes
> the *upload* key only. `assetlinks.json` currently carries the upload key's
> fingerprint alone, so App Links will not verify for Play installs.
>
> After creating the app in Play Console, copy the **SHA-256 of the app signing
> certificate** from *Release → Setup → App signing* and add it to
> `assetlinks.json` **alongside** the existing one. The array holds several
> fingerprints on purpose: keeping both means sideloaded verification builds and
> Play installs both verify.

### Target API
`developer.android.com/google/play/requirements/target-sdk`: from **31 August
2026**, new apps and updates must target **API 36**. The project already targets
**36** and compiles against **36**. **Already compliant, two weeks ahead of the
deadline. No change required.**

### Permissions
Exactly one: `android.permission.INTERNET` — **required**, the shell cannot load
its UI without it.

Deliberately absent, and each would carry a real declaration burden: location and
background location (Play demands a video justification), `ACTIVITY_RECOGNITION`,
`BODY_SENSORS`, health, exact alarms, foreground service, external storage,
media, camera, microphone, `POST_NOTIFICATIONS`.

None is needed. Pace and distance are typed in or imported from Strava
**server-side**; the export goes through the share sheet rather than to storage;
and notifications are the Web Notifications API, which an Android WebView does
not implement at all — see section 6.

### Backup — fixed here
`allowBackup` was `true`. The WebView's `localStorage` holds `vvv_cloud_session`,
which is the Supabase **access and refresh token**, so Android Auto Backup was
copying a live credential to the athlete's Google Drive. Now `false`, with
`dataExtractionRules` (Android 12+) and `fullBackupContent` (11 and below) both
excluding the data directory.

Cost, stated plainly: restoring onto a new phone no longer carries the plan or
the session across. The athlete signs in again and `cloudReconcile()` pulls the
plan from their account — the path every second device already takes.

### Network and WebView
- `usesCleartextTraffic` unset; targetSdk 36 defaults it off. No
  `networkSecurityConfig`, so the platform default stands.
- Capacitor 8 sets `webContentsDebuggingEnabled` from the debuggable flag
  (`CapConfig.java`: default `isDebug`), so **release is not inspectable** and
  debug still is. Left at the default rather than pinned, so the beta APK stays
  debuggable; a test asserts the config never overrides it to `true`.
- `res/xml/config.xml` carries a Cordova-era `<access origin="*" />`. It is
  **inert under Capacitor** (which uses `server.allowNavigation`, unset here) and
  is regenerated by `cap sync`, so it is not edited.
- Supabase is reached by `fetch`, not by navigation, so no navigation allowlist
  is required.

### Versioning — fixed here
`versionCode` was hardcoded `1`, uploadable to Play exactly once ever. Now
`System.getenv("VVV_VERSION_CODE")` with CI supplying `github.run_number`;
falls back to `1` locally so nothing changes for a laptop build.

---

## 3. iOS — App Store readiness

The project was created in this workstream with `npx cap add ios`. **It worked on
Linux** because Capacitor 8 uses Swift Package Manager rather than CocoaPods.

### Fixed here
- **`CFBundleURLTypes`** — the iOS half of the Android intent-filter. Without it
  the magic link has nowhere to land and **iOS sign-in cannot work at all**. Same
  scheme string as Android, so one Supabase Redirect URL entry serves both.
- **`PrivacyInfo.xcprivacy`** — **required**, not optional.
  `@capacitor/filesystem`'s own README states it: an app using that plugin must
  declare `NSPrivacyAccessedAPICategoryFileTimestamp` with reason `C617.1`.
  Valhalla does use it (`canNativeShareFiles()` → `nativeSaveTextFile()`).
  Tracking is declared `false` and the collected-data array is empty — the bundle
  collects nothing on its own account, and what the *product* collects belongs in
  the App Privacy questionnaire (`STORE-DATA-INVENTORY.md`).
- **`UIRequiredDeviceCapabilities`** `armv7` → `arm64`. The template ships 32-bit
  ARM, which no device at deployment target 15.0 can be.

### Prepared, not activated
- `apple-app-site-association.json.template` — designed, valid JSON, **not
  served**. Publishing one with a placeholder `appID` is worse than publishing
  none: Apple's CDN caches it and a cached invalid file takes days to clear.
  Activation is three edits, listed inside the file.
- `ios/App/App/App.entitlements.template` — Associated Domains, same reason.

Universal links are **not required for sign-in**. The custom scheme carries the
magic link today with no Team ID and no hosted file, exactly as on Android.

### Open iOS decisions — HQ's, not mine
| Decision | Recommendation |
|---|---|
| Bundle identifier | Keep `com.velvetviking.valhalla` permanently. It matches Android, and Apple locks it to the App Store record on first upload. |
| `TARGETED_DEVICE_FAMILY` | Currently `1,2` (iPhone + iPad). The layout is phone-designed (verified at 412×915). Either set it to `1` for the first release or budget an iPad pass — an unoptimised iPad build invites a 4.2 rejection and needs its own screenshots. **Recommend `1`.** |
| Deployment target | 15.0 (Capacitor's floor) is fine. Raising it buys nothing here. |
| Orientation | Landscape is allowed on both platforms today. Parity kept; worth a look before submission. |

### The external build gate
A distributable `.ipa` needs **macOS + Xcode 26 + an Apple Developer Program
team**. None exists in this environment. Everything checkable without a Mac is
checked on every push by the `validate-ios` CI job (25 assertions).

---

## 4. Google Play Console — external checklist

Nothing below can be done from this repository. Answers are mapped to product
facts; none is invented.

| Step | What to do / the factual answer |
|---|---|
| Developer account | **Organisation**, not personal. Personal accounts show a real name publicly and require 12 testers × 14 days before production for new personal accounts. An organisation account needs a D-U-N-S number. |
| Legal verification | Velvet Viking Ltd details, address, D-U-N-S. **HQ supplies; not derivable here.** |
| Create app | Name **Velvet Viking**; default language en-GB; app, not game; free. |
| Package name | `com.velvetviking.valhalla` — **locked forever on first upload.** Every existing beta APK is keyed to it. Do not change it. |
| Play App Signing | Mandatory. **Then copy the app signing SHA-256 into `assetlinks.json`** (section 2). |
| Category | Health & Fitness. |
| Contact / support email | HQ (`support@velvetviking.co.uk` is already the address in `admin-user.js`). |
| Privacy policy URL | `https://velvet-viking-valhalla-1.vercel.app/privacy` — already served, already routed. |
| Data safety form | Answer from `STORE-DATA-INVENTORY.md`. Key answers: data **is** collected, **is** linked to identity, **is not** shared with third parties, **is not** used for advertising or tracking, deletion **is** offered in-app, transit encryption **yes**. |
| Content rating | IARC questionnaire. Factually: no violence, no sexual content, no gambling, no user-to-user communication, no location sharing. Expect 3+/PEGI 3. |
| Target audience | 18+. Not designed for children; no Families policy obligations. |
| Ads | **No ads.** |
| App access | The private beta is allowlisted, so **reviewer instructions are mandatory**: either add the reviewer's address to `beta_allowlist`, or state that all content is behind a sign-in and provide credentials. Play rejects "login required" with no way in. |
| Testing tracks | Internal testing first (up to 100 testers, no review). Then closed. |
| Production rollout | Staged, 20% first. |
| Store listing assets | Section 8. |
| Release notes | From `PROVENANCE.txt` + `RELEASE-VERSION-MODEL.md`. |

---

## 5. Thin-web-wrapper risk — the honest assessment

### Apple, guideline 4.2

> *"Your app should include features, content, and UI that elevate it beyond a
> repackaged website. If your app is not particularly useful, unique, or
> 'app-like,' it doesn't belong on the App Store."*

**Risk: MODERATE-TO-HIGH, and it concentrates on one fact.**

What genuinely native value already exists — evidence, not assertion:

1. **Deep-link auth integration.** The shell registers a URL scheme and handles
   both cold start (`App.getLaunchUrl()`) and warm start (`appUrlOpen`) →
   `handleAuthDeepLink()`, parsing tokens from fragment *or* query. A browser
   cannot do this. Real, and reviewer-visible if they sign in.
2. **Native file export.** `nativeSaveTextFile()` writes the backup into the app
   container via `@capacitor/filesystem` and hands it to the system share sheet
   via `@capacitor/share`. Implemented *because* a `blob:` download does nothing
   in a WebView. Real, and demonstrable.
3. **Installed app identity** — launcher/adaptive icons, splash, app name.

What does **not** exist, and is the thing Apple will find:

> **The app cannot start without a network.** `sw.js` states it: *"No
> caching/offline behavior is implemented."* `_access.js` states it: *"Android
> cannot cold-start offline and no service worker caches the app."* Open the app
> in airplane mode and it shows `www/index.html`, a single paragraph asking for a
> connection. From a reviewer's seat that is indistinguishable from a bookmark.

**Smallest realistic mitigation, in order of value per unit of risk:**

| # | Change | Why it is the smallest thing that works |
|---|---|---|
| **1** | **Bundle the runtime and load it locally**, syncing content rather than the whole UI. `webDir: "www"` already exists; the runtime is a single 908 KB file. Drop `server.url`, copy `protected/velvet-viking-valhalla.html` into `www/` at build time, and the app opens, renders a plan and logs a session with no signal — because the engine is already fully client-side and deterministic. | Turns the strongest objection into the strongest answer, and needs **no new features**. It is a build-step change, not a product change. Its cost is that a web fix then needs a store release, which is exactly what `RELEASE-VERSION-MODEL.md` exists to manage. |
| **2** | **Local notifications** via `@capacitor/local-notifications` for the 08:00 reminder. The scheduler and the copy already exist; only the delivery mechanism is web-only, and a WebView does not implement it. | A scheduled local notification is categorically native, is genuinely useful, and the feature is already designed — this is wiring, not invention. |
| 3 | Keep the share-sheet export and deep-link auth, and **show them to the reviewer** in App Review notes. | Costs nothing; reviewers do not go looking. |

**Recommended against:** haptics, splash animations, a native settings screen, or
anything else added only to look native. Apple's own text is about *utility*, not
about API count, and 4.2 rejections are argued with utility.

**#1 is an architecture decision with beta consequences and is HQ's call. It is
recommended, not implemented.**

### Apple, other applicable guidelines

- **5.1.1(v) account deletion** — *"If your app supports account creation, you
  must also offer account deletion within the app."* **Already satisfied**:
  `handleCloudDeleteAccount()` in Settings calls `delete_own_account()`, and the
  locked shell reaches `/api/account-delete` without any entitlement. Better than
  most submissions.
- **4.2.3(i)** works standalone — yes.
  **4.2.3(ii)** discloses download size — the shell downloads its UI on first
  launch; no size is disclosed. Mitigation #1 removes the question entirely.
- **Sign in with Apple (4.8)** — required only where a *third-party* social login
  is offered. Valhalla uses its **own** email magic link. **Not applicable.**
- **Privacy manifest** — present. Required-reason API declared.
- **ATT / tracking** — no advertising identifier, no analytics, no tracker. No
  prompt, no `NSUserTrackingUsageDescription`, `NSPrivacyTracking` false.

### Google Play, minimum functionality

**Risk: LOW.** Play's *Spam and Minimum Functionality* policy targets apps that
crash, do nothing, or exist only to show a webpage with no added value. It has no
4.2 equivalent and WebView-based apps are routinely accepted. Combined with a
single-permission manifest, no ads, a served privacy policy and in-app account
deletion, this is a straightforward Play submission.

The one Play-specific hazard is **App access**: an allowlisted private beta with
no reviewer route is a certain rejection. Handled in section 4.

---

## 6. Notifications — a factual note

The 08:00 reminder uses the **Web Notifications API** (`new Notification(...)`,
`registration.showNotification()`). An Android WebView does not implement it, so
`typeof Notification !== 'undefined'` is false and `renderNotifyToggleRow()`
correctly reports it unsupported. iOS `WKWebView` does not implement it either.

Consequences: **no `POST_NOTIFICATIONS` permission is needed** (good — one fewer
Data Safety answer), and **notifications must not be listed as a feature in either
store listing**. Making them work is mitigation #2 above.

---

## 7. Native distribution — recommendation

### Android

| Audience | Path | Why |
|---|---|---|
| **Current 5 testers** | **Keep direct APK.** | It works today, needs no Google account, no review, and no store listing. Changing distribution mid-beta risks the beta for no benefit. **Set the four signing secrets** so builds install as updates instead of failing on a signature mismatch — that is the one improvement worth making now. |
| **Next 20–100** | **Play Internal Testing.** | Up to 100 testers, no review, minutes to publish, real update mechanism, real Play App Signing — which is also how you obtain the app signing fingerprint you need for `assetlinks.json`. Requires the developer account and an AAB. |
| **Public launch** | Closed → open → staged production at 20%. | Closed testing is also where Play's own pre-launch report gives free device coverage. |

### iOS

| Stage | Path | Why |
|---|---|---|
| First | **None possible yet.** | No Apple team, no Mac, no signing. Direct install is not a realistic path on iOS: ad-hoc needs registered UDIDs and a paid team anyway. |
| Then | **TestFlight internal** (up to 100 users on the team, no review). | Fastest signal once an Apple team and a Mac exist. |
| Then | **TestFlight external** (up to 10,000, needs Beta App Review — a lighter pass than App Review). | This is where a 4.2 problem surfaces cheaply, before a full submission. **Use it as the 4.2 canary.** |
| Then | App Store, staged. | |

**Sequencing recommendation: settle mitigation #1 before the first TestFlight
external build, not after.** A 4.2 rejection is cheap to pre-empt and expensive
to argue.

---

## 8. Store asset specification

Not designed here — specified for later. Reuse the existing brand: the crest at
`assets/velvet-viking-crest.png` (1223×1286), the wordmark **VELVET VIKING**, the
line *"Valhalla Awaits, Earn Your Place"*, and the bronze/gold-on-near-black
palette from the runtime's `:root` tokens.

**Google Play**
| Asset | Spec |
|---|---|
| App icon | 512×512 PNG, 32-bit, no alpha |
| Feature graphic | 1024×500 PNG/JPEG, no alpha |
| Phone screenshots | 2–8, 16:9 or 9:16, 320–3840 px per side. Device frame 412×915 @2x matches the verified layout |
| 7" / 10" tablet | Only if tablet is declared supported |
| Short description | ≤ 80 chars |
| Full description | ≤ 4000 chars |
| Release notes | ≤ 500 chars per language |

**App Store**
| Asset | Spec |
|---|---|
| App icon | 1024×1024 PNG, no alpha, no rounded corners |
| iPhone screenshots | 6.9" (1320×2868) and 6.5" (1242×2688), 3–10 each |
| iPad screenshots | 13" (2064×2752) — **only if iPad is supported** |
| Subtitle | ≤ 30 chars |
| Promotional text | ≤ 170 chars, editable without review |
| Keywords | ≤ 100 chars, comma-separated |
| Description | ≤ 4000 chars |
| Privacy policy URL | `/privacy` |
| Support URL | required |
| Marketing URL | optional |

**Suggested screens** (six, both stores): Today with Next Move · a session card
with the coaching brief · the Plan Evolution proposal expanded · Plan HQ ·
Training Zone Paces · Full Plan. All exist and render at phone width.

---

## 9. Commercial / payment boundary — the decision, not the implementation

Commercial state is **OFF** and stays off. Nothing here is implemented. But
distributing on iOS forces a choice that the web-only product never had to make.

Apple **3.1.1**: *"If you want to unlock features or functionality within your
app… you must use in-app purchase."*
Apple **3.1.3(b) Multiplatform Services**: *"Apps that operate across multiple
platforms may allow users to access content, subscriptions, or features they have
acquired in your app on other platforms or your web site… provided those items
are also available as in-app purchases within the app."*

| Option | Consequence |
|---|---|
| **A. Web subscription only** | Works on Android (Play permits it far more readily). On iOS, honouring a web subscription is allowed by 3.1.3(b) **only if the same subscription is also offered as an IAP inside the app.** Web-only, with no IAP, is a 3.1.1 rejection. |
| **B. Native IAP everywhere** | Store-clean, and the most expensive: StoreKit + Play Billing, two more webhook sources into `entitlements`, and 15–30% commission. |
| **C. Mixed** | Web checkout on the website and Android; StoreKit IAP on iOS; both resolving to the **same** `entitlements` row. This is what 3.1.3(b) actually describes. |

**Architectural point that matters now, before anything is built:** the existing
model already supports C without redesign. `entitlements` is the single access
authority, `_access.js` resolves from it, `provider` / `provider_customer_id` /
`provider_sub_id` are deliberately **opaque strings** — the schema comment says
*"no payment provider's vocabulary is allowed to become this application's access
model"* — and `billing-webhook.js` normalises any provider into one shape at the
top of one file. Adding StoreKit means an adapter branch plus a second webhook
source. **No entitlement redesign is required.** That is worth knowing before the
commercial model is chosen, and it is the reason not to choose it under time
pressure later.

All billing code stays inert. `VVV_CHECKOUT_URL` and
`VVV_BILLING_WEBHOOK_SECRET` remain unset; `supabase-commercial-activation.sql`
remains off.

---

## 10. External requirements, consolidated

**Android**
1. Google Play developer account (organisation) + legal verification.
2. Four `VVV_KEYSTORE_*` repository secrets.
3. Create the app; accept Play App Signing.
4. **Add the Play app-signing SHA-256 to `assetlinks.json`.**
5. Data Safety, content rating, target audience, ads, App access.
6. Store listing assets (section 8).

**iOS**
1. Apple Developer Program membership (organisation) → **Team ID**.
2. A macOS machine with Xcode 26 (or a macOS CI runner).
3. Certificates, identifier, provisioning profile.
4. Activate the AASA template with the real Team ID + add the one vercel.json route.
5. Decide iPad support.
6. App Privacy questionnaire (`STORE-DATA-INVENTORY.md`), App Review notes with a
   reviewer sign-in route.

**Both**
7. Decide mitigation #1 (bundled runtime) before the first external test build.
