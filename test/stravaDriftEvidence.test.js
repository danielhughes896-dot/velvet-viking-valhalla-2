'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 WORKSTREAM 2 -- U. STRAVA COMPLETION DRIFT, and the Execution Score
// boundary WS1 deliberately left narrow.
//
// THE DRIFT. stravaWriteActivity() calls applyCompletion() and then stamps the
// attachment regardless of what applyCompletion decided. applyCompletion
// refuses a future-dated day, so a run recorded just past midnight lands with
// the attachment and the actuals written and `completed` still false.
//
// WS1 fixed the two places that read that state wrongly. This file pins those,
// and then asks the question WS1 deferred: should a drifted day be SCORED?
//
// THE VERDICT IS KEEP NARROW, and it rests on a fact this file proves rather
// than assumes: the drift is transient and the app already heals it. The same
// activity arriving on any later sync -- and fetchStravaRuns(180) runs on every
// resume -- calls applyCompletion() again, by which time the day is in the
// past, and it succeeds. The score appears on its own.
//
// So widening would trade a briefly-absent score for two permanent costs: a
// second definition of "scored" alongside the confirmed one, and a mechanism by
// which a first Strava connect could inject months of retrospective scores into
// the evidence the coach has already reasoned from.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });

/* The exact state the Strava path leaves behind. Nothing is hand-forged that
   the app does not itself write. */
function drifted(a, opts) {
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  /* THE LAST WEEK, not the last four days. A week is the period a quality
     exposure is prescribed in, so it is the window that reliably contains one;
     four days only did while every five-day schedule carried two hard sessions
     by day count. The day this returns is still the most recent quality
     session, which is all the drift path needs. */
  const dd = a.state.days.filter(d =>
    d.date < TODAY && d.date >= a.addDays(TODAY, -7) &&
    d.type !== 'rest' && a.isQualityType(d.type)).pop();
  assert.ok(dd, 'the fixture needs a recent quality day');
  dd.completed = false;
  dd.stravaActivityId = '99887766';
  dd.actual = Object.assign(a.emptyActual(), {
    km: dd.km, pace: '4:40', hr: 152, movingTimeSec: 2400, activityType: 'Run'
  }, (opts && opts.actual) || {});
  return dd;
}
const activityFor = dd => ({ activityId: '99887766', date: dd.date, isRun: true,
  km: dd.km, paceSecPerKm: 280, hr: 152, movingTimeSec: 2400, activityType: 'Run' });

// ---------------------------------------------------------------------------
// U. THE FOUR THINGS THAT MUST BE TRUE DURING THE DRIFT
// ---------------------------------------------------------------------------
test('U. the day does not read as Missed', () => {
  const a = app();
  const dd = drifted(a);
  assert.equal(a.sessionRan(dd), true);
  assert.ok(!/Missed/.test(a.dayStatusLabel(dd)));
});

test('U. missed stimulus does not try to recover it', () => {
  const a = app();
  const dd = drifted(a);
  assert.ok(!a.missedStimulus().some(m => m.dayId === dd.id));
});

test('U. the evidence record admits it as performed', () => {
  const a = app();
  const dd = drifted(a);
  const rec = a.athleteMemory(120).filter(r => r.date === dd.date)[0];
  assert.ok(rec);
  assert.equal(rec.completed, true);
  assert.equal(rec.actualKm, dd.actual.km);
  assert.ok(rec.actualPace != null);
});

test('U. Plan Evolution does not propose re-running it', () => {
  const a = app();
  const dd = drifted(a);
  const ev = a.planEvolution();
  (ev.changes || []).forEach(c => {
    assert.notEqual(c.dayId, dd.id);
    assert.notEqual(c.sourceDayId, dd.id);
  });
});

test('U. and its objective numbers reach the baselines they belong in', () => {
  const a = app();
  const dd = drifted(a);
  const b = a.baselineFor(a.athleteMemory(120).filter(r => r.date === dd.date));
  assert.equal(b.completionRate, 100, 'counting a real run as a miss is a wrong number about the athlete');
  assert.equal(b.sessions, 1);
});

// ---------------------------------------------------------------------------
// THE EXECUTION SCORE VERDICT: KEEP NARROW
// ---------------------------------------------------------------------------
test('the drift is transient — a later sync heals it and the score appears', () => {
  /* THIS is the fact the verdict rests on. Strava re-sends an activity on
     update, and fetchStravaRuns(180) runs on every resume, so the same
     activity comes back. stravaWriteActivity calls applyCompletion() again and
     the day is now in the past, so it succeeds. */
  const a = app();
  const dd = drifted(a);
  assert.equal(a.computeExecutionScore(dd), null, 'unscored while it drifts');

  const r = a.stravaIngestActivities([activityFor(dd)]);
  assert.equal(r.applied, 1, 'the same activity arriving again is applied, not skipped');

  const healed = a.findDay(dd.id);
  assert.equal(healed.completed, true, 'the canonical completion now succeeds');
  assert.ok(a.computeExecutionScore(healed) != null,
    'and the score arrives through the ordinary path, with no second definition of "scored"');
});

test('and the athlete has a manual route too, so nothing depends on Strava returning', () => {
  const a = app();
  const dd = drifted(a);
  assert.equal(a.canToggleCompletion(dd), false, 'the card tick is today-only, as it always was');
  assert.equal(a.canEditCompletion(dd), true,
    'but Edit Session can confirm any past day, so a drift that never re-syncs is not a trap');
  assert.equal(a.applyCompletion(dd, true), true);
  assert.ok(a.computeExecutionScore(dd) != null);
});

test('scoring still requires enough real data, not merely a completion flag', () => {
  /* The reason widening looked tempting is that a drifted day HAS good data.
     The reason it is unnecessary is that the score gate is not really about
     the flag -- computeExecutionBreakdown refuses without distance AND pace,
     whatever any flag says. */
  const a = app();
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28) });
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').pop();
  dd.completed = true;
  dd.actual = Object.assign(a.emptyActual(), { km: dd.km });          // no pace
  assert.equal(a.computeExecutionScore(dd), null,
    'a score cannot be fabricated from insufficient data even when confirmed');
  dd.actual.pace = '5:10';
  assert.ok(a.computeExecutionScore(dd) != null);
});

test('KEEP NARROW: completion is the confirmation boundary, sessionRan is the performance boundary', () => {
  const a = app();
  const dd = drifted(a);
  assert.equal(a.sessionRan(dd), true, 'it happened');
  assert.equal(a.computeExecutionScore(dd), null, 'it is not yet confirmed');
  assert.ok(!a.coachCompletedScored().some(d => d.id === dd.id),
    'so it is not yet coaching evidence — the two boundaries are different questions');
});

test('a drifted day cannot reach the Playbook, the trend or the block read', () => {
  const a = app();
  const dd = drifted(a);
  assert.ok(!a.coachCompletedScored().some(d => d.id === dd.id));
  const scored = a.coachCompletedScored();
  scored.forEach(d => assert.equal(d.completed, true,
    'everything the coach learns from is a session the athlete confirmed'));
});

test('widening would let one sync rewrite months of evidence — the cost being avoided', () => {
  /* fetchStravaRuns(180) pulls a 180-day window. If every attached-but-
     unconfirmed day were scored on sight, a first connect would inject a
     season of retrospective scores into baselines the coach had already
     reasoned from, and yesterday's decision would silently have been made on
     different evidence. Demonstrated rather than argued: many old days, all
     drifted, none of them evidence. */
  const a = app();
  buildPlan(a, { weeks: 20, startDate: a.addDays(TODAY, -120) });
  const old = a.state.days.filter(d => d.date < a.addDays(TODAY, -30) && d.type !== 'rest');
  assert.ok(old.length > 10, 'a realistic import window');
  old.forEach((d, i) => {
    d.completed = false;
    d.stravaActivityId = 'old-' + i;
    d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '5:00', hr: 150 });
  });
  assert.equal(a.coachCompletedScored().length, 0,
    'a bulk import is not a hundred coaching decisions the athlete never made');
});

test('the narrow gate is stated where a future reader will find it', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const at = src.indexOf('function computeExecutionBreakdown(');
  const preamble = src.slice(Math.max(0, at - 2800), at);   // the reasoning is long, deliberately
  assert.match(preamble, /confirmation boundary/i,
    'an unexplained narrow gate is one a future pass widens for neatness');
  assert.match(preamble, /sessionRan/);
});

// ---------------------------------------------------------------------------
// THE DRIFT DOES NOT CHANGE A DECISION THAT WAS ALREADY MADE
// ---------------------------------------------------------------------------
test('healing a drifted day does not retroactively rewrite an accepted adjustment', () => {
  const a = app();
  const dd = drifted(a);
  const other = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest')[0];
  other.coachAdjust = { at: '2026-05-19T10:00:00Z', reason: 'settled', source: 'evolution',
                        from: { km: other.km, type: other.type } };
  const before = JSON.stringify(other);
  a.stravaIngestActivities([activityFor(dd)]);
  assert.equal(JSON.stringify(a.findDay(other.id)), before,
    'a decision the athlete already accepted is history, not a thing to recompute');
});

test('a date correction moves the session, not the athlete\'s answers', () => {
  const a = app();
  const dd = drifted(a);
  dd.readiness = { legs: 'heavy' };
  const readinessBefore = JSON.stringify(dd.readiness);
  a.stravaIngestActivities([activityFor(dd)]);
  assert.equal(JSON.stringify(a.findDay(dd.id).readiness), readinessBefore,
    'readiness belongs to the date it was given about');
});
