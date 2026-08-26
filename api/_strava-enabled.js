// May the CALLER use the Strava integration?
//
//   GET -> { enabled: boolean }
//
// WHAT CHANGED, AND WHY. This used to answer a question about the DEPLOYMENT
// and was deliberately unauthenticated: a signed-out athlete opening Settings
// has no token, and the answer named no athlete. While the integration is
// founder-only that answer is no longer safe to give, because "this deployment
// has Strava" is not the same as "you may use it", and drawing a Connect
// button for an athlete the server will refuse is exactly what the brief rules
// out.
//
// So the question became per-caller. A request with no bearer token, or one
// whose account is not on the allowlist, gets `false` -- which is what a
// signed-out athlete now sees, and is the correct answer for them.
//
// STILL NEVER AN ENFORCEMENT POINT. Every Strava endpoint checks for itself;
// this only decides what is drawn. The client defaults to unavailable and only
// becomes available when this route says so, so a failed or blocked request
// leaves Strava switched off rather than on.

const S = require('./_strava.js');

async function handle(req, res){
  if (req.method !== 'GET' && req.method !== 'HEAD'){
    res.setHeader('Allow', 'GET');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader('cache-control', 'no-store');
  if (!S.stravaEnabled()) return S.json(res, 200, { enabled: false });

  /* No token is not an error here -- it is a signed-out athlete, and the
     honest answer for them is false. A failure to verify is the same answer
     for the same reason: this fails closed like everything else. */
  let uid = null;
  try { uid = (await S.verifyUser(req, S.config())).uid || null; } catch(e){ uid = null; }
  return S.json(res, 200, { enabled: S.stravaAllowedForUser(uid) });
};

module.exports = { handle };
