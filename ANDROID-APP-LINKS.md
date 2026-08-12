# Deep links: getting the sign-in email into the Android app

The APK is a Capacitor WebView pointed at the live site, so by default tapping a
magic-link email on the phone opens **Chrome**, not the installed app — you end
up signed in to the website while the app still shows you signed out.

There are two routes into the app. One works today; the other is wired up but
needs one manual step.

---

## 1. Custom scheme — works now, nothing else needed

`com.velvetviking.valhalla://auth`

Supabase emails a link to `…supabase.co/auth/v1/verify?…&redirect_to=<target>`.
When the app asks for a sign-in link it now passes the custom scheme as that
target, so the browser's redirect hands the tokens straight to the APK. Android
matches it on the scheme alone — no domain verification, no signing key, works
on the debug APK as it is.

**One config step in Supabase, or sign-in from the app will silently fail:**

> Supabase dashboard → Authentication → URL Configuration → **Redirect URLs** →
> add `com.velvetviking.valhalla://auth`

GoTrue refuses any redirect target that is not on that allow-list and falls back
to the Site URL, which would put you back in the browser.

The target has to reach GoTrue as the **`?redirect_to=` query parameter** on the
`/auth/v1/otp` request. A nested `options: { email_redirect_to }` in the body is
a supabase-js shape — that client rewrites it into the query param before
sending. Calling the REST endpoint directly, as this app does, means a body
value is silently ignored and every link falls back to the Site URL. That bug is
why the APK never got signed in while the browser always did: the Site URL *is*
the browser app, so on the web the failure was invisible.

The existing web entry (`https://velvet-viking-valhalla-1.vercel.app/`) stays on
the list and is unchanged — browser sign-in keeps working exactly as before.

---

## 2. https App Link — key generated, secrets pending

`https://velvet-viking-valhalla-1.vercel.app/auth`

The manifest declares this with `android:autoVerify="true"`, and
`/.well-known/assetlinks.json` is served (rewritten from `assetlinks.json` at
the repo root) carrying the real fingerprint:

```
FF:74:F0:CE:A8:C9:87:41:CD:A5:8B:3A:D9:67:95:8E:86:FA:E8:85:09:3D:6A:20:CE:D6:99:30:FA:69:04:EE
```

That is the SHA-256 of `vvv-release.keystore` (alias `vvv`, RSA 2048, valid to
2053). It only takes effect once CI actually signs with that key, which needs
the four repository secrets below.

Android verifies an App Link by fetching that file and matching the SHA-256 of
the certificate the APK was **signed** with. Without the secrets set, CI runs
`./gradlew assembleDebug` on a clean runner with no keystore, so Gradle
generates a throwaway debug key and the fingerprint differs on every build —
nothing can ever match the published one.

That same fact causes a second, separate problem: **a newly downloaded APK will
not install over the previously installed one** ("app not installed" / signature
mismatch), because Android sees a different signer. Setting the secrets fixes
both at once, and from then on builds install as ordinary updates.

### Fixing both

The key already exists (`vvv-release.keystore`, generated with the command
below and kept out of the repo by `.gitignore`).

```sh
keytool -genkeypair -v \
  -keystore vvv-release.keystore -alias vvv \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12
```

To regenerate it, run that, read the new fingerprint with

```sh
keytool -list -v -keystore vvv-release.keystore -alias vvv | grep 'SHA256:'
```

and paste it into `assetlinks.json` — Vercel serves the change immediately.
Every installed copy of the app must then be reinstalled once.

To give CI the key, base64 it:

```sh
base64 -w0 vvv-release.keystore    # macOS: base64 -i vvv-release.keystore
```

and add four **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 blob above |
| `ANDROID_KEYSTORE_PASSWORD` | the store password you chose |
| `ANDROID_KEY_ALIAS` | `vvv` |
| `ANDROID_KEY_PASSWORD` | the key password you chose |

The workflow picks them up automatically and signs every build with that key.
With no secrets set it behaves exactly as it does today, so adding them is
strictly opt-in.

**Keep `vvv-release.keystore` out of the repo.** Anyone holding it can sign an APK that
installs over yours as an update. It is also unrecoverable: lose it and the only
way to ship a new build is to have every user uninstall first.

Once the fingerprint is live, verify it:

```sh
adb shell pm verify-app-links --re-verify com.velvetviking.valhalla
adb shell pm get-app-links com.velvetviking.valhalla   # want: "verified"
```

You can then switch the web redirect target to `/auth` in
`authRedirectTarget()` so that browser links open the app too — add
`https://velvet-viking-valhalla-1.vercel.app/auth` to the Supabase Redirect URLs
before doing so.

---

## What the app does with the URL

`cloudInitDeepLinks()` (in `velvet-viking-valhalla.html`) registers the
Capacitor App plugin's `appUrlOpen` listener for warm starts and calls
`getLaunchUrl()` for cold starts. Either way the URL goes to
`handleAuthDeepLink()`, which parses the tokens out of the fragment *or* the
query string, stores the session under `vvv_cloud_session` in localStorage,
pulls the account's plan down through the normal `cloudReconcile()` path, and
repaints — so you land back in the app already signed in.
