'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE APPROVED-CONCEPT VISUAL REDESIGN.
 * ===========================================================================
 * The first Valhalla pass reorganised the existing Plan HQ components into
 * VALHALLA/COACH/RECORD tabs but kept their old presentation (the
 * semicircular gauge, the bare Race Outlook track, list-row Reading/Record
 * cards). The approved Artifact mock-up is a genuine visual redesign, not a
 * relayout, so this file protects the things that pass changed:
 *
 *   - the Valhalla hero: centred block/week, a full-circle readiness ring,
 *     two quiet figures (days to goal, load), a contained Race Outlook card,
 *     a one-line status read;
 *   - THE READING and THE RECORD condensed, non-interactive previews on the
 *     Valhalla tab itself, using the same circular-dial and chamfered-plate
 *     language the Coach and Record tabs use in full;
 *   - Coach and Record's own cards reskinned into that dial/headline
 *     language, still tappable, still opening the same real evidence panels.
 *
 * Every value below still has to come from the same real computations this
 * pass did not touch -- computeConfidenceScore(), coachAnalyse(),
 * raceOutlook(), the four record facts. This file checks the new shape; the
 * existing planHqReading/planHqRecord/valhallaRedesign suites still check
 * that the underlying data and actions never moved.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const TODAY = '2026-08-20';
function planHQ(opts) {
  const a = loadApp({ pinnedDate: TODAY });
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12 }, opts || {}));
  a.state.view = 'planhq';
  return a;
}

// ===========================================================================
// 1. THE HERO
// ===========================================================================
test('HERO: centred block/week, a full-circle gauge, two figures, a contained outlook card, a status line', () => {
  const a = planHQ();
  const hero = a.renderProgrammeStatus();
  assert.match(hero, /<div class="v-hero">/);
  assert.match(hero, /<div class="v-hero-block[^>]*>Half Marathon Build<\/div>/);
  assert.match(hero, /<div class="v-hero-week">Week \d+ of \d+<\/div>/);
  // The gauge is a ring: a real SVG <circle> progress arc, not the old
  // semicircular <path> arc.
  assert.match(hero, /class="gauge-fill"/);
  assert.doesNotMatch(hero, /class="confidence-gauge"/, 'the old semicircular gauge shell survived');
  // Two quiet figures, both real numbers, now on one line WITH the gauge
  // rather than stacked under it.
  assert.match(hero, /<div class="v-hero-band">/);
  assert.equal((hero.match(/class="v-hero-fig"/g) || []).length, 2);
  assert.match(hero, /To Goal Day/);
  assert.match(hero, /<span>Load<\/span>/);
  const bandAt = hero.indexOf('class="v-hero-band"');
  assert.ok(bandAt !== -1 && bandAt < hero.indexOf('confidence-gauge-mount'),
    'the gauge is not inside the band, so the figures cannot flank it');
  /* THE TWO INSTRUMENTS THAT LEFT THE HERO, and the point of the pass: the
     hero carried four readings before The Reading's five began. Current
     Fitness and Race Outlook moved to the circles that state their headline
     figure, so they must be GONE from here and PRESENT there -- an assertion
     that fails either way round, rather than one that is happy if they
     simply vanished. */
  assert.doesNotMatch(hero, /class="outlook-instrument"/,
    'Race Outlook and/or Current Fitness is still in the hero');
  assert.doesNotMatch(hero, /current-fitness-mount|outlook-mount/);
  assert.match(a.recordPanelGoal(), /class="outlook-instrument"/,
    'Race Outlook left the hero and did not arrive in the Goal panel');
  /* Current Fitness opens the Fitness panel ONLY once there is a measurement
     behind it -- it falls back to estimating from the benchmark otherwise,
     and a panel that exists to say what has been measured may not open on a
     clock time derived from something it goes on to call not a measurement.
     So the measurement is made here, through the app's own path, and then
     the conclusion must be there. */
  assert.doesNotMatch(a.recordPanelFitness(), /class="cf-instrument/,
    'the Fitness panel estimates a range with nothing measured');
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  assert.ok(chk, 'the generator scheduled no Fitness Checkpoint to measure with');
  chk.completed = true;
  chk.actual = { km: chk.km, pace: '4:05', hr: null, rpe: null, notes: '' };
  a.recordMeasuredPerformance(chk);
  assert.match(a.recordPanelFitness(), /class="cf-instrument outlook-instrument"/,
    'Current Fitness left the hero and did not arrive in the Fitness panel');
  // The call is its own card now, with a real decision word and a coloured dot.
  assert.match(hero, /class="v-call (good|watch|bad)"/);
  assert.match(hero, /Valhalla\u2019s Call \u2014 /);
  assert.match(hero, /class="v-status-dot (good|watch|bad)"/);
  assert.doesNotMatch(hero, /class="v-status-line"/,
    'the call is still a footnote line inside the hero card');
});

test('HERO: an athlete with no plan gets an empty hero, not a crash', () => {
  const a = loadApp({ pinnedDate: TODAY });
  a.state = a.makeDefaultState();
  const hero = a.renderProgrammeStatus();
  assert.match(hero, /<div class="v-hero">/);
  assert.doesNotMatch(hero, /v-hero-block/, 'a hero with no plan still named a block');
});

test('HERO: the unit toggle is still real and still reachable from the hero', () => {
  const a = planHQ();
  const hero = a.renderProgrammeStatus();
  assert.match(hero, /class="tb-unit-toggle v-hero-unit-toggle"/);
  assert.match(hero, /data-action="set-units" data-units="km"/);
  assert.match(hero, /data-action="set-units" data-units="mi"/);
});

test('HERO: KM/MI is one tight control on the shared white rim, not two labels floating in reserved width', () => {
  // The two words rendered 18px of empty space apart (measured with
  // getBoundingClientRect on the text ranges, not eyeballed) because each
  // button reserved min-width:30px for 15px and 12px of ink, with a 2px
  // gap added on top. Both halves of that are pinned here: a reinstated
  // min-width or gap reopens the hole, and the rim must keep coming from
  // the --t-rim-* family rather than an inline literal, so the three rims
  // move together the next time the light changes.
  const css = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const pill = css.match(/\.tb-unit-toggle\{([^}]*)\}/);
  assert.ok(pill, '.tb-unit-toggle rule not found');
  assert.match(pill[1], /gap:0/, 'the gap between KM and MI is back');
  assert.match(pill[1], /var\(--t-rim-white\) border-box/,
    'the toggle rim is no longer drawn from the shared rim family');
  const btn = css.match(/\.tb-unit-toggle button\{([^}]*)\}/);
  assert.ok(btn, '.tb-unit-toggle button rule not found');
  assert.match(btn[1], /min-width:0/,
    'the button reserves width its glyphs do not use again');
  assert.match(btn[1], /min-height:34px/,
    'the thumb target shrank -- height was never the problem');
  // The token itself: same direction and same three-stop quiet-to-bright
  // run as the gold and velvet rims it sits beside.
  const tok = css.match(/--t-rim-white:([^;]*);/);
  assert.ok(tok, '--t-rim-white is not declared');
  assert.match(tok[1], /linear-gradient\(135deg/, 'the white rim runs a different diagonal to the others');
  assert.equal((tok[1].match(/rgba\(255,255,255/g) || []).length, 3,
    'the white rim is not the three-stop ramp the other two are');
});

test('HERO: days-to-goal reads the same raceDate renderCountdown() reads, and reacts to a block already raced', () => {
  const a = planHQ();
  assert.match(a.renderGoalDayFig(), /\d+d/);
  // Push the goal day into the past with no outcome recorded yet.
  a.state.setup.raceDate = a.addDays(a.todayStr(), -1);
  const past = a.renderGoalDayFig();
  assert.doesNotMatch(past, /\d+d/, 'a goal day already behind the athlete still counted down');
  assert.match(past, /v-hero-fig/);
});

test('HERO: load is coachAnalyse().load.ratio, not a second computation', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  const hero = a.renderProgrammeStatus();
  const loadText = report.load.ratio != null ? report.load.ratio.toFixed(2) + 'x' : '—';
  assert.ok(hero.indexOf('>' + loadText + '</b><span>Load</span>') !== -1,
    'the hero\'s Load figure is not coachAnalyse().load.ratio');
});

// ===========================================================================
// 2. THE READING / THE RECORD PREVIEWS ON VALHALLA
// ===========================================================================
/* THE DIALS ARE THE DESTINATION NOW, which is the whole reason Coach and
   Record could be retired. They were decorative <div>s with no action on
   them: an athlete reading "Recovery / Fresh" had to find the same verdict
   written out as a list row on a second screen before the evidence behind it
   would open. So the assertion that used to say these must NOT be tappable
   is inverted -- deliberately, and it is now the stronger of the two, since
   the old one could pass with every circle inert. */
test('PREVIEW: the Reading arc shows every section it owns, each one a destination', () => {
  const a = planHQ();
  const preview = a.renderValhallaReadingPreview();
  assert.match(preview, /<div class="setup-section-title">The Reading<\/div>/);
  // The category label is the circle's own .rd-cat. It sits UNDER the face
  // now rather than inside it -- inside, it had about 46px of a 66px circle
  // to live in, which is what pinned it at 6.4px.
  ['Recovery', 'Evolution', 'Patterns', 'Adaptation'].forEach(label => {
    assert.match(preview, new RegExp('<span class="rd-cat">' + label + '</span>'));
  });
  /* READINESS IS NOT THE ARC'S ANY MORE. It is the hero gauge, which sits
     above this preview and is now the button that opens the readiness panel
     -- so a readiness circle here would be the second copy of a number the
     athlete read a moment earlier. That the gauge really is that door is
     asserted where the gauge is rendered, in planHqReading. Everything else
     the engine interprets still has to be openable from this arc. */
  assert.doesNotMatch(preview, /data-reading="readiness"/,
    'the duplicate readiness circle is back in the arc');
  a.readingSections(a.coachAnalyse()).filter(sec => sec.key !== 'readiness').forEach(sec => {
    assert.match(preview, new RegExp('data-action="open-reading" data-reading="' + sec.key + '"'),
      sec.key + ' is drawn but cannot be opened');
  });
  assert.equal((preview.match(/<button type="button" class="b-dial"/g) || []).length, 4);
  assert.match(preview, /Tap any circle for the evidence/,
    'nothing on the screen says the circles can be pressed');
});

/* ONE ROW, GRADUATED, AND THE MIDDLE OF IT MEANS SOMETHING. Three-over-two
   put readiness in a grid corner, and the arc was built to give it the
   centre instead -- the position the graduation makes the most important.
   That turned out to be the wrong fix for the right observation: the reading
   the hero gauge is also showing did not need the arc's best seat, it needed
   not to be drawn twice. So the centre circle is gone, the gauge above the
   arc is readiness's one face and its door, and what is left is four peers
   ranked outward from a centre the gauge occupies: 2-1-1-2. The ranks are
   asserted rather than the pixel sizes: the CSS owns the diameters, this
   owns the order and which faces are largest. */
test('PREVIEW: the arc is one row, graduated outward from its centre', () => {
  const a = planHQ();
  const preview = a.renderValhallaReadingPreview();
  assert.match(preview, /class="b-dials-arc"/);
  assert.doesNotMatch(preview, /class="b-dials-row"/, 'the old 3+2 grid survived');
  const order = (preview.match(/data-reading="([a-z]+)"/g) || [])
    .map(m => m.replace(/.*"([a-z]+)"$/, '$1'));
  assert.deepEqual(order, ['recovery', 'evolution', 'patterns', 'adaptation']);
  const ranks = (preview.match(/data-rank="(\d)"/g) || []).map(m => m.slice(-2, -1));
  assert.deepEqual(ranks, ['2', '1', '1', '2'],
    'the arc is no longer graduated outward from its centre');
  // and the CSS actually makes rank 0 the largest. Every rule for that rank
  // is considered, not just the first one in the file: the arc also carries
  // margin-only rules per rank (they hold the circles on one centre line now
  // that a label sits underneath), and taking the first match found one of
  // those and read no width at all.
  const d = r => {
    const rules = CODE.match(new RegExp('\\.b-dial\\[data-rank="' + r + '"\\]\\{[^}]*\\}', 'g')) || [];
    const withWidth = rules.map(x => /width:(\d+)px/.exec(x)).filter(Boolean);
    assert.ok(withWidth.length, 'no rule gives rank ' + r + ' a diameter');
    return Number(withWidth[0][1]);
  };
  assert.ok(d(1) > d(2), 'rank does not map to diameter');
  /* And rank 0 is gone from the sheet, not merely unused by the markup: an
     88px diameter and a brighter box-shadow left behind for a circle nothing
     renders is the kind of dead rule the next person reads as live. */
  assert.doesNotMatch(CODE, /\.b-dial\[data-rank="0"\]/,
    'the removed centre circle left its CSS behind');
  // The label under each circle is the one label voice, at one size for all
  // four -- the graduation is the CIRCLE's job. Labels at a size each was
  // the arc's hierarchy leaking into text that has to stay readable.
  assert.match(CODE, /\.rd-cat\{[^}]*font-size:var\(--label-size\)/,
    'the circle label left the one label voice');
  assert.doesNotMatch(CODE, /\.b-dial\[data-rank="\d"\] \.rd-cat\{/,
    'the label is being graduated per diameter again');
});

test('PREVIEW: The Athlete Status shows all four facts, each one a destination', () => {
  const a = planHQ();
  const preview = a.renderValhallaRecordPreview();
  assert.match(preview, /<div class="setup-section-title">The Athlete Status<\/div>/);
  assert.match(preview, /class="b-status"/);
  /* FOUR NOW, NOT THREE. Goal joins Measured fitness, Benchmark and
     Progress -- it was always a fact of the record and had simply never had
     a surface, living only on the Record tab as a chooser. */
  /* join(), not deepEqual: recordFacts() builds its array inside the VM
     sandbox, so node:assert/strict's reference-equal prototype check fails on
     a cross-realm Array that is otherwise identical. */
  const facts = a.recordFacts();
  assert.equal(facts.map(f => f.key).join(','), 'goal,fitness,benchmark,progress');
  assert.equal((preview.match(/class="b-dial b-stat"/g) || []).length, 4);
  facts.forEach(f => {
    assert.match(preview, new RegExp('data-action="open-record" data-record="' + f.key + '"'),
      f.key + ' is drawn but cannot be opened');
    assert.match(preview, new RegExp('<span class="rd-cat">' + f.chip + '</span>'));
  });
  /* The circle's label is short where the panel's title is full: "Fitness"
     on a 90px face, "Measured fitness" everywhere a sentence has room. */
  assert.equal(facts[1].chip, 'Fitness');
  assert.equal(facts[1].subject, 'Measured fitness');
});

/* THIS TEST USED TO BE THE PARITY CHECK -- the readiness dial had to show
   the same live percentage as the gauge above it. It passed for as long as it
   existed, and it was the clearest statement of the problem: a screen that
   needs a test to keep two faces of one number agreeing is a screen showing
   one number twice. The dial is gone, so the claim inverts. The percentage
   is still live and still computeConfidenceScore()'s -- it now has exactly
   one face to be live in, and the arc is checked for not growing another. */
test('HERO: the gauge carries the live confidence percentage, and nothing in the arc restates it', () => {
  const a = planHQ();
  const pct = a.formatConfidencePct(a.computeConfidenceScore());
  const gauge = (a.renderPlanHQView().match(/<button[^>]*class="gauge-wrap"[\s\S]*?<\/button>/) || [])[0] || '';
  assert.ok(gauge, 'the confidence gauge is not on the Valhalla view');
  assert.ok(gauge.indexOf('<b class="font-mono">' + pct + '%</b>') !== -1,
    'the gauge does not show formatConfidencePct(computeConfidenceScore())');
  assert.ok(gauge.indexOf('aria-label="Confidence score ' + pct + ' percent') !== -1,
    'the gauge reads a different number to a screen reader than it draws');
  // Anchored on the value face, not on the bare digits: the arc legitimately
  // carries percentages elsewhere (a tick, a width), and it is a second
  // READING of confidence that must not come back, not the character '%'.
  assert.ok(a.renderValhallaReadingPreview().indexOf('>' + pct + '%</b>') === -1,
    'a circle in the arc is showing the confidence number again');
});

test('PREVIEW: an athlete with no plan gets empty previews, not a crash', () => {
  const a = loadApp({ pinnedDate: TODAY });
  a.state = a.makeDefaultState();
  assert.equal(a.renderValhallaReadingPreview(), '');
  assert.equal(a.renderValhallaRecordPreview(), '');
});

// ===========================================================================
// 3. THE VALHALLA TAB ASSEMBLES HERO + BOTH PREVIEWS + THE EXISTING ACTIONS
// ===========================================================================
test('TAB: Valhalla renders the hero, then the Reading preview, then the Record preview, with no action tiles beneath', () => {
  const a = planHQ();
  const html = a.renderPlanHQView();
  const at = s => html.indexOf(s);
  assert.ok(at('class="v-hero"') < at('class="v-call'), 'the call is not below the hero');
  assert.ok(at('class="v-call') < at('The Reading'), 'the Reading arc is not below the call');
  assert.ok(at('The Reading') < at('The Athlete Status'),
    'The Athlete Status is not below the Reading arc');
  // New Block and Plan Settings no longer render on the daily Valhalla page
  // at all (requirement 5 relocated both to Settings).
  assert.doesNotMatch(html, /class="act-trio/, 'a management action tile is still below the Record preview');
});

// ===========================================================================
// 4. THE LIST SCREENS ARE GONE; THE PANELS THEY OPENED ARE NOT
// ===========================================================================
/* Coach drew every Reading as a rectangular list row and Record drew every
   fact as a headline card, and the three tests that stood here held those
   two shells to their shape. Both shells are deleted: nothing emitted them
   once the circles became the destination, and a renderer with no caller is
   what the next person edits by mistake.

   WHAT THOSE TESTS WERE REALLY PROTECTING -- that every interpretation and
   every fact has a panel, and that an absence is never typeset as a value --
   is protected here instead, against the surfaces that exist. */
test('PANELS: every Reading and every Record fact still opens its own panel', () => {
  const a = planHQ();
  const report = a.coachAnalyse();
  a.readingSections(report).forEach(sec => {
    const html = a.hqPanelHtml(sec.key);
    assert.ok(html && html.length > 40, sec.key + ' opens an empty panel');
    assert.match(html, /data-action="close-record-panel"/, sec.key + ' has no way back');
  });
  a.recordFacts().forEach(f => {
    const html = a.hqPanelHtml(f.key);
    assert.ok(html && html.length > 40, f.key + ' opens an empty panel');
    assert.match(html, /data-action="close-record-panel"/, f.key + ' has no way back');
  });
  // the shells that used to carry them are gone, not merely unused
  ['renderReadingSection', 'renderRecordSection', 'readingCard', 'recordCard', 'recordPlate']
    .forEach(n => assert.equal(typeof a[n], 'undefined', n + ' survives with no caller'));
});

test('RECORD: an absence is not typeset as a measurement', () => {
  /* The structural half of the old fix, carried onto the circle. Quieting
     the colour was never enough -- the face was the claim, and an empty
     state in JetBrains Mono reads as a measurement of nothing rather than as
     the absence of a measurement. */
  const a = planHQ();
  a.state.athlete.performances = [];
  const fact = a.recordFitnessFact();
  assert.ok(fact.none, 'an unmeasured fitness no longer reports itself as an absence');
  const dial = a.statusDialHtml(fact);
  assert.match(dial, /<b class="rec-none"/, 'the absence is drawn in the measurement\'s own face');
  /* The VALUE SLOT carries no words. "Nothing measured" is a sentence, and a
     sentence in a 90px face is a value that will not fit as well as a claim
     that is not true -- the circle shows an em dash and the panel behind it
     explains. It is still in the aria-label, because a screen reader is
     reading a label rather than looking at a slot. */
  const slot = /<b class="rec-none"[^>]*>([\s\S]*?)<\/b>/.exec(dial);
  assert.ok(slot, 'no value slot at all');
  assert.equal(slot[1], '\u2014', 'the circle states the absence as though it were a value');
  assert.match(dial, /aria-label="Measured fitness \u2014 Nothing measured"/,
    'the absence is no longer announced to a screen reader');
  assert.match(dial, /data-action="open-record"/, 'the absence stopped being tappable');
  // and the rule that makes rec-none a different face is actually there
  assert.match(CODE, /\.rd-val b\.rec-none\{[^}]*font-family\s*:\s*'Inter'/);
});

// ===========================================================================
// 5. COLOUR LAW: CHERRY IS MEASURED, GOLD IS THE GOAL -- EVEN IN THE NEW SHELL
// ===========================================================================
test('COLOUR: the contained Race Outlook keeps the app\'s own law, not the mock-up\'s inverted one', () => {
  assert.match(CODE, /\.oi-band\{[^}]*background\s*:\s*var\(--cherry\)/,
    'the measured band is no longer Cherry Lacquer');
  assert.match(CODE, /\.oi-goal\{[^}]*background\s*:\s*var\(--gold\)/,
    'the goal marker is no longer gold');
});

test('COLOUR: the readiness figure stays gold, the ring stays the accent -- same law as before the redesign', () => {
  /* THE LAW IS THE SAME; THE SURFACE UNDER IT CHANGED. The figure takes
     gold and the ring takes the accent -- that has not moved. Which gold has:
     the face was a fixed-cream medallion and --gold-badge-ink is the shade
     proven on cream, which on the dark face the gauge now wears is a brown
     smudge. --gold-bright is the shade proven on this surface, and it is the
     one the bottom nav and every section title already use. Still gold, per
     metricColour.test.js's broader --(gold|bronze) check. */
  assert.match(CODE, /\.gauge-num b\{[^}]*color\s*:\s*var\(--gold-bright\)/);
  /* THE ARC STILL CARRIES THE ACCENT, it is simply no longer a single
     stroke:var(--cherry). It takes the session ring's filament -- the same
     four stops, near-white at the hot end falling through --cherry-text and
     --cherry to --cherry-dim -- so the claim this guards (the arc is the one
     place this figure wears the accent) is checked against the gradient the
     arc actually paints with. */
  assert.match(CODE, /\.gauge-fill\{stroke:url\(#gaugeFill\);\}/);
  assert.match(CODE, /id="gaugeFill"[\s\S]*?var\(--cherry\)/);
  /* And the rim takes the same three-stop ramp as every other circle, in the
     same accent as the fill -- so the hero ring is one of the circles rather
     than a survivor of the design before them. */
  assert.match(CODE, /\.gauge-rim\{stroke:url\(#gaugeRim\)/);
  assert.match(CODE, /id="gaugeRim"/);
});

// ===========================================================================
// 6. NOTHING COACHING-SHAPED MOVED
// ===========================================================================
test('SAFETY: the redesigned shell renders every real value from the same real functions', () => {
  const a = planHQ();
  const before = {
    conf: a.computeConfidenceScore(),
    outlook: JSON.stringify(a.raceOutlook()),
    decision: JSON.stringify((a.coachAnalyse().decision || {})),
    load: JSON.stringify(a.coachAnalyse().load),
  };
  a.renderPlanHQView();
  a.renderValhallaReadingPreview();
  a.renderValhallaRecordPreview();
  Object.keys(a.RECORD_PANELS).forEach(k => a.hqPanelHtml(k));
  a.readingSections(a.coachAnalyse()).forEach(sec => a.hqPanelHtml(sec.key));
  a.renderPlanHQView();
  assert.equal(a.computeConfidenceScore(), before.conf);
  assert.equal(JSON.stringify(a.raceOutlook()), before.outlook);
  assert.equal(JSON.stringify((a.coachAnalyse().decision || {})), before.decision);
  assert.equal(JSON.stringify(a.coachAnalyse().load), before.load);
});
