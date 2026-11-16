'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* NO EASY RUN UNDER 5KM, IN ANY WEEK (A5), WHEN THE COACH CHANGES THE WEEK
   TOO. Found on the gate's screenshots, 16 November 2026: a novice 5K week of
   5 + 5 + 6km, made smaller by the weekly sheet, was written as two 3.5km
   easy runs and a 4km long run, under the 6km long run the athlete had just
   run. The week-fit rule applies: the shortest easy run goes and the rest are
   sized to the target. And the sheet's own preview is what accepting writes. */

function novice(){
  const NOW = '2026-11-23';
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '5k', volume: 12, weeks: 12, experience: 'novice', startDate: '2026-11-09' });
  a.state.days.filter(d => d.date < NOW && d.type !== 'rest' && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  return a;
}

test('a smaller week drops a run rather than writing one under 5km', () => {
  const a = novice();
  const N = a.currentWeekNum();
  const runs = () => a.state.days.filter(d => d.week === N && d.km > 0);
  const longBefore = runs().find(d => d.type === 'long').km;
  assert.equal(runs().length, 3, 'the fixture week is not three runs');
  a.applyWeekTarget(N, 11.9, 'progress');
  runs().filter(d => d.type === 'easy').forEach(d => assert.ok(d.km >= 5, 'an easy run of ' + d.km + 'km'));
  assert.equal(runs().length, 2, 'no run was dropped');
  assert.ok(runs().find(d => d.type === 'long').km >= longBefore, 'the long run was cut to fit');
  const total = runs().reduce((t, d) => t + d.km, 0);
  assert.ok(Math.abs(total - 11.9) <= 1, 'the week is ' + total + 'km for an 11.9km target');
  /* The dropped day keeps what it was, so it can be put back. */
  const gone = a.state.days.find(d => d.week === N && d.type === 'rest' && d.weeklyAdjust);
  assert.ok(gone && gone.weeklyAdjust.from.km === 5);
});

test('the sheet shows the week accepting writes, run by run', () => {
  const a = novice();
  const rv = a.weeklyCoachingReview(a.currentWeekNum());
  const rows = a.weeklyDistributionPreview(rv);
  const N = rv.week;
  const plannedNow = a.state.days.filter(d => d.week === N).map(d => d.km).join(',');
  a.answerWeeklyReview(rv, true);
  const after = a.weeklyAdjustable ? a.state.days.filter(d => d.week === N && d.date >= '2026-11-23') : [];
  rows.forEach(r => {
    const day = after.find(d => a.dow(d.date) === r.day);
    assert.equal(r.to, day.km, r.day + ': the sheet said ' + r.to + 'km, the plan wrote ' + day.km + 'km');
  });
  assert.ok(rows.every(r => r.to === 0 || r.type !== 'easy' || r.to >= 5), 'the sheet shows an easy run under 5km');
  assert.ok(plannedNow.length > 0);
});
