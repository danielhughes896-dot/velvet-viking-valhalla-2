'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* A HILL SESSION IS A HILL SESSION
 * ===========================================================================
 * The audit found hill_repeats delivering about 2.9 hard minutes where every
 * other structure in the interval SLOT delivers eight to forty, and 160 of the
 * 166 dose steps over 2x involving it.
 *
 * The resolution is not to inflate the workout. WORKOUT_LIBRARY already
 * classifies it as stimulus 'strength' -- "Strength and aerobic power without
 * the pounding of flat speed work" -- which is a different training aim from
 * the 'vo2' sessions that share the slot with it. Its low dose is deliberate.
 *
 * What was untrue was the ACCOUNTING: dd.type is 'interval', so the day was
 * costed at COACH_LOAD_FACTOR.interval, a figure higher than any session in
 * the library actually derives from its own composition.
 */
const TODAY = '2026-03-02';
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  return a;
}
function block(a, opts){
  const o = Object.assign({ distanceKey: '10k', volume: 50, weeks: 16 }, opts || {});
  const schedule = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };
  /* A REAL ATHLETE, because the derivation below prices timed work through
     their own pace zones. Without a benchmark every intensity falls back to
     the nominal easy pace and a hill repetition costs what a jog costs. */
  buildPlan(a, { distanceKey: o.distanceKey, volume: o.volume, weeks: o.weeks,
                 startDate: TODAY, schedule: schedule });
  const start = TODAY;
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), o.weeks * 7 - 1);
  const blk = a.buildBlockWeeks(o.distanceKey, o.volume, o.weeks, { purpose: o.purpose || 'race' });
  return { blk, days: a.buildDaysFromWeeks(blk, end, schedule, start, false), schedule };
}
const hillDay = days => days.filter(d =>
  d.prescription && d.prescription.archetype === 'hill_repeats')[0] || null;

// ---------------------------------------------------------------------------
// THE PRESCRIPTION IS UNTOUCHED
// ---------------------------------------------------------------------------
test('the workout itself was not inflated to satisfy a dose metric', () => {
  const a = app();
  /* The library's declared shape: repetitions may progress, the rep DURATION
     is fixed because it is part of what a hill repeat is. */
  const lib = a.WORKOUT_LIBRARY.hill_repeats;
  assert.equal(lib.params.sec.fixed, true, 'hill duration is identity, not a dial');
  assert.equal(lib.params.reps.min, 3);
  assert.equal(lib.params.reps.max, 12);
  assert.equal(lib.progressField, 'reps');

  /* And the structure the generator actually writes, at both ends of pos. */
  assert.equal(JSON.stringify(a.structHillRepeats(0, 'speed')),
               JSON.stringify({ reps: 5, hillSec: 35, t: 'interval' }));
  assert.equal(JSON.stringify(a.structHillRepeats(1, 'speed')),
               JSON.stringify({ reps: 8, hillSec: 60, t: 'interval' }));
  /* Five by thirty-five seconds is a small session and is meant to be. */
  const { days } = block(a);
  const hd = hillDay(days);
  assert.ok(hd, 'the fixture delivers a hill session');
  assert.equal(JSON.stringify(hd.prescription.params), JSON.stringify({ reps: 5, sec: 35 }));
});

// ---------------------------------------------------------------------------
// THE CLASSIFICATION IS TRUTHFUL
// ---------------------------------------------------------------------------
test('the library already says what a hill session trains, and it is not vo2', () => {
  const a = app();
  const L = a.WORKOUT_LIBRARY;
  assert.equal(L.hill_repeats.stimulus, 'strength');
  assert.equal(L.hill_repeats.varietyGroup, 'strength');
  ['track_reps', 'ladder', 'deuce'].forEach(k =>
    assert.equal(L[k].stimulus, 'vo2', k + ' is the conventional interval session'));
  assert.equal(L.fartlek.stimulus, 'aerobic_power');
  assert.equal(L.short_reps.stimulus, 'speed');
  assert.equal(L.goal_pace_reps.stimulus, 'race_specific');
  /* Five different training aims inside one UI type -- which is why measuring
     "the interval family's progression" pooled unlike stimuli. */
  assert.equal(a.PLAYBOOK_STIMULUS_NOUN.strength, 'hill work');
  assert.equal(a.PLAYBOOK_STIMULUS_NOUN.vo2, 'interval work');
});

test('its training cost is declared from its own composition, not from its type', () => {
  const a = app();
  const { days } = block(a);
  const hd = hillDay(days);
  hd.completed = true;
  hd.actual = Object.assign(a.emptyActual(), { km: hd.km });

  const declared = a.ARCHETYPES.hill_repeats.exec.load;
  assert.equal(declared, 1.08);
  assert.ok(declared < a.COACH_LOAD_FACTOR.interval,
    'the broad type charged ' + a.COACH_LOAD_FACTOR.interval + ' for a session made of ' +
    declared);
  assert.equal(a.coachDayLoad(hd), Math.round(hd.km * declared * 1e9) / 1e9,
    'the day is costed at what it is made of');

  /* THE DERIVATION, RECOMPUTED HERE FROM THE SESSION'S OWN SEGMENTS, using
     only COACH_LOAD_FACTOR and the app's own walker -- so the declared figure
     cannot drift into being a number somebody chose. The identical derivation
     reproduces easy_strides' long-standing 1.05, which is the evidence that
     the method is the product's own rather than this test's. */
  const BUCKET_TYPE = { easy: 'easy', threshold: 'threshold', interval: 'interval', mp: 'tempo' };
  const derive = dd => {
    const mix = a.segmentDistanceMix(a.orderedSegments(a.prescriptionOf(dd)));
    let num = 0, den = 0;
    Object.keys(mix.byIntensity).forEach(i => {
      const km = mix.byIntensity[i];
      num += km * a.COACH_LOAD_FACTOR[BUCKET_TYPE[a.INTENSITY_ZONE_BUCKET[i] || 'easy'] || 'easy'];
      den += km;
    });
    const rest = Math.max(0, (dd.km || 0) - den);
    return (num + rest * a.COACH_LOAD_FACTOR.easy) / (den + rest);
  };
  const derived = derive(hd);
  assert.ok(Math.abs(derived - declared) / declared <= 0.05,
    'declared ' + declared + ' against a derived ' + derived.toFixed(3));

  const strides = days.filter(d => d.prescription &&
    d.prescription.archetype === 'easy_strides')[0];
  if (strides){
    const sd = derive(strides);
    assert.ok(Math.abs(sd - a.ARCHETYPES.easy_strides.exec.load) /
              a.ARCHETYPES.easy_strides.exec.load <= 0.05,
      'the same derivation must reproduce easy_strides\' 1.05, and gives ' + sd.toFixed(3));
  }
});

test('but the effort it asks for is not talked down', () => {
  /* The neuromuscular demand stays visible. Effort is peak-weighted -- an
     athlete rates a session by its hardest part -- and a thirty-five second
     hill repetition genuinely is a seven-to-nine. Only the COST was wrong. */
  const a = app();
  const { days } = block(a);
  const hd = hillDay(days);
  assert.equal(a.expectedRPEBand(hd).join('-'), '7-9', 'still a hard effort');
  assert.equal(a.executionWeightForDay(hd), 2.0, 'still full evidence weight');
  assert.equal(a.isRecoveryLikeDay(hd), false, 'not a recovery session');
  assert.equal(a.sessionImportance(hd), 'KEY', 'still a key session');
  assert.equal(a.isQualityType(hd.type), true, 'still hard running');
});

// ---------------------------------------------------------------------------
// IT CANNOT BUY ANYTHING
// ---------------------------------------------------------------------------
test('a hill session consumes the week\'s quality slot rather than freeing one', () => {
  const a = app();
  const { blk, days } = block(a);
  const hd = hillDay(days);
  const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'calibration'];
  const week = days.filter(d => d.week === hd.week && d.km > 0);
  const hard = week.filter(d => QUALITY.indexOf(d.type) !== -1);
  assert.ok(hard.some(d => d.date === hd.date), 'the hill session IS one of the hard sessions');
  assert.ok(hard.length <= a.qualitySlotCeilingForDayCount(week.length),
    'and the week is still inside the aerobic-dominance ceiling');
  /* Load is not permission: nothing that decides quality FREQUENCY reads it. */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = src.slice(src.indexOf('function secondQualityExposurePermission'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  ['coachDayLoad', 'COACH_LOAD_FACTOR', 'exec.load'].forEach(t =>
    assert.equal(body.indexOf(t), -1,
      'the second-exposure permission must not read ' + t));
});

test('every other interval structure is unchanged', () => {
  const a = app();
  ['track_reps', 'ladder', 'deuce', 'goal_pace_reps', 'fartlek', 'short_reps'].forEach(k => {
    const meta = a.ARCHETYPES[k] || {};
    assert.equal(meta.exec, undefined,
      k + ' must keep its type\'s cost — only the two archetypes whose type is ' +
      'wrong about them declare their own');
  });
  assert.equal(JSON.stringify(a.structTrackIntervals(0.5, 'threshold')),
               JSON.stringify({ reps: 6, m: 700, t: 'interval' }));
  assert.equal(JSON.stringify(a.structFartlek(0, 'speed')),
               JSON.stringify({ reps: 5, fartlekMin: 2, t: 'interval' }));
});

// ---------------------------------------------------------------------------
// AND THE PROGRESSION IS NOT BROKEN
// ---------------------------------------------------------------------------
test('within one stimulus, the dose progresses coherently', () => {
  /* THE MEASUREMENT THE AUDIT GOT WRONG, CORRECTED. A session compared with
     the previous session OF THE SAME STIMULUS is a progression; compared with
     a different stimulus it is a change of training aim, and reading the
     second as the first is what produced the reported fourfold Base->Build
     step. */
  const a = app();
  const { blk, days } = block(a);
  const stim = dd => {
    const p = dd.prescription, e = p && a.WORKOUT_LIBRARY[p.archetype];
    return e ? e.stimulus : null;
  };
  const hardSec = dd => {
    let s = 0;
    try {
      const m = a.segmentDistanceMix(a.orderedSegments(a.prescriptionOf(dd)));
      Object.keys(m.timeByIntensity).forEach(i => { if (i !== 'easy') s += m.timeByIntensity[i]; });
    } catch (e){}
    return s;
  };
  const per = {};
  days.filter(d => d.km > 0 && ['interval', 'repetition'].indexOf(d.type) !== -1)
      .forEach(d => { const st = stim(d); if (st) (per[st] = per[st] || []).push(hardSec(d)); });

  let steps = 0, big = 0;
  Object.keys(per).forEach(st => {
    const v = per[st];
    for (let i = 1; i < v.length; i++){
      if (!(v[i - 1] > 0)) continue;
      steps++;
      if (v[i] / v[i - 1] > 2) big++;
    }
  });
  assert.ok(steps > 0, 'the fixture must produce at least one within-stimulus step');
  assert.equal(big, 0,
    'a step of more than 2x inside one stimulus: ' + JSON.stringify(per));

  /* And the pooled reading, which is the one that looked broken, is shown to
     be a comparison ACROSS stimuli rather than a progression within one. */
  const all = days.filter(d => d.km > 0 && ['interval', 'repetition'].indexOf(d.type) !== -1);
  const distinct = new Set(all.map(stim).filter(Boolean));
  assert.ok(distinct.size >= 3,
    'the interval slot delivers ' + distinct.size + ' different stimuli in one block: ' +
    [...distinct].join(', '));
});

test('and a hill session is still available in Base', () => {
  const a = app();
  const { blk, days } = block(a);
  const hd = hillDay(days);
  assert.ok(hd, 'hill repeats are still prescribed');
  assert.equal(blk.weeks[hd.week - 1].phase, 'Base');
  assert.equal(a.WORKOUT_LIBRARY.hill_repeats.phase.Base, 'preferred');
});
