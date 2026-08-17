'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// /get is the private-beta tester's install lobby: the last step after the
// marketing site, sent an invited tester straight to "how do I get Valhalla
// onto this device". A live check once found this exact page serving
// obsolete copy -- customer-facing VDOT and an absolute "no account, nothing
// uploaded" claim -- despite the repository having long since corrected both.
// That was a stale deployment, not a stale file, but the page itself gets no
// regression coverage of its own beyond the single account-claim assertion in
// accountUxCopy.test.js. This file closes that gap so a future edit to this
// page cannot silently reintroduce either defect, and pins the shape of the
// three distribution paths and the Android download mechanism HQ specified.

const HTML = fs.readFileSync(path.join(__dirname, '..', 'get.html'), 'utf8');
const FLAT = HTML.replace(/\s+/g, ' ');

test('get.html: zero customer-facing VDOT, in any casing', () => {
  assert.doesNotMatch(FLAT, /VDOT/i);
});

test('get.html: the obsolete absolute privacy/account claim stays gone', () => {
  assert.doesNotMatch(FLAT, /no account\s*needed/i);
  assert.doesNotMatch(FLAT, /nothing is uploaded/i);
  assert.doesNotMatch(FLAT, /there'?s no account/i);
});

test('get.html: does not imply an App Store app exists', () => {
  // The page DOES mention "App Store" -- correctly, to explain why the PWA
  // route is the way in on iOS ("Apple only allows real installs through the
  // App Store, so this is the way in"). What it must never do is claim the
  // App Store route itself is available for Valhalla.
  assert.doesNotMatch(FLAT, /(download|available|get it|find it)[^.]{0,40}App Store/i,
    'iOS only has the PWA route today -- claiming an App Store download exists ' +
    'would send a beta tester looking for something that is not there');
  assert.doesNotMatch(FLAT, /App Store[^.]{0,40}(download|available|coming soon)/i);
});

test('get.html: all three distribution paths are present, each with its own id', () => {
  ['card-android', 'card-ios', 'card-web'].forEach(id => {
    assert.match(HTML, new RegExp('id="' + id + '"'), id + ' card missing');
  });
});

test('get.html: Android download uses the "latest release" mechanism, not a pinned tag', () => {
  // Pinning to a specific release tag (e.g. manual-build-212) would silently
  // stop updating the moment a newer beta ships; /latest/ always resolves to
  // whatever was most recently published, which is the whole point of it.
  const m = /id="apk-link"[^>]*href="([^"]+)"/.exec(HTML);
  assert.ok(m, 'no #apk-link element found');
  assert.match(m[1], /^https:\/\/github\.com\/danielhughes896-dot\/velvet-viking-valhalla-2\/releases\/latest\/download\/app-debug\.apk$/);
});

test('get.html: the canonical crest asset is used and exists on disk', () => {
  const m = /class="medallion" src="([^"]+)"/.exec(HTML);
  assert.ok(m, 'no crest <img> found');
  assert.equal(m[1], '/assets/velvet-viking-crest.png',
    'must be the same canonical crest the app itself renders, not a copy');
  const assetPath = path.join(__dirname, '..', m[1].replace(/^\//, ''));
  assert.ok(fs.existsSync(assetPath), m[1] + ' does not exist on disk');
});

test('get.html: shares the app\'s theme boot and token stylesheet rather than its own palette', () => {
  assert.match(HTML, /data-vvv-theme-boot/,
    'without the shared boot snippet this page flashes the wrong theme before paint');
  assert.match(HTML, /href="\/assets\/vvv-shell\.css"/,
    'palette must come from the shared shell, not a pasted copy that can drift');
});

test('get.html: defaults an unrecognised/new device to light, not a legacy dark surface', () => {
  // Mirrors themeSystem.test.js's own assertion about the boot snippet; pinned
  // again here because this page's own defaults are what HQ specifically
  // asked be checked ("avoid legacy dark-page appearance if currently present").
  const snippet = /<script data-vvv-theme-boot>([\s\S]*?)<\/script>/.exec(HTML)[1];
  const run = stored => {
    const attr = { value: null };
    const fn = new Function('localStorage', 'document', snippet);
    fn({ getItem: () => stored }, { documentElement: { setAttribute: (k, v) => { attr.value = v; } } });
    return attr.value;
  };
  assert.equal(run(null), 'light');
  assert.equal(run('not json'), 'light');
});
