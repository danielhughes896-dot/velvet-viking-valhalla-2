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

test('each glow keeps one shadow list at one blur, and moves only alpha', () => {
  GLOWS.forEach(name => {
    const body = keyframes(name);
    const stops = body.split(/\n\s*(?=\d+%|\d+%,)/).filter(s => /%/.test(s));
    assert.ok(stops.length >= 2, name + ': expected a rest stop and a crest');
    const shape = blurs(stops[0]);
    assert.ok(shape.length >= 2, name + ': expected at least two shadows to work with');
    stops.forEach((stop, i) => {
      assert.deepEqual(blurs(stop), shape,
        name + ' stop ' + i + ' changes a blur radius -- that swells the halo, ' +
        'and a differing shadow COUNT would not interpolate at all');
    });
    // ...and something must actually move, or there is no pulse.
    assert.notDeepEqual(alphas(stops[0]), alphas(stops[1]),
      name + ': rest and crest are identical -- nothing pulses');
  });
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
});

test('the timing is a settle then a gentle cycle, with each delay its own entrance plus 500ms', () => {
  const timing = sel => {
    const m = /animation:\s*vv-glow-[a-z]+\s+([\d.]+)s\s+ease-in-out\s+([\d.]+)s\s+infinite/.exec(rule(sel));
    assert.ok(m, sel + ' does not carry a glow cycle');
    return { cycle: parseFloat(m[1]), delay: parseFloat(m[2]) };
  };
  [['.th-arc', 1.26], ['.gauge-wrap', 0.5], ['.wk-bar-fill', 1.28]].forEach(([sel, delay]) => {
    const t = timing(sel);
    assert.ok(t.cycle >= 3 && t.cycle <= 4, sel + ': ' + t.cycle + 's is outside the 3-4s brief');
    assert.equal(t.delay, delay, sel + ': the settle no longer follows this element\'s entrance');
  });
  // The ring draws for 760ms and the bar fills for 780ms; the delays above
  // are those plus the 500ms settle. If an entrance is retimed, the settle
  // has to be retimed with it or the pulse starts mid-arrival.
  assert.match(CSS, /animation:th-draw 760ms/);
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
  assert.match(all, /\.th-arc, \.gauge-wrap, \.wk-bar-fill\{ animation:none; \}/,
    'a glow that repeats forever is exactly the motion someone asking for less wants spared');
});
