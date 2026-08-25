'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 9, finding B3). evolutionChanges()'s
// last-resort ADAPT/RECOVER step can shorten the biggest KEY session (kind:
// 'reduce') when nothing else in the horizon is available to trim. But
// planEvolution()'s protectedSessions filter only excluded a day whose change
// was 'downgrade' or 'drop' -- 'reduce' was not excluded -- so that same KEY
// session could be listed as "Protected" in the very proposal that reduced
// it, directly contradicting what "Protected" is supposed to mean.
//
// THE FIX. The filter now excludes ANY dayId present in `changes`, regardless
// of kind.

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

test('a KEY session reduced by the last-resort ADAPT step is never also listed as Protected', () => {
  // Pinned so the generated schedule reliably lands a KEY-typed (threshold/
  // interval) day inside the 7-day evolution horizon, strictly after today.
  const app = loadApp({ pinnedDate: '2026-06-03T09:00:00Z' });
  const startDate = app.addDays(app.todayStr(), -10);
  const { days } = buildPlan(app, { lthr: 172, maxHR: 188, weeks: 12, startDate });
  const today = app.todayStr();

  days.filter((d) => d.date <= today && d.type !== 'rest').forEach((dd) => fillNormally(app, dd));

  // Corroborated strain, same recipe coachDecision.test.js uses to reach MODIFY.
  const last7 = days.filter((d) => d.date <= today && d.date >= app.addDays(today, -6) && d.type !== 'rest');
  const overBandDay = last7.find((d) => d.type === 'interval' || d.type === 'threshold' || d.type === 'tempo') || last7[0];
  const band = app.expectedRPEBand(overBandDay);
  const zone1 = app.executionHRTarget(overBandDay);
  overBandDay.actual.rpe = band[1] + 2;
  overBandDay.actual.hr = (zone1.hi != null ? zone1.hi : zone1.lo + 20) + 15;
  const secondHrDay = last7.find((d) => d.id !== overBandDay.id && d.type === 'easy') || last7[1];
  const zone2 = app.executionHRTarget(secondHrDay);
  secondHrDay.actual.hr = (zone2.hi != null ? zone2.hi : zone2.lo + 20) + 15;

  assert.equal(app.coachRecovery().state, 'strained', 'sanity: fixture must reach strained');

  // threshold/interval/repetition are KEY by sessionImportance(); tempo is
  // only SUPPORT, so it is deliberately excluded here. Must also fall inside
  // evolutionHorizon()'s window (today .. today+EVOLUTION_HORIZON_DAYS-1) or
  // planEvolution() will never see it as an open candidate at all.
  const horizonEnd = app.addDays(today, app.EVOLUTION_HORIZON_DAYS - 1);
  const nextQuality = days.find((d) => d.date > today && d.date <= horizonEnd &&
    (d.type === 'interval' || d.type === 'threshold'));
  assert.ok(nextQuality, 'fixture needs an upcoming KEY-typed quality day inside the evolution horizon');

  // Complete EVERY other day in the evolution horizon, so the only OPEN
  // (non-rest, non-completed) day left for evolutionChanges to work with is
  // nextQuality itself -- forcing the last-resort "shorten the biggest KEY
  // session" step rather than trimming something optional.
  days.filter((d) => d.date > today && d.date <= horizonEnd && d.id !== nextQuality.id && d.type !== 'rest')
    .forEach((dd) => fillNormally(app, dd));

  const dec = app.coachDecision();
  assert.equal(dec.state, 'modify', 'sanity: the fixture must actually reach MODIFY');
  assert.equal(dec.dayId, nextQuality.id, 'sanity: the decision must be about the KEY session under test');
  assert.equal(app.sessionImportance(nextQuality), 'KEY', 'sanity: this must be a genuine KEY session');

  const ev = app.planEvolution();
  assert.equal(ev.state, 'ADAPT');
  const reducedIds = ev.changes.filter((c) => c.dayId === nextQuality.id);
  assert.equal(reducedIds.length, 1, 'sanity: the KEY session must actually be the one reduced');
  assert.equal(reducedIds[0].kind, 'reduce');

  const stillListedProtected = ev.protectedSessions.some((p) => p.dayId === nextQuality.id);
  assert.equal(stillListedProtected, false,
    'a session present in changes[] must never also appear in protectedSessions[], regardless of kind');
});
