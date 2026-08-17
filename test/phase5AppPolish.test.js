'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// PHASE 5 -- APP RELEASE-READINESS PASS
// Regression coverage for the genuine defects found during the release-quality
// walkthrough. Each test pins a specific fix; none re-derives System's
// decision semantics (coachDecision/planEvolution are exercised through their
// real return values, never re-implemented here).

// ---------------------------------------------------------------------------
// COACH_DECISION_META: the Next Move / Athlete State pill was left as raw
// decision-engine verbs for two of its four states. "Check" read as an
// imperative with nothing to check, "Modify" as a dashboard action rather
// than a coach's read of today. The internal keys and every branch that
// switches on dec.state are untouched -- this is the .label text only.
// ---------------------------------------------------------------------------
test('COACH_DECISION_META: the four internal states are unrenamed', () => {
  const a = loadApp();
  assert.deepEqual(Object.keys(a.COACH_DECISION_META).sort(),
    ['check', 'modify', 'proceed', 'recover']);
});

test('COACH_DECISION_META: proceed and recover keep their plain coaching words', () => {
  const a = loadApp();
  assert.equal(a.COACH_DECISION_META.proceed.label, 'Proceed');
  assert.equal(a.COACH_DECISION_META.recover.label, 'Recover');
});

test('COACH_DECISION_META: check and modify no longer read as bare engine verbs', () => {
  const a = loadApp();
  assert.notEqual(a.COACH_DECISION_META.check.label, 'Check',
    '"Check" alone answers no question -- check what?');
  assert.notEqual(a.COACH_DECISION_META.modify.label, 'Modify',
    '"Modify" is a dashboard imperative, not something a coach says');
  assert.equal(a.COACH_DECISION_META.check.label, 'Worth watching');
  assert.equal(a.COACH_DECISION_META.modify.label, 'Scale back');
});

test('COACH_DECISION_META: the check pill agrees with coachDecisionSentence\'s own wording', () => {
  // The pill and the paragraph beneath it describe the same decision; picking
  // a phrase the sentence itself already uses keeps them from reading as two
  // different opinions.
  const a = loadApp();
  const sentence = a.coachDecisionSentence('check', null, [], [], null, true, 12);
  assert.match(sentence, /worth watching/i);
  assert.equal(a.COACH_DECISION_META.check.label, 'Worth watching');
});

test('COACH_DECISION_META: colour classes are untouched, only the label text changed', () => {
  const a = loadApp();
  assert.equal(a.COACH_DECISION_META.proceed.cls, 'proceed');
  assert.equal(a.COACH_DECISION_META.check.cls, 'check');
  assert.equal(a.COACH_DECISION_META.modify.cls, 'modify');
  assert.equal(a.COACH_DECISION_META.recover.cls, 'recover');
});

// ---------------------------------------------------------------------------
// Plan HQ: "Recent patterns" and "Adaptation history" report the identical
// not-enough-data-yet concept side by side. One read "learning", its sibling
// read "Learning" -- a visible capitalisation mismatch between two rows a
// glance apart, and out of step with every other standalone status word in
// the app (BLOCK_META, EVOLUTION_META, COACH_DECISION_META are all Title Case).
// ---------------------------------------------------------------------------
test('responsePatternsSummary: the no-data fallback matches the app\'s Title Case status words', () => {
  const a = loadApp();
  assert.equal(a.responsePatternsSummary(null, 0), 'Learning');
  assert.equal(a.responsePatternsSummary(null, 0), a.BLOCK_META.LEARNING.label,
    'the two adjacent Plan HQ rows must agree on the same word for the same idea');
});

test('responsePatternsSummary: the counted branches are untouched', () => {
  const a = loadApp();
  // noted-count branch does not require a real playbook model
  assert.equal(a.responsePatternsSummary(null, 3), '3 noted');
});
