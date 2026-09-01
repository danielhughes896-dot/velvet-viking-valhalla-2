'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE STANDALONE FITNESS CHECKPOINT PANEL IS GONE FROM FULL PLAN
   =========================================================================
   IT WAS THE SAME DECISION, ASKED TWICE. Full Plan rendered a large panel
   between two programme weeks -- a heading, a paragraph about the checkpoint
   week, and the A/B/C Active Goal chooser -- while Plan HQ's Record tab
   already renders renderGoalToggle() beside renderCheckpointBanner(). One
   decision, two permanent surfaces, and the Full Plan copy interrupted the
   chronology to ask a question no evidence had yet raised.

   WHAT REPLACES IT: nothing, because nothing needed to. The checkpoint week is
   still named "Fitness Checkpoint" by weekPhaseLabel(), and the session still
   renders as an ordinary key-session card inside that week. Full Plan shows
   the training; the decision surface stays in Plan HQ.

   WHAT THIS FILE HOLDS SHUT: the panel not coming back to Full Plan, and none
   of the machinery underneath it being taken with it. */

const TODAY = '2026-09-02';
function athlete(opts) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  const { days } = buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45,
    weeks: 12, lthr: 172, maxHR: 188 }, opts || {}));
  const chk = days.filter(d => d.type === 'checkpoint')[0];
  assert.ok(chk, 'fixture must schedule a checkpoint, or these tests prove nothing');
  return { a, days, chk };
}

// =====================================================================
// 1. THE DUPLICATE SURFACE IS GONE
// =====================================================================

test('Full Plan no longer renders the standalone Fitness Checkpoint panel', () => {
  const { a } = athlete();
  [true, false].forEach(openAll => {
    const html = a.renderWeeksList(openAll);
    assert.doesNotMatch(html, /class="checkpoint"/,
      (openAll ? 'expanded' : 'collapsed') + ': the panel container must be gone');
    assert.doesNotMatch(html, /is your data point/, 'and its explanatory copy');
    assert.doesNotMatch(html, /Reconsider your Active Goal/, 'and its instruction');
  });
});

test('Full Plan carries no Active Goal A/B/C decision surface', () => {
  const { a } = athlete();
  const html = a.renderWeeksList(true);
  assert.doesNotMatch(html, /data-action="set-goal"/,
    'the goal chooser belongs to Plan HQ, not to the plan chronology');
  assert.doesNotMatch(html, /goal-toggle/);
});

test('the renderer and its CSS are gone, and nothing still calls them', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(CODE, /function renderCheckpointCard\(/, 'the renderer is removed');
  assert.doesNotMatch(CODE, /renderCheckpointCard\(\)\s*;|\+\s*renderCheckpointCard\(\)/,
    'and nothing calls it');
  assert.doesNotMatch(CODE, /^\s*\.checkpoint\{/m, 'its style rule is removed');
  /* A DIFFERENT CONTROL WITH A SIMILAR NAME. .checkpoint-banner is Plan HQ's
     and must survive the cleanup untouched. */
  assert.match(CODE, /\.checkpoint-banner\{/, '.checkpoint-banner is a different control and stays');
});

test('Full Plan chronology closes cleanly — no empty container left behind', () => {
  const { a, chk } = athlete();
  const html = a.renderWeeksList(false);
  // the checkpoint week's card is immediately followed by the next week's,
  // with nothing between them
  const weeks = [...html.matchAll(/id="week-(\d+)"/g)].map(m => +m[1]);
  const i = weeks.indexOf(chk.week);
  assert.ok(i !== -1, 'the checkpoint week still renders');
  if (i + 1 < weeks.length) {
    const from = html.indexOf('id="week-' + chk.week + '"');
    const to = html.indexOf('id="week-' + weeks[i + 1] + '"');
    const between = html.slice(from, to);
    assert.doesNotMatch(between, /class="checkpoint"/);
    assert.doesNotMatch(between, /<div[^>]*>\s*<\/div>\s*$/, 'no empty container is left');
  }
});

// =====================================================================
// 2. THE CHECKPOINT IS STILL REPRESENTED
// =====================================================================

test('the checkpoint week is still visibly identified as one', () => {
  const { a, chk } = athlete();
  assert.equal(a.weekPhaseLabel(chk.week), 'Fitness Checkpoint');
  const html = a.renderWeeksList(false);
  const card = html.slice(html.indexOf('id="week-' + chk.week + '"'));
  assert.match(card.slice(0, 800), /Fitness Checkpoint/,
    'the week designation still names it on the card head');
});

test('the checkpoint session still renders inside its week', () => {
  const { a, chk } = athlete();
  const html = a.renderWeeksList(true);
  assert.ok(html.indexOf('id="day-' + chk.id + '"') !== -1, 'the session card is present');
  assert.ok(html.indexOf(chk.title) !== -1, 'with the engine’s own title: ' + chk.title);
  assert.match(chk.title, /Time Trial/, 'which is still the time trial the engine supplies');
});

test('the checkpoint keeps its key-session designation', () => {
  const { a, chk } = athlete();
  assert.equal(a.sessionImportance(chk), 'KEY',
    'a checkpoint is still a key session — that is engine, not presentation');
});

test('expanding and collapsing the checkpoint week still works', () => {
  const { a, chk } = athlete();
  const collapsed = a.renderWeekAccordion(chk.week, false);
  const expanded = a.renderWeekAccordion(chk.week, true);
  assert.match(collapsed, /class="week[^"]*"/);
  assert.doesNotMatch(collapsed, /class="week open/, 'collapsed by default');
  assert.match(expanded, /class="week open/, 'and opens when asked');
  assert.match(collapsed, /data-action="toggle-week" data-week="' + chk.week + '"|data-action="toggle-week"/,
    'the toggle control is intact');
  assert.ok(expanded.indexOf('id="day-' + chk.id + '"') !== -1,
    'and the session is inside it either way');
});

// =====================================================================
// 3. NOTHING UNDERNEATH WAS TAKEN WITH IT
// =====================================================================

test('the Active Goal machinery survives, and still lives in Plan HQ', () => {
  const { a } = athlete();
  assert.equal(typeof a.renderGoalToggle, 'function', 'the chooser itself is untouched');
  assert.equal(typeof a.handleSetGoal, 'function', 'and so is its handler');
  assert.equal(typeof a.renderCheckpointBanner, 'function', 'and Plan HQ’s own banner');
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.match(CODE, /renderCheckpointBanner\(\)\+renderGoalToggle\(\)\+renderRecordSection\(\)/,
    'Plan HQ’s Record tab still composes the goal chooser — the decision surface remains');
  assert.match(CODE, /case 'set-goal': handleSetGoal/, 'and its event route is intact');
});

test('checkpoint scheduling and calibration are unchanged', () => {
  const { a, chk, days } = athlete();
  assert.equal(days.filter(d => d.type === 'checkpoint').length, 1,
    'exactly one checkpoint, scheduled by the engine as before');
  assert.ok(chk.week > 1 && chk.week < a.totalWeeksInPlan(), 'placed mid-block');
  assert.ok(chk.prescription || chk.desc, 'and carrying its own prescription');
  assert.equal(typeof a.recordMeasuredPerformance, 'function', 'recalibration path intact');
});

test('goal state and current-fitness reads are untouched', () => {
  const { a } = athlete();
  const before = JSON.stringify({
    goal: a.state.setup.goal || null,
    vdot: a.getActiveVDOT(),
    paces: a.getActivePaces(),
    goalPace: a.getGoalPaceSecPerKm(),
  });
  a.renderWeeksList(true); a.renderWeeksList(false);
  assert.equal(JSON.stringify({
    goal: a.state.setup.goal || null,
    vdot: a.getActiveVDOT(),
    paces: a.getActivePaces(),
    goalPace: a.getGoalPaceSecPerKm(),
  }), before, 'rendering Full Plan must not touch goal or fitness state');
});

test('programme output is unchanged by the removal', () => {
  const { a, days } = athlete();
  const snap = days.map(d => [d.id, d.date, d.type, d.km, d.title,
    d.prescription ? JSON.stringify(d.prescription) : null].join('~')).join('|');
  a.renderWeeksList(true);
  assert.equal(days.map(d => [d.id, d.date, d.type, d.km, d.title,
    d.prescription ? JSON.stringify(d.prescription) : null].join('~')).join('|'), snap);
  // and the generator still produces the same block it did
  const again = a.buildBlockWeeks('half', 45, 12);
  assert.equal(JSON.stringify(again), JSON.stringify(a.buildBlockWeeks('half', 45, 12)));
});

test('no Athlete Experience recommendation behaviour was added', () => {
  /* Explicit HQ boundary: this task must not start recommending a level change
     from calibration evidence. That belongs to the SYSTEM attack. */
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(CODE, /recommendExperience|suggestExperience|experienceRecommendation/i,
    'no experience-recommendation surface may appear in this branch');
});
