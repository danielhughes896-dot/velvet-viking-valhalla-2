// The OAuth redirect_uri. Strava sends the athlete's browser here after they
// approve (or decline) on Strava's own page.
//
// The authorization code is exchanged for tokens HERE, server-side, and the
// tokens are written straight to Supabase. The browser is then redirected back
// to the app with nothing but a one-word outcome flag -- no code, no token, no
// athlete id, nothing worth stealing out of the address bar or history.

const S = require('./_strava.js');

// Return through /auth, not /. That path is already rewritten to the app by
// vercel.json AND already declared as an autoVerify App Link in the Android
// manifest, so once the release-signing secrets are in place Android hands
// this redirect straight back to the installed APK instead of leaving the
// athlete in Chrome. No new custom scheme, no second OAuth implementation in
// the app, and on the web it is just another URL that serves the same page.
function back(res, origin, outcome){
  res.writeHead(302, {
    'Location': origin + '/auth?strava=' + encodeURIComponent(outcome),
    'cache-control': 'no-store'
  });
  res.end();
}

module.exports = async function handler(req, res){
  const cfg = S.config();
  const origin = S.siteOrigin(req);
  const q = req.query || {};

  if (req.method !== 'GET'){
    res.setHeader('Allow', 'GET');
    return S.json(res, 405, { error: 'Method not allowed' });
  }
  if (!cfg.clientId || !cfg.clientSecret || !cfg.serviceKey) return back(res, origin, 'unconfigured');

  // The athlete pressed Cancel/Authorize-denied on Strava's page.
  if (q.error) return back(res, origin, 'denied');
  if (!q.code)  return back(res, origin, 'failed');

  // No valid state means this callback was not started by us -- a replayed or
  // forged link. Nothing is exchanged and nothing is stored.
  const uid = S.verifyState(q.state, cfg.clientSecret);
  if (!uid) return back(res, origin, 'failed');

  // Strava returns the granted scopes; without activity read access there is
  // nothing VVV can do, so treat a partial grant as a refusal rather than
  // storing a connection that can never sync.
  const granted = String(q.scope || '');
  if (granted && granted.indexOf('activity:read') === -1) return back(res, origin, 'scope');

  const ex = await S.exchangeCode(cfg, q.code);
  if (!ex.ok || !ex.data.access_token || !ex.data.refresh_token) return back(res, origin, 'failed');

  const ath = ex.data.athlete || {};
  const saved = await S.saveConnection(cfg, {
    user_id: uid,
    strava_athlete_id: ath.id != null ? ath.id : null,
    access_token: ex.data.access_token,
    refresh_token: ex.data.refresh_token,
    expires_at: ex.data.expires_at,
    scope: granted || S.STRAVA_SCOPE,
    athlete_name: [ath.firstname, ath.lastname].filter(Boolean).join(' ') || null,
    connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  if (!saved.ok) return back(res, origin, 'failed');

  back(res, origin, 'connected');
};
