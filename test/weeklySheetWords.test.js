'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE "STAYING AT" TOAST QUOTES THE WEEK YOU KEEP (founder, Audit III L2:
   "the toast after declining can quote last week's figure, not the week you
   keep; fix it. Make sure the correct inputs line up to the correct places").
   It quoted last week. Staying delivers last week's figure shaped by the 5km
   minimum run and the week's own sessions, which differed in 108 of 145
   progress reviews across a sweep of athletes. Three figures must agree: the
   sheet's "Staying keeps this week to X", the toast after Stay, and the week
   the plan now holds. */

const NOW = '2026-11-16';
const ATHLETES = [
  { distanceKey: '5k', volume: 25, startDate: '2026-10-12', activeDays: [0, 1, 3, 4, 6] },  // stays at 32.5, last week 33
  { distanceKey: '5k', volume: 35, startDate: '2026-10-19', activeDays: [1, 3, 6] },        // stays at 19, last week 18.5
];
const km = s => { const m = /([\d.]+)\s*km/.exec(s || ''); return m ? +m[1] : null; };

for (const p of ATHLETES){
  test('declining progression: sheet, toast and plan quote the same week (' + p.distanceKey + ' ' + p.volume + 'km)', () => {
    const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
    ['renderApp', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
    const toasts = []; a.showToast = m => toasts.push(String(m));
    buildPlan(a, { distanceKey: p.distanceKey, volume: p.volume, weeks: 14, startDate: p.startDate, healthConsent: true,
                   schedule: { activeDays: p.activeDays, longRunDay: 6 } });
    a.state.days.filter(d => d.date < NOW && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
    const rv = a.weeklyReviewDue();
    assert.ok(rv && rv.kind === 'progress', 'this athlete is offered progression');
    rv.delivered = a.weeklyDeliveredFigures(rv);
    const note = a.weeklyReviewCopy(rv).note;
    const sm = /(?:staying comes to|Staying keeps this week to) ([\d.]+)\s*km/.exec(note);
    const sheetKm = sm ? +sm[1] : null;
    a.weeklyReviewOpen = { rv, layer: null, picked: null };
    a.handleWeeklyAnswer(false);
    const toast = toasts.find(t => /^Staying at|^Keeping your plan at/.test(t));
    assert.ok(toast, 'a toast names the week kept: ' + JSON.stringify(toasts));
    const planKm = Math.round(a.weekPlannedKm(rv.week) * 10) / 10;
    assert.notEqual(planKm, rv.lastKm, 'the case this guards: the week kept is not last week');
    assert.equal(km(toast), planKm, 'toast quotes the week the plan now holds');
    assert.equal(sheetKm, planKm, 'the sheet quoted the same Stay figure');
  });
}

/* A SMALLER STEP ON A PERFECT WEEK SAYS WHY (founder, Audit III LA10:
   '"smaller step" appears on 12 of 101 flawless weeks; why?'). The plan
   wanted more than 8%, and the coach takes more only once fitness shows a
   gain. The sheet said "from what the evidence shows" on a week where every
   session went to plan. It now names the real rule. */
test('a flawless week capped at 8% says every session went to plan, and why', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  ['renderApp', 'flushSave', 'scheduleSave', 'showToast'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 20, weeks: 16, startDate: '2026-10-12', healthConsent: true,
                 schedule: { activeDays: [1, 3, 5, 6], longRunDay: 6 } });
  a.state.days.filter(d => d.date < NOW && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  const rv = a.weeklyReviewDue();
  assert.ok(rv && rv.kind === 'progress' && rv.reasons.includes('smaller_than_planned'), 'the plan wanted more than the coach allows');
  assert.ok(rv.ev.completion >= 0.95 && !rv.ev.overEffort, 'and the week was flawless');
  rv.delivered = a.weeklyDeliveredFigures(rv);
  const note = a.weeklyReviewCopy(rv).note;
  assert.doesNotMatch(note, /from what the evidence shows/);
  assert.match(note, /Every session went to plan\. SACORO adds up to 8% a week until your fitness shows a clear gain/);
});
test('the evidence wording stays where the evidence was cautious', () => {
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  const why = a.weeklySmallerStepWhy({ reasons: ['cautious', 'smaller_than_planned'], step: 0.05, ev: { completion: 0.8, overEffort: 1 } });
  assert.match(why, /smaller step from what the evidence shows/);
  assert.match(a.weeklySmallerStepWhy({ reasons: ['strong', 'smaller_than_planned'], step: 0.10, ev: { completion: 1, overEffort: 0 } }), /at most 10%/);
});
