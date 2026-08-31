'use strict';
/* MARATHON PEAK VIABILITY — CONTRACT AUDIT
 * ===========================================================================
 * Establishes what the viability contract actually says before anything is
 * changed, then measures the population against it.
 *
 * node test/audit/marathonViability.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY = '2026-08-30';
const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
const r1 = x => Math.round(x*10)/10, r2 = x => Math.round(x*100)/100;
const pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);

console.log('=== 1. IS THE VIABILITY CONTRACT INTERNALLY CONSISTENT? ===');
console.log('minViableStartKm() is the algebraic inverse of the builder\'s own');
console.log('longTarget = min(longCapKm, volume x LONG_FRACTION[emphasis]).');
console.log('If the contract is coherent, an athlete admitted AT the floor must');
console.log('reach EXACTLY MIN_PEAK_LONG_KM. Measured through the real builder:\n');
console.log(pad('dist',7)+num('weeks',6)+num('minStart',10)+num('peakVol',9)+
  num('peakLong',10)+num('MIN_PEAK',10)+'  verdict');
let coherent = true;
['5k','10k','half','full','ultra'].forEach(d => {
  [12,14,16,20,24].forEach(w => {
    const start = a.minViableStartKm(d, w);
    if (start == null) return;
    a.state = a.makeDefaultState();
    const blk = a.buildBlockWeeks(d, start, w, {});
    const peakVol = Math.max.apply(null, blk.weeks.map(x => x.volume));
    const p = a.DISTANCE_PROFILES[d];
    const peakLong = Math.min(p.longCapKm, peakVol * a.LONG_FRACTION[p.emphasis]);
    const req = a.MIN_PEAK_LONG_KM[d];
    const ok = peakLong + 0.06 >= req;
    if (!ok) coherent = false;
    console.log(pad(d,7)+num(w,6)+num(start,10)+num(r1(peakVol),9)+
      num(r2(peakLong),10)+num(req,10)+'  '+(ok ? 'reaches it' : '<== FAILS ITS OWN FLOOR'));
  });
});
console.log('\n  the contract is %s\n',
  coherent ? 'SELF-CONSISTENT: every admitted athlete reaches the declared floor'
           : 'INCONSISTENT: the floor is unreachable from its own admission volume');

console.log('=== 2. IS athletePathway() ON THE PRODUCTION PATH? ===');
const SRC = require('fs').readFileSync(
  path.join(__dirname,'..','..','protected','velvet-viking-valhalla.html'),'utf8');
const script = SRC;
['athletePathway','raceProgrammeViability','minViableStartKm','MIN_PEAK_LONG_KM'].forEach(fn => {
  const re = new RegExp('(^|[^\\w.])'+fn+'\\s*\\(', 'g');
  const lines = [];
  script.split('\n').forEach((L,i) => {
    if (new RegExp('(^|[^\\w.])'+fn+'\\b').test(L) && !/^\s*(\*|\/\*|\/\/)/.test(L))
      lines.push((i+1)+': '+L.trim().slice(0,96));
  });
  console.log('\n  ' + fn + ' — ' + lines.length + ' non-comment mention(s) in the runtime:');
  lines.forEach(l => console.log('      ' + l));
});
const gp = script.indexOf('async function handleGeneratePlan(');
const gpEnd = script.indexOf('\n}\n', gp);
const body = script.slice(gp, gpEnd);
console.log('\n  handleGeneratePlan() calls athletePathway: %s',
  /athletePathway\s*\(/.test(body) ? 'YES' : 'NO');
console.log('  handleGeneratePlan() calls raceProgrammeViability: %s',
  /raceProgrammeViability\s*\(/.test(body) ? 'YES' : 'NO');
console.log('  handleGeneratePlan() calls buildBlockWeeks directly: %s',
  /buildBlockWeeks\s*\(/.test(body) ? 'YES' : 'NO');

console.log('\n=== 3. WHAT THE PATHWAY WOULD DO WITH THE EXAMPLE ATHLETE ===');
[[51,16],[51,12],[45,16],[40,20],[35,24],[30,40],[60,16]].forEach(([v,w]) => {
  const p = a.athletePathway('full', v, w);
  console.log('  %s km / %s wk -> %s%s', num(v,3), num(w,2), pad(p.route,38),
    p.route === 'on_ramp_then_race'
      ? 'on-ramp ' + p.onRampWeeks + 'wk to ' + p.onRampToKm + ' km, then ' + p.raceBlockWeeks + 'wk race block'
      : p.route === 'race_programme' ? 'straight to the race block'
      : p.route === 'insufficient_time' ? ('reason: ' + p.reason)
      : ('foundation ' + p.foundationWeeks + 'wk + on-ramp ' + p.onRampWeeks + 'wk + race ' + p.raceBlockWeeks + 'wk'));
});

/* ---------------- 4. THE POPULATION, BOTH WAYS ---------------- */
console.log('\n\n=== 4. MARATHON POPULATION: WHAT IS BUILT vs WHAT THE PATHWAY WOULD BUILD ===');
const SCHED = { 4:{activeDays:[1,3,5,6],longRunDay:6}, 5:{activeDays:[1,2,4,5,6],longRunDay:6},
                6:{activeDays:[0,1,2,3,4,6],longRunDay:6}, 7:{activeDays:[0,1,2,3,4,5,6],longRunDay:6} };
/* The long run the athlete actually receives, ignoring a partial first
   calendar week (which can hold a single day). */
function deliveredPeakLong(volume, weeks, nd){
  a.state = a.makeDefaultState();
  const blk = a.buildBlockWeeks('full', volume, weeks, {});
  const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks*7 - 1);
  const ds = a.buildDaysFromWeeks(blk, end, SCHED[nd], TODAY, true);
  const wks = [...new Set(ds.map(d => d.week))].filter(Boolean);
  /* The weekly long-run ALLOCATION, which is what MIN_PEAK_LONG_KM is defined
     on -- see its own comment on the ultra 0.62/0.38 back-to-back split. Only
     ultra carries profile.backToBack, so for the marathon this is identical to
     the single long day. */
  let best = 0, seg = 0;
  wks.forEach(k => {
    const wd = ds.filter(d => d.week === k);
    if (wd.length < 7) return;
    const longs = wd.filter(d => d.type === 'long');
    const alloc = longs.reduce((t, d) => t + (d.km || 0), 0);
    if (alloc > best){ best = alloc;
      seg = longs.reduce((t, d) => t +
        ((d.prescription && d.prescription.params && d.prescription.params.finishKm) || 0), 0); }
  });
  return { long: best, goalSeg: seg };
}
const VOLS = [25,30,35,40,45,50,55,60,65,70,75,80,90];
const WKS = [12,14,16,18,20,24];
const DAYS = [4,5,6,7];
const rows = [];
VOLS.forEach(v => WKS.forEach(w => DAYS.forEach(nd => {
  let direct;
  try { direct = deliveredPeakLong(v, w, nd); } catch(e){ return; }
  const p = a.athletePathway('full', v, w);
  let routed = null;
  if (p.route === 'race_programme') routed = direct.long;
  else if (p.raceBlockWeeks && p.raceBlockWeeks > 0){
    const startKm = p.route === 'on_ramp_then_race' ? p.onRampToKm : p.onRampToKm;
    try { routed = deliveredPeakLong(startKm, p.raceBlockWeeks, nd).long; } catch(e){ routed = null; }
  }
  rows.push({ v, w, nd, direct: direct.long, goalSeg: direct.goalSeg,
              route: p.route, routed: routed });
})));
console.log('marathon plans: %d', rows.length);

function passTable(label, get){
  const T = [30, 28, 27.6, 25, 22];
  console.log('\n-- %s --', label);
  console.log(pad('threshold',12) + num('meets it', 12) + num('%', 8) + '   lowest start volume that meets it');
  T.forEach(t => {
    const ok = rows.filter(r => get(r) != null && get(r) + 0.06 >= t);
    console.log(pad(t + ' km', 12) + num(ok.length + '/' + rows.length, 12) +
      num(Math.round(100*ok.length/rows.length) + '%', 8) +
      '   ' + (ok.length ? Math.min.apply(null, ok.map(r => r.v)) + ' km/wk' : '—'));
  });
}
passTable('AS BUILT TODAY (handleGeneratePlan -> buildBlockWeeks, pathway skipped)', r => r.direct);
passTable('AS THE PATHWAY WOULD BUILD IT (on-ramp first, then the race block)', r => r.routed);

console.log('\n-- the tail: delivered peak long by start volume (as built today) --');
console.log(pad('start',8)+num('n',5)+num('min',7)+num('median',9)+num('max',7)+
  num('>=30',7)+num('>=28',7)+num('>=27.6',9)+'  pathway route');
const byVol = {};
rows.forEach(r => (byVol[r.v] = byVol[r.v] || []).push(r));
Object.keys(byVol).sort((x,y)=>x-y).forEach(v => {
  const g = byVol[v], s = g.map(r => r.direct).sort((x,y)=>x-y);
  const routes = [...new Set(g.map(r => r.route))];
  console.log(pad(v,8)+num(g.length,5)+num(r1(s[0]),7)+num(r1(s[Math.floor(s.length/2)]),9)+
    num(r1(s[s.length-1]),7)+
    num(g.filter(r=>r.direct+0.06>=30).length,7)+
    num(g.filter(r=>r.direct+0.06>=28).length,7)+
    num(g.filter(r=>r.direct+0.06>=27.6).length,9)+
    '  '+routes.join('/'));
});
console.log('\n-- and how the pathway classifies each start volume --');
const byRoute = {};
rows.forEach(r => (byRoute[r.route] = byRoute[r.route] || []).push(r));
Object.keys(byRoute).sort().forEach(k => {
  const g = byRoute[k];
  console.log('  %s %s plans, start volumes %s-%s km/wk, delivered long %s-%s km',
    pad(k, 40), num(g.length, 4),
    Math.min.apply(null, g.map(r=>r.v)), Math.max.apply(null, g.map(r=>r.v)),
    r1(Math.min.apply(null, g.map(r=>r.direct))), r1(Math.max.apply(null, g.map(r=>r.direct))));
});
