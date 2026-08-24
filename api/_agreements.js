// Velvet Viking -- what the athlete agreed to, and whether it still counts.
//
// TWO AGREEMENTS, NEITHER OF THEM ARTICLE 9.
//
//   terms            which version of the Terms was in front of them.
//   immediate_start  the acknowledgement that they are asking us to begin a
//                    digital service during the statutory cancellation period
//                    for a distance contract, and that beginning it affects
//                    that right.
//
// Article 9 health consent lives in api/_health-consent.js and stays there.
// Accepting contractual terms and consenting to the processing of information
// about your body are different legal acts with different lawful bases and
// different withdrawal rules, and the one thing that must never happen is a
// single tick standing for both.
//
// PRIVACY IS NOT AN AGREEMENT. There is no privacy decision here. A privacy
// notice is information; asking somebody to consent to being informed is
// meaningless, and implying consent is the lawful basis for the whole product
// is worse than meaningless. Which privacy version was PRESENTED alongside an
// accepted Terms is recorded as context on that row.
//
// VERSIONS ARE THE WHOLE DESIGN. Agreement is recorded against a named version
// of the wording. Change the wording, change the constant, and every stored
// agreement to the old wording stops counting -- the athlete is asked again,
// with no migration and no backfill, because the comparison fails closed on its
// own. That is what makes a revision cheap rather than dangerous: new wording is
// a constant change here and a fresh decision from each athlete, not a data
// problem. The immediate-start wording below has been reviewed and approved as
// it stands, so nobody is being asked again today -- the mechanism is what
// guarantees that stays true if it ever changes.
//
// EVERY UNKNOWN IS A NO. Unreachable database, missing table, malformed row,
// wrong version, declined, absent -- all the same answer. A caller that could
// tell an outage from a refusal is a caller that would eventually take a
// payment it could not evidence.

'use strict';

function log(what){ try{ console.log('agreements: ' + what); }catch(e){} }

const TYPES = ['terms', 'immediate_start'];
const SURFACES = ['checkout', 'account', 'signup', 'app'];

/* THE TERMS VERSION CURRENTLY IN FORCE.
 *
 * Bump this whenever the published Terms change materially. Every athlete is
 * then asked again, and the previous acceptances stay in the table as the
 * record of what was agreed before. */
const TERMS_VERSION = 'terms_v1';

/* THE PRIVACY NOTICE CURRENTLY PUBLISHED. Recorded as context, never agreed
   to. Bumping it does not invalidate anything and does not ask anybody
   anything -- it changes what future rows say was presented. */
const PRIVACY_VERSION = 'privacy_v1';

/* THE IMMEDIATE-START ACKNOWLEDGEMENT CURRENTLY IN FORCE.
 *
 * *** SOLICITOR-REVIEWED AND APPROVED. ***
 *
 * The wording below was reviewed and approved unchanged -- it is byte-identical
 * to the text put in front of review, which is why the version is still v1
 * rather than v2: nothing about what an athlete agrees to has moved, so nobody
 * needs asking again.
 *
 * IT STAYS VERSIONED ANYWAY, and that is the point of the design rather than a
 * leftover from the draft. If this text ever changes materially, the constant
 * becomes 'immediate_start_v2', every athlete is asked again at their next
 * checkout, and the v1 evidence remains exactly as it was -- no migration, no
 * backfill, and no possibility of a stored "yes" being re-pointed at wording
 * the athlete never saw. Approval is a fact about THIS string; the mechanism
 * exists so the next string cannot inherit it.
 *
 * The text lives HERE and not in a screen, so that the wording an athlete saw
 * and the version recorded against their decision cannot come apart: a surface
 * renders what this module gives it. */
const IMMEDIATE_START_VERSION = 'immediate_start_v1';
const IMMEDIATE_START_TEXT =
  'Your 14 days start now and you get the full product straight away. That ' +
  'means you are asking us to begin the service during the 14-day period in ' +
  'which you would otherwise have the right to cancel a distance contract, ' +
  'and you accept that starting immediately affects that right. You can still ' +
  'cancel at any time before the trial ends and you will not be charged.';

function versionFor(type){
  if (type === 'terms') return TERMS_VERSION;
  if (type === 'immediate_start') return IMMEDIATE_START_VERSION;
  return null;
}

/* Everything a checkout surface needs to render the two agreements and record
   the right versions against them. One call, so a screen cannot show one
   version's wording and submit another's. */
function currentAgreements(){
  return {
    terms: { type: 'terms', version: TERMS_VERSION },
    privacy: { version: PRIVACY_VERSION, note: 'notice, not consent' },
    immediateStart: {
      type: 'immediate_start',
      version: IMMEDIATE_START_VERSION,
      text: IMMEDIATE_START_TEXT,
      /* Said out loud in the payload so no surface can decide otherwise: this
         is an affirmative act, and it starts unticked. */
      mustBeAffirmative: true,
      preTicked: false
    }
  };
}

/* THE ATHLETE'S CURRENT STANDING ON ONE AGREEMENT.
 *
 * Reads the newest row of that type. `sb` is the caller's own service-role
 * fetch helper -- this module holds no credentials and opens no connection of
 * its own, exactly like _health-consent.js.
 *
 * Returns a plain boolean, and every way of not knowing returns false. */
async function hasAccepted(cfg, sb, userId, type){
  if (!cfg || typeof sb !== 'function' || !userId) return false;
  if (TYPES.indexOf(type) === -1) return false;
  const want = versionFor(type);
  try{
    const r = await sb(cfg,
      '/account_agreements?user_id=eq.' + encodeURIComponent(userId) +
      '&agreement_type=eq.' + encodeURIComponent(type) +
      '&select=decision,agreement_version,decided_at&order=decided_at.desc&limit=1');
    if (!r || !r.ok){
      /* Includes the 404 a deployment that has not run
         supabase-account-agreements.sql gives. An outage and a refusal are the
         same answer here on purpose. */
      log('READ_FAILED type=' + type + ' status=' + (r ? r.status : 'none'));
      return false;
    }
    const rows = await r.json();
    const row = (rows || [])[0];
    if (!row){ log('NO_DECISION type=' + type); return false; }
    if (row.decision !== 'accepted'){ log('NOT_ACCEPTED type=' + type); return false; }
    if (row.agreement_version !== want){
      /* Agreed to wording that is no longer in force. It counts for nothing,
         and the athlete is asked again. */
      log('STALE_VERSION type=' + type);
      return false;
    }
    return true;
  }catch(e){
    log('READ_THREW type=' + type);
    return false;
  }
}

/* Record a decision. Append-only: this is always an INSERT, never an update,
   and there is deliberately no function here that changes an existing row.

   decided_at comes from the caller so the audit records when the athlete
   decided rather than when the row reached the database -- the same rule
   health consent follows. */
async function record(cfg, sb, userId, input){
  const i = input || {};
  if (!cfg || typeof sb !== 'function' || !userId) return { ok: false, reason: 'no_context' };
  if (TYPES.indexOf(i.type) === -1) return { ok: false, reason: 'unknown_type' };
  if (SURFACES.indexOf(i.surface) === -1) return { ok: false, reason: 'unknown_surface' };
  if (i.decision !== 'accepted' && i.decision !== 'declined')
    return { ok: false, reason: 'unknown_decision' };

  /* THE VERSION IS OURS, NOT THE CLIENT'S. A browser that could name the
     version it was agreeing to could claim agreement to wording nobody showed
     it -- or keep claiming v1 long after v2 replaced it. The row records the
     version this server currently serves, full stop. */
  const body = {
    user_id: userId,
    agreement_type: i.type,
    agreement_version: versionFor(i.type),
    decision: i.decision,
    surface: i.surface,
    privacy_version: i.type === 'terms' ? PRIVACY_VERSION : null,
    offer_code: i.offerCode || null,
    decided_at: i.decidedAt || new Date().toISOString()
  };

  try{
    const r = await sb(cfg, '/account_agreements', {
      method: 'POST', prefer: 'return=minimal', body: JSON.stringify(body)
    });
    if (!r || !r.ok){
      log('WRITE_FAILED type=' + i.type + ' status=' + (r ? r.status : 'none'));
      return { ok: false, reason: 'write_failed' };
    }
    log('RECORDED type=' + i.type + ' decision=' + i.decision + ' surface=' + i.surface);
    return { ok: true, version: body.agreement_version, decidedAt: body.decided_at };
  }catch(e){
    log('WRITE_THREW type=' + i.type);
    return { ok: false, reason: 'write_threw' };
  }
}

/* MAY A PURCHASE PROCEED ON THE LEGAL EVIDENCE ALONE?
 *
 * Both agreements, in one answer, so a caller cannot satisfy half of it. The
 * reason names which one is missing, because "you have not accepted the Terms"
 * and "you have not acknowledged the immediate start" send an athlete to two
 * different places. */
async function purchaseEvidence(cfg, sb, userId){
  const terms = await hasAccepted(cfg, sb, userId, 'terms');
  const immediateStart = await hasAccepted(cfg, sb, userId, 'immediate_start');
  return {
    ok: terms && immediateStart,
    terms: terms,
    immediateStart: immediateStart,
    reason: terms ? (immediateStart ? 'ok' : 'immediate_start_not_acknowledged')
                  : 'terms_not_accepted'
  };
}

module.exports = {
  TYPES, SURFACES,
  TERMS_VERSION, PRIVACY_VERSION, IMMEDIATE_START_VERSION, IMMEDIATE_START_TEXT,
  versionFor, currentAgreements, hasAccepted, record, purchaseEvidence
};
