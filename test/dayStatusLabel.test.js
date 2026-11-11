'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// dayStatusLabel() used to render four different facts (a coach change, a
// notable day, a missed session, a fatigue signal) as one identical grey
// pill. Each now carries its own tone class and a small dot -- the word
// stays the primary signal, tone is reinforcement, not a replacement.

/* CHANGED SIDES: KEY IS GONE. Founder, on the goal day: "Theres a bloody
   pill!!! Key! Remove." This test asserted four tones, Key among them. A
   race and a Fitness Checkpoint print no status word at all now; the other
   three are still told apart, and the goal day is still never relabelled
   Missed once it is in the past.
   AND THEN ADJUSTED WENT TOO. Founder, on a completed hill session: "I also
   don't care about it say adjusted pill top right! Remove." A session
   Sacoro changed prints no status word; Missed and Recovery are still told
   apart. */
test('dayStatusLabel: Missed and Recovery each get a distinct tone class; an adjusted day and a goal day get none', () => {
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

  assert.equal(adjusted, '', 'an adjusted session is labelled Adjusted again');
  /* and losing its own word does not hand it somebody else's */
  assert.equal(app.dayStatusLabel({ coachAdjust: { at: 'x' }, manualEdit: true, type: 'easy', completed: false, date: today }), '',
    'a session Sacoro changed is now called the athlete\u2019s own edit');
  /* but a fact about the day still shows on an adjusted one */
  assert.match(app.dayStatusLabel({ coachAdjust: { at: 'x' }, type: 'easy', completed: false, date: yesterday }),
    />Missed<\/span>$/, 'an adjusted session that was missed no longer says so');
  assert.equal(key, '', 'a Fitness Checkpoint is labelled Key again');
  assert.equal(app.dayStatusLabel({ type: 'race', completed: false, date: today }), '',
    'a race is labelled Key again');
  ['checkpoint', 'race'].forEach(t => assert.equal(
    app.dayStatusLabel({ type: t, completed: false, date: yesterday }), '',
    'a ' + t + ' in the past is called Missed now that it is not called Key'));
  assert.match(missed, /class="day-status-label font-head missed"/);
  assert.match(recovery, /class="day-status-label font-head recovery"/);

  // Genuinely distinct tone classes, not two labels sharing one.
  const tones = [missed, recovery].map(html => /font-head (\w+)"/.exec(html)[1]);
  assert.equal(new Set(tones).size, 2, 'each status word must resolve to its own tone class');

  // The word itself is still the primary, always-present signal.
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

test('dayStatusLabel: an accepted adjustment is still never called a declined one', () => {
  const app = loadApp();
  const today = app.todayStr();
  // Not a real reachable combination (accept and keep are mutually exclusive
  // answers to the same proposal), but the priority order should still be
  // deterministic rather than accidental.
  const both = app.dayStatusLabel({ coachAdjust: { at: 'x' }, coachKeptAt: 'y', type: 'easy', completed: false, date: today });
  /* WAS: it reads Adjusted. Adjusted prints nothing now ("I also don't care
     about it say adjusted pill"), and the order this test protects is the
     same one: accepted beats declined, so the day must not read Kept. */
  assert.equal(both, '', 'an accepted adjustment reads ' + JSON.stringify(both));
});
