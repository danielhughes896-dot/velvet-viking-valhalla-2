'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* ONE NUMBER FOR A TOUCH TARGET
 * ===========================================================================
 * The sheet used to carry three. One comment called 40 "the app's own stated
 * touch-target minimum", another sized a button "44px by the touch-target
 * minimum", a third took a tile to 56 "so the whole tile clears every
 * platform's touch target". Three numbers is no standard, and a walk of the
 * whole navigation tree -- five main screens, three child screens and sixteen
 * modals, measured in Chromium at 412x915 -- found twenty interactive targets
 * under 44 sheltering behind the ambiguity. The worst were on the two screens
 * an athlete opens most:
 *
 *   coach-why-btn  "Injured or ill?"   70 x 14   (Today)
 *   KM / MI                            24 x 34   and 21 x 34   (Sacoro)
 *
 * 44 wins: it is the floor both platforms publish, and the passes before this
 * one had already been moving things to it one control at a time.
 *
 * These guards hold the number, hold the components that take it, and hold
 * the two techniques used where a control could not simply grow -- because
 * each of those has a failure mode that is invisible unless you hit-test it.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];

const ruleFor = sel => {
  // anchored on a newline so a short selector cannot match inside a longer one
  const i = CSS.indexOf('\n  ' + sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return CSS.slice(i + sel.length + 4, CSS.indexOf('}', i));
};

test('the minimum is named once and is 44', () => {
  const m = /--tap-min:\s*(\d+)px/.exec(CSS);
  assert.ok(m, 'the --tap-min token is gone; the three contradictory numbers will come back');
  assert.equal(m[1], '44',
    '--tap-min moved off 44, the floor both platforms publish. If this is deliberate, ' +
    'the comment beside the token has to change with it.');
});

test('the components that were under the minimum take the token, not a literal', () => {
  [
    ['.icon-btn', 'the close button on every modal in the product'],
    ['.pv-back', 'the back button on the Full Plan child screens'],
    ['.day-check', 'the tick that completes a session'],
  ].forEach(([sel, what]) => {
    const r = ruleFor(sel);
    assert.match(r, /width:var\(--tap-min\); height:var\(--tap-min\)/,
      sel + ' (' + what + ') went back to a hard-coded size. It was ' +
      'measured under the minimum once already.');
  });

  /* WAS min-height:var(--tap-min) on .rs-chip. The strategy picker is drawn
     with the builder's tiles now ("Can race strategy tabs follow the build
     programme tabs please"), which are 72px, and this one is taller still
     to hold Recommended under the name. The law is the same -- not under
     the minimum -- asked of the rule that now sizes it. */
  const rsMin = /min-height:(\d+)px/.exec(ruleFor('.rs-chips.opt-grid .rs-chip'));
  assert.ok(rsMin && +rsMin[1] >= 44,
    'the race-strategy tiles went back under the minimum');
  assert.match(ruleFor('.btn-sm'), /min-height:var\(--tap-min\); min-width:var\(--tap-min\)/,
    '.btn-sm lost a dimension. It had the height and not the width, which is how a ' +
    '40x44 button survived the last sweep.');
  assert.match(ruleFor('.cv-label'), /min-height:var\(--tap-min\)/,
    'the coach-voice rows went back to 41px');
  assert.match(ruleFor('.stg-name-input'), /min-height:var\(--tap-min\)/,
    'the name field went back to 32px');
  /* THE ONE CONTROL THAT TAKES THE MINIMUM ON ONE AXIS ONLY, and the reason
     is worth keeping in front of whoever reads this next. KM and MI measured
     24x34 and 21x34 -- the smallest targets in the app, on the screen whose
     only pressable control they are -- so this pass set both dimensions to
     44. A guard in sacoroConceptRedesign caught it: each segment used to
     reserve min-width:30px for 15px and 12px of ink, which left an 18px hole
     between the two words, and that reservation had been deliberately
     removed. 44 per segment reopened the hole at 31px, measured.
     The two dimensions genuinely conflict here, so the height takes the
     minimum and the width stays at whatever the ink needs. Both halves are
     pinned: raising the width again is a regression, lowering the height is
     a regression. */
  const unit = ruleFor('.tb-unit-toggle button');
  assert.match(unit, /min-height:var\(--tap-min\)/,
    'the KM/MI segments lost the height half of the minimum -- the one axis that was free');
  assert.match(unit, /min-width:0/,
    'the KM/MI segments reserved width again. Each word is 14px and 11px of ink; a ' +
    'reserved 44 pushes them 31px apart and the control stops reading as one control.');
});

test('the two controls that could not grow carry a hit band instead', () => {
  /* .coach-why-btn is a 9.5px uppercase link by design -- growing the text
     would wreck the register the screen reads in. .switch is drawn at 42x24
     because the track is what makes it a switch rather than a button. Both
     keep their drawing and take the target through a transparent band, and
     both bands were hit-tested: a tap away from centre resolves to the
     control, and no neighbouring control's centre falls inside the band. */
  const why = /\.coach-why-btn::after\{([^}]*)\}/.exec(CSS);
  assert.ok(why, '.coach-why-btn lost its hit band and is back to 70x14');
  assert.match(why[1], /height:44px|height:var\(--tap-min\)/,
    '.coach-why-btn::after is no longer 44 tall');
  assert.match(why[1], /left:0; right:0/,
    '.coach-why-btn::after must stay clipped to the words. Given a width of its own it ' +
    'would reach sideways into whatever sits beside it.');

  const sw = /\.switch::after\{([^}]*)\}/.exec(CSS);
  assert.ok(sw, '.switch lost its hit band and is back to a 42x24 target');
  assert.match(sw[1], /width:var\(--tap-min\); height:var\(--tap-min\)/,
    '.switch::after is no longer the full minimum');
  assert.match(sw[1], /translate\(-50%,-50%\)/,
    '.switch::after is no longer centred on the track, so the target has drifted off the control');
});

test('the legal links are a class, not two copies of an inline style', () => {
  assert.match(CSS, /\.legal-link\{[^}]*min-width:var\(--tap-min\); min-height:var\(--tap-min\)/,
    'Privacy and Terms lost their class. They measured 52x31 and 41x31 and were missed by ' +
    'every earlier sweep because the size was hand-written inline, twice.');
  /* Anchored on the class itself. Walking back from LEGAL_URLS.privacy found
     the wrong place -- there are four references to it and the first is an
     assignment thousands of lines above the footer -- and a lookahead from
     .build-tag found the wrong div, because two of the three hold nothing but
     "Build <id>". The class name is the unambiguous marker. */
  const links = SRC.match(/class="legal-link"/g) || [];
  assert.equal(links.length, 2,
    'both legal links should carry .legal-link; found ' + links.length);
  /* Scoped to the footer, not the whole sheet: "padding:9px 6px" also appears
     on .pace-table cells, so a file-wide check on that string would fire on
     an unrelated table. The window is the markup holding both links. */
  const first = SRC.indexOf('class="legal-link"');
  const last = SRC.lastIndexOf('class="legal-link"');
  const footer = SRC.slice(SRC.lastIndexOf('<div', first), SRC.indexOf('</div>', last) + 6);
  assert.ok(!/style=/.test(footer),
    'an inline style is back on the legal links. Writing their size by hand instead of in ' +
    'the sheet is why every earlier sweep missed them at 52x31 and 41x31.');
});

/* ===========================================================================
 * THE LAST GLYPHS IN FRONT OF A TITLE, AND THE ONE THAT EARNED ITS PLACE
 * ===========================================================================
 * Thirteen .coach-next-head blocks opened with a sparkles glyph before a
 * section title -- "Next Move", "What's next", "How did it go?", "Fitness
 * Checkpoint". Sparkles names nothing, so it was decoration between the
 * gutter and the word, and it is the pattern the product has been removing
 * surface by surface.
 *
 * The line this draws is not "no glyphs". A glyph stays where it carries
 * meaning: the kind-markers in a Reading row (the sheet says so where hqRow
 * is defined), the heart-rate and pace icons on a threshold row, the glyph on
 * an action button -- and the tick, which is this product's done/chosen mark
 * on a selected build option, on the sheet's Save, and on the completed
 * Fitness Checkpoint card, where it is the only thing saying the checkpoint
 * is settled.
 *
 * Worth recording how the first attempt at this failed, because the suite did
 * not catch it and running the app did: stripping "+ICONS.sparkles+" took the
 * quote and the plus that rejoined the string with it, and thirteen template
 * literals stopped parsing. A parse check belongs in this file for that
 * reason.
 */
test('the inline script still parses', () => {
  const blocks = SRC.match(/<script>([\s\S]*?)<\/script>/g) || [];
  assert.ok(blocks.length, 'no inline script found at all');
  const code = blocks.map(b => b.replace(/<\/?script>/g, '')).join('\n');
  assert.doesNotThrow(() => new Function(code),
    'the inline script no longer parses. A string-concatenation edit that removes a ' +
    '"+ICONS.x+" has to leave the quote and the plus that rejoin the template.');
});

test('no section title leads with a sparkle', () => {
  assert.ok(!/coach-next-head">'\s*\+?\s*ICONS\.sparkles/.test(SRC),
    'a sparkles glyph is back in front of a section title');
  const heads = SRC.match(/class="coach-next-head">'\s*\+\s*ICONS\.(\w+)/g) || [];
  assert.deepEqual(heads.map(h => h.replace(/[\s\S]*ICONS\./, '')), ['check'],
    'the only glyph allowed in front of one of these titles is the tick on the ' +
    'completed checkpoint card, which is the done mark rather than decoration. Found: ' +
    heads.join(', '));
});

test('the checkpoint tick survives, and so does the rule that sizes it', () => {
  assert.match(SRC, /class="coach-next-head">'\+ICONS\.check\+/,
    'the tick on the completed Fitness Checkpoint card is gone. .cp-done only dims a ' +
    'line of text, so that tick was the only thing marking the checkpoint settled.');
  assert.match(CSS, /\.coach-next-head svg\{[^}]*width:15px/,
    'the rule that sizes that one remaining glyph went with the sparkles');
});

test('the section heading voice stays single', () => {
  const next = /\.coach-next-title\{([^}]*)\}/.exec(CSS);
  const setup = /\n  \.setup-section-title\{([^}]*)\}/.exec(CSS);
  assert.ok(next && setup, 'one of the two section-heading rules is gone');
  [['font-size', /font-size:(\d+(?:\.\d+)?px)/], ['colour', /color:(var\([^)]*\))/]].forEach(([what, re]) => {
    const a = re.exec(next[1]), b = re.exec(setup[1]);
    assert.ok(a && b, 'cannot read ' + what + ' from both section-heading rules');
    assert.equal(a[1], b[1],
      '.coach-next-title and .setup-section-title disagree on ' + what + ' (' + a[1] +
      ' vs ' + b[1] + '). They are the same voice; removing the glyph in front of one ' +
      'was done instead of growing it, precisely so a second voice is not invented.');
  });
});

test('no Settings panel says its own name twice', () => {
  /* The panel header names the panel. renderCloudCard() and
     renderHealthConsentSettings() each opened with a .setup-section-title
     repeating it -- two of six panels did, four did not. */
  [['renderCloudCard', 'Account &amp; Backup'],
   ['renderHealthConsentSettings', 'Health &amp; Readiness']].forEach(([fn, title]) => {
    const i = SRC.indexOf('function ' + fn + '(');
    assert.ok(i > -1, fn + ' is gone');
    const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
    assert.ok(!body.includes('<div class="setup-section-title">' + title + '</div>'),
      fn + ' opens on a section title repeating the panel header above it');
  });
});

test('the Backup panel is three labelled pairs, and the sheet owns the rhythm', () => {
  const i = SRC.indexOf('function settingsPanelBackup(');
  assert.ok(i > -1, 'settingsPanelBackup is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  ['As a file', 'As text', 'Other exports'].forEach(label => {
    assert.ok(body.includes('<div class="setup-section-title">' + label + '</div>'),
      'the Backup panel lost its "' + label + '" group. Six identical full-width slabs ' +
      'with one heading two thirds down is what a tree walk called the densest surface ' +
      'in the product.');
  });
  assert.equal((body.match(/class="stg-actions"/g) || []).length, 3,
    'the Backup panel should hold three action groups');
  assert.ok(!/style="margin-bottom:/.test(body),
    'a hand-written margin is back on a Backup button. Six of them had been set one at a ' +
    'time, arriving at 8, 14 and 8 for three gaps that mean the same thing.');
  assert.match(CSS, /\.stg-actions\{[^}]*gap:8px/,
    '.stg-actions no longer owns the gap between stacked actions');
});
