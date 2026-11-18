'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const fs = require('fs');
const path = require('path');

// AUDIT REPRO (Final Full Product Audit, Part 21, finding B). .day-top --
// the single most-used interactive control in the app, present on every
// day card in Today/This Week/Full Plan -- was a bare non-semantic
// <div data-action="toggle-day">, with no role="button", no tabindex and no
// keydown handler, unlike .dropzone elsewhere in the same file, which
// already did this correctly. A screen-reader or keyboard-only athlete
// could not discover or activate it.
//
// THE FIX. .day-top now carries role="button" tabindex="0"
// aria-expanded="…", and a single document-level keydown delegate
// activates any [data-action][role="button"] element on Enter/Space by
// calling its own .click() (reusing the existing click switch rather than
// duplicating it). Matched on e.target directly, not closest(), so a
// nested native control (the completion checkbox, the edit button -- both
// already independently focusable, with their own data-action) does not
// also re-fire .day-top's toggle.

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-06-09';

function plannedApp() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, -7) });
  return a;
}

test('.day-top is a real (keyboard-discoverable) button for a genuine day', () => {
  const a = plannedApp();
  const dd = a.state.days.find((d) => d.type !== 'rest');
  const card = a.renderDayCard(dd);
  const top = (card.match(/<div class="day-top"[^>]*>/) || [])[0];
  assert.ok(top, 'sanity: .day-top must render');
  assert.match(top, /role="button"/);
  assert.match(top, /tabindex="0"/);
  assert.match(top, /aria-expanded="(true|false)"/);
});

test('aria-expanded reflects the real accordion state, where there is one', () => {
  const a = plannedApp();
  const today = a.state.days.find((d) => d.date === TODAY);
  const other = a.state.days.find((d) => d.date !== TODAY && d.type !== 'rest');
  assert.ok(today && other, 'sanity: fixture needs both a today day and another day');
  const topOther = (a.renderDayCard(other).match(/<div class="day-top"[^>]*>/) || [])[0];
  assert.match(topOther, /aria-expanded="false"/, 'an untouched other day defaults collapsed');
  assert.match(topOther, /role="button"/, 'a real accordion lost its role');
  assert.match(topOther, /tabindex="0"/, 'a real accordion lost its keyboard reach');
});

test('the one session a screen is about offers no control it cannot honour', () => {
  /* THE OTHER HALF OF THE SAME ACCESSIBILITY RULE. The original finding was
     that .day-top was an interactive control announced as nothing. The
     inverse is just as bad: on Today, This Week's opened day and Full Plan's
     session screen the card is forced open and cannot usefully be shut --
     tapping the header collapsed the only thing on the screen. A header
     announced as a button, reachable by Tab and activated by Enter, that
     empties the page is worse than an unlabelled one. So on those three
     screens it is not a control at all: no role, no tabindex, no
     aria-expanded, no action, and no chevron advertising one. */
  const a = plannedApp();
  const today = a.state.days.find((d) => d.date === TODAY);
  a.state.view = 'today';
  const card = a.renderDayCard(today);
  const top = (card.match(/<div class="day-top"[^>]*>/) || [])[0];
  assert.ok(top, 'the focused card lost its header');
  assert.equal(top, '<div class="day-top">', 'the focused header still advertises a control: ' + top);
  assert.doesNotMatch(card, /class="day-chevron"/, 'the focused card kept its disclosure arrow');
  /* And the handler refuses too, so a stale listener cannot collapse it. */
  a.handleToggleDay(today.id);
  assert.equal(a.isDayExpanded(today), true, 'the focused session was collapsed anyway');
});

test('the nested edit button and completion checkbox keep their own data-action, distinct from day-top', () => {
  const a = plannedApp();
  const dd = a.state.days.find((d) => d.type !== 'rest');
  const card = a.renderDayCard(dd);
  assert.match(card, /data-action="open-edit"/);
  assert.match(card, /data-action="toggle-complete"/);
});

test('a single document-level keydown delegate activates [data-action][role="button"] elements via .click()', () => {
  const at = SRC.indexOf("document.addEventListener('keydown'");
  assert.ok(at !== -1, 'the keydown delegate must exist');
  const body = SRC.slice(at, SRC.indexOf('\n});', at) + 4);
  assert.match(body, /Enter/);
  assert.match(body, /' '/, 'Space must also activate (checked as the literal \' \' key)');
  // Matched on e.target directly (NOT closest()) -- the precise guard
  // against a nested native control (e.g. the completion checkbox) also
  // re-firing .day-top's own toggle when it does not itself carry
  // role="button".
  assert.match(body, /target\.matches\(/);
  assert.doesNotMatch(body, /target\.closest\(/,
    'must not walk up to an ancestor action -- that would double-fire a nested control\'s own keyboard activation');
  assert.match(body, /target\.click\(\)/, 'must reuse the existing click switch via a synthetic click');
  assert.match(body, /preventDefault/);
});
