'use strict';
/* HEALTH AND READINESS INFORMATION — THE SERVER HALF OF THE CONSENT BOUNDARY.
 *
 * The athlete grants or withdraws consent in the app, and the app stops using
 * covered information the moment they do. That is enough for anything the
 * athlete types, and it is NOT enough for anything a provider sends us: a
 * connected Strava account keeps delivering activities whether the app is open
 * or not, and every one of them carries a heart rate. Refusing it in the
 * browser would leave it already written to `strava_activities` — collected,
 * stored, and merely unread.
 *
 * So the boundary is enforced where the row is written. stripCovered() is
 * applied to every staged activity whose athlete has not consented, and the
 * fields are removed BEFORE the payload is persisted rather than filtered on
 * the way back out.
 *
 * FAIL CLOSED, EVERY TIME. An unreadable database, a missing table, a network
 * error, a malformed row and an unknown user all produce "not granted". The
 * cost of that is one activity imported without its heart rate, which the
 * athlete can restore by consenting and re-syncing. The cost of failing open
 * is processing special-category data without a lawful basis.
 *
 * WHAT THIS IS NOT. It is not an analytics pipeline, it does not write, and
 * nothing here reaches monday.com or Stripe — neither of which is ever sent
 * any covered field by any code path in this repository.
 */

/* One line, one code, no payload and no account reference. Consent failing
   closed is CORRECT and is also INVISIBLE: "why is this athlete's heart rate
   missing" has three very different answers -- they declined, the table is
   unreachable, or their consent is against a retired version -- and without a
   code they are indistinguishable from each other in production. The athlete
   is never named; what is recorded is which of the three happened. */
function log(what){ try{ console.log('health-consent: ' + what); }catch(e){} }

/* Must equal HEALTH_CONSENT_VERSION in the app runtime. A consent recorded
   against a different version does not count: the two constants are asserted
   identical by test, so they cannot drift apart silently. */
const HEALTH_CONSENT_VERSION = 'health_data_consent_v1';

/* The fields on a normalised activity that can reveal something about the
   athlete's body. Everything else a provider sends -- distance, moving time,
   pace, cadence, elevation, activity type -- is ordinary training data and is
   never touched by any of this. */
const COVERED_ACTIVITY_FIELDS = ['hr', 'maxHR'];

/* Reads the athlete's latest recorded decision. The table is append-only, one
   row per decision, so "current" is the newest row and the history behind it
   is the audit. `sb` is the caller's own service-role fetch helper -- this
   module deliberately holds no credentials and opens no connection of its own.

   Returns a plain boolean. Callers must not distinguish "declined" from
   "unreachable": both mean the same thing here, and treating them differently
   is how a database outage turns into unlawful processing. */
async function isGranted(cfg, sb, userId) {
  if (!cfg || typeof sb !== 'function' || !userId) return false;
  try {
    const r = await sb(cfg,
      '/health_data_consent?user_id=eq.' + encodeURIComponent(userId) +
      '&select=decision,consent_version,decided_at&order=decided_at.desc&limit=1');
    if (!r || !r.ok){
      /* Includes the 404 a missing table gives, which is what a deployment
         that has not yet run supabase-health-consent.sql looks like. Named
         separately from a refusal, because one is a decision and the other is
         an outage and they need different responses. */
      log('READ_FAILED status=' + (r ? r.status : 'none'));
      return false;
    }
    // sb() hands back the raw fetch Response, as every other caller in
    // api/_strava.js expects; the rows are one await further down.
    const rows = await r.json();
    const row = (rows || [])[0];
    if (!row){ log('NO_DECISION'); return false; }
    if (row.decision !== 'granted'){ log('NOT_GRANTED decision=' + row.decision); return false; }
    if (row.consent_version !== HEALTH_CONSENT_VERSION){
      /* A consent recorded against a retired version. The athlete agreed to
         something else, so this counts for nothing -- and an operator seeing
         this repeatedly is seeing a cohort that needs asking again. */
      log('STALE_VERSION');
      return false;
    }
    return true;
  } catch (e) {
    log('READ_THREW');
    return false;
  }
}

/* Returns a copy of the activity with the covered fields removed. A copy
   rather than a mutation because the caller may be holding the same object in
   a list it is also counting, and a silent in-place edit of somebody else's
   array is the kind of thing that is correct until it is not. */
function stripCovered(activity) {
  if (!activity || typeof activity !== 'object') return activity;
  const out = Object.assign({}, activity);
  COVERED_ACTIVITY_FIELDS.forEach(k => { delete out[k]; });
  return out;
}

/* The one call every provider ingest path makes. Written as a single function
   rather than as "check, then maybe strip" so that a future provider cannot
   satisfy half of it: there is no way to use this and still stage a heart rate
   for an athlete who has not agreed to it. */
async function forIngest(cfg, sb, userId, activity) {
  return (await isGranted(cfg, sb, userId)) ? activity : stripCovered(activity);
}

/* Does this payload still carry anything covered? Exported for the provider
   seams to assert against their own output, and used by the Garmin contract
   below, which refuses rather than trusting a future implementer to remember. */
function carriesCovered(activity) {
  if (!activity || typeof activity !== 'object') return false;
  return COVERED_ACTIVITY_FIELDS.some(k => activity[k] != null);
}

module.exports = {
  HEALTH_CONSENT_VERSION, COVERED_ACTIVITY_FIELDS,
  isGranted, stripCovered, forIngest, carriesCovered
};
