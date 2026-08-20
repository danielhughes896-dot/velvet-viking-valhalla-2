// GET /api/garmin-status -> { provider, available, connected, reason }
//
// The one Garmin route that exists today, and the only one that can: it reports
// whether the integration is usable, which is knowable without Garmin's
// contract because the answer is currently no.
//
// WHY THE SERVER ANSWERS THIS. The Settings card must not decide for itself
// whether Garmin is available -- a client that can talk itself into "connected"
// is a client that will eventually draw a Connect button over an integration
// that cannot honour it. Availability comes from the deployment's own
// configuration, the same way /api/strava-enabled already works.
//
// It contacts nothing. No Garmin host is reached, no token is read; the answer
// is derived entirely from environment variables this deployment does or does
// not hold.

const S = require('./_strava.js');
const G = require('./_garmin.js');

async function handle(req, res){
  if (req.method !== 'GET' && req.method !== 'HEAD'){
    res.setHeader('Allow', 'GET, HEAD');
    return S.json(res, 405, { error: 'Method not allowed' });
  }
  return S.json(res, 200, G.availability());
}

module.exports = { handle };
