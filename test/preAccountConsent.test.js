'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const HC = require('../api/_health-consent.js');

/* THE ARTICLE 9 DECISION AND THE ACCOUNT THAT DOES NOT EXIST YET.
 *
 * The approved journey puts the builder in front of authentication: website →
 * /start → nine stages → preview → Save My Plan → account. Stage 07 of that
 * builder asks for LTHR and Max HR, which are covered health data, and
 * public.health_data_consent is keyed to auth.users. So the obvious reading is
 * that an athlete makes a health-data decision before there is any account to
 * attach it to, and something must later carry that decision -- with its
 * ORIGINAL timestamp -- onto the right row.
 *
 * THAT IS NOT WHAT THE IMPLEMENTATION DOES, and the difference matters enough
 * to be locked down rather than left as a property somebody notices.
 *
 * /start renders the two heart-rate fields so the nine questions are the same
 * nine questions in the same order as the app's own builder -- and never reads
 * them. Not "reads and discards": the values are never retrieved from the DOM
 * at all. Nothing covered is submitted, nothing covered is banked, and there is
 * therefore no pre-account Article 9 decision to sequence, sync, or lose the
 * timestamp of. The hazard is avoided rather than managed.
 *
 * Every assertion here guards a property that is currently true by
 * construction. None of it is guarded anywhere else: the 106 existing consent
 * tests cover the authenticated side and say nothing about the journey in front
 * of it.
 */

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const START = read('start.html');
const APP = read('protected/velvet-viking-valhalla.html');

// ===========================================================================
// NOTHING COVERED LEAVES THE DEVICE BEFORE THERE IS AN ACCOUNT
// ===========================================================================
test('/start renders the heart-rate fields and never reads them back', () => {
  /* The strongest form of "no covered data pre-account" available: not a
     promise to discard it, but the absence of any code that retrieves it. If
     somebody later adds a .value read here, this fails -- which is the moment
     the Article 9 sequencing question genuinely starts to exist. */
  assert.match(START, /id="bld-lthr"/, 'stage 07 should still ask the question');
  assert.match(START, /id="bld-maxhr"/);

  const reads = START.match(/bld-lthr|bld-maxhr/g) || [];
  assert.equal(reads.length, 2,
    'the heart-rate inputs are referenced ' + reads.length + ' times; two is render-only, ' +
    'more means something now reads them and a pre-account health decision has appeared');

  ['$(\'bld-lthr\')', '$("bld-lthr")', 'bld-lthr\').value', 'getElementById(\'bld-lthr\')']
    .forEach(shape => assert.ok(START.indexOf(shape) === -1,
      'start.html retrieves the LTHR field: ' + shape));
});

test('the builder submission carries no covered field', () => {
  const submit = START.slice(START.indexOf('function submitBuild'));
  const body = submit.slice(0, submit.indexOf('\n  }'));
  ['lthr', 'maxhr', 'maxHR', 'restingHR', 'readiness', 'sleep', 'soreness', 'illness', 'feel']
    .forEach(k => assert.ok(!new RegExp('\\b' + k + '\\b').test(body),
      'submitBuild() sends a covered field: ' + k));
});

test('the banked pending build carries no covered field', () => {
  /* vvv_pending_build survives the magic-link round trip in localStorage. It
     holds the nine builder answers and the preview -- and must never become a
     place an unconsented heart rate waits for an account to arrive. */
  assert.match(START, /var PENDING_KEY = 'vvv_pending_build'/);
  const saves = START.match(/savePending\([\s\S]{0,400}?\)/g) || [];
  assert.ok(saves.length > 0, 'nothing banks a pending build any more');
  saves.forEach(s => ['lthr', 'maxhr', 'maxHR', 'readiness', 'hr']
    .forEach(k => assert.ok(!new RegExp('\\b' + k + '\\b', 'i').test(s),
      'a covered field is banked into the pending build: ' + k)));
});

test('adopting a pre-account build always leaves the heart-rate fields empty', () => {
  /* The app-side half. Even if a future /start did bank something, adoption
     writes null -- so a plan built before authentication cannot arrive carrying
     covered data the athlete never consented to. */
  const adopt = APP.slice(APP.indexOf('function adoptPendingBuildIfAny'));
  const body = adopt.slice(0, adopt.indexOf('\n}'));
  assert.match(body, /lthr:\s*null,\s*maxHR:\s*null/,
    'adoption must null the covered fields rather than carry them across');
});

// ===========================================================================
// THE DEVICE IS SHARED; THE DECISION IS NOT
// ===========================================================================
test('a pending build cannot be inherited by a different account', () => {
  /* A build banked before one athlete claimed their magic link must not be
     silently adopted by a different real person who signs in on the same
     device afterwards -- a phone handed over, a shared family laptop. The
     record is tagged with whichever account first authenticated while it
     existed, and adoption refuses a mismatch. */
  assert.match(START, /function subFromToken/,
    'the tag has to come from the token, not from anything the page chose');
  const adopt = APP.slice(APP.indexOf('function adoptPendingBuildIfAny'));
  assert.match(adopt.slice(0, 2000),
    /if \(pending\.uid && sub && pending\.uid !== sub\) return false;/,
    'adoption must refuse a build tagged for somebody else');
});

test('an abandoned pending build expires rather than waiting forever', () => {
  assert.match(START, /PENDING_MAX_AGE_MS = 48 \* 60 \* 60 \* 1000/);
  const load = START.slice(START.indexOf('function loadPending'));
  assert.match(load.slice(0, 400), /Date\.now\(\) - p\.savedAt\) > PENDING_MAX_AGE_MS/);
  assert.match(load.slice(0, 400), /clearPending\(\)/,
    'an expired record must be removed, not merely ignored');
});

// ===========================================================================
// WHEN THE DECISION IS RECORDED, IT RECORDS WHEN IT WAS MADE
// ===========================================================================
test('the audit row carries the athlete’s own decision time, not the sync time', () => {
  /* The whole reason decided_at is client-written and created_at is defaulted
     server-side: the decision is made and takes effect on the device, offline
     included, and the audit must say when the athlete decided rather than when
     the row happened to reach Supabase. Writing now() here would make every
     historical record subtly false. */
  const fn = APP.slice(APP.indexOf('function recordHealthConsentAudit'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /decided_at:\s*rec\.decidedAt/,
    'decided_at must be the decision time the device recorded');
  assert.ok(!/decided_at:\s*(new Date\(\)|Date\.now\(\)|now\(\))/.test(body),
    'decided_at must never be stamped at sync time');
  assert.ok(!/created_at:/.test(body),
    'created_at is the server’s own view of arrival and must not be client-supplied');
});

test('the audit row names the authenticated athlete and nobody else', () => {
  const fn = APP.slice(APP.indexOf('function recordHealthConsentAudit'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /!cloudSignedIn\(\) \|\| !cloudSession\.user_id/,
    'no audit row may be attempted without an authenticated session');
  assert.match(body, /user_id:\s*cloudSession\.user_id/,
    'the row must name the session’s own athlete, never an id from a payload');
});

test('a failed audit write never blocks the athlete’s decision', () => {
  /* Best effort by design. The decision is already law on the device the moment
     it is stored locally, and a network failure must never leave somebody
     unable to withdraw consent. */
  const fn = APP.slice(APP.indexOf('function recordHealthConsentAudit'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /return false;? \}\);?$|function\(\)\{ return false; \}/m,
    'a rejected write must resolve false rather than throw');
  assert.match(body, /Promise\.resolve\(false\)/);
});

// ===========================================================================
// ONE VERSION, TWO PLACES, ASSERTED IDENTICAL
// ===========================================================================
test('the app and the server agree on the consent version, exactly', () => {
  /* Two constants for one fact is two things to change. The server refuses a
     decision recorded against any other version, so a drift here would silently
     invalidate every athlete's consent -- fail-closed, but for a reason nobody
     would find quickly. */
  const inApp = /var HEALTH_CONSENT_VERSION = '([^']+)'/.exec(APP);
  assert.ok(inApp, 'the runtime no longer declares a consent version');
  assert.equal(inApp[1], HC.HEALTH_CONSENT_VERSION);
  assert.equal(HC.HEALTH_CONSENT_VERSION, 'health_data_consent_v1',
    'this run does not change the version; it verifies it');
});

test('a decision recorded against another version counts for nothing', async () => {
  /* Fail-closed on version, proven behaviourally against the real gate rather
     than by reading the branch. This is what makes a future v2 force a fresh
     decision with no migration and no backfill. */
  const sb = rows => async () => ({ ok: true, status: 200, json: async () => rows });
  const cfg = {}, uid = 'u1';

  assert.equal(await HC.isGranted(cfg, sb([{ decision: 'granted',
    consent_version: HC.HEALTH_CONSENT_VERSION, decided_at: '2026-01-01' }]), uid), true);

  assert.equal(await HC.isGranted(cfg, sb([{ decision: 'granted',
    consent_version: 'health_data_consent_v2', decided_at: '2026-01-01' }]), uid), false,
    'a newer version must not be honoured by an older gate');

  assert.equal(await HC.isGranted(cfg, sb([{ decision: 'granted',
    consent_version: 'health_data_consent_v0', decided_at: '2026-01-01' }]), uid), false);
});

test('every way of not knowing means no', async () => {
  /* "Declined" and "we could not tell" must be indistinguishable to a caller.
     Treating them differently is how a database outage becomes unlawful
     processing -- including the 404 a deployment that has not run migration 11
     would give. */
  const cfg = {}, uid = 'u1';
  const cases = {
    'no rows':            async () => ({ ok: true, status: 200, json: async () => [] }),
    'declined':           async () => ({ ok: true, status: 200, json: async () => [{ decision: 'declined', consent_version: HC.HEALTH_CONSENT_VERSION }] }),
    'withdrawn':          async () => ({ ok: true, status: 200, json: async () => [{ decision: 'withdrawn', consent_version: HC.HEALTH_CONSENT_VERSION }] }),
    'table missing (404)':async () => ({ ok: false, status: 404 }),
    'outage (503)':       async () => ({ ok: false, status: 503 }),
    'threw':              async () => { throw new Error('network'); },
    'malformed body':     async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } })
  };
  for (const [name, sb] of Object.entries(cases)){
    assert.equal(await HC.isGranted(cfg, sb, uid), false, name + ' must not grant');
  }
  assert.equal(await HC.isGranted(cfg, null, uid), false, 'no fetcher must not grant');
  assert.equal(await HC.isGranted(cfg, cases['no rows'], null), false, 'no athlete must not grant');
});

// ===========================================================================
// WHAT DECLINING COSTS, AND WHAT IT MUST NOT
// ===========================================================================
test('declining strips the covered fields and leaves training data whole', async () => {
  const activity = {
    /* covered */
    hr: 152, maxHR: 178,
    /* ordinary training data, which must survive untouched */
    distance: 10000, movingTime: 2700, elapsedTime: 2800, type: 'Run',
    startDate: '2026-08-01T06:00:00Z', splits: [1, 2, 3], cadence: 178,
    elevationGain: 120, name: 'Morning Run', id: 'act_1'
  };
  const sb = async () => ({ ok: true, status: 200, json: async () => [] });

  const out = await HC.forIngest({}, sb, 'u1', activity);
  assert.equal(out.hr, undefined, 'covered');
  assert.equal(out.maxHR, undefined, 'covered');
  assert.equal(HC.carriesCovered(out), false);

  ['distance', 'movingTime', 'elapsedTime', 'type', 'startDate', 'cadence',
   'elevationGain', 'name', 'id'].forEach(k =>
    assert.deepEqual(out[k], activity[k], k + ' is ordinary training data and must survive'));
  assert.deepEqual(out.splits, activity.splits);

  /* And the caller's own object is untouched -- a silent in-place edit of a
     list somebody else is counting is correct until it is not. */
  assert.equal(activity.hr, 152, 'stripCovered must copy, not mutate');
});

test('granting passes the activity through unchanged', async () => {
  const activity = { hr: 152, maxHR: 178, distance: 10000 };
  const sb = async () => ({ ok: true, status: 200,
    json: async () => [{ decision: 'granted', consent_version: HC.HEALTH_CONSENT_VERSION,
                         decided_at: '2026-01-01' }] });
  const out = await HC.forIngest({}, sb, 'u1', activity);
  assert.equal(out.hr, 152);
  assert.equal(out.maxHR, 178);
  assert.equal(HC.carriesCovered(out), true);
});
