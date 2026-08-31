'use strict';
/* WHAT A MARATHON WEEK ACTUALLY CONTAINS AT EACH PRESCRIBED FREQUENCY.
 * Read-only. node test/audit/marathonFrequencyCoherence.js
 *
 * No proposal in sections 1-3. This measures the week the engine builds, so
 * the frequency decision can be designed against real session sizes rather
 * than against a renderability formula.
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};
const mm=s=>Math.round(s/60)+'m';
const TODAY='2026-08-30';
const DAYSETS={2:[1,6],3:[1,3,6],4:[1,3,4,6],5:[0,1,3,4,6],6:[0,1,2,3,4,6]};
/* Slower athletes at lower volume: a stated modelling assumption, so the time
   readings are realistic rather than flattering. */
const benchFor=v=> v<20?33*60 : v<35?29*60 : v<50?26*60 : v<70?23*60 : 20*60;

function week(volume, days, weekIndex){
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const S={activeDays:DAYSETS[days],longRunDay:6};
  const blk=a.buildBlockWeeks('full',volume,15,{});
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true);
  a.state.days=ds;
  a.state.setup={distanceKey:'full',currentVolume:volume,planWeeks:blk.planWeeks,schedule:S,
    benchmark:{distanceKey:'5k',timeSec:benchFor(volume)},goals:{A:{timeSec:4*3600}},activeGoal:'A',
    paceOverrides:{},lthr:165,maxHR:190,experience:'experienced',
    startDate:TODAY,raceDate:end,hasEvent:true,purpose:'race'};
  const z=a.getActivePaces(); const pace=(z.E.slow+z.E.fast)/2;
  let wn=1; for(;wn<=blk.planWeeks;wn++){ if(ds.filter(x=>x.week===wn).length===7) break; }
  const target = weekIndex===undefined ? wn : weekIndex;
  const d=ds.filter(x=>x.week===target);
  const runs=d.filter(x=>x.km>0);
  const long=runs.filter(x=>x.type==='long')[0]||null;
  const qual=runs.filter(x=>['tempo','threshold','interval','repetition'].includes(x.type));
  const easy=runs.filter(x=>x.type==='easy');
  return { a, pace, blk, wk:blk.weeks[target-1],
    runs:runs.length, unused:d.filter(x=>x.availableUnused).length,
    km:r1(runs.reduce((t,x)=>t+x.km,0)),
    long: long?r1(long.km):0, qual: qual.map(x=>r1(x.km)), easy: easy.map(x=>r1(x.km)),
    easyMin: easy.length?r1(Math.min.apply(null,easy.map(x=>x.km))):0,
    easyMax: easy.length?r1(Math.max.apply(null,easy.map(x=>x.km))):0 };
}

console.log('=== 1. WHAT expressibleRunningDays() ACTUALLY ANSWERS ===\n');
{
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'}); a.state=a.makeDefaultState();
  console.log('  volume >= volume*LONG_FRACTION + (N-1)*EASY_MIN_KM,  solved for N');
  console.log('  LONG_FRACTION.endurance = '+a.LONG_FRACTION['endurance']+
              ',  EASY_MIN_KM = '+a.EASY_MIN_KM+'\n');
  console.log(pad('stated km',11)+num('expressible N',15)+num('implied easy run',18));
  [8,12,15,20,25,30,40,50,60,80].forEach(v=>{
    const n=a.expressibleRunningDays('full',v,a.EASY_MIN_KM,true);
    const e=(v*(1-a.LONG_FRACTION['endurance']))/Math.max(1,n-1);
    console.log(pad(v,11)+num(n,15)+num(r1(e)+' km',18));
  });
  console.log('\n  Every one of those easy figures sits AT or just above the 3km rendering');
  console.log('  floor by construction, because that is the term the formula solves for.');
  console.log('  It is a MAXIMUM RENDERABILITY answer: the most days this mileage can be');
  console.log('  written across without a session falling under the smallest distance the');
  console.log('  app can print. It is not a minimum coherent frequency, not a preferred');
  console.log('  frequency, and it contains no statement that any of those runs is worth');
  console.log('  prescribing. Its own comment says so: "There is no minimum-USEFUL-run');
  console.log('  constant here and none is implied." Using it as prescription authority');
  console.log('  read a feasibility bound as a coaching decision. That is the defect.');
}

console.log('\n\n=== 2. THE 25 km ATHLETE AT 4, 5 AND 6 PRESCRIBED RUNS ===');
console.log('First full week of a 15-week block, six days available.\n');
console.log(pad('days',6)+num('week km',9)+num('long',7)+num('long t',9)+
  num('quality',10)+num('easy runs',22)+num('easy t',9)+num('unused',8));
[3,4,5,6].forEach(d=>{
  const w=week(25,d);
  console.log(pad(d,6)+num(w.km,9)+num(w.long,7)+num(hhmm(w.long*w.pace),9)+
    num(w.qual.join('+')||'-',10)+num(w.easy.join(' / ')||'-',22)+
    num(w.easy.length?mm(w.easyMin*w.pace):'-',9)+num(w.unused,8));
});

console.log('\n\n=== 3. THE SAME QUESTION ACROSS THE RANGE ===');
console.log('Six days available. Session sizes at each candidate frequency.\n');
[8,12,15,20,25,30,40,50,60,80].forEach(v=>{
  console.log('-- stated '+v+' km/week ' + '-'.repeat(Math.max(0,52-String(v).length)));
  console.log('  '+pad('days',6)+num('km',7)+num('long',7)+num('qual',7)+
    num('easy each',12)+num('easy time',11)+num('easy/long',11));
  [3,4,5,6].forEach(d=>{
    const w=week(v,d);
    if (w.runs===0) return;
    const ratio = w.long>0 && w.easy.length ? (w.easyMax/w.long) : 0;
    console.log('  '+pad(d+(w.runs!==d?' ('+w.runs+')':''),6)+num(w.km,7)+num(w.long,7)+
      num(w.qual.join('+')||'-',7)+
      num(w.easy.length?(w.easyMin===w.easyMax?w.easyMin:w.easyMin+'-'+w.easyMax):'-',12)+
      num(w.easy.length?mm(w.easyMax*w.pace):'-',11)+
      num(ratio?Math.round(ratio*100)+'%':'-',11));
  });
});


console.log('\n\n=== 4. WHAT THE CORRECTED AUTHORITY PRESCRIBES ===');
console.log('Six days available. Range is the block\'s own coherent band.\n');
console.log(pad('stated',8)+num('prescribed',12)+num('optional',10)+num('range',8)+
  num('long',7)+num('support',9)+num('share',8)+num('support t',11));
[8,12,15,20,25,30,40,50,60,80].forEach(v=>{
  const w=week(v,6);
  const range=w.blk.weeks[0].frequencyEvidence ? w.blk.weeks[0].frequencyEvidence.coherent : null;
  const share=w.long>0&&w.easy.length ? w.easyMax/w.long : 0;
  console.log(pad(v+' km',8)+num(w.runs,12)+num(w.unused,10)+
    num(range?range.min+'-'+range.max:'-',8)+num(w.long,7)+num(w.easyMax||'-',9)+
    num(share?Math.round(share*100)+'%':'-',8)+num(w.easyMax?mm(w.easyMax*w.pace):'-',11));
});
console.log('\n  Read the share column from 20km down and from 20km up separately.');
console.log('');
console.log('  FROM 20 km UPWARD every prescription sits inside 40-75% of the week\'s own');
console.log('  long run: not concentrated into oversized supporting runs, and not');
console.log('  fragmented into leftover ones. The ratio is what makes one rule serve a');
console.log('  20km athlete and an 80km athlete -- an absolute floor could not.');
console.log('');
console.log('  BELOW 20 km IT DOES NOT, and that is reported rather than smoothed. At');
console.log('  8-15 km/week the long run is against its own floor, so no frequency puts');
console.log('  the supporting runs inside the band and the range comes back degenerate');
console.log('  (3-3, 4-4). The coherent-range authority has no opinion there and');
console.log('  feasibility binds instead. It is the honest answer -- a 12km/week week');
console.log('  has no coherent shape to find -- but it means the band is doing nothing');
console.log('  for the cohort furthest from a marathon, and the readiness layer rather');
console.log('  than the frequency layer is what has to speak to them.');
console.log('');
console.log('  ONE THING THE SHARE COLUMN CANNOT SEE. The 80km athlete\'s supporting run');
console.log('  is 94 minutes -- inside the 75-90 minute pressure region and past it -- at');
console.log('  a share of 62% that reads as perfectly coherent. Shape and COST are the');
console.log('  two independent causes of session-size pressure, and only shape can be');
console.log('  read at generation, because paces are not resolved until the plan\'s setup');
console.log('  exists. The cost side lands with the pressure architecture in Stage 4 and');
console.log('  will be what moves this athlete from five days to six.');
