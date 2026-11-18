// Sign-in. The app posts an email address here instead of calling GoTrue
// directly, so a failure gets one clear sentence rather than a provider error
// the browser cannot interpret.
//
//   POST { email, redirect } -> 200 { sent:true }
//   GET                      -> 200 { providers: { email, apple, google },
//                                     public_signup: true | false | null }
//   POST { provider, redirect } -> 200 { url }  (Apple / Google, when enabled)
//
// PUBLIC SIGN-UP IS A SWITCH IN THE DATABASE (founder, 18 November 2026: "It's
// on Vercel so only I can send it to people. So make it as if it's ready to
// go."). public.signup_settings.public_signup, installed by
// supabase-public-signup.sql, is read by the BEFORE INSERT trigger on
// auth.users: on, any address may become an account; off, only addresses on
// the beta allowlist may. THIS ROUTE DOES NOT ENFORCE IT and does not read the
// allowlist, for the reason below: the trigger is the only place an account
// is created, so it is the only place the rule can live without a second copy
// that disagrees. The route reads the switch (_signup.js) for two things only:
// GET tells the app whether to speak of a private beta, and, while the switch
// is OFF, a refusal GoTrue reports as "Database error saving new user" is the
// closed gate itself and is answered 403 not_in_beta, so the athlete reads the
// private-beta sentence rather than "the email service isn't responding".
// While it is ON that refusal cannot be the gate, and is classified like any
// other provider failure.
//
// APPLE AND GOOGLE (founder, 18 November 2026: "build all three, with Apple
// and Google HIDDEN until configured"). Supabase OAuth, started here for the
// same reason the email link is: the redirect target GoTrue is given is one
// this server validated, never one a page made up. Each provider is OFF until
// the owner names it in VVV_AUTH_PROVIDERS (e.g. "apple,google"), after the
// provider itself is set up in Apple, Google and Supabase -- the steps are in
// AUTH-AND-EMAIL.md. A provider that is off is not listed by GET, so the app
// draws no button for it, and POST refuses it.
//
// NOTHING HERE OPENS OR CLOSES SIGNUP. An OAuth sign-in by somebody with no
// account is the same INSERT into auth.users as a magic link for a new
// address, so the database's own trigger, and the switch it reads, answer
// both in the same way.
//
// PUBLIC AT COMMERCIAL LAUNCH. This route used to read public.beta_allowlist
// and answer 403 not_in_beta to any address that was not on it. That check is
// retired, and the retirement is the launch: authentication is now public and
// PRODUCT ACCESS is what is controlled.
//
// THE TWO ARE DIFFERENT QUESTIONS AND THE SEPARATION IS THE WHOLE MODEL.
// Anyone may prove they own an email address; nobody reaches Sacoro without a
// commercial entitlement. resolveAccess() in _access.js decides the second one
// against the entitlements row, and it refuses an authenticated account with no
// subscription, no trial and no override whether or not that account exists.
// Being able to sign in is worth exactly nothing on its own.
//
// SO THE ALLOWLIST IS NOT CONSULTED ANYWHERE IN THIS FILE ANY MORE. It survives
// in the database as the record of who was invited to the private beta and, while
// the public sign-up switch is off, as the list the trigger lets create an
// account. Adding a row to it grants nobody any product access, and this route
// must never become the place that changes.
//
// THIS ENDPOINT IS STILL NOT A SECURITY BOUNDARY, and must not be mistaken for
// one. The publishable key ships in the client, so anyone can POST /auth/v1/otp
// at Supabase directly and skip this route entirely -- which was true while the
// allowlist check lived here too. What it does provide is a validated redirect
// target, a single place to classify provider failures honestly, and a server
// that holds the service key rather than a browser that does not.

const S = require('./_strava.js');   // the canonical Supabase access layer:
                                     // project pinning, service-key attribution
                                     // and sb() all live there already.
const Signup = require('./_signup.js');   // the public sign-up switch, read for wording

const NATIVE_REDIRECT = 'com.velvetviking.valhalla://auth';

/* Which OAuth providers this deployment offers. Read from the environment on
   every call, so switching one on or off is a configuration change and not a
   deploy. Unknown names are ignored: the list can only ever name these two. */
const OAUTH_PROVIDERS = ['apple', 'google'];
function enabledProviders(env){
  const raw = String(((env || process.env).VVV_AUTH_PROVIDERS) || '').toLowerCase();
  const named = raw.split(/[\s,]+/).filter(Boolean);
  return OAUTH_PROVIDERS.filter(function(p){ return named.indexOf(p) !== -1; });
}
/* The GoTrue address that starts an OAuth sign-in. The implicit flow: the
   tokens come back in the fragment of the validated redirect, exactly where a
   magic link puts them, so the app's existing return path consumes both. */
function authorizeUrl(supabaseUrl, provider, redirect){
  return String(supabaseUrl || '').replace(/\/+$/, '') + '/auth/v1/authorize?provider=' +
    encodeURIComponent(provider) + '&redirect_to=' + encodeURIComponent(redirect);
}

function log(what){ try{ console.log('beta-signin: ' + what); }catch(e){} }

/* Where a browser sign-in comes back to. NOT '/', which vercel.json routes to
   /api/app -- the protected runtime behind the account gate. A magic link that
   lands there has arrived at the wrong end of the product: the commercial
   entry journey lives at /start, and /start is what knows how to consume the
   fragment, establish the session and route by entitlement. */
const ENTRY_PATH = '/start';

/* EVERY ORIGIN THIS DEPLOYMENT LEGITIMATELY ANSWERS ON.

   THE COMMISSIONING FAILURE THIS FIXES. safeRedirect() used to validate
   against ONE origin -- siteOrigin(req), which returns VVV_SITE_ORIGIN when
   pinned and the forwarded Host otherwise. The moment the product gained a
   canonical custom domain those two stopped being the same thing: a browser on
   https://app.velvetviking.co.uk asked to come back to
   https://app.velvetviking.co.uk/start, the single origin resolved to the
   deployment's own *.vercel.app host, the requested redirect matched neither
   branch, and the function fell through to `origin + '/'`.

   So the emailed link pointed at the vercel.app host, at '/', which routes to
   the protected runtime rather than to /start -- exactly the reported symptom,
   wrong host and a sign-in screen that could only say the link had not worked.

   The fix is to stop pretending there is one origin. A deployment answers on
   its canonical domain AND on the host the request actually arrived at, and
   both are legitimate: the first is what athletes use, the second is what
   makes previews and localhost work with no configuration. Order matters --
   the canonical origin is first, so it is also what the fallback uses.

   THIS DOES NOT WIDEN WHAT IS ACCEPTED IN THE DANGEROUS DIRECTION. An
   arbitrary attacker-supplied redirect is still refused; what changed is that
   this deployment's own front door is no longer refused along with it. */
function webOrigins(req, env){
  const e = env || process.env;
  const out = [];
  const pinned = String(e.VVV_SITE_ORIGIN || '').trim().replace(/\/+$/, '');
  if (pinned) out.push(pinned);
  const h = (req && req.headers) || {};
  const proto = h['x-forwarded-proto'] || 'https';
  const host = h['x-forwarded-host'] || h.host;
  if (host){
    const o = String(proto) + '://' + String(host);
    if (out.indexOf(o) === -1) out.push(o);
  }
  return out;
}

/* Where GoTrue is allowed to send the athlete back to: the app's own custom
   scheme, or anything under one of this deployment's own origins. Anything
   else is discarded in favour of the canonical entry point -- an
   attacker-supplied redirect here would hand them the magic-link tokens. */
function safeRedirect(requested, origins){
  const list = (Array.isArray(origins) ? origins : [origins]).filter(Boolean);
  const want = String(requested || '').trim();
  if (want === NATIVE_REDIRECT) return want;
  for (let i = 0; i < list.length; i++){
    if (want === list[i]) return want;
    if (want && want.indexOf(list[i] + '/') === 0) return want;
  }
  return (list[0] || '') + ENTRY_PATH;
}

module.exports = async function handler(req, res){
  const cfg = S.config();

  /* What a sign-in screen may offer. Public, and it says nothing about anybody:
     only which ways in this deployment has switched on. */
  if (req.method === 'GET'){
    const on = enabledProviders();
    /* public_signup is the database's switch, as it stands now: true, false,
       or null when it cannot be read (no service key, the migration not yet
       applied). The app treats null exactly as false -- today's wording -- so
       a failed read can only ever produce what was said before. */
    const open = await Signup.readPublicSignup(S, cfg);
    return S.json(res, 200, { providers: { email: true,
      apple: on.indexOf('apple') !== -1, google: on.indexOf('google') !== -1 },
      public_signup: open });
  }
  if (req.method !== 'POST'){
    res.setHeader('Allow', 'GET, POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const body  = S.readBody(req);

  /* APPLE OR GOOGLE. Refused unless switched on; otherwise the answer is the
     authorize address, with the redirect validated exactly as the email
     link's is. No call is made from here: the browser goes to GoTrue itself. */
  if (body && body.provider != null){
    const provider = String(body.provider || '').toLowerCase();
    if (enabledProviders().indexOf(provider) === -1){
      log('PROVIDER_OFF');
      return S.json(res, 404, { error: 'provider_disabled' });
    }
    const target = safeRedirect(body.redirect, webOrigins(req));
    log('OAUTH_START provider=' + provider);
    return S.json(res, 200, { url: authorizeUrl(cfg.supabaseUrl, provider, target) });
  }

  const email = String(body.email || '').trim().toLowerCase();
  // Shape only. Deliverability is Supabase's problem, not this route's.
  if (!email || email.indexOf('@') < 1 || email.length > 254){
    log('BAD_EMAIL_SHAPE');
    return S.json(res, 400, { error: 'bad_email' });
  }

  /* NO ELIGIBILITY CHECK HERE. Whether a new address may become an account
     is the database's switch, enforced by its trigger; whether an account may
     use the product is the commercial gate. The service-key check above
     stays: it is not about who may sign in, it is about whether this
     deployment can function at all. */

  const origins  = webOrigins(req);
  const redirect = safeRedirect(body.redirect, origins);

  /* GoTrue takes the redirect target from ?redirect_to=, not from the body --
     the same detail that once made every APK magic link land on the web Site
     URL instead of the app. Sent with the publishable key, exactly as the
     browser used to send it; the service key is deliberately NOT used here, so
     this route cannot mint a session, only ask for an emailed link. */
  let r;
  try{
    r = await fetch(cfg.supabaseUrl + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {
      method: 'POST',
      headers: { 'apikey': cfg.anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email: email, create_user: true })
    });
  }catch(e){
    log('GOTRUE_UNREACHABLE');
    return S.json(res, 502, { error: 'send_failed', reason: 'provider_error' });
  }

  if (!r.ok){
    /* WHY THIS READS THE BODY.

       Every refusal from GoTrue used to collapse into one 502 and one sentence,
       so a rate limit, a redirect target the project does not allow, and an
       email provider that is switched off were indistinguishable from the
       outside -- and each needs a completely different action. The status alone
       is not enough either: 400 and 422 both mean "we rejected your request"
       without saying which part.

       Classified by STATUS, deliberately, rather than by guessing at GoTrue's
       error strings. The upstream error_code is recorded in the server log for
       whoever is actually debugging, and never returned: `msg` in particular
       can echo the address that was submitted, so nothing from this body
       reaches the browser. What we return is our own vocabulary. */
    const upstream = await r.json().catch(function(){ return {}; });
    const code = upstream.error_code || upstream.code || null;
    /* THE CLOSED GATE, SAID AS WHAT IT IS. The trigger on auth.users refused
       a new address, and GoTrue reported it as a database error. Only while
       the switch is not known to be ON: with sign-up open, the gate admits
       every address, so the same words mean something else failed and are
       classified below like any other provider refusal. The allowlist is not
       read here; the database already answered. */
    if (Signup.isNewUserRefusal(upstream)){
      const open = await Signup.readPublicSignup(S, cfg);
      if (open !== true){
        log('SIGNUP_CLOSED status=' + r.status);
        return S.json(res, 403, { error: 'not_in_beta' });
      }
    }
    const reason = r.status === 429 ? 'rate_limited'
                 : (r.status >= 400 && r.status < 500) ? 'request_rejected'
                 : 'provider_error';
    log('GOTRUE_REFUSED status=' + r.status + ' reason=' + reason +
        (code ? ' upstream=' + String(code).slice(0, 40) : ''));
    return S.json(res, 502, { error: 'send_failed', reason: reason });
  }
  log('SENT');
  return S.json(res, 200, { sent: true });
};

/* Exported so the redirect decision can be exercised directly. It is the one
   part of this route that decides where magic-link tokens are delivered, and
   the commissioning failure it now guards against was invisible to every test
   that only checked the handler's status codes. */
module.exports.safeRedirect = safeRedirect;
module.exports.webOrigins = webOrigins;
module.exports.NATIVE_REDIRECT = NATIVE_REDIRECT;
module.exports.ENTRY_PATH = ENTRY_PATH;
module.exports.enabledProviders = enabledProviders;
module.exports.authorizeUrl = authorizeUrl;
module.exports.OAUTH_PROVIDERS = OAUTH_PROVIDERS;
