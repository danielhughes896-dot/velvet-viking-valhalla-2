'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// THE DEFECT, and it is reachable in production rather than hypothetical.
//
// stravaWriteActivity() does two things: it calls applyCompletion(dd, true) and
// it stamps dd.stravaActivityId. Since Phase 3, applyCompletion REFUSES a day
// dated in the future -- rightly, because a session that has not happened
// cannot have happened. But stravaWriteActivity carries on past that refusal
// and stamps the attachment and the actuals anyway.
//
// So a run recorded just past midnight, or on a device whose clock disagrees,
// or across a timezone boundary, lands as:
//
//     completed          = false     (applyCompletion refused it)
//     stravaActivityId   = set       (the run genuinely happened)
//     actual             = populated
//
// The next day that session is in the past, and it is a real run with real
// data attached. sessionRan() -- the canonical answer to "did this happen" --
// says yes. dayStatusLabel() already asks it, so the card reads correctly.
//
// missedStimulus() did not ask it. It read raw !dd.completed, so Plan Evolution
// saw a KEY quality session it believed had never happened, called its stimulus
// still useful, and could propose rescheduling a threshold session the athlete
// had already run. The athlete is shown the session as done on one screen and
// offered it again on another.
//
// athleteMemory() had the same raw rule from the same cause, in two places:
// admission, and the `ran` gate on every performed field. The consequence is
// quieter and worse -- a genuinely performed session contributing nothing to
// baselines, trends, Block Intelligence or the Playbook.
//
// These tests reproduce the failure through the production decision path, not
// by asserting one internal line.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });

/* A real plan from the real generator, then the exact state the Strava path
   leaves behind on a day whose completion was refused for being future-dated
   and which has since become the past. Nothing is hand-forged that the app
   does not itself write. */
function planWithStravaOnlyQualityDay(a, opts) {
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28), distanceKey: '10k' });
  /* THE LAST TWO WEEKS, not the last one -- a week is the period a quality
     exposure is prescribed in, but this 10K fixture's own rotation alternates
     family week to week (an interval week, a tempo week), so one week does
     not reliably contain a KEY one. Fourteen days does.

     AND A KEY ONE SPECIFICALLY -- sessionImportance() classifies tempo as
     SUPPORT (unrelated to this correction, a pre-existing rule), and
     isQualityType() alone admits tempo days too, so this needs the narrower
     filter directly rather than relying on whichever family the quality
     rotation happens to land on last in the window. */
  const past = a.state.days.filter(d =>
    d.date < TODAY && d.date >= a.addDays(TODAY, -14) &&
    ['threshold', 'interval', 'repetition'].indexOf(d.type) !== -1);
  assert.ok(past.length, 'the fixture needs a recent KEY quality day to work with');
  const dd = past[past.length - 1];

  dd.completed = false;                       // applyCompletion refused it
  dd.stravaActivityId = '99887766';           // ...but the attachment was written
  dd.actual = Object.assign(a.emptyActual(), {
    km: dd.km, pace: '4:40', hr: 152, movingTimeSec: 2400,
    activityType: 'Run'
  }, (opts && opts.actual) || {});
  return dd;
}

// ---------------------------------------------------------------------------
// 1. MISSED STIMULUS
// ---------------------------------------------------------------------------
test('a KEY quality session with Strava evidence is not missed stimulus', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  assert.equal(a.sessionImportance(dd), 'KEY', 'the fixture must be a KEY session or it proves nothing');
  assert.equal(a.sessionRan(dd), true, 'the canonical authority already knows this happened');

  const missed = a.missedStimulus();
  const entry = missed.filter(m => m.dayId === dd.id)[0];
  assert.equal(entry, undefined,
    'a session the athlete actually ran must not appear in missed training at all');
});

test('its stimulus is never proposed for recovery', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  const recoverable = a.missedStimulus().filter(m => m.stimulusStillUseful);
  assert.ok(!recoverable.some(m => m.dayId === dd.id),
    'offering a threshold session back to an athlete who already ran it is the whole defect');
});

test('Plan Evolution does not move or recreate a session that already happened', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  const ev = a.planEvolution();
  if (!ev) return;   // no decision to make is a legitimate outcome
  (ev.changes || []).forEach(c => {
    assert.notEqual(c.dayId, dd.id, 'the completed session must not be reshaped');
    assert.notEqual(c.sourceDayId, dd.id,
      'and its stimulus must not be rescheduled onto another day');
  });
});

test('a genuinely missed KEY session is still recovered — the fix narrows, it does not disable', () => {
  /* PINNED THREE DAYS LATER THAN THE REST OF THE FILE, and only here.
     missedStimulus() looks back a few days, not a full week, so the session it
     is offered has to have been prescribed inside that window. A week now
     carries one earned quality exposure rather than two granted by day count,
     and on this schedule the surviving one falls just outside the look-back
     from the file's own TODAY -- so the fixture stopped producing the case at
     all. Moving this ONE fixture's clock puts an ordinary KEY interval back
     inside the window. The look-back is unchanged, the assertion is unchanged,
     and no other test in the file is affected. */
  const LATER = '2026-05-23';
  const a = loadApp({ pinnedDate: LATER + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 10, startDate: a.addDays(LATER, -28), distanceKey: '10k' });
  const past = a.state.days.filter(d =>
    d.date < LATER && d.date >= a.addDays(LATER, -4) &&
    d.type !== 'rest' && a.isQualityType(d.type));
  assert.ok(past.length, 'the fixture needs a recent KEY quality session to miss');
  const dd = past[past.length - 1];
  dd.completed = false;
  delete dd.stravaActivityId;                 // nothing says this happened

  const entry = a.missedStimulus().filter(m => m.dayId === dd.id)[0];
  assert.ok(entry, 'a KEY session with no evidence of having happened is still missed');
  assert.equal(entry.importance, 'KEY');
});

test('the two screens agree about the same day', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  const label = a.dayStatusLabel(dd);
  assert.ok(!/Missed/.test(label), 'the card does not call it missed');
  assert.ok(!a.missedStimulus().some(m => m.dayId === dd.id),
    'so the coach must not either — one authority, one answer');
});

test('missed stimulus still ignores rest days and days still ahead', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  const missed = a.missedStimulus();
  missed.forEach(m => {
    assert.notEqual(m.type, 'rest', 'a rest day cannot be missed training');
    assert.ok(m.date < TODAY, 'a day that has not arrived cannot have been missed');
  });
});

// ---------------------------------------------------------------------------
// 2. ATHLETE MEMORY
// ---------------------------------------------------------------------------
test('a performed session reaches the evidence record', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  const rec = a.athleteMemory(120).filter(r => r.date === dd.date)[0];
  assert.ok(rec, 'a session the athlete ran must be admitted to the record at all');
  assert.equal(rec.completed, true, 'and recorded as performed, because it was');
  assert.equal(rec.actualKm, dd.actual.km);
  assert.ok(rec.actualPace != null, 'its pace is real data and belongs in the baselines');
  assert.equal(rec.hr, 152, 'and so is its heart rate');
});

test('its objective data reaches the baselines it belongs in', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  const b = a.baselineFor(a.athleteMemory(120).filter(r => r.date === dd.date));
  assert.equal(b.sessions, 1);
  assert.equal(b.completionRate, 100,
    'a completion rate that counts a real run as a miss is a wrong number about the athlete');
});

/* A BOUNDARY THAT IS DELIBERATE, PINNED HERE SO IT STAYS DELIBERATE.
   computeExecutionBreakdown() and coachCompletedScored() keep their own
   `dd.completed` gate, so this session is admitted to the record and to the
   objective baselines, and contributes no Execution Score.
   That is not an oversight and it is not this workstream's to change: the
   Execution Score is what the Playbook, coachTrend and Block Intelligence
   learn from, so widening its admission changes what the coach believes about
   the athlete -- a change that needs the adversarial pass, not a correctness
   one. What this test guarantees is that the boundary cannot move by accident
   in either direction. */
test('the Execution Score layer keeps its narrower gate, on purpose', () => {
  const a = app();
  const dd = planWithStravaOnlyQualityDay(a);
  assert.equal(a.computeExecutionScore(dd), null,
    'scoring still requires the completion flag — recorded, not accidental');
  const rec = a.athleteMemory(120).filter(r => r.date === dd.date)[0];
  assert.equal(rec.executionScore, null);
  assert.equal(rec.asPlanned, false,
    'and "it went as written" cannot be claimed without the score that would show it');
});

test('a day still ahead is never training, whatever it carries', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  const future = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest')[0];
  future.completed = true;                     // incoherent, and the point
  future.stravaActivityId = '123';
  future.actual = Object.assign(a.emptyActual(), { km: future.km, pace: '4:40' });

  const rec = a.athleteMemory(120).filter(r => r.date === future.date)[0];
  if (rec){
    assert.equal(rec.completed, false, 'it has not happened');
    assert.equal(rec.executionScore, null);
    assert.equal(rec.actualPace, null);
  }
});

test('rest days keep their own narrower admission rule', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  const rest = a.state.days.filter(d => d.type === 'rest' && d.date < TODAY)[0];
  assert.ok(rest);
  assert.ok(!a.athleteMemory(120).some(r => r.date === rest.date),
    'a rest day with nothing on it is not evidence');
  rest.athleteState = { state: 'check', score: 3, reasons: [], at: 'x' };
  assert.ok(a.athleteMemory(120).some(r => r.date === rest.date),
    'but the morning after a long run is exactly when heavy legs get reported');
});

test('an accepted adjustment is still remembered even for a session still ahead', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  const future = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest')[0];
  future.coachAdjust = { reason: 'test', evidence: [], at: 'x' };
  const rec = a.athleteMemory(120).filter(r => r.date === future.date)[0];
  assert.ok(rec, 'the decision the athlete made is history even when the session is not');
  assert.equal(rec.acceptedAdjustment, true);
  assert.equal(rec.completed, false, 'while the training itself still has not happened');
});

test('an ordinary hand-logged session is unaffected', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').pop();
  dd.completed = true;
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:10', rpe: 5 });
  const rec = a.athleteMemory(120).filter(r => r.date === dd.date)[0];
  assert.ok(rec);
  assert.equal(rec.completed, true);
  assert.equal(rec.rpe, 5);
});

// ---------------------------------------------------------------------------
// ONE AUTHORITY, NOT THREE
// ---------------------------------------------------------------------------
test('no consumer keeps a competing definition of whether a session happened', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const body = fn => {
    const at = src.indexOf('function ' + fn + '(');
    assert.ok(at !== -1, fn + ' not found');
    return src.slice(at, src.indexOf('\n}', at));
  };
  /* athleteMemoryFromDays rather than athleteMemory: the year-round programme
     split the memory into "WHICH days" (athleteMemory, which now also reaches
     the athlete's archived sessions) and "what each day MEANS"
     (athleteMemoryFromDays, the original body, unchanged). The authority
     question lives in the interpretation, so that is where it is asserted --
     the invariant is identical and only the function holding it moved. */
  ['missedStimulus', 'athleteMemoryFromDays'].forEach(fn => {
    assert.match(body(fn), /sessionRan\(/,
      fn + ' must ask the canonical authority rather than re-deriving the answer');
  });
  /* And the archive must not become a second definition. It files whatever the
     interpretation produced and never decides for itself what happened. */
  assert.doesNotMatch(body('archiveCompletedSessions'), /sessionRan\(|dd\.completed/,
    'archiveCompletedSessions has grown its own opinion about whether a session happened');
});
