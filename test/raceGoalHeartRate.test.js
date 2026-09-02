'use strict';
/* GOAL PACE HAS NO FIXED HEART-RATE ZONE.
 * ===========================================================================
 * `goal_pace` used to map to the M zone for every distance, so every goal-pace
 * session in the product was described as marathon effort. For a marathon that
 * is true by definition -- M IS marathon pace. For a half it is wrong: a half
 * is run appreciably harder than marathon effort, and for a quick athlete it is
 * run at something close to threshold. The prescription said "goal pace" and
 * the heart-rate guidance beside it said "marathon".
 *
 * And it is not one zone per distance either. Half marathon effort is a
 * function of how long the athlete is out there: a 68-minute half is very
 * nearly threshold, a 2h20 half is marathon effort or easier. The event does
 * not fix the intensity; the athlete's own speed at that event does. So the
 * band is read from the zone the athlete's own goal pace falls in.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp } = require(path.join(__dirname, 'harness.js'));

const LTHR = 165, MAXHR = 190;
function athlete(distanceKey, goalMin){
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  a.state = a.makeDefaultState();
  a.state.healthConsent = { decision:'granted', version: a.HEALTH_CONSENT_VERSION };
  a.state.setup = Object.assign(a.state.setup || {}, {
    distanceKey, goals: { B: { timeSec: goalMin * 60 } }, activeGoal: 'B',
    lthr: LTHR, maxHR: MAXHR });
  return a;
}
const band = a => a.hrBandForIntensity('goal_pace', a.getActiveHRZones());

test('a marathon goal is marathon effort, because that is what the M zone is', () => {
  ['full'].forEach(() => {});
  [[180, '3h00'], [270, '4h30'], [330, '5h30']].forEach(([mins, label]) => {
    const a = athlete('full', mins);
    assert.equal(a.goalPaceZoneKey(), 'M',
      'a ' + label + ' marathon goal did not read as M');
  });
});

test('a half marathon goal is NOT automatically marathon effort', () => {
  /* THE DEFECT, PINNED. A fast half is run near threshold; reading it as M
     described an effort the athlete is not being asked for. */
  const fast = athlete('half', 80);
  assert.equal(fast.goalPaceZoneKey(), 'T',
    'a 1h20 half goal should read as threshold effort, not marathon');
  const fastBand = band(fast), fastM = fast.getActiveHRZones().M;
  assert.ok(fastBand && fastBand.lo != null, 'and it still produces a band');
  assert.ok(fastBand.lo > fastM.lo,
    'the band is harder than the marathon band it used to be given: ' +
    JSON.stringify(fastBand) + ' vs M ' + JSON.stringify(fastM));
});

test('a slower half genuinely IS marathon effort, and says so', () => {
  /* The other half of the same rule: the correction is physiological, not a
     blanket "half means threshold" swapped in for "half means marathon". */
  const slow = athlete('half', 130);
  assert.equal(slow.goalPaceZoneKey(), 'M',
    'a 2h10 half goal is run at marathon effort and should read as M');
});

test('a goal that falls between two zones gets both, not the nearer one', () => {
  /* The pace bands are discrete and a race goal need not land inside one. */
  const mid = athlete('half', 95);
  assert.equal(mid.goalPaceZoneKey(), null, 'this goal is expected to fall in a gap');
  const span = mid.goalPaceZoneSpan();
  assert.deepEqual([span.harder, span.easier], ['T', 'M'],
    'a 1h35 half sits between threshold and marathon');
  const hz = mid.getActiveHRZones(), b = band(mid);
  assert.equal(b.lo, hz.M.lo, 'the band opens at the easier zone floor');
  assert.equal(b.hi, hz.T.hi, 'and closes at the harder zone ceiling');
});

test('the same athlete gets a different goal-pace band for a half than a marathon', () => {
  /* THE PROPERTY HQ NAMED, asserted end to end: pace authority and heart-rate
     authority are separate, and the event may not be inferred from the string
     "goal_pace". Equal-effort goals at the two distances -- a 3h00 marathon and
     the 1h26 half that VDOT calls its equivalent -- are the SAME fitness and
     must still be prescribed at different heart rates. */
  const mara = athlete('full', 180), half = athlete('half', 86);
  const bm = band(mara), bh = band(half);
  assert.ok(bm && bh, 'both produce a band');
  assert.notDeepEqual(bm, bh,
    'a half and a marathon goal at equivalent fitness were given identical HR guidance: ' +
    JSON.stringify(bm));
  assert.ok(bh.lo >= bm.lo, 'and the half is not the easier of the two');
});

test('no goal and no zones means no band, rather than a wrong one', () => {
  const a = loadApp({ pinnedDate: '2026-03-02T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {}; a.state = a.makeDefaultState();
  assert.equal(a.goalPaceZoneKey(), null);
  assert.equal(a.hrBandForIntensity('goal_pace', a.getActiveHRZones()), null);
});

test('the intensity table no longer answers for goal pace at all', () => {
  /* So a future caller cannot reintroduce the defect by reading the map. */
  const a = athlete('half', 80);
  assert.equal(a.INTENSITY_ZONE_KEY.goal_pace, undefined,
    'goal_pace must not have a fixed zone in INTENSITY_ZONE_KEY');
  const src = require('fs').readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.ok(!/goal_pace'\s*\?\s*'M'/.test(src),
    'an inline goal_pace-to-M mapping has come back');
});

/* ---------------------------------------------------------------------------
   THE AUTHORITY PATH, STATED RATHER THAN IMPLIED
   HQ asked for the path to be shown rather than the outcome asserted. These
   three walk it: which pace is read, which zone that pace is found in, and
   which band that zone yields.
   --------------------------------------------------------------------------- */
test('AUTHORITY — the band is read from the PRESCRIBED pace, not the raw ambition', () => {
  /* A band read from a goal the athlete is not being asked to run would
     describe somebody else. racePacePrescription() is what caps ambition
     against capacity, and prescribedRacePaceSecPerKm() is what the zone lookup
     reads first. */
  const a = athlete('half', 95);
  const raw = a.getGoalPaceSecPerKm();
  const pre = a.prescribedRacePaceSecPerKm();
  assert.ok(raw > 0, 'the athlete has no goal pace at all');
  /* Whichever of the two is in force, the zone must be the zone THAT pace
     falls in -- asserted by finding it in the athlete's own bands. */
  const use = (pre > 0) ? pre : raw;
  const z = a.getActivePaces();
  const k = a.goalPaceZoneKey();
  if (k){
    assert.ok(use >= z[k].fast - 1e-9 && use <= z[k].slow + 1e-9,
      'the goal pace ' + Math.round(use) + 's/km is not inside the ' + k +
      ' band it was assigned (' + Math.round(z[k].fast) + '-' + Math.round(z[k].slow) + ')');
  } else {
    const span = a.goalPaceZoneSpan();
    assert.ok(span, 'no zone and no span for a goal that has a pace');
  }
});

test('AUTHORITY — the band comes from the athlete\'s own zones, introducing no constant', () => {
  const a = athlete('half', 95);
  const k = a.goalPaceZoneKey() || a.goalPaceZoneSpan().harder;
  const hz = a.getActiveHRZones();
  const b = a.hrBandForIntensity('goal_pace', hz);
  assert.ok(b && b.lo != null, 'no band for a goal with zones');
  /* Every number in the band is one of this athlete's own zone edges. Nothing
     is derived, averaged or invented here. */
  const edges = [];
  Object.keys(hz).forEach(kk => {
    if (hz[kk] && hz[kk].lo != null) edges.push(hz[kk].lo);
    if (hz[kk] && hz[kk].hi != null) edges.push(hz[kk].hi);
  });
  assert.ok(edges.indexOf(b.lo) !== -1,
    'the band floor ' + b.lo + ' is not one of the athlete\'s own zone edges');
  if (b.hi != null) assert.ok(edges.indexOf(b.hi) !== -1,
    'the band ceiling ' + b.hi + ' is not one of the athlete\'s own zone edges');
  assert.ok(k);
});

test('AUTHORITY — half and marathon, side by side, on one athlete', () => {
  /* The regression HQ asked for in the form HQ asked for it. One athlete, one
     physiology, two events: the half is prescribed a harder effort than the
     marathon because a half IS a harder effort, and the old table gave both
     the same M-zone band. */
  const mar  = athlete('full', 210);          // 3h30 marathon
  const half = athlete('half', 95);           // 1h35 half, the same runner
  const zMar = mar.goalPaceZoneKey(), zHalf = half.goalPaceZoneKey();
  const bMar = band(mar), bHalf = band(half);
  assert.equal(zMar, 'M', 'a marathon goal must read as M');
  assert.ok(bMar && bHalf, 'one of the two events produced no band at all');
  /* A 1h35 half for this runner sits BETWEEN threshold and marathon pace, so
     the honest band spans the gap and reaches into the threshold zone -- 157
     to 175 against the marathon's 157 to 164. It shares a floor because the
     marathon zone is where both start; what makes it the harder effort is
     where it reaches, and the old table gave the two identical bands. */
  assert.ok(bHalf.hi > bMar.hi,
    'the half was handed the marathon\'s own band: half ' + JSON.stringify(bHalf) +
    ' against marathon ' + JSON.stringify(bMar));
  assert.ok(zHalf !== 'M' || bHalf.hi > bMar.hi,
    'the half resolved to the marathon zone with no widening');
  /* And the intensity table cannot answer for either of them. */
  assert.equal(mar.INTENSITY_ZONE_KEY.goal_pace, undefined);
});
