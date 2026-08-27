'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* MANUAL LOGGING — ASK FOR LESS, KEEP EVERYTHING
 * ===========================================================================
 * The whole-session panel asked six questions at once -- distance, pace, heart
 * rate, RPE, feel and notes -- flat, in one block, every one the same size. An
 * athlete recording that they ran 8 km scrolled past four fields they had no
 * intention of filling, and a form that asks six things reads as a form that
 * WANTS six things.
 *
 * THE THREE RUNGS, and each claims strictly less than the one above:
 *
 *   always visible   distance, pace          -> what the engine grades against
 *   + Add detail     HR, RPE, feel, notes    -> athlete context, optional
 *   + breakdown      warm-up / reps / cool   -> section-level evidence
 *
 * WHAT THIS FILE EXISTS TO STOP. Simplification that quietly deletes evidence,
 * hides an athlete's own record from them, weakens a consent gate, or flattens
 * what a watch or a connected service supplied. Fewer questions, same answers.
 */

const TODAY = '2026-08-24';
function app(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, Object.assign({ weeks: 14, startDate: '2026-07-01', distanceKey: '10k',
    volume: 40, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } }, o.plan || {}));
  return a;
}
const threshold = a => a.state.days.filter(d => d.type === 'threshold')[0];
function logged(a, actual){
  const dd = threshold(a);
  dd.completed = true;
  dd.actual = actual;
  return dd;
}
const card = (a, dd) => a.renderDayCard(dd);
const has = (html, field) => new RegExp('data-field="' + field + '"').test(html);

// ---------------------------------------------------------------------------
// THE DEFAULT SURFACE
// ---------------------------------------------------------------------------
test('a completed session asks for distance and pace, and nothing else', () => {
  const a = app();
  const html = card(a, logged(a, { km: 8 }));
  assert.ok(has(html, 'km'), 'distance is not asked for');
  assert.ok(has(html, 'pace'), 'pace is not asked for');
  assert.ok(!has(html, 'hr'), 'heart rate is still on the default surface');
  assert.ok(!has(html, 'rpe'), 'RPE is still on the default surface');
  assert.ok(!has(html, 'notes'), 'notes are still on the default surface');
  assert.match(html, /data-action="toggle-detail"/, 'there is no way to reach the detail');
});

test('pace is offered as optional, never as a requirement', () => {
  /* A missing pace narrows what Valhalla will CLAIM. It is not a failure and
     must not be presented as one. */
  const a = app();
  const html = card(a, logged(a, { km: 8 }));
  assert.match(html, /Avg Pace[^<]*optional/i, 'pace does not read as optional');
  assert.ok(!/required|must|need to log/i.test(html.slice(html.indexOf('data-field="pace"') - 200,
                                                          html.indexOf('data-field="pace"'))),
    'the pace field is framed as compulsory');
});

test('distance alone still earns a real assessment on the same card', () => {
  const a = app();
  const html = card(a, logged(a, { km: threshold(a).km }));
  assert.match(html, /Session completed/, 'a distance-only log is met with an instruction, not an assessment');
});

// ---------------------------------------------------------------------------
// ADD DETAIL — offered, not demanded; and never hiding what exists
// ---------------------------------------------------------------------------
test('opening the detail reveals every field that used to be flat', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  a.handleToggleDetail(dd.id);
  const html = card(a, dd);
  ['hr', 'rpe', 'notes'].forEach(f =>
    assert.ok(has(html, f), f + ' was lost rather than disclosed'));
  assert.match(html, /data-action="set-feel"/, 'feel was lost rather than disclosed');
});

test('a day that already carries detail opens showing it', () => {
  /* An existing record can never be made less visible than it was. */
  const a = app();
  [{ rpe: 6 }, { hr: 158 }, { feel: 'good' }, { notes: 'Windy.' }].forEach(extra => {
    const b = app();
    const dd = logged(b, Object.assign({ km: 8 }, extra));
    const html = card(b, dd);
    assert.match(html, /aria-expanded="true"/,
      'a record carrying ' + Object.keys(extra)[0] + ' opened closed, hiding the athlete\'s own data');
  });
});

test('an empty log stays closed, and toggling is symmetric', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  assert.equal(a.isDetailOpen(dd), false);
  a.handleToggleDetail(dd.id);
  assert.equal(a.isDetailOpen(dd), true);
  a.handleToggleDetail(dd.id);
  assert.equal(a.isDetailOpen(dd), false, 'the control does not close again');
});

test('closing the detail never discards a stored value', () => {
  const a = app();
  const dd = logged(a, { km: 8, hr: 152, rpe: 7, notes: 'Solid.' });
  a.handleToggleDetail(dd.id);              // explicitly closed
  assert.equal(a.isDetailOpen(dd), false);
  assert.equal(dd.actual.hr, 152, 'heart rate was dropped by a UI toggle');
  assert.equal(dd.actual.rpe, 7);
  assert.equal(dd.actual.notes, 'Solid.');
});

// ---------------------------------------------------------------------------
// CONSENT GATES SURVIVE THE MOVE
// ---------------------------------------------------------------------------
test('without health consent, heart rate and feel are absent even when the detail is open', () => {
  const a = app({ plan: { healthConsent: false } });
  const dd = logged(a, { km: 8 });
  a.handleToggleDetail(dd.id);
  const html = card(a, dd);
  assert.equal(a.healthConsentGranted(), false, 'the fixture granted consent');
  assert.ok(!has(html, 'hr'), 'a heart-rate box appeared without consent');
  assert.ok(!/data-action="set-feel"/.test(html), 'a feel control appeared without consent');
  /* RPE and notes are ordinary training data and are unaffected. */
  assert.ok(has(html, 'rpe'), 'RPE was gated on health consent');
  assert.ok(has(html, 'notes'), 'notes were gated on health consent');
});

// ---------------------------------------------------------------------------
// THE THIRD RUNG IS UNTOUCHED
// ---------------------------------------------------------------------------
test('the session breakdown keeps its own disclosure, above and beyond the detail', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  const html = card(a, dd);
  assert.match(html, /data-action="toggle-splits"/, 'the segment breakdown is unreachable');
  /* Two independent controls: collapsing the detail must not collapse the
     breakdown, and neither must swallow the other. */
  assert.notEqual(html.indexOf('data-action="toggle-detail"'),
                  html.indexOf('data-action="toggle-splits"'));
});

test('segment evidence is still segment evidence, and is never fabricated', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  const b = a.computeExecutionBreakdown(dd);
  assert.equal(b, null, 'a distance-only log started scoring execution');
  const c = a.computeCompletionAssessment(dd);
  assert.ok(c, 'the completion rung stopped answering');
  assert.equal(c.score, undefined, 'the completion rung grew an execution score');
});

// ---------------------------------------------------------------------------
// NOTHING WAS REMOVED
// ---------------------------------------------------------------------------
test('every evidence field the panel ever offered is still reachable', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  a.handleToggleDetail(dd.id);
  const html = card(a, dd);
  ['km', 'pace', 'hr', 'rpe', 'notes'].forEach(f =>
    assert.ok(has(html, f), 'evidence field removed: ' + f));
  assert.match(html, /data-action="set-feel"/, 'feel removed');
  assert.match(html, /data-action="toggle-splits"/, 'segment logging removed');
  assert.match(html, /data-action="clear-actual"/, 'clear log removed');
});

test('rich evidence is not flattened to the simplified surface', () => {
  /* What a watch or a connected service supplied stays intact and stays
     visible; the simplification is to the ASKING, never to the STORING. */
  const a = app();
  const dd = logged(a, { km: 8.02, pace: '5:12', paceUnit: 'km', hr: 158, rpe: 6,
                         feel: 'good', notes: 'Strong late.',
                         splits: [{ segId: 'w', km: 2, sec: 660, hr: 140 }] });
  const html = card(a, dd);
  assert.match(html, /aria-expanded="true"/, 'a rich record opened collapsed');
  assert.equal(dd.actual.splits.length, 1, 'segment evidence was discarded');
  assert.equal(dd.actual.hr, 158);
  assert.ok(has(html, 'hr'), 'imported heart rate is not shown');
  const b = a.computeExecutionBreakdown(dd);
  assert.ok(b && b.score != null, 'a rich record stopped being scored');
});

// ---------------------------------------------------------------------------
// UNITS
// ---------------------------------------------------------------------------
test('the simplified surface respects the athlete\'s unit in both directions', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  a.state.units = 'km';
  assert.match(card(a, dd), /Actual KM/, 'kilometres are not labelled');
  a.state.units = 'mi';
  const mi = card(a, dd);
  assert.match(mi, /Actual MI/, 'miles are not labelled');
  assert.match(mi, /Avg Pace \/mi/, 'pace is not offered in the athlete\'s unit');
  assert.equal(dd.actual.km, 8, 'switching units rewrote the stored value');
});
