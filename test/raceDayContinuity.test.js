'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makePinnedDate } = require('./harness.js');

// RACE DAY CONTINUITY — Full Plan's permanent "What's next" card and Today's
// post-race Next Move cue, driven through the whole athlete lifecycle:
//
//   A. early/mid block  ->  B. taper  ->  C. race day, outcome pending  ->
//   D/E/F. raced/DNF/DNS  ->  G/H. recovery, active then finishing  ->
//   I. the four directions  ->  J. week numbering stays honest  ->
//   K. imperfect adherence does not break any of it
//
// Both surfaces render REAL engine output (nextBlockRecommendation(),
// raceOutcomePending(), COACH_DECISION_META) at every state past "early/mid
// block" -- nothing here invents a recommendation the engine would not
// itself produce.

const SCHEDULE = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };

/* A real race block, built through the app's own generator (buildBlockWeeks
   + buildDaysFromWeeks) exactly as handleGeneratePlan does it, with the goal
   day computed from the schedule rather than hand-picked -- so it lands as
   the block's own last day, the way a real plan's does. */
function racingBlock(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: '2026-06-01T09:00:00Z' });
  a.showToast = () => {};
  const startDate = a.addDays(a.todayStr(), -(o.back || 70));
  const startMonday = a.addDays(startDate, -a.isoWeekday(startDate));
  const weeks = o.weeks || 12;
  const raceDate = a.addDays(startMonday, weeks * 7 - 1);
  const blockResult = a.buildBlockWeeks(o.distanceKey || 'half', o.volume || 45, weeks);
  const days = a.buildDaysFromWeeks(blockResult, raceDate, SCHEDULE, startDate, true);
  a.state = a.makeDefaultState();
  a.state.setup = {
    distanceKey: o.distanceKey || 'half', currentVolume: o.volume || 45, raceDate, hasEvent: true,
    startDate, planWeeks: blockResult.planWeeks, schedule: SCHEDULE,
    benchmark: { distanceKey: '10k', timeSec: a.clockToSec('0:45:00') },
    goals: { A: { timeSec: Math.round(a.clockToSec('0:45:00') * 0.95) } }, activeGoal: 'A',
    paceOverrides: {}, lthr: 172, maxHR: 190, experience: 'experienced', purpose: 'race'
  };
  a.state.days = days;
  a.state.athlete = { sessions: [], baselines: {}, blocks: [] };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z', withdrawnAt: null };
  a.migrateAthleteRecord();
  return { a, raceDate };
}

/* Advances what "now" resolves to without touching any stored .date, so the
   block ledger and every day's own date stay exactly what the generator
   wrote -- the same principle test/harness.js's pinnedDate already uses,
   just re-armed mid-test instead of once at load. */
function repin(a, iso){ a.Date = makePinnedDate(iso); }

function logPastMostly(a, opts){
  const o = opts || {};
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach((d, i) => {
    if (o.skipEvery && i % o.skipEvery === o.skipEvery - 1) return;
    d.completed = true;
    d.actual = { km: d.km, pace: '5:20', hr: 148, rpe: 5, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  });
}

function markRaceRun(a, raceDate, opts){
  const o = opts || {};
  const raceDay = a.findDayByDate(raceDate);
  assert.ok(raceDay, 'fixture needs a goal day at ' + raceDate);
  if (o.ran !== false){
    raceDay.completed = true;
    raceDay.actual = { km: raceDay.km, pace: null, hr: 165, rpe: 9, feel: 'ok', notes: '', splits: [], paceUnit: 'km' };
  }
  return raceDay;
}

// ===========================================================================
// A. EARLY / MID BLOCK
// ===========================================================================
test('A. early/mid race block: the continuity card is quiet, no premature recovery CTA', () => {
  const { a } = racingBlock({ weeks: 12, back: 40 });   // well inside the block
  assert.equal(a.nextBlockRecommendation(), null);
  const card = a.renderContinuityCard();
  assert.match(card, /What.s next/i);
  assert.match(card, /Finish this block first/);
  assert.doesNotMatch(card, /Start Recovery/i);
  assert.doesNotMatch(card, /RECOMMENDED NEXT|Recommended next/i);
});

// ===========================================================================
// B. TAPER — IMMEDIATELY BEFORE RACE DAY
// ===========================================================================
test('B. taper week: still quiet -- no Start Recovery before the race has happened', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  repin(a, a.addDays(raceDate, -3) + 'T09:00:00Z');
  assert.equal(a.nextBlockRecommendation(), null,
    'the taper-week guard should keep this null, not a choice recommendation');
  const card = a.renderContinuityCard();
  assert.match(card, /Finish this block first/);
  assert.doesNotMatch(card, /Start Recovery/i);
});

// ===========================================================================
// C. DAY AFTER RACE DAY — OUTCOME UNANSWERED
// ===========================================================================
test('C. outcome pending: prompt appears, Full Plan points at Today, Today gives conservative recovery, nothing auto-starts', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  markRaceRun(a, raceDate);
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');

  assert.equal(a.raceOutcomePending(), true);
  assert.match(a.renderRaceOutcomePrompt(), /How did it go/i);

  const planCard = a.renderContinuityCard();
  assert.match(planCard, /Race day has passed/i);
  assert.doesNotMatch(planCard, /I raced it|Did not finish|Did not start/i,
    'Full Plan duplicated the full outcome questionnaire instead of pointing at Today');

  const report = a.coachAnalyse();
  assert.equal(report.nextMove, null, 'precondition: Next Move has nothing left to prescribe');
  const todayCard = a.renderPostRaceRecoverCard(report);
  assert.match(todayCard, />Recover</);
  assert.doesNotMatch(todayCard, /Start Recovery|start-block/,
    'the immediate cue must not offer to start the recovery BLOCK before the outcome is known');
  assert.equal(a.state.setup.purpose, 'race', 'nothing may start a block on its own');
});

test('C2. once Next Move has something real to say, the pending-window cue steps aside', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  // a race day that is NOT the last scheduled day -- Next Move still has a
  // real future session to reason about even though the goal has passed
  repin(a, a.addDays(raceDate, -10) + 'T09:00:00Z');
  const report = a.coachAnalyse();
  assert.ok(report.nextMove, 'precondition: Next Move has a session to speak about');
  assert.equal(a.renderPostRaceRecoverCard(report), '',
    'the pending-window cue rendered even though Next Move already had something to say');
});

// ===========================================================================
// D / E / F. THE THREE OUTCOMES
// ===========================================================================
test('D. outcome = raced: the recommendation appears, Start Recovery works, history is preserved', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  logPastMostly(a);
  const trained = a.state.days.filter(d => d.completed).length;
  assert.ok(trained > 10, 'fixture needs real logged training behind it');
  markRaceRun(a, raceDate);
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  a.recordRaceOutcome('raced');

  const planCard = a.renderContinuityCard();
  assert.match(planCard, /RECOVERY/i);
  assert.match(planCard, /Start Recovery/i);
  assert.match(planCard, /Nothing changes until you choose/i);

  const block = a.startDevelopmentBlock('recovery');
  assert.ok(block, 'recovery did not build');
  assert.ok(a.state.athlete.sessions.length >= trained, 'the race block’s training was not archived');
});

test('E. DNF: training stays logged, no measurement, recovery is still the recommendation', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  const raceDay = markRaceRun(a, raceDate);
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  a.recordRaceOutcome('dnf');
  assert.equal(raceDay.completed, true, 'a DNF erased training that actually happened');
  assert.equal(a.measuredPerformances().length, 0, 'a DNF was counted as a measurement');
  const planCard = a.renderContinuityCard();
  assert.match(planCard, /RECOVERY/i);
});

test('F. DNS: the continuity card offers maintenance, never recovery from a race that never happened', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  a.recordRaceOutcome('dns');
  const planCard = a.renderContinuityCard();
  assert.match(planCard, /MAINTAIN/i);
  assert.doesNotMatch(planCard, /RECOVERY/i);
});

// ===========================================================================
// G / H. RECOVERY, ACTIVE THEN FINISHING
// ===========================================================================
test('G. an active recovery block, mid-way: the continuity card has nothing to say yet', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  a.recordRaceOutcome('raced');
  const block = a.startDevelopmentBlock('recovery');
  assert.ok(block);
  const card = a.renderContinuityCard();
  assert.equal(card, '', 'a recovery block mid-way produced a card before it had anything to recommend');
});

test('H. recovery reaching its end: the continuity card offers all four real directions', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  const recWeeks = a.state.setup.planWeeks, recStart = a.state.setup.startDate;
  repin(a, a.addDays(recStart, recWeeks * 7 - 3) + 'T09:00:00Z');

  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'choice');
  const card = a.renderContinuityCard();
  ['maintain', 'base', 'speed', 'race'].forEach(p =>
    assert.match(card, new RegExp('data-purpose="' + p + '"'), p + ' missing from the four directions'));
});

// ===========================================================================
// I. THE FOURTH DIRECTION IS A RACE BLOCK, NOT "RACE DAY"
// ===========================================================================
test('I. the fourth direction reads "Build a race block", and prior history survives selecting it', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  logPastMostly(a);
  const trained = a.state.days.filter(d => d.completed).length;
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  a.recordRaceOutcome('raced');
  a.startDevelopmentBlock('recovery');
  const recWeeks = a.state.setup.planWeeks, recStart = a.state.setup.startDate;
  repin(a, a.addDays(recStart, recWeeks * 7 - 3) + 'T09:00:00Z');

  const card = a.renderContinuityCard();
  assert.match(card, /Build a race block/);
  assert.doesNotMatch(card, />Race Day</);

  const block = a.startDevelopmentBlock('base');   // any real selection
  assert.ok(block);
  assert.ok(a.state.athlete.sessions.length >= trained, 'selecting a new direction lost prior training');
});

// ===========================================================================
// J. WEEK NUMBERING STAYS HONEST THROUGHOUT
// ===========================================================================
test('J. Full Plan’s continuity card and its week header agree once a block has ended', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  assert.equal(a.currentWeekNum(), null);
  assert.doesNotMatch(a.blockIdentityLine(), /Week/,
    'the header still claims a week number for a block that has already ended');
  const card = a.renderContinuityCard();
  assert.match(card, /Race day has passed/i);
});

// ===========================================================================
// K. IMPERFECT ADHERENCE DOES NOT BREAK ANY OF IT
// ===========================================================================
test('K. missing sessions do not block the post-race lifecycle from functioning', () => {
  const { a, raceDate } = racingBlock({ weeks: 12, back: 70 });
  logPastMostly(a, { skipEvery: 3 });   // roughly a third of sessions left unlogged
  markRaceRun(a, raceDate);
  repin(a, a.addDays(raceDate, 1) + 'T09:00:00Z');
  assert.equal(a.raceOutcomePending(), true);
  a.recordRaceOutcome('raced');
  const rec = a.nextBlockRecommendation();
  assert.equal(rec.kind, 'block');
  assert.equal(rec.purpose, 'recovery', 'imperfect adherence blocked the recovery recommendation');
  const card = a.renderContinuityCard();
  assert.match(card, /RECOVERY/i);
});

// ===========================================================================
// NO DUPLICATE CONTINUITY SURFACES
// ===========================================================================
test('the retired congratulations banner does not come back as a parallel mechanism', () => {
  const { a } = racingBlock({ weeks: 12, back: 70 });
  assert.equal(a.renderCongratsBanner, undefined,
    'renderCongratsBanner still exists -- retiring it should have removed the function, not left it unused');
  const html = a.renderWeeksList();
  assert.doesNotMatch(html, /congrats-banner|VALHALLA AWAITS|GO KILL IT/,
    'the old banner is still reachable from the real render path');
  // exactly one continuity surface at the very end of the weeks list
  const matches = html.match(/class="hub-card yr-next"/g) || [];
  assert.ok(matches.length <= 1, 'more than one continuity card rendered at once: ' + matches.length);
});

test('renderWeeksList() actually carries the continuity card in production, not just in isolation', () => {
  const { a } = racingBlock({ weeks: 12, back: 40 });
  const html = a.renderWeeksList();
  assert.match(html, /What.s next/i);
});
