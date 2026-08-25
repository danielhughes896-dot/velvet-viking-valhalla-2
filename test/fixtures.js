'use strict';
// Builds a real plan through the app's own generator functions, mirroring
// handleGeneratePlan() minus the DOM reads, so tests exercise the same
// prescription/pace-zone machinery the app itself relies on rather than a
// hand-rolled shape that could silently diverge from it.
/* What this athlete could run at the plan's distance, given a 10K benchmark.
   Uses the app's own VDOT equivalence rather than a ratio invented here, so a
   fixture athlete is always a physiologically coherent one. */
function goalTimeFor(app, distanceKey, benchSec) {
  const vdot = app.vdotFromPerformance(10000, benchSec);
  const raceM = app.DISTANCE_PROFILES[distanceKey].raceKm * 1000;
  return Math.round(app.equivalentTimeSec(vdot, raceM) * 0.97);
}

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
    /* THE GOAL IS FOR THE PLAN'S OWN DISTANCE, and it was not.
       getActiveVDOT() reads the active goal against state.setup.distanceKey, so
       a goal of "95% of the 10K benchmark" on a HALF MARATHON plan asked the
       app to rate a 42:45 half. It obliged: VDOT 121.7, against about 85 for a
       world-record holder, and every pace zone in the fixture came out at
       roughly half of a real one -- threshold at 2:03/km. Structural tests were
       unaffected, but nothing about pace, execution score or target ranges
       could be trusted, and the screenshots showed the impossible numbers.
       The goal is now the equivalent performance at the plan's distance, from
       the app's own equivalence table, sharpened by 3%. */
    goals: { A: { timeSec: goalTimeFor(app, distanceKey, benchSec) } }, activeGoal: 'A',
    paceOverrides: {}, lthr: opts.lthr || null, maxHR: opts.maxHR || null,
    // Consistent with every other opts-driven field above: a caller MAY
    // pass opts.experience (novice/experienced/advanced) and have it
    // actually take effect, rather than needing the two-step
    // buildPlan()-then-mutate-state.setup.experience pattern several other
    // test files already use around this exact gap.
    experience: opts.experience || 'experienced',
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

/* A SESSION LOGGED THE WAY THE APP ASKED FOR IT.
 *
 * Written because the audit's "does success language escalate" run was
 * invalid: it logged every session at a single hand-picked pace, and a fixed
 * 4:45/km is a good easy run, a mediocre threshold and a hopeless 8x1200m.
 * Every quality session in that fixture scored below the poor-execution bar,
 * so the run measured the fixture rather than the app, and the honest answer
 * to "what does Valhalla say to an athlete who is going well" was: unknown.
 *
 * This asks the app what it wanted -- the day's own execution pace target and
 * its own expected effort band -- and logs the middle of both. `quality`
 * shifts the result: 1 is textbook, and lower values place the session
 * progressively outside the window on the slow side and short of the
 * distance, which is how a real athlete falls short.
 */
function logAsPrescribed(app, dd, opts) {
  const o = opts || {};
  const q = o.quality != null ? o.quality : 1;
  const range = app.executionPaceTarget(dd) || app.getTargetPaceRangeSecPerKm(dd);
  let sec = null;
  if (range && range.slow != null && range.fast != null) {
    sec = Math.round((range.slow + range.fast) / 2);
    // Below 1, run progressively slower than the easy bound of the window.
    if (q < 1) sec = Math.round(range.slow * (1 + (1 - q) * 0.5));
  }
  const band = app.expectedRPEBand(dd) || [5, 7];
  const rpe = q >= 1 ? Math.round((band[0] + band[1]) / 2)
                     : Math.min(10, band[1] + Math.round((1 - q) * 4));
  dd.completed = true;
  dd.actual = Object.assign(app.emptyActual(), {
    km: Math.round(dd.km * (q >= 1 ? 1 : q) * 10) / 10,
    pace: sec != null ? app.secToClock(sec) : null,
    paceUnit: 'km',
    rpe: rpe,
  }, o.extra || {});
  delete dd.coachReview;
  try { app.coachPersistReview(dd); } catch (e) {}
  return dd;
}

module.exports = { buildPlan, logAsPrescribed };
