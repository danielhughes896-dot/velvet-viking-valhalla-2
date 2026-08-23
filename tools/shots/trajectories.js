'use strict';
/* FIVE ATHLETES, FIVE YEARS, THROUGH THE REAL BLOCK LIFECYCLE.
 *
 * The previous simulation called buildBlockWeeks() in a loop with no block
 * ledger, no state.days and no logged sessions, so every gate that reads what
 * the athlete actually did was inert and every athlete grew identically. This
 * one runs the cycle the way the app runs it: a real plan is generated, its
 * sessions are logged according to the athlete, the block is archived and
 * closed, and the next block is computed from that record.
 *
 *   node tools/diag/trajectories.js [years]
 */
const path = require('path');
const { loadApp, makePinnedDate } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const YEARS = parseInt(process.argv[2] || '5', 10);
const SCHEDULE = { activeDays: [0, 1, 2, 4, 5], longRunDay: 5 };
const CYCLE = [['race', 12], ['recovery', 2], ['maintain', 8], ['base', 10], ['speed', 6]];

function goalTimeFor(a, distanceKey, benchSec){
  const vdot = a.vdotFromPerformance(10000, benchSec);
  return Math.round(a.equivalentTimeSec(vdot, a.DISTANCE_PROFILES[distanceKey].raceKm * 1000) * 0.97);
}

/* A race block, built the way handleGeneratePlan builds one, minus the DOM. */
function startRaceBlock(a, distanceKey, volume, weeks, startDate, stepped){
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const raceDate = a.addDays(startMonday, weeks * 7 - 1);
  const br = a.buildBlockWeeks(distanceKey, volume, weeks, { purpose: 'race' });
  const days = a.buildDaysFromWeeks(br, raceDate, SCHEDULE, startDate, false);
  const prev = a.state.setup && a.state.setup.blockId;
  if (prev){ a.archiveCompletedSessions(prev); a.closeBlock(prev, { reason: 'transition', to: 'race' }); }
  const block = a.openBlock({ purpose: 'race', startDate, distanceKey, goalDate: raceDate,
                              hasEvent: false, startVolume: volume, peakVolume: a.largestScheduledWeek(days),
                              anchorVolume: volume, progressionStep: !!stepped });
  const bench = (a.state.setup && a.state.setup.benchmark) || { distanceKey: '10k', timeSec: 45 * 60 };
  a.state.setup = { distanceKey, currentVolume: volume, raceDate, hasEvent: false,
    startDate, planWeeks: br.planWeeks, schedule: SCHEDULE, blockId: block.id, purpose: 'race',
    benchmark: bench, goals: { A: { timeSec: goalTimeFor(a, distanceKey, bench.timeSec) } },
    activeGoal: 'A', paceOverrides: {}, lthr: null, maxHR: null, experience: 'experienced' };
  a.state.days = days;
  return { br, block };
}

/* ---- the athletes. Every rule is deterministic and index-based. ---- */
const ATHLETES = {
  'compliant / improving':   { capacity: Infinity, runs: () => true,  quality: () => 1.0 },
  'compliant / stable':      { capacity: v => v,   runs: () => true,  quality: () => 1.0 },
  'compliant / struggling':  { capacity: Infinity, runs: () => true,  quality: () => 0.70 },
  'partially compliant':     { capacity: Infinity, runs: i => i % 3 !== 0, quality: () => 0.95 },
  'returning / low capacity':{ capacity: v => Math.round(v * 0.6), runs: i => i % 4 !== 0, quality: () => 0.85 }
};

function run(name, distKey, startVol){
  const spec = ATHLETES[name];
  const cap = typeof spec.capacity === 'function' ? spec.capacity(startVol) : spec.capacity;
  let today = '2026-01-05';
  const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  a.state.setup = { distanceKey: distKey, currentVolume: startVol, schedule: SCHEDULE,
                    benchmark: { distanceKey: '10k', timeSec: 45 * 60 } };

  const rows = [];
  let vol = startVol;
  for (let y = 0; y < YEARS; y++){
    for (const [purpose, weeks] of CYCLE){
      const dk = purpose === 'speed' ? '5k' : distKey;
      // what the app decided, and why
      const just = a.progressionJustification();
      let br, startVolume;
      if (purpose === 'race'){
        startVolume = a.cappedBlockStartVolume(a.absorbedWeeklyVolume().km || vol, dk);
        br = startRaceBlock(a, dk, startVolume, weeks, today, just.earned).br;
        br = { peakVolume: a.largestScheduledWeek(a.state.days) };
      } else {
        const sp = a.developmentBlockSpec(purpose, { distanceKey: distKey, raceDistanceKey: distKey });
        if (!sp || !sp.volume){ rows.push({ y: y + 1, purpose, skipped: true }); continue; }
        startVolume = sp.volume;
        if (!a.startDevelopmentBlock(purpose, { distanceKey: distKey, raceDistanceKey: distKey })){
          rows.push({ y: y + 1, purpose, skipped: true }); continue;
        }
        br = { peakVolume: a.largestScheduledWeek(a.state.days) };
      }
      // run the block
      const sessions = a.state.days.filter(d => d.type !== 'rest')
                        .sort((x, y2) => (x.date < y2.date ? -1 : 1));
      // capacity is a WEEKLY limit: sessions are dropped from the end of an
      // over-limit week rather than each one being shortened.
      const byWeek = {};
      sessions.forEach(d => { (byWeek[d.week] = byWeek[d.week] || []).push(d); });
      let idx = 0;
      Object.keys(byWeek).forEach(w => {
        let held = 0;
        byWeek[w].forEach(d => {
          const i = idx++;
          if (!spec.runs(i)) return;
          if (held + (d.km || 0) > cap) return;
          held += d.km || 0;
          // The clock must be past the day for applyCompletion to accept it.
          a.Date = makePinnedDate(a.addDays(d.date, 1) + 'T09:00:00Z');
          logAsPrescribed(a, d, { quality: spec.quality(i) });
        });
      });
      const last = a.state.days[a.state.days.length - 1].date;
      today = a.addDays(last, 1);
      a.Date = makePinnedDate(today + 'T09:00:00Z');
      const done = a.state.days.filter(d => d.completed);
      const weeksKm = {};
      done.forEach(d => { weeksKm[d.week] = (weeksKm[d.week] || 0) +
        ((d.actual && d.actual.km != null) ? d.actual.km : d.km); });
      const kms = Object.values(weeksKm).map(x => Math.round(x * 10) / 10);
      rows.push({ y: y + 1, purpose, start: startVolume, peak: a.round1(br.peakVolume),
                  ran: done.length, planned: a.state.days.filter(d => d.type !== 'rest').length,
                  biggest: kms.length ? Math.max.apply(null, kms) : 0,
                  dem: a.demonstratedSustainableVolume(),
                  earned: just.earned, blockedBy: just.blockedBy });
      vol = startVolume;
    }
  }
  return { a, rows };
}

const CASES = [['half', 50]];
Object.keys(ATHLETES).forEach(name => {
  CASES.forEach(([dk, v]) => {
    const { a, rows } = run(name, dk, v);
    console.log('');
    console.log('=== ' + name.toUpperCase() + '  (' + dk + ', ' + v + 'km/wk stated, ' + YEARS + ' years) ===');
    console.log(' yr purpose    start   peak   ran/planned  biggestWk  demonstrated  progression');
    rows.forEach(r => {
      if (r.skipped) return console.log(' ' + r.y + '  ' + r.purpose.padEnd(10) + '   — block not generated —');
      console.log(' ' + r.y + '  ' + r.purpose.padEnd(10) +
        String(r.start).padStart(6) + String(r.peak).padStart(7) +
        String(r.ran + '/' + r.planned).padStart(13) + String(r.biggest).padStart(11) +
        String(r.dem == null ? '—' : r.dem).padStart(14) + '   ' +
        (r.earned ? 'EARNED' : 'held: ' + (r.blockedBy || '—')));
    });
    const peaks = rows.filter(r => !r.skipped).map(r => r.peak);
    console.log('  peak volume year 1 -> year ' + YEARS + ': ' +
      Math.max.apply(null, peaks.slice(0, 5)) + ' -> ' + Math.max.apply(null, peaks.slice(-5)) +
      '   ceiling ' + a.volumeCeilingFor(dk) + '   final demonstrated ' + a.demonstratedSustainableVolume());
  });
});
