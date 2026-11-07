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
  const i = BARE.indexOf(':is(.view-plan, .view-plan-week, .view-plan-session)\n    :is(.pw-progress, .pw-row, .zone-card, .hub-card, .race-event, .race-strategy, .week, .pp-phase)');
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
  /* ---- THE CHIPS ARE A STEPPER NOW, AND THE LIGHT IS UNCHANGED ----
     They were four pills: they said which phases exist and which is
     current, and nothing about the shape between them, when a block is a
     journey through its phases in order. The marks are joined by a track,
     the completed span of it in cherry because cherry is progress here, and
     each phase carries its own week range.
     What this test protected travels with them: the two state lights are
     still --glow-done-mark and the gold, from the same tokens the week rows
     use, so done and current mean the same thing in both places. */
  assert.match(ruleFor('.pp-step.is-done .pp-step-dot{'), /box-shadow:var\(--glow-done-mark\)/,
    'a completed phase is no longer lit green');
  assert.match(BARE, /--glow-done-mark:[^;]*var\(--ok\)/,
    'the shared mark light stopped naming the done colour');
  assert.match(ruleFor('.pp-step.is-now .pp-step-dot{'), /box-shadow:[^;]*var\(--gold\)/,
    'the current phase is no longer lit gold');
  assert.match(ruleFor('.pp-step.is-done .pp-step-dot{'), /var\(--ok-text\)/,
    'the tick hand-sets its green again instead of naming the token');
  assert.doesNotMatch(BARE, /\.pp-step[^{]*\{[^}]*#9BC08C/,
    'the literal green came back on the phase mark');
  /* THE TRACK IS THE NEW PART, and the only thing on this screen reporting
     progress THROUGH the block, so it is held here: cherry, mixed down, and
     lit only on the span the athlete has already crossed. */
  assert.match(ruleFor('.pp-step.has-track-done::before{'), /var\(--cherry\)/,
    'the completed span of the phase track is not cherry');
  assert.match(ruleFor('.pp-step.has-track-done::before{'), /color-mix/,
    'the track uses cherry neat, which is the loudest thing on the screen');
  assert.match(ruleFor('.pp-step::before{'), /opacity:0/,
    'the first phase draws a track reaching back to nothing');
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
  /* ...and the pattern they should follow is in the sheet and working. */
  assert.match(BARE, /\.pp-step\.is-now \.pp-step-dot\{[^}]*color-mix\(in srgb, var\(--gold\)/,
    'the current phase mark hand-sets its gold again');
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

  /* IT STATES, IT DOES NOT GRADE. A missed day is quiet rather than red --
     the same restraint .wk-day.is-missed already shows -- and the score sits
     in the dim data face the rest of the row uses. The coaching read of a
     block has its own surfaces; a list row is not one. */
  assert.match(rule('.pw-stat.is-missed'), /color:var\(--ink-faint\)/,
    'a missed day is being shouted at the athlete');
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
test('the phases read as a route through the block', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  const i = src.indexOf('function renderPhaseSteps');
  assert.ok(i > -1, 'the phase stepper is gone');
  const fn = src.slice(i, src.indexOf('\n}', i));
  assert.match(fn, /data-action="toggle-phase"/,
    'a step stopped opening its own phase, which is all the pill ever did');
  assert.match(fn, /pp-step-w/, 'the steps no longer carry their week ranges');
  /* The lit span must end at the phase the athlete is IN, not run past it,
     so it is decided by the step BEFORE each gap rather than by the step
     drawing it. */
  assert.match(fn, /phaseGroupState\(groups\[i-1\]\) === 'done'/,
    'the track is lit from the wrong end, so it runs past the current phase');
});

test('Full Plan leads with the block, and the figures keep their period', () => {
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.match(src, /renderWeekHeroBlock\(cur, true\)/,
    'Full Plan is no longer asking for the block-led hero');
  assert.match(src, /function renderWeekHeroBlock\(weekNum, asBlock\)/);
  const i = src.indexOf('  if (asBlock){');
  const branch = src.slice(i, i + 420);
  /* ONLY THE TYPE SWAPS. The volume, the percentage and the bar are read
     from the one weekVolume() call either way -- which is the whole reason
     This Week and Full Plan share this function instead of each printing
     their own totals for the same week. */
  assert.ok(!/weekVolume|pct|planned|done\s*=/.test(branch),
    'the block-led hero is recomputing figures, so the two screens can now ' +
    'print different totals for the same week');
  /* And the week is NOT dropped, although the mock drops it: the figures
     under it are this WEEK's, and a bar with no period named reads as
     progress through the block -- a different, wrong number. */
  assert.match(branch, /'Week '\+parts\.wk\+' of '\+parts\.total/,
    'the block-led hero dropped the week, orphaning the figures under it');
});

test('the day the block is for is a panel, not another row', () => {
  /* There are three .view-plan > .race-event rules in the sheet and the
     first is a one-line margin, so a bare indexOf reads that one and the
     assertion fails for the wrong reason. Matched across the whole sheet
     instead: SOME rule for this element must carry the panel. */
  assert.match(BARE, /\.view-plan > \.race-event\{[^}]*var\(--cherry-tint\)/,
    'Race Day is flat on the page again');
  assert.match(BARE, /\.view-plan > \.race-event\{[^}]*border:1\.5px solid var\(--cherry\)/);
  /* The same recipe the workout's key step wears, so the two cherry-marked
     objects in the product are one object rather than two that resemble
     each other. */
  const work = BARE.slice(BARE.indexOf('.ws-h-step.ws-work{'));
  assert.match(work.slice(0, 260), /var\(--cherry-tint\)/,
    'the recipe Race Day is matched to has moved');
  const src = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
  assert.doesNotMatch(src, /class="rd-flag"/, 'Race Day leads with a glyph again');
});

test('This Week says the week; the block name belongs to Full Plan', () => {
  /* The subline read "Full Marathon · Week 10 of 14" under a title that
     already says "Week 10 · Taper" — the block's name twice removed from the
     screen that is about this week. It is kept on the Full Plan hero, where
     the block IS the title and the week is what sits under it, so the two
     branches of renderWeekHeroBlock() are asserted separately. */
  const i = SRC.indexOf('function renderWeekHeroBlock(');
  assert.ok(i > -1, 'renderWeekHeroBlock is gone');
  const body = SRC.slice(i, SRC.indexOf('\n}\n', i));
  const [before, asBlock] = body.split('if (asBlock){');
  assert.ok(asBlock, 'the asBlock branch is gone');

  assert.ok(!/sub\.push\(/.test(before),
    "This Week's hero is building a subline again. The week number is in the title " +
    'above it and the block name belongs to Full Plan.');
  assert.match(asBlock, /sub = \(parts\.wk && parts\.total\)/,
    'the Full Plan hero lost the week line under the block name');

  /* The space the subline occupied stays. Measured before it went: title
     ended y30, subline ran 33..53, figures began y64 — so with nothing
     between them the figures climb 23px and the hero reads as a smaller
     thing. Matched on the adjacency so the Full Plan hero is untouched. */
  assert.match(CSS, /\.wk-hero-title \+ \.wk-hero-figs\{margin-top:34px;?\}/,
    "the removed subline's space is gone with it, and the hero has tightened up");
});

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
  const mine = /\.wk-taper::before\{([^}]*)\}/.exec(CSS);
  assert.ok(mine, '.wk-taper lost its cherry glow');
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

test('the taper sentence still fits two lines', () => {
  /* Measured in Chromium at 360, 412 and 430: two lines at every one, with
     48px of text at a 24px line-height. There is no static way to assert a
     rendered line count, so what is pinned is the thing that would break it
     — the length of the sentence. It has ~14 characters of headroom at
     360px; anything materially longer sets three lines on a narrow phone. */
  const m = /'<div class="wk-taper"><span>([\s\S]*?)<\/span><\/div>'/.exec(
    SRC.replace(/'\+\s*\n\s*'/g, ''));
  assert.ok(m, 'the taper sentence is no longer a single literal — re-measure the wrap');
  const words = m[1].replace(/\\u2014/g, '—');
  assert.ok(words.length <= 100,
    'the taper sentence is ' + words.length + ' characters. It set two lines at 360px at ' +
    '88; much past 100 and it wraps to three, which is the limit this layout was built to.');
  assert.match(words, /^Volume drops,/,
    'the taper sentence changed opening — if the copy is being rewritten, re-measure the wrap');
});
