'use strict';
/* RUNWAY MATRIX + CASE COHORTS. READ-ONLY.
 * node test/audit/marathonRunwayMatrix.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};
const TODAY='2026-08-30';
const DAYSETS={2:[1,6],3:[1,3,6],4:[1,3,4,6],5:[0,1,3,4,6],6:[0,1,2,3,4,6]};
const benchFor=v=> v<20?33*60 : v<35?29*60 : v<50?26*60 : v<70?23*60 : 20*60;

function build(v,W,days,raceSec){
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const S={activeDays:DAYSETS[days],longRunDay:6};
  const blk=a.buildBlockWeeks('full',v,W,{});
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true);
  a.state.days=ds;
  a.state.setup={distanceKey:'full',currentVolume:v,planWeeks:blk.planWeeks,schedule:S,
    benchmark:{distanceKey:'5k',timeSec:benchFor(v)},goals:{A:{timeSec:raceSec}},activeGoal:'A',
    paceOverrides:{},lthr:165,maxHR:190,experience:'experienced',
    startDate:TODAY,raceDate:end,hasEvent:true,purpose:'race'};
  const z=a.getActivePaces(); const pace=(z.E.slow+z.E.fast)/2;
  const longs=ds.filter(d=>d.type==='long'&&d.km>0).map(d=>d.km).sort((x,y)=>y-x);
  const peakVol=Math.max.apply(null,blk.weeks.filter(w=>!w.isRace&&w.phase!=='Taper').map(w=>w.volume));
  const ph={Base:0,Build:0,Peak:0,Taper:0,Final:0};
  blk.weeks.forEach(w=>{ ph[a.phaseForWeek(w.week,blk.planWeeks,'race')]++; });
  const top=longs[0]||0;
  return {a,blk,ds,pace,peakVol,top,second:longs[1]||0,ph,
    unpract: Math.max(0, Math.round(100*(1 - (top*pace)/raceSec))),
    qf: blk.qualityFrequency||{}};
}

console.log('=== 1. RUNWAY MATRIX — 5h00 MARATHON ATHLETE, 40 km/wk, 6 DAYS ===');
console.log('What the engine builds today at each runway. No proposal in this table.\n');
console.log(pad('N',5)+pad('Ba/Bu/Pk/Tp/F',16)+num('peak wk km',12)+num('peak long',11)+
  num('long time',11)+num('2nd long',10)+num('unpract',9));
[4,6,8,10,12,14,15,16,20,24,30].forEach(N=>{
  const r=build(40,N,6,5*3600);
  console.log(pad(N,5)+pad([r.ph.Base,r.ph.Build,r.ph.Peak,r.ph.Taper,r.ph.Final].join('/'),16)+
    num(r1(r.peakVol),12)+num(r1(r.top),11)+num(hhmm(r.top*r.pace),11)+num(r1(r.second),10)+
    num(r.unpract+'%',9));
});
console.log('\n  Note the top of the table. At N=4 the engine allocates 0 Base, 0 Build,');
console.log('  1 Peak, 2 Taper, 1 Final: three of the four weeks are wind-down. It does not');
console.log('  refuse, and it does not warn -- it builds a taper for a marathon the athlete');
console.log('  has not trained for. That is the clearest short-runway defect in the engine,');
console.log('  and it is a direct consequence of taper being subtracted before phases are');
console.log('  allocated rather than protected within a coherent shape.');

console.log('\n\n=== 2. THE SAME RUNWAYS, ACROSS STARTING CAPACITY ===');
console.log('peak weekly volume / peak long run. Shows what runway actually buys.\n');
const vols=[12,25,40,50,60,80];
console.log(pad('N',5)+vols.map(v=>num(v+'km',12)).join(''));
[8,10,12,15,20,24,30].forEach(N=>{
  let line=pad(N,5);
  vols.forEach(v=>{ const r=build(v,N,6,5*3600); line+=num(r1(r.peakVol)+'/'+r1(r.top),12); });
  console.log(line);
});
console.log('\n  Read any column downward. Between N=15 and N=30 nothing moves: the');
console.log('  destination is fixed by developmentMultiplierFor(), which saturates at 14');
console.log('  weeks. Fifteen extra weeks of an athlete\'s life buy zero additional volume');
console.log('  and zero additional long run. They buy dilution.');
console.log('  Read any row across. The destination is proportional to the START -- the');
console.log('  12 km athlete and the 80 km athlete are sent to destinations 7x apart at');
console.log('  every runway, which is the settled "destination-led, not start x multiplier"');
console.log('  finding still awaiting implementation.');

console.log('\n\n=== 3. HQ CASES A-G, AS THE ENGINE BUILDS THEM TODAY ===\n');
const cases=[
 ['A','15wk, 50km, 6d, quality history',50,15,6,4*3600],
 ['B','15wk, 50km, 6d, easy-only history',50,15,6,4*3600],
 ['C','15wk, <15km, 6d',12,15,6,5.5*3600],
 ['D','9wk, 60km, 6d, established',60,9,6,3.5*3600],
 ['E','9wk, <15km, 6d',12,9,6,5.5*3600],
 ['F','24wk, aerobic weakness',25,24,6,5*3600],
 ['G','24wk, strong base, speed need',60,24,6,3.5*3600]];
console.log(pad('case',5)+pad('description',36)+pad('phases',14)+num('runs',6)+num('qual',6)+
  num('peak wk',9)+num('peak long',11)+num('unpract',9));
cases.forEach(([id,desc,v,N,d,rs])=>{
  const r=build(v,N,d,rs);
  let wn=1; for(;wn<=r.blk.planWeeks;wn++){ if(r.ds.filter(x=>x.week===wn).length===7) break; }
  const runs=r.ds.filter(x=>x.week===wn&&x.km>0).length;
  console.log(pad(id,5)+pad(desc,36)+
    pad([r.ph.Base,r.ph.Build,r.ph.Peak,r.ph.Taper,r.ph.Final].join('/'),14)+
    num(runs,6)+num(r.qf.prescribed,6)+num(r1(r.peakVol),9)+num(r1(r.top),11)+num(r.unpract+'%',9));
});
console.log('\n  A and B are IDENTICAL rows. The engine cannot see the difference between');
console.log('  50 km of threshold-and-interval history and 50 km of easy running, because');
console.log('  currentVolume is a scalar and no quality-history input reaches the plan.');
console.log('  That is the single most important gap SYSTEM 8 asks about, and it is a');
console.log('  missing INPUT, not a missing rule.');
console.log('');
console.log('  D and E differ only in starting volume, and correctly so -- but both get a');
console.log('  Base phase at N=9 (1 week), which HQ\'s hypothesis would remove. Neither is');
console.log('  told the runway is short.');
console.log('');
console.log('  F and G are also identical in shape: 24 weeks, five Base weeks, five Peak');
console.log('  weeks, one stretched Race Goal block. Neither is offered a development');
console.log('  programme; neither retains a future destination, because no such state');
console.log('  exists.');
