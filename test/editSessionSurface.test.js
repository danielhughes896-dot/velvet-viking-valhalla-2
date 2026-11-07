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

test('nothing in Edit Session is a box inside a box', () => {
  assert.match(rule('.ef-type-list'), /border:0/, 'the type list is a box again');
  assert.match(rule('.ev-card.ef-type-row'), /background:none/,
    'the type rows are raised tiles again');
  assert.match(rule('.es-body fieldset'), /border:0/,
    'Completed is a fieldset box again');
});

test('a chosen session type is GOLD, and lit rather than outlined', () => {
  assert.doesNotMatch(rule('.ef-type-row.is-picked'), /--cherry/,
    'the selection went back to cherry -- cherry is progress, gold is choice');
  assert.match(rule('.ef-type-row.is-picked'), /box-shadow:none/,
    'the selection is outlined again instead of lit');
  assert.match(rule('.ef-type-row.is-picked::before'), /opacity:1/,
    'the selected row lost its light');
  assert.match(rule('.ef-type-row::before'), /rgba\(227,177,90/,
    'the pool behind a selected row is no longer gold');
  assert.match(rule('.ef-type-row.is-picked .swap-tick'), /var\(--gold\)/,
    'the tick is no longer gold');
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
 * generated name. Valhalla renames a session only while the name is still
 * Valhalla's. Theirs outranks ours.
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
  const save = rule('.es-actions .btn-primary');
  assert.match(save, /background:var\(--t-card\)/, 'Save is not on the card ground');
  assert.match(save, /border:1px solid var\(--t-tile-rim\)/);
  assert.match(save, /color:var\(--gold\)/);
  assert.ok(!/linear-gradient/.test(save), 'the bronze gradient is back on Save');
  assert.ok(!/--cherry/.test(save), 'Save has taken the builder’s cherry');
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

test('the three surfaces that were drawers open centred', () => {
  [
    ["openEditModal", "Edit Session"],
    ["openImportModal", "Tools & Import"],
    ["openRestoreModal", "Restore a Plan"],
  ].forEach(([fn, label]) => {
    const body = SRC.slice(SRC.indexOf('function ' + fn + '('));
    const call = body.slice(0, body.indexOf('\n}\n'));
    assert.match(call, /'modal-themed modal-centred'/,
      label + ' (' + fn + ') no longer opens on the centred shell. It holds a field an ' +
      'athlete types into, and a bottom-docked drawer has no keyboard-safe height -- ' +
      'open the keyboard and the input is behind it.');
  });
});

test('Edit Session does its work on the app’s 16, not a panel’s 32', () => {
  const sec = /\n  \.es-sec\{([^}]*)\}/.exec(CSS);
  assert.ok(sec, '.es-sec has no rule of its own any more');
  assert.match(sec[1], /border:0/, '.es-sec has grown a border back — it is a section, not a panel');
  assert.match(sec[1], /background:none/, '.es-sec has grown a background back');
  assert.match(sec[1], /border-radius:0/, '.es-sec has grown a radius back');

  const head = /\.es-sec-head\{([^}]*)\}/.exec(CSS);
  assert.ok(head, '.es-sec-head rule is gone');
  const hpad = /padding:([^;]*);/.exec(head[1]);
  assert.ok(hpad, '.es-sec-head no longer declares its padding');
  assert.match(hpad[1].trim(), /^\d+(\.\d+)?px 0$/,
    '.es-sec-head has taken horizontal padding again, which pushes its title off the ' +
    'gutter every other surface in the app sits on. Found: ' + hpad[1].trim());

  const bodyRule = /\.es-sec-body\{([^}]*)\}/.exec(CSS);
  assert.ok(bodyRule, '.es-sec-body rule is gone');
  assert.match(bodyRule[1], /padding:\d+(\.\d+)?px 0 \d+(\.\d+)?px/,
    '.es-sec-body has taken horizontal padding again, which is what put the fields at 32. ' +
    'Found: ' + bodyRule[1].trim());

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
  assert.equal(helper[1].replace(/\s/g, ''), 'id,title,sub,body,open',
    'section() signature changed. Its arguments are positional and two call sites pass ' +
    'them, so a parameter added or dropped here silently shifts a title into a subtitle. ' +
    'Found: (' + helper[1] + ')');
});
