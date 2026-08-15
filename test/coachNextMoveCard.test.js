'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// renderCoachNextMoveCard() is the NEXT MOVE card: while an adjustment is
// awaiting the athlete's decision it must offer both Accept Adjustment and
// Keep Original; once either is chosen and persisted, the card must settle
// -- both controls gone, no standing offer left dangling on screen (RC2.1
// fix -- previously an accepted adjustment left a permanent "Restore
// Original" button, which read as an unresolved decision forever).

function fillNormally(app, dd) {
  const target = app.executionPaceTarget(dd);
  const band = app.expectedRPEBand(dd);
  const zone = app.executionHRTarget(dd);
  dd.completed = true;
  dd.actual = {
    km: dd.km,
    pace: target ? app.secToPace((target.slow + target.fast) / 2) : null,
    hr: zone && zone.lo != null ? Math.round((zone.lo + (zone.hi != null ? zone.hi : zone.lo + 20)) / 2) : null,
    rpe: band ? Math.round((band[0] + band[1]) / 2) : null,
    notes: '',
  };
}

// Builds a plan with a logged pain note on a recent day, which is enough
// (per coachNoticed()) to raise the soreness cue that gives the next quality
// session a pending "swap to easy" proposal -- mirrors the scenario in
// test/coachDecision.test.js.
function buildPendingScenario(app) {
  const startDate = app.addDays(app.todayStr(), -10);
  const { days } = buildPlan(app, { startDate });
  const today = app.todayStr();
  const sorted = days.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  // coachNextSession() picks the very next not-completed, non-rest day, so
  // to land the pending proposal on a quality day (MODIFY-style adjustments
  // only ever apply to quality sessions), complete everything up to today
  // plus any easy/long days after it, and stop right before the first
  // upcoming quality day -- leaving that one as the next pending session.
  let noted = false;
  let nextQuality = null;
  for (const dd of sorted) {
    if (dd.type === 'rest') continue;
    if (dd.date <= today || app.isRecoveryWorkoutType(dd.type)) {
      fillNormally(app, dd);
      if (!noted) { dd.actual.notes = 'sharp pain in my calf, had to slow down'; noted = true; }
    } else {
      nextQuality = dd;
      break;
    }
  }
  assert.ok(nextQuality, 'fixture needs an upcoming quality day for this scenario to be meaningful');
  assert.ok(noted, 'fixture needs at least one completed day to carry the pain note');
  return { days, nextQuality };
}

test('renderCoachNextMoveCard: pending proposal shows both Accept and Keep controls', () => {
  const app = loadApp();
  const { nextQuality } = buildPendingScenario(app);
  const report = app.coachAnalyse();
  assert.ok(report && report.nextMove, 'report must resolve a next move');
  assert.equal(report.nextMove.dayId, nextQuality.id, 'the pending proposal must target the upcoming quality day');
  assert.ok(report.nextMove.adjustment, 'a soreness cue ahead of a quality session must produce a pending adjustment');

  const html = app.renderCoachNextMoveCard(report);
  assert.match(html, /data-action="coach-accept"/, 'Accept control must be present while pending');
  assert.match(html, /data-action="coach-keep"/, 'Keep/decline control must be present while pending');
  assert.doesNotMatch(html, /data-action="coach-restore"/, 'no settled-state control while still pending');
  assert.match(html, /Pending Decision/, 'pending state must be visually flagged as such');
});

test('renderCoachNextMoveCard: Accept Adjustment persists the decision and removes both controls', () => {
  const app = loadApp();
  const { nextQuality } = buildPendingScenario(app);
  const before = app.coachAnalyse();
  assert.ok(before.nextMove.adjustment, 'fixture must actually offer an adjustment before accepting it');

  app.handleCoachAccept(nextQuality.id);
  const dd = app.findDay(nextQuality.id);
  assert.ok(dd.coachAdjust, 'accepting must persist the decision onto the day via the existing coachAdjust record');
  assert.ok(dd.coachAdjust.from, 'the pre-adjustment workout must be recorded for reversibility');

  const after = app.coachAnalyse();
  const html = app.renderCoachNextMoveCard(after);
  assert.doesNotMatch(html, /data-action="coach-accept"/, 'Accept control must be gone once decided');
  assert.doesNotMatch(html, /data-action="coach-keep"/, 'Keep control must be gone once decided');
  assert.doesNotMatch(html, /data-action="coach-restore"/, 'no standing Restore control after the decision is settled');
  assert.doesNotMatch(html, /Pending Decision/, 'card must no longer read as pending');
  assert.match(html, /Settled/, 'settled state must be visually flagged as such');
});

test('renderCoachNextMoveCard: Keep Original (restore/decline) persists the decision and removes both controls', () => {
  const app = loadApp();
  const { nextQuality } = buildPendingScenario(app);
  const before = app.coachAnalyse();
  assert.ok(before.nextMove.adjustment, 'fixture must actually offer an adjustment before declining it');

  app.handleCoachKeep(nextQuality.id);
  const dd = app.findDay(nextQuality.id);
  assert.ok(dd.coachKeptAt, 'keeping the original must persist the decision via the existing coachKeptAt record');
  assert.ok(!dd.coachAdjust, 'declining must never apply the adjustment to the workout itself');

  const after = app.coachAnalyse();
  const html = app.renderCoachNextMoveCard(after);
  assert.doesNotMatch(html, /data-action="coach-accept"/, 'Accept control must be gone once decided');
  assert.doesNotMatch(html, /data-action="coach-keep"/, 'Keep control must be gone once decided');
  assert.doesNotMatch(html, /data-action="coach-restore"/, 'no standing Restore control after the decision is settled');
  assert.doesNotMatch(html, /Pending Decision/, 'card must no longer read as pending');
  assert.match(html, /Settled/, 'settled state must be visually flagged as such');
});

test('renderCoachNextMoveCard: a settled decision stays settled after rerender and a simulated reload', () => {
  const app = loadApp();
  const { nextQuality } = buildPendingScenario(app);
  app.handleCoachAccept(nextQuality.id);

  // Rerender: a second independent coachAnalyse()+render pass, exactly as a
  // later paint of the same screen would do.
  const rerendered = app.renderCoachNextMoveCard(app.coachAnalyse());
  assert.doesNotMatch(rerendered, /data-action="coach-accept"/);
  assert.doesNotMatch(rerendered, /data-action="coach-keep"/);
  assert.doesNotMatch(rerendered, /data-action="coach-restore"/);

  // Reload: persist to (stubbed) localStorage and load a fresh state object
  // back from it, the way a relaunch of the app would.
  app.flushSave();
  app.loadState();
  const reloadedDay = app.findDay(nextQuality.id);
  assert.ok(reloadedDay.coachAdjust, 'the accepted decision must survive a save/load round trip');

  const afterReload = app.renderCoachNextMoveCard(app.coachAnalyse());
  assert.doesNotMatch(afterReload, /data-action="coach-accept"/, 'still no Accept control after reload');
  assert.doesNotMatch(afterReload, /data-action="coach-keep"/, 'still no Keep control after reload');
  assert.doesNotMatch(afterReload, /data-action="coach-restore"/, 'still no Restore control after reload');
  assert.match(afterReload, /Settled/, 'still reads as settled after reload');
});
