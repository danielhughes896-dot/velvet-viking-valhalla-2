'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* HOW AN ESTIMATED FITNESS RANGE IS PRINTED.
 * ===========================================================================
 * Display only. The estimate still holds exact seconds, every comparison is
 * still made against them, and nothing in this file touches a calculation.
 *
 * Two rules, and the second is the one that keeps this honest across the
 * product's distances rather than just the marathon it was reported against:
 *   - at and above an hour, round to the nearest minute
 *   - below an hour, keep the seconds, because "21-22" for a 5K is ambiguous
 *     rather than clearer
 */

const TODAY = '2026-11-02';
function app(distanceKey){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey, volume:55, weeks:14, startDate: a.addDays(TODAY, -35) });
  a.state.setup.purpose = 'race';
  return a;
}
const strip = h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

test('an hour or more rounds to the nearest minute', () => {
  const a = app('full');
  /* HQ's own example, to the second. */
  assert.equal(a.fitnessRangeText(3*3600+17*60+30, 3*3600+38*60+18), '3:18\u20133:38');
  assert.equal(a.secToClockEstimate(3*3600+17*60+29), '3:17', 'rounds down below the half minute');
  assert.equal(a.secToClockEstimate(3*3600+17*60+31), '3:18', 'and up above it');
  assert.equal(a.secToClockEstimate(3600), '1:00');
  assert.equal(a.secToClockEstimate(3*3600+59*60+40), '4:00', 'carries into the hour');
});

test('below an hour the seconds stay, because they are the whole resolution', () => {
  const a = app('5k');
  assert.equal(a.secToClockEstimate(21*60+9), '21:09');
  assert.equal(a.fitnessRangeText(21*60+9, 22*60+15), '21:09\u201322:15');
  assert.equal(a.secToClockEstimate(45*60), '45:00');
});

test('a range tight enough to round to one minute prints one time', () => {
  const a = app('full');
  assert.equal(a.fitnessRangeText(3*3600+17*60+50, 3*3600+18*60+10), '3:18',
    'rounding closed the range and it was printed as "3:18-3:18"');
});

test('the range is labelled with the athlete\'s own distance, never the marathon\'s', () => {
  const seen = {};
  [['5k','5K'], ['10k','10K'], ['half','HALF MARATHON'], ['full','FULL MARATHON']].forEach(([k, want]) => {
    const a = app(k);
    assert.equal(a.fitnessRangeLabel(k), want + ' FITNESS RANGE');
    seen[k] = strip(a.renderCurrentFitnessInstrument());
  });
  /* And the rendered card carries it, so the two numbers are never bare. */
  assert.match(seen['5k'], /5K FITNESS RANGE/);
  assert.match(seen['half'], /HALF MARATHON FITNESS RANGE/);
  assert.doesNotMatch(seen['5k'], /MARATHON FITNESS RANGE/,
    'a 5K athlete was shown a marathon label');
  assert.doesNotMatch(seen['10k'], /MARATHON/, 'likewise the 10K');
});

test('a 5K card keeps its seconds while a marathon card loses them', () => {
  assert.match(strip(app('5k').renderCurrentFitnessInstrument()), /\d\d:\d\d\u2013\d\d:\d\d/,
    'the 5K range lost the seconds it needs');
  const full = app('half');   // the marathon withholds without two weeks logged
  assert.match(strip(full.renderCurrentFitnessInstrument()), /1:\d\d\u20131:\d\d(?!:)/,
    'the half-marathon range was not rounded to the minute');
});

test('the goal is never rounded, because the athlete chose it', () => {
  const a = app('full');
  a.state.setup.goals = { A: { timeSec: 3*3600+29*60+45 } };
  a.state.setup.activeGoal = 'A';
  const html = strip(a.renderCurrentFitnessInstrument());
  assert.match(html, /3:29:45/, 'a chosen 3:29:45 was rounded to 3:30');
  assert.match(html, /Goal A/, 'and it is labelled with which goal it is');
});

test('the card says where the goal sits in the range', () => {
  const a = app('half');
  const est = a.currentFitnessEstimate('half');
  const say = sec => {
    a.state.setup.goals = { A: { timeSec: sec } }; a.state.setup.activeGoal = 'A';
    return strip(a.renderCurrentFitnessInstrument());
  };
  assert.match(say(est.fastSec - 600), /Faster than your current fitness range/);
  assert.match(say(Math.round((est.fastSec + est.slowSec) / 2)), /Inside your current fitness range/);
  assert.match(say(est.slowSec + 600), /already suggests a faster time/);
});

test('Race Outlook prints the same rounded range, and its aria label agrees', () => {
  const a = app('full');
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').forEach(d => logAsPrescribed(a, d));
  const o = a.raceOutlook();
  assert.ok(o && (o.state === 'measured' || o.state === 'estimated'),
    'the fixture produced no band, so this proves nothing');
  const html = a.renderRaceOutlook();
  const want = a.fitnessRangeText(o.fastSec, o.slowSec);
  assert.ok(html.indexOf(want) !== -1, 'the band is not showing the rounded range');
  assert.ok(html.indexOf(a.secToClock(o.fastSec)) === -1,
    'the band is still printing seconds somewhere');
  /* The screen-reader text and the drawn labels must not disagree. */
  const aria = (html.match(/aria-label="([^"]*)"/) || [])[1] || '';
  assert.ok(aria.indexOf(a.fitnessRangeText(o.fastSec, o.slowSec, ' to ')) !== -1,
    'the aria label still reads the unrounded range');
  if (o.goalSec != null)
    assert.ok(aria.indexOf(a.secToClock(o.goalSec)) !== -1, 'the goal lost its exact seconds');
});

test('nothing about the estimate itself moved', () => {
  /* The guard on "display only". If a rounding ever leaks into the model,
     these are the numbers that change first. */
  ['5k','10k','half'].forEach(k => {
    const a = app(k);
    const est = a.currentFitnessEstimate(k);
    const mid = a.equivalentTimeSec(a.currentFitnessAnchor().vdot,
                                    a.DISTANCE_PROFILES[k].raceKm * 1000);
    const spread = k === 'half' ? 0.035 : 0.025;
    assert.equal(est.fastSec, Math.round(mid * (1 - spread)), k + ': fast end moved');
    assert.equal(est.slowSec, Math.round(mid * (1 + spread)), k + ': slow end moved');
    assert.ok(est.fastSec % 60 !== 0 || est.slowSec % 60 !== 0,
      k + ': both ends landed exactly on a minute, so this guard proved nothing');
  });
});
