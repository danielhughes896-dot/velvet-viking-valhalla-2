'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* CONTEXT INSIGHT IS SHARED VALHALLA INFRASTRUCTURE.
 * ===========================================================================
 * The triggers are the same for every programme. The copy is not, and this
 * file is the guard on that: a Marathon assumption must not reach a 5K
 * athlete, and race vocabulary must not reach a block that has no race in it.
 *
 * Every assertion here failed before the pass that added it. The leaks were
 * real and shipped: an Aerobic Base block introduced itself as "your 10K
 * plan", a Speed & Threshold taper claimed the work "has been done for about
 * a fortnight" in a six-week block, and the same taper told an athlete with
 * no event to arrive fresh for the day.
 */

const TODAY = '2026-11-02';
function race(distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey, volume:55, weeks:14, lthr:172, maxHR:188,
                 startDate: a.addDays(TODAY, -35) });
  a.state.setup.purpose = 'race';
  return a;
}
function development(purpose){
  const a = race('10k');
  const built = a.startDevelopmentBlock(purpose, {});
  assert.ok(built, 'the fixture could not build a ' + purpose + ' block');
  return a;
}
/* Every line Context Insight could put in front of an athlete in this
   programme: the programme card, and each phase transition the plan contains. */
function allCopy(a){
  const out = [];
  const p = a.insightCopy({ kind:'programme', key:'k' });
  if (p) out.push(p.paras.join(' '));
  const total = a.totalWeeksInPlan();
  for (let w = 2; w <= total; w++){
    const to = a.trainingPhase(w), from = a.trainingPhase(w - 1);
    if (to === from) continue;
    const paras = a.insightPhaseParas(from, to);
    if (paras) out.push(paras.join(' '));
  }
  return out.join(' \n ');
}

const RACES = ['5k', '10k', 'half', 'full'];

test('no race distance is told about another distance', () => {
  const NAMES = { '5k':/\b5K\b/, '10k':/\b10K\b/, 'half':/Half Marathon/, 'full':/Full Marathon/ };
  RACES.forEach(mine => {
    const text = allCopy(race(mine));
    RACES.filter(d => d !== mine).forEach(other => {
      /* 'Half Marathon' contains 'Marathon', so the marathon pattern is
         checked as a whole label rather than as a word. */
      assert.doesNotMatch(text, NAMES[other],
        'a ' + mine + ' athlete was told about ' + other);
    });
  });
});

test('a development block is never called a race plan', () => {
  ['base', 'speed', 'maintain'].forEach(purpose => {
    const a = development(purpose);
    const text = allCopy(a);
    /* The engine shapes development sessions around a reference distance.
       That is an internal choice and not the athlete's goal, so it may not
       be presented to them as one. */
    RACES.forEach(d => {
      const label = a.DISTANCE_PROFILES[d].label;
      assert.doesNotMatch(text, new RegExp(label + '\\s+plan'),
        purpose + ' introduced itself as a ' + label + ' plan');
    });
  });
});

test('a block with no event never promises the athlete a day to arrive at', () => {
  ['base', 'speed', 'maintain'].forEach(purpose => {
    const text = allCopy(development(purpose));
    [/start line/i, /on the day\b/i, /race day/i, /arriving fresh/i].forEach(re =>
      assert.doesNotMatch(text, re,
        purpose + ' promised a day to arrive at in a block that has no race in it'));
    /* The word itself is allowed in two shapes and no others: saying there is
       not one, and naming a race build as the thing this block is NOT.
       Counted rather than banned, so those pass and "the race" never can. */
    const all = (text.match(/\brace\b/gi) || []).length;
    const allowed = (text.match(/no race\b|\brace build\b/gi) || []).length;
    assert.equal(all, allowed, purpose + ' referred to a race it does not have');
  });
});

test('no insight states a duration the methodology does not source', () => {
  /* The taper card asserted the work "has been done for about a fortnight".
     That is a marathon-shaped number: it is wrong about a 5K taper and wrong
     again about a six-week block, and nothing produces it. */
  const everything = RACES.map(d => allCopy(race(d)))
    .concat(['base', 'speed', 'maintain'].map(p => allCopy(development(p)))).join(' ');
  [/fortnight(?!\s+feels)/i, /\btwo weeks\b/i, /\bthree weeks\b/i].forEach(re =>
    assert.doesNotMatch(everything, re, 'an unsourced duration claim got back in'));
});

test('the threshold claim is only made when the threshold was measured', () => {
  const a = race('half');
  const guessed = a.insightPhaseParas('Base', 'Build').join(' ');
  assert.doesNotMatch(guessed, /measured rather than guessed/,
    'an athlete who never calibrated was told their threshold was measured');
  a.state.setup.thresholdPaceSource = 'calibration';
  a.state.setup.thresholdPaceSecPerKm = 277;
  assert.match(a.insightPhaseParas('Base', 'Build').join(' '), /measured rather than guessed/,
    'an athlete who did calibrate was not told it counted');
});

test('Maintain & Protect is never handed a phase insight', () => {
  const a = development('maintain');
  const total = a.totalWeeksInPlan();
  for (let w = 1; w <= total; w++)
    assert.equal(a.trainingPhase(w), 'Maintain',
      'a maintain block grew a phase arc, which would start firing phase insights');
  assert.equal(a.insightCandidates().filter(c => c.kind === 'phase').length, 0,
    'Maintain & Protect was offered a phase insight');
});

test('the written Over-Under card explains rather than repeats the prescription', () => {
  const a = race('half');
  const day = a.state.days.filter(d => d.prescription)[0];
  const copy = a.insightCopy({ kind:'workout', key:'k', archetype:'over_under', day });
  const text = copy.paras.join(' ');
  /* HQ: the card underneath already carries the session. This explains why it
     exists. A warm-up instruction here means the duplication is back. */
  [/warm-up/i, /cool-down/i, /\bcycles of\b/i].forEach(re =>
    assert.doesNotMatch(text, re, 'the insight is repeating the session card again'));
  assert.match(text, /come back down|settle/i, 'the point of the session is missing');
  /* Proved by switching the athlete's units rather than by reading the
     template: a hard-coded "kilometre" survives the switch and a token does
     not. Checking the rendered string for the word would have asserted the
     opposite of the rule, since the token is SUPPOSED to resolve to it. */
  assert.match(text, /kilometre/i, 'the metric athlete lost their unit noun');
  a.state.units = 'mi';
  const miles = a.insightCopy({ kind:'workout', key:'k', archetype:'over_under', day })
    .paras.join(' ');
  assert.match(miles, /\bmile\b/i, 'a unit noun was hard-coded instead of going through @@U@@');
  assert.doesNotMatch(miles, /kilometre/i, 'a kilometre survived into a miles athlete\'s card');
});
