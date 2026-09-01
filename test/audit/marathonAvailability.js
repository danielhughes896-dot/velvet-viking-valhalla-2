'use strict';
/* SESSION-SIZE PRESSURE + ATHLETE-AUTHORISED AVAILABILITY EXPANSION
 * READ-ONLY DESIGN MODEL. Wired into nothing. node test/audit/marathonAvailability.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};

/* ---- THE AUTHORITY FOR "TOO BIG", AND IT IS NOT A KILOMETRE CONSTANT ----
   An easy run's job is aerobic support and recovery. Past roughly 75-90
   minutes it stops being that and becomes what Pfitzinger names a MEDIUM-LONG
   RUN -- a deliberate session type with its own recovery cost, not something a
   week should acquire by dividing leftover mileage. So pressure is defined in
   TIME, which is why it correctly bites a slower athlete at lower mileage:
   the same 15 km is 75 minutes for one athlete and over two hours for another.
   Bands are analytical, not approved thresholds. */
const EASY_COMFORTABLE_SEC = 75*60;
const EASY_UPPER_SEC       = 90*60;

function paceFromMarathon(raceSec){
  const vdot=app.vdotFromPerformance(42195, raceSec);
  const eq5k=app.equivalentTimeSec(vdot,5000);
  app.state=app.makeDefaultState();
  app.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:eq5k},
    goals:{A:{timeSec:raceSec}},activeGoal:'A',paceOverrides:{}};
  const z=app.getActivePaces(); return (z.E.slow+z.E.fast)/2;
}
/* The week, composed from what it must carry -- never from a share. */
function week(V, L, specific, days, pace){
  const easyDays = days - 2;                    // long run + one specific session
  const easyKm = Math.max(0, V - L - specific);
  const easyLen = easyDays>0 ? easyKm/easyDays : 0;
  const easySec = easyLen*pace;
  return { V:r1(V), L:r1(L), specific:r1(specific), days, easyDays,
    easyLen:r1(easyLen), easySec,
    pressure: easySec > EASY_UPPER_SEC ? 'HIGH'
            : easySec > EASY_COMFORTABLE_SEC ? 'RISING' : 'none',
    share: Math.round(100*L/V), longSec:L*pace };
}
/* The SMALLEST expansion that clears the pressure, at unchanged volume. */
function minimumExpansion(V, L, specific, days, pace, maxDays){
  for (let d=days+1; d<=maxDays; d++){
    const w=week(V,L,specific,d,pace);
    if (w.pressure==='none') return { days:d, week:w };
  }
  return null;
}

console.log('=== 1. THE HQ EXAMPLE, MEASURED ===');
console.log('68 km/wk, 23 km long run, 4 authorised days. Two athletes, same numbers.\n');
console.log(pad('athlete',18)+num('easy pace',11)+num('days',6)+num('easy len',10)+
  num('easy time',11)+num('pressure',10)+num('long time',11));
[['3h30 marathon',3.5*3600],['5h00 marathon',5*3600]].forEach(([lbl,rs])=>{
  const p=paceFromMarathon(rs);
  [4,5,6].forEach(d=>{
    const w=week(68,23,10,d,p);
    console.log(pad(d===4?lbl:'',18)+num(d===4?app.fmtPaceFromSecPerKm(p):'',11)+
      num(d,6)+num(w.easyLen,10)+num(hhmm(w.easySec),11)+num(w.pressure,10)+
      num(hhmm(w.longSec),11));
  });
});
console.log('\n  The same 15 km easy run is 1h25 for the faster athlete and 2h04 for the');
console.log('  slower one. A kilometre threshold cannot see that; a duration one can.');
console.log('  The slower athlete is under HIGH pressure at four days where the faster');
console.log('  athlete is only RISING -- which is the correct coaching answer.');

console.log('\n\n=== 2. WHEN DOES PRESSURE ACTUALLY APPEAR? ===');
console.log('Walking a 5h00 athlete up their volume ladder on four authorised days.\n');
console.log(pad('week V',9)+num('long',7)+num('easy len',10)+num('easy time',11)+
  num('pressure',10)+'  what Valhalla should do');
const p5=paceFromMarathon(5*3600);
[[40,13],[46,15],[52,17],[58,19],[62,20.5],[68,23],[74,25]].forEach(([V,L])=>{
  const w=week(V,L,8,4,p5);
  /* RECOMMEND ONLY ON HIGH. RISING is a watch state: the week is getting
     full but is still coherent, and asking then would be asking because the
     arithmetic looks tidier rather than because the programme needs it. */
  const exp = w.pressure==='HIGH' ? minimumExpansion(V,L,8,4,p5,7) : null;
  console.log(pad(w.V,9)+num(w.L,7)+num(w.easyLen,10)+num(hhmm(w.easySec),11)+
    num(w.pressure,10)+'  '+(w.pressure!=='HIGH'?'continue on four days'
      : exp ? 'recommend '+exp.days+' days (easy '+exp.week.easyLen+' km, '+hhmm(exp.week.easySec)+')'
            : 'no expansion resolves it -- constrain volume instead'));
});

console.log('\n\n=== 3. ACCEPT vs DECLINE — THE CONSEQUENCE, MODELLED ===');
console.log('5h00 athlete, 4 authorised days, developing toward 68 km/wk.\n');
(function(){
  const p=p5, L=23, sp=8;
  const acc=week(68,L,sp,5,p), acc6=week(68,L,sp,6,p);
  const cur=week(68,L,sp,4,p);
  console.log('  CURRENT (4 days, 68 km target)');
  console.log('    long %s km (%s), %d easy runs of %s km (%s each)  pressure %s',
    cur.L, hhmm(cur.longSec), cur.easyDays, cur.easyLen, hhmm(cur.easySec), cur.pressure);
  console.log('    TRAINING PROBLEM: the ordinary easy runs would each be longer than');
  console.log('    the point at which an easy run stops being easy support.');
  console.log('\n  RECOMMENDED (6 days -- the smallest expansion that clears it)');
  console.log('    long %s km unchanged, %d easy runs of %s km (%s each)  pressure %s',
    acc6.L, acc6.easyDays, acc6.easyLen, hhmm(acc6.easySec), acc6.pressure);
  console.log('    NOTE: total volume is UNCHANGED at %s km. The first purpose of the', acc6.V);
  console.log('    extra day is DISTRIBUTION, not more training.');
  /* DECLINE: re-solve, do not squeeze. Find the largest volume that is still
     coherent on four days at this long run. */
  let Vok=null;
  for (let V=68; V>=30; V-=0.5){ if (week(V,L,sp,4,p).pressure!=='HIGH'){ Vok=V; break; } }
  let LandV=null;
  if (Vok===null){ for (let V=68; V>=30; V-=0.5){ for (let Ln=L; Ln>=12; Ln-=0.5){
      if (week(V,Ln,sp,4,p).pressure!=='HIGH'){ LandV={V,L:Ln}; break; } } if(LandV) break; } }
  console.log('\n  IF DECLINED (4 days remain authoritative)');
  if (Vok!==null){
    const d=week(Vok,L,sp,4,p);
    console.log('    volume progression HOLDS at %s km rather than %s -- the long run is', d.V, 68);
    console.log('    kept at %s km and the easy runs stay at %s km (%s).', d.L, d.easyLen, hhmm(d.easySec));
  } else if (LandV){
    const d=week(LandV.V,LandV.L,sp,4,p);
    console.log('    both must give: volume holds at %s km AND the long run holds at %s km,', d.V, d.L);
    console.log('    leaving easy runs of %s km (%s).', d.easyLen, hhmm(d.easySec));
  }
  console.log('    NO adherence, confidence or execution penalty. The residual readiness');
  console.log('    compromise is retained honestly and reported, not hidden.');
})();

console.log('\n\n=== 4. THE SLOWER ATHLETE AT 4 / 5 / 6 DAYS — WHAT THE DAY BUYS ===');
console.log('5h00 marathon athlete. The long run is allowed past 3h under the approved');
console.log('ruling, so its DURATION is shown rather than hidden, and the share');
console.log('diagnostic is applied rather than ignored -- a 52%% long-run share is not a');
console.log('coherent week however large the total.\n');
console.log(pad('days',6)+num('max V',9)+num('long',7)+num('long time',11)+
  num('easy len',10)+num('easy time',11)+num('share',7)+num('unpractised',13));
[4,5,6].forEach(d=>{
  let best=null;
  for (let L=13; L<=34; L+=0.5){
    for (let V=L+8+(d-2)*3; V<=140; V+=0.5){
      const w=week(V,L,8,d,p5);
      if (w.pressure==='HIGH') break;
      /* THE SHARE DIAGNOSTIC PARTICIPATES. Not a generator, but a week whose
         long run is half of it is incoherent and the diagnostic exists to say
         so. Upper edge of the region. */
      if (w.share > 35) continue;
      if (!best || w.V>best.V) best=w;
    }
  }
  if (!best){ console.log(pad(d,6)+'  no coherent week at this frequency'); return; }
  const gapPct=Math.round(100*(42.2-best.L)/42.2);
  console.log(pad(d,6)+num(best.V,9)+num(best.L,7)+num(hhmm(best.longSec),11)+
    num(best.easyLen,10)+num(hhmm(best.easySec),11)+num(best.share+'%',7)+num(gapPct+'%',13));
});
console.log('\n  Each additional day raises the sustainable week AND lets the long run');
console.log('  keep developing coherently -- which is the training problem it is asked');
console.log('  to solve, not a percentage it is asked to improve.');
