// Owner-only deployment administration: the rare, one-off Strava push
// subscription operations. This is not athlete product surface and is reached
// from no control anywhere in the app.
//
//   POST { action: "subscription_view" }
//   POST { action: "subscription_create" }
//   POST { action: "subscription_delete", id: "123456" }
//
// Authorization has three independent requirements, all server-side:
//
//   1. a valid Supabase access token in the Authorization header, verified
//      against Supabase itself (not decoded here, so a forged or expired JWT
//      cannot pass and this server never needs the project's JWT secret);
//   2. that token's user id must equal VVV_OWNER_USER_ID;
//   3. the Strava client secret never leaves this process.
//
// Deliberately NOT how this used to work. Subscription management previously
// sat on GET /api/strava-webhook?op=…&admin=<STRAVA_WEBHOOK_VERIFY_TOKEN>,
// which made a webhook-callback verification value double as a reusable
// administrative credential, put that credential in a URL (browser history,
// referrers, proxy and platform request logs), and performed mutations on GET.
// STRAVA_WEBHOOK_VERIFY_TOKEN now does nothing except answer Strava's
// hub.verify_token handshake, which is the only thing it was ever for.

const S = require('./_strava.js');

const SUBS_URL = 'https://www.strava.com/api/v3/push_subscriptions';

// Server-side diagnostics only, and deliberately value-free: it records WHICH
// case was hit, never a token, key, user id, email or secret. Vercel function
// logs are readable by the deployment owner alone, and there is nothing in here
// worth reading anyway.
function log(what){ try{ console.log('strava-admin: ' + what); }catch(e){} }

function creds(cfg){
  return 'client_id=' + encodeURIComponent(cfg.clientId) +
         '&client_secret=' + encodeURIComponent(cfg.clientSecret);
}

module.exports = async function handler(req, res){
  const cfg = S.config();
  const ownerId = process.env.VVV_OWNER_USER_ID || '';

  if (req.method !== 'POST'){
    res.setHeader('Allow', 'POST');
    return S.json(res, 405, { error: 'Method not allowed' });
  }
  if (!cfg.serviceKey || !cfg.clientId || !cfg.clientSecret){
    log('strava is not configured');
    return S.json(res, 503, { error: 'strava_not_configured' });
  }

  // Fail closed. With no owner configured there is no such thing as an
  // authorised caller, so administration is simply unavailable rather than
  // open to the first signed-in account that finds the route.
  if (!ownerId){
    log('no owner is configured');
    return S.json(res, 503, { error: 'owner_not_configured' });
  }

  const who = await S.verifyUser(req, cfg);
  if (who.error === 'auth_unavailable'){
    // Not the caller's fault and not an expired session. Saying "sign in again"
    // here is what sent the owner round in circles, so it is now its own case.
    log('could not verify the caller with supabase');
    return S.json(res, 503, { error: 'auth_unavailable' });
  }
  if (!who.uid){
    log('rejected: ' + who.error);
    return S.json(res, 401, { error: 'not_signed_in', reason: who.error });
  }
  // Same 404 an unknown route would give: an ordinary signed-in athlete learns
  // nothing about whether this endpoint exists or who the owner is. The
  // distinction is recorded in the server log, which only the deployment owner
  // can read -- and without either id, so the log itself identifies nobody.
  if (who.uid !== ownerId){
    log('authenticated caller is not the configured owner');
    return S.json(res, 404, { error: 'not_found' });
  }

  const body = S.readBody(req);
  const action = body.action;

  try{
    if (action === 'subscription_view'){
      const r = await fetch(SUBS_URL + '?' + creds(cfg));
      return S.json(res, r.status, { subscriptions: await r.json().catch(() => []) });
    }
    if (action === 'subscription_create'){
      if (!cfg.verifyToken){
        log('webhook verify token is not set');
        return S.json(res, 503, { error: 'verify_token_not_configured' });
      }
      const r = await fetch(SUBS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: creds(cfg) +
          '&callback_url=' + encodeURIComponent(S.siteOrigin(req) + '/api/strava-webhook') +
          '&verify_token=' + encodeURIComponent(cfg.verifyToken)
      });
      return S.json(res, r.status, await r.json().catch(() => ({})));
    }
    if (action === 'subscription_delete'){
      const id = String(body.id || '').replace(/[^0-9]/g, '');
      if (!id) return S.json(res, 400, { error: 'Pass the id from subscription_view.' });
      log('deleting a subscription');
      const r = await fetch(SUBS_URL + '/' + id + '?' + creds(cfg), { method: 'DELETE' });
      return S.json(res, r.ok ? 200 : r.status, { deleted: r.ok });
    }
  }catch(e){
    log('upstream strava administration call failed');
    return S.json(res, 502, { error: 'strava_unavailable' });
  }
  return S.json(res, 400, { error: 'unknown_action' });
};
