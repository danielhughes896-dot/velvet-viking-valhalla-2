'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE FOUR TABS, AND THE TAB BODIES BEHIND THEM.
 * ===========================================================================
 * A completed session is four stacked tabs -- Share, Session Details, Your
 * Log, Valhalla Analysis -- and what opens behind each of them. Everything
 * guarded here was found by measuring the rendered page rather than by
 * reading the sheet, and every number in a comment below is a measurement:
 *
 *   - the Session Details icon drew at 13px where its three siblings drew at
 *     20px, and its title started at x=30 against their x=49, because
 *     ".fuel-card summary" (0,2,0) outranks ".sess-tab" (0,1,0) and a tab
 *     IS a <summary> inside a .fuel-card;
 *   - the verdict opened the analysis from inside a gold-rimmed panel while
 *     the Execution Review beneath it ran free;
 *   - the share composer's content ran 352px between x=30 and x=382 where
 *     all three sibling tab bodies run 380px from x=16.
 *
 * The lesson the file encodes: these were all ONE defect -- a surface that
 * had drifted from the law the rest of the app now follows -- and each would
 * come back the moment someone added a rule with one more class in it.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];

/* ---------- READ A RULE BY ITS WHOLE SELECTOR, NOT BY A SUBSTRING ----------
   indexOf(sel + '{') matches INSIDE a longer selector: '.sess-tab-c{' is
   found inside '.x .sess-tab-c{', and the guard then reads a rule it was not
   asked about -- which has already let two blanked rules through green in
   this suite. The selector must start at the beginning of its own line, or
   follow a comma, which is what the anchor below means. */
function rule(sel){
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp('(?:^|[\\n,])\\s*' + esc + '\\s*\\{([^}]*)\\}', 'm'));
  assert.ok(m, 'rule not found: ' + sel);
  return m[1];
}
function has(sel){
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?:^|[\\n,])\\s*' + esc + '\\s*\\{', 'm').test(CSS);
}

/* ======================================================================
 * 1. ONE COLUMN, FOUR TITLES
 * ==================================================================== */

/* ---- THIS ASSERTION HAS CHANGED SIDES ----
   It used to require a fixed 20px icon column on every tab, so that no odd
   glyph could move its own title and jag the stack of four. The column is
   gone because the glyphs are: four titles that say what they are did not
   need a picture in front of them, and the 49px they occupied is now the
   titles'. What the test protected -- four titles starting at one x -- is
   still protected, and more cheaply: there is nothing in front of them to
   go wrong. The chevron keeps its reserved column, because it is still
   drawn and it is still the only thing on the row that says the row opens. */
test('nothing is drawn in front of a session tab title', () => {
  assert.ok(!has('.sess-tab-i'), 'the tab icon column is back in the sheet');
  assert.ok(!/sess-tab-i/.test(SRC), 'a tab is emitting a leading glyph again');
  assert.match(SRC, /function sessionTabHtml\(title, sub\)/,
    'sessionTabHtml took an icon argument again');
  const c = rule('.sess-tab-c');
  assert.match(c, /width:\s*18px/, 'the chevron column is reserved so the row ends square');
  assert.match(rule('.sess-tab-c svg'), /width:\s*18px/);
  assert.match(SRC, /ICONS\.chevronDown/, 'the tab lost the one glyph that says it opens');
});

test('the title grew into the space the glyph was holding', () => {
  /* 13px against a 12.5px sub is not a hierarchy -- it was the icon saying
     which line was the title. Measured: the longest of the four is 151px of
     ink in a 317px column even at 17px, so width is not the constraint and
     15px is a step that reads without shouting. */
  assert.match(rule('.sess-tab-k'), /font-size:\s*15px/,
    'the tab title is back to a size that does not separate it from its own sub');
});

test('the rail panels carry no glyph, and the heading takes the room', () => {
  const F = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/)[0];
  assert.ok(!/how-mod-i/.test(CSS), 'the rail panel icons are back in the sheet');
  assert.ok(!/how-mod-i/.test(SRC), 'the rail is emitting panel icons again');
  assert.ok(!/MOD_ICON/.test(SRC), 'the rail icon table is back');
  const k = rule(F + ' .how-mod .how-row .k');
  assert.match(k, /text-align:\s*center/,
    'with no glyph above it the heading is the only thing at the top of the ' +
    'column, so it is centred over its own panel');
  assert.match(k, /font-size:\s*17px/,
    '17px is the measured ceiling: "Watch For" is 88px of ink in a 96px ' +
    'column on a 360px phone, and at 18px it wraps');
});

test('the Coach\u2019s Note leads with its words', () => {
  assert.doesNotMatch(SRC, /ICONS\.info\+'Coach/, 'the note grew a glyph in front of it again');
  assert.match(SRC, /class="k font-head">Coach/, 'the note lost its heading');
});

test('no action on this card leads with a glyph', () => {
  assert.doesNotMatch(SRC, /ICONS\.share\+'Share<\/button>/, 'Share leads with a glyph again');
  assert.doesNotMatch(SRC, /ICONS\.download\+escapeHtml\(saveImageLabel/, 'Save leads with a glyph again');
  assert.doesNotMatch(SRC, /ICONS\.voiceStop : ICONS\.voicePlay/, 'the listen control leads with a glyph again');
  assert.doesNotMatch(SRC, /ICONS\.voiceMic\+'<span>Ask coach/, 'Ask coach leads with a glyph again');
  /* The two the founder kept, named here so a later sweep cannot take them:
     the heart and the pace mark inside the ring, and the wand on the notes
     field. Neither sits in front of a title -- they ARE the label. */
  assert.match(SRC, /class="th-ic"/, 'the ring lost its heart and pace marks');
  assert.match(SRC, /class="notes-wand"/, 'the notes wand is gone');
});

test('the old disclosure row cannot claim a session tab', () => {
  /* .fuel-card summary and .sess-tab are two different components that happen
     to share an element. At (0,2,0) against (0,1,0) the first wins every
     property they both set -- padding, gap, min-height, font-size, colour --
     which is how one of the four tabs ended up 10px/6px where its siblings
     were 15px/13px. The exclusion is the fix; its absence is the bug. */
  assert.ok(has('.fuel-card summary:not(.sess-tab)'),
    'the disclosure-row block must exclude .sess-tab');
  assert.ok(!has('.fuel-card summary'),
    'an unscoped .fuel-card summary block is back, and it outranks .sess-tab');
  assert.ok(has('.fuel-card summary:not(.sess-tab) svg'),
    'the 13px icon rule must exclude .sess-tab too');
  assert.ok(!has('.fuel-card summary svg'),
    'an unscoped .fuel-card summary svg rule is back; it shrinks one tab\'s icon');
});

/* ======================================================================
 * 2. THE VERDICT IS A SECTION OF THE ANALYSIS, NOT A PANEL ON TOP OF IT
 * ==================================================================== */

test('the verdict draws no box', () => {
  const v = rule('.wc-verdict');
  assert.match(v, /border:\s*0/, 'the verdict must not be rimmed');
  assert.match(v, /background:\s*none/, 'the verdict must not have a ground of its own');
  assert.match(v, /border-radius:\s*0/, 'a radius with no ground and no rim is a leftover');
  assert.ok(!/is-plain\s*\{[^}]*background:\s*rgba/.test(CSS.replace(/\s+/g, ' ')),
    'the plain variant must not reintroduce a ground');
});

test('the verdict takes the same label voice as the section below it', () => {
  const k = rule('.wc-verdict-k');
  assert.match(k, /--label-face/, 'the verdict label and EXECUTION REVIEW are the same rank');
  assert.match(k, /color:\s*var\(--gold\)/);
  assert.match(k, /display:\s*flex/,
    'the tick rides in the label row; in a column of its own it indents ' +
    'everything under it and the two sections stop sharing a left edge');
});

test('the tick leads the label instead of indenting the prose', () => {
  const i = SRC.indexOf('function renderCompletionVerdict');
  assert.ok(i > -1);
  const fn = SRC.slice(i, SRC.indexOf('\nfunction ', i + 10));
  const mark = fn.indexOf('wc-verdict-mark');
  const k = fn.indexOf('wc-verdict-k');
  const why = fn.indexOf('wc-verdict-why');
  assert.ok(k > -1 && mark > -1 && why > -1, 'the verdict parts are gone');
  assert.ok(k < mark,
    'the mark must be emitted INSIDE the label row -- before it, it is a ' +
    'sibling column again and the sentence under it shifts right');
  assert.ok(mark < why);
});

/* ======================================================================
 * 3. THE SHARE COMPOSER IS A TAB BODY
 * ==================================================================== */

test('the composer runs the width its sibling tab bodies run', () => {
  assert.match(rule('.share-inline .share-body'), /padding:\s*14px 0 15px/,
    'side padding here is what made this one tab a narrower column than ' +
    'the log and the details beside it');
  const open = rule('.share-inline.is-open');
  assert.ok(!/border:/.test(open) && !/background:/.test(open),
    'the open composer must be the tab\'s body, not a panel under the tab');
  assert.ok(!/share-inline\.is-open\)\s*\.sess-tab\s*\{/.test(CSS),
    'squaring the tab\'s corners only made sense against a panel below it');
});

test('the share segments are the same control as KM / MI', () => {
  const b = rule('.share-seg button');
  const on = rule('.share-seg button.active');
  assert.match(b, /color:\s*#FFFFFF/, 'the resting label is crisp white');
  assert.match(b, /text-shadow:[^;]*rgba\(255, ?255, ?255/, 'with the tight halo');
  assert.match(on, /color:\s*var\(--gold-bright\)/);
  assert.match(on, /background:\s*none/,
    'gold is the LIGHT on the choice in this product, never a slab behind it');
  assert.ok(!/\.share-seg button\.active\s*\{[^}]*background:\s*var\(--gold\)\s*;/.test(CSS),
    'the filled gold lozenge is back');
  assert.match(rule('.share-seg'), /align-self:\s*flex-start/,
    'stretched to the full track, two labels sit at the left end of an ' +
    'empty 380px rim -- which the fill used to hide');
});

test('the withholding note is prose on the card, not an alert in a tray', () => {
  const n = rule('.share-note');
  assert.match(n, /background:\s*none/);
  assert.match(n, /border:\s*0/);
  assert.match(n, /padding:\s*2px 0 0/, 'it runs the tab\'s full width like everything else');
});

test('neither share action is a slab', () => {
  const b = rule('.share-actions .btn');
  assert.match(b, /background:\s*var\(--t-card\)/, 'the card\'s own ground, as .wk-open has');
  assert.match(b, /border:\s*1px solid var\(--t-tile-rim\)/);
  /* ---- AND THIS ONE HAS CHANGED SIDES TOO ----
     It required the primary to carry the four-layer illumination. That light
     means SELECTED in this product -- the nav tab you are on, the unit you
     chose -- and neither of these is selected: they are two ways to get the
     same image out, and the athlete picks one by pressing it. Both read in
     plain gold now, and Share leads by sitting first. What the test still
     protects, and the whole reason it exists, is that neither is a slab. */
  const p = rule('.share-actions .btn-primary,\n  .share-actions .btn-ghost');
  assert.match(p, /color:\s*var\(--gold\)/);
  assert.match(p, /text-shadow:\s*none/, 'the actions are lit as though one were chosen');
  assert.ok(!/background/.test(p),
    'a ground on the actions is the bronze gradient coming back');
});

test('the save button names the place the file actually lands', () => {
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  /* No Capacitor in the harness, so nativePlugin('Media') is null -- which is
     the browser case, where the PNG is downloaded and no photo library is
     touched at all. The label must not promise one. */
  assert.equal(a.saveImageLabel(), 'Save to device');
  const i = SRC.indexOf('function saveImageLabel');
  const fn = SRC.slice(i, SRC.indexOf('}', SRC.indexOf('return', i)));
  assert.match(fn, /Media\s*&&\s*Media\.savePhoto/,
    '"Save to photos" is only true where the media plugin is there to make ' +
    'it true; the branch is the whole point of the function');
  assert.match(fn, /Save to photos/);
});

/* ======================================================================
 * 4. THE LOG
 * ==================================================================== */

test('the notes field keeps no rule under it', () => {
  assert.match(rule(F() + ' .notes-field textarea'), /border-bottom:\s*0/,
    'the underline on a figure field is as wide as its column and marks ' +
    'where the figure goes; under two wrapped lines of placeholder prose ' +
    'across the whole card it is a divider, which this surface does not draw');
});

test('the feel selector is the same selector as every other selector', () => {
  const b = rule('.feel-btn');
  const on = rule('.feel-btn.on');
  assert.match(b, /background:\s*none/, 'no container');
  assert.match(b, /border:\s*0/);
  assert.match(b, /color:\s*#FFFFFF/);
  assert.match(b, /text-shadow:[^;]*rgba\(255, ?255, ?255/);
  assert.match(on, /color:\s*var\(--gold-bright\)/);
  assert.ok(!/box-shadow:\s*0 0 0 1px var\(--gold\)/.test(on),
    'the gold ring around the chosen pill is the old shape returning');
});

/* ======================================================================
 * 5. THE VERDICT IS SAID ONCE
 * ==================================================================== */

const { buildPlan, logAsPrescribed } = require('./fixtures.js');

function loggedSession(){
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-05-25', distanceKey: 'full',
    volume: 46, benchSec: 45 * 60, lthr: 165, maxHR: 190,
    schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  a.state.athlete = a.makeAthleteRecord();
  const past = a.state.days.filter(d => d.date < a.todayStr() && d.type !== 'rest');
  past.forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const dd = past.reverse().find(d => {
    const r = a.coachReviewFor(d) || a.coachWorkoutReview(d);
    return r && r.executionVerdict && a.computeExecutionBreakdown(d);
  });
  assert.ok(dd, 'no logged session in the fixture produces an execution verdict');
  return { a, dd };
}

test('the analysis states the verdict sentence once, not twice', () => {
  const { a, dd } = loggedSession();
  const r = a.coachReviewFor(dd) || a.coachWorkoutReview(dd);
  const sentence = r.executionVerdict;
  assert.ok(sentence && sentence.length > 20, 'the fixture has no verdict sentence to count');
  const html = a.renderExecutionReview(dd);
  /* Counted on the rendered string, because this is a defect of what reaches
     the screen: two renderers each reached for the same sentence and neither
     knew about the other. The gold panel the verdict sat in used to disguise
     it; sharing one left edge, it reads as a stutter. */
  const needle = a.escapeHtml(sentence);
  let n = 0, i = 0;
  while ((i = html.indexOf(needle, i)) > -1){ n++; i += needle.length; }
  assert.equal(n, 1,
    'the verdict sentence appears ' + n + ' times in the analysis; it belongs ' +
    'to the verdict, and the review continues from it rather than restating it');
});

test('the spoken debrief keeps the verdict paragraph it reads aloud', () => {
  /* The strip is in ONE renderer on purpose. voiceDebriefScript() takes
     paragraphs.slice(0, 1) at concise depth, so the first paragraph IS the
     spoken verdict -- removing it inside coachDebrief() would have the coach
     say the wrong thing out loud, or nothing at all. */
  const { a, dd } = loggedSession();
  const r = a.coachReviewFor(dd) || a.coachWorkoutReview(dd);
  const msg = a.coachDebrief(dd);
  assert.ok(msg && msg.paragraphs.length, 'the debrief is empty');
  assert.equal(msg.paragraphs[0].trim(), String(r.executionVerdict).trim(),
    'coachDebrief no longer opens with the verdict, so the concise spoken ' +
    'debrief now reads something else aloud');
});

test('the review head is withheld when nothing is left under it', () => {
  const i = SRC.indexOf('var analysisBody =');
  assert.ok(i > -1);
  const block = SRC.slice(i, i + 600);
  assert.match(block, /\(body\s*\?/,
    'at brief depth the budget is one paragraph -- the verdict\'s own -- so ' +
    'the review can be left with a heading, a score badge and white space');
});

function F(){
  const m = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/);
  assert.ok(m, 'the focused-session selector is gone from the sheet');
  return m[0];
}
