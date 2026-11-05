'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THIS WEEK TAKES TODAY'S HIERARCHY, AND THE CARD TAKES THE GESTURE.
 * ===========================================================================
 * The session is the hero on this screen too, so it is shown the same way
 * rather than as a smaller imitation: one arm added to the focused-session
 * selector instead of a second set of rules that can drift from it.
 * And the week is swiped on the CARD, not on the day circles -- a row of
 * 44px targets is a poor thing to drag, and the card is the thing being
 * read. Committing goes through the same handleWeekPickDay() a tapped
 * circle goes through, so there is one selected date and every part of the
 * screen reads it.
 */
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const rule = sel => {
  const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const i = bare.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return bare.slice(i + sel.length + 1, bare.indexOf('}', i));
};
function app(){
  const a = loadApp({ pinnedDate: '2026-08-24T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {}; a.replaceCard = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k',
    volume: 40, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}

test('nothing on This Week is a lifted card any more', () => {
  /* The week is context and the week's shape is a reading; two rimmed boxes
     either side of the session is the arrangement that says otherwise. Each
     keeps every word and colour it had and gives up only the rim and the
     lift -- the same trade Today made. */
  ['.wk-session', '.wk-hero', '.wk-summary > .zone-card'].forEach(sel => {
    const r = rule(sel);
    assert.match(r, /background:none/, sel + ' has its fill back');
    assert.match(r, /border:0/, sel + ' has its rim back');
    assert.match(r, /box-shadow:none/, sel + ' is lifted again');
  });
});

test('the week lays out every day and moves the row, not the content', () => {
  const a = app();
  const w = a.currentWeekNum();
  const days = a.weekSessionDays(w);
  const html = a.renderWeekDayTrack(w);
  assert.equal((html.match(/class="wk-slide"/g) || []).length, days.length,
    'the track no longer holds one slide per day of the week');
  assert.match(html, /data-hswipe="1"/,
    'without data-hswipe the view pager claims the card and a day swipe changes tab');
  assert.match(html, /data-count="' \+ days\.length|data-count="\d/,
    'the track no longer declares how many days it holds');
  /* Flex items in one row, so every slide is as tall as the tallest and the
     card is a fixed box -- the zone breakdown below must not move as the
     week is swiped, which is the lesson the coaching rail learned. */
  assert.match(rule('.wk-slide'), /flex:0 0 100%/, 'a slide is no longer the full card width');
  assert.match(rule('.wk-track'), /display:flex/, 'the track is no longer one row');
  assert.match(rule('.view-week .wk-rail'), /overflow:hidden/, 'the track is no longer clipped');
  assert.match(rule('.view-week .wk-rail'), /touch-action:pan-y/,
    'the card takes the horizontal gesture and must leave vertical to the page');
});

test('every ring in the track paints with its own gradient', () => {
  /* url(#th-grad) against <linearGradient id="th-grad"> is a CONSTANT in the
     shared hero markup. Seven summaries in one document would mean seven
     elements sharing that id and every url() resolving to the first -- the
     exact failure recorded when the summary and the hidden full card both
     carried it: a visibly empty ring in a box of the right size. */
  const a = app();
  const html = a.renderWeekDayTrack(a.currentWeekNum());
  const ids = (html.match(/<linearGradient id="([^"]+)"/g) || []);
  const uniq = new Set(ids);
  assert.equal(uniq.size, ids.length,
    'two slides share a gradient id, so one of the rings will paint with nothing');
  assert.equal(html.indexOf('url(#th-grad)'), -1,
    'a slide still points at the shared gradient id');
  assert.ok(ids.length > 0, 'no slide renders a ring at all');
});

test('a swipe steps one day and stops at both ends of the week', () => {
  const a = app();
  const w = a.currentWeekNum();
  const days = a.weekSessionDays(w);
  a.weekSelectedDate = days[0].date;
  assert.equal(a.weekStepDate(w, -1), null, 'swiping back from the first day rolls somewhere');
  assert.equal(a.weekStepDate(w, 1), days[1].date, 'forward does not step exactly one day');
  a.weekSelectedDate = days[days.length - 1].date;
  assert.equal(a.weekStepDate(w, 1), null, 'swiping past the last day rolls into next week');
  assert.equal(a.weekStepDate(w, -1), days[days.length - 2].date, 'back does not step exactly one day');
});

test('the card and the day circles cannot disagree', () => {
  /* Committing calls the same handler a tapped circle calls, so the circles,
     the badges and the full session underneath all read one selected date
     rather than each deriving their own. */
  const fn = /function wireWeekRail\(rail\)\{[\s\S]*?\n\}/.exec(SRC)[0];
  assert.match(fn, /handleWeekPickDay\(to\)/,
    'the swipe sets the date by some other route than the tap does');
  assert.match(fn, /weekStepDate\(currentWeekNum\(\), p\.dx < 0 \? 1 : -1\)/,
    'the swipe no longer steps exactly one day in the direction of the finger');
  assert.match(fn, /Math\.abs\(p\.dx\) > w \* PAGER_COMMIT_FRACTION/,
    'the card commits on a different threshold from the rest of the product');
  /* Settle to where the new day will sit, THEN re-render: the fresh track is
     built at that offset, so the swap lands on the pixel the animation
     finished on. Reversing these is what makes a pager jump. */
  const settle = fn.indexOf('setX(base() + (p.dx < 0 ? -w : w));');
  const render = fn.indexOf('handleWeekPickDay(to)');
  assert.ok(settle > -1 && render > settle,
    'the day is swapped before the card has finished moving to it');
});
