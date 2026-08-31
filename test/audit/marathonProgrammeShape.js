'use strict';
/* AVAILABILITY vs PRESCRIPTION, AND QUALITY FREQUENCY. READ-ONLY.
 * node test/audit/marathonProgrammeShape.js
 *
 * Three questions HQ asked, measured against the engine that exists:
 *   (1) does stated availability become prescribed running frequency?
 *   (2) is quality frequency derived from day count, or earned?
 *   (3) does the seven-day calendar actually hold Tempo + VO2 + Long?
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const TODAY='2026-08-30';
const DAYNAME=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const benchFor=v=> v<20?33*60 : v<35?29*60 : v<50?26*60 : v<70?23*60 : 20*60;
const DAYSETS={2:[1,6],3:[1,3,6],4:[1,3,4,6],5:[0,1,3,4,6],6:[0,1,2,3,4,6]};

function build(v,W,days){
  const a=loadApp({pinnedDate:TODAY+'T09:00:00Z'});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const S={activeDays:DAYSETS[days],longRunDay:6};
  const blk=a.buildBlockWeeks('full',v,W,{});
  const end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)),blk.planWeeks*7-1);
  const ds=a.buildDaysFromWeeks(blk,end,S,TODAY,true);
  a.state.days=ds;
  a.state.setup={distanceKey:'full',currentVolume:v,planWeeks:blk.planWeeks,schedule:S,
    benchmark:{distanceKey:'5k',timeSec:benchFor(v)},goals:{A:{timeSec:4*3600}},activeGoal:'A',
    paceOverrides:{},lthr:165,maxHR:190,experience:'experienced',
    startDate:TODAY,raceDate:end,hasEvent:true,purpose:'race'};
  return {a,blk,ds,S};
}

console.log('=== 1. DOES STATED AVAILABILITY BECOME PRESCRIBED RUNNING FREQUENCY? ===');
console.log('First FULL week of a 15-week marathon plan (week 1 is a part-week here).\n');
console.log(pad('start km/wk',13)+pad('avail',7)+num('runs',7)+num('week km',9)+
  num('shortest',10)+num('longest',9)+'   reading');
[[12,6],[12,4],[12,3],[25,6],[40,6],[50,6],[60,6],[80,6]].forEach(([v,d])=>{
  const {ds,blk,a}=build(v,15,d);
  // first week that actually has all seven calendar days present
  let wn=1; for(;wn<=blk.planWeeks;wn++){ if(ds.filter(x=>x.week===wn).length===7) break; }
  const w=ds.filter(x=>x.week===wn&&x.km>0);
  const runs=w.length, km=w.reduce((t,x)=>t+x.km,0);
  const shortest=Math.min.apply(null,w.map(x=>x.km));
  const longest=Math.max.apply(null,w.map(x=>x.km));
  console.log(pad(v,13)+pad(d,7)+num(runs,7)+num(r1(km),9)+num(r1(shortest),10)+num(r1(longest),9)+
    '   '+(runs===d?'availability consumed in full':'came under the ceiling ('+runs+'/'+d+')'));
});
console.log('\n  The generator states the rule itself, at the qualitySlots decision:');
console.log('  "RUNNING FREQUENCY is every one of those days -- an extra available day');
console.log('   stays a running day, and becomes easy running rather than being taken away."');
console.log('  Read the 25 km/week six-day row against the 80 km/week six-day row: identical');
console.log('  prescribed frequency, from identical stated availability, on athletes whose');
console.log('  demonstrated workload differs more than threefold. Availability became');
console.log('  prescription in both.');
console.log('');
console.log('  The 12 km/week athlete DOES come under the ceiling at 4 runs -- but not for');
console.log('  the right reason. 13 km over six days is 2.2 km a run, below EASY_MIN_KM (3),');
console.log('  so the day count falls out of a RENDERING FLOOR, not out of a judgement about');
console.log('  what that athlete can absorb. Push them to 25 km and the floor stops binding');
console.log('  and they get all six. There is no capacity gate here; there is a minimum');
console.log('  printable run length that happens to look like one at the very bottom.');
console.log('');
console.log('  Note also what the 12 km athlete is actually prescribed: 13 km in the first');
console.log('  full week, against 12 km demonstrated. The volume architecture is already');
console.log('  restrained at the bottom. It is the FREQUENCY architecture that is not.');

console.log('\n\n=== 2. IS QUALITY FREQUENCY DERIVED FROM DAY COUNT, OR EARNED? ===\n');
console.log(pad('avail',7)+num('slot ceiling',14)+num('prescribed',12)+'   permission reason');
[2,3,4,5,6].forEach(d=>{
  const {blk}=build(50,15,d);
  const qf=blk.qualityFrequency||{};
  console.log(pad(d,7)+num(qf.ceiling,14)+num(qf.prescribed,12)+'   '+
    ((qf.permission&&qf.permission.reason)||'-'));
});
console.log('\n  The ceiling IS a day-count switch (qualitySlotCeilingForDayCount: <=2 -> 0,');
console.log('  <=4 -> 1, else 2). But it is a CEILING, and the second slot is then gated by');
console.log('  secondQualityExposurePermission(), which reads the athlete\'s own logged');
console.log('  response. With no history every cohort above lands on ONE quality session,');
console.log('  reason "response_not_established". So the safety principle in SYSTEM 9 is');
console.log('  already implemented and already holds: no evidence -> one quality session.');
console.log('  What does NOT yet exist is the distinction HQ asks for in SYSTEM 8 -- 50 km');
console.log('  of easy running and 50 km containing threshold + intervals are indistinguish-');
console.log('  able to this gate, because both simply read as "no established family".');

console.log('\n\n=== 3. THE 1 -> 2 AND 2 -> 1 PATHWAY THAT ALREADY EXISTS ===\n');
const reasons=[['no_evidence','no response model at all','1'],
 ['response_not_established','fewer than the required logged sessions in any quality family','1'],
 ['no_block_reading','block effectiveness unreadable','1'],
 ['strained','block state STRAINED','1  <= this is the 2 -> 1 path'],
 ['not_adapting_<state>','block state not ADAPTING (e.g. holding, regressing)','1  <= 2 -> 1'],
 ['recovery_not_measured','no typicalHoursToNormal for the slowest family','1'],
 ['no_spacing_available','schedule cannot separate two hard days at all','1'],
 ['recovery_exceeds_spacing','slowest family needs longer than the week can give','1  <= 2 -> 1'],
 ['adapting_and_recovered','ADAPTING + slowest family recovers inside the real gap','2']];
console.log(pad('reason code',28)+pad('meaning',60)+'slots');
reasons.forEach(r=>console.log(pad(r[0],28)+pad(r[1],60)+r[2]));
console.log('\n  Both directions exist and are re-evaluated every week, from the block state');
console.log('  and the SLOWEST established family rather than the fastest. Three of the');
console.log('  reason codes are live 2 -> 1 demotions. What is missing for Marathon is not');
console.log('  the pathway -- it is that PHASE is not one of the inputs, so a Peak week');
console.log('  carrying two major long-run exposures cannot demote on that basis alone.');

console.log('\n\n=== 4. SEVEN-DAY GEOMETRY: DOES THE WEEK ACTUALLY HOLD IT? ===');
console.log('Peak-phase week, 6 available days, established athlete. Real generated placement.\n');
{
  const {ds,blk,a}=build(60,15,6);
  const peakWk=blk.weeks.filter(w=>w.phase==='Peak')[0];
  const days=ds.filter(x=>x.week===peakWk.week).sort((x,y)=>x.date<y.date?-1:1);
  console.log(pad('day',6)+pad('type',12)+num('km',7)+'   session');
  days.forEach(d=>{
    const wd=DAYNAME[(a.isoWeekday(d.date)+6)%7];
    console.log(pad(wd,6)+pad(d.type||'rest',12)+num(d.km?r1(d.km):'-',7)+'   '+
      (d.km>0?(d.title||d.type):'rest / non-running'));
  });
  const hard=days.filter(d=>['interval','tempo','threshold','repetition','long'].includes(d.type)&&d.km>0);
  console.log('\n  demanding days: '+hard.map(d=>DAYNAME[(a.isoWeekday(d.date)+6)%7]+':'+d.type).join('  '));
  const gaps=[];
  for(let i=1;i<hard.length;i++) gaps.push(a.daysBetween(hard[i-1].date,hard[i].date));
  console.log('  gaps between them: '+(gaps.join(', ')||'n/a')+' days');
  console.log('  non-running days: '+days.filter(d=>!(d.km>0)).length);
}
console.log('\n  pickQualityDays() already enumerates every arrangement and ranks by spacing,');
console.log('  treating the long run as a fixed demanding day. So the geometry question is');
console.log('  answerable today, and the answer is measured above rather than asserted.');
