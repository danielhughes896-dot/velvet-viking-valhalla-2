'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Two facts about a coach adjustment live on the same day object and must be
// kept apart:
//
//   THE DECISION   -- the athlete accepted a proposal. That happened today,
//                     whatever date the session it changed sits on, and it is
//                     the evidence that says this athlete backs off when asked.
//   THE TRAINING   -- how the session went. That has not happened yet, and no
//                     amount of metadata on the day can make it have happened.
//
// Guarding admission on an unrelated readiness answer conflated the two: an
// adjustment accepted for a session still ahead disappeared from the record
// until its date passed, so the athlete's compliance was undercounted for
// exactly as long as the decision was most current.
//
// The clock is pinned, so a Tuesday and a Saturday ask the same question.
const PINNED = '2026-03-11T09:00:00Z';

function app() { return loadApp({ pinnedDate: PINNED }); }

/* A block with its past logged clean and on target, using the app's own
   targets so "on target" means what the engine means by it. */
function block() {
  const a = app();
  buildPlan(a, { weeks: 14, startDate: a.addDays(a.todayStr(), -56) });
  const today = a.todayStr();
  a.state.days.filter(d => d.date < today && d.type !== 'rest').forEach(d => {
    const tr = a.executionPaceTarget(d), z = a.executionHRTarget(d), band = a.expectedRPEBand(d);
    d.completed = true;
    d.actual = { km: d.km, pace: a.secToPace(tr ? Math.round((tr.fast + tr.slow) / 2) : 330),
                 hr: z ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 10)) / 2) : 145,
                 rpe: band ? band[0] : 3, notes: '' };
  });
  a.state.days.filter(d => d.date < today && d.completed)
   .forEach(d => { try { a.coachPersistReview(d); } catch (e) {} });
  return a;
}
const futureSession = a => a.state.days.filter(d => d.date > a.todayStr() && d.type !== 'rest')[0];
/* Exactly what handleCoachAccept writes, and nothing else -- no readiness, no
   athleteState. That "nothing else" is the whole point. */
function acceptOn(day) {
  day.coachAdjust = { at: '2026-03-11T09:00:00Z', reason: 'easing back',
                      evidence: ['recent sessions have been costly'], state: 'modify',
                      from: { km: day.km, type: day.type, title: day.title, desc: day.desc, prescription: null } };
  day.km = Math.max(1, Math.round(day.km * 0.75 * 2) / 2);
  return day;
}
const recordFor = (a, date) => a.athleteMemory(42).filter(r => r.date === date)[0];

// ---------------------------------------------------------------------------
// 1 & 4. THE DECISION IS REMEMBERED AS SOON AS IT IS MADE
// ---------------------------------------------------------------------------
test('accepting an adjustment for a future session is remembered immediately', () => {
  const a = block();
  const fut = acceptOn(futureSession(a));
  const rec = recordFor(a, fut.date);
  assert.ok(rec, 'the decision happened today; it belongs in the record today');
  assert.equal(rec.acceptedAdjustment, true);
  assert.equal(rec.adjustmentReason, 'easing back');
  assert.ok(rec.adjustmentEvidence.length > 0, 'with the evidence the coach acted on');
});

test('coachAdjust alone is enough -- no readiness or athleteState required', () => {
  const a = block();
  const fut = acceptOn(futureSession(a));
  assert.equal(a.dayReadiness(fut), null, 'precondition: nothing was logged that morning');
  assert.equal(fut.athleteState, undefined, 'precondition: no decided state either');
  assert.ok(recordFor(a, fut.date),
    'whether the athlete happened to log how they felt cannot decide whether their decision is kept');
});

test('the adjustment counters see it straight away', () => {
  const before = block().athleteBaselines().adjustments;
  const a = block();
  acceptOn(futureSession(a));
  const after = a.athleteBaselines().adjustments;
  assert.equal(after.accepted, before.accepted + 1, 'accepted rises the moment the athlete accepts');
  assert.equal(after.offered, before.offered + 1, 'and it cannot be accepted without having been offered');
});

test('the decision survives to the session date without being double counted', () => {
  const a = block();
  const fut = acceptOn(futureSession(a));
  const whileAhead = a.athleteBaselines().adjustments.accepted;
  // the same day, now behind the athlete: the record must be continuous
  fut.date = a.addDays(a.todayStr(), -1);
  assert.equal(a.athleteBaselines().adjustments.accepted, whileAhead,
    'one decision is one decision, before and after the session comes round');
});

// ---------------------------------------------------------------------------
// 2 & 6 & 7. AND CARRIES NO TRAINING WHATSOEVER
// ---------------------------------------------------------------------------
test('the future record contributes no training evidence of any kind', () => {
  const a = block();
  const fut = acceptOn(futureSession(a));
  // the exact shape a bad swap or a wrong device clock leaves behind
  fut.completed = true;
  fut.actual = { km: fut.km * 3, pace: '3:10', hr: 199, rpe: 10, notes: 'brutal heat, calf tight' };
  fut.coachReview = { version: a.COACH_REVIEW_VERSION, recommendPlanAdjustment: true,
                      trainingSignal: 'overreaching', environment: { severe: true, heatBand: 'extreme' } };
  const rec = recordFor(a, fut.date);
  assert.ok(rec, 'still admitted -- for the decision');
  assert.equal(rec.completed, false, 'a day that has not happened is never completed training');
  assert.equal(rec.actualPace, null);
  assert.equal(rec.executionScore, null);
  assert.equal(rec.actualKm, null);
  assert.equal(rec.hr, null);
  assert.equal(rec.rpe, null);
  assert.equal(rec.feel, null);
  assert.equal(rec.asPlanned, false);
  assert.equal(rec.notes, '');
  assert.equal(rec.signals.length, 0);
  assert.equal(rec.environment, null);
  assert.equal(rec.trainingSignal, null, 'a review of a run that has not happened is a leftover');
});

test('no future-dated record anywhere reports as completed training', () => {
  const a = block();
  acceptOn(futureSession(a));
  const today = a.todayStr();
  assert.ok(!a.athleteMemory(42).some(r => r.date > today && r.completed));
  assert.ok(!a.athleteMemory(42).some(r => r.date > today && r.executionScore != null));
});

test('the baseline layer still counts only sessions that were actually run', () => {
  const before = block().athleteBaselines().sessions;
  const a = block();
  const fut = acceptOn(futureSession(a));
  fut.completed = true;
  fut.actual = { km: fut.km, pace: '3:10', hr: 199, rpe: 10, notes: '' };
  assert.equal(a.athleteBaselines().sessions, before,
    'admitting a decision must not inflate how much training the athlete has done');
});

/* The strongest form of the claim: build two athletes differing ONLY in whether
   the future adjusted day also carries a (necessarily bogus) log, and require
   every downstream judgement to be indistinguishable. This catches a leak
   through any consumer, including ones that read state.days directly rather
   than going through athleteMemory -- which is how the decision engine used to
   pick such a day up. */
test('a bogus future log cannot change a single downstream judgement', () => {
  const shape = contaminate => {
    const a = block();
    const fut = acceptOn(futureSession(a));
    if (contaminate) {
      fut.completed = true;
      fut.actual = { km: fut.km * 3, pace: '3:10', hr: 199, rpe: 10, notes: 'brutal heat, calf tight' };
      fut.coachReview = { version: a.COACH_REVIEW_VERSION, recommendPlanAdjustment: true,
                          trainingSignal: 'overreaching', environment: { severe: true, heatBand: 'extreme' } };
    }
    const dec = a.coachDecision(), pb = a.playbookAssess();
    return JSON.stringify({
      decision: { state: dec.state, score: dec.score, reasons: dec.reasons },
      playbook: { decision: pb.decision, blockedBy: pb.blockedBy },
      block: a.blockEffectiveness(),
      baselines: a.athleteBaselines(),
      trends: (a.athleteTrends() || []).map(t => [t.id, t.direction, t.concept]),
    });
  };
  assert.equal(shape(true), shape(false),
    'training that has not happened must be invisible to every judgement the coach makes');
});

test('an ordinary future session with no decision contributes nothing at all', () => {
  const a = block();
  const fut = futureSession(a);
  assert.ok(fut, 'precondition: the plan has a future session');
  assert.equal(recordFor(a, fut.date), undefined,
    'a session that has not happened and carries no decision is not history');
});

// ---------------------------------------------------------------------------
// 5. PAST BEHAVIOUR IS UNTOUCHED
// ---------------------------------------------------------------------------
test('a past accepted adjustment is remembered exactly as before', () => {
  const a = block();
  const past = a.state.days.filter(d => d.date < a.todayStr() && d.completed).slice(-2)[0];
  const km = past.actual.km, pace = past.actual.pace;
  past.coachAdjust = { at: '2026-03-01T09:00:00Z', reason: 'easing back', evidence: ['e'], state: 'modify' };
  const rec = recordFor(a, past.date);
  assert.ok(rec);
  assert.equal(rec.acceptedAdjustment, true);
  assert.equal(rec.completed, true, 'it was run, and that is still true');
  assert.equal(rec.actualKm, km, 'and its training is still readable');
  assert.ok(rec.actualPace != null, 'including pace');
  assert.equal(rec.asPlanned, false, 'an adjusted session was never "as planned"');
});

test('a part-logged past day keeps the fields it always had', () => {
  const a = block();
  const past = a.state.days.filter(d => d.date < a.todayStr() && d.completed).slice(-1)[0];
  past.completed = false;                       // logged, then un-ticked
  past.coachAdjust = { at: '2026-03-01T09:00:00Z', reason: 'r', evidence: [], state: 'modify' };
  const rec = recordFor(a, past.date);
  assert.ok(rec);
  assert.equal(rec.completed, false, 'not completed, because it is not ticked');
  assert.ok(rec.actualKm != null,
    'but the day HAS happened, so what was logged on it stays readable -- the date gate is about time, not completion');
});

// ---------------------------------------------------------------------------
// 3. KEEPING A SESSION IS RECORDED THE SAME WAY WHATEVER ITS DATE
// ---------------------------------------------------------------------------
test('choosing to keep a session is a UI settlement, not memory evidence -- consistently', () => {
  const a = block();
  const fut = futureSession(a);
  fut.coachKeptAt = '2026-03-11T09:00:00Z';
  assert.equal(recordFor(a, fut.date), undefined,
    'kept is not modelled as memory evidence on a future day');
  const past = a.state.days.filter(d => d.date < a.todayStr() && d.completed).slice(-1)[0];
  past.coachKeptAt = '2026-03-01T09:00:00Z';
  const rec = recordFor(a, past.date);
  assert.ok(rec, 'a past day is in memory for having been run');
  assert.equal(rec.acceptedAdjustment, false,
    'and keeping the session is never counted as accepting an adjustment');
  // The asymmetry that mattered is gone: acceptance no longer depends on the
  // date. Keeping is absent on BOTH sides, so there is nothing date-dependent
  // left to be inconsistent about.
});
