'use strict';
/* DOES THE WORKOUT ITSELF PROGRESS ACROSS THE BLOCK?
 * ===========================================================================
 * The weekly volume is audited elsewhere and at length. This asks the other
 * half of the question: within a block, does the SESSION the athlete is asked
 * to run get harder from Base through Build to Peak, and in the ways the
 * phase names claim?
 *
 * Decomposed rather than scored, because "harder" is several different things
 * and they do not have to move together:
 *
 *   distance      the kilometres on the card
 *   work km       the kilometres inside the structure that are actually at
 *                 the prescribed intensity (segmentsFor(), the same resolution
 *                 the athlete's card uses), which is what a session's dose is
 *   intensity     which zone that work sits in -- an interval block at I is a
 *                 different demand from the same kilometres at T
 *   structure     how many distinct structures the phase's pool actually
 *                 delivered, so "progression" that is really repetition of one
 *                 session is visible as such
 *
 * Run with `node test/audit/workoutProgression.js`.
 */
const path = require('path');
const { app, resetState, DISTANCES, SCHEDULES } =
  require(path.join(__dirname, 'planAudit.js'));

const A = app();
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition'];

function phaseOfWeek(blk, week){
  const w = blk.weeks[week - 1];
  return w ? w.phase : null;
}

/* THE DOSE, MEASURED BY THE APP'S OWN SEGMENT WALKER.
   The first version of this instrument summed `km` over segments where
   kind === 'work' and reported that an interval session in Base contained no
   work at all. It was wrong in three ways at once, and the ways are worth
   recording because each is a trap for the next instrument:

     REPEATS NEST. A structure is {kind:'repeat', times:N, children:[...]},
     so a flat pass over the top level never reaches the reps.
     WORK IS OFTEN TIMED, NOT MEASURED. Hill repeats are 5 x 35 SECONDS and
     carry no km at all, so a distance-only reading scores them zero.
     WARM-UP AND COOL-DOWN ARE ALSO kind:'work'. They carry role:'warmup' /
     'cooldown' and no number, and counting them as dose counts the jog to
     the track as part of the session.

   segmentDistanceMix() is the walker every zone chart, duration estimate and
   execution target in the product already folds from: it flattens repeats,
   prices timed work through the athlete's own pace zones and keeps time and
   distance in the units they were stated in. Using it means this instrument
   and the athlete's card cannot disagree. */
function workOf(a, dd){
  const p = dd.prescription;
  if (!p) return null;
  let segs = null, mix = null;
  try {
    segs = a.orderedSegments(p) || null;
    if (segs) mix = a.segmentDistanceMix(segs);
  } catch (e){ return null; }
  if (!mix) return null;
  /* THE DOSE IS THE TIME AT AN INTENSITY THAT IS NOT EASY. Easy covers the
     warm-up, the cool-down and every jog recovery, which is exactly what a
     session's dose is not. Time rather than distance because that is the unit
     the structures are actually written in. */
  let hardSec = 0;
  const zones = {};
  Object.keys(mix.timeByIntensity).forEach(i => {
    const sec = mix.timeByIntensity[i];
    zones[i] = Math.round(sec);
    if (i !== 'easy') hardSec += sec;
  });
  /* AND THE DENOMINATOR HAS TO INCLUDE THE PART NOBODY NUMBERED. A hill-repeat
     session's warm-up and cool-down carry no distance at all, so the walker
     alone accounts for only the reps and a hard/total fraction built from it
     would say a Base interval session is 85% hard running. structuredZoneTime()
     is the product's own complete answer: dd.km is known and the accounted
     distance is known, so the unnumbered remainder is known exactly, and every
     part of it is easy running. */
  let totalSec = mix.totalSec;
  try {
    const full = a.structuredZoneTime(dd);
    if (full && full.totalSec > 0) totalSec = full.totalSec;
  } catch (e){ /* keep the walker's own total */ }
  return { hardSec: Math.round(hardSec), totalSec: Math.round(totalSec),
           accountedKm: Math.round(mix.accountedKm * 100) / 100,
           zones, archetype: p.archetype, dayKm: dd.km,
           unquantified: !!mix.hasUnquantified };
}

function collect(distanceKey, volume, weeks, scheduleKey, purpose){
  const a = resetState();
  const schedule = SCHEDULES[scheduleKey];
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), weeks * 7 - 1);
  const blk = a.buildBlockWeeks(distanceKey, volume, weeks, { purpose });
  const days = a.buildDaysFromWeeks(blk, end, schedule, start, false);
  const out = [];
  days.forEach(dd => {
    if (!(dd.km > 0) || QUALITY.indexOf(dd.type) === -1) return;
    const w = workOf(a, dd);
    if (!w) return;
    out.push(Object.assign({ week: dd.week, phase: phaseOfWeek(blk, dd.week),
                             type: dd.type }, w));
  });
  return out;
}

function mean(xs){ return xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null; }

function report(purpose, family){
  const byPhase = {}, archetypes = {};
  let n = 0, unquantified = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of [30, 40, 50, 65, 80])
      for (const weeks of [10, 12, 16, 20])
        for (const scheduleKey of ['d3', 'd5']){
          collect(distanceKey, volume, weeks, scheduleKey, purpose).forEach(s => {
            const isInterval = s.type === 'interval' || s.type === 'repetition';
            if ((family === 'interval') !== isInterval) return;
            n++;
            if (s.unquantified) unquantified++;
            const p = s.phase || 'unknown';
            (byPhase[p] = byPhase[p] || { dayKm: [], hardSec: [], frac: [], zones: {} });
            byPhase[p].dayKm.push(s.dayKm);
            byPhase[p].hardSec.push(s.hardSec);
            if (s.totalSec > 0) byPhase[p].frac.push(s.hardSec / s.totalSec);
            Object.keys(s.zones).forEach(z => {
              byPhase[p].zones[z] = (byPhase[p].zones[z] || 0) + s.zones[z];
            });
            (archetypes[p] = archetypes[p] || {});
            archetypes[p][s.archetype] = (archetypes[p][s.archetype] || 0) + 1;
          });
        }
  console.log('\n  %s family, %s blocks  (%d sessions%s)', family, purpose, n,
    unquantified ? ', ' + unquantified + ' with an unquantified segment' : '');
  console.log('    ' + 'phase'.padEnd(11) + 'n'.padStart(6) + 'day km'.padStart(8) +
              'hard min'.padStart(10) + 'hard/total'.padStart(12) +
              '   intensity mix (share of the time the structure states)'.padEnd(60) + 'structures');
  ['Base', 'Build', 'Peak', 'Taper', 'Final Week', 'Maintain'].forEach(p => {
    const d = byPhase[p];
    if (!d) return;
    const tot = Object.keys(d.zones).reduce((t, z) => t + d.zones[z], 0) || 1;
    const mix = Object.keys(d.zones).sort((x, y) => d.zones[y] - d.zones[x])
      .filter(z => d.zones[z] / tot >= 0.005)
      .map(z => z + ' ' + Math.round(100 * d.zones[z] / tot) + '%').join(' ');
    console.log('    ' + p.padEnd(11) + String(d.dayKm.length).padStart(6) +
      mean(d.dayKm).toFixed(1).padStart(8) +
      (mean(d.hardSec) / 60).toFixed(1).padStart(10) +
      (mean(d.frac) * 100).toFixed(0).padStart(11) + '%' + '   ' + mix.padEnd(57) +
      Object.keys(archetypes[p] || {}).length);
  });
  const step = (from, to, k) => {
    const f = byPhase[from], t = byPhase[to];
    if (!f || !t || !mean(f[k])) return 'n/a';
    return ((mean(t[k]) / mean(f[k]) - 1) * 100).toFixed(1) + '%';
  };
  [['Base', 'Build'], ['Build', 'Peak'], ['Base', 'Peak']].forEach(([x, y]) => {
    if (!byPhase[x] || !byPhase[y]) return;
    console.log('    %s -> %s   session distance %s   hard minutes %s',
      x.padEnd(5), y.padEnd(5), step(x, y, 'dayKm'), step(x, y, 'hardSec'));
  });
  ['Base', 'Build', 'Peak'].forEach(p => {
    if (!archetypes[p]) return;
    console.log('      %s pool delivered: %s', p,
      Object.keys(archetypes[p]).map(k => k + ' x' + archetypes[p][k]).join(', '));
  });
}

console.log('WORKOUT PROGRESSION, DECOMPOSED');
console.log('Day km is the whole session including warm-up, recoveries and cool-down.');
console.log('Hard minutes are the time at any intensity that is not easy -- the dose --');
console.log('folded from the same segment walker the athlete\'s zone chart uses, with the');
console.log('unnumbered warm-up and cool-down attributed to easy through the product\'s own');
console.log('structuredZoneTime(). A phase that grows the session distance without growing');
console.log('the hard minutes has grown the warm-up.');
['race', 'base', 'speed', 'maintain'].forEach(p => {
  report(p, 'interval');
  report(p, 'tempo');
});
