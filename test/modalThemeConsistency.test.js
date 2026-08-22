'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// A modal used to be dark whatever the athlete had chosen. .modal-card pins the
// whole control/ink/line token family to a fixed dark ramp, which is the right
// call for a transient confirm on a lit stage but the wrong one for a surface
// you sit and work in: Re-calibrate Training Zones arrived as a near-black
// sheet over a cream app.
//
// The rule now is: light selected -> primary pages, builder/edit flows and
// settings modals draw from the light tokens; dark selected -> the same
// surfaces draw from the dark ones. A modal opts in with .modal-themed, which
// un-pins exactly what .modal-card pinned and adds no colour of its own; a
// modal that does not opt in is untouched and keeps the fixed dark ramp.
//
// These tests hold three things: the opt-in mechanism actually un-pins the
// tokens, the two work surfaces are opted in, and the theming is separable
// from the builder's positioning so Re-calibrate does not inherit centring it
// was never given. They also re-assert that Re-calibrate's structure and
// recalibration logic came through the theming change unchanged.
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

// Comments in this file describe the old behaviour as often as the new, so a
// scan that reads them will pass on prose alone. Every assertion below runs
// against code with comments removed.
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');

function styleBlock(selector) {
  const i = CODE.indexOf(selector + '{');
  assert.notEqual(i, -1, 'rule not found: ' + selector);
  const open = i + selector.length;
  const close = CODE.indexOf('}', open);
  assert.notEqual(close, -1, 'unterminated rule: ' + selector);
  return CODE.slice(open + 1, close);
}

// The properties .modal-card pins. If .modal-card grows another pinned token
// and .modal-themed is not taught to release it, that token silently stays
// dark on a cream card -- so the list is derived from .modal-card itself
// rather than hard-coded here.
function pinnedCustomProps(block) {
  return [...block.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]);
}

// The app declares its functions at column zero, and every one of these
// bodies nests anonymous `function(` expressions -- so the slice has to end at
// the next top-level declaration, not the next occurrence of the word.
function fnBody(name) {
  const start = CODE.indexOf('\nfunction ' + name + '(');
  assert.notEqual(start, -1, 'function not found: ' + name);
  const rest = CODE.slice(start + 1);
  const end = rest.indexOf('\nfunction ');
  return end === -1 ? rest : rest.slice(0, end);
}

test('.modal-themed releases every custom property .modal-card pins', () => {
  const card = styleBlock('.modal-card');
  const themed = styleBlock('.modal-card.modal-themed');
  const pinned = pinnedCustomProps(card);
  assert.ok(pinned.length >= 8, 'expected .modal-card to pin a token family, saw ' + pinned.length);
  const released = new Set(
    [...themed.matchAll(/(--[a-z0-9-]+)\s*:\s*inherit/g)].map(m => m[1])
  );
  const stillPinned = pinned.filter(p => !released.has(p));
  assert.deepEqual(stillPinned, [],
    'these stay on the fixed dark ramp inside a themed modal: ' + stillPinned.join(', '));
});

test('.modal-themed adds no colour of its own -- it only points at the theme', () => {
  const themed = styleBlock('.modal-card.modal-themed');
  // Every non-inherit declaration must resolve through a token, never a literal.
  const literals = [...themed.matchAll(/:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/g)].map(m => m[1]);
  assert.deepEqual(literals, [],
    '.modal-themed hard-codes colour instead of deferring to the theme: ' + literals.join(', '));
  assert.match(themed, /background\s*:\s*var\(--bg\)/);
  assert.match(themed, /color\s*:\s*var\(--ink\)/);
  assert.match(themed, /border-color\s*:\s*var\(--line\)/);
  // color-scheme must be released too, or the browser keeps painting its own
  // form controls and scrollbars dark on a cream card.
  assert.match(themed, /color-scheme\s*:\s*normal/);
});

/* THE WORK SURFACES, NAMED. Counting themed modals told us how many there
   were and nothing about WHICH -- which is how Edit Session went a whole
   release opening as a near-black sheet over a cream app without any test
   noticing. The set is enumerated now: each of these is a form an athlete
   sits in and fills out, each must opt in, and the count still has to match so
   a transient confirm cannot join them without arguing for itself here. */
const WORK_SURFACES = [
  ['openSetupModal', 'the staged plan builder'],
  ['openRecalibrateModal', 'Re-calibrate Training Zones'],
  ['openEditModal', 'Edit Session'],
  ['openHQPanel', "Plan HQ's Record / Reading / action panels"],
];

test('every surface an athlete works in follows the theme', () => {
  WORK_SURFACES.forEach(([fn, what]) => {
    // not [^)]* -- openHQPanel passes openModal(html, '...'), so the class sits
    // past a comma, and openRecordPanel's argument used to carry a paren too.
    assert.match(fnBody(fn), /openModal\([\s\S]{0,120}?['"][^'"]*\bmodal-themed\b/,
      what + ' opens on the fixed dark ramp whatever theme the athlete chose');
  });
});

test('Edit Session in particular, because it is the one that regressed', () => {
  const body = fnBody('openEditModal');
  assert.match(body, /openModal\([\s\S]{0,120}?['"][^'"]*\bmodal-themed\b/,
    'Edit Session is dark over a cream app again');
  // A bottom sheet like every other short form -- NOT the centred builder.
  assert.doesNotMatch(body, /\bbuilder-light\b/,
    'Edit Session picked up the builder centring it was never given');
  // And the fix moved the token ramp only. Every field, id and action stays.
  ['ef-title', 'ef-type', 'ef-km', 'ef-mp', 'ef-desc', 'ef-swap']
    .forEach(id => assert.match(body, new RegExp('id="' + id + '"'),
      'Edit Session lost #' + id));
  assert.match(body, /data-action="save-edit"/);
  assert.match(body, /data-action="reset-day"/);
  assert.match(body, /renderEditCompletion\(dd\)/);
  assert.match(body, /<legend>Reschedule<\/legend>/);
});

test('a modal that does not opt in keeps the fixed dark ramp', () => {
  // Any other openModal() call must not carry the class. This is the guard that
  // stops "make it themed" from quietly becoming the default for every confirm.
  // The number is WORK_SURFACES.length by construction, so adding a themed
  // modal means naming it above rather than bumping a literal.
  const calls = [...CODE.matchAll(/openModal\(([\s\S]{0,400}?)\);/g)]
    .map(m => m[1])
    .filter(a => /\bmodal-themed\b/.test(a));
  assert.equal(calls.length, WORK_SURFACES.length,
    'expected exactly ' + WORK_SURFACES.length + ' themed modals (' +
    WORK_SURFACES.map(w => w[1]).join(', ') + '), found ' + calls.length);
});

test('the Plan HQ panels opt in, and carry the builder accent deliberately', () => {
  const body = fnBody('openHQPanel');
  // not [^)]* here: the argument is openModal(html, '...'), and the class sits
  // past a comma the other two calls do not have.
  assert.match(body, /openModal\([\s\S]{0,80}?['"][^'"]*\bmodal-themed\b/,
    'a Plan HQ panel would arrive as a dark sheet over a cream Plan HQ');
  // builder-light is borrowed, exactly as renderHero() already borrows it: it
  // is the rule that makes a primary action violet, and reusing it is what
  // stops a second purple being invented for the BACK button.
  assert.match(body, /\bbuilder-light\b/,
    'the Plan HQ panel lost the class its violet BACK button depends on');
  assert.match(CODE, /\.builder-light\s+\.btn-primary\s*\{[^}]*var\(--violet\)/,
    'the violet primary rule the Plan HQ panels borrow no longer exists');
  // One opener, so one theme decision, for every panel on the screen.
  assert.match(fnBody('openRecordPanel'), /openHQPanel\(/,
    'the Record panels stopped going through the shared opener');
});

test('theming is separable from the builder positioning', () => {
  // Re-calibrate is themed but must NOT be centred: the positioning rules key
  // on .builder-light, which only the builder carries.
  assert.doesNotMatch(fnBody('openRecalibrateModal'), /\bbuilder-light\b/,
    'Re-calibrate picked up the builder centring class');

  assert.match(CODE, /\.modal-overlay:has\(>\s*\.builder-light\)\s*\{[^}]*align-items\s*:\s*center/,
    'the builder centring rule no longer keys on .builder-light');

  assert.match(fnBody('openSetupModal'), /\bbuilder-light\b/,
    'the builder lost the class its positioning depends on');
});

test('goal time inputs are painted by the control tokens, not the browser', () => {
  // The builder wraps its three rows in #f-goals so .field input reached them;
  // Re-calibrate emits them bare, so they fell through to the user agent's own
  // control -- a 21px box at 13.3px, coloured by whatever colour-scheme was in
  // force rather than by the theme. Naming .goal-input-row alongside .field is
  // what makes the two goal editors identical.
  const rule = [...CODE.matchAll(/([^{}]*\.goal-input-row input[^{}]*)\{([^}]*)\}/g)]
    .find(m => /background\s*:\s*var\(--ctl-bg\)/.test(m[2]));
  assert.ok(rule, '.goal-input-row input is not painted by the control tokens');
  assert.match(rule[2], /color\s*:\s*var\(--ctl-text\)/);
  assert.match(rule[2], /border\s*:[^;]*var\(--ctl-border\)/);
  assert.match(rule[2], /min-height\s*:\s*44px/, 'goal inputs fell below the 44px tap target');
  assert.match(rule[1], /\.field input\b/,
    'the goal input should share the .field rule rather than duplicate it');
});

test('Re-calibrate still emits its fields, actions and three goal rows', () => {
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays('2026-05-20', -28), distanceKey: 'full',
                 volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  a.state.setup.benchmark = { distanceKey: '5k', timeSec: 22 * 60 + 30 };
  a.state.setup.goals = { A: { timeSec: 3 * 3600 + 10 * 60 }, B: {}, C: {} };

  let markup = null;
  const realOpen = a.openModal;
  a.openModal = function (html, cls) { markup = { html: html, cls: cls }; };
  a.openRecalibrateModal();
  a.openModal = realOpen;

  assert.ok(markup, 'openRecalibrateModal did not open anything');
  assert.match(markup.cls || '', /\bmodal-themed\b/);
  ['rc-bench-dist', 'rc-bench-time', 'rc-goal-A', 'rc-goal-B', 'rc-goal-C'].forEach(id => {
    assert.ok(markup.html.indexOf('id="' + id + '"') !== -1, 'missing field: ' + id);
  });
  assert.ok(markup.html.indexOf('data-action="rc-suggest-goals"') !== -1);
  assert.ok(markup.html.indexOf('data-action="save-recalibrate"') !== -1);
  assert.equal((markup.html.match(/class="goal-input-row"/g) || []).length, 3);
  assert.ok(markup.html.indexOf('Re-calibrate Training Zones') !== -1);
});

test('recalibration still writes the same paces it did before the theming', () => {
  // The theming change touched a class name and a stylesheet. This runs the
  // real save path and checks the numbers that come out of it.
  const a = loadApp({ pinnedDate: '2026-05-20T09:00:00Z' });
  a.showToast = () => {};
  buildPlan(a, { weeks: 14, startDate: a.addDays('2026-05-20', -28), distanceKey: 'full',
                 volume: 60, benchSec: 3 * 3600 + 15 * 60 });
  const before = JSON.stringify(a.state.setup.goals);

  const fields = { 'rc-bench-dist': '5k', 'rc-bench-time': '21:00',
                   'rc-goal-A': '3:05:00', 'rc-goal-B': '3:15:00', 'rc-goal-C': '3:25:00' };
  const realGet = a.document.getElementById;
  a.document.getElementById = function (id) {
    if (Object.prototype.hasOwnProperty.call(fields, id)) {
      return { value: fields[id], set textContent(v) {}, style: {},
               setAttribute() {}, classList: { add() {}, remove() {} } };
    }
    return realGet.call(a.document, id);
  };
  try { a.handleSaveRecalibrate(); } finally { a.document.getElementById = realGet; }

  const after = a.state.setup.goals;
  assert.notEqual(JSON.stringify(after), before, 'saving changed nothing');
  assert.equal(after.A.timeSec, 3 * 3600 + 5 * 60);
  assert.equal(after.B.timeSec, 3 * 3600 + 15 * 60);
  assert.equal(after.C.timeSec, 3 * 3600 + 25 * 60);
  assert.equal(a.state.setup.benchmark.distanceKey, '5k');
  assert.equal(a.state.setup.benchmark.timeSec, 21 * 60);
});
