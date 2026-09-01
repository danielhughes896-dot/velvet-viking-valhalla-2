'use strict';
/* SIX-DAY CEILING + CONTINUOUS SESSION-SIZE PRESSURE. READ-ONLY.
 * node test/audit/marathonSixDayBoundary.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};
function paceFromMarathon(raceSec){
  const vdot=app.vdotFromPerformance(42195, raceSec);
  const eq5k=app.equivalentTimeSec(vdot,5000);
  app.state=app.makeDefaultState();
  app.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:eq5k},
    goals:{A:{timeSec:raceSec}},activeGoal:'A',paceOverrides:{}};
  const z=app.getActivePaces(); return (z.E.slow+z.E.fast)/2;
}
const p5=paceFromMarathon(5*3600);

/* ---- PRESSURE IS CONTINUOUS, AND IT HAS TWO INDEPENDENT CAUSES ----
   SESSION COST: how long this run itself is. Rises smoothly across the 75-90
   minute region rather than stepping at either end -- there is no biological
   cliff there and the architecture must not pretend one.
   WEEK SHAPE:   how close a supporting run has come to the week's centrepiece.
   Both are ratios of quantities the programme already holds. Neither is a
   threshold; the DECISION comes from whether another day materially improves
   them, not from crossing a line. */
const REF_COMFORT_SEC = 75*60, REF_UPPER_SEC = 90*60;  // policy, graded not binary
function pressure(easySec, longSec){
  const cost = Math.max(0, Math.min(1.4, (easySec-REF_COMFORT_SEC)/(REF_UPPER_SEC-REF_COMFORT_SEC)));
  const shape = longSec>0 ? Math.max(0, Math.min(1.4, (easySec/longSec - 0.45)/0.30)) : 0;
  return { cost:Math.round(cost*100)/100, shape:Math.round(shape*100)/100,
           score:Math.round(Math.max(cost,shape)*100)/100 };
}
function week(V,L,specific,days,pace){
  const easyDays=days-2, easyKm=Math.max(0,V-L-specific);
  const easyLen=easyDays>0?easyKm/easyDays:0, easySec=easyLen*pace, longSec=L*pace;
  return { V:r1(V),L:r1(L),days,easyDays,easyLen:r1(easyLen),easySec,longSec,
           p:pressure(easySec,longSec), share:Math.round(100*L/V) };
}

console.log('=== 1. PRESSURE IS CONTINUOUS, NOT A CLIFF ===');
console.log('5h00 athlete, 6 days, long run 28 km. Easy-run duration walked upward.\n');
console.log(pad('easy km',9)+num('easy time',11)+num('cost',7)+num('shape',7)+
  num('pressure',10)+'  reading');
[7,8,9,10,11,12,13,14].forEach(e=>{
  const pr=pressure(e*p5, 28*p5);
  console.log(pad(e,9)+num(hhmm(e*p5),11)+num(pr.cost,7)+num(pr.shape,7)+num(pr.score,10)+
    '  '+(pr.score<0.34?'comfortable':pr.score<0.67?'rising':pr.score<1?'substantial':'deliberate medium-long territory'));
});
console.log('\n  No value in that column is a boundary. 1h29 and 1h31 differ by 0.03,');
console.log('  which is what "no biological cliff" has to look like in an architecture.');

console.log('\n\n=== 2. THE SIX-DAY BOUNDARY — WHAT THE 5h00 ATHLETE CAN ACTUALLY HOLD ===');
console.log('Largest coherent week at each frequency, pressure held below "substantial".\n');
console.log(pad('days',6)+num('week V',9)+num('long',7)+num('long time',11)+
  num('easy',7)+num('easy time',11)+num('pressure',10)+num('share',7)+num('unpract.',10));
const best={};
[4,5,6,7].forEach(d=>{
  let b=null;
  for (let L=13; L<=34; L+=0.5)
    for (let V=L+8+(d-2)*3; V<=140; V+=0.5){
      const w=week(V,L,8,d,p5);
      if (w.p.score>=0.67) break;
      if (w.share>35) continue;
      if (!b||w.V>b.V) b=w;
    }
  best[d]=b;
  console.log(pad(d,6)+num(b.V,9)+num(b.L,7)+num(hhmm(b.longSec),11)+num(b.easyLen,7)+
    num(hhmm(b.easySec),11)+num(b.p.score,10)+num(b.share+'%',7)+
    num(Math.round(100*(42.2-b.L)/42.2)+'%',10)+(d===7?'   <== REJECTED: 7 days is not an ordinary intervention':''));
});
console.log('\n  Six days is the ceiling for automatic expansion. Seven is shown only to');
console.log('  price the option HQ has declined: it would buy %s km/wk and %s km of long',
  r1(best[7].V-best[6].V), r1(best[7].L-best[6].L));
console.log('  run over six days, at the cost of the athlete\'s only full rest day.');

console.log('\n\n=== 3. RE-SOLVING AT SIX DAYS WITHOUT ASKING FOR A SEVENTH ===');
(function(){
  const six=best[6];
  console.log('  The athlete is at six days and still distribution-constrained if the');
  console.log('  volume destination is pushed further. The levers, in order:\n');
  const target=95;
  console.log('  HYPOTHETICAL TARGET %s km/wk on six days, long %s km:', target, six.L);
  const bad=week(target, six.L, 8, 6, p5);
  console.log('    easy runs would be %s km (%s), pressure %s -- incoherent.',
    bad.easyLen, hhmm(bad.easySec), bad.p.score);
  console.log('\n  A. HOLD THE VOLUME DESTINATION at %s km. The destination was an', six.V);
  console.log('     estimate, not a requirement; six coherent days is the real constraint.');
  const medLong = week(six.V+9, six.L, 8, 6, p5);
  console.log('  D. DELIBERATE MEDIUM-LONG. If the programme actually wants that stimulus,');
  console.log('     one of the six becomes a NAMED medium-long session -- prescribed with');
  console.log('     a role, not produced by division. That legitimately carries ~%s km',
    r1(medLong.easyLen+3));
  console.log('     while the remaining easy runs stay ordinary.');
  console.log('  F. MORE RUNWAY. Volume rises more slowly over more weeks instead.');
  console.log('  G/H. Or the classification stands: unpractised %s%%, and Valhalla says so.',
    Math.round(100*(42.2-six.L)/42.2));
  console.log('\n  What Valhalla must NOT do is conclude that because %s km/wk was the', target);
  console.log('  computed destination, the athlete therefore needs a seventh running day.');
})();
