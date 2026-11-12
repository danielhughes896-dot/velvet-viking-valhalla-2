'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* THE TAB BAR IS GLASS.

   Founder: "Can you do liquid glass like apple?" Then, on the mocks: "a little
   too grey and opaque ... slightly darker and more translucent, with less of
   that metallic appearance", "Make it see through like glass", and finally:

   "Increase the background blur and slightly adjust the dark glass opacity so
   underlying content becomes indistinct rather than readable. Preserve the
   translucent glass appearance, subtle reflections and depth. Keep the
   selected tab's cherry highlighting. Ensure all five navigation icons and
   labels remain crisp and readable ... Maintain smooth performance and
   appropriate fallbacks on mobile devices. Do not make the navigation fully
   opaque."

   Each sentence is a clause below. Headless Chrome cannot be trusted to draw
   backdrop-filter (it blurs the wrong region at every pixel density), so the
   look was signed off on a simulation and these laws pin the numbers that
   produce it. */

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
/* The glass rule is the .bn-stack rule that floats it. */
const block = (re, what) => { const m = re.exec(CSS); assert.ok(m, what + ' is gone'); return m[1]; };
const GLASS = block(/\n  \.bn-stack\{(\s*left:12px[\s\S]*?)\n  \}/, 'the glass pane');
const alphaOf = rule => { const m = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)\s*;/.exec(rule); return m ? +m[1] : null; };
const px = (re, s) => { const m = re.exec(s); return m ? +m[1] : null; };

test('it floats: inset from both edges and above the home indicator, with rounded ends', () => {
  assert.match(GLASS, /left:12px; right:12px;/);
  assert.match(GLASS, /bottom:calc\(10px \+ env\(safe-area-inset-bottom, 0px\)\)/, 'the bar sits on the home indicator again');
  assert.ok(px(/border-radius:(\d+)px/, GLASS) >= 24, 'the pane lost its rounded ends');
  /* A wide screen keeps it centred under the content column, not stretched. */
  assert.match(CSS, /@media \(min-width:640px\)\{ \.bn-stack\{ left:50%; right:auto; width:calc\(var\(--maxw\) - 24px\); transform:translateX\(-50%\); \} \}/);
});

test('what passes under it is indistinct, never readable, and never hidden outright', () => {
  const blur = px(/(?:^|[^-])backdrop-filter:blur\((\d+)px\)/, GLASS);
  assert.ok(blur >= 14 && blur <= 24,
    'backdrop blur is ' + blur + 'px: under 14 a line of text stays readable through it, over 24 it reads as frosted plastic');
  assert.match(GLASS, /-webkit-backdrop-filter:blur\(\d+px\) saturate\(\d+%\)/, 'Safari on the iPhone needs the prefixed form');
  assert.equal(px(/-webkit-backdrop-filter:blur\((\d+)px\)/, GLASS), blur, 'the two forms disagree');
  /* "Do not make the navigation fully opaque" -- and dark enough that white
     labels always sit on something darker than themselves. */
  const tint = alphaOf(GLASS);
  assert.ok(tint >= 0.15 && tint <= 0.45, 'the dark tint is ' + tint + ': the pane is either clear or a slab');
});

test('it reads as glass: a faint sheen, one line of light along the top, and depth below', () => {
  assert.match(GLASS, /linear-gradient\(180deg, rgba\(255,255,255,\.0\d+\), rgba\(255,255,255,0\) \d+%\)/,
    'the sheen is gone, or strong enough to read as metal again');
  assert.match(GLASS, /inset 0 1px 0 rgba\(255,255,255,\.1\d\)/, 'the top edge no longer catches the light');
  assert.match(GLASS, /0 10px 28px rgba\(0,0,0,\.\d+\)/, 'the pane lost its depth');
  /* The founder's "less of that metallic appearance": nothing bright. */
  (GLASS.match(/rgba\(255,255,255,([\d.]+)\)/g) || []).forEach(c => {
    const a = +/,([\d.]+)\)$/.exec(c)[1];
    assert.ok(a <= 0.2, c + ' is bright enough to read as metal');
  });
});

test('the nav inside the pane draws nothing of its own, and the tabs keep their light', () => {
  const nav = block(/\n  \.bottom-nav\{([\s\S]*?)\n  \}/, 'the nav');
  assert.match(nav, /background:transparent/);
  assert.doesNotMatch(nav, /safe-area-inset-bottom/, 'the inset is the pane’s now; inside the nav it doubles the height');
  /* "Keep the selected tab's cherry highlighting" and crisp, readable labels:
     the tabs are exactly as they were. No lens behind the chosen one. */
  const act = block(/\.bn-item\.active\{([\s\S]*?)\n  \}/, 'the chosen tab');
  assert.match(act, /color:var\(--cherry-text\)/);
  assert.ok(!/background:(?!none)/.test(act), 'a slab is behind the chosen tab');
  const rest = block(/\n  \.bn-item\{([\s\S]*?)\n  \}/, 'a tab');
  assert.match(rest, /color:#FFFFFF/);
  assert.match(rest, /text-shadow:[^;]*rgba\(255,255,255/, 'the labels lost the light that keeps them crisp over the glass');
  /* Nothing on the pane can blur or fade the labels themselves. */
  assert.doesNotMatch(GLASS, /(?:^|[^-])filter:|opacity:/, 'the pane filters or fades its own contents');
});

test('where glass cannot be drawn, the pane is near solid rather than clear', () => {
  const sup = block(/@supports not \(\(-webkit-backdrop-filter:blur\(1px\)\) or \(backdrop-filter:blur\(1px\)\)\)\{([\s\S]*?)\n  \}/, 'the no-blur fallback');
  assert.ok(alphaOf(sup) >= 0.9, 'a browser without blur shows readable text under the labels');
  const rt = block(/@media \(prefers-reduced-transparency: reduce\)\{([\s\S]*?)\n  \}/, 'the reduced-transparency fallback');
  assert.ok(alphaOf(rt) >= 0.9, 'reduce-transparency still shows the page through the bar');
  assert.match(rt, /backdrop-filter:none/, 'reduce-transparency still pays for the blur');
});

test('every screen ends clear of the floating bar', () => {
  /* Bar: 10px above the inset, 58px tall. The page has always kept about 55px
     of breathing room above it, so the last card is never under the glass. */
  const pad = px(/\.app-root\{min-height:100vh;\s*padding-bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom, 0px\)\);\}/, CSS);
  assert.ok(pad >= 10 + 58 + 50, 'the last card ends under the bar (' + pad + 'px of clearance)');
});

test('it costs one blurred layer and nothing that animates', () => {
  assert.equal((SRC.match(/<style/g) || []).length, 1);
  assert.doesNotMatch(GLASS, /transition|animation|will-change/, 'the pane animates, which makes the blur recompute every frame');
});

// ---------------------------------------------------------------------------
// THE SAME GLASS, BEYOND THE TAB BAR
// ---------------------------------------------------------------------------
/* Founder, with the tab bar on his phone: "O I like it", then the places to
   carry it -- "Liquid Glass X buttons on full-page screens. Liquid Glass
   current-week highlight in Full Plan. Possibly the Hear Today / Ask Coach
   buttons" -- and the Save foot and the pop-up notice. On the photos: "To
   the X save full plan week selection. Hear today ... I'm happy with". */
const RAW = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const tokens = block(/\n  :root\{(\s*--glass-tint:[\s\S]*?)\n  \}/, 'the glass tokens');
const tok = name => { const m = new RegExp('--' + name + ':([^;]+);').exec(tokens); assert.ok(m, '--' + name + ' is gone'); return m[1].trim(); };
const PANES = {
  'the X on a full page':   /\n  \.modal-card:is\(\.hq-full, \.es-full\) \.modal-head \.icon-btn\{([\s\S]*?)\n  \}/,
  'this week in Full Plan': /\n  \.view-plan \.pp-body \.week\.is-now\{([^}]*)\}/,
  'Hear Today / Ask Coach': /\n  \.voice-btn,\n  :is\([^)]*\) \.voice-row \.voice-btn\{([\s\S]*?)\n  \}/,
  'the Save foot':          /\n  \.page-foot,\n  \.modal-card\.es-full \.es-actions\{([\s\S]*?)\n  \}/,
  'the pop-up notice':      /\n  \.toast\{(\s*background:var\(--glass[\s\S]*?)\n  \}/,
};

test('one material: the tokens are the tab bar’s own numbers', () => {
  assert.equal(tok('glass-tint'), 'rgba(8,8,11,.26)');
  assert.equal(alphaOf('x:' + tok('glass-tint') + ';'), alphaOf(GLASS), 'the controls and the tab bar are tinted differently');
  assert.equal(tok('glass-blur'), 'blur(18px) saturate(150%)');
  assert.ok(GLASS.includes('blur(18px) saturate(150%)'), 'the tab bar and the controls blur differently');
  assert.match(tok('glass-sheen'), /^linear-gradient\(180deg, rgba\(255,255,255,\.045\), rgba\(255,255,255,0\) 55%\)$/);
});

test('each of the five is glass, and keeps the colour it already spoke in', () => {
  Object.entries(PANES).forEach(([what, re]) => {
    const r = block(re, what);
    assert.match(r, /background:var\(--glass-sheen\), var\(--glass-tint\);/, what + ' is not glass');
    assert.match(r, /-webkit-backdrop-filter:var\(--glass-blur\); backdrop-filter:var\(--glass-blur\);/, what + ' does not blur (or not on the iPhone)');
    assert.doesNotMatch(r, /opacity:|(?:^|[^-])filter:/, what + ' fades or filters its own contents');
  });
  /* The cherry stays where it was: the chosen week's glow, the coach buttons'
     glow, the notice's glow. Only the ground under them turned to glass. */
  assert.match(block(PANES['this week in Full Plan'], 'week'), /0 0 26px 2px color-mix\(in srgb, var\(--cherry\) 26%, transparent\)/);
  assert.match(block(PANES['Hear Today / Ask Coach'], 'coach'), /0 0 16px var\(--cherry-dim\)/);
  assert.match(block(PANES['the pop-up notice'], 'notice'), /0 0 16px var\(--cherry-dim\)/);
  /* The X is the full page's own X, not every modal's. */
  assert.doesNotMatch(CSS, /\n  \.icon-btn\{[^}]*--glass/, 'every close button in the product turned to glass');
});

test('where glass cannot be drawn, every pane is near solid', () => {
  assert.ok(alphaOf('x:' + tok('glass-solid') + ';') >= 0.9);
  assert.match(CSS, /@supports not \(\(-webkit-backdrop-filter:blur\(1px\)\) or \(backdrop-filter:blur\(1px\)\)\)\{\s*:root\{ --glass-tint:var\(--glass-solid\); \}/);
  assert.match(CSS, /@media \(prefers-reduced-transparency: reduce\)\{\s*:root\{ --glass-tint:var\(--glass-solid\); --glass-blur:none; \}/);
});

test('no stray brace swallows the glass', () => {
  /* Two stray closing braces once sat at the end of the stylesheet. Nothing
     followed them, so they did nothing -- until the glass tokens were added
     after them, and the browser dropped the :root rule whole: every pane
     resolved to nothing. From the tab bar to the end, braces must balance. */
  const css = RAW.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  const from = css.indexOf('left:12px; right:12px; bottom:calc(10px');
  assert.ok(from > -1);
  let d = 0, open = css.lastIndexOf('{', from);
  for (let i = open; i < css.length; i++){
    if (css[i] === '{') d++;
    else if (css[i] === '}'){ d--; assert.ok(d >= 0, 'a stray } at offset ' + i + ' drops the rule after it: ' + css.slice(i, i + 60).replace(/\s+/g, ' ')); }
  }
});
