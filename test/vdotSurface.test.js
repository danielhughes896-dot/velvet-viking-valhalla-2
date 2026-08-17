'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* VDOT IS A TOOL, NOT A PRODUCT.
 *
 * The engine calculates a VDOT and always will: it is how a benchmark becomes
 * training paces, how an equivalent race time is derived, and how a goal is
 * checked for plausibility. That machinery is load-bearing and this suite
 * protects it.
 *
 * What was removed is the *label*. "VDOT 48.3" told the athlete a number from
 * someone else's literature, in a unit they cannot act on, next to paces they
 * can. It made the app look like it was scoring them. Three surfaces carried
 * it -- the goal buttons, the Pace Reference header on Today, and the Training
 * Zone Paces header in Plan HQ -- and all three already said something useful
 * without it.
 *
 * These tests are two-sided on purpose. Deleting a badge is easy; deleting it
 * and quietly replacing it with a different unexplained number, or deleting it
 * and breaking the paces it was derived from, are the two ways this change
 * could go wrong. So the suite asserts the label is gone, the substance is
 * intact, and the mathematics still runs. */

const TODAY = '2026-05-20';
const app = () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -28), distanceKey: '10k' });
  return a;
};

const SRC = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const stripComments = s => s
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ---------------------------------------------------------------------------
// 1. THE LABEL IS GONE FROM EVERY SURFACE THE ATHLETE CAN REACH
// ---------------------------------------------------------------------------
/* Rendered output, not source strings. Anything the athlete's eyes can land on
   went through one of these functions to get there. `vdot` rather than `VDOT`
   so a stray class name is caught alongside a stray caption. */
const SURFACES = [
  'renderGoalButtons',
  'renderGoalToggle',
  'renderCompactPaceReference',
  'renderZonePacesCard',
  'renderTodayView',
  'renderPlanHQView',
];

SURFACES.forEach(fn => {
  test('no VDOT reaches the athlete through ' + fn + '()', () => {
    const a = app();
    const html = a[fn]();
    assert.equal(typeof html, 'string', fn + ' must still render');
    assert.ok(!/vdot/i.test(html),
      fn + ' still shows the athlete a VDOT: ' + (html.match(/.{0,60}vdot.{0,60}/i) || [''])[0]);
  });
});

test('nothing anywhere in the shipped source can print the word', () => {
  /* Identifiers keep it -- getActiveVDOT, vdotFromPerformance,
     trainingPacesFromVDOT -- and comments are free to explain the physiology.
     Only a *string literal* can end up in front of an athlete, so that is the
     thing forbidden. This is the guard that makes the badge hard to reintroduce
     by accident on a fourth surface nobody thought to test. */
  const code = stripComments(SRC);
  const literals = code.match(/'[^'\n]*'|"[^"\n]*"/g) || [];
  const offenders = literals.filter(s => /vdot/i.test(s));
  assert.deepEqual(offenders, [],
    'a string literal carrying VDOT is a caption waiting to be rendered');
});

test('and no stylesheet still dresses one', () => {
  const css = SRC.slice(SRC.indexOf('<style'), SRC.indexOf('</style>'));
  assert.ok(!/vdot/i.test(css),
    'a surviving .vdot rule is a badge that was removed from one surface and not another');
});

// ---------------------------------------------------------------------------
// 2. THE SUBSTANCE THE BADGE SAT NEXT TO IS UNTOUCHED
// ---------------------------------------------------------------------------
test('Pace Reference is still Pace Reference, and nothing took the badge’s place', () => {
  const a = app();
  const html = a.renderCompactPaceReference();
  assert.match(html, /Pace Reference/, 'the card keeps its name');
  assert.match(html, /<div class="pace-ref-head"><span class="font-head">Pace Reference<\/span><\/div>/,
    'the header carries the title and nothing else — no substitute score, no unexplained number');
  assert.match(html, /\d+:\d\d/, 'and the paces it exists for are still there');
});

test('Training Zone Paces is still Training Zone Paces, on the same terms', () => {
  const a = app();
  const html = a.renderZonePacesCard();
  assert.match(html, /Training Zone Paces/);
  assert.match(html, /<div class="zpc-head"><span class="font-head">Training Zone Paces<\/span><\/div>/,
    'header title only');
  assert.match(html, /\d+:\d\d/, 'the zone paces themselves are the point of the card');
});

test('a goal option still says which goal it is and what time it means', () => {
  const a = app();
  const html = a.renderGoalButtons();
  assert.match(html, /data-goal="A"/, 'the goal is still selectable');
  assert.match(html, />A</, 'and still named');
  assert.match(html, new RegExp(a.secToClock(a.state.setup.goals.A.timeSec).replace(/:/g, ':')),
    'the target time is the athlete-facing fact and it stays');
  assert.ok(!/\d+\.\d/.test(html.replace(/\d+:\d+/g, '')),
    'and nothing decimal replaced the badge that was removed');
});

// ---------------------------------------------------------------------------
// 3. THE MATHEMATICS UNDERNEATH IS UNCHANGED
// ---------------------------------------------------------------------------
/* Removing a label must not remove a calculation. If any of these regress, the
   paces in section 2 are wrong even though the card still looks right -- which
   is the failure mode a purely cosmetic test would miss. */
test('the engine still computes a VDOT for the active goal', () => {
  const a = app();
  const v = a.getActiveVDOT();
  assert.equal(typeof v, 'number');
  assert.ok(isFinite(v) && v > 0, 'getActiveVDOT() is what every training pace is derived from');
});

test('vdotFromPerformance() still turns a race performance into a fitness value', () => {
  const a = app();
  const fast = a.vdotFromPerformance(10000, a.clockToSec('0:40:00'));
  const slow = a.vdotFromPerformance(10000, a.clockToSec('0:50:00'));
  assert.ok(isFinite(fast) && isFinite(slow));
  assert.ok(fast > slow, 'a faster 10K must mean a higher value or the whole model is inverted');
});

test('trainingPacesFromVDOT() still produces an ordered set of zones', () => {
  const a = app();
  const paces = a.trainingPacesFromVDOT(a.getActiveVDOT());
  assert.ok(paces && typeof paces === 'object');
  assert.deepEqual(Object.keys(paces).join(','), 'E,M,T,I,R',
    'the five zone keys the whole prescription language is built on');
  assert.ok(paces.I.fast < paces.E.fast,
    'interval work is still faster than easy running — the zones are real, not placeholders');
});

test('equivalentTimeSec() still answers the goal-plausibility question', () => {
  const a = app();
  const t = a.equivalentTimeSec(a.getActiveVDOT(), 21097.5);
  assert.ok(isFinite(t) && t > 0, 'an equivalent half-marathon time is still derivable');
});

test('the paces the athlete reads are the paces the engine derived', () => {
  /* The badge is gone; the number behind it must still be the one driving the
     card. Change the benchmark, and the rendered paces have to move. */
  const a = app();
  const before = a.renderCompactPaceReference();
  a.state.setup.benchmark = { distanceKey: '10k', timeSec: a.clockToSec('0:38:00') };
  a.state.setup.goals = { A: { timeSec: a.clockToSec('0:37:00') } };
  const after = a.renderCompactPaceReference();
  assert.notEqual(before, after,
    'a materially fitter athlete must be shown materially different paces');
});
