'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// A plan parked by archivePlanFor() is only ever returned to the exact uid that
// owned it. Deleting an account removes the auth user, so signing in again
// mints a NEW uid and the parked plan belongs to one that can never sign in.
// Nothing destroyed it; nothing could reach it either.
//
// These tests cover the way back: read-only discovery that cannot damage what
// it is looking for, and an explicit restore that never loses the plan it
// replaces. They exercise the real archive/ownership functions and assert on
// stored state, not on rendered strings.
const PINNED = '2026-03-11T09:00:00Z';
const OLD = 'uid-old-1111', NEW = 'uid-new-2222';

function app() { return loadApp({ pinnedDate: PINNED }); }

function withPlan(a, opts) {
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(a.todayStr(), -42) }, opts || {}));
  const today = a.todayStr();
  a.state.days.filter(d => d.date < today && d.type !== 'rest').forEach(d => {
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 145, rpe: 4, notes: '' };
  });
  return a;
}
const shape = a => ({
  days: (a.state.days || []).length,
  done: (a.state.days || []).filter(d => d.completed).length,
  setup: !!a.state.setup,
});
/* Reproduce HQ's live sequence up to the point the plan became unreachable:
   a plan owned by an account that was then deleted, and a sign-in under the
   new uid the recreated account received. */
function strandedPlan() {
  const a = withPlan(app());
  const before = shape(a);
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  a.resolvePlanOwnership(NEW);      // pre-fix behaviour: parks it, starts clean
  return { a, before };
}

test('the stranded plan is parked, not destroyed', () => {
  const { a, before } = strandedPlan();
  assert.equal(shape(a).days, 0, 'precondition: the athlete is looking at a no-plan app');
  const arch = a.readPlanArchive();
  assert.equal(Object.keys(arch).length, 1);
  assert.ok(arch[OLD], 'parked under the uid that owned it');
  assert.equal(arch[OLD].state.days.length, before.days);
});

test('discovery finds it and describes it in terms an athlete recognises', () => {
  const { a, before } = strandedPlan();
  const found = a.recoverablePlans();
  assert.equal(found.length, 1);
  const p = found[0];
  assert.equal(p.key, 'archive:' + OLD);
  assert.equal(p.sessions, before.days);
  assert.equal(p.completed, before.done);
  assert.ok(p.completed > 0, 'the logged history is part of what is offered back');
  assert.ok(p.goal && p.startDate && p.endDate, 'goal and block dates identify it');
  assert.ok(p.sourceLabel, 'and it says why it was put aside');
});

test('discovery does not mutate the archive', () => {
  const { a } = strandedPlan();
  const beforeArchive = JSON.stringify(a.readPlanArchive());
  const beforeRaw = a.localStorage.getItem('vvv_plan_archive');
  a.recoverablePlans();
  a.recoverablePlans();
  a.recoverablePlans();
  assert.equal(JSON.stringify(a.readPlanArchive()), beforeArchive,
    'looking must never open the entry -- takeArchivedPlan deletes what it returns');
  assert.equal(a.localStorage.getItem('vvv_plan_archive'), beforeRaw,
    'and nothing is rewritten to storage');
});

test('discovery creates no plan', () => {
  const { a } = strandedPlan();
  a.recoverablePlans();
  assert.equal(a.state.setup, null, 'entering recovery is not building');
  assert.equal(shape(a).days, 0);
});

test('restoring brings the plan back whole, with its logged history', () => {
  const { a, before } = strandedPlan();
  const done = a.restoreRecoverablePlan('archive:' + OLD);
  assert.ok(done, 'restore reports what it loaded');
  assert.deepEqual(shape(a), before, 'every day and every logged session');
  const stored = JSON.parse(a.localStorage.getItem('velvet-viking-generator-v2') || '{}');
  assert.equal((stored.days || []).length, before.days, 'and it is persisted, not just in memory');
});

test('restoring while signed in makes the plan that account’s', () => {
  const { a } = strandedPlan();
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  a.restoreRecoverablePlan('archive:' + OLD);
  assert.equal(a.planOwnerUid(), NEW, 'so the ordinary ownership rules apply from now on');
});

test('restoring signed OUT leaves the plan unowned, for the next sign-in to adopt', () => {
  const { a } = strandedPlan();
  a.cloudSession = null;
  a.restoreRecoverablePlan('archive:' + OLD);
  assert.equal(a.planOwnerUid(), null);
  assert.equal(a.resolvePlanOwnership(NEW), 'legacy-adopted',
    'and signing in adopts it rather than parking it again');
});

test('restoring never destroys the plan it replaces', () => {
  const { a } = strandedPlan();
  // the athlete has since built something else on this device
  withPlan(a, { distanceKey: '5k', weeks: 8 });
  const replaced = shape(a);
  a.restoreRecoverablePlan('archive:' + OLD);
  const nowRecoverable = a.recoverablePlans();
  assert.ok(nowRecoverable.length >= 1, 'the replaced plan is still offered back');
  const parked = nowRecoverable.map(p => p.sessions);
  assert.ok(parked.includes(replaced.days),
    'restoring is reversible -- the plan that was open is parked, not dropped');
});

test('a plan identical to the active one is not offered as recoverable', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.archivePlanFor('someone-else', JSON.parse(JSON.stringify(a.state)));
  // length, not deepEqual: the array is created inside the VM sandbox, so its
  // prototype is not this realm's Array.prototype and strict deep-equality
  // would fail on that alone.
  assert.equal(a.recoverablePlans().length, 0,
    'offering to restore what is already open would only confuse');
});

test('Build My Plan cannot destroy the archived plan', () => {
  const { a, before } = strandedPlan();
  // building is what the no-plan screen invites; it must not evict the archive
  withPlan(a, { distanceKey: '10k', weeks: 10 });
  const arch = a.readPlanArchive();
  assert.ok(arch[OLD], 'the parked plan survives building a new one');
  assert.equal(arch[OLD].state.days.length, before.days);
  assert.equal(a.recoverablePlans().length, 1, 'and it is still discoverable afterwards');
});

test('the archive keeps at most four plans, evicting the oldest first', () => {
  const a = withPlan(app());
  const snap = () => JSON.parse(JSON.stringify(a.state));
  for (let i = 0; i < 6; i++) a.archivePlanFor('uid-' + i, snap());
  const keys = Object.keys(a.readPlanArchive());
  assert.equal(keys.length, a.PLAN_ARCHIVE_MAX);
  assert.ok(!keys.includes('uid-0') && !keys.includes('uid-1'),
    'the two oldest were evicted, which is the real limit on how long a plan stays recoverable');
});

// ---------------------------------------------------------------------------
// OWNERSHIP AND CLOUD BOUNDARIES MUST SURVIVE ALL OF THIS
// ---------------------------------------------------------------------------
test('a different athlete on a shared device still never inherits a plan', () => {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  assert.equal(a.resolvePlanOwnership('uid-someone-else'), 'cleared');
  assert.equal(shape(a).days, 0);
});

test('local and cloud copies of the same plan are not a conflict', () => {
  const a = withPlan(app());
  const remote = JSON.parse(JSON.stringify(a.state));
  assert.equal(a.planContentSignature(a.state), a.planContentSignature(remote),
    'identical content must compare equal, so reconciliation asks nothing');
});

test('local and cloud copies that differ are distinguishable', () => {
  const a = withPlan(app());
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days[0].km = remote.days[0].km + 3;
  assert.notEqual(a.planContentSignature(a.state), a.planContentSignature(remote),
    'a real difference must be detectable, so it can be put to the athlete rather than guessed');
});

// ---------------------------------------------------------------------------
// A RESTORE MUST NOT BE UNDONE BY THE NEXT RECONCILE
//
// cloudReconcile picks its branch by comparing both sides against the sync
// mark -- what this device last agreed with the account about. That agreement
// concerned the plan a restore has just replaced, so leaving it in place lets
// the "this device has logged nothing new, take the account's copy" branch
// fire on a plan the athlete deliberately chose seconds earlier.
// ---------------------------------------------------------------------------
test('restoring clears the stale sync mark, so no branch can silently adopt over it', () => {
  const { a } = strandedPlan();
  // the device is signed in and had previously agreed with the account about
  // some other plan entirely
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  a.writeSyncMark('2026-03-01T00:00:00Z', 'signature-of-the-plan-being-replaced');
  a.restoreRecoverablePlan('archive:' + OLD);
  assert.equal(a.readSyncMark(), null,
    'the device has agreed nothing about the plan it just restored');
});

test('a restored plan is never mistaken for one this device already synced', () => {
  const { a } = strandedPlan();
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  a.restoreRecoverablePlan('archive:' + OLD);
  const mark = a.readSyncMark();
  const base = mark && mark.signature;
  // This is the exact comparison cloudReconcile makes. If it held, reconcile
  // would treat the account's differing copy as authoritative and adopt it.
  assert.notEqual(base, a.planContentSignature(a.state),
    'base===localSig is the branch that discards local work in favour of the account');
});

test('and the plan an adopt displaces is itself recoverable', () => {
  const a = withPlan(app());
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  const mine = shape(a);
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days = remote.days.slice(0, 5);            // a genuinely different block
  a.adoptCloudState(remote, true);
  const found = a.recoverablePlans();
  assert.ok(found.some(p => p.sessions === mine.days && p.source === 'displaced'),
    'taking the account copy parks the device copy where recovery can find it');
});

// ---------------------------------------------------------------------------
// STORAGE STATUS IS TRUTHFUL
// ---------------------------------------------------------------------------
test('storage status distinguishes the states the model can actually prove', () => {
  const a = withPlan(app());
  a.cloudSession = null;
  assert.equal(a.planStorageStatus().key, 'local-only');

  a.cloudSession = { access_token: 't', user_id: NEW, email: 'a@b.c' };
  a.cloudStatus = 'error';
  assert.equal(a.planStorageStatus().key, 'unknown',
    'an unreachable account is not a backed-up one, and must not claim to be');

  a.cloudStatus = 'synced';
  a.writeSyncMark('2026-03-11T00:00:00Z', a.planContentSignature(a.state));
  assert.equal(a.planStorageStatus().key, 'synced');

  a.state.days[0].km = a.state.days[0].km + 5;      // diverges from the mark
  assert.equal(a.planStorageStatus().key, 'pending',
    'edits since the last agreement are pending, not backed up');
});

test('no plan reports as no plan', () => {
  const a = app();
  assert.equal(a.planStorageStatus().key, 'none');
});
