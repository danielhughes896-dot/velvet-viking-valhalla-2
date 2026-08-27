'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* THE LAUNCH SCREEN'S BIGGEST DOWNLOAD, PINNED
 * ===========================================================================
 * The crest was shipped as the 2,100,661-byte master while being rendered at
 * 180 CSS px, so more than three quarters of every pixel downloaded was
 * discarded before it reached the screen -- on the first screen of the app,
 * over mobile data, eagerly.
 *
 * The master is unchanged and stays the master. What the app SERVES is a 540px
 * encoding of it, and 540 is the exact device-pixel width a 3x phone draws.
 *
 * This file exists because a re-export is the obvious way for two megabytes to
 * come quietly back: someone regenerates the artwork, drops it in, and nothing
 * fails. Now something fails.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const MASTER = path.join(ROOT, 'assets', 'velvet-viking-crest.png');
const DELIVERY = path.join(ROOT, 'assets', 'velvet-viking-crest-540.png');
const DELIVERY_640 = path.join(ROOT, 'assets', 'velvet-viking-crest-640.png');

/* EVERY PAGE THAT DRAWS THE CREST, and the delivery asset each one needs.
   The rule is not "use the small file" -- it is "use a file at least as wide as
   the device pixels this page actually draws". get.html renders the crest
   larger than anywhere else, so it gets its own encoding rather than being
   quietly under-served to save 48 KB. */
const PAGES = [
  { file: 'get.html',     cssPx: 208, asset: 'velvet-viking-crest-640.png' },
  { file: 'start.html',   cssPx: 132, asset: 'velvet-viking-crest-540.png' },
  { file: 'account.html', cssPx: 132, asset: 'velvet-viking-crest-540.png' },
  { file: 'privacy.html', cssPx:  86, asset: 'velvet-viking-crest-540.png' },
  { file: 'terms.html',   cssPx:  86, asset: 'velvet-viking-crest-540.png' }
];

/* Generous enough that a legitimate re-encode is not a fight, tight enough
   that the master could never satisfy it. */
const BUDGET_BYTES = 200 * 1024;

/* PNG header, read directly rather than trusted from a filename. */
function pngSize(file){
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(33);
  fs.readSync(fd, buf, 0, 33, 0);
  fs.closeSync(fd);
  assert.equal(buf.slice(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n', file + ' is not a PNG');
  assert.equal(buf.slice(12, 16).toString('ascii'), 'IHDR', file + ' has no IHDR');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20),
           bitDepth: buf[24], colourType: buf[25],
           bytes: fs.statSync(file).size };
}

test('the canonical master is present and untouched', () => {
  assert.ok(fs.existsSync(MASTER), 'the canonical crest master is gone');
  const m = pngSize(MASTER);
  assert.equal(m.w, 1223);
  assert.equal(m.h, 1286);
  assert.equal(m.bytes, 2100661, 'the master was re-encoded -- it is the archival original');
});

test('the app serves the delivery asset, not the master', () => {
  assert.ok(fs.existsSync(DELIVERY), 'the delivery asset is missing -- the app would 404 its own logo');
  assert.match(SRC, /src="\/assets\/velvet-viking-crest-540\.png"/,
    'the launch screen points at something other than the delivery asset');
  assert.ok(!/src="\/assets\/velvet-viking-crest\.png"/.test(SRC),
    'the two-megabyte master is being served to phones again');
});

test('the delivery asset stays inside its size budget', () => {
  const d = pngSize(DELIVERY);
  assert.ok(d.bytes <= BUDGET_BYTES,
    'the crest is ' + Math.round(d.bytes / 1024) + ' KB, over the ' +
    Math.round(BUDGET_BYTES / 1024) + ' KB budget -- a full-size re-export has crept back in');
  /* And it is genuinely smaller than the master rather than a renamed copy. */
  assert.ok(d.bytes < pngSize(MASTER).bytes / 5);
});

test('the delivery asset is the size the screen actually draws', () => {
  const d = pngSize(DELIVERY);
  /* .medallion-img renders at 180 CSS px; 540 is exactly 3x that. */
  assert.match(SRC, /\.medallion-img\{[^}]*width:180px/,
    'the rendered width changed -- the 540px asset may no longer be the right size');
  assert.equal(d.w, 540, 'the delivery asset is no longer 3x the rendered width');
  assert.equal(d.colourType, 3, 'the delivery asset is no longer a palette PNG');
});

test('the markup declares the delivery asset\'s own dimensions', () => {
  /* width/height give the browser the aspect ratio before the bytes arrive.
     Declaring the master's 1223x1286 against a 540x568 file would be a lie
     that happens to round to the same ratio -- true today, fragile forever. */
  const d = pngSize(DELIVERY);
  const img = /<img class="medallion-img"[^>]*>/.exec(SRC);
  assert.ok(img, 'the medallion img element is gone');
  assert.match(img[0], new RegExp('width="' + d.w + '"'),
    'the declared width does not match the file');
  assert.match(img[0], new RegExp('height="' + d.h + '"'),
    'the declared height does not match the file');
  /* The aspect ratio must still match the master, or the crest would distort. */
  const m = pngSize(MASTER);
  assert.ok(Math.abs((d.w / d.h) - (m.w / m.h)) < 0.002,
    'the delivery asset has a different aspect ratio from the master');
});

test('the app runtime never serves the master', () => {
  assert.ok(!/["'(]\/?assets\/velvet-viking-crest\.png/.test(SRC),
    'the app runtime serves the two-megabyte master again');
  /* Naming it in a comment is fine and useful; serving it is not. */
  assert.match(SRC, /Canonical crest: assets\/velvet-viking-crest\.png/,
    'the note recording where the master lives was removed');
});

// ---------------------------------------------------------------------------
// THE OTHER FIVE PAGES -- start.html and get.html are the ones an athlete meets
// BEFORE the app, so the first two megabytes they ever downloaded was on the
// page asking them to sign up.
// ---------------------------------------------------------------------------
test('no page anywhere serves the master to a browser', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)){
      if (name === '.git' || name === 'node_modules' || name === 'assets' ||
          name === 'tools' || name === 'test') continue;
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()){ walk(p); continue; }
      if (!/\.(html|js|json|webmanifest)$/.test(name)) continue;
      /* The master may be NAMED in prose; what must not exist is a reference
         that would SERVE it. */
      if (/src=["']\/?assets\/velvet-viking-crest\.png["']/.test(fs.readFileSync(p, 'utf8')))
        offenders.push(path.relative(ROOT, p));
    }
  };
  walk(ROOT);
  assert.deepEqual(offenders.length, 0, 'these still serve the master: ' + offenders.join(', '));
});

test('every page uses a delivery asset wide enough for a 3x screen', () => {
  PAGES.forEach(pg => {
    const html = fs.readFileSync(path.join(ROOT, pg.file), 'utf8');
    const img = /<img class="(?:medallion|vvv-crest(?: sm)?)"[^>]*>/.exec(html);
    assert.ok(img, pg.file + ': the crest img element is gone');
    assert.match(img[0], new RegExp('src="/assets/' + pg.asset.replace(/\./g, '\\.') + '"'),
      pg.file + ': expected ' + pg.asset);

    const d = pngSize(path.join(ROOT, 'assets', pg.asset));
    /* The whole point: at least as many pixels as the densest phone draws. */
    assert.ok(d.w >= pg.cssPx * 3,
      pg.file + ' renders at ' + pg.cssPx + ' CSS px (' + (pg.cssPx * 3) +
      ' device px at 3x) but is served a ' + d.w + 'px asset');
    /* And the declared dimensions describe the file that is served. */
    assert.match(img[0], new RegExp('width="' + d.w + '"'),
      pg.file + ': declared width does not match the served file');
    assert.match(img[0], new RegExp('height="' + d.h + '"'),
      pg.file + ': declared height does not match the served file');
  });
});

test('the 640px asset for the sign-up page is a real, budgeted, palette PNG', () => {
  assert.ok(fs.existsSync(DELIVERY_640), 'the 640px delivery asset is missing');
  const d = pngSize(DELIVERY_640);
  const m = pngSize(MASTER);
  assert.equal(d.w, 640);
  assert.equal(d.colourType, 3, 'the 640px asset is not a palette PNG');
  assert.ok(d.bytes <= 300 * 1024,
    'the 640px asset is ' + Math.round(d.bytes / 1024) + ' KB, over budget');
  assert.ok(d.bytes < m.bytes / 5, 'the 640px asset is not meaningfully smaller than the master');
  assert.ok(Math.abs((d.w / d.h) - (m.w / m.h)) < 0.002,
    'the 640px asset has a different aspect ratio from the master -- the crest would distort');
});

test('the delivery assets are transparent, like the master', () => {
  /* Colour type 3 is palette; alpha lives in a tRNS chunk, so the byte at
     offset 25 does not report it. Read the chunk list instead. */
  const hasTRNS = (file) => {
    const b = fs.readFileSync(file);
    for (let i = 8; i + 8 <= b.length; ){
      const len = b.readUInt32BE(i);
      const type = b.slice(i + 4, i + 8).toString('ascii');
      if (type === 'tRNS') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      i += 12 + len;
    }
    return false;
  };
  [DELIVERY, DELIVERY_640].forEach(f => assert.ok(hasTRNS(f),
    path.basename(f) + ' lost its transparency -- the crest would sit on a box'));
});
