'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 12, finding B1). Valhalla's
// Recovery and Evolution dials hard-coded their face colour to a fixed
// category identity (green, gold) regardless of the reading's live tone --
// while the Coach-tab list row for the exact same readingSections() object
// colours by that live tone. A "Strained" Recovery reading rendered inside a
// calm green circle; a RECOVER-tier Evolution state rendered in gold, not
// red -- the app's own "at a glance" instrument showing a reassuring colour
// for a fatigue/overreach warning, and disagreeing with itself one tab over.
//
// THE FIX. dialAccentBase()/dialTint() now fall back to the live
// toneRingColor(sec.tone) for recovery/evolution when a tone is present,
// exactly as adaptation already did -- falling back to the historical fixed
// colour only when no tone is present.

function planHQ() {
  const a = loadApp();
  buildPlan(a, { weeks: 8, startDate: a.addDays(a.todayStr(), -14) });
  return a;
}

test('recovery dial reflects a strained (bad) tone, not the fixed green identity', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  report.recovery.state = 'strained';
  const sec = a.readingSections(report).find((s) => s.key === 'recovery');
  assert.equal(sec.tone, 'bad', 'sanity: strained must read as a bad tone');
  assert.equal(a.dialAccentBase(sec), a.toneRingColor('bad'));
  assert.notEqual(a.dialAccentBase(sec), 'var(--c-easy)',
    'a strained reading must not render inside the calm/fresh green identity');
  assert.equal(a.dialTint(sec), 'var(--c-tempo-soft)');
});

test('recovery dial keeps its fixed green identity when fresh (good tone)', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  report.recovery.state = 'fresh';
  const sec = a.readingSections(report).find((s) => s.key === 'recovery');
  assert.equal(sec.tone, 'good');
  assert.equal(a.dialAccentBase(sec), a.toneRingColor('good'));
});

test('evolution dial reflects a recover/modify (bad) tone, not the fixed gold identity', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  assert.ok(report.evolution, 'sanity: a real evolution object must exist');
  report.evolution.state = 'RECOVER';
  const sec = a.readingSections(report).find((s) => s.key === 'evolution');
  assert.equal(sec.tone, 'bad', 'sanity: RECOVER must read as a bad tone');
  assert.equal(a.dialAccentBase(sec), a.toneRingColor('bad'));
  assert.notEqual(a.dialAccentBase(sec), 'var(--gold)',
    'a RECOVER-tier evolution state must not render in the same gold as an unremarkable one');
});

test('readiness and patterns dials are unaffected -- they never carry a tone', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  const secs = a.readingSections(report);
  const readiness = secs.find((s) => s.key === 'readiness');
  const patterns = secs.find((s) => s.key === 'patterns');
  assert.equal(readiness.tone, null);
  assert.equal(patterns.tone, null);
  assert.equal(a.dialAccentBase(readiness), 'var(--cherry)');
  assert.equal(a.dialAccentBase(patterns), 'var(--c-rest)');
});

test('adaptation dial behaviour is unchanged by this fix', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  const secs = a.readingSections(report);
  const adaptation = secs.find((s) => s.key === 'adaptation');
  assert.ok(adaptation, 'sanity: adaptation section must exist');
  assert.equal(a.dialAccentBase(adaptation), a.toneRingColor(adaptation.tone) || 'var(--c-rest)');
});
