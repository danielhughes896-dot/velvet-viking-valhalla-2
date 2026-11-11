'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* THE CREST IS ARCHIVED, NOT SERVED
 * ===========================================================================
 * ---- THIS WHOLE FILE CHANGED SIDES ----
 * It used to pin how the Velvet Viking crest was delivered: a 540px encoding
 * for the app and four pages, a 640px one for the sign-up page, each inside a
 * byte budget, never the 2 MB master. Ten laws, all of them about serving the
 * crest well.
 *
 * Founder: "We don't need an emblem everywhere for the app. It's simply the
 * name with the dots. That's it. Clean & sleek." And of the five public pages
 * and the first-run screen: "They should both change to the dot SACORO dot."
 *
 * So nothing serves it at all now, and the laws about serving it well have
 * nothing left to hold. What replaces them is the one thing that can still go
 * wrong: the crest coming back. That matters more than it sounds, because the
 * crest's lettering is part of the artwork and the artwork reads VALHALLA
 * AWAITS -- a name this product no longer has, in a form no rename can reach.
 * It survived one rename already for exactly that reason.
 *
 * THE FILES ARE STILL ON DISK. The master is the company's own artwork and is
 * kept as it was supplied; the two delivery encodings are orphans beside it.
 * Deleting them is the founder's call, not a tidy-up.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const MASTER = path.join(ROOT, 'assets', 'velvet-viking-crest.png');

/* Every document a browser can be handed. */
const PAGES = ['get.html', 'start.html', 'account.html', 'privacy.html', 'terms.html',
               'www/index.html', 'assets/vvv-shell.css', 'sw.js'];

/* PNG header, read directly rather than trusted from a filename. */
function pngSize(file){
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(33);
  fs.readSync(fd, buf, 0, 33, 0);
  fs.closeSync(fd);
  assert.equal(buf.slice(0, 8).toString('binary'), '\x89PNG\r\n\x1a\n', file + ' is not a PNG');
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), bytes: fs.statSync(file).size };
}

test('the canonical master is present and untouched', () => {
  assert.ok(fs.existsSync(MASTER), 'the canonical crest master is gone');
  const m = pngSize(MASTER);
  assert.equal(m.w, 1223);
  assert.equal(m.h, 1286);
  assert.equal(m.bytes, 2100661, 'the master was re-encoded -- it is the archival original');
});

test('no page serves the crest, in any encoding', () => {
  PAGES.forEach(p => {
    const s = fs.readFileSync(path.join(ROOT, p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    const at = s.indexOf('velvet-viking-crest');
    assert.equal(at, -1,
      p + ' references the crest again: "' + s.slice(Math.max(0, at - 40), at + 50).replace(/\s+/g, ' ') +
      '". Its artwork still reads VALHALLA AWAITS; the mark is the name between two dots');
  });
});

test('the app draws no crest and downloads none', () => {
  /* Read with the comments taken out, because the code that used to draw it
     left a note behind saying what it was and why it went -- and a law that
     matches its own explanation asks the next person to delete the reasoning. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(code.indexOf('velvet-viking-crest'), -1,
    'the app references a crest file again');
  assert.equal(code.indexOf('medallion-img'), -1,
    'the crest <img> or its styling is back in the app');
  /* THE REASON THIS IS A LAW AND NOT A TIDY-UP. The <img> was loading="eager"
     and the only screen that mounted it hid it with display:none, so every
     open of Today paid for 137 KB of artwork in order to paint nothing. */
  const a = loadApp();
  assert.equal(a.renderMedallion(), '',
    'renderMedallion() is emitting markup again; it is mounted on Today, where it was hidden');
});
