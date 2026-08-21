'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* DOES VALHALLA HAVE A DEFENSIBLE COACHING REASON FOR EVERY INCREASE?
 *
 * Before this file the answer was no, and the reason was arithmetic rather
 * than a bug anyone could point at. A block started at absorbedWeeklyVolume()
 * -- the MEDIAN completed week of the block just finished -- and the median of
 * a ramped block sits above its start, so every block began higher than the
 * last for no reason except that the last one had a shape:
 *
 *     start 50  ->  peak 50 x 1.55 = 77.5  ->  median 58.1  ->  start 58.1
 *
 * The demonstrated x 1.10 guard that was supposed to stop this could not: the
 * median is always below the third-highest week it is compared to, so
 * `min(median, demonstrated x 1.10)` returned the median in every block of
 * every cycle. It was live code that never bound.
 *
 * The rule now separates three things that were one thing:
 *
 *   REASON       progressionJustification() -- an affirmative coaching finding
 *   PERMISSION   demonstrated sustainable volume -- may only hold DOWN
 *   LIMIT        the backstop ceiling -- neither a target nor a plan
 *
 * These tests are about the REASON. test/volumeCeiling.test.js owns the other
 * two and still passes unchanged.
 */

const TODAY = '2026-08-21';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState();
  a.state.athlete = a.makeAthleteRecord();
  return a;
}
/* Completed weeks in the archive, most recent first. */
function record(a, kms){
  kms.forEach((km, i) =>
    a.state.athlete.sessions.push({ date: a.addDays(TODAY, -7 * (i + 1)), completed: true, actualKm: km }));
}
/* A closed block on the ledger, with the figures the next block is judged
   against. */
function ledger(a, opts){
  const o = opts || {};
  a.state.athlete.blocks.push({
    id: 'b' + a.state.athlete.blocks.length, purpose: o.purpose || 'race',
    status: 'closed', startDate: a.addDays(TODAY, -84), endDate: a.addDays(TODAY, -1),
    anchorVolume: o.anchor, startVolume: o.anchor, peakVolume: o.peak });
}

/* ------------------------------------------------------------------ *
 * THE REASON EXISTS, AND IT IS SAYABLE
 * ------------------------------------------------------------------ */

test('every progression decision carries a sentence the athlete could be shown', () => {
  const a = app();
  const cases = [];
  cases.push(a.progressionJustification());                       // nothing at all
  record(a, [60, 58, 56]);
  cases.push(a.progressionJustification());                       // capacity, no block
  ledger(a, { anchor: 55, peak: 60 });
  cases.push(a.progressionJustification());                       // a block to judge
  ledger(a, { purpose: 'recovery', anchor: 55, peak: 30 });
  cases.push(a.progressionJustification());
  cases.forEach(c => {
    assert.equal(typeof c.earned, 'boolean');
    assert.ok(c.reason && c.reason.length > 20, 'no sentence: ' + JSON.stringify(c));
    assert.ok(!/undefined|null|NaN/.test(c.reason), 'placeholder leaked: ' + c.reason);
    // The enum is internal. It must never reach the sentence.
    if (c.blockedBy) assert.ok(c.reason.indexOf(c.blockedBy) === -1, c.reason);
  });
});

test('with no completed training there is no capacity, and no growth is claimed', () => {
  const a = app();
  const j = a.progressionJustification();
  assert.equal(j.earned, false);
  assert.equal(j.blockedBy, 'no_capacity');
});

test('a first block starts at what the athlete runs now, not a step above it', () => {
  /* The athlete typed 40 and has a 76km history behind them -- returning from
     a layoff is the case this protects. */
  const a = app();
  record(a, [80, 78, 76]);
  const j = a.progressionJustification();
  assert.equal(j.earned, false);
  assert.equal(j.blockedBy, 'no_previous_block');
  assert.equal(a.cappedBlockStartVolume(40, 'half'), 40);
});

/* ------------------------------------------------------------------ *
 * COMPLIANCE IS NOT, BY ITSELF, A REASON
 * ------------------------------------------------------------------ */

test('completing a block that was never reached does not earn a step up', () => {
  /* The heart of it. The athlete ran every session they attempted, but never
     got near the top of the ramp -- so there is nothing to build on. */
  const a = app();
  record(a, [50, 49, 48]);
  ledger(a, { anchor: 55, peak: 75 });          // prescribed 75, held 50
  const j = a.progressionJustification();
  assert.equal(j.earned, false);
  assert.equal(j.blockedBy, 'peak_not_reached');
  /* No step: the anchor is 55, so an earned block would open at 60.5. It does
     not -- and permission then holds it further down still, to what the
     athlete has actually demonstrated, which is the two clauses doing
     different jobs in the same call. */
  assert.equal(a.cappedBlockStartVolume(52, 'half'), 52.8);  // 48 x 1.10, not 60.5
  assert.ok(a.cappedBlockStartVolume(52, 'half') < 55);
});

test('reaching the top of the last block does earn a step up', () => {
  const a = app();
  record(a, [74, 72, 70]);
  ledger(a, { anchor: 55, peak: 72 });
  const j = a.progressionJustification();
  assert.equal(j.earned, true, j.reason);
  assert.equal(a.cappedBlockStartVolume(60, 'half'), 60.5);  // 55 x 1.10
});

test('recovery and maintenance never earn a step up, however well they went', () => {
  /* You do not earn more training by recovering from a race or by holding
     what you have. Both blocks are deliberate reductions. */
  ['recovery', 'maintain'].forEach(purpose => {
    const a = app();
    record(a, [74, 72, 70]);
    ledger(a, { purpose, anchor: 55, peak: 72 });
    const j = a.progressionJustification();
    assert.equal(j.earned, false, purpose + ' earned progression');
    assert.equal(j.blockedBy, 'not_a_development_block');
    assert.equal(a.cappedBlockStartVolume(60, 'half'), 55);
  });
});

test('a deliberate reduction does not become the athlete\'s new level', () => {
  /* The failure mode of anchoring to the last block's START rather than its
     LEVEL: recovery opens at half the athlete's volume, so three years of
     perfect compliance ratcheted DOWN to 20km/week. The ledger records the
     level each block was computed FROM. */
  const a = app();
  record(a, [74, 72, 70]);
  a.state.athlete.blocks.push({ id: 'r', purpose: 'recovery', status: 'closed',
    anchorVolume: 55, startVolume: 28, peakVolume: 28 });
  assert.equal(a.cappedBlockStartVolume(28, 'half'), 55,
    'the recovery block\'s own reduced volume became the new baseline');
});

/* ------------------------------------------------------------------ *
 * THE EVIDENCE GATES, DRIVEN THROUGH REAL PLANS
 * ------------------------------------------------------------------ */

function blockRun(opts){
  const o = opts || {};
  const a = app();
  buildPlan(a, { distanceKey: 'half', volume: 55, weeks: 12,
                 startDate: a.addDays(TODAY, -84), benchSec: 45 * 60 });
  a.state.athlete = a.makeAthleteRecord();
  a.state.athlete.blocks.push({ id: 'prev', purpose: 'race', status: 'closed',
    anchorVolume: 55, startVolume: 55, peakVolume: o.peak != null ? o.peak : 1 });
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')
    .forEach((d, i) => { if (o.runs(i)) logAsPrescribed(a, d, { quality: o.quality(i) }); });
  return a;
}

test('sessions going unrun holds the volume, and says so', () => {
  const a = blockRun({ runs: i => i % 3 !== 0, quality: () => 1 });
  const j = a.progressionJustification();
  assert.equal(j.earned, false, j.reason);
  assert.equal(j.blockedBy, 'missed_sessions');
  assert.ok(/unrun/.test(j.reason), j.reason);
});

test('quality sessions not landing holds the volume, and says so', () => {
  const a = blockRun({ runs: () => true, quality: () => 0.6 });
  const j = a.progressionJustification();
  assert.equal(j.earned, false, j.reason);
  assert.equal(j.blockedBy, 'execution');
});

test('running everything, well, and reaching the peak earns the step', () => {
  const a = blockRun({ runs: () => true, quality: () => 1 });
  const j = a.progressionJustification();
  assert.equal(j.earned, true, j.reason + ' / ' + JSON.stringify(j));
});

/* ------------------------------------------------------------------ *
 * THE PEAK IS BOUNDED BY CAPACITY TOO
 * ------------------------------------------------------------------ */

test('demonstrated capacity bounds the top of the ramp, not only its start', () => {
  /* Reported as a launch question: an athlete whose demonstrated capacity was
     60km/week was prescribed a 105km marathon peak, because profile.volMult
     was applied to the start with nothing checking the result against the
     athlete. The backstop for `full` is 170 and never bound. */
  const a = app();
  record(a, [61, 60, 60]);
  const br = a.buildBlockWeeks('full', 60, 16, { purpose: 'race' });
  assert.ok(br.peakVolume <= 60 * a.PEAK_OVER_DEMONSTRATED + 0.1,
    'peaked at ' + br.peakVolume + ' from a demonstrated 60');
  assert.ok(br.peakVolume < 105, 'the reported 105km peak is still reachable');
});

test('a half athlete demonstrating 50 is no longer given a 77.5km peak', () => {
  const a = app();
  record(a, [51, 50, 50]);
  const br = a.buildBlockWeeks('half', 50, 12, { purpose: 'race' });
  assert.ok(br.peakVolume <= 65.1, 'peaked at ' + br.peakVolume);
});

test('with no demonstrated capacity the peak is unchanged, so a first block is untouched', () => {
  const a = app();
  const br = a.buildBlockWeeks('half', 50, 12, { purpose: 'race' });
  assert.equal(br.peakVolume, 77.5);
});

test('the backstop is a limit and not a target: growth stops long before it', () => {
  /* An athlete who reaches the top of every block still steps 10% at a time
     from their own level, and only from a development block. Three cycles of
     flawless training from 50km/week must not arrive at the 140 backstop. */
  const a = app();
  record(a, [74, 72, 70]);
  let anchor = 55;
  for (let i = 0; i < 3; i++){
    a.state.athlete.blocks.push({ id: 'b' + i, purpose: 'base', status: 'closed',
      anchorVolume: anchor, startVolume: anchor, peakVolume: 60 });
    anchor = a.cappedBlockStartVolume(anchor, 'half');
  }
  assert.ok(anchor < 79, 'three earned steps reached ' + anchor);
  assert.ok(anchor < a.volumeCeilingFor('half'));
});

/* ------------------------------------------------------------------ *
 * HEALTH-DATA CONSENT INDEPENDENCE
 * ------------------------------------------------------------------ */

test('progression is earned on identical evidence with and without health data', () => {
  /* The constraint from §15: no learning mechanism may need covered data,
     because declining consent must not silently degrade the training. Every
     gate here reads completion, distance and pace. */
  const withHR = blockRun({ runs: () => true, quality: () => 1 });
  const withoutHR = blockRun({ runs: () => true, quality: () => 1 });
  withoutHR.state.days.forEach(d => {
    if (d.actual){ d.actual.hr = null; d.actual.rpe = null; }
  });
  withoutHR.state.setup.lthr = null; withoutHR.state.setup.maxHR = null;
  const a1 = withHR.progressionJustification(), a2 = withoutHR.progressionJustification();
  assert.equal(a1.earned, a2.earned);
  assert.equal(a1.blockedBy, a2.blockedBy);
  assert.equal(withHR.demonstratedSustainableVolume(), withoutHR.demonstratedSustainableVolume());
  assert.equal(withHR.cappedBlockStartVolume(55, 'half'), withoutHR.cappedBlockStartVolume(55, 'half'));
});

test('a poor-execution hold is reachable from distance and pace alone', () => {
  const a = blockRun({ runs: () => true, quality: () => 0.6 });
  a.state.days.forEach(d => { if (d.actual){ d.actual.hr = null; d.actual.rpe = null; } });
  a.state.setup.lthr = null; a.state.setup.maxHR = null;
  const j = a.progressionJustification();
  assert.equal(j.blockedBy, 'execution', 'withholding heart rate changed the answer');
});
