'use strict';
/* RACE GOAL COVERAGE MAP — WHAT IS ACTUALLY DISTANCE-SPECIFIC TODAY
 * Read-only. One row per item on HQ's per-distance checklist, answered from
 * the code rather than from memory. node test/audit/raceGoalCoverage.js
 */
const path=require('path');
const { loadApp } = require(path.join(__dirname,'..','harness.js'));
const a=loadApp({pinnedDate:'2026-08-30T09:00:00Z'});
const pad=(s,n)=>String(s).padEnd(n);
const D=['5k','10k','half','full'];            // ultra descoped by HQ
const vals=fn=>D.map(fn);
const same=v=>v.every(x=>JSON.stringify(x)===JSON.stringify(v[0]));
const row=(item,fn,note)=>{
  const v=vals(fn); const sp=!same(v);
  console.log(pad(item,34)+pad(sp?'DISTANCE-SPECIFIC':'SHARED BY ALL FOUR',20)+
    D.map((d,i)=>d+'='+JSON.stringify(v[i])).join('  ')+(note?('\n'+' '.repeat(54)+note):''));
};
console.log('=== WHAT VARIES BY RACE DISTANCE TODAY (5K / 10K / Half / Marathon) ===');
console.log('Ultra is descoped from methodology work and is not shown; its runtime');
console.log('behaviour is untouched by anything in this branch.\n');
console.log(pad('checklist item',34)+pad('status',20)+'values');
row('race distance',            d=>a.DISTANCE_PROFILES[d].raceKm);
row('emphasis key',             d=>a.DISTANCE_PROFILES[d].emphasis,
    '<= 5K and 10K share it: this is the AMBER-C finding');
row('volume multiplier',        d=>a.DISTANCE_PROFILES[d].volMult);
row('long-run cap',             d=>a.DISTANCE_PROFILES[d].longCapKm);
row('long-run fraction',        d=>a.LONG_FRACTION[a.DISTANCE_PROFILES[d].emphasis]);
row('min peak long run',        d=>a.MIN_PEAK_LONG_KM[d]);
row('time-trial distance',      d=>a.TT_DISTANCE_KM[a.DISTANCE_PROFILES[d].emphasis]);
row('interval rep range',       d=>a.EMPHASIS_INTERVAL_RANGE[a.DISTANCE_PROFILES[d].emphasis]);
row('tempo range',              d=>a.EMPHASIS_TEMPO_RANGE[a.DISTANCE_PROFILES[d].emphasis]);
row('goal-pace rep length',     d=>a.structGoalPaceIntervals(0.8,a.DISTANCE_PROFILES[d].emphasis).m);
row('goal segment in long run', d=>['threshold','endurance'].indexOf(a.DISTANCE_PROFILES[d].emphasis)!==-1);
row('taper length @16wk',       d=>a.blockArcFor('race',16).taper,
    '<= blockArcFor takes no distance: a 5K and a marathon taper identically');
row('build weeks @16wk',        d=>a.blockArcFor('race',16).buildWeeks);
row('taper quality factor',     d=>a.TAPER_QUALITY_FACTOR);
row('quality slot ceiling',     d=>a.qualitySlotCeilingForDayCount(6));
row('volume ceiling backstop',  d=>a.PROFILE_CEILING_KM[d]);
console.log('\n  SHARED items are candidates for "the coaching rule really is universal".');
console.log('  DISTANCE-SPECIFIC items already express an event difference.');
console.log('  The gaps this exposes for the Race Goal remediation:');
console.log('    - 5K and 10K share every quality range (AMBER-C, open)');
console.log('    - taper length and phase split are identical for all four distances,');
console.log('      although HQ\'s checklist lists taper as a per-distance concern');
console.log('    - MIN_PEAK_LONG_KM is distance-specific but unreachable in production');
console.log('      for every distance below its own admission volume (RED, open)');
