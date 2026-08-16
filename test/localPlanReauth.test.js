'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Delete Account & Cloud Data promises "Your plan stays on THIS device".
// Reproduced live: it did stay -- until the athlete signed in again with the
// same address, at which point they were shown Build My Plan.
//
// delete_own_account() removes the auth.users row, so signing in again mints a
// BRAND NEW uid. The plan was still stamped with the deleted account's uid, and
// ownership resolution reads "stamped with a different uid" as a different
// athlete on a shared device: it parked the plan in vvv_plan_archive and
// started the new account clean. Nothing was destroyed, but the athlete could
// not reach it, which amounts to the same thing.
//
// These tests hold both halves at once: a deleted account must release its
// claim on the device copy, and a genuinely different athlete must still never
// inherit one.
const PINNED = '2026-03-11T09:00:00Z';
const OLD = 'uid-old-1111', NEW = 'uid-new-2222', OTHER = 'uid-other-3333';

function withPlan(ownerUid) {
  const a = loadApp({ pinnedDate: PINNED });
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -42) });
  // log some real history, so "the plan" includes completed training
  const today = a.todayStr();
  a.state.days.filter(d => d.date < today && d.type !== 'rest').forEach(d => {
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 145, rpe: 4, notes: '' };
  });
  if (ownerUid) { a.stampPlanOwner(ownerUid); a.persistStateLocalOnly(); }
  return a;
}
function shape(a) {
  return {
    days: (a.state.days || []).length,
    done: (a.state.days || []).filter(d => d.completed).length,
    setup: !!a.state.setup,
  };
}
/* The local half of handleCloudDeleteAccount's success branch: session gone,
   displaced backup gone, ownership stamp released, plan deliberately kept. */
function deleteAccount(a) {
  a.cloudSession = null;
  a.writeStored(a.CLOUD_SESSION_KEY, null);
  a.writeStored(a.CLOUD_BACKUP_KEY, null);
  delete a.state.ownerUid;
  a.persistStateLocalOnly();
}

test('deleting the account leaves the device plan, history included', () => {
  const a = withPlan(OLD);
  const before = shape(a);
  assert.ok(before.done > 0, 'precondition: there is completed history to lose');
  deleteAccount(a);
  assert.deepEqual(shape(a), before);
  assert.equal(a.planOwnerUid(), null, 'the deleted account no longer claims it');
});

test('re-authenticating with the same address keeps the retained plan', () => {
  const a = withPlan(OLD);
  const before = shape(a);
  deleteAccount(a);
  // Supabase recreated the account, so this is a different uid for the same person
  const outcome = a.resolvePlanOwnership(NEW);
  assert.equal(outcome, 'legacy-adopted', 'the new account adopts the plan already here');
  assert.deepEqual(shape(a), before, 'every day and every completed session survives');
  assert.equal(a.planOwnerUid(), NEW);
  assert.equal(Object.keys(a.readPlanArchive()).length, 0, 'nothing was parked out of reach');
});

test('an empty cloud account cannot outrank a populated local plan', () => {
  const a = withPlan(OLD);
  const before = shape(a);
  deleteAccount(a);
  a.resolvePlanOwnership(NEW);
  // cloudReconcile's remote-empty branch seeds the account FROM local; the
  // precondition it depends on is that ownership resolution left the plan intact
  assert.deepEqual(shape(a), before);
  assert.ok(a.state.setup && a.state.days.length, 'local is what would be uploaded');
});

test('re-authentication is idempotent across repeated sign-ins and reloads', () => {
  const a = withPlan(OLD);
  deleteAccount(a);
  const first = a.resolvePlanOwnership(NEW), s1 = shape(a);
  const second = a.resolvePlanOwnership(NEW), s2 = shape(a);
  const third = a.resolvePlanOwnership(NEW), s3 = shape(a);
  assert.deepEqual([first, second, third], ['legacy-adopted', 'own', 'own']);
  assert.deepEqual([s1, s2, s3], [s1, s1, s1]);
});

test('what is written to disk during re-auth is the real plan, never an empty one', () => {
  const a = withPlan(OLD);
  const before = shape(a);
  deleteAccount(a);
  a.resolvePlanOwnership(NEW);
  const stored = JSON.parse(a.localStorage.getItem('velvet-viking-generator-v2') || '{}');
  assert.equal((stored.days || []).length, before.days);
  assert.equal((stored.days || []).filter(d => d.completed).length, before.done);
});

test('a different athlete on a shared device still never inherits the plan', () => {
  const a = withPlan(OLD);
  const before = shape(a);
  // no deletion: the first athlete simply signed out, and their account exists
  assert.equal(a.resolvePlanOwnership(OTHER), 'cleared');
  assert.equal(shape(a).days, 0, 'the incoming athlete starts clean');
  const arch = a.readPlanArchive();
  assert.deepEqual(Object.keys(arch), [OLD], 'and the first plan is parked, not destroyed');
  assert.equal(arch[OLD].state.days.length, before.days);
});

test('the parked plan comes back when its owner signs in again', () => {
  const a = withPlan(OLD);
  const before = shape(a);
  a.resolvePlanOwnership(OTHER);
  assert.equal(a.resolvePlanOwnership(OLD), 'restored');
  assert.equal(shape(a).days, before.days);
  assert.equal(shape(a).done, before.done);
});

test('an unstamped legacy plan is adopted on first sign-in, not cleared', () => {
  const a = withPlan(null);
  const before = shape(a);
  assert.equal(a.resolvePlanOwnership(NEW), 'legacy-adopted');
  assert.deepEqual(shape(a), before);
});
