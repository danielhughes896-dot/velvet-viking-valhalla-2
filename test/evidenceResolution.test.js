'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logSections } = require('./fixtures.js');

/* EVIDENCE RESOLUTION — WHAT THE LOG CAN AND CANNOT ESTABLISH
 * ===========================================================================
 * THE AUDIT FINDING THIS RESTS ON, because it changes what needed building.
 *
 * Execution Review was already resolution-honest in the two places it matters
 * most, and neither was obvious from the outside:
 *
 *   1. UNKNOWN IS ALREADY NEVER ZERO. computeExecutionBreakdown() filters the
 *      unscored components OUT of the weighted average rather than scoring
 *      them nil, and reports them separately as `missing`.
 *   2. SEGMENT ACTUALS ARE ALREADY NEVER FABRICATED. executionPaceTarget()
 *      aggregates the PRESCRIPTION down to the resolution of the EVIDENCE --
 *      a 2 km warm-up, 5 km threshold and 1 km cool-down become one
 *      distance-weighted band judged against one whole-run average. It never
 *      back-derives what the threshold section must have been.
 *
 * So the gap was not arithmetic. It was DISCLOSURE: a score presented without
 * naming its resolution reads as a verdict on the threshold section, which is
 * the one thing whole-session evidence cannot support. This file pins the
 * naming, and pins that the arithmetic did not change to get it.
 *
 * FOUNDER DECISION, LATER: "SACORO needs to distinguish missing evidence from
 * successful execution ... if someone logs 8 km at 5:00/km against an
 * interval session but provides no repetition data, SACORO can assess
 * distance and overall pace. It cannot legitimately claim the intervals were
 * executed perfectly. That should produce a clearly labelled partial or
 * unverified assessment, not an invented 100%."
 * So a structured session logged as one total no longer gets a whole-session
 * score with a disclosure beside it: it gets a partial assessment and no
 * score, and is scored once its sections are logged. Where a law below was
 * about something else (unknown is not zero, more evidence does not lower the
 * ceiling), the threshold session is logged section by section, as the
 * athlete now does to have it scored.
 */

const TODAY = '2026-08-24';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}
const firstOf = (a, type) => a.state.days.filter(d => d.type === type)[0];
function logWhole(dd, pace){
  dd.completed = true;
  dd.actual = { km: dd.km, pace: pace || '5:12', paceUnit: 'km' };
  return dd;
}
/* The same total, with each section typed into Your Log on target. */
function logBySection(a, dd, pace){
  logWhole(dd, pace);
  return logSections(a, dd, 1);
}

// ---------------------------------------------------------------------------
// RESOLUTION IS DETECTED, NOT GUESSED
// ---------------------------------------------------------------------------
test('a structured session logged as one total gets a partial assessment, not a whole-session score', () => {
  const a = app();
  const dd = logWhole(firstOf(a, 'threshold'));
  assert.equal(a.computeExecutionBreakdown(dd), null,
    'a session with a warm-up, a quality block and a cool-down was scored from its average');
  const pa = a.computePartialAssessment(dd);
  assert.equal(pa && pa.tier, 'partial');
  /* Logged by section, the same session is scored, at section resolution. */
  const b = a.computeExecutionBreakdown(logSections(a, dd, 1));
  assert.ok(b && b.score > 0);
  assert.notEqual(b.paceResolution, 'whole-session');
});

test('a single-intensity session is judged directly, because the average IS the thing prescribed', () => {
  const a = app();
  const b = a.computeExecutionBreakdown(logWhole(firstOf(a, 'easy'), '5:40'));
  assert.equal(b.paceResolution, 'direct');
});

test('AUDIT FINDING: distance alone produces no Execution Review at all', () => {
  /* NOT A CHANGE -- A RECORD OF EXISTING BEHAVIOUR, pinned so the next person
     to touch this meets it deliberately rather than by surprise.

     computeExecutionBreakdown() requires BOTH distance and pace, and returns
     null without either. So the evidence ladder does not currently start at
     "whole-session distance": it starts one rung higher, at distance AND pace.
     An athlete who logs "I ran 8 km" and nothing else gets no assessment at
     all rather than a broad one.

     That is a floor, not graceful degradation, and it sits directly against
     the "more evidence = more precise coaching" ladder. Changing it would move
     coaching behaviour -- what a session scores, and whether it scores -- so it
     is REPORTED for a founder decision rather than altered here. */
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = { km: dd.km };            // distance only, no pace
  assert.equal(a.computeExecutionBreakdown(dd), null,
    'behaviour changed: distance-only evidence now produces a breakdown -- ' +
    'that is a methodology change and needs to be a deliberate decision');
});

// ---------------------------------------------------------------------------
// THE CLAUSE — said where it is load-bearing, silent where it is noise
// ---------------------------------------------------------------------------
test('the athlete is told the sections were not logged separately, and how to have it scored', () => {
  const a = app();
  const lines = a.partialAssessmentLines(a.computePartialAssessment(logWhole(firstOf(a, 'threshold')))).join(' ');
  assert.match(lines, /not logged on its own|not logged one by one/, 'the missing evidence is not named');
  assert.match(lines, /no execution score/);
  assert.match(lines, /Log each part in Your Log/);
});

test('a simple run says nothing about resolution, because there is nothing to say', () => {
  const a = app();
  const b = a.computeExecutionBreakdown(logWhole(firstOf(a, 'easy'), '5:40'));
  assert.equal(a.executionResolutionClause(b), '',
    'an easy run was given a caveat that does not apply to it');
});

test('the clause never claims a number the athlete did not log', () => {
  const a = app();
  const b = a.computeExecutionBreakdown(logWhole(firstOf(a, 'threshold')));
  const clause = a.executionResolutionClause(b);
  assert.ok(!/\d/.test(clause), 'the disclosure invented a figure: ' + clause);
});

// ---------------------------------------------------------------------------
// UNKNOWN IS NOT ZERO, AND NOT FAILURE
// ---------------------------------------------------------------------------
test('an unlogged component is excluded from the score, never scored nil', () => {
  const a = app();
  const dd = logBySection(a, firstOf(a, 'threshold'));
  const b = a.computeExecutionBreakdown(dd);
  const hr = b.parts.filter(p => p.key === 'hr')[0];
  assert.equal(hr.score, null, 'heart rate was scored despite never being logged');
  assert.ok(b.counted.every(p => p.score != null), 'an unscored part was counted');
  assert.ok(b.missing.some(p => p.key === 'hr'), 'the unknown was not reported as unknown');
  assert.ok(b.score > 0, 'unknown evidence dragged the score towards zero');
});

test('sparse evidence still produces a real assessment rather than a refusal', () => {
  const a = app();
  const dd = logWhole(firstOf(a, 'threshold'));
  const pa = a.computePartialAssessment(dd);
  assert.ok(pa, 'a session logged simply was not assessed at all');
  assert.ok(pa.ratio > 0.98, 'the distance was not read');
  assert.ok(['within', 'faster', 'slower'].includes(pa.paceRead), 'the overall pace was not read');
});

test('more evidence does not lower the ceiling: adding HR and RPE keeps a good session good', () => {
  const a = app();
  const sparse = a.computeExecutionBreakdown(logBySection(a, firstOf(a, 'threshold')));
  const b = app();
  const bd = logBySection(b, firstOf(b, 'threshold'));
  bd.actual.rpe = 6;
  const rich = b.computeExecutionBreakdown(bd);
  assert.ok(rich.score > 0 && sparse.score > 0);
  assert.ok(rich.counted.length >= sparse.counted.length,
    'adding evidence reduced what was counted');
});

// ---------------------------------------------------------------------------
// THE ARITHMETIC DID NOT CHANGE TO GET THE DISCLOSURE
// ---------------------------------------------------------------------------
test('naming the resolution did not move any score', () => {
  /* The whole point of the finding: the maths was already right. If adding a
     label changed a number, the label would be doing something it must not. */
  const a = app();
  const dd = logBySection(a, firstOf(a, 'threshold'));
  const b = a.computeExecutionBreakdown(dd);
  const parts = {};
  b.parts.forEach(p => { parts[p.key] = p.score; });
  /* Distance logged exactly as prescribed and pace inside the composite band
     must still score the way they always did. */
  assert.equal(parts.distance, 100, 'a distance logged exactly as prescribed stopped scoring 100');
  assert.equal(a.computeExecutionScore(dd), b.score,
    'the headline score and the breakdown disagree');
});

test('the prescription is untouched by how the athlete chose to log', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  const beforeKm = dd.km, beforeType = dd.type;
  logWhole(dd);
  a.computeExecutionBreakdown(dd);
  assert.equal(dd.km, beforeKm, 'logging changed the prescribed distance');
  assert.equal(dd.type, beforeType, 'logging changed the session type');
});

// ---------------------------------------------------------------------------
// THE BOTTOM RUNG — founder decision A: distance alone IS evidence
// ---------------------------------------------------------------------------
/* The ladder, and each rung claims strictly less than the one above:
 *   distance only        -> was the session COMPLETED, and at what length
 *   distance + pace      -> how it was EXECUTED against the prescription
 *   segment/lap evidence -> how each SECTION was run  (not yet available)
 */
test('a logged distance alone produces a real, deliberately broad assessment', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = { km: dd.km };
  const c = a.computeCompletionAssessment(dd);
  assert.ok(c, 'a logged distance still produces nothing');
  assert.equal(c.verdict, 'full');
  assert.equal(c.tier, 'completion');
});

test('the completion rung claims nothing about pace, intensity or sections', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = { km: dd.km };
  const said = a.completionSummaryLine(a.computeCompletionAssessment(dd));
  [/pace adherence/i, /threshold/i, /on target/i, /%/, /score/i].forEach(bad =>
    assert.ok(!bad.test(said), 'the completion line over-claims: ' + said));
  assert.match(said, /not judged on pace or effort/,
    'the athlete is not told what this evidence cannot speak to');
});

test('there is no execution percentage at the completion rung', () => {
  /* A number in the execution slot would say everything the evidence cannot. */
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = { km: dd.km };
  const c = a.computeCompletionAssessment(dd);
  assert.equal(c.score, undefined, 'the completion rung grew an execution score');
});

test('partial distances are described honestly, not scored', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  const cases = [[1.00, 'full'], [0.90, 'most'], [0.60, 'part'], [0.30, 'short']];
  cases.forEach(([mult, verdict]) => {
    dd.completed = true;
    dd.actual = { km: dd.km * mult };
    assert.equal(a.computeCompletionAssessment(dd).verdict, verdict,
      'wrong verdict at ' + mult);
  });
});

test('the completion rung steps aside the moment pace is logged', () => {
  const a = app();
  const dd = logWhole(firstOf(a, 'threshold'));
  assert.equal(a.computeCompletionAssessment(dd), null,
    'the broad rung competed with the partial rung');
  assert.ok(a.computePartialAssessment(dd), 'the higher rung stopped working');
  assert.ok(a.computeExecutionBreakdown(logSections(a, dd, 1)), 'logged by section, it is not scored');
});

test('a distance-only log still feeds no coaching decision', () => {
  /* The claim is broad; the INFLUENCE must stay narrow. The breakdown is what
     the training signal, the Playbook, plan evolution and the spoken debrief
     read, and it must still be null here -- otherwise a session nobody
     observed the pace of would start moving the plan. */
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = { km: dd.km };
  assert.equal(a.computeExecutionBreakdown(dd), null,
    'a distance-only log now reaches the coaching engine');
  assert.equal(a.computeExecutionScore(dd), null);
});

test('the Execution Review card shows the assessment rather than an instruction', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = { km: dd.km };
  const html = a.renderExecutionReview(dd);
  assert.match(html, /Session completed/, 'the card still refuses to read what it was given');
  assert.match(html, /Add an average pace/, 'the next rung is not offered');
});

test('an athlete who logged nothing usable is still asked for more', () => {
  const a = app();
  const dd = firstOf(a, 'threshold');
  dd.completed = true;
  dd.actual = {};
  assert.equal(a.computeCompletionAssessment(dd), null);
  assert.match(a.renderExecutionReview(dd), /Log actual/,
    'an empty log stopped prompting');
});
