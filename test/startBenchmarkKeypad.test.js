'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');

/* RETIRED (founder, 16 November 2026, item 9: "Can it be removed? Yeh"): the web builder on /start is removed; the plan is built in the app (/get). */
/* THE BENCHMARK TIME THAT COULD NOT BE TYPED ON A PHONE.
 * This file held /start's copy of the benchmark field to the fix the app
 * already had: "." accepted as the separator, a keypad with a separator on
 * it, and the same parser at validation and at banking. /start no longer
 * asks for a benchmark, so the parser laws are kept against the app's own
 * parseBenchmarkTime(), the one that is left. The app's field and its copy
 * are held by benchmarkTimeInput.test.js. */

const START = fs.readFileSync(path.join(__dirname, '..', 'start.html'), 'utf8');
const parser = () => loadApp({ pinnedDate: '2026-11-16T09:00:00Z' }).parseBenchmarkTime;
const no = (v) => v == null || !isFinite(v);

test('"45.00" is 45 minutes 00 seconds, exactly as "45:00" is', () => {
  const f = parser();
  assert.equal(f('45:00'), 45 * 60);
  assert.equal(f('45.00'), 45 * 60);
  assert.equal(f('23.25'), 23 * 60 + 25, '"." must never be read as a decimal number of minutes');
});

test('the longer forms and surrounding whitespace behave the same way', () => {
  const f = parser();
  assert.equal(f('1:05:30'), 3600 + 5 * 60 + 30);
  assert.equal(f('1.05.30'), 3600 + 5 * 60 + 30);
  assert.equal(f('  45.00  '), 45 * 60);
});

test('a bare number is still refused rather than guessed at', () => {
  const f = parser();
  ['900', '4500', '45', '', 'abc', null, undefined].forEach(v =>
    assert.ok(no(f(v)), JSON.stringify(v) + ' was accepted'));
});

test('/start asks for no benchmark, so there is nothing left there to disagree with the app', () => {
  assert.doesNotMatch(START, /bld-bench-time|function parseBenchmarkTime|function clockToSec/);
});
