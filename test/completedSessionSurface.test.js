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
  const fields = rule(F + ' .actual-field :is(input, textarea)');
  assert.match(fields, /background:none/, 'the log fields are tiles again');
  assert.match(fields, /border:0; border-bottom:1px solid var\(--line-soft\)/,
    'the log fields are boxed again instead of ruled');
  /* AND THE RULE IS NOT GOLD. It was, on the inputs only -- the notes
     textarea beside them was already drawn on --line-soft -- so one panel
     carried two line treatments and the louder of the two was a column of
     yellow underlines running down a screen whose subject is the session
     above it. Gold marks the brand and the one thing being offered, not
     every box an athlete can type in. One hairline, every field. */
  assert.doesNotMatch(fields, /--gold/, 'the log fields are underlined in gold again');
  /* The vertical hairline between figures is gone too: it was a white
     separator, and it was placed by sibling order rather than by column, so
     on a row with an odd number of fields it indented the field that STARTS
     column one. The grid gap is the separation. */
  assert.doesNotMatch(CSS, /\.actual-field:not\(\.full\) \+ \.actual-field:not\(\.full\)/,
    'the field separator is back, and with it the broken grid row');
  const review = rule(F + ' .exec-review-card');
  assert.match(review, /background:none/, 'the Execution Review is a card again');
  assert.match(review, /border:0/, 'the Execution Review has its border back');
  assert.match(review, /box-shadow:none/, 'the Execution Review is lifted again');
});

/* The one definition of the done light, read from :root. */
const DONE_GLOW = (() => {
  const i = CSS.indexOf('--glow-done:');
  assert.ok(i > -1, 'the shared done light is gone');
  return CSS.slice(i, CSS.indexOf(';', CSS.indexOf('transparent 100%', i)));
})();

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
  /* THE GRADIENT MOVED INTO A TOKEN and the rule now reads
     background:var(--glow-done) -- because a finished session and the marks
     that stand for one were being lit by three separately written recipes.
     The claims are unchanged; they are simply asserted where the gradient
     now lives. */
  assert.match(glow, /background:var\(--glow-done\)/,
    'the completion banner stopped drinking from the shared done light');
  const shape = /radial-gradient\((\d+)% (\d+)%/.exec(DONE_GLOW);
  assert.ok(shape, 'the glow is no longer a radial');
  assert.ok(Number(shape[1]) < 50 && Number(shape[2]) < 50,
    'the glow reaches the box edge (' + shape[1] + '% x ' + shape[2] + '%) and will be cut square');
});

test('the completion green is a named token, not an invented colour', () => {
  assert.match(CSS, /--ok:#7AA06E;/, '--ok is gone or changed');
  assert.match(CSS, /--ok-text:#9BC08C;/, '--ok-text is gone or changed');
  assert.match(DONE_GLOW, /var\(--ok-text\)/, 'the glow stopped naming its colour');
  assert.match(DONE_GLOW, /var\(--ok\)/, 'the glow stopped naming its colour');
  assert.doesNotMatch(DONE_GLOW, /#[0-9A-Fa-f]{3,6}|rgba?\(/,
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

/* FEEL WAS THE LAST CONTROL BUILT OUT OF BOXES AND FILLS.
 * ===========================================================================
 * A 9px label at 0.5px tracking inside a 6px-radius slab, which selected
 * itself by turning solid gold and flipping its text dark. Every comparable
 * control in the product had since settled on the opposite grammar -- a
 * pill, the one label voice, the word staying put, and the state carried by
 * light. The phase chips say it in as many words: gold means SELECTED, and
 * the word stays crisp white at every state.
 */
test('FEEL: the pills speak the product\'s own language, not the old one', () => {
  const btn = rule('.feel-btn');
  // the one label voice, not a 9px variant of it
  ['--label-face', '--label-size', '--label-track', '--label-weight'].forEach(tok =>
    assert.ok(btn.indexOf('var(' + tok + ')') > -1,
      'the Feel pills are off the label voice (' + tok + ')'));
  assert.doesNotMatch(btn, /font-size:9px/, 'the 9px label is back');
  assert.match(btn, /border-radius:99px/, 'the Feel options are slabs again, not pills');

  const on = rule('.feel-btn.on');
  /* THE WORD STAYS, THE LIGHT CHANGES. A solid fill with inverted text
     shouts louder than the figures logged above it, and this is the quiet
     answer at the end of a log rather than the headline of one. */
  assert.match(on, /color:var\(--ink\)/, 'selecting a feel recolours the word again');
  assert.match(on, /box-shadow:[^;]*var\(--gold\)/, 'the selected feel is no longer lit');
  assert.doesNotMatch(on, /background:/,
    'the selected feel fills itself solid again instead of lighting up');

  /* ONE SELECTION COLOUR, NOT A SCALE. Tinting POOR red and V.GOOD green
     would be the app grading an answer the athlete has just given about
     their own body. Feel is reported, not assessed. */
  assert.doesNotMatch(on, /var\(--ok\)|var\(--bad\)|var\(--warn\)/,
    'the feel scale is being colour-graded by the app');
});
