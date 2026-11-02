'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/* /start's BENCHMARK TIME COULD NOT BE TYPED ON A PHONE.
 * ===========================================================================
 * Reported from a real iPhone, mid-signup. The field carried
 * inputmode="numeric", which iOS and Android both draw as a DIGITS-ONLY pad:
 * no ":" on it anywhere, and no "." either. The placeholder asked for
 * "mm:ss", clockToSec() refused anything without a colon, and the athlete
 * could not produce one. They typed "900", were told to give it "like
 * 45:00", and had no way to -- a dead end on the one field every training
 * pace descends from, on the page new athletes arrive at.
 *
 * The app had already solved exactly this: parseBenchmarkTime() accepts "."
 * and both in-app benchmark fields carry inputmode="decimal". /start never
 * got it, and the test that looks like it covers /start
 * (benchmarkTimeInput.test.js, "COPY: the /start Benchmark Time field ...")
 * asserts it of su-bench-time -- the IN-APP setup modal -- which is why
 * nothing caught the gap. That test's name is corrected alongside this file.
 */

const SRC = read('start.html');

/* The page is a static file rather than a module, so its two functions are
   lifted out and exercised directly -- the same thing the page itself runs,
   with no copy of the logic kept here. */
function pageFn(name, src) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i !== -1, 'start.html no longer defines ' + name + '()');
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error('unterminated ' + name);
}
function parser() {
  const ctx = vm.createContext({});
  vm.runInContext(pageFn('clockToSec', SRC) + '\n' + pageFn('parseBenchmarkTime', SRC), ctx);
  return ctx.parseBenchmarkTime;
}

// ===========================================================================
// 1. THE PARSER — AND ITS PARITY WITH THE APP
// ===========================================================================

test('"45.00" is 45 minutes 00 seconds, exactly as "45:00" is', () => {
  const f = parser();
  assert.equal(f('45:00'), 45 * 60);
  assert.equal(f('45.00'), 45 * 60);
  assert.equal(f('45.00'), f('45:00'));
  assert.equal(f('23.25'), 23 * 60 + 25,
    '"." must never be read as a decimal number of minutes');
});

test('the longer forms and surrounding whitespace behave the same way', () => {
  const f = parser();
  assert.equal(f('1:05:30'), 3600 + 5 * 60 + 30);
  assert.equal(f('1.05.30'), 3600 + 5 * 60 + 30);
  assert.equal(f('  45.00  '), 45 * 60);
});

test('a bare number is still refused rather than guessed at', () => {
  const f = parser();
  // "900" is 9:00 or 15:00 and nothing may choose between them: the
  // benchmark is what every pace in the programme descends from.
  ['900', '4500', '45', '', 'abc', null, undefined].forEach(v =>
    assert.ok(!isFinite(f(v)), JSON.stringify(v) + ' was accepted'));
});

test('/start and the app cannot disagree about what may be typed', () => {
  const f = parser();
  const runtime = read(path.join('protected', 'velvet-viking-valhalla.html'));
  assert.match(runtime, /function parseBenchmarkTime\(/,
    'the runtime parser this one is matched to has gone');
  // same inputs, same answers, including the refusals
  ['45:00', '45.00', '23.25', '1.05.30', '900', '', 'abc'].forEach(v => {
    const mine = f(v);
    const theirs = (function(){
      // the runtime returns null where this page returns NaN; both are "no"
      const s = String(v == null ? '' : v).trim();
      if (!s) return null;
      const parts = s.replace(/\./g, ':').split(':').map(Number);
      if (parts.some(isNaN)) return null;
      if (parts.length === 3) return parts[0]*3600 + parts[1]*60 + parts[2];
      if (parts.length === 2) return parts[0]*60 + parts[1];
      return null;
    })();
    if (theirs == null) assert.ok(!isFinite(mine), v + ': /start accepted what the app refuses');
    else assert.equal(mine, theirs, v + ': /start and the app disagree');
  });
});

// ===========================================================================
// 2. THE KEYBOARD THE ATHLETE ACTUALLY GETS
// ===========================================================================

test('the field asks for the keypad that has a separator on it', () => {
  const i = SRC.indexOf('id="bld-bench-time"');
  assert.ok(i !== -1, 'the benchmark field has gone');
  const tag = SRC.slice(SRC.lastIndexOf('<input', i), SRC.indexOf('>', i) + 1);
  assert.match(tag, /inputmode="decimal"/,
    'a digits-only keypad cannot produce any separator the parser accepts');
  assert.doesNotMatch(tag, /inputmode="numeric"/);
  assert.match(tag, /placeholder="45:00 or 45\.00"/,
    'the placeholder must name a format the keypad on screen can produce');
});

test('the hint and the error both name a format the keypad can produce', () => {
  assert.match(SRC, /45:00, or 45\.00 if your keypad has no colon/);
  assert.match(SRC, /Give your benchmark time as minutes and seconds, like 45:00 or 45\.00\./);
  assert.doesNotMatch(SRC, /Give your benchmark time as minutes and seconds, like 45:00\.'/,
    'the old error still tells the athlete to type something they cannot');
});

// ===========================================================================
// 3. VALIDATION AND BANKING READ THE SAME VALUE
// ===========================================================================

test('what passes validation is what gets banked', () => {
  /* The second half of the bug, and the one a copy change alone would have
     left behind: submitBuild() converted with the STRICT parser. A "45.00"
     that had just passed validation would bank NaN, the app's
     adoptPendingBuildIfAny() would refuse on !(benchmarkSeconds > 0), and
     the athlete would meet an empty builder with no explanation. */
  const benchReads = SRC.match(/(?:clockToSec|parseBenchmarkTime)\(Ans\.benchTime\)/g) || [];
  assert.equal(benchReads.length, 2, 'the benchmark is read in exactly two places');
  benchReads.forEach(r => assert.equal(r, 'parseBenchmarkTime(Ans.benchTime)',
    'one of validation/banking still uses the strict parser: ' + r));
  assert.match(SRC, /benchmarkSeconds: benchSec/, 'the banked field has moved');
});

test('clockToSec itself is untouched and still strict for everything else', () => {
  const ctx = vm.createContext({});
  vm.runInContext(pageFn('clockToSec', SRC), ctx);
  assert.equal(ctx.clockToSec('23:25'), 23 * 60 + 25);
  assert.ok(!isFinite(ctx.clockToSec('23.25')),
    'the strict parser must stay strict -- only the benchmark field is permissive');
});
