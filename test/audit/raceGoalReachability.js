'use strict';
/* THE REACHABILITY GATE (READ ONLY).
 * ===========================================================================
 * A pathway that routinely misses its own destination and leaves readiness to
 * report the miss has failed, however honest the report is. Readiness is for a
 * genuine athlete or runway shortfall; it is not a substitute for a programme
 * architecture that can get there.
 *
 * So this builds the CANONICAL athlete for each pathway -- full runway,
 * matching experience, enough availability, no adverse evidence, nothing
 * artificially high and nothing artificially low -- and measures the
 * capability the block actually establishes BEFORE the taper reduces it,
 * together with the week it was established in.
 *
 *   node test/audit/raceGoalReachability.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const r1 = x => Math.round(x * 10) / 10;
const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);
const DAYSETS = { 3:[1,3,6], 4:[1,3,4,6], 5:[0,1,3,4,6], 6:[0,1,2,3,4,6] };
const TODAY = '2026-03-02T09:00:00Z';

/* THE CANONICAL STARTING EVIDENCE, WRITTEN AS REAL COMPLETED SESSIONS so the
   demonstrated-evidence accessors read it exactly as they read a live athlete.
   Deliberately at the level an athlete APPROPRIATE FOR THE PATHWAY arrives at
   -- not at the destination, which would prove nothing, and not below what the
   pathway can safely accept, which would make the miss legitimate. */
function history(a, o){
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t)), s = [];
  const weeks = o.weeksBack || 20;
  for (let w = 1; w <= weeks; w++){
    (o.easyDays || [0,2,4]).forEach(d => s.push({ date:a.addDays(m,-7*w+d), completed:true,
      actualKm:o.easyKm, plannedKm:o.easyKm, type:'easy',
      actual:{ km:o.easyKm, rpe:3, pace:o.paceSec||400, hr:135 }, feel:'good' }));
    if (o.longKm) s.push({ date:a.addDays(m,-7*w+6), completed:true, actualKm:o.longKm,
      plannedKm:o.longKm, type:'long',
      actual:{ km:o.longKm, rpe:5, pace:(o.paceSec||400)+20, hr:140 }, feel:'good' });
    if (o.qKm) s.push({ date:a.addDays(m,-7*w+3), completed:true, actualKm:o.qKm,
      plannedKm:o.qKm, type:'tempo',
      actual:{ km:o.qKm, rpe:7, pace:(o.paceSec||400)-90, hr:168 }, feel:'good' });
  }
  return s;
}
function build(o){
  const a = loadApp({ pinnedDate: TODAY });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  a.state = a.makeDefaultState();
  a.state.experience = o.exp;
  if (o.easyKm) a.state.athlete = { sessions: history(a, o) };
  const vd = a.vdotFromPerformance(5000, (o.tt5kMin || 24) * 60);
  const z = a.trainingPacesFromVDOT(vd), pace = (z.E.slow + z.E.fast) / 2;
  const days = DAYSETS[o.days || 6], N = o.weeks || 15;
  const start = a.todayStr(), m = a.addDays(start, -a.isoWeekday(start));
  const raceDate = a.addDays(m, N * 7 - 1);
  /* The same fallback the app supplies: with no evidence and no typed figure,
     the week a Race Goal opens on is the pathway's own entry. */
  const elig = a.calibrationEligibility({ healthConsent:true, lthr:null, lthrSource:null,
    performances:[], today:start, currentVolume:o.stated != null ? o.stated : null,
    pathwayEntryKm: a.raceGoalPathwayEntryKm('race', o.dist, o.exp) });
  const blk = a.buildBlockWeeks(o.dist, o.stated != null ? o.stated : null, N,
    { purpose:'race', availableDays:days.length, experience:o.exp, easyPaceSecPerKm:pace,
      calibrate:elig.needed, calibrateWhenViable:elig.reason === 'insufficient_base' });
  const dd = a.buildDaysFromWeeks(blk, raceDate, { activeDays:days, longRunDay:6 },
    start, true, { easyPaceSecPerKm:pace });
  return { a, blk, dd, raceDate, pace, elig };
}
/* THE CAPABILITY A BLOCK ESTABLISHES, measured before the taper takes it away
   and reported with the week it was established in -- a taper deliberately
   reduces load, so judging reachability from race week judges the wrong thing.
   A single anomalous week does not count: the long run must belong to the
   block's own progression, which is asserted by requiring the week that set it
   to be a week the programme actually built rather than a spike. */
function established(res, upTo){
  const byW = {};
  res.blk.weeks.forEach(w => { byW[w.week] = { w:w, d:[] }; });
  res.dd.forEach(x => { if (byW[x.week]) byW[x.week].d.push(x); });
  const rows = Object.keys(byW).map(k => byW[k]).sort((x,y) => x.w.week - y.w.week);
  let peakKm = 0, peakKmWk = null, peakLong = 0, peakLongWk = null, optInPeak = 0;
  const longs = [];
  rows.forEach(rw => {
    const w = rw.w;
    if (w.isRace) return;
    if (upTo && w.week > upTo) return;
    if (w.eventTaperApplied || w.isTaper) return;      // established BEFORE the taper
    const runs = rw.d.filter(x => x.km > 0);
    const vol = r1(runs.reduce((t,x) => t + x.km, 0));
    const lr  = r1(runs.filter(x => x.type === 'long').reduce((t,x) => t + x.km, 0));
    longs.push({ wk:w.week, km:lr });
    if (vol > peakKm){ peakKm = vol; peakKmWk = w.week; }
    if (lr  > peakLong){ peakLong = lr; peakLongWk = w.week; }
    if (w.phase === 'Peak') optInPeak += rw.d.filter(x => x.availableUnused).length;
  });
  /* NOT ONE ACCIDENTAL SPIKE. A capability the athlete met once and never
     approached again is not a capability the programme established, so a
     second exposure is required at or above the deliberate second-exposure
     fraction the architecture itself uses for the marathon's specific week --
     allowing the one kilometre a long run rounds to, since 26 x 0.85 = 22.1
     is written as 22. */
  const second = longs.filter(x => x.wk !== peakLongWk)
                      .map(x => x.km).sort((a,b) => b - a)[0] || 0;
  return { peakKm, peakKmWk, peakLong, peakLongWk, optInPeak, rows, second,
           secondOk: second >= peakLong * 0.85 - 1 - 1e-9,
           secondFrac: peakLong > 0 ? Math.round(second / peakLong * 1000) / 1000 : 0 };
}
function endOfBuild(res){
  const c = res.blk.weeks.filter(w => w.phase === 'Base' || w.phase === 'Build');
  return c.length ? c[c.length - 1].week : null;
}
/* ---- THE CANONICAL ATHLETE IS THE PATHWAY'S OWN LOCKED ENTRY ----
   HQ locked week one for the three marathon pathways at 20 / 30 / 40 km and
   the new half at 15, and the evidence below is written to produce exactly
   those and nothing more: the demonstrated week IS the pathway's entry week and
   the demonstrated long run IS its entry long run. Seeding a canonical athlete
   above the pathway start would bypass the very thing the gate exists to test,
   which is whether the DESIGNED start reaches the DESIGNED destination. */
/* HQ NARROW PATHWAY CORRECTION -- the six pathways' own Start/Build/Peak
   figures moved (see RACE_GOAL_PATHWAY); needBuildKm/needBuildLong/
   needPeakKm/needPeakLong below are re-pointed at the new table so this
   generator keeps testing "reaches its OWN pathway's floor", not a frozen
   one. Only Experienced Half's entry evidence itself needed to change
   (longKm 15->10, easyKm 5->2.5): its entry moved from 30/15 to HQ's new
   20/10, and this fixture is written, per the comment above, to sum to
   exactly the pathway's own entry and nothing more -- every other
   pathway's entry figures are unchanged, so their evidence is too. */
const CANON = [
  { key:'New Half',      dist:'half', exp:'novice',      days:5, weeks:15,
    ev:{ easyKm:3.5, longKm:8, easyDays:[0,2], tt5kMin:28 },
    needBuildKm:30, needBuildLong:16, needPeakKm:35, needPeakLong:16 },
  { key:'Experienced Half', dist:'half', exp:'experienced', days:6, weeks:15,
    ev:{ easyKm:2.5, longKm:10, qKm:5, easyDays:[0,2], tt5kMin:22 },
    needBuildKm:45, needBuildLong:19, needPeakKm:50, needPeakLong:19 },
  { key:'Advanced Half', dist:'half', exp:'advanced',    days:6, weeks:15,
    ev:{ easyKm:6, longKm:20, qKm:7, easyDays:[0,2,4], tt5kMin:18 },
    needBuildKm:75, needBuildLong:22, needPeakKm:85, needPeakLong:22 },
  { key:'New Marathon',  dist:'full', exp:'novice',      days:5, weeks:15,
    ev:{ easyKm:5, longKm:10, easyDays:[0,2], tt5kMin:28 },
    needBuildKm:50, needBuildLong:28, needPeakKm:55, needPeakLong:28 },
  { key:'Experienced Marathon', dist:'full', exp:'experienced', days:6, weeks:15,
    ev:{ easyKm:6, longKm:18, qKm:4, easyDays:[0,2,4], tt5kMin:22 },
    needBuildKm:65, needBuildLong:30, needPeakKm:75, needPeakLong:30 },
  { key:'Advanced Marathon', dist:'full', exp:'advanced',    days:6, weeks:15,
    ev:{ easyKm:10, longKm:24, qKm:6, easyDays:[0,2,4], tt5kMin:18 },
    needBuildKm:80, needBuildLong:32, needPeakKm:90, needPeakLong:32 }
];
/* ---- AND THE SAME SIX AT THE ADMISSION FLOOR ----
   HQ admits Race Goal from ten weeks. The ten-week programme has four fewer
   development weeks than the fifteen and the same event to prepare for, so it
   is the harder half of the reachability question and it is asked separately
   rather than assumed. */
const CANON_10 = CANON.map(function(c){
  return Object.assign({}, c, { weeks:10, key:c.key + ' @10w' });
});
const HIGH = [
  { key:'Advanced Half @ ~86km',     dist:'half', exp:'advanced', days:6, weeks:15,
    ev:{ easyKm:15, longKm:24, qKm:15, easyDays:[0,1,2,3,4], tt5kMin:16 }, floorKm:80 },
  { key:'Advanced Marathon @ ~95km', dist:'full', exp:'advanced', days:6, weeks:15,
    ev:{ easyKm:16, longKm:30, qKm:16, easyDays:[0,1,2,3,4], tt5kMin:16 }, floorKm:70 }
];
function run(set, label){
  const CASES = set || CANON;
  console.log('REACHABILITY — capability established BEFORE taper, canonical pathway athlete' +
              (label ? '  [' + label + ']' : ''));
  console.log('');
  console.log(padr('pathway',22)+pad('entry',6)+pad('demLR',6)+'  '+pad('needKm',7)+pad('got',6)+pad('wk',4)+
              '  '+pad('needLR',7)+pad('got',6)+pad('wk',4)+pad('2nd',7)+pad('frac',6)+pad('optPk',6)+
              '  verdict   missing        readiness');
  console.log(padr('',22)+'  PASS = establishes the standard.  DECLARED = falls short and readiness says so.');
  const out = [];
  CASES.forEach(c => {
    const res = build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const p = established(res, null);
    const bu = res.blk.weeks.filter(w => w.bottomUp)[0].bottomUp;
    const rd = res.a.raceGoalReadiness(c.dist, c.exp, res.blk);
    /* THE GATE, STATED THE WAY HQ STATED IT. The capability the block
       establishes before the taper reduces it, against the pathway's own
       requirement -- the higher of its Build and Peak figures, because a
       pathway that asks for a capability in Build has not delivered it by
       reaching it only in the taper. */
    /* ---- WHAT IS A REQUIREMENT AND WHAT IS AN ASPIRATION, IN HQ'S OWN WORDS ----
       HQ states the end-Build capabilities with "≥" and the Peak weekly figures
       with "where supported" and "~". The first are standards the programme
       must establish; the second describe what a Peak may develop into when the
       athlete supports it, and HQ says explicitly they are "not universal Peak
       ceilings". So the weekly requirement asked here is the end-BUILD figure,
       and the Peak weekly figure is reported beside it rather than gating on it.
       The long run is asked at the higher of the two, because every long-run
       figure HQ states is a "≥". */
    const needKm   = c.needBuildKm || 0;
    const wantKm   = Math.max(c.needBuildKm || 0, c.needPeakKm || 0);
    const needLong = Math.max(c.needBuildLong || 0, c.needPeakLong || 0);
    const okKm     = p.peakKm   >= needKm   - 0.05;
    const okLong   = p.peakLong >= needLong - 0.05;
    const okSecond = p.secondOk;
    const met      = okKm && okLong && okSecond && p.optInPeak === 0;
    /* ---- A SHORTFALL THE PROGRAMME DECLARES IS NOT THE SAME DEFECT ----
       HQ: safety may delay or prevent an athlete reaching a preparation
       standard, and where it does Valhalla must expose an honest readiness
       shortfall. A pathway that misses and SAYS SO is that instruction working.
       A pathway that misses while readiness reports READY is the failure this
       gate exists to catch, because that is the programme calling inadequate
       preparation adequate. */
    const declared = !met && rd && rd.verdict !== 'READY';
    const pass = met || declared;
    out.push({ key:c.key, pass:pass, met:met, declared:declared, rd:rd, p:p,
               needKm:needKm, wantKm:wantKm, needLong:needLong,
               okKm:okKm, okLong:okLong, okSecond:okSecond });
    console.log(padr(c.key,22)+pad(bu.entryKm,6)+pad((bu.origin&&bu.origin.demonstratedLongKm)||'-',6)+
      '  '+pad(needKm,7)+pad(r1(p.peakKm),6)+pad(p.peakKmWk||'-',4)+
      '  '+pad(needLong,7)+pad(r1(p.peakLong),6)+pad(p.peakLongWk||'-',4)+
      pad(r1(p.second),7)+pad(p.secondFrac,6)+pad(p.optInPeak,6)+'  '+
      (met?'PASS    ':declared?'DECLARED':'**FAIL**')+'  '+
      [okKm?null:'km',okLong?null:'long',okSecond?null:'2nd',
       p.optInPeak===0?null:'optional'].filter(x=>x).join(',').padEnd(14)+
      ' readiness '+rd.verdict);
  });
  console.log('');
  console.log('HIGH-CAPACITY REGRESSION — minimums must not become ceilings');
  HIGH.forEach(c => {
    const res = build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks }, c.ev));
    const p = established(res, null);
    const bu = res.blk.weeks.filter(w => w.bottomUp)[0].bottomUp;
    const pass = p.peakKm > c.floorKm + 0.05;
    console.log('  '+padr(c.key,26)+' demonstrated '+pad(bu.entryKm,5)+
      '  destination '+pad(bu.volumeDestKm,5)+'  established peak '+pad(r1(p.peakKm),6)+
      '  vs pathway minimum '+pad(c.floorKm,4)+'   '+(pass?'PASS':'**FAIL**'));
  });
  return out;
}
if (require.main === module){
  run(CANON, '15 weeks');
  console.log('');
  run(CANON_10, '10 weeks — the admission floor');
}
/* The pathway a canonical case belongs to, so the contract tests can ask what
   its own standards are rather than restating them. */
function PATHWAY_OF(c){
  const a = build({ dist:c.dist, exp:c.exp, days:c.days, weeks:c.weeks, easyKm:3, longKm:5 }).a;
  return a.raceGoalPathway(c.dist, c.exp);
}
module.exports = { build, established, endOfBuild, CANON, CANON_10, HIGH, run, PATHWAY_OF };
