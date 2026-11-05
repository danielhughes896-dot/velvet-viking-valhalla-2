'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* TODAY: THE SESSION IS THE HERO, AND THE COACHING IS A RAIL.
 * ===========================================================================
 * Two things happened to the focused session screen and this file protects
 * both, because both are easy to undo by accident.
 *
 * 1. THE HERO LOST ITS CARD. It was a hairline frame holding two inset
 *    tiles, each with its own fill and border: three nested rectangles
 *    around one number and one ring. The metric carries its own backlight
 *    and the ring its own glow, so the light that was always there now has
 *    nothing competing with it. A card creeping back is the regression.
 *
 * 2. HOW TO RUN THIS BECAME A RAIL. Six coaching modules stacked inside one
 *    tall bordered card meant scrolling past four of them to reach the
 *    Coach's Note. They are now swipeable panels, lit rather than boxed.
 *
 * THE INVARIANT UNDERNEATH BOTH is that renderDayCard() still emits ONE
 * string for all three views. The rail needed a wrapper per module, so the
 * wrapper is emitted everywhere and is display:contents outside a focused
 * session -- in the DOM, absent from layout. If that rule is ever lost,
 * This Week and Full Plan's list silently gain six stray block boxes.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const FOCUS = ':is(.view-today .day.is-today, .view-week .wk-full .day, .view-plan-session .day)';

// The focused-session rule for a selector, with its comments already gone.
function focusRule(sel) {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const needle = FOCUS + ' ' + sel + '{';
  const i = bare.indexOf(needle);
  assert.ok(i > -1, 'no focused-session rule for ' + sel);
  return bare.slice(i + needle.length, bare.indexOf('}', i));
}
function app() {
  const a = loadApp({ pinnedDate: '2026-03-10T09:00:00Z' });
  buildPlan(a);
  return a;
}
function todayCard(a) {
  const dd = a.state.days.find(d => d.date === a.todayStr()) || a.state.days[0];
  return a.renderDayCard(dd);
}

// ---------------------------------------------------------------------------
test('every coaching module is named, once, in the one string all three views share', () => {
  const a = app();
  const dd = a.state.days.find(d => d.type !== 'rest' && d.km > 0);
  const html = a.renderDayCard(dd);
  const keys = [...html.matchAll(/class="how-mod" data-mod="([a-z]+)"/g)].map(m => m[1]);
  assert.ok(keys.length >= 3, 'expected several coaching modules, found ' + keys.length);
  // Order is the coaching order and is not incidental: why it exists, how to
  // run it, what it should feel like, what to watch for, then the coach.
  const canonical = ['why', 'execution', 'feel', 'watch', 'note', 'fuel'];
  const expected = canonical.filter(k => keys.includes(k));
  assert.deepEqual(keys, expected, 'the coaching modules are out of order');
  // One wrapper per module, never nested.
  assert.doesNotMatch(html, /how-mod[^>]*>\s*<div class="how-mod"/,
    'a module wrapper contains another -- the rail would nest panels');
});

test('an empty module is not emitted at all', () => {
  // row() has always returned '' for a fact the engine does not have. A rail
  // with a blank panel in it is worse than a rail with five panels.
  const a = app();
  const dd = a.state.days.find(d => d.type !== 'rest' && d.km > 0);
  const html = a.renderDayCard(dd);
  assert.doesNotMatch(html, /<div class="how-mod" data-mod="[a-z]+"><\/div>/,
    'an empty coaching module was emitted');
});

test('the module wrapper is absent from layout everywhere except a focused session', () => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /\.how-mod\{display:contents;\}/,
    'without display:contents, This Week and Full Plan gain stray boxes around every coaching row');
  assert.match(focusRule('.how-mod'), /display:block/,
    'the module never becomes a real box, so the rail has nothing to lay out');
});

test('the rail is a scroll-snap carousel, not a gesture handler', () => {
  const rail = focusRule('.how-card .fuel-body');
  assert.match(rail, /overflow-x:auto/);
  assert.match(rail, /scroll-snap-type:x mandatory/,
    'the swipe is no longer snapping -- the platform does this for free');
  const mod = focusRule('.how-mod');
  assert.match(mod, /scroll-snap-align:start/,
    'centre-aligned snapping leaves the first and last module unreachable without phantom padding');
  /* Narrow COLUMNS, several on screen at once -- which is only possible
     because the two things that could not be a column (a staged Execution,
     a fuel table) render below the rail instead. A single wide panel mixed
     in with narrow ones overlapped the viewport almost permanently and so
     drove the height of every short panel beside it. */
  const w = Number((mod.match(/flex:0 0 (\d+)%/) || [])[1]);
  assert.ok(w >= 24 && w <= 36,
    'the rail column is ' + w + '% -- at that width it is a panel, not a column, ' +
    'and nothing else is visible beside it');
});

test('the tables render below the rail, not inside it', () => {
  // A staged Execution is SETTLE / PRESS / RECOVER / ABSORB with a pace and
  // an instruction each. At a quarter of a phone that is unreadable; at full
  // width it is the tallest thing in the rail and drags every short panel's
  // height up with it. The rail is the coaching SENTENCES.
  const a = app();
  const dd = a.state.days.find(d => /interval|hill|threshold|tempo/i.test(d.title || '')) ||
             a.state.days.find(d => d.type !== 'rest' && d.km > 0);
  const html = a.renderDayCard(dd);
  if (html.indexOf('strat-phase') === -1) return;   // this day has no staged plan
  const railEnd = html.indexOf('class="how-dots"');
  assert.ok(railEnd > -1, 'the rail has no dots, so its end cannot be located');
  assert.ok(html.indexOf('strat-phase') > railEnd,
    'the staged Execution is back inside the rail');
  assert.doesNotMatch(html, /data-mod="execution"[^>]*>\s*<span class="how-mod-i"[^>]*>[\s\S]{0,400}?strat-phase/,
    'a module wraps the staged Execution again');
});

test('the active module is lit, and nothing in the rail is boxed', () => {
  const card = focusRule('.how-card');
  assert.match(card, /border:0/, 'the coaching card drew an edge again');
  assert.match(card, /background:none/);
  assert.match(card, /box-shadow:none/);
  const before = focusRule('.how-mod::before');
  assert.match(before, /radial-gradient/, 'the illumination became something other than a pool of light');
  const g = before.match(/radial-gradient\((\d+)% (\d+)%/);
  assert.ok(g && Number(g[1]) < 50 && Number(g[2]) < 50,
    'the gold pool runs past its own box and will show an edge');
  assert.doesNotMatch(before, /border(?!-radius)/, 'the lit module grew a border');
  assert.match(focusRule('.how-mod.is-active::before'), /opacity:1/);
  // Unlit, not hidden: the dim is what makes the light read as light.
  assert.ok(/opacity:\.[0-9]+/.test(focusRule('.how-mod')), 'inactive modules are no longer dimmed');
});

test("the Coach's Note is cherry, borderless, and dissolves inside its own box", () => {
  const before = focusRule('.how-note::before');
  /* On the cherry ramp BY NAME. Asserting a particular rgb triple is how a
     test ends up blessing an invented in-between colour -- this one did,
     for one revision -- so it asks for the token instead. */
  assert.match(before, /var\(--cherry(-text)?\)/,
    "the Coach's Note is lit in a colour that is not on the cherry ramp");
  // The ending shape must finish INSIDE the ::before, or the light is cut
  // off at the box edge and the cut is a rounded rectangle anyone can see.
  /* THE ONE PROPERTY THAT MATTERS: it must reach alpha 0 before the box
     does, on every axis it is drawn on. Otherwise the browser cuts it at
     the edge and the cut is the rounded rectangle this whole treatment
     exists to avoid.
     Two crossed linear fades rather than a radial, because a radial that
     has to die before all four edges cannot be wider than half the box --
     across a full-width note that is a circle of light behind left-aligned
     text, with the first and last words in the dark. */
  /* FALLOFF FROM THE WORDS, AND BLUR ON TOP OF IT -- the two together, for
     two different reasons.
     A radial centred on the text is brightest where the words are and dies
     away from them, which is what light does. A flat shape, even heavily
     blurred, is an even field: as lit at its middle as at its three-quarter
     mark, so it reads as an AREA, and an area that size dominates whatever
     brightness it is given. That was the note's real problem, not its
     intensity -- measured, its bloom peaked at 45 against the ring's 244
     and still looked like the loudest thing on the screen.
     UNDER 50% ON BOTH AXES is arithmetic: the ending-shape percentages are
     of the BOX, not the half-box, so anything above 50 still carries colour
     when it meets the edge and is cut there. Two earlier versions of this
     glow were cut at 78% and at 130%.
     THE BLUR STAYS because a radial's stops have corners in their first
     derivative too, and the eye finds those as faint rings. */
  const shape = before.match(/radial-gradient\((\d+)% (\d+)%/);
  assert.ok(shape, 'the note glow is no longer a radial -- an even field cannot fall off from the words');
  assert.ok(Number(shape[1]) < 50 && Number(shape[2]) < 50,
    'the glow is ' + shape[1] + '% x ' + shape[2] + '% of its box, so it is cut at the edge');
  assert.match(before, /transparent 100%/, 'the falloff no longer reaches nothing');
  const blur = before.match(/filter:blur\((\d+)px\)/);
  assert.ok(blur && Number(blur[1]) >= 10,
    'the blur that hides the gradient stops is gone or too tight');
  /* And the clip that defeated the last version: a focused card never
     collapses, so .day-detail's animation clip only cuts the light off. */
  assert.match(focusRule('.day-detail'), /overflow:visible/,
    "the focused card clips again -- the note's light will stop at the card edge");
  const note = focusRule('.how-note');
  assert.match(note, /border:0/, "the Coach's Note has a border again");
  assert.match(note, /background:none/, 'the tinted rectangle came back');
});

test('the hero is a metric and a ring on the ground, not three nested rectangles', () => {
  ['.th-hero', '.th-hero-main', '.th-ring-wrap'].forEach(sel => {
    const r = focusRule(sel);
    assert.match(r, /background:none/, sel + ' has a fill again');
    assert.match(r, /border:0/, sel + ' has an edge again');
  });
  assert.match(focusRule('.th-hero'), /box-shadow:none/, 'the hero card is being lifted again');
  // ...and the layout it was holding is untouched: metric left, ring right.
  assert.match(focusRule('.th-hero'), /display:flex/);
  assert.match(focusRule('.th-ring-wrap'), /flex:0 0 40%/);
});

test('the rail degrades to a working carousel if its script never runs', () => {
  // The script answers two things CSS cannot: which module is lit, and how
  // tall the rail is. Neither may be load-bearing -- a height that is only
  // ever SET means a failure leaves the natural (tallest) height and a
  // scroll-snap rail that still works.
  const a = app();
  assert.equal(typeof a.wireCoachingRails, 'function');
  assert.equal(typeof a.wireCoachingRail, 'function');
  const fn = /function wireCoachingRail\(rail\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /rail\.style\.height = /, 'the rail no longer follows the module in view');
  assert.doesNotMatch(fn, /style\.display|style\.overflow|classList\.add\('how-mod'\)/,
    'the script is doing layout CSS should own');
  // Measured by rect, not offset: .how-mod is positioned, so its offsetParent
  // is itself and offset maths would measure nothing.
  assert.match(fn, /getBoundingClientRect/);
  assert.match(fn, /requestAnimationFrame/, 'the scroll handler is no longer throttled');
  // A scrollable region has to be reachable by something other than a finger.
  assert.match(fn, /setAttribute\('tabindex', '0'\)/);
  assert.match(fn, /setAttribute\('role', 'group'\)/);
  // It must survive a DOM that answers nothing, the way every other
  // post-render hook in this file does.
  assert.doesNotThrow(() => a.wireCoachingRails());
});

test('the card still renders identically in all three views', () => {
  // The wrapper was added to the ONE string; this is the invariant it could
  // have broken.
  const a = app();
  const dd = a.state.days.find(d => d.date === a.todayStr()) || a.state.days[0];
  const canonical = a.renderDayCard(dd);
  assert.equal(a.renderDayCard(dd), canonical, 'renderDayCard is no longer a pure function of the day');
  assert.ok(todayCard(a).length > 0);
});

test('the focused rail needs no title, and the header is the page\'s own ground', () => {
  // The first panel is headed WHY and the second EXECUTION. A title above
  // them saying the rail is about how to run the session is a label on a
  // label. Everywhere else this is still a closed disclosure and the summary
  // is the thing you press, so only the open view loses it.
  assert.match(focusRule('.how-card > summary'), /display:none/,
    'the rail grew a title again');
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  // The heading every other view still presses lives on .fuel-card summary,
  // which .how-card inherits -- hiding it here must not have touched that.
  assert.match(bare, /\.fuel-card summary\{[^}]*font-size/,
    'the summary lost its own heading, which every other view still presses');
  // The header carried rgba(21,17,13,.92) -- a warm near-black distinctly
  // browner than --bg -- so the top of every screen read as a separate
  // surface. It is mixed from --bg now, and still translucent, because a
  // sticky bar that content passes under needs to stay soft.
  const topbar = /\.topbar\{([^}]*)\}/.exec(bare)[1];
  assert.match(topbar, /color-mix\(in srgb, var\(--bg\)/,
    'the header has its own colour again');
  assert.doesNotMatch(topbar, /rgba\(21,17,13/, 'the old warm near-black came back');
  assert.match(topbar, /backdrop-filter:blur/, 'the sticky bar stopped blurring what passes under it');
});

test('the session is the brightest thing on the screen, and the ring has a filament', () => {
  /* MEASURED, then fixed, then measured again. On the rendered screen the
     ring's stroke peaked at 127 luminance -- not drawn faintly, but because
     --cherry-text (#C46A89) is a mid-luminance pink and 127 is where that
     colour tops out. White type peaks at 255. No stroke width, opacity or
     bloom could have made a ring painted entirely in mid-pink compete; the
     ceiling was the hue.
     A near-white stop at the lit end took it to 244 while the halo stayed
     pure cherry -- white where it is hottest, coloured where it radiates,
     which is what a lit filament actually looks like.
     This pins the three things that produce that hierarchy. */
  const arc = /var TH_ARC = [\s\S]*?<\/svg>';/.exec(SRC);
  assert.ok(arc, 'TH_ARC is gone');
  assert.match(arc[0], /<stop offset="0%" stop-color="#FFF1F5"/,
    'the arc lost its hot core -- the stroke falls back to ~127 luminance and ' +
    'the ring stops being able to compete with white type');
  assert.match(arc[0], /var\(--cherry-text\)[\s\S]*var\(--cherry\)[\s\S]*var\(--cherry-dim\)/,
    'the arc no longer grades through the cherry ramp below its core');
  const w = Number(/stroke-width="([\d.]+)"/.exec(arc[0])[1]);
  assert.ok(w >= 8, 'the stroke thinned to ' + w + ' -- mass is what the ring reads by');
  // ...and the white half of the hero is lit rather than flat --ink.
  const title = focusRule('.th-hero-title');
  assert.match(title, /color:#FFFFFF/, 'the session title went back to off-white');
  assert.match(title, /text-shadow:/, 'the session title lost its backlight');
});

test('the ring drops the zone word only because the badge above it already says it', () => {
  /* THE JUSTIFICATION IS THE TEST. Hiding .th-ring-k is lossless only while
     the type badge on the same card carries the identical string -- and it
     does, for every session type the engine builds: Interval, Easy, Long
     Run, Tempo, Threshold, Checkpoint, Race Day. Both read dayTypeLabel(),
     which is why. If a future change gives the ring a word the badge does
     not have, this fails and the hiding has to be reconsidered rather than
     quietly losing information. */
  const a = app();
  const seen = new Set();
  a.state.days.filter(d => d.type !== 'rest' && d.km > 0).forEach(d => {
    if (seen.has(d.type)) return;
    seen.add(d.type);
    const html = a.renderDayCard(d);
    const badge = (html.match(/class="day-badge [^"]*font-head">([^<]*)</) || [])[1];
    const ring = (html.match(/class="th-ring-k font-head">([^<]*)</) || [])[1];
    if (ring == null) return;                 // no ring on this day
    assert.equal(ring, badge,
      d.type + ': the ring says "' + ring + '" and the badge says "' + badge +
      '" -- hiding the ring label would now lose a word');
  });
  assert.ok(seen.size >= 4, 'expected several session types to check, saw ' + seen.size);
  assert.match(focusRule('.th-ring-k'), /display:none/, 'the zone word is back inside the ring');
  /* ...and what the ring is left holding is clamped to the hollow it sits
     in. A flat 13px pace band measured 53px from the centre on a 360pt
     phone against ~50px of usable radius -- drawn over its own stroke. */
  assert.match(focusRule('.th-row'), /font-size:clamp\(/,
    'the ring data went back to a fixed size and will overrun the stroke on a small phone');
});

test('selection is illumination and nothing else -- no geometry anywhere in the rail', () => {
  /* The lit panel had an L of light: 2px down the leading edge, 2px along
     the foot. It was meant to read as a panel catching light from the side
     and it read as what it was, which is two thirds of a border. If the
     pool cannot carry the selection then the pool is wrong, not
     under-decorated.
     The element went with the style. An empty span kept for a rule that no
     longer exists is how dead markup survives for years. */
  assert.doesNotMatch(SRC, /how-mod-glow/,
    'the selected module grew hard edges again');
  const mod = focusRule('.how-mod');
  // The property, not the word: /border(?!-radius)/ also matches the
  // border-box in box-sizing, which is how this assertion first "failed".
  assert.doesNotMatch(mod, /(^|;)\s*border\s*:/, 'the module itself has a border');
  const before = focusRule('.how-mod::before');
  assert.match(before, /radial-gradient/, 'the only marker of selection is no longer a pool of light');
  // The divider separates; it must not rule. A full-height hairline turned
  // four panels into four columns of a table.
  const div = focusRule('.how-mod + .how-mod::after');
  const op = Number((div.match(/opacity:([\d.]+)/) || [])[1]);
  assert.ok(op <= 0.4, 'the column divider is back up to ' + op + ' and reads as a rule');
  assert.ok(/top:\d+%/.test(div) && !/top:0/.test(div),
    'the divider runs the full height again');
});

test('Today offers only what Today is for', () => {
  /* Today = DO. This Week = MANAGE. Full Plan = PLAN. A screen should only
     expose the actions that serve its own purpose, and changing what the
     session IS is not one of Today's -- it is one tap away on the two
     screens whose job that is.
     RECORDING WHAT WAS RUN STAYS. That is doing the session, not
     re-planning it, which is why the two had to be separated: they have
     always shared one data-action and one rail position. */
  const a = app();
  const dd = a.state.days.find(d => d.type !== 'rest' && d.km > 0);
  const html = a.renderDayCard(dd);
  assert.match(html, /class="day-act-plan"|class="day-act-log"/,
    'the two edit actions are no longer distinguishable, so Today cannot keep one and lose the other');
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(bare, /\.view-today \.day-act-plan\{display:none;\}/,
    'Edit Session is back on Today');
  // ...and the rail collapses with it rather than leaving a hole where a
  // button used to be.
  assert.match(bare, /\.view-today \.day-actions:not\(:has\(\.day-act-log\)\)\{display:none;\}/,
    'an empty action rail is left behind on Today');
  // The control must still EXIST -- removed from a screen, not from the app.
  // Unanchored, this matched the .view-today rule itself. The question is
  // whether a rule hides it WITHOUT that scope.
  assert.doesNotMatch(bare, /(^|\}|;)\s*\.day-act-plan\{display:none;\}/,
    'Edit Session was hidden everywhere, not just on Today');
});
