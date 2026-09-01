'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const LP = require('./audit/loadProgression.js');
const { auditCase } = require('./audit/planAudit.js');

/* THE WEEKLY LOAD PROGRESSION INSTRUMENT.
 * ===========================================================================
 * The measure this replaces asked one question of every week -- did the total
 * rise more than ten per cent -- and answered it the same way whether the
 * athlete added one kilometre or eight. These tests hold the four things that
 * make the replacement worth having:
 *
 *   1. IT SEES DENOMINATORS.       6 -> 7km is +1km and a rounding step on a
 *                                  long run. Reported, never a verdict.
 *   2. IT SEES ABSOLUTES.          80 -> 88km is +8km and exactly ten per
 *                                  cent. A percentage rule calls it fine.
 *   3. IT SEES BREADTH.            the same total increase means different
 *                                  things depending on how many of the
 *                                  athlete's load levers produced it.
 *   4. IT CAN FAIL.                fixtures no generator produced, built to be
 *                                  bad, and it catches them.
 *
 * Every threshold it uses already existed: VOLUME_BLOCK_GROWTH_CAP as the
 * ordinary step, SESSION_TWO_WEEK_GROWTH_CAP (Nielsen) as the two-week
 * backstop, CUTBACK_FACTOR as what a cutback is, and the presentation quanta
 * a long run and an easy run are rounded to. There is no `>10% AND >X km`.
 */

const wk = LP.synthWeek;
const judge = (a, b, ctx) => LP.classify(LP.transitionBetween(a, b, ctx || {}));
const has = (t, code) => t.reasons.indexOf(code) !== -1;

/* ---------- 1. THE INSTRUMENT'S OWN SHAPE ---------- */

test('every threshold the instrument uses is one the runtime already had', () => {
  const src = require('fs').readFileSync(
    path.join(__dirname, 'audit', 'loadProgression.js'), 'utf8');
  /* CODE ONLY -- the prose above every rule quotes real measurements, and a
     number in a sentence is not a threshold. */
  const body = src.slice(src.indexOf('function lever('))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  /* No bare numeric thresholds in the judgement: the only literals permitted
     are 0, 1 and the 1e-9 comparison epsilons. A new magic number here would
     be exactly the cliff this instrument exists to avoid. */
  const literals = (body.match(/[^\w.]\d+\.\d+/g) || [])
    .map(s => s.trim()).filter(s => s !== '1e-9' && s !== '0.0');
  assert.deepEqual(literals.filter(s => s !== '1.10'), [],
    'unexpected numeric thresholds in the classifier: ' + literals.join(', '));
  assert.ok(!/GROWTH_ABSOLUTE_MIN|riskScore|>\s*2\s*&&|AND\s*>\s*\d/.test(body),
    'no absolute-kilometre cliff and no opaque score');
  assert.equal(LP.ORDINARY_STEP, 1.10, 'the ordinary step is VOLUME_BLOCK_GROWTH_CAP');
  assert.equal(LP.TWO_WEEK_CAP, 1.30, 'the backstop is SESSION_TWO_WEEK_GROWTH_CAP');
});

test('a suspicious transition always carries at least one named reason', () => {
  const c = auditCase({ distanceKey: 'full', volume: 30, weeks: 15, scheduleKey: 'd5' });
  LP.assess(c).forEach(t => {
    if (!t.reasons.length) return;
    t.reasons.forEach(r => assert.ok(LP.REASON_CODES.indexOf(r) !== -1,
      'unknown reason code ' + r));
  });
});

/* ---------- 2. SMALL DENOMINATOR — HQ's 6 -> 7 ---------- */

test('6 -> 7km is reported and is not a coaching concern', () => {
  const t = judge(
    wk({ week: 2, phase: 'Base', trainingKm: 6, longKm: 3, supportKm: 3, runDays: 2 }),
    wk({ week: 3, phase: 'Base', trainingKm: 7, longKm: 4, supportKm: 3, runDays: 2 }));
  assert.equal(t.absoluteKm, 1);
  assert.equal(t.relative, 1.17);
  assert.equal(t.growthOver10pct, true, 'the old measure still reports it');
  assert.deepEqual(t.leverNames, [], 'a long run moving one whole kilometre is one quantum');
  assert.deepEqual(t.reasons, [], 'and one quantum is not a training decision to review');
});

test('the real generator agrees: the 6km athlete is never coaching-suspicious for it', () => {
  const c = auditCase({ distanceKey: 'full', volume: 6, weeks: 15, scheduleKey: 'd5' });
  const t = LP.assess(c).filter(x => x.fromKm === 6 && x.toKm === 7)[0];
  assert.ok(t, 'the 6 -> 7 transition exists in the real plan');
  assert.equal(t.growthOver10pct, true);
  assert.deepEqual(t.reasons, []);
});

/* ---------- 3. SMALL BASE, REAL JUMP — HQ's 8 -> 12 ---------- */

test('8 -> 12km is not excused because the athlete is small', () => {
  const t = judge(
    wk({ week: 5, phase: 'Build', trainingKm: 8, longKm: 5, supportKm: 3, runDays: 2 }),
    wk({ week: 6, phase: 'Build', trainingKm: 12, longKm: 6, supportKm: 6, runDays: 3 }));
  assert.equal(t.absoluteKm, 4);
  assert.equal(t.relative, 1.5);
  assert.ok(t.leverNames.indexOf('running_days') !== -1, 'a third running day arrived');
  assert.ok(t.leverNames.indexOf('easy_support') !== -1, 'and the aerobic work stepped with it');
  assert.ok(has(t, 'STRUCTURE_INTRODUCED_WITH_DOSE_STEP'),
    'two decisions in one week: ' + t.reasons.join(','));
});

test('and the same +4km spread over one controlled lever reads differently', () => {
  const t = judge(
    wk({ week: 5, phase: 'Build', trainingKm: 40, longKm: 14, supportKm: 20, qualityKm: 6,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 6, phase: 'Build', trainingKm: 44, longKm: 15, supportKm: 23, qualityKm: 6,
         qualityCount: 1, runDays: 5 }));
  assert.equal(t.absoluteKm, 4);
  assert.ok(t.relative <= 1.10 + 1e-9, 'a tenth of the week rather than half of it');
  assert.deepEqual(t.reasons, [], 'ordinary development, not a load concern');
});

/* ---------- 4. HIGH VOLUME, MODEST PERCENTAGE — HQ's 80 -> 88 ---------- */

test('80 -> 88km is not waved through because the percentage is ten', () => {
  const t = judge(
    wk({ week: 5, phase: 'Build', trainingKm: 80, longKm: 28, supportKm: 44, qualityKm: 8,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 6, phase: 'Build', trainingKm: 88, longKm: 30, supportKm: 48, qualityKm: 10,
         qualityCount: 1, runDays: 5 }));
  assert.equal(t.absoluteKm, 8);
  assert.equal(t.relative, 1.1, 'exactly the ordinary step -- a percentage rule stops here');
  assert.equal(t.growthOver10pct, false, 'and the OLD measure does not even report it');
  assert.deepEqual(t.movedLevers, ['long_run', 'easy_support', 'quality_dose'],
    'but the long run, the aerobic work and the quality session all moved');
  assert.ok(has(t, 'BROAD_LOAD_INCREASE'), t.reasons.join(','));
});

test('the same 80km athlete developing one lever is not flagged', () => {
  const t = judge(
    wk({ week: 5, phase: 'Build', trainingKm: 80, longKm: 28, supportKm: 44, qualityKm: 8,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 6, phase: 'Build', trainingKm: 82, longKm: 30, supportKm: 44, qualityKm: 8,
         qualityCount: 1, runDays: 5 }));
  assert.equal(t.absoluteKm, 2);
  assert.deepEqual(t.movedLevers, ['long_run']);
  assert.deepEqual(t.reasons, [], 'one session developing inside its own rate is development');
});

test('but a long run outrunning its own progression rate is flagged on its own', () => {
  /* +4km in a week is 14% on the session, against a marathon session
     progression of min(VOLUME_BLOCK_GROWTH_CAP, sqrt(Nielsen)) = 10%. It is
     flagged even though the WEEK only moved 5%, because something else came
     down to pay for it -- which is a redistribution towards the hardest
     session the week contains. */
  const t = judge(
    wk({ week: 5, phase: 'Build', trainingKm: 80, longKm: 28, supportKm: 44, qualityKm: 8,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 6, phase: 'Build', trainingKm: 84, longKm: 32, supportKm: 44, qualityKm: 8,
         qualityCount: 1, runDays: 5 }));
  assert.ok(has(t, 'LONG_RUN_STEP_ABOVE_RATE'), t.reasons.join(','));
});

/* ---------- 5. COMPOUND PROGRESSION ---------- */

test('long run, quality and support all progressing together is compound load', () => {
  const t = judge(
    wk({ week: 6, phase: 'Build', trainingKm: 40, longKm: 14, supportKm: 20, qualityKm: 6,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 7, phase: 'Build', trainingKm: 50, longKm: 17, supportKm: 25, qualityKm: 8,
         qualityCount: 1, runDays: 5 }));
  assert.ok(t.leverCount >= 2, 'levers: ' + t.leverNames.join(','));
  assert.ok(has(t, 'COMPOUND_LOAD_PROGRESSION') || has(t, 'STRUCTURE_INTRODUCED_WITH_DOSE_STEP'),
    t.reasons.join(','));
});

test('a new running day, a new quality session and a longer long run at once', () => {
  const t = judge(
    wk({ week: 4, phase: 'Build', trainingKm: 30, longKm: 12, supportKm: 18, runDays: 3 }),
    wk({ week: 5, phase: 'Build', trainingKm: 44, longKm: 16, supportKm: 22, qualityKm: 6,
         qualityCount: 1, runDays: 5 }));
  assert.ok(t.leverNames.indexOf('quality_frequency') !== -1);
  assert.ok(t.leverNames.indexOf('running_days') !== -1);
  assert.ok(t.leverNames.indexOf('long_run') !== -1);
  assert.ok(has(t, 'STRUCTURE_INTRODUCED_WITH_DOSE_STEP'), t.reasons.join(','));
});

/* ---------- 6. QUALITY STRUCTURE VARIATION ---------- */

test('one quality session becoming a much bigger one is a load progression', () => {
  /* Quality FREQUENCY is unchanged -- the week still says "one quality day" --
     and a session count cannot see this at all. */
  const t = judge(
    wk({ week: 3, phase: 'Build', trainingKm: 24, longKm: 9, supportKm: 10, qualityKm: 5,
         qualityCount: 1, runDays: 4 }),
    wk({ week: 4, phase: 'Build', trainingKm: 29, longKm: 9, supportKm: 10, qualityKm: 10,
         qualityCount: 1, runDays: 4 }));
  assert.equal(t.before.qualityCount, t.after.qualityCount, 'still one quality day');
  assert.ok(has(t, 'QUALITY_STRUCTURE_STEP'), t.reasons.join(','));
});

test('the pool rotating inside a big week is not a load progression', () => {
  const t = judge(
    wk({ week: 3, phase: 'Build', trainingKm: 60, longKm: 22, supportKm: 33, qualityKm: 5,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 4, phase: 'Build', trainingKm: 61, longKm: 22, supportKm: 33, qualityKm: 6,
         qualityCount: 1, runDays: 5 }));
  assert.ok(!has(t, 'QUALITY_STRUCTURE_STEP'),
    'a kilometre on one session inside a 60km week did not move the athlete');
});

test('and it is measured on the session the athlete receives', () => {
  /* qualityKm comes from the written sessions, which since qualityDeliveredKm()
     is what the week is priced from too. A structure chain the week merely
     holds is not what this reads. */
  const c = auditCase({ distanceKey: 'full', volume: 34, weeks: 24, scheduleKey: 'd5' });
  const wkFive = LP.weekLoad(c.weeks[4]);
  const written = c.weeks[4].sessions
    .filter(s => ['tempo', 'threshold', 'interval', 'repetition', 'checkpoint'].indexOf(s.type) !== -1)
    .reduce((t2, s) => t2 + s.km, 0);
  assert.equal(wkFive.qualityKm, Math.round(written * 10) / 10);
});

/* ---------- 7. PHASE TRANSITION ---------- */

test('a phase transition is context, not immunity', () => {
  const t = judge(
    wk({ week: 6, phase: 'Build', trainingKm: 50, longKm: 18, supportKm: 26, qualityKm: 6,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 7, phase: 'Peak', trainingKm: 68, longKm: 26, supportKm: 32, qualityKm: 10,
         qualityCount: 1, runDays: 5 }));
  assert.equal(t.phaseTransition, true);
  assert.ok(t.reasons.length, 'Build -> Peak does not excuse +18km: ' + t.reasons.join(','));
});

test('a coherent phase transition is not flagged for being one', () => {
  const t = judge(
    wk({ week: 6, phase: 'Build', trainingKm: 50, longKm: 18, supportKm: 26, qualityKm: 6,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 7, phase: 'Peak', trainingKm: 51, longKm: 19, supportKm: 26, qualityKm: 6,
         qualityCount: 1, runDays: 5 }));
  assert.equal(t.phaseTransition, true);
  assert.deepEqual(t.reasons, [],
    'a phase changing, with every session inside its own rate, is the architecture');
});

/* ---------- 8. SHORT RUNWAY ---------- */

test('a compressed runway is labelled and is not exempt', () => {
  const c = auditCase({ distanceKey: 'full', volume: 80, weeks: 4, scheduleKey: 'd5' });
  const all = LP.assess(c);
  assert.ok(all.every(t => t.shortRunway), 'a four-week marathon block is compressed');
  const t = judge(
    wk({ week: 2, phase: 'Build', trainingKm: 70, longKm: 24, supportKm: 40, qualityKm: 6,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 3, phase: 'Peak', trainingKm: 92, longKm: 32, supportKm: 50, qualityKm: 10,
         qualityCount: 1, runDays: 5 }),
    { shortRunway: true });
  assert.equal(t.shortRunway, true);
  assert.ok(t.reasons.length, 'short runway does not license +22km: ' + t.reasons.join(','));
});

test('the corrected short-runway transition is seen at its real size', () => {
  /* 81.1 -> 95km was an accounting defect, not a training decision, and it is
     fixed. The instrument reads what the athlete now receives. */
  const c = auditCase({ distanceKey: 'full', volume: 80, weeks: 4, scheduleKey: 'd5' });
  const t = LP.assess(c).filter(x => x.toPhase === 'Peak')[0];
  assert.ok(t, 'the Peak entry exists');
  assert.ok(t.absoluteKm < 10,
    'the corrected step is ' + t.absoluteKm + 'km, not the 13.9 it used to be');
});

/* ---------- 9. CUTBACK AND REBOUND ---------- */

test('returning to trend after a cutback is the design, not a jump', () => {
  const t = judge(
    wk({ week: 4, phase: 'Build', trainingKm: 39, longKm: 14, supportKm: 20, qualityKm: 5,
         qualityCount: 1, runDays: 5, isCutback: true }),
    wk({ week: 5, phase: 'Build', trainingKm: 52, longKm: 18, supportKm: 28, qualityKm: 6,
         qualityCount: 1, runDays: 5 }),
    { preCutbackKm: 50 });
  assert.equal(t.relative, 1.33, 'a third up on the cutback week, which is what a cutback is');
  assert.deepEqual(t.reasons, [], 'measured against the trend it returns to, not the dip');
});

test('a rebound that overshoots the trend is still inspectable', () => {
  const t = judge(
    wk({ week: 4, phase: 'Build', trainingKm: 39, longKm: 14, supportKm: 20, qualityKm: 5,
         qualityCount: 1, runDays: 5, isCutback: true }),
    wk({ week: 5, phase: 'Build', trainingKm: 64, longKm: 22, supportKm: 34, qualityKm: 8,
         qualityCount: 1, runDays: 5 }),
    { preCutbackKm: 50 });
  assert.ok(has(t, 'REBOUND_EXCEEDS_TREND'),
    '64km against a 50km trend: ' + t.reasons.join(','));
});

/* ---------- 10. TAPER AND RACE WEEK ---------- */

test('a taper week that adds load is caught', () => {
  const t = judge(
    wk({ week: 13, phase: 'Taper', trainingKm: 40, longKm: 14, supportKm: 21, qualityKm: 5,
         qualityCount: 1, runDays: 5, isTaper: true }),
    wk({ week: 14, phase: 'Taper', trainingKm: 44, longKm: 15, supportKm: 24, qualityKm: 5,
         qualityCount: 1, runDays: 5, isTaper: true }));
  assert.ok(has(t, 'TAPER_LOAD_INCREASE'));
});

test('race week is shaped by the event and is reported rather than judged', () => {
  const t = judge(
    wk({ week: 14, phase: 'Taper', trainingKm: 6, longKm: 3, supportKm: 3, runDays: 2, isTaper: true }),
    wk({ week: 15, phase: 'Final Week', trainingKm: 8, raceKm: 42.2, longKm: 0, supportKm: 6,
         qualityKm: 2, qualityCount: 1, runDays: 4, isRace: true }));
  assert.deepEqual(t.reasons, [], 'shakeout runs on race week are not a load progression');
  assert.equal(t.after.raceKm, 42.2, 'and the race distance is held out of the training total');
});

test('race week cannot hide the training progression that precedes it', () => {
  const t = judge(
    wk({ week: 12, phase: 'Peak', trainingKm: 50, longKm: 18, supportKm: 27, qualityKm: 5,
         qualityCount: 1, runDays: 5 }),
    wk({ week: 13, phase: 'Peak', trainingKm: 66, longKm: 25, supportKm: 33, qualityKm: 8,
         qualityCount: 1, runDays: 5 }));
  assert.ok(t.reasons.length, 'the week before the taper is judged like any other');
});

/* ---------- 11. THE INSTRUMENT AGREES WITH THE POPULATION IT MEASURES ---------- */

test('the descriptive >10% measure is preserved exactly as it always was', () => {
  const c = auditCase({ distanceKey: 'full', volume: 25, weeks: 16, scheduleKey: 'd5' });
  const mine = LP.assess(c).filter(t => t.growthOver10pct).map(t => t.toWeek);
  const theirs = c.weeks.filter((w, i) => {
    const p = c.weeks[i - 1];
    return w.volumeGrowth != null && w.volumeGrowth > 1.10 && !w.isRace && !(p && p.isCutback);
  }).map(w => w.week);
  assert.equal(mine.join(','), theirs.join(','),
    'the historical series must stay comparable');
});
