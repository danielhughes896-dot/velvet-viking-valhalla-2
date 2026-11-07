'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* THE THREE INSTRUMENTS BREATHE.
 * ===========================================================================
 * The session ring, the confidence gauge and the week's gold bar each land
 * the way they already did, hold still for half a second, and then keep a
 * slow 3.6s glow. The brief was precise and the precision is the point:
 *
 *   "don't pulse the ring's size or stroke. Only animate the glow/opacity
 *    around it. settle for ~500ms -> gentle 3-4 sec glow cycle -> repeat."
 *
 * So this file does not check that an animation exists. It checks the three
 * things that would quietly break the brief:
 *
 *   1. NOTHING GEOMETRIC IS IN A KEYFRAME. A width, a radius, a stroke, a
 *      transform or a scale appearing in one of these would pulse the
 *      instrument itself, which is the one thing that was ruled out.
 *   2. EVERY KEYFRAME CARRIES THE SAME SHADOWS AT THE SAME BLUR. Only the
 *      alpha may move. A differing blur would swell the halo (a size change
 *      by another name), and a differing SHADOW COUNT does not interpolate
 *      at all -- CSS falls back to a discrete swap, so the breath becomes a
 *      flicker.
 *   3. THE CYCLE STARTS WHERE THE ELEMENT ALREADY SITS. 0% has to equal the
 *      resting declaration, or the element jumps at the moment the delay
 *      elapses.
 *
 * ...and that someone who has asked for less motion is spared a pulse that,
 * by design, never stops.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];

function keyframes(name) {
  const m = new RegExp('@keyframes\\s+' + name + '\\{([\\s\\S]*?)\\n  \\}').exec(CSS);
  assert.ok(m, '@keyframes ' + name + ' not found');
  return m[1];
}
/* ALL the rules for a selector, joined. Each of these three elements is
   declared more than once -- its resting look in one place, its animation in
   another, and .wk-bar-fill.is-filling again inside the reduced-motion block
   -- so taking the first match asks the file a question about source order
   instead of about behaviour. */
function rule(selector) {
  const all = CSS.match(new RegExp('(?<![\\w.#-])' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{[^}]*\\}', 'g'));
  assert.ok(all && all.length, selector + ' rule not found');
  return all.join('\n');
}
// Every "0px 0px <n>px" blur in a shadow list, in order.
function blurs(block) {
  return (block.match(/0\s+0\s+(\d+)px/g) || []).map(s => s.match(/(\d+)px$/)[1]);
}
function alphas(block) {
  return (block.match(/rgba\([^)]*,\s*([\d.]+)\)/g) || []).map(s => s.match(/,\s*([\d.]+)\)$/)[1]);
}

const GLOWS = ['vv-glow-ring', 'vv-glow-gauge', 'vv-glow-gold'];

test('no glow keyframe animates geometry -- only the light moves', () => {
  GLOWS.forEach(name => {
    const body = keyframes(name);
    [/\bwidth\s*:/, /\bheight\s*:/, /\btransform\s*:/, /\bscale\s*:/,
     /stroke-width\s*:/, /\br\s*:/, /border-radius\s*:/, /\binset\s*:/].forEach(bad => {
      assert.doesNotMatch(body, bad,
        name + ' animates the instrument itself, not the glow around it');
    });
  });
});

test('the edge blur never moves, the halo may, and the shadow count is fixed', () => {
  /* Two glows per instrument doing two jobs. The FIRST hugs the stroke and
     its blur is frozen, so the ring keeps exactly the same definition at
     every point in the cycle -- that is the "don't pulse the stroke" half of
     the brief. The SECOND is the halo in the air around it, and it is
     allowed to reach further as well as brighten, because a halo pinned to
     one radius is what made the first version of this invisible: 22px at .30
     on a near-black screen is a rumour.
     The COUNT is fixed either way, and that one is structural: a list with
     one shadow at rest and two at the crest does not interpolate at all. */
  GLOWS.forEach(name => {
    const body = keyframes(name);
    const stops = body.split(/\n\s*(?=\d+%|\d+%,)/).filter(s => /%/.test(s));
    assert.ok(stops.length >= 2, name + ': expected a rest stop and a crest');
    const rest = blurs(stops[0]), crest = blurs(stops[1]);
    assert.equal(crest.length, rest.length,
      name + ': the shadow count differs between stops -- CSS would swap them ' +
      'discretely and the breath would read as a flicker');
    assert.ok(rest.length >= 2, name + ': expected an edge shadow and a halo');
    assert.equal(crest[0], rest[0],
      name + ": the edge blur moved -- that is the stroke's own definition changing");
    /* REVERSED, AND THE REASON IS THE REPORT THAT CAUSED IT.
       This used to REQUIRE the halo to widen at the crest, because the first
       version pinned it at 22px/.30 and that was a rumour on a near-black
       screen. The fix was right about the symptom and wrong about the cause:
       a drop-shadow is rasterised from the element's own pixels, so a radius
       that changes every frame means a FRESH BLUR every frame, computed at
       whatever resolution the compositor gave that layer -- and the stepping
       in that falloff is what "it looks slightly pixelated when pulsing"
       turned out to be.
       So the radius is frozen and the light does all the moving. The old
       worry is answered by measurement rather than by motion: the halo is
       pinned WIDE rather than narrow, and the alpha travels much further
       than it did. Captured at the crest and at the trough and compared
       against the previous commit, the session ring's halo is 45% brighter
       at the crest while its resting state barely moves, which takes the
       crest-to-trough swing from 4.97 to 15.89 -- it is felt more, not less.
       What is held here is that outcome: the halo must be wide enough to
       carry, and it must brighten substantially. */
    assert.equal(crest[1], rest[1],
      name + ': the halo blur moved between stops. A radius that changes every frame ' +
      'forces a fresh blur every frame, and the stepping in that falloff is the ' +
      'pixelation this was reported for. Move the alpha, not the geometry.');
    assert.ok(Number(rest[1]) >= 26,
      name + ': the halo is pinned at ' + rest[1] + 'px. Frozen AND narrow is the ' +
      'combination that made the first version of this invisible -- if it cannot ' +
      'widen it has to start wide.');
    const haloRest = Number(alphas(stops[0])[1]), haloCrest = Number(alphas(stops[1])[1]);
    assert.ok(haloCrest - haloRest >= 0.4,
      name + ': the halo only brightens by ' + (haloCrest - haloRest).toFixed(2) +
      ' across the cycle; with the radius frozen the alpha is the whole pulse.');
    // ...and the light itself must actually move.
    assert.notDeepEqual(alphas(stops[0]), alphas(stops[1]),
      name + ': rest and crest are identical -- nothing pulses');
  });
});

test('the crest is bright enough to be seen, not merely different', () => {
  /* The first pass was technically a pulse and practically invisible. These
     floors are what "I need to see and feel it" came to once it was looked
     at on screen: the edge goes to very near full, and the halo arrives from
     nothing at the rest stop to something clearly readable. */
  GLOWS.forEach(name => {
    const stops = keyframes(name).split(/\n\s*(?=\d+%|\d+%,)/).filter(s => /%/.test(s));
    const crest = alphas(stops[1]).map(Number);
    assert.ok(crest[0] >= 0.9, name + ': the edge only reaches ' + crest[0] + ' at the crest');
    assert.ok(crest[1] >= 0.5, name + ': the halo only reaches ' + crest[1] + ' at the crest');
  });
});

test("the gold bar's glow is not clipped back inside its own track", () => {
  /* It was: .wk-bar carried overflow:hidden, so the fill's halo could never
     leave a 9px-tall box and the bar was the one instrument whose pulse was
     invisible at every point in the cycle. Nothing needed the clip -- the
     fill has the same radius and height as the track and is never wider. */
  assert.doesNotMatch(rule('.wk-bar'), /overflow:\s*hidden/,
    "the week bar's track clips its own glow again");
});

test('every cycle begins on the element\'s own resting appearance', () => {
  // 0% must equal what the element's own rule already declares, or it jumps
  // the moment the delay elapses.
  const restRing = keyframes('vv-glow-ring').split('50%')[0];
  assert.match(rule('.th-arc'), /drop-shadow\(0 0 10px var\(--cherry-dim\)\)/,
    "the ring's resting glow changed -- the 0% stop has to change with it");
  assert.match(restRing, /0 0 10px rgba\(154,84,108,\.50\)/,
    'the ring cycle no longer starts where the ring sits (--cherry-dim is .50)');

  const restGold = keyframes('vv-glow-gold').split('50%')[0];
  assert.match(rule('.wk-bar-fill'), /box-shadow:0 0 10px rgba\(227,177,90,\.34\)/);
  assert.match(restGold, /0 0 10px rgba\(227,177,90,\.34\)/,
    'the gold bar cycle no longer starts where the bar sits');
  /* THE WHOLE LIST, NOT JUST THE FIRST SHADOW. This checked only the 10px
     edge, so when the bar gained a second resting shadow to match its 0%
     stop, a mutation that deleted it again passed -- and the bar would pop
     a halo into existence the moment the settle delay elapsed. Compared as
     a list now, because "begins on its own resting appearance" was always a
     claim about all of it. */
  const shadowList = txt => (txt.match(/\d+ \d+ \d+px rgba\([^)]*\)/g) || []).join(' | ');
  const barRest = shadowList(/box-shadow:([^;}]*)/.exec(rule('.wk-bar-fill'))[1]);
  const cycleRest = shadowList(/box-shadow:([^;}]*)/.exec(restGold)[1]);
  assert.equal(barRest, cycleRest,
    'the gold bar\'s own shadows and its cycle\'s 0% stop no longer match, so the glow ' +
    'jumps the moment the delay elapses.\n      bar:   ' + barRest + '\n      cycle: ' + cycleRest);
});

test('the timing is a settle then a gentle cycle, with each delay its own entrance plus 500ms', () => {
  const timing = sel => {
    const m = /animation:\s*vv-glow-[a-z]+\s+([\d.]+)s\s+ease-in-out\s+([\d.]+)s\s+infinite/.exec(rule(sel));
    assert.ok(m, sel + ' does not carry a glow cycle');
    return { cycle: parseFloat(m[1]), delay: parseFloat(m[2]) };
  };
  /* '.gauge-wrap > svg', not '.gauge-wrap'. The filter used to sit on the
     <button>, which holds the ring AND the percentage in the middle of it --
     and a filter rasterises everything inside the element it is set on, so
     every frame of the pulse re-rendered that number through a changing
     blur. On the svg the ring glows exactly as before and the number is not
     in a filtered subtree at all. Same cycle, same delay, different element,
     and the delay is what this test is about. */
  [['.th-arc', 1.64], ['.gauge-wrap > svg', 1.64], ['.wk-bar-fill', 1.28]].forEach(([sel, delay]) => {
    const t = timing(sel);
    assert.ok(t.cycle >= 3 && t.cycle <= 4, sel + ': ' + t.cycle + 's is outside the 3-4s brief');
    assert.equal(t.delay, delay, sel + ': the settle no longer follows this element\'s entrance');
  });
  /* The rings draw for --ring-draw and the bar fills for 780ms; the delays
     above are those plus the 500ms settle. If an entrance is retimed the
     settle has to be retimed with it, or the pulse starts mid-arrival --
     which is exactly what this caught when the draw went from 760ms to
     1140ms and both ring delays were left where they were.
     The duration is read from the token rather than pinned as a literal,
     because it is now one figure shared by every ring; the arithmetic that
     matters is the relationship, and that is asserted below. */
  const drawMs = /--ring-draw:\s*(\d+)ms/.exec(CSS);
  assert.ok(drawMs, 'the shared ring draw duration is gone');
  assert.match(CSS, /animation:th-draw var\(--ring-draw\)/,
    'the session ring no longer draws at the shared speed');
  assert.match(CSS, /animation:gauge-draw var\(--ring-draw\)/,
    'the confidence gauge no longer draws at the shared speed');
  /* ---- AND IT DRAWS ON ARRIVAL, NOT ON EVERY RENDER ----
     The entrance was declared straight on .gauge-fill, and every render
     produces a fresh element, so the gauge re-filled from zero whenever
     anything on the page redrew. Measured in a browser: after an ordinary
     renderApp() with nothing changed, gauge-draw was running again at 33ms
     of 1140, while the session ring (is-drawing) and the week's bar
     (is-filling) -- both gated on a key -- sat still. The gauge was the one
     instrument of the three whose entrance nothing gated.
     Three things have to hold together, so all three are named: the
     animation sits behind the class, something adds the class, and the
     render path calls it. */
  assert.match(CSS, /\.gauge-wrap\.is-drawing \.gauge-fill\{\s*animation:gauge-draw/,
    'the gauge entrance is unconditional again, so it replays on every render');
  assert.doesNotMatch(CSS, /\.gauge-fill\{stroke:url\(#gaugeFill\);\s*animation:/,
    'the entrance is back on the element itself');
  assert.match(SRC, /function animateConfidenceGauge\(\)\{[\s\S]*?if \(key === gaugeLastKey\) return;/,
    'the gauge is no longer keyed, so it draws again on every render');
  assert.match(SRC, /animateWeekBar\(\);\s*\n\s*animateConfidenceGauge\(\);/,
    'the render path stopped asking the gauge to draw, so it never draws');

  /* ---- AND IT GROWS FROM A FIXED START, RATHER THAN SLIDING INTO PLACE ----
     The dash used to be "fillLen gap" -- already the finished length -- so
     animating its offset could only ROTATE it. Traced on the running screen,
     the visible arc went 32-14 degrees, then 193-175, then 292-274, then
     360-342: both ends travelling the whole way, a band sliding round to its
     resting place rather than a ring filling. The session ring does the one
     thing that grows -- the dash is the WHOLE path and the offset says how
     much is still withheld (0-25 degrees, 0-164, 0-248, 0-305) -- and this
     now does the same, measured 0-14, 0-175, 0-274, 0-342.
     Guarded at the two places the mechanism lives: the dash must be the
     circumference, and the keyframe must end on the reading rather than on
     zero. Either one alone puts the slide back. */
  assert.match(SRC, /stroke-dasharray="'\+circ\.toFixed\(1\)\+'"/,
    'the gauge dash is a short arc again, so its offset can only rotate it');
  assert.doesNotMatch(SRC, /stroke-dasharray="'\+fillLen\.toFixed/,
    'the gauge dash is back to the finished length, which slides instead of growing');
  const kf = CSS.match(/@keyframes gauge-draw\{[\s\S]*?\}\s*\}/);
  assert.ok(kf, 'the gauge draw keyframe is gone');
  assert.match(kf[0], /from\{\s*stroke-dashoffset:var\(--gauge-len/,
    'the gauge no longer starts fully withheld');
  assert.match(kf[0], /to\s*\{\s*stroke-dashoffset:var\(--gauge-to/,
    'the gauge draw ends at 0 again -- that is a full ring, not the reading');
  assert.match(CSS, /\.gauge-fill\{stroke:url\(#gaugeFill\); stroke-dashoffset:var\(--gauge-to/,
    'the resting state no longer matches where the animation ends');
  assert.equal(Number(drawMs[1]) / 1000 + 0.5, 1.64,
    'the ring delays above no longer equal this entrance plus the 500ms settle');
  assert.match(CSS, /animation:wk-fill 780ms cubic-bezier\(\.22,\.61,\.36,1\) both,/);
});

test('the bar names BOTH its animations in one rule', () => {
  // The fill and the glow are on the same element and `animation` is a
  // shorthand, so a second rule naming one of them silently drops the other.
  const filling = rule('.wk-bar-fill.is-filling');
  assert.match(filling, /wk-fill 780ms/, 'the bar stopped filling');
  assert.match(filling, /vv-glow-gold/, 'filling the bar drops its glow for the life of the class');
  /* Outside the reduced-motion block, where `animation:none` is a separate
     and deliberate rule, there must be exactly one. */
  const outside = CSS.replace(/@media \(prefers-reduced-motion: reduce\)\{[\s\S]*?\n  \}/g, '');
  const count = (outside.match(/\.wk-bar-fill\.is-filling\{/g) || []).length;
  assert.equal(count, 1, 'two .is-filling rules -- the later shorthand wins and one animation is lost');
});

test('reduced motion stops the cycles, not just the entrances', () => {
  /* There are two reduced-motion blocks and they do different jobs. The one
     near the top is a global kill switch -- `*{animation-iteration-count:1}`
     -- which already neutralises an infinite cycle wherever it is declared,
     and it is what actually protects the reader. The one beside the glows
     says so locally, so nobody adding a fourth instrument has to go looking
     for the first. Both are asserted: losing the global one would be the
     real regression. */
  const blocks = CSS.match(/@media \(prefers-reduced-motion: ?reduce\)\{[\s\S]*?\n  \}/g) || [];
  assert.ok(blocks.length >= 2, 'expected a global reduced-motion rule and a local one');
  const all = blocks.join('\n');
  assert.match(all, /animation-iteration-count:1 !important/,
    'the global reduced-motion switch is gone -- an infinite glow would keep running');
  /* Named rather than pinned as one exact string: the gauge's fill joined
     this list when the gauge gained an entrance, and the claim is that each
     of these instruments is silenced -- not that the selector reads in a
     particular order. */
  const kill = /@media \(prefers-reduced-motion: ?reduce\)\{[\s\S]*?animation:none;[\s\S]*?\n  \}/.test(all);
  assert.ok(kill, 'nothing is explicitly silenced beside the glows any more');
  ['.th-arc', '.gauge-wrap', '.wk-bar-fill', '.gauge-fill'].forEach(sel =>
    assert.ok(all.indexOf(sel) !== -1,
      sel + ' keeps moving for a reader who asked for less motion'));
});

test('no instrument puts text inside its own animated filter', () => {
  /* THE REPORT WAS "slightly pixelated when pulsing", AND THIS WAS HALF OF IT.
     The gauge's filter sat on .gauge-wrap, which is the <button> -- and that
     button holds the ring AND .gauge-num, the percentage in the middle of it.
     A filter rasterises everything inside the element it is set on, so every
     frame of the pulse re-rendered that number through a changing blur. Thin
     bright glyphs are the worst thing to put through that, which is why the
     stepping showed there first.
     Today's session ring never had the problem because .th-arc is the arc
     alone and .th-ring-in sits beside it. The gauge now matches: the glow is
     on the svg, and the number is not in a filtered subtree at all. */
  const wrap = rule('.gauge-wrap');
  assert.doesNotMatch(wrap, /filter\s*:/,
    '.gauge-wrap carries a filter again. It contains .gauge-num, so the percentage ' +
    'would be rasterised through the pulse on every frame.');
  assert.doesNotMatch(wrap, /animation\s*:\s*vv-glow/,
    '.gauge-wrap animates a glow again — put it on the svg, which holds no text');
  assert.match(CSS, /\.gauge-wrap > svg\{[^}]*filter:drop-shadow/,
    'the gauge ring lost the glow that moved off the button');
  assert.match(CSS, /\.gauge-wrap > svg\{ animation:vv-glow-gauge/,
    'the gauge ring lost its glow cycle');
  /* And the same claim for the ring that was always right, so a later pass
     cannot quietly move .th-arc's filter up onto .th-ring, which wraps the
     readout. */
  assert.doesNotMatch(rule('.th-ring'), /filter\s*:/,
    '.th-ring carries a filter — it wraps .th-ring-in, the pace and HR readout');
});

test('every gold bar in the product is the same material', () => {
  /* "Have you done the same for the gold bars?" turned up two more. Runs and
     Volume in Valhalla's Progress panel are the same component as the week
     bar and carried no light at all, so they read as a different material to
     the one thing the product calls a progress bar.
     They take the week bar's RESTING recipe with the radii scaled to a 5px
     bar rather than a 9px one, and deliberately no cycle: the pulse is what
     says "this is live", and these are reference figures in a panel opened
     from a circle that is already breathing. If that call is ever reversed,
     reverse it here rather than by adding an animation and leaving this
     comment saying the opposite. */
  const pbar = rule('.pbar-fill');
  /* color-mix on --gold, not a hand-set rgba. planSurface counts the literal
     gold glows left in the sheet and allows exactly three -- the pulse's two
     keyframe stops and .wk-bar-fill's resting shadow, which this file asserts
     are equal to each other, so converting one side of a measured
     relationship would make it unverifiable. A new glow has no such tie and
     takes the token. */
  assert.match(pbar, /box-shadow:[^;}]*color-mix\(in srgb, var\(--gold\)/,
    'the Progress panel bars lost their gold light, or hand-set it instead of naming --gold');
  const stops = (pbar.match(/0 0 \d+px color-mix\(in srgb, var\(--gold\) \d+%, transparent\)/g) || []);
  assert.equal(stops.length, 3,
    'the Progress bars should carry the same three-stop recipe as the week bar; found ' +
    stops.length);
  assert.doesNotMatch(pbar, /animation\s*:\s*vv-glow/,
    'the Progress bars started pulsing. That is a product decision, not a consistency ' +
    'fix — the comment beside the rule has to change with it.');

  /* And the week bar keeps three stops too, which is what brought its crest
     from +6% to +34% against the previous commit -- a bar is a far thinner
     source than a ring and the same alphas put much less light in the air. */
  const gold = keyframes('vv-glow-gold');
  const crestStops = (gold.slice(gold.indexOf('50%')).match(/0 0 \d+px rgba\(227,177,90,[\d.]+\)/g) || []);
  assert.equal(crestStops.length, 3,
    'the week bar is back to two shadows; measured, two put 6% more light in the air ' +
    'where the rings got 38% and 26%');
});
