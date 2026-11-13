'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE APPROVED-CONCEPT VISUAL REDESIGN.
 * ===========================================================================
 * The first Sacoro pass reorganised the existing Plan HQ components into
 * SACORO/COACH/RECORD tabs but kept their old presentation (the
 * semicircular gauge, the bare Race Outlook track, list-row Reading/Record
 * cards). The approved Artifact mock-up is a genuine visual redesign, not a
 * relayout, so this file protects the things that pass changed:
 *
 *   - the Sacoro hero: centred block/week, a full-circle readiness ring,
 *     two quiet figures (days to goal, load), a contained Race Outlook card,
 *     a one-line status read;
 *   - THE READING and THE RECORD condensed, non-interactive previews on the
 *     Sacoro tab itself, using the same circular-dial and chamfered-plate
 *     language the Coach and Record tabs use in full;
 *   - Coach and Record's own cards reskinned into that dial/headline
 *     language, still tappable, still opening the same real evidence panels.
 *
 * Every value below still has to come from the same real computations this
 * pass did not touch -- computeConfidenceScore(), coachAnalyse(),
 * raceOutlook(), the four record facts. This file checks the new shape; the
 * existing planHqReading/planHqRecord/sacoroRedesign suites still check
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
test('HERO: a full-circle gauge, two figures, a contained outlook card, a status line', () => {
  /* ---- CHANGED SIDES: THE BLOCK AND THE WEEK ARE OFF THE TOP ----
     Founder: "At the top remove the 3 lines of text - coach - full marathon
     - week 1 of 14. The realign the page with equal spacing."
     This asked for a CENTRED BLOCK/WEEK above the band, and that was right
     while the hero was the page's opening statement. The page opens on the
     instruments now; both lines are on Full Plan and This Week, each one
     tap away, and here they cost a third of the viewport before the first
     reading. Everything else this test holds is unchanged. */
  const a = planHQ();
  const hero = a.renderProgrammeStatus();
  assert.match(hero, /<div class="v-hero">/);
  assert.doesNotMatch(hero, /v-hero-block/, 'the block name is back above the gauge');
  assert.doesNotMatch(hero, /v-hero-week/, 'the week line is back above the gauge');
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
  /* The call is its own card, with a real decision word and a tone.
     THE DOT HAS GONE AND THIS ASSERTION WITH IT. It was a third telling:
     the card already carries the tone as a class -- which is what drives
     --call-tone and the gradient wash behind the words -- and the title
     already ENDS in the decision ("Sacoro's Call -- Proceed"). What the
     dot cost was the left edge: it held the title at x=32 on a screen whose
     every other line starts at 16.
     Both surviving signals are asserted immediately below, so a card that
     lost its tone or its decision word still fails here. */
  /*
     ---- CHANGED SIDES: SACORO'S CALL IS GONE ----
     Founder: "I don't like Sacoro's call - proceed / Recovery fresh,
     trend still building. We know the user should proceed."
     The engine returns PROCEED on most days, so a band under the hero
     announcing it told the athlete what opening the app already assumed,
     and both readings in its sub-line are circles in the grid beneath it
     with panels of their own. It had already given up its dot and then its
     wash for the same reason; this is that argument reaching the block. */
  assert.doesNotMatch(hero, /class="v-call/, 'Sacoro\u2019s Call is back in the hero');
  assert.doesNotMatch(hero, /Sacoro\u2019s Call/, 'the call\u2019s title is back');
  /* AND THE HERO ITSELF IS UNTOUCHED -- founder: "hero stays exactly the
     same!!" The block, the week, the gauge and the two figures either
     side are asserted above; this pins that removing the call took
     nothing else with it. */
  assert.equal((hero.match(/class="v-hero-fig"/g) || []).length, 2,
    'a hero figure went with the call');
  assert.doesNotMatch(hero, /class="v-status-dot/,
    'the dot is back in front of the call title');
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

test('HERO: the unit toggle is still real, and reachable from Settings', () => {
  /* ---- CHANGED SIDES: THE CONTROL MOVED, THE CLAIM DID NOT ----
     Founder: "Coach tab. Remove the KM / Ml tab. Move to settings."
     This held that the toggle stays reachable FROM THE HERO, on the
     reasoning in renderProgrammeStatus() that display units are real,
     unrelated state and must not disappear with a redesign. That reasoning
     is exactly why it belongs in Settings: it is a preference, set once, and
     it was the only control on a screen that otherwise states readings.
     So the claim is unchanged -- the toggle is real and reachable -- and
     only the surface it hangs on moves. */
  const a = planHQ();
  const hero = a.renderProgrammeStatus();
  assert.doesNotMatch(hero, /tb-unit-toggle/, 'the toggle is back on the Coach hero');
  assert.doesNotMatch(hero, /data-action="set-units"/, 'the hero can still set units');

  const settings = a.renderSettingsHubView();
  assert.match(settings, /class="tb-unit-toggle"/, 'the toggle did not arrive in Settings');
  assert.match(settings, /data-action="set-units" data-units="km"/);
  assert.match(settings, /data-action="set-units" data-units="mi"/);
  assert.match(settings, />Distance units</, 'the units row does not name itself');
  /* AND IT STILL REFLECTS THE STATE IT SETS, which is the half of a moved
     control that is easiest to drop on the way. */
  a.state.units = 'mi';
  assert.match(a.renderSettingsHubView(),
    /data-units="mi"[^>]*>MI|class="active"[^>]*data-units="mi"/,
    'the toggle in Settings does not show which unit is live');
  a.state.units = 'km';
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
  /* 34 -> var(--tap-min). The touch-target pass raised every control in the
     app to a single named 44, and this one came with it -- on the height
     only. The min-width:0 pinned just above is the half that must not move:
     that pass first tried 44 per segment and reopened the very hole this test
     was written to kill, at 31px rather than 18. Height was never the
     problem, so height is what changed. */
  assert.match(btn[1], /min-height:var\(--tap-min\)/,
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
// 2. THE READING / THE RECORD PREVIEWS ON SACORO
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
  const preview = a.renderSacoroInstruments();
  /* The heading went with the founder's "the reading and the athlete status
     and gold decor lines can be removed"; what it headed did not. */
  assert.doesNotMatch(preview, /The Reading</, 'the retired heading is back');
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
  assert.equal((preview.match(/<button type="button" class="b-dial(?: is-(?:petals|torus|rings|orb))?"/g) || []).length, 4);
  /* ---- CHANGED SIDES: THE WHISPER GAVE ITS LINE TO THE DOTS ----
     "Tap any circle for the evidence" sat under a grid that showed all four
     at once. Founder, with the approved dashboard: "Rail 3 circles wrapped
     visually. Gold dots underneath." A rail has something more pressing to
     say under it -- that there is a fourth circle -- and the design carries
     no sentence there. */
  assert.doesNotMatch(preview, /Tap any circle for the evidence/, 'the whisper is back under the rail');
  assert.equal((preview.match(/class="b-rail-dot[ "]/g) || []).length, 2,
    'the rail does not say there is a second position');
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
test('PREVIEW: the circles are a rail of three, all one size', () => {
  /* ---- AND THE SHAPE CHANGED SIDES ONCE MORE ----
     Founder, with the approved dashboard: "horizontal coaching-circle rail,
     compact Confidence hero and Aerobic Development graph ... Rail 3
     circles wrapped visually. Gold dots underneath."
     Two abreast and vertical filled the screen with four circles; one row
     of three leaves room for the graph. What the note below pinned is
     still pinned: one size for all of them, and the founder's order -- which
     is now the order the design draws them in. */
  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE SCREEN ----
     It required a single staggered row -- ranks 2,1,1,2 outward from the
     centre -- because the arc sized its circles against each other: one
     reading mattered more than another.
     Founder: "then 6 circles. 2 abreast. Vertical. Plan evolution -
     adaption, fitness - progress, recovery - patterns."
     In a grid of equal cells a size ladder reads as a mistake, so all six
     take the largest rank, and two of them are Record facts sitting between
     the readings. What is still pinned is that the ORDER is the founder's
     and that the ladder has not crept back in. */
  const a = planHQ();
  const preview = a.renderSacoroInstruments();
  assert.match(preview, /<div class="b-rail" data-hswipe="1"><div class="b-grid">/,
    'the circles are not a rail, or a swipe along it would change tab');
  assert.doesNotMatch(preview, /class="b-dials-(arc|row)"/, 'the staggered arc is back');
  assert.match(CODE, /\.b-rail > \.b-grid \.b-dial-col\{flex:0 0 calc\(\(100% - 36px\) \/ 3\);/,
    'the rail does not show three circles');
  assert.match(CODE, /\.b-rail\{[^}]*overflow-x:auto;[^}]*scroll-snap-type:x mandatory;/,
    'the rail does not scroll under a thumb');
  const order = (preview.match(/data-reading="([a-z]+)"/g) || [])
    .map(m => m.replace(/.*"([a-z]+)"$/, '$1'));
  assert.deepEqual(order, ['recovery', 'evolution', 'adaptation', 'patterns']);
  const ranks = (preview.match(/data-rank="([0-9s])"/g) || []).map(m => m.slice(-2, -1));
  assert.equal(new Set(ranks).size <= 2, true,
    'the circles are graduated again: ' + ranks.join(','));
  assert.ok(ranks.indexOf('1') === -1 && ranks.indexOf('2') === -1,
    'a smaller rank is back in the grid: ' + ranks.join(','));
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
  assert.equal(d(0), d('s'),
    'a reading circle and a status circle are different sizes in the same grid');
  /* ---- AND THIS HALF CHANGED SIDES TOO ----
     It required the arc to render NO rank-0 circle, because rank 0 was the
     panel hero's size and the arc's largest was rank 1. The grid has no
     ladder, so every reading circle is rank 0 now -- the same diameter the
     status circles beside them already had, which is the assertion directly
     above. The warning the old comment carried is still worth keeping: rank
     0 must never be deleted from the STYLESHEET on the strength of a markup
     check, because readingDialHtml(sec, 0, true) also draws the hero at the
     top of every Reading panel. That is why the rule is read for a diameter
     above rather than asserted absent here. */
  assert.doesNotMatch(preview, /data-rank="1"/,
    'the removed centre circle is back in the arc');
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
  const preview = a.renderSacoroInstruments();
  /* ---- CHANGED SIDES: ALL FOUR ARE PLATES NOW ----
     Founder: "I think we make the fitness and progress circles the same as
     goal and benchmark. And then put them under the circles."
     The heading is still retired and the row is no longer split: goal and
     benchmark took plates first, on "then 2 even sized rectangular boxes",
     and fitness and progress have followed them. The claim this test makes
     -- all four facts are shown and every one is a destination -- is
     untouched; only the shape two of them arrive in has changed. */
  assert.doesNotMatch(preview, /The Athlete Status</, 'the retired heading is back');
  assert.match(preview, /class="b-plates"/);
  /* FOUR NOW, NOT THREE. Goal joins Measured fitness, Benchmark and
     Progress -- it was always a fact of the record and had simply never had
     a surface, living only on the Record tab as a chooser. */
  /* join(), not deepEqual: recordFacts() builds its array inside the VM
     sandbox, so node:assert/strict's reference-equal prototype check fails on
     a cross-realm Array that is otherwise identical. */
  const facts = a.recordFacts();
  assert.equal(facts.map(f => f.key).join(','), 'goal,fitness,benchmark,progress');
  assert.equal((preview.match(/class="b-dial b-stat"/g) || []).length, 0,
    'a Record fact is drawn as a circle again');
  assert.equal((preview.match(/class="b-plate"/g) || []).length, 4,
    'expected all four facts as plates');
  facts.forEach(f => {
    assert.match(preview, new RegExp('data-action="open-record" data-record="' + f.key + '"'),
      f.key + ' is drawn but cannot be opened');
    /* Two shapes, two label slots: a circle names itself in .rd-cat under
       the face, a plate in .b-plate-k inside it. Either is the fact naming
       itself, which is what this line checks. */
    assert.match(preview, new RegExp('<span class="(rd-cat|b-plate-k)">' + f.chip + '</span>'),
      f.chip + ' is drawn without naming itself');
  });
  /* The plate's label is short where the panel's title is full: "Fitness"
     in a 139px box, "Measured fitness" everywhere a sentence has room. The
     short form was chosen for a 90px circle face and is kept, because the
     plate is not much wider and the panel behind it still says it in
     full. */
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
  assert.ok(gauge, 'the confidence gauge is not on the Sacoro view');
  assert.ok(gauge.indexOf('<b class="font-mono">' + pct + '%</b>') !== -1,
    'the gauge does not show formatConfidencePct(computeConfidenceScore())');
  assert.ok(gauge.indexOf('aria-label="Confidence score ' + pct + ' percent') !== -1,
    'the gauge reads a different number to a screen reader than it draws');
  // Anchored on the value face, not on the bare digits: the arc legitimately
  // carries percentages elsewhere (a tick, a width), and it is a second
  // READING of confidence that must not come back, not the character '%'.
  assert.ok(a.renderSacoroInstruments().indexOf('>' + pct + '%</b>') === -1,
    'a circle in the arc is showing the confidence number again');
});

test('PREVIEW: an athlete with no plan gets empty previews, not a crash', () => {
  const a = loadApp({ pinnedDate: TODAY });
  a.state = a.makeDefaultState();
  assert.equal(a.renderSacoroInstruments(), '');
  assert.equal(a.renderSacoroInstruments(), '');
});

// ===========================================================================
// 3. THE SACORO TAB ASSEMBLES HERO + BOTH PREVIEWS + THE EXISTING ACTIONS
// ===========================================================================
test('TAB: Sacoro renders the hero, then the Reading preview, then the Record preview, with no action tiles beneath', () => {
  const a = planHQ();
  const html = a.renderPlanHQView();
  const at = s => html.indexOf(s);
  assert.doesNotMatch(html, /class="v-call/, 'Sacoro\u2019s Call is back');
  /* The two headed rows became one grid and two plates on instruction --
     see the order law in test/planHqReading, which carries the reasoning.
     The sequence this test is about is unchanged. */
  assert.ok(at('class="v-hero"') < at('class="b-grid"'), 'the circles are not below the hero');
  assert.ok(at('class="b-grid"') < at('class="b-plates"'),
    'the plates are not below the circles');
  // New Block and Plan Settings no longer render on the daily Sacoro page
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
  /* Through the token: the product names no family directly any more, and
     the claim is that an absence takes the WORDS face while the measurement
     beside it keeps the figure face -- not which family that happens to be. */
  assert.match(CODE, /\.rd-val b\.rec-none\{[^}]*font-family\s*:\s*var\(--text-face\)/,
    'the absence is typeset as a measurement again');
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

test('SIZE: all five circles are one diameter, drawn the same way', () => {
  /* Founder: "I want the confidence circle to be the same size as the other
     circles. So increase that's size and reduce the others."
     EQUAL BOXES WERE NOT ENOUGH, and the measurement is why this law reads
     as it does. The wrap came out at 164px like the dials and the ring
     inside it still drew 126px against their 151px: the SVG carried a
     hard-coded width="132" so the token never reached the drawing, and the
     gauge was r=46 in a 120 viewBox (77% of its box) where the dials are
     r=46 in a 100 one (92%). The extra margin held the twelve tick marks at
     r=52..59, and they are gone. */
  const ring = /\.view-planhq\{([^}]*)\}/.exec(CODE);
  assert.ok(ring, 'the view no longer declares the shared diameter');
  assert.match(ring[1], /--ring-dia:\d+px/, 'the shared diameter token is gone');
  /* BOTH READ THE SAME TOKEN. Either one carrying its own number is how the
     five come apart again. */
  assert.match(/\.gauge-wrap\{([^}]*)\}/.exec(CODE)[1], /width:var\(--ring-dia/,
    'the gauge sizes itself rather than reading the shared diameter');
  assert.match(/\.b-grid \.b-dial\[data-rank\]\{([^}]*)\}/.exec(CODE)[1],
    /max-width:var\(--ring-dia/,
    'the reading circles size themselves rather than reading the shared diameter');
  /* AND THE SVG MUST NOT PIN ITSELF, which is the half that silently undoes
     the rest: a width in pixels on the element leaves the wrap growing
     around a drawing that does not. */
  assert.match(CODE, /<svg viewBox="0 0 100 100" width="100%" height="100%">/,
    'the gauge drawing is pinned in pixels again, so the token cannot reach it');
  assert.match(CODE, /var cx=50, cy=50, r=46;/,
    'the gauge is not drawn on the same geometry as the reading circles');
});

test('SIZE: the gauge has no tick marks, and keeps the thickness it had', () => {
  /* Founder: "I like the thickness. But don't now like the dash's around
     the side."
     The marks lived OUTSIDE the track at r=52..59, which is what made the
     gauge read wider than its own ring. Deleted with the <g> that carried
     them and the rule that styled them.
     THE THICKNESS IS A RENDERED MEASUREMENT, NOT A NUMBER IN THE FILE. The
     box went 120 -> 100 and the element 132 -> 164, so the stroke width had
     to change for what is drawn to stay put: 9 units in a 120 box at 132px
     is 9.9px, and 6 units in a 100 box at 164px is 9.8px. That is the thing
     the founder asked to keep. */
  assert.doesNotMatch(CODE, /class="gauge-tick"/, 'the tick marks are back');
  assert.doesNotMatch(CODE, /gauge-ticks/, 'the tick group is back');
  assert.doesNotMatch(CODE, /\.gauge-tick\{/, 'the tick rule is back');
  /* THREE RINGS NOW, EACH THINNER. Founder, with the approved mock: the
     gauge became three rings, race goal outer, consistency middle,
     execution inner, and three rings at the old 9.9px would have closed the
     face. Each is 5 units in the 100 box at 164px, about 8.2px, and the
     three together are wider than the one ring was. */
  const stroke = /confidenceArcsHtml\(computeConfidenceBreakdown\(\), (\d+(?:\.\d+)?)\)/.exec(CODE);
  assert.ok(stroke, 'the gauge arcs no longer state their stroke width');
  const rendered = parseFloat(stroke[1]) * (164 / 100);
  assert.ok(Math.abs(rendered - 8.2) < 0.6,
    'each gauge ring now renders at ' + rendered.toFixed(1) + 'px where the approved mock had 8.2px');
});

test('COLOUR: the readiness figure is white, the ring still carries the accent', () => {
  /* ---- CHANGED SIDES: THE FIGURE LEFT GOLD ----
     Founder: "50% should now be white ... Confidence inside should be
     white ... this page shouldn't have the off white text. All white."
     The note that stood here argued only about WHICH gold, because the law
     that a reading takes gold was settled. What unsettled it was the
     company the gauge now keeps: it is one of five circles at one diameter,
     and the other four state their readings in white while their RINGS
     carry the colour. A gold figure made this one a different species in
     its own row.
     THE HALF THAT DID NOT CHANGE is the one this test is named for -- the
     ring is still where this instrument wears the accent, and everything
     below is untouched. */
  assert.match(CODE, /\.gauge-num b\{[^}]*color\s*:\s*#FFFFFF/i,
    'the confidence figure went back to gold');
  assert.match(CODE, /\.gauge-num span\{[^}]*color\s*:\s*#FFFFFF/i,
    'the CONFIDENCE caption is not white');
  /* THE ARC STILL CARRIES THE ACCENT, it is simply no longer a single
     stroke:var(--cherry). It takes the session ring's filament -- the same
     four stops, near-white at the hot end falling through --cherry-text and
     --cherry to --cherry-dim -- so the claim this guards (the arc is the one
     place this figure wears the accent) is checked against the gradient the
     arc actually paints with. */
  /* The stroke declaration, not the whole rule: .gauge-fill gained an
     entrance animation alongside it, and pinning the closing brace made a
     colour test fail for a timing change. */
  assert.match(CODE, /\.gauge-fill\{stroke:url\(#gaugeFill\);/);
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
  a.renderSacoroInstruments();
  a.renderSacoroInstruments();
  Object.keys(a.RECORD_PANELS).forEach(k => a.hqPanelHtml(k));
  a.readingSections(a.coachAnalyse()).forEach(sec => a.hqPanelHtml(sec.key));
  a.renderPlanHQView();
  assert.equal(a.computeConfidenceScore(), before.conf);
  assert.equal(JSON.stringify(a.raceOutlook()), before.outlook);
  assert.equal(JSON.stringify((a.coachAnalyse().decision || {})), before.decision);
  assert.equal(JSON.stringify(a.coachAnalyse().load), before.load);
});


/* EVERY RANK THE CODE DRAWS HAS A DIAMETER IN THE SHEET.
 * ===========================================================================
 * This is the guard that was missing. The ranks are chosen in JS and their
 * sizes live in CSS, so a rank can be rendered that no rule matches -- the
 * circle then silently falls back to .b-dial's base 68px while
 * dialValueFontSize() goes on scaling its text for the size it was promised.
 * Nothing throws, every existing test passes, and the only symptom is a word
 * broken across lines inside a circle. That is exactly what happened to the
 * Reading panels' hero when rank 0's rule was deleted as "dead".
 */
test('ARC: every rank the renderers draw has a diameter rule behind it', () => {
  const a = planHQ();
  const drawn = new Set();
  // Every circle the product can actually put on screen, from its own output.
  [a.renderPlanHQView(), a.renderSacoroInstruments(), a.renderSacoroInstruments()]
    .forEach(html => {
      (html.match(/data-rank="([^"]+)"/g) || [])
        .forEach(m => drawn.add(m.replace(/.*"([^"]+)"$/, '$1')));
    });
  // and the panel heroes, which are drawn only once a panel is opened
  a.READING_KEYS.forEach(k => {
    const sec = a.readingSections(a.coachAnalyse()).filter(s => s.key === k)[0];
    (a.readingDialHtml(sec, 0, true).match(/data-rank="([^"]+)"/g) || [])
      .forEach(m => drawn.add(m.replace(/.*"([^"]+)"$/, '$1')));
  });
  a.recordFacts().forEach(f => {
    (a.statusDialHtml(f, true).match(/data-rank="([^"]+)"/g) || [])
      .forEach(m => drawn.add(m.replace(/.*"([^"]+)"$/, '$1')));
  });
  /* TWO NOW, NOT FOUR. The arc's ladder (ranks 1 and 2) went with the arc
     when the founder asked for an even two-column grid; what is left is the
     one circle size the grid draws and the status rank beside it. The claim
     is unchanged and is the next line: whatever ranks the renderers DO draw
     must each have a diameter rule behind them, or a circle falls back to
     .b-dial's base 68px carrying a font scaled for a larger face. */
  assert.ok(drawn.size >= 2, 'expected at least two ranks, found ' + [...drawn].join(','));

  /* THE BASE RULE, NOT ANY RULE. A first version of this matched the whole
     stylesheet, and it passed with the base diameter deleted -- because the
     <=400px media query carries its own rank-0 size and that was enough to
     satisfy the regex. A rule that only applies on a narrow phone is not a
     diameter on a 430pt one, so the media blocks are stripped before the
     match and what is left is what every screen gets. */
  const base = (() => {
    let out = '', depth = 0, i = 0;
    while (i < CODE.length) {
      if (CODE.startsWith('@media', i)) {
        const open = CODE.indexOf('{', i);
        if (open === -1) break;
        depth = 1; i = open + 1;
        while (i < CODE.length && depth > 0) {
          if (CODE[i] === '{') depth++;
          else if (CODE[i] === '}') depth--;
          i++;
        }
        continue;
      }
      out += CODE[i++];
    }
    return out;
  })();
  assert.ok(base.length < CODE.length, 'no media blocks were stripped, so this proves nothing');

  drawn.forEach(r => {
    const re = new RegExp('\\.b-dial\\[data-rank="' + r + '"\\]\\{[^}]*width:\\s*\\d+px');
    assert.match(base, re,
      'rank "' + r + '" is rendered but no unconditional rule gives it a diameter, ' +
      'so it falls back to .b-dial\'s 68px with a font scaled for something larger');
  });
});
