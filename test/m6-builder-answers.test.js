'use strict';
/* THE BUILDER'S RECENT RUNNING ANSWERS (founder decisions, 18 November 2026).

   1. "Longest run in the last 30 days" becomes a required answer everywhere
      the plan's starting evidence is asked, so the plan always has a figure
      to measure the new run limit from. A runner who does not run yet
      answers 0 (the existing 0 to 3km low start); blank is refused.
   2. Answers that cannot all be true are stopped before the plan is built:
      "97km a week with a longest run of 2km... that's mathematically
      impossible". With weekly km above 0 and running days above 0, the
      longest run is at least weekly km / running days; weekly km above 0
      needs at least 1 running day. The athlete is told, where they are,
      with the arithmetic, and nothing is built until it is corrected.
   3. Logged runs still count: the run limit is measured from the longest of
      logged and stated (longRunStepHistoryKm()). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const Preview = require('../api/_preview.js');
const BUILDER_SPEC = require('../assets/builder-spec.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-11-18';
const PINNED = TODAY + 'T09:00:00Z';
const IMPOSSIBLE_MSG = '97km over 5 days means at least one run of 19.4km. Check your weekly distance, running days or longest run.';
const REQUIRED_MSG = 'Enter your longest recent run, or 0 if you are not running yet.';

function app(){
  const a = loadApp({ pinnedDate: PINNED });
  ['renderApp', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  a.confirm = () => true;
  return a;
}

/* The builder's own ids, as openSetupModal() renders them and
   handleGeneratePlan() / bldValidateStage() read them. Everything the athlete
   sees as a sheet, a toast or a message on the review page is recorded. */
function builderDom(a, values, opts){
  const o = opts || {};
  const store = Object.assign({
    'su-purpose': 'race', 'su-distance': 'half', 'su-racedate': '2027-03-07',
    'su-weeks': '12', 'su-volume': '40', 'su-bench-dist': '10k',
    'su-bench-time': '48:00', 'su-lthr': '', 'su-maxhr': '',
    'su-longday': '6', 'su-goal-A': '1:50:00', 'su-goal-B': '', 'su-goal-C': '',
    'su-entry-days': '4', 'su-entry-long': '14', 'su-entry-long-date': '2026-11-09'
  }, values || {});
  const eventMode = store['su-purpose'] === 'race' && store['su-racedate'] ? 'event' : 'none';
  const checkboxes = [1, 2, 4, 6].map(iso => ({
    checked: true, getAttribute: n => (n === 'data-wd' ? String(iso) : null)
  }));
  const seen = { asks: [], toasts: [], fails: [], modals: [] };
  /* The review page's decision host, when the test puts the athlete there. */
  const host = { innerHTML: '', hidden: true, closest: () => ({ hidden: false }) };
  a.document.getElementById = id => {
    if (id === 'bld-decide') return o.onReview ? host : null;
    if (id === 'su-event-box') return { getAttribute: n => (n === 'data-mode' ? eventMode : null) };
    if (id === 'su-units') return { querySelector: () => null };
    if (store[id] === undefined) return null;
    return { value: store[id], getAttribute: () => null };
  };
  a.document.querySelectorAll = sel => (sel.indexOf('su-weekdays') !== -1 ? checkboxes : []);
  a.document.querySelector = () => null;
  a.closeModal = () => {};
  a.askSacoro = x => seen.asks.push(x);
  a.openModal = h => seen.modals.push(String(h));
  a.showToast = m => seen.toasts.push(m);
  a.bldFail = (field, message) => seen.fails.push({ field, message });
  a.bldClearErrors = () => {};
  seen.host = host;
  seen.store = store;
  return seen;
}

// ------------------------------------------------------------------ the check

test('the founder\'s example is refused, with the arithmetic in the message', () => {
  const a = app();
  const c = a.entryEvidenceConflict({ weeklyKm: 97, runDaysPerWeek: 5, longestRunKm: 2 });
  assert.ok(c, '97km over 5 days with a 2km longest run was accepted');
  assert.equal(c.message, IMPOSSIBLE_MSG);
  assert.equal(c.field, 'f-entry-long');
  assert.doesNotMatch(c.message, /—/, 'an em dash in athlete copy');
});

test('the minimum is weekly / days, shown to one decimal, and the figure shown passes', () => {
  const a = app();
  const c = ev => a.entryEvidenceConflict(ev);
  assert.equal(c({ weeklyKm: 97, runDaysPerWeek: 5, longestRunKm: 19.4 }), null, 'exactly the average was refused');
  assert.ok(c({ weeklyKm: 97, runDaysPerWeek: 5, longestRunKm: 19.3 }), 'under the average was accepted');
  const third = c({ weeklyKm: 50, runDaysPerWeek: 3, longestRunKm: 16.6 });
  assert.match(third.message, /^50km over 3 days means at least one run of 16\.7km\./);
  assert.equal(c({ weeklyKm: 50, runDaysPerWeek: 3, longestRunKm: 16.7 }), null, 'the figure the message names is refused');
  assert.match(c({ weeklyKm: 12, runDaysPerWeek: 1, longestRunKm: 6 }).message, /over 1 day means at least one run of 12km\./);
});

test('a weekly distance needs at least one running day', () => {
  const a = app();
  const c = a.entryEvidenceConflict({ weeklyKm: 20, runDaysPerWeek: 0, longestRunKm: 8 });
  assert.equal(c.message, '20km a week needs at least 1 running day. Check your weekly distance or running days.');
  assert.equal(c.field, 'f-entry-days');
});

test('answers that can all be true pass, the non-runner\'s 0, 0, 0 included', () => {
  const a = app();
  [{ weeklyKm: 40, runDaysPerWeek: 4, longestRunKm: 14 },
   { weeklyKm: 0, runDaysPerWeek: 0, longestRunKm: 0 },
   { weeklyKm: 0, runDaysPerWeek: 3, longestRunKm: 10 },   // stopped running; the long run was before
   { weeklyKm: 20, runDaysPerWeek: 2, longestRunKm: 30 },  // a long run longer than this week is possible
   { weeklyKm: 30, runDaysPerWeek: null, longestRunKm: 5 } // days unanswered: nothing to divide by
  ].forEach(ev => assert.equal(a.entryEvidenceConflict(ev), null, JSON.stringify(ev) + ' was refused'));
});

test('miles: read in the athlete\'s unit, so conversion rounding never refuses a true answer', () => {
  const a = app();
  a.state.units = 'mi';
  const p = a.parseDistInput;
  assert.equal(a.entryEvidenceConflict({ weeklyKm: p('60'), runDaysPerWeek: 5, longestRunKm: p('12') }), null,
    '60mi over 5 days with a 12mi long run was refused');
  const c = a.entryEvidenceConflict({ weeklyKm: p('60'), runDaysPerWeek: 5, longestRunKm: p('2') });
  assert.equal(c.message, '60mi over 5 days means at least one run of 12mi. Check your weekly distance, running days or longest run.');
});

test('the longest run is required, and a run above zero needs its date', () => {
  const a = app();
  const req = a.entryEvidenceProblem({ weeklyKm: 20, runDaysPerWeek: 3, longestRunKm: null });
  assert.equal(req.message, REQUIRED_MSG);
  assert.equal(req.field, 'f-entry-long');
  const date = a.entryEvidenceProblem({ weeklyKm: 20, runDaysPerWeek: 3, longestRunKm: 8, longestRunDate: null });
  assert.equal(date.field, 'f-entry-long-date');
  assert.equal(date.message, 'Pick roughly when you ran it.');
  assert.equal(a.entryEvidenceProblem({ weeklyKm: 0, runDaysPerWeek: 0, longestRunKm: 0, longestRunDate: null }), null,
    'a 0 long run was asked for a date');
  assert.equal(BUILDER_SPEC.entryEvidence.fields.longestRunKm.required, true, 'the spec no longer says it is required');
  assert.match(BUILDER_SPEC.entryEvidence.fields.longestRunKm.hint, /Enter 0 if you are not running yet\./);
  /* Required means the wheel offers no Clear (numberWheels: "a required one cannot"). */
  const wheel = a.TIME_WHEEL_FIELDS.find(f => f.sel === '#su-entry-long');
  assert.notEqual(wheel.optional, true, 'the longest run wheel still offers Clear');
});

// ---------------------------------------------------- the recent running screen

test('Continue on the recent running screen refuses a blank longest run', () => {
  const a = app();
  const seen = builderDom(a, { 'su-entry-long': '' });
  assert.equal(a.bldValidateStage(a.BLD_STAGE.YOU), false, 'Continue passed with no longest run');
  assert.deepEqual(seen.fails, [{ field: 'f-entry-long', message: REQUIRED_MSG }]);
});

test('Continue refuses the impossible set and names the arithmetic on the screen', () => {
  const a = app();
  const seen = builderDom(a, { 'su-volume': '97', 'su-entry-days': '5', 'su-entry-long': '2' });
  assert.equal(a.bldValidateStage(a.BLD_STAGE.YOU), false);
  assert.deepEqual(seen.fails, [{ field: 'f-entry-long', message: IMPOSSIBLE_MSG }]);
});

test('Continue passes a possible set and the non-runner\'s 0, 0, 0', () => {
  [{}, { 'su-volume': '0', 'su-entry-days': '0', 'su-entry-long': '0', 'su-entry-long-date': '' }].forEach(v => {
    const a = app();
    const seen = builderDom(a, v);
    assert.equal(a.bldValidateStage(a.BLD_STAGE.YOU), true, JSON.stringify(v) + ' was refused');
    assert.equal(seen.fails.length, 0);
  });
});

test('every field the new rules fail onto is on the recent running screen', () => {
  const a = app();
  const at = SRC.indexOf('<section class="bld-panel" data-stage="5" hidden>');
  const panel = SRC.slice(at, SRC.indexOf("'</section>'", at));
  assert.equal(a.BLD_STAGE.YOU, 5, 'the recent running screen moved; this test reads stage 5');
  ['f-entry-long', 'f-entry-days', 'f-entry-long-date'].forEach(id =>
    assert.ok(panel.indexOf('id="' + id + '"') !== -1, id + ' is not on the recent running screen'));
});

// ------------------------------------------------------------------ the Build

test('the Build stops on a blank longest run and builds nothing', async () => {
  const a = app();
  const seen = builderDom(a, { 'su-entry-long': '' });
  await a.handleGeneratePlan();
  assert.equal(seen.asks.length, 1, 'the athlete was not told');
  assert.equal(seen.asks[0].title, 'Check Your Answers');
  assert.equal(seen.asks[0].say, REQUIRED_MSG);
  assert.equal(seen.asks[0].yes, 'Change My Answers');
  assert.ok(!a.state.setup, 'a plan was built without the longest run');
  assert.equal((a.state.days || []).length, 0);
});

test('the Build stops on the impossible set, on the review page where the athlete is', async () => {
  const a = app();
  const seen = builderDom(a, { 'su-volume': '97', 'su-entry-days': '5', 'su-entry-long': '2' }, { onReview: true });
  await a.handleGeneratePlan();
  assert.equal(seen.asks.length, 0, 'a sheet was raised over the review page');
  assert.equal(seen.host.hidden, false, 'nothing was drawn on the review page');
  assert.ok(seen.host.innerHTML.indexOf(IMPOSSIBLE_MSG) !== -1, 'the review page does not say why');
  assert.match(seen.host.innerHTML, />Check Your Answers</);
  assert.match(seen.host.innerHTML, /data-action="bld-decide-yes">Change My Answers</);
  assert.ok(!a.state.setup, 'the plan was built from answers that cannot all be true');
  /* Change My Answers opens the recent running screen and marks the field. */
  const stages = [];
  a.bldStage = n => stages.push(n);
  a.bldDecideAnswer(true);
  assert.deepEqual(stages, [a.BLD_STAGE.YOU]);
  assert.equal(a.bldReviewReturn, true, 'Done would not return to the summary');
  assert.deepEqual(seen.fails.map(f => f.message), [IMPOSSIBLE_MSG]);
});

test('once corrected, the same answers build', async () => {
  const a = app();
  const seen = builderDom(a, { 'su-purpose': 'base', 'su-volume': '40', 'su-entry-days': '4', 'su-entry-long': '14' });
  await a.handleGeneratePlan();
  assert.equal(seen.asks.length, 0, 'a possible set was stopped: ' + JSON.stringify(seen.asks.map(x => x.say)));
  assert.ok(a.state.setup && a.state.days.length > 0, 'no plan was built');
  assert.equal(a.state.setup.entryEvidence.longestRunKm, 14);
  assert.equal(a.state.setup.entryEvidence.longestRunDate, '2026-11-09');
});

test('a race block from a possible set is not stopped by the new check', async () => {
  const a = app();
  const seen = builderDom(a, {});
  await a.handleGeneratePlan();
  assert.equal(seen.asks.filter(x => x.title === 'Check Your Answers').length, 0);
  assert.ok(a.state.setup && a.state.days.length > 0, 'no race plan was built: ' +
    JSON.stringify(seen.asks.map(x => x.title)) + ' ' + seen.modals.length + ' sheet(s)');
});

test('0 for a non-runner still goes to the low start', async () => {
  const zero = { 'su-volume': '0', 'su-entry-days': '0', 'su-entry-long': '0', 'su-entry-long-date': '' };
  /* Aerobic Base builds the low start directly: three runs, run/walk allowed. */
  const a = app();
  const seen = builderDom(a, Object.assign({ 'su-purpose': 'base' }, zero));
  await a.handleGeneratePlan();
  assert.equal(seen.asks.length, 0, 'the non-runner was stopped');
  assert.ok(a.state.setup, 'no plan was built for the non-runner');
  assert.equal(a.state.setup.runWalkStart, true, 'the 0km answer did not take the low start');
  assert.equal(a.state.setup.entryEvidence.longestRunKm, 0, 'the 0 was not kept as an answer');
  assert.equal(a.state.setup.entryEvidence.longestRunDate, null);
  /* A Race Goal is offered its pathway from the same low start, as before. */
  const r = app();
  const rs = builderDom(r, zero);
  await r.handleGeneratePlan();
  assert.equal(rs.asks.filter(x => x.title === 'Check Your Answers').length, 0, 'the non-runner was told their answers disagree');
  assert.ok(rs.asks.some(x => x.title === 'Choose Your Pathway'), 'the Race Goal low start offer was not reached');
});

// ------------------------------------------------- the other doors to the same answers

/* An athlete with a plan, whose stored answers predate the required longest
   run. Edit Plan Settings and Update Plan (data-action="open-setup") and the
   New Block page's race block (bldNewBlockIntent) all open this builder,
   pre-filled from state.setup.entryEvidence, and all build through
   handleGeneratePlan(). */
function athleteWithPlan(stored){
  const a = app();
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, startDate: a.addDays(TODAY, -21), benchSec: 48 * 60 });
  a.state.setup.entryEvidence = Object.assign({ recordedAt: '2026-10-28T09:00:00Z' }, stored);
  return a;
}
const domFromStored = (a, extra) => {
  const ee = a.state.setup.entryEvidence;
  return Object.assign({
    'su-volume': String(ee.weeklyKm),
    'su-entry-days': ee.runDaysPerWeek != null ? String(ee.runDaysPerWeek) : '',
    'su-entry-long': ee.longestRunKm != null ? String(a.kmToDisplay(ee.longestRunKm)) : '',
    'su-entry-long-date': ee.longestRunDate || ''
  }, extra || {});
};

test('the builder pre-fills a stored blank longest run as blank, not as 0', () => {
  /* openSetupModal()'s own reading, so the doors below are what the athlete sees. */
  const body = SRC.slice(SRC.indexOf('function openSetupModal()'));
  assert.match(body.slice(0, 4000), /var entryLong = ee\.longestRunKm != null \? kmToDisplay\(ee\.longestRunKm\) : '';/);
});

for (const door of ['Edit Plan Settings / Update Plan', 'Start a New Block (race)']){
  test(door + ': a stored blank longest run stops the rebuild, and the plan is untouched', async () => {
    const a = athleteWithPlan({ weeklyKm: 40, runDaysPerWeek: 4, longestRunKm: null, longestRunDate: null });
    if (door.indexOf('New Block') !== -1) a.bldNewBlockIntent = true;
    const before = { id: a.state.setup.blockId, n: a.state.days.length, first: a.state.days[0].date };
    const seen = builderDom(a, domFromStored(a), { onReview: true });
    await a.handleGeneratePlan();
    assert.ok(seen.host.innerHTML.indexOf(REQUIRED_MSG) !== -1, 'the review page does not ask for the longest run');
    assert.equal(a.state.setup.blockId, before.id);
    assert.equal(a.state.days.length, before.n);
    assert.equal(a.state.days[0].date, before.first);
  });

  test(door + ': stored answers that cannot all be true stop the rebuild', async () => {
    const a = athleteWithPlan({ weeklyKm: 97, runDaysPerWeek: 5, longestRunKm: 2, longestRunDate: '2026-11-01' });
    if (door.indexOf('New Block') !== -1) a.bldNewBlockIntent = true;
    const before = { id: a.state.setup.blockId, n: a.state.days.length };
    const seen = builderDom(a, domFromStored(a), { onReview: true });
    await a.handleGeneratePlan();
    assert.ok(seen.host.innerHTML.indexOf(IMPOSSIBLE_MSG) !== -1, 'the review page does not say why');
    assert.equal(a.state.setup.blockId, before.id);
    assert.equal(a.state.days.length, before.n);
  });

  test(door + ': corrected answers rebuild', async () => {
    const a = athleteWithPlan({ weeklyKm: 40, runDaysPerWeek: 4, longestRunKm: null, longestRunDate: null });
    if (door.indexOf('New Block') !== -1) a.bldNewBlockIntent = true;
    const seen = builderDom(a, domFromStored(a, { 'su-purpose': 'base', 'su-entry-long': '14', 'su-entry-long-date': '2026-11-09' }),
      { onReview: true });
    await a.handleGeneratePlan();
    assert.equal(seen.host.innerHTML.indexOf('Check Your Answers'), -1, 'corrected answers were stopped');
    assert.equal(a.state.setup.entryEvidence.longestRunKm, 14);
    assert.equal(a.state.setup.purpose, 'base');
  });
}

test('the review page shows the longest run row even when it is 0 or unanswered', () => {
  const at = SRC.indexOf('function bldRenderReview()');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(body, /if \(evR\)\{[\s\S]{0,300}row\('Longest recent run'/,
    'the longest run row is still hidden for a 0 or a blank answer');
});

test('a /start build carrying answers that cannot all be true is not adopted', () => {
  const PIN = '2026-08-20T09:00:00Z';
  const previewApp = loadApp({ pinnedDate: PIN });
  const v = Preview.validate({ purpose: 'race', distanceKey: 'half', weeks: 12, volume: 45,
    activeDays: [0, 1, 2, 4, 5], longRunDay: 5, benchmarkSeconds: 2700 });
  assert.equal(v.ok, true);
  const g = Preview.generate(previewApp, v.input);
  const build = Preview.buildEcho(v.input, g.startDate, g.raceDate, g.weeks);
  const bank = (ev) => {
    const a = loadApp({ pinnedDate: PIN });
    a.window.localStorage.setItem('vvv_pending_build', JSON.stringify({
      build: Object.assign({}, build, { entryEvidence: ev }), savedAt: new Date(PIN).getTime() }));
    return a;
  };
  const bad = bank({ weeklyKm: 97, runDaysPerWeek: 5, longestRunKm: 2, longestRunDate: '2026-08-10' });
  assert.equal(bad.adoptPendingBuildIfAny(), false, 'an impossible set was adopted as a plan');
  assert.ok(!bad.state.setup);
  const good = bank({ weeklyKm: 45, runDaysPerWeek: 5, longestRunKm: 14, longestRunDate: '2026-08-10' });
  assert.equal(good.adoptPendingBuildIfAny(), true, 'a possible set was refused');
  /* /start does not ask the longest run, so its absence does not refuse. */
  assert.equal(bank(undefined).adoptPendingBuildIfAny(), true, 'a build without answers was refused');
});

// ----------------------------------------------------------- logged runs still count

test('logged runs in the last 30 days still count beside the stated longest run', () => {
  const a = app();
  a.state.setup = Object.assign(a.state.setup || {}, {
    entryEvidence: { weeklyKm: 40, runDaysPerWeek: 4, longestRunKm: 14, longestRunDate: '2026-11-09', recordedAt: PINNED } });
  a.state.athlete = a.state.athlete || {};
  a.state.athlete.sessions = [{ date: '2026-11-08', completed: true, type: 'long', actualKm: 21, plannedKm: 20 }];
  assert.equal(a.longRunStepHistoryKm(TODAY), 21, 'a logged 21km run was outranked by a stated 14km');
  a.state.athlete.sessions = [{ date: '2026-11-08', completed: true, type: 'long', actualKm: 10, plannedKm: 10 }];
  assert.equal(a.longRunStepHistoryKm(TODAY), 14, 'the stated run no longer counts when a shorter one is logged');
  /* An answer of 0 does not erase what was logged. */
  a.state.setup.entryEvidence = { weeklyKm: 0, runDaysPerWeek: 0, longestRunKm: 0, longestRunDate: null, recordedAt: PINNED };
  a.state.athlete.sessions = [{ date: '2026-11-08', completed: true, type: 'long', actualKm: 12, plannedKm: 12 }];
  assert.equal(a.longRunStepHistoryKm(TODAY), 12);
});
