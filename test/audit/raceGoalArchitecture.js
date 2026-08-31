'use strict';
/* RACE GOAL -> MARATHON: BACKWARD-DESIGNED TRAJECTORY MODEL
 * READ-ONLY. Simulates the proposed architecture beside the current one.
 * Wired into nothing. node test/audit/raceGoalArchitecture.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const app=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const hhmm=s=>Math.floor(s/3600)+'h'+String(Math.round((s%3600)/60)).padStart(2,'0');
const VOLS=[10,20,30,40,50,60,80,100], WKS=[12,14,16,20,24,52];

/* ---- POLICY PARAMETERS, ALL LABELLED, NONE IMPLEMENTED ---- */
const TARGET_LONG_KM      = 30;     // HQ: the marathon progression destination
const TIME_ON_FEET_CEIL   = 3*3600; // evidence: universal 3h ceiling
const TAPER_WEEKS         = 3;      // existing taper
const PEAK_HOLD_WEEKS     = 2;      // HQ: 2-3 weeks of genuine specific peak
/* Long-run share: a DIAGNOSTIC BAND, not the generator of the long run.
   Wider at low volume because that is how low-volume marathon plans are
   actually written; tightened above 65km/wk per Daniels. */
const shareCeiling = v => v <= 65 ? 0.40 : 0.30;
/* Progression character: the engine's own measured median, and the evidence
   backstop. Neither is a target; the first is normal, the second is the wall. */
const RATE_NORMAL = 0.06, RATE_PRESSED = 0.10, RATE_BACKSTOP = 0.14;

function longRunPaceSec(benchSec5k){
  app.state=app.makeDefaultState();
  app.state.setup={distanceKey:'full',benchmark:{distanceKey:'5k',timeSec:benchSec5k},
    goals:{A:{timeSec:4*3600}},activeGoal:'A',paceOverrides:{}};
  const z=app.getActivePaces(); return (z.E.slow+z.E.fast)/2;
}
/* A slower athlete at lower volume, faster at higher -- a modelling assumption,
   stated, so the time-on-feet ceiling is exercised where it really bites. */
const benchFor = v => v<=15 ? 33*60 : v<=25 ? 30*60 : v<=35 ? 27*60
                    : v<=45 ? 25*60 : v<=60 ? 23*60 : v<=80 ? 21*60 : 19*60;

function design(V0, W){
  const pace = longRunPaceSec(benchFor(V0));
  /* 1. THE EVENT SETS THE DESTINATION, THE ATHLETE'S PACE MODIFIES IT. */
  const timeCapKm = r1(TIME_ON_FEET_CEIL/pace);
  const Lstar = Math.min(TARGET_LONG_KM, timeCapKm);
  const capped = timeCapKm < TARGET_LONG_KM;
  /* 2. SUPPORTING VOLUME comes from the share BAND, not a fixed fraction. */
  let Vstar = Lstar/shareCeiling(60);
  if (Vstar > 65) Vstar = Math.max(Vstar, Lstar/shareCeiling(100));
  Vstar = r1(Vstar);
  /* 3. THE RUNWAY. */
  const raceWeek=1;
  const progressWeeks = Math.max(1, W - TAPER_WEEKS - PEAK_HOLD_WEEKS - raceWeek);
  const effective = Math.max(1, Math.round(progressWeeks*3/4));   // cutback every 4th
  /* 4. THE PRESSURE THE RUNWAY DEMANDS. */
  const required = V0 >= Vstar ? 0 : Math.pow(Vstar/V0, 1/effective) - 1;
  const cls = V0>=Vstar ? 'READY'
            : required<=RATE_NORMAL  ? 'COMFORTABLE'
            : required<=RATE_PRESSED ? 'COMPRESSED'
            : required<=RATE_BACKSTOP? 'HIGHLY COMPRESSED'
            : 'BEYOND BACKSTOP';
  /* 5. WHAT IS ACTUALLY DELIVERABLE: the rate is capped at the backstop. */
  const rate = Math.min(required, RATE_BACKSTOP);
  const Vpeak = r1(Math.min(Vstar, V0*Math.pow(1+rate, effective)));
  const Lpeak = r1(Math.min(Lstar, Vpeak*shareCeiling(Vpeak)));
  return { pace, timeCapKm, Lstar, capped, Vstar, progressWeeks, effective,
           required:Math.round(required*1000)/10, cls, Vpeak, Lpeak,
           tof:Lpeak*pace, shortfall:r1(Math.max(0,Lstar-Lpeak)),
           share: Vpeak? Math.round(100*Lpeak/Vpeak):0 };
}

console.log('=== RACE GOAL -> MARATHON, BACKWARD-DESIGNED ===');
console.log('Destination is the EVENT (%d km long run), modified only by the athlete\'s', TARGET_LONG_KM);
console.log('own time on feet (3h ceiling). It is never scaled by starting volume.');
console.log('Rate is capped at the evidence backstop; the residue is reported, not hidden.\n');
console.log(pad('start',6)+pad('wks',5)+pad('classification',20)+num('req%/wk',9)+
  num('peak km',9)+num('peak long',11)+num('share',7)+num('time',7)+
  num('target',8)+num('short',7));
const rows=[];
VOLS.forEach(V0=>{ WKS.forEach(W=>{
  const d=design(V0,W); rows.push({V0,W,d});
  console.log(pad(V0,6)+pad(W,5)+pad(d.cls,20)+num(d.required+'%',9)+
    num(d.Vpeak,9)+num(d.Lpeak,11)+num(d.share+'%',7)+num(hhmm(d.tof),7)+
    num(d.Lstar+(d.capped?'*':''),8)+num(d.shortfall||'-',7));
}); });
console.log('\n  * the athlete\'s 3h time-on-feet ceiling set the target below %d km', TARGET_LONG_KM);

console.log('\n\n=== THE CANONICAL STRESS TEST: 10 km/wk + 14 WEEKS ===');
const s=design(10,14);
console.log('  athlete easy pace          %s /km  (33:00 5K assumed)', app.fmtPaceFromSecPerKm(s.pace));
console.log('  3h time-on-feet ceiling    %s km  -> destination %s km%s',
  s.timeCapKm, s.Lstar, s.capped?' (time-capped, below 30)':'');
console.log('  supporting volume needed   %s km/wk', s.Vstar);
console.log('  runway                     %d weeks = %d progression + %d peak + %d taper + 1 race',
  14, s.progressWeeks, PEAK_HOLD_WEEKS, TAPER_WEEKS);
console.log('  rate the runway demands    %s%% per progressing week', s.required);
console.log('  classification             %s', s.cls);
console.log('  rate actually permitted    %s%% (evidence backstop)', RATE_BACKSTOP*100);
console.log('  delivered peak volume      %s km/wk', s.Vpeak);
console.log('  delivered peak long run    %s km  (%s on feet, %d%% of the week)',
  s.Lpeak, hhmm(s.tof), s.share);
console.log('  remaining compromise       %s km short of the %s km destination', s.shortfall, s.Lstar);
console.log('\n  TODAY the same athlete receives a 6 km peak long run off an 18 km week.');
console.log('  The proposed architecture nearly doubles the long run and states the gap.');

console.log('\n\n=== AT LOW VOLUME A PERCENTAGE BACKSTOP IS THE WRONG INSTRUMENT ===');
console.log('Nielsen\'s cohort was novice runners but the metric was PERCENTAGE. Applied');
console.log('to a 10 km/wk base, +14%% is +1.4 km/wk -- a smaller absolute step than any');
console.log('beginner programme uses. An absolute floor alongside the percentage is the');
console.log('obvious candidate; the value of that floor is an HQ decision.\n');
console.log('  '+pad('start',7)+pad('rule',34)+num('8 progression wks ->',22)+num('long run',10));
[[0.14,0,'14%/wk only'],[0.14,2,'max(14%/wk, +2 km/wk)'],[0.14,3,'max(14%/wk, +3 km/wk)'],
 [0.14,4,'max(14%/wk, +4 km/wk)']].forEach(function(x){
  var r=x[0], abs=x[1], lbl=x[2];
  [10,20].forEach(function(V0){
    var v=V0; for (var i=0;i<8;i++) v = v + Math.max(v*r, abs);
    var d=design(V0,14);
    var L=Math.min(d.Lstar, v*shareCeiling(v));
    console.log('  '+pad(V0,7)+pad(lbl,34)+num(r1(v)+' km/wk',22)+num(r1(L)+' km',10));
  });
});

console.log('\n\n=== EXEMPLAR TRAJECTORY: 10 km/wk + 14 WEEKS ===');
console.log('Shown with max(14%/wk, +3 km/wk) so the shape is visible; the absolute');
console.log('floor is a candidate, not an approved value.\n');
console.log('  '+pad('wk',4)+pad('phase',11)+num('week km',9)+num('long km',9)+num('share',7)+num('time',7));
(function(){
  var d=design(10,14), line=10, out=[];
  for (var w=1; w<=14; w++){
    var phase = w===14 ? 'Race' : w>=11 ? 'Taper' : w>=9 ? 'Peak' : (w<=3 ? 'Base' : 'Build');
    var cut = (phase==='Base'||phase==='Build') && w%4===0;
    if (phase==='Base'||phase==='Build'){ if(!cut) line = line + Math.max(line*0.14, 3); }
    var shown = phase==='Race' ? r1(line*0.35)
              : phase==='Taper' ? r1(line*(w===11?0.75:w===12?0.6:0.45))
              : cut ? r1(line*0.78) : r1(line);
    var L = phase==='Race' ? 0 : r1(Math.min(d.Lstar, shown*shareCeiling(shown)));
    out.push('  '+pad(w,4)+pad(phase+(cut?' (cut)':''),11)+num(shown,9)+num(L,9)+
      num(shown?Math.round(100*L/shown)+'%':'-',7)+num(L?hhmm(L*d.pace):'-',7));
  }
  console.log(out.join('\n'));
  console.log('\n  peak long run %s km against a time-capped destination of %s km.',
    r1(Math.min(d.Lstar, line*shareCeiling(line))), d.Lstar);
})();
