'use strict';
/* week_over_week_growth_over_10pct, MARATHON, DECOMPOSED. READ-ONLY.
 * ===========================================================================
 * A counter is not a finding. This sorts every flagged marathon step three
 * ways -- by the DENOMINATOR it is measured against, by the ABSOLUTE change,
 * and by the structural CAUSE -- so that a percentage produced by a small week
 * can be told apart from a training decision that is actually large.
 *
 * It measures the invariant EXACTLY as test/audit/invariants.js does, by
 * calling it, so nothing here can quietly disagree with the ratchet.
 *
 *   node test/audit/marathonGrowthDecomposition.js
 */
const path = require('path');
const { auditCase } = require(path.join(__dirname, 'planAudit.js'));
const { checkCase } = require(path.join(__dirname, 'invariants.js'));

const r1 = x => Math.round(x * 10) / 10;
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint'];
const VOLUMES = (function(){ const v = []; for (let i = 1; i <= 40; i++) v.push(i);
  [45, 50, 60, 70, 80, 100, 120].forEach(x => v.push(x)); return v; })();

/* THE PRODUCTION-VALID RACE GOAL DOMAIN. Below the entry minimum a Race Goal
   programme is not built at all -- the athlete is routed to Aerobic Base -- so
   a marathon block at 1-5km/week is a DEFENSIVE state the audit can invoke
   directly and not a state the product produces. Both are reported: the raw
   generator audit, and the population the merge gate is judged on. */
const RACE_GOAL_MIN_KM = require('../../assets/builder-spec.js').validation.raceGoalMinWeeklyKm;

function collect(minVolumeKm){
  const floor = minVolumeKm || 0;
  const rows = [];
  for (const volume of VOLUMES) for (const n of [4, 8, 12, 16, 24]) for (const s of ['d3', 'd5']){
    if (volume < floor) continue;
    const c = auditCase({ distanceKey: 'full', volume, weeks: n, scheduleKey: s });
    const flagged = new Set();
    checkCase(c).forEach(f => {
      if (f.code === 'week_over_week_growth_over_10pct') flagged.add((f.detail || f).week);
    });
    if (!flagged.size) continue;
    c.weeks.forEach((w, i) => {
      if (!flagged.has(w.week)) return;
      const p = c.weeks[i - 1]; if (!p) return;
      const runs = x => x.sessions.filter(y => y.km > 0);
      const parts = x => ({
        long: runs(x).filter(y => y.type === 'long'),
        q:    runs(x).filter(y => QUALITY.indexOf(y.type) !== -1),
        ck:   runs(x).filter(y => y.type === 'checkpoint'),
        easy: runs(x).filter(y => y.type === 'easy'),
        ml:   runs(x).filter(y => y.mediumLong),
        mp:   x.sessions.filter(y => y.mpSegment) });
      const A = parts(p), B = parts(w), sum = a => r1(a.reduce((s, y) => s + y.km, 0));
      const from = r1(runs(p).reduce((s, y) => s + y.km, 0));
      const to   = r1(runs(w).reduce((s, y) => s + y.km, 0));
      const dLong = r1(sum(B.long) - sum(A.long));
      const dEasy = r1(sum(B.easy) - sum(A.easy));
      const dQ    = r1(sum(B.q) - sum(A.q));
      const cause =
        B.ck.length && !A.ck.length            ? 'checkpoint introduction' :
        B.q.length && !A.q.length              ? 'quality introduction' :
        B.ml.length && !A.ml.length            ? 'medium-long introduction' :
        B.mp.length && !A.mp.length            ? 'marathon-specific dose' :
        runs(w).length > runs(p).length        ? 'additional day' :
        p.phase !== w.phase                    ? 'phase transition' :
        dLong >= Math.max(dEasy, dQ)           ? 'LR progression' :
        dEasy >= Math.max(dLong, dQ)           ? 'easy/support progression' :
        dQ > 0                                 ? 'quality dose' : 'other';
      rows.push({ volume, n, s, week: w.week, phase: w.phase, from, to,
        pct: Math.round((to / from - 1) * 1000) / 10, abs: r1(to - from), cause });
    });
  }
  return rows;
}

const med = a => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y);
  const m = b.length >> 1; return b.length % 2 ? b[m] : Math.round((b[m - 1] + b[m]) / 2 * 10) / 10; };

function table(rows, keyFn, order, label){
  console.log('\n--- by ' + label + ' ---');
  console.log('class'.padEnd(28) + 'count'.padStart(7) + 'median %'.padStart(10) + 'max %'.padStart(8) +
              'median km'.padStart(11) + 'max km'.padStart(8));
  const g = {}; rows.forEach(r => { (g[keyFn(r)] = g[keyFn(r)] || []).push(r); });
  (order || Object.keys(g).sort()).forEach(k => { const a = g[k]; if (!a) return;
    console.log(String(k).padEnd(28) + String(a.length).padStart(7) +
      String(med(a.map(x => x.pct))).padStart(10) + String(Math.max.apply(null, a.map(x => x.pct))).padStart(8) +
      String(med(a.map(x => x.abs))).padStart(11) + String(Math.max.apply(null, a.map(x => x.abs))).padStart(8));
  });
}
const vBand = v => v <= 5 ? '<=5' : v <= 10 ? '>5-10' : v <= 15 ? '>10-15' :
                   v <= 25 ? '>15-25' : v <= 40 ? '>25-40' : '>40';
const aBand = a => a <= 1 ? '<=1' : a <= 2 ? '>1-2' : a <= 3 ? '>2-3' :
                   a <= 5 ? '>3-5' : a <= 10 ? '>5-10' : '>10';
const line = r => '  vol' + String(r.volume).padStart(4) + ' ' + r.n + 'w ' + r.s +
  ' wk' + String(r.week).padStart(2) + ' ' + String(r.phase).padEnd(7) +
  String(r.from).padStart(6) + ' -> ' + String(r.to).padStart(6) +
  String(r.pct).padStart(8) + '%' + String(r.abs).padStart(7) + 'km  ' + r.cause;

function report(rows, title){
  console.log('\n' + title + ': ' + rows.length + ' flagged steps');
  table(rows, r => vBand(r.from), ['<=5', '>5-10', '>10-15', '>15-25', '>25-40', '>40'],
        'STARTING WEEK VOLUME (the denominator)');
  table(rows, r => aBand(r.abs), ['<=1', '>1-2', '>2-3', '>3-5', '>5-10', '>10'],
        'ABSOLUTE INCREASE');
  table(rows, r => r.cause, null, 'CAUSE');
  console.log('\n--- audit signal against percentage artefact ---');
  const tiny = rows.filter(r => r.from < 10);
  const small = rows.filter(r => r.from >= 10 && r.abs <= 2);
  const real = rows.filter(r => r.from >= 10 && r.abs > 2);
  console.log('  from a week under 10km, where one presentation quantum is already >10%: ' + tiny.length);
  console.log('  from 10km or more, but two kilometres or less of actual change:         ' + small.length);
  console.log('  from 10km or more AND more than two kilometres:                         ' + real.length);
  console.log('    of those, more than 5km: ' + real.filter(r => r.abs > 5).length +
              ';  more than 20%: ' + real.filter(r => r.pct > 20).length);
  console.log('\n--- the ten largest percentage steps ---');
  rows.slice().sort((a, b) => b.pct - a.pct).slice(0, 10).forEach(r => console.log(line(r)));
  console.log('\n--- the ten largest absolute steps ---');
  rows.slice().sort((a, b) => b.abs - a.abs).slice(0, 10).forEach(r => console.log(line(r)));
}

if (require.main === module){
  const all = collect(0);
  report(all, 'A. RAW GENERATOR AUDIT — every state, including the defensive ones below '
    + RACE_GOAL_MIN_KM + 'km/week');
  console.log('\n' + '='.repeat(78));
  report(all.filter(r => r.volume >= RACE_GOAL_MIN_KM),
    'B. PRODUCTION-VALID RACE GOAL — stated volume ' + RACE_GOAL_MIN_KM + 'km/week and above');
}
module.exports = { collect, RACE_GOAL_MIN_KM };
