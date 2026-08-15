// Private-beta sign-in. The app posts an email address here instead of calling
// GoTrue directly, so an unauthorised address gets one clear sentence rather
// than a database error it cannot interpret.
//
//   POST { email, redirect } -> 200 { sent:true }
//                            -> 403 { error:'not_in_beta' }
//
// THIS ENDPOINT IS NOT THE SECURITY BOUNDARY, and must not be mistaken for it.
// The publishable key ships in the client, so anyone can POST /auth/v1/otp at
// Supabase directly and skip this route entirely. What actually refuses is the
// BEFORE INSERT trigger on auth.users installed by supabase-beta-gate.sql, and
// what refuses a revoked tester is the is_beta_approved() predicate on the RLS
// policies. This route exists for the message, not the enforcement -- so if it
// were removed tomorrow the gate would still hold.
//
// The allowlist is read with the service-role key held in this process. It is
// never sent to the browser, and no part of the list is echoed in a response
// or a log line.

const S = require('./_strava.js');   // the canonical Supabase access layer:
                                     // project pinning, service-key attribution
                                     // and sb() all live there already.

const NATIVE_REDIRECT = 'com.velvetviking.valhalla://auth';

function log(what){ try{ console.log('beta-signin: ' + what); }catch(e){} }

/* Where GoTrue is allowed to send the athlete back to.
   Anything that is not this deployment or the app's own custom scheme is
   discarded in favour of the request origin -- an attacker-supplied redirect
   here would hand them the magic-link tokens. */
function safeRedirect(requested, origin){
  const want = String(requested || '').trim();
  if (want === NATIVE_REDIRECT) return want;
  if (want && want.indexOf(origin + '/') === 0) return want;
  if (want === origin) return want;
  return origin + '/';
}

/* A single allowlist row, by exact lowercased address. `select=email` keeps the
   response to the one field needed to answer yes/no. */
async function isApproved(cfg, email){
  const r = await S.sb(cfg, '/beta_allowlist?select=email' +
    '&email=eq.' + encodeURIComponent(email) +
    '&revoked_at=is.null&limit=1');
  if (!r.ok) return { ok: false };
  const rows = await r.json().catch(() => null);
  return { ok: true, approved: !!(rows && rows.length) };
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

  const check = await isApproved(cfg, email);
  if (!check.ok){
    // Fail CLOSED. If the allowlist cannot be read we do not know whether this
    // address is authorised, and guessing "yes" would be the whole gate.
    log('ALLOWLIST_UNREADABLE');
    return S.json(res, 503, { error: 'unavailable', code: 'ALLOWLIST_UNREADABLE' });
  }
  if (!check.approved){
    // No address in the log line, and the same body for every refusal.
    log('REFUSED not_in_beta');
    return S.json(res, 403, { error: 'not_in_beta' });
  }

  const origin   = S.siteOrigin(req);
  const redirect = safeRedirect(body.redirect, origin);

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
    return S.json(res, 502, { error: 'send_failed' });
  }

  if (!r.ok){
    log('GOTRUE_REFUSED status=' + r.status);
    return S.json(res, 502, { error: 'send_failed' });
  }
  log('SENT');
  return S.json(res, 200, { sent: true });
};
