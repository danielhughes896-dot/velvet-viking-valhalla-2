'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// The sign-in field in Settings was a near-black box sitting on a cream page.
// It was not a colour mistake -- it was a dark-mode component that had never
// been converted, drawing from the --modal-* ramp that is deliberately fixed
// dark in both themes. The bottom nav's active tab had the same origin: the
// dark treatment transplanted onto cream as a heavy black slab.
//
// The fix is a token layer, not a repaint. --ctl-* is the modal ramp character
// for character in DARK, so the dark theme cannot move; it is cream, warm
// stone and deep bronze in LIGHT; and inside .modal-card it is pinned back to
// the fixed ramp, so a modal is still the lit stage it was designed to be.
//
// These tests pin the separation, the measured contrast, and the rule that
// gold stays an accent rather than becoming the interface.
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, 'assets', 'vvv-shell.css'), 'utf8');

function lum(hex) {
  const c = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
/* Read a token out of a specific rule block, so a test cannot accidentally
   assert against the dark value while claiming to check the light one. */
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
const lightApp = n => tokenIn(APP, '[data-theme="light"]', n);
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

test('a modal is still the lit stage in both themes', () => {
  const card = /\.modal-card\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.match(card, /--ctl-bg:var\(--modal-input-bg\)/,
    'pinned back inside the card, so one .field rule serves both contexts');
  assert.match(card, /--ctl-text:var\(--modal-text\)/);
  assert.match(card, /color-scheme:dark/);
});

// ---------------------------------------------------------------------------
// LIGHT IS A DESIGN, NOT AN INVERSION
// ---------------------------------------------------------------------------
test('no control in light mode is a dark-mode leftover', () => {
  ['--ctl-bg', '--ctl-surface'].forEach(t => {
    const v = lightApp(t);
    assert.ok(lum(v) > 0.75,
      t + ' is ' + v + ' — a light surface cannot be a dark one with a light label on it');
  });
});

test('the email field an athlete actually types into is measured, not guessed', () => {
  const bg = lightApp('--ctl-bg'), border = lightApp('--ctl-border');
  const text = lightApp('--ctl-text'), holder = lightApp('--ctl-placeholder');
  const page = lightApp('--bg');
  assert.ok(ratio(text, bg) >= 4.5, 'what you type must be readable: ' + ratio(text, bg).toFixed(2));
  assert.ok(ratio(holder, bg) >= 4.5, 'so must the hint: ' + ratio(holder, bg).toFixed(2));
  assert.ok(ratio(border, bg) >= 3, 'the field needs an edge: ' + ratio(border, bg).toFixed(2));
  assert.ok(ratio(border, page) >= 3,
    'and that edge has to be visible against the page too: ' + ratio(border, page).toFixed(2));
});

test('focus is visible without shouting', () => {
  const accent = lightApp('--ctl-accent'), bg = lightApp('--ctl-bg');
  assert.ok(ratio(accent, bg) >= 3, 'focus ring: ' + ratio(accent, bg).toFixed(2));
  assert.match(APP, /\.field input:focus[^{]*\{[^}]*box-shadow:0 0 0 2px rgba\(var\(--ctl-accent-rgb\)/,
    'the ring is a ring, not a colour swap that colour-blind athletes cannot see');
});

test('disabled is legible and obviously inert, not merely faded', () => {
  const bg = lightApp('--ctl-disabled-bg'), text = lightApp('--ctl-disabled-text');
  assert.ok(ratio(text, bg) >= 3,
    'a disabled label still has to be readable: ' + ratio(text, bg).toFixed(2));
  assert.ok(lum(bg) < lum(lightApp('--ctl-bg')),
    'and the fill has to say "not now" on its own');
  assert.match(APP, /\.btn:disabled, \.btn\[disabled\]\{/, 'buttons say it the same way');
  assert.match(APP, /\.field input:disabled/, 'and so do fields');
});

test('the destructive button reaches AA on cream', () => {
  const danger = lightApp('--danger-text'), page = lightApp('--bg');
  assert.ok(ratio(danger, page) >= 4.5,
    'a button that only destroys things must be legible: ' + ratio(danger, page).toFixed(2));
  assert.equal(darkApp('--danger-text'), 'var(--c-threshold)',
    'while the dark theme keeps the workout-family hue it always had');
});

test('gold stays an accent and does not become the interface', () => {
  const light = /\[data-theme="light"\]\{([\s\S]*?)\n  \}/.exec(APP)[1];
  const fills = ['--ctl-bg', '--ctl-surface', '--ctl-disabled-bg']
    .map(t => tokenIn(APP, '[data-theme="light"]', t));
  fills.forEach(v => {
    const [r, g, b] = v.replace('#', '').match(/../g).map(h => parseInt(h, 16));
    assert.ok(Math.max(r, g, b) - Math.min(r, g, b) < 22,
      v + ' is a saturated fill — gold edges things, it does not fill them');
  });
  assert.ok(light.length > 0);
});

// ---------------------------------------------------------------------------
// THE BOTTOM NAV
// ---------------------------------------------------------------------------
test('the active tab is no longer a black slab', () => {
  const rule = /\[data-theme="light"\] \.bn-item\.active\{([\s\S]*?)\}/.exec(APP)[1];
  const bg = /background:(#[0-9A-Fa-f]{6})/.exec(rule)[1];
  assert.ok(lum(bg) > 0.85, 'the selected tab used to be #2B2317; it is now ' + bg);
});

test('the active tab is unmistakable by three independent cues', () => {
  const rule = /\[data-theme="light"\] \.bn-item\.active\{([\s\S]*?)\}/.exec(APP)[1];
  const bg = /background:(#[0-9A-Fa-f]{6})/.exec(rule)[1];
  const label = /color:(#[0-9A-Fa-f]{6})/.exec(rule)[1];
  const edges = [...rule.matchAll(/inset[^,;]*?(#[0-9A-Fa-f]{6})/g)].map(m => m[1]);
  const bar = /\[data-theme="light"\]\{[\s\S]*?--ctl-surface:(#[0-9A-Fa-f]{6})/.exec(APP)[1];

  assert.ok(ratio(label, bg) >= 4.5, 'label on the tab: ' + ratio(label, bg).toFixed(2));
  assert.ok(edges.length >= 2, 'an outline and a rule, not one hairline');
  edges.forEach(e => {
    assert.ok(ratio(e, bg) >= 3, 'edge against the tab: ' + ratio(e, bg).toFixed(2));
    assert.ok(ratio(e, bar) >= 3, 'edge against the bar: ' + ratio(e, bar).toFixed(2));
  });
  assert.notEqual(bg.toLowerCase(), bar.toLowerCase(),
    'the tab must lift off the bar, not merge into it');
});

test('an inactive tab is clearly subordinate but still readable', () => {
  const idle = /\[data-theme="light"\] \.bn-item\{color:(#[0-9A-Fa-f]{6})/.exec(APP)[1];
  const active = /\[data-theme="light"\] \.bn-item\.active\{[\s\S]*?color:(#[0-9A-Fa-f]{6})/.exec(APP)[1];
  const bar = /\[data-theme="light"\]\{[\s\S]*?--ctl-surface:(#[0-9A-Fa-f]{6})/.exec(APP)[1];
  assert.ok(ratio(idle, bar) >= 4.5, 'four tabs an athlete is not on still have to be read');
  assert.notEqual(idle, active);
});

test('dark mode’s nav was left alone', () => {
  assert.match(APP, /\.bn-item\.active\{ color:var\(--modal-active\); background:rgba\(var\(--modal-active-rgb\),0\.14\); \}/,
    'its gold-on-charcoal tab was never the problem');
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

test('the shell page light ramp matches the app’s, so one product has one look', () => {
  ['--ctl-bg', '--ctl-border', '--ctl-text', '--ctl-placeholder', '--ctl-accent']
    .forEach(t => assert.equal(tokenIn(SHELL, ':root[data-theme="light"]', t), lightApp(t),
      t + ' differs between the app and the shell'));
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
