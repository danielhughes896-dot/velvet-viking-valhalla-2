'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* SUPPORTING WORK IN THE PLAN-CONTENT SIGNATURE
   =========================================================================
   THE CONTRACT. planContentSignature() answers one question -- "are these two
   the same plan?" -- over an ENUMERATED list of training content, key-sorted
   by stableStringify() so a round trip through storage cannot reorder its way
   into a false conflict. Device preferences, the open tab, the theme and
   per-device derived timestamps are deliberately outside it.

   THE GAP. dd.support was not in that list. Supporting-work completion is
   uploaded -- cloudPutPlan() pushes the whole state -- but it did not move the
   signature, and cloudReconcile()'s identical-content branch reads that
   signature and RETURNS WITHOUT ADOPTING:

       if (localSig===remoteSig){ ...; writeSyncMark(row.updated_at, localSig); return; }

   So the phone logged supporting work and uploaded it; the laptop read the two
   plans as the same plan, kept its own copy, wrote a sync mark saying it
   agreed with the account, and overwrote the account on its next push. The
   completion was gone. That is the defect these tests hold shut.

   WHAT WAS ADDED, and why it is a subset rather than the object. Four keys --
   the exhaustive output of the only three writers of dd.support: a completion
   {kind, completedAt}, a decline {kind:null, dismissed, dismissedAt}, or null.
   Every other field in the signature is enumerated the same way, so what
   counts as "the same plan" stays a stated list.

   WHAT WAS NOT ADDED. The companion PRESCRIPTION is derived by supportForDay()
   from the days and the setup, both already signed; signing the derived answer
   too would be a second competing source. It still moves the signature -- once,
   transitively -- which is tested below. And evolution/playbook declines are
   still outside the signature, because those have adoptDecisionLedgers() to
   carry them and are answers about a proposal rather than training. */

const TODAY = '2026-09-02';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });

/* Two devices built this way are byte-identical by construction, which is what
   makes a cross-device test meaningful rather than a comparison of two
   different plans. */
function device() {
  const a = app();
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188,
                 startDate: a.addDays(TODAY, -35) });
  a.state.setup.supportWork = 'on';
  a.cloudSession = { access_token: 't', refresh_token: 'r', user_id: 'uid-1',
                     email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  return a;
}
// The companion the engine actually put on today, so completion is permitted.
function todaysSupport(a) {
  for (let w = 1; w <= 12; w++) {
    const hit = (a.supportForWeek(w) || []).filter(x => x.date === a.todayStr())[0];
    if (hit) return hit;
  }
  throw new Error('fixture carries no supporting work on today');
}
const sig = a => a.planContentSignature(a.state);
const clone = o => JSON.parse(JSON.stringify(o));

/* Reconciliation driven through the REAL cloudReconcile(), with the account
   row served from a captured copy of the other device's state. Nothing here
   reimplements the merge. Borrowed verbatim from declineAcrossDevices.test.js
   so both files exercise one path. */
function reconcileAgainst(a, remoteState, updatedAt) {
  a.fetch = (url) => {
    if (/\/rest\/v1\/plans\?select=/.test(String(url)))
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve([{ data: remoteState, updated_at: updatedAt || '2026-09-02T08:00:00Z' }]) });
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve([{ updated_at: '2026-09-02T09:00:00Z' }]) });
  };
  return a.cloudReconcile().then(() => new Promise(r => setTimeout(r, 0)));
}

// =====================================================================
// 1. THE CONTRACT ITSELF
// =====================================================================

test('the signature is deterministic: unchanged state signs the same twice, and across devices', () => {
  const a = device(), b = device();
  assert.equal(sig(a), sig(a), 'the same state signs identically on repeat');
  assert.equal(sig(a), sig(b), 'two devices with the same plan agree');
});

test('a reload causes no signature churn', () => {
  const a = device();
  const before = sig(a);
  const reloaded = app();
  reloaded.state = JSON.parse(JSON.stringify(a.state));   // the storage round trip
  assert.equal(sig(reloaded), before, 'a plan that went through storage is the same plan');

  a.handleSupportDone(todaysSupport(a).dayId);
  const withSupport = sig(a);
  const again = app();
  again.state = JSON.parse(JSON.stringify(a.state));
  assert.equal(sig(again), withSupport, 'and so is one carrying supporting work');
});

test('property ordering inside dd.support cannot cause a false divergence', () => {
  const a = device(), b = device();
  const id = todaysSupport(a).dayId;
  const dayOf = (x) => x.state.days.filter(d => d.id === id)[0];
  // the same four facts, written in opposite key order
  dayOf(a).support = { kind: 'mobility_recovery', completedAt: '2026-09-02T07:00:00Z' };
  dayOf(b).support = { completedAt: '2026-09-02T07:00:00Z', kind: 'mobility_recovery' };
  assert.equal(sig(a), sig(b),
    'stableStringify sorts keys, and the field list is a fixed array — neither can reorder');
});

test('the synced field list is exhaustively what the writers produce', () => {
  const CODE = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const a = device();
  // joined, not deepEqual: the array comes from the VM sandbox, so a
  // structural comparison fails on cross-realm prototype identity alone.
  assert.equal(a.SUPPORT_SYNCED_FIELDS.slice().sort().join(','),
    'completedAt,dismissed,dismissedAt,kind');
  /* Every assignment to dd.support in the runtime, so a future writer adding a
     fifth key to the object without adding it here is caught. */
  const writes = CODE.match(/\.support = \{[^}]*\}/g) || [];
  assert.ok(writes.length >= 2, 'the writers must still be findable: ' + writes.length);
  const keys = new Set();
  writes.forEach(w => (w.match(/([a-zA-Z]+)\s*:/g) || [])
    .forEach(k => keys.add(k.replace(/\s*:$/, ''))));
  keys.forEach(k => assert.ok(a.SUPPORT_SYNCED_FIELDS.indexOf(k) !== -1,
    'dd.support carries "' + k + '" but the signature does not sign it — two devices that '
      + 'disagree about it would read as identical'));
});

// =====================================================================
// 2. THE SIGNATURE NOW MOVES WHEN IT SHOULD
// =====================================================================

test('completion false → true changes the signature', () => {
  const a = device();
  const before = sig(a);
  a.handleSupportDone(todaysSupport(a).dayId);
  assert.notEqual(sig(a), before);
});

test('correction true → false on Today restores the original signature exactly', () => {
  const a = device();
  const before = sig(a);
  const id = todaysSupport(a).dayId;
  a.handleSupportDone(id);
  assert.notEqual(sig(a), before);
  a.handleSupportDone(id);                        // tick it back off
  assert.equal(sig(a), before,
    'the correction returns the plan to what it was, so it must sign as what it was');
});

test('completedAt alone changes the signature — the timestamp is canonical synced truth', () => {
  const a = device(), b = device();
  const id = todaysSupport(a).dayId;
  const dayOf = (x) => x.state.days.filter(d => d.id === id)[0];
  dayOf(a).support = { kind: 'mobility_recovery', completedAt: '2026-09-02T07:00:00Z' };
  dayOf(b).support = { kind: 'mobility_recovery', completedAt: '2026-09-02T19:00:00Z' };
  assert.notEqual(sig(a), sig(b),
    'two devices recording the same work at different times have not recorded the same thing');
});

test('the kind alone changes the signature', () => {
  const a = device(), b = device();
  const id = todaysSupport(a).dayId;
  const dayOf = (x) => x.state.days.filter(d => d.id === id)[0];
  dayOf(a).support = { kind: 'mobility_recovery', completedAt: '2026-09-02T07:00:00Z' };
  dayOf(b).support = { kind: 'strength_running', completedAt: '2026-09-02T07:00:00Z' };
  assert.notEqual(sig(a), sig(b));
});

test('a decline changes the signature, and its timestamp is part of it', () => {
  const a = device(), b = device(), c = device();
  const before = sig(a);
  const id = todaysSupport(a).dayId;
  a.handleSupportSkip(id);
  assert.notEqual(sig(a), before, '"Not today" changes what the engine will prescribe');

  const dayOf = (x) => x.state.days.filter(d => d.id === id)[0];
  dayOf(b).support = { kind: null, dismissed: true, dismissedAt: '2026-09-02T07:00:00Z' };
  dayOf(c).support = { kind: null, dismissed: true, dismissedAt: '2026-09-02T19:00:00Z' };
  assert.notEqual(sig(b), sig(c));
});

test('a completion and a decline on the same day are not the same plan', () => {
  const a = device(), b = device();
  const id = todaysSupport(a).dayId;
  a.handleSupportDone(id);
  b.handleSupportSkip(id);
  assert.notEqual(sig(a), sig(b));
});

test('a change to what is PRESCRIBED still moves the signature — transitively, once', () => {
  /* The companion is derived, and deliberately not signed. It is a function of
     the days and the setup, both of which are signed, so a prescription change
     cannot happen without one of them moving. */
  const a = device();
  const before = sig(a);
  assert.ok(todaysSupport(a), 'supporting work is prescribed to begin with');

  a.state.setup.supportWork = 'off';               // removes every companion
  assert.equal((a.supportForWeek(a.currentWeekNum()) || []).length, 0, 'prescription removed');
  assert.notEqual(sig(a), before, 'and the signature moved with it');

  a.state.setup.supportWork = 'on';
  assert.equal(sig(a), before, 'putting it back is the same plan again');
});

test('ordinary run completion still changes the signature exactly as before', () => {
  const a = device();
  const before = sig(a);
  const today = a.state.days.filter(d => d.date === a.todayStr())[0];
  today.completed = true;
  assert.notEqual(sig(a), before);
});

// =====================================================================
// 3. THE SIGNATURE WAS NOT WIDENED
// =====================================================================

test('device preferences are still outside the signature', () => {
  const a = device();
  const before = sig(a);
  a.state.theme = 'light'; a.state.units = 'mi'; a.state.view = 'settings';
  assert.equal(sig(a), before,
    'which tab is open and what this phone is set to are not the training');
});

test('evolution and playbook ledgers are still NOT signed', () => {
  /* This file must not quietly reverse the position declineAcrossDevices.test.js
     protects: those are answers about a proposal, they have their own adoption
     path, and signing them would manufacture conflicts. */
  const a = device();
  const before = sig(a);
  a.state.evolution = { declinedHash: 'x', status: 'declined' };
  a.state.playbook = { declinedHash: 'y', status: 'declined' };
  a.state.evolutionHistory = [{ at: '2026-09-01', accepted: false }];
  a.state.playbookHistory = [{ at: '2026-09-01', status: 'declined' }];
  assert.equal(sig(a), before);
});

test('only dd.support was added — no other day field entered the signature', () => {
  /* Read off the REAL output rather than the source text: stableStringify
     emits valid JSON, so the signed shape can simply be parsed. An earlier
     version of this scraped the function body with a regex and silently
     missed every field that shares a line with another. */
  const a = device();
  const signedDay = JSON.parse(sig(a)).days[0];
  assert.equal(Object.keys(signedDay).sort().join(','),
    'actual,athleteState,coachAdjust,completed,date,desc,id,km,mpSegment,'
      + 'prescription,readiness,support,title,type,week',
    'the signed day fields are a stated list; this is the list');
  assert.equal(Object.keys(JSON.parse(sig(a))).sort().join(','), 'days,setup',
    'and the top level is still setup + days, nothing else');
});

// =====================================================================
// 4. CROSS-DEVICE — THE REASON FOR THE CHANGE
// =====================================================================

test('A logs supporting work; B reconciles and adopts it instead of overwriting it', async () => {
  const A = device(), B = device();
  assert.equal(sig(A), sig(B), 'the two devices begin identical');

  // B has synced, and agrees with the account as it stood.
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));

  const id = todaysSupport(A).dayId;
  A.handleSupportDone(id);
  const accountRow = clone(A.state);
  assert.notEqual(sig(A), sig(B), 'the signatures now differ — the change is observable');
  assert.match(JSON.stringify(accountRow), /"completedAt"/,
    'and the normal cloud save still carries the supporting state');

  await reconcileAgainst(B, accountRow, '2026-09-02T08:00:00Z');

  const bDay = B.state.days.filter(d => d.id === id)[0];
  assert.ok(bDay.support && bDay.support.completedAt,
    'B adopted the account copy — before the fix this took the identical-content '
      + 'branch, kept B, and the completion was lost on B’s next push');
  assert.equal(B.cloudStatus, 'synced');
  assert.equal(sig(B), sig(A), 'the two devices agree again');
});

test('adopting it discards no unrelated run or session history', async () => {
  const A = device(), B = device();
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));

  // history both devices already share
  const past = A.state.days.filter(d => d.date < A.todayStr() && d.type !== 'rest')[0];
  [A, B].forEach(x => {
    const d = x.state.days.filter(y => y.id === past.id)[0];
    d.completed = true;
    d.actual = { km: d.km, pace: '5:30', hr: 150, rpe: 5, notes: 'shared history' };
  });
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));
  assert.equal(sig(A), sig(B));

  A.handleSupportDone(todaysSupport(A).dayId);
  await reconcileAgainst(B, clone(A.state), '2026-09-02T08:00:00Z');

  const kept = B.state.days.filter(d => d.id === past.id)[0];
  assert.equal(kept.completed, true, 'the logged run survived');
  assert.equal(kept.actual.notes, 'shared history');
  assert.equal(kept.actual.rpe, 5);
});

test('reconciling introduces no loop: the mark matches, and a second pass is a no-op', async () => {
  const A = device(), B = device();
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));
  A.handleSupportDone(todaysSupport(A).dayId);
  const accountRow = clone(A.state);

  await reconcileAgainst(B, accountRow, '2026-09-02T08:00:00Z');
  const afterFirst = sig(B);
  assert.equal(B.readSyncMark().signature, afterFirst,
    'the mark records what B now actually holds, so B does not re-adopt for ever');

  await reconcileAgainst(B, accountRow, '2026-09-02T08:00:00Z');
  assert.equal(sig(B), afterFirst, 'the second pass changes nothing');
  assert.equal(B.cloudStatus, 'synced');
});

test('the inverse crosses too: a correction on A reaches B', async () => {
  const A = device(), B = device();
  const id = todaysSupport(A).dayId;
  // both devices already know about the completion
  [A, B].forEach(x => x.handleSupportDone(id));
  assert.equal(sig(A), sig(B));
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));

  A.handleSupportDone(id);                         // A corrects it back off
  assert.equal(A.state.days.filter(d => d.id === id)[0].support, null);

  await reconcileAgainst(B, clone(A.state), '2026-09-02T08:00:00Z');
  assert.equal(B.state.days.filter(d => d.id === id)[0].support, null,
    'a correction is as real a change as the completion was');
  assert.equal(sig(B), sig(A));
});

test('a decline crosses too, so the athlete is not asked again on the other device', async () => {
  const A = device(), B = device();
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));
  const id = todaysSupport(A).dayId;
  A.handleSupportSkip(id);

  await reconcileAgainst(B, clone(A.state), '2026-09-02T08:00:00Z');
  const bDay = B.state.days.filter(d => d.id === id)[0];
  assert.equal(bDay.support.dismissed, true,
    '"Not today" lives in the day record and has no ledger to carry it, so the '
      + 'signature is what makes it cross');
});

test('two devices that agree about supporting work still raise no conflict', async () => {
  const A = device(), B = device();
  const id = todaysSupport(A).dayId;
  [A, B].forEach(x => x.handleSupportDone(id));
  // same work, recorded at different instants on each device
  B.state.days.filter(d => d.id === id)[0].support.completedAt =
    A.state.days.filter(d => d.id === id)[0].support.completedAt;
  B.writeSyncMark('2026-09-02T07:00:00Z', sig(B));

  let conflictShown = false;
  B.openModal = () => { conflictShown = true; };
  await reconcileAgainst(B, clone(A.state), '2026-09-02T08:00:00Z');
  assert.equal(conflictShown, false,
    'two plans that are the same plan must never be presented as two plans');
  assert.equal(B.cloudStatus, 'synced');
});
