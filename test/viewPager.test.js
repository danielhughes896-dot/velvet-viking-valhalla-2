'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* SWIPING BETWEEN THE MAIN TABS.
 * ===========================================================================
 * An accelerator laid on top of the bottom nav, never a replacement for it:
 * nothing here is the only route to anything, so no one has to discover a
 * gesture to use the app. These are the rules that make it feel like the
 * platform rather than like a web page, and each is easy to undo by accident.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const fn = name => {
  const m = new RegExp('function ' + name + '\\([^)]*\\)\\{[\\s\\S]*?\\n\\}').exec(SRC);
  assert.ok(m, name + ' is gone');
  return m[0];
};

test('the swipe order IS the bottom nav order, taken from the same five keys', () => {
  // A second ordering of the tabs would be a second answer to "what is next
  // to what", and the two would drift. The nav is the source.
  const a = loadApp({ pinnedDate: '2026-03-10T09:00:00Z' });
  const nav = [...SRC.matchAll(/\{key:'([a-z]+)', label:'[^']*', icon:ICONS\./g)].map(m => m[1]);
  /* join(','), not deepEqual: PAGER_VIEWS comes out of the harness's VM
     sandbox, so it is an Array from another realm and assert's deepEqual
     refuses it however identical the contents are. */
  assert.equal(a.PAGER_VIEWS.join(','), nav.join(','),
    'the pager and the bottom nav disagree about the order of the tabs');
  assert.equal(nav.length, 5);
});

test('the ends do not wrap', () => {
  /* A tab bar has ends. Coming round from Settings to Today loses people --
     they cannot tell whether they went forward or back. The index is bounded
     and there is no modulo anywhere near it. */
  const move = fn('pagerTouchMove');
  assert.match(move, /next >= 0 && next < PAGER_VIEWS\.length/,
    'the neighbour is no longer bounds-checked');
  assert.doesNotMatch(move, /%\s*PAGER_VIEWS\.length/, 'the tabs wrap again');
  // ...and at an end the drag is damped rather than free, so the screen says
  // "nothing here" by feeling like it.
  assert.match(move, /p\.to \? dx : dx \* 0\.2/, 'the end-of-list resistance is gone');
});

test('a horizontal region owns its own gesture, and the rule is generic', () => {
  /* Naming the regions -- the coaching rail, the phase chips, the pace table
     -- is a list that is wrong the first time someone adds a fourth. The walk
     up from the touched node asks the only question that matters: is anything
     above me actually scrollable sideways right now? */
  const owned = fn('pagerOwnedElsewhere');
  assert.match(owned, /overflowX/, 'the ownership test stopped reading overflow');
  assert.match(owned, /scrollWidth > el\.clientWidth \+ 1/,
    'a region that CANNOT scroll now claims the gesture anyway');
  assert.match(owned, /data-hswipe/, 'the opt-in attribute for non-scrolling regions is gone');
  assert.doesNotMatch(owned, /fuel-body|pp-chips|pace-table/,
    'the ownership test went back to naming specific classes');
  // and the same regions say so in CSS, so the browser pans them natively
  assert.match(CSS, /\.fuel-body, \.pp-chips, \.pace-table-card, \[data-hswipe\]\{touch-action:pan-x;\}/,
    'the horizontal regions lost their touch-action');
});

test('vertical intent wins, and keeps winning for the whole gesture', () => {
  const move = fn('pagerTouchMove');
  // Nothing is decided until the finger has an intention...
  assert.match(move, /Math\.abs\(dx\) < PAGER_CLAIM_PX && Math\.abs\(dy\) < PAGER_CLAIM_PX/,
    'the pager claims before the gesture has a direction');
  // ...and horizontal has to clearly beat vertical, not merely tie.
  assert.match(move, /Math\.abs\(dx\) > Math\.abs\(dy\) \* PAGER_AXIS_BIAS/,
    'a diagonal can now switch tabs');
  const bias = Number(/var PAGER_AXIS_BIAS = ([\d.]+)/.exec(SRC)[1]);
  assert.ok(bias > 1, 'the axis bias is ' + bias + ' -- horizontal no longer has to win clearly');
  // Once vertical wins the gesture is released and cannot be re-claimed.
  assert.match(move, /if \(p\.axis === 'y'\)\{ pagerState = null; return; \}/,
    'a gesture that started vertical can drift into a tab change');
});

test('nothing is prevented until the gesture is claimed, and then it must be', () => {
  /* The listener has to be non-passive or preventDefault cannot cancel the
     pan -- but nothing is prevented before the claim, which is what keeps
     vertical scrolling native and immediate. */
  const init = fn('initViewPager');
  assert.match(init, /'touchmove', pagerTouchMove, \{ passive:false \}/,
    'touchmove went passive -- the horizontal pan can no longer be cancelled');
  assert.match(init, /'touchstart', pagerTouchStart, \{ passive:true \}/,
    'touchstart went non-passive for no reason');
  assert.match(init, /initViewPager\.done/, 'the listeners can be bound twice now');
  const move = fn('pagerTouchMove');
  const claimAt = move.indexOf('p.claimed = true');
  const preventAt = move.indexOf('preventDefault');
  assert.ok(claimAt > -1 && preventAt > claimAt,
    'preventDefault happens before the gesture is claimed, which kills vertical scrolling');
});

test('the transition tracks the finger rather than queueing', () => {
  const move = fn('pagerTouchMove');
  assert.match(move, /pagerSetOffset\(moved\)/, 'the page no longer follows the touch');
  const offset = fn('pagerSetOffset');
  assert.match(offset, /translate3d/, 'the drag stopped using a compositor transform');
  assert.match(offset, /p\.dir > 0 \? p\.w : -p\.w/,
    'the revealed screen is no longer positioned beside the current one');
  // No transition during the drag -- one would fight the finger. It is added
  // only for the settle.
  assert.match(CSS, /\.view-pager\.is-settling, \.view-peek\.is-settling\{\s*transition:transform/,
    'the settle lost its transition, or the drag gained one');
  // The screen revealed is built by the same renderer that will draw it.
  const nb = fn('pagerNeighbourHtml');
  assert.match(nb, /renderMainContent\(\)/, 'the peek uses a second render path');
  assert.match(nb, /finally\{ state\.view = was; \}/,
    'the borrowed view is not restored -- a failed render would strand the app on the wrong tab');
});

test('the commit is confirmed by a haptic, native first', () => {
  const h = fn('pagerHaptic');
  // iOS has no navigator.vibrate at all, so without the native path there
  // would be no haptic on the platform most likely to expect one.
  assert.ok(h.indexOf("nativePlugin('Haptics')") < h.indexOf('navigator.vibrate'),
    'the web vibrate is tried before the native haptic');
  assert.match(fn('pagerFinish'), /pagerHaptic\(\)/, 'the commit stopped confirming itself');
});

test('reduced motion gets the destination, not the journey', () => {
  const move = fn('pagerTouchMove');
  assert.match(move, /if \(p\.to && !p\.reduced\)\{\s*p\.peek = pagerBuildPeek/,
    'a reduced-motion reader now gets a sliding peek built for them');
  const finish = fn('pagerFinish');
  assert.match(finish, /if \(p\.reduced\)\{[\s\S]*?handleSetView/,
    'reduced motion no longer takes the direct path');
  assert.match(CSS, /prefers-reduced-motion: reduce\)\{\s*\.view-pager\.is-settling/,
    'the settle transition is not disabled under reduced motion');
});

test('the pager stands down for sheets, onboarding and a locked nav', () => {
  const start = fn('pagerTouchStart');
  assert.match(start, /document\.querySelector\('\.modal-overlay'\)/,
    'a swipe can now navigate out from under an open sheet');
  assert.match(start, /appStateAllowsNav\(\)/, 'the nav lock no longer applies to gestures');
  assert.match(start, /shouldShowProgrammeEntry/, 'a swipe can escape the programme entry');
  assert.match(start, /e\.touches\.length !== 1/, 'a two-finger pinch is treated as a swipe');
});

test('the pager is inert in a DOM that answers nothing', () => {
  const a = loadApp({ pinnedDate: '2026-03-10T09:00:00Z' });
  assert.doesNotThrow(() => a.initViewPager());
  assert.doesNotThrow(() => a.pagerFinish(false));
  assert.equal(a.pagerOwnedElsewhere(null), false);
});
