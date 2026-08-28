'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* BLOCK INTELLIGENCE COMPARES EFFORT WITHIN TYPE TOO
 * ===========================================================================
 * WHAT THIS FINISHES. test/rpeWithinType.test.js established the law -- a
 * session is measured against its OWN prescribed band before anything is
 * compared -- and applied it to athleteTrends(). blockDimensions() was still
 * pooling RAW RPE in the fallback that decides the "Quality session response"
 * row, and that fallback is reached precisely when the trend layer is silent.
 *
 * THE DEFECT IT LEAVES BEHIND. `fams` mixes prescribed bands that do not
 * agree: tempo and threshold at 6-8, intervals and repetitions at 7-9, and
 * easy_strides -- an 'interval' by type -- at 2-5. Comparing the raw numbers
 * measures which sessions the block happened to contain. Swept across 28
 * consecutive days, an athlete who logged every single session at the midpoint
 * of its own prescribed band was told "Quality work is costing more, or
 * landing further from prescription, than earlier in the block" on EIGHT of
 * them. Nothing about that athlete's effort had changed.
 *
 * THE THING WORTH CHECKING ABOUT A CHANGE LIKE THIS is that the detector is
 * not simply being switched off, and here that needed care, because the trend
 * layer takes precedence over this fallback: any fixture whose rise the trend
 * layer also sees proves nothing about the fallback at all. Every "still
 * fires" test below therefore uses an athlete the TREND layer is silent about,
 * and asserts that the quality row speaks anyway -- with byExec pinned flat,
 * so the verdict can only have come from the reading under test.
 */

const QUALITY = ['tempo', 'threshold', 'interval', 'repetition'];
const mid = b => Math.round((b[0] + b[1]) / 2);

/* A 12-week block with 35 days behind it, every session logged at the middle
   of its own prescribed band and on its pace target, so RPE deviation is the
   only variable. `shape(i, n)` offsets the i-th of n quality sessions. */
function block(shape, day){
  const app = loadApp({ pinnedDate: (day || '2026-09-03') + 'T09:00:00Z' });
  const { days } = buildPlan(app, { startDate: app.addDays(app.todayStr(), -35), weeks: 12 });
  const done = days.filter(d => d.date <= app.todayStr() && d.type !== 'rest');
  const n = done.filter(d => QUALITY.includes(d.type)).length;
  let i = 0;
  done.forEach(dd => {
    const band = app.expectedRPEBand(dd);
    const t = app.executionPaceTarget(dd), z = app.executionHRTarget(dd);
    let rpe = band ? mid(band) : 5;
    if (QUALITY.includes(dd.type)) rpe = Math.min(10, Math.max(1, rpe + (shape ? shape(i++, n) : 0)));
    dd.completed = true;
    dd.actual = {
      km: dd.km,
      pace: t ? app.secToPace((t.slow + t.fast) / 2) : null,
      hr: z && z.lo != null ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 20)) / 2) : null,
      rpe: rpe, notes: '',
    };
  });
  return app;
}
const onPrescription = () => 0;
const qualityRow = app => (app.blockEffectivenessCompute().dimensions || [])
  .filter(d => d.id === 'quality')[0];
/* Trends the block layer would defer to. blockTrend() ignores anything with
   insufficient confidence, so this mirrors its filter rather than guessing. */
const preemptingTrend = app => app.athleteTrends()
  .filter(t => /^rpe_(elevated|lower)_quality$/.test(t.id) && t.confidence !== 'insufficient')[0] || null;

/* Elevated in the LATE half of the 28-day block, but NOT in the last three
   quality sessions. That gap is the whole point: athleteTrends() judges the
   last three against a 42-day median and stays silent, while the 28-day block
   comparison sees the late half sitting above the early half. It is the only
   shape that can exercise this fallback without the trend layer answering
   first. */
const lateBlockRise  = amount => (i, n) => (i === n - 4 || i === n - 3) ? amount : 0;
const midBlockThenBack = (i, n) => (i >= n - 6 && i <= n - 4) ? 1 : 0;

// ---------------------------------------------------------------------------
// THE DEFECT: A SESSION-TYPE MIX READ AS A BLOCK GETTING HARDER
// ---------------------------------------------------------------------------
test('an athlete who logs every session on prescription is never told the block is costing more', () => {
  const seen = new Set();
  for (let d = 1; d <= 28; d++){
    const row = qualityRow(block(onPrescription, '2026-09-' + String(d).padStart(2, '0')));
    seen.add(row ? String(row.direction) : 'absent');
  }
  /* Length and join, not deepEqual: these values cross the VM sandbox
     boundary, where a structural comparison fails on prototype identity. */
  assert.equal([...seen].join('/'), 'flat',
    'the quality row still moves with the session mix: ' + [...seen].sort().join(', '));
});

test('the block genuinely mixes prescribed bands, so the fixture could expose the defect', () => {
  /* Guards the test above from becoming vacuous. If a future generator gave
     every quality session the same band, "no false verdict" would be true for
     a reason that has nothing to do with this fix. */
  const app = block(onPrescription);
  const qual = app.blockRecords().filter(r => QUALITY.includes(r.type));
  assert.ok(qual.length >= 4, 'too few quality sessions in the block window: ' + qual.length);
  const mids = new Set(qual.map(r => app.rpeBandMid(r.rpeBand)));
  assert.ok(mids.size >= 2,
    'every quality session shared one prescribed band, so nothing was pooled: ' + [...mids].join(', '));
  qual.forEach(r => assert.equal(app.rpeDeviation(r), 0,
    'an on-prescription ' + r.type + ' did not read as on-prescription'));
});

// ---------------------------------------------------------------------------
// THE DETECTOR IS NOT SWITCHED OFF
// ---------------------------------------------------------------------------
test('a rise the trend layer cannot see is still reported by the block', () => {
  const app = block(lateBlockRise(2));
  assert.equal(preemptingTrend(app), null,
    'the trend layer answered first, so this fixture proves nothing about the fallback');
  const row = qualityRow(app);
  assert.ok(row, 'the quality row was not produced at all');
  assert.equal(row.direction, 'negative', 'a genuine mid-block rise went unreported');
  assert.match(row.detail, /costing more/);
});

test('and it is the effort reading that says so, not execution score', () => {
  /* Attribution. Without this the test above would pass just as happily if the
     verdict came from byExec and the effort reading were dead. */
  const app = block(lateBlockRise(2));
  const qual = app.blockRecords().filter(r => QUALITY.includes(r.type));
  assert.equal(app.blockDirection(qual, r => r.executionScore, false, 5), 'flat',
    'execution score moved too, so the quality verdict cannot be attributed to effort');
  assert.equal(app.blockDirection(qual, r => app.rpeDeviation(r), true, 0.5, true), 'negative',
    'the normalised effort reading did not detect the rise');
});

test('a one-point rise is enough, exactly as it was before normalising', () => {
  const app = block(lateBlockRise(1));
  assert.equal(preemptingTrend(app), null);
  assert.equal(qualityRow(app).direction, 'negative',
    'normalising raised the bar a genuine rise has to clear');
});

test('effort coming back down inside the block is read as improvement, not silence', () => {
  const app = block(midBlockThenBack);
  assert.equal(preemptingTrend(app), null);
  assert.equal(qualityRow(app).direction, 'positive');
  assert.match(qualityRow(app).detail, /lower relative cost/);
});

// ---------------------------------------------------------------------------
// THE ZERO-BASELINE TRAP — the reason this is not a one-line substitution
// ---------------------------------------------------------------------------
test('a baseline of zero is a real baseline on the deviation scale', () => {
  /* blockDirection() rejects a median of zero, which is right for heart-rate
     cost, raw RPE and execution score -- zero there means no measurement. On
     the deviation scale zero is what an athlete who did exactly what was asked
     reads, so the old guard would have made this reading permanently blind for
     precisely the athletes it matters most for. Substituting rpeDeviation()
     without this would have looked like a fix and been an off switch. */
  const app = loadApp({ pinnedDate: '2026-09-03T09:00:00Z' });
  const at = (d, v) => ({ date: '2026-08-' + String(d).padStart(2, '0'), v: v });
  const rise = [at(1,0), at(2,0), at(3,0), at(4,0), at(5,2), at(6,2), at(7,2), at(8,2)];
  const pick = r => r.v;
  assert.equal(app.blockDirection(rise, pick, true, 0.5, true), 'negative',
    'an unambiguous rise from a zero baseline was discarded');
  assert.equal(app.blockDirection(rise, pick, true, 0.5), null,
    'the original guard no longer applies to callers that did not ask for the change');
});

test('the zero-baseline opt-in reads in both directions and still recognises flat', () => {
  const app = loadApp({ pinnedDate: '2026-09-03T09:00:00Z' });
  const at = (d, v) => ({ date: '2026-08-' + String(d).padStart(2, '0'), v: v });
  const pick = r => r.v;
  const drop = [at(1,0), at(2,0), at(3,0), at(4,0), at(5,-2), at(6,-2), at(7,-2), at(8,-2)];
  const flat = [at(1,0), at(2,0), at(3,0), at(4,0), at(5,0),  at(6,0),  at(7,0),  at(8,0)];
  assert.equal(app.blockDirection(drop, pick, true, 0.5, true), 'positive');
  assert.equal(app.blockDirection(flat, pick, true, 0.5, true), 'flat',
    'a zero baseline that never moved should be flat, not a direction');
});

test('every other caller of blockDirection keeps the guard it was written with', () => {
  /* The change is opt-in. Heart-rate cost, execution score and long-run RPE
     must behave exactly as they did, including their rejection of a zero
     median, or this became a shared-semantics change rather than a narrow one. */
  const src = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  /* Line-scanned rather than pattern-matched across the file: every call site
     is one statement on one line, and the picks contain semicolons of their
     own, which a naive expression swallows. */
  const calls = src.split('\n')
    .filter(l => l.includes('blockDirection(') && !/function blockDirection/.test(l) && /=\s*blockDirection\(/.test(l))
    .map(l => l.trim());
  assert.equal(calls.length, 4, 'the set of blockDirection call sites changed:\n' + calls.join('\n'));
  const optedIn = calls.filter(c => /,\s*true\s*\);$/.test(c));
  assert.equal(optedIn.length, 1,
    'exactly one call site should opt into a real zero baseline:\n' + optedIn.join('\n'));
  assert.match(optedIn[0], /rpeDeviation/,
    'the opted-in call is no longer the deviation reading: ' + optedIn[0]);
  calls.filter(c => c !== optedIn[0]).forEach(c => {
    assert.ok(!/rpeDeviation/.test(c),
      'a second call site started using deviations without its own review: ' + c);
    assert.ok(/,\s*(true|false),\s*[0-9.]+\);$/.test(c),
      'an existing caller gained an argument it did not ask for: ' + c);
  });
});

// ---------------------------------------------------------------------------
// SCALE
// ---------------------------------------------------------------------------
test('the 0.5 threshold still means half an RPE point', () => {
  /* A deviation is measured in RPE points, so the existing threshold needed no
     retuning -- and a movement below it must still read flat. */
  const app = loadApp({ pinnedDate: '2026-09-03T09:00:00Z' });
  const at = (d, v) => ({ date: '2026-08-' + String(d).padStart(2, '0'), v: v });
  const pick = r => r.v;
  // late median 0.25 against an early median of 0: below the bar.
  const tiny = [at(1,0), at(2,0), at(3,0), at(4,0), at(5,0), at(6,0.5), at(7,0), at(8,0.5)];
  assert.equal(app.blockDirection(tiny, pick, true, 0.5, true), 'flat',
    'a movement smaller than half an RPE point was treated as a direction');
});
