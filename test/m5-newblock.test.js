'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

// YEAR-ROUND LIFECYCLE — THE WHOLE SEASON, NOT ONE BLOCK.
//
// yearRound.test.js proves each engine part in isolation. This drives the
// athlete through the transitions between them, because that is where a
// year-round product actually breaks: not in a recovery block, but in the
// handover from a race to it, and from it to whatever comes next.
//
// Every path below ends somewhere. "No dead end" is the property under test as
// much as any individual recommendation, so each campaign asserts that Sacoro
// still has something to say at the end of it.

const ROOT = path.join(__dirname, '..');
const TODAY = '2026-08-21T09:00:00Z';
const SCHEDULE = { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 };

function app(){
  const a = loadApp({ pinnedDate: TODAY });
  a.showToast = () => {};
  a.renderApp = () => {};
  a.confirm = () => true;
  return a;
}

/* An athlete mid-way through a race block, with real logged training behind
   them -- built through the real generator so nothing is hand-forged. */
function racingAthlete(opts){
  const o = opts || {};
  const a = app();
  /* HQ NARROW PATHWAY CORRECTION -- experience is passed explicitly where a
     caller asks for it (opts.experience). The implicit (unnamed) default
     resolves to 'experienced', whose own Half entry HQ's directive dropped
     30 -> 20km; only the one test whose fixture needs the pre-correction
     shape back (the 'builder still builds a race block' mutation check)
     asks for 'advanced', whose own entry (45) did not move. Every other
     caller is unaffected -- in particular the volume-qualification safety
     test below, which specifically needs the DEFAULT, moderate-capacity
     athlete this fixture always described. */
  if (o.experience){ a.state = a.makeDefaultState(); a.state.experience = o.experience; }
  buildPlan(a, { weeks: o.weeks || 14, startDate: a.addDays('2026-08-21', -(o.back || 84)),
                 distanceKey: o.distanceKey || 'half', volume: o.volume || 55,
                 benchSec: 45 * 60 });
  if (o.experience) a.state.experience = o.experience;
  a.state.setup.schedule = SCHEDULE;
  a.state.setup.benchmark = { distanceKey: '10k', timeSec: 45 * 60 };
  a.state.setup.goals = { A: { timeSec: 100 * 60 } };
  a.migrateAthleteRecord();
  return a;
}

function logPast(a, opts){
  const o = opts || {};
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach((d, i) => {
    if (o.skipEvery && i % o.skipEvery === o.skipEvery - 1) return;
    d.completed = true;
    d.actual = { km: d.km, pace: '5:20', hr: 148, rpe: 5, feel: 'ok',
                 notes: '', splits: [], paceUnit: 'km' };
  });
}

/* Move the block's goal day into the past and log the effort, which is what an
   athlete who has just raced actually leaves behind. */
function raceHappened(a, opts){
  const o = opts || {};
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the fixture needs a goal day');
  const past = a.addDays(a.todayStr(), -1);
  race.date = past; race.id = past;
  a.state.setup.raceDate = past;
  const b = a.currentBlock();
  if (b) b.goalDate = past;
  if (o.ran !== false){
    race.completed = true;
    race.actual = { km: race.km, pace: o.pace || '4:44', hr: 175, rpe: 9, feel: 'ok',
                    notes: '', splits: [], paceUnit: 'km' };
  }
  return race;
}

function builderDom(a, values){
  const store = Object.assign({
    'su-purpose': 'race', 'su-distance': 'half', 'su-racedate': '',
    'su-weeks': '10', 'su-volume': '50', 'su-bench-dist': '10k',
    'su-bench-time': '45:00', 'su-lthr': '', 'su-maxhr': '',
    'su-longday': '6', 'su-goal-A': '1:40:00', 'su-goal-B': '', 'su-goal-C': ''
  }, values || {});
  const eventMode = store['su-purpose'] === 'race' && store['su-racedate'] ? 'event' : 'none';
  const checkboxes = [1, 2, 3, 5, 6].map(iso => ({
    checked: true, getAttribute: n => (n === 'data-wd' ? String(iso) : null)
  }));
  a.document.getElementById = id => {
    if (id === 'su-event-box') return { getAttribute: n => (n === 'data-mode' ? eventMode : null) };
    if (id === 'su-units') return { querySelector: () => null };
    if (store[id] === undefined) return null;
    return { value: store[id], getAttribute: () => null };
  };
  a.document.querySelectorAll = sel =>
    (sel.indexOf('su-weekdays') !== -1 ? checkboxes : []);
  a.closeModal = () => {};
  return store;
}


/* A NEW BLOCK OF THE SAME KIND IS A NEW BLOCK (founder, 17 November 2026,
   after racing a marathon and building the next race block: "When you start
   a new block it just bolts onto" the old one). Full Plan showed the new
   block as weeks 14 to 22 under the marathon's twelve weeks, from 17 August. */
test('after the race, the next race block starts at week 1, and the old block is history', () => {
  const a = racingAthlete();
  logPast(a);
  raceHappened(a);
  const oldId = a.state.setup.blockId;
  const ran = a.state.days.filter(d => d.completed).length;
  builderDom(a, { 'su-purpose': 'race', 'su-distance': 'full', 'su-racedate': '2027-05-01' });
  a.handleGeneratePlan();
  const wk1 = a.state.days.filter(d => d.week === 1);
  assert.ok(wk1.length && wk1.every(d => d.date >= a.addDays(a.todayStr(), -6)), 'week 1 is not this week');
  assert.ok(a.state.days.every(d => d.date >= a.addDays(a.todayStr(), -6)), 'the marathon\'s days were filed inside the new block');
  assert.notEqual(a.state.setup.blockId, oldId, 'the old block was rebuilt instead of a new one started');
  assert.equal(a.blockById(oldId).status, 'closed');
  assert.equal(a.blockById(oldId).outcome.reason, 'new_block');
  assert.ok(a.athlete().sessions.length >= ran, 'the marathon training was not kept as history');
});

test('the New Block page starts a new block mid-block too; Regenerate still rebuilds', () => {
  const a = racingAthlete();
  logPast(a);
  const id = a.state.setup.blockId;
  builderDom(a, { 'su-purpose': 'race', 'su-racedate': '2026-11-30' });
  a.handleGeneratePlan();
  assert.equal(a.state.setup.blockId, id, 'a Regenerate opened a new block');
  a.bldNewBlockIntent = true;
  builderDom(a, { 'su-purpose': 'race', 'su-distance': 'full', 'su-racedate': '2027-05-01' });
  a.handleGeneratePlan();
  assert.notEqual(a.state.setup.blockId, id, 'Build a New Training Block rebuilt the old block');
  assert.equal(a.bldNewBlockIntent, false, 'the intent outlived the build');
  assert.match(SRC, /data-action="open-new-block-setup">'\+\s*'Build a New Training Block<\/button>/);
  assert.match(SRC, /case 'open-new-block-setup': stgOpenSub\(openNewBlockSetup\); break;/);
});
