'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');

/* BUILDER TRAINING-DAY SELECTOR VISUAL REFINEMENT.
 * ===========================================================================
 * The seven rectangular Training Day checkbox cards became seven small
 * raised circular discs. This is a presentation-only change: the real
 * <input type=checkbox data-wd="N"> that Ans/schedule.activeDays and every
 * downstream reader (the change handler, bldSyncLongDay(), handleGeneratePlan(),
 * bldRenderReview()) already depended on is untouched -- position:absolute;
 * opacity:0 over the label's full footprint, the same technique .switch input
 * already used elsewhere in this file, so the checkbox stays real, focusable
 * and keyboard-operable; only its native square box is no longer painted.
 * .wd-circle/.wd-name are new sibling elements the checked class the
 * PRE-EXISTING change handler already toggled now drives.
 *
 * These tests hold: the seven selectors still exist with the right data-wd
 * and accessible name; selected/unselected state renders correctly; no
 * native checkbox is visually presented; the DOM shape the change handler's
 * cb.parentElement.classList.toggle() depends on is unchanged; and the
 * change handler / bldSyncLongDay() themselves -- the actual long-run-day
 * linkage -- were not touched by this pass. */

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
// 3. NO VISIBLE NATIVE CHECKBOX
// ---------------------------------------------------------------------------
test('the native checkbox is visually suppressed, not removed -- opacity:0 over the full label', () => {
  const rule = /\.wd-check input\{([^}]*)\}/.exec(SRC);
  assert.ok(rule, '.wd-check input rule not found');
  assert.match(rule[1], /opacity:0/, 'the native checkbox square must not be painted');
  assert.match(rule[1], /position:absolute/, 'must still occupy the full label as the real interactive target');
  assert.doesNotMatch(SRC, /\.wd-check input\{[^}]*display:\s*none/, 'display:none would drop it from the accessibility tree');
});

test('.wd-circle is genuinely circular and carries the app\'s soft-raised shadow language, not a square checkbox look', () => {
  const rule = /\.wd-circle\{([^}]*)\}/.exec(SRC);
  assert.ok(rule, '.wd-circle rule not found');
  assert.match(rule[1], /border-radius:50%/);
  assert.match(rule[1], /aspect-ratio:1\/1/, 'a fixed aspect-ratio is what keeps the disc circular at every grid width');
  assert.match(rule[1], /var\(--shadow-sm\)/, 'reuses the app\'s existing Level 2 soft-raised recipe rather than a new one');
});

test('a selected disc is a stronger raised elevation plus a gold border/tick, not the settled/pressed look .opt-grid uses', () => {
  const checkedRule = /\.wd-check\.checked \.wd-circle\{([^}]*)\}/.exec(SRC);
  assert.ok(checkedRule, '.wd-check.checked .wd-circle rule not found');
  assert.match(checkedRule[1], /border-color:var\(--bronze\)/);
  assert.match(checkedRule[1], /background:var\(--c-gold-soft\)/);
  assert.doesNotMatch(checkedRule[1], /^\s*inset/, 'selected must not read as a pressed/sunken control');
  const tickRule = /\.wd-check\.checked \.wd-circle svg\{([^}]*)\}/.exec(SRC);
  assert.ok(tickRule, 'selected tick visibility rule not found');
  assert.match(tickRule[1], /opacity:1/);
});

test('the day label sits outside the circle (a sibling .wd-name), never text inside .wd-circle', () => {
  const { html } = buildJourney();
  const label = /<label class="wd-check[^"]*"><input type="checkbox" data-wd="0"[^>]*><span class="wd-circle"[^>]*>.*?<\/span><span class="wd-name">Mon<\/span><\/label>/.exec(html);
  assert.ok(label, 'Monday\'s label did not match the expected circle-then-name structure');
});

// ---------------------------------------------------------------------------
// 4. THE STRUCTURAL INVARIANT THE UNTOUCHED CHANGE HANDLER DEPENDS ON
// ---------------------------------------------------------------------------
test('the checkbox is still the immediate first child of .wd-check, so cb.parentElement is still the label', () => {
  const { html } = buildJourney();
  // No element (like the new .wd-circle) may sit between the label's opening
  // tag and its <input> -- the pre-existing change handler reads
  // cb.parentElement.classList.toggle('checked', ...) and would silently
  // stop working if the input were no longer the label's direct first child.
  const labels = [...html.matchAll(/<label class="wd-check[^"]*">(<input type="checkbox"[^>]*>)/g)];
  assert.equal(labels.length, 7, 'expected every one of the 7 labels to open directly onto its <input>');
});

// ---------------------------------------------------------------------------
// 5. LONG-RUN-DAY LINKAGE ITSELF WAS NOT TOUCHED
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
// 6. SEVEN-ACROSS FIT
// ---------------------------------------------------------------------------
test('.weekday-grid is still a 7-column grid -- the layout that fits all seven on one row is untouched', () => {
  assert.match(SRC, /\.weekday-grid\{display:grid; grid-template-columns:repeat\(7,1fr\); gap:6px; margin-bottom:12px;\}/);
});

// ---------------------------------------------------------------------------
// 7. /start MIRRORS THE SAME TREATMENT (builderVisualParity.test.js already
// enforces .weekday-grid byte-equality and var(--c-gold-soft) on both sides;
// this adds the circle/tick-specific checks that file does not cover).
// ---------------------------------------------------------------------------
test('/start\'s weekday picker also uses real checkboxes with a circle + name, not a bare label text node', () => {
  const fn = START_SRC.slice(START_SRC.indexOf('function renderWeekdayGrid'));
  const body = fn.slice(0, fn.indexOf('\n  }\n'));
  assert.match(body, /type = 'checkbox'/);
  assert.match(body, /className = 'wd-circle'/);
  assert.match(body, /className = 'wd-name'/);
  assert.match(body, /setAttribute\('aria-label', WD_FULL_NAMES\[iso\] \|\| label\)/);
  assert.doesNotMatch(body, /createTextNode\(label\)/, 'the day text must no longer be dropped directly into the label as a bare node');
});

test('/start\'s .wd-circle is also genuinely circular with a raised shadow', () => {
  const rule = /\.wd-circle\{([^}]*)\}/.exec(START_SRC);
  assert.ok(rule);
  assert.match(rule[1], /border-radius:50%/);
  assert.match(rule[1], /aspect-ratio:1\/1/);
  assert.match(rule[1], /box-shadow:/);
});
