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
  /* Founder: "The fresh tab can be seen a little when [swiped] to see the
     4th circle." Three columns and two gaps fill the row; the gap clears a
     ring's glow past the 8px the rail shows at each side; and the rail is
     given those 8px after its last circle, so the last position mirrors the
     first instead of stopping short with the previous circle still in it. */
  const gap = +/gap:(\d+)px/.exec(rule('.b-rail > .b-grid'))[1];
  const pad = +/padding:12px (\d+)px/.exec(rule('.b-rail'))[1];
  assert.match(rule('.b-rail > .b-grid .b-dial-col'), new RegExp('flex:0 0 calc\\(\\(100% - ' + (2 * gap) + 'px\\) / 3\\)'), 'not three to a row');
  assert.ok(gap >= pad + 8, 'a ' + gap + 'px gap leaves the previous circle\'s glow inside the rail');
  assert.equal(rule('.b-rail > .b-grid::after'), ".b-rail > .b-grid::after{content:''; flex:0 0 " + pad + 'px; height:1px; margin-left:-' + gap + 'px;',
    'the rail stops short of its last snap point');
  assert.match(rule('.b-rail > .b-grid .b-dial-col'), /scroll-snap-align:start/);
  assert.match(rule('.b-rail'), /overflow-x:auto;[^}]*scroll-snap-type:x mandatory/);
  /* Founder: "The gold under the circles should be the same small circles
     used on the other rails." The same dot, to the pixel: round, six across,
     faint until it is the one showing, then bright gold. No dash. */
  const dot = rule('.b-rail-dot'), on = rule('.b-rail-dot.is-on');
  const other = CSS.slice(CSS.indexOf(' .how-dot{'), CSS.indexOf('}', CSS.indexOf(' .how-dot{')));
  const otherOn = CSS.slice(CSS.indexOf(' .how-dot.is-on{'), CSS.indexOf('}', CSS.indexOf(' .how-dot.is-on{')));
  ['width:6px; height:6px; border-radius:50%; background:var(--mark-faint)', 'opacity:.34'].forEach(bit => {
    assert.ok(dot.indexOf(bit) !== -1, 'the rail dot is not ' + bit);
    assert.ok(other.replace(/\s+/g, ' ').indexOf(bit) !== -1, 'the other rails changed: ' + bit);
  });
  ['background:var(--gold-bright); opacity:1', 'box-shadow:0 0 8px color-mix(in srgb, var(--gold-bright) 60%, transparent)'].forEach(bit => {
    assert.ok(on.indexOf(bit) !== -1, 'the current dot is not ' + bit);
    assert.ok(otherOn.replace(/\s+/g, ' ').indexOf(bit) !== -1, 'the other rails changed: ' + bit);
  });
  assert.ok(!/width:/.test(on), 'the current position is a dash, not a dot');
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
    /* Founder: "the current 'None yet' wording is rather cold." What Sacoro
       reads this from, and that the first one starts it. Never a count of
       what is missing. */
    assert.match(s.hello, /^SACORO reads this from /, k + ' does not say what it is read from');
    assert.match(s.hello, /starts it\.$/, k);
    assert.ok(card.indexOf('<div class="cg-wait-s">' + a.escapeHtml(s.hello) + '</div>') !== -1, k + ' does not say it on the card');
    assert.doesNotMatch(card, /None yet|so far\.|\d+ of \d+/, k + ' counts what is missing');
    /* Founder: "there should be the out line on the graph. Just no data on
       it." The frame, and not one thing a measurement would put there. */
    assert.equal((card.match(/<svg class="cg-svg cg-frame"/g) || []).length, 1, k + ' has no outline');
    assert.equal((card.match(/<line class="cg-grid"/g) || []).length, a.COACH_GRAPH_BOX.rules);
    assert.equal((card.match(/<line class="cg-base"/g) || []).length, 1);
    assert.ok(!/<text|<circle|<polyline|<polygon|cg-ylab|cg-xlab|cg-line|cg-dot|cg-pred|cg-fig|cg-legend|cg-measure/.test(card),
      k + ' put data, a scale or a legend on an empty graph');
    assert.ok(!/\d/.test(card.slice(card.indexOf('<svg'), card.indexOf('</svg>')).replace(/(x1|x2|y1|y2|viewBox)="[^"]*"/g, '')),
      k + ': a figure is drawn on the outline');
  });
  /* The design's own heading sits over the three aerobic graphs. */
  ['efficiency', 'paceAtHR', 'drift'].forEach(k => assert.equal(series(a, k).group, 'Aerobic Development'));
});

/* ---------------------------------------------------------------------------
 * EVIDENCE FROM THE FIRST VALID SESSION
 * Founder: "The five graphs should progressively become useful as evidence
 * arrives, rather than staying blank until a fixed requirement is met ...
 * after two comparable easy runs, SACORO could already say: 'Your heart rate
 * was 4 bpm lower at a similar pace. Early evidence -- more runs needed to
 * establish a trend.' That's useful coaching without pretending two runs
 * prove improved fitness."
 * ------------------------------------------------------------------------- */
const EARLY = /Early evidence \u2014 more (runs|sessions) needed to establish a trend\./;
/* The first n easy runs, logged; `hr(i)` gives each a heart rate, or none. */
function easyLogged(n, hr, pace){
  const a = athlete();
  const runs = past(a).filter(d => d.type === 'easy').slice(0, n);
  runs.forEach((d, i) => {
    logAsPrescribed(a, d, { quality: 1 });
    if (hr) d.actual.hr = hr(i);
    if (pace) d.actual.pace = a.secToClock(paceSec(d.actual.pace) + pace(i));
    delete d.coachReview; a.coachPersistReview(d);
  });
  return { a, runs };
}
const drawn = (a, k) => { a.coachGraphSel = k; return a.renderCoachGraph(); };

test('runs logged without heart rate are acknowledged for what they are', () => {
  const { a } = easyLogged(2);
  ['efficiency', 'paceAtHR'].forEach(k => {
    const s = series(a, k);
    assert.equal(s.ready || s.early, false, k + ' was drawn without heart rate');
    assert.equal(s.hello, '2 easy runs are logged without a heart rate. Add the average heart rate in Your Log and they count here.');
    assert.ok(drawn(a, k).indexOf(a.escapeHtml(s.hello)) !== -1);
  });
  /* And without consent, it is said that way rather than as missing data. */
  a.healthConsentGranted = () => false;
  assert.match(series(a, 'efficiency').hello, /^Heart rate is health information, and SACORO only reads it if you have said it may\./);
});

test('one valid run is a starting point: it is drawn, and nothing is claimed from it', () => {
  const { a } = easyLogged(1, () => 150);
  ['efficiency', 'paceAtHR'].forEach(k => {
    const s = series(a, k), card = drawn(a, k);
    assert.equal(s.early, true, k + ' ignores the one reading it has');
    assert.equal(s.ready, false);
    assert.equal(pts(s).length, 1);
    assert.match(s.caption, /so far, and that is the starting point\./, k);
    assert.doesNotMatch(s.caption, EARLY, k + ' calls one run evidence of a trend');
    assert.equal((card.match(/class="cg-dot"/g) || []).length, 1, k + ' does not draw its one reading');
    assert.ok(!/cg-wait|cg-frame|cg-line|cg-pred|is-good|Predicted/.test(card), k);
  });
  assert.match(series(a, 'efficiency').figure, /^\d+ beats$/);
});

test('two comparable runs are compared, in the founder\'s words, and called early evidence', () => {
  /* The same pace, four beats lower. */
  const { a } = easyLogged(2, i => 150 - i * 4);
  const s = series(a, 'efficiency');
  assert.equal(s.early, true); assert.equal(s.ready, false);
  assert.equal(s.caption, 'Your heart rate was 4 bpm lower at a similar pace. Early evidence \u2014 more runs needed to establish a trend.');
  assert.equal(s.figure, '4 bpm lower'); assert.equal(s.figureText, 'at a similar pace');
  assert.equal(pts(s).length, 2);
  /* It is what the two runs measured: the points are their own heartbeats per km. */
  pts(s).forEach(p => assert.ok(Math.abs(p.v - p.row.hr * p.row.pace / 60) < 1e-6));
  /* Drawn, and not dressed as more than it is: no green, no dotted line, no "Predicted". */
  const card = drawn(a, 'efficiency');
  assert.equal((card.match(/class="cg-dot"/g) || []).length, 2);
  assert.equal(s.good, false);
  assert.equal(Array.from(s.predicted).length, 0);
  assert.ok(!/is-good|cg-pred|Predicted|Dotted/.test(card), 'early evidence is presented as a trend');
  assert.match(card, /<div class="cg-measure">Heartbeats per km \u00b7 each easy run<\/div>/);

  /* Higher is said as plainly as lower. */
  const up = easyLogged(2, i => 146 + i * 5);
  assert.match(series(up.a, 'efficiency').caption, /^Your heart rate was 5 bpm higher at a similar pace\. /);
  /* Runs at different paces are not "a similar pace": the cost per km is compared instead. */
  const diff = easyLogged(2, () => 150, i => -i * 30);
  const sd = series(diff.a, 'efficiency');
  assert.doesNotMatch(sd.caption, /similar pace/);
  assert.match(sd.caption, /^Your latest easy run cost \d+ fewer heartbeats per km than your first\. Early evidence/);
  /* Pace at HR says its own. */
  assert.match(series(a, 'paceAtHR').caption, EARLY);
  /* Two runs too far apart in heart rate are not set side by side. */
  const far = easyLogged(2, i => 138 + i * 16);
  const sf = series(far.a, 'paceAtHR');
  assert.equal(sf.early, false);
  assert.equal(sf.hello, '2 easy runs are logged with heart rate, but not close enough in heart rate to compare pace like for like yet.');
});

test('three separate weeks make a trend, and only then', () => {
  const a = athlete();
  past(a).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const easy = past(a).filter(d => d.type === 'easy');
  [1, 2].forEach(w => easy.filter(d => d.week === w).forEach(d => { d.actual.hr = 150; delete d.coachReview; a.coachPersistReview(d); }));
  let s = series(a, 'efficiency');
  assert.equal(s.have, 2); assert.equal(s.want, 3);
  assert.equal(s.ready, false); assert.equal(s.early, true, 'two weeks of runs are not shown');
  assert.match(s.caption, EARLY);
  easy.filter(d => d.week === 3).forEach(d => { d.actual.hr = 150; delete d.coachReview; a.coachPersistReview(d); });
  s = series(a, 'efficiency');
  assert.equal(s.ready, true); assert.equal(s.early, false);
  assert.doesNotMatch(s.caption, /Early evidence/);
  assert.match(s.measure, /weekly median$/);
});

test('Cardiac Drift says why an average cannot show it, and reads the first run that can', () => {
  /* Founder: "Two runs with only overall averages cannot produce a genuine
     drift measurement." */
  const { a } = easyLogged(2, () => 150);
  let s = series(a, 'drift');
  assert.equal(s.early || s.ready, false, 'drift was made out of averages');
  assert.equal(pts(s).length, 0);
  assert.equal(s.hello, '2 runs are logged with heart rate. Drift is the rise within a run, so it needs a steady run of 40 minutes with lap pace and heart rate: an average cannot show it.');
  /* One steady long run with lap pace and heart rate is a first reading. */
  const b = athlete();
  const long = past(b).filter(d => d.type === 'long' && b.assessPlan(d).family === 'aerobic')[0];
  logAsPrescribed(b, long, { quality: 1 });
  long.actual.hr = 150;
  long.actual.splits = [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ km: long.km / 8, sec: Math.round(long.km / 8 * 345), hr: i < 4 ? 146 : 151 }));
  delete long.coachReview; b.coachPersistReview(long);
  s = series(b, 'drift');
  assert.equal(s.early, true);
  assert.equal(pts(s).length, 1);
  assert.equal(pts(s)[0].v, b.coachHRDrift(long), 'the reading is not the engine\'s own');
  assert.match(s.caption, /^One steady run with lap heart rate so far, and that is the starting point\./);
});

test('all five can be chosen with a thumb, and choosing one redraws the card', () => {
  const a = evidenced();
  a.coachGraphSel = 'efficiency';
  const card = a.renderCoachGraph();
  const tabs = [...card.matchAll(/<button type="button" role="tab" class="cg-tab( is-on)?" aria-selected="(true|false)" data-action="coach-graph" data-graph="([A-Za-z]+)"><span>([^<]+)<\/span><\/button>/g)];
  assert.deepEqual(tabs.map(m => m[3]), Array.from(a.COACH_GRAPHS));
  assert.deepEqual(tabs.map(m => m[4]), ['Efficiency', 'Pace at HR', 'Drift', 'Threshold', 'Recovery']);
  assert.deepEqual(tabs.filter(m => m[2] === 'true').map(m => m[3]), ['efficiency']);
  assert.match(rule('.cg-tab'), /min-height:44px/, 'a tab is not a 44px target');
  /* Founder: "ideally I would like them across the whole top as 5 in 1 row."
     One row, edge to edge, under a centred title. (They were three and two
     while the card had a rim and padding; measured at 320, 360 and 390px
     without those, all five fit.) */
  assert.match(rule('.cg-tabs'), /display:flex; justify-content:space-between/);
  assert.ok(!/flex-wrap|grid|overflow-x/.test(rule('.cg-tabs')), 'the tabs wrap, or one is hidden behind a sideways scroll');
  assert.match(rule('.cg-tab'), /flex:0 0 auto/, 'a tab is not the width of its word');
  assert.match(rule('.cg-tab'), /white-space:nowrap/);
  assert.match(rule('.cg-tab::after'), /position:absolute; top:0; bottom:0; left:-7px; right:-7px/, 'the target is only as wide as the word');
  assert.match(rule('.cg-title'), /text-align:center/, 'the title is not centred');
  assert.ok(card.indexOf('class="cg-title"') < card.indexOf('class="cg-tabs"'), 'the tabs are not under the title');
  assert.match(rule('.cg-tab.is-on'), /color:var\(--cherry-text\)/, 'the chosen tab is not cherry');
  assert.match(rule('.cg-tab.is-on > span'), /border-bottom-color:var\(--cherry-text\)/);
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
  /* A main-set pace is not health data: Threshold is still read, without its heart rate. */
  const t = thresholded(3);
  t.a.healthConsentGranted = () => false;
  const s = series(t.a, 'threshold');
  assert.equal(s.ready, true);
  assert.ok(pts(s).every(p => p.row.hr == null && p.row.felt == null), 'a heart rate or a feeling was read without consent');
  assert.doesNotMatch(s.caption, /bpm|felt/);
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

/* Founder: "verify all five development graphs use valid physiological
   evidence and accurately labelled measurements." Drift is a rise in heart
   rate at a HELD pace. It was being read from any long run with lap data,
   including ones that finish at goal pace -- where the heart rate rises
   because the athlete is running faster. */
test('Cardiac Drift is read only from a run that held its pace', () => {
  const a = evidenced();
  const s = series(a, 'drift');
  assert.equal(s.ready, true);
  const steady = d => a.assessPlan(d).family === 'aerobic';
  pts(s).forEach(p => {
    const runs = past(a).filter(d => d.type === 'long' && d.week === p.x && steady(d));
    assert.ok(runs.length, 'W' + p.x + ' is plotted and no steady long run was run that week');
    assert.ok(Math.abs(p.v - median(runs.map(d => a.coachHRDrift(d)))) < 0.06, 'W' + p.x + ' is not that week\'s measured drift');
  });
  /* A long run with goal-pace work in it has lap heart rate too, and is not drift. */
  const staged = past(a).filter(d => d.type === 'long' && !steady(d));
  assert.ok(staged.length, 'the fixture has no staged long run to exclude');
  staged.forEach(d => {
    assert.ok(a.coachHRDrift(d) != null, 'the staged run has no lap heart rate, so this proves nothing');
    assert.equal(a.coachGraphDrift(d), null, d.title + ' was read as drift');
    assert.ok(pts(s).map(p => p.x).indexOf(d.week) === -1 || past(a).some(x => x.type === 'long' && x.week === d.week && steady(x)));
  });
  const one = past(a).filter(d => d.type === 'long' && steady(d))[0];
  const keep = JSON.stringify(one.actual.splits), drift = a.coachGraphDrift(one);
  assert.equal(drift, a.coachHRDrift(one), 'the number is not the engine\'s own');
  /* It sped up: the second half is 8% quicker. Not drift. */
  one.actual.splits = one.actual.splits.map((x, i) => Object.assign({}, x, { sec: Math.round(x.sec * (i < 4 ? 1 : 0.92)) }));
  assert.equal(a.coachGraphDrift(one), null, 'a run that sped up was read as drift');
  /* Laps with heart rate and no pace: there is no way to know the pace was held. */
  one.actual.splits = JSON.parse(keep).map(x => ({ hr: x.hr }));
  assert.ok(a.coachHRDrift(one) != null);
  assert.equal(a.coachGraphDrift(one), null, 'drift was read with nothing to say the pace was held');
  /* One lap in each half without a pace: the halves still match on the laps
     that have one, which is exactly why a gap cannot be waved through. */
  one.actual.splits = JSON.parse(keep).map((x, i) => (i === 1 || i === 5) ? { hr: x.hr, sec: x.sec } : x);
  assert.ok(a.coachHRDrift(one) != null);
  assert.equal(a.coachGraphDrift(one), null, 'drift was read across laps whose pace is unknown');
  /* Twenty minutes is not long enough to drift. */
  one.actual.splits = JSON.parse(keep).map(x => Object.assign({}, x, { km: 0.4, sec: 136 }));
  assert.equal(a.coachGraphDrift(one), null, 'a short run was read as drift');
  one.actual.splits = JSON.parse(keep);
  assert.equal(a.coachGraphDrift(one), drift);
  /* A session of reps drifts by design and is not read. */
  const rep = past(a).filter(d => d.type === 'interval')[0];
  rep.actual.hr = 160; rep.actual.splits = [1, 2, 3, 4, 5, 6].map(i => ({ km: 1, sec: 300, hr: 140 + i * 8 }));
  assert.equal(a.coachGraphDrift(rep), null, 'an interval session was read as drift');
  /* No laps, no drift. */
  const b = evidenced();
  past(b).forEach(d => { if (d.actual) delete d.actual.splits; });
  assert.equal(series(b, 'drift').ready, false);
});

/* Founder: "Measured Fitness: A completed race or valid Fitness Checkpoint
   establishes a performance measurement. Keep that authority. Threshold
   Development: Use comparable, well-executed threshold sessions to track
   pace, HR, execution and response over time, with appropriate confidence.
   Threshold prediction: Require stronger validated evidence before
   estimating race performance or adjusting training zones. A threshold
   session is useful evidence of training development, but it isn't
   automatically a measured lactate threshold or race result."
   (This law used to hold the graph to races and checkpoints alone.) */
function thresholded(n, tweak){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.patchExecutionUI = () => {}; a.patchSplitsTotal = () => {}; a.patchDerivedStats = () => {}; a.replaceCard = () => {};
  buildPlan(a, { distanceKey: 'full', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-06' });
  const th = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY &&
    a.assessPlan(d).work.some(x => x.intensity === 'threshold'));
  assert.ok(th.length >= 3, 'the fixture has too few threshold sessions');
  const band = a.getActivePaces().T, mid = Math.round((band.fast + band.slow) / 2);
  th.slice(0, n).forEach((d, i) => {
    logAsPrescribed(a, d, { quality: 1 });
    const main = Array.from(a.loggingModeFor(d).plan.rows).filter(r => r.role === 'work');
    main.forEach(r => {
      a.handleStructuredSplitChange(d.id, r.segId, 'pace', a.secToPace(mid - i * 3));
      a.handleStructuredSplitChange(d.id, r.segId, 'hr', String(170 - i * 2));
    });
    a.handleLogAnswer(d.id, 'mainSetFelt', '3');
    if (tweak) tweak(a, d, i, main, mid);
  });
  return { a, th, mid, band };
}

test('Threshold Development is drawn from threshold sessions run to plan', () => {
  const { a, th, mid } = thresholded(3);
  const s = series(a, 'threshold');
  assert.equal(s.ready, true);
  assert.deepEqual(pts(s).map(p => Math.round(p.v)), [mid, mid - 3, mid - 6], 'the points are not the main sets\' own paces');
  assert.deepEqual(pts(s).map(p => p.label), Array.from(th).slice(0, 3).map(d => a.dShort(d.date)));
  assert.equal(s.figure, '0:06 faster');
  assert.equal(s.figureText, 'main-set pace per km');
  /* Pace, heart rate and response, said together. */
  assert.equal(s.caption, 'Your threshold main set was 0:06 per km quicker than in your first session at 4 bpm lower. ' +
    'The latest felt as intended. From 3 threshold sessions run to plan. A race or Fitness Checkpoint is still what sets your training paces.');
  assert.match(s.measure, /^Main-set pace per km \u00b7 threshold sessions run to plan$/);
  assert.equal(s.good, true);
  /* It is not the session's overall pace, which runs through the warm-up and cool-down. */
  assert.notEqual(Math.round(pts(s)[0].v), a.actualPaceSecPerKm(th[0]));
});

test('a threshold reading builds from the first session, with the confidence it has earned', () => {
  const one = series(thresholded(1).a, 'threshold');
  assert.equal(one.early, true); assert.equal(one.ready, false);
  assert.equal(pts(one).length, 1);
  assert.equal(one.caption, 'One threshold session with a main-set pace so far, and that is the starting point. A race or Fitness Checkpoint is still what sets your training paces.');
  const two = series(thresholded(2).a, 'threshold');
  assert.equal(two.early, true); assert.equal(two.ready, false);
  assert.match(two.caption, /^Your threshold main set was 0:03 per km quicker than in your first session at 2 bpm lower\. The latest felt as intended\. Early evidence \u2014 more sessions needed to establish a trend\. A race or Fitness Checkpoint is still what sets your training paces\.$/);
  assert.equal(two.good, false, 'two sessions are shown as an established gain');
  /* Nothing logged with a main-set pace: said, with what would fix it. */
  const bare = thresholded(0);
  bare.th.slice(0, 2).forEach(d => logAsPrescribed(bare.a, d, { quality: 1 }));
  const sb = series(bare.a, 'threshold');
  assert.equal(sb.early || sb.ready, false);
  assert.equal(sb.hello, '2 threshold sessions are logged without a main-set pace. Add it in Your Log and they count here.');
  /* A block with no threshold work in it is not told its first session starts anything. */
  const k5 = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  k5.showToast = () => {}; k5.renderApp = () => {}; k5.flushSave = () => {}; k5.scheduleSave = () => {};
  buildPlan(k5, { distanceKey: '5k', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-06' });
  assert.equal(series(k5, 'threshold').hello, 'This block has no threshold sessions in it, so there is nothing for SACORO to read here.');
});

test('only comparable, well-executed threshold sessions are plotted', () => {
  /* A main set run far off threshold pace is a different session. */
  const slow = thresholded(3, (a, d, i, main, mid) => { if (i === 1) main.forEach(r => a.handleStructuredSplitChange(d.id, r.segId, 'pace', a.secToPace(mid + 60))); });
  assert.equal(pts(series(slow.a, 'threshold')).length, 2, 'a main set a minute off threshold pace was plotted as threshold');
  /* A session cut short is not a completed threshold session. */
  const cut = thresholded(3, (a, d, i) => { if (i === 2) d.actual.km = d.km * 0.6; });
  assert.equal(pts(series(cut.a, 'threshold')).length, 2, 'a session cut short was plotted');
  /* Tempo and interval sessions are not threshold sessions, however fast. */
  const mixed = thresholded(3);
  const before = pts(series(mixed.a, 'threshold')).map(p => p.v);
  mixed.a.state.days.filter(d => d.date < TODAY && ['tempo', 'interval', 'easy', 'long'].indexOf(d.type) !== -1).forEach(d => {
    logAsPrescribed(mixed.a, d, { quality: 1 }); d.actual.pace = '3:40';
  });
  assert.deepEqual(pts(series(mixed.a, 'threshold')).map(p => p.v), before, 'another kind of session moved the threshold graph');
});

test('a threshold session is not a measurement: it predicts nothing and moves no training pace', () => {
  const { a } = thresholded(3);
  const paces = JSON.stringify(a.getActivePaces()), perfs = JSON.stringify(Array.from(a.measuredPerformances()));
  const s = series(a, 'threshold'), card = drawn(a, 'threshold');
  /* "Threshold prediction: Require stronger validated evidence": nothing is carried forward. */
  assert.equal(Array.from(s.predicted).length, 0);
  assert.ok(!/cg-pred|Predicted|Dotted/.test(card), 'a prediction is drawn from training sessions');
  /* Measured Fitness keeps its authority, and is kept separate. */
  assert.equal(JSON.stringify(a.getActivePaces()), paces, 'a training session moved the training paces');
  assert.equal(JSON.stringify(Array.from(a.measuredPerformances())), perfs, 'a training session became a measured performance');
  const perf = { date: a.addDays(TODAY, -5), km: 5, timeSec: 22 * 60, source: 'checkpoint', qualified: true, vdot: a.vdotFromPerformance(5000, 22 * 60) };
  a.athlete().performances = [perf];
  assert.deepEqual(pts(series(a, 'threshold')).map(p => Math.round(p.v)), pts(s).map(p => Math.round(p.v)), 'a checkpoint was plotted on the training graph');
  const body = fnBody('coachGraphSeries') + fnBody('coachGraphThresholdSessions');
  assert.ok(!/measuredPerformances\(|raceGoalProjectedVdot\(|trainingPacesFromVDOT\(|vdotFromPerformance\(/.test(body),
    'the development graph reads, or writes into, the measured-fitness path');
  ['measuredPerformances', 'getActivePaces', 'raceGoalProjectedVdot', 'computeConfidenceScore', 'planEvolution', 'coachDecision'].forEach(n =>
    assert.ok(!/coachGraphThresholdSessions|coachGraphSeries/.test(fnBody(n)), n + ' reads the threshold graph'));
  assert.doesNotMatch(card, /lactate|VO2|race time|predicted finish/i);
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

// ---------------------------------------------------------------------------
// THE DRAWING
// ---------------------------------------------------------------------------

test('measured is solid cherry, predicted is dotted gold, and every point drawn is a point measured', () => {
  /* Easy running that costs a little less every week: a trend the app will carry forward. */
  const a = evidenced();
  past(a).filter(d => d.type === 'easy').forEach(d => { d.actual.pace = '5:40'; d.actual.hr = 158 - d.week * 2; delete d.coachReview; a.coachPersistReview(d); });
  a.coachGraphSel = 'efficiency';
  const s = series(a, 'efficiency');
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

test('the graph is SACORO\'s: white type, tokens for colour, no pill, no icon, no box', () => {
  const a = evidenced();
  a.coachGraphSel = 'efficiency';
  const card = a.renderCoachGraph();
  assert.equal((card.match(/<svg/g) || []).length, 1, 'something other than the chart is drawn');
  assert.ok(!/<img|class="[^"]*\bpill\b|<path/.test(card));
  const css = CSS.slice(CSS.indexOf('.cg-card{'), CSS.indexOf('.b-plates{'));
  assert.ok(!/#[0-9A-Fa-f]{3,6}/.test(css.replace(/#FFFFFF/g, '')), 'a colour that is not white or a token is used');
  assert.ok(!/var\(--ink-(dim|faint)\)/.test(css), 'grey type');
  /* Founder: "I don't think this should be in a box. It should be full
     width." No fill, no rim, no inset. */
  assert.ok(!/background:|border|box-shadow/.test(rule('.cg-card')), 'the graph is in a box');
  assert.match(rule('.cg-card'), /padding:0;/, 'the graph is inset from the page');
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
  const t = thresholded(3); t.a.state.units = 'mi';
  assert.match(series(t.a, 'threshold').figureText, /per mi$/);
  assert.match(series(t.a, 'threshold').caption, /per mi quicker/);
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

test('every graph says what it plots, in the units it plots it in', () => {
  const a = evidenced();
  const want = {
    efficiency: /^Heartbeats per km \u00b7 easy runs \u00b7 weekly median$/,
    paceAtHR: /^Pace per km \u00b7 easy runs within 5 bpm of \d+ \u00b7 weekly median$/,
    drift: /^Heart-rate rise, second half against first \u00b7 steady runs at a held pace$/,
    threshold: /^Main-set pace per km \u00b7 threshold sessions run to plan$/,
    recovery: /^Hours until you read as normal \u00b7 from your reports and easy heart rate$/,
  };
  const th = thresholded(3).a;
  Object.keys(want).forEach(k => {
    const app = k === 'threshold' ? th : a;
    const s = series(app, k);
    assert.equal(s.ready, true, k + ' is not drawn in the fixture');
    assert.match(s.measure, want[k], k + ' does not state its measurement');
    app.coachGraphSel = k;
    const card = app.renderCoachGraph();
    assert.ok(card.indexOf('<div class="cg-measure">' + a.escapeHtml(s.measure) + '</div>') !== -1, k + ': the measurement is not on the card');
    assert.ok(card.indexOf('class="cg-measure"') < card.indexOf('<svg'), k + ': the measurement is under the chart, not over it');
    /* A dotted line is explained wherever one is drawn, and nowhere else. */
    assert.equal(/Dotted: /.test(card), Array.from(s.predicted).length > 0, k + ': the prediction note and the prediction disagree');
  });
  /* Nothing here is called something it is not. */
  const all = Object.keys(want).map(k => { a.coachGraphSel = k; return a.renderCoachGraph(); }).join(' ') + drawn(th, 'threshold');
  assert.doesNotMatch(all, /VO2|lactate|decoupling|fitness score/i, 'a graph claims a measurement the app does not make');
  a.state.units = 'mi';
  assert.match(series(a, 'efficiency').measure, /^Heartbeats per mi /);
  th.state.units = 'mi';
  assert.match(series(th, 'threshold').measure, /^Main-set pace per mi /);
});


// ---------------------------------------------------------------------------
// SWIPE BETWEEN GRAPHS
// ---------------------------------------------------------------------------

/* Founder: "allow the athlete to swipe horizontally across the graph itself.
   Swipe left/right to change the graph. Tapping Efficiency, Pace at HR,
   Drift, Threshold or Recovery still works. The selected heading and graph
   update together. The three coaching circles above remain independent. No
   arrows, extra buttons or new page." */
test('a swipe across the graph moves one graph along, and the ends stop', () => {
  const a = evidenced();
  let drew = 0; a.renderApp = () => { drew++; };
  a.coachGraphSel = 'efficiency';
  assert.equal(a.coachGraphStep(1), true); assert.equal(a.coachGraphSel, 'paceAtHR');
  assert.equal(a.coachGraphStep(1), true); assert.equal(a.coachGraphSel, 'drift');
  assert.equal(a.coachGraphStep(-1), true); assert.equal(a.coachGraphSel, 'paceAtHR');
  a.coachGraphSel = 'recovery';
  assert.equal(a.coachGraphStep(1), false, 'the last graph swiped on to something');
  assert.equal(a.coachGraphSel, 'recovery');
  a.coachGraphSel = 'efficiency';
  assert.equal(a.coachGraphStep(-1), false, 'the first graph swiped back to something');
  assert.equal(a.coachGraphSel, 'efficiency');
  /* One selection, changed in one place: the function a tapped heading calls. */
  assert.match(fnBody('coachGraphStep'), /handleCoachGraph\(to\)/);
  assert.ok(!/coachGraphSel\s*=/.test(fnBody('coachGraphStep') + fnBody('wireCoachGraph')), 'the swipe keeps a selection of its own');
  /* So the heading and the graph cannot disagree. */
  a.coachGraphSel = 'drift'; a.coachGraphStep(1);
  const card = a.renderCoachGraph();
  assert.match(card, /class="cg-tab is-on" aria-selected="true" data-action="coach-graph" data-graph="threshold"/);
  assert.match(card, /<div class="cg-title">Threshold Development<\/div>/);
});

test('the gesture is the graph\'s own: sideways changes it, up and down still scrolls the page', () => {
  const a = evidenced();
  a.coachGraphSel = 'paceAtHR';
  const card = a.renderCoachGraph();
  /* The graph carries the mark that makes the view pager stand down; the headings and the circles do not share it. */
  assert.match(card, /<div class="cg-body" role="tabpanel" data-hswipe="1">/);
  assert.match(card, /<div class="cg-tabs" role="tablist" aria-label="Development graphs">/);
  assert.match(rule('.cg-body[data-hswipe]'), /touch-action:pan-y pinch-zoom/, 'the page cannot be scrolled from on top of the graph');
  /* No arrows, no extra buttons: five headings are the only controls. */
  assert.equal((card.match(/<button/g) || []).length, 5);
  assert.ok(!/chevron|arrow|&lsaquo;|&rsaquo;|\u2039|\u203a|\u2190|\u2192/i.test(card), 'an arrow was added');
  /* The circles' rail is another element and is not touched by any of this. */
  assert.ok(!/b-rail|scrollLeft/.test(fnBody('wireCoachGraph') + fnBody('coachGraphStep')), 'the swipe reaches the circle rail');

  /* Driven: a body that records its listeners, and touches fed to them. */
  const L = {}, cls = new Set();
  const body = { style: { transform: '' }, clientWidth: 358,
    classList: { add: c => cls.add(c), remove: c => cls.delete(c) },
    addEventListener: (t, f) => { L[t] = f; } };
  a.document.getElementById = id => id === 'coach-graph' ? { querySelector: sel => sel === '.cg-body' ? body : null, outerHTML: null } : null;
  let picked = [];
  a.handleCoachGraph = k => { picked.push(k); a.coachGraphSel = k; };
  a.wireCoachGraph();
  assert.deepEqual(Object.keys(L).sort(), ['touchcancel', 'touchend', 'touchmove', 'touchstart']);
  const drag = (dx, dy) => {
    L.touchstart({ touches: [{ clientX: 200, clientY: 300 }] });
    [0.25, 0.5, 0.75, 1].forEach(f => L.touchmove({ touches: [{ clientX: 200 + dx * f, clientY: 300 + dy * f }], cancelable: true, preventDefault: () => {} }));
    L.touchend({});
  };
  drag(-120, 6);  assert.deepEqual(picked, ['drift'], 'a swipe left did not move to the next graph');
  drag(120, -4);  assert.deepEqual(picked, ['drift', 'paceAtHR'], 'a swipe right did not move back');
  drag(-20, 2);   assert.equal(picked.length, 2, 'a short drag changed the graph');
  assert.equal(body.style.transform, '', 'a drag that was not far enough left the graph displaced');
  drag(-8, -160); assert.equal(picked.length, 2, 'scrolling the page changed the graph');
  /* A scroll that drifts sideways as it goes is still a scroll: far enough
     across to commit, but mostly down, so the graph never claims it. */
  drag(-150, -420); assert.equal(picked.length, 2, 'a mostly vertical drag was taken for a swipe');
  assert.equal(body.style.transform, '', 'a scroll moved the graph sideways');
  /* At the end there is nothing that way, and the graph settles back. */
  a.coachGraphSel = 'recovery';
  drag(-150, 0);  assert.equal(picked.length, 2);
  assert.equal(body.style.transform, '');
  /* Wired once per card, and again for the card a change of graph draws. */
  const before = L.touchstart; a.wireCoachGraph();
  assert.equal(L.touchstart, before, 'the same card was wired twice');
  assert.match(fnBody('handleCoachGraph'), /wireCoachGraph\(\);/);
  assert.match(fnBody('wireWeekDayPager'), /wireCoachGraph\(\);/);
});
