'use strict';
// THE IPHONE (founder, 18 November 2026, on an iPhone 15: "it did not wrap to
// the iPhone ... My Google is spot on so I wouldn't want that changing ...
// There's symbols in place please remove them").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

const RUNTIME = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = RUNTIME.slice(RUNTIME.indexOf('<style'), RUNTIME.indexOf('</style>'));
const ios = (() => {
  const at = CSS.indexOf('@supports (-webkit-touch-callout: none){');
  assert.ok(at > -1, 'there is no iPhone-only block');
  let depth = 0, i = CSS.indexOf('{', at);
  for (let j = i; j < CSS.length; j++){ if (CSS[j] === '{') depth++; if (CSS[j] === '}'){ depth--; if (!depth) return CSS.slice(i, j + 1); } }
  return '';
})();

test('a text box the athlete types into is 16px on iPhone, so tapping it never zooms the page', () => {
  ['.field input', '.field select', '.field textarea', '.goal-input-row input', '.actual-field input',
   '.actual-field textarea', '.split-row input', '.pzr-input'].forEach(sel =>
    assert.ok(ios.indexOf('html ' + sel) > -1, sel + ' can still zoom an iPhone'));
  assert.match(ios, /\{font-size:1rem !important;\}/);
  assert.match(ios, /html \.field input:not\(\[type="range"\]\):not\(\.tw-field\)/, 'the number wheels were shrunk too');
});

test('the iPhone rules are fenced to the iPhone: Android is untouched', () => {
  /* Only iOS's engine knows -webkit-touch-callout; Chrome on Android does not,
     so nothing inside the block can reach it. Outside the block, the one new
     rule is the notch strip, whose height is the safe-area inset: 0 wherever
     the status bar is solid. */
  assert.match(CSS, /body:has\(\.jr-page\)::before\{[^}]*height:env\(safe-area-inset-top, 0px\);[^}]*background:var\(--bg\);/);
  assert.match(ios, /\.jr-slides-page \.jr-device\{height:max\(260px, min\(55vh, 470px,/);
});

test('the journey option rows carry no symbol, only the tick or the round mark', () => {
  const a = loadApp({ pinnedDate: '2026-11-18T09:00:00Z' });
  const row = a.journeyOptionRow({ key: 'race', label: 'Achieve a Race Goal', glyph: 'flag' }, false, 'journey-achieve', 'Train for a distance.');
  assert.doesNotMatch(row, /jr-opt-glyph/);
  assert.equal((row.match(/<svg/g) || []).length, 0, 'an unticked row still draws a symbol');
  const on = a.journeyOptionRow({ key: 'prove_myself', label: 'Prove Something to Myself', glyph: 'trophy' }, true, 'journey-drive');
  assert.equal((on.match(/<svg/g) || []).length, 1, 'a ticked row should draw only its tick');
  assert.match(on, /jr-opt-mark/);
});

test('Continue with Email and the trial line carry no symbol', () => {
  assert.match(RUNTIME, /data-action="journey-email">Continue with Email<\/button>/);
  assert.match(RUNTIME, /'<p class="jr-lockline"><span>Your plan is ready\. Your trial has not started\.<\/span><\/p>'/);
  assert.doesNotMatch(RUNTIME, /JOURNEY_GLYPHS\.(mail|lock)\b/);
  assert.doesNotMatch(CSS, /\.jr-opt-glyph/);
});
