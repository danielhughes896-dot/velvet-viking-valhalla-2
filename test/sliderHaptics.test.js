'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* Founder: "Apply consistent, subtle haptic feedback to every interactive
   slider in SACORO, including Log Session, Build-a-Plan and any other screens
   containing sliders. Use one light tick per meaningful value change, with
   slightly stronger feedback at important thresholds where appropriate. Do
   not trigger continuous vibration, duplicate feedback or haptics during
   automatic value updates. Use the existing shared haptic system rather than
   implementing separate logic for each slider. Preserve all existing slider
   ranges, values, coaching calculations, scoring logic and visual styling.
   Audit every slider to ensure none are missed. Support both Android and iOS." */

const ROOT = path.join(__dirname, '..');
const RT = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const START = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');
/* A function's source: from its declaration to the closing brace at its own indent. */
const fnIn = (src, n) => {
  const i = src.indexOf('function ' + n + '(');
  assert.ok(i > -1, n);
  const lineStart = src.lastIndexOf('\n', i) + 1;
  const indent = src.slice(lineStart, i);
  const end = src.indexOf('\n' + indent + '}', i);
  return src.slice(i, end + indent.length + 2);
};
const body = (src, n) => fnIn(src, n).split('\n').map(l => l.trim()).filter(Boolean).join('\n');

function range(min, max, value, marks){
  const attrs = { 'data-haptic-marks': marks == null ? null : String(marks) };
  return { type: 'range', min: String(min), max: String(max), value: String(value),
           getAttribute: k => attrs[k] == null ? null : attrs[k] };
}
function app(){
  const a = loadApp({ pinnedDate: '2026-11-13T07:00:00Z' });
  let t = 1000;
  a.Date.now = () => t;
  const felt = [];
  a.sacoroHaptic = k => felt.push(k);
  return { a, felt, at: ms => { t = ms; } };
}
const touch = (a, el) => a.sliderInputHaptic({ target: el, isTrusted: true });

// ------------------------------------------------------------------ the audit
test('the audit: every slider on every page is felt through one document listener', () => {
  const pages = fs.readdirSync(ROOT).filter(f => /\.html$/.test(f)).concat([RUNTIME_RELATIVE]);
  const withSliders = [];
  pages.forEach(p => {
    const src = fs.readFileSync(path.join(ROOT, p), 'utf8');
    if (!/type="range"|type=\\"range\\"/.test(src)) return;
    withSliders.push(p);
    assert.match(src, /document\.addEventListener\('input', sliderInputHaptic, true\)/,
      p + ' has a slider that is never felt');
  });
  assert.deepEqual(withSliders.sort(), [RUNTIME_RELATIVE, 'start.html'].sort(),
    'a page gained or lost sliders: check it is felt and update this list');
  /* The sliders this covers, named so a new one is noticed. */
  const logFields = (RT.match(/logRangeHtml\(dd, \{ field:'(\w+)'/g) || []).map(s => /'(\w+)'/.exec(s)[1]).sort();
  assert.deepEqual(logFields, ['mainSetFelt', 'mainSetHeld', 'repsDone', 'rpe']);
  const bld = (RT.match(/bldRangeHtml\('([\w-]+)'/g) || []).map(s => /'([\w-]+)'/.exec(s)[1]).sort();
  assert.deepEqual(bld, ['su-entry-days', 'su-entry-long', 'su-volume', 'su-weeks']);
  const startR = (START.match(/rangeHtml\('([\w-]+)'/g) || []).map(s => /'([\w-]+)'/.exec(s)[1]).sort();
  assert.deepEqual(startR, ['bld-entry-days', 'bld-entry-long', 'bld-volume', 'bld-weeks']);
});

// ------------------------------------------------------------------ the rule
test('one tick per value, never the same value twice, and never a buzz', () => {
  const { a, felt, at } = app();
  const el = range(1, 10, 5);
  el.value = '6'; touch(a, el);
  assert.deepEqual(felt, ['tick']);
  touch(a, el);
  assert.deepEqual(felt, ['tick'], 'the same value was felt twice');
  at(1020); el.value = '7'; touch(a, el);
  assert.deepEqual(felt, ['tick'], 'two ticks 20ms apart: a fast sweep would buzz');
  at(1080); el.value = '8'; touch(a, el);
  assert.deepEqual(felt, ['tick', 'tick']);
  /* The skipped 7 is not owed: going back to 7 is a new value. */
  at(1140); el.value = '7'; touch(a, el);
  assert.deepEqual(felt, ['tick', 'tick', 'tick']);
  assert.equal(a.SLIDER_TICK_GAP_MS, 50);
});

test('the thresholds are slightly stronger: both ends, and the neutral middle of a five-word answer', () => {
  const { a, felt, at } = app();
  const el = range(1, 10, 5);
  el.value = '10'; touch(a, el);
  at(1010); el.value = '1'; touch(a, el);
  assert.deepEqual(felt, ['light', 'light'], 'an end is not felt, or is throttled like a step');
  const word = range(1, 5, 2, 3);
  at(2000); word.value = '3'; touch(a, word);
  assert.deepEqual(felt.slice(-1), ['light']);
  at(2100); word.value = '4'; touch(a, word);
  assert.deepEqual(felt.slice(-1), ['tick']);
  /* The Your Log questions carry the mark only where there is a middle word. */
  const html = a.logRangeHtml({ id: 'd1' }, { field: 'mainSetFelt', label: 'How did it feel?', min: 1, max: 5,
    value: null, start: 3, words: ['a', 'b', 'c', 'd', 'e'] });
  assert.match(html, /data-haptic-marks="3"/);
  const rpe = a.logRangeHtml({ id: 'd1' }, { field: 'rpe', label: 'Overall effort', min: 1, max: 10, value: null, start: 5, of: 10 });
  assert.doesNotMatch(rpe, /data-haptic-marks/);
});

test('automatic updates are silent: values written by code, other inputs, and no slider at all', () => {
  const { a, felt } = app();
  const el = range(0, 150, 0);
  el.value = '40';
  a.sliderInputHaptic({ target: el, isTrusted: false });
  a.sliderInputHaptic({ target: { type: 'text', value: '40' }, isTrusted: true });
  a.sliderInputHaptic(null);
  assert.deepEqual(felt, [], 'something other than a real touch on a slider was felt');
  /* The builder moves its slider by writing the value, which fires no event,
     and re-dispatches its own events on the TEXT field, never on a range. */
  assert.match(RT, /function bldSliderInput\(rg\)\{[\s\S]*?target\.dispatchEvent\(new Event\('input'/);
  const sync = RT.slice(RT.indexOf('function bldSyncSliders('), RT.indexOf('function bldSliderInput('));
  assert.doesNotMatch(sync, /dispatchEvent/, 'the builder’s sync now fires events on its sliders');
  /* A tap where an untouched Your Log thumb sits is an answer, and is felt once. */
  assert.match(RT, /if \(!el\.classList\.contains\('is-unset'\)\) return;\s*sliderHaptic\(el\);\s*handleLogAnswer\(/);
});

test('through the shared haptic system, on both platforms, and nothing about the value changes', () => {
  const fn = fnIn(RT, 'sliderHaptic');
  assert.match(fn, /sacoroHaptic\(kind\);/, 'sliders are not felt through the app’s own haptic system');
  ['sliderHaptic', 'sliderMark', 'sliderInputHaptic'].forEach(n =>
    assert.doesNotMatch(fnIn(RT, n), /\.value\s*=[^=]|setAttribute|style\./, n + ' writes to the slider'));
  /* iOS: the selection tick; Android: an 8ms tick; the threshold is the light impact. */
  const sh = fnIn(RT, 'sacoroHaptic');
  assert.match(sh, /nativePlatform\(\) === 'ios' && typeof h\.selectionChanged === 'function'/);
  assert.match(sh, /h\.vibrate\(\{ duration: 8 \}\)/);
  assert.match(sh, /kind === 'light' && h\.impact\)\{ quiet\(h\.impact\(\{ style:'LIGHT' \}\)\)/);
  /* Registered once, at start. */
  assert.equal((RT.match(/addEventListener\('input', sliderInputHaptic, true\)/g) || []).length, 1);
});

test('/start carries the same helper as the app, not a second idea of it', () => {
  ['sliderHaptic', 'sliderMark', 'sliderInputHaptic'].forEach(n =>
    assert.equal(body(START, n), body(RT, n), n + ' on /start has drifted from the app’s'));
  assert.match(START, /var SLIDER_TICK_GAP_MS = 50;/);
  const sh = fnIn(START, 'sacoroHaptic');
  assert.match(sh, /cap\.getPlatform\(\) === 'ios'/);
  assert.match(sh, /quiet\(h\.selectionStart && h\.selectionStart\(\)\); quiet\(h\.selectionChanged\(\)\); quiet\(h\.selectionEnd && h\.selectionEnd\(\)\);/);
  assert.match(sh, /h\.vibrate\(\{ duration: 8 \}\)/);
  assert.match(sh, /kind === 'light' && h\.impact\)\{ quiet\(h\.impact\(\{ style:'LIGHT' \}\)\)/);
  const appTick = fnIn(RT, 'sacoroHaptic').match(/quiet\(h\.selectionStart[^\n]*/)[0];
  assert.ok(sh.indexOf(appTick) > -1, 'the iOS tick differs between /start and the app');
  assert.match(START, /var HAPTIC_WEB_MS = \{ tick:8, light:12 \};/);
  assert.match(RT, /var HAPTIC_WEB_MS = \{ tick:8, light:12,/);
});
