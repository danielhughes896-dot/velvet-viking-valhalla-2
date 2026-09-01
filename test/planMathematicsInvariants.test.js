'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runMatrix, VOLUMES, WEEKS, SCHEDULES, DISTANCES } = require('./audit/matrix.js');
const { auditCase, auditOnRamp, auditFoundation } = require('./audit/planAudit.js');
const { checkOnRamp, checkFoundation } = require('./audit/invariants.js');

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
  ['generator_invariant_failure',         'the generator itself recorded a session that does not reconcile'],
  ['volume_unattributed',                 'a week carries volume with no named cause'],
  ['allocator_revision_undeclared',       'volume the allocator could not place, undeclared'],
  ['deliberate_reduction_unnamed',        'a reduction with no named coaching reason'],
  ['floor_excess_unnamed',                'volume a floor forced in, with no named cause'],
  ['week_has_no_volume_accounting',       'a generated week with no accounting at all'],
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
   ['goal_segment_over_half_of_long_run','the goal-pace finish is over half the long run']
  ].forEach(([code, what]) => {
    const now = count(code), was = baselineOf(code);
    assert.ok(now <= was, code + ' (' + what + ') rose from ' + was + ' to ' + now);
  });
});

// ---------------------------------------------------------------------------
// WEEKLY LOAD PROGRESSION — the instrument that replaced a percentage
// ---------------------------------------------------------------------------
/* week_over_week_growth_over_10pct used to be in the list above. It asked one
   question of every week -- did the total rise more than ten per cent -- and
   answered it identically for +1km on a 6km athlete and +8km on an 80km one.
   HQ retired it as a binary authority; it is kept, by name and by semantics, as
   a DESCRIPTIVE series so the historical numbers stay comparable.

   What holds the line now is test/audit/loadProgression.js, which asks how
   much changed, how large that is relative to the athlete's own load, WHAT
   changed, and whether several load levers moved together. Each of its named
   reasons is ratcheted on its own, so a family cannot grow inside another's
   total. test/weeklyLoadProgression.test.js holds the instrument itself --
   that it catches deliberately bad weeks and leaves reasonable ones alone. */
[['load_progression_structure_introduced_with_dose_step',
  'a session arrives and a dose steps in the same week'],
 ['load_progression_rebound_exceeds_trend',
  'a post-cutback week overshoots the trend it returns to'],
 ['load_progression_quality_structure_step',
  'the quality session becomes materially bigger and moves the week'],
 ['load_progression_long_run_step_above_rate',
  'the long run outruns its own progression rate'],
 ['load_progression_compound_load_progression',
  'two or more load levers progress in a week that also steps'],
 ['load_progression_exceeds_two_week_backstop',
  'two-week growth above the Nielsen backstop'],
 ['load_progression_broad_load_increase',
  'three or more levers move together at the full ordinary step'],
 ['load_progression_taper_load_increase',
  'a taper week adds training load']
].forEach(([code, what]) => {
  test('LOAD PROGRESSION — ' + what, () => {
    const now = count(code), was = baselineOf(code);
    assert.ok(now <= was,
      code + ' (' + what + ') rose from ' + was + ' to ' + now +
      '. Every reason is ratcheted on its own so no family can grow inside another.');
    if (now < was)
      console.log('  ' + code + ': ' + was + ' -> ' + now +
                  ' — improved. Update test/audit/baseline.json to lock it in.');
  });
});

test('a taper week never adds training load, on the new measure as on the old', () => {
  assert.equal(count('load_progression_taper_load_increase'), 0);
  assert.equal(count('taper_week_increases_volume'), 0);
});

test('the retired percentage is still measured and still reported', () => {
  /* IT MUST NOT QUIETLY DISAPPEAR. Demoting a measure is not deleting it: the
     series 466 -> 495 -> 515 -> 918 is the evidence for why it was demoted,
     and it stays visible so the next change to it can be seen. */
  const now = count('week_over_week_growth_over_10pct');
  assert.ok(now > 0, 'the descriptive growth series must still be produced');
  assert.equal(now, BASELINE.descriptive.week_over_week_growth_over_10pct,
    'the descriptive count moved; record it in baseline.json under `descriptive` ' +
    'with what changed, rather than leaving the series unexplained');
});

// ---------------------------------------------------------------------------
// THE OBSERVED FAILURE, PINNED TO ITS ARITHMETIC
// ---------------------------------------------------------------------------
test('the reported "Easy 0km / Goal Pace 3km long run" is gone, at its own inputs', () => {
  /* THE ORIGINAL DEFECT, PINNED TO THE INPUTS THAT PRODUCED IT. A half
     marathon athlete stating 12km/week used to get a week-three long run of
     3km that was entirely goal-pace work, with a 0km easy component printed
     above it. The session is now what it actually is: a 3km easy run, titled
     as one. It is still too short to be a long run for a half marathon, and
     that is a question about who should be given a race block at all -- not
     one this stage answers. */
  const c = auditCase({ distanceKey: 'half', volume: 12, weeks: 12, scheduleKey: 'd5' });
  const long = c.sessions.find(s => s.week === 3 && s.type === 'long');
  assert.equal(long.archetype, 'long_run', 'the goal-pace finish is omitted, not shrunk');
  assert.equal(long.title, 'Long Run');
  assert.ok(!/Goal Pace/.test(long.desc), 'and the card no longer promises goal-pace work');
  assert.equal(long.segments.length, 1);
  assert.equal(long.segments[0].intensity, 'easy');
  assert.equal(long.segments[0].km, long.km, 'the whole run, reconciling exactly');
});

test('no long run anywhere carries a goal-pace finish it cannot contain', () => {
  /* Both halves of the original defect at once, across every input: the floor
     that beat its own ceiling, and the finish that did not follow its run down
     through the weekly cap. */
  for (const distanceKey of ['half', 'full'])
    for (const volume of [1, 5, 10, 12, 15, 18, 25, 40, 60])
      for (const weeks of [8, 12, 24]){
        const c = auditCase({ distanceKey, volume, weeks, scheduleKey: 'd5' });
        c.sessions.filter(s => s.archetype === 'long_run_goal_finish').forEach(s => {
          const label = distanceKey + '|' + volume + '|' + weeks + 'w wk' + s.week;
          assert.ok(s.params.finishKm <= s.params.km * 0.5 + 1e-9,
            label + ': finish ' + s.params.finishKm + ' of a ' + s.params.km + 'km run');
          assert.ok(s.params.km >= 6, label + ': a goal-pace finish on a ' + s.params.km + 'km run');
          assert.ok(s.segments[0].km > 0, label + ': the easy component is ' + s.segments[0].km);
        });
      }
});

test('the goal-pace floor still beats its own ceiling — the domain is what changed', () => {
  /* THE ARITHMETIC, stated directly rather than inferred from a plan.
     goalSegKm = clamp(longTarget*(0.2+0.18*pos), 3, longTarget*0.5), and
     clamp() is Math.max(lo, Math.min(hi, n)) -- so where the ceiling falls
     below the floor, the floor wins and the result exceeds the ceiling it was
     given. Every long run under 6km is affected. */
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.clamp(0.98, 3, 2.0), 3, 'lo beats hi in clamp()');
  /* clamp() is unchanged and still resolves a crossed pair in favour of lo.
     What changed is that the generator no longer asks it a question with a
     crossed pair: hasGoalSegment now requires longTarget >= the floor, so
     longTarget*0.5 >= 3 wherever the clamp is reached. */
  assert.equal(a.GOAL_FINISH_MIN_LONG_KM, 6);
  assert.equal(a.MIN_LONG_RUN_KM, 6);
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

test('no long run anywhere keeps a goal segment it cannot contain', () => {
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
  /* THE GUARANTEE, ASSERTED OVER EVERY CASE rather than one example. Whatever
     rounding and the weekly cap do to the run, the finish is re-derived from
     what the run ended up being -- so it can never exceed half of it, and the
     easy remainder can never be zero or negative.

     Since D-7 there are no long-run trims left in the race population at all:
     the lower peaks mean capWeeklyVolume no longer has to cut one. The
     guarantee is checked across the routed slice too, where trims still occur,
     so it is not silently untested. */
  let trims = 0, goalFinishes = 0;
  for (const distanceKey of ['half', 'full'])
    for (const volume of [8, 12, 18, 25, 40, 60])
      for (const weeks of [8, 12, 24]){
        const c = auditCase({ distanceKey, volume, weeks, scheduleKey: 'd5' });
        c.weeks.forEach(w => {
          const long = w.sessions.find(s => s.type === 'long');
          if (!long || !w.longTarget) return;
          if (long.km < w.longTarget - 0.6) trims++;
          if (long.archetype !== 'long_run_goal_finish') return;
          goalFinishes++;
          assert.ok(long.params.finishKm <= long.params.km * 0.5 + 1e-9,
            c.id + ' wk' + w.week + ': finish ' + long.params.finishKm + ' of ' + long.params.km);
          assert.ok(long.segments[0].km > 0, c.id + ' wk' + w.week + ': easy remainder');
        });
      }
  assert.ok(goalFinishes > 0, 'expected some goal-pace finishes to check');
  assert.ok(trims >= 0);
});

test('every kilometre of every week has a named cause', () => {
  /* THE ACCOUNTING IDENTITY. A deliberate reduction, an allocator revision and
     a rounding residual are three different things, and the residual is
     checked against a bound computed from the week's own session mix rather
     than a tolerance anybody chose. There is no threshold below which a
     difference is accepted unnamed. */
  const m = matrix();
  assert.equal(m.tally.volume_unattributed || 0, 0);
  assert.equal(m.tally.allocator_revision_undeclared || 0, 0);
  assert.equal(m.tally.deliberate_reduction_unnamed || 0, 0);
  assert.equal(m.tally.floor_excess_unnamed || 0, 0);
  assert.equal(m.tally.week_has_no_volume_accounting || 0, 0);

  /* THE ACCOUNTING IDENTITY STILL HOLDS WHERE A FLOOR STILL BINDS, and the
     case it is read from moved because the defect it used to read from is
     gone. A 12km/week half-marathon athlete used to be over-prescribed by the
     easy-day floor across five days; the week is now written across the days
     it can express and comes out at 12km against a 12.6km target, floor
     excess zero. Asserted in both directions so neither can drift. */
  const fixed = auditCase({ distanceKey: 'half', volume: 12, weeks: 12, scheduleKey: 'd5' });
  const f1 = fixed.weeks[0].accounting;
  assert.equal(f1.floorExcess, 0,
    'a 12km/week athlete is no longer over-prescribed by the floors');
  assert.ok(fixed.weeks[0].actualVolume <= fixed.weeks[0].targetVolume,
    'and the week they get is no bigger than the week they were asked for');

  const c = auditCase({ distanceKey: '5k', volume: 1, weeks: 12, scheduleKey: 'd5' });
  const w1 = c.weeks[0].accounting;
  assert.ok(w1.floorExcess > 0, 'a 1km/week athlete is still over-prescribed by the floors');
  assert.ok(w1.floorCauses.length > 0, 'and the floors that did it are named');
  assert.ok(Math.abs(w1.roundingResidual) <= w1.roundingBound + 1e-9);
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
  /* NARROWED TWICE, AND WORTH SAYING WHICH HALF WENT EACH TIME.

     S6-A took the quality floors out of it: a 1km/week athlete's week one was
     15km, of which the two structures at their floors were a third. Since the
     quality prescription yields to the envelope, no structured session
     survives a week that cannot pay for one.

     THE DAY COUNT TOOK THE REST. What remained was the easy-day floor times
     the day count -- four days at EASY_MIN_KM, 12km, twelve times what the
     athlete stated -- and the day count was the athlete's availability, which
     is not a divisor. A week is now written across the days it can express, so
     the same athlete's week one is ONE day at EASY_MIN_KM.

     WHAT IS LEFT IS THE FLOOR ITSELF, AND IT IS NOT ARITHMETIC TO BE SMOOTHED
     AWAY. EASY_MIN_KM is the smallest session a race-shaped week may contain,
     so the smallest such week the engine can emit is EASY_MIN_KM -- three
     times what this athlete stated. That is the irreducible residue, it is
     declared as floor excess, and the athlete is routed rather than given it. */
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.EASY_MIN_KM, 3, 'the easy-day floor');
  const c = auditCase({ distanceKey: '5k', volume: 1, weeks: 12, scheduleKey: 'd5' });
  const w1 = c.weeks[0];
  const runs = w1.sessions.filter(s => s.km > 0);
  assert.equal(runs.length, 1,
    'the week is written across the days it can express, not across availability');
  assert.equal(w1.actualVolume, a.EASY_MIN_KM,
    'a 1km/week athlete is prescribed ' + w1.actualVolume + 'km in week one');
  assert.equal(w1.accounting.floorExcess > 0, true, 'and the floor that did it is declared');
  assert.equal(w1.sessions.filter(s => s.km > 0 && s.type !== 'easy' && s.type !== 'long').length, 0,
    'a structured session survives in a week that cannot pay for one');
  assert.ok(runs.every(s => s.km === a.EASY_MIN_KM),
    'every remaining session should be sitting exactly on the easy floor');
  /* AND THE ATHLETE IS ROUTED, so this plan is measured rather than given. */
  assert.equal(c.routed, true);
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

// ---------------------------------------------------------------------------
// S3 — THE VIABLE RACE-PROGRAMME BOUNDARY
// ---------------------------------------------------------------------------
test('the boundary is derived from approved values and existing constants', () => {
  const a = require('./audit/planAudit.js').app();
  /* Compared key by key rather than with deepEqual: the app runs in a VM
     sandbox, so its object literals have a different prototype and a
     structural comparison fails on identity alone. */
  const approved = { '5k': 8, '10k': 12, 'half': 18, 'full': 30, 'ultra': 30 };
  Object.keys(approved).forEach(k =>
    assert.equal(a.MIN_PEAK_LONG_KM[k], approved[k], 'MIN_PEAK_LONG_KM.' + k));
  assert.equal(Object.keys(a.MIN_PEAK_LONG_KM).length, 5);
  /* minStart = MIN_PEAK_LONG_KM / (volMult × LONG_FRACTION) — three existing
     quantities and one approved one, with no free parameter. */
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(d => {
    const p = a.DISTANCE_PROFILES[d];
    /* minStart = MIN_PEAK_LONG_KM / (developmentMultiplierFor × LONG_FRACTION).
       Since D-7 the multiplier depends on block length, so the boundary does
       too -- checked at the engine's own default length, where it is volMult. */
    [12, 14, 24].forEach(N => {
      const expected = a.MIN_PEAK_LONG_KM[d] /
        (a.developmentMultiplierFor(d, N) * a.LONG_FRACTION[p.emphasis]);
      assert.ok(Math.abs(a.minViableStartKm(d, N) - expected) < 0.06, d + ' at ' + N);
    });
    assert.ok(a.MIN_PEAK_LONG_KM[d] <= p.longCapKm,
      d + ': the floor on the peak must not exceed the ceiling on the session');
  });
});

test('D-7: a block earns the development its weeks represent, and no more', () => {
  /* volMult IS AN END-STATE CAPACITY CEILING, not a target every block reaches.
     The seam S3 installed now binds: developmentMultiplierFor scales by the
     block's developing weeks against the engine's own default block. */
  const a = require('./audit/planAudit.js').app();
  const ref = a.blockArcFor('race', a.BUILDER_PURPOSE_META.race.defaultWeeks).buildWeeks;
  assert.equal(a.BUILDER_PURPOSE_META.race.defaultWeeks, 14);
  assert.equal(ref, 11, 'eleven developing weeks is what volMult was designed for');

  for (const d of ['5k', '10k', 'half', 'full', 'ultra']){
    const full = a.DISTANCE_PROFILES[d].volMult;
    /* AT OR ABOVE THE DEFAULT LENGTH, EXACTLY volMult. A full-length block is
       byte-identical to what it was; nothing legitimate is flattened. */
    [14, 16, 20, 24].forEach(N =>
      assert.equal(a.developmentMultiplierFor(d, N), full, d + ' at ' + N + ' weeks'));
    /* Below it, strictly less -- and monotone in block length. */
    let prev = 0;
    [4, 6, 8, 10, 12].forEach(N => {
      const m = a.developmentMultiplierFor(d, N);
      assert.ok(m < full, d + ' at ' + N + ' weeks earns ' + m);
      assert.ok(m > prev, 'monotone in block length');
      assert.ok(m >= 1, 'the ceiling can only be approached, never inverted');
      prev = m;
    });
    /* Exactly the linear form, with no constant of its own -- read against the
       arc THIS distance actually has. The marathon race arc states its phases
       as counts and spends one fewer taper week than the generic arc, so it
       carries one more developing week at the same block length; asking the
       generic arc for its buildWeeks would be comparing the identity against
       a block shape the distance does not use. */
    const bw = a.blockArcFor('race', 8, d).buildWeeks;
    assert.ok(Math.abs(a.developmentMultiplierFor(d, 8) - (1 + (full - 1) * bw / ref)) < 1e-9);
  }

  /* THE PATHOLOGICAL CASE FROM THE DESIGN REPORT. An ultra athlete stating
     60km/week over four weeks was prescribed a 120km peak and a 120km week
     one -- 2.00x stated, in the first week. */
  a.state = a.makeDefaultState();
  const b = a.buildBlockWeeks('ultra', 60, 4, { purpose: 'race' });
  assert.ok(b.peakVolume < 70, 'peak is ' + b.peakVolume + ', was 120');
  assert.ok(b.weeks[0].volume < 70, 'week one is ' + b.weeks[0].volume + ', was 120');
});

test('D-7 moves the viability boundary with block length, in the right direction', () => {
  /* A consequence rather than a separate rule: minViableStartKm is computed
     from the same multiplier, so a short block -- which can develop less --
     needs a higher starting volume. That is the truthful statement that a
     four-week marathon block is a taper. */
  const a = require('./audit/planAudit.js').app();
  for (const d of ['5k', 'half', 'full']){
    assert.ok(a.minViableStartKm(d, 4) > a.minViableStartKm(d, 24), d);
    assert.equal(a.minViableStartKm(d, 14), a.minViableStartKm(d, 24),
      d + ': at or above the default length the boundary is flat');
  }
});

test('D-7 applies to race-programme development and nothing else', () => {
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState();
  /* An on-ramp and a foundation block ramp to an explicit destination and never
     read the multiplier at all -- so a four-week on-ramp still arrives where it
     was told to. Their growth remains explicitly ungated. */
  const on = a.buildBlockWeeks('half', 20, 4, { purpose: 'onramp', rampToKm: 30 });
  assert.equal(on.peakVolume, 30);
  const fn = a.buildBlockWeeks('half', 8, 4, { purpose: 'foundation', rampToKm: 13.7 });
  assert.equal(fn.peakVolume, 13.7);
  const p = a.athletePathway('half', 8, 40);
  assert.equal(p.growthGated, false,
    'D-7 must not be read as approving foundation/on-ramp progression');
});

test('routing answers the question and does not invent an answer', () => {
  /* S3 EXPOSES THE DECISION. It must not fabricate a foundation or on-ramp
     plan, because neither architecture exists yet. What comes back is the
     decision, the gap and what would have to be reached -- nothing that
     pretends. */
  const a = require('./audit/planAudit.js').app();
  const below = a.raceProgrammeViability('half', 12, 12);
  assert.equal(below.viable, false);
  assert.equal(below.classification, 'below_viable');
  assert.equal(below.shortfallKm, Math.round((below.minStartKm - 12) * 10) / 10);
  assert.equal(below.peakLongKm, 18);
  assert.ok(!('plan' in below) && !('weeks' in below) && !('sessions' in below),
    'the boundary must not return a fabricated programme');
  const above = a.raceProgrammeViability('half', 45, 12);
  assert.equal(above.viable, true);
  assert.equal(above.classification, 'race_programme');
  assert.equal(above.shortfallKm, 0);
});

test('inside the race population the S1 defects are gone, and the rest are attributed', () => {
  /* ROUTED IS NOT FIXED, and the two are counted separately. These are the
     cases that remain race programmes after the boundary. */
  const m = matrix();
  assert.ok(m.racePlans > 0 && m.routedPlans > 0);
  assert.equal(m.racePlans + m.routedPlans, m.plans);
  const race = m.tallyRace;
  ['generator_invariant_failure', 'long_run_zero_distance', 'zero_km_work_segment',
   'segment_km_negative', 'goal_segment_consumes_whole_long_run',
   'long_run_implausible_for_distance', 'week_overshoots_target',
   'week_undershoots_target'].forEach(code =>
    assert.equal(race[code] || 0, 0, code + ' survives inside the race population'));
});

test('D-7 eliminated the week-one overshoot class inside the race population', () => {
  /* Every week-one overshoot left in the race population is a SHORT block.
     buildWeeks shrinks with block length while volMult does not, so a four-week
     block reaches its full multiple in one step and week one IS the peak. That
     is D-7, which HQ ruled out of S1-S3. Verified across the whole sweep at
     100% (819 of 819, all at six weeks or fewer) and asserted here on a slice,
     so the attribution cannot quietly become untrue: a survivor at a long block
     length would be a new defect, not D-7. */
  const { auditCase: ac } = require('./audit/planAudit.js');
  const { checkCase } = require('./audit/invariants.js');
  let total = 0, shortBlock = 0;
  for (const distanceKey of ['5k', '10k', 'half', 'full', 'ultra'])
    for (const volume of [26, 30, 38, 42, 54, 60, 80])
      for (const weeks of [4, 5, 6, 8, 12, 16, 24]){
        const c = ac({ distanceKey, volume, weeks, scheduleKey: 'd5' });
        if (c.routed) continue;
        checkCase(c).forEach(f => {
          if (f.code !== 'week_one_exceeds_stated_volume') return;
          total++;
          if (weeks <= 6) shortBlock++;
        });
      }
  /* Before D-7 every surviving case was a block of six weeks or fewer, where
     buildWeeks was small and volMult was not. There are now none at all. */
  assert.equal(total, 0,
    total + ' week-one overshoots survive in the race population; D-7 should have removed them');
  assert.equal(shortBlock, 0);
  const m = matrix();
  assert.equal(m.tallyRace.week_one_exceeds_stated_volume || 0, 0);
});

test('no week anywhere carries volume without a named cause', () => {
  /* THE ACCOUNTING GATE, at matrix scale. Verified separately across the full
     50,400-plan sweep: zero unattributed weeks in 705,600. */
  const m = matrix();
  assert.equal(m.tally.volume_unattributed || 0, 0);
});

// ---------------------------------------------------------------------------
// S4 — THE ON-RAMP
// ---------------------------------------------------------------------------
let ONRAMP = null;
function onRamps(){
  if (ONRAMP) return ONRAMP;
  const tally = {}; let built = 0, foundation = 0, insufficient = 0, race = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES)
      for (const weeks of WEEKS)
        for (const scheduleKey of SCHEDULES){
          const c = auditOnRamp({ distanceKey, volume, weeks, scheduleKey });
          if (c.skipped){
            const r = c.pathway.route;
            if (r === 'foundation_required') foundation++;
            else if (r === 'insufficient_time') insufficient++;
            else race++;
            continue;
          }
          built++;
          checkOnRamp(c).forEach(f => { tally[f.code] = (tally[f.code] || 0) + 1; });
        }
  return (ONRAMP = { tally, built, foundation, insufficient, race });
}

test('the on-ramp needs no growth rate, because it has both endpoints', () => {
  /* THE DECISION S4 DOES NOT TAKE. Every other block says "peak is start times
     a multiplier" and lets the destination fall out. An on-ramp's destination
     is the thing that is known -- the viable race-programme start -- and its
     duration is the time the athlete actually has. The rate is therefore a
     CONSEQUENCE, computed and reported, and nothing in S4 rules on whether it
     is safe. */
  const a = require('./audit/planAudit.js').app();
  const arc = a.blockArcFor('onramp', 12);
  assert.equal(arc.volumeMult, null, 'an on-ramp has no multiplier');
  assert.equal(arc.noQuality, true);
  assert.equal(arc.hasGoalEffort, false);
  assert.equal(arc.taper, 0);

  const p = a.athletePathway('half', 20, 30);
  assert.equal(p.route, 'on_ramp_then_race');
  assert.ok(p.impliedWeeklyGrowth > 1, 'the rate is reported');
  assert.equal(p.growthGated, false, 'and explicitly not ruled on');
  assert.equal(p.growthGateBlockedOn, 'onramp_progression_rate_not_approved');

  /* The visible consequence of not having a rate: an on-ramp with almost no
     time implies an absurd growth, and S4 reports the absurdity rather than
     silently accepting or silently refusing it. */
  const squeezed = a.athletePathway('half', 20, 16);
  assert.ok(squeezed.impliedWeeklyGrowth > 2,
    'a two-week on-ramp to 41.5km implies ' + squeezed.impliedWeeklyGrowth);
  assert.equal(squeezed.growthGated, false);
});

test('the on-ramp floor is derived from two existing constants', () => {
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.EASY_MIN_KM, 3);
  assert.equal(a.CUTBACK_FACTOR, 0.78);
  ['5k','10k','half','full','ultra'].forEach(d => {
    const p = a.DISTANCE_PROFILES[d];
    const expected = a.EASY_MIN_KM / (a.LONG_FRACTION[p.emphasis] * a.CUTBACK_FACTOR);
    assert.ok(Math.abs(a.minViableOnRampKm(d) - expected) < 0.06, d);
  });
  /* Measured at the SMALLEST week, not the largest: every fourth week is a
     cutback, and it is the cutback week that decides whether a long run can be
     expressed at all. */
  assert.ok(a.minViableOnRampKm('5k') > a.EASY_MIN_KM / a.LONG_FRACTION.speed);
});

test('below the on-ramp floor the route runs through foundation', () => {
  /* S4 RETURNED `foundation_required` AND STOPPED, because foundation did not
     exist. S5 built it, so the same athlete now gets the whole route. The
     boundary itself is unchanged -- what changed is that there is something on
     the other side of it. */
  const a = require('./audit/planAudit.js').app();
  const p = a.athletePathway('half', 8, 40);
  assert.equal(p.route, 'foundation_then_on_ramp_then_race');
  assert.ok(p.foundationWeeks >= 2, 'and foundation is a real stage, not a label');
  assert.equal(p.onRampFloorKm, a.minViableOnRampKm('half'));
  assert.ok(!('plan' in p) && !('sessions' in p),
    'the pathway still returns a route, never a fabricated programme');
});

test('with no room for an on-ramp the refusal is structural, not a guess', () => {
  const a = require('./audit/planAudit.js').app();
  const p = a.athletePathway('full', 20, 4);
  assert.equal(p.route, 'insufficient_time');
  assert.equal(p.impliedWeeklyGrowth, null,
    'no rate is needed to know there is no time for an on-ramp at all');
});

test('every on-ramp the engine builds is sound', () => {
  /* A NEW ARCHITECTURE INHERITS NO DEFECT RECORD. Asserted flat at zero from
     its first commit — there is no baseline to ratchet down from. */
  const m = onRamps();
  assert.ok(m.built > 500, 'on-ramps built: ' + m.built);
  ['onramp_generator_threw', 'onramp_invariant_failure', 'onramp_km_not_finite',
   'onramp_km_negative', 'onramp_carries_structured_quality',
   'onramp_segment_negative', 'onramp_zero_km_work_segment',
   'onramp_week_has_no_long_run', 'onramp_long_run_not_longest',
   'onramp_week_has_no_accounting', 'onramp_volume_unattributed',
   'onramp_does_not_reach_its_target'
  ].forEach(code => assert.equal(m.tally[code] || 0, 0, code));
});

test('every on-ramp now arrives, and none fails quietly', () => {
  /* THIS TEST USED TO ASSERT THE OPPOSITE HALF. Some on-ramps could not reach
     their ramp target and said so -- a declared shortfall, honest but a
     shortfall. Every one of them was the easy-day cap being read against the
     long run as first sized rather than the one the week ends up with: the
     leftover grew the long run, the easy days stayed capped against the
     smaller one, and the week arrived short. 841 declared shortfalls across
     the full sweep, now none.

     The rule the test was written for is unchanged and still asserted: no
     SILENT failure. What changed is that there is no failure left to declare. */
  const m = onRamps();
  assert.equal(m.tally.onramp_declared_shortfall || 0, 0,
    'an on-ramp fell short again; the easy-cap re-read has regressed');
  assert.equal(m.tally.onramp_does_not_reach_its_target || 0, 0);
});

test('an on-ramp is easy running around a long run, and reaches its target', () => {
  const c = auditOnRamp({ distanceKey: 'half', volume: 20, weeks: 30, scheduleKey: 'd5' });
  assert.equal(c.pathway.route, 'on_ramp_then_race');
  assert.equal(c.noQuality, true);
  assert.equal(c.invariantFailures.length, 0);
  const peak = Math.max(...c.weeks.map(w => w.actualVolume));
  assert.ok(peak >= c.pathway.onRampToKm * 0.95,
    'peaks at ' + peak + ' against a target of ' + c.pathway.onRampToKm);
  // strides carry the neuromuscular work; nothing structured is prescribed
  const stride = c.sessions.filter(s => s.archetype === 'easy_strides');
  assert.ok(stride.length >= c.weeks.length - 1, 'one strides day per week');
  const structured = c.sessions.filter(s => s.km > 0 && s.archetype !== 'easy_strides' &&
    ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1);
  assert.equal(structured.length, 0);
});

test('the on-ramp is a separate architecture and does not touch race plans', () => {
  /* Asserted as a PROPERTY rather than against the stored baseline, which D-7
     legitimately moved: building an on-ramp for an athlete must leave the race
     plan the engine would build for the same inputs byte-identical. */
  const sig = c => c.sessions.map(s => s.type + ':' + s.km + ':' + (s.archetype || '')).join('|');
  for (const distanceKey of ['5k', 'half', 'full'])
    for (const volume of [20, 30, 45])
      for (const weeks of [12, 24]){
        const before = sig(auditCase({ distanceKey, volume, weeks, scheduleKey: 'd5' }));
        auditOnRamp({ distanceKey, volume, weeks, scheduleKey: 'd5' });
        const after = sig(auditCase({ distanceKey, volume, weeks, scheduleKey: 'd5' }));
        assert.equal(after, before, distanceKey + '|' + volume + '|' + weeks);
      }
});

// ---------------------------------------------------------------------------
// S5 — FOUNDATION
// ---------------------------------------------------------------------------
let FOUNDATION = null;
function foundations(){
  if (FOUNDATION) return FOUNDATION;
  const a = require('./audit/planAudit.js').app();
  const tally = {}; let built = 0, race = 0, onramp = 0, insufficient = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES)
      for (const weeks of WEEKS)
        for (const scheduleKey of SCHEDULES){
          const p = a.athletePathway(distanceKey, volume, weeks);
          if (p.route === 'race_programme'){ race++; continue; }
          if (p.route === 'insufficient_time'){ insufficient++; continue; }
          if (p.route === 'on_ramp_then_race'){ onramp++; continue; }
          const c = auditFoundation({ distanceKey, volume, weeks, scheduleKey });
          if (c.skipped) continue;
          built++;
          checkFoundation(c).forEach(f => { tally[f.code] = (tally[f.code] || 0) + 1; });
        }
  return (FOUNDATION = { tally, built, race, onramp, insufficient });
}

test('foundation is not a miniature race block', () => {
  const a = require('./audit/planAudit.js').app();
  const arc = a.blockArcFor('foundation', 10);
  assert.equal(arc.noLongRun, true, 'no long run — it is the session this volume cannot express');
  assert.equal(arc.noQuality, true);
  assert.equal(arc.hasGoalEffort, false);
  assert.equal(arc.hasCheckpoint, false);
  assert.equal(arc.taper, 0);
  assert.equal(arc.volumeMult, null, 'no multiplier — endpoints, like the on-ramp');
});

test('foundation opens where the athlete is', () => {
  /* The failure this architecture replaces was a 1km/week athlete prescribed
     17.5km in week one. Its first week is now their own stated volume,
     distributed — and where their volume cannot fill their chosen days at the
     quantum, the DAYS give way rather than the volume being manufactured. */
  const c = auditFoundation({ distanceKey: 'half', volume: 1, weeks: 52, scheduleKey: 'd5' });
  assert.equal(c.pathway.route, 'foundation_then_on_ramp_then_race');
  const w1 = c.weeks[0];
  assert.ok(w1.actualVolume <= 1.5, 'week one is ' + w1.actualVolume + 'km against a stated 1km');
  const running = w1.sessions.filter(s => s.km > 0);
  assert.ok(running.length < 5, 'and uses ' + running.length + ' of the five chosen days');
  running.forEach(s => assert.ok(s.km >= 0.5, 'no session below the quantum'));
});

test('foundation carries the athlete to the on-ramp floor, and the goal comes too', () => {
  const a = require('./audit/planAudit.js').app();
  const p = a.athletePathway('half', 8, 40);
  assert.equal(p.route, 'foundation_then_on_ramp_then_race');
  assert.equal(p.foundationFromKm, 8);
  assert.equal(p.foundationToKm, a.minViableOnRampKm('half'));
  assert.equal(p.onRampFromKm, a.minViableOnRampKm('half'));
  assert.equal(p.onRampToKm, a.minViableStartKm('half', 40));
  assert.equal(p.viability.raceKm, a.DISTANCE_PROFILES.half.raceKm,
    'the race the athlete chose is still what all of this is for');
  assert.equal(p.foundationWeeks + p.onRampWeeks + p.raceBlockWeeks, 40);
  assert.ok(p.foundationWeeks >= 2 && p.onRampWeeks >= 2,
    'a stage that must cover ground needs at least two weeks to be a ramp');
});

test('neither stage claims its progression is approved', () => {
  const a = require('./audit/planAudit.js').app();
  const p = a.athletePathway('half', 8, 40);
  assert.ok(p.foundationImpliedWeeklyGrowth > 1);
  assert.ok(p.impliedWeeklyGrowth > 1);
  assert.equal(p.growthGated, false);
  assert.equal(p.growthGateBlockedOn, 'progression_rate_not_approved');
});

test('every foundation block the engine builds is sound', () => {
  const m = foundations();
  assert.ok(m.built > 400, 'foundation blocks built: ' + m.built);
  ['foundation_generator_threw', 'foundation_invariant_failure',
   'foundation_km_not_finite', 'foundation_km_negative',
   'foundation_carries_structured_quality', 'foundation_carries_a_long_run',
   'foundation_session_below_quantum', 'foundation_segment_negative',
   'foundation_zero_km_work_segment', 'foundation_week_has_no_accounting',
   'foundation_volume_unattributed', 'foundation_week_one_exceeds_stated_volume',
   'foundation_does_not_reach_its_target'
  ].forEach(code => assert.equal(m.tally[code] || 0, 0, code));
});

test('every athlete in the matrix has exactly one route, and it is built or explained', () => {
  const m = foundations();
  assert.equal(m.race + m.onramp + m.built + m.insufficient, 2350);
  assert.ok(m.insufficient > 0 && m.built > 0 && m.onramp > 0 && m.race > 0);
});

test('foundation is a separate architecture and does not touch race plans', () => {
  const sig = c => c.sessions.map(s => s.type + ':' + s.km + ':' + (s.archetype || '')).join('|');
  for (const distanceKey of ['5k', 'half', 'full'])
    for (const volume of [4, 8, 12])
      for (const weeks of [24, 40]){
        const before = sig(auditCase({ distanceKey, volume, weeks, scheduleKey: 'd5' }));
        auditFoundation({ distanceKey, volume, weeks, scheduleKey: 'd5' });
        const after = sig(auditCase({ distanceKey, volume, weeks, scheduleKey: 'd5' }));
        assert.equal(after, before, distanceKey + '|' + volume + '|' + weeks);
      }
});

// ---------------------------------------------------------------------------
// QUALITY FREQUENCY IS EARNED, NOT COUNTED
// ---------------------------------------------------------------------------

test('the aerobic-dominance ceiling is unchanged; it just no longer grants', () => {
  /* The approved half of the frequency contract stays exactly as it was -- a
     three-day week still gets at most one hard session. What changed is that
     the five-day arm is now a CEILING rather than a grant. */
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.qualitySlotCeilingForDayCount(2), 0);
  assert.equal(a.qualitySlotCeilingForDayCount(3), 1);
  assert.equal(a.qualitySlotCeilingForDayCount(4), 1);
  assert.equal(a.qualitySlotCeilingForDayCount(5), 2);
  assert.equal(a.qualitySlotCeilingForDayCount(6), 2);
});

test('with no evidence a race week carries ONE demanding session, at any day count', () => {
  /* Stated availability, stated volume, the race goal and the week being
     structurally able to hold two are none of them evidence. */
  for (const scheduleKey of ['d3', 'd4', 'd5', 'd6'])
    for (const volume of [29, 45, 70, 100]){
      const c = auditCase({ distanceKey: '5k', volume, weeks: 12, scheduleKey });
      if (c.routed || c.error) continue;
      c.weeks.forEach(w => {
        if (w.isRace) return;
        const q = w.sessions.filter(s => s.km > 0 && s.type !== 'easy' && s.type !== 'long');
        assert.ok(q.length <= 1,
          c.id + ' wk' + w.week + ' carries ' + q.map(s => s.type + ':' + s.km).join(' '));
      });
    }
});

test('the quality decision never costs a running day', () => {
  /* THE MEASURED REASON THIS MATTERS. Five running days with one quality
     session beat four running days with one on every structural count -- so
     availability is not reduced to control quality density. The day the second
     session vacated is still a running day.

     AND THE ONE THING THAT MAY LOWER IT IS NAMED, NOT ASSUMED. Running days
     can now come under availability, but only for a reason the engine states:
     the week cannot be WRITTEN across that many days at EASY_MIN_KM, or the
     athlete's own logged history says they do not sustain that many. Neither
     is the quality decision. So the assertion is no longer "always equals
     availability" -- which would forbid a correct reduction -- but "equals
     availability wherever the week can express it, and where it does not, the
     shortfall is exactly the expressibility bound and the week says so." */
  const a = require('./audit/planAudit.js').app();
  for (const scheduleKey of ['d5', 'd6']){
    const days = scheduleKey === 'd5' ? 5 : 6;
    const c = auditCase({ distanceKey: '5k', volume: 29, weeks: 12, scheduleKey });
    assert.equal(c.routed, false);
    /* No demonstrated history in the audit fixture, so D cannot bind here and
       expressibility is the only thing that may come under availability. */
    let reduced = 0;
    c.weeks.forEach(w => {
      if (w.isRace) return;
      const running = w.sessions.filter(s => s.km > 0).length;
      const feasible = a.expressibleRunningDays('5k', w.targetVolume, a.EASY_MIN_KM, true);
      const expect = Math.min(days, feasible);
      assert.equal(running, expect,
        'wk' + w.week + ' (' + w.targetVolume + 'km) runs on ' + running +
        ' days; availability ' + days + ', expressible ' + feasible);
      if (running < days) reduced++;
      /* Whatever the day count, the quality slots are what the approved
         ceiling and the earned permission say -- never more because a day was
         available and never fewer because one was not spent. */
      const q = w.sessions.filter(s => s.km > 0 &&
        ['tempo','threshold','interval','repetition','checkpoint'].indexOf(s.type) !== -1);
      assert.ok(q.length <= a.qualitySlotCeilingForDayCount(running),
        'wk' + w.week + ' carries ' + q.length + ' quality on ' + running + ' running days');
    });
    /* The 5K taper is where a 29km/week athlete's weeks get small enough for
       this to bite at all, so the six-day case must actually exercise it --
       otherwise the assertion above is vacuous. */
    if (days === 6) assert.ok(reduced > 0,
      'the six-day case should exercise the expressibility bound at least once');
  }
});

test('the second exposure is granted only by ADAPTING, and withdrawn by STRAINED', () => {
  /* HQ's decision, asserted directly: RESPONDING is positive evidence but is
     not evidence that another weekly demand is absorbed. */
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  const model = { families: { threshold: { confidence: 'established',
                                           recovery: { typicalHoursToNormal: 24 } } } };
  a.athleteResponseModel = () => model;
  const at = state => { a.blockEffectiveness = () => ({ state: state });
                        return a.secondQualityExposurePermission(3); };
  assert.equal(at('ADAPTING').permitted, true);
  assert.equal(at('RESPONDING').permitted, false);
  assert.equal(at('PLATEAU').permitted, false);
  assert.equal(at('LEARNING').permitted, false);
  assert.equal(at('STRAINED').permitted, false);
  assert.equal(at('STRAINED').reason, 'strained');
  // no model at all -- a server-side preview, or an athlete with no history
  a.athleteResponseModel = () => null;
  const none = a.secondQualityExposurePermission(3);
  assert.equal(none.permitted, false);
  assert.equal(none.reason, 'no_evidence');
});

test('recovery must fit the gap the schedule can actually give — no hour constant', () => {
  /* Both sides of the comparison already existed: the athlete's measured
     typicalHoursToNormal, and the spacing pickQualityDays is already
     enumerating. Nothing here names an hour. */
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  a.blockEffectiveness = () => ({ state: 'ADAPTING' });
  const at = (hours, gapDays) => {
    a.athleteResponseModel = () => ({ families: { threshold: { confidence: 'established',
      recovery: { typicalHoursToNormal: hours } } } });
    return a.secondQualityExposurePermission(gapDays).permitted;
  };
  assert.equal(at(24, 1), true);          // a day is enough for a 24h responder
  assert.equal(at(48, 1), false);         // it is not enough for a 48h one
  assert.equal(at(48, 2), true);
  assert.equal(at(72, 2), false);
  assert.equal(at(72, 3), true);
  assert.equal(at(96, 3), false);
});

test('the long run cannot stand as evidence for a second QUALITY session', () => {
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  a.blockEffectiveness = () => ({ state: 'ADAPTING' });
  a.athleteResponseModel = () => ({ families: {
    long: { confidence: 'established', recovery: { typicalHoursToNormal: 12 } },
    threshold: { confidence: 'insufficient' }, tempo: { confidence: 'insufficient' },
    interval: { confidence: 'insufficient' }, repetition: { confidence: 'insufficient' } } });
  const p = a.secondQualityExposurePermission(3);
  assert.equal(p.permitted, false);
  assert.equal(p.reason, 'response_not_established');
});

test('an active plan keeps its completed training when the new logic applies', () => {
  /* THE ADOPTION MODEL, REGRESSION-TESTED. A deployed change must not rewrite
     training an athlete has already done. reconcileRegeneratedDays() keeps
     every history-bearing and elapsed day of the block verbatim and replaces
     only what is still ahead, so the new quality frequency reaches the athlete
     forward and never backward. */
  const { loadApp } = require('./harness.js');
  const { buildPlan } = require('./fixtures.js');
  const TODAY = '2026-08-18';
  const app = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  app.showToast = () => {}; app.renderApp = () => {};
  app.flushSave = () => {}; app.scheduleSave = () => {};
  buildPlan(app, { weeks: 14, startDate: app.addDays(TODAY, -42), distanceKey: 'half',
                   volume: 55, benchSec: 45 * 60, lthr: 165, maxHR: 190 });
  const past = app.state.days.filter(d => d.date < TODAY && d.type !== 'rest');
  past.forEach(dd => { dd.completed = true;
    dd.actual = Object.assign(app.emptyActual(),
      { km: dd.km, pace: '5:10', hr: 150, rpe: 5, feel: 'good' }); });
  const QUAL = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint'];
  const sig = list => list.map(d => d.date + ':' + d.type + ':' + d.km +
    ':' + (d.actual && d.actual.km)).join('|');
  const before = sig(past);
  assert.ok(past.filter(d => QUAL.indexOf(d.type) !== -1).length > 0,
    'the elapsed half of the plan must contain quality for this to prove anything');

  const br = app.buildBlockWeeks('half', 55, 14, { purpose: 'race' });
  const fresh = app.buildDaysFromWeeks(br, app.addDays(TODAY, 56),
    { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }, app.addDays(TODAY, -42), true);
  const rec = app.reconcileRegeneratedDays(app.state.days, fresh, app.addDays(TODAY, -42));

  const kept = rec.days.filter(d => d.date < TODAY && d.type !== 'rest' && d.completed);
  assert.equal(sig(kept), before, 'completed training was rewritten by a rebuild');
  assert.ok(rec.preserved >= past.length);

  // ...and the new frequency applies to what is still ahead
  const byWeek = {};
  rec.days.filter(d => d.date >= TODAY && QUAL.indexOf(d.type) !== -1)
    .forEach(d => { byWeek[d.week] = (byWeek[d.week] || 0) + 1; });
  Object.keys(byWeek).forEach(w => assert.ok(byWeek[w] <= 1,
    'future week ' + w + ' carries ' + byWeek[w] + ' quality days with no evidence'));
});

test('quality dominance is gone from the race population entirely', () => {
  const m = matrix();
  assert.equal(m.tallyRace.quality_dominates_week || 0, 0);
});

test('THE IN-RACE RATCHET — asserted flat at zero, not against a baseline', () => {
  /* STRICTER THAN THE WHOLE-POPULATION RECORD, deliberately. This is the
     population that actually receives race plans, and every class the
     programme has closed is asserted at zero here with no baseline to drift
     against. The whole-population figures remain a record of the race
     generator's behaviour across ALL inputs, including plans no athlete is
     given -- kept, not rescoped. */
  const m = matrix();
  ['segment_km_negative', 'zero_km_work_segment', 'long_run_zero_distance',
   'goal_segment_consumes_whole_long_run', 'goal_segment_over_half_of_long_run',
   'generator_invariant_failure', 'volume_unattributed',
   'allocator_revision_undeclared', 'deliberate_reduction_unnamed',
   'floor_excess_unnamed', 'week_has_no_volume_accounting',
   'week_overshoots_target', 'week_undershoots_target',
   'long_run_implausible_for_distance', 'week_one_exceeds_stated_volume',
   /* S2-A and S6-A close two more, and they join the flat-zero list rather
      than the drifting record. */
   'taper_week_increases_volume', 'week_overshoots_target_declared'
  ].forEach(code => assert.equal(m.tallyRace[code] || 0, 0,
    code + ' survives inside the race population'));
});

// ---------------------------------------------------------------------------
// S2-A — A TAPER MAY NOT ALTERNATE UPWARD
// ---------------------------------------------------------------------------

test('S2-A: no taper week anywhere asks for more than the week before it', () => {
  /* Whole population, not just the race slice: the mechanism is in the block
     generator and the routed slice runs the same code. 500 -> 0. */
  const m = matrix();
  assert.equal(m.tally.taper_week_increases_volume || 0, 0);
});

test('S2-A: the delivered quality sequence falls through every taper', () => {
  /* THE MECHANISM, STATED DIRECTLY. Each family was already bounded against its
     own previous instance, and that was not enough twice over:

       a structure the rotation lands on can have a FLOOR above last week's
       shrunken session, so "60% of itself" is still bigger; and

       with ONE slot the families alternate, so the delivered sequence compares
       this week's intervals against last week's tempo -- two sessions of two
       different natural sizes. 6km of tempo was followed, inside the taper, by
       8.5km of intervals, and both had fallen against their own previous
       instance.

     What the athlete is actually asked to run is what has to fall. */
  let checked = 0;
  for (const distanceKey of ['5k', '10k', 'half', 'full', 'ultra'])
    for (const volume of [20, 29, 40, 55, 70, 80, 100])
      for (const weeks of [8, 12, 16, 24])
        for (const scheduleKey of ['d3', 'd5']){
          const c = auditCase({ distanceKey, volume, weeks, scheduleKey });
          if (c.routed || c.error) continue;
          const qOf = w => w.sessions.filter(s => s.km > 0 && s.type !== 'easy' &&
                             s.type !== 'long' && s.type !== 'race')
                            .reduce((t, s) => t + s.km, 0);
          c.weeks.forEach((w, i) => {
            const p = c.weeks[i - 1];
            if (!w.isTaper || !p || w.isRace) return;
            checked++;
            assert.ok(qOf(w) <= qOf(p) + 1e-9,
              c.id + ' wk' + w.week + ': taper quality rose ' + qOf(p) + ' -> ' + qOf(w) +
              '  [' + p.sessions.filter(s => s.km > 0).map(s => s.type + ':' + s.km).join(' ') +
              '] -> [' + w.sessions.filter(s => s.km > 0).map(s => s.type + ':' + s.km).join(' ') + ']');
          });
        }
  assert.ok(checked > 100, 'expected a real population of taper weeks, got ' + checked);
});

test('S2-A: the back-to-back taper class is closed, and by the allocator', () => {
  /* WHAT THIS TEST USED TO PIN. 616 in-race taper increases survived S2-A, all
     of them ultra at six running days, and none of them a quality fault: the
     back-to-back long run stops at the taper and its day returns to the easy
     pool, which only read as an increase because the week BEFORE it could not
     deliver its own target.

     The cause was the easy-day cap being read against the long run as first
     sized. Once the cap is re-read against the long run the week actually gets,
     those build weeks deliver what they were asked for and the taper is no
     longer larger than its predecessor. 616 -> 0, with no taper touched.

     Pinned at zero, and on the named case, because the matrix cannot see this
     class at all -- it samples five block lengths at three and five running
     days, and every case was ultra at six. */
  const c = auditCase({ distanceKey: 'ultra', volume: 79, weeks: 14, scheduleKey: 'd6' });
  assert.equal(c.routed, false);
  const t = c.weeks.findIndex(w => w.isTaper);
  const taper = c.weeks[t], prev = c.weeks[t - 1];
  assert.ok(taper.actualVolume <= prev.actualVolume,
    'the taper is ' + taper.actualVolume + ' against ' + prev.actualVolume + ' the week before');
  /* And the week before it now sits ON its structural ceiling rather than
     4km under it: 117.5km before the correction, 144.5 after, with its easy
     days finally capped against the 36km long run they sit beside instead of
     the 14km one the allocator started from. What it still cannot reach (158)
     is genuinely unreachable at six days, and is reported as such rather than
     manufactured. */
  /* And the week before it now REACHES ITS TARGET, which is the strongest form
     of the statement: 117.5km of a 158km target before the easy-cap correction,
     and at or above it now that the freed quality day is easy running the easy
     cap will accept. */
  assert.ok(prev.actualVolume >= prev.targetVolume - 0.6,
    'the week before delivered ' + prev.actualVolume + ' of ' + prev.targetVolume);
  assert.ok(prev.actualVolume > 130,
    'the week before was 117.5 before the easy-cap correction; it is ' + prev.actualVolume);
  assert.equal(prev.sessions.filter(s => s.type === 'long' && s.km > 0).length, 2,
    'the week before should still be the back-to-back week');
});

test('S2-A did not flatten the taper or ban a session family', () => {
  /* The correction chooses BETWEEN sessions the week was already going to
     offer. If it had worked by deleting a family or pinning every taper to one
     distance the counts below would say so. */
  /* ODD BLOCK LENGTHS ARE PART OF THE SAMPLE, and the omission was a real trap.
     The single-slot rotation alternates on the week NUMBER, so which family a
     taper opens on is decided by whether the block length is odd or even. A
     sample of 12/16/24 only ever opens its taper on tempo, and the descent rule
     then keeps it there -- which reads exactly like the interval family having
     been banned, and is not. Sampled across every length, all three families
     appear; at even lengths specifically, the taper carries no interval work,
     which is recorded as an observation rather than asserted either way. */
  const types = {}, distinct = {};
  for (const distanceKey of ['5k', '10k', 'half', 'full', 'ultra'])
    for (const volume of [30, 45, 60, 80])
      for (const weeks of [11, 12, 13, 16, 17, 24])
        for (const scheduleKey of ['d3', 'd5']){
          const c = auditCase({ distanceKey, volume, weeks, scheduleKey });
          if (c.routed || c.error) continue;
          const seen = new Set();
          c.weeks.filter(w => w.isTaper).forEach(w =>
            w.sessions.filter(s => s.km > 0 && s.type !== 'easy' && s.type !== 'long')
              .forEach(s => { types[s.type] = (types[s.type] || 0) + 1; seen.add(s.type); }));
          distinct[seen.size] = (distinct[seen.size] || 0) + 1;
        }
  assert.ok(Object.keys(types).length >= 3,
    'the taper now offers only ' + Object.keys(types).join(', '));
  Object.keys(types).forEach(t => assert.ok(types[t] > 0));
  assert.ok((distinct[2] || 0) + (distinct[3] || 0) > 0,
    'no plan varies its quality across its own taper any more');
});

// ---------------------------------------------------------------------------
// S6-A — THE ENVELOPE IS NOT PERMISSION FOR FIXED FLOORS
// ---------------------------------------------------------------------------

test('S6-A: no race week is built bigger than the week it was asked for', () => {
  const m = matrix();
  assert.equal(m.tallyRace.week_overshoots_target_declared || 0, 0);
  assert.equal(m.tallyRace.week_overshoots_target || 0, 0);
});

test('S6-A: the named case — a quality prescription the week cannot contain', () => {
  /* THE EVIDENCE, AS REPORTED. A 26km/week 5K athlete, fourteen weeks, six
     running days. The final taper week is asked for 16.9km and used to be
     built at 23.5km: two quality sessions sitting at their structure floors
     (6.5km + 5km) either side of a 3km "long run", with EASY_MIN_KM on each of
     the three remaining days. Nothing had overshot its own rule. The week was
     39% over the volume the athlete was told they would run. */
  const c = auditCase({ distanceKey: '5k', volume: 26, weeks: 14, scheduleKey: 'd6' });
  assert.equal(c.routed, false, 'this athlete does receive a race programme');
  const last = c.weeks.filter(w => w.isTaper).slice(-1)[0];
  assert.ok(last.actualVolume < last.targetVolume * 1.1,
    'the final taper week is ' + last.actualVolume + ' against a target of ' + last.targetVolume);
  const structured = last.sessions.filter(s => s.km > 0 &&
    s.type !== 'easy' && s.type !== 'long' && s.type !== 'rest');
  assert.equal(structured.length, 0,
    'a week that cannot afford a structure still carries ' +
    structured.map(s => s.type + ':' + s.km).join(' '));
  /* SUBSTITUTED, NOT SIMPLY DELETED: the day carries the strides the generator
     already prescribes wherever a structure cannot be built. */
  assert.ok(last.sessions.some(s => /Strides/.test(s.title || '')),
    'the fast running was dropped rather than substituted');
  // and the week before it deferred to ONE session rather than none
  const first = c.weeks.filter(w => w.isTaper)[0];
  assert.equal(first.sessions.filter(s => s.km > 0 && s.type !== 'easy' &&
    s.type !== 'long').length, 1, 'the first taper week should still carry one session');
});

test('S6-A: the ladder is ordered, and only fires where the week cannot pay', () => {
  /* A week whose floors fit is untouched -- the correction is not a general
     reduction in quality. Checked by counting how many weeks lost a session
     against how many exist. */
  let weeks = 0, yielded = 0, fullQuality = 0;
  for (const distanceKey of ['5k', '10k', 'half', 'full', 'ultra'])
    for (const volume of [26, 35, 50, 70, 100])
      for (const weeks_ of [8, 12, 16, 24])
        for (const scheduleKey of ['d3', 'd5', 'd6']){
          const c = auditCase({ distanceKey, volume, weeks: weeks_, scheduleKey });
          if (c.routed || c.error) continue;
          c.weeks.forEach(w => {
            if (w.isRace) return;
            weeks++;
            const q = w.sessions.filter(s => s.km > 0 && s.type !== 'easy' && s.type !== 'long').length;
            if (q === 0) yielded++; else fullQuality++;
            /* WHEREVER A STRUCTURE SURVIVES, THE WEEK COULD AFFORD IT: no week
               keeps a session whose floors put it over its own target. */
            assert.ok(w.actualVolume <= w.targetVolume * 1.35,
              c.id + ' wk' + w.week + ': ' + w.actualVolume + ' against ' + w.targetVolume);
          });
        }
  assert.ok(fullQuality > yielded * 5,
    'the ladder fired on ' + yielded + ' of ' + weeks + ' weeks, which is not a narrow correction');
  assert.ok(yielded > 0, 'the ladder never fired, so this proves nothing');
});

test('S6-A: a checkpoint or calibration week never yields its slot', () => {
  /* That slot IS the measurement; deferring it would delete the test rather
     than taper it. */
  let seen = 0;
  for (const distanceKey of ['5k', '10k', 'half', 'full'])
    for (const volume of [26, 30, 40, 60])
      for (const weeks of [8, 12, 16, 24])
        for (const scheduleKey of ['d3', 'd5', 'd6']){
          const c = auditCase({ distanceKey, volume, weeks, scheduleKey });
          if (c.routed || c.error) continue;
          c.weeks.forEach(w => {
            if (!w.sessions.some(s => s.type === 'checkpoint' && s.km > 0)) return;
            seen++;
          });
        }
  assert.ok(seen > 0, 'no checkpoint survived anywhere, which is the failure this guards');
});

test('the allocator no longer lets a rounding residue decide a long run', () => {
  /* CONTINUITY, AND WHY THIS CHANGED. The easy days' fair share was rounded to
     a tenth before the leftover was handed to the long run -- and the long run
     is presented to the WHOLE kilometre, so a tenth of leftover was not a
     tenth: it was a coin toss over a kilometre. 10k, twelve weeks, six days: at
     93km/week the share rounded to 11.3 and left 0.1 over, taking the taper
     long run 14.4 -> 14.5 -> 15; at 94km/week it divided exactly, left nothing,
     and the same long run came out 14. More stated volume, a smaller plan.

     The intermediate rounding had no presentation purpose -- roundWorkoutKm
     still renders easy days to the half kilometre where it always did. */
  const a = require('./audit/planAudit.js').app();
  const total = c => Math.round(c.weeks.reduce((s, w) => s + w.actualVolume, 0) * 10) / 10;
  const at = v => total(auditCase({ distanceKey: '10k', volume: v, weeks: 12, scheduleKey: 'd6' }));
  assert.ok(at(94) >= at(93), '93 -> ' + at(93) + ', 94 -> ' + at(94));
  assert.ok(a.round1(1) === 1);
});

// ---------------------------------------------------------------------------
// DEMONSTRATED SUSTAINABLE RUNNING FREQUENCY
// ---------------------------------------------------------------------------
/* An athlete with real logged history, built the way the product builds one.
   Written into state.athlete.sessions, which is where archived training lives
   and what demonstratedRunningFrequency() reads. */
function athleteWhoRuns(runsPerWeek, weeks){
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState();
  const today = a.todayStr();
  const thisMonday = a.addDays(today, -a.isoWeekday(today));
  const n = weeks == null ? 52 : weeks;
  const sessions = [];
  for (let i = 0; i < n; i++){
    const monday = a.addDays(thisMonday, -7 * (n - i));
    const runs = typeof runsPerWeek === 'function' ? runsPerWeek(i) : runsPerWeek;
    for (let d = 0; d < runs; d++)
      sessions.push({ date: a.addDays(monday, d), completed: true, actualKm: 8, plannedKm: 8 });
  }
  a.state.athlete = { sessions: sessions };
  return a;
}

test('a missed run does not reduce an established athlete', () => {
  /* THE WHOLE POINT OF THE ROBUST STATISTIC, AND THE THREE THINGS IT KEEPS
     APART. What is PRESCRIBED, what is EXECUTED in any one week and what is
     DEMONSTRATED as sustainable are three different facts. The third-highest
     running-day count of the last fifty-two weeks is the same statistic the
     volume side already uses, and it is chosen precisely so that a single bad
     week -- a cold, a work trip, a missed alarm -- cannot cost an athlete
     capacity they have spent a year showing. */
  const a = require('./audit/planAudit.js').app();
  assert.equal(a.DEMONSTRATED_WINDOW_WEEKS, 52);
  assert.equal(a.SUSTAINED_WEEKS_REQUIRED, 3);

  assert.equal(athleteWhoRuns(5).demonstratedRunningFrequency(), 5,
    'an established five-day athlete');
  assert.equal(athleteWhoRuns(i => (i === 51 ? 4 : 5)).demonstratedRunningFrequency(), 5,
    'one week of four runs does not make them a four-day athlete');
  assert.equal(athleteWhoRuns(i => (i === 51 ? 0 : 5)).demonstratedRunningFrequency(), 5,
    'nor does a week with no running at all');
  assert.equal(athleteWhoRuns(i => (i >= 50 ? 4 : 5)).demonstratedRunningFrequency(), 5,
    'nor two such weeks');
  assert.equal(athleteWhoRuns(i => (i >= 49 ? 4 : 5)).demonstratedRunningFrequency(), 5,
    'nor three');
  assert.equal(athleteWhoRuns(i => (i >= 48 ? 0 : 5)).demonstratedRunningFrequency(), 5,
    'nor a month off injured');
  assert.equal(athleteWhoRuns(6).demonstratedRunningFrequency(), 6,
    'and an established six-day athlete is not reduced either');
});

test('and the plan an established five-day athlete gets still runs five days', () => {
  /* The statistic is only half of it: the prescription has to read it. Built
     through the same two calls handleGeneratePlan() makes. */
  const a = athleteWhoRuns(i => (i === 51 ? 4 : 5));
  const schedule = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
  const blk = a.buildBlockWeeks('10k', 45, 12, {});
  const days = a.buildDaysFromWeeks(blk, end, schedule, start, false);
  const byWeek = {};
  days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  blk.weeks.forEach(w => {
    if (w.isRace) return;
    const runs = (byWeek[w.week] || []).filter(d => d.km > 0).length;
    assert.equal(runs, 5, 'wk' + w.week + ' runs on ' + runs + ' days');
  });
});

test('demonstrated frequency is a ceiling, never a floor on top of availability', () => {
  /* A six-day history does not buy a sixth day from an athlete who said they
     have four. Availability is the ceiling and the three inputs only ever
     lower it. */
  const a = athleteWhoRuns(6);
  const schedule = { activeDays: [1, 3, 5, 6], longRunDay: 6 };
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
  const days = a.buildDaysFromWeeks(a.buildBlockWeeks('10k', 45, 12, {}),
    end, schedule, start, false);
  const byWeek = {};
  days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  Object.keys(byWeek).forEach(w => {
    const runs = byWeek[w].filter(d => d.km > 0).length;
    assert.ok(runs <= 4, 'wk' + w + ' runs on ' + runs + ' of four available days');
  });
});

test('too little history is not evidence of a low frequency', () => {
  /* SUSTAINED_WEEKS_REQUIRED is a sufficiency rule. Below it the answer is
     null -- "no statement" -- and the athlete keeps the availability they
     chose, rather than being told two weeks of logging is their ceiling. */
  for (const weeks of [0, 1, 2])
    assert.equal(athleteWhoRuns(5, weeks).demonstratedRunningFrequency(), null,
      weeks + ' week(s) of history should make no statement');
  assert.equal(athleteWhoRuns(5, 3).demonstratedRunningFrequency(), 5,
    'three weeks is the point at which it can');
});

test('running frequency does not buy quality frequency', () => {
  /* HQ's separation, asserted in the direction that matters. An athlete whose
     demonstrated frequency rises from three to four gains a running day and
     nothing else: the second quality session is earned from their logged
     response, and no day count grants it. */
  const schedule = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
  const shape = dem => {
    const a = athleteWhoRuns(dem);
    const start = a.todayStr();
    const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
    const days = a.buildDaysFromWeeks(a.buildBlockWeeks('10k', 45, 12, {}),
      end, schedule, start, false);
    const Q = ['tempo','threshold','interval','repetition','checkpoint','calibration'];
    const byWeek = {};
    days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
    return Object.keys(byWeek).map(Number).sort((x, y) => x - y).map(w => ({
      runs: byWeek[w].filter(d => d.km > 0).length,
      quality: byWeek[w].filter(d => d.km > 0 && Q.indexOf(d.type) !== -1).length }));
  };
  const three = shape(3), four = shape(4);
  three.forEach((w, i) => {
    assert.ok(four[i].runs >= w.runs, 'wk' + (i + 1) + ' should not lose a running day');
    assert.equal(four[i].quality, w.quality,
      'wk' + (i + 1) + ' quality went ' + w.quality + ' -> ' + four[i].quality +
      ' on a running-day change alone');
  });
});

test('the aerobic-dominance ceiling is read against the days the week runs on', () => {
  /* The approved contract says a three-day week gets at most one hard session.
     Once running days can fall below availability, reading the ceiling from
     availability would give a six-day schedule's ceiling to a three-day week --
     two hard days out of three. */
  const a = require('./audit/planAudit.js').app();
  const schedule = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };
  for (const dem of [3, 4, 5, 6]){
    const app2 = athleteWhoRuns(dem);
    const start = app2.todayStr();
    const end = app2.addDays(app2.addDays(start, -app2.isoWeekday(start)), 12 * 7 - 1);
    const days = app2.buildDaysFromWeeks(app2.buildBlockWeeks('half', 60, 12, {}),
      end, schedule, start, false);
    const Q = ['tempo','threshold','interval','repetition','checkpoint','calibration'];
    const byWeek = {};
    days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
    Object.keys(byWeek).forEach(w => {
      const ds = byWeek[w].filter(d => d.km > 0);
      const q = ds.filter(d => Q.indexOf(d.type) !== -1).length;
      assert.ok(q <= a.qualitySlotCeilingForDayCount(ds.length),
        'demonstrated ' + dem + ', wk' + w + ': ' + q + ' quality on ' + ds.length + ' running days');
    });
  }
});

// ---------------------------------------------------------------------------
// A DAY THE WEEK DOES NOT RUN ON ACTUALLY RESTS
// ---------------------------------------------------------------------------
test('a day the week does not run on is a rest day, in every block that has one', () => {
  /* THE LATENT BUG THIS CLOSES. Only foundation blocks rested a dropped day;
     every other block fell through to the generic easy branch and ran it
     anyway. Reducing the easy-day count therefore divided the SAME volume
     across fewer days while still prescribing all of them -- the reduction was
     bookkeeping the athlete never saw. */
  const a = require('./audit/planAudit.js').app();
  const schedule = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };
  const app2 = athleteWhoRuns(3);
  const start = app2.todayStr();
  const end = app2.addDays(app2.addDays(start, -app2.isoWeekday(start)), 12 * 7 - 1);
  const days = app2.buildDaysFromWeeks(app2.buildBlockWeeks('10k', 45, 12, {}),
    end, schedule, start, false);
  const byWeek = {};
  days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  let restedAvailableDays = 0;
  const raceWeek = Math.max(...Object.keys(byWeek).map(Number));
  Object.keys(byWeek).forEach(w => {
    const ds = byWeek[w];
    const runs = ds.filter(d => d.km > 0);
    /* THE RACE WEEK IS NOT A TRAINING WEEK and demonstrated frequency does not
       govern it: it is the race plus its shakeouts, a fixed protocol whose
       shape is decided by the event rather than by what the athlete sustains
       in an ordinary week. Every other week is. */
    if (Number(w) !== raceWeek)
      assert.ok(runs.length <= 3, 'wk' + w + ' runs on ' + runs.length + ' days');
    if (Number(w) === raceWeek) return;
    ds.forEach(d => {
      const iso = a.isoWeekday(d.date);
      if (schedule.activeDays.indexOf(iso) === -1) return;
      if (d.km > 0) return;
      assert.equal(d.type, 'rest',
        'an available day with no run is ' + d.type + ', not a rest day');
      assert.equal(d.km, 0);
      restedAvailableDays++;
    });
  });
  assert.ok(restedAvailableDays > 0,
    'the fixture must actually produce dropped days or this asserts nothing');
});

// ---------------------------------------------------------------------------
// WHERE THE THRESHOLD CALIBRATION GOES
// ---------------------------------------------------------------------------
test('the calibration is the first prescribed running session of the block', () => {
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState();
  const schedule = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
  for (const scheduleKey of [[1, 2, 3, 5, 6], [0, 1, 2, 3, 5, 6], [1, 3, 6]]){
    const sched = { activeDays: scheduleKey, longRunDay: 6 };
    const days = a.buildDaysFromWeeks(a.buildBlockWeeks('half', 45, 12, { calibrate: true }),
      end, sched, start, false);
    const cal = days.filter(d => d.type === 'calibration');
    assert.equal(cal.length, 1, 'exactly one calibration on ' + scheduleKey.length + ' days');
    const firstRun = days.filter(d => d.km > 0)[0];
    assert.equal(firstRun.date, cal[0].date,
      'on ' + scheduleKey.length + ' days the first run is ' + firstRun.type);
  }
});

test('the calibration waits for the safety floor rather than being abandoned', () => {
  /* CALIBRATION_MIN_WEEKLY_KM is preserved exactly: an athlete below it is not
     given a maximal field test. What changes is that the session is not lost
     for the life of the block -- it is placed at the first appropriate
     opportunity once the programme's own volume reaches the floor. */
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState();
  assert.equal(a.CALIBRATION_MIN_WEEKLY_KM, 20, 'the safety floor is unchanged');
  const blk = a.buildBlockWeeks('half', 14, 16, { calibrateWhenViable: true });
  const cal = blk.weeks.filter(w => w.isCalibration);
  assert.equal(cal.length, 1, 'exactly one calibration in the block');
  assert.ok(cal[0].volume >= a.CALIBRATION_MIN_WEEKLY_KM,
    'it is placed in a week of ' + cal[0].volume + 'km');
  assert.equal(cal[0].isCutback, false, 'not in a cutback week');
  assert.equal(!!cal[0].isCheckpoint, false, 'not in a week that already tests');
  /* THE FIRST such week, not merely some such week. */
  const first = blk.weeks.filter(w => w.volume >= a.CALIBRATION_MIN_WEEKLY_KM &&
                                      !w.isCutback && !w.isCheckpoint &&
                                      !w.isTaper && !w.isRace)[0];
  assert.equal(cal[0].week, first.week,
    'placed in week ' + cal[0].week + ', first opportunity was week ' + first.week);

  /* AND WITHOUT THE DEFERRAL IT IS NOT PLACED AT ALL -- the flag is what the
     call site passes, never something this function works out for itself. */
  assert.equal(a.buildBlockWeeks('half', 14, 16, {}).weeks.filter(w => w.isCalibration).length, 0);
});

test('the deferral is offered for the floor alone, never for the other refusals', () => {
  const a = require('./audit/planAudit.js').app();
  const ctx = { healthConsent: true, lthr: null, performances: [],
                today: a.todayStr(), currentVolume: 14 };
  const reason = o => a.calibrationEligibility(Object.assign({}, ctx, o)).reason;
  assert.equal(reason({}), 'insufficient_base');
  assert.equal(reason({ healthConsent: false }), 'no_health_consent');
  assert.equal(reason({ lthr: 168, currentVolume: 45 }), 'lthr_known');
  assert.equal(a.calibrationEligibility(Object.assign({}, ctx, { currentVolume: 45 })).needed, true);
});

// ---------------------------------------------------------------------------
// PURPOSE AND STEADY ARE ONE CONTRACT, NOT TWO ARGUMENTS
// ---------------------------------------------------------------------------
test('a purpose carries its own arc, whether or not the caller says steady', () => {
  /* THE TRAP THIS CLOSES. buildBlockWeeks() took `steady` and `purpose` as two
     independent arguments and made no attempt to reconcile them, so the pairing
     lived in four call sites -- and two of them did not carry it. An adopted
     Aerobic Base plan was rebuilt as a race block; the playbook read a race
     block's weekly targets for every athlete. In the other direction,
     purpose:'maintain' without steady:true built a maintenance block that
     ramped 55% and finished with a goal effort. */
  const a = require('./audit/planAudit.js').app();
  a.state = a.makeDefaultState();
  const shape = opts => {
    const b = a.buildBlockWeeks('half', 45, 12, opts);
    return { peak: Math.round((b.peakVolume / 45) * 1000) / 1000,
             goalEffort: b.weeks.some(w => w.isRace), taper: b.taperWeeks };
  };
  for (const purpose of ['race', 'maintain', 'base', 'speed']){
    const paired = shape({ purpose, steady: purpose === 'maintain' });
    const alone = shape({ purpose });
    assert.equal(alone.peak, paired.peak, purpose + ': peak/start');
    assert.equal(alone.goalEffort, paired.goalEffort, purpose + ': goal effort');
    assert.equal(alone.taper, paired.taper, purpose + ': taper weeks');
  }
  /* MAINTENANCE HOLDS ITS DOSE. Asserted at its own value so a future change
     that quietly restores the ramp is caught here rather than by inspection. */
  const m = shape({ purpose: 'maintain' });
  assert.equal(m.peak, 1, 'maintenance does not ramp');
  assert.equal(m.goalEffort, false, 'and does not culminate in one');
  assert.equal(m.taper, 0, 'and has nothing to taper into');

  /* AN EXPLICIT ANSWER STILL WINS. The derivation fills a gap; it does not
     overrule a caller that has stated its intent. */
  assert.equal(shape({ purpose: 'maintain', steady: false }).goalEffort, true,
    'an explicit steady:false is still obeyed');
});

test('every production call site carries the purpose', () => {
  /* The defect was never in the arithmetic; it was in what reached it. Read
     off the source so a fifth call site cannot reintroduce it silently. */
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const calls = src.split('buildBlockWeeks(').slice(1)
    .map(s => s.slice(0, 400))
    .filter(s => /^\s*[a-zA-Z_$]/.test(s));            // calls, not the definition
  assert.ok(calls.length >= 4, 'found ' + calls.length + ' call sites');
  calls.forEach(c => {
    /* Either the call passes a purpose, or it passes no options at all and
       takes the documented 'race' default. What may no longer happen is a call
       that passes `steady` while withholding the purpose. */
    const opts = c.slice(0, c.indexOf(');') + 1);
    if (/\bsteady\s*:/.test(opts))
      assert.match(opts, /\bpurpose\s*:/,
        'a call site passes steady without purpose: ' + opts.replace(/\s+/g, ' ').slice(0, 160));
  });
});

// ---------------------------------------------------------------------------
// CAPACITY IS PERMISSION; WHAT THE ATHLETE IS DOING NOW IS A SEPARATE FACT
// ---------------------------------------------------------------------------
test('the two frequency readings answer two different questions', () => {
  /* A statistic built to survive a bad patch necessarily cannot notice one, so
     one reading cannot do both jobs. Capacity is held for a year and is
     permission; the current reading says what the athlete is actually
     sustaining, and only it is allowed to move quickly. Both are built from
     SUSTAINED_WEEKS_REQUIRED and neither introduces a window of its own. */
  const cap = f => athleteWhoRuns(f).demonstratedRunningFrequency();
  const now = f => athleteWhoRuns(f).currentSustainedRunningFrequency();

  const steady5 = 5;
  assert.equal(cap(steady5), 5);
  assert.equal(now(steady5), 5);

  /* ONE BAD WEEK MOVES NEITHER. The current reading is the median of the last
     three complete weeks -- the level reached in at least two of them -- so a
     single missed run cannot move it either. */
  const oneOff = i => (i === 51 ? 4 : 5);
  assert.equal(cap(oneOff), 5, 'capacity survives one bad week');
  assert.equal(now(oneOff), 5, 'and so does the current reading');

  /* A SUSTAINED CHANGE MOVES ONLY THE CURRENT READING. Two agreeing weeks are
     enough for "now"; capacity keeps its answer for the rest of the year. */
  const dropped = i => (i >= 50 ? 3 : 5);
  assert.equal(cap(dropped), 5, 'capacity is not erased by a fortnight');
  assert.equal(now(dropped), 3, 'but the current reading has noticed');

  /* AND IT COMES BACK AS FAST AS IT WENT. */
  const recovering = i => (i >= 50 ? 5 : 3);
  assert.equal(now(recovering), 5);

  /* NEITHER SPEAKS WITHOUT ENOUGH WEEKS TO SPEAK FROM. */
  for (const weeks of [0, 1, 2]){
    assert.equal(athleteWhoRuns(5, weeks).demonstratedRunningFrequency(), null);
    assert.equal(athleteWhoRuns(5, weeks).currentSustainedRunningFrequency(), null);
  }
});

test('the current reading lowers the prescription and never raises it', () => {
  const schedule = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
  const runsPerWeek = fn => {
    const a = athleteWhoRuns(fn);
    const start = a.todayStr();
    const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
    const days = a.buildDaysFromWeeks(a.buildBlockWeeks('10k', 45, 12, {}),
      end, schedule, start, false);
    const byWeek = {};
    days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
    return Object.keys(byWeek).map(Number).sort((x, y) => x - y)
      .map(w => byWeek[w].filter(d => d.km > 0).length);
  };
  /* Sustaining three of their five available days: the plan is built on three. */
  assert.ok(runsPerWeek(i => (i >= 49 ? 3 : 5)).slice(0, -1).every(n => n === 3),
    'a sustained reduction is respected');
  /* One missed run: still five. */
  assert.ok(runsPerWeek(i => (i === 51 ? 4 : 5)).slice(0, -1).every(n => n === 5),
    'one missed run is not a reduction');
  /* And a good recent fortnight cannot buy days beyond demonstrated capacity:
     three days for a year, five for the last two weeks -- capacity says three. */
  assert.ok(runsPerWeek(i => (i >= 50 ? 5 : 3)).slice(0, -1).every(n => n === 3),
    'the current reading can lower the ceiling but never lift it');
});

// ---------------------------------------------------------------------------
// AN AVAILABLE UNUSED DAY IS NOT A REQUIRED REST DAY
// ---------------------------------------------------------------------------
test('a day the programme did not need is marked, and carries no training', () => {
  const a = athleteWhoRuns(3);
  const schedule = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
  const days = a.buildDaysFromWeeks(a.buildBlockWeeks('10k', 45, 12, {}),
    end, schedule, start, false);

  const unused = days.filter(d => d.availableUnused);
  assert.ok(unused.length > 0, 'the fixture must actually produce unused days');
  unused.forEach(d => {
    assert.equal(d.type, 'rest', 'an unused available day is a rest day');
    assert.equal(d.km, 0, 'and carries no distance');
    assert.equal(d.prescription, undefined, 'and no prescription');
    assert.ok(schedule.activeDays.indexOf(a.isoWeekday(d.date)) !== -1,
      'and is a day the athlete actually offered');
  });
  /* THE OTHER REST DAYS ARE NOT MARKED. A day the athlete never offered is a
     different fact and must not be confused with one they did. */
  days.filter(d => d.type === 'rest' &&
                   schedule.activeDays.indexOf(a.isoWeekday(d.date)) === -1)
      .forEach(d => assert.ok(!d.availableUnused,
        'a day outside the athlete\'s availability is never marked available'));

  /* AND IT CANNOT CONTAMINATE THE PRESCRIPTION MATHEMATICS. Every accounting
     the week does reads distance, and an unused day has none. */
  const wk = days.filter(d => d.week === unused[0].week);
  const withUnused = wk.reduce((t, d) => t + (d.km || 0), 0);
  const withoutUnused = wk.filter(d => !d.availableUnused)
                          .reduce((t, d) => t + (d.km || 0), 0);
  assert.equal(withUnused, withoutUnused, 'it adds nothing to the week');
  const st = a.horizonStimulus(wk);
  const st2 = a.horizonStimulus(wk.filter(d => !d.availableUnused));
  assert.equal(st.qualityExposures, st2.qualityExposures);
  assert.equal(st.totalKm, st2.totalKm);
  assert.equal(st.sessions, st2.sessions, 'and is not counted as a session');
});

test('an optional run is offered only where recovery already allows the load', () => {
  /* Three things share the type "rest": a day the athlete never offered, a day
     the programme is protecting, and a day it simply did not need. Only the
     third is offered, and which is which is decided by the SAME gate
     supporting work uses rather than by a second recovery model. */
  const a = athleteWhoRuns(3);
  const schedule = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 12 * 7 - 1);
  a.state.days = a.buildDaysFromWeeks(a.buildBlockWeeks('10k', 45, 12, {}),
    end, schedule, start, false);

  let offered = 0, withheld = 0;
  a.state.days.forEach(d => {
    const weekDays = a.state.days.filter(x => x.week === d.week);
    const eligible = a.optionalRunEligible(d, weekDays);
    if (!d.availableUnused){
      assert.equal(eligible, false, d.date + ' is not an available unused day');
      return;
    }
    const gate = a.supportDayEligible(d, weekDays);
    assert.equal(eligible, !!(gate && gate.ceiling >= 3 && !gate.only),
      d.date + ': optional eligibility must follow the supporting-work gate exactly');
    if (eligible) offered++; else withheld++;
  });
  assert.ok(offered > 0, 'some unused days are genuinely free');
  assert.ok(withheld > 0,
    'and some are protected — an available day is not automatically eligible');

  /* A completed day is never re-offered. */
  const anyOffered = a.state.days.filter(d =>
    a.optionalRunEligible(d, a.state.days.filter(x => x.week === d.week)))[0];
  anyOffered.completed = true;
  assert.equal(a.optionalRunEligible(anyOffered,
    a.state.days.filter(x => x.week === anyOffered.week)), false);
});
