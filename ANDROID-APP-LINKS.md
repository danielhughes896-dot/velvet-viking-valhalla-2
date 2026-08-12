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

GoTrue refuses any `email_redirect_to` that is not on that allow-list and falls
back to the Site URL, which would put you back in the browser.

The existing web entry (`https://velvet-viking-valhalla-1.vercel.app/`) stays on
the list and is unchanged — browser sign-in keeps working exactly as before.

---

## 2. https App Link — needs a stable signing key first

`https://velvet-viking-valhalla-1.vercel.app/auth`

The manifest already declares this with `android:autoVerify="true"`, and
`/.well-known/assetlinks.json` is already served (rewritten from
`assetlinks.json` at the repo root). The missing piece is the fingerprint.

Android verifies an App Link by fetching that file and matching the SHA-256 of
the certificate the APK was **signed** with. Right now CI runs
`./gradlew assembleDebug` on a clean runner with no keystore, so Gradle
generates a throwaway debug key and the fingerprint is different on every single
build. Nothing can match it.

That same fact causes a second, separate problem worth fixing anyway: **a newly
downloaded APK will not install over the previously installed one** ("app not
installed" / signature mismatch), because Android sees a different signer.

### Fixing both

Generate one key and keep it:

```sh
keytool -genkeypair -v \
  -keystore vvv.keystore -alias vvv \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storetype PKCS12
```

Read its fingerprint:

```sh
keytool -list -v -keystore vvv.keystore -alias vvv | grep 'SHA256:'
```

Paste that value (the colon-separated hex, uppercase) into `assetlinks.json`,
replacing `REPLACE_WITH_SHA256_FINGERPRINT_OF_THE_SIGNING_KEY`, and push — Vercel
serves it immediately.

Then give CI the key. Base64 it:

```sh
base64 -w0 vvv.keystore    # macOS: base64 -i vvv.keystore
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

**Keep `vvv.keystore` out of the repo.** Anyone holding it can sign an APK that
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
