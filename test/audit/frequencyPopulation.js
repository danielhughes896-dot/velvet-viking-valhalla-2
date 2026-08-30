'use strict';
/* THE FREQUENCY DECISION, MEASURED OVER THE THREE POPULATIONS SEPARATELY.
 * ===========================================================================
 * Foundation, on-ramp and race blocks answer different questions and are
 * counted apart, so a number that moves because athletes CHANGED ARCHITECTURE
 * can never be mistaken for a number that moved because a defect was fixed.
 *
 * Every shape counted here is named and derived from a constant that already
 * exists. Nothing is scored, ranked or summed into an index.
 *
 *   run_below_race_floor      a race-shaped week prescribing a run under
 *                             EASY_MIN_KM -- the smallest session such a week
 *                             may contain
 *   easy_longer_than_long     an "easy" day longer than the long run
 *   long_run_not_longest      the long run is not the longest run of its week
 *   week_fills_availability   every available day is a running day AND the
 *                             week is below the expressibility bound for that
 *                             many days -- i.e. days were filled rather than
 *                             earned
 *   runs_equal_availability   how often prescribed running days == the days
 *                             the athlete said they have (context, not a fault)
 *
 * Run with `node test/audit/frequencyPopulation.js`.
 */
const path = require('path');
const { auditCase, auditOnRamp, auditFoundation, DISTANCES, app } =
  require(path.join(__dirname, 'planAudit.js'));
const { VOLUMES, WEEKS, SCHEDULES } = require(path.join(__dirname, 'matrix.js'));

const A = app();
const SCHED_DAYS = { d3: 3, d4: 4, d5: 5, d6: 6 };

function blank(){
  return { plans: 0, weeks: 0, runs: 0, tally: {}, dayHist: {},
           runsEqualAvailability: 0, weeksWithAvailability: 0 };
}
function bump(t, code){ t.tally[code] = (t.tally[code] || 0) + 1; }

function measure(c, scheduleKey, out, opts){
  const raceShaped = !(opts && opts.noLongRun);
  const avail = SCHED_DAYS[scheduleKey];
  out.plans++;
  c.weeks.forEach(w => {
    if (w.isRace) return;
    out.weeks++;
    const runs = w.sessions.filter(s => s.km > 0);
    out.runs += runs.length;
    out.dayHist[runs.length] = (out.dayHist[runs.length] || 0) + 1;
    out.weeksWithAvailability++;
    if (runs.length === avail) out.runsEqualAvailability++;

    if (raceShaped && runs.some(s => s.km < A.EASY_MIN_KM)) bump(out, 'run_below_race_floor');

    const longs = runs.filter(s => s.type === 'long');
    const longKm = longs.length ? Math.max(...longs.map(s => s.km)) : null;
    if (longKm != null){
      if (runs.some(s => s.type === 'easy' && s.km > longKm)) bump(out, 'easy_longer_than_long');
      if (runs.some(s => s.km > longKm)) bump(out, 'long_run_not_longest');
    }

    /* DID THE WEEK FILL ITS DAYS OR EARN THEM? The bound is the engine's own
       expressibility answer for this block's floor and long-run shape. */
    const floor = raceShaped ? A.EASY_MIN_KM : A.EASY_QUANTUM_KM;
    const bound = A.expressibleRunningDays(c.inputs.distanceKey, w.targetVolume,
                                           floor, raceShaped);
    if (bound != null && runs.length > bound) bump(out, 'week_fills_availability');
  });
}

function report(name, out){
  console.log('\n' + name);
  console.log('  plans %d   weeks %d   prescribed runs %d', out.plans, out.weeks, out.runs);
  const keys = Object.keys(out.tally).sort();
  if (!keys.length) console.log('  no pathological shape found');
  keys.forEach(k => console.log('  %s %s  (%s%% of weeks)', String(out.tally[k]).padStart(6),
    k.padEnd(26), (100 * out.tally[k] / out.weeks).toFixed(1)));
  console.log('  running days per week: %s', JSON.stringify(
    Object.keys(out.dayHist).map(Number).sort((x, y) => x - y)
      .reduce((o, k) => (o[k] = out.dayHist[k], o), {})));
  console.log('  weeks running on every available day: %d of %d (%s%%)',
    out.runsEqualAvailability, out.weeksWithAvailability,
    (100 * out.runsEqualAvailability / out.weeksWithAvailability).toFixed(1));
}

/* THE POPULATION D ACTUALLY OPERATES ON. With no logged history the athlete
   keeps their stated availability, so a matrix built from default state
   measures the expressibility backstop alone. This second pass writes a real
   demonstrated frequency into the athlete before each block is built and
   reports what the prescription then does, per (availability, demonstrated)
   pair -- which is the only place D can bind. */
function evidencePass(){
  const a = app();
  const rows = [];
  for (const scheduleKey of ['d3', 'd4', 'd5', 'd6']){
    const avail = SCHED_DAYS[scheduleKey];
    for (let dem = 2; dem <= 6; dem++){
      let weeks = 0, atDem = 0, atAvail = 0, below = 0, other = 0;
      for (const distanceKey of DISTANCES)
        for (const volume of [26, 35, 45, 60, 80])
          for (const w of [8, 12, 16]){
            a.state = a.makeDefaultState();
            const sess = [];
            for (let i = 0; i < 52; i++){
              const monday = a.addDays(a.addDays(a.todayStr(), -a.isoWeekday(a.todayStr())),
                                       -7 * (52 - i));
              for (let d = 0; d < dem; d++)
                sess.push({ date: a.addDays(monday, d), completed: true,
                            actualKm: 8, plannedKm: 8 });
            }
            a.state.athlete = { sessions: sess };
            const schedule = { d3:{activeDays:[1,3,6],longRunDay:6},
                               d4:{activeDays:[1,3,5,6],longRunDay:6},
                               d5:{activeDays:[1,2,3,5,6],longRunDay:6},
                               d6:{activeDays:[0,1,2,3,5,6],longRunDay:6} }[scheduleKey];
            const start = a.todayStr();
            const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), w * 7 - 1);
            let blk, days;
            try {
              blk = a.buildBlockWeeks(distanceKey, volume, w, {});
              days = a.buildDaysFromWeeks(blk, end, schedule, start, false);
            } catch (e){ continue; }
            const byWeek = {};
            days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
            blk.weeks.forEach(wk => {
              if (wk.isRace) return;
              const ds = byWeek[wk.week] || [];
              const n = ds.filter(d => d.km > 0).length;
              weeks++;
              const expect = Math.min(avail, Math.max(2, dem));
              if (n === expect) atDem++;
              else if (n === avail) atAvail++;
              else if (n < expect) below++;
              else other++;
            });
          }
      rows.push({ scheduleKey, avail, dem, weeks, atDem, atAvail, below, other });
    }
  }
  console.log('\nD, MEASURED WHERE IT CAN BIND');
  console.log('  availability x demonstrated -> what the week was actually prescribed on');
  console.log('  ' + 'avail'.padStart(6) + 'dem'.padStart(5) + 'weeks'.padStart(8) +
              'at min(avail,dem)'.padStart(20) + 'below it'.padStart(10) + 'above it'.padStart(10));
  rows.forEach(r => console.log('  ' + String(r.avail).padStart(6) + String(r.dem).padStart(5) +
    String(r.weeks).padStart(8) + String(r.atDem).padStart(20) +
    String(r.below).padStart(10) + String(r.atAvail + r.other).padStart(10)));
  return rows;
}

function run(){
  const race = blank(), onramp = blank(), foundation = blank();
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES)
      for (const w of WEEKS)
        for (const scheduleKey of SCHEDULES){
          const opts = { distanceKey, volume, weeks: w, scheduleKey };
          const c = auditCase(opts);
          if (!c.error && !c.routed) measure(c, scheduleKey, race, {});
          const o = auditOnRamp(opts);
          if (!o.skipped && !o.error) measure(o, scheduleKey, onramp, {});
          const f = auditFoundation(opts);
          if (!f.skipped && !f.error) measure(f, scheduleKey, foundation, { noLongRun: true });
        }
  console.log('EASY_MIN_KM = %s   EASY_QUANTUM_KM = %s', A.EASY_MIN_KM, A.EASY_QUANTUM_KM);
  report('RACE BLOCKS (athletes who receive a race programme)', race);
  report('ON-RAMP BLOCKS', onramp);
  report('FOUNDATION BLOCKS', foundation);
  const evidence = evidencePass();
  return { race, onramp, foundation, evidence };
}

module.exports = { run };
if (require.main === module) run();
