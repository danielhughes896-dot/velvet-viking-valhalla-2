// Shared server-side helpers for the Voice Coach. Everything that needs the
// model API key lives behind this module and never crosses into the browser.
//
// THE ONE RULE THIS FILE EXISTS TO HOLD. Valhalla's coaching engine is
// deterministic arithmetic over the athlete's own logged sessions, and it stays
// the authority. The model reached from here may explain, summarise and
// converse about what the engine has already decided. It may not decide
// anything: it prescribes no session, computes no pace, and its reply is never
// written into a plan. See _voice-ask.js.

const S = require('./_strava.js');

/* THE MODEL ENDPOINT IS NOT NAMED IN THIS FILE, deliberately. It lives beside
   the one fetch that uses it, in _voice-ask.js, so "how many places can call a
   model" is answerable by grep -- and test/stravaPolicyBoundary.test.js asserts
   exactly one file in api/ names a model endpoint. A constant here would have
   made this shared module look like a second call site to that check, and to a
   reader. */
const VOICE_MODEL = 'claude-opus-5';

function env(name){ return process.env[name] || ''; }

/* ---------- the availability switch ----------
   Default OFF, exactly like Strava's. An unset variable is "not commissioned",
   which is the state a fresh deployment should be in: the athlete is shown no
   control rather than a control that 503s. Deliberately its own flag rather
   than "is the API key set", so "switched off on purpose" and "misconfigured"
   are never the same log line. */
function voiceEnabled(){
  return /^(on|true|1|yes|enabled)$/i.test(String(env('VVV_VOICE_ENABLED')).trim());
}
function voiceConfig(){
  return {
    enabled: voiceEnabled(),
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('VVV_VOICE_MODEL') || VOICE_MODEL
  };
}

/* Value-free operational logging, same contract as the Strava endpoints: what
   happened, never who or with what. No question text, no answer text, no
   context, no athlete id, no email, no key. A voice question can contain
   health information -- "my calf hurts" -- so the question itself is exactly
   the thing that must never reach a log line, an analytics event or an error
   report. */
function log(what){ try{ console.log('voice: ' + what); }catch(e){} }

module.exports = {
  VOICE_MODEL,
  voiceEnabled, voiceConfig, log,
  json: S.json, readBody: S.readBody, verifyUser: S.verifyUser
};
