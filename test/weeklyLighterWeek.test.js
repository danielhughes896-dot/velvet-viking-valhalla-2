'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE LEARNING AUDIT, RE-RUN AGAIN (16 November 2026, founder: "Yeh do
   that"). Two reds left after the commit:
     20 rows: a planned lighter week came after weeks the coach had already
     held lower, rose 15 to 25% on them, and no sheet said why.
     The one-button sheet left "5km." behind when it removed the sentence
     "Staying keeps this week to 21.5km." at the decimal point. */

function heldBelowTheCutback(){
  const probe = loadApp({ pinnedDate: '2026-11-02T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { probe[f] = () => {}; });
  const opts = { distanceKey: '10k', volume: 45, weeks: 12, experience: 'experienced', startDate: '2026-11-02',
                 schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } };
  buildPlan(probe, opts);
  const W = [...new Set(probe.state.days.map(d => d.week))].find(w => w > 2 && probe.playbookWeekInfo(w).isCutback);
  assert.ok(W, 'the fixture has no lighter week');
  const monday = probe.state.days.filter(d => d.week === W).map(d => d.date).sort()[0];
  const a = loadApp({ pinnedDate: monday + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, opts);
  /* The coach held the week before well under the lighter week to come. */
  const cutKm = a.weekPlannedKm(W);
  const realToday = a.todayStr;
  a.todayStr = () => a.addDays(monday, -7);          // decided on the Monday of that week
  a.applyWeekTarget(W - 1, cutKm * 0.8, 'hold');
  a.todayStr = realToday;
  a.state.days.filter(d => d.date < monday && d.type !== 'rest' && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  return { a, W };
}

test('a lighter week bigger than the weeks just run is asked about, never a silent rise', () => {
  const { a, W } = heldBelowTheCutback();
  const rv = a.weeklyCoachingReview(W);
  assert.ok(rv.plannedKm > rv.lastKm + 0.5, 'the fixture lighter week is not above last week');
  assert.notEqual(rv.kind, 'planned_reduction');
  assert.ok(rv.reasons.includes('lighter_week_above_recent'), rv.kind + ' ' + rv.reasons);
  assert.equal(rv.material, true, 'no sheet');
  assert.ok(rv.recommendedKm <= rv.plannedKm + 0.5, 'the step goes past the lighter week the plan wrote');
  if (rv.kind === 'progress'){
    const c = a.weeklyReviewCopy(rv);
    assert.match(c.why, /Your plan has a lighter week here, [\d.]+km, but your recent weeks have been lighter still/);
  }
});

test('an ordinary lighter week is still the planned reduction', () => {
  const probe = loadApp({ pinnedDate: '2026-11-02T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { probe[f] = () => {}; });
  const opts = { distanceKey: '10k', volume: 45, weeks: 12, experience: 'experienced', startDate: '2026-11-02',
                 schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } };
  buildPlan(probe, opts);
  const W = [...new Set(probe.state.days.map(d => d.week))].find(w => w > 2 && probe.playbookWeekInfo(w).isCutback);
  const monday = probe.state.days.filter(d => d.week === W).map(d => d.date).sort()[0];
  const a = loadApp({ pinnedDate: monday + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, opts);
  a.state.days.filter(d => d.date < monday && d.type !== 'rest' && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  assert.equal(a.weeklyCoachingReview(W).kind, 'planned_reduction');
});

test('the one-button sheet removes the staying sentence whole, decimals and all', () => {
  const { a, W } = heldBelowTheCutback();
  const rv = a.weeklyCoachingReview(W);
  rv.delivered = { yes: 21.5, no: 21.5, same: true };
  const c = a.weeklyReviewCopy(rv);
  assert.equal(c.no, null);
  assert.doesNotMatch(String(c.note), /Staying|staying/);
  assert.doesNotMatch(String(c.note), /\.\d+km\.$|[a-z]\.\d/, 'a fragment of the removed sentence is left: ' + c.note);
});
