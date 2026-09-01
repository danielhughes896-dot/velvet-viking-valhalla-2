'use strict';
/* MARATHON READINESS — ARCHITECTURE MODEL (READ-ONLY, NO RUNTIME CHANGE)
 * Simulates a proposed destination-led architecture beside the current one.
 * Nothing here is wired into the app; it exists to put numbers in front of HQ.
 * node test/audit/marathonReadinessModel.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const a=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const VOLS=[10,20,30,40,50,60,80,100], WKS=[12,14,16,20,24,52];
const hhmm=s=>Math.floor(s/3600)+'h'+String(Math.round((s%3600)/60)).padStart(2,'0');

console.log('=== 1. WHAT THE EVIDENCE CONSTRAINS ===');
console.log('  progression   Buist RCT (GRONORUN): the 10% rule showed NO injury benefit.');
console.log('                Nielsen 2014: >30% over 2 weeks raised DISTANCE-related injury');
console.log('                rate vs <10%; no overall difference. So the defensible bound is');
console.log('                a ceiling near 30%/2wk, not a 10%/wk target.');
console.log('                The engine already runs 4-11%/wk (median 6%) -- well inside it.');
console.log('  long run      Daniels: <=25-30% of weekly volume AND <=2h30-3h00, whichever');
console.log('                comes first. Consensus peak 29-35km OR 2.5-3h. Hansons caps at');
console.log('                26km and works. So 30km is INSIDE mainstream practice but is not');
console.log('                a consensus minimum, and duration is the better-supported axis.\n');

console.log('=== 2. THE SAME 30 km MEANS DIFFERENT THINGS TO DIFFERENT ATHLETES ===');
console.log('Easy long-run pace from the app\'s own zones for three benchmarks.\n');
console.log('  '+pad('5K benchmark',16)+num('easy pace',11)+num('30km takes',12)+
  num('2h30 buys',11)+num('3h00 buys',11)+'  verdict on a 30km requirement');
[['19:30',19*60+30],['23:05',23*60+5],['27:00',27*60],['31:00',31*60]].forEach(([lbl,sec])=>{
  a.state=a.makeDefaultState();
  a.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:sec},
    goals:{A:{timeSec:4*3600}},activeGoal:'A',paceOverrides:{}};
  const z=a.getActivePaces(); const p=(z.E.slow+z.E.fast)/2;
  const t30=30*p;
  console.log('  '+pad(lbl,16)+num(a.fmtPaceFromSecPerKm(p),11)+num(hhmm(t30),12)+
    num(r1(2.5*3600/p)+'km',11)+num(r1(3*3600/p)+'km',11)+'  '+
    (t30>3*3600 ? 'EXCEEDS the 3h ceiling' : t30>2.5*3600 ? 'above the 2h30 guideline' : 'inside the guideline'));
});

console.log('\n\n=== 3. REQUIRED PEAK VOLUME AT EACH LONG-RUN BAND ===');
console.log('V* = required long run / long-run share. The audit hypothesis 30/0.32 = 93.8');
console.log('is only one column of this table, and it uses a share ABOVE the cited guideline.\n');
console.log('  '+pad('long run',10)+[0.40,0.35,0.32,0.30,0.25].map(f=>num(Math.round(f*100)+'%',9)).join('')+
  '   <- long-run share of the week');
[22,26,28,30,32].forEach(L=>{
  console.log('  '+pad(L+' km',10)+[0.40,0.35,0.32,0.30,0.25].map(f=>num(r1(L/f),9)).join(''));
});
console.log('\n  Daniels puts the ceiling at 30% below ~65km/wk and 25% above it. A 30km');
console.log('  long run therefore needs 100-120km/wk to be guideline-compliant, which is');
console.log('  more than most marathon athletes will ever run. That is the real tension:');
console.log('  the 25-30% guideline is drawn from higher-mileage runners and does not');
console.log('  describe how low-volume marathon plans are actually written.');

console.log('\n\n=== 4. WEEKS REQUIRED TO REACH A DESTINATION, AT EVIDENCE-BOUNDED RATES ===');
console.log('Ramp with a cutback every 4th week (CUTBACK_FACTOR 0.78), so 3 of every 4');
console.log('weeks progress. Plus 2 peak weeks at the destination and a 3-week taper.\n');
function weeksNeeded(V0, Vstar, r){
  if (V0 >= Vstar) return 0;
  const progressWeeks = Math.ceil(Math.log(Vstar/V0)/Math.log(1+r));
  return Math.ceil(progressWeeks*4/3);
}
[[0.06,'engine median 6%/wk'],[0.10,'10%/wk'],[0.14,'14%/wk (still <30%/2wk)']].forEach(([r,lbl])=>{
  console.log('-- %s --', lbl);
  console.log('  '+pad('start',7)+[70,80,90,100].map(v=>num('V*='+v,11)).join('')+
    '   (ramp weeks + 2 peak + 3 taper)');
  VOLS.forEach(V0=>{
    console.log('  '+pad(V0,7)+[70,80,90,100].map(Vs=>{
      const w=weeksNeeded(V0,Vs,r);
      return num(V0>=Vs ? 'ready' : (w+5)+'wk', 11);
    }).join(''));
  });
  console.log('');
});
