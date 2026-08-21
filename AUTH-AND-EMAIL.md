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
GoTrue is what issues and redeems it. Valhalla neither extends nor shortens
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
