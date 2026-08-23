'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const Preview = require('../api/_preview.js');
const BUILDER_SPEC = require('../assets/builder-spec.js');

// THE CANONICAL BUILDER SPECIFICATION -- ONE SOURCE, ZERO DRIFT.
//
// assets/builder-spec.js is the single authority for the nine-stage builder's
// shape: stage names/order, purpose/distance/experience/benchmark taxonomy,
// field defaults, validation thresholds and the goal-ambition mapping. The
// protected app, /start's public wizard and api/_preview.js's request
// validation all read the SAME object -- this file proves they still do, so
// a hand-edit to any one surface's copy of a rule fails here instead of
// drifting silently out of step with the other two.
//
// These tests are the ones the reconciliation task asked for explicitly:
// both surfaces expose exactly nine stages, in the same order, with the same
// field definitions/defaults/validation/ambition mapping, and the old
// condensed one-page questionnaire no longer exists as the public builder.

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const APP_SRC = read('protected/velvet-viking-valhalla.html');
const START_SRC = read('start.html');
const TODAY = '2026-08-20T09:00:00Z';

// ---------------------------------------------------------------------------
// 1. EXACTLY NINE STAGES, ONE CANONICAL LIST
// ---------------------------------------------------------------------------
test('the canonical spec defines exactly nine stages', () => {
  assert.equal(BUILDER_SPEC.stages.length, 9);
  BUILDER_SPEC.stages.forEach((s) => {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.heading, 'string');
    assert.equal(typeof s.lede, 'string');
  });
});

test('the app builder exposes exactly the canonical spec\'s nine stage names, in order', () => {
  const app = loadApp({ pinnedDate: TODAY });
  assert.equal(app.BLD_STAGE_NAMES.length, 9);
  assert.equal(JSON.stringify(Array.from(app.BLD_STAGE_NAMES)),
    JSON.stringify(BUILDER_SPEC.stages.map((s) => s.name)),
    'the app\'s stage names/order no longer match the canonical spec');
  // Consumption, not re-declaration: BLD_STAGE_NAMES is read FROM the spec.
  const fn = APP_SRC.slice(APP_SRC.indexOf('var BLD_STAGE_NAMES'));
  assert.match(fn.slice(0, 120), /BUILDER_SPEC\.stages\.map\(/,
    'the app redeclares its own stage-name list instead of reading the canonical spec');
});

test('/start\'s wizard reads the same nine stages from the same object, not a second list', () => {
  assert.match(START_SRC, /var BLD_STAGES = BS\.stages;/,
    '/start no longer sources its stage list from window.BUILDER_SPEC');
  // Nine render functions, one per stage, in the same order the spec lists.
  const arr = /var BLD_RENDERERS = \[([^\]]*)\];/s.exec(START_SRC);
  assert.ok(arr, 'BLD_RENDERERS was not found');
  const names = arr[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.equal(names.length, 9, '/start does not render exactly nine stages');
});

test('the old condensed all-fields-on-one-page builder no longer exists', () => {
  // The exact markup the condensed form used to render: a plain <select> per
  // field, all mounted at once inside #pane-build. Its removal, not merely
  // its being hidden, is the requirement -- so this greps for the literal
  // tags, not for visibility.
  assert.doesNotMatch(START_SRC, /<select id="purpose">/, 'the condensed purpose <select> still exists');
  assert.doesNotMatch(START_SRC, /<select id="distance">/, 'the condensed distance <select> still exists');
  assert.doesNotMatch(START_SRC, /<select id="longday">/, 'the condensed long-run-day <select> still exists');
  assert.doesNotMatch(START_SRC, /id="weeks" type="number"/, 'the condensed weeks field still exists statically');
  assert.doesNotMatch(START_SRC, /Race goal — train for a distance/,
    'the old condensed purpose option copy is still present');
  // In its place: a single per-stage mount point the nine render functions
  // draw into, one stage visible at a time.
  assert.match(START_SRC, /id="bld-stage-body"/, 'there is no single staged mount point');
  assert.match(START_SRC, /function bldGoToStage\(/, 'there is no stage-navigation function');
  assert.match(START_SRC, /function bldValidateStage\(/, 'there is no per-stage validation function');
});

// ---------------------------------------------------------------------------
// 2. FIELD DEFINITIONS AND DEFAULTS ARE IDENTICAL
// ---------------------------------------------------------------------------
test('purpose order, labels and default block lengths are identical between app and spec', () => {
  const app = loadApp({ pinnedDate: TODAY });
  assert.equal(JSON.stringify(Array.from(app.BUILDER_PURPOSE_ORDER)),
    JSON.stringify(BUILDER_SPEC.purposes.order));
  BUILDER_SPEC.purposes.order.forEach((k) => {
    const appMeta = app.BUILDER_PURPOSE_META[k];
    const specMeta = BUILDER_SPEC.purposes.meta[k];
    assert.equal(appMeta.label, specMeta.label, k + ': label diverged');
    assert.equal(appMeta.lockDistance, specMeta.lockDistance, k + ': lockDistance diverged');
    assert.equal(app.builderDefaultWeeks(k), specMeta.defaultWeeks,
      k + ': the spec\'s defaultWeeks no longer matches what the real engine offers');
  });
});

test('experience levels and defaults are identical between app and spec', () => {
  const app = loadApp({ pinnedDate: TODAY });
  assert.equal(JSON.stringify(Array.from(app.EXPERIENCE_LEVELS)),
    JSON.stringify(BUILDER_SPEC.experience.order));
  assert.equal(app.athleteExperience({}), BUILDER_SPEC.experience.default);
});

test('the distance order the picker offers matches the engine\'s own, and carries only naming', () => {
  const app = loadApp({ pinnedDate: TODAY });
  assert.equal(JSON.stringify(Array.from(app.DISTANCE_ORDER)),
    JSON.stringify(BUILDER_SPEC.distances.order));
  BUILDER_SPEC.distances.order.forEach((k) => {
    assert.equal(BUILDER_SPEC.distances.labels[k], app.DISTANCE_PROFILES[k].label, k + ': label diverged');
  });
  // Proprietary session-library methodology stays out of the public spec.
  ['raceKm', 'longCapKm', 'volMult', 'emphasis', 'blockName'].forEach((leak) => {
    assert.equal(Object.prototype.hasOwnProperty.call(BUILDER_SPEC.distances, leak), false,
      'the canonical spec leaks engine methodology field ' + leak);
  });
});

test('the goal-ambition mapping is identical across the app, the spec and the server', () => {
  const app = loadApp({ pinnedDate: TODAY });
  assert.equal(JSON.stringify(BUILDER_SPEC.goals.ambitionMult), JSON.stringify({ A: 1.06, B: 1.00, C: 0.94 }));
  assert.equal(JSON.stringify(Preview.GOAL_AMBITION_MULT), JSON.stringify(BUILDER_SPEC.goals.ambitionMult));
  // The app reads the SAME object for its own goal-suggestion arithmetic --
  // consumption, not a third hand-copied literal.
  const sg = APP_SRC.slice(APP_SRC.indexOf('function handleSuggestGoals'));
  assert.match(sg.slice(0, sg.indexOf('\n}\n')), /BUILDER_SPEC\.goals\.ambitionMult/);
  const rc = APP_SRC.slice(APP_SRC.indexOf('function handleRecalibrateSuggest'));
  assert.match(rc.slice(0, rc.indexOf('\n}\n')), /BUILDER_SPEC\.goals\.ambitionMult/);
  const adopt = APP_SRC.slice(APP_SRC.indexOf('function adoptPendingBuildIfAny'));
  assert.match(adopt.slice(0, adopt.indexOf('\nfunction ')), /BUILDER_SPEC\.goals\.ambitionMult/);
});

// ---------------------------------------------------------------------------
// 3. VALIDATION IS IDENTICAL
// ---------------------------------------------------------------------------
test('validation thresholds are the same numbers, read from the same object, everywhere', () => {
  assert.deepEqual(BUILDER_SPEC.validation.weeksRange, [4, 24]);
  assert.deepEqual(BUILDER_SPEC.validation.daysRange, [3, 6]);
  assert.equal(BUILDER_SPEC.validation.volumeMustExceed, 0);

  // The server -- fixed here to match, closing the drift the investigation
  // found: LIMITS.days used to be [2, 7], looser than the app's real 3-6, so
  // an anonymous preview could accept a build the app itself would refuse.
  assert.deepEqual(Preview.LIMITS.weeks, BUILDER_SPEC.validation.weeksRange);
  assert.deepEqual(Preview.LIMITS.days, BUILDER_SPEC.validation.daysRange);
  assert.equal(Preview.LIMITS.volume[0], BUILDER_SPEC.validation.volumeMustExceed);

  // The app's own bldValidateStage()/handleGeneratePlan() read the spec's
  // numbers rather than a hand-typed 4/24/3/6 -- source-level, so a literal
  // reintroduced later fails this rather than merely happening to agree today.
  const bv = APP_SRC.slice(APP_SRC.indexOf('function bldValidateStage'));
  const bvBody = bv.slice(0, bv.indexOf('\n}\n'));
  assert.match(bvBody, /BUILDER_SPEC\.validation\.weeksRange/);
  assert.match(bvBody, /BUILDER_SPEC\.validation\.volumeMustExceed/);
  assert.match(bvBody, /BUILDER_SPEC\.validation\.daysRange/);

  const gp = APP_SRC.slice(APP_SRC.indexOf('async function handleGeneratePlan'));
  const gpBody = gp.slice(0, gp.indexOf('\nasync function'));
  assert.match(gpBody, /BUILDER_SPEC\.validation\.daysRange/);
  assert.match(gpBody, /BUILDER_SPEC\.validation\.weeksRange/);
  assert.match(gpBody, /BUILDER_SPEC\.validation\.volumeMustExceed/);

  // /start's own bldValidateStage() equivalent, same source.
  const sv = START_SRC.slice(START_SRC.indexOf('function bldValidateStage'));
  const svBody = sv.slice(0, sv.indexOf('\n  }\n'));
  assert.match(svBody, /BS\.validation\.weeksRange/);
  assert.match(svBody, /BS\.validation\.volumeMustExceed/);
  assert.match(svBody, /BS\.validation\.daysRange/);
  assert.match(svBody, /BS\.validation\.benchmarkSecondsRange/);
});

test('a preview request the app builder would refuse (7 running days) is refused by the server too', () => {
  // The concrete regression: before this reconciliation, LIMITS.days=[2,7]
  // let a 7-day build preview fine and then fail silently at adoption --
  // see adoptPendingBuildIfAny()'s own 3-6 check. That gap is now closed at
  // the source both sides read.
  const v = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 40,
    activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 0, benchmarkSeconds: 2700 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'training_days_out_of_range');
});

test('a preview request with zero weekly volume is refused, matching the app\'s own ">0" rule', () => {
  const v = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 0,
    activeDays: [0, 1, 2, 4, 5], longRunDay: 5, benchmarkSeconds: 2700 });
  assert.equal(v.ok, false);
  assert.equal(v.code, 'volume_out_of_range');
});

// ---------------------------------------------------------------------------
// 4. THE REVIEW STAGE IS IDENTICAL IN MEANING AND DATA
// ---------------------------------------------------------------------------
test('the review stage covers the same set of answers on both surfaces', () => {
  // Not byte-identical markup -- /start renders its own review card -- but
  // the same underlying facts must be summarised: what the block is for and
  // its distance, its length or event date, experience, weekly schedule,
  // benchmark, and the goal/ambition. Read out of each function's own body
  // rather than the rendered HTML, so the assertion survives a copy edit.
  const appReview = APP_SRC.slice(APP_SRC.indexOf('function bldRenderReview'));
  const appBody = appReview.slice(0, appReview.indexOf('\n}\n'));
  const startReview = START_SRC.slice(START_SRC.indexOf('function renderReviewStage'));
  const startBody = startReview.slice(0, startReview.indexOf('\n  }\n'));

  const CONCEPTS = [
    [/su-distance|profile\.label/, /purposeMeta\(\)\.label|NAME\[Ans\.distanceKey\]/, 'distance/purpose'],
    [/su-racedate|su-weeks/, /Ans\.raceDate|Ans\.weeks/, 'event date or block length'],
    [/athleteExperience/, /Ans\.experience|BS\.experience/, 'experience'],
    [/su-weekdays|longSel/, /Ans\.activeDays|Ans\.longRunDay/, 'training days / long run day'],
    [/su-bench-dist|su-bench-time/, /Ans\.benchDist|Ans\.benchTime/, 'benchmark'],
    [/su-goal-/, /Ans\.goalAmbition/, 'goal / ambition']
  ];
  CONCEPTS.forEach(([appPattern, startPattern, label]) => {
    assert.match(appBody, appPattern, 'the app\'s review no longer shows ' + label);
    assert.match(startBody, startPattern, '/start\'s review no longer shows ' + label);
  });
});

// ---------------------------------------------------------------------------
// 5. THE SERVER'S REQUEST CONTRACT IS THE SAME AUTHORITY, NOT A FOURTH COPY
// ---------------------------------------------------------------------------
test('api/_preview.js reads its taxonomy from the canonical spec rather than its own literals', () => {
  const src = read('api/_preview.js');
  assert.match(src, /const BUILDER_SPEC = require\('\.\.\/assets\/builder-spec\.js'\);/);
  assert.match(src, /const DISTANCES = BUILDER_SPEC\.distances\.order;/);
  assert.match(src, /const PURPOSES = BUILDER_SPEC\.purposes\.order;/);
  assert.match(src, /const GOAL_AMBITIONS = BUILDER_SPEC\.goals\.keys;/);
  assert.match(src, /const GOAL_AMBITION_MULT = BUILDER_SPEC\.goals\.ambitionMult;/);
});
