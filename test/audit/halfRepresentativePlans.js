'use strict';
/* HALF MARATHON — THE PLANS THEMSELVES (READ ONLY).
 * ===========================================================================
 * Aggregate counts say whether a population is well behaved; they do not say
 * whether a programme is coherent coaching. This prints the plans -- week by
 * week and, where asked, day by day -- for the thirteen athletes the Half
 * methodology has to answer for: the low-capacity athlete, the moderate one,
 * the established one, the fast one, the slow one whose time cost binds, the
 * athlete whose goal is close to their fitness and the one whose goal is a
 * long way ahead of it, and both short-runway cases.
 *
 * It asserts nothing and changes nothing, and it asks the calibration gate
 * exactly as handleGeneratePlan() asks it -- never forcing the session -- so a
 * low-capacity athlete is not handed a threshold test the engine refused them.
 *
 *   node test/audit/halfRepresentativePlans.js [A-L|LTHR|all]
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const r1=x=>Math.round(x*10)/10;
const pad=(s,n)=>String(s).padStart(n), padr=(s,n)=>String(s).padEnd(n);
const TODAY='2026-03-02T09:00:00Z';
const DAYSETS={3:[1,3,6],4:[1,3,4,6],5:[0,1,3,4,6],6:[0,1,2,3,4,6]};
function hist(a,o){
  const t=a.todayStr(), m=a.addDays(t,-a.isoWeekday(t)), s=[];
  for(let w=1;w<=16;w++){
    (o.easyDays||[0,2,4]).forEach(d=>s.push({date:a.addDays(m,-7*w+d),completed:true,
      actualKm:o.easyKm,plannedKm:o.easyKm,type:'easy',actual:{km:o.easyKm,rpe:3,pace:400,hr:135},feel:'good'}));
    if(o.longKm) s.push({date:a.addDays(m,-7*w+6),completed:true,actualKm:o.longKm,plannedKm:o.longKm,
      type:'long',actual:{km:o.longKm,rpe:5,pace:420,hr:140},feel:'good'});
    if(o.qKm) s.push({date:a.addDays(m,-7*w+3),completed:true,actualKm:o.qKm,plannedKm:o.qKm,
      type:'tempo',actual:{km:o.qKm,rpe:7,pace:300,hr:168},feel:'good'});
  }
  return s;
}
function build(o){
  const a=loadApp({pinnedDate:TODAY});
  a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};
  a.state=a.makeDefaultState();
  if(o.easyKm) a.state.athlete={sessions:hist(a,o)};
  const vd=a.vdotFromPerformance(5000,(o.tt5kMin||25)*60);
  const z=a.trainingPacesFromVDOT(vd), pace=(z.E.slow+z.E.fast)/2;
  const days=DAYSETS[o.days||5], N=o.weeks||15;
  const s=a.todayStr(), m=a.addDays(s,-a.isoWeekday(s)), rd=a.addDays(m,N*7-1);
  /* THE ELIGIBILITY GATE, ASKED EXACTLY AS handleGeneratePlan() ASKS IT --
     never forced, so the low-capacity athlete is not handed a threshold test
     the engine would have refused them. */
  const elig=a.calibrationEligibility({healthConsent:true, lthr:o.lthr||null,
    lthrSource:o.lthrSource||null, performances:o.performances||[],
    today:a.todayStr(), currentVolume:o.volume});
  const blk=a.buildBlockWeeks('half',o.volume,N,{purpose:'race',availableDays:days.length,
    easyPaceSecPerKm:pace, calibrate:elig.needed,
    calibrateWhenViable:elig.reason==='insufficient_base'});
  const dd=a.buildDaysFromWeeks(blk,rd,{activeDays:days,longRunDay:6},s,true,{easyPaceSecPerKm:pace});
  a.state.setup={distanceKey:'half',currentVolume:o.volume,planWeeks:blk.planWeeks,
    schedule:{activeDays:days,longRunDay:6},raceDate:rd,
    benchmark:{distanceKey:'half',timeSec:o.curHalfSec||null},
    goals:o.goalHalfSec?{A:{label:'A',timeSec:o.goalHalfSec}}:null,activeGoal:o.goalHalfSec?'A':null,
    paceOverrides:{},lthr:o.lthr||null,maxHR:null,lthrSource:o.lthrSource||null};
  a.state.days=dd;
  return {a,blk,dd,rd,elig};
}
function show(label,o){
  const {a,blk,dd,rd,elig}=build(o);
  const byW={}; blk.weeks.forEach(w=>byW[w.week]={w,d:[]}); dd.forEach(x=>byW[x.week]&&byW[x.week].d.push(x));
  const rows=Object.values(byW).sort((x,y)=>x.w.week-y.w.week);
  console.log('');
  console.log('==== '+label+' ====');
  console.log('   '+o.volume+' km/week, '+(o.weeks||15)+' weeks, '+(o.days||5)+' available days'+
    (o.easyKm?', history easy '+o.easyKm+'km'+(o.longKm?' + LR '+o.longKm+'km':'')+(o.qKm?' + threshold':''):', no history')+
    (o.lthr?', LTHR '+o.lthr+' ('+(o.lthrSource==='calibration'?'measured':'estimate')+')':''));
  const qf=blk.qualityFrequency;
  console.log('   calibration: '+(elig.needed?'eligible now':elig.reason));
  console.log('   quality slots: ceiling '+(qf?qf.ceiling:'?')+', prescribed '+(qf?qf.prescribed:'?')+
              '   peak ceiling '+r1(blk.peakVolume)+'   develop '+blk.buildWeeks+'w');
  if(o.goalHalfSec){
    const rp=a.racePacePrescription();
    const f=x=>x==null?'-':Math.floor(x/60)+':'+String(Math.round(x%60)).padStart(2,'0');
    console.log('   goal-pace gate: current '+f(rp.currentSecPerKm)+'/km  goal '+f(rp.goalSecPerKm)+
      '/km  gap '+rp.gap+'  BAND '+rp.band+'  prescribed '+f(rp.prescribedSecPerKm)+'/km');
  }
  console.log('wk  phase        vol    d%  runs   LR  LR%   quality                     Qkm    GP  D-');
  let prev=null;
  rows.forEach(rw=>{
    const w=rw.w, runs=rw.d.filter(x=>x.km>0);
    const vol=r1(runs.reduce((t,x)=>t+x.km,0));
    const lr=r1(runs.filter(x=>x.type==='long').reduce((t,x)=>t+x.km,0));
    const q=runs.filter(x=>x.type!=='long'&&x.type!=='easy'&&x.type!=='race');
    const race=runs.filter(x=>x.type==='race');
    const last=rw.d[rw.d.length-1];
    console.log(pad(w.week,2)+'  '+padr(w.phase,11)+pad(vol,6)+
      pad(prev==null?'-':Math.round((vol/prev-1)*1000)/10,6)+pad(runs.length,5)+pad(lr,6)+
      pad(lr>0?Math.round(lr/vol*100)+'%':'-',5)+'  '+
      padr(q.map(x=>(x.prescription&&x.prescription.archetype||x.type)+':'+r1(x.km)).join(' ')||'-',28)+
      pad(r1(q.reduce((t,x)=>t+x.km,0)),5)+pad(w.hasGoalSegment?r1(w.goalSegKm):'-',6)+
      pad(last?a.daysBetween(last.date,rd):'-',4)+
      (w.isCutback?'  ABSORB':'')+(w.eventTaperApplied?'  TAPER':'')+(race.length?'  RACE '+r1(race[0].km):'')+
      (w.isCalibration?'  CALIBRATION':'')+(w.isCheckpoint?'  CHECKPOINT':''));
    prev=vol;
  });
  if(o.showWeeks) o.showWeeks.forEach(n=>{
    const rw=rows.filter(r=>r.w.week===n)[0]; if(!rw) return;
    console.log('   --- week '+n+' as written ('+rw.w.phase+') ---');
    rw.d.forEach(x=>{ if(!x.km&&x.type==='rest') return;
      console.log('     '+padr(x.date,12)+'D-'+pad(a.daysBetween(x.date,rd),3)+'  '+
        padr(x.type,11)+pad(r1(x.km||0),6)+'km  '+(x.title||'')); });
  });
}
const CASES = {
A:()=>show('A. LOW CAPACITY — 6 km/week, 6 days, no history',{volume:6,days:6,showWeeks:[1,10,14,15]}),
B:()=>show('B. 12 km/week, 5 days, no history',{volume:12,days:5}),
C:()=>show('C. 20 km/week, 5 days, no history',{volume:20,days:5,showWeeks:[1,10,13,14,15]}),
D:()=>show('D. 30 km/week, goal close to fitness',{volume:30,days:5,curHalfSec:5700,goalHalfSec:5640}),
E:()=>show('E. 30 km/week, large goal gap',{volume:30,days:5,curHalfSec:6600,goalHalfSec:5400}),
F:()=>show('F. 30 km/week, demonstrated 16 km long run',{volume:30,days:5,easyKm:6,longKm:16}),
G:()=>show('G. 50 km/week established, 6 days',{volume:50,days:6,easyKm:10,longKm:18,qKm:12,tt5kMin:20,curHalfSec:5400,goalHalfSec:5340,showWeeks:[1,10,13,14,15]}),
H:()=>show('H. 70 km/week established, 6 days',{volume:70,days:6,easyKm:12,longKm:24,qKm:14,tt5kMin:18,curHalfSec:4500,goalHalfSec:4440}),
I:()=>show('I. FAST HALF ATHLETE — 70 km/week, sub-70min',{volume:70,days:6,easyKm:12,longKm:22,qKm:14,tt5kMin:15,curHalfSec:4140,goalHalfSec:4080}),
J:()=>show('J. SLOWER-DURATION HALF — 30 km/week, ~2h20 athlete',{volume:30,days:5,tt5kMin:34,curHalfSec:8400,goalHalfSec:8100}),
K:()=>show('K. SHORT RUNWAY — established athlete, 7 weeks',{volume:50,days:6,weeks:7,easyKm:10,longKm:18,qKm:12,tt5kMin:20}),
L:()=>show('L. SHORT RUNWAY — low capacity, 7 weeks',{volume:8,days:5,weeks:7}),
LTHR:()=>{show('N1. ESTABLISHED, LTHR TYPED AS AN ESTIMATE',{volume:50,days:6,easyKm:10,longKm:18,qKm:12,tt5kMin:20,lthr:168});
          show('N2. THE SAME ATHLETE, LTHR MEASURED',{volume:50,days:6,easyKm:10,longKm:18,qKm:12,tt5kMin:20,lthr:168,lthrSource:'calibration'});}
};
const which=process.argv[2]||'all';
if(which==='all') Object.keys(CASES).forEach(k=>CASES[k]());
else if(CASES[which]) CASES[which]();
