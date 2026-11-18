'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* TWO FOUNDER-APPROVED CHANGES (18 November 2026).

   1. The pace box asks when a pace is impossible: "62:00 per km looks like
      your total time. Use 6:12 per km instead?" A Strava activity whose
      distance is tiny against its moving time says "GPS distance looks
      wrong" instead of a nonsense pace.
   2. The Recovery graph breaks its line across a gap of more than 14 days.

   The harness answers every askSacoro sheet with app.confirm (true is the
   primary button, false is Edit), so each test records what was asked. */

const TODAY = '2026-11-18';
function app(units){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -21), healthConsent: true });
  a.state.units = units || 'km';
  a.asked = [];
  a.answer = true;
  a.confirm = msg => { a.asked.push(msg); return a.answer; };
  return a;
}
function logged(a, km){
  const dd = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY)[0];
  dd.completed = true;
  dd.actual = a.emptyActual();
  if (km != null) a.handleActualFieldChange(dd.id, 'km', String(km));
  return dd;
}
/* The sheet's own markup, for the buttons the harness does not draw. */
function sheetFor(a, shownSec, km){
  const q = a.impossiblePaceSay(shownSec, km);
  return q ? a.askSacoroHtml(q) : '';
}

// ---------------------------------------------------------------------------
// 1. THE PACE BOX
// ---------------------------------------------------------------------------

test('62:00 over 10 km: the sheet asks, with 6:12 per km worked out', () => {
  const a = app();
  const dd = logged(a, 10);
  a.answer = false;                                     // look, then Edit
  a.handleActualFieldChange(dd.id, 'pace', '62:00');
  assert.equal(a.asked.length, 1, 'no sheet for a 62-minute kilometre');
  assert.match(a.asked[0], /^62:00 per km looks like your total time\. Use 6:12 per km instead\?/);
  const html = sheetFor(a, 62 * 60, 10);
  assert.match(html, />Use 6:12\/km</, 'the primary button does not name the pace');
  assert.match(html, /btn-primary" data-action="ask-yes">Use 6:12\/km</);
  assert.match(html, /data-action="ask-no">Edit</);
  assert.doesNotMatch(html, /—/, 'an em dash in the sheet');
});

test('Use applies the worked-out pace', () => {
  const a = app();
  const dd = logged(a, 10);
  a.handleActualFieldChange(dd.id, 'pace', '62:00');
  assert.equal(a.asked.length, 1);
  assert.equal(dd.actual.pace, '6:12');
  assert.equal(dd.actual.paceUnit, 'km');
  assert.equal(a.actualPaceToSecPerKm(dd), 372);
});

test('Edit stores nothing and leaves the field for editing, with the pace already logged kept', () => {
  const a = app();
  const dd = logged(a, 10);
  a.handleActualFieldChange(dd.id, 'pace', '5:40');
  assert.equal(a.asked.length, 0);
  a.answer = false;
  a.handleActualFieldChange(dd.id, 'pace', '62:00');
  assert.equal(a.asked.length, 1);
  assert.equal(dd.actual.pace, '5:40', 'Edit replaced the pace already logged');
  /* On an empty log, Edit leaves it empty: nothing impossible is kept. */
  const b = app();
  const d2 = logged(b, 10);
  b.answer = false;
  b.handleActualFieldChange(d2.id, 'pace', '62:00');
  assert.equal(d2.actual.pace, null, 'an impossible pace was stored after Edit');
});

test('a pace a runner produces is saved with no sheet', () => {
  const a = app();
  const dd = logged(a, 10);
  ['5:12', '2:30', '15:00', '9:45'].forEach(p => {
    a.handleActualFieldChange(dd.id, 'pace', p);
    assert.equal(dd.actual.pace, p);
  });
  assert.deepEqual(a.asked, [], 'a plausible pace was asked about');
});

test('when the arithmetic gives another impossible pace, the sheet offers Edit and no conversion', () => {
  const a = app();
  const dd = logged(a, 10);
  /* 15:30 over 10 km would be a 1:33 kilometre. */
  a.handleActualFieldChange(dd.id, 'pace', '15:30');
  assert.equal(a.asked.length, 1);
  assert.match(a.asked[0], /^15:30 per km looks wrong for a run\./);
  assert.doesNotMatch(a.asked[0], /Use /);
  assert.equal(dd.actual.pace, null, 'the only answer, Edit, stored the pace');
  const html = sheetFor(a, 15 * 60 + 30, 10);
  assert.match(html, /data-action="ask-yes">Edit</);
  assert.doesNotMatch(html, /btn-ghost/, 'a second answer on a one-answer sheet');
  assert.doesNotMatch(html, /Use \d/);
  /* The same with no distance known at all. */
  assert.equal(a.impossiblePaceSay(62 * 60, null).use, null);
});

test('a short run: 15:30 over 2.5 km is offered as 6:12 per km', () => {
  const a = app();
  const dd = logged(a, 2.5);
  a.handleActualFieldChange(dd.id, 'pace', '15:30');
  assert.match(a.asked[0], /Use 6:12 per km instead\?/);
  assert.equal(dd.actual.pace, '6:12');
});

test('miles: the sheet speaks in miles and Use stores the mile pace', () => {
  const a = app('mi');
  const dd = logged(a, 6.2);                         // 6.2 mi, held as 10.0 km
  a.handleActualFieldChange(dd.id, 'pace', '62:00');
  const m = /^62:00 per mile looks like your total time\. Use (\d+:\d\d) per mile instead\?/.exec(a.asked[0]);
  assert.ok(m, a.asked[0]);
  assert.ok(Math.abs(a.paceToSec(m[1]) - 600) <= 2, m[1] + ' is not 62 minutes over about 6.2 miles');
  assert.equal(dd.actual.pace, m[1]);
  assert.equal(dd.actual.paceUnit, 'mi');
  assert.match(sheetFor(a, 62 * 60, dd.actual.km), new RegExp('>Use ' + m[1] + '/mi<'));
});

test('a stage pace is asked about over the stage’s own distance', () => {
  const a = app();
  const dd = a.state.days.filter(d => { try { return a.loggingModeFor(d).mode === 'structured'; } catch (e) { return false; } })
    .filter(d => Array.from(a.loggingModeFor(d).plan.rows).some(r => r.presKm >= 3 && r.presKm <= 15))[0];
  assert.ok(dd, 'the fixture has no structured session with a measured stage');
  dd.completed = true; dd.actual = a.emptyActual();
  const row = Array.from(a.loggingModeFor(dd).plan.rows).filter(r => r.presKm >= 3 && r.presKm <= 15)[0];
  const total = Math.round(row.presKm * 330);         // 5:30 per km, typed as the stage's time
  const typed = a.secToPace(total);
  assert.notEqual(a.parsePaceInput(typed), null, typed + ' is not a pace the box takes');
  assert.equal(a.paceIsPlausible(total), false);
  a.handleStructuredSplitChange(dd.id, row.segId, 'pace', typed);
  assert.equal(a.asked.length, 1, 'no sheet for a stage time typed as its pace');
  assert.match(a.asked[0], /Use 5:30 per km instead\?/);
  const s = dd.actual.splits.filter(x => x.segId === row.segId)[0];
  assert.equal(s.paceSec, 330);
});

// ---------------------------------------------------------------------------
// STRAVA: GPS DISTANCE LOOKS WRONG
// ---------------------------------------------------------------------------

test('a Strava run of 300 metres over 30 minutes shows the GPS note, not a 100-minute kilometre', () => {
  const a = app();
  const easy = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY);
  a.stravaWriteActivity(easy[0], { activityId: '901', km: 0.3, paceSecPerKm: 1800 / 0.3, movingTimeSec: 1800, hr: 141 });
  assert.equal(a.stravaGpsDistanceDoubt(easy[0]), true);
  assert.equal(a.actualPaceDisplayStr(easy[0]), '', 'the nonsense pace is still shown');
  assert.match(a.logTotalsNote(easy[0]), /^GPS distance looks wrong/);
  const box = a.logTotalsHtml(easy[0]);
  assert.match(box, /GPS distance looks wrong/);
  assert.doesNotMatch(box, /100:00/);
  assert.doesNotMatch(a.activityCardHtml(easy[0]), /100:00/);
  /* A good Strava run is shown as it always was. */
  a.stravaWriteActivity(easy[1], { activityId: '902', km: 6, paceSecPerKm: 330, movingTimeSec: 1980, hr: 141 });
  assert.equal(a.stravaGpsDistanceDoubt(easy[1]), false);
  assert.equal(a.actualPaceDisplayStr(easy[1]), '5:30');
  assert.doesNotMatch(a.logTotalsNote(easy[1]), /GPS/);
  /* The athlete picking the pace they ran clears it. */
  a.handleActualFieldChange(easy[0].id, 'pace', '5:40');
  assert.equal(a.stravaGpsDistanceDoubt(easy[0]), false);
  assert.equal(a.actualPaceDisplayStr(easy[0]), '5:40');
});

// ---------------------------------------------------------------------------
// 2. THE RECOVERY GRAPH: A LONG GAP IS A GAP
// ---------------------------------------------------------------------------

function recoveryAthlete(dates){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-09-28', healthConsent: true });
  a.athleteResponseModel = () => ({ families: { threshold: { recovery: {
    detail: dates.map((date, i) => ({ date, hours: [24, 48, 36, 72, 48, 30][i % 6] })) } } } });
  return a;
}
const lines = svg => [...svg.matchAll(/<polyline class="cg-line" points="([^"]*)"/g)].map(m => m[1].split(' ').length);
const areas = svg => (svg.match(/<polygon class="cg-area"/g) || []).length;
const dotCount = svg => (svg.match(/<circle class="cg-dot"/g) || []).length;

test('the Recovery line breaks where readings are more than 14 days apart', () => {
  /* 2, then 15 days, then 3, 3, then 21 days, then one alone. */
  const dates = ['2026-10-01', '2026-10-03', '2026-10-18', '2026-10-21', '2026-10-24', '2026-11-14'];
  const a = recoveryAthlete(dates);
  const svg = a.coachGraphSvg(a.coachGraphSeries('recovery'));
  assert.deepEqual(lines(svg), [2, 3], 'the line was not broken at the 15- and 21-day gaps');
  assert.equal(areas(svg), 2, 'the fill was not broken with the line');
  assert.equal(dotCount(svg), dates.length, 'a reading either side of a gap lost its dot');
  assert.doesNotMatch(svg, /stroke-dasharray|cg-gap/, 'a gap is blank, never dashed');
});

test('14 days apart or less, the Recovery line is one line', () => {
  const dates = ['2026-10-01', '2026-10-15', '2026-10-29', '2026-11-05', '2026-11-12'];
  const a = recoveryAthlete(dates);
  const svg = a.coachGraphSvg(a.coachGraphSeries('recovery'));
  assert.deepEqual(lines(svg), [dates.length]);
  assert.equal(areas(svg), 1);
});

test('a weekly graph is never broken, whatever weeks it skips', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  const s = { title: 'T', fmt: v => String(v), predicted: [],
    points: [{ x: 1, label: 'W1', v: 1 }, { x: 2, label: 'W2', v: 2 }, { x: 9, label: 'W9', v: 3 }] };
  assert.deepEqual(lines(a.coachGraphSvg(s)), [3]);
});
