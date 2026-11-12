'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE COACH DASHBOARD.

   Founder: "Update SACORO's Coach dashboard to match the approved design:
   horizontal coaching-circle rail, compact Confidence hero and Aerobic
   Development graph. Include five selectable graphs: Aerobic Efficiency,
   Pace at HR, Cardiac Drift, Threshold Development and Recovery Response.
   Use real athlete evidence only. Show elegant 'Learning' states where data
   is insufficient. Solid cherry for measured trends, dotted gold for
   defensible predictions. Preserve existing coaching logic, SACORO styling
   and one-thumb usability."

   And: "Rail 3 circles wrapped visually. Gold dots underneath. Graph - use
   the metrics we have and know." */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const CSS = SRC.slice(SRC.indexOf('<style>'), SRC.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, ' ');
const TODAY = '2026-12-04';

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-06' });
  return a;
}
const past = a => a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY);
const paceSec = p => { const m = String(p).split(':'); return (+m[0]) * 60 + (+m[1]); };
/* A block with real evidence in every graph. */
function evidenced(){
  const a = athlete();
  past(a).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  past(a).forEach(d => {
    const w = d.week;
    if (d.type === 'easy'){
      d.actual.pace = a.secToClock(paceSec(d.actual.pace) - (w - 1) * 4);
      d.actual.hr = 150 + ((w * 7) % 3) - 1;
    }
    if (d.type === 'long'){
      const drift = 0.07 - 0.006 * w, n = 8;
      d.actual.hr = 152; d.actual.splits = [];
      for (let i = 0; i < n; i++)
        d.actual.splits.push({ km: d.km / n, sec: Math.round(d.km / n * 340), hr: Math.round(148 * (i < n / 2 ? 1 : 1 + drift)) });
    }
  });
  past(a).filter(d => ['tempo', 'interval', 'long', 'threshold'].indexOf(d.type) !== -1).forEach((d, i) => {
    const n1 = a.findDayByDate(a.addDays(d.date, 1)), n2 = a.findDayByDate(a.addDays(d.date, 2));
    if (i % 3 === 1){
      if (n1) n1.readiness = { legs: 'heavy', sleep: 'good', health: 'good' };
      if (n2) n2.readiness = { legs: 'fresh', sleep: 'good', health: 'good' };
    } else if (n1) n1.readiness = { legs: 'fresh', sleep: 'good', health: 'good' };
  });
  const perf = (date, km, timeSec) => ({ date, km, timeSec, source: 'checkpoint', qualified: true,
    vdot: a.vdotFromPerformance(km * 1000, timeSec) });
  a.athlete().performances = [perf('2026-10-11', 5, 23 * 60 + 40), perf(a.addDays(TODAY, -8), 5, 22 * 60 + 55)];
  return a;
}
const series = (a, k) => a.coachGraphSeries(k);
const pts = s => Array.from(s.points);
const median = list => { const s = list.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const rule = sel => { const at = CSS.indexOf(sel + '{'); assert.ok(at !== -1, sel + ' has no rule'); return CSS.slice(at, CSS.indexOf('}', at)); };
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };

// ---------------------------------------------------------------------------
// THE PAGE
// ---------------------------------------------------------------------------

test('the page reads hero, circle rail, graph, plates', () => {
  const a = evidenced();
  const html = a.renderPlanHQView();
  const at = s => { const i = html.indexOf(s); assert.ok(i !== -1, s + ' is not on the page'); return i; };
  assert.ok(at('class="v-hero"') < at('class="b-rail"'));
  assert.ok(at('class="b-rail"') < at('class="b-rail-dots"'), 'the dots are not under the rail');
  assert.ok(at('class="b-rail-dots"') < at('class="cg-card"'));
  assert.ok(at('class="cg-card"') < at('class="b-plates"'), 'the graph is not above the plates');
  assert.equal((html.match(/class="cg-card"/g) || []).length, 1);
});

test('the Confidence hero is compact, and still the largest ring', () => {
  const big = /\.view-planhq\{--ring-dia:(\d+)px/.exec(CSS);
  const hero = /\.view-planhq \.v-hero-gauge\{--ring-dia:(\d+)px;\}/.exec(CSS);
  assert.ok(big && hero, 'the hero gauge has no size of its own');
  assert.ok(+hero[1] <= 124 && +hero[1] >= 108, 'the gauge is ' + hero[1] + 'px');
  assert.ok(+hero[1] < +big[1], 'the hero is not smaller than it was');
  /* A third of a 342px row is 107px: the gauge still leads. */
  assert.ok(+hero[1] > 107, 'the gauge is no bigger than the circles under it');
  const a = evidenced();
  assert.match(a.renderProgrammeStatus(), /class="gauge-wrap" data-action="open-reading" data-reading="readiness"/,
    'the gauge stopped being the door to the confidence reading');
});

test('the circles are a rail: three show, gold dots count the positions, a swipe is the rail\'s', () => {
  const a = evidenced();
  const html = a.renderSacoroInstruments();
  assert.match(html, /<div class="b-rail" data-hswipe="1"><div class="b-grid">/);
  const keys = [...html.matchAll(/data-action="open-reading" data-reading="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(keys, ['recovery', 'evolution', 'adaptation', 'patterns']);
  assert.equal((html.match(/class="b-rail-dot[ "]/g) || []).length, 2, 'four circles, three showing, is two positions');
  assert.equal((html.match(/class="b-rail-dot is-on"/g) || []).length, 1);
  assert.equal(a.coachRailDots(3, 3), '', 'dots under a rail with nowhere to go');
  assert.equal((a.coachRailDots(5, 3).match(/b-rail-dot[ "]/g) || []).length, 3);
  assert.match(rule('.b-rail > .b-grid .b-dial-col'), /flex:0 0 calc\(\(100% - 20px\) \/ 3\)/, 'not three to a row');
  assert.match(rule('.b-rail > .b-grid .b-dial-col'), /scroll-snap-align:start/);
  assert.match(rule('.b-rail'), /overflow-x:auto;[^}]*scroll-snap-type:x mandatory/);
  assert.match(rule('.b-rail-dot'), /background:var\(--gold\)/, 'the dots are not gold');
  assert.ok(!/Tap any circle/.test(html));
});

test('the dots follow the rail', () => {
  const a = athlete();
  assert.equal(a.coachRailPage(0, 489, 374, 2), 0);
  assert.equal(a.coachRailPage(115, 489, 374, 2), 1);
  assert.equal(a.coachRailPage(40, 489, 374, 2), 0);
  assert.equal(a.coachRailPage(60, 600, 300, 3), 0);
  assert.equal(a.coachRailPage(150, 600, 300, 3), 1);
  assert.equal(a.coachRailPage(300, 600, 300, 3), 2);
  assert.equal(a.coachRailPage(999, 600, 300, 3), 2);
  assert.equal(a.coachRailPage(10, 300, 300, 2), 0, 'a rail with no room was given a position');
  const dot = () => { const d = { on: false }; d.classList = { toggle: (c, v) => { d.on = v; } }; return d; };
  const dots = [dot(), dot()];
  const railEl = left => ({ classList: { contains: c => c === 'b-rail' }, scrollLeft: left, scrollWidth: 489, clientWidth: 374,
    parentNode: { querySelectorAll: () => dots } });
  a.coachRailScrolled({ target: railEl(115) });
  assert.deepEqual(dots.map(d => d.on), [false, true]);
  a.coachRailScrolled({ target: railEl(0) });
  assert.deepEqual(dots.map(d => d.on), [true, false]);
  /* Any other scroller on the page is none of its business. */
  a.coachRailScrolled({ target: { classList: { contains: () => false }, scrollLeft: 115, scrollWidth: 489, clientWidth: 374,
    parentNode: { querySelectorAll: () => { throw new Error('read a scroller that is not the rail'); } } } });
  a.coachRailScrolled({});
  assert.match(SRC, /addEventListener\('scroll', coachRailScrolled, true\)/, 'scroll does not bubble: the listener must capture');
});

// ---------------------------------------------------------------------------
// FIVE GRAPHS, AND THE WORD FOR NOT YET
// ---------------------------------------------------------------------------

test('there are five graphs, in the founder\'s order, each with the founder\'s word for not yet', () => {
  const a = athlete();
  assert.deepEqual(Array.from(a.COACH_GRAPHS), ['efficiency', 'paceAtHR', 'drift', 'threshold', 'recovery']);
  const want = {
    efficiency: ['Aerobic Efficiency', 'Learning'],
    paceAtHR: ['Pace at HR', 'Learning'],
    drift: ['Cardiac Drift', 'Learning'],
    threshold: ['Threshold Development', 'Awaiting reliable evidence'],
    recovery: ['Recovery Response', 'Building your baseline'],
  };
  Object.keys(want).forEach(k => {
    const s = series(a, k);
    assert.equal(s.title, want[k][0]);
    assert.equal(s.waiting, want[k][1]);
    assert.equal(s.ready, false, k + ' drew a graph from an empty log');
    assert.equal(pts(s).length, 0);
    assert.equal(Array.from(s.predicted).length, 0, k + ' predicted from nothing');
    a.coachGraphSel = k;
    const card = a.renderCoachGraph();
    assert.match(card, new RegExp('<div class="cg-wait-w">' + want[k][1] + '</div>'));
    assert.match(card, /None yet\./);
    assert.ok(card.indexOf(s.need) !== -1, k + ' does not say what it is waiting for');
    assert.ok(!/<svg|cg-fig|cg-legend/.test(card), k + ' drew a chart of nothing');
  });
  /* The design's own heading sits over the three aerobic graphs. */
  ['efficiency', 'paceAtHR', 'drift'].forEach(k => assert.equal(series(a, k).group, 'Aerobic Development'));
});

test('logging without heart rate leaves the aerobic graphs learning, and says how far along each is', () => {
  const a = athlete();
  past(a).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  ['efficiency', 'paceAtHR', 'drift'].forEach(k => assert.equal(series(a, k).ready, false, k + ' was drawn without heart rate'));
  /* Two weeks of evidence is still not three. */
  const easy = past(a).filter(d => d.type === 'easy');
  [1, 2].forEach(w => easy.filter(d => d.week === w).forEach(d => { d.actual.hr = 150; }));
  const s = series(a, 'efficiency');
  assert.equal(s.have, 2); assert.equal(s.want, 3); assert.equal(s.ready, false);
  a.coachGraphSel = 'efficiency';
  assert.match(a.renderCoachGraph(), /2 of 3 so far\./);
  easy.filter(d => d.week === 3).forEach(d => { d.actual.hr = 150; });
  assert.equal(series(a, 'efficiency').ready, true);
});

test('all five can be chosen with a thumb, and choosing one redraws the card', () => {
  const a = evidenced();
  a.coachGraphSel = 'efficiency';
  const card = a.renderCoachGraph();
  const tabs = [...card.matchAll(/<button type="button" role="tab" class="cg-tab( is-on)?" aria-selected="(true|false)" data-action="coach-graph" data-graph="([A-Za-z]+)">([^<]+)<\/button>/g)];
  assert.deepEqual(tabs.map(m => m[3]), Array.from(a.COACH_GRAPHS));
  assert.deepEqual(tabs.map(m => m[4]), ['Efficiency', 'Pace at HR', 'Drift', 'Threshold', 'Recovery']);
  assert.deepEqual(tabs.filter(m => m[2] === 'true').map(m => m[3]), ['efficiency']);
  assert.match(rule('.cg-tab'), /min-height:44px/, 'a tab is not a 44px target');
  /* All five are on the screen: three and two, not a row with one off its edge. */
  assert.match(rule('.cg-tabs'), /display:grid; grid-template-columns:repeat\(3, auto\)/);
  assert.ok(!/overflow-x/.test(rule('.cg-tabs')), 'a graph is hidden behind a sideways scroll');
  assert.match(rule('.cg-tab.is-on'), /color:var\(--cherry-text\)/, 'the chosen tab is not cherry');
  assert.match(SRC, /case 'coach-graph': handleCoachGraph\(target\.getAttribute\('data-graph'\)\); break;/);

  let drawn = 0; a.renderApp = () => { drawn++; };
  a.handleCoachGraph('threshold');
  assert.equal(a.coachGraphSel, 'threshold'); assert.equal(drawn, 1);
  assert.match(a.renderCoachGraph(), /<div class="cg-title">Threshold Development<\/div>/);
  a.handleCoachGraph('threshold');
  assert.equal(drawn, 1, 'choosing the graph already showing redrew the page');
  a.handleCoachGraph('vo2max');
  assert.equal(a.coachGraphSel, 'threshold', 'a graph that does not exist was selected');
  a.coachGraphSel = 'nonsense';
  assert.match(a.renderCoachGraph(), /class="cg-tab is-on"[^>]*data-graph="efficiency"/, 'a bad selection drew nothing');
});

// ---------------------------------------------------------------------------
// REAL EVIDENCE ONLY
// ---------------------------------------------------------------------------

test('Aerobic Efficiency is the engine\'s heartbeats per km, week by week, from the runs themselves', () => {
  const a = evidenced();
  const s = series(a, 'efficiency');
  assert.equal(s.ready, true);
  const byWeek = {};
  past(a).filter(d => d.type === 'easy').forEach(d => {
    (byWeek[d.week] = byWeek[d.week] || []).push(d.actual.hr * paceSec(d.actual.pace) / 60); });
  const weeks = Object.keys(byWeek).map(Number).sort((x, y) => x - y);
  assert.deepEqual(pts(s).map(p => p.x), weeks, 'a week was added or lost');
  pts(s).forEach(p => {
    /* The engine's own median(), which keeps one decimal. */
    assert.ok(Math.abs(p.v - median(byWeek[p.x])) < 0.06, 'W' + p.x + ' is not the median of that week\'s runs');
    assert.equal(p.label, 'W' + p.x);
  });
  /* The same quantity athleteTrends() reads. */
  assert.match(SRC, /var cost = function\(r\)\{ return r\.hr \* \(r\.actualPace\/60\); \};/);
  const first = pts(s)[0], last = pts(s).slice(-1)[0], d = Math.round(Math.abs(last.v - first.v));
  assert.equal(s.figure, (last.v < first.v ? '−' : '+') + d + ' beats');
  assert.equal(s.good, last.v < first.v);
  assert.match(s.caption, last.v < first.v ? /fewer heartbeats per km than in week 1\./ : /more heartbeats per km/);
});

test('nothing is invented: a week with no readable run has no point', () => {
  const a = evidenced();
  const before = pts(series(a, 'efficiency')).map(p => p.x);
  assert.ok(before.indexOf(3) !== -1);
  past(a).filter(d => d.type === 'easy' && d.week === 3).forEach(d => { d.actual.hr = null; });
  const after = pts(series(a, 'efficiency')).map(p => p.x);
  assert.deepEqual(after, before.filter(w => w !== 3), 'week 3 was filled in');
  /* A run in real heat is not a reading of fitness. */
  const b = evidenced();
  past(b).filter(d => d.type === 'easy' && d.week === 4).forEach(d => {
    d.actual.notes = 'It was really hot out there.'; delete d.coachReview; b.coachPersistReview(d); });
  assert.ok(pts(series(b, 'efficiency')).map(p => p.x).indexOf(4) === -1, 'a hot week was plotted as efficiency');
  /* Quality sessions are not easy running. */
  const c = evidenced();
  past(c).filter(d => d.type === 'tempo' || d.type === 'interval').forEach(d => { d.actual.hr = 100; });
  assert.deepEqual(pts(series(c, 'efficiency')).map(p => Math.round(p.v)), pts(series(evidenced(), 'efficiency')).map(p => Math.round(p.v)));
});

test('without health consent no heart-rate graph is drawn', () => {
  const a = evidenced();
  a.healthConsentGranted = () => false;
  ['efficiency', 'paceAtHR', 'drift'].forEach(k => {
    const s = series(a, k);
    assert.equal(s.ready, false, k + ' read heart rate without consent');
    assert.equal(pts(s).length, 0);
  });
  /* Threshold comes from race results, which are not health data. */
  assert.equal(series(a, 'threshold').ready, true);
});

test('Pace at HR compares like with like: only runs near the athlete\'s usual easy heart rate', () => {
  const a = evidenced();
  const s = series(a, 'paceAtHR');
  assert.equal(s.ready, true);
  assert.match(s.figureText, /^per km at around 150 bpm$/);
  const base = pts(s).map(p => p.x + ':' + Math.round(p.v));
  /* A run at a very different heart rate is a different effort, and is left out. */
  const odd = past(a).filter(d => d.type === 'easy' && d.week === 5)[0];
  odd.actual.hr = 172; odd.actual.pace = '3:30';
  const again = pts(series(a, 'paceAtHR'));
  assert.ok(again.every(p => p.v > 280), 'a hard effort was plotted as easy pace');
  assert.equal(a.COACH_GRAPH_CAL.sameHRBand, 5);
  assert.ok(base.length >= 3);
  assert.equal(s.fmt(325), '5:25');
});

test('Cardiac Drift is coachHRDrift, from lap data, on steady runs only', () => {
  const a = evidenced();
  const s = series(a, 'drift');
  assert.equal(s.ready, true);
  pts(s).forEach(p => {
    const want = median(past(a).filter(d => d.type === 'long' && d.week === p.x).map(d => a.coachHRDrift(d)));
    assert.ok(Math.abs(p.v - want) < 0.06, 'W' + p.x + ' is not that week\'s measured drift');
  });
  /* A session of reps drifts by design and is not read. */
  const rep = past(a).filter(d => d.type === 'interval')[0];
  rep.actual.hr = 160; rep.actual.splits = [1, 2, 3, 4, 5, 6].map(i => ({ km: 1, sec: 300, hr: 140 + i * 8 }));
  assert.deepEqual(pts(series(a, 'drift')).map(p => p.v), pts(s).map(p => p.v), 'an interval session was read as drift');
  /* No laps, no drift. */
  const b = evidenced();
  past(b).forEach(d => { if (d.actual) delete d.actual.splits; });
  assert.equal(series(b, 'drift').ready, false);
});

test('Threshold Development moves only with measured efforts', () => {
  const a = evidenced();
  const s = series(a, 'threshold');
  const perfs = Array.from(a.measuredPerformances());
  assert.equal(pts(s).length, perfs.length);
  assert.ok(pts(s).length >= 2);
  const t = a.trainingPacesFromVDOT(perfs[0].vdot).T;
  assert.ok(Math.abs(pts(s)[0].v - (t.slow + t.fast) / 2) < 1e-6, 'the point is not the threshold pace that effort implies');
  assert.match(s.caption, /measured efforts\. Training runs do not move it\./);
  /* Faster training changes nothing here. */
  past(a).filter(d => d.type === 'tempo').forEach(d => { d.actual.pace = '3:40'; });
  assert.deepEqual(pts(series(a, 'threshold')).map(p => p.v), pts(s).map(p => p.v), 'a training run moved threshold');
  /* One measurement is a fact, not a development. */
  const b = evidenced();
  b.athlete().performances = b.athlete().performances.slice(0, 1);
  b.state.days.forEach(d => { if (d.type === 'checkpoint'){ d.completed = false; d.actual = null; } });
  const one = series(b, 'threshold');
  if (Array.from(b.measuredPerformances()).length === 1){
    assert.equal(one.ready, false);
    b.coachGraphSel = 'threshold';
    assert.match(b.renderCoachGraph(), /Awaiting reliable evidence[\s\S]*1 of 2 so far\./);
  }
  /* An effort the athlete marked as not maximal is not a measurement. */
  const c = evidenced();
  const n = pts(series(c, 'threshold')).length;
  c.disqualifyMeasuredPerformance(c.athlete().performances[0].date, 'not_maximal');
  assert.equal(pts(series(c, 'threshold')).length, n - 1);
});

test('Recovery Response is the response model\'s own windows, the latest twelve', () => {
  const a = evidenced();
  const s = series(a, 'recovery');
  assert.equal(s.ready, true);
  const model = a.athleteResponseModel(), seen = {};
  Array.from(a.DEMANDING_FAMILIES).forEach(f => Array.from(model.families[f].recovery.detail).forEach(w => {
    if (w.hours != null || w.beyond72) seen[w.date] = w; }));
  const all = Object.keys(seen).sort();
  assert.ok(all.length > 12, 'the fixture has too few windows to test the cap');
  assert.equal(pts(s).length, 12);
  assert.deepEqual(pts(s).map(p => p.label), all.slice(-12).map(d => a.dShort(d)), 'not the most recent twelve');
  pts(s).forEach((p, i) => {
    const w = seen[all.slice(-12)[i]];
    assert.equal(p.v, w.hours != null ? w.hours : 96, 'a window was plotted at a time it did not take');
  });
  assert.deepEqual(Array.from(s.ticks), [24, 48, 72, 96]);
  assert.equal(s.fmt(96), '72h+'); assert.equal(s.fmt(48), '48h');
  assert.equal(Array.from(s.predicted).length, 0, 'recovery was predicted');
  assert.match(s.figure, /^About \d+ hours$/);
  /* Fewer than three is a baseline still being built. */
  const b = athlete();
  past(b).forEach(d => logAsPrescribed(b, d, { quality: 1 }));
  assert.equal(series(b, 'recovery').ready, false);
});

// ---------------------------------------------------------------------------
// PREDICTIONS
// ---------------------------------------------------------------------------

test('a line is carried forward only when it is improving, consistent, and four points long', () => {
  const a = athlete();
  const weekly = vs => vs.map((v, i) => ({ x: i + 1, label: 'W' + (i + 1), v }));
  const project = (vs, lower) => Array.from(a.coachGraphProject(weekly(vs), lower !== false));
  assert.equal(project([840, 830, 820]).length, 0, 'three points were projected');
  const p = project([840, 830, 820, 810]);
  assert.equal(p.length, 3);
  assert.deepEqual(p.map(x => x.x), [5, 6, 7]);
  /* It keeps going the same way, and slows: each step is smaller than the last. */
  const steps = [810 - p[0].v, p[0].v - p[1].v, p[1].v - p[2].v];
  assert.ok(steps.every(s => s > 0), 'the projection changed direction');
  assert.ok(steps[0] > steps[1] && steps[1] > steps[2], 'the projection does not slow');
  assert.ok(steps[0] < 10, 'the projection runs at the full measured rate');
  /* A decline is never projected. */
  assert.equal(project([810, 820, 830, 840]).length, 0, 'a worsening trend was projected forward');
  assert.equal(project([810, 820, 830, 840], false).length, 3, 'a rising measure that is better higher was refused');
  /* Nor is noise. */
  assert.equal(project([840, 800, 845, 805, 838]).length, 0, 'a scatter was given a trend line');
  /* And it stops at the end of the block. */
  const lastWeek = a.coachGraphPlanWeeks();
  const late = Array.from(a.coachGraphProject([lastWeek - 4, lastWeek - 3, lastWeek - 2, lastWeek - 1]
    .map((w, i) => ({ x: w, label: 'W' + w, v: 840 - i * 10 })), true));
  assert.deepEqual(late.map(x => x.x), [lastWeek], 'a prediction was drawn past goal day');
  assert.match(fnBody('coachGraphProject'), /if \(!improving \|\| fit\.r2 < cal\.predictFit\) return \[\];/);
});

test('the threshold prediction is the Race Goal methodology\'s own, or there is none', () => {
  const a = evidenced();
  const s = series(a, 'threshold');
  const end = a.state.days.reduce((m, d) => d.date > m ? d.date : m, TODAY);
  const proj = a.raceGoalProjectedVdot(a.daysBetween(TODAY, end));
  const pred = Array.from(s.predicted);
  if (proj && !proj.flat){
    assert.equal(pred.length, 1);
    const t = a.trainingPacesFromVDOT(proj.vdot).T;
    assert.ok(Math.abs(pred[0].v - (t.slow + t.fast) / 2) < 1e-6, 'the prediction is not the engine\'s projection');
    assert.equal(pred[0].label, a.dShort(end));
    assert.ok(pred[0].v < pts(s).slice(-1)[0].v);
  } else assert.equal(pred.length, 0);
  /* Slower at the second measurement: nothing is projected. */
  const b = evidenced();
  const ps = b.athlete().performances;
  b.state.days.forEach(d => { if (d.type === 'checkpoint'){ d.completed = false; d.actual = null; } });
  b.athlete().performances = [ps[ps.length - 1], Object.assign({}, ps[0], { date: b.addDays(TODAY, -2) })]
    .sort((x, y) => x.date < y.date ? -1 : 1);
  const sb = series(b, 'threshold');
  if (sb.ready && pts(sb).slice(-1)[0].v > pts(sb)[0].v)
    assert.equal(Array.from(sb.predicted).length, 0, 'a decline in measured fitness was projected');
  assert.match(fnBody('coachGraphSeries'), /proj = raceGoalProjectedVdot\(ahead\)/);
});

// ---------------------------------------------------------------------------
// THE DRAWING
// ---------------------------------------------------------------------------

test('measured is solid cherry, predicted is dotted gold, and every point drawn is a point measured', () => {
  const a = evidenced();
  a.coachGraphSel = 'drift';
  const s = series(a, 'drift');
  assert.ok(Array.from(s.predicted).length > 0, 'the fixture has no prediction to draw');
  const card = a.renderCoachGraph();
  assert.equal((card.match(/class="cg-dot"/g) || []).length, pts(s).length);
  assert.equal((card.match(/class="cg-pdot"/g) || []).length, Array.from(s.predicted).length);
  assert.equal((card.match(/<polyline class="cg-line"/g) || []).length, 1);
  assert.equal((card.match(/<polyline class="cg-pred"/g) || []).length, 1);
  assert.match(rule('.cg-line'), /stroke:var\(--cherry-text\)/);
  assert.ok(!/dasharray/.test(rule('.cg-line')), 'the measured line is not solid');
  assert.match(rule('.cg-pred'), /stroke:var\(--gold\)/);
  assert.match(rule('.cg-pred'), /stroke-dasharray:/, 'the predicted line is not dotted');
  assert.match(rule('.cg-dot'), /fill:var\(--cherry-text\)/);
  assert.match(rule('.cg-pdot'), /fill:var\(--gold\)/);
  assert.match(card, /<span class="cg-key is-measured">Measured<\/span><span class="cg-key is-predicted">Predicted<\/span>/);
  /* The prediction starts where the measurement ends. */
  const line = /<polyline class="cg-line" points="([^"]+)"/.exec(card)[1].split(' ');
  const pred = /<polyline class="cg-pred" points="([^"]+)"/.exec(card)[1].split(' ');
  assert.equal(pred[0], line[line.length - 1]);
  /* And it can be read without seeing it. */
  const alt = /<svg class="cg-svg"[^>]*aria-label="([^"]+)"/.exec(card)[1];
  pts(s).forEach(p => assert.ok(alt.indexOf(p.label + ' ' + s.fmt(p.v)) !== -1, p.label + ' is missing from the description'));
  assert.match(alt, /Predicted: /);

  /* No prediction, no "Predicted" in the key. */
  a.coachGraphSel = 'recovery';
  const rec = a.renderCoachGraph();
  assert.ok(!/cg-pred|is-predicted|Predicted/.test(rec));
  assert.match(rec, /<span class="cg-key is-measured">Measured<\/span>/);
});

test('the card is SACORO\'s: white type, tokens for colour, no pill, no icon, no filled box', () => {
  const a = evidenced();
  a.coachGraphSel = 'efficiency';
  const card = a.renderCoachGraph();
  assert.equal((card.match(/<svg/g) || []).length, 1, 'something other than the chart is drawn');
  assert.ok(!/<img|class="[^"]*\bpill\b|<path/.test(card));
  const css = CSS.slice(CSS.indexOf('.cg-card{'), CSS.indexOf('.b-plates{'));
  assert.ok(!/#[0-9A-Fa-f]{3,6}/.test(css.replace(/#FFFFFF/g, '')), 'a colour that is not white or a token is used');
  assert.ok(!/var\(--ink-(dim|faint)\)/.test(css), 'grey type');
  assert.ok(!/background:/.test(rule('.cg-card')), 'the card is a filled box');
  assert.match(rule('.cg-card'), /border:1\.5px solid var\(--cherry\)/);
  assert.match(rule('.cg-fig.is-good'), /color:var\(--ok\)/, 'an improvement is not green');
  ['.cg-cap', '.cg-fig-t', '.cg-wait-s', '.cg-legend'].forEach(sel =>
    assert.match(rule(sel), /font-size:var\(--fs-support\); line-height:var\(--lh-support\)/, sel + ' is off the type scale'));
});

test('miles are miles', () => {
  const a = evidenced();
  const km = series(a, 'efficiency');
  a.state.units = 'mi';
  const mi = series(a, 'efficiency');
  assert.match(mi.figureText, /^per mi on easy runs$/);
  assert.ok(Math.abs(pts(mi)[0].v / pts(km)[0].v - 1.609344) < 1e-3, 'a mile of heartbeats is not 1.609 km of them');
  assert.match(series(a, 'threshold').figureText, /per mi$/);
});

// ---------------------------------------------------------------------------
// THE COACHING IS UNTOUCHED
// ---------------------------------------------------------------------------

test('the graphs read the engine and are read by nothing', () => {
  const a = evidenced();
  const snap = () => JSON.stringify([a.coachDecision(), a.coachRecovery(), a.planEvolution().state,
    Array.from(a.planEvolution().changes), a.computeConfidenceScore(), a.coachTrend()]);
  const before = snap(), state = JSON.stringify(a.state);
  Array.from(a.COACH_GRAPHS).forEach(k => { a.coachGraphSel = k; a.coachGraphSeries(k); a.renderCoachGraph(); });
  a.renderPlanHQView();
  assert.equal(JSON.stringify(a.state), state, 'drawing the dashboard wrote to the athlete\'s record');
  assert.equal(snap(), before, 'drawing the dashboard changed a coaching reading');
  ['coachDecision', 'coachRecovery', 'coachAnalyse', 'planEvolution', 'playbookAssess', 'athleteTrends',
   'computeConfidenceScore', 'coachBrief', 'coachReadinessLine', 'athleteResponseModel'].forEach(n =>
    assert.ok(!/coachGraph|COACH_GRAPH/.test(fnBody(n)), n + ' reads the dashboard'));
  /* And no new model call. */
  ['coachGraphSeries', 'renderCoachGraph', 'coachGraphProject'].forEach(n =>
    assert.ok(!/fetch\(|\/api\//.test(fnBody(n)), n + ' reaches the network'));
});
