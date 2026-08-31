'use strict';
/* RACE GOAL CONTINUUM — ENGINE MEASURED AGAINST EXTERNAL EVIDENCE
 * Read-only. node test/audit/raceGoalContinuum.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const D=['5k','10k','half','full'];
const SCHED={activeDays:[0,1,2,3,4,6],longRunDay:6};
const TODAY='2026-08-30';
function plan(dist, earned, vol){
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const rM=a.athleteResponseModel,rB=a.blockEffectiveness;
  if(earned){a.athleteResponseModel=()=>({families:{threshold:{confidence:'established',recovery:{typicalHoursToNormal:24}},interval:{confidence:'established',recovery:{typicalHoursToNormal:24}}}});
             a.blockEffectiveness=()=>({state:'ADAPTING'});}
  let blk,ds,end;
  try{ blk=a.buildBlockWeeks(dist,vol,16,{});
       end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
       ds=a.buildDaysFromWeeks(blk,end,SCHED,TODAY,true); }
  finally{ a.athleteResponseModel=rM; a.blockEffectiveness=rB; }
  a.state.days=ds;
  a.state.setup={distanceKey:dist,currentVolume:vol,planWeeks:blk.planWeeks,schedule:SCHED,
    benchmark:{distanceKey:'5k',timeSec:19*60+30},goals:{A:{timeSec:4*3600}},activeGoal:'A',
    paceOverrides:{},lthr:165,maxHR:190,experience:'experienced',
    startDate:TODAY,raceDate:end,hasEvent:true,purpose:'race'};
  return {a,blk,ds};
}
/* QUALITY KILOMETRES ONLY -- the work bouts, not the warm-up, recoveries and
   cool-down the session's total distance also carries. Daniels' 8%/10% caps
   are stated on the quality running, so anything else is not a comparison. */
function qualityKm(a, dd){
  let segs=null; try{ segs=a.segmentsFor(a.prescriptionOf(dd)); }catch(e){}
  if(!segs) return null;
  let km=0;
  (function walk(list,mult){ (list||[]).forEach(s=>{
    if(s.kind==='repeat'){ s.children.forEach(c=>walk([c], mult*a.repeatChildCount(s,c))); return; }
    /* WORK AT A QUALITY INTENSITY ONLY. A warm-up and a cool-down are also
       kind:'work' -- at intensity 'easy' -- and counting them made a 5x1000m
       session read as 9km of quality instead of 5. Caught before reporting. */
    if(s.kind!=='work' || s.intensity==='easy') return;
    if(s.km!=null) km += s.km*mult;
    else if(s.m!=null) km += (s.m/1000)*mult;
  }); })(segs,1);
  return r1(km);
}
console.log('=== DANIELS\' SESSION CAPS vs THE ENGINE ===');
console.log('Daniels: an Interval session carries at most 8%% of weekly mileage as');
console.log('QUALITY running (and never more than 10km); a Threshold session at most 10%%.');
console.log('Both caps are derived from WEEKLY VOLUME. The engine bounds sessions by');
console.log('weekFitCeil = min(longCapKm, volume x LONG_FRACTION) -- the long run.\n');
console.log(pad('dist',7)+num('week km',9)+num('I cap 8%',10)+num('I actual',10)+num('verdict',10)+
  num('T cap 10%',11)+num('T actual',10)+num('verdict',10));
D.forEach(d=>{
  const vol={'5k':45,'10k':50,'half':55,'full':70}[d];
  const {a,blk,ds}=plan(d,true,vol);
  const peak=blk.weeks.filter(w=>w.phase==='Peak');
  const w=peak[peak.length-1];
  const wd=ds.filter(x=>x.week===w.week);
  const wkKm=wd.reduce((t,x)=>t+(x.km||0),0);
  const iv=wd.filter(x=>['interval','repetition'].indexOf(x.type)!==-1)[0];
  const th=wd.filter(x=>['threshold','tempo'].indexOf(x.type)!==-1)[0];
  const iCap=Math.min(10, 0.08*wkKm), tCap=0.10*wkKm;
  const iAct=iv?qualityKm(a,iv):null, tAct=th?qualityKm(a,th):null;
  console.log(pad(d,7)+num(r1(wkKm),9)+num(r1(iCap),10)+num(iAct==null?'-':iAct,10)+
    num(iAct==null?'-':(iAct<=iCap+0.05?'ok':'OVER'),10)+
    num(r1(tCap),11)+num(tAct==null?'-':tAct,10)+
    num(tAct==null?'-':(tAct<=tCap+0.05?'ok':'OVER'),10));
});
console.log('\n=== AND WHAT THE UNBOUNDED POOL WOULD HAVE PRESCRIBED ===');
const a0=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
D.forEach(d=>{
  const vol={'5k':45,'10k':50,'half':55,'full':70}[d];
  const {a,blk}=plan(d,true,vol);
  const peak=blk.weeks.filter(w=>w.phase==='Peak'); const w=peak[peak.length-1];
  const e=a.DISTANCE_PROFILES[d].emphasis;
  const raw=a0.structTrackIntervals(0.85,e);
  const rawQ=r1(raw.reps*raw.m/1000);
  const cap=Math.min(10,0.08*w.volume);
  console.log('  '+pad(d,7)+'unbounded '+pad(raw.reps+'x'+raw.m+'m = '+rawQ+'km quality',26)+
    'Daniels 8% cap '+num(r1(cap),5)+'km  '+(rawQ>cap?'<== the pool itself exceeds the evidence cap':'within it'));
});
