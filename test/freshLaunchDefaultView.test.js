'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// VALHALLA -- FRESH-LAUNCH DEFAULT DESTINATION.
//
// state.view (the active bottom-nav tab) lives as an ordinary field on the
// one state object persistState()/loadState() serialise wholesale to
// localStorage[STORAGE_KEY] -- so whichever tab an athlete last had open was,
// by construction, the tab a reload restored. That is correct for reload
// WITHIN a live session (a tab switch is a real change worth remembering if
// the page happens to reload), and wrong for a genuine fresh app launch,
// which should always open on Today regardless of what was open before.
//
// The lifecycle distinction this suite relies on is the one the app already
// uses elsewhere (see the stravaBindResume() comment on Android's WebView
// surviving backgrounding): loadState() runs exactly once, from init(), at
// real script/process start. Foregrounding a live session re-fires
// visibilitychange, never init(), and never touches state.view. So the fix
// lives entirely inside loadState()'s own restore branch -- forcing view to
// 'today' there affects only what a NEW process boots into, never a tab
// switch mid-session -- and every test below drives that same function
// directly rather than re-simulating the browser lifecycle.
const TODAY = '2026-06-08'; // a Monday
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });

function planned(view) {
  const a = app();
  buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, -7) });
  a.showToast = () => {};
  if (view) a.state.view = view;
  a.persistStateLocalOnly();
  return a;
}

// Simulates a genuine fresh launch: a brand-new sandbox (its own init()
// already ran once, against empty storage) loads the FIRST app's saved
// blob and then calls loadState() itself -- the same call a real cold start
// makes, and the only one that ever runs against a non-empty storage key in
// this harness pattern (see restoreIntegrity.test.js's reload tests).
function reopen(a) {
  const b = app();
  b.showToast = () => {};
  b.localStorage.setItem(a.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  b.loadState();
  return b;
}

test('1. an existing athlete on a fresh launch opens on Today', () => {
  const a = planned('today');
  const b = reopen(a);
  assert.equal(b.state.view, 'today');
});

test('2. last on Settings -- fresh launch still opens on Today', () => {
  const a = planned('settings');
  const b = reopen(a);
  assert.equal(b.state.view, 'today');
  assert.match(b.renderMainContent(), /class="view-heading font-head">Today</,
    'the fresh-launch screen must actually render Today, not merely set the flag');
});

test('3. last on Full Plan -- fresh launch still opens on Today', () => {
  const a = planned('full');
  const b = reopen(a);
  assert.equal(b.state.view, 'today');
});

test('3b. last on This Week or Valhalla -- fresh launch still opens on Today', () => {
  assert.equal(reopen(planned('week')).state.view, 'today');
  assert.equal(reopen(planned('planhq')).state.view, 'today');
});

test('4. switching tabs during one live session is preserved until that session ends', () => {
  const a = planned('today');
  a.handleSetView('week');
  assert.equal(a.state.view, 'week',
    'an ordinary in-session tab change must not be forced back to Today');
  a.handleSetView('settings');
  assert.equal(a.state.view, 'settings', 'nor any other in-session change');
  // handleSetView() schedules the same persistState() a real save debounces
  // through -- it only becomes "what the next COLD START opens on" once
  // loadState() runs again, which a live session never does to itself.
  // Flushing that save and reopening as a genuine fresh launch is exactly
  // what forces it back to Today -- proving the two are independent, not
  // that the in-session change failed to save.
  a.persistStateLocalOnly();
  assert.equal(reopen(a).state.view, 'today',
    'the SAME saved settings tab opens on Today only once loadState() runs again on a new boot');
});

test('5. opening and closing a modal never touches the active tab', () => {
  // The harness's document is a stub (see builderNineStages.test.js), so
  // openModal() is intercepted the same way that suite does rather than
  // inspected through a real DOM.
  const a = planned('week');
  let opened = false;
  a.openModal = () => { opened = true; };
  a.openSetupModal();
  assert.ok(opened, 'the modal actually opened');
  assert.equal(a.state.view, 'week', 'a modal is drawn over the current screen, not a navigation');
  a.closeModal();
  assert.equal(a.state.view, 'week', 'and closing it returns to the same parent screen');
});

test('6. a no-plan athlete still gets onboarding, whatever tab was last saved', () => {
  const a = app(); // no buildPlan() -- no setup, no days
  a.showToast = () => {};
  a.state.view = 'settings';
  a.persistStateLocalOnly();
  const b = reopen(a);
  assert.ok(!b.state.setup, 'still no plan');
  const html = b.renderMainContent();
  assert.match(html, /data-action="open-setup"/,
    'renderMainContent() must route on !state.setup, independent of the view value');
});

test('7. cloud adoption on sign-in (the app\'s one authenticated state-swap path) is unaffected', async () => {
  // There is no URL/hash-driven view routing anywhere in this app (grepped:
  // no location.search/hash read ever assigns state.view) -- the closest
  // thing to a deep-link/auth landing this codebase has is adoptCloudState(),
  // reached from cloudReconcile() during sign-in. It is untouched by this
  // change and is exercised here to confirm it still resolves to a valid
  // tab rather than crashing or losing the device's own current position.
  const a = planned('week');
  a.cloudSession = { access_token: 't', user_id: 'u', email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  const remote = JSON.parse(JSON.stringify(a.state));
  a.writeSyncMark('2026-06-07T00:00:00Z', a.planContentSignature(a.state));
  a.fetch = url => /\/rest\/v1\/plans\?select=/.test(String(url))
    ? Promise.resolve({ ok: true, status: 200,
        json: () => Promise.resolve([{ data: remote, updated_at: '2026-06-08T08:00:00Z' }]) })
    : Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{}]) });
  await a.cloudReconcile();
  await new Promise(res => setTimeout(res, 0));
  assert.equal(a.state.view, 'week',
    'signing in mid-session keeps this device\'s own current tab (keepDevicePrefs), same as before this change');
});

test('8. account/commercial entry: fresh launch on a signed-in device with no plan still reaches the builder', () => {
  const a = app();
  a.showToast = () => {};
  a.state.athlete = { sessions: [{ id: 'x' }], blocks: [], performances: [] };
  a.state.view = 'full';
  a.persistStateLocalOnly();
  const b = reopen(a);
  assert.ok(!b.state.setup, 'an athlete record with no current plan is still a no-plan boot');
  assert.match(b.renderMainContent(), /data-action="open-setup"/);
});
