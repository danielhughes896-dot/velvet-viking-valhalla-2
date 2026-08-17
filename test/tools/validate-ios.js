#!/usr/bin/env node
'use strict';
/* iOS configuration validator, for a Linux CI runner.
 *
 * Deliberately not a node:test suite: this runs AFTER `cap sync ios` in CI, and
 * so must be able to inspect files that `cap sync` regenerates and that the
 * repository does not track (ios/App/App/capacitor.config.json is gitignored).
 * The repository-only assertions live in test/storeReadiness.test.js and run in
 * the ordinary suite; these are the ones that need a synced project.
 *
 * Exits non-zero with one line per failure. */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok : fail).push(msg);

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

// A parser, not a plist library: the only structures asserted here are flat
// arrays of strings, and a dependency for that would be a dependency to audit.
function plistStrings(xml, key) {
  const at = xml.indexOf('<key>' + key + '</key>');
  if (at === -1) return null;
  const arr = xml.indexOf('<array>', at);
  if (arr === -1) return null;
  const end = xml.indexOf('</array>', arr);
  return (xml.slice(arr, end).match(/<string>([^<]*)<\/string>/g) || [])
    .map(s => s.replace(/<\/?string>/g, ''));
}

check(exists('ios/App/App.xcodeproj/project.pbxproj'), 'Xcode project present');
check(exists('ios/App/App/Info.plist'), 'Info.plist present');
check(exists('ios/App/App/PrivacyInfo.xcprivacy'), 'privacy manifest present');
check(exists('ios/App/App/AppDelegate.swift') && exists('ios/App/App/SceneDelegate.swift'),
  'app lifecycle sources present');

if (exists('ios/App/App/Info.plist')) {
  const plist = read('ios/App/App/Info.plist');
  // Parses at all. An unparseable plist is a build that fails on the Mac.
  check(/<\/plist>\s*$/.test(plist.trim()), 'Info.plist is well-formed to its close tag');
  check(!/<!--[^>]*--[^>]*-->/.test(plist.replace(/-->/g, '')), 'no "--" inside an XML comment');

  const schemes = plistStrings(plist, 'CFBundleURLSchemes');
  check(schemes && schemes.indexOf('com.velvetviking.valhalla') !== -1,
    'auth URL scheme com.velvetviking.valhalla is claimed (without it, iOS sign-in cannot return to the app)');

  const caps = plistStrings(plist, 'UIRequiredDeviceCapabilities');
  check(caps && caps.indexOf('armv7') === -1, 'no armv7 device requirement');

  // Nothing the product does not do. An unused usage string is a question at
  // review, and a tracking prompt for an app that does not track is worse.
  ['NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription',
   'NSHealthShareUsageDescription', 'NSHealthUpdateUsageDescription',
   'NSMotionUsageDescription', 'NSCameraUsageDescription',
   'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription',
   'NSBluetoothAlwaysUsageDescription', 'NSUserTrackingUsageDescription']
    .forEach(k => check(plist.indexOf('<key>' + k + '</key>') === -1,
      'no ' + k + ' (the product does not use it)'));

  check(plist.indexOf('NSAllowsArbitraryLoads') === -1,
    'App Transport Security is not weakened');
}

if (exists('ios/App/App/PrivacyInfo.xcprivacy')) {
  const pm = read('ios/App/App/PrivacyInfo.xcprivacy');
  check(/NSPrivacyAccessedAPICategoryFileTimestamp/.test(pm),
    'file-timestamp required-reason API declared (@capacitor/filesystem needs it)');
  check(/C617\.1/.test(pm), 'and its reason code');
  check(/<key>NSPrivacyTracking<\/key>\s*<false\/>/.test(pm), 'tracking declared false');
}

// cap sync writes this; it is gitignored, so it can only be checked post-sync.
if (exists('ios/App/App/capacitor.config.json')) {
  const cfg = JSON.parse(read('ios/App/App/capacitor.config.json'));
  check(cfg.appId === 'com.velvetviking.valhalla', 'synced appId matches the Android applicationId');
  check(!!(cfg.server && /^https:\/\//.test(cfg.server.url)), 'remote runtime URL is https');
  const root = JSON.parse(read('capacitor.config.json'));
  check(cfg.server.url === root.server.url, 'synced runtime URL matches capacitor.config.json');
} else {
  fail.push('ios/App/App/capacitor.config.json missing -- run `npx cap sync ios` first');
}

ok.forEach(m => console.log('  ok    ' + m));
fail.forEach(m => console.log('  FAIL  ' + m));
console.log('\n' + ok.length + ' passed, ' + fail.length + ' failed');
process.exit(fail.length ? 1 : 0);
