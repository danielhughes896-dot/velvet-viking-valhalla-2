'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PROVIDER WORKOUT / SCHEDULED TRAINING / RECONCILIATION.
//
// The canonical machine contract, and the thing an integration is allowed to
// read. Its whole value rests on two properties that have to be proven rather
// than assumed:
//
//   1. it says exactly what the prescription says -- no quantity lost, none
//      invented, cardinality and order intact
//   2. it says the same thing regardless of what the athlete set their units
//      to, because a display preference must never reach a device
//
// Everything else here -- fingerprints, reconciliation, the fail-closed gate --
// exists so a future sync cannot duplicate an athlete's calendar or send a
// workout Valhalla did not prescribe.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-05-20';

const CASES = {
  easy_run:             { params:{km:9},                         type:'easy' },
  shakeout:             { params:{km:5},                         type:'easy' },
  long_run:             { params:{km:20},                        type:'long' },
  long_run_b2b:         { params:{km:16},                        type:'long' },
  long_run_goal_finish: { params:{km:23, finishKm:6},            type:'long' },
  race:                 { params:{km:42.2},                      type:'race' },
  time_trial:           { params:{ttKm:5, flankKm:2},            type:'checkpoint' },
  threshold_continuous: { params:{km:5},                         type:'threshold' },
  goal_pace_block:      { params:{km:10},                        type:'tempo' },
  steady_tempo:         { params:{min:20},                       type:'tempo' },
  progressive_tempo:    { params:{min:25},                       type:'tempo' },
  split_tempo:          { params:{min:24, split:2},              type:'tempo' },
  track_reps:           { params:{reps:5, m:1000},               type:'interval' },
  short_reps:           { params:{reps:8, m:400},                type:'repetition' },
  goal_pace_reps:       { params:{reps:4, m:1600},               type:'tempo' },
  ladder:               { params:{rungs:[400,800,1200,800,400]}, type:'interval' },
  deuce:                { params:{sets:2, reps:4, m:400},        type:'interval' },
  hill_repeats:         { params:{reps:8, sec:45},               type:'interval' },
  fartlek:              { params:{reps:5, min:2},                type:'interval' },
  easy_strides:         { params:{easyKm:8, reps:6, m:100},      type:'easy' }
};
const NAMES = Object.keys(CASES);

function app(units) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays(TODAY, -28), distanceKey: 'full',
                 volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: 'full', timeSec: 3 * 3600 + 15 * 60 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 } };
  a.state.setup.lthr = 172;
  a.state.setup.maxHR = 197;
  if (units) a.state.units = units;
  return a;
}
const day = (a, n) => ({ id: 'd-' + n, date: TODAY, type: CASES[n].type, km: 10,
  title: n, desc: '',
  prescription: { v: a.PRESCRIPTION_VERSION, archetype: n,
                  params: JSON.parse(JSON.stringify(CASES[n].params)) } });

// Every leaf step, in order, with repeats left as nodes.
function walk(steps, fn, inRepeat) {
  (steps || []).forEach(s => {
    if (s.kind === 'repeat') { fn(s, inRepeat); return walk(s.steps, fn, true); }
    fn(s, inRepeat);
  });
}
function leaves(steps) { const out = []; walk(steps, s => { if (s.kind === 'step') out.push(s); }); return out; }
// Segment-tree leaves, for the both-directions comparison.
function segLeaves(segs, out) {
  out = out || [];
  (segs || []).forEach(s => { if (s.kind === 'repeat') segLeaves(s.children, out); else out.push(s); });
  return out;
}

// ---- 1. COVERAGE -----------------------------------------------------------

test('every archetype produces a canonical workout', () => {
  const a = app();
  const missing = NAMES.filter(n => !a.providerWorkout(day(a, n)));
  assert.equal(missing.join(','), '', 'no canonical workout for: ' + missing.join(', '));
});

test('a day with no prescription produces nothing, rather than an empty workout', () => {
  const a = app();
  assert.equal(a.providerWorkout({ id: 'x', date: TODAY, type: 'easy', km: 8, title: 't' }), null);
});

// ---- 2. NOTHING LOST, NOTHING INVENTED -------------------------------------

test('every prescribed quantity reaches the canonical workout', () => {
  const a = app();
  NAMES.forEach(n => {
    const dd = day(a, n);
    const segs = segLeaves(a.segmentsFor(a.prescriptionOf(dd)));
    const got = leaves(a.providerWorkout(dd).workout.steps);
    assert.equal(got.length, segs.length, n + ': step count differs from the segment tree');
    segs.forEach((seg, i) => {
      const d = got[i].duration;
      if (seg.km != null) {
        assert.equal(d.type, 'distance', n + '[' + i + ']: km segment is not a distance step');
        assert.equal(d.metres, Math.round(seg.km * 1000), n + '[' + i + ']: distance changed');
      } else if (seg.m != null) {
        assert.equal(d.type, 'distance');
        assert.equal(d.metres, seg.m, n + '[' + i + ']: a metre value was converted');
      } else if (seg.sec != null) {
        assert.equal(d.type, 'time');
        if (Array.isArray(seg.sec)) {
          assert.equal(d.secondsLow, Math.min(seg.sec[0], seg.sec[1]));
          assert.equal(d.secondsHigh, Math.max(seg.sec[0], seg.sec[1]));
        } else {
          assert.equal(d.seconds, seg.sec, n + '[' + i + ']: duration changed');
        }
      } else {
        assert.equal(d.type, 'open', n + '[' + i + ']: an unquantified segment gained a quantity');
      }
    });
  });
});

test('no step invents a distance or a duration', () => {
  // The inverse: every numeric duration in the DTO must trace to a segment.
  const a = app();
  NAMES.forEach(n => {
    const dd = day(a, n);
    const segs = segLeaves(a.segmentsFor(a.prescriptionOf(dd)));
    const allowedM = new Set(), allowedS = new Set();
    segs.forEach(s => {
      if (s.km != null) allowedM.add(Math.round(s.km * 1000));
      if (s.m != null) allowedM.add(s.m);
      if (s.sec != null) (Array.isArray(s.sec) ? [a.segSeconds(s.sec)] : [s.sec]).forEach(v => allowedS.add(v));
    });
    leaves(a.providerWorkout(dd).workout.steps).forEach(st => {
      if (st.duration.type === 'distance')
        assert.ok(allowedM.has(st.duration.metres), n + ': invented ' + st.duration.metres + 'm');
      if (st.duration.type === 'time')
        assert.ok(allowedS.has(st.duration.seconds), n + ': invented ' + st.duration.seconds + 's');
    });
  });
});

test('roles survive: a warm-up is a warm-up and a cool-down is a cool-down', () => {
  const a = app();
  NAMES.forEach(n => {
    const dd = day(a, n);
    const segs = segLeaves(a.segmentsFor(a.prescriptionOf(dd)));
    const got = leaves(a.providerWorkout(dd).workout.steps);
    segs.forEach((seg, i) => {
      const want = seg.role || (seg.kind === 'recovery' ? 'recovery' : 'work');
      assert.equal(got[i].role, want, n + '[' + i + ']: role changed');
      assert.equal(got[i].intensity, seg.intensity, n + '[' + i + ']: intensity changed');
    });
  });
});

// ---- 3. CARDINALITY AND STRUCTURE ------------------------------------------

test('repeat iterations come from the prescription', () => {
  const a = app();
  [['track_reps', 5], ['short_reps', 8], ['hill_repeats', 8],
   ['fartlek', 5], ['goal_pace_reps', 4], ['split_tempo', 2],
   ['easy_strides', 6]].forEach(([n, want]) => {
    const reps = [];
    walk(a.providerWorkout(day(a, n)).workout.steps, s => { if (s.kind === 'repeat') reps.push(s.iterations); });
    assert.ok(reps.indexOf(want) > -1, n + ': expected a repeat of ' + want + ', got ' + reps.join(','));
  });
});

test('recovery cardinality is carried, not silently added to', () => {
  /* "N x M with R recovery" is N reps and N-1 recoveries. A plain repeat group
     of [work, recovery] x N would give N, which is one recovery too many on
     most interval sessions -- so the child that must not happen on the final
     pass is flagged. Hill repeats are the exception the flag must NOT carry:
     the descent happens after every rep. */
  const a = app();
  const flagOf = (n, role) => {
    let found = null;
    walk(a.providerWorkout(day(a, n)).workout.steps, s => {
      if (s.kind === 'step' && s.role === role && found === null) found = !!s.omitOnFinalIteration;
    });
    return found;
  };
  assert.equal(flagOf('track_reps', 'recovery'), true, 'between-reps recovery is not flagged');
  assert.equal(flagOf('short_reps', 'recovery'), true);
  assert.equal(flagOf('fartlek', 'recovery'), true);
  assert.equal(flagOf('hill_repeats', 'recovery'), false,
    'the hill descent happens after EVERY rep and must not be omitted');
  // and no work step is ever flagged
  NAMES.forEach(n => walk(a.providerWorkout(day(a, n)).workout.steps, s => {
    if (s.kind === 'step' && s.role !== 'recovery')
      assert.ok(!s.omitOnFinalIteration, n + ': a non-recovery step was flagged for omission');
  }));
});

test('nested repeats keep BOTH counts', () => {
  // 2 sets of 4x400m is not 8x400m: the set recovery makes them different
  // sessions, and flattening would be the export rewriting the prescription.
  const a = app();
  const w = a.providerWorkout(day(a, 'deuce')).workout;
  const outer = w.steps.find(s => s.kind === 'repeat');
  assert.ok(outer, 'no outer repeat');
  assert.equal(outer.iterations, 2, 'set count lost');
  const inner = outer.steps.find(s => s.kind === 'repeat');
  assert.ok(inner, 'the inner repeat was flattened away');
  assert.equal(inner.iterations, 4, 'rep count lost');
  const work = inner.steps.find(s => s.role === 'work');
  assert.equal(work.duration.metres, 400);
  // the between-sets recovery is a sibling of the inner repeat, not inside it
  assert.ok(outer.steps.some(s => s.kind === 'step' && s.role === 'recovery'),
    'the between-sets recovery vanished');
});

test('a ladder keeps its real executable order, rung by rung', () => {
  // No "ladder" primitive: five discrete work steps with recoveries between,
  // in the order they are run. The card may collapse them; this may not.
  const a = app();
  const w = a.providerWorkout(day(a, 'ladder')).workout;
  const order = leaves(w.steps).filter(s => s.role === 'work' || s.role === 'recovery')
    .map(s => s.role === 'recovery' ? 'rec' : s.duration.metres);
  assert.equal(JSON.stringify(order),
    JSON.stringify([400, 'rec', 800, 'rec', 1200, 'rec', 800, 'rec', 400]),
    'the ladder is no longer in its executable order');
});

test('a progressive block carries its ramp and claims nothing more', () => {
  const a = app();
  const w = a.providerWorkout(day(a, 'progressive_tempo')).workout;
  const work = leaves(w.steps).find(s => s.role === 'work');
  assert.equal(JSON.stringify(work.ramp),
    JSON.stringify({ fromIntensity: 'steady', toIntensity: 'tempo' }));
  assert.equal(work.duration.seconds, 1500, 'the block duration moved');
  // and nothing else claims a ramp
  ['threshold_continuous', 'steady_tempo', 'track_reps'].forEach(n =>
    leaves(a.providerWorkout(day(a, n)).workout.steps).forEach(s =>
      assert.equal(s.ramp, undefined, n + ': invented a ramp')));
});

// ---- 4. TARGETS ------------------------------------------------------------

test('pace bands convert without inverting', () => {
  /* THE bug this whole helper exists to prevent. Lower sec/km is a faster pace
     and therefore a HIGHER m/s. Inverting the bounds would hand every athlete
     a window they cannot hit, on every workout, silently. */
  const a = app();
  assert.equal(a.secPerKmToMetresPerSecond(1000), 1);
  assert.equal(a.secPerKmToMetresPerSecond(250), 4);
  assert.equal(a.metresPerSecondToSecPerKm(4), 250);
  // round trip
  [180, 240, 300, 337.11].forEach(s =>
    assert.ok(Math.abs(a.metresPerSecondToSecPerKm(a.secPerKmToMetresPerSecond(s)) - s) < 1e-9));
  // nonsense in, null out -- never Infinity into a device target
  [0, -1, null, undefined, NaN, Infinity].forEach(v => {
    assert.equal(a.secPerKmToMetresPerSecond(v), null, 'secPerKm ' + v);
    assert.equal(a.metresPerSecondToSecPerKm(v), null, 'mps ' + v);
  });

  const t = a.providerPaceTarget({ fast: 229, slow: 235 });
  assert.equal(t.secPerKmFast, 229);
  assert.equal(t.secPerKmSlow, 235);
  assert.ok(t.metresPerSecondHigh > t.metresPerSecondLow, 'the speed band is inverted');
  assert.ok(Math.abs(t.metresPerSecondHigh - 1000 / 229) < 1e-9,
    'the FAST pace bound is not the HIGH speed bound');
  assert.ok(Math.abs(t.metresPerSecondLow - 1000 / 235) < 1e-9,
    'the SLOW pace bound is not the LOW speed bound');
});

test('every pace target in every archetype has its bounds the right way round', () => {
  const a = app();
  NAMES.forEach(n => leaves(a.providerWorkout(day(a, n)).workout.steps).forEach(st => {
    (st.targets || []).forEach(t => {
      if (t.type !== 'pace') return;
      assert.ok(t.secPerKmFast <= t.secPerKmSlow, n + ': sec/km bounds crossed');
      assert.ok(t.metresPerSecondLow <= t.metresPerSecondHigh, n + ': m/s bounds crossed');
      assert.ok(Math.abs(t.metresPerSecondHigh - 1000 / t.secPerKmFast) < 1e-9,
        n + ': fast pace is not high speed');
    });
  }));
});

test('a goal pace is marked exact rather than left as a one-wide window', () => {
  const a = app();
  const st = leaves(a.providerWorkout(day(a, 'goal_pace_block')).workout.steps)
    .find(s => s.intensity === 'goal_pace');
  const pace = st.targets.find(t => t.type === 'pace');
  assert.equal(pace.exact, true);
  assert.equal(pace.secPerKmFast, pace.secPerKmSlow);
});

test('heart-rate targets are carried alongside pace, never instead of it', () => {
  const a = app();
  const st = leaves(a.providerWorkout(day(a, 'threshold_continuous')).workout.steps)
    .find(s => s.intensity === 'threshold');
  // JSON rather than deepEqual: these arrays cross the VM realm boundary and
  // deepEqual compares prototypes, so structurally identical values fail.
  const kinds = st.targets.map(t => t.type).sort().join(',');
  assert.equal(kinds, 'heart_rate,pace',
    'a provider that can only express one target should choose, not this layer');
  const hr = st.targets.find(t => t.type === 'heart_rate');
  assert.equal(hr.bpmLow, 172);
  assert.equal(hr.bpmHigh, 182);
});

test('by-feel and maximal work stays open, with a stated reason', () => {
  const a = app();
  const openWork = n => leaves(a.providerWorkout(day(a, n)).workout.steps)
    .filter(s => s.role === 'work');
  openWork('hill_repeats').forEach(s => {
    assert.equal(s.targets.length, 0, 'hills were given a pace window');
    assert.equal(s.openReason, 'by_feel');
  });
  openWork('fartlek').forEach(s => assert.equal(s.openReason, 'by_feel'));
  const tt = openWork('time_trial').find(s => s.maximal);
  assert.ok(tt, 'the time-trial effort lost its maximal flag');
  assert.equal(tt.targets.length, 0, 'a maximal effort was given a target');
  assert.equal(tt.openReason, 'maximal');
});

// ---- 5. QUALITATIVE RECOVERIES AND OPEN COOL-DOWNS --------------------------

test('a qualitative recovery is open and manual-advance, never a made-up number', () => {
  const a = app();
  const expect = {
    goal_pace_reps: 'short', ladder: 'scaled_to_rep', deuce: 'short',
    hill_repeats: 'return_to_start', easy_strides: 'full_recovery'
  };
  Object.keys(expect).forEach(n => {
    const rec = leaves(a.providerWorkout(day(a, n)).workout.steps)
      .filter(s => s.role === 'recovery' && s.duration.type === 'open');
    assert.ok(rec.length, n + ': a ruled recovery was given a duration');
    rec.forEach(s => {
      assert.equal(s.duration.advance, 'manual', n + ': open recovery is not manual-advance');
      assert.equal(s.duration.rule, expect[n], n + ': the recovery rule changed');
      assert.equal(s.duration.seconds, undefined, n + ': an open recovery carries seconds');
      assert.equal(s.duration.metres, undefined, n + ': an open recovery carries metres');
    });
  });
});

test('a timed cool-down stays open but keeps the total it must reach', () => {
  const a = app();
  ['steady_tempo', 'progressive_tempo', 'hill_repeats', 'fartlek'].forEach(n => {
    const dd = day(a, n);
    const cd = leaves(a.providerWorkout(dd).workout.steps).find(s => s.role === 'cooldown');
    assert.equal(cd.duration.type, 'open', n + ': a cool-down distance was manufactured');
    assert.equal(cd.duration.rule, 'complete_session_total');
    assert.equal(cd.duration.sessionTotalMetres, dd.km * 1000,
      n + ': the completion instruction lost its total');
  });
  // a session whose cool-down IS prescribed keeps the number and gets no rule
  const th = leaves(a.providerWorkout(day(a, 'threshold_continuous')).workout.steps)
    .find(s => s.role === 'cooldown');
  assert.equal(th.duration.type, 'distance');
  assert.equal(th.duration.metres, 1000);
});

test('a range recovery keeps both bounds and states its own midpoint', () => {
  const a = app();
  const set = leaves(a.providerWorkout(day(a, 'deuce')).workout.steps)
    .filter(s => s.role === 'recovery' && s.duration.type === 'time')[0];
  assert.equal(set.duration.range, true);
  assert.equal(set.duration.secondsLow, 180);
  assert.equal(set.duration.secondsHigh, 240);
  assert.equal(set.duration.seconds, 210, 'the midpoint is not segSeconds()');
});

// ---- 6. UNIT INDEPENDENCE --------------------------------------------------

test('the athlete\'s unit preference cannot reach a provider', () => {
  /* The single most important property here. workoutSteps() says "3.11mi" for
     the same session in miles; this must be byte-identical in both. */
  const km = app('km'), mi = app('mi');
  NAMES.forEach(n => {
    const A = km.providerWorkout(day(km, n));
    const B = mi.providerWorkout(day(mi, n));
    assert.equal(JSON.stringify(A.workout), JSON.stringify(B.workout),
      n + ': the canonical workout changed with the display unit');
    assert.equal(A.fingerprint, B.fingerprint, n + ': the fingerprint moved with the display unit');
  });
  // and prove the card really does differ, or the test above proves nothing
  const cardKm = km.workoutSteps(day(km, 'threshold_continuous'))[1].qty;
  const cardMi = mi.workoutSteps(day(mi, 'threshold_continuous'))[1].qty;
  assert.notEqual(cardKm, cardMi, 'the card no longer localises, so this comparison is vacuous');
});

test('no display formatter is reachable from the canonical layer', () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const start = code.indexOf('var PROVIDER_WORKOUT_VERSION');
  const end = code.indexOf('function scheduledTraining(');
  assert.ok(start > -1 && end > start, 'could not locate the provider layer');
  const region = code.slice(start, end);
  ['fmtDist(', 'displayUnit(', 'displayUnitNoun(', 'kmToDisplay(', 'paceSecToDisplay(',
   'secToPace(', 'resolveDesc(', 'state.units'].forEach(bad => {
    assert.equal(region.indexOf(bad), -1,
      'the canonical layer reaches a display formatter: ' + bad);
  });
});

// ---- 7. FINGERPRINTS AND IDENTITY ------------------------------------------

test('the fingerprint is deterministic and content-addressed', () => {
  const a = app(), b = app();
  NAMES.forEach(n => {
    assert.equal(a.providerWorkout(day(a, n)).fingerprint,
                 b.providerWorkout(day(b, n)).fingerprint, n + ': not deterministic');
  });
  // distinct sessions get distinct fingerprints
  const seen = {};
  NAMES.forEach(n => {
    const f = a.providerWorkout(day(a, n)).fingerprint;
    assert.ok(!seen[f], 'fingerprint collision: ' + n + ' and ' + seen[f]);
    seen[f] = n;
  });
});

test('renaming a session is not a change worth pushing to a watch', () => {
  const a = app();
  const one = day(a, 'track_reps');
  const two = day(a, 'track_reps');
  two.title = 'A completely different name';
  assert.equal(a.providerWorkout(one).fingerprint, a.providerWorkout(two).fingerprint);
});

test('changing what the athlete runs changes the fingerprint', () => {
  const a = app();
  const base = a.providerWorkout(day(a, 'track_reps')).fingerprint;
  const moreReps = day(a, 'track_reps'); moreReps.prescription.params.reps = 6;
  const longerReps = day(a, 'track_reps'); longerReps.prescription.params.m = 1200;
  assert.notEqual(a.providerWorkout(moreReps).fingerprint, base, 'rep count is not fingerprinted');
  assert.notEqual(a.providerWorkout(longerReps).fingerprint, base, 'rep distance is not fingerprinted');
  const other = day(a, 'threshold_continuous');
  assert.notEqual(a.providerWorkout(other).fingerprint, base);
});
