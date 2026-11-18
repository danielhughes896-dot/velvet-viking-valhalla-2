'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE TIME WHEEL. Founder: "flick each column vertically with momentum,
   like Apple's native time picker, with a subtle haptic click as each
   number settles", on "anywhere an athlete enters a race time, benchmark
   or checkpoint result ... build or log time input." */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const app = () => loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });

test('every time and pace field in the app is named once, and only those', () => {
  const a = app();
  const sels = a.TIME_WHEEL_FIELDS.map(f => f.sel).join(', ');
  ['#su-goal-A', '#rc-goal-C', '#su-bench-time', '#rc-bench-time', '.pzr-input',
   '[data-action="actual-field"][data-field="pace"]', '[data-action="slog-field"][data-field="pace"]',
   '[data-action="split-field"][data-field="sec"]'].forEach(s => assert.ok(sels.indexOf(s) !== -1, s + ' is not on the wheel'));
  assert.equal(a.TIME_WHEEL_FIELDS.filter(f => f.mode === 'hms').length, 2);
});

test('the value written back is the form each field already parses', () => {
  const a = app();
  assert.equal(a.timeWheelFormat('hms', { h: 0, m: 42, s: 7 }), '42:07');
  assert.equal(a.timeWheelFormat('hms', { h: 1, m: 36, s: 5 }), '1:36:05');
  assert.equal(a.timeWheelFormat('pace', { m: 5, s: 9 }), '5:09');
  assert.equal(a.parseBenchmarkTime(a.timeWheelFormat('hms', { h: 0, m: 42, s: 7 })), 42 * 60 + 7);
  assert.equal(a.clockToSec(a.timeWheelFormat('hms', { h: 3, m: 19, s: 47 })), 3 * 3600 + 19 * 60 + 47);
  // and it opens on what is already there, including the dotted and bare-digit forms
  assert.equal(JSON.stringify(a.timeWheelParse('hms', '1:36:45')), JSON.stringify({ h: 1, m: 36, s: 45 }));
  assert.equal(JSON.stringify(a.timeWheelParse('hms', '23.25')), JSON.stringify({ h: 0, m: 23, s: 25 }));
  assert.equal(JSON.stringify(a.timeWheelParse('pace', '530')), JSON.stringify({ m: 5, s: 30 }));
});

test('one column per unit, and the minute and second columns run to 59', () => {
  const a = app();
  assert.deepEqual(a.TIME_WHEEL_COLS.hms.map(c => c.key).join(), 'h,m,s');
  assert.deepEqual(a.TIME_WHEEL_COLS.pace.map(c => c.key).join(), 'm,s');
  const html = a.timeWheelSheetHtml(a.TIME_WHEEL_FIELDS[1], { h: 0, m: 45, s: 33 });
  ['Hours', 'Minutes', 'Seconds'].forEach(l => assert.match(html, new RegExp('<span>' + l + '</span>')));
  assert.equal((html.match(/class="tw-col"/g) || []).length, 3);
  assert.match(html, /data-action="time-wheel-use">Use 45:33</);
});

test('momentum is the platform’s own: each column is a scroll-snap list', () => {
  assert.match(CSS, /\.tw-col\{[^}]*overflow-y:scroll[^}]*scroll-snap-type:y mandatory/);
  assert.match(CSS, /\.tw-item\{[^}]*scroll-snap-align:center/);
  assert.match(CSS, /\.tw-sheet\{[^}]*backdrop-filter:blur\(22px\)/, 'the wheel is not on the glass sheet');
});

test('a click per number that settles under the band, never one per scroll event', () => {
  const i = SRC.indexOf('function openTimeWheel(');
  const body = SRC.slice(i, SRC.indexOf('\nfunction ', i + 10));
  assert.match(body, /if \(n !== timeWheelOpen\.value\[key\]\)\{[\s\S]{0,200}sacoroHaptic\('tick'\)/);
});

test('no keyboard: the fields are read-only and a tap raises the wheel', () => {
  const i = SRC.indexOf('function markTimeWheelFields(');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.match(body, /el\.readOnly = true/);
  assert.match(body, /setAttribute\('inputmode', 'none'\)/);
  assert.match(SRC, /case 'time-wheel-use': useTimeWheel\(\); break;/);
});
