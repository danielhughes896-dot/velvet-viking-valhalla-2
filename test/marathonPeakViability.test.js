'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* THE RACE-PROGRAMME VIABILITY CONTRACT, STATED
 * ===========================================================================
 * MIN_PEAK_LONG_KM looks like a second, independent opinion about long runs
 * sitting beside LONG_FRACTION -- two magic numbers that could drift apart,
 * and one of them (full: 30) apparently unreachable for most athletes the
 * product will happily build a marathon plan for.
 *
 * It is not a second opinion. It is the SAME equation, solved for a different
 * unknown:
 *
 *     the builder asks   peak long run = peak volume x LONG_FRACTION
 *     the gate asks      what start volume makes that reach the floor?
 *
 * minViableStartKm() is that inversion, algebraically exact. So the floor is
 * not a number to be reconciled with the prescription -- it IS the
 * prescription, read backwards, and the only free parameter is what counts as
 * adequate preparation for the distance.
 *
 * These tests pin that identity, and pin what follows from it: the gate
 * partitions the population exactly, and a plan built WITHOUT consulting the
 * gate can therefore land below the floor without any constant being wrong.
 */
const TODAY = '2026-08-30';
const app = () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
};
const DISTANCES = ['5k', '10k', 'half', 'full', 'ultra'];
const WEEKS = [12, 14, 16, 20, 24];
const SCHED = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };

/* The long run the athlete actually receives. A partial first calendar week
   can hold a single day and is not a training week. */
function deliveredPeakLong(a, distKey, volume, weeks){
  const blk = a.buildBlockWeeks(distKey, volume, weeks, {});
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
  const ds = a.buildDaysFromWeeks(blk, end, SCHED, TODAY, true);
  /* THE WEEKLY LONG-RUN ALLOCATION, WHICH IS WHAT THE FLOOR IS DEFINED ON --
     and taking the single longest DAY instead was this instrument's own bug,
     found when ultra appeared to miss its floor by 7 km. MIN_PEAK_LONG_KM's own
     comment says it: "defined on longTarget, the weekly long-run ALLOCATION,
     not on any single session ... that distinction matters for ultra alone,
     where longTarget is split 0.62/0.38 across a back-to-back weekend". The
     peak ultra week really is 11 km + 19 km = 30 km, exactly its floor; the
     single 19 km day is the correct reading of an ultra long weekend, not a
     shortfall. Only ultra carries profile.backToBack, so summing the week's
     long days is identical to taking the one long day everywhere else. */
  let best = 0;
  [...new Set(ds.map(d => d.week))].filter(Boolean).forEach(k => {
    const wd = ds.filter(d => d.week === k);
    if (wd.length < 7) return;
    const alloc = wd.filter(d => d.type === 'long').reduce((t, d) => t + (d.km || 0), 0);
    if (alloc > best) best = alloc;
  });
  return best;
}

test('the viability floor is the prescription methodology, inverted — not a second number', () => {
  const a = app();
  DISTANCES.forEach(d => {
    const p = a.DISTANCE_PROFILES[d];
    const frac = a.LONG_FRACTION[p.emphasis];
    WEEKS.forEach(w => {
      const start = a.minViableStartKm(d, w);
      assert.ok(start > 0, d + '/' + w + ': the gate must have an answer');
      /* start x development x fraction === the floor. Exact to the one
         rounding minViableStartKm() itself applies (round1 on the start). */
      const reconstructed = start * a.developmentMultiplierFor(d, w) * frac;
      assert.ok(Math.abs(reconstructed - a.MIN_PEAK_LONG_KM[d]) < 0.06,
        d + '/' + w + 'wk: ' + start + ' km x ' + a.developmentMultiplierFor(d, w) +
        ' x ' + frac + ' = ' + reconstructed.toFixed(3) +
        ', which is not MIN_PEAK_LONG_KM.' + d + ' = ' + a.MIN_PEAK_LONG_KM[d] +
        ' — the gate and the builder have stopped being the same equation');
    });
  });
});

test('an athlete admitted at the floor reaches the floor, through the real builder', () => {
  /* The identity above is algebra. This is the same claim made against the
     generator, so a change to the arc, the cap or the allocator that broke it
     in practice would fail here even if the arithmetic still agreed. */
  const a = app();
  DISTANCES.forEach(d => {
    WEEKS.forEach(w => {
      const start = a.minViableStartKm(d, w);
      const long = deliveredPeakLong(a, d, start, w);
      assert.ok(long + 0.55 >= a.MIN_PEAK_LONG_KM[d],
        d + '/' + w + 'wk: admitted at ' + start + ' km/wk, the peak long run is ' +
        long + ' km against a declared floor of ' + a.MIN_PEAK_LONG_KM[d]);
    });
  });
});

test('the marathon floor is not reachable below its own admission volume, and that is the point', () => {
  /* The fact that started this audit: a 51 km/week athlete peaks at 28 km, not
     30. That is not a contradiction between two constants -- it is an athlete
     BELOW the admission volume, which for a 16-week marathon block is 53.6
     km/week. The gate's whole job is to notice that. */
  const a = app();
  const floor = a.minViableStartKm('full', 16);
  assert.ok(floor > 51 && floor < 56, 'the 16-week marathon admission volume is ' + floor);
  assert.ok(deliveredPeakLong(a, 'full', 51, 16) < a.MIN_PEAK_LONG_KM.full,
    '51 km/wk is below the floor, so a straight race block must fall short of it');
  assert.ok(deliveredPeakLong(a, 'full', floor, 16) + 0.55 >= a.MIN_PEAK_LONG_KM.full,
    'and at the floor it must reach it');
  /* Which is exactly what the pathway says about that athlete. */
  const p = a.athletePathway('full', 51, 16);
  assert.equal(p.route, 'on_ramp_then_race');
  assert.ok(p.onRampToKm + 0.05 >= floor,
    'the on-ramp targets the admission volume, not some other number');
  assert.ok(deliveredPeakLong(a, 'full', p.onRampToKm, p.raceBlockWeeks) + 0.55 >= a.MIN_PEAK_LONG_KM.full,
    'and the race block that follows it reaches the floor');
});

test('the gate partitions the marathon population exactly at the floor', () => {
  /* THE DECISIVE PROPERTY. If MIN_PEAK_LONG_KM.full were wrong -- too high for
     the methodology -- there would be athletes the gate admits straight to a
     race block whose plan still falls short. There are none. Every athlete the
     gate admits reaches the floor; every athlete who would fall short is
     routed to an on-ramp instead. */
  const a = app();
  let admitted = 0, routed = 0;
  for (let v = 25; v <= 90; v += 5){
    for (const w of [12, 14, 16, 20, 24]){
      const p = a.athletePathway('full', v, w);
      const long = deliveredPeakLong(a, 'full', v, w);
      if (p.route === 'race_programme'){
        admitted++;
        assert.ok(long + 0.55 >= a.MIN_PEAK_LONG_KM.full,
          v + ' km/wk over ' + w + 'wk was admitted straight to a race block but peaks at ' +
          long + ' km, below the ' + a.MIN_PEAK_LONG_KM.full + ' km floor');
      } else if (p.route === 'on_ramp_then_race' || p.route === 'foundation_then_on_ramp_then_race'){
        routed++;
        assert.ok(long < a.MIN_PEAK_LONG_KM.full + 0.55,
          v + ' km/wk over ' + w + 'wk was sent to an on-ramp although a straight race block ' +
          'would already have reached ' + long + ' km — the gate is refusing an athlete it should admit');
      }
    }
  }
  assert.ok(admitted > 10 && routed > 10,
    'the population must contain both sides of the line: ' + admitted + ' admitted, ' + routed + ' routed');
});

test('building without the gate can land below the floor, and nothing here prevents that', () => {
  /* STATED SO THAT NOBODY ASSUMES OTHERWISE. buildBlockWeeks() is a builder,
     not a gate: it develops whatever start volume it is given and never
     consults MIN_PEAK_LONG_KM. Any caller that skips athletePathway() can
     therefore produce a plan the viability contract would not admit. That is a
     property of the CALLER, not a defect in either constant, and this test
     exists so a future reader does not mistake one for the other. */
  const a = app();
  const below = deliveredPeakLong(a, 'full', 40, 16);
  assert.ok(below < a.MIN_PEAK_LONG_KM.full);
  assert.ok(below > 0, 'and it is a real plan, not a refusal — the builder does not gate');
});

test('genuinely insufficient preparation is still distinguishable', () => {
  const a = app();
  const tooShort = a.athletePathway('full', 51, 4);
  assert.equal(tooShort.route, 'insufficient_time');
  assert.ok(typeof tooShort.reason === 'string' && tooShort.reason.length > 0);
  /* And a window that IS enough is not refused. */
  assert.notEqual(a.athletePathway('full', 51, 16).route, 'insufficient_time');
  assert.notEqual(a.athletePathway('full', 70, 12).route, 'insufficient_time');
});

test('no other race distance depends on the marathon floor', () => {
  /* Each distance's floor is read only through its own key, so the four
     approved values are independent of one another. Asserted by perturbing the
     marathon entry and confirming nothing else answers differently. */
  const a = app();
  const before = ['5k', '10k', 'half', 'ultra'].map(d =>
    d + ':' + a.minViableStartKm(d, 16) + ':' + a.athletePathway(d, 40, 16).route).join('|');
  const real = a.MIN_PEAK_LONG_KM.full;
  a.MIN_PEAK_LONG_KM.full = 28;
  try {
    const after = ['5k', '10k', 'half', 'ultra'].map(d =>
      d + ':' + a.minViableStartKm(d, 16) + ':' + a.athletePathway(d, 40, 16).route).join('|');
    assert.equal(after, before);
    /* And it does move the marathon's own admission volume, which is what
       makes it the single lever. */
    assert.ok(a.minViableStartKm('full', 16) < 51,
      'lowering the marathon floor must lower the marathon admission volume');
  } finally { a.MIN_PEAK_LONG_KM.full = real; }
  assert.equal(a.MIN_PEAK_LONG_KM.full, real);
});
