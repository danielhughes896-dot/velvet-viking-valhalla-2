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
// This answer is PER CALLER, not per deployment, because Ask Coach and Strava
// are mutually exclusive per account -- an account that may use Strava is
// refused Ask Coach. LISTEN is unaffected and asks this route nothing.

const V = require('./_voice.js');
const S = require('./_strava.js');

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

  /* THE ACCOUNT-LEVEL SEPARATION, ANSWERED PER CALLER so no Ask Coach control
     is drawn for somebody /api/voice-ask would refuse. A token is optional
     here: no token is a signed-out athlete, and false is the honest answer for
     them, which is also what a failed verification gives. Fails closed either
     way. See the note in _voice-ask.js for why the two capabilities are
     disjoint. */
  let uid = null;
  try { uid = (await S.verifyUser(req, S.config())).uid || null; } catch(e){ uid = null; }
  if (!uid) return V.json(res, 200, { enabled: false });
  return V.json(res, 200, { enabled: !S.stravaAllowedForUser(uid) });
}

module.exports = { handle };
