'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* "A PROGRAMME THAT LEARNS HOW YOU TRAIN" HAS TO STILL BE TRUE WHEN THE
 * ATHLETE DECLINES.
 *
 * Health-data consent is optional, must stay optional, and an athlete who
 * declines must not get a lesser product with a worse-behaved plan. That is a
 * design constraint on every learning mechanism, not a preference: if the
 * volume ceiling or the escalation tiers needed heart rate, then declining
 * would silently degrade the athlete's training, which is exactly the coercion
 * the consent design exists to prevent.
 *
 * So the mechanisms added in this work are built on ORDINARY TRAINING DATA --
 * did the session happen, how far did it go, how fast. None of that is
 * health-indicating, and none of it is covered. These tests prove that by
 * withholding the covered fields entirely and showing the same answers come
 * out, which is a behavioural guarantee rather than a source-string assertion.
 *
 * WHAT IS NOT CLAIMED. Deeper physiological inference -- heart-rate drift,
 * heart rate at pace, the response model, the recovery model -- genuinely does
 * need covered data and stays gated behind consent on its own branch. This
 * file is not an argument that the gate can be relaxed. It is the evidence
 * that the gate does not have to take the programme down with it.
 */

const TODAY = '2026-08-21';
/* `covered` off means the athlete logged NO heart rate and NO effort rating --
   which is also what an athlete who has declined consent looks like to every
   layer downstream, because the fields never arrive. */
function athlete(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -56), distanceKey: 'half',
                 volume: 55, benchSec: 45 * 60,
                 lthr: o.covered ? 165 : null, maxHR: o.covered ? 190 : null });
  a.state.athlete = a.makeAthleteRecord();
  const p = past(a);
  p.forEach((dd, i) => {
    const withheld = o.covered ? {} : { hr: null, rpe: null };
    logAsPrescribed(a, dd, { quality: o.miss && i >= p.length - o.miss ? 1 : 1,
                             extra: withheld });
  });
  if (o.miss) p.slice(-o.miss).forEach(dd => {
    dd.completed = false; dd.actual = a.emptyActual(); delete dd.coachReview;
  });
  return a;
}
const past = a => a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')
                   .sort((x, y) => (x.date < y.date ? -1 : 1));

test('demonstrated sustainable volume is the same with and without covered data', () => {
  /* The launch-blocker mechanism. It reads completion and distance, and both
     are ordinary training data. */
  const withIt = athlete({ covered: true });
  const without = athlete({ covered: false });
  assert.equal(without.demonstratedSustainableVolume(), withIt.demonstratedSustainableVolume());
  assert.equal(without.volumeCeilingFor('half'), withIt.volumeCeilingFor('half'));
  assert.ok(without.demonstratedSustainableVolume() > 0, 'nothing was demonstrated at all');
});

test('and so is the block a declining athlete is given next', () => {
  const withIt = athlete({ covered: true });
  const without = athlete({ covered: false });
  assert.equal(JSON.stringify(without.buildBlockWeeks('half', 55, 10, { purpose: 'base' })),
               JSON.stringify(withIt.buildBlockWeeks('half', 55, 10, { purpose: 'base' })));
});

test('missed-session escalation does not need heart rate', () => {
  const withIt = athlete({ covered: true, miss: 4 });
  const without = athlete({ covered: false, miss: 4 });
  assert.equal(JSON.stringify(without.missPattern()), JSON.stringify(withIt.missPattern()));
  assert.equal(without.missPattern().tier, 'emerging');
});

test('nor does poor-execution escalation', () => {
  /* Execution scores from distance and pace alone. The breakdown requires
     those two and weighs whatever else is there -- so an athlete logging only
     what a phone can measure still gets a real score and a real tier. */
  const a = athlete({ covered: false });
  const q = past(a).filter(d => a.isQualityType(d.type));
  q.slice(-4).forEach(dd => logAsPrescribed(a, dd, { quality: 0.6, extra: { hr: null, rpe: null } }));
  const p = a.executionPattern();
  assert.ok(p, 'an athlete without covered data got no execution reading at all');
  assert.equal(p.tier, 'persistent');
});

test('and the athlete is not told anything about a heart rate they never gave', () => {
  const a = athlete({ covered: false });
  past(a).forEach(dd => {
    const r = a.coachReviewFor(dd) || {};
    const text = [r.executionVerdict, r.coachNoticed, r.trainingSignalReason, r.nextMove]
      .filter(Boolean).join(' ');
    assert.ok(!/\d+\s*bpm/.test(text), dd.date + ' quoted a heart rate: ' + text);
  });
});

test('withholding is not punished: confidence does not fall because the athlete declined', () => {
  /* The brief is explicit -- "do not punish confidence because the athlete
     withheld". A declining athlete has fewer INPUTS, which is a fact; what
     must not happen is the programme treating the absence as a negative
     reading. */
  const a = athlete({ covered: false });
  const trends = a.athleteTrends() || [];
  trends.forEach(t => assert.notEqual(t.direction, 'negative',
    'a withheld component produced a negative trend: ' + t.id + ' — ' + t.detail));
});

test('a declining athlete still gets a session review with something in it', () => {
  const a = athlete({ covered: false });
  const reviewed = past(a).map(dd => a.coachDebrief(dd)).filter(Boolean);
  assert.ok(reviewed.length >= past(a).length * 0.8,
    'only ' + reviewed.length + ' of ' + past(a).length + ' sessions produced a review');
  reviewed.forEach(m => assert.ok(m.paragraphs.length > 0));
});

/* ------------------------------------------------------------------ *
 * THE LIMIT, STATED RATHER THAN PAPERED OVER
 * ------------------------------------------------------------------ */

test('what a declining athlete genuinely does not get is named, not silently absent', () => {
  /* Heart-rate zones, heart-rate drift and heart rate at pace are covered
     data and their absence is real. The product must not pretend otherwise --
     and must not invent a substitute for them either. This pins the honest
     boundary: with no heart rate anywhere, no layer manufactures one. */
  const a = athlete({ covered: false });
  past(a).forEach(dd => {
    assert.equal(a.getTargetHRRangeForDay(dd), null,
      dd.date + ' produced a heart-rate target for an athlete with no heart-rate data');
  });
  const base = a.athleteBaseline ? a.athleteBaseline() : null;
  if (base) assert.equal(base.hr, null, 'a heart-rate baseline appeared from nowhere');
});
