# Auth and email — the production architecture

## The model

Sign-in is an **email magic link**, and there is no password anywhere in the
product: no password field, no password reset, no password storage, no
`grant_type=password`. A test fails if any file under `api/` or `protected/`
grows one.

That is a deliberate choice, not an omission. A product with no password cannot
leak one, cannot have one reused from another breach, and needs no reset flow —
which is itself a common account-takeover surface.

## The flow, end to end

1. The athlete posts their address to `POST /api/beta-signin`.
2. **Who may become an account is decided by the database, not the route.** A
   `BEFORE INSERT` trigger on `auth.users` (`beta_allowlist_gate`) reads the
   **public sign-up switch** (next section): on, any address may become an
   account; off, only an address on the beta allowlist may. The route reads no
   list. While the switch is off, GoTrue reports the trigger's refusal as
   "Database error saving new user", and the route answers `403 not_in_beta`
   so the athlete reads "SACORO can't create an account for this email
   address yet. Please get in touch".
3. The server calls Supabase GoTrue's `/auth/v1/otp` with a `redirect_to` it has
   **validated itself**. The target never comes from the request body
   unmodified: an attacker-supplied redirect would hand them the tokens carried
   in the link. `safeRedirect()` is exported so it can be exercised directly.
4. Supabase emails the link.
5. The link lands on the app origin, which exchanges it for a session.
6. `POST /api/session` verifies the token against Supabase, resolves the
   entitlement, and mints a **delivery lease**.

## Public sign-up: one switch, in the database

Founder, 18 November 2026: "It's on Vercel so only I can send it to people. So
make it as if it's ready to go." The app is reachable only by people the
founder sends the link to, so sign-up works for anyone who reaches it, as it
will at launch: no invitation needed. It is a **switch**, so it can be turned
back without a code change.

**The design, and why it lives in the database.** The only place an account
can come into existence is the insert into `auth.users`, and the only thing
that can refuse it there is the `beta_allowlist_gate` trigger. The publishable
key is public, so anyone can ask GoTrue for an account without going through
`/api/beta-signin`; the route was never the gate. A Vercel variable cannot be
read by a trigger, so a switch kept in Vercel would be a second authority the
real gate ignores (the route saying "open" while the database says "closed" is
exactly how public signup stayed shut for a fortnight after the cutover). So
the switch is **one row**, `public.signup_settings.public_signup`, installed by
[`supabase-public-signup.sql`](supabase-public-signup.sql), and read by:

| Reader | What it does with it |
|---|---|
| `enforce_beta_allowlist()` (the trigger) | On: admits any address. Off: the allowlist, exactly as before, same refusal. |
| `is_beta_approved()` (the row-level predicate) | On: an athlete who signed up can read and write **their own** plan even while the five `plans`/`strava_activities` policies still carry the beta clause. Ownership is untouched. |
| `GET /api/beta-signin` (`api/_signup.js`) | Reports it as `public_signup: true / false / null`. Since 18 November 2026 no screen chooses its words by it. |
| `POST /api/beta-signin` | Off (or unreadable): GoTrue's "saving new user" refusal becomes `403 not_in_beta`. On: the same words are classified as a provider failure. |

The browser cannot read it, call it or change it; the server's key can only
read it. **It is changed in the Supabase SQL editor and nowhere else.**

**What does not change.** No password login, magic-link expiry, rate limits,
server-checked redirects (`safeRedirect()`), the lease model, and the
commercial gate are all exactly as before. The switch decides who may have an
**account**; `resolveAccess()` still decides who may **use** SACORO.

**What a brand-new account gets.** An `account_commercial` row (no trial
consumed), no entitlement and no grant — the same as any account, proved in
Postgres by `tools/db-proof/public-signup-proof.sql`. Then:

- **Commerce off** (`VVV_COMMERCE_ENABLED` and `VVV_COMMERCIAL_REQUIRED`
  unset): `resolveAccess()` admits any signed-in account (`pre_commercial`),
  so `/api/session` hands out the delivery cookie, the journey reloads into the
  full app at the trial, the trial screen says subscriptions are not open yet,
  **Continue** goes to Welcome to SACORO, and then Today.
- **Commerce on** (both set): the same account holds nothing until its trial
  exists, so the gate refuses it. The journey now keeps that athlete on the
  trial screen (journey-only mode) rather than sending them to "Your access has
  ended"; **Start My Free Trial** opens the seven-day checkout with their own
  token; Stripe returns them through `/account`, which exchanges the new
  `trialing` subscription for the cookie, and the journey carries on to
  Welcome. Nothing is granted without that checkout.

**The words.** Founder, 18 November 2026: "Get rid of the private beta
stuff." The journey, the builder's legal line, Make It Yours, the trial
screen, the sign-in errors, the cloud-sync notice, Settings' Strava messages
and `/account` never say "private beta" now, whichever way the switch stands;
the beta variant they used to show while it was off is gone. The shipped Terms
link is the commercial Terms (`https://velvetviking.co.uk/terms`, the document
`api/_agreements.js` names as in force), and the server still replaces it on
every view. Two things outside this repository may still say "beta" and are the
owner's to change: the Supabase magic-link email template (Authentication →
Email Templates) and the website's own pages (including `/beta-terms`).

### Applying it (owner, once, after the founder's yes)

1. Supabase → SQL Editor → New query → paste the whole of
   `supabase-public-signup.sql` → Run. It is transactional and refuses with
   "Nothing has been changed" if the beta gate is not installed. **This alone
   changes nobody's ability to sign up**: the switch is seeded to what the
   database already does (closed while the gate trigger is attached; open if
   the commercial cutover had already removed it, in which case the trigger is
   put back and the switch starts on).
2. Read the result of the last statement: `gate_trigger_attached_expect_true`,
   `gate_reads_switch_expect_true`, `rls_predicate_reads_switch_expect_true` and
   `settings_rls_on_expect_true` true; `settings_policies_expect_0` 0;
   `browser_can_read_switch_expect_false`, `browser_can_call_switch_expect_false`
   and `server_key_can_change_switch_expect_false` false;
   `commercial_seed_intact_expect_true` true.
3. **Turn it on**, as its own query:

   ```sql
   update public.signup_settings
      set public_signup = true, changed_at = now(),
          note = 'opened: founder decision 18 November 2026'
    where id = 1;
   ```

4. Check: `select public_signup, changed_at, note from public.signup_settings;`
   reads `true`. Then, from a phone, request a link on Make It Yours for an
   address you control that is **not** on `beta_allowlist`, open it, and
   confirm you come back signed in at the trial screen.

No Vercel variable and no redeploy are needed. It takes effect on the next
sign-up attempt.

### Turning it back off

```sql
update public.signup_settings
   set public_signup = false, changed_at = now(), note = 'closed: <why>'
 where id = 1;
```

Invitation only again, at once. Accounts made while it was on still exist;
with it off they are treated like any address not on the allowlist (if the
beta clause is still in the plan policies, their plan stops syncing to the
account and stays on their device). Add an address to `beta_allowlist` to keep
somebody in. To remove the switch itself, the file's header has the exact
ROLL BACK statements.

## The lease, and why it exists

The magic link gives a Supabase session. The lease is what actually delivers the
runtime, and it is separate on purpose: revoking access means deleting a row,
which ends delivery at the next revalidation on every device, rather than
waiting for a token to expire.

- **12 hours.** Long enough that an athlete is not re-authenticating mid-session;
  short enough that a revoked entitlement takes effect the same day even if the
  revocation path fails.
- The cookie carries **only an opaque id**. Every fact about the lease lives
  server-side.
- Deliberately **not** recorded on a lease: IP address, user agent, device
  fingerprint.
- `SameSite=Lax` rather than `Strict`, and the reason is concrete: a magic link
  arrives as a top-level navigation from a mail client, and `Strict` would drop
  the cookie on exactly that navigation.

## Magic-link expiry and reuse

Both are **Supabase Auth settings**, not application code, and they are the
right place for them — a link's lifetime is a property of the credential, and
GoTrue is what issues and redeems it. Sacoro neither extends nor shortens
them.

The application's protection against a stale or replayed link is the layer
underneath: a link only yields a Supabase session, and a session only yields
access if the entitlement resolves at that moment. A link redeemed after access
ended produces a signed-in athlete with no delivery.

## Canonical callback and custom domain

The app is served from its own origin and the callback returns there. The one
rule that matters and is enforced in code: **GoTrue is only ever given a
redirect target the server has validated against the deployment's own origins.**
The failure this prevents once shipped — an APK magic link landing on the web
site instead of the app — is recorded in `api/beta-signin.js` at the line that
fixes it.

---

## Apple and Google sign-in: built, hidden until configured

Founder, 18 November 2026: the first-time journey's **Make It Yours** screen
offers Continue with Apple, Continue with Google and Continue with Email, and
"build all three, with Apple and Google HIDDEN until configured".

**What works today:** Continue with Email, which is the magic link above,
unchanged. Apple and Google are in the code and switched off: the app asks
`GET /api/beta-signin` which ways in exist, and with `VVV_AUTH_PROVIDERS`
unset the answer is email only, so no Apple or Google button is drawn and
`POST /api/beta-signin {provider}` refuses with `provider_disabled`.

**How it works once on.** The app posts `{provider, redirect}` to
`/api/beta-signin`; the server validates the redirect with the same
`safeRedirect()` the email link uses and answers with the GoTrue address
`/auth/v1/authorize?provider=…&redirect_to=…`. The browser goes there, the
athlete signs in with Apple or Google, and Supabase returns the tokens in the
URL fragment of the validated redirect: the same place a magic link puts them,
so `cloudConsumeAuthHash()` (web) and `handleAuthDeepLink()` (installed app,
via `com.velvetviking.valhalla://auth`) complete it with no new code. The
journey's progress, the plan and the drives are on the device, so the athlete
comes back to the trial step exactly as they do after a magic link.

**The sign-up switch answers it, the same way as email.** An OAuth sign-in by
somebody with no account is the same `INSERT` into `auth.users` as a magic link
for a new address, so the `beta_allowlist_gate` trigger answers it in the same
way: with public sign-up on it admits them; with it off it refuses anyone not
on the allowlist, GoTrue reports that as `error_description=Database error
saving new user`, and the app says the account could not be created. Nothing in the
Apple or Google code opens or closes signup.

### Exact owner-only steps

Do these in order. **Do not paste any secret, key or `.p8` file into a chat or
into this repository.** The Supabase project ref is `eqiydxissphygnycpouu`, so
the one callback every provider needs is
`https://eqiydxissphygnycpouu.supabase.co/auth/v1/callback`.

**Supabase, first (both providers need it)**

1. Authentication → URL Configuration → Redirect URLs: make sure these are
   listed, or GoTrue ignores the redirect and falls back to the Site URL:
   `https://app.sacoro.app/**` and `https://app.velvetviking.co.uk/**` (the
   app returns to its own page; it moved to `app.sacoro.app` on 20 November
   2026, and the old address keeps answering) and
   `com.velvetviking.valhalla://auth` (the installed app; already needed by
   the magic link).

**Google**

2. Google Cloud console → APIs & Services → OAuth consent screen: User type
   External; app name SACORO; support email; authorised domains
   `velvetviking.co.uk` and `supabase.co`; scopes `openid`, `email`,
   `profile` only. Publish it (a consent screen left in Testing only admits
   the test users listed on it).
3. Credentials → Create credentials → OAuth client ID → **Web application**.
   Authorised JavaScript origins: `https://app.sacoro.app` and
   `https://app.velvetviking.co.uk`. Authorised
   redirect URIs: `https://eqiydxissphygnycpouu.supabase.co/auth/v1/callback`.
4. Copy the client ID and client secret into Supabase → Authentication →
   Sign In / Providers → **Google** → enable, paste both, save.

**Apple** (needs the paid Apple Developer membership)

5. Certificates, Identifiers & Profiles → Identifiers → the App ID
   `com.velvetviking.valhalla` → tick **Sign in with Apple** → save.
6. Identifiers → **+** → **Services IDs** → description "SACORO Sign In",
   identifier e.g. `com.velvetviking.valhalla.signin` (this is the OAuth
   client ID). Tick Sign in with Apple → Configure: primary App ID
   `com.velvetviking.valhalla`; Domains and Subdomains
   `eqiydxissphygnycpouu.supabase.co`; **Return URLs**
   `https://eqiydxissphygnycpouu.supabase.co/auth/v1/callback`. Save, Continue,
   Register.
7. Keys → **+** → name "SACORO Sign in with Apple" → tick Sign in with Apple →
   Configure → primary App ID `com.velvetviking.valhalla` → Register. Download
   the `.p8` file (Apple lets you download it once) and note the **Key ID** and
   your **Team ID** (top right of the developer site).
8. Supabase → Authentication → Sign In / Providers → **Apple** → enable.
   Client IDs: the Services ID from step 6. Secret Key (for OAuth): the client
   secret Supabase asks for is a JWT signed with the `.p8` (Team ID, Key ID,
   Services ID); generate it with the tool Supabase links from that panel.
   **It expires after at most six months**: put a reminder in the calendar to
   generate a new one, or Apple sign-in stops working on that day.
9. Apple's "Hide My Email" gives Supabase a private relay address. With public
   sign-up on this does not matter. With it off, a tester who chooses Hide My
   Email will be refused unless that relay address is on the allowlist; tell
   testers to share their real email, or add the relay address after their
   first try.

**Turn it on**

10. Vercel → the project → Settings → Environment Variables → add
    `VVV_AUTH_PROVIDERS` = `google`, `apple` or `apple,google` (Production),
    then redeploy. The button appears on Make It Yours on the next load; remove
    the name (and redeploy) to hide it again. Nothing else changes.
11. Try each on the website and in the installed app (with any address while
    public sign-up is on; with an allowlisted one while it is off). In the installed app the provider page opens in the phone's
    browser (Google refuses sign-in inside an embedded web view) and returns
    through `com.velvetviking.valhalla://auth`; this round trip has not yet been
    exercised on a device and is the thing to watch on the first try.

---

## Email sender — what is true now, and the exact user action to change it

**Now:** magic links are sent by **Supabase's built-in email sender**, from a
Supabase-operated domain, on Supabase's shared rate limits. That is fine for a
three-account private beta and is not fine for launch: shared-domain senders
have variable deliverability, the rate limit is low, and the email does not look
like it comes from Velvet Viking.

### The sending limit, plainly — read this before turning public sign-up on

**Opening sign-up does nothing for people who never receive the email.** Every
new athlete's first sign-in, and every sign-in on a new device, is one email.
Supabase's built-in sender is documented by Supabase as a test service, not for
production: it allows only a handful of emails per hour for the whole project,
and it may deliver only to the addresses of the members of the project's
Supabase team (check both in the dashboard: Authentication → Rate Limits, and
the note on Authentication → SMTP Settings — the figures are Supabase's and
change). If custom SMTP is not already set up:

- **Past the hourly cap**, GoTrue refuses with `429`, and the athlete reads
  *"Too many sign-in emails have been requested. Wait a few minutes, then try
  again"*. The cap is the project's, not the athlete's: one busy hour (the
  founder sending the link to a group) locks **everyone** out of signing in,
  including existing athletes on a new phone, until the hour rolls over.
- **An address the built-in sender will not mail** is refused by GoTrue, and
  the athlete reads *"SACORO couldn't request that sign-in link. Please let us
  know"* — or the link simply never arrives, or arrives in spam.
- Nothing in the application can work around either. The only remedy is the
  owner action below.

**The owner's action: set up a custom SMTP sender** (the steps below: a
provider such as Resend, Postmark or Amazon SES; SPF, DKIM and DMARC on
`velvetviking.co.uk`; the credentials in Supabase → SMTP Settings, never in a
chat or this repository; then raise Authentication → Rate Limits → emails per
hour to what the provider allows). Until that is done, public sign-up is open
in the database but, in practice, limited to a few people an hour.

**This is a configuration and contract step, not a code change.** Nothing in the
application needs to be edited to move to a branded sender.

### Exact user-only actions

1. **Choose an SMTP provider.** Resend, Postmark, or Amazon SES are the usual
   three. All three have a paid tier; a free tier that rate-limits is not
   suitable for sign-in email, because a rate-limited magic link is an athlete
   who cannot get in.
2. **Verify the sending domain** with that provider — SPF, DKIM and (strongly
   recommended) DMARC records on `velvetviking.co.uk`, added in Porkbun DNS.
   Deliverability without DKIM on a new domain is poor.
3. **In the Supabase dashboard** → Project Settings → Authentication → SMTP
   Settings: enable custom SMTP and enter the host, port, username, password and
   sender address the provider gives you. **Do not paste these anywhere else** —
   not into a chat, not into this repository.
4. **Set the sender name** to `Velvet Viking` and the sender address to something
   monitored, e.g. `hello@velvetviking.co.uk`. A no-reply address that bounces
   is how a confused athlete becomes a lost one.
5. **Raise the rate limit** in Authentication → Rate Limits once custom SMTP is
   on; the built-in sender's limit no longer applies but the project limit does.
6. **Customise the magic-link template** (Authentication → Email Templates) so
   the mail says Velvet Viking rather than Supabase. The `{{ .ConfirmationURL }}`
   token must be preserved exactly.
7. **Send yourself one**, on a phone, and check it does not land in spam.

### What must NOT be done

- Do not treat the mail sender as the sign-up gate. Who may create an account is
  the public sign-up switch (above), and it is independent of the mail sender;
  a sender that cannot deliver only means the people it lets in cannot sign in.
- Do not add a password login "as a backup" if an email is slow. That reverses
  the entire security posture to work around a deliverability problem.

---

## The one legacy credential

One account carries a real bcrypt password hash from before sign-in was a magic
link. **No product surface can use it** — there is no password path to present
it to. It is the reason Supabase's `auth_leaked_password_protection` warning is
not vacuous, and the proportionate response is to turn that dashboard setting on
(it costs nothing) rather than to build a password UX to satisfy a lint about
passwords.
