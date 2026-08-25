'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// NEWLY DISCOVERED DURING REMEDIATION (adjacent to Final Full Product Audit
// Part 2/3, finding C9). The audit found SESSION_PURPOSE.tempo.label
// ("Marathon-Specific") diverging from TYPE_META.tempo.label ("Tempo") and
// concluded it was internal-only, never rendered to the athlete. That
// conclusion was wrong: coachVerdict()'s scored-session template reads
// "<dist> of <label.toLowerCase()> with <...>" for any well-executed
// (score>=90) session, so a genuinely good tempo run produced the
// Execution Review headline "6km of marathon-specific with pace inside the
// ... window and effort at RPE 7" -- an adjective standing in for a noun,
// broken grammar on the app's own review card.
//
// THE FIX. SESSION_PURPOSE.tempo.label is now "Marathon-Specific Effort",
// a real noun phrase in that sentence position, while staying the distinct
// concept it was for (why the session is prescribed, not TYPE_META's
// session-type label -- which stays "Tempo").

function fillAt(app, dd, fraction) {
  const target = app.executionPaceTarget(dd);
  const band = app.expectedRPEBand(dd);
  const zone = app.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = {
    km: dd.km,
    pace: target ? app.secToPace(target.fast + (target.slow - target.fast) * fraction) : null,
    hr: zone && zone.lo != null ? Math.round((zone.lo + (zone.hi != null ? zone.hi : zone.lo + 20)) / 2) : null,
    rpe: band ? Math.round((band[0] + band[1]) / 2) : null,
    notes: '',
  };
}

test('a well-executed tempo session reads as a real sentence, not "of marathon-specific"', () => {
  const a = loadApp({ pinnedDate: '2026-06-09T09:00:00Z' });
  buildPlan(a, { weeks: 8, startDate: a.addDays('2026-06-09', -14) });
  const dd = a.state.days.find((d) => d.type === 'tempo');
  assert.ok(dd, 'fixture needs a tempo day');
  fillAt(a, dd, 0.5);
  const review = a.coachWorkoutReview(dd);
  assert.ok(review && review.executionVerdict, 'sanity: a review must exist');
  assert.doesNotMatch(review.executionVerdict, /\bof marathon-specific\b(?! effort)/i,
    'the label must read as a noun phrase, not a bare adjective, in this sentence position');
  assert.match(review.executionVerdict, /marathon-specific effort/i);
});

test('TYPE_META.tempo.label (the session-type badge) is unchanged -- "Tempo"', () => {
  const a = loadApp();
  assert.equal(a.TYPE_META.tempo.label, 'Tempo');
});

test('SESSION_PURPOSE.tempo.label reads correctly in sessionPurpose() and coachSessionContext() too', () => {
  const a = loadApp({ pinnedDate: '2026-06-09T09:00:00Z' });
  buildPlan(a, { weeks: 8, startDate: a.addDays('2026-06-09', -14) });
  const dd = a.state.days.find((d) => d.type === 'tempo');
  assert.equal(a.sessionPurpose(dd).label, 'Marathon-Specific Effort');
});
