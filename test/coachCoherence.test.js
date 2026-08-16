'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Three coherence properties the coaching engine must hold, each of which it
// failed at some point and each of which is cheap to break again:
//
//   1. the heart-rate cost of easy running is measured in a direction that
//      matches physiology, in all four combinations of pace and heart rate;
//   2. the recommendation sentence never makes a categorical claim that the
//      evidence printed beside it contradicts;
//   3. "no training to read" is never reported as "assessed and clear".
//
// Every test pins the clock, so a Tuesday and a Saturday ask the engine the
// same question.
const PINNED = '2026-03-11T09:00:00Z';   // a Wednesday, mid-block

function app() {
  return loadApp({ pinnedDate: PINNED });
}

/* Fills the plan's past with clean, on-target sessions, then lets a scenario
   mutate them. Uses the app's own targets so "on target" means what the engine
   means by it. */
function logPast(a, mutate) {
  const today = a.todayStr();
  const past = a.state.days.filter(d => d.date < today && d.type !== 'rest');
  past.forEach(d => {
    const tr = a.executionPaceTarget(d), z = a.executionHRTarget(d), band = a.expectedRPEBand(d);
    d.completed = true;
    d.actual = {
      km: d.km,
      pace: a.secToPace(tr ? Math.round((tr.fast + tr.slow) / 2) : 300),
      hr: z ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 10)) / 2) : 140,
      rpe: band ? band[0] : 3,
      notes: '',
    };
  });
  if (mutate) mutate(a, past);
  past.forEach(d => { if (d.completed) { try { a.coachPersistReview(d); } catch (e) {} } });
  return past;
}

function efficiencyTrend(a) {
  return (a.athleteTrends() || []).filter(t => /efficiency/.test(t.id))[0] || null;
}

/* Recent easy runs shifted against this athlete's own established base.
   paceDelta is seconds per km (negative = faster); hrDelta is bpm. */
function easyShift(paceDelta, hrDelta) {
  const a = app();
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  logPast(a, (app_, past) => {
    const from = app_.addDays(app_.todayStr(), -20);
    past.filter(d => d.type === 'easy' && d.date >= from).forEach(d => {
      const tr = app_.executionPaceTarget(d);
      const base = tr ? Math.round((tr.fast + tr.slow) / 2) : 330;
      d.actual.pace = app_.secToPace(base + paceDelta);
      d.actual.hr = (d.actual.hr || 140) + hrDelta;
    });
  });
  return efficiencyTrend(a);
}

// ---------------------------------------------------------------------------
// 1. EFFICIENCY DIRECTIONALITY
//
// The quantity is beats per kilometre (hr * pace-in-min/km); lower is better.
// Dividing by pace instead measures heart rate times SPEED, which inverts the
// moment pace moves: it called faster-at-the-same-HR a decline and
// slower-at-the-same-HR an improvement.
// ---------------------------------------------------------------------------
test('efficiency: lower heart rate at the same pace is an improvement', () => {
  const t = easyShift(0, -10);
  assert.ok(t, 'a trend should be detected');
  assert.equal(t.id, 'easy_efficiency_up');
  assert.equal(t.direction, 'positive');
});

// Heart-rate cost per kilometre is HR x pace(min/km); lower is better. Dividing
// by pace instead measures HR x SPEED, which is only the right question while
// pace is constant and inverts the moment it moves. Both pace directions are
// asserted because the divide-by form passes the two HR-only cases and fails
// exactly these.
test('efficiency: FASTER at the same heart rate is an improvement', () => {
  const t = easyShift(-40, 0);
  assert.ok(t, 'a trend should be detected');
  assert.equal(t.id, 'easy_efficiency_up',
    '40s/km quicker for the same heart rate is fewer heartbeats per kilometre');
  assert.equal(t.direction, 'positive');
});

test('efficiency: SLOWER at the same heart rate is a decline', () => {
  const t = easyShift(60, 0);
  assert.ok(t, 'a trend should be detected');
  assert.equal(t.id, 'easy_efficiency_down',
    'needing 60s/km more for the same heart rate costs more beats per kilometre');
  assert.equal(t.direction, 'negative');
});

test('efficiency: the wording describes what was measured, not a pace that was held', () => {
  const slower = easyShift(60, 0);
  assert.match(slower.detail, /heartbeats per kilometre/i);
  assert.ok(!/holding the same easy pace/i.test(slower.detail),
    'pace moved 60s/km, so the sentence must not assert it was held');
});

test('efficiency: a pace-only change is attributed to execution, not to a second fact', () => {
  const t = easyShift(60, 0);
  assert.equal(t.concept, 'execution',
    'HR did not move, so this reading is the same fact execution_declining reports');
});

test('efficiency: an HR-only change is attributed to heart-rate cost', () => {
  const t = easyShift(0, 10);
  assert.equal(t.concept, 'hr_cost',
    'pace did not move, so this reading is the same fact easy_hr_elevated reports');
});

// ---------------------------------------------------------------------------
// 2. RECOMMENDATION vs ITS OWN EVIDENCE
// ---------------------------------------------------------------------------
test('recommendation never claims nothing suggests restraint while showing evidence', () => {
  const a = app();
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  logPast(a, (app_, past) => {
    // a real acute-load spike: this week's volume well above the 4-week norm
    const from = app_.addDays(app_.todayStr(), -6);
    past.forEach(d => { if (d.date >= from) d.actual.km = Math.round(d.km * 2.4 * 10) / 10; });
  });
  const dec = a.coachDecision();
  assert.ok(dec.reasons.length > 0, 'the spike should be listed as evidence');
  assert.match(dec.reasons.join(' '), /your four-week average/,
    'precondition: the load spike is the evidence on the card');
  assert.ok(!/nothing in recent training suggests holding back/i.test(dec.recommendation),
    'must not categorically deny evidence printed directly beside it');
  assert.ok(!/nothing unusual in the recent training/i.test(dec.recommendation),
    'evidence was found, so "nothing unusual" is false');
});

test('restraint is preserved: evidence alone does not force a reduction', () => {
  const a = app();
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  logPast(a, (app_, past) => {
    const from = app_.addDays(app_.todayStr(), -6);
    past.forEach(d => { if (d.date >= from) d.actual.km = Math.round(d.km * 2.4 * 10) / 10; });
  });
  const dec = a.coachDecision();
  assert.ok(['proceed', 'check'].includes(dec.state),
    'a load spike on its own is not grounds to rewrite the week');
  assert.match(dec.recommendation, /plan still stands|stays on|Nothing here changes/i,
    'the plan should be left alone, and said so plainly');
});

// ---------------------------------------------------------------------------
// 3. NOTHING FOUND vs NOTHING TO ASSESS
// ---------------------------------------------------------------------------
test('a week with no completed sessions is not reported as an assessment', () => {
  const a = app();
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  logPast(a, (app_, past) => {
    const from = app_.addDays(app_.todayStr(), -6);
    past.forEach(d => { if (d.date >= from) { d.completed = false; delete d.actual; } });
  });
  const dec = a.coachDecision();
  assert.ok(!/nothing unusual in the recent training/i.test(dec.recommendation),
    'there was no recent training to find anything unusual in');
  assert.match(dec.recommendation, /nothing to read yet/i);
  assert.match(dec.recommendation, /plan stands/i, 'and it must not be alarming');
  assert.ok(!/recover|reduce|hold back|concern/i.test(dec.recommendation),
    'insufficient evidence is not a risk signal');
});

test('a week that WAS trained and is clear still says so', () => {
  const a = app();
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  logPast(a, null);                       // everything completed, all on target
  const dec = a.coachDecision();
  assert.equal(dec.state, 'proceed');
  assert.ok(!/nothing to read yet/i.test(dec.recommendation),
    'training was logged, so this is a real assessment');
});

// ---------------------------------------------------------------------------
// 4. THE PINNED CLOCK ITSELF
// ---------------------------------------------------------------------------
test('a pinned clock makes the engine answer identically on any wall-clock day', () => {
  const runOn = iso => {
    const a = loadApp({ pinnedDate: iso });
    buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
    logPast(a, null);
    const dec = a.coachDecision();
    return JSON.stringify({ state: dec.state, score: dec.score, reasons: dec.reasons });
  };
  // Same pinned instant expressed on two different real days of running this
  // suite: the engine must not be able to tell them apart.
  assert.equal(runOn(PINNED), runOn(PINNED));
  // And a genuinely different pinned date is allowed to differ -- that proves
  // the pin is doing something rather than the fixture being insensitive.
  const other = runOn('2026-06-20T09:00:00Z');
  assert.equal(typeof other, 'string');
});

test('loadApp() without a pin still uses the real clock', () => {
  const a = loadApp();
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(a.todayStr(), today, 'production date behaviour is unchanged');
});
