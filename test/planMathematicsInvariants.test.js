'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runMatrix, VOLUMES, WEEKS, SCHEDULES, DISTANCES } = require('./audit/matrix.js');
const { auditCase } = require('./audit/planAudit.js');

/* PLAN MATHEMATICS — PROPERTY TESTS OVER THE WHOLE INPUT SPACE
 * ===========================================================================
 * Two thousand three hundred and fifty generated plans, every integer weekly
 * volume from 1 to 40 plus samples to 120, at every supported race distance,
 * five block lengths and two day counts. Roughly two hundred thousand
 * sessions, generated through buildBlockWeeks() and buildDaysFromWeeks() --
 * the same pair handleGeneratePlan() calls.
 *
 * WHY THERE IS A BASELINE FILE, AND WHAT IT IS NOT.
 *
 * The audit found defects the fix for which requires COACHING DECISIONS that
 * are not this suite's to take (see AUDIT-PLAN-MATHEMATICS.md). Asserting
 * those invariants outright would turn the suite red at a commit that changed
 * nothing; deleting them would lose the measurement. So they are held against
 * a frozen count in test/audit/baseline.json and the assertion is a RATCHET:
 * the count may fall, and may never rise.
 *
 * test/audit/baseline.json IS A DEFECT RECORD. Every non-zero entry in it is
 * a known fault with an owner. It is not a statement that the behaviour is
 * correct, and a number in it is not permission to keep it.
 *
 * The invariants that hold everywhere today are asserted flat, at zero, with
 * no baseline -- those are the ones a future change must never break.
 */

const BASELINE = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit', 'baseline.json'), 'utf8'));

/* One sweep, shared by every test below: 2,350 plans is a few seconds, and
   running it once per assertion would be a few minutes. */
let RESULT = null;
function matrix(){ if (!RESULT) RESULT = runMatrix(); return RESULT; }
function count(code){ return matrix().tally[code] || 0; }
function baselineOf(code){ return BASELINE.tally[code] || 0; }

// ---------------------------------------------------------------------------
// THE MATRIX ITSELF
// ---------------------------------------------------------------------------
test('the audit matrix covers the builder\'s whole supported input space', () => {
  const spec = require('../assets/builder-spec.js');
  /* Volume: the builder validates `volume > 0` and sets no upper bound, so
     the matrix starts at the smallest accepted value and runs past any
     plausible one. */
  assert.equal(spec.validation.volumeMustExceed, 0,
    'the builder\'s volume rule moved; the matrix\'s lower bound must move with it');
  assert.equal(VOLUMES[0], 1, 'the smallest accepted weekly volume must be covered');
  assert.ok(VOLUMES.indexOf(40) !== -1 && Math.max(...VOLUMES) >= 120);
  for (let v = 1; v <= 40; v++)
    assert.ok(VOLUMES.indexOf(v) !== -1, v + 'km/week is not covered');
  // Block length: exactly the range the builder accepts, ends included.
  assert.deepEqual(spec.validation.weeksRange, [4, 24]);
  assert.ok(WEEKS.indexOf(4) !== -1 && WEEKS.indexOf(24) !== -1,
    'both ends of the supported block length must be covered');
  // Day count: the fewest the builder accepts, and a typical week.
  assert.deepEqual(spec.validation.daysRange, [3, 6]);
  assert.equal(SCHEDULES[0], 'd3', 'the fewest supported running days must be covered');
  assert.deepEqual(DISTANCES, ['5k', '10k', 'half', 'full', 'ultra']);

  const m = matrix();
  assert.equal(m.plans, 2350);
  assert.ok(m.sessions > 200000, 'the matrix generated ' + m.sessions + ' sessions');
});

// ---------------------------------------------------------------------------
// INVARIANTS THAT HOLD EVERYWHERE TODAY — asserted flat, never ratcheted
// ---------------------------------------------------------------------------
test('the generator never throws, anywhere in the input space', () => {
  assert.equal(count('generator_threw'), 0);
});

test('no distance is NaN or infinite, in any session or any component', () => {
  assert.equal(count('session_km_not_finite'), 0);
  assert.equal(count('segment_km_not_finite'), 0);
});

test('no SESSION carries a negative distance', () => {
  /* Distinct from the segment check below, and it passes where that one does
     not: the day's own km is floored, the components derived from it are not. */
  assert.equal(count('session_km_negative'), 0);
});

test('deriving a session\'s components never throws', () => {
  assert.equal(count('segments_threw'), 0);
});

test('a fully quantified session reconciles with its own components', () => {
  /* Where every component states a distance, they sum to the day. Sessions
     with deliberately unquantified flanks ("Easy warm-up jog") are excluded
     by the check rather than guessed at. */
  assert.equal(count('segments_do_not_reconcile'), 0);
});

// ---------------------------------------------------------------------------
// KNOWN DEFECTS — ratcheted against the recorded baseline
// ---------------------------------------------------------------------------
const RATCHETED = [
  ['segment_km_negative',                 'a prescribed component with a negative distance'],
  ['zero_km_work_segment',                'a component the athlete is asked to run, sized at zero'],
  ['long_run_zero_distance',              'a day titled Long Run carrying 0km'],
  ['goal_segment_consumes_whole_long_run','the goal-pace finish is the entire long run or more'],
  ['week_one_exceeds_stated_volume',      'week one is more than 30% above the volume the athlete stated'],
  ['week_overshoots_target',              'a week is more than 35% above its own target'],
  ['week_undershoots_target',             'a week is more than 25% below its own target'],
  ['taper_week_increases_volume',         'a taper week is bigger than the week before it']
];

RATCHETED.forEach(([code, what]) => {
  test('DEFECT BASELINE — ' + what, () => {
    const now = count(code), was = baselineOf(code);
    assert.ok(now <= was,
      code + ' rose from ' + was + ' to ' + now +
      '. This is a known defect held at a ratchet: it may be reduced, never increased.' +
      ' See AUDIT-PLAN-MATHEMATICS.md.');
    if (now < was)
      console.log('  ' + code + ': ' + was + ' -> ' + now +
                  ' — improved. Update test/audit/baseline.json to lock it in.');
  });
});

test('the coaching-suspicious counts are recorded and do not grow', () => {
  /* MATHEMATICALLY VALID, COACHING-SUSPICIOUS. Not defects and not asserted
     as such -- what to do about them is a methodology decision. Held so that
     a change cannot quietly make the programme more suspicious than it is. */
  [['quality_dominates_week',            'quality is over 40% of the week'],
   ['long_run_shorter_than_quality',     'the long run is shorter than a quality session'],
   ['long_run_shorter_than_easy_run',    'the long run is shorter than an easy run'],
   ['long_run_implausible_for_distance', 'a long run under 5km on a half, full or ultra plan'],
   ['goal_segment_over_half_of_long_run','the goal-pace finish is over half the long run'],
   ['week_over_week_growth_over_10pct',  'a week grows more than 10% on the one before']
  ].forEach(([code, what]) => {
    const now = count(code), was = baselineOf(code);
    assert.ok(now <= was, code + ' (' + what + ') rose from ' + was + ' to ' + now);
  });
});

// ---------------------------------------------------------------------------
// THE OBSERVED FAILURE, PINNED TO ITS ARITHMETIC
// ---------------------------------------------------------------------------
test('the reported "Easy 0km / Goal Pace 3km long run" reproduces exactly', () => {
  /* The screenshots, reproduced from inputs rather than described. A half
     marathon athlete stating 12km/week gets a week-three long run of 3km that
     is entirely goal-pace work, with a 0km easy component printed above it. */
  const c = auditCase({ distanceKey: 'half', volume: 12, weeks: 12, scheduleKey: 'd5' });
  const long = c.sessions.find(s => s.week === 3 && s.type === 'long');
  assert.equal(long.archetype, 'long_run_goal_finish');
  assert.equal(long.title, 'Long Run + Goal Pace');
  assert.equal(long.km, 3);
  assert.equal(long.params.finishKm, 3);
  assert.equal(long.segments[0].intensity, 'easy');
  assert.equal(long.segments[0].km, 0, 'the easy component of the long run');
  assert.equal(long.segments[1].intensity, 'goal_pace');
  assert.equal(long.segments[1].km, 3);
});

test('and the 1km / 3km variant is the same defect one week over', () => {
  const c = auditCase({ distanceKey: 'half', volume: 15, weeks: 12, scheduleKey: 'd5' });
  const hit = c.sessions.filter(s => s.type === 'long' &&
    s.archetype === 'long_run_goal_finish' && s.segments[0].km === 1 && s.segments[1].km === 3);
  assert.ok(hit.length > 0, 'expected a 1km easy + 3km goal-pace long run');
});

test('the goal-pace floor beats its own ceiling below a 6km long run', () => {
  /* THE ARITHMETIC, stated directly rather than inferred from a plan.
     goalSegKm = clamp(longTarget*(0.2+0.18*pos), 3, longTarget*0.5), and
     clamp() is Math.max(lo, Math.min(hi, n)) -- so where the ceiling falls
     below the floor, the floor wins and the result exceeds the ceiling it was
     given. Every long run under 6km is affected. */
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.clamp(0.98, 3, 2.0), 3, 'lo beats hi in clamp()');
  for (const longTarget of [1, 2, 3, 4, 5, 5.9]){
    const ceiling = longTarget * 0.5;
    assert.ok(a.clamp(longTarget * 0.2, 3, ceiling) > ceiling,
      'at longTarget ' + longTarget + ' the result exceeds its own ceiling');
  }
  // At and above 6km the ceiling binds again and the session is coherent.
  for (const longTarget of [6, 8, 12, 20]){
    const got = a.clamp(longTarget * 0.38, 3, longTarget * 0.5);
    assert.ok(got <= longTarget * 0.5 + 1e-9,
      'at longTarget ' + longTarget + ' the ceiling must bind');
  }
});

test('a trimmed long run does not carry its goal segment down with it', () => {
  /* THE SECOND HALF OF THE SAME DEFECT. buildDaysFromWeeks ends with a
     settle-up pass that pushes dd.km back into the prescription for every
     archetype with a dayKmParam -- so `km` follows the weekly-volume cap and
     smart rounding. `finishKm` is derived from the same run and is NOT in
     that pass, so it keeps a value computed before the trim. */
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /long_run_goal_finish:\s*\{\s*family:'long',\s*dayKmParam:'km'\s*\}/,
    'the archetype still declares km as its day distance');
  assert.match(src, /if \(meta && meta\.dayKmParam\) p\.params\[meta\.dayKmParam\] = round1\(dd\.km\);/,
    'the settle-up pass still exists');
  /* Demonstrated on a case where the CLAMP behaved correctly and the trim did
     the damage on its own. At 18km/week over 8 weeks, week two's longTarget is
     6.2km, so the ceiling binds and goalSegKm is a legitimate 3km -- under half
     the run. capWeeklyVolume() then cuts the day to 4km and finishKm stays at
     3, so three quarters of the "long run" is goal-pace work. */
  const c = auditCase({ distanceKey: 'half', volume: 18, weeks: 8, scheduleKey: 'd5' });
  const wk2 = c.weeks.find(w => w.week === 2);
  assert.ok(wk2.longTarget >= 6, 'the ceiling binds at this longTarget: ' + wk2.longTarget);
  assert.ok(wk2.goalSegKm <= wk2.longTarget * 0.5 + 1e-9, 'so goalSegKm is legitimate');
  const long = wk2.sessions.find(s => s.archetype === 'long_run_goal_finish');
  assert.ok(long.km < wk2.longTarget - 0.6, 'the day was trimmed after the fact');
  assert.equal(long.params.finishKm, wk2.goalSegKm, 'and finishKm did not follow it down');
  assert.ok(long.params.finishKm > long.km * 0.5,
    'leaving the goal segment at ' + Math.round(long.params.finishKm / long.km * 100) +
    '% of a run it was sized to be under half of');
});

// ---------------------------------------------------------------------------
// THE FLOOR NOBODY CHOSE
// ---------------------------------------------------------------------------
test('the engine cannot build a week smaller than its own component floors', () => {
  /* CAPACITY IS PERMISSION, NOT OBLIGATION -- and the engine currently has no
     way to express the small end at all. EASY_MIN_KM is 3, capWeeklyVolume
     refuses to trim an easy day below 3 or a long run below 70%, and it never
     trims a quality day, so the smallest week the engine can emit is set by
     the number of running days rather than by the athlete. */
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.EASY_MIN_KM, 3, 'the easy-day floor');
  const c = auditCase({ distanceKey: '5k', volume: 1, weeks: 12, scheduleKey: 'd5' });
  const w1 = c.weeks[0];
  assert.ok(w1.actualVolume >= 15,
    'a 1km/week athlete is prescribed ' + w1.actualVolume + 'km in week one');
  assert.ok(w1.actualVolume / 1 > 10, 'that is more than ten times what they stated');
});

test('experience level cannot change a single prescribed number', () => {
  /* Recorded because the audit asked whether the three levels differ
     explainably. They do not differ at all: the engine never reads it. This
     asserts the DOCUMENTED design ("presentation only"), so a future change
     that starts varying the plan by experience has to say so here. */
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const start = src.indexOf('function buildBlockWeeks(');
  const end = src.indexOf('\nfunction dtok(');
  assert.ok(start > 0 && end > start);
  assert.ok(!/experience/i.test(src.slice(start, end)),
    'buildBlockWeeks now reads experience; the presentation-only boundary moved');
  const s2 = src.indexOf('function buildDaysFromWeeks(');
  const e2 = src.indexOf('function capWeeklyVolume(');
  assert.ok(!/experience/i.test(src.slice(s2, e2)),
    'buildDaysFromWeeks now reads experience; the presentation-only boundary moved');
});

// ---------------------------------------------------------------------------
// WHAT IS ALREADY RIGHT — locked so a fix cannot cost it
// ---------------------------------------------------------------------------
test('adjacent stated volumes produce adjacent plans', () => {
  /* CONTINUITY. One extra kilometre a week may not change the plan by more
     than one extra kilometre a week is worth, and may never make it smaller
     by more than a rounding step. Checked at every integer from 1 to 60. */
  for (const distanceKey of ['5k', 'half', 'full']){
    let prev = null;
    for (let v = 1; v <= 60; v++){
      const c = auditCase({ distanceKey, volume: v, weeks: 12, scheduleKey: 'd5' });
      const total = c.sessions.reduce((t, s) => t + (s.km || 0), 0);
      if (prev != null){
        assert.ok(total - prev > -1.0,
          distanceKey + ': ' + (v - 1) + '->' + v + 'km/week made the plan ' +
          Math.round((prev - total) * 10) / 10 + 'km smaller');
        assert.ok(total - prev < 12 * 4,
          distanceKey + ': ' + (v - 1) + '->' + v + 'km/week jumped the plan by ' +
          Math.round((total - prev) * 10) / 10 + 'km');
      }
      prev = total;
    }
  }
});

test('training paces follow current fitness, not the goal', () => {
  /* THE ESTABLISHED METHODOLOGY, asserted here because everything else in
     this file is about volume and a volume fix must not disturb it. An
     athlete whose benchmark says VDOT 32 and whose goal says VDOT 58 trains
     at the paces the benchmark supports. */
  const { loadApp } = require('./harness.js');
  const F = require('./fixtures.js');
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  F.buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12,
                   benchSec: a.clockToSec('1:00:00') });
  const fitnessOnly = a.getCurrentFitnessVDOT();
  a.state.setup.goals = { A: { timeSec: a.clockToSec('1:20:00') } };  // wildly aspirational
  const anchor = a.currentFitnessAnchor();
  assert.equal(anchor.source, 'benchmark');
  assert.equal(a.getCurrentFitnessVDOT(), fitnessOnly,
    'the goal moved and current fitness must not have');
  assert.ok(a.getActiveVDOT() > fitnessOnly + 15, 'the goal really is far above');
});
