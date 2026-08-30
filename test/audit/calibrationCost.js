'use strict';
/* WHAT THE THRESHOLD CALIBRATION COSTS THE ATHLETE WHO IS GIVEN IT.
 * ===========================================================================
 * CALIBRATION_MIN_WEEKLY_KM is a safety floor, and a floor is only defensible
 * if the thing it holds back is actually measured. This measures it: the
 * session's own size against the week it lands in and against the longest run
 * that athlete's programme otherwise contains.
 *
 * The protocol is FIXED -- twelve minutes of warm-up, a continuous thirty
 * minute time trial, ten minutes of cool-down -- and does not scale with the
 * athlete in any way. That is the whole reason the question has an answer.
 *
 * Run with `node test/audit/calibrationCost.js`.
 */
const path = require('path');
const { app, SCHEDULES } = require(path.join(__dirname, 'planAudit.js'));
const { buildPlan } = require(path.join(__dirname, '..', 'fixtures.js'));

const a = app();
a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};

const P = a.CALIBRATION_PROTOCOL;
const wholeMin = P.warmupMin + a.calibrationEffortMin() + P.cooldownMin;
console.log('CALIBRATION_PROTOCOL  warm-up %d + settle %d + measured %d + cool-down %d = %d minutes',
  P.warmupMin, P.settleMin, P.measuredMin, P.cooldownMin, wholeMin);
console.log('  of which %d minutes are ONE CONTINUOUS effort at threshold.', a.calibrationEffortMin());
console.log('  The session is prescribed in MINUTES and is identical for every athlete:');
console.log('  calibrationSessionKm() = %skm at the nominal easy pace the app prices timed',
  a.calibrationSessionKm());
console.log('  prescriptions with. CALIBRATION_MIN_WEEKLY_KM = %d.', a.CALIBRATION_MIN_WEEKLY_KM);
console.log('');
console.log('  vol  dist   calib km   share of week   longest OTHER run   calib / that run');

for (const dist of ['5k', '10k', 'half', 'full']){
  for (const vol of [10, 14, 20, 25, 30, 40, 55, 70, 90]){
    buildPlan(a, { distanceKey: dist, volume: vol, weeks: 14, startDate: a.todayStr(),
                   schedule: SCHEDULES.d5 });
    const start = a.todayStr();
    const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), 14 * 7 - 1);
    let blk, days;
    try {
      blk = a.buildBlockWeeks(dist, vol, 14, { calibrate: true });
      days = a.buildDaysFromWeeks(blk, end, SCHEDULES.d5, start, false);
    } catch (e){ continue; }
    const cal = days.filter(d => d.type === 'calibration')[0];
    if (!cal) continue;
    const wk = days.filter(d => d.week === cal.week && d.km > 0);
    const act = Math.round(wk.reduce((t, d) => t + d.km, 0) * 10) / 10;
    const others = wk.filter(d => d.date !== cal.date).map(d => d.km);
    const longest = others.length ? Math.max(...others) : 0;
    console.log('  %s  %s %s %s %s %s',
      String(vol).padStart(3), dist.padEnd(5),
      String(cal.km).padStart(9),
      (Math.round(1000 * cal.km / act) / 10 + '%').padStart(15),
      String(longest).padStart(19),
      (longest ? Math.round(100 * cal.km / longest) + '%' : 'n/a').padStart(18));
  }
  console.log('');
}
console.log('READ THIS AS: at the floor the session already IS the longest run of the');
console.log('athlete\'s week and roughly two-fifths of it. The floor is not conservative;');
console.log('it is close to the minimum at which the protocol as written is expressible.');
