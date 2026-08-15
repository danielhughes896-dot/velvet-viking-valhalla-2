'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// coachDecision() is the Athlete State evidence-weighting core: the single
// most important place for "does the coach actually wait for evidence"
// (VVV_PRINCIPLES: one_good_is_not_evidence / one_bad_is_not_evidence /
// minimum_intervention) to hold up under test, not just in a code comment.

function fillNormally(app, dd) {
  const target = app.executionPaceTarget(dd);
  const band = app.expectedRPEBand(dd);
  const zone = app.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = {
    km: dd.km,
    pace: target ? app.secToPace((target.slow + target.fast) / 2) : null,
    hr: zone && zone.lo != null ? Math.round((zone.lo + (zone.hi != null ? zone.hi : zone.lo + 20)) / 2) : null,
    rpe: band ? Math.round((band[0] + band[1]) / 2) : null,
    notes: '',
  };
}

test('coachDecision: a brand-new plan with zero completed sessions never manufactures a modify/recover state', () => {
  const app = loadApp();
  buildPlan(app, {});
  const dec = app.coachDecision();
  assert.ok(dec, 'a freshly generated plan must still resolve a decision for the next session');
  assert.equal(dec.state, 'proceed', 'no evidence at all must read as proceed, not a guess in either direction');
  assert.equal(dec.evidenceCount, 0);
});

test('coachDecision: a single isolated pain report does not escalate straight to modify', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const today = days.find(d => d.date === app.todayStr());
  fillNormally(app, today);
  today.actual.notes = 'left knee pain during the last mile';
  const dec = app.coachDecision();
  assert.ok(dec);
  assert.notEqual(dec.state, 'modify', 'one weak, uncorroborated signal must not be enough for MODIFY');
  assert.notEqual(dec.state, 'recover', 'a single pain mention (not repeated) is not the safety threshold');
});

test('coachDecision: repeated pain reports across recent sessions trip the safety threshold (RECOVER)', () => {
  const app = loadApp();
  const startDate = app.addDays(app.todayStr(), -4);
  const { days } = buildPlan(app, { startDate });
  const recent = days.filter(d => d.date <= app.todayStr() && d.type !== 'rest');
  assert.ok(recent.length >= 2, 'fixture needs at least two recent non-rest days');
  recent.forEach((dd, i) => {
    fillNormally(app, dd);
    if (i < 2) dd.actual.notes = 'sharp pain in my calf, had to slow down';
  });
  const dec = app.coachDecision();
  assert.ok(dec);
  assert.equal(dec.state, 'recover', 'two or more recent pain reports is the documented safety threshold');
});

test('coachDecision: corroborated fatigue (elevated effort + elevated HR, on a quality day) reaches modify', () => {
  const app = loadApp();
  const startDate = app.addDays(app.todayStr(), -10);
  const { days } = buildPlan(app, { lthr: 172, maxHR: 188, weeks: 12, startDate });
  const today = app.todayStr();

  // Fill every non-rest day up to and including today normally first...
  days.filter(d => d.date <= today && d.type !== 'rest').forEach(dd => fillNormally(app, dd));

  // ...then push RPE and HR over band on two of the last 7 days, which is
  // exactly what coachRecovery() reads to classify the week as 'strained'
  // and to count sessions with HR over zone.
  const last7 = days.filter(d => d.date <= today && d.date >= app.addDays(today, -6) && d.type !== 'rest');
  const overBandDay = last7.find(d => d.type === 'interval' || d.type === 'threshold' || d.type === 'tempo') || last7[0];
  const band = app.expectedRPEBand(overBandDay);
  const zone1 = app.executionHRTarget(overBandDay);
  overBandDay.actual.rpe = band[1] + 2;
  overBandDay.actual.hr = (zone1.hi != null ? zone1.hi : zone1.lo + 20) + 15;

  const secondHrDay = last7.find(d => d.id !== overBandDay.id && d.type === 'easy') || last7[1];
  const zone2 = app.executionHRTarget(secondHrDay);
  secondHrDay.actual.hr = (zone2.hi != null ? zone2.hi : zone2.lo + 20) + 15;

  const recovery = app.coachRecovery();
  assert.equal(recovery.state, 'strained', 'fixture must actually reach the strained band for this test to be meaningful');
  assert.ok(recovery.overHR >= 2, 'fixture must actually push 2+ sessions over their HR zone');

  // Leave the NEXT quality day uncompleted so coachNextSession() picks a
  // quality session -- MODIFY only applies to quality sessions; a recovery
  // day would cap the same evidence at CHECK instead.
  const nextQuality = days.find(d => d.date > today && (d.type === 'interval' || d.type === 'threshold' || d.type === 'tempo'));
  assert.ok(nextQuality, 'fixture needs an upcoming quality day for this scenario to be well-formed');
  days.filter(d => d.date > today && d.date < nextQuality.date && d.type !== 'rest').forEach(dd => fillNormally(app, dd));

  const dec = app.coachDecision();
  assert.ok(dec);
  assert.equal(dec.dayId, nextQuality.id, 'the decision should be about the upcoming quality session');
  assert.equal(dec.state, 'modify', 'two independent corroborating signals on a quality day should reach MODIFY');
  assert.ok(dec.evidenceCount >= 2, 'MODIFY requires more than one independent line of evidence');
});

test('coachDecision: only excellent sessions never manufactures escalation on their own', () => {
  const app = loadApp();
  // A long, steady lead-in so the 28-day chronic-load baseline reflects real
  // steady-state training rather than a data-sparse first week reading as an
  // acute:chronic "spike" purely for lack of history -- coachLoad()'s own
  // comment is explicit that load is "reported, never enforced" precisely
  // because that ratio needs real history to mean anything.
  const startDate = app.addDays(app.todayStr(), -35);
  const { days } = buildPlan(app, { startDate, weeks: 12 });
  days.filter(d => d.date <= app.todayStr() && d.type !== 'rest').forEach(dd => fillNormally(app, dd));
  const dec = app.coachDecision();
  assert.ok(dec);
  // Positive evidence can only ever hold a borderline case down, never push
  // the state up -- with nothing negative logged, it must stay at proceed.
  assert.equal(dec.state, 'proceed', 'good execution alone must never escalate the coaching state');
  assert.equal(dec.evidenceCount, 0);
});

test('coachEnvironment: a hot, humid session is attributed to conditions, not read as pain or illness', () => {
  const app = loadApp();
  buildPlan(app, {});
  // Real call sites pass coachEnvironment(dd.actual.notes, dd.actual) -- the
  // same text on both sides -- since effectiveNoteSignals() reads
  // actual.notes, not the first positional argument, whenever actual is
  // truthy. Mirror that here rather than the two diverging.
  const notes = 'Brutal 34C heat and 70% humidity today';
  const env = app.coachEnvironment(notes, { notes });
  assert.equal(env.pain, false);
  assert.equal(env.illness, false);
  assert.equal(env.heatBand, 'severe', '34C should register as severe heat');
  assert.equal(env.severe, true);
});

test('coachEnvironment: a note mentioning both heat and soreness still flags the pain signal', () => {
  const app = loadApp();
  buildPlan(app, {});
  // Heat explains the effort; it must not suppress a real, separately-stated
  // pain report in the same note.
  const notes = 'Brutal 34C heat, and my knee was sore too';
  const env = app.coachEnvironment(notes, { notes });
  assert.equal(env.heatBand, 'severe');
  assert.equal(env.pain, true, 'an explained hard session must not mask an actual pain report in the same note');
});

test('computeConfidenceScore: a brand-new plan reads the neutral prior, not zero or a guess', () => {
  const app = loadApp();
  buildPlan(app, {});
  const score = app.computeConfidenceScore();
  assert.equal(score, app.CONFIDENCE_PRIOR_SCORE, 'with no completed sessions the score is exactly the neutral prior');
});

test('computeConfidenceScore: one excellent session nudges confidence up only modestly', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const dd = days.find(d => d.type === 'easy' && d.km > 0);
  fillNormally(app, dd);
  const before = app.CONFIDENCE_PRIOR_SCORE;
  const after = app.computeConfidenceScore();
  assert.ok(after > before, 'a perfect session should move confidence upward');
  assert.ok(after - before < 15, 'a single session must not swing confidence by a large margin (5-session Bayesian prior)');
});
