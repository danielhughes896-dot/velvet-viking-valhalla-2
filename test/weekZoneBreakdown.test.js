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
test('every band states its own share and its own time', () => {
  const a = app();
  const bars = everyBar(a);
  assert.ok(bars.length >= 40, 'only ' + bars.length + ' weeks have a bar — this proves little');
  let bands = 0, smallest = 100;
  bars.forEach(b => {
    const segs = b.html.match(/<div class="zbar-seg [^"]*" style="flex-grow:\d+"><span class="zbar-k">([^<]*)<\/span><\/div>/g) || [];
    assert.ok(segs.length >= 1, b.k + ' w' + b.wk + ': the bar has no bands at all');
    segs.forEach(seg => {
      const txt = /<span class="zbar-k">([^<]*)<\/span>/.exec(seg)[1];
      /* A SHARE, A SEPARATOR AND A TIME -- "9% • 42m" or "77% • 5h 55m". */
      const m = /^(\d+)% • (?:(\d+)h (\d{2})m|(\d+)m)$/.exec(txt);
      assert.ok(m, b.k + ' w' + b.wk + ': a band reads "' + txt + '", which is not a share and a time');
      const pct = Number(m[1]);
      assert.ok(pct > 0, b.k + ' w' + b.wk + ': a band with no share was drawn');
      if (pct < smallest) smallest = pct;
      bands++;
    });
    /* THE SHARES STILL ADD UP. The bar stops being to scale; it does not
       stop being true. */
    const sum = (b.html.match(/<span class="zbar-k">(\d+)%/g) || [])
      .reduce((n, x) => n + Number(/(\d+)/.exec(x)[1]), 0);
    assert.equal(sum, 100, b.k + ' w' + b.wk + ': the bands add up to ' + sum + '%, not 100');
  });
  assert.ok(bands >= 90, 'only ' + bands + ' bands were read');
  /* THE CASE THE FOUNDER RAISED EXISTS. If no week ever had a 1% band the
     whole not-to-scale argument would be theoretical. */
  assert.ok(smallest <= 2,
    'the smallest band across every block is ' + smallest + '% — the narrow case this is built for is gone');
});

test('the legend names the colour and states no figure', () => {
  /* IT WAS THE ONLY PLACE THE SHARE WAS STATED. The band states it now, and
     the same number in two places is how two surfaces start disagreeing. */
  const a = app();
  everyBar(a).forEach(b => {
    const leg = /<div class="zone-legend">([\s\S]*?)<\/div><\/div>/.exec(b.html);
    assert.ok(leg, b.k + ' w' + b.wk + ': the legend is gone');
    assert.equal(/\d+%/.test(leg[1]), false,
      b.k + ' w' + b.wk + ': the legend states a share again, which the band already says');
    assert.ok(leg[1].indexOf('zleg-dot') > -1, 'the legend lost the dots that key the colours');
  });
});

/* ---------- NOT TO SCALE, AND THAT IS THE MECHANISM ----------
   A 1% band is 4px of a 398px bar and cannot hold "1% • 3m". The founder
   accepted the trade; this is how it is paid for, and it is stated as a
   rule rather than as a minimum width somebody has to re-tune when the
   copy changes. */
test('a band is as wide as its share, or as its own words', () => {
  const seg = rule('.zbar-seg');
  assert.match(seg, /flex-basis:0/,
    'the band has a basis other than 0, so flex-grow no longer expresses the share');
  assert.match(seg, /min-width:max-content/,
    'the band lost its floor, so a 1% band goes back to being 4px of unreadable colour');
  assert.match(SRC, /style="flex-grow:'\+pct\[m\.k\]/,
    'the share is carried by something other than flex-grow — width would fight min-width and overflow');
  assert.equal(/<div class="zbar-seg[^>]*style="width:/.test(SRC), false,
    'a band sets a width again');
  /* AND THE BAR CONTAINS WHAT IT CANNOT FIT. Measured across all 50 real
     weeks at 430/414/390/375/360px: none overflows and none clips. This is
     for the case that is not in the data. */
  assert.match(rule('.zbar'), /overflow:hidden/,
    'the bar no longer contains a band set too wide for it');
  /* THE WORDS SIT ABOVE THE SHEEN, which is a pseudo-element on the band. */
  assert.match(rule('.zbar-k'), /z-index:3/, 'the figure fell under the band’s own sheen');
  assert.match(rule('.zbar-k'), /white-space:nowrap/,
    'the figure may wrap, which breaks the band’s floor');
});

test('a band’s time reads as a clock, not as sixty minutes', () => {
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
    return /<span class="zbar-k">([^<]*)<\/span>/.exec(h)[1];
  };
  assert.equal(say(3599), '100% • 1h 00m', '3599s rounds to "60m" instead of an hour');
  assert.equal(say(3600), '100% • 1h 00m', 'an exact hour does not read as one');
  assert.equal(say(2700), '100% • 45m', 'three quarters of an hour grew an hours field');
  assert.equal(say(7140), '100% • 1h 59m', 'an hour and fifty-nine reads wrong');
  assert.equal(say(180), '100% • 3m', 'three minutes reads wrong');
});
