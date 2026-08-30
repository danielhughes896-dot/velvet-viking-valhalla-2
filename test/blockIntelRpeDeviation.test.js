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
  /* THE ATHLETE THIS FILE IS ABOUT HAS EARNED THEIR SECOND QUALITY SESSION,
     and now has to say so. The defect under test is that blockDimensions()
     POOLED RAW RPE ACROSS DIFFERENT PRESCRIBED BANDS, which requires a block
     containing sessions from different bands; an athlete absorbing two quality
     sessions a week is exactly the athlete whose block contains them. Since
     quality frequency became earned rather than granted by the day count, a
     fixture that says nothing about the athlete's response gets one a week --
     three or four in the block window, against shapes that need eight, and
     every "still fires" test below became vacuous. */
  const { days } = buildPlan(app, { startDate: app.addDays(app.todayStr(), -35),
                                    weeks: 12, earnedSecondQuality: true });
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
const lateBlockRise = amount => (i, n) => (i === n - 4 || i === n - 3) ? amount : 0;
/* The four shapes the return-to-normal distinction turns on, all of them
   invisible to the trend layer for the reason above. Deviations as the block
   comparison sees them are given alongside each. */
const elevatedThenExpected     = (i, n) => (i >= n - 8 && i <= n - 5) ? 2 : 0;          // 2,2,2,2,0,0,0,0
const elevatedThenLessElevated = (i, n) => (i >= n - 8 && i <= n - 5) ? 2 : (i >= n - 4 ? 1 : 0); // 2,2,2,2,1,1,1,1
const expectedThenBelow        = lateBlockRise(-1);                                      // 0,0,0,0,-1,-1,0,0

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

// ---------------------------------------------------------------------------
// RETURN TO NORMAL IS NOT AN IMPROVEMENT
//   The rule athleteTrends() already enforces on this same reading: "Lower
//   effort than lately is only ADAPTATION if it is also lower than the effort
//   this athlete has established. After a hard stretch, coming back to normal
//   is not the same work feeling easier." On the deviation scale that rule
//   gains an anchor the raw scale never had -- zero is what was prescribed --
//   so improvement means landing BELOW what was asked, not nearer to it.
// ---------------------------------------------------------------------------
test('an elevated block returning to what was prescribed is normalisation, not improvement', () => {
  /* +2 for the first half of the block, exactly on prescription for the
     second. The slope points down and the athlete is recovering, but quality
     work has not become cheaper than it was asked to be. */
  const app = block(elevatedThenExpected);
  assert.equal(preemptingTrend(app), null,
    'the trend layer answered first, so this proves nothing about the fallback');
  assert.notEqual(qualityRow(app).direction, 'positive',
    'a return to prescription was reported as quality work getting cheaper');
  assert.equal(qualityRow(app).direction, 'flat');
});

test('a block still above prescription is not improving merely because the slope points down', () => {
  /* +2 falling to +1. Better than it was, still more expensive than it was
     meant to be. */
  const app = block(elevatedThenLessElevated);
  assert.equal(preemptingTrend(app), null);
  assert.notEqual(qualityRow(app).direction, 'positive',
    'a still-elevated block was called an improvement on slope alone');
  assert.equal(qualityRow(app).direction, 'flat');
});

test('quality work landing genuinely below prescription IS an improvement', () => {
  /* The other side of the same rule -- the guard must not swallow a real one.
     On prescription throughout, then below it in the late block. */
  const app = block(expectedThenBelow);
  assert.equal(preemptingTrend(app), null);
  const row = qualityRow(app);
  assert.equal(row.direction, 'positive',
    'work genuinely cheaper than prescribed went unreported');
  assert.match(row.detail, /lower relative cost/);
});

test('and it is the effort reading that says so in each case, not execution score', () => {
  /* Attribution for all three above at once: execution score must be flat, so
     none of those verdicts can have come from anywhere but the reading under
     test. */
  [['elevated -> expected', elevatedThenExpected, 'flat'],
   ['elevated -> less elevated', elevatedThenLessElevated, 'flat'],
   ['expected -> below expected', expectedThenBelow, 'positive']].forEach(c => {
    const app = block(c[1]);
    const qual = app.blockRecords().filter(r => QUALITY.includes(r.type));
    assert.equal(app.blockDirection(qual, r => r.executionScore, false, 5), 'flat',
      c[0] + ': execution score moved too, so the verdict cannot be attributed to effort');
    assert.equal(app.blockDirection(qual, r => app.rpeDeviation(r), true, 0.5, true), c[2],
      c[0] + ': the effort reading did not give the verdict under test');
  });
});

test('deterioration is untouched by the guard, from any starting point', () => {
  /* The rule applies to the improving path only. A block getting more
     expensive is a block getting more expensive wherever it started. */
  const app = block(lateBlockRise(2));
  assert.equal(qualityRow(app).direction, 'negative');
  /* +1 throughout, worsening to +2 in the middle of the late half and easing
     back at the very end -- deviations 1,1,1,1,2,2,1,1 as the block sees them.
     The tail is what keeps the trend layer out of it. */
  const stillWorse = block((i, n) => (i >= n - 8 && i <= n - 5) ? 1
                                   : ((i === n - 4 || i === n - 3) ? 2 : (i >= n - 2 ? 1 : 0)));
  assert.equal(preemptingTrend(stillWorse), null,
    'the trend layer answered first, so this proves nothing about the fallback');
  const qual = stillWorse.blockRecords().filter(r => QUALITY.includes(r.type));
  assert.equal(stillWorse.blockDirection(qual, r => r.executionScore, false, 5), 'flat',
    'execution score moved too, so the verdict cannot be attributed to effort');
  assert.equal(qualityRow(stillWorse).direction, 'negative',
    'a block deteriorating from an already-elevated start stopped being reported');
});

test('the guard reuses minChange rather than introducing a threshold of its own', () => {
  /* athleteTrends() clears the SAME 1-point bar twice -- once against the
     recent baseline, once against trendEstablished(). This clears minChange
     twice for the same reason, so sensitivity stays one number. */
  const app = loadApp({ pinnedDate: '2026-09-03T09:00:00Z' });
  const at = (d, v) => ({ date: '2026-08-' + String(d).padStart(2, '0'), v: v });
  const pick = r => r.v;
  const to = v => [at(1,0), at(2,0), at(3,0), at(4,0), at(5,v), at(6,v), at(7,v), at(8,v)];
  assert.equal(app.blockDirection(to(-0.5), pick, true, 0.5, true), 'positive',
    'exactly minChange below prescription should read as improvement');
  assert.equal(app.blockDirection(to(-0.25), pick, true, 0.5, true), 'flat',
    'less than minChange below prescription is not yet improvement');
  /* And the established-level clause, which is the half ported verbatim: an
     athlete who had established -3 and is now at -2 is below prescription but
     ABOVE their own established level, so this is not improvement either. */
  const wasBetter = [at(1,-3), at(2,-3), at(3,0), at(4,0), at(5,-2), at(6,-2), at(7,-2), at(8,-2)];
  assert.equal(app.blockDirection(wasBetter, pick, true, 0.5, true), 'flat',
    'a fall short of what this athlete had established was called an improvement');
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
test('the return-to-normal guard cannot reach a caller reading a raw scale', () => {
  /* WRITTEN BECAUSE A MUTATION SURVIVED. Dropping `&& deviationScale` -- so the
     guard applies to heart-rate cost, execution score and long-run raw RPE too
     -- passed every other test here, because they all check the call sites'
     ARGUMENTS rather than the guard's REACH. It is not a harmless leak: the
     below-prescription clause asks whether the late median is at least
     minChange below ZERO, and a raw RPE of 6 or a heart-rate cost of 40 never
     is, so every improving raw reading in the app would silently flatten. */
  const app = loadApp({ pinnedDate: '2026-09-03T09:00:00Z' });
  const at = (d, v) => ({ date: '2026-08-' + String(d).padStart(2, '0'), v: v });
  const pick = r => r.v;
  const rawImproving = [at(1,8), at(2,8), at(3,8), at(4,8), at(5,6), at(6,6), at(7,6), at(8,6)];
  assert.equal(app.blockDirection(rawImproving, pick, true, 0.5), 'positive',
    'a raw-scale improvement was suppressed by a guard written for deviations');
  const costImproving = [at(1,42), at(2,42), at(3,42), at(4,42), at(5,38), at(6,38), at(7,38), at(8,38)];
  assert.equal(app.blockDirection(costImproving, pick, true, 1.5), 'positive',
    'an easy-cost improvement was suppressed by a guard written for deviations');
  const scoreImproving = [at(1,60), at(2,60), at(3,60), at(4,60), at(5,80), at(6,80), at(7,80), at(8,80)];
  assert.equal(app.blockDirection(scoreImproving, pick, false, 5), 'positive',
    'an execution-score improvement was suppressed by a guard written for deviations');
});

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
