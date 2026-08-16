'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

// An athlete saw "4.5 km" on the card and, underneath it:
//
//   Easy warm-up. 5 × 38s strong uphill effort, walk/jog back down to
//   recover. Easy cool-down.
//
// Nothing there says how much easy running 4.5 km implies. Four archetypes had
// that shape, and they share a cause: their WORK is timed rather than measured,
// so the generator had no rep distance to write and fell back to qualitative
// flanks.
//
// The fix states the warm-up and the total, and deliberately does NOT invent a
// distance for timed reps -- nobody can know in advance how far 5 × 38s uphill
// covers. "Easy running afterwards to complete 4.5 km total" is both honest and
// sufficient.
//
// These tests pin completeness, the honesty of the arithmetic at short
// distances, and the character of each session.
const app = () => loadApp({ pinnedDate: '2026-03-11T09:00:00Z' });

const hills   = (a, reps, sec, km) => a.intervalWorkoutText({ reps, hillSec: sec }, km).desc;
const fartlek = (a, reps, min, km) => a.intervalWorkoutText({ reps, fartlekMin: min }, km).desc;
const progressive = (a, min, km) => a.tempoWorkoutText({ type: 'progressive', min }, km).desc;
const steady      = (a, min, km) => a.tempoWorkoutText({ type: 'steady', min }, km).desc;
const ALL = a => ({
  hill_repeats:      hills(a, 5, 38, 4.5),
  fartlek:           fartlek(a, 4, 2, 7),
  progressive_tempo: progressive(a, 13, 5.5),
  steady_tempo:      steady(a, 13, 5.5),
});

// ---------------------------------------------------------------------------
// THE INVARIANT
// ---------------------------------------------------------------------------
test('every timed-work archetype states a warm-up quantity and the total', () => {
  const a = app();
  Object.entries(ALL(a)).forEach(([name, desc]) => {
    assert.match(desc, /@@D:[\d.]+@@/, name + ' must name a warm-up quantity');
    assert.match(desc, /@@T:[\d.]+@@/, name + ' must name the total to run to');
    assert.ok(!/Easy cool-down\.$/.test(desc),
      name + ' must say how to reach the total, not just "cool down"');
  });
});

test("HQ's exact session now accounts for its distance", () => {
  const a = app();
  const rendered = a.resolveDesc(hills(a, 5, 38, 4.5));
  assert.match(rendered, /^2km easy warm-up\./);
  assert.match(rendered, /5 x 38s strong uphill/);
  assert.match(rendered, /complete 4\.5km total\.$/,
    'the athlete must be able to get from the card total to a run');
});

test('the total shown is the total prescribed, at many distances', () => {
  const a = app();
  [4.5, 5, 6, 7, 8.5, 10, 12.5].forEach(km => {
    [hills(a, 5, 38, km), fartlek(a, 4, 2, km),
     progressive(a, 13, km), steady(a, 13, km)].forEach(d => {
      const total = /@@T:([\d.]+)@@/.exec(d);
      assert.ok(total, 'no total at ' + km);
      assert.equal(parseFloat(total[1]), km, 'the stated total must be the day total');
    });
  });
});

// ---------------------------------------------------------------------------
// THE ARITHMETIC MUST NEVER BE IMPOSSIBLE
// ---------------------------------------------------------------------------
test('a warm-up is never as large as the session it warms up for', () => {
  const a = app();
  [2.5, 3, 3.5, 4, 4.5, 5, 6, 8, 12].forEach(km => {
    [hills(a, 5, 38, km), fartlek(a, 3, 2, km),
     progressive(a, 10, km), steady(a, 10, km)].forEach(d => {
      const m = /@@D:([\d.]+)@@/.exec(d);
      if (!m) return;
      const warm = parseFloat(m[1]);
      assert.ok(warm < km, `warm-up ${warm} must be smaller than the ${km}km session`);
      assert.ok(warm <= km * 0.6,
        `warm-up ${warm} leaves no room for the work in a ${km}km session`);
    });
  });
});

test('below the point where a number would be honest, the wording stays qualitative', () => {
  const a = app();
  [0.5, 1, 2, 2.4].forEach(km => {
    const d = hills(a, 3, 30, km);
    assert.ok(!/@@D:/.test(d),
      'naming a warm-up inside a ' + km + 'km session would be arithmetic theatre');
    assert.match(d, /Easy warm-up\./, 'but it still describes the structure');
  });
});

test('with no total available the wording is exactly what it was before', () => {
  // textFor() re-renders a stored prescription; rebuildWorkoutDay supplies the
  // total, but any caller that cannot must not produce a broken token.
  const a = app();
  [hills(a, 5, 38, null), fartlek(a, 4, 2, undefined),
   progressive(a, 13, 0), steady(a, 13, null)].forEach(d => {
    assert.ok(!/@@T:/.test(d), 'no dangling total token');
    assert.match(d, /Easy warm-up\./);
    assert.match(d, /Easy cool-down\.$/);
  });
});

// ---------------------------------------------------------------------------
// UNITS
// ---------------------------------------------------------------------------
test('the total converts with the athlete’s units and never contradicts itself', () => {
  const a = app();
  const desc = hills(a, 5, 38, 4.5);
  a.state.units = 'km';
  const km = a.resolveDesc(desc);
  a.state.units = 'mi';
  const mi = a.resolveDesc(desc);
  assert.match(km, /4\.5km total/);
  assert.match(mi, /mi total/, 'the total must convert like every other distance');
  assert.ok(!/km/.test(mi), 'a mile athlete must not be shown two unit systems at once');
  assert.ok(!/\bNaN\b|undefined/.test(mi));
});

test('the total tracks the day after rounding or a volume cap moves it', () => {
  const a = app();
  const desc = hills(a, 5, 38, 4.5);
  const synced = a.syncDescDistance('interval', desc, 5.2);
  assert.match(synced, /@@T:5\.2@@/,
    'a card reading 5.2km above a prescription reading 4.5km is the bug this avoids');
  assert.match(synced, /@@D:2@@/, 'while the warm-up segment stays the segment it was');
});

// ---------------------------------------------------------------------------
// CHARACTER PRESERVED
// ---------------------------------------------------------------------------
test('hill repeats still prescribe strong uphill work and full recovery', () => {
  const d = hills(app(), 5, 38, 4.5);
  assert.match(d, /5 x 38s strong uphill effort/);
  assert.match(d, /walk\/jog back down for full recovery/);
});

test('fartlek stays by feel — no pace target is smuggled in', () => {
  const d = fartlek(app(), 4, 2, 7);
  assert.match(d, /strong, controlled effort/);
  assert.match(d, /equal-time easy jog between/);
  assert.ok(!/pace/i.test(d), 'fartlek is deliberately not pace-prescribed');
});

test('progressive tempo still explains the progression', () => {
  const d = progressive(app(), 13, 5.5);
  assert.match(d, /building steadily/);
  assert.match(d, /by the final third/);
  assert.match(d, /13min continuous/);
});

test('steady tempo distinguishes the easy running from the sustained work', () => {
  const d = steady(app(), 13, 5.5);
  assert.match(d, /easy warm-up/i);
  assert.match(d, /13min continuous @ a strong, steady aerobic effort/);
  assert.match(d, /held unbroken/, 'the sustained part is what makes it steady');
});

test('the work itself is untouched — reps and durations pass straight through', () => {
  const a = app();
  assert.match(hills(a, 8, 45, 6), /8 x 45s/);
  assert.match(fartlek(a, 6, 3, 9), /6 x 3min/);
  assert.match(progressive(a, 25, 9), /25min continuous/);
  assert.match(steady(a, 30, 10), /30min continuous/);
});

// ---------------------------------------------------------------------------
// NO OTHER ARCHETYPE WAS LEFT VAGUE
// ---------------------------------------------------------------------------
test('every generated prescription either states quantities or needs none', () => {
  const a = app();
  const seen = {};
  ['5k', '10k', 'half', 'full', 'ultra'].forEach(dk => {
    [[30, 10], [60, 16], [80, 20]].forEach(([vol, wk]) => {
      const br = a.buildBlockWeeks(dk, vol, wk);
      const monday = a.addDays('2026-03-02', -a.isoWeekday('2026-03-02'));
      a.buildDaysFromWeeks(br, a.addDays(monday, wk * 7 - 1),
        { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 }, '2026-03-02', false)
        .forEach(d => { const k = d.prescription ? d.prescription.archetype : d.type;
                        if (!seen[k]) seen[k] = d.desc || ''; });
    });
  });

  // race is the race distance itself and shakeout is easy running end to end:
  // neither divides a total into work and recovery, so neither can leave an
  // athlete guessing. Every other prescription must carry a quantity.
  const NEEDS_NONE = ['race', 'shakeout', 'rest'];
  const vague = Object.keys(seen)
    .filter(k => NEEDS_NONE.indexOf(k) === -1)
    .filter(k => !/@@[DT]:/.test(seen[k]));
  assert.deepEqual(vague, [],
    'a structured session that names no quantity leaves the athlete to guess');
  ['hill_repeats', 'fartlek', 'progressive_tempo', 'steady_tempo'].forEach(k =>
    assert.ok(seen[k] !== undefined && /@@T:/.test(seen[k]),
      k + ' must reach the generator with a total'));
});
