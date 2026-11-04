'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness');

// THE DOOR THE ATHLETE USES.
//
// Every interactive control in the app is a `data-action` attribute, and one
// delegated listener on `document` turns that string into a call. The handlers
// behind it are covered thoroughly -- but by name, which is a different thing
// from being reachable. A case that reads the clicked element through a
// variable the dispatcher never declared compiles, loads, passes its handler's
// own tests, and does nothing at all when a finger lands on the button: the
// listener throws on the undeclared read before the handler is ever called.
//
// That is not hypothetical. `optional-run-log`, `-save` and `-remove` shipped
// reading `el` in a function whose clicked element is called `target`, so the
// entire optional-run card -- offer, form, save, remove -- was dead in the
// browser while three test files exercised its handlers and passed.
//
// So this file enters the same way the athlete does. It does not re-test what
// any handler decides; it asserts only that the dispatcher can carry a click
// to it.
const ROOT = path.join(__dirname, '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');

/* A DOM that answers. The harness's document returns null for every lookup,
   which is right for tests that call pure functions -- but a handler entered
   through a real click dereferences what it looks up, so a null answer stops
   the probe at the first `.value` instead of letting the dispatcher's work be
   observed. Answering with an inert element lets each case run far enough to
   show whether it can read the clicked button at all, which is the one thing
   under test. Nothing here asserts what a handler does with the element. */
function inertElement() {
  const node = {
    style: {}, dataset: {}, value: '', checked: false, textContent: '', innerHTML: '',
    files: [], options: [], selectedIndex: 0, scrollHeight: 0, offsetHeight: 0,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    getAttribute(){ return null; }, setAttribute(){}, removeAttribute(){},
    appendChild(){}, removeChild(){}, insertBefore(){}, remove(){},
    addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; },
    focus(){}, blur(){}, click(){}, scrollIntoView(){}, closest(){ return null; },
    getBoundingClientRect(){ return { top:0, left:0, width:0, height:0, bottom:0, right:0 }; },
  };
  node.querySelector = () => inertElement();
  node.querySelectorAll = () => [];
  node.parentNode = null;
  return node;
}

/* Firing actions against a stub DOM still leaves a handful of handlers
   rejecting a promise nobody awaits -- an artefact of the probe, not a defect
   in the app, and it must not fail the file. The one failure mode under test
   here is synchronous and is asserted explicitly. */
process.on('unhandledRejection', function(){});

/* Every action the markup actually emits. Reading the attributes rather than
   the `case` labels is deliberate: a case nothing emits is dead code, while an
   attribute with no reachable case is a dead button, and it is the button that
   the athlete presses. */
function emittedActions(src) {
  const out = new Set();
  for (const m of src.matchAll(/data-action="([a-z0-9-]+)"/g)) out.add(m[1]);
  return [...out].sort();
}

function clickListener(app) {
  const fns = (app.document._listeners || {}).click || [];
  assert.equal(fns.length, 1, 'the app should register exactly one delegated click listener');
  return fns[0];
}

/* A clicked element shaped the way the dispatcher reads one: it answers
   getAttribute() and closest(), and closest('details') finds nothing so the
   disclosure guard lets the click through. */
function clickOn(action, attrs) {
  const a = Object.assign({ 'data-action': action }, attrs || {});
  const node = {
    getAttribute(n){ return Object.prototype.hasOwnProperty.call(a, n) ? a[n] : null; },
    closest(sel){ return sel === 'details' ? null : this; },
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    setAttribute(){}, removeAttribute(){}, focus(){}, blur(){},
    value: '', checked: false, dataset: {},
  };
  return { target: node, currentTarget: node, preventDefault(){}, stopPropagation(){} };
}

/* vm sandbox errors are built from the sandbox's own constructors, so
   `instanceof ReferenceError` is false for them across the realm boundary.
   The name is the reliable signal. */
function errName(e) {
  return (e && e.constructor && e.constructor.name) || String(e).split(':')[0];
}

test('no data-action click can reach an undeclared variable in the dispatcher', () => {
  const app = loadApp({ pinnedDate: '2026-03-10T09:00:00Z' });
  const fire = clickListener(app);
  app.document.getElementById = () => inertElement();
  app.document.querySelector = () => inertElement();
  const broken = [];
  for (const action of emittedActions(APP_SRC)) {
    try {
      fire.call(app.document, clickOn(action, { 'data-day': 'probe-day', 'data-week': '1' }));
    } catch (e) {
      // A handler that cannot find its element in a stub DOM is expected and
      // is not what this guards. An undeclared identifier is.
      if (errName(e) === 'ReferenceError') broken.push(action + ': ' + e.message);
    }
  }
  assert.deepEqual(broken, [], 'dispatcher cases referring to variables that do not exist');
});

/* The specific case that shipped broken, asserted on its own terms: the click
   must arrive at the handler, carrying the day the button was drawn for. */
test('the optional-run card reaches its handlers with the clicked day', () => {
  const app = loadApp({ pinnedDate: '2026-03-10T09:00:00Z' });
  const fire = clickListener(app);
  const seen = [];
  for (const name of ['handleOptionalRunLog', 'handleOptionalRunSave', 'handleOptionalRunRemove']) {
    assert.equal(typeof app[name], 'function', name + ' should exist');
    app[name] = function(dayId){ seen.push(name + '/' + dayId); };
  }
  fire.call(app.document, clickOn('optional-run-log', { 'data-day': '2026-03-12' }));
  fire.call(app.document, clickOn('optional-run-save', { 'data-day': '2026-03-12' }));
  fire.call(app.document, clickOn('optional-run-remove', { 'data-day': '2026-03-12' }));
  assert.deepEqual(seen, [
    'handleOptionalRunLog/2026-03-12',
    'handleOptionalRunSave/2026-03-12',
    'handleOptionalRunRemove/2026-03-12',
  ]);
});
