// Velvet Viking -- the Garmin adapter boundary.
//
// WHAT THIS FILE IS. The place the Garmin-specific code will live, built as far
// as it can honestly be built before Garmin supplies an approved contract, and
// deliberately no further. Everything provider-NEUTRAL already exists in the
// app: the canonical workout DTO, the scheduled-training projection, the
// reconciliation engine and its idempotence. What is missing is Garmin's half,
// and Garmin's half cannot be guessed.
//
// WHAT IS NOT INVENTED HERE, AND WHY IT MATTERS. None of the following appear
// anywhere in this file, because writing a plausible version of any of them
// produces code that looks finished, passes its own tests, and is wrong:
//
//   endpoint URLs            token lifetime and refresh semantics
//   OAuth scopes             workout and calendar remote-ID semantics
//   request schemas          webhook/ping delivery shape
//   response schemas         rate limits and backoff
//
// Garmin's public Developer Program material indicates OAuth 2.0, so that is
// the authentication FAMILY this is shaped for. Nothing beyond the family is
// assumed -- not the grant type, not the parameter names, not the endpoints.
//
// FAIL CLOSED IS THE WHOLE CONTRACT OF THIS FILE TODAY. configured() is false
// without real environment variables, and every export refuses on it before
// doing anything else. Not "returns an error" -- no request is constructed, no
// token is read, no host is contacted, nothing is logged as a failure, because
// nothing is attempted. An unconfigured deployment behaves exactly as it did
// before Garmin existed in the codebase.

const S = require('./_strava.js');

/* The three things a real integration cannot run without. All three are read
   from the environment and none has a default -- a fallback here is how a
   fail-closed gate quietly becomes fail-open. */
function config(){
  const env = k => (process.env[k] || '').trim();
  return {
    clientId:     env('VVV_GARMIN_CLIENT_ID'),
    clientSecret: env('VVV_GARMIN_CLIENT_SECRET'),
    // Explicit opt-in, separate from having credentials: an operator can hold
    // credentials for a staging app without a production deployment starting
    // to sync athletes' calendars the moment they are set.
    enabled:      env('VVV_GARMIN_ENABLED') === '1'
  };
}

/* Configured means: we have credentials AND we were told to use them. Both,
   never either. */
function configured(){
  const c = config();
  return !!(c.enabled && c.clientId && c.clientSecret);
}

/* Why the integration is unavailable, in terms an athlete-facing surface can
   render without describing our deployment to a stranger. The distinction the
   Settings card needs is only "not available yet", so that is all it gets. */
function availability(){
  return {
    provider: 'garmin',
    available: configured(),
    connected: false,      // no connection can exist before the contract does
    reason: configured() ? 'ready' : 'awaiting_approval'
  };
}

/* ---------------------------------------------------------------------------
   THE ADAPTER SURFACE
   ---------------------------------------------------------------------------
   These are the functions the rest of the system will call. Each is real code
   with a real signature and a real refusal; each has exactly one unimplemented
   step, and that step is the one that needs Garmin's contract. They throw a
   tagged error rather than returning a plausible-looking result, because a
   silent success here would mean an athlete believing a workout reached their
   watch when nothing was sent.
   --------------------------------------------------------------------------- */
function notAvailable(what){
  const e = new Error('garmin_unavailable');
  e.code = 'GARMIN_UNAVAILABLE';
  e.detail = what;
  return e;
}
function contractMissing(what){
  const e = new Error('garmin_contract_missing');
  e.code = 'GARMIN_CONTRACT_MISSING';
  e.detail = what;
  return e;
}

/* OAuth 2.0 authorization start. The redirect URI is ours and is settled here
   so it can be registered with Garmin ahead of time; everything else about the
   authorize request -- host, path, scope names, extra parameters -- waits. */
function redirectUri(req){ return S.siteOrigin(req) + '/api/garmin-callback'; }

async function beginAuthorization(req){
  if (!configured()) throw notAvailable('authorization');
  throw contractMissing('authorize endpoint, scopes and parameter names');
}
async function completeAuthorization(req){
  if (!configured()) throw notAvailable('callback');
  throw contractMissing('token endpoint, grant type and response schema');
}
async function disconnect(uid){
  if (!configured()) throw notAvailable('disconnect');
  throw contractMissing('token revocation endpoint');
}

/* The push half. `actions` is exactly what reconcileScheduledTraining()
   produced -- create/update/remove/noop/skip_past, each carrying the canonical
   provider workout. Translating a canonical step into Garmin's step schema is
   the single missing piece, and it is missing because the schema is not public.
   Note what is NOT missing: which workouts to send, in what order, on which
   dates, and whether anything needs sending at all. */
async function applyScheduledTraining(uid, actions){
  if (!configured()) throw notAvailable('scheduled_training');
  throw contractMissing('workout schema, calendar schema and remote-ID semantics');
}

/* The return half. Garmin's Activity API eventually delivers a completed
   activity; it normalises into the SAME activity shape the Strava path already
   produces, and from there the existing execution scoring and evidence rules
   handle it. There is deliberately no Garmin-specific coaching path: a workout
   that came back from a watch is evidence like any other. */
async function ingestActivity(uid, payload){
  if (!configured()) throw notAvailable('activity_ingest');
  throw contractMissing('activity payload schema and delivery/webhook shape');
}

module.exports = {
  config, configured, availability, redirectUri,
  beginAuthorization, completeAuthorization, disconnect,
  applyScheduledTraining, ingestActivity,
  // exported for tests: the refusal shapes are part of the contract
  notAvailable, contractMissing
};
