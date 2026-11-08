'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* FULL PLAN STOPS BEING BOXES INSIDE BOXES.
 * ===========================================================================
 * This was the last screen built that way: a lifted, rimmed phase card
 * holding up to six lifted, rimmed week rows. An earlier pass took the
 * SHADOW off the inner rows and left the rim and the fill, which is why it
 * still read as a container of containers -- elevation was never what made
 * it look nested. Nothing structural changed: the phases, the weeks, the
 * rows and the three-level drill-down are as they were.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => {
  const i = BARE.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return BARE.slice(i + sel.length + 1, BARE.indexOf('}', i));
};
function app(){
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-07-01', distanceKey: '10k', volume: 40 });
  return a;
}

test('no surface on the plan screens is drawn as a lifted card', () => {
  /* .race-event came OUT of this list -- see "the day the block is for is a
     panel" below, which now checks that it stays out. Everything else is
     still a container that was adding nothing. */
  const i = BARE.indexOf(':is(.view-plan, .view-plan-week, .view-plan-session)\n    :is(.pw-progress, .pw-row, .zone-card, .hub-card, .race-strategy, .week, .pp-phase)');
  assert.ok(i > -1, 'the plan de-boxing rule is gone or its selector changed');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  ['background:none', 'border:0', 'border-radius:0', 'box-shadow:none'].forEach(d => {
    assert.ok(body.indexOf(d) > -1, 'the plan de-boxing rule no longer sets ' + d);
  });
});

test('the de-boxing is stated AFTER everything that contradicts it', () => {
  /* THIS IS THE POINT OF THE RULE, not an implementation detail. Three
     separate rules re-boxed what an earlier block had already stripped --
     .pw-progress, .pw-row.is-today and the week screen's zone card -- and
     every one of them won on SOURCE ORDER rather than on specificity.
     Chasing them individually with longer and longer selectors is how a
     stylesheet becomes an argument with itself, so the plan screens say it
     once, last. Move this rule up and the boxes come back silently. */
  const deboxed = BARE.indexOf(':is(.pw-progress, .pw-row, .zone-card');
  assert.ok(deboxed > -1, 'the consolidated plan rule is gone');
  ['.pw-row{', '.pw-progress{', '.view-plan-week .zone-card{', '.view-plan > .race-event{'].forEach(sel => {
    const at = BARE.indexOf(sel);
    assert.ok(at > -1, 'rule vanished: ' + sel);
    assert.ok(at < deboxed,
      sel + ' now comes AFTER the de-boxing rule and will silently re-box the plan');
  });
});

test('the current day is lit rather than ringed', () => {
  /* .pw-row.is-today used to set border-color plus a 1px gold ring. The
     border is gone with every other border on this screen, so the signal is
     the glow alone -- which is the language the rest of the product selects
     in. */
  /* Anchored on the BRACE: an earlier rule shares this prefix (it recolours
     .pw-date and .pw-dow), and matching the prefix alone reads that rule's
     body instead of this one's. */
  const i = BARE.indexOf(':is(.view-plan, .view-plan-week, .view-plan-session) .pw-row.is-today{');
  assert.ok(i > -1, 'the today row lost its treatment entirely');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  assert.match(body, /box-shadow:0 0 \d+px color-mix\(in srgb, var\(--gold\)/,
    'the today row is no longer lit, so nothing marks it');
  assert.doesNotMatch(body, /0 0 0 1px/, 'the gold ring came back around the today row');
});

test('bare .hub-card is untouched, because Today and Valhalla use it too', () => {
  /* The de-boxing is scoped to the plan views by name. A change to bare
     .hub-card would reach Today's Next Move and the Valhalla panels, which
     is exactly what the VALHALLA CONSISTENCY PASS comment warns against. */
  const i = BARE.indexOf('.hub-card{');
  assert.ok(i > -1, '.hub-card is gone');
  const body = BARE.slice(i + '.hub-card{'.length, BARE.indexOf('}', i));
  assert.match(body, /background:var\(--surface-3\)/, 'bare .hub-card lost its own fill');
  assert.match(body, /border:1px solid var\(--line\)/, 'bare .hub-card lost its own border');
});

test('a finished week says so in colour, and the list stays clean', () => {
  /* THE WASH CAME OFF THE LIST, and that is a decision rather than a
     regression. A finished week is one row in a column of sixteen; a light
     designed for a single hero moment, repeated down that column, stops
     being an event and becomes a texture. The illumination belongs to the
     completed SESSION -- one thing, on one screen -- and to the marks and
     chips that stand alone. The row still says it is done, in the colour
     its numerals take, which is asserted in the colour-language test below. */
  assert.equal(BARE.indexOf('.view-plan .pp-body .week.is-done::before'), -1,
    'the repeating week wash is back in the list');
  /* .week clipped its children before the boxes came off it, and a glow
     that overspills by 100vw is the first thing that clipping would eat. */
  assert.match(BARE, /\.view-plan \.pp-body \.week\{overflow:visible;\}/,
    'the week row clips again, so the glow is cut to the row');
});

test('the light is for things that happen once, not for rows in a list', () => {
  /* This used to assert that the week's glow was DIMMER than the session
     banner's, because it repeats. Mixing the same recipe weaker is what made
     two finished things stop looking alike in the first place -- so the
     answer is no longer "the same light, quieter" but "not this light here".
     SESSION COMPLETE appears once on a screen and keeps it. */
  assert.ok(BARE.indexOf('.actual-done::before') > -1,
    'the one-off completion banner lost its light too');
  assert.equal(BARE.indexOf('.view-plan .pp-body .week.is-done::before'), -1,
    'a glow is back on a row that can appear sixteen times in a column');
});

test('a week is marked done from the figure it already shows', () => {
  /* Read from weekVolume() like every other number on the row rather than
     recomputed, and gated on there being training prescribed: a week with
     nothing to do is not a week that was completed. */
  assert.match(SRC, /var doneCls = \(vol\.training > 0 && weekPct >= 100\) \? ' is-done' : '';/,
    'the completed-week class is gone or no longer requires prescribed training');
  assert.match(SRC, /'<div class="week-pct font-mono">'\+weekPct\+'%<\/div>'/,
    'the percentage is computed a second time instead of reusing the one the class reads');
});

test('done, now and ahead are one colour language on the plan', () => {
  /* Green is done, gold is now, crisp white is still ahead -- and the chips
     and the week rows say it the same way, in tokens, so the state can be
     read off the colour before the words are. */
  const ruleFor = (sel) => {
    const i = BARE.indexOf(sel);
    assert.ok(i > -1, 'rule gone: ' + sel);
    return BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  };
  /* ---- THE PHASES ARE A CAROUSEL NOW, AND THE LANGUAGE TRAVELS ----
     They were four pills, then a stepper: a mark per phase on a track, each
     phase's week range under its name, all of it at 11.5px because four
     phases plus a race week have to share 320px when the row is a row. One
     full-width slide at a time replaces it.
     WHAT THIS TEST PROTECTED TRAVELS WITH THEM, as the same three tokens:
     the gold of the phase you are in, the --ok-text of one behind you, the
     faint ink of one still ahead. The DONE GLOW does not travel, and that
     is deliberate rather than mislaid -- see "the light is for things that
     happen once" below and "NO WASH AT LIST SCALE" in the sheet. A slide
     says Completed in words AND in the colour of those words; a rim light
     would be the third telling, which is what took the phase disc off the
     heading in the first place.
     NOT ASSERTED HERE ANY MORE: --glow-done-mark. Nothing rendered consumes
     it now (.pp-mark's span went at the gutter pass -- see test/gutterLaw
     -- and the stepper's dot was its only live user), so a guard on it would
     be a guard on a dead declaration. */
  assert.match(ruleFor('.pp-slide.is-now .pp-slide-w{'), /color:var\(--gold-bright\)/,
    'the phase the athlete is in is no longer gold');
  assert.match(ruleFor('.pp-slide.is-done .pp-slide-w{'), /color:var\(--ok-text\)/,
    'a completed phase is no longer green');
  /* ---- AHEAD IS QUIET, AND ON A PHOTOGRAPH THAT IS A WHITE ALPHA ----
     --ink-faint is a colour for a flat charcoal panel. Over the taper
     photograph it measured 2.67:1 against a 4.5 floor, so the quiet state
     is carried the way every other dim run on a photographic card in this
     product carries it -- white at reduced alpha, which is exactly what
     .ws-h-cue (.92) and the stage card's HR note (.72) already do.
     ASSERTED AS A RANGE, not as .78: anything in this band is legible over
     the veil and still visibly the quietest of the three, and pinning the
     exact number would make a re-measure read as a regression. */
  const ahead = ruleFor('.pp-slide.is-ahead .pp-slide-w{');
  const am = /color:rgba\(255,255,255,\.(\d+)\)/.exec(ahead);
  assert.ok(am, 'a phase still ahead is not a white alpha: ' + ahead);
  const aa = Number('0.' + am[1]);
  assert.ok(aa >= 0.72, 'ahead is at ' + aa + ' alpha — measured below 4.5:1 under that');
  assert.ok(aa < 0.92, 'ahead is at ' + aa + ' alpha — it is no longer the quiet one, ' +
    'the message beside it is .92');
  assert.doesNotMatch(ahead, /var\(--ink-faint\)/,
    'ahead went back to --ink-faint, which measured 2.67:1 on the taper photograph');
  assert.doesNotMatch(BARE, /\.pp-slide[^{]*\{[^}]*(?:#9BC08C|rgba\(122,160,110)/,
    'the literal green came back on the phase slide');
  /* ---- GOLD IS WHERE YOU ARE, AND ON A FULL-BLEED PHOTOGRAPH IT IS TYPE ----
     The slide used to take a gold border for this, the way the current day
     and the selected tab do. A photograph that runs to both edges of the
     screen has no border to colour, and drawing one back would be the gap
     the founder asked to remove, in a different colour.
     SO THE LAW IS CHECKED WHERE IT NOW LIVES: phaseGroupMeta() ends the
     slide's own line with the word -- "Weeks 10 - 11 . Now" -- and that
     line is gold for this state and nothing else is. Asserted above. What
     is asserted here is that the rim really is gone in EVERY state, because
     a rim on one slide and not another is the gap coming back. */
  assert.match(rule('.pp-slide-body'), /border:0/,
    'the full-bleed photograph grew a rim again, which is the gap in another colour');
  assert.match(rule('.pp-slide-body'), /border-radius:0/,
    'the full-bleed photograph grew corners again');
  assert.doesNotMatch(BARE, /\.pp-slide[^{]*\{[^}]*border-color:/,
    'a phase slide sets a border colour again — on a full-bleed picture there is ' +
    'no border for it to be, so this is a rim coming back by the side door');
  const sel = a0 => BARE.indexOf(a0) > -1;
  assert.ok(!sel('.pp-slide.is-now .pp-slide-body{'),
    'the current slide has a body rule of its own again — say "you are here" in the ' +
    'line that already says it, not in a second surface treatment');
  const weeks = BARE.slice(BARE.indexOf('.view-plan .pp-body .week .week-num'));
  assert.match(weeks.slice(0, 1200), /\.week\.is-done \.week-num,[\s\S]{0,120}var\(--ok-text\)/,
    'a completed week row is not green');
  assert.match(weeks.slice(0, 1600), /:has\(\.week-today-flag\) \.week-phase\{color:var\(--gold-bright\);?\}/,
    'the current week row is not gold');
});

test('the current week is lit again after the de-boxing took its ring', () => {
  /* A REGRESSION THIS PASS INTRODUCED, pinned so it cannot return. The
     current week was marked by a gold rim and a 1px ring; de-boxing took the
     border those were drawn on and left nothing marking it at all. It comes
     back as illumination, which is what the rest of the product selects
     with -- not as the ring, which is the geometry that went. */
  const i = BARE.indexOf('.view-plan .pp-body .week:has(.week-today-flag){');
  assert.ok(i > -1, 'the current week has no treatment at all');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  assert.match(body, /box-shadow:0 0 \d+px color-mix\(in srgb, var\(--gold\)/,
    'the current week is no longer lit');
  assert.doesNotMatch(body, /0 0 0 1px|border/, 'the gold ring came back around the current week');
});

test('every gold glow that marks selection or state names its token', () => {
  /* color-mix was already the pattern in this property -- .ev-card:hover,
     .splits-summary:hover, .v-call and the HQ panel all used it -- while the
     older rules hand-set rgba(227,177,90). The literal is --gold with the
     name filed off, so a palette change reached most of the product and
     silently missed the rest.
     THE EXCLUSIONS ARE DELIBERATE, NOT LEFTOVERS, and each is a different
     kind of thing:
       - the two @keyframes values, and .wk-bar-fill's resting shadow, are
         tied together by test/instrumentGlow, which asserts the static
         shadow EQUALS the pulse's rest value -- converting one side would
         make a measured relationship unverifiable;
       - 0 0 0 2px on the share thumbnails is a spread RING, not a glow;
       - 0 6px 18px is elevation, not light.
     So this counts what is left rather than demanding zero: it fails if a
     NEW hand-set gold glow appears, and does not pretend the six above are
     mistakes. */
  const halos = BARE.match(/box-shadow:[^;]*rgba\((?:227,177,90|245,208,97)[^;]*;/g) || [];
  const glows = halos.filter(h => !/0 0 0 \d+px|0 \d+px \d+px/.test(h));
  assert.equal(glows.length, 3,
    'hand-set gold glows: ' + glows.length + ' (expected the 3 the pulse owns)\n  ' +
    glows.join('\n  '));
  /* ...and the pattern they should follow is in the sheet and working.
     The phase slide's gold used to be the example here; it was a rim, and
     the rim went when the photograph went full-bleed. The dot under it is
     the gold that survived on that screen, and it follows the same rule. */
  assert.match(BARE, /\.pp-dot\.is-on::before\{[^}]*color-mix\(in srgb, var\(--gold-bright\)/,
    'the current phase dot hand-sets its gold again');
  assert.match(BARE, /\.wk-day\.is-sel\{[^}]*color-mix\(in srgb, var\(--gold\)/,
    'the selected day circle hand-sets its gold again');
});

/* THE ROW SAYS WHAT HAPPENED, IN THE SPACE IT WAS ALREADY LEAVING EMPTY.
 * ===========================================================================
 * A day row ran day, session, then a long run of nothing to a chevron -- and
 * the one thing an athlete scanning a finished week wants from it is whether
 * each day was done and how it went. Both answers already existed:
 * computeExecutionBreakdown() scores a logged session out of 100, and a past
 * day with no log is a missed one.
 */
test('ROW: a finished day shows its score, a past unlogged one says so, a rest day says nothing', () => {
  const a = app();
  const today = a.todayStr();
  const day = (over) => Object.assign({ id: 'd1', date: '2000-01-01', type: 'easy',
    km: 10, completed: false, actual: {} }, over);

  // a rest day is asked for nothing, so there is nothing to report
  assert.equal(a.planRowStatusHtml(day({ type: 'rest', date: '2000-01-01' })), '',
    'a rest day is being marked missed for not being run');

  // a future day has not happened yet
  assert.equal(a.planRowStatusHtml(day({ date: '2099-01-01' })), '',
    'a day in the future is being judged');

  // a past day with nothing logged
  const missed = a.planRowStatusHtml(day({ date: '2000-01-01' }));
  assert.match(missed, /is-missed/, 'a past unlogged session is indistinguishable from a future one');
  assert.match(missed, /Missed/);

  // logged, and scored against what was asked
  const scored = a.planRowStatusHtml(day({ completed: true,
    actual: { km: 10, hr: 150, rpe: 5, pace: '5:30' } }));
  assert.match(scored, /is-score/, 'a scored session shows no score');
  assert.match(scored, /\d+%/, 'the score is not stated as a figure');

  /* ---------- THIS GUARD CITED A RULE THAT HAS SINCE CHANGED ----------
     It read "a missed day is quiet rather than red -- the same restraint
     .wk-day.is-missed already shows". That restraint is gone: the founder
     asked for missed sessions to carry evidence on This Week, and
     .wk-day.is-missed is drawn in --c-threshold now. So the premise this
     assertion rested on is false, and a guard that outlives its own
     reasoning is just a rule nobody remembers agreeing to.
     What survives is the LAW it was really protecting -- one colour per
     meaning, everywhere -- so it is pinned to the sibling rather than to a
     token, and the two can no longer drift apart. */
  assert.match(rule('.wk-day.is-missed'), /--c-threshold/,
    "This Week's missed day circle is no longer cherry -- re-decide the row with it");
  assert.match(rule('.pw-stat.is-missed'), /color:var\(--c-threshold\)/,
    'a missed session on Full Plan is grey again while This Week marks it in cherry');
  /* AND THE SCORE STAYS DIM even though the missed label went cherry. I
     tried greening it to match the day circle and this assertion was right
     to stop me: the circle carries no figure, so green there means "done".
     On this row the number is already the verdict, and colouring it makes
     the colour a second opinion about the number -- 61% in green reads as
     approval of a 61%. Done/missed is a state; a score is a measurement. */
  assert.match(rule('.pw-stat.is-score'), /color:var\(--ink-dim\)/,
    'the execution score is being colour-graded on the row');
});

/* SETTINGS WAS THE LAST SCREEN BUILT AS BOXES INSIDE BOXES.
 * ===========================================================================
 * Five lifted, rimmed cards, each holding a stack of rows. Today, This Week,
 * Full Plan and Valhalla have all shed exactly this, and the nesting was not
 * free: a card inset 16px holding rows inset a further 15px put every line
 * 31px from the edge, on a screen whose other views run to the 16px gutter.
 * Measured in Chromium: a row title moved from 63px to 48px.
 */
test('SETTINGS: the containers come off, and the rows take the gutter', () => {
  /* THE WRAPPER FIRST, for the reason Valhalla needed one. .stg-group is a
     .hub-card -- the same class Today's Next Move and the post-race panel
     wear -- so without a scope there is no way to restyle it HERE without
     restyling them. */
  assert.match(SRC, /return '<div class="view-settings">'\+/,
    'Settings returns a bare run of sections again, so .hub-card cannot be scoped to it');

  const deboxed = rule('.view-settings :is(.stg-group, .hub-card, .hub-card.tile-card)');
  ['background:none', 'border:0', 'border-radius:0', 'box-shadow:none'].forEach(d =>
    assert.ok(deboxed.indexOf(d) > -1, 'the Settings groups no longer drop ' + d));

  // the rows run to the gutter rather than being inset inside a frame
  assert.match(rule('.view-settings .ev-card.stg-row'), /padding:15px 0/,
    'the Settings rows are inset inside a container again');

  /* BETWEEN ROWS, NOT ABOVE EACH ONE. Stated as "a row that follows a row",
     because the first attempt cancelled the first row's border by naming
     what precedes it -- and the Connect group puts its row somewhere that
     match missed, so that group drew a rule under its own heading,
     separating it from nothing. The same bug .coach-signal already had. */
  assert.match(rule('.view-settings .ev-card.stg-row + .ev-card.stg-row'),
    /border-top:1px/, 'the Settings rows no longer separate from one another');
  assert.match(rule('.view-settings .ev-card.stg-row'), /border-top:0/,
    'a Settings group draws a rule under its own heading again');
});

/* THE BLOCK IS A ROUTE, AND FULL PLAN LEADS WITH THE BLOCK.
 * ===========================================================================
 * Two things this screen was not saying. The phases were a row of pills --
 * a SET, when a block is a sequence through them in order. And the hero said
 * "Week 10 - Taper", which is This Week's subject, on the screen whose whole
 * job is the block.
 */
test('the phases read as a carousel, one slide at a time', () => {
  /* The stepper this replaces said which phases exist, which is current and
     how far along the block was -- and said all of it at 11.5px, because
     four phases plus a race week share 320px when the row is a row. One
     full-width slide per phase buys the name at hero size, a sentence of
     its own, and a week list below that belongs to the phase on screen. */
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function renderPhaseRail');
  assert.ok(i > -1, 'the phase carousel is gone');
  const fn = src.slice(i, src.indexOf('\n}', i));
  /* ONE SLIDE PER PHASE GROUP, IN BLOCK ORDER -- the grouping itself is
     planPhaseGroups()' and is not re-derived here. */
  assert.match(fn, /planPhaseGroups\(\)/, 'the carousel invents its own phase grouping');
  assert.match(fn, /pp-slide-k/, 'the slide no longer names its phase');
  assert.match(fn, /phaseGroupMeta\(g\)/,
    'the slide writes its own week span and state instead of taking the one source');
  assert.match(fn, /phaseMessage\(g\.phase\)/,
    'the slide carries no phase-specific message, which is the point of a slide');
  /* THE PAGER IS THE WEEK'S. data-index/data-count and the .wk-track class
     are the contract wirePagerRail() reads; a second implementation of
     "full-width slides that track the finger" is the thing being avoided. */
  assert.match(fn, /data-index="'\+i\+'"/, 'the carousel does not say which slide it is on');
  assert.match(fn, /data-count="'\+groups\.length\+'"/, 'the carousel does not say how many slides it has');
  assert.match(fn, /wk-track/, 'the phase track is no longer the week rail\u2019s moving row');
  assert.match(fn, /data-hswipe="1"/, 'the page pager no longer stands down for the carousel');
  /* FEWER THAN TWO PHASES IS NOT A CAROUSEL. A maintenance block is one
     phase end to end, and a carousel of one is a control that cannot move. */
  assert.match(fn, /groups\.length < 2\) return ''/,
    'a one-phase block now gets a carousel of one slide');

  const a = app();
  const html = a.renderPhaseRail();
  const groups = a.planPhaseGroups();
  assert.equal((html.match(/class="pp-slide /g) || []).length, groups.length,
    'the carousel does not have exactly one slide per phase');
  groups.forEach(g => {
    assert.ok(html.indexOf('>' + g.phase + '<') > -1, 'no slide names ' + g.phase);
    assert.ok(html.indexOf(a.phaseMessage(g.phase)) > -1,
      g.phase + ' has no message on its slide');
  });
  /* EXACTLY ONE SLIDE IS CURRENT, and it is the one the dots agree with. */
  assert.equal((html.match(/class="pp-dot is-on"/g) || []).length, 1,
    'the dots do not mark exactly one phase as current');
});

test('a rail card\u2019s title is the hero title, in one declaration', () => {
  /* The founder's rule for a rail: "in the rails the titles should be white
     and big like they are in the heroes, same rules". The phase carousel is
     a rail of cards, so its title takes that declaration rather than a
     fourth set of numbers that happen to match today -- which is the whole
     reason EASY / SETTLE / CARB INTAKE were joined to it in the first place.
     ASSERTED AS MEMBERSHIP, not as 21.85px. A copy with identical values
     would pass a value check and still be a second definition. */
  const i = BARE.indexOf('.view-plan .pp-slide-k');
  assert.ok(i > -1, 'the phase slide title has no rule at all');
  const open = BARE.indexOf('{', i);
  const decl = BARE.slice(open + 1, BARE.indexOf('}', open));
  const head = BARE.lastIndexOf('.ws-rail .ws-h-presc:not(.font-mono)', i);
  assert.ok(head > -1 && head < i,
    'the phase slide title is no longer joined to the session rail card title — ' +
    'it has a declaration of its own, which is a second definition of the hero title');
  /* Nothing may sit between them but other arms of the same selector list. */
  const between = BARE.slice(head, i);
  assert.ok(between.indexOf('}') === -1,
    'a rule closed between the session card title and the phase slide title, so they ' +
    'are two declarations that merely look alike');
  ['font-size:21.85px', 'color:#FFFFFF', 'text-transform:uppercase', 'var(--label-face)']
    .forEach(d => assert.ok(decl.indexOf(d) > -1,
      'the shared hero-title declaration stopped setting ' + d));
});

test('a one-phase block gets the headed section, not a carousel of one', () => {
  /* A MAINTENANCE BLOCK IS ONE PHASE END TO END. There is nothing to
     carousel there and nothing for the carousel to select, so the screen
     keeps the headed, openable section it has always had -- and OPENS it,
     because there is no slide above naming the phase and nothing else on
     the screen for the weeks to be in the way of. A carousel of one slide
     would be a control that cannot move, with dots that cannot do anything.
     The accordion machinery -- expandedPhases, phaseGroupOpen,
     handleTogglePhase, the toggle-phase case -- is live for exactly this. */
  const a = app();
  a.state.setup.purpose = 'maintain';
  /* trainingPhase() names the week holding the goal day for the goal day, so
     a block with one is two groups however it is built. A real maintenance
     block has no goal effort -- blockArcFor('maintain') sets hasGoalEffort
     false -- and the fixture is a race block wearing a maintenance purpose,
     so its race day is removed to get the shape the generator would make. */
  a.state.days.forEach(d => { if (d.type === 'race') d.type = 'long'; });
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const groups = a.planPhaseGroups();
  assert.equal(groups.length, 1, 'the fixture did not produce a one-phase block');
  assert.equal(a.renderPhaseRail(), '', 'a one-phase block was given a carousel of one slide');

  const view = a.renderFullPlanView();
  assert.equal((view.match(/is-bare/g) || []).length, 0,
    'the one-phase block lost its heading to a slide that is not there');
  assert.match(view, /class="pp-head" data-action="toggle-phase"/,
    'the one-phase block has no way to open or close its weeks');
  assert.match(view, /class="pp-phase [^"]*is-open/,
    'the one-phase block renders closed, so the screen is a heading and nothing else');
  for (let w = 1; w <= a.totalWeeksInPlan(); w++){
    assert.ok(view.indexOf('id="week-' + w + '"') > -1, 'week ' + w + ' is missing');
  }
  /* ---- AND THIS IS WHY 'Maintain' NEEDS NO PHOTOGRAPH ----
     Every phase that can appear on a slide has one; Maintain does not, and
     the guard above skips a one-phase block rather than demanding a picture
     for it. That is only honest while Maintain CANNOT share a carousel with
     anything, and what makes that true is one line in the generator:
     a goal day is built only when the block is not steady, so a maintenance
     block has no race-type day, so trainingPhase() never names one of its
     weeks for the goal -- and a block whose every week is 'Maintain' is one
     group. Pinned here: change that line and this fires rather than a flat
     card quietly appearing in a carousel of photographs. */
  assert.match(src, /var isRace = !steady && arc\.hasGoalEffort && \(w===N\);/,
    'a steady block can now be given a goal day, which would put an unmapped ' +
    'Maintain slide in a carousel beside the goal week');
  assert.equal(a.state.days.filter(d => d.type === 'race').length, 0,
    'the maintenance fixture still has a race day, so this proves nothing');
  assert.ok(a.planPhaseGroups().every(g => g.phase === 'Maintain'),
    'a maintenance block has a phase other than Maintain');

  /* AND THE MACHINERY IT DEPENDS ON IS STILL WIRED. */
  assert.match(src, /case 'toggle-phase': handleTogglePhase/,
    'toggle-phase is no longer dispatched, so the one-phase heading is a dead control');
  assert.match(src, /case 'phase-pick': handlePhasePick/,
    'phase-pick is no longer dispatched, so the carousel dots are dead controls');
});

test('every phase the carousel can show carries a photograph, at both widths', () => {
  /* The founder's mapping: "Base - picture 3. Build - picture 4. Peak -
     picture 2. Taper - picture 1." The goal week takes the race/goal
     photograph they had already chosen, cut again at the slide's own
     aspect.
     ASSERTED FROM THE PHASES THE APP CAN ACTUALLY PRODUCE, not from a list
     written here -- a phase added to trainingPhase() with no picture would
     otherwise ship as the one flat card in a carousel of photographs, and
     nothing would say so. */
  const slugs = new Set();
  [['race', 16, 'full'], ['race', 12, '10k'], ['base', 10, '10k']].forEach(([purpose, weeks, dist]) => {
    const a = loadApp({ pinnedDate: '2026-10-05T09:00:00Z' });
    a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
    buildPlan(a, { weeks, startDate: '2026-07-06', distanceKey: dist, volume: 45 });
    a.state.setup.purpose = purpose;
    const groups = a.planPhaseGroups();
    /* A one-phase block renders no carousel at all, so it needs no picture;
       only a phase that can appear ON a slide is in scope here. */
    if (groups.length < 2) return;
    groups.forEach(g => slugs.add(a.phaseSlug(g.phase)));
  });
  assert.ok(slugs.size >= 4, 'the fixtures produced only ' + slugs.size + ' phases');

  const at = (slug, w) => new RegExp('\\.ph-' + slug + '\\b[^{]*\\{--phase-pic:url\\(\'/assets/([^\')]+-' + w + '\\.jpg)\'\\)');
  slugs.forEach(slug => {
    [820, 420].forEach(w => {
      const m = at(slug, w).exec(CSS);
      assert.ok(m, 'phase "' + slug + '" has no ' + w + 'px photograph — it would be the one ' +
        'flat card in a carousel of photographs');
      const file = path.join(ROOT, 'assets', m[1]);
      assert.ok(fs.existsSync(file), 'declared but missing: assets/' + m[1]);
      assert.ok(fs.statSync(file).size > 4096,
        'assets/' + m[1] + ' is ' + fs.statSync(file).size + ' bytes — that is not a photograph');
    });
  });
  /* THE TWO WIDTHS NAME THE SAME PHASES. A picture that exists at 820 and
     not at 420 is a card that loses its photograph on the phone, which is
     the only screen this product is for. */
  const widths = w => (CSS.match(new RegExp('\\.ph-[a-z-]+(?:, \\.ph-[a-z-]+)*\\{--phase-pic:url\\(\'/assets/[^\')]+-' + w + '\\.jpg\'\\)', 'g')) || [])
    .map(x => x.slice(0, x.indexOf('{'))).sort().join('|');
  assert.equal(widths(820), widths(420),
    'the 820px and 420px photograph sets name different phases');
  /* AND THE 420s ARE INSIDE THE PHONE QUERY, or they never swap in. */
  const mq = CSS.slice(CSS.indexOf('@media (max-width:480px){'));
  assert.ok(mq.indexOf('-420.jpg') > -1 && mq.indexOf('.ph-base') > -1,
    'the phone-width photographs are no longer inside the phone media query');
});

test('the picture runs edge to edge, and tracks the gutter it steps out of', () => {
  /* Founder: "I want the picture to literally be like Instagram! Full width
     no gaps."
     THE BREAKOUT HAS TO TRACK .wrap's GUTTER. -16px is that gutter negated
     and 32px is twice it; hard-coding either without reading the gutter is
     how a screen ends up with a seam down one side the day the gutter
     moves. Both numbers are derived here from .wrap itself rather than
     written down a second time.
     THE SHAPE IS UNCHANGED, only the width: 398x168 and 430x181 are the
     same 2.37:1, which is the aspect every phase photograph was cut to, so
     the cover fit still has nothing to throw away. Measured at 430px after
     the change: the rail sits at x=0, w=430, h=181 on a 430px viewport. */
  const gutter = /padding:0 (\d+)px/.exec(rule('.wrap'));
  assert.ok(gutter, 'the page gutter is no longer a single px value — re-derive the breakout');
  const g = Number(gutter[1]);
  const rail = rule('.view-plan > .pp-rail');
  assert.ok(rail.indexOf('margin-left:-' + g + 'px') > -1,
    'the rail breaks out by something other than the page gutter (' + g + 'px): ' + rail);
  assert.ok(rail.indexOf('margin-right:-' + g + 'px') > -1,
    'the rail breaks out on one side only, which is a seam down the other');
  assert.ok(rail.indexOf('width:calc(100% + ' + (g * 2) + 'px)') > -1,
    'the rail is not given back the width its negative margins took');

  /* THE SHAPE, AS THE RELATION THAT MAKES THE CROPS RIGHT. Pinned as the
     ratio and not as 181px, so the card may grow or shrink as long as the
     photographs are re-cut with it. */
  const h = /min-height:(\d+)px/.exec(rule('.pp-slide-body'));
  assert.ok(h, 'the slide no longer declares a height — the crops are cut to its aspect');
  const PHONE = 430;
  const aspect = PHONE / Number(h[1]);
  assert.ok(Math.abs(aspect - 2.37) < 0.06,
    'the slide is now ' + aspect.toFixed(2) + ':1 at ' + PHONE + 'px, against the 2.37:1 the ' +
    'photographs were cut to — re-cut them or put the height back');

  /* AND NOTHING ELSE ON THIS SCREEN STEPS OUT. One breakout is a decision;
     two is a screen with no gutter. */
  const outs = (BARE.match(/\.view-plan > \.[a-z-]+\{[^}]*margin-left:-\d+px/g) || []);
  assert.equal(outs.length, 1,
    'more than one Full Plan child breaks out of the page gutter: ' + outs.join(' | '));
});

test('the words on a phase slide are not left on the bare photograph', () => {
  /* The contrast itself is measured in Chromium against the real composited
     card -- the numbers and the method are written beside the veil in the
     sheet, because this suite has no browser to re-measure in. What IS
     checked here is every structural thing that measurement depended on, so
     none of it can be removed while the recorded figures stay in the
     comment looking authoritative.
     Mutation-checked against the probe: halving these stops put 9 of 12
     runs below the floor, removing them put all 12 there at 1.31:1. */
  const body = rule('.pp-slide-body');
  assert.match(body, /background-image:var\(--phase-pic, none\)/,
    'the slide no longer takes its photograph from the phase property');
  assert.match(body, /background-color:var\(--t-tile\)/,
    'a phase with no photograph is now a hole rather than the flat card');
  assert.match(body, /background-size:cover/, 'the photograph no longer fills the slide');
  assert.match(body, /overflow:hidden/, 'the photograph is no longer clipped to the rim');

  const veil = rule('.pp-slide-body::before');
  assert.match(veil, /position:absolute/, 'the veil is not over the picture');
  assert.match(veil, /inset:0/, 'the veil no longer covers the whole slide');
  assert.match(veil, /z-index:0/, 'the veil lost its place in the stack');
  assert.match(rule('.pp-slide-body > *'), /z-index:1/,
    'the words are no longer above the veil, so the veil is covering them');
  /* THE STOPS, AS A FLOOR. Not as exact values -- a deeper veil is always
     safe and a lighter one is what has to be re-measured. */
  const stops = (veil.match(/rgba\(8,6,10,\.(\d+)\)/g) || [])
    .map(x => Number('0.' + /\.(\d+)\)/.exec(x)[1]));
  assert.equal(stops.length, 3, 'the veil no longer has its three measured stops');
  [0.44, 0.66, 0.74].forEach((floor, i) => {
    assert.ok(stops[i] >= floor,
      'veil stop ' + (i + 1) + ' is ' + stops[i] + ', under the measured ' + floor +
      ' — re-measure in a browser before lightening it');
  });
  /* The glow on the title is doing real work on a photograph, which is the
     reason "same rules" takes the whole hero declaration rather than its
     size alone. */
  const i = BARE.indexOf('.view-plan .pp-slide-k');
  const decl = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', BARE.indexOf('{', i)));
  assert.match(decl, /text-shadow:/,
    'the slide title lost the glow that lifts it off a photograph');
});

test('the carousel opens on the phase the block is actually in', () => {
  /* The stepper opened nothing by default and Full Plan was a screen for
     seeing the shape of a block. With one phase on screen the shape IS the
     carousel, so landing on the current phase costs nothing and a screen
     that landed on week 1 of 16 would be a layer drawn over the wrong
     weeks. */
  const a = app();
  const groups = a.planPhaseGroups();
  const cur = a.currentWeekNum();
  const expect = groups.findIndex(g => g.weeks.indexOf(cur) !== -1);
  assert.ok(expect > -1, 'the fixture has no current phase to open on');
  assert.equal(a.planPhaseIndex(groups), expect,
    'the carousel does not open on the phase holding the current week');
  /* ...and a swipe or a tap is remembered, without reaching the account row. */
  a.renderApp = () => {};
  a.handlePhasePick(groups[groups.length - 1].phase);
  assert.equal(a.planPhaseIndex(groups), groups.length - 1,
    'picking a phase does not move the carousel');
  assert.equal(a.state.planPhaseSel, undefined,
    'where the athlete swiped to reached the saved state');
});

test('the week list below the carousel is the carousel\u2019s phase, and Race Day is nobody\u2019s', () => {
  /* The founder's structure: hero, then the phase carousel, then that
     phase's weeks, then Race Day. A week row is unchanged -- it is still
     the way in to the week screen -- and the phase heading goes, because
     the slide above it already says BASE in 21.85px and a chevron that
     opens what is already open is not a control. */
  const a = app();
  const groups = a.planPhaseGroups();
  a.renderApp = () => {};
  groups.forEach(g => {
    a.handlePhasePick(g.phase);
    const html = a.renderWeeksList(false, g.phase);
    assert.equal((html.match(/class="pp-phase /g) || []).length, 1,
      'the list shows more than one phase while ' + g.phase + ' is selected');
    assert.match(html, /class="pp-phase is-[a-z]+ is-open is-bare"/,
      g.phase + ' is listed closed, or still carries a heading the slide already wrote');
    assert.doesNotMatch(html, /data-action="toggle-phase"/,
      'the bare section kept the chevron that opens what is already open');
    g.weeks.forEach(w => {
      assert.ok(html.indexOf('id="week-' + w + '"') > -1,
        'week ' + w + ' is missing from ' + g.phase);
    });
    /* NO OTHER PHASE'S WEEKS, which is the whole claim of the layer. */
    groups.filter(o => o !== g).forEach(o => o.weeks.forEach(w => {
      assert.equal(html.indexOf('id="week-' + w + '"'), -1,
        'week ' + w + ' is listed under ' + g.phase);
    }));
    /* AND THE DESTINATION IS NOT FILTERED BY A PHASE. */
    assert.match(html, /class="race-event"/,
      'Race Day disappears when the athlete swipes off the phase it is in');
  });
  /* The week row still leads to the week screen and to nothing else. */
  const one = a.renderWeeksList(false, groups[0].phase);
  assert.match(one, /data-action="plan-open-week"/, 'a week row stopped being the way in');
});

test('under the carousel a week is a row, never a drawer', () => {
  /* THE DEFECT THIS CLOSES, MEASURED. Nothing in the markup has dispatched
     toggle-week since the week became a way IN -- grep the runtime for
     data-action="toggle-week" and there is none -- so .week.open was
     reachable only through initExpanded(), which opens the week holding
     today. Under a closed phase accordion nobody ever saw it. Under the
     carousel the current phase is on screen the moment the tab opens, so
     week 10's seven day rows appeared on the plan, un-closable, duplicating
     the week screen its own row leads to. Screenshotted at 430px before the
     fix: the Taper layer ran 7 rows and a repeated taper sentence deep.
     RENDERED WHOLE IT IS STILL A DRAWER, because that is what rendering the
     whole plan means. */
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.equal((src.match(/data-action="toggle-week"/g) || []).length, 0,
    'something dispatches toggle-week again — the drawer has a handle, so re-decide this');
  const a = app();
  const cur = a.currentWeekNum();
  a.initExpanded();                    /* the bootstrap the real app runs on load */
  assert.ok(a.expandedWeeks[cur], 'initExpanded no longer opens the week holding today');
  const g = a.planPhaseGroups().filter(x => x.weeks.indexOf(cur) !== -1)[0];
  const bare = a.renderWeeksList(false, g.phase);
  assert.ok(bare.indexOf('id="week-' + cur + '"') > -1, 'the current week is not in its own phase');
  assert.doesNotMatch(bare, /class="week[^"]* open/,
    'a week under the carousel unfolded a drawer nothing can close');
  const whole = a.renderWeeksList(true);
  assert.match(whole, /class="week[^"]* open/,
    'rendering the plan whole stopped opening its weeks');
  /* AND THE LEAF NO LONGER DECIDES. renderWeekAccordion() reading
     expandedWeeks itself is what made "open" mean two different things
     depending on which caller you were. */
  const fn = /function renderWeekAccordion\(weekNum, open\)\{[\s\S]*?\n\}/.exec(src)[0];
  assert.ok(fn.indexOf('expandedWeeks') === -1,
    'the week accordion reads expandedWeeks again instead of being told');
});

/* ---------- THE LAW THIS REPLACES TWO GUARDS WITH ----------
   There were two here: "Full Plan leads with the block, and the figures keep
   their period" and "This Week says the week; the block name belongs to Full
   Plan". Both pinned an asBlock branch that printed the block's name over
   "Week 10 of 11" -- and that subline is the exact line the founder had
   already struck off This Week's hero one tab to the left, so Full Plan was
   keeping a pattern that had been rejected.
   But the first guard had hold of something real, and it is kept: the
   figures under the hero are a WEEK's volume, so a hero that does not name
   the week "orphans the figures under it" -- its own words. That is a law
   about titles and numbers agreeing, not about which branch exists. It is
   asserted as that law now, so either answer to "what should this hero say"
   passes it honestly and no answer that measures one period while naming
   another does. */
test('the hero names the period its own figures cover', () => {
  /* ---------- THE LAW TWO OLDER GUARDS WERE REACHING FOR ----------
     One of them said it almost exactly: a hero that does not name the week
     "orphans the figures under it". That is a rule about a title and its
     numbers agreeing on a PERIOD -- not a rule about which branch exists,
     which is all the old assertions actually pinned.
     The hero is printed twice. This Week names a week and measures that
     week. Full Plan names the block and measures the whole block. Either is
     honest; naming one and measuring the other is the defect, and it is the
     defect the screen actually shipped with -- FULL MARATHON over 21 /
     46.5km, which is one week of a sixteen-week build. */
  const i = SRC.indexOf('function renderWeekHeroBlock(');
  assert.ok(i > -1, 'renderWeekHeroBlock is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  const split = body.indexOf('if (asBlock){');
  assert.ok(split > -1, 'the two periods are no longer distinguished');
  const weekSide = body.slice(0, split);
  const blockSide = body.slice(split, body.indexOf('\n  }', split));

  /* THIS WEEK: a week's title over a week's volume. */
  assert.match(weekSide, /var vol = weekVolume\(weekNum\);/,
    "This Week's hero no longer reads its figures from the week it names");
  assert.match(weekSide, /var title = 'Week '\+weekNum/,
    "This Week's hero stopped leading with the week whose volume it prints");

  /* FULL PLAN: the block's title over the block's volume. Summed across
     every week of the plan -- if the title goes back to the block while the
     figures stay on weekNum, this is what catches it. */
  assert.match(blockSide, /title = \(parts\.label \|\| title\)/,
    'the Full Plan hero no longer leads with the block');
  assert.match(blockSide, /for \(var bw = 1; bw <= totalWeeksInPlan\(\); bw\+\+\)/,
    'the Full Plan hero names the block but no longer measures it — it is back to ' +
    'printing one week of volume under a block heading');
  assert.match(blockSide, /planned = bPlanned; done = bDone;/,
    'the block totals are computed and then thrown away');
  assert.match(blockSide, /pct = planned > 0/,
    'the percentage and the bar are still the week\'s while the figures are the block\'s');

  /* NEITHER builds a subline. That line -- the block's name and the week
     count under a title -- is the one the founder struck off This Week, and
     Full Plan carried it for another two passes. */
  assert.ok(!/sub\.push\(|sub = \[['"]/.test(body),
    'the hero is building a subline again');

  /* AND THE WEEK-SCOPED EXCEPTION LINE STAYS ON THE WEEK. "1 session
     unlogged" counts weekNum's sessions; printed under block figures it
     claims one unlogged session in the entire build. */
  assert.match(body, /var notes = asBlock \? \[\] : weekStatusNotes\(weekNum\);/,
    'the week-scoped exception line is being printed under the block hero, where it ' +
    'reads as a count across the whole plan');

  assert.match(SRC, /renderWeekHeroBlock\(cur, true\)/,
    'Full Plan is no longer rendering the shared hero');

  /* The space the old subline occupied stays. Measured before it went:
     title ended y30, subline ran 33..53, figures began y64 -- with nothing
     between them the figures climb 23px and the hero reads as a smaller
     thing. */
  assert.match(CSS, /\.wk-hero-title \+ \.wk-hero-figs\{margin-top:34px;?\}/,
    'the air the subline left behind has been collapsed');
});

test('the day the block is for is a panel, not another row', () => {
  /* ---------- THIS GUARD PASSED FOR EVERY PASS WHILE THE PANEL WAS DEAD ----
     It asserted that the cherry panel's CSS TEXT existed. It did exist --
     tint, rim, glow, all of it -- and measured in Chromium the element
     painted background:none, border:0, border-radius:0, box-shadow:none,
     because the de-boxing rule further down the sheet listed .race-event and
     won on source order. A guard that reads the stylesheet for a declaration
     cannot tell whether anything reached the screen, and this one could not.
     So what is pinned now is the CONFLICT, not the declaration: the panel
     must exist AND nothing after it may strip it. */
  assert.match(BARE, /\.view-plan > \.race-event\{[^}]*var\(--cherry-tint\)/,
    'Race Day is flat on the page again');
  assert.match(BARE, /\.view-plan > \.race-event\{[^}]*border:1\.5px solid var\(--cherry\)/);

  /* THE LINE THAT KILLED IT. Any de-boxing list naming .race-event takes the
     panel away again, wherever in the sheet it sits. */
  const stripped = BARE.split('\n').filter(l =>
    /background:none/.test(BARE.slice(BARE.indexOf(l), BARE.indexOf(l) + 400)) &&
    /:is\(/.test(l) && /\.race-event\b/.test(l));
  assert.equal(stripped.length, 0,
    'a de-boxing rule lists .race-event again, so the cherry panel is dead code ' +
    'once more: ' + stripped.join(' | '));

  /* And the fill is the product's token for a cherry surface carrying white
     text -- 9.14:1 -- not a colour invented for this panel. */
  const panel = /\.view-plan > \.race-event\{([^}]*var\(--cherry-tint\)[^}]*)\}/.exec(BARE);
  assert.ok(panel, 'the lit panel rule has moved');
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(panel[1].replace(/rgba?\([^)]*\)/g, '')),
    'the Race Day panel is painted with a hand-set hex rather than the cherry tokens');
  /* LIT BY THE RIM, NOT BY THE FILL. Measured: this panel's interior is
     (18,19,22) -- the page -- against (103,41,58) for the --cherry-fill
     version that was tried and rejected. A filled slab this wide spends the
     cherry-means-progress meaning on a card scrolled past every day. */
  assert.match(panel[1], /box-shadow:0 0 16px var\(--cherry-dim\)/,
    'the Race Day panel lost the halo that is doing the lighting');
  assert.ok(!/--cherry-fill/.test(panel[1]),
    'the Race Day panel has been filled again — it is lit by its rim, see the note on the rule');

  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(src, /class="rd-flag"/, 'Race Day leads with a glyph again');

  /* THE STRATEGY IS NOT IN THIS PANEL. It is a control surface and this is
     the block's destination; it lives on the session whose execution blocks
     it reshapes. */
  const ev = src.slice(src.indexOf('function renderRaceDayEvent('));
  assert.ok(!/renderRaceStrategyPicker/.test(ev.slice(0, ev.indexOf('\n}\n'))),
    'the strategy picker is back inside the Race Day panel');
  const sess = src.slice(src.indexOf('function renderPlanSessionView('));
  assert.match(sess.slice(0, sess.indexOf('\n}\n')), /renderRaceStrategyPicker\(dd\)/,
    'the race session no longer carries the strategy, so it is homeless');

  /* And the way in says it once. The panel it sits in is titled RACE DAY. */
  assert.match(src, />View session '\+/,
    'the way into the race session is worded differently again');
  assert.ok(!/>View race session/.test(src),
    '"View race session" is back — the panel it sits in is already titled RACE DAY');
});

/* "This Week says the week; the block name belongs to Full Plan" stood here.
   Both halves of it are now in "the hero names the period its own figures
   cover" above: there is one hero and one title rule, so there is no longer
   a This-Week branch and a Full-Plan branch to assert separately. */

test('the week status chip shares an edge with the figure under it', () => {
  const chip = /\n  \.wk-chip\{([^}]*)\}/.exec(CSS);
  assert.ok(chip, '.wk-chip rule is gone');
  assert.match(chip[1], /right:0/,
    'the chip is inset from the gutter again. The percentage below it sits flush on the ' +
    "hero's right edge, so an inset chip is the one thing on this hero not lining up " +
    'with the edge everything else is measured from.');
  assert.match(chip[1], /position:absolute/,
    'the chip left the hero’s own coordinate space, so right:0 no longer means the gutter');
});

test('a missed day says so in the circle, the same way a done day does', () => {
  /* Done was already stated in the ring. Missed was a 55% dimming — the same
     thing a past rest day got — so a week scanned at a glance showed what was
     run and said nothing about what was not. It takes the red the product
     already uses for it: --c-threshold, the MISSED label's own colour.
     Both states are asserted as a PAIR, on the same two properties at the
     same two strengths, because "the same rule as completed" is the whole
     instruction and a guard that checks them separately would not notice
     them drifting apart. */
  const done = /\.wk-day\.is-done\{([^}]*)\}/.exec(CSS);
  const missed = /\.wk-day\.is-missed\{([^}]*)\}/.exec(CSS);
  assert.ok(done && missed, 'one of the two day-circle states has lost its rule');

  const recipe = body => ({
    border: (/border-color:color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%/.exec(body) || []).slice(1).join('@'),
    fill:   (/background:color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%/.exec(body) || []).slice(1).join('@'),
  });
  const d = recipe(done[1]), m = recipe(missed[1]);
  assert.ok(d.border && d.fill, 'the done circle no longer states itself through its tokens');
  assert.ok(m.border && m.fill, 'the missed circle no longer states itself through its tokens');
  assert.equal(d.border.split('@')[1], m.border.split('@')[1],
    'done and missed disagree on ring strength (' + d.border + ' vs ' + m.border + ')');
  assert.equal(d.fill.split('@')[1], m.fill.split('@')[1],
    'done and missed disagree on fill strength (' + d.fill + ' vs ' + m.fill + ')');
  assert.equal(d.border.split('@')[0], '--ok', 'the done circle left the done token');
  assert.equal(m.border.split('@')[0], '--c-threshold',
    'the missed circle is not using the red the MISSED label uses');
  assert.match(CSS, /\.day-status-label\.missed\{[^}]*color:var\(--c-threshold\)/,
    'the MISSED label changed colour, so the circle now matches nothing');
});

test('a rest day cannot be missed, and a declared day is never a reproach', () => {
  /* The circle painted every past unfinished day, rest days included. That
     was harmless while the state was a dimming and would be a red mark
     against a day the athlete was never asked to run — or worse, against one
     they told Valhalla about in advance. dayStatusLabel() has ranked
     Restricted above Missed since it was written, for exactly that reason. */
  const i = SRC.indexOf('function renderWeekDaySelector(');
  assert.ok(i > -1, 'renderWeekDaySelector is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  assert.match(body, /dd\.type !== 'rest' && !dd\.restricted\s*\)\s*\?\s*' is-missed'/,
    'the week circles are marking rest days or declared days as missed');
  assert.match(body, /' is-past'/,
    'past days that are not misses lost the quiet state, so they now look like days ahead');
  assert.match(CSS, /\.wk-day\.is-past\{opacity:\.55;?\}/,
    'the quiet past state is gone from the sheet');
  /* And the definition this copies, so the two cannot drift. */
  const lbl = SRC.indexOf("word = 'Missed'");
  assert.ok(lbl > -1, 'the Missed label is gone');
  assert.match(SRC.slice(lbl - 220, lbl), /dd\.type!=='rest'/,
    'the status label stopped excluding rest days, so the circle is now copying a ' +
    'rule that no longer says what it used to');
});

test('the taper line is coaching, lit like coaching', () => {
  /* It was a dim left-aligned sentence behind a gold "Taper:" label, sitting
     under the bar like a footnote to the numbers. It is not a footnote — it
     is Valhalla saying what the week is for, which is the Coach's Note's job
     on a session, so it takes the same treatment. */
  assert.ok(!/<b>Taper:<\/b>/.test(SRC),
    'the "Taper:" label is back. The title two lines above already says TAPER, so the ' +
    'label is the third time this hero names the same thing.');

  const rule = /\n  \.wk-taper\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, '.wk-taper rule is gone');
  assert.match(rule[1], /text-align:center/, 'the taper line is no longer centred');
  assert.match(rule[1], /position:relative/,
    'without a positioning context the glow below it escapes to the nearest ancestor');

  /* THE GLOW IS THE COACH'S NOTE'S, VALUE FOR VALUE. The two cannot share a
     rule — that one is inside the sixty-rule focused-session selector and
     this is the week hero — so what is held instead is that the numbers stay
     in step. A glow that drifts from the one it was copied from is two
     cherries on one product. */
  /* The selector is a LIST now: What's Next on Full Plan is the same kind of
     line -- Valhalla saying where this is going -- so it takes the same
     light from the same declaration rather than a second copy of the
     gradient. A copy is exactly how the taper SENTENCE ended up saying two
     different things on two screens. */
  const mine = /\.wk-taper::before(?:,\s*[^{]+)?\{([^}]*)\}/.exec(CSS);
  assert.ok(mine, '.wk-taper lost its cherry glow');
  assert.match(CSS, /\.wk-taper::before,\s*\n\s*\.view-plan \.yr-next::before\{/,
    "What's Next no longer shares the coaching glow declaration — if it has been given " +
    'its own copy, the two will drift');
  const next = /\n  \.view-plan \.yr-next\{([^}]*)\}/.exec(CSS);
  assert.ok(next, "What's Next has no block rule of its own");
  assert.match(next[1], /text-align:center/, "What's Next is no longer centred like the coaching it is");
  assert.match(next[1], /position:relative/,
    'without a positioning context its glow escapes to the nearest ancestor');
  const note = /\.how-note::before\{([^}]*)\}/.exec(CSS);
  assert.ok(note, "the Coach's Note glow this was copied from is gone");

  const radial = body => {
    const m = /radial-gradient\(([\s\S]*?)\);/.exec(body);
    return m ? m[1].replace(/\s+/g, ' ').trim() : null;
  };
  assert.ok(radial(mine[1]), 'the taper glow is no longer a radial');
  assert.equal(radial(mine[1]), radial(note[1]),
    "the taper glow has drifted from the Coach's Note it copies. Same stops, same " +
    'colours, or they are two different cherries on one product.');
  assert.equal((/filter:blur\(([^)]*)\)/.exec(mine[1]) || [])[1],
               (/filter:blur\(([^)]*)\)/.exec(note[1]) || [])[1],
    'the two cherry glows disagree on blur');
  assert.match(mine[1], /left:calc\(50% - 50vw\); width:100vw/,
    'the taper glow stopped spanning the screen, so it reads as a panel behind the words ' +
    'rather than as light');
});

test('the taper sentence is not on Full Plan at all', () => {
  /* Founder: "Remove the words under the gold bar." Those words were
     TAPER_COACHING_LINE in Full Plan's hero.
     THE TRAP THIS GUARDS. Taking it out of the hero on its own would have
     put the identical sentence back into the taper week's ROW, 300px lower
     on the same screen -- that row's copy was only ever suppressed BECAUSE
     the hero was speaking. The sentence would not have been removed, it
     would have moved. So both copies are off this screen, and this checks
     the whole screen rather than the hero.
     NOTHING IS LOST: This Week's hero still prints it, from the same
     constant, and that is the screen about the week the athlete is in. */
  const probe = app();
  const taperWeeks = [];
  for (let w = 1; w <= probe.totalWeeksInPlan(); w++) if (probe.isTaperWeek(w)) taperWeeks.push(w);
  assert.ok(taperWeeks.length, 'the fixture has no taper to prove this with');

  const screen = (pin) => {
    const a = loadApp({ pinnedDate: pin + 'T09:00:00Z' });
    a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {};
    buildPlan(a, { weeks: 12, startDate: '2026-07-01', distanceKey: '10k', volume: 40 });
    return a;
  };
  /* Pinned INSIDE the taper, which is the only state where either copy ever
     rendered -- the first version of a guard here never landed in one and
     was vacuously true for the case it was about. */
  const a = screen(probe.weekDateRange(taperWeeks[0]).start);
  assert.ok(a.isTaperWeek(a.currentWeekNum()), 'pinning inside the taper did not land in it');
  const full = a.renderFullPlanView();
  assert.ok(full.indexOf('Volume drops, but keep') === -1,
    'the taper sentence is back on Full Plan');
  assert.doesNotMatch(full, /class="wk-taper"/, 'the hero prints the taper panel again');
  assert.doesNotMatch(full, /class="taper-note"/, 'the week row prints the taper note again');

  /* AND THE SPACE IT LEFT IS KEPT. A hero that tightens up as a block
     enters its taper reads as a different hero. Measured at 430px before
     the words went: .wk-taper was 78px of box under a 14px margin. */
  assert.match(full, /class="wk-hero-gap"/,
    'the hero reclaimed the space the taper sentence left');
  const gap = rule('.wk-hero-gap');
  assert.match(gap, /height:78px/, 'the kept space is no longer the height of what it replaced');
  assert.match(gap, /margin-top:14px/, 'the kept space lost the margin that was above the words');
  /* Outside the taper there was never a panel there, so there is no gap
     either -- 92px of nothing on every non-taper block would be a bug. */
  const b = screen(probe.weekDateRange(1).start);
  assert.equal(b.isTaperWeek(b.currentWeekNum()), false, 'pinning before the taper landed in it');
  assert.doesNotMatch(b.renderFullPlanView(), /class="wk-hero-gap"/,
    'a block that is not in its taper now carries the taper panel\u2019s empty space');

  /* THIS WEEK IS UNTOUCHED, which is the whole reason removing it costs
     nothing. */
  assert.match(a.renderWeekHeroBlock(a.currentWeekNum(), false), /class="wk-taper"/,
    'This Week stopped printing the taper sentence too');
});

test('the taper sentence still fits two lines', () => {
  /* Measured in Chromium at 360, 412 and 430: two lines at every one, with
     48px of text at a 24px line-height. There is no static way to assert a
     rendered line count, so what is pinned is the thing that would break it
     — the length of the sentence. It has ~14 characters of headroom at
     360px; anything materially longer sets three lines on a narrow phone. */
  /* IT IS A SHARED CONSTANT NOW, not a literal in the markup. It was
     written out twice -- the hero and Full Plan's week note -- and the two
     drifted the moment the hero's copy was revised: This Week dropped the
     "Taper:" label and its bolt, Full Plan's week note kept both. One
     definition is what makes "the same decision" literally the same string,
     so the wrap is measured on that definition and both printers inherit it. */
  const m = /var TAPER_COACHING_LINE = ([\s\S]*?);\n/.exec(SRC);
  assert.ok(m, 'TAPER_COACHING_LINE is gone — re-measure the wrap wherever the copy now lives');
  const words = m[1].replace(/'\s*\+\s*\n?\s*'/g, '').replace(/^'|'$/g, '')
    .replace(/\\u2014/g, '—');

  /* ONE PRINTER NOW, AND IT STILL TAKES THE CONSTANT. A second copy of this
     sentence anywhere is the defect the constant exists to prevent, and that
     is unchanged; what changed is how many places print it.
     FULL PLAN NO LONGER DOES. Its hero's copy is what the founder asked be
     removed from under the gold bar, and the week row's copy went with it
     rather than becoming the same sentence 300px lower on the same screen.
     This Week keeps it: it is coaching about the week the athlete is in. */
  assert.ok(!/Volume drops, but keep/.test(SRC.replace(m[0], '')),
    'the taper sentence has been written out a second time — the two will drift again');
  assert.match(SRC, /class="wk-taper"><span>'\+TAPER_COACHING_LINE/,
    "This Week's hero is no longer printing the shared taper sentence");
  /* EXACTLY ONE PRINTER, counted off comment-stripped source -- this file's
     own prose quotes the identifier, and matching prose instead of code has
     produced a false pass in this suite before. One definition plus one use
     is two mentions; anything more is a second place printing it. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.equal((code.match(/TAPER_COACHING_LINE/g) || []).length, 2,
    'the taper sentence is printed in ' + ((code.match(/TAPER_COACHING_LINE/g) || []).length - 1) +
    ' places; This Week\u2019s hero is meant to be the only one');
  assert.ok(words.length <= 100,
    'the taper sentence is ' + words.length + ' characters. It set two lines at 360px at ' +
    '88; much past 100 and it wraps to three, which is the limit this layout was built to.');
  assert.match(words, /^Volume drops,/,
    'the taper sentence changed opening — if the copy is being rewritten, re-measure the wrap');
});

/* =========================================================================
 * THE FULL PLAN PASS — the founder's five, each pinned to the measurement
 * that settled it rather than to the number I happened to type.
 * ========================================================================= */

test('REPLACED: the phase track ran BETWEEN the marks', () => {
  /* The stepper's track is gone with the stepper. What replaced the law --
     a full-width slide, and dots that are controls rather than decoration
     and therefore carry the thumb floor -- is asserted below. */
  const slide = rule('.pp-slide, .wk-slide');
  assert.match(slide, /flex:0 0 100%/,
    'a phase slide is no longer full width, so the carousel shows two at once');
  /* ONE RULE, BOTH RAILS. The week's slide and the phase's are the same
     kind of thing and are declared together rather than twice. */
  assert.ok(rule('.view-plan .pp-rail, .view-week .wk-rail').indexOf('overflow:hidden') > -1,
    'the rail stopped clipping its track');
  assert.match(rule('.view-plan .pp-rail, .view-week .wk-rail'), /touch-action:pan-y/,
    'the rail took pan-x, so a vertical scroll starting on it is lost');
  /* THE DOTS REPLACED FOUR BUTTONS, so they have to still be buttons: the
     chips were tappable and keyboard-reachable and the carousel may not
     quietly make phase selection swipe-only. */
  assert.match(rule('.pp-dot'), /width:var\(--tap-min\)/,
    'the phase dot is a 6px tap target');
  assert.match(rule('.pp-dot::before'), /width:6px/,
    'the dot itself grew to the size of its target');
  const a = app();
  assert.match(a.renderPhaseRail(), /<button type="button" class="pp-dot[^"]*"[^>]*data-action="phase-pick"/,
    'the dots stopped being controls, so a phase can only be reached by swiping');
});

test('SUPERSEDED: the stepper geometry', { skip: 'the stepper was replaced by the phase carousel' }, () => {
  /* THE DEFECT, MEASURED. The track was drawn from one dot's centre to the
     next (left:-50% / right:50%) and relied on the dot's own opaque fill to
     cover the overlap. In Chromium at 412px that put the line 13px inside
     each 25px circle: it met the rim with no gap at all, which is what
     "cutting through the circle" was. After: it stops 5px clear on each
     side -- 81→141 between dots at 51–76 and 146–171.
     Pinned as the RELATION, not as 17.5px: whatever the dot's size becomes,
     the inset has to clear its radius with room to spare, because the whole
     point is that the line is decorative and must not touch. */
  const dot = rule('.pp-step-dot');
  const w = /width:(\d+(?:\.\d+)?)px/.exec(dot);
  assert.ok(w, 'the phase dot no longer declares a pixel width — re-derive the track inset');
  const radius = parseFloat(w[1]) / 2;

  const track = rule('.pp-step::before');
  const left = /left:calc\(-50% \+ (\d+(?:\.\d+)?)px\)/.exec(track);
  const right = /right:calc\(50% \+ (\d+(?:\.\d+)?)px\)/.exec(track);
  assert.ok(left && right,
    'the phase track is back to running centre-to-centre, so it meets each circle ' +
    'rim with no gap and reads as cutting through it');
  assert.equal(left[1], right[1], 'the track is inset further on one side than the other');

  const gap = parseFloat(left[1]) - radius;
  assert.ok(gap >= 3,
    'the track stops ' + gap + 'px from the circle rim. It is decoration between the ' +
    'phases and must visibly not touch them; under ~3px it reads as joined again.');

  /* AND IT SITS ON THE DOT'S CENTRE LINE. top was 12px against a centre at
     12.5px -- half a pixel low, which is the other half of why it looked
     like it clipped the rim rather than meeting it. */
  const top = /top:(\d+(?:\.\d+)?)px/.exec(track);
  assert.ok(top, 'the track no longer declares a top');
  const h = /height:(\d+(?:\.\d+)?)px/.exec(track);
  const mid = parseFloat(top[1]) + parseFloat(h[1]) / 2;
  assert.equal(mid, radius,
    'the track centres on ' + mid + 'px but the dot centres on ' + radius + 'px');
});

test('Full Plan breathes on the same measure as This Week', () => {
  /* Measured in Chromium: Full Plan was padding-top 22px / gap 9px against
     This Week's 26 / 18 -- half the rhythm of the tab beside it, which is
     what made two tabs of one app feel like two apps. Pinned to This Week's
     own declaration so the two cannot drift: change the law there and this
     fails until Full Plan follows. */
  const week = rule('.view-week');
  const plan = rule('.view-plan');
  const padOf = r => (/padding-top:(\d+)px/.exec(r) || [])[1];
  assert.equal(padOf(plan), padOf(week),
    'Full Plan and This Week no longer start at the same height');
  assert.match(plan, /gap:var\(--wk-gap\)/,
    'Full Plan is setting its own gap instead of taking This Week\'s --wk-gap');
  const gapOf = s => (/--wk-gap:(\d+)px/.exec(s) || [])[1];
  assert.equal(gapOf(BARE.slice(BARE.indexOf('.view-plan{--wk-gap'))),
               gapOf(BARE.slice(BARE.indexOf('.view-week{--wk-gap'))),
    'the two tabs set --wk-gap to different values');
});

test('the Race Day panel balances its two figures and carries them in white', () => {
  /* ---------- THE SHAPE CHANGED, AND SO DOES THIS GUARD ----------
     It used to pin the distance to Today's 57.6px hero clamp. That came
     from reading "give Race Day a hero feeling" as "make the number
     enormous"; the founder's own reference answers it differently -- the
     hero-ness is the LIT PANEL, and inside it RACE DAY and 42.2 KM sit on
     one row as equals. At 412px they cannot both be hero-scale anyway: a
     57.6px figure is ~160px and the title ~145px, which with the rule and
     the padding overruns the screen. So two columns forces the size, and
     the panel does the work the size used to.
     What is still worth holding is everything the ORIGINAL defect was: a
     13px --fs-meta figure in --ink-faint, set like a row of metadata for
     the event the whole block exists for. */
  const dist = rule('.view-plan > .race-event .race-event-dist b');
  const label = rule('.view-plan > .race-event .race-divider .l');
  const sizeOf = r => parseFloat((/font-size:(\d+(?:\.\d+)?)px/.exec(r) || [])[1]);

  assert.ok(sizeOf(dist) >= 24,
    'the Race Day distance is back to ' + sizeOf(dist) + 'px — a row figure for the ' +
    'day the block exists for');
  assert.equal(sizeOf(dist), sizeOf(label),
    'the panel\'s two figures no longer balance: RACE DAY is ' + sizeOf(label) +
    'px and the distance ' + sizeOf(dist) + 'px. They share a row as equals.');
  [['distance', dist], ['label', label]].forEach(([what, r]) => {
    assert.match(r, /color:#FFFFFF/, 'the Race Day ' + what + ' is no longer white on the lit panel');
    assert.match(r, /text-shadow:/, 'the Race Day ' + what + ' lost its backlight');
  });

  /* AND THE TWO COLUMNS. One row, divided -- what and when on the left, how
     far on the right. Stacking them is what made it a list item. */
  const panel = /\.view-plan > \.race-event\{([^}]*grid-template-columns[^}]*)\}/.exec(BARE);
  assert.ok(panel, 'the Race Day panel is no longer a grid');
  assert.match(panel[1], /grid-template-columns:1fr auto/,
    'Race Day has gone back to a single stacked column');
  /* Matched across the sheet, not with rule(): that helper returns the FIRST
     rule for a selector, and a selector may legitimately have more than one. */
  assert.match(BARE, /\.view-plan > \.race-event \.race-event-dist\{[^}]*border-left:1px solid/,
    'the hairline between the identity and the distance is gone');
  /* --cherry-line, which is what that token was drawn for: a dark ground. */
  assert.match(BARE, /\.view-plan > \.race-event \.race-event-dist\{[^}]*border-left:1px solid var\(--cherry-line\)/,
    'the hairline is no longer the cherry token the dark panel was built around');
});

test('every control on the race panel clears the thumb floor', () => {
  /* The custom differential steppers were 38px. They are pressed repeatedly
     to tune a number, which is the worst place in the app to be 6px short. */
  assert.match(rule('.rs-step'), /width:var\(--tap-min\); height:var\(--tap-min\)/,
    'the race strategy steppers are back to a hand-set size under the 44px floor');
});

test('tapping the Full Plan tab returns to the Full Plan', () => {
  /* Which of Full Plan's three screens is showing lives in two MODULE
     variables, not in state.view -- so tapping the tab while a session was
     open re-rendered that session and the tab appeared dead. The clear has
     to happen BEFORE the already-on-this-view early return, for exactly the
     reason the voice probe above it does: the case that needs it most is
     the one where state.view is already 'full'. */
  const i = SRC.indexOf('function handleSetView(');
  assert.ok(i > -1, 'handleSetView is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  const clear = body.indexOf('planSessionOpen = null');
  const earlyReturn = body.indexOf('if (state.view===view){');
  assert.ok(clear > -1, 'the Full Plan tab no longer clears the open session');
  assert.ok(body.indexOf('planWeekOpen = null') > -1,
    'the Full Plan tab no longer clears the open week');
  assert.ok(clear < earlyReturn,
    'the sub-screens are cleared after the already-on-this-view return, so tapping ' +
    'FULL PLAN while a session is open still does nothing — the exact bug this fixes');

  /* And the re-tap still has to repaint, or the state changes under a screen
     that never redraws. */
  assert.match(body, /if \(leftASubScreen\) renderApp\(\);/,
    'clearing the sub-screens no longer repaints, so the tab clears state and shows ' +
    'the old screen anyway');
});

test('every phase starts closed', () => {
  /* The current phase used to open itself. On a four-phase block that put a
     section's worth of week rows between the stepper and Race Day every
     time the screen was opened -- and this screen is for the SHAPE of the
     block: the stepper says which phase is current, the hero says how far
     through it is, and a phase is what you open to go and find a week. */
  const a = app();
  const groups = a.planPhaseGroups();
  assert.ok(groups.length >= 2, 'the fixture block no longer has phases to close');
  groups.forEach(g => {
    assert.equal(a.phaseGroupOpen(g, false), false,
      'the ' + g.phase + ' section opens itself on load');
  });
  const html = a.renderWeeksList();
  assert.equal((html.match(/class="pp-phase [^"]*is-open/g) || []).length, 0,
    'a phase section is rendered open on a fresh load');

  /* A TAP STILL OPENS IT, and forceOpenAll still wins -- that is how the
     whole plan is rendered open where something needs all of it at once,
     and it is not a default. */
  a.handleTogglePhase(groups[0].phase);
  assert.equal(a.phaseGroupOpen(groups[0], false), true,
    'tapping a phase no longer opens it');
  assert.equal(a.phaseGroupOpen(groups[1], true), true,
    'forceOpenAll no longer opens a phase');
});

test('the week list runs in columns, not wherever each row’s figures end', () => {
  /* MEASURED AT 412px BEFORE: the volume block sat at x280-316 on a row
     reading "0/18" and at x226-307 on one reading "31.5/34.5" -- its left
     edge moving 54px from row to row, because both right-hand cells were
     flex:none and sized to their own content. Down a list of eleven weeks
     that is the ragged middle the founder asked to even out.
     Fixed widths, and the volume CENTRED in its own: the figure runs from
     four characters to nine and the only way it sits still is to be centred
     in a box that does not move. */
  const vol = rule('.view-plan .pp-body .week-vol');
  const pct = rule('.view-plan .pp-body .week-pct');
  assert.match(vol, /flex:0 0 \d+px/,
    'the week volume is sized to its own content again, so the column goes ragged');
  /* NOT CENTRED ANY MORE, AND THAT IS THE ROW CHANGING UNDER IT. When the
     volume sat above its own unit in a stacked cell, centring was what kept
     a four-character figure and a nine-character one in the same place. On
     a single row the figure is one item in a line of items and it starts
     where its column starts, like every other. The column is still FIXED,
     which is what this test is actually for. */
  assert.match(vol, /text-align:left/,
    'the volume is centred in a single-row layout, so it floats away from the column ' +
    'edge the rest of the row aligns to');
  assert.match(pct, /flex:0 0 \d+px/,
    'the completion figure is sized to its own content again');

  /* THE BOX HAS TO FIT THE WIDEST REAL FIGURE. "63.2/69.2" measured 81px on
     an eleven-week block; under that and the number clips or wraps. */
  /* SIZED FOR THE WIDEST FIGURE AN ATHLETE CAN HAVE, not the widest in a
     test block. "123.4/145.6" -- a 120km week -- measures 100px at
     --fs-data against the 84px my fixture's "63.2/69.2" needed. Size this
     to the fixture and the first athlete running three figures clips. */
  const w = parseInt(/flex:0 0 (\d+)px/.exec(vol)[1], 10);
  assert.ok(w >= 100,
    'the volume column is ' + w + 'px. A 120km week prints "123.4/145.6", which needs ' +
    '100px at this size, so this clips it.');

  /* AND THE LABEL KEEPS ENOUGH ROOM. Fixing the right-hand columns takes
     width from .week-meta, which carries "Fitness Checkpoint". */
  const a = app();
  const html = a.renderWeeksList(true);
  assert.ok(html.indexOf('week-meta') > -1, 'the week row no longer has a meta column');
});

test('the status chip sits on the hero title’s line', () => {
  /* MEASURED AT 412px: the title's cap centre was 112.2 and the chip's 121
     -- 8.8px low on This Week and Full Plan alike, which reads as two
     things on two lines. The cause is that the hero's padding-top moves the
     title, an in-flow child, and does NOT move the chip, which is absolute
     against the padding box. So they share one token: whatever shifts the
     title shifts the chip by the same amount. */
  const hero = rule('.wk-hero');
  assert.match(hero, /--wk-hero-top:\s*\d+px/,
    'the hero no longer states its content offset as a token the chip can read');
  assert.match(hero, /padding:var\(--wk-hero-top\)/,
    'the hero padding stopped using the token, so the chip can drift from the title again');
  assert.match(rule('.wk-chip'), /top:var\(--wk-hero-top\)/,
    'the chip is positioned by a number of its own again — it was 8.8px below the title');
});

test('every wide glow carries a dither, and it is not inside the blur', () => {
  /* MEASURED at device pixel ratio 3, across the glow: one 8-bit value
     survived 20 device pixels, then 14, 12, 11 — nine runs of 10px or more.
     Those runs are the rings. Four treatments measured:
       as it ships      widest 20px   steps>=6px 49   >=10px  9
       12 eased stops   widest 17px   steps>=6px 64   >=10px  9
       harder + blur30  widest 26px   steps>=6px 51   >=10px 15   (peak 86->68)
       fine dither      widest  9px   steps>=6px  5   >=10px  0
     More stops cannot help: the banding is 8-bit quantisation, and the
     browser rounds to the same 255 levels between any two stops. */
  const i = BARE.indexOf('.view-planhq .v-call::after');
  assert.ok(i > -1, 'the dither layer is gone — the wide glows band again');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));
  assert.match(body, /feTurbulence/, 'the dither is no longer a noise texture');
  assert.match(body, /opacity:\.0\d/, 'the dither opacity has left the sub-perceptual range');

  /* IT MUST BE ITS OWN LAYER. Inside the ::before, filter:blur() erases
     exactly the high-frequency detail that does the work. */
  assert.ok(!/filter:blur/.test(body),
    'the dither layer is being blurred, which removes the grain that stops the banding');
  assert.ok(!/mix-blend-mode/.test(body),
    'the dither has taken a blend mode again — it measured no better than plain opacity ' +
    'and forces a compositing layer on every glow in the app');

  /* AND IT REACHES THE GLOWS THAT WERE MEASURED. */
  const sel = BARE.slice(i - 400, BARE.indexOf('{', i));
  ['.how-note::after', '.exec-review-card::after', '.wk-taper::after', '.yr-next::after']
    .forEach(s2 => assert.ok(sel.indexOf(s2) > -1, 'the dither no longer reaches ' + s2));
});

test('the dither feathers out before the box edge, so there is no rectangle', () => {
  /* THE DITHER SHIPPED AS A RECTANGLE and the founder saw it: 100vw wide,
     the element's full height, ONE opacity everywhere, hard edges all round.
     Measured at dpr 3 in a column 20px from the screen edge -- far enough
     out that the radial has reached zero and only the grain is painting --
     bare canvas read 19.7 and inside the box read 23.6. Four levels of
     uniform lift with a straight edge under it, full width of the phone.
     The light was never the problem; the grain layer was given none of the
     discipline every ::before here already had.
     Nine mask profiles were measured on BOTH numbers, because the grain out
     in the tail is what drew the rectangle AND what killed the rings:
       flat, unmasked              EDGE 4.36    8px /  3 / 0
       fade from 40% of a 48x46    EDGE 0.61    8px /  9 / 0
       fade from 82% of a 49x48    EDGE 2.97    8px /  5 / 0
       glow-shaped 46x43 tail 84%  EDGE 1.02    7px /  5 / 0
       glow-shaped 46x43 tail 70%  EDGE 0.64    8px /  7 / 0   <- shipped
       glow-shaped 44x41 tail 70%  EDGE 0.27   17px / 12 / 2
     (No dither at all bands 20px / 49 / 9, for scale.) */
  const i = BARE.indexOf('.view-planhq .v-call::after');
  const body = BARE.slice(BARE.indexOf('{', i) + 1, BARE.indexOf('}', i));

  assert.match(body, /-webkit-mask-image:radial-gradient/,
    'the grain layer has lost its mask — it is a flat 100vw rectangle again, which is the box');
  assert.match(body, /[^-]mask-image:radial-gradient/,
    'only the -webkit- mask is set; the standard property has to be there too');

  /* THE MECHANISM, not the presence. A mask still carrying alpha where it
     meets the element's edge does not remove the rectangle — it moves the
     rectangle into the mask. Under 50% on BOTH axes is the whole law, and
     it is the same law every glow ::before on this screen already obeys. */
  const shape = body.match(/-webkit-mask-image:radial-gradient\((\d+)% (\d+)% at/);
  assert.ok(shape, 'the mask is no longer an explicit two-axis ending shape');
  assert.ok(+shape[1] < 50, 'the grain mask is ' + shape[1] + '% wide — at or over 50% it is cut by the box edge and the rectangle is back');
  assert.ok(+shape[2] < 50, 'the grain mask is ' + shape[2] + '% tall — at or over 50% it is cut by the box edge and the rectangle is back');
  assert.match(body, /-webkit-mask-image:radial-gradient\([^;]*transparent 100%\)/,
    'the grain mask no longer ends at transparent, so it stops dead instead of feathering');

  /* AND IT STILL COVERS THE LIGHT. The mask is the glow's own shape; a mask
     materially tighter than the glow stops dithering the part of the fade
     that bands (44x41 measured two rings back over 10px). */
  const glow = BARE.match(/\.wk-taper::before,[\s\S]*?radial-gradient\((\d+)% (\d+)% at/);
  assert.ok(glow, 'the taper glow is no longer an explicit two-axis radial');
  assert.ok(+shape[1] >= +glow[1] - 1 && +shape[2] >= +glow[2] - 1,
    'the grain mask (' + shape[1] + 'x' + shape[2] + ') has shrunk below the glow it dithers (' +
    glow[1] + 'x' + glow[2] + ') — the outer fade bands again');
});

test('a week is one row, at one size, in fixed columns', () => {
  /* Measured in place at --fs-data (15px), widest of each column:
       label 141   range 136   volume 106   pct 28   chevron 18   gaps 40
       = 467px against 380px available.
     The row cannot hold all five at 15px, and truncating a week's NAME so a
     date can fit is the wrong trade. Saying the month once took the range
     to 98, dropping the repeated unit took the volume to 73, and the rest
     came from the size. Worst row — Fitness Checkpoint, which carries both
     the longest name and the one range that crosses a month — now needs
     347px, which fits with four 7px gaps. */
  const body = rule('.view-plan .pp-body');
  /* AND IT IS THE PRODUCT'S OWN TIER, not a number picked for this row.
     Swept in Chromium against the widest row there is: 15px needs 363px of
     the 380 available and 16px needs 383. --fs-data is 15px. */
  assert.match(body, /--fs-row:var\(--fs-data\)/,
    'the row has taken a size of its own again instead of the metric tier every other ' +
    'figure in the app reads at');
  ['.view-plan .pp-body .week-phase', '.view-plan .pp-body .week-range',
   '.view-plan .pp-body .week-vol .v', '.view-plan .pp-body .week-pct'].forEach(sel => {
    assert.match(rule(sel), /font-size:var\(--fs-row\)/,
      sel + ' is sized on its own again — every item on this row carries the same weight');
  });
  assert.match(rule('.view-plan .pp-body .week-num'), /display:none/,
    'the big numeral is back in front of a label that already says which week it is');
  assert.match(rule('.view-plan .pp-body .week-meta'), /display:flex/,
    'the label and its dates have gone back to stacking, so the row is two lines again');
  assert.match(rule('.view-plan .pp-body .week-vol .l'), /display:none/,
    'the unit is back on the row — the same three characters on all eleven of them');

  /* THE RANGE NAMES ITS MONTH ONCE. */
  assert.match(SRC, /function weekRangeLabel\(range\)/, 'the compact week range is gone');
  const a = app();
  const same = a.weekRangeLabel({ start: '2026-09-14', end: '2026-09-20' });
  assert.ok(!/Sep[\s\S]*Sep/.test(same), 'a single-month range names September twice: ' + same);
  const cross = a.weekRangeLabel({ start: '2026-09-28', end: '2026-10-04' });
  assert.match(cross, /Sep/, 'a crossing range lost its first month');
  assert.match(cross, /Oct/, 'a crossing range lost its second month');
});

test('a week row is still a thumb target once it is one line', () => {
  /* Flattening two stacked lines into one took .week-head from 56px to 40 --
     under the 44px floor, on the only way into a week. Caught by the
     Chromium sweep, not by any of the guards above it, because every one of
     them measures the row's CONTENT and none measured the row. */
  assert.match(rule('.view-plan .pp-body .week-head'), /min-height:var\(--tap-min\)/,
    'the week row has no floor again — flattening it to one line puts it under 44px');
});

test('the list calls the checkpoint week by its number', () => {
  /* "Fitness Checkpoint" measured 127px on a row whose whole budget is 380
     -- 84px more than any other label, and the single item deciding how
     large every other item on every other row could be. Called Week 5 it is
     43px, and the row went from 13.5px to the app's own 15px metric tier.
     THE NAME IS NOT LOST. weekPhaseLabel() still returns it everywhere the
     week is read rather than scanned -- the week screen, the export, the
     coach's summary -- and the session inside it is still a Fitness
     Checkpoint and still says so on its own card. */
  const a = app();
  const cp = a.state.days.filter(d => d.type === 'checkpoint')[0];
  if (!cp) return;                       // this block has no checkpoint; nothing to prove
  assert.equal(a.weekRowLabel(cp.week), 'Week ' + cp.week,
    'the plan list is naming the checkpoint week again instead of numbering it');
  assert.equal(a.weekPhaseLabel(cp.week), 'Fitness Checkpoint',
    'the checkpoint week has lost its name everywhere, not just on the list row');
  const html = a.renderWeeksList(true);
  assert.ok(!/>Fitness Checkpoint</.test(html),
    'the list row is printing the long name again');

  /* ONLY THE CHECKPOINT. Numbering every row would buy more width and cost
     the two weeks that genuinely are not "week N" -- the goal week and the
     taper -- their names, which is the identity test/taperGoalWeekGrouping
     exists to protect one surface over. */
  const total = a.totalWeeksInPlan();
  const goal = a.state.days.filter(d => d.type === 'race')[0];
  if (goal) assert.equal(a.weekRowLabel(goal.week), a.weekPhaseLabel(goal.week),
    'the goal week has been numbered like any other — it is the week the block exists for');
  const taperWeek = [];
  for (let w = 1; w <= total; w++) if (a.isTaperWeek(w) && !a.weekPhaseLabel(w).match(/^Week /)) taperWeek.push(w);
  taperWeek.forEach(w => assert.equal(a.weekRowLabel(w), a.weekPhaseLabel(w),
    'week ' + w + ' has been numbered, losing the phase name the list row carries'));
});

test('a phase says its state in colour, and still says it in words', () => {
  /* "Weeks 3 - 7 . Completed" was a 12px line under every phase name saying
     two things the screen already says. The RANGE is on the stepper at the
     top of this view -- W1-2, W3-7, W8-9, W10-11, under the phase it
     belongs to -- and the week rows inside are numbered. The STATE becomes
     the colour of the name, the way This Week already says it.
     Measured at 412px with every phase open: done names rgb(155,192,140)
     (--ok-text), the current one rgb(245,208,97) (--gold-bright), head
     height 49px against the 44px floor, and the chevron's centre 0.0px from
     the name's on all four. */
  const a = app();
  const html = a.renderWeeksList(true);
  assert.ok(html.indexOf('class="pp-meta"') === -1,
    'the phase subtitle is back under the name');
  assert.ok(!/Weeks \d+ – \d+ · (Completed|Now|Ahead)</.test(html.replace(/<span class="sr-only">[^<]*<\/span>/g, '')),
    'the phase range and state are being printed visibly again');

  /* COLOUR ALONE IS NOT A SIGNAL. The words it replaced stay in the button
     for a screen reader, which is also why phaseGroupMeta() is still the
     one place they are written. */
  assert.match(html, /<span class="sr-only">Weeks [^<]*(Completed|Now|Ahead)<\/span>/,
    'the state is now carried by colour alone — nothing announces it');

  /* DONE IS THE DAY CIRCLE'S GREEN. --ok is the ring and field on
     .wk-day.is-done; --ok-text is that same colour at text contrast. */
  assert.match(rule('.pp-phase.is-done .pp-name'), /color:var\(--ok-text\)/,
    'a completed phase is no longer green, so nothing says it is complete');
  assert.match(rule('.pp-phase.is-now .pp-name'), /color:var\(--gold-bright\)/,
    'the current phase has lost its gold, so done and now read the same');
  assert.match(rule('.wk-day.is-done'), /var\(--ok\)/,
    'the day circle has moved off --ok, so the phase name no longer matches it');

  /* THE CHEVRON IS IN LINE WITH THE TITLE because the head centres a
     single-line text block; a second line returning would move it off. */
  assert.match(rule('.pp-head'), /align-items:center/,
    'the phase head no longer centres its row, so the chevron drifts off the title');
});

test('a week is a week on whichever screen it is', () => {
  /* Full Plan's week screen was a list of seven rows while This Week was
     circles, a swipeable card and a way in: two presentations of one object.
     On the founder's call they are the same thing now, built from the SAME
     functions rather than a second set that resembles them --
     renderWeekDaySelector and renderWeekSessionBox, both of which already
     took a weekNum rather than assuming the current week, which is what
     made this a re-use and not a rewrite.
     Measured on the rebuilt screen at 412px: container 18px gap / 26px top
     (This Week's rhythm, not the plan screens' 12/18), hero 158px with a
     144px ring (so the focused-session scope is reaching it), and the way
     in rendering at 52px in cherry — the same button Race Day carries. */
  const a = app();
  const html = a.renderPlanWeekView(3);
  assert.match(html, /class="view-plan-week view-week"/,
    'the week screen no longer wears .view-week, so none of This Week’s scope reaches it');
  assert.match(html, /class="wk-days"/, 'the week screen has lost the day circles');
  assert.match(html, /class="wk-rail"/, 'the week screen has lost the swipeable session box');
  assert.ok(html.indexOf('pw-rows') === -1,
    'the week screen is listing rows again as well — two presentations of one week');

  /* THE ACCORDION STILL LISTS. Inside a phase on Full Plan a week is one
     row, and that is a different job from the week's own screen. */
  assert.match(a.renderWeeksList(true), /class="pw-rows"/,
    'the phase accordion has stopped listing its weeks');

  /* A WEEK THAT IS NOT THIS WEEK STILL RESOLVES A DAY. weekSelectedDay()
     falls back to today-if-in-this-week and otherwise the week's first day,
     so a past week opens on its own first day with no new state to keep. */
  const past = a.renderPlanWeekView(1);
  assert.match(past, /class="wk-day/, 'a past week renders no day circles');
  assert.match(past, /wk-slide/, 'a past week resolves no session to show');
});

test('a day circle is one size, whatever else the week contains', () => {
  /* This Week always has seven. Full Plan's week screen does not: the first
     week of a block can be three days, and the race week is six. At
     flex:1 1 0 with aspect-ratio 1/1 that gave each circle a THIRD of the
     row -- 122px against 48px, as tall as it was wide -- and the week
     opened on three dinner plates.
     The cap is a seventh of the row, which is what a circle measures in a
     seven-day week, and the row packs from the left. For seven the two are
     identical: seven caps plus six 7px gaps is exactly 100%. */
  assert.match(rule('.wk-day'), /max-width:calc\(\(100% - 42px\) \/ 7\)/,
    'a day circle is uncapped again, so a short week draws it oversized');
  assert.match(rule('.wk-days'), /justify-content:flex-start/,
    'a short week’s circles are being strung across the full width again');
});

test('a day carousel steps within the week it is showing', () => {
  /* The commit called weekStepDate(currentWeekNum()), which was the same
     thing while This Week was the only screen with a carousel. Full Plan's
     week screen now has one, and there the two differ: looking at week 11
     and swiping stepped within week 10, the date that came back was not in
     the week on screen, weekSelectedDay() fell through to the week's first
     day, and the card did not move at all. Driven with a real touch
     sequence before and after: This Week S8 -> S7 both times; the plan week
     M9 -> M9 before, M9 -> T10 after. */
  const a = app();
  assert.match(a.renderPlanWeekView(3), /class="wk-rail" data-hswipe="1" data-week="3"/,
    'the rail no longer carries the week it is showing');
  const SRC2 = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(SRC2, /railWeek = parseInt\(rail\.getAttribute\('data-week'\), 10\)/,
    'the swipe commit has stopped reading the rail’s own week');
  assert.ok(!/weekStepDate\(currentWeekNum\(\)/.test(SRC2),
    'the swipe steps within the CURRENT week again, so it cannot move on any other week’s screen');
});

test('a rest day in the week carousel is the rest day Today shows', () => {
  /* The carousel branched away from the hero because a rest day had no hero
     -- renderDayHeroBlock() returned '' for a day with no ring and no
     distance. It has one now, so the branch was a workaround for a hole
     that is filled, and leaving it meant Today showed one rest day while
     This Week and Full Plan showed another. */
  const a = app();
  const rest = a.state.days.filter(d => d.type === 'rest' && a.displayCardTitle(d) === 'Rest Day')[0];
  if (!rest) return;
  a.weekSelectedDate = rest.date;
  const box = a.renderWeekSessionBox(a.weekNumForDate ? a.weekNumForDate(rest.date) : 1);
  const SRC2 = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(SRC2.indexOf("class=\"wk-rest\"") === -1,
    'the week carousel renders its own rest day again instead of the shared hero');
  assert.ok(/th-hero|th-ring/.test(box) || !box,
    'the rest day in the carousel has no hero');
});
