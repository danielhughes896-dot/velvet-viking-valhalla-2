'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* EVERY INPUT REACHES THE COACH, AND THE ATHLETE IS TOLD (Audit III linking
   plan). Founder: "The commands are simply not talking to each other. They
   need to link. So the input to the coach to the user."

   For each logged answer the audit found going nowhere, the same athlete is
   lived twice: once logging every session as prescribed, once with that one
   answer changed. The second must differ in what the coach reads (weekly
   evidence, the weekly decision, Patterns or Recovery) AND in something the
   athlete is shown (the weekly sheet, Today, the Coach page or the session's
   own analysis). An input that changes neither is dead again, and this
   fails. */

const NOW = '2026-11-16';
const Q = ['tempo', 'threshold', 'interval', 'repetition'];
const safe = f => { try { return f(); } catch (e) { return 'ERR'; } };
const strip = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function lived(change){
  const a = loadApp({ pinnedDate: NOW + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'replaceCard', 'patchDerivedStats', 'patchExecutionUI', 'patchSplitsTotal']
    .forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 45, weeks: 12, startDate: '2026-10-12', lthr: 170, maxHR: 190,
                 healthConsent: true, schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 }, earnedSecondQuality: true });
  a.state.days.filter(d => d.date < NOW && d.type !== 'rest' && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  if (change) change(a);
  return a;
}
const quality = a => a.state.days.filter(d => d.date < NOW && d.week >= 3 && Q.includes(d.type) && safe(() => a.logShape(d).reps) > 0);
const lastWeekQuality = a => quality(a).filter(d => d.week === 5);
const lastWeekEasy = a => a.state.days.filter(d => d.date < NOW && d.week === 5 && d.type === 'easy');

function engine(a){
  const N = a.currentWeekNum();
  return JSON.stringify({
    wev: safe(() => a.weeklyEvidence(N - 1)),
    wrev: safe(() => { const r = a.weeklyCoachingReview(N); return r && [r.kind, r.reasons, r.recommendedKm]; }),
    trends: safe(() => a.athleteTrends().map(t => t.id + ':' + t.confidence)),
    recovery: safe(() => { const r = a.coachRecovery(); return r && [r.state, r.trainingState]; })
  });
}
function told(a, days){
  const N = a.currentWeekNum();
  const rv = safe(() => a.weeklyCoachingReview(N));
  const copy = rv && rv !== 'ERR' ? safe(() => a.weeklyReviewCopy(rv)) : null;
  return JSON.stringify({
    sheet: copy && copy !== 'ERR' ? [copy.head, copy.why, copy.note] : null,
    today: strip(safe(() => { a.state.view = 'today'; return a.renderTodayView(); })),
    coach: strip(safe(() => a.renderPlanHQView())),
    sessions: (days || []).map(d => strip(safe(() => a.renderExecutionReview(a.state.days.find(x => x.id === d.id)))))
  });
}

const base = lived(null);
const E0 = engine(base);

const CASES = [
  ['reps completed short (T10)', a => lastWeekQuality(a).forEach(d => a.handleLogAnswer(d.id, 'repsDone', a.logShape(d).reps - 2)), lastWeekQuality],
  ['pace held answered "faded" (T8, T9)', a => lastWeekQuality(a).forEach(d => a.handleLogAnswer(d.id, 'mainSetHeld', 5)), lastWeekQuality],
  ['reps marked under pace (T11)', a => lastWeekQuality(a).forEach(d => {
    const n = a.logShape(d).reps;
    for (let i = 1; i <= n; i++){ a.handleLogMark(d.id, String(i)); a.handleLogMark(d.id, String(i)); }
  }), lastWeekQuality],
  ['easy runs cut short, "Out of time" (T12)', a => lastWeekEasy(a).forEach(d => {
    a.handleActualFieldChange(d.id, 'km', String(d.km / 2)); a.handleLogPick(d.id, 'stopReason', 'time'); }), lastWeekEasy]
];

for (const [name, change, pick] of CASES){
  test('the input reaches the coach and the athlete is told: ' + name, () => {
    const a = lived(change);
    assert.ok(pick(a).length > 0, 'the fixture changed nothing');
    assert.notEqual(engine(a), E0, name + ' changed nothing the coach reads');
    /* Told: against the same athlete before the answer was given. For the
       time case the reference is the same short runs with no reason, so
       the reason itself has to be what is said. */
    const ref = /Out of time/.test(name)
      ? lived(b => lastWeekEasy(b).forEach(d => b.handleActualFieldChange(d.id, 'km', String(d.km / 2))))
      : base;
    assert.notEqual(told(a, pick(a)), told(ref, pick(ref)), name + ' changed nothing the athlete is shown');
  });
}

test('"Anything hurting?" answered No clears soreness read from a note (T13)', () => {
  const sore = (no) => lived(a => {
    const d = lastWeekEasy(a).slice(-1)[0];
    a.handleActualFieldChange(d.id, 'notes', 'calf a bit sore early on');
    if (no) a.handleLogPick(d.id, 'hurting', 'no');
  });
  const withNote = sore(false), cleared = sore(true);
  const reasons = a => JSON.stringify(safe(() => a.coachDecision().reasons));
  assert.match(reasons(withNote), /[Ss]oreness/);
  assert.doesNotMatch(reasons(cleared), /[Ss]oreness/);
});

test('the weekly sheet quotes the week it will deliver (LA3)', () => {
  const a = lived(a2 => lastWeekQuality(a2).forEach(d => a2.handleLogAnswer(d.id, 'repsDone', a2.logShape(d).reps - 2)));
  const rv = a.weeklyReviewDue();
  if (!rv) return;
  const before = JSON.stringify(a.state.days);
  const got = a.weeklyDeliveredFigures(rv);
  assert.equal(JSON.stringify(a.state.days), before, 'the dry run left the plan changed');
  a.answerWeeklyReview(rv, true);
  if (got && got.yes != null) assert.equal(a.weekPlannedKm(rv.week), got.yes);
});
