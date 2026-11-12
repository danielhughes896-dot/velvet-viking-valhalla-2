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
  /* ---- THE BAR CHANGED SIDES: IT IS GLASS NOW ----
     This required the bar to be the page's own ground (background:var(--bg)).
     Founder: "Can you do liquid glass like apple?", and after three mocks:
     "Increase the background blur and slightly adjust the dark glass opacity
     so underlying content becomes indistinct rather than readable ... Do not
     make the navigation fully opaque." The pane is .bn-stack, which floats;
     the nav inside it carries no surface of its own, so there is still one
     surface, not two, and still no rule along the top. The glass itself is
     pinned in test/glassTabBar. */
  const bar = /\.bottom-nav\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.match(bar, /background:transparent/, 'the nav drew a surface of its own under the glass');
  assert.match(bar, /border-top:0/, 'the rule along the top is back');

  const rest = /\n  \.bn-item\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.match(rest, /color:#FFFFFF/, 'a resting tab is no longer crisp white');
  assert.ok(!/opacity:\s*0?\.\d/.test(rest), 'a resting tab is dimmed rather than full strength');
  assert.match(rest, /text-shadow:[^;]*rgba\(255,255,255/, 'a resting tab lost its backlight');

  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE BAR ----
     It required --gold-bright. Founder, setting the hierarchy for the whole
     app: "Gold = brand/destination/milestone. Cherry =
     active/training/interaction", with "active bottom navigation tab ->
     cherry icon, text and glow" named in the list. The tab you are standing
     on is where you ARE, which is interaction; gold stays on the wordmark,
     the phase slides and the carousel dots, which are the brand and the
     destination.
     WHAT THIS TEST IS FOR IS UNCHANGED, and it is the paragraph above the
     test rather than the token: --cherry-text sits below white in luminance
     exactly as the gold it replaces did, so the chosen tab still cannot
     carry its state on colour alone. The three cues are still pinned --
     no slab, a heavier weight, and four light layers rather than the
     resting two. Only the hue they are mixed from moved. */
  const act = /\.bn-item\.active\{([\s\S]*?)\n  \}/.exec(APP)[1];
  assert.ok(!/background:(?!none)/.test(act), 'the slab is back on the selected tab');
  assert.match(act, /color:var\(--cherry-text\)/, 'the selected tab is not cherry');
  assert.match(act, /font-weight:700/, 'weight is one of the three cues and it has gone');
  const layers = (act.match(/rgba\((?:154,84,108|196,106,137)/g) || []).length;
  assert.ok(layers >= 4,
    'the selected tab carries ' + layers + ' cherry light layers; it needs to out-shout ' +
    'four bold white ones, and that is what illumination is for');
  assert.ok(!/--gold/.test(act),
    'gold is back on the selected tab -- gold is the brand and the destination now, ' +
    'not the tab you are standing on');
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

test('the shell carries the mark, and the mark is the name between two dots', () => {
  /* ---- CHANGED SIDES: THE CREST LEFT THESE PAGES ----
     This asserted the shell defined .vvv-crest and .vvv-tagline and that the
     account page served the crest's 540px encoding with EARN YOUR PLACE under
     it. Founder: "We don't need an emblem everywhere for the app. It's simply
     the name with the dots. That's it. Clean & sleek." -- and of these pages:
     "They should both change to the dot SACORO dot."
     The crest also could not be renamed: its lettering is artwork, and the
     artwork reads VALHALLA AWAITS. */
  ['.vvv-lockup', '.vvv-dot', '.vvv-wordmark', '.vvv-by'].forEach(c =>
    assert.ok(SHELL.includes(c), 'the shell needs ' + c));
  ['.vvv-crest', '.vvv-tagline'].forEach(c =>
    assert.ok(!new RegExp('\\' + c + '[\\s.{,]').test(SHELL.replace(/\/\*[\s\S]*?\*\//g, '')),
      'the shell still styles ' + c + ', which no page draws'));
  /* THE SELECTORS CARRY .vvv-brand, AND THE PAGE BREAKS WITHOUT IT. Two of the
     five pages set the lockup inside .vvv-shell, whose rule for every <p>
     (13.5px, 18px beneath) outranks a bare class by one element. Measured in
     Chromium with the bare class: the name rendered at 13.5px on /start and
     /account and 33px on /get, from identical markup. No test that reads the
     HTML could have seen that, so the specificity itself is the assertion. */
  assert.ok(SHELL.includes('.vvv-brand .vvv-wordmark{'),
    'the name lost the selector that lets it outrank .vvv-shell p; it renders at 13.5px on /start and /account');
  assert.ok(SHELL.includes('.vvv-brand .vvv-by{'),
    'the byline lost the selector that lets it outrank .vvv-shell p');
  assert.match(SHELL, /\.vvv-wordmark\{[^}]*font-family:'Cinzel',serif; font-weight:600/,
    'the pages set the name in something other than the mark\u2019s own face and weight');

  ['account.html', 'start.html', 'get.html', 'privacy.html', 'terms.html'].forEach(f => {
    const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.equal(html.indexOf('velvet-viking-crest'), -1, f + ' is serving the crest again');
    assert.match(html,
      /<div class="vvv-lockup"><span class="vvv-dot" aria-hidden="true"><\/span><(p|h1) class="vvv-wordmark">SACORO<\/\1><span class="vvv-dot" aria-hidden="true"><\/span><\/div>/,
      f + ' does not carry the name between two dots that a reader is not told about');
    assert.match(html, /<p class="vvv-by">By Velvet Viking<\/p>/,
      f + ' is where someone first meets the product, and the company is not signing it');
    /* The mark is weight 600 and these pages used to load 700 and 800 only,
       which silently substitutes a heavier cut. */
    assert.match(html, /family=Cinzel:wght@600;700;800/, f + ' does not load the weight the mark is set in');
  });
});

test('inputs are 16px or iOS zooms the page the moment you tap one', () => {
  assert.match(SHELL, /\.vvv-shell input[^{]*\{[\s\S]*?font-size:16px/);
});
