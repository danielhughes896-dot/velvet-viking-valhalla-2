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

test('a trimmed long run now carries its goal segment down with it', () => {
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
  const long = wk2.sessions.find(s => s.type === 'long');
  assert.ok(long.km < wk2.longTarget - 0.6, 'the day is still trimmed after the fact');
  /* At 4km the run is below the floor, so the finish is omitted entirely
     rather than left at 75% of a run it was sized to be under half of. */
  assert.equal(long.archetype, 'long_run');
  assert.equal(long.segments.length, 1);
  assert.equal(long.segments[0].km, long.km);
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

  const c = auditCase({ distanceKey: 'half', volume: 12, weeks: 12, scheduleKey: 'd5' });
  const w1 = c.weeks[0].accounting;
  assert.ok(w1.floorExcess > 0, 'a 12km/week athlete is over-prescribed by the floors');
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
    const expected = a.MIN_PEAK_LONG_KM[d] / (p.volMult * a.LONG_FRACTION[p.emphasis]);
    assert.ok(Math.abs(a.minViableStartKm(d, 12) - expected) < 0.05, d);
    assert.ok(a.MIN_PEAK_LONG_KM[d] <= p.longCapKm,
      d + ': the floor on the peak must not exceed the ceiling on the session');
  });
});

test('the boundary takes planWeeks now so D-7 can bind later without a rewrite', () => {
  /* D-7 -- time-limiting how much development a block can earn -- is approved
     in principle and explicitly excluded from S1-S3. The argument is already
     threaded through every call so that when it lands it changes
     developmentMultiplierFor() and nothing else. Today it is unused, and this
     asserts that: the boundary is block-length INDEPENDENT until D-7 says
     otherwise. */
  const a = require('./audit/planAudit.js').app();
  for (const d of ['5k', 'half', 'full']){
    const at4 = a.minViableStartKm(d, 4), at24 = a.minViableStartKm(d, 24);
    assert.equal(at4, at24, d + ': the boundary must not vary by block length yet');
    assert.equal(a.developmentMultiplierFor(d, 4), a.DISTANCE_PROFILES[d].volMult);
  }
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

test('what remains inside the race population is D-7, and says so', () => {
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
  assert.ok(total > 0, 'expected the D-7 cases to still be present');
  assert.equal(shortBlock, total,
    'every surviving week-one overshoot must be a block of 6 weeks or fewer; ' +
    (total - shortBlock) + ' were not, which would be a new defect rather than D-7');
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

test('an on-ramp that cannot arrive says so rather than failing quietly', () => {
  /* The same rule S2 established for the allocator: no SILENT failure. A
     shortfall the accounting names is declared and reported; one nothing
     accounts for is a defect, and there are none of those. */
  const m = onRamps();
  assert.ok((m.tally.onramp_declared_shortfall || 0) > 0,
    'expected some on-ramps to be honest about not arriving');
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

test('S4 changed nothing in the race population', () => {
  /* The on-ramp is a separate architecture on a separate path. If a single
     race-plan count moved, S4 reached somewhere it should not have. */
  const m = matrix();
  const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit', 'baseline.json'), 'utf8'));
  Object.keys(BASE.tally).forEach(k =>
    assert.equal(m.tally[k] || 0, BASE.tally[k], k + ' moved in the race population'));
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

test('S5 changed nothing in the race population', () => {
  const m = matrix();
  const BASE = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit', 'baseline.json'), 'utf8'));
  Object.keys(BASE.tally).forEach(k =>
    assert.equal(m.tally[k] || 0, BASE.tally[k], k + ' moved in the race population'));
});
