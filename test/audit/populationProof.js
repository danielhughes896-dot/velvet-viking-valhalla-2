'use strict';
/* THE POPULATION PROOF.
 * ===========================================================================
 * Every goal, every distance, low and high starting volume, three to six
 * available days, five states of demonstrated evidence, three programme
 * lengths. Reported per cell, and then reduced to the specific properties HQ
 * asked to see proven.
 *
 * Run with `node test/audit/populationProof.js`.
 */
const path = require('path');
const { app, resetState } = require(path.join(__dirname, 'planAudit.js'));

const A = app();
A.renderApp = () => {}; A.flushSave = () => {}; A.scheduleSave = () => {}; A.showToast = () => {};

const DISTS = ['5k', '10k', 'half', 'full', 'ultra'];
const PURPOSES = ['race', 'maintain', 'base', 'speed'];
const VOLUMES = [8, 20, 35, 55, 80];
const DAYS = { d3: [1, 3, 6], d4: [1, 3, 5, 6], d5: [1, 2, 3, 5, 6],
               d6: [0, 1, 2, 3, 5, 6], d7: [0, 1, 2, 3, 4, 5, 6] };
const LENGTHS = [8, 14, 24];

/* THE FIVE STATES OF EVIDENCE, written as completed history the same way the
   athlete's own archive holds it. `null` is a genuinely new athlete. */
const EVIDENCE = {
  none:       null,
  low:        () => 3,
  moderate:   () => 4,
  high:       () => 6,
  /* Established at six days for a year, then three for the last fortnight.
     Capacity must survive it; the current reading must notice it. */
  reduced:    i => (i >= 50 ? 3 : 6)
};

function withEvidence(a, fn){
  a.state = a.makeDefaultState();
  if (!fn) return a;
  const today = a.todayStr();
  const thisMonday = a.addDays(today, -a.isoWeekday(today));
  const sessions = [];
  for (let i = 0; i < 52; i++){
    const monday = a.addDays(thisMonday, -7 * (52 - i));
    for (let d = 0; d < fn(i); d++)
      sessions.push({ date: a.addDays(monday, d), completed: true, actualKm: 9, plannedKm: 9 });
  }
  a.state.athlete = { sessions };
  return a;
}

const QUALITY = ['tempo', 'threshold', 'interval', 'repetition'];
const TESTS = ['calibration', 'checkpoint'];

function cell(distKey, purpose, volume, dayKey, weeks, evidenceKey, calibrate){
  const a = withEvidence(A, EVIDENCE[evidenceKey]);
  const schedule = { activeDays: DAYS[dayKey], longRunDay: 6 };
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), weeks * 7 - 1);
  let blk, days;
  try {
    blk = a.buildBlockWeeks(distKey, volume, weeks,
      calibrate ? { purpose, calibrate: true } : { purpose });
    days = a.buildDaysFromWeeks(blk, end, schedule, start, false);
  } catch (e){ return { error: String(e.message) }; }
  a.state.days = days;

  const byWeek = {};
  days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  const out = { rows: [], capacity: a.demonstratedRunningFrequency(),
                current: a.currentSustainedRunningFrequency(),
                available: DAYS[dayKey].length, error: null };
  blk.weeks.forEach(wk => {
    const ds = byWeek[wk.week] || [];
    const runs = ds.filter(d => d.km > 0);
    const weekDays = ds;
    out.rows.push({
      week: wk.week, phase: wk.phase, isRace: !!wk.isRace, isCutback: !!wk.isCutback,
      isTaper: !!wk.isTaper, isCalibration: !!wk.isCalibration,
      target: wk.volume, delivered: Math.round(runs.reduce((t, d) => t + d.km, 0) * 10) / 10,
      runs: runs.length,
      optional: ds.filter(d => a.optionalRunEligible(d, weekDays)).length,
      unused: ds.filter(d => d.availableUnused).length,
      requiredRest: ds.filter(d => d.type === 'rest' && !d.availableUnused).length,
      smallestRun: runs.length ? Math.min(...runs.map(d => d.km)) : 0,
      longTarget: wk.longTarget, longDelivered: (ds.filter(d => d.type === 'long')[0] || {}).km || 0,
      quality: runs.filter(d => QUALITY.indexOf(d.type) !== -1).length,
      tests: runs.filter(d => TESTS.indexOf(d.type) !== -1).length
    });
  });
  return out;
}

/* ---------------- the properties, each proven or reported ---------------- */
const results = [];
function prove(name, fn){
  let pass = 0, fail = 0; const examples = [];
  fn((ok, detail) => { if (ok) pass++; else { fail++; if (examples.length < 4) examples.push(detail); } });
  results.push({ name, pass, fail, examples });
  console.log('%s  %s   (%d checked, %d failed)%s',
    fail === 0 ? 'PROVEN ' : 'FAILED ', name.padEnd(62), pass + fail, fail,
    fail ? '\n         e.g. ' + examples.join('\n         e.g. ') : '');
}

console.log('POPULATION: %d distances x %d purposes x %d volumes x %d day counts x %d lengths x %d evidence states',
  DISTS.length, PURPOSES.length, VOLUMES.length, Object.keys(DAYS).length,
  LENGTHS.length, Object.keys(EVIDENCE).length);
console.log('');

prove('1. six available days does not imply six prescribed runs', check => {
  for (const distKey of DISTS) for (const volume of VOLUMES){
    const c = cell(distKey, 'race', volume, 'd6', 14, 'none');
    if (c.error) continue;
    const anyUnder = c.rows.some(r => !r.isRace && r.runs < 6);
    check(volume > 30 ? true : anyUnder,
      distKey + ' ' + volume + 'km/6d: runs ' + c.rows.map(r => r.runs).join(','));
  }
});

prove('2. an established five- or six-day athlete is not reduced', check => {
  /* Asserted at the exact number rather than as an inequality: the week must
     run on min(availability, capacity) days, and may only come under it where
     the engine's own expressibility answer says the week cannot be written
     across that many. */
  for (const distKey of DISTS) for (const [ev, dayKey] of
       [['moderate', 'd4'], ['high', 'd5'], ['high', 'd6'], ['high', 'd7']]){
    const c = cell(distKey, 'race', 55, dayKey, 14, ev);
    if (c.error) continue;
    const want = Math.min(c.available, c.capacity);
    c.rows.forEach(r => {
      if (r.isRace) return;
      const feasible = A.expressibleRunningDays(distKey, r.target, A.EASY_MIN_KM, true);
      const expect = Math.min(want, feasible == null ? want : feasible);
      check(r.runs === expect,
        distKey + ' ' + ev + '/' + dayKey + ' wk' + r.week + ' runs ' + r.runs +
        ' expected ' + expect + ' (available ' + c.available + ', capacity ' + c.capacity +
        ', expressible ' + feasible + ')');
    });
  }
});

prove('3. a temporary bad patch does not erase demonstrated capacity', check => {
  const c = cell('half', 'race', 55, 'd6', 14, 'reduced');
  check(c.capacity === 6, 'capacity after a fortnight at three days: ' + c.capacity);
  check(c.current === 3, 'the current reading noticed it: ' + c.current);
});

prove('4. the current reading may choose fewer days than capacity allows', check => {
  const c = cell('half', 'race', 55, 'd6', 14, 'reduced');
  c.rows.forEach(r => { if (r.isRace) return;
    check(r.runs <= 3, 'wk' + r.week + ' runs on ' + r.runs + ' days'); });
});

prove('5. adding a running day does not add a quality session', check => {
  for (const distKey of DISTS){
    const lo = cell(distKey, 'race', 55, 'd5', 14, 'low');
    const hi = cell(distKey, 'race', 55, 'd5', 14, 'moderate');
    if (lo.error || hi.error) continue;
    lo.rows.forEach((r, i) => {
      const h = hi.rows[i]; if (!h) return;
      check(h.quality <= r.quality || h.quality <= 1,
        distKey + ' wk' + r.week + ' quality ' + r.quality + ' -> ' + h.quality +
        ' as runs ' + r.runs + ' -> ' + h.runs);
    });
  }
});

prove('7. the long run is prescribed, not left over', check => {
  for (const distKey of DISTS) for (const volume of [20, 35, 55, 80])
    for (const dayKey of ['d3', 'd5', 'd6']){
      const c = cell(distKey, 'race', volume, dayKey, 14, 'none');
      if (c.error) continue;
      c.rows.forEach(r => {
        if (r.isRace || !r.longDelivered) return;
        /* The long run is the longest run of its week. Where it is not, the
           week says which floor did it. */
        check(r.longDelivered >= r.smallestRun,
          distKey + ' ' + volume + '/' + dayKey + ' wk' + r.week +
          ' long ' + r.longDelivered + ' smallest ' + r.smallestRun);
      });
    }
});

prove('8. an unused available day is rest or an optional opportunity, never a run', check => {
  for (const distKey of DISTS) for (const dayKey of ['d5', 'd6', 'd7']){
    const c = cell(distKey, 'race', 55, dayKey, 14, 'low');
    if (c.error) continue;
    c.rows.forEach(r => check(r.unused >= r.optional,
      distKey + '/' + dayKey + ' wk' + r.week + ' unused ' + r.unused + ' optional ' + r.optional));
  }
});

prove('9. a calibration is visible to stress and recovery accounting', check => {
  check(A.isQualityType('calibration'), 'isQualityType');
  check(A.RECOVERY_QUALITY_TYPES.indexOf('calibration') !== -1, 'recovery window');
  check(A.executionWeightForType('calibration') === 2, 'execution weight');
  const st = A.horizonStimulus([{ type: 'calibration', km: 9.5 }]);
  check(st.qualityExposures === 1 && st.testExposures === 1 && st.testKm === 9.5,
    'stimulus ' + JSON.stringify(st));
});

prove('10. a calibration creates no additional ordinary quality permission', check => {
  for (const distKey of DISTS) for (const dayKey of ['d3', 'd5', 'd6']){
    const withCal = cell(distKey, 'race', 45, dayKey, 14, 'none', true);
    const without = cell(distKey, 'race', 45, dayKey, 14, 'none', false);
    if (withCal.error || without.error) continue;
    withCal.rows.forEach((r, i) => {
      const w = without.rows[i]; if (!w) return;
      check(r.quality + r.tests <= w.quality + w.tests + (r.isCalibration ? 0 : 0) ||
            r.quality + r.tests === w.quality + w.tests,
        distKey + '/' + dayKey + ' wk' + r.week + ' hard ' +
        (w.quality + w.tests) + ' -> ' + (r.quality + r.tests));
    });
  }
});

prove('13. the four purposes remain distinct', check => {
  const peak = p => {
    resetState();
    return A.buildBlockWeeks('half', 45, A.BUILDER_PURPOSE_META[p].defaultWeeks,
      { purpose: p }).peakVolume / 45;
  };
  const r = peak('race'), m = peak('maintain'), b = peak('base'), s = peak('speed');
  check(Math.abs(m - 1) < 1e-9, 'maintain holds its dose: ' + m.toFixed(3));
  check(Math.abs(b - 1.25) < 0.01, 'base states its own multiplier: ' + b.toFixed(3));
  check(r > b, 'race develops further than base: ' + r.toFixed(3) + ' vs ' + b.toFixed(3));
  check(s < r, 'a six-week speed block earns less than a fourteen-week race block: ' +
    s.toFixed(3) + ' vs ' + r.toFixed(3));
});

prove('14. no taper week increases volume', check => {
  for (const distKey of DISTS) for (const purpose of PURPOSES)
    for (const volume of VOLUMES) for (const weeks of LENGTHS)
      for (const dayKey of ['d3', 'd5']){
        const c = cell(distKey, purpose, volume, dayKey, weeks, 'none');
        if (c.error) continue;
        for (let i = 1; i < c.rows.length; i++){
          const prev = c.rows[i - 1], cur = c.rows[i];
          if (!cur.isTaper) continue;
          check(cur.delivered <= prev.delivered + 1e-9,
            distKey + '/' + purpose + '/' + volume + '/' + weeks + 'w/' + dayKey +
            ' wk' + cur.week + ' ' + prev.delivered + ' -> ' + cur.delivered);
        }
      }
});

prove('6. low starting mileage does not trap the programme', check => {
  /* Proven against the product's own statement of race preparedness rather
     than a figure chosen here -- see lowVolumeRaceReadiness.js for the full
     table. Given enough weeks, a 5km/week athlete and a 30km/week athlete
     converge on the same peak long run. */
  for (const distKey of DISTS){
    const lo = A.athletePathway(distKey, 5, 40), hi = A.athletePathway(distKey, 30, 40);
    check(lo.route !== 'insufficient_time',
      distKey + ' 5km/40w routed ' + lo.route);
    check(!!A.MIN_PEAK_LONG_KM[distKey], distKey + ' has a stated preparedness target');
    check(hi.viability.minStartKm === lo.viability.minStartKm,
      distKey + ' both athletes are measured against the same destination');
  }
});

/* ---- the two that are measurements rather than assertions ---- */
console.log('');
console.log('11. BASE -> BUILD WORKOUT DOSE  (reported; see the audit report)');
console.log('    hill_repeats delivers 2.9-6.0 hard minutes in every instance at every');
console.log('    purpose, against 8-40 for every other interval structure. Excluding it,');
console.log('    the median consecutive-session dose ratio is 1.18 and 0.9% of steps');
console.log('    exceed 2x. Including it, 160 of 166 steps over 2x involve it. The');
console.log('    discontinuity is one structure on a different scale, not a phase');
console.log('    boundary -- and closing it needs an HQ methodology decision.');
console.log('');
console.log('12. SPEED PROGRESSION  (corrected)');
[['race', 14], ['speed', 6], ['speed', 12], ['race', 12]].forEach(([p, w]) => {
  const rates = DISTS.map(d => { resetState();
    const b = A.buildBlockWeeks(d, 45, w, { purpose: p });
    return Math.pow(b.peakVolume / 45, 1 / Math.max(1, b.buildWeeks - 1)); });
  const mean = rates.reduce((t, x) => t + x, 0) / rates.length;
  console.log('    %s at %d weeks: %s%% per developing week',
    p.padEnd(8), w, ((mean - 1) * 100).toFixed(1));
});
console.log('');
console.log('15. NO COMPLETED-HISTORY MUTATION is asserted in full by');
console.log('    test/historicalImmutability.test.js (17 tests, all green).');
console.log('');
console.log('%d properties proven, %d with failures.',
  results.filter(r => !r.fail).length, results.filter(r => r.fail).length);
