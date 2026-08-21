# Auth emails — templates, subjects, and the dashboard steps

**These templates are not deployed by this repository.** Supabase renders auth
emails from templates pasted into its own dashboard. Nothing in this codebase
sends them, and pushing this branch changes nothing an athlete receives until
somebody pastes them in.

They live here anyway, and the reason matters: a template that exists only in a
dashboard has no history, no review, no test, and no way to tell whether the
thing in production is the thing anybody agreed to. Every security property of a
magic-link email — that the link is the provider's own, that it is used once,
that the credential never appears as readable text — is a property of the
template. `test/authEmailTemplates.test.js` holds them.

---

## Root cause of the Supabase-branded email

The observed email had three tells, and together they say one thing.

| Observed | What it means |
|---|---|
| Footer: *"You're receiving this email because you signed up for an application powered by Supabase."* | Supabase appends this **only on its own built-in sender**. Custom SMTP does not add it. |
| Display name: **"Supabase Auth"** | The built-in sender's default identity. A custom SMTP sender name replaces it. |
| Subject: *"Your sign-in link"*, body *"Follow the link below to sign in."* | Supabase's current **default Magic Link template**, unedited. |

**So: custom SMTP is not in the live delivery path, and no template has been
customised.** Resend may be configured and the domain verified — that is a
Resend-side fact — but Supabase Auth is not using it to send. Configuring Resend
and enabling custom SMTP in Supabase are two separate switches, and the footer
proves the second one is off.

*(Stated as an inference, honestly: this worker has no outbound network access —
every HTTPS request is refused by the environment's proxy — so it cannot read
the Supabase project settings, the Resend dashboard, or Resend's logs. The
inference rests on the footer, which is decisive.)*

---

## Which templates are reachable

Decided by what the code does, not by which slots Supabase offers.

| Supabase template | Reachable? | Why |
|---|---|---|
| **Magic Link** | **Yes** | `api/beta-signin.js` → `POST /auth/v1/otp`, for an address that already has an account. |
| **Confirm signup** | **Yes** | Same endpoint. It sends `create_user: true`, so an address signing in for the **first time** is created and takes GoTrue's signup path. **This is the first email any athlete ever receives** — branding only Magic Link would leave every new athlete on the Supabase default. |
| **Invite user** | **Yes** | The dashboard's *Invite* button, which is how a beta tester can be onboarded. An operator action, but the athlete sees the email. |
| **Change Email Address** | **Unlikely, but possible** | No product surface changes an address. An operator changing one in the dashboard triggers it. Branded so it cannot be the one Supabase-looking email left. |
| **Reset Password** | **No** | There is no password anywhere in the product. A test fails if any file under `api/` or `protected/` grows one. |
| **Reauthentication** | **No** | Used for password change and similar. Same reason. |

**The last two are deliberately not authored.** Writing them would describe a
flow that does not exist and invite somebody to wire one up.

---

## The templates

| File | Supabase slot | Subject to set |
|---|---|---|
| `supabase-auth-emails/magic-link.html` | Magic Link | `Your Valhalla sign-in link` |
| `supabase-auth-emails/confirm-signup.html` | Confirm signup | `Your Valhalla sign-in link` |
| `supabase-auth-emails/invite.html` | Invite user | `You're invited to Valhalla` |
| `supabase-auth-emails/change-email.html` | Change Email Address | `Confirm your new Valhalla email address` |

**The subject is stored separately from the body.** Pasting the HTML and not
changing the subject leaves the Supabase default in place, which is half the
problem still shipping.

`magic-link.html` and `confirm-signup.html` are **byte-identical**, and a test
asserts it. One endpoint produces both depending on whether the athlete already
exists; they asked for a sign-in link either way and should not be able to tell
which internal path they took.

### The copy

**Magic Link and Confirm signup**

> **VELVET VIKING**
>
> **SIGN IN TO VALHALLA**
>
> Your secure sign-in link is ready.
>
> Use the button below to continue to Valhalla.
>
> **[ SIGN IN TO VALHALLA ]**
>
> This link expires shortly and can only be used once.
>
> If you didn't request this email, you can safely ignore it.
>
> **VELVET VIKING**
> Earn Your Place

**Invite** — heading *You're invited to Valhalla*; "You have been invited to
Valhalla, the Velvet Viking coaching programme." / "Use the button below to
accept your invitation and set up your account." CTA **ACCEPT YOUR INVITATION**.

**Change email** — heading *Confirm your email address*; "A request was made to
change the email address on your Valhalla account." / "Use the button below to
confirm the new address." CTA **CONFIRM THIS ADDRESS**. Closing line: "If you
didn't request this change, ignore this email and your address will stay as it
is."

### Design decisions worth knowing

- **No images.** Mail clients block remote images by default, so a crest would
  be an empty box for most athletes on first open — and a remote fetch from an
  email is a read receipt nobody agreed to. The wordmark is text, which always
  renders.
- **Inline styles, table layout.** Gmail strips `<style>` on some mobile views;
  Outlook ignores padding on an anchor, which is why the button is a table cell
  carrying `bgcolor` with a `display:block` anchor inside it.
- **No raw URL fallback.** The usual "or paste this link" line puts a working
  single-use credential into readable text where it can be screenshotted,
  forwarded or read over a shoulder. The CTA is an ordinary anchor, which every
  client renders, so the fallback buys nothing worth that.
- **The app's own colours**, not new ones: paper `#F4F1EA`, card `#FCFBFB`, ink
  `#171717`, gold `#7A5C1E`, bronze `#C0923F`. Every pairing is computed in the
  test and clears AA — 17.36:1 for body ink, 6.02:1 for the wordmark, 6.56:1 for
  the button.

### What must not change

Every template's only link is `{{ .ConfirmationURL }}`, exactly once, in an
`href` and nowhere else.

**That is the deep link.** Supabase builds that URL to point at the project's
own `/auth/v1/verify`, which then redirects to whatever `redirect_to` the server
passed — the custom scheme for the installed Android app, the site for the web.
Building a link by hand from `{{ .Token }}` and `{{ .SiteURL }}` throws that
away and sends **every** athlete to the web, including one who tapped from
inside the app. That is the exact failure recorded in `api/beta-signin.js`, and
four tests now guard against reintroducing it.

---

## Exact dashboard steps

All of this is Supabase dashboard work. None of it is a code deploy.

### 1. Turn on custom SMTP — this is the actual fix

**Project Settings → Authentication → SMTP Settings**

| Field | Value |
|---|---|
| Enable Custom SMTP | **ON** ← the switch the footer says is off |
| Sender email | `hello@velvetviking.co.uk` *(or the address already chosen in Resend — use that one)* |
| Sender name | `Velvet Viking` |
| Host | `smtp.resend.com` |
| Port | `587` |
| Username | `resend` |
| Password | the Resend **API key** (`re_…`) — Resend uses the API key as the SMTP password |
| Minimum interval between emails | leave at the default unless sign-in is being rate-limited |

Save, then **reload the page and confirm it still shows ON** — an unsaved SMTP
form looks identical to a saved one.

The sender address must be on a domain verified in Resend. If
`hello@velvetviking.co.uk` has not been verified, either verify it or use the
address that has. **Do not invent one.**

### 2. Paste the four templates

**Authentication → Emails → Templates.** For each row in the table above: set
the **Subject**, then replace the **Message body** with the file's contents.
Save each one.

### 3. Raise the rate limit if needed

**Authentication → Rate Limits.** The built-in sender's low limit no longer
applies once custom SMTP is on, but the project limit still does. A
rate-limited magic link is an athlete who cannot get in.

### 4. Verify — by receiving one, not by previewing one

1. Request a sign-in link for an allowlisted address on the **web**.
2. Check the received email: sender reads **Velvet Viking
   &lt;hello@velvetviking.co.uk&gt;**, subject is **Your Valhalla sign-in link**,
   and there is **no Supabase footer**.
3. Tap the button — it should land in Valhalla, signed in.
4. Repeat on an **Android device with the app installed**: the same link must
   open the app, not the browser. This is the one that would catch a template
   that rebuilt the URL.
5. Tap the same link a second time — it must be refused. One-time use is
   GoTrue's, not the template's, and this confirms nothing about it changed.
6. **Resend → Logs** should show the delivery. If it does not, Supabase is
   still sending through its own service and step 1 did not save.

### 5. Deliverability

Resend's own domain verification covers SPF and DKIM. **DMARC is separate and
is worth adding**: a `_dmarc.velvetviking.co.uk` TXT record, starting at
`v=DMARC1; p=none; rua=mailto:...` so reports arrive before anything is
enforced. Not a blocker for sign-in mail, and the thing that stops it drifting
into spam folders later.

---

## Still Supabase-branded elsewhere in the auth journey?

The email is the only customer-facing surface Supabase renders. The redirect it
lands on is served by this deployment, the sign-in page is ours, and the runtime
is ours. The one remaining trace is the **hostname in the link itself** —
`eqiydxissphygnycpouu.supabase.co`, visible if an athlete hovers or long-presses
the button. Removing it needs a **custom auth domain** (`auth.velvetviking.co.uk`
as a CNAME, configured in Supabase), which is a paid add-on on some plans. It is
cosmetic and it is not a blocker; it is listed so nobody discovers it later and
thinks it was missed.
