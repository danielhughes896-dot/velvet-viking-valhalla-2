'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { RUNTIME_RELATIVE } = require('./harness.js');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// SACORO -- SESSION BREAKDOWN + DAILY CARD ELEVATION.
//
// .day is the ONE shared render primitive behind every daily/session card in
// the app: renderDayCard() is called from Today, from This Week/Full Plan's
// week accordion, and from the single-card patch path that redraws a card in
// place after a toggle. Elevating .day's own CSS rule is therefore the
// correct place to add "very slightly above the page" depth everywhere at
// once, rather than restyling each view independently -- these tests hold
// that the elevation lives on the shared rule (so it can never drift between
// views).
//
// UPGRADED from --shadow-sm alone to --tile-shadow/--tile-sheen -- the same
// premium soft-raised recipe Sacoro, Coach, Settings and Zone Breakdown
// already use, and still not a new shadow system: --tile-shadow IS
// --shadow-sm plus one restrained inset highlight, so the base depth these
// tests originally asserted is still present, just no longer the whole
// story.

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

// .day also has a @media print override earlier in the sheet
// (background:#fff !important, no border-left) -- walk every occurrence and
// return the screen rule, identified by carrying the semantic left border.
function ruleFor(sel) {
  let i = 0;
  for (;;) {
    i = CODE.indexOf(sel + '{', i);
    assert.ok(i !== -1, 'no screen rule found for ' + sel);
    const open = i + sel.length + 1;
    const body = CODE.slice(open, CODE.indexOf('}', open));
    if (sel !== '.day' || /border-left/.test(body)) return body;
    i = open;
  }
}

test('the shared .day rule carries the same soft-raised tile depth as the rest of the app', () => {
  const rule = ruleFor('.day');
  assert.match(rule, /box-shadow\s*:\s*var\(--tile-shadow\)/,
    'the base card must reuse the existing shared tile-elevation token');
  assert.match(rule, /background\s*:\s*var\(--tile-sheen\)\s*,\s*var\(--surface-3\)/,
    'the sheened top edge, layered over the SAME background colour, not a different one');
  // The semantic type colour is untouched by this pass, and still is.
  assert.match(rule, /border-left\s*:\s*4px solid var\(--c-rest\)/);
  /* THE RADIUS MOVED, AND BY A LATER PASS THAN THIS ONE. The line above used
     to read --radius-sm and was written here as a "the elevation pass did not
     touch the radius" guard, not as a ruling that a day card is 10px. The
     card-radius standardisation (HQ visual consistency approval) is the pass
     that moved it: .hub-card rendered 10px bare and 16px with .tile-card, and
     .day was the third value again. All three are now --radius. The elevation
     assertions above are the ones this file exists for and are unchanged. */
  assert.match(rule, /border-radius\s*:\s*var\(--radius\)/);
  /* And the type rail now has a transparent twin on the right, so the card's
     CONTENT is centred rather than sitting 4px left of centre -- measured at
     L45/R41 on the logging drawer of every day card before this. */
  assert.match(rule, /border-right\s*:\s*4px solid transparent/);
});

test('today and drag-over states keep the base elevation alongside their own ring, never replace it', () => {
  const today = ruleFor('.day.is-today');
  assert.match(today, /var\(--tile-shadow\)/);
  assert.match(today, /var\(--gold\) inset/);
  const dragOver = ruleFor('.day.drag-over');
  assert.match(dragOver, /var\(--tile-shadow\)/);
  assert.match(dragOver, /var\(--bronze\) inset/);
});

test('the tune-up/race semantic fill keeps the same sheen as every other day', () => {
  const tuneup = ruleFor('.day.type-tuneup');
  assert.match(tuneup, /background\s*:\s*var\(--tile-sheen\)\s*,\s*var\(--c-gold-soft\)/,
    'a tune-up/race day must not read flatter than an ordinary one');
  const race = ruleFor('.day.type-race');
  assert.match(race, /background\s*:\s*var\(--tile-sheen\)\s*,\s*var\(--c-gold-soft\)/);
});

test('renderDayCard() is the single function behind Today, This Week/Full Plan and the single-card patch path', () => {
  assert.equal((CODE.match(/function renderDayCard\(/g) || []).length, 1,
    'there must be exactly one day-card renderer for the elevation to reach every view');
  // Every call site renders the same .day-carrying markup -- confirmed by
  // exercising the function directly rather than grepping call sites, which
  // says nothing about what actually reaches the screen.
  const a = loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });
  buildPlan(a, { weeks: 4, startDate: a.addDays('2026-03-11', -7), distanceKey: 'half', volume: 40 });
  const dd = a.state.days.find(d => d.type !== 'rest');
  const html = a.renderDayCard(dd);
  assert.match(html, /^<div class="day /, 'the card must be built on the shared .day shell');
});
