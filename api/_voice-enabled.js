// Is the Voice Coach available on this deployment?
//
//   GET -> { enabled: boolean }
//
// Unauthenticated on purpose, and the same shape as /api/strava-enabled: the
// app has to know before it can decide what to draw on the Today card, and the
// answer is a single boolean about the deployment. It names no athlete, reads
// no database and touches no credential.
//
// The client defaults to unavailable and only becomes available when this
// route says so, so a failed or blocked request leaves voice switched OFF
// rather than on. This is a UI input, never an enforcement point: /api/voice-ask
// checks the same flag for itself, and also that a key exists.

const V = require('./_voice.js');

async function handle(req, res){
  if (req.method !== 'GET' && req.method !== 'HEAD'){
    res.setHeader('Allow', 'GET');
    return V.json(res, 405, { error: 'method_not_allowed' });
  }
  res.setHeader('cache-control', 'no-store');
  const cfg = V.voiceConfig();
  /* Both halves. A deployment with the switch on but no key would otherwise
     draw an Ask Coach control that always fails. */
  return V.json(res, 200, { enabled: !!(cfg.enabled && cfg.apiKey) });
}

module.exports = { handle };
