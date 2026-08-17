'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// Plan Evolution will not create two demanding sessions on consecutive days.
// stackedQualityPairs() is the definition it uses, and evolutionChanges()
// checks it against the ORIGINAL plan too, so a stacking the methodology
// deliberately intended is never "fixed" and one evolution would create is
// never allowed.
//
// A manual swap had no such check. An athlete dragging Thursday's threshold
// onto the day after Saturday's long run could build, by hand, exactly the
// compression the adaptive engine refuses to build for them -- and nothing
// said a word.
//
// The guard reuses stackedQualityPairs(). No second "hard workout" taxonomy:
// two definitions of a hard day is how the coach and the calendar end up
// disagreeing about the same week.
//
// It compares stacking BEFORE against stacking AFTER, and only speaks when the
// swap makes it worse. That matters more than it looks: a block can legitimately
// ship with a stacked pair in it, and an athlete must not be nagged every time
// they touch a plan that was always like that.
//
// And it warns rather than refuses. The athlete is the final authority on their
// own week; the coach's job is to make sure they knew.
/* Arrays returned from the app carry the VM sandbox's own Array.prototype, so
   assert.deepStrictEqual fails on prototype identity even when both sides are
   empty. Stacking is asserted by length throughout, which is the fact these
   tests are actually about. */
const TODAY = '2026-05-20';
const app = () => loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
const D = n => {
  const d = new Date(Date.UTC(2026, 4, 20) + n * 86400000);
  return d.toISOString().slice(0, 10);
};
function day(date, type, km, extra) {
  return Object.assign({ id: date, date, type, km, mpSegment: false }, extra || {});
}

/* A plan whose calendar is stated day by day, so what is adjacent to what is
   visible in the test rather than buried in a generator. */
function withDays(a, days) {
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -7) });
  a.state.days = days;
  let asked = null;
  a.confirm = msg => { asked = msg; return true; };
  return { get asked(){ return asked; } };
}

// ---------------------------------------------------------------------------
// THE DEFECT
// ---------------------------------------------------------------------------
test('a swap that puts a threshold beside intervals is questioned', () => {
  const a = app();
  const seen = withDays(a, [
    day(D(1), 'interval', 9),
    day(D(2), 'easy', 6),
    day(D(3), 'rest', 0),
    day(D(4), 'threshold', 10)
  ]);
  assert.equal(a.stackedQualityPairs(a.state.days).length, 0, 'the plan starts clean');

  a.doSwapDays(D(2), D(4));      // threshold lands the day after the intervals
  assert.ok(seen.asked, 'the athlete must be told they are compressing two quality days');
  assert.match(seen.asked, /back-to-back|consecutive|two hard|recovery/i);
  assert.equal(a.stackedQualityPairs(a.state.days).length, 1,
    'and the swap still happens, because they said yes');
});

test('a swap that puts a threshold the day after a long run is questioned', () => {
  const a = app();
  const seen = withDays(a, [
    day(D(1), 'long', 20),        // KEY by distance
    day(D(2), 'easy', 6),
    day(D(5), 'threshold', 10)
  ]);
  assert.equal(a.stackedQualityPairs(a.state.days).length, 0);
  a.doSwapDays(D(2), D(5));
  assert.ok(seen.asked, 'a long run is a demanding session even though it is not "quality"');
});

test('declining leaves the plan exactly as it was', () => {
  const a = app();
  withDays(a, [
    day(D(1), 'interval', 9),
    day(D(2), 'easy', 6),
    day(D(4), 'threshold', 10)
  ]);
  a.confirm = () => false;
  a.doSwapDays(D(2), D(4));
  assert.equal(a.findDay(D(2)).type, 'easy', 'nothing moves when the athlete says no');
  assert.equal(a.findDay(D(4)).type, 'threshold');
  assert.equal(a.stackedQualityPairs(a.state.days).length, 0);
});

// ---------------------------------------------------------------------------
// ONLY WHEN IT GETS WORSE
// ---------------------------------------------------------------------------
test('a harmless swap is never questioned', () => {
  const a = app();
  const seen = withDays(a, [
    day(D(1), 'easy', 6),
    day(D(2), 'easy', 8),
    day(D(4), 'threshold', 10)
  ]);
  a.doSwapDays(D(1), D(2));
  assert.equal(seen.asked, null, 'swapping two easy runs is nobody\'s business but the athlete\'s');
  assert.equal(a.findDay(D(1)).km, 8, 'and it happens');
});

test('a plan that always had a stack stays editable without nagging', () => {
  // The methodology genuinely ships stacked pairs. An athlete rearranging the
  // easy days around one must not be interrogated about a pairing they did
  // not create and are not changing.
  const a = app();
  const seen = withDays(a, [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),     // the intended stack
    day(D(4), 'easy', 6),
    day(D(5), 'easy', 8)
  ]);
  assert.equal(a.stackedQualityPairs(a.state.days).length, 1, 'it was always like this');
  a.doSwapDays(D(4), D(5));
  assert.equal(seen.asked, null, 'unchanged stacking is not a new problem');
  assert.equal(a.stackedQualityPairs(a.state.days).length, 1);
});

test('a swap that IMPROVES spacing is never questioned', () => {
  const a = app();
  const seen = withDays(a, [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),
    day(D(5), 'easy', 6)
  ]);
  a.doSwapDays(D(2), D(5));       // pull the intervals away from the threshold
  assert.equal(seen.asked, null);
  assert.equal(a.stackedQualityPairs(a.state.days).length, 0,
    'the athlete just fixed something and was not thanked with a dialog');
});

test('rest and easy exchanges are silent', () => {
  const a = app();
  const seen = withDays(a, [
    day(D(1), 'threshold', 10),
    day(D(2), 'rest', 0),
    day(D(3), 'easy', 6)
  ]);
  a.doSwapDays(D(2), D(3));
  assert.equal(seen.asked, null, 'moving a rest day next to a threshold is not a stack');
});

// ---------------------------------------------------------------------------
// THE ENGINE'S OWN DEFINITION, NOT A SECOND ONE
// ---------------------------------------------------------------------------
test('the guard reuses stackedQualityPairs and invents no taxonomy', () => {
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const at = src.indexOf('function swapWorsensQualitySpacing(');
  assert.ok(at !== -1, 'the guard must exist');
  const body = src.slice(at, src.indexOf('\n}', at));
  assert.match(body, /stackedQualityPairs\(/,
    'two definitions of a hard day is how the coach and the calendar end up disagreeing');
  assert.ok(!/'threshold'|'interval'|'repetition'|'tempo'/.test(body),
    'a hard-coded list here would drift from sessionImportance() the first time it changed');
});

test('the comparison is a diff, not a snapshot', () => {
  const a = app();
  a.state = a.makeDefaultState();
  a.state.days = [
    day(D(1), 'threshold', 10),
    day(D(2), 'interval', 9),
    day(D(4), 'easy', 6),
    day(D(5), 'easy', 8)
  ];
  assert.equal(a.swapWorsensQualitySpacing(a.findDay(D(4)), a.findDay(D(5))), false,
    'an existing stack elsewhere must not make every unrelated swap a warning');
});

test('a swap between two past days raises nothing', () => {
  const a = app();
  const seen = withDays(a, [
    day(a.addDays(TODAY, -5), 'interval', 9),
    day(a.addDays(TODAY, -4), 'easy', 6),
    day(a.addDays(TODAY, -3), 'threshold', 10)
  ]);
  a.doSwapDays(a.addDays(TODAY, -4), a.addDays(TODAY, -3));
  assert.equal(seen.asked, null,
    'training that already happened cannot be spaced differently by warning about it now');
});

// ---------------------------------------------------------------------------
// NOTHING THE SWAP ALREADY PROTECTED IS WEAKENED
// ---------------------------------------------------------------------------
test('a logged session still cannot move onto a future date', () => {
  const a = app();
  const seen = withDays(a, [
    day(a.addDays(TODAY, -2), 'interval', 9, {
      completed: true, actual: { km: 9, pace: '4:20', hr: 165, rpe: 7, notes: '' } }),
    day(D(3), 'easy', 6)
  ]);
  const toasts = [];
  a.showToast = m => toasts.push(m);
  a.doSwapDays(a.addDays(TODAY, -2), D(3));
  assert.match(toasts.join(' '), /can.t swap/i, 'the hard refusal still comes first');
  assert.equal(seen.asked, null, 'and no other question is asked about a swap that will not happen');
  assert.equal(a.findDay(a.addDays(TODAY, -2)).type, 'interval');
});

test('a logged swap still asks its own question, and the two never pile up', () => {
  /* They cannot co-occur: a logged day swapping with a FUTURE day is refused
     outright above, so any swap that reaches the logged confirmation has both
     days at or before today -- where the spacing guard, which looks only at
     training still to come, has nothing to say. */
  const a = app();
  const asked = [];
  const past = n => a.addDays(TODAY, -n);
  buildPlan(a, { weeks: 10, startDate: a.addDays(TODAY, -14) });
  a.state.days = [
    day(past(3), 'interval', 9, { completed: true,
      actual: { km: 9, pace: '4:20', hr: 165, rpe: 7, notes: '' } }),
    day(past(2), 'easy', 6)
  ];
  a.confirm = m => { asked.push(m); return true; };
  a.doSwapDays(past(3), past(2));
  assert.equal(asked.length, 1, 'one question, about the logged run');
  assert.match(asked[0], /logged run/i);
});

test('the workout travels intact through a confirmed swap', () => {
  const a = app();
  withDays(a, [
    day(D(1), 'interval', 9),
    day(D(2), 'easy', 6, { desc: 'easy desc', prescription: { v: 1, archetype: 'easy_run', params: {} } }),
    day(D(4), 'threshold', 10, { desc: 'thr desc', mpSegment: true,
      prescription: { v: 1, archetype: 'steady_tempo', params: {} } })
  ]);
  a.doSwapDays(D(2), D(4));
  const moved = a.findDay(D(2));
  assert.equal(moved.type, 'threshold');
  assert.equal(moved.desc, 'thr desc');
  assert.equal(moved.mpSegment, true);
  assert.equal(moved.prescription.archetype, 'steady_tempo',
    'a warning must not become a second, lossier swap path');
});
