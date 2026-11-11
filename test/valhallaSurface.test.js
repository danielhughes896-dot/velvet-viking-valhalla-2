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

test("the call's severity is carried by the word, not by a wash", () => {
  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE SCREEN ----
     It required .view-planhq .v-call::before to be a blurred radial reading
     --call-tone. That wash was itself a repair: de-boxing the call had taken
     its tinted gradient, its border, its 3px left bar and its glow, all four
     of them --call-tone, and the severity came back as ambient light.
     Founder: "Valhalla's call - proceed. Does it offer anything? Really?
     The green glow behind can deffo go."
     IT GOES, AND THE SIGNAL DOES NOT. The call's title reads "Valhalla's
     Call - Proceed", and Proceed / Watch / Ease off is the state written in
     the athlete's own language. On the state the engine returns most of the
     time the wash was a green field the width of the phone, directly under
     the hero, saying what the word beside it already said. So what is
     asserted now is that the WORD is still there and still comes from the
     engine's own state class, and that the wash has not crept back. */
  assert.ok(!/\.view-planhq \.v-call::before\{/.test(BARE),
    'the call wash is back -- the state is the word in the title, not a field of colour');
  assert.ok(!/\.view-planhq \.v-call::after\{/.test(BARE),
    'the dither layer that mirrored the wash is back, over a glow that no longer exists');
  /* ---- AND THEN THE BLOCK ITSELF WENT ----
     The paragraph above argued the word was doing the work and the colour
     was not. The founder has since read the word: "I don't like Valhalla's
     call - proceed / Recovery fresh, trend still building. We know the user
     should proceed." PROCEED is what the engine returns on most days, so
     the band announced an assumption; its two readings are circles in the
     grid directly beneath it, each with a panel carrying the evidence.
     The DECISION IS NOT GONE from the product -- coachAnalyse().decision
     still drives the day card's coaching and Next Move, which is where a
     call the athlete has to act on belongs. */
  const a = planHQ();
  const view = a.renderPlanHQView();
  assert.doesNotMatch(view, /class="v-call/, 'Valhalla\u2019s Call is back on the screen');
  assert.ok(a.coachAnalyse().decision,
    'the coaching decision itself has been lost, not just its band');
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

test('LINES: no plain hairline separates one detail from the next', () => {
  /* THIS GUARD CHANGED SIDES, and the reason is recorded rather than
     quietly swapped. It used to read "section boundaries are gone, row
     separators are not", on the argument that a rule BETWEEN repeated rows
     does work nothing else does. Tested on a phone against the rest of the
     product, that argument lost: the screens read better with the lines
     gone and spacing doing the separating, which is how Today -- the
     cleanest screen here -- has always worked. So the founder's call is
     that the plain hairlines go app-wide, and this asserts that. */
  [['.view-planhq .v-hero', 'border-bottom'],
   ['.view-planhq .v-call', 'border-bottom'],
   ['.wk-hero', 'border-bottom'],
   ['.wk-summary > .zone-card', 'border-top']].forEach(([sel, side]) => {
    assert.doesNotMatch(rule(sel), new RegExp(side + ':1px'),
      sel + ' took its section boundary back');
  });
  /* The row separators now too. .coach-signal and .hq-pattern each had an
     adjacent-sibling rule whose ONLY declaration was the border, so those
     rules are gone outright rather than left as empty shells. */
  assert.doesNotMatch(SRC, /\.coach-signal \+ \.coach-signal\{/,
    'the rule between training signals is back');
  assert.doesNotMatch(SRC, /\.hq-pattern \+ \.hq-pattern\{/,
    'the rule between recent patterns is back');
  assert.doesNotMatch(rule('.rp-rows .hq-row'), /border-bottom:1px/,
    'the Reading panel rows are ruled again');
  assert.doesNotMatch(SRC, /\.coach-signal:first-child\{border-top:none;\}/,
    'the :first-child cancel that never fired is back');

  /* WHAT THE PASS WAS NOT ALLOWED TO TOUCH. The founder drew the line at
     "hairlines that separate details": the GOLD and CHERRY rules are
     decoration and signal, not separators, and they stay. The gold ones are
     gradient-filled elements rather than borders, which is also why the
     sweep could not have reached them by accident -- asserted so that a
     future sweep written differently still cannot. */
  /* Anchored to the start of the rule, NOT read through rule(): that helper
     is indexOf(sel + '{'), and '.sec-rule-line{' also occurs inside
     '.sec-rule.is-left .sec-rule-line{', which is earlier in the sheet. The
     obvious spelling therefore reads the is-left variant and passes while
     the rule it names is blanked -- caught by mutating it. */
  assert.match(SRC, /\n\s*\.sec-rule-line\{[^}]*linear-gradient/,
    'the gold section rule either side of a heading was swept away with the hairlines');
  /* THE CHERRY RULE MOVED WITH THE PANEL IT LIVES IN. It used to be the
     border-top above the strategy picker inside the Race Day card. The
     picker has gone to the race session, so that one declaration is gone --
     and the panel now draws TWO cherry rules instead: between the identity
     and the distance, and above the way in. The law is unchanged and this
     holds more of it than the single border-top did. */
  assert.match(SRC, /border-left:1px solid var\(--cherry-line\)/,
    'the cherry rule between Race Day\'s identity and its distance was swept away ' +
    'with the hairlines');
  assert.match(SRC, /\.rd-open::before\{[^}]*var\(--cherry-line\)/,
    'the cherry rule above the way into the race session was swept away with the hairlines');
});

/* THE LAST GLYPHS ON THIS SCREEN, AND WHAT REPLACED THEM.
 * ===========================================================================
 * Breakthrough Sessions was the one block on Valhalla still printing a
 * sparkle in front of every row -- three glyphs doing nothing the sentence
 * beside them did not already do, and holding the text 24px off the panel's
 * own left edge. They go the way the day card's went.
 * The heading takes the decoration instead, and takes it from the component
 * the rest of the product already uses: one hairline running from the words
 * to the far edge. Cherry rather than gold, because this section is a
 * different kind of thing from the two gold-ruled readings above it -- those
 * are the athlete's current state, this is what they have already done.
 */
test('no glyph leads a breakthrough row', () => {
  assert.doesNotMatch(SRC, /class="coach-bt">'\+ICONS\./,
    'a breakthrough row is leading with a glyph again');
  assert.doesNotMatch(BARE, /\.coach-bt svg\{/,
    'the row glyph has a rule again, so something is drawing one');
});

test('the breakthrough heading is a plain white title', () => {
  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE SCREEN ----
     It required sectionRule('Breakthrough Sessions', true, 'is-cherry') --
     the shared rule component with a cherry hairline running from the words
     to the far edge.
     Founder: "if they do happen it should be a white title consistent with
     the other app titles. Then a box -- I'm easy, either coaches note cherry
     box or the tab that share session and the new build is on."
     So the hairline goes with the gold and cherry decoration coming off this
     screen, and the heading becomes the app's own section title in white.
     THE BOX IS THE SECOND OPTION, DELIBERATELY: the Coach's Note's cherry
     bloom marks the one module where the coach speaks directly, and a
     breakthrough is evidence the athlete produced. The card it already sits
     in is the one the build and Share Session use. */
  assert.match(SRC, /<div class="setup-section-title is-white">Breakthrough Sessions<\/div>/,
    'the breakthrough heading is not the app\u2019s plain white section title');
  assert.ok(!/sectionRule\('Breakthrough Sessions'/.test(SRC),
    'the decorated rule component is back on the breakthrough heading');
  assert.match(BARE, /\.setup-section-title\.is-white\{[^}]*color:var\(--ink\)/,
    'the white modifier no longer makes the title white');
  /* It keeps the card it was already in -- the founder chose the box, not no
     box at all. */
  assert.match(SRC, /function renderBreakthroughCard[\s\S]{0,400}?class="hub-card tile-card"/,
    'the breakthrough rows lost the card they sit in');
});

test('a left-aligned section rule fades away from its words', () => {
  /* is-left emits the title and ONE line, so that line is also :last-child --
     and the mirrored gradient for centred headings claimed it at an equal
     (0,3,0) on source order, drawing it fading INTO the words from the right
     instead of away from them. Restated at (0,4,0) so direction is decided
     by weight, not by which rule happens to sit lower in the sheet. */
  assert.match(BARE, /\.sec-rule\.is-left \.sec-rule-line:last-child\{[^}]*to right/,
    'the left-aligned rule fades the wrong way again');
});

// ===========================================================================
// THE RING IS THE INSTRUMENT
// ---------------------------------------------------------------------------
// The circle used to carry its colour as a painted rim and nothing else, so a
// verdict the engine had earned over nine weeks and a first impression at week
// two looked identical. The founder chose this design from three mock-ups:
// "that concept is the design I want ... keep the current language & colours."
//
// THE WHOLE OF WHAT THESE GUARD is that the ring reports evidence the engine
// actually has. The reference it came from put a number on every ring -- "82%
// SCORE", "CTL 68", "HRV +6ms", "Readiness 8.4/10" -- and Valhalla computes
// none of those; two would need health data the athlete may never have
// granted. A ring that cannot be derived stays solid rather than being filled
// with a figure nobody measured.
// ===========================================================================
test('RING: a reading is dashed from the report, never from the word it shows', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  const byKey = {};
  a.readingSections(report).forEach(s => { byKey[s.key] = s; });

  /* Every section answers the question, including readiness, which is the
     hero gauge rather than a circle -- so the flag cannot be half-present. */
  ['readiness', 'recovery', 'evolution', 'patterns', 'adaptation'].forEach(k => {
    assert.equal(typeof byKey[k].learning, 'boolean',
      k + ' does not say whether its reading is settled');
  });

  /* READ FROM THE REPORT. evolution's flag must follow the engine's own
     confidence, which is the strongest form of "not read off the copy": the
     displayed word does not change here, and the flag does. */
  assert.equal(byKey.evolution.learning, report.evolution.confidence === 'insufficient',
    'the evolution ring is not following the engine’s confidence');
  /* TWO-SIDED, BECAUSE ONE SIDE PROVES NOTHING HERE. The fixture's block is
     already LEARNING, so an assertion against the live report is satisfied
     by a flag hard-coded to true -- which is exactly what a mutation run
     showed. readingSections() takes the report as an argument, so both
     states can be put to it directly. */
  const withBlock = st => a.readingSections(Object.assign({}, report, { block: st }))
    .filter(x => x.key === 'adaptation')[0].learning;
  assert.equal(withBlock({ state: 'LEARNING', dimensions: [] }), true,
    'a block still learning is drawn as a settled reading');
  assert.equal(withBlock({ state: 'ADAPTING', dimensions: [] }), false,
    'a block that has adapted is still drawn as gathering');
  assert.equal(withBlock(null), true, 'no block at all is drawn as a settled reading');
  /* Recovery reads this week's own flags, which exist from the first session,
     so it is never gathering. */
  assert.equal(byKey.recovery.learning, false, 'recovery has become a learning reading');

  /* AND THE FLAG IS NOT THE DISPLAYED WORD. Change the word, the flag holds. */
  const before = byKey.evolution.learning;
  const realMeta = a.EVOLUTION_META;
  assert.equal(a.readingSections(report).filter(s => s.key === 'evolution')[0].learning, before,
    'the evolution flag moved without the report moving');
});

test('RING: the words and the ring count the same evidence', () => {
  /* responsePatternsSummary() states the patterns reading and
     responsePatternsLearning() says whether it is settled. They share one
     counter on purpose -- a second loop over SESSION_FAMILIES is how the
     word and the ring would come to disagree. */
  const a = planHQ();
  assert.equal(typeof a.responsePatternCounts, 'function',
    'the shared family counter is gone, so the two readers can drift');
  const m = a.coachAnalyse().response;
  [0, 3].forEach(noted => {
    const learning = a.responsePatternsLearning(m, noted);
    const summary = a.responsePatternsSummary(m, noted);
    /* The summary's last branch is the only one that reports no personal
       evidence; if the ring says gathering, the words must be on it. */
    if (learning) assert.ok(!/established|emerging|noted/.test(summary),
      'the ring says gathering and the words claim evidence: ' + summary);
    else assert.match(summary, /established|emerging|noted/,
      'the ring says settled and the words have nothing to show: ' + summary);
  });
});

test('RING: Progress is the only arc, and it draws to its own percentage', () => {
  const a = planHQ();
  /* THE FIXTURE'S PROGRESS IS 0%, AND AN ARC AT ZERO PROVES NOTHING -- a
     mutation halving every fraction passed this test untouched. Log enough
     of the block to move the number first, and assert it really did move. */
  (a.state.days || []).forEach((d, i) => {
    if (d.type !== 'rest' && i % 2 === 0) { d.completed = true; d.actual = { km: d.km }; }
  });
  const moved = parseFloat(String(a.recordFacts().filter(f => f.key === 'progress')[0].big));
  assert.ok(moved > 5 && moved < 95,
    'progress is ' + moved + '% -- the arc has to be partial for this to discriminate');
  const html = a.renderValhallaInstruments();
  const arcs = html.match(/stroke-dashoffset="[\d.]+"/g) || [];
  assert.equal(arcs.length, 1,
    'expected exactly one drawn arc -- Progress is the only reading in the grid ' +
    'with a real proportion behind it, and an arc over a word is an invented figure');

  /* THE ARC AND THE NUMBER COME FROM ONE PLACE. statusFactFraction() reads
     the fact's own value, so they cannot disagree; this proves it by doing
     the arithmetic back from the markup. */
  const facts = {}; a.recordFacts().forEach(f => { facts[f.key] = f; });
  const pct = parseFloat(String(facts.progress.big).replace('%', ''));
  const R = 46, C = 2 * Math.PI * R;
  const off = parseFloat(/stroke-dashoffset="([\d.]+)"/.exec(arcs[0])[1]);
  assert.ok(Math.abs((1 - off / C) * 100 - pct) < 0.5,
    'the Progress arc is drawn at ' + ((1 - off / C) * 100).toFixed(1) +
    '% while the face reads ' + pct + '%');
});

test('RING: nothing measured is drawn as gathering, not as a complete reading', () => {
  const a = planHQ();
  const facts = {}; a.recordFacts().forEach(f => { facts[f.key] = f; });
  assert.ok(facts.fitness.none, 'the fixture has a measured fitness, so this proves nothing');
  const html = a.renderValhallaInstruments();
  const fitness = /<button[^>]*data-record="fitness"[\s\S]*?<\/button>/.exec(html)[0];
  assert.match(fitness, /is-learning/,
    '"Nothing measured" is drawn as a closed ring, which says the reading is settled');
});

test('RING: no metric Valhalla does not compute has been invented for it', () => {
  /* The reference this was drawn from carried CTL, HRV and a readiness score
     out of ten. None is computed here and two would need health data the
     athlete may never have granted, so none of them may appear on the ring
     or in the face beside it. */
  const a = planHQ();
  const html = a.renderValhallaInstruments();
  [/\bCTL\b/, /\bHRV\b/, /\bATL\b/, /\/10\b/, /\bSCORE\b/i].forEach(re =>
    assert.doesNotMatch(html, re,
      'an invented physiological metric has reached the Valhalla grid: ' + re));
});

test('RING: the painted rim comes off only where the ring replaces it', () => {
  /* .b-dial draws its edge as a gradient BACKGROUND, which can only ever be a
     complete circle of one colour -- an arc and a dashed ring cannot be drawn
     that way. The grid drops it; the panel heroes keep it, because there the
     circle restates the verdict the athlete just pressed and has no evidence
     state to report. */
  assert.match(BARE, /\.b-grid \.b-dial\{[^}]*background:none/,
    'the painted rim is back under the ring in the grid');
  assert.match(BARE, /\n  \.b-dial\{[^}]*background:linear-gradient/,
    'the painted rim has been taken off every dial, including the panel heroes');
  const a = planHQ();
  const sec = a.readingSections(a.coachAnalyse()).filter(s => s.key === 'recovery')[0];
  assert.doesNotMatch(a.readingDialHtml(sec, 0, true), /rd-ring/,
    'a panel hero has grown an evidence ring, which reports on a verdict rather than stating it');
});

// ===========================================================================
// THE SIX COLOURS ARE LOCKED
// ---------------------------------------------------------------------------
// The founder named each instrument and its reason: evolution green (growth),
// adaptation blue (learning/change), fitness cherry (training state), progress
// gold (advancement), recovery cyan (fresh/restored), patterns white
// (observation, no judgement either way). Five were already these; recovery
// moved off --gold-bright, which Progress also wears.
// ===========================================================================
test('COLOUR: each instrument wears its own named token, and no two share one', () => {
  const a = planHQ();
  const EXPECT = {
    evolution:  'var(--z-easy)',     // green
    adaptation: 'var(--z-mp)',       // blue
    fitness:    'var(--cherry)',     // cherry
    progress:   'var(--gold-bright)',// gold
    recovery:   'var(--cyan)',       // cyan
    patterns:   'var(--ink)'         // white / neutral
  };
  Object.keys(EXPECT).forEach(k => {
    const got = a.READING_ACCENT[k] || a.STATUS_ACCENT[k];
    assert.equal(got, EXPECT[k], k + ' is no longer ' + EXPECT[k]);
  });
  /* THE SIX IN THE GRID ARE SIX DIFFERENT COLOURS. Recovery and Progress
     were both --gold-bright before this, which is the thing being fixed --
     so the set is asserted distinct rather than only item by item. */
  const used = Object.keys(EXPECT).map(k => EXPECT[k]);
  assert.equal(new Set(used).size, 6,
    'two instruments in the grid share a colour: ' + used.join(' '));
  /* And the cyan is a colour of its own, not the adaptation blue again. */
  assert.match(BARE, /--cyan:#[0-9A-Fa-f]{6}/, '--cyan is not declared');
  const cyan = /--cyan:(#[0-9A-Fa-f]{6})/.exec(BARE)[1].toLowerCase();
  const blue = /--z-mp:(#[0-9A-Fa-f]{6})/.exec(BARE)[1].toLowerCase();
  assert.notEqual(cyan, blue, 'recovery and adaptation resolve to the same blue');
});

test('COLOUR: recovery stays cyan whatever the engine says about it', () => {
  /* THE RIM IS AN IDENTITY, NOT A VERDICT -- the law this screen has carried
     since colour stopped being the circles' verdict channel. The founder
     asked for recovery to behave differently BY STATE; what changes is the
     ring's motion, never its colour, or a fresh athlete and a strained one
     would be told apart by hue and the identity would be gone. */
  const a = planHQ();
  const base = r => {
    const sec = a.readingSections(r).filter(s => s.key === 'recovery')[0];
    return a.dialAccentBase(sec);
  };
  ['fresh', 'watch', 'strained'].forEach(st => {
    const r = a.coachAnalyse(); r.recovery.state = st;
    assert.equal(base(r), 'var(--cyan)', 'recovery changed colour when it went ' + st);
  });
});

// ===========================================================================
// RECOVERY CIRCULATES
// ---------------------------------------------------------------------------
// Founder: "cyan, with the small gap slowly travelling around the
// circumference. Almost like breathing/circulation ... I'd even let Recovery
// behave differently by state ... but only if those states genuinely exist in
// the engine -- don't invent them for the animation."
// ===========================================================================
test('MOTION: the ring has one behaviour per state the engine actually returns', () => {
  const a = planHQ();
  /* THE ENGINE'S THREE, read from the section rather than from the word it
     displays. A fourth variant in the sheet would mean a state was invented
     for the animation, which is the thing the founder ruled out. */
  const STATES = ['fresh', 'watch', 'strained'];
  STATES.forEach(st => {
    const r = a.coachAnalyse(); r.recovery.state = st;
    assert.equal(a.readingSections(r).filter(s => s.key === 'recovery')[0].state, st,
      'the recovery section does not carry the engine state ' + st);
  });
  /* THE RENDERER EMITS ONE PER STATE... */
  STATES.forEach(st => {
    const r = a.coachAnalyse(); r.recovery.state = st;
    const sec = a.readingSections(r).filter(s => s.key === 'recovery')[0];
    assert.match(a.dialRingHtml('solid', null, 'is-rec-' + sec.state), /is-rec-/ ,
      'the ring takes no variant for ' + st);
  });
  /* ...AND THE SHEET STYLES NO OTHER. strained deliberately has no rule of
     its own -- it falls through to the plain closed ring, which IS its
     behaviour -- so this is a subset check, not an equality. An empty rule
     added to make the two lists match would be a rule that styles nothing. */
  const variants = [...new Set([...BARE.matchAll(/\.rd-arc\.is-rec-([a-z]+)/g)].map(m => m[1]))];
  assert.ok(variants.length, 'recovery has no state styling at all');
  variants.forEach(v => assert.ok(STATES.indexOf(v) !== -1,
    'the sheet styles a recovery state the engine never returns: ' + v));
});

test('MOTION: only Fresh moves, and it moves as circulation rather than a pulse', () => {
  const anim = sel => {
    const m = new RegExp('\\' + sel + '\\{([^}]*)\\}').exec(BARE);
    return m ? m[1] : '';
  };
  assert.match(anim('.b-grid .rd-arc.is-rec-fresh'), /animation:rd-circulate/,
    'the fresh recovery ring has stopped circulating');
  ['.b-grid .rd-arc.is-rec-watch', '.b-grid .rd-arc.is-rec-strained'].forEach(sel =>
    assert.doesNotMatch(anim(sel), /animation:/, sel + ' is moving; only Fresh may'));

  /* LINEAR AND SLOW, which is what separates circulation from a throb. */
  const fresh = anim('.b-grid .rd-arc.is-rec-fresh');
  assert.match(fresh, /linear/, 'the circulation has taken an easing curve and now pulses');
  const secs = parseFloat(/animation:rd-circulate ([\d.]+)s/.exec(fresh)[1]);
  assert.ok(secs >= 10, 'a lap takes ' + secs + 's -- under ten it reads as a spinner');

  /* ONE LAP IS EXACTLY ONE CIRCUMFERENCE, or the gap jumps on repeat. */
  const kf = /@keyframes rd-circulate\{([^}]*)\}/.exec(BARE)[1];
  const off = Math.abs(parseFloat(/stroke-dashoffset:(-?[\d.]+)/.exec(kf)[1]));
  const C = 2 * Math.PI * 46;
  assert.ok(Math.abs(off - C) < 0.5,
    'a lap travels ' + off + ' against a circumference of ' + C.toFixed(1) +
    ' -- the gap will jump each time the animation repeats');
});

test('MOTION: the break is the 320-340 degrees that was asked for', () => {
  const rule = /\.b-grid \.rd-arc\.is-rec-fresh,\s*\n\s*\.b-grid \.rd-arc\.is-rec-watch\{([^}]*)\}/.exec(BARE);
  assert.ok(rule, 'the recovery gap rule is gone');
  const m = /stroke-dasharray:([\d.]+) ([\d.]+)/.exec(rule[1]);
  assert.ok(m, 'the recovery ring no longer states its gap');
  const drawn = parseFloat(m[1]), gap = parseFloat(m[2]);
  const C = 2 * Math.PI * 46;
  assert.ok(Math.abs(drawn + gap - C) < 1,
    'the dash and the gap do not add up to the circumference, so the ring repeats mid-lap');
  const deg = drawn / C * 360;
  assert.ok(deg >= 320 && deg <= 340,
    'the ring is drawn through ' + deg.toFixed(1) + ' degrees; the founder asked for 320-340');
  /* STRAINED HAS NO GAP AT ALL -- a closed ring, which is the third state and
     the reason the gap can carry three without a fourth being invented. */
  assert.doesNotMatch(BARE, /\.rd-arc\.is-rec-strained\{[^}]*stroke-dasharray/,
    'the strained ring has grown a gap, so it reads as watch standing still');
});

// ===========================================================================
// PROGRESS LAYS ITSELF DOWN
// ---------------------------------------------------------------------------
// The one instrument in the grid with a real proportion is the one worth
// drawing to it. This is the confidence gauge's entrance reused, not a second
// one -- and gated the same way, for the reason the gauge's own comment
// records measuring: declared on the element it replays on every renderApp().
// ===========================================================================
test('DRAW: the Progress arc states both its ends, so it is right without the animation', () => {
  const a = planHQ();
  (a.state.days || []).forEach((d, i) => {
    if (d.type !== 'rest' && i % 2 === 0) { d.completed = true; d.actual = { km: d.km }; }
  });
  const html = a.renderValhallaInstruments();
  const arc = /<circle class="rd-arc"[^>]*>/.exec(html)[0];
  const attr = parseFloat(/stroke-dashoffset="([\d.]+)"/.exec(arc)[1]);
  const to   = parseFloat(/--rd-to:([\d.]+)/.exec(arc)[1]);
  const len  = parseFloat(/--rd-len:([\d.]+)/.exec(arc)[1]);
  /* THE RESTING VALUE AND THE ANIMATION'S DESTINATION ARE THE SAME NUMBER.
     Stated twice on purpose: one of them has to survive a browser that
     never runs the keyframe, and if they ever disagree the arc would snap
     to a different figure the moment the entrance finished. */
  assert.equal(attr, to, 'the arc rests at ' + attr + ' and animates to ' + to);
  assert.ok(Math.abs(len - 2 * Math.PI * 46) < 0.5,
    '--rd-len is not the circumference, so the entrance starts part-drawn');
});

test('DRAW: the entrance is gated, not declared on the element', () => {
  /* THE BUG THIS PREVENTS IS RECORDED, MEASURED, in the confidence gauge's
     own comment: declared straight on the element, the gauge re-filled from
     zero whenever anything on the page redrew -- 33ms into a 1140ms draw
     after an ordinary renderApp() with nothing changed. */
  assert.doesNotMatch(BARE, /\.b-grid \.rd-arc\{[^}]*animation:rd-draw/,
    'the entrance is declared on the arc itself, so it replays on every render');
  assert.match(BARE, /\.b-grid \.b-dial\.is-drawing \.rd-arc\{[^}]*animation:rd-draw/,
    'the entrance is no longer behind a class');
  assert.match(SRC, /function animateProgressRing\(/, 'nothing adds the class after render');
  assert.match(SRC, /\n  animateProgressRing\(\);/,
    'animateProgressRing is never called, so the entrance never plays');
  /* KEYED, so switching tabs and back does not re-lay a figure that has not
     moved -- the same guard the other three instruments carry. */
  const fn = SRC.slice(SRC.indexOf('function animateProgressRing('),
                       SRC.indexOf('function animateConfidenceGauge('));
  /* THE GUARD, NOT THE NAME. This asked only that progressRingLastKey be
     mentioned, and the identifier also appears in the two early returns
     that clear it -- so deleting the comparison entirely left the test
     passing, which a mutation run showed. What has to exist is the
     early-out itself and the assignment that arms it. */
  assert.match(fn, /if \(key === progressRingLastKey\) return;/,
    'the entrance no longer bails when the figure has not moved, so it replays on every render');
  assert.match(fn, /progressRingLastKey = key;/,
    'the key is never stored, so the guard above can never match');
  assert.match(fn, /void dial\.offsetWidth/,
    'the class is re-added without a reflow, so the animation will not restart');
});

test('DRAW: it is the gauge’s entrance, and nothing else in the grid has one', () => {
  /* ONE ENTRANCE, NOT A SECOND THAT RESEMBLES IT. Same duration token, same
     easing as the confidence gauge and the session ring. */
  const rule = /\.b-grid \.b-dial\.is-drawing \.rd-arc\{([^}]*)\}/.exec(BARE)[1];
  assert.match(rule, /var\(--ring-draw\)/,
    'the Progress entrance has invented a duration of its own');
  const gauge = /\.gauge-wrap\.is-drawing \.gauge-fill\{([^}]*)\}/.exec(BARE)[1];
  const ease = /cubic-bezier\([^)]*\)/.exec(gauge)[0];
  assert.ok(rule.indexOf(ease) > -1,
    'the Progress entrance eases differently from the gauge it borrows');

  /* AND ONLY PROGRESS. A dashed ring has no proportion to lay down, and six
     entrances at once is a screen with no focal point. */
  const a = planHQ();
  const html = a.renderValhallaInstruments();
  const drawn = (html.match(/--rd-to:/g) || []).length;
  assert.equal(drawn, 1,
    'expected exactly one ring with an entrance; found ' + drawn);
  assert.match(/<button[^>]*data-record="progress"[\s\S]*?<\/button>/.exec(html)[0],
    /--rd-to:/, 'the ring that draws in is not Progress');
});
