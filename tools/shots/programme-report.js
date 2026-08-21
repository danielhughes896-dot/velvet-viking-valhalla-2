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
  [['RACE GOAL', 'race', 'half', 12], ['MAINTAIN & PROTECT', 'maintain', 'half', 8],
   ['AEROBIC BASE', 'base', 'half', 10], ['SPEED & THRESHOLD', 'speed', '5k', 6],
   ['RECOVERY', 'recovery', 'half', 2]].forEach(([label, p, d, n]) => {
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
hdr('19. MULTI-YEAR SIMULATION — does volume converge?');
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
