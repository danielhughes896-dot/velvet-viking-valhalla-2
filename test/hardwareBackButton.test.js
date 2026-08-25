'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

// AUDIT REPRO (Final Full Product Audit, Part 19, finding C -- unverified,
// not confirmed broken). No 'backButton' listener existed anywhere in the
// app. On Android, with no listener registered, a modal open when hardware
// back is pressed is not the ordinary mobile expectation (back should
// close the modal, not fall through to whatever the platform default does
// underneath it).
//
// THE FIX. initHardwareBackButton() -- proportionate, not a fabricated
// navigation history: closes an open modal and consumes the event; with no
// modal open, calls minimizeApp() (send-to-background, the standard
// Capacitor answer for "back at the root"), never exitApp() (which would be
// a harsher outcome than the platform's own default). Registered once from
// init(), defensively, mirroring cloudInitDeepLinks()'s exact shape.

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');

test('initHardwareBackButton() exists and is wired into init()', () => {
  const a = loadApp();
  assert.equal(typeof a.initHardwareBackButton, 'function');
  const initAt = SRC.indexOf('function init(){');
  const initBody = SRC.slice(initAt, SRC.indexOf('\nfunction ', initAt + 20));
  assert.match(initBody, /initHardwareBackButton\(\);/);
});

test('an open modal is closed on back, not exited past', () => {
  const at = SRC.indexOf('function initHardwareBackButton');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(body, /getElementById\('modal-overlay'\)/,
    'must check for an open modal the same way closeModal() itself does');
  assert.match(body, /closeModal\(\)/);
});

test('the no-modal path minimises the app rather than killing the process', () => {
  const at = SRC.indexOf('function initHardwareBackButton');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(body, /minimizeApp/,
    'must send the app to the background, the standard Capacitor root-level back behaviour');
  assert.doesNotMatch(body, /exitApp/,
    'must not terminate the app outright -- harsher than the platform default with no listener at all');
});

test('registration is defensive, same shape as cloudInitDeepLinks(): guarded, idempotent, never throws', () => {
  const at = SRC.indexOf('function initHardwareBackButton');
  const body = SRC.slice(at, SRC.indexOf('\n}\n', at));
  assert.match(body, /if \(!App \|\| !App\.addListener\) return;/);
  assert.match(body, /__vvvBackButtonBound/, 'must guard against double-registration, same pattern as the deep-link binder');
  assert.match(body, /try\{[\s\S]*App\.addListener\('backButton'/);

  // Calling it in the (Capacitor-less) test harness must not throw --
  // nativeAppPlugin() resolves to null with no window.Capacitor, so the
  // function must no-op cleanly, exactly like cloudInitDeepLinks() already does.
  const a = loadApp();
  assert.doesNotThrow(() => a.initHardwareBackButton());
});
