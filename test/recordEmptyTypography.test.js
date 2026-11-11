'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* AN EMPTY VALUE BELONGS TO THE VALUE SYSTEM
 * ===========================================================================
 * The Athlete Status on Sacoro is four circles, each a label over a value:
 *
 *        GOAL      |   FITNESS   |  BENCHMARK  |  PROGRESS
 *          B       |      —      |     10K     |    63%
 *       3:29:45    |             |    45:33    |
 *
 * All four values are set as one: .rd-val b's JetBrains Mono at weight 700,
 * centred, in --ink. An unavailable value declares exactly one departure and
 * inherits every other property --
 *
 *   COLOUR   --ink-faint, because an absence is not a warning.
 *   FAMILY   the words face (--text-face), because it is language rather
 *            than data -- the product has exactly two faces now, and this
 *            takes the one that is not for figures. This is the
 *            whole distinction and therefore the whole rule: a version that
 *            set colour alone was verified on a physical Android device
 *            still rendering in JetBrains Mono, identical to the measurement
 *            beside it, because the family inherited from the value slot.
 *            A rule that exists is not a rule that wins.
 *
 * These tests pin both directions. Letting the quieting reach the slot itself
 * restyles real measurements; letting the face, weight or casing drift takes
 * the absence out of the value system, which is the whole point.
 *
 * WHERE THE WORDS WENT. "Nothing measured" is sixteen characters and holds no
 * line in a 90px circular face at any size that is still a value, so the
 * circle shows an em dash and the panel it opens states the phrase in full --
 * and the aria-label carries it either way, because a screen reader is
 * reading a label rather than looking at a slot.
 *
 * HISTORY, so the next reader does not think this drifted by accident. The
 * slot has been three different things: a dimmed headline on the Record tab,
 * then the chamfered Sacoro plate, now the circle. The quieting selector
 * followed each move and the dead half was removed each time. The LAW -- an
 * absence is the value role, unavailable, and never a value of its own -- has
 * not changed once.
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
/* ELEMENT COMPOUNDS, because the slot this law now protects is `.rd-val b`
   rather than `.b-plate .val`. A compound may be `.a`, `tag`, or `tag.a`;
   specificity keeps classes ahead of elements the way CSS does, by weighting
   a class ten times an element -- enough for the handful of rules here, and
   honest about which half of a tie it is breaking. */
function compoundMatches(part, tag, classes){
  const m = /^([a-z]+)?((?:\.[\w-]+)*)$/.exec(part);
  if (!m || (!m[1] && !m[2])) return null;
  if (m[1] && m[1] !== tag) return null;
  const need = m[2] ? m[2].slice(1).split('.') : [];
  if (!need.every(c => classes.indexOf(c) !== -1)) return null;
  return { cls: need.length, el: m[1] ? 1 : 0 };
}
function effectiveStyle(classes, prop, ancestors, tag){
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
      /* The final compound must match this element. */
      const hit = compoundMatches(parts[parts.length - 1], tag, classes);
      if (!hit) return;
      /* Every earlier part must name an ancestor we have. */
      const rest = parts.slice(0, -1);
      if (!rest.every(pt => /^\.[\w-]+$/.test(pt) && anc.indexOf(pt.slice(1)) !== -1)) return;
      const spec = (sel.match(/\.[\w-]+/g) || []).length * 10 +
                   (sel.match(/(^|[\s>])[a-z]+/g) || []).length;
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
/* The values as the app actually emits them -- see statusDialHtml(). The
   chamfered plate this file was written against is gone; the slot it
   protected moved to the Athlete Status circle, and so did the law. */
const SLOT_ANCESTORS = ['rd-val', 'b-medal', 'b-dial', 'b-stat', 'b-status'];
const EMPTY_VALUE    = { tag:'b', classes:['rec-none'], ancestors:SLOT_ANCESTORS };
const MEASURED_VALUE = { tag:'b', classes:[],           ancestors:SLOT_ANCESTORS };
/* RESOLVED, NOT AS DECLARED. effectiveStyle() returns the winning
   declaration, which since the product moved to two type tokens is
   "var(--text-face)" rather than a family name -- and a test comparing
   token SPELLINGS would pass while both tokens pointed at the same face.
   The tokens are read from :root and substituted, so these assertions stay
   about the typeface an athlete actually sees. */
const TOKENS = (() => {
  const out = {};
  const root = SRC.slice(SRC.indexOf(':root{'));
  [...root.matchAll(/--((?:text|num|label)-face)\s*:\s*([^;]+);/g)]
    .forEach(m => { out['var(--' + m[1] + ')'] = m[2].trim(); });
  return out;
})();
const resolveFace = v => {
  let seen = 0;
  while (v && TOKENS[v.trim()] && seen++ < 5) v = TOKENS[v.trim()];
  return (v || '').replace(/^['"]|['"]$/g, '').replace(/['"]/g, '');
};
const styleOf = (v, prop) => {
  const raw = effectiveStyle(v.classes, prop, v.ancestors, v.tag);
  return prop === 'font-family' ? resolveFace(raw) : raw;
};

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
  const empty = styleOf(EMPTY_VALUE, 'font-family');
  const measured = styleOf(MEASURED_VALUE, 'font-family');
  assert.ok(empty, 'no font-family resolves for the empty value at all');
  /* The interface face is Oswald now: the product declares exactly two
     faces, one for words and one for standalone figures, so "the interface
     face" and "the words face" are the same thing. What this test is about
     is unchanged and in fact sharpened -- an absence is LANGUAGE and takes
     the words face; a measurement is a figure and takes the figure face. */
  assert.match(empty, /^Oswald/,
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
    const e = styleOf(EMPTY_VALUE, prop);
    const m = styleOf(MEASURED_VALUE, prop);
    assert.equal(e, m,
      prop + ' differs between the empty and measured values (' + e + ' vs ' + m + ') -- ' +
      'only the typeface was meant to change');
  });
  /* Colour is the one older difference, and it stays. */
  assert.match(styleOf(EMPTY_VALUE, 'color') || '',
    /--ink-faint/, 'the empty value lost its quieting');
});

test('both empty values in this slot are treated identically', () => {
  /* "Nothing measured" and "Not set" are the same thing -- a value that is
     unavailable -- and there is exactly one rule for both. A rule that
     distinguished them by length would be styling a string, not a role. */
  const a = athleteWithNoMeasurement();
  a.state.setup.benchmark = null;
  const empties = a.recordFacts().filter(f => f.none);
  assert.equal(empties.map(f => f.value).sort().join('|'), 'Not set|Nothing measured',
    'this slot no longer has two empty values, so this test needs revisiting');
  empties.forEach(f => {
    assert.match(a.statusDialHtml(f), /<b class="rec-none"/,
      f.subject + ' does not use the shared empty-value class');
  });
  /* And exactly one rule governs them. */
  assert.equal(rulesFor('.rd-val b.rec-none').length, 1,
    'the empty value is governed by more than one rule -- they will drift');
});

test('the measured values are untouched', () => {
  /* The quieting is the empty value's alone. A rule that reached the slot
     itself would restyle real measurements to suit a phrase that is not
     theirs -- which is the defect in the opposite direction. */
  assert.match(resolveFace(declared('.rd-val b', 'font-family')), /JetBrains Mono/,
    'the measured values left the data face');
  assert.equal(declared('.rd-val b', 'font-weight'), '700',
    'the measured values changed weight');
  assert.equal(declared('.rd-val b', 'color'), 'var(--ink)',
    'the measured values left the neutral ink');
});

// ---------------------------------------------------------------------------
// 2. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------

test('the circle geometry is untouched by the quieting', () => {
  /* Dimensions, spacing and the circular clip are the dial's, not the empty
     state's, and the quieting rule declares none of them. */
  const quiet = rulesFor('.rd-val b.rec-none').join(' ');
  ['font-size', 'width', 'height', 'padding', 'margin', 'line-height', 'max-width']
    .forEach(prop => {
      assert.ok(quiet.indexOf(prop + ':') === -1,
        'the quieting rule declares ' + prop + ', so an absence changes the circle\'s shape');
    });
  const stat = rulesFor('.b-dial[data-rank="s"]').join(' ');
  assert.match(stat, /width:90px/, 'the Athlete Status diameter changed');
  const row = rulesFor('.b-status').join(' ');
  assert.match(row, /justify-content:space-between/, 'the Athlete Status row spacing changed');
});

test('the words and the label are exactly what they were', () => {
  const a = athleteWithNoMeasurement();
  const f = a.recordFitnessFact();
  assert.equal(f.value, 'Nothing measured', 'the wording changed');
  assert.equal(f.subject, 'Measured fitness', 'the label changed');
  assert.equal(f.none, true, 'the fact no longer reports itself as an absence');
  const html = a.statusDialHtml(f);
  /* THE VALUE SLOT CARRIES NO WORDS NOW, and that is the circle's answer to
     the same problem. "Nothing measured" is sixteen characters and would not
     hold one line in a 90px face at any size that is still a value; the
     circle shows an em dash and the panel behind it says the phrase in full.
     The words are still announced to a screen reader, which is reading a
     label rather than looking at a slot. */
  assert.match(html, /<b class="rec-none"[^>]*>\u2014<\/b>/, 'the empty value slot changed');
  assert.match(html, /aria-label="Measured fitness \u2014 Nothing measured"/,
    'the absence is no longer announced');
  assert.match(html, /<span class="rd-cat">Fitness<\/span>/, 'the circle label changed');
  /* And the phrase itself survives, in the panel the circle opens. */
  assert.match(a.recordPanelFitness(), /Not established yet\. A race or a Fitness Checkpoint/,
    'the absence lost the words that explain it');
});

test('the measured facts are built exactly as before', () => {
  const a = athleteWithNoMeasurement();
  const facts = a.recordFacts();
  assert.equal(facts.length, 4, 'The Record is no longer four facts');
  assert.equal(facts.map(f => f.subject).join('/'), 'Goal/Measured fitness/Benchmark/Progress',
    'the facts changed, or changed order');
  /* Exactly one absence in this state, and it carries the class. The other
     three must render with no rec-none at all. */
  const html = facts.map(f => a.statusDialHtml(f)).join('');
  assert.equal(html.split('rec-none').length - 1, 1,
    'more or fewer than one fact is marked as an absence');
  /* THE TIME IS THE VALUE AND THE DISTANCE IS WHAT IT IS OF -- which is the
     way round the other circles already read, and the way round it should
     always have been here. A benchmark IS a time; "10K" is the qualifier
     that makes the time mean something, and it belongs in the sub face with
     the other counted nouns. Reading "10K" as the headline made the athlete
     resolve a label before reaching the fact. Both halves are still here and
     still on the two faces, so the circle's typography is unchanged: only
     which fact sits in which face has swapped. */
  assert.match(a.statusDialHtml(facts[2]), /<b style="[^"]*">23:00<\/b>/,
    'the Benchmark circle no longer leads with the time');
  /* AND THE DISTANCE HAS NOW LEFT THE FACE ENTIRELY. It was the qualifier
     under the time; the panel behind the circle states "10K - 45:33" in
     full on its first line, so the face holds the figure and nothing else,
     as Progress and Readiness do. `value` still carries both, which is what
     the aria-label and the panel read. */
  assert.doesNotMatch(a.statusDialHtml(facts[2]), /rd-sub-data">10K</,
    'the distance is back under the Benchmark time');
  assert.match(facts[2].value, /10K/, 'the distance left the fact altogether');
  assert.match(a.statusDialHtml(facts[3]), /<b style="[^"]*">\d+%<\/b>/,
    'the Progress circle changed');
});

test('a measured athlete gets no empty treatment at all', () => {
  const a = athleteWithNoMeasurement();
  a.state.athlete.performances = [{ date: a.addDays(a.todayStr(), -14), source: 'race',
    km: 5, timeSec: a.clockToSec('0:22:30'), vdot: 50, blockId: null, qualified: true }];
  const f = a.recordFitnessFact();
  assert.ok(!f.none, 'a measured athlete still reports an absence');
  assert.ok(!/rec-none/.test(a.statusDialHtml(f)),
    'a measured value is rendered with the empty-state typography');
  assert.match(f.value, /22:30/, 'the measured fitness value lost its time');
});

// ---------------------------------------------------------------------------
// 3. THE SELECTOR THAT MATCHED NOTHING
// ---------------------------------------------------------------------------

test('the quieting rule reaches the value slot and nothing else', () => {
  /* This selector has outlived two markups now. It began as
     `.rec-headline b.rec-none`, for a Record tab whose empty state was a
     dimmed headline; it became `.b-plate .val.rec-none` for the Sacoro
     plates; it is `.rd-val b.rec-none` for the Athlete Status circles. Each
     time the dead half was removed and the live half kept, because the law
     is about the ROLE -- a value that is unavailable -- and not about any of
     the three shapes that have held it. */
  const css = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.rec-headline\s+b\.rec-none/.test(css),
    'the dead .rec-headline b.rec-none selector is back');
  assert.ok(!/\.b-plate\s+\.val\.rec-none/.test(css),
    'the dead .b-plate .val.rec-none selector is back');
  assert.match(declared('.rd-val b.rec-none', 'color') || '', /--ink-faint/,
    'removing the dead halves took the quieting with them');
});

test('every rec-none the app can emit is styled', () => {
  /* The other direction. There is exactly one place the class is produced --
     the Athlete Status circle -- and one rule set that catches it. A second
     producer added without a matching rule would render a bare, unquieted
     absence in the data face, which is the defect this whole law removes. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const emitted = code.split('"rec-none"').length - 1;
  assert.equal(emitted, 1,
    'rec-none is emitted from ' + emitted + ' places; each needs a rule, and ' +
    'only the value slot has one');
  assert.match(code, /<b'\+\(f\.none\?' class="rec-none"':''\)/,
    'the one rec-none producer is no longer the Athlete Status circle');
});
