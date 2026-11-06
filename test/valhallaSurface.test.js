'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

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
const TODAY = '2026-08-24T09:00:00Z';
/* A real athlete, because the ladder and the hero rule are both decided by
   the actual strings the engine produces rather than by invented ones. */
function planHQ(opts) {
  const a = loadApp({ pinnedDate: TODAY });
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12 }, opts || {}));
  a.state.view = 'planhq';
  return a;
}
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

/* ===========================================================================
 * ONE TYPE LADDER, ONE HERO RULE, AND LINES THAT DO WORK
 * ===========================================================================
 */
test('LADDER: one rule sizes every circle, and it is derived rather than tabulated', () => {
  const a = planHQ();
  /* The second table is gone. statusValueFontSize() used to carry its own
     list of sizes for the 90px faces; normalised against their diameters it
     set text about 35% smaller than the Reading ladder, so "3:18-3:38" sat
     at 11px in a 90px circle while "4" sat at 23px in a 76px one. */
  assert.doesNotMatch(SRC, /function statusValueFontSize\(text\)\{\s*var n =/,
    'the second hand-tuned status ladder is back');
  assert.match(SRC, /function statusValueFontSize\(text\)\{\s*return dialValueFontSize\(text, 's'\);/,
    'the status faces no longer defer to the one ladder');

  /* The rule is the constraint, not a list of remembered answers: the
     largest size whose longest unbreakable run still fits the width that
     run has to live in. */
  assert.match(SRC, /var DIAL_FACE = \{[\s\S]*?'s':\s*\{d:90/, 'the face table lost its status entry');
  assert.match(SRC, /DIAL_MONO_ADVANCE = 0\.6/, 'the mono advance is no longer stated');

  // Every face the product can draw, at every rank, fits its own box.
  const FACE = { '0':{d:90,w:74}, '1':{d:76,w:64}, '2':{d:66,w:56}, 's':{d:90,w:76} };
  const strings = a.readingSections(a.coachAnalyse()).map(s => a.dialFaceParts(s).big)
    .concat(a.recordFacts().map(f => f.big))
    .filter(t => t && t !== '—');
  assert.ok(strings.length >= 6, 'expected a spread of real values, got ' + strings.length);
  Object.keys(FACE).forEach(rank => {
    strings.forEach(text => {
      const px = a.dialFaceFontPx(text, rank);
      const longest = Math.max(...String(text).split(' ').map(w => w.length));
      const runWidth = longest * 0.6 * px;
      assert.ok(runWidth <= FACE[rank].w,
        '"' + text + '" at rank ' + rank + ' needs ' + runWidth.toFixed(1) +
        'px for its longest run but has ' + FACE[rank].w + 'px');
      assert.ok(px >= 9, '"' + text + '" at rank ' + rank + ' fell to ' + px + 'px, below the floor');
      assert.ok(px <= FACE[rank].d * 0.30 + 0.05,
        '"' + text + '" at rank ' + rank + ' broke the ceiling at ' + px + 'px');
    });
  });
});

test('a circle centres its value, and only a real sub-line moves it', () => {
  /* statusDialHtml emitted .rd-sub unconditionally, to reserve a slot that
     was believed to keep GOAL / FITNESS / BENCHMARK / PROGRESS aligned.
     Measured in a browser, that is not what aligns them: .rd-sub sits inside
     .b-medal, a FIXED 90px circle, so an empty one cannot change the
     column's height -- with all four removed the labels stayed on the same
     baseline (731px), and so they did with one dial carrying a real sub and
     the other three not. What it DID do was take a line's worth of room
     inside the circle, pushing every Athlete Status value 8px above centre
     while the Reading circles -- whose renderer already omits an empty sub
     -- sat dead centre.
     Both renderers now omit it, which is the property guarded here: an
     absent sub must not be emitted at all, in EITHER renderer. */
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  [['statusDialHtml', 'the Athlete Status circles'],
   ['readingDialHtml', 'the Reading circles']].forEach(([fnName, what]) => {
    const fn = new RegExp('function ' + fnName + '\\([\\s\\S]*?\\n\\}').exec(src);
    assert.ok(fn, fnName + ' is gone');
    const sub = /rd-sub/.test(fn[0]);
    assert.ok(sub, what + ' no longer render a sub-line at all');
    assert.doesNotMatch(fn[0], /\n\s*'<span class="rd-sub[^']*'\+escapeHtml\(sma?l?l?\)/,
      what + ' emit an empty sub-line again, which pushes the value off centre');
  });
});

test('a word in a circle is one size per rank; a figure still fills the face', () => {
  /* MEASURED ON THE RENDERED SCREEN, which is where this went wrong. The
     ladder sizes a face to fill it -- right for a figure, because the figure
     IS the reading -- and the size of a WORD then came from that word's own
     length. On The Reading's four circles: "Fresh" at 18px and "Plateau" at
     12.9px side by side at the SAME rank, and "On track" at 20.7px, where it
     could not fit on one line and broke into a 45px block inside a 76px
     circle. Three sizes and a word snapped in half, in one row of four. */
  const a = planHQ();
  const WORD_PX = { '0':13.5, '1':12.5, '2':11, 's':13.5 };
  const WORDS = ['Fresh', 'Plateau', 'On track', 'Worth watching', 'Strained'];

  Object.keys(WORD_PX).forEach(rank => {
    /* Every word the rank can show comes out at the same size -- that is what
       makes a row of circles read as one instrument rather than four. */
    const sizes = new Set(WORDS.map(t => a.dialFaceFontPx(t, rank)));
    assert.equal(sizes.size, 1,
      'rank ' + rank + ' sizes its words by their own length again: ' +
      WORDS.map(t => t + '=' + a.dialFaceFontPx(t, rank)).join(', '));
    assert.equal([...sizes][0], WORD_PX[rank],
      'rank ' + rank + ' words are no longer at the capped size');
  });

  /* And the cap did not leak onto the figures: a figure still reaches the
     ceiling the face ladder sets for it. */
  assert.ok(a.dialFaceFontPx('64%', 's') > WORD_PX['s'] * 1.5,
    'the figure ladder was capped along with the words');
  assert.ok(a.dialFaceFontPx('4', '1') > WORD_PX['1'] * 1.5,
    'a bare count is being treated as a word');
  /* A single letter is a grade, not a word. */
  assert.ok(a.dialFaceFontPx('A', 's') > WORD_PX['s'] * 1.5,
    'the grade face is being treated as a word');

  /* The whole point: a two-word value now lays out on ONE line, because the
     cap is low enough that the full string clears the face. */
  const px = a.dialFaceFontPx('On track', '1');
  assert.ok('On track'.length * 0.6 * px <= 64,
    '"On track" needs ' + ('On track'.length * 0.6 * px).toFixed(1) +
    'px at ' + px + 'px and has 64px, so it wraps inside the circle again');
});

test('HERO: the panel circle is for figures, and a word is carried by its chip', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  let withCircle = 0, wordless = 0;
  a.readingSections(report).forEach(sec => {
    const panel = a.readingPanel(sec.key);
    const face = a.dialFaceParts(sec).big || '';
    /* The circle goes only where the toned chip is already carrying the
       same word. An untoned reading has no chip, so dropping its circle
       would leave the hero holding nothing -- it keeps one whatever shape
       its value takes. */
    if (/\d/.test(face) || !sec.tone) {
      withCircle++;
      assert.match(panel, /class="rp-hero"/, sec.key + ' states a figure but drew no circle');
      assert.match(panel, /class="b-dial"/, sec.key + ' has no circle to put its figure in');
    } else {
      wordless++;
      assert.match(panel, /class="rp-hero is-wordless"/,
        sec.key + ' states a word but still draws a circle for it');
      assert.doesNotMatch(panel, /class="b-dial/, sec.key + ' is wordless but drew a circle');
      // the word still reaches the athlete -- in the pill that is shaped for it
      assert.match(panel, /class="rp-hero-verdict"/, sec.key + ' lost its verdict entirely');
    }
  });
  assert.ok(withCircle > 0 && wordless > 0,
    'expected both shapes to exist; got ' + withCircle + ' with a circle, ' + wordless + ' without');
  /* And the indent that cleared the circle goes with it, or the chip starts
     16px in from every row beneath it for no reason. */
  assert.match(rule('.rp-hero.is-wordless .rp-hero-text'), /padding-left:0/,
    'the wordless hero keeps the indent that cleared a circle it no longer has');
  assert.match(rule('.rp-hero.is-wordless .rp-hero-text'), /border-left:0/,
    'the accent rule still divides a circle that is not there');
});

test('LINES: section boundaries are gone, row separators are not', () => {
  /* Valhalla labels every section -- "THE READING", "THE ATHLETE STATUS" --
     so a plain hairline between hero, call and sections said again, worse,
     what the labelled rule already said. Today draws no horizontal line at
     all and is the cleanest screen in the product. */
  [['.view-planhq .v-hero', 'border-bottom'],
   ['.view-planhq .v-call', 'border-bottom'],
   ['.wk-hero', 'border-bottom'],
   ['.wk-summary > .zone-card', 'border-top']].forEach(([sel, side]) => {
    assert.doesNotMatch(rule(sel), new RegExp(side + ':1px'),
      sel + ' took its section boundary back');
  });
  /* A rule BETWEEN repeated rows is doing work nothing else does, so those
     stay -- and this one is written so it cannot draw above the first row.
     It used to be a border on every signal cancelled by :first-child, but
     each of these lists is introduced by a .setup-section-title inside the
     same parent, so the first signal is the second child and the cancel
     never fired: a line sat directly under "Training Signals" separating it
     from nothing. */
  assert.match(rule('.coach-signal + .coach-signal'), /border-top:1px/,
    'signals no longer separate from one another');
  assert.doesNotMatch(SRC, /\.coach-signal:first-child\{border-top:none;\}/,
    'the :first-child cancel that never fired is back');
});
