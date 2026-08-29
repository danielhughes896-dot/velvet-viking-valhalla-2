'use strict';
/* THE SWEEP — every supported input, measured, in one pass.
 * ===========================================================================
 * Streams: each case is generated, checked and discarded, keeping only
 * aggregate counts and a bounded sample of each finding. A full sweep is well
 * over a hundred thousand plans and several million sessions, which does not
 * fit in memory as whole objects and does not need to.
 *
 * Run:  node test/audit/sweep.js [--quick] [--out <path>]
 */

const fs = require('fs');
const path = require('path');
const { auditCase, DISTANCES } = require('./planAudit.js');
const { checkCase } = require('./invariants.js');

const args = process.argv.slice(2);
const QUICK = args.indexOf('--quick') !== -1;
const outIdx = args.indexOf('--out');
const OUT = outIdx !== -1 ? args[outIdx + 1]
          : path.join(__dirname, 'out', 'sweep.json');

/* THE INPUT SPACE, as the builder actually defines it.
     volume   <input type=number min=0 step=1>, validated `volume > 0`
              (BUILDER_SPEC.validation.volumeMustExceed). There is NO upper
              bound in validation, so the sweep runs past any sane figure to
              find where the engine stops behaving.
     weeks    BUILDER_SPEC.validation.weeksRange = [4, 24]
     days     BUILDER_SPEC.validation.daysRange  = [3, 6]  */
const VOLUMES = QUICK ? [1,2,3,5,8,10,15,20,30,40,50,70,100]
  : (function(){ const v = []; for (let i = 1; i <= 120; i++) v.push(i); return v; })();
const WEEKS = QUICK ? [12]
  : (function(){ const w = []; for (let i = 4; i <= 24; i++) w.push(i); return w; })();
const SCHEDULES = QUICK ? ['d5'] : ['d3', 'd4', 'd5', 'd6'];
const PURPOSES = ['race'];

const SAMPLE_CAP = 12;   // examples kept per finding code

const stats = {
  meta: { generatedAt: new Date().toISOString(), quick: QUICK,
          volumes: [VOLUMES[0], VOLUMES[VOLUMES.length - 1]], weeks: WEEKS,
          schedules: SCHEDULES, distances: DISTANCES },
  counts: { cases: 0, plans: 0, weeks: 0, sessions: 0, runSessions: 0, restSessions: 0, errors: 0,
            racePlans: 0, routedPlans: 0 },
  findingsRace: {}, findingsRouted: {},
  extremes: {
    minEasyKm: Infinity, minLongKm: Infinity, maxLongKm: -Infinity,
    minWeekKm: Infinity, maxWeekKm: -Infinity,
    maxWeekOverWeekGrowth: -Infinity, maxWeekOvershootRatio: -Infinity,
    minSegmentKm: Infinity
  },
  extremeExamples: {},
  sessionKmHistogram: {},        // rounded km -> count, active sessions only
  easyKmHistogram: {},
  longKmHistogram: {},
  findings: {},                  // code -> { tier, count, byDistance, byVolumeBand, samples }
  byDistance: {},
  byVolume: {}                   // volume -> { cases, hard, suspect }
};

function bumpExtreme(key, value, ctx){
  const bigger = key.indexOf('max') === 0;
  const cur = stats.extremes[key];
  if (bigger ? value > cur : value < cur){
    stats.extremes[key] = value;
    stats.extremeExamples[key] = ctx;
  }
}
function hist(h, v){ const k = String(v); h[k] = (h[k] || 0) + 1; }
function volBand(v){
  if (v <= 5) return '1-5';
  if (v <= 10) return '6-10';
  if (v <= 20) return '11-20';
  if (v <= 35) return '21-35';
  if (v <= 55) return '36-55';
  if (v <= 80) return '56-80';
  return '81+';
}

function record(c, findings){
  stats.counts.cases++;
  if (c.routed) stats.counts.routedPlans++; else stats.counts.racePlans++;
  if (c.error){ stats.counts.errors++; }
  else {
    stats.counts.plans++;
    stats.counts.weeks += c.weeks.length;
    c.sessions.forEach(s => {
      stats.counts.sessions++;
      if (s.km > 0){
        stats.counts.runSessions++;
        hist(stats.sessionKmHistogram, Math.round(s.km));
        if (s.type === 'easy'){ hist(stats.easyKmHistogram, Math.round(s.km)); bumpExtreme('minEasyKm', s.km, { case: c.id, week: s.week, km: s.km }); }
        if (s.type === 'long'){
          hist(stats.longKmHistogram, Math.round(s.km));
          bumpExtreme('minLongKm', s.km, { case: c.id, week: s.week, km: s.km });
          bumpExtreme('maxLongKm', s.km, { case: c.id, week: s.week, km: s.km });
        }
        if (s.segments) s.segments.forEach(g => {
          if (g.km != null) bumpExtreme('minSegmentKm', g.km, { case: c.id, week: s.week, archetype: s.archetype, intensity: g.intensity, km: g.km, sessionKm: s.km });
        });
      } else stats.counts.restSessions++;
    });
    c.weeks.forEach(w => {
      if (w.isRace) return;
      bumpExtreme('minWeekKm', w.actualVolume, { case: c.id, week: w.week, km: w.actualVolume });
      bumpExtreme('maxWeekKm', w.actualVolume, { case: c.id, week: w.week, km: w.actualVolume });
      if (w.volumeGrowth != null) bumpExtreme('maxWeekOverWeekGrowth', w.volumeGrowth, { case: c.id, week: w.week, growth: w.volumeGrowth });
      if (w.targetVolume > 0) bumpExtreme('maxWeekOvershootRatio', w.actualVolume / w.targetVolume, { case: c.id, week: w.week, target: w.targetVolume, actual: w.actualVolume });
    });
  }

  const d = c.inputs.distanceKey, v = c.inputs.volume;
  stats.byDistance[d] = stats.byDistance[d] || { cases: 0, hard: 0, suspect: 0 };
  stats.byVolume[v] = stats.byVolume[v] || { cases: 0, hard: 0, suspect: 0 };
  stats.byDistance[d].cases++;
  stats.byVolume[v].cases++;

  findings.forEach(f => {
    const e = stats.findings[f.code] = stats.findings[f.code] ||
      { tier: f.tier, count: 0, byDistance: {}, byVolumeBand: {}, byVolume: {}, byPhase: {}, byWeeks: {}, samples: [] };
    e.count++;
    e.byDistance[d] = (e.byDistance[d] || 0) + 1;
    e.byVolumeBand[volBand(v)] = (e.byVolumeBand[volBand(v)] || 0) + 1;
    e.byVolume[v] = (e.byVolume[v] || 0) + 1;
    e.byWeeks[c.inputs.weeks] = (e.byWeeks[c.inputs.weeks] || 0) + 1;
    if (f.phase) e.byPhase[f.phase] = (e.byPhase[f.phase] || 0) + 1;
    if (e.samples.length < SAMPLE_CAP) e.samples.push(f);
    const pop = c.routed ? stats.findingsRouted : stats.findingsRace;
    pop[f.code] = (pop[f.code] || 0) + 1;
    if (f.tier === 'hard'){ stats.byDistance[d].hard++; stats.byVolume[v].hard++; }
    else { stats.byDistance[d].suspect++; stats.byVolume[v].suspect++; }
  });
}

function run(){
  const t0 = Date.now();
  let n = 0;
  for (const distanceKey of DISTANCES)
    for (const volume of VOLUMES)
      for (const weeks of WEEKS)
        for (const scheduleKey of SCHEDULES)
          for (const purpose of PURPOSES){
            const c = auditCase({ distanceKey, volume, weeks, scheduleKey, purpose });
            record(c, checkCase(c));
            if (++n % 20000 === 0)
              process.stderr.write('  ' + n + ' cases, ' + ((Date.now() - t0) / 1000).toFixed(0) + 's\n');
          }
  stats.meta.runtimeMs = Date.now() - t0;
  Object.keys(stats.extremes).forEach(k => { if (!isFinite(stats.extremes[k])) stats.extremes[k] = null; });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(stats, null, 2));
  return stats;
}

if (require.main === module){
  const s = run();
  const c = s.counts;
  console.log('\n=== SWEEP COMPLETE in ' + (s.meta.runtimeMs / 1000).toFixed(1) + 's ===');
  console.log('race programmes ' + c.racePlans + '   routed ' + c.routedPlans +
              '   (' + ((c.routedPlans / c.cases) * 100).toFixed(1) + '% routed)');
  console.log('cases ' + c.cases + '  plans ' + c.plans + '  weeks ' + c.weeks +
              '  sessions ' + c.sessions + '  (' + c.runSessions + ' active, ' + c.restSessions + ' rest)' +
              '  errors ' + c.errors);
  console.log('\n-- FINDINGS --');
  Object.keys(s.findings)
    .sort((a, b) => (s.findings[a].tier === s.findings[b].tier)
      ? s.findings[b].count - s.findings[a].count
      : (s.findings[a].tier === 'hard' ? -1 : 1))
    .forEach(k => {
      const f = s.findings[k];
      console.log(('[' + f.tier.toUpperCase() + ']').padEnd(10) + k.padEnd(42) + String(f.count).padStart(9) +
        '  race ' + String(s.findingsRace[k] || 0).padStart(8) +
        '  routed ' + String(s.findingsRouted[k] || 0).padStart(8));
    });
  console.log('\n-- EXTREMES --');
  Object.keys(s.extremes).forEach(k => console.log('  ' + k.padEnd(26), s.extremes[k]));
  console.log('\nwritten to ' + OUT);
}

module.exports = { run, VOLUMES, WEEKS, SCHEDULES };
