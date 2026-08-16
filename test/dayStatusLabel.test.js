'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// dayStatusLabel() used to render four different facts (a coach change, a
// notable day, a missed session, a fatigue signal) as one identical grey
// pill. Each now carries its own tone class and a small dot -- the word
// stays the primary signal, tone is reinforcement, not a replacement.

test('dayStatusLabel: Adjusted, Key, Missed and Recovery each get a distinct tone class', () => {
  const app = loadApp();
  const today = app.todayStr();
  const yesterday = app.addDays(today, -1);

  const adjusted = app.dayStatusLabel({ coachAdjust: { at: 'x' }, type: 'easy', completed: false, date: today });
  const key = app.dayStatusLabel({ type: 'checkpoint', completed: false, date: today });
  const missed = app.dayStatusLabel({ type: 'easy', completed: false, date: yesterday });

  // Recovery reads through coachReviewFor(), the ONE self-healing way to read
  // a review, so this needs a real, plan-integrated day rather than a bare
  // object -- computing a real review first, then only overwriting its
  // trainingSignal (reviewInputHash never depends on that field, so the
  // stamped hash stays valid and coachReviewFor() returns it as-is, not a
  // freshly recomputed one).
  // A day that has ALREADY HAPPENED. buildPlan starts the block today by
  // default, so the first easy day it returns is in the future -- and a future
  // session is never rendered as run, however its `completed` flag is forged.
  // The fixture, not the assertion, was the thing that had to be legal.
  const { days } = buildPlan(app, { startDate: app.addDays(today, -21) });
  const dd = days.find(d => d.type === 'easy' && d.km > 0 && d.date < today);
  assert.ok(dd, 'fixture must find a past easy session to review');
  const target = app.executionPaceTarget(dd);
  dd.completed = true;
  dd.actual = { km: dd.km, pace: app.secToPace((target.slow + target.fast) / 2), hr: null, rpe: null, notes: '' };
  app.coachPersistReview(dd);
  assert.ok(dd.coachReview, 'fixture must produce a real review to forge the signal onto');
  dd.coachReview.trainingSignal = 'recovery_priority';
  const recovery = app.dayStatusLabel(dd);

  assert.match(adjusted, /class="day-status-label font-head adjusted"/);
  assert.match(key, /class="day-status-label font-head key"/);
  assert.match(missed, /class="day-status-label font-head missed"/);
  assert.match(recovery, /class="day-status-label font-head recovery"/);

  // All four are genuinely distinct tone classes, not four labels sharing one.
  const tones = [adjusted, key, missed, recovery].map(html => /font-head (\w+)"/.exec(html)[1]);
  assert.equal(new Set(tones).size, 4, 'each status word must resolve to its own tone class');

  // The word itself is still the primary, always-present signal.
  assert.match(adjusted, />Adjusted<\/span>$/);
  assert.match(missed, />Missed<\/span>$/);
});

test('dayStatusLabel: an ordinary unremarkable day renders no pill at all', () => {
  const app = loadApp();
  const today = app.todayStr();
  const plain = app.dayStatusLabel({ type: 'easy', completed: true, date: today });
  assert.equal(plain, '');
});

test('dayStatusLabel: a declined adjustment (coachKeptAt) is now visible outside Today too', () => {
  const app = loadApp();
  const today = app.todayStr();
  const kept = app.dayStatusLabel({ coachKeptAt: 'x', type: 'easy', completed: false, date: today });
  assert.match(kept, /class="day-status-label font-head kept"/);
  assert.match(kept, />Kept<\/span>$/);
  assert.notEqual(kept, '', 'This Week / Full Plan previously showed nothing at all for a declined adjustment');
});

test('dayStatusLabel: an accepted adjustment still wins over a declined one on the same record', () => {
  const app = loadApp();
  const today = app.todayStr();
  // Not a real reachable combination (accept and keep are mutually exclusive
  // answers to the same proposal), but the priority order should still be
  // deterministic rather than accidental.
  const both = app.dayStatusLabel({ coachAdjust: { at: 'x' }, coachKeptAt: 'y', type: 'easy', completed: false, date: today });
  assert.match(both, /class="day-status-label font-head adjusted"/);
});
