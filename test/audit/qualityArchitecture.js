'use strict';
/* RACE-DISTANCE QUALITY ARCHITECTURE — READ-ONLY AUDIT
 * ===========================================================================
 * Holds the athlete constant and varies the race distance, then measures what
 * the engine actually prescribes. Stimulus is counted with the product's own
 * load methodology (COACH_LOAD_FACTOR / executionProfileOf), never by label,
 * so a "LONG RUN" carrying goal pace is priced as what it is.
 *
 * node test/audit/qualityArchitecture.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY = '2026-08-30';
const r1=x=>Math.round(x*10)/10, pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);
const DISTANCES = ['5k','10k','half','full'];
const SCHEDULES = {
  3: { activeDays:[1,3,6], longRunDay:6 },
  4: { activeDays:[1,3,5,6], longRunDay:6 },
  5: { activeDays:[1,2,4,5,6], longRunDay:6 },
  6: { activeDays:[0,1,2,3,4,6], longRunDay:6 },
  7: { activeDays:[0,1,2,3,4,5,6], longRunDay:6 }
};
/* Volumes chosen so every distance is comfortably ABOVE its own admission
   volume -- the athlete is capable at each distance, so distance is the
   variable and viability is not. */
const VOL = { '5k':45, '10k':50, 'half':55, 'full':70 };

const QUALITY_TYPES = ['tempo','threshold','interval','repetition','checkpoint','calibration'];
const VO2_TYPES = ['interval','repetition'];
const THRESH_TYPES = ['tempo','threshold'];

function build(dist, days, weeks, earned){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
  a.state = a.makeDefaultState();
  const sch = SCHEDULES[days];
  const realModel = a.athleteResponseModel, realBlock = a.blockEffectiveness;
  if (earned){
    /* THE PERMISSION, STUBBED AT THE TWO READINGS IT ITSELF CONSULTS -- an
       athlete whose response is established, whose block is ADAPTING and whose
       measured recovery fits the spacing. Nothing about the DISTANCE is
       stubbed, which is the point: if a second standalone quality session
       appears for 5K it is the engine's own decision. */
    a.athleteResponseModel = () => ({ families: {
      threshold:{ confidence:'established', recovery:{ typicalHoursToNormal:24 } },
      interval: { confidence:'established', recovery:{ typicalHoursToNormal:24 } } } });
    a.blockEffectiveness = () => ({ state:'ADAPTING' });
  }
  let blk, ds;
  try {
    blk = a.buildBlockWeeks(dist, VOL[dist], weeks, {});
    const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks*7 - 1);
    ds = a.buildDaysFromWeeks(blk, end, sch, TODAY, true);
  } finally { a.athleteResponseModel = realModel; a.blockEffectiveness = realBlock; }
  a.state.days = ds;
  a.state.setup = { distanceKey:dist, currentVolume:VOL[dist], planWeeks:blk.planWeeks, schedule:sch,
    benchmark:{distanceKey:'5k',timeSec:1385}, goals:{A:{timeSec:14400}}, activeGoal:'A',
    paceOverrides:{}, lthr:null, maxHR:null, experience:'experienced',
    startDate:TODAY, raceDate:a.addDays(TODAY, blk.planWeeks*7), hasEvent:true, purpose:'race' };
  return { a, blk, days: ds };
}

/* Load, priced by the product's own table, with the archetype override where
   one exists -- so a goal-pace long run is not simply "1.1 because it is a
   long run" if the engine says otherwise. */
function dayLoad(a, dd){
  if (!dd || dd.type === 'rest' || !(dd.km > 0)) return 0;
  const ex = a.executionProfileOf(dd);
  return dd.km * ((ex && ex.load != null) ? ex.load : a.coachLoadFactor(dd.type));
}
function phaseOf(blk, w){
  const b = blk.weeks.filter(x => x.week === w)[0];
  return b ? (b.phase || (b.isRace ? 'Race' : '?')) : '?';
}
function measure(a, blk, days, phases){
  const weeks = [...new Set(days.map(d => d.week))].filter(Boolean).sort((x,y)=>x-y)
    .filter(w => days.filter(d => d.week === w).length >= 7)
    .filter(w => !phases || phases.indexOf(phaseOf(blk, w)) !== -1);
  if (!weeks.length) return null;
  let q=0, vo2=0, thr=0, easyKm=0, totKm=0, qKm=0, longKm=0, goalSegKm=0, longGoal=0,
      longs=0, runDays=0, totLoad=0, qLoad=0, longLoad=0;
  const types = {}, longTypes = {};
  weeks.forEach(w => {
    const wd = days.filter(d => d.week === w);
    wd.forEach(d => {
      const L = dayLoad(a, d);
      totLoad += L; totKm += (d.km||0);
      if ((d.km||0) > 0) runDays++;
      if (QUALITY_TYPES.indexOf(d.type) !== -1){
        q++; qKm += d.km||0; qLoad += L;
        types[d.type] = (types[d.type]||0)+1;
        if (VO2_TYPES.indexOf(d.type) !== -1) vo2 += d.km||0;
        if (THRESH_TYPES.indexOf(d.type) !== -1) thr += d.km||0;
      } else if (d.type === 'easy') easyKm += d.km||0;
      else if (d.type === 'long'){
        longs++; longKm += d.km||0; longLoad += L;
        const p = d.prescription||{};
        longTypes[p.archetype||'long'] = (longTypes[p.archetype||'long']||0)+1;
        const seg = (p.params && p.params.finishKm) || 0;
        if (seg > 0){ goalSegKm += seg; longGoal++; }
      }
    });
  });
  const n = weeks.length;
  return { weeks:n,
    qualityPerWeek: r1(q/n), runDaysPerWeek: r1(runDays/n),
    kmPerWeek: r1(totKm/n),
    easyPct: Math.round(100*easyKm/totKm),
    longPct: Math.round(100*longKm/totKm),
    qualityPct: Math.round(100*qKm/totKm),
    vo2Pct: Math.round(100*vo2/totKm), threshPct: Math.round(100*thr/totKm),
    qualityLoadPct: Math.round(100*qLoad/totLoad),
    longLoadPct: Math.round(100*longLoad/totLoad),
    goalSegPct: longKm ? Math.round(100*goalSegKm/longKm) : 0,
    longsWithGoal: longs ? Math.round(100*longGoal/longs) : 0,
    types: Object.keys(types).sort((x,y)=>types[y]-types[x]).map(k=>k+'×'+types[k]).join(' '),
    longTypes: Object.keys(longTypes).sort().join(' ') };
}

console.log('=== 0. THE DISTANCE-SPECIFIC MACHINERY, AS DECLARED ===');
const a0 = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
console.log(pad('dist',7)+pad('emphasis',12)+num('LONG_FRAC',10)+num('longCap',9)+
  num('volMult',9)+num('TT km',7)+'  interval range        tempo range');
DISTANCES.concat(['ultra']).forEach(d => {
  const p = a0.DISTANCE_PROFILES[d], e = p.emphasis;
  const ir = a0.EMPHASIS_INTERVAL_RANGE[e], tr = a0.EMPHASIS_TEMPO_RANGE[e];
  console.log(pad(d,7)+pad(e,12)+num(a0.LONG_FRACTION[e],10)+num(p.longCapKm,9)+
    num(p.volMult,9)+num(a0.TT_DISTANCE_KM[e],7)+
    '  '+pad(ir.repsLo+'-'+ir.repsHi+' × '+ir.mLo+'-'+ir.mHi+'m',22)+
    tr.minLo+'-'+tr.minHi+'min / '+tr.kmLo+'-'+tr.kmHi+'km');
});
console.log('\n  goal-pace segment in the long run requires emphasis threshold|endurance');
console.log('  -> half and marathon only; 5K and 10K long runs stay aerobic by construction.');
console.log('  5K and 10K SHARE emphasis "speed": every range above is identical for them.');

console.log('\n\n=== 1. ARCHITECTURE BY DISTANCE, HELD CONSTANT ON EVERYTHING ELSE ===');
console.log('Six available days, 16 weeks, whole block. "earned" = the athlete has');
console.log('demonstrated the response the second-quality permission asks for.\n');
[false, true].forEach(earned => {
  console.log('-- second-quality permission: %s --', earned ? 'EARNED' : 'no evidence (the default)');
  console.log(pad('dist',7)+num('q/wk',6)+num('runD',6)+num('km/wk',7)+num('easy%',7)+
    num('long%',7)+num('qual%',7)+num('VO2%',6)+num('thr%',6)+num('qLoad%',8)+
    num('goalSeg%',9)+'  quality types');
  DISTANCES.forEach(d => {
    const { a, blk, days } = build(d, 6, 16, earned);
    const m = measure(a, blk, days, null);
    console.log(pad(d,7)+num(m.qualityPerWeek,6)+num(m.runDaysPerWeek,6)+num(m.kmPerWeek,7)+
      num(m.easyPct+'%',7)+num(m.longPct+'%',7)+num(m.qualityPct+'%',7)+
      num(m.vo2Pct+'%',6)+num(m.threshPct+'%',6)+num(m.qualityLoadPct+'%',8)+
      num(m.goalSegPct+'%',9)+'  '+m.types);
  });
  console.log('');
});

console.log('\n=== 2. BASE -> BUILD -> PEAK, BY DISTANCE (earned permission) ===');
['Base','Build','Peak','Taper'].forEach(ph => {
  console.log('-- %s --', ph);
  console.log(pad('dist',7)+num('q/wk',6)+num('easy%',7)+num('qual%',7)+num('VO2%',6)+
    num('thr%',6)+num('goalSeg%',9)+'  quality types                    long-run archetypes');
  DISTANCES.forEach(d => {
    const { a, blk, days } = build(d, 6, 16, true);
    const m = measure(a, blk, days, [ph]);
    if (!m){ console.log(pad(d,7)+'  (no such phase)'); return; }
    console.log(pad(d,7)+num(m.qualityPerWeek,6)+num(m.easyPct+'%',7)+num(m.qualityPct+'%',7)+
      num(m.vo2Pct+'%',6)+num(m.threshPct+'%',6)+num(m.goalSegPct+'%',9)+
      '  '+pad(m.types,33)+m.longTypes);
  });
  console.log('');
});

console.log('\n=== 3. FREQUENCY INTERACTION, 3 TO 7 DAYS ===');
[false,true].forEach(earned => {
  console.log('-- second-quality permission: %s --', earned ? 'EARNED' : 'no evidence');
  console.log(pad('dist',7)+[3,4,5,6,7].map(d=>num(d+'d',13)).join('')+
    '   (standalone quality per week / run days per week)');
  DISTANCES.forEach(d => {
    const cells = [3,4,5,6,7].map(nd => {
      const { a, blk, days } = build(d, nd, 16, earned);
      const m = measure(a, blk, days, null);
      return num(m.qualityPerWeek + ' / ' + m.runDaysPerWeek, 13);
    });
    console.log(pad(d,7)+cells.join(''));
  });
  console.log('');
});

console.log('\n=== 4. THE GATE, NAMED, FOR EVERY FREQUENCY ===');
console.log('secondQualityExposurePermission() is what stands between one standalone');
console.log('quality session and two. It reads the athlete, never the distance:\n');
const aG = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
aG.state = aG.makeDefaultState();
[1,2,3,4].forEach(gap => {
  const p = aG.secondQualityExposurePermission(gap);
  console.log('  spacing '+gap+'d, no evidence      -> permitted '+p.permitted+'   reason: '+p.reason);
});
const realM = aG.athleteResponseModel, realB = aG.blockEffectiveness;
[['ADAPTING',24],['ADAPTING',96],['RESPONDING',24],['STRAINED',24],['PLATEAU',24]].forEach(([st,h])=>{
  aG.athleteResponseModel = () => ({ families:{ threshold:{confidence:'established',recovery:{typicalHoursToNormal:h}} } });
  aG.blockEffectiveness = () => ({ state:st });
  const p = aG.secondQualityExposurePermission(3);
  console.log('  spacing 3d, '+pad(st+' /'+h+'h',20)+'-> permitted '+p.permitted+'   reason: '+p.reason);
});
aG.athleteResponseModel = realM; aG.blockEffectiveness = realB;
console.log('\n  qualitySlotCeilingForDayCount: ' +
  [1,2,3,4,5,6,7].map(n=>n+'d->'+aG.qualitySlotCeilingForDayCount(n)).join('  '));

console.log('\n\n=== 5. REPRESENTATIVE PROGRAMMES — ACTUAL PEAK WEEKS, 6 DAYS, EARNED ===');
DISTANCES.forEach(d => {
  const { a, blk, days } = build(d, 6, 16, true);
  const peak = blk.weeks.filter(w => w.phase === 'Peak').map(w => w.week);
  const w = peak[peak.length-1];
  const wd = days.filter(x => x.week === w);
  const vol = r1(wd.reduce((t,x)=>t+(x.km||0),0));
  console.log('\n-- %s, Peak week %d, %s km --', d.toUpperCase(), w, vol);
  wd.forEach(x => {
    const L = dayLoad(a, x);
    const dem = QUALITY_TYPES.indexOf(x.type)!==-1 ||
      (x.type==='long' && (x.mpSegment || x.km>=16)) ? '  <== DEMANDING' : '';
    console.log('   '+pad(a.dow(x.date),4)+pad(x.type,11)+num(x.km||0,6)+' km  load '+
      num(r1(L),6)+'  '+pad(x.title||'',34)+dem);
  });
  const hard = wd.filter(x => QUALITY_TYPES.indexOf(x.type)!==-1 ||
    (x.type==='long' && (x.mpSegment || x.km>=16))).length;
  console.log('   demanding sessions this week, by the product\'s own sessionImportance: '+
    wd.filter(x=>{ try { return a.sessionImportance(x)==='KEY'; } catch(e){ return false; } }).length +
    '   (quality types + qualifying long run: '+hard+')');
});

console.log('\n\n=== 6. DOSE SPECIFICITY WITHIN A SESSION TYPE ===');
console.log('Same phase, same week index, same athlete — only the distance differs.\n');
['Build','Peak'].forEach(ph => {
  console.log('-- %s --', ph);
  DISTANCES.forEach(d => {
    const { a, blk, days } = build(d, 6, 16, true);
    const wks = blk.weeks.filter(w => w.phase === ph).map(w=>w.week);
    const wd = days.filter(x => wks.indexOf(x.week)!==-1 &&
      ['interval','repetition','tempo','threshold'].indexOf(x.type)!==-1);
    const shown = {};
    wd.forEach(x => { const p=x.prescription||{}; if(!shown[p.archetype]) shown[p.archetype]=x; });
    console.log('   '+pad(d,7)+Object.keys(shown).sort().map(k =>
      k+' '+JSON.stringify((shown[k].prescription||{}).params||{})).join('   '));
  });
  console.log('');
});

console.log('\n=== 7. IS THE LONG RUN\'S EMBEDDED QUALITY COUNTED WHEN QUALITY IS ALLOCATED? ===');
console.log('The weekly quality allowance is min(qualityDays, qualitySlotCeilingForDayCount(runCap)),');
console.log('gated by secondQualityExposurePermission(). Neither term reads the long run.');
console.log('Measured: marathon Peak weeks that carry BOTH two standalone quality sessions');
console.log('AND a goal-pace long run.\n');
DISTANCES.forEach(d => {
  const { a, blk, days } = build(d, 6, 16, true);
  const weeks = [...new Set(days.map(x=>x.week))].filter(Boolean)
    .filter(w => days.filter(x=>x.week===w).length>=7);
  let stacked = 0, total = 0;
  weeks.forEach(w => {
    const wd = days.filter(x=>x.week===w);
    const q = wd.filter(x=>QUALITY_TYPES.indexOf(x.type)!==-1).length;
    const lg = wd.filter(x=>x.type==='long')[0];
    const seg = lg && lg.prescription && lg.prescription.params
      ? (lg.prescription.params.finishKm||0) : 0;
    total++;
    if (q >= 2 && seg > 0) stacked++;
  });
  console.log('   '+pad(d,7)+num(stacked,3)+' of '+num(total,3)+
    ' weeks carry two standalone quality sessions AND a goal-pace long run');
});
