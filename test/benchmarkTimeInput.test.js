'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* BENCHMARK TIME INPUT — "." AS AN ANDROID-TYPABLE ALTERNATIVE TO ":".
 * ===========================================================================
 * Android's numeric keypad has no ":" within easy reach, so the Benchmark
 * Time field on /start (and its twin in Re-calibrate) now also accepts "."
 * as a minutes/seconds separator. "23.25" must mean 23 minutes 25 seconds --
 * never 23 decimal minutes -- and "23:25" must keep working exactly as
 * before. Nothing about what the benchmark IS or how it feeds VDOT/pace
 * changes; only what the athlete is allowed to type changes.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

const TODAY = '2026-08-20';

function buildJourney(mutate) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  if (mutate) mutate(a);
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  assert.ok(html, 'openSetupModal() did not open anything');
  return { a, html };
}

// ===========================================================================
// 1. parseBenchmarkTime() — THE PARSER ITSELF
// ===========================================================================
test('PARSE: "." means the same thing "," ":" already means -- 23.25 is 23m25s, not 23.25 decimal minutes', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.parseBenchmarkTime('23.25'), 23 * 60 + 25);
  assert.equal(a.parseBenchmarkTime('23:25'), 23 * 60 + 25);
  assert.equal(a.parseBenchmarkTime('23.25'), a.parseBenchmarkTime('23:25'),
    '"." and ":" must parse to the identical value');
});

test('PARSE: h:mm:ss / h.mm.ss both still resolve for long benchmark efforts', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.parseBenchmarkTime('1:05:30'), 3600 + 5 * 60 + 30);
  assert.equal(a.parseBenchmarkTime('1.05.30'), 3600 + 5 * 60 + 30);
});

test('PARSE: whitespace around the value is tolerated, exactly as clockToSec already tolerated it', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.parseBenchmarkTime('  23:25  '), 23 * 60 + 25);
  assert.equal(a.parseBenchmarkTime('  23.25  '), 23 * 60 + 25);
});

test('PARSE: invalid values still fail -- empty, garbage, and a bare number with no separator', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.parseBenchmarkTime(''), null);
  assert.equal(a.parseBenchmarkTime(null), null);
  assert.equal(a.parseBenchmarkTime(undefined), null);
  assert.equal(a.parseBenchmarkTime('abc'), null);
  assert.equal(a.parseBenchmarkTime('23'), null, 'no separator at all must not be guessed at');
  assert.equal(a.parseBenchmarkTime('twenty three twenty five'), null);
});

// ===========================================================================
// 2. EVERY CALL SITE THAT READS THE BENCHMARK FIELD USES THE NEW PARSER
// ===========================================================================
test('WIRING: su-bench-time and rc-bench-time are read through parseBenchmarkTime everywhere, not the stricter clockToSec', () => {
  ['handleSuggestGoals', 'handleRecalibrateSuggest', 'handleSaveRecalibrate'].forEach(fnName => {
    const start = SRC.indexOf('function ' + fnName);
    assert.ok(start !== -1, fnName + ' not found');
    const body = SRC.slice(start, SRC.indexOf('\n}', start));
    assert.match(body, /parseBenchmarkTime\(document\.getElementById\('(su|rc)-bench-time'\)/,
      fnName + ' still reads the benchmark field through the old strict parser');
  });
});

// ===========================================================================
// 3. END TO END: THE BUILDER ACCEPTS 23.25 AND PRODUCES THE SAME VDOT PATH AS 23:25
// ===========================================================================
test('END-TO-END: Suggest Goals From Benchmark on /start works identically for 23.25 and 23:25', () => {
  function suggestWith(benchTimeStr) {
    const a = loadApp({ pinnedDate: TODAY });
    a.state.setup = { distanceKey: 'half' };
    const goals = {};
    a.document.getElementById = (id) => {
      if (id === 'su-bench-dist') return { value: '5k' };
      if (id === 'su-distance') return { value: 'half' };
      if (id === 'su-bench-time') return { value: benchTimeStr };
      if (id.indexOf('su-goal-') === 0) {
        return { set value(v) { goals[id] = v; } };
      }
      return null;
    };
    a.handleSuggestGoals();
    return goals;
  }

  const goalsColon = suggestWith('23:25');
  const goalsDotted = suggestWith('23.25');
  assert.deepEqual(goalsDotted, goalsColon,
    'the same benchmark typed with "." vs ":" must suggest identical goal paces');
  assert.ok(Object.keys(goalsColon).length > 0, 'no goals were suggested at all -- the harness mock is wrong');
});

test('END-TO-END: an invalid benchmark still shows the updated error toast, in both entry points', () => {
  const su = loadApp({ pinnedDate: TODAY });
  su.state.setup = { distanceKey: 'half' };
  let suToast = null;
  su.showToast = (m) => { suToast = m; };
  su.document.getElementById = (id) => (id === 'su-bench-time' ? { value: 'not a time' } : { value: '' });
  su.handleSuggestGoals();
  assert.equal(suToast, 'Enter your time as minutes and seconds, e.g. 23.25 or 23:25');

  const rc = loadApp({ pinnedDate: TODAY });
  let rcToast = null;
  rc.showToast = (m) => { rcToast = m; };
  rc.document.getElementById = (id) => (id === 'rc-bench-time' ? { value: 'not a time' } : { value: '' });
  rc.handleRecalibrateSuggest();
  assert.equal(rcToast, 'Enter your time as minutes and seconds, e.g. 23.25 or 23:25');
});

test('SAVE: Re-calibrate persists the same benchmark seconds whether the athlete typed "." or ":"', () => {
  function saveWith(benchTimeStr) {
    const a = loadApp({ pinnedDate: TODAY });
    buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12 });
    a.openModal = () => {};
    a.closeModal = () => {};
    a.scheduleSave = () => {};
    a.showToast = () => {};
    a.document.getElementById = (id) => {
      if (id === 'rc-bench-dist') return { value: '5k' };
      if (id === 'rc-bench-time') return { value: benchTimeStr };
      if (id === 'rc-goal-A') return { value: '1:45:00' };
      if (id === 'rc-goal-B') return { value: '' };
      if (id === 'rc-goal-C') return { value: '' };
      return null;
    };
    a.handleSaveRecalibrate();
    return a.state.setup.benchmark.timeSec;
  }
  assert.equal(saveWith('23.25'), 23 * 60 + 25);
  assert.equal(saveWith('23.25'), saveWith('23:25'));
});

// ===========================================================================
// 4. THE VISIBLE COPY AND KEYBOARD HINT
// ===========================================================================
test('COPY: the /start Benchmark Time field shows the new format hint and an easier keyboard', () => {
  const { html } = buildJourney();
  const inputStart = html.indexOf('id="su-bench-time"');
  assert.ok(inputStart !== -1);
  const tag = html.slice(html.lastIndexOf('<input', inputStart), html.indexOf('>', inputStart) + 1);
  assert.match(tag, /inputmode="decimal"/, 'still forces the awkward default keyboard');
  assert.match(tag, /placeholder="23:25 or 23\.25"/);
  assert.match(html, /Enter your time as minutes and seconds, e\.g\. 23\.25 or 23:25\./);
});

test('COPY: the Re-calibrate modal\'s benchmark field carries the same hint and keyboard', () => {
  const a = loadApp({ pinnedDate: TODAY });
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12 });
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openRecalibrateModal();
  assert.ok(html);
  const inputStart = html.indexOf('id="rc-bench-time"');
  assert.ok(inputStart !== -1);
  const tag = html.slice(html.lastIndexOf('<input', inputStart), html.indexOf('>', inputStart) + 1);
  assert.match(tag, /inputmode="decimal"/);
  assert.match(tag, /placeholder="23:25 or 23\.25"/);
  assert.match(html, /Enter your time as minutes and seconds, e\.g\. 23\.25 or 23:25\./);
});

// ===========================================================================
// 5. NOTHING METHODOLOGICAL MOVED
// ===========================================================================
test('SAFETY: clockToSec, vdotFromPerformance and equivalentTimeSec are untouched', () => {
  const a = loadApp({ pinnedDate: TODAY });
  assert.equal(a.clockToSec('23:25'), 23 * 60 + 25, 'clockToSec itself must still refuse "." -- only the benchmark field is more permissive');
  assert.equal(a.clockToSec('23.25'), null, 'clockToSec is the pre-existing strict parser and must stay strict everywhere else that still calls it');
});
