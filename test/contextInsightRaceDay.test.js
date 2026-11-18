'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* RACE MORNING.
 * ===========================================================================
 * The Race Day CARD runs the race: pace, strategy, splits. This is the coach
 * talking about the block they just spent together, and the rules it has to
 * keep are mostly rules about honesty:
 *
 *   - it reads what the athlete ACTUALLY did, over the whole block
 *   - it never tells a disrupted athlete the preparation was fine
 *   - it never demotes an athlete over one or two missed sessions
 *   - it is coaching, not clearance: an open restriction still owns the screen
 *   - a 5K athlete is never handed marathon advice
 */

const TODAY = '2026-11-01';   // a Sunday; goal days are Sunday-anchored

/* A block whose race day is TODAY. The offset is searched rather than
   assumed because week 1 is Monday-aligned and the goal day falls where the
   generator puts it. */
function raceToday(distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  for (let off = -110; off <= -88; off++){
    buildPlan(a, { distanceKey, volume:55, weeks:14, lthr:172, maxHR:188,
                   hasEvent:true, startDate: a.addDays(TODAY, off) });
    a.state.setup.purpose = 'race';
    if (a.raceDayToday()) return a;
  }
  throw new Error('the fixture never put a race day on today for ' + distanceKey);
}
const past = a => a.state.days.filter(d => d.date < TODAY && d.type !== 'rest');
function ranEverything(a){ past(a).forEach(d => logAsPrescribed(a, d)); return a; }
/* Miss every Nth session: the shape of an athlete who trained but not perfectly. */
function ranMostly(a, everyNth){
  past(a).forEach((d, i) => { if (i % everyNth !== 0) logAsPrescribed(a, d); });
  return a;
}
function restrictFor(a, days){
  const from = a.addDays(TODAY, -(days + 20)), until = a.addDays(TODAY, -21);
  a.state.days.forEach(d => {
    if (d.date >= from && d.date <= until){ d.restricted = true; d.completed = false; delete d.actual; }
  });
  return a;
}
const copy = a => a.contextInsightDue();
const text = c => (c.title + ' ' + c.paras.join(' '));

test('race morning outranks every other insight', () => {
  const a = ranEverything(raceToday('half'));
  /* Make a competing candidate genuinely true on the same morning. */
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceSecPerKm = 277;
  const cands = a.insightCandidates();
  assert.equal(cands[0].kind, 'race_day', 'something was offered ahead of race day');
  assert.ok(cands.some(c => c.kind === 'threshold'), 'the competing candidate was not actually there');
  assert.match(copy(a).title, /This is it|Race day|This one is different/);
});

test('race morning is not silenced by an athlete who stopped reading explanations', () => {
  /* Dismissing three phase cards in October says nothing about this morning:
     the quiet rule and the one-a-day rule both bend, and only for this kind. */
  const a = ranEverything(raceToday('half'));
  a.state.insights.quietBlockId = a.insightBlockKey();
  a.state.insights.shownOn = TODAY;
  assert.ok(copy(a), 'race morning was suppressed by the education rules');
  assert.equal(a.insightSuppressed(false), 'athlete_declined',
    'the bend leaked out and now applies to ordinary insights too');
});

test('an open restriction still owns race morning', () => {
  /* Safety and readiness remain authoritative. This card is coaching, not
     medical clearance, and must not be the thing on screen when the athlete
     owes an answer about their own health. */
  const a = ranEverything(raceToday('half'));
  a.declareRestriction('none', a.addDays(TODAY, 3));
  assert.equal(a.insightSuppressed(true), 'restriction_open');
  assert.equal(copy(a), null, 'a motivational card opened over an open restriction');
});

test('a goal day with no start line gets no race-morning card', () => {
  const a = ranEverything(raceToday('half'));
  assert.ok(a.raceDayToday(), 'the fixture lost its race day');
  a.state.setup.hasEvent = false;
  assert.equal(a.raceDayToday(), null,
    'a goal effort with no event was treated as a race the athlete entered');
});

test('a well-executed block is read as one, and a couple of missed sessions do not cost it', () => {
  assert.equal(ranEverything(raceToday('half')).racePreparationRead().state, 'EXCELLENT');
  /* HQ: do not undermine the athlete unnecessarily because of one or two
     missed sessions. A block missing roughly one session in twenty is still
     a block that went well. */
  const a = raceToday('half');
  const days = past(a);
  days.forEach((d, i) => { if (i !== 4 && i !== 31) logAsPrescribed(a, d); });
  assert.equal(a.racePreparationRead().state, 'EXCELLENT',
    'two missed sessions in a fourteen-week block demoted the athlete');
});

test('a hit-and-miss block is read as good rather than excellent', () => {
  const prep = ranMostly(raceToday('half'), 9).racePreparationRead();
  assert.equal(prep.state, 'GOOD');
  const t = text(copy(ranMostly(raceToday('half'), 9)));
  assert.match(t, /was the block perfect\? no/i, 'it skipped the honest part');
  assert.match(t, /belong on that start line/i, 'it forgot to back the athlete');
});

test('a significant interruption is named, not smoothed over', () => {
  /* Every fraction here is perfect: the athlete trained well on both sides of
     three weeks they were not allowed to train at all. Reading that as
     excellent preparation is the single thing this card must never do. */
  const a = restrictFor(ranEverything(raceToday('full')), 21);
  const prep = a.racePreparationRead();
  assert.equal(prep.state, 'DISRUPTED');
  assert.ok(prep.dimensions.every(d => d.fraction >= 0.95),
    'this test is only meaningful while the fractions themselves look fine');
  const t = text(copy(a));
  assert.match(t, /not going to tell you preparation was perfect/i);
  assert.match(t, new RegExp(prep.restrictedDays + ' days'),
    'it did not say what was actually lost');
  assert.doesNotMatch(t, /every reasonable chance|done the work\. properly/i,
    'a disrupted athlete was told the block went well');
});

test('no race distance is handed another distance\'s advice', () => {
  const MARATHON_ONLY = [/drinks station/i, /\bmarathon\b/i, /15 /];
  ['5k', '10k'].forEach(d => {
    const t = text(copy(ranEverything(raceToday(d))));
    MARATHON_ONLY.forEach(re => assert.doesNotMatch(t, re,
      'a ' + d + ' athlete was given marathon advice'));
  });
  const full = text(copy(ranEverything(raceToday('full'))));
  assert.match(full, /drinks station/i, 'the marathon lost its own advice');
  /* The long-run claim is only made where the long run was the demand. */
  assert.doesNotMatch(text(copy(ranEverything(raceToday('5k')))), /long runs are there/i,
    'a 5K athlete was congratulated on their long runs');
});

test('the opening is described as boring rather than easy', () => {
  /* HQ, explicitly: controlled enough that they are almost wondering whether
     they are holding back too much. */
  ['5k', '10k', 'half', 'full'].forEach(d => {
    const t = text(copy(ranEverything(raceToday(d))));
    assert.match(t, /boring/i, d + ' did not describe the opening as boring');
    assert.doesNotMatch(t, /should feel easy/i, d + ' promised the opening would feel easy');
  });
});

test('race morning carries no unit noun of its own', () => {
  const a = ranEverything(raceToday('full'));
  assert.match(text(copy(a)), /kilometre/i);
  a.state.units = 'mi';
  const miles = text(copy(a));
  assert.match(miles, /\bmile/i, 'a unit noun was hard-coded');
  assert.doesNotMatch(miles, /kilometre/i, 'a kilometre reached a miles athlete');
});

test('race morning does not re-run the race card', () => {
  /* The card already carries pace, splits and strategy. Duplicating any of
     it here is the Over-Under mistake again, on the worst possible morning. */
  const t = text(copy(ranEverything(raceToday('full'))));
  [/\d+:\d\d/, /per @@?U|\/km|\/mi\b/i, /target pace/i, /split/i].forEach(re =>
    assert.doesNotMatch(t, re, 'execution detail leaked off the race card and into the insight'));
});
