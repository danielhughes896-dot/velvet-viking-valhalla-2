'use strict';
/* MARATHON VOLUME + LONG-RUN PROGRESSION — READ-ONLY EVIDENCE
 * node test/audit/marathonProgression.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const TODAY='2026-08-30';
const S={activeDays:[0,1,2,3,4,6],longRunDay:6};
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
const VOLS=[10,20,30,40,50,60,80,100], WKS=[12,14,16,18,20,24];
const REQ=a.MIN_PEAK_LONG_KM.full;

function trajectory(v,w){
  a.state=a.makeDefaultState();
  let blk; try { blk=a.buildBlockWeeks('full',v,w,{}); } catch(e){ return null; }
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true);
  const rows=[];
  blk.weeks.forEach(wk=>{
    const wd=ds.filter(x=>x.week===wk.week);
    if (wd.length<7) return;                       // partial first calendar week
    const longs=wd.filter(x=>x.type==='long');
    const alloc=longs.reduce((t,x)=>t+(x.km||0),0);
    const seg=longs.reduce((t,x)=>t+((x.prescription&&x.prescription.params&&x.prescription.params.finishKm)||0),0);
    rows.push({ week:wk.week, phase:wk.phase||(wk.isRace?'Race':'?'), cutback:!!wk.isCutback,
      target:r1(wk.volume), km:r1(wd.reduce((t,x)=>t+(x.km||0),0)),
      long:r1(alloc), seg:r1(seg) });
  });
  /* GROWTH, DECOMPOSED. The raw maximum week-over-week step is dominated by
     recovery FROM a cutback -- CUTBACK_FACTOR is 0.78, so returning to the ramp
     is +28% by construction and says nothing about progression. Reporting that
     as the growth rate would be the instrument misleading the reader. The
     progression figure below therefore excludes any step out of a cutback
     week, and the cutback rebound is reported separately. */
  let maxWk=0,maxWkPct=0,maxLong=0,maxRebound=0;
  for(let i=1;i<rows.length;i++){
    if (rows[i].phase==='Taper'||rows[i].phase==='Race'||rows[i].phase==='Final Week') continue;
    const dv=rows[i].km-rows[i-1].km, dl=rows[i].long-rows[i-1].long;
    if (rows[i-1].cutback){ if (dv>maxRebound) maxRebound=dv; continue; }
    if (dv>maxWk){ maxWk=dv; maxWkPct=rows[i-1].km?100*dv/rows[i-1].km:0; }
    if (dl>maxLong) maxLong=dl;
  }
  const peak=rows.reduce((b,r)=>r.km>b.km?r:b,rows[0]);
  const peakLong=rows.reduce((b,r)=>r.long>b.long?r:b,rows[0]);
  return { rows, peakKm:peak.km, peakLong:peakLong.long, peakLongWeek:peakLong.week,
    shareAtPeakLong: peakLong.km? Math.round(100*peakLong.long/peakLong.km):0,
    maxWk:r1(maxWk), maxWkPct:Math.round(maxWkPct), maxLong:r1(maxLong),
    maxRebound:r1(maxRebound),
    reaches: peakLong.long+0.05>=REQ, cutbacks:rows.filter(r=>r.cutback).length,
    pathway:a.athletePathway('full',v,w).route };
}

console.log('=== A. ROOT CAUSE, IN TWO MULTIPLICATIONS ===');
console.log('  peakVolume = startVolume x developmentMultiplierFor(full, weeks)   [volMult 1.75]');
console.log('  longTarget = min(profile.longCapKm 32, peakVolume x LONG_FRACTION.endurance 0.32)');
console.log('  Both are PROPORTIONAL, so a low start scales the whole programme down.');
console.log('  MIN_PEAK_LONG_KM = %d appears nowhere in plan construction: it is read only', REQ);
console.log('  by minViableStartKm/raceProgrammeViability/athletePathway, none of which');
console.log('  handleGeneratePlan() calls.\n');
[30,40,58,60].forEach(v=>{
  const m=a.developmentMultiplierFor('full',16);
  console.log('  start '+num(v,4)+' x '+r1(m)+' = peak '+num(r1(v*m),6)+
    ' -> long min(32, '+r1(v*m*0.32)+') = '+num(r1(Math.min(32,v*m*0.32)),5)+' km');
});

console.log('\n\n=== C. POPULATION: 8 STARTS x 6 DURATIONS ===');
console.log(pad('start',6)+pad('wks',5)+num('peakKm',8)+num('peakLong',10)+num('long%wk',9)+
  num('maxWk+',8)+num('maxWk%',8)+num('maxLong+',10)+num('cutbk',7)+num('>=30',6)+'  pathway');
const all=[];
VOLS.forEach(v=>{ WKS.forEach(w=>{
  const t=trajectory(v,w); if(!t) return; all.push(Object.assign({v,w},t));
  console.log(pad(v,6)+pad(w,5)+num(t.peakKm,8)+num(t.peakLong,10)+num(t.shareAtPeakLong+'%',9)+
    num(t.maxWk,8)+num(t.maxWkPct+'%',8)+num(t.maxLong,10)+num(t.cutbacks,7)+
    num(t.reaches?'YES':'no',6)+'  '+t.pathway);
}); });
console.log('\n  reaching %d km: %d of %d combinations (%d%%)', REQ,
  all.filter(x=>x.reaches).length, all.length,
  Math.round(100*all.filter(x=>x.reaches).length/all.length));
console.log('  lowest start that reaches it: %s km/wk',
  all.filter(x=>x.reaches).length? Math.min.apply(null,all.filter(x=>x.reaches).map(x=>x.v)) : 'none');
console.log('  MORE WEEKS DO NOT HELP: for a fixed start, peak long run by duration --');
VOLS.forEach(v=>{
  const r=WKS.map(w=>{ const x=all.filter(y=>y.v===v&&y.w===w)[0]; return x? w+'wk:'+x.peakLong : null; })
    .filter(Boolean);
  console.log('    start '+num(v,4)+'  '+r.join('  '));
});

console.log('\n\n=== D. LONG RUN vs WEEKLY VOLUME, AND WHAT ACTUALLY GROWS ===');
console.log('Progression growth EXCLUDES recovery out of a cutback week');
console.log('(CUTBACK_FACTOR 0.78 makes that step +28%% by construction).\n');
console.log(pad('start',6)+pad('wks',5)+num('peakKm',8)+num('peakLong',10)+num('long%',7)+
  num('progr+',8)+num('progr%',8)+num('rebound+',10)+num('longStep+',11));
all.forEach(x=>console.log(pad(x.v,6)+pad(x.w,5)+num(x.peakKm,8)+num(x.peakLong,10)+
  num(x.shareAtPeakLong+'%',7)+num(x.maxWk,8)+num(x.maxWkPct+'%',8)+
  num(x.maxRebound,10)+num(x.maxLong,11)));
const g=all.map(x=>x.maxWkPct).sort((p,q)=>p-q);
console.log('\n  progression step, whole population: min %d%%  median %d%%  max %d%%',
  g[0], g[Math.floor(g.length/2)], g[g.length-1]);
console.log('  VOLUME_BLOCK_GROWTH_CAP is %s and applies BLOCK to BLOCK, not week to week.',
  a.VOLUME_BLOCK_GROWTH_CAP);
console.log('  There is no per-week growth authority inside a block: the ramp shape is');
console.log('  blockArcFor() + volMult, and it is the same shape at every start volume.');

console.log('\n\n=== J. EXEMPLAR TRAJECTORIES (16 weeks) ===');
[10,20,30,40,58,80].forEach(v=>{
  const t=trajectory(v,16); if(!t) return;
  console.log('\n-- start %s km/wk, 16 weeks -- pathway says: %s', v, t.pathway);
  console.log('   '+pad('wk',4)+pad('phase',12)+num('week km',9)+num('long km',9)+
    num('long%',7)+num('goal seg',10)+'  ');
  t.rows.forEach(r=>console.log('   '+pad(r.week,4)+pad(r.phase+(r.cutback?' (cut)':''),12)+
    num(r.km,9)+num(r.long,9)+num(r.km?Math.round(100*r.long/r.km)+'%':'-',7)+
    num(r.seg||'-',10)));
  console.log('   peak %s km/wk, peak long %s km, %s the %d km requirement',
    t.peakKm, t.peakLong, t.reaches?'MEETS':'MISSES', REQ);
});

console.log('\n\n=== G. CAN TIME BUY PREPARATION TODAY? ===');
console.log('developmentMultiplierFor(full, W) = 1 + (volMult-1) x min(1, buildWeeks/ref)');
console.log('where ref is the 14-week race block. Above that it is volMult exactly.\n');
console.log('  '+pad('weeks',8)+num('buildWeeks',12)+num('multiplier',12)+
  num('peak from 40',14)+num('long',7));
[8,10,12,14,16,20,24,30,40,52].forEach(w=>{
  const arc=a.blockArcFor('race',w), m=a.developmentMultiplierFor('full',w);
  console.log('  '+pad(w,8)+num(arc.buildWeeks,12)+num(Math.round(m*1000)/1000,14)+
    num(r1(40*m),14)+num(r1(Math.min(32,40*m*0.32)),7));
});
console.log('\n  Beyond 14 weeks the multiplier is FLAT. A 40 km/wk athlete peaks at');
console.log('  70 km/wk and a 22 km long run whether they have 16 weeks or 52.');
console.log('  There is no mechanism by which additional time develops the athlete further.');
