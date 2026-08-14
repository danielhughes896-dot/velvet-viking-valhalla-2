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
  if (!cfg.serviceKey || !cfg.clientId || !cfg.clientSecret)
    return S.json(res, 503, { error: 'Strava is not configured on this server.' });

  // Fail closed. With no owner configured there is no such thing as an
  // authorised caller, so administration is simply unavailable rather than
  // open to the first signed-in account that finds the route.
  if (!ownerId)
    return S.json(res, 503, { error: 'No owner is configured for this deployment.' });

  const uid = await S.userIdFromRequest(req, cfg);
  if (!uid) return S.json(res, 401, { error: 'not_signed_in' });
  // Same 404 an unknown route would give: an ordinary signed-in athlete learns
  // nothing about whether this endpoint exists or who the owner is.
  if (uid !== ownerId) return S.json(res, 404, { error: 'not_found' });

  const body = S.readBody(req);
  const action = body.action;

  try{
    if (action === 'subscription_view'){
      const r = await fetch(SUBS_URL + '?' + creds(cfg));
      return S.json(res, r.status, { subscriptions: await r.json().catch(() => []) });
    }
    if (action === 'subscription_create'){
      if (!cfg.verifyToken)
        return S.json(res, 503, { error: 'STRAVA_WEBHOOK_VERIFY_TOKEN is not set on this server.' });
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
      const r = await fetch(SUBS_URL + '/' + id + '?' + creds(cfg), { method: 'DELETE' });
      return S.json(res, r.ok ? 200 : r.status, { deleted: r.ok });
    }
  }catch(e){
    return S.json(res, 502, { error: 'Could not reach Strava' });
  }
  return S.json(res, 400, { error: 'Unknown action' });
};
