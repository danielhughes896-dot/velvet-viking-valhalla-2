'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* VALHALLA TAKES THE SAME RULES: the instruments stay, the containers go.
 * ===========================================================================
 * Every circle on this screen -- the confidence gauge, the Reading badges,
 * the Athlete Status dials -- is a reading of something and keeps its face.
 * The three boxes AROUND them were framing content that does not need a
 * frame, which is what the phase cards and the session cards were doing on
 * the screens before this one.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => {
  const i = BARE.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return BARE.slice(i + sel.length + 1, BARE.indexOf('}', i));
};

test('Valhalla renders inside a wrapper, so its rules have somewhere to hang', () => {
  /* It was the one screen returning a bare run of sections. .hub-card is
     also Today's Next Move and the post-race panel, and the comment on it
     says in as many words that it must never be restyled bare -- so without
     a wrapper there was no way to restyle it HERE. */
  assert.match(SRC, /return '<div class="view-planhq">'\+/,
    'the Valhalla wrapper is gone, and .hub-card cannot be scoped to this screen');
});

test('the containers go and the instruments stay', () => {
  const r = rule('.view-planhq :is(.v-hero, .v-call, .hub-card)');
  ['background:none', 'border:0', 'border-radius:0', 'box-shadow:none'].forEach(d =>
    assert.ok(r.indexOf(d) > -1, 'the Valhalla containers no longer drop ' + d));
  /* .tile-card is the additive modifier the Valhalla consistency pass put ON
     TOP of .hub-card rather than editing it -- it is the rule that actually
     paints the box, so it has to be named too. */
  assert.match(BARE, /\.view-planhq :is\(\.hub-card, \.hub-card\.tile-card\)\{/,
    'the .tile-card modifier is unhandled again, so the sessions panel stays a box');
  /* The circles are readings, not containers: they keep their faces. */
  assert.ok(BARE.indexOf('.gauge-num{') > -1, '.gauge-num is gone');
  assert.doesNotMatch(BARE, /\.view-planhq[^{]*\.(gauge-num|b-dial|b-medal)[^{]*\{[^}]*background:none/,
    'the instrument faces were stripped along with the containers');
});

test("the call's severity survives the de-boxing, as light", () => {
  /* A REGRESSION THIS PASS INTRODUCED AND THIS GUARD EXISTS FOR. .v-call
     carried its state in FOUR places -- a tinted gradient, a border, a 3px
     left bar and a glow -- and every one of them was --call-tone. Removing
     the box removed all four, leaving the most important signal on the
     screen carried by a 6px dot. It returns as the ambient wash, from the
     same variable, so good/watch/bad still change the light. */
  const r = rule('.view-planhq .v-call::before');
  assert.match(r, /var\(--call-tone\)/,
    'the call wash no longer reads the state variable, so severity is invisible');
  assert.match(r, /filter:blur\(/, 'the call wash is a hard gradient again');
  const shape = /radial-gradient\((\d+)% (\d+)%/.exec(r);
  assert.ok(shape && Number(shape[1]) < 50 && Number(shape[2]) < 50,
    'the call wash reaches its own box edge and will be cut square');
  ['.v-call.good', '.v-call.watch', '.v-call.bad'].forEach(sel =>
    assert.match(rule(sel), /--call-tone:/, sel + ' no longer sets a tone for the wash to take'));
});

test('the confidence gauge is lit by the same rules as the session ring', () => {
  /* Same filament, from the same four stops in the same order: a stroke
     painted entirely in mid-pink tops out at 127 luminance however much
     glow is added -- the ceiling is the hue, not the treatment -- which is
     why the session ring was given a near-white hot end in the first place. */
  assert.match(rule('.gauge-fill'), /stroke:url\(#gaugeFill\)/,
    'the gauge arc is a flat stroke again');
  const grad = /id="gaugeFill"[\s\S]*?<\/linearGradient>/.exec(SRC);
  assert.ok(grad, 'the gauge gradient is gone');
  ['#FFF1F5', 'var(--cherry-text)', 'var(--cherry)', 'var(--cherry-dim)'].forEach(stop =>
    assert.ok(grad[0].indexOf(stop) > -1, 'the gauge filament lost its ' + stop + ' stop'));
  /* The drawn highlight goes: a painted bevel is a picture of a light
     source, and this product lights things instead. */
  assert.equal(SRC.indexOf('gauge-bevel'), -1, 'the painted bevel is back on the gauge');
  assert.equal(SRC.indexOf('gaugeBevel'), -1, 'the bevel gradient is back on the gauge');
  /* ...and so does the elevation it used to sit on. */
  assert.doesNotMatch(rule('.gauge-wrap'), /rgba\(0,0,0/,
    'the gauge is being lifted off a card that no longer exists');
});

test('the gauge is the brightest ring on any screen, because it is the headline', () => {
  const peak = (name) => {
    const i = BARE.indexOf('@keyframes ' + name);
    const body = BARE.slice(i, BARE.indexOf('\n  }', i));
    const fifty = body.slice(body.indexOf('50%'));
    const nums = [...fifty.matchAll(/rgba\(154,84,108,([\d.]+)\)/g)].map(m => Number(m[1]));
    assert.ok(nums.length >= 2, 'could not read the peak of ' + name);
    return nums;
  };
  const gauge = peak('vv-glow-gauge');
  const ring = peak('vv-glow-ring');
  assert.ok(gauge[0] >= ring[0] && gauge[1] > ring[1],
    'the confidence gauge (' + gauge.join('/') + ') is no longer brighter at its peak ' +
    'than the session ring (' + ring.join('/') + '), and it is the reading this screen is built around');
});
