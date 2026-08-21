'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Velvet Viking's product default is LIGHT. That is a brand decision, not a
// rendering one, which is why the operating system does not get a vote: a dark
// phone is a fact about the phone, not a request about this product.
//
// The rule that makes it safe is precedence. An athlete who chose dark chose
// dark -- across a refresh, an app restart, a sign-in, a sign-out, and a plan
// downloaded from their own account on another device. That last one was a
// real defect: adoptCloudState(remote, false) replaced the whole state object,
// so signing in on a fresh phone silently overwrote the theme the athlete had
// just set with whatever was stored in the plan row.
//
// Migration is the other half. `theme:'dark'` in existing storage is genuinely
// ambiguous -- it is either a choice or the old default, and nothing recorded
// which. Guessing would reset real choices, so nobody's stored theme moves;
// only new states start light.
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SHELL_PAGES = ['protected/velvet-viking-valhalla.html', 'account.html',
                     'get.html', 'privacy.html', 'terms.html'];

// ---------------------------------------------------------------------------
// THE DEFAULT
// ---------------------------------------------------------------------------
test('a brand-new athlete gets light', () => {
  const a = loadApp();
  assert.equal(a.makeDefaultState().theme, 'light');
  assert.equal(a.makeDefaultState().themeExplicit, false,
    'the default is not a choice, and must never be mistaken for one');
  assert.equal(a.state.theme, 'light');
});

/* Comments are allowed to discuss prefers-color-scheme -- explaining why it is
   absent is worth more than the two characters saved by deleting the sentence.
   The rule is about CODE, so the prose is stripped before the rule is applied
   rather than the prose being reworded to dodge a regex. */
const stripComments = s => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

test('a dark OS does not make the product dark', () => {
  SHELL_PAGES.forEach(p => {
    assert.ok(!/prefers-color-scheme/.test(stripComments(read(p))),
      p + ' decides its theme from the device rather than from the athlete');
  });
});

test('the boot snippet resolves everything that is not explicitly dark to light', () => {
  const snippet = /<script data-vvv-theme-boot>([\s\S]*?)<\/script>/.exec(read(SHELL_PAGES[0]))[1];
  const run = stored => {
    const html = { attr: null };
    const fn = new Function('localStorage', 'document', snippet);
    fn({ getItem: () => stored },
       { documentElement: { setAttribute: (k, v) => { html.attr = v; } } });
    return html.attr;
  };
  assert.equal(run(JSON.stringify({ theme: 'dark' })), 'dark');
  assert.equal(run(JSON.stringify({ theme: 'light' })), 'light');
  assert.equal(run(null), 'light', 'no preference is light');
  assert.equal(run('not json at all'), 'light', 'corrupt storage is light, not a crash');
  assert.equal(run(JSON.stringify({})), 'light');
});

test('every surface carries the identical boot snippet', () => {
  const canonical = /<script data-vvv-theme-boot>[\s\S]*?<\/script>/
    .exec(read('assets/vvv-theme-boot.txt'))[0];
  SHELL_PAGES.forEach(p => {
    const found = /<script data-vvv-theme-boot>[\s\S]*?<\/script>/.exec(read(p));
    assert.ok(found, p + ' has no theme boot — it will flash the wrong theme');
    assert.equal(found[0], canonical,
      p + ' has drifted from the canonical snippet, which is exactly how the ' +
      'pasted palette copies drifted before');
  });
});

test('the boot runs before any stylesheet, or it has not done its job', () => {
  SHELL_PAGES.forEach(p => {
    const s = read(p);
    assert.ok(s.indexOf('data-vvv-theme-boot') < s.indexOf('<style'),
      p + ': the theme must be settled before the page can paint the wrong one');
  });
});

// ---------------------------------------------------------------------------
// AN EXPLICIT CHOICE OUTRANKS EVERYTHING
// ---------------------------------------------------------------------------
test('choosing a theme records that it was chosen', () => {
  const a = loadApp();
  a.handleSetTheme('dark');
  assert.equal(a.state.theme, 'dark');
  assert.equal(a.state.themeExplicit, true);
});

/* A restart carries the whole of this device's storage across, not one key --
   copying only the plan blob would be testing a device that lost half its
   disk, which is a different (and imaginary) scenario. */
function restart(a, keys) {
  const carried = (keys || ['velvet-viking-generator-v2', 'vvv_theme'])
    .map(k => [k, a.localStorage.getItem(k)]);
  const b = loadApp();
  carried.forEach(([k, v]) => { if (v != null) b.localStorage.setItem(k, v); });
  b.loadState();
  return b;
}

test('an explicit choice survives a restart', () => {
  const a = loadApp();
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  a.handleSetTheme('dark');
  a.persistStateLocalOnly();
  const b = restart(a);
  assert.equal(b.state.theme, 'dark', 'a restart is not a reason to change the theme');
  assert.equal(b.state.themeExplicit, true);
});

test('an athlete who chooses dark BEFORE building anything keeps it', () => {
  // loadState() rejects a stored blob without setup AND days -- rightly, since
  // a half-written plan is worse than none. The theme is not part of the plan
  // and must not go down with it, so it is read back from the mirror.
  const a = loadApp();
  a.handleSetTheme('dark');
  a.persistStateLocalOnly();
  const b = restart(a);
  assert.equal(b.state.theme, 'dark',
    'the newest athletes are exactly the ones whose choice was being dropped');
  assert.equal(b.state.themeExplicit, true);
  assert.equal(b.planHasContent(), false, 'and no plan was invented to carry it');
});

test('a mirrored default is not mistaken for a choice', () => {
  const a = loadApp();
  a.localStorage.setItem('vvv_theme', JSON.stringify({ theme: 'dark', explicit: false }));
  a.loadState();
  assert.equal(a.state.theme, 'light',
    'only an explicit choice may outrank the product default');
  assert.equal(a.state.themeExplicit, false);
});

test('an explicit LIGHT choice is a choice too, not a fallback', () => {
  const a = loadApp();
  a.handleSetTheme('dark');
  a.handleSetTheme('light');
  assert.equal(a.state.themeExplicit, true,
    'going back to light must not read as "never chose", or dark could return on its own');
});

test('signing in and out never touches the theme', async () => {
  const a = loadApp();
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  a.handleSetTheme('dark');
  a.cloudSession = { access_token: 't', refresh_token: 'r', user_id: 'u1',
                     email: 'a@b.c', expires_at: Date.now() + 3600e3 };
  a.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
  a.cloudSignOut();
  await new Promise(r => setTimeout(r, 0));
  assert.equal(a.state.theme, 'dark', 'signing out is not a theme preference');
  assert.equal(a.state.themeExplicit, true);
});

test('a plan downloaded from the account cannot overwrite a chosen theme', () => {
  // The defect: a fresh phone, the athlete sets dark, then signs in. The
  // account row carries theme:'light' from another device and used to win.
  const a = loadApp();
  a.handleSetTheme('dark');
  const remote = JSON.parse(JSON.stringify(a.makeDefaultState()));
  remote.theme = 'light'; remote.themeExplicit = true;
  remote.setup = { distanceKey: '10k' }; remote.days = [{ id: 'd1', date: '2026-03-02' }];

  a.adoptCloudState(remote, false);        // false = "a brand-new device"
  assert.equal(a.state.theme, 'dark', 'the athlete chose this ten seconds ago');
  assert.equal(a.state.themeExplicit, true);
  assert.ok(a.state.setup, 'and the plan still arrived');
  assert.equal(a.state.days.length, 1);
});

test('a device that never chose still takes the account’s theme', () => {
  const a = loadApp();
  assert.equal(a.state.themeExplicit, false);
  const remote = JSON.parse(JSON.stringify(a.makeDefaultState()));
  remote.theme = 'dark'; remote.themeExplicit = true;
  remote.setup = { distanceKey: '10k' }; remote.days = [{ id: 'd1', date: '2026-03-02' }];
  a.adoptCloudState(remote, false);
  assert.equal(a.state.theme, 'dark',
    'with nothing to protect, the account is the better guess than the default');
});

test('a background sync never changes the theme under the athlete', () => {
  const a = loadApp();
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  a.handleSetTheme('light');
  const remote = JSON.parse(JSON.stringify(a.state));
  remote.theme = 'dark';
  a.adoptCloudState(remote, true);         // true = this device already has a plan
  assert.equal(a.state.theme, 'light');
});

// ---------------------------------------------------------------------------
// MIGRATION: NOBODY'S STORED THEME MOVES
// ---------------------------------------------------------------------------
test('an existing dark athlete stays dark', () => {
  const a = loadApp();
  const legacy = { theme: 'dark', units: 'km', view: 'today',
                   setup: { distanceKey: '10k' }, days: [{ id: 'd1', date: '2026-03-02' }] };
  a.localStorage.setItem('velvet-viking-generator-v2', JSON.stringify(legacy));
  a.loadState();
  assert.equal(a.state.theme, 'dark',
    'stored dark is either a choice or the old default and nothing recorded which — ' +
    'flipping it would reset real choices, so it is treated as a choice');
  assert.equal(a.state.themeExplicit, true);
});

test('an existing light athlete stays light', () => {
  const a = loadApp();
  a.localStorage.setItem('velvet-viking-generator-v2', JSON.stringify({
    theme: 'light', units: 'mi', view: 'today',
    setup: { distanceKey: '10k' }, days: [{ id: 'd1', date: '2026-03-02' }] }));
  a.loadState();
  assert.equal(a.state.theme, 'light');
  assert.equal(a.state.units, 'mi', 'and nothing unrelated was migrated');
});

test('a nonsense stored theme resolves to the product default', () => {
  const a = loadApp();
  a.localStorage.setItem('velvet-viking-generator-v2', JSON.stringify({
    theme: 'midnight', view: 'today',
    setup: { distanceKey: '10k' }, days: [{ id: 'd1', date: '2026-03-02' }] }));
  a.loadState();
  assert.equal(a.state.theme, 'light');
  assert.equal(a.state.themeExplicit, false, 'and it is not dignified as a choice');
});

// ---------------------------------------------------------------------------
// THE MIRROR THE OTHER SURFACES READ
// ---------------------------------------------------------------------------
test('the mirror key follows the theme and holds nothing else', () => {
  const a = loadApp();
  a.handleSetTheme('dark');
  const m = JSON.parse(a.localStorage.getItem('vvv_theme'));
  assert.deepEqual(Object.keys(m).sort(), ['explicit', 'theme']);
  assert.equal(m.theme, 'dark');
  assert.equal(m.explicit, true);
  a.handleSetTheme('light');
  assert.equal(JSON.parse(a.localStorage.getItem('vvv_theme')).theme, 'light');
});

test('the mirror carries no training data, no identity and no credential', () => {
  const a = loadApp();
  buildPlan(a, { weeks: 12, startDate: a.addDays(a.todayStr(), -21) });
  a.cloudSession = { access_token: 'AT-SECRET', user_id: 'uid-1', email: 'x@y.z' };
  a.handleSetTheme('dark');
  const raw = a.localStorage.getItem('vvv_theme');
  assert.ok(raw.length < 60, 'it is read before first paint and must stay tiny: ' + raw);
  [/AT-SECRET/, /uid-1/, /x@y\.z/, /days/, /setup/].forEach(rx =>
    assert.ok(!rx.test(raw), 'the mirror must not carry ' + rx));
});

// ---------------------------------------------------------------------------
// THE SWITCH COMPONENT
//
// Two controls that do the same KIND of thing must not be two colours. Settings
// used to show the App Theme switch in violet and every other switch in gold,
// which read as a distinction and was not one -- gold is the brand (headings,
// the selected tab, the primary action, the crest) and violet is already the
// interactive-control treatment, so a switch takes violet.
//
// These tests guard the COMPONENT, not a screen: the fix was to the shared rule
// and the deletion of a per-row override, and re-introducing either a gold ON
// state or a one-off exception is what would undo it.
// ---------------------------------------------------------------------------
test('every binary switch shares one ON colour, and it is the control violet', () => {
  const css = read('protected/velvet-viking-valhalla.html');
  const on = css.match(/\.switch input:checked \+ \.switch-track\{background:var\(--(\w+)\);\}/);
  assert.ok(on, 'the shared ON rule still exists');
  assert.equal(on[1], 'violet', 'ON is the control colour, not the brand gold');
  assert.ok(!/switch input:checked \+ \.switch-track\{background:var\(--bronze\)/.test(css),
    'no switch anywhere turns gold when it is on');
});

test('no switch carries a per-instance ON colour', () => {
  const css = read('protected/velvet-viking-valhalla.html');
  /* A scoped override is how the App Theme switch and the rest drifted apart.
     One shared rule means the next toggle added to the product is the right
     colour without anybody remembering to make it so. */
  const overrides = css.match(/^\s*[#.][\w-]+[^{\n]*\.switch input:checked[^\n]*background[^\n]*$/gm) || [];
  assert.deepEqual(overrides, [], 'found a scoped switch colour override: ' + overrides.join(' | '));
});

test('the switch OFF state and the focus ring are untouched by the ON colour', () => {
  const css = read('protected/velvet-viking-valhalla.html');
  assert.match(css, /\.switch-track\{position:absolute; inset:0; background:var\(--line\)/,
    'OFF is still the neutral line colour');
  assert.match(css, /\.switch-track\{[^}]*box-shadow:inset 0 0 0 1px var\(--ctl-border\)/,
    'and still keeps the inset ring that gives it an edge on cream');
  /* Focus is the app-wide treatment, deliberately NOT re-specified per control:
     changing what "on" looks like must not change what "focused" looks like. */
  assert.match(css, /:focus-visible\{outline:2px solid var\(--gold\)/,
    'the global gold focus outline is unchanged');
});

test('violet is defined in both themes, so the switch needs no per-theme rule', () => {
  const css = read('protected/velvet-viking-valhalla.html');
  const defs = css.match(/--violet:\s*#[0-9a-f]{6}/gi) || [];
  assert.ok(defs.length >= 2, 'violet is a per-theme token, not a single literal: ' + defs.join(', '));
  assert.equal((css.match(/\.switch input:checked \+ \.switch-track\{background/g) || []).length, 1,
    'and exactly one rule paints the ON state');
});

test('the toggle fix moved no other gold in the product', () => {
  /* The scope guard, stated as a test. Gold remains the brand treatment on
     everything it was already on; only the switch gave it up. */
  const css = read('protected/velvet-viking-valhalla.html');
  for (const kept of [
    /:focus-visible\{outline:2px solid var\(--gold\)/,          // focus rings
    /\.callout svg\{[^}]*color:var\(--bronze\)/,                // callout icons
    /--bronze:#C0923F/,                                          // the token itself
  ]) assert.match(css, kept, 'gold must remain: ' + kept);
});
