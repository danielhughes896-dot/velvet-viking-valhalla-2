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
    /* The builder passes both: bottom-up construction needs the day ceiling it
     may build purposes within and the pace that prices session cost. */
  const blk = a.buildBlockWeeks(distanceKey || 'full', volume, weeks,
    { availableDays: schedule.activeDays.length, easyPaceSecPerKm: 330 });
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
  const got = [8, 12, 20, 25, 40, 50, 60, 80].map(v => build(v, 15, 6).runs);
  for (let i = 1; i < got.length; i++)
    assert.ok(got[i] >= got[i - 1], 'frequency went backwards: ' + got.join(','));
  assert.ok(got[0] < got[got.length - 1],
    'an 8km/week athlete and an 80km/week athlete must not get the same week');
  got.forEach(n => assert.ok(n >= 2 && n <= 6));
});

test('session cost decides the day count, which a ratio could not', () => {
  /* THE DISCRIMINATION THAT MATTERS. The same kilometres cost a slower athlete
     more time, so their work needs spreading further -- and a shape ratio is
     blind to it, because the shape is identical. */
  const runsAt = (v, pace) => {
    const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
    a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
    a.state = a.makeDefaultState();
    const S = { activeDays: DAYSETS[6], longRunDay: 6 };
    const blk = a.buildBlockWeeks('full', v, 15, { availableDays: 6, easyPaceSecPerKm: pace });
    const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
    const ds = a.buildDaysFromWeeks(blk, end, S, TODAY, true, { easyPaceSecPerKm: pace });
    let wn = 1; for (; wn <= blk.planWeeks; wn++) if (ds.filter(x => x.week === wn).length === 7) break;
    return ds.filter(x => x.week === wn && x.km > 0).length;
  };
  assert.ok(runsAt(50, 560) > runsAt(50, 300),
    'a 5h30 athlete needs more days than a 3h00 one for the same kilometres');
});

test('an extra day is extra training, so days are not spent for nothing', () => {
  /* Under bottom-up a supporting day develops on its own progression, so days
     spend the athlete's development ceiling -- and what they spend, the long
     run does not get. */
  [25, 40, 50].forEach(v => {
    const r = build(v, 15, 6);
    assert.ok(r.runs < 6, v + 'km/week consumed all six available days');
    assert.ok(r.optional > 0, 'and the rest stay available rather than imposed');
  });
});

test('availability is still a ceiling that is never exceeded', () => {
  [2, 3, 4, 5, 6].forEach(d => {
    [25, 50, 80].forEach(v => {
      const r = build(v, 15, d);
      assert.ok(r.runs <= d, v + 'km at ' + d + ' available got ' + r.runs + ' runs');
    });
  });
});

test('the coherent band is now a diagnostic, and the purposes are the generator', () => {
  const { blk } = build(50, 15, 6);
  const wk = blk.weeks.filter(w => w.frequencyEvidence && !w.isRace)[0];
  assert.ok(wk.frequencyEvidence, 'the evidence is still recorded');
  assert.strictEqual(wk.frequencyEvidence.availability, 6);
  assert.ok(wk.bottomUp, 'and the week states what it was built from');
  assert.strictEqual(wk.runDayCap, 1 + wk.bottomUp.qSlots + wk.bottomUp.supportDays,
    'the day count is the purposes, not the band');
});

test('no other race distance is built bottom-up', () => {
  ['5k', '10k', 'half', 'ultra'].forEach(d => {
    [12, 25, 50].forEach(v => {
      const { blk } = build(v, 15, 6, d);
      blk.weeks.forEach(w => assert.strictEqual(w.bottomUp, null,
        d + ' at ' + v + 'km must keep the architecture it had'));
    });
  });
  const { blk } = build(50, 15, 6, 'full');
  assert.ok(blk.weeks.some(w => w.bottomUp), 'and the marathon does not');
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

