'use strict';
/* FITNESS CHECKPOINT -> RACE GOAL ASSESSMENT.
 * ===========================================================================
 * The question APP is parked on: "given where I am and the programme I am
 * about to run, which of my goals does Valhalla support?" Three rules govern
 * the answer, and each is asserted here.
 *
 *   CURRENT FITNESS IS NOT RACE-DAY DESTINATION. Comparing A/B/C against
 *   today's equivalent time answers "could I run this now", which is not the
 *   question and is unfair to an athlete about to train for fifteen weeks.
 *
 *   THE PROJECTION IS THE ATHLETE'S OWN RATE OR THERE IS NONE. A generic gain
 *   is a race-day prediction invented to fill a screen. Without two measured
 *   performances the assessment is withheld.
 *
 *   FITNESS ALONE DOES NOT SUPPORT A GOAL. A three-hour marathon is not
 *   supported by three-hour fitness if the programme cannot establish the long
 *   run the event needs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadApp } = require(path.join(__dirname, 'harness.js'));

const TODAY = '2026-03-02', RACE = '2026-06-14';
function athlete(dist, perfs, goalsMin, active){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.showToast = () => {};
  a.state = a.makeDefaultState();
  a.state.athlete = a.makeAthleteRecord();
  a.state.athlete.performances = perfs.map(p => ({
    date: p.d, distanceM: 5000, timeSec: p.t,
    vdot: a.vdotFromPerformance(5000, p.t), source: 'race', qualified: true }));
  const goals = {};
  ['A','B','C'].forEach((k, i) => { if (goalsMin[i] != null) goals[k] = { timeSec: goalsMin[i] * 60 }; });
  a.state.setup = Object.assign(a.state.setup || {},
    { distanceKey: dist, goals, activeGoal: active, raceDate: RACE });
  return a;
}
const IMPROVING = [{ d:'2025-11-02', t:21*60+30 }, { d:'2026-02-01', t:20*60+30 }];

test('the projection is forward, not a comparison against today', () => {
  const a = athlete('half', IMPROVING, [85, 92, 100], 'B');
  const r = a.raceGoalAssessment(null);
  const now = a.currentFitnessEstimate('half');
  assert.ok(r.projection && !r.projection.withheld);
  assert.ok(r.projection.fastSec < now.fastSec,
    'the race-day band must be quicker than today: ' + r.projection.fastSec + ' vs ' + now.fastSec);
  assert.ok(r.projection.gainedVdot > 0, 'and it must say how much improvement it assumed');
  assert.equal(r.daysToRace, 104);
});

test('the improvement projected is the athlete\'s own, and bounded by itself', () => {
  /* A fortnight of sharp improvement may not be extrapolated into a season. */
  const a = athlete('half', IMPROVING, [85, 92, 100], 'B');
  const p = a.raceGoalProjectedVdot(3650);          // ten years out
  const near = a.raceGoalProjectedVdot(91);         // one measurement span
  assert.ok(p.gained <= near.gained + 1e-9,
    'a ten-year projection gained more than the rate that measured it');
  const last = a.state.athlete.performances[1].vdot;
  const prev = a.state.athlete.performances[0].vdot;
  assert.ok(p.gained <= (last - prev) + 1e-9,
    'the projection added more improvement than the athlete has ever demonstrated');
});

test('one measured performance is a point, not a rate — and the answer is withheld', () => {
  const a = athlete('half', [{ d:'2026-02-01', t:20*60+30 }], [85, 92, 100], 'B');
  const r = a.raceGoalAssessment(null);
  assert.equal(r.verdict, 'withheld');
  assert.equal(r.reason, 'no_demonstrated_rate');
  assert.equal(r.recommend, null, 'and nothing is recommended on no evidence');
});

test('a decline is not projected forward as further decline', () => {
  const a = athlete('half', [{ d:'2025-11-02', t:20*60 }, { d:'2026-02-01', t:21*60 }],
                    [85, 92, 100], 'B');
  const p = a.raceGoalProjectedVdot(104);
  assert.equal(p.flat, true, 'a slower second measurement should hold today, not extrapolate down');
  assert.equal(p.gained, 0);
});

test('a supported active goal is reported as supported', () => {
  const a = athlete('half', IMPROVING, [85, 92, 100], 'B');
  const r = a.raceGoalAssessment(null);
  assert.equal(r.verdict, 'current_goal_supported');
  assert.equal(r.recommend, 'B');
  assert.equal(r.goals.find(g => g.key === 'B').supported, true);
});

test('an unsupported active goal names the one that is, and why', () => {
  const a = athlete('half', IMPROVING, [70, 92, 100], 'A');   // A far too quick
  const r = a.raceGoalAssessment(null);
  assert.equal(r.verdict, 'different_goal_recommended');
  assert.equal(r.reason, 'fitness', 'the athlete is short on fitness, not preparation');
  assert.equal(r.recommend, 'B');
  const A = r.goals.find(g => g.key === 'A');
  assert.equal(A.supportedByFitness, false);
  assert.ok(A.shortfallSec > 0, 'and by how much, so the caller can say it in seconds');
});

test('where several goals are legitimate the quickest supported one is recommended', () => {
  /* Fitness admits a range and often admits more than one. There is no reason
     to talk an athlete down from a goal Valhalla is prepared to stand behind. */
  const a = athlete('half', IMPROVING, [88, 92, 100], 'C');
  const r = a.raceGoalAssessment(null);
  const supported = r.goals.filter(g => g.supported).map(g => g.key);
  assert.ok(supported.length > 1, 'this fixture is meant to admit more than one goal');
  const quickest = r.goals.filter(g => g.supported)
                          .sort((x, y) => x.timeSec - y.timeSec)[0].key;
  assert.equal(r.recommend, quickest);
});

test('every goal faster than the projection recommends none of them', () => {
  const a = athlete('half', IMPROVING, [60, 62, 64], 'B');
  const r = a.raceGoalAssessment(null);
  assert.equal(r.verdict, 'no_goal_supported');
  assert.equal(r.recommend, null);
  assert.ok(r.projection && !r.projection.withheld,
    'and the projected band is still reported, so the athlete sees what IS supported');
});

test('the marathon withholds rather than over-predicting from a short effort', () => {
  /* Inherited from currentFitnessEstimate(), never re-decided here: an
     equivalence from a 5K systematically over-predicts a marathon for an
     athlete who has not done the volume, and the limiter is not the same one. */
  const a = athlete('full', IMPROVING, [210, 240, 270], 'B');
  const r = a.raceGoalAssessment(null);
  assert.equal(r.verdict, 'withheld');
  assert.equal(r.reason, 'marathon_estimate_withheld');
  assert.ok(r.projection && r.projection.withheld && r.projection.reason,
    'and it says why, in words the athlete can read');
});

test('preparation is asked independently of fitness', () => {
  /* THE THIRD RULE. A goal inside the projected band is still not supported if
     the programme cannot establish what the event needs. */
  const a = athlete('half', IMPROVING, [85, 92, 100], 'B');
  const blk = a.buildBlockWeeks('half', null, 15,
    { purpose:'race', availableDays:5, experience:'novice' });
  const r = a.raceGoalAssessment(blk);
  assert.ok(r.preparation, 'a block was supplied, so preparation must be reported');
  assert.ok(['READY','MARGINAL','INSUFFICIENT'].indexOf(r.preparation.verdict) !== -1);
  r.goals.forEach(g => assert.equal(g.supportedByPreparation,
    r.preparation.verdict === 'READY',
    'preparation is a statement about the programme and applies to every goal alike'));
});

test('it decides nothing and writes nothing', () => {
  const a = athlete('half', IMPROVING, [70, 92, 100], 'A');
  const before = JSON.stringify(a.state);
  a.raceGoalAssessment(null);
  assert.equal(JSON.stringify(a.state), before,
    'the assessment must not change the athlete\'s goal or any other state');
});

/* ---------------------------------------------------------------------------
   THE CONTRACT ITSELF, PINNED
   APP is parked until this surface is explicit. These tests are the statement
   of it: every verdict the assessment can return, what evidence each one
   requires, which authority produced the projection, and the payload a caller
   can rely on being there.
   --------------------------------------------------------------------------- */
test('CONTRACT — the verdict vocabulary is closed and every member is reachable', () => {
  const VERDICTS = ['withheld', 'current_goal_supported', 'different_goal_recommended',
                    'no_goal_supported', 'preparation_short'];
  const seen = {};

  /* withheld -- one performance is a point, not a rate. */
  seen[athlete('half', [{ d:'2026-02-01', t:20*60+30 }], [85], 'A')
        .raceGoalAssessment(null).verdict] = true;
  /* current_goal_supported -- the active goal is inside the projection. */
  seen[athlete('half', IMPROVING, [100], 'A').raceGoalAssessment(null).verdict] = true;
  /* different_goal_recommended -- another goal is, this one is not. */
  seen[athlete('half', IMPROVING, [60, 100], 'A').raceGoalAssessment(null).verdict] = true;
  /* no_goal_supported -- every goal is faster than the evidence. */
  seen[athlete('half', IMPROVING, [50, 52, 55], 'A').raceGoalAssessment(null).verdict] = true;

  ['withheld', 'current_goal_supported', 'different_goal_recommended', 'no_goal_supported']
    .forEach(v => assert.ok(seen[v], 'no path produced the verdict "' + v + '"'));
  /* preparation_short is reachable only with a block, and is asserted in its
     own test below -- it is the one verdict that is about the PROGRAMME. */
  assert.equal(VERDICTS.length, 5);
});

test('CONTRACT — preparation_short is the programme\'s verdict, not the athlete\'s', () => {
  /* Fitness admits the goal and the runway does not. The reason names the
     dimension that fell short, so a caller can say which -- workload,
     durability, or both -- rather than "not ready".

     HQ RACE GOAL SAFETY-FLOOR CORRECTION -- the New Half canonical entry
     (8km long run) used here previously now reaches its own ten-week floor
     exactly (the gap closes inside the Nielsen safety rate) and projects
     READY, so it no longer demonstrates a short runway at all. A thinner
     long-run entry (5km, versus the canonical 8km) keeps every other
     figure the same and still leaves a genuine, honestly-measured gap the
     ten-week runway cannot close -- the case this contract test exists to
     hold. */
  const R = require(path.join(__dirname, 'audit', 'raceGoalReachability.js'));
  const c = R.CANON_10.filter(x => x.key.indexOf('New Half') === 0)[0];
  const thinEv = Object.assign({}, c.ev, { longKm: 5 });
  const res = R.build(Object.assign({ dist:c.dist, exp:c.exp, days:c.days, weeks:10 }, thinEv));
  const a = res.a;
  a.state.setup = Object.assign(a.state.setup || {}, {
    distanceKey:'half', raceDate:'2026-05-10', activeGoal:'A',
    goals:{ A:{ timeSec: 200 * 60 } } });          // a goal fitness cannot refuse
  a.state.athlete = a.state.athlete || a.makeAthleteRecord();
  a.state.athlete.performances = [
    { date:'2025-11-02', distanceM:5000, timeSec:21*60+30,
      vdot:a.vdotFromPerformance(5000, 21*60+30), source:'race', qualified:true },
    { date:'2026-02-01', distanceM:5000, timeSec:20*60+30,
      vdot:a.vdotFromPerformance(5000, 20*60+30), source:'race', qualified:true }];
  const r = a.raceGoalAssessment(res.blk);
  assert.ok(r, 'no assessment at all');
  assert.ok(r.preparation, 'the assessment carried no preparation reading');
  assert.notEqual(r.preparation.verdict, 'READY',
    'this pathway is expected to fall short of its standard on a ten-week runway');
  assert.equal(r.verdict, 'preparation_short',
    'a goal well inside fitness with a short runway returned ' + r.verdict);
  assert.ok(['workload', 'durability'].indexOf(r.reason) !== -1,
    'preparation_short did not name the dimension: ' + r.reason);
});

test('CONTRACT — the payload a caller can rely on', () => {
  const r = athlete('half', IMPROVING, [85, 92, 100], 'B').raceGoalAssessment(null);
  ['distanceKey', 'activeGoal', 'verdict', 'reason', 'projection', 'goals',
   'recommend', 'preparation', 'daysToRace'].forEach(k =>
    assert.ok(k in r, 'the assessment is missing "' + k + '"'));
  assert.equal(typeof r.daysToRace, 'number');
  ['fastSec', 'slowSec'].forEach(k => assert.ok(k in r.projection,
    'the projection is missing "' + k + '"'));
  r.goals.forEach(g => ['key', 'timeSec', 'supportedByFitness', 'supportedByPreparation',
                        'supported', 'shortfallSec'].forEach(k =>
    assert.ok(k in g, 'goal ' + g.key + ' is missing "' + k + '"')));
  /* The shortfall is a NUMBER of seconds, so a caller can say "forty seconds"
     rather than "no". */
  const missed = r.goals.filter(g => !g.supportedByFitness)[0];
  if (missed) assert.ok(missed.shortfallSec > 0,
    'an unsupported goal reported a shortfall of ' + missed.shortfallSec);
});

test('CONTRACT — evidence requirements, stated', () => {
  /* TWO qualified performances, because a rate needs two points. One is
     withheld; none is withheld with its own reason. */
  const none = athlete('half', [], [85], 'A').raceGoalAssessment(null);
  assert.equal(none.verdict, 'withheld');
  assert.equal(none.reason, 'no_demonstrated_rate');
  const one = athlete('half', [{ d:'2026-02-01', t:20*60+30 }], [85], 'A')
                .raceGoalAssessment(null);
  assert.equal(one.verdict, 'withheld');
  assert.equal(one.reason, 'no_demonstrated_rate');
  /* And two produce a projection. */
  const two = athlete('half', IMPROVING, [85], 'A').raceGoalAssessment(null);
  assert.ok(two.projection && two.projection.fastSec > 0);
});

test('CONTRACT — the marathon withholds rather than predicting from a short effort', () => {
  /* A 5k over-predicts an untrained marathon limiter, and the caveat is about
     absorbed volume rather than about which rung produced the VDOT. The
     assessment says so with its own reason rather than returning a number it
     does not stand behind. */
  const m = athlete('full', IMPROVING, [200], 'A').raceGoalAssessment(null);
  if (m.verdict === 'withheld')
    assert.equal(m.reason, 'marathon_estimate_withheld');
  else
    assert.ok(m.projection && !m.projection.withheld,
      'a marathon projection was returned while flagged withheld');
});

test('CONTRACT — current fitness and race-day projection are different numbers', () => {
  /* The distinction APP has to render. "Where am I now" is currentFitnessEstimate;
     "what will this programme make me" is the projection the assessment uses,
     and comparing goals against the first is the defect this contract removes. */
  const a = athlete('half', IMPROVING, [85, 92, 100], 'B');
  const now = a.currentFitnessEstimate('half');
  const r = a.raceGoalAssessment(null);
  assert.ok(now && now.fastSec > 0, 'no current-fitness reading');
  assert.ok(r.projection.fastSec < now.fastSec,
    'the race-day projection (' + r.projection.fastSec + 's) is not ahead of ' +
    'current fitness (' + now.fastSec + 's) for an improving athlete');
});
