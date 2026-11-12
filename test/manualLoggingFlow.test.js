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
/* THE LOG IS BEHIND ITS OWN TAB NOW -- Share, Session Details, Your Log,
   Sacoro Analysis -- and it is closed until asked. Every test in this file
   is about what the FIELDS do, so the tab is opened here, at the one seam
   they all render through. Without it they would each be asserting against
   an empty string, which is the kind of green that means nothing. Where the
   TAB itself belongs is asserted in completedSessionSurface. */
const card = (a, dd) => { a.logOpenFor[dd.id] = true; return a.renderDayCard(dd); };
const has = (html, field) => new RegExp('data-field="' + field + '"').test(html);

// ---------------------------------------------------------------------------
// THE DEFAULT SURFACE
// ---------------------------------------------------------------------------
/* THIS LAW CHANGED SIDES. It used to say distance and pace "and nothing
   else", with effort a typed box behind Add detail. The founder: "SACORO
   needs to extract the maximum coaching intelligence from the minimum
   athlete effort." So the two numbers a watch gives are still the only
   things TYPED, and what only the athlete knows is answered beneath them
   with a thumb. Effort is one of those answers: a slider, never a box. */
test('a completed session types distance and pace, and answers the rest with a thumb', () => {
  const a = app();
  const html = card(a, logged(a, { km: 8 }));
  assert.ok(has(html, 'km'), 'distance is not asked for');
  assert.ok(has(html, 'pace'), 'pace is not asked for');
  /* Heart rate, elevation and notes are simply there now, each once -- see
     the laws further down. They are still the only other things typed. */
  ['hr', 'elevationGainM', 'notes'].forEach(f =>
    assert.equal((html.match(new RegExp('data-action="actual-field" data-field="' + f + '"', 'g')) || []).length, 1,
      f + ' is not shown exactly once'));
  assert.match(html, /<input type="range"[^>]*data-field="rpe"/, 'effort is not a slider on the default surface');
  assert.ok(!/<input type="number"[^>]*data-field="rpe"/.test(html), 'effort is still a typed box');
  const typed = [...html.matchAll(/<input type="(?:number|text)"[^>]*data-field="([A-Za-z]+)"[^>]*>/g)]
    .filter(m => !/data-seg=/.test(m[0])).map(m => m[1]).sort();
  assert.deepEqual(typed, ['elevationGainM', 'hr', 'km', 'pace'],
    'the whole-session numbers that are typed have changed');
  assert.ok(!/data-action="toggle-detail"/.test(html), 'the detail is behind a toggle again');
});

test('pace is offered as optional, never as a requirement', () => {
  /* A missing pace narrows what Sacoro will CLAIM. It is not a failure and
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
/* ---- CHANGED SIDES ----
   Founder: "Remove redundant 'Hide Detail', 'Add Laps / Splits' and
   unnecessary gold subheadings. Keep Avg HR, elevation and notes directly
   visible, with no duplicate inputs." And: "multi-part sessions
   automatically show separate Warm-up, Main Set and Cool-down inputs,
   including appropriate interval/rep details, while easy runs remain
   simple ... three sections should appear only when the prescription
   actually contains them." */
test('heart rate, effort and notes are on the log with nothing to open', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  const html = card(a, dd);
  ['hr', 'rpe', 'notes', 'elevationGainM'].forEach(f =>
    assert.ok(has(html, f), f + ' is behind something'));
  assert.ok(!/Add detail|Hide detail|st-k|st-sub|splits-toggle/.test(html), 'a disclosure is back in the log');
  /* Feel is no longer five buttons in the detail: it is the answer to "How
     did it feel?", asked once, on the default surface. */
  assert.ok(has(html, 'mainSetFelt'), 'how it felt was lost rather than moved');
  assert.ok(!/data-action="set-feel"/.test(html), 'feel is asked twice: the old buttons are still drawn');
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

test('there is no detail state left to open or close', () => {
  const a = app();
  assert.equal(typeof a.isDetailOpen, 'undefined', 'the detail disclosure still has state');
  assert.equal(typeof a.handleToggleDetail, 'undefined');
  const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.ok(!/case 'toggle-detail'|case 'toggle-splits'/.test(SRC), 'a retired toggle is still wired');
});

test('drawing the log never discards a stored value', () => {
  const a = app();
  const dd = logged(a, { km: 8, hr: 152, rpe: 7, notes: 'Solid.' });
  const html = card(a, dd);
  assert.equal(dd.actual.hr, 152, 'heart rate was dropped by a render');
  assert.equal(dd.actual.rpe, 7);
  assert.equal(dd.actual.notes, 'Solid.');
  assert.match(html, /value="152"[^>]*data-field="hr"/, 'the stored heart rate is not shown');
  assert.match(html, />Solid\.<\/textarea>/, 'the stored note is not shown');
});

// ---------------------------------------------------------------------------
// CONSENT GATES SURVIVE THE MOVE
// ---------------------------------------------------------------------------
test('without health consent, heart rate and feel are absent from the log', () => {
  const a = app({ plan: { healthConsent: false } });
  const dd = logged(a, { km: 8 });
  const html = card(a, dd);
  assert.equal(a.healthConsentGranted(), false, 'the fixture granted consent');
  assert.ok(!has(html, 'hr'), 'a heart-rate box appeared without consent');
  ['mainSetFelt', 'hurting'].forEach(f =>
    assert.ok(!has(html, f), f + ' was asked without consent'));
  /* RPE and notes are ordinary training data and are unaffected. */
  assert.ok(has(html, 'rpe'), 'RPE was gated on health consent');
  assert.ok(has(html, 'notes'), 'notes were gated on health consent');
});

// ---------------------------------------------------------------------------
// THE THIRD RUNG IS UNTOUCHED
// ---------------------------------------------------------------------------
/* ---- CHANGED SIDES ----
   Founder: "Remove redundant 'Hide Detail', 'Add Laps / Splits' and
   unnecessary gold subheadings. Keep Avg HR, elevation and notes directly
   visible, with no duplicate inputs." And: "multi-part sessions
   automatically show separate Warm-up, Main Set and Cool-down inputs,
   including appropriate interval/rep details, while easy runs remain
   simple ... three sections should appear only when the prescription
   actually contains them." */
test('the session breakdown is on the log itself, in the sections the session has', () => {
  const a = app();
  const dd = logged(a, { km: 8 });
  const html = card(a, dd);
  assert.ok(!/data-action="toggle-splits"|splits-summary/.test(html), 'the breakdown is behind a card again');
  const plan = a.structuredLoggingPlan(dd);
  assert.ok(plan && plan.rows.length >= 3, 'the fixture threshold session has no structure');
  ['warmup', 'main', 'cooldown'].forEach(p =>
    assert.match(html, new RegExp('data-part="' + p + '"'), 'the ' + p + ' section is missing'));
  assert.ok((html.match(/data-action="slog-field"/g) || []).length >= 3, 'the segment inputs are unreachable');
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
  const html = card(a, dd);
  ['km', 'pace', 'hr', 'rpe', 'notes'].forEach(f =>
    assert.ok(has(html, f), 'evidence field removed: ' + f));
  assert.ok(has(html, 'mainSetFelt'), 'feel removed');
  assert.match(html, /data-action="slog-field"/, 'segment logging removed');
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
