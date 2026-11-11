'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* BUILD YOUR TRAINING BLOCK — the ten-stage journey.
 * ===========================================================================
 * The builder went from five stages to nine, and then gained a tenth: a pure
 * orientation screen (Overview) ahead of Goal, with no field and no rule --
 * a consistency/visual pass, not a data one. The generator still reads the
 * same element ids out of the same mounted panels, and no existing rule was
 * added, removed or moved to a different question; only the stage indices
 * everything downstream keys off shifted by one to make room for Overview.
 *
 * The five-stage structure had NO test at all, which is why the restructuring
 * could have silently dropped an input, orphaned a validation rule or
 * unmounted a panel that another stage reads across. These tests hold the
 * things that would break quietly:
 *
 *   1. TEN STAGES, and the rail/numeral agree with that count.
 *   2. EVERY GENERATOR INPUT IS STILL THERE, exactly once, on some panel.
 *   3. EVERY VALIDATION RULE STILL POINTS AT THE SCREEN THAT ASKS ITS QUESTION.
 *   4. THE CROSS-STAGE COUPLINGS SURVIVE, which requires panels to stay mounted.
 *   5. THE NO-HR PATH IS THE EXISTING BLANK PATH, not a fabricated value.
 *   6. GOALS ARE ASKED FOR EVERY PURPOSE, because every pace descends from them.
 *   7. OVERVIEW ITSELF: pure orientation, no field, unconditionally passable.
 */

const TODAY = '2026-08-22';
const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

/* openSetupModal() hands its markup to openModal(). Intercepting that is how
   the built journey is inspected without a browser: the harness's document is
   a stub, so every listener the builder attaches simply finds nothing and the
   function returns normally. */
function buildJourney(mutate) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  if (mutate) mutate(a);
  let html = null, cls = null;
  a.openModal = (h, c) => { html = h; cls = c; };
  a.openSetupModal();
  assert.ok(html, 'openSetupModal() did not open anything');
  return { a, html, cls };
}

// The <section data-stage="N"> blocks, in order.
/* ---------- FIND A PANEL BY WHAT IT ASKS, NOT BY WHERE IT SITS ----------
   These lookups were hard-coded indices -- stage === 7 for heart rate,
   stage === 9 for Review -- and inserting Athlete experience at 04 silently
   repointed every one of them at its neighbour. The failures were not
   "there are eleven stages now"; they were "the acronym is still
   unexplained" and "the permission is not on Review", which read like real
   regressions in screens nothing had touched.
   STAGE(key) resolves through the canonical spec, so the next insert moves
   these with it. */
const SPEC_STAGES = require(path.join(__dirname, '..', 'assets', 'builder-spec.js')).stages
  || require(path.join(__dirname, '..', 'assets', 'builder-spec.js')).BUILDER_SPEC.stages;
function STAGE(key) {
  const i = SPEC_STAGES.findIndex((s) => s.key === key);
  assert.notEqual(i, -1, 'no stage keyed ' + key + ' in the canonical spec');
  return i;
}

function panels(html) {
  const out = [];
  const re = /<section class="bld-panel" data-stage="(\d+)"([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ stage: +m[1], attrs: m[2], at: m.index });
  // slice each panel's body up to the next panel (or end)
  out.forEach((p, i) => {
    p.body = html.slice(p.at, i + 1 < out.length ? out[i + 1].at : html.length);
  });
  return out;
}

// ---------------------------------------------------------------- 1. structure
test('THE BUILDER IS WHITE, AND SAYS SO ONCE', () => {
  /* Founder: "The build 11 pages. Change all text to white. Make sure the
     titles and text in the circles and boxes are the same throughout the
     app."
     --ink is #F4F1EA, a warm cream that is right across a product whose
     surfaces are warm; the builder is eleven dark panels. RE-POINTED ON THE
     SCOPE, not overridden element by element -- the same move the Coach
     page makes, which is the thing that makes the two agree. Every stage
     title, option tile, field label and body line already reads --ink, so
     they come white with no new selector and the twelfth stage someone adds
     inherits the decision. */
  const css = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
  const scope = /\.bld-panel\{([^}]*)\}/.exec(css);
  assert.ok(scope, 'the builder no longer re-points its ink at all');
  ['--ink', '--ink-dim', '--ink-faint'].forEach(tok =>
    assert.match(scope[1], new RegExp(tok + ':#FFFFFF', 'i'),
      tok + ' is still the warm cream inside the builder'));
  /* THE HINTS KEEP THEIR PLACE. --ink-faint going white promoted every
     field hint to the weight of the label above it; it keeps the colour and
     gives the difference back in opacity, exactly as the Coach page's one
     hint does. */
  assert.match(/\.bld-panel \.field-hint\{([^}]*)\}/.exec(css)[1], /opacity:\.\d+/,
    'the builder hints read at full strength, which makes every one a statement');
});

test('the builder is eleven stages, and the rail and numeral agree', () => {
  const { a, html } = buildJourney();

  assert.equal(a.BLD_STAGE_NAMES.length, SPEC_STAGES.length,
    'BLD_STAGE_NAMES declares ' + a.BLD_STAGE_NAMES.length + ' stages, not ' + SPEC_STAGES.length);

  const p = panels(html);
  assert.equal(p.length, SPEC_STAGES.length, 'the journey rendered ' + p.length + ' panels');
  assert.deepEqual(p.map(x => x.stage), SPEC_STAGES.map((_, i) => i),
    'the panels are not a contiguous 0..' + (SPEC_STAGES.length - 1) + ' run');

  // one rail segment per stage -- the rail is built from the same array
  const rail = html.match(/<div class="bld-step[^"]*"><\/div>/g) || [];
  assert.equal(rail.length, SPEC_STAGES.length,
    'the rail drew ' + rail.length + ' segments for ' + SPEC_STAGES.length + ' stages');
  /* The numeral is the athlete's only sense of how long this is, so it is
     read from the same array rather than spelled out -- a rail of eleven
     over a numeral saying 10 is the kind of thing nobody notices in review. */
  const total = String(SPEC_STAGES.length).padStart(2, '0');
  assert.ok(html.includes('id="bld-no">01 / ' + total + '<'),
    'the stage numeral does not open on 01 / ' + total);

  // exactly one panel visible at rest, and it is the first (Overview)
  const shown = p.filter(x => !/hidden/.test(x.attrs));
  assert.deepEqual(shown.map(x => x.stage), [0],
    'more than one panel (or the wrong one) is visible when the builder opens');
});

/* ELEVEN SINCE ATHLETE EXPERIENCE WAS LIFTED OFF THE YOU SCREEN. It led
   that stage, above weekly volume, running days and the longest recent run
   -- four answers and two different questions, with the one that picks the
   programme's pathway buried on top of three pieces of evidence. 'You' is
   renamed in the spec to 'Your recent running', which is what it asks now;
   the KEY stays YOU, because that key is what BLD_STAGE, the validator and
   /start's renderer order are all bound to. */
test('the eleven stages are the approved sequence', () => {
  const { a } = buildJourney();
  assert.deepEqual([...a.BLD_STAGE_NAMES],
    ['Overview', 'Goal', 'Distance', 'Event', 'Experience', 'You', 'Benchmark',
     'Week', 'Training data', 'Targets', 'Review']);
});

test('BLD_STAGE is derived from the canonical spec, not a second copy of it', () => {
  /* It was a hand-written literal, and inserting a stage left YOU pointing
     at its neighbour -- so the volume rule would have run on the experience
     screen and the screen that asks for a volume would have gone
     unvalidated, with nothing on screen looking wrong. */
  const { a } = buildJourney();
  SPEC_STAGES.forEach((s, i) => {
    assert.equal(a.BLD_STAGE[s.key], i,
      'BLD_STAGE.' + s.key + ' is ' + a.BLD_STAGE[s.key] + ' but the spec puts it at ' + i);
  });
  assert.equal(Object.keys(a.BLD_STAGE).length, SPEC_STAGES.length,
    'BLD_STAGE carries keys the spec does not');
});

// ------------------------------------------------- 2. every generator input
/* handleGeneratePlan() reads these ids straight out of the DOM. If the
   restructuring dropped one, or duplicated one onto two panels, generation
   would read a missing or ambiguous element -- so the count is a rule. */
const GENERATOR_INPUTS = [
  'su-purpose', 'su-distance', 'su-units', 'su-event-box', 'su-racedate', 'su-weeks',
  'su-volume', 'su-experience', 'su-bench-dist', 'su-bench-time',
  'su-weekdays', 'su-longday', 'su-lthr', 'su-maxhr',
  'su-goal-A', 'su-goal-B', 'su-goal-C',
];

test('every input the generator reads is present exactly once', () => {
  const { html } = buildJourney();
  GENERATOR_INPUTS.forEach(id => {
    const n = (html.match(new RegExp('id="' + id + '"', 'g')) || []).length;
    assert.equal(n, 1, 'id="' + id + '" appears ' + n + ' times in the built journey');
  });
});

test('each input sits on the stage that asks for it', () => {
  const { html } = buildJourney();
  const p = panels(html);
  const where = id => {
    const hit = p.find(x => x.body.includes('id="' + id + '"'));
    return hit ? hit.stage : -1;
  };
  /* Keyed by stage NAME, not by position: this map is the thing an insert
     silently invalidates, and it is also the thing that proves the insert
     did not drag a field along with it. */
  const EXPECTED = {
    'su-purpose': STAGE('GOAL'),
    'su-distance': STAGE('DISTANCE'), 'su-units': STAGE('DISTANCE'),
    'su-event-box': STAGE('EVENT'), 'su-racedate': STAGE('EVENT'), 'su-weeks': STAGE('EVENT'),
    'su-experience': STAGE('EXPERIENCE'),
    'su-volume': STAGE('YOU'),
    'su-bench-dist': STAGE('BENCHMARK'), 'su-bench-time': STAGE('BENCHMARK'),
    'su-weekdays': STAGE('WEEK'), 'su-longday': STAGE('WEEK'),
    'su-lthr': STAGE('TRAINING'), 'su-maxhr': STAGE('TRAINING'),
    'su-goal-A': STAGE('TARGETS'), 'su-goal-B': STAGE('TARGETS'), 'su-goal-C': STAGE('TARGETS'),
  };
  Object.keys(EXPECTED).forEach(id =>
    assert.equal(where(id), EXPECTED[id],
      id + ' is on stage ' + where(id) + ', expected ' + EXPECTED[id]));
});

// --------------------------------------------------------- 3. validation map
test('every validation rule points at the screen that asks its question', () => {
  const { a, html } = buildJourney();
  const S = a.BLD_STAGE;
  // the named indices must match the declared order, or a rule guards the wrong panel
  a.BLD_STAGE_NAMES.forEach((name, i) => {
    const key = name.toUpperCase().replace(/ .*/, '');
    assert.equal(S[key], i, 'BLD_STAGE.' + key + ' is ' + S[key] + ' but ' + name + ' is stage ' + i);
  });

  /* THE REAL BINDING. Each `if (i === BLD_STAGE.X)` branch calls bldFail() with
     the id of a field, and that field must live on stage X's panel -- otherwise
     the athlete is told to fix something on a screen that does not show it, and
     Continue blocks with an error they cannot see. Read the branches out of the
     source rather than restating them, so pointing a rule at another stage is
     caught here instead of passing because the markup is still fine. */
  const p = panels(html);
  const fn = SRC.slice(SRC.indexOf('function bldValidateStage'));
  const vbody = fn.slice(0, fn.indexOf('\n}\n'));
  const branches = vbody.split(/if \(i === BLD_STAGE\./).slice(1);
  assert.equal(branches.length, 4, 'expected four guarded stages, found ' + branches.length);

  const seen = [];
  branches.forEach(br => {
    const key = br.slice(0, br.indexOf(')'));
    seen.push(key);
    const stage = S[key];
    assert.equal(typeof stage, 'number', 'bldValidateStage guards unknown stage ' + key);
    const panel = p.find(x => x.stage === stage);
    assert.ok(panel, 'BLD_STAGE.' + key + ' is not a rendered panel');
    const targets = [...br.matchAll(/bldFail\('([^']+)'/g)].map(m => m[1]);
    assert.ok(targets.length, 'the ' + key + ' rule reports no field');
    targets.forEach(id => assert.ok(panel.body.includes('id="' + id + '"'),
      'the ' + key + ' rule fails onto #' + id + ', which is not on stage ' +
      stage + ' — the athlete would be blocked by an error they cannot see'));
  });
  assert.deepEqual(seen.sort(), ['EVENT', 'TARGETS', 'WEEK', 'YOU'],
    'the guarded stages changed: ' + seen.join(', '));
});

test('no validation rule was added, removed or loosened', () => {
  // The four rules the five-stage builder enforced. The exact thresholds now
  // live in assets/builder-spec.js (test/builderSpecParity.test.js asserts
  // they are 4-24 weeks, >0 volume and 3-6 days) -- this test asserts the
  // shape of each rule still reads from that one canonical source rather than
  // a re-declared literal, which is what would let the two silently diverge.
  const fn = SRC.slice(SRC.indexOf('function bldValidateStage'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /Pick an event date\./);
  assert.match(body, /Event date needs to be in the future\./);
  assert.match(body, /wks < wRange\[0\] \|\| wks > wRange\[1\]/);
  assert.match(body, /BUILDER_SPEC\.validation\.weeksRange/);
  assert.match(body, /!volume \|\| volume <= BUILDER_SPEC\.validation\.volumeMustExceed/);
  assert.match(body, /checked < dRange\[0\] \|\| checked > dRange\[1\]/);
  assert.match(body, /BUILDER_SPEC\.validation\.daysRange/);
  assert.match(body, /Choose a long run day\./);
  assert.match(body, /Enter at least one goal time/);
  // exactly four guarded stages, so a fifth rule cannot appear unnoticed
  const guarded = body.match(/if \(i === BLD_STAGE\.[A-Z]+\)/g) || [];
  assert.equal(guarded.length, 4, 'bldValidateStage now guards ' + guarded.length + ' stages, not four');
});

// ------------------------------------------------------- 4. cross-stage wiring
/* These read elements on panels the athlete is not looking at. They work only
   because a panel is HIDDEN, never unmounted -- so the guard is that every
   panel past the first carries `hidden` rather than being absent. */
test('panels are hidden rather than unmounted, which the couplings depend on', () => {
  const { html } = buildJourney();
  panels(html).slice(1).forEach(p =>
    assert.match(p.attrs, /hidden/, 'stage ' + p.stage + ' is not hidden'));

  // Suggest Goals spans distance (02), benchmark (05) and the goals (08).
  const sg = SRC.slice(SRC.indexOf('function handleSuggestGoals'));
  const sgBody = sg.slice(0, sg.indexOf('\n}\n'));
  ['su-bench-dist', 'su-bench-time', 'su-distance', 'su-goal-'].forEach(id =>
    assert.ok(sgBody.includes(id), 'handleSuggestGoals no longer reads ' + id));

  // The units control converts the volume typed on a later stage.
  const um = SRC.indexOf("var unitsBox = document.getElementById('su-units')");
  assert.notEqual(um, -1, 'the units handler is gone');
  assert.ok(SRC.slice(um, um + 1200).includes("getElementById('su-volume')"),
    'the units handler no longer converts the volume field');
});

test('changing the purpose still rewrites the later stages it governs', () => {
  const fn = SRC.slice(SRC.indexOf('function bldApplyPurpose'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(body.includes('su-distance-label'), 'the distance label no longer follows the purpose');
  assert.ok(body.includes('su-weeks-hint'), 'the block-length hint no longer follows the purpose');
  assert.ok(body.includes('bld-race-only'), 'the event question is no longer hidden for non-race blocks');
  assert.ok(body.includes('lockDistance'), 'Speed no longer locks its distance');
});

// -------------------------------------------------------------- 5. the no-HR path
test('skipping heart rate clears the fields rather than inventing a value', () => {
  const fn = SRC.slice(SRC.indexOf('function handleBldSkipHR'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.ok(/su-lthr/.test(body) && /su-maxhr/.test(body), 'the skip does not touch both fields');
  assert.match(body, /el\.value = ''/, 'the skip does not blank the inputs');
  // nothing that looks like a fabricated number, an estimate or a second path
  assert.doesNotMatch(body, /2[0-9]{2}|1[0-9]{2}/,
    'the skip writes a numeric heart rate — Sacoro has no methodology for inventing one');
  assert.doesNotMatch(body, /age|estimate|220|default/i,
    'the skip infers a heart rate instead of leaving it blank');
  assert.match(body, /handleBldNext\(\)/, 'the skip does not advance the journey');

  // and the generator still treats blank as "no HR data"
  const gp = SRC.slice(SRC.indexOf('async function handleGeneratePlan'));
  assert.match(gp.slice(0, 4000), /isNaN\(lthrInput\)/,
    'handleGeneratePlan no longer tolerates a blank LTHR');
});

test('the reassurance and the explanation are on the heart-rate screen', () => {
  const { html } = buildJourney();
  const hr = panels(html).find(p => p.stage === STAGE('TRAINING')).body;
  assert.ok(hr.includes('Lactate Threshold Heart Rate'),
    'the acronym is still unexplained');
  assert.ok(/Don.t know it\? That.s completely fine/.test(hr),
    'the approved reassurance is missing from the heart-rate screen');
  assert.ok(hr.includes('data-action="bld-skip-hr"'), 'there is no visible no-HR affordance');
});

/* TWO DIFFERENT DECISIONS, TWO DIFFERENT SCREENS.
   LTHR and Max HR are training target data. Permission to read broader health
   and readiness information is a separate question, and it now lives on Review
   -- the screen where the decision is actually recorded, since Generate is what
   writes it. What must NOT happen is the two being conflated again, or the
   permission being implied by anything other than the tick. */
test('the health permission is a separate decision from the heart-rate numbers', () => {
  const { html } = buildJourney();
  const p = panels(html);
  const hr = p.find(x => x.stage === STAGE('TRAINING')).body;
  const review = p.find(x => x.stage === STAGE('REVIEW')).body;

  assert.doesNotMatch(hr, /su-health-consent/,
    'the permission is back on the heart-rate screen, which is two decisions on one screen');
  assert.ok(review.includes('id="su-health-consent"'),
    'the permission is not on Review, where the decision is recorded');

  // exactly once in the whole journey -- two boxes would be two answers
  const total = (html.match(/id="su-health-consent"/g) || []).length;
  assert.equal(total, 1, 'the consent box appears ' + total + ' times');

  // named as optional, and separated from the plan summary rather than tucked in
  assert.match(review, /class="bld-permission"/,
    'the permission is not in its own separated section');
  assert.match(review, /Optional permission/,
    'the permission section is not named as optional');
});

test('the permission is never pre-granted, and nothing but the tick grants it', () => {
  const { html } = buildJourney();
  const box = html.match(/<input type="checkbox" id="su-health-consent"[^>]*>/);
  assert.ok(box, 'the consent checkbox is gone');
  assert.doesNotMatch(box[0], /\bchecked\b/,
    'the consent box ships pre-ticked — consent would be assumed, not given');

  // the generator still takes the decision from the box, before it reads the
  // two fields the decision governs
  const at = SRC.indexOf('async function handleGeneratePlan');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  const consentAt = body.indexOf("getElementById('su-health-consent')");
  const lthrAt = body.indexOf("getElementById('su-lthr')");
  assert.ok(consentAt !== -1 && lthrAt !== -1, 'the generator stopped reading one of them');
  assert.ok(consentAt < lthrAt,
    'the heart rate is read before the permission that governs whether it may be stored');
  assert.match(body.slice(lthrAt, lthrAt + 700), /healthConsentGranted\(\)/,
    'heart rate is stored without checking the permission');
});

// AUDIT REPRO (Final Full Product Audit, Part 14, finding A -- release
// blocker). bldRenderReview() read su-lthr/su-maxhr straight off the DOM and
// unconditionally rendered "Heart rate: LTHR ... Max ..." whenever the
// fields were non-blank, with no check against the same
// healthConsentGranted() predicate handleGeneratePlan() actually gates
// storage on. An athlete who typed LTHR/MaxHR and left the (ordinary,
// fully-supported) consent box unticked saw Review confirm numbers that
// Generate then silently discarded -- no toast, no error, and for an
// athlete who had already declined consent in an earlier session, the
// checkbox does not even render (healthConsentAnswered() guard), so there
// was no explanation surface in that dialog at all.
test('Review describes what Generate will actually save, not just what was typed', () => {
  const at = SRC.indexOf('function bldRenderReview');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(body, /getElementById\('su-health-consent'\)/,
    'Review must consult the same consent box the generator reads');
  assert.match(body, /healthConsentGranted\(\)/,
    'Review must fall back to the stored decision when the box is not on screen (an athlete who already answered)');
  assert.match(body, /not saved/,
    'when consent will not be granted, the Heart rate row must say so rather than presenting the numbers as saved');
});

// ------------------------------------------------------- 6. goals, every purpose
test('goals are asked for every block purpose, because every pace descends from them', () => {
  ['race', 'maintain', 'base', 'speed'].forEach(purpose => {
    const { html } = buildJourney(a => {
      a.state.setup = Object.assign({}, a.state.setup, { purpose: purpose });
    });
    const targets = panels(html).find(p => p.stage === STAGE('TARGETS')).body;
    ['A', 'B', 'C'].forEach(k =>
      assert.ok(targets.includes('id="su-goal-' + k + '"'),
        purpose + ' lost goal ' + k + ' — that block would have no pace source'));
    assert.ok(targets.includes('data-action="suggest-goals"'),
      purpose + ' lost Suggest Goals From Benchmark');
  });
});

test('the goal requirement is not conditional on the purpose', () => {
  // getActiveVDOT() derives every training pace from the active goal, so a
  // purpose-gated requirement would leave non-race blocks with no paces.
  const at = SRC.indexOf('async function handleGeneratePlan');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  const idx = body.indexOf('if (!anyGoal)');
  assert.notEqual(idx, -1, 'the generator no longer requires a goal time at all');
  assert.match(body.slice(idx, idx + 140), /showToast\('Enter at least one goal time/,
    'the unconditional goal requirement changed shape');
  // nothing between the goals loop and the check may gate it on the purpose
  assert.doesNotMatch(body.slice(idx - 500, idx), /buildPurpose ===/,
    'the goal requirement became purpose-conditional');
  assert.doesNotMatch(body.slice(idx, idx + 140), /buildPurpose|purpose ===/,
    'the goal requirement became purpose-conditional');
});

// --------------------------------------------------------------- 7. composition
/* ---- THIS ASSERTION CHANGED SIDES, AND SO DID THE SCREEN ----
   It required a 2x2 of 118px rimmed tiles, on the argument that four large
   boxes read as four choices. Every comparable control in the product has
   since stopped drawing a box to say "pick me" -- the session-type picker,
   the A/B/C goal options, the bottom nav all answer it with light on the
   words -- and four boxes inside a modal card was the box-on-a-box this app
   gave up everywhere else. As rows the four also start at the modal's own
   gutter, which the tiles' 13px of padding did not.
   What the test was protecting is untouched and still below: four of them,
   the selected one GOLD, and never the cherry action colour. */
test('the four objectives are boxes in one column, wearing the cherry selected state', () => {
  const { html } = buildJourney();
  const goal = panels(html).find(p => p.stage === STAGE('GOAL')).body;
  assert.equal((goal.match(/class="bld-purpose-card/g) || []).length, 4,
    'the goal screen does not show four objectives');

  /* ---- AND THIS HAS CHANGED SIDES AGAIN ----
     It required NO ground, NO rim and the modal's own gutter, from a pass
     that stripped the boxes off every choice in the build. Goal distance
     has since gone back to stacked boxes with a cherry-lined chosen state,
     and the founder has asked for this screen to follow it: "Your goal page
     needs to follow the goal distance layout."
     So the assertion is now the opposite, and it is the SAME box -- the one
     .opt-grid button and the experience cards draw -- rather than a third
     thing that merely looks similar. What the test has always really been
     for is directly below and unchanged: four objectives, exactly one
     chosen, announced as one radio group, and the chosen one marked in the
     selection colour rather than the action colour. */
  const css = SRC.slice(SRC.indexOf('.bld-purpose{'), SRC.indexOf('.bld-date input'));
  assert.match(css, /\.bld-purpose\{[^}]*grid-template-columns:1fr;/,
    'the objectives are back in a grid of more than one column');
  assert.match(css, /\.bld-purpose button\{[^}]*background:var\(--t-tile\)/,
    'the objectives lost the box the founder asked for');
  assert.match(css, /\.bld-purpose button\{[^}]*border:1px solid var\(--t-tile-rim\)/,
    'the objectives lost their rim');
  assert.match(css, /\.bld-purpose button\{[^}]*border-radius:var\(--tile-radius\)/,
    'the objectives left the product radius');
  /* Chosen is the cherry line, same as every other choice in the build, and
     explicitly NOT a cherry fill -- Continue carries that at the foot of
     the same screen. */
  const on = css.match(/\.bld-purpose button\.active\{([^}]*)\}/)[1];
  assert.match(on, /border-color:var\(--cherry\)/, 'the chosen objective lost its cherry line');
  assert.doesNotMatch(on, /background:var\(--cherry/, 'the chosen objective is filled cherry');
  assert.doesNotMatch(on, /gold/i, 'the chosen objective is still gold');

  /* ONE CHOICE, NOT FOUR TOGGLES. aria-pressed announces four independent
     buttons, each "pressed" or not, with nothing saying only one may be.
     That mattered less while each wore a lit box; with the boxes gone the
     semantics carry more of the meaning. */
  assert.match(goal, /role="radio" aria-checked="true"/, 'no objective is marked chosen');
  assert.equal((goal.match(/aria-checked="true"/g) || []).length, 1,
    'more than one objective is marked chosen');
  assert.equal((goal.match(/role="radio"/g) || []).length, 4);
  assert.doesNotMatch(goal, /aria-pressed/, 'the objectives are toggles again');
  assert.match(html, /role="radiogroup"/, 'the four rows are not announced as one choice');

  /* ---------- THE CHOSEN OPTION CARRIES A TICK ----------
     Nothing LEADS the title -- the mock's radio circle would have been the
     only leading glyph left in the product and it held every title 36px
     off the gutter. The mark goes at the trailing edge instead, where the
     tab chevrons are, so it costs the words nothing.
     Drawn only when chosen, not drawn-and-hidden: measured at 360 and 412,
     no sub re-wraps and no row changes height when the column loses those
     31px, so the three invisible ticks an earlier version drew were
     preventing a reflow that does not happen. */
  assert.doesNotMatch(goal, /bld-purpose-card[^>]*>\s*<span class="bpc-(?!text)/,
    'something is drawn in front of an objective title');
  assert.equal((goal.match(/class="bpc-tick"/g) || []).length, 1,
    'the tick is drawn on rows that are not chosen, or not at all');
  const tickAt = goal.indexOf('bpc-tick'), textAt = goal.indexOf('bpc-text');
  assert.ok(textAt > -1 && tickAt > textAt, 'the tick is emitted before the words');

  /* AND THE POOL IS NOW LOAD-BEARING, so it is held here. With the circle
     and the tick both gone it is the only mark on this screen: lose it and
     a chosen objective is a line of gold text among three white ones, with
     nothing under it saying the row was picked. It went unguarded until a
     mutation removed it and every assertion still passed. */
  const pcss = SRC.slice(SRC.indexOf('.bld-purpose{'), SRC.indexOf('.bld-date input'));
  assert.match(pcss, /\.bld-purpose button::before\{[^}]*radial-gradient/,
    'the objective rows lost the gold pool that marks the chosen one');
  assert.match(pcss, /\.bld-purpose button\.active::before\{[^}]*opacity:0/,
    'the gold pool still lights under the cherry line');
  assert.match(pcss, /\.bld-purpose button\.active \.bpc-name\{[^}]*color:var\(--cherry-text\)/,
    'the chosen name is not in the selection colour');
  /* THIS PAIR HAS SWAPPED. It read "selected is GOLD, never the Cherry
     Lacquer action colour" -- and the never-cherry half was called the one
     that mattered. The founder has reversed the rule across the whole
     build, so cherry marks a choice here now. What stops that colliding
     with Continue is the LINE/FILL distinction, not the hue: Continue
     carries --cherry-fill as a solid, a chosen objective carries --cherry
     as a 1px edge over the unchanged surface. A fill here is the defect to
     catch, and it is caught above. */
  assert.doesNotMatch(css, /\.bld-purpose button\.active\{[^}]*gold/,
    'the selected objective is back on the gold selection language');
});

/* ---- THIS TEST HAS CHANGED SIDES ----
   It required the five distances to sit 3 + 2 on a six-column track, so
   the fifth was not stranded on a line of its own. On instruction the
   options now STACK: one column, full width, every label with the whole
   modal to sit in. There is no row to share, so there is nothing left to
   strand and the six-column track is gone.
   What replaces it is the law one level up -- .opt-grid defaults to a
   single column, and only a grid of short TOKENS asks for columns. That
   is where the real defect lived: .cols-3 on a grid of words is what put
   ESTABLISHED in 93px of track and hung it off the edge of the card. */
test('a choice stacks by default, and only token grids ask for columns', () => {
  const { html } = buildJourney();
  const dist = panels(html).find(p => p.stage === STAGE('DISTANCE')).body;
  assert.match(dist, /class="opt-grid opt-grid-32"/, 'the distance grid lost its hook');

  /* The DEFAULT is one column. Read the base rule, not a later override. */
  const base = /\n  \.opt-grid\{([^}]*)\}/.exec(SRC);
  assert.ok(base, 'the .opt-grid base rule is gone');
  assert.match(base[1], /grid-template-columns:1fr;/,
    'a choice is laid out in columns by default again');

  /* .opt-grid-32 must NOT be redeclared: a rule restating the default is
     the one a future three-across change forgets to remove. */
  assert.doesNotMatch(SRC, /\.opt-grid\.opt-grid-32\{/,
    'the distance grid has a track of its own again');
  assert.doesNotMatch(SRC, /\.opt-grid-32 > button:nth-child/,
    'the distance tiles are spanning columns again');

  /* ONLY THE TOKEN GRIDS CARRY cols-N, AND THIS IS THE WHOLE LIST.
     A worded grid that gains one gets narrow cells and an unbreakable
     label that widens its own track rather than wrapping -- which is the
     bug this replaced, and the one the experience grid shipped with. */
  const withCols = [];
  const re = /<div class="opt-grid[^"]*\bcols-\d+[^"]*"([^>]*)>/g;
  let m;
  while ((m = re.exec(SRC))) {
    const id = /id="([^"]+)"/.exec(m[1]);
    const al = /aria-label="([^"]+)"/.exec(m[1]);
    const dm = /data-mirror="([^"]+)"/.exec(m[1]);
    withCols.push((id && id[1]) || (dm && dm[1]) || (al && al[1]) || '?');
  }
  /* The eight day counts left this list when they became a slider. Founder:
     "Change build a plan to have this 4 areas as the slider options." See
     test/builderSliders.test.js. */
  assert.deepEqual(withCols.sort(), ['bld-longday-grid'].sort(),
    'a grid that is not short tokens (single digits, three-letter weekdays) ' +
    'is asking for columns: ' + withCols.join(', '));
});

test('units are on the distance screen, and set back from it', () => {
  const { html } = buildJourney();
  const dist = panels(html).find(p => p.stage === STAGE('DISTANCE')).body;
  assert.ok(dist.includes('id="su-units"'), 'units are not on the distance screen');
  assert.match(dist, /class="field bld-secondary"/,
    'units are given the same weight as the distance question');
});

// ------------------------------------------------------------- 7. overview
/* Pure orientation, added ahead of Goal. It must never behave like a
   question: no input for handleGeneratePlan() to read, no validation rule
   to block Continue, and Back must not appear on the one screen that has
   nowhere to go back to. */
test('Overview is stage zero, has no field and no validation rule, and Continue always passes', () => {
  const { a, html } = buildJourney();
  const overview = panels(html).find(p => p.stage === STAGE('OVERVIEW')).body;

  assert.match(overview, /class="bld-overview"/, 'the overview info box is missing');
  assert.equal((overview.match(/class="bld-overview-row"/g) || []).length, 3,
    'the overview does not show exactly three rows');
  // no <input>/<select>/<button data-v> on this screen -- it asks nothing
  assert.doesNotMatch(overview, /<input\b|<select\b|data-v="/,
    'Overview contains a real field -- it is meant to be orientation only, not a tenth question');
  // Back is suppressed on stage 0, same rule as the old first stage always had
  assert.doesNotMatch(overview, /data-action="bld-back"/,
    'Overview shows a Back button with nothing behind it');

  assert.equal(a.bldValidateStage(0), true, 'bldValidateStage(0) blocks Continue on Overview');
});

test('Overview carries the approved heading and lede, and the rail starts on it', () => {
  const { html } = buildJourney();
  /* THE CORNER LABEL IS GONE and this asked for it by name. "GOAL" sat
     top-right above a heading reading "Your goal", "REVIEW" above "What
     Sacoro understands" -- the stage naming itself twice. What the test
     is about is that the flow OPENS ON STAGE ONE, so it asks the two things
     that still say so: the counter, and which rail segment is current. */
  const totalStr = String(SPEC_STAGES.length).padStart(2, '0');
  assert.ok(html.includes('id="bld-no">01 / ' + totalStr + '<'),
    'the builder does not open on the first of ' + SPEC_STAGES.length);
  assert.match(html, /<div class="bld-progress" id="bld-rail">/, 'the progress rail is gone');
  /* Matched on the segments themselves rather than on the rail's innerHTML:
     a non-greedy span to the first </div> captures only segment one. */
  const segs = html.match(/class="bld-step[^"]*"/g) || [];
  assert.equal(segs.length, SPEC_STAGES.length, 'the rail no longer has one segment per stage');
  assert.match(segs[0], /\bnow\b/, 'the rail does not open on the first stage');
  assert.ok(!segs.slice(1).some(s => /\b(now|done)\b/.test(s)),
    'a later rail segment is already lit on arrival');
  assert.doesNotMatch(html, /bld-stage-name/,
    'the redundant corner label is back');

  /* THE APPROVED HEADING, ON THE SCREEN, ONCE. This used to ask only that
     the string appeared inside the stage-0 PANEL, which it did -- and so
     did the modal head wrapping it, so the builder's first screen printed
     "Build Your Training Block" twice, forty pixels apart, and this test
     was satisfied by the duplicate. Asked at the screen level it covers
     both failures: the copy going missing, and it being said twice.
     Which of the two carries it is the app's business and not the
     builder's. start.html runs the same stages as a page with no modal
     head, so there the stage heading is the only title on screen; here the
     modal head is, and the panel keeps the lede, which is the line that
     orients rather than names. */
  assert.equal((html.match(/Build Your Training Block/g) || []).length, 1,
    'the Overview screen names itself ' +
    (html.match(/Build Your Training Block/g) || []).length +
    ' times; the approved heading belongs on it exactly once');

  const overview = panels(html).find(p => p.stage === STAGE('OVERVIEW')).body;
  assert.match(overview, /A plan, built around you\./, 'the approved lede is missing');
});

/* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE SCREEN ----
   It required the chips to have NO rim, NO ground and NO lift -- bare
   crisp-white words on a gold pool -- on the argument that every
   comparable control in the product answers "which of these" with light
   rather than a box, and that the objectives one screen earlier had just
   stopped being boxes.
   The founder has reversed that for the chips, against a screenshot of
   the Goal Distance stage: five distances floating on a dark modal give
   the eye no edge, and the instruction was to use the boxes Today draws
   for Share / Session Details / Your Log / Sacoro Analysis. So the box
   is back, and it is .sess-tab's, not a new one.
   WHAT THIS TEST WAS REALLY PROTECTING IS UNTOUCHED and still below: the
   chosen chip is GOLD and never the cherry action colour, the pool still
   marks it, and the tick still sits under the label in room the chip
   reserves whether it is chosen or not.
   THE OBJECTIVES WERE NOT SWEPT WITH IT. Reversing their own pass was not
   asked for, and the test above still holds them as rows. The build does
   now answer a choice two ways one Continue apart; that is the founder's
   call, recorded here so the next reader does not take it for drift. */
test('every choice in the build is made the same way', () => {
  const css = SRC.slice(SRC.indexOf('.opt-grid{'), SRC.indexOf('.bld-date input'));
  /* A BOX, AND THE PRODUCT'S OWN. .sess-tab's three declarations, so a
     chip cannot quietly become a fourth kind of surface. */
  assert.match(css, /\.opt-grid button\{[^}]*border:1px solid var\(--tile-border\)/,
    'the chips lost the rim the founder asked for');
  assert.match(css, /\.opt-grid button\{[^}]*background:var\(--tile-sheen\), var\(--bg-2\)/,
    'the chips are not drawing Today\u2019s surface any more');
  assert.match(css, /\.opt-grid button\{[^}]*border-radius:var\(--tile-radius\)/,
    'the chips left the product radius');
  assert.match(css, /\.opt-grid button::before\{[^}]*radial-gradient/,
    'the chips lost the gold pool that marks the chosen one');
  /* ---- THE SELECTED STATE IS A CHERRY LINE, AND THAT IS THE THIRD GO ----
     Gold rim and halo, then a filled --cherry-fill box, now a 1.5px
     --cherry rim over the unchanged surface. The middle one is worth
     recording because it is the one that looked right in isolation and
     wrong on the screen: a filled cherry option sat a few hundred pixels
     above a filled cherry Continue, same radius, same height, and read as
     a second button. Founder: "Not fully cherry. Like the coaches note."
     A LINE IS NOT A FILL, which is why cherry can mark a choice here
     without taking the action's weight -- and the surface staying put is
     half of that. If a future change fills this box, the collision comes
     straight back, so the fill is asserted against. */
  const on = css.match(/\.opt-grid button\.active\{([^}]*)\}/)[1];
  assert.match(on, /border-color:var\(--cherry\)/,
    'the chosen option lost its cherry line');
  /* NO border-width HERE, and that is the assertion. The Coach's Note
     renders a 1px cherry edge; its rule says 1.5px and does not win.
     Copying the declaration instead of the rendered value gave this box a
     heavier edge than the one it quotes, so the chosen option keeps the
     1px it already has at rest and changes colour only. */
  assert.doesNotMatch(on, /border-width/,
    'the chosen option is thickening its edge -- the Coach\u2019s Note renders 1px');
  assert.doesNotMatch(on, /background:var\(--cherry/,
    'the chosen option is filled cherry again -- that is Continue\u2019s weight, ' +
    'and it put a choice and a button side by side on one screen');
  /* ---- AND THE GLOW HAS COME BACK, ON INSTRUCTION ----
     This asserted box-shadow:none one change ago, because the founder had
     said "without a glow". They have since said "add a glow to the
     cherry", so the line is lit. What is pinned is WHICH glow: the
     product's own cherry glow, which the workout blueprint's work step
     and the race event card already wear. A number invented for this one
     screen is the thing to catch, not the glow itself. */
  assert.match(on, /box-shadow:0 0 16px var\(--cherry-dim\)/,
    'the chosen option is not wearing the product\u2019s cherry glow');
  assert.doesNotMatch(on, /inset/,
    'the glow is washing the inside of the box -- the chosen box has no tint, ' +
    'and an inner wash is how a line starts becoming a fill');
  /* The pool was what marked the chosen one while there was no fill. It is
     the hover cue now, and must not come up underneath the cherry. */
  assert.match(css, /\.opt-grid button\.active::before\{[^}]*opacity:0/,
    'the gold pool still lights under the cherry fill');

  /* ---------- AND A CHOSEN CHIP CARRIES ONE TOO ----------
     Drawn in CSS rather than markup on purpose: the chips are written out
     at seven separate call sites and one of them is filled by script, so a
     span added by hand would be added six times and missed once.
     UNDER THE LABEL, CENTRED. The corner was tried first and measured at
     360px it overlapped HALF MARATHON, FULL MARATHON, DEVELOPING,
     ESTABLISHED and ADVANCED -- a label that wraps to two lines has a box
     the full width and height of its cell, so there is no corner left.
     Its room is held by the chip's own bottom padding, which is on every
     chip chosen or not, so picking one moves nothing. */
  assert.match(css, /\.opt-grid button\.active::after\{[^}]*var\(--tick-mask\)/,
    'a chosen chip no longer carries the tick');
  /* THE MARK MOVED WHEN THE SHAPE DID. Stacked, an option is a full-width
     row with empty space either side of a centred label, so the tick takes
     the trailing edge -- where the objective rows and the Today tabs put
     theirs. A grid that still asks for COLUMNS has narrow cells and keeps
     the mark under the label with the bottom padding that holds its room:
     measured with every option lit, the trailing edge lands 3px inside a
     day-count digit and 1px inside MON. Both placements are held here so
     neither can be dropped onto the other's layout. */
  assert.match(css, /\.opt-grid button\.active::after\{[^}]*right:13px/,
    'the stacked option lost its trailing-edge tick');
  assert.match(css, /\.opt-grid\.cols-3 button\.active::after[^{]*\{[^}]*bottom:6px/,
    'a token grid is not keeping the mark under its label, so the tick can reach the digits');
  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE SCREEN ----
     It required `padding:14px 10px 26px`: the mark's room came from 26px of
     bottom padding, which bought it by pushing the label UP. Founder, on a
     screenshot of the 0-7 grid: "check the numbers are centre of the
     squares." They were not, and that padding is why -- a digit centred in
     its own 20px content box sat in the top half of a 60px cell.
     Padding that has to stay symmetric to centre cannot also reserve room
     at one end, so the reserve moved into the cell's HEIGHT and the label
     is centred by flex. The thing the old assertion was really protecting
     -- the mark never reaching the digits -- is now checked by arithmetic
     rather than by a literal, so shrinking the box or growing the tick
     fails here instead of rendering a tick through a numeral. */
  const cell = css.match(/\.opt-grid\.cols-3 button, \.opt-grid\.cols-4 button\{([^}]*)\}/);
  assert.ok(cell, 'the token grids no longer have a rule of their own');
  assert.match(cell[1], /align-items:center/,
    'a token grid stopped centring its label, so the digit floats in the box again');
  assert.doesNotMatch(cell[1], /padding:\s*\d+px\s+\d+px\s+\d+px/,
    'a token grid is reserving the tick\u2019s room with asymmetric padding again, ' +
    'which is the thing that knocked the digit off centre');
  const tickRule = css.match(/\.opt-grid\.cols-3 button\.active::after[^{]*\{([^}]*)\}/)[1];
  const px = (body, prop) => {
    const m = body.match(new RegExp(prop + ':(\\d+)px'));
    assert.ok(m, 'cannot read ' + prop + ' -- the clearance can no longer be checked');
    return parseInt(m[1], 10);
  };
  const minH = px(cell[1], 'min-height');
  /* 20px is the measured line box of a single --fs-data mono digit, which is
     the tallest thing these cells hold on one line. Centred, its foot sits
     half a label below the middle. */
  const LABEL_BOX = 20;
  const tickTop   = minH - px(tickRule, 'bottom') - px(tickRule, 'height');
  const labelFoot = minH / 2 + LABEL_BOX / 2;
  assert.ok(tickTop - labelFoot >= 6,
    'the mark now clears a centred label by ' + (tickTop - labelFoot) + 'px; ' +
    'the measurement this grid was settled on is 6px, and below that the tick ' +
    'starts touching the digits');
  /* One polyline for both marks, so the CSS-drawn tick and the markup one
     cannot become two ticks that merely look alike. */
  assert.match(SRC, /--tick-mask:url\("data:image\/svg\+xml[^"]*polyline points='5,13 10,18 19,7'/,
    'the chip tick is no longer ICONS.check\u2019s own polyline');
});

test('the weekday checkboxes keep their cherry ring', () => {
  /* NOT swept with the rest, on instruction -- "leave check boxes cherry".
     It is also a different question: five of seven days is a multi-select,
     not "which one of these", and the control deliberately reuses the day
     card's own completion ring. Gold marks a single choice; this is not
     one. Named here so a later pass over "selection" does not take it. */
  const css = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  const i = css.indexOf('.wd-check input:checked');
  assert.ok(i > -1, 'the weekday ring is gone');
  assert.match(css.slice(i, i + 220), /--cherry/,
    'the weekday ring has been recoloured away from cherry');
});
