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
2. The server checks the address is on the beta allowlist. **This is the closed
   gate.** An address not on the list cannot become an account at all, and the
   refusal is a database trigger on `auth.users` insert — not a UI check.
3. The server calls Supabase GoTrue's `/auth/v1/otp` with a `redirect_to` it has
   **validated itself**. The target never comes from the request body
   unmodified: an attacker-supplied redirect would hand them the tokens carried
   in the link. `safeRedirect()` is exported so it can be exercised directly.
4. Supabase emails the link.
5. The link lands on the app origin, which exchanges it for a session.
6. `POST /api/session` verifies the token against Supabase, resolves the
   entitlement, and mints a **delivery lease**.

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

**The beta stays closed.** An OAuth sign-in by somebody with no account is the
same `INSERT` into `auth.users` as a magic link for a new address, so the
`beta_allowlist_gate` trigger refuses it in the same way. GoTrue reports that
as `error_description=Database error saving new user`, which the app shows as
the private-beta sentence. Nothing here opens public signup.

### Exact owner-only steps

Do these in order. **Do not paste any secret, key or `.p8` file into a chat or
into this repository.** The Supabase project ref is `eqiydxissphygnycpouu`, so
the one callback every provider needs is
`https://eqiydxissphygnycpouu.supabase.co/auth/v1/callback`.

**Supabase, first (both providers need it)**

1. Authentication → URL Configuration → Redirect URLs: make sure these are
   listed, or GoTrue ignores the redirect and falls back to the Site URL:
   `https://app.velvetviking.co.uk/**` (the app returns to its own page) and
   `com.velvetviking.valhalla://auth` (the installed app; already needed by
   the magic link).

**Google**

2. Google Cloud console → APIs & Services → OAuth consent screen: User type
   External; app name SACORO; support email; authorised domains
   `velvetviking.co.uk` and `supabase.co`; scopes `openid`, `email`,
   `profile` only. Publish it (a consent screen left in Testing only admits
   the test users listed on it).
3. Credentials → Create credentials → OAuth client ID → **Web application**.
   Authorised JavaScript origins: `https://app.velvetviking.co.uk`. Authorised
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
9. Apple's "Hide My Email" gives Supabase a private relay address. While the
   beta allowlist is in force, a tester who chooses Hide My Email will be
   refused unless that relay address is on the allowlist; tell testers to
   share their real email, or add the relay address after their first try.

**Turn it on**

10. Vercel → the project → Settings → Environment Variables → add
    `VVV_AUTH_PROVIDERS` = `google`, `apple` or `apple,google` (Production),
    then redeploy. The button appears on Make It Yours on the next load; remove
    the name (and redeploy) to hide it again. Nothing else changes.
11. Try each on the website and in the installed app with an allowlisted
    address. In the installed app the provider page opens in the phone's
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

- Do not open public signup while doing this. The allowlist trigger is what
  keeps the beta closed and it is independent of the mail sender.
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
