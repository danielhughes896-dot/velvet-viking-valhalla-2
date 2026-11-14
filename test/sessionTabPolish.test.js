'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE FOUR TABS, AND THE TAB BODIES BEHIND THEM.
 * ===========================================================================
 * A completed session is four stacked tabs -- Share, Session Details, Your
 * Log, Sacoro Analysis -- and what opens behind each of them. Everything
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
  assert.match(SRC, /function sessionTabHtml\(title\)/,
    'sessionTabHtml took a second argument again');
  const c = rule('.sess-tab-c');
  assert.match(c, /width:\s*18px/, 'the chevron column is reserved so the row ends square');
  assert.match(rule('.sess-tab-c svg'), /width:\s*18px/);
  assert.match(SRC, /ICONS\.chevronDown/, 'the tab lost the one glyph that says it opens');
});

test('the title grew into the space the sub was holding', () => {
  /* WAS 15px, "a step that reads without shouting" against a 12.5px sub.
     There is no sub now -- the row is its name -- so the title is not
     competing with a second line and the only question left is how big it
     can be. Measured with the real classes: "SACORO ANALYSIS", the
     longest of the four, is 186px of ink at 21px in a 193px column on a
     320px phone and 204px at 23px. 21px is the largest that never wraps,
     and it is also just under the session title's own 21.85px -- a tab
     heading bigger than the name of the session it opens would invert the
     card. Two bounds, one number. */
  assert.match(rule('.sess-tab-k'), /font-size:\s*1\.3125rem/,
    'the tab title is no longer the largest size that fits the narrowest phone');
});

test('the rail panels carry no glyph, and the heading takes the room', () => {
  const F = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/)[0];
  assert.ok(!/how-mod-i/.test(CSS), 'the rail panel icons are back in the sheet');
  assert.ok(!/how-mod-i/.test(SRC), 'the rail is emitting panel icons again');
  assert.ok(!/MOD_ICON/.test(SRC), 'the rail icon table is back');
  /* The heading this measured was the coaching column's, and the columns
     are gone from the product -- see structuredWorkout. What the panels
     have at the top of them now is the card's title, and it is centred for
     the same reason: with nothing above it, it is the panel's own mark.
     Its size is the hero title's and is held where that comparison lives. */
  assert.match(rule(F + ' .ws-rail .how-mod'), /text-align:\s*center/,
    'with no glyph above it the title is the only thing at the top of the ' +
    'panel, so it is centred over its own card');
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

/* ---- THIS ASSERTION OUTLIVED THE THING IT GUARDED ----
   It required the gold tick to be emitted INSIDE the label row, because in
   a column of its own it indented the word and the sentence beneath it. The
   tick has since gone entirely -- it was the last glyph in front of a title
   on this card, and the word under the label ("Controlled") is the approval
   it was signalling. With no mark there is nothing left to put in the wrong
   place, so what is held now is simply that the three parts are emitted in
   the order they are read. */
test('the verdict reads label, word, sentence, with nothing before the label', () => {
  const i = SRC.indexOf('function renderCompletionVerdict');
  assert.ok(i > -1);
  const fn = SRC.slice(i, SRC.indexOf('\nfunction ', i + 10));
  const k = fn.indexOf('wc-verdict-k');
  const v = fn.indexOf('wc-verdict-v');
  const why = fn.indexOf('wc-verdict-why');
  assert.ok(k > -1 && v > -1 && why > -1, 'the verdict parts are gone');
  assert.ok(k < v && v < why, 'the verdict no longer reads label, word, sentence');
  assert.ok(fn.indexOf('wc-verdict-mark') === -1, 'the tick is back in the verdict');
});

/* ======================================================================
 * 3. THE SHARE COMPOSER IS A TAB BODY
 * ==================================================================== */

/* ---- THE COMPOSER IS A PAGE NOW ----
   Founder: "Go, build the share composer full page." It was a tab body,
   unfolding inside the session card; it is the Share page, with the
   picture first and the actions pinned at the foot like every full page. */
test('Share opens a full page, and the in-card composer is gone', () => {
  assert.ok(!/share-inline/.test(CSS), 'the in-card composer styling is back');
  assert.ok(!/function toggleShareInline/.test(SRC), 'the in-card composer is back');
  assert.match(SRC, /case 'share-workout': openShareModal\(/);
  assert.match(SRC, /openModal\(shareModalHtml\(\), 'modal-themed builder-light share-modal share-page '\+STG_PAGE\)/);
});

/* ---- THIS LAW HAS CHANGED SIDES ----
   It required the chosen half to be lit in gold, as KM / MI is. Founder:
   "The share pages need changing. Low R for example when selected needs to
   be the cherry. And the SACORO / my photos. Small same size but cherry
   select like the other parts of the app. Same as story / post. Share and
   save to photos again."
   Gold is the brand and the destination; cherry is what the athlete has
   touched. What the law still protects is unchanged: the same small control,
   lit by LIGHT on the word and never by a slab behind it. */
test('the share segments are the same small control, and the chosen half is lit in cherry', () => {
  const b = rule('.share-seg button');
  const on = rule('.share-seg button.active');
  assert.match(b, /color:\s*#FFFFFF/, 'the resting label is crisp white');
  assert.match(b, /text-shadow:[^;]*rgba\(255, ?255, ?255/, 'with the tight halo');
  assert.match(b, /min-height:\s*34px/, '"small same size": the control did not grow');
  assert.match(b, /font-size:\s*\.65625rem/);
  assert.match(on, /color:\s*var\(--cherry-text\)/);
  assert.doesNotMatch(on, /gold|227, ?177, ?90|245, ?208, ?97/i, 'no gold is left on the choice');
  assert.match(on, /text-shadow:[^;]*rgba\(154, ?84, ?108/, 'the light the nav puts on the tab you are on');
  assert.match(on, /background:\s*none/,
    'the choice is LIGHT on the word in this product, never a slab behind it');
  assert.ok(!/\.share-seg button\.active\s*\{[^}]*background:\s*var\(--(gold|cherry)[a-z-]*\)\s*;/.test(CSS),
    'a filled lozenge is back');
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

test('the two share actions are the page foot every full page has', () => {
  /* Share and Save to device sit pinned at the foot, the builder's cherry
     primary beside a ghost, as on every other full page. Neither is the old
     bronze slab, and the words stay on one line at 320. */
  assert.ok(!/share-actions/.test(SRC), 'the old in-card action rules are back');
  assert.match(SRC, /<div class="page-foot share-foot">'\+\s*'<button type="button" class="btn btn-primary" data-action="share-export" data-mode="share">/);
  assert.match(rule('.modal-card.share-page .share-foot .btn'), /white-space:\s*nowrap/);
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

/* ======================================================================
 * 6. A CONTROL THAT COULD NEVER DO WHAT IT SAID
 * ==================================================================== */

/* ---- CHANGED SIDES ----
   Founder: "Remove redundant 'Hide Detail', 'Add Laps / Splits' and
   unnecessary gold subheadings. Keep Avg HR, elevation and notes directly
   visible, with no duplicate inputs." And: "multi-part sessions
   automatically show separate Warm-up, Main Set and Cool-down inputs,
   including appropriate interval/rep details, while easy runs remain
   simple ... three sections should appear only when the prescription
   actually contains them." */
test('laps an athlete typed are shown, and there is no Hide control left to do nothing', () => {
  /* The control this section was written about -- "Hide laps / splits",
     which could never hide anything -- is gone with the toggle it belonged
     to. What it protected is still protected: laps that exist are on the
     screen, and a day without any is not given an editor unasked. */
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k',
    volume: 40, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });

  const withLaps = a.state.days.find(d => d.type !== 'rest');
  withLaps.completed = true;
  withLaps.actual = { km: withLaps.km,
    splits: [{ km:1, sec:312 }, { km:1, sec:304 }, { km:1, sec:292 }] };
  const shown = a.renderSplitsBlock(withLaps);
  assert.equal((shown.match(/class="split-row"/g) || []).length, 3, 'the laps are not all shown');
  assert.doesNotMatch(shown, /Hide laps|toggle-splits/);

  const noLaps = a.state.days.filter(d => d.type === 'easy')[0];
  noLaps.completed = true; noLaps.actual = { km: noLaps.km };
  assert.equal(a.renderSplitsBlock(noLaps), '', 'a day with no laps was given an editor unasked');
});

test('the open-and-closed state of the lap editor is gone with its toggle', () => {
  assert.ok(!/function handleToggleSplits|function isSplitsOpen|splitsEditorOpen/.test(SRC),
    'state for a control that no longer exists is still being kept');
});

/* ======================================================================
 * 7. ONE LEFT EDGE, AND NOTHING IN FRONT OF A FIGURE
 * ==================================================================== */

test('the analysis starts where the rest of the card starts', () => {
  const F = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/)[0];
  /* The HORIZONTAL halves only. This guard is about the card's left and
     right edges; the vertical values are the analysis's rhythm and are
     asserted with the rest of that rhythm below, so pinning the whole
     shorthand here made one concern fail for the other's reasons. */
  const hsides = (decl) => {
    const m = decl.match(/padding:\s*([^;}]+)/);
    assert.ok(m, 'no padding declared');
    const p = m[1].trim().split(/\s+/);
    return p.length === 1 ? [p[0], p[0]] : p.length >= 4 ? [p[3], p[1]] : [p[1], p[1]];
  };
  assert.deepEqual(hsides(rule(F + ' .exec-review-card')), ['0', '0'],
    'the analysis is indented from the card again -- every tab, log field ' +
    'and the splits toggle start at the card edge, and a section inset from ' +
    'all of them reads as a quotation inside the card rather than part of it');
  assert.deepEqual(hsides(rule(F + ' .wc-verdict')), ['0', '0']);
});

test('the workout cells carry figures, and the stage name is still spoken', () => {
  assert.ok(!/ws-h-num/.test(SRC), 'the numbered badge is back on the stage cells');
  assert.ok(!/ws-h-name/.test(SRC), 'the stage name is back on screen');
  /* ---------- THE NAME IS ON THE CARD NOW, SO IT IS NOT WHISPERED --------
     It was sr-only because three cells shared a phone and there was no room
     for it; the reading "2km / Easy / 5:09-6:07/km" with no stage name was
     worse than the sighted one, so the name stayed in the accessibility
     tree. The founder has since written the titles out -- "WARM-UP 2KM",
     "GOAL PACE 3 x 1600M" -- and the card leads with the stage's own name.
     A second sr-only copy would now be read twice.
     SO THE LAW IS THE SAME AND THE MECHANISM MOVED: every stage card says
     which stage it is, in text a screen reader reaches. Asserted against
     the rendered cell rather than against the markup that used to carry
     it, which is a stronger question than the one this asked. */
  assert.ok(!/<span class="sr-only">'\+escapeHtml\(st\.label\)/.test(SRC),
    'the stage name is both on the card and whispered again, so it is read twice');
  const a2 = (() => {
    const { loadApp } = require('./harness.js');
    const { buildPlan } = require('./fixtures.js');
    const x = loadApp({ pinnedDate: '2026-11-08T09:00:00Z' });
    x.showToast = () => {}; x.renderApp = () => {}; x.flushSave = () => {}; x.scheduleSave = () => {};
    buildPlan(x, { weeks: 11, startDate: '2026-09-04', distanceKey: 'full', volume: 46,
      benchSec: 45 * 60, lthr: 165, maxHR: 190,
      schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
    x.state.athlete = x.makeAthleteRecord();
    return x;
  })();
  let checked = 0;
  a2.state.days.forEach(d => {
    let steps; try { steps = a2.workoutSteps(d); } catch (e) { return; }
    if (!steps || !steps.length || !a2.hasWorkoutBlueprint(d)) return;
    steps.forEach((st, i) => {
      const cell = a2.renderWorkoutStepHCell(st, i, { work: null, cues: steps.length >= 2 });
      assert.ok(cell.indexOf('>' + st.label + '<') > -1,
        d.type + ' step ' + i + ': the cell does not say which stage it is (' + st.label + ')');
      checked++;
    });
  });
  assert.ok(checked >= 6, 'the fixture no longer exercises the stage cells (' + checked + ')');
});

test('Clear log sits on the panel grid like every other row', () => {
  const F = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/)[0];
  assert.match(rule(F + ' .actual-clear'), /margin-top:\s*0/,
    'a margin here is ADDED to the grid row gap -- measured at 52px above ' +
    'Clear log against 26px between every other pair of rows');
});

test('the rail panel reads on one axis', () => {
  const F = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/)[0];
  /* Same law, same reason, on the element that still exists: everything in
     a card shares one axis, or the panel reads as objects stacked rather
     than as one thing. */
  assert.match(rule(F + ' .ws-rail .how-mod'), /text-align:\s*center/,
    'the card content is left-aligned under a centred title, so the panel ' +
    'reads as two objects stacked rather than one');
  assert.match(rule(F + ' .ws-rail .ws-card-body'), /align-items:center/,
    'the card body no longer centres its own children');
});

test('no glyph leads the taper line or the withholding note', () => {
  assert.doesNotMatch(SRC, /class="wk-taper">'\+ICONS\./, 'the taper line leads with a bolt again');
  assert.doesNotMatch(SRC, /class="share-note">'\+ICONS\./, 'the note leads with a sparkle again');
  assert.ok(!/\.share-note svg\{/.test(CSS), 'the note glyph has a rule again');
  assert.ok(!/\.wk-taper svg\{/.test(CSS), 'the taper glyph has a rule again');
});

/* ======================================================================
 * 8. THE ANALYSIS HAS ONE RHYTHM AND NO GLYPHS
 * ==================================================================== */

test('nothing is drawn in front of the verdict or the review head', () => {
  assert.ok(!/wc-verdict-mark/.test(SRC), 'the verdict tick is back');
  assert.ok(!/wc-verdict-mark/.test(CSS), 'the verdict tick has rules again');
  assert.doesNotMatch(SRC, /exec-review-head">'\+ICONS\./,
    'the review head leads with a sparkle again');
  assert.ok(!/\.exec-review-head svg\{/.test(CSS),
    'the review head glyph has a rule again, so something is drawing one');
});

test('the analysis spaces its blocks on one rhythm', () => {
  /* Measured on the phone before this: 4px from the summary line to THE
     VERDICT, 0px from THE VERDICT to the word under it, 4px to the
     sentence, 52px to EXECUTION REVIEW, then an even 9px through the
     review. Three rhythms in one card, and the middle gap six times
     anything beside it.
     9px inside a block, 26px between the two blocks -- and neither number
     is invented: 9px is the review head's own margin and 26px is the log
     panel's grid row gap. */
  const F = CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/)[0];
  assert.match(rule('.wc-verdict-k'), /margin-bottom:\s*9px/,
    'THE VERDICT sits straight on top of the word under it again');
  assert.match(rule('.wc-verdict-why'), /margin-top:\s*9px/);
  assert.match(rule('.wc-verdict.is-plain .wc-verdict-why'), /margin-top:\s*9px/,
    'the no-verdict variant keeps a rhythm of its own');
  assert.match(rule(F + ' .exec-review-head'), /margin-bottom:\s*9px/,
    'the value the other three are matched to has moved');

  assert.match(rule(F + ' .wc-verdict'), /padding:\s*26px 0 0/,
    'the gap above the verdict is no longer the section gap');
  const card = rule(F + ' .exec-review-card');
  assert.match(card, /margin-top:\s*26px/);
  assert.match(card, /padding:\s*0 0 22px/,
    'top padding here is ADDED to the margin above it -- that is how the ' +
    'gap to EXECUTION REVIEW reached 52px while everything near it ran at 9');
});

test('the chosen overlay and the chosen picture are lit like a chosen builder tile', () => {
  const tile = rule('.opt-grid button.active');
  ['.share-ov.active .share-ov-thumb', '.share-bd.active'].forEach((sel) => {
    const r = rule(sel);
    assert.match(r, /border-color:\s*var\(--cherry\)/, sel + ' takes the cherry rim');
    assert.match(r, /box-shadow:\s*0 0 16px var\(--cherry-dim\)/, sel + ' takes the tile glow');
    assert.doesNotMatch(r, /gold|227, ?177, ?90/i, sel + ' must not be lit in gold');
  });
  assert.match(tile, /border-color:\s*var\(--cherry\)/, 'and that is the builder tile\'s own rim');
  assert.match(tile, /box-shadow:\s*0 0 16px var\(--cherry-dim\)/);
  const name = rule('.share-ov.active span');
  assert.match(name, /color:\s*var\(--cherry-text\)/, 'the chosen overlay\'s name is cherry');
  assert.doesNotMatch(name, /gold/);
});

test('the share page\'s hint line is not dimmed to a grey', () => {
  assert.doesNotMatch(rule('.share-hint'), /opacity/,
    'founder: "The grey text I\'m not keen on" -- and an opacity on white is a grey');
});
