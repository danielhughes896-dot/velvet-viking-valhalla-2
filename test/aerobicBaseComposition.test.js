'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* IS AN AEROBIC BASE BLOCK ACTUALLY AEROBIC DEVELOPMENT?
 *
 * The audit reported one figure -- quality load up 49% from the first third of
 * a base block to the last -- and correctly declined to act on it, because a
 * percentage on its own is not a methodology finding. Decomposed into the
 * sessions an athlete would actually run, it was:
 *
 *     aerobic (easy + long)   42km -> 46km   +10%
 *     quality                 15km -> 22.5km +50%
 *
 * across the block's full (non-cutback) weeks. Quality's share of the week
 * climbed from 26% to 36%. A block whose stated purpose is "build sustainable
 * running capacity" was progressing the other half of itself five times
 * faster, and the slower volume multiplier (1.25 rather than the race
 * distance's 1.55) hid it -- the number on the card grew slowly while the
 * session written on it grew fast.
 *
 * The cause was the same mechanism §2 removed from maintenance: `pos` is
 * progress through the build, every quality structure lerps its dimensions
 * across it, and in a base block the build is the whole block. Bounded, not
 * removed: a base block should progress, it just must not out-progress the
 * aerobic development it exists for.
 */

function app(){
  const a = loadApp({ pinnedDate: '2026-08-21T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.state = a.makeDefaultState(); a.state.athlete = a.makeAthleteRecord();
  return a;
}
const QUALITY = ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint', 'race'];
const SCHEDULE = { activeDays: [0, 1, 2, 4, 5], longRunDay: 5 };

/* Every week of a real generated block, split into the two stimuli. */
function weeksOf(a, purpose, distKey, vol, wks){
  const br = a.buildBlockWeeks(distKey, vol, wks, { purpose, steady: purpose === 'maintain' });
  const start = '2026-08-24';
  const days = a.buildDaysFromWeeks(br, a.addDays(start, wks * 7 - 1), SCHEDULE, start, false);
  return br.weeks.map(w => {
    const wd = days.filter(d => d.week === w.week && d.type !== 'rest');
    const sum = f => a.round1(wd.filter(f).reduce((s, d) => s + (d.km || 0), 0));
    return { week: w.week, phase: w.phase, isCutback: !!w.isCutback, isTaper: !!w.isTaper,
             isRace: !!w.isRace,
             aerobic: sum(d => d.type === 'easy' || d.type === 'long'),
             quality: sum(d => QUALITY.indexOf(d.type) !== -1),
             titles: wd.filter(d => QUALITY.indexOf(d.type) !== -1).map(d => d.title) };
  });
}
/* The honest comparison. Cutback weeks are prescribed recovery and land
   unevenly -- weeks 8 and 10 of a ten-week base block are BOTH cutbacks -- so
   a first-third/last-third average measures where the cutbacks fell as much as
   it measures progression. */
function fullWeeks(rows){ return rows.filter(r => !r.isCutback && !r.isTaper && !r.isRace); }
const growth = (a, b) => (b / a - 1);

test('a base block does not progress its quality faster than its aerobic work', () => {
  const a = app();
  const full = fullWeeks(weeksOf(a, 'base', 'half', 55, 10));
  const first = full[0], last = full[full.length - 1];
  const aer = growth(first.aerobic, last.aerobic);
  const qual = growth(first.quality, last.quality);
  assert.ok(qual <= aer + 0.10,
    'aerobic ' + first.aerobic + ' -> ' + last.aerobic + ' (' + Math.round(aer * 100) + '%) but quality ' +
    first.quality + ' -> ' + last.quality + ' (' + Math.round(qual * 100) + '%)');
});

test('a base block still progresses — this is a development block, not maintenance', () => {
  const a = app();
  const full = fullWeeks(weeksOf(a, 'base', 'half', 55, 10));
  const first = full[0], last = full[full.length - 1];
  assert.ok(growth(first.aerobic, last.aerobic) >= 0.10,
    'aerobic work barely moved: ' + first.aerobic + ' -> ' + last.aerobic);
  assert.ok(growth(first.quality, last.quality) > 0.05,
    'quality was frozen rather than bounded: ' + first.quality + ' -> ' + last.quality);
});

test('quality never takes a growing share of an aerobic base week', () => {
  const a = app();
  const rows = weeksOf(a, 'base', 'half', 55, 10);
  const share = r => r.quality / (r.aerobic + r.quality);
  const early = rows.slice(0, 3).map(share);
  const late = rows.slice(-3).map(share);
  assert.ok(Math.max.apply(null, late) <= Math.max.apply(null, early) + 0.04,
    'quality share ran ' + early.map(x => Math.round(x * 100) + '%').join('/') + ' -> ' +
    late.map(x => Math.round(x * 100) + '%').join('/'));
});

test('a race block is still allowed to sharpen — the bound is base-only', () => {
  /* The guard against over-correcting. Race Goal was declared unchanged byte
     for byte by §5/§6 and must stay that way. */
  const a = app();
  const full = fullWeeks(weeksOf(a, 'race', 'half', 55, 12));
  const q = growth(full[0].quality, full[full.length - 1].quality);
  assert.ok(q >= 0.4, 'a race block stopped sharpening: ' + Math.round(q * 100) + '%');
});

test('maintenance still holds its dose, and base is not turned into maintenance', () => {
  const a = app();
  const m = weeksOf(a, 'maintain', 'half', 55, 8).map(r => r.quality);
  const b = weeksOf(a, 'base', 'half', 55, 10).map(r => r.quality);
  const slope = v => {
    const n = v.length, xs = v.map((_, i) => i);
    const mx = xs.reduce((s, x) => s + x, 0) / n, my = v.reduce((s, x) => s + x, 0) / n;
    return xs.reduce((s, x, i) => s + (x - mx) * (v[i] - my), 0) /
           xs.reduce((s, x) => s + (x - mx) * (x - mx), 0);
  };
  assert.ok(Math.abs(slope(m)) < 0.2, 'maintenance acquired a trend: ' + slope(m).toFixed(3));
  assert.ok(slope(b) > 0.2, 'base lost its progression: ' + slope(b).toFixed(3));
});

test('the base block is predominantly aerobic, week by week', () => {
  /* The question behind the 49%: is this a race build under another label?
     A race block runs 24-31% quality; a base block must sit below that. */
  const a = app();
  const rows = weeksOf(a, 'base', 'half', 55, 10);
  rows.forEach(r => {
    const share = r.quality / (r.aerobic + r.quality);
    assert.ok(share <= 0.32,
      'week ' + r.week + ' (' + r.phase + ') was ' + Math.round(share * 100) +
      '% quality: ' + r.titles.join(', '));
  });
});

test('nothing in a base block is goal-pace or a maximal test', () => {
  const a = app();
  const rows = weeksOf(a, 'base', 'half', 55, 10);
  rows.forEach(r => r.titles.forEach(t => {
    assert.ok(!/goal pace/i.test(t), 'week ' + r.week + ': ' + t);
    assert.ok(!/checkpoint|time trial/i.test(t), 'week ' + r.week + ': ' + t);
  }));
});
