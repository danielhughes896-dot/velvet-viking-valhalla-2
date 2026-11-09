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
/* THE FOCUSED-SESSION SELECTOR, READ OUT OF THE SHEET RATHER THAN RETYPED.
   It began as three arms and is now four -- This Week's summary joined when
   that screen took Today's hierarchy -- and a hardcoded copy here meant
   every rule in this file reported "no focused-session rule" the moment an
   arm was added, which says nothing about what actually broke. The arms are
   asserted once, below, where that claim belongs. */
const FOCUS = (CSS.match(/:is\(\.view-today \.day\.is-today[^)]*\)/) || [])[0];
assert.ok(FOCUS, 'the focused-session selector is gone from the sheet');

// The focused-session rule for a selector, with its comments already gone.
function focusRule(sel) {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const needle = FOCUS + ' ' + sel + '{';
  const i = bare.indexOf(needle);
  assert.ok(i > -1, 'no focused-session rule for ' + sel);
  return bare.slice(i + needle.length, bare.indexOf('}', i));
}

test('the focused-session selector names every surface entitled to the treatment', () => {
  /* Each arm is a place the product shows ONE session in full, and the list
     is the whole claim: Today's card, This Week's summary, the full card
     This Week reveals, and Full Plan's session screen. A fifth arm is not a
     styling detail -- it is another screen adopting the hierarchy -- so it
     should have to be stated here. */
  ['.view-today .day.is-today', '.view-week .wk-full .day',
   '.view-plan-session .day', '.view-week .wk-overview'].forEach(arm => {
    assert.ok(FOCUS.indexOf(arm) > -1, FOCUS + ' no longer covers ' + arm);
  });
});
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
  /* A MULTI-STAGE DAY. "the first day with distance" is an easy run, which
     the engine describes in one stage -- so the card emits a single module
     and "several" stopped being true of it once the columns went. */
  const dd = a.state.days.find(d => {
    try { return d.type !== 'rest' && d.km > 0 && a.workoutSteps(d).length >= 2; } catch (e) { return false; }
  });
  assert.ok(dd, 'the fixture has no multi-stage session');
  const html = a.renderDayCard(dd);
  /* ---------- THE MODULES ARE THE RAIL'S NOW ----------
     This counted why / execution / feel / watch and held them in the
     coaching order. Those four were the columns, and the columns are gone
     -- so the keys a card emits are the rail's panels: the blueprint's
     stages (ws-N) or the fuel facts (fuel-N). The law that survives is the
     one about the wrapper: one per module, never nested, whatever the
     module is. The ORDER of the rail's panels is held where it belongs,
     in structuredWorkout, against the stages themselves. */
  const keys = [...html.matchAll(/class="how-mod" data-mod="([a-z]+)-?\d*"/g)].map(m => m[1]);
  assert.ok(keys.length >= 2, 'expected several rail modules, found ' + keys.length);
  assert.ok(keys.every(k => /^(ws|fuel)-?\d*$/.test(k)),
    'a card is emitting a module that is neither a stage nor a fuel fact: ' + keys.join(', '));
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

test('the rail moves the FOCUS, and moves itself only when it must', () => {
  /* THIS TEST USED TO SAY THE OPPOSITE -- "a scroll-snap carousel, not a
     gesture handler" -- and letting the platform snap was the right default
     until the geometry made it impossible. A module is 34% of the rail, so
     with about three on screen the scrollable distance is less than one
     module: the snap positions a four-module rail needs do not exist, and
     two of the four could never be the one nearest the left edge. Deriving
     the active module from the scroll offset cannot work when the offset
     has fewer states than there are modules.
     So the finger moves an INDEX now, and the rail follows only far enough
     to bring the next module fully into view -- which for the first two
     steps is not at all. User scrolling is off because the script owns the
     position; the arrow keys replace the keyboard scrolling that came with
     it. */
  /* THE TRACK RULE NOW NAMES TWO RAILS. The blueprint became the fourth
     use of this component and lives OUTSIDE Session Details, so it is
     listed alongside rather than given a copy of these declarations --
     which is the point: one rail in this product, four places. Everything
     this test asserts is asserted of both. */
  const rail = focusRule(':is(.how-card .fuel-body, .ws-rail)');
  assert.match(rail, /overflow-x:hidden/,
    'user scrolling is back, and it will fight the focus for the position');
  assert.doesNotMatch(rail, /scroll-snap-type/,
    'snap positions are back, and they will override the focus-driven ones');
  assert.match(rail, /touch-action:pan-y/,
    'the rail takes the horizontal gesture itself and must leave vertical to the page');
  /* .how-rail names the COACHING rail specifically: the hairlines between
     its three columns belong to it and not to the fuel, execution or
     blueprint rails, which are cards swiped one at a time. */
  /* The coaching columns are gone from the product altogether -- the
     founder took them off, and what they said is in the Coach's Note; see
     "why, feel and watch for left the screen" in structuredWorkout. What
     this line protected was that they were NOT a rail, and the strongest
     version of that is now that they do not exist. */
  /* READ WITH THE COMMENTS STRIPPED. The note explaining that .how-cols
     went away says the words ".how-cols", so a bare search of SRC answers
     a question about the prose rather than about the code -- the same trap
     a guard in todayHeroAndFuel fell into over .how-fuel. */
  assert.ok(SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').indexOf('how-cols') === -1,
    'the coaching columns are back');
  assert.match(SRC, /<div class="fuel-body ws-rail" data-hswipe="1">/,
    'the blueprint rail has lost data-hswipe, so the page pager will claim it');
  const mod = focusRule('.how-mod');
  /* Narrow COLUMNS, several on screen at once -- which is only possible
     because the two things that could not be a column (a staged Execution,
     a fuel table) render below the rail instead. A single wide panel mixed
     in with narrow ones overlapped the viewport almost permanently and so
     drove the height of every short panel beside it. */
  /* (\d+(?:\.\d+)?) rather than (\d+): a third written as 33.333% made this
     read NaN, and NaN fails every comparison, so the message said "the rail
     column is NaN%" instead of naming a width that was actually inside the
     range. A guard that cannot parse a legal value reports a fault that is
     not there. */
  /* THE RANGE INVERTED, BY INSTRUCTION. 24-36% existed so three panels
     landed whole with a fourth peeking -- "there is more sideways" said by
     geometry. Every rail is one card at a time now and the DOTS say it
     instead, which is why they also stopped retiring once learned. A panel
     narrower than the rail would now be the fault: it would mean a card
     that does not fill the card. */
  const w = Number((mod.match(/flex:0 0 (\d+(?:\.\d+)?)%/) || [])[1]);
  assert.ok(Number.isFinite(w),
    'could not read the rail column width from: ' + (mod.match(/flex:[^;]*/) || [''])[0]);
  assert.equal(w, 100,
    'the rail column is ' + w + '% -- every rail is one full-width card now, and the dots are what say there is more');
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
  /* ---- THE MULTI-ROW NOTE, WHICH IS THE ONE THIS LAW IS ABOUT ----
     The solo box excluded itself from these rules by name:
     .how-note:not([data-solo]). Founder: "Remove the glow from behind as
     well" -- that box is flat, has a cherry border, and is the session
     rather than a note under it. Everything below still governs the Coach's
     Note that appears beneath a session with a rail. */
  const before = focusRule('.how-note:not([data-solo])::before');
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
  const note = focusRule('.how-note:not([data-solo])');
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
  assert.match(fn, /rail\.style\.height = /, 'the rail no longer gets a height at all');
  assert.doesNotMatch(fn, /style\.display|style\.overflow|classList\.add\('how-mod'\)/,
    'the script is doing layout CSS should own');
  /* ONE HEIGHT, THE TALLEST MODULE THERE IS. Sizing to the tallest module
     ON SCREEN meant the rail shrank as a four-line Why scrolled out and a
     two-line Feel took over -- and the Coach's Note, the buttons and
     Injured or ill all rose to meet it while the athlete was reading. */
  assert.match(fn, /if \(mods\[i\]\.scrollHeight > h\) h = mods\[i\]\.scrollHeight;/,
    'the rail is sized from a subset of its modules again, so the page moves under the reader');
  assert.doesNotMatch(fn, /m2\.right > r\.left/, 'the height follows what is visible again');
  // A region that answers a swipe has to answer a keyboard too -- and the
  // rail is no longer user-scrollable, so this replaces what it inherited.
  assert.match(fn, /setAttribute\('tabindex', '0'\)/);
  assert.match(fn, /setAttribute\('role', 'group'\)/);
  assert.match(fn, /'ArrowRight'/, 'the arrow keys no longer move the rail');
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

test('the focused rail is behind a tab, and the header is the page\'s own ground', () => {
  /* THIS ASSERTION CHANGED SIDES. It used to require the summary hidden on
     a focused session -- the first panel is headed WHY and the second
     EXECUTION, so a title above them saying the rail is about how to run
     the session was a label on a label. That held while the rail was always
     open.
     The rail is behind Session Details now, closed until asked, and it
     carries the session's own targets, description and step table with it.
     Hiding the summary would hide the only way to open any of that, and the
     label is no longer on a label: it is on a closed door. What must stay
     true is that the tab is REACHABLE, so that is what is asserted. */
  const bareCss = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  /* THE OPEN RAIL STILL NEEDS NO HEADING. While the session is ahead of the
     athlete the rail renders open on a focused card, and a summary saying
     "how to run this" above panels headed WHY and EXECUTION is a label on a
     label -- so that one is hidden, exactly as it always was. */
  assert.match(bareCss, /\.how-card\.is-static > summary\{display:none/,
    'the open rail grew a heading again');
  /* And exactly one rule decides it. A second one -- an override added
     later in the sheet, with or without !important -- would win silently
     while the assertion above still passed. */
  assert.equal((bareCss.match(/\.how-card\.is-static > summary\{/g) || []).length, 1,
    'a second rule now also targets the open rail\u2019s summary; the later one wins');
  /* AND THE CLOSED TAB IS NEVER HIDDEN. Once the session is logged the panel
     becomes Session Details, and hiding its summary would hide the only way
     to open it -- along with the targets, description and step table it now
     carries. A rule that hid it would be invisible in every desktop check
     and fatal on the card. */
  assert.doesNotMatch(bareCss, /\.how-card\.is-tab[^{]*> summary\{[^}]*display:none/,
    'the Session Details tab is hidden, so a logged session cannot be opened');
  assert.doesNotMatch(bareCss, /\.how-card > summary\{[^}]*display:none/,
    'the summary is hidden for EVERY how-card, which takes the tab with it');
  assert.match(SRC, /sessionTabHtml\('Session Details'/,
    'the rail lost the tab that opens it once the session is logged');
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  /* The heading every other view still presses lives on the disclosure-row
     block, which .how-card inherits -- hiding it here must not have touched
     that. The selector now carries :not(.sess-tab), and that exclusion is
     load-bearing rather than cosmetic: a session tab is ALSO a <summary>
     inside a .fuel-card, so at (0,2,0) against .sess-tab's (0,1,0) this
     block was handing the Session Details tab the disclosure row's whole
     box -- 10px of padding and a 6px gap where its three siblings had 15px
     and 13px, which put its title 12px left of theirs. Asserted with the
     exclusion present, so removing it fails here as well as in
     sessionTabPolish. */
  assert.match(bare, /\.fuel-card summary:not\(\.sess-tab\)\{[^}]*font-size/,
    'the summary lost its own heading, which every other view still presses');
  // The header carried rgba(21,17,13,.92) -- a warm near-black distinctly
  // browner than --bg -- so the top of every screen read as a separate
  // surface. It is mixed from --bg now, and still translucent, because a
  // sticky bar that content passes under needs to stay soft.
  const topbar = /\.topbar\{([^}]*)\}/.exec(bare)[1];
  assert.doesNotMatch(topbar, /rgba\(21,17,13/, 'the old warm near-black came back');
  /* ONE BACKGROUND, EDGE TO EDGE. The border went first and a seam was
     still there: a backdrop-filter has to resolve its own edge against what
     it samples, and over a flat ground that lands a hair off the colour
     beside it. Frosting earns its keep when something interesting passes
     underneath; here the page is one colour, so the honest version of
     "translucent over --bg" is --bg. */
  assert.match(topbar, /background:var\(--bg\);/,
    'the header is not the page colour, so it reads as a separate surface');
  assert.doesNotMatch(topbar, /backdrop-filter/, 'the blur is back, and its edge is the seam');
  assert.doesNotMatch(topbar, /border-bottom/, 'the rule under the header is back');
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

test('every screen that shows a session offers the edit that screen is for', () => {
  /* ---- THIS LAW HELD THE OPPOSITE, AND THE FOUNDER OVERRULED IT ----
     It read "Today offers only what Today is for": Today = DO, This Week =
     MANAGE, Full Plan = PLAN, so changing what the session IS was removed
     from Today because it was "one tap away on the two screens whose job
     that is."
     THAT PREMISE STOPPED BEING TRUE. A solo-note day's "View full session"
     button is ghosted -- there is nothing to open -- and the card behind it
     was the only thing carrying the control, so on exactly the days This
     Week is simplest there was no way to edit the session at all. Founder:
     "I think that's right tick and edit on today. Edit this week. And edit
     full plan."
     SO THE LAW IS NOW THE DISTRIBUTION ITSELF, which is the thing that can
     actually break: the control exists, it is on all three screens, and the
     tick is on Today alone. The .day-act-plan / .day-act-log split is kept
     and still asserted -- it is what lets a screen offer one and not the
     other, and it is how the week slide is checked not to have grown a
     tick. */
  const a = app();
  const dd = a.state.days.find(d => d.type !== 'rest' && d.km > 0);
  const html = a.renderDayCard(dd);
  assert.match(html, /class="day-act-plan"|class="day-act-log"/,
    'the two edit actions are no longer distinguishable, so a screen cannot keep one and lose the other');
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

  /* NOTHING HIDES THE EDIT CONTROL ANY MORE -- not on Today, not anywhere. */
  assert.doesNotMatch(bare, /\.view-today \.day-act-plan\{display:none;\}/,
    'Today hides Edit Session again, and it is no longer one tap away on the other screens');
  assert.doesNotMatch(bare, /\.view-today \.day-actions:not\(:has\(\.day-act-log\)\)\{display:none;\}/,
    'Today hides the action rail unless it holds a notes button, which takes the pencil with it');
  assert.doesNotMatch(bare, /(^|\}|;)\s*\.day-act-plan\{display:none;\}/,
    'Edit Session is hidden everywhere');

  /* AND IT REACHES THE OTHER TWO, which draw their day through a different
     renderer -- the reason this was missed until the founder found it. */
  const slide = a.weekSlideHtml(dd, 0);
  assert.match(slide, /data-action="open-edit"/,
    'This Week and Full Plan have no edit control on the day they are showing');
  assert.doesNotMatch(slide, /data-action="toggle-complete"/,
    'the week slide grew a tick — the founder put that on Today');
});

test('nothing on the focused session is drawn as a box', () => {
  /* The hero went first, then the coaching card, and the workout blueprint
     was left as the only drawn rectangle on the screen -- and therefore the
     loudest thing on it, louder than the ring, which is the session. Its
     frame only ever said "these belong together", which three tiles in a row
     already say.
     THE TILES INSIDE KEEP THEIRS. They are the information, and the cherry
     on the key stage is how the hard part is marked; this is about the
     container drawn around them, not about them. */
  ['.th-hero', '.th-hero-main', '.th-ring-wrap', '.how-card', '.ws-block'].forEach(sel => {
    const r = focusRule(sel);
    assert.match(r, /background:none/, sel + ' has a fill again');
    assert.ok(/border:0/.test(r) || /border:none/.test(r), sel + ' has an edge again');
    assert.ok(!/box-shadow:var\(--t-lift\)/.test(r), sel + ' is being lifted like a card again');
  });
  // ...and the step tiles still are tiles.
  const step = focusRule('.ws-h-step');
  assert.match(step, /background:var\(--t-tile\)/, 'the step tiles lost their faces');
});

test('every coaching module can reach the reading position', () => {
  /* THE DOTS MUST NOT PROMISE A STOP THE GEOMETRY CANNOT REACH, and with
     the active module derived from the scroll offset two of four never
     could: a module is 34% of the rail, so four of them leave less than one
     module of travel while the snap points sit a whole module apart. The
     focus is an index now, so every module is reachable by construction and
     the rail's own position is a consequence rather than the source. */
  const fn = /function wireCoachingRail\(rail\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /function wantedScroll\(i\)/,
    'the rail position is no longer computed from the focus');
  assert.match(fn, /setFocus\(focus \+ \(p\.dx < 0 \? 1 : -1\), true\)/,
    'a swipe no longer steps the focus by one');
  assert.match(fn, /focus = i < 0 \? 0 : \(i > n - 1 \? n - 1 : i\)/,
    'the focus wraps or runs off the end instead of stopping');
  /* The rail travels the least that keeps the focused module and the one
     after it in view -- which is what makes the first two steps move
     nothing and the third reveal the last module whole. */
  assert.match(fn, /var rightOf = \(nxt\.offsetLeft - first\) \+ nxt\.offsetWidth;/,
    'the next module no longer decides the travel');
  assert.doesNotMatch(CSS, /\.how-mod:last-child\{flex:0 0 100%;\}/,
    'the wide last module is back; the focus model does not need it');
  assert.doesNotMatch(CSS, /\.how-card \.fuel-body::after\{[^}]*flex:0 0 calc/,
    'the empty trailing spacer is back; the focus model does not need it');
});


test('a card rebuilt in place comes back with working rails', () => {
  /* REPORTED AS "once the session is complete the rails don't work", and the
     "once complete" is the whole clue.
     replaceCard() swaps a day card's element for a freshly rendered one.
     The coaching rails are wired by wireCoachingRails(), which only ever ran
     inside renderApp() — so a card rebuilt in place came back with new
     .fuel-body elements no script had touched: no focus, no .is-active, no
     handlers, no height. Reproduced in Chromium by ticking the session
     complete the way an athlete does: before the tick the rail reported
     wired=true with module 0 active; after it, wired=false, active=-1, and
     a swipe did nothing.
     Completing a session is what makes the prescription reference, which
     turns Session Details into a tab, which re-renders the card through
     here. On a page load the same state works, because renderApp() ran —
     which is why this never showed up in a reload-based check. */
  const i = SRC.indexOf('function replaceCard(');
  assert.ok(i > -1, 'replaceCard is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.match(body, /wireCoachingRails\(\)/,
    'replaceCard() no longer re-wires the rails it just rebuilt. Every card it replaces ' +
    'comes back dead: no active module, no swipe, no height.');
  assert.match(body, /replaceChild[\s\S]*wireCoachingRails\(\)/,
    'the re-wire has to run AFTER the new card is in the document — wiring the old ' +
    'element achieves nothing');
  /* And the guard that makes re-wiring safe to call anywhere. */
  const w = SRC.indexOf('function wireCoachingRail(');
  const wbody = SRC.slice(w, SRC.indexOf('\n}\n', w));
  /* The EARLY RETURN specifically, not merely a mention of the flag: it is
     also assigned further down, so checking that the name appears somewhere
     in the function passes even when the guard has gone — which is exactly
     what a mutation of this proved. Without the early return, replaceCard
     re-wires rails that are already live and every swipe after that is
     handled twice. */
  assert.match(wbody, /if\s*\([^)]*\.__vvRailed\s*\)\s*return/,
    'wireCoachingRail no longer returns early on a rail it has already wired, so ' +
    "replaceCard's unconditional call will double-bind every live rail on the screen");
});

/* =========================================================================
 * EXECUTION BECOMES THE THIRD RAIL, and the planned finish joins the ring.
 * ========================================================================= */

test('Execution is the same rail component as the other two', () => {
  /* The note that used to sit at the call site said a staged execution is a
     table, not a micro-module: "at a quarter of a phone it is unreadable,
     and at full width it is the tallest thing in the rail and drags every
     short panel's height up with it". That was about putting the phases
     INSIDE the coaching rail as four more panels, and it was right about
     that. This is its OWN rail, like fuel's, so nothing else shares the row
     and no short panel is dragged anywhere.
     Measured at 412px: panels 224-288px against the coaching rail's 95-116
     and fuel's 95-120. It is the tallest of the three and that is inherent
     -- it carries a sentence of coaching per phase, not a figure. */
  /* Matched on the classes, not the whole attribute list: the body gained
     data-cap when the captions moved into the Coach's Note, and an
     assertion that pins every attribute fails for reasons that are not
     about the law. */
  /* ---------- THE PHASES SHARE A RAIL WITH FUEL NOW ----------
     renderExecutionStrategyBlock() used to return the finished rail; on the
     founder's call SETTLE and CARB INTAKE are one rail, and a rail cannot
     be merged after it has been built -- two tracks and two sets of dots
     concatenate into two rails. So it returns PANELS, and the one place
     that knows about both builds the track. The law this guard holds is
     unchanged: a phase is a rail module, and the dots are counted from the
     panels they indicate. */
  assert.match(SRC, /<div class="fuel-body ws-rail'\+\(stratPanels\.length \? ' exec-rail' : ''\)\+'" data-hswipe="1"'\+/,
    'the execution phases are no longer rendered into the card rail');
  assert.match(SRC, /'<div class="how-mod strat-phase"><div class="ws-card-body">'/,
    'an execution phase is no longer a rail module');
  const i = SRC.indexOf('function renderExecutionStrategyBlock(');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.match(body, /panels: s\.phases\.map\(renderStrategyPhase\)/,
    'the execution block no longer hands its phases back as panels');
  assert.ok(body.indexOf('railDotCount') === -1,
    'the execution block is emitting its own dots again — merged into one rail that ' +
    'is a second set of dots under the same track');
  assert.match(SRC, /railDotCount\(panels\.length\)/,
    'the merged rail lost its dots, or they are counted from something other than the ' +
    'panels they indicate');

  /* ---- AND NOT .strat-phases, WHICH IS WHY IT BROKE ONCE ----
     Merging the old stack's class onto the rail body silently won the
     cascade: flex-direction:column with overflow-x:hidden, so flex:0 0 33%
     became a third of the HEIGHT, every phase was squashed to ~110px and
     there was no way to swipe. It still reported itself wired with a panel
     lit, because wired and laid-out are different questions. */
  assert.ok(!/class="fuel-body strat-phases"/.test(SRC),
    'the column-stack class is back on the rail body — it wins the cascade and turns ' +
    'the rail into a squashed vertical stack that still claims to be wired');
  assert.ok(!/\n  \.strat-phases\{/.test(CSS),
    'the .strat-phases column rule is back; there is no stack for it to describe and ' +
    'it is one merge away from breaking the rail again');
});

test('the planned finish is on the ring, not in a corner of the strategy', () => {
  /* It sat at the foot of the race strategy picker under a PLANNED FINISH
     label -- a third number about this race, two screens below the two the
     ring already carries. The label goes with it: a clock face beside a
     h:mm:ss is not ambiguous, and no other row on the ring is labelled. */
  /* RENDERED, NOT GREPPED. The first version of this asserted the source
     contained "dd.type === 'race'" -- and passed happily when the branch was
     mutated to `false && dd.type === 'race'`, because the text was still
     there. A guard that reads the source can only ever prove the source
     says something. This one builds a race and reads the ring. */
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-07-01', distanceKey: 'full', volume: 44 });
  const race = a.state.days.filter(d => d.type === 'race')[0];
  assert.ok(race, 'the fixture block no longer ends in a race');
  const plan = a.raceExecutionPlan(race.km || 0);
  const expected = a.secToClock(Math.round(plan.impliedSec));
  const ring = a.renderDayTargetRing(race, a.getDayTargets(race));
  assert.ok(ring.includes(expected),
    'the ring does not print the planned finish (' + expected + '). It is what this race ' +
    'is aimed at, and the ring is where this card says what a session is aimed at.');
  /* SCOPED TO THE FINISH'S OWN ROW. Asserting the ring contains a glyph
     anywhere passes on the pace row's gauge while the finish sits bare --
     caught by mutating exactly that. */
  const finishRow = ring.split('<div class="th-row').filter(r => r.includes(expected))[0];
  assert.ok(finishRow, 'the finish is on the ring but not in a row of its own');
  assert.ok(finishRow.includes('th-ic'),
    'the finish has no glyph — the ring prints bare figures and 4:58/km and 3:29:45 ' +
    'are both just digits until something says which is which');

  /* AND AN ORDINARY SESSION DOES NOT GROW A FINISH TIME. */
  const easy = a.state.days.filter(d => d.type === 'easy' && d.km)[0];
  if (easy){
    const er = a.renderDayTargetRing(easy, a.getDayTargets(easy));
    assert.ok(!/\d:\d\d:\d\d/.test(er),
      'a non-race session is printing a finish time on its ring');
  }
  assert.ok(!/Planned finish/.test(SRC),
    'the PLANNED FINISH label is back');
  assert.ok(!/class="rs-finish/.test(SRC),
    'the strategy picker is printing the finish time again as well as the ring');
});

test('the execution panels are figures and the sentence is a caption', () => {
  /* MEASURED, AND THIS IS WHY IT CHANGED. Every panel carried 96-120px of
     prose on top of 59-139px of label, range and target, so the rail stood
     at 288px against the coaching rail's 116 and fuel's 120 -- the founder's
     words were "that's very long". The prose is the detail and could not be
     cut, so it stopped being a fifth of a 125px column: it reads at full
     width under the rail and follows the lit panel. Rail 288 -> 139, region
     331 -> 234, and not a word was lost. */
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-07-01', distanceKey: 'full', volume: 44 });
  const race = a.state.days.filter(d => d.type === 'race')[0];
  /* ONE CALL, ONE PLAN, BOTH PARTS. The captions were briefly a second
     function that read the strategy engine for itself; test/executionStrategy
     refused it, and rightly -- the rail and the captions are indexed against
     each other, so two independent reads are two chances for the athlete to
     get one phase's panel over another phase's coaching. */
  const parts = a.renderExecutionStrategyBlock(race);
  /* .panels, not .rail: the phases come back loose so they can be merged
     with fuel into one track. Joined here, which is what the caller does. */
  const block = (parts.panels || []).join('');
  assert.ok(block, 'the execution block is gone');

  /* THE CAPTIONS LEFT THE BLOCK FOR THE COACH'S NOTE. renderExecutionCaptions()
     builds them and renderDayCard() puts them in the note, so the rail is
     read from one function and the captions from the other -- which is the
     separation this test is about. */
  const rail = block;
  const caps = parts.caps;
  assert.ok(caps, 'the execution captions are gone entirely');
  assert.equal((rail.match(/class="how-mod strat-phase"/g) || []).length,
               (caps.match(/class="how-cap-i/g) || []).length,
    'the rail and its captions are different lengths, so a panel and the sentence under ' +
    'it can be about different phases');
  const phases = (block.match(/class="how-mod strat-phase"/g) || []).length;
  assert.ok(phases >= 3, 'the phases are no longer rail modules');

  /* NOT A WORD LOST. One caption per phase, and the prose lives in them. */
  assert.equal((caps.match(/class="how-cap-i/g) || []).length, phases,
    'there is not exactly one caption per phase');
  /* AND THE RAIL NAMES THEM, because the note is two blocks further down
     and "the element after the dots" cannot reach it. */
  const capId = /id="(exec-cap-[^"]+)"/.exec(caps);
  assert.ok(capId, 'the caption wrapper has no id for the rail to point at');
  /* ASKED OF THE RENDERED CARD, because the rail is built by the caller
     now. Same law, one level up: the track that carries these panels names
     this caption wrapper, or swiping cannot move the sentences. */
  assert.ok(a.renderDayCard(race).indexOf('data-cap="' + capId[1] + '"') > -1,
    'the rail does not point at its own captions, so swiping cannot move them');
  const card = a.renderDayCard(race);
  const noteAt = card.indexOf('class="how-note"');
  assert.ok(noteAt > -1 && card.indexOf('id="' + capId[1] + '"') > noteAt,
    'the execution captions are not inside the Coach\'s Note');
  /* NO "EXECUTION" HEADING. Every panel names itself now -- SETTLE, HOLD,
     PRESS, COMMIT -- and a word above a row of labels that already say what
     they are is a label on labels, which is why FUEL went too. */
  assert.ok(!/how-row-heading">Execution/.test(SRC),
    'the EXECUTION title is back above a row of panels that each name themselves');

  assert.ok(!rail.includes('strat-phase-purpose'),
    'the coaching sentence is back inside a 125px panel, which is what made the rail ' +
    'two and a half times the height of the other two');
  assert.ok(!block.includes('strat-phase-purpose'),
    'a phase sentence is back in the rail instead of the note');

  /* THE FIRST CAPTION IS LIT IN THE MARKUP. A rail whose script never ran
     would otherwise show five panels and no sentence at all -- the same
     reasoning that puts the dot count in the HTML. */
  assert.match(caps, /class="how-cap-i is-on"/,
    'no caption is lit in the markup, so a rail whose script never runs shows none of them');
  assert.equal((caps.match(/is-on/g) || []).length, 1,
    'more than one caption is lit at once');

  /* AND THE WIRING SWITCHES THEM, found by position like the dots -- never
     by reaching into a parent, which is what would hand a second rail in the
     same card the first one's caption. */
  /* FOUND BY NAME, THEN BY POSITION -- never by reaching into a parent,
     which is what would hand a second rail in the same card the first one's
     caption. The execution captions live inside the Coach's Note now, two
     blocks below the rail, so the sibling lookup alone cannot reach them;
     it stays as the fallback so a future rail can use a caption without a
     second mechanism. */
  /* Pinned to the CONDITIONAL, not to the line that reads the attribute.
     The first spelling asserted `var capId = rail.getAttribute(...)` and
     passed happily when the line BELOW it was mutated to `if (false)` --
     the attribute was still read and then thrown away. This is still source
     text rather than behaviour, because wireCoachingRail needs a real DOM
     and the harness stub has none; the Chromium sweep in
     scratchpad/audit/exec.js is what actually exercises it. */
  assert.match(SRC, /var capId = rail\.getAttribute \? rail\.getAttribute\('data-cap'\) : null;/,
    'the rail no longer reads the name of its caption wrapper');
  assert.match(SRC, /\n\s*if \(capId\) capWrap = document\.getElementById\(capId\);/,
    'the rail reads its caption\'s name and then does not use it, so a caption outside ' +
    'its own block is never found');
  assert.match(SRC, /if \(!capWrap && dotWrap\) capWrap = dotWrap\.nextElementSibling;/,
    'the positional fallback is gone');
  const wire = SRC.slice(SRC.indexOf('function wireCoachingRail('));
  const wireBody = wire.slice(0, wire.indexOf('\n}\n'));
  assert.ok(!/parentElement[^\n]*how-cap/.test(wireBody),
    'the caption is being found by reaching into a parent again');
  assert.match(SRC, /if \(caps\) for \(k = 0; k < caps\.length; k\+\+\)/,
    'setFocus no longer moves the caption with the lit panel');
});

test('the execution rail carries no heart rate', () => {
  /* MEASURED ACROSS THE BLOCK, and the numbers are why this was a decision
     rather than a tidy-up:
       race       phases ["157-164" x5]                     ring: none
       long       phases ["148-156" x2]                     ring: 148-156
       tempo      phases [null,"157-164",null]              ring: 157-164
       interval   phases [null,"178-190",null,null]         ring: >178  (day: 153-168)
     The first two repeat one band in every 125px panel. The last two do
     not -- and on an interval the work band is not the day's band, so
     taking it off this screen loses that number. The founder saw both and
     chose: the rail is pace and distance.
     WHAT THIS GUARD IS FOR is that the decision stays a decision. A band
     creeping back into a 125px column is the regression. */
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 11, startDate: a.addDays(a.todayStr(), -9 * 7), distanceKey: 'full',
    volume: 46, benchSec: 45 * 60, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.athlete = a.makeAthleteRecord();

  let covered = 0;
  a.state.days.forEach(d => {
    let parts; try { parts = a.renderExecutionStrategyBlock(d); } catch (e) { return; }
    if (!parts || !parts.panels || !parts.panels.length) return;
    covered++;
    assert.ok(!/BPM/.test(parts.panels.join('')),
      d.type + ': a heart-rate band is back in the execution rail');
  });
  assert.ok(covered >= 3, 'the fixture no longer exercises the execution rail');

  /* AND THE DAY'S OWN BAND IS UNTOUCHED WHEREVER IT EXISTED. Removing it
     from the rail must not have reached getDayTargets(), which is what
     Today, This Week and the ring all read. */
  const tempo = a.state.days.filter(d => d.type === 'tempo')[0];
  if (tempo) assert.ok(/BPM/.test(a.renderDayTargetRing(tempo, a.getDayTargets(tempo))),
    'the day-level band has been removed from the ring as well — only the rail was asked for');

  /* THE RING WAS NOT GIVEN A RACE BAND. A pass before this lifted
     executionHRTarget() onto the race ring; the heart rate came off the
     rail altogether instead, so there is nothing to lift. */
  assert.ok(!/executionHRTarget\(dd\)/.test(
    SRC.slice(SRC.indexOf('function renderDayTargetRing('),
              SRC.indexOf('\n}\n', SRC.indexOf('function renderDayTargetRing(')))),
    'the ring is deriving a heart rate of its own again');
});

test('the session back bar does not repeat the hero', () => {
  /* It printed displayCardTitle(dd) -- "Full Marathon Race Day" -- directly
     above a hero whose first line is the same string three times the size. */
  const i = SRC.indexOf('function renderPlanSessionView(');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.ok(!/planBackBar\([^)]*displayCardTitle/.test(body),
    'the back bar is printing the session title again, directly above the hero that says it');
  assert.match(body, /planBackBar\(dow\(dd\.date\)\+', '\+dShort\(dd\.date\), ''\)/,
    'the back bar no longer leads with the date');
});
