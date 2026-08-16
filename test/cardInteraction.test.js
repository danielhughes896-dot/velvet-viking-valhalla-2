'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// The workout card renders `.day-detail` -- targets, description, "How to run
// this" and the fueling card -- INSIDE `.day-top`, which carries
// data-action="toggle-day" for the whole header row. Event delegation resolves
// an action with closest('[data-action]'), so a tap on the <summary> walked
// straight past the disclosure the athlete actually touched and found the
// card's own toggle: the guidance opened and the workout collapsed underneath
// it, and they had to reopen the card to read what they had just asked for.
//
// The rule is that a <details> owns clicks landing inside it, because it
// manages its own open state natively. These tests drive that rule with nodes
// that model the two DOM methods delegation depends on -- closest() walking
// ancestors and contains() -- rather than asserting on markup.
const PINNED = '2026-03-11T09:00:00Z';

/* A minimal DOM that gets ancestry right, which is the whole subject here. */
function el(tag, attrs, parent) {
  const node = {
    tagName: String(tag).toUpperCase(),
    _attrs: attrs || {},
    parentNode: parent || null,
    children: [],
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; },
    closest(sel) {
      let n = this;
      while (n) {
        if (sel === '[data-action]' && n.getAttribute('data-action') != null) return n;
        if (sel === 'details' && n.tagName === 'DETAILS') return n;
        n = n.parentNode;
      }
      return null;
    },
    contains(other) {
      let n = other;
      while (n) { if (n === this) return true; n = n.parentNode; }
      return false;
    },
  };
  if (parent) parent.children.push(node);
  return node;
}

/* The real card shape: day-top[data-action=toggle-day] > day-main > day-detail
   > details.how-card > summary. */
function card() {
  const dayTop = el('div', { 'data-action': 'toggle-day', 'data-day': 'd1' }, null);
  const dayMain = el('div', {}, dayTop);
  const detail = el('div', {}, dayMain);
  const disclosure = el('details', {}, detail);
  const summary = el('summary', {}, disclosure);
  const inner = el('span', {}, summary);                 // the icon inside the summary
  const fuel = el('details', {}, detail);
  const fuelSummary = el('summary', {}, fuel);
  const chevron = el('div', {}, dayTop);                 // the card's own chevron
  const editBtn = el('button', { 'data-action': 'open-edit', 'data-day': 'd1' }, dayTop);
  return { dayTop, detail, disclosure, summary, inner, fuel, fuelSummary, chevron, editBtn };
}

/* What the dispatcher does with a click, expressed exactly as the dispatcher
   does it: resolve the action, then ask whether a disclosure owns the click. */
function dispatch(app, eventTarget) {
  const actionEl = eventTarget.closest('[data-action]');
  if (!actionEl) return null;
  if (app.clickOwnedByDisclosure(eventTarget, actionEl)) return null;
  return actionEl.getAttribute('data-action');
}

test('tapping "How to run this" does not reach the card toggle', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  assert.equal(dispatch(app, c.summary), null,
    'the disclosure manages its own open state; the parent must not also fire');
});

test('...including a tap that lands on the icon inside the summary', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  assert.equal(dispatch(app, c.inner), null,
    'a finger lands on whatever is under it -- the icon is part of the summary');
});

test('the fueling card is protected by the same rule, not a second special case', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  assert.equal(dispatch(app, c.fuelSummary), null);
});

test('a click anywhere inside the open disclosure body is not a card toggle', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  const bodyText = el('div', {}, c.disclosure);
  assert.equal(dispatch(app, bodyText), null,
    'reading the guidance must not collapse the workout under it');
});

test('the card chevron still toggles the card', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  assert.equal(dispatch(app, c.chevron), 'toggle-day',
    'the parent control itself has to keep working');
});

test('a control with its own action inside the disclosure still fires', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  const btn = el('button', { 'data-action': 'open-edit', 'data-day': 'd1' }, c.disclosure);
  assert.equal(dispatch(app, btn), 'open-edit',
    'the rule suppresses ANCESTOR actions, not controls inside the disclosure');
});

test('a normal button elsewhere in the card is unaffected', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const c = card();
  assert.equal(dispatch(app, c.editBtn), 'open-edit');
});

test('a click with no disclosure anywhere above it behaves exactly as before', () => {
  const app = loadApp({ pinnedDate: PINNED });
  const lone = el('div', { 'data-action': 'open-settings' }, null);
  const kid = el('span', {}, lone);
  assert.equal(dispatch(app, kid), 'open-settings');
});

// ---------------------------------------------------------------------------
// THE CARD'S OWN EXPANDED STATE
// ---------------------------------------------------------------------------
test('opening and closing the guidance never changes the workout expansion', () => {
  const app = loadApp({ pinnedDate: PINNED });
  buildPlan(app, { weeks: 12, startDate: app.addDays(app.todayStr(), -14) });
  const dd = app.state.days.filter(d => d.date > app.todayStr() && d.type !== 'rest')[0];
  const before = app.isDayExpanded(dd);
  const c = card();
  dispatch(app, c.summary);            // open guidance
  dispatch(app, c.summary);            // close guidance
  assert.equal(app.isDayExpanded(dd), before,
    'the disclosure is a child control; the card state is not its business');
});

test('the chevron still independently collapses and re-expands the card', () => {
  const app = loadApp({ pinnedDate: PINNED });
  buildPlan(app, { weeks: 12, startDate: app.addDays(app.todayStr(), -14) });
  const dd = app.state.days.filter(d => d.date > app.todayStr() && d.type !== 'rest')[0];
  const start = app.isDayExpanded(dd);
  app.handleToggleDay(dd.id);
  assert.equal(app.isDayExpanded(dd), !start);
  app.handleToggleDay(dd.id);
  assert.equal(app.isDayExpanded(dd), start);
});
