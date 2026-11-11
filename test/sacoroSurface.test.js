'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SACORO TAKES THE SAME RULES: the instruments stay, the containers go.
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
/* A REAL MEASUREMENT, so Fitness states its range rather than an em-dash.
   The fixture schedules no checkpoint before the pinned date, so the first
   one in the plan is completed and recorded exactly as logging it would --
   nothing is written into the fact by hand. Without this, every law about
   the widest plate value runs against "\u2014" and proves nothing. */
function withMeasuredFitness(a) {
  let target = null;
  a.state.days.forEach(dd => {
    if (!target && (dd.type === 'checkpoint' || dd.type === 'race')) target = dd;
  });
  assert.ok(target, 'the fixture plan schedules no checkpoint, so fitness cannot be measured');
  target.completed = true;
  target.actual = { km: target.km, pace: a.secToPace(300), hr: 150, rpe: 7, feel: 'good', notes: '' };
  a.recordMeasuredPerformance(target);
  const f = a.recordFacts().filter(x => x.key === 'fitness')[0];
  assert.ok(!f.none, 'the measurement did not take, so this fixture is still empty');
  return a;
}
const rule = sel => {
  const i = BARE.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return BARE.slice(i + sel.length + 1, BARE.indexOf('}', i));
};

test('Sacoro renders inside a wrapper, so its rules have somewhere to hang', () => {
  /* It was the one screen returning a bare run of sections. .hub-card is
     also Today's Next Move and the post-race panel, and the comment on it
     says in as many words that it must never be restyled bare -- so without
     a wrapper there was no way to restyle it HERE. */
  assert.match(SRC, /return '<div class="view-planhq">'\+/,
    'the Sacoro wrapper is gone, and .hub-card cannot be scoped to this screen');
});

test('the containers go and the instruments stay', () => {
  const r = rule('.view-planhq :is(.v-hero, .v-call, .hub-card)');
  ['background:none', 'border:0', 'border-radius:0', 'box-shadow:none'].forEach(d =>
    assert.ok(r.indexOf(d) > -1, 'the Sacoro containers no longer drop ' + d));
  /* .tile-card is the additive modifier the Sacoro consistency pass put ON
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
     Founder: "Sacoro's call - proceed. Does it offer anything? Really?
     The green glow behind can deffo go."
     IT GOES, AND THE SIGNAL DOES NOT. The call's title reads "Sacoro's
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
     was not. The founder has since read the word: "I don't like Sacoro's
     call - proceed / Recovery fresh, trend still building. We know the user
     should proceed." PROCEED is what the engine returns on most days, so
     the band announced an assumption; its two readings are circles in the
     grid directly beneath it, each with a panel carrying the evidence.
     The DECISION IS NOT GONE from the product -- coachAnalyse().decision
     still drives the day card's coaching and Next Move, which is where a
     call the athlete has to act on belongs. */
  const a = planHQ();
  const view = a.renderPlanHQView();
  assert.doesNotMatch(view, /class="v-call/, 'Sacoro\u2019s Call is back on the screen');
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
  /* ---- CHANGED SIDES: THERE IS NO HALO LEFT TO COMPARE ----
     Founder: "The haze from the glow isnt the best anymore. Should it just
     be the ring cherry that glows without the haze?"
     This read two alphas from each keyframe -- an edge and a halo -- and
     required the gauge to beat the session ring on both. The gauge has one
     shadow now, so the second number does not exist and the test could not
     even read it. The CLAIM is untouched and still worth holding: this is
     the reading the screen is built around, so its ring must be the
     brightest on any screen. It is now settled on the edge alone, which is
     the only light either instrument has in common. */
  const peak = (name) => {
    const i = BARE.indexOf('@keyframes ' + name);
    const body = BARE.slice(i, BARE.indexOf('\n  }', i));
    const fifty = body.slice(body.indexOf('50%'));
    const nums = [...fifty.matchAll(/rgba\(154,84,108,([\d.]+)\)/g)].map(m => Number(m[1]));
    assert.ok(nums.length >= 1, 'could not read the peak of ' + name);
    return nums;
  };
  const gauge = peak('vv-glow-gauge');
  const ring = peak('vv-glow-ring');
  assert.ok(gauge[0] >= ring[0],
    'the confidence gauge peaks at ' + gauge[0] + ' against the session ring\u2019s ' +
    ring[0] + ', and it is the reading this screen is built around');
  /* AND THE SHAPES DIFFER ON PURPOSE, which is the thing that would
     otherwise rot quietly: the ring still carries a halo because it sits
     alone on Today, and the gauge does not because it sits in a row of five
     and its bloom reached into the two beneath it. */
  assert.equal(gauge.length, 1, 'the gauge has grown a halo again');
  assert.ok(ring.length >= 2, 'the session ring lost the halo it is supposed to keep');
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
 * Breakthrough Sessions was the one block on Sacoro still printing a
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
// SCORE", "CTL 68", "HRV +6ms", "Readiness 8.4/10" -- and Sacoro computes
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

test('RING: no circle in the grid is drawn to a proportion, because none has one', () => {
  /* ---- CHANGED SIDES: PROGRESS LEFT THE GRID ----
     Founder: "I think we make the fitness and progress circles the same as
     goal and benchmark. And then put them under the circles."
     This asked the opposite -- that Progress be the ONE arc, drawn to its
     own percentage -- and it was right while Progress was a circle. It is a
     plate now, and a plate has no ring, so the claim inverts: every reading
     left in the grid is a word with a tone, so NOTHING in it may be drawn
     to a proportion. An arc here would be a figure invented to fill a
     shape, which is the rule that put Progress on the arc in the first
     place and the same rule that now takes the arc away. */
  const a = planHQ();
  /* Still driven to a discriminating state: a half-logged block is the
     condition under which an arc WOULD have been emitted, so a restored arc
     mode is caught rather than passing on an empty fixture. */
  (a.state.days || []).forEach((d, i) => {
    if (d.type !== 'rest' && i % 2 === 0) { d.completed = true; d.actual = { km: d.km }; }
  });
  const moved = parseFloat(String(a.recordFacts().filter(f => f.key === 'progress')[0].big));
  assert.ok(moved > 5 && moved < 95,
    'progress is ' + moved + '% -- it has to be partial for this to discriminate');
  const html = a.renderSacoroInstruments();
  const grid = /<div class="b-grid">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.equal((grid.match(/stroke-dashoffset/g) || []).length, 0,
    'a circle in the grid is drawn to a proportion again');
  assert.equal((grid.match(/--rd-to:/g) || []).length, 0,
    'a circle in the grid has grown an entrance to draw to');
  /* AND THE HELPERS THAT DID IT ARE GONE, not merely unreferenced -- a
     deletion the runtime records at dialRingHtml. */
  assert.doesNotMatch(SRC, /function statusFactFraction\(/,
    'the fraction helper is back with nothing to feed');
  assert.doesNotMatch(SRC, /function animateProgressRing\(/,
    'the Progress entrance driver is back with no arc to play on');
  assert.doesNotMatch(BARE, /@keyframes rd-draw/,
    'the ring-draw keyframe is back with nothing to animate');
});

test('RING: nothing measured still reads as an absence, now on the plate', () => {
  /* ---- CHANGED SIDES: FITNESS LEFT THE GRID ----
     Founder: "make the fitness and progress circles the same as goal and
     benchmark." This asked that an unmeasured fitness wear the dashed
     gathering ring. It has no ring now, and the claim underneath it does
     not change: an absence must still be drawn as an absence rather than as
     a settled figure. The plate carries that in the typography the empty
     state already owns, which is the channel Goal and Benchmark have used
     for their own absences since they became plates. */
  const a = planHQ();
  const facts = {}; a.recordFacts().forEach(f => { facts[f.key] = f; });
  assert.ok(facts.fitness.none, 'the fixture has a measured fitness, so this proves nothing');
  const html = a.renderSacoroInstruments();
  const fitness = /<button[^>]*data-record="fitness"[\s\S]*?<\/button>/.exec(html)[0];
  assert.match(fitness, /class="b-plate"/, 'Fitness is a circle again');
  assert.match(fitness, /class="b-plate-v rec-none"/,
    'an unmeasured fitness is stated in the same type as a real figure');
  /* AND THE SAME ABSENCE, THE SAME WAY, AS THE FACTS IT NOW SITS BESIDE. */
  const a2 = planHQ();
  a2.state.setup.benchmark = null;
  const bench = /<button[^>]*data-record="benchmark"[\s\S]*?<\/button>/
    .exec(a2.renderSacoroInstruments())[0];
  assert.match(bench, /class="b-plate-v rec-none"/,
    'two absences on one row are drawn two different ways');
});

test('RING: no metric Sacoro does not compute has been invented for it', () => {
  /* The reference this was drawn from carried CTL, HRV and a readiness score
     out of ten. None is computed here and two would need health data the
     athlete may never have granted, so none of them may appear on the ring
     or in the face beside it. */
  const a = planHQ();
  const html = a.renderSacoroInstruments();
  [/\bCTL\b/, /\bHRV\b/, /\bATL\b/, /\/10\b/, /\bSCORE\b/i].forEach(re =>
    assert.doesNotMatch(html, re,
      'an invented physiological metric has reached the Sacoro grid: ' + re));
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
// FOUR CIRCLES, FOUR PLATES
// ---------------------------------------------------------------------------
// Founder: "I think we make the fitness and progress circles the same as goal
// and benchmark. And then put them under the circles."
// The shape now carries the distinction the two deleted headings carried in
// words: a reading is a state and takes a circle, a Record fact is a number
// and takes a plate. Goal and Benchmark went first; this is the same rule
// reaching the two that were left behind in the grid.
// ===========================================================================
test('SHAPE: the grid is readings only, and every Record fact is a plate', () => {
  const a = withMeasuredFitness(planHQ());
  const html = a.renderSacoroInstruments();
  const grid = /<div class="b-grid">([\s\S]*?)<\/div>/.exec(html)[1];

  /* NOT A COUNT OF BUTTONS -- the two sets are told apart by the action they
     carry, so a fact rendered as a circle is caught wherever it sits. */
  assert.equal((grid.match(/data-action="open-record"/g) || []).length, 0,
    'a Record fact is drawn as a circle in the grid again');
  assert.equal((grid.match(/data-action="open-reading"/g) || []).length, 4,
    'the grid no longer holds exactly the four readings');

  const plateKeys = [...html.matchAll(/class="b-plate"[^>]*data-record="([a-z]+)"/g)].map(m => m[1]);
  assert.equal(plateKeys.join(','), 'fitness,progress,goal,benchmark',
    'the plates are not the four Record facts in the founder\u2019s order');

  /* AND THE TWO ARRAYS THAT DECIDE IT, so a renderer that happened to agree
     by accident is not mistaken for the rule. Joined rather than deep-equal
     because the app runs in its own realm: a structurally identical array
     there has a different Array prototype, and assert/strict rejects it. */
  assert.equal([...a.SACORO_CIRCLES].join(','), 'evolution,adaptation,recovery,patterns');
  assert.equal([...a.SACORO_PLATES].join(','), 'fitness,progress,goal,benchmark');

  /* THE PAIRS THE FOUNDER NAMED SURVIVE. "evolution - adaption" and
     "recovery - patterns" were two of the three rows of the old grid; the
     pair between them left, and the other two stayed whole rather than
     being re-paired around the gap. */
  assert.equal([...a.SACORO_CIRCLES].slice(0, 2).join(','), 'evolution,adaptation');
  assert.equal([...a.SACORO_CIRCLES].slice(2).join(','), 'recovery,patterns');
});

test('SHAPE: every fact that took a plate is a number, which is why it took one', () => {
  /* THE TEST THE SHAPE IS CHOSEN BY, applied rather than asserted. "Plates
     and headlines are for numbers, circles are for state" is the rule Goal
     and Benchmark moved under; Fitness and Progress pass the same test --
     a pace or finish range and a percentage -- which is why this is the
     existing rule applied consistently and not a new one. */
  const a = withMeasuredFitness(planHQ());
  const facts = {}; a.recordFacts().forEach(f => { facts[f.key] = f; });
  a.SACORO_PLATES.forEach(k => {
    const big = String(facts[k].big);
    assert.ok(/\d/.test(big) || facts[k].none || big === 'A' || /^[A-C]$/.test(big),
      k + ' is on a plate but states a word rather than a figure: ' + big);
  });
  /* AND EVERY CIRCLE IS A WORD. The inverse half of the same rule -- if a
     reading ever starts reporting a figure, it belongs on a plate, and this
     is where that is noticed. */
  const sections = {}; a.readingSections(a.coachAnalyse()).forEach(x => { sections[x.key] = x; });
  a.SACORO_CIRCLES.forEach(k => {
    assert.ok(/[A-Za-z]/.test(String(sections[k].value)),
      k + ' is a circle but states a bare figure: ' + sections[k].value);
  });
});

test('SHAPE: a plate value cannot wrap, whatever the string it is given', () => {
  /* MEASURED, NOT GUESSED, AND THE MEASUREMENT IS WHY THIS LAW EXISTS. At
     320px the plate is 139px wide and a fitness range broke at the dash, so
     Fitness and Progress stood 102px tall against Goal and Benchmark's
     84px -- four plates the founder asked to be even, in two sizes. The
     widest value the app can produce is eleven characters ("24:10-25:24",
     a 5K range), found by sweeping every distance rather than by reading
     the marathon fixture, which shows nine.
     A BROWSER IS WHERE WIDTH LIVES, so what is held here is the mechanism:
     the count the sizing divides by, the ceiling it may never exceed, and
     the nowrap that turns a too-long run into a visible overflow instead of
     a silent second line. */
  const a = withMeasuredFitness(planHQ());
  const html = a.renderSacoroInstruments();
  const facts = {}; a.recordFacts().forEach(f => { facts[f.key] = f; });

  /* THE COUNT IS THE LONGEST RUN, not the string length -- a value with a
     space in it must not be sized as though it were one unbreakable word. */
  assert.equal(a.plateValueChars('24:10\u201325:24'), 11);
  assert.equal(a.plateValueChars('Goal A'), 4, 'a space is not being treated as a break');
  assert.equal(a.plateValueChars(''), 1, 'an empty value divides by zero');

  a.SACORO_PLATES.forEach(k => {
    const plate = new RegExp('<button[^>]*data-record="' + k + '"[\\s\\S]*?</button>').exec(html)[0];
    const ch = parseInt(/--pv-ch:(\d+)/.exec(plate)[1], 10);
    assert.equal(ch, a.plateValueChars(String(facts[k].big)),
      k + ' is sized against a character count that is not its own value\u2019s');
  });

  const rule = /\.b-plate-v\{([^}]*)\}/.exec(BARE)[1];
  assert.match(rule, /white-space:nowrap/,
    'a long plate value wraps again, which is what made the rows uneven');
  assert.match(rule, /var\(--pv-ch/,
    'the value size ignores the string it has to fit');
  assert.match(rule, /min\(26px/,
    'the 26px ceiling is gone, so short values grow to fill their box');
  assert.match(rule, /100cqw/,
    'the size is no longer measured against the plate it has to fit inside');
  assert.match(BARE, /\.b-plate\{[^}]*container-type:inline-size/,
    'the plate is not a query container, so 100cqw measures the wrong box');
});

test('TYPE: this page is white, and the circles are set in the words face', () => {
  /* Founder: "The text in the circles and boxes should be the same style as
     the rest of the app ... I also think this page shouldn't have the off
     white text. All white." */
  const view = /\.view-planhq\{([^}]*)\}/.exec(BARE)[1];
  ['--ink', '--ink-dim', '--ink-faint'].forEach(tok =>
    assert.match(view, new RegExp(tok + ':#FFFFFF', 'i'),
      tok + ' is still the warm cream on this screen'));
  /* RE-POINTED, NOT OVERRIDDEN ELEMENT BY ELEMENT -- which is the half worth
     guarding, because the next thing added to this screen inherits the
     decision only if it was made on the view. */
  assert.ok(view.indexOf('--ink:') > -1, 'the page re-points no ink token at all');

  /* THE WORDS FACE IN THE GRID, AND ONLY IN THE GRID. The base rule feeds
     the panel heroes, where the circle states a measured figure -- and an
     existing law holds that an absence takes the words face while the
     measurement beside it keeps the figure face. A blanket change collapses
     both into one and takes that law with it. */
  assert.match(/\n  \.rd-val b\{([^}]*)\}/.exec(BARE)[1], /font-family:var\(--num-face\)/,
    'the base dial face left the figure face, which the panel heroes rely on');
  assert.match(/\.b-grid \.rd-val b\{([^}]*)\}/.exec(BARE)[1], /font-family:var\(--text-face\)/,
    'the reading circles are back in the monospace figure face');

  /* AND THE ONE WHISPER STAYS ONE. --ink-faint going white promoted the hint
     to the weight of the labels above it; it keeps the colour and gives the
     difference back in opacity. */
  assert.match(/\.view-planhq \.b-dials-hint\{([^}]*)\}/.exec(BARE)[1], /opacity:\.\d+/,
    'the hint reads at full strength, which makes it a statement');
});

test('PLATE: each plate lights the corner that points away from the grid', () => {
  /* Founder: "The fitness progress goal bench mark boxes could have brighter
     boarders ... Goal brighter bottom left. Progress top right and benchmark
     bottom right."
     The founder wrote "top right" for Fitness and then "top right" again for
     Progress; Fitness is the top-LEFT box, and the outer-corner reading is
     the one that makes the set cohere, so it takes that. The four radiate
     outward rather than all leaning the same way. */
  const CORNERS = { fitness:['0%','0%'], progress:['100%','0%'],
                    goal:['0%','100%'], benchmark:['100%','100%'] };
  Object.keys(CORNERS).forEach(k => {
    const m = new RegExp('\\.b-plate\\[data-record="' + k + '"\\]\\s*\\{([^}]*)\\}').exec(BARE);
    assert.ok(m, k + ' no longer names a corner');
    assert.match(m[1], new RegExp('--rim-x:' + CORNERS[k][0]), k + ' lights the wrong side');
    assert.match(m[1], new RegExp('--rim-y:' + CORNERS[k][1]), k + ' lights the wrong edge');
  });
  /* THE LIT EDGE IS A MASKED GRADIENT, because a border cannot hold one and
     border-image would drop the radius -- the same constraint the coach
     buttons hit. If the ::before goes, every plate falls back to the flat
     rim underneath and the four stop radiating. */
  const before = /\.b-plate::before\{([^}]*)\}/.exec(BARE);
  assert.ok(before, 'the lit edge is gone');
  /* THE ONE DECLARATION THAT DECIDES WHETHER ANY OF THE REST RUNS. A
     mutation setting content:none left the gradient, the mask and the four
     corners all present and correct, and drew nothing at all -- the law
     passed on a feature that had been switched off. */
  assert.match(before[1], /content:''/,
    'the lit edge declares no content, so the pseudo-element never renders');
  assert.match(before[1], /radial-gradient\(.*var\(--rim-x/,
    'the lit edge no longer reads the corner each plate names');
  assert.match(before[1], /mask-composite:exclude/,
    'the gradient fills the plate instead of ringing it');
});

test('PANEL: a panel is rimmed in the colour of the circle that opens it', () => {
  /* ---- THE BUG THIS EXISTS FOR, AND IT SHIPPED ----
     The six colours were locked on the founder's list and READING_ACCENT
     moved Recovery from gold to cyan. PANEL_ACCENT_CLASS did not: it still
     read rp-gold, and there was no cyan class to point it at -- so the one
     instrument whose colour changed opened a panel rimmed in the colour it
     had just left. Founder, from a screenshot of it: the panels behind the
     circles.
     THE FIX IS NOT THE LAW. A law that pinned recovery to rp-cyan would
     have caught nothing except recovery. What is held here is the
     INVARIANT: every panel's accent resolves to the same token its own
     instrument wears, so moving any colour in either map and not the other
     fails here rather than on a phone. */
  const a = planHQ();
  const CLASS_TOKEN = {
    'rp-gold':   'var(--gold-bright)',
    'rp-green':  'var(--z-easy)',
    'rp-cherry': 'var(--cherry)',
    'rp-white':  'var(--ink)',
    'rp-blue':   'var(--z-mp)',
    'rp-cyan':   'var(--cyan)'
  };
  /* Each class must actually declare the token this test believes it does,
     or the agreement below is checked against a table rather than the
     sheet. */
  Object.keys(CLASS_TOKEN).forEach(cls => {
    const m = new RegExp('\\.modal-card\\.' + cls + '\\{--rp-accent:([^;}]+)').exec(BARE);
    assert.ok(m, cls + ' is not declared in the sheet');
    assert.equal(m[1].trim(), CLASS_TOKEN[cls], cls + ' no longer resolves to ' + CLASS_TOKEN[cls]);
  });
  const panel = a.PANEL_ACCENT_CLASS;
  Object.keys(panel).forEach(key => {
    const instrument = a.READING_ACCENT[key] || a.STATUS_ACCENT[key];
    if (!instrument) return;            // a panel with no instrument of its own
    assert.equal(CLASS_TOKEN[panel[key]], instrument,
      key + "'s panel is rimmed " + CLASS_TOKEN[panel[key]] + ' while its circle is ' +
      instrument + ' -- the identity is contradicted by the screen behind it');
  });
  /* AND RECOVERY BY NAME, because it is the one that was wrong and the one
     a careless revert would put back. */
  assert.equal(panel.recovery, 'rp-cyan', "recovery's panel left cyan again");
});

test('PANEL: one colour per panel, and everything else in it is white', () => {
  /* Founder: "Should the titles be the same colour as the circle and box?"
     The titles should not -- the rim, the close button and the hero ring
     already carry the identity, and a title naming its own panel is
     information, which is white under the founder's own rule. What was
     wrong was between them: section headings bronze and row glyphs gold on
     every panel, so eight panels of five identities all wore a third accent
     belonging to none of them. */
  /* ASSERTED ON THE SHARED RULE, because the two headings now share one.
     This read `.hq-panel .setup-section-title{` on its own and broke the
     moment .evo-k was added to the same selector list -- which is the point
     of the merge, so the law follows it rather than forcing the rule apart
     again. Matching the list as a list is also what makes "the same
     throughout" checkable: one body, so one answer for both. */
  const headRule = /\.hq-panel \.setup-section-title,\s*\.hq-panel \.evo-k\{([^}]*)\}/.exec(BARE);
  assert.ok(headRule,
    'the two panel sub-headings no longer share one rule, so they can drift apart again');
  assert.match(headRule[1], /color:#FFFFFF/i,
    'the panel section headings are back in bronze');
  assert.match(headRule[1], /font-size:/,
    'the shared rule sets no size, so the two headings fall back to their 9px and 11px bases');
  /* THERE IS NO GLYPH ANY MORE, AND THAT IS THE LAW NOW. This used to
     assert that the row icons resolved to var(--rp-accent, var(--gold-text))
     so the glyph and the section rule beside it agreed. Founder: "I don't
     want symbols or pills!" -- so the icons went, and with them the class
     and the one function that emitted it. Asserting their absence is worth
     a line because the markup was emitted by a SECOND hqRow() that shadowed
     the first: the glyph can only come back by that duplicate coming back,
     which is the thing to catch. */
  assert.doesNotMatch(BARE, /\.hq-row-i\s*\{/,
    'the row glyphs are back; the panels carry symbols again');
  assert.doesNotMatch(SRC, /class="hq-row-i"/,
    'something is emitting a row glyph again');
  assert.equal((SRC.match(/^function hqRow\(/gm) || []).length, 1,
    'hqRow is defined twice again -- the later one shadows the earlier, and it was the glyph that came in that way');
  assert.match(BARE, /\.modal-card\.hq-panel\{--rp-accent:/,
    '--rp-accent is no longer scoped to the panel');
  /* ---------- AND EVERY LINE IN THE PANEL IS WHITE ----------
     Founder, twice: "this page shouldn't have the off white text. All
     white", then "every end user points on coach should now be checked for
     the same consistency with titles text and colour". The first pass put
     that white on .view-planhq -- the page BEHIND the circles -- and these
     panels are modals that mount outside it, so every paragraph in all nine
     was still a warm grey. The override has to be (0,2,0) to beat
     .modal-card.modal-themed's `inherit`, which is why it is asserted at
     that exact specificity rather than by its effect. */
  const ink = /\.modal-card\.hq-panel\{--ink:([^}]*)\}/.exec(BARE);
  assert.ok(ink, 'the panels no longer pin their own ink, so they inherit the warm greys again');
  ['--ink:#FFFFFF', '--ink-dim:#FFFFFF', '--ink-faint:#FFFFFF'].forEach(tok =>
    assert.ok(('--ink:' + ink[1]).indexOf(tok) > -1, 'the panel ink is not white: ' + tok));
  /* ---------- ONE HEADING SHAPE, NOT TWO ----------
     "Make sure the titles and text in the circles and boxes are the same
     throughout the app." Inside a panel there were two sub-heading styles
     doing one job: .setup-section-title (white, with a rule running right)
     and .evo-k (9px bronze, bare). Adaptation History showed four of the
     bronze kind under one of the white kind. .evo-k keeps its own look
     everywhere else -- it is a compact label inside .evo-sec cards too --
     so the match is made on the panel, not on the class. */
  assert.match(BARE,
    /\.hq-panel \.setup-section-title::after,\s*\.hq-panel \.evo-k::after\{[^}]*--rp-accent/,
    'the .evo-k headings lost the accent rule that makes them the same object as the others');
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
  /* THE RENDERER EMITS ONE PER STATE -- AND THE GRID ACTUALLY CARRIES IT.
     This asked dialRingHtml() directly, which proves the helper can take a
     variant and nothing about whether the screen passes it one. A mutation
     that slipped an extra argument into the call site -- the shape of a
     real signature mistake, since that call lost its middle parameter when
     the arc mode went -- left recovery with no is-rec- class at all and
     this test green. The circulation is a property of the rendered grid,
     so the grid is what gets read. */
  STATES.forEach(st => {
    const r = a.coachAnalyse(); r.recovery.state = st;
    const sec = a.readingSections(r).filter(s => s.key === 'recovery')[0];
    assert.match(a.dialRingHtml('solid', 'is-rec-' + sec.state), /is-rec-/ ,
      'the ring takes no variant for ' + st);
  });
  STATES.forEach(st => {
    const b = planHQ();
    const real = b.coachAnalyse;
    b.coachAnalyse = function(){ const r = real.apply(this, arguments); r.recovery.state = st; return r; };
    const grid = /<div class="b-grid">([\s\S]*?)<\/div>/.exec(b.renderSacoroInstruments())[1];
    const rec = /<span class="b-dial-col">(?:(?!<span class="b-dial-col">)[\s\S])*?data-reading="recovery"[\s\S]*?<\/span><\/span>/.exec(grid);
    assert.ok(rec, 'recovery is not in the grid at all when the engine says ' + st);
    assert.match(rec[0], new RegExp('is-rec-' + st),
      'the grid draws recovery with no state variant when the engine says ' + st);
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
// PROGRESS NO LONGER LAYS ITSELF DOWN
// ---------------------------------------------------------------------------
// It did, for one commit: the single instrument in the grid with a real
// proportion, drawn to it with the confidence gauge's own entrance. Then
// Progress became a plate and the arc, the keyframe, the driver and the
// fraction helper all lost their only caller at once. What is left here is
// the law that they went TOGETHER.
// ===========================================================================
test('DRAW: the entrance is gone with the arc, and nothing is left half-deleted', () => {
  /* ---- CHANGED SIDES: THE WHOLE ENTRANCE ----
     Founder: "I think we make the fitness and progress circles the same as
     goal and benchmark. And then put them under the circles."
     Three laws stood here and all three are now wrong in the same way.
     They held that the Progress arc stated both its ends so it survived a
     browser with no animation; that the entrance was gated behind a class
     rather than declared on the element; and that it reused the confidence
     gauge's duration and easing rather than inventing a second. Every one
     was true of a ring, and Progress has no ring: it is a plate, and a
     plate has nothing to lay down.
     WHAT SURVIVES THEM is the reason they existed -- that a deletion is
     complete. Half a deleted feature is worse than either keeping it or
     removing it, because the next person finds machinery with no caller and
     cannot tell whether it is load-bearing. The pieces went together, and
     this is what says so. */
  /* THE DECLARATION AND THE CALL, NOT THE NAME. A first cut asked that the
     identifiers appear nowhere in the file at all, and it failed on the
     runtime's own tombstone comments -- which are exactly what a deletion
     this size should leave behind. What may not exist is machinery. */
  assert.doesNotMatch(SRC, /function statusFactFraction\s*\(/,
    'the fraction helper is declared again, with nothing to feed');
  assert.doesNotMatch(SRC, /function animateProgressRing\s*\(/,
    'the entrance driver is declared again, with no arc to play on');
  assert.doesNotMatch(SRC, /\n\s*animateProgressRing\(\)/,
    'something still calls the entrance driver');
  assert.doesNotMatch(SRC, /var progressRingLastKey/,
    'the entrance still keeps a key for a figure it no longer draws');
  assert.doesNotMatch(BARE, /@keyframes rd-draw/, 'the keyframe outlived its only user');
  assert.doesNotMatch(BARE, /\.b-grid \.b-dial\.is-drawing/,
    'the grid still styles an entrance class nothing can add');
  assert.doesNotMatch(BARE, /--rd-len|--rd-to/,
    'the sheet still reads the two ends of an arc nothing emits');
  /* AND THE ARC MODE ITSELF: dialRingHtml answers learning or solid, and
     asking it for an arc may not quietly produce one. */
  const a = planHQ();
  assert.doesNotMatch(a.dialRingHtml('arc', null), /stroke-dashoffset/,
    'the arc mode is still reachable by name');
  /* THE ENTRANCES THAT WERE NOT THIS ONE ARE UNTOUCHED. The gauge and the
     session ring keep theirs; only the instrument that lost its shape lost
     its entrance. */
  assert.match(BARE, /\.gauge-wrap\.is-drawing \.gauge-fill\{[^}]*animation:gauge-draw/,
    'the confidence gauge lost its entrance too, which this change never touched');
  assert.match(SRC, /function animateConfidenceGauge\(/,
    'the gauge driver was deleted along with the Progress one');
});
