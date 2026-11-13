# iOS / App Store: assessment and readiness

**Status: the iOS app now exists as a project and builds in CI.** Founder,
13 Nov 2026: "We need to build an iOS app bundle now." It was previously held
as a post-Android track; that decision is superseded, and what follows records
what was built, what Apple still needs, and the one commercial question that
remains open.

**Apple Health and HealthKit are explicitly out of scope** and appear nowhere in
this repository. Nothing below adds them.

---

## The question that actually decides it

App Store Review Guideline **3.1.1** requires in-app purchase for digital
content used within an app. Guideline **3.1.3(b)** ("multiplatform services")
allows an app to let a user access content they bought elsewhere — but does not
allow the app to *sell* it or, historically, to link out to a purchase.

The 2025 US injunction changed what may be linked and said about external
purchase in the US storefront, and the position differs by jurisdiction and has
moved more than once.

So there are exactly two viable iOS shapes:

| | What it means | Cost |
|---|---|---|
| **A. Reader-style** | The iOS app sells nothing and links to nothing. An athlete subscribes on the web and signs in. Same posture as the Android build already ships. | Least work. Highest review risk on 3.1.3(b), because "multiplatform service" is judged, not asserted. |
| **B. StoreKit / IAP** | Add an `apple` provider adapter, App Store Server Notifications V2, and StoreKit 2 purchase in-app. | Real work — an adapter, a notification endpoint, sandbox testing — **plus 15–30% of every iOS subscription, forever.** |

**B is a commercial decision, not an engineering one**, and it is HQ's. System
should not pick it by building it.

The canonical model already carries an `apple` provider rail precisely so that
choosing B later is an adapter and a webhook branch, not a migration of every
subscription row. See `STORE-COMMERCIAL-BOUNDARY.md`.

## The native iOS project (generated 13 Nov 2026)

`ios/` is a Capacitor 8 project for the same shell Android ships: it loads
`https://app.velvetviking.co.uk`, so content reaches iPhones through the web
deploy, exactly as on Android.

| | |
|---|---|
| **Plugins** | CocoaPods, not Swift Package Manager: `@capacitor-community/media` (Save to photos) has no Swift package yet, and leaving it out would silently turn "Save to photos" into "Save to device". All seven plugins are in. |
| **Devices** | iPhone only, portrait. Every screen is drawn for a phone in the hand; iPad is not offered, so no iPad screenshots are needed. |
| **Sign-in** | `CFBundleURLTypes` registers `com.velvetviking.valhalla`, the scheme the runtime already uses for the magic link. |
| **Permissions** | Microphone and speech recognition (only when the athlete speaks a question), photo library add (only when saving a share image). No tracking, no HealthKit. |
| **Launch screen** | The app's own boot splash, photographed at iPhone proportions with scripts off, on the app's dark ground, so the handover is one picture becoming the same picture. |
| **Icon** | The Porcelain S, 1024 by 1024, no transparency, in `AppIcon.appiconset`. Flat layers for Icon Composer (iOS 26 Liquid Glass) are in `ios/IconLayers/` with instructions. |
| **Privacy manifest** | `PrivacyInfo.xcprivacy`, as set out below, in the App target. |
| **Export compliance** | `ITSAppUsesNonExemptEncryption = NO`: only the system's own HTTPS. |
| **Not on iOS yet** | The home-screen widget (needs a WidgetKit extension) and the native speech recogniser Android has; the runtime already treats both as absent and says so. |

**Building.** `.github/workflows/build-ios.yml`, run by hand from the Actions
tab. The whole suite runs first on Linux; then a Mac builds the app for the
iOS Simulator, which needs no Apple account. With the signing secrets the
workflow names, it also archives a signed App Store `.ipa` and can send it to
TestFlight.

## What is already settled, and needs no further work

| | |
|---|---|
| **Bundle id** | `com.velvetviking.valhalla` — same as Android, and available to register |
| **Auth callback** | The custom scheme `com.velvetviking.valhalla://auth` already works and is what the runtime selects inside a native shell. It needs a `CFBundleURLTypes` entry in `Info.plist` and nothing else. |
| **Universal Links** | Optional. `apple-app-site-association` served from `https://app.velvetviking.co.uk/.well-known/`, mirroring what `assetlinks.json` already does for Android. Not required for sign-in, because the custom scheme carries it. |
| **Payment boundary** | Already enforced. `renderSubscriptionActions()` and `/start` both suppress purchase surfaces inside any Capacitor shell — iOS included, with no further change. |
| **Account deletion** | Apple has required in-app account deletion since 2022. It exists: Settings → Delete my account, server-side, immediate. |
| **Legal / support URLs** | `https://velvetviking.co.uk/privacy`, `/terms`, `support@velvetviking.co.uk` |

## Privacy manifest (`PrivacyInfo.xcprivacy`)

Required since spring 2024. For this app it is short, because the app collects
almost nothing natively:

- **Collected data types:** email address (app functionality, linked to user,
  not for tracking); health & fitness (app functionality, linked to user, not
  for tracking); purchases (app functionality, linked to user, not for
  tracking).
- **Tracking:** none. No ATT prompt is needed, and none should be added.
- **Required-reason APIs:** the WebView shell uses `UserDefaults`
  (reason `CA92.1` — access limited to the app itself). Capacitor's own
  dependencies declare theirs.

## App Privacy answers (App Store Connect)

The same set as the Play Data Safety table in `ANDROID-RELEASE.md`, in Apple's
vocabulary: Contact Info → Email Address; Health & Fitness → Fitness and Health;
Purchases → Purchase History. All *linked to the user*, none *used for
tracking*, none shared with third parties for their own purposes.

**Health data is optional** — the health-and-readiness consent is separate,
explicit and default off, and declining leaves the app fully usable.

## Review notes — the thing that decides pass or fail

Public signup is **closed**, so a reviewer who taps "sign in" gets nowhere
unless told. Review notes must say:

> Sign-in is by emailed magic link; there is no password. Access is currently
> limited to invited testers. Demo account: `<address on the beta allowlist>` —
> the sign-in link will be emailed to it; please use the account provided.
> Subscriptions are purchased on our website and the app sells nothing.

That last sentence is the 3.1.3(b) argument, and it needs to be true — it is.

## Signing and distribution

Requires, none of which exists here and none of which System can create:

- an Apple Developer Program membership (annual fee, and the entity must match
  the one on the legal pages)
- App ID registered for the bundle id
- a distribution certificate and an App Store provisioning profile
- an app record in App Store Connect
- Xcode on macOS, or a macOS CI runner

TestFlight is the right first track — internal testers immediately, external
testers after a lightweight review.

## Assets

- 1024×1024 app icon, no alpha, no rounded corners
- Screenshots for 6.7" and 6.5" iPhone at minimum; iPad only if iPad is
  supported
- Same rule as Android: prefer coaching surfaces over anything showing a price

---

## The honest summary

iOS is **not blocked by engineering**. It is blocked by a commercial decision
(reader-style vs StoreKit), an Apple Developer account, and a Mac. All three are
outside this repository. Shipping web and Android first is the rational route,
and the architecture is already shaped so that adding iOS later costs an adapter
rather than a rewrite.
