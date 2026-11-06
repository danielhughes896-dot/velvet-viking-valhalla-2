'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* EDIT SESSION IS THE SAME PRODUCT AS THE REST OF THE APP.
 * ===========================================================================
 * It was the last surface still wearing the old one, and measured in Chromium
 * the difference was not a matter of taste:
 *
 *   .es-sec     linear-gradient(100deg, rgb(36,38,45) ...)  behind a gradient
 *               rim -- a ramp starting at #24262D, lighter and bluer than the
 *               #1C1E24 every other panel sits on, and a rim that reads as a
 *               gold outline against the modal's dark ramp.
 *   .field      rgb(29,26,23) fill + inset 0 1px 3px -- a sunken well, the
 *               oldest surface left in the product.
 *   .ef-type-list  a 1px box around rows that were each a raised .ev-card:
 *               a box of boxes, on a card, in a modal.
 *   .is-picked  inset 0 0 0 1.5px CHERRY.
 *
 * That last one is a law, not a preference. Cherry is progress and action
 * here; GOLD is choice -- the bottom nav's selected tab, the A/B/C goal
 * options and the builder's choices all wear it. Picking a session type is a
 * choice, so it takes the choice colour.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const rule = sel => {
  const i = CSS.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return CSS.slice(i + sel.length + 1, CSS.indexOf('}', i));
};

test('the panels sit on the app’s own card, not the builder’s old ramp', () => {
  ['.es-sec', '.es-sum'].forEach(sel => {
    const r = rule(sel);
    assert.match(r, /background:var\(--t-card\)/,
      sel + ' is painting a gradient again instead of the product’s panel');
    assert.doesNotMatch(r, /--t-card-grad/, sel + ' took the lighter, bluer ramp back');
    assert.doesNotMatch(r, /--t-rim-grad/, sel + ' took the gradient rim back');
  });
});

test('a field is a surface, not a hole', () => {
  const r = rule('.es-body .field :is(input, select, textarea)');
  assert.match(r, /box-shadow:none/, 'the fields are sunken wells again');
  assert.doesNotMatch(r, /inset/, 'the inset shadow came back');
  /* 20px is a PANEL's radius; on a 44px field it rounds past the text into a
     pill and the control stops reading as somewhere to type. */
  assert.match(r, /border-radius:var\(--radius-sm\)/,
    'the fields are pills again -- --tile-radius is for panels');
});

test('nothing in Edit Session is a box inside a box', () => {
  assert.match(rule('.ef-type-list'), /border:0/, 'the type list is a box again');
  assert.match(rule('.ev-card.ef-type-row'), /background:none/,
    'the type rows are raised tiles again');
  assert.match(rule('.es-body fieldset'), /border:0/,
    'Completed is a fieldset box again');
});

test('a chosen session type is GOLD, and lit rather than outlined', () => {
  assert.doesNotMatch(rule('.ef-type-row.is-picked'), /--cherry/,
    'the selection went back to cherry -- cherry is progress, gold is choice');
  assert.match(rule('.ef-type-row.is-picked'), /box-shadow:none/,
    'the selection is outlined again instead of lit');
  assert.match(rule('.ef-type-row.is-picked::before'), /opacity:1/,
    'the selected row lost its light');
  assert.match(rule('.ef-type-row::before'), /rgba\(227,177,90/,
    'the pool behind a selected row is no longer gold');
  assert.match(rule('.ef-type-row.is-picked .swap-tick'), /var\(--gold\)/,
    'the tick is no longer gold');
});

test('the sticky modal header keeps its edge', () => {
  /* NOT AN EXCEPTION TO THE HAIRLINE PASS. .modal-head is position:sticky --
     the body scrolls underneath it -- so this line marks where a fixed
     surface ends, not where one detail stops and the next begins. Without it
     text slides under the title with nothing between. */
  /* Anchored, NOT read through rule(): that helper is indexOf(sel + '{'),
     and '.modal-head{' also occurs inside '.modal-card.builder-light
     .modal-head{', which is earlier in the sheet. The obvious spelling reads
     the builder's override instead and fails on a rule that is perfectly
     fine -- caught the first time this test ran. */
  const r = (CSS.match(/\n\s*\.modal-head\{([^}]*)\}/) || [])[1] || '';
  assert.ok(r, 'the modal head rule is gone');
  assert.match(r, /position:sticky/, 'the head stopped being sticky; re-read the rule below');
  assert.match(r, /border-bottom:1px solid/, 'the sticky head lost the edge it scrolls content under');
});

test('.modal-head is the only border left outside Settings', () => {
  /* THE WHOLE LAW IN ONE PLACE. Every plain 1px separator went; what may
     remain is Settings (by instruction), the cherry race-week markers (decor
     and signal, not separators), the focused log fields' underline (no fill
     and no box, so the line IS the field -- remove it and an empty input is
     invisible), and .modal-head (a sticky surface's own edge).
     Anything else is a hairline creeping back, which is exactly how 46 of
     them accumulated in the first place. */
  const ALLOWED = [
    /stg-row/, /stg-name-input/, /danger-zone/, /garmin-section/,
    /parse-row/, /csv-row-item/,                       // Settings + its import
    /race-event/, /race-strategy/,                     // cherry, by instruction
    /\.modal-head/,                                     // the sticky head
    /\.actual-field :is\(input, textarea\)/,            // the field, not a rule
  ];
  const stray = [];
  CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')
     .replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => {
       if (!/border-(top|bottom)\s*:\s*1px\s+(solid|dashed)/.test(body)) return '';
       const s2 = sel.replace(/\s+/g, ' ').trim();
       if (!ALLOWED.some(re => re.test(s2))) stray.push(s2.slice(0, 70));
       return '';
     });
  assert.deepEqual(stray, [], 'a plain hairline came back outside Settings');
});

/* ===========================================================================
 * PICKING A TYPE NAMES THE SESSION -- AND KNOWS WHEN NOT TO
 * ===========================================================================
 * Retyping Easy to Threshold used to leave "Easy Aerobic" in the box above
 * the picker, so the sheet said one thing and the control under it said
 * another until the athlete noticed and retyped it themselves.
 *
 * The limit on it is not new either: athlete_edit_wins, the same invariant
 * renameToMatchPrescription() already applies when a distance edit changes a
 * generated name. Valhalla renames a session only while the name is still
 * Valhalla's. Theirs outranks ours.
 */
test('a title is ours while it is still one of our own words', () => {
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });

  // empty: nothing of theirs to lose
  assert.equal(a.editTitleIsOurs('', 'easy', 'Easy Aerobic'), true);
  assert.equal(a.editTitleIsOurs('   ', 'easy', 'Easy Aerobic'), true);

  // the name the day's own prescription generates
  assert.equal(a.editTitleIsOurs('Easy Aerobic', 'easy', 'Easy Aerobic'), true);
  assert.equal(a.editTitleIsOurs('Long Run — Progressive to Goal Pace', 'long',
    'Long Run — Progressive to Goal Pace'), true);

  // the plain type label, which is what this feature itself last wrote there
  assert.equal(a.editTitleIsOurs('Threshold', 'threshold', 'Easy Aerobic'), true);
  assert.equal(a.editTitleIsOurs('Rest', 'rest', null), true);

  // and anything the athlete typed
  assert.equal(a.editTitleIsOurs('Hill repeats on the canal', 'easy', 'Easy Aerobic'), false,
    'a name the athlete typed is about to be overwritten by a type they picked');
  assert.equal(a.editTitleIsOurs('Easy Aerobic with the club', 'easy', 'Easy Aerobic'), false,
    'a generated name they then added to is still theirs');
  assert.equal(a.editTitleIsOurs('Easy', 'threshold', 'Easy Aerobic'), false,
    'the label of a type that is NOT the one selected a moment ago proves nothing');
});

test('a day with no prescription left still has a name of ours', () => {
  /* editGeneratedTitle() returns null for a hand-edited day whose
     prescription is gone -- the rule has to hold without it, on the type
     label alone, or retyping such a day would silently stop naming it. */
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  assert.equal(a.editTitleIsOurs('Tempo', 'tempo', null), true);
  assert.equal(a.editTitleIsOurs('Something of mine', 'tempo', null), false);
});

test('the name written in is the one on the row that was tapped', () => {
  /* TYPE_META, not a second table of session names -- that table is what
     labels the picker row itself, so the name in the box and the name under
     the finger cannot drift apart. */
  const i = SRC.indexOf('function handleEditTypePick');
  const fn = SRC.slice(i, SRC.indexOf('\n}', i));
  assert.match(fn, /editTitleIsOurs\(/, 'the handler no longer asks whether the title is ours');
  assert.match(fn, /box\.value = TYPE_META\[t\]\.label/,
    'the title is being written from something other than the tapped row’s own label');
  assert.match(fn, /!box\.disabled/,
    'a locked prescription would have its title rewritten, which is the one ' +
    'case where the sheet must not touch it');
});

test('the sheet’s Save is a button in the app’s language', () => {
  /* It was .btn-primary's bronze gradient -- the slab Share and Save to
     device gave up. NOT cherry, although the builder's Continue is: that
     rule is scoped to .builder-light on purpose and the sheet records why,
     and cherry also sits directly above a cherry-outlined Reset, where the
     control that saves would look like the one that destroys. */
  const save = rule('.es-actions .btn-primary');
  assert.match(save, /background:var\(--t-card\)/, 'Save is not on the card ground');
  assert.match(save, /border:1px solid var\(--t-tile-rim\)/);
  assert.match(save, /color:var\(--gold\)/);
  assert.ok(!/linear-gradient/.test(save), 'the bronze gradient is back on Save');
  assert.ok(!/--cherry/.test(save), 'Save has taken the builder’s cherry');
});
