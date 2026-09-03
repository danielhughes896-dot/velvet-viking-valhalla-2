'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// YEAR-ROUND LIFECYCLE — THE WHOLE SEASON, NOT ONE BLOCK.
//
// yearRound.test.js proves each engine part in isolation. This drives the
// athlete through the transitions between them, because that is where a
// year-round product actually breaks: not in a recovery block, but in the
// handover from a race to it, and from it to whatever comes next.
//
// Every path below ends somewhere. "No dead end" is the property under test as
// much as any individual recommendation, so each campaign asserts that Valhalla
// still has something to say at the end of it.

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-08-21T09:00:00Z';
const SCHEDULE = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };

function app(){
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  a.renderApp = () => {};
  a.confirm = () => true;
  return a;
}

/* An athlete mid-way through a race block, with real logged training behind
   them -- built through the real generator so nothing is hand-forged. */
function racingAthlete(opts){
  const o = opts || {};
  const a = app();
  /* HQ NARROW PATHWAY CORRECTION -- experience is passed explicitly where a
     caller asks for it (opts.experience). The implicit (unnamed) default
     resolves to 'experienced', whose own Half entry HQ's directive dropped
     30 -> 20km; only the one test whose fixture needs the pre-correction
     shape back (the 'builder still builds a race block' mutation check)
     asks for 'advanced', whose own entry (45) did not move. Every other
     caller is unaffected -- in particular the volume-qualification safety
     test below, which specifically needs the DEFAULT, moderate-capacity
     athlete this fixture always described. */
  if (o.experience){ a.state = a.makeDefaultState(); a.state.experience = o.experience; }
  buildPlan(a, { weeks: o.weeks || 14, startDate: a.addDays('2026-08-21', -(o.back || 84)),
                 distanceKey: o.distanceKey || 'half', volume: o.volume || 55,
                 benchSec: 45 * 60 });
  if (o.experience) a.state.experience = o.experience;
  a.state.setup.schedule = SCHEDULE;
  a.state.setup.benchmark = { distanceKey: '10k', timeSec: 45 * 60 };
  a.state.setup.goals = { A: { timeSec: 100 * 60 } };
  a.migrateAthleteRecord();
  return a;
}

function logPast(a, opts){
  const o = opts || {};
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach((d, i) => {
    if (o.skipEvery && i % o.skipEvery === o.skipEvery - 1) return;
    d.completed = true;
    d.actual = { km: d.km, pace: '5:20', hr: 148, rpe: 5, feel: 'ok',
                 notes: '', splits: [], paceUnit: 'km' };
  });
}

/* Move the block's goal day into the past and log the effort, which is what an
   athlete who has just raced actually leaves behind. */
function raceHappened(a, opts){
  const o = opts || {};
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the fixture needs a goal day');
  const past = a.addDays(a.todayStr(), -1);
  race.date = past; race.id = past;
  a.state.setup.raceDate = past;
  const b = a.currentBlock();
  if (b) b.goalDate = past;
  if (o.ran !== false){
    race.completed = true;
    race.actual = { km: race.km, pace: o.pace || '4:44', hr: 175, rpe: 9, feel: 'ok',
                    notes: '', splits: [], paceUnit: 'km' };
  }
  return race;
}

// ===========================================================================
// 1. THE RACE CAMPAIGN, END TO END
//    race -> race day -> outcome -> recovery offered -> recovery -> next
// ===========================================================================
test('LIFECYCLE: race → outcome → recovery → what next, with nothing lost', () => {
  const a = racingAthlete();
  logPast(a);
  const trained = a.state.days.filter(d => d.completed).length;
  assert.ok(trained > 10, 'the fixture needs a real block behind it');
  raceHappened(a);

  // 1. the question is asked, and it is the only thing asked
  assert.equal(a.raceOutcomePending(), true, 'a passed goal day with no answer must ask');
  assert.equal(a.nextBlockRecommendation().kind, 'race_outcome',
    'nothing may be recommended before the outcome is known');

  // 2. answered
  const res = a.recordRaceOutcome('raced');
  assert.equal(res.outcome, 'raced');
  assert.equal(a.raceOutcomePending(), false, 'the question stops being asked once answered');
  assert.equal(a.measuredPerformances().length, 1, 'a raced race is a measurement');

  // 3. recovery is now the recommendation, and it is a recommendation
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'block');
  assert.equal(rec.purpose, 'recovery');
  assert.ok(rec.why && rec.why.length > 10, 'a recommendation without a reason is an instruction');
  assert.equal(a.state.setup.purpose, 'race', 'recommending must not have changed anything');

  // 4. accepted
  const block = a.startDevelopmentBlock('recovery');
  assert.ok(block, 'recovery could not be built');
  assert.equal(a.state.setup.purpose, 'recovery');
  assert.equal(a.state.athlete.sessions.length, trained,
    'the race block’s training must survive into the athlete record');
  assert.equal(a.measuredPerformances().length, 1, 'and so must the measurement');

  // 5. recovery ends somewhere
  const last = a.state.days[a.state.days.length - 1];
  a.state.setup.raceDate = a.addDays(a.todayStr(), -1);
  const after = a.nextBlockRecommendation();
  assert.ok(after, 'recovery must not be a dead end');
  assert.equal(after.kind, 'choice');
  assert.ok(after.options.indexOf('base') !== -1 && after.options.indexOf('race') !== -1,
    'after recovery the athlete should be able to develop or race again');
  assert.ok(last, 'the recovery block has days');
});

test('LIFECYCLE: a DNS is not recovered from, and measures nothing', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a, { ran: false });

  a.recordRaceOutcome('dns');
  assert.equal(a.measuredPerformances().length, 0, 'a race nobody started measures nothing');
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'block');
  assert.equal(rec.purpose, 'maintain',
    'there is nothing to recover from, so maintenance is the honest offer');
  assert.match(rec.why, /did not start/i);
});

test('LIFECYCLE: a DNF keeps the training and refuses the measurement', () => {
  const a = racingAthlete();
  logPast(a);
  const race = raceHappened(a);
  assert.ok(a.performanceFromDay(race), 'precondition: the effort would otherwise qualify');

  a.recordRaceOutcome('dnf');
  assert.equal(race.completed, true, 'whatever was run is still training and stays logged');
  assert.equal(a.measuredPerformances().length, 0,
    'a did-not-finish is not a measurement of what this athlete can do');

  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'block');
  assert.equal(rec.purpose, 'recovery', 'they still raced hard enough to need it');
});

// ===========================================================================
// 2. BETWEEN RACES
// ===========================================================================
test('LIFECYCLE: maintain → review → develop or race', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  assert.ok(a.startDevelopmentBlock('maintain'), 'maintenance could not be built');
  assert.equal(a.state.setup.purpose, 'maintain');
  assert.equal(a.state.setup.hasEvent, false, 'maintenance must not carry an event');

  a.state.setup.raceDate = a.addDays(a.todayStr(), -1);   // the review point arrives
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'choice');
  ['base', 'speed', 'race', 'maintain'].forEach(p =>
    assert.ok(rec.options.indexOf(p) !== -1, 'maintenance should be able to lead to ' + p));
  assert.ok(rec.why, 'the review point needs a reason too');
});

test('LIFECYCLE: base → race campaign', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  assert.ok(a.startDevelopmentBlock('base'));
  a.state.setup.raceDate = a.addDays(a.todayStr(), -1);
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.options[0], 'race', 'the capacity built is for racing on');
  assert.match(rec.why, /race block/i);
});

test('LIFECYCLE: speed → race, base or maintain', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const b = a.startDevelopmentBlock('speed');
  assert.ok(b);
  assert.equal(a.state.setup.distanceKey, '5k', 'speed reuses the 5K methodology');
  a.state.setup.raceDate = a.addDays(a.todayStr(), -1);
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'choice');
  ['race', 'base', 'maintain'].forEach(p => assert.ok(rec.options.indexOf(p) !== -1));
});

// ===========================================================================
// 3. A SEASON: FOUR BLOCKS, ONE ATHLETE
// ===========================================================================
test('LIFECYCLE: after several blocks the athlete record is still one athlete', () => {
  const a = racingAthlete();
  logPast(a);
  const raceTrained = a.state.days.filter(d => d.completed).length;
  raceHappened(a);
  a.recordRaceOutcome('raced');

  const seen = [];
  ['recovery', 'base', 'speed', 'maintain'].forEach(p => {
    const b = a.startDevelopmentBlock(p);
    assert.ok(b, p + ' could not be built');
    seen.push(b.id);
    // train a little inside each block so there is something to carry forward
    const t = a.todayStr();
    a.state.days.filter(d => d.date >= t && d.type !== 'rest').slice(0, 3).forEach(d => {
      d.date = a.addDays(t, -1); d.id = d.date;
      d.completed = true;
      d.actual = { km: d.km, pace: '5:30', hr: 145, rpe: 4, feel: 'ok',
                   notes: '', splits: [], paceUnit: 'km' };
    });
  });

  const ids = {};
  a.state.athlete.blocks.forEach(b => {
    assert.ok(!ids[b.id], 'two blocks share an id');
    ids[b.id] = true;
  });
  assert.ok(a.state.athlete.blocks.length >= 5, 'every block must be on the ledger');
  assert.ok(a.state.athlete.sessions.length >= raceTrained,
    'the original race block’s training must still be there four blocks later');

  const dates = {};
  a.state.athlete.sessions.forEach(s => {
    assert.ok(!dates[s.date], 'the same day was archived twice: ' + s.date);
    dates[s.date] = true;
  });

  // and a new race block after all of it still reads the history
  const before = a.state.athlete.sessions.length;
  a.state.setup.purpose = 'race';
  assert.ok(a.athleteMemory(400).length > 0, 'the memory must survive a whole season');
  assert.equal(a.state.athlete.sessions.length, before, 'reading history must not write to it');
});

// ===========================================================================
// 4. MEASURED-FITNESS SAFETY
//    Everything that must NEVER become a measurement.
// ===========================================================================
test('SAFETY: changing Goal A/B/C creates no measured point', () => {
  const a = racingAthlete();
  logPast(a);
  const before = a.measuredPerformances().length;
  a.state.setup.goals = { A: { timeSec: 80 * 60 }, B: { timeSec: 85 * 60 }, C: { timeSec: 95 * 60 } };
  a.state.setup.activeGoal = 'A';
  assert.equal(a.measuredPerformances().length, before,
    'a goal is an aspiration and can never be a measurement');
  a.state.setup.activeGoal = 'C';
  assert.equal(a.measuredPerformances().length, before);
});

test('SAFETY: a recalibration suggestion creates nothing without a real effort', () => {
  const a = racingAthlete();
  logPast(a);
  const before = a.measuredPerformances().length;
  try { a.handleSuggestGoals(); } catch (e) { /* needs DOM; the point is it writes nothing */ }
  assert.equal(a.measuredPerformances().length, before,
    'suggesting goals must not manufacture a fitness point');
});

test('SAFETY: an ordinary easy run cannot create or move an estimate', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const est = a.measuredFitnessEstimate('10k');
  assert.ok(est && !est.withheld, 'precondition: there is an estimate to move');

  const easy = a.state.days.filter(d => d.type === 'easy' && d.date < a.todayStr())[0];
  assert.ok(easy);
  easy.completed = true;
  easy.actual = { km: easy.km, pace: '3:20', hr: 190, rpe: 10, feel: 'ok',
                  notes: '', splits: [], paceUnit: 'km' };   // absurdly fast, still an easy run
  const after = a.measuredFitnessEstimate('10k');
  assert.equal(after.fastSec, est.fastSec, 'an easy run moved the estimate');
  assert.equal(after.slowSec, est.slowSec);
  assert.equal(a.measuredPerformances().length, 1, 'and it must not have become a measurement');
});

test('SAFETY: re-logging the same effort corrects it rather than duplicating it', () => {
  const a = racingAthlete();
  logPast(a);
  const race = raceHappened(a);
  a.recordRaceOutcome('raced');
  assert.equal(a.measuredPerformances().length, 1);
  const first = a.measuredPerformances()[0].timeSec;

  race.actual.pace = '4:30';                 // fixing a typo, same day
  a.recordMeasuredPerformance(race);
  const perfs = a.measuredPerformances();
  assert.equal(perfs.length, 1, 'a corrected time must not create a second athlete');
  assert.notEqual(perfs[0].timeSec, first, 'and the correction must actually land');
});

test('SAFETY: a measured result survives a block reset', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const before = a.measuredPerformances().map(p => p.date + '|' + p.timeSec).join(',');
  assert.ok(before, 'precondition');

  a.handleResetPlan();
  assert.equal(a.state.setup, null, 'the prescription is gone');
  assert.equal(a.measuredPerformances().map(p => p.date + '|' + p.timeSec).join(','), before,
    'measured fitness is a fact about the athlete, not about the plan');
});

test('SAFETY: the estimate is a range or nothing, never a prophecy', () => {
  const a = racingAthlete();
  assert.equal(a.measuredFitnessEstimate('10k'), null,
    'with nothing measured the honest answer is nothing at all');
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const est = a.measuredFitnessEstimate('10k');
  assert.ok(est.fastSec < est.slowSec, 'a single number would be false precision');
});

test('SAFETY: the marathon keeps its volume qualification', () => {
  /* ---- AN ATHLETE WHO GENUINELY HAS NOT DONE THE VOLUME ----
     This asked it of a half-marathon athlete who typed 30km/week, which used to
     produce a block whose absorbed volume sat under the marathon qualification.
     It no longer does: the half opens at its pathway's entry week and develops
     to its pathway's destination whatever the athlete typed, so this athlete
     absorbs 51km/week and the qualification is correctly met. The refusal being
     tested belongs to somebody who has not done the running -- a 10K athlete,
     who absorbs 34 -- and the rule, the threshold and the message are unchanged. */
  const a = racingAthlete({ volume: 30, distanceKey: '10k' });
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const est = a.measuredFitnessEstimate('full');
  assert.ok(est, 'the marathon must be answered, even if the answer is a refusal');
  assert.equal(est.withheld, true,
    'equivalence over-predicts the marathon without the volume behind it');
  assert.match(est.reason, /volume/i, 'and it must say why rather than simply going blank');
});

// ===========================================================================
// 5. LONGITUDINAL DATA
// ===========================================================================
test('DATA: reset preserves completed evidence and drops the future', () => {
  const a = racingAthlete();
  logPast(a);
  const done = a.state.days.filter(d => d.completed).length;
  const future = a.state.days.filter(d => d.date > a.todayStr() && d.type !== 'rest').length;
  assert.ok(future > 5, 'the fixture needs abandoned future days to prove they are dropped');

  a.handleResetPlan();
  assert.equal(a.state.athlete.sessions.length, done,
    'exactly what was done, and nothing that merely was going to be');
  a.state.athlete.sessions.forEach(s =>
    assert.equal(s.completed, true, 'a session nobody ran reached the athlete record'));
});

test('DATA: archiving twice adds nothing', () => {
  const a = racingAthlete();
  logPast(a);
  const id = a.state.setup.blockId;
  const first = a.archiveCompletedSessions(id);
  assert.ok(first > 0);
  assert.equal(a.archiveCompletedSessions(id), 0, 'a second pass must file nothing');
  assert.equal(a.archiveCompletedSessions(id), 0, 'nor a third');
});

test('DATA: the athlete record survives a save and a cold reload', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  a.handleResetPlan();
  const expected = a.state.athlete.sessions.length;
  const perfs = a.measuredPerformances().length;
  assert.ok(expected > 0 && perfs > 0, 'the fixture needs something to lose');
  const saved = JSON.stringify(a.state);

  /* A genuinely cold app, handed only the bytes that were stored. This is the
     path that used to wipe the athlete: loadState() refused any save without a
     plan, and after Reset Plan there is no plan by design. */
  const b = loadApp({ pinnedDate: TODAY });
  b.showToast = () => {};
  b.localStorage.setItem('velvet-viking-generator-v2', saved);
  b.loadState();

  assert.ok(b.state.athlete, 'a cold start lost the athlete');
  assert.equal(b.state.athlete.sessions.length, expected);
  assert.equal(b.state.athlete.performances.length, perfs);
  assert.equal(b.measuredPerformances().length, perfs,
    'a measured race must still be readable after a reinstall-shaped reload');
});

test('DATA: the live plan wins any date it shares with the archive', () => {
  const a = racingAthlete();
  logPast(a);
  a.archiveCompletedSessions(a.state.setup.blockId);
  const day = a.state.days.filter(d => d.completed)[0];
  const archived = a.state.athlete.sessions.filter(s => s.date === day.date)[0];
  assert.ok(archived, 'precondition');

  day.actual.rpe = 9;                        // the athlete corrects the live plan
  const mem = a.athleteMemory(400).filter(r => r.date === day.date);
  assert.equal(mem.length, 1, 'one day, one record');
  assert.equal(mem[0].rpe, 9, 'the archive must not shadow a correction to the live plan');
});

test('DATA: stale evidence stays inside the approved window', () => {
  const a = racingAthlete({ back: 400, weeks: 60 });
  logPast(a);
  a.archiveCompletedSessions(a.state.setup.blockId);
  const cutoff = a.addDays(a.todayStr(), -120);
  a.athleteMemory(120).forEach(r =>
    assert.ok(r.date >= cutoff, 'a 120-day window returned ' + r.date));
  assert.ok(a.athleteMemory(400).length >= a.athleteMemory(120).length,
    'a wider window must be able to see more, not less');
});

// ===========================================================================
// 6. HIGH-VALUE MUTATIONS
//    Each of these is a defect somebody could plausibly reintroduce. The test
//    is not that the code is written a particular way -- it is that the
//    behaviour these describe is impossible.
// ===========================================================================
test('MUTATION: reset cannot destroy athlete history', () => {
  const a = racingAthlete();
  logPast(a);
  const done = a.state.days.filter(d => d.completed).length;
  a.handleResetPlan();
  assert.ok(a.state.athlete.sessions.length >= done,
    'if this fails, Reset Plan has gone back to deleting the athlete with the plan');
});

test('MUTATION: a DNF cannot qualify as race performance', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('dnf');
  a.measuredPerformances().forEach(p =>
    assert.notEqual(p.date, a.state.setup.raceDate, 'a DNF became a measured performance'));
});

test('MUTATION: a goal time cannot become measured progress', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const before = JSON.stringify(a.measuredPerformances());
  [60, 70, 90, 120].forEach(m => {
    a.state.setup.goals = { A: { timeSec: m * 60 } };
    a.state.setup.activeGoal = 'A';
    a.measuredProgression();
  });
  assert.equal(JSON.stringify(a.measuredPerformances()), before,
    'the athlete’s ambition changed and their measured fitness moved with it');
});

test('MUTATION: an abandoned future session cannot become history', () => {
  const a = racingAthlete();
  logPast(a);
  /* Incoherent on purpose: a day still ahead, marked done. The archive must
     refuse it on the date, not on the flag. */
  const future = a.state.days.filter(d => d.date > a.todayStr() && d.type !== 'rest')[0];
  future.completed = true;
  future.actual = { km: future.km, pace: '5:00', hr: 150, rpe: 5, feel: 'ok',
                    notes: '', splits: [], paceUnit: 'km' };
  a.archiveCompletedSessions(a.state.setup.blockId);
  assert.ok(!a.state.athlete.sessions.some(s => s.date === future.date),
    'a session that has not happened was written into the athlete record');
});

test('MUTATION: recovery cannot allow quality inside the safety window', () => {
  const a = racingAthlete();
  logPast(a);
  const raceDate = raceHappened(a).date;
  a.recordRaceOutcome('raced');
  const b = a.startDevelopmentBlock('recovery');
  assert.ok(b);
  const profile = a.recoveryProfileFor('half');
  const until = a.addDays(raceDate, profile.noIntensityDays);
  const banned = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'];
  a.state.days.filter(d => d.date <= until).forEach(d =>
    assert.equal(banned.indexOf(d.type), -1,
      'a ' + d.type + ' session was prescribed on ' + d.date + ', inside the recovery window'));
});

test('MUTATION: athlete evidence cannot shorten the recovery ceiling', () => {
  const a = racingAthlete();
  logPast(a);
  const raceDate = raceHappened(a).date;
  a.recordRaceOutcome('raced');
  /* Everything an athlete could log to look recovered: perfect execution,
     low effort, easy heart rate, feeling good. The ceiling is deterministic
     and must not care. */
  a.state.days.filter(d => d.completed).forEach(d => {
    d.actual.rpe = 2; d.actual.hr = 120; d.actual.feel = 'good';
  });
  const profile = a.recoveryProfileFor('half');
  const b = a.startDevelopmentBlock('recovery');
  assert.ok(b);
  const until = a.addDays(raceDate, profile.noIntensityDays);
  a.state.days.filter(d => d.date <= until).forEach(d =>
    assert.ok(['easy', 'rest', 'long'].indexOf(d.type) !== -1 || d.recoveryCeiling,
      'feeling good bought intensity inside the recovery window'));
});

test('MUTATION: historical coaching cannot fall back to current-plan-only', () => {
  const a = racingAthlete();
  logPast(a);
  const done = a.state.days.filter(d => d.completed).length;
  raceHappened(a);
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('base');
  /* The new block's own days carry almost no history. If any model has gone
     back to reading state.days alone, the memory collapses to that. */
  const mem = a.athleteMemory(400);
  assert.ok(mem.length >= done,
    'the athlete record shrank to the current plan — ' + mem.length + ' vs ' + done);
});

/* THE GAP THIS CLOSES, found by mutation rather than by inspection.

   The test below drives startDevelopmentBlock(), which is how Valhalla builds
   a non-race block when the athlete accepts a recommendation. But there is a
   SECOND way in -- handleGeneratePlan(), the builder -- and forcing hasEvent
   to true there changed nothing any test could see. An athlete who picked
   "Aerobic Base" in the builder would have got a Race Day and a pre-race
   shakeout, and the suite would have stayed green.

   So the builder is driven here through its real DOM path: the same ids
   openSetupModal() renders and handleGeneratePlan() reads. */
function builderDom(a, values){
  const store = Object.assign({
    'su-purpose': 'race', 'su-distance': 'half', 'su-racedate': '',
    'su-weeks': '10', 'su-volume': '50', 'su-bench-dist': '10k',
    'su-bench-time': '45:00', 'su-lthr': '', 'su-maxhr': '',
    'su-longday': '6', 'su-goal-A': '1:40:00', 'su-goal-B': '', 'su-goal-C': ''
  }, values || {});
  const eventMode = store['su-purpose'] === 'race' && store['su-racedate'] ? 'event' : 'none';
  const checkboxes = [1, 2, 3, 5, 6].map(iso => ({
    checked: true, getAttribute: n => (n === 'data-wd' ? String(iso) : null)
  }));
  a.document.getElementById = id => {
    if (id === 'su-event-box') return { getAttribute: n => (n === 'data-mode' ? eventMode : null) };
    if (id === 'su-units') return { querySelector: () => null };
    if (store[id] === undefined) return null;
    return { value: store[id], getAttribute: () => null };
  };
  a.document.querySelectorAll = sel =>
    (sel.indexOf('su-weekdays') !== -1 ? checkboxes : []);
  a.closeModal = () => {};
  return store;
}

test('MUTATION: the BUILDER cannot produce race language for a non-race purpose', () => {
  ['maintain', 'base', 'speed'].forEach(p => {
    const a = racingAthlete();
    logPast(a);
    builderDom(a, { 'su-purpose': p, 'su-racedate': '2027-05-01' });
    a.handleGeneratePlan();

    assert.equal(a.state.setup.purpose, p, 'the builder ignored the chosen objective');
    assert.equal(a.state.setup.hasEvent, false,
      p + ' was built with an event even though the purpose has none');
    assert.equal(a.currentBlock().purpose, p, 'the ledger disagrees with the plan');
    a.state.days.forEach(d => {
      assert.doesNotMatch(String(d.title || ''), /race day|pre-race/i,
        p + ' prescribed "' + d.title + '"');
      assert.doesNotMatch(String(d.desc || ''), /race kit/i,
        p + ' used race-day language on ' + d.date);
    });
  });
});

test('MUTATION: the builder still builds a race block exactly as before', () => {
  const a = racingAthlete({ experience: 'advanced' });
  logPast(a);
  builderDom(a, { 'su-purpose': 'race', 'su-racedate': '2027-05-01' });
  a.handleGeneratePlan();
  assert.equal(a.state.setup.purpose, 'race');
  assert.equal(a.state.setup.hasEvent, true, 'a race with a date must keep its event');
  assert.equal(a.state.setup.raceDate, '2027-05-01');
  assert.ok(a.state.days.some(d => /Race Day/.test(d.title || '')),
    'a real race block must still have a race day');
});

/* THE STICKY FLAG, FOUND FROM A REAL PLAN. runwayOfferAnsweredFor gates
   whether Regenerate Plan re-asks the runway/admission question -- answered
   once, it must not nag on the way back through the SAME configuration. But
   "the same configuration" was being read as "this builder session", a
   plain boolean that never reset: an athlete who answered once early on
   could change distance, event date, days or benchmark into a genuinely
   different -- and genuinely unreachable -- configuration and have
   Regenerate Plan build it silently, because the flag stayed true from a
   decision about a different question.

   admissionInputsSignature() closes this: the flag now remembers WHICH
   configuration it answered, and a materially different one is asked again.
   raceGoalAdmission()/marathonRunwayPlan() are stubbed here because their own
   methodology is proven elsewhere (raceGoalAdmissionViability.test.js); what
   this test isolates is the control flow around them -- does the question
   get asked when it must, and stay quiet when it must not. */
test('REGRESSION: the admission question re-fires only when the configuration actually changes', () => {
  const a = racingAthlete({ experience: 'novice' });
  logPast(a);
  const asks = [];
  a.marathonRunwayPlan = () => ({ preparatory: false });
  a.raceGoalAdmission = () => ({ admitted: false, decision: 'preparation_not_reachable' });
  a.openRaceGoalPreparationModal = (adm, distanceKey) => { asks.push({ adm, distanceKey }); };

  builderDom(a, { 'su-purpose': 'race', 'su-distance': 'full', 'su-racedate': '2027-05-01' });
  a.handleGeneratePlan();
  assert.equal(asks.length, 1, 'a race build within the gated distances must ask once');

  // "Build the marathon programme anyway" -- exactly what prep-continue does.
  a.runwayOfferAnsweredFor = a.pendingAdmissionSig;

  // Regenerate Plan with nothing changed: must not nag the athlete again.
  builderDom(a, { 'su-purpose': 'race', 'su-distance': 'full', 'su-racedate': '2027-05-01' });
  a.handleGeneratePlan();
  assert.equal(asks.length, 1, 'an unchanged configuration must not re-ask');

  // The athlete changes the event date -- weeks-to-race is exactly what the
  // admission question is about. THE BUG: this used to build silently.
  builderDom(a, { 'su-purpose': 'race', 'su-distance': 'full', 'su-racedate': '2027-06-15' });
  a.handleGeneratePlan();
  assert.equal(asks.length, 2,
    'a materially different configuration must be asked about again, not built on a stale answer');
});

test('MUTATION: a non-race block cannot emit race-only language', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  ['maintain', 'base', 'speed'].forEach(p => {
    const b = a.startDevelopmentBlock(p);
    assert.ok(b, p + ' could not be built');
    assert.equal(a.state.setup.hasEvent, false, p + ' must not claim an event');
    /* Base and speed build to a goal effort and so have a Goal Day.
       Maintenance builds to nothing on purpose, so its end date is a Review
       point -- see the MAINTAIN block above. Neither is ever a Race Day. */
    assert.equal(a.vGoalDay(a.state.setup), p === 'maintain' ? 'Review' : 'Goal Day',
      p + ' named its end date wrongly');
    assert.doesNotMatch(a.vGoalDay(a.state.setup), /Race/, p + ' called it Race Day');
    assert.equal(a.vGoalWeek(a.state.setup), 'Final Week', p + ' called it Race Week');
    a.state.days.forEach(d => {
      assert.doesNotMatch(String(d.title || ''), /race day|pre-race/i,
        p + ' prescribed "' + d.title + '" on ' + d.date);
      assert.doesNotMatch(String(d.desc || ''), /race kit|on race day/i,
        p + ' used race-day language on ' + d.date);
    });
  });
});

// ===========================================================================
// 6b. MAINTAIN & PROTECT DOES NOT PEAK
//
//     Maintenance inherited the shared generator's arc, so it ramped to a
//     peak, tapered, and finished with a synthetic goal effort -- a block
//     whose whole purpose is to hold fitness between campaigns was quietly
//     building towards nothing. Steady mode removes exactly those three
//     things. These pin all three, and pin that nothing else moved.
// ===========================================================================
function maintainBlock(){
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  assert.ok(a.startDevelopmentBlock('maintain'), 'maintenance could not be built');
  return a;
}

test('MAINTAIN: no taper', () => {
  const a = maintainBlock();
  const n = a.totalWeeksInPlan();
  for (let w = 1; w <= n; w++)
    assert.equal(a.isTaperWeek(w), false, 'week ' + w + ' is a taper week');
  const br = a.buildBlockWeeks('half', 45, 8, { steady: true });
  assert.equal(br.taperWeeks, 0);
  assert.ok(!br.weeks.some(w => w.isTaper), 'the generator still produced taper weeks');
});

test('MAINTAIN: no culminating goal effort', () => {
  const a = maintainBlock();
  a.state.days.forEach(d => {
    assert.notEqual(d.type, 'race', 'a goal effort was prescribed on ' + d.date);
    assert.notEqual(d.type, 'checkpoint',
      'a maximal time trial was prescribed on ' + d.date + ' — maintenance holds, it does not test');
  });
  const br = a.buildBlockWeeks('half', 45, 8, { steady: true });
  assert.ok(!br.weeks.some(w => w.isRace), 'the generator still produced a goal-effort week');
  assert.ok(!br.weeks.some(w => w.isCheckpoint), 'and still produced a checkpoint');
  assert.ok(!br.weeks.some(w => w.raceDayKm > 0), 'and still budgeted race-day distance');
});

test('MAINTAIN: volume holds rather than ramps', () => {
  const br = maintainBlock().buildBlockWeeks('half', 45, 8, { steady: true });
  const full = br.weeks.filter(w => !w.isCutback).map(w => w.volume);
  full.forEach(v => assert.equal(v, 45,
    'a maintenance week is not the athlete’s own volume: ' + full.join(', ')));
  assert.equal(br.peakVolume, 45, 'maintenance has no peak above what is absorbed');
  /* The four-weekly cutback stays. An easier week is recovery, not peaking,
     and removing it would make maintenance harder than the block it follows. */
  assert.ok(br.weeks.some(w => w.isCutback), 'the cutback rhythm was lost');
  br.weeks.filter(w => w.isCutback).forEach(w =>
    assert.ok(w.volume < 45, 'a cutback week must actually be easier'));
});

test('MAINTAIN: one phase, because it has one shape', () => {
  const a = maintainBlock();
  const n = a.totalWeeksInPlan();
  for (let w = 1; w <= n; w++)
    assert.equal(a.trainingPhase(w), 'Maintain',
      'week ' + w + ' reads as "' + a.trainingPhase(w) + '" in a block with no arc');
  assert.equal(a.vGoalDay(a.state.setup), 'Review',
    'the end of a maintenance block is a review point, not a goal day');
  assert.equal(a.vGoalDate(a.state.setup), 'Review');
});

test('MAINTAIN: keeps its quality — it holds fitness, it does not shed it', () => {
  const a = maintainBlock();
  const quality = a.state.days.filter(d =>
    ['tempo', 'threshold', 'interval', 'repetition'].indexOf(d.type) !== -1);
  assert.ok(quality.length >= 4,
    'lower cost means less volume and frequency, not no intensity — found ' + quality.length);
});

/* THE POOL, NOT A PROXY FOR THE POOL.

   'Maintain' is not a key in either structure pool, and pickQualityStructure
   falls back to pool.Peak for any name it does not know -- so getting this
   wrong hands a maintenance block the hardest sessions in the product. The
   first version of this test compared session DISTANCES against the race
   block's peak week, which stayed true either way because a maintenance week
   has less volume to fit a session into. Distance was never the claim.

   This compares the structures themselves against blocks built entirely from
   each pool, which is what the claim actually is. */
test('MAINTAIN: sessions come from the Build pool, never the Peak pool', () => {
  const a = racingAthlete();
  const steady = a.buildBlockWeeks('half', 45, 8, { steady: true });
  /* `t` is the structure's kind -- interval, repetition, goalpace, threshold.
     The generator shrinks a chosen spec's dimensions afterwards but never its
     kind, so this is the part that survives selection and identifies the pool
     it came from. (An earlier version read `.type`, which these specs do not
     have; every comparison was undefined === undefined and the guard could
     not have failed. The self-check at the bottom is what caught it.) */
  const kind = w => [w.qSpec && w.qSpec.t, w.tSpec && w.tSpec.t].join('/');
  const fromPool = (phase, w, pos) =>
    [a.pickQualityStructure(a.INTERVAL_STRUCTURE_POOL, phase, w, pos, 'threshold').t,
     a.pickQualityStructure(a.TEMPO_STRUCTURE_POOL, phase, w, pos, 'threshold').t].join('/');

  steady.weeks.forEach(w => {
    const pos = (w.week - 1) / 7;
    const build = fromPool('Build', w.week, pos);
    const peak = fromPool('Peak', w.week, pos);
    assert.equal(kind(w), build, 'week ' + w.week + ' did not come from the Build pool');
    if (peak !== build) assert.notEqual(kind(w), peak,
      'week ' + w.week + ' fell through to the Peak pool');
  });
  /* And the two pools genuinely differ somewhere, or the check above proves
     nothing at all. */
  const differs = steady.weeks.some(w =>
    fromPool('Build', w.week, (w.week - 1) / 7) !== fromPool('Peak', w.week, (w.week - 1) / 7));
  assert.ok(differs, 'Build and Peak select identically — this guard would never bite');
});

/* THE BUILDER PATH, which the recommendation path does not cover. Every other
   MAINTAIN test above drives startDevelopmentBlock(); an athlete who picks
   Maintain & Protect in the builder goes through handleGeneratePlan() instead,
   and removing steady mode from THAT call changed nothing any test could see. */
test('MAINTAIN: the BUILDER builds it steady too', () => {
  const a = racingAthlete();
  logPast(a);
  builderDom(a, { 'su-purpose': 'maintain', 'su-weeks': '8' });
  a.handleGeneratePlan();

  assert.equal(a.state.setup.purpose, 'maintain');
  const n = a.totalWeeksInPlan();
  for (let w = 1; w <= n; w++){
    assert.equal(a.trainingPhase(w), 'Maintain',
      'the builder produced an arc: week ' + w + ' is ' + a.trainingPhase(w));
    assert.equal(a.isTaperWeek(w), false, 'the builder produced a taper in week ' + w);
  }
  a.state.days.forEach(d => {
    assert.notEqual(d.type, 'race', 'the builder gave maintenance a goal effort on ' + d.date);
    assert.notEqual(d.type, 'checkpoint', 'the builder gave maintenance a time trial');
  });
  assert.equal(a.vGoalDay(a.state.setup), 'Review');
});

test('MAINTAIN: no race, taper or goal-effort language anywhere in the block', () => {
  const a = maintainBlock();
  a.state.days.forEach(d => {
    const said = String(d.title || '') + ' ' + String(d.desc || '');
    [/race day/i, /pre-race/i, /race kit/i, /goal effort/i, /pre-goal/i,
     /taper/i, /culminates here/i].forEach(re =>
      assert.doesNotMatch(said, re, 'maintenance said "' + said.trim() + '" on ' + d.date));
  });
  assert.equal(a.state.setup.hasEvent, false);
});

test('MAINTAIN: the 8-week review still arrives and still asks', () => {
  const a = maintainBlock();
  assert.equal(a.totalWeeksInPlan(), 8, 'the approved review period must stay 8 weeks');
  assert.equal(a.developmentBlockSpec('maintain', {}).weeks, 8);

  a.state.setup.raceDate = a.addDays(a.todayStr(), -1);   // the review point arrives
  const rec = a.nextBlockRecommendation();
  assert.ok(rec, 'the review point must not be a dead end');
  assert.equal(rec.kind, 'choice', 'it asks rather than decides');
  ['base', 'speed', 'race', 'maintain'].forEach(p =>
    assert.ok(rec.options.indexOf(p) !== -1, 'the review should be able to lead to ' + p));
  assert.ok(rec.why, 'and it should say why it is asking');
  const before = JSON.stringify({ p: a.state.setup.purpose, n: a.state.days.length });
  a.renderBlockTransitionCard();
  assert.equal(JSON.stringify({ p: a.state.setup.purpose, n: a.state.days.length }), before,
    'the review must not transition on its own');
});

/* DRIVEN THROUGH THE PREVIEW'S OWN GENERATOR, not through a copy of it.

   The first version of this test computed the steady flag itself and then
   called buildBlockWeeks -- so it asserted that the ENGINE can build a steady
   block, and said nothing about whether the preview asks it to. Removing the
   option from _preview.js left it green. generate() is exported for exactly
   this reason and is what the handler calls. */
function previewFor(purpose, over){
  const Preview = require(path.join(ROOT, 'api', '_preview.js'));
  const v = Preview.validate(Object.assign({
    purpose: purpose, distanceKey: 'half', weeks: Preview.defaultWeeksFor(purpose),
    volume: 60, activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700
  }, over || {}));
  assert.equal(v.ok, true, 'the preview refused a legitimate ' + purpose + ' request: ' + v.code);
  const built = Preview.generate(loadApp({ pinnedDate: TODAY }), v.input);
  return { Preview, input: v.input, built, summary: Preview.summarise(
    built.app, built.days, built.blockResult, v.input) };
}

test('MAINTAIN: the preview builds the same steady block the app does', () => {
  const { built, summary } = previewFor('maintain');
  assert.equal(built.blockResult.steady, true,
    'THE PREVIEW ITSELF must ask for steady mode, not merely be able to');
  assert.equal(built.blockResult.taperWeeks, 0);
  assert.ok(!built.blockResult.weeks.some(w => w.isRace),
    'the preview would have advertised a goal effort');
  built.days.forEach(d => {
    assert.notEqual(d.type, 'race', 'the previewed maintenance block contains a goal effort');
    assert.doesNotMatch(String(d.title || ''), /race|goal effort/i,
      'race language in a previewed maintenance session: ' + d.title);
  });
  assert.equal(summary.phases.length, 1, 'a steady block has one phase');
  assert.equal(summary.phases[0].phase, 'Maintain');
  assert.ok(!('raceDate' in summary.goal), 'maintenance must not be given a race date');
});

test('PREVIEW: every purpose comes back complete, and only race talks about racing', () => {
  ['race', 'maintain', 'base', 'speed'].forEach(p => {
    const { summary, built } = previewFor(p);
    assert.ok(summary.programme.weeks > 0, p + ' has no length');
    assert.ok(summary.programme.totalSessions > 0, p + ' has no sessions');
    assert.ok(summary.programme.totalKm > 0, p + ' has no distance');
    assert.ok(summary.phases.length > 0, p + ' has no structure');
    assert.ok(summary.firstWeek.length > 0, p + ' has no first week');
    assert.ok(summary.keySessions.length > 0, p + ' has no representative sessions');
    assert.ok(summary.paces && summary.paces.length > 0, p + ' has no personal pace guidance');
    assert.equal(summary.purpose.key, p);
    if (p === 'race'){
      assert.ok('raceDate' in summary.goal, 'a race block should carry its race date');
    } else {
      assert.ok('goalDay' in summary.goal, p + ' should have a goal day, not a race date');
      assert.ok(!('raceDate' in summary.goal), p + ' was given a race date');
      const said = JSON.stringify(summary) + JSON.stringify(built.days.map(d => d.title));
      assert.doesNotMatch(said, /Race Day|Pre-Race|race kit/i,
        p + ' leaked race language into the preview');
    }
  });
});

// ===========================================================================
// 6c. THE OTHER PURPOSES ARE UNTOUCHED BY THE MAINTAIN CORRECTION
// ===========================================================================
test('PRESERVED: a race block still ramps, tapers and finishes with a race', () => {
  const a = racingAthlete();
  const br = a.buildBlockWeeks('half', 50, 14);
  assert.equal(br.steady, false);
  assert.ok(br.taperWeeks > 0, 'a race block must still taper');
  assert.ok(br.weeks.some(w => w.isRace), 'and must still end in a race');
  assert.ok(br.weeks.some(w => w.isCheckpoint), 'and must still checkpoint mid-block');
  assert.ok(br.peakVolume > 50, 'and must still build above the starting volume');
  /* Byte-for-byte against a block built the way it always was: the fourth
     argument is optional and an omitted one must change nothing. */
  const withOpts = a.buildBlockWeeks('half', 50, 14, {});
  assert.equal(JSON.stringify(withOpts), JSON.stringify(br),
    'passing an empty options object changed a race block');
});

test('a speed block still builds towards a benchmark effort', () => {
  const b = racingAthlete();
  logPast(b); raceHappened(b); b.recordRaceOutcome('raced');
  assert.ok(b.startDevelopmentBlock('speed'), 'speed could not be built');
  assert.ok(b.state.days.some(d => d.type === 'race'),
    'the speed block lost the benchmark it exists to build towards');
  assert.notEqual(b.trainingPhase(1), 'Maintain', 'speed became a steady block');
  assert.equal(b.vGoalDay(b.state.setup), 'Goal Day',
    'a benchmark is a goal day, not a race day');
});

test('an aerobic base block deliberately ends in nothing', () => {
  /* This test used to assert the opposite, and the assertion was wrong rather
     than the code. A base block that culminates in a maximal goal effort --
     and tapers for two weeks to reach it -- is a race build wearing the word
     "base", which is exactly what the programme audit found: of ten weeks,
     one was a Base week, one was a maximal time trial, two were taper and the
     last was a goal effort.

     A base block ends absorbed instead: the final week is a consolidation
     week, and the next block starts from a runner who has just trained
     through rather than one who has just emptied themselves. */
  const b = racingAthlete();
  logPast(b); raceHappened(b); b.recordRaceOutcome('raced');
  assert.ok(b.startDevelopmentBlock('base'), 'base could not be built');
  assert.equal(b.state.days.filter(d => d.type === 'race').length, 0,
    'the aerobic base block still ends in a maximal goal effort');
  assert.equal(b.state.days.filter(d => d.type === 'checkpoint').length, 0,
    'the aerobic base block still contains a maximal time trial');
  assert.notEqual(b.trainingPhase(1), 'Maintain', 'base became a steady block');
  const total = b.totalWeeksInPlan();
  const phases = [];
  for (let w = 1; w <= total; w++) phases.push(b.trainingPhase(w));
  assert.equal(phases.filter(p => p === 'Taper').length, 0,
    'the aerobic base block still tapers for a race that does not exist');
  assert.ok(phases.filter(p => p === 'Base').length >= Math.ceil(total * 0.6),
    'only ' + phases.filter(p => p === 'Base').length + ' of ' + total +
    ' weeks of an aerobic base block are base weeks: ' + phases.join(' '));
});

test('PRESERVED: recovery still has its deterministic ceiling', () => {
  const a = racingAthlete();
  logPast(a);
  const raceDate = raceHappened(a).date;
  a.recordRaceOutcome('raced');
  assert.ok(a.startDevelopmentBlock('recovery'));
  assert.notEqual(a.trainingPhase(1), 'Maintain', 'recovery is not a steady block');
  const until = a.addDays(raceDate, a.recoveryProfileFor('half').noIntensityDays);
  a.state.days.filter(d => d.date <= until).forEach(d =>
    assert.equal(['tempo','threshold','interval','repetition','checkpoint','race'].indexOf(d.type), -1,
      'the recovery ceiling moved'));
});

// ===========================================================================
// 7. THE SURFACES SAY WHAT THE ENGINE DECIDED
// ===========================================================================
test('SURFACE: Plan HQ names the block and the week within it', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  assert.match(a.blockIdentityLine(), /Half Marathon Build · Week \d+ of \d+/,
    'a race block should read as its distance');

  a.startDevelopmentBlock('maintain');
  assert.match(a.blockIdentityLine(), /^Maintain & Protect · Week \d+ of \d+$/);
  a.startDevelopmentBlock('base');
  assert.match(a.blockIdentityLine(), /^Aerobic Base · Week \d+ of \d+$/);
  a.startDevelopmentBlock('speed');
  assert.match(a.blockIdentityLine(), /^Speed & Threshold · Week \d+ of \d+$/);
});

test('SURFACE: the countdown stops shouting GO once the day has passed', () => {
  const a = racingAthlete();
  logPast(a);
  assert.match(a.renderCountdown(), /\d+d/, 'before the day it counts down');

  raceHappened(a);
  const waiting = a.renderCountdown();
  assert.doesNotMatch(waiting, /Go!/,
    'THE DEFECT: every day after the race said "Race Day — Go!" indefinitely');
  assert.match(waiting, /Waiting on your answer/,
    'and while the outcome is unknown it should say so, not celebrate');

  a.recordRaceOutcome('raced');
  assert.match(a.renderCountdown(), /Raced/);

  const dnf = racingAthlete();
  logPast(dnf); raceHappened(dnf); dnf.recordRaceOutcome('dnf');
  assert.match(dnf.renderCountdown(), /Did not finish/);
  const dns = racingAthlete();
  logPast(dns); raceHappened(dns, { ran: false }); dns.recordRaceOutcome('dns');
  assert.match(dns.renderCountdown(), /Did not start/);
});

test('SURFACE: the outcome prompt appears only while the question is open', () => {
  const a = racingAthlete();
  logPast(a);
  assert.equal(a.renderRaceOutcomePrompt(), '', 'nothing to ask before the goal day passes');

  raceHappened(a);
  const asking = a.renderRaceOutcomePrompt();
  assert.match(asking, /How did it go\?/);
  ['raced', 'dnf', 'dns', 'later'].forEach(k =>
    assert.match(asking, new RegExp('data-outcome="' + k + '"'), 'missing the ' + k + ' answer'));

  a.recordRaceOutcome('raced');
  assert.equal(a.renderRaceOutcomePrompt(), '', 'an answered question must stop being asked');
});

test('SURFACE: the transition card recommends and never acts', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const before = JSON.stringify({ p: a.state.setup.purpose, d: a.state.days.length });
  const card = a.renderBlockTransitionCard();
  assert.match(card, /data-action="start-block"/, 'the athlete needs something to press');
  assert.match(card, /data-purpose="recovery"/);
  assert.match(card, /Nothing changes until you choose/);
  assert.equal(JSON.stringify({ p: a.state.setup.purpose, d: a.state.days.length }), before,
    'rendering a recommendation changed the plan');
});

test('SURFACE: Measured Fitness reports measurements and refuses everything else', () => {
  const a = racingAthlete();
  logPast(a);
  const empty = a.renderMeasuredFitness();
  assert.match(empty, /Nothing measured yet/,
    'with no race or checkpoint the section must say so rather than derive something');
  assert.doesNotMatch(empty, /\d\d:\d\d/, 'and must show no time at all');

  raceHappened(a);
  a.recordRaceOutcome('raced');
  const filled = a.renderMeasuredFitness();
  assert.match(filled, /Latest/);
  assert.match(filled, /Equivalent right now/);
});

test('SURFACE: no rejected fitness concept reaches any year-round surface', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  a.recordRaceOutcome('raced');
  const painted = [a.renderMeasuredFitness(), a.renderBlockTransitionCard(),
                   a.renderRaceOutcomePrompt(), a.blockIdentityLine()].join('\n');
  [/\bCTL\b/, /\bATL\b/, /\bTSB\b/, /banister/i, /\bVDOT\b/].forEach(re =>
    assert.doesNotMatch(painted, re, 'an internal model reached the athlete'));
});

// ===========================================================================
// 8. THE BUILDER'S OBJECTIVE SELECTOR
// ===========================================================================
test('BUILDER: four objectives are offered and recovery is not one of them', () => {
  const a = racingAthlete();
  assert.equal(a.BUILDER_PURPOSE_ORDER.join(','), 'race,maintain,base,speed');
  assert.equal(a.BUILDER_PURPOSE_ORDER.indexOf('recovery'), -1,
    'recovery is a coach recommendation after a race, never a menu choice');
  a.BUILDER_PURPOSE_ORDER.forEach(p =>
    assert.ok(a.isBlockPurpose(p), p + ' is not a real block purpose'));

  /* THE THREE DEVELOPMENT BLOCKS ARE CALLED ONE THING EVERYWHERE. What the
     athlete picks in the builder is what Plan HQ shows and what the next
     recommendation offers, because a block that changes name between screens
     is a second block as far as the athlete is concerned. */
  ['maintain', 'base', 'speed'].forEach(p =>
    assert.equal(a.BUILDER_PURPOSE_META[p].label, a.blockPurposeLabel(p),
      p + ' is called one thing in the builder and another in the ledger'));

  /* RACE IS THE DELIBERATE EXCEPTION, and it is not an inconsistency. "Race
     Goal" is the CHOICE -- what you are setting out to do. Plan HQ then names
     the block by its distance, "Half Marathon Build", because once the block
     exists the distance is the useful fact and "Race Build" would be vaguer
     than what it replaced. Pinned so the difference stays intentional. */
  assert.equal(a.BUILDER_PURPOSE_META.race.label, 'Race Goal');
  assert.equal(a.blockPurposeLabel('race'), 'Race Build');
});

test('BUILDER: only the race objective talks about events', () => {
  const a = racingAthlete();
  /* Everything stage 01 says about a purpose, in one place. An athlete
     building a base should not be reassured that they "do not need an event
     booked" -- there is no event in the question they asked. */
  ['maintain', 'base', 'speed'].forEach(p => {
    const m = a.BUILDER_PURPOSE_META[p];
    const said = [m.blurb, m.distanceLabel, m.distanceHint, m.weeksHint,
                  m.stageTitle, m.stageLede].join(' | ');
    assert.doesNotMatch(said, /event booked|race date|taper to|on race day/i,
      p + ' uses race framing: ' + said);
    assert.ok(m.stageTitle && m.stageLede, p + ' has no stage copy of its own');
  });
  const race = a.BUILDER_PURPOSE_META.race;
  assert.match(race.stageLede, /event/i,
    'the race objective is the one that should mention an event');
});

test('BUILDER: the offered length is the length the engine would have built', () => {
  const a = racingAthlete();
  logPast(a);
  ['maintain', 'base', 'speed'].forEach(p =>
    assert.equal(a.builderDefaultWeeks(p), a.developmentBlockSpec(p, {}).weeks,
      'the builder offers a different length for ' + p + ' than the engine uses'));
  assert.equal(a.builderDefaultWeeks('race'), 14);
});

test('BUILDER: the server preview agrees with the app about every purpose', () => {
  const Preview = require(path.join(ROOT, 'api', '_preview.js'));
  const a = racingAthlete();
  logPast(a);
  Preview.PURPOSES.forEach(p => {
    assert.equal(Preview.defaultWeeksFor(p), a.builderDefaultWeeks(p),
      'preview and builder disagree about how long a ' + p + ' block is');
  });
  assert.equal(Preview.PURPOSES.indexOf('recovery'), -1,
    'recovery must not be previewable — it is never chosen');
  /* DRIVEN, NOT READ. Asserting PURPOSE_SHAPE.speed.forceDistance === '5k'
     only says the constant is right; it says nothing about whether validate()
     applies it. Mutation testing caught exactly that -- dropping forceDistance
     from the resolution left every guard green while the server sent the
     generator a distance the speed block does not train. */
  const speed = Preview.validate({ purpose: 'speed', distanceKey: 'full', weeks: 6, volume: 50,
    activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.equal(speed.ok, true);
  assert.equal(speed.input.buildDistance, '5k',
    'a speed block must be built from the 5K profile whatever distance was asked for');
  const base = Preview.validate({ purpose: 'base', distanceKey: 'full', weeks: 10, volume: 50,
    activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.equal(base.input.buildDistance, 'full',
    'and a purpose with no forced distance must keep the athlete’s own');
  assert.equal(base.input.buildVolume, 50, 'base starts at what is absorbed, not above it');
  const maint = Preview.validate({ purpose: 'maintain', distanceKey: 'full', weeks: 8, volume: 50,
    activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.ok(maint.input.buildVolume < 50, 'maintenance must sit below what is absorbed');
  /* Race blocks are untouched by any of this. */
  const race = Preview.validate({ purpose: 'race', distanceKey: 'full', weeks: 14, volume: 50,
    activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.equal(race.input.buildDistance, 'full');
  assert.equal(race.input.buildVolume, 50);
  /* The one factor the preview restates rather than reads. If the engine's
     maintenance factor moves, this is what notices. */
  const spec = a.developmentBlockSpec('maintain', {});
  const absorbed = a.absorbedWeeklyVolume();
  assert.equal(Math.round(absorbed.km * Preview.PURPOSE_SHAPE.maintain.volumeFactor),
    spec.volume, 'the preview and the engine shape maintenance differently');
});

test('BUILDER: every distance the entry copy promises can actually be built', () => {
  const Preview = require(path.join(ROOT, 'api', '_preview.js'));
  const a = racingAthlete();
  /* The gateway promises "anything from a 5K to a 50K ultra". This is that
     sentence, executed. */
  a.DISTANCE_ORDER.forEach(k => {
    assert.ok(Preview.DISTANCES.indexOf(k) !== -1,
      k + ' can be built by the app but is refused by the preview');
    assert.ok(a.DISTANCE_PROFILES[k], k + ' has no profile');
  });
  assert.equal(Preview.DISTANCE_ALIASES.marathon, 'full',
    'the old client value must still resolve to a key the engine has');
  const v = Preview.validate({ distanceKey: 'marathon', weeks: 12, volume: 40,
    activeDays: [1,2,3,5,6], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.equal(v.ok, true);
  assert.equal(v.input.buildDistance, 'full',
    'THE MARATHON PREVIEW BUG: this used to reach buildBlockWeeks as "marathon" and throw');
});

// ===========================================================================
// 9. NOTHING NEW IN THE DATABASE
// ===========================================================================
test('the whole programme still needs no migration and no new function', () => {
  const before = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f[0] !== '_' && /\.js$/.test(f));
  assert.ok(before.length <= 12, 'the function budget is 12 on Hobby: ' + before.join(', '));
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /athlete: makeAthleteRecord\(\)|athlete: *makeAthleteRecord/,
    'the athlete record must still live inside the state that plans.data already stores');
});
