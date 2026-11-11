'use strict';
/* THE RING SAYS WHAT THE SESSION ASKS FOR.
 *
 * Found while checking paces for the founder, after the long run's stages
 * moved onto cards that carry no pace: the ring read "Goal 4:46/km" over a
 * goal-pace stage prescribed at 4:50-4:55. Asked "Please check which one is
 * right", the answer was the stage: racePacePrescription() only asks for
 * literal goal pace when current fitness is within 2% of the goal, and a
 * logged session is scored against the stage's band. The ring's line was the
 * raw goal, which is goal DAY's pace.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

function plan(distanceKey, extra) {
  const a = loadApp();
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  const { days } = buildPlan(a, Object.assign({ distanceKey, volume: 55, weeks: 16, lthr: 172, maxHR: 188 }, extra || {}));
  return { a, days };
}
const goalStagePace = (a, d) => {
  let steps = []; try { steps = a.workoutSteps(d) || []; } catch (e) { steps = []; }
  const st = steps.filter(s => s.intensity === 'goal_pace')[0];
  return st ? a.stepPrescriptionParts(st).pace : null;
};

test('on a training day the ring\u2019s goal line is the goal-pace stage\u2019s own band', () => {
  let checked = 0;
  ['half', 'full'].forEach(dk => {
    const { a, days } = plan(dk);
    days.filter(d => d.mpSegment && d.type !== 'race').forEach(d => {
      const stage = goalStagePace(a, d);
      if (!stage) return;
      assert.equal(a.getDayTargets(d).goalPace, 'Goal ' + stage,
        d.date + ' (' + d.title + ', ' + dk + '): the ring and the stage state two paces for one section');
      checked++;
    });
  });
  assert.ok(checked >= 6, 'only ' + checked + ' goal-pace training days were compared');
});

test('the fixture is one where it matters: the prescription is not the goal', () => {
  /* Without a gap the old line and the new one are the same string and the
     law above would pass on the defect. */
  const { a, days } = plan('full');
  const rp = a.racePacePrescription();
  assert.ok(rp.band === 'B' || rp.band === 'C',
    'this fixture\u2019s fitness is within 2% of its goal (band ' + rp.band + '), so the ring\u2019s line cannot be told from the raw goal');
  const d = days.filter(x => x.mpSegment && x.type === 'long')[0];
  const line = a.getDayTargets(d).goalPace;
  assert.notEqual(line, 'Goal ' + a.fmtPaceFromSecPerKm(a.getGoalPaceSecPerKm()),
    'the ring prints the raw goal on a training day again');
  assert.match(line, /^Goal \d:\d\d\u2013\d:\d\d\//, 'a reaching prescription is not shown as a band: ' + line);
  /* and it never asks for faster than the goal itself */
  assert.ok(rp.prescribedSecPerKm >= rp.goalSecPerKm - 0.5);
});

test('race day keeps the goal pace: the rule governs training, not the race', () => {
  ['half', 'full'].forEach(dk => {
    const { a, days } = plan(dk);
    const race = days.filter(d => d.type === 'race')[0];
    assert.ok(race, 'the block builds no race');
    const goal = a.fmtPaceFromSecPerKm(a.getGoalPaceSecPerKm());
    const t = a.getDayTargets(race);
    assert.equal(t.pace, goal, dk + ': goal day\u2019s own pace is not the goal');
    assert.equal(t.goalPace, 'Goal ' + goal, dk + ': goal day\u2019s line became the training band');
  });
});

test('with nothing to measure the gap against, the line is the goal as a single figure', () => {
  const { a, days } = plan('full');
  /* no current-fitness anchor: racePacePrescription() falls back to the goal */
  a.getCurrentFitnessVDOT = () => null;
  const rp = a.racePacePrescription();
  assert.equal(rp.band, 'A', 'the fixture could not remove the fitness anchor, so this law would prove nothing');
  const d = days.filter(x => x.mpSegment && x.type === 'long')[0];
  assert.equal(a.getDayTargets(d).goalPace, 'Goal ' + a.fmtPaceFromSecPerKm(a.getGoalPaceSecPerKm()));
});
