'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* EVERY BLOCK HAD THE SAME SHAPE, AND ONLY ONE PURPOSE WANTED IT.
 *
 * The generator knew one arc -- ramp, peak, taper, goal effort -- and every
 * purpose was poured into it. What the programme audit found:
 *
 *   AEROBIC BASE  ten weeks containing ONE base week. Week 1 Base, 2-6 Build,
 *                 7 Peak, 8-9 Taper, 10 a maximal goal effort, plus a maximal
 *                 time trial at week 6. A block named for aerobic development
 *                 spending 90% of itself doing something else, and tapering
 *                 for a race that did not exist.
 *   SPEED         six weeks: three development, two taper, one final. Half the
 *                 block spent winding down.
 *   RECOVERY      two weeks, non-steady, so it inherited the RAMP: week one was
 *                 generated at the start volume times the distance profile's
 *                 race multiplier. A recovery block that climbs.
 */

const TODAY = '2026-08-21';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  a.state.athlete = a.makeAthleteRecord();
  return a;
}
const build = (a, distKey, vol, wks, purpose, extra) =>
  a.buildBlockWeeks(distKey, vol, wks, Object.assign({ purpose: purpose }, extra || {}));
const phases = b => b.weeks.map(w => w.phase);
const count = (b, p) => phases(b).filter(x => x === p).length;

/* ---------------------------------------------------------------- *
 * AEROBIC BASE
 * ---------------------------------------------------------------- */

test('an aerobic base block is mostly base weeks', () => {
  const b = build(app(), 'half', 45, 10, 'base');
  assert.ok(count(b, 'Base') >= 7,
    'only ' + count(b, 'Base') + ' of 10 weeks are base weeks: ' + phases(b).join(' '));
});

test('and contains no Peak week at all', () => {
  const b = build(app(), 'half', 45, 10, 'base');
  assert.equal(count(b, 'Peak'), 0, 'an aerobic base block peaks: ' + phases(b).join(' '));
});

test('it does not taper, because there is nothing to taper into', () => {
  const b = build(app(), 'half', 45, 10, 'base');
  assert.equal(b.taperWeeks, 0);
  assert.equal(b.weeks.filter(w => w.isTaper).length, 0);
});

test('it has no goal effort and no maximal time trial', () => {
  const b = build(app(), 'half', 45, 10, 'base');
  assert.equal(b.weeks.filter(w => w.isRace).length, 0, 'a base block ends in a maximal effort');
  assert.equal(b.weeks.filter(w => w.isCheckpoint).length, 0, 'a base block still tests the athlete');
});

test('but it still ends somewhere: the last week consolidates', () => {
  const b = build(app(), 'half', 45, 10, 'base');
  const last = b.weeks[b.weeks.length - 1];
  assert.equal(last.isCutback, true, 'the base block ends at its own peak');
  assert.ok(last.volume < b.peakVolume);
});

test('a base block still builds aerobic volume -- it just does not build to a race peak', () => {
  const a = app();
  const b = build(a, 'half', 45, 10, 'base');
  assert.ok(b.peakVolume > 45, 'the base block stopped building');
  const race = build(a, 'half', 45, 10, 'race');
  assert.ok(b.peakVolume < race.peakVolume,
    'the base block still ramps on the race-distance multiplier (' +
    b.peakVolume + ' vs ' + race.peakVolume + ')');
  assert.equal(b.peakVolume, a.round1(45 * a.BASE_VOLUME_MULT));
});

/* ---------------------------------------------------------------- *
 * SPEED & THRESHOLD
 * ---------------------------------------------------------------- */

test('a six-week speed block is four development weeks, one down week and a benchmark', () => {
  const b = build(app(), '5k', 45, 6, 'speed');
  const dev = b.weeks.filter(w => !w.isTaper && !w.isRace).length;
  assert.equal(dev, 4, 'development weeks: ' + dev + ' (' + phases(b).join(' ') + ')');
  assert.equal(b.weeks.filter(w => w.isTaper).length, 1);
  assert.equal(b.weeks.filter(w => w.isRace).length, 1);
});

test('it used to be three development weeks and three winding down', () => {
  /* The regression, named against the numbers the audit reported. */
  const b = build(app(), '5k', 45, 6, 'speed');
  assert.ok(b.buildWeeks >= 4, 'the speed block is back to ' + b.buildWeeks + ' development weeks');
});

test('the down week consolidates rather than tapers', () => {
  const a = app();
  const b = build(a, '5k', 45, 6, 'speed');
  const down = b.weeks.filter(w => w.isTaper)[0];
  assert.ok(down.volume > b.peakVolume * 0.6,
    'the consolidation week sheds ' + Math.round((1 - down.volume / b.peakVolume) * 100) +
    '% of peak volume, which is a marathon taper');
  /* AND THE RACE BLOCK'S OWN WIND-DOWN IS STILL A WIND-DOWN -- but the half's
     is no longer a whole-week fraction of the peak. It is anchored to the
     event at D-10, which for a Sunday race falls mid-week, so the block's
     second-to-last week is genuinely split: its opening days are the last
     loading days and its closing days are already the taper. A block-level
     assertion cannot see that, because the scaling is applied per day from the
     real race date. What it can assert, and what matters, is that the arc
     still declares an anchored wind-down and that the wind-down week is not
     the block's peak. */
  const race = build(a, 'half', 45, 12, 'race');
  const t = race.weeks.filter(w => w.isTaper);
  assert.equal(a.blockArcFor('race', 12, 'half').taperAnchorDays, a.HALF_TAPER_ANCHOR_DAYS,
    'the half arc states the day its taper begins');
  assert.ok(t.length >= 1, 'the half race block still has a wind-down week');
  /* Against the peak the block BUILT. peakVolume is the legacy ramp's ceiling
     and a bottom-up block is not derived from it, so comparing a real week to
     it compares a week to a number no week of this block matches. */
  assert.ok(t[t.length - 1].volume < race.builtPeakVolume,
    'the final wind-down week is ' + t[t.length - 1].volume +
    ' against a built peak of ' + race.builtPeakVolume);
});

test('a speed block does not also carry a mid-block time trial', () => {
  /* Two maximal efforts in six weeks is one too many. */
  const b = build(app(), '5k', 45, 6, 'speed');
  assert.equal(b.weeks.filter(w => w.isCheckpoint).length, 0);
});

test('a very short speed block still ends in its benchmark', () => {
  const b = build(app(), '5k', 45, 3, 'speed');
  assert.equal(b.weeks.filter(w => w.isRace).length, 1);
  assert.ok(b.buildWeeks >= 1);
});

/* ---------------------------------------------------------------- *
 * RECOVERY
 * ---------------------------------------------------------------- */

test('a recovery block does not climb', () => {
  const b = build(app(), 'half', 22, 2, 'recovery');
  b.weeks.forEach(w => assert.ok(w.volume <= 22.1,
    'week ' + w.week + ' of a recovery block was generated at ' + w.volume + 'km'));
  assert.equal(b.peakVolume, 22);
});

test('a recovery block has no goal effort, no taper and no checkpoint', () => {
  const b = build(app(), 'half', 22, 2, 'recovery');
  assert.equal(b.weeks.filter(w => w.isRace).length, 0);
  assert.equal(b.weeks.filter(w => w.isTaper).length, 0);
  assert.equal(b.weeks.filter(w => w.isCheckpoint).length, 0);
});

/* ---------------------------------------------------------------- *
 * THE RACE BLOCK IS UNCHANGED
 * ---------------------------------------------------------------- */

test('a race block keeps every part of the arc it always had', () => {
  /* EVERY PART EXCEPT THE TWO THE HALF'S OWN ARCHITECTURE NOW STATES. It
     states its phases as counts rather than as fractions of itself, and its
     wind-down is anchored to the event rather than spending two whole calendar
     weeks -- so a twelve-week block develops for ten weeks and winds down
     through one calendar week plus race week. Everything else this test was
     written to protect is unchanged: one goal effort, one checkpoint, a peak
     that is the profile multiplier earned over the weeks available, and all
     three phases present. */
  const a = app();
  const b = build(a, 'half', 45, 12, 'race');
  assert.equal(b.buildWeeks, 10);
  assert.equal(b.taperWeeks, 1);
  assert.equal(b.weeks.filter(w => w.isRace).length, 1);
  assert.equal(b.weeks.filter(w => w.isCheckpoint).length, 1);
  /* AND THE PEAK IS THE PEAK THE BLOCK BUILT. It used to be asserted as the
     stated volume times a development multiplier, which is the authority
     destination-led construction removed: a race block's weeks are the sum of
     their sessions, walking from the athlete's entry to what the EVENT asks
     for, and the multiplier plays no part in either end of that. The reported
     figure is now the largest developing week the block actually prescribes,
     which is the thing every consumer outside the generator wanted. The
     multiplier still means exactly what it says for every block that still
     uses the legacy arc -- asserted below. */
  const dev = b.weeks.filter(w => !w.isRace && !w.isTaper);
  assert.equal(b.builtPeakVolume,
    a.round1(Math.max.apply(null, dev.map(w => w.volume))));
  assert.ok(b.weeks.filter(w => w.isTaper).every(w => w.volume <= b.builtPeakVolume + 1e-9),
    'a wind-down week is not the block peak');
  assert.ok(count(b, 'Base') > 0 && count(b, 'Build') > 0 && count(b, 'Peak') > 0);
});

test('the profile multiplier still means what it says wherever the ramp still runs', () => {
  /* The other half of the statement above. The half and the marathon build
     their weeks from sessions and no longer ramp to a multiple of the athlete's
     stated volume -- that authority was removed deliberately. Every other
     distance and every other purpose still does, and the profile multiplier
     still has to mean exactly what it says there. */
  const a = app();
  const N = a.BUILDER_PURPOSE_META.race.defaultWeeks;
  ['5k', '10k'].forEach(d => {
    assert.equal(a.developmentMultiplierFor(d, N), a.DISTANCE_PROFILES[d].volMult);
    const b = build(a, d, 45, N, 'race');
    assert.equal(b.peakVolume, a.round1(45 * a.DISTANCE_PROFILES[d].volMult),
      d + ' no longer peaks at its profile multiplier');
    // and longer than the default cannot exceed it either -- volMult is a ceiling
    const long = build(a, d, 45, 20, 'race');
    assert.equal(long.peakVolume, a.round1(45 * a.DISTANCE_PROFILES[d].volMult));
  });
  /* AND THE TWO DEDICATED ARCHITECTURES MUST NOT BE READING IT. Their peak is
     what their sessions came to, and it is free to be either side of the
     figure the multiplier would have produced -- what it may not be is that
     figure, week after week, which is what would show the ramp still running. */
  ['half', 'full'].forEach(d => {
    const b = build(a, d, 45, 15, 'race');
    const dev = b.weeks.filter(w => !w.isRace && !w.isTaper);
    assert.equal(b.builtPeakVolume, a.round1(Math.max.apply(null, dev.map(w => w.volume))),
      d + ' reports a built peak no week of it matches');
  });
});

test('a block built with no purpose at all is still the race block, byte for byte', () => {
  /* Two callers predate year-round training -- the plan preview and the
     server-side builder preview -- and neither passes a purpose. */
  const a = app();
  assert.equal(JSON.stringify(a.buildBlockWeeks('half', 45, 12)),
               JSON.stringify(a.buildBlockWeeks('half', 45, 12, { purpose: 'race' })));
  assert.equal(JSON.stringify(a.buildBlockWeeks('half', 45, 12, {})),
               JSON.stringify(a.buildBlockWeeks('half', 45, 12, { purpose: 'race' })));
});

/* ---------------------------------------------------------------- *
 * ONE DEFINITION OF PHASE, SHARED
 * ---------------------------------------------------------------- */

test('phaseForWeek and the generator agree for every purpose', () => {
  /* The reason phaseForWeek exists: three functions once answered "what phase
     is week N" and disagreed on 5 of 14 weeks. Adding four arcs is exactly
     the change that could reopen that. */
  /* AND THE DISTANCE IS PART OF THE QUESTION. Two arcs now state their phases
     as counts -- the marathon's and the half's -- so "what phase is week N"
     cannot be answered without saying which programme is being asked about.
     Omitting it here asked the fraction-based arc about a block built from
     counts, which is the very disagreement this test exists to catch. */
  const a = app();
  [['race', 'half', 12], ['race', 'full', 15], ['base', 'half', 10],
   ['speed', '5k', 6], ['recovery', 'half', 2], ['maintain', 'half', 8]].forEach(([p, d, n]) => {
    const b = build(a, d, 45, n, p, { steady: p === 'maintain' });
    b.weeks.forEach(w => {
      const expected = a.phaseForWeek(w.week, n, p, d);
      assert.equal(w.phase, expected === 'Final' ? 'Final Week' : expected,
        p + ' week ' + w.week + ': generator says ' + w.phase + ', phaseForWeek says ' + expected);
    });
  });
});

test('the old boolean third argument still means maintain', () => {
  const a = app();
  assert.equal(a.phaseForWeek(3, 8, true), 'Maintain');
  assert.equal(a.phaseForWeek(3, 12, false), a.phaseForWeek(3, 12, 'race'));
});

test('maintenance is not a phase in which the coach may add quality volume', () => {
  /* The other half of making maintenance maintain. The generator no longer
     progresses a steady block, but the adaptation layer could have done it one
     decision at a time: an unlisted phase falls through to Build, and Build
     permits controlled increases in quality volume. */
  const a = app();
  assert.equal(a.playbookPhaseAllowsProgress('Maintain'), false);
  assert.equal(a.playbookPhaseAllowsProgress('Build'), true);
});
