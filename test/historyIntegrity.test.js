'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// TRAINING HISTORY MUST NOT DISAPPEAR.
//
// The regression these protect against was not data loss. Three completed runs
// survived a plan regeneration intact -- same ids, same dates, same logs, same
// coach reviews -- and then appeared on NO SCREEN, because
// reconcileRegeneratedDays() marks pre-block history `week 0` and every week
// loop in the product runs 1..totalWeeks. Meanwhile computeStats() walks
// state.days directly, so Plan HQ counted them: "3/79 runs done" on a block
// whose every visible week showed nothing completed.
//
// Two failures, one cause. A numerator from the old block over a denominator
// from the new one, and completed training with nowhere to be seen.
//
// So these tests assert both halves, and they assert them against the SHIPPED
// functions -- reconcileRegeneratedDays, computeStats, renderWeeksList -- not
// against a paraphrase.

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-08-21T09:00:00Z';

function appWithBlock(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  buildPlan(a, { weeks: o.weeks || 14, startDate: a.addDays('2026-08-21', -28),
                 distanceKey: 'full', volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  return a;
}

/* Complete n past sessions through the app's own review path. */
function completePast(a, n){
  const t = a.todayStr();
  const past = a.state.days.filter(d => d.date < t && d.type !== 'rest').slice(0, n);
  past.forEach(d => {
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 150, rpe: 5, feel: 'ok',
                 notes: 'logged', splits: [], paceUnit: 'km' };
    try { a.coachPersistReview(d); } catch (e) { /* review is optional evidence */ }
  });
  return past.map(d => ({ id: d.id, date: d.date, km: d.km, week: d.week }));
}

/* Generate a genuinely NEW block from today, the way handleGeneratePlan does:
   fresh days, then reconcileRegeneratedDays over the old ones. */
function regenerate(a){
  const startDate = a.firstActiveDayOnOrAfter(a.todayStr(), a.state.setup.schedule.activeDays);
  const raceDate = a.addDays(startDate, 14 * 7);
  const weeks = a.daysBetween(a.addDays(startDate, -a.isoWeekday(startDate)),
                              a.addDays(raceDate, -a.isoWeekday(raceDate))) / 7 + 1;
  const block = a.buildBlockWeeks('full', 60, weeks);
  const fresh = a.buildDaysFromWeeks(block, raceDate, a.state.setup.schedule, startDate, true);
  const rec = a.reconcileRegeneratedDays(a.state.days, fresh, startDate);
  a.state.days = rec.days;
  a.state.setup.startDate = startDate;
  a.state.setup.raceDate = raceDate;
  a.state.setup.planWeeks = block.planWeeks;
  a.initExpanded();
  return { startDate, preserved: rec.preserved };
}

/* Every day the Full Plan actually puts on screen, by parsing the real
   markup rather than by re-implementing the loop the bug lived in. */
function daysRenderedInFullPlan(a){
  a.state.view = 'plan';
  const html = a.renderWeeksList(true);
  return (html.match(/id="day-([0-9-]+)"/g) || [])
    .map(s => s.replace(/^id="day-/, '').replace(/"$/, ''));
}

// ===========================================================================
// COMPLETING A SESSION DOES NOT REMOVE IT
// ===========================================================================
test('completing a session does not remove it from its week', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  done.forEach(d => {
    const week = a.state.days.filter(x => x.week === d.week);
    assert.ok(week.some(x => x.id === d.id),
      d.id + ' left its own week when it was completed');
  });
});

test('completing a session does not remove it from Full Plan', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  const rendered = daysRenderedInFullPlan(a);
  done.forEach(d => assert.ok(rendered.indexOf(d.id) !== -1,
    d.id + ' is completed and appears nowhere in Full Plan'));
});

test('a completed session keeps its log and its execution review', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  done.forEach(d => {
    const row = a.state.days.filter(x => x.id === d.id)[0];
    assert.ok(row, d.id + ' vanished');
    assert.equal(row.completed, true);
    assert.ok(row.actual && row.actual.km != null, d.id + ' lost its log');
    assert.equal(row.actual.notes, 'logged');
  });
});

test('a missed session stays represented, exactly as a completed one must', () => {
  /* The asymmetry the report called out: it is not acceptable for a missed
     session to survive while a completed one silently disappears. */
  const a = appWithBlock();
  completePast(a, 3);
  const t = a.todayStr();
  const missed = a.state.days.filter(d => d.date < t && d.type !== 'rest' && !d.completed);
  assert.ok(missed.length, 'the fixture produced no missed sessions to check');
  const rendered = daysRenderedInFullPlan(a);
  missed.slice(0, 5).forEach(d => assert.ok(rendered.indexOf(d.id) !== -1,
    'missed session ' + d.id + ' is not rendered'));
});

// ===========================================================================
// PERSISTENCE
// ===========================================================================
test('completed history survives a save and a reload', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  /* The real round trip: the app's own serialisation into the app's own
     storage key, read back through the app's own loadState() so the migration
     path runs exactly as it does on a cold start. */
  const saved = JSON.stringify(a.state);

  const b = loadApp({ pinnedDate: TODAY });
  b.showToast = () => {};
  b.localStorage.setItem('velvet-viking-generator-v2', saved);
  b.loadState();

  const reloaded = b.state.days.filter(d => d.completed);
  assert.equal(reloaded.length, done.length, 'a reload lost completed sessions');
  done.forEach(d => {
    const row = b.state.days.filter(x => x.id === d.id)[0];
    assert.ok(row, d.id + ' did not survive the reload');
    assert.equal(row.date, d.date, d.id + ' changed date across a reload');
    assert.equal(row.completed, true);
    assert.ok(row.actual && row.actual.km != null, d.id + ' lost its log across a reload');
  });
});

// ===========================================================================
// RECALIBRATION -- THE PROMISE THE UI MAKES
// ===========================================================================
/* "your schedule, dates and logged history stay exactly as they are; only your
   target paces move." Driven through the REAL handler, with the four inputs it
   reads stubbed onto the harness document. */
function driveRecalibrate(a, values){
  a.document.getElementById = function(id){
    if (Object.prototype.hasOwnProperty.call(values, id)) return { value: values[id] };
    return null;
  };
  a.handleSaveRecalibrate();
}

test('recalibration does not delete, re-key or orphan a completed session', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  const before = JSON.stringify(a.state.days);

  driveRecalibrate(a, { 'rc-bench-dist': 'half', 'rc-bench-time': '1:28:00',
                        'rc-goal-A': '3:05:00', 'rc-goal-B': '', 'rc-goal-C': '' });

  done.forEach(d => {
    const row = a.state.days.filter(x => x.id === d.id)[0];
    assert.ok(row, d.id + ' was deleted by recalibration');
    assert.equal(row.id, d.id, 'session identity was re-keyed by recalibration');
    assert.equal(row.completed, true);
    assert.ok(row.actual && row.actual.km != null, d.id + ' lost its log');
    assert.equal(row.actual.notes, 'logged');
  });
  assert.equal(a.state.days.length, JSON.parse(before).length,
    'recalibration changed how many sessions exist');
});

test('recalibration changes no date and no schedule', () => {
  const a = appWithBlock();
  completePast(a, 3);
  const before = a.state.days.map(d => d.id + '|' + d.date + '|' + d.week + '|' + d.type + '|' + d.km);
  const schedBefore = JSON.stringify(a.state.setup.schedule);
  const startBefore = a.state.setup.startDate, raceBefore = a.state.setup.raceDate;

  driveRecalibrate(a, { 'rc-bench-dist': 'half', 'rc-bench-time': '1:28:00',
                        'rc-goal-A': '3:05:00', 'rc-goal-B': '', 'rc-goal-C': '' });

  const after = a.state.days.map(d => d.id + '|' + d.date + '|' + d.week + '|' + d.type + '|' + d.km);
  assert.equal(after.join('\n'), before.join('\n'),
    'recalibration moved a date, a week, a session type or a distance');
  assert.equal(JSON.stringify(a.state.setup.schedule), schedBefore);
  assert.equal(a.state.setup.startDate, startBefore);
  assert.equal(a.state.setup.raceDate, raceBefore);
});

test('recalibration changes the targets, and only the targets', () => {
  const a = appWithBlock();
  const paceBefore = JSON.stringify(a.getActivePaces());

  driveRecalibrate(a, { 'rc-bench-dist': 'half', 'rc-bench-time': '1:28:00',
                        'rc-goal-A': '3:05:00', 'rc-goal-B': '', 'rc-goal-C': '' });

  assert.equal(a.state.setup.goals.A.timeSec, 3 * 3600 + 5 * 60, 'the goal did not move');
  assert.equal(a.state.setup.benchmark.timeSec, 88 * 60, 'the benchmark did not move');
  assert.notEqual(JSON.stringify(a.getActivePaces()), paceBefore,
    'the target paces did not move — recalibration did nothing');
});

test('recalibration touches no day, structurally', () => {
  /* The behavioural tests above prove the current implementation. This one
     stops a future edit reaching for the plan builder from inside the handler,
     which is how "only your paces move" would quietly stop being true. */
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const fn = /function handleSaveRecalibrate\(\)\{[^]*?\n\}/.exec(src);
  assert.ok(fn, 'handleSaveRecalibrate is missing');
  [/state\.days/, /buildDaysFromWeeks/, /buildBlockWeeks/, /reconcileRegeneratedDays/,
   /\.date\s*=/, /\.week\s*=/].forEach(re =>
    assert.doesNotMatch(fn[0], re,
      'handleSaveRecalibrate now touches the schedule: ' + re));
});

// ===========================================================================
// A NEW BLOCK, AND THE HISTORY BEFORE IT
// ===========================================================================
test('regenerating preserves every completed session, byte for byte', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  const rec = regenerate(a);
  assert.equal(rec.preserved, 3);
  done.forEach(d => {
    const row = a.state.days.filter(x => x.id === d.id)[0];
    assert.ok(row, d.id + ' was destroyed by regeneration');
    assert.equal(row.date, d.date, d.id + ' was re-dated');
    assert.equal(row.completed, true);
    assert.ok(row.actual && row.actual.km != null, d.id + ' lost its log');
    assert.ok(row.coachReview, d.id + ' lost its execution review');
  });
});

test('CARRIED-OVER HISTORY IS REACHABLE: it renders in Full Plan', () => {
  /* THE REGRESSION. Before the fix these three rows existed in state.days,
     carried week 0, and appeared on no screen in the product. */
  const a = appWithBlock();
  const done = completePast(a, 3);
  regenerate(a);

  const carried = a.state.days.filter(d => d.week === 0);
  assert.equal(carried.length, 3, 'the fixture did not produce carried-over history');

  const rendered = daysRenderedInFullPlan(a);
  done.forEach(d => assert.ok(rendered.indexOf(d.id) !== -1,
    'completed session ' + d.id + ' survived regeneration but is rendered nowhere'));
});

test('carried-over history is labelled as earlier training, not as week zero', () => {
  const a = appWithBlock();
  completePast(a, 3);
  regenerate(a);
  const html = a.renderWeeksList(true);
  assert.match(html, /Earlier Training/, 'the carried-over group has no heading');
  assert.match(html, /Before This Block/, 'the carried-over week is not named');
  assert.doesNotMatch(html, /Week 0\b/, 'carried-over history is presented as a week of this block');
});

test('a new block does not inherit the previous block’s completions', () => {
  /* "3/79 RUNS DONE" on a block where nothing had been completed. The
     numerator came from the old block; the denominator from the new one. */
  const a = appWithBlock();
  completePast(a, 3);
  assert.equal(a.computeStats().completedRuns, 3, 'the fixture never completed anything');

  regenerate(a);
  const s = a.computeStats();
  assert.equal(s.completedRuns, 0,
    'the new block counted ' + s.completedRuns + ' completed runs it never ran');
});

test('the run count agrees with the sessions the plan actually contains', () => {
  const a = appWithBlock();
  completePast(a, 3);
  regenerate(a);
  const s = a.computeStats();

  const inBlock = a.state.days.filter(d => d.week >= 1 && d.type !== 'rest');
  assert.equal(s.totalRuns, inBlock.length,
    'the denominator does not match the block’s own sessions');
  assert.equal(s.completedRuns, inBlock.filter(d => d.completed).length,
    'the numerator does not match the block’s own completed sessions');
});

test('the count and the weeks can never contradict each other', () => {
  /* The contradiction as the athlete saw it: a non-zero "runs done" over a
     plan in which every single week showed nothing done. Asserted as the
     relationship rather than as two numbers. */
  const a = appWithBlock();
  completePast(a, 3);
  regenerate(a);

  let visibleCompleted = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++)
    visibleCompleted += a.state.days.filter(d => d.week === w && d.completed).length;
  assert.equal(a.computeStats().completedRuns, visibleCompleted,
    'Plan HQ claims completions that no week of the plan shows');
});

test('weekly completed distance matches that week’s own completed sessions', () => {
  const a = appWithBlock();
  completePast(a, 3);
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    const vol = a.weekVolume(w);
    const expected = a.state.days
      .filter(d => d.week === w && d.completed)
      .reduce((s, d) => s + ((d.actual && d.actual.km != null) ? d.actual.km : (d.km || 0)), 0);
    assert.equal(vol.done, a.round1(expected),
      'week ' + w + ' reports ' + vol.done + ' km done but its sessions total ' + expected);
  }
});

test('the block totals equal the sum of its weeks', () => {
  const a = appWithBlock();
  completePast(a, 3);
  regenerate(a);
  let sumDone = 0;
  for (let w = 1; w <= a.totalWeeksInPlan(); w++) sumDone += a.weekVolume(w).done;
  assert.equal(a.round1(sumDone), a.computeStats().completedKm,
    'the headline completed distance and the weeks disagree');
});

// ===========================================================================
// ATHLETE STATE STILL SEES THE EVIDENCE
// ===========================================================================
test('carried-over history stays available to trend and load reasoning', () => {
  /* Excluding week 0 from the BLOCK COUNTS must not exclude it from the
     coaching evidence -- those read state.days directly, and losing real
     training from them would be a methodology change, not a counting fix. */
  const a = appWithBlock();
  const done = completePast(a, 3);
  regenerate(a);
  const seen = a.state.days.filter(d => d.completed && d.actual && d.actual.km != null);
  assert.equal(seen.length, done.length,
    'the completed sessions are no longer visible to athlete-state reasoning');
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const guard = /if \(dd\.week === 0\) return;/g;
  assert.equal((src.match(guard) || []).length, 1,
    'the week-0 exclusion has spread beyond computeStats() into coaching evidence');
});

// ===========================================================================
// MUTATION GUARDS ON IDENTITY
// ===========================================================================
test('regeneration must not re-key a session, and a re-key must fail loudly', () => {
  const a = appWithBlock();
  const done = completePast(a, 3);
  const idsBefore = done.map(d => d.id).sort();
  regenerate(a);
  const idsAfter = a.state.days.filter(d => d.week === 0).map(d => d.id).sort();
  assert.equal(idsAfter.join(','), idsBefore.join(','),
    'regeneration changed the identity of completed sessions');

  /* And the identity IS the date, which is what makes it stable across a
     rebuild -- a generated key would be regenerated. */
  a.state.days.filter(d => d.week === 0)
    .forEach(d => assert.equal(d.id, d.date,
      'session identity is no longer derived from the date and can now drift'));
});

test('history is matched by date, so a rebuilt day cannot duplicate it', () => {
  const a = appWithBlock();
  completePast(a, 3);
  regenerate(a);
  const byDate = {};
  a.state.days.forEach(d => { byDate[d.date] = (byDate[d.date] || 0) + 1; });
  const dupes = Object.keys(byDate).filter(k => byDate[k] > 1);
  assert.equal(dupes.length, 0, 'regeneration produced duplicate days: ' + dupes.join(', '));
});

test('reconciliation keeps history out of the new block’s week numbering', () => {
  const a = appWithBlock();
  completePast(a, 3);
  const rec = regenerate(a);
  a.state.days.filter(d => d.week === 0).forEach(d =>
    assert.ok(d.date < rec.startDate,
      d.id + ' is marked carried-over but falls inside this block'));
  a.state.days.filter(d => d.week >= 1).forEach(d =>
    assert.ok(d.date >= rec.startDate,
      d.id + ' is inside this block but predates its start'));
});
