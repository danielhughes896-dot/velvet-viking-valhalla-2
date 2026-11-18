'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* OVER-UNDER AS A FULL LIBRARY CITIZEN.
 * ===========================================================================
 * raceGoalOverUnderSpec() had been writing Over-Unders into Half and Marathon
 * Build with no WORKOUT_LIBRARY entry at all: Plan Evolution could not reduce
 * one, the Playbook could not reason about it, and the athlete got no
 * why/how/feel/avoid and no session-intent line for it. That is closed here,
 * and closed WITHOUT touching who receives one -- poolSelectable:false is the
 * whole of that guarantee.
 *
 * (The deuce retirement this file was first written alongside is NOT on this
 * branch. The pool deletion is held pending HQ's answer on what provides the
 * moderate VO2 stimulus instead -- the product's own plan-mathematics
 * ratchets measured the bare deletion as a regression. See the report.)
 */

const TODAY = '2026-11-01';
const RACES = [['5k', 45, 12], ['10k', 50, 12], ['half', 55, 14], ['full', 70, 16]];

function app(dk, vol, wk, purpose){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:dk, volume:vol, weeks:wk, lthr:172, maxHR:188,
                 startDate: a.addDays(TODAY, -35) });
  a.state.setup.purpose = purpose || 'race';
  return a;
}
/* A day carrying the prescription a plan built before the retirement would
   have carried. Nothing in the app can produce one any more, which is the
   point: this is what an athlete already holding one has. */
function legacyDeuce(a){
  const dd = a.state.days.filter(d => d.type === 'interval' && d.date >= TODAY)[0]
          || a.state.days.filter(d => d.type === 'interval')[0];
  assert.ok(dd, 'the fixture has no interval day to stand in for a legacy one');
  dd.prescription = { v:a.PRESCRIPTION_VERSION, archetype:'deuce',
                      params:{ sets:2, reps:4, m:400 } };
  dd.title = 'Deuce: 2x(4x400m)';
  return dd;
}

// ===========================================================================
// 3. OVER-UNDER IS NOW A FULL CITIZEN  (HQ requirement A)
// ===========================================================================

test('over_under has a library entry consistent with its own methodology', () => {
  const a = app('half', 55, 14);
  const e = a.WORKOUT_LIBRARY.over_under;
  assert.ok(e, 'over_under still has no library entry');
  assert.equal(e.stimulus, 'threshold');
  assert.equal(e.slot, 'tempo');
  // the locked 1km/1km geometry means cycles is the only movable parameter
  assert.deepEqual(Object.keys(e.params), ['cycles']);
  // and its bounds are read off the live constants, not chosen
  assert.equal(e.params.cycles.min, a.TAPER_MIN_OVER_UNDER_CYCLES);
  const tables = [a.HALF_BUILD_OVER_UNDER_CYCLES, a.MARATHON_BUILD_OVER_UNDER_CYCLES];
  const liveMax = Math.max(...tables.flatMap(t => Object.keys(t).flatMap(k => t[k])));
  assert.equal(e.params.cycles.max, liveMax, 'the ceiling is not the largest live cycle count');
});

test('it can now be progressed and reduced, one cycle at a time', () => {
  const a = app('half', 55, 14);
  const P = c => ({ v:a.PRESCRIPTION_VERSION, archetype:'over_under', params:{ cycles:c } });
  assert.equal(a.progressPrescription(P(3), { phase:'Build' }).prescription.params.cycles, 4);
  assert.equal(a.regressPrescription(P(3), { phase:'Build' }).prescription.params.cycles, 2);
  // and it stops at the live bounds
  assert.equal(a.regressPrescription(P(2), { phase:'Build' }).ok, false);
  assert.equal(a.progressPrescription(P(5), { phase:'Build' }).ok, false);
});

test('it explains itself, in every place every other workout does', () => {
  const a = app('half', 55, 14);
  assert.ok(a.ARCHETYPE_GUIDANCE.over_under, 'no long-form guidance');
  assert.ok(a.TERSE_GUIDANCE.over_under, 'no short-form guidance');
  assert.ok(a.SESSION_INTENT.over_under, 'no session-intent line');
  assert.ok(a.SESSION_INTENT_BY_TYPE.over_under, 'no fallback for a day whose prescription was dropped');
  const dd = a.state.days.filter(d => d.type !== 'rest' && d.date >= TODAY)[0];
  dd.type = 'over_under';
  dd.prescription = { v:a.PRESCRIPTION_VERSION, archetype:'over_under', params:{ cycles:3 } };
  const g = a.coachingEntryFor(dd);
  assert.ok(g && g.why && g.how && g.feel && g.avoid && g.cue && g.essential);
});

test('and NOTHING about who receives one has moved', () => {
  const a = app('half', 55, 14);
  // poolSelectable:false is the guarantee -- both candidate loops skip it
  assert.equal(a.WORKOUT_LIBRARY.over_under.poolSelectable, false);
  ['Base','Build','Peak','Taper'].forEach(ph =>
    ['5k','10k','half','full'].forEach(dk =>
      assert.equal(a.libraryCandidates({ phase:ph, distanceKey:dk })
                    .some(c => c.archetype === 'over_under'), false,
        'over_under became pool-selectable in ' + ph + '/' + dk)));
  // the spec writer's own gate is untouched: distance, Build phase, measured threshold
  const alloc = { base:4, build:6 };
  assert.equal(a.raceGoalOverUnderSpec('10k', 'experienced', 6, alloc), null, '10K became eligible');
  assert.equal(a.raceGoalOverUnderSpec('5k', 'experienced', 6, alloc), null, '5K became eligible');
  a.state.setup.thresholdPaceSource = null;
  assert.equal(a.raceGoalOverUnderSpec('half', 'experienced', 9, alloc), null,
    'the measured-threshold gate stopped applying');
  a.state.setup.thresholdPaceSource = 'calibration';
  const spec = a.raceGoalOverUnderSpec('half', 'experienced', 9, alloc);
  assert.ok(spec && spec.type === 'over_under' && spec.km === spec.cycles * 2);
});
