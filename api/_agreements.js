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

/* =====================================================================
   THE CANONICAL DOCUMENTS
   =====================================================================

   ONE COPY, ON THE WEBSITE. The website publishes the Terms, the Privacy
   notice and the beta Terms; this app links to them and keeps no commercial
   legal text of its own. Two copies of a contract is two contracts, and the
   athlete would have no way of knowing which one governs them.

   Absolute https URLs on purpose: the native shell has no allowNavigation
   entry for velvetviking.co.uk, so an off-origin host opens in the system
   browser rather than trapping somebody inside the WebView on a legal page
   with no way back. */
const CANONICAL_TERMS_URL   = 'https://velvetviking.co.uk/terms';
const CANONICAL_PRIVACY_URL = 'https://velvetviking.co.uk/privacy';
const BETA_TERMS_URL        = 'https://velvetviking.co.uk/beta-terms';

/* HAVE THE COMMERCIAL DOCUMENTS ACTUALLY BEEN PUBLISHED?
 *
 * *** TRUE, as of website commit e2b7e6a (24 August 2026). ***
 *
 * VERIFIED, NOT ASSERTED. Checked against the website repository rather than
 * taken from a report, because the previous two passes each turned out to be
 * describing a state that had not landed:
 *
 *   LEGAL_APPROVALS.terms .................... true
 *   LEGAL_APPROVALS.privacyCommercial ........ true
 *   CANONICAL_LEGAL.terms.version ............ commercial_terms_v1
 *   CANONICAL_LEGAL.privacy.version .......... commercial_privacy_v1
 *   effective date ........................... 24 August 2026
 *   /terms renders <LegalDocument doc={termsDraft}/>, not the placeholder
 *   both documents free of TBC / placeholder / private-beta wording
 *   trial.live ............................... false
 *
 * The cookie policy is NOT part of this gate and remains unpublished.
 *
 * This is a statement about PUBLICATION, not about approval, and it is not
 * this repository's to approve. The website owns the documents and owns
 * LEGAL_APPROVALS; this constant records only whether the app may present
 * them as the documents in force.
 *
 * WHY IT IS A CONSTANT AND NOT AN ENVIRONMENT VARIABLE. Whether a customer is
 * shown a real contract before paying is not a dashboard setting. It requires
 * a diff, a review and a deploy, exactly as the website's own approval flags
 * do -- and for the same reason `payment_method_collection: 'always'` is
 * written out in _stripe.js rather than left to a Stripe default.
 *
 * BEFORE FLIPPING IT, verify on the website's main branch that BOTH
 * LEGAL_APPROVALS.terms and LEGAL_APPROVALS.privacyCommercial are true and
 * that the two URLs above render the commercial documents. Implementation
 * being finished is not publication.
 *
 * WHILE IT IS FALSE, the app refuses to record any Terms acceptance and
 * checkout refuses with commercial_terms_not_published. That is deliberate:
 * the only alternative is asking a paying customer to accept the private-beta
 * Terms, which describe no subscription, no trial, no cancellation and no
 * refund -- evidence that would say the athlete agreed to something they did
 * not. Refusing the sale is the cheaper mistake by a wide margin.
 *
 * AND THAT REFUSING STATE IS STILL TESTED. It is reachable again the moment a
 * document is withdrawn or superseded, so inForce(false) keeps its own
 * assertions rather than becoming dead code the day the gate opened. */
const COMMERCIAL_LEGAL_PUBLISHED = true;

/* THE COMMERCIAL TERMS VERSION.
 *
 * THE WEBSITE NAMES IT, NOT THIS REPOSITORY. The document and its identifier
 * are published together, so the app adopts the published name rather than
 * minting its own. An earlier pass here used a provisional `terms_commercial_v1`
 * while the document was unpublished; that name is gone, because two
 * vocabularies for one contract is exactly the ambiguity the identifier exists
 * to prevent.
 *
 * DELIBERATELY NOT terms_v1. That identifier belongs to the app's
 * private-beta Terms, and reusing it for a subscription contract would make
 * every future row ambiguous about which document it attests -- and would let
 * a beta-era acceptance stand as evidence for a paid purchase. A new document
 * gets a new identifier, always.
 *
 * Bump it whenever the published Terms change materially. Every athlete is
 * then asked again, and the previous acceptances stay in the table as the
 * record of what was agreed before. */
const TERMS_COMMERCIAL_VERSION = 'commercial_terms_v1';
const TERMS_BETA_VERSION       = 'terms_v1';

/* THE PRIVACY NOTICE CURRENTLY PUBLISHED. Recorded as context, never agreed
   to. Bumping it does not invalidate anything and does not ask anybody
   anything -- it changes what future rows say was presented. The commercial
   policy is a different document from the beta notice, so it has a different
   identifier for the same reason the Terms do. */
const PRIVACY_COMMERCIAL_VERSION = 'commercial_privacy_v1';
/* THE WEBSITE'S NAME FOR THE SUPERSEDED NOTICE, adopted rather than invented.
   CANONICAL_LEGAL calls it beta_privacy_v1, and an app calling the same
   document privacy_v1 would be the second vocabulary the canonical-identifier
   rule exists to prevent: two systems disagreeing about what one stored row
   means. Safe to align because no row has ever carried the old name --
   account_agreements held zero rows when this was checked, and every row
   written from today names commercial_privacy_v1. */
const PRIVACY_BETA_VERSION       = 'beta_privacy_v1';

/* WHAT IS IN FORCE, GIVEN A PUBLICATION STATE.
 *
 * A PURE FUNCTION OF ONE BOOLEAN, and deliberately so. The rule that matters
 * here is not "what is true today" -- today is one call away and will change
 * -- but "what happens in each state", including every future state where the
 * documents are withdrawn, replaced or superseded. Written this way, both
 * answers are provable without editing the constant, so the fail-closed half
 * cannot quietly stop being tested the moment v1 goes live.
 *
 * NULL TERMS MEANS NO COMMERCIAL TERMS DOCUMENT. Every path that needs one
 * fails closed rather than falling back to the beta document.
 *
 * Note what does NOT fall back: the Terms version. The privacy version and the
 * Terms URL both name the beta document when nothing commercial is published,
 * because a notice and a link should point at whatever is actually in force --
 * but an ACCEPTANCE must never be recordable against a document that describes
 * something the athlete is not buying. */
function inForce(published){
  return {
    terms:   published ? TERMS_COMMERCIAL_VERSION : null,
    privacy: published ? PRIVACY_COMMERCIAL_VERSION : PRIVACY_BETA_VERSION,
    termsUrl: published ? CANONICAL_TERMS_URL : BETA_TERMS_URL
  };
}

const NOW = inForce(COMMERCIAL_LEGAL_PUBLISHED);
const TERMS_VERSION   = NOW.terms;
const PRIVACY_VERSION = NOW.privacy;
const TERMS_URL       = NOW.termsUrl;

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

function versionFor(type, published){
  /* Null when there is no commercial Terms document published. Every caller
     treats null as "cannot be agreed to", never as "use the old one".

     The optional second argument answers for a publication state other than
     the real one, exactly as inForce() and currentAgreements() do. No
     production caller passes it; it exists so the withdrawn state stays
     provable now that the live one is published. */
  if (type === 'terms'){
    return published === undefined ? TERMS_VERSION : inForce(!!published).terms;
  }
  if (type === 'immediate_start') return IMMEDIATE_START_VERSION;
  return null;
}

/* Everything a checkout surface needs to render the two agreements, link to
   the documents behind them, and record the right versions against them. One
   call, so a screen cannot show one version's wording, link to a second
   document and submit a third.

   THE URL AND THE VERSION COME OUT TOGETHER, and that is the point. The whole
   defect this exists to close was a surface linking to one document while the
   evidence named another. */
function currentAgreements(published){
  /* A PURE PROJECTION OF THE PUBLICATION STATE, defaulting to the real one.
     The argument exists for the same reason inForce() takes one: the payload a
     surface renders in each state should be provable in each state, including
     after the gate opens and the closed half stops happening by itself. No
     production caller passes it. */
  const on = published === undefined ? COMMERCIAL_LEGAL_PUBLISHED : !!published;
  const v = inForce(on);
  return {
    /* Publication state, said out loud, so a surface renders the truth
       rather than deciding for itself what silence means. */
    commercialLegalPublished: on,
    terms: {
      type: 'terms',
      version: v.terms,
      url: v.termsUrl,
      /* False means: there is nothing here an athlete may accept. */
      agreeable: v.terms != null
    },
    privacy: {
      version: v.privacy,
      url: CANONICAL_PRIVACY_URL,
      note: 'notice, not consent',
      /* Restated in the payload because it is the mistake this design exists
         to prevent: no surface may render a privacy tickbox. */
      isConsent: false
    },
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
  /* NOTHING IN FORCE MEANS NOTHING ACCEPTED. Short-circuited rather than left
     to the version comparison below -- that would also return false, but it
     would read as "their row is stale" when the truth is that no document
     exists to be stale against. */
  if (want == null){ log('NO_DOCUMENT_IN_FORCE type=' + type); return false; }
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

  /* NO DOCUMENT, NO ROW. Refused here rather than allowed to reach the
     database, where a null agreement_version would be rejected by the NOT NULL
     constraint and surface as a generic write failure. The distinction the
     caller needs is "there is nothing published to agree to", not "the write
     went wrong".

     THIS IS THE STRUCTURAL GUARANTEE. While the commercial Terms are
     unpublished it is not possible -- from any surface, by any request -- to
     store a row saying an athlete accepted the Terms, because the only Terms
     the app could name would be the private-beta ones. */
  const version = versionFor(i.type);
  if (version == null){
    log('NO_DOCUMENT_IN_FORCE type=' + i.type + ' (refusing to record)');
    return { ok: false, reason: i.type === 'terms' ? 'commercial_terms_not_published'
                                                   : 'no_document_in_force' };
  }

  /* THE VERSION IS OURS, NOT THE CLIENT'S. A browser that could name the
     version it was agreeing to could claim agreement to wording nobody showed
     it -- or keep claiming v1 long after v2 replaced it. The row records the
     version this server currently serves, full stop. */
  const body = {
    user_id: userId,
    agreement_type: i.type,
    agreement_version: version,
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
async function purchaseEvidence(cfg, sb, userId, published){
  const on = published === undefined ? COMMERCIAL_LEGAL_PUBLISHED : !!published;
  /* THE PUBLICATION CHECK COMES FIRST, and it does not touch the database.
     "You have not accepted the Terms" and "there are no commercial Terms to
     accept yet" are different facts with different owners -- the first is the
     athlete's to fix, the second is the website's -- and collapsing them would
     send somebody to tick a box that cannot exist. */
  if (!on){
    log('COMMERCIAL_LEGAL_NOT_PUBLISHED (refusing purchase evidence)');
    return {
      ok: false,
      published: false,
      terms: false,
      /* Read anyway: the acknowledgement is approved, its architecture is
         unaffected by the Terms not being published, and an athlete who has
         already given it keeps that evidence. Reporting it honestly is what
         makes this a publication blocker rather than a reset. */
      immediateStart: await hasAccepted(cfg, sb, userId, 'immediate_start'),
      reason: 'commercial_terms_not_published'
    };
  }

  const terms = await hasAccepted(cfg, sb, userId, 'terms');
  const immediateStart = await hasAccepted(cfg, sb, userId, 'immediate_start');
  return {
    ok: terms && immediateStart,
    published: true,
    terms: terms,
    immediateStart: immediateStart,
    reason: terms ? (immediateStart ? 'ok' : 'immediate_start_not_acknowledged')
                  : 'terms_not_accepted'
  };
}

module.exports = {
  TYPES, SURFACES,
  COMMERCIAL_LEGAL_PUBLISHED,
  TERMS_VERSION, TERMS_COMMERCIAL_VERSION, TERMS_BETA_VERSION,
  PRIVACY_VERSION, PRIVACY_COMMERCIAL_VERSION, PRIVACY_BETA_VERSION,
  CANONICAL_TERMS_URL, CANONICAL_PRIVACY_URL, BETA_TERMS_URL, TERMS_URL,
  IMMEDIATE_START_VERSION, IMMEDIATE_START_TEXT,
  inForce,
  versionFor, currentAgreements, hasAccepted, record, purchaseEvidence
};
