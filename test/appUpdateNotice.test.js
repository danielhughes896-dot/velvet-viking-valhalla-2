'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE ONE THING A DEPLOY CANNOT FIX
 * ===========================================================================
 * Founder: "the web app cannot silently replace the native Android app
 * itself. But it absolutely can detect that the native shell is outdated and
 * give the user a proper Update App action."
 *
 * The APK is a Capacitor WebView pointed at the live site, so nearly every
 * change reaches an installed app on deploy. The exceptions are the ones
 * compiled into the shell -- the Android zoomEnabled flag that turns
 * pinch-to-zoom on is exactly one -- and for those the athlete is running an
 * app the web cannot repair.
 *
 * WHAT THESE LAWS ARE REALLY ABOUT: a prompt that cannot be satisfied. If
 * this row ever appears when there is nothing to install, the athlete taps
 * through to a store page offering them the version they already have, and
 * the next time it appears they ignore it. So most of what follows is about
 * the notice staying HIDDEN.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const GRADLE = fs.readFileSync(path.join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
const CAPCFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'capacitor.config.json'), 'utf8'));

// A Capacitor that reports a given installed build.
function nativeApp(build, opts){
  const o = opts || {};
  const a = loadApp();
  a.Capacitor = {
    isNativePlatform: () => o.notNative ? false : true,
    Plugins: { App: o.noPlugin ? {} : {
      getInfo: () => o.reject ? Promise.reject(new Error('nope'))
                              : Promise.resolve(o.noInfo ? null : { build: build, version: '1.0' })
    } }
  };
  return a;
}
const settle = () => new Promise(r => setImmediate(r));

test('the notice is hidden until the shell has actually answered', async () => {
  /* The Settings screen renders synchronously and App.getInfo() is a promise,
     so there is always a window where the answer is not in yet. Drawing an
     update prompt during it would be guessing. */
  const a = nativeApp('1');
  assert.equal(a.nativeUpdateAvailable(), false,
    'the notice is drawn before the installed version is known');
});

test('an outdated shell shows the notice; a current or newer one does not', async () => {
  for (const [installed, latest, expected] of [
    ['1', 2, true],    // behind
    ['2', 2, false],   // current
    ['3', 2, false],   // ahead of what we believe is live (sideload, staged rollout)
  ]){
    const a = nativeApp(installed);
    a.LATEST_NATIVE_BUILD = latest;
    a.loadNativeAppInfo();
    await settle();
    assert.equal(a.nativeUpdateAvailable(), expected,
      'installed ' + installed + ' against latest ' + latest + ' should be ' + expected);
  }
});

test('it fails closed on every way the shell can decline to answer', async () => {
  const cases = {
    'no Capacitor at all (the web app)': () => loadApp(),
    'Capacitor present but not a native platform': () => nativeApp('1', { notNative:true }),
    'an older shell whose App plugin has no getInfo': () => nativeApp('1', { noPlugin:true }),
    'getInfo rejects': () => nativeApp('1', { reject:true }),
    'getInfo resolves with nothing': () => nativeApp('1', { noInfo:true }),
    'a build string that is not a number': () => nativeApp('not-a-number'),
  };
  for (const [name, make] of Object.entries(cases)){
    const a = make();
    a.LATEST_NATIVE_BUILD = 999;
    assert.doesNotThrow(() => a.loadNativeAppInfo(), name + ': loading threw');
    await settle();
    assert.equal(a.nativeUpdateAvailable(), false,
      name + ': the notice appeared without a known installed version');
  }
});

test('the web app never shows it, whatever the numbers say', async () => {
  /* The web IS the latest version by construction -- it is the thing that
     deployed. An update prompt there would point a browser at a store. */
  const a = loadApp();
  a.LATEST_NATIVE_BUILD = 999;
  a.nativeAppInfo = { build: '1', version: '1.0' };
  assert.equal(a.nativeUpdateAvailable(), false,
    'the browser is being told to go and install an Android app');
});

test('we never claim a release that does not exist in the repository', () => {
  /* THE FALSE-PROMPT GUARD. LATEST_NATIVE_BUILD is the versionCode live on
     Play; the gradle versionCode is what the repo would build next. The repo
     legitimately runs AHEAD (commit, CI, upload, review), so these are not
     required to be equal -- but the live one can never be higher, because a
     build that is not in the repository cannot have been released from it.
     Setting this from the gradle file is the mistake this prevents: it would
     prompt every athlete the moment a native change was committed. */
  const live = Number(/var LATEST_NATIVE_BUILD = (\d+);/.exec(SRC)[1]);
  const gradle = Number(/versionCode (\d+)/.exec(GRADLE)[1]);
  assert.ok(Number.isFinite(live) && live >= 1, 'LATEST_NATIVE_BUILD is not a version');
  assert.ok(live <= gradle,
    'LATEST_NATIVE_BUILD (' + live + ') is ahead of the gradle versionCode (' + gradle +
    '), so the app will prompt for a build that was never produced');
});

test('the store link points at this package, in all three places it is written', () => {
  /* The identity lives in the runtime, capacitor.config.json and build.gradle.
     Three copies, and the one nobody edits is the one that goes stale --
     the same failure the canonical-host law already records for server.url. */
  const url = /var PLAY_STORE_URL = '([^']+)'/.exec(SRC)[1];
  const inUrl = /[?&]id=([A-Za-z0-9._]+)/.exec(url)[1];
  const inGradle = /applicationId "([^"]+)"/.exec(GRADLE)[1];
  assert.equal(inUrl, CAPCFG.appId, 'the store link and capacitor.config.json name different apps');
  assert.equal(inUrl, inGradle, 'the store link and build.gradle name different apps');
  assert.match(url, /^https:\/\/play\.google\.com\//, 'the store link is not a Play URL');
});

test('the row hands the URL to the system rather than opening it in the shell', () => {
  /* Capacitor has no allowNavigation entry for play.google.com, so an
     off-origin https link is given to the system -- which is what opens the
     Play app on the right page. Trapping it inside the WebView would strand
     the athlete on a store page with no way back. */
  const at = SRC.indexOf('var appUpdate = nativeUpdateAvailable()');
  assert.ok(at > -1, 'the update row is gone from Settings');
  const row = SRC.slice(at, at + 400);
  assert.match(row, /href:PLAY_STORE_URL/, 'the row no longer links to the store');
  assert.match(row, /external:true/,
    'the row opens in the WebView instead of being handed to the system');
});

test('it is asked for once at startup and never blocks the first paint', () => {
  const initAt = SRC.indexOf('function init(){');
  const initBody = SRC.slice(initAt, SRC.indexOf('\nfunction ', initAt + 20));
  assert.match(initBody, /loadNativeAppInfo\(\);/, 'nothing ever asks the shell its version');
  assert.doesNotMatch(initBody, /await loadNativeAppInfo/,
    'startup waits on a native plugin before painting');
  const a = loadApp();
  assert.doesNotThrow(() => a.loadNativeAppInfo(),
    'asking in a browser throws instead of no-opping');
});
