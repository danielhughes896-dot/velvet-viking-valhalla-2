'use strict';
/* SIX-DAY QUALITY GEOMETRY + MEDIUM-LONG PLACEMENT. READ-ONLY.
 * node test/audit/marathonQualityGeometry.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>{const m=Math.round(s/60);return Math.floor(m/60)+'h'+String(m%60).padStart(2,'0');};
function easyPace(raceSec){
  const vdot=app.vdotFromPerformance(42195, raceSec);
  app.state=app.makeDefaultState();
  app.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:app.equivalentTimeSec(vdot,5000)},
    goals:{A:{timeSec:raceSec}},activeGoal:'A',paceOverrides:{}};
  const z=app.getActivePaces(); return (z.E.slow+z.E.fast)/2;
}

/* The candidate week HQ asks about. Written as a calendar, not a session count,
   because the question is whether SEVEN DAYS can hold it -- not whether six
   sessions add up. */
const WEEK=[['Mon','easy'],['Tue','VO2/track'],['Wed','easy'],['Thu','tempo/threshold'],
            ['Fri','rest'],['Sat','long'],['Sun','easy']];
const DEMANDING={'VO2/track':1,'tempo/threshold':1,'long':1};

console.log('=== 1. THE CANDIDATE SIX-DAY WEEK, AS A CALENDAR ===\n');
console.log(pad('day',6)+pad('session',18)+'gap since previous demanding day');
let last=null;
WEEK.concat(WEEK.slice(0,3)).forEach((d,i)=>{
  if(i>=7) return;
  let g='';
  if(DEMANDING[d[1]]){ g = last===null ? '(first)' : (i-last)+' days'; last=i; }
  console.log(pad(d[0],6)+pad(d[1],18)+g);
});
console.log(pad('(Mon)',6)+pad('easy',18)+'long -> next VO2 wraps at 3 days');
console.log('\n  Gaps: VO2 -> tempo 2 days, tempo -> long 2 days, long -> VO2 3 days.');
console.log('  Every demanding session has at least 48h before the next, one full');
console.log('  non-running day survives, and the long run is preceded by rest. The');
console.log('  geometry EXISTS. Whether it is affordable is a different question, and');
console.log('  section 2 is where it stops being universally affordable.');

console.log('\n\n=== 2. THE SAME WEEK PRICED IN TIME, PER ATHLETE ===');
console.log('Identical structure, identical kilometres. Only the athlete changes.\n');
console.log(pad('marathon',10)+num('easy pace',11)+num('long 30km',11)+num('3x easy 10km',14)+
  num('quality est',12)+num('week total',12)+num('long share',11));
[[3*3600,'3h00'],[4*3600,'4h00'],[5*3600,'5h00'],[6*3600,'6h00']].forEach(([rs,lbl])=>{
  const p=easyPace(rs);
  const long=30*p, easy=3*10*p, qual=2*55*60;  // two sessions, ~55 min door to door
  const tot=long+easy+qual;
  console.log(pad(lbl,10)+num(Math.floor(p/60)+':'+String(Math.round(p%60)).padStart(2,'0'),11)+
    num(hhmm(long),11)+num(hhmm(easy),14)+num(hhmm(qual),12)+num(hhmm(tot),12)+
    num(Math.round(100*long/tot)+'%',11));
});
console.log('\n  The 3h00 athlete spends about 6h30 on this week. The 6h00 athlete spends');
console.log('  over 9h on the identical prescription, and nearly half of it is one run.');
console.log('  Two conventional quality sessions are not a fixed cost -- they are a cost');
console.log('  paid on top of a long run that has already become the dominant stressor of');
console.log('  the week. That is the reason the answer to "can a six-day athlete hold');
console.log('  Tempo + VO2 + Long" is not a single yes or no.');

console.log('\n\n=== 3. WHAT THE LONG RUN DOES TO THE QUALITY BUDGET ===');
console.log('COACH_LOAD_FACTOR prices sessions the app already generates.\n');
const CLF=app.COACH_LOAD_FACTOR||{};
console.log(pad('session',26)+num('factor',9)+'   ');
['easy','long','tempo','threshold','interval','repetition'].forEach(k=>{
  if(CLF[k]!=null) console.log(pad(k,26)+num(CLF[k],9));
});
console.log('\n  A long run prices at 1.1 -- barely above easy -- whatever it contains.');
console.log('  The merged quality-budget correction already fixes the SPECIFIC case:');
console.log('  longRunCarriesSpecificWork() spends a quality slot when the long run');
console.log('  carries goal-pace work. What it does not yet price is DURATION. A 30 km');
console.log('  aerobic long run costs a 3h00 athlete 2h13 and a 6h00 athlete 4h26, and');
console.log('  the load model charges both of them 1.1 x 30. SYSTEM 10 asks that long-run');
console.log('  cost modify quality frequency; today it cannot, because the cost is not');
console.log('  measured in the units that differ between those two athletes.');

console.log('\n\n=== 4. WHERE DELIBERATE MEDIUM-LONG RUNNING BELONGS ===\n');
const rows=[
 ['Base','no','the athlete is establishing ordinary weekly running; a second long session competes with the only long run they have'],
 ['early Build','sometimes','only where six-day distribution has already saturated and the alternative is oversized easy runs'],
 ['late Build','yes','the strongest case: weekly volume is near destination, the long run is near its cap, and a second sustained aerobic session is the remaining lever'],
 ['Peak','no, except between exposures','the two peak long runs already own the durability budget; a medium-long in the absorption week defeats the absorption'],
 ['Taper','no','dose is falling by design']];
console.log(pad('phase',12)+pad('medium-long',14)+'reasoning');
rows.forEach(r=>console.log(pad(r[0],12)+pad(r[1],14)+r[2]));
console.log('\n  So the medium-long run is a LATE BUILD instrument, and its trigger is the');
console.log('  one measured in the six-day boundary audit: six days authorised, volume');
console.log('  destination reached, and easy-run duration climbing through the 75-90');
console.log('  minute region anyway. That is a narrow, testable condition rather than a');
console.log('  general licence, which is what makes it a prescription and not a relabel.');

console.log('\n\n=== 5. DOES IT ACTUALLY IMPROVE SIX-DAY GEOMETRY? ===');
console.log('5h00 athlete. Six days = long + 1 quality (8 km) + 4 supporting runs.');
console.log('Long run held at 27.5 km. Weekly volume walked upward.\n');
const p5=easyPace(5*3600), L=27.5, Q=8;
console.log(pad('week V',9)+num('4 easy each',13)+num('time',8)+'   |'+
  num('3 easy at 10.5',16)+num('=> ML must be',15)+num('ML time',10));
[77.5,80,85,90,95].forEach(V=>{
  const rem=V-L-Q, four=rem/4, ml=rem-3*10.5;
  console.log(pad(V,9)+num(r1(four)+' km',13)+num(hhmm(four*p5),8)+'   |'+
    num('10.5 km / '+hhmm(10.5*p5),16)+num(r1(ml)+' km',15)+num(hhmm(ml*p5),10));
});
console.log('\n  THIS DOES NOT SAY WHAT I EXPECTED IT TO SAY, and the result stands as');
console.log('  measured. Naming one session medium-long does NOT rescue an incoherent');
console.log('  volume target. At 90 km the four supporting runs are 1h49 each; converting');
console.log('  to three ordinary runs plus a medium-long requires that medium-long to be');
console.log('  23 km -- 3h04, within touching distance of the long run itself. The lever');
console.log('  moves the pressure, it does not remove it, because the leftover kilometres');
console.log('  are conserved.');
console.log('');
console.log('  So the medium-long run must be justified as a STIMULUS, not as relief for');
console.log('  a volume target six days cannot carry. Where it earns its place is the');
console.log('  narrow band around 80-85 km: the supporting runs are 1h26-1h37, already in');
console.log('  the pressure region, and a 13-18 km / 1h44-2h24 named session is a real');
console.log('  Pfitzinger-style medium-long rather than a disguised second long run.');
console.log('  Above that band the correct answer is lever A -- the destination is wrong --');
console.log('  and the medium-long must not be used to conceal it. That is the same');
console.log('  prohibition as the relabelling one, arriving from the other direction.');
