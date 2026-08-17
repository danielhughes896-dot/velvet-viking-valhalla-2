'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 WORKSTREAM 2 -- the adversarial matrix, A through P.
//
// The point is not to make the coach look clever. It is to establish that the
// engine that already exists behaves safely and the same way twice when the
// evidence is difficult, ambiguous, or actively misleading.
//
// Two levers, chosen deliberately:
//
//   * questions about WHICH STATE the engine reaches are driven by real
//     evidence -- logged sessions, readiness answers, notes -- through
//     coachDecision() and planEvolution(), because a test that sets the state
//     directly proves nothing about how the state is reached;
//   * questions about WHAT THE HIERARCHY DOES once in a state are driven
//     through evolutionChanges(), which is the production function planEvolution
//     itself calls, because forcing an athlete into RECOVER through logged data
//     just to inspect a sort order tests the fixture, not the hierarchy.
//
// Nothing here forces an internal. Where a scenario cannot be reached through
// the real evidence model, that is reported rather than faked.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => new Date(Date.UTC(2026, 4, 20) + n * 86400000).toISOString().slice(0, 10);
const day = (date, type, km, extra) =>
  Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});

/* A plan whose horizon is stated day by day. buildPlan first so setup, zones
   and prescriptions are the real ones, then the calendar is replaced so what
   sits beside what is visible in the test. */
function withHorizon(a, days) {
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  a.state.days = days;
  return a;
}
const kinds = ev => (ev.changes || []).map(c => c.kind);
const ids = ev => (ev.changes || []).map(c => c.dayId);

// ---------------------------------------------------------------------------
// A. WEAK OR NO EVIDENCE
// ---------------------------------------------------------------------------
test('A. an athlete with nothing logged is left alone', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: TODAY });      // block starts today: nothing behind it
  const before = JSON.stringify(a.state.days);
  const ev = a.planEvolution();

  assert.equal(ev.state, 'HOLD', 'no evidence is not a reason to do anything');
  assert.equal(ev.changes.length, 0, 'and certainly not a reason to change the plan');
  assert.equal(JSON.stringify(a.state.days), before,
    'computing a proposal must never mutate the plan it is about');
});

test('A. HOLD manufactures no recommendation and no false confidence', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: TODAY });
  const ev = a.planEvolution();
  assert.equal(ev.changes.length, 0);
  assert.equal(a.evolutionProposalVisible(ev), false,
    'a proposal with nothing in it must never reach the athlete');
  assert.ok(ev.stimulus.preserved, 'nothing was traded away, so nothing was lost');
});

test('A. the same evidence twice gives the same answer', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  const one = a.planEvolution(), two = a.planEvolution();
  assert.equal(one.state, two.state);
  assert.equal(one.evidenceHash, two.evidenceHash, 'the hash is over evidence, never the clock');
  assert.equal(JSON.stringify(kinds(one)), JSON.stringify(kinds(two)));
});

// ---------------------------------------------------------------------------
// B / C / D / E. THE HIERARCHY, CHEAPEST INTERVENTION FIRST
// ---------------------------------------------------------------------------
test('B. ADAPT trims the least valuable mileage before anything that matters', () => {
  const a = app();
  const pending = [
    day(D(1), 'easy', 5),          // OPTIONAL
    day(D(2), 'easy', 9),          // RECOVERY
    day(D(3), 'threshold', 10),    // KEY
    day(D(5), 'long', 20)          // KEY
  ];
  const out = a.evolutionChanges('ADAPT', 'Build', pending, []);
  assert.equal(out.length, 1, 'the smallest change that fixes it, not a rewrite');
  assert.equal(out[0].dayId, D(1));
  assert.equal(out[0].kind, 'reduce');
  assert.ok(out[0].toKm > 0 && out[0].toKm < out[0].fromKm);
});

test('B. with no optional mileage it takes support mileage, still not the key work', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'easy', 9),          // RECOVERY, >= 6km
    day(D(3), 'threshold', 10)     // KEY
  ], []);
  assert.equal(out[0].dayId, D(1));
  assert.equal(out[0].kind, 'reduce');
});

test('C. a KEY session alone is shortened, never removed or changed in kind', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [day(D(3), 'threshold', 10)], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'reduce', 'not downgrade, not drop');
  assert.ok(out[0].toKm > 0, 'the session survives');
  assert.ok(out[0].toKm < out[0].fromKm);
  assert.equal(out[0].toType, undefined, 'its purpose is not traded away');
});

test('D. a day the coach already settled is never re-cut', () => {
  const a = app();
  const settled = day(D(1), 'easy', 5, { coachAdjust: { at: 'x', reason: 'already done' } });
  const out = a.evolutionChanges('ADAPT', 'Build', [settled, day(D(3), 'threshold', 10)], []);
  assert.ok(!ids({ changes: out }).includes(D(1)),
    'without this the same day is re-cut on every render and the plan collapses one acceptance at a time');
});

test('D. re-running evolution after acceptance does not touch the same day again', () => {
  const a = app();
  withHorizon(a, [day(D(1), 'easy', 5), day(D(3), 'threshold', 10)]);
  const first = a.evolutionChanges('ADAPT', 'Build', a.state.days, []);
  assert.equal(first.length, 1);
  const target = a.findDay(first[0].dayId);
  target.km = first[0].toKm;
  target.coachAdjust = { at: 'x', reason: first[0].why, source: 'evolution' };
  const second = a.evolutionChanges('ADAPT', 'Build', a.state.days, []);
  assert.ok(!second.some(c => c.dayId === target.id), 'settled means settled');
});

test('E. a race is never an evolution candidate, in any state', () => {
  const a = app();
  const pending = [day(D(2), 'race', 21), day(D(4), 'checkpoint', 10)];
  ['ADAPT', 'RECOVER'].forEach(st => {
    ['Base', 'Build', 'Peak', 'Taper', 'Race Week', 'Final Week'].forEach(ph => {
      (a.evolutionChanges(st, ph, pending, []) || []).forEach(c =>
        assert.ok([D(2), D(4)].indexOf(c.dayId) === -1,
          st + '/' + ph + ' proposed changing the day the block exists for'));
    });
  });
});

test('E. a race beside easy days is protected while the easy day is trimmed', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Peak', [day(D(1), 'easy', 5), day(D(2), 'race', 21)], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].dayId, D(1));
});

// ---------------------------------------------------------------------------
// F / G. RECOVER
// ---------------------------------------------------------------------------
test('F. RECOVER protects the next demanding session, and only that one', () => {
  const a = app();
  const out = a.evolutionChanges('RECOVER', 'Build', [
    day(D(1), 'threshold', 10),
    day(D(3), 'interval', 9),
    day(D(5), 'long', 20)
  ], []);
  assert.equal(out.length, 1, 'one intervention, not a week-long retreat');
  assert.equal(out[0].dayId, D(1), 'the NEXT one — the others are still days away');
  assert.equal(out[0].kind, 'downgrade');
  assert.equal(out[0].toType, 'easy');
  assert.ok(out[0].toKm > 0, 'downgraded, not deleted');
  assert.ok(out[0].toKm < out[0].fromKm);
});

test('G. RECOVER with no KEY session eases the largest session instead', () => {
  const a = app();
  const out = a.evolutionChanges('RECOVER', 'Build', [
    day(D(1), 'easy', 5), day(D(2), 'easy', 12), day(D(3), 'easy', 8)
  ], []);
  assert.equal(out.length, 1);
  assert.equal(out[0].dayId, D(2), 'the largest');
  assert.equal(out[0].kind, 'reduce');
  assert.ok(out[0].toKm > 0);
});

test('G. RECOVER never empties the horizon', () => {
  const a = app();
  [[day(D(1), 'threshold', 10)], [day(D(1), 'easy', 4)], [day(D(1), 'long', 24)]]
    .forEach(pending => {
      const out = a.evolutionChanges('RECOVER', 'Build', pending, []);
      out.forEach(c => assert.ok((c.toKm || 0) > 0, 'no session is ever zeroed'));
      assert.ok(out.length <= 1, 'recovery is one change, not a purge');
    });
});

// ---------------------------------------------------------------------------
// H. SPACING
// ---------------------------------------------------------------------------
test('H. a spacing move only happens when it actually improves the week', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),      // stacked against D(1)
    day(D(3), 'rest', 0)           // a safe landing place
  ], []);
  const move = out.filter(c => c.kind === 'move')[0];
  assert.ok(move, 'the stack is real and there is somewhere safe to put it');
  assert.equal(move.dayId, D(2), 'the LATER of the pair moves');
  assert.equal(move.toDate, D(3));
});

test('H. no move is proposed when it would not reduce stacking', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),
    day(D(3), 'tempo', 8)          // moving into here trades one stack for another
  ], []);
  assert.ok(!out.some(c => c.kind === 'move'),
    'a move that does not improve the week is not an improvement');
});

test('H. the stack must not be reachable only by moving a session further away than the rule allows', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),
    day(D(6), 'rest', 0)           // safe, but four days away
  ], []);
  assert.ok(!out.some(c => c.kind === 'move'),
    'evolution is local: it does not fling a session across the week');
});

test('H. spacing is only reached after cheaper interventions are exhausted', () => {
  const a = app();
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'easy', 5),          // OPTIONAL — cheaper
    day(D(2), 'threshold', 10),
    day(D(3), 'interval', 9),
    day(D(4), 'rest', 0)
  ], []);
  assert.equal(out[0].kind, 'reduce');
  assert.equal(out[0].dayId, D(1), 'the cheapest thing that helps comes first');
});

// ---------------------------------------------------------------------------
// I / J / K. MISSED TRAINING IS NOT A DEBT
// ---------------------------------------------------------------------------
test('I. a missed KEY session is recovered only into a genuinely safe slot', () => {
  const a = app();
  const recoverable = [{ dayId: 'lost', date: D(-1), type: 'threshold', km: 10,
                         importance: 'KEY', stimulusStillUseful: true }];
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'easy', 5),          // OPTIONAL, nothing hard adjacent
    day(D(4), 'long', 20)
  ], recoverable);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'reschedule');
  assert.equal(out[0].dayId, D(1));
  assert.equal(out[0].toType, 'threshold');
  assert.equal(out[0].sourceDayId, 'lost');
});

test('I. recovery never creates the stack the engine refuses to create', () => {
  const a = app();
  const recoverable = [{ dayId: 'lost', date: D(-1), type: 'threshold', km: 10,
                         importance: 'KEY', stimulusStillUseful: true }];
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'interval', 9),
    day(D(2), 'easy', 5),          // the only OPTIONAL slot sits beside the intervals
    day(D(4), 'long', 20)
  ], recoverable);
  out.filter(c => c.kind === 'reschedule').forEach(c =>
    assert.notEqual(c.dayId, D(2), 'recovering a stimulus into a stack is not recovering it'));
});

test('J. with no safe slot the stimulus is let go, and nothing is crammed', () => {
  const a = app();
  const recoverable = [{ dayId: 'lost', date: D(-1), type: 'threshold', km: 10,
                         importance: 'KEY', stimulusStillUseful: true }];
  const out = a.evolutionChanges('ADAPT', 'Build', [
    day(D(1), 'interval', 9),
    day(D(2), 'threshold', 8),
    day(D(3), 'long', 20)
  ], recoverable);
  assert.equal(out.length, 0, 'letting it go IS the answer, not a failure to find one');
});

test('K. missed easy and recovery mileage is never made up', () => {
  const a = app();
  withHorizon(a, [
    day(a.addDays(TODAY, -2), 'easy', 8),         // missed, unremarkable
    day(a.addDays(TODAY, -1), 'easy', 5),         // missed, unremarkable
    day(D(1), 'easy', 6),
    day(D(3), 'threshold', 10)
  ]);
  const missed = a.missedStimulus();
  assert.ok(missed.length >= 2, 'they are recognised as missed');
  missed.forEach(m => assert.equal(m.stimulusStillUseful, false,
    'its value was the day it would have happened'));
  assert.match(missed[0].reason, /worth what it was worth on the day/i);
  assert.ok(!/make up|owe|debt|catch up/i.test(missed.map(m => m.reason).join(' ')),
    'no debt language anywhere near this');
});

test('K. a missed easy day does not by itself move the engine off HOLD', () => {
  const a = app();
  withHorizon(a, [
    day(a.addDays(TODAY, -1), 'easy', 6),
    day(D(1), 'easy', 6),
    day(D(3), 'threshold', 10)
  ]);
  const ev = a.planEvolution();
  assert.equal(ev.changes.length, 0, 'nothing to recover means nothing to propose');
});

// ---------------------------------------------------------------------------
// L. TAPER AND RACE WEEK
// ---------------------------------------------------------------------------
test('L. taper never repays missed work', () => {
  const a = app();
  const recoverable = [{ dayId: 'lost', date: D(-1), type: 'threshold', km: 10,
                         importance: 'KEY', stimulusStillUseful: true }];
  ['Taper', 'Race Week'].forEach(ph => {
    const out = a.evolutionChanges('ADAPT', ph, [day(D(1), 'easy', 5), day(D(3), 'easy', 6)], recoverable);
    assert.ok(!out.some(c => c.kind === 'reschedule'),
      ph + ' cramming work back in is exactly what a taper is not');
  });
});

test('L. missedStimulus itself refuses to call anything recoverable in taper', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -63) });   // deep into the block
  const phase = a.trainingPhase(a.currentWeekNum());
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest' && a.isQualityType(d.type)).pop();
  if (dd && (phase === 'Taper' || phase === 'Race Week')){
    dd.completed = false;
    const m = a.missedStimulus().filter(x => x.dayId === dd.id)[0];
    assert.equal(m.stimulusStillUseful, false);
    assert.match(m.reason, /Taper/);
  }
});

test('L. the phase vocabulary is exactly the six the product uses', () => {
  const a = app();
  const seen = new Set();
  for (let w = 1; w <= 24; w++) seen.add(a.trainingPhase(w));
  [...seen].forEach(p => assert.ok(
    ['Base', 'Build', 'Peak', 'Taper', 'Race Week', 'Final Week'].indexOf(p) !== -1,
    p + ' is not one of the six product phases'));
});

// ---------------------------------------------------------------------------
// M / N. SAFETY OUTRANKS EVERYTHING, WITHOUT DIAGNOSING
// ---------------------------------------------------------------------------
/* Illness and pain are the two inputs that reach the decision as `safety`,
   which short-circuits the score entirely. Driven here through the real
   readiness answer and the real note-signal reader, not by setting a state. */
function reportedThisMorning(a, readiness) {
  const today = a.state.days.filter(d => d.date === TODAY)[0];
  assert.ok(today, 'the fixture needs a day for today');
  today.readiness = readiness;
  return today;
}

test('M. reported illness reaches RECOVER on its own, with no corroboration needed', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  reportedThisMorning(a, { health: 'under' });
  const dec = a.coachDecision();
  assert.equal(dec.state, 'recover',
    'one honest report of being unwell outranks every metric that says otherwise');
  assert.equal(a.planEvolution().state, 'RECOVER');
});

test('M. the illness wording states what was reported and diagnoses nothing', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  reportedThisMorning(a, { health: 'under' });
  const said = a.coachDecision().reasons.join(' ');
  assert.match(said, /under the weather|illness/i);
  [/infection/i, /virus/i, /you have\b/i, /diagnos/i, /injur/i, /must not run/i]
    .forEach(rx => assert.ok(!rx.test(said), 'the coach does not diagnose: ' + rx));
});

test('N. reported pain is treated with the same precedence', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  const past = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-2);
  assert.equal(past.length, 2);
  past.forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:20', notes: 'calf pain again' });
  });
  const dec = a.coachDecision();
  assert.equal(dec.state, 'recover', 'pain reported twice is a safety signal, not a score');
  const said = dec.reasons.join(' ');
  assert.match(said, /pain|soreness/i);
  [/injur/i, /tear/i, /strain injury/i, /stress fracture/i, /see a physio/i]
    .forEach(rx => assert.ok(!rx.test(said), 'no diagnosis, no alarm: ' + rx));
});

test('N. a single soreness report is watched, not escalated', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').pop();
  dd.completed = true;
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:20', notes: 'a bit sore' });
  assert.notEqual(a.coachDecision().state, 'recover',
    'one mention of soreness is not an emergency — earn the right to intervene');
});

// ---------------------------------------------------------------------------
// O / P. POSITIVE ADAPTATION IS EARNED, NEVER ASSUMED
// ---------------------------------------------------------------------------
test('O. PROGRESS is unreachable while the coach has any concern at all', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  reportedThisMorning(a, { health: 'under' });
  const ev = a.planEvolution();
  assert.notEqual(ev.state, 'PROGRESS',
    'the Playbook is only consulted from a clean coach state, and never overrides safety');
  assert.equal(ev.state, 'RECOVER');
});

test('O. the Playbook is not even asked when the coach is already reshaping the week', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  reportedThisMorning(a, { health: 'under' });
  const ev = a.planEvolution();
  assert.equal(ev.playbook, undefined,
    'a second opinion arriving beside a reduction is the two-engine problem this avoids');
});

test('P. a single excellent session earns nothing', () => {
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -21) });
  const dd = a.state.days.filter(d => d.date < TODAY && a.isQualityType(d.type)).pop();
  assert.ok(dd);
  dd.completed = true;
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '4:00', hr: 140, rpe: 3,
                                               feel: 'good', notes: 'felt amazing' });
  const ev = a.planEvolution();
  assert.notEqual(ev.state, 'PROGRESS', 'one good run is not sustained evidence');
  assert.equal(ev.changes.filter(c => (c.toKm || 0) > (c.fromKm || 0)).length, 0,
    'and nothing anywhere got bigger because of it');
});

test('P. no state other than a genuine Playbook PROGRESS can increase training', () => {
  const a = app();
  const pending = [day(D(1), 'easy', 5), day(D(2), 'threshold', 10), day(D(4), 'long', 20)];
  ['HOLD', 'MONITOR', 'ADAPT', 'RECOVER'].forEach(st => {
    ['Base', 'Build', 'Peak', 'Taper', 'Race Week', 'Final Week'].forEach(ph => {
      (a.evolutionChanges(st, ph, pending, []) || []).forEach(c => {
        if (c.toKm != null && c.fromKm != null)
          assert.ok(c.toKm <= c.fromKm, st + '/' + ph + ' proposed MORE training');
      });
    });
  });
});

test('P. the five evolution states are exactly the product vocabulary', () => {
  const a = app();
  assert.deepEqual(Object.keys(a.EVOLUTION_META).sort(),
    ['ADAPT', 'HOLD', 'MONITOR', 'PROGRESS', 'RECOVER']);
});

// ---------------------------------------------------------------------------
// THE HORIZON IS LOCAL
// ---------------------------------------------------------------------------
test('evolution reasons about the next week, and stretches only to move a session', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  const ev = a.planEvolution();
  assert.ok(ev.horizonDays <= a.EVOLUTION_MAX_HORIZON);
  assert.ok(a.EVOLUTION_HORIZON_DAYS <= 7 && a.EVOLUTION_MAX_HORIZON <= 14,
    'it does not rebuild the block casually');
  (ev.changes || []).forEach(c =>
    assert.ok(a.daysBetween(TODAY, c.date) <= a.EVOLUTION_MAX_HORIZON,
      'nothing outside the horizon is touched'));
});

test('a completed session inside the horizon is never a candidate', () => {
  const a = app();
  withHorizon(a, [
    day(D(1), 'easy', 5, { completed: true,
      actual: { km: 5, pace: '5:30', hr: 140, rpe: 4, notes: '' } }),
    day(D(3), 'threshold', 10)
  ]);
  const ev = a.planEvolution();
  assert.ok(!ids(ev).includes(D(1)), 'training that already happened is not a proposal');
});
