'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* EFFORT IS COMPARED WITHIN SESSION TYPE, NOT ACROSS THE QUALITY POOL
 * ===========================================================================
 * THE DEFECT. "Quality" pools tempo, threshold, interval and repetition, and
 * their prescribed RPE bands are not the same -- tempo and threshold sit at
 * 6-8, intervals and repetitions at 7-9. The effort trend compared RAW RPE
 * across that pool, so a session logged exactly on prescription still differed
 * from a pooled median by a full point purely because of its TYPE.
 *
 * HOW IT SURFACED. A calendar-dependent CI failure: coachDecision() reported
 * evidenceCount 1 on Thursdays and 0 on every other weekday. The evidence was
 * "Effort has been above your usual on 2 of your last 3 quality sessions" --
 * a NEGATIVE trend, fired against an athlete who had logged every single
 * session exactly on prescription. Which weekday "today" fell on decided how
 * the completed sessions split into baseline and recent, and therefore whether
 * the recent window happened to hold intervals against a tempo-ish median.
 *
 * WHY IT MATTERED BEYOND THE TEST. The pooling is production logic. A real
 * athlete entering a phase with more interval work would read "effort above
 * your usual" when nothing about their effort had changed -- only the mix had.
 *
 * THE FIX. Each session is measured against its OWN prescribed band before
 * anything is compared. Zero means it landed where that session type was
 * expected to land. The mix cancels; the athlete remains.
 */

const QUALITY = ['tempo', 'threshold', 'interval', 'repetition'];
const mid = b => (b ? Math.round((b[0] + b[1]) / 2) : null);

/* Builds a 12-week block with 35 days already behind it, logging every
   completed session through a supplied RPE rule. Everything else is logged
   exactly on target, so RPE is the only variable. */
function block(day, rpeFor){
  const app = loadApp({ pinnedDate: day + 'T09:00:00Z' });
  const startDate = app.addDays(app.todayStr(), -35);
  const { days } = buildPlan(app, { startDate, weeks: 12 });
  const done = days.filter(d => d.date <= app.todayStr() && d.type !== 'rest');
  done.forEach(dd => {
    const band = app.expectedRPEBand(dd);
    const t = app.executionPaceTarget(dd), z = app.executionHRTarget(dd);
    dd.completed = true;
    dd.actual = {
      km: dd.km,
      pace: t ? app.secToPace((t.slow + t.fast) / 2) : null,
      hr: z && z.lo != null ? Math.round((z.lo + (z.hi != null ? z.hi : z.lo + 20)) / 2) : null,
      rpe: rpeFor(dd, band), notes: '',
    };
  });
  return app;
}
const onPrescription = (dd, band) => mid(band);
const trendIds = app => app.athleteTrends().filter(t => /^rpe_/.test(t.id)).map(t => t.id);

// ---------------------------------------------------------------------------
// THE NORMALISER
// ---------------------------------------------------------------------------
test('a session logged on its own prescription deviates by zero, whatever its type', () => {
  const a = block('2026-09-03', onPrescription);
  /* The two bands that caused the whole problem: 6-8 and 7-9. A 7 and an 8 are
     both exactly on prescription, and must read as identical effort. */
  assert.equal(a.rpeDeviation({ type: 'tempo', rpe: 7, rpeBand: [6, 8] }), 0);
  assert.equal(a.rpeDeviation({ type: 'interval', rpe: 8, rpeBand: [7, 9] }), 0);
  assert.equal(a.rpeDeviation({ type: 'threshold', rpe: 7, rpeBand: [6, 8] }), 0);
});

test('deviation is signed: harder than prescribed is positive, easier is negative', () => {
  const a = block('2026-09-03', onPrescription);
  assert.equal(a.rpeDeviation({ type: 'tempo', rpe: 9, rpeBand: [6, 8] }), 2);
  assert.equal(a.rpeDeviation({ type: 'tempo', rpe: 5, rpeBand: [6, 8] }), -2);
});

test('a record with no stored band falls back to its type, so history stays comparable', () => {
  /* An archived session written before the band was recorded must not be
     silently dropped from the athlete's own baseline. */
  const a = block('2026-09-03', onPrescription);
  assert.equal(a.rpeDeviation({ type: 'interval', rpe: 8 }), 0, 'an archived interval was mis-scaled');
  assert.equal(a.rpeDeviation({ type: 'tempo', rpe: 7 }), 0, 'an archived tempo was mis-scaled');
});

test('a record with no RPE, or no band for its type, yields no deviation', () => {
  const a = block('2026-09-03', onPrescription);
  assert.equal(a.rpeDeviation({ type: 'tempo', rpe: null }), null);
  assert.equal(a.rpeDeviation({ type: 'rest', rpe: 5 }), null);
  assert.equal(a.rpeDeviation(null), null);
});

// ---------------------------------------------------------------------------
// THE DEFECT ITSELF — no signal from a session-type mix
// ---------------------------------------------------------------------------
test('an athlete who logs every session on prescription is never told effort is up', () => {
  const a = block('2026-09-03', onPrescription);   // a Thursday: the failing day
  assert.ok(!trendIds(a).includes('rpe_elevated_quality'),
    'the session-type mix is still being read as rising effort');
  /* Length, not deepEqual: these arrays are built inside the VM sandbox and
     carry its Array prototype, so a structural comparison against a host []
     fails on identity alone. */
  assert.equal(a.coachDecision().reasons.length, 0,
    'reasons were reported: ' + a.coachDecision().reasons.join(' | '));
  assert.equal(a.coachDecision().evidenceCount, 0);
});

test('the verdict no longer depends on which weekday it is asked on', () => {
  /* The regression in one assertion. Every day of a fortnight, same athlete,
     same perfect logging: the answer must not move. */
  const seen = new Set();
  for (let d = 1; d <= 14; d++){
    const day = '2026-09-' + String(d).padStart(2, '0');
    const dec = block(day, onPrescription).coachDecision();
    seen.add(dec.state + '/' + dec.evidenceCount);
  }
  assert.deepEqual([...seen], ['proceed/0'],
    'the coaching verdict still moves with the calendar: ' + [...seen].join(', '));
});

// ---------------------------------------------------------------------------
// THE GENUINE SIGNAL SURVIVES — this is not the detector being switched off
// ---------------------------------------------------------------------------
test('a real rise in effort still fires, and still reads as negative', () => {
  let n = 0;
  const a = block('2026-09-03', (dd, band) =>
    QUALITY.includes(dd.type) ? mid(band) + (++n > 6 ? 2 : 0) : mid(band));
  const elevated = a.athleteTrends().filter(t => t.id === 'rpe_elevated_quality')[0];
  assert.ok(elevated, 'a genuine rise in quality effort went unreported');
  assert.equal(elevated.direction, 'negative');
  assert.match(elevated.detail, /above your usual/);
});

test('a real drop in effort still fires, and still reads as positive', () => {
  let n = 0;
  const a = block('2026-09-03', (dd, band) =>
    QUALITY.includes(dd.type) ? Math.max(1, mid(band) - (++n > 6 ? 2 : 0)) : mid(band));
  const lower = a.athleteTrends().filter(t => t.id === 'rpe_lower_quality')[0];
  assert.ok(lower, 'a genuine drop in quality effort went unreported');
  assert.equal(lower.direction, 'positive');
});

test('a rise confined to one session type is still seen, not cancelled by the others', () => {
  /* Normalising must not average a real problem away: intervals costing more
     than intervals should cost is exactly the signal worth keeping. */
  let n = 0;
  const a = block('2026-09-03', (dd, band) =>
    dd.type === 'interval' ? mid(band) + (++n > 2 ? 3 : 0) : mid(band));
  assert.ok(trendIds(a).includes('rpe_elevated_quality'),
    'a rise inside one session type was normalised out of existence');
});

// ---------------------------------------------------------------------------
// THE BAND TRAVELS WITH THE RECORD
// ---------------------------------------------------------------------------
test('the athlete memory carries what each session was expected to cost', () => {
  const a = block('2026-09-03', onPrescription);
  const mem = a.athleteMemory(42).filter(r => r.completed && QUALITY.includes(r.type));
  assert.ok(mem.length >= 4, 'too few quality sessions to check: ' + mem.length);
  mem.forEach(r => {
    assert.ok(Array.isArray(r.rpeBand) && r.rpeBand.length === 2,
      'a memory record lost its prescribed band: ' + r.type + '@' + r.date);
    assert.equal(a.rpeDeviation(r), 0,
      'an on-prescription ' + r.type + ' did not read as on-prescription');
  });
});
