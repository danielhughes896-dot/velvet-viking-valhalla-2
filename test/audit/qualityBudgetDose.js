'use strict';
/* GOAL-SEGMENT DOSE — is every non-zero segment the same thing?
 * Read-only. node test/audit/qualityBudgetDose.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY='2026-08-30';
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const a = loadApp({ pinnedDate: TODAY+'T09:00:00Z' });
a.renderApp=()=>{};a.flushSave=()=>{};a.scheduleSave=()=>{};a.showToast=()=>{};

console.log('=== THE EXISTING CONSTRUCTION RULE FOR A GOAL SEGMENT ===');
console.log('  GOAL_FINISH_MIN_LONG_KM = %s   (no segment at all below this long run)', a.GOAL_FINISH_MIN_LONG_KM);
console.log('  goalSegKm = clamp(longTarget x (0.2 + 0.18 x pos), 3, longTarget x 0.5)');
console.log('  -> the floor of 3 km is the engine\'s own statement that anything smaller');
console.log('     "would produce a stride, not a stimulus".\n');

console.log('=== DOSE ACROSS THE POPULATION ===');
console.log(pad('dist',7)+pad('phase',8)+num('n',5)+num('minSeg',8)+num('medSeg',8)+num('maxSeg',8)+
  num('min%long',10)+num('med%long',10)+num('max%long',10));
['half','full'].forEach(d => {
  const rows = { Base:[], Build:[], Peak:[], Taper:[] };
  [35,45,55,70,90].forEach(v => [12,16,20,24].forEach(w => {
    a.state = a.makeDefaultState();
    let blk; try { blk = a.buildBlockWeeks(d, v, w, {}); } catch(e){ return; }
    blk.weeks.forEach(k => {
      if (!(k.goalSegKm > 0)) return;
      const ph = k.phase || (k.isRace ? 'Race' : null);
      if (!rows[ph]) return;
      rows[ph].push({ seg: k.goalSegKm, pct: 100*k.goalSegKm/k.longTarget });
    });
  }));
  ['Base','Build','Peak','Taper'].forEach(ph => {
    const g = rows[ph];
    if (!g.length){ console.log(pad(d,7)+pad(ph,8)+num(0,5)+'   (no goal segment in this phase)'); return; }
    const s = g.map(x=>x.seg).sort((x,y)=>x-y), p = g.map(x=>x.pct).sort((x,y)=>x-y);
    const md = arr => arr[Math.floor(arr.length/2)];
    console.log(pad(d,7)+pad(ph,8)+num(g.length,5)+num(r1(s[0]),8)+num(r1(md(s)),8)+
      num(r1(s[s.length-1]),8)+num(Math.round(p[0])+'%',10)+num(Math.round(md(p))+'%',10)+
      num(Math.round(p[p.length-1])+'%',10));
  });
});

console.log('\n=== WHAT EACH EXISTING SIGNAL SAYS ABOUT A LONG RUN ===');
console.log('Six candidate authorities, on the same four days:\n');
const S = { activeDays:[0,1,2,3,4,6], longRunDay:6 };
[['full',70,16],['half',55,16],['10k',50,16],['5k',45,16]].forEach(([d,v,w]) => {
  a.state = a.makeDefaultState();
  const blk = a.buildBlockWeeks(d, v, w, {});
  const end = a.addDays(a.addDays(TODAY,-a.isoWeekday(TODAY)), blk.planWeeks*7-1);
  const ds = a.buildDaysFromWeeks(blk, end, S, TODAY, true);
  a.state.days = ds;
  a.state.setup = { distanceKey:d, currentVolume:v, planWeeks:blk.planWeeks, schedule:S,
    benchmark:{distanceKey:'5k',timeSec:1385}, goals:{A:{timeSec:14400}}, activeGoal:'A',
    paceOverrides:{}, lthr:null, maxHR:null, experience:'experienced',
    startDate:TODAY, raceDate:end, hasEvent:true, purpose:'race' };
  ['Base','Build','Peak','Taper'].forEach(ph => {
    const wk = blk.weeks.filter(x => x.phase === ph)[0];
    if (!wk) return;
    const lg = ds.filter(x => x.week === wk.week && x.type==='long')[0];
    if (!lg) return;
    const zt = (function(){ try { return a.structuredZoneTime(lg); } catch(e){ return null; } })();
    const hs = a.horizonStimulus(ds.filter(x => x.week === wk.week));
    const ex = a.executionProfileOf(lg);
    console.log('  '+pad(d,6)+pad(ph,7)+num(lg.km,5)+'km  seg '+num(r1(wk.goalSegKm||0),5)+'km  |  '+
      'sessionImportance '+pad(a.sessionImportance(lg),8)+
      ' mpSegment '+pad(String(!!lg.mpSegment),6)+
      ' isQualityType '+pad(String(a.isQualityType(lg.type)),6)+
      ' qualityExposures '+hs.qualityExposures+
      ' loadFactor '+((ex&&ex.load!=null)?ex.load:a.coachLoadFactor(lg.type))+
      ' mpZoneSec '+(zt ? Math.round(zt.zones.mp) : 'n/a'));
  });
  console.log('');
});
