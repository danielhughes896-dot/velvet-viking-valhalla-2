'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const BUILDER_SPEC = require('../assets/builder-spec.js');
const Preview = require('../api/_preview.js');

// C2 -- A LOCKED PURPOSE'S DISTANCE IS AN AUTHORITY, NOT A DOM READ.
//
// bldOnPurposeChange() forces #su-distance to meta.lockDistance and disables
// every other option the moment a locked purpose (currently 'speed', locked
// to 5k) is chosen -- but that is presentation. Both handleGeneratePlan()
// (the plan that actually gets built and saved) and bldRenderReview() (the
// check-sheet the athlete reads before committing) used to read
// #su-distance.value unconditionally, trusting whatever the field currently
// held. A stale value left over from switching purposes without the field
// re-rendering, or a directly-set value, reached the generator unchecked --
// the exact "multiple consumers, no reconciliation contract" failure this
// whole remediation pass exists to close.
//
// The fix mirrors the server's own rule: api/_preview.js's
// PURPOSE_SHAPE[purpose].forceDistance overrides whatever distanceKey the
// request carries for a locked purpose. These tests prove the client now
// carries the identical override at both consumers, and that unlocked
// purposes are left alone.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'protected/velvet-viking-valhalla.html'), 'utf8');

test('assets/builder-spec.js: exactly one purpose is distance-locked, and it is speed -> 5k', () => {
  const meta = BUILDER_SPEC.purposes.meta;
  const locked = Object.keys(meta).filter((k) => meta[k].lockDistance);
  assert.deepEqual(locked, ['speed']);
  assert.equal(meta.speed.lockDistance, '5k');
  ['race', 'maintain', 'base'].forEach((k) => assert.equal(meta[k].lockDistance, null));
});

test('server preview enforces the same lock regardless of the distanceKey the request sends', () => {
  const v = Preview.validate({ distanceKey: 'full', purpose: 'speed', volume: 40,
    activeDays: [1, 2, 3, 5, 6], longRunDay: 6, weeks: 8, benchmarkSeconds: 2700 });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.input.buildDistance, '5k', 'a manipulated distanceKey must not survive a locked purpose server-side');
  assert.equal(v.input.distanceKey, 'full', 'the submitted distance is still recorded, just not built');
});

test('server preview leaves an unlocked purpose\'s requested distance alone', () => {
  const v = Preview.validate({ distanceKey: 'half', purpose: 'race', volume: 40,
    activeDays: [1, 2, 3, 5, 6], longRunDay: 6, hasEvent: true, raceDate: '2099-01-01',
    benchmarkSeconds: 2700 });
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.input.buildDistance, 'half');
});

test('handleGeneratePlan() overrides distanceKey from the purpose lock, not the raw field value', () => {
  const fn = SRC.slice(SRC.indexOf('async function handleGeneratePlan()'), SRC.indexOf('async function handleGeneratePlan()') + 2000);
  assert.match(fn, /var distanceKey = document\.getElementById\('su-distance'\)\.value;/);
  assert.match(fn, /BUILDER_PURPOSE_META\[buildPurpose\][\s\S]{0,40}lockDistance/,
    'handleGeneratePlan must consult the purpose\'s own lockDistance, not trust the field alone');
  assert.match(fn, /if \(purposeLockDistance\) distanceKey = purposeLockDistance;/,
    'a locked purpose must overwrite whatever the field held, not merely default when the field is empty');
  // The override must happen before distanceKey is used to build the plan
  // (before the block-purpose / event-mode branching further down).
  const overrideAt = fn.indexOf('if (purposeLockDistance) distanceKey = purposeLockDistance;');
  const nextUseAt = fn.indexOf('distanceKey', overrideAt + 60);
  assert.ok(overrideAt > -1, 'override must be present');
});

test('bldRenderReview() promises the distance handleGeneratePlan() will actually build', () => {
  const fn = SRC.slice(SRC.indexOf('function bldRenderReview()'), SRC.indexOf('function bldRenderReview()') + 1500);
  assert.match(fn, /BUILDER_PURPOSE_META\[purposeSelForReview\.value\]/);
  assert.match(fn, /reviewPurposeMeta[\s\S]{0,20}lockDistance\)\s*\|\|\s*distSel\.value/,
    'Review must fall back to the locked distance before the raw field value');
  assert.match(fn, /DISTANCE_PROFILES\[reviewDistanceKey\]/);
});

test('only the locked purpose is overridden -- an unlocked purpose keeps reading the field', () => {
  // BUILDER_PURPOSE_META is built from assets/builder-spec.js in the app; a
  // falsy lockDistance (null for race/base/maintain) must short-circuit the
  // override on both consumers, leaving distSel.value / distanceKey as the
  // athlete's own choice.
  const genFn = SRC.slice(SRC.indexOf('async function handleGeneratePlan()'), SRC.indexOf('async function handleGeneratePlan()') + 2000);
  assert.match(genFn, /var purposeLockDistance = BUILDER_PURPOSE_META\[buildPurpose\] && BUILDER_PURPOSE_META\[buildPurpose\]\.lockDistance;/);
});
