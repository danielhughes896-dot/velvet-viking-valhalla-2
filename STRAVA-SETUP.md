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
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string you invent | make one up, e.g. 20 random letters. Write it down, you need it in Part 4 |
| `SUPABASE_SERVICE_ROLE_KEY` | your Supabase service-role key | Supabase → Project Settings → API → **service_role** — **secret** |

Optional, only if you ever move Supabase projects:

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | `https://eqiydxissphygnycpouu.supabase.co` (this is already the default, so you can skip it) |

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

Open this in your phone browser, replacing `YOURTOKEN` with the
`STRAVA_WEBHOOK_VERIFY_TOKEN` you invented in Part 2:

```
https://velvet-viking-valhalla-1.vercel.app/api/strava-webhook?admin=YOURTOKEN&op=create
```

A successful reply looks like `{"id":123456}`. That is your subscription id.

- `…&op=view` lists your current subscription(s).
- `…&op=delete&id=123456` removes one.

Strava allows **one subscription per application**. If `op=create` complains
that one already exists, run `op=view`, then `op=delete&id=…`, then `op=create`
again.

Behind the scenes Strava immediately calls the endpoint back to check the
verify token before it accepts the subscription — that is why this only works
after Part 2 is deployed.

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
not registered — run `op=view` and check.

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
