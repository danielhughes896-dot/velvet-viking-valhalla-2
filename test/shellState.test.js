'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// A live Pixel signed out and stayed exactly where it was: inside the ordinary
// five-tab app, plan intact. The DATA behaviour is right and is not changing.
// What was missing is that the app had no idea which situation it was in --
// authentication was something Settings knew about, and the shell did not.
//
// These tests pin the two rules the state machine encodes:
//
//   1. Authentication and the existence of local training data are SEPARATE
//      axes. A plan does not imply an account and an account does not imply a
//      plan. Conflating them is what produces "sign in to see your plan" in
//      front of a plan that is already on the device.
//   2. An open ownership decision outranks every other state, because until
//      the athlete answers it, nothing may quietly pick a winner.
//
// The branded welcome screen is deliberately NOT designed here. What is built
// is the seam it plugs into, switched off, so production behaviour is exactly
// what it was and the routing is nevertheless real and covered.
const UID = 'uid-1';
const ROOT = path.join(__dirname, '..');

const withPlan = a => {
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  return a;
};
const signIn = a => {
  a.cloudSession = { access_token: 't', refresh_token: 'r', user_id: UID,
                     email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  return a;
};

// ---------------------------------------------------------------------------
// THE FOUR STATES
// ---------------------------------------------------------------------------
test('signed out with nothing on the device is an arrival', () => {
  assert.equal(loadApp().resolveAppState(), 'signed-out-no-plan');
});

test('signed out with a plan is this device’s own training block', () => {
  assert.equal(withPlan(loadApp()).resolveAppState(), 'signed-out-local-plan');
});

test('signed in with a plan is the ordinary case', () => {
  assert.equal(signIn(withPlan(loadApp())).resolveAppState(), 'signed-in-plan');
});

test('an open ownership decision outranks everything', () => {
  const a = signIn(withPlan(loadApp()));
  a.cloudPendingReconcile = true;
  assert.equal(a.resolveAppState(), 'reconcile-required',
    'until the athlete answers, no other state may claim the screen');
});

test('an account without a plan is not the same as no account', () => {
  assert.equal(signIn(loadApp()).resolveAppState(), 'signed-in-no-plan');
});

test('the two axes are genuinely independent', () => {
  const seen = new Set();
  [[false, false], [false, true], [true, false], [true, true]].forEach(([plan, auth]) => {
    const a = loadApp();
    if (plan) withPlan(a);
    if (auth) signIn(a);
    const st = a.resolveAppState();
    const d = a.APP_STATES[st];
    assert.equal(d.hasPlan, plan, st + ' disagrees about the plan');
    assert.equal(d.signedIn, auth, st + ' disagrees about the account');
    seen.add(st);
  });
  assert.equal(seen.size, 4, 'four combinations, four distinct states');
});

// ---------------------------------------------------------------------------
// WHAT EACH STATE EXPOSES
// ---------------------------------------------------------------------------
test('the nav follows the state, not a scattered condition', () => {
  const a = loadApp();
  assert.equal(a.appStateAllowsNav('signed-out-no-plan'), false);
  assert.equal(a.appStateAllowsNav('signed-in-no-plan'), false);
  assert.equal(a.appStateAllowsNav('signed-out-local-plan'), true,
    'a signed-out athlete still has a plan to navigate');
  assert.equal(a.appStateAllowsNav('signed-in-plan'), true);
});

test('nothing about the shell changed for today’s athlete', () => {
  // The five-tab app appears in exactly the cases it appeared in before:
  // whenever there is a plan on the device, account or no account.
  [[true, true], [true, false]].forEach(([plan, auth]) => {
    const a = loadApp();
    if (plan) withPlan(a);
    if (auth) signIn(a);
    assert.equal(a.appStateAllowsNav(), true);
  });
  assert.equal(loadApp().appStateAllowsNav(), false, 'and not before there is one');
});

test('reconciliation keeps the tabs, because a modal is what blocks it', () => {
  const a = signIn(withPlan(loadApp()));
  a.cloudPendingReconcile = true;
  assert.equal(a.appStateAllowsNav(), true,
    'moving the enforcement into the shell is a decision for the landing design, ' +
    'not something to change quietly in a visual pass');
});

// ---------------------------------------------------------------------------
// THE SEAM, SWITCHED OFF
// ---------------------------------------------------------------------------
test('the landing is off, so signing out still lands in the plan', async () => {
  const a = signIn(withPlan(loadApp()));
  assert.equal(a.SIGNED_OUT_LANDING_ENABLED, false,
    'shipping a placeholder we intend to redesign is how placeholder copy goes live');
  a.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  a.cloudSignOut();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(a.resolveAppState(), 'signed-out-local-plan');
  assert.equal(a.shouldRenderLanding('signed-out-local-plan'), false);
  assert.match(a.renderMainContent(), /data-action="set-view"|day-top|hero/,
    'the athlete sees their training block, exactly as they do today');
});

test('the seam routes correctly when it is switched on', () => {
  const a = withPlan(loadApp());
  a.SIGNED_OUT_LANDING_ENABLED = true;
  assert.equal(a.shouldRenderLanding('signed-out-local-plan'), true);
  assert.equal(a.shouldRenderLanding('signed-in-plan'), false, 'never in front of an account');
  assert.equal(a.shouldRenderLanding('reconcile-required'), false,
    'never in front of an undecided ownership question');
  assert.match(a.renderMainContent(), /Welcome back/,
    'a device holding a training block is not a brand-new athlete');
});

test('continuing past the landing writes nothing', () => {
  const a = withPlan(loadApp());
  a.SIGNED_OUT_LANDING_ENABLED = true;
  const before = a.localStorage.getItem('velvet-viking-generator-v2');
  a.handleLandingContinue();
  assert.equal(a.shouldRenderLanding('signed-out-local-plan'), false);
  assert.equal(a.localStorage.getItem('velvet-viking-generator-v2'), before,
    'looking at your own plan is not a preference and must not be recorded as one');
});

test('signing out makes the next arrival an arrival again', async () => {
  const a = signIn(withPlan(loadApp()));
  a.SIGNED_OUT_LANDING_ENABLED = true;
  a.handleLandingContinue();
  a.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  a.cloudSignOut();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(a.shouldRenderLanding('signed-out-local-plan'), true);
});

// ---------------------------------------------------------------------------
// PHASE 3A1 SAFEGUARDS ARE UNTOUCHED
// ---------------------------------------------------------------------------
test('the state machine reads ownership, it does not decide it', () => {
  const src = fs.readFileSync(
    path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = /function resolveAppState\(\)\{[\s\S]*?\n\}/.exec(src)[0];
  [/ownerUid/, /archivePlanFor/, /takeArchivedPlan/, /writeStored/, /cloudPutPlan/, /adoptCloudState/]
    .forEach(rx => assert.ok(!rx.test(fn),
      'resolving a state must never move a plan or a stamp: ' + rx));
});

test('sign-out still keeps the plan, the archive and the displaced backup', async () => {
  const a = signIn(withPlan(loadApp()));
  a.writeStored(a.CLOUD_BACKUP_KEY, JSON.parse(JSON.stringify(a.state)));
  a.persistStateLocalOnly();
  const days = a.state.days.length;
  a.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  a.cloudSignOut();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(a.state.days.length, days);
  assert.ok(a.readStored(a.CLOUD_BACKUP_KEY));
  assert.equal(a.cloudSession, null);
});

test('the account gate is still there, still off, and still not decided here', () => {
  const gate = fs.readFileSync(path.join(ROOT, 'api', '_access.js'), 'utf8');
  assert.match(gate, /VVV_ACCOUNT_REQUIRED/, 'the gate must not be deleted');
  assert.match(gate, /function accountRequired\(\)\s*\{\s*return flagOn\(/,
    'and must stay off unless the environment says otherwise');
  const src = fs.readFileSync(
    path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const fn = /function resolveAppState\(\)\{[\s\S]*?\n\}/.exec(src)[0];
  assert.ok(!/entitlement|lease|ACCOUNT_REQUIRED/i.test(fn),
    'a presentation state must never be mistaken for a permission');
});
