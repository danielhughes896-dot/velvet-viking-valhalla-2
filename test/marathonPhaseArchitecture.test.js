'use strict';
/* STAGE 1 -- MARATHON RUNWAY AND PHASE ARCHITECTURE.
 *
 * The dedicated marathon window is flat fifteen weeks, its phases are counts
 * rather than fractions of the block, and surplus runway belongs to a
 * different programme. These assert the methodology, not the implementation:
 * every number below is one HQ ruled on or one the engine already held.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { loadApp } = require(path.join(__dirname, 'harness.js'));

function app(){ const a = loadApp({ pinnedDate:'2026-08-30T09:00:00Z' });
  a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
  a.state = a.makeDefaultState(); return a; }

function phases(a, N, distKey){
  const c = { Base:0, Build:0, Peak:0, Taper:0, Final:0 };
  for (let w = 1; w <= N; w++) c[a.phaseForWeek(w, N, 'race', distKey)]++;
  return c;
}

test('the full marathon window is Base 4 / Build 6 / Peak 3 / Taper 2', () => {
  const a = app();
  assert.strictEqual(a.MARATHON_DEDICATED_WEEKS, 15);
  const p = phases(a, 15, 'full');
  assert.strictEqual(p.Base, 4);
  assert.strictEqual(p.Build, 6);
  assert.strictEqual(p.Peak, 3);
  // Taper is two CALENDAR weeks and race week is the second of them.
  assert.strictEqual(p.Taper + p.Final, 2);
  assert.strictEqual(p.Final, 1);
});

test('the marathon wind-down is D-14, not the D-20 it was', () => {
  const a = app();
  const p = phases(a, 15, 'full');
  const windDownWeeks = p.Taper + p.Final;
  assert.strictEqual(windDownWeeks, 2, 'two calendar weeks of wind-down');
  // The half marathon, untouched, still spends three.
  const h = phases(a, 15, 'half');
  assert.strictEqual(h.Taper + h.Final, 3);
});

test('marathon phases are counts, so a longer plan does not grow Peak', () => {
  const a = app();
  [15, 16, 20, 24, 30].forEach(N => {
    const p = phases(a, N, 'full');
    assert.strictEqual(p.Peak, 3, N + ' weeks must still peak for three');
    assert.strictEqual(p.Build, 6, N + ' weeks must still build for six');
    assert.strictEqual(p.Taper + p.Final, 2, N + ' weeks must still taper for two');
  });
  // and the surplus lands in Base, never in Peak
  assert.strictEqual(phases(a, 24, 'full').Base, 13);
});

test('ten weeks and below carry no dedicated Base phase', () => {
  const a = app();
  [4, 6, 8, 9, 10].forEach(N => {
    assert.strictEqual(phases(a, N, 'full').Base, 0, N + ' weeks must have no Base');
  });
  // eleven is the first runway that can afford one... and still cannot.
  assert.strictEqual(phases(a, 11, 'full').Base, 0);
  assert.strictEqual(phases(a, 12, 'full').Base, 1);
});

test('compression surrenders Base first and protects Peak and taper', () => {
  const a = app();
  const base = [], peak = [], wind = [];
  for (let N = 11; N <= 15; N++){
    const p = phases(a, N, 'full');
    base.push(p.Base); peak.push(p.Peak); wind.push(p.Taper + p.Final);
  }
  assert.deepStrictEqual(base.join(','), '0,1,2,3,4', 'Base absorbs the shortage');
  assert.deepStrictEqual(peak.join(','), '3,3,3,3,3', 'Peak is protected');
  assert.deepStrictEqual(wind.join(','), '2,2,2,2,2', 'the taper is protected');
});

test('Build only compresses once Base is gone', () => {
  const a = app();
  for (let N = 11; N <= 15; N++) assert.strictEqual(phases(a, N, 'full').Build, 6);
  assert.strictEqual(phases(a, 10, 'full').Build, 6);
  assert.strictEqual(phases(a, 9, 'full').Build, 5);
  assert.strictEqual(phases(a, 8, 'full').Build, 4);
});

test('no other distance and no other purpose changes', () => {
  const a = app();
  ['5k','10k','half','ultra'].forEach(d => {
    for (let N = 4; N <= 30; N++){
      const withKey = phases(a, N, d), without = phases(a, N, undefined);
      assert.strictEqual(JSON.stringify(withKey), JSON.stringify(without),
        d + ' at ' + N + ' weeks must be the arc it always had');
    }
  });
  // and a non-race purpose at the marathon distance is untouched too
  for (let N = 4; N <= 20; N++){
    assert.strictEqual(a.phaseForWeek(N, 20, 'base', 'full'),
                       a.phaseForWeek(N, 20, 'base', undefined));
  }
});

test('surplus of three weeks or less is absorbed, not made into a block', () => {
  const a = app();
  [16, 17, 18].forEach(W => {
    const r = a.marathonRunwayPlan(W, 40);
    assert.strictEqual(r.preparatory, null, W + ' weeks must not spawn a stub block');
    assert.strictEqual(r.absorbWeeks, W - 15);
    assert.strictEqual(r.raceWeeks, W);
  });
});

test('surplus of four weeks or more becomes a real development block', () => {
  const a = app();
  const r = a.marathonRunwayPlan(24, 40);
  assert.ok(r.preparatory, 'nine surplus weeks are a development block');
  assert.strictEqual(r.preparatory.weeks, 9);
  assert.strictEqual(r.raceWeeks, 15, 'the race block does not stretch');
  assert.ok(['base','speed'].includes(r.preparatory.purpose));
});

test('a development block is capped rather than allowed to dilute', () => {
  const a = app();
  const r = a.marathonRunwayPlan(40, 40);
  assert.strictEqual(r.preparatory.weeks, a.MARATHON_PREP_BLOCK_MAX);
  assert.strictEqual(r.raceWeeks, 15);
});

test('the preparatory programme is chosen from evidence, not assumed', () => {
  const a = app();
  // Aerobic gap: below the volume from which a marathon block can reach a
  // 30km long run at all.
  const need = a.minViableStartKm('full', 15);
  const low = a.marathonRunwayPlan(24, Math.floor(need) - 10);
  assert.strictEqual(low.preparatory.purpose, 'base');
  assert.strictEqual(low.preparatory.reason, 'aerobic_gap');
  // Volume adequate, no demonstrated quality response.
  const high = a.marathonRunwayPlan(24, Math.ceil(need) + 10);
  assert.strictEqual(high.preparatory.purpose, 'speed');
  assert.strictEqual(high.preparatory.reason, 'quality_gap');
});

test('short runway is classified rather than refused', () => {
  const a = app();
  [4, 6, 8, 10].forEach(W => {
    const r = a.marathonRunwayPlan(W, 40);
    assert.strictEqual(r.shortened, true);
    assert.strictEqual(r.shape, 'no_base');
    assert.strictEqual(r.raceWeeks, W, 'never refuse the athlete a plan');
  });
  [11, 12, 14].forEach(W => {
    assert.strictEqual(a.marathonRunwayPlan(W, 40).shape, 'compressed');
  });
  assert.strictEqual(a.marathonRunwayPlan(15, 40).shortened, false);
});

test('the race destination survives, but the prescription does not', () => {
  const a = app();
  a.setRaceDestination('full', '2027-04-18', { A:{ timeSec: 4*3600 } }, 'A');
  const d = a.raceDestination();
  assert.strictEqual(d.distanceKey, 'full');
  assert.strictEqual(d.raceDate, '2027-04-18');
  assert.strictEqual(d.activeGoal, 'A');
  // fourteen weeks of blocks before race week -- the window opens at its start
  assert.strictEqual(d.transitionDate, a.addDays('2027-04-18', -98));
  // nothing about the plan itself is retained
  assert.ok(!('days' in d) && !('planWeeks' in d) && !('currentVolume' in d));
  assert.strictEqual(a.raceDestinationDue(), false, 'not due nine months out');
});

test('the destination becomes due when the dedicated window opens', () => {
  const a = app();
  const raceIn15 = a.addDays(a.todayStr(), 98);
  a.setRaceDestination('full', raceIn15, null, null);
  assert.strictEqual(a.raceDestinationDue(), true);
  a.setRaceDestination('full', a.addDays(a.todayStr(), 105), null, null);
  assert.strictEqual(a.raceDestinationDue(), false);
  // and a race already run is not a destination
  a.setRaceDestination('full', a.addDays(a.todayStr(), -1), null, null);
  assert.strictEqual(a.raceDestinationDue(), false);
});

test('a generated marathon block carries the new phase shape end to end', () => {
  const a = app();
  const blk = a.buildBlockWeeks('full', 50, 15, {});
  const counts = { Base:0, Build:0, Peak:0, Taper:0, Final:0 };
  blk.weeks.forEach(w => { counts[w.phase] = (counts[w.phase] || 0) + 1; });
  assert.strictEqual(counts.Base, 4);
  assert.strictEqual(counts.Build, 6);
  assert.strictEqual(counts.Peak, 3);
  assert.strictEqual(blk.taperWeeks, 1, 'one taper week plus race week');
});
