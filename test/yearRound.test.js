'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// YEAR-ROUND COACHING — ATHLETE != PLAN.
//
// A plan is a prescription with an end date. What the athlete actually did is
// not a property of that prescription, and must not end when it does.
//
// Before this programme every model in the product read state.days, and
// state.days IS the plan — so Reset Plan deleted the athlete's baselines,
// recovery patterns, volume tolerance and every measured performance, and the
// confirmation dialog said so.
//
// These tests drive the SHIPPED functions: athleteMemory, archiveCompletedSessions,
// handleResetPlan, startDevelopmentBlock, recordRaceOutcome, measuredProgression.

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-08-21T09:00:00Z';

function athleteWithBlock(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  buildPlan(a, { weeks: o.weeks || 14, startDate: a.addDays('2026-08-21', -(o.back || 70)),
                 distanceKey: o.distanceKey || 'full', volume: o.volume || 60,
                 benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  a.migrateAthleteRecord();
  return a;
}

/* Log most past sessions, leaving some genuinely missed. */
function trainThroughPast(a){
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach((d, i) => {
    if (i % 4 === 3) return;
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 150, rpe: 5, feel: 'ok',
                 notes: 'logged', splits: [], paceUnit: 'km' };
    try { a.coachPersistReview(d); } catch (e) {}
  });
  return a.state.days.filter(d => d.completed).map(d => ({ id: d.id, date: d.date, week: d.week }));
}

/* A genuinely NEW race block through the real generator, the way
   handleGeneratePlan does it — NOT through buildPlan, which replaces state
   wholesale to give each test a clean app and would wipe the athlete. */
function startRaceBlock(a, opts){
  const o = opts || {};
  const schedule = o.schedule || { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
  const startDate = a.firstActiveDayOnOrAfter(a.todayStr(), schedule.activeDays);
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const raceDate = a.addDays(startMonday, (o.weeks || 12) * 7 - 1);
  const weeks = a.daysBetween(startMonday, a.addDays(raceDate, -a.isoWeekday(raceDate))) / 7 + 1;
  const br = a.buildBlockWeeks(o.distanceKey || 'half', o.volume || 55, weeks);
  const days = a.buildDaysFromWeeks(br, raceDate, schedule, startDate, true);

  a.archiveCompletedSessions(a.state.setup && a.state.setup.blockId);
  if (a.state.setup && a.state.setup.blockId) a.closeBlock(a.state.setup.blockId, { reason: 'new_goal' });
  const block = a.openBlock({ purpose: 'race', startDate, distanceKey: o.distanceKey || 'half',
                              goalDate: raceDate, hasEvent: true });
  a.state.setup = Object.assign({}, a.state.setup, {
    distanceKey: o.distanceKey || 'half', currentVolume: o.volume || 55,
    raceDate, hasEvent: true, startDate, planWeeks: br.planWeeks, schedule,
    blockId: block.id, purpose: 'race'
  });
  a.state.days = days;
  a.initExpanded();
  return block;
}

// ===========================================================================
// ATHLETE MEMORY
// ===========================================================================
test('a fresh app has an athlete record, and it is empty rather than absent', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.ok(a.state.athlete, 'no athlete record');
  /* Length rather than deepEqual: these arrays are created inside the app's
     own VM realm, and node:assert refuses cross-realm reference equality even
     for structurally identical values. */
  assert.equal(a.state.athlete.sessions.length, 0);
  assert.equal(a.state.athlete.blocks.length, 0);
  assert.equal(a.state.athlete.performances.length, 0);
});

test('a save written before the athlete existed gains one, and adopts its plan', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const origin = a.state.setup.startDate;
  // strip it back to a pre-programme save
  delete a.state.athlete;
  delete a.state.setup.blockId;
  delete a.state.setup.purpose;
  a.migrateAthleteRecord();

  assert.ok(a.state.athlete, 'the record was not created');
  assert.equal(a.state.athlete.blocks.length, 1);
  const b = a.state.athlete.blocks[0];
  assert.equal(b.purpose, 'race', 'an existing plan must read as the race block it is');
  assert.equal(b.startDate, origin,
    'the adopted block was back-dated to today rather than to the plan’s own origin');
  assert.equal(a.state.setup.blockId, b.id);
});

test('RESET PLAN KEEPS THE ATHLETE AND CLEARS ONLY THE PRESCRIPTION', () => {
  const a = athleteWithBlock();
  const done = trainThroughPast(a);
  const before = a.athleteMemory().filter(r => r.completed).length;
  assert.ok(before > 10, 'the fixture trained too little to prove anything');

  a.handleResetPlan();

  assert.equal(a.state.setup, null, 'the prescription was not cleared');
  assert.equal(a.state.days.length, 0);
  assert.equal(a.athleteMemory().filter(r => r.completed).length, before,
    'Reset Plan destroyed athlete evidence');
  assert.equal(a.state.athlete.sessions.length, done.length);
  assert.equal(a.state.athlete.blocks[0].status, 'closed');
});

test('reset does not archive training nobody did', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const futureIds = a.state.days.filter(d => d.date > a.todayStr()).map(d => d.id);
  assert.ok(futureIds.length, 'the fixture has no future prescription');

  /* The cases that actually reach the memory WITHOUT having happened: a rest
     day carrying a readiness answer, and a future session the athlete accepted
     an adjustment for. Both are legitimately remembered as decisions and
     neither is training, so neither may be archived as training. Without these
     the fixture produced only completed records and the guard was never
     exercised at all. */
  const restDay = a.state.days.filter(d => d.type === 'rest' && d.date < a.todayStr())[0];
  assert.ok(restDay, 'no rest day to carry a readiness answer');
  restDay.athleteState = { state:'ready', score:1, reasons:[], at:new Date().toISOString() };
  const futureDay = a.state.days.filter(d => d.date > a.todayStr() && d.type !== 'rest')[0];
  futureDay.coachAdjust = { reason:'accepted ahead of time', evidence:[] };

  const admitted = a.athleteMemory(400);
  assert.ok(admitted.some(r => r.date === restDay.date),
    'the readiness answer is not in the memory, so this proves nothing');
  assert.ok(admitted.some(r => r.date === futureDay.date),
    'the accepted adjustment is not in the memory, so this proves nothing');
  assert.ok(admitted.some(r => !r.completed), 'no non-training record to archive by mistake');

  a.handleResetPlan();
  const archivedDates = a.state.athlete.sessions.map(s => s.date);
  futureIds.forEach(id => assert.ok(archivedDates.indexOf(id) === -1,
    'an abandoned future prescription was written into the athlete’s history as training'));
  assert.ok(a.state.athlete.sessions.every(s => s.completed),
    'something that did not happen was archived');
});

test('the reset confirmation no longer says it destroys logged runs', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function handleResetPlan\(\)\{[^]*?\n\}/.exec(src);
  assert.ok(fn);
  assert.doesNotMatch(fn[0], /all logged runs/i,
    'the dialog still promises to delete training the code now keeps');
  assert.match(fn[0], /archiveCompletedSessions/, 'reset no longer archives');
});

test('archiving is idempotent — a session is never filed twice', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const id = a.state.setup.blockId;
  const first = a.archiveCompletedSessions(id);
  const second = a.archiveCompletedSessions(id);
  assert.ok(first > 0);
  assert.equal(second, 0, 're-archiving added sessions');
  const dates = a.state.athlete.sessions.map(s => s.date);
  assert.equal(new Set(dates).size, dates.length, 'duplicate sessions in the athlete record');
});

test('MEMORY SURVIVES INTO THE NEXT BLOCK, and does not contaminate its counts', () => {
  const a = athleteWithBlock();
  const done = trainThroughPast(a);
  const before = a.athleteMemory().filter(r => r.completed).length;

  startRaceBlock(a);

  assert.equal(a.athleteMemory().filter(r => r.completed).length, before,
    'the new block cannot see the athlete’s previous training');
  const s = a.computeStats();
  assert.equal(s.completedRuns, 0,
    'the new block counted ' + s.completedRuns + ' completions it never ran');
  assert.ok(a.state.days.every(d => d.week >= 1), 'the new block produced a week zero');
  assert.equal(a.state.athlete.sessions.length, done.length);
});

test('the live plan wins any date it shares with the archive', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const live = a.state.days.filter(d => d.completed)[0];
  a.archiveCompletedSessions(a.state.setup.blockId);
  // corrupt the archived copy; the live day is the editable truth
  a.state.athlete.sessions.filter(s => s.date === live.date)
    .forEach(s => { s.actualKm = 999; });
  const rec = a.athleteMemory().filter(r => r.date === live.date);
  assert.equal(rec.length, 1, 'the same date appeared twice in the memory');
  assert.notEqual(rec[0].actualKm, 999, 'a stale archive entry shadowed the live plan');
});

test('multiple blocks never duplicate a completed activity', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  startRaceBlock(a);
  trainThroughPast(a);
  a.archiveCompletedSessions(a.state.setup.blockId);
  const dates = a.state.athlete.sessions.map(s => s.date);
  assert.equal(new Set(dates).size, dates.length, 'a session was archived by two blocks');
  const mem = a.athleteMemory().map(r => r.date);
  assert.equal(new Set(mem).size, mem.length, 'the memory reports a date twice');
});

test('memory and the block ledger survive a save and a reload', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  a.handleResetPlan();
  const saved = JSON.stringify(a.state);

  const b = loadApp({ pinnedDate: TODAY });
  b.showToast = () => {};
  b.localStorage.setItem('velvet-viking-generator-v2', saved);
  b.loadState();

  assert.equal(b.state.athlete.sessions.length, a.state.athlete.sessions.length);
  assert.equal(b.state.athlete.blocks.length, a.state.athlete.blocks.length);
  assert.equal(b.athleteMemory().filter(r => r.completed).length,
               a.athleteMemory().filter(r => r.completed).length);
});

// ===========================================================================
// BLOCK MODEL
// ===========================================================================
test('a block carries identity, purpose, dates and status', () => {
  const a = athleteWithBlock();
  const b = a.currentBlock();
  assert.ok(b && b.id);
  assert.equal(b.purpose, 'race');
  assert.equal(b.status, 'active');
  assert.ok(b.startDate);
  assert.equal(b.endDate, null);
});

test('every purpose is a real purpose, and race is the default', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.BLOCK_PURPOSES.slice().sort().join(','),
    'base,maintain,race,recovery,speed');
  assert.equal(a.isBlockPurpose('nonsense'), false);
  assert.equal(a.openBlock({ purpose: 'nonsense' }).purpose, 'race');
});

test('closing a block records how it ended and never touches its training', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const id = a.state.setup.blockId;
  a.archiveCompletedSessions(id);
  const n = a.state.athlete.sessions.length;
  a.closeBlock(id, { reason: 'transition' });
  assert.equal(a.blockById(id).status, 'closed');
  assert.equal(a.blockById(id).outcome.reason, 'transition');
  assert.equal(a.state.athlete.sessions.length, n, 'closing a block changed its training');
});

// ===========================================================================
// POST-RACE
// ===========================================================================
function raceJustPassed(a){
  /* Put the goal day a few days behind, and log it as run. */
  a.state.setup.raceDate = a.addDays(a.todayStr(), -3);
  a.state.setup.purpose = 'race';
  const day = a.state.days.filter(d => d.date < a.todayStr() && d.type !== 'rest').slice(-1)[0];
  day.date = a.state.setup.raceDate;
  day.id = day.date;
  day.type = 'race';
  day.km = 42.2;
  day.completed = true;
  day.actual = { km: 42.2, pace: '4:45', hr: 165, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  try { a.coachPersistReview(day); } catch (e) {}
  return day;
}

test('the outcome question is pending only once the goal day has passed', () => {
  const a = athleteWithBlock();
  assert.equal(a.raceOutcomePending(), false, 'asked before the race');
  raceJustPassed(a);
  assert.equal(a.raceOutcomePending(), true);
  a.recordRaceOutcome('raced');
  assert.equal(a.raceOutcomePending(), false, 'asked again after it was answered');
});

test('a DNS is not a completed race and produces no measurement', () => {
  const a = athleteWithBlock();
  const day = raceJustPassed(a);
  assert.equal(a.measuredPerformances().length, 1, 'the race did not register at all');
  a.recordRaceOutcome('dns');
  assert.equal(a.findDayByDate(day.date).completed, false, 'a DNS is still marked completed');
  assert.equal(a.measuredPerformances().length, 0, 'a DNS produced a fitness measurement');
});

test('a DNF keeps the training and stops being a measurement', () => {
  const a = athleteWithBlock();
  const day = raceJustPassed(a);
  a.recordRaceOutcome('dnf');
  assert.equal(a.findDayByDate(day.date).completed, true, 'a DNF erased training that happened');
  assert.equal(a.measuredPerformances().length, 0, 'a DNF was counted as a measured performance');
  const raw = a.state.athlete.performances.filter(p => p.date === day.date)[0];
  assert.ok(raw, 'the record was deleted rather than disqualified');
  assert.equal(raw.qualified, false);
  assert.equal(raw.disqualifiedReason, 'dnf');
});

test('DNF is never inferred from a short activity', () => {
  const a = athleteWithBlock();
  const day = raceJustPassed(a);
  day.actual.km = 30;          // well short of a marathon
  try { a.coachPersistReview(day); } catch (e) {}
  assert.equal(a.raceOutcomePending(), true, 'the app decided for itself what happened');
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function recordRaceOutcome\([^]*?\n\}/.exec(src);
  assert.doesNotMatch(fn[0], /km\s*[<>]/, 'DNF is being inferred from distance');
});

test('after a race, Next Move offers recovery rather than silence', () => {
  const a = athleteWithBlock();
  raceJustPassed(a);
  assert.equal(a.nextBlockRecommendation().kind, 'race_outcome');
  a.recordRaceOutcome('raced');
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'block');
  assert.equal(rec.purpose, 'recovery');
  assert.ok(rec.why);
});

test('a DNS is offered maintenance, not recovery from a race that never happened', () => {
  const a = athleteWithBlock();
  raceJustPassed(a);
  a.recordRaceOutcome('dns');
  assert.equal(a.nextBlockRecommendation().purpose, 'maintain');
});

// ===========================================================================
// RECOVERY BLOCK
// ===========================================================================
test('a recovery block prescribes no intensity inside its safety window', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  raceJustPassed(a);
  a.recordRaceOutcome('raced');
  const raceDate = a.state.setup.raceDate;

  const block = a.startDevelopmentBlock('recovery');
  assert.ok(block, 'the recovery block was not built');
  assert.equal(block.purpose, 'recovery');
  assert.equal(a.state.setup.purpose, 'recovery');
  assert.equal(a.state.setup.hasEvent, false, 'recovery must not carry a race countdown');

  const prof = a.recoveryProfileFor('full');
  const until = a.addDays(raceDate, prof.noIntensityDays);
  const hard = a.state.days.filter(d => d.date <= until &&
    ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'].indexOf(d.type) !== -1);
  assert.equal(hard.length, 0,
    'intensity prescribed inside the no-intensity window: ' + hard.map(d => d.date + ':' + d.type).join(', '));
});

test('recovery length and intensity window scale with the race distance', () => {
  const a = loadApp({ pinnedDate: TODAY });
  const order = ['5k', '10k', 'half', 'full', 'ultra'];
  let lastWeeks = 0, lastDays = 0;
  order.forEach(k => {
    const p = a.recoveryProfileFor(k);
    assert.ok(p.weeks >= lastWeeks, k + ' recovers for less time than a shorter race');
    assert.ok(p.noIntensityDays > lastDays, k + ' returns to intensity no later than a shorter race');
    lastWeeks = p.weeks; lastDays = p.noIntensityDays;
  });
});

test('the recovery ceiling is deterministic — no athlete evidence shortens it', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function applyRecoveryCeiling\([^]*?\n\}/.exec(src);
  assert.ok(fn);
  [/athleteResponseModel|athleteBaselines|familyRecoveryModel|coachLoad/,
   /readiness|athleteState|executionScore/].forEach(re =>
    assert.doesNotMatch(fn[0], re,
      'the safety window has become model-driven and can now be shortened by evidence'));
});

test('recovery keeps the athlete’s schedule, zones and goals', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  raceJustPassed(a);
  const sched = JSON.stringify(a.state.setup.schedule);
  const goals = JSON.stringify(a.state.setup.goals);
  const lthr = a.state.setup.lthr;
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  assert.equal(JSON.stringify(a.state.setup.schedule), sched);
  assert.equal(JSON.stringify(a.state.setup.goals), goals);
  assert.equal(a.state.setup.lthr, lthr);
});

test('starting recovery archives the race block rather than losing it', () => {
  const a = athleteWithBlock();
  const done = trainThroughPast(a);
  raceJustPassed(a);
  const raceBlockId = a.state.setup.blockId;
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  assert.equal(a.blockById(raceBlockId).status, 'closed');
  assert.ok(a.state.athlete.sessions.length >= done.length,
    'the race block’s training was not archived');
  assert.ok(a.athleteMemory().filter(r => r.completed).length > 0,
    'entering recovery lost the block that earned it');
});

// ===========================================================================
// DEVELOPMENT BLOCKS
// ===========================================================================
['maintain', 'base', 'speed'].forEach(purpose => {
  test(purpose + ' builds a real block with no race date', () => {
    const a = athleteWithBlock();
    trainThroughPast(a);
    const block = a.startDevelopmentBlock(purpose);
    assert.ok(block, purpose + ' did not build');
    assert.equal(block.purpose, purpose);
    assert.equal(a.state.setup.purpose, purpose);
    assert.equal(a.state.setup.hasEvent, false, purpose + ' carries a race countdown');
    assert.ok(a.state.days.length > 7, purpose + ' produced almost no training');
    assert.ok(a.state.days.every(d => d.week >= 1), purpose + ' produced a week zero');
    assert.ok(a.state.days.some(d => d.type !== 'rest'), purpose + ' produced no running');
  });
});

test('maintenance sits below what the athlete absorbs; base starts at it', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const absorbed = a.absorbedWeeklyVolume();
  assert.ok(absorbed.km > 0);
  const m = a.developmentBlockSpec('maintain');
  const b = a.developmentBlockSpec('base');
  assert.ok(m.volume < absorbed.km, 'maintenance is not lighter than full training');
  assert.equal(b.volume, absorbed.km, 'base does not start from what was absorbed');
});

test('speed development reuses the existing 5K methodology and invents none', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const spec = a.developmentBlockSpec('speed');
  assert.equal(spec.distanceKey, '5k',
    'speed work is not using the profile the product already has for it');
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(src, /lactate clearance/i,
    'the investigation rejected this name and it has appeared anyway');
});

test('no development block invents its own session methodology', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function startDevelopmentBlock\([^]*?\n\}/.exec(src)[0];
  assert.match(fn, /buildBlockWeeks\(/, 'a development block is not using the real generator');
  assert.match(fn, /buildDaysFromWeeks\(/);
  assert.doesNotMatch(fn, /interval|threshold|tempo|repetition/i,
    'startDevelopmentBlock is writing sessions of its own');
});

test('volume progression is not a percentage rule', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function developmentBlockSpec\([^]*?\n\}/.exec(src)[0];
  assert.doesNotMatch(fn, /1\.1\b|\*\s*1\.10|0\.1\s*\*/,
    'a ten-percent-a-week rule has appeared');
  assert.match(fn, /absorbedWeeklyVolume/, 'progression ignores what the athlete absorbed');
});

test('a development block cannot be built without a schedule to build it on', () => {
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  assert.equal(a.startDevelopmentBlock('maintain'), null);
  const b = athleteWithBlock();
  assert.equal(b.startDevelopmentBlock('race'), null, 'race must go through the builder');
  assert.equal(b.startDevelopmentBlock('nonsense'), null);
});

test('maintenance asks what is next rather than running forever', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  a.startDevelopmentBlock('maintain');
  /* Near the end of the block: the clock is pinned, so the block is trimmed
     to finish within the week instead. */
  const end = a.addDays(a.todayStr(), 3);
  a.state.days = a.state.days.filter(d => d.date <= end);
  a.state.setup.raceDate = end;
  const rec = a.nextBlockRecommendation();
  assert.ok(rec, 'maintenance ends in silence');
  assert.equal(rec.kind, 'choice');
  assert.ok(rec.options.indexOf('base') !== -1 && rec.options.indexOf('race') !== -1);
});

test('the recommendation recommends — it never acts', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  raceJustPassed(a);
  a.recordRaceOutcome('raced');
  const before = JSON.stringify(a.state.days.map(d => d.id + d.type));
  a.nextBlockRecommendation();
  a.nextBlockRecommendation();
  assert.equal(JSON.stringify(a.state.days.map(d => d.id + d.type)), before,
    'asking what comes next changed the plan');
});

// ===========================================================================
// MEASURED PROGRESSION
// ===========================================================================
test('a goal time can never masquerade as measured fitness', () => {
  const a = athleteWithBlock();
  trainThroughPast(a);
  const before = a.measuredPerformances().length;
  // the athlete becomes wildly more ambitious
  a.state.setup.goals = { A: { timeSec: 2 * 3600 + 30 * 60 } };
  assert.equal(a.measuredPerformances().length, before,
    'changing a goal created a fitness measurement');

  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  [/function performanceFromDay\([^]*?\n\}/, /function measuredProgression\([^]*?\n\}/]
    .forEach(re => {
      const fn = re.exec(src)[0];
      assert.doesNotMatch(fn, /getActiveVDOT|getActiveGoal|setup\.goals/,
        'measured fitness is reading the athlete’s goal');
    });
});

test('only a race or a checkpoint becomes a measurement', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const easy = a.state.days.filter(d => d.date < t && d.type === 'easy')[0];
  easy.completed = true;
  easy.actual = { km: easy.km, pace: '3:10', hr: 140, rpe: 3, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(easy);
  assert.equal(a.measuredPerformances().length, 0,
    'a very fast easy run was recorded as a measured performance');
  /* Asserted against performanceFromDay directly as well as through the write
     path. There are deliberately two guards -- one in the caller and one in
     the model -- and a test that only exercises the outer one lets the inner
     one rot. */
  assert.equal(a.performanceFromDay(easy), null,
    'the performance model itself accepts an ordinary training session');
  ['long', 'tempo', 'threshold', 'interval'].forEach(type => {
    const d = a.state.days.filter(x => x.date < t && x.type !== 'rest')[3];
    d.type = type; d.completed = true;
    d.actual = { km: 10, pace: '3:30', hr: 170, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
    assert.equal(a.performanceFromDay(d), null, type + ' became a measured performance');
  });
});

test('a checkpoint time trial is a measurement', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const d = a.state.days.filter(x => x.date < t && x.type !== 'rest')[0];
  d.type = 'checkpoint';
  d.km = 5;
  d.completed = true;
  d.actual = { km: 5, pace: '4:00', hr: 175, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(d);
  const p = a.measuredPerformances();
  assert.equal(p.length, 1);
  assert.equal(p[0].source, 'checkpoint');
  assert.equal(p[0].timeSec, 1200);
  assert.ok(p[0].vdot > 0);
});

test('re-logging the same effort corrects it rather than adding a second point', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const d = a.state.days.filter(x => x.date < t && x.type !== 'rest')[0];
  d.type = 'checkpoint'; d.km = 5; d.completed = true;
  d.actual = { km: 5, pace: '4:00', hr: 175, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(d);
  d.actual.pace = '3:55';
  a.coachPersistReview(d);
  assert.equal(a.measuredPerformances().length, 1, 'a correction created a second fitness point');
  assert.equal(a.measuredPerformances()[0].timeSec, 1175);
});

test('progression needs two measurements before it says anything', () => {
  const a = athleteWithBlock();
  assert.equal(a.measuredProgression().enough, false);
});

test('progression reports movement between two efforts actually run', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const days = a.state.days.filter(x => x.date < t && x.type !== 'rest');
  [['4:10', days[0]], ['4:00', days[8]]].forEach(([pace, d]) => {
    d.type = 'checkpoint'; d.km = 5; d.completed = true;
    d.actual = { km: 5, pace, hr: 175, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
    a.coachPersistReview(d);
  });
  const prog = a.measuredProgression();
  assert.equal(prog.enough, true);
  assert.equal(prog.points.length, 2);
  assert.equal(prog.improved, true, 'a faster time trial did not register as improvement');
  assert.ok(prog.spanDays > 0);
});

test('a fitness estimate is a range, from a measurement, or nothing', () => {
  const a = athleteWithBlock();
  assert.equal(a.measuredFitnessEstimate('10k'), null, 'estimated with no evidence at all');
  const t = a.todayStr();
  const d = a.state.days.filter(x => x.date < t && x.type !== 'rest')[0];
  d.type = 'checkpoint'; d.km = 5; d.completed = true;
  d.actual = { km: 5, pace: '4:00', hr: 175, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(d);
  const e = a.measuredFitnessEstimate('10k');
  assert.ok(e && !e.withheld);
  assert.ok(e.fastSec < e.slowSec, 'the estimate is a single number, not a range');
  assert.equal(e.fromDate, d.date);
});

test('MARATHON IS WITHHELD unless the athlete’s own volume supports it', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const d = a.state.days.filter(x => x.date < t && x.type !== 'rest')[0];
  d.type = 'checkpoint'; d.km = 5; d.completed = true;
  d.actual = { km: 5, pace: '3:40', hr: 178, rpe: 10, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(d);
  const m = a.measuredFitnessEstimate('full');
  assert.ok(m, 'no answer at all');
  assert.equal(m.withheld, true,
    'a fast 5K alone was turned into a marathon prediction');
  assert.ok(m.reason);
});

test('an estimate does not move because of one ordinary easy run', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const d = a.state.days.filter(x => x.date < t && x.type !== 'rest')[0];
  d.type = 'checkpoint'; d.km = 5; d.completed = true;
  d.actual = { km: 5, pace: '4:00', hr: 175, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(d);
  const before = JSON.stringify(a.measuredFitnessEstimate('10k'));

  const easy = a.state.days.filter(x => x.date < t && x.type === 'easy')[0];
  easy.completed = true;
  easy.actual = { km: easy.km, pace: '3:05', hr: 130, rpe: 2, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  a.coachPersistReview(easy);

  assert.equal(JSON.stringify(a.measuredFitnessEstimate('10k')), before,
    'a single easy run moved the fitness estimate');
});

/* THE GUARD SCANS CODE, NOT THE PROSE BESIDE IT.

   This asserted against the raw file, so the comment explaining that Measured
   Fitness carries "no CTL, no ATL, no TSB" failed it -- the sentence promising
   the rule and a violation of the rule were indistinguishable to a regex.
   Weakening the rule would have been the wrong fix twice over: the rule is
   right, and a scan that cannot survive being documented is not much of a scan.

   Comments are stripped; STRING LITERALS ARE NOT, so an athlete-facing "TSB"
   still fails exactly as it should. Only whole-line `//` comments go, because
   `//` also appears in every URL in the file. */
function runtimeCode(){
  return fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[^]*?\*\//g, '')
    .replace(/<!--[^]*?-->/g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '');
}
test('CTL, ATL and TSB are not exposed, and no Banister model appeared', () => {
  const code = runtimeCode();
  [/\bCTL\b/, /\bATL\b/, /\bTSB\b/, /banister/i].forEach(re =>
    assert.doesNotMatch(code, re, 'a rejected fitness/fatigue concept has appeared'));
});

test('stripping comments does not blind the concept guard', () => {
  /* The scan above is only worth anything if it would still catch a real one.
     Same two replacements, run over a sample that contains both shapes. */
  const strip = s => s.replace(/\/\*[^]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*$/gm, '');
  const sample = 'var a=1; /* no TSB here */\n  // and no CTL either\nvar msg = "Your TSB is 4";';
  assert.doesNotMatch(strip(sample), /here|either/, 'comments must be gone');
  assert.match(strip(sample), /"Your TSB is 4"/,
    'but anything an athlete could read must survive the strip');
  assert.match(strip(sample), /\bTSB\b/, 'so the guard would still fail on it');
});

// ===========================================================================
// PRESERVED BEHAVIOUR
// ===========================================================================
test('a race block is still generated exactly as it was', () => {
  const a = athleteWithBlock();
  const b = loadApp({ pinnedDate: TODAY });
  b.showToast = () => {};
  buildPlan(b, { weeks: 14, startDate: b.addDays('2026-08-21', -70),
                 distanceKey: 'full', volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  const shape = x => x.state.days.map(d =>
    [d.date, d.week, d.type, d.km, d.title].join('|')).join('\n');
  assert.equal(shape(a), shape(b), 'the year-round programme changed race-plan generation');
});

test('pace and HR targets are untouched', () => {
  const a = athleteWithBlock();
  const t = a.todayStr();
  const sample = a.state.days.filter(d => d.date > t && d.type !== 'rest').slice(0, 12);
  sample.forEach(d => {
    assert.ok(a.executionPaceTarget(d) !== undefined);
    assert.ok(a.executionHRTarget(d) !== undefined);
  });
  assert.ok(JSON.stringify(a.getActivePaces()).length > 10);
});

test('the history-placement fix is intact and week zero has not returned', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /function blockAnchor\(/, 'blockAnchor is gone');
  assert.doesNotMatch(src, /dd\.week = 0/, 'the week-zero design has been resurrected');
  assert.doesNotMatch(src, /Earlier Training/, 'the synthetic history bucket is back');
});

test('the athlete record adds no new serverless function and no new table', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12);
  /* The athlete lives inside state, which already round-trips through
     plans.data with RLS that has been live since 3A1. No migration, no second
     source of truth, and backup/restore carries it for free. */
  const sql = fs.readdirSync(ROOT).filter(f => /^supabase-.*\.sql$/.test(f));
  sql.forEach(f => assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'),
    /create table if not exists public\.(athlete|athlete_sessions|training_blocks)/i,
    f + ' creates a competing athlete table'));
});
