'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 23, finding A -- the most
// severe finding in that audit). Next Move could show a green "Proceed"
// pill (from coachDecision()) while its own body, in the same breath,
// proposed a soreness-driven session downgrade with Accept/Decline controls
// (from coachNextMove(), via coachNoticed()'s wider note-reading window).
//
// ROOT CAUSE. coachDecision()'s pain evidence only ever looked at the last 4
// COMPLETED sessions (coachRecentSessions(4)). coachNoticed() -- and so
// coachNextMove()'s painCue and the adjustment box in
// renderCoachNextMoveCard() -- reads a 27-day window and fires on a single
// mention. A pain note more than 4 sessions old but inside 27 days was
// still live to the second engine and invisible to the first: the pill (dec)
// said "proceed", the card body (mv, unconditionally) proposed a swap.
//
// THE FIX. coachPainMentionCount() gives coachDecision() the same 27-day
// pain reading coachNoticed() already had, so a pain report can no longer be
// invisible to the pill while still driving the body. And
// renderCoachNextMoveCard() now only offers the adjustment box when the
// RECONCILED decision (dec.state) itself says modify/recover -- never under
// proceed or check -- so even evidence dec rates as merely "worth watching"
// no longer produces a standing Accept/Decline offer that contradicts it.

function fillClean(app, dd) {
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

// A pain note ~20 days old, then many clean sessions since -- old enough
// that coachRecentSessions(4) (the last 4 COMPLETED sessions) no longer
// includes it, but well inside coachNoticed()'s 27-day window.
function buildAgedPainScenario(app) {
  const today = app.todayStr();
  const startDate = app.addDays(today, -35);
  const { days } = buildPlan(app, { startDate, weeks: 10 });
  const sorted = days.slice().sort((a, b) => (a.date < b.date ? -1 : 1));
  const oldNoteDate = app.addDays(today, -20);
  let noted = false;
  let nextQuality = null;
  for (const dd of sorted) {
    if (dd.type === 'rest') continue;
    if (dd.date <= today) {
      fillClean(app, dd);
      if (dd.date >= oldNoteDate && !noted) {
        dd.actual.notes = 'calf a little sore today but fine to keep going';
        noted = true;
      }
    } else if (!nextQuality && !app.isRecoveryWorkoutType(dd.type)) {
      nextQuality = dd;
    }
  }
  assert.ok(noted, 'fixture needs the aged pain note logged');
  assert.ok(nextQuality, 'fixture needs an upcoming quality day');
  // Sanity: the pain note really is outside the narrow 4-session window this
  // defect used to rely on.
  const recent4 = app.coachRecentSessions(4);
  assert.ok(!recent4.some((d) => d.actual && /sore/.test(d.actual.notes || '')),
    'sanity: the aged pain note must already be outside the last-4-sessions window');
  return { nextQuality };
}

test('an aged (>4-session) pain note is no longer invisible to the pill: dec.state escapes "proceed"', () => {
  const app = loadApp();
  buildAgedPainScenario(app);
  const dec = app.coachDecision();
  assert.ok(dec, 'sanity: a decision must exist');
  assert.notEqual(dec.state, 'proceed',
    'a pain report coachNoticed() still knows about must not be invisible to the decision engine');
});

test('Next Move card: PROCEED can never coexist with a downgrade/swap adjustment box', () => {
  const app = loadApp();
  buildAgedPainScenario(app);
  const report = app.coachAnalyse();
  assert.ok(report && report.decision, 'sanity: a report with a decision must exist');
  const html = app.renderCoachNextMoveCard(report);
  const pillIsProceed = /coach-state proceed/.test(html);
  const hasAdjustmentBox = /coach-adjust\b/.test(html) && /Pending Decision/.test(html);
  assert.ok(!(pillIsProceed && hasAdjustmentBox),
    'PROCEED pill and a pending adjustment box must never render on the same card');
});

test('Next Move card: the headline sentence and the pill are always sourced from the same decision', () => {
  const app = loadApp();
  buildAgedPainScenario(app);
  const report = app.coachAnalyse();
  const html = app.renderCoachNextMoveCard(report);
  if (/coach-state proceed/.test(html)) {
    assert.doesNotMatch(html, /mention(s|ed)? soreness/i,
      'a Proceed pill must not sit above a sentence about reported soreness');
  }
});

test('adjustment box only appears when the reconciled decision itself calls for one (modify/recover)', () => {
  const app = loadApp();
  buildAgedPainScenario(app);
  const report = app.coachAnalyse();
  const html = app.renderCoachNextMoveCard(report);
  const hasBox = /Pending Decision/.test(html);
  if (hasBox) {
    assert.ok(report.decision && (report.decision.state === 'modify' || report.decision.state === 'recover'),
      'a rendered adjustment box must correspond to a modify/recover decision, not a lower one');
  }
});

test('a single old pain mention alone is not escalated past "check" (conservative pain/illness behaviour preserved)', () => {
  const app = loadApp();
  buildAgedPainScenario(app);
  const dec = app.coachDecision();
  // One corroborated-nowhere-else pain mention, nothing acute this week: the
  // reconciliation must not manufacture a false "recover"/"modify" escalation
  // out of a single old, mild, self-described "fine to keep going" note.
  assert.ok(dec.state === 'check' || dec.state === 'proceed',
    'a single isolated old pain mention alone must stay at check/proceed, not escalate to modify/recover');
});

test('coachPainMentionCount(): counts pain-flagged notes across the 27-day window, same as coachNoticed()', () => {
  const app = loadApp();
  const { nextQuality } = buildAgedPainScenario(app);
  const count = app.coachPainMentionCount();
  assert.equal(count, 1);
  const noticed = app.coachNoticed();
  const painEntry = noticed.find((n) => /soreness or a niggle/.test(n.text));
  assert.ok(painEntry, 'sanity: coachNoticed() still reports the same pain mention');
  assert.match(painEntry.text, /in 1 session\./);
});

test('strong, current, safety-tier pain evidence (2+ recent sessions) still reaches "recover" as before', () => {
  const app = loadApp();
  const startDate = app.addDays(app.todayStr(), -10);
  buildPlan(app, { startDate });
  const today = app.todayStr();
  const sorted = app.state.days.filter((d) => d.type !== 'rest' && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  sorted.forEach((dd) => fillClean(app, dd));
  // Pain reported on the two MOST RECENT completed sessions, so they are
  // still inside coachRecentSessions(4) -- the safety branch this test
  // guards must still fire from its own original (narrow-window) evidence,
  // unaffected by the wider fallback added for the aged-out case above.
  sorted.slice(-2).forEach((dd) => { dd.actual.notes = 'sharp pain in my calf, had to slow down'; });
  const dec = app.coachDecision();
  assert.equal(dec.state, 'recover', 'unchanged: 2+ recent pain reports must still force recover');
});
