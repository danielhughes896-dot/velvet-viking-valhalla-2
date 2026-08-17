'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// PHASE 4 WORKSTREAM 2 -- T. CROSS-DEVICE DECLINE MEMORY.
//
// THE DEFECT, reproduced below through the real reconciliation path.
//
// cloudPutPlan() uploads the whole state object, so a decline recorded on the
// phone genuinely reaches the account. planContentSignature() signs setup and
// day content -- not the decline ledgers -- which is right: a decline is not
// training content, and signing it would make two devices that agree about
// every session look like they disagree.
//
// But cloudReconcile()'s identical-content branch reads that signature and
// returns without adopting anything:
//
//     if (localSig===remoteSig){ writeSyncMark(...); return; }
//
// Both facts are individually correct and together they lose the decline. An
// athlete declines a proposal on their phone, opens the laptop, and is asked
// the identical question again -- the one thing the product promises never to
// do.
//
// THE FIX has to thread a narrow gap. It must not put ephemeral state into the
// content signature (that would manufacture conflicts between devices that
// agree about the training), must not overwrite newer local training content,
// must not turn reconciliation into last-write-wins over unrelated state, and
// must leave the existing content semantics exactly as they are.
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => new Date(Date.UTC(2026, 4, 20) + n * 86400000).toISOString().slice(0, 10);
const day = (date, type, km, extra) =>
  Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});

function proposingPlan(a) {
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21) });
  a.state.days = [
    day(a.addDays(TODAY, -1), 'threshold', 10),
    day(D(1), 'easy', 5),
    day(D(2), 'rest', 0),
    day(D(4), 'long', 20)
  ];
  a.showToast = () => {};
  a.cloudSession = { access_token: 't', refresh_token: 'r', user_id: 'uid-1',
                     email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  return a;
}

/* Reconciliation driven through the REAL cloudReconcile(), with the account
   row served from a captured copy of the other device's state. Nothing here
   reimplements the merge. */
function reconcileAgainst(a, remoteState, updatedAt) {
  a.fetch = (url, opts) => {
    if (/\/rest\/v1\/plans\?select=/.test(String(url)))
      return Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve([{ data: remoteState, updated_at: updatedAt || '2026-05-20T08:00:00Z' }]) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ updated_at: '2026-05-20T09:00:00Z' }]) });
  };
  return a.cloudReconcile().then(() => new Promise(r => setTimeout(r, 0)));
}
const clone = o => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------
// THE REPRODUCTION
// ---------------------------------------------------------------------------
test('T. a decline made on one device is not lost when the other reconciles', async () => {
  // DEVICE A: sees the proposal, declines it, and the state goes to the account.
  const A = proposingPlan(app());
  const proposal = A.planEvolution();
  assert.ok(proposal.changes.length, 'the fixture must produce a real proposal');
  A.handleDeclineEvolution();
  assert.ok(A.state.evolution.declinedHash, 'device A remembers');
  const accountRow = clone(A.state);

  // DEVICE B: identical training, no decline of its own.
  const B = proposingPlan(app());
  assert.equal(B.planContentSignature(B.state), A.planContentSignature(A.state),
    'the two devices genuinely agree about every session -- that is the whole trap');
  assert.equal(B.evolutionProposalVisible(B.planEvolution()), true, 'B would ask');

  await reconcileAgainst(B, accountRow);

  assert.equal(B.evolutionProposalVisible(B.planEvolution()), false,
    'the athlete already answered this question, on a different screen');
  assert.equal((B.state.evolution || {}).declinedHash, proposal.evidenceHash);
});

test('T. the Playbook ledger travels the same way', async () => {
  const A = proposingPlan(app());
  A.state.playbook = { lastDecision: 'PROGRESS', lastDecisionAt: '2026-05-19T10:00:00Z',
                       lastDayId: D(4), evidenceHash: 'pb-evidence',
                       sessionsAtDecision: 12, declinedHash: 'pb-declined', status: 'declined' };
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  await reconcileAgainst(B, accountRow);
  assert.equal((B.state.playbook || {}).declinedHash, 'pb-declined',
    'both ledgers or neither -- the athlete does not know which engine asked');
  assert.equal(B.state.playbook.status, 'declined');
});

// ---------------------------------------------------------------------------
// THE GAP THE FIX HAD TO THREAD
// ---------------------------------------------------------------------------
test('T. the content signature still says nothing about declines', () => {
  const a = proposingPlan(app());
  const before = a.planContentSignature(a.state);
  a.handleDeclineEvolution();
  assert.equal(a.planContentSignature(a.state), before,
    'a decline is not training content, and signing it would make two devices ' +
    'that agree about every session look like they disagree');
});

test('T. declining on one device creates no cloud conflict on the other', async () => {
  const A = proposingPlan(app());
  A.handleDeclineEvolution();
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  let conflictShown = false;
  B.openModal = () => { conflictShown = true; };
  await reconcileAgainst(B, accountRow);
  assert.equal(conflictShown, false,
    'two plans that are the same plan must never be presented as two plans');
  assert.equal(B.cloudStatus, 'synced');
});

test('T. newer local TRAINING content is never overwritten by the metadata path', async () => {
  const A = proposingPlan(app());
  A.handleDeclineEvolution();
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  B.findDay(D(4)).km = 26;                      // B's athlete lengthened their long run
  assert.notEqual(B.planContentSignature(B.state), A.planContentSignature(A.state));
  const daysBefore = clone(B.state.days);

  await reconcileAgainst(B, accountRow);
  assert.deepEqual(clone(B.state.days), daysBefore,
    'different content takes the ordinary path, and this one has no opinion about it');
});

test('T. reconciliation does not become last-write-wins over unrelated state', async () => {
  const A = proposingPlan(app());
  A.handleDeclineEvolution();
  A.state.theme = 'dark'; A.state.themeExplicit = true;
  A.state.units = 'mi'; A.state.view = 'planhq'; A.state.notifyEnabled = true;
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  B.state.theme = 'light'; B.state.themeExplicit = true;
  B.state.units = 'km'; B.state.view = 'today'; B.state.notifyEnabled = false;

  await reconcileAgainst(B, accountRow);
  assert.equal(B.state.theme, 'light', 'the theme belongs to the device, and B chose it');
  assert.equal(B.state.units, 'km');
  assert.equal(B.state.view, 'today');
  assert.equal(B.state.notifyEnabled, false,
    'only the decline ledgers cross — everything else is still the device\'s own');
});

test('T. the adopted set is exactly the decision ledgers, and nothing else', () => {
  const a = proposingPlan(app());
  // joined, not deepEqual: an array from the VM sandbox carries the sandbox's
  // own Array.prototype and fails reference-equality on the prototype alone.
  const adopted = a.RECONCILED_DECISION_KEYS.slice().sort();
  assert.equal(adopted.join(','), 'evolution,evolutionHistory,playbook,playbookHistory');
  ['days', 'setup', 'theme', 'units', 'view', 'notifyEnabled', 'ownerUid', 'experience']
    .forEach(k => assert.ok(adopted.indexOf(k) === -1,
      k + ' is not a decision ledger and must not ride this path'));
});

test('T. a remote row with no ledgers leaves local ones alone', async () => {
  const A = proposingPlan(app());
  const bare = clone(A.state);
  delete bare.evolution; delete bare.playbook;

  const B = proposingPlan(app());
  B.handleDeclineEvolution();
  const mine = B.state.evolution.declinedHash;
  await reconcileAgainst(B, bare);
  assert.equal(B.state.evolution.declinedHash, mine,
    'an older device that has never recorded a decline must not erase one');
});

test('T. a local decline is not replaced by a remote row that has none', async () => {
  const A = proposingPlan(app());
  A.state.evolution = { declinedHash: null, lastAcceptedHash: null };
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  B.handleDeclineEvolution();
  const mine = B.state.evolution.declinedHash;
  await reconcileAgainst(B, accountRow);
  assert.equal(B.state.evolution.declinedHash, mine,
    'a decline is an answer the athlete gave; an absent one is not a newer answer');
});

test('T. an accepted proposal on one device is not re-offered on the other', async () => {
  /* Acceptance CHANGES the training, so this case never reaches the identical-
     content branch at all -- it is the ordinary "the account moved and this
     device did not" path, which has always adopted the whole state. Asserted
     here anyway, because the fix must not have disturbed it. */
  const A = proposingPlan(app());
  const ev = A.planEvolution();
  A.handleAcceptEvolution(ev.proposalId);
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  B.writeSyncMark('2026-05-19T00:00:00Z', B.planContentSignature(B.state));  // B has logged nothing new
  await reconcileAgainst(B, accountRow);

  assert.equal(B.state.evolution.lastAcceptedHash, ev.evidenceHash,
    'the acceptance record travels, so history is one history');
  assert.equal(B.state.evolutionHistory.length, 1);
  assert.ok(B.state.days.some(d => d.coachAdjust), 'and so does the change itself');
});

test('T. history is adopted whole rather than merged into duplicates', async () => {
  const A = proposingPlan(app());
  A.handleDeclineEvolution();
  const accountRow = clone(A.state);
  assert.equal(accountRow.evolutionHistory.length, 1);

  const B = proposingPlan(app());
  B.handleDeclineEvolution();                    // B answered the same question locally
  await reconcileAgainst(B, accountRow);
  assert.equal(B.state.evolutionHistory.length, 1,
    'the account is the record; two devices answering once is one answer, not two');
});

// ---------------------------------------------------------------------------
// THE ORDINARY PATHS ARE UNTOUCHED
// ---------------------------------------------------------------------------
test('T. a brand-new device still takes the whole plan down', async () => {
  const A = proposingPlan(app());
  A.handleDeclineEvolution();
  const accountRow = clone(A.state);

  const B = app();
  B.state = B.makeDefaultState();                // a device that has never built anything
  B.showToast = () => {};
  B.cloudSession = { access_token: 't', user_id: 'uid-1', email: 'a@b.c',
                     expires_at: Date.now() + 3600e3 };
  await reconcileAgainst(B, accountRow);
  assert.ok(B.state.days.length, 'an empty device still pulls the plan down');
  assert.ok(B.state.evolution, 'and the ledgers come with it, as they always did');
});

test('T. genuinely divergent content still raises the conflict it always raised', async () => {
  const A = proposingPlan(app());
  A.findDay(D(4)).km = 30;
  const accountRow = clone(A.state);

  const B = proposingPlan(app());
  B.findDay(D(4)).km = 18;
  B.writeSyncMark('2026-05-19T00:00:00Z', 'a-signature-neither-side-has-now');
  let conflict = false;
  B.openModal = () => { conflict = true; };
  await reconcileAgainst(B, accountRow);
  assert.equal(conflict, true, 'two real plans still get the question they always got');
  assert.equal(B.findDay(D(4)).km, 18, 'and nothing is chosen for the athlete');
});
