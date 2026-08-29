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
  // and the race block's own taper is untouched
  const race = build(a, 'half', 45, 12, 'race');
  const t = race.weeks.filter(w => w.isTaper);
  /* Half of the peak -- but read against the REPORTED peak, which is itself
     already rounded, so the comparison carries one rounding step of slack.
     Taking round1(round1(peak) * 0.5) as the expected value only ever agreed
     with the engine by luck: it happens to agree when the raw peak lands on a
     tenth (45 x 1.55 = 69.75) and disagree by 0.1 when it does not
     (45 x 1.45 = 65.25 -> peak 65.3, taper 32.6, round1(65.3/2) = 32.7). */
  assert.ok(Math.abs(t[t.length - 1].volume - race.peakVolume * 0.5) <= 0.1,
    'the final taper week is ' + t[t.length - 1].volume + ' against a peak of ' + race.peakVolume);
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
  const a = app();
  const b = build(a, 'half', 45, 12, 'race');
  assert.equal(b.buildWeeks, 9);
  assert.equal(b.taperWeeks, 2);
  assert.equal(b.weeks.filter(w => w.isRace).length, 1);
  assert.equal(b.weeks.filter(w => w.isCheckpoint).length, 1);
  /* The peak is the profile multiplier EARNED OVER THE WEEKS AVAILABLE. A
     twelve-week block has nine developing weeks against the fourteen-week
     block's eleven, so it reaches nine elevenths of the way from 1.0 to the
     profile's 1.55 rather than all of it. The full-length block below is the
     one that still lands exactly on volMult. */
  assert.equal(b.peakVolume, a.round1(45 * a.developmentMultiplierFor('half', 12)));
  assert.ok(count(b, 'Base') > 0 && count(b, 'Build') > 0 && count(b, 'Peak') > 0);
});

test('a full-length race block still peaks at exactly the profile multiplier', () => {
  /* The other half of the statement above, and the property that must not move:
     at the builder's own default length the profile multiplier is reached in
     full, so the distance profiles still mean what they say. */
  const a = app();
  const N = a.BUILDER_PURPOSE_META.race.defaultWeeks;
  assert.equal(a.developmentMultiplierFor('half', N), a.DISTANCE_PROFILES.half.volMult);
  const b = build(a, 'half', 45, N, 'race');
  assert.equal(b.peakVolume, a.round1(45 * a.DISTANCE_PROFILES.half.volMult));
  // and longer than the default cannot exceed it either -- volMult is a ceiling
  const long = build(a, 'half', 45, 20, 'race');
  assert.equal(long.peakVolume, a.round1(45 * a.DISTANCE_PROFILES.half.volMult));
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
  const a = app();
  [['race', 'half', 12], ['base', 'half', 10], ['speed', '5k', 6],
   ['recovery', 'half', 2], ['maintain', 'half', 8]].forEach(([p, d, n]) => {
    const b = build(a, d, 45, n, p, { steady: p === 'maintain' });
    b.weeks.forEach(w => {
      const expected = a.phaseForWeek(w.week, n, p);
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
