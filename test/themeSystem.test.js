'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// VELVET VIKING IS DARK. There is one visual experience and no way to leave it.
//
// Light was retired, not merely defaulted away from. That distinction is the
// whole design: the light ramp was an OVERRIDE sitting on top of a complete
// dark :root, so deleting it leaves a stored preference of 'light' with
// nothing to resolve to. No athlete's record has to be rewritten for the app
// to be dark, which is what makes this reversible and what keeps it out of
// cloud-sync authority entirely.
//
// Two properties carry it, and these tests exist to stop either eroding:
//
//   1. EVERY SURFACE ARRIVES DARK WITH NO SCRIPT. The theme is an attribute in
//      the markup and a meta in the head, so there is nothing to run before
//      the first paint and nothing to flash. The boot snippet that used to do
//      this job is gone, along with the file that documented it.
//
//   2. A STORED PREFERENCE IS RESOLVED, NEVER REWRITTEN. The value is forced
//      in memory at load and deliberately not saved. A migration that wrote
//      would dirty state on first launch, push, and bump updated_at on every
//      athlete's row -- offering a two-device athlete a reconcile prompt over
//      a colour.
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['protected/velvet-viking-valhalla.html', 'start.html', 'account.html',
               'get.html', 'privacy.html', 'terms.html'];
const RUNTIME = read('protected/velvet-viking-valhalla.html');

/* Comments are allowed to discuss the things that are absent -- explaining why
   prefers-color-scheme is not consulted is worth more than the characters
   saved by deleting the sentence. The rules below are about CODE, so prose is
   stripped before they are applied rather than reworded to dodge a regex. */
const stripComments = s => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// ONE THEME, DECLARED IN THE MARKUP
// ---------------------------------------------------------------------------
test('every surface arrives dark before a single script runs', () => {
  PAGES.forEach(p => {
    const s = read(p);
    assert.match(s, /<html lang="en" data-theme="dark">/,
      p + ' does not declare its theme in the markup, so it can arrive wrong');
    assert.match(s, /<meta name="theme-color" content="#151417">/,
      p + ' still paints the Android status bar and browser chrome cream');
  });
});

test('nothing is left that resolves a theme at runtime', () => {
  PAGES.forEach(p => {
    assert.ok(!/data-vvv-theme-boot/.test(read(p)),
      p + ' still carries a theme boot snippet for a theme that cannot vary');
  });
  assert.ok(!fs.existsSync(path.join(ROOT, 'assets/vvv-theme-boot.txt')),
    'the canonical boot snippet outlived the mechanism it documented');
});

test('a dark OS does not make the product dark -- the product is simply dark', () => {
  PAGES.concat(['assets/vvv-shell.css']).forEach(p => {
    assert.ok(!/prefers-color-scheme/.test(stripComments(read(p))),
      p + ' decides its theme from the device rather than from the product');
  });
});

test('no light override survives anywhere a page can reach', () => {
  PAGES.concat(['assets/vvv-shell.css']).forEach(p => {
    assert.ok(!/\[data-theme="light"\]/.test(stripComments(read(p))),
      p + ' still ships a light ramp, which would win the moment anything ' +
      'wrote data-theme="light" back onto <html>');
  });
});

test('there is no control anywhere that offers a theme', () => {
  const js = stripComments(RUNTIME);
  ['renderThemeToggleRow', 'patchThemeToggle', 'handleSetTheme',
   'handleToggleThemeQuick', 'toggle-theme'].forEach(gone =>
    assert.ok(js.indexOf(gone) === -1,
      gone + ' is still reachable -- a switch for a setting that no longer exists'));
});

test('the document is pinned dark for a state loaded mid-session', () => {
  const fn = /function applyThemeToDocument\(\)\{([\s\S]*?)\n\}/.exec(RUNTIME)[1];
  assert.match(fn, /setAttribute\('data-theme', 'dark'\)/,
    'the attribute must be re-asserted, not read back from state');
  assert.match(fn, /'#151417'/, 'and the status bar with it');
  assert.ok(!/state\.theme/.test(fn), 'nothing here may consult a stored theme any more');
});

// ---------------------------------------------------------------------------
// A STORED PREFERENCE IS RESOLVED, NOT REWRITTEN
// ---------------------------------------------------------------------------
test('a brand-new athlete gets dark', () => {
  const a = loadApp();
  assert.equal(a.makeDefaultState().theme, 'dark');
  assert.equal(a.state.theme, 'dark');
});

test('an athlete who had chosen light opens the app dark', () => {
  const a = loadApp();
  a.localStorage.setItem('velvet-viking-generator-v2', JSON.stringify({
    theme: 'light', themeExplicit: true, units: 'mi', view: 'today',
    setup: { distanceKey: '10k' }, days: [{ id: 'd1', date: '2026-03-02' }] }));
  a.loadState();
  assert.equal(a.state.theme, 'dark', 'there is no light ramp left to honour');
  assert.equal(a.state.units, 'mi', 'and nothing unrelated was migrated with it');
  assert.equal(a.state.days.length, 1, 'nor was the plan disturbed');
});

test('resolving the theme does not rewrite the stored row', () => {
  /* The point of resolve-at-read. If this starts failing, every athlete's row
     is being re-uploaded on first launch for the sake of a colour. */
  const a = loadApp();
  a.localStorage.setItem('velvet-viking-generator-v2', JSON.stringify({
    theme: 'light', themeExplicit: true, units: 'km', view: 'today',
    setup: { distanceKey: '10k' }, days: [{ id: 'd1', date: '2026-03-02' }] }));
  a.loadState();
  const stored = JSON.parse(a.localStorage.getItem('velvet-viking-generator-v2'));
  assert.equal(stored.theme, 'light',
    'the migration wrote to storage -- it must resolve in memory and ride the next ordinary save');
});

test('the migration itself saves nothing', () => {
  const fn = /function migrateThemePreference\(st\)\{([\s\S]*?)\n\}/.exec(RUNTIME)[1];
  ['scheduleSave', 'persistState', 'cloudPush', 'setItem'].forEach(w =>
    assert.ok(fn.indexOf(w) === -1, 'migrateThemePreference calls ' + w));
});

test('a nonsense stored theme is dark like everything else', () => {
  const a = loadApp();
  a.localStorage.setItem('velvet-viking-generator-v2', JSON.stringify({
    theme: 'midnight', view: 'today',
    setup: { distanceKey: '10k' }, days: [{ id: 'd1', date: '2026-03-02' }] }));
  a.loadState();
  assert.equal(a.state.theme, 'dark');
});

test('a plan downloaded from the account cannot bring light back', () => {
  const a = loadApp();
  const remote = JSON.parse(JSON.stringify(a.makeDefaultState()));
  remote.theme = 'light'; remote.themeExplicit = true;
  remote.setup = { distanceKey: '10k' }; remote.days = [{ id: 'd1', date: '2026-03-02' }];
  a.adoptCloudState(remote, false);
  assert.equal(a.state.theme, 'dark', 'a legacy row is not a vote on the product');
  assert.ok(a.state.setup, 'and the plan still arrived');
  assert.equal(a.state.days.length, 1);
});

// ---------------------------------------------------------------------------
// THE MIRROR
//
// Its reader is gone: nothing resolves a theme before paint any more. The key
// is kept because the stored record and adoptCloudState() still carry the
// field, and a mirror that disagrees with them is worse than one that does not
// exist. What it must never become is a second place to put data.
// ---------------------------------------------------------------------------
test('the mirror carries no training data, no identity and no credential', () => {
  const a = loadApp();
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  a.cloudSession = { access_token: 'AT-SECRET', user_id: 'uid-1', email: 'x@y.z' };
  a.syncThemeMirror();
  const raw = a.localStorage.getItem('vvv_theme');
  assert.ok(raw.length < 60, 'it must stay tiny: ' + raw);
  [/AT-SECRET/, /uid-1/, /x@y\.z/, /days/, /setup/].forEach(rx =>
    assert.ok(!rx.test(raw), 'the mirror must not carry ' + rx));
});

// ---------------------------------------------------------------------------
// THE SWITCH COMPONENT
//
// Two controls that do the same KIND of thing must not be two colours. Gold is
// the brand (headings, the selected tab, the crest); Cherry Lacquer is the
// interactive-control treatment, so a switch takes Cherry Lacquer. These guard
// the COMPONENT, not a screen -- re-introducing a gold ON state or a one-off
// scoped exception is what would undo it.
// ---------------------------------------------------------------------------
test('every binary switch shares one ON colour, and it is the interactive accent', () => {
  const on = RUNTIME.match(/\.switch input:checked \+ \.switch-track\{background:var\(--(\w+)\);\}/);
  assert.ok(on, 'the shared ON rule still exists');
  assert.equal(on[1], 'cherry', 'ON is the control colour, not the brand gold');
  assert.ok(!/switch input:checked \+ \.switch-track\{background:var\(--bronze\)/.test(RUNTIME),
    'no switch anywhere turns gold when it is on');
});

test('no switch carries a per-instance ON colour', () => {
  const overrides = RUNTIME.match(/^\s*[#.][\w-]+[^{\n]*\.switch input:checked[^\n]*background[^\n]*$/gm) || [];
  assert.deepEqual(overrides, [], 'found a scoped switch colour override: ' + overrides.join(' | '));
});

test('the switch OFF state and the focus ring are untouched by the ON colour', () => {
  assert.match(RUNTIME, /\.switch-track\{position:absolute; inset:0; background:var\(--line\)/,
    'OFF is still the neutral line colour');
  assert.match(RUNTIME, /\.switch-track\{[^}]*box-shadow:inset 0 0 0 1px var\(--ctl-border\)/,
    'and still keeps the inset ring that gives it an edge');
  assert.match(RUNTIME, /:focus-visible\{outline:2px solid var\(--gold\)/,
    'the global gold focus outline is unchanged');
});

test('the accent is declared once, at the root, so no rule needs a scope', () => {
  const defs = RUNTIME.match(/--cherry:\s*#[0-9a-f]{6}/gi) || [];
  assert.equal(defs.length, 1,
    'the accent was a per-theme token and is now a single value: ' + defs.join(', '));
  assert.equal((RUNTIME.match(/\.switch input:checked \+ \.switch-track\{background/g) || []).length, 1,
    'and exactly one rule paints the ON state');
});

test('retiring light moved no gold in the product', () => {
  for (const kept of [
    /:focus-visible\{outline:2px solid var\(--gold\)/,          // focus rings
    /\.callout svg\{[^}]*color:var\(--bronze\)/,                // callout icons
    /--bronze:#C0923F/,                                          // the token itself
  ]) assert.match(RUNTIME, kept, 'gold must remain: ' + kept);
});

// ---------------------------------------------------------------------------
// THE SURFACE RAMP SURVIVED THE DELETION
//
// The light block was removed, not unwound: the dark ramp the containers were
// designed against has to still be there, and the fills that carry STATE have
// to still be reading the raw ramp rather than a surface token.
// ---------------------------------------------------------------------------
test('the containers still take the ramp they were designed with', () => {
  const at = RUNTIME.indexOf(':root{');
  const block = RUNTIME.slice(at, RUNTIME.indexOf('\n  }', at));
  ['--surface-2', '--surface-3', '--surface-4'].forEach(t => {
    const n = t.slice(-1);
    const m = block.match(new RegExp(t + ':\\s*([^;]+);'));
    assert.ok(m, 'no ' + t + ' is declared');
    assert.equal(m[1].trim(), 'var(--bg-' + n + ')', t + ' is ' + m[1].trim());
  });
});

test('fills that carry state or semantics were not flattened', () => {
  /* A hover, a meter track, an input, the switch thumb, a selected option.
     If any starts taking a --surface token it stops being distinguishable
     from the container it sits in, and that deletes information. */
  const STATEFUL = [
    ['.day:hover', '--bg-4'],
    ['.week-head:hover', '--bg-3'],
    ['.zbar', '--bg-4'],
    ['.outlook-track', '--bg-3'],
    ['.switch-track::before', '--bg-2'],
    ['.plan-summary-bar:hover', '--bg-3'],
  ];
  STATEFUL.forEach(([sel, tok]) => {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\{[^}]*background(?:-color)?:\\s*(?:[^;]*,\\s*)?var\\(' + tok + '\\)');
    assert.match(RUNTIME, re,
      sel + ' no longer paints with ' + tok + ' -- a state fill was flattened');
  });
  /* .ev-card EXPRESSES THE SAME STATE IN A DIFFERENT PROPERTY, and the law
     is about the state surviving rather than about which property carries
     it. The card's background is now the gradient RIM -- the border is
     painted into the border box and the face into the padding box, which is
     how a gradient border is drawn at all -- so a hover fill would have to
     overwrite the rim to exist. The feedback moved to illumination, which is
     the language the circles and the bottom nav already press in. What must
     not happen is the state vanishing, so that is what is asserted. */
  ['hover', 'active'].forEach(state => {
    const re = new RegExp('\\.ev-card:' + state + '\\{[^}]*box-shadow:[^}]*var\\(--gold\\)');
    assert.match(RUNTIME, re,
      '.ev-card:' + state + ' gives no feedback at all -- the state was deleted, not moved');
  });
  assert.match(RUNTIME, /\.ev-card\{[^}]*var\(--t-rim-grad\) border-box/,
    '.ev-card no longer carries the rim its hover fill was given up for');

  /* .goal-opt MADE THE SAME MOVE, for the same reason and into the same
     language. It was a raised tile whose selected state was a gold border
     and a gold tint; it is now the bottom nav's law -- no box, the letter
     crisp white at rest and lit gold when chosen -- plus the coaching
     rail's radial pool behind it. So it is out of the fill list above, and
     what must not happen is the SELECTION vanishing with the fill. Three
     things carry it now, and all three are asserted, because any one of
     them surviving alone would still read as a bug. */
  /* ---- CHANGED SIDES: IT IS THE BUILDER'S TILE, AND THE GLOW IS GONE ----
     The four assertions here held the boxless letter and its gold pool and
     four-layer glow. Founder, with the Goal panel beside a builder page:
     "The selection of A B or C should be the same as build a plan! Not the
     old gold hazey glow haha". What this block exists to protect has not
     changed -- the SELECTION must not vanish -- so it asks for the thing
     that carries it now: the builder's own grid, and its own chosen state. */
  const CSSONLY = RUNTIME.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.goal-opt(\.active)?(::before| \.t)?\{[^}]*(245,208,97|227,177,90|--gold)/.test(CSSONLY),
    'the goal selector has a gold light of its own again');
  assert.equal(CSSONLY.indexOf('.goal-opt.active'), -1,
    'the goal selector has a chosen style of its own instead of the builder\'s');
  assert.match(RUNTIME, /'<div class="goal-options opt-grid cols-3"/,
    'the goal selector is not drawn with the builder\'s option grid');
  assert.match(CSSONLY, /\.opt-grid button\.active\{[^}]*border-color:var\(--cherry\)/,
    'the builder\'s chosen tile lost its cherry line, so the goal has no selection either');
});
