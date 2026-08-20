'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// The RC1 fix: regenerating a programme must not casually erase completed
// training history. These tests protect that invariant directly, since a
// regression here would be a silent, delayed-discovery data-loss bug -- the
// athlete would only notice weeks of logged history vanishing the next time
// they regenerated.

test('reconcileRegeneratedDays: a completed day survives a regenerate that changes the schedule entirely', () => {
  const app = loadApp();
  const startDate = app.addDays(app.todayStr(), -7);
  const { days: oldDays } = buildPlan(app, { startDate, distanceKey: '10k', volume: 30 });
  const completedDay = oldDays.find(d => d.date <= app.todayStr() && d.type !== 'rest');
  completedDay.completed = true;
  completedDay.actual = { km: completedDay.km, pace: '5:00', hr: 150, rpe: 5, notes: 'felt great' };

  // Regenerate with a materially different plan (different distance, volume, start date).
  const newStart = app.todayStr();
  const block2 = app.buildBlockWeeks('half', 55, 12);
  const freshDays = app.buildDaysFromWeeks(block2, app.addDays(newStart, 12 * 7 - 1),
    { activeDays: [1, 3, 5, 6], longRunDay: 6 }, newStart, false);

  const result = app.reconcileRegeneratedDays(oldDays, freshDays, newStart);
  const survivor = result.days.find(d => d.date === completedDay.date);
  assert.ok(survivor, 'the completed day must still exist in state.days after regenerating');
  assert.equal(survivor.completed, true);
  assert.deepEqual(survivor.actual, completedDay.actual, 'logged actuals must be preserved exactly, not merged into the new prescription');
  assert.equal(survivor.type, completedDay.type, 'the historical day keeps the session it actually was, not the freshly generated one for that date');
});

test('reconcileRegeneratedDays: an untouched future day is fully replaced, not preserved', () => {
  const app = loadApp();
  const { days: oldDays } = buildPlan(app, { distanceKey: '10k', volume: 30, weeks: 8 });
  const freshDays = app.buildDaysFromWeeks(
    app.buildBlockWeeks('10k', 30, 8),
    oldDays[oldDays.length - 1].date,
    { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 },
    oldDays[0].date, false
  );
  const result = app.reconcileRegeneratedDays(oldDays, freshDays, oldDays[0].date);
  assert.equal(result.preserved, 0, 'with nothing completed or logged, nothing should be preserved');
  assert.deepEqual(result.days.map(d => d.id).sort(), freshDays.map(d => d.id).sort());
});

test('reconcileRegeneratedDays: no two days in the merged result share the same date', () => {
  const app = loadApp();
  const startDate = app.addDays(app.todayStr(), -3);
  const { days: oldDays } = buildPlan(app, { startDate, distanceKey: '5k', volume: 25 });
  oldDays.forEach((d, i) => {
    if (d.date <= app.todayStr() && d.type !== 'rest' && i < 2) {
      d.completed = true;
      d.actual = { km: d.km, pace: '4:30', hr: 150, rpe: 4, notes: '' };
    }
  });
  const newStart = app.todayStr(); // deliberately overlaps today, the same date some history sits on
  const freshDays = app.buildDaysFromWeeks(
    app.buildBlockWeeks('5k', 25, 8), app.addDays(newStart, 8 * 7 - 1),
    { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }, newStart, false
  );
  const result = app.reconcileRegeneratedDays(oldDays, freshDays, newStart);
  const dates = result.days.map(d => d.date);
  assert.equal(new Set(dates).size, dates.length, 'every date in the merged plan must be unique -- history always wins a collision, never duplicates alongside it');
});

test('reconcileRegeneratedDays: preserved history never collides into an unrelated week card', () => {
  /* UPDATED for the approved change of behaviour. The CONCERN is unchanged --
     a preserved session must never land in a week card it did not belong to --
     but the guarantee now comes from somewhere else.

     This used to pass `today` as the start, so history necessarily fell
     outside the block, and then assert survivor.week === 0. That was the old
     design and it is the one the founder rejected: a session in week 0 is a
     session in no week card at all, which is how three completed runs came to
     be rendered nowhere while Plan HQ went on counting them.

     A rebuild now anchors to the block's own origin through blockAnchor(), so
     history sits INSIDE the block and carries the real week number for its
     date. Collision is prevented by the merge being keyed on date: history
     wins that date outright and never duplicates alongside a generated day.
     So the test drives the anchoring the app actually performs, rather than a
     start date the app no longer produces. */
  const app = loadApp();
  const startDate = app.addDays(app.todayStr(), -20);
  const { days: oldDays } = buildPlan(app, { startDate, distanceKey: '10k', volume: 35 });
  const oldHistory = oldDays.find(d => d.date <= app.todayStr() && d.type !== 'rest');
  oldHistory.completed = true;
  oldHistory.actual = { km: oldHistory.km, pace: '5:10', hr: 148, rpe: 4, notes: '' };
  const originalWeek = oldHistory.week;

  app.state.setup = { startDate: startDate,
                      schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } };
  app.state.days = oldDays;
  const newStart = app.blockAnchor([1, 2, 3, 5, 6]);
  assert.equal(newStart, startDate, 'a rebuild must keep the block’s own origin');

  const block2 = app.buildBlockWeeks('10k', 35, 10);
  const freshDays = app.buildDaysFromWeeks(block2, app.addDays(newStart, 10 * 7 - 1),
    { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }, newStart, false);
  const result = app.reconcileRegeneratedDays(oldDays, freshDays, newStart);

  const survivor = result.days.find(d => d.date === oldHistory.date);
  assert.ok(survivor);
  assert.equal(survivor.week, originalWeek,
    'the preserved session left the week it was actually run in');
  assert.ok(survivor.week >= 1,
    'a preserved session must carry a real week number, not a bucket no card renders');
  // Occupying its date alone is what prevents the collision.
  assert.equal(result.days.filter(d => d.date === oldHistory.date).length, 1,
    'history duplicated alongside a generated day');
  assert.ok(result.days.every(d => d.week >= 1),
    'the merge produced a day outside the block');
});

test('reconcileRegeneratedDays: history within the new plan\'s own span is given that plan\'s real week number', () => {
  const app = loadApp();
  const { days: oldDays } = buildPlan(app, { distanceKey: '10k', volume: 30 });
  const today = app.todayStr();
  const todayDay = oldDays.find(d => d.date === today);
  todayDay.completed = true;
  todayDay.actual = { km: todayDay.km, pace: '5:00', hr: 150, rpe: 5, notes: '' };

  // Regenerate starting from today too -- the "already logged today before
  // regenerating" case, where today's date genuinely falls inside the new plan.
  const block2 = app.buildBlockWeeks('10k', 30, 10);
  const freshDays = app.buildDaysFromWeeks(block2, app.addDays(today, 10 * 7 - 1),
    { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }, today, false);
  const result = app.reconcileRegeneratedDays(oldDays, freshDays, today);

  const survivor = result.days.find(d => d.date === today);
  assert.equal(survivor.week, 1, 'a historical day on the new plan’s own start date belongs to its real week 1');
});
