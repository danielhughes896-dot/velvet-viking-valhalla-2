# Production environment inventory

Every variable the deployed system reads, what it is for, and who supplies it.

**No secret value appears in this file or in any report.** Each row says where
the value comes from; none says what it is.

Two deployments matter:

| Deployment | What it is |
|---|---|
| **app** | `app.sacoro.app`, and `app.velvetviking.co.uk` until it is retired (the same deployment answers on both): the Vercel project in this repository. Everything below lives here unless a row says otherwise. |
| **site** | `velvetviking.co.uk` — the marketing site, a separate project. Needs only the two rows marked *site*. |

`REQUIRED` means launch cannot happen without it. `SWITCH` means the value's
absence is a deliberate off state, not a misconfiguration.

---

## Supabase — the database and auth

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_SUPABASE_URL` | no | The project origin. Namespaced deliberately: plain `SUPABASE_URL` is what a Vercel integration claims, and only a `VVV_`-prefixed override may move the project. | **REQUIRED** | Supabase → Project Settings → API |
| `VVV_SUPABASE_ANON_KEY` | no (publishable) | The browser's key. Ships in the client; RLS is what protects the data, not this. | **REQUIRED** | Supabase → API |
| `VVV_SUPABASE_SERVICE_ROLE_KEY` | **YES** | Server-only. Bypasses RLS. Never reaches a browser, a log or a repository. | **REQUIRED** | Supabase → API |
| `SUPABASE_SERVICE_ROLE_KEY` | **YES** | Fallback name, read only if the `VVV_` one is absent. Present because a Vercel integration may set this name. Prefer the namespaced one. | optional | Supabase → API |
| `VVV_OWNER_USER_ID` | no | The owner account's uid. Gates every administrative route and is substituted into `supabase-entitlement.sql`. | **REQUIRED** | Supabase → Authentication → Users |

## Site origins

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_SITE_ORIGIN` | no | The address this deployment registers with other companies: `https://app.sacoro.app` from switch day (step 4d of the move; it was `https://app.velvetviking.co.uk`). The Strava redirect URI and webhook, and the Garmin callback, are built from it, so the Strava Authorization Callback Domain changes with it, in the same minute. A person is sent back to the address they are using instead, when it is one of the app's own two (`api/_origins.js`): Stripe success and portal returns, the Strava return and the sign-in link. That is what keeps builds 13 and earlier, which load `app.velvetviking.co.uk`, working after the switch. Checkout **refuses** without it rather than guessing. | **REQUIRED** | you |
| `VVV_MARKETING_ORIGIN` | no | The website, `https://sacoro.app`. Where a cancelled web checkout returns to. Defaults to that value. | recommended | you |

## Stripe — the web commercial rail

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | **YES** | The API key. `sk_test_…` is sandbox, `sk_live_…` is production — and the code records which on every row it writes. | **REQUIRED** (test first) | Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | **YES** | Verifies deliveries. **Absent means 503, never "accept everything."** | **REQUIRED** | Stripe → Developers → Webhooks → the endpoint |
| `STRIPE_API_VERSION` | no | Pins the API version our own REST calls render in, sent once from the shared transport. **Unset by default and safe to leave unset** — the adapter reads the billing period from both the places Stripe puts it, so correctness does not depend on this. Set it to the version pinned on the webhook endpoint so the pushed and pulled routes are provably handed the same shape. Never guess a value. | optional | Stripe → Developers → Webhooks → the endpoint's API version |
| `VVV_PRICE_WEB_STANDARD_MONTHLY` | no | The Stripe price id for £11.99/month. An unset price **refuses** rather than resolving to "charge them something". | **REQUIRED** | Stripe → Products |
| `VVV_PRICE_WEB_STANDARD_YEARLY` | no | The Stripe price id for £79.99/year. | **REQUIRED** | Stripe → Products |
| `VVV_COMMERCE_ENABLED` | no | **SWITCH.** Unset = checkout refuses with `commerce_disabled`. | **OFF** | you |
| `VVV_COMMERCIAL_REQUIRED` | no | **SWITCH.** Unset = an ended subscription does not lock anybody out. Turning it on makes commerce load-bearing. | **OFF** | you |
| `VVV_ACCOUNT_REQUIRED` | no | **SWITCH.** Whether an account is needed to reach the app. **On:** a visitor with no session at all is served the app in *journey-only* mode (see below); a stale or revoked session goes to sign-in, a denied athlete to the locked shell, as before. **Off:** the app is served to everyone, unchanged. | as configured (**on** in production) | you |
| `VVV_AUTH_PROVIDERS` | no | **SWITCH.** Which OAuth sign-ins the first-time journey offers beside email: `apple`, `google` or `apple,google`. Unset = email only, and the Apple and Google buttons are not drawn. Set it only after the provider is configured; see AUTH-AND-EMAIL.md. | **OFF** | you |
| `VVV_CHECKOUT_URL` | no | Legacy external checkout link, superseded by the Stripe path. | not needed | — |
| `VVV_BILLING_WEBHOOK_SECRET` | **YES** | The provider-neutral webhook's HMAC secret, used by the non-Stripe path. Unset = 503. | optional | you |
| `VVV_PRICE_APPLE_*`, `VVV_PRICE_GOOGLE_*` | no | Reserved. No adapter exists, so these do nothing today. | not needed | — |

## monday.com — the operational mirror

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_MONDAY_OPERATIONAL` | no | **SWITCH.** `on` enables the mirror. Anything else = no sync at all. | **OFF** | you |
| `MONDAY_API_TOKEN` | **YES** | monday personal API token. The same token already used by the content bridge is fine. | for the mirror | monday → Admin → API |
| `MONDAY_OPERATIONAL_BOARD_ID` | no | The numeric board id from the board URL. | for the mirror | monday |
| `MONDAY_OPERATIONAL_GROUP_ID` | no | The group id, **not** its title. | for the mirror | monday |
| `MONDAY_OPERATIONAL_SALT` | **YES** | Keys the opaque `VVV-…` account reference. **No salt = no sync**, never a fallback to the raw account id. Generate once. **Changing it re-keys every account and orphans every existing board item.** | for the mirror | generate |
| `MONDAY_CONTENT_BOARD_ID` | no | The *content/evidence* board — a different board with different rules. | existing | monday |
| `MONDAY_CONTENT_GROUP_ID` | no | Its group. | existing | monday |
| `MONDAY_CONTENT_SOURCE_LABEL` | no | Label written on exported candidates. | existing | monday |
| `VVV_CONTENT_BRIDGE_ENABLED` | no | **SWITCH** for the content bridge. Unrelated to the operational mirror. | as configured | you |

## Strava

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_STRAVA_ENABLED` | no | **SWITCH.** Off = the integration is not offered at all, and no request reaches Strava. | as configured | you |
| `VVV_STRAVA_MAX_ATHLETES` | no | **PRIVATE-BETA CAPACITY.** How many athletes may hold a Strava connection at once. Unset or malformed means **10**; there is deliberately no value meaning unlimited. Counted against Sacoro's own `strava_connections` roster, which is the only number it can establish exactly — Strava remains authoritative for its own application limit. An athlete who already holds a connection is never counted against admission and is never disconnected by a full roster. | `10` | you |
| `STRAVA_CLIENT_ID` | no | OAuth client id. | for Strava | strava.com/settings/api |
| `STRAVA_CLIENT_SECRET` | **YES** | OAuth client secret. Also keys the OAuth `state` HMAC. | for Strava | strava.com/settings/api |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | **YES** | Echoed back during Strava's webhook handshake. | if webhooks used | you |

## Voice Coach — off, and nothing has a default

The Today Voice Coach composes its briefing on the device, from the engine's own
arithmetic, and that half reaches nothing. **Ask Coach** — the conversational
half — reaches a model. **Hear Today** now reaches a speech vendor to READ the
already-composed briefing aloud, and falls back to the device's own speech
synthesis whenever that vendor is absent, slow or failing.

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_VOICE_ENABLED` | no | **SWITCH.** Off = Ask Coach is not offered and `/api/voice-ask` refuses. It also governs Coach Memory: off, `/api/coach-memory` keeps nothing and gives the coach nothing (reading and clearing notes already kept still work). Coach Memory needs no variable of its own; it uses the Supabase service key the account routes already use, and `supabase-coach-memory.sql` (migration 13). Deliberately separate from "is the key set", so *switched off on purpose* and *misconfigured* are never the same log line. Default off. | as configured | you |
| `ANTHROPIC_API_KEY` | **YES** | Authenticates the Ask Coach model call. Server-side only — it is read in `api/_voice.js` and never reaches the browser. | for Ask Coach | console.anthropic.com → API keys |
| `VVV_VOICE_MODEL` | no | Overrides the model id. Leave unset; the pinned default is `claude-opus-5-5` (moved from `claude-opus-5` on 2026-11-17; same request shape, lower price). | unset | — |
| `VVV_NOTE_MODEL` | no | Overrides the model that writes the routine coach paragraphs: a run's Sacoro Analysis and the Week Complete sentence (`/api/voice-explain`). Leave unset; the default is `claude-haiku-5-5`, chosen by a side-by-side test against Claude Sonnet 5.5 on 49 run and week packets (16 November 2026). Set `claude-sonnet-5-5` for its voice at about twenty times the cost. Switched on and off with `VVV_VOICE_ENABLED`. | unset | — |

### Hear Today — the premium coach voice (ElevenLabs)

Speech synthesis only. The vendor receives the final approved briefing sentences,
a voice id and a model id, and nothing else — no athlete identity, no plan, no
training history, no health or readiness data, nothing Strava touched and no Ask
Coach conversation. It is never asked what to say. Absent any of this, Hear Today
still works: the device's own engine speaks the same words.

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `ELEVENLABS_API_KEY` | **YES** | Authenticates the speech call. Read only in `api/_voice-tts.js`; never reaches the browser, the Android source, the Capacitor config or any log line. Absent = Hear Today speaks with the device's own engine. | for the premium voice | elevenlabs.io → API keys |
| `ELEVENLABS_VOICE_ID` | no | The **default** coach voice (Molly). Set so the voice can be repointed without a code release. Unset falls back to the catalogue default in `api/_voice-tts.js`. | for the premium voice | elevenlabs.io → Voices |
| `ELEVENLABS_VOICE_ID_JOANNA` | no | Overrides the Joanna entry of the coach-voice catalogue. Unset uses the built-in id. | unset | elevenlabs.io → Voices |
| `ELEVENLABS_VOICE_ID_HARRY` | no | Overrides the Harry entry. Unset uses the built-in id. | unset | elevenlabs.io → Voices |
| `ELEVENLABS_VOICE_ID_ANDREW` | no | Overrides the Andrew entry. Unset uses the built-in id. | unset | elevenlabs.io → Voices |
| `VVV_TTS_MODEL` | no | Overrides the speech model id. Leave unset; the pinned default is `eleven_multilingual_v2`, chosen for English prosody at a latency a pre-run briefing can absorb. Present so the choice can be re-tested live without a code release. | unset | — |

**Voice ids are not secrets.** They name a public catalogue entry and authorise
nothing on their own. They are nonetheless resolved server-side from a closed
catalogue, so no caller can bill this account for synthesis with an arbitrary
voice. The API key is the secret, and it stays in the function process.

**Ask Coach and Strava coexist on the same account.** Having Strava connected,
holding a Strava connection, or holding Strava-derived history
does not disable LISTEN or Ask Coach. Account eligibility and data eligibility
are different things: Strava eligibility controls **who may use
Strava** and nothing else.

What the Strava restriction governs is **which evidence may reach the model**,
and that is decided per item when the context is assembled — a Strava-derived
day, a plan change made after Strava evidence existed, and any pace-relative
conclusion descending from a Strava-anchored fitness reading are all withheld,
while the athlete's own manual sessions, their own typed numbers and their whole
planned programme remain available. One imported run never costs an athlete
their coach.

## Garmin — off, and nothing has a default

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_GARMIN_ENABLED` | no | **SWITCH.** Must be exactly `1`. Anything else = the integration refuses at the boundary. | **OFF** | you |
| `VVV_GARMIN_CLIENT_ID` | no | Consumer key. No default — a fallback here is how a wrong integration ships silently. | after approval | Garmin Developer Portal |
| `VVV_GARMIN_CLIENT_SECRET` | **YES** | Consumer secret. | after approval | Garmin Developer Portal |

## Android release signing — CI only, never Vercel

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `VVV_KEYSTORE_FILE` | path | Path to the release keystore written by CI from a secret. | **REQUIRED to release** | you |
| `VVV_KEYSTORE_PASSWORD` | **YES** | Keystore password. | **REQUIRED to release** | you |
| `VVV_KEY_ALIAS` | no | Key alias inside the keystore. | **REQUIRED to release** | you |
| `VVV_KEY_PASSWORD` | **YES** | Key password. | **REQUIRED to release** | you |

A release build with any of the four missing **fails loudly** rather than
falling back to debug signing — because a debug-signed release breaks App Link
verification and cannot install over an existing app.

## Public sign-up — a database switch, not an environment variable

Founder, 18 November 2026: "It's on Vercel so only I can send it to people. So
make it as if it's ready to go." Whether a new address may create an account
is **one row in the database**, `public.signup_settings.public_signup`,
installed by `supabase-public-signup.sql`. There is deliberately **no Vercel
variable** for it: the thing that refuses an account is the `auth.users`
trigger, a trigger cannot read Vercel, and a second switch the gate ignores is
how the two would come to disagree. `/api/beta-signin` reads the row with the
service key to report it (`public_signup` on `GET`) and to classify GoTrue's
refusal.

| State | Who may create an account | What the app says |
|---|---|---|
| `public_signup = true` | anyone who reaches the app | no "private beta" anywhere |
| `public_signup = false` | only addresses on `beta_allowlist` | no "private beta" anywhere; a refused address reads "SACORO can't create an account for this email address yet. Please get in touch" |
| table not yet created | as the gate trigger decides today | the same |

The words no longer depend on the switch (founder, 18 November 2026: "Get rid
of the private beta stuff"; sign-up is open).

**Turn it on** (SQL editor, after applying `supabase-public-signup.sql`):
`update public.signup_settings set public_signup = true, changed_at = now(), note = 'opened' where id = 1;`
**Turn it off:** the same with `false`. No redeploy either way. Full steps,
verification and roll back: `AUTH-AND-EMAIL.md` → "Public sign-up".

It grants no product access. With `VVV_COMMERCE_ENABLED` and
`VVV_COMMERCIAL_REQUIRED` unset, a new account is admitted to the app after the
journey (`pre_commercial`); with both on, it is held at the seven-day trial
until checkout creates the subscription.

## SMTP — not environment variables

The branded magic-link sender is configured in the **Supabase dashboard**
(Authentication → SMTP Settings), not here. No SMTP credential belongs in
Vercel. See `AUTH-AND-EMAIL.md`.

---

## Currently present

This worker has no read access to the Vercel project's environment, so the
honest answer for every row is **unknown from here**. What *is* known, because
the code reports it rather than assuming it:

- **Supabase is configured** — the beta has live accounts, so the URL, anon key
  and service-role key are present and working.
- **Strava is configured or not** according to `VVV_STRAVA_ENABLED`, and is
  additionally restricted to the accounts named in
  the private-beta capacity in `VVV_STRAVA_MAX_ATHLETES`. The switch must be
  set for anybody to reach it,
  and an account that is not listed is shown no Strava integration at all
  rather than a button it cannot use.
- **Stripe is not live** — no live key, and liveness is not derived from a key
  being present in any case.
- **Garmin is off** — the integration refuses at the boundary.
- **The monday mirror is off** — nothing has ever been sent to an operational
  board.

To confirm the rest, read the project's Environment Variables screen. Do not
paste any value into a chat or a file.

## The account gate and the first-time journey (18 November 2026)

Founder: "Open steps 1-6 to everyone." With `VVV_ACCOUNT_REQUIRED` on, a
request for the app (`/`, `/app`, `/auth`) that carries **no gate cookie at
all** used to be redirected to `/account?why=signin`. It is now answered by
`api/app.js` with the same runtime marked `data-vvv-access="journey"` on
`<html>` (`x-vvv-gate: journey`, `cache-control: private, no-store`, and no
`x-vvv-entitled-at`, so the service worker never keeps it as a grant).

**What an anonymous visitor can reach:** the journey's Welcome, What would you
love to achieve, What drives you, the builder, the three slides, the preview
and Make It Yours; Existing Member sign-in; the legal pages. Everything they
build stays on their device. On the server, only the public routes: the
catalogue and agreement wording (`GET /api/checkout`), the ways in
(`GET /api/beta-signin`, and sending a magic link), and the configuration
probes (`/api/voice-enabled`, `/api/strava-enabled`, `/api/garmin-status`).
(`POST /api/preview` was removed on 18 November 2026: nothing had called it
since the web builder was retired on 16 November.)

**What they cannot reach:** Today, This Week, Full Plan, Coach, Settings,
Share, Circles, Ask Coach, the trial and everything after it (the app holds
them at Make It Yours and its dispatcher refuses every other action), and on
the server every account, money or model route (subscription, checkout,
portal, account data and deletion, coach memory, Ask Coach, the Coach's Note,
the result panels, speech, Strava, admin, the session bridge and the billing
webhook), each of which refuses an anonymous caller itself.
`test/m8-journeyGate.test.js` proves both halves.

**Who may sign up is the public sign-up switch** (section above). Creating the
account is the magic link (or Apple or Google when switched on); with the
switch off the beta allowlist trigger refuses any address not on it (the
athlete reads that this address cannot make an account yet), and with it on
any address becomes an account.
Once the account exists the app exchanges the session for the gate cookie and
reloads through the gate into the full app, where the journey continues at the
trial with the plan it built. If the gate refuses the new account (commerce
on, no subscription yet), the journey stays in journey-only mode on the trial
screen, whose checkout is the way in; any other refused account goes to the
locked shell, as before. In the website-distributed Android app that checkout
opens in the phone's browser and returns into the app
(`STORE-COMMERCIAL-BOUNDARY.md`, "How the website-distributed app takes
payment"). `/start` leads everybody to `/` (founder, 18 November 2026:
"Remove the old start.").
