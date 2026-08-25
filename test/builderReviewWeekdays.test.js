'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// C3 -- REVIEW NAMES THE DAYS, NOT ONLY THE COUNT.
//
// The hero line already says "5 running days"; it never said which five.
// bldRenderReview() now adds a "Running days" row listing the selected
// weekdays by their existing three-letter abbreviations (the same
// ISO_WEEKDAY_NAMES the rest of the builder already uses for the weekday
// picker and the long-run-day selector), so this stays as dense as every
// other Review row instead of introducing a second visual language.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'protected/velvet-viking-valhalla.html'), 'utf8');
const fnStart = SRC.indexOf('function bldRenderReview()');
const fnEnd = SRC.indexOf('\nfunction bldStage(', fnStart);
const FN = SRC.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 5000);

test('bldRenderReview computes the selected weekday names from the same checkboxes the count already used', () => {
  assert.match(FN, /var weekdayNames = Array\.prototype\.slice\.call\(\s*document\.querySelectorAll\('#su-weekdays input\[type=checkbox\]:checked'\)/);
  assert.match(FN, /ISO_WEEKDAY_NAMES\[parseInt\(cb\.getAttribute\('data-wd'\), 10\)\]/,
    'must reuse the canonical three-letter weekday names, not invent a second label set');
});

test('a "Running days" row is added, guarded against an empty selection', () => {
  assert.match(FN, /if \(weekdayNames\.length\) rows \+= row\('Running days', weekdayNames\.join\(', '\)\);/);
});

test('the existing day-count (hero) and long-run-day row are both still present', () => {
  assert.match(FN, /var days = document\.querySelectorAll\('#su-weekdays input\[type=checkbox\]:checked'\)\.length;/);
  assert.match(FN, /row\('Long run day', longLabel\)/);
  assert.match(FN, /days \+ ' running days'/);
});

test('Review CSS already wraps long values, so the weekday list cannot overflow at mobile widths', () => {
  assert.match(SRC, /\.bld-review-v\{[^}]*overflow-wrap:anywhere/);
});

test('the row appears once, between Experience and Long run day (grouped with the schedule facts, not the hero)', () => {
  const expIdx = FN.indexOf("row('Experience'");
  const wdIdx = FN.indexOf("row('Running days'");
  const longIdx = FN.indexOf("row('Long run day'");
  assert.ok(expIdx > -1 && wdIdx > -1 && longIdx > -1);
  assert.ok(expIdx < wdIdx && wdIdx < longIdx, 'Running days must sit between Experience and Long run day');
});
