'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 8, finding B1). 29 sessions
// logged perfectly, then ONE session cut to 30% of distance (RPE/HR still
// in-band). coachTrend()'s fast EWMA (alpha=0.4) crossed the falling
// threshold from that single point -- the tail was [100,100,100,100,100,45],
// only one data point moved -- and coachTrainingSignal()/coachStatus() both
// said "Execution has slipped across the last few sessions", which is false:
// nothing slipped "across" anything, one session did.
//
// THE FIX. coachTrend() now also reports singleOutlier: true whenever
// removing the single worst recent score alone would put the trend back
// above the falling threshold. Every consumer that used to say "the last
// few sessions"/"recent sessions" for a falling trend now says so only when
// singleOutlier is false, and uses single-session-scoped language otherwise.
// direction/delta themselves, and the rising side, are unchanged.

function fillPerfect(app, dd) {
  const target = app.executionPaceTarget(dd);
  const band = app.expectedRPEBand(dd);
  const zone = app.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = {
    km: dd.km,
    pace: target ? app.secToPace((target.slow + target.fast) / 2) : null,
    hr: zone && zone.lo != null ? Math.round((zone.lo + (zone.hi != null ? zone.hi : zone.lo + 20)) / 2) : null,
    rpe: band ? Math.round((band[0] + band[1]) / 2) : null,
    notes: '',
  };
}

function buildLongCleanHistoryWithOneOutlier(app) {
  const today = app.todayStr();
  const startDate = app.addDays(today, -70);
  buildPlan(app, { startDate, weeks: 24 });
  const sorted = app.state.days.filter((d) => d.type !== 'rest' && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  assert.ok(sorted.length >= 20, 'sanity: fixture needs a long clean history for this repro');
  sorted.forEach((dd) => fillPerfect(app, dd));
  // Cut the LAST (most recent) session to well below its prescription.
  const last = sorted[sorted.length - 1];
  last.actual.km = Math.max(0.5, Math.round(last.km * 0.3 * 10) / 10);
  last.actual.notes = '';
  return sorted;
}

test('a single cut-short session among many clean ones is flagged as an outlier, not a trend', () => {
  const app = loadApp();
  buildLongCleanHistoryWithOneOutlier(app);
  const trend = app.coachTrend();
  assert.equal(trend.direction, 'falling', 'sanity: the single bad session must still cross the threshold');
  assert.equal(trend.singleOutlier, true,
    'removing the one bad session alone must put the trend back above the falling threshold');
});

test('coachStatus() no longer claims "the last few sessions" for a single outlier', () => {
  const app = loadApp();
  buildLongCleanHistoryWithOneOutlier(app);
  const load = app.coachLoad();
  const recovery = app.coachRecovery();
  const trend = app.coachTrend();
  const confidence = app.computeConfidenceScore();
  const status = app.coachStatus(load, recovery, trend, confidence);
  assert.doesNotMatch(status.detail, /last few sessions/i);
});

test('a genuinely sustained multi-session decline still uses the "last few sessions" language', () => {
  const app = loadApp();
  const today = app.todayStr();
  const startDate = app.addDays(today, -40);
  buildPlan(app, { startDate, weeks: 12 });
  const sorted = app.state.days.filter((d) => d.type !== 'rest' && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  assert.ok(sorted.length >= 8, 'sanity: fixture needs enough sessions');
  sorted.forEach((dd, i) => {
    fillPerfect(app, dd);
    // The last 5 sessions all ran well short -- a genuine multi-session decline.
    if (i >= sorted.length - 5) {
      dd.actual.km = Math.max(0.5, Math.round(dd.km * 0.4 * 10) / 10);
    }
  });
  const trend = app.coachTrend();
  assert.equal(trend.direction, 'falling');
  assert.equal(trend.singleOutlier, false,
    'a real multi-session decline must not be misclassified as a single outlier');
  // coachSignals()'s trend chip uses the multi-session phrasing whenever
  // singleOutlier is false -- checked directly, rather than through
  // coachStatus() (which has other, higher-priority branches, e.g. load
  // band, that this particular cut-volume fixture can also trip).
  const signals = app.coachSignals(app.coachLoad(), app.coachRecovery(), trend);
  const trendSignal = signals.find((s) => s.key === 'trend');
  assert.ok(trendSignal, 'sanity: a falling trend signal must be present');
  assert.match(trendSignal.detail, /Recent sessions are running/i);
});

test('the rising side is untouched: singleOutlier is always false when not falling', () => {
  const app = loadApp();
  const today = app.todayStr();
  const startDate = app.addDays(today, -20);
  buildPlan(app, { startDate, weeks: 8 });
  const sorted = app.state.days.filter((d) => d.type !== 'rest' && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  sorted.forEach((dd) => fillPerfect(app, dd));
  const trend = app.coachTrend();
  assert.notEqual(trend.direction, 'falling');
  assert.equal(trend.singleOutlier, false);
});
