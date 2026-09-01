'use strict';
/* THE WEEKLY LOAD PROGRESSION INSTRUMENT, RUN OVER THE POPULATION. READ-ONLY.
 *   node test/audit/loadProgressionReport.js            marathon
 *   node test/audit/loadProgressionReport.js all        every distance
 */
const path = require('path');
const { auditCase, DISTANCES } = require(path.join(__dirname, 'planAudit.js'));
const { assess, REASON_CODES } = require(path.join(__dirname, 'loadProgression.js'));
/* The production-valid Race Goal domain. Absent on a runtime that predates the
   entry boundary, in which case every state is production-valid and the two
   sections of the report are the same population -- which is the honest
   comparison when measuring an older branch with this ruler. */
const MIN_KM = require(path.join(__dirname, '..', '..', 'assets', 'builder-spec.js'))
  .validation.raceGoalMinWeeklyKm || 0;

const VOLUMES = (function(){ const v = []; for (let i = 1; i <= 40; i++) v.push(i);
  [45, 50, 60, 70, 80, 100, 120].forEach(x => v.push(x)); return v; })();
const WEEKS = [4, 8, 12, 16, 24];
const SCHEDULES = ['d3', 'd5'];

function collect(distanceKey){
  const out = [];
  for (const volume of VOLUMES) for (const w of WEEKS) for (const s of SCHEDULES)
    assess(auditCase({ distanceKey, volume, weeks: w, scheduleKey: s })).forEach(t => out.push(t));
  return out;
}
const med = a => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1; return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2 * 100) / 100; };
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

function band(v){ return v <= 5 ? '<=5' : v <= 10 ? '>5-10' : v <= 15 ? '>10-15'
  : v <= 25 ? '>15-25' : v <= 40 ? '>25-40' : '>40'; }
function aband(a){ return a <= 1 ? '<=1' : a <= 2 ? '>1-2' : a <= 3 ? '>2-3'
  : a <= 5 ? '>3-5' : a <= 10 ? '>5-10' : '>10'; }

function table(rows, keyFn, order, label, extra){
  console.log('\n  --- by ' + label + ' ---');
  console.log('  ' + pad('class', 34) + num('n', 6) + num('med x', 8) + num('max x', 8) +
              num('med km', 9) + num('max km', 9) + (extra ? num('med levers', 12) : ''));
  const g = {}; rows.forEach(r => { (g[keyFn(r)] = g[keyFn(r)] || []).push(r); });
  (order || Object.keys(g).sort()).forEach(k => { const a = g[k]; if (!a) return;
    console.log('  ' + pad(k, 34) + num(a.length, 6) +
      num(med(a.map(x => x.relative || 1)), 8) +
      num(Math.max.apply(null, a.map(x => x.relative || 1)), 8) +
      num(med(a.map(x => x.absoluteKm)), 9) +
      num(Math.max.apply(null, a.map(x => x.absoluteKm)), 9) +
      (extra ? num(med(a.map(x => x.leverCount)), 12) : ''));
  });
}

function report(distanceKey){
  const all = collect(distanceKey);
  const valid = all.filter(t => t.volume >= MIN_KM);
  const line = (t, n) => t.filter(x => x.reasons.length).length + ' of ' + t.length + ' transitions';
  console.log('\n' + '='.repeat(96));
  console.log(distanceKey.toUpperCase() + ' — WEEKLY LOAD PROGRESSION');
  console.log('='.repeat(96));
  [['RAW (every state, defensive <' + MIN_KM + ' included)', all],
   ['PRODUCTION-VALID (stated volume >=' + MIN_KM + 'km/week)', valid]].forEach(([label, rows]) => {
    const susp = rows.filter(t => t.reasons.length);
    const desc = rows.filter(t => t.growthOver10pct);
    console.log('\n' + label);
    console.log('  transitions measured                 ' + rows.length);
    console.log('  descriptive week_over_week_growth_over_10pct  ' + desc.length);
    console.log('  coaching-suspicious progressions     ' + susp.length);
    REASON_CODES.forEach(code => {
      const n = rows.filter(t => t.reasons.indexOf(code) !== -1).length;
      if (n) console.log('    ' + pad(code, 38) + num(n, 6));
    });
    if (!susp.length) return;
    table(susp, r => band(r.fromKm), ['<=5','>5-10','>10-15','>15-25','>25-40','>40'],
          'STARTING WEEK VOLUME');
    table(susp, r => aband(r.absoluteKm), ['<=1','>1-2','>2-3','>3-5','>5-10','>10'],
          'ABSOLUTE INCREASE');
    table(susp, r => String(r.leverCount) + ' lever' + (r.leverCount === 1 ? '' : 's'), null,
          'HOW MANY LOAD LEVERS MOVED', true);
    table(susp, r => r.phaseTransition ? (r.fromPhase + ' -> ' + r.toPhase) : 'within ' + r.fromPhase,
          null, 'PHASE CONTEXT');
    console.log('\n  --- the eight largest, by absolute change ---');
    susp.slice().sort((a, b) => b.absoluteKm - a.absoluteKm).slice(0, 8).forEach(t =>
      console.log('    vol' + num(t.volume, 4) + ' ' + t.weeks + 'w ' + t.schedule +
        ' wk' + num(t.fromWeek, 2) + '->' + num(t.toWeek, 2) + ' ' + pad(t.toPhase, 11) +
        num(t.fromKm, 6) + ' ->' + num(t.toKm, 6) + num(t.relative, 7) + 'x' +
        num('+' + t.absoluteKm, 7) + 'km  [' + t.leverNames.join(',') + ']  ' + t.reasons.join(' ')));
  });
  return { all, valid };
}

if (require.main === module){
  const which = process.argv[2] === 'all' ? DISTANCES : ['full'];
  const summary = [];
  which.forEach(d => {
    const r = report(d);
    const susp = r.valid.filter(t => t.reasons.length);
    const desc = r.valid.filter(t => t.growthOver10pct);
    summary.push([d, r.valid.length, desc.length, susp.length,
      susp.length ? Math.max.apply(null, susp.map(t => t.absoluteKm)) : 0,
      susp.length ? Math.max.apply(null, susp.map(t => t.relative)) : 0]);
  });
  if (which.length > 1){
    console.log('\n' + '='.repeat(96));
    console.log('CROSS-DISTANCE SUMMARY — production-valid domain');
    console.log('='.repeat(96));
    console.log(pad('distance', 10) + num('transitions', 13) + num('>10% (desc)', 13) +
                num('suspicious', 12) + num('max +km', 10) + num('max x', 8));
    summary.forEach(s => console.log(pad(s[0], 10) + num(s[1], 13) + num(s[2], 13) +
      num(s[3], 12) + num(s[4], 10) + num(s[5], 8)));
  }
}
module.exports = { collect, report };
