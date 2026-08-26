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
// checks the same flags for itself, and also that a key exists.
//
// A DEPLOYMENT question, not an account one. Having Strava connected, or being
// on the Strava allowlist, does not affect whether an athlete may talk to their
// coach -- it affects only which EVIDENCE may reach the model, which is decided
// per item when the context is assembled. LISTEN asks this route nothing.

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
  if (!(cfg.enabled && cfg.apiKey)) return V.json(res, 200, { enabled: false });

  /* ACCOUNT ELIGIBILITY IS NOT DATA ELIGIBILITY, and an earlier pass of this
     file confused the two: it refused Ask Coach to any account permitted to use
     Strava. That is not the product. An athlete may have Strava, LISTEN and Ask
     Coach at once; what Strava restricts is the DATA that may reach a model,
     and that is enforced per item of evidence when the context is assembled --
     not by removing the capability from the account.

     So this route is back to a deployment question, and a signed-out athlete
     gets the same answer as a signed-in one. Ask Coach still requires the
     switch and a key, and still fails closed without either. */
  return V.json(res, 200, { enabled: true });
}

module.exports = { handle };
