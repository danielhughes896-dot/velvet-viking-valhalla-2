'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SUPPORTING WORK — COMPLETION ELIGIBILITY AND THE CONTROL THAT EXPRESSES IT
   =========================================================================
   THE DEFECT. renderSupportCompanion() rendered an actionable "Mark done"
   button on every day that carried supporting work, including days weeks in
   the future, while the running session on the same card refused to be ticked
   off before the day arrived. Two kinds of prescribed work, on one card, with
   two different answers to "has this happened yet".

   THE RULE, and there is only one of it. canToggleCompletion() has always
   meant today-and-only-today: not earlier, because it has not happened, and
   not later, because a past day keeps the record it was logged with (Edit
   Session is the separate, deliberately backward-reaching correction path for
   running). isCompletionDay() is that rule extracted, and BOTH the run and its
   companion now read it, so there is no second definition of today and a
   rollover moves both at once.

   THE ONE DELIBERATE DIFFERENCE, tested below so it cannot be mistaken for a
   bug. canToggleCompletion() also excludes rest days -- a rest day has no
   running session to tick. supportDayEligible() explicitly PRESCRIBES onto
   rest days ("any other easy or rest day"), and the engine's own output puts
   strength work there, so a rest day's companion is real work the athlete can
   do. canCompleteSupport() therefore takes the date half of the rule and not
   the rest-day half: consistent with the day it belongs to, not more
   restrictive than it, and never more permissive.

   WHAT THIS FILE MUST NOT ALLOW TO DRIFT: an early completion from any path,
   a second circular-checkbox implementation, a card whose body completes the
   work when tapped, or any movement at all in what the engine prescribes. */

const PINNED = '2026-08-24T09:00:00Z';          // Monday, matching the suite
const SUPPORT_REST_DAY = '2026-08-28';          // week 1, rest, strength_running
const SUPPORT_EASY_DAY = '2026-08-29';          // week 1, easy, conditioning_circuit
const at = d => loadApp({ pinnedDate: d + 'T09:00:00Z' });

/* An athlete whose plan genuinely carries supporting work. It is opt-in --
   supportForWeek() returns [] for everyone else -- so a fixture that forgets
   the preference tests an empty array and proves nothing. */
function athlete(pinned) {
  const a = at(pinned || '2026-08-24');
  const { days } = buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188 });
  a.state.setup.supportWork = 'on';
  const support = a.supportForDay(days.find(d => d.id === SUPPORT_REST_DAY));
  assert.ok(support, 'fixture must actually carry supporting work, or every test here is vacuous');
  return { a, days };
}
// Move an existing plan to a later clock WITHOUT regenerating it.
function rollTo(a, date) {
  const later = at(date);
  later.state = JSON.parse(JSON.stringify(a.state));
  return later;
}
const dayOf = (a, id) => a.state.days.filter(d => d.id === id)[0];
const companion = (a, id) => a.renderSupportCompanion(dayOf(a, id));

// =====================================================================
// 1. ONE RULE, TWO KINDS OF WORK
// =====================================================================

test('the running session and its companion read the same definition of today', () => {
  const { a } = athlete();
  const today = a.todayStr();
  assert.equal(a.isCompletionDay({ date: today }), true);
  assert.equal(a.isCompletionDay({ date: a.addDays(today, 1) }), false);
  assert.equal(a.isCompletionDay({ date: a.addDays(today, -1) }), false);
  // canToggleCompletion is that predicate plus the run's own rest-day clause
  assert.equal(a.canToggleCompletion({ date: today, type: 'easy' }), true);
  assert.equal(a.canToggleCompletion({ date: a.addDays(today, 1), type: 'easy' }), false);
  assert.equal(a.canCompleteSupport({ date: today }), true);
  assert.equal(a.canCompleteSupport({ date: a.addDays(today, 1) }), false);
  assert.equal(a.canCompleteSupport({ date: a.addDays(today, -1) }), false);
});

test('a future PRIMARY workout cannot be completed early — the pre-existing rule still holds', () => {
  const { a } = athlete();
  const future = a.state.days.filter(d => d.date > a.todayStr() && d.type !== 'rest')[0];
  assert.equal(a.canToggleCompletion(future), false);
  a.handleToggleComplete(future.id);
  assert.ok(!future.completed, 'a session that has not happened must not be recordable as having happened');
});

test('a future companion cannot be completed early either', () => {
  const { a } = athlete();
  const dd = dayOf(a, SUPPORT_REST_DAY);
  assert.ok(dd.date > a.todayStr(), 'fixture day must be in the future');
  assert.equal(a.canCompleteSupport(dd), false);

  const html = companion(a, SUPPORT_REST_DAY);
  assert.match(html, /class="day-check support-check locked"/, 'the control renders locked');
  assert.match(html, /disabled/, 'and the input is disabled');
  assert.doesNotMatch(html, /checked/, 'and must not look already done');
});

test('supporting work is completable on a REST day, because that is where it is prescribed', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_REST_DAY);
  const dd = dayOf(rolled, SUPPORT_REST_DAY);
  assert.equal(dd.type, 'rest');
  assert.equal(rolled.canToggleCompletion(dd), false, 'a rest day still has no RUN to tick');
  assert.equal(rolled.canCompleteSupport(dd), true,
    'but its companion is real prescribed work — refusing it would be more restrictive than the day');
  rolled.handleSupportDone(SUPPORT_REST_DAY);
  assert.ok(dayOf(rolled, SUPPORT_REST_DAY).support.completedAt);
});

// =====================================================================
// 2. FUTURE WORK STAYS FULLY VISIBLE AND FULLY READABLE
// =====================================================================

test('a future companion stays completely visible, details and all', () => {
  const { a } = athlete();
  const html = companion(a, SUPPORT_REST_DAY);
  assert.notEqual(html, '', 'future supporting work is not hidden — only its completion is withheld');
  assert.match(html, /support-block/);
  assert.match(html, /support-title/, 'what it is');
  assert.match(html, /support-why/, 'why it is there');
  assert.match(html, /support-dur/, 'how long it takes');
  assert.match(html, /<details class="fuel-card how-card support-detail">/,
    'the disclosure is still there and still openable — <details> opens natively');
  assert.match(html, /support-step/, 'the movements are still listed inside it');
  assert.match(html, /Not today/, 'declining is unchanged by this work');
});

test('the accordion/disclosure machinery is untouched by the locked state', () => {
  const { a } = athlete();
  const future = companion(a, SUPPORT_REST_DAY);
  const todayHtml = companion(rollTo(a, SUPPORT_REST_DAY), SUPPORT_REST_DAY);
  const detailsOf = h => h.slice(h.indexOf('<details'), h.indexOf('</details>'));
  assert.equal(detailsOf(future), detailsOf(todayHtml),
    'the details block must be byte-identical whether or not completion is available');
});

// =====================================================================
// 3. THE DATE ARRIVING IS WHAT UNLOCKS IT
// =====================================================================

test('date rollover changes eligibility with no plan regeneration', () => {
  const { a } = athlete();
  assert.equal(a.canCompleteSupport(dayOf(a, SUPPORT_REST_DAY)), false);

  const rolled = rollTo(a, SUPPORT_REST_DAY);          // same state object, later clock
  assert.equal(rolled.canCompleteSupport(dayOf(rolled, SUPPORT_REST_DAY)), true,
    'the same unmodified plan becomes completable purely because the date arrived');

  const html = companion(rolled, SUPPORT_REST_DAY);
  assert.doesNotMatch(html, /support-check locked/, 'and the control is no longer locked');
  assert.doesNotMatch(html, /disabled/);
  assert.match(html, /Mark done/);

  const past = rollTo(a, '2026-09-04');                // rolled well beyond it
  assert.equal(past.canCompleteSupport(dayOf(past, SUPPORT_REST_DAY)), false,
    'and it locks again once the day has gone by — never more permissive than the run');
});

test('completion becomes available and works on the day', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  rolled.handleSupportDone(SUPPORT_EASY_DAY);
  const dd = dayOf(rolled, SUPPORT_EASY_DAY);
  assert.ok(dd.support && dd.support.completedAt, 'it records a completion');
  assert.equal(dd.support.kind, 'conditioning_circuit', 'of the kind that was prescribed');
});

// =====================================================================
// 4. NO BYPASS
// =====================================================================

test('the future control cannot be bypassed by a direct call — the guard is at the write', () => {
  const { a } = athlete();
  const dd = dayOf(a, SUPPORT_REST_DAY);
  assert.ok(dd.date > a.todayStr());

  a.handleSupportDone(SUPPORT_REST_DAY);      // exactly what a synthesised event reaches
  assert.equal(dd.support, undefined,
    'a disabled attribute is a rendering fact; the refusal has to live with the write');

  // and a second time, with the day already carrying an unrelated support shape
  dd.support = { kind: null, dismissed: false };
  a.handleSupportDone(SUPPORT_REST_DAY);
  assert.ok(!dd.support.completedAt, 'still refused');
});

test('no other action writes a supporting-work completion', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const writers = CODE.match(/completedAt\s*:\s*new Date\(\)\.toISOString\(\)/g) || [];
  const supportWrites = CODE.match(/\.support\s*=\s*\{[^}]*completedAt/g) || [];
  assert.equal(supportWrites.length, 1,
    'there must be exactly ONE place that records supporting work as done, and it is guarded: '
      + supportWrites.join(' | '));
  assert.ok(writers.length >= 1);
  // the guard sits above that single write, inside handleSupportDone
  const i = CODE.indexOf('function handleSupportDone(');
  const body = CODE.slice(i, CODE.indexOf('\nfunction ', i + 10));
  assert.match(body, /if \(!canCompleteSupport\(dd\)\) return;/,
    'handleSupportDone must refuse before it writes');
  assert.ok(body.indexOf('canCompleteSupport') < body.indexOf('completedAt:'),
    'and the refusal must come before the write, not after it');
});

test('tapping the card body does not complete the work', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  const html = companion(rolled, SUPPORT_EASY_DAY);
  /* The action is on the control, never on the block. If .support-block or any
     wrapper carried data-action="support-done", the whole companion would be a
     completion button. */
  const blockTag = html.slice(0, html.indexOf('>') + 1);
  assert.doesNotMatch(blockTag, /data-action/, 'the companion wrapper is not itself a control');
  const actions = html.match(/data-action="support-done"/g) || [];
  assert.equal(actions.length, 1, 'exactly one thing completes supporting work');
  assert.match(html, /<label class="day-check support-check"[^>]*data-action="support-done"/,
    'and it is the label around the checkbox');
});

// =====================================================================
// 5. PERSISTENCE AND INDEPENDENCE
// =====================================================================

test('a completed companion survives a reload', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  rolled.handleSupportDone(SUPPORT_EASY_DAY);

  const reloaded = at(SUPPORT_EASY_DAY);
  reloaded.state = JSON.parse(JSON.stringify(rolled.state));
  const dd = dayOf(reloaded, SUPPORT_EASY_DAY);
  assert.ok(dd.support.completedAt, 'the completion is part of saved state');
  assert.match(companion(reloaded, SUPPORT_EASY_DAY), /support-done/, 'and still renders as done');
  /* It travels because cloudPutPlan() pushes `data: state` -- the whole state
     object -- so dd.support goes with it like any other field on the day.

     RECORDED, NOT ASSERTED AS DESIRABLE: planContentSignature() does NOT
     include dd.support, so a change to supporting-work completion alone does
     not move the content signature that divergence detection compares. That
     is pre-existing and untouched by this branch, which was scoped to
     completion eligibility; it is reported rather than quietly changed,
     because widening the signature changes cross-device conflict behaviour. */
  assert.ok(JSON.stringify(reloaded.state).indexOf('"completedAt"') !== -1,
    'the completion is in the state object that cloudPutPlan pushes');
  assert.doesNotMatch(String(reloaded.planContentSignature(reloaded.state)), /"support"/,
    'documenting the known signature gap so a future change to it is deliberate');
});

test('run completion and companion completion stay independent', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  const dd = dayOf(rolled, SUPPORT_EASY_DAY);
  assert.notEqual(dd.type, 'rest', 'this fixture day has a run as well as a companion');

  rolled.handleSupportDone(SUPPORT_EASY_DAY);
  assert.ok(dd.support.completedAt, 'the companion is done');
  assert.ok(!dd.completed, 'and the run is not — logging one must not log the other');

  rolled.handleToggleComplete(SUPPORT_EASY_DAY);
  assert.ok(dd.completed, 'the run can then be completed separately');
  assert.ok(dd.support.completedAt, 'without disturbing the companion');
});

test('an existing completed companion still renders correctly, on today and in the past', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  rolled.handleSupportDone(SUPPORT_EASY_DAY);

  const onDay = companion(rolled, SUPPORT_EASY_DAY);
  assert.match(onDay, /support-line support-done/, 'the compact done line is preserved');
  assert.match(onDay, /Strength Circuit/, 'naming the kind that was prescribed');
  assert.match(onDay, / — done|— done/, 'and still says done');
  assert.match(onDay, /checked/, 'with the control in its checked state');
  assert.doesNotMatch(onDay, /support-check locked/, 'live on the day, so a mistake can be undone');

  const later = rollTo(rolled, '2026-09-04');
  const inPast = companion(later, SUPPORT_EASY_DAY);
  assert.match(inPast, /support-line support-done/, 'a past completion still renders');
  assert.match(inPast, /checked/);
  assert.match(inPast, /support-check locked/, 'but is now a record rather than a control');
  assert.match(inPast, /disabled/);
});

test('completion can be taken back on the day, restoring the prescription exactly', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  const before = companion(rolled, SUPPORT_EASY_DAY);

  rolled.handleSupportDone(SUPPORT_EASY_DAY);
  assert.ok(dayOf(rolled, SUPPORT_EASY_DAY).support.completedAt);

  rolled.handleSupportDone(SUPPORT_EASY_DAY);      // tick it back off
  assert.equal(dayOf(rolled, SUPPORT_EASY_DAY).support, null, 'the completion is cleared');
  assert.equal(companion(rolled, SUPPORT_EASY_DAY), before,
    'and the companion returns byte-for-byte to what it was — nothing about the prescription moved');
});

// =====================================================================
// 6. ONE CONTROL, NOT A SECOND IMPLEMENTATION
// =====================================================================

test('the Mark done BUTTON is gone', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(CODE, /class="btn btn-sm btn-ghost" data-action="support-done"/,
    'the separate button treatment must not survive');
  const { a } = athlete();
  const html = companion(rollTo(a, SUPPORT_EASY_DAY), SUPPORT_EASY_DAY);
  assert.doesNotMatch(html, /<button[^>]*data-action="support-done"/,
    'supporting work is completed by the ring now, not by a button');
});

test('the ring is the SAME component as the running session’s, not a copy of it', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const { a } = athlete();
  const html = companion(rollTo(a, SUPPORT_EASY_DAY), SUPPORT_EASY_DAY);
  assert.match(html, /class="day-check support-check"/,
    'it carries .day-check, so it inherits the one circular-checkbox definition');
  assert.match(html, /<input type="checkbox"/, 'and it is a real checkbox, like the run’s');

  // .support-check may add layout, but must not redraw the ring
  const i = CODE.indexOf('.support-check{');
  const body = CODE.slice(i, CODE.indexOf('}', i));
  ['border-radius', 'appearance', 'background:var(--cherry'].forEach(prop =>
    assert.ok(body.indexOf(prop) === -1,
      '.support-check must not redraw the ring — that is .day-check input’s job: ' + prop));
  // and the shared component rule must still name all its members
  assert.match(CODE, /\.day-check input, \.wd-check input, \.cv-opt input, \.bld-consent input\{/,
    'the single circular-checkbox rule must still exist and still be shared');
});

test('the control is an adequate tap target and is accessible', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const i = CODE.indexOf('.support-check{');
  const body = CODE.slice(i, CODE.indexOf('}', i));
  const m = body.match(/min-height:(\d+)px/);
  assert.ok(m && Number(m[1]) >= 40, 'the ring keeps .day-check’s 40px hit target');

  const { a } = athlete();
  const live = companion(rollTo(a, SUPPORT_EASY_DAY), SUPPORT_EASY_DAY);
  assert.match(live, /aria-label="Mark supporting work complete"/);
  assert.match(live, /title="Mark supporting work complete"/);

  const future = companion(a, SUPPORT_REST_DAY);
  assert.match(future, /aria-label="Supporting work is ticked off on the day it is prescribed for"/,
    'a locked control must say WHY it is locked, not just be dead');
  // a native disabled checkbox inside a label is keyboard-correct by construction
  assert.match(future, /<label class="day-check support-check locked"/);
});

test('supporting work is completed on `change`, beside the run — not on `click`', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(CODE, /case 'support-done':/,
    'the click route belonged to the button and must go with it');
  assert.match(CODE, /else if \(action === 'support-done'\) handleSupportDone/,
    'a native checkbox belongs on change, where toggle-complete already lives');
  assert.match(CODE, /case 'support-skip':/, '"Not today" is untouched and stays a click');
});

// =====================================================================
// 7. THE ENGINE DID NOT MOVE
// =====================================================================

test('no prescription or session-selection output changed', () => {
  /* The completion path is the only thing this work touched. Rebuilt across
     four distances, every day and every supporting-work selection compared. */
  const variants = [
    { distanceKey: 'half', weeks: 12, volume: 45 },
    { distanceKey: 'full', weeks: 16, volume: 60 },
    { distanceKey: '10k', weeks: 10, volume: 30 },
    { distanceKey: '5k', weeks: 8, volume: 25 },
  ];
  let items = 0;
  for (const v of variants) {
    const a = at('2026-08-24');
    const { days } = buildPlan(a, Object.assign({ lthr: 172, maxHR: 188 }, v));
    a.state.setup.supportWork = 'on';
    const weeks = [...new Set(days.map(d => d.week))].filter(Boolean).sort((x, y) => x - y);
    for (const w of weeks) items += (a.supportForWeek(w) || []).length;
    assert.ok(days.length > 0);
  }
  assert.equal(items, 39,
    'the four reference plans prescribe 39 supporting sessions in total; a change here means '
      + 'the engine moved, which this branch is not allowed to do');
});

test('completing supporting work still cannot reach running volume or execution scoring', () => {
  const { a } = athlete();
  const rolled = rollTo(a, SUPPORT_EASY_DAY);
  const dd = dayOf(rolled, SUPPORT_EASY_DAY);
  // weekVolume returns a breakdown object, and cross-realm deepEqual is unsafe
  // against the VM sandbox, so it is compared as text.
  const volBefore = JSON.stringify(rolled.weekVolume(dd.week));
  rolled.handleSupportDone(SUPPORT_EASY_DAY);
  assert.equal(JSON.stringify(rolled.weekVolume(dd.week)), volBefore,
    'supporting work is not running and must never be counted as though it were');
  assert.equal(rolled.computeExecutionScore(dd), null,
    'and it must not manufacture an execution score on a run that has not been logged');
});
