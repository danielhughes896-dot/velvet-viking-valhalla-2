'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// computeExecutionScore/computeExecutionBreakdown is "THE scoring engine" per
// its own comment: every surface that shows a number resolves through it.
// These tests protect the invariants that would be dangerous to regress
// silently -- the abandoned-session cap in particular, since a broken cap
// would let a partially-run session read to the athlete as a fully good one.

function midPace(target) {
  return (target.slow + target.fast) / 2;
}

test('computeExecutionScore: hitting target distance and pace scores 100 when both are in range', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const dd = days.find(d => d.type === 'easy' && d.km > 0);
  const target = app.executionPaceTarget(dd);
  assert.ok(target && target.slow != null, 'fixture day must resolve a pace target');
  dd.completed = true;
  dd.actual = { km: dd.km, pace: app.secToPace(midPace(target)), hr: null, rpe: null, notes: '' };
  const score = app.computeExecutionScore(dd);
  assert.equal(score, 100, 'hitting distance exactly and pacing mid-window should score 100');
});

test('computeExecutionScore: distance or pace missing entirely returns no score, never a guess', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const dd = days.find(d => d.type === 'easy' && d.km > 0);
  dd.completed = true;
  // HR/RPE only, no distance and no pace logged.
  dd.actual = { km: null, pace: null, hr: 150, rpe: 3, notes: '' };
  const score = app.computeExecutionScore(dd);
  assert.equal(score, null, 'distance+pace are the required 70% core; without both, no score should be shown');
});

test('computeExecutionScore: missing HR/RPE reweights across distance+pace rather than penalising', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const dd = days.find(d => d.type === 'easy' && d.km > 0);
  const target = app.executionPaceTarget(dd);
  dd.completed = true;
  dd.actual = { km: dd.km, pace: app.secToPace(midPace(target)), hr: null, rpe: null, notes: '' };
  const score = app.computeExecutionScore(dd);
  assert.equal(score, 100, 'a session with only distance+pace logged, both perfect, should still resolve to a full score');
});

test('computeExecutionScore: an abandoned session is capped near the distance actually covered', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const dd = days.find(d => d.type === 'easy' && d.km >= 8);
  assert.ok(dd, 'fixture needs an easy day of at least 8km to abandon meaningfully');
  const target = app.executionPaceTarget(dd);
  const abandonedKm = +(dd.km * 0.58).toFixed(1); // stopped well short, as in the code's own documented example
  dd.completed = true;
  dd.actual = { km: abandonedKm, pace: app.secToPace(midPace(target)), hr: null, rpe: null, notes: '' };
  const breakdown = app.computeExecutionBreakdown(dd);
  const distScore = breakdown.parts.find(p => p.key === 'distance').score;
  assert.ok(breakdown.score < 100, 'perfect pace on a partial distance must not read as a fully good session');
  // computeExecutionBreakdown() applies the +15 cap to the unrounded raw score
  // and only rounds the result afterwards, so the final integer can sit up to
  // 0.5 above the unrounded (distScore + 15) bound purely from that rounding.
  assert.ok(breakdown.score <= distScore + 15.5, 'the score must not exceed the documented cap of distance-score + 15');
  assert.ok(breakdown.score > distScore, 'the athlete should still be credited for the portion that was run correctly');
});

test('computeExecutionScore: overshooting distance never scores above 100 for that component', () => {
  const app = loadApp();
  const { days } = buildPlan(app, {});
  const dd = days.find(d => d.type === 'easy' && d.km > 0);
  dd.completed = true;
  dd.actual = { km: dd.km * 2, pace: null, hr: null, rpe: null, notes: '' };
  const distScore = app.computeDistanceScore(dd.km, dd.actual.km);
  assert.equal(distScore, 100, 'running double the prescribed distance must not score above 100 for the distance component');
});
