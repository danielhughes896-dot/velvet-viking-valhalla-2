'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* ILLNESS, METHODOLOGY BATCH 5 (founder-approved).
   Audit IV: illness reported midweek never reached the weekly review (it read
   only this morning's check-in), and after such weeks the review progressed
   97.6% of the time. The founder's decisions:
     1. one follow-up to Under the Weather: Head Cold Only, or Fever, Aches or
        Chest, stored with the day's readiness (readiness.illness);
     2. after a systemic illness, running resumes only after two Good health
        check-ins in a row (an automatic illness restriction ends at the gate);
     3. a phased return by days missed (1-3, 4-7, 8+), through restorable
        day changes, said on a glass sheet;
     4. the heart-rate note on every run of the return and on head-cold days;
     5. raised heart rate is not recovery strain during the return;
     6. a systemic morning in the reviewed week protects the next week, a head
        cold holds it at most. */

/* 17 November 2026 is a Tuesday (week 4 of a half-marathon block that began
   on Monday 26 October). Everything before it is logged as prescribed. */
const NOW = '2026-11-17';
function athlete(o){
  const opts = o || {};
  const now = opts.now || NOW;
  const a = loadApp({ pinnedDate: now + 'T08:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', startDate: '2026-10-26',
                 healthConsent: opts.healthConsent !== false, lthr: 170, maxHR: 190 });
  a.state.days.filter(d => d.date < now && d.km > 0).forEach(d => logAsPrescribed(a, d, { sections: true }));
  a.__opened = [];
  a.openModal = (html, cls) => { a.__opened.push({ html, cls }); };
  a.closeModal = () => { a.__opened.push({ closed: true }); };
  return a;
}
const plain = x => JSON.parse(JSON.stringify(x));
const on = (a, date) => a.findDayByDate(date);
/* A morning's check-in, answered through the real handler, on `date`. */
function morning(a, date, health, illness){
  a.todayStr = () => date;
  a.handleSetReadiness('legs', 'normal');
  a.handleSetReadiness('sleep', 'ok');
  a.handleSetReadiness('health', health);
  if (illness) a.handleSetReadiness('illness', illness);
}
const ran = (a, d) => { logAsPrescribed(a, d, { sections: true }); };

test('the follow-up is asked only after Under the Weather, in the same Title Case chips, and only with consent', () => {
  const a = athlete();
  a.todayStr = () => NOW;
  assert.doesNotMatch(a.checkinSheetBody(), /Head Cold Only/);
  a.handleSetReadiness('illness', 'head');
  assert.equal(on(a, NOW).readiness == null || on(a, NOW).readiness.illness == null, true,
    'no follow-up answer without Under the Weather');
  a.handleSetReadiness('health', 'under');
  const body = a.checkinSheetBody();
  assert.match(body, /data-rk="illness" data-rv="head">Head Cold Only</);
  assert.match(body, /data-rk="illness" data-rv="systemic">Fever, Aches or Chest</);
  assert.match(body, /class="readiness-btn" aria-pressed="false" data-action="set-readiness" data-rk="illness"/);
  a.handleSetReadiness('illness', 'head');
  assert.equal(on(a, NOW).readiness.illness, 'head');
  /* Feeling better clears the follow-up with the answer it followed. */
  a.handleSetReadiness('health', 'good');
  assert.equal(on(a, NOW).readiness.illness, null);

  const b = athlete({ healthConsent: false });
  b.todayStr = () => NOW;
  b.handleSetReadiness('health', 'under');
  b.handleSetReadiness('illness', 'systemic');
  assert.ok(!on(b, NOW).readiness, 'nothing is accepted without health consent');
  assert.equal(b.openRestriction(), null);
});

test('Under the Weather keeps the sheet open for the follow-up; answering it finishes the check-in', () => {
  const a = athlete();
  a.todayStr = () => NOW;
  a.checkinSheetIsOpen = () => true;
  let reopened = 0;
  a.openCheckinSheet = () => { reopened++; };
  a.handleSetReadiness('legs', 'normal');
  a.handleSetReadiness('sleep', 'ok');
  a.handleSetReadiness('health', 'under');
  assert.equal(a.__opened.filter(o => o.closed).length, 0, 'not finished: the follow-up is still to ask');
  assert.equal(reopened, 3);
  a.handleSetReadiness('illness', 'head');
  assert.equal(a.__opened.filter(o => o.closed).length, 1, 'the follow-up finishes it');
  assert.equal(a.checkinIsFinished(a.coachReadinessToday()), true);
});

test('a head cold: no gate, the day stands, and its run carries the heart-rate note', () => {
  const a = athlete();
  const today = on(a, NOW);
  const before = today.type + ':' + today.km;
  morning(a, NOW, 'under', 'head');
  assert.equal(a.openRestriction(), null, 'a head cold does not stop running');
  assert.equal(today.type + ':' + today.km, before);
  assert.equal(a.illnessHrNoteFor(today), a.ILLNESS_HR_NOTE);
  assert.match(a.renderDayCard(today), /Your heart rate may sit 10 to 15 beats higher at your usual easy pace for a while after illness\. Run by feel and keep it easy; don.t chase the pace\./);
  assert.equal(a.illnessHrNoteFor(on(a, '2026-11-18')), '', 'only on the day they reported it');
  assert.doesNotMatch(a.ILLNESS_HR_NOTE, /—/, 'no em dash');
});

test('fever, aches or chest shuts the gate: no running until two Good check-ins in a row', () => {
  const a = athlete();
  const tue = on(a, NOW), wed = on(a, '2026-11-18'), thu = on(a, '2026-11-19');
  morning(a, NOW, 'under', 'systemic');
  const r = a.openRestriction();
  assert.ok(r && r.illness === 'systemic' && r.auto, 'an automatic illness restriction');
  assert.equal(r.level, 'none');
  assert.equal(tue.type, 'rest'); assert.equal(wed.type, 'rest');
  assert.ok(tue.restricted && wed.restricted);
  assert.equal(a.recoveryCheckBlocked('checkin'), true, 'the Recovery Check stands down');
  assert.equal(a.weeklyInstrumentSignals().restricted, true);
  /* Said once, on a glass sheet, with the doctor line beside the boundary. */
  assert.equal(a.illnessSheetQueued, 'rest');
  const sheet = a.illnessSheetHtml('rest');
  assert.match(sheet, /Rest Until You Are Well/);
  assert.match(sheet, /If your chest is involved, see a doctor before you run again\./);
  assert.match(sheet, /a running coach, not a doctor/);
  assert.match(sheet, />Got It</);
  assert.doesNotMatch(sheet, /—/);

  /* One Good morning is not the gate. The gate rolls a day ahead. */
  morning(a, '2026-11-18', 'good');
  assert.ok(a.openRestriction(), 'still shut after one Good morning');
  assert.equal(thu.type, 'rest', 'tomorrow waits for today to be Good');
  assert.equal(a.restrictionAwaitingReturn(), null, 'no end date to be "back" from');
  /* The second Good in a row opens it, and the return is applied. */
  morning(a, '2026-11-19', 'good');
  assert.equal(a.openRestriction(), null, 'the gate is open');
  assert.equal(a.illnessSheetQueued, 'return');
});

test('changing the answer the same morning puts the plan back exactly as it was', () => {
  const a = athlete();
  const sig = () => a.state.days.filter(d => d.date >= NOW).map(d => d.type + d.km).join('|');
  const before = sig();
  morning(a, NOW, 'under', 'systemic');
  assert.notEqual(sig(), before);
  a.handleSetReadiness('illness', 'head');
  assert.equal(a.openRestriction(), null);
  assert.equal(sig(), before);
  assert.ok(!on(a, NOW).restricted);
});

test('1 to 3 days missed: the next two runs easy at 75%, then the normal schedule, restorable', () => {
  const a = athlete();
  const thu = on(a, '2026-11-19'), sun = on(a, '2026-11-22');
  const wrote = { thu: thu.km, sun: sun.km, sunType: sun.type };
  morning(a, NOW, 'under', 'systemic');
  morning(a, '2026-11-18', 'good');
  morning(a, '2026-11-19', 'good');
  const w = a.illnessReturnWindow();
  assert.equal(w.missed, 2); assert.equal(w.phase, 'short');
  assert.deepEqual(plain(w.changed), [thu.id, sun.id]);
  [thu, sun].forEach(d => {
    assert.equal(d.type, 'easy');
    assert.equal(d.weeklyAdjust.kind, 'illness_return', 'kept, so it can be put back');
    assert.equal(d.prescription.archetype, 'easy_run');
  });
  assert.equal(thu.km, 5, '75% of 6.5km, never an easy run under 5km');
  assert.equal(sun.km, 7, '75% of the 9km long run');
  /* The week after carries on as written. */
  assert.ok(!on(a, '2026-11-24').weeklyAdjust);
  const sheet = a.illnessSheetHtml('return');
  assert.match(sheet, /Easing Back After Illness/);
  assert.match(sheet, /You were unwell for 2 days\. Your next 2 runs are easy, at about three quarters of their usual distance\. Then your plan carries on as normal\./);
  assert.match(sheet, /don.t chase the pace/);
  assert.match(sheet, /Restore My Sessions/);
  assert.equal(a.illnessHrNoteFor(thu), a.ILLNESS_HR_NOTE);
  /* Restored. */
  assert.equal(a.illnessRestoreReturn(), 2);
  assert.equal(thu.km, wrote.thu); assert.equal(sun.km, wrote.sun); assert.equal(sun.type, wrote.sunType);
});

test('4 to 7 days missed: the 1:1 rule, easy only from 65% to 85%, no intensity until the next week', () => {
  const a = athlete();
  morning(a, NOW, 'under', 'systemic');
  ['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'].forEach(d => morning(a, d, 'under', 'systemic'));
  morning(a, '2026-11-22', 'good');
  morning(a, '2026-11-23', 'good');
  const w = a.illnessReturnWindow();
  assert.equal(w.missed, 6); assert.equal(w.phase, 'one_to_one');
  assert.equal(w.from, '2026-11-23'); assert.equal(w.until, '2026-11-28');
  const win = a.state.days.filter(d => d.date >= '2026-11-23' && d.date <= '2026-11-28' && d.km > 0);
  assert.ok(win.length >= 3);
  win.forEach(d => {
    assert.equal(d.type, 'easy', d.date);
    assert.ok(d.km <= d.weeklyAdjust.from.km, d.date + ' never above what SACORO wrote');
  });
  /* Where the 5km easy-run floor (A5) does not bite, the share builds from
     about 65% towards 85%. */
  const shares = win.filter(d => d.weeklyAdjust.from.km * 0.65 >= 5).map(d => d.km / d.weeklyAdjust.from.km);
  assert.ok(shares.length >= 2);
  shares.forEach(s => assert.ok(s >= 0.6 && s <= 0.9, String(s)));
  assert.ok(shares[shares.length - 1] > shares[0], 'builds: ' + shares.join(','));
  assert.equal(on(a, '2026-11-24').km, 5, 'a 5km hard day becomes a 5km easy run, never under 5km');
  const week = on(a, '2026-11-28').week;
  a.state.days.filter(d => d.week === week && d.date >= '2026-11-23').forEach(d =>
    assert.ok(['easy', 'long', 'rest'].includes(d.type), d.date + ' is ' + d.type));
  assert.match(a.illnessSheetHtml('return'), /so you take 6 days to come back/);
});

test('8 days or more: a two-week rebuild, all easy, then strides, then the full plan', () => {
  const a = athlete();
  morning(a, NOW, 'under', 'systemic');
  for (let d = a.addDays(NOW, 1); d < '2026-11-27'; d = a.addDays(d, 1)) morning(a, d, 'under', 'systemic');
  morning(a, '2026-11-27', 'good');
  morning(a, '2026-11-28', 'good');
  const w = a.illnessReturnWindow();
  assert.equal(w.missed, 11); assert.equal(w.phase, 'rebuild');
  assert.equal(w.until, '2026-12-11');
  const wk1 = a.state.days.filter(d => d.date >= '2026-11-28' && d.date <= '2026-12-04' && d.km > 0 && d.type !== 'checkpoint');
  wk1.forEach(d => { assert.equal(d.type, 'easy', d.date); const s = d.km / d.weeklyAdjust.from.km; assert.ok(s <= 1 && s >= 0.55, d.date + ' ' + s); });
  const wk2 = a.state.days.filter(d => d.date >= '2026-12-05' && d.date <= '2026-12-11' && d.km > 0);
  assert.ok(wk2.length);
  wk2.forEach(d => assert.ok(['easy', 'long', 'checkpoint', 'race'].includes(d.type), d.date + ' ' + d.type));
  wk2.filter(d => d.weeklyAdjust && d.weeklyAdjust.from && !['easy', 'long'].includes(d.weeklyAdjust.from.type))
    .forEach(d => assert.equal(d.prescription.archetype, 'easy_strides', d.date + ': a hard day in week two comes back as light strides'));
  assert.ok(wk2.some(d => d.prescription && d.prescription.archetype === 'easy_strides'));
  assert.ok(!a.state.days.some(d => d.date > '2026-12-11' && d.weeklyAdjust && d.weeklyAdjust.kind === 'illness_return'),
    'week three is the plan');
  assert.match(a.illnessSheetHtml('return'), /rebuild over two weeks/);
});

test('heart rate during the return and on unwell mornings is not recovery strain', () => {
  /* Two easy runs over their zone: "Running Hotter Than Usual" and a point of
     strain, ordinarily. */
  const hot = a => a.state.days.filter(d => d.type === 'easy' && d.completed && d.date >= '2026-11-11' && d.date < NOW)
    .map(d => { d.actual.hr = a.executionHRTarget(d).hi + 6; return d; });
  const base = athlete();
  hot(base);
  assert.ok(base.coachRecovery().overHR >= 2);
  assert.ok(base.recoveryCheckHrFlag());

  const a = athlete();
  hot(a).forEach(d => { d.readiness = { legs: 'normal', sleep: 'ok', health: 'under', illness: 'head' }; });
  assert.equal(a.coachRecovery().overHR, 0);
  assert.equal(a.recoveryCheckHrFlag(), null);

  /* And inside the return window after a systemic illness. */
  const b = athlete();
  morning(b, NOW, 'under', 'systemic');
  morning(b, '2026-11-18', 'good');
  morning(b, '2026-11-19', 'good');
  const thu = on(b, '2026-11-19');
  ran(b, thu); thu.actual.hr = b.executionHRTarget(thu).hi + 12;
  b.todayStr = () => '2026-11-20';
  assert.equal(b.illnessHrExcused(thu), true);
  assert.equal(b.coachRecovery().evidence.filter(e => e === 'hr:' + thu.id).length, 0);
});

test('midweek illness reaches the weekly review: systemic protects, a head cold holds', () => {
  /* 3 November 2026: the review of week 2 reads week 1, which went to plan
     and ordinarily progresses. */
  const REVIEW = '2026-11-03';
  const base = athlete({ now: REVIEW });
  const N = base.currentWeekNum();
  assert.equal(base.weeklyCoachingReview(N).kind, 'progress');

  const sys = athlete({ now: REVIEW });
  on(sys, '2026-10-28').readiness = { legs: 'normal', sleep: 'ok', health: 'under', illness: 'systemic' };
  const rs = sys.weeklyCoachingReview(N);
  assert.equal(rs.kind, 'protect');
  assert.ok(rs.reasons.includes('ill_systemic'));
  assert.match(sys.weeklyReviewCopy(rs).why, /you were ill with a fever, aches or chest symptoms/);

  const head = athlete({ now: REVIEW });
  on(head, '2026-10-28').readiness = { legs: 'normal', sleep: 'ok', health: 'under', illness: 'head' };
  const rh = head.weeklyCoachingReview(N);
  assert.equal(rh.kind, 'hold', 'at most a hold');
  assert.deepEqual(plain(rh.reasons), ['unwell_head']);
  assert.match(head.weeklyReviewCopy(rh).why, /Last week you were under the weather on one morning\./);

  /* This morning's head cold holds rather than protects. */
  const today = athlete({ now: REVIEW });
  on(today, REVIEW).readiness = { legs: 'normal', sleep: 'ok', health: 'under', illness: 'head' };
  assert.equal(today.weeklyCoachingReview(N).kind, 'hold');
  /* Without consent none of it is read. */
  const nc = athlete({ now: REVIEW, healthConsent: false });
  on(nc, '2026-10-28').readiness = { legs: 'normal', sleep: 'ok', health: 'under', illness: 'systemic' };
  assert.equal(nc.weeklyCoachingReview(N).kind, 'progress');
});

test('a week the illness rested is protected from what it was written as, not from its rest days', () => {
  const a = athlete({ now: '2026-11-24' });
  /* Week 4 as the gate left it: the athlete was ill from the Tuesday and the
     runs were rested by the restriction. */
  const wk4 = a.state.days.filter(d => d.week === 4);
  wk4.filter(d => d.date >= '2026-11-17' && d.km > 0).forEach(d => {
    d.restricted = { at: 'x', level: 'none', from: a.workoutSnapshot(d) };
    d.completed = false; delete d.actual;
    d.type = 'rest'; d.km = 0;
  });
  on(a, '2026-11-17').readiness = { legs: 'normal', sleep: 'ok', health: 'under', illness: 'systemic' };
  const rv = a.weeklyCoachingReview(5);
  assert.equal(rv.kind, 'protect');
  assert.ok(rv.recommendedKm >= a.round1(Math.min(a.weeklyWrittenKm(4), rv.plannedKm) * 0.85) - 0.01, String(rv.recommendedKm));
  assert.ok(rv.recommendedKm > rv.lastKm, 'not cut from the rest days');
});
