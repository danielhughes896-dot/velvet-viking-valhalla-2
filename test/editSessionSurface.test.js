'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');

/* EDIT SESSION IS THE SAME PRODUCT AS THE REST OF THE APP.
 * ===========================================================================
 * It was the last surface still wearing the old one, and measured in Chromium
 * the difference was not a matter of taste:
 *
 *   .es-sec     linear-gradient(100deg, rgb(36,38,45) ...)  behind a gradient
 *               rim -- a ramp starting at #24262D, lighter and bluer than the
 *               #1C1E24 every other panel sits on, and a rim that reads as a
 *               gold outline against the modal's dark ramp.
 *   .field      rgb(29,26,23) fill + inset 0 1px 3px -- a sunken well, the
 *               oldest surface left in the product.
 *   .ef-type-list  a 1px box around rows that were each a raised .ev-card:
 *               a box of boxes, on a card, in a modal.
 *   .is-picked  inset 0 0 0 1.5px CHERRY.
 *
 * That last one is a law, not a preference. Cherry is progress and action
 * here; GOLD is choice -- the bottom nav's selected tab, the A/B/C goal
 * options and the builder's choices all wear it. Picking a session type is a
 * choice, so it takes the choice colour.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const rule = sel => {
  const i = CSS.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return CSS.slice(i + sel.length + 1, CSS.indexOf('}', i));
};

/* UPDATED, and the reason matters more than the assertion.
 * This used to require BOTH .es-sec and .es-sum to paint var(--t-card) -- the
 * pass that pulled them off the builder's lighter, bluer --t-card-grad. That
 * was the right fix for the question being asked then: if you are going to be
 * a panel, be the product's panel.
 * A later tree walk asked a better question. .es-sec was a padded panel
 * nested inside an already-padded modal body, which put the fields at 32 when
 * every other working surface in the app sits at 16, so it stopped being a
 * panel at all. .es-sum stays one, because it is a tile -- the session's
 * identity with its type colour down the edge -- not a container around
 * fields. So the original intent is kept and strengthened: the builder's old
 * ramp must not come back to either, and .es-sec must not go back to painting
 * anything. */
test('the summary is the app’s own tile and the sections paint nothing', () => {
  const sum = rule('.es-sum');
  assert.match(sum, /background:var\(--t-card\)/,
    '.es-sum is painting a gradient again instead of the product’s panel');
  ['.es-sec', '.es-sum'].forEach(sel => {
    const r = rule(sel);
    assert.doesNotMatch(r, /--t-card-grad/, sel + ' took the lighter, bluer ramp back');
    assert.doesNotMatch(r, /--t-rim-grad/, sel + ' took the gradient rim back');
  });
  assert.match(rule('.es-sec'), /background:none/,
    '.es-sec is painting again. It is a section inside a padded body, and giving it a ' +
    'face is what pushed the fields to a 32 gutter the rest of the app does not use.');
});

test('a field is a surface, not a hole', () => {
  const r = rule('.es-body .field :is(input, select, textarea)');
  assert.match(r, /box-shadow:none/, 'the fields are sunken wells again');
  assert.doesNotMatch(r, /inset/, 'the inset shadow came back');
  /* 20px is a PANEL's radius; on a 44px field it rounds past the text into a
     pill and the control stops reading as somewhere to type. */
  assert.match(r, /border-radius:var\(--radius-sm\)/,
    'the fields are pills again -- --tile-radius is for panels');
});

test('the list around the type rows is still not a box', () => {
  /* HALF OF THIS CHANGED SIDES. It also required .ev-card.ef-type-row to be
     `background:none` -- rows bare on the panel -- and the founder has since
     said "session types should now use the same boxes we had in build plan",
     which is the opposite instruction. The row is a box now.
     WHAT IS STILL TRUE AND STILL CHECKED is the thing that rule was really
     protecting: there is no SECOND box around them. A bordered list holding
     bordered tiles is the box-inside-a-box this sheet gave up. */
  assert.match(rule('.ef-type-list'), /border:0/, 'the type list is a box again');
  assert.match(rule('.es-body fieldset'), /border:0/,
    'Completed is a fieldset box again');
});

test('a chosen session type is CHERRY, in the builder\u2019s own language', () => {
  /* ---- THIS ASSERTION HAS CHANGED SIDES, AND SO HAS THE SCREEN ----
     It required gold and argued the law: "cherry is progress, gold is
     choice". That stopped describing the product some time ago. The founder
     took the builder's chosen option to a cherry line, then its fields, then
     its titles, and has now said of this list: "cherry ticks ... no gold
     glow, the same option section as build."
     So what is pinned here is no longer WHICH colour wins an argument, but
     that this list wears the SAME chosen state as the builder's option grid
     -- rim and the product's cherry glow -- rather than a third one invented
     for this sheet. The gold pool is asserted OFF: left on under a box it
     would be two selected states at once. */
  const on = rule('.ef-type-row.is-picked');
  assert.match(on, /border-color:var\(--cherry\)/, 'the chosen type lost its cherry line');
  assert.match(on, /box-shadow:0 0 16px var\(--cherry-dim\)/,
    'the chosen type is not wearing the product\u2019s cherry glow');
  assert.doesNotMatch(on, /--gold/, 'gold is back on the chosen type');
  assert.match(rule('.ef-type-row.is-picked::before'), /opacity:0/,
    'the gold pool lights under the cherry again');
  assert.match(rule('.ef-type-row.is-picked .swap-tick'), /var\(--cherry\)/,
    'the tick is not cherry');
  /* The rail is the reason this list exists and is not part of the swap. */
  assert.match(rule('.ef-type-row.type-easy .ef-type-rail'), /var\(--c-easy\)/,
    'a row stopped carrying its own type colour');
});

test('the sticky modal header keeps its edge', () => {
  /* NOT AN EXCEPTION TO THE HAIRLINE PASS. .modal-head is position:sticky --
     the body scrolls underneath it -- so this line marks where a fixed
     surface ends, not where one detail stops and the next begins. Without it
     text slides under the title with nothing between. */
  /* Anchored, NOT read through rule(): that helper is indexOf(sel + '{'),
     and '.modal-head{' also occurs inside '.modal-card.builder-light
     .modal-head{', which is earlier in the sheet. The obvious spelling reads
     the builder's override instead and fails on a rule that is perfectly
     fine -- caught the first time this test ran. */
  const r = (CSS.match(/\n\s*\.modal-head\{([^}]*)\}/) || [])[1] || '';
  assert.ok(r, 'the modal head rule is gone');
  assert.match(r, /position:sticky/, 'the head stopped being sticky; re-read the rule below');
  assert.match(r, /border-bottom:1px solid/, 'the sticky head lost the edge it scrolls content under');
});

test('.modal-head is the only border left outside Settings', () => {
  /* THE WHOLE LAW IN ONE PLACE. Every plain 1px separator went; what may
     remain is Settings (by instruction), the cherry race-week markers (decor
     and signal, not separators), the focused log fields' underline (no fill
     and no box, so the line IS the field -- remove it and an empty input is
     invisible), and .modal-head (a sticky surface's own edge).
     Anything else is a hairline creeping back, which is exactly how 46 of
     them accumulated in the first place. */
  const ALLOWED = [
    /stg-row/, /stg-name-input/, /danger-zone/, /garmin-section/,
    /parse-row/, /csv-row-item/,                       // Settings + its import
    /race-event/, /race-strategy/,                     // cherry, by instruction
    /\.modal-head/,                                     // the sticky head
    /\.actual-field :is\(input, textarea\)/,            // the field, not a rule
    /\.coach-nav-row/,                                  // Coach rows, by instruction:
    // founder's mock, "clean tappable text rows" with a line between them
  ];
  const stray = [];
  CSS.replace(/\/\*[\s\S]*?\*\//g, ' ')
     .replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => {
       if (!/border-(top|bottom)\s*:\s*1px\s+(solid|dashed)/.test(body)) return '';
       const s2 = sel.replace(/\s+/g, ' ').trim();
       if (!ALLOWED.some(re => re.test(s2))) stray.push(s2.slice(0, 70));
       return '';
     });
  assert.deepEqual(stray, [], 'a plain hairline came back outside Settings');
});

/* ===========================================================================
 * PICKING A TYPE NAMES THE SESSION -- AND KNOWS WHEN NOT TO
 * ===========================================================================
 * Retyping Easy to Threshold used to leave "Easy Aerobic" in the box above
 * the picker, so the sheet said one thing and the control under it said
 * another until the athlete noticed and retyped it themselves.
 *
 * The limit on it is not new either: athlete_edit_wins, the same invariant
 * renameToMatchPrescription() already applies when a distance edit changes a
 * generated name. Sacoro renames a session only while the name is still
 * Sacoro's. Theirs outranks ours.
 */
test('a title is ours while it is still one of our own words', () => {
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });

  // empty: nothing of theirs to lose
  assert.equal(a.editTitleIsOurs('', 'easy', 'Easy Aerobic'), true);
  assert.equal(a.editTitleIsOurs('   ', 'easy', 'Easy Aerobic'), true);

  // the name the day's own prescription generates
  assert.equal(a.editTitleIsOurs('Easy Aerobic', 'easy', 'Easy Aerobic'), true);
  assert.equal(a.editTitleIsOurs('Long Run — Progressive to Goal Pace', 'long',
    'Long Run — Progressive to Goal Pace'), true);

  // the plain type label, which is what this feature itself last wrote there
  assert.equal(a.editTitleIsOurs('Threshold', 'threshold', 'Easy Aerobic'), true);
  assert.equal(a.editTitleIsOurs('Rest', 'rest', null), true);

  // and anything the athlete typed
  assert.equal(a.editTitleIsOurs('Hill repeats on the canal', 'easy', 'Easy Aerobic'), false,
    'a name the athlete typed is about to be overwritten by a type they picked');
  assert.equal(a.editTitleIsOurs('Easy Aerobic with the club', 'easy', 'Easy Aerobic'), false,
    'a generated name they then added to is still theirs');
  assert.equal(a.editTitleIsOurs('Easy', 'threshold', 'Easy Aerobic'), false,
    'the label of a type that is NOT the one selected a moment ago proves nothing');
});

test('a day with no prescription left still has a name of ours', () => {
  /* editGeneratedTitle() returns null for a hand-edited day whose
     prescription is gone -- the rule has to hold without it, on the type
     label alone, or retyping such a day would silently stop naming it. */
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  assert.equal(a.editTitleIsOurs('Tempo', 'tempo', null), true);
  assert.equal(a.editTitleIsOurs('Something of mine', 'tempo', null), false);
});

test('the name written in is the one on the row that was tapped', () => {
  /* TYPE_META, not a second table of session names -- that table is what
     labels the picker row itself, so the name in the box and the name under
     the finger cannot drift apart. */
  const i = SRC.indexOf('function handleEditTypePick');
  const fn = SRC.slice(i, SRC.indexOf('\n}', i));
  assert.match(fn, /editTitleIsOurs\(/, 'the handler no longer asks whether the title is ours');
  assert.match(fn, /box\.value = TYPE_META\[t\]\.label/,
    'the title is being written from something other than the tapped row’s own label');
  assert.match(fn, /!box\.disabled/,
    'a locked prescription would have its title rewritten, which is the one ' +
    'case where the sheet must not touch it');
});

test('the sheet’s Save is a button in the app’s language', () => {
  /* It was .btn-primary's bronze gradient -- the slab Share and Save to
     device gave up. NOT cherry, although the builder's Continue is: that
     rule is scoped to .builder-light on purpose and the sheet records why,
     and cherry also sits directly above a cherry-outlined Reset, where the
     control that saves would look like the one that destroys. */
  /* ---- AND THE CHERRY HALF CHANGED SIDES ----
     Founder: "save needs changing to the cherry glow boarder and white
     text." The paragraph above gave two reasons against it. The first --
     that .btn-primary keeps the bronze gradient everywhere outside
     .builder-light -- still holds, and is why this is still a scoped rule
     and why the gradient is still asserted against. The second, that cherry
     would make Save look like the Reset above it, no longer does: Reset was
     moved to --z-threshold on the same instruction, so the two no longer
     share a colour. */
  const save = rule('.es-actions .btn-primary');
  assert.match(save, /background:var\(--t-card\)/, 'Save is not on the card ground');
  assert.match(save, /border:1px solid var\(--cherry\)/, 'Save lost its cherry edge');
  assert.match(save, /box-shadow:0 0 16px var\(--cherry-dim\)/, 'Save lost its glow');
  assert.match(save, /color:var\(--ink\)/, 'Save\u2019s words are not white');
  assert.ok(!/linear-gradient/.test(save), 'the bronze gradient is back on Save');
  /* The separation the old argument demanded, now kept by Reset instead. */
  assert.match(rule('.es-reset .btn-danger'), /var\(--z-threshold\)/,
    'Reset is back on the muted threshold colour, where it shares an edge with Save');
});

/* ---------------------------------------------------------------------------
 * ONE SHELL, ONE GUTTER
 * A walk of the whole navigation tree measured sixteen reachable modals:
 * thirteen were centred cards and three still docked at the bottom edge --
 * Edit Session, Tools & Import and Restore a Plan. The drawer had become the
 * exception while the sheet still described it as the rule.
 *
 * The centring had only ever been authored for .builder-light, so moving the
 * three onto it would also have handed them the builder's card face and its
 * Cherry Lacquer .btn-primary -- the one thing that class is scoped to keep.
 * Hence .modal-centred: geometry only. These guards hold both halves of that
 * split, because either half failing silently is a regression you see only
 * by opening the sheet on a phone.
 * ------------------------------------------------------------------------ */

test('.modal-centred carries geometry and nothing else', () => {
  const rules = [];
  const re = /\.modal-centred[^{]*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(CSS))) rules.push(m[1]);
  assert.ok(rules.length, '.modal-centred has no rules at all');
  const paint = /(^|;)\s*(background|background-color|background-image|color|border-color|box-shadow|font)\s*:/;
  rules.forEach(body => {
    assert.ok(!paint.test(body),
      '.modal-centred has taken on a face: it must only position and size a card, ' +
      'never paint one -- that is what .builder-light is for. Offending rule: ' + body.trim());
  });
});

test('the centring rule answers to both classes, so no surface already using it moves', () => {
  assert.match(CSS, /\.modal-overlay:has\(> \.builder-light\),\s*\n?\s*\.modal-overlay:has\(> \.modal-centred\)\{/,
    'the overlay centring no longer lists both .builder-light and .modal-centred');
  assert.match(CSS, /\.modal-overlay:has\(> \.builder-light\) > \.builder-light,\s*\n?\s*\.modal-overlay:has\(> \.modal-centred\) > \.modal-centred\{/,
    'the card radius/height rule no longer lists both classes');
});

test('the three surfaces that were drawers are keyboard-safe: all three are pages', () => {
  const callOf = (fn) => {
    const body = SRC.slice(SRC.indexOf('function ' + fn + '('));
    return body.slice(0, body.indexOf('\n}\n'));
  };
  /* ---- AND NOW THE THIRD ----
     Edit Session was held to the centred shell because it holds fields an
     athlete types into and a docked drawer has no keyboard-safe height.
     Founder: "when you first click the edit button this pops up. Full page
     please." A page is the full height of the screen and scrolls, which is
     the same worry answered better. */
  /* ...AND MOVED AGAIN. Founder, 15 November 2026: "should edit session be on a bottom glass screen? Then change workout edit details and reschedule be the 3 box choices. Then they all open as bottom?" -- and, shown the mock-up, "Yes".
     A glass sheet, capped to the dynamic viewport so a field typed into
     stays above the keyboard. */
  assert.match(callOf('openEditModal'), /openModal\(html, 'modal-themed stg-sheet es-sheet'\);/,
    'Edit Session (openEditModal) does not open as the glass sheet.');
  assert.match(CSS, /\.modal-card\.es-sheet\{max-height:88vh; max-height:88dvh;/,
    'the Edit Session sheet has no keyboard-safe height');
  assert.doesNotMatch(callOf('openEditModal'), /openModal\([^;]*modal-centred/, 'Edit Session is a centred card again');
  /* ---- TWO OF THE THREE CHANGED SIDES ----
     Tools & Import and Restore a Plan were held to the centred shell for
     the reason above. Founder: "Make full-screen pages the standard for
     important Settings workflows, matching the Coach design." Both are
     reached from Settings, so both are pages now -- and a page answers the
     same worry better than centring did: it is the full height of the
     screen and scrolls, so there is nowhere for a field to be left behind a
     keyboard. What is held is that they are pages and not drawers again. */
  [
    ["openImportModal", "Tools & Import"],
    ["openRestoreModal", "Restore a Plan"],
  ].forEach(([fn, label]) => {
    assert.match(callOf(fn), /'modal-themed builder-light '\+STG_PAGE/,
      label + ' (' + fn + ') is not a Settings page');
    assert.doesNotMatch(callOf(fn), /openModal\([^;]*'modal-themed modal-centred'/, label + ' is a centred card again');
  });
  assert.match(SRC, /var STG_PAGE = '[^']*\bhq-full\b[^']*';/,
    'a Settings page is no longer full height, so it is a drawer with a keyboard problem again');
});

test('Edit Session does its work on the app’s 16, not a panel’s 32', () => {
  const sec = /\n  \.es-sec\{([^}]*)\}/.exec(CSS);
  assert.ok(sec, '.es-sec has no rule of its own any more');
  assert.match(sec[1], /border:0/, '.es-sec has grown a border back — it is a section, not a panel');
  assert.match(sec[1], /background:none/, '.es-sec has grown a background back');
  assert.match(sec[1], /border-radius:0/, '.es-sec has grown a radius back');

  /* ---- THE PROBE MOVED WHEN THE MARKUP DID ----
     This used to read the padding off .es-sec-head and .es-sec-body -- the
     <summary> and the disclosure body -- because those were the two boxes
     between a field and the gutter. Both are gone with the <details> the
     founder asked to be removed, and the section is now a plain wrapper, so
     the question is simply whether ANYTHING in this chain insets its
     children. Asked of the wrapper itself it covers the same ground and
     cannot be satisfied by a rule that no longer renders. */
  assert.doesNotMatch(sec[1], /padding/,
    '.es-sec has taken padding again, which is what put the fields at 32 rather than ' +
    'the app\u2019s 16. Found: ' + sec[1].trim());
  const flatTitle = /\.es-sec \.setup-section-title\{([^}]*)\}/.exec(CSS);
  assert.ok(flatTitle, 'the flat section\u2019s title rule is gone');
  assert.doesNotMatch(flatTitle[1], /padding|margin-left|margin-right/,
    'the section title has been pushed off the gutter its fields sit on');

  /* Space, not a line: the hairline law above forbids a plain 1px separator,
     so the two sections are held apart by 26 -- .es-body's 14 gap plus 12 --
     the same rhythm the week's analysis reads on. */
  assert.match(CSS, /\.es-sec \+ \.es-sec\{margin-top:12px/,
    'the space between the two flat sections is gone, and a hairline is not allowed to replace it');
  assert.doesNotMatch(CSS, /\.es-sec \+ \.es-sec\{border-top/,
    'a hairline crept back between the sections — separate them with space');
});

test('no section head in the sheet leads with a glyph', () => {
  assert.ok(!/es-sec-icon/.test(SRC),
    '.es-sec-icon is back. A glyph in front of a title is gone from the rest of the ' +
    'product, and with the panel flat it would be the only thing between the title and the gutter.');
  const helper = /var section = function\(([^)]*)\)/.exec(SRC);
  assert.ok(helper, 'the section() helper is gone');
  /* The signature has held through every shape these sections have had --
     <details>, flat, and now tabs -- because the positional hazard it guards
     is the same in all three: two call sites pass these by position, so a
     parameter added or dropped still shifts a title into a subtitle
     silently. */
  /* Two arguments were added at the END (the box's one-line hint, and the
     page's own action), so no existing argument moved position. */
  assert.equal(helper[1].replace(/\s/g, ''), 'id,title,sub,body,hint,go',
    'section() signature changed. Its arguments are positional and two call sites pass ' +
    'them, so a parameter added or dropped here silently shifts a title into a subtitle. ' +
    'Found: (' + helper[1] + ')');
  assert.ok(!/<details class="es-sec"/.test(SRC),
    'the sections are browser <details> again. They are the completed session\'s tabs: ' +
    'a button, so the state is ours and survives the sheet being touched.');
});

/* ---------------------------------------------------------------------------
 * TWO CLOSED TABS
 * Founder: "Edit session has regressed. The reschedule and edit session type
 * have merged together. So separate black closed tabs same as we have when a
 * session is ticked as complete. And then it drops down to what we have in
 * those fields now."
 *
 * (This reverses "Reschedule -- has tabs!! Remove them all." Flat, the swap
 * list ran straight into the title field and the two jobs read as one form.)
 * ------------------------------------------------------------------------- */
test('Edit Session is three boxes: Change Workout, Reschedule and Edit details, each shut until asked', () => {
  /* Founder, 15 November 2026: "should edit session be on a bottom glass
     screen? Then change workout edit details and reschedule be the 3 box
     choices. Then they all open as bottom?" Shown the mock-up: "Yes". */
  const { loadApp } = require('./harness.js');
  const { buildPlan } = require('./fixtures.js');
  const a = loadApp({ pinnedDate: '2026-11-12T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-11-09' });
  let html = '';
  a.openModal = h => { html = h; };
  const dd = a.state.days.filter(d => d.type !== 'rest' && d.date > '2026-11-12')[0];
  assert.ok(a.wkCanChange(dd), 'the fixture session cannot change its workout');
  a.openEditModal(dd.id);

  const boxes = [...html.matchAll(/<button type="button" class="es-tab es-choice" data-action="es-tab" aria-expanded="(true|false)" aria-controls="([a-z-]+)">([\s\S]*?)<\/button>/g)];
  assert.deepEqual(boxes.map(m => m[2]), ['ef-sec-workout-body', 'ef-sec-reschedule-body', 'ef-sec-edit-body']);
  assert.deepEqual(boxes.map(m => m[1]), ['false', 'false', 'false'], 'a box is open before it is asked for');
  [['Change Workout', 'Swap for another workout, or make your own'],
   ['Reschedule', 'Move it to any upcoming day in your plan'],
   ['Edit details', 'Title, distance, notes and completion']].forEach(([t, hint], i) => {
    assert.match(boxes[i][3], new RegExp('<span class="es-choice-t">' + t + '</span>'), t + ' box is not titled');
    assert.ok(boxes[i][3].indexOf(hint) !== -1, t + ' box does not say what it does');
  });

  const body = id => { const at = html.indexOf('<div class="es-tab-body" id="' + id + '" hidden>'); assert.ok(at !== -1, id + ' is not shut, or is gone'); return at; };
  const w = body('ef-sec-workout-body'), r = body('ef-sec-reschedule-body'), e = body('ef-sec-edit-body');
  const at = s2 => { const i = html.indexOf(s2); assert.ok(i !== -1, s2 + ' is gone from the sheet'); return i; };
  assert.ok(w < at('id="wk-pick"') && at('id="wk-pick"') < r, 'the workouts are not under Change Workout');
  assert.ok(r < at('Move or swap this session with another day.') && at('Move or swap this session with another day.') < e, 'the swap list is not under Reschedule');
  ['id="ef-title"', 'id="ef-km"', 'id="ef-mp"', 'id="ef-completed"', 'id="ef-desc"', 'data-action="reset-day"'].forEach(f =>
    assert.ok(at(f) > e, f + ' is not under Edit details'));
  /* The type is chosen with its workout now; the list of types is gone. */
  assert.ok(!/id="ef-type-list"/.test(html), 'the list of session types is still in Edit details');
  assert.ok(at('id="ef-type"') > e, 'Save has no type to read');
  /* Back and the page's action, at the foot. */
  assert.ok(at('id="es-back"') > at('id="ef-desc"') && at('id="es-primary"') > at('id="es-back"'), 'Back and the action are not at the foot');
  assert.match(html, /id="es-primary" data-action="save-edit"/);
  assert.ok(at('class="es-sum') < w, 'the session\'s own tile is not above the boxes');

  /* Opening one draws nothing: the body is already there and is only shown. */
  ['handleEditTab', 'editPageSet', 'handleEditPageClose'].forEach(f => {
    const fn = SRC.slice(SRC.indexOf('\nfunction ' + f + '('), SRC.indexOf('\n}\n', SRC.indexOf('\nfunction ' + f + '(')));
    assert.ok(fn.length > 20, f + ' is gone');
    assert.ok(!/renderApp|openEditModal|innerHTML|openModal/.test(fn), f + ' redraws the sheet, which would lose a half-typed title');
  });
  assert.match(SRC, /case 'es-tab': handleEditTab\(target\); break;/);
  assert.match(CSS, /\.es-tab-body\[hidden\]\{display:none;\}/, 'a shut box can be shown by another rule');

  /* A session that has already happened can still be moved, but its workout is history. */
  const past = a.state.days.filter(d => d.type !== 'rest' && d.date < '2026-11-12')[0];
  if (past){
    a.openEditModal(past.id);
    assert.match(html, /aria-controls="ef-sec-reschedule-body"/);
    assert.doesNotMatch(html, /aria-controls="ef-sec-workout-body"/, 'a past session offers to change its workout');
  }
});

/* ---------------------------------------------------------------------------
 * AND EACH BOX OPENS ITS PAGE IN THE SAME SHEET
 * ------------------------------------------------------------------------- */
function sheetDom(a){
  /* The handful of elements editPageSet() touches, recording what is done. */
  const cl = init => { const set = new Set(init || []); return {
    toggle: (c, on) => { if (on) set.add(c); else set.delete(c); }, remove: c => set.delete(c), add: c => set.add(c),
    contains: c => set.has(c), list: () => [...set].sort() }; };
  const el = extra => Object.assign({ attrs: {}, classList: cl(),
    getAttribute(k){ return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v){ this.attrs[k] = String(v); }, removeAttribute(k){ delete this.attrs[k]; } }, extra || {});
  const ids = ['ef-sec-workout', 'ef-sec-reschedule', 'ef-sec-edit'];
  const tabs = {};
  ids.forEach(id => { tabs[id] = el({ attrs: { 'aria-expanded': 'false', 'aria-controls': id + '-body' } }); });
  const card = el({ classList: cl(['modal-card', 'stg-sheet', 'es-sheet']), style: { transform: 'translateY(300px)' }, scrollTop: 240 });
  const sec = (id, title, go, act, back) => el({ attrs: { 'data-title': title, 'data-go': go, 'data-go-action': act, 'data-back': back },
    querySelector: () => tabs[id] });
  const dom = {
    'ef-sec-workout': sec('ef-sec-workout', 'Change Workout', 'Use This Workout', 'wk-use', 'Keep Planned Workout'),
    'ef-sec-reschedule': sec('ef-sec-reschedule', 'Reschedule', 'Move Session', 'save-edit', 'Back'),
    'ef-sec-edit': sec('ef-sec-edit', 'Edit details', 'Save', 'save-edit', 'Back'),
    'es-head-title': el({ textContent: 'Edit Session' }),
    'es-close': el({ attrs: { 'data-action': 'close-modal', 'aria-label': 'Close' } }),
    'es-back': el({ attrs: { 'data-action': 'es-page-close', 'data-sec': '' }, textContent: 'Back' }),
    'es-primary': el({ attrs: { 'data-action': 'save-edit' }, textContent: 'Save' }),
    'modal-overlay': el({ querySelector: () => card })
  };
  ids.forEach(id => { dom[id + '-body'] = el({ attrs: { hidden: '' } }); });
  a.document.getElementById = id => dom[id] || null;
  return { dom, tabs, card };
}
test('a box opens its page in the same glass sheet, and Back returns to the three', () => {
  const { loadApp } = require('./harness.js');
  const a = loadApp({ pinnedDate: '2026-11-12T09:00:00Z' });
  const { dom, tabs, card } = sheetDom(a);
  const shut = id => 'hidden' in dom[id].attrs;
  const opened = /openModal\(html, 'modal-themed stg-sheet es-sheet'\);\n\}/;
  assert.match(SRC.slice(SRC.indexOf('\nfunction openEditModal('), SRC.indexOf('\nfunction editPageSet(')), opened, 'Edit Session does not open as the glass sheet');

  a.handleEditTab(tabs['ef-sec-reschedule']);
  assert.deepEqual(card.classList.list(), ['es-page', 'es-sheet', 'modal-card', 'stg-sheet'], 'opening a box changed the shell');
  assert.equal(shut('ef-sec-reschedule-body'), false);
  assert.equal(shut('ef-sec-edit-body'), true, 'another page opened with it');
  assert.equal(shut('ef-sec-workout-body'), true, 'another page opened with it');
  assert.equal(dom['es-head-title'].textContent, 'Reschedule');
  assert.equal(tabs['ef-sec-reschedule'].attrs['aria-expanded'], 'true');
  assert.equal(card.scrollTop, 0, 'the page opened part-way down');
  /* Back returns to the three; the page's own action is named for it. */
  assert.equal(dom['es-back'].attrs['data-sec'], 'ef-sec-reschedule');
  assert.equal(dom['es-back'].textContent, 'Back');
  assert.equal(dom['es-primary'].textContent, 'Move Session');
  assert.equal(dom['es-primary'].attrs['data-action'], 'save-edit');
  /* THE CROSS ALWAYS CLOSES THE SHEET, and a swipe down presses it. */
  assert.equal(dom['es-close'].attrs['data-action'], 'close-modal');
  assert.equal(dom['es-close'].attrs['aria-label'], 'Close');
  assert.match(SRC, /case 'es-page-close': handleEditPageClose\(target\); break;/);
  assert.match(SRC.slice(SRC.indexOf('function pageSwipeCloseOf'), SRC.indexOf('function pageSwipeCloseOf') + 400),
    /card\.querySelector\('\.modal-head \.icon-btn, /, 'the sheet head\'s own cross is not the one a swipe presses');

  /* Back: the three boxes again, exactly as they were, nothing left pushed off screen. */
  card.classList.add('is-settling');
  let closedWhole = 0; a.closeModal = () => { closedWhole++; };
  a.handleEditPageClose(dom['es-back']);
  assert.equal(closedWhole, 0, 'Back closed the whole sheet, and whatever was typed with it');
  assert.deepEqual(card.classList.list(), ['es-sheet', 'modal-card', 'stg-sheet']);
  assert.equal(card.style.transform, '', 'the card was left where the swipe pushed it');
  assert.equal(shut('ef-sec-reschedule-body'), true);
  assert.equal(dom['es-head-title'].textContent, 'Edit Session');
  assert.equal(tabs['ef-sec-reschedule'].attrs['aria-expanded'], 'false');

  a.handleEditTab(tabs['ef-sec-edit']);
  assert.equal(dom['es-head-title'].textContent, 'Edit details');
  assert.equal(dom['es-primary'].textContent, 'Save');
  a.handleEditPageClose(dom['es-back']);

  a.handleEditTab(tabs['ef-sec-workout']);
  assert.equal(dom['es-head-title'].textContent, 'Change Workout');
  assert.equal(dom['es-primary'].textContent, 'Use This Workout');
  assert.equal(dom['es-primary'].attrs['data-action'], 'wk-use');
  assert.equal(dom['es-back'].textContent, 'Keep Planned Workout');
  /* Back with no page behind it closes the sheet. */
  a.handleEditPageClose({ getAttribute: () => '' });
  assert.equal(closedWhole, 1);
});

test('on a page the other boxes are put away, the session stays at the top and Back and the action at the foot', () => {
  const rule = sel => { const at = CSS.indexOf(sel + '{'); assert.ok(at !== -1, sel + ' has no rule'); return CSS.slice(at, CSS.indexOf('}', at)); };
  assert.match(rule('.modal-card.es-page .es-sec:not(.is-page)'), /display:none/);
  assert.match(rule('.modal-card.es-page .es-sec.is-page > .es-tab'), /display:none/, 'the box\'s own word is printed under the heading that now says it');
  assert.match(rule('.modal-card.es-sheet .es-actions'), /position:sticky; bottom:0/);
  assert.match(rule('.modal-card.es-sheet:not(.es-page) .es-actions'), /display:none/, 'the three boxes carry a Save of their own');
  assert.doesNotMatch(CSS, /\.es-page[^{]*\.es-sum[^{]*\{[^}]*display:none/, 'the page does not say which session it is about');
  assert.match(rule('.modal-card.es-page .swap-list'), /max-height:none; overflow:visible/);
  assert.match(rule('.modal-card.es-page .swap-week'), /position:static; background:none/, 'the week headings are still a bar');
  assert.match(rule('.modal-card.es-page .swap-day .swap-name'), /white-space:normal/);
  const whole = SRC.slice(SRC.indexOf('\nfunction openEditModal('), SRC.indexOf('\nfunction findDay(')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(whole, /modal-centred/, 'Edit Session can be a centred card again');
});
