'use strict';
/* HALF MARATHON RACE GOAL — AUDIT INSTRUMENT (READ ONLY).
 * ===========================================================================
 * Measures what the Half Marathon Race Goal generator ACTUALLY produces on
 * main. Asserts nothing, changes nothing, and is not reachable from the app.
 * Every number it prints comes from buildBlockWeeks()/buildDaysFromWeeks() --
 * the same pair handleGeneratePlan() calls.
 *
 *   node test/audit/halfMarathonAudit.js [section]
 *
 * Sections: traj | freq | week | cmp | quality | rebound | all
 */
const path = require('path');
const { loadApp } = require(path.join(__dirname, '..', 'harness.js'));

const TODAY = '2026-03-02T09:00:00Z';   // a Monday, so week buckets align
const r1 = x => Math.round(x * 10) / 10;
const pad = (s, n) => String(s).padStart(n);
const padr = (s, n) => String(s).padEnd(n);

const DAYSETS = { 2:[1,6], 3:[1,3,6], 4:[1,3,4,6], 5:[0,1,3,4,6], 6:[0,1,2,3,4,6] };

/* HISTORY THE ENGINE CAN ACTUALLY READ. Sessions in the athlete's ledger are
   what demonstratedSustainableVolume(), the long-run evidence and the quality
   response model all consult; nothing here invents a state field. */
function history(a, kind, opts){
  const o = opts || {};
  const t = a.todayStr(), m = a.addDays(t, -a.isoWeekday(t));
  const s = [];
  const weeks = o.weeks || 16;
  const longKm = o.longKm || 0;
  const easyKm = o.easyKm || 6;
  const easyDays = o.easyDays || [0, 2, 4];
  for (let w = 1; w <= weeks; w++){
    easyDays.forEach(d => s.push({ date: a.addDays(m, -7 * w + d), completed: true,
      actualKm: easyKm, plannedKm: easyKm, type: 'easy',
      actual: { km: easyKm, rpe: 3, pace: 400, hr: 135 }, feel: 'good' }));
    if (longKm > 0) s.push({ date: a.addDays(m, -7 * w + 6), completed: true,
      actualKm: longKm, plannedKm: longKm, type: 'long',
      actual: { km: longKm, rpe: 5, pace: 420, hr: 140 }, feel: 'good' });
    if (kind === 'threshold') s.push({ date: a.addDays(m, -7 * w + 3), completed: true,
      actualKm: o.qKm || 10, plannedKm: o.qKm || 10, type: 'tempo',
      actual: { km: o.qKm || 10, rpe: 7, pace: 300, hr: 168 }, feel: 'good' });
    if (kind === 'interval') s.push({ date: a.addDays(m, -7 * w + 3), completed: true,
      actualKm: o.qKm || 10, plannedKm: o.qKm || 10, type: 'interval',
      actual: { km: o.qKm || 10, rpe: 8, pace: 280, hr: 175 }, feel: 'good' });
  }
  return s;
}

function build(o){
  const a = loadApp({ pinnedDate: TODAY });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  a.state = a.makeDefaultState();
  if (o.history) a.state.athlete = { sessions: history(a, o.history, o) };
  const vd = a.vdotFromPerformance(5000, (o.tt5kMin || 25) * 60);
  const z  = a.trainingPacesFromVDOT(vd);
  const pace = (z.E.slow + z.E.fast) / 2;
  const days = DAYSETS[o.days || 5];
  const start = a.todayStr();
  const startMonday = a.addDays(start, -a.isoWeekday(start));
  const raceDate = a.addDays(startMonday, (o.weeks || 15) * 7 - 1);
  const blk = a.buildBlockWeeks(o.dist || 'half', o.volume, o.weeks || 15,
    { purpose: 'race', availableDays: days, easyPaceSecPerKm: pace });
  const sched = { activeDays: days, longRunDay: 6 };
  const dd = a.buildDaysFromWeeks(blk, raceDate, sched, start, false,
    { easyPaceSecPerKm: pace });
  return { a, blk, days: dd, pace, vdot: vd };
}

/* The week as the athlete actually receives it: days, not the generator's
   intent. */
function weekRows(res){
  const byWeek = {};
  res.blk.weeks.forEach(w => { byWeek[w.week] = { w: w, days: [] }; });
  res.days.forEach(d => { if (byWeek[d.week]) byWeek[d.week].days.push(d); });
  return Object.keys(byWeek).map(k => byWeek[k]).sort((x, y) => x.w.week - y.w.week);
}

function qualityTypeOf(d){
  if (!d.prescription) return d.type;
  return d.prescription.archetype || d.type;
}

function trajectory(label, o){
  const res = build(o);
  const rows = weekRows(res);
  console.log('');
  console.log('--- ' + label + ' --- ' + (o.volume) + ' km/week, ' + (o.weeks || 15) +
              ' weeks, ' + (o.days || 5) + ' available days' +
              (o.history ? ', history=' + o.history : '') +
              (o.longKm ? ', demonstrated LR ' + o.longKm + 'km' : ''));
  console.log('qual freq: ceiling ' + (res.blk.qualityFrequency ? res.blk.qualityFrequency.ceiling : '?') +
              '  prescribed ' + (res.blk.qualityFrequency ? res.blk.qualityFrequency.prescribed : '?') +
              '  peakVolume ' + r1(res.blk.peakVolume) +
              '  buildWeeks ' + res.blk.buildWeeks + '  taper ' + res.blk.taperWeeks);
  console.log('wk  phase       vol    d%   runs   LR    LRshare  qN  quality                    Qkm   GP');
  let prev = null;
  rows.forEach(rw => {
    const w = rw.w;
    const runs = rw.days.filter(d => d.km > 0);
    const vol = r1(runs.reduce((t, d) => t + d.km, 0));
    const lr = runs.filter(d => d.type === 'long').reduce((t, d) => t + d.km, 0);
    const q  = runs.filter(d => d.type !== 'long' && d.type !== 'easy' && d.type !== 'race');
    const qkm = r1(q.reduce((t, d) => t + d.km, 0));
    const race = runs.filter(d => d.type === 'race');
    const dpc = prev == null || prev === 0 ? '-' : (Math.round((vol / prev - 1) * 1000) / 10);
    console.log(pad(w.week, 2) + '  ' + padr(w.phase, 11) + pad(vol, 5) + pad(dpc, 6) +
      pad(runs.length, 6) + pad(r1(lr), 6) + pad(lr > 0 ? Math.round(lr / vol * 100) + '%' : '-', 8) +
      pad(q.length, 5) + '  ' + padr(q.map(d => qualityTypeOf(d)).join(',') || '-', 25) +
      pad(qkm, 5) + '  ' + (w.hasGoalSegment ? r1(w.goalSegKm) : '-') +
      (race.length ? '  RACE ' + r1(race[0].km) : ''));
    prev = vol;
  });
  return res;
}

function writtenWeek(label, o, wkNums){
  const res = build(o);
  const rows = weekRows(res);
  console.log('');
  console.log('=== WRITTEN DAYS — ' + label + ' ===');
  wkNums.forEach(n => {
    const rw = rows.filter(r => r.w.week === n)[0];
    if (!rw) return;
    console.log('  week ' + n + '  (' + rw.w.phase + ')');
    rw.days.forEach(d => {
      if (!d.km && d.type === 'rest') return;
      let segs = '';
      try {
        const s = res.a.segmentsFor(d.prescription);
        if (s) segs = s.map(g => (g.kind || '') + (g.km != null ? ' ' + r1(g.km) + 'km'
          : g.m != null ? ' ' + g.m + 'm' : g.sec != null ? ' ' + Math.round(g.sec / 60) + 'min' : '') +
          (g.reps ? ' x' + g.reps : '') + '/' + (g.intensity || '')).join(' | ');
      } catch (e){ segs = 'segErr'; }
      console.log('    ' + padr(d.date, 11) + padr(d.type, 9) + pad(r1(d.km || 0), 5) + 'km  ' +
        padr(d.title || '', 34) + (d.mediumLong ? '[ML] ' : '') + (d.mpSegment ? '[MP] ' : ''));
      if (segs) console.log('               ' + segs);
    });
  });
}

function freqTable(dist, weeks, days){
  console.log('');
  console.log('--- PRESCRIBED FREQUENCY, ' + dist.toUpperCase() + ', ' + weeks +
              ' weeks, ' + days + ' available days ---');
  console.log(' vol  peakVol  peakWk  runs(min-max,med)  qSlots  LRpeak  LRshare  smallest run');
  [6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70].forEach(v => {
    const res = build({ dist: dist, volume: v, weeks: weeks, days: days });
    const rows = weekRows(res).filter(r => !r.w.isRace);
    const counts = rows.map(r => r.days.filter(d => d.km > 0).length);
    const vols = rows.map(r => r1(r.days.filter(d => d.km > 0).reduce((t, d) => t + d.km, 0)));
    const lrs = rows.map(r => r.days.filter(d => d.type === 'long').reduce((t, d) => t + d.km, 0));
    const smallest = Math.min.apply(null, rows.map(r => {
      const runs = r.days.filter(d => d.km > 0);
      return runs.length ? Math.min.apply(null, runs.map(d => d.km)) : 99; }));
    const sorted = counts.slice().sort((x, y) => x - y);
    const peakWk = Math.max.apply(null, vols);
    const lrPeak = Math.max.apply(null, lrs);
    console.log(pad(v, 4) + pad(r1(res.blk.peakVolume), 9) + pad(peakWk, 8) +
      pad(Math.min.apply(null, counts) + '-' + Math.max.apply(null, counts) + ',' +
          sorted[Math.floor(sorted.length / 2)], 19) +
      pad(res.blk.qualityFrequency ? res.blk.qualityFrequency.prescribed : '?', 8) +
      pad(r1(lrPeak), 8) + pad(Math.round(lrPeak / peakWk * 100) + '%', 9) +
      pad(r1(smallest), 14));
  });
}

/* THE QUALITY LIBRARY, ASKED OF THE ENGINE ITSELF rather than transcribed. */
function qualityLibrary(){
  const a = loadApp({ pinnedDate: TODAY });
  a.state = a.makeDefaultState();
  const phases = ['Base', 'Build', 'Peak'];
  const emph = { '5k':'speed', '10k':'speed', 'half':'threshold', 'full':'endurance', 'ultra':'timeonfeet' };
  console.log('');
  console.log('=== QUALITY LIBRARY — what each distance can actually receive ===');
  ['interval', 'tempo'].forEach(fam => {
    const pool = fam === 'interval' ? a.INTERVAL_STRUCTURE_POOL : a.TEMPO_STRUCTURE_POOL;
    console.log('');
    console.log('--- ' + fam.toUpperCase() + ' POOL ---');
    console.log('phase  pos  ' + ['5k','10k','half','full','ultra']
      .map(d => padr(d, 30)).join(''));
    phases.forEach(ph => {
      [0, 0.5, 1].forEach(pos => {
        const cells = ['5k','10k','half','full','ultra'].map(d => {
          const spec = a.pickQualityStructure(pool, ph, 3, pos, emph[d], 0);
          const km = fam === 'interval' ? a.intervalSessionKm(spec) : a.tempoSessionKm(spec);
          return padr(a.qualityStructureLabel ? a.qualityStructureLabel(spec)
                      : JSON.stringify(spec).slice(0, 24), 24) + pad(r1(km), 5) + ' ';
        });
        console.log(padr(ph, 7) + padr(pos, 5) + cells.join(''));
      });
    });
  });
}

function cmpTable(){
  console.log('');
  console.log('=== HALF vs 10K vs MARATHON — the same athlete, three events ===');
  [20, 30, 50, 70].forEach(v => {
    console.log('');
    console.log('  ' + v + ' km/week, 14 weeks, 5 available days');
    console.log('  dist   peakVol  peakWk  LRpeak  LRshare  qSlots  runs  Qkm@peak  GPweeks  taper');
    ['10k', 'half', 'full'].forEach(d => {
      const res = build({ dist: d, volume: v, weeks: 14, days: 5 });
      const rows = weekRows(res).filter(r => !r.w.isRace);
      const vols = rows.map(r => r1(r.days.filter(x => x.km > 0).reduce((t, x) => t + x.km, 0)));
      const lrs = rows.map(r => r.days.filter(x => x.type === 'long').reduce((t, x) => t + x.km, 0));
      const peakWk = Math.max.apply(null, vols);
      const pi = vols.indexOf(peakWk);
      const qAtPeak = r1(rows[pi].days.filter(x => x.km > 0 && x.type !== 'long' && x.type !== 'easy')
        .reduce((t, x) => t + x.km, 0));
      const gp = res.blk.weeks.filter(w => w.hasGoalSegment).length;
      const counts = rows.map(r => r.days.filter(x => x.km > 0).length);
      const sorted = counts.slice().sort((x, y) => x - y);
      console.log('  ' + padr(d, 7) + pad(r1(res.blk.peakVolume), 7) + pad(peakWk, 8) +
        pad(r1(Math.max.apply(null, lrs)), 8) +
        pad(Math.round(Math.max.apply(null, lrs) / peakWk * 100) + '%', 9) +
        pad(res.blk.qualityFrequency ? res.blk.qualityFrequency.prescribed : '?', 8) +
        pad(sorted[Math.floor(sorted.length / 2)], 6) + pad(qAtPeak, 10) + pad(gp, 9) +
        pad(res.blk.taperWeeks, 7));
    });
  });
}

function rebound(){
  console.log('');
  console.log('=== THE RECORDED HALF SIGNAL: 50 km/week, 12-week plan ===');
  const res = build({ dist: 'half', volume: 50, weeks: 12, days: 5 });
  const rows = weekRows(res);
  console.log('wk  phase       cut  vol     d%     dkm   runs   LR    quality             Qkm');
  let prev = null;
  rows.forEach(rw => {
    const w = rw.w;
    const runs = rw.days.filter(d => d.km > 0);
    const vol = r1(runs.reduce((t, d) => t + d.km, 0));
    const lr = r1(runs.filter(d => d.type === 'long').reduce((t, d) => t + d.km, 0));
    const q = runs.filter(d => d.type !== 'long' && d.type !== 'easy' && d.type !== 'race');
    console.log(pad(w.week, 2) + '  ' + padr(w.phase, 11) +
      padr(w.isCutback ? 'CUT' : (w.isTaper ? 'TAP' : (w.isRace ? 'RACE' : '')), 5) +
      pad(vol, 6) + pad(prev == null ? '-' : Math.round(vol / prev * 100) / 100, 7) +
      pad(prev == null ? '-' : r1(vol - prev), 7) + pad(runs.length, 6) + pad(lr, 6) + '  ' +
      padr(q.map(d => qualityTypeOf(d) + ':' + r1(d.km)).join(' ') || '-', 20) +
      pad(r1(q.reduce((t, d) => t + d.km, 0)), 5));
    prev = vol;
  });
  console.log('');
  console.log('  the two weeks side by side, session for session:');
  [4, 5].forEach(n => {
    const rw = rows.filter(r => r.w.week === n)[0];
    console.log('    week ' + n + ' (' + rw.w.phase + (rw.w.isCutback ? ', CUTBACK' : '') +
                ')  target ' + r1(rw.w.volume) + '  longTarget ' + r1(rw.w.longTarget));
    rw.days.filter(d => d.km > 0).forEach(d =>
      console.log('      ' + padr(d.type, 9) + pad(r1(d.km), 6) + 'km  ' + (d.title || '')));
  });
}

const SECTIONS = {
  traj(){
    trajectory('A. 6 km/week, 6 days',        { volume: 6,  days: 6 });
    trajectory('B. 12 km/week, 5 days',       { volume: 12, days: 5 });
    trajectory('C. 20 km/week, 5 days',       { volume: 20, days: 5 });
    trajectory('D. 30 km/week, 5 days, no history', { volume: 30, days: 5 });
    trajectory('E. 30 km/week, threshold history',  { volume: 30, days: 5, history: 'threshold', easyKm: 7, longKm: 12 });
    trajectory('F. 30 km/week, demonstrated LR 16', { volume: 30, days: 5, history: 'easy', easyKm: 6, longKm: 16 });
    trajectory('G. 50 km/week established',   { volume: 50, days: 6, history: 'threshold', easyKm: 10, longKm: 18, tt5kMin: 20 });
    trajectory('H. 70 km/week established',   { volume: 70, days: 6, history: 'threshold', easyKm: 12, longKm: 24, tt5kMin: 18 });
  },
  freq(){
    freqTable('half', 14, 6);
    freqTable('half', 14, 3);
    freqTable('half', 8, 6);
    freqTable('half', 24, 6);
  },
  week(){
    writtenWeek('6 km/week, 6 days', { volume: 6, days: 6 }, [1, 7, 12]);
    writtenWeek('20 km/week, 5 days', { volume: 20, days: 5 }, [1, 7, 11, 13]);
    writtenWeek('50 km/week, 6 days', { volume: 50, days: 6 }, [1, 7, 11, 13]);
  },
  cmp: cmpTable,
  quality: qualityLibrary,
  rebound: rebound
};

const which = process.argv[2] || 'all';
if (which === 'all') Object.keys(SECTIONS).forEach(k => SECTIONS[k]());
else if (SECTIONS[which]) SECTIONS[which]();
else console.log('unknown section: ' + which);
