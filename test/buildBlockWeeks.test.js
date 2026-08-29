'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// buildBlockWeeks() is the periodisation core: two athletes with different
// inputs must get materially different plans, and the shape of any one plan
// (ramp, cutback, taper, race week) has to hold for the generator to be
// trustworthy rather than decorative.

test('buildBlockWeeks: final week is always the race week', () => {
  const app = loadApp();
  const b = app.buildBlockWeeks('10k', 40, 12);
  const last = b.weeks[b.weeks.length - 1];
  assert.equal(last.isRace, true);
  assert.equal(last.week, b.weeks.length);
});

test('buildBlockWeeks: peak volume matches the distance profile\'s multiplier', () => {
  /* At the builder's own default block length the profile multiplier is
     reached in full. This is the statement the distance profiles make, and it
     is the one that must not move. */
  const app = loadApp();
  const currentVolume = 40;
  const N = app.BUILDER_PURPOSE_META.race.defaultWeeks;
  const profile = app.DISTANCE_PROFILES['10k'];
  const b = app.buildBlockWeeks('10k', currentVolume, N);
  assert.equal(b.peakVolume, app.round1(currentVolume * profile.volMult));
});

test('buildBlockWeeks: a short block earns only the development its weeks allow', () => {
  /* volMult is an end-state capacity ceiling, not a target every block reaches
     regardless of how long it is. A twelve-week block has nine developing weeks
     against the default's eleven, so it earns nine elevenths of the climb from
     1.0 to 1.35 and peaks below -- never above -- the full-length figure. */
  const app = loadApp();
  const profile = app.DISTANCE_PROFILES['10k'];
  const short = app.buildBlockWeeks('10k', 40, 12);
  const full  = app.buildBlockWeeks('10k', 40, app.BUILDER_PURPOSE_META.race.defaultWeeks);
  assert.equal(short.peakVolume, app.round1(40 * app.developmentMultiplierFor('10k', 12)));
  assert.ok(short.peakVolume < full.peakVolume,
    'a twelve-week block peaked at ' + short.peakVolume + ' against a full-length ' + full.peakVolume);
  assert.ok(short.peakVolume <= app.round1(40 * profile.volMult));
});

test('buildBlockWeeks: two different goal distances from the same volume produce different plans', () => {
  const app = loadApp();
  const a = app.buildBlockWeeks('5k', 40, 12);
  const b = app.buildBlockWeeks('full', 40, 12);
  assert.notEqual(a.peakVolume, b.peakVolume, 'peak volume should differ by goal distance');
  assert.notEqual(a.profile.longCapKm, b.profile.longCapKm, 'long-run cap should differ by goal distance');
});

test('buildBlockWeeks: a cutback week is lighter than the week before it', () => {
  const app = loadApp();
  const b = app.buildBlockWeeks('10k', 40, 16); // long enough block to guarantee a cutback week
  const cutback = b.weeks.find(w => w.isCutback);
  assert.ok(cutback, 'a 16-week block should contain at least one cutback week');
  const prev = b.weeks.find(w => w.week === cutback.week - 1);
  assert.ok(prev, 'cutback week must have a preceding week to compare against');
  assert.ok(cutback.volume < prev.volume, 'a cutback week must reduce volume relative to the week before it');
});

test('buildBlockWeeks: taper volume decreases toward the race', () => {
  const app = loadApp();
  const b = app.buildBlockWeeks('10k', 40, 12);
  const taperWeeks = b.weeks.filter(w => w.isTaper);
  assert.ok(taperWeeks.length >= 1, 'a 12-week block should include at least one taper week');
  for (let i = 1; i < taperWeeks.length; i++) {
    assert.ok(taperWeeks[i].volume <= taperWeeks[i - 1].volume,
      'each taper week should not exceed the volume of the taper week before it');
  }
  const lastBuildWeek = b.weeks.filter(w => !w.isTaper && !w.isRace).pop();
  if (lastBuildWeek && taperWeeks.length) {
    assert.ok(taperWeeks[0].volume < lastBuildWeek.volume,
      'the first taper week should back off from the peak build week');
  }
});

test('buildBlockWeeks: build-phase volume trends upward toward peak, ignoring cutback dips', () => {
  const app = loadApp();
  const b = app.buildBlockWeeks('10k', 30, 14);
  const buildWeeks = b.weeks.filter(w => !w.isTaper && !w.isRace && !w.isCutback);
  assert.ok(buildWeeks.length >= 3, 'need multiple non-cutback build weeks to check a trend');
  assert.ok(buildWeeks[buildWeeks.length - 1].volume > buildWeeks[0].volume,
    'the last non-cutback build week should carry more volume than the first');
});
