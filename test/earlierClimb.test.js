'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE CLIMB STARTS EARLIER (founder, Audit III C6, 16 November 2026):
   "I think when it's right, it should start the climb earlier?" and, of the
   proposal to plan the climb backwards from the peak with no catch-up jump
   after a recovery week, "yes".

   Measured on the week as written (the sum of its runs), from one full week
   to the next full week, so a recovery week in between is skipped over the
   way the athlete's legs skip over it. */

function block(dk, exp, vol, weeks){
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: dk, volume: vol, weeks, experience: exp, startDate: '2026-11-16' });
  const by = {};
  a.state.days.forEach(d => { if (d.km > 0 && d.type !== 'rest' && d.type !== 'race') by[d.week] = (by[d.week] || 0) + d.km; });
  const wks = a.raceGoalCheckpointBlock().weeks;
  const full = wks.filter(w => by[w.week] && !w.isCutback && !w.isTaper && !w.isRace && !w.eventTaperApplied)
                  .map(w => ({ week: w.week, km: Math.round(by[w.week] * 10) / 10, wk: w }));
  return { a, by, wks, full };
}

test('a marathon that can climb at 8% climbs evenly from week one, with no catch-up jump', () => {
  const { full, a } = block('full', 'experienced', 52, 15);
  const peak = Math.max(...full.map(f => f.km));
  const n = full.findIndex(f => f.km >= peak - 0.5);
  assert.ok(n >= 3, 'the fixture has no climb');
  const steps = full.slice(1, n + 1).map((f, i) => f.km / full[i].km - 1);
  assert.ok(Math.max(...steps) <= 0.08 + 0.02, 'a full week still jumps ' + Math.round(Math.max(...steps) * 100) + '%');
  assert.ok(steps.slice(0, 2).every(s => s > 0.03), 'the opening weeks still sit flat: ' + steps.slice(0, 2).map(s => Math.round(s * 100)));
});

test('where 8% cannot arrive in time, the step is even rather than flat then steep', () => {
  const { full } = block('full', 'novice', 21, 15);
  const peak = Math.max(...full.map(f => f.km));
  const n = full.findIndex(f => f.km >= peak - 0.5);
  const steps = full.slice(1, n + 1).map((f, i) => f.km / full[i].km - 1);
  /* Before: +26% and +22% over the last full week after a recovery week. */
  assert.ok(Math.max(...steps) <= 0.18, 'a step of ' + Math.round(Math.max(...steps) * 100) + '% is still a catch-up jump');
});

test('the peak and the taper are untouched, and a recovery week keeps its depth', () => {
  const { full, by, wks } = block('full', 'experienced', 52, 15);
  assert.equal(Math.max(...full.map(f => f.km)), 80, 'the peak moved');
  /* Each recovery week stays roughly the share of the full week before it
     that the plan designed (the opening recovery week here: 39.5 of 59.5 before). */
  wks.forEach((w, i) => {
    if (!w.isCutback || w.isTaper || !i || !by[w.week] || !by[wks[i - 1].week]) return;
    const share = by[w.week] / by[wks[i - 1].week];
    assert.ok(share >= 0.6 && share <= 0.85, 'week ' + w.week + ' is ' + Math.round(share * 100) + '% of the week before');
  });
});

test('every kilometre moved is booked on its week by name, and no easy run breaks its limits', () => {
  ['5k', '10k', 'half', 'full'].forEach(dk => ['novice', 'experienced', 'advanced'].forEach(exp => {
    const { a } = block(dk, exp, dk === 'full' ? 50 : 35, 14);
    (a.planVolumeAccounting || []).forEach(acc => assert.ok(acc.reconciled, dk + '/' + exp + ' week ' + acc.week + ' carries unbooked kilometres'));
    (a.planVolumeAccounting || []).forEach(acc => {
      if (acc.deliberateReduction > 0) assert.ok(acc.reductionCause, dk + '/' + exp + ' week ' + acc.week + ' is lighter for no named reason');
    });
    a.state.days.filter(d => d.type === 'easy' && d.km > 0).forEach(d => {
      assert.ok(d.km >= 5 - 1e-9 || /Shakeout/.test(d.title), dk + '/' + exp + ': an easy run of ' + d.km + 'km');
    });
  }));
});
