'use strict';
/* MARATHON TAPER — EXACT RACE-RELATIVE ARITHMETIC. Read-only.
 * node test/audit/marathonTaper.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const TODAY='2026-08-30';
const S={activeDays:[0,1,2,3,4,6],longRunDay:6};
const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};

console.log('=== THE ARITHMETIC, AS WRITTEN ===');
console.log('  taperWeeksFor(planWeeks): <=2 -> 0, ==3 -> 1, otherwise -> 2');
console.log('  computeTaperInfo: buildWeeks = planWeeks - taper - 1');
console.log('  isRace  = (w === N)          isTaper = (w > buildWeeks && !isRace)');
console.log('  So the block is buildWeeks + TWO taper weeks + ONE race week.');
console.log('  Distance-blind and duration-blind above 3 weeks:');
console.log('    '+[4,8,12,14,16,20,24,52].map(w=>w+'wk->'+a.taperWeeksFor(w)).join('  '));

console.log('\n=== WHAT THAT MEANS IN DAYS BEFORE RACE DAY ===');
[12,16,20].forEach(W=>{
  a.state=a.makeDefaultState();
  const blk=a.buildBlockWeeks('full',60,W,{});
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true);
  const race=ds.filter(d=>d.type==='race')[0];
  const daysBefore=d=>a.daysBetween(d, race.date);
  const firstTaper=blk.weeks.filter(w=>w.phase==='Taper')[0];
  const ftDays=ds.filter(d=>d.week===firstTaper.week).sort((x,y)=>x.date<y.date?-1:1);
  const raceWeekDays=ds.filter(d=>d.week===blk.planWeeks).sort((x,y)=>x.date<y.date?-1:1);
  const lastLong=ds.filter(d=>d.type==='long').sort((x,y)=>x.date<y.date?-1:1).pop();
  const lastSpecific=ds.filter(d=>d.mpSegment&&d.type!=='race').sort((x,y)=>x.date<y.date?-1:1).pop();
  const peakWk=blk.weeks.filter(w=>w.phase==='Peak').pop();
  const lastFullTrain=ds.filter(d=>d.week===peakWk.week).sort((x,y)=>x.date<y.date?-1:1).pop();
  console.log('\n-- %d-week marathon, race %s (%s) --', W, race.date, a.dow(race.date));
  console.log('   last full training day        %s  (%s)  D-%d',
    lastFullTrain.date, a.dow(lastFullTrain.date), daysBefore(lastFullTrain.date));
  console.log('   taper reduction BEGINS        %s  (%s)  D-%d',
    ftDays[0].date, a.dow(ftDays[0].date), daysBefore(ftDays[0].date));
  console.log('   race week begins              %s  (%s)  D-%d',
    raceWeekDays[0].date, a.dow(raceWeekDays[0].date), daysBefore(raceWeekDays[0].date));
  console.log('   final long run                %s  (%s)  D-%d  %s km',
    lastLong.date, a.dow(lastLong.date), daysBefore(lastLong.date), lastLong.km);
  console.log('   final marathon-specific work  %s  (%s)  D-%d',
    lastSpecific?lastSpecific.date:'-', lastSpecific?a.dow(lastSpecific.date):'-',
    lastSpecific?daysBefore(lastSpecific.date):'-');
  const peakVol=Math.max.apply(null, blk.weeks.filter(w=>w.phase!=='Taper'&&!w.isRace).map(w=>w.volume));
  console.log('   peak training week            %s km', r1(peakVol));
  blk.weeks.filter(w=>w.phase==='Taper'||w.isRace).forEach(w=>{
    const wd=ds.filter(x=>x.week===w.week);
    const km=wd.reduce((t,x)=>t+(x.km||0),0);
    const runDays=wd.filter(x=>(x.km||0)>0).length;
    const q=wd.filter(x=>['tempo','threshold','interval','repetition'].indexOf(x.type)!==-1).length;
    const training=w.isRace? km - (wd.filter(x=>x.type==='race')[0]||{km:0}).km : km;
    console.log('   %s week %d: %s km training (%d%% of peak), %d run days, %d quality',
      pad(w.isRace?'RACE ':'taper',5), w.week, num(r1(training),5),
      Math.round(100*training/peakVol), runDays, q);
  });
});
