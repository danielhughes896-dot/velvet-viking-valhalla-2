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

test('arriving at THIS WEEK returns it to today, however you arrived', () => {
  /* Founder: "This week. When I swipe between nav screens - it should
     default back to today."
     weekSelectedDate latches the moment an athlete taps a day and nothing
     cleared it, so glancing at Friday, leaving the tab and coming back
     reopened on Friday -- the screen remembering a glance as though it were
     a choice. That is the same defect, in the same function, that the phase
     carousel directly above it was fixed for.
     NULL IS NOT A SPECIAL CASE: weekSelectedDay() already falls back to
     today when nothing is selected, so clearing the latch IS the default
     rather than a second rule about what the default should be. */
  const a = loadApp({ pinnedDate: '2026-03-10T09:00:00Z' });
  const body = fn('handleSetView');
  assert.match(body, /if \(view==='week'\)\{ weekSelectedDate = null; weekSessionOpen = false; \}/,
    'arriving at This Week no longer clears the day an athlete tapped');
  /* THE OPEN CARD GOES WITH IT, or the tab reopens on today with a card
     expanded -- neither where the athlete left it nor the default asked
     for. Named separately because dropping it is the easy half to forget. */
  assert.match(body, /weekSessionOpen = false/, 'the expanded card survives the reset');
  /* AND THE RE-TAP REDRAWS. Clearing the latch while already on the tab
     changes what is drawn, so the early return has to know about it -- the
     exact reason leftASubScreen and leftAPhase are computed before it. */
  assert.match(body, /leftASubScreen \|\| leftAPhase \|\| leftADay/,
    'the already-on-this-view return does not redraw after the day is cleared');
  assert.match(body, /var leftADay = \(view==='week'/,
    'nothing records that a day was cleared, so the redraw cannot be conditional');

  /* SWIPING COMES THROUGH THE SAME DOOR, which is the whole reason one
     change answers the gesture the founder described AND the tab tap. If
     the pager ever stops calling handleSetView, this reset silently stops
     applying to swipes and nothing else would say so. */
  /* One step removed since a swipe inside Full Plan can mean "back" rather
     than "another tab": pagerFinish() commits through pagerCommitTo(), and a
     tab change still goes through handleSetView(). */
  const commit = fn('pagerFinish');
  assert.match(commit, /pagerCommitTo\(/, 'the pager no longer commits through pagerCommitTo');
  assert.match(fn('pagerCommitTo'), /handleSetView\(p\.to\)/,
    'the pager no longer routes through handleSetView, so swiping skips every arrival reset');
  assert.ok(typeof a.weekSelectedDay === 'function', 'the fallback-to-today reader is gone');
});

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
  /* Naming the regions -- the coaching rail, the pace table -- is a list
     that is wrong the first time someone adds a third. The walk
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
  /* .pp-chips came off this list with the phase stepper. Its replacement
     needs no name here: the carousel is a [data-hswipe] region, which is
     the generic arm, and that is the point of having one. */
  /* READ AS TOKENS, NOT AS A STRING. This pinned the exact declaration text,
     so adding the pinch-zoom token -- which changes nothing about panning --
     failed it while the regions behaved identically. What it means to claim
     is that these regions pan sideways and not vertically, and (since zoom
     is a global guarantee now) that they still zoom. */
  const i = CSS.indexOf('.fuel-body, .pace-table-card, [data-hswipe]{touch-action:');
  assert.ok(i > -1, 'the horizontal regions lost their touch-action');
  const toks = CSS.slice(CSS.indexOf(':', i) + 1, CSS.indexOf(';', i)).trim().split(/\s+/);
  assert.ok(toks.indexOf('pan-x') !== -1 && toks.indexOf('pan-y') === -1,
    'the horizontal regions no longer pan sideways only: ' + toks.join(' '));
  assert.ok(toks.indexOf('pinch-zoom') !== -1,
    'the horizontal regions stopped allowing pinch-zoom: ' + toks.join(' '));
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

test('the commit is confirmed by a haptic, and it is the right one', () => {
  /* ---- REWRITTEN WITH THE FOUNDER'S HAPTIC TABLE ----
     "Swipe between main tabs: Very light tick." The tick now lives in the one
     haptic helper every confirmation uses; pagerHaptic() is that tick. */
  assert.match(fn('pagerHaptic'), /sacoroHaptic\('tick'\)/);
  const h = fn('sacoroHaptic');
  // iOS has no navigator.vibrate at all, so without the native path there
  // would be no haptic on the platform most likely to expect one.
  assert.ok(h.indexOf("nativePlugin('Haptics')") < h.indexOf('navigator.vibrate'),
    'the web vibrate is tried before the native haptic');
  /* THE TICK, PER PLATFORM, from @capacitor/haptics 8's own source. iOS's
     selection tick (UISelectionFeedbackGenerator, the lightest the platform
     has) only plays inside a started selection, so start/changed/end go
     together. On Android selectionChanged() is SILENT unless a selection was
     started, and when it does play it is a 100ms buzz -- so the old tab tick
     never played there at all. Android's tick is an 8ms vibrate. */
  const tick = h.slice(h.indexOf("kind === 'tick'"), h.indexOf("kind === 'light'"));
  const at = k => tick.indexOf('quiet(h.' + k);
  assert.ok(at('selectionStart') > -1 && at('selectionStart') < at('selectionChanged') && at('selectionChanged') < at('selectionEnd'),
    'the iOS tick is not inside a started selection');
  assert.match(tick, /nativePlatform\(\) === 'ios'/);
  assert.match(tick, /h\.vibrate\(\{ duration: 8 \}\)/, 'Android has no very light tick');
  /* AND THE ENUM STRINGS. @capacitor/haptics declares 'LIGHT', 'MEDIUM' and
     'SUCCESS'; 'Light' does not match natively and resolves to HEAVY. */
  assert.match(h, /style:'LIGHT'/); assert.match(h, /style:'MEDIUM'/); assert.match(h, /type:'SUCCESS'/);
  assert.doesNotMatch(h, /'Light'|'Medium'|'Success'/, 'a style is back to a value the plugin does not match');
  // These return promises; a rejection from a plugin that is present but
  // unavailable must not surface on a gesture nobody can see failing.
  assert.match(h, /var quiet = function\(p\)\{ if \(p && p\.catch\) p\.catch\(function\(\)\{\}\); \};/);
  assert.equal((h.match(/h\.(?:selectionStart|selectionChanged|selectionEnd|vibrate|impact|notification)\(/g) || []).length,
    (h.match(/quiet\(h\./g) || []).length, 'a haptic promise is left unhandled');
  assert.match(fn('pagerFinish'), /pagerHaptic\(\)/, 'the commit stopped confirming itself');
});

test('reduced motion gets the destination, not the journey', () => {
  const move = fn('pagerTouchMove');
  assert.match(move, /if \(p\.to && !p\.reduced\)\{\s*p\.peek = pagerBuildPeek/,
    'a reduced-motion reader now gets a sliding peek built for them');
  const finish = fn('pagerFinish');
  assert.match(finish, /if \(p\.reduced\)\{[\s\S]*?pagerCommitTo\(p\)/,
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

/* THE PEEK IS A SECOND MOUNT POINT, AND THE STYLESHEET HAS TO KNOW IT.
 * ===========================================================================
 * The neighbouring view is rendered into an element parked on document.body,
 * outside #view-mount. Every one of these three guards is a defect that
 * shipped: a view that looks like a different product while it is sliding is
 * worse than no gesture at all.
 */
test('no view-scoped rule is anchored on the #view-mount id', () => {
  /* An id anchor is invisible to the peek, and the failure is silent: the
     incoming page simply arrives wearing the styles the rule was written to
     remove. .view-host is carried by every host that mounts a view. */
  const offenders = CSS.split('\n').filter(l => /#view-mount\s+\./.test(l));
  assert.deepEqual(offenders.join(' | '), '',
    'a view-scoped rule is anchored on #view-mount, so the swipe peek escapes it');
  assert.match(CSS, /\.view-host \.view-today \.day,[\s\S]{0,160}background:none; border:0;/,
    'the focused-session card is no longer stripped by a host-scoped rule');
});

test('both hosts that mount a view carry .view-host', () => {
  /* It is told one thing now: whether the arrival is what is being drawn,
     so that screen is never faded in over itself. The class still comes from
     here and nowhere else. */
  assert.match(SRC, /id="view-mount" class="'\+viewMountClass\(arriving\)\+'"/,
    'the live mount no longer gets its class from viewMountClass()');
  assert.match(fn('viewMountClass'), /'view-fade view-host'/,
    'the live mount lost .view-host, so the view-scoped rules stop applying');
  assert.match(fn('pagerBuildPeek'), /<div class="wrap view-host">/,
    'the peek lost .view-host, so the incoming page renders unstyled');
});

test('a committed swipe does not then fade the destination in', () => {
  /* .view-fade runs a fadein on every render of #view-mount. After a slide
     that is a blink to the black ground and back, which reads as the screen
     resetting rather than as the transition landing. */
  const cls = fn('viewMountClass');
  assert.match(cls, /pagerSuppressFade \? 'view-host' : 'view-fade view-host'/,
    'the suppressed render no longer drops .view-fade');
  assert.match(cls, /pagerSuppressFade = false;\s*return cls;/,
    'the suppression is no longer one-shot, so an unrelated render can inherit it');
  const finish = fn('pagerFinish');
  assert.match(finish, /pagerSuppressFade = true;\s*\n\s*pagerCommitTo\(\{ to:to, back:back \}\);/,
    'the commit no longer suppresses the redundant fade');
});

test('a committed RAIL swipe does not fade either, for the same reason', () => {
  /* ---- THE ONE GESTURE THAT WAS STILL PAYING FOR ITS OWN TRANSITION ----
     Founder: "When you swipe the rails on this week and full plan - there is
     a little flash. It doesn't happen when moving between nav tabs."
     The law above covers the nav tabs; the day carousel on This Week and the
     phase carousel on Full Plan commit through wirePagerRail(), which
     re-renders via renderApp() and so took .view-fade -- a 180ms fadein from
     nothing on a slide the finger had already delivered. Measured by sampling
     document.getAnimations() every frame across a committed swipe: the frame
     the track is replaced was the frame "fadein@view-fade view-host" appeared.
     ORDER IS THE WHOLE POINT, so it is what is asserted. Raising the flag
     AFTER commit() would suppress nothing -- the render has already read it --
     and would still satisfy a test that only looked for the assignment. */
  const wired = fn('wirePagerRail');
  assert.match(wired, /pagerSuppressFade = true;/,
    'a committed rail swipe fades the screen in again');
  const raise = wired.indexOf('pagerSuppressFade = true;');
  const call = wired.indexOf('commit();');
  assert.ok(call > -1, 'wirePagerRail no longer commits, so this law reads nothing');
  assert.ok(raise > -1 && raise < call,
    'the suppression is raised after commit() runs, so the render has already faded');
  /* AND IT IS RAISED ONCE, IN THE PAGER, not per-rail: both rails go through
     this function, and a second copy in a planCommit would be a suppression
     that can drift out of step with the render it is for. */
  assert.equal((wired.match(/pagerSuppressFade = true;/g) || []).length, 1,
    'the rail raises the fade suppression more than once');
});

test('the destination renders under the peek, then the peek lifts', () => {
  /* Reversing these two paints the outgoing page back at centre for a frame. */
  const finish = fn('pagerFinish');
  const render = finish.indexOf('pagerCommitTo({ to:to, back:back });');
  const clean = finish.indexOf('pagerCleanup();', render);
  assert.ok(render > -1 && clean > render,
    'pagerCleanup() now runs before the destination is rendered');
  /* And the destination lands where the peek said it would. The peek is a
     fixed box anchored under the header, so it always shows the neighbour
     from its top; the views are nowhere near equal in height, so carrying a
     scroll offset across meant the browser clamped it to the new page's
     maximum and the slide ended somewhere other than where it was heading. */
  const scroll = finish.indexOf('window.scrollTo(0, 0);');
  assert.ok(scroll > render && scroll < clean,
    'the commit no longer lands the destination at the top, under the peek');
});

test('the live mount and the peek render a view identically', () => {
  /* The structural claim behind the guards above, checked against the markup
     rather than the stylesheet: the peek is handed the very same string. */
  assert.match(fn('pagerNeighbourHtml'), /return renderMainContent\(\);/,
    'the peek no longer renders the view through the same entry point');
  assert.match(fn('pagerNeighbourHtml'), /finally\{ state\.view = was; \}/,
    'the borrowed state.view is no longer restored, so a throw strands the view');
});

test('a backward swipe does not widen the layout viewport under the fixed nav', () => {
  /* #view-pager is IN FLOW, so translating it right -- which is what going
     back does -- pushes content past the right edge and creates real
     scrollable overflow. The browser answers by widening the layout
     viewport, and .bn-stack is position:fixed; bottom:0, so it follows that
     wider viewport below the visible screen: measured at innerHeight
     746 -> 778 mid-gesture, the nav dropping by exactly that 32px. Going
     forward never did it (leftward overflow is not scrollable) and the peek
     never did it (it is fixed), which is why only one direction broke. */
  assert.match(CSS, /body\.vv-paging #app\{overflow-x:clip;\}/,
    'the pager no longer clips the page it is translating, so the fixed nav will drop on a backward swipe');
  /* CLIP, NOT HIDDEN: overflow-x:hidden computes overflow-y to auto, which
     would turn #app into a nested scroller and break the page's scrolling. */
  assert.doesNotMatch(CSS, /body\.vv-paging #app\{overflow-x:hidden/,
    'overflow-x:hidden makes #app a nested scroll container');
  assert.match(fn('pagerBuildPeek'), /classList\.add\('vv-paging'\)/,
    'the clip is never switched on, so the rule is inert');
  const cleanup = fn('pagerCleanup');
  assert.match(cleanup, /classList\.remove\('vv-paging'\)/,
    'the clip is never switched off, so the page stays clipped after a swipe');
  /* Removed BEFORE the early return: a cleanup that bails on a missing
     pagerState would otherwise leave the body clipped for good. */
  assert.ok(cleanup.indexOf("classList.remove('vv-paging')") < cleanup.indexOf('if (!p) return;'),
    'the clip is only cleared on the happy path, so a bailed-out cleanup leaves the page clipped');
});

test('a committed swipe costs a fraction of the screen, not most of it', () => {
  /* The page tracks the finger the whole way, so a threshold that is too far
     reads as the swipe having FAILED rather than as never having been asked
     for: you drag most of the phone's width, watch the next screen arrive,
     and then watch it leave again. The numbers live beside the other pager
     constants rather than inside the handler so this is tunable without
     reading the gesture code. */
  assert.match(SRC, /var PAGER_COMMIT_FRACTION = 0\.13;/,
    'the distance a swipe must travel to commit changed');
  const end = fn('pagerTouchEnd');
  assert.match(end, /Math\.abs\(dx\) > p\.w \* PAGER_COMMIT_FRACTION/,
    'the commit distance is hand-written in the handler again');
  assert.match(end, /Math\.abs\(p\.vx\) > PAGER_FLING_VX && Math\.abs\(dx\) > PAGER_FLING_PX/,
    'the flick path is hand-written in the handler again');
  /* Distance OR flick -- a slow deliberate drag and a quick one are both
     ways of asking, and losing either makes the gesture feel arbitrary. */
  assert.match(end, /\(far \|\| fast\)/, 'the two ways of committing stopped being an OR');
  /* ...and the direction still has to agree with the page being revealed, or
     a drag back past the start would commit the screen it was leaving. */
  assert.match(end, /forward && \(far \|\| fast\)/,
    'a swipe that reverses past its start can now commit the wrong view');
});

/* A WEEK SWIPES BACK TO THE PLAN.
 * ===========================================================================
 * Founder: "When viewing a week on full plan you cannot swipe out of it back
 * to the previous screen."
 * A week and a session are screens inside Full Plan with a back arrow; a
 * sideways swipe on them used to be read as "the tab before Full Plan".
 */
function planApp(){
  const { buildPlan } = require('./fixtures.js');
  const a = loadApp({ pinnedDate: '2026-11-12T09:00:00Z' });
  a.renderApp = () => {}; a.showToast = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-02' });
  return a;
}
/* One swipe through the pager's own handlers, under reduced motion so no
   peek is built and the commit is immediate. */
function drag(a, dx, dy){
  const calls = [];
  a.handlePlanBack = () => calls.push('back');
  a.handleSetView = v => calls.push('view:' + v);
  a.pagerState = { x0: 100, y0: 300, t0: 0, axis: null, claimed: false,
    mount: { classList: { add(){}, remove(){} }, style: {} }, peek: null, dir: 0, to: null,
    w: 390, reduced: true, lastX: 100, lastT: -1, vx: 0 };
  a.pagerTouchMove({ touches: [{ clientX: 100 + dx, clientY: 300 + (dy || 0) }], cancelable: true, preventDefault(){} });
  a.pagerTouchEnd();
  return calls;
}
test('inside Full Plan a swipe right is back one level, and a swipe left goes nowhere', () => {
  const a = planApp();
  a.state.view = 'full';
  a.planWeekOpen = 3; a.planSessionOpen = null;
  assert.equal(a.planSubScreenOpen(), true);
  assert.deepEqual(drag(a, 150), ['back'], 'a swipe right on a week went somewhere other than back');
  assert.deepEqual(drag(a, -150), [], 'a swipe left on a week left the tab');
  assert.deepEqual(drag(a, 20), [], 'a drag short of the threshold went back');
  assert.deepEqual(drag(a, 20, 200), [], 'a scroll went back');
  /* A session is a level deeper, and goes back the same way -- whether it
     was reached through its week or straight from the plan. */
  a.planSessionOpen = a.state.days.filter(d => d.week === 3 && d.type !== 'rest')[0].id;
  assert.deepEqual(drag(a, 150), ['back']);
  a.planWeekOpen = null;
  assert.equal(a.planSubScreenOpen(), true, 'a session opened from the plan is not a screen inside it');
  assert.deepEqual(drag(a, 150), ['back']);
  assert.deepEqual(drag(a, -150), []);
  /* On the plan itself, and on every other tab, a swipe is still a tab change. */
  a.planWeekOpen = null; a.planSessionOpen = null;
  assert.equal(a.planSubScreenOpen(), false);
  assert.deepEqual(drag(a, 150), ['view:week']);
  assert.deepEqual(drag(a, -150), ['view:planhq']);
  a.state.view = 'week'; a.planWeekOpen = 3;
  assert.equal(a.planSubScreenOpen(), false, 'an open plan week leaked onto This Week');
  assert.deepEqual(drag(a, 150), ['view:today']);
});

test('the animated swipe goes back too, not only the reduced-motion one', () => {
  const a = planApp();
  a.state.view = 'full'; a.planWeekOpen = 3;
  const calls = [];
  a.handlePlanBack = () => calls.push('back');
  a.handleSetView = v => calls.push('view:' + v);
  a.window.setTimeout = f => f(); a.window.scrollTo = () => {};
  const el = () => ({ classList: { add(){}, remove(){} }, style: {}, offsetWidth: 1 });
  a.pagerState = { claimed: true, peek: el(), mount: el(), dir: -1, w: 390, to: 'full', back: true, reduced: false };
  a.pagerFinish(true);
  assert.deepEqual(calls, ['back'], 'the sliding commit changed tab instead of going back');
  a.pagerState = { claimed: true, peek: el(), mount: el(), dir: -1, w: 390, to: 'week', back: false, reduced: false };
  a.pagerFinish(true);
  assert.deepEqual(calls, ['back', 'view:week'], 'the sliding commit no longer changes tab');
});

test('back is the arrow: one level, session to week to plan', () => {
  const a = planApp();
  a.state.view = 'full';
  const s = a.state.days.filter(d => d.week === 3 && d.type !== 'rest')[0].id;
  a.handlePlanOpenWeek(3); a.handlePlanOpenSession(s);
  const real = a.handlePlanBack;
  assert.deepEqual(drag(a, 150), ['back']);
  real(); assert.deepEqual([a.planWeekOpen, a.planSessionOpen], [3, null], 'back from a session left the week');
  assert.deepEqual(drag(a, 150), ['back']);
  real(); assert.deepEqual([a.planWeekOpen, a.planSessionOpen], [null, null]);
  assert.match(fn('pagerCommitTo'), /if \(p\.back\)\{ handlePlanBack\(\); return; \}/, 'the swipe and the arrow are two different doors');
});

test('the screen revealed underneath is the one the swipe returns to, and nothing is left changed', () => {
  const a = planApp();
  a.state.view = 'full';
  const s = a.state.days.filter(d => d.week === 3 && d.type !== 'rest')[0].id;
  a.planWeekOpen = 3; a.planSessionOpen = s;
  const under = a.pagerPlanParentHtml();
  assert.match(under, /class="view-plan-week view-week"/, 'a session did not reveal its week');
  assert.deepEqual([a.planWeekOpen, a.planSessionOpen], [3, s], 'drawing the screen underneath moved the athlete');
  a.planSessionOpen = null;
  const plan = a.pagerPlanParentHtml();
  assert.doesNotMatch(plan, /view-plan-week|view-plan-session/, 'a week did not reveal the plan');
  assert.equal(a.planWeekOpen, 3);
  assert.match(fn('pagerTouchMove'), /p\.peek = pagerBuildPeek\(p\.to, p\.dir, p\.back \? pagerPlanParentHtml\(\) : null\);/);
});

test('Android\'s back is the arrow too, inside Full Plan', () => {
  const a = planApp();
  let listener = null, minimised = 0, back = 0;
  a.nativeAppPlugin = () => ({ addListener: (n, f) => { if (n === 'backButton') listener = f; }, minimizeApp: () => { minimised++; } });
  a.window.__vvvBackButtonBound = false;
  a.handlePlanBack = () => { back++; };
  a.initHardwareBackButton();
  assert.ok(listener, 'no back listener was registered');
  a.state.view = 'full'; a.planWeekOpen = 3;
  listener();
  assert.deepEqual([back, minimised], [1, 0], 'back inside a plan week sent the app to the background');
  a.planWeekOpen = null;
  listener();
  assert.deepEqual([back, minimised], [1, 1], 'back on the plan itself no longer minimises');
});
