# Strava: what you have to set up by hand

Everything in the code is done. What is left is configuration that only you can
do, because it involves secrets and a Strava developer account.

**Never paste a secret into a chat, a commit, or a file in this repo.** Every
step below tells you the one screen where each value belongs.

Written to be doable entirely from a phone browser.

Until all of Part 1–3 are done, the app behaves honestly: **Connect Strava**
shows a short "Strava is not set up on this server yet" message instead of
pretending to be connected.

---

## Part 1 — Strava developer console

Go to **strava.com/settings/api** (sign in with your normal Strava account).
If you have never made an app there, it asks you to create one.

| Field | What to put |
| --- | --- |
| Application Name | Velvet Viking Valhalla |
| Category | Training |
| Website | `https://velvet-viking-valhalla-1.vercel.app` |
| **Authorization Callback Domain** | `velvet-viking-valhalla-1.vercel.app` |

The callback domain is **the bare domain — no `https://`, no path**. Strava
rejects the authorization if it does not match, and this is the single most
common thing to get wrong.

That page then shows you a **Client ID** and a **Client Secret**. Leave the tab
open; you need both in Part 2.

Scopes are requested by the app itself (`read,activity:read_all`) — there is
nothing to configure here for that. `activity:read_all` is what lets VVV see
runs you have marked private; without it those runs are invisible and simply
never import.

---

## Part 2 — Vercel environment variables

Vercel → your **velvet-viking-valhalla** project → **Settings** →
**Environment Variables**.

Add these four. Tick **Production, Preview and Development** for all of them so
preview deployments work too.

| Name | Value | Where it comes from |
| --- | --- | --- |
| `STRAVA_CLIENT_ID` | your Client ID | Part 1 |
| `STRAVA_CLIENT_SECRET` | your Client Secret | Part 1 — **secret**, paste it only here |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string you invent | make one up, e.g. 20 random letters. You never need to type it again — it is only used server-to-server between Strava and VVV |
| `VVV_SUPABASE_SERVICE_ROLE_KEY` | your Supabase service-role key | Supabase (project `eqiydxissphygnycpouu`) → Project Settings → API → **service_role** — **secret** |
| `VVV_OWNER_USER_ID` | your Supabase user UUID | see Part 2b below. Not a secret, but it is what authorises webhook administration, so only set it to your own id |

### Part 2b — find your VVV owner user ID

You need this once, for `VVV_OWNER_USER_ID`.

1. Open the VVV app and sign in with your email magic link (if you have not
   already). This creates your account.
2. Supabase dashboard → **Authentication** → **Users**.
3. Find the row with your email address.
4. Copy the **UID** column — a UUID like
   `3f2a91c4-7b6e-4d81-9a02-5c8ef1d0b7aa`.

That UUID is immutable and is not tied to your email or display name, which is
why it is used rather than the address. It is safe to paste into Vercel; it
grants nothing on its own (the server still requires a valid signed-in session
belonging to that id).

### Why the name starts with `VVV_`

Vercel's Supabase integration injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` automatically, and those values are
integration-managed — you cannot edit or remove them in the environment
variables UI. On this deployment they belong to a **different** Supabase
project than Valhalla's, which silently repointed the whole server side of the
Strava integration at the wrong database.

The server therefore no longer reads any of those three names. Valhalla's
project (`eqiydxissphygnycpouu`) is pinned in the code, and the only way to
supply the service-role key is the `VVV_`-prefixed name above, which no
integration writes. **You do not need to delete, disconnect or change the
Supabase integration** — its variables are simply ignored now.

If you ever genuinely move Valhalla to a different Supabase project, override
all three together: `VVV_SUPABASE_URL`, `VVV_SUPABASE_ANON_KEY`,
`VVV_SUPABASE_SERVICE_ROLE_KEY`.

⚠️ The **service_role** key bypasses Row Level Security. It belongs in Vercel
and nowhere else — never in the HTML file, never in a commit, never in a chat.

**Then redeploy.** Vercel only picks up new environment variables on the next
deployment: Deployments → the latest one → ⋯ → **Redeploy**.

---

## Part 3 — Supabase tables

Supabase → **SQL Editor** → **New query** → paste the contents of
`supabase-setup.sql` → **Run**.

The file is safe to run again on a project that already has the `plans` table —
every statement is `create table if not exists` / `drop policy if exists`. It
adds two tables:

- `strava_connections` — your OAuth tokens. RLS is on with **no policies**, so
  nothing holding the public key can read it, not even a correctly signed-in
  athlete. Only the Vercel functions, using the service-role key, can.
- `strava_activities` — runs waiting to be logged into a plan.

**Do not add a policy to `strava_connections`.** The absence of one is the
protection.

---

## Part 4 — Turn on automatic ingestion (the webhook)

This is the step that makes runs appear without pressing Sync.

1. Open the VVV app in your phone browser and make sure you are **signed in**.
2. In the same browser, go to:

```
https://velvet-viking-valhalla-1.vercel.app/admin
```

3. Tap **Create subscription**. A successful reply looks like `{"id":123456}`.

That page is owner-only deployment administration. It is not linked from
anywhere in the app, it holds no credentials of its own, and it is not the thing
protecting the operation — the server checks that your signed-in Supabase user
id equals `VVV_OWNER_USER_ID` before it will do anything. Anyone else who finds
the URL gets "Not authorised" from every button.

- **View subscription** lists the current one.
- **Delete subscription** removes one (paste the id from View first).

Strava allows **one subscription per application**. If Create says one already
exists, use View, then Delete with that id, then Create again.

Behind the scenes Strava immediately calls `/api/strava-webhook` back to check
the verify token before it accepts the subscription — that is why this only
works after Part 2 is deployed. That token does nothing else: it is not, and
must not be, an administrative credential.

---

## Part 5 — Android

**No action required, and no new APK.**

The installed app is a thin shell pointed at the live site
(`capacitor.config.json` → `server.url`), so it picks all of this up the next
time it is opened. `AndroidManifest.xml`, `assetlinks.json` and the App Link
setup are **unchanged by this work**.

How the connection works on the phone: tapping **Connect Strava** opens
Strava's page in your normal browser (which is the correct and safer place for
somebody else's login form). After you approve, the browser returns to
`/auth?strava=connected`. Switch back to the VVV app and it will already show
Connected — the tokens live on the server against your VVV account, so the app
does not need to catch the redirect itself.

If you ever complete the release-signing setup in `ANDROID-APP-LINKS.md`,
Android will start handing that `/auth` return straight back to the installed
app instead of leaving you in the browser. That is a nice-to-have, not a
requirement.

---

## Part 6 — Check it worked

1. Open VVV → **Settings** → **Connect Strava**.
2. Strava's own page should open and ask you to authorise Velvet Viking
   Valhalla. If it shows an error about the callback domain, re-check Part 1.
3. Approve. You come back to VVV and it says **✓ Connected**, then imports your
   recent runs.
4. Go for a run (or upload any run to Strava). Wait a minute, then open VVV.
   The run should already be logged against the right day, with distance, pace
   and heart rate filled in — and RPE, Feel and Notes still blank for you.

If step 4 does not happen but **Sync Strava** works, the webhook (Part 4) is
not registered — open `/admin` and tap **View subscription** to check.

### If /admin refuses you

Every failure now shows a short `Code:` under the message. Match it here:

| Code | What it means | Where to fix it |
| --- | --- | --- |
| `AUTH_NO_SESSION` | not signed in **in this browser** | open the app in the same browser and sign in |
| `AUTH_REFRESH_FAILED` / `AUTH_VERIFY_401` | the session really has expired | sign in to VVV again in this browser |
| `SUPABASE_KEY_UNUSABLE` | no service-role key that provably belongs to Valhalla's project | Vercel → add `VVV_SUPABASE_SERVICE_ROLE_KEY`, then redeploy |
| `AUTH_PROJECT_MISMATCH` | the server checks sign-ins against a different Supabase project than the app uses | Vercel → `VVV_SUPABASE_URL` (remove it — the correct project is pinned in code) |
| `AUTH_ANON_KEY_REJECTED` | Supabase refused the server's API key | Vercel → `VVV_SUPABASE_ANON_KEY` (remove it to use the default) |
| `AUTH_VERIFY_404` | `VVV_SUPABASE_URL` points at the REST URL, not the project URL | Vercel → `VVV_SUPABASE_URL` |
| `AUTH_HEADER_MISSING` | the sign-in header never reached the function | a proxy/deployment problem, not your session |
| `AUTH_UNAVAILABLE` | Supabase was unreachable from the server | nothing is wrong — retry shortly |
| `OWNER_MISMATCH` | you are signed in as someone other than the configured owner | Vercel → `VVV_OWNER_USER_ID` |
| `OWNER_NOT_CONFIGURED` | no owner is set | Vercel → `VVV_OWNER_USER_ID`, then redeploy |

The Vercel function log carries the same code plus the project host it
contacted, the host that issued your token, and the HTTP status Supabase
returned — and never a token, key, id or email.

### If a run is not logged automatically

VVV attaches a Strava run to a planned workout only when it is confident. It
refuses in two situations, both deliberate:

- **the distance is nowhere near the prescription** — a 3 km jog is not a 12 km
  threshold session, even on the right day;
- **you ran more than once that day and more than one run is credible** — VVV
  will not guess which one was the session.

In both cases the day is left exactly as it was for you to tick off and log
yourself. Manual **Sync Strava** will say so in one line. This is on purpose: a
wrong automatic match feeds a bad execution score into the coaching engine,
which is worse than no match at all.

---

## What VVV asks for, and what it does not

**Reads** (`read`, `activity:read_all`): your activity list and individual
activities — distance, moving/elapsed time, average and max heart rate,
cadence, elevation, start time and sport type.

**Never writes anything to Strava.** No write scope is requested, so VVV cannot
post, edit or delete an activity even if it wanted to.

**Never imports anything subjective.** RPE, Feel, notes, soreness and how a run
actually felt stay yours to enter. Strava has no opinion about them, and VVV
does not guess: a high heart rate is not evidence that you felt bad, and a fast
pace is not evidence that you felt good.

## Disconnecting

**Settings → Disconnect** removes the stored tokens and also deauthorises VVV
on Strava's side, so it disappears from your Strava settings too. Your logged
runs stay in your plan — they are your training history, not Strava's.

Deleting a run on Strava does not delete it from your plan either; VVV only
retires the external link. Revoking VVV from Strava's own settings page reaches
VVV through the webhook and disconnects it there too.
