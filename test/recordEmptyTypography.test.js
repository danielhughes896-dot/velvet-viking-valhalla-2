'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* AN ABSENCE IS A SENTENCE, AND IS SET LIKE ONE
 * ===========================================================================
 * The Record's plates on the Valhalla tab are value-over-label:
 *
 *     Nothing measured   |   10K · 23:00        10%
 *     MEASURED FITNESS   |   BENCHMARK       PROGRESS
 *
 * The value slot is JetBrains Mono because a plate holds a measurement, and
 * monospace at that size IS the typography of data here. "Nothing measured"
 * inherited it and so read as the metric's value -- a reading of nothing,
 * rather than the absence of a reading.
 *
 * The Record TAB's own empty state already draws this line and says why in
 * its comment: "the interface face, NOT the monospace data face -- that
 * difference is what stops the words being read as a value". The plate is the
 * surface that rule had not reached.
 *
 * These tests pin BOTH directions, because both are one word wide. Deleting
 * the new rule puts the sentence back on the data face; widening its selector
 * takes the real measurements off it.
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

test('the empty plate is set in the interface face, not the data face', () => {
  const family = declared('.b-plate .val.rec-none', 'font-family');
  assert.ok(family, 'the empty plate has no typography rule of its own -- it is back on the data face');
  assert.match(family, /^'Inter'/,
    '"Nothing measured" is set in ' + family + ', not the interface face');
  assert.ok(!/JetBrains Mono/.test(family),
    '"Nothing measured" is still set in the monospace data face');
});

test('the measured plates keep the data face', () => {
  /* The whole value of the change is the CONTRAST. A rule that leaked to
     .b-plate .val would take "10K · 23:00" and "10%" off the data face too,
     and the empty plate would stop being distinguishable again -- from the
     other side. */
  const base = declared('.b-plate .val', 'font-family');
  assert.match(base, /JetBrains Mono/,
    'the plate value slot is no longer the data face: ' + base);
  assert.equal(declared('.b-plate .val', 'font-size'), '16px',
    'the measured plates changed size');
  assert.equal(declared('.b-plate .val', 'font-weight'), '600',
    'the measured plates changed weight');
});

test('the empty plate is still the plate\'s primary value, not a demoted note', () => {
  /* .rec-empty-state -- the Record TAB's empty line -- is deliberately small
     and italic because it sits AFTER its label as a secondary note. The plate
     borrows its face and not its demotion: this is still the plate's headline
     slot. */
  const size = parseFloat(declared('.b-plate .val.rec-none', 'font-size'));
  const base = parseFloat(declared('.b-plate .val', 'font-size'));
  assert.ok(size >= base - 1.5,
    'the empty value dropped to ' + size + 'px against a ' + base + 'px plate value');
  assert.ok(size >= 14, 'the empty value is no longer at primary scale');
  assert.equal(declared('.b-plate .val.rec-none', 'font-style'), null,
    'the plate borrowed the italic demotion, not just the face');
  /* Quieted, never coloured -- the rule this pass did not touch. */
  assert.match(declared('.b-plate .val.rec-none', 'color') || '', /--ink-faint/,
    'the empty plate lost its quieting, or gained a status hue');
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
  /* `.rec-headline b.rec-none` led this selector from when the Record tab's
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
    'removing the dead half took the plate\'s quieting with it');
  assert.equal(declared('.b-plate .val.rec-none', 'font-weight'), '500',
    'removing the dead half took the plate\'s weight with it');

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
