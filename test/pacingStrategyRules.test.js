'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* Founder: "Goal day pacing strategy. Needs the new rules putting in." and,
   of Re-calibrate, "has a erm - in. Remove". */
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
function opened(fn, prep){
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'full', startDate: '2026-04-08' });
  a.state.setup.goals = { A: { timeSec: 11987 }, B: { timeSec: 12585 }, C: { timeSec: 13249 } };
  if (prep) prep(a);
  let html = null; a.openModal = h => { html = h; };
  a[fn]();
  return html;
}
const words = h => h.slice(h.indexOf('<div class="modal-body">')).replace(/<[^>]+>/g, ' ');

test('PACING: no em dash, no icon, the note is SACORO’s Read', () => {
  const h = opened('openPacingModal');
  assert.doesNotMatch(words(h), /— /, 'an em dash is back in the copy');
  assert.doesNotMatch(h.slice(h.indexOf('<div class="modal-body">')), /<svg/, 'an icon is back');
  assert.match(h, /Full Marathon\. Even-effort cumulative splits for each goal\./);
  assert.match(h, /SACORO’s Read/);
});

test('PACING: the active goal is the cherry column, wherever it is', () => {
  const h = opened('openPacingModal', a => { a.state.setup.activeGoal = 'B'; });
  assert.match(h, /<th class="goal-col-on">Goal B<\/th>/);
  assert.doesNotMatch(h, /<th class="goal-col-on">Goal A/);
  assert.match(CSS, /\.pace-table \.goal-col-on\{[^}]*var\(--cherry\)/);
});

test('PACING: every figure white, the finish too, and no header under the 11px floor', () => {
  assert.match(CSS, /\.pace-table tr:last-child td\{[^}]*color:#FFFFFF/);
  assert.doesNotMatch(CSS, /\.pace-table[^{]*\{[^}]*color:var\(--gold\)/);
  const th = /\.pace-table th\{[^}]*font-size:([\d.]+)rem/.exec(CSS);
  assert.ok(th && +th[1] * 16 >= 11, 'the column headers are below the 11px floor');
});

test('RE-CALIBRATE: the em dashes are gone', () => {
  const h = opened('openRecalibrateModal');
  assert.doesNotMatch(words(h), /—/);
  assert.match(h, /<div class="setup-section-title">Full Marathon Goals<\/div>/);
});

test('OPEN WEEK: the checkpoint button opens that week’s own page, with nothing over it', () => {
  /* Founder: "Open week 9 does link to week 9?" */
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  buildPlan(a, { weeks: 16, distanceKey: 'half', startDate: '2026-04-08' });
  const chk = a.scheduledCheckpointDay();
  a.handleGoToCheckpoint();
  assert.equal(a.state.view, 'full');
  assert.equal(a.planWeekOpen, chk.week, 'the plan opened somewhere other than the checkpoint’s week');
  assert.equal(a.insightHoldOnce, true, 'an explainer may rise over the week it was sent to');
  assert.equal(a.weekSelectedDay(chk.week).date, chk.date, 'the week opened on another day than the checkpoint');
});
