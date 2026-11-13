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
