'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');

/* BUILDER TRAINING-DAY SELECTOR VISUAL REFINEMENT.
 * ===========================================================================
 * The seven rectangular Training Day checkbox cards became seven circles --
 * REUSING the day card's own completion ring (.day-check input), not a
 * lookalike built to resemble it. .day-check input and .wd-check input now
 * share one selector list (appearance:none, size, border, background) and
 * one selector list each for :checked and :checked::after, so there is a
 * single visual definition of "a circular checkbox, checked" in the
 * product. Founder review of the first pass flagged that it had instead
 * invented a second, similar-but-different component (a raised disc in a
 * separate .wd-circle span, gold instead of Cherry Lacquer, with a gold
 * wash behind the whole selected column) -- this file locks in the
 * correction: no .wd-circle, no column background, the checkbox itself IS
 * the circle, --cherry on checked, exactly like a completed session.
 *
 * The real <input type=checkbox data-wd="N"> that Ans/schedule.activeDays
 * and every downstream reader (the change handler, bldSyncLongDay(),
 * handleGeneratePlan(), bldRenderReview()) already depended on remains
 * untouched throughout -- appearance:none restyles it, it does not hide or
 * replace it, so it is still real, focusable and keyboard-operable. */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const START_SRC = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');

function buildJourney() {
  const a = loadApp({ pinnedDate: '2026-08-22T09:00:00Z' });
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  assert.ok(html, 'openSetupModal() did not open anything');
  return { a, html };
}

// ---------------------------------------------------------------------------
// 1. SEVEN SELECTORS, correct data-wd, correct accessible name
// ---------------------------------------------------------------------------
test('seven weekday selectors render, each a real checkbox with data-wd 0-6', () => {
  const { html } = buildJourney();
  const grid = /<div class="weekday-grid" id="su-weekdays">([\s\S]*?)<\/div>\s*<div class="field"/.exec(html);
  assert.ok(grid, 'weekday-grid not found');
  const inputs = [...grid[1].matchAll(/<input type="checkbox" data-wd="(\d)"[^>]*>/g)];
  assert.equal(inputs.length, 7, 'expected exactly 7 checkboxes');
  assert.deepEqual(inputs.map((m) => m[1]), ['0', '1', '2', '3', '4', '5', '6']);
});

test('each checkbox carries a full-weekday-name aria-label, distinct from the visible abbreviation', () => {
  const { html } = buildJourney();
  const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  FULL.forEach((full, iso) => {
    const re = new RegExp('<input type="checkbox" data-wd="' + iso + '"[^>]*aria-label="' + full + '"');
    assert.match(html, re, 'checkbox ' + iso + ' missing aria-label="' + full + '"');
  });
});

// ---------------------------------------------------------------------------
// 2. SELECTED / UNSELECTED STATE
// ---------------------------------------------------------------------------
test('the .checked class on each label matches schedule.activeDays exactly', () => {
  const a = loadApp({ pinnedDate: '2026-08-22T09:00:00Z' });
  a.state.setup = a.state.setup || {};
  a.state.setup.schedule = { activeDays: [1, 3, 5], longRunDay: 5 };
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  for (let iso = 0; iso < 7; iso++) {
    const re = new RegExp('<label class="wd-check' + (a.state.setup.schedule.activeDays.includes(iso) ? ' checked' : '') + '">' +
      '<input type="checkbox" data-wd="' + iso + '"');
    assert.match(html, re, 'day ' + iso + ' checked-state markup did not match schedule.activeDays');
  }
});

// ---------------------------------------------------------------------------
// 3. THE CIRCLE IS THE REUSED .day-check COMPONENT, NOT A NEW LOOKALIKE
// ---------------------------------------------------------------------------
test('.wd-check input shares its base circle rule with .day-check input, character for character', () => {
  /* THE COMPONENT GAINED A THIRD MEMBER (.cv-opt input, the Coach Voice
     radio), which is the component working as intended: one definition of
     "a circular, cherry, selected control", not three that drift. So the
     shared list is matched as one that CONTAINS both of these selectors
     rather than as one that is exactly them -- while a standalone
     .wd-check input rule remains forbidden below, which is the actual
     regression this test exists to catch. */
  const rule = /\.day-check input, \.wd-check input(?:, [^{]+)?\{([^}]*)\}/.exec(SRC);
  assert.ok(rule, 'expected one shared selector list for the base circle -- .wd-check input must not have its own separate rule');
  assert.match(rule[1], /appearance:none/);
  assert.match(rule[1], /border-radius:50%/);
  assert.match(rule[1], /border:2px solid var\(--line\)/);
  assert.match(rule[1], /background:var\(--bg-2\)/);
  // Exactly one rule declares appearance:none for .wd-check input -- the
  // shared one just matched above. A second, separate .wd-check input{...}
  // rule (not preceded by ".day-check input, ") would mean the two controls
  // drifted back into two components.
  const standalone = SRC.match(/(?<!\.day-check input, )\.wd-check input\{[^}]*appearance/g) || [];
  assert.equal(standalone.length, 0, 'found a standalone .wd-check input rule duplicating the shared one: ' + standalone.join(' | '));
});

// ---------------------------------------------------------------------------
// 3b. THE .field COLLISION -- .wd-check lives inside a .field the day card's
// .day-check never did, and .field input{width:100%;border-radius:9px;...}/
// .field label{display:block;text-transform:uppercase;...} tie the shared
// circle/column rules on specificity and win by source order, silently
// repainting the circle as a wide rounded-rectangle text-input box with its
// label running inline beside it instead of below it. Both must be pinned
// back at a specificity .field input/.field label cannot beat.
// ---------------------------------------------------------------------------
test('.field .wd-check input overrides every property .field input would otherwise win on specificity', () => {
  const rule = /\.field \.wd-check input\{([^}]*)\}/.exec(SRC);
  assert.ok(rule, '.field .wd-check input override rule not found -- .field input{width:100%;border-radius:9px;...} will win the tie and the circle will render as a rounded text box');
  assert.match(rule[1], /width:22px/);
  assert.match(rule[1], /height:22px/);
  assert.match(rule[1], /border-radius:50%/);
  assert.match(rule[1], /box-shadow:none/, '.field input\'s inset box-shadow must be explicitly cleared, not just outweighed');
});

test('.field .wd-check overrides the column layout .field label would otherwise collapse to inline block text', () => {
  const rule = /\.field \.wd-check\{([^}]*)\}/.exec(SRC);
  assert.ok(rule, '.field .wd-check layout override not found -- .field label{display:block;text-transform:uppercase;...} will win the tie and the name will run inline beside the circle instead of below it');
  assert.match(rule[1], /display:flex/);
  assert.match(rule[1], /flex-direction:column/);
  assert.match(rule[1], /text-transform:none/, '.field label\'s forced uppercase must be explicitly cleared on the label itself');
});

test('checked and the tick are also shared with .day-check, using --cherry, not a gold treatment', () => {
  const checkedRule = /\.day-check input:checked, \.wd-check input:checked(?:, [^{]+)?\{([^}]*)\}/.exec(SRC);
  assert.ok(checkedRule, 'expected one shared :checked rule');
  assert.match(checkedRule[1], /background:var\(--cherry\)/);
  assert.match(checkedRule[1], /border-color:var\(--cherry\)/);
  assert.doesNotMatch(checkedRule[1], /bronze|gold/i, 'the checked circle must use Cherry Lacquer, matching the completion ring, not the gold accent');

  const tickRule = /\.day-check input:checked::after, \.wd-check input:checked::after(?:, [^{]+)?\{([^}]*)\}/.exec(SRC);
  assert.ok(tickRule, 'expected one shared :checked::after tick rule');
  assert.match(tickRule[1], /border:solid var\(--cherry-btn-ink\)/);
});

test('there is no separate .wd-circle component anywhere -- the checkbox itself is the circle', () => {
  assert.doesNotMatch(SRC, /\.wd-circle/, 'a .wd-circle wrapper would be a second, parallel version of .day-check\'s ring');
});

// ---------------------------------------------------------------------------
// 4. NO BACKGROUND/WASH BEHIND THE SELECTED COLUMN
// ---------------------------------------------------------------------------
test('.wd-check.checked carries no background, box-shadow or fill of its own -- selection is the circle alone', () => {
  // Every rule keyed off .wd-check.checked (with nothing more specific
  // after it, i.e. not .wd-check.checked .wd-name) must declare only text
  // colour/weight -- never a background, border-radius-as-card, box-shadow
  // or tint. A future regression re-adding a column wash would fail here.
  const rules = [...SRC.matchAll(/\.wd-check\.checked(?:,\s*\.wd-check\.checked)?\s*\{([^}]*)\}/g)];
  assert.ok(rules.length === 0,
    '.wd-check.checked must not have its own bare rule at all -- only .wd-check.checked .wd-name may exist: found ' +
    rules.map((m) => m[0]).join(' | '));
  assert.doesNotMatch(SRC, /\.wd-check\.checked\{[^}]*background/, 'no background/wash may be declared on the selected label');
});

test('no square, rectangular or column-shaped highlight class is generated for a selected weekday', () => {
  const { html } = buildJourney();
  // The label's own class is exactly "wd-check" or "wd-check checked" --
  // nothing else (a card/highlight wrapper class) may be added when selected.
  const labels = [...html.matchAll(/<label class="(wd-check[^"]*)">/g)];
  assert.ok(labels.length === 7);
  labels.forEach((m) => {
    assert.match(m[1], /^wd-check( checked)?$/, 'unexpected class on a weekday label: ' + m[1]);
  });
});

// ---------------------------------------------------------------------------
// 5. STRUCTURE: circle then name, nothing inside the circle
// ---------------------------------------------------------------------------
test('the day label sits outside the circle (a sibling .wd-name span), with no wrapper span for the circle itself', () => {
  const { html } = buildJourney();
  const label = /<label class="wd-check[^"]*"><input type="checkbox" data-wd="0"[^>]*><span class="wd-name">Mon<\/span><\/label>/.exec(html);
  assert.ok(label, 'Monday\'s label did not match the expected input-then-name structure (no .wd-circle span)');
});

// ---------------------------------------------------------------------------
// 6. THE STRUCTURAL INVARIANT THE UNTOUCHED CHANGE HANDLER DEPENDS ON
// ---------------------------------------------------------------------------
test('the checkbox is still the immediate first child of .wd-check, so cb.parentElement is still the label', () => {
  const { html } = buildJourney();
  const labels = [...html.matchAll(/<label class="wd-check[^"]*">(<input type="checkbox"[^>]*>)/g)];
  assert.equal(labels.length, 7, 'expected every one of the 7 labels to open directly onto its <input>');
});

// ---------------------------------------------------------------------------
// 7. LONG-RUN-DAY LINKAGE ITSELF WAS NOT TOUCHED
// ---------------------------------------------------------------------------
test('the weekday change handler and bldSyncLongDay() -- the actual long-run-day linkage -- are unchanged by this pass', () => {
  assert.match(SRC, /wdBox\.addEventListener\('change', function\(\)\{\s*var boxes = wdBox\.querySelectorAll\('input\[type=checkbox\]'\);\s*var checked = \[\];\s*boxes\.forEach\(function\(cb\)\{\s*cb\.parentElement\.classList\.toggle\('checked', cb\.checked\);\s*if \(cb\.checked\) checked\.push\(parseInt\(cb\.getAttribute\('data-wd'\),10\)\);\s*\}\);/,
    'the change handler that rebuilds su-longday from the checked boxes must be byte-for-byte unchanged');
  assert.match(SRC, /function bldSyncLongDay\(\)\{\s*var sel = document\.getElementById\('su-longday'\);\s*var grid = document\.getElementById\('bld-longday-grid'\);\s*if \(!sel \|\| !grid\) return;\s*var opts = Array\.prototype\.slice\.call\(sel\.options\)\.filter\(function\(o\)\{ return o\.value !== ''; \}\);/,
    'bldSyncLongDay(), which redraws the long-run grid from the still-eligible days, must be byte-for-byte unchanged');
});

test('the 3-6 training-day rule and the underlying schedule data model are untouched', () => {
  assert.match(SRC, /activeDays\.length<genDaysRange\[0\] \|\| activeDays\.length>genDaysRange\[1\]/,
    'handleGeneratePlan() must still enforce the same min/max day-count rule');
  assert.match(SRC, /var activeDays = \[\];\s*wdBoxes\.forEach\(function\(cb\)\{ if \(cb\.checked\) activeDays\.push\(parseInt\(cb\.getAttribute\('data-wd'\),10\)\); \}\);/,
    'handleGeneratePlan() must still read activeDays from the checked boxes\' data-wd, unchanged');
});

// ---------------------------------------------------------------------------
// 8. SEVEN-ACROSS FIT
// ---------------------------------------------------------------------------
test('.weekday-grid is still a 7-column grid -- the layout that fits all seven on one row is untouched', () => {
  assert.match(SRC, /\.weekday-grid\{display:grid; grid-template-columns:repeat\(7,1fr\); gap:6px; margin-bottom:12px;\}/);
});

// ---------------------------------------------------------------------------
// 9. /start MIRRORS THE SAME TREATMENT
// ---------------------------------------------------------------------------
test('/start\'s weekday picker uses the same appearance:none circle + --cherry checked state, not the old raised-disc treatment', () => {
  const rule = /\.wd-check input\{([^}]*)\}/.exec(START_SRC);
  assert.ok(rule, '.wd-check input rule not found in /start');
  assert.match(rule[1], /appearance:none/);
  assert.match(rule[1], /border-radius:50%/);
  assert.match(rule[1], /border:2px solid var\(--line\)/);
  assert.doesNotMatch(SRC, /\.wd-circle/, 'no .wd-circle anywhere in the app');
  assert.doesNotMatch(START_SRC, /\.wd-circle/, 'no .wd-circle anywhere in /start either');

  const checkedRule = /\.wd-check input:checked\{([^}]*)\}/.exec(START_SRC);
  assert.ok(checkedRule);
  assert.match(checkedRule[1], /background:var\(--cherry\)/);
});

test('/start\'s renderWeekdayGrid() no longer builds a .wd-circle span, and no column background rule exists', () => {
  const fn = START_SRC.slice(START_SRC.indexOf('function renderWeekdayGrid'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /type = 'checkbox'/);
  assert.doesNotMatch(body, /wd-circle/);
  assert.doesNotMatch(START_SRC, /\.wd-check\.checked\{[^}]*background/, 'no background/wash may be declared on the selected label in /start either');
});
