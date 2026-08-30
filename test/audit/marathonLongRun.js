'use strict';
/* MARATHON PEAK LONG-RUN AUDIT
 * ===========================================================================
 * A. Traces one named example end to end.
 * B. Stratifies the marathon population.
 * C. Compares stimulus with the product's OWN load methodology.
 *
 * node test/audit/marathonLongRun.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));

const TODAY = '2026-08-30';
const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};

const r1 = x => Math.round(x * 10) / 10;
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

/* ---------------- A. THE NAMED EXAMPLE ---------------- */
const RACE = '2026-11-15';
const VOL = 51;
const SCHEDULE = { activeDays: [0, 1, 2, 3, 4, 6], longRunDay: 6 };   // six available days
const startMonday = a.addDays(TODAY, -a.isoWeekday(TODAY));
const weeksAvail = Math.floor((Date.parse(RACE) - Date.parse(startMonday)) / (7 * 864e5)) + 1;

console.log('=== A. THE EXAMPLE ===');
console.log('today %s  race %s  weeks available %d  start volume %d  available days %d',
  TODAY, RACE, weeksAvail, VOL, SCHEDULE.activeDays.length);

const P = a.DISTANCE_PROFILES.full;
console.log('\nprofile full: longCapKm=%s volMult=%s emphasis=%s  LONG_FRACTION[%s]=%s',
  P.longCapKm, P.volMult, P.emphasis, P.emphasis, a.LONG_FRACTION[P.emphasis]);
console.log('MIN_PEAK_LONG_KM.full = %s   GOAL_FINISH_MIN_LONG_KM = %s',
  a.MIN_PEAK_LONG_KM.full, a.GOAL_FINISH_MIN_LONG_KM);
console.log('developmentMultiplierFor(full, %d) = %s',
  weeksAvail, a.developmentMultiplierFor('full', weeksAvail));

const blk = a.buildBlockWeeks('full', VOL, weeksAvail, {});
console.log('\nplanWeeks=%d  peakVolume=%s', blk.planWeeks,
  Math.max.apply(null, blk.weeks.map(w => w.volume)));

console.log('\n--- PER-WEEK DECISION CHAIN (buildBlockWeeks) ---');
console.log(pad('wk', 4) + pad('phase', 9) + num('vol', 7) + num('vol*.32', 9) +
  num('cap', 6) + num('longTgt', 9) + num('goalSeg', 9) + num('longKm', 8) + num('easyMax', 9));
blk.weeks.forEach(w => {
  const raw = r1(w.volume * a.LONG_FRACTION[P.emphasis]);
  const tgt = w.isRace ? 0 : r1(Math.min(P.longCapKm, w.volume * a.LONG_FRACTION[P.emphasis]));
  console.log(pad(w.week, 4) + pad(w.phase || (w.isRace ? 'Race' : ''), 9) +
    num(r1(w.volume), 7) + num(raw, 9) + num(P.longCapKm, 6) + num(tgt, 9) +
    num(r1(w.goalSegKm || 0), 9) + num(r1(w.longKm || 0), 8) +
    num(w.easyMaxKm != null ? r1(w.easyMaxKm) : '-', 9));
});

const days = a.buildDaysFromWeeks(blk, RACE, SCHEDULE, TODAY, true);
a.state = a.makeDefaultState();
a.state.days = days;
a.state.setup = { distanceKey:'full', currentVolume:VOL, planWeeks:blk.planWeeks, schedule:SCHEDULE,
  benchmark:{ distanceKey:'5k', timeSec: 23*60 + 5 }, goals:{ A:{ timeSec: 4*3600 } }, activeGoal:'A',
  paceOverrides:{}, lthr:null, maxHR:null, experience:'experienced',
  startDate:TODAY, raceDate:RACE, hasEvent:true, purpose:'race', supportWork:'on' };

console.log('\n--- WHAT THE ATHLETE ACTUALLY RECEIVES (buildDaysFromWeeks) ---');
console.log(pad('wk', 4) + pad('phase', 9) + num('weekKm', 8) + num('runDays', 9) +
  num('longKm', 8) + num('goalSeg', 9) + num('long%wk', 9) + pad('  title', 30));
const weeks = [...new Set(days.map(d => d.week))].filter(Boolean).sort((x, y) => x - y);
let peak = { km: 0 };
weeks.forEach(w => {
  const wd = days.filter(d => d.week === w);
  const long = wd.filter(d => d.type === 'long')[0];
  const wkKm = r1(wd.reduce((t, d) => t + (d.km || 0), 0));
  const runDays = wd.filter(d => (d.km || 0) > 0).length;
  const bw = blk.weeks.filter(x => x.week === w)[0] || {};
  if (long && long.km > peak.km) peak = { km: long.km, week: w, day: long, wkKm: wkKm };
  console.log(pad(w, 4) + pad(bw.phase || (bw.isRace ? 'Race' : ''), 9) + num(wkKm, 8) +
    num(runDays, 9) + num(long ? r1(long.km) : '-', 8) +
    num(long && long.goalSegKm != null ? r1(long.goalSegKm) : (bw.goalSegKm ? r1(bw.goalSegKm) : '-'), 9) +
    num(long && wkKm ? Math.round(100 * long.km / wkKm) + '%' : '-', 9) +
    '  ' + (long ? long.title : ''));
});
console.log('\nPEAK LONG RUN: %s km in week %d (week total %s km, %d%% of the week)',
  peak.km, peak.week, peak.wkKm, Math.round(100 * peak.km / peak.wkKm));
console.log('  title: %s', peak.day.title);
console.log('  desc : %s', a.resolveDesc(peak.day.desc));
console.log('  prescription: %s', JSON.stringify(peak.day.prescription));

/* Which constraint actually bound it. */
const pw = blk.weeks.filter(x => x.week === peak.week)[0];
const rawTarget = pw.volume * a.LONG_FRACTION[P.emphasis];
console.log('\n  BINDING ANALYSIS for week %d:', peak.week);
console.log('    week volume                  %s km', r1(pw.volume));
console.log('    x LONG_FRACTION endurance .32 %s km', r1(rawTarget));
console.log('    profile.longCapKm             %s km   %s', P.longCapKm,
  rawTarget >= P.longCapKm ? '<== BINDING' : '(not binding)');
console.log('    delivered long run            %s km', r1(peak.km));
console.log('    fraction actually delivered   %s', r1(100 * peak.km / pw.volume) + '% of the week');

/* ---------------- B. THE MARATHON POPULATION ---------------- */
console.log('\n\n=== B. MARATHON POPULATION ===');
const VOLS = [25,30,35,40,45,50,55,60,65,70,75,80,90,100];
const WKS  = [12,14,16,18,20,24,30,40];
const DAYS = [4,5,6,7];
const SCHEDULES = {
  4: { activeDays:[1,3,5,6], longRunDay:6 },
  5: { activeDays:[1,2,4,5,6], longRunDay:6 },
  6: { activeDays:[0,1,2,3,4,6], longRunDay:6 },
  7: { activeDays:[0,1,2,3,4,5,6], longRunDay:6 }
};
const rows = [];
VOLS.forEach(v => WKS.forEach(w => DAYS.forEach(nd => {
  let b, ds;
  try {
    b = a.buildBlockWeeks('full', v, w, {});
    const start = TODAY;
    const end = a.addDays(a.addDays(start, -a.isoWeekday(start)), b.planWeeks*7 - 1);
    ds = a.buildDaysFromWeeks(b, end, SCHEDULES[nd], start, true);
  } catch(e){ return; }
  const wks = [...new Set(ds.map(d => d.week))].filter(Boolean);
  let best = null;
  wks.forEach(k => {
    const wd = ds.filter(d => d.week === k);
    /* THE FIRST CALENDAR WEEK IS NOT A TRAINING WEEK when the plan starts
       mid-week: it can hold a single day, which is then trivially "100% of the
       week" and sits in Base where no goal segment is allowed. Counting it as
       the peak long-run week describes the calendar, not the programme. */
    if (wd.length < 7) return;
    const lg = wd.filter(d => d.type === 'long')[0];
    if (!lg) return;
    const wkKm = wd.reduce((t,d) => t + (d.km||0), 0);
    const bw = b.weeks.filter(x => x.week === k)[0] || {};
    if (!best || lg.km > best.longKm)
      best = { longKm: lg.km, wkKm: r1(wkKm), goalSeg: r1((lg.prescription && lg.prescription.params
                 && lg.prescription.params.finishKm) || 0), week: k, phase: bw.phase };
  });
  if (!best) return;
  const peakVol = r1(Math.max.apply(null, b.weeks.map(x => x.volume)));
  const runDays = (() => { const wd = ds.filter(d => d.week === best.week);
                           return wd.filter(d => (d.km||0) > 0).length; })();
  rows.push({ v, w: b.planWeeks, nd, runDays, peakVol,
    longKm: r1(best.longKm), pct: Math.round(100*best.longKm/best.wkKm),
    goalSeg: best.goalSeg, goalPct: best.longKm ? Math.round(100*best.goalSeg/best.longKm) : 0,
    capBound: r1(peakVol * a.LONG_FRACTION.endurance) >= P.longCapKm });
})));
console.log('marathon plans built: %d', rows.length);

const req = a.MIN_PEAK_LONG_KM.full;
const meets = rows.filter(r => r.longKm + 0.05 >= req);
console.log('\nMIN_PEAK_LONG_KM.full = %d km  (the engine\'s own declared minimum adequate peak)', req);
console.log('  plans reaching it        : %d / %d  (%d%%)', meets.length, rows.length,
  Math.round(100*meets.length/rows.length));
console.log('  weekly volume needed     : %s km  (= %d / %s)',
  r1(req / a.LONG_FRACTION.endurance), req, a.LONG_FRACTION.endurance);
console.log('  lowest peak volume that reaches it: %s km',
  meets.length ? r1(Math.min.apply(null, meets.map(r => r.peakVol))) : 'none');
console.log('  plans where profile.longCapKm(32) actually binds: %d', rows.filter(r => r.capBound).length);

const bucket = (label, keyfn) => {
  const g = {};
  rows.forEach(r => { const k = keyfn(r); (g[k] = g[k] || []).push(r); });
  console.log('\n-- peak long run by %s --', label);
  console.log(pad('', 14) + num('n', 5) + num('minLong', 9) + num('medLong', 9) +
    num('maxLong', 9) + num('med%wk', 8) + num('med goal%', 11) + num('>=30km', 8));
  Object.keys(g).sort((x,y) => (parseFloat(x)||0) - (parseFloat(y)||0)).forEach(k => {
    const s = g[k].map(r => r.longKm).sort((x,y) => x-y);
    const p = g[k].map(r => r.pct).sort((x,y) => x-y);
    const q = g[k].map(r => r.goalPct).sort((x,y) => x-y);
    const md = arr => arr[Math.floor(arr.length/2)];
    console.log(pad(k, 14) + num(g[k].length, 5) + num(s[0], 9) + num(md(s), 9) +
      num(s[s.length-1], 9) + num(md(p)+'%', 8) + num(md(q)+'%', 11) +
      num(g[k].filter(r => r.longKm + 0.05 >= req).length, 8));
  });
};
bucket('start volume', r => r.v);
bucket('PEAK volume', r => Math.round(r.peakVol/10)*10);
bucket('plan weeks', r => r.w);
bucket('available days', r => r.nd);

/* Does adding weekly volume let the long run develop? */
console.log('\n-- does more volume buy a longer long run? (16wk, 6 days) --');
rows.filter(r => r.w === 16 && r.nd === 6).sort((x,y) => x.v - y.v).forEach(r =>
  console.log('  start %s -> peak %s km/wk -> long %s km (%d%% of week, goal seg %s km)',
    num(r.v,3), num(r.peakVol,5), num(r.longKm,4), r.pct, r.goalSeg));

/* ---------------- C. STIMULUS, NOT DISTANCE ---------------- */
console.log('\n\n=== C. STIMULUS COMPARISON (the product\'s OWN cost model) ===');
console.log('COACH_LOAD_FACTOR: %s', JSON.stringify(a.COACH_LOAD_FACTOR));
console.log('long_run_goal_finish carries no ARCHETYPES.exec override, so the engine');
console.log('prices the WHOLE run at COACH_LOAD_FACTOR.long = %s.', a.COACH_LOAD_FACTOR.long);
console.log('A decomposed reading uses the same table twice -- the easy portion at');
console.log('.long and the goal-pace portion at .tempo = %s, marathon pace being the', a.COACH_LOAD_FACTOR.tempo);
console.log('band .tempo names. No new scoring system is introduced either way.\n');

const flat = km => r1(km * a.COACH_LOAD_FACTOR.long);
const decomposed = (km, goal) => r1((km - goal) * a.COACH_LOAD_FACTOR.long + goal * a.COACH_LOAD_FACTOR.tempo);
/* Time on feet, from the athlete's OWN easy pace via the app's pace machinery. */
function easySecPerKm(benchSec5k){
  a.state.setup.benchmark = { distanceKey:'5k', timeSec: benchSec5k };
  a.state.setup.paceOverrides = {};
  const z = a.getActivePaces();
  return (z.E.slow + z.E.fast) / 2;
}
function goalSecPerKm(){ return a.getGoalPaceSecPerKm(); }
const hhmm = sec => Math.floor(sec/3600) + 'h' + String(Math.round((sec%3600)/60)).padStart(2,'0');

const CANDIDATES = [
  { label:'28 km with 10.6 km at goal pace', km:28, goal:10.6 },
  { label:'30 km, all easy',                 km:30, goal:0 },
  { label:'32 km, all easy',                 km:32, goal:0 },
  { label:'32 km with 10.6 km at goal pace', km:32, goal:10.6 }
];
[ { n:'23:05 5K (the example athlete)', s: 23*60+5 },
  { n:'19:30 5K (faster)',              s: 19*60+30 },
  { n:'27:00 5K (slower)',              s: 27*60 } ].forEach(ath => {
  const eSec = easySecPerKm(ath.s);
  const gSec = goalSecPerKm() || eSec * 0.86;
  console.log('-- %s   easy %s/km, goal %s/km --', ath.n,
    a.fmtPaceFromSecPerKm(eSec), a.fmtPaceFromSecPerKm(gSec));
  console.log('   ' + pad('session', 36) + num('load(flat)', 12) + num('load(decomp)', 14) + num('time on feet', 14));
  CANDIDATES.forEach(c => {
    const t = (c.km - c.goal) * eSec + c.goal * gSec;
    console.log('   ' + pad(c.label, 36) + num(flat(c.km), 12) + num(decomposed(c.km, c.goal), 14) +
      num(hhmm(t), 14));
  });
  console.log('');
});
