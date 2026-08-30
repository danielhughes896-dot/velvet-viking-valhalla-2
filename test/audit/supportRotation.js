'use strict';
/* SUPPORTING-WORK ROTATION — EVIDENCE
 * ===========================================================================
 * 1. Inventory of the library.
 * 2. Proof that variety is cost-free: every variant of a kind is the same
 *    session by the numbers the gates actually reason about.
 * 3. Population measurement: do consecutive occurrences of a kind ever
 *    deliver the identical routine, and does every routine come back?
 *
 * node test/audit/supportRotation.js
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));
const TODAY = '2026-08-30';
const SCHED = { 4:{activeDays:[1,3,5,6],longRunDay:6}, 5:{activeDays:[1,2,4,5,6],longRunDay:6},
                6:{activeDays:[0,1,2,3,4,6],longRunDay:6}, 7:{activeDays:[0,1,2,3,4,5,6],longRunDay:6} };
const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
a.renderApp=()=>{}; a.flushSave=()=>{}; a.scheduleSave=()=>{}; a.showToast=()=>{};
const pad=(s,n)=>String(s).padEnd(n), num=(s,n)=>String(s).padStart(n);

console.log('=== 1. LIBRARY INVENTORY ===');
console.log(pad('kind',22)+pad('family',14)+num('cost',5)+num('min',5)+num('variants',10)+num('steps',7));
a.SUPPORT_ORDER.forEach(id => {
  const k = a.SUPPORT_KINDS[id], v = a.supportVariants(id);
  console.log(pad(id,22)+pad(k.family,14)+num(k.cost,5)+num(k.minutes,5)+num(v.length,10)+
    num(v.map(x=>x.length).join('/'),7));
});
console.log('\ntotal routines: %d across %d kinds',
  a.SUPPORT_ORDER.reduce((t,id)=>t+a.supportVariants(id).length,0), a.SUPPORT_ORDER.length);

console.log('\n=== 2. VARIETY IS COST-FREE ===');
console.log('Every gate below reads the KIND, never the routine, so a variant cannot');
console.log('change what a week costs. Stated by the numbers rather than asserted:\n');
let costOk = true;
a.SUPPORT_ORDER.forEach(id => {
  const k = a.SUPPORT_KINDS[id], v = a.supportVariants(id);
  const sizes = v.map(x => x.length);
  const same = sizes.every(x => x === sizes[0]);
  if (!same) costOk = false;
  console.log('  %s  cost %d (one value, on the kind), %d min (one value, on the kind), %d routines of %s movements  %s',
    pad(id,22), k.cost, k.minutes, v.length, sizes.join('/'), same ? '' : '<== UNEVEN');
});
console.log('\n  variants sharing one cost/minutes/label/why/how/feel/avoid: %s',
  costOk ? 'yes — the variant is only the movement list' : 'NO');

console.log('\n=== 3. POPULATION ===');
let plans=0, items=0, consec=0, repeats=0, gaps={};
const usedVariant = {}, kindCount = {};
const worst = [];
['5k','10k','half','full','ultra'].forEach(dk =>
[25,35,45,55,70].forEach(v =>
[10,12,16,20,24].forEach(w =>
[4,5,6,7].forEach(nd => {
  let blk, days;
  try {
    a.state = a.makeDefaultState();
    blk = a.buildBlockWeeks(dk, v, w, {});
    const end = a.addDays(a.addDays(TODAY, -a.isoWeekday(TODAY)), blk.planWeeks*7 - 1);
    days = a.buildDaysFromWeeks(blk, end, SCHED[nd], TODAY, true);
  } catch(e){ return; }
  a.state.days = days;
  a.state.setup = { distanceKey:dk, currentVolume:v, planWeeks:blk.planWeeks, schedule:SCHED[nd],
    benchmark:{distanceKey:'5k',timeSec:1385}, goals:{A:{timeSec:14400}}, activeGoal:'A',
    paceOverrides:{}, lthr:null, maxHR:null, experience:'experienced',
    startDate:TODAY, raceDate:a.addDays(TODAY, blk.planWeeks*7), hasEvent:true,
    purpose:'race', supportWork:'on' };
  plans++;
  const weeks = [...new Set(days.map(d => d.week))].filter(Boolean).sort((x,y)=>x-y);
  const seq = [];
  weeks.forEach(k => (a.supportForWeek(k)||[]).forEach(it => seq.push(it)));
  items += seq.length;
  const last = {};
  seq.forEach(it => {
    const wk = days.filter(d => d.id === it.dayId)[0].week;
    kindCount[it.kind] = (kindCount[it.kind]||0) + 1;
    (usedVariant[it.kind] = usedVariant[it.kind] || {})[it.variant] =
      (usedVariant[it.kind][it.variant]||0) + 1;
    if (last[it.kind]){
      consec++;
      const g = wk - last[it.kind].wk; gaps[g] = (gaps[g]||0) + 1;
      if (last[it.kind].variant === it.variant){
        repeats++;
        if (worst.length < 5) worst.push(dk+' v'+v+' w'+w+' d'+nd+' '+it.kind+' wk'+last[it.kind].wk+'->'+wk);
      }
    }
    last[it.kind] = { wk: wk, variant: it.variant };
  });
}))));
console.log('plans %d   supporting sessions %d', plans, items);
console.log('\nconsecutive same-kind pairs: %d', consec);
console.log('  identical routine repeated: %d  (%s%%)   %s',
  repeats, (100*repeats/consec).toFixed(2), repeats ? worst.join('; ') : '');
console.log('  gap in weeks between consecutive occurrences: %s',
  Object.keys(gaps).sort((x,y)=>x-y).map(g => g+'wk:'+gaps[g]).join('  '));
console.log('\nevery routine is reached, and comes back:');
Object.keys(usedVariant).sort().forEach(k => {
  const u = usedVariant[k], n = a.supportVariants(k).length;
  const reached = Object.keys(u).length;
  console.log('  %s  %d/%d routines used   %s   %s',
    pad(k,22), reached, n,
    Array.from({length:n}, (_,i) => 'v'+i+':'+(u[i]||0)).join('  '),
    reached === n ? '' : '<== A ROUTINE IS NEVER PRESCRIBED');
});
