'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* APP UPDATE IS NOT PLAN REGENERATION, AND A REGENERATION IS NOT A REWRITE OF
 * THE PAST.
 *
 * THE DEFECT THIS FILE EXISTS FOR. On 21 August an athlete's This Week showed
 * elapsed days carrying sessions they had never been given: a Monday rest day
 * had become an easy run, a Wednesday easy run had become a rest day, and a
 * Thursday fitness checkpoint had become an easy run. Tuesday alone survived,
 * for no better reason than that it happened to carry an accepted adjustment.
 *
 * reconcileRegeneratedDays() decided what to keep by asking dayCarriesHistory()
 * -- did the athlete leave a TRACE here. A MISSED SESSION HAS NO TRACE. So the
 * one kind of elapsed day the athlete has nothing to show for was the one kind
 * a rebuild treated as an empty slot and refilled.
 *
 * The rule is not "hide dates before today". Past training is evidence and must
 * remain on screen, historically truthful. What must not happen is the calendar
 * behind the athlete being rewritten because the workout library, the
 * generator, an archetype or the app version changed.
 *
 * A past session may still change through a deliberate historical action --
 * the athlete logging or editing it, an import reconciling it, an adjustment
 * that genuinely happened at that time. Those paths are tested elsewhere and
 * are not touched here.
 */

const TODAY = '2026-08-21';                       // the Friday it was reported on
const MONDAY = '2026-08-17';
const QUALITY = ['threshold', 'tempo', 'interval', 'repetition', 'checkpoint', 'race'];

function app() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}

/* THE ATHLETE IN THE BRIEF, built once and reused.
 *   1. a programme generated under the previous workout model
 *   2. sessions completed
 *   3. sessions missed
 *   4. an accepted adjustment
 *   5. several calendar days crossed
 * Step 6 -- loading the newer implementation -- is what each test then does. */
function athlete(opts) {
  const o = opts || {};
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28), distanceKey: 'half',
                 volume: 55, benchSec: 45 * 60,
                 schedule: o.schedule || { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });

  // (2) completed: everything before this week, logged and reviewed
  a.state.days.filter(d => d.date < MONDAY && d.type !== 'rest').forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:00', rpe: 6, notes: 'logged' });
    try { a.coachPersistReview(dd); } catch (e) {}
  });
  // (3) missed: this week's elapsed training days are simply not run...
  const week = a.state.days.filter(d => d.date >= MONDAY && d.date < TODAY && d.type !== 'rest');
  // (4) ...except one, which carries an adjustment the athlete accepted at the time
  if (week[0]) week[0].coachAdjust = {
    at: '2026-08-18T09:00:00Z', reason: 'Load 1.31x 4-week average', evidence: [], state: 'modify',
    from: { km: week[0].km, type: week[0].type, title: week[0].title, desc: week[0].desc,
            prescription: week[0].prescription ? JSON.parse(JSON.stringify(week[0].prescription)) : null }
  };
  // (1) the previous workout model: elapsed days predate structured workouts
  if (o.oldModel) a.state.days.forEach(d => { if (d.date < TODAY) delete d.prescription; });
  return a;
}

const snapshot = a => a.state.days.filter(d => d.date < TODAY).map(d => ({
  id: d.id, date: d.date, type: d.type, title: d.title, km: d.km, desc: d.desc,
  arch: (d.prescription || {}).archetype || null,
  completed: !!d.completed, notes: (d.actual || {}).notes || '',
  adjusted: !!d.coachAdjust, review: !!d.coachReview
}));

/* A rebuild of the same block, exactly as handleGeneratePlan performs one:
   the anchor comes from blockAnchor(), never from today. */
let LAST_BLOCK = null;
function rebuild(a, o) {
  o = o || {};
  const schedule = o.schedule || a.state.setup.schedule;
  const anchor = a.blockAnchor(schedule.activeDays, true);
  const weeks = a.daysBetween(a.addDays(anchor, -a.isoWeekday(anchor)),
    a.addDays(a.state.setup.raceDate, -a.isoWeekday(a.state.setup.raceDate))) / 7 + 1;
  const br = a.buildBlockWeeks(o.distanceKey || 'half', o.volume || 55, weeks);
  const fresh = a.buildDaysFromWeeks(br, a.state.setup.raceDate, schedule, anchor, false);
  const rec = a.reconcileRegeneratedDays(a.state.days, fresh, anchor);
  a.state.days = rec.days;
  a.state.setup.schedule = schedule;
  LAST_BLOCK = br;
  return rec;
}
/* THE WEEK'S QUALITY CAP IS NO LONGER A CONSTANT, AND THESE TESTS MUST NOT
   PRETEND IT IS. When they were written a five-day week was given two quality
   sessions unconditionally, so "the cap" could be spelled 2. Quality frequency
   is now earned from the athlete's own logged response, and with no such
   evidence the cap is one. The invariant under test never mentioned a number:
   the calendar week must not end up holding more quality than the architecture
   permits, and the surplus must come out of the FUTURE half. Read from the
   block the rebuild actually used, so it stays true at either value. */
const capOf = () => (LAST_BLOCK && LAST_BLOCK.qualityFrequency
  ? LAST_BLOCK.qualityFrequency.prescribed : 1);
/* A schedule change that moves the generator's quality day INTO the future
   half of the current week, which is the only arrangement that can produce the
   stacking these three tests exist for. The original pairing put it on a
   Thursday the athlete had already lived through, so the case never arose. */
const MOVES_QUALITY_FORWARD = { activeDays: [0, 1, 3, 4, 6], longRunDay: 1 };
const diff = (before, after) => {
  const by = {}; before.forEach(d => { by[d.date] = d; });
  const out = [];
  after.forEach(d => {
    const b = by[d.date];
    if (!b) { out.push('INVENTED ' + d.date + ' ' + d.title); return; }
    if (b.title !== d.title || b.type !== d.type || b.km !== d.km || b.desc !== d.desc)
      out.push('REWRITTEN ' + d.date + ' "' + b.title + '" -> "' + d.title + '"');
  });
  before.forEach(d => {
    if (!after.some(x => x.date === d.date)) out.push('ERASED ' + d.date + ' ' + d.title);
  });
  return out;
};

// ---------------------------------------------------------------------------
// THE INVARIANT
// ---------------------------------------------------------------------------
test('a rebuild rewrites no elapsed day — the reported defect', () => {
  const a = athlete();
  const before = snapshot(a);
  rebuild(a);
  assert.deepEqual(diff(before, snapshot(a)), [],
    'elapsed training was rewritten by a regeneration');
});

test('and rewrites none of them when the athlete changes their running days', () => {
  /* The reproduction that actually broke it. A schedule change moves the
     generator's quality days, so the newly generated week disagrees with the
     one the athlete lived through on almost every date. */
  const a = athlete();
  const before = snapshot(a);
  rebuild(a, { schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  assert.deepEqual(diff(before, snapshot(a)), []);
});

test('nor when the volume, the distance or the block length change', () => {
  [{ volume: 70 }, { volume: 38 }, { distanceKey: 'full' }, { distanceKey: '10k' }]
    .forEach(opts => {
      const a = athlete();
      const before = snapshot(a);
      rebuild(a, opts);
      assert.deepEqual(diff(before, snapshot(a)), [],
        'elapsed training moved when ' + JSON.stringify(opts));
    });
});

test('a MISSED session is history — the exact hole the defect came through', () => {
  const a = athlete();
  const missed = a.state.days.filter(d =>
    d.date >= MONDAY && d.date < TODAY && d.type !== 'rest' && !d.completed && !d.coachAdjust);
  assert.ok(missed.length >= 2, 'the fixture must contain genuinely missed days');
  missed.forEach(d => assert.equal(a.dayCarriesHistory(d), false,
    'a missed day carries no trace — which is precisely why it was being refilled'));
  const before = missed.map(d => ({ date: d.date, title: d.title, type: d.type }));

  rebuild(a, { schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });

  before.forEach(b => {
    const now = a.state.days.filter(d => d.date === b.date)[0];
    assert.ok(now, b.date + ' was erased');
    assert.equal(now.title, b.title, b.date + ' — a missed session was rewritten');
    assert.equal(now.type, b.type);
    assert.equal(!!now.completed, false, 'and it must still read as not run');
  });
});

test('an elapsed rest day stays a rest day', () => {
  // The other direction, and the one a "preserve what was logged" rule misses
  // entirely: a rest day has nothing to log and is still what the week was.
  const a = athlete();
  const rests = a.state.days.filter(d => d.date >= MONDAY && d.date < TODAY && d.type === 'rest');
  assert.ok(rests.length, 'the fixture must contain an elapsed rest day');
  const dates = rests.map(d => d.date);
  rebuild(a, { schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  dates.forEach(dt => assert.equal(a.state.days.filter(d => d.date === dt)[0].type, 'rest',
    dt + ' was an elapsed rest day and gained a session'));
});

// ---------------------------------------------------------------------------
// WHAT MUST SURVIVE
// ---------------------------------------------------------------------------
test('completed sessions keep their identity, log, review and week', () => {
  const a = athlete();
  const done = a.state.days.filter(d => d.completed)
    .map(d => ({ id: d.id, date: d.date, week: d.week, title: d.title, km: d.km }));
  assert.ok(done.length >= 10, 'the fixture must have real completed history');
  rebuild(a, { volume: 70 });
  done.forEach(b => {
    const x = a.state.days.filter(d => d.id === b.id)[0];
    assert.ok(x, b.id + ' was destroyed');
    assert.equal(x.date, b.date, b.id + ' was re-dated');
    assert.equal(x.week, b.week, b.id + ' moved week');
    assert.equal(x.title, b.title, b.id + ' was rewritten');
    assert.equal(x.completed, true);
    assert.equal(x.actual.notes, 'logged', b.id + ' lost its log');
    assert.ok(x.coachReview, b.id + ' lost its execution review');
  });
});

test('an accepted adjustment survives with its record intact', () => {
  const a = athlete();
  const adj = a.state.days.filter(d => d.coachAdjust)[0];
  const before = JSON.parse(JSON.stringify(adj.coachAdjust));
  const title = adj.title;
  rebuild(a, { volume: 70, schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  const now = a.state.days.filter(d => d.date === adj.date)[0];
  assert.ok(now.coachAdjust, 'the accepted adjustment was lost');
  assert.equal(JSON.stringify(now.coachAdjust), JSON.stringify(before),
    'the record of what changed and why was altered');
  assert.equal(now.title, title, 'the adjusted session itself was rewritten');
});

test('today and the future are still the plan’s to re-tailor', () => {
  /* The fix must not become "freeze everything". Re-tailoring a block is the
     whole point of Regenerate, and it applies from today forward. */
  const a = athlete();
  const futureBefore = a.state.days.filter(d => d.date > TODAY)
    .map(d => d.date + '|' + d.title + '|' + d.km).join(',');
  rebuild(a, { volume: 75 });
  const futureAfter = a.state.days.filter(d => d.date > TODAY)
    .map(d => d.date + '|' + d.title + '|' + d.km).join(',');
  assert.notEqual(futureAfter, futureBefore,
    'a rebuild at a different volume must actually re-tailor the future');
  assert.ok(a.state.days.filter(d => d.date === TODAY).length === 1, 'today is still there');
});

test('a day older than the block is not dragged into it', () => {
  /* THE BACKSTOP, AND WHY IT IS NOT DECORATION. "Elapsed" on its own would
     preserve ANY old day still sitting in state.days -- including a previous
     block's, if a transition ever left one behind. Those days would then be
     given a week number measured from THIS block's origin, which is the
     week-zero shape all over again: a marathon build's sessions filed inside a
     maintenance block, before its own week 1.
     A transition archives rather than merges, so this should never happen; the
     guard is what makes "should never" survive being wrong. */
  const a = athlete();
  const anchor = a.blockAnchor(a.state.setup.schedule.activeDays, true);
  const startMonday = a.addDays(anchor, -a.isoWeekday(anchor));
  const stray = { id: 'stray', date: a.addDays(startMonday, -21), week: 9,
                  type: 'long', title: 'Long Run from the previous block', km: 30,
                  desc: 'x', completed: false, actual: a.emptyActual() };
  a.state.days.push(stray);
  a.state.days.sort((x, y) => (x.date < y.date ? -1 : 1));

  rebuild(a);

  const survived = a.state.days.filter(d => d.id === 'stray');
  assert.equal(survived.length, 0,
    'a day from before this block’s first week was merged into it');
  a.state.days.forEach(d => assert.ok(d.week >= 1,
    d.date + ' was given week ' + d.week + ' — before the block it belongs to'));
});

test('athlete memory, measured fitness and progression survive', () => {
  const a = athlete();
  const memBefore = a.athleteMemory(90).filter(r => r.completed).length;
  const perfBefore = JSON.stringify((a.state.athlete || {}).performances || []);
  const blocksBefore = JSON.stringify((a.state.athlete || {}).blocks || []);
  const confBefore = a.computeConfidenceScore();

  rebuild(a, { volume: 70 });

  assert.equal(a.athleteMemory(90).filter(r => r.completed).length, memBefore,
    'athlete memory lost sessions');
  assert.equal(JSON.stringify((a.state.athlete || {}).performances || []), perfBefore,
    'measured fitness changed');
  assert.equal(JSON.stringify((a.state.athlete || {}).blocks || []), blocksBefore,
    'the block ledger changed');
  assert.equal(a.computeConfidenceScore(), confBefore, 'confidence moved');
});

// ---------------------------------------------------------------------------
// APP UPDATE != PLAN REGENERATION
// ---------------------------------------------------------------------------
/* Everything a new build is allowed to change about a day that already exists,
   and nothing else. `actual.paceUnit` is the one entry: a logged pace written
   before the field existed carries no unit, and migrateActualPaceUnits() LABELS
   it with the unit that was in effect at load. Its own comment is the reason it
   is admissible -- "deliberately not a conversion: no stored number is touched,
   only labelled" -- so the session and the log both still say exactly what they
   said. Anything else appearing here is an app update rewriting training. */
const LOAD_MAY_TOUCH = ['actual.paceUnit'];

test('APP UPDATE ≠ PLAN REGENERATION — opening the app re-tailors nothing', () => {
  /* The permanent invariant, and the reason it is stated as a whitelist rather
     than as byte-identity: a migration that only labels is legitimate, and a
     test that forbids all change would have to be weakened the first time one
     is added -- which is exactly when it needs to still mean something. */
  const a = athlete({ oldModel: true });
  const before = JSON.parse(JSON.stringify(a.state.days));

  // Everything loadState() does to an existing save, on a fresh runtime.
  const reopened = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  reopened.showToast = () => {}; reopened.renderApp = () => {};
  reopened.state = JSON.parse(JSON.stringify(a.state));
  reopened.migrateThemePreference(reopened.state);
  reopened.migrateActualPaceUnits(reopened.state);
  reopened.migrateAthleteRecord();

  const touched = new Set();
  before.forEach((b, i) => {
    const x = reopened.state.days[i];
    assert.ok(x, b.date + ' disappeared on load');
    Object.keys(Object.assign({}, b, x)).forEach(k => {
      if (k === 'actual') return;
      if (JSON.stringify(b[k]) !== JSON.stringify(x[k])) touched.add(k);
    });
    Object.keys(Object.assign({}, b.actual || {}, x.actual || {})).forEach(k => {
      if (JSON.stringify((b.actual || {})[k]) !== JSON.stringify((x.actual || {})[k]))
        touched.add('actual.' + k);
    });
  });
  assert.deepEqual([...touched].sort(), LOAD_MAY_TOUCH.slice().sort(),
    'opening the app changed something about existing training beyond the one ' +
    'permitted labelling migration');
});

test('and no load-path migration may touch what a session IS', () => {
  // The half of the invariant that matters most, stated on its own so it
  // cannot be lost in a whitelist edit.
  const a = athlete({ oldModel: true });
  const before = snapshot(a);
  const reopened = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  reopened.showToast = () => {}; reopened.renderApp = () => {};
  reopened.state = JSON.parse(JSON.stringify(a.state));
  reopened.migrateThemePreference(reopened.state);
  reopened.migrateActualPaceUnits(reopened.state);
  reopened.migrateAthleteRecord();
  assert.deepEqual(diff(before, snapshot(reopened)), []);
});

test('a plan built under the old model renders without gaining new history', () => {
  /* Elapsed days that predate structured workouts keep their prose card. They
     do NOT quietly acquire a structured prescription they were never run
     with -- that would be the workout library rewriting the past. */
  const a = athlete({ oldModel: true });
  const past = a.state.days.filter(d => d.date < TODAY);
  assert.ok(past.every(d => !d.prescription), 'the fixture really is the old model');
  const before = snapshot(a);

  rebuild(a);

  assert.deepEqual(diff(before, snapshot(a)), []);
  a.state.days.filter(d => d.date < TODAY).forEach(d =>
    assert.ok(!d.prescription, d.date + ' gained a structured workout it never had'));
  // and the future is on the current model
  const future = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest');
  assert.ok(future.some(d => d.prescription),
    'future sessions must receive the current structured representation');
});

test('every surface renders the mixed old/new plan without throwing', () => {
  const a = athlete({ oldModel: true });
  rebuild(a);
  ['renderTodayView', 'renderWeekView', 'renderFullPlanView', 'renderPlanHQView']
    .forEach(v => {
      assert.doesNotThrow(() => a[v](), v + ' threw on a mixed-model plan');
      assert.ok(a[v]().length > 0, v + ' rendered nothing');
    });
});

// ---------------------------------------------------------------------------
// THE WEEK THE ATHLETE IS STANDING IN
// ---------------------------------------------------------------------------
test('a mid-week re-tailor does not stack a third quality session on the week', () => {
  /* THE ONE THAT WAS ONCE A KNOWN LIMIT, NOW A RULE.
     Preserving elapsed days truthfully means the remainder of the current week
     is re-tailored around a past the generator no longer controls. Where a
     schedule change moves quality onto a later weekday, the calendar week ended
     up holding the elapsed quality session AND its replacement -- three hard
     sessions against a cap of two. Before elapsed days were preserved this
     never showed, because the elapsed half was being overwritten to match: the
     week looked right and the history was false.
     The surplus is now taken out of the FUTURE half of the week. */
  const a = athlete();
  const elapsedBefore = snapshot(a);
  rebuild(a, { schedule: MOVES_QUALITY_FORWARD });
  const week = a.state.days.filter(d => d.date >= MONDAY && d.date <= a.addDays(MONDAY, 6));
  const q = week.filter(d => QUALITY.indexOf(d.type) !== -1).length;
  assert.ok(q >= 1, 'the week still holds real quality work');
  assert.equal(q, capOf(),
    'the calendar week holds ' + q + ' quality sessions against a cap of ' + capOf());
  assert.deepEqual(diff(elapsedBefore, snapshot(a)), [],
    'the cap was paid for out of the past');
});

test('what gives way is a future day, and it becomes running rather than a hole', () => {
  const a = athlete();
  rebuild(a, { schedule: MOVES_QUALITY_FORWARD });
  const demoted = a.state.days.filter(d => d.weekQualityCap);
  assert.equal(demoted.length, 1);
  assert.ok(demoted[0].date >= TODAY, 'an elapsed day was demoted');
  assert.equal(demoted[0].type, 'easy');
  assert.ok(demoted[0].km > 0, 'the day became a hole in the week');
  assert.equal((demoted[0].prescription || {}).archetype, 'easy_run',
    'the demoted day kept a title and lost the session behind it');
});

test('a week already over its cap because of days ALREADY TRAINED is left alone', () => {
  /* The limit that remains, and the only honest answer to it. If both hard
     sessions are behind the athlete and the generator now wants one a week,
     there is nothing left to change that would not be a lie about what they
     ran. Historical preservation is not sacrificed to satisfy the cap. */
  const a = athlete();
  const elapsedBefore = snapshot(a);
  rebuild(a, { schedule: MOVES_QUALITY_FORWARD });
  const week = a.state.days.filter(d => d.date >= MONDAY && d.date <= a.addDays(MONDAY, 6));
  const past = week.filter(d => d.date < TODAY && QUALITY.indexOf(d.type) !== -1);
  const future = week.filter(d => d.date >= TODAY && QUALITY.indexOf(d.type) !== -1);
  assert.ok(past.length >= capOf(),
    'the fixture no longer produces the case it was written for: the elapsed half ' +
    'holds ' + past.length + ' of a cap of ' + capOf());
  assert.equal(future.length, 0, 'the future half still adds quality to an over-cap week');
  assert.deepEqual(diff(elapsedBefore, snapshot(a)), []);
});
