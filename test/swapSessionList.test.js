'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* "SWAP THIS SESSION WITH..." IS THE PLAN'S OWN ROWS, NOT THE OS PICKER
   =========================================================================
   A native <select> on a phone is drawn by the phone: system grey, a system
   tint radio, system type, full height. The athlete tapped a Velvet Viking
   card and got an OS list back -- and the one thing that list has to help
   them do is recognise a session, which the plan does with a coloured rail, a
   type badge and the session's own name, and the picker threw all three away.

   THE VALUE STILL LIVES IN THE <select>. That is the whole safety of this
   change and it is what these tests are mostly about: handleSaveEdit() reads
   document.getElementById('ef-swap').value and must go on doing so, with the
   same ids, in the same order, and with every existing swap guard untouched. */

const RUNTIME = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-09-13';

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '10k', volume: 50, weeks: 12, startDate: a.addDays(TODAY, -7) });
  const dd = a.state.days.filter(d => d.type === 'interval')[0];
  assert.ok(dd, 'no session to open the editor on');
  let html = '';
  a.openModal = h => { html = h; };
  a.openEditModal(dd.id);
  return { a, dd, html };
}
// The ef-swap <select> only, never the Session Type select beside it.
function swapSelect(html){
  const at = html.indexOf('id="ef-swap"');
  return html.slice(at, at + html.slice(at).indexOf('</select>'));
}
const optionIds = html => [...swapSelect(html).matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
const rowIds    = html => [...html.matchAll(/data-swap="([^"]+)"/g)].map(m => m[1]);

// =====================================================================
// 1. THE VALUE STILL LIVES WHERE THE SAVE PATH LOOKS FOR IT
// =====================================================================

test('the select still exists, and is now the hidden mirror', () => {
  const { html } = athlete();
  assert.match(html, /id="ef-swap"/, 'the element handleSaveEdit reads is gone');
  assert.match(html, /<select id="ef-swap" class="bld-mirror"/,
    'the select is still the visible control — the OS will still draw it');
  assert.match(html, /aria-hidden="true"/);
});

test('handleSaveEdit still reads the select, and nothing else', () => {
  assert.match(RUNTIME, /var swapId = document\.getElementById\('ef-swap'\)\.value;/,
    'the save path was rewritten — this change was supposed to be presentation only');
});

test('every row has an option, in the same order, with the same ids', () => {
  const { html } = athlete();
  const opts = optionIds(html), rows = rowIds(html);
  assert.ok(rows.length > 0, 'no rows rendered');
  assert.equal(opts.join(','), rows.join(','),
    'the list and the value it writes have drifted apart');
});

test('the day being edited is offered by neither', () => {
  const { dd, html } = athlete();
  assert.equal(optionIds(html).indexOf(dd.id), -1, 'a session was offered a swap with itself');
  assert.equal(rowIds(html).indexOf(dd.id), -1);
});

test('the empty choice is still there, so a selection can be undone', () => {
  const { html } = athlete();
  assert.match(swapSelect(html), /<option value="" selected>/,
    'nothing represents "no swap", so the mirror could not be cleared');
});

// =====================================================================
// 2. IT LOOKS LIKE THE PLAN, BECAUSE IT IS THE PLAN'S OWN MARKUP
// =====================================================================

test('each row is a .day with its own type rail and badge', () => {
  const { a, html } = athlete();
  const rows = [...html.matchAll(/<button type="button" class="swap-day day type-([a-z]+)"[\s\S]*?<\/button>/g)];
  assert.equal(rows.length, rowIds(html).length, 'a row was rendered without the plan card shell');
  rows.forEach(m => {
    assert.match(m[0], /class="day-date font-mono"/, 'the mono date is missing');
    assert.match(m[0], /class="day-badge type-/, 'the type badge is missing');
    assert.match(m[0], /class="day-title"/, 'the session name is missing');
  });
  // the rails are the real type classes, read from TYPE_META rather than invented
  const rails = new Set(rows.map(m => m[1]));
  const known = new Set(Object.keys(a.TYPE_META).map(t => a.TYPE_META[t].cls));
  rails.forEach(r => assert.ok(known.has(r), 'invented a rail class: ' + r));
  assert.ok(rails.size > 2, 'every row came out the same colour — the rail is not following the type');
});

test('the badge text is the plan’s own, not a second vocabulary', () => {
  const { a, html } = athlete();
  rowIds(html).forEach(id => {
    const day = a.findDay(id);
    const label = a.dayTypeLabel(day);
    assert.ok(html.indexOf('>' + label + '</span>') !== -1 || html.indexOf(label) !== -1,
      'row ' + id + ' does not carry dayTypeLabel()’s own words');
  });
});

test('weeks are grouped, in order, and no group is empty', () => {
  const { a, html } = athlete();
  const heads = [...html.matchAll(/class="swap-week font-head">Week (\d+)</g)].map(m => Number(m[1]));
  assert.ok(heads.length > 1, 'the list is not grouped by week');
  assert.deepEqual(heads.slice().sort((x, y) => x - y).join(','), heads.join(','),
    'the weeks came out in hash order rather than in plan order');
  // every week with rows has a head, and no head has no rows
  const weeksWithRows = new Set(rowIds(html).map(id => a.findDay(id).week));
  assert.equal(heads.length, weeksWithRows.size, 'a week header was drawn over nothing');
});

// =====================================================================
// 3. PICKING
// =====================================================================

function picker(){
  const { a, dd, html } = athlete();
  /* A DOM small enough to be honest about what the handler touches: the
     mirror and the rows, and nothing else. */
  const rows = rowIds(html).map(id => ({
    id, cls: new Set(), attrs: {},
    getAttribute(k){ return k === 'data-swap' ? this.id : (this.attrs[k] || null); },
    setAttribute(k, v){ this.attrs[k] = v; },
    classList: { toggle(c, on){ on ? rowsById[this._id].cls.add(c) : rowsById[this._id].cls.delete(c); } }
  }));
  const rowsById = {};
  rows.forEach(r => { rowsById[r.id] = r; r.classList._id = r.id; });
  const sel = { value: '' };
  a.document = {
    getElementById(id){
      if (id === 'ef-swap') return sel;
      if (id === 'ef-swap-list') return { querySelectorAll(){ return rows; } };
      return null;
    }
  };
  return { a, sel, rows, rowsById };
}

test('tapping a row puts that id in the select', () => {
  const { a, sel, rowsById } = picker();
  const first = Object.keys(rowsById)[0];
  a.handleEditSwapPick(first);
  assert.equal(sel.value, first, 'the tap did not reach the value the save path reads');
  assert.ok(rowsById[first].cls.has('is-picked'), 'the tapped row is not marked');
  assert.equal(rowsById[first].attrs['aria-checked'], 'true');
});

test('tapping a different row moves the selection rather than adding one', () => {
  const { a, sel, rowsById } = picker();
  const ids = Object.keys(rowsById);
  a.handleEditSwapPick(ids[0]);
  a.handleEditSwapPick(ids[1]);
  assert.equal(sel.value, ids[1]);
  assert.equal(rowsById[ids[0]].cls.has('is-picked'), false, 'two rows were selected at once');
  assert.equal(rowsById[ids[0]].attrs['aria-checked'], 'false');
  assert.ok(rowsById[ids[1]].cls.has('is-picked'));
});

test('tapping the chosen row again clears it, which is the only way back out', () => {
  const { a, sel, rowsById } = picker();
  const id = Object.keys(rowsById)[0];
  a.handleEditSwapPick(id);
  a.handleEditSwapPick(id);
  assert.equal(sel.value, '', 'a selection could not be undone — the athlete is stuck with a swap');
  assert.equal(rowsById[id].cls.has('is-picked'), false);
  assert.equal(rowsById[id].attrs['aria-checked'], 'false');
});

test('the handler is reachable from the click dispatcher', () => {
  assert.match(RUNTIME, /case 'ef-swap-pick': handleEditSwapPick\(target\.getAttribute\('data-swap'\)\);/,
    'the rows carry an action nothing handles');
});

// =====================================================================
// 4. NOTHING ELSE ABOUT THE EDITOR MOVED
// =====================================================================

test('the swap guards and the rest of the modal are untouched', () => {
  const { html } = athlete();
  ['ef-title', 'ef-type', 'ef-km', 'ef-desc', 'ef-completed'].forEach(id =>
    assert.ok(html.indexOf('id="' + id + '"') !== -1, id + ' went missing from the editor'));
  // the existing integrity guards still stand between a pick and a swap
  assert.match(RUNTIME, /swapWouldPlaceCompletionInFuture/);
  assert.match(RUNTIME, /confirmSwapIfLogged/);
  assert.match(RUNTIME, /swapWorkoutFields/);
});

test('the hint the athlete relies on is still there', () => {
  const { html } = athlete();
  assert.match(html, /Swaps everything except the calendar date/);
  assert.match(html, /drag day cards onto each other/);
});

test('a day with no week number is still listed, under its own heading', () => {
  /* A hand-built day -- and several test fixtures build them this way -- has
     no week. Sorting the week keys numerically and then indexing with the
     number loses it entirely and throws on the next line. */
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '10k', volume: 50, weeks: 12, startDate: a.addDays(TODAY, -7) });
  const dd = a.state.days.filter(d => d.type === 'interval')[0];
  const orphan = a.state.days.filter(d => d.id !== dd.id)[0];
  delete orphan.week;
  let html = '';
  a.openModal = h => { html = h; };
  assert.doesNotThrow(() => a.openEditModal(dd.id), 'the editor throws on a day with no week');
  assert.ok(rowIds(html).indexOf(orphan.id) !== -1, 'the day was dropped from the list');
  assert.doesNotMatch(html, /Week undefined|Week NaN/, 'a missing week was printed at the athlete');
  assert.match(html, /Other days/);
});

test('weeks sort numerically, so week 10 does not come before week 2', () => {
  const { html } = athlete();
  const heads = [...html.matchAll(/class="swap-week font-head">Week (\d+)</g)].map(m => Number(m[1]));
  assert.ok(heads.indexOf(10) > heads.indexOf(2), 'the weeks are in string order');
});

test('a plan of one day offers an empty list rather than a broken one', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '10k', volume: 50, weeks: 12, startDate: a.addDays(TODAY, -7) });
  const keep = a.state.days[0];
  a.state.days = [keep];
  let html = '';
  a.openModal = h => { html = h; };
  a.openEditModal(keep.id);
  assert.equal(rowIds(html).length, 0);
  assert.doesNotMatch(html, /class="swap-week/, 'a week header was drawn with nothing under it');
  assert.match(html, /id="ef-swap"/, 'the mirror must still exist for the save path');
});
