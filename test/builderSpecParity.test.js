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
test('the canonical spec defines exactly eleven stages', () => {
  assert.equal(BUILDER_SPEC.stages.length, 11);
  BUILDER_SPEC.stages.forEach((s) => {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.name, 'string');
    assert.equal(typeof s.heading, 'string');
    assert.equal(typeof s.lede, 'string');
  });
});

test('the app builder exposes exactly the canonical spec\'s ten stage names, in order', () => {
  const app = loadApp({ pinnedDate: TODAY });
  assert.equal(app.BLD_STAGE_NAMES.length, BUILDER_SPEC.stages.length);
  assert.equal(JSON.stringify(Array.from(app.BLD_STAGE_NAMES)),
    JSON.stringify(BUILDER_SPEC.stages.map((s) => s.name)),
    'the app\'s stage names/order no longer match the canonical spec');
  // Consumption, not re-declaration: BLD_STAGE_NAMES is read FROM the spec.
  const fn = APP_SRC.slice(APP_SRC.indexOf('var BLD_STAGE_NAMES'));
  assert.match(fn.slice(0, 120), /BUILDER_SPEC\.stages\.map\(/,
    'the app redeclares its own stage-name list instead of reading the canonical spec');
});

/* RETIRED (founder, 16 November 2026, item 9: "Can it be removed? Yeh"): the web builder on /start is removed; the plan is built in the app (/get). */
/* So the parity below is the app, the spec and the server; /start asks nothing. */
test('/start holds no builder of its own, staged or condensed', () => {
  assert.doesNotMatch(START_SRC, /id="pane-build"|id="bld-stage-body"|BUILDER_SPEC|BLD_STAGES/);
  assert.doesNotMatch(START_SRC, /<select id="(purpose|distance|longday)">/, 'the condensed builder is back');
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
  /* A5 (founder, 15 November 2026): one to seven running days, provided no
     easy run falls under 5km (the week-fit check and the merge solver). */
  assert.deepEqual(BUILDER_SPEC.validation.daysRange, [1, 7]);
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

  /* /start's copy of the validator is retired with the web builder (item 9). */
});

test('the server accepts exactly the day counts the app builder accepts', () => {
  // The concrete regression: LIMITS.days=[2,7] once let a 7-day build preview
  // fine and then fail silently at adoption (adoptPendingBuildIfAny() reads
  // the same range). Both sides read one source, so when A5 (founder, 15
  // November 2026) opened the range to 1-7, the server moved with it: seven
  // days and one day are accepted, and no days at all is still refused.
  const seven = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 40,
    activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 0, benchmarkSeconds: 2700 });
  assert.equal(seven.ok, true, 'seven running days are accepted');
  const one = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 10,
    activeDays: [6], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.equal(one.ok, true, 'one running day is accepted');
  const none = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 10,
    activeDays: [], longRunDay: 6, benchmarkSeconds: 2700 });
  assert.equal(none.ok, false);
});

test('a preview request with ZERO weekly volume is accepted, because zero is an answer', () => {
  /* ---- RE-POINTED ---- HQ RULING: "0 is valid evidence and MUST remain
     different from null/unknown."
     This contract asserted the opposite, and the endpoint's own comment had
     already noticed the tension -- "zero is a real answer an athlete could
     submit, not a missing one" -- immediately above a line that refused it. An
     athlete who is not running yet is exactly the athlete the question exists
     for, and refusing their answer meant /start could not build them anything.
     WHAT IT GUARDS IS UNCHANGED: a figure we cannot believe is still refused.
     Only the boundary moved, from "must exceed zero" to "must be answered". */
  const ok = Preview.validate({ distanceKey: '10k', weeks: 12, volume: 0,
    activeDays: [0, 1, 2, 4, 5], longRunDay: 5, benchmarkSeconds: 2700 });
  assert.equal(ok.ok, true, 'a stated zero is an answer and must be accepted');
  [-1, NaN, 'x', undefined, 201].forEach(bad => {
    const v = Preview.validate({ distanceKey: '10k', weeks: 12, volume: bad,
      activeDays: [0, 1, 2, 4, 5], longRunDay: 5, benchmarkSeconds: 2700 });
    assert.equal(v.ok, false, String(bad) + ' is not an answer and must be refused');
    assert.equal(v.code, 'volume_out_of_range');
  });
});

// ---------------------------------------------------------------------------
// 4. THE REVIEW STAGE IS IDENTICAL IN MEANING AND DATA
// ---------------------------------------------------------------------------
test('the review stage covers every answer the builder asked', () => {
  /* /start's side of this comparison is retired with the web builder (item 9). */
  const appReview = APP_SRC.slice(APP_SRC.indexOf('function bldRenderReview'));
  const appBody = appReview.slice(0, appReview.indexOf('\n}\n'));
  const CONCEPTS = [
    [/su-distance|profile\.label/, 'distance/purpose'],
    [/su-racedate|su-weeks/, 'event date or block length'],
    [/athleteExperience/, 'experience'],
    [/su-weekdays|longSel/, 'training days / long run day'],
    [/su-bench-dist|su-bench-time/, 'benchmark'],
    [/su-goal-/, 'goal / ambition']
  ];
  CONCEPTS.forEach(([appPattern, label]) => {
    assert.match(appBody, appPattern, 'the app\'s review no longer shows ' + label);
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
