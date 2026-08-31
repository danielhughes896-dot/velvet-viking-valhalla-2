'use strict';
/* PATHWAY ACTIVATION — FEASIBILITY EVIDENCE
 * ===========================================================================
 * What activating athletePathway() at the generation boundary would actually
 * require, and what it would do at every viability boundary.
 *
 * node test/audit/pathwayActivation.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY = '2026-08-30';
const S = { activeDays: [0,1,2,3,4,6], longRunDay: 6 };
const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const DISTANCES = ['5k','10k','half','full','ultra'];

/* What the athlete gets TODAY: one race block from their stated volume. */
function directPlan(dist, vol, weeks){
  a.state = a.makeDefaultState();
  const blk = a.buildBlockWeeks(dist, vol, weeks, {});
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks*7 - 1);
  const ds = a.buildDaysFromWeeks(blk, end, S, TODAY, true);
  return summarise(blk, ds, 0);
}
/* What the pathway says they should get: on-ramp, then the race block. */
function routedPlan(dist, vol, weeks, p){
  const startMonday = a.addDays(TODAY, -a.isoWeekday(TODAY));
  const rampEnd = a.addDays(startMonday, p.onRampWeeks*7 - 1);
  const raceEnd = a.addDays(startMonday, weeks*7 - 1);
  a.state = a.makeDefaultState();
  const rb = a.buildBlockWeeks(dist, vol, p.onRampWeeks, { purpose:'onramp', rampToKm:p.onRampToKm });
  const rd = a.buildDaysFromWeeks(rb, rampEnd, S, TODAY, false);
  a.state = a.makeDefaultState();
  const cb = a.buildBlockWeeks(dist, p.raceBlockStartKm, p.raceBlockWeeks, {});
  const cd = a.buildDaysFromWeeks(cb, raceEnd, S, a.addDays(rampEnd,1), true);
  const off = Math.max.apply(null, rd.map(d=>d.week));
  return summarise(cb, rd.concat(cd.map(d=>Object.assign({},d,{week:d.week+off}))), off, rb);
}
function summarise(blk, days, offset, rampBlk){
  const weeks=[...new Set(days.map(d=>d.week))].filter(Boolean).sort((x,y)=>x-y);
  let peakVol=0, peakLong=0, quality=0, runDays=0, n=0;
  weeks.forEach(w=>{
    const wd=days.filter(d=>d.week===w);
    if (wd.length<7) return;
    n++;
    const v=wd.reduce((t,d)=>t+(d.km||0),0);
    if (v>peakVol) peakVol=v;
    const alloc=wd.filter(d=>d.type==='long').reduce((t,d)=>t+(d.km||0),0);
    if (alloc>peakLong) peakLong=alloc;
    quality+=wd.filter(d=>['tempo','threshold','interval','repetition','checkpoint','calibration'].indexOf(d.type)!==-1).length;
    runDays+=wd.filter(d=>(d.km||0)>0).length;
  });
  return { weeks:weeks.length, peakVol:r1(peakVol), peakLong:r1(peakLong),
           qualityPerWeek: n? Math.round(10*quality/n)/10 : 0,
           runDaysPerWeek: n? Math.round(10*runDays/n)/10 : 0,
           firstQualityWeek: (function(){
             for (const w of weeks){ const wd=days.filter(d=>d.week===w);
               if (wd.some(d=>['tempo','threshold','interval','repetition'].indexOf(d.type)!==-1)) return w; }
             return null; })(),
           offset: offset };
}

console.log('=== 1. THE ADMISSION BOUNDARY, EVERY DISTANCE ===');
console.log('For each distance: just below admission, at it, just above.\n');
console.log(pad('dist',7)+pad('weeks',7)+num('start',7)+pad('  route',22)+
  num('peakVol',9)+num('peakLong',10)+num('floor',7)+num('q/wk',7)+num('1st q wk',10));
DISTANCES.forEach(d => {
  [12,16,20].forEach(w => {
    const floorStart = a.minViableStartKm(d, w);
    [r1(floorStart-1), floorStart, r1(floorStart+1)].forEach(v => {
      const p = a.athletePathway(d, v, w);
      let s;
      if (p.route === 'race_programme') s = directPlan(d, v, w);
      else if (p.route === 'on_ramp_then_race') s = routedPlan(d, v, w, p);
      else { console.log(pad(d,7)+pad(w+'wk',7)+num(v,7)+pad('  '+p.route,22)+'   '+(p.reason||'')); return; }
      console.log(pad(d,7)+pad(w+'wk',7)+num(v,7)+pad('  '+p.route,22)+
        num(s.peakVol,9)+num(s.peakLong,10)+num(a.MIN_PEAK_LONG_KM[d],7)+
        num(s.qualityPerWeek,7)+num(s.firstQualityWeek==null?'-':s.firstQualityWeek,10));
    });
  });
});

console.log('\n\n=== 2. MARATHON POPULATION: TODAY vs ACTIVATED ===');
console.log(pad('start',7)+pad('weeks',7)+pad('route',22)+
  num('TODAY long',12)+num('ACTIVATED',11)+num('floor',7)+'  change');
[25,40,50,53,55,70,90].forEach(v => {
  [12,16,20,24].forEach(w => {
    const p = a.athletePathway('full', v, w);
    const before = directPlan('full', v, w);
    let after = null;
    if (p.route === 'race_programme') after = before;
    else if (p.route === 'on_ramp_then_race') after = routedPlan('full', v, w, p);
    console.log(pad(v,7)+pad(w+'wk',7)+pad(p.route,22)+
      num(before.peakLong,12)+num(after?after.peakLong:'—',11)+num(30,7)+
      '  '+(after ? (after.peakLong>before.peakLong+0.05 ? '+'+r1(after.peakLong-before.peakLong)+' km, now reaches the floor'
                    : after.peakLong<before.peakLong-0.05 ? r1(after.peakLong-before.peakLong)+' km'
                    : 'unchanged') : p.reason||''));
  });
});

console.log('\n\n=== 3. THE SEAM: does the race block resume where the on-ramp left off? ===');
console.log(pad('dist',7)+num('start',7)+num('weeks',7)+num('rampTo',9)+
  num('race wk1',10)+num('step',7)+'  (a step is the athlete\'s first race-block week vs their last on-ramp week)');
DISTANCES.forEach(d => {
  [16,20].forEach(w => {
    const v = r1(a.minViableStartKm(d, w) - 8);
    const p = a.athletePathway(d, v, w);
    if (p.route !== 'on_ramp_then_race') return;
    a.state = a.makeDefaultState();
    const rb = a.buildBlockWeeks(d, v, p.onRampWeeks, { purpose:'onramp', rampToKm:p.onRampToKm });
    a.state = a.makeDefaultState();
    const cb = a.buildBlockWeeks(d, p.raceBlockStartKm, p.raceBlockWeeks, {});
    const last = rb.weeks[rb.weeks.length-1].volume, first = cb.weeks[0].volume;
    console.log(pad(d,7)+num(v,7)+num(w,7)+num(r1(p.onRampToKm),9)+
      num(r1(first),10)+num('+'+r1(first-last),7));
  });
});
