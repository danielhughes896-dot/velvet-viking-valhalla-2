'use strict';
/* 5K vs 10K QUALITY METHODOLOGY — EVIDENCE
 * ===========================================================================
 * Read-only. Measures the ACTUAL prescribed stimulus across the event
 * continuum, and audits whether the quality dose is bounded by physiology or
 * by the long-run architecture.
 *
 * node test/audit/eventSpecificity.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY='2026-08-30';
const r1=x=>Math.round(x*10)/10, r2=x=>Math.round(x*100)/100;
const pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const D=['5k','10k','half','full'];
const SCHED={3:{activeDays:[1,3,6],longRunDay:6},4:{activeDays:[1,3,5,6],longRunDay:6},
             5:{activeDays:[1,2,4,5,6],longRunDay:6},6:{activeDays:[0,1,2,3,4,6],longRunDay:6},
             7:{activeDays:[0,1,2,3,4,5,6],longRunDay:6}};
/* The SAME athlete: one stated weekly volume and one benchmark for every
   distance, so target distance is the only variable that moves. */
const SAME_VOL = 55, BENCH_5K = 19*60+30;

function plan(dist, days, earned, vol, weeks){
  const a = loadApp({ pinnedDate: TODAY+'T09:00:00Z' });
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  const rM=a.athleteResponseModel, rB=a.blockEffectiveness;
  if (earned){
    a.athleteResponseModel=()=>({families:{
      threshold:{confidence:'established',recovery:{typicalHoursToNormal:24}},
      interval:{confidence:'established',recovery:{typicalHoursToNormal:24}}}});
    a.blockEffectiveness=()=>({state:'ADAPTING'});
  }
  let blk, ds, end;
  try {
    blk=a.buildBlockWeeks(dist, vol||SAME_VOL, weeks||16, {});
    end=a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)), blk.planWeeks*7-1);
    ds=a.buildDaysFromWeeks(blk, end, SCHED[days], TODAY, true);
  } finally { a.athleteResponseModel=rM; a.blockEffectiveness=rB; }
  a.state.days=ds;
  a.state.setup={distanceKey:dist,currentVolume:vol||SAME_VOL,planWeeks:blk.planWeeks,
    schedule:SCHED[days],benchmark:{distanceKey:'5k',timeSec:BENCH_5K},
    goals:{A:{timeSec:Math.round(BENCH_5K*a.DISTANCE_PROFILES[dist].raceKm/5*1.06)}},activeGoal:'A',
    paceOverrides:{},lthr:165,maxHR:190,experience:'experienced',
    startDate:TODAY,raceDate:end,hasEvent:true,purpose:'race'};
  return {a,blk,days:ds};
}
/* ZONE TIME, not labels. structuredZoneTime() is the engine's own decomposition
   of a day into easy / mp / threshold / interval seconds, so an 11km threshold
   day counts as 3km easy + 8km threshold and a goal-pace long run's segment is
   counted where it belongs. */
function weekZones(a, days, week){
  const wd = days.filter(d => d.week===week);
  const z = { easy:0, mp:0, threshold:0, interval:0 };
  wd.forEach(d => {
    if (!d.km) return;
    let st=null; try { st=a.structuredZoneTime(d); } catch(e){}
    if (st){ z.easy+=st.zones.easy; z.mp+=st.zones.mp; z.threshold+=st.zones.threshold; z.interval+=st.zones.interval; }
    else { const p=a.getActivePaces(); const e=(p.E.slow+p.E.fast)/2; z.easy += d.km*e; }
  });
  return z;
}

console.log('=== 1. THE PROFILES, AS DECLARED ===');
const a0 = loadApp({pinnedDate:TODAY+'T09:00:00Z'});
console.log(pad('dist',7)+pad('emphasis',12)+num('raceKm',8)+num('longCap',9)+num('volMult',9)+
  num('LONG_FR',9)+num('minPeakLong',13)+num('TT km',7));
D.concat(['ultra']).forEach(d=>{
  const p=a0.DISTANCE_PROFILES[d];
  console.log(pad(d,7)+pad(p.emphasis,12)+num(p.raceKm,8)+num(p.longCapKm,9)+num(p.volMult,9)+
    num(a0.LONG_FRACTION[p.emphasis],9)+num(a0.MIN_PEAK_LONG_KM[d],13)+num(a0.TT_DISTANCE_KM[p.emphasis],7));
});
console.log('\n  5K and 10K share emphasis "speed": EMPHASIS_INTERVAL_RANGE and');
console.log('  EMPHASIS_TEMPO_RANGE are keyed on emphasis, so every structure');
console.log('  function returns the identical spec for the two distances.');
['structTrackIntervals','structLadder','structDeuce','structGoalPaceIntervals',
 'structSteadyTempo','structProgressiveTempo','structSplitTempo',
 'structThresholdContinuous','structGoalPaceBlock'].forEach(fn=>{
  const at = e => JSON.stringify(a0[fn](0.8, e));
  console.log('    '+pad(fn,26)+'speed '+pad(at('speed'),44)+' threshold '+at('threshold'));
});

console.log('\n\n=== 2. weekFitCeil — WHAT BOUNDS THE QUALITY SESSION ===');
console.log('weekFitCeil = min(profile.longCapKm, volume x LONG_FRACTION[emphasis])');
console.log('which is EXACTLY the week\'s long-run target. Its purpose is the');
console.log('long_run_shorter_than_quality invariant: no session may be longer than');
console.log('the long run. The question is whether that should bound a VO2 session.\n');
console.log(pad('dist',7)+num('week km',9)+num('longTgt',9)+num('longCap',9)+num('ceiling',9)+
  num('intervalKm',12)+num('bound by',12)+'  structure');
D.forEach(d=>{
  const {a,blk,days}=plan(d,6,true);
  const peak=blk.weeks.filter(w=>w.phase==='Peak');
  const w=peak[peak.length-1];
  const p=a.DISTANCE_PROFILES[d];
  const ceil=Math.min(p.longCapKm, w.volume*a.LONG_FRACTION[p.emphasis]);
  const iv=days.filter(x=>x.week===w.week && ['interval','repetition'].indexOf(x.type)!==-1)[0];
  const boundBy = (p.longCapKm <= w.volume*a.LONG_FRACTION[p.emphasis]) ? 'longCapKm' : 'volume x frac';
  console.log(pad(d,7)+num(r1(w.volume),9)+num(r1(w.longTarget),9)+num(p.longCapKm,9)+
    num(r1(ceil),9)+num(iv?iv.km:'-',12)+num(boundBy,12)+'  '+(iv?iv.title:''));
});
console.log('\n  What each distance WOULD prescribe with the ceiling lifted');
console.log('  (the pool\'s own unshrunk structure at the same phase position):');
console.log('  '+pad('dist',7)+pad('emphasis',11)+'unbounded track reps        shrunk to fit');
D.forEach(d=>{
  const {a,blk,days}=plan(d,6,true);
  const peak=blk.weeks.filter(w=>w.phase==='Peak');
  const w=peak[peak.length-1];
  const p=a.DISTANCE_PROFILES[d];
  const raw=a0.structTrackIntervals(0.85, p.emphasis);
  const rawKm=a0.intervalSessionKm(raw);
  const ceil=Math.min(p.longCapKm, w.volume*a.LONG_FRACTION[p.emphasis]);
  const shrunk=a0.shrinkIntervalSpec(JSON.parse(JSON.stringify(raw)), ceil);
  console.log('  '+pad(d,7)+pad(p.emphasis,11)+
    pad(raw.reps+'x'+raw.m+'m = '+r1(rawKm)+'km',28)+
    shrunk.reps+'x'+shrunk.m+'m = '+r1(a0.intervalSessionKm(shrunk))+'km'+
    (rawKm>ceil ? '   <== CUT by the long-run ceiling' : ''));
});

console.log('\n\n=== 3. ACTUAL STIMULUS BY ZONE-TIME, NOT BY LABEL ===');
console.log('structuredZoneTime() decomposes each day into easy / marathon-pace /');
console.log('threshold / interval seconds. Minutes per week, same athlete, 6 days,');
console.log('second exposure earned.\n');
['Base','Build','Peak','Taper'].forEach(ph=>{
  console.log('-- %s --', ph);
  console.log('  '+pad('dist',7)+num('km/wk',8)+num('easy min',10)+num('thresh min',12)+
    num('interval min',14)+num('MP min',9)+num('hard min',10)+num('hard %',9)+num('thr:int',9));
  D.forEach(d=>{
    const {a,blk,days}=plan(d,6,true);
    const wks=blk.weeks.filter(w=>w.phase===ph).map(w=>w.week)
      .filter(w=>days.filter(x=>x.week===w).length>=7);
    if(!wks.length){ console.log('  '+pad(d,7)+'  (none)'); return; }
    let e=0,t=0,i=0,m=0,km=0;
    wks.forEach(w=>{ const z=weekZones(a,days,w); e+=z.easy;t+=z.threshold;i+=z.interval;m+=z.mp;
      km+=days.filter(x=>x.week===w).reduce((s,x)=>s+(x.km||0),0); });
    const n=wks.length, hard=(t+i+m)/60/n, tot=(e+t+i+m)/60/n;
    console.log('  '+pad(d,7)+num(r1(km/n),8)+num(r1(e/60/n),10)+num(r1(t/60/n),12)+
      num(r1(i/60/n),14)+num(r1(m/60/n),9)+num(r1(hard),10)+
      num(Math.round(100*hard/tot)+'%',9)+num(i>0?r2(t/i):'-',9));
  });
  console.log('');
});

console.log('\n=== 4. SAME ATHLETE, ONLY THE TARGET DISTANCE CHANGES ===');
console.log('55 km/wk stated, 19:30 5K benchmark, six available days, 16 weeks,');
console.log('second exposure earned. Representative Build and Peak weeks.\n');
['Build','Peak'].forEach(ph=>{
  console.log('######## %s ########', ph.toUpperCase());
  D.forEach(d=>{
    const {a,blk,days}=plan(d,6,true);
    const cand=blk.weeks.filter(w=>w.phase===ph && !w.isCutback);
    const w=cand[cand.length-1] || blk.weeks.filter(w=>w.phase===ph).pop();
    const wd=days.filter(x=>x.week===w.week);
    const z=weekZones(a,days,w.week);
    const km=r1(wd.reduce((t,x)=>t+(x.km||0),0));
    const q=wd.filter(x=>['tempo','threshold','interval','repetition','checkpoint','calibration'].indexOf(x.type)!==-1);
    const lg=wd.filter(x=>x.type==='long')[0];
    const key=wd.filter(x=>{try{return a.sessionImportance(x)==='KEY';}catch(e){return false;}}).length;
    const easyKm=wd.filter(x=>x.type==='easy').reduce((t,x)=>t+(x.km||0),0);
    console.log('\n-- %s, week %d, %s km --', d.toUpperCase(), w.week, km);
    wd.filter(x=>x.km>0).forEach(x=>console.log('     '+pad(a.dow(x.date),4)+pad(x.type,11)+
      num(x.km,6)+'km  '+x.title));
    console.log('     standalone quality %d   KEY %d   easy %d%%   long %s km%s',
      q.length, key, Math.round(100*easyKm/km),
      lg?lg.km:'-', (lg&&lg.mpSegment)?(' (+'+lg.prescription.params.finishKm+'km goal pace)'):' (aerobic)');
    console.log('     zone minutes: threshold %s  interval %s  marathon-pace %s',
      r1(z.threshold/60), r1(z.interval/60), r1(z.mp/60));
  });
  console.log('');
});

console.log('\n=== 5. FREQUENCY x READINESS ===');
console.log('standalone quality per week / hard zone-minutes per week, Build+Peak.\n');
[['no evidence',false],['exposure earned',true]].forEach(([lbl,earned])=>{
  console.log('-- %s --', lbl);
  console.log('  '+pad('dist',7)+[3,4,5,6,7].map(n=>num(n+'d',15)).join(''));
  D.forEach(d=>{
    const cells=[3,4,5,6,7].map(nd=>{
      const {a,blk,days}=plan(d,nd,earned);
      const wks=blk.weeks.filter(w=>w.phase==='Build'||w.phase==='Peak').map(w=>w.week)
        .filter(w=>days.filter(x=>x.week===w).length>=7);
      let q=0,hard=0;
      wks.forEach(w=>{ const z=weekZones(a,days,w);
        hard+=(z.threshold+z.interval+z.mp)/60;
        q+=days.filter(x=>x.week===w&&['tempo','threshold','interval','repetition','checkpoint','calibration'].indexOf(x.type)!==-1).length; });
      return num(r1(q/wks.length)+' / '+Math.round(hard/wks.length)+'min', 15);
    });
    console.log('  '+pad(d,7)+cells.join(''));
  });
  console.log('');
});

console.log('\n\n=== 6. THE EXISTING CONTINUUM, AND WHERE 10K WOULD SIT IN IT ===');
console.log('The two range tables are already monotone across speed -> threshold ->');
console.log('endurance. A 10K key is therefore DERIVABLE from them rather than');
console.log('invented: 10K sits between 5K and the half by race duration, so the');
console.log('midpoint of speed and threshold is what the existing tables already say');
console.log('about a point between them. Shown for HQ to accept or overrule --');
console.log('no such key exists and none is proposed in code.\n');
const IR=a0.EMPHASIS_INTERVAL_RANGE, TR=a0.EMPHASIS_TEMPO_RANGE;
const mid=(a,b)=>Math.round(((a+b)/2)*10)/10;
console.log('  '+pad('key',24)+num('repsLo',8)+num('repsHi',8)+num('mLo',7)+num('mHi',7)+
  num('minLo',8)+num('minHi',8)+num('kmLo',7)+num('kmHi',7));
[['speed (5K, today)','speed'],['threshold (half, today)','threshold'],
 ['endurance (full, today)','endurance']].forEach(([lbl,k])=>{
  console.log('  '+pad(lbl,24)+num(IR[k].repsLo,8)+num(IR[k].repsHi,8)+num(IR[k].mLo,7)+
    num(IR[k].mHi,7)+num(TR[k].minLo,8)+num(TR[k].minHi,8)+num(TR[k].kmLo,7)+num(TR[k].kmHi,7));
});
console.log('  '+pad('-> 10K, interpolated',24)+
  num(mid(IR.speed.repsLo,IR.threshold.repsLo),8)+num(mid(IR.speed.repsHi,IR.threshold.repsHi),8)+
  num(mid(IR.speed.mLo,IR.threshold.mLo),7)+num(mid(IR.speed.mHi,IR.threshold.mHi),7)+
  num(mid(TR.speed.minLo,TR.threshold.minLo),8)+num(mid(TR.speed.minHi,TR.threshold.minHi),8)+
  num(mid(TR.speed.kmLo,TR.threshold.kmLo),7)+num(mid(TR.speed.kmHi,TR.threshold.kmHi),7));
console.log('\n  goal-pace rep length is already stepped by emphasis in');
console.log('  structGoalPaceIntervals: speed 800m, threshold 1200m, endurance 1600m.');
console.log('  A 10K key would take 1000m by the same stepping.');
console.log('\n  NOT PROPOSED FOR CHANGE: LONG_FRACTION (0.24 gives the 15km 10K long');
console.log('  run the profile already caps), profile.longCapKm, MIN_PEAK_LONG_KM,');
console.log('  hasGoalSegment (10K long runs stay aerobic). Only the two structure');
console.log('  range tables and the goal-pace rep length read a quality emphasis.');
