'use strict';
/* AUDIT IV, THE WEEKLY REVIEW AMBERS (founder approved fixing them, 18
 * November 2026). Measured in the learning simulation:
 *
 *   A4  easy runs running hot were ignored: 96% of the reviews after a week
 *       of easy runs whose heart rate sat clearly above the easy zone still
 *       progressed. An easy run running hot is now a harder-than-set signal,
 *       read the way effort above the band is: one makes the step the
 *       cautious 5%, two hold the week. Illness, heat and a doubted monitor
 *       still excuse it.
 *   A5  declining a hold kept the plan's (bigger) week: 29.6% gave a week
 *       more than 25% above last week. Declining now takes the standard step
 *       from the week run, never more.
 *   A6  the week after a lighter week taken on the sheet snapped back to the
 *       plan. It now follows the founder's rule: back to the week before the
 *       lighter one, with the 8% safety net, whatever the answer.
 *   A7  both answers gave the same week on 7.8% of sheets. Two answers that
 *       give the same week are one button; a recovery sheet whose
 *       "Continue Progression" is the week held offers two choices, not three.
 *   A8  the week applied differed from the sheet's figure by more than 1km in
 *       11.8% of accepted answers (42% of them the cut-short holds). The
 *       figure is now the week the answer writes, holds included, and the
 *       toast quotes it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, makePinnedDate } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

const r1 = x => Math.round(x * 10) / 10;
function athlete(pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  a.toasts = []; a.showToast = m => a.toasts.push(String(m));
  buildPlan(a, { distanceKey: '10k', volume: 30, weeks: 10, experience: 'experienced', lthr: 170, maxHR: 190,
    startDate: '2026-11-09', schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  return a;
}
const runs = (a, w) => a.state.days.filter(d => d.week === w && d.type !== 'rest' && d.km > 0 && d.type !== 'race')
  .sort((x, y) => x.date < y.date ? -1 : 1);
const easy = (a, w) => runs(a, w).filter(d => d.type === 'easy');
const logWeek = (a, w) => runs(a, w).forEach(d => logAsPrescribed(a, d, { quality: 1, sections: true }));
const persist = (a, d) => { delete d.coachReview; try { a.coachPersistReview(d); } catch (e) {} };
/* Average heart rate `bpm` beats over the top of the zone the run prescribes. */
const runHot = (a, d, bpm) => { d.actual.hr = a.executionHRTarget(d).hi + bpm; persist(a, d); };
const overBand = (a, d) => { d.actual.rpe = a.expectedRPEBand(d)[1] + 2; persist(a, d); };
/* The plan has moved on past what the athlete runs (after a few held weeks):
   week `w`'s easy runs half as long again. */
const planMovedOn = (a, w) => easy(a, w).forEach(d => { d.km = r1(d.km * 1.6 * 2) / 2; });
const sheetText = (a, rv) => { const c = a.weeklyReviewCopy(rv) || {}; return [c.head, c.why, c.note, c.yes, c.no].join(' '); };
const answer = (a, rv, accept) => { a.weeklyReviewOpen = { rv, layer: null, picked: rv.choice || null }; a.handleWeeklyAnswer(accept); };

/* ---------- A4: EASY RUNS RUNNING HOT ---------- */

test('A4: one easy run with its heart rate clearly above the zone makes the step the cautious one, and the sheet names it', () => {
  const clean = athlete(); logWeek(clean, 1);
  const base = clean.weeklyCoachingReview(2);
  assert.equal(base.kind, 'progress');
  assert.equal(base.step, 0.08, 'the clean week is not the standard step');
  const a = athlete(); logWeek(a, 1);
  /* Monday's run: out of the Recovery reading's seven days by the next
     Monday, so only the weekly evidence can see it. */
  const mon = easy(a, 1)[0];
  runHot(a, mon, 8);
  const ev = a.weeklyEvidence(1);
  assert.equal(ev.easyHot, 1);
  assert.equal(ev.harder, 1);
  assert.equal(ev.overEffort, 0, 'the effort the athlete reported is unchanged');
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'progress');
  assert.equal(rv.step, 0.05, 'a hot easy run did not make the step cautious');
  assert.ok(rv.reasons.includes('cautious'));
  assert.match(sheetText(a, rv), new RegExp('Your heart rate averaged above the easy zone on ' + a.weeklyDayName(mon.date) + '’s easy run, so the step is a small one'));
});

test('A4: two easy runs running hot hold the week, as two easy runs harder than their band do', () => {
  const a = athlete(); logWeek(a, 1);
  easy(a, 1).slice(0, 2).forEach(d => runHot(a, d, 8));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'hold');
  assert.ok(rv.reasons.includes('easy_hr_high'), rv.reasons.join(','));
  assert.ok(!rv.reasons.includes('easy_effort_high'), 'heart rate is not said as effort');
  assert.match(sheetText(a, rv), /your heart rate averaged above the easy zone on your easy runs on \w+ and \w+/);
  /* The same as two easy runs logged above their effort band. */
  const b = athlete(); logWeek(b, 1);
  easy(b, 1).slice(0, 2).forEach(d => overBand(b, d));
  assert.equal(b.weeklyCoachingReview(2).kind, 'hold');
  /* Week Complete does not say "none harder than it was meant to be". */
  const wr = a.weekResultReading(1);
  assert.doesNotMatch(wr.said, /none harder than it was meant to be/);
  assert.match(wr.said, /2 easy runs ran above the easy heart-rate zone/);
});

test('A4: a run counts once, and a reading at the top of the zone is not strain', () => {
  const a = athlete(); logWeek(a, 1);
  const d = easy(a, 1)[0];
  overBand(a, d); runHot(a, d, 8);
  const ev = a.weeklyEvidence(1);
  assert.equal(ev.easyHot, 1);
  assert.equal(ev.harder, 1, 'one run over its band and its zone was counted twice');
  const b = athlete(); logWeek(b, 1);
  easy(b, 1).slice(0, 2).forEach(x => runHot(b, x, 1));     // inside the 2% margin
  assert.equal(b.weeklyEvidence(1).easyHot, 0);
});

test('A4: heat, illness, a doubted monitor, watch data off and no consent each excuse it', () => {
  const hot = (mark) => {
    const a = athlete(); logWeek(a, 1);
    easy(a, 1).slice(0, 2).forEach(d => { mark(a, d); runHot(a, d, 8); });
    return a;
  };
  const heat = hot((a, d) => { d.actual.conditions = ['hot']; });
  assert.equal(heat.weeklyEvidence(1).easyHot, 0, 'a hot day');
  assert.notEqual(heat.weeklyCoachingReview(2).kind, 'hold');
  const ill = hot((a, d) => { d.readiness = { health: 'under', illness: 'head', date: d.date }; });
  assert.equal(ill.weeklyEvidence(1).easyHot, 0, 'a morning under the weather (ILLNESS_HR_NOTE)');
  const off = hot((a, d) => { d.actual.watchDataOff = true; });
  assert.equal(off.weeklyEvidence(1).easyHot, 0, 'watch data off');
  const doubt = hot((a, d) => { d.actual.notes = 'HR monitor was wrong today'; });
  assert.equal(doubt.weeklyEvidence(1).easyHot, 0, 'a doubted monitor');
  const none = hot(() => {});
  none.state.healthConsent = null;
  assert.equal(none.weeklyEvidence(1).easyHot, 0, 'without health consent');
});

/* ---------- A5: DECLINING A HOLD ---------- */

test('A5: declining a hold takes the standard step from the week run, not the plan\'s jump', () => {
  const a = athlete(); logWeek(a, 1);
  easy(a, 1).slice(0, 2).forEach(d => overBand(a, d));
  planMovedOn(a, 2);
  const rv = a.weeklyReviewDue();
  assert.equal(rv.kind, 'hold');
  const cap = r1(rv.lastKm * 1.08);
  assert.ok(rv.plannedKm > cap + 2, 'the fixture plan is not a jump: ' + rv.plannedKm + ' after ' + rv.lastKm);
  assert.equal(rv.declineKm, cap);
  const c = a.weeklyReviewCopy(rv);
  assert.equal(c.no, 'Progress to ' + a.fmtDist(rv.delivered.no));
  assert.match(c.note, /Progressing instead takes the usual 8% step on last week, to [\d.]+km, not the [\d.]+km your plan had\./);
  answer(a, rv, false);
  const km = a.weekPlannedKm(2);
  assert.ok(km <= cap + 0.5, 'declining gave ' + km + ' after ' + rv.lastKm);
  assert.ok(km >= rv.recommendedKm - 0.05, 'declining gave less than holding');
  assert.equal(km, rv.delivered.no, 'the sheet quoted another week');
  assert.ok(a.toasts.some(t => t === 'This week is now ' + a.fmtDist(km) + '. The original sessions are kept and can be restored'), a.toasts.join(' | '));
});

test('A5: on the recovery sheet, Continue Progression is the usual step too', () => {
  const a = athlete(); logWeek(a, 1);
  a.state.days.filter(d => d.week === 1).slice(0, 4).forEach(d => { d.readiness = { legs: 'heavy', sleep: 'poor', date: d.date }; });
  planMovedOn(a, 2);
  const rv = a.weeklyReviewDue();
  assert.equal(rv.kind, 'recovery');
  assert.ok(rv.declineCapped);
  a.answerWeeklyReview(rv, 'progress');
  assert.ok(a.weekPlannedKm(2) <= r1(rv.lastKm * 1.08) + 0.5, 'continuing gave ' + a.weekPlannedKm(2) + ' after ' + rv.lastKm);
  assert.equal(a.weekPlannedKm(2), rv.options.progress, 'the choice quoted another week');
});

/* ---------- A6: THE WEEK AFTER A LIGHTER WEEK ---------- */

test('A6: the week after a recovery week taken on the sheet returns to the week before it, 8% at most', () => {
  const a = athlete(); logWeek(a, 1);
  a.state.days.filter(d => d.week === 1).slice(0, 4).forEach(d => { d.readiness = { legs: 'heavy', sleep: 'poor', date: d.date }; });
  const rv2 = a.weeklyReviewDue();
  assert.equal(rv2.kind, 'recovery');
  a.answerWeeklyReview(rv2, 'reload');
  const w1 = a.weekPlannedKm(1), w2 = a.weekPlannedKm(2);
  assert.ok(w2 < w1 - 1, 'the recovery week is not lighter');
  /* A week on: week two not logged (too little to read), and the plan's
     week three well above the week before the lighter one. */
  a.Date = makePinnedDate('2026-11-23T09:00:00Z');
  planMovedOn(a, 3);
  const rv = a.weeklyReviewDue();
  assert.ok(rv, 'no sheet');
  assert.ok(rv.reasons.includes('lighter_return'), rv.kind + ' ' + rv.reasons.join(','));
  const cap = r1(Math.max(w1, w2) * 1.08);
  assert.equal(rv.weekCeilingKm, cap);
  assert.match(sheetText(a, rv), /Last week was lighter, so this week returns to the week before it, [\d.]+km, with no more than 8% on top/);
  answer(a, rv, true);
  assert.ok(a.weekPlannedKm(3) <= cap + 0.5, 'week three is ' + a.weekPlannedKm(3) + ' after ' + w1 + ' and ' + w2);
});

/* ---------- A7: NO PRETEND CHOICE ---------- */

test('A7: a hold that declining could not change is one button, with no "either way"', () => {
  const a = athlete(); logWeek(a, 1);
  /* Easy runs cut short for time by more than a tenth of the week: the week
     builds from what was run, 8% more, and the usual step from it is the
     same week, so declining could not change it. */
  easy(a, 1).forEach(d => { d.actual.km = 3; d.actual.stopReason = 'time'; persist(a, d); });
  const rv = a.weeklyReviewDue();
  assert.equal(rv.kind, 'hold');
  assert.ok(rv.reasons.includes('time_cut_week'), rv.reasons.join(','));
  assert.equal(rv.delivered.same, true);
  const c = a.weeklyReviewCopy(rv);
  assert.equal(c.yes, 'Continue');
  assert.equal(c.no, null);
  assert.doesNotMatch(String(c.note), /Either way|instead/);
  const html = a.weeklyReviewSheetHtml(rv);
  assert.doesNotMatch(html, /weekly-decline/);
});

test('A7: after missed sessions, declining a hold is still the usual step, so there are two answers', () => {
  const a = athlete(); logWeek(a, 1);
  a.state.unloggedAck = {};
  easy(a, 1).slice(0, 2).forEach(d => { d.completed = false; d.actual = null; a.state.unloggedAck[d.id] = '2026-11-15'; });
  planMovedOn(a, 2);
  const rv = a.weeklyReviewDue();
  assert.equal(rv.kind, 'hold');
  assert.equal(rv.delivered.same, false);
  assert.ok(rv.delivered.no >= rv.delivered.yes + 1, 'the answers are ' + rv.delivered.yes + ' and ' + rv.delivered.no);
  assert.ok(rv.delivered.no <= Math.round(rv.lastKm * 1.08 * 10) / 10 + 0.5);
});

test('A7: a recovery sheet whose plan does not rise offers two choices, not three', () => {
  const a = athlete(); logWeek(a, 1);
  a.state.days.filter(d => d.week === 1).slice(0, 4).forEach(d => { d.readiness = { legs: 'heavy', sleep: 'poor', date: d.date }; });
  /* Week two no bigger than week one. */
  const over = a.weekPlannedKm(2) - a.weekPlannedKm(1);
  const e = easy(a, 2).sort((x, y) => y.km - x.km)[0];
  e.km = r1(e.km - over);
  assert.ok(a.weekPlannedKm(2) <= a.weekPlannedKm(1) + 0.05);
  const rv = a.weeklyReviewDue();
  assert.equal(rv.kind, 'recovery');
  assert.equal(rv.delivered.progressIsHold, true);
  const html = a.weeklyReviewSheetHtml(rv);
  assert.equal((html.match(/role="radio"/g) || []).length, 2, 'three choices, two of them the same week');
  assert.doesNotMatch(html, /Continue Progression/);
  assert.match(html, /continuing and holding are the same week/);
});

/* ---------- A8: THE FIGURE IS THE WEEK WRITTEN ---------- */

test('A8: after a cut-short week the sheet, the toast and the plan quote one week, holds included', () => {
  const a = athlete(); logWeek(a, 1);
  /* Easy runs and the long run cut short for time: the week is built from
     what was run, and the long run is held. */
  easy(a, 1).forEach(d => { d.actual.km = 3; d.actual.stopReason = 'time'; persist(a, d); });
  const lr = runs(a, 1).find(d => d.type === 'long');
  lr.actual.km = r1(lr.km * 0.6); lr.actual.stopReason = 'time'; persist(a, lr);
  const rv = a.weeklyReviewDue();
  assert.equal(rv.kind, 'hold');
  assert.ok(rv.reasons.includes('time_cut_week'), rv.reasons.join(','));
  assert.ok(rv.longHold, 'the long run is not held');
  const c = a.weeklyReviewCopy(rv);
  const fig = c.figures.find(f => f[0] === 'Recommended');
  assert.equal(fig[1], a.fmtDist(rv.recommendedKm));
  answer(a, rv, true);
  assert.equal(a.weekPlannedKm(2), rv.recommendedKm, 'the week written is not the figure shown');
  const rec = a.weeklyReviewStore()[a.weeklyReviewKey(2)];
  assert.equal(rec.recommendedKm, rec.finalKm);
  assert.ok(a.toasts.some(t => t.indexOf('Holding at ' + a.fmtDist(rv.recommendedKm) + ' this week') === 0), a.toasts.join(' | '));
  /* What the sheet says about the long run is the run it writes. */
  const lr2 = runs(a, 2).find(d => d.type === 'long');
  assert.match(c.why, new RegExp(a.fmtDist(lr2.km).replace('.', '\\.') + ' instead of'));
});

test('A8: a smaller week lands as close to its target as the runs allow', () => {
  const a = athlete(); logWeek(a, 1);
  const N = 2, target = r1(a.weekPlannedKm(N) * 0.8);
  a.applyWeekTarget(N, target, 'hold');
  const got = a.weekPlannedKm(N);
  assert.ok(Math.abs(got - target) <= 0.5, 'the week is ' + got + 'km for a ' + target + 'km target');
  runs(a, N).filter(d => d.type === 'easy').forEach(d => assert.ok(d.km >= 5, 'an easy run of ' + d.km + 'km'));
  const long = runs(a, N).find(d => d.type === 'long');
  assert.ok(long.km >= Math.max(...runs(a, N).filter(d => d.type === 'easy').map(d => d.km)), 'the long run is not the longest run');
});
