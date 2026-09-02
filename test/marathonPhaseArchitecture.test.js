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
  /* THE HALF NOW SPENDS TWO CALENDAR WEEKS TOO, and for a different reason.
     Its taper is anchored to the EVENT at D-10 rather than to a week boundary,
     so the first of those two weeks is genuinely split -- the block's last
     loading days, then the first taper days -- and the phase count cannot say
     so on its own. What is asserted here is that neither distance spends a
     third calendar week winding down. */
  const h = phases(a, 15, 'half');
  assert.strictEqual(h.Taper + h.Final, 2);
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

/* ---- HQ'S PHASE GEOMETRY, WHICH IS THE RUNWAY'S AND NOT THE ATHLETE'S ----
   The three tests below asserted the compression hierarchy this architecture
   used to derive its phase lengths from: Base surrendered first, Build held at
   six until Base was gone, ten weeks and below carried no Base at all. HQ has
   since supplied the geometry directly, as a table indexed by runway, and it
   makes different choices -- every admitted runway carries a real Base, and
   Build compresses before Base is exhausted. The property being asserted is the
   same one: the phase lengths are a published, fixed function of the runway.
   What changed is whose function it is. */
const HQ_GEOMETRY = { 10:[2,4,2], 11:[2,5,2], 12:[3,5,2], 13:[3,5,3], 14:[3,6,3], 15:[4,6,3] };

test('every admitted runway carries a real Base phase', () => {
  const a = app();
  Object.keys(HQ_GEOMETRY).forEach(N => {
    assert.strictEqual(phases(a, +N, 'full').Base, HQ_GEOMETRY[N][0],
      N + ' weeks must carry HQ\'s Base');
    assert.ok(phases(a, +N, 'full').Base > 0,
      N + ' weeks must have a Base to prepare the athlete to Build');
  });
});

test('the geometry is HQ\'s table, and the taper is protected throughout', () => {
  const a = app();
  const base = [], build = [], peak = [], wind = [];
  for (let N = 10; N <= 15; N++){
    const p = phases(a, N, 'full');
    base.push(p.Base); build.push(p.Build); peak.push(p.Peak); wind.push(p.Taper + p.Final);
  }
  assert.strictEqual(base.join(','),  '2,2,3,3,3,4', 'Base');
  assert.strictEqual(build.join(','), '4,5,5,5,6,6', 'Build');
  assert.strictEqual(peak.join(','),  '2,2,2,3,3,3', 'Peak');
  assert.strictEqual(wind.join(','),  '2,2,2,2,2,2', 'the two-week taper is protected on every runway');
  /* AND EVERY ROW SUMS TO ITS OWN RUNWAY. A geometry that loses or invents a
     week is not a geometry. */
  for (let N = 10; N <= 15; N++){
    const p = phases(a, N, 'full');
    assert.strictEqual(p.Base + p.Build + p.Peak + p.Taper + p.Final, N, N + ' weeks');
  }
});

test('and the half reads the same table as the marathon', () => {
  /* HQ made the geometry a property of the runway rather than of the athlete or
     the event, so the two dedicated architectures cannot disagree about it. */
  const a = app();
  for (let N = 10; N <= 15; N++)
    ['novice', 'experienced', 'advanced'].forEach(e =>
      assert.strictEqual(JSON.stringify(a.raceGoalPhaseAllocation('half', N, e)),
                         JSON.stringify(a.raceGoalPhaseAllocation('full', N, e)),
                         N + ' weeks, ' + e + ': the two distances must allocate alike'));
});

test('no other distance and no other purpose changes', () => {
  /* THE HALF IS NO LONGER ONE OF THEM. It states its own phase counts now --
     3 Foundation / 6 Build / 4 Peak and an event-anchored wind-down -- and its
     own architecture test covers them. 5K, 10K and Ultra keep the arc they
     always had, byte for byte, until their own audits say otherwise. */
  const a = app();
  ['5k','10k','ultra'].forEach(d => {
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

test('surplus of three weeks or less spawns no block, and stretches nothing either', () => {
  /* THE SURPLUS USED TO GO INTO BASE, and HQ ruled that out: a sixteen,
     seventeen or eighteen week Race Goal is not a Race Goal with a longer Base,
     it is a Race Goal that has been stretched. Both halves of the old sentence
     still hold -- a surplus shorter than a block cannot become one -- and the
     race block now stays fifteen weeks whatever sits in front of it. */
  const a = app();
  [16, 17, 18].forEach(W => {
    const r = a.marathonRunwayPlan(W, 40);
    assert.strictEqual(r.preparatory, null, W + ' weeks must not spawn a stub block');
    assert.strictEqual(r.absorbWeeks, 0, W + ' weeks must absorb nothing');
    assert.strictEqual(r.raceWeeks, 15, W + ' weeks must still build a 15-week block');
    assert.strictEqual(r.startInWeeks, W - 15, W + ' weeks must say when Race Goal opens');
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
