'use strict';
/* THE GENERATED EVIDENCE BEHIND THE PROGRAMME REPORT.
 *
 *   node tools/shots/programme-report.js
 *
 * Three sections, all produced by running the real engine rather than by
 * reading it: the mathematics of each block, the repetition an athlete would
 * actually meet, and the multi-year volume simulation. Deterministic -- run it
 * twice and the numbers are identical, which is what makes them evidence.
 */
const path = require('path');
const { loadApp, makePinnedDate } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan, logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const TODAY = '2026-08-21';
const line = s => console.log(s);
const hdr = s => { line(''); line('='.repeat(72)); line(s); line('='.repeat(72)); };

function engine(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  return a;
}

/* ---------------------------------------------------------------- *
 * 17. PROGRAMME MATHEMATICS
 * ---------------------------------------------------------------- */
hdr('17. PROGRAMME MATHEMATICS — every block, week by week');
{
  const a = engine();
  /* RECOVERY IS NOT IN THIS LIST, and its absence is the correction.
     buildBlockWeeks() is only the middle third of what a recovery block is: the
     volume the athlete actually gets comes from developmentBlockSpec(), which
     multiplies by RECOVERY_PROFILE.volumeFactor (0.35-0.55 by distance), and
     the intensity comes from applyRecoveryCeiling(), which is applied after the
     days are laid out. Calling buildBlockWeeks alone reported a recovery block
     at the athlete's full race volume with two quality sessions a week and a
     15.4km long run -- none of which any athlete is ever prescribed. Section
     17b below runs the real path end to end instead. */
  [['RACE GOAL', 'race', 'half', 12], ['MAINTAIN & PROTECT', 'maintain', 'half', 8],
   ['AEROBIC BASE', 'base', 'half', 10], ['SPEED & THRESHOLD', 'speed', '5k', 6]].forEach(([label, p, d, n]) => {
    const b = a.buildBlockWeeks(d, 55, n, { purpose: p, steady: p === 'maintain' });
    line('');
    line(label + '  (' + d + ', 55km/week start, ' + n + ' weeks)');
    line('  peak ' + b.peakVolume + 'km   development weeks ' + b.buildWeeks +
         '   down weeks ' + b.taperWeeks + '   ceiling ' + a.volumeCeilingFor(d));
    line('  wk  phase        vol    quality km   long   flags');
    b.weeks.forEach(w => {
      const flags = [w.isCutback && 'cutback', w.isTaper && 'down', w.isRace && 'GOAL EFFORT',
                     w.isCheckpoint && 'CHECKPOINT', w.hasGoalSegment && 'goal-pace finish']
                    .filter(Boolean).join(' ');
      line('  ' + String(w.week).padStart(2) + '  ' + String(w.phase).padEnd(12) +
           String(w.volume).padStart(6) + '   ' +
           String(a.round1(w.qKm + w.tKm)).padStart(9) + '   ' +
           String(w.longTarget).padStart(4) + '   ' + flags);
    });
    /* DECOMPOSED, because the summed figure below is not a methodology finding
       on its own. "Quality load up 49%" says nothing about whether the block is
       aerobic development until it is put beside what the AEROBIC half of the
       same block did -- which, in the base block, was +10%. */
    {
      const start = '2026-08-24';
      const dys = a.buildDaysFromWeeks(b, a.addDays(start, n * 7 - 1),
        { activeDays: [0, 1, 2, 4, 5], longRunDay: 5 }, start, false);
      const QK = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'];
      const full = b.weeks.filter(w => !w.isCutback && !w.isTaper && !w.isRace);
      const agg = w => {
        const wd = dys.filter(x => x.week === w.week && x.type !== 'rest');
        const sum = f => a.round1(wd.filter(f).reduce((s, x) => s + (x.km || 0), 0));
        return { aer: sum(x => x.type === 'easy' || x.type === 'long'),
                 q: sum(x => QK.indexOf(x.type) !== -1) };
      };
      if (full.length > 1){
        const f = agg(full[0]), l = agg(full[full.length - 1]);
        const pc = (x, y) => (x ? Math.round((y / x - 1) * 100) : 0) + '%';
        line('  full weeks only, wk' + full[0].week + ' -> wk' + full[full.length - 1].week +
             ':  aerobic ' + f.aer + ' -> ' + l.aer + ' (' + pc(f.aer, l.aer) + ')' +
             '   quality ' + f.q + ' -> ' + l.q + ' (' + pc(f.q, l.q) + ')');
      }
    }
    const q = b.weeks.map(w => a.round1(w.qKm + w.tKm));
    const first = q.slice(0, Math.ceil(q.length / 3)).reduce((x, y) => x + y, 0);
    const last = q.slice(-Math.ceil(q.length / 3)).reduce((x, y) => x + y, 0);
    line('  quality load first third vs last third: ' + a.round1(first) + ' -> ' + a.round1(last) +
         '   (' + (first ? Math.round((last / first - 1) * 100) : 0) + '%)');
    line('  long run as share of week: ' +
         [Math.min.apply(null, b.weeks.map(w => Math.round(w.longTarget / w.volume * 100))),
          Math.max.apply(null, b.weeks.map(w => Math.round(w.longTarget / w.volume * 100)))].join('–') + '%');
  });
}

/* ---------------------------------------------------------------- *
 * 17b. RECOVERY, THROUGH THE REAL PATH
 * ---------------------------------------------------------------- */
hdr('17b. RECOVERY — what the athlete is actually prescribed after a race');
{
  const QUAL = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'];
  [['5k', 40], ['10k', 45], ['half', 55], ['full', 60]].forEach(([dk, vol]) => {
    const a = engine();
    // A finished, fully logged race block, with the race yesterday.
    buildPlan(a, { distanceKey: dk, volume: vol, weeks: 12,
                   startDate: a.addDays(TODAY, -84), benchSec: 45 * 60 });
    a.state.athlete = a.makeAthleteRecord();
    a.state.setup.purpose = 'race';
    const blk = a.openBlock({ purpose: 'race', startDate: a.state.setup.startDate, distanceKey: dk,
                              goalDate: a.state.setup.raceDate, hasEvent: false,
                              startVolume: vol });
    a.state.setup.blockId = blk.id;
    a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')
                .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
    a.state.setup.raceDate = a.addDays(TODAY, -1);
    const dem = a.demonstratedSustainableVolume();
    if (!a.startDevelopmentBlock('recovery', { raceDistanceKey: dk })){
      line('');
      line('RECOVERY AFTER ' + dk.toUpperCase() + ' — not generated');
      return;
    }
    const days = a.state.days.filter(d => d.type !== 'rest');
    const byWeek = {};
    days.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
    line('');
    line('RECOVERY AFTER ' + dk.toUpperCase() + '  (race block from ' + vol + 'km/week)');
    line('  demonstrated sustainable before it: ' + dem + 'km/week');
    line('  prescribed recovery volume: ' + a.state.setup.currentVolume + 'km/week  (' +
         Math.round(a.state.setup.currentVolume / dem * 100) + '% of demonstrated)');
    line('  wk   totalKm   longest   qualityKm   sessions');
    Object.keys(byWeek).sort((x, y) => x - y).forEach(w => {
      const dd = byWeek[w];
      const q = dd.filter(x => QUAL.indexOf(x.type) !== -1);
      line('  ' + String(w).padStart(2) +
           String(a.round1(dd.reduce((s2, x) => s2 + (x.km || 0), 0))).padStart(10) +
           String(a.round1(Math.max.apply(null, dd.map(x => x.km || 0)))).padStart(10) +
           String(a.round1(q.reduce((s2, x) => s2 + (x.km || 0), 0))).padStart(12) +
           '   ' + dd.map(x => x.type + ' ' + x.km).join(', '));
    });
  });
}

/* ---------------------------------------------------------------- *
 * 18. REPETITION
 * ---------------------------------------------------------------- */
hdr('18. REPETITION — what the athlete would actually meet');
{
  const a = engine();
  const sig = w => JSON.stringify(w.qSpec) + '|' + JSON.stringify(w.tSpec);
  ['maintain', 'base', 'speed'].forEach(p => {
    const b = engine();
    const all = [], perBlock = [];
    for (let i = 0; i < 3; i++){
      const blk = b.buildBlockWeeks(p === 'speed' ? '5k' : 'half', 55,
        p === 'maintain' ? 8 : p === 'base' ? 10 : 6,
        { purpose: p, steady: p === 'maintain' });
      const s = blk.weeks.map(sig);
      perBlock.push(new Set(s).size + '/' + s.length);
      s.forEach(x => all.push(x));
      b.state.athlete.blocks.push({ id: 'b' + i, purpose: p, status: 'closed' });
    }
    line('');
    line(p.toUpperCase() + ' x3 consecutive blocks');
    line('  distinct quality sessions within each block: ' + perBlock.join(', '));
    line('  distinct across all three:                   ' + new Set(all).size + '/' + all.length);
  });

  // long runs
  line('');
  ['race', 'base', 'maintain', 'speed'].forEach(p => {
    const n = p === 'race' ? 12 : p === 'base' ? 10 : p === 'maintain' ? 8 : 6;
    const d = p === 'speed' ? '5k' : 'half';
    const br = a.buildBlockWeeks(d, 55, n, { purpose: p, steady: p === 'maintain' });
    const days = a.buildDaysFromWeeks(br, a.addDays(TODAY, n * 7),
      { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }, TODAY, false);
    const longs = days.filter(x => x.type === 'long');
    line('  ' + p.padEnd(9) + ' long runs: ' + longs.length + ', distinct titles ' +
         new Set(longs.map(x => x.title)).size);
  });

  // coaching prose
  const c = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  c.showToast = () => {}; c.renderApp = () => {}; c.flushSave = () => {}; c.scheduleSave = () => {};
  buildPlan(c, { weeks: 12, startDate: c.addDays(TODAY, -56), distanceKey: 'half',
                 volume: 55, benchSec: 45 * 60, lthr: 165, maxHR: 190 });
  const past = c.state.days.filter(x => x.date < TODAY && x.type !== 'rest')
                .sort((x, y) => (x.date < y.date ? -1 : 1));
  past.forEach((dd, i) => logAsPrescribed(c, dd, { quality: i % 7 === 3 ? 0.8 : 1 }));
  const counts = {};
  past.forEach(dd => { const m = c.coachDebrief(dd); if (m) m.paragraphs.forEach(x => { counts[x] = (counts[x] || 0) + 1; }); });
  const rep = Object.entries(counts).sort((x, y) => y[1] - x[1]);
  line('');
  line('COACHING PROSE across ' + past.length + ' reviewed sessions');
  line('  distinct paragraphs: ' + rep.length + '   printed: ' +
       Object.values(counts).reduce((x, y) => x + y, 0));
  line('  most repeated:');
  rep.slice(0, 6).forEach(([s, n]) =>
    line('    x' + String(n).padStart(2) + ' (' + Math.round(n / past.length * 100) + '% of cards)  ' + s.slice(0, 82)));
}

/* ---------------------------------------------------------------- *
 * 19. MULTI-YEAR SIMULATION
 * ---------------------------------------------------------------- */
hdr('19. MULTI-YEAR SIMULATION — the arithmetic bound, with no athlete in it');
line('');
line('  WHAT THIS DOES AND DOES NOT EXERCISE. It calls buildBlockWeeks() in a loop');
line('  with no block ledger, no state.days and no logged sessions, so it measures');
line('  ONE thing: can the volume arithmetic run away. It cannot see the');
line('  progression gate at all -- progressionJustification() reads the block that');
line('  just ended, and no block ends here -- so every athlete below grows');
line('  identically and every column converges on the backstop. That convergence is');
line('  the arithmetic bound holding, not a programme an athlete would be given.');
line('  For what five different athletes are actually prescribed, run');
line('  tools/shots/trajectories.js.');
{
  const median = v => { const s = v.slice().sort((x, y) => x - y); const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2 * 10) / 10; };
  function simulate(distKey, startVol, years, capacity){
    const a = loadApp({ pinnedDate: '2026-01-05T09:00:00Z' });
    a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
    a.state.setup = { distanceKey: distKey, currentVolume: startVol };
    const CYCLE = [[distKey, 12, 'race'], [distKey, 2, 'recovery'],
                   [distKey, 8, 'maintain'], [distKey, 10, 'base'], ['5k', 6, 'speed']];
    let vol = startVol, day = new Date('2026-01-05'), yearPeak = [];
    for (let y = 0; y < years; y++){
      let yp = 0;
      for (const [dk, wks, purpose] of CYCLE){
        const br = a.buildBlockWeeks(dk, a.cappedBlockStartVolume(vol, dk), wks,
          { purpose, steady: purpose === 'maintain' });
        yp = Math.max(yp, br.peakVolume);
        br.weeks.forEach(w => {
          const km = Math.round(Math.min(w.volume, capacity) * 10) / 10;
          a.state.athlete.sessions.push({ date: day.toISOString().slice(0, 10), completed: true, actualKm: km });
          day = new Date(day.getTime() + 7 * 86400000);
          a.Date = makePinnedDate(day.toISOString());
        });
        vol = median(br.weeks.filter(w => !w.isRace).map(w => Math.round(Math.min(w.volume, capacity) * 10) / 10));
      }
      yearPeak.push(Math.round(yp * 10) / 10);
    }
    return { yearPeak, ceiling: a.volumeCeilingFor(distKey),
             demonstrated: a.demonstratedSustainableVolume() };
  }
  const CASES = [['5k', 40], ['10k', 45], ['half', 50], ['full', 60]];
  [['PERFECTLY COMPLIANT — runs everything prescribed', () => Infinity],
   ['CAPACITY-LIMITED — own hard ceiling at start x 1.4', v => Math.round(v * 1.4)],
   ['CAPACITY-LIMITED — own hard ceiling at the start volume', v => v]].forEach(([label, cap]) => {
    line('');
    line(label);
    line('  dist   start   yr1    yr2    yr3    yr4    yr5   | ceiling  demonstrated');
    CASES.forEach(([d, v]) => {
      const r = simulate(d, v, 5, cap(v));
      line('  ' + d.padEnd(6) + String(v).padStart(4) + '   ' +
           r.yearPeak.map(x => String(x).padStart(5)).join('  ') + '  | ' +
           String(r.ceiling).padStart(7) + '  ' + String(r.demonstrated).padStart(12));
    });
  });
}
line('');
