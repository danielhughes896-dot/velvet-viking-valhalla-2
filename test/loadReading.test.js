'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE LOAD READING, AND THE THREE THINGS IT USED TO GET WRONG.
 *
 * Audit finding, measured on an athlete who ran every session of a 16-week
 * marathon plan exactly as prescribed:
 *
 *   - days 6 to 14 read 4.00x falling to 1.77x -- "spike" -- because one or
 *     two weeks of running were divided by four;
 *   - every planned recovery week, the taper and race week read "low", and
 *     the athlete who had run all of it was told consistency was missing.
 *
 * Founder: "Load correction: Proceed independently, with tests for early
 * history, normal Build weeks, planned recovery weeks and tapering. The
 * proposed three-week minimum is reasonable as a provisional rule, but
 * shouldn't be treated as statistically reliable history automatically."
 *
 * The days here are written by hand rather than taken from the plan builder,
 * so each law states the week it is about and does not move when the
 * periodisation does.
 */

const PINNED = '2026-11-11T12:00:00';
// Mon..Sun, [type, km]. 46 km, one quality day, one long run.
const WEEK = [['easy', 8], ['tempo', 8], ['rest', 0], ['easy', 8], ['rest', 0], ['easy', 6], ['long', 16]];

/* `weeks` is oldest first; each entry is { scale, done } where `scale`
   multiplies the planned distances and `done` is the share of each run the
   athlete actually covered (0 = the week was missed, null = nothing planned
   and nothing logged, i.e. before the athlete had any history). The last
   week ends TODAY with its long run done, so the seven-day window is exactly
   that week; `todayPending` leaves today's run still to do. */
function athlete(weeks, todayPending) {
  const app = loadApp({ pinnedDate: PINNED });
  app.showToast = () => {}; app.renderApp = () => {}; app.flushSave = () => {}; app.scheduleSave = () => {};
  buildPlan(app, { startDate: app.addDays(app.todayStr(), -120), weeks: 24 });
  const today = app.todayStr();
  const days = [];
  const total = weeks.length * 7;
  weeks.forEach((w, wi) => {
    WEEK.forEach((slot, di) => {
      const back = total - 1 - (wi * 7 + di);        // 0 = today
      const date = app.addDays(today, -back);
      if (w === null) return;                         // no plan, no history
      const km = Math.round(slot[1] * w.scale * 10) / 10;
      const ran = slot[0] !== 'rest' && w.done > 0 && !(todayPending && back === 0);
      days.push({ id: date, date, type: slot[0], km, title: slot[0], week: wi + 1,
        completed: ran, actual: ran ? { km: Math.round(km * w.done * 10) / 10 } : null });
    });
  });
  app.state.days = days;
  return app;
}
const full = (scale) => ({ scale: scale == null ? 1 : scale, done: 1 });

/* ---------- early history ---------- */

test('one week of history offers no ratio: it used to read 4.00x and "spike"', () => {
  const app = athlete([full()]);
  const load = app.coachLoad();
  assert.equal(load.ratio, null);
  assert.equal(load.band, 'unknown');
  assert.equal(load.enough, false);
});

test('two weeks of history still offers no ratio', () => {
  const load = athlete([full(), full()]).coachLoad();
  assert.equal(load.ratio, null);
  assert.equal(load.band, 'unknown');
});

test('three steady weeks give a ratio of one, marked provisional', () => {
  const load = athlete([full(), full(), full()]).coachLoad();
  assert.ok(Math.abs(load.ratio - 1) < 0.02, 'three equal weeks are 1.00x, got ' + load.ratio);
  assert.equal(load.band, 'productive');
  assert.equal(load.provisional, true);
  assert.equal(load.historyDays, 21);
});

test('a provisional reading names the three-week average, never the four-week one', () => {
  const app = athlete([full(), full(), full(2.5)]);
  const load = app.coachLoad();
  assert.equal(load.provisional, true);
  assert.equal(load.band, 'spike', 'a week two and a half times the two before it is still a spike');
  const sig = app.coachSignals(load, app.coachRecovery(), app.coachTrend()).filter((s) => s.key === 'load')[0];
  assert.match(sig.detail, /3-week average/);
  assert.doesNotMatch(sig.detail, /4-week/);
  assert.equal(app.coachLoadAverageWords(load, true), 'three-week average');
});

test('four weeks of history is the full reading and is no longer provisional', () => {
  const app = athlete([full(), full(), full(), full()]);
  const load = app.coachLoad();
  assert.equal(load.provisional, false);
  assert.equal(load.historyDays, 28);
  assert.equal(app.coachLoadAverageWords(load), '4-week average');
});

/* ---------- normal build weeks ---------- */

test('a build that adds a little each week reads productive throughout', () => {
  [3, 4, 5, 6].forEach((n) => {
    const weeks = [];
    for (let i = 0; i < n; i++) weeks.push(full(1 + i * 0.06));
    const load = athlete(weeks).coachLoad();
    assert.equal(load.band, 'productive', n + ' build weeks read ' + load.band + ' at ' + load.ratio);
  });
});

/* ---------- planned recovery weeks and the taper ---------- */

test('a planned recovery week the athlete ran in full is "easing", not "low"', () => {
  const app = athlete([full(), full(1.06), full(1.12), full(0.65)]);
  const load = app.coachLoad();
  assert.ok(load.ratio < 0.8, 'the week really is under the average: ' + load.ratio);
  assert.equal(load.asPlanned, true);
  assert.equal(load.band, 'easing');
});

test('an easing week is not called undertrained, and is not told consistency is missing', () => {
  const app = athlete([full(), full(1.06), full(1.12), full(0.65)]);
  const load = app.coachLoad();
  const status = app.coachStatus(load, app.coachRecovery(), app.coachTrend(), null);
  assert.notEqual(status.label, 'Undertrained');
  const sig = app.coachSignals(load, app.coachRecovery(), app.coachTrend()).filter((s) => s.key === 'load')[0];
  assert.equal(sig.label, 'Load easing');
  assert.equal(sig.tone, 'good');
  assert.doesNotMatch(sig.detail, /leaks|dropping|consistency/i);
});

test('a two-week taper reads easing in both weeks', () => {
  const first = athlete([full(), full(), full(), full(0.7)]).coachLoad();
  const second = athlete([full(), full(), full(), full(0.7), full(0.45)]).coachLoad();
  assert.equal(first.band, 'easing');
  assert.equal(second.band, 'easing');
});

/* ---------- the readings that must NOT have been softened ---------- */

test('a normal week the athlete mostly missed is still "low"', () => {
  const app = athlete([full(), full(), full(), { scale: 1, done: 0.4 }]);
  const load = app.coachLoad();
  assert.ok(load.ratio < 0.8);
  assert.equal(load.asPlanned, false);
  assert.equal(load.band, 'low');
});

test('a full week straight back from three weeks off is still a spike', () => {
  const off = { scale: 1, done: 0 };
  const app = athlete([full(), full(), off, off, off, full()]);
  const load = app.coachLoad();
  assert.equal(load.provisional, false, 'the history is long; the hole in it is real');
  assert.ok(load.ratio > 1.5, 'one week against a 28-day window holding only that week: ' + load.ratio);
  assert.equal(load.band, 'spike');
});

test('a week nearly double the three before it is a spike on full history', () => {
  const load = athlete([full(), full(), full(), full(1.9)]).coachLoad();
  assert.equal(load.provisional, false);
  assert.equal(load.band, 'spike');
});

test('a session still ahead of the athlete today is not counted as a shortfall', () => {
  const app = athlete([full(), full(1.06), full(1.12), full(0.65)], true);
  const load = app.coachLoad();
  assert.equal(app.state.days[app.state.days.length - 1].completed, false, 'today\'s long run is still to do');
  assert.equal(load.asPlanned, true, 'six days run as asked; the seventh has not fallen due');
  assert.equal(load.band, 'easing');
});

test('nothing logged at all is unknown, with no history', () => {
  const app = athlete([{ scale: 1, done: 0 }, { scale: 1, done: 0 }, { scale: 1, done: 0 }, { scale: 1, done: 0 }]);
  const load = app.coachLoad();
  assert.equal(load.historyDays, 0);
  assert.equal(load.band, 'unknown');
});
