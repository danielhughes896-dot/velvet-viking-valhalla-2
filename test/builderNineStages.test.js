'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* BUILD YOUR TRAINING BLOCK — the nine-stage journey.
 * ===========================================================================
 * The builder went from five stages to nine. That is an information
 * architecture change, not a data one: the generator still reads the same
 * element ids out of the same mounted panels, and no rule was added, removed
 * or moved to a different question.
 *
 * The five-stage structure had NO test at all, which is why the restructuring
 * could have silently dropped an input, orphaned a validation rule or
 * unmounted a panel that another stage reads across. These tests hold the
 * things that would break quietly:
 *
 *   1. NINE STAGES, and the rail/numeral agree with that count.
 *   2. EVERY GENERATOR INPUT IS STILL THERE, exactly once, on some panel.
 *   3. EVERY VALIDATION RULE STILL POINTS AT THE SCREEN THAT ASKS ITS QUESTION.
 *   4. THE CROSS-STAGE COUPLINGS SURVIVE, which requires panels to stay mounted.
 *   5. THE NO-HR PATH IS THE EXISTING BLANK PATH, not a fabricated value.
 *   6. GOALS ARE ASKED FOR EVERY PURPOSE, because every pace descends from them.
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
test('the builder is nine stages, and the rail and numeral agree', () => {
  const { a, html } = buildJourney();

  assert.equal(a.BLD_STAGE_NAMES.length, 9,
    'BLD_STAGE_NAMES declares ' + a.BLD_STAGE_NAMES.length + ' stages, not nine');

  const p = panels(html);
  assert.equal(p.length, 9, 'the journey rendered ' + p.length + ' panels');
  assert.deepEqual(p.map(x => x.stage), [0, 1, 2, 3, 4, 5, 6, 7, 8],
    'the panels are not a contiguous 0..8 run');

  // one rail segment per stage -- the rail is built from the same array
  const rail = html.match(/<div class="bld-step[^"]*"><\/div>/g) || [];
  assert.equal(rail.length, 9, 'the rail drew ' + rail.length + ' segments for nine stages');
  assert.match(html, /id="bld-no">01 \/ 09</,
    'the stage numeral does not open on 01 / 09');

  // exactly one panel visible at rest, and it is the first
  const shown = p.filter(x => !/hidden/.test(x.attrs));
  assert.deepEqual(shown.map(x => x.stage), [0],
    'more than one panel (or the wrong one) is visible when the builder opens');
});

test('the nine stages are the approved sequence', () => {
  const { a } = buildJourney();
  assert.deepEqual([...a.BLD_STAGE_NAMES],
    ['Goal', 'Distance', 'Event', 'You', 'Benchmark', 'Week', 'Training data', 'Targets', 'Review']);
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
  const EXPECTED = {
    'su-purpose': 0,
    'su-distance': 1, 'su-units': 1,
    'su-event-box': 2, 'su-racedate': 2, 'su-weeks': 2,
    'su-experience': 3, 'su-volume': 3,
    'su-bench-dist': 4, 'su-bench-time': 4,
    'su-weekdays': 5, 'su-longday': 5,
    'su-lthr': 6, 'su-maxhr': 6,
    'su-goal-A': 7, 'su-goal-B': 7, 'su-goal-C': 7,
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
  // The four rules the five-stage builder enforced, and their exact thresholds.
  const fn = SRC.slice(SRC.indexOf('function bldValidateStage'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /Pick an event date\./);
  assert.match(body, /Event date needs to be in the future\./);
  assert.match(body, /wks < 4 \|\| wks > 24/);
  assert.match(body, /!volume \|\| volume <= 0/);
  assert.match(body, /checked < 3 \|\| checked > 6/);
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
    'the skip writes a numeric heart rate — Valhalla has no methodology for inventing one');
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
  const hr = panels(html).find(p => p.stage === 6).body;
  assert.ok(hr.includes('Lactate Threshold Heart Rate'),
    'the acronym is still unexplained');
  assert.ok(/Don.t know it\? That.s completely fine/.test(hr),
    'the approved reassurance is missing from the heart-rate screen');
  assert.ok(hr.includes('data-action="bld-skip-hr"'), 'there is no visible no-HR affordance');
});

test('health consent stays on the screen holding the data it governs', () => {
  const { html } = buildJourney();
  const p = panels(html);
  const hr = p.find(x => x.stage === 6).body;
  assert.ok(hr.includes('id="su-health-consent"'),
    'the consent box is not on the same screen as LTHR and Max HR');
  // and nowhere else in the journey
  const total = (html.match(/id="su-health-consent"/g) || []).length;
  assert.equal(total, 1, 'the consent box appears ' + total + ' times');
});

// ------------------------------------------------------- 6. goals, every purpose
test('goals are asked for every block purpose, because every pace descends from them', () => {
  ['race', 'maintain', 'base', 'speed'].forEach(purpose => {
    const { html } = buildJourney(a => {
      a.state.setup = Object.assign({}, a.state.setup, { purpose: purpose });
    });
    const targets = panels(html).find(p => p.stage === 7).body;
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
test('the four objectives are a 2x2 of cards wearing the gold selected state', () => {
  const { html } = buildJourney();
  const goal = panels(html).find(p => p.stage === 0).body;
  assert.equal((goal.match(/class="bld-purpose-card/g) || []).length, 4,
    'the goal screen does not show four objective cards');

  const css = SRC.slice(SRC.indexOf('.bld-purpose{'), SRC.indexOf('.bld-date input'));
  assert.match(css, /\.bld-purpose\{[^}]*grid-template-columns:1fr 1fr/,
    'the objectives are not laid out two across');
  // selected state is GOLD (--modal-active), never the Cherry Lacquer action colour
  assert.match(css, /\.bld-purpose button\.active\{[^}]*--modal-active/,
    'the selected objective no longer uses the gold selection language');
  assert.doesNotMatch(css, /\.bld-purpose button\.active\{[^}]*--cherry/,
    'a selected objective is wearing the primary-action colour');
});

test('the five distances are laid out three then two, with nothing stranded', () => {
  const { html } = buildJourney();
  const dist = panels(html).find(p => p.stage === 1).body;
  assert.match(dist, /class="opt-grid opt-grid-32"/, 'the distance grid is not the 3+2 composition');

  const css = SRC.slice(SRC.indexOf('.opt-grid.opt-grid-32'));
  const block = css.slice(0, 400);
  assert.match(block, /grid-template-columns:repeat\(6,1fr\)/, 'the 3+2 track is not six columns');
  assert.match(block, /nth-child\(-n\+3\)\{grid-column:span 2\}/.source ? /nth-child\(-n\+3\)[^}]*span 2/ : /(?!)/,
    'the first three tiles do not span two columns each');
  assert.match(block, /nth-child\(n\+4\)[^}]*span 3/,
    'the last two tiles do not share the row evenly');
});

test('units are on the distance screen, and set back from it', () => {
  const { html } = buildJourney();
  const dist = panels(html).find(p => p.stage === 1).body;
  assert.ok(dist.includes('id="su-units"'), 'units are not on the distance screen');
  assert.match(dist, /class="field bld-secondary"/,
    'units are given the same weight as the distance question');
});
