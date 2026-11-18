'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THREE BUGS FROM SCREENSHOTS OF THE REAL APP (founder, 18 November 2026).

   1. "The Efficiency figure showed -8555 beats per km": a negative, and a
      magnitude no runner produces.
   2. "The threshold test offer gave a date in August for a plan that is
      finished."
   3. "The Recovery graph spaces its dates evenly": readings days apart and
      readings weeks apart were drawn the same distance apart.

   Each is reproduced with the athlete who produced it, then held. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const CSS = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, ' ');
const rule = sel => { const at = CSS.indexOf(sel + '{'); assert.ok(at !== -1, sel + ' has no rule'); return CSS.slice(at, CSS.indexOf('}', at)); };

const TODAY = '2026-11-18';
function app(today){
  const a = loadApp({ pinnedDate: (today || TODAY) + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  return a;
}
const pts = s => Array.from(s.points);

// ---------------------------------------------------------------------------
// 1. AEROBIC EFFICIENCY: NEVER A NUMBER NO RUNNER PRODUCES
// ---------------------------------------------------------------------------

/* A half-marathon athlete seven weeks into a twelve-week block, every easy
   run at 5:00/km and 149 bpm -- except week one, where the run's total time
   (62 minutes) went into the pace box. "62:00" is a pace the box accepts, and
   it reads as 62 minutes a kilometre: 150 x 62 = 9300 beats per km against a
   real 745, which is the founder's "-8555" to the beat. */
function easyAthlete(logWeekOne){
  const a = app();
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-05', healthConsent: true });
  const past = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY);
  past.forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  past.filter(d => d.type === 'easy').forEach(d => {
    d.actual.pace = '5:00'; d.actual.paceUnit = 'km'; d.actual.hr = 149;
    if (d.week === 1) logWeekOne(d);
    delete d.coachReview; a.coachPersistReview(d);
  });
  return a;
}
const PLAUSIBLE = a => [a.ASSESS_CAL.plausibleHR[0] * a.ASSESS_CAL.plausiblePaceSec[0] / 60,
                        a.ASSESS_CAL.plausibleHR[1] * a.ASSESS_CAL.plausiblePaceSec[1] / 60];

test('the founder\'s -8555: a run time typed into the pace box is not read as a pace', () => {
  const a = easyAthlete(d => { d.actual.pace = '62:00'; d.actual.hr = 150; });
  const s = a.coachGraphSeries('efficiency');
  assert.notEqual(s.figure, '−8555 beats', 'the founder\'s figure is back');
  assert.doesNotMatch(s.figure, /\d{4}/, 'a four-figure change in beats per km: ' + s.figure);
  const [lo, hi] = PLAUSIBLE(a);
  pts(s).forEach(p => assert.ok(p.v >= lo && p.v <= hi, 'W' + p.x + ' is plotted at ' + Math.round(p.v) + ' beats per km'));
  assert.ok(pts(s).every(p => p.x !== 1), 'week one, whose only pace is a run time, is plotted');
  /* The rest of the block is read as it was: 149 bpm at 5:00/km, level. */
  assert.equal(s.ready, true);
  assert.equal(s.figure, 'Level');
  assert.equal(s.good, false, 'an impossible first week made the line look like an improvement');
  /* Nor is it learned from anywhere else: the trends read the same records. */
  const trends = Array.from(a.athleteTrends()).map(t => t.id);
  assert.ok(trends.indexOf('easy_efficiency_up') === -1, 'the 62:00 run reads as a fall in easy-running cost');
});

test('a heart rate of 0 is a missing heart rate, not a run that cost nothing', () => {
  const a = easyAthlete(d => { d.actual.hr = 0; });
  const s = a.coachGraphSeries('efficiency');
  const [lo] = PLAUSIBLE(a);
  pts(s).forEach(p => assert.ok(p.v >= lo, 'a run is plotted at ' + Math.round(p.v) + ' beats per km'));
  assert.doesNotMatch(s.figure, /\d{3}/, 'a zero heart rate moved the figure: ' + s.figure);
  assert.equal(a.hrIsReadable({ hr: 0 }), false);
  assert.equal(a.hrIsReadable({ hr: 400 }), false);
  assert.equal(a.hrIsReadable({ hr: 149 }), true);
});

test('a Strava activity with a few metres of GPS against a full moving time is not a pace', () => {
  const a = app();
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-27', healthConsent: true });
  const easy = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY);
  assert.ok(easy.length >= 2, 'the fixture has too few easy runs');
  /* The first: a real 5:20/km run. The second: 300 metres over 30 minutes,
     which api/_strava.js turns into 6000 seconds a kilometre. */
  logAsPrescribed(a, easy[0], { quality: 1 });
  easy[0].actual.pace = '5:20'; easy[0].actual.hr = 146;
  delete easy[0].coachReview; a.coachPersistReview(easy[0]);
  a.stravaWriteActivity(easy[1], { activityId: '901', km: 0.3, paceSecPerKm: 1800 / 0.3, hr: 141 });
  delete easy[1].coachReview; try { a.coachPersistReview(easy[1]); } catch (e) {}
  assert.ok(a.actualPaceSecPerKm(easy[1]) > 5000, 'the fixture did not store the Strava blip');
  const s = a.coachGraphSeries('efficiency');
  assert.equal(pts(s).length, 1, 'the blip is plotted');
  assert.equal(s.figure, Math.round(146 * 320 / 60) + ' beats');
  assert.equal(a.coachGraphSeries('paceAtHR').points.length, 1, 'Pace at HR plots a 100-minute kilometre');
});

test('when every run is impossible the graph says so, and shows no number', () => {
  const a = app();
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-11-02', healthConsent: true });
  const easy = a.state.days.filter(d => d.type === 'easy' && d.date < TODAY);
  easy.forEach(d => { logAsPrescribed(a, d, { quality: 1 }); d.actual.pace = '58:30'; d.actual.hr = 151;
    delete d.coachReview; a.coachPersistReview(d); });
  const s = a.coachGraphSeries('efficiency');
  assert.equal(s.ready, false); assert.equal(s.early, false);
  assert.equal(pts(s).length, 0);
  assert.equal(s.figure, '');
  assert.match(s.hello, /a pace or heart rate no runner produces, so (it is|they are) left out here\. Check the pace and heart rate in Your Log\.$/);
  a.coachGraphSel = 'efficiency';
  const card = a.renderCoachGraph();
  assert.doesNotMatch(card, /cg-fig|beats/, 'a figure is drawn from runs that cannot be read');
  assert.doesNotMatch(s.hello, /—/, 'an em dash in the copy');
});

test('heartbeats per km is a number a runner can produce, or nothing', () => {
  const a = app();
  assert.equal(a.coachGraphBeatsPerKm(150, 300), 750);
  assert.equal(a.coachGraphBeatsPerKm(150, 62 * 60), null, 'a 62-minute kilometre');
  assert.equal(a.coachGraphBeatsPerKm(0, 300), null, 'no heart rate');
  assert.equal(a.coachGraphBeatsPerKm(null, 300), null);
  assert.equal(a.coachGraphBeatsPerKm(150, -300), null, 'a negative pace');
  assert.equal(a.coachGraphBeatsPerKm(150, NaN), null);
  assert.equal(a.coachGraphBeatsPerKm(150, Infinity), null, 'a pace over no distance');
  assert.equal(a.paceIsReadable({ actualPace: 3720 }), false);
  assert.equal(a.paceIsReadable({ actualPace: 300 }), true);
});

// ---------------------------------------------------------------------------
// 2. THE THRESHOLD TEST OFFER: NEVER FOR A FINISHED PLAN, NEVER OUTSIDE IT
// ---------------------------------------------------------------------------

/* As the offer finds a plan built before the test was for everyone: no
   threshold test anywhere in it. */
function noTestPlan(a, o){
  buildPlan(a, Object.assign({ distanceKey: 'full', volume: 45, weeks: 16, healthConsent: true }, o));
  a.state.days.filter(d => d.type === 'calibration').forEach(d => { d.type = 'easy'; d.title = 'Easy Run'; delete d.prescription; });
}

test('the founder\'s August: a plan whose race day has passed is offered no test', () => {
  /* Sixteen weeks from 4 May, race day 23 August, run faithfully into
     August and then left: the earliest un-run hard session is in August. */
  const a = app();
  noTestPlan(a, { startDate: '2026-05-04' });
  a.state.days.filter(d => d.date < '2026-08-03').forEach(d => { d.completed = d.type !== 'rest'; });
  assert.ok(a.state.setup.raceDate < TODAY, 'the fixture\'s race is not behind today');
  assert.equal(a.thresholdTestOfferDay(), null, 'a finished plan was offered a test');
});

test('a plan whose last week has ended is offered no test, race day or not', () => {
  const a = app();
  noTestPlan(a, { startDate: '2026-06-01' });
  /* A goal block with no race day recorded: only the weeks say it is over. */
  a.state.setup.raceDate = null;
  assert.equal(a.currentWeekNum(), null, 'the fixture is not past its last week');
  assert.equal(a.thresholdTestOfferDay(), null, 'a plan past its last week was offered a test');
});

test('a closed block is offered no test', () => {
  const a = app();
  noTestPlan(a, { startDate: '2026-11-02' });
  assert.ok(a.thresholdTestOfferDay(), 'the fixture is offered nothing while open');
  const b = a.openBlock({ purpose: 'race', startDate: '2026-11-02' });
  a.state.setup.blockId = b.id;
  a.closeBlock(b.id, 'abandoned');
  assert.equal(a.thresholdTestOfferDay(), null, 'a closed block was offered a test');
});

test('on every day of a block, an offer is for a day ahead and inside the plan', () => {
  const start = '2026-08-03';
  const probe = app();
  noTestPlan(probe, { startDate: start });
  const race = probe.state.setup.raceDate;
  const total = probe.totalWeeksInPlan();
  let offered = 0;
  for (let day = probe.addDays(start, -3); day <= probe.addDays(race, 14); day = probe.addDays(day, 3)){
    const a = app(day);
    noTestPlan(a, { startDate: start });
    const dd = a.thresholdTestOfferDay();
    if (!dd) continue;
    offered++;
    assert.ok(dd.date > day, day + ': offered ' + dd.date + ', which is not ahead');
    assert.ok(dd.date < race, day + ': offered ' + dd.date + ', on or after race day ' + race);
    assert.ok(dd.week >= 1 && dd.week <= total, day + ': offered week ' + dd.week + ' of ' + total);
    assert.ok(race >= day, day + ': offered a test after race day');
  }
  assert.ok(offered > 0, 'the fixture is never offered a test');
});

// ---------------------------------------------------------------------------
// 3. THE RECOVERY GRAPH: A DATE IS PLACED AT ITS DATE
// ---------------------------------------------------------------------------

/* An athlete whose check-ins after hard sessions came in bursts: two days
   apart, then three weeks of nothing, then one day apart, then three weeks. */
const UNEVEN = ['2026-10-01', '2026-10-03', '2026-10-24', '2026-10-25', '2026-11-15'];
function recoveryAthlete(dates){
  const a = app();
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, startDate: '2026-09-28', healthConsent: true });
  a.athleteResponseModel = () => ({ families: { threshold: { recovery: {
    detail: dates.map((date, i) => ({ date, hours: [24, 48, 24, 72, 48][i % 5] })) } } } });
  return a;
}
/* The label's width in the drawing's units, worked out here rather than
   asked of the app: the mono face's 0.6em a character, at the size the
   stylesheet draws it. */
const labelSize = () => {
  const r = rule('.cg-ylab, .cg-xlab');
  const px = /font-size:([\d.]+)px/.exec(r), rem = /font-size:([\d.]+)rem/.exec(r);
  return px ? +px[1] : rem ? +rem[1] * 16 : NaN;
};
const labelWidth = l => l.label.length * 0.6 * labelSize();
const dots = svg => [...svg.matchAll(/<circle class="cg-dot" cx="([\d.]+)"/g)].map(m => +m[1]);
const xlabels = svg => [...svg.matchAll(/<text class="cg-xlab" x="([\d.-]+)"[^>]*>([^<]*)<\/text>/g)].map(m => ({ x: +m[1], label: m[2] }));

test('the Recovery graph places each reading at its date, so a gap in check-ins is a gap', () => {
  const a = recoveryAthlete(UNEVEN);
  const s = a.coachGraphSeries('recovery');
  assert.equal(s.ready, true);
  const days = UNEVEN.map(d => a.daysBetween(UNEVEN[0], d));
  assert.deepEqual(pts(s).map(p => p.x), days, 'x is not the day of the reading');
  const cx = dots(a.coachGraphSvg(s));
  assert.equal(cx.length, UNEVEN.length);
  const span = cx[cx.length - 1] - cx[0];
  cx.forEach((x, i) => assert.ok(Math.abs((x - cx[0]) / span - days[i] / days[days.length - 1]) < 0.002,
    UNEVEN[i] + ' is drawn at ' + x + ', not at its date'));
  /* Two days apart is drawn closer than three weeks apart. */
  assert.ok(cx[1] - cx[0] < (cx[2] - cx[1]) / 5, 'a three-week gap is drawn like a two-day one');
});

test('the dates under the Recovery graph never touch, stay on the page and are never under 11px', () => {
  const a = recoveryAthlete(UNEVEN);
  const s = a.coachGraphSeries('recovery');
  const labels = xlabels(a.coachGraphSvg(s));
  const W = a.COACH_GRAPH_BOX.W;
  const width = labelWidth;
  assert.ok(labels.length >= 2);
  labels.slice(1).forEach((l, i) => {
    const prev = labels[i];
    assert.ok(l.x - prev.x >= (width(prev) + width(l)) / 2, prev.label + ' and ' + l.label + ' overlap');
  });
  labels.forEach(l => assert.ok(l.x - width(l) / 2 >= 0 && l.x + width(l) / 2 <= W, l.label + ' runs off the page'));
  assert.equal(labels[labels.length - 1].label, a.dShort(UNEVEN[UNEVEN.length - 1]), 'the latest reading lost its date');
  /* The two readings a day apart cannot both be named. */
  assert.ok(!(labels.some(l => l.label === a.dShort('2026-10-24')) && labels.some(l => l.label === a.dShort('2026-10-25'))),
    'two dates a day apart are both drawn');
  /* 11px where the drawing is narrowest: 288px of a 320px phone, for 340 units. */
  const size = labelSize();
  assert.ok(size * 288 / W >= 11, 'the dates are ' + (size * 288 / W).toFixed(1) + 'px on a 320px phone');
  assert.equal(size, a.COACH_GRAPH_LABEL_SIZE, 'the labels are spaced for one size and drawn at another');
  assert.match(rule('.cg-ylab, .cg-xlab'), /font-size:[\d.]+rem/, 'the dates no longer follow iOS text size');
});

test('twelve readings, a fortnight of daily check-ins and then a gap: every one drawn at its date, no dates touching', () => {
  const probe = app();
  const dates = []; for (let i = 0; i < 11; i++) dates.push(probe.addDays('2026-10-20', i));
  dates.push(probe.addDays('2026-10-20', 30));
  const a = recoveryAthlete(dates);
  const s = a.coachGraphSeries('recovery');
  const svg = a.coachGraphSvg(s);
  const cx = dots(svg);
  assert.equal(cx.length, 12, 'a reading was dropped to make room');
  const span = cx[11] - cx[0];
  assert.ok(Math.abs((cx[10] - cx[0]) / span - 10 / 30) < 0.002, 'the nineteen-day gap is drawn as one day');
  const labels = xlabels(svg);
  labels.slice(1).forEach((l, i) => assert.ok(l.x - labels[i].x >= (labelWidth(labels[i]) + labelWidth(l)) / 2,
    labels[i].label + ' and ' + l.label + ' overlap'));
  assert.equal(labels[labels.length - 1].label, a.dShort(dates[11]), 'the latest reading lost its date');
});

test('early readings labelled with dates are placed at their dates too', () => {
  const a = app();
  const p = Array.from(a.coachGraphEarlyPoints([{ date: '2026-11-01', v: 1 }, { date: '2026-11-02', v: 2 }, { date: '2026-11-12', v: 3 }]));
  assert.deepEqual(p.map(x => x.x), [0, 1, 11]);
});
