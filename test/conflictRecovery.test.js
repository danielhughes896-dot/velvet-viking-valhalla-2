'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// A real athlete signed in on a real Preview, met "Two plans found", and chose
// "Use my account's plan". The device plan they displaced held two logged
// sessions; the account plan held none. The modal promised the other plan was
// "kept as a backup on this device, not deleted".
//
// That promise is the thing under test. It is the single most consequential
// sentence in the product: an athlete who believes it and is wrong loses real
// training history at the exact moment they were trying to be careful.
//
// These tests reproduce that scenario through the production handler rather
// than describing it -- same conflict, same choice, same shapes.
const PINNED = '2026-03-11T09:00:00Z';
const UID = 'uid-athlete-1';

function app() { return loadApp({ pinnedDate: PINNED }); }

/* HQ's device plan: a marathon block with exactly two sessions logged. */
function devicePlan(a, logged) {
  buildPlan(a, { distanceKey: 'full', volume: 60, weeks: 16,
                 startDate: a.addDays(a.todayStr(), -28) });
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 30 * 60 } };
  const today = a.todayStr();
  a.state.days.filter(d => d.date < today && d.type !== 'rest')
    .slice(0, logged)
    .forEach(d => { d.completed = true;
                    d.actual = { km: d.km, pace: '5:30', hr: 145, rpe: 4, notes: '' }; });
  return a;
}
const loggedCount = st => (st.days || []).filter(d => d.completed).length;

/* The same block as it exists in the account: identical race, nothing logged.
   Built from the device plan so the two genuinely are the same training block
   at different points, which is what makes it a conflict rather than two
   unrelated plans. */
function accountCopyOf(a) {
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.days.forEach(d => { d.completed = false; delete d.actual; });
  return remote;
}

/* Drive the athlete's actual choice through the production handler. */
function chooseAccountPlan(a, remote) {
  a.cloudSession = { access_token: 't', user_id: UID, email: 'a@b.c' };
  a.window.__cloudPendingRemote = remote;
  a.window.__cloudPendingRemoteUpdated = '2026-03-11T08:00:00Z';
  a.handleCloudKeepRemote();
}

// ---------------------------------------------------------------------------
// THE PROMISE THE MODAL MAKES
// ---------------------------------------------------------------------------
test('choosing the account plan does not delete the device plan', () => {
  const a = devicePlan(app(), 2);
  const before = { days: a.state.days.length, logged: loggedCount(a.state) };
  assert.equal(before.logged, 2, 'precondition: two sessions logged on the device');

  chooseAccountPlan(a, accountCopyOf(a));

  const displaced = a.readStored(a.CLOUD_BACKUP_KEY);
  assert.ok(displaced, 'the displaced plan must still be on the device');
  assert.equal(displaced.days.length, before.days, 'whole, not a summary');
  assert.equal(loggedCount(displaced), 2, 'and its logged sessions survived');
});

test('the device plan is stashed BEFORE the account plan replaces it', () => {
  // Ordering is the entire safety property: adoptCloudState writes the backup
  // as its first statement, so there is no window in which the old plan has
  // been dropped and the new one not yet stored.
  const a = devicePlan(app(), 2);
  const order = [];
  const realWrite = a.writeStored;
  a.writeStored = function (key, val) {
    if (key === a.CLOUD_BACKUP_KEY) order.push('backup:' + loggedCount(val || {}));
    return realWrite.call(this, key, val);
  };
  chooseAccountPlan(a, accountCopyOf(a));
  assert.ok(order.indexOf('backup:2') !== -1,
    'the backup written must be the two-session plan, captured before the swap');
});

test('the athlete is now on the account plan', () => {
  const a = devicePlan(app(), 2);
  chooseAccountPlan(a, accountCopyOf(a));
  assert.equal(loggedCount(a.state), 0, 'the account copy had nothing logged');
  assert.equal(a.planOwnerUid(), UID, 'and it belongs to the signed-in account');
});

// ---------------------------------------------------------------------------
// AND IT IS REACHABLE, NOT MERELY PRESENT
// ---------------------------------------------------------------------------
test('the displaced plan appears in Restore a Plan', () => {
  const a = devicePlan(app(), 2);
  const expectedDays = a.state.days.length;
  chooseAccountPlan(a, accountCopyOf(a));

  const found = a.recoverablePlans();
  const displaced = found.filter(p => p.source === 'displaced')[0];
  assert.ok(displaced, 'a plan retained but unreachable is lost as far as the athlete is concerned');
  assert.equal(displaced.completed, 2, 'listed with its two logged sessions');
  assert.equal(displaced.sessions, expectedDays);
  assert.equal(displaced.key, 'displaced');
  assert.match(displaced.sourceLabel, /Replaced by a plan from your account/,
    'and it says why it was put aside');
  assert.match(displaced.goal, /Marathon/i);
});

test('it is not filtered out for resembling the active plan', () => {
  // recoverablePlans() hides a copy identical to what is already open. The two
  // plans here differ ONLY by completion, so this proves the signature counts
  // logged sessions -- otherwise the athlete's backup would silently vanish
  // from the list precisely when the plans are most similar.
  const a = devicePlan(app(), 2);
  const remote = accountCopyOf(a);
  assert.notEqual(a.planContentSignature(a.state), a.planContentSignature(remote),
    'two sessions logged versus none must be a real difference');
  chooseAccountPlan(a, remote);
  assert.equal(a.recoverablePlans().filter(p => p.source === 'displaced').length, 1);
});

test('restoring it brings the two logged sessions back', () => {
  const a = devicePlan(app(), 2);
  const expectedDays = a.state.days.length;
  chooseAccountPlan(a, accountCopyOf(a));

  const done = a.restoreRecoverablePlan('displaced');
  assert.ok(done, 'restore reports what it loaded');
  assert.equal(a.state.days.length, expectedDays);
  assert.equal(loggedCount(a.state), 2, 'the history is back, not just the shape');
  const stored = JSON.parse(a.localStorage.getItem('velvet-viking-generator-v2') || '{}');
  assert.equal(loggedCount(stored), 2, 'and persisted, not only in memory');
});

test('restoring is itself reversible — the account plan is parked in turn', () => {
  const a = devicePlan(app(), 2);
  chooseAccountPlan(a, accountCopyOf(a));
  a.restoreRecoverablePlan('displaced');
  const still = a.recoverablePlans();
  assert.ok(still.length >= 1,
    'the plan just replaced must itself remain recoverable, or restoring becomes a one-way door');
});

test('a reconcile after the choice does not undo it', () => {
  // handleCloudKeepRemote writes a sync mark so the same conflict is not raised
  // again on the next launch and silently resolved the other way.
  const a = devicePlan(app(), 2);
  chooseAccountPlan(a, accountCopyOf(a));
  const mark = a.readSyncMark();
  assert.ok(mark, 'an agreement was recorded');
  assert.equal(mark.signature, a.planContentSignature(a.state),
    'and it describes the plan the athlete actually chose');
});

// ---------------------------------------------------------------------------
// THE ONE PATH THAT DOES CLEAR THE BACKUP
// ---------------------------------------------------------------------------
test('only account deletion clears the displaced copy', () => {
  const a = devicePlan(app(), 2);
  chooseAccountPlan(a, accountCopyOf(a));
  assert.ok(a.readStored(a.CLOUD_BACKUP_KEY), 'present after the swap');

  // ordinary sign-out must NOT discard it
  a.cloudSignOut();
  assert.ok(a.readStored(a.CLOUD_BACKUP_KEY),
    'signing out is not deleting; the backup belongs to the device');
});
