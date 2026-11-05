'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// AUDIT REPRO (Final Full Product Audit, Part 12, finding B1), AND WHAT
// BECAME OF IT.
//
// THE ORIGINAL DEFECT, IN TWO HALVES. Valhalla's Recovery and Evolution
// dials hard-coded a fixed category colour (green, gold) regardless of the
// reading's live tone, so (a) a "Strained" Recovery rendered inside a calm
// green circle -- a reassuring colour for a fatigue warning -- and (b) the
// Coach tab's list row for the exact same readingSections() object coloured
// by the live tone, so the app contradicted itself one tab over. The fix
// then was to make the dials follow toneRingColor(sec.tone).
//
// WHY THAT FIX HAS BEEN REPLACED RATHER THAN KEPT. The Coach tab is gone:
// the circles are the destinations now and there is no second list to
// disagree with, so half (b) cannot recur. And once five circles sit on one
// row, three of them independently traffic-lighting themselves made the row
// unreadable -- on a good day recovery, evolution and adaptation were all
// the same green as each other and as nothing in particular, and the one
// circle the row is built around could not be picked out of them. Colour
// now says WHICH reading a circle is.
//
// SO HALF (a) IS NOT ANSWERED BY COLOUR ANY MORE, AND MUST STILL BE
// ANSWERED. It is answered by the word: the face states the engine's own
// "Fresh" / "Watch" / "Strained", and the panel behind the circle still
// carries the tone. This file holds BOTH ends of that bargain -- the colour
// may not move, and the words and the panel must.

function planHQ() {
  const a = loadApp();
  buildPlan(a, { weeks: 8, startDate: a.addDays(a.todayStr(), -14) });
  return a;
}
/* The engine, pinned to a verdict, so every assertion below is about one
   known reading rather than whatever the fixture happened to produce. */
function withRecovery(a, state) {
  const orig = a.coachAnalyse;
  a.coachAnalyse = function () {
    const r = orig.apply(this, arguments);
    r.recovery.state = state;
    return r;
  };
  return a;
}
const faceOf = (html, key) =>
  ((html.match(new RegExp('data-reading="' + key + '"[\\s\\S]*?<b[^>]*>([^<]*)</b>')) || [])[1] || '');
const accentOf = (html, key) =>
  ((html.match(new RegExp('--rd-base:([^;]+);[^>]*data-reading="' + key + '"')) ||
    html.match(new RegExp('data-reading="' + key + '"[^>]*--rd-base:([^;]+);')) || [])[1] || '');

// ---------------------------------------------------------------------------
// 1. THE COLOUR IS AN IDENTITY
// ---------------------------------------------------------------------------

test('a reading\'s colour is fixed, and the engine cannot reach it', () => {
  const a = planHQ();
  const secs = a.readingSections(a.coachAnalyse());
  const expected = {
    recovery: 'var(--gold-bright)',
    evolution: 'var(--z-easy)',
    readiness: 'var(--cherry)',
    patterns: 'var(--ink)',
    adaptation: 'var(--z-mp)',
  };
  secs.forEach((sec) => {
    assert.equal(a.dialAccentBase(sec), expected[sec.key], sec.key + ' took the wrong identity');
    /* The same section object with every tone the engine can produce --
       the accent must not move for any of them. */
    ['good', 'watch', 'bad', null].forEach((tone) => {
      const copy = Object.assign({}, sec, { tone: tone });
      assert.equal(a.dialAccentBase(copy), expected[sec.key],
        sec.key + ' changed colour for tone "' + tone + '"');
      assert.equal(a.dialTint(copy), a.dialTint(sec),
        sec.key + ' changed its face wash for tone "' + tone + '"');
    });
  });
  /* The strongest form of "fixed": a function that cannot see the tone
     cannot follow it. */
  assert.doesNotMatch(String(a.dialAccentBase), /tone/, 'dialAccentBase still reads sec.tone');
  assert.doesNotMatch(String(a.dialTint), /tone/, 'dialTint still reads sec.tone');
});

// ---------------------------------------------------------------------------
// 2. THE VERDICT IS THE WORD, AND THE WORD MUST MOVE
// ---------------------------------------------------------------------------

test('a strained recovery says so on the circle itself', () => {
  /* THE AUDIT SCENARIO, RE-ASKED OF THE SURFACE THAT ANSWERS IT NOW. The
     finding was that the at-a-glance instrument reassured an athlete whose
     recovery was strained. The instrument must still not do that -- it
     simply says it in words rather than in hue. */
  const a = withRecovery(planHQ(), 'strained');
  const html = a.renderValhallaReadingPreview();
  assert.equal(faceOf(html, 'recovery'), 'Strained',
    'the recovery circle does not state the engine\'s own verdict');
  assert.doesNotMatch(faceOf(html, 'recovery'), /fresh/i);
});

test('the face follows the engine through every recovery state', () => {
  const words = { fresh: 'Fresh', watch: 'Watch', strained: 'Strained' };
  const seen = {};
  Object.keys(words).forEach((state) => {
    const a = withRecovery(planHQ(), state);
    const html = a.renderValhallaReadingPreview();
    assert.equal(faceOf(html, 'recovery'), words[state],
      'recovery "' + state + '" is not stated as "' + words[state] + '"');
    seen[state] = accentOf(html, 'recovery');
  });
  /* And the colour stayed put across all three, which is the other half. */
  assert.equal(new Set(Object.values(seen)).size, 1,
    'the recovery circle changed colour between verdicts');
});

test('the panel behind the circle still carries the tone', () => {
  /* Colour did not leave the product, it left the ROW. The evidence panel is
     where a verdict is read rather than glanced at, and .read-val is the one
     surface in this product allowed to carry the engine's tone. */
  const a = withRecovery(planHQ(), 'strained');
  const panel = a.readingPanel('recovery');
  assert.match(panel, /class="read-val bad"/,
    'the recovery panel lost the tone the circle gave up');
  assert.match(panel, /class="read-dot"/, 'and its tone dot with it');
  const fresh = withRecovery(planHQ(), 'fresh').readingPanel('recovery');
  assert.match(fresh, /class="read-val good"/, 'the panel does not follow the engine at all');
});

test('every reading on the row is told apart by its colour', () => {
  /* The reason the fix was replaced, asserted: five readings, five distinct
     identities, on every possible day. The previous behaviour could put
     three of them in the same green at once. */
  const a = planHQ();
  const secs = a.readingSections(a.coachAnalyse());
  const accents = secs.map((s) => a.dialAccentBase(s));
  assert.equal(new Set(accents).size, secs.length,
    'two readings share a colour, so the row cannot be read at a glance');
});
