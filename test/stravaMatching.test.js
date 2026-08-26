'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* WHICH RUN WAS THE SESSION — AND WHEN VALHALLA REFUSES TO SAY
 * ===========================================================================
 * A WRONG AUTOMATIC MATCH IS WORSE THAN NO MATCH. It does not merely mislabel
 * a day: it feeds a fabricated execution score into the Playbook, the trend
 * and the block read, and the coach then reasons from an athlete who failed a
 * session they never ran. Leaving the day alone costs the athlete one tap.
 *
 * So every rule below is a refusal, and the tests are written from the
 * refusal's point of view. The matcher is allowed to be conservative and
 * wrong-in-the-safe-direction; it is not allowed to guess.
 *
 * PLAUSIBILITY IS NOT QUALITY. Distance is used only to ask "could this
 * activity BE that session?" -- never "was it executed well?". That judgement
 * belongs to the Execution Score, which must stay free to say the session went
 * badly. Hence a band wide enough that ordinary under-completion still matches.
 */

const TODAY = '2026-08-24';           // a Monday
const START = '2026-08-03';           // three weeks earlier, so the plan has a past
const at = (a, date) => a.state.days.filter(d => d.date === date)[0];

/* THE BLOCK IS ALREADY UNDER WAY, deliberately. A plan that starts today has
   no past, and applyCompletion() refuses a future-dated day -- so every test
   about what an import DOES to a session would silently assert nothing. The
   sessions used below are real, prescribed, already-run days. */
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 10, startDate: START, distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  return a;
}

/* A run, in the shape the server stages it. Deliberately built from the same
   normaliseActivity() output shape the real ingest path carries. */
function run(over){
  return Object.assign({
    activityId: '1001', date: TODAY, isRun: true, km: 10,
    movingTimeSec: 3000, elapsedTimeSec: 3050, paceSecPerKm: 300,
    hr: null, maxHR: null, cadence: null, elevationGainM: 12,
    activityType: 'Run', trainer: false, manual: false
  }, over || {});
}

/* A real prescribed session that has already happened, so a test can talk
   about "the session" without hard-coding what the generator chose. */
function plannedDay(a){
  const d = a.state.days.filter(x => x.type !== 'rest' && x.km > 0 && x.date < TODAY)[0];
  assert.ok(d, 'the fixture produced no past prescribed session');
  return d;
}

// ---------------------------------------------------------------------------
// THE DATE IS AN IDENTITY, NOT A HINT
// ---------------------------------------------------------------------------
test('a run on a date the plan does not cover matches nothing', () => {
  const a = app();
  assert.equal(a.stravaMatchDay(run({ date: '2019-01-01' })), null);
  assert.equal(a.stravaRefusalReason(run({ date: '2019-01-01' })), 'no_plan_day_on_date');
});

test('a run on a rest day is not evidence about the rest day', () => {
  const a = app();
  const rest = a.state.days.filter(d => d.type === 'rest')[0];
  assert.ok(rest, 'the fixture has no rest day');
  assert.equal(a.stravaMatchDay(run({ date: rest.date })), null);
  assert.equal(a.stravaRefusalReason(run({ date: rest.date })), 'rest_day');
});

test('nothing is read from the activity title', () => {
  /* A title is prose, and prose is not evidence. An activity called
     "Threshold 6x1k" must not out-argue its own distance. */
  const a = app();
  const d = plannedDay(a);
  const tiny = run({ date: d.date, km: 0.4, name: 'Threshold 6x1k' });
  const res = a.stravaIngestActivities([tiny]);
  assert.equal(res.applied, 0, 'a title talked its way onto a session');
  assert.equal(a.stravaRefusalReason(tiny), 'implausible_distance');
});

// ---------------------------------------------------------------------------
// PLAUSIBILITY
// ---------------------------------------------------------------------------
test('an under-completed session still matches — that is the score\'s job to judge', () => {
  const a = app();
  const d = plannedDay(a);
  const short = run({ date: d.date, km: Math.round(d.km * 0.7 * 10) / 10 });
  assert.equal(a.stravaPlausible(d, short), true,
    'abandoning a session early must not make it a different session');
  const res = a.stravaIngestActivities([short]);
  assert.equal(res.applied, 1);
  assert.equal(at(a, d.date).actual.km, short.km, 'what was actually run was not recorded');
});

test('a jog is not the session, however right the date is', () => {
  const a = app();
  const d = plannedDay(a);
  const jog = run({ date: d.date, km: Math.round(d.km * 0.3 * 10) / 10 });
  assert.equal(a.stravaPlausible(d, jog), false);
  const res = a.stravaIngestActivities([jog]);
  assert.equal(res.applied, 0, 'a shakeout was scored as the workout');
  assert.equal(at(a, d.date).completed, false, 'the day was completed by a run that was not it');
});

test('a warm-up and cool-down do not disqualify a short prescription', () => {
  /* The +3km absolute allowance. A 5km interval session recorded door-to-door
     is routinely 8km, and refusing it would refuse the commonest real case. */
  const a = app();
  const d = plannedDay(a);
  const withWuCd = run({ date: d.date, km: d.km + 2.5 });
  assert.equal(a.stravaPlausible(d, withWuCd), true);
});

test('a day with no prescribed distance is not judged on distance', () => {
  const a = app();
  const d = plannedDay(a);
  const free = Object.assign({}, d, { km: 0 });
  assert.equal(a.stravaPlausible(free, run({ km: 22 })), true,
    'a rule with nothing to compare against must not invent a refusal');
});

// ---------------------------------------------------------------------------
// MORE THAN ONE RUN THAT DAY
// ---------------------------------------------------------------------------
test('two credible runs on one day are left for the athlete, not guessed between', () => {
  const a = app();
  const d = plannedDay(a);
  const res = a.stravaIngestActivities([
    run({ activityId: '2001', date: d.date, km: d.km }),
    run({ activityId: '2002', date: d.date, km: d.km + 0.2 })
  ]);
  assert.equal(res.applied, 0, 'Valhalla guessed which run was the session');
  assert.equal(res.ambiguous, 2);
  assert.equal(at(a, d.date).completed, false);
  assert.equal(at(a, d.date).stravaActivityId, undefined, 'an ambiguous day was attached anyway');
});

test('an ambiguous day is left PENDING so a later answer can still resolve it', () => {
  /* Not acknowledged. Acknowledging would retire the staged rows and the date
     could never be resolved by a regenerated plan or a manual log. */
  const a = app();
  const d = plannedDay(a);
  const res = a.stravaIngestActivities([
    run({ activityId: '2001', date: d.date, km: d.km }),
    run({ activityId: '2002', date: d.date, km: d.km + 0.2 })
  ]);
  /* Length, not deepEqual: the app runs in a VM sandbox, so its arrays carry a
     different realm's prototype and a strict deep comparison fails on that
     alone rather than on the contents. */
  assert.equal(res.ack.length, 0, 'an unresolved day was acknowledged and thrown away');
});

test('one clearly closer run wins over an implausible companion', () => {
  const a = app();
  const d = plannedDay(a);
  const res = a.stravaIngestActivities([
    run({ activityId: '3001', date: d.date, km: d.km }),        // the session
    run({ activityId: '3002', date: d.date, km: 1.2 })          // a dog walk
  ]);
  assert.equal(res.applied, 1, 'the obvious session was not attached');
  assert.equal(at(a, d.date).stravaActivityId, '3001');
});

test('delivery order cannot change the outcome', () => {
  /* Strava delivers in whatever order it likes, and a matcher whose answer
     depends on that is a matcher that gives two athletes different histories
     for the same day. */
  const d0 = plannedDay(app());
  const pair = [
    run({ activityId: '4001', date: d0.date, km: d0.km }),
    run({ activityId: '4002', date: d0.date, km: 1.1 })
  ];
  const forward = app(), backward = app();
  forward.stravaIngestActivities(pair.slice());
  backward.stravaIngestActivities(pair.slice().reverse());
  assert.equal(at(forward, d0.date).stravaActivityId, at(backward, d0.date).stravaActivityId);
  assert.equal(at(forward, d0.date).actual.km, at(backward, d0.date).actual.km);
});

// ---------------------------------------------------------------------------
// THE ATHLETE'S OWN RECORD OUTRANKS AN IMPORT
// ---------------------------------------------------------------------------
test('hand-logged numbers are kept, and the refusal is reported rather than silent', () => {
  const a = app();
  const d = plannedDay(a);
  a.applyCompletion(d, true);
  d.actual = Object.assign(a.emptyActual(), { km: d.km + 4.4, pace: '5:30', rpe: 7 });
  const mine = JSON.stringify(d.actual);

  const res = a.stravaIngestActivities([run({ date: d.date, km: d.km })]);
  assert.equal(res.conflict, 1, 'an overwrite was not reported as a conflict');
  assert.equal(res.applied, 0);
  assert.equal(JSON.stringify(at(a, d.date).actual), mine, 'the athlete\'s own log was overwritten');
});

test('merely ticking a day off is not a log, and Strava may replace the assumption', () => {
  /* applyCompletion() puts the PLANNED distance on a ticked day as an
     assumption. Treating that as the athlete's own record would mean a tick
     permanently blocked what they actually ran. */
  const a = app();
  const d = plannedDay(a);
  a.applyCompletion(d, true);
  assert.equal(a.stravaHasManualObjective(d), false, 'a tick was mistaken for a log');

  const res = a.stravaIngestActivities([run({ date: d.date, km: d.km - 1.1, paceSecPerKm: 318 })]);
  assert.equal(res.applied, 1);
  assert.equal(at(a, d.date).actual.km, d.km - 1.1, 'the real distance did not replace the assumption');
});

test('an import never writes anything subjective', () => {
  /* Strava has no opinion about how a run felt, and a fast pace is not
     evidence of a good day. RPE, Feel and notes stay the athlete's. */
  const a = app();
  const d = plannedDay(a);
  const res = a.stravaIngestActivities([run({ date: d.date, km: d.km })]);
  assert.equal(res.applied, 1);
  const A = at(a, d.date).actual;
  assert.ok(A.rpe == null, 'an effort rating was invented');
  assert.ok(A.feel == null, 'a feeling was invented');
  assert.ok(!A.notes, 'notes were written on the athlete\'s behalf');
});

// ---------------------------------------------------------------------------
// REPEATS, REPLAYS AND CORRECTIONS
// ---------------------------------------------------------------------------
test('re-importing the same run changes nothing and creates nothing', () => {
  const a = app();
  const d = plannedDay(a);
  const one = run({ date: d.date, km: d.km });
  assert.equal(a.stravaIngestActivities([one]).applied, 1);
  const after = JSON.stringify(at(a, d.date));

  const again = a.stravaIngestActivities([one]);
  assert.equal(again.applied, 0, 'a replay wrote the day a second time');
  assert.equal(again.same, 1, 'a replay was not recognised as already-ingested');
  assert.equal(JSON.stringify(at(a, d.date)), after, 'a replay mutated the day');
});

test('the incumbent keeps the day unless a later run is genuinely better', () => {
  /* Otherwise the athlete's log jumps around every time another activity
     arrives, for no gain. */
  const a = app();
  const d = plannedDay(a);
  a.stravaIngestActivities([run({ activityId: '5001', date: d.date, km: d.km })]);
  a.stravaIngestActivities([run({ activityId: '5002', date: d.date, km: d.km + 0.1 })]);
  assert.equal(at(a, d.date).stravaActivityId, '5001', 'a marginally closer run stole the day');
});

test('a corrected activity updates the day it already owns', () => {
  const a = app();
  const d = plannedDay(a);
  a.stravaIngestActivities([run({ activityId: '6001', date: d.date, km: d.km })]);
  const fixed = a.stravaIngestActivities([
    run({ activityId: '6001', date: d.date, km: d.km + 1.3, paceSecPerKm: 310 })]);
  assert.equal(fixed.applied, 1, 'a correction was ignored');
  assert.equal(at(a, d.date).actual.km, d.km + 1.3);
  assert.equal(at(a, d.date).stravaActivityId, '6001', 'a correction created a second attachment');
});

// ---------------------------------------------------------------------------
// THE EXECUTION REVIEW HANDOFF
// ---------------------------------------------------------------------------
test('an imported run without heart rate is scored on what IS known', () => {
  /* KNOWN / UNKNOWN / NOT APPLICABLE. Most athletes have never recorded a
     heart rate, and withholding one must not lower a score -- the weights are
     renormalised over the components that produced one. */
  const a = app();
  const d = plannedDay(a);
  a.stravaIngestActivities([run({ date: d.date, km: d.km, hr: null, maxHR: null })]);
  const dd = at(a, d.date);
  assert.equal(dd.completed, true, 'an imported past session was not confirmed');
  const b = a.computeExecutionBreakdown(dd);
  assert.ok(b, 'distance and pace were imported and still produced no score');
  const missing = b.missing.map(p => p.key);
  assert.ok(missing.includes('hr'), 'an absent heart rate was not declared missing');
  assert.ok(b.counted.some(p => p.key === 'distance'), 'imported distance did not count');
  assert.ok(b.counted.some(p => p.key === 'pace'), 'imported pace did not count');
  b.counted.forEach(p => assert.notEqual(p.score, null));
});

test('an absent heart rate is never scored as a bad one', () => {
  const a = app();
  const d = plannedDay(a);
  a.stravaIngestActivities([run({ date: d.date, km: d.km })]);
  const dd = at(a, d.date);
  assert.equal(a.computeHRScore(dd, dd.actual.hr), null,
    'a missing heart rate produced a number');
});

test('an unmatched run leaves the day invisible to every downstream reader', () => {
  /* Nothing attached means nothing to see: no completion, no actuals, no
     score, and no evidence reaching the coaching layer. */
  const a = app();
  const d = plannedDay(a);
  const before = JSON.stringify(at(a, d.date));
  a.stravaIngestActivities([run({ date: d.date, km: 0.5 })]);
  assert.equal(JSON.stringify(at(a, d.date)), before, 'a refused run still touched the day');
  assert.equal(a.computeExecutionScore(at(a, d.date)), null);
});

// ---------------------------------------------------------------------------
// WHAT THE SERVER IS TOLD ABOUT THE DECISION
// ---------------------------------------------------------------------------
test('refusals are reported as fixed codes and nothing about the athlete', () => {
  const a = app();
  const d = plannedDay(a);
  const list = [run({ activityId: '9001', date: '2019-01-01' }),
                run({ activityId: '9002', date: d.date, km: 0.4 })];
  const res = a.stravaIngestActivities(list);
  const reasons = a.stravaRefusalReasons(list, res);
  Object.keys(reasons).forEach(k => {
    assert.match(k, /^[a-z_]{1,32}$/, 'a refusal reason is not a fixed code: ' + k);
    assert.equal(typeof reasons[k], 'number');
  });
  assert.ok(Object.keys(reasons).length > 0, 'refusals were not reported at all');
});
