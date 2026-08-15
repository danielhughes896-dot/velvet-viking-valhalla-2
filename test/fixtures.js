'use strict';
// Builds a real plan through the app's own generator functions, mirroring
// handleGeneratePlan() minus the DOM reads, so tests exercise the same
// prescription/pace-zone machinery the app itself relies on rather than a
// hand-rolled shape that could silently diverge from it.
function buildPlan(app, opts) {
  opts = opts || {};
  const distanceKey = opts.distanceKey || '10k';
  const volume = opts.volume != null ? opts.volume : 40;
  const weeks = opts.weeks || 10;
  const schedule = opts.schedule || { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }; // Tue/Wed/Thu/Sat/Sun
  const startDate = opts.startDate || app.todayStr();
  const benchSec = opts.benchSec != null ? opts.benchSec : app.clockToSec('0:45:00'); // 10K in 45:00
  const hasEvent = false;

  const startMonday = app.addDays(startDate, -app.isoWeekday(startDate));
  const raceDate = app.addDays(startMonday, weeks * 7 - 1);

  const blockResult = app.buildBlockWeeks(distanceKey, volume, weeks);
  const days = app.buildDaysFromWeeks(blockResult, raceDate, schedule, startDate, hasEvent);

  app.state = app.makeDefaultState();
  app.state.setup = {
    distanceKey: distanceKey, currentVolume: volume, raceDate: raceDate, hasEvent: hasEvent,
    startDate: startDate, planWeeks: blockResult.planWeeks, schedule: schedule,
    benchmark: { distanceKey: '10k', timeSec: benchSec },
    goals: { A: { timeSec: Math.round(benchSec * 0.95) } }, activeGoal: 'A',
    paceOverrides: {}, lthr: opts.lthr || null, maxHR: opts.maxHR || null,
    experience: 'experienced',
  };
  app.state.days = days;
  return { app, blockResult, days };
}

module.exports = { buildPlan };
