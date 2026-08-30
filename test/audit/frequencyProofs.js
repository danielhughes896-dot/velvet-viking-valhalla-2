'use strict';
/* RUNNING FREQUENCY AND THRESHOLD CALIBRATION -- THE DELIVERED SCHEDULES.
 * ===========================================================================
 * Not a pass/fail instrument. This prints the actual weeks the engine builds
 * for the athletes HQ named, so the decision can be read off the prescription
 * rather than off a count. Run with `node test/audit/frequencyProofs.js`.
 *
 * Every case here is built through buildBlockWeeks() + buildDaysFromWeeks() --
 * the same two calls the product makes -- with the athlete's evidence written
 * into state before the block is built, exactly as the app has it.
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));

const MONDAY = '2026-08-31';
const SCHED = {
  d3: { activeDays: [1, 3, 6], longRunDay: 6 },
  d4: { activeDays: [1, 3, 5, 6], longRunDay: 6 },
  d5: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 },
  d6: { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 }
};

function app(today){
  const a = loadApp({ pinnedDate: (today || MONDAY) + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  a.state = a.makeDefaultState();
  return a;
}

/* COMPLETED HISTORY, WRITTEN WHERE THE ATHLETE'S OWN TRAINING LIVES.
   runsPerWeek(i) is the number of running days in week i, 0 = oldest. */
function withHistory(a, weeks, runsPerWeek, kmPerRun){
  const sess = [];
  for (let i = 0; i < weeks; i++){
    const monday = a.addDays(MONDAY, -7 * (weeks - i));
    const n = runsPerWeek(i);
    for (let d = 0; d < n; d++)
      sess.push({ date: a.addDays(monday, d), completed: true,
                  actualKm: kmPerRun || 8, plannedKm: kmPerRun || 8 });
  }
  a.state.athlete = a.state.athlete || {};
  a.state.athlete.sessions = sess;
  return a;
}

function grantConsent(a){
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z',
    withdrawnAt: null };
  return a;
}

function build(a, distKey, volume, weeks, scheduleKey, opts){
  const schedule = SCHED[scheduleKey];
  const raceDate = a.addDays(MONDAY, weeks * 7 - 1);
  const blk = a.buildBlockWeeks(distKey, volume, weeks, opts || {});
  const days = a.buildDaysFromWeeks(blk, raceDate, schedule, MONDAY, false);
  return { blk, days, schedule };
}

/* THE PLAN THE PRODUCT ACTUALLY GIVES THIS ATHLETE. athletePathway() decides
   which architecture they get; below the race floor they are not given a race
   block at all, so printing one would be printing a plan nobody receives. */
function buildRouted(a, distKey, volume, weeks, scheduleKey){
  const path = a.athletePathway(distKey, volume, weeks);
  const stage = path.route === 'foundation_then_on_ramp_then_race'
      ? { purpose: 'foundation', weeks: path.foundationWeeks, rampToKm: path.foundationToKm }
    : path.route === 'on_ramp_then_race'
      ? { purpose: 'onramp', weeks: path.onRampWeeks, rampToKm: path.onRampToKm }
      : { purpose: 'race', weeks: weeks, rampToKm: null };
  const schedule = SCHED[scheduleKey];
  const endDate = a.addDays(MONDAY, stage.weeks * 7 - 1);
  const blk = a.buildBlockWeeks(distKey, volume, stage.weeks,
    stage.rampToKm != null ? { purpose: stage.purpose, rampToKm: stage.rampToKm }
                           : { purpose: stage.purpose });
  const days = a.buildDaysFromWeeks(blk, endDate, schedule, MONDAY, false);
  return { blk, days, schedule, path, stage };
}

const DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function printWeeks(a, res, first, last){
  const byWeek = {};
  res.days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
  Object.keys(byWeek).map(Number).sort((x, y) => x - y).forEach(w => {
    if (first != null && w < first) return;
    if (last != null && w > last) return;
    const ds = byWeek[w];
    const runs = ds.filter(d => d.km > 0);
    const km = runs.reduce((t, d) => t + d.km, 0);
    const wk = res.blk.weeks[w - 1] || {};
    console.log('   wk' + String(w).padStart(2) + '  target ' +
      String(Math.round((wk.volume || 0) * 10) / 10).padStart(5) + 'km   delivered ' +
      String(Math.round(km * 10) / 10).padStart(5) + 'km   on ' + runs.length +
      ' of ' + res.schedule.activeDays.length + ' available days');
    ds.forEach(d => {
      console.log('        ' + DOW[a.isoWeekday(d.date)] + ' ' + d.date + '  ' +
        (d.km > 0 ? (String(d.km) + 'km').padStart(7) : '   rest') + '  ' +
        d.type + (d.title ? '  -- ' + d.title : ''));
    });
  });
}

function head(n, s){ console.log('\n' + '='.repeat(74) + '\n' + n + '. ' + s + '\n' + '='.repeat(74)); }

// ---------------------------------------------------------------------------
head(1, '5K, 10km/week, six days available');
{
  const a = app();
  console.log('   expressible days at 10km, race floor:',
    a.expressibleRunningDays('5k', 10, a.EASY_MIN_KM, true),
    '  at the foundation floor:',
    a.expressibleRunningDays('5k', 10, a.EASY_QUANTUM_KM, false),
    '  demonstrated frequency:', a.demonstratedRunningFrequency());
  const r = buildRouted(a, '5k', 10, 12, 'd6');
  console.log('   route: ' + r.path.route + '  -- stage built: ' + r.stage.purpose +
              ' (' + r.stage.weeks + ' weeks)');
  printWeeks(a, r, 1, 2);
  console.log('\n   -- and the race block the same athlete would reach, for comparison --');
  printWeeks(a, build(app(), '5k', 10, 12, 'd6'), 1, 1);
}

head(2, '5K, 16km/week, six days available');
{
  const a = app();
  console.log('   expressible days at 16km, race floor:',
    a.expressibleRunningDays('5k', 16, a.EASY_MIN_KM, true),
    '  demonstrated frequency:', a.demonstratedRunningFrequency());
  const r = buildRouted(a, '5k', 16, 12, 'd6');
  console.log('   route: ' + r.path.route + '  -- stage built: ' + r.stage.purpose +
              ' (' + r.stage.weeks + ' weeks)');
  printWeeks(a, r, 1, 2);
}

head(3, 'Half marathon, 16km/week, four days available');
{
  console.log('\n-- (a) no history: the athlete keeps their stated availability --');
  const a = app();
  const res = build(a, 'half', 16, 12, 'd4');
  console.log('   expressible days at 16km:',
    a.expressibleRunningDays('half', 16, a.EASY_MIN_KM, true),
    '  demonstrated frequency:', a.demonstratedRunningFrequency());
  printWeeks(a, res, 1, 1);

  console.log('\n-- (b) demonstrated sustainable frequency of 3 --');
  const b = withHistory(app(), 52, () => 3);
  const rb = build(b, 'half', 16, 12, 'd4');
  console.log('   demonstrated frequency:', b.demonstratedRunningFrequency());
  printWeeks(b, rb, 1, 1);

  console.log('\n-- (c) demonstrated sustainable frequency of 4 --');
  const c = withHistory(app(), 52, () => 4);
  const rc = build(c, 'half', 16, 12, 'd4');
  console.log('   demonstrated frequency:', c.demonstratedRunningFrequency());
  printWeeks(c, rc, 1, 1);
}

head(4, 'Established five-day athlete with one missed run');
{
  const a = withHistory(app(), 52, i => (i === 51 ? 4 : 5));
  console.log('   last week ran 4; every week before it ran 5');
  console.log('   demonstrated frequency:', a.demonstratedRunningFrequency());
  const res = build(a, '10k', 45, 12, 'd5');
  printWeeks(a, res, 1, 1);
}

head(5, 'Established high-frequency athlete (six days, every week)');
{
  const a = withHistory(app(), 52, () => 6);
  console.log('   demonstrated frequency:', a.demonstratedRunningFrequency());
  const res = build(a, 'half', 60, 12, 'd6');
  printWeeks(a, res, 1, 1);
}

head(6, 'Threshold calibration -- eligible at creation (>= CALIBRATION_MIN_WEEKLY_KM)');
{
  const a = grantConsent(app());
  a.state.setup = { lthr: null, currentVolume: 45 };
  a.state.athlete = { performances: [] };
  const v = a.calibrationVerdict(45);
  console.log('   eligibility:', JSON.stringify(v),
    '  floor CALIBRATION_MIN_WEEKLY_KM =', a.CALIBRATION_MIN_WEEKLY_KM);
  const res = build(a, 'half', 45, 12, 'd5',
    { calibrate: a.calibrationNeededNow(45), calibrateWhenViable: a.calibrationDeferrable(45) });
  printWeeks(a, res, 1, 1);
  const firstRun = res.days.filter(d => d.km > 0)[0];
  console.log('   FIRST PRESCRIBED RUNNING SESSION:', firstRun.date, firstRun.type);
}

head(7, 'Threshold calibration -- below the floor at creation, crossing it later');
{
  const a = grantConsent(app());
  a.state.setup = { lthr: null, currentVolume: 14 };
  a.state.athlete = { performances: [] };
  const v = a.calibrationVerdict(14);
  console.log('   eligibility at creation:', JSON.stringify(v));
  console.log('   deferrable (the floor is the only refusal):', a.calibrationDeferrable(14));
  const res = build(a, 'half', 14, 16, 'd5',
    { calibrate: a.calibrationNeededNow(14), calibrateWhenViable: a.calibrationDeferrable(14) });
  res.blk.weeks.forEach(w => {
    console.log('   wk' + String(w.week).padStart(2) + '  target ' +
      String(w.volume).padStart(5) + 'km  ' +
      (w.volume >= a.CALIBRATION_MIN_WEEKLY_KM ? 'at/above floor' : 'below floor') +
      (w.isCalibration ? '   <-- CALIBRATION PLACED HERE' : '') +
      (w.isCutback ? '   (cutback)' : '') + (w.isCheckpoint ? '   (checkpoint)' : ''));
  });
  const cal = res.days.filter(d => d.type === 'calibration')[0];
  if (cal){
    const wkDays = res.days.filter(d => d.week === cal.week);
    const firstRun = wkDays.filter(d => d.km > 0)[0];
    console.log('   calibration on ' + cal.date + '; first run of that week is ' +
      firstRun.date + ' (' + firstRun.type + ')');
    printWeeks(a, res, cal.week, cal.week);
  } else console.log('   NO CALIBRATION WAS PLACED');
}

head(8, 'Threshold calibration -- athlete supplied an LTHR');
{
  const a = grantConsent(app());
  a.state.setup = { lthr: 168, currentVolume: 45 };
  a.state.athlete = { performances: [] };
  console.log('   eligibility:', JSON.stringify(a.calibrationVerdict(45)));
  console.log('   deferrable:', a.calibrationDeferrable(45));
  const res = build(a, 'half', 45, 12, 'd5',
    { calibrate: a.calibrationNeededNow(45), calibrateWhenViable: a.calibrationDeferrable(45) });
  console.log('   calibration sessions in the whole block:',
    res.days.filter(d => d.type === 'calibration').length);
}

head(9, 'Threshold calibration -- a qualifying effort inside CALIBRATION_EVIDENCE_DAYS');
{
  const a = grantConsent(app());
  const when = a.addDays(MONDAY, -20);
  a.state.setup = { lthr: null, currentVolume: 45 };
  a.state.athlete = { performances: [
    { date: when, distanceM: 10000, timeSec: 45 * 60, source: 'race' } ] };
  console.log('   CALIBRATION_EVIDENCE_DAYS =', a.CALIBRATION_EVIDENCE_DAYS,
              ' effort logged', when, '(20 days ago)');
  console.log('   eligibility:', JSON.stringify(a.calibrationVerdict(45)));
  console.log('   deferrable:', a.calibrationDeferrable(45));
  const res = build(a, 'half', 45, 12, 'd5',
    { calibrate: a.calibrationNeededNow(45), calibrateWhenViable: a.calibrationDeferrable(45) });
  console.log('   calibration sessions in the whole block:',
    res.days.filter(d => d.type === 'calibration').length);
}

head(10, 'Threshold calibration -- no health consent');
{
  const a = app();
  a.state.setup = { lthr: null, currentVolume: 45 };
  a.state.athlete = { performances: [] };
  console.log('   eligibility:', JSON.stringify(a.calibrationVerdict(45)));
  console.log('   deferrable:', a.calibrationDeferrable(45));
}
console.log('');
