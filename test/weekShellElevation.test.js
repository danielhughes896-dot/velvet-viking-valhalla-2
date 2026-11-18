'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');

// C7 -- THE WEEK SHELL, NOT ONLY ITS DAY CARDS.
//
// dayCardElevation.test.js proved .day (the day cards a week contains)
// carries the app's premium raised-tile recipe (--tile-shadow/--tile-sheen).
// The .week shell AROUND those cards still used the older plain
// border + bare --shadow-sm -- live capture at 360/390/430, light and dark
// (tools/shots/week-shell-c7.js / week-closeup.js) showed it reading as the
// one flat, legacy surface left in an otherwise raised system, sitting
// directly above rows that visibly have a sheened top edge and it does not.
//
// THE FIX IS DELIBERATELY NOT dayCardElevation's recipe. .week holds seven
// day cards; giving it the same --tile-shadow would make the shell as loud
// as its contents and flatten the hierarchy between them. It takes
// .tb-unit-toggle's existing "hairline lift" recipe instead -- tile-sheen,
// tile-border, and a much smaller shadow than --tile-shadow's 12px blur --
// which is the app's own established quieter tier of the same system.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

function ruleFor(sel) {
  let i = 0;
  for (;;) {
    i = CODE.indexOf(sel + '{', i);
    assert.ok(i !== -1, 'no screen rule found for ' + sel);
    const open = i + sel.length + 1;
    const body = CODE.slice(open, CODE.indexOf('}', open));
    // .week also has an earlier @media print override (border-color/background
    // !important, no radius) -- skip it and keep looking for the screen rule.
    if (sel !== '.week' || /border-radius/.test(body)) return body;
    i = open;
  }
}

test('.week now carries the sheened tile background and tile border, not the plain surface-2/line pair alone', () => {
  const rule = ruleFor('.week');
  assert.match(rule, /background\s*:\s*var\(--tile-sheen\)\s*,\s*var\(--surface-2\)/,
    'the sheened top edge, layered over the SAME background colour, not a different one');
  assert.match(rule, /border\s*:\s*1px solid var\(--tile-border\)/);
});

test('.week takes the hairline-lift shadow, not the full --tile-shadow the day cards use', () => {
  const week = ruleFor('.week');
  assert.match(week, /box-shadow\s*:\s*0 1px 2px rgba\(0,0,0,\.14\), inset 0 1px 0 rgba\(255,255,255,\.10\)/,
    'must match the existing restrained .tb-unit-toggle recipe exactly, not invent a third depth tier');
  assert.doesNotMatch(week, /box-shadow\s*:\s*var\(--tile-shadow\)/,
    'the shell must stay quieter than its own day cards -- reusing --tile-shadow verbatim would make it as loud as them');
});

test('the shell keeps its own radius, spacing and overflow clipping (the accordion still animates)', () => {
  const week = ruleFor('.week');
  assert.match(week, /border-radius\s*:\s*var\(--radius\)/);
  assert.match(week, /margin-bottom\s*:\s*12px/);
  assert.match(week, /overflow\s*:\s*hidden/);
});

test('the taper week is not accented at all any more', () => {
  /* THIS HELD THE OPPOSITE UNTIL THE FOUNDER LOOKED AT IT: "Remove the gold
     in full week taper week. Just leave it the same as the rest." The
     bronze border and the --c-gold-soft head band are gone, so there is
     nothing left to override .week's own treatment.
     ASSERTED AS AN ABSENCE OF RULES, not of declarations: an empty
     .week.is-taper{} would satisfy a "no bronze" check while reading like
     something that still fires, and the next person to touch this would
     have to work out whether it mattered. */
  /* CODE is this file's comment-stripped copy of the runtime -- the same
     one ruleFor() reads, so an explanation mentioning the selector cannot
     be mistaken for the selector. */
  const bare = CODE;
  assert.equal(bare.indexOf('.week.is-taper{'), -1,
    'the taper week has a block rule again — it is meant to look like the rest');
  assert.equal(bare.indexOf('.week.is-taper .week-head'), -1,
    'the gold band is back behind the taper week head');
  /* AND THE GROUPING IS UNTOUCHED: the class still goes on the element,
     because it is what puts the taper weeks under one heading. */
  assert.ok(SRC.indexOf("(taperLook?' is-taper':'')") > -1,
    'is-taper stopped being applied, which regroups the taper weeks');
});

test('.week now owns the hairline-lift recipe outright, because the control it borrowed it from is gone', () => {
  /* .week took its surface from .tb-unit-toggle -- the KM/MI pill -- and
     this test existed so the two could not drift apart. The pill has been
     rebuilt in the bottom nav's language: two standalone labels, crisp bold
     white with the selected one in gold, no track, no fill, no border. So
     there is no second copy of the recipe to stay in sync with, and .week's
     own values (asserted above, verbatim) are the only definition left.

     What is checked here is that the borrowing really did end rather than
     being half-undone: the toggle must carry none of the surface, or the
     pill is quietly back. */
  const toggle = ruleFor('.tb-unit-toggle');
  assert.doesNotMatch(toggle, /var\(--tile-sheen\)/, 'the KM/MI pill grew its surface back');
  assert.doesNotMatch(toggle, /var\(--tile-border\)/, 'the KM/MI pill grew its border back');
  assert.doesNotMatch(toggle, /box-shadow\s*:\s*0 1px 2px/, 'the KM/MI pill grew its lift back');
  /* And it took the nav's voice instead, which is the whole point.
     ---- CHANGED SIDES: THE CHOSEN UNIT IS CHERRY ----
     This held it to gold, from before the colours were given jobs. Founder,
     on Settings: "Same cherry and gold colour language." Gold is the brand
     and the destination; a thing the athlete has picked is cherry, which is
     also literally the nav's voice now -- .bn-item.active is cherry. */
  const btn = ruleFor('.tb-unit-toggle button.active');
  assert.match(btn, /color\s*:\s*var\(--cherry-text\)/, 'the selected unit is not cherry');
  assert.doesNotMatch(btn, /gold/, 'the selected unit is still lit in gold');
  assert.match(btn, /text-shadow/, 'the selected unit lost its illumination');
});

// ---------------------------------------------------------------------------
// A TILE MAY BE LIFTED ONLY IF NOTHING ABOVE IT IS.
//
// The rule this file already states for .week -- "giving it the same
// --tile-shadow would make the shell as loud as its contents and flatten the
// hierarchy between them" -- is the same rule read the other way up. The
// raised-tile recipe is the app's premium card and is right on a PAGE
// ground: measured across Today, This Week, Full Plan, Sacoro and
// Settings, every tile wearing it has nothing above it wearing it.
//
// These four render only inside a modal card, so each was a tile as loud as
// the surface holding it. Named individually rather than swept, because the
// test is cheap to read and the sweep is not: the question for any new tile
// is not "does it use --tile-shadow" but "is there a card above it".
test('a tile that lives inside a modal card is not lifted as well', () => {
  [['#bld-review',        'the builder\u2019s review panel'],
   ['.bld-strava-offer',  'the builder\u2019s Strava offer'],
   ['.pace-table-card',   'the pacing modal\u2019s table'],
   ['.zone-paces-card',   'zone paces, which only ever render in a panel'],
  ].forEach(([sel, what]) => {
    const body = ruleFor(sel);
    assert.ok(body !== null && body !== undefined, 'rule not found: ' + sel);
    assert.doesNotMatch(body, /--tile-shadow/,
      what + ' is lifted again inside the card that already is: ' + sel);
    assert.doesNotMatch(body, /--tile-sheen/,
      what + ' took the raised tile\u2019s ground back: ' + sel);
  });
});
