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

test('5. the Coach graph names scroll inside their row instead of widening the page', () => {
  /* At 200% Android text the five names were wider than a 360px phone and
     laid the whole Coach page out at 485px, every panel cut at the right. */
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /\.cg-tabs\{column-gap:8px; overflow-x:auto; overscroll-behavior-x:contain; scrollbar-width:none;\}/);
  assert.match(bare, /\.cg-tabs::-webkit-scrollbar\{display:none;\}/);
  /* The 8px floor costs nothing at the normal size: the five measured 241px
     of names in a 288px row on a 320px phone, and 303 of 343 at 375. */
  assert.ok(241 + 4 * 8 <= 288 && 303 + 4 * 8 <= 343);
  /* And the chosen graph's name is brought into view when it changes. */
  assert.match(fnIn('handleCoachGraph'), /if \(t2\)\{ t2\.scrollLeft = keep; cgTabInView\(t2\); \}/);
  assert.match(fnIn('cgTabInView'), /if \(!on \|\| tabs\.scrollWidth <= tabs\.clientWidth \+ 1\) return;/, 'it moves the names when they all fit');
});

test('5. a figure is drawn small enough for its circle, and only when it would not fit', () => {
  const { loadApp } = require('./harness.js');
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  const kid = (w, h) => {
    const b = { getBoundingClientRect: () => ({ width: w }) };
    return { style: {}, offsetHeight: h, firstElementChild: b };
  };
  const medal = (W, H, kids) => ({ clientWidth: W, clientHeight: H, children: kids });
  const fits = medal(68, 68, [kid(40, 30)]);
  const wide = medal(68, 68, [kid(64, 40)]);
  const tall = medal(68, 68, [kid(40, 40), kid(30, 30)]);
  a.document = { querySelectorAll: () => [fits, wide, tall] };
  a.fitDialValues();
  assert.equal(fits.children[0].style.transform, '', 'a figure that fits was touched');
  assert.equal(wide.children[0].style.transform, 'scale(' + (68 * a.DIAL_FIT_ROOM / 64).toFixed(3) + ')');
  const r = (68 * a.DIAL_FIT_ROOM / 70).toFixed(3);
  assert.deepEqual(tall.children.map(k => k.style.transform), ['scale(' + r + ')', 'scale(' + r + ')'], 'a face whose lines are too tall is not fitted as one');
  /* Run again at a size where it fits: the old scale comes off. */
  wide.children[0].firstElementChild.getBoundingClientRect = () => ({ width: 30 });
  a.fitDialValues();
  assert.equal(wide.children[0].style.transform, '');
});

test('5. fitted after every render, every panel, every size or text-size change', () => {
  assert.match(RT, /try \{ easeDials\(\); \} catch\(e\)\{\}\n  try \{ fitDialValues\(\); \} catch\(e\)\{\}/, 'not fitted after a render');
  const om = fnIn('openModal');
  assert.equal((om.match(/try \{ fitDialValues\(\); \} catch\(e\)\{\}/g) || []).length, 2, 'a panel opened or redrawn in place is not fitted');
  assert.match(fnIn('applyDynamicType'), /fitDialValues\(\);/, 'an iOS text-size change is not fitted');
  assert.match(RT, /window\.addEventListener\('resize', function\(\)\{ fitDialValues\(\); \}\)/);
  assert.match(RT, /document\.fonts\.ready\.then\(fitDialValues\)/);
});

test('7. every small control takes a 44px tap without being drawn bigger', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  /* The week's seven day circles: an invisible 44px disc centred on each. */
  assert.match(bare, /\.wk-day::before\{content:''; position:absolute; left:50%; top:50%;\s*width:max\(100%, var\(--tap-min\)\); height:max\(100%, var\(--tap-min\)\);\s*transform:translate\(-50%,-50%\); border-radius:50%;\}/);
  /* The phase dots: 34px buttons, 44px bands. */
  assert.match(bare, /\.pp-dot::after\{content:''; position:absolute; left:0; right:0; top:50%;\s*height:var\(--tap-min\); transform:translateY\(-50%\);\}/);
  /* The graph names reach 9px either side: DRIFT, 28px at 320, is 46. */
  assert.match(bare, /\.cg-tab::after\{content:''; position:absolute; top:0; bottom:0; left:-9px; right:-9px;\}/);
  assert.ok(28 + 2 * 9 >= 44);
  /* KM and MI: a clipped pill cannot reach past itself, so each half is 44. */
  assert.match(bare, /\.stg-row-units \.tb-unit-toggle button\{font-size:13\.5px; padding:0 10px;\s*min-width:var\(--tap-min\);\}/);
  /* The builder's weekday circles: the box that takes the tap is centred
     on the circle and at least 44px. */
  assert.match(bare, /\.field \.wd-check input\{\s*position:absolute; left:50%; top:50%; transform:translate\(-50%,-50%\);\s*width:max\(100%, var\(--tap-min\)\); height:max\(100%, var\(--tap-min\)\); margin:0;/);
  /* The flat heart-rate and benchmark fields: back to 44 tall. */
  assert.match(bare, /\.benchmark-row > \.field input\{min-height:var\(--tap-min\);\}/);
  /* The two the audit's box measure flagged that were already 44 by a band
     of their own -- Injured or ill and the switches -- keep them. */
  assert.match(bare, /\.coach-why-btn::after\{[^}]*height:44px/);
  assert.match(bare, /\.switch::after\{[^}]*width:var\(--tap-min\); height:var\(--tap-min\)/);
});
