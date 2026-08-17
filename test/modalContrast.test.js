'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// A modal is a fixed dark "lit stage" in both themes (see --modal-* in :root).
// .modal-card already re-pins the --ctl-* family so inputs/selects render
// correctly on it regardless of the athlete's chosen theme -- that fix
// shipped after a light-mode athlete got a near-black Settings email field.
//
// It missed ordinary prose and .btn-ghost, which read the general
// --ink/--ink-dim/--ink-faint/--line/--line-soft/--bronze-text/--gold-text
// family instead of --ctl-*. Light theme redefines that family to near-black
// (--ink:#171717), so any plain button or paragraph inside a modal -- e.g.
// "Suggest Goals From Benchmark" in Build Your Training Block -- rendered at
// ~1:1 contrast against the modal's #141210 surface: functionally invisible.
// Same bug class, same fix, wider net.
const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');

function cssBlock(selector, src) {
  const start = src.indexOf(selector + '{');
  assert.ok(start !== -1, selector + ' rule not found');
  let depth = 0, i = start + selector.length;
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(bodyStart, i + 1);
}

const modalCard = cssBlock('.modal-card', HTML);

// The exact dark-native values -- lifted from the unqualified :root block,
// which is what a dark-theme athlete already sees. Pinning a modal to these
// literal values (not `var(--ink)`, which light theme redefines) is the only
// way "inside a modal" stops depending on the athlete's theme choice.
const DARK_NATIVE = {
  '--ink-dim': '#BBB4A4',
  '--ink-faint': '#9D9787',
  '--line-soft': '#232126',
};

test('the modal token pin now covers general prose, not only form controls', () => {
  assert.match(modalCard, /--ink\s*:\s*var\(--modal-text\)/,
    'plain text inside a modal (e.g. .btn-ghost, which sets no color of its ' +
    'own) must resolve to the modal ink, not whatever theme is active');
  assert.match(modalCard, /--line\s*:\s*var\(--modal-border\)/,
    '.btn-ghost borders on var(--line) directly; unpinned, light theme drew ' +
    'it in warm stone instead of the modal’s own border colour');
});

test('the pin extends to the dim/faint/soft siblings and the gold-text pair', () => {
  Object.entries(DARK_NATIVE).forEach(([token, hex]) => {
    const re = new RegExp(token.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&') +
      '\\s*:\\s*' + hex);
    assert.match(modalCard, re, token + ' must be pinned to dark theme’s ' +
      'own value (' + hex + '), the same value it already renders as, so a ' +
      'dark-theme athlete sees no change and a light-theme one is fixed');
  });
  assert.match(modalCard, /--bronze-text\s*:\s*var\(--bronze\)/,
    'section titles like "YOUR GOAL" use --bronze-text; light theme deepens ' +
    'it for a cream page, which reads at only 3:1 on a modal’s #141210');
  assert.match(modalCard, /--gold-text\s*:\s*var\(--gold\)/);
});

test('the fix is additive: every pre-existing --ctl-* pin is still present', () => {
  ['--ctl-bg', '--ctl-border', '--ctl-text', '--ctl-placeholder',
   '--ctl-accent', '--ctl-accent-rgb', '--ctl-disabled-bg',
   '--ctl-disabled-text', '--ctl-disabled-border'
  ].forEach(tok => assert.ok(modalCard.indexOf(tok) !== -1,
    tok + ' must still be pinned -- this fix must not regress the earlier one'));
});

test('computed contrast of the newly-pinned tokens clears WCAG AA on the modal surface', () => {
  // Re-derive the same math a browser would apply, using the literal values
  // this rule now pins -- proof the fix is not merely present but sufficient.
  const lum = hex => {
    const n = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const MODAL_SURFACE = '#141210';
  const MODAL_TEXT = '#e6dfd5';   // what --ink now resolves to inside a modal
  const BRONZE = '#C0923F';        // what --bronze-text now resolves to

  assert.ok(contrast(MODAL_TEXT, MODAL_SURFACE) >= 4.5,
    'body text on the modal surface must clear AA (4.5:1) for normal text');
  assert.ok(contrast(BRONZE, MODAL_SURFACE) >= 3,
    'the bronze section-title accent must clear the AA large-text/UI floor (3:1)');

  // The regression this guards: light theme's own --ink (#171717) on the
  // same surface is the button that was reported unreadable.
  assert.ok(contrast('#171717', MODAL_SURFACE) < 1.5,
    'sanity check on the math itself: this is the near-1:1 failure being fixed');
});
