'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* CHERRY LACQUER — the Velvet Viking interactive accent.
 * ===========================================================================
 * #532D3A replaced the Valhalla violet across every place violet meant
 * VELVET VIKING / PRIMARY INTERACTION / SELECTED BRAND STATE. These tests hold
 * the three things that migration can quietly lose:
 *
 *   1. THE OLD ACCENT DOES NOT COME BACK. Not as a token, not as a hex, not on
 *      a customer-facing control.
 *   2. THE APP DID NOT FLATTEN INTO ONE COLOUR. Gold is still the identity;
 *      green/amber/red are still semantic; the workout-type hues are untouched.
 *      A migration that swallowed those would pass a naive "no violet" check.
 *   3. THE ACCENT IS ACCESSIBLE WHERE IT LANDS, measured rather than asserted:
 *      4.5:1 for a label, 3:1 for a control's boundary against its surface,
 *      in BOTH themes, computed here from the tokens the app actually ships.
 *
 * Everything is read out of the shipped stylesheet. Nothing is hard-coded that
 * the runtime does not also declare.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// ---------------------------------------------------------------- colour maths
const hex = h => h.replace('#', '').match(/../g).map(x => parseInt(x, 16));
const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => {
  const x = lum(hex(a)), y = lum(hex(b));
  return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100;
};
const hue = h => {
  const [r, g, b] = hex(h), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let x; if (!d) x = 0; else if (mx === r) x = ((g - b) / d) % 6;
  else if (mx === g) x = (b - r) / d + 2; else x = (r - g) / d + 4;
  return ((x * 60) + 360) % 360;
};
// HSL lightness, 0..1 -- how DARK a colour is, independent of its hue. This is
// the axis the "too pink" regression lives on: a mid-tone in this hue family is
// rose, a low tone is burgundy.
const light = h => { const c = hex(h); return (Math.max(...c) + Math.min(...c)) / 510; };
// The cherry/wine family: magenta-red. Below this is purple, above it is brick.
const IN_FAMILY = h => hue(h) >= 334 && hue(h) <= 356;

/* Token values are read from the shipped :root blocks, so these tests measure
   what the app renders rather than what this file remembers. The dark block is
   the first :root; the light block is the [data-theme="light"] override. */
function tokens(scope) {
  const start = scope === 'light'
    ? CODE.indexOf('--cherry:', CODE.indexOf('--danger-text:#9A3540'))
    : CODE.indexOf('--cherry:');
  assert.notEqual(start, -1, 'no --cherry block for ' + scope);
  const block = CODE.slice(start, start + 900);
  const out = {};
  [...block.matchAll(/(--cherry[a-z-]*)\s*:\s*([^;]+);/g)].forEach(m => { out[m[1]] = m[2].trim(); });
  return out;
}
function surfaces(scope) {
  // --bg / --bg-2 / --bg-3 for the theme, from the same stylesheet.
  const re = scope === 'light'
    ? /--bg:#F4F1EA; --bg-2:#([0-9A-F]{6}); --bg-3:#([0-9A-F]{6});/i
    : /--bg:#151417; --bg-2:#([0-9A-F]{6}); --bg-3:#([0-9A-F]{6});/i;
  const m = CODE.match(re);
  assert.ok(m, 'could not read the ' + scope + ' surfaces');
  return [scope === 'light' ? '#F4F1EA' : '#151417', '#' + m[1], '#' + m[2]];
}

/* A selector can carry more than one rule -- .switch input:checked +
   .switch-track sets box-shadow in one and background in another -- so a
   first-match lookup reads the wrong body and reports the wrong thing. */
function rulesFor(sel) {
  const out = [];
  let i = 0;
  for (;;) {
    i = CODE.indexOf(sel + '{', i);
    if (i === -1) return out;
    // must be a rule start, not a longer selector ending in this one
    const before = CODE[i - 1];
    if (before === undefined || /[\s{};,]/.test(before)) {
      out.push(CODE.slice(i + sel.length + 1, CODE.indexOf('}', i)));
    }
    i += sel.length;
  }
}

// ===========================================================================
// 1. THE OLD ACCENT IS GONE
// ===========================================================================
test('no violet token survives anywhere in the runtime', () => {
  assert.doesNotMatch(CODE, /--violet/, 'a --violet token or reference is still declared');
  [/#A88FD8/i, /#B79FDF/i, /#4C2A6B/i, /#5B3580/i, /#E9E2F5/i,
   /168,\s*143,\s*216/, /76,\s*42,\s*107/].forEach(re =>
    assert.doesNotMatch(CODE, re, 'an old violet literal is still in the stylesheet: ' + re));
});

test('every customer-facing brand control now resolves through the accent token', () => {
  /* The closed set, named. Each of these is a place violet meant Velvet Viking
     / primary interaction / selected brand state, and each must reach its
     colour through a token so the decision stays central. */
  const CONTROLS = [
    ['.builder-light .btn-primary',                 'the builder’s Continue / Build'],
    ['.hq-panel .rec-panel-nav .btn-primary',       'the Plan HQ panels’ ← BACK'],
    ['.bld-step.now',                               'the current build stage'],
    ['.bld-step.done',                              'the stages already covered'],
    ['.bld-stage-no',                               'the stage numeral'],
    ['.switch input:checked + .switch-track',       'every binary switch, ON'],
    ['.ws-n',                                       'the numbered workout step disc'],
    ['.ws-step::before',                            'the connector between steps'],
    ['.fuel-card.how-card',                         '“How to run this”'],
    ['.outlook-band',                               'the Race Outlook measured band'],
    ['.ol-swatch.measured',                         'its legend swatch'],
    ['.sub-pill.sub-trial',                         'the trial pill'],
  ];
  CONTROLS.forEach(([sel, what]) => {
    const bodies = rulesFor(sel);
    assert.ok(bodies.length, 'rule not found: ' + sel + ' (' + what + ')');
    const carrying = bodies.filter(b => /var\(--cherry[a-z-]*\)/.test(b));
    assert.ok(carrying.length,
      what + ' does not take the accent from a token: ' + sel + ' -> ' + bodies.join(' | '));
    carrying.forEach(b => assert.doesNotMatch(b, /#[0-9a-f]{3,8}/i,
      what + ' hard-codes a colour instead of using the token: ' + sel));
  });
  // The gauge is built in JS, not CSS, so it is checked where it is written.
  assert.match(CODE, /gaugeFillGrad[\s\S]{0,220}var\(--cherry-dim\)[\s\S]{0,80}var\(--cherry\)/,
    'the confidence gauge arc no longer takes the accent');
  assert.match(CODE, /stroke="var\(--cherry\)" stroke-width="2\.4"/,
    'the confidence gauge needle no longer takes the accent');
});

test('the primaries are SOLID, which is the treatment that was chosen', () => {
  ['.builder-light .btn-primary', '.hq-panel .rec-panel-nav .btn-primary',
   '.outlook-band', '.ol-swatch.measured'].forEach(sel => {
    const i = CODE.indexOf(sel + '{');
    const body = CODE.slice(i + sel.length + 1, CODE.indexOf('}', i));
    assert.doesNotMatch(body, /gradient/,
      sel + ' went back to a gradient; Cherry Lacquer was chosen as a flat fill');
  });
});

// ===========================================================================
// 2. THE APP DID NOT FLATTEN INTO ONE COLOUR
// ===========================================================================
test('gold is still the identity, and the accent did not take any of it', () => {
  [
    [/--bronze:#C0923F/,                                  'the bronze token'],
    [/--gold:#E3B15A/,                                    'the gold token'],
    [/:focus-visible\{outline:2px solid var\(--gold\)/,    'the global focus ring'],
    [/\.setup-section-title\{[^}]*color:var\(--bronze-text\)/, 'section headings'],
    [/\.btn-primary\{background:linear-gradient\(135deg,var\(--bronze\)/, 'the ordinary primary'],
    [/\.hq-panel \.btn-primary\{[^}]*var\(--bronze\)/,     'a panel’s own content primary'],
    [/\.pbar-fill\{[^}]*var\(--bronze\)[^}]*var\(--gold\)/, 'the progress bars'],
    [/\.sub-pill\.sub-active\{[^}]*--modal-active/,        'the ACTIVE subscription pill'],
  ].forEach(([re, what]) => assert.match(CODE, re, 'gold must remain on ' + what));
});

test('semantic colour is still semantic — the accent replaced none of it', () => {
  [
    [/--c-easy:#84A56E/,                                  'green / easy'],
    [/--c-tempo:#CC9245/,                                 'amber / tempo'],
    [/--c-threshold:#B5505A/,                             'red / threshold'],
    [/--c-long:#5E93AC/,                                  'blue / long'],
    [/--c-rest:#8C8272/,                                  'neutral / rest'],
    [/\.btn-danger\{[^}]*var\(--c-threshold\)[^}]*var\(--danger-text\)/, 'the destructive button'],
    [/\.sub-pill\.sub-grace\{[^}]*var\(--c-threshold\)/,   'the grace-period pill'],
    [/\.read-val\.good\{color:var\(--c-easy\);?\}/,         'a positive Reading verdict'],
    [/\.read-val\.watch\{color:var\(--gold\);?\}/,          'a watch verdict'],
    [/\.read-val\.bad\{color:var\(--c-tempo\);?\}/,         'a negative verdict'],
    [/\.coach-state\.proceed\{background:var\(--c-easy-soft\)/, 'the PROCEED chip'],
  ].forEach(([re, what]) => assert.match(CODE, re, what + ' was swallowed by the migration'));

  // And no semantic rule quietly started resolving through the accent.
  ['.btn-danger', '.sub-pill.sub-grace', '.read-val.good', '.read-val.watch',
   '.read-val.bad', '.coach-state.proceed'].forEach(sel =>
    rulesFor(sel).forEach(body =>
      assert.doesNotMatch(body, /--cherry/, sel + ' took the brand accent; it is semantic')));
});

// ===========================================================================
// 3. MEASURED ACCESSIBILITY, BOTH THEMES
// ===========================================================================
test('LIGHT: the accent is the canonical #532D3A, unmodified', () => {
  const t = tokens('light');
  assert.equal(t['--cherry'], '#532D3A', 'the light theme must ship the canonical value');
  assert.equal(t['--cherry-text'], '#532D3A', 'and use it unmodified as text');
  assert.equal(t['--cherry-btn-ink'], '#FFFFFF');
  assert.ok(ratio('#532D3A', '#FFFFFF') >= 4.5,
    'the button label is ' + ratio('#532D3A', '#FFFFFF') + ':1');
  surfaces('light').forEach(bg => assert.ok(ratio(t['--cherry'], bg) >= 3,
    'a light control on ' + bg + ' is only ' + ratio(t['--cherry'], bg) + ':1'));
  // and the pale node fill carries near-black
  assert.ok(ratio(t['--cherry-soft'], t['--cherry-ink']) >= 4.5,
    'the step numeral on its disc is ' + ratio(t['--cherry-soft'], t['--cherry-ink']) + ':1');
});

test('DARK: bare indicators are lifted only as far as 3:1 actually requires', () => {
  const t = tokens('dark');
  const ind = t['--cherry'];

  assert.ok(IN_FAMILY(ind),
    'the dark indicator tone drifted to hue ' + hue(ind).toFixed(1) +
    'deg, outside the cherry/wine family -- it is a different colour now');

  /* A BARE INDICATOR -- a 3px rail segment, a gauge needle, a band -- is
     identified by nothing but its own colour, so 1.4.11's 3:1 applies against
     every dark surface it can sit on. */
  surfaces('dark').forEach(bg => assert.ok(ratio(ind, bg) >= 3,
    'a bare dark indicator on ' + bg + ' is only ' + ratio(ind, bg) + ':1 -- WCAG 1.4.11 wants 3:1'));

  /* SMALLEST lift: one step darker must fail the boundary it was chosen for,
     or it is lighter than the colour needed to be. This gate is what stops the
     indicator tone creeping up towards pink over time. */
  const darker = '#' + hex(ind).map(v => Math.round(v * 0.94).toString(16).padStart(2, '0')).join('');
  assert.ok(ratio(darker, surfaces('dark')[2]) < 3,
    'a 6% darker indicator (' + darker + ') would still clear 3:1 -- the lift is bigger than it needs to be');
});

/* THE ANTI-ROSE GATE, and the reason the accent is two tokens rather than one.
   The first dark companion used ONE value everywhere. Because a bare indicator
   must clear 3:1 on near-black, that value was forced to a mid-tone -- and
   painting a large filled button with it produced dusty pink. A filled control
   carrying its own white label does not need that boundary to be identified,
   so it is free to be genuinely dark, and it must be. */
test('DARK: filled controls are burgundy, not a mid-tone rose', () => {
  const t = tokens('dark');
  const fill = t['--cherry-fill'];
  assert.ok(fill, 'there is no --cherry-fill: labelled fills are back on the indicator tone');

  assert.ok(IN_FAMILY(fill),
    'the dark fill drifted to hue ' + hue(fill).toFixed(1) + 'deg, outside the cherry/wine family');

  // THE REGRESSION THIS EXISTS FOR: a large filled area must stay dark.
  assert.ok(light(fill) <= 0.38,
    'the dark fill sits at ' + (light(fill) * 100).toFixed(1) +
    '% lightness -- that is rose, not lacquer (ceiling 38%)');
  assert.ok(light(fill) < light(t['--cherry']) - 0.06,
    'the fill is no darker than the indicator tone, so the split buys nothing');

  // Its LABEL is what identifies it, so that is the contrast that must hold.
  assert.ok(ratio(fill, t['--cherry-btn-ink']) >= 4.5,
    'the dark button label is only ' + ratio(fill, t['--cherry-btn-ink']) + ':1');

  /* LIGHT NEEDED NO SOLVING, so light must not quietly acquire a second value:
     both jobs there are the one canonical Cherry Lacquer. */
  const L = tokens('light');
  assert.equal(L['--cherry-fill'], '#532D3A',
    'light mode paints filled controls ' + L['--cherry-fill'] + ' instead of the canonical #532D3A');
  assert.equal(L['--cherry'], L['--cherry-fill'],
    'light mode split the accent in two, but only dark mode had a reason to');

  /* A dark fill cannot supply its own 3:1 boundary, so the rim does -- and the
     rim has to be the indicator tone, which is the one that clears it. */
  ['.builder-light .btn-primary', '.hq-panel .rec-panel-nav .btn-primary'].forEach(sel => {
    const bodies = rulesFor(sel);
    assert.ok(bodies.some(b => /background:var\(--cherry-fill\)/.test(b)),
      sel + ' does not take the fill tone -- a labelled primary is back on the indicator tone');
    assert.ok(bodies.some(b => /box-shadow:inset 0 0 0 1px var\(--cherry\)/.test(b)),
      sel + ' lost its --cherry rim, so the dark fill has no 3:1 boundary');
  });
});

test('DARK: the accent used as TEXT gets its own tone, because 3:1 is not enough to read', () => {
  const t = tokens('dark');
  assert.notEqual(t['--cherry-text'], t['--cherry'],
    'the dark theme reads its small accent text at the fill tone, which is under 4.5:1');
  assert.ok(IN_FAMILY(t['--cherry-text']),
    'the text tone drifted to hue ' + hue(t['--cherry-text']).toFixed(1) +
    'deg, outside the cherry/wine family');
  surfaces('dark').forEach(bg => assert.ok(ratio(t['--cherry-text'], bg) >= 4.5,
    'accent text on ' + bg + ' is only ' + ratio(t['--cherry-text'], bg) + ':1'));

  // And the two places it is actually used are the two that need it.
  ['.bld-stage-no', '.sub-pill.sub-trial'].forEach(sel =>
    assert.ok(rulesFor(sel).some(b => /color:var\(--cherry-text\)/.test(b)),
      sel + ' paints accent text with the fill tone rather than the text tone'));
});

test('the accent is a per-theme token, so no component carries a per-theme rule', () => {
  assert.equal((CODE.match(/--cherry:\s*#[0-9A-F]{6}/gi) || []).length, 2,
    'the accent must be declared exactly once per theme');
  /* And every --cherry* declaration in the file lives in one of those two
     token blocks. A component that redefined the accent for one theme would
     add a declaration somewhere else, which is what this counts. */
  const declared = (CODE.match(/--cherry[a-z-]*\s*:/g) || []).length;
  const perBlock = (CODE.match(/--cherry[a-z-]*\s*:/g) || []).length / 2;
  assert.equal(declared, perBlock * 2, 'unreachable');
  const blocks = [...CODE.matchAll(/--cherry:\s*#[0-9A-F]{6}/gi)].map(m => m.index);
  assert.equal(blocks.length, 2);
  const inABlock = [...CODE.matchAll(/--cherry[a-z-]*\s*:/g)]
    .filter(m => blocks.some(b => m.index >= b - 40 && m.index < b + 700)).length;
  assert.equal(inABlock, declared,
    'a --cherry declaration lives outside the two theme token blocks — a ' +
    'component is redefining the accent instead of using it');
});
