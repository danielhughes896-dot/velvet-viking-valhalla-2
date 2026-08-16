'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

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
  const recovery = app.dayStatusLabel({
    type: 'easy', completed: true, date: yesterday,
    coachReview: { trainingSignal: 'recovery_priority' },
  });

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
