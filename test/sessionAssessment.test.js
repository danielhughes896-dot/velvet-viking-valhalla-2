'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE SESSION ASSESSMENT -- THREE READINGS THAT DO NOT CONTAMINATE EACH OTHER.
 *
 * Founder, approving the architecture:
 *   "Execution: How well the athlete performed the work they actually
 *    completed, relative to the intended session.
 *    Response: How the athlete tolerated that work, using subjective effort,
 *    physiological response and personal baselines.
 *    Completion: How much of the prescribed session was completed, including
 *    the reason for stopping early."
 *   "Do not build the scorer to reproduce arbitrary numerical examples. Write
 *    behavioural regression tests first, demonstrating that the engine
 *    distinguishes meaningful differences in execution, response, completion
 *    and evidence reliability."
 *
 * SO NOTHING HERE PINS A NUMBER. Every law is a comparison -- this session
 * against that one -- or a statement about what a reading may and may not
 * depend on. The tolerances and penalties live in ASSESS_CAL in the runtime and
 * are calibration hypotheses under review; they can all move without one of
 * these laws needing to.
 *
 * THE ENGINE IS NOT YET WHAT THE CIRCLES READ. "Architecture approved.
 * Numerical calibration remains subject to testing and review." The last law
 * in this file holds that line until it is deliberately crossed.
 */

const TODAY = '2026-11-12';
function athlete() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  a.healthConsentGranted = () => true;
  const r = buildPlan(a, { distanceKey: 'full', volume: 60, weeks: 16, lthr: 172, maxHR: 188,
    startDate: a.addDays(TODAY, -70) });
  a.plan = r;
  return a;
}
const segsOf = (a, d) => a.orderedSegments(a.prescriptionOf(d));
const work = (a, d) => segsOf(a, d).filter(s => s.role === 'work');
function find(a, pred, what) {
  const d = a.plan.days.filter(x => x.type !== 'rest' && pred(x, segsOf(a, x)))[0];
  assert.ok(d, 'the fixture plan has no ' + what);
  return d;
}
const hills = a => find(a, (d, s) => s.some(x => x.terrain === 'uphill'), 'hill session');
const threshold = a => find(a, (d, s) => s.filter(x => x.role === 'work').length === 1 &&
  s.some(x => x.role === 'work' && x.intensity === 'threshold'), 'continuous threshold run');
const stagedLong = a => find(a, (d, s) => d.type === 'long' && s.some(x => x.intensity === 'goal_pace'), 'staged long run');
const easy = a => find(a, d => d.type === 'easy', 'easy run');
const reps = a => find(a, (d, s) => s.filter(x => x.role === 'work' && x.inRepeat && !x.terrain).length >= 4, 'rep session');

const bandOf = (a, seg) => a.segmentPaceBand(seg, a.getActivePaces(), a.getGoalPaceSecPerKm());
const mid = b => (b.fast + b.slow) / 2;
const fmt = sec => Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');

/* Log a session. `sections` maps a segment to the pace it was run at, as a
   multiple of its own target (1 = on it, 1.06 = 6% slow) -- or null for a
   section that was not run. */
function log(a, d, o) { return a.assessSession(prepare(a, d, o)); }
/* The same, without assessing it: the day as the log leaves it. */
function prepare(a, d, o) {
  const opt = o || {};
  d.completed = true;
  d.actual = Object.assign(a.emptyActual(), {
    km: opt.km != null ? opt.km : d.km, paceUnit: 'km',
    pace: opt.pace != null ? fmt(opt.pace) : null,
    rpe: opt.rpe != null ? opt.rpe : null, hr: opt.hr != null ? opt.hr : null,
    notes: opt.notes || '' });
  ['repsDone', 'stopReason', 'mainSetFelt', 'mainSetHeld', 'recoveries', 'watchDataOff'].forEach(k => {
    if (opt[k] != null) d.actual[k] = opt[k];
  });
  if (opt.sections) {
    d.actual.splits = [];
    segsOf(a, d).forEach((seg) => {
      const f = opt.sections(seg);
      if (f == null) return;
      const b = bandOf(a, seg);
      if (!b) return;
      const pace = mid(b) * f;
      const km = seg.km != null ? seg.km : (seg.sec > 0 ? seg.sec / pace : 1);
      d.actual.splits.push({ segId: seg.segId, role: seg.role, km: Math.round(km * 100) / 100,
        sec: Math.round(km * pace), paceSec: Math.round(pace) });
    });
  }
  return d;
}
/* A work pace this many per cent OUTSIDE the slow edge of its own band (the
   band has width, so "1% off the middle" is still inside it). */
const pastSlowEdge = (a, pct) => seg => {
  if (seg.role !== 'work') return 1;
  const b = bandOf(a, seg);
  return b.slow * (1 + pct / 100) / mid(b);
};
const onWork = f => seg => seg.role === 'work' ? f(seg) : 1;

/* ---------- 1. the three readings are independent ---------- */

test('the founder’s example: three of the hill reps, done well, then stopped by fatigue', () => {
  const a = athlete(); const d = hills(a);
  const total = work(a, d).length;
  const r = log(a, d, { repsDone: 3, km: d.km * 0.6, rpe: 8, mainSetHeld: 'held',
    notes: 'legs were completely gone, shattered, had to stop' });
  assert.equal(r.completion.done, 3);
  assert.equal(r.completion.of, total);
  assert.equal(r.completion.short, true);
  assert.equal(r.completion.reason, 'fatigue');
  assert.equal(r.execution.level, 'high',
    'the reps that were run were marked down because others were not');
  assert.equal(r.response.reading, 'harder');
  assert.ok(r.response.signals.indexOf('fatigue') > -1);
});

test('execution is the work that was done: missing reps do not lower it, slow reps do', () => {
  const a = athlete(); const d = reps(a);
  const n = work(a, d).length;
  const all = log(a, d, { sections: onWork(() => 1) });
  const some = log(a, d, { sections: seg => seg.role === 'work' ? (seg.repIndex <= n - 2 ? 1 : null) : 1 });
  const slow = log(a, d, { sections: onWork(() => 1.07) });
  assert.equal(some.execution.score, all.execution.score,
    'two reps not run changed the quality of the reps that were');
  assert.ok(some.completion.fraction < all.completion.fraction, 'completion did not notice two reps were missing');
  assert.equal(some.completion.done, n - 2);
  assert.ok(slow.execution.score < all.execution.score, 'reps run 7% slow read the same as reps run on target');
  assert.equal(slow.completion.short, false, 'running slowly was counted as not finishing');
});

test('completion does not move with quality, and quality does not move with completion', () => {
  const a = athlete(); const d = threshold(a);
  const good = log(a, d, { sections: onWork(() => 1) });
  const slow = log(a, d, { sections: onWork(() => 1.05) });
  assert.equal(slow.completion.fraction, good.completion.fraction);
  const cut = log(a, d, { km: d.km * 0.6, sections: onWork(() => 1) });
  assert.equal(cut.execution.score, good.execution.score);
  assert.ok(cut.completion.fraction < 0.7);
});

/* ---------- 2. tolerance, then a graduated penalty, then an interpretation ---------- */

test('inside the tolerance band a small miss is not a miss', () => {
  const a = athlete(); const d = threshold(a);
  const on = log(a, d, { sections: onWork(() => 1) });
  const near = log(a, d, { sections: pastSlowEdge(a, 1) });
  assert.equal(near.execution.sections.filter(s => s.work)[0].devPct > 0, true,
    'the fixture is not outside the band, so this law is testing nothing');
  assert.equal(near.execution.score, on.execution.score,
    'a 1% miss -- GPS noise -- moved the score');
  /* And the band of forgiveness has an end. */
  assert.ok(log(a, d, { sections: pastSlowEdge(a, 5) }).execution.score < on.execution.score);
});

test('outside it the penalty is graduated: further off reads worse, in both directions', () => {
  const a = athlete(); const d = threshold(a);
  const at = f => log(a, d, { sections: onWork(() => f) }).execution.score;
  assert.ok(at(1) > at(1.05), 'slow was not penalised');
  assert.ok(at(1.05) > at(1.065), 'the penalty does not grow with the miss');
  assert.ok(at(1) > at(0.95), 'fast was not penalised on a controlled session');
  assert.ok(at(0.95) > at(0.935));
});

test('far enough off it is a different session, and says so instead of deducting', () => {
  const a = athlete(); const d = threshold(a);
  const r = log(a, d, { sections: onWork(() => 1.14) });
  assert.equal(r.execution.interpretation, 'different-session',
    'threshold work run 14% slow was scored as a slightly worse threshold run');
  assert.equal(r.execution.score, null, 'a number was put on a session that was not the one prescribed');
  assert.equal(log(a, d, { sections: onWork(() => 1.04) }).execution.interpretation, null);
});

test('an easy run is not marked down for being slow', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const on = log(a, d, { pace: mid(b), rpe: 3 });
  const slow = log(a, d, { pace: b.slow * 1.08, rpe: 3 });
  assert.equal(slow.execution.score, on.execution.score, 'an easy run was penalised for being easy');
  assert.equal(slow.execution.overspeed, null);
});

/* ---- CHANGED SIDES: FAST EASY RUNNING ----
   The first version of this file held that an easy run 12% fast simply
   scored lower. The founder, shown the 55 that produced: "Pace above the
   easy band is a warning signal, not automatically proof of poor execution.
   Use credible HR, RPE, terrain and personal history to determine whether
   the athlete actually exceeded the intended intensity. If the evidence is
   insufficient, say 'Faster than prescribed; intensity uncertain.' Don't
   award 100 automatically, but don't impose an arbitrary 55 either." */

test('fast easy running with no evidence of effort: no figure, and it says so', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const r = log(a, d, { pace: b.fast * 0.88 });
  assert.equal(r.execution.score, null, 'a figure was put on an intensity nothing measured');
  assert.equal(r.execution.overspeed, 'uncertain');
  assert.equal(r.execution.interpretation, null);
  assert.match(a.assessmentReadout(r).execution, /^Faster than prescribed; intensity uncertain/);
});

test('fast easy running where the effort demonstrably stayed easy is not deducted, and is noted', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const hr = a.executionHRTarget(d);
  const on = log(a, d, { pace: mid(b), rpe: 3, hr: hr.lo + 2 });
  const fast = log(a, d, { pace: b.fast * 0.88, rpe: 3, hr: hr.lo + 2 });
  assert.equal(fast.execution.score, on.execution.score,
    'the pace was penalised although effort and heart rate both say the run was easy');
  assert.equal(fast.execution.overspeed, 'effort-easy', 'and the fast pace went unremarked');
  assert.match(a.assessmentReadout(fast).execution, /^Faster than prescribed; effort stayed easy/);
  /* One credible signal is enough when nothing contradicts it. */
  assert.equal(log(a, d, { pace: b.fast * 0.88, rpe: 3 }).execution.overspeed, 'effort-easy');
});

test('fast easy running where the effort was exceeded is marked down, by how far', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const hr = a.executionHRTarget(d);
  const on = log(a, d, { pace: mid(b), rpe: 3 });
  const bit = log(a, d, { pace: b.fast * 0.93, rpe: 8, hr: hr.hi + 12 });
  const lot = log(a, d, { pace: b.fast * 0.89, rpe: 8, hr: hr.hi + 12 });
  assert.equal(bit.execution.overspeed, 'exceeded');
  assert.ok(bit.execution.score < on.execution.score, 'an easy run run hard read as a good easy run');
  assert.ok(lot.execution.score < bit.execution.score, 'the deduction does not grow with the miss');
});

test('fast easy running with signals that disagree stays uncertain', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const hr = a.executionHRTarget(d);
  const r = log(a, d, { pace: b.fast * 0.88, rpe: 3, hr: hr.hi + 6 });
  assert.equal(r.execution.overspeed, 'uncertain', 'one of two disagreeing signals decided the score');
  assert.equal(r.execution.score, null);
  /* And a heart rate that cannot be trusted does not get a vote. */
  const strap = log(a, d, { pace: b.fast * 0.88, rpe: 3, hr: hr.hi + 6, notes: 'HR strap was playing up, readings all over the place' });
  assert.equal(strap.execution.overspeed, 'effort-easy');
});

test('the athlete\u2019s own history answers it when today says nothing', () => {
  const a = athlete();
  const easies = a.plan.days.filter(x => x.type === 'easy');
  const before = t => easies.filter(x => x.date < t.date && x.date >= a.addDays(t.date, -28));
  /* An easy run with three more in the four weeks before it. */
  const target = easies.filter(t => before(t).length >= 3)[0];
  assert.ok(target, 'the fixture plan has no easy run with three before it');
  const pool = before(target).slice(-3);
  assert.equal(pool.length, 3, 'the fixture has no three easy runs in the four weeks before');
  pool.forEach(x => prepare(a, x, { pace: bandOf(a, work(a, x)[0]).fast * 0.9, rpe: 3 }));
  const tb = bandOf(a, work(a, target)[0]);
  const r = log(a, target, { pace: tb.fast * 0.9 });
  assert.equal(r.execution.overspeed, 'effort-easy', 'three easy runs at this pace did not count as history');
  assert.equal(r.execution.targetsMayBeStale, true, 'and the band was not questioned');
  /* Without that history the same run is uncertain. */
  pool.forEach(x => { x.completed = false; x.actual = null; });
  assert.equal(log(a, target, { pace: tb.fast * 0.9 }).execution.overspeed, 'uncertain');
});

test('a set that fades is told apart from one that holds, even at the same average', () => {
  const a = athlete(); const d = reps(a);
  const n = work(a, d).length;
  const even = log(a, d, { sections: onWork(() => 1.05) });
  const fading = log(a, d, { sections: onWork(seg => 1 + (seg.repIndex - 1) * (0.10 / (n - 1))) });
  const building = log(a, d, { sections: onWork(seg => 1.10 - (seg.repIndex - 1) * (0.10 / (n - 1))) });
  assert.equal(even.execution.pattern, 'held');
  assert.equal(fading.execution.pattern, 'faded', 'reps that fell away read as a steady set');
  assert.equal(building.execution.pattern, 'built');
  /* One block has no shape to describe. */
  assert.equal(log(a, threshold(a), { sections: onWork(() => 1) }).execution.pattern, null);
});

test('a score is a whole number or it is not there', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  [0.9, 0.88, 0.86, 1.2].forEach(f => {
    const sc = log(a, d, { pace: (f < 1 ? b.fast : b.slow) * f }).execution.score;
    assert.ok(sc === null || Number.isInteger(sc), 'a score of ' + sc + ' claims a precision nothing has');
  });
});

/* ---------- 3. a long run with race-specific work is judged by section ---------- */

test('a staged long run: the goal-pace section against goal pace, the rest as easy running', () => {
  const a = athlete(); const d = stagedLong(a);
  const right = log(a, d, { sections: () => 1 });
  assert.equal(right.execution.basis, 'sections');
  assert.equal(right.execution.level, 'high',
    'an athlete who ran the session exactly as written was penalised for it');
  const kinds = right.execution.sections.map(s => s.kind);
  assert.ok(kinds.indexOf('target') > -1 && kinds.indexOf('easy') > -1,
    'the whole run was treated as one kind of running');
  /* The same run with the race-pace section jogged is a worse execution. */
  const easySeg = segsOf(a, d).filter(s => s.role !== 'work')[0];
  const jogged = log(a, d, { sections: seg => seg.role === 'work'
    ? mid(bandOf(a, easySeg)) / mid(bandOf(a, seg)) : 1 });
  assert.ok(jogged.execution.interpretation === 'different-session' ||
            jogged.execution.score < right.execution.score,
    'jogging the goal-pace section read the same as running it');
});

test('an easy section inside a harder session that ran fast is left uncertain, not judged by the hard part', () => {
  /* The effort and the average heart rate of a staged long run describe its
     goal-pace block. They are not evidence about the easy running either
     side of it. */
  const a = athlete(); const d = stagedLong(a);
  const right = log(a, d, { sections: () => 1, rpe: 8 });
  const quickFlanks = log(a, d, { sections: seg => seg.role === 'work' ? 1 : 0.85, rpe: 8 });
  assert.equal(quickFlanks.execution.overspeed, 'uncertain',
    'the hard block\u2019s effort was used to judge the easy running beside it');
  assert.equal(quickFlanks.execution.score, right.execution.score,
    'a section nobody can read moved the figure');
  assert.ok(quickFlanks.execution.sections.some(s => s.uncertain));
});

/* ---------- 4. response is separate, and heart rate lives there ---------- */

test('heart rate below the band is never a fault, in any reading', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const hr = a.executionHRTarget(d);
  const inBand = log(a, d, { pace: mid(b), rpe: 3, hr: Math.round((hr.lo + hr.hi) / 2) });
  const below = log(a, d, { pace: mid(b), rpe: 3, hr: hr.lo - 18 });
  assert.equal(below.execution.score, inBand.execution.score, 'a fitter heart lowered the execution score');
  assert.notEqual(below.response.reading, 'harder');
  assert.equal(below.response.contradiction, false, 'easy effort with a low heart rate was called contradictory');
});

test('heart rate above the band is a response, not an execution fault', () => {
  const a = athlete(); const d = threshold(a);
  const hr = a.executionHRTarget(d);
  const calm = log(a, d, { sections: onWork(() => 1), rpe: 7, hr: hr.lo + 2 });
  const hot = log(a, d, { sections: onWork(() => 1), rpe: 9, hr: hr.hi + 12 });
  assert.equal(hot.execution.score, calm.execution.score, 'the pace was right; the score moved with the heart rate');
  assert.equal(calm.response.reading, 'as-intended');
  assert.equal(hot.response.reading, 'harder');
  assert.ok(hot.response.signals.indexOf('hr-high') > -1);
});

test('conditions explain a hard response; they do not erase it', () => {
  const a = athlete(); const d = threshold(a);
  const r = log(a, d, { sections: onWork(() => 1), rpe: 10, notes: '31 degrees and humid today' });
  assert.equal(r.response.reading, 'harder', 'heat turned a hard session into a normal one');
  assert.ok(r.response.context.indexOf('heat') > -1, 'the heat was not kept as the explanation');
});

test('effort and heart rate that contradict each other are a reliability question, not a verdict', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const hr = a.executionHRTarget(d);
  const r = log(a, d, { pace: mid(b), rpe: 2, hr: hr.hi + 25 });
  assert.equal(r.response.contradiction, true);
  assert.equal(r.response.reading, 'unclear', 'one of two disagreeing signals was simply believed');
});

test('longer recoveries are evidence of direction only', () => {
  const a = athlete(); const d = reps(a);
  const asSet = log(a, d, { sections: onWork(() => 1), recoveries: 'as-set' });
  const longer = log(a, d, { sections: onWork(() => 1), recoveries: 'longer' });
  assert.equal(longer.execution.score, asSet.execution.score,
    'a size was put on "longer", which the athlete never gave');
  assert.ok(longer.response.signals.indexOf('recoveries-longer') > -1, 'the report was thrown away');
});

/* ---------- 5. evidence: what exists, how far it can be trusted, what was said ---------- */

test('reported-only work gets words, never a number', () => {
  const a = athlete(); const d = hills(a);
  const r = log(a, d, { rpe: 8 });
  assert.equal(r.execution.score, null, 'a number was invented for effort-based reps nobody measured');
  assert.equal(r.execution.basis, 'reported');
  assert.ok(r.execution.level, 'and no description was offered either');
  assert.equal(r.evidence.grade, 'reported');
});

test('a structured session with only totals is described coarsely, not scored', () => {
  const a = athlete(); const d = threshold(a);
  const t = a.executionPaceTarget(d);
  const r = log(a, d, { pace: (t.fast + t.slow) / 2, rpe: 7 });
  assert.equal(r.execution.score, null,
    'a whole-run average over warm-up, work and cool-down was scored as if it were the work');
  assert.equal(r.evidence.grade, 'totals');
  assert.equal(r.completion.short, false, 'and completion, which totals DO show, was lost');
});

test('watch data off removes the unreliable measurement and keeps the rest', () => {
  const a = athlete(); const d = threshold(a);
  const hr = a.executionHRTarget(d);
  const r = log(a, d, { sections: onWork(() => 1.2), rpe: 7, hr: hr.lo + 3, watchDataOff: true });
  assert.equal(r.evidence.reliability.pace, 'suspect');
  assert.equal(r.execution.score, null, 'a pace the athlete said was wrong was scored anyway');
  assert.equal(r.execution.interpretation, null, 'and was read as a different session');
  assert.equal(r.evidence.reliability.hr, 'ok', 'a GPS fault discarded the heart rate with it');
  assert.equal(r.response.reading, 'as-intended', 'the effort and heart rate were thrown away with the pace');
  assert.ok(r.completion.fraction != null, 'completion was thrown away with the pace');
  assert.ok(r.evidence.excluded.indexOf('pace') > -1);
  /* With nothing else to go on, a pace that cannot be trusted leaves
     execution unanswered; it is not scored for want of anything better. */
  const bare = log(a, d, { sections: onWork(() => 1.2), watchDataOff: true });
  assert.equal(bare.execution.score, null);
  assert.equal(bare.execution.basis, 'none');
  assert.equal(bare.execution.interpretation, null);
});

test('measured is not the same as reliable: an impossible reading is set aside', () => {
  const a = athlete(); const d = easy(a);
  const r = log(a, d, { pace: 95, rpe: 3 });              // 1:35/km
  assert.equal(r.evidence.coverage.pace, true);
  assert.equal(r.evidence.reliability.pace, 'suspect');
  assert.equal(r.execution.score, null);
  const strap = log(a, d, { pace: mid(bandOf(a, work(a, d)[0])), rpe: 3, hr: 236 });
  assert.equal(strap.evidence.reliability.hr, 'suspect');
  assert.equal(strap.response.reading, 'as-intended', 'a strap fault was read as the athlete struggling');
});

test('a heart-rate doubt in the notes sets the heart rate aside and keeps the effort', () => {
  const a = athlete(); const d = threshold(a);
  const hr = a.executionHRTarget(d);
  const r = log(a, d, { sections: onWork(() => 1), rpe: 7, hr: hr.hi + 30, notes: 'HR strap was playing up, readings all over the place' });
  assert.equal(r.evidence.reliability.hr, 'suspect');
  assert.equal(r.response.reading, 'as-intended');
  assert.equal(r.response.contradiction, false);
});

/* ---------- 6. completion and its reason ---------- */

test('the reason for stopping is never invented', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const silent = log(a, d, { km: d.km * 0.5, pace: mid(b) });
  assert.equal(silent.completion.short, true);
  assert.equal(silent.completion.reason, null, 'a reason was made up for a run that was simply cut short');
  const said = log(a, d, { km: d.km * 0.5, pace: mid(b), stopReason: 'time' });
  assert.equal(said.completion.reason, 'time');
  /* What the athlete chose outranks what the notes might be read to mean. */
  const both = log(a, d, { km: d.km * 0.5, pace: mid(b), stopReason: 'time', notes: 'felt shattered' });
  assert.equal(both.completion.reason, 'time');
});

test('pain or illness is passed to the safety pathway, not weighed as a response', () => {
  const a = athlete(); const d = easy(a);
  const b = bandOf(a, work(a, d)[0]);
  const r = log(a, d, { km: d.km * 0.4, pace: mid(b), notes: 'sharp pain in my calf, stopped' });
  assert.equal(r.completion.reason, 'pain');
  assert.equal(r.response.safety, 'pain');
});

/* ---------- 7. what may be shown ---------- */

test('a perfect score on part of a session is never shown without the part', () => {
  const a = athlete(); const d = reps(a);
  const n = work(a, d).length;
  const r = log(a, d, { sections: seg => seg.role === 'work' ? (seg.repIndex <= 3 ? 1 : null) : 1 });
  assert.equal(r.execution.level, 'high');
  const shown = a.assessmentReadout(r);
  assert.match(shown.execution, new RegExp('3 of ' + n), 'the execution line stands alone on a partial session');
  assert.match(shown.line, new RegExp('3 of ' + n));
  assert.ok(shown.line.indexOf(shown.completion) < shown.line.indexOf('xecution') || shown.line.indexOf('xecution') === -1,
    'execution is stated before the athlete is told how much of the session it covers');
  assert.equal(r.execution.fullDose, false,
    'high execution on a partial session was marked as the full training dose');
  /* And a complete one needs no qualifier. */
  const full = log(a, d, { sections: onWork(() => 1) });
  assert.equal(full.execution.fullDose, true);
  assert.doesNotMatch(a.assessmentReadout(full).execution, / of /);
});

/* ---------- 8. the engine's manners ---------- */

test('it reads the day and changes nothing', () => {
  const a = athlete(); const d = threshold(a);
  prepare(a, d, { sections: onWork(() => 1.03), rpe: 7 });
  const before = JSON.stringify(d);
  const stateBefore = JSON.stringify(a.state.athlete || null);
  a.assessSession(d); a.assessSession(d);
  assert.equal(JSON.stringify(d), before, 'assessing a session rewrote it');
  assert.equal(JSON.stringify(a.state.athlete || null), stateBefore);
  assert.equal(a.assessSession({ type: 'easy', completed: false }), null);
  assert.equal(a.assessSession(null), null);
});

test('it is not yet what the circles read: calibration is still under review', () => {
  /* Founder: "Architecture approved. Numerical calibration remains subject to
     testing and review." And, asked whether it could replace the old score:
     "Not yet ... Keep behind the gate: Switching Confidence, trends and
     Evolution to the new scoring outputs until their individual input
     contracts and calibration are tested."
     ONE READER WAS LET THROUGH, deliberately, when Your Log was built: the
     session's own analysis prints what was logged -- how much was done, how
     it was tolerated -- in words. It prints no Execution figure, and nothing
     that decides training reads the engine at all. This law is that line. */
  const fs = require('fs'); const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const body = (name) => {
    const at = src.indexOf('\nfunction ' + name + '(');
    assert.ok(at > -1, name + '() is gone');
    return src.slice(at, src.indexOf('\n}\n', at) + 3);
  };
  const start = src.indexOf('/* ===== SESSION ASSESSMENT');
  const end = src.indexOf('\n}\n', src.indexOf('\nfunction assessmentReadout(')) + 3;
  assert.ok(start > -1 && end > start);
  const readout = body('sessionReadoutHtml');
  const outside = (src.slice(0, start) + src.slice(end)).replace(readout, '');
  assert.doesNotMatch(outside, /\bassessSession\(|\bassessmentReadout\(/,
    'something other than the session\u2019s own analysis is reading the engine');
  /* The one reader takes words, never the figure. */
  assert.match(readout, /assessSession\(dd\)/);
  assert.doesNotMatch(readout, /execution\.score|\.score\b/, 'the unreviewed Execution figure is being shown');
  /* And the engines that decide training do not mention it. */
  ['coachAnalyse', 'coachTrend', 'coachRecovery', 'coachDecision', 'planEvolution', 'playbookAssess',
   'computeExecutionBreakdown'].forEach((fn) => {
    assert.doesNotMatch(body(fn), /assessSession|assessmentReadout|sessionReadoutHtml/,
      fn + '() has started reading the unreviewed assessment');
  });
  const a = athlete(); const d = threshold(a);
  log(a, d, { sections: onWork(() => 1), rpe: 7 });
  assert.ok(a.computeExecutionBreakdown(d) && a.computeExecutionBreakdown(d).score != null,
    'the existing score stopped answering');
});
