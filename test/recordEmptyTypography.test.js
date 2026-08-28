'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE EMPTY PLATE BELONGS TO THE VALUE SYSTEM
 * ===========================================================================
 * The Record's plates on the Valhalla tab are value-over-label:
 *
 *     Nothing measured   |   10K · 23:00        10%
 *     MEASURED FITNESS   |   BENCHMARK       PROGRESS
 *
 * All three are plate VALUES and are set as one: .b-plate .val's JetBrains
 * Mono at weight 600, sentence case, centred, with no letter-spacing or line
 * height of their own. The empty plate declares exactly two departures and
 * inherits the rest --
 *
 *   COLOUR   --ink-faint, because an absence is not a warning. A separate
 *            rule from typography, and older than this pass.
 *   SIZE     13px, because "Nothing measured" is 16 characters in a
 *            half-width plate. Measured across production widths: it needs a
 *            one-line width of 154px at the system's 16px, against 146px of
 *            plate content at 390 and 131px at 360. So at 16px it wraps on
 *            every phone narrower than 412; at 13px it holds one line from
 *            360 up, which is every current Android and iPhone width bar the
 *            320px floor, where nothing consistent fits.
 *
 * These tests pin both directions. Taking the accommodation away makes it wrap
 * on every real phone; letting the face, weight or casing drift takes it out
 * of the value system, which is the whole point.
 *
 * HISTORY, so the next reader does not think this drifted by accident: this
 * plate briefly used Inter at 15px, on the reasoning that an absence is a
 * sentence rather than a measurement. Reviewed against the two plates beside
 * it, that was reversed -- the tile is a value tile, and a value that opts out
 * of the value face reads as a different KIND of thing rather than as an empty
 * one. The Record TAB's empty state (.rec-empty-state) is still the interface
 * face and correctly so: there it is a secondary note after its label, not a
 * plate value. The two surfaces are allowed to differ for that reason.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

/* The declarations that actually apply to a selector, in source order, with
   comments removed first -- this file's own prose quotes the strings it
   forbids, and matching prose as if it were code has produced false passes in
   this suite before. */
function rulesFor(selector){
  const css = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))){
    const sels = m[1].split(',').map(s => s.trim());
    if (sels.indexOf(selector) !== -1) out.push(m[2].replace(/\s+/g, ' ').trim());
  }
  return out;
}
/* The winning value for a property across every rule with this exact
   selector. Enough for these two selectors, which no other rule of equal
   specificity touches. */
function declared(selector, prop){
  let val = null;
  rulesFor(selector).forEach(body => {
    body.split(';').forEach(d => {
      const i = d.indexOf(':');
      if (i === -1) return;
      if (d.slice(0, i).trim() === prop) val = d.slice(i + 1).trim();
    });
  });
  return val;
}

/* THE EFFECTIVE STYLE, NOT MERELY A RULE THAT EXISTS.
   ---------------------------------------------------------------------------
   This is the lesson of the defect these tests failed to catch. The previous
   version asserted that `.b-plate .val.rec-none` declared no font-family --
   which was true, and which was exactly the bug: with nothing declared, the
   family came from `.b-plate .val` and the empty state rendered in the data
   face. A rule that exists is not a rule that wins, and only the winner is
   what an athlete sees.

   So this resolves the cascade the way a browser does: every rule whose
   selector matches the element is collected, ordered by specificity and then
   by source order, and the last declaration of the property wins. Not a full
   CSS engine -- it handles the class-and-descendant selectors this stylesheet
   uses for these elements, which is what is being asserted. */
function effectiveStyle(classes, prop, ancestors){
  const own = classes.slice().sort().join('.');
  const anc = (ancestors || []).slice();
  const css = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = /([^{}]+)\{([^{}]*)\}/g;
  const wins = [];
  let m, order = 0;
  while ((m = re.exec(css))){
    const body = m[2];
    m[1].split(',').forEach(sel => {
      order++;
      const parts = sel.trim().split(/\s+/);
      if (!parts.length) return;
      /* The final compound must be a subset of this element's classes. */
      const last = parts[parts.length - 1];
      if (!/^\.[\w-]+(\.[\w-]+)*$/.test(last)) return;
      const need = last.slice(1).split('.');
      if (!need.every(c => classes.indexOf(c) !== -1)) return;
      /* Every earlier part must name an ancestor we have. */
      const rest = parts.slice(0, -1);
      if (!rest.every(pt => /^\.[\w-]+$/.test(pt) && anc.indexOf(pt.slice(1)) !== -1)) return;
      /* Specificity: class count across the whole selector. */
      const spec = (sel.match(/\.[\w-]+/g) || []).length;
      body.split(';').forEach(d => {
        const i = d.indexOf(':');
        if (i === -1) return;
        if (d.slice(0, i).trim() !== prop) return;
        wins.push({ spec, order, value: d.slice(i + 1).trim() });
      });
    });
  }
  if (!wins.length) return null;
  wins.sort((a, b) => (a.spec - b.spec) || (a.order - b.order));
  return wins[wins.length - 1].value;
}
/* The three values as the app actually emits them -- see recordPlate(). */
const EMPTY_VALUE    = { classes:['val','rec-none'], ancestors:['b-plate','b-record'] };
const MEASURED_VALUE = { classes:['val'],            ancestors:['b-plate','b-record'] };

function athleteWithNoMeasurement(){
  const a = loadApp({ pinnedDate: '2026-08-27T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { distanceKey: '5k', volume: 40, weeks: 12,
    startDate: a.addDays(a.todayStr(), -21), benchSec: a.clockToSec('0:23:00') });
  a.state.athlete = { sessions: [], baselines: {}, performances: [], blocks: [] };
  return a;
}

// ---------------------------------------------------------------------------
// 1. THE FACE
// ---------------------------------------------------------------------------

test('the empty value renders in the interface face, and the measured ones do not', () => {
  /* ASSERTED ON THE EFFECTIVE STYLE. The previous version of this test checked
     that the empty value DECLARED no font-family, on the reasoning that full
     inheritance was the cleanest expression of "same value role". It passed
     while the athlete saw "Nothing measured" in JetBrains Mono, identical to
     the measurement beside it, because inheriting from .b-plate .val is
     precisely how it got the data face. Physical Android verification is what
     caught it. A rule that exists is not a rule that wins. */
  const empty = effectiveStyle(EMPTY_VALUE.classes, 'font-family', EMPTY_VALUE.ancestors);
  const measured = effectiveStyle(MEASURED_VALUE.classes, 'font-family', MEASURED_VALUE.ancestors);
  assert.ok(empty, 'no font-family resolves for the empty value at all');
  assert.match(empty, /^'Inter'/,
    '"Nothing measured" effectively renders in ' + empty + ', not the interface face');
  assert.ok(!/JetBrains Mono/.test(empty),
    '"Nothing measured" still resolves to the monospace data face');
  assert.match(measured, /JetBrains Mono/,
    'the measured values left the data face: ' + measured);
  /* The distinction is the point: they must not resolve to the same face. */
  assert.notEqual(empty, measured,
    'the empty value and the measurements resolve to the same typeface');
});

test('nothing but the face differs between the empty and measured values', () => {
  /* The correction is deliberately one property. Size, weight, letter spacing,
     line height, casing and alignment still come from the value slot, so no
     card dimension, spacing or alignment moves. */
  ['font-size', 'font-weight', 'letter-spacing', 'line-height', 'text-transform',
   'text-align'].forEach(prop => {
    const e = effectiveStyle(EMPTY_VALUE.classes, prop, EMPTY_VALUE.ancestors);
    const m = effectiveStyle(MEASURED_VALUE.classes, prop, MEASURED_VALUE.ancestors);
    assert.equal(e, m,
      prop + ' differs between the empty and measured values (' + e + ' vs ' + m + ') -- ' +
      'only the typeface was meant to change');
  });
  /* Colour is the one older difference, and it stays. */
  assert.match(effectiveStyle(EMPTY_VALUE.classes, 'color', EMPTY_VALUE.ancestors) || '',
    /--ink-faint/, 'the empty value lost its quieting');
});

test('both empty values in this slot are treated identically', () => {
  /* "Nothing measured" and "Not set" are the same thing -- a plate value that
     is unavailable -- and there is exactly one rule for both. A rule that
     distinguished them by length would be styling a string, not a role. */
  const a = athleteWithNoMeasurement();
  a.state.setup.benchmark = null;
  const facts = a.recordFacts();
  const empties = facts.filter(f => f.none);
  assert.equal(empties.map(f => f.value).sort().join('|'), 'Not set|Nothing measured',
    'this slot no longer has two empty values, so this test needs revisiting');
  empties.forEach(f => {
    assert.match(a.recordPlate(f), /<div class="val rec-none">/,
      f.subject + ' does not use the shared empty-value class');
  });
  /* And exactly one rule governs them. */
  assert.equal(rulesFor('.b-plate .val.rec-none').length, 1,
    'the empty value is governed by more than one rule -- they will drift');
});

test('the measured plates are untouched', () => {
  /* Benchmark and Progress are explicitly out of scope: the size accommodation
     is the empty value\'s alone, and a rule that reached .b-plate .val would
     shrink real measurements to fit a phrase that is not theirs. */
  assert.equal(declared('.b-plate .val', 'font-size'), '16px',
    'the measured plates changed size');
  assert.equal(declared('.b-plate .val', 'font-weight'), '600',
    'the measured plates changed weight');
  assert.match(declared('.b-plate .val', 'font-family'), /JetBrains Mono/,
    'the measured plates left the data face');
});

// ---------------------------------------------------------------------------
// 2. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------

test('the plate geometry is untouched', () => {
  /* Dimensions, spacing, position and responsive behaviour are all in these
     two rules, and this pass changed neither. */
  const plate = rulesFor('.b-plate').join(' ');
  assert.match(plate, /padding:15px 14px 13px/, 'the plate padding changed');
  assert.match(plate, /text-align:center/, 'the plate alignment changed');
  assert.match(plate, /border-radius:var\(--tile-radius\)/, 'the plate radius changed');
  const grid = rulesFor('.b-record').join(' ');
  assert.match(grid, /grid-template-columns:1fr 1fr/, 'the Record grid changed');
  assert.match(grid, /gap:10px/, 'the Record grid spacing changed');
  assert.match(SRC, /\.b-record \.b-plate:nth-child\(3\):last-child\{grid-column:1 \/ -1/,
    'the third plate no longer centres beneath the pair');
});

test('the words and the label are exactly what they were', () => {
  const a = athleteWithNoMeasurement();
  const f = a.recordFitnessFact();
  assert.equal(f.value, 'Nothing measured', 'the wording changed');
  assert.equal(f.subject, 'Measured fitness', 'the label changed');
  assert.equal(f.none, true, 'the fact no longer reports itself as an absence');
  const html = a.recordPlate(f);
  assert.match(html, /<div class="b-plate"><div class="val rec-none">Nothing measured<\/div>/,
    'the plate markup changed');
  assert.match(html, /<div class="lbl">Measured fitness<\/div><\/div>$/,
    'the plate label markup changed');
});

test('the measured plates are built exactly as before', () => {
  const a = athleteWithNoMeasurement();
  const facts = a.recordFacts();
  assert.equal(facts.length, 3, 'The Record is no longer three facts');
  assert.equal(facts.map(f => f.subject).join('/'), 'Measured fitness/Benchmark/Progress',
    'the plates changed, or changed order');
  /* Exactly one absence in this state, and it carries the class. Benchmark
     and Progress must render with no rec-none at all. */
  const html = facts.map(a.recordPlate).join('');
  assert.equal(html.split('rec-none').length - 1, 1,
    'more or fewer than one plate is marked as an absence');
  assert.match(a.recordPlate(facts[1]), /<div class="val">10K · 23:00<\/div>/,
    'the Benchmark plate changed');
  assert.match(a.recordPlate(facts[2]), /<div class="val">\d+%<\/div>/,
    'the Progress plate changed');
});

test('a measured athlete gets no empty treatment at all', () => {
  const a = athleteWithNoMeasurement();
  a.state.athlete.performances = [{ date: a.addDays(a.todayStr(), -14), source: 'race',
    km: 5, timeSec: a.clockToSec('0:22:30'), vdot: 50, blockId: null, qualified: true }];
  const f = a.recordFitnessFact();
  assert.ok(!f.none, 'a measured athlete still reports an absence');
  assert.ok(!/rec-none/.test(a.recordPlate(f)),
    'a measured value is rendered with the empty-state typography');
  assert.match(f.value, /22:30/, 'the measured fitness value lost its time');
  assert.equal(a.recordPlate(f),
    '<div class="b-plate"><div class="val">' + f.value + '</div>' +
    '<div class="lbl">Measured fitness</div></div>',
    'the measured plate markup changed');
});

// ---------------------------------------------------------------------------
// 3. THE OTHER SURFACE, DELIBERATELY UNCHANGED
// ---------------------------------------------------------------------------

test('the Record tab\'s own empty state is not touched by this', () => {
  /* The tab card solved the same problem differently and earlier -- label
     first, state second, no headline slot -- and that is still correct there.
     This pass reached the plate only. */
  const a = athleteWithNoMeasurement();
  const card = a.recordCard(a.recordFitnessFact());
  assert.match(card, /class="ev-card ev-card-empty"/, 'the Record tab empty card changed shape');
  assert.match(card, /class="rec-empty-subject">Measured fitness</, 'the tab card label changed');
  assert.match(card, /class="rec-empty-state">Not established yet</, 'the tab card state changed');
  assert.ok(!/rec-headline/.test(card), 'the tab card grew a headline slot back');
  const es = rulesFor('.rec-empty-state').join(' ');
  assert.match(es, /font-size:12px/, '.rec-empty-state changed size');
  assert.match(es, /font-style:italic/, '.rec-empty-state lost its italic');
});

// ---------------------------------------------------------------------------
// 4. THE SELECTOR THAT MATCHED NOTHING
// ---------------------------------------------------------------------------

test('the quieting rule reaches the plate and nothing else', () => {
  /* `.rec-headline b.rec-none` led this selector from when the Record tab\'s
     empty state was a dimmed headline. recordCard() has since returned the
     ev-card-empty branch for every absence -- label first, no headline slot --
     so that half matched nothing at all.
     This test is not really about the deletion. It is about the REASON: if the
     headline branch ever comes back for an absence, the selector must come
     back with it rather than the words silently rendering unquieted. */
  const css = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.rec-headline\s+b\.rec-none/.test(css),
    'the dead .rec-headline b.rec-none selector is back');
  assert.match(declared('.b-plate .val.rec-none', 'color') || '', /--ink-faint/,
    'removing the dead half took the plate quieting with it');

  /* The reason, asserted rather than trusted: no absence renders a headline. */
  const a = athleteWithNoMeasurement();
  const facts = a.recordFacts().filter(f => f.none);
  assert.ok(facts.length > 0, 'the fixture has no absence, so this proves nothing');
  facts.forEach(f => {
    assert.ok(!/rec-headline/.test(a.recordCard(f)),
      f.subject + ': an absence renders a headline again, and it is no longer quieted');
  });
});

test('every rec-none the app can emit is styled', () => {
  /* The other direction. There is exactly one place the class is produced --
     the plate -- and one rule set that catches it. A second producer added
     without a matching rule would render a bare, unquieted absence in the
     data face, which is the defect this whole pass removed. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const emitted = code.split("' rec-none'").length - 1;
  assert.equal(emitted, 1,
    'rec-none is emitted from ' + emitted + ' places; each needs a rule, and ' +
    'only the plate has one');
  /* And that one producer is the plate. */
  assert.match(code, /class="b-plate"><div class="val'\+\(f\.none\?' rec-none':''\)/,
    'the one rec-none producer is no longer the Record plate');
});
