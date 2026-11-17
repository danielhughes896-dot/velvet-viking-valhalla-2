'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const CSS = SRC.match(/<style[^>]*>([\s\S]*?)<\/style>/)[1];
const BARE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
const rule = sel => {
  const i = BARE.indexOf(sel + '{');
  assert.ok(i > -1, 'rule not found: ' + sel);
  return BARE.slice(i + sel.length + 1, BARE.indexOf('}', i));
};
const BLOCKS = [['full', 46, 16], ['half', 40, 12], ['10k', 40, 12], ['5k', 35, 10]];
function app(){
  const a = loadApp({ pinnedDate: '2026-09-01T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
/* Every bar the engine can draw, across four distances. */
function everyBar(a){
  const out = [];
  BLOCKS.forEach(([k, v, w]) => {
    buildPlan(a, { weeks: w, startDate: '2026-09-04', distanceKey: k, volume: v,
      benchSec: 45 * 60, lthr: 165, maxHR: 190,
      schedule: { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 } });
    for (let wk = 1; wk <= a.totalWeeksInPlan(); wk++){
      const h = a.renderZoneBreakdown(wk);
      if (h) out.push({ k, wk, html: h });
    }
  });
  return out;
}

/* ---------- THE BAND SAYS WHAT IT IS ----------
   Founder, with a mock-up: "Can you add session type, % and time to the
   bar? I ack your going to say no when it's at 1% currently there is no
   space so I think like the mock picture it can work it just won't be
   perfectly to scale." */
/* ---------- THREE FIGURES, NO BAR ----------
   Founder, choosing between the lit bar and a mock of the numbers alone:
   "which do you prefer?" -- the numbers (17 November 2026). The bar's tests
   guarded a band that had to hold its own words at 1%; there is no band
   now. What is guarded is what the bar was for: every zone with time in it
   states its share and its time, the shares still add up, nothing empty is
   drawn, and no bar comes back. */
const ZCOL = /<div class="zcol"><div class="zcol-pct font-head z-[a-z]+-ink">(\d+)%<\/div><div class="zcol-time font-mono">([^<]*)<\/div><div class="zcol-k">([^<]*(?:<sub>2<\/sub>[^<]*)?)<\/div><\/div>/g;
test('every zone states its own share, its own time and its name', () => {
  const a = app();
  const weeks = everyBar(a);
  assert.ok(weeks.length >= 40, 'only ' + weeks.length + ' weeks have a breakdown — this proves little');
  let cols = 0, smallest = 100;
  weeks.forEach(b => {
    const found = Array.from(b.html.matchAll(ZCOL));
    assert.ok(found.length >= 1, b.k + ' w' + b.wk + ': the breakdown has no figures at all');
    let sum = 0;
    found.forEach(m => {
      const pct = Number(m[1]);
      assert.ok(pct > 0, b.k + ' w' + b.wk + ': a zone with no share was drawn');
      assert.match(m[2], /^(?:\d+h \d{2}m|\d+m)$/, b.k + ' w' + b.wk + ': a time reads "' + m[2] + '"');
      assert.match(m[3], /Easy|Goal|Threshold|Interval/, b.k + ' w' + b.wk + ': a figure does not name its zone');
      if (pct < smallest) smallest = pct;
      sum += pct; cols++;
    });
    assert.equal(sum, 100, b.k + ' w' + b.wk + ': the figures add up to ' + sum + '%, not 100');
  });
  assert.ok(cols >= 90, 'only ' + cols + ' figures were read');
  /* The small zone the bar could not hold is the one this was chosen for. */
  assert.ok(smallest <= 2, 'the smallest zone across every block is ' + smallest + '% — the narrow case is gone');
});

test('no bar and no legend: each figure names its own zone', () => {
  const a = app();
  everyBar(a).forEach(b => {
    assert.doesNotMatch(b.html, /class="zbar|class="zone-legend/, b.k + ' w' + b.wk + ': the bar or its legend came back');
  });
  assert.doesNotMatch(SRC, /'<div class="zbar">'/, 'the bar is drawn again');
});

test('four zones fit the narrowest phone', () => {
  /* Each figure takes an equal share of the width and may not grow past it,
     and the figures step down a size at 360px and below. */
  assert.match(rule('.zcol'), /flex:1 1 0/);
  assert.match(rule('.zcol'), /min-width:0/);
  assert.match(CSS, /@media \(max-width:360px\)\{ \.zcol-pct\{font-size:1\.625rem;\}/);
});

test('a zone’s time reads as a clock, not as sixty minutes', () => {
  /* Math.round() on 3599 seconds gives 60 minutes, which must read as an
     hour. The guard is in the renderer; this is the case that needs it. */
  const a = app();
  buildPlan(a, { weeks: 12, startDate: '2026-09-04', distanceKey: 'half', volume: 40,
    benchSec: 45 * 60, lthr: 165, maxHR: 190,
    schedule: { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 } });
  const real = a.computeWeekZoneBreakdown;
  const say = secs => {
    a.computeWeekZoneBreakdown = () => ({ totalSec: secs, zones: { easy: secs, mp: 0, threshold: 0, interval: 0 } });
    const h = a.renderZoneBreakdown(1);
    a.computeWeekZoneBreakdown = real;
    return /<div class="zcol-time font-mono">([^<]*)<\/div>/.exec(h)[1];
  };
  assert.equal(say(3599), '1h 00m', '3599s rounds to "60m" instead of an hour');
  assert.equal(say(3600), '1h 00m', 'an exact hour does not read as one');
  assert.equal(say(2700), '45m', 'three quarters of an hour grew an hours field');
  assert.equal(say(7140), '1h 59m', 'an hour and fifty-nine reads wrong');
  assert.equal(say(180), '3m', 'three minutes reads wrong');
});
