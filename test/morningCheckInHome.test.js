'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE MORNING CHECK-IN HAS A HOME, AND LOOKS LIKE THE REST OF THE APP.
 *
 * Founder: "Morning check in. I didn't see that today. So make sure that
 * matches the new colour and structure."
 *
 * It could not be seen because nothing drew it. The check-in was written
 * inside renderCoachNextMoveCard(), and that card came off Today by an
 * earlier ruling with the question still inside it -- so the three answers
 * coachDecision() reads (heavy legs, poor sleep, under the weather) could no
 * longer be given at all. Every existing test still passed, because they call
 * the render function directly; none asked whether a screen calls it.
 *
 * These laws ask that, and pin the look: no raised dashed box, no pills, no
 * grey or bronze text, and the Build a Plan tile with its tick for an answer.
 */

const PINNED = '2026-11-10T07:30:00';
const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

function quiet(app) {
  app.showToast = () => {}; app.renderApp = () => {}; app.flushSave = () => {}; app.scheduleSave = () => {};
  return app;
}
/* A morning with quality work ahead and a reason for the coach to ask: every
   run so far logged as prescribed, and soreness written on the last one. */
function concernedMorning(opts) {
  const app = quiet(loadApp({ pinnedDate: PINNED }));
  const today = app.todayStr();
  for (let back = 5; back <= 40; back++) {
    const r = buildPlan(app, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188,
      startDate: app.addDays(today, -back) }, opts || {}));
    const t = r.days.filter((d) => d.date === today)[0];
    if (!t || t.type === 'rest' || app.isRecoveryWorkoutType(t.type)) continue;
    const past = r.days.filter((d) => d.date < today && d.type !== 'rest');
    if (past.length < 4) continue;
    past.forEach((d) => logAsPrescribed(app, d, { quality: 1 }));
    past[past.length - 1].actual.notes = 'sharp pain in my calf, had to slow down';
    return app;
  }
  throw new Error('no start date gives a quality session today');
}
const cssRule = (selector) => {
  const i = CODE.indexOf(selector + '{');
  assert.ok(i > 0, selector + ' must have a rule');
  return CODE.slice(i, CODE.indexOf('}', i));
};

/* ---------- it is on a screen ---------- */

/* ---- WHEN IT IS ASKED HAS CHANGED ----
   It first came back under its old rule: only where the coach had a concern
   and quality work was next. Founder, to "Should the check-in ask every
   morning? Three taps would give Recovery real evidence from day one":
   "yes". The laws below ask it of an ordinary morning and a rest day too. */
test('Today asks the morning check-in on a morning the coach has a concern', () => {
  const app = concernedMorning();
  const dec = app.coachAnalyse().decision;
  assert.equal(dec.readinessEarned, true, 'the fixture must be a morning the check-in is earned on');
  /* Founder: "Make daily check in behave like the settings bottom pops up."
     Today carries the row that raises it; the sheet carries the questions. */
  const html = app.renderTodayView();
  assert.match(html, /class="today-checkin is-ask"/);
  assert.match(html, /How are you today\?/);
  assert.match(html, /data-action="open-checkin-sheet"/);
  assert.equal((app.checkinSheetBody().match(/data-action="set-readiness"/g) || []).length, 8, 'three legs, three sleep, two health');
});

test('it is asked before the session is read, not after it', () => {
  const html = concernedMorning().renderTodayView();
  const ask = html.indexOf('class="today-checkin is-ask"');
  const session = html.indexOf('class="day-top"');
  assert.ok(ask > 0 && session > 0);
  assert.ok(ask < session, 'an answer can change what is advised for the session');
});

test('a screen draws it: the function that mounts it is called from Today', () => {
  const start = CODE.indexOf('function renderTodayView(){');
  const end = CODE.indexOf('\nfunction ', start + 10);
  assert.match(CODE.slice(start, end), /renderTodayCheckIn\(\)/,
    'the check-in was unreachable for as long as no view called it');
});

test('and on an ordinary morning with nothing wrong: it is asked every day', () => {
  const app = concernedMorning();
  app.state.days.forEach((d) => { if (d.actual) d.actual.notes = ''; });
  assert.equal(app.coachAnalyse().decision.readinessEarned, false,
    'the coach has no concern -- which used to mean the athlete was not asked');
  const html = app.renderTodayView();
  assert.match(html, /class="today-checkin is-ask"/);
  assert.match(html, /How are you today\?/);
});

test('it is asked on a rest day as well', () => {
  const app = concernedMorning();
  const today = app.state.days.filter((d) => d.date === app.todayStr())[0];
  today.type = 'rest'; today.km = 0; today.title = 'Rest';
  delete today.prescription;
  app.state.days.forEach((d) => { if (d.actual) d.actual.notes = ''; });
  assert.match(app.renderTodayView(), /How are you today\?/);
});

test('heavy legs reported on an ordinary morning reach the coach', () => {
  const app = concernedMorning();
  app.state.days.forEach((d) => { if (d.actual) d.actual.notes = ''; });
  assert.doesNotMatch(app.coachDecision().reasons.join(' | '), /heavy legs/i);
  app.handleSetReadiness('legs', 'heavy');
  assert.match(app.coachDecision().reasons.join(' | '), /heavy legs/i);
});

test('with no plan there is nothing to ask against', () => {
  const app = concernedMorning();
  app.state.setup = null; app.state.days = [];
  assert.equal(app.renderTodayCheckIn(), '');
});

test('it is not put to an athlete who has not agreed to health questions', () => {
  const app = concernedMorning({ healthConsent: false });
  assert.doesNotMatch(app.renderTodayView(), /today-checkin|How are you today/);
});

/* ---- THIS LAW HAS CHANGED SIDES ----
   It required the confirming line to stay where the question was, above the
   session. Founder: "Once daily check in is done. Can it move to under ill
   or injured. Pure white text." A question belongs where the day starts; a
   receipt was holding the top of Today all day. */
test('answered in full, its one confirming line moves under the Injured or ill signpost', () => {
  const app = concernedMorning();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'ok');
  app.handleSetReadiness('health', 'good');
  const html = app.renderTodayView();
  assert.equal((html.match(/class="today-checkin/g) || []).length, 1, 'drawn in one place, never two');
  assert.match(html, /class="today-checkin is-done"><div class="readiness-done">/);
  /* Founder: "fix the check-in symbols" -- the answers stand apart by space,
     not on middle dots. */
  assert.match(html, /<span>Heavy legs<\/span><span>Sleep OK<\/span><span>Health good<\/span>/);
  assert.doesNotMatch(html, /How are you today\?/);
  const receipt = html.indexOf('class="today-checkin');
  assert.ok(receipt > html.indexOf('class="day-top"'), 'no longer above the session');
  assert.ok(receipt > html.indexOf('Injured or ill?'), 'under the signpost');
  assert.match(html.slice(receipt), /Health good<\/span><\/span><\/button><\/div><\/div><\/div>$/,
    'and it is the last thing on Today');
});

test('reopened to change an answer, it opens where it was tapped, at the foot', () => {
  const app = concernedMorning();
  ['legs:heavy', 'sleep:ok', 'health:good'].forEach((p) => app.handleSetReadiness.apply(app, p.split(':')));
  const got = [];
  app.openModal = (h, cls) => got.push({ h, cls });
  app.handleReadinessEdit();
  const html = app.renderTodayView();
  const panel = html.indexOf('class="today-checkin');
  assert.ok(panel > html.indexOf('Injured or ill?'), 'the line stays at the foot');
  assert.equal(got.length, 1, 'tapping it raises the sheet');
  assert.equal((got[0].h.match(/data-action="set-readiness"/g) || []).length, 8);
});

test('the confirming line is pure white', () => {
  const i = CODE.indexOf('  .today-checkin.is-done .readiness-done-head,');
  assert.ok(i > 0);
  const body = CODE.slice(i, CODE.indexOf('}', i));
  assert.match(body, /\.today-checkin\.is-done \.readiness-done-line\{color:#FFFFFF;/);
});

test('the answers given on Today reach the coach', () => {
  const app = concernedMorning();
  app.handleSetReadiness('legs', 'heavy');
  const reasons = app.coachDecision().reasons.join(' | ');
  assert.match(reasons, /heavy legs/i);
});

/* ---------- it looks like the rest of the app ---------- */

test('no raised or dashed box around the question or its confirmation', () => {
  ['  .readiness', '  .readiness-done-btn'].forEach((sel) => {
    const body = cssRule(sel);
    assert.doesNotMatch(body, /dashed/, sel + ' must not draw a dashed frame');
    assert.doesNotMatch(body, /background:var\(--surface-2\)/, sel + ' must not sit on a raised surface');
  });
});

test('the answers are tiles, not pills', () => {
  const body = cssRule('  .readiness-btn');
  assert.doesNotMatch(body, /border-radius:99px/);
  assert.match(body, /border-radius:var\(--tile-radius\)/);
  const m = body.match(/min-height:(\d+)px/);
  assert.ok(m && Number(m[1]) >= 56, 'a thumb-sized tile, as in the builder');
});

test('a chosen answer is lit like a chosen builder tile and carries the tick', () => {
  const on = cssRule('  .readiness-btn.on');
  assert.match(on, /border-color:var\(--cherry\)/);
  assert.match(on, /box-shadow:0 0 16px var\(--cherry-dim\)/);
  const tick = cssRule('  .readiness-btn.on::after');
  assert.match(tick, /var\(--tick-mask\)/);
  assert.match(tick, /background-color:var\(--cherry-text\)/);
});

test('every word in the check-in is white: no grey, no bronze', () => {
  const start = CODE.indexOf('  .readiness{');
  const end = CODE.indexOf('/* ---------- week status');
  const block = CODE.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(block, /--ink-faint|--ink-dim|--bronze-text|--ink-quiet/);
  ['  .readiness-head', '  .readiness-label', '  .readiness-btn', '  .readiness-done-head', '  .readiness-done-line']
    .forEach((sel) => assert.match(cssRule(sel), /color:var\(--ink\)/, sel + ' must be white'));
});

/* ---------- what an answer is allowed to do ----------
   Founder: "morning check-in needs a clear safety interpretation. Heavy legs
   alone shouldn't automatically downgrade a workout. Heavy legs plus poor
   sleep plus illness symptoms should be interpreted differently."
   This is what the engine already did; these laws hold it there now that the
   question is asked every morning and so is answered far more often. */

function ordinaryMorning(answers) {
  const app = concernedMorning();
  app.state.days.forEach((d) => { if (d.actual) d.actual.notes = ''; });
  Object.keys(answers || {}).forEach((k) => app.handleSetReadiness(k, answers[k]));
  const report = app.coachAnalyse();
  const today = app.state.days.filter((d) => d.date === app.todayStr())[0];
  return { app, report, today, typeBefore: today.type, kmBefore: today.km };
}

test('heavy legs alone are watched: no change to the session is offered', () => {
  const { report, app } = ordinaryMorning({ legs: 'heavy' });
  assert.equal(report.decision.state, 'check');
  assert.ok(!report.nextMove.adjustment, 'a downgrade was offered for heavy legs on their own');
  assert.deepEqual(Array.from((app.planEvolution() || {}).changes || []), []);
});

test('heavy legs and poor sleep together are still only watched', () => {
  const { report, app } = ordinaryMorning({ legs: 'heavy', sleep: 'poor' });
  assert.equal(report.decision.state, 'check');
  assert.ok(!report.nextMove.adjustment);
  assert.deepEqual(Array.from((app.planEvolution() || {}).changes || []), []);
  assert.match(report.decision.reasons.join(' | '), /heavy legs/i);
  assert.match(report.decision.reasons.join(' | '), /poor sleep/i);
});

test('feeling under the weather is a safety reading: recovery comes first and a change is offered', () => {
  const { report, app } = ordinaryMorning({ legs: 'heavy', sleep: 'poor', health: 'under' });
  assert.equal(report.decision.state, 'recover');
  const evo = app.planEvolution();
  assert.equal(evo.state, 'RECOVER');
  assert.ok(evo.changes.length >= 1, 'illness before quality work must put a lighter day on the table');
});

test('and that change is offered, never applied: the session is untouched until the athlete accepts', () => {
  const { today, typeBefore, kmBefore } = ordinaryMorning({ health: 'under' });
  assert.equal(today.type, typeBefore);
  assert.equal(today.km, kmBefore);
  assert.ok(!today.coachAdjust, 'nothing may rewrite the day on the strength of a check-in alone');
});

test('a morning with every answer fine changes nothing at all', () => {
  const { report } = ordinaryMorning({ legs: 'fresh', sleep: 'good', health: 'good' });
  assert.equal(report.decision.state, 'proceed');
  assert.ok(!report.nextMove.adjustment);
});

/* ---------- the tiles: big, not wide, and centred ----------
   Founder: "The boxes can be wrapped smaller slightly. I like the bigness of
   them. But they're too wide. Centre the text vertically." */

test('the answer tiles keep their height and lose their width', () => {
  assert.match(cssRule('  .readiness-opts'), /grid-template-columns:repeat\(3, minmax\(0,104px\)\)/,
    'three capped columns: a two-answer question must not split the row in half');
  const tile = cssRule('  .readiness-btn');
  const m = tile.match(/min-height:(\d+)px/);
  assert.ok(m && Number(m[1]) >= 60, 'the bigness stays');
});

test('the words sit in the middle of the tile, chosen or not', () => {
  const tile = cssRule('  .readiness-btn');
  assert.match(tile, /display:flex; align-items:center; justify-content:center;/);
  assert.doesNotMatch(tile, /padding:\d+px \d+px 26px/, 'room held under the label pushes it off centre');
  const tick = cssRule('  .readiness-btn.on::after');
  assert.match(tick, /right:8px; top:8px;/, 'the tick is in the corner, so choosing an answer does not move its words');
});

test('the sheet rises by itself once a day on Today, and never over something else', () => {
  const app = concernedMorning();
  const got = [];
  app.openModal = (h, cls, key) => got.push({ h, cls, key });
  app.state.view = 'today';
  app.document.getElementById = () => null;          // nothing else is up
  app.maybeRaiseCheckinSheet(false);
  assert.equal(got.length, 1, 'the sheet did not rise on Today');
  assert.match(got[0].cls, /\bstg-sheet\b/);
  assert.equal(got[0].key, 'checkin');
  app.maybeRaiseCheckinSheet(false);
  assert.equal(got.length, 1, 'dismissed, it rose again the same day');
  const b = concernedMorning();
  const gotB = [];
  b.openModal = (h) => gotB.push(h);
  b.state.view = 'week'; b.maybeRaiseCheckinSheet(false);
  b.state.view = 'today'; b.maybeRaiseCheckinSheet(true);
  assert.equal(gotB.length, 0, 'it rose off Today, or over the arrival screen');
});

test('the boxes in the sheet are thinner, and still a full tap tall', () => {
  const i = CODE.indexOf('  .checkin-sheet .readiness-btn{');
  assert.ok(i > 0);
  const rule = CODE.slice(i, CODE.indexOf('}', i));
  assert.match(rule, /min-height:var\(--tap-min\)/);
  assert.match(rule, /border-color:rgba\(255,255,255,\.1\)/);
});
