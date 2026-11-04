'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// THE CONTROL RAMP, AND WHAT THE SHELL OWNS.
//
// --ctl-* exists because ordinary in-page controls were being drawn from the
// --modal-* ramp, which is deliberately a fixed dark "lit stage" rather than
// a page surface. The split was introduced with light-mode values on one side
// and the modal ramp character for character on the other; light has since
// been retired, so what survives is the half that was always load-bearing:
// --ctl-* IS the modal ramp, and inside .modal-card it is pinned back to it,
// so one .field rule serves both contexts.
//
// The rest of this file is the shell's side of the same bargain -- the pages
// define their controls once, in assets/vvv-shell.css, instead of pasting a
// palette each, and every token they use is one the shell actually defines.
// That last test is what catches a page left referring to a token that was
// deleted with the light ramp.
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'assets', 'vvv-shell.css'), 'utf8');

/* Read a token out of a specific rule block by name. */
function tokenIn(css, selector, name) {
  // The app indents its rule blocks inside <style>; the shared stylesheet does
  // not. Match either terminator rather than making one file's formatting a
  // condition of the other's test passing.
  const block = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([\\s\\S]*?)\\n *\\}')
    .exec(css);
  assert.ok(block, 'no ' + selector + ' block found');
  const m = new RegExp('(?:^|[;\\s])' + name + '\\s*:\\s*([^;]+)').exec(block[1]);
  assert.ok(m, name + ' is not defined in ' + selector);
  return m[1].trim();
}
const darkApp = n => tokenIn(APP, ':root', n);

// ---------------------------------------------------------------------------
// NOTHING ABOUT DARK MOVED
// ---------------------------------------------------------------------------
test('the dark control ramp is the modal ramp, character for character', () => {
  assert.equal(darkApp('--ctl-bg'), '#24201c');
  assert.equal(darkApp('--ctl-border'), '#3d352b');
  assert.equal(darkApp('--ctl-text'), '#e6dfd5');
  assert.equal(darkApp('--ctl-accent'), '#c5a059');
  assert.equal(darkApp('--modal-input-bg'), '#24201c',
    'the modal ramp itself is untouched — the split is additive');
});

test('a modal is still the lit stage, and the control ramp is pinned to it there', () => {
  const card = /\.modal-card\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.match(card, /--ctl-bg:var\(--modal-input-bg\)/,
    'pinned back inside the card, so one .field rule serves both contexts');
  assert.match(card, /--ctl-text:var\(--modal-text\)/);
  assert.match(card, /color-scheme:dark/);
});

/* The nav's slab was deliberately removed: the bar is the page now, and the
   tabs are light on it. What replaced the slab still has to carry a STATE,
   and gold is the darker colour of the two -- #E3B15A sits well below white
   in luminance, so colour alone would make the chosen tab the quietest thing
   on the bar. These pin the three cues that answer that, and the absence of
   the thing that used to do the job. */
test('the navigation is lit, not drawn', () => {
  const bar = /\.bottom-nav\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.match(bar, /background:var\(--bg\)/, 'the bar has a surface of its own again');
  assert.match(bar, /border-top:0/, 'the rule along the top is back');

  const rest = /\n  \.bn-item\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.match(rest, /color:#FFFFFF/, 'a resting tab is no longer crisp white');
  assert.ok(!/opacity:\s*0?\.\d/.test(rest), 'a resting tab is dimmed rather than full strength');
  assert.match(rest, /text-shadow:[^;]*rgba\(255,255,255/, 'a resting tab lost its backlight');

  const act = /\.bn-item\.active\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.ok(!/background:(?!none)/.test(act), 'the slab is back on the selected tab');
  assert.match(act, /color:var\(--gold-bright\)/, 'the selected tab is not the brighter gold');
  assert.match(act, /font-weight:700/, 'weight is one of the three cues and it has gone');
  const layers = (act.match(/rgba\((?:227,177,90|245,208,97)/g) || []).length;
  assert.ok(layers >= 4,
    'the selected tab carries ' + layers + ' gold light layers; it needs to out-shout ' +
    'four bold white ones, and that is what illumination is for');
});

// ---------------------------------------------------------------------------
// ONE SHELL, NOT FIVE COPIES
// ---------------------------------------------------------------------------
test('the shell defines the controls once and the pages stopped pasting them', () => {
  ['--ctl-bg', '--ctl-border', '--ctl-text', '--ctl-accent', '--danger-ink']
    .forEach(t => assert.ok(SHELL.includes(t + ':'), 'the shell owns ' + t));
  ['account.html', 'get.html', 'privacy.html', 'terms.html'].forEach(f => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.match(s, /<link rel="stylesheet" href="\/assets\/vvv-shell\.css">/,
      f + ' must take its palette from the shell');
    assert.ok(!/--bronze\s*:\s*#/.test(s),
      f + ' still carries its own copy of the palette, which is how they drifted');
  });
});

test('every token a shell page uses is one the shell defines', () => {
  const defined = new Set([...SHELL.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
  ['account.html', 'get.html', 'privacy.html', 'terms.html'].forEach(f => {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const local = new Set([...s.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    const missing = [...new Set([...s.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]))]
      .filter(t => !defined.has(t) && !local.has(t));
    assert.deepEqual(missing, [], f + ' references tokens nothing defines');
  });
});

test('the shell carries the brand marks and the app does not repeat them everywhere', () => {
  ['.vvv-wordmark', '.vvv-crest', '.vvv-tagline'].forEach(c =>
    assert.ok(SHELL.includes(c), 'the shell needs ' + c));
  const account = fs.readFileSync(path.join(ROOT, 'account.html'), 'utf8');
  /* THE INTENT IS UNCHANGED -- this page shows the real Velvet Viking crest and
     not a substitute or a page-local copy. What moved is only which file that
     shared crest lives in: the master is 1223px of artwork rendered here at
     132 CSS px, so the pages serve a derived 540px encoding of it and the
     master is served to nobody. test/crestAsset.test.js owns the per-page
     sizing rule. */
  assert.match(account, /velvet-viking-crest-540\.png/,
    'the shared crest delivery asset, not a substitute and not the master');
  assert.match(account, /Earn Your Place/i);
  assert.match(account, /vvv-wordmark/);
});

test('inputs are 16px or iOS zooms the page the moment you tap one', () => {
  assert.match(SHELL, /\.vvv-shell input[^{]*\{[\s\S]*?font-size:16px/);
});
