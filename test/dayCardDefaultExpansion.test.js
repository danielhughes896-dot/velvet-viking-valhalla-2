'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// VALHALLA -- DEFAULT DAY-CARD EXPANSION.
//
// isDayExpanded() is the ONE function every day card (Today, This Week, an
// opened Full Plan week) reads to decide its initial open/closed state --
// see dayCardElevation.test.js's own "single renderer" test for why that
// single call site is what lets a rule written once reach every view.
//
// THE RULE: only the current calendar day (dd.date === todayStr(), the same
// date check the rest of the app already uses for its "today" flags) starts
// expanded. Every other day starts collapsed, REGARDLESS of whether it is
// in the past, still to come, or already completed -- completion used to
// decide the default for every non-today day (`!dd.completed`), which is
// exactly what made an ordinary week open with most of its cards already
// expanded. An explicit tap (dayExpandOverride) still overrides this
// default entirely, checked first and unconditionally.
const TODAY = '2026-06-09'; // Tuesday -- an active day under the default schedule, so "today" has a real (non-rest) session to check completion against
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });

function plannedApp() {
  const a = app();
  buildPlan(a, { weeks: 4, startDate: a.addDays(TODAY, -14) });
  a.showToast = () => {};
  return a;
}

test('the current day starts expanded', () => {
  const a = plannedApp();
  const today = a.state.days.find(d => d.date === TODAY);
  assert.ok(today, 'fixture must include today');
  assert.equal(a.isDayExpanded(today), true);
});

test('a completed current day still starts expanded -- completion never overrides "today"', () => {
  const a = plannedApp();
  const today = a.state.days.find(d => d.date === TODAY && d.type !== 'rest');
  today.completed = true;
  today.actual = { km: today.km, pace: '5:20', hr: 150, rpe: 5, feel: 'good', notes: '' };
  assert.equal(a.isDayExpanded(today), true,
    'a completed session is still the current day\'s session');
});

test('every other day starts collapsed, whether past, future, completed or not', () => {
  const a = plannedApp();
  const others = a.state.days.filter(d => d.date !== TODAY);
  assert.ok(others.length > 20, 'the fixture must actually cover multiple other days');
  others.forEach(d => { d.completed = false; });
  const stillOpen = others.filter(d => a.isDayExpanded(d));
  assert.equal(stillOpen.length, 0, 'no day other than today may default to expanded: ' +
    JSON.stringify(stillOpen.map(d => d.date)));

  // Completing some of them must not flip any of them open either --
  // completion played no role in the old default and plays none in the new
  // one; both must yield the same collapsed default.
  others.slice(0, 5).forEach(d => {
    if (d.type === 'rest') return;
    d.completed = true;
    d.actual = { km: d.km, pace: '5:20', hr: 150, rpe: 5, feel: 'good', notes: '' };
  });
  const stillOpenAfterCompletion = a.state.days.filter(d => d.date !== TODAY && a.isDayExpanded(d));
  assert.equal(stillOpenAfterCompletion.length, 0);
});

test('a past week: every day defaults to collapsed, including its own "today" if there were one', () => {
  const a = plannedApp();
  const pastWeekDays = a.state.days.filter(d => d.date < a.addDays(TODAY, -7));
  assert.ok(pastWeekDays.length > 3, 'fixture must include an earlier week');
  pastWeekDays.forEach(d => assert.equal(a.isDayExpanded(d), false,
    'none of these days is the current calendar day, so none opens by default'));
});

test('a future week: every day defaults to collapsed', () => {
  const a = plannedApp();
  const futureWeekDays = a.state.days.filter(d => d.date > a.addDays(TODAY, 7));
  assert.ok(futureWeekDays.length > 3, 'fixture must include a later week');
  futureWeekDays.forEach(d => assert.equal(a.isDayExpanded(d), false));
});

test('a manual tap still overrides the default in either direction', () => {
  const a = plannedApp();
  const future = a.state.days.find(d => d.date > TODAY && d.type !== 'rest');
  assert.equal(a.isDayExpanded(future), false, 'starts collapsed by default');
  a.handleToggleDay(future.id);
  assert.equal(a.isDayExpanded(future), true, 'an explicit tap opens it');
  a.handleToggleDay(future.id);
  assert.equal(a.isDayExpanded(future), false, 'and a second tap closes it again');

  const today = a.state.days.find(d => d.date === TODAY && d.type !== 'rest');
  assert.equal(a.isDayExpanded(today), true, 'starts expanded by default');
  a.handleToggleDay(today.id);
  assert.equal(a.isDayExpanded(today), false, 'and can still be manually collapsed');
});

test('the same rule drives Today, This Week and Full Plan alike -- one function, no per-view logic', () => {
  const fs = require('fs'), path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.equal((CODE.match(/function isDayExpanded\(/g) || []).length, 1,
    'there must be exactly one definition for the default to reach every view identically');
});
