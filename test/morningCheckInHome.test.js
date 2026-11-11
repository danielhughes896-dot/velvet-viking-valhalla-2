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
  const html = app.renderTodayView();
  assert.match(html, /class="today-checkin"/);
  assert.match(html, /How are you today\?/);
  assert.equal((html.match(/data-action="set-readiness"/g) || []).length, 8, 'three legs, three sleep, two health');
});

test('it is asked before the session is read, not after it', () => {
  const html = concernedMorning().renderTodayView();
  const ask = html.indexOf('class="today-checkin"');
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
  assert.match(html, /class="today-checkin"/);
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

test('answered in full, it folds to one confirming line in the same place', () => {
  const app = concernedMorning();
  app.handleSetReadiness('legs', 'heavy');
  app.handleSetReadiness('sleep', 'ok');
  app.handleSetReadiness('health', 'good');
  const html = app.renderTodayView();
  assert.match(html, /class="today-checkin"><div class="readiness-done">/);
  assert.match(html, /Heavy legs · Sleep OK · Health good/);
  assert.doesNotMatch(html, /How are you today\?/);
  assert.ok(html.indexOf('class="today-checkin"') < html.indexOf('class="day-top"'));
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
