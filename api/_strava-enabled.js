// Is the Strava integration available on this deployment?
//
//   GET -> { enabled: boolean }
//
// Unauthenticated on purpose. The app has to know before it can decide what to
// draw in Settings, and a signed-out athlete opening Settings has no token to
// ask with. The answer is a single boolean about the deployment -- it names no
// athlete, reads no database and touches no credential, so there is nothing
// here to protect.
//
// The client defaults to unavailable and only becomes available when this route
// says so, which means a failed or blocked request leaves Strava switched off
// rather than switched on. This route is a UI input, never an enforcement
// point: every Strava endpoint checks the same flag for itself.

const S = require('./_strava.js');

async function handle(req, res){
  if (req.method !== 'GET' && req.method !== 'HEAD'){
    res.setHeader('Allow', 'GET');
    return S.json(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader('cache-control', 'no-store');
  return S.json(res, 200, { enabled: S.stravaEnabled() });
};

module.exports = { handle };
