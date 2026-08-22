'use strict';
/* THE GROWTH LADDER, STEP BY STEP.
 *
 *   node tools/shots/growth-ladder.js [years]
 *
 * VOLUME_BLOCK_GROWTH_CAP is the only place block-to-block growth enters, and
 * a simulation summary hides what it does. This prints every block boundary of
 * a perfectly-executing athlete's real lifecycle and, at each one, the three
 * candidate answers and which of them actually bound:
 *
 *   REASON      anchor x 1.10 when progression is earned, anchor when it is not
 *   PERMISSION  demonstrated sustainable volume x 1.10
 *   LIMIT       the backstop ceiling
 *
 * Deterministic. The athlete runs every prescribed session at the middle of
 * its own window, which is the most favourable case the rule can face.
 */
const path = require('path');
const { loadApp, makePinnedDate } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const YEARS = parseInt(process.argv[2] || '5', 10);
/* Six running days rather than five when invoked with `6`. The convergence in
   the five-day trace is partly held up by the generator's own distribution
   limit -- five days and a 20km long-run cap cannot hold much past 78km/week --
   so the rule has to be shown converging when that limit is loosened, or the
   convergence is an artefact of the schedule rather than a property of the
   rule. */
const DAYS = parseInt(process.argv[3] || '5', 10);
const SCHEDULE = DAYS >= 6 ? { activeDays: [0, 1, 2, 3, 4, 5], longRunDay: 5 }
                           : { activeDays: [0, 1, 2, 4, 5], longRunDay: 5 };
const CYCLE = [['race', 12], ['recovery', 2], ['maintain', 8], ['base', 10], ['speed', 6]];
const DIST = 'half', START = 50;

function goalTimeFor(a, dk, benchSec){
  const vdot = a.vdotFromPerformance(10000, benchSec);
  return Math.round(a.equivalentTimeSec(vdot, a.DISTANCE_PROFILES[dk].raceKm * 1000) * 0.97);
}
function startRaceBlock(a, dk, volume, weeks, startDate, stepped){
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const raceDate = a.addDays(startMonday, weeks * 7 - 1);
  const br = a.buildBlockWeeks(dk, volume, weeks, { purpose: 'race' });
  const days = a.buildDaysFromWeeks(br, raceDate, SCHEDULE, startDate, false);
  const prev = a.state.setup && a.state.setup.blockId;
  if (prev){ a.archiveCompletedSessions(prev); a.closeBlock(prev, { reason: 'transition', to: 'race' }); }
  const block = a.openBlock({ purpose: 'race', startDate, distanceKey: dk, goalDate: raceDate,
    hasEvent: false, startVolume: volume, peakVolume: a.largestScheduledWeek(days),
    anchorVolume: volume, progressionStep: !!stepped });
  const bench = (a.state.setup && a.state.setup.benchmark) || { distanceKey: '10k', timeSec: 45 * 60 };
  a.state.setup = { distanceKey: dk, currentVolume: volume, raceDate, hasEvent: false, startDate,
    planWeeks: br.planWeeks, schedule: SCHEDULE, blockId: block.id, purpose: 'race', benchmark: bench,
    goals: { A: { timeSec: goalTimeFor(a, dk, bench.timeSec) } }, activeGoal: 'A',
    paceOverrides: {}, lthr: null, maxHR: null, experience: 'experienced' };
  a.state.days = days;
  return br;
}

let today = '2026-01-05';
const a = loadApp({ pinnedDate: today + 'T09:00:00Z' });
a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
a.state.setup = { distanceKey: DIST, currentVolume: START, schedule: SCHEDULE,
                  benchmark: { distanceKey: '10k', timeSec: 45 * 60 } };

const r1 = x => (x == null ? null : Math.round(x * 10) / 10);
console.log('');
console.log('PERFECT EXECUTION, ' + DIST + ', starting at ' + START + 'km/week, ' + SCHEDULE.activeDays.length + ' running days');
console.log('VOLUME_BLOCK_GROWTH_CAP = ' + a.VOLUME_BLOCK_GROWTH_CAP +
            '   PEAK_OVER_DEMONSTRATED = ' + a.PEAK_OVER_DEMONSTRATED +
            '   backstop = ' + a.PROFILE_CEILING_KM[DIST]);
console.log('');
console.log('yr block      anchor  reason              reason=  permit=  limit=   START   BOUND BY      peak  peakBoundBy');

let cycleStart = null;
for (let y = 0; y < YEARS; y++){
  for (const [purpose, weeks] of CYCLE){
    const dk = purpose === 'speed' ? '5k' : DIST;
    const just = a.progressionJustification();
    const anchor = a.previousBlockAnchorVolume();
    const dem = a.demonstratedSustainableVolume();
    const ceil = a.volumeCeilingFor(dk);
    const absorbed = a.absorbedWeeklyVolume().km;
    // the three candidates, recomputed here so the winner is attributable
    const cReason = anchor > 0 ? (just.earned ? anchor * a.VOLUME_BLOCK_GROWTH_CAP : anchor) : absorbed;
    const cPermit = dem ? dem * a.VOLUME_BLOCK_GROWTH_CAP : null;
    const level = a.cappedBlockStartVolume(absorbed, dk);
    const near = (x, y2) => x != null && y2 != null && Math.abs(x - y2) < 0.06;
    const boundBy = near(level, cPermit) && !near(level, cReason) ? 'PERMISSION'
                  : near(level, ceil) && !near(level, cReason) ? 'LIMIT'
                  : anchor > 0 ? (just.earned ? 'REASON (step)' : 'REASON (held)')
                  : 'first block';

    let br, prescribed;
    if (purpose === 'race'){
      prescribed = level;
      br = startRaceBlock(a, dk, prescribed, weeks, today, just.earned);
    } else {
      const sp = a.developmentBlockSpec(purpose, { distanceKey: DIST, raceDistanceKey: DIST });
      prescribed = sp && sp.volume;
      if (!a.startDevelopmentBlock(purpose, { distanceKey: DIST, raceDistanceKey: DIST })) continue;
      br = { peakVolume: a.largestScheduledWeek(a.state.days) };
    }
    const scheduledPeak = a.largestScheduledWeek(a.state.days);
    const peakBound = dem && near(scheduledPeak, dem * a.PEAK_OVER_DEMONSTRATED) ? 'dem x 1.30'
                    : scheduledPeak < (prescribed * 1.05) ? 'what the week can hold'
                    : 'purpose multiplier';

    console.log(' ' + (y + 1) + ' ' + purpose.padEnd(10) +
      String(r1(anchor) == null ? '—' : r1(anchor)).padStart(7) + '  ' +
      (just.earned ? 'EARNED' : 'held: ' + (just.blockedBy || '')).padEnd(20) +
      String(r1(cReason)).padStart(7) + String(cPermit == null ? '—' : r1(cPermit)).padStart(9) +
      String(ceil).padStart(8) + String(r1(level)).padStart(8) + '   ' + boundBy.padEnd(14) +
      String(r1(scheduledPeak)).padStart(5) + '  ' + peakBound);

    if (purpose === 'race' && cycleStart == null) cycleStart = level;

    // run the block: every session, at the middle of its own window
    a.state.days.filter(d => d.type !== 'rest')
      .sort((x, y2) => (x.date < y2.date ? -1 : 1))
      .forEach(d => {
        a.Date = makePinnedDate(a.addDays(d.date, 1) + 'T09:00:00Z');
        logAsPrescribed(a, d, { quality: 1 });
      });
    today = a.addDays(a.state.days[a.state.days.length - 1].date, 1);
    a.Date = makePinnedDate(today + 'T09:00:00Z');
  }
  const lvl = a.previousBlockAnchorVolume();
  console.log('   ---- end of year ' + (y + 1) + ': development level ' + r1(lvl) +
    '  (' + (lvl / START >= 1 ? '+' : '') + Math.round((lvl / START - 1) * 100) + '% on the ' +
    START + 'km start)   demonstrated ' + a.demonstratedSustainableVolume());
}
