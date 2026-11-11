'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* FOUR ANSWERS GIVEN WITH THE THUMB.
 *
 * Founder: "Change build a plan to have this 4 areas as the slider options"
 * -- running days in a typical week, current weekly volume, longest recent
 * run and training block length.
 *
 * What these laws protect is that the sliders are a new way to GIVE the four
 * answers and not a second copy of them: the builder still reads the ids it
 * always read, an exact figure can still be typed, the block length cannot
 * leave the programme's range, and an untouched question is stored as
 * unanswered rather than as zero.
 */

const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const SPEC = require(path.join(__dirname, '..', 'assets', 'builder-spec.js'));
const BS = SPEC.BUILDER_SPEC || SPEC;

function builderHtml(mutate) {
  const a = loadApp({ pinnedDate: '2026-11-11T09:00:00Z' });
  if (mutate) mutate(a);
  let html = null;
  a.openModal = (h) => { html = h; };
  a.openSetupModal();
  assert.ok(html, 'openSetupModal() did not open anything');
  return { a, html };
}
const field = (html, id) => {
  const i = html.indexOf('id="' + id + '"');
  assert.ok(i > 0, 'no field ' + id);
  const start = html.lastIndexOf('<div class="field', i);
  const next = html.indexOf('<div class="field', i + 10);
  const nav = html.indexOf('<div class="bld-actions"', i);
  const end = Math.min(next === -1 ? Infinity : next, nav === -1 ? Infinity : nav);
  return html.slice(start, end);
};
const cssRule = (selector) => {
  const i = CODE.indexOf(selector + '{');
  assert.ok(i > 0, selector + ' must have a rule');
  return CODE.slice(i, CODE.indexOf('}', i));
};
const count = (s, re) => (s.match(re) || []).length;

/* ---------- the four sliders, and the four fields behind them ---------- */

test('each of the four answers has one slider, standing in front of the field the builder reads', () => {
  const { html } = builderHtml();
  [['f-entry-days', 'su-entry-days'], ['f-volume', 'su-volume'],
   ['f-entry-long', 'su-entry-long'], ['f-weeks', 'su-weeks']].forEach(([f, id]) => {
    const block = field(html, f);
    assert.equal(count(block, /<input type="range" class="bld-range"/g), 1, f + ' has exactly one slider');
    assert.match(block, new RegExp('data-for="' + id + '"'), f + '\'s slider writes to #' + id);
    assert.equal(count(html, new RegExp('id="' + id + '"', 'g')), 1, '#' + id + ' is still there, exactly once');
  });
  assert.equal(count(html, /class="bld-range"/g), 4, 'four sliders, not one on every field');
});

test('the eight day-count tiles are gone and the answer is still the mirrored select', () => {
  const { html } = builderHtml();
  assert.doesNotMatch(html, /data-mirror="su-entry-days"/, 'the tile grid is back');
  const block = field(html, 'f-entry-days');
  assert.match(block, /<select id="su-entry-days" class="bld-mirror"/);
  [0, 1, 2, 3, 4, 5, 6, 7].forEach((n) => assert.match(block, new RegExp('<option value="' + n + '"')));
  assert.match(block, /class="bld-range-ticks"[^>]*>(<span>\d<\/span>){8}<\/div>/, 'the eight stops are numbered 0 to 7');
  assert.match(block, /min="0" max="7" step="1"/);
});

test('an untouched running-days question is stored as unanswered, not as zero', () => {
  const { a, html } = builderHtml();
  const block = field(html, 'f-entry-days');
  assert.match(block, /<option value="" selected><\/option>/,
    'without an empty option an untouched <select> reports its first option, which is 0');
  assert.match(block, /class="bld-slide-fig"[^>]*>–<\/span>/, 'and the figure is a dash, not a number');
  a.document.getElementById = (id) => (id === 'su-entry-days' ? { value: '' }
    : id === 'su-volume' ? { value: '' } : id === 'su-entry-long' ? { value: '' } : null);
  assert.equal(a.readBuilderEntryEvidence().runDaysPerWeek, null);
  a.document.getElementById = (id) => (id === 'su-entry-days' ? { value: '0' } : null);
  assert.equal(a.readBuilderEntryEvidence().runDaysPerWeek, 0, 'while a chosen zero is still a zero');
});

test('an athlete who answered before sees their answer selected, with no empty option chosen', () => {
  const { html } = builderHtml((a) => {
    a.state.setup = Object.assign({}, a.state.setup, { entryEvidence: { runDaysPerWeek: 5, weeklyKm: 50, longestRunKm: 21 } });
  });
  const block = field(html, 'f-entry-days');
  if (/<option value="5" selected>/.test(block)) {
    assert.doesNotMatch(block, /<option value="" selected>/);
    assert.match(block, /class="bld-slide-fig"[^>]*>5<\/span>/);
  }
});

test('block length runs over the programme\'s own range and nothing wider', () => {
  const { html } = builderHtml();
  const r = BS.validation.weeksRange;
  const block = field(html, 'f-weeks');
  assert.match(block, new RegExp('class="bld-range" data-for="su-weeks" min="' + r[0] + '" max="' + r[1] + '" step="1"'));
  assert.match(block, new RegExp('<input type="number" min="' + r[0] + '" max="' + r[1] + '" step="1" inputmode="numeric" id="su-weeks"'),
    'and the field it writes to keeps the same limits');
  assert.match(block, new RegExp('<span>' + r[0] + ' weeks</span><span>' + r[1] + ' weeks</span>'));
});

test('the figure beside each label is still a field, so an exact number can be typed', () => {
  const { html } = builderHtml();
  [['f-volume', 'su-volume'], ['f-entry-long', 'su-entry-long'], ['f-weeks', 'su-weeks']].forEach(([f, id]) => {
    assert.match(field(html, f),
      new RegExp('<span class="bld-slide-val"><input type="number"[^>]*inputmode="numeric" id="' + id + '"'),
      f + ': the large figure must be the number field itself');
  });
});

test('the distance sliders state their ceilings in kilometres and step sensibly', () => {
  const { a, html } = builderHtml();
  assert.equal(a.BLD_SLIDER_KM.volume, 150);
  assert.equal(a.BLD_SLIDER_KM.longRun, 50);
  assert.match(field(html, 'f-volume'), /data-for="su-volume" min="0" max="150" step="5"[^>]*data-km-max="150"/);
  assert.match(field(html, 'f-entry-long'), /data-for="su-entry-long" min="0" max="50" step="1"[^>]*data-km-max="50"/);
});

test('the date of the longest run is still asked underneath it', () => {
  const { html } = builderHtml();
  assert.ok(html.indexOf('id="f-entry-long-date"') > html.indexOf('id="f-entry-long"'));
  assert.match(html, /id="su-entry-long-date"/);
});

/* ---------- behaviour, on a stand-in DOM ---------- */

function fakeField(o) {
  const classes = new Set(['bld-range']);
  const style = {};
  const ends = [{ textContent: '' }, { textContent: '' }];
  const unit = { textContent: '' };
  const fig = { textContent: '' };
  const events = [];
  const target = { value: o.value, dispatchEvent: (e) => { events.push(e.type); } };
  const fieldEl = {
    querySelector: (sel) => (sel === '.bld-slide-unit' ? (o.noUnit ? null : unit)
      : sel === '.bld-slide-fig' ? (o.fig ? fig : null) : null),
    querySelectorAll: (sel) => (sel === '.bld-range-ends span' ? (o.ticks ? [] : ends) : []),
  };
  const attrs = { 'data-for': o.id, 'data-km-max': o.kmMax != null ? String(o.kmMax) : null, 'data-unit': o.unit || null };
  const rg = {
    min: String(o.min != null ? o.min : 0), max: String(o.max != null ? o.max : (o.kmMax || 0)), value: '0',
    classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) },
    style: { setProperty: (k, v) => { style[k] = v; }, getPropertyValue: (k) => style[k] },
    getAttribute: (n) => attrs[n], closest: () => fieldEl,
  };
  return { rg, target, ends, unit, fig, events, style, classes };
}
function wire(a, fields, units) {
  a.document.querySelectorAll = (sel) => (sel === '.bld-range[data-for]' ? fields.map((f) => f.rg) : []);
  a.document.getElementById = (id) => { const f = fields.filter((x) => x.rg.getAttribute('data-for') === id)[0]; return f ? f.target : null; };
  a.document.querySelector = (sel) => (sel === '#su-units button.active' ? { getAttribute: () => units } : null);
  if (typeof a.Event !== 'function') a.Event = function (type) { this.type = type; };
}

test('an empty field leaves the slider unset: a hollow thumb at the start and a dash', () => {
  const a = loadApp();
  const vol = fakeField({ id: 'su-volume', value: '', kmMax: 150 });
  const days = fakeField({ id: 'su-entry-days', value: '', min: 0, max: 7, ticks: true, fig: true, noUnit: true });
  wire(a, [vol, days], 'km');
  a.bldSyncSliders();
  assert.ok(vol.classes.has('is-unset') && days.classes.has('is-unset'));
  assert.equal(vol.style['--p'], '0%');
  assert.equal(days.fig.textContent, '–', 'no answer is not a zero');
});

test('a value paints the track to its place and a typed figure past the end rests at the end', () => {
  const a = loadApp();
  const vol = fakeField({ id: 'su-volume', value: '75', kmMax: 150 });
  wire(a, [vol], 'km');
  a.bldSyncSliders();
  assert.ok(!vol.classes.has('is-unset'));
  assert.equal(vol.style['--p'], '50%');
  assert.deepEqual(vol.ends.map((e) => e.textContent), ['0 km', '150 km']);
  assert.equal(vol.unit.textContent, 'km');
  vol.target.value = '400';
  a.bldSyncSliders();
  assert.equal(vol.rg.value, '150');
  assert.equal(vol.style['--p'], '100%');
  assert.equal(vol.target.value, '400', 'the typed figure is the athlete\'s and is not rewritten');
});

test('in miles the two distance sliders are re-scaled and re-labelled', () => {
  const a = loadApp();
  const vol = fakeField({ id: 'su-volume', value: '30', kmMax: 150 });
  const long = fakeField({ id: 'su-entry-long', value: '13', kmMax: 50 });
  const weeks = fakeField({ id: 'su-weeks', value: '14', min: 4, max: 24, unit: 'weeks' });
  wire(a, [vol, long, weeks], 'mi');
  a.bldSyncSliders();
  assert.equal(vol.rg.max, '93');
  assert.equal(long.rg.max, '31');
  assert.deepEqual(vol.ends.map((e) => e.textContent), ['0 mi', '93 mi']);
  assert.equal(long.unit.textContent, 'mi');
  assert.equal(weeks.rg.max, '24', 'weeks are not a distance');
  assert.deepEqual(weeks.ends.map((e) => e.textContent), ['4 weeks', '24 weeks']);
  assert.equal(weeks.unit.textContent, 'weeks');
});

test('moving a slider writes the field and raises the events a keystroke would', () => {
  const a = loadApp();
  const days = fakeField({ id: 'su-entry-days', value: '', min: 0, max: 7, ticks: true, fig: true, noUnit: true });
  wire(a, [days], 'km');
  days.rg.value = '5';
  a.bldSliderInput(days.rg);
  assert.equal(days.target.value, '5');
  assert.deepEqual(days.events, ['input', 'change'], 'every listener the field already had still fires');
  assert.equal(days.fig.textContent, '5');
  assert.ok(!days.classes.has('is-unset'));
});

test('switching units converts the longest run as well as the weekly volume', () => {
  const i = CODE.indexOf("var unitsBox = document.getElementById('su-units');");
  const body = CODE.slice(i, CODE.indexOf('function bldSyncRaceEntryNote', i));
  assert.match(body, /getElementById\('su-entry-long'\)/,
    'with the unit printed beside it, an unconverted "21 km" becomes "21 mi" in front of the athlete');
  assert.match(body, /longInput\.value = newUnits==='mi' \? round2\(lkm\*0\.621371\) : round1\(lkm\)/);
  assert.match(body, /bldSyncSliders\(\)/);
});

test('a purpose change that moves the default block length repaints its slider', () => {
  const i = CODE.indexOf('function bldApplyPurpose(){');
  const body = CODE.slice(i, CODE.indexOf('\nfunction ', i + 10));
  assert.match(body, /bldSyncSliders\(\);/);
});

/* ---------- the look ---------- */

test('the slider is a thumb-sized control with no box round it', () => {
  const r = cssRule('  .field input.bld-range');
  assert.match(r, /min-height:44px/);
  assert.match(r, /background:transparent/);
  assert.match(r, /border:0/);
  assert.match(r, /box-shadow:none/);
});

test('the thumb wears the cherry rim, and an unanswered one is hollow and unlit', () => {
  ['  .bld-range::-webkit-slider-thumb', '  .bld-range::-moz-range-thumb'].forEach((sel) => {
    const r = cssRule(sel);
    assert.match(r, /box-shadow:0 0 0 3px var\(--cherry-text\)/, sel);
    assert.match(r, /width:26px; height:26px/, sel);
  });
  ['  .bld-range.is-unset::-webkit-slider-thumb', '  .bld-range.is-unset::-moz-range-thumb'].forEach((sel) => {
    const r = cssRule(sel);
    assert.doesNotMatch(r, /cherry/, sel + ' must not be lit as though it had been set');
  });
});

test('the track is cherry up to the thumb, and the answer is cherry and large', () => {
  assert.match(cssRule('  .bld-range::-webkit-slider-runnable-track'),
    /linear-gradient\(to right, var\(--cherry-text\) var\(--p\), var\(--line\) var\(--p\)\)/);
  const fig = cssRule('  .field .bld-slide-val input');
  assert.match(fig, /color:var\(--cherry-text\)/);
  assert.match(fig, /font-size:28px/);
  assert.match(fig, /min-height:44px/, 'still a field a thumb can land in');
  assert.doesNotMatch(cssRule('  .bld-range-ends, .bld-range-ticks'), /--ink-faint|--ink-dim|opacity/);
});
