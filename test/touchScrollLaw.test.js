'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* A REGION MAY ONLY REFUSE THE VERTICAL PAN IF IT ACTUALLY SCROLLS SIDEWAYS.
 * ===========================================================================
 * THE FAULT. Opening a session on This Week produced a screen that could not
 * be scrolled with a finger. Measured in Chromium at 412x915 with the full
 * card open: 2137px of card, 1861px of page still to scroll, and a touch drag
 * starting anywhere on the card moved it 0px. A mouse wheel over the same
 * pixel moved it 600px.
 *
 * That gap is the whole reason this went unfound for so long, and it is worth
 * stating plainly: touch-action is honoured for TOUCH input and ignored by
 * the wheel and by scrollTo(). Every desktop probe reported a healthy,
 * fully scrollable page, and every one of them was asking the wrong question.
 *
 * THE CAUSE. [data-hswipe]{touch-action:pan-x} is the default handed to any
 * region that wants the horizontal gesture. pan-x means "you may pan this
 * subtree horizontally and NOT vertically", so applying it to a 2137px card
 * refuses every finger that lands on the card -- which, at that height, is
 * every finger.
 *
 * WHY THE OVERRIDE IS FREE. data-hswipe is what the view pager checks, and it
 * is an ATTRIBUTE: the pager stands down whether the touch-action is pan-x or
 * pan-y. Both gesture handlers are registered { passive: true } and never
 * call preventDefault -- they watch the touch and commit on touchend -- so
 * neither ever needed the browser to withhold the vertical pan. With pan-y
 * the same drag on the same pixel moves 570px and the horizontal swipe still
 * changes day.
 *
 * WHAT THIS FILE HOLDS. The two overrides, and the two facts that make them
 * load-bearing: the default is still pan-x, and both regions still carry the
 * attribute that would otherwise hand them pan-x. If any one of those four
 * drifts, the screen quietly stops scrolling on a phone and keeps scrolling
 * on every machine a developer owns.
 */
const ROOT = path.join(__dirname, '..');
const RUNTIME = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

function app(){
  const a = loadApp({ pinnedDate: '2026-11-06T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-09-04', distanceKey: 'full',
    volume: 46, lthr: 165, maxHR: 190,
    schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  return a;
}

test('the pan-x default is still what the overrides are overriding', () => {
  /* If this ever becomes pan-y on its own, the two rules below stop being
     load-bearing and should be deleted rather than left as decoration. */
  assert.match(RUNTIME, /\[data-hswipe\]\{touch-action:pan-x;\}/,
    'the horizontal-region default changed; re-read the two overrides below');
});

test('the open week session lets the page scroll vertically', () => {
  assert.match(RUNTIME, /\.wk-session\.is-open\[data-hswipe\]\{touch-action:pan-y;\}/,
    'This Week’s open session takes pan-x again -- the card cannot be ' +
    'scrolled past on a phone, and no mouse will ever show it');
});

test('the coaching stack outside a focused session lets the page scroll', () => {
  /* Outside the focused views .how-mod is display:contents, so .fuel-body is
     not a sideways rail at all -- it is a tall vertical stack of coaching
     rows, and pan-x over it blocks the page exactly as it did on the week
     card. The focused copy has carried its own pan-y for a long time. */
  assert.match(RUNTIME, /\.how-card \.fuel-body\[data-hswipe\]\{touch-action:pan-y;\}/,
    'the unfocused coaching stack takes pan-x again');
  assert.match(RUNTIME, /\.how-mod\{display:contents;\}/,
    'the unfocused rail is no longer a vertical stack -- re-check the rule above');
});

test('both regions still carry the attribute the overrides key off', () => {
  /* A selector that matches nothing passes every string check and protects
     nothing, so the markup is asserted too. */
  const a = app();
  const w = a.currentWeekNum();
  a.weekSessionOpen = true;
  const open = a.renderWeekSessionBox(w);
  assert.match(open, /class="wk-session is-open" data-hswipe="1"/,
    'the open week session no longer matches .wk-session.is-open[data-hswipe]');
  assert.match(RUNTIME, /class="fuel-body" data-hswipe="1"/,
    'the coaching stack no longer matches .how-card .fuel-body[data-hswipe]');
});

/* A GESTURE BELONGS TO THE INNERMOST THING THAT WANTS IT.
 * ===========================================================================
 * Swiping the coaching rail inside an open session on This Week changed the
 * DAY instead of moving the rail. Both handlers were seeing the same touch:
 * the rail calls preventDefault but never stopPropagation, so its swipes
 * bubbled to .wk-session.is-open, which commits a day change at 13% of screen
 * width -- about 54px on a phone, where the rail moves its focus one module
 * per 26px. So an ordinary two-module swipe also flipped the day and
 * re-rendered the card mid-gesture.
 *
 * Measured at 412x915, a 200px horizontal drag on the rail:
 *   before  day "Goal Pace Block 11.5km" -> "Easy Aerobic",  rail 0 -> 0
 *   after   day unchanged,                                   rail 0 -> 1
 */
test('the day pager stands down for a gesture that starts inside the rail', () => {
  const fn = RUNTIME.slice(RUNTIME.indexOf('function wireWeekFullSwipe('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(RUNTIME, /function weekSwipeOwnedInside\(node, card\)/,
    'the ownership check is gone; the rail and the day pager share a swipe again');
  assert.match(body, /inner = weekSwipeOwnedInside\(e\.target, card\)/,
    'the card no longer asks who owns the gesture when the finger lands');
  assert.match(body, /if \(inner \|\| decided/,
    'touchmove no longer stands down for the rail');
  assert.match(body, /if \(inner \|\| !claimed/,
    'touchend no longer stands down for the rail -- the day still flips under the rail');
});

test('the ownership walk stops at the card, or the day swipe dies silently', () => {
  /* .wk-session.is-open carries data-hswipe ITSELF -- that attribute is what
     makes the PAGE pager stand down for it. A walk that did not stop at the
     card would find the card's own attribute, answer "owned inside" for every
     touch, and the day swipe would never fire again. Nothing else in the
     suite would notice, so it is asserted here. */
  const fn = RUNTIME.slice(RUNTIME.indexOf('function weekSwipeOwnedInside('));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /el !== card/,
    'the walk no longer stops at the card, so every swipe reads as owned inside');
  assert.match(body, /hasAttribute\('data-hswipe'\)/,
    'the walk no longer looks for the attribute that marks an inner region');
  /* And the rail it protects still carries that attribute. */
  assert.match(RUNTIME, /class="fuel-body" data-hswipe="1"/,
    'the coaching rail no longer advertises that it owns the sideways gesture');
});
