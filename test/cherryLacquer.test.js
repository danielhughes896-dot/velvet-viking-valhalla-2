'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* CHERRY LACQUER — the Velvet Viking interactive accent.
 * ===========================================================================
 * #532D3A replaced the Sacoro violet across every place violet meant
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
/* CIE L*a*b* and deltaE76. Hue alone cannot answer "do these two look like the
   same colour", because two colours a few degrees apart at the same lightness
   and saturation are indistinguishable on a 4px strip. deltaE can. */
const labOf = h => {
  const [r, g, b] = hex(h).map(lin);
  const X = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const Y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const Z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const deltaE = (a, b) => {
  const A = labOf(a), B = labOf(b);
  return Math.round(Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) * 10) / 10;
};
/* The workout-type palette, read from the stylesheet rather than restated, so
   changing a semantic colour is also checked against the accent. */
function workoutColours() {
  const out = {};
  [...CODE.matchAll(/(--c-(?:rest|easy|tempo|threshold|long)):\s*(#[0-9A-Fa-f]{6})/g)]
    .forEach(m => { out[m[1]] = m[2]; });
  return out;
}

/* Token values are read from the shipped :root block, so these tests measure
   what the app renders rather than what this file remembers. There is one
   block now: light was retired, and with it the second copy of the accent. */
function tokens() {
  const start = CODE.indexOf('--cherry:');
  assert.notEqual(start, -1, 'no --cherry block');
  const block = CODE.slice(start, start + 900);
  const out = {};
  [...block.matchAll(/(--cherry[a-z-]*)\s*:\s*([^;]+);/g)].forEach(m => { out[m[1]] = m[2].trim(); });
  return out;
}
function surfaces() {
  /* --bg / --bg-2 / --bg-3, read from the stylesheet rather than pinned here,
     because the ground moved to the Today charcoal when that card's language
     became the product's and these ratios have to be measured against what
     actually ships. */
  const m = CODE.match(/--bg:#([0-9A-F]{6}); --bg-2:#([0-9A-F]{6}); --bg-3:#([0-9A-F]{6});/i);
  assert.ok(m, 'could not read the surfaces');
  return ['#' + m[1], '#' + m[2], '#' + m[3]];
}

/* A selector can carry more than one rule -- .switch input:checked +
   .switch-track sets box-shadow in one and background in another -- so a
   first-match lookup reads the wrong body and reports the wrong thing. */
function rulesFor(sel) {
  const out = [];
  let i = 0;
  for (;;) {
    i = CODE.indexOf(sel, i);
    if (i === -1) return out;
    // must be a whole selector token, not a longer one this is a substring
    // of (.ws-n inside .ws-name), and not mid-word on either side.
    const before = CODE[i - 1];
    const after = CODE[i + sel.length];
    const validBefore = before === undefined || /[\s{};,]/.test(before);
    const validAfter = after === '{' || after === ',' || (after !== undefined && /\s/.test(after));
    if (validBefore && validAfter) {
      // The selector may be one of several sharing one rule body via a
      // comma-separated list (e.g. ".ws-n, .ws-h-num{...}") -- walk forward
      // to the brace that actually opens ITS rule, past any other selectors
      // in the same list, and read that shared body.
      const openBrace = CODE.indexOf('{', i + sel.length);
      out.push(CODE.slice(openBrace + 1, CODE.indexOf('}', openBrace)));
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

test('Re-calibrate actually wins the cascade its rule is written for', () => {
  /* MEASURED IN THE OPEN PANEL, where it had been losing silently. The
     button carries .btn .btn-primary .btn-recal and sits inside .hq-panel,
     so .hq-panel .btn-primary (0,2,0) beat .btn-recal (0,1,0) outright: the
     resolved background-image was the BRONZE gradient, with .btn-recal's
     cherry inset ring coming through underneath it -- two designs at once,
     neither of them on purpose, and a gold-filled pill with dark text in a
     panel whose every other control sits on the card's own ground.
     Every colour assertion in this file passed throughout, because they ask
     what the sheet SAYS and the sheet said cherry. What was wrong was which
     rule applied, so that is what this guards: weight, and then order. */
  const recal = CODE.indexOf('.btn-recal, .hq-panel .btn-recal{');
  const panelPrimary = CODE.indexOf('.hq-panel .btn-primary{');
  assert.ok(panelPrimary > -1, 'the panel primary rule is gone');
  assert.ok(recal > -1,
    '.btn-recal lost the .hq-panel-weight half of its selector, so inside a ' +
    'panel it is outranked by .hq-panel .btn-primary again');
  assert.ok(recal > panelPrimary,
    '.btn-recal is stated before .hq-panel .btn-primary again; the two tie ' +
    'at (0,2,0), so the one written last wins and Re-calibrate goes bronze');
});

test('every customer-facing brand control now resolves through the accent token', () => {
  /* The closed set, named. Each of these is a place violet meant Velvet Viking
     / primary interaction / selected brand state, and each must reach its
     colour through a token so the decision stays central. */
  const CONTROLS = [
    ['.builder-light .btn-primary',                 'the builder’s Continue / Build'],
    ['.btn-recal',                                  'Settings’ Re-calibrate Training Zones launcher'],
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
  // Approved-concept redesign: a full-circle ring rather than a semicircle
  // with a gradient and a needle -- the progress arc itself is still the
  // one place this figure carries the accent.
  /* THE ARC STILL CARRIES THE ACCENT, it is simply no longer a single
     stroke:var(--cherry). It takes the session ring's filament -- the same
     four stops, near-white at the hot end falling through --cherry-text and
     --cherry to --cherry-dim -- so the claim this guards (the arc is the one
     place this figure wears the accent) is checked against the gradient the
     arc actually paints with. */
  /* The stroke declaration, not the closing brace: .gauge-fill carries an
     entrance animation beside it now, and a colour guard should not fail
     for a timing change. */
  assert.match(CODE, /\.gauge-fill\{stroke:url\(#gaugeFill\);/,
    'the confidence gauge arc no longer paints with its own gradient');
  const gaugeGrad = /id="gaugeFill"[\s\S]*?<\/linearGradient>/.exec(CODE);
  assert.ok(gaugeGrad, 'the gauge gradient is gone');
  ['--cherry-text', '--cherry', '--cherry-dim'].forEach(tok => {
    assert.ok(gaugeGrad[0].indexOf('var(' + tok + ')') > -1,
      'the confidence gauge arc no longer takes the accent (' + tok + ')');
  });
});

test('the primaries are SOLID, which is the treatment that was chosen', () => {
  /* The Plan HQ panels' cherry BACK is gone from this list because the
     button is gone: it fired the same action as the X in its own header, so
     the panel had two controls for one outcome and the cherry one was the
     heaviest thing on a surface built to show evidence. Cherry did not leave
     the product -- it is still the builder's forward motion, the measured
     band and the gauge arc below. */
  ['.builder-light .btn-primary',
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
    /* THE TONE MOVED TO THE DOT, AND THAT IS THE WHOLE CHANGE. Founder: "I
       don't want symbols or pills! If there is a pill that adds value.
       Change it to just a title with a small coloured dot." .read-val was
       the pill; the word in it now takes white like every other title on
       the panel, and the engine's good/watch/bad is drawn as the six-pixel
       dot beside it. What this law protects is unchanged -- the three
       semantic tokens must still reach the verdict -- so it follows the
       colour to where the colour now is rather than being deleted with the
       rule it used to name. */
    [/\.read-val\.good \.read-dot\{--read-tone:var\(--c-easy\);?\}/,  'a positive Reading verdict'],
    [/\.read-val\.watch \.read-dot\{--read-tone:var\(--gold\);?\}/,   'a watch verdict'],
    [/\.read-val\.bad \.read-dot\{--read-tone:var\(--c-tempo\);?\}/,  'a negative verdict'],
    /* And the word it sits beside is white, or the dot is decorating a
       second copy of the tone rather than carrying it. */
    [/\.read-val\{[^}]*color:#FFFFFF/,                    'the verdict word itself'],
    [/\.coach-state\.proceed\{background:(?:[^;]*,\s*)?var\(--c-easy-soft\)/, 'the PROCEED chip'],
  ].forEach(([re, what]) => assert.match(CODE, re, what + ' was swallowed by the migration'));

  // And no semantic rule quietly started resolving through the accent.
  ['.btn-danger', '.sub-pill.sub-grace', '.read-val.good .read-dot',
   '.read-val.watch .read-dot', '.read-val.bad .read-dot',
   '.coach-state.proceed'].forEach(sel =>
    rulesFor(sel).forEach(body =>
      assert.doesNotMatch(body, /--cherry/, sel + ' took the brand accent; it is semantic')));
});

// ===========================================================================
// 3. MEASURED ACCESSIBILITY, BOTH THEMES
// ===========================================================================

test('bare indicators are lifted only as far as 3:1 actually requires', () => {
  const t = tokens();
  const ind = t['--cherry'];

  assert.ok(IN_FAMILY(ind),
    'the dark indicator tone drifted to hue ' + hue(ind).toFixed(1) +
    'deg, outside the cherry/wine family -- it is a different colour now');

  /* A BARE INDICATOR -- a 3px rail segment, a gauge needle, a band -- is
     identified by nothing but its own colour, so 1.4.11's 3:1 applies against
     every dark surface it can sit on. */
  surfaces().forEach(bg => assert.ok(ratio(ind, bg) >= 3,
    'a bare dark indicator on ' + bg + ' is only ' + ratio(ind, bg) + ':1 -- WCAG 1.4.11 wants 3:1'));

  /* SMALLEST lift: one step darker must fail the boundary it was chosen for,
     or it is lighter than the colour needed to be. This gate is what stops the
     indicator tone creeping up towards pink over time. */
  const darker = '#' + hex(ind).map(v => Math.round(v * 0.94).toString(16).padStart(2, '0')).join('');
  assert.ok(ratio(darker, surfaces()[2]) < 3,
    'a 6% darker indicator (' + darker + ') would still clear 3:1 -- the lift is bigger than it needs to be');
});

/* THE ANTI-ROSE GATE, and the reason the accent is two tokens rather than one.
   The first dark companion used ONE value everywhere. Because a bare indicator
   must clear 3:1 on near-black, that value was forced to a mid-tone -- and
   painting a large filled button with it produced dusty pink. A filled control
   carrying its own white label does not need that boundary to be identified,
   so it is free to be genuinely dark, and it must be. */
test('filled controls are burgundy, not a mid-tone rose', () => {
  const t = tokens();
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

  /* A dark fill cannot supply its own 3:1 boundary, so the rim does -- and the
     rim has to be the indicator tone, which is the one that clears it. */
  /* One labelled cherry fill left in the product, not two: the Plan HQ
     panels' BACK is gone, having fired the same action as the X beside it.
     The contrast rule it was held to is unchanged for the one that remains. */
  ['.builder-light .btn-primary'].forEach(sel => {
    const bodies = rulesFor(sel);
    assert.ok(bodies.some(b => /background:var\(--cherry-fill\)/.test(b)),
      sel + ' does not take the fill tone -- a labelled primary is back on the indicator tone');
    assert.ok(bodies.some(b => /box-shadow:inset 0 0 0 1px var\(--cherry\)/.test(b)),
      sel + ' lost its --cherry rim, so the dark fill has no 3:1 boundary');
  });
});

test('the accent used as TEXT gets its own tone, because 3:1 is not enough to read', () => {
  const t = tokens();
  assert.notEqual(t['--cherry-text'], t['--cherry'],
    'the dark theme reads its small accent text at the fill tone, which is under 4.5:1');
  assert.ok(IN_FAMILY(t['--cherry-text']),
    'the text tone drifted to hue ' + hue(t['--cherry-text']).toFixed(1) +
    'deg, outside the cherry/wine family');
  surfaces().forEach(bg => assert.ok(ratio(t['--cherry-text'], bg) >= 4.5,
    'accent text on ' + bg + ' is only ' + ratio(t['--cherry-text'], bg) + ':1'));

  // And the two places it is actually used are the two that need it.
  ['.bld-stage-no', '.sub-pill.sub-trial'].forEach(sel =>
    assert.ok(rulesFor(sel).some(b => /color:var\(--cherry-text\)/.test(b)),
      sel + ' paints accent text with the fill tone rather than the text tone'));
});

test('the accent is one token, and no component redefines it', () => {
  const blocks = [...CODE.matchAll(/--cherry:\s*#[0-9A-F]{6}/gi)].map(m => m.index);
  assert.equal(blocks.length, 1,
    'the accent must be declared exactly once, at the root');
  /* And every --cherry* declaration in the file lives in that one block. A
     component that redefined the accent for itself would add a declaration
     somewhere else, which is what this counts. */
  const declared = (CODE.match(/--cherry[a-z-]*\s*:/g) || []).length;
  const inTheBlock = [...CODE.matchAll(/--cherry[a-z-]*\s*:/g)]
    .filter(m => blocks.some(b => m.index >= b - 40 && m.index < b + 700)).length;
  assert.equal(inTheBlock, declared,
    'a --cherry declaration lives outside the token block — a component is ' +
    'redefining the accent instead of using it');
});


/* THE ACCENT MUST NOT IMPERSONATE A WORKOUT TYPE.
   ===========================================================================
   This exists because it happened. Chasing "less pink" moved the dark accent
   from 339deg to 347deg, which put it 6.8 deltaE from --c-threshold #B5505A --
   the colour of a threshold session's left edge. On an expanded threshold card
   the semantic edge and the brand accent then read as the same colour, and the
   athlete loses the difference between "Sacoro" and "this session is hard".

   Nothing caught it: every existing guard asked whether the accent was
   ACCESSIBLE and whether it was still in the cherry family, and it was both.
   None asked whether it had wandered onto a colour that already means
   something. Hue is not enough for that question -- 8 degrees is nothing on a
   4px strip -- so this measures perceptual distance instead. */
test('the brand accent is never mistakable for a workout-type colour', () => {
  const WORKOUT = workoutColours();
  assert.ok(Object.keys(WORKOUT).length >= 5,
    'could not read the workout palette: ' + JSON.stringify(WORKOUT));

  const MIN = 15;   // below this two colours read as the same on a thin edge
  ['dark', 'light'].forEach(scope => {
    const t = tokens(scope);
    ['--cherry', '--cherry-fill', '--cherry-text'].forEach(name => {
      const v = t[name];
      if (!v || !/^#[0-9A-Fa-f]{6}$/.test(v)) return;   // rgba/var forms are covered elsewhere
      Object.keys(WORKOUT).forEach(sem => {
        const d = deltaE(v, WORKOUT[sem]);
        assert.ok(d >= MIN,
          scope + ' ' + name + ' ' + v + ' is only ' + d + ' deltaE from ' +
          sem + ' ' + WORKOUT[sem] + ' — the accent has wandered onto a colour ' +
          'that already means something (minimum ' + MIN + ')');
      });
    });
  });
});

test('the workout-type palette still says five different things', () => {
  // The other half of the same rule: semantic colours must stay distinct from
  // EACH OTHER, so "do not flatten them into the brand" cannot be satisfied by
  // flattening them into one another instead.
  const W = workoutColours();
  const keys = Object.keys(W);
  keys.forEach((a, i) => keys.slice(i + 1).forEach(b => {
    const d = deltaE(W[a], W[b]);
    assert.ok(d >= 20,
      a + ' and ' + b + ' are only ' + d + ' deltaE apart — two workout types ' +
      'now look like the same thing');
  }));
});

// ===========================================================================
// 4. THE WORKOUT-STEP CONNECTOR MUST NOT PICK UP A TINT FROM UNDERNEATH IT
// ===========================================================================
/* THIS EXISTS BECAUSE IT HAPPENED. The connector between step discs
 * (.ws-step::before) carried var(--cherry-line) -- correctly a Cherry
 * Lacquer token, and every string-based check above passed it: it named a
 * --cherry* variable, it declared no hard-coded hex.
 *
 * But --cherry-line is translucent (rgba, ~0.3-0.45 alpha), and a day card's
 * background is tinted by its session type. A translucent line composites
 * WITH whatever it is drawn over, so on an interval/tempo/threshold card in
 * dark mode the rendered pixel measured out at rgb(86,55,68) -- hue 335deg,
 * one degree inside this file's own cherry/wine cutoff (334deg) and
 * indistinguishable by eye from the violet the accent was migrated away
 * from. On a checkpoint card's warmer tint in light mode it measured
 * rgb(190,168,158) -- hue 19deg, amber, not cherry at all. No token check
 * caught this because the token itself was never wrong; only what it became
 * once alpha-blended with a real card underneath it was.
 *
 * The disc (.ws-n) solved exactly this problem for itself already -- "the
 * disc carries its own opaque fill... a day card is tinted by session type,
 * so no single mask colour existed" -- and the fix here is the same one:
 * make the connector opaque too, so it reads as --cherry regardless of what
 * it sits on, rather than re-deriving a translucent value that would need
 * re-measuring against every future card tint. */
test('the connector is opaque, so a tinted day card underneath it cannot shift its hue', () => {
  const bodies = rulesFor('.ws-step::before');
  assert.ok(bodies.length, 'rule not found: .ws-step::before');
  bodies.forEach(b => {
    assert.match(b, /background:var\(--cherry\)/,
      '.ws-step::before must paint the connector with the solid var(--cherry) token, not a ' +
      'translucent one -- got: ' + b);
    assert.doesNotMatch(b, /--cherry-line|--cherry-dim|--cherry-soft/,
      '.ws-step::before is back on a translucent cherry token, which composites with ' +
      'whatever tinted card it is drawn over: ' + b);
    assert.doesNotMatch(b, /rgba\(|opacity\s*:/,
      '.ws-step::before reintroduces transparency by another route: ' + b);
  });
});

test('the connector and the disc it connects are drawn from the identical token', () => {
  // Not just "both cherry" -- the SAME declaration, so they can never drift
  // apart from each other in either theme. The disc's border now comes from
  // a base rule shared with .ws-h-num (so the two discs can't drift from
  // EACH OTHER either) plus its own sizing rule -- concatenate everything
  // .ws-n contributes and look for the same rim there, whether it lands as
  // one shorthand or split across the shared/specific rules.
  const discBody = rulesFor('.ws-n').join(' ');
  assert.match(discBody, /border-width:1\.5px|border:1\.5px solid var\(--cherry\)/,
    '.ws-n does not carry the expected 1.5px rim width');
  assert.match(discBody, /border-color:var\(--cherry\)|border:1\.5px solid var\(--cherry\)/,
    '.ws-n does not carry the expected var(--cherry) rim colour');
  const lineBody = rulesFor('.ws-step::before').find(b => /background:var\(--cherry\)/.test(b));
  assert.ok(lineBody, '.ws-step::before does not carry the expected var(--cherry) fill');
});

test('the connector cannot drift toward violet again, because it has no alpha left to blend', () => {
  /* THE EVIDENCE. rgb(86,55,68) and rgb(190,168,158) are not derived here --
   * they were read directly off the rendered page with a pixel probe
   * (Playwright screenshot + raw buffer sample at the connector's on-screen
   * position), one on a dark-mode interval card, one on a light-mode
   * checkpoint card, both while .ws-step::before still carried the
   * translucent var(--cherry-line). They are recorded as a fixed regression
   * marker, not recomputed from the stylesheet, because the whole point is
   * that no reading of the stylesheet's tokens would have told you this --
   * every token involved was already correctly Cherry Lacquer. */
  const hueOfRgb = ([r, g, b]) => {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let x; if (!d) x = 0; else if (mx === r) x = ((g - b) / d) % 6;
    else if (mx === g) x = (b - r) / d + 2; else x = (r - g) / d + 4;
    return ((x * 60) + 360) % 360;
  };
  const measuredDark = [86, 55, 68], measuredLight = [190, 168, 158];
  assert.ok(hueOfRgb(measuredDark) < 336,
    'the historical dark-mode regression pixel should sit right at the violet boundary; ' +
    'if this fails the reproduction itself has drifted, not just the app');
  assert.ok(hueOfRgb(measuredLight) < 30 && hueOfRgb(measuredLight) > 5,
    'the historical light-mode regression pixel should sit in amber, nowhere near cherry');

  // THE FIX. --cherry itself has no alpha to blend against a card underneath
  // it, in either theme -- so this is not a narrower version of the same
  // drift, it is architecturally not possible any more.
  ['dark', 'light'].forEach(scope => {
    const t = tokens(scope);
    assert.match(t['--cherry'], /^#[0-9A-Fa-f]{6}$/,
      scope + ' --cherry is not a solid hex — the connector could drift again');
  });
});

/* ===========================================================================
 * NAVIGATION IS ONE BUTTON; A COMMIT IS ANOTHER
 * ---------------------------------------------------------------------------
 * Race Day's "View session" and This Week's "View full session" do the same
 * job -- go and look at this session -- and were two dialects of one button.
 * Measured at 412px before this: identical shape, radius, ground, weight;
 * differing in exactly two declarations, the rim (velvet against the neutral
 * --t-tile-rim) and the ink (cherry against gold). After: colour, border
 * width, border colour, radius and the layered background all read the same
 * in Chromium on both screens.
 *
 * The founder's rule was "anywhere there is a filled cherry clickable box
 * should follow the same rules as Race Day view session". This is the half
 * of it that is navigation. The other half -- Continue, Got it, Tell
 * Sacoro -- is a COMMIT, the one action that moves the athlete forward in
 * a flow where nothing else carries weight, and stays filled. Race Day's can
 * be rim-lit because it sits inside a cherry-rimmed panel that already
 * supplies the weight; a modal's primary has no such panel behind it.
 * ======================================================================== */

const NAV_CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '');
const navRule = sel => {
  const re = new RegExp('(^|[}\\n,])[ \\t]*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{', 'g');
  const hits = [...NAV_CSS.matchAll(re)];
  assert.equal(hits.length, 1, 'expected exactly one rule for ' + sel + ', found ' + hits.length);
  const i = hits[0].index + hits[0][0].length;
  return NAV_CSS.slice(i, NAV_CSS.indexOf('}', i));
};

test('both ways into a session wear one treatment, stated once', () => {
  const nav = navRule('.sess-nav');
  assert.match(nav, /--t-rim-velvet/, 'session navigation has lost the velvet rim');
  assert.match(nav, /color:var\(--cherry-text\)/, 'session navigation has lost the cherry ink');
  assert.match(nav, /border:1px solid transparent/,
    'the rim is painted by the border-box gradient, so the border itself has to be transparent');

  /* BOTH BUTTONS WEAR IT. The class is the whole mechanism. */
  assert.match(SRC, /class="rd-open sess-nav"/, 'Race Day no longer wears the shared treatment');
  /* THE QUOTE MOVED, NOT THE CLASS. This read the source text up to the
     opening quote of a concatenation -- class="wk-open sess-nav'+(isRest ?
     ' is-ghost' : '')+'" -- and the ghost modifier is gone (no day can open
     a full session any more), so the literal now closes with a double
     quote. Either shape satisfies the claim, which is that both buttons
     wear the shared class. */
  assert.match(SRC, /class="wk-open sess-nav['"]/, 'This Week no longer wears the shared treatment');

  /* THE METRICS ARE THE BUTTON TOO. They were left behind at first -- 14.5px
     and 11px padding here, 15px and 14px in the Race Day panel -- on the
     reasoning that each was tuned to its context. 15px is the app's own
     metric tier; 14.5px occurs four times in a 60,000-line sheet. That was
     drift, not tuning, and it left one control with two specs. */
  assert.match(nav, /font-size:15px/, 'the shared button is off the app\u2019s 15px tier again');
  assert.match(nav, /padding:14px/, 'the shared button no longer states one padding');
  assert.match(nav, /min-height:var\(--tap-min\)/, 'the shared button has lost the 44px floor');

  /* AND NEITHER RE-DECLARES ANY OF IT. Two rules setting one property on
     one element is the fault this file's neighbours keep recording; all of
     it came OUT of both rather than being left to be overridden. Each keeps
     only where it sits. */
  ['.wk-open', '.view-plan > .race-event .rd-open'].forEach(sel => {
    const body = navRule(sel);
    [['background:', 'ground'], ['color:', 'ink'], ['border:', 'border'],
     ['font-size:', 'type size'], ['padding:', 'padding'], ['border-radius:', 'radius'],
     ['font-weight:', 'weight']].forEach(([decl, what]) => {
      assert.ok(body.indexOf(decl) === -1,
        sel + ' states its own ' + what + ' again — the two can drift apart from here');
    });
  });
});

test('a commit is still filled, and that is the distinction', () => {
  /* If this ever goes rim-lit, the builder's forward motion goes quiet and
     the product loses any difference between "go look at this" and "commit
     to this". It was considered and declined on the founder's call. */
  const commit = navRule('.builder-light .btn-primary');
  assert.match(commit, /background:var\(--cherry-fill\)/,
    'the committing button is no longer a FILLED cherry — navigation and commit now read the same');
  assert.match(commit, /color:var\(--cherry-btn-ink\)/, 'the committing button lost its ink');

  /* And the neutral button recipe is untouched: saving a session edit is a
     commit too, and deliberately NOT cherry -- it sits above a
     cherry-outlined "Reset this session", and the control that saves must
     not look like the one that destroys. */
  assert.match(navRule('.es-actions .btn-primary'), /background:var\(--t-card\)/,
    'Edit Session’s save has gone cherry — it sits above a cherry Reset and must not match it');
});
