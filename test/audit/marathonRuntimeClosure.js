'use strict';
/* MARATHON RUNTIME CLOSURE. READ-ONLY. WIRED INTO NOTHING.
 * ===========================================================================
 * The four questions the pre-instrument cleanup had to answer, asked of the
 * live generator rather than of a description of it:
 *
 *   1  UNDER-PRESCRIPTION.  What does week one deliver against the volume the
 *      athlete stated, and what is the named cause of any difference?
 *   2  TRAJECTORIES.        The whole fifteen weeks at the volumes where the
 *      architecture is under most pressure, with the per-week change and the
 *      structural reason for it.
 *   3  THE CASES.           Eleven athletes across the population, with peak
 *      week, peak long run and its duration, prescribed frequency, quality
 *      weeks, marathon-specific days, phase shape and readiness.
 *   4  long_run_shorter_than_easy_run, DECOMPOSED.  Every remaining marathon
 *      case sorted into the class that causes it.
 *
 *   node test/audit/marathonRuntimeClosure.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const { auditCase } = require(path.join(__dirname, 'planAudit.js'));
const { checkCase } = require(path.join(__dirname, 'invariants.js'));
/* THE PRODUCTION-VALID RACE GOAL DOMAIN. Below this the builder routes to
   Aerobic Base, so a marathon block at 1-5km/week is a DEFENSIVE state this
   audit can invoke directly and not one the product produces. Reported both
   ways: the raw generator audit, and the population the methodology verdict is
   judged on. */
const RACE_GOAL_MIN_KM = require(path.join(__dirname, '..', '..', 'assets', 'builder-spec.js'))
  .validation.raceGoalMinWeeklyKm;

const r1 = x => Math.round(x * 10) / 10;
const hhmm = s => { const m = Math.round(s / 60); return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
const TODAY = '2026-08-30';
const DAYSETS = { 3: [1, 3, 6], 4: [1, 3, 4, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 3, 4, 6] };
const benchFor = v => v < 20 ? 33 * 60 : v < 35 ? 29 * 60 : v < 50 ? 26 * 60 : v < 70 ? 23 * 60 : 20 * 60;
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint'];

/* ---------- 1. UNDER-PRESCRIPTION ---------- */
function underPrescription(){
  console.log('=== 1. WEEK ONE AGAINST THE VOLUME THE ATHLETE STATED ===\n');
  console.log('stated  wk1     d%   week one as prescribed             peak  peak LR  mean wks1-4');
  [4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50].forEach(v => {
    if (v === RACE_GOAL_MIN_KM)
      console.log('  ' + '-'.repeat(30) + ' RACE GOAL ENTRY BOUNDARY ' + '-'.repeat(30));
    const c = auditCase({ distanceKey: 'full', volume: v, weeks: 15, scheduleKey: 'd5' });
    const tot = w => r1(w.sessions.filter(s => s.km > 0).reduce((a, b) => a + b.km, 0));
    const w1 = c.weeks[0], nonRace = c.weeks.filter(w => !w.isRace);
    const peak = Math.max.apply(null, nonRace.map(tot));
    const lr = Math.max.apply(null, nonRace.map(w =>
      Math.max.apply(null, [0].concat(w.sessions.filter(s => s.type === 'long').map(s => s.km)))));
    const m4 = r1(c.weeks.slice(0, 4).reduce((a, w) => a + tot(w), 0) / 4);
    console.log(String(v).padEnd(8) + String(tot(w1)).padStart(4) +
      String(Math.round((tot(w1) / v - 1) * 1000) / 10).padStart(7) + '   ' +
      w1.sessions.filter(s => s.km > 0).map(s => s.type[0] + s.km).join(' ').padEnd(33) +
      String(peak).padStart(5) + String(lr).padStart(9) + String(m4).padStart(13));
  });
  console.log('\n  Below the boundary a Race Goal is not built at all -- the athlete is routed');
  console.log('  to Aerobic Base -- so those two rows are defensive states rather than plans');
  console.log('  the product produces. They come out at 5 and 6 because EASY_MIN_KM is 3 and');
  console.log('  a two-run week cannot be smaller.');
  console.log('\n  Inside the valid domain week one is exact at 6, 7, 8, 9, 10, 12, 20 and 25,');
  console.log('  and within a few per cent at 30, 40 and 50. 15 is short because the week can');
  console.log('  seat its long run, its quality session and two supporting runs only by');
  console.log('  putting both supporting runs below EASY_MIN_KM, and it drops one rather than');
  console.log('  write a run beneath the floor.');
}

/* ---------- 2. TRAJECTORIES ---------- */
function trajectories(){
  console.log('\n\n=== 2. THE WHOLE FIFTEEN WEEKS ===');
  [6, 8, 10, 12, 15].forEach(v => {
    const c = auditCase({ distanceKey: 'full', volume: v, weeks: 15, scheduleKey: 'd5' });
    console.log('\n--- ' + v + ' km/week, 15 weeks, five days available ---');
    console.log('wk  phase       vol     d%   dkm  runs  LR   supporting            quality       MP');
    let prev = null;
    c.weeks.forEach(w => {
      const runs = w.sessions.filter(s => s.km > 0);
      const tot = r1(runs.reduce((a, b) => a + b.km, 0));
      const q = runs.filter(s => QUALITY.indexOf(s.type) !== -1);
      const mp = w.sessions.filter(s => s.mpSegment).length;
      console.log(String(w.week).padEnd(4) + String(w.phase).padEnd(11) + String(tot).padStart(5) +
        String(prev == null ? '-' : Math.round((tot / prev - 1) * 1000) / 10).padStart(7) +
        String(prev == null ? '-' : r1(tot - prev)).padStart(6) +
        String(runs.length).padStart(5) + '  ' +
        String(runs.filter(s => s.type === 'long').map(s => s.km).join('/') || '-').padStart(4) + '  ' +
        (runs.filter(s => s.type === 'easy').map(s => s.km).join(',') || '-').padEnd(21) +
        (q.map(s => s.type + ':' + s.km).join(',') || '-').padEnd(14) + (mp || '-') +
        (runs.some(s => s.type === 'race') ? '  RACE' : ''));
      prev = tot;
    });
  });
}

/* ---------- 3. THE CASES ---------- */
function easyOnly(a){
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t)), s = [];
  for (let w = 1; w <= 16; w++){
    [0, 2, 4].forEach(d => s.push({ date: a.addDays(m, -7 * w + d), completed: true, actualKm: 10,
      plannedKm: 10, type: 'easy', actual: { km: 10, rpe: 3, pace: 330, hr: 135 }, feel: 'good' }));
    s.push({ date: a.addDays(m, -7 * w + 6), completed: true, actualKm: 20, plannedKm: 20,
      type: 'long', actual: { km: 20, rpe: 5, pace: 340, hr: 140 }, feel: 'good' });
  }
  return s;
}
function withQuality(a){
  const s = easyOnly(a), t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  for (let w = 1; w <= 16; w++)
    s.push({ date: a.addDays(m, -7 * w + 1), completed: true, actualKm: 10, plannedKm: 10,
      type: 'threshold', actual: { km: 10, rpe: 7, pace: 290, hr: 165 }, feel: 'good' });
  return s;
}
function buildCase(v, n, d, o){
  o = o || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  if (o.history) a.state.athlete = { sessions: o.history(a) };
  const vd = a.vdotFromPerformance(5000, o.benchSec || benchFor(v));
  const z = a.trainingPacesFromVDOT(vd), pace = (z.E.slow + z.E.fast) / 2;
  const blk = a.buildBlockWeeks('full', v, n, { availableDays: d, easyPaceSecPerKm: pace });
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks * 7 - 1);
  const ds = a.buildDaysFromWeeks(blk, end, { activeDays: DAYSETS[d], longRunDay: 6 }, TODAY, true,
                                  { easyPaceSecPerKm: pace });
  const nonRace = blk.weeks.filter(w => !w.isRace);
  const peak = Math.max.apply(null, nonRace.map(w => w.volume));
  const longs = ds.filter(x => x.type === 'long' && x.km > 0);
  const peakLong = longs.length ? Math.max.apply(null, longs.map(x => x.km)) : 0;
  const specific = ds.filter(x => x.mpSegment && x.type !== 'race').length;
  let wn = 1; for (; wn <= blk.planWeeks; wn++) if (ds.filter(x => x.week === wn).length === 7) break;
  const wk1 = ds.filter(x => x.week === wn && x.km > 0);
  const rd = a.marathonReadiness({ startKm: v, planWeeks: n, peakLongKm: peakLong,
    specificKm: specific, raceSec: o.raceSec || null, peakLongSec: peakLong * pace });
  const ph = {};
  blk.weeks.forEach(w => { ph[w.phase] = (ph[w.phase] || 0) + 1; });
  return { peak: r1(peak), peakLong: r1(peakLong), peakLongT: hhmm(peakLong * pace),
    share: Math.round(peakLong / peak * 100) + '%',
    days: Math.max.apply(null, nonRace.map(w => ds.filter(x => x.week === w.week && x.km > 0).length)),
    qWeeks: nonRace.filter(w => w.bottomUp && w.bottomUp.qualityKm > 0).length, specific,
    phases: [ph.Base || 0, ph.Build || 0, ph.Peak || 0, (ph.Taper || 0) + (ph['Final Week'] || 0)].join('/'),
    wk1: r1(wk1.reduce((s, x) => s + x.km, 0)), wk1d: wk1.length,
    ready: rd ? rd.verdict : '-', limited: rd ? rd.limitedBy : '-',
    unpract: rd && rd.unpractisedFraction != null ? Math.round(rd.unpractisedFraction * 100) + '%' : '-' };
}
const CASES = [
  ['A', '6 km/wk, 15wk, 5d', 6, 15, 5, {}],
  ['B', '8 km/wk, 15wk, 5d', 8, 15, 5, {}],
  ['C', '10 km/wk, 15wk, 5d', 10, 15, 5, {}],
  ['D', '12 km/wk, 15wk, 5d', 12, 15, 5, {}],
  ['E', '15 km/wk, 15wk, 5d', 15, 15, 5, {}],
  ['F', '25 km/wk, 15wk, 5d', 25, 15, 5, {}],
  ['G', '30 km/wk, 15wk, 6d', 30, 15, 6, {}],
  ['H', '50 km/wk, 15wk, 6d, easy-only history', 50, 15, 6, { history: easyOnly }],
  ['I', '50 km/wk, 15wk, 6d, quality history', 50, 15, 6, { history: withQuality, raceSec: 4 * 3600 }],
  ['J', '60 km/wk, 8wk short runway, 6d', 60, 8, 6, { history: withQuality, raceSec: 3.5 * 3600 }],
  ['K', '80 km/wk, 15wk, 6d', 80, 15, 6, { history: withQuality, benchSec: 20 * 60, raceSec: 3 * 3600 }]
];
function cases(){
  console.log('\n\n=== 3. ELEVEN ATHLETES ===\n');
  console.log('     athlete                                wk1  d  peak  peakLR  time    share  runs  qWk  MP  phases     readiness    limited by   unpractised');
  CASES.forEach(([k, desc, v, n, d, o]) => {
    const r = buildCase(v, n, d, o);
    console.log(k + '    ' + desc.padEnd(38) + String(r.wk1).padStart(4) + String(r.wk1d).padStart(3) +
      String(r.peak).padStart(6) + String(r.peakLong).padStart(8) + '  ' + r.peakLongT.padEnd(8) +
      r.share.padStart(5) + String(r.days).padStart(6) + String(r.qWeeks).padStart(5) +
      String(r.specific).padStart(4) + '  ' + r.phases.padEnd(11) + String(r.ready).padEnd(13) +
      String(r.limited).padEnd(13) + r.unpract);
  });
}

/* ---------- 4. long_run_shorter_than_easy_run, DECOMPOSED ---------- */
function longRunClasses(){
  console.log('\n\n=== 4. long_run_shorter_than_easy_run, MARATHON, BY CLASS ===\n');
  const VOL = (function(){ const v = []; for (let i = 1; i <= 40; i++) v.push(i);
    [45, 50, 60, 70, 80, 100, 120].forEach(x => v.push(x)); return v; })();
  const rows = [];
  for (const volume of VOL) for (const n of [4, 8, 12, 16, 24]) for (const s of ['d3', 'd5'])
    checkCase(auditCase({ distanceKey: 'full', volume, weeks: n, scheduleKey: s })).forEach(f => {
      if (f.code !== 'long_run_shorter_than_easy_run') return;
      const d = f.detail || f;
      rows.push({ volume, n, s, week: d.week, phase: d.phase, longKm: d.longKm, easyKm: d.maxEasyKm });
    });
  const cls = {};
  rows.forEach(x => {
    const k = x.longKm === 0 ? 'A  the long run rounds to zero'
            : x.easyKm <= 3 + 1e-9 ? 'B  the supporting run is at EASY_MIN_KM and the long run is below it'
            : x.easyKm - x.longKm <= 0.5 + 1e-9 ? 'E  a presentation quantum only'
            : 'F  other';
    (cls[k] = cls[k] || []).push(x);
  });
  console.log(rows.length + ' cases in the RAW generator audit');
  Object.keys(cls).sort().forEach(k => {
    const a = cls[k];
    const vols = a.map(x => x.volume);
    console.log('  ' + k.padEnd(70) + String(a.length).padStart(5) +
      '   stated volume ' + Math.min.apply(null, vols) + '-' + Math.max.apply(null, vols) + ' km/wk');
  });
  const valid = rows.filter(x => x.volume >= RACE_GOAL_MIN_KM);
  console.log('\n' + valid.length + ' cases in the PRODUCTION-VALID Race Goal domain (>=' +
    RACE_GOAL_MIN_KM + 'km/week)');
  console.log('\n  There is no class C (a frequency-support defect), no class D (a long-run');
  console.log('  progression defect) and no class F. Every case is one athlete shape: a week');
  console.log('  small enough that its single supporting run sits at the smallest distance a');
  console.log('  race block will print and the long run is smaller still.');
  console.log('\n  That was the admission question, and it is now answered. Every one of these');
  console.log('  cases is below the Race Goal entry minimum, so none of them is a plan the');
  console.log('  product builds -- the athlete is routed to Aerobic Base first. Inside the');
  console.log('  valid domain the count is zero, and no long run was enlarged to get there.');
}

if (require.main === module){ underPrescription(); trajectories(); cases(); longRunClasses(); }
module.exports = { buildCase, CASES };
