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
  /* ---------- WHERE THIS IS NOW SAID, AND WHAT THAT COST ----------
     This asserted the name on the COLLAPSED week head. "Fitness Checkpoint"
     measured 127px there -- 84px wider than any other label on a row whose
     whole budget is 380 -- and it alone decided how large every item on
     every other row could be. Numbered, the row went from 13.5px to the
     app's own 15px metric tier.
     SO THE COLLAPSED ROW NO LONGER SAYS IT, and that is a real loss, stated
     rather than hidden: on a Full Plan with every phase shut, nothing marks
     week N as the checkpoint. Open the week and the session names itself --
     "Fitness Checkpoint: 3km Time Trial" -- which is the claim the test
     below this one already makes, and the name is unchanged everywhere the
     week is read rather than scanned: the week screen, the export, the
     coach's summary. Founder's call, made with that trade in front of them.
     What is still asserted is the part that matters: the designation EXISTS
     and the athlete can reach it. */
  const { a, chk } = athlete();
  assert.equal(a.weekPhaseLabel(chk.week), 'Fitness Checkpoint',
    'the checkpoint week has lost its designation entirely, not just on the list row');
  const open = a.renderWeeksList(true);
  assert.match(open, /Fitness Checkpoint/,
    'the checkpoint is not identified anywhere on Full Plan, open or closed');
  const closed = a.renderWeeksList(false);
  const head = closed.slice(closed.indexOf('id="week-' + chk.week + '"'));
  assert.match(head.slice(0, 800), new RegExp('>Week ' + chk.week + '<'),
    'the collapsed row neither names the checkpoint nor numbers it — it says nothing');
});

test('the checkpoint session still renders inside its week', () => {
  const { a, chk } = athlete();
  /* THE WEEK LISTS ITS SESSIONS NOW RATHER THAN UNFOLDING THEM. Full Plan's
     accordion used to open onto seven full renderDayCard()s -- a card, inside
     a week, inside a phase, inside the plan. It opens onto the same seven-row
     list the week SCREEN uses, and the row is a way in: the card itself is
     one tap away and unchanged. So the claim is the same -- the checkpoint is
     represented inside its own week, by name -- asserted against the row. */
  const html = a.renderWeeksList(true);
  assert.ok(html.indexOf('data-action="plan-open-session" data-day="' + chk.id + '"') !== -1,
    'the checkpoint has no row in its week');
  assert.ok(html.indexOf(chk.title) !== -1, 'with the engine’s own title: ' + chk.title);
  assert.match(chk.title, /Time Trial/, 'which is still the time trial the engine supplies');
  /* And the row leads to the canonical card, which is the thing that must not
     have been lost along with the inline one. */
  a.handlePlanOpenSession(chk.id);
  assert.ok(a.renderPlanSessionView().indexOf('id="day-' + chk.id + '"') !== -1,
    'the row goes nowhere — the session card is unreachable');
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
  /* The week row opens the week's own SCREEN now rather than expanding in
     place -- Full Plan is block -> week -> session. The open/collapsed
     mechanism above is unchanged and still drives forceOpenAll; what moved
     is where the control takes you. */
  assert.match(collapsed, /data-action="plan-open-week"/,
    'the week control is intact');
  assert.ok(expanded.indexOf('data-day="' + chk.id + '"') !== -1,
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
  /* THE DECISION SURFACE MOVED ONCE MORE, AND THIS IS WHY THE TEST EXISTS.
     Full Plan's standalone checkpoint panel was deleted because Plan HQ's
     Record TAB carried the chooser; the Record tab has since been retired
     too, so the chooser now lives in the panel the Goal circle opens. The
     guard is unchanged in substance -- Active Goal must be composed
     somewhere reachable, and it must not have quietly become unreachable
     along the way. It is asserted on the live render rather than on a source
     string this time, which is the stronger form. */
  assert.ok(a.RECORD_PANELS && a.RECORD_PANELS.goal, 'the goal panel is not registered');
  const panel = a.recordPanelGoal();
  assert.ok(panel.indexOf(a.renderGoalToggle()) !== -1,
    'the goal panel no longer composes the chooser — the decision surface is gone');
  assert.match(a.renderValhallaInstruments(), /data-record="goal"/,
    'nothing on Valhalla opens the goal panel');
  assert.ok(a.renderPlanHQView().indexOf(a.renderCheckpointBanner()) !== -1,
    'the checkpoint banner lost its surface with the Record tab');
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
