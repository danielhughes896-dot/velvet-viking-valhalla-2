'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* MAINTENANCE HAS TO ACTUALLY MAINTAIN.
 *
 * Two defects, both invisible on the card. "Maintain & Protect" ran the same
 * progression machinery as a race build: every quality structure lerps its
 * dimensions across `pos`, progress through the build, and in a steady block
 * the build was the whole block. Tempo went 16 -> 25 minutes and interval
 * sessions 7.6 -> 12.6km across eight weeks -- a 56-66% increase in quality
 * load in a block whose name promises the opposite. The weekly volume was
 * flat, which is exactly why nobody saw it.
 *
 * The second: every long run in the block finished "at Goal Pace", for an
 * athlete who had not entered a race and whose block does not culminate in
 * anything. It was the single most-repeated session in the programme.
 *
 * And the fix for the first makes the third worse before it makes it better:
 * with the dose held level, a three-structure rotation makes weeks 1, 4 and 7
 * of an eight-week block byte-identical. So all three are tested together.
 */

const TODAY = '2026-08-21';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  a.state.athlete = a.makeAthleteRecord();
  return a;
}
const maintain = (a, weeks) =>
  a.buildBlockWeeks('half', 45, weeks || 8, { steady: true, purpose: 'maintain' });
const sig = w => JSON.stringify(w.qSpec) + '|' + JSON.stringify(w.tSpec);
const load = (a, w) => a.intervalSessionKm(w.qSpec) + a.tempoSessionKm(w.tSpec);
/* Least-squares slope in km of quality load per week. The honest test of "does
   this block progress": a single start-to-end comparison can be defeated by an
   undulation that happens to land low on week 1, and a trend cannot. */
function slope(ys){
  const n = ys.length, sx = (n - 1) * n / 2, sy = ys.reduce((p, q) => p + q, 0);
  let sxx = 0, sxy = 0;
  ys.forEach((y, i) => { sxx += i * i; sxy += i * y; });
  return (n * sxy - sx * sy) / (n * sxx - sx * sx);
}
// Close a finished block the way the app does, so the ledger advances.
const finish = (a, purpose) =>
  a.state.athlete.blocks.push({ id: 'blk' + a.state.athlete.blocks.length,
                                purpose: purpose, status: 'closed' });

/* ---------------------------------------------------------------- *
 * (2) THE BLOCK MUST NOT PROGRESS
 * ---------------------------------------------------------------- */

test('a maintenance block has no upward trend in quality load', () => {
  const a = app();
  const ys = maintain(a).weeks.map(w => load(a, w));
  assert.ok(Math.abs(slope(ys)) < 0.5,
    'quality load trends ' + slope(ys).toFixed(2) + ' km/week across a block called Maintain');
});

test('the regression, named: quality load no longer grows by half across eight weeks', () => {
  const a = app();
  const ys = maintain(a).weeks.map(w => load(a, w));
  const growth = Math.max.apply(null, ys) / Math.min.apply(null, ys);
  assert.ok(growth < 1.9,
    'the block spans ' + Math.round((growth - 1) * 100) + '% of quality load; it used to span 66%');
  // and the specific dimension the defect was found in
  const mins = maintain(a).weeks.map(w => w.tSpec.min).filter(m => m != null);
  assert.ok(Math.max.apply(null, mins) - Math.min.apply(null, mins) <= 6,
    'tempo minutes still walk from ' + Math.min.apply(null, mins) + ' to ' + Math.max.apply(null, mins));
});

test('but the weeks are not all the same dose either: maintenance undulates', () => {
  /* The opposite failure. A block that holds one number for eight weeks is not
     coaching, and hard/easy alternation is not progression. */
  const a = app();
  const ys = maintain(a).weeks.map(w => load(a, w));
  assert.ok(new Set(ys.map(y => Math.round(y))).size >= 4,
    'eight maintenance weeks produced only ' + new Set(ys.map(y => Math.round(y))).size + ' distinct doses');
});

test('the dose cycle returns to where it started and averages the middle', () => {
  const a = app();
  const cyc = a.MAINTAIN_POS_CYCLE;
  assert.equal(cyc.reduce((p, q) => p + q, 0) / cyc.length, 0.5,
    'the maintenance dose cycle has a trend built into its own average');
});

test('a race block still progresses -- the flattening did not leak', () => {
  const a = app();
  const ys = a.buildBlockWeeks('half', 45, 12, { purpose: 'race' })
              .weeks.filter(w => !w.isTaper && !w.isRace).map(w => load(a, w));
  assert.ok(slope(ys) > 0.2, 'a race build stopped building (slope ' + slope(ys).toFixed(2) + ')');
});

/* ---------------------------------------------------------------- *
 * (3) A GOAL PACE NEEDS A GOAL
 * ---------------------------------------------------------------- */

test('no session in a maintenance block is run at goal pace', () => {
  const a = app();
  maintain(a).weeks.forEach(w => {
    assert.equal(w.hasGoalSegment, false, 'week ' + w.week + ' finishes at goal pace');
    assert.equal(w.goalSegKm, 0);
  });
});

test('nor does the maintenance pool contain a goal-pace structure at all', () => {
  /* Belt and braces: the long-run segment is one route to goal pace and the
     quality pools are the other. */
  const a = app();
  const names = [].concat(a.INTERVAL_STRUCTURE_POOL.Maintain, a.TEMPO_STRUCTURE_POOL.Maintain)
                  .map(f => f.name);
  assert.deepEqual(names.filter(n => /goal/i.test(n)), []);
});

test('a recovery block carries no goal pace either', () => {
  const a = app();
  a.buildBlockWeeks('half', 30, 2, { steady: true, purpose: 'recovery' })
   .weeks.forEach(w => assert.equal(w.hasGoalSegment, false));
});

test('a race block keeps its goal-pace work', () => {
  const a = app();
  const wk = a.buildBlockWeeks('half', 45, 12, { purpose: 'race' })
              .weeks.filter(w => w.hasGoalSegment);
  assert.ok(wk.length > 0, 'goal-pace work disappeared from a race build');
  assert.ok(wk.every(w => w.goalSegKm > 0));
});

test('a race block with no entered event keeps it too: it still ends in a goal effort', () => {
  /* The builder says so in as many words -- "the athlete chooses the block
     length and it culminates in a goal effort". The gate is the PURPOSE, not
     whether there is a row in a race calendar. */
  const a = app();
  const built = a.buildBlockWeeks('half', 45, 12, { purpose: 'race', hasEvent: false });
  assert.ok(built.weeks.some(w => w.hasGoalSegment));
});

/* ---------------------------------------------------------------- *
 * (4) ROTATION: WITHIN A BLOCK AND ACROSS BLOCKS
 * ---------------------------------------------------------------- */

test('no session repeats inside an eight-week maintenance block', () => {
  const a = app();
  const sigs = maintain(a).weeks.map(sig);
  assert.equal(new Set(sigs).size, 8, 'the block contains a repeated session');
});

test('a second maintenance block shares no week with the first', () => {
  const a = app();
  const first = maintain(a).weeks.map(sig);
  finish(a, 'maintain');
  const second = maintain(a).weeks.map(sig);
  const same = first.filter((s, i) => s === second[i]);
  assert.equal(same.length, 0, same.length + ' of 8 weeks were byte-identical to the last block');
});

test('three consecutive maintenance blocks produce 24 distinct sessions', () => {
  const a = app();
  const all = [];
  for (let i = 0; i < 3; i++){ maintain(a).weeks.forEach(w => all.push(sig(w))); finish(a, 'maintain'); }
  assert.equal(new Set(all).size, 24,
    'only ' + new Set(all).size + ' distinct sessions across 24 maintenance weeks');
});

test('the rotation is deterministic, not random', () => {
  /* The brief is explicit that workouts must not be randomised for novelty.
     Two engines with the same history must produce the same block. */
  const a = app(), b = app();
  finish(a, 'maintain'); finish(a, 'maintain');
  finish(b, 'maintain'); finish(b, 'maintain');
  assert.equal(maintain(a).weeks.map(sig).join('\n'), maintain(b).weeks.map(sig).join('\n'));
});

test('rebuilding the live block does not turn the rotation', () => {
  /* Re-tailoring a plan is not starting a new block, and the athlete must not
     find every future session swapped because they changed their rest day. */
  const a = app();
  finish(a, 'maintain');
  const before = maintain(a).weeks.map(sig).join('\n');
  a.state.athlete.blocks.push({ id: 'live', purpose: 'maintain', status: 'active' });
  assert.equal(maintain(a).weeks.map(sig).join('\n'), before,
    'the live block counted itself and rotated the athlete onto different sessions');
});

test('rotation is counted per purpose, so base blocks do not turn the maintain dial', () => {
  const a = app();
  const before = maintain(a).weeks.map(sig).join('\n');
  finish(a, 'base'); finish(a, 'speed'); finish(a, 'race');
  assert.equal(maintain(a).weeks.map(sig).join('\n'), before);
});

test('an athlete with no history at all still gets a block', () => {
  /* blockRotationFor reads the ledger, and the two callers that predate
     year-round training do not have one. */
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = { setup: null, days: [] };
  const built = a.buildBlockWeeks('half', 45, 8, { steady: true, purpose: 'maintain' });
  assert.equal(built.weeks.length, 8);
});
