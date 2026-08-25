'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

// C7 -- THE WEEK SHELL, NOT ONLY ITS DAY CARDS.
//
// dayCardElevation.test.js proved .day (the day cards a week contains)
// carries the app's premium raised-tile recipe (--tile-shadow/--tile-sheen).
// The .week shell AROUND those cards still used the older plain
// border + bare --shadow-sm -- live capture at 360/390/430, light and dark
// (tools/shots/week-shell-c7.js / week-closeup.js) showed it reading as the
// one flat, legacy surface left in an otherwise raised system, sitting
// directly above rows that visibly have a sheened top edge and it does not.
//
// THE FIX IS DELIBERATELY NOT dayCardElevation's recipe. .week holds seven
// day cards; giving it the same --tile-shadow would make the shell as loud
// as its contents and flatten the hierarchy between them. It takes
// .tb-unit-toggle's existing "hairline lift" recipe instead -- tile-sheen,
// tile-border, and a much smaller shadow than --tile-shadow's 12px blur --
// which is the app's own established quieter tier of the same system.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function ruleFor(sel) {
  let i = 0;
  for (;;) {
    i = CODE.indexOf(sel + '{', i);
    assert.ok(i !== -1, 'no screen rule found for ' + sel);
    const open = i + sel.length + 1;
    const body = CODE.slice(open, CODE.indexOf('}', open));
    // .week also has an earlier @media print override (border-color/background
    // !important, no radius) -- skip it and keep looking for the screen rule.
    if (sel !== '.week' || /border-radius/.test(body)) return body;
    i = open;
  }
}

test('.week now carries the sheened tile background and tile border, not the plain surface-2/line pair alone', () => {
  const rule = ruleFor('.week');
  assert.match(rule, /background\s*:\s*var\(--tile-sheen\)\s*,\s*var\(--surface-2\)/,
    'the sheened top edge, layered over the SAME background colour, not a different one');
  assert.match(rule, /border\s*:\s*1px solid var\(--tile-border\)/);
});

test('.week takes the hairline-lift shadow, not the full --tile-shadow the day cards use', () => {
  const week = ruleFor('.week');
  assert.match(week, /box-shadow\s*:\s*0 1px 2px rgba\(0,0,0,\.14\), inset 0 1px 0 rgba\(255,255,255,\.10\)/,
    'must match the existing restrained .tb-unit-toggle recipe exactly, not invent a third depth tier');
  assert.doesNotMatch(week, /box-shadow\s*:\s*var\(--tile-shadow\)/,
    'the shell must stay quieter than its own day cards -- reusing --tile-shadow verbatim would make it as loud as them');
});

test('the shell keeps its own radius, spacing and overflow clipping (the accordion still animates)', () => {
  const week = ruleFor('.week');
  assert.match(week, /border-radius\s*:\s*var\(--radius\)/);
  assert.match(week, /margin-bottom\s*:\s*12px/);
  assert.match(week, /overflow\s*:\s*hidden/);
});

test('the taper accent still overrides the border colour on top of the new tile border', () => {
  const taper = ruleFor('.week.is-taper');
  assert.match(taper, /border-color\s*:\s*var\(--bronze\)/);
});

test('.tb-unit-toggle -- the recipe .week borrowed -- still exists with the same values, so the two stay in sync', () => {
  const toggle = ruleFor('.tb-unit-toggle');
  assert.match(toggle, /var\(--tile-sheen\)/);
  assert.match(toggle, /var\(--tile-border\)/);
  assert.match(toggle, /box-shadow\s*:\s*0 1px 2px rgba\(0,0,0,\.14\), inset 0 1px 0 rgba\(255,255,255,\.10\)/);
});
