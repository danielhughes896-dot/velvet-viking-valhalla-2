'use strict';
/* MARATHON PHASE ALLOCATION ACROSS RUNWAY. READ-ONLY.
 * node test/audit/marathonPhaseArchitecture.js
 *
 * What the engine ACTUALLY allocates today at each runway, measured from
 * phaseForWeek(), against the HQ hypothesis of 4 Base / 6 Build / 3 Peak /
 * 2 Taper. Nothing here proposes; it establishes the starting position.
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);

function alloc(N){
  const c={Base:0,Build:0,Peak:0,Taper:0,Final:0}, seq=[];
  for(let w=1;w<=N;w++){ const p=app.phaseForWeek(w,N,'race'); c[p]++; seq.push(p[0]); }
  return {c,seq:seq.join('')};
}

console.log('=== 1. WHAT THE ENGINE ALLOCATES TODAY (race arc, any distance) ===');
console.log('phaseForWeek() is canonical -- it selects which structure pool a week draws from.\n');
console.log(pad('N',5)+num('Base',6)+num('Build',7)+num('Peak',6)+num('Taper',7)+num('Final',7)+
  '   sequence                        wind-down');
[4,6,8,10,12,14,15,16,18,20,24,30].forEach(N=>{
  const a=alloc(N), wind=a.c.Taper+a.c.Final;
  console.log(pad(N,5)+num(a.c.Base,6)+num(a.c.Build,7)+num(a.c.Peak,6)+num(a.c.Taper,7)+
    num(a.c.Final,7)+'   '+pad(a.seq,32)+wind+' wk (D-'+(wind*7-1)+')');
});

console.log('\n  Two things this table settles.');
console.log('  (a) EVERY phase scales with N. Base is 25% of build weeks and Peak is the');
console.log('      top 20% at every runway. That IS proportional stretch/squash, which is');
console.log('      exactly the behaviour HQ has now prohibited -- it is not a tendency, it');
console.log('      is the definition (PHASE_BASE_END=0.25, PHASE_BUILD_END=0.80).');
console.log('  (b) The wind-down is 3 calendar weeks at every N>=4: two taper weeks plus');
console.log('      race week. That is D-20, not D-14. HQ asks for 2. The engine is one');
console.log('      week deeper into the wind-down than the approved taper architecture.');

console.log('\n\n=== 2. HQ HYPOTHESIS vs ENGINE AT N=15 ===\n');
const a15=alloc(15);
console.log(pad('phase',10)+num('HQ',5)+num('engine',9)+'   note');
const rows=[['Base',4,a15.c.Base,'engine gives 25% of 12 build weeks = 3'],
            ['Build',6,a15.c.Build,'agrees'],
            ['Peak',3,a15.c.Peak,'agrees'],
            ['Taper',2,a15.c.Taper+a15.c.Final,'engine spends 3 (2 taper + race week)']];
rows.forEach(r=>console.log(pad(r[0],10)+num(r[1],5)+num(r[2],9)+'   '+r[3]));
console.log('\n  The whole disagreement at 15 weeks is ONE WEEK, and it is the same week');
console.log('  twice: the engine holds a third wind-down week that HQ wants returned to');
console.log('  Base. Build and Peak already match the hypothesis exactly. That is a much');
console.log('  smaller change than "adopt a new phase architecture" implies.');

console.log('\n\n=== 3. WHERE THE PROPORTIONAL MODEL BREAKS ===');
console.log('Peak and Taper are event preparation. They should not shrink because the plan is short.\n');
console.log(pad('N',5)+num('Peak wk',9)+num('wind-down',11)+'   what an event-driven model would want');
[6,8,10,12,15,20,24,30].forEach(N=>{
  const a=alloc(N);
  const want = N<=6 ? '1 peak + 1 wk wind-down (all that fits)' :
               N<=10? '2 peak exposures + 2 wk wind-down' :
                      '2 peak exposures + 2 wk wind-down (fixed)';
  console.log(pad(N,5)+num(a.c.Peak,9)+num(a.c.Taper+a.c.Final,11)+'   '+want);
});
console.log('\n  At N=30 the engine allocates 6 Peak weeks. There is no marathon-preparation');
console.log('  reason for six peak weeks; the approved architecture is TWO peak long-run');
console.log('  exposures with an absorption week between them. Six is arithmetic, not');
console.log('  methodology -- the clearest single piece of evidence that long runways are');
console.log('  currently stretched rather than shaped.');

console.log('\n\n=== 4. AND THE VOLUME ARITHMETIC ALREADY STOPPED AT 14 ===\n');
console.log(pad('N',5)+num('buildWeeks',12)+num('devMult',10)+'   ');
[8,10,12,14,15,16,20,24,30].forEach(N=>{
  const bw=app.computeTaperInfo(N).buildWeeks;
  const m=app.developmentMultiplierFor('full',N,'race');
  console.log(pad(N,5)+num(bw,12)+num(Math.round(m*1000)/1000,10)+
    (N>=14?'   saturated -- extra weeks buy no destination':''));
});
console.log('\n  So beyond 14 weeks the engine already gives the athlete NOTHING extra in');
console.log('  volume destination -- it only gives them more Base and more Peak weeks to');
console.log('  spend getting there. A 24-week race plan is a 15-week plan with nine weeks');
console.log('  of dilution, which is the defect HQ has independently identified.');
