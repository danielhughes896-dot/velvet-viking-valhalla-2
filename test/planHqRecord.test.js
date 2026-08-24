'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE RECORD — Plan HQ's four facts, and the panels they open.
 *
 * Plan HQ used to spend roughly 640px stating four things inline: what has
 * been measured, what the benchmark is, what the five zone paces are, and how
 * far through the block the athlete is. They are four compact cards now, and
 * the detail each of them carried opens in its own panel.
 *
 * WHAT THESE TESTS ARE ACTUALLY PROTECTING is not the layout. It is that the
 * move relocated components rather than reimplementing them, and that the
 * copy written around them is true of the code underneath:
 *
 *   - every card's value comes from live state, so a fixture that changes the
 *     state changes the card;
 *   - a Record card's right-hand element is a VALUE and never a verdict, which
 *     is the one thing separating it from every other card on the screen;
 *   - the zone-pace editor in the panel is the same editor, with the same
 *     inputs, ids, data-actions and override behaviour -- not a copy;
 *   - the Benchmark panel reaches openRecalibrateModal() through the existing
 *     action and defines no second benchmark form;
 *   - nothing claims a benchmark measures current fitness, and nothing claims
 *     training paces descend from the benchmark. They descend from
 *     getActiveVDOT(), which reads the athlete's active GOAL, and the panels
 *     say so;
 *   - no fitness estimate is invented where the evidence threshold has not
 *     been met, and no checkpoint control is offered without a destination;
 *   - both exits do the same thing, and put the athlete back where they were.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
// The prose in this file and in the runtime describes both the old shape and
// the new, so a scan that reads comments would pass on commentary alone.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const PINNED = '2026-03-10T09:00:00Z';
function planHQ(opts) {
  const a = loadApp({ pinnedDate: PINNED });
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12 }, opts || {}));
  a.state.view = 'planhq';
  // This file is about THE RECORD specifically, and Valhalla now opens on a
  // different tab by default -- every test below wants the Record tab unless
  // it says otherwise.
  a.planhqTab = 'record';
  return a;
}
// THE READING's cards share the .ev-card shell deliberately -- one component
// doing the other job -- so a Record card is identified by the action it
// fires, not by its class.
function cards(html) {
  return (html.match(/<button type="button" class="ev-card"[\s\S]*?<\/button>/g) || [])
    .filter(c => c.indexOf('data-action="open-record"') !== -1);
}
function cardFor(html, subject) {
  const found = cards(html).filter(c => c.indexOf('>' + subject + '<') !== -1);
  assert.equal(found.length, 1, 'expected exactly one "' + subject + '" card, found ' + found.length);
  return found[0];
}

// ===========================================================================
// 1. THE FOUR CARDS
// ===========================================================================
test('RECORD: Plan HQ carries exactly three Record cards, each its own tappable card', () => {
  const a = planHQ();
  const html = a.renderPlanHQView();
  const found = cards(html);
  // Three now, not four -- Training paces moved to Settings' Training &
  // Zones card (requirement 6): it is plan configuration/reference, not a
  // historical athlete record, so The Record keeps only the three that are.
  assert.equal(found.length, 3, 'expected three Record cards, found ' + found.length);

  const subjects = found.map(c => (c.match(/<\/b><span>([^<]+)<\/span>/) || [])[1]);
  assert.equal(subjects.join(' | '),
    'Measured fitness | Benchmark | Progress');

  found.forEach(c => {
    assert.match(c, /data-action="open-record"/, 'a Record card does not open anything');
    assert.match(c, /data-record="(fitness|benchmark|progress)"/);
    assert.match(c, /class="rec-headline"/, 'a Record card states no value');
    assert.match(c, /class="rec-context"/, 'a Record card carries no synopsis');
  });
});

test('RECORD: the three are separate cards, not one combined container', () => {
  const a = planHQ();
  const html = a.renderPlanHQView();
  // Three sibling elements, none nested inside another.
  assert.equal((html.match(/data-action="open-record"/g) || []).length, 3);
  found_not_nested: {
    const region = html.slice(html.indexOf('data-action="open-record"'));
    assert.doesNotMatch(region.slice(0, region.indexOf('</button>')),
      /class="ev-card"/, 'a Record card is nested inside another Record card');
    break found_not_nested;
  }
  // And no list/table container wrapping them.
  assert.doesNotMatch(html, /<table/, 'The Record went back to a table');
});

test('RECORD: a card value is a fact, never a verdict', () => {
  const a = planHQ();
  const html = a.renderPlanHQView();
  cards(html).forEach(c => {
    const headline = c.slice(c.indexOf('class="rec-headline"'), c.indexOf('</div>'));
    // A conclusion elsewhere in Plan HQ carries a status hue, a tone-coloured
    // dial ring, and often a dot. A Record value carries none of that -- it
    // is a headline number, not a verdict.
    assert.doesNotMatch(headline, /\bdot\b/, 'a Record value grew a status dot');
    assert.doesNotMatch(headline, /positive|negative|warn|good|strained|c-tempo|c-easy|rs-dial/,
      'a Record value was given a status colour or a verdict dial');
    assert.doesNotMatch(headline, /text-transform/, 'a Record value was shouted');
  });
  // The rule is in the stylesheet too, not only in this render.
  assert.match(CODE, /\.rec-headline b\{[^}]*color\s*:\s*var\(--ink\)/,
    '.rec-headline no longer takes the neutral ink');
});

// ===========================================================================
// 2. REAL RUNTIME DATA
// ===========================================================================
test('RECORD: every value is read from live state, not written into the markup', () => {
  const a = planHQ();

  // BENCHMARK — change it, the card changes with it.
  a.state.setup.benchmark = { distanceKey: '5k', timeSec: a.clockToSec('0:19:30') };
  assert.match(cardFor(a.renderPlanHQView(), 'Benchmark'), /19:30/);
  a.state.setup.benchmark = { distanceKey: '10k', timeSec: a.clockToSec('0:41:05') };
  assert.match(cardFor(a.renderPlanHQView(), 'Benchmark'), /41:05/);
  a.state.setup.benchmark = null;
  const none = cardFor(a.renderPlanHQView(), 'Benchmark');
  assert.match(none, /Not set/);
  assert.match(none, /rec-none/, 'an absent benchmark is quieted, not coloured');

  // PROGRESS — log sessions, the percentage moves.
  const before = cardFor(a.renderPlanHQView(), 'Progress');
  assert.match(before, /\b0%/, 'nothing is logged yet, so progress is zero');
  const runnable = a.state.days.filter(d => d.type !== 'rest');
  runnable.slice(0, Math.ceil(runnable.length / 4)).forEach(d => { d.completed = true; });
  const after = cardFor(a.renderPlanHQView(), 'Progress');
  assert.notEqual(after, before, 'logging a quarter of the block moved nothing');
  assert.match(after, /\d+ of \d+ runs/);
  assert.match(after, /week \d+ of \d+/);
});

test('RECORD: the zone-paces fact counts the zones and names the hand-edited ones, now surfaced from Settings', () => {
  const a = planHQ();
  // recordZonesFact() itself is untouched by the relocation -- it is the
  // presentation (which screen shows it) that moved, not the logic. Checked
  // directly now that there is no more Record card to read it back through.
  assert.match(a.recordZonesFact().synopsis, /All five as calculated from your active goal/);
  assert.equal(a.recordZonesFact().value, '5 zones');

  a.state.setup.paceOverrides = { M: { fast: 250, slow: 262 } };
  assert.match(a.recordZonesFact().synopsis, /Tempo edited by hand/);
  assert.match(a.recordZonesFact().synopsis, /The rest as calculated/);

  a.state.setup.paceOverrides = {
    M: { fast: 250, slow: 262 }, T: { fast: 240, slow: 248 }, I: { fast: 220, slow: 228 },
  };
  assert.match(a.recordZonesFact().synopsis, /3 zones edited by hand/);

  // A half-set override is not an override -- the same rule getActivePaces()
  // applies, applied here too, so the fact cannot disagree with the paces.
  a.state.setup.paceOverrides = { M: { fast: 250, slow: null } };
  assert.match(a.recordZonesFact().synopsis,
    /All five as calculated/, 'a half-edited zone was counted as edited');

  // And it is genuinely reachable, at full fidelity, from Settings. 400, not
  // 300: this row is .ev-card.stg-nav now (VALHALLA CONSISTENCY PASS), and
  // the inlined icon SVG between the tag and its label runs past 300 chars.
  assert.match(a.renderSettingsHubView(),
    /data-action="open-record" data-record="zones"[^>]*>[\s\S]{0,400}?View Training Zone Paces/,
    'Training Zone Paces is not reachable from Settings');
  assert.match(a.RECORD_PANELS.zones(), /Training Zone Paces/);
});

test('RECORD: measured fitness reports a measurement when there is one, and an absence when there is not', () => {
  const a = planHQ();
  const empty = cardFor(a.renderPlanHQView(), 'Measured fitness');
  assert.match(empty, /Nothing measured/);
  assert.match(empty, /A race or a Fitness Checkpoint is what counts/);
  assert.doesNotMatch(empty, /\d\d:\d\d/, 'a time appeared with nothing measured');

  // A real completed checkpoint, recorded through the app's own path.
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  assert.ok(chk, 'the generator scheduled no Fitness Checkpoint to test against');
  chk.completed = true;
  chk.actual = { km: chk.km, pace: '4:05', hr: null, rpe: null, notes: '' };
  a.recordMeasuredPerformance(chk);
  const filled = cardFor(a.renderPlanHQView(), 'Measured fitness');
  assert.match(filled, /Checkpoint,/, 'the source of the measurement is not stated');
  assert.match(filled, /Training runs do not move it/);
  assert.doesNotMatch(filled, /Nothing measured/);
});

// ===========================================================================
// 3. THE PANELS ARE THE EXISTING COMPONENTS, RELOCATED
// ===========================================================================
test('PANEL: the zone-paces panel hosts the editor itself, not a copy of it', () => {
  const a = planHQ();
  const panel = a.RECORD_PANELS.zones();
  const inline = a.renderZonePacesCard();

  // Every editable input the inline card had, with the same action and zones.
  a.ZONE_PACE_ORDER.forEach(k => {
    const n = (panel.match(new RegExp('data-action="pace-override" data-zone="' + k + '"', 'g')) || []).length;
    assert.equal(n, 2, 'zone ' + k + ' lost one of its two editable bounds');
  });
  assert.equal((panel.match(/class="pzr-input"/g) || []).length,
               (inline.match(/class="pzr-input"/g) || []).length,
               'the panel and the card disagree about how many inputs exist');
  assert.match(panel, /Edit any pace by hand/);

  // The head is suppressed in the panel (the modal is already titled) and
  // nowhere else -- calling it with no argument is what it always was.
  assert.match(inline, /class="zpc-head"/);
  assert.doesNotMatch(panel, /class="zpc-head"/);
  assert.equal((panel.match(/Training Zone Paces/g) || []).length, 1,
    'the panel prints its own title twice');

  // And the reset control appears on the same condition as before.
  assert.doesNotMatch(panel, /reset-pace-overrides/);
  a.state.setup.paceOverrides = { M: { fast: 250, slow: 262 } };
  assert.match(a.RECORD_PANELS.zones(), /reset-pace-overrides/);
});

test('PANEL: the progress panel hosts the existing stats and keeps the patch mount', () => {
  const a = planHQ();
  a.state.days.filter(d => d.type !== 'rest').slice(0, 9).forEach(d => { d.completed = true; });
  const panel = a.RECORD_PANELS.progress();
  assert.ok(panel.indexOf(a.renderPlanOverviewStats()) !== -1,
    'the panel does not render renderPlanOverviewStats() verbatim');
  assert.match(panel, /id="planhq-stats-mount"/,
    'patchDerivedStats() can no longer find the stats it patches');
  // The rows carry what the bars do not; runs done and distance done are
  // already stated twice above, so repeating them here would be filler.
  assert.match(panel, /Sessions still to run/);
  assert.match(panel, /Longest run so far/);
  assert.match(panel, /Longest run still ahead/);
  const rows = panel.slice(panel.indexOf('Where you are in the block'));
  assert.doesNotMatch(rows, /Runs done/, 'the panel repeats a figure the bars already carry');
});

test('PANEL: the measured-fitness panel hosts renderMeasuredFitness() verbatim', () => {
  const a = planHQ();
  const panel = a.RECORD_PANELS.fitness();
  assert.ok(panel.indexOf(a.renderMeasuredFitness(true)) !== -1,
    'the panel does not render renderMeasuredFitness() verbatim');
  // Heading suppressed in the panel only; the no-argument call is unchanged.
  assert.match(a.renderMeasuredFitness(), /<div class="setup-section-title">Measured Fitness<\/div>/);
  assert.doesNotMatch(a.renderMeasuredFitness(true), /setup-section-title">Measured Fitness</);
});

test('PANEL: the benchmark panel reaches the existing recalibrate modal and defines no second form', () => {
  const a = planHQ();
  const panel = a.RECORD_PANELS.benchmark();
  assert.match(panel, /data-action="open-recalibrate"/,
    'the Benchmark panel no longer routes to openRecalibrateModal()');
  // No duplicated benchmark editing: the recalibrate modal owns those ids.
  ['rc-bench-dist', 'rc-bench-time', 'rc-goal-A', 'su-bench-dist', 'su-bench-time']
    .forEach(id => assert.doesNotMatch(panel, new RegExp('id="' + id + '"'),
      'the Benchmark panel grew its own copy of #' + id));
  assert.doesNotMatch(panel, /<input/, 'the Benchmark panel became a second benchmark editor');
});

// ===========================================================================
// 4. PANEL CHROME — the Build Your Training Block language, minus the rail
// ===========================================================================
test('PANEL: every panel opens with an uppercase heading and a circular close', () => {
  const a = planHQ();
  Object.keys(a.RECORD_PANELS).forEach(k => {
    const panel = a.RECORD_PANELS[k]();
    assert.match(panel, /<div class="modal-head"><h2 class="font-head">[^<]+<\/h2>/, k);
    assert.match(panel, /class="icon-btn" data-action="close-record-panel" aria-label="Close"/, k);
    assert.match(panel, /<div class="modal-body">/, k);
  });
  // .icon-btn is the circular control the rest of the product already uses.
  assert.match(CODE, /\.icon-btn\{[^}]*border-radius\s*:\s*999px/);
  // .modal-head h2 is what makes the heading uppercase.
  assert.match(CODE, /\.modal-head h2\{[^}]*text-transform\s*:\s*uppercase/);
});

test('PANEL: every panel ends on one full-width Cherry Lacquer BACK, and no other primary', () => {
  const a = planHQ();
  Object.keys(a.RECORD_PANELS).forEach(k => {
    const panel = a.RECORD_PANELS[k]();
    const primaries = panel.match(/class="btn btn-primary[^"]*"/g) || [];
    assert.equal(primaries.length, 1, k + ' has ' + primaries.length + ' primary actions');
    assert.match(primaries[0], /btn-block/, k + "'s BACK is not full width");
    assert.match(panel,
      /<button type="button" class="btn btn-primary btn-block" data-action="close-record-panel">← BACK<\/button>/,
      k + ' does not end on ← BACK');
    // The BACK is last in the body.
    assert.ok(panel.indexOf('rec-panel-nav') > panel.indexOf('<div class="modal-body">'), k);
  });
  // Violet comes from the builder's own rule, not a second purple.
  assert.match(CODE, /\.builder-light\s+\.btn-primary\{[^}]*var\(--cherry\)/);
});

test('PANEL: a detail panel is not a wizard step', () => {
  const a = planHQ();
  Object.keys(a.RECORD_PANELS).forEach(k => {
    const panel = a.RECORD_PANELS[k]();
    assert.doesNotMatch(panel, /bld-progress/, k + ' grew the Build Plan progress rail');
    assert.doesNotMatch(panel, /bld-stage-no/, k + ' grew an 01 / 05 stage number');
    assert.doesNotMatch(panel, /\d\d\s*\/\s*05/, k + ' counts itself as a build stage');
    assert.doesNotMatch(panel, /data-action="bld-next"/, k + ' offers a Continue');
  });
});

// ===========================================================================
// 5. EXIT BEHAVIOUR
// ===========================================================================
test('EXIT: X and ← BACK are the same action, and both restore the Plan HQ scroll position', () => {
  const a = planHQ();
  Object.keys(a.RECORD_PANELS).forEach(k => {
    const panel = a.RECORD_PANELS[k]();
    const exits = panel.match(/data-action="([^"]+)"/g)
      .filter(x => /close/.test(x));
    assert.equal(exits.join(','), 'data-action="close-record-panel",data-action="close-record-panel"',
      k + ' has two different exits, or only one');
  });

  let scrolledTo = null;
  a.pageYOffset = 1840;
  a.scrollTo = (x, y) => { scrolledTo = y; };

  a.openRecordPanel('zones');
  a.pageYOffset = 0;              // what renderApp() would leave behind
  a.closeRecordPanel();
  assert.equal(scrolledTo, 1840, 'closing a panel did not return the athlete to where they were');

  // And it is genuinely forgotten afterwards, so an unrelated modal elsewhere
  // in the app is never yanked to a Plan HQ offset.
  scrolledTo = null;
  a.restorePlanHQScroll();
  assert.equal(scrolledTo, null);
});

test('EXIT: editing a pace inside the panel does not throw the page back to the top', () => {
  const a = planHQ();
  let scrolledTo = null;
  a.pageYOffset = 1200;
  a.scrollTo = (x, y) => { scrolledTo = y; };
  a.openRecordPanel('zones');

  // handlePaceOverrideChange() reads the live inputs, which the stub DOM does
  // not have; what matters here is that it restores the offset renderApp()
  // destroys, so the reset path -- same shape, no DOM reads -- stands in.
  a.state.setup.paceOverrides = { M: { fast: 250, slow: 262 } };
  a.handleResetPaceOverrides();
  assert.equal(scrolledTo, 1200, 'a pace edit scrolled Plan HQ back to the top');
});

// ===========================================================================
// 6. WHAT THE PANELS ARE AND ARE NOT ALLOWED TO CLAIM
// ===========================================================================
test('CLAIMS: no panel says the benchmark sets the training paces', () => {
  const a = planHQ();
  const all = Object.keys(a.RECORD_PANELS).map(k => a.RECORD_PANELS[k]()).join('\n');
  // getActiveVDOT() reads the athlete's active GOAL. Anything that says the
  // paces come from the benchmark contradicts the engine.
  assert.doesNotMatch(all, /pace[^.]{0,60}derived from (this|the benchmark|your benchmark)/i);
  assert.doesNotMatch(all, /benchmark[^.]{0,40}every training pace/i);
  assert.match(a.RECORD_PANELS.zones(), /Calculated from your active goal/,
    'the zone panel does not say where the paces actually come from');
  assert.match(a.RECORD_PANELS.benchmark(), /calculated from your active goal/i);
});

test('CLAIMS: a benchmark is never called a measurement of current fitness', () => {
  const a = planHQ();
  assert.match(a.RECORD_PANELS.benchmark(), /Not a measurement of current fitness/);
  assert.match(a.RECORD_PANELS.fitness(), /What does not count/);
  assert.match(a.RECORD_PANELS.fitness(), /they are a target, not a measurement/);
});

test('CLAIMS: no fitness estimate is invented where the evidence is not there', () => {
  const a = planHQ();
  const panel = a.RECORD_PANELS.fitness();
  assert.match(panel, /Nothing measured yet/);
  // Not one clock time anywhere in the panel: no equivalent range, no estimate,
  // nothing derived from the benchmark and presented as a measurement.
  const body = panel.slice(panel.indexOf('<div class="modal-body">'));
  assert.doesNotMatch(body, /\d:\d\d:\d\d/, 'the panel produced a time from no measurement');
});

test('CLAIMS: the checkpoint is stated where one is scheduled, and no control is offered without a destination', () => {
  const a = planHQ();
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  assert.ok(chk, 'the generator scheduled no Fitness Checkpoint');
  const panel = a.RECORD_PANELS.fitness();
  assert.match(panel, /Your next checkpoint/);
  assert.match(panel, new RegExp('Week ' + chk.week));
  assert.match(panel, /Ahead of you/);
  // And the row/action goes straight to Full Plan -- not to another popup.
  assert.match(panel, /data-action="go-checkpoint"/);

  // There is no ad-hoc checkpoint-scheduling flow in the product, so nothing
  // may offer to open one.
  Object.keys(a.RECORD_PANELS).forEach(k => {
    const p = a.RECORD_PANELS[k]();
    assert.doesNotMatch(p, /Schedule a Checkpoint/i, k + ' offers a flow that does not exist');
    // Every action a panel fires has to be handled somewhere: buttons land in
    // the click dispatcher's switch, form fields in the change dispatcher's
    // chain of comparisons.
    (p.match(/data-action="([^"]+)"/g) || []).forEach(m => {
      const action = m.slice('data-action="'.length, -1);
      const handled = new RegExp("case '" + action + "':|action === '" + action + "'").test(CODE);
      assert.ok(handled, k + ' fires ' + action + ', which no dispatcher handles');
    });
  });
});

test('CLAIMS: a checkpoint ticked off without a time is not called a measurement', () => {
  const a = planHQ();
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];

  // Ticked complete, but with nothing performanceFromDay() can measure.
  chk.completed = true;
  chk.actual = { km: null, pace: null, hr: null, rpe: null, notes: '' };
  assert.equal(a.measuredPerformances().filter(p => p.date === chk.date).length, 0,
    'the fixture accidentally produced a measurement');
  const unmeasured = a.RECORD_PANELS.fitness();
  assert.match(unmeasured, /without a time it can be measured from/);
  assert.doesNotMatch(unmeasured, /It is the measurement above/,
    'a completed-but-unmeasured checkpoint was counted as evidence');
  assert.match(unmeasured, /Nothing measured yet/, 'and the state above must still say so');

  // Now log it properly, through the app's own recording path.
  chk.actual = { km: chk.km, pace: '4:05', hr: 168, rpe: 9, notes: '' };
  a.recordMeasuredPerformance(chk);
  const measured = a.RECORD_PANELS.fitness();
  assert.match(measured, /It is the measurement above/);
  assert.doesNotMatch(measured, /without a time it can be measured from/);
});

// ===========================================================================
// 7. WHAT PLAN HQ NO LONGER CARRIES INLINE
// ===========================================================================
test('HQ: the four inline components are gone from the page and live only in their panels', () => {
  const a = planHQ();
  const html = a.renderPlanHQView();
  assert.doesNotMatch(html, /class="zone-paces-card"/, 'the zone table is still inline');
  assert.doesNotMatch(html, /class="pzr-input"/, 'the pace inputs are still inline');
  assert.doesNotMatch(html, /class="hub-card yr-fitness"/, 'Measured Fitness is still inline');
  assert.doesNotMatch(html, /class="progress-bars/, 'the progress bars are still inline');
  assert.doesNotMatch(html, /data-action="open-recalibrate"/,
    'the old Benchmark summary bar is still on the page');
});

test('HQ: the Valhalla hero carries the gauge verbatim — a full-circle ring, approved-concept redesign', () => {
  const a = planHQ();
  a.planhqTab = 'valhalla';
  const html = a.renderPlanHQView();
  const gauge = a.renderConfidenceGauge();
  assert.ok(html.indexOf(gauge) !== -1, 'the confidence gauge is no longer rendered verbatim');
  assert.match(html, /id="confidence-gauge-mount"/, 'patchDerivedStats() lost the gauge mount');
  // Approved-concept redesign: a full circle, not a semicircular gradient arc
  // with a needle -- the ring itself still carries the accent.
  assert.match(gauge, /class="gauge-fill"/, 'the gauge progress ring is gone');
  assert.match(gauge, /class="gauge-num"/);
  assert.doesNotMatch(gauge, /gaugeFillGrad|stroke-width="2\.4"/,
    'the old semicircular gradient/needle survived the redesign');
  // The explanatory line moved with the rest of Readiness's depth into the
  // tap-through evidence panel rather than sitting permanently on the hero.
  assert.match(a.readingPanel('readiness'), /Confidence reflects how closely your logged sessions have matched/);
  assert.ok(html.indexOf(a.renderProgrammeStatus()) !== -1,
    'renderProgrammeStatus() is no longer rendered verbatim into Plan HQ');
});

test('HQ: the coach panel, the checkpoint banner and Active Goal are all still reachable', () => {
  const a = planHQ();
  // Re-homed, not lost: New Block/Plan Settings now live in Settings, the
  // coach panel on Coach, Active Goal and the checkpoint banner on Record
  // alongside THE RECORD itself.
  assert.match(a.renderSettingsHubView(), /data-action="open-setup"/);

  a.planhqTab = 'coach';
  assert.ok(a.renderPlanHQView().indexOf(a.renderCoachPanel()) !== -1, 'the coach panel left Valhalla');

  a.planhqTab = 'record';
  const record = a.renderPlanHQView();
  assert.ok(record.indexOf(a.renderGoalToggle()) !== -1, 'Active Goal left the Record tab');
  assert.match(record, /<div class="setup-section-title">The Record<\/div>/);
});

test('HQ: an athlete with no plan is never asked to render The Record', () => {
  const a = loadApp({ pinnedDate: PINNED });
  a.state = a.makeDefaultState();
  a.openRecordPanel('zones');   // must not throw on a state with no setup
  assert.equal(a.openRecordPanelKey, null, 'a panel opened for an athlete with no plan');
});
