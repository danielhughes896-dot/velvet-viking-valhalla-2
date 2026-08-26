# Production environment inventory

Every variable the deployed system reads, what it is for, and who supplies it.

**No secret value appears in this file or in any report.** Each row says where
the value comes from; none says what it is.

Two deployments matter:

| Deployment | What it is |
|---|---|
| **app** | `app.velvetviking.co.uk` — the Vercel project in this repository. Everything below lives here unless a row says otherwise. |
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
| `VVV_SITE_ORIGIN` | no | Where this deployment thinks it lives: `https://app.velvetviking.co.uk`. Stripe success URLs and the auth callback are built from it. Checkout **refuses** without it rather than guessing. | **REQUIRED** | you |
| `VVV_MARKETING_ORIGIN` | no | `https://velvetviking.co.uk`. Where a cancelled checkout returns to. Defaults to that value. | recommended | you |

## Stripe — the web commercial rail

| Name | Secret | Purpose | Launch | Source |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | **YES** | The API key. `sk_test_…` is sandbox, `sk_live_…` is production — and the code records which on every row it writes. | **REQUIRED** (test first) | Stripe → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | **YES** | Verifies deliveries. **Absent means 503, never "accept everything."** | **REQUIRED** | Stripe → Developers → Webhooks → the endpoint |
| `STRIPE_API_VERSION` | no | Pins the API version our own REST calls render in, sent once from the shared transport. **Unset by default and safe to leave unset** — the adapter reads the billing period from both the places Stripe puts it, so correctness does not depend on this. Set it to the version pinned on the webhook endpoint so the pushed and pulled routes are provably handed the same shape. Never guess a value. | optional | Stripe → Developers → Webhooks → the endpoint's API version |
| `VVV_PRICE_WEB_STANDARD_MONTHLY` | no | The Stripe price id for £11.99/month. An unset price **refuses** rather than resolving to "charge them something". | **REQUIRED** | Stripe → Products |
| `VVV_PRICE_WEB_STANDARD_YEARLY` | no | The Stripe price id for £89.99/year. | **REQUIRED** | Stripe → Products |
| `VVV_COMMERCE_ENABLED` | no | **SWITCH.** Unset = checkout refuses with `commerce_disabled`. | **OFF** | you |
| `VVV_COMMERCIAL_REQUIRED` | no | **SWITCH.** Unset = an ended subscription does not lock anybody out. Turning it on makes commerce load-bearing. | **OFF** | you |
| `VVV_ACCOUNT_REQUIRED` | no | **SWITCH.** Whether an account is needed to reach the runtime. | as configured | you |
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
| `VVV_STRAVA_ALLOWED_USER_IDS` | no | **ACCESS LIST.** Comma- or newline-separated Supabase user UUIDs. Only these accounts can see, connect or sync Strava; every other account is refused at every server boundary. **Fails closed** — unset, empty, malformed or unmatched all mean no access, and there is deliberately no wildcard. Not a secret, but it is an account identifier: keep it out of source, tests and logs. | private test only | Supabase → Authentication → Users, the account's `id` |
| `STRAVA_CLIENT_ID` | no | OAuth client id. | for Strava | strava.com/settings/api |
| `STRAVA_CLIENT_SECRET` | **YES** | OAuth client secret. Also keys the OAuth `state` HMAC. | for Strava | strava.com/settings/api |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | **YES** | Echoed back during Strava's webhook handshake. | if webhooks used | you |

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
  `VVV_STRAVA_ALLOWED_USER_IDS`. Both must be set for anybody to reach it,
  and an account that is not listed is shown no Strava integration at all
  rather than a button it cannot use.
- **Stripe is not live** — no live key, and liveness is not derived from a key
  being present in any case.
- **Garmin is off** — the integration refuses at the boundary.
- **The monday mirror is off** — nothing has ever been sent to an operational
  board.

To confirm the rest, read the project's Environment Variables screen. Do not
paste any value into a chat or a file.
