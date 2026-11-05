'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* FULL PLAN STOPS BEING BOXES INSIDE BOXES.
 * ===========================================================================
 * This was the last screen built that way: a lifted, rimmed phase card
 * holding up to six lifted, rimmed week rows. An earlier pass took the
 * SHADOW off the inner rows and left the rim and the fill, which is why it
 * still read as a container of containers -- elevation was never what made
 * it look nested. Nothing structural changed: the phases, the weeks, the
 * rows and the three-level drill-down are as they were.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test('no surface on the plan screens is drawn as a lifted card', () => {
  const i = BARE.indexOf(':is(.view-plan, .view-plan-week, .view-plan-session)\n    :is(.pw-progress, .pw-row, .zone-card, .hub-card, .race-event, .race-strategy, .week, .pp-phase)');
  assert.ok(i > -1, 'the plan de-boxing rule is gone or its selector changed');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  ['background:none', 'border:0', 'border-radius:0', 'box-shadow:none'].forEach(d => {
    assert.ok(body.indexOf(d) > -1, 'the plan de-boxing rule no longer sets ' + d);
  });
});

test('the de-boxing is stated AFTER everything that contradicts it', () => {
  /* THIS IS THE POINT OF THE RULE, not an implementation detail. Three
     separate rules re-boxed what an earlier block had already stripped --
     .pw-progress, .pw-row.is-today and the week screen's zone card -- and
     every one of them won on SOURCE ORDER rather than on specificity.
     Chasing them individually with longer and longer selectors is how a
     stylesheet becomes an argument with itself, so the plan screens say it
     once, last. Move this rule up and the boxes come back silently. */
  const deboxed = BARE.indexOf(':is(.pw-progress, .pw-row, .zone-card');
  assert.ok(deboxed > -1, 'the consolidated plan rule is gone');
  ['.pw-row{', '.pw-progress{', '.view-plan-week .zone-card{', '.view-plan > .race-event{'].forEach(sel => {
    const at = BARE.indexOf(sel);
    assert.ok(at > -1, 'rule vanished: ' + sel);
    assert.ok(at < deboxed,
      sel + ' now comes AFTER the de-boxing rule and will silently re-box the plan');
  });
});

test('the current day is lit rather than ringed', () => {
  /* .pw-row.is-today used to set border-color plus a 1px gold ring. The
     border is gone with every other border on this screen, so the signal is
     the glow alone -- which is the language the rest of the product selects
     in. */
  /* Anchored on the BRACE: an earlier rule shares this prefix (it recolours
     .pw-date and .pw-dow), and matching the prefix alone reads that rule's
     body instead of this one's. */
  const i = BARE.indexOf(':is(.view-plan, .view-plan-week, .view-plan-session) .pw-row.is-today{');
  assert.ok(i > -1, 'the today row lost its treatment entirely');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  assert.match(body, /box-shadow:0 0 \d+px color-mix\(in srgb, var\(--gold\)/,
    'the today row is no longer lit, so nothing marks it');
  assert.doesNotMatch(body, /0 0 0 1px/, 'the gold ring came back around the today row');
});

test('bare .hub-card is untouched, because Today and Valhalla use it too', () => {
  /* The de-boxing is scoped to the plan views by name. A change to bare
     .hub-card would reach Today's Next Move and the Valhalla panels, which
     is exactly what the VALHALLA CONSISTENCY PASS comment warns against. */
  const i = BARE.indexOf('.hub-card{');
  assert.ok(i > -1, '.hub-card is gone');
  const body = BARE.slice(i + '.hub-card{'.length, BARE.indexOf('}', i));
  assert.match(body, /background:var\(--surface-3\)/, 'bare .hub-card lost its own fill');
  assert.match(body, /border:1px solid var\(--line\)/, 'bare .hub-card lost its own border');
});

test('a finished week says so in colour, and the list stays clean', () => {
  /* THE WASH CAME OFF THE LIST, and that is a decision rather than a
     regression. A finished week is one row in a column of sixteen; a light
     designed for a single hero moment, repeated down that column, stops
     being an event and becomes a texture. The illumination belongs to the
     completed SESSION -- one thing, on one screen -- and to the marks and
     chips that stand alone. The row still says it is done, in the colour
     its numerals take, which is asserted in the colour-language test below. */
  assert.equal(BARE.indexOf('.view-plan .pp-body .week.is-done::before'), -1,
    'the repeating week wash is back in the list');
  /* .week clipped its children before the boxes came off it, and a glow
     that overspills by 100vw is the first thing that clipping would eat. */
  assert.match(BARE, /\.view-plan \.pp-body \.week\{overflow:visible;\}/,
    'the week row clips again, so the glow is cut to the row');
});

test('the light is for things that happen once, not for rows in a list', () => {
  /* This used to assert that the week's glow was DIMMER than the session
     banner's, because it repeats. Mixing the same recipe weaker is what made
     two finished things stop looking alike in the first place -- so the
     answer is no longer "the same light, quieter" but "not this light here".
     SESSION COMPLETE appears once on a screen and keeps it. */
  assert.ok(BARE.indexOf('.actual-done::before') > -1,
    'the one-off completion banner lost its light too');
  assert.equal(BARE.indexOf('.view-plan .pp-body .week.is-done::before'), -1,
    'a glow is back on a row that can appear sixteen times in a column');
});

test('a week is marked done from the figure it already shows', () => {
  /* Read from weekVolume() like every other number on the row rather than
     recomputed, and gated on there being training prescribed: a week with
     nothing to do is not a week that was completed. */
  assert.match(SRC, /var doneCls = \(vol\.training > 0 && weekPct >= 100\) \? ' is-done' : '';/,
    'the completed-week class is gone or no longer requires prescribed training');
  assert.match(SRC, /'<div class="week-pct font-mono">'\+weekPct\+'%<\/div>'/,
    'the percentage is computed a second time instead of reusing the one the class reads');
});

test('done, now and ahead are one colour language on the plan', () => {
  /* Green is done, gold is now, crisp white is still ahead -- and the chips
     and the week rows say it the same way, in tokens, so the state can be
     read off the colour before the words are. */
  const ruleFor = (sel) => {
    const i = BARE.indexOf(sel);
    assert.ok(i > -1, 'rule gone: ' + sel);
    return BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  };
  /* THE CHIPS SAY IT WITH LIGHT, THE ROWS SAY IT WITH COLOUR, and the
     difference is that one is pressed and the other is read. A chip's label
     colour is already spoken for -- gold means SELECTED -- so colouring the
     word by state too put two meanings on one property, and a completed
     phase that was opened contradicted itself. The word stays crisp white
     at every state, selected included, and the state is the glow. */
  assert.match(ruleFor('.pp-chip.is-ahead, .pp-chip.is-now, .pp-chip.is-done{'), /color:var\(--ink\)/,
    'the chip labels are being coloured by state again');
  /* Anchored on the line start: the combined label rule above ENDS with
     ".pp-chip.is-done{", so a bare indexOf reads that rule's body instead. */
  /* --glow-done-mark is the compact form of the same light, and it resolves
     to the --ok mix this used to spell out at the call site. */
  assert.match(ruleFor('\n  .pp-chip.is-done{'), /box-shadow:var\(--glow-done-mark\)/,
    'a completed phase chip is no longer lit green');
  assert.match(BARE, /--glow-done-mark:[^;]*var\(--ok\)/,
    'the shared mark light stopped naming the done colour');
  assert.match(ruleFor('.pp-chip.is-now{'), /box-shadow:[^;]*var\(--gold\)/,
    'the current phase chip is no longer lit gold');
  /* A bare `color:`, not the `color:` inside `border-color:` -- selection
     keeps its gold RING, it just stops recolouring the word. */
  assert.doesNotMatch(ruleFor('.pp-chip.is-open{'), /(?<!-)color:/,
    'selection recolours the word again, which is what the glow replaced');
  assert.match(ruleFor('.pp-chip.is-open{'), /border-color:var\(--gold\)/,
    'selection lost the gold ring that distinguishes it from mere state');
  /* The tick was already green while its own label was ink -- the chip said
     "done" twice in two colours. Both are the token now. */
  assert.match(ruleFor('.pp-chip.is-done .pp-chip-tick{'), /var\(--ok-text\)/,
    'the tick hand-sets its green again instead of naming the token');
  assert.doesNotMatch(BARE, /\.pp-chip\.is-done \.pp-chip-tick\{[^}]*#9BC08C/,
    'the literal green came back on the chip tick');
  const weeks = BARE.slice(BARE.indexOf('.view-plan .pp-body .week .week-num'));
  assert.match(weeks.slice(0, 1200), /\.week\.is-done \.week-num,[\s\S]{0,120}var\(--ok-text\)/,
    'a completed week row is not green');
  assert.match(weeks.slice(0, 1600), /:has\(\.week-today-flag\) \.week-phase\{color:var\(--gold-bright\);?\}/,
    'the current week row is not gold');
});

test('the current week is lit again after the de-boxing took its ring', () => {
  /* A REGRESSION THIS PASS INTRODUCED, pinned so it cannot return. The
     current week was marked by a gold rim and a 1px ring; de-boxing took the
     border those were drawn on and left nothing marking it at all. It comes
     back as illumination, which is what the rest of the product selects
     with -- not as the ring, which is the geometry that went. */
  const i = BARE.indexOf('.view-plan .pp-body .week:has(.week-today-flag){');
  assert.ok(i > -1, 'the current week has no treatment at all');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  assert.match(body, /box-shadow:0 0 \d+px color-mix\(in srgb, var\(--gold\)/,
    'the current week is no longer lit');
  assert.doesNotMatch(body, /0 0 0 1px|border/, 'the gold ring came back around the current week');
});

test('every gold glow that marks selection or state names its token', () => {
  /* color-mix was already the pattern in this property -- .ev-card:hover,
     .splits-summary:hover, .v-call and the HQ panel all used it -- while the
     older rules hand-set rgba(227,177,90). The literal is --gold with the
     name filed off, so a palette change reached most of the product and
     silently missed the rest.
     THE EXCLUSIONS ARE DELIBERATE, NOT LEFTOVERS, and each is a different
     kind of thing:
       - the two @keyframes values, and .wk-bar-fill's resting shadow, are
         tied together by test/instrumentGlow, which asserts the static
         shadow EQUALS the pulse's rest value -- converting one side would
         make a measured relationship unverifiable;
       - 0 0 0 2px on the share thumbnails is a spread RING, not a glow;
       - 0 6px 18px is elevation, not light.
     So this counts what is left rather than demanding zero: it fails if a
     NEW hand-set gold glow appears, and does not pretend the six above are
     mistakes. */
  const halos = BARE.match(/box-shadow:[^;]*rgba\((?:227,177,90|245,208,97)[^;]*;/g) || [];
  const glows = halos.filter(h => !/0 0 0 \d+px|0 \d+px \d+px/.test(h));
  assert.equal(glows.length, 3,
    'hand-set gold glows: ' + glows.length + ' (expected the 3 the pulse owns)\n  ' +
    glows.join('\n  '));
  /* ...and the pattern they should follow is in the sheet and working. */
  assert.match(BARE, /\.pp-chip\.is-open\{[^}]*color-mix\(in srgb, var\(--gold\)/,
    'the selected phase chip hand-sets its gold again');
  assert.match(BARE, /\.wk-day\.is-sel\{[^}]*color-mix\(in srgb, var\(--gold\)/,
    'the selected day circle hand-sets its gold again');
});
