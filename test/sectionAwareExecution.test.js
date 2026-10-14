'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SIX REPS INSIDE THE WINDOW ARE SIX REPS INSIDE THE WINDOW
   =========================================================================
   A real session: Deuce, 2x(3x1000m) at 4:10-4:16, 2km easy either side.
   All six reps run inside the window. Scored 79%, "pace ran outside the
   4:37-5:07 window", and a fatigue warning -- because what was scored was the
   5:32/km average of the WHOLE RUN, recoveries and warm-up included, against
   a distance-weighted composite of every section's band.

   TWO DEFECTS, ONE ON TOP OF THE OTHER.

   The one underneath: a 1000m rep is not asked for its distance, so the time
   the athlete entered was divided by nothing and the rep carried NO PACE AT
   ALL. The sharpest evidence in the session never reached the scorer.

   The one on top: even with section paces present, the score was the whole-run
   average against a composite band. Correct for whole-session evidence; wrong
   the moment the athlete has said what each section was.

   WHAT MUST STAY TRUE: the composite is still right where section evidence is
   absent or incomplete, no band moved, no methodology changed, and a recovery
   is judged against the recovery's own target rather than the work target. */

const TODAY = '2026-10-14';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 55, weeks: 14, lthr: 172, maxHR: 188,
                 startDate: a.addDays(TODAY, -42), earnedSecondQuality: true });
  return a;
}
/* The real session, written as the generator writes one -- an archetype and
   its params, never a hand-built segment tree. */
function deuce(a){
  const dd = a.state.days.filter(d => d.date < TODAY && d.type === 'interval')[0];
  assert.ok(dd, 'no interval session to rebuild as the Deuce');
  dd.prescription = { v: a.PRESCRIPTION_VERSION, archetype: 'deuce',
                      params: { sets: 2, reps: 3, m: 1000 } };
  dd.title = 'Deuce: 2x(3x1000m)';
  dd.completed = true;
  dd.actual = { km: 11, pace: '5:32', paceUnit: 'km', hr: null, rpe: null, feel: null, notes: '' };
  const segs = a.orderedSegments(a.prescriptionOf(dd));
  assert.equal(segs.filter(s => s.role === 'work').length, 6, 'the fixture is not six reps');
  return dd;
}
/* Logging through the app's own writer, then its own pace derivation -- the
   same two steps handleStructuredSplitChange() performs. */
function logSection(a, dd, plan, row, sec, km){
  /* THE REAL WRITER, not a copy of it. handleStructuredSplitChange() is what
     the athlete's keystrokes reach and it needs no DOM, so a test that goes
     round it would be testing a second implementation of the thing under
     test. */
  if (km != null) a.handleStructuredSplitChange(dd.id, row.segId, 'km', String(km));
  if (sec != null) a.handleStructuredSplitChange(dd.id, row.segId, 'sec', a.secToPace(sec));
  return a.structuredSplitFor(dd, row.segId);
}
const rowsOf = (a, dd) => a.structuredLoggingPlan(dd).rows;
const isRep = r => r.role === 'work';
const REPS_INSIDE = [256, 253, 255, 251, 254, 255];     // 4:16 4:13 4:15 4:11 4:14 4:15
function logFlanks(a, dd, plan){
  plan.rows.filter(r => r.role === 'warmup' || r.role === 'cooldown')
    .forEach(r => logSection(a, dd, plan, r, 720));      // 12:00 for 2km = 6:00/km, inside easy
}

// =====================================================================
// 1. THE DEFECT UNDERNEATH: A DISTANCE-PRESCRIBED REP NOW HAS A PACE
// =====================================================================

test('a 1000m rep logged by time alone yields a pace', () => {
  const a = app(), dd = deuce(a), plan = a.structuredLoggingPlan(dd);
  const rep = plan.rows.filter(isRep)[0];
  assert.equal(rep.asks.dist, false, 'the fixture no longer exercises the distance-prescribed case');
  assert.equal(rep.presKm, 1, 'the plan row does not carry the prescribed distance');
  const s = logSection(a, dd, plan, rep, 256);
  assert.equal(s.paceSec, 256, 'the entered time still divides by nothing');
  assert.equal(s.km, null, 'a distance the athlete never entered was written into their log');
  assert.equal(s.kmFromPrescription, true, 'the derivation is not recorded');
});

test('a duration-prescribed segment is untouched by that', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date < TODAY && d.type === 'interval')[0];
  dd.completed = true;
  const plan = a.structuredLoggingPlan(dd);
  const timed = plan.rows.filter(r => r.asks.dist === true && r.asks.time === false)[0];
  if (!timed) return;                       // this fixture has none; nothing to assert
  assert.equal(timed.presKm, null, 'a duration-prescribed segment invented a distance');
});

// =====================================================================
// 2. THE REAL SESSION
// =====================================================================

test('6/6 reps inside target score as executed, despite a 5:32/km whole run', () => {
  const a = app(), dd = deuce(a);
  const before = a.computeExecutionBreakdown(dd);
  assert.ok(before.parts[1].score < 70,
    'the fixture no longer reproduces the defect — whole-run pace already scored well');
  assert.equal(before.paceResolution, 'whole-session');

  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);

  const after = a.computeExecutionBreakdown(dd);
  assert.equal(after.parts[1].score, 100, 'six reps inside the window did not score as executed');
  assert.equal(after.paceResolution, 'sections-scored');
  assert.ok(after.score > before.score, 'the corrected evidence did not improve the verdict');
  // and the athlete is told what was actually judged
  assert.match(a.executionResolutionClause(after), /section by section/);
  assert.doesNotMatch(a.executionResolutionClause(after), /not yet scored/);
});

test('every rep is judged against the reps’ own band, not the whole-run composite', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);
  const I = a.getActivePaces().I;
  REPS_INSIDE.forEach(sec => assert.ok(sec >= I.fast - 1 && sec <= I.slow + 1,
    'the fixture reps are not actually inside the prescribed interval band'));
  const composite = a.executionPaceTarget(dd);
  assert.ok(composite.slow < 5 * 60 + 32,
    'the whole-run average is no longer outside the composite — the test proves nothing');
  assert.equal(a.sectionPaceExecution(dd).score, 100);
});

// =====================================================================
// 3. IT STILL SAYS NO WHEN THE ANSWER IS NO
// =====================================================================

test('reps genuinely run too slow reduce execution', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  // every rep a full minute per km slower than the window
  plan.rows.filter(isRep).forEach(r => logSection(a, dd, plan, r, 256 + 60));
  logFlanks(a, dd, plan);
  const sec = a.sectionPaceExecution(dd);
  assert.ok(sec.score < 70, 'six missed reps still scored well: ' + sec.score);
  assert.ok(a.computeExecutionBreakdown(dd).parts[1].score < 70);
});

test('a few missed reps sit between the two, rather than being all or nothing', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, i < 4 ? REPS_INSIDE[i] : 256 + 60));
  logFlanks(a, dd, plan);
  const mixed = a.sectionPaceExecution(dd).score;
  assert.ok(mixed > 70 && mixed < 100, 'two missed reps out of six scored ' + mixed);
});

test('reps run far too FAST are not rewarded either', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach(r => logSection(a, dd, plan, r, 200));   // 3:20/km
  logFlanks(a, dd, plan);
  assert.ok(a.sectionPaceExecution(dd).score < 100, 'running the reps far too hard scored perfect');
});

// =====================================================================
// 4. RECOVERY, WARM-UP AND COOL-DOWN DO NOT CONTAMINATE THE WORK
// =====================================================================

test('slow recovery is not a failed interval', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);
  const clean = a.sectionPaceExecution(dd).score;
  // now log the recoveries as a very slow jog, which is what a recovery IS
  plan.rows.filter(r => r.role === 'recovery').forEach(r => logSection(a, dd, plan, r, 480, 0.4));
  const withRecoveries = a.sectionPaceExecution(dd).score;
  assert.equal(withRecoveries, clean,
    'jogging the recoveries slowly reduced the score for the reps');
  assert.equal(a.computeExecutionBreakdown(dd).parts[1].score, 100);
});

test('a slow warm-up and cool-down cannot drag the work down', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  // 2km in 16:00 = 8:00/km, far slower than the easy band
  plan.rows.filter(r => r.role === 'warmup' || r.role === 'cooldown')
    .forEach(r => logSection(a, dd, plan, r, 960));
  const sec = a.sectionPaceExecution(dd);
  const work = sec ? sec.workSections : 0;
  assert.equal(work, 6, 'the work sections stopped being counted');
  /* The flanks are judged as flanks and they were genuinely slow, so the
     session is not perfect -- but the REPS are untouched, which is the whole
     point. Proven by comparing against the same session with correct flanks. */
  const b = app(), dd2 = deuce(b), plan2 = b.structuredLoggingPlan(dd2);
  plan2.rows.filter(isRep).forEach((r, i) => logSection(b, dd2, plan2, r, REPS_INSIDE[i]));
  logFlanks(b, dd2, plan2);
  assert.equal(b.sectionPaceExecution(dd2).score, 100);
  assert.ok(sec.score < 100, 'a genuinely slow warm-up registered as nothing at all');
  /* The property that matters is not a threshold, it is that the WORK was not
     re-judged: the reps' own pace is unchanged between the two sessions. */
  assert.equal(sec.workPaceSec, b.sectionPaceExecution(dd2).workPaceSec,
    'the slow flanks changed what the reps are recorded as having run');
});

// =====================================================================
// 5. FALLBACK — UNKNOWN IS NOT ZERO
// =====================================================================

test('no section log at all keeps the existing whole-session behaviour exactly', () => {
  const a = app(), dd = deuce(a);
  assert.equal(a.sectionPaceExecution(dd), null);
  const b = a.computeExecutionBreakdown(dd);
  assert.equal(b.paceResolution, 'whole-session');
  assert.equal(b.parts[1].score, a.computePaceScore(dd, a.actualPaceSecPerKm(dd)));
});

test('an incomplete work log falls back rather than scoring from a subset', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).slice(0, 4).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  assert.equal(a.sectionPaceExecution(dd), null, 'four reps out of six were scored as if complete');
  const b = a.computeExecutionBreakdown(dd);
  assert.equal(b.paceResolution, 'sections-logged');
  assert.match(a.executionResolutionClause(b), /not every section was logged/);
});

test('a seeded time is the prescription, not evidence, and is never scored', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);
  const clean = a.sectionPaceExecution(dd).score;
  /* A recovery prescribed as "3-4min" and seeded with one end of that range,
     given a distance by the athlete, derives a pace that is pure artefact. */
  const rec = plan.rows.filter(r => r.role === 'recovery')[0];
  const s = a.upsertStructuredSplit(dd, plan, rec);
  s.km = 0.8; s.sec = 210; s.secSeeded = true; s.paceSec = Math.round(210 / 0.8);
  assert.equal(a.sectionPaceExecution(dd).score, clean,
    'a pace derived from a time this app chose was scored against the athlete');
});

// =====================================================================
// 6. NOTHING ELSE MOVED
// =====================================================================

test('an ordinary easy run scores exactly as it did', () => {
  const a = app();
  const easy = a.state.days.filter(d => d.date < TODAY && d.type === 'easy')[0];
  easy.completed = true;
  easy.actual = { km: easy.km, pace: '5:40', paceUnit: 'km', hr: 150, rpe: 3, feel: null, notes: '' };
  assert.equal(a.sectionPaceExecution(easy), null, 'a single-segment run entered the section path');
  const b = a.computeExecutionBreakdown(easy);
  assert.equal(b.paceResolution, 'direct');
  assert.equal(a.executionResolutionClause(b), '');
});

test('the prescribed bands are untouched by any of this', () => {
  const a = app(), dd = deuce(a);
  const composite = a.executionPaceTarget(dd);
  const I = a.getActivePaces().I, E = a.getActivePaces().E;
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);
  assert.deepEqual(a.executionPaceTarget(dd), composite, 'the composite target moved');
  assert.deepEqual(a.getActivePaces().I, I, 'the interval band moved');
  assert.deepEqual(a.getActivePaces().E, E, 'the easy band moved');
});

test('the section score is the same curve the whole-session score uses', () => {
  const a = app();
  const band = { fast: 240, slow: 260 };
  assert.equal(a.paceScoreAgainst(250, band, false), 100);
  assert.equal(a.paceScoreAgainst(240, band, false), 100);
  assert.equal(a.paceScoreAgainst(260, band, false), 100);
  assert.ok(a.paceScoreAgainst(300, band, false) < 100, 'slower than the band scored perfect');
  assert.ok(a.paceScoreAgainst(200, band, false) < 100, 'faster than the band scored perfect');
  // zero-width (goal pace) gets the composite's own floor rather than failing instantly
  assert.equal(a.paceScoreAgainst(300, { fast: 300, slow: 300 }, false), 100);
});

// =====================================================================
// 7. DOWNSTREAM — THE CORRECTED EVIDENCE REACHES THE COACHING LAYERS
// =====================================================================

test('the execution score every downstream layer reads is the corrected one', () => {
  const a = app(), dd = deuce(a);
  const before = a.computeExecutionScore(dd);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);
  const after = a.computeExecutionScore(dd);
  assert.ok(after > before,
    'computeExecutionScore() — what the trend, the fatigue check and evolution all read — did not move');
  assert.equal(after, 100);
});

test('the review written for the session carries the corrected verdict', () => {
  const a = app(), dd = deuce(a);
  const plan = a.structuredLoggingPlan(dd);
  plan.rows.filter(isRep).forEach((r, i) => logSection(a, dd, plan, r, REPS_INSIDE[i]));
  logFlanks(a, dd, plan);
  a.coachPersistReview(dd);
  assert.ok(dd.coachReview, 'no review was written');
  const txt = JSON.stringify(dd.coachReview);
  assert.doesNotMatch(txt, /ran outside the/, 'the review still says the pace ran outside the window');
  assert.equal(a.computeExecutionScore(dd), 100);
});
