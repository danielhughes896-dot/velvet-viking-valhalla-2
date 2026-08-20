'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// A SESSION STAYS IN THE WEEK IT WAS RUN IN.
//
// The regression was not data loss. Three completed runs survived a rebuild
// with their ids, dates, logs and coach reviews intact, and then appeared on
// no screen -- while Plan HQ went on counting them, so "3/79 runs done" sat
// over a plan whose every visible week showed nothing done.
//
// The cause was upstream of both symptoms. handleGeneratePlan() re-anchored
// the block to today on EVERY rebuild. A completed session is by definition
// dated today-or-earlier, so a block that starts today puts all of its own
// history before its own week 1. The training had not moved; the block had
// been slid out from underneath it.
//
// The fix is blockAnchor(): a rebuild keeps the origin the block already has,
// and only a genuinely new block -- first ever, or after Reset Plan -- gets a
// fresh week 1. So there is no synthetic week, no history bucket, and nothing
// for the renderer or the counters to special-case.
//
// These tests drive the SHIPPED functions: blockAnchor,
// reconcileRegeneratedDays, handleSaveRecalibrate, computeStats, weekVolume,
// renderWeeksList.

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-08-21T09:00:00Z';

function appWithBlock(){
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays('2026-08-21', -28),
                 distanceKey: 'full', volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  return a;
}

/* Complete every past session, so the fixture covers more than one week. */
function completeAllPast(a){
  const t = a.todayStr();
  const past = a.state.days.filter(d => d.date < t && d.type !== 'rest');
  past.forEach((d, i) => {
    if (i % 2) return;                       // leave some genuinely missed
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 150, rpe: 5, feel: 'ok',
                 notes: 'logged', splits: [], paceUnit: 'km' };
    try { a.coachPersistReview(d); } catch (e) { /* review is optional evidence */ }
  });
  const done = a.state.days.filter(d => d.completed);
  const missed = past.filter(d => !d.completed);
  return {
    done: done.map(d => ({ id: d.id, date: d.date, week: d.week, km: d.km })),
    missed: missed.map(d => ({ id: d.id, date: d.date, week: d.week }))
  };
}

/* A REBUILD of the same block, exactly as handleGeneratePlan does it: the
   anchor comes from blockAnchor(), not from today. */
function rebuild(a, opts){
  const o = opts || {};
  const startDate = a.blockAnchor(a.state.setup.schedule.activeDays);
  const raceDate = o.raceDate || a.state.setup.raceDate;
  const weeks = a.daysBetween(a.addDays(startDate, -a.isoWeekday(startDate)),
                              a.addDays(raceDate, -a.isoWeekday(raceDate))) / 7 + 1;
  const block = a.buildBlockWeeks('full', o.volume || 60, weeks);
  const fresh = a.buildDaysFromWeeks(block, raceDate, a.state.setup.schedule, startDate, true);
  const rec = a.reconcileRegeneratedDays(a.state.days, fresh, startDate);
  a.state.days = rec.days;
  a.state.setup.startDate = startDate;
  a.state.setup.raceDate = raceDate;
  a.state.setup.planWeeks = block.planWeeks;
  a.initExpanded();
  return { startDate, preserved: rec.preserved };
}

/* Every day the Full Plan actually puts on screen, read out of the real
   markup rather than by re-implementing the loop. */
function daysRenderedInFullPlan(a){
  a.state.view = 'full';
  const html = a.renderWeeksList(true);
  return (html.match(/id="day-([0-9-]+)"/g) || [])
    .map(s => s.replace(/^id="day-/, '').replace(/"$/, ''));
}
function row(a, id){ return a.state.days.filter(d => d.id === id)[0]; }

// ===========================================================================
// PLACEMENT -- THE POINT OF ALL OF THIS
// ===========================================================================
test('a completed week 1 session is still in week 1 after a rebuild', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  const w1 = h.done.filter(d => d.week === 1);
  assert.ok(w1.length, 'the fixture completed nothing in week 1');
  rebuild(a);
  w1.forEach(d => assert.equal(row(a, d.id).week, 1,
    d.id + ' was completed in week 1 and is now in week ' + row(a, d.id).week));
});

test('a completed week N session is still in week N after a rebuild', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  const weeks = [...new Set(h.done.map(d => d.week))];
  assert.ok(weeks.length > 1, 'the fixture only covered one week');
  rebuild(a);
  h.done.forEach(d => assert.equal(row(a, d.id).week, d.week,
    d.id + ' moved from week ' + d.week + ' to week ' + row(a, d.id).week));
});

test('a missed historical session is still in its original week', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  assert.ok(h.missed.length, 'the fixture produced no missed sessions');
  rebuild(a);
  h.missed.forEach(d => {
    const r = row(a, d.id);
    assert.ok(r, 'missed session ' + d.id + ' disappeared');
    assert.equal(r.date, d.date, d.id + ' was re-dated');
  });
});

test('NO SESSION IS EVER ASSIGNED WEEK ZERO', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  const bad = a.state.days.filter(d => !(d.week >= 1));
  assert.equal(bad.length, 0,
    'sessions landed outside the block: ' + bad.map(d => d.id + '@' + d.week).join(', '));
});

test('there is no synthetic historical week anywhere in the rendered plan', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  const html = a.renderWeeksList(true);
  [/Earlier Training/i, /Before This Block/i, /Week 0\b/, /id="week-0"/]
    .forEach(re => assert.doesNotMatch(html, re,
      'a synthetic history bucket has reappeared: ' + re));
});

test('a rebuild keeps the block’s origin rather than re-anchoring to today', () => {
  const a = appWithBlock();
  const origin = a.state.setup.startDate;
  completeAllPast(a);
  const r = rebuild(a);
  assert.equal(r.startDate, origin, 'the rebuild moved the start of the block');
  assert.ok(r.startDate < a.todayStr(), 'the origin was pulled forward to today');
});

test('a rebuild of a block with NOTHING logged still keeps its origin', () => {
  /* The clamp cannot help here -- there is no history to clamp to. An athlete
     who builds a block, misses the first fortnight entirely and then re-tailors
     it must still be in week 3 of their block, not back at week 1. This is the
     case that proves the rebuild branch is doing its own work rather than
     being carried by the clamp underneath it. */
  const a = appWithBlock();
  const origin = a.state.setup.startDate;
  assert.equal(a.state.days.filter(d => a.dayCarriesHistory(d)).length, 0,
    'the fixture logged something — this test needs an untouched block');

  const anchor = a.blockAnchor(a.state.setup.schedule.activeDays);
  assert.equal(anchor, origin, 'a rebuild with no history was re-anchored to today');

  const weekNow = a.currentWeekNum();
  assert.ok(weekNow > 1, 'the fixture is not far enough into the block to prove anything');
});

test('every completed session is rendered, in its own week', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  rebuild(a);
  const rendered = daysRenderedInFullPlan(a);
  h.done.forEach(d => {
    assert.ok(rendered.indexOf(d.id) !== -1, d.id + ' is rendered nowhere');
    const inWeek = a.state.days.filter(x => x.week === d.week).map(x => x.id);
    assert.ok(inWeek.indexOf(d.id) !== -1, d.id + ' is not in week ' + d.week);
  });
});

test('a rebuild preserves identity, date, log and review', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  const r = rebuild(a);
  assert.equal(r.preserved, a.state.days.filter(d => a.dayCarriesHistory(d)).length);
  h.done.forEach(d => {
    const x = row(a, d.id);
    assert.ok(x, d.id + ' was destroyed');
    assert.equal(x.id, d.id, 'session identity was re-keyed');
    assert.equal(x.date, d.date, d.id + ' was re-dated');
    assert.equal(x.completed, true);
    assert.equal(x.actual.notes, 'logged', d.id + ' lost its log');
    assert.ok(x.coachReview, d.id + ' lost its execution review');
  });
});

// ===========================================================================
// COUNTS AND TOTALS
// ===========================================================================
test('weekly completed distance includes the sessions in that week', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    const expected = a.state.days
      .filter(d => d.week === w && d.completed)
      .reduce((s, d) => s + ((d.actual && d.actual.km != null) ? d.actual.km : (d.km || 0)), 0);
    assert.equal(a.weekVolume(w).done, a.round1(expected),
      'week ' + w + ' distance disagrees with its own sessions');
  }
});

test('the run count matches what the current block actually contains', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  const s = a.computeStats();
  const runs = a.state.days.filter(d => d.type !== 'rest');
  assert.equal(s.totalRuns, runs.length);
  assert.equal(s.completedRuns, runs.filter(d => d.completed).length);
});

test('the count and the weeks can never contradict each other', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  let visible = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++)
    visible += a.state.days.filter(d => d.week === w && d.completed).length;
  assert.equal(a.computeStats().completedRuns, visible,
    'Plan HQ claims completions no week of the plan shows');
  assert.ok(visible > 0, 'the fixture proved nothing — nothing was completed');
});

test('the block totals equal the sum of its weeks', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  let sum = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) sum += a.weekVolume(w).done;
  assert.equal(a.round1(sum), a.computeStats().completedKm);
});

// ===========================================================================
// A GENUINELY NEW BLOCK
// ===========================================================================
test('Reset Plan is what starts a genuinely new block, and it clears the old one', () => {
  const a = appWithBlock();
  completeAllPast(a);
  a.handleResetPlan();                    // the harness confirm() accepts
  assert.equal(a.state.setup, null);
  assert.equal(a.state.days.length, 0);
});

test('a genuinely new block does not inherit the previous block’s completions', () => {
  const a = appWithBlock();
  completeAllPast(a);
  assert.ok(a.computeStats().completedRuns > 0);

  a.handleResetPlan();
  buildPlan(a, { weeks: 14, startDate: a.addDays('2026-08-21', 1),
                 distanceKey: 'full', volume: 60, benchSec: 3 * 3600 + 15 * 60 });

  const s = a.computeStats();
  assert.equal(s.completedRuns, 0, 'the new block inherited ' + s.completedRuns + ' completions');
  assert.ok(a.state.days.every(d => d.week >= 1), 'the new block produced a week zero');
  assert.ok(a.state.days.every(d => !d.completed), 'the new block contains completed sessions');
});

test('a new block anchors to today; only a rebuild keeps an older origin', () => {
  const fresh = loadApp({ pinnedDate: TODAY });
  fresh.showToast = () => {};
  const days = fresh.state.setup && fresh.state.days ? fresh.state.days.length : 0;
  assert.equal(days, 0, 'the fixture app already had a plan');
  const anchor = fresh.blockAnchor([1, 3, 5, 6]);
  assert.ok(anchor >= fresh.todayStr(), 'a first build was anchored in the past');
});

test('logged training can never fall outside the block that holds it', () => {
  /* The floor under the whole design: if history somehow predates the stored
     origin -- a restored backup, an imported plan -- the block starts at that
     training instead. A week number is a position within a block, and there is
     no position before week 1. */
  const a = appWithBlock();
  completeAllPast(a);
  a.state.setup.startDate = a.addDays(a.state.setup.startDate, 21);   // corrupt the origin
  const anchor = a.blockAnchor(a.state.setup.schedule.activeDays);
  const earliest = a.state.days.filter(d => a.dayCarriesHistory(d))
    .map(d => d.date).sort()[0];
  assert.ok(anchor <= earliest,
    'the block starts after training it already contains (' + anchor + ' > ' + earliest + ')');
});

// ===========================================================================
// RECALIBRATION
// ===========================================================================
function driveRecalibrate(a, values){
  a.document.getElementById = function(id){
    return Object.prototype.hasOwnProperty.call(values, id) ? { value: values[id] } : null;
  };
  a.handleSaveRecalibrate();
}
const RECAL = { 'rc-bench-dist': 'half', 'rc-bench-time': '1:28:00',
                'rc-goal-A': '3:05:00', 'rc-goal-B': '', 'rc-goal-C': '' };

test('recalibration leaves every completed session in its own week', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  driveRecalibrate(a, RECAL);
  h.done.forEach(d => {
    const x = row(a, d.id);
    assert.ok(x, d.id + ' was deleted by recalibration');
    assert.equal(x.week, d.week, d.id + ' changed week');
    assert.equal(x.date, d.date, d.id + ' changed date');
    assert.equal(x.completed, true);
    assert.equal(x.actual.notes, 'logged', d.id + ' lost its log');
  });
});

test('recalibration changes no date, no week and no schedule', () => {
  const a = appWithBlock();
  completeAllPast(a);
  const before = a.state.days.map(d => [d.id, d.date, d.week, d.type, d.km].join('|')).join('\n');
  const sched = JSON.stringify(a.state.setup.schedule);
  const start = a.state.setup.startDate, race = a.state.setup.raceDate;

  driveRecalibrate(a, RECAL);

  assert.equal(a.state.days.map(d => [d.id, d.date, d.week, d.type, d.km].join('|')).join('\n'),
    before, 'recalibration moved a date, a week, a type or a distance');
  assert.equal(JSON.stringify(a.state.setup.schedule), sched);
  assert.equal(a.state.setup.startDate, start);
  assert.equal(a.state.setup.raceDate, race);
});

test('recalibration moves the targets, and only the targets', () => {
  const a = appWithBlock();
  const paces = JSON.stringify(a.getActivePaces());
  driveRecalibrate(a, RECAL);
  assert.equal(a.state.setup.goals.A.timeSec, 3 * 3600 + 5 * 60);
  assert.equal(a.state.setup.benchmark.timeSec, 88 * 60);
  assert.notEqual(JSON.stringify(a.getActivePaces()), paces,
    'the target paces did not move — recalibration did nothing');
});

test('recalibration touches no day, structurally', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function handleSaveRecalibrate\(\)\{[^]*?\n\}/.exec(src);
  assert.ok(fn, 'handleSaveRecalibrate is missing');
  [/state\.days/, /buildDaysFromWeeks/, /buildBlockWeeks/, /reconcileRegeneratedDays/,
   /blockAnchor/, /\.date\s*=/, /\.week\s*=/].forEach(re =>
    assert.doesNotMatch(fn[0], re, 'handleSaveRecalibrate now touches the schedule: ' + re));
});

// ===========================================================================
// PERSISTENCE
// ===========================================================================
test('placement survives a save and a reload', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  rebuild(a);
  const saved = JSON.stringify(a.state);

  const b = loadApp({ pinnedDate: TODAY });
  b.showToast = () => {};
  b.localStorage.setItem('velvet-viking-generator-v2', saved);
  b.loadState();

  h.done.forEach(d => {
    const x = b.state.days.filter(y => y.id === d.id)[0];
    assert.ok(x, d.id + ' did not survive the reload');
    assert.equal(x.week, d.week, d.id + ' changed week across a reload');
    assert.equal(x.date, d.date);
    assert.equal(x.completed, true);
    assert.ok(x.actual && x.actual.km != null, d.id + ' lost its log');
  });
  assert.equal(b.computeStats().completedRuns, a.computeStats().completedRuns);
});

// ===========================================================================
// THE REBUILD DOES ITS ACTUAL JOB
// ===========================================================================
test('a rebuild still re-plans the future', () => {
  /* Anchoring history must not turn a rebuild into a no-op: the sessions
     ahead of the athlete are what they came to change. */
  const a = appWithBlock();
  completeAllPast(a);
  const t = a.todayStr();
  const futureBefore = a.state.days.filter(d => d.date > t)
    .map(d => d.id + '|' + d.km + '|' + d.type).join('\n');
  rebuild(a, { volume: 85 });
  const futureAfter = a.state.days.filter(d => d.date > t)
    .map(d => d.id + '|' + d.km + '|' + d.type).join('\n');
  assert.notEqual(futureAfter, futureBefore, 'the rebuild changed nothing ahead of the athlete');
});

test('a rebuild produces no duplicate days', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  const seen = {};
  a.state.days.forEach(d => { seen[d.date] = (seen[d.date] || 0) + 1; });
  const dupes = Object.keys(seen).filter(k => seen[k] > 1);
  assert.equal(dupes.length, 0, 'duplicate days: ' + dupes.join(', '));
});

test('week numbering stays contiguous from one', () => {
  const a = appWithBlock();
  completeAllPast(a);
  rebuild(a);
  const weeks = [...new Set(a.state.days.map(d => d.week))].sort((x, y) => x - y);
  assert.equal(weeks[0], 1, 'the block does not start at week 1');
  weeks.forEach((w, i) => assert.equal(w, i + 1, 'a gap in week numbering at ' + w));
});

test('coaching evidence still sees every logged session', () => {
  const a = appWithBlock();
  const h = completeAllPast(a);
  rebuild(a);
  const seen = a.state.days.filter(d => d.completed && d.actual && d.actual.km != null);
  assert.equal(seen.length, h.done.length,
    'logged training is no longer visible to athlete-state reasoning');
});
