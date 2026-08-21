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
  /* HEALTH AND READINESS CONSENT — WHY THE FIXTURE GRANTS IT.
   *
   * Most of this suite is about coaching: what heart rate, feel and the
   * morning readiness answers tell the engine, and what it does about them.
   * Every one of those tests describes an athlete who agreed to Valhalla
   * reading that information, so the fixture says so explicitly instead of
   * leaving it implied. The alternative -- a fixture that silently withholds
   * consent -- would make a hundred coaching tests assert the behaviour of a
   * different athlete than the one they are written about.
   *
   * THIS IS NOT A DEFAULT ANYWHERE ELSE. makeDefaultState() records no
   * consent, loadApp() without buildPlan() records no consent, and a state
   * blob restored from an earlier build records no consent. All three are
   * asserted in test/healthDataConsent.test.js, which builds its
   * non-consenting athletes by passing healthConsent:false here.
   */
  if (opts.healthConsent !== false){
    app.state.healthConsent = {
      version: app.HEALTH_CONSENT_VERSION,
      decision: 'granted',
      decidedAt: '2026-01-01T09:00:00.000Z',
      grantedAt: '2026-01-01T09:00:00.000Z',
      withdrawnAt: null
    };
  }
  return { app, blockResult, days };
}

module.exports = { buildPlan };
