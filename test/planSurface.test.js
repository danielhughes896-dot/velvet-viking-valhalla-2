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

  /* BOTH PRINTERS TAKE IT. A second copy of this sentence anywhere is the
     defect this constant exists to prevent. */
  assert.ok(!/Volume drops, but keep/.test(SRC.replace(m[0], '')),
    'the taper sentence has been written out a second time — the two will drift again');
  assert.match(SRC, /class="wk-taper"><span>'\+TAPER_COACHING_LINE/,
    "This Week's hero is no longer printing the shared taper sentence");
  assert.match(SRC, /class="taper-note">'\+TAPER_COACHING_LINE/,
    "Full Plan's week note is no longer printing the shared taper sentence");
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

test('the phase track runs BETWEEN the marks and never into them', () => {
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
