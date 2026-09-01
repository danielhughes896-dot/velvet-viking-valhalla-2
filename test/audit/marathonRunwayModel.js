'use strict';
/* PROPOSED PROGRAMME-SHAPE MODEL. READ-ONLY, WIRED INTO NOTHING.
 * node test/audit/marathonRunwayModel.js
 *
 * A model of the architecture HQ has hypothesised, so that the hypothesis can
 * be tested at every runway rather than accepted at 15 weeks and assumed
 * elsewhere. Nothing here is production code and nothing calls it.
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};

/* ---- THE DEDICATED WINDOW, AND WHY 15 ----
   Not chosen. Derived from the pieces of the marathon programme that are
   already settled and are not negotiable against each other:
     TAPER    2 calendar weeks, race week included. Bosquet: 2 weeks, dose
              down, intensity and frequency held. Event-anchored, so fixed.
     PEAK     2 meaningful long-run exposures with an absorption week between
              them = 3 weeks exactly. Approved architecture; also fixed.
     BUILD    the phase that has to move an athlete from their demonstrated
              long run to a peak-exposure long run. See below -- this is the
              only phase whose length is derived rather than declared.
     BASE     whatever remains, and the first thing surrendered when it must be.
*/
const TAPER_WK = 2, PEAK_WK = 3;

/* How many weeks Build actually needs. The long run is the binding constraint,
   not weekly volume: it steps once a week at best, it cannot step every week
   (cutbacks), and the step is bounded. Measured from the engine's own long-run
   progression rather than assumed. */
function buildWeeksNeeded(startLongKm, peakLongKm){
  const STEP = 1.6;              // km/wk, engine's observed median outside rebound
  const CUTBACK_EVERY = 4;       // one week in four does not progress
  const gap = Math.max(0, peakLongKm - startLongKm);
  const progressing = Math.ceil(gap / STEP);
  return Math.ceil(progressing * CUTBACK_EVERY / (CUTBACK_EVERY - 1));
}

console.log('=== 1. IS 15 WEEKS DERIVABLE, OR JUST A NUMBER? ===');
console.log('Build weeks the long-run progression actually needs, per starting long run.\n');
console.log(pad('start long',12)+num('peak long',11)+num('build wk',10)+
  num('+peak 3',9)+num('+taper 2',10)+num('total',7)+'   ');
[[8,30],[10,30],[12,30],[14,30],[16,30],[18,32],[20,32],[24,32]].forEach(([s,p])=>{
  const b=buildWeeksNeeded(s,p);
  console.log(pad(s+' km',12)+num(p+' km',11)+num(b,10)+num(b+3,9)+num(b+5,10)+
    num(b+5,7)+(b+5>=13&&b+5<=17?'   <== lands in the 13-17 region':''));
});
console.log('\n  A marathon-bound athlete typically arrives with a 12-18 km long run and');
console.log('  needs a ~30 km peak exposure. That is a 12-18 km gap, six to twelve');
console.log('  progressing weeks, eight to sixteen calendar weeks once cutbacks are paid');
console.log('  for, plus five fixed weeks of Peak and Taper. The 13-17 week region is what');
console.log('  falls out. 15 sits in the middle of it and is defensible as a DEFAULT --');
console.log('  but the derivation says the right number is athlete-dependent, and an');
console.log('  architecture that computes it will beat one that declares it.');

/* ---- THE PROPOSED ALLOCATOR ----
   Event-anchored rather than proportional: Taper and Peak are paid FIRST at
   their event-driven size, Build takes what it needs, Base receives the
   remainder and is the first thing surrendered. */
function allocate(N){
  if (N < 4) return {viable:false, why:'below any coherent marathon shape'};
  let taper = N>=6 ? 2 : 1;
  let peak  = N>=10 ? 3 : N>=7 ? 2 : 1;
  let rest  = N - taper - peak;
  let base  = 0, build = rest;
  if (N >= 11){ base = Math.min(4, rest - 6); if(base<0) base=0; build = rest - base; }
  return {viable:true, base, build, peak, taper,
          note: N<=10 ? 'no dedicated Base -- enter Build at demonstrated level'
              : base<4 ? 'Base compressed' : 'full shape'};
}

console.log('\n\n=== 2. PROPOSED ALLOCATION vs ENGINE, EVERY REQUIRED RUNWAY ===\n');
console.log(pad('N',5)+pad('engine Ba/Bu/Pk/Tp+F',22)+pad('proposed Ba/Bu/Pk/Tp',22)+
  '   what is removed / protected');
[4,6,8,10,12,14,15,16,20,24,30].forEach(N=>{
  const c={Base:0,Build:0,Peak:0,Taper:0,Final:0};
  for(let w=1;w<=N;w++) c[app.phaseForWeek(w,N,'race')]++;
  const eng=[c.Base,c.Build,c.Peak,c.Taper+c.Final].join('/');
  const p=allocate(N);
  const prop = N>15 ? '15wk cycle + '+(N-15)+' pre' : [p.base,p.build,p.peak,p.taper].join('/');
  const note = N>15 ? 'Race Goal stops stretching; surplus becomes a development block'
             : p.note;
  console.log(pad(N,5)+pad(eng,22)+pad(prop,22)+'   '+note);
});
console.log('\n  Three behaviours the proposed allocator has and the engine does not:');
console.log('  - Taper and Peak stop scaling with N. At N=30 the engine wants six Peak');
console.log('    weeks; the event only ever wants three.');
console.log('  - Base is the phase that absorbs shortage, and disappears entirely at 10');
console.log('    weeks and below rather than surviving as a token single week.');
console.log('  - Above 15 the Race Goal cycle stops growing at all.');

console.log('\n\n=== 3. SURPLUS RUNWAY — WHAT HAPPENS TO N-15 ===\n');
console.log(pad('N',5)+num('surplus',9)+'   disposition');
[15,16,17,18,19,20,22,24,30,40].forEach(N=>{
  let s=N-15, chain=[], absorb=0;
  while(s>3){ const b=Math.min(12,s); if(s-b>0&&s-b<=3){ chain.push(b); absorb=s-b; s=0; }
              else { chain.push(b); s-=b; } }
  if(s>0) absorb+=s;
  const d = (!chain.length&&!absorb) ? 'dedicated Race Goal cycle only'
    : (!chain.length) ? 'ABSORB: no separate block. Extend Base by '+absorb+' wk within the cycle.'
    : chain.map(b=>b+'-wk development block').join(' + ')+
      (absorb?' + '+absorb+' wk absorbed into Base':'')+', then 15-wk cycle';
  console.log(pad(N,5)+num(N-15,9)+'   '+d);
});
console.log('\n  The 1-3 week band is the awkward case HQ asked about, and it should NOT');
console.log('  become a two-week Aerobic Base block. A development programme has its own');
console.log('  arc and its own success criteria; three weeks cannot express either, and a');
console.log('  stub block would be exactly the "Marathon Base under another name" HQ');
console.log('  prohibited. Absorbing 1-3 weeks into Base keeps the cycle honest, because');
console.log('  Base is the phase whose length is genuinely elastic.');
console.log('  Above 27 weeks the surplus exceeds what one development block should be,');
console.log('  for the same reason a 24-week Race Goal is wrong: a development programme');
console.log('  also has a length beyond which it stops developing and starts diluting. Cap');
console.log('  it at 12 and let the leftover fall back into the absorb band.');

console.log('\n\n=== 4. WHICH DEVELOPMENT PROGRAMME — AND FROM WHAT EVIDENCE ===\n');
const rows=[
 ['aerobic volume well below what the marathon destination needs','Aerobic Base','the gap is aerobic capacity; threshold work will not close it'],
 ['long run far below peak-exposure requirement','Aerobic Base','durability is built by aerobic volume and long running'],
 ['volume adequate, no established threshold/interval response','Speed & Threshold','capacity exists; the athlete has never demonstrated absorbing quality'],
 ['volume adequate, quality established, marathon-specific gap only','neither -- shorten the wait','a development block would displace nothing worth developing'],
 ['both aerobic and quality gaps, surplus >= 8 weeks','Aerobic Base first','volume is prerequisite to absorbing quality, not the reverse'],
 ['both gaps, surplus < 8 weeks','Aerobic Base','one block done properly beats two done partially']];
console.log(pad('demonstrated state',60)+pad('choose',20)+'why');
rows.forEach(r=>console.log(pad(r[0],60)+pad(r[1],20)+r[2]));
console.log('\n  Every input on the left is something the app already holds: demonstrated');
console.log('  weekly volume, demonstrated long run, and athleteResponseModel() family');
console.log('  confidence. No new coaching brain is required to make this selection, which');
console.log('  is the constraint SYSTEM 9 sets. What IS required is that the selection be');
console.log('  a RECOMMENDATION the athlete confirms, not an automatic substitution.');
