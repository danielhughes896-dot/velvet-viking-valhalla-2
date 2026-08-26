'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const S = require('../api/_strava.js');

/* ACCOUNT ELIGIBILITY IS NOT DATA ELIGIBILITY
 * ===========================================================================
 * An earlier pass conflated the two and refused Ask Coach to any account
 * permitted to use Strava. That is not the product: an athlete may have
 * Strava, LISTEN and Ask Coach at once. What Strava restricts is which
 * EVIDENCE may reach a model.
 *
 * So this file holds two claims that have to be true together:
 *
 *   1. COEXISTENCE. Being on the Strava allowlist, having a connection, or
 *      holding Strava history does not remove any Voice capability.
 *   2. DATA EXCLUSION, PER ITEM. No Strava-originated or Strava-derived
 *      evidence reaches the model -- including deterministic conclusions
 *      computed FROM it, which is the part a day-level fence alone misses.
 *
 * And a third that keeps the first two from cancelling out:
 *
 *   3. ONE STRAVA RUN MUST NOT COST AN ATHLETE THEIR COACH. Failing closed
 *      happens per item of evidence, never for the account.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';
const FOUNDER = '11111111-2222-3333-4444-555555555555';
const OTHER   = '99999999-8888-7777-6666-555555555555';

function withEnv(vars, run){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  try { return run(); }
  finally { Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}

function athlete(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 healthConsent: o.healthConsent !== false,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  a.voiceAvailable = () => true;
  return a;
}
function logManual(a, date, over){
  const d = a.findDayByDate(date);
  a.applyCompletion(d, true);
  d.actual = Object.assign(a.emptyActual(), { km: d.km || 8, pace: '5:20', rpe: 6 }, over || {});
  return d;
}
function logStrava(a, date, over){
  const d = logManual(a, date, over);
  d.stravaActivityId = 'STRAVA-' + date;
  return d;
}

// ---------------------------------------------------------------------------
// 1. COEXISTENCE
// ---------------------------------------------------------------------------
test('the Strava allowlist governs Strava, and nothing about Ask Coach', () => {
  /* The correction. VVV_STRAVA_ALLOWED_USER_IDS decides WHO MAY USE STRAVA.
     It must not decide who may use Ask Coach. */
  withEnv({ VVV_STRAVA_ENABLED: '1', VVV_STRAVA_ALLOWED_USER_IDS: FOUNDER }, () => {
    assert.equal(S.stravaAllowedForUser(FOUNDER), true, 'the founder gate must still work');
    assert.equal(S.stravaAllowedForUser(OTHER), false, 'and must still exclude everybody else');
  });
  const voiceFiles = ['api/_voice.js', 'api/_voice-ask.js', 'api/_voice-enabled.js', 'api/voice.js']
    .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(!/stravaAllowedForUser|VVV_STRAVA_ALLOWED_USER_IDS/.test(voiceFiles),
    'a Voice endpoint gates on Strava account eligibility');
});

test('a Strava-connected athlete keeps LISTEN and Ask Coach', () => {
  const a = athlete();
  logStrava(a, '2026-08-20');
  const dd = a.findDayByDate(TODAY);
  const html = a.renderVoiceCard(dd);
  assert.match(html, /data-action="voice-listen"/, 'Strava history removed LISTEN');
  assert.match(html, /data-action="voice-ask-open"/, 'Strava history removed Ask Coach');
  assert.equal(a.voiceAskRefusalReason(), null, 'the athlete was refused outright');
});

test('the availability probe is a deployment question, not an account one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'api', '_voice-enabled.js'), 'utf8');
  assert.ok(!/stravaAllowedForUser/.test(src),
    'availability still depends on Strava account eligibility');
  assert.ok(!/cloudSession\.access_token[\s\S]{0,200}voice-enabled/.test(SRC),
    'the client sends a token to a route that no longer needs one');
});

test('only TODAY being Strava-derived withdraws the offer, and it says so', () => {
  /* The one case where the day itself cannot be discussed. Everything else
     about the athlete stays available -- and the written coaching is intact. */
  const a = athlete();
  const dd = a.findDayByDate(TODAY);
  dd.stravaActivityId = 'X';
  const html = a.renderVoiceCard(dd);
  assert.match(html, /came in from Strava/);
  assert.ok(!/data-action="voice-ask-open"/.test(html));
});

// ---------------------------------------------------------------------------
// 2. DATA EXCLUSION, INCLUDING LAUNDERED CONCLUSIONS
// ---------------------------------------------------------------------------
test('a Strava-derived day, field, HR and split all stay out', () => {
  const a = athlete();
  const d = logStrava(a, '2026-08-20', { hr: 151, cadence: 176,
    splits: [{ km:1, sec:300, paceSec:300, hr:150 }, { km:2, sec:298, paceSec:298, hr:154 }] });
  const j = JSON.stringify(a.voiceCoachContext());
  assert.ok(!/STRAVA-2026-08-20/.test(j), 'the activity id leaked');
  assert.ok(!/2026-08-20/.test(j), 'the Strava day itself leaked');
  assert.ok(!/151/.test(j), 'a Strava heart rate leaked');
  assert.ok(!/"splits"/.test(j), 'Strava splits leaked');
  assert.ok(!/176/.test(j), 'a Strava cadence leaked');
  assert.equal(a.voiceDayEligible(d), false);
});

test('a deterministic conclusion cannot launder Strava provenance', () => {
  /* THE PATH A DAY-LEVEL FENCE MISSES, and the reason this file exists.
     A Strava-imported race becomes a performance; performanceFromDay() does not
     carry the Strava marker; the performance becomes currentFitnessAnchor();
     getActivePaces() derives every zone from it; computeExecutionScore() judges
     every session against those zones. The execution score of a MANUAL run is
     then materially derived from Strava. */
  const a = athlete();
  const race = a.findDayByDate('2026-08-16');
  race.type = 'race'; race.km = 10;
  a.applyCompletion(race, true);
  race.actual = Object.assign(a.emptyActual(), { km: 10, pace: '4:30' });
  race.stravaActivityId = 'LAUNDER';
  a.recordMeasuredPerformance(race);

  const anchor = a.currentFitnessAnchor();
  assert.equal(anchor.source, 'performance', 'precondition: the race must be the anchor');
  assert.equal(a.isStravaDerived(a.findDayByDate(anchor.date)), true);
  assert.equal(a.voiceFitnessAnchorIndependent(), false,
    'a Strava-anchored fitness reading was treated as independent');

  logManual(a, '2026-08-18');
  const ctx = a.voiceCoachContext();
  const j = JSON.stringify(ctx);
  assert.ok(!/"executionScore":/.test(j),
    'a pace-relative score derived from a Strava-anchored fitness reading was sent');
  assert.equal(ctx.withheld.executionScores, true, 'the withholding is not declared');
  assert.ok(!/LAUNDER/.test(j));
});

test('the same athlete WITH an independent anchor keeps their scores', () => {
  /* The other half: withholding must be caused by provenance, not by having
     Strava at all. Identical athlete, race logged by hand. */
  const a = athlete();
  const race = a.findDayByDate('2026-08-16');
  race.type = 'race'; race.km = 10;
  a.applyCompletion(race, true);
  race.actual = Object.assign(a.emptyActual(), { km: 10, pace: '4:30' });
  a.recordMeasuredPerformance(race);
  logStrava(a, '2026-08-19');              // Strava evidence exists, but not as the anchor
  logManual(a, '2026-08-18');

  assert.equal(a.voiceFitnessAnchorIndependent(), true);
  const ctx = a.voiceCoachContext();
  assert.match(JSON.stringify(ctx), /"executionScore":/,
    'scores were withheld for an athlete whose fitness reading is Strava-free');
  assert.equal(ctx.withheld.stravaDerivedDays, 1, 'the Strava day should still be excluded');
});

test('unknown provenance fails closed for that evidence', () => {
  const a = athlete();
  logStrava(a, '2026-08-19');
  const race = a.findDayByDate('2026-08-16');
  race.type = 'race'; race.km = 10;
  a.applyCompletion(race, true);
  race.actual = Object.assign(a.emptyActual(), { km: 10, pace: '4:30' });
  a.recordMeasuredPerformance(race);
  /* The anchor's originating day is gone from the plan, so independence cannot
     be established either way. Unknown is treated as prohibited. */
  a.state.days = a.state.days.filter(d => d.date !== '2026-08-16');
  assert.equal(a.voiceFitnessAnchorIndependent(), false,
    'an anchor that cannot be traced was assumed independent');
});

test('a plan change made after Strava evidence existed is not sent', () => {
  /* Plan evolution reads completed days and does not record which ones moved
     it, so an adjusted session may be Strava-free itself and still be a
     consequence of a Strava run. */
  const a = athlete();
  const adjusted = a.findDayByDate('2026-08-26');
  adjusted.coachAdjust = { at: '2026-08-21T09:00:00.000Z', source: 'evolution', reason: 'x' };
  assert.equal(a.voiceAdjustmentIndependent(adjusted), true, 'no Strava evidence yet');

  logStrava(a, '2026-08-20');
  assert.equal(a.voiceAdjustmentIndependent(adjusted), false);
  const ctx = a.voiceCoachContext();
  assert.ok(!ctx.upcoming.some(u => u.date === '2026-08-26'),
    'a Strava-influenced plan change reached the model');
  assert.equal(ctx.withheld.stravaInfluencedPlanChanges, 1);
});

test('an athlete who never connected Strava has nothing withheld', () => {
  const a = athlete();
  logManual(a, '2026-08-20');
  const ctx = a.voiceCoachContext();
  assert.equal(a.voiceHasStravaEvidence(), false);
  assert.equal(ctx.withheld.stravaDerivedDays, 0);
  assert.equal(ctx.withheld.stravaInfluencedPlanChanges, 0);
  assert.equal(ctx.withheld.executionScores, false);
  const adjusted = a.findDayByDate('2026-08-26');
  adjusted.coachAdjust = { at: 'x', source: 'evolution', reason: 'y' };
  assert.equal(a.voiceAdjustmentIndependent(adjusted), true,
    'an athlete with no Strava lost an adjusted session for no reason');
});

// ---------------------------------------------------------------------------
// 3. MIXED HISTORY
// ---------------------------------------------------------------------------
test('one Strava run does not disable Ask Coach for the account', () => {
  const a = athlete();
  logStrava(a, '2026-08-20');
  ['2026-08-18', '2026-08-19', '2026-08-21'].forEach(d => logManual(a, d));
  const ctx = a.voiceCoachContext();
  assert.ok(ctx.recent.length >= 3, 'eligible manual sessions were lost with the Strava one');
  assert.ok(ctx.recent.some(r => r.date === '2026-08-18' && r.completed));
  assert.ok(!ctx.recent.some(r => r.date === '2026-08-20'), 'the Strava run survived');
  assert.ok(ctx.todaySession, 'the planned session for today was lost');
});

test('athlete-entered evidence beside a Strava day stays eligible', () => {
  /* RPE and pace the athlete typed on a day Strava never touched are their own
     account of their own run. Sitting in the same training record as an import
     does not make them Strava data. */
  const a = athlete({ healthConsent: true });
  logStrava(a, '2026-08-20', { hr: 151 });
  logManual(a, '2026-08-19', { pace: '5:44', rpe: 8, hr: 149, feel: 'good' });
  const j = JSON.stringify(a.voiceCoachContext());
  assert.match(j, /5:44/, 'the athlete\'s own pace was withheld');
  assert.match(j, /"effort":8/, 'the athlete\'s own effort rating was withheld');
  assert.match(j, /149/, 'the athlete\'s own heart rate was withheld under consent');
  assert.ok(!/151/.test(j), 'the Strava heart rate leaked');
});

test('the planned prescription is not Strava data merely because Strava is connected', () => {
  /* "What am I doing today, and why" must still be answerable. */
  const a = athlete();
  logStrava(a, '2026-08-20');
  const ctx = a.voiceCoachContext();
  assert.ok(ctx.todaySession, 'today disappeared');
  assert.equal(ctx.todaySession.date, TODAY);
  assert.ok(ctx.todaySession.title, 'the session has no identity to discuss');
  assert.ok(ctx.upcoming.length, 'the athlete cannot ask about tomorrow');
  assert.ok(ctx.goal, 'the goal they entered themselves was withheld');
});

test('the context declares what is missing so absence is not read as evidence', () => {
  const a = athlete();
  logStrava(a, '2026-08-20');
  const ctx = a.voiceCoachContext();
  assert.ok(ctx.withheld, 'nothing tells the model what it does not have');
  assert.match(ctx.withheld.note, /Do not infer anything from its absence/i);
  assert.match(ctx.withheld.note, /Say you do not have it/i);
});

test('the model is told how to decline a question about withheld evidence', () => {
  const askMod = require('../api/_voice-ask.js');
  assert.match(askMod.SYSTEM, /withheld/i);
  assert.match(askMod.SYSTEM, /Do NOT infer/i);
  assert.match(askMod.SYSTEM, /Never mention policies, providers, syncing or data rules/i);
});

// ---------------------------------------------------------------------------
// POSITIVE ASSEMBLY
// ---------------------------------------------------------------------------
test('the context is a whitelist, so an unknown field cannot ride in', () => {
  const a = athlete();
  const d = logManual(a, '2026-08-19');
  d.providerRawPayload = 'POISON';
  d.actual.providerRaw = 'POISON';
  d.actual.stravaSplits = ['POISON'];
  assert.ok(!/POISON/.test(JSON.stringify(a.voiceCoachContext())),
    'an unknown field was copied -- the builder is filtering, not whitelisting');
});

test('the assembler reads eligibility, never a raw day list', () => {
  const body = SRC.slice(SRC.indexOf('function voiceCoachContext()'),
                         SRC.indexOf('/* WHY THE COACH MIGHT HAVE TO DECLINE'));
  assert.match(body, /isStravaDerived\(d\)/, 'provenance is not consulted per day');
  assert.match(body, /voiceAdjustmentIndependent\(d\)/, 'plan-change provenance is not consulted');
  assert.match(body, /voiceFitnessAnchorIndependent\(\)/, 'derived-value provenance is not consulted');
});
