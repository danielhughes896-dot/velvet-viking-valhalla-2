'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// evolutionChanges(stateName, phase, pending, recoverable) picks the cheapest
// safe intervention first, and its floor invariant -- a key session is
// shortened, never removed -- is exactly the kind of thing that would be
// dangerous to regress silently and hard to notice by eye in the UI.

function day(id, type, km, extra) {
  return Object.assign({ id, date: id, type, km, mpSegment: false }, extra || {});
}

test('evolutionChanges (ADAPT): trims the lowest-value optional mileage before touching a key session', () => {
  const app = loadApp();
  const pending = [
    day('2026-08-10', 'easy', 5),       // OPTIONAL (easy, <=6km)
    day('2026-08-11', 'threshold', 8),  // KEY
  ];
  const out = app.evolutionChanges('ADAPT', 'Build', pending, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].dayId, '2026-08-10', 'the optional easy day should be trimmed first, not the key session');
  assert.equal(out[0].kind, 'reduce');
  assert.ok(out[0].toKm < out[0].fromKm);
  assert.ok(out[0].toKm > 0, 'a trim must reduce mileage, never zero it out');
});

test('evolutionChanges (ADAPT): with only a key session available, it is shortened, never removed or changed in kind', () => {
  const app = loadApp();
  const pending = [
    day('2026-08-11', 'threshold', 8), // KEY, the only open candidate
  ];
  const out = app.evolutionChanges('ADAPT', 'Build', pending, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].dayId, '2026-08-11');
  assert.equal(out[0].kind, 'reduce', 'a key session is reduced in volume, never dropped or downgraded in type');
  assert.ok(out[0].toKm > 0, 'the session must survive, not be zeroed out');
  assert.ok(out[0].toKm < out[0].fromKm, 'the reduction must actually be smaller than the original');
});

test('evolutionChanges (ADAPT): a session the coach already adjusted is never touched again', () => {
  const app = loadApp();
  const pending = [
    day('2026-08-10', 'easy', 5, { coachAdjust: { at: 'x' } }), // already settled
    day('2026-08-11', 'threshold', 8),
  ];
  const out = app.evolutionChanges('ADAPT', 'Build', pending, []);
  assert.equal(out.length, 1);
  assert.notEqual(out[0].dayId, '2026-08-10', 'an already-adjusted day must be excluded from further changes');
});

test('evolutionChanges (ADAPT): race and checkpoint days are never candidates', () => {
  const app = loadApp();
  const pending = [
    day('2026-08-11', 'race', 10),
    day('2026-08-12', 'checkpoint', 5),
  ];
  const out = app.evolutionChanges('ADAPT', 'Build', pending, []);
  assert.equal(out.length, 0, 'with only a race and a checkpoint day pending, there is nothing safe to change');
});

test('evolutionChanges (RECOVER): downgrades the next key session rather than removing it', () => {
  const app = loadApp();
  const pending = [
    day('2026-08-10', 'easy', 5),
    day('2026-08-11', 'threshold', 8),
  ];
  const out = app.evolutionChanges('RECOVER', 'Build', pending, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].dayId, '2026-08-11', 'RECOVER protects the next demanding session specifically');
  assert.equal(out[0].kind, 'downgrade');
  assert.equal(out[0].toType, 'easy');
  assert.ok(out[0].toKm > 0, 'a downgraded session still happens, at reduced volume -- it is not cancelled');
});

test('evolutionChanges (RECOVER): with no key session pending, reduces the largest session instead', () => {
  const app = loadApp();
  const pending = [
    day('2026-08-10', 'easy', 5),
    day('2026-08-11', 'easy', 10),
  ];
  const out = app.evolutionChanges('RECOVER', 'Build', pending, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].dayId, '2026-08-11', 'the largest open session should be the one eased when there is no key session to protect');
  assert.equal(out[0].kind, 'reduce');
});
