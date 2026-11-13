'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { RUNTIME_RELATIVE } = require('./harness.js');

/* Founder, after the cross-device responsive audit: "Proceed with all 10
   findings ... This is a responsive-design correction, not a visual
   redesign. Preserve SACORO's existing typography, colours, liquid glass,
   spacing character, transitions and navigation. The interface must
   reflow naturally across screen sizes rather than simply shrink
   proportionally." Each test names the finding it holds. */

const RT = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const CSS = RT.slice(RT.indexOf('<style'), RT.indexOf('</style>'));
const fnIn = (n) => {
  const i = RT.indexOf('function ' + n + '(');
  assert.ok(i > -1, n);
  return RT.slice(i, RT.indexOf('\n}', i) + 2);
};

test('3. a picture rail grows with its words: re-measured whenever a card\'s contents change size', () => {
  /* Measured at 200% Android text and the largest iOS size, the session
     stage text was cut mid-sentence: the rail had been sized once, for the
     text as it was then, and every card is clipped to it. */
  const wire = fnIn('wireCoachingRail');
  assert.match(wire, /new ResizeObserver\(function\(\)\{ measure\(\); \}\)/, 'nothing re-measures the rail when the words grow');
  /* The card's CONTENTS are watched, not the card: the cards are stretched
     to the rail, so watching them would re-measure on its own result. */
  assert.match(wire, /var kids = mods\[ri\]\.children \|\| \[\];/);
  assert.match(wire, /railRO\.observe\(kids\[rk\]\)/);
  assert.doesNotMatch(wire, /railRO\.observe\(mods\[/, 'the stretched card itself is watched, which loops');
  /* A phone without ResizeObserver keeps the two measurements it had. */
  assert.match(wire, /if \(typeof ResizeObserver === 'function'\)\{/);
});

test('2. a Full Plan week row reflows for its text instead of cutting the week\'s name', () => {
  /* At iOS xxxLarge the name read "WE..."; at AX1 it vanished and the date
     ran into "60/60". The figure columns are measured in the row's own text
     size, and a container query in em moves the figures and chevron, as a
     group, under the name when the row cannot hold them. */
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /\.view-plan \.pp-body \.week\{container:weekrow \/ inline-size;\}/);
  assert.match(bare, /\.view-plan \.pp-body \.week-pct\{font-size:var\(--fs-row\); flex:0 0 2\.4em;/);
  const wide = /@media \(min-width:375px\)\{\s*@container weekrow \(max-width:([\d.]+)em\)\{([\s\S]*?)\}\s*\}/.exec(bare);
  const narrow = /@media \(max-width:374px\)\{\s*@container weekrow \(max-width:([\d.]+)em\)\{([\s\S]*?)\}\s*\}/.exec(bare);
  assert.ok(wide && narrow, 'the row no longer reflows when its text outgrows it');
  [wide, narrow].forEach(m => {
    assert.match(m[2], /\.week-head\{flex-wrap:wrap; row-gap:2px;\}/);
    assert.match(m[2], /\.week-meta\{flex:1 0 100%;\}/, 'the name does not keep the first line');
    assert.match(m[2], /\.week-vol\{margin-left:auto;/, 'the figures do not move right as a group');
  });
  /* THE THRESHOLDS ARE THE MEASURED ONES, in the box's ems (the row text is
     15/16 of the box): 22 row-ems on a phone 375 and up, 18.5 below it. At
     the normal size every phone from 320 to 430 stays on one line. */
  assert.equal(Number(wide[1]), +(22 * 15 / 16).toFixed(1));
  assert.equal(Number(narrow[1]), +(18.5 * 15 / 16).toFixed(1));
  [[320, 288], [360, 328]].forEach(([w, box]) => assert.ok(box / 16 > Number(narrow[1]), w + 'px reflows at the normal size'));
  [[375, 343], [393, 361], [430, 398]].forEach(([w, box]) => assert.ok(box / 16 > Number(wide[1]), w + 'px reflows at the normal size'));
  /* And it does reflow where the audit found it broken. */
  assert.ok(361 / (16 * 1.235) < Number(wide[1]), 'iPhone 16 at xxxLarge stays on one line and cuts the name');
});
