'use strict';
/* STAGE 2 -- AVAILABILITY IS A CEILING, NOT A PRESCRIPTION.
 *
 * Availability says what Valhalla is ALLOWED to use. Demonstrated workload
 * says what it can justify prescribing. The days between the two stay
 * available to the athlete as Optional Runs rather than becoming compulsory
 * running, and taking them is how the next block earns more.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp } = require(path.join(__dirname, 'harness.js'));

const TODAY = '2026-08-30';
const DAYSETS = { 2:[1,6], 3:[1,3,6], 4:[1,3,4,6], 5:[0,1,3,4,6], 6:[0,1,2,3,4,6] };

function build(volume, weeks, days, distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
  a.state = a.makeDefaultState();
  const schedule = { activeDays: DAYSETS[days], longRunDay: 6 };
  const blk = a.buildBlockWeeks(distanceKey || 'full', volume, weeks, {});
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
  const ds = a.buildDaysFromWeeks(blk, end, schedule, TODAY, true);
  let wn = 1;
  for (; wn <= blk.planWeeks; wn++) if (ds.filter(x => x.week === wn).length === 7) break;
  const week = ds.filter(x => x.week === wn);
  return { a, blk, ds, week,
           runs: week.filter(d => d.km > 0).length,
           optional: week.filter(d => d.availableUnused).length };
}

test('stated workload, not stated availability, sets initial frequency', () => {
  // Same six available days for every one of these athletes.
  const seen = [8, 12, 15, 20, 25, 50, 80].map(v => build(v, 15, 6).runs);
  assert.deepStrictEqual(seen, [2, 3, 4, 5, 6, 6, 6]);
  // The point of the test, stated as the comparison HQ asked for: a 12km/week
  // athlete and an 80km/week athlete may not receive the same prescription
  // from the same availability.
  assert.notStrictEqual(build(12, 15, 6).runs, build(80, 15, 6).runs);
});

test('the days it does not prescribe stay available, not imposed as rest', () => {
  const low = build(12, 15, 6);
  assert.strictEqual(low.runs, 3);
  assert.strictEqual(low.optional, 3, 'three available days the block has no run for');
  assert.strictEqual(low.runs + low.optional, 6, 'availability is accounted for in full');
  low.week.filter(d => d.availableUnused).forEach(d => {
    assert.strictEqual(d.km, 0, 'an unused available day carries no distance');
    assert.ok(!d.prescription, 'and no prescription -- it is not training');
  });
});

test('an established athlete is not made to re-earn a frequency they already hold', () => {
  const high = build(60, 15, 6);
  assert.strictEqual(high.runs, 6);
  assert.strictEqual(high.optional, 0);
});

test('the cap can only ever lower prescribed frequency', () => {
  // Fewer available days than the workload could support: availability still wins.
  [2, 3, 4, 5].forEach(d => {
    const r = build(80, 15, d);
    assert.strictEqual(r.runs, d, d + ' available days must never become more');
    assert.strictEqual(r.optional, 0);
  });
});

test('initialFrequencyCap introduces no constant of its own', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  // It is expressibleRunningDays() asked of the stated volume -- same function,
  // same floor, different question.
  [8, 12, 20, 40, 80].forEach(v => {
    assert.strictEqual(a.initialFrequencyCap('full', v, a.EASY_MIN_KM, true),
                       a.expressibleRunningDays('full', v, a.EASY_MIN_KM, true));
  });
  assert.strictEqual(a.initialFrequencyCap('full', 0, a.EASY_MIN_KM, true), null,
    'inert where the stated volume is unreadable');
  assert.strictEqual(a.initialFrequencyCap('full', null, a.EASY_MIN_KM, true), null);
});

test('the block carries the workload the athlete actually arrived with', () => {
  const { blk } = build(37, 15, 6);
  assert.strictEqual(blk.startVolume, 37);
});

test('no other race distance changes', () => {
  /* PROVED FROM THE BLOCK'S OWN RECORD rather than by inference. Every week
     reports which authorities were consulted; for any distance but the
     marathon the starting-workload authority is absent entirely, so it cannot
     have bound anything. */
  ['5k', '10k', 'half', 'ultra'].forEach(d => {
    [8, 12, 20, 25, 50].forEach(v => {
      const { blk } = build(v, 15, 6, d);
      blk.weeks.forEach(w => {
        if (!w.frequencyEvidence) return;
        assert.strictEqual(w.frequencyEvidence.initial, null,
          d + ' at ' + v + 'km/week must not consult the marathon frequency rule');
      });
    });
  });
  // and on the marathon it is present and is the thing that binds
  const { blk } = build(12, 15, 6, 'full');
  const wk = blk.weeks.filter(w => w.frequencyEvidence && !w.isRace)[0];
  assert.strictEqual(wk.frequencyEvidence.initial, 3);
  assert.strictEqual(wk.runDayCap, 3);
  assert.strictEqual(wk.frequencyEvidence.availability, 6);
});

test('a low-volume athlete still gets a coherent week, not a stripped one', () => {
  const r = build(12, 15, 6);
  const runs = r.week.filter(d => d.km > 0);
  const long = runs.filter(d => d.type === 'long')[0];
  assert.ok(long, 'the week still has a long run');
  runs.forEach(d => assert.ok(d.km >= 3, 'no token runs: ' + d.km + 'km'));
  assert.ok(runs.every(d => d.km <= long.km), 'the long run is still the longest');
});
