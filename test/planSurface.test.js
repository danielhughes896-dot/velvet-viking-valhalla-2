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
  assert.match(body, /box-shadow:0 0 \d+px rgba\(227,177,90/,
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

test('a finished week is lit with the same green a finished session is', () => {
  /* Same token, same technique: a blurred radial built from --ok, not a
     colour invented at the call site, and under 50% on both axes so the
     ending shape cannot reach the box edge and be cut square. */
  const i = BARE.indexOf('.view-plan .pp-body .week.is-done::before');
  assert.ok(i > -1, 'completed weeks are no longer lit');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  assert.match(body, /var\(--ok-text\)/, 'the week glow stopped naming its colour');
  assert.match(body, /var\(--ok\)/, 'the week glow stopped naming its colour');
  assert.doesNotMatch(body, /#[0-9A-Fa-f]{3,6}|rgba?\(/,
    'the week glow hand-sets a colour belonging to no token');
  assert.match(body, /filter:blur\(/, 'a stop list always shows its edge -- the blur is the technique');
  const shape = /radial-gradient\((\d+)% (\d+)%/.exec(body);
  assert.ok(shape && Number(shape[1]) < 50 && Number(shape[2]) < 50,
    'the week glow reaches its own box edge and will be cut square');
  /* .week clipped its children before the boxes came off it, and a glow
     that overspills by 100vw is the first thing that clipping would eat. */
  assert.match(BARE, /\.view-plan \.pp-body \.week\{overflow:visible;\}/,
    'the week row clips again, so the glow is cut to the row');
});

test('the week glow is dimmer than the session banner, because it repeats', () => {
  /* SESSION COMPLETE appears once on a screen. This can appear ten times
     down a block, and a column of glows at the banner's strength stops
     reading as "done" and starts reading as the background. */
  const pick = (marker) => {
    const i = BARE.indexOf(marker);
    assert.ok(i > -1, 'missing: ' + marker);
    const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
    return Number(/var\(--ok-text\) (\d+)%/.exec(body)[1]);
  };
  const banner = pick('.actual-done::before');
  const week = pick('.view-plan .pp-body .week.is-done::before');
  assert.ok(week < banner,
    'the repeating week glow (' + week + '%) is no longer dimmer than the one-off session banner (' + banner + '%)');
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
  assert.match(ruleFor('\n  .pp-chip.is-done{'), /box-shadow:[^;]*var\(--ok\)/,
    'a completed phase chip is no longer lit green');
  assert.match(ruleFor('.pp-chip.is-now{'), /box-shadow:[^;]*rgba\(227,177,90/,
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
  assert.match(body, /box-shadow:0 0 \d+px rgba\(227,177,90/, 'the current week is no longer lit');
  assert.doesNotMatch(body, /0 0 0 1px|border/, 'the gold ring came back around the current week');
});
