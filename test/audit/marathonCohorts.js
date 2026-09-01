'use strict';
/* MARATHON COHORTS — CURRENT ENGINE BEHAVIOUR PER STARTING CAPACITY.
 * Read-only. node test/audit/marathonCohorts.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>Math.floor(s/3600)+'h'+String(Math.round((s%3600)/60)).padStart(2,'0');
const TODAY='2026-08-30';
const S={activeDays:[0,1,2,3,4,6],longRunDay:6};
/* Slower athletes at lower volume -- a stated modelling assumption, so the
   time-on-feet reading is realistic rather than flattering. */
const benchFor=v=> v<20?33*60 : v<35?29*60 : v<50?26*60 : v<70?23*60 : 20*60;

function build(v,W){
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const blk=a.buildBlockWeeks('full',v,W,{});
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true);
  a.state.days=ds;
  a.state.setup={distanceKey:'full',currentVolume:v,planWeeks:blk.planWeeks,schedule:S,
    benchmark:{distanceKey:'5k',timeSec:benchFor(v)},goals:{A:{timeSec:4*3600}},activeGoal:'A',
    paceOverrides:{},lthr:165,maxHR:190,experience:'experienced',
    startDate:TODAY,raceDate:end,hasEvent:true,purpose:'race'};
  const z=a.getActivePaces(); const pace=(z.E.slow+z.E.fast)/2;
  const race=ds.filter(d=>d.type==='race')[0];
  const longs=ds.filter(d=>d.type==='long'&&d.km>0).sort((x,y)=>y.km-x.km);
  const peakVol=Math.max.apply(null,blk.weeks.filter(w=>!w.isRace&&w.phase!=='Taper').map(w=>w.volume));
  const top=longs[0]||{km:0};
  const second=longs[1]||{km:0};
  const specific=ds.filter(d=>d.mpSegment&&d.type!=='race').sort((x,y)=>x.date<y.date?-1:1);
  const firstTaper=blk.weeks.filter(w=>w.phase==='Taper')[0];
  const tStart=ds.filter(d=>d.week===firstTaper.week).sort((x,y)=>x.date<y.date?-1:1)[0];
  const lastLong=ds.filter(d=>d.type==='long'&&d.km>0).sort((x,y)=>x.date<y.date?-1:1).pop();
  return { a,blk,ds,pace,peakVol:r1(peakVol),
    top:r1(top.km), second:r1(second.km), topTof:top.km*pace,
    share: peakVol? Math.round(100*top.km/peakVol):0,
    mpKm:r1(specific.reduce((t,d)=>t+((d.prescription&&d.prescription.params&&d.prescription.params.finishKm)||0),0)),
    mpSessions:specific.length,
    lastMp: specific.length? a.daysBetween(specific[specific.length-1].date, race.date):null,
    taperStart:a.daysBetween(tStart.date, race.date),
    lastLongD:a.daysBetween(lastLong.date, race.date), lastLongKm:r1(lastLong.km),
    cutbacks:blk.weeks.filter(w=>w.isCutback).length };
}
console.log('=== MARATHON COHORTS, CURRENT ENGINE (16-week programme) ===');
console.log('Modelling assumption: slower athletes at lower starting volume.\n');
console.log(pad('start',7)+num('peak km',9)+num('long 1',8)+num('long 2',8)+num('share',7)+
  num('time',7)+num('MP km',7)+num('MP sess',9)+num('lastMP',8)+
  num('taper',8)+num('lastLong',10)+num('cut',5));
[15,25,30,40,50,60,80,100].forEach(v=>{
  const d=build(v,16);
  console.log(pad(v,7)+num(d.peakVol,9)+num(d.top,8)+num(d.second,8)+num(d.share+'%',7)+
    num(hhmm(d.topTof),7)+num(d.mpKm,7)+num(d.mpSessions,9)+
    num(d.lastMp!=null?'D-'+d.lastMp:'-',8)+num('D-'+d.taperStart,8)+
    num('D-'+d.lastLongD+' '+d.lastLongKm+'km',10)+num(d.cutbacks,5));
});
console.log('\n  long 1 / long 2 = the two largest long runs in the whole block.');
console.log('  time = time on feet for the largest, at that cohort\'s assumed pace.');
console.log('  lastMP = days before race of the final marathon-pace session.');
console.log('\n=== THE SAME COHORTS ACROSS DURATIONS (peak long run) ===');
console.log(pad('start',7)+[12,14,16,20,24,52].map(w=>num(w+'wk',8)).join(''));
[15,25,40,60,100].forEach(v=>{
  console.log(pad(v,7)+[12,14,16,20,24,52].map(w=>{
    try { return num(build(v,w).top,8); } catch(e){ return num('-',8); }
  }).join(''));
});
