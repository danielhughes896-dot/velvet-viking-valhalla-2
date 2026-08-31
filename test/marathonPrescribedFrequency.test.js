'use strict';
/* AVAILABILITY IS A CEILING; THE WEEK'S PURPOSES DECIDE THE FREQUENCY.
 *
 * Availability says what Valhalla is ALLOWED to use. It never says what to
 * prescribe.
 *
 * WHAT CHANGED WHEN THE WEEK STOPPED BEING DIVIDED. The coherent-frequency
 * band was the generator: it read the week's volume, its long run and its
 * quality session and chose a day count. Under bottom-up construction the week
 * is assembled from purposeful sessions and its volume is their sum, so
 * choosing a day count from the volume would be choosing it from a number the
 * day count itself produced.
 *
 * The band is therefore a DIAGNOSTIC now -- which is the role the methodology
 * gives long-run share too, and for the same reason. It still computes, it is
 * still recorded on the week, and where an assembled week falls outside it,
 * that is exactly the distortion it exists to report. What decides the day
 * count is what the week actually contains: one long run, the quality it
 * earned, and the supporting runs the athlete's own training justifies.
 *
 * These tests assert that architecture. They are not the old ones loosened.
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
  const runs = week.filter(d => d.km > 0);
  const easy = runs.filter(d => d.type === 'easy').map(d => d.km);
  const long = (runs.filter(d => d.type === 'long')[0] || { km: 0 }).km;
  return { a, blk, ds, week, runs: runs.length,
           optional: week.filter(d => d.availableUnused).length,
           easy, long,
           share: long > 0 && easy.length ? Math.max.apply(null, easy) / long : 0,
           range: (blk.weeks[wn - 1].frequencyEvidence || {}).coherent };
}

test('the week chooses its own frequency, and the answers are graded', () => {
  // Same six available days for every athlete below.
  const got = [8, 12, 15, 20, 25, 30, 40, 50, 60, 80].map(v => build(v, 15, 6).runs);
  assert.deepStrictEqual(got, [3, 4, 4, 4, 4, 4, 5, 5, 5, 5]);
  // The comparison HQ asked for: identical availability, different prescription.
  assert.notStrictEqual(build(12, 15, 6).runs, build(80, 15, 6).runs);
});

test('no hard cliff: a kilometre either side of a boundary moves sessions, not days', () => {
  /* The transition from four days to five sits between 30 and 40km. Walking
     across it one kilometre at a time, the day count may step ONCE and the
     session sizes must move continuously either side of it. */
  const seen = [];
  for (let v = 30; v <= 40; v++) seen.push(build(v, 15, 6).runs);
  const steps = seen.filter((n, i) => i > 0 && n !== seen[i - 1]).length;
  assert.ok(steps <= 1, 'day count stepped ' + steps + ' times across 30-40km: ' + seen.join(','));
  // monotone: more workload never buys FEWER prescribed days
  for (let i = 1; i < seen.length; i++)
    assert.ok(seen[i] >= seen[i - 1], 'frequency went backwards: ' + seen.join(','));
});

test('too-few-days concentration is detected and refused', () => {
  /* A 60km/week athlete on four days would carry ~19km supporting runs against
     a 21km long run. The range must exclude that, and the prescription must
     not land there. */
  const r = build(60, 15, 6);
  assert.ok(r.range && r.range.min >= 5,
    'four days is not coherent for this week: range ' + JSON.stringify(r.range));
  assert.ok(r.share <= 0.75,
    'supporting run is ' + Math.round(r.share * 100) + '% of the long run');
  const four = r.range.rows.filter(x => x.days === 4)[0];
  assert.ok(four && four.share > 0.75, 'the four-day row is what was refused');
});

test('too-many-days fragmentation is detected and refused', () => {
  /* A 25km/week athlete on six days would carry ~3km supporting runs against a
     9km long run -- runs that exist to occupy availability. */
  const r = build(25, 15, 6);
  assert.strictEqual(r.runs, 4);
  assert.ok(r.share >= 0.40,
    'supporting run is only ' + Math.round(r.share * 100) + '% of the long run');
  const six = r.range.rows.filter(x => x.days === 6)[0];
  assert.ok(six && six.share < 0.40, 'the six-day row is what was refused');
});

test('the 25km week is coherent in its own right', () => {
  const r = build(25, 15, 6);
  assert.strictEqual(r.optional, 2, 'the other two available days stay available');
  const runs = r.week.filter(d => d.km > 0);
  assert.ok(runs.some(d => d.type === 'long'), 'a long run');
  assert.ok(runs.some(d => ['tempo','threshold','interval','repetition'].includes(d.type)),
    'a quality session');
  assert.ok(r.easy.length >= 1, 'and real easy running');
  runs.forEach(d => assert.ok(d.km <= r.long, 'the long run stays the longest'));
});

test('demonstrated capacity chooses inside the range, and cannot leave it', () => {
  const r = build(50, 15, 6);
  assert.ok(r.range.min <= r.runs && r.runs <= r.range.max);
  // with no logged history the training-need answer is the smallest coherent one
  assert.strictEqual(r.runs, r.range.min);
  // and the range itself never offers more than the athlete made available
  [3, 4, 5].forEach(d => {
    const x = build(50, 15, d);
    assert.ok(x.runs <= d, d + ' available days must never become more');
    assert.ok(!x.range || x.range.max <= d);
  });
});

test('the band is derived from LONG_FRACTION, not chosen', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  const f = a.LONG_FRACTION['endurance'];
  const natural = d => (1 - f) / (f * (d - 1));
  // The band brackets the frequencies this architecture already treats as
  // normal -- four to six -- and excludes three.
  assert.ok(a.SUPPORT_SHARE_MAX > natural(4), 'four days must be inside');
  assert.ok(a.SUPPORT_SHARE_MAX < natural(3), 'three days must be outside');
  assert.ok(a.SUPPORT_SHARE_MIN < natural(6), 'six days must be inside');
});

test('there is no minimum run distance and no mileage lookup table', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.state = a.makeDefaultState();
  /* The decision is a ratio to the week's own long run, so it scales with the
     athlete. Doubling every distance in the week must not change the answer --
     which an absolute floor or a mileage table could not survive. */
  const small = a.coherentFrequencyRange(28, 9, 7, 1, 6);
  const big   = a.coherentFrequencyRange(56, 18, 14, 1, 6);
  assert.strictEqual(small.min, big.min);
  assert.strictEqual(small.max, big.max);
  // and it has no opinion where there is no long run to measure against
  assert.strictEqual(a.coherentFrequencyRange(28, 0, 7, 1, 6), null);
  assert.strictEqual(a.coherentFrequencyRange(0, 9, 7, 1, 6), null);
});

test('six remains the maximum, whatever the week wants', () => {
  [40, 60, 80, 120].forEach(v => {
    const r = build(v, 15, 6);
    assert.ok(r.runs <= 6, v + 'km/week prescribed ' + r.runs + ' days');
    assert.ok(!r.range || r.range.max <= 6);
  });
});

test('the days it does not prescribe stay available, not imposed as rest', () => {
  const low = build(25, 15, 6);
  assert.strictEqual(low.runs + low.optional, 6, 'availability is accounted for in full');
  low.week.filter(d => d.availableUnused).forEach(d => {
    assert.strictEqual(d.km, 0, 'an unused available day carries no distance');
    assert.ok(!d.prescription, 'and no prescription -- it is not training');
  });
});

test('the block carries the workload the athlete actually arrived with', () => {
  assert.strictEqual(build(37, 15, 6).blk.startVolume, 37);
});

test('no other race distance consults the marathon frequency authority', () => {
  ['5k', '10k', 'half', 'ultra'].forEach(d => {
    [8, 12, 20, 25, 50].forEach(v => {
      const { blk } = build(v, 15, 6, d);
      blk.weeks.forEach(w => {
        if (!w.frequencyEvidence) return;
        assert.strictEqual(w.frequencyEvidence.coherent, null,
          d + ' at ' + v + 'km/week must not consult the marathon frequency rule');
      });
    });
  });
  const { blk } = build(25, 15, 6, 'full');
  const wk = blk.weeks.filter(w => w.frequencyEvidence && !w.isRace)[0];
  assert.ok(wk.frequencyEvidence.coherent, 'and the marathon does');
  assert.strictEqual(wk.frequencyEvidence.availability, 6);
  assert.strictEqual(wk.runDayCap, 4);
});
