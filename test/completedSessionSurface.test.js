'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* WHAT THE SCREEN BECOMES ONCE THE SESSION IS DONE.
 * ===========================================================================
 * Everything below the Coach's Note used to be the old app showing through
 * the new one: boxed inputs on a tile, a bordered Execution Review card, a
 * right-aligned underlined link. The session above had already stopped being
 * a card, so the completed state read as a different product. These guards
 * hold the completed surface to the same rules as the rest of the page --
 * lit rather than framed, tokens rather than hand-set values, and the same
 * markup in all three places a session is shown in full.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
/* Read out of the sheet, not retyped: the arms change when another screen
   adopts the hierarchy, and a stale copy here reports "rule not found" for
   every rule in this file instead of for the one that broke. The arms
   themselves are asserted in coachingRail. */
const F = (CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/) || [])[0];
assert.ok(F, 'the focused-session selector is gone from the sheet');
const rule = sel => {
  const i = CSS.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return CSS.slice(i + sel.length + 1, CSS.indexOf('}', i));
};

function app(){
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k',
    volume: 40, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}
function completedDay(a){
  const d = a.state.days.filter(x => x.type === 'threshold')[0];
  d.completed = true;
  d.actual = { km: d.km };
  return d;
}

test('a completed session states that it is complete, once, before the log', () => {
  const a = app();
  const html = a.renderDayCard(completedDay(a));
  assert.equal((html.match(/class="actual-done"/g) || []).length, 1,
    'the completion statement is missing or duplicated');
  assert.ok(html.indexOf('actual-done') < html.indexOf('data-field="km"'),
    'the log no longer opens under a statement of fact');
  assert.match(html, /actual-done-k">Session complete</,
    'the completion statement lost its words');
});

test('the completion statement is the same markup in all three views', () => {
  /* renderDayCard() emits ONE string; CSS decides whether it is a quiet line
     or a lit banner. This is the rule the whole focused-session design rests
     on, and a view-conditional branch here would break it silently. */
  const a = app();
  const d = completedDay(a);
  const views = ['today', 'week', 'full'].map(v => { a.state.view = v; return a.renderDayCard(d); });
  assert.equal(views[0], views[1], 'Today and This Week render different cards');
  assert.equal(views[1], views[2], 'This Week and Full Plan render different cards');
});

test('nothing on the completed surface is drawn as a box', () => {
  /* The session above it is not a card, so neither is the log under it. */
  const fields = rule(F + ' .actual-field input');
  assert.match(fields, /background:none/, 'the log fields are tiles again');
  assert.match(fields, /border:0; border-bottom:1px solid var\(--gold\)/,
    'the log fields are boxed again instead of ruled');
  const review = rule(F + ' .exec-review-card');
  assert.match(review, /background:none/, 'the Execution Review is a card again');
  assert.match(review, /border:0/, 'the Execution Review has its border back');
  assert.match(review, /box-shadow:none/, 'the Execution Review is lifted again');
});

test('SESSION COMPLETE is lit the way the Coach\'s Note is lit', () => {
  const glow = rule(F + ' .actual-done::before');
  assert.match(glow, /filter:blur\(/,
    'the glow is a hard gradient again -- a stop list always shows its edge');
  assert.match(glow, /left:calc\(50% - 50vw\); width:100vw/,
    'the glow no longer overspills the content it lights');
  assert.doesNotMatch(glow, /border:/, 'the completion banner grew a border');
  /* A radial ending-shape percentage is read against the BOX, not the half
     box: anything over 50% still carries colour at the edge and gets cut,
     which is the rectangle this technique exists to avoid. */
  const shape = /radial-gradient\((\d+)% (\d+)%/.exec(glow);
  assert.ok(shape, 'the glow is no longer a radial');
  assert.ok(Number(shape[1]) < 50 && Number(shape[2]) < 50,
    'the glow reaches the box edge (' + shape[1] + '% x ' + shape[2] + '%) and will be cut square');
});

test('the completion green is a named token, not an invented colour', () => {
  assert.match(CSS, /--ok:#7AA06E;/, '--ok is gone or changed');
  assert.match(CSS, /--ok-text:#9BC08C;/, '--ok-text is gone or changed');
  const glow = rule(F + ' .actual-done::before');
  assert.match(glow, /var\(--ok-text\)/, 'the glow stopped naming its colour');
  assert.match(glow, /var\(--ok\)/, 'the glow stopped naming its colour');
  assert.doesNotMatch(glow, /#[0-9A-Fa-f]{3,6}|rgba?\(/,
    'the glow hand-sets a colour that belongs to no token');
});

test('clearing a log comes after the judgement it would undo', () => {
  const a = app();
  const html = a.renderDayCard(completedDay(a));
  assert.ok(html.indexOf('actual-clear') > html.indexOf('exec-review-'),
    'Clear log is wedged between the fields and the review of them again');
  assert.match(rule(F + ' .actual-clear'), /text-align:center/,
    'Clear log drifted back to the edge of the screen');
});

test('both disclosures are a label with its explanation under it', () => {
  const a = app();
  const html = a.renderDayCard(completedDay(a));
  assert.match(html, /<span class="st-k">\+ Add detail<\/span><span class="st-sub">/,
    'Add detail is one long sentence wearing a plus sign again');
  /* Chrome that repeats on every card is excluded by name in copyRepetition
     by a leading "+ Add detail" -- the plus has to stay inside the text, not
     become a CSS pseudo-element. */
  assert.match(html.replace(/<[^>]+>/g, ''), /\+ Add detail/,
    'the stripped text no longer reads as the chrome it is');
  /* A STRUCTURED session renders a breakdown summary card here rather than a
     toggle, so the laps and breakdown disclosures are checked against the
     templates: there is no fixture on which both can be rendered at once. */
  assert.match(SRC, /<span class="st-k">\+ Add laps \/ splits<\/span><span class="st-sub">Optional</,
    'the unstructured laps disclosure lost its structure');
  assert.match(SRC, /<span class="st-k">\+ Log the session breakdown<\/span><span class="st-sub">Optional</,
    'the structured breakdown disclosure lost its structure');
});

test('pace is still offered as optional on the completed surface', () => {
  /* The design drops the word; the promise does not. A missing pace narrows
     what Valhalla will CLAIM and is never a failure, so the label says so. */
  const a = app();
  const html = a.renderDayCard(completedDay(a));
  assert.match(html, /Avg Pace[^<]*optional/i, 'pace reads as compulsory again');
});

test('the header is one height on every view, so the page under it cannot shift', () => {
  /* Today renders .topbar-inner-today and the other four render
     .topbar-inner-brand-only. Both are as tall as the brandmark plus their
     own padding, so a difference here moves the whole page by that much on
     every swipe to or from Today -- measured at 4px before this was fixed. */
  const base = /padding:calc\((\d+)px \+ env\(safe-area-inset-top, 0px\)\) 16px (\d+)px/.exec(rule('.topbar-inner'));
  const brand = /padding-top:calc\((\d+)px \+ env\(safe-area-inset-top, 0px\)\); padding-bottom:(\d+)px/
    .exec(rule('.topbar-inner-brand-only'));
  assert.ok(base && brand, 'the header padding rules changed shape');
  assert.equal(base[1], brand[1], 'the header is a different height on Today (top padding)');
  assert.equal(base[2], brand[2], 'the header is a different height on Today (bottom padding)');
  assert.doesNotMatch(rule('.topbar'), /border-bottom:1px solid var\(--line\)/,
    'the redundant rule under the header is back');
});

test('the breakdown disclosure is not the one tile left on the page', () => {
  /* A structured session renders its breakdown as an .ev-card summary rather
     than a plain toggle, so two controls doing the same job -- open a
     disclosure -- sat three lines apart drawn as different species. Boxes
     are not banned (Hear Today and Ask Coach are deliberately obvious), but
     those are outlined pills; this was the filled, rimmed, shadowed tile the
     focused session removed everywhere else. */
  const r = rule(F + ' .splits-summary');
  assert.match(r, /background:none/, 'the breakdown card has its fill back');
  assert.match(r, /border:0/, 'the breakdown card has its rim back');
  assert.match(r, /box-shadow:none/, 'the breakdown card is lifted again');
  assert.match(r, /border-radius:0/, 'the breakdown card has its corners back');
  assert.match(rule(F + ' .splits-summary-title'), /var\(--label-face\)/,
    'the breakdown eyebrow is no longer on the label tier with its sibling');
});

test('de-tiling the breakdown did not delete its press feedback', () => {
  /* .ev-card:hover is two classes; the focused-session rule is four, so
     box-shadow:none would have beaten it and silently removed the state --
     the one thing test/themeSystem says must never happen to it. It comes
     back as illumination alone, with no tile shadow to sit beside. */
  ['hover', 'active'].forEach(state => {
    const r = rule(F + ' .splits-summary:' + state);
    assert.match(r, /box-shadow:0 0 \d+px color-mix\(in srgb, var\(--gold\)/,
      '.splits-summary:' + state + ' gives no feedback on a focused session');
    assert.doesNotMatch(r, /--tile-shadow/,
      'the tile shadow came back with the press state');
  });
});
