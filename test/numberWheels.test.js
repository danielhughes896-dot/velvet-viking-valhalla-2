'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* EVERY NUMBER IS A WHEEL, AND THE WHEEL OWNS ITS DRAG (founder, 16
   November 2026, with two screenshots):
     "The time roller is hard to do because when you swipe the time down it
      tries to close the panel."
     "include race segment then doesn't let you type or select? ... Can all
      number inputs be the same swipe design? Not manual input? Same as the
      rest of the app?"
     "Can all pop up panels be closed left right and down?" */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const app = () => loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
const fnBody = name => { const i = SRC.indexOf('\nfunction ' + name + '('); return SRC.slice(i, SRC.indexOf('\n}\n', i)); };

test('every number field the athlete fills is on a wheel, not the keyboard', () => {
  const a = app();
  const sels = a.TIME_WHEEL_FIELDS.map(f => f.sel).join(', ');
  ['#ef-km', '#ef-mp-km', '#su-volume', '#su-entry-long', '#su-lthr', '#su-maxhr', '#su-weeks',
   '[data-action="actual-field"][data-field="km"]', '[data-action="actual-field"][data-field="hr"]',
   '[data-action="actual-field"][data-field="elevationGainM"]',
   '[data-action="split-field"][data-field="km"]', '[data-action="split-field"][data-field="hr"]',
   '[data-action="slog-field"][data-field="km"]', '[data-action="slog-field"][data-field="hr"]']
    .forEach(s => assert.ok(sels.indexOf(s) !== -1, s + ' still opens the keyboard'));
  /* And nothing typed is left: every type="number" field the app draws is one of them. */
  const drawn = [...SRC.matchAll(/<input type="number"[^>]*?(id="([^"]+)"|data-action="([^"]+)" data-field="([^"]+)")/g)]
    .map(m => m[2] ? '#' + m[2] : '[data-action="' + m[3] + '"][data-field="' + m[4] + '"]');
  const named = SRC.match(/var TIME_WHEEL_FIELDS = \[[\s\S]*?\n\];/)[0];
  drawn.forEach(s => assert.ok(named.indexOf(s) !== -1, s + ' is a number field with no wheel'));
});

test('the figure written back is the one each field already reads', () => {
  const a = app();
  assert.equal(a.timeWheelFormat('dist1', { w: 7, f: 5 }), '7.5');
  assert.equal(a.timeWheelFormat('dist1', { w: 12, f: 0 }), '12');
  assert.equal(a.timeWheelFormat('dist2', { w: 10, f: 3 }), '10.03');
  assert.equal(a.timeWheelFormat('dist2', { w: 10, f: 30 }), '10.3');
  assert.equal(a.timeWheelFormat('bpm', { n: 152 }), '152');
  assert.equal(JSON.stringify(a.timeWheelParse('dist1', '7.5')), JSON.stringify({ w: 7, f: 5 }));
  assert.equal(JSON.stringify(a.timeWheelParse('dist2', '10.03')), JSON.stringify({ w: 10, f: 3 }));
  assert.equal(JSON.stringify(a.timeWheelParse('metres', '127')), JSON.stringify({ n: 130 }));
  assert.equal(a.timeWheelParse('bpm', ''), null, 'an empty field is read as a figure');
  assert.equal(a.timeWheelText('dist1', { w: 7, f: 5 }), '7.5km');
  assert.equal(a.timeWheelText('weeks', { n: 12 }), '12 weeks');
});

test('one column per part of the figure, in the athlete\'s own unit', () => {
  const a = app();
  const field = a.TIME_WHEEL_FIELDS.find(f => f.sel === '#ef-km');
  let html = a.timeWheelSheetHtml(field, { w: 7, f: 5 });
  ['Kilometres', 'Tenths'].forEach(l => assert.match(html, new RegExp('<span>' + l + '</span>')));
  assert.equal((html.match(/class="tw-col"/g) || []).length, 2);
  assert.match(html, /data-action="time-wheel-use">Use 7\.5km</);
  a.state.units = 'mi';
  html = a.timeWheelSheetHtml(field, { w: 4, f: 5 });
  assert.match(html, /<span>Miles<\/span>/);
  assert.match(html, /Use 4\.5mi</);
  /* Elevation turns in tens of metres. */
  const elev = a.TIME_WHEEL_FIELDS.find(f => f.mode === 'metres');
  const eh = a.timeWheelSheetHtml(elev, { n: 120 });
  assert.equal((eh.match(/class="tw-item"/g) || []).length, 301);
  assert.match(eh, /data-step="10"/);
});

test('an optional figure can be cleared, a required one cannot, and Use stays on the right', () => {
  const a = app();
  const hr = a.TIME_WHEEL_FIELDS.find(f => f.sel.indexOf('[data-field="hr"]') !== -1);
  const km = a.TIME_WHEEL_FIELDS.find(f => f.sel === '#ef-km');
  const filled = { value: '150', getAttribute(){ return null; } };
  const empty = { value: '', getAttribute(){ return null; } };
  const h1 = a.timeWheelSheetHtml(hr, { n: 150 }, filled);
  assert.match(h1, /data-action="time-wheel-clear">Clear<\/button><button[^>]*data-action="time-wheel-use"/, 'Clear is not left of Use');
  assert.doesNotMatch(a.timeWheelSheetHtml(hr, { n: 150 }, empty), /time-wheel-clear/, 'Clear offered on an empty field');
  assert.doesNotMatch(a.timeWheelSheetHtml(km, { w: 7, f: 5 }, { value: '7.5', getAttribute(){ return null; } }), /time-wheel-clear/,
    'the session distance can be cleared');
  assert.match(SRC, /case 'time-wheel-clear': clearTimeWheel\(\); break;/);
});

test('a pull down on a wheel turns the wheel; every sheet leaves left, right and down', () => {
  assert.match(fnBody('pageSwipeOwnedElsewhere'), /\.tw-col, \.tw-wheels/);
  const start = fnBody('pageSwipeStart');
  assert.doesNotMatch(start, /pageSwipeCloseOf\(card\)\) return;\s*sheet = true;/, 'a sheet still closes down only');
  /* The builder past its first screen is the one down-only surface. */
  assert.match(start, /bldCurrentStage > 0\) sheet = true;/);
  /* An inner list scrolled down scrolls back up before the sheet moves. */
  assert.match(fnBody('pageSwipeOwnedElsewhere'), /node\.scrollTop > 0 && node\.scrollHeight > node\.clientHeight/);
});

test('the goal-pace segment asks how far, and the instructions say it', () => {
  const a = app();
  ['showToast', 'renderApp', 'flushSave', 'scheduleSave', 'closeModal'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-09' });
  let html = '';
  a.openModal = h => { html = h; };
  const dd = a.state.days.find(d => d.type === 'easy' && d.date > '2026-11-16');
  a.openEditModal(dd.id);
  assert.match(html, /class="field ef-mp-km" hidden>/, 'the distance shows before the box is ticked');
  assert.match(html, /id="ef-mp" data-action="ef-mp-toggle"/);
  /* Save, with the sheet's own fields. */
  const els = {};
  const field = (id, v) => { els[id] = { id, value: v, checked: v === true, hidden: false }; };
  field('ef-title', dd.title); field('ef-type', dd.type); field('ef-km', String(dd.km)); field('ef-mp', true);
  field('ef-mp-km', '3'); field('ef-desc', a.resolveDesc(dd.desc)); field('ef-swap', '');
  a.document.getElementById = id => els[id] || null;
  a.handleSaveEdit(dd.id);
  assert.equal(dd.mpSegment, true);
  assert.equal(dd.mpSegmentKm, 3);
  assert.match(dd.desc, /Includes 3km at goal pace\.$/);
  /* Saved again with a new figure, the sentence is replaced, not stacked. */
  els['ef-mp-km'].value = '4'; els['ef-desc'].value = a.resolveDesc(dd.desc);
  a.handleSaveEdit(dd.id);
  assert.equal((dd.desc.match(/at goal pace/g) || []).length, 1);
  assert.match(dd.desc, /Includes 4km at goal pace\.$/);
  /* Never longer than the session. */
  els['ef-mp-km'].value = String(dd.km + 5); els['ef-desc'].value = a.resolveDesc(dd.desc);
  a.handleSaveEdit(dd.id);
  assert.equal(dd.mpSegmentKm, dd.km);
  /* Unticked, the figure and the sentence go. */
  els['ef-mp'].checked = false; els['ef-desc'].value = a.resolveDesc(dd.desc);
  a.handleSaveEdit(dd.id);
  assert.equal(dd.mpSegment, false);
  assert.equal(dd.mpSegmentKm, undefined);
  assert.doesNotMatch(dd.desc, /goal pace/);
});
