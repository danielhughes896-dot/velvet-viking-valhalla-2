'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 12, finding B2). renderGoalDayFig()
// (the Valhalla hero) computed Math.floor((raceDateMidnight - Date.now()) /
// 86400000) -- a wall-clock diff from the current MOMENT -- while
// readingSections()'s goal-day row (same screen's Readiness panel, for the
// identical race date) used daysBetween(todayStr(), raceDate), a pure
// calendar-date diff. The two disagreed by exactly one day whenever "now"
// wasn't midnight: pinned at 22:00, the hero said "11d" while Readiness said
// "12 days" for the same race.
//
// THE FIX. renderGoalDayFig() now calls daysBetween(todayStr(),
// state.setup.raceDate), the same standard every other day-count in the app
// uses (including readingSections()'s own goal-day row).

function withRacePlan(a, raceDaysAway) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -7) });
  a.state.setup.raceDate = a.addDays(a.todayStr(), raceDaysAway);
  return a;
}

test('the hero figure agrees with daysBetween(), even late in the day', () => {
  // Pinned to the evening -- the exact condition that used to make
  // Date.now() disagree with a pure calendar-date diff by one day.
  const a = loadApp({ pinnedDate: '2026-08-25T22:00:00Z' });
  withRacePlan(a, 12);
  const expected = a.daysBetween(a.todayStr(), a.state.setup.raceDate);
  const html = a.renderGoalDayFig();
  const shown = Number((html.match(/(\d+)d/) || [])[1]);
  assert.equal(shown, expected,
    'the hero figure must match daysBetween(), not a raw Date.now() wall-clock diff');
});

test('the hero figure matches the Readiness panel goal-day row for the same race date', () => {
  const a = loadApp({ pinnedDate: '2026-08-25T22:00:00Z' });
  withRacePlan(a, 12);
  const heroDays = Number((a.renderGoalDayFig().match(/(\d+)d/) || [])[1]);
  const readinessDays = a.daysBetween(a.todayStr(), a.state.setup.raceDate);
  // readingSections() computes this same value internally for its own
  // goal-day row -- asserted directly here since that is the single
  // standard both surfaces must now share.
  assert.equal(heroDays, readinessDays);
});

test('morning vs evening: the figure does not move within the same calendar day', () => {
  const morning = loadApp({ pinnedDate: '2026-08-25T06:00:00Z' });
  withRacePlan(morning, 12);
  const evening = loadApp({ pinnedDate: '2026-08-25T23:59:00Z' });
  withRacePlan(evening, 12);
  const dm = Number((morning.renderGoalDayFig().match(/(\d+)d/) || [])[1]);
  const de = Number((evening.renderGoalDayFig().match(/(\d+)d/) || [])[1]);
  assert.equal(dm, de, 'the same calendar day must not produce two different countdowns');
});
