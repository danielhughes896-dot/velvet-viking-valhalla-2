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
