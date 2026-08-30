'use strict';
/* §13 — THE FOUR GOALS, MEASURED AS SEPARATE POPULATIONS, AND THE CONTRACT
 * TRAP BETWEEN purpose AND steady.
 * ===========================================================================
 * BUILDER_PURPOSE_META is the product's own list of what an athlete can ask
 * for. Each is built here with the options the PRODUCT pairs with it, not with
 * a subset an instrument chose -- the earlier run that reported "Maintain
 * ramps at 1.55x" was measuring a maintain block built without steady:true,
 * which is a combination handleGeneratePlan() never produces.
 */
const path = require('path');
const { app, resetState, DISTANCES, SCHEDULES } =
  require(path.join(__dirname, 'planAudit.js'));

/* THE PAIRING IS NO LONGER THE INSTRUMENT'S TO GUESS. buildBlockWeeks() now
   derives `steady` from the purpose when a caller does not state it, so an
   instrument that passes the purpose alone is measuring exactly the block the
   product builds. The earlier run that reported "Maintain ramps at 1.55x" was
   measuring a maintain block built without steady:true -- a combination no
   call site produced, and one the engine no longer produces either. */
function purposeOptions(a, key){ return { purpose: key }; }

function build(a, distKey, volume, weeks, scheduleKey, opts){
  const schedule = SCHEDULES[scheduleKey];
  const start = a.todayStr();
  const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), weeks * 7 - 1);
  const blk = a.buildBlockWeeks(distKey, volume, weeks, opts);
  const days = a.buildDaysFromWeeks(blk, end, schedule, start, false);
  return { blk, days };
}

function main(){
  const a0 = app();
  const keys = a0.BUILDER_PURPOSE_ORDER.slice();
  console.log('BUILDER_PURPOSE_ORDER =', JSON.stringify(keys));
  console.log('');
  console.log('THE ARC EACH PURPOSE ACTUALLY GETS');
  console.log('  ' + 'purpose'.padEnd(14) + 'steady'.padStart(8) +
              'defaultWeeks'.padStart(14) + 'volumeMult'.padStart(12) +
              'hasGoalEffort'.padStart(15) + 'noQuality'.padStart(11) +
              'taper'.padStart(8));
  keys.forEach(k => {
    const m = a0.BUILDER_PURPOSE_META[k] || {};
    const arc = a0.blockArcFor(k, m.defaultWeeks || 12);
    const b = a0.buildBlockWeeks('half', 45, m.defaultWeeks || 12, { purpose: k });
    console.log('  ' + k.padEnd(14) + String(a0.purposeIsSteady(k)).padStart(8) +
      String(m.defaultWeeks).padStart(14) + String(arc.volumeMult).padStart(12) +
      /* THE DELIVERED FACT, NOT THE ARC FLAG. blockArcFor() says maintenance
         "has a goal effort"; steady suppresses it, so what the athlete gets is
         a block with no race week at all. The delivered answer is the one
         worth printing. */
      String(b.weeks.some(w => w.isRace)).padStart(15) +
      String(!!b.noQuality).padStart(11) + String(b.taperWeeks).padStart(8));
  });

  /* THE TRAP, RE-MEASURED. Same purpose, the two ways a caller could pass it. */
  console.log('\nTHE purpose / steady CONTRACT, BOTH WAYS OF PASSING IT');
  keys.forEach(k => {
    const paired = [], bare = [];
    for (const d of DISTANCES){
      const a = resetState();
      paired.push(build(a, d, 45, 12, 'd5', { purpose: k, steady: k === 'maintain' }).blk.peakVolume / 45);
      const b = resetState();
      bare.push(build(b, d, 45, 12, 'd5', { purpose: k }).blk.peakVolume / 45);
    }
    const mean = xs => xs.reduce((t, x) => t + x, 0) / xs.length;
    console.log('  %s  purpose + steady: peak/start %s   purpose alone: %s%s',
      k.padEnd(14), mean(paired).toFixed(3), mean(bare).toFixed(3),
      Math.abs(mean(paired) - mean(bare)) > 0.0005 ? '   <-- STILL DIFFERENT' : '   agree');
  });

  /* THE FOUR POPULATIONS. */
  const { checkCase } = require(path.join(__dirname, 'invariants.js'));
  const { auditCase } = require(path.join(__dirname, 'planAudit.js'));
  const { VOLUMES, WEEKS } = require(path.join(__dirname, 'matrix.js'));
  console.log('\nPOPULATION BY PURPOSE (whole matrix, each purpose built as the product builds it)');
  console.log('  Every purpose is built over the SAME 2,350 inputs, including the very low');
  console.log('  volumes that a race goal routes to foundation or the on-ramp. Routing is a');
  console.log('  race-programme decision (raceProgrammeViability), so for the other three');
  console.log('  purposes these counts include athletes the product may yet decide not to');
  console.log('  give a block of that kind at all. Read as a comparison between purposes at');
  console.log('  identical inputs, which is what it is, not as a defect count per purpose.');
  keys.forEach(k => {
    const opts0 = purposeOptions(a0, k);
    const tally = {}; let plans = 0, weeks = 0, sessions = 0;
    for (const distanceKey of DISTANCES)
      for (const volume of VOLUMES)
        for (const w of WEEKS)
          for (const scheduleKey of ['d3', 'd5']){
            const c = auditCase({ distanceKey, volume, weeks: w, scheduleKey,
                                  purpose: opts0.purpose, steady: opts0.steady });
            plans++;
            if (!c.error){ weeks += c.weeks.length; sessions += c.sessions.length; }
            checkCase(c).forEach(f => { tally[f.code] = (tally[f.code] || 0) + 1; });
          }
    console.log('\n  ' + k + '  (plans %d, weeks %d, sessions %d)', plans, weeks, sessions);
    Object.keys(tally).sort().forEach(code =>
      console.log('     %s  %s', String(tally[code]).padStart(6), code));
    if (!Object.keys(tally).length) console.log('     clean');
  });
}
main();
