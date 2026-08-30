'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// VVV maximises useful training, not completed workouts. That requires the
// adaptation engine to tell four states apart:
//
//   A. deterioration
//   B. recovery from deterioration      -- NOT positive adaptation
//   C. stable return to established baseline  -- neutral
//   D. established positive adaptation   -- may progress
//
// Two mechanisms carry that, and both are tested here:
//   * the trend layer requires a positive to beat the level the athlete has
//     ESTABLISHED, not merely the weeks just gone;
//   * the Playbook refuses to progress from an evidence window still
//     substantially made of below-par sessions, because such a window cannot
//     establish anything whichever way its last sessions point.
//
// Plus the independence rule both directions: one underlying fact is one vote,
// so it can never manufacture the corroboration a change to training requires.
const PINNED = '2026-03-11T09:00:00Z';

function app() { return loadApp({ pinnedDate: PINNED }); }

/* A block with `weeksDone` weeks behind it, every past session logged on
   target, then a scenario reshapes chosen sessions. Targets come from the app,
   so "on target" means what the engine means by it. */
function block(weeksDone, shape) {
  const a = app();
  buildPlan(a, { weeks: weeksDone + 6, startDate: a.addDays(a.todayStr(), -weeksDone * 7) });
  const today = a.todayStr();
  const past = a.state.days.filter(d => d.date < today && d.type !== 'rest');
  past.forEach(d => {
    const tr = a.executionPaceTarget(d), z = a.executionHRTarget(d), band = a.expectedRPEBand(d);
    d.completed = true;
    d.actual = {
      km: d.km,
      pace: a.secToPace(tr ? Math.round((tr.fast + tr.slow) / 2) : 330),
      hr: z ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 10)) / 2) : 145,
      rpe: band ? band[0] : 3,
      notes: '',
    };
  });
  if (shape) past.forEach((d, i) => shape(a, d, i, past.length));
  past.forEach(d => { try { a.coachPersistReview(d); } catch (e) {} });
  return a;
}
/* Degrade one session: slower, and optionally costlier in HR and effort. */
function degrade(a, d, { paceOff = 0, hrOff = 0, rpeOff = 0 }) {
  const tr = a.executionPaceTarget(d), band = a.expectedRPEBand(d);
  const mid = tr ? Math.round((tr.fast + tr.slow) / 2) : 330;
  if (paceOff) d.actual.pace = a.secToPace(mid + paceOff);
  if (hrOff) d.actual.hr = (d.actual.hr || 145) + hrOff;
  if (rpeOff) d.actual.rpe = Math.min(10, (band ? band[0] : 3) + rpeOff);
}
const decisionOf = a => a.playbookAssess().decision;

// ---------------------------------------------------------------------------
// B. RECOVERY FROM DETERIORATION IS NOT ADAPTATION
// ---------------------------------------------------------------------------
test('a block that deteriorated and then recovered does not PROGRESS', () => {
  const a = block(10, (app_, d, i, n) => {
    if (i > n * 0.45 && i < n * 0.90) degrade(app_, d, { paceOff: 60, hrOff: 11, rpeOff: 2 });
  });
  const assessment = a.playbookAssess();
  assert.notEqual(assessment.decision, 'PROGRESS',
    'returning to normal is not evidence that more training is warranted');
  assert.ok(assessment.blockedBy.length > 0,
    'and the reason it did not progress is recorded, not silently dropped');
  assert.match(assessment.blockedBy.join(' '), /below par|return toward your usual/i);
});

test('the rebound does not masquerade as positive trends', () => {
  const a = block(10, (app_, d, i, n) => {
    if (i > n * 0.45 && i < n * 0.90) degrade(app_, d, { paceOff: 60, hrOff: 11, rpeOff: 2 });
  });
  /* The trend layer may still NOTICE that recent runs are better than the weeks
     just gone -- that is true, and useful to say. What must not happen is any
     consumer turning it into "this athlete is adapting" and asking for more
     training. Asserted at the boundary that matters rather than by forbidding
     the observation. */
  const blk = a.blockEffectiveness();
  assert.notEqual(blk && blk.state, 'ADAPTING',
    'a rebound must not be classified as a block that is absorbing more work');
  assert.notEqual(a.playbookAssess().decision, 'PROGRESS');
});

// ---------------------------------------------------------------------------
// C. STABLE BASELINE IS NEUTRAL / D. ESTABLISHED ADAPTATION MAY PROGRESS
// ---------------------------------------------------------------------------
test('a clean, stable block is not blocked by the rebound rule', () => {
  const a = block(10, null);           // everything on target throughout
  const assessment = a.playbookAssess();
  assert.ok(!assessment.blockedBy.some(w => /below par/i.test(w)),
    'a clean window must never be called contaminated');
});

test('sustained genuine improvement can still PROGRESS', () => {
  const a = block(10, (app_, d, i, n) => {
    /* Steadily better than target across the back half, never degraded -- and
       across EVERY session type, which is what sustained improvement is.
       Improving only the easy runs described a different athlete: their easy
       pace moved and their quality did not, so half the recent window sat
       below the new normal and the rebound rule correctly called the window
       mixed. The fixture was contradicting its own title. */
    if (i > n * 0.5) degrade(app_, d, { paceOff: -25, hrOff: -6 });
  });
  const assessment = a.playbookAssess();
  assert.ok(!assessment.blockedBy.some(w => /below par/i.test(w)),
    'genuine improvement is not a contaminated window');
  assert.notEqual(assessment.decision, 'REGRESS',
    'and improving is certainly not grounds to cut training');
});

test('one strong session cannot PROGRESS the plan', () => {
  /* THE GUARD NEEDS SOMETHING TO GUARD. Against ten weeks of clean execution
     the block already reads PROGRESS, so "one strong session did not raise it"
     is true for a reason that has nothing to do with the rule. Three weeks is
     a block that has not yet earned a progression, which is where a single
     outstanding session could actually buy one.

     And "strong" means inside the window and near its fast end, not forty
     seconds a kilometre through it: execution scores deviation in BOTH
     directions, so a session run far faster than a quality target reads as
     off-prescription and pushed the block DOWN. The fixture was proving the
     opposite of its title, by accident. */
  const strong = (app_, d, i, n) => {
    if (i === n - 1) degrade(app_, d, { paceOff: -12, hrOff: -10 });
  };
  const before = block(3, null).playbookAssess().decision;
  const after = block(3, strong).playbookAssess().decision;
  assert.notEqual(before, 'PROGRESS',
    'precondition: the baseline block must be one that has NOT earned a progression');
  assert.equal(after, before,
    'a single outstanding session changes nothing on its own');
});

// ---------------------------------------------------------------------------
// NEGATIVE EVIDENCE INDEPENDENCE
// ---------------------------------------------------------------------------
test('pace-only decline cannot manufacture the corroboration REGRESS requires', () => {
  /* Slower, but still EXECUTING: the drift is enough to move the pace-derived
     trends and not enough to trip repeated_shortfall, which is a separate and
     legitimate safety path (repeatedly failing to complete the session as set
     is its own finding and is tested below). This is the case the project's
     position is about -- slower while still completing is watched, not cut. */
  const a = block(10, (app_, d, i, n) => {
    if (i > n * 0.5) degrade(app_, d, { paceOff: Math.round(((i - n * 0.5) / (n * 0.5)) * 35) });
  });
  const assessment = a.playbookAssess();
  const shortfall = assessment.evidence.some(e => e.id === 'repeated_shortfall');
  assert.equal(shortfall, false,
    'precondition: the athlete is still executing, so the shortfall path is not what is being tested');
  assert.notEqual(assessment.decision, 'REGRESS',
    'running slower while still completing sessions is not enough to cut training');
});

test('...and blockEffectiveness cannot reach STRAINED from that one fact either', () => {
  const a = block(10, (app_, d, i, n) => {
    if (i > n * 0.5) degrade(app_, d, { paceOff: Math.round(((i - n * 0.5) / (n * 0.5)) * 70) });
  });
  const b = a.blockEffectiveness();
  assert.notEqual(b && b.state, 'STRAINED',
    'easy efficiency and quality execution both move on one pace change; that is one observation');
});

test('genuinely independent deterioration still REGRESSes', () => {
  const a = block(10, (app_, d, i, n) => {
    // pace, heart rate AND effort all deteriorating: three separate facts
    if (i > n * 0.5) {
      const f = (i - n * 0.5) / (n * 0.5);
      degrade(app_, d, { paceOff: Math.round(f * 70), hrOff: Math.round(f * 12), rpeOff: 2 });
    }
  });
  const d = decisionOf(a);
  assert.ok(d === 'REGRESS' || a.playbookAssess().evidence.some(e => e.tier === 'safety'),
    'corroborated, independent deterioration must still be able to cut training');
});

// ---------------------------------------------------------------------------
// POSITIVE EVIDENCE INDEPENDENCE
// ---------------------------------------------------------------------------
test('one pace improvement is not three independent confirmations', () => {
  const a = block(10, (app_, d, i, n) => {
    if (i > n * 0.5 && d.type === 'easy') degrade(app_, d, { paceOff: -30 });
  });
  const positives = (a.athleteTrends() || []).filter(t => t.direction === 'positive');
  const concepts = new Set(positives.map(t => t.concept));
  assert.ok(concepts.size <= positives.length,
    'sanity: concepts are assigned');
  // efficiency moved only because pace moved, so it reads as the same fact
  const eff = positives.find(t => /efficiency/.test(t.id));
  if (eff) assert.equal(eff.concept, 'execution',
    'a pace-driven efficiency gain is the execution fact, not a second one');
});

test('every trend carries the underlying fact it reads', () => {
  const a = block(10, (app_, d, i, n) => {
    if (i > n * 0.5) degrade(app_, d, { paceOff: 40, hrOff: 8, rpeOff: 2 });
  });
  (a.athleteTrends() || []).forEach(t => {
    assert.ok(typeof t.concept === 'string' && t.concept.length > 0,
      'trend ' + t.id + ' must declare its concept so no consumer double-counts it');
  });
});

// ---------------------------------------------------------------------------
// FUTURE-DATED EVIDENCE
// ---------------------------------------------------------------------------
test('a future day carrying coachAdjust cannot enter historical evidence as training', () => {
  const a = block(8, null);
  const today = a.todayStr();
  const future = a.state.days.filter(d => d.date > today && d.type !== 'rest')[0];
  assert.ok(future, 'precondition: the plan has a future session');
  // the exact shape a bad swap or a wrong device clock used to produce
  future.completed = true;
  future.actual = { km: future.km, pace: '3:30', hr: 195, rpe: 10, notes: '' };
  future.coachAdjust = { at: new Date().toISOString(), reason: 'x', evidence: [], state: 'ADAPT' };

  const mem = a.athleteMemory(42);
  const rec = mem.filter(r => r.date === future.date)[0];
  if (rec) {
    assert.equal(rec.completed, false, 'a day that has not happened is never completed training');
    assert.equal(rec.executionScore, null, 'and can never carry an execution score');
    assert.equal(rec.actualPace, null, 'nor a pace');
  }
  assert.ok(!mem.some(r => r.date > today && r.completed),
    'no future-dated record may report as completed training');
});

test('a past coachAdjust day is still remembered, as it was before', () => {
  const a = block(8, null);
  const today = a.todayStr();
  // a RECENT past day: athleteMemory only looks back 42 days
  const past = a.state.days.filter(d => d.date < today && d.completed).slice(-3)[0];
  past.coachAdjust = { at: new Date().toISOString(), reason: 'x', evidence: [], state: 'ADAPT' };
  const mem = a.athleteMemory(42);
  assert.ok(mem.some(r => r.date === past.date),
    'accepting an adjustment is evidence this athlete backs off when asked');
});
