'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// /get is the private-beta tester's install lobby: the last step after the
// marketing site, sent an invited tester straight to "how do I get Sacoro
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
  // App Store route itself is available for Sacoro.
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

test('get.html: the shared crest DELIVERY asset is used and exists on disk', () => {
  /* ---- CHANGED SIDES: THERE IS NO CREST ON THIS PAGE ----
     This pinned the crest's 640px encoding as the image at the head of the
     sign-up page. Founder: "They should both change to the dot SACORO dot."
     The page is headed by the name now, which is text, costs nothing to
     download and can be renamed. */
  assert.equal(HTML.indexOf('velvet-viking-crest'), -1, 'the sign-up page is serving the crest again');
  assert.equal(HTML.indexOf('class="medallion"'), -1);
  assert.match(HTML, /<h1 class="vvv-wordmark">Sacoro<\/h1>/,
    'the page lost its one heading, or the heading stopped being the name');
});

test('get.html: shares the app\'s declared theme and token stylesheet rather than its own palette', () => {
  assert.match(HTML, /<html lang="en" data-theme="dark">/,
    'the theme is declared in the markup now, so this page cannot arrive wrong');
  assert.match(HTML, /href="\/assets\/vvv-shell\.css"/,
    'palette must come from the shared shell, not a pasted copy that can drift');
});

test('get.html: arrives on the product\'s one dark surface, with nothing to resolve', () => {
  // HQ specifically asked this page be checked for a legacy appearance. There
  // is no longer a preference to read: the page is dark in its own markup.
  assert.ok(!/data-vvv-theme-boot/.test(HTML),
    'a boot snippet survives for a theme that cannot vary');
  assert.ok(!/\[data-theme="light"\]/.test(HTML), 'a light override survives here');
  assert.match(HTML, /<meta name="theme-color" content="#151417">/);
});
