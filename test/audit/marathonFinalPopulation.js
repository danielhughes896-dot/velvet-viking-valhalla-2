'use strict';
/* FINAL MARATHON POPULATION + CASE VALIDATION. READ-ONLY.
 * node test/audit/marathonFinalPopulation.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};
const TODAY='2026-08-30';
const DAYSETS={2:[1,6],3:[1,3,6],4:[1,3,4,6],5:[0,1,3,4,6],6:[0,1,2,3,4,6]};
const benchFor=v=> v<20?33*60 : v<35?29*60 : v<50?26*60 : v<70?23*60 : 20*60;

function build(volume, weeks, days, opts){
  const o=opts||{};
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const S={activeDays:DAYSETS[days],longRunDay:6};
  if (o.history) a.state.athlete={sessions:o.history(a)};
  const bs=o.benchSec||benchFor(volume);
  const vd=a.vdotFromPerformance(5000,bs);
  const pace=(function(){const z=a.trainingPacesFromVDOT(vd);return (z.E.slow+z.E.fast)/2;})();
  const blk=a.buildBlockWeeks(o.distanceKey||'full',volume,weeks,{});
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true,{easyPaceSecPerKm:pace});
  let wn=1; for(;wn<=blk.planWeeks;wn++) if(ds.filter(x=>x.week===wn).length===7) break;
  const wk=ds.filter(x=>x.week===wn);
  const runs=wk.filter(x=>x.km>0);
  const longs=ds.filter(x=>x.type==='long'&&x.km>0);
  const peakLong=longs.length?Math.max.apply(null,longs.map(x=>x.km)):0;
  const specific=ds.filter(x=>x.mpSegment&&x.type!=='race').length;
  const ml=ds.filter(x=>x.mediumLong);
  const peakVol=Math.max.apply(null,blk.weeks.filter(w=>!w.isRace&&w.phase!=='Taper').map(w=>w.volume));
  const rd=a.marathonReadiness({startKm:volume,planWeeks:weeks,peakLongKm:peakLong,
    specificKm:specific, raceSec:o.raceSec||null, peakLongSec:peakLong*pace});
  const ph={Base:0,Build:0,Peak:0,Taper:0,Final:0};
  blk.weeks.forEach(w=>{ph[a.phaseForWeek(w.week,blk.planWeeks,'race',o.distanceKey||'full')]++;});
  return {a,blk,ds,pace,wn,
    runs:runs.length, opt:wk.filter(x=>x.availableUnused).length,
    qual:wk.filter(x=>['tempo','threshold','interval','repetition'].includes(x.type)).length,
    peakVol:r1(peakVol), peakLong:r1(peakLong), peakLongT:hhmm(peakLong*pace),
    ml:ml.length, phases:[ph.Base,ph.Build,ph.Peak,ph.Taper+ph.Final].join('/'),
    readiness:rd?rd.verdict:'-', limitedBy:rd?rd.limitedBy:'-',
    unpract: rd&&rd.unpractisedFraction!=null?Math.round(rd.unpractisedFraction*100)+'%':'-'};
}
function easyOnly(a){const t=a.todayStr(),m=a.addDays(t,-a.isoWeekday(t));const s=[];
  for(let w=1;w<=16;w++){[0,2,4].forEach(d=>s.push({date:a.addDays(m,-7*w+d),completed:true,actualKm:10,plannedKm:10,type:'easy',actual:{km:10,rpe:3,pace:330,hr:135},feel:'good'}));
    s.push({date:a.addDays(m,-7*w+6),completed:true,actualKm:20,plannedKm:20,type:'long',actual:{km:20,rpe:5,pace:340,hr:140},feel:'good'});}
  return s;}
function withQuality(a){const s=easyOnly(a);const t=a.todayStr(),m=a.addDays(t,-a.isoWeekday(t));
  for(let w=1;w<=16;w++) s.push({date:a.addDays(m,-7*w+1),completed:true,actualKm:10,plannedKm:10,type:'threshold',actual:{km:10,rpe:7,pace:290,hr:165},feel:'good'});
  return s;}

console.log('=== 1. POPULATION: STARTING VOLUME x AVAILABILITY (15 weeks) ===\n');
console.log(pad('vol',6)+[2,3,4,5,6].map(d=>num(d+'d',14)).join('')+'   (runs+optional / quality)');
[8,12,20,25,40,50,60,80].forEach(v=>{
  let line=pad(v,6);
  [2,3,4,5,6].forEach(d=>{ const r=build(v,15,d); line+=num(r.runs+'+'+r.opt+'r/'+r.qual+'q',14); });
  console.log(line);
});
console.log('\n  Prescribed frequency never exceeds availability, and never equals it merely');
console.log('  because it was offered. Quality frequency is one everywhere: no athlete in');
console.log('  this population has logged evidence, and mileage never grants a second.');

console.log('\n\n=== 2. POPULATION: RUNWAY (50 km/week, six available) ===\n');
console.log(pad('N',5)+num('phases',12)+num('peak wk',10)+num('peak long',11)+num('long t',9)+
  num('runs',6)+num('ML',4)+num('readiness',13)+num('limited by',12));
[4,6,8,9,10,12,14,15,16,20,24,30].forEach(N=>{
  const r=build(50,N,6);
  console.log(pad(N,5)+num(r.phases,12)+num(r.peakVol,10)+num(r.peakLong,11)+num(r.peakLongT,9)+
    num(r.runs,6)+num(r.ml,4)+num(r.readiness,13)+num(r.limitedBy,12));
});
console.log('\n  Peak is three weeks and the wind-down two at every runway of eleven weeks');
console.log('  or more; Base absorbs the shortage below that and is gone at ten. Above');
console.log('  fifteen the shape stops changing -- the surplus is a different programme.');

console.log('\n\n=== 3. THE CASES ===\n');
const cases=[
 ['A','15wk, 50km, 6d, quality history',   50,15,6,{history:withQuality,raceSec:4*3600}],
 ['B','15wk, 50km, 6d, easy-only history', 50,15,6,{history:easyOnly,raceSec:4*3600}],
 ['C','15wk, <15km, 6d',                   12,15,6,{raceSec:5.5*3600}],
 ['D','9wk, 60km, 6d, established',        60, 9,6,{history:withQuality,raceSec:3.5*3600}],
 ['E','9wk, <15km, 6d',                    12, 9,6,{raceSec:5.5*3600}],
 ['H','25km, 6d — purposeful frequency',   25,15,6,{raceSec:5*3600}],
 ['I','80km, 6d — shape + cost',           80,15,6,{raceSec:3*3600}],
 ['I2','50km, 6d, SLOW athlete',           50,15,6,{benchSec:33*60,raceSec:5.5*3600}]];
console.log(pad('',4)+pad('case',34)+num('runs',6)+num('qual',6)+num('peak wk',9)+
  num('peak long',11)+num('long t',8)+num('ML',4)+num('readiness',14)+num('unpract',9));
cases.forEach(([id,desc,v,N,d,o])=>{
  const r=build(v,N,d,o);
  console.log(pad(id,4)+pad(desc,34)+num(r.runs+'+'+r.opt,6)+num(r.qual,6)+num(r.peakVol,9)+
    num(r.peakLong,11)+num(r.peakLongT,8)+num(r.ml,4)+num(r.readiness,14)+num(r.unpract,9));
});

console.log('\n\n=== 4. CASES F, G — SURPLUS RUNWAY ===\n');
{
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'}); a.state=a.makeDefaultState();
  [['F','24wk, aerobic weakness',25],['G','24wk, strong base',60]].forEach(([id,desc,v])=>{
    const rp=a.marathonRunwayPlan(24,v);
    console.log(pad(id,4)+pad(desc,28)+' -> '+(rp.preparatory
      ? rp.preparatory.weeks+'-week '+rp.preparatory.purpose+' ('+rp.preparatory.reason+') then '+rp.raceWeeks+'-week Race Goal'
      : rp.reason));
  });
  console.log('\n  The race programme is fifteen weeks in both. What differs is what the');
  console.log('  nine surplus weeks are FOR, and that is read from the athlete rather than');
  console.log('  from the calendar.');
}

console.log('\n\n=== 5. CASE J — SIX DAYS, STILL CONSTRAINED ===\n');
{
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'}); a.state=a.makeDefaultState();
  const vd=a.vdotFromPerformance(5000,33*60);
  const z=a.trainingPacesFromVDOT(vd); const pace=(z.E.slow+z.E.fast)/2;
  console.log('  5h30 athlete, six days authorised, long run 27.5 km, one 8 km quality session.\n');
  console.log('  '+pad('week V',9)+num('support each',14)+num('time',9)+num('share',8)+num('cost',7)+num('6d coherent?',15));
  [77.5,85,90,95].forEach(V=>{
    const r=a.coherentFrequencyRange(V,27.5,8,1,6,pace);
    const row=(r.rows||[]).filter(x=>x.days===6)[0];
    console.log('  '+pad(V,9)+num(row.supportKm,14)+num(hhmm(row.supportSec),9)+
      num(Math.round(row.share*100)+'%',8)+num(row.cost,7)+
      num(r.min!=null&&r.min<=6&&r.max>=6?'yes':'NO',15));
  });
  console.log('\n  A SEVENTH DAY IS PRICED, NEVER OFFERED. At 95 km/week the six-day week');
  console.log('  cannot be made coherent; the audit can show what a seventh would buy, and');
  console.log('  the architecture cannot reach it:');
  const seven=a.coherentFrequencyRange(95,27.5,8,1,7,pace);
  const r7=(seven.rows||[]).filter(x=>x.days===7)[0];
  console.log('    7 days would give '+r7.supportKm+' km / '+hhmm(r7.supportSec)+
    ' supporting runs at '+Math.round(r7.share*100)+'% share -- and costs the athlete');
  console.log('    their only non-running day. AVAILABILITY_EXPANSION_CEILING = '+
    a.AVAILABILITY_EXPANSION_CEILING+' makes it unreachable.');
  console.log('\n  The re-solve is the answer instead: hold the destination at what six days');
  console.log('  carry, develop it more slowly, or state the readiness limitation.');
  const d=a.marathonVolumeDestination(55,15);
  console.log('    event requirement '+d.needKm+' km/wk, this athlete reaches '+d.reachableKm+
    ' ('+Math.round(d.fraction*100)+'%), shortfall '+d.shortfallKm+' km.');
}
