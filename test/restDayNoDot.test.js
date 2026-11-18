'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* Founder: "On a rest day. No completion dot is needed. It's in the top
   right. So on a rest day just needs to be hidden." */
test('a rest day draws no completion dot; a run day still does', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: '2026-04-08' });
  const today = a.state.days.filter(d => d.date === a.todayStr())[0];
  today.type = 'rest'; today.km = 0; today.title = 'Rest Day'; delete today.prescription;
  const html = a.renderTodayView();
  assert.doesNotMatch(html, new RegExp('data-action="toggle-complete" data-day="' + today.id + '"'),
    'the rest day still offers a dot to tick');
  const run = a.state.days.filter(d => d.type !== 'rest' && d.date > a.todayStr())[0];
  assert.match(a.renderDayCard(run, true), new RegExp('data-action="toggle-complete" data-day="' + run.id + '"'));
});
