'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

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
