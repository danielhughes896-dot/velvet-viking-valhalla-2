'use strict';
/* MARATHON DEVELOPMENT ARCHITECTURE — DESIGN MODEL (READ-ONLY)
 * Simulates the PROPOSED architecture. Wired into nothing; production runtime
 * is untouched. node test/audit/marathonDevelopmentModel.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};

/* ================= AUTHORITIES, EACH LABELLED BY EVIDENCE GRADE ============
   B  meta-analysis / RCT        D  coaching convention
   C  observational/physiology   E  Valhalla engineering policy               */
const READINESS_LONG_KM   = 30;      // D  normal benchmark, HQ-approved semantics
const LONG_CAP_KM         = 32;      // D  existing longCapKm, preserved
const TOF_BACKSTOP_SEC    = 3*3600;  // D  convention, MODIFIES rather than forbids
const SHARE_REGION        = [0.25, 0.35]; // D  diagnostic only, never generative
const VOL_RATE_BACKSTOP   = 0.10;    // C  well inside Nielsen's 30%/2wk
const LONG_RATE_BACKSTOP  = 0.10;    // E  policy: no long-run step above +10%
const CUTBACK_EVERY       = 4;       // E  existing 3-up/1-down, preserved
const TAPER_DAYS          = 14;      // B  Bosquet: 2 weeks, -41..60% volume
const PEAK_EXPOSURES      = 2;       // E  HQ-approved, already occurs naturally

/* THE EVENT DESTINATION IS A REGION, NOT A NUMBER. Weekly volume's job in
   marathon preparation is to SUPPORT the readiness long run and the
   marathon-specific work around it. So the destination is the band of weekly
   volumes in which that long run is a coherent share -- never start x anything.
   A 100 km/wk athlete is already inside it and needs no growth at all, which
   is exactly the inflation the current architecture produces. */
function destinationRegion(Lstar){
  return [ r1(Lstar/SHARE_REGION[1]), r1(Lstar/SHARE_REGION[0]) ];
}
/* THE DESTINATION SITS IN THE MIDDLE OF THE REGION, NOT ON ITS EDGE, and the
   model found out why. Set at the bottom -- the least volume that supports the
   long run -- the destination volume's share ceiling equals the destination
   long run EXACTLY, so the support gate below holds the final step and the
   athlete arrives permanently just short. Three cohorts missed their
   destination at every runway for that reason alone. A destination that only
   just supports its own long run is not a destination; it is a boundary. */
const SHARE_MID = (SHARE_REGION[0]+SHARE_REGION[1])/2;
function destinationVolume(Lstar){ return r1(Lstar/SHARE_MID); }
function readinessLong(paceSec){
  const timeCap = TOF_BACKSTOP_SEC/paceSec;
  return { Lstar: r1(Math.min(READINESS_LONG_KM, LONG_CAP_KM, timeCap)),
           timeCapped: timeCap < READINESS_LONG_KM };
}
function simulate(V0, L0, W, paceSec){
  const { Lstar, timeCapped } = readinessLong(paceSec);
  const region = destinationRegion(Lstar);
  /* Runway: taper is event-anchored at D-14 = one taper week + race week. */
  const taperWeeks = 1, raceWeek = 1;
  const devWeeks = Math.max(1, W - taperWeeks - raceWeek);
  const effective = devWeeks - Math.floor(devWeeks/CUTBACK_EVERY);  // cutbacks don't progress

  /* ---- WEEKLY VOLUME: its own authority ----
     Destination is the BOTTOM of the region -- the least volume that supports
     the readiness long run coherently. Growth stops on arrival; it is not a
     target to be exceeded because time remains. */
  const Vdest = destinationVolume(Lstar);
  const vGapRate = V0 >= Vdest ? 0 : Math.pow(Vdest/V0, 1/effective) - 1;
  const vRate = Math.min(vGapRate, VOL_RATE_BACKSTOP);

  /* ---- LONG RUN: its own authority, its own gap over its own runway ----
     Not a share of the week and not a fixed staircase: the long run's own
     distance to its own destination, spread over the weeks it has, capped by
     an absorption backstop. */
  const lGapRate = L0 >= Lstar ? 0 : Math.pow(Lstar/L0, 1/effective) - 1;
  const lRate = Math.min(lGapRate, LONG_RATE_BACKSTOP);

  const rows=[]; let V=V0, L=L0, held=0, modified=0;
  for (let w=1; w<=W; w++){
    const isRace = w===W, isTaper = w===W-1;
    const cut = !isRace && !isTaper && w%CUTBACK_EVERY===0;
    let gate='';
    if (isRace){ V=r1(Vdest*0.35); L=0; }
    else if (isTaper){ V=r1(V*0.5); L=r1(Math.min(L, L*0.55)); gate='taper'; }
    else if (cut){ /* consolidate: hold the ladder, drop the week */ }
    else {
      const Vn = Math.min(Vdest, V*(1+vRate));
      let Ln = Math.min(Lstar, L*(1+lRate));
      /* ---- COUPLING GATES: permit / hold / modify / defer ---- */
      if (Ln > Vn*SHARE_REGION[1]){ Ln = L; gate='HOLD: week cannot support it'; held++; }
      if (Ln*paceSec > TOF_BACKSTOP_SEC){ Ln = r1(TOF_BACKSTOP_SEC/paceSec); gate='MODIFY: time on feet'; modified++; }
      V=Vn; L=Ln;
    }
    const shown = cut ? r1(V*0.78) : r1(V);
    const lShown = cut ? r1(L*0.7) : r1(L);
    rows.push({ w, phase: isRace?'Race':isTaper?'Taper':cut?'Cutback':(w<=3?'Base':w>devWeeks-3?'Peak':'Build'),
      V:shown, L:lShown, gate, share: shown? Math.round(100*lShown/shown):0, tof:lShown*paceSec });
  }
  const peak = rows.filter(r=>r.phase!=='Race'&&r.phase!=='Taper');
  const longs = peak.map(r=>r.L).sort((a,b)=>b-a);
  return { Lstar, timeCapped, region, Vdest, devWeeks, effective,
    vGapRate:Math.round(vGapRate*1000)/10, vRate:Math.round(vRate*1000)/10,
    lGapRate:Math.round(lGapRate*1000)/10, lRate:Math.round(lRate*1000)/10,
    peakV:Math.max.apply(null,peak.map(r=>r.V)), peakL:longs[0], secondL:longs[1],
    reached: longs[0]+0.05>=Lstar, held, modified, rows,
    cls: V0>=Vdest ? 'AMPLE'
       : vGapRate<=0.06 && lGapRate<=0.06 ? 'AMPLE'
       : vGapRate<=VOL_RATE_BACKSTOP && lGapRate<=LONG_RATE_BACKSTOP ? 'ADEQUATE'
       : (longs[0]>=Lstar*0.8) ? 'MARGINAL' : 'INSUFFICIENT' };
}
/* Assumed long-run pace and starting long run, both stated. */
const benchFor=v=> v<20?33*60 : v<35?29*60 : v<50?26*60 : v<70?23*60 : 20*60;
function paceOf(v){
  app.state=app.makeDefaultState();
  app.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:benchFor(v)},
    goals:{A:{timeSec:4*3600}},activeGoal:'A',paceOverrides:{}};
  const z=app.getActivePaces(); return (z.E.slow+z.E.fast)/2;
}
const startLong=v=>r1(Math.max(5, v*0.30));   // instrument assumption, stated

console.log('=== THE DESTINATION IS A REGION, NOT A MULTIPLE OF THE START ===');
console.log(pad('start',7)+num('pace',9)+num('L* (dest)',11)+num('region km/wk',15)+
  num('V dest',9)+num('today\'s peak',14)+'  note');
[15,25,40,60,80,100].forEach(v=>{
  const p=paceOf(v), rd=readinessLong(p), reg=destinationRegion(rd.Lstar);
  console.log(pad(v,7)+num(app.fmtPaceFromSecPerKm(p),9)+num(rd.Lstar+(rd.timeCapped?'*':''),11)+
    num(reg[0]+'-'+reg[1],15)+num(destinationVolume(rd.Lstar),9)+num(r1(v*1.75),14)+
    '  '+(rd.timeCapped?'time-capped':'')+(v*1.75>reg[1]?'  today OVERSHOOTS the region':''));
});
console.log('\n  * the 3h time-on-feet backstop modified the destination downward.');
console.log('  Today 100 km/wk -> 170 km/wk peak. The region tops out at %s.',
  destinationRegion(readinessLong(paceOf(100)).Lstar)[1]);

console.log('\n\n=== COHORT x RUNWAY MATRIX (proposed architecture) ===');
console.log(pad('start',7)+pad('wks',5)+pad('class',13)+num('devWks',8)+
  num('req V%',8)+num('used V%',9)+num('req L%',8)+num('used L%',9)+
  num('peak km',9)+num('peak long',11)+num('2nd long',10)+num('time',7)+
  num('share',7)+num('L*',6)+num('reached',9));
const M=[];
[15,25,40,60,100].forEach(v=>{
  [12,16,20,24,30,40].forEach(W=>{
    const p=paceOf(v), s=simulate(v, startLong(v), W, p);
    M.push({v,W,s});
    console.log(pad(v,7)+pad(W,5)+pad(s.cls,13)+num(s.devWeeks,8)+
      num(s.vGapRate+'%',8)+num(s.vRate+'%',9)+num(s.lGapRate+'%',8)+num(s.lRate+'%',9)+
      num(s.peakV,9)+num(s.peakL,11)+num(s.secondL,10)+num(hhmm(s.tofPeak||s.peakL*p),7)+
      num(s.rows.filter(r=>r.phase!=='Race').map(r=>r.share).sort((a,b)=>b-a)[0]+'%',7)+
      num(s.Lstar,6)+num(s.reached?'YES':'no',9));
  });
});
console.log('\n  req V%% / req L%% = the rate the runway DEMANDS. used = what the');
console.log('  backstops permit. Where required exceeds used, the destination is not');
console.log('  reached and the classification says so.');

console.log('\n\n=== WHEN CAN A 15 km/wk ATHLETE REACH THE NORMAL BENCHMARK? ===');
console.log('Their destination is time-capped at %s km, not 30.',
  readinessLong(paceOf(15)).Lstar);
[12,16,20,24,30,40,52].forEach(W=>{
  const p=paceOf(15), s=simulate(15, startLong(15), W, p);
  console.log('  '+pad(W+' weeks',10)+pad(s.cls,13)+' peak '+num(s.peakV,6)+' km/wk, long '+
    num(s.peakL,5)+' km ('+hhmm(s.peakL*p)+') '+
    (s.reached?'<== reaches its destination':'  '+r1(s.Lstar-s.peakL)+' km short'));
});

console.log('\n\n=== REPRESENTATIVE TRAJECTORIES ===');
[[15,24],[40,16],[100,16]].forEach(([v,W])=>{
  const p=paceOf(v), s=simulate(v,startLong(v),W,p);
  console.log('\n-- %s km/wk start, %d weeks, %s (destination %s km long / %s km/wk) --',
    v, W, s.cls, s.Lstar, s.Vdest);
  console.log('   '+pad('wk',4)+pad('phase',10)+num('week km',9)+num('long km',9)+
    num('share',7)+num('time',7)+'  gate');
  s.rows.forEach(r=>console.log('   '+pad(r.w,4)+pad(r.phase,10)+num(r.V,9)+num(r.L,9)+
    num(r.share+'%',7)+num(r.L?hhmm(r.tof):'-',7)+'  '+r.gate));
});
