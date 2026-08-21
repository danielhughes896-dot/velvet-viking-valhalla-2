'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// The recovery UI (renderHero's "Sign in or restore a plan" route, the
// Restore-a-Plan modal, and the Settings Account & Backup card) has real
// data-layer tests elsewhere (planRecovery.test.js, accountMigration.test.js)
// but, per the Phase 3A1 audit, nothing asserted on the RENDERED copy or the
// modal's conditional branches themselves. These tests read the actual HTML
// strings the app produces, not a re-implementation of the branching logic.

const PINNED = '2026-03-11T09:00:00Z';
const OLD = 'uid-old-1111', NEW = 'uid-new-2222';
function app() { return loadApp({ pinnedDate: PINNED }); }
function withPlan(a, opts) {
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(a.todayStr(), -42) }, opts || {}));
  return a;
}
function strandedPlan() {
  const a = withPlan(app());
  a.stampPlanOwner(OLD);
  a.persistStateLocalOnly();
  a.resolvePlanOwnership(NEW);   // parks the plan, leaves the app with none active
  return a;
}

// document.createElement is a stub with a real innerHTML getter/setter but a
// no-op appendChild, so openModal()'s overlay is built and then discarded.
// Intercepting createElement is how the test can read what would have been
// shown, without changing anything about how the app builds it.
function captureModalHtml(a) {
  let captured = null;
  a.document.createElement = function () {
    return {
      className: '', id: '', style: {},
      addEventListener() {}, appendChild() {},
      get innerHTML() { return this._html || ''; },
      set innerHTML(v) { this._html = v; captured = v; },
    };
  };
  return () => captured;
}

// ---------------------------------------------------------------------------
// renderHero -- the no-plan screen's route back for a returning athlete
// ---------------------------------------------------------------------------

/* WHAT CHANGED HERE, AND WHY THIS IS NOT A TEST WEAKENED TO GO GREEN.

   This screen used to carry "Sign in or restore a plan" unconditionally,
   because it was a standalone landing page and nothing else offered a way in.
   /start owns authentication and returning-athlete routing now, so a second
   sign-in entry point on the screen AFTER it sends an athlete back round a
   loop they have just finished -- it is gone deliberately.

   The RECOVERY half of that route is not stale and has not gone with it. The
   bottom nav is hidden in both no-plan states, so Settings -> Restore a Plan
   is unreachable without a plan, and the athlete who needs it most is the one
   whose block was displaced by a second account on a shared device. So the
   route survives, narrowed to when this device actually holds a parked plan.
   These tests assert BOTH halves: the duplicate sign-in is gone, and the
   recovery route is not offered on an empty device and IS offered on a
   stranded one. */
test('the no-plan hero offers Build My Plan and no second sign-in', () => {
  const a = app();
  assert.equal(!!a.state.setup, false, 'precondition: a fresh app has no plan');
  const html = a.renderHero();
  assert.match(html, /Build My Plan/, 'the new-athlete path must still be offered');
  assert.doesNotMatch(html, /Sign in or restore a plan/,
    '/start owns sign-in; a second entry point here is the duplicate that was removed');
  assert.doesNotMatch(html, /data-action="cloud-sign-in"/,
    'no sign-in form may appear on the builder gateway');
});

test('a fresh device with nothing to recover is not offered recovery', () => {
  const a = app();
  assert.equal(a.recoverablePlans().length, 0, 'precondition: nothing parked');
  assert.doesNotMatch(a.renderHero(), /data-action="open-restore"/,
    'a door onto an empty room is worse than no door');
});

test('a stranded athlete keeps a route back to their displaced plan', () => {
  const a = strandedPlan();
  assert.equal(!!a.state.setup, false, 'precondition: the plan was parked, none is active');
  assert.ok(a.recoverablePlans().length, 'precondition: the parked plan is recoverable');
  const html = a.renderHero();
  assert.match(html, /data-action="open-restore"/,
    'with no bottom nav this is the only way back to Restore a Plan');
  assert.match(html, /Restore a plan from this device/);
});

test('a built plan replaces the no-plan hero, so the recovery route is not offered on top of an active plan', () => {
  const a = withPlan(app());
  const html = a.renderHero();
  assert.doesNotMatch(html, /Sign in or restore a plan/);
  assert.doesNotMatch(html, /data-action="open-restore"/);
});

// ---------------------------------------------------------------------------
// openRestoreModal -- the modal itself, across its real conditional branches
// ---------------------------------------------------------------------------

test('restore modal: nothing on-device, cloud not configured -- fallback copy only, no sign-in prompt', () => {
  const a = app();
  const read = captureModalHtml(a);
  a.SUPABASE_URL = '';   // cloudConfigured() reads these; unset both to simulate no cloud backend
  a.SUPABASE_ANON_KEY = '';
  a.openRestoreModal();
  const html = read();
  assert.match(html, /No plan is stored on this device/);
  assert.doesNotMatch(html, /Email me a sign-in link/);
});

test('restore modal: nothing on-device, signed out -- offers sign-in as the way to restore a cloud plan', () => {
  const a = app();
  const read = captureModalHtml(a);
  a.cloudSession = null;
  a.openRestoreModal();
  const html = read();
  assert.match(html, /No plan is stored on this device/);
  assert.match(html, /Signing in restores a plan you backed up to your account/);
  assert.match(html, /data-action="cloud-sign-in"/);
});

test('restore modal: nothing on-device, already signed in -- tells the athlete it is automatic, offers no button', () => {
  const a = app();
  const read = captureModalHtml(a);
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'athlete@example.com' };
  a.openRestoreModal();
  const html = read();
  assert.match(html, /Signed in as athlete@example\.com/);
  assert.doesNotMatch(html, /data-action="cloud-sign-in"/, 'already signed in: no sign-in button to show');
});

test('restore modal: an archived plan on this device is listed under "On this device" with a restore action', () => {
  const a = strandedPlan();
  const read = captureModalHtml(a);
  a.cloudSession = null;
  a.openRestoreModal();
  const html = read();
  assert.match(html, /On this device/);
  assert.match(html, /data-action="restore-plan"/);
  assert.doesNotMatch(html, /No plan is stored on this device/, 'a plan was found, so the empty-state copy must not also show');
});

test('restoring never destroys the plan currently open -- reassurance copy is always present', () => {
  const a = app();
  const read = captureModalHtml(a);
  a.openRestoreModal();
  assert.match(read(), /Restoring never deletes another plan/);
});

// ---------------------------------------------------------------------------
// Settings: Account & Backup truthfully reflects a later-revoked session
// ---------------------------------------------------------------------------

test('Settings: an ordinary signed-in, non-revoked session reads as signed in, not revoked', () => {
  const a = app();
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'athlete@example.com' };
  a.cloudStatus = 'synced';
  const html = a.renderCloudCard();
  assert.doesNotMatch(html, /Access ended/);
  assert.match(html, /athlete@example\.com/);
});

test('Settings: a session the server has revoked is shown as ended, without hiding sign-out or deletion', () => {
  const a = app();
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'athlete@example.com' };
  a.entitlementInfo = { signed_in: true, access: false, reason: 'expired' };
  const html = a.renderCloudCard();
  assert.match(html, /Access ended/);
  assert.match(html, /no longer has access/i);
  assert.match(html, /data-action="cloud-sign-out"/, 'signing out must still be reachable');
  assert.match(html, /data-action="cloud-delete-account"/, 'deleting the account must still be reachable');
});

test('Settings: entitlementInfo remains display-only -- a revoked flag changes copy, never what is offered', () => {
  const a = app();
  a.cloudSession = { access_token: 't', user_id: NEW, email: 'athlete@example.com' };
  a.entitlementInfo = { signed_in: true, access: false };
  const revokedButtons = (a.renderCloudCard().match(/data-action="[a-z-]+"/g) || []).sort();
  a.entitlementInfo = null;
  const normalButtons = (a.renderCloudCard().match(/data-action="[a-z-]+"/g) || []).sort();
  assert.deepEqual(revokedButtons, normalButtons, 'the same actions are offered either way');
});

// ---------------------------------------------------------------------------
// /get copy -- must not claim "no account needed" now that account gating is
// real architecture, even while VVV_ACCOUNT_REQUIRED stays off
// ---------------------------------------------------------------------------

test('get.html no longer claims no account is needed', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'get.html'), 'utf8');
  const flat = html.replace(/\s+/g, ' ');
  assert.doesNotMatch(flat, /no account\s*needed/i);
  assert.doesNotMatch(flat, /nothing is uploaded/i);
  assert.doesNotMatch(flat, /subscription/i, 'no commercial claims before commercial activation');
  assert.doesNotMatch(flat, /\btrial\b/i, 'no trial claims before a trial exists');
  assert.doesNotMatch(flat, /strava/i, 'no Strava claims on an unrelated install page');
  assert.match(flat, /account may be needed/i);
});

test('account.html references an icon file that actually exists', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'account.html'), 'utf8');
  const m = /<link rel="icon" href="([^"]+)">/.exec(html);
  assert.ok(m, 'account.html must declare a favicon');
  const assetPath = path.join(__dirname, '..', m[1].replace(/^\//, ''));
  assert.ok(fs.existsSync(assetPath), m[1] + ' does not exist on disk');
});
