'use strict';
/* METHODOLOGY BATCH 5: THE WEEKLY REVIEW AFTER A CUT-SHORT WEEK.
 *
 * Audit IV found that after a cut-short week the review said "Ready to
 * Progress" 60% of the time and stepped from the PLANNED week (median 1.33x
 * what was run), and a run stopped "for time" counted its missing distance as
 * run. The founder's decisions, 17 November 2026:
 *
 *   1. Cut short for time, judged by session type. Easy running: under 10% of
 *      the week, follow the plan (no penalty, no make-up); 10% or more, step
 *      from the week actually run and do not say Ready to Progress. A quality
 *      session counts in full when only the cooldown was cut; a main set cut
 *      short holds the same session. A long run cut short keeps its target
 *      next week (1km over it when 80% or more was run). No reason given is
 *      read as time; fatigue, pain, injury and illness keep their own routes.
 *   2. A week logged as distances only earns the cautious 5% step.
 *   3. Week Complete counts the run saved today.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

const QUALITY = ['tempo', 'threshold', 'interval', 'repetition'];
const r1 = x => Math.round(x * 10) / 10;
function athlete(opts, pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, Object.assign({ distanceKey: '10k', volume: 30, weeks: 10, experience: 'experienced',
    startDate: '2026-11-09', schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } }, opts || {}));
  return a;
}
const runs = (a, w) => a.state.days.filter(d => d.week === w && d.type !== 'rest' && d.km > 0 && d.type !== 'race');
const logWeek = (a, w) => runs(a, w).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
/* Cut a logged run to `km`, with a reason (or none), and re-read it. */
function cut(a, d, km, reason){
  d.actual.km = km;
  if (reason) d.actual.stopReason = reason;
  delete d.coachReview;
  try { a.coachPersistReview(d); } catch (e) {}
}
const sheetText = (a, rv) => { const c = a.weeklyReviewCopy(rv) || {}; return [c.head, c.why, c.note, c.yes, c.no].join(' '); };

/* ---------- 1. EASY RUNNING CUT SHORT FOR TIME ---------- */

test('easy runs cut for time by under a tenth of the week: next week follows the plan, no penalty', () => {
  const clean = athlete(); logWeek(clean, 1);
  const a = athlete(); logWeek(a, 1);
  const easy = runs(a, 1).filter(d => d.type === 'easy')[0];
  cut(a, easy, easy.km - 2, 'time');                    // 2km of a 30km week
  const ev = a.weeklyEvidence(1);
  assert.ok(ev.timeCutShare < 0.1, 'fixture cut ' + ev.timeCutShare);
  const rv = a.weeklyCoachingReview(2), rv0 = clean.weeklyCoachingReview(2);
  assert.equal(rv.kind, rv0.kind);
  assert.equal(rv.recommendedKm, rv0.recommendedKm, 'a minor dip was penalised');
  assert.equal(rv.reasons.indexOf('time_cut_week'), -1);
  assert.match(sheetText(a, rv), /not made up/);
});

test('easy runs cut for time by a tenth or more: next week steps from the week run, and it is not Ready to Progress', () => {
  const a = athlete(); logWeek(a, 1);
  runs(a, 1).filter(d => d.type === 'easy').forEach(d => cut(a, d, 3, 'time'));   // 6km of 30
  const ev = a.weeklyEvidence(1);
  assert.ok(ev.timeCutShare >= 0.1);
  const rv = a.weeklyCoachingReview(2);
  assert.notEqual(rv.kind, 'progress', 'a 20% cut week was read as ready to progress');
  assert.ok(rv.reasons.indexOf('time_cut_week') !== -1, rv.reasons.join(','));
  const step = rv.step;
  assert.ok(step === 0.05 || step === 0.08 || step === 0.10);
  assert.equal(rv.recommendedKm, r1(ev.runKm * (1 + step)), 'not stepped from the week run');
  assert.ok(rv.recommendedKm < rv.lastKm, 'stepped from the planned week (' + rv.lastKm + ')');
  const txt = sheetText(a, rv);
  assert.doesNotMatch(txt, /ready to progress/i);
  assert.match(txt, /builds from what you ran/);
  assert.doesNotMatch(txt, /—/, 'an em dash');
  /* The Week Complete panel on the Sunday evening says the same. */
  const b = athlete(null, '2026-11-15'); b.state = a.state;
  const wr = b.weekResultReading(1);
  assert.notEqual(wr.tone.label, 'Ready to Progress');
  assert.equal(wr.tone.label, 'Hold This Load');
  /* Accepting delivers that week. */
  const due = a.weeklyReviewDue();
  assert.ok(due, 'the sheet is due');
  a.answerWeeklyReview(due, true);
  assert.ok(Math.abs(a.weekPlannedKm(2) - rv.recommendedKm) <= 1.5, 'week two is ' + a.weekPlannedKm(2));
});

test('no reason given is read the same as for time, and the sheet says so', () => {
  const t = athlete(); logWeek(t, 1);
  runs(t, 1).filter(d => d.type === 'easy').forEach(d => cut(t, d, 3, 'time'));
  const u = athlete(); logWeek(u, 1);
  runs(u, 1).filter(d => d.type === 'easy').forEach(d => cut(u, d, 3, null));
  const rt = t.weeklyCoachingReview(2), ru = u.weeklyCoachingReview(2);
  assert.equal(ru.kind, rt.kind);
  assert.equal(ru.recommendedKm, rt.recommendedKm);
  assert.equal(u.weeklyEvidence(1).timeStops, 3);
  assert.match(sheetText(u, ru), /no reason given, which SACORO reads as a stop for time/);
});

test('a stop for fatigue keeps its own route', () => {
  const a = athlete(); logWeek(a, 1);
  runs(a, 1).filter(d => d.type === 'easy').forEach(d => cut(a, d, 3, 'fatigue'));
  const ev = a.weeklyEvidence(1);
  assert.equal(ev.timeStops, 0);
  assert.ok(ev.fatigueStops >= 2);
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'recovery', 'fatigue stops are a recovery pattern');
  assert.equal(rv.reasons.indexOf('time_cut_week'), -1);
});

/* ---------- 1. LONG RUNS ---------- */

const half = pin => athlete({ distanceKey: 'half', volume: 45, weeks: 14 }, pin);
test('a long run cut short for time: next week\'s long run keeps the same target, and the sheet holds', () => {
  const a = half(); logWeek(a, 1);
  const lr = runs(a, 1).find(d => d.type === 'long');
  const next = runs(a, 2).find(d => d.type === 'long');
  assert.ok(next.km >= lr.km + 2, 'fixture: next long run ' + next.km + ' after ' + lr.km);
  cut(a, lr, r1(lr.km * 0.7), 'time');
  const rv = a.weeklyCoachingReview(2);
  assert.ok(rv.longHold, 'no long-run hold');
  assert.equal(rv.longHold.toKm, lr.km);
  const txt = sheetText(a, rv);
  assert.doesNotMatch(txt, /ready to progress/i);
  assert.match(txt, /long run stays at/);
  const b = half('2026-11-15'); b.state = a.state;
  assert.notEqual(b.weekResultReading(1).tone.label, 'Ready to Progress');
  a.answerWeeklyReview(rv, true);
  assert.equal(runs(a, 2).find(d => d.type === 'long').km, lr.km);
});

test('a long run cut short with 80% run: next week\'s goes 1km over the target, never more', () => {
  const a = half(); logWeek(a, 1);
  const lr = runs(a, 1).find(d => d.type === 'long');
  cut(a, lr, r1(lr.km * 0.85), null);
  const rv = a.weeklyCoachingReview(2);
  assert.ok(rv.longHold);
  assert.equal(rv.longHold.toKm, lr.km + 1);
  assert.match(sheetText(a, rv), /only 1km further/);
  /* Either answer keeps the long run held. */
  a.answerWeeklyReview(rv, false);
  assert.equal(runs(a, 2).find(d => d.type === 'long').km, lr.km + 1);
});

test('a long run cut short for fatigue is not held by this rule', () => {
  const a = half(); logWeek(a, 1);
  const lr = runs(a, 1).find(d => d.type === 'long');
  cut(a, lr, r1(lr.km * 0.7), 'fatigue');
  const rv = a.weeklyCoachingReview(2);
  assert.ok(!rv.longHold);
});

/* ---------- 1. QUALITY SESSIONS ---------- */

/* The 10k plan's week-two session is a sustained steady run; week three has
   hard sessions to come. Read on the Monday of week three. */
function sustained(change){
  const a = athlete(null, '2026-11-23');
  logWeek(a, 1); logWeek(a, 2);
  const q = runs(a, 2).find(d => QUALITY.includes(d.type));
  if (change) change(a, q);
  return { a, q };
}
test('a hard session whose main set was done and only the cooldown cut for time counts in full', () => {
  const { a, q } = sustained((a, q) => cut(a, q, r1(q.km - 0.5), 'time'));
  const ev = a.weeklyEvidence(2);
  assert.equal(ev.qualityFullCredit, 1, 'the main set was not read as done');
  assert.equal(ev.qualityTimeHeld, 0);
  assert.equal(ev.runKm, r1(ev.doneKm + (q.km - q.actual.km)));
  const rv = a.weeklyCoachingReview(3);
  assert.ok(rv.kind !== 'quality' && !rv.qualityHold, rv.kind);
});

test('a hard session whose main set was cut short for time is repeated, not progressed', () => {
  const { a, q } = sustained((a, q) => cut(a, q, r1(q.km * 0.5), 'time'));
  const ev = a.weeklyEvidence(2);
  assert.equal(ev.qualityTimeHeld, 1);
  const rv = a.weeklyCoachingReview(3);
  assert.equal(rv.kind, 'quality', rv.kind + ' ' + rv.reasons.join(','));
  assert.ok(rv.reasons.indexOf('quality_cut_for_time') !== -1);
  assert.doesNotMatch(sheetText(a, rv), /ready to progress/i);
  const b = athlete(null, '2026-11-22'); b.state = a.state;
  assert.equal(b.weekResultReading(2).tone.label, 'Repeat the Hard Session');
});

test('reps cut short for time hold the session and never step it back', () => {
  const a = athlete(null, '2026-11-23');
  logWeek(a, 1); logWeek(a, 2);
  /* Last week the athlete accepted repeating the session. */
  a.state.weeklyReview = { [a.weeklyReviewKey(2)]: { kind: 'quality', week: 2, decision: 'accepted', reasons: [] } };
  const reps = runs(a, 1).find(d => QUALITY.includes(d.type) && a.logShape(d).reps > 0);
  assert.ok(reps, 'fixture has a rep session in week one');
  /* Week two's hard session is replaced by a rep session cut for time. */
  const q = runs(a, 2).find(d => QUALITY.includes(d.type));
  q.type = reps.type; q.title = reps.title; q.km = reps.km; q.prescription = JSON.parse(JSON.stringify(reps.prescription));
  logAsPrescribed(a, q, { quality: 1 });
  q.actual.repsDone = 2; q.actual.stopReason = 'time'; delete q.coachReview; a.coachPersistReview(q);
  const rv = a.weeklyCoachingReview(3);
  assert.equal(rv.kind, 'quality', 'a time stop stepped the session back: ' + rv.kind);
  assert.match(sheetText(a, rv), /2 of 5 reps/);
});

/* ---------- 2. DISTANCE-ONLY LOGS ---------- */

test('a week logged as distances only earns the cautious 5% step, not the standard 8%', () => {
  const a = athlete();
  runs(a, 1).forEach(d => { d.completed = true; d.actual = Object.assign(a.emptyActual(), { km: d.km }); });
  const ev = a.weeklyEvidence(1);
  assert.equal(ev.distanceOnly, true);
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'progress');
  assert.equal(rv.step, 0.05);
  assert.equal(rv.recommendedKm, r1(rv.lastKm * 1.05));
  assert.match(sheetText(a, rv), /distances only, .*the step is a small one/);
  /* With effort logged, the standard step. */
  const b = athlete(); logWeek(b, 1);
  assert.equal(b.weeklyEvidence(1).distanceOnly, false);
  assert.equal(b.weeklyCoachingReview(2).step, 0.08);
});

/* ---------- 3. WEEK COMPLETE COUNTS TODAY'S RUN ---------- */

test('Week Complete counts the run saved today, and an unrun session today is not missed yet', () => {
  const a = athlete(null, '2026-11-15');               // Sunday, the long run's day
  logWeek(a, 1);
  const lr = runs(a, 1).find(d => d.type === 'long');
  assert.equal(lr.date, '2026-11-15');
  const ev = a.weeklyEvidence(1);
  assert.equal(ev.due, runs(a, 1).length, 'today\'s run was left out');
  assert.equal(ev.doneKm, a.weekPlannedKm(1));
  assert.equal(a.weekResultReading(1).pct, 100);
  /* Today's session not yet run: not due, so not missed or unknown. */
  const b = athlete(null, '2026-11-15');
  runs(b, 1).filter(d => d.type !== 'long').forEach(d => logAsPrescribed(b, d, { quality: 1 }));
  const evb = b.weeklyEvidence(1);
  assert.equal(evb.due, runs(b, 1).length - 1);
  assert.equal(evb.unknown, 0);
  assert.equal(evb.missed, 0);
});

test('Week Complete on the day the long run is cut short reads the cut, not the planned week', () => {
  const a = athlete(null, '2026-11-15');
  logWeek(a, 1);
  runs(a, 1).filter(d => d.type === 'easy').forEach(d => cut(a, d, 3, 'time'));
  const lr = runs(a, 1).find(d => d.type === 'long');
  cut(a, lr, 7, 'time');
  const wr = a.weekResultReading(1);
  assert.equal(wr.ev.timeStops, 4, 'today\'s long run was left out');
  assert.notEqual(wr.tone.label, 'Ready to Progress');
  assert.ok(wr.next.recommendedKm <= r1(wr.ev.runKm * 1.1) + 0.05, 'next week ' + wr.next.recommendedKm + ' after running ' + wr.ev.runKm);
  assert.match(wr.said, /cut short/);
});
