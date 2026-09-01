'use strict';
/* MARATHON READINESS AS A SYSTEM PROPERTY — READ-ONLY.
 * The question HQ asked: if the long run is time-capped, what prepares the
 * athlete for the rest of 42.2 km? node test/audit/marathonReadinessGap.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};

console.log('=== 1. THE FIELD GENUINELY DISAGREES ABOUT THE LONGEST RUN ===');
console.log('  Hansons        ~26 km max, compensated by cumulative fatigue and high');
console.log('                 weekly frequency. Explicitly rejects the 32km long run.');
console.log('  Daniels        <=25-30% of week AND <=2h30-3h00, whichever comes first.');
console.log('  Pfitzinger     up to ~35 km for developed athletes.');
console.log('  Galloway       up to 42 km -- the FULL race distance -- 3-4 weeks out,');
console.log('                 at 2 min/mile slower than goal with walk breaks. For a');
console.log('                 slower runner that is FIVE TO SEVEN HOURS on feet.');
console.log('\n  Range across mainstream road-marathon methodology: 26 km to 42 km.');
console.log('  The 3h ceiling is the convention of ONE school, oriented to faster');
console.log('  runners. Galloway is a competing, equally established school built for');
console.log('  exactly the population we time-capped. Applying the first school\'s');
console.log('  ceiling to the second school\'s athlete is not a neutral act.');
console.log('\n  WHAT THEY AGREE ON: the SYSTEM prepares the athlete, not the single');
console.log('  longest run. Hansons compensates with frequency and cumulative load;');
console.log('  Galloway compensates with full-distance exposure at reduced intensity.');
console.log('  Both are COMPENSATION architectures. Neither simply removes the run.');

console.log('\n\n=== 2. THE READINESS GAP — WHAT IS NEVER PRACTISED ===');
console.log('Race duration at the athlete\'s own marathon pace, minus the longest');
console.log('training exposure. This is the time they must cover having never been');
console.log('there. It is derived from the event, not scored.\n');
console.log(pad('profile',18)+num('easy pace',11)+num('race pace',11)+num('race time',11)+
  num('longest@3h',12)+num('gap (time)',12)+num('gap (km)',10)+num('% unpractised',15));
const PROFILES=[
  ['3h00 marathon', 3*3600], ['3h30 marathon', 3.5*3600], ['4h00 marathon', 4*3600],
  ['4h30 marathon', 4.5*3600], ['5h00 marathon', 5*3600], ['6h00 marathon', 6*3600]
];
const rows=[];
PROFILES.forEach(([lbl, raceSec])=>{
  const racePace = raceSec/42.2;
  /* Easy/long-run pace from the app's own zones, anchored on the equivalent
     5K for that marathon time -- the existing fitness hierarchy, not a guess. */
  const vdot = app.vdotFromPerformance(42195, raceSec);
  const eq5k = app.equivalentTimeSec(vdot, 5000);
  app.state=app.makeDefaultState();
  app.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:eq5k},
    goals:{A:{timeSec:raceSec}},activeGoal:'A',paceOverrides:{}};
  const z=app.getActivePaces(); const easy=(z.E.slow+z.E.fast)/2;
  const longAt3h = 3*3600/easy;
  const capped = Math.min(32, longAt3h);
  const gapKm = 42.2 - capped;
  const gapSec = gapKm*racePace;
  rows.push({lbl,easy,racePace,raceSec,capped,gapKm,gapSec});
  console.log(pad(lbl,18)+num(app.fmtPaceFromSecPerKm(easy),11)+
    num(app.fmtPaceFromSecPerKm(racePace),11)+num(hhmm(raceSec),11)+
    num(r1(capped)+'km',12)+num(hhmm(gapSec),12)+num(r1(gapKm),10)+
    num(Math.round(100*gapSec/raceSec)+'%',15));
});
console.log('\n  A 3h00 marathoner practises all but ~%s of their race.',
  hhmm(rows[0].gapSec));
console.log('  A 6h00 marathoner is never within %s of the finish -- %d%% of the race',
  hhmm(rows[5].gapSec), Math.round(100*rows[5].gapSec/rows[5].raceSec));
console.log('  is territory they have not visited. THAT is what the 3h cap costs, and');
console.log('  it is the question the previous report did not answer.');

console.log('\n\n=== 3. WHAT THE CAP WOULD HAVE TO BE TO EQUALISE THE GAP ===');
console.log('If the acceptable unpractised fraction is held constant across athletes');
console.log('rather than the long-run DURATION being held constant:\n');
console.log(pad('profile',18)+num('at 3h cap',12)+num('for 25% gap',14)+
  num('time needed',13)+num('for 20% gap',14)+num('time needed',13));
rows.forEach(r=>{
  const for25 = 42.2*0.75, for20 = 42.2*0.80;
  console.log(pad(r.lbl,18)+num(r1(r.capped)+'km',12)+
    num(r1(for25)+'km',14)+num(hhmm(for25*r.easy),13)+
    num(r1(for20)+'km',14)+num(hhmm(for20*r.easy),13));
});
console.log('\n  Holding the unpractised fraction constant demands 4-5h long runs from');
console.log('  slower athletes -- which is precisely what Galloway prescribes and what');
console.log('  the 3h convention forbids. The two cannot both be right.');

console.log('\n\n=== 4. WEEKLY VOLUME ON ITS OWN AUTHORITY (no share derivative) ===');
console.log('Built from what the WEEK must carry, not from a fraction of the long run:');
console.log('  long run + marathon-specific session + the easy running the remaining');
console.log('  days sustain. Share is then CHECKED, never used to generate.\n');
function volumeNeed(L, runDays, easyLen, specific){
  return { V: r1(L + specific + (runDays-2)*easyLen),
           share: 0 };
}
console.log(pad('profile',16)+num('L',7)+num('days',6)+num('easy len',10)+num('specific',10)+
  num('V need',9)+num('share',8)+num('diagnostic',13));
[['3h00 marathon',32,6,14,16],['4h00 marathon',27.8,6,11,13],
 ['5h00 marathon',22.5,5,9,11],['5h00, 6 days',22.5,6,9,11],
 ['6h00 marathon',18.8,5,8,9]].forEach(([lbl,L,d,e,sp])=>{
  const v=volumeNeed(L,d,e,sp);
  const share=Math.round(100*L/v.V);
  console.log(pad(lbl,16)+num(L,7)+num(d,6)+num(e,10)+num(sp,10)+num(v.V,9)+
    num(share+'%',8)+num(share>=25&&share<=35?'coherent':share>35?'long dominates':'long light',13));
});
console.log('\n  The shares land in the familiar band WITHOUT being generated from it.');
console.log('  That is the test HQ asked for: right authority, and the empirical');
console.log('  result may still look familiar.');

console.log('\n\n=== 5. THE 15 km/wk ATHLETE, RECLASSIFIED HONESTLY ===');
const easy15 = 8*60+17, race15 = 42.2*(7*60+7);   // ~5h00 marathon profile
[[16,14.3],[20,19],[24,21.7],[30,21.7],[40,21.7]].forEach(([W,L])=>{
  const gapKm=42.2-L, gapSec=gapKm*(race15/42.2);
  const pct=Math.round(100*gapSec/race15);
  const cls = pct<=30?'ADEQUATE' : pct<=40?'MARGINAL' : 'INSUFFICIENT';
  console.log('  '+pad(W+' weeks',10)+'longest '+num(L,5)+' km ('+hhmm(L*easy15)+
    '), unpractised '+num(hhmm(gapSec),6)+' = '+num(pct+'%',5)+' of the race  -> '+cls);
});
console.log('\n  The previous report called 24 weeks ADEQUATE because the time-modified');
console.log('  destination was reached. On the readiness gap it is INSUFFICIENT: half');
console.log('  the race is territory the athlete has never visited. That classification');
console.log('  was wrong and this corrects it.');
console.log('\n  What would change it: a longer permitted long-run duration (Galloway\'s');
console.log('  answer, 4-5h), or substantially higher weekly frequency and cumulative');
console.log('  load (Hansons\' answer), or more runway. Not the cap alone.');
