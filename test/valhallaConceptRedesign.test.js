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
  // Two quiet figures, both real numbers.
  assert.match(hero, /<div class="v-hero-figs">/);
  assert.equal((hero.match(/class="v-hero-fig"/g) || []).length, 2);
  assert.match(hero, /To Goal Day/);
  assert.match(hero, /<span>Load<\/span>/);
  // The outlook is a contained card now, not a bare track under a heading.
  assert.match(hero, /class="outlook-instrument"/);
  assert.doesNotMatch(hero, /class="outlook"[^-]/, 'the old bare outlook shell survived');
  // One status line, with a real decision word and a coloured dot.
  assert.match(hero, /class="v-status-line"/);
  assert.match(hero, /class="v-status-dot (good|watch|bad)"/);
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
test('PREVIEW: the Reading dials on Valhalla show all five sections, non-interactive', () => {
  const a = planHQ();
  const preview = a.renderValhallaReadingPreview();
  assert.match(preview, /<div class="setup-section-title">The Reading<\/div>/);
  // The category label lives INSIDE the instrument's face now (.rd-cat), not
  // as a separate span beneath the circle -- the labels moved so the
  // recovered space could go to the larger dial instead.
  ['Readiness', 'Recovery', 'Evolution', 'Patterns', 'Adaptation'].forEach(label => {
    assert.match(preview, new RegExp('<div class="rd-cat">' + label + '</div>'));
  });
  assert.doesNotMatch(preview, /data-action="open-reading"/,
    'the Valhalla preview dials must not duplicate Coach\'s tap-through cards');
  assert.equal((preview.match(/class="b-dial-col"/g) || []).length, 5);
});

test('PREVIEW: the Record plates on Valhalla show all three facts, non-interactive', () => {
  const a = planHQ();
  const preview = a.renderValhallaRecordPreview();
  assert.match(preview, /<div class="setup-section-title">The Record<\/div>/);
  assert.match(preview, /class="b-record"/);
  // Three now, not four -- Training paces moved to Settings (requirement 6).
  assert.equal((preview.match(/class="b-plate"/g) || []).length, 3);
  assert.doesNotMatch(preview, /data-action="open-record"/,
    'the Valhalla preview plates must not duplicate Record\'s tap-through cards');
  ['Measured fitness', 'Benchmark', 'Progress'].forEach(label => {
    assert.match(preview, new RegExp('<div class="lbl">' + label + '</div>'));
  });
});

test('PREVIEW: the readiness dial shows the same live percentage the gauge and the Coach card show', () => {
  const a = planHQ();
  const pct = a.formatConfidencePct(a.computeConfidenceScore());
  const preview = a.renderValhallaReadingPreview();
  assert.ok(preview.indexOf('>' + pct + '%</b>') !== -1,
    'the Valhalla preview\'s readiness dial does not match computeConfidenceScore()');
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
  assert.ok(at('class="v-hero"') < at('The Reading'), 'the Reading preview is not below the hero');
  assert.ok(at('The Reading') < at('The Record'), 'the Record preview is not below the Reading preview');
  // New Block and Plan Settings no longer render on the daily Valhalla page
  // at all (requirement 5 relocated both to Settings).
  assert.doesNotMatch(html, /class="act-trio/, 'a management action tile is still below the Record preview');
});

// ===========================================================================
// 4. COACH IS A READABLE, TAPPABLE DIAGNOSTIC LIST -- NOT VALHALLA'S DIALS
// ===========================================================================
test('COACH: every Reading card is a rectangular list row, not a dial, still tappable into the same panel', () => {
  const a = planHQ();
  a.planhqTab = 'coach';
  const html = a.renderPlanHQView();
  const cards = (html.match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [])
    .filter(c => c.indexOf('data-action="open-reading"') !== -1);
  assert.equal(cards.length, 5);
  cards.forEach(c => {
    // Requirement 7: keep the rectangular list rows, do not change them into
    // the circular presentation Valhalla's own Reading overview uses.
    assert.doesNotMatch(c, /class="rs-dial"/, 'a Coach card grew Valhalla\'s circular dial');
    assert.match(c, /class="hq-row-l"/, 'a Coach card lost its row title');
    assert.match(c, /class="rs-chev"/, 'a Coach card lost its tap affordance');
  });
});

test('RECORD: every Record card is a headline-fact card, still tappable into the same panel', () => {
  const a = planHQ();
  a.planhqTab = 'record';
  const html = a.renderPlanHQView();
  const cards = (html.match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [])
    .filter(c => c.indexOf('data-action="open-record"') !== -1);
  // Three now, not four -- Training paces moved to Settings (requirement 6).
  assert.equal(cards.length, 3);
  cards.forEach(c => {
    assert.match(c, /class="rec-headline"/, 'a Record card lost its headline');
    assert.doesNotMatch(c, /rs-dial/, 'a Record card grew a state dial -- facts are plates, not circles');
  });
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
  // --gold-badge-ink, not --gold-text: the number now sits on a fixed-cream
  // medallion face behind the ring (the 3D depth pass), so it needs the
  // shade of gold already proven to read on cream rather than the one tuned
  // for the hero card's themed background it no longer sits directly on --
  // still gold, per metricColour.test.js's broader --(gold|bronze) check.
  assert.match(CODE, /\.gauge-num b\{[^}]*color\s*:\s*var\(--gold-badge-ink\)/);
  assert.match(CODE, /\.gauge-fill\{stroke:var\(--cherry\);\}/);
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
  a.handleSetPlanhqTab('coach');
  a.renderPlanHQView();
  a.handleSetPlanhqTab('record');
  a.renderPlanHQView();
  a.handleSetPlanhqTab('valhalla');
  a.renderPlanHQView();
  assert.equal(a.computeConfidenceScore(), before.conf);
  assert.equal(JSON.stringify(a.raceOutlook()), before.outlook);
  assert.equal(JSON.stringify((a.coachAnalyse().decision || {})), before.decision);
  assert.equal(JSON.stringify(a.coachAnalyse().load), before.load);
});
