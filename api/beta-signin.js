// Sign-in. The app posts an email address here instead of calling GoTrue
// directly, so a failure gets one clear sentence rather than a provider error
// the browser cannot interpret.
//
//   POST { email, redirect } -> 200 { sent:true }
//
// PUBLIC AT COMMERCIAL LAUNCH. This route used to read public.beta_allowlist
// and answer 403 not_in_beta to any address that was not on it. That check is
// retired, and the retirement is the launch: authentication is now public and
// PRODUCT ACCESS is what is controlled.
//
// THE TWO ARE DIFFERENT QUESTIONS AND THE SEPARATION IS THE WHOLE MODEL.
// Anyone may prove they own an email address; nobody reaches Valhalla without a
// commercial entitlement. resolveAccess() in _access.js decides the second one
// against the entitlements row, and it refuses an authenticated account with no
// subscription, no trial and no override whether or not that account exists.
// Being able to sign in is worth exactly nothing on its own.
//
// SO THE ALLOWLIST IS NOT CONSULTED ANYWHERE IN THIS FILE ANY MORE. It survives
// in the database as the record of who was invited to the private beta, and the
// athletes who held beta access were converted at cutover into explicit
// complimentary grants. Adding a row to it today grants nobody anything, and
// this route must never become the place that changes.
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

const NATIVE_REDIRECT = 'com.velvetviking.valhalla://auth';

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

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  if (!cfg.serviceKey){
    log('SUPABASE_KEY_UNUSABLE source=' + cfg.serviceKeySource);
    return S.json(res, 503, { error: 'unavailable', code: 'SUPABASE_KEY_UNUSABLE' });
  }

  const body  = S.readBody(req);
  const email = String(body.email || '').trim().toLowerCase();
  // Shape only. Deliverability is Supabase's problem, not this route's.
  if (!email || email.indexOf('@') < 1 || email.length > 254){
    log('BAD_EMAIL_SHAPE');
    return S.json(res, 400, { error: 'bad_email' });
  }

  /* NO ELIGIBILITY CHECK HERE ANY MORE. A new address is a new athlete, and
     the commercial gate is what decides whether they see the product. The
     service-key check above stays: it is not about who may sign in, it is
     about whether this deployment can function at all. */

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
