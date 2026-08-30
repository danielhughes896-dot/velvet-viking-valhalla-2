'use strict';
/* DOES A LOW-VOLUME ATHLETE'S PROGRAMME ACTUALLY REACH RACE PREPAREDNESS?
 * ===========================================================================
 * HQ's question, asked of the architecture rather than of one case: the
 * athlete's stated weekly mileage describes their CURRENT exposure. It must
 * inform where the programme starts. It must not decide where it ends.
 *
 * Read FORWARD and BACKWARD, using only what the engine already states:
 *
 *   FORWARD   athletePathway() decides foundation -> on-ramp -> race block,
 *             and each stage's endpoints are the engine's own.
 *   BACKWARD  MIN_PEAK_LONG_KM[dist] is the product's existing statement of
 *             the long run a race block must reach for that distance;
 *             minViableStartKm() inverts it into the weekly volume a block of
 *             a given length needs to start from.
 *
 * The question is therefore answerable without inventing anything: does the
 * pathway, over the weeks the athlete actually has, deliver them from where
 * they are to a block whose peak long run reaches MIN_PEAK_LONG_KM -- and
 * where it does not, does the product SAY SO rather than build a plan that
 * quietly falls short?
 *
 * Run with `node test/audit/lowVolumeRaceReadiness.js`.
 */
const path = require('path');
const { app, resetState, SCHEDULES } = require(path.join(__dirname, 'planAudit.js'));

const A = app();
const DISTS = ['5k', '10k', 'half', 'full', 'ultra'];

function readiness(distKey, volume, weeks, scheduleKey){
  const a = resetState();
  const p = a.athletePathway(distKey, volume, weeks);
  const sched = SCHEDULES[scheduleKey];
  const start = a.todayStr();
  const stages = [];
  if (p.route === 'insufficient_time') return { pathway: p, stages: null, declared: true };

  const push = (purpose, wks, rampToKm, from) => {
    if (!wks) return from;
    const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), wks * 7 - 1);
    const opts = rampToKm != null ? { purpose, rampToKm } : { purpose };
    let blk, days;
    try { blk = a.buildBlockWeeks(distKey, from, wks, opts);
          days = a.buildDaysFromWeeks(blk, end, sched, start, false); }
    catch (e){ stages.push({ purpose, error: String(e.message) }); return from; }
    const longs = days.filter(d => d.type === 'long' && d.km > 0).map(d => d.km);
    stages.push({ purpose, weeks: wks, from: from, peak: blk.peakVolume,
                  peakLong: longs.length ? Math.max(...longs) : 0 });
    return blk.peakVolume;
  };

  let v = volume;
  if (p.route === 'foundation_then_on_ramp_then_race'){
    v = push('foundation', p.foundationWeeks, p.foundationToKm, v);
    v = push('onramp', p.onRampWeeks, p.onRampToKm, v);
    v = push('race', p.raceBlockWeeks, null, v);
  } else if (p.route === 'on_ramp_then_race'){
    v = push('onramp', p.onRampWeeks, p.onRampToKm, v);
    v = push('race', p.raceBlockWeeks, null, v);
  } else {
    v = push('race', weeks, null, v);
  }
  return { pathway: p, stages, declared: false };
}

function report(){
  console.log('MIN_PEAK_LONG_KM, the product\'s own statement of race preparedness:');
  console.log('  ' + DISTS.map(d => d + ' ' + A.MIN_PEAK_LONG_KM[d] + 'km').join('   '));
  console.log('');
  for (const distKey of DISTS){
    const need = A.MIN_PEAK_LONG_KM[distKey];
    console.log('=== ' + distKey.toUpperCase() + '   race-block peak long run must reach ' + need + 'km');
    console.log('   start  weeks  route                              final peak  peak long   reaches it?');
    for (const volume of [5, 10, 15, 20, 30]){
      for (const weeks of [12, 20, 28, 40, 52]){
        const r = readiness(distKey, volume, weeks, 'd5');
        if (r.declared){
          console.log('  ' + String(volume).padStart(5) + String(weeks).padStart(7) + '  ' +
            'insufficient_time'.padEnd(34) + '  ' + 'declared, no plan built'.padStart(32));
          continue;
        }
        const last = r.stages[r.stages.length - 1] || {};
        const ok = last.peakLong >= need;
        console.log('  ' + String(volume).padStart(5) + String(weeks).padStart(7) + '  ' +
          String(r.pathway.route).padEnd(34) +
          String(Math.round(last.peak || 0)).padStart(10) +
          String(last.peakLong || 0).padStart(11) + '   ' + (ok ? 'yes' : 'NO'));
      }
    }
    console.log('');
  }
  /* THE SUMMARY, STATED RATHER THAN LEFT TO BE READ OFF. */
  const rows = [];
  for (const distKey of DISTS)
    for (const volume of [5, 10, 15, 20, 30])
      for (const weeks of [12, 16, 20, 24, 28, 40, 52]){
        const r = readiness(distKey, volume, weeks, 'd5');
        if (r.declared){ rows.push({ distKey, volume, weeks, declared: true }); continue; }
        const last = r.stages[r.stages.length - 1] || {};
        rows.push({ distKey, volume, weeks, route: r.pathway.route,
                    peakLong: last.peakLong || 0, need: A.MIN_PEAK_LONG_KM[distKey],
                    ok: (last.peakLong || 0) >= A.MIN_PEAK_LONG_KM[distKey] });
      }
  const short = rows.filter(r => !r.declared && !r.ok);
  console.log('SUMMARY');
  console.log('  cases measured: %d   reach the required peak long run: %d   fall short: %d   ' +
              'declared insufficient_time: %d',
    rows.length, rows.filter(r => r.ok).length, short.length,
    rows.filter(r => r.declared).length);
  const byWeeks = {}, byVol = {};
  short.forEach(r => { byWeeks[r.weeks] = (byWeeks[r.weeks] || 0) + 1;
                       byVol[r.volume] = (byVol[r.volume] || 0) + 1; });
  console.log('  shortfalls by programme length: %s', JSON.stringify(byWeeks));
  console.log('  shortfalls by starting volume : %s', JSON.stringify(byVol));
  console.log('');
  console.log('  READ THIS AS: starting mileage does NOT trap the programme -- a 5km/week');
  console.log('  athlete and a 30km/week athlete converge on the same final peak and the');
  console.log('  same long run once there are enough weeks. What binds is TIME. And where');
  console.log('  there is not enough of it the pathway still builds a plan that falls');
  console.log('  short of the product\'s own MIN_PEAK_LONG_KM rather than saying the');
  console.log('  preparation window is insufficient.');
}
report();
