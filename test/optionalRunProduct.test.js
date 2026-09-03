'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* OPTIONAL RUN — THE PRODUCT CONTRACT
 * ===========================================================================
 * Valhalla has three athlete-facing day states, and they must never be
 * confused with one another:
 *
 *   REST DAY           Valhalla actively wants recovery. No invitation.
 *   OPTIONAL RUN       the athlete made the day available and Valhalla did not
 *                      need another prescribed run. Run or rest; both are
 *                      complete answers, and neither is scored.
 *   PRESCRIBED SESSION Valhalla wants the session performed. It counts.
 *
 * The hard part is not the card. It is that a logged optional run has to
 * become REAL completed activity -- evidence the frequency model reads -- while
 * changing nothing about what was PRESCRIBED. Every assertion below is about
 * one side of that line.
 *
 * The plan is built through the real generator for an athlete whose
 * demonstrated frequency (three days a week for a year) is below the six days
 * they say they are available, which is what makes the engine leave days free.
 */
const START = '2026-02-18';
const SCHEDULE = { activeDays: [0, 1, 2, 3, 5, 6], longRunDay: 6 };

function build(pinnedDate, opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: pinnedDate + 'T09:00:00Z' });
  a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {}; a.showToast = () => {};
  a.state = a.makeDefaultState();
  if (o.units) a.state.units = o.units;
  const monday = a.addDays(pinnedDate, -a.isoWeekday(pinnedDate));
  const sessions = [];
  for (let i = 0; i < 52; i++){
    const m = a.addDays(monday, -7 * (52 - i));
    for (let d = 0; d < 3; d++)
      sessions.push({ date: a.addDays(m, d), completed: true, actualKm: 9, plannedKm: 9 });
  }
  a.state.athlete = { sessions };
  const end = a.addDays(a.addDays(START, -a.isoWeekday(START)), 14 * 7 - 1);
  const schedule = o.schedule || SCHEDULE;
  a.state.days = a.buildDaysFromWeeks(a.buildBlockWeeks('half', 45, 14, {}), end, schedule, START, false);
  a.state.setup = { distanceKey: 'half', currentVolume: 45, planWeeks: 14, schedule: schedule,
    benchmark: { distanceKey: '10k', timeSec: 2700 }, goals: { A: { timeSec: 5400 } },
    activeGoal: 'A', paceOverrides: {}, lthr: 165, maxHR: 190, experience: 'experienced',
    startDate: START, raceDate: end, hasEvent: false, purpose: 'race',
    supportWork: o.support === false ? 'off' : 'on' };
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted',
    decidedAt: '2026-01-01T09:00:00.000Z', grantedAt: '2026-01-01T09:00:00.000Z', withdrawnAt: null };
  return a;
}
/* Which day the engine leaves free is the engine's answer, not the fixture's;
   the athlete is then stood on it, because the invitation and the logging form
   exist only on the day the run could actually have happened. */
function optionalToday(opts){
  const probe = build(START, opts);
  const free = probe.state.days.filter(d =>
    d.date > START && probe.optionalRunEligible(d, probe.state.days.filter(x => x.week === d.week)));
  assert.ok(free.length > 1, 'the fixture must produce free days');
  const on = free[1].date;
  const a = build(on, opts);
  const dd = a.state.days.filter(d => d.date === on)[0];
  assert.equal(a.optionalRunDayState(dd), 'offered', on + ' must be offered');
  return { a, dd };
}
function kinds(a){
  const out = { optional: [], protectedRest: [], notOffered: [], run: [] };
  a.state.days.forEach(d => {
    if (d.type !== 'rest'){ out.run.push(d); return; }
    const wk = a.state.days.filter(x => x.week === d.week);
    if (a.optionalRunEligible(d, wk)) out.optional.push(d);
    else if (d.availableUnused) out.protectedRest.push(d);
    else out.notOffered.push(d);
  });
  return out;
}
/* Log a run through the real path: the app's own field handler, then the app's
   own save. Nothing here writes dd.completed itself. */
function logRun(a, dd, km, pace){
  a.handleOptionalRunLog(dd.id);
  a.handleActualFieldChange(dd.id, 'km', String(km));
  if (pace) a.handleActualFieldChange(dd.id, 'pace', pace);
  a.handleOptionalRunSave(dd.id);
}
/* Far enough in that three plan weeks have closed behind the athlete. */
/* ---- STOOD WHERE THE ENGINE ACTUALLY LEAVES DAYS FREE ----
   This is five weeks into the block, which is right while the day builder
   still ramps this athlete's frequency in. HQ RACE GOAL TIGHT METHODOLOGY
   CORRECTION makes selected days training days from the FIRST week -- the
   solver may no longer withhold a selected day merely because it can fit
   the mileage into fewer sessions -- but the contract is a FLOOR
   (Math.max(mWeek.supportDays, mWeekContractDays)), never a ceiling that
   forces a day back open once demonstrated capacity earns it honestly. For
   THIS athlete (three days a week for a year, now given six selected days
   at a meaningfully higher volume) natural capacity still reaches all six
   selected days by week three, same as before the correction, and the
   engine leaves nothing free after week two. currentSustainedRunningFrequency()
   reads the last three COMPLETE weeks, so the athlete is stood at the first
   point where three have closed AND the free days are inside that window. */
const b_today = a => a.addDays(START, 7 * 2 + 3);
const plannedShape = a => a.state.days.map(d => d.date + ':' + d.type + ':' + (d.km || 0) + ':' +
  (d.title || '') + ':' + ((d.prescription || {}).archetype || '-') + ':' +
  JSON.stringify((d.prescription || {}).params || null)).join('\n');

// =====================================================================
// 1-4. THE THREE IDENTITIES
// =====================================================================

test('1. an optional-run day renders Optional Run as its PRIMARY identity', () => {
  const { a, dd } = optionalToday();
  const html = a.renderDayCard(dd);
  assert.match(html, /day-badge type-optional font-head">Optional</, 'the badge names it');
  assert.match(html, /<div class="day-title">Optional Run/, 'and so does the title');
  assert.match(html, /day-desc">No run needed today\./, 'and the headline answers it');
  assert.equal(a.dayTypeLabel(dd), 'Optional');
  assert.equal(a.displayCardTitle(dd), 'Optional Run');
  /* Presentation only: nothing about the stored day moved. */
  assert.equal(dd.type, 'rest');
  assert.equal(dd.title, 'Rest Day');
  assert.match(dd.desc, /Full rest/);
});

test('2. it does NOT also present itself as a Rest Day, on any surface', () => {
  const { a, dd } = optionalToday();
  /* Every athlete-facing renderer that can name this day, checked on the day
     itself rather than on the page around it. */
  const card = a.renderDayCard(dd);
  assert.doesNotMatch(card, /Rest Day/i);
  assert.doesNotMatch(card, /Full rest/i);
  assert.doesNotMatch(card, /day-badge type-rest/);

  const dayRegion = html => {
    const i = html.indexOf('id="day-' + dd.id + '"');
    assert.ok(i >= 0, 'the day must appear');
    const j = html.indexOf('id="day-', i + 10);
    return html.slice(i, j > 0 ? j : html.length);
  };
  [a.renderTodayView(), a.renderWeekView(), a.renderWeekAccordion(dd.week, true)]
    .forEach(h => {
      assert.doesNotMatch(dayRegion(h), /Rest Day/i);
      assert.doesNotMatch(dayRegion(h), /Full rest/i);
    });
  /* The push notification and the spoken briefing are surfaces too. */
  assert.match(a.buildTodayNotificationText().body, /Optional Run/);
  assert.doesNotMatch(a.buildTodayNotificationText().body, /Rest Day/i);
  const spoken = a.voiceBriefingScript(dd).lines.join(' ');
  assert.doesNotMatch(spoken, /rest day/i);
  assert.match(spoken, /optional/i);
  assert.equal(a.askLocalName(dd), 'Optional Run');
});

/* EVERY DAY AVAILABLE, because a protected rest day needs one that is spare.
   The six-day athlete above no longer has any after week two: prescribed
   frequency is a capacity now and it develops, so their week reaches the six
   days they offered and there is nothing left over to protect. A protected rest
   day is an AVAILABLE day the programme did not need and then declined to offer
   a run on, so the athlete who has one is the athlete with a day to spare. The
   rule under test -- that such a day renders Rest and invites nothing -- is
   unchanged, and so is every assertion below it. */
const ALL_DAYS = { activeDays: [0, 1, 2, 3, 4, 5, 6], longRunDay: 6 };
test('3. a protected rest day still renders Rest, and offers nothing', () => {
  const { a } = optionalToday({ schedule: ALL_DAYS });
  const k = kinds(a);
  assert.ok(k.protectedRest.length > 0 && k.notOffered.length > 0);
  k.protectedRest.concat(k.notOffered).forEach(d => {
    const html = a.renderDayCard(d);
    assert.match(html, /day-badge type-rest font-head">Rest</, d.date + ' keeps the rest badge');
    assert.match(html, /Rest Day/, d.date + ' keeps the rest title');
    assert.match(html, /Full rest/, d.date + ' keeps the rest instruction');
    assert.doesNotMatch(html, /optional-block/, d.date + ' must not be invited to run');
    assert.doesNotMatch(html, /Log a run/, d.date + ' must not offer logging');
    assert.equal(a.optionalRunDayState(d), null);
  });
});

test('4. a prescribed running day is completely untouched', () => {
  const { a } = optionalToday();
  const runs = kinds(a).run.filter(d => d.km > 0);
  assert.ok(runs.length > 0);
  runs.forEach(d => {
    assert.equal(a.optionalRunDayState(d), null, d.date);
    assert.doesNotMatch(a.renderDayCard(d), /optional-block|Optional Run/, d.date);
    assert.equal(a.dayTypeLabel(d), a.TYPE_META[d.type].label === undefined
      ? a.dayTypeLabel(d) : (d.type === 'race' ? a.dayTypeLabel(d) : a.TYPE_META[d.type].label));
  });
});

// =====================================================================
// 5-8. IT COSTS NOTHING AND IS OWED BY NOBODY
// =====================================================================

test('5. an optional run has zero planned distance', () => {
  const { a, dd } = optionalToday();
  assert.equal(dd.km, 0);
  const week = a.state.days.filter(d => d.week === dd.week);
  const planned = a.weekVolume(dd.week);
  assert.equal(planned.total, Math.round(week.reduce((t, d) => t + (d.km || 0), 0) * 10) / 10);
  logRun(a, dd, 5.2, '5:34');
  assert.equal(a.findDay(dd.id).km, 0, 'and still does once a run is logged');
  assert.equal(a.weekVolume(dd.week).total, planned.total, 'planned week volume never moves');
  assert.equal(a.weekVolume(dd.week).training, planned.training);
});

test('6. an optional run has zero planned load and no prescription', () => {
  const { a, dd } = optionalToday();
  const week = () => a.state.days.filter(d => d.week === dd.week);
  const without = week().filter(d => d.date !== dd.date);
  const s1 = a.horizonStimulus(week()), s0 = a.horizonStimulus(without);
  assert.equal(s1.totalKm, s0.totalKm);
  assert.equal(s1.qualityExposures, s0.qualityExposures);
  assert.equal(s1.sessions, s0.sessions);
  assert.equal(dd.prescription, undefined);
  assert.equal(a.coachLoadForDay ? a.coachLoadForDay(dd) : 0, 0);
});

test('7. an optional run does not count toward required adherence', () => {
  const { a, dd } = optionalToday();
  const before = a.computeStats();
  logRun(a, dd, 5.2, '5:34');
  const after = a.computeStats();
  assert.equal(after.totalRuns, before.totalRuns, 'it is not added to the runs required');
  assert.equal(after.completedRuns, before.completedRuns,
    'and not to the runs completed -- adherence is about prescribed work');
  assert.equal(after.totalKm, before.totalKm);
  assert.equal(after.completedKm, before.completedKm);
});

test('8. doing nothing on an optional day has no negative consequence', () => {
  const { a, dd } = optionalToday();
  /* The day is left alone and time passes: the card must never call it Missed,
     never score it, and never surface it as a session that did not happen. */
  const later = build(a.addDays(dd.date, 9));
  const same = later.state.days.filter(d => d.date === dd.date)[0];
  const html = later.renderDayCard(same);
  assert.doesNotMatch(html, /Missed/);
  assert.equal(later.computeExecutionScore(same), null);
  assert.equal(later.sessionRan(same), false);
  assert.equal(later.renderExecutionReview(same), '');
  /* And it is not among the sessions the coach counts as skipped. */
  const skipped = later.state.days.filter(d =>
    !d.completed && d.type !== 'rest' && d.date < later.todayStr());
  assert.equal(skipped.filter(d => d.id === same.id).length, 0);
});

// =====================================================================
// 9-13. IT IS A REAL COMPLETED ACTIVITY
// =====================================================================

test('9. Log a run records an actual completed activity', () => {
  const { a, dd } = optionalToday();
  assert.ok(!dd.completed, 'the generator leaves it uncompleted');
  logRun(a, dd, 5.2, '5:34');
  const d = a.findDay(dd.id);
  assert.equal(d.completed, true, 'the activity happened');
  assert.equal(d.optionalRun, true, 'and it is marked as the athlete’s own');
  /* Through the app’s own record shape, not a parallel one. */
  assert.ok(a.ACTUAL_MANUAL_FIELDS.indexOf('km') !== -1);
  assert.ok(a.ACTUAL_MANUAL_FIELDS.indexOf('pace') !== -1);
  assert.equal(d.date, dd.date, 'on the day it was run');
  const html = a.renderDayCard(d);
  assert.doesNotMatch(html, /Log a run/, 'the invitation is gone');
  assert.match(html, /Logged — Valhalla will take this into account/);
});

test('10. the actual distance persists, and is what is shown', () => {
  const { a, dd } = optionalToday();
  logRun(a, dd, 7.4, null);
  const d = a.findDay(dd.id);
  assert.equal(d.actual.km, 7.4);
  assert.match(a.renderDayCard(d), /7\.4km/);
});

test('11. the optional average pace persists, and is omitted when absent', () => {
  const { a, dd } = optionalToday();
  logRun(a, dd, 5.2, '5:34');
  const d = a.findDay(dd.id);
  assert.equal(d.actual.pace, '5:34');
  assert.equal(a.actualPaceSecPerKm(d), 334);
  assert.match(a.renderDayCard(d), /5\.2km · 5:34\/km/);

  const b = optionalToday();
  logRun(b.a, b.dd, 5.2, null);
  const e = b.a.findDay(b.dd.id);
  assert.equal(e.actual.pace, null);
  assert.equal(e.completed, true, 'a pace is never required to record a run');
  assert.match(b.a.renderDayCard(e), /5\.2km/);
  assert.doesNotMatch(b.a.renderDayCard(e), /·/, 'and nothing is invented in its place');
});

test('12. km/mi conversion is correct in both directions', () => {
  const { a, dd } = optionalToday({ units: 'mi' });
  const card = a.renderDayCard(dd);
  a.handleOptionalRunLog(dd.id);
  assert.match(a.renderDayCard(dd), /Distance MI/, 'the field is labelled in the athlete’s unit');
  assert.match(a.renderDayCard(dd), /Average pace \/mi/);
  /* Three miles typed in; kilometres stored; three miles shown back. */
  a.handleActualFieldChange(dd.id, 'km', '3.00');
  a.handleActualFieldChange(dd.id, 'pace', '9:00');
  a.handleOptionalRunSave(dd.id);
  const d = a.findDay(dd.id);
  assert.equal(d.actual.km, 4.8, '3 miles is 4.8 km stored');
  assert.equal(d.actual.paceUnit, 'mi', 'and the pace remembers what it was typed in');
  /* 2.98, not 3.00, and that is the app's own arithmetic rather than anything
     this card does: parseDistInput() stores kilometres to one decimal place, so
     4.828 km becomes 4.8 and reads back as 2.98 miles. Every logged session in
     miles has always round-tripped this way -- the optional run uses the one
     existing converter rather than a second one, which is the property under
     test here. Asserting 3.00 would be asserting a conversion the product does
     not perform. */
  assert.match(a.renderDayCard(d), /2\.98mi · 9:00\/mi/);
  assert.equal(a.kmToDisplay(d.actual.km), 2.98, 'shown is exactly what is stored, converted once');
  /* The same record read by an athlete who has switched to kilometres. */
  a.state.units = 'km';
  assert.match(a.renderDayCard(d), /4\.8km/);
  assert.equal(card.indexOf('optional-block') !== -1, true);
});

test('13. a completed optional run IS evidence for running frequency', () => {
  const { a, dd } = optionalToday();
  /* The statistic reads COMPLETE weeks before this Monday, so the proof is
     made on the week that already closed -- the same day, one week earlier,
     which the engine also left free. */
  const week = a.state.days.filter(d => d.week === dd.week);
  const before = a.completedRunningDaysByWeek();
  const monday = a.addDays(dd.date, -a.isoWeekday(dd.date));
  logRun(a, dd, 5.2, '5:34');
  const after = a.completedRunningDaysByWeek();
  assert.equal(after[monday], (before[monday] || 0) + 1,
    'the run the athlete chose is a running day like any other');
  assert.ok(week.length > 0);

  /* And it reaches currentSustainedRunningFrequency(), which reads the last
     three COMPLETE weeks -- so the athlete is stood far enough into the block
     for three of them to have closed, and each is given the optional run the
     engine left free in it. */
  const b = build(b_today(a));
  const thisMonday = b.addDays(b.todayStr(), -b.isoWeekday(b.todayStr()));
  const freeBefore = b.state.days.filter(d =>
    d.date < thisMonday && b.optionalRunEligible(d, b.state.days.filter(x => x.week === d.week)));
  const base = b.currentSustainedRunningFrequency();
  /* Those days are in the past, so the real handler correctly refuses to log
     them -- a run is recorded on the day it happened. The RECORD is written
     here directly instead, and it is the same record the real path produces:
     the shape is taken from the day logged through handleOptionalRunSave()
     above rather than invented, so this cannot drift from what the writer
     writes and still pass. */
  const written = a.findDay(dd.id);
  const record = { optionalRun: written.optionalRun, completed: written.completed,
                   actual: JSON.parse(JSON.stringify(written.actual)) };
  assert.equal(record.optionalRun, true);
  assert.equal(record.completed, true);
  assert.ok(record.actual.km > 0);
  freeBefore.forEach(d => { d.optionalRun = record.optionalRun; d.completed = record.completed;
                            d.actual = JSON.parse(JSON.stringify(record.actual)); });
  /* HQ RACE GOAL TIGHT METHODOLOGY CORRECTION tightened week one's own
     utilisation (a selected day is no longer left idle there either), which
     shrinks how much slack exists before capacity fills every selected day --
     two free days survive here (one in week one, one in week two) rather
     than the three a looser week one used to leave. That is the correction
     working as intended, not a fixture regression. */
  assert.ok(freeBefore.length >= 2, 'the fixture must offer enough closed weeks');
  assert.ok(b.currentSustainedRunningFrequency() > base,
    'training more often is visible to the model that reads how often you train');
});

// =====================================================================
// 14-18. AND IT REWRITES NOTHING
// =====================================================================

test('14. completing it does not rewrite planned weekly volume', () => {
  const { a, dd } = optionalToday();
  const before = a.state.days.map(d => d.date + ':' + (d.km || 0)).join(',');
  const vols = [...new Set(a.state.days.map(d => d.week))].filter(Boolean)
    .map(w => JSON.stringify({ w, t: a.weekVolume(w).total, tr: a.weekVolume(w).training }));
  logRun(a, dd, 12, '5:00');
  assert.equal(a.state.days.map(d => d.date + ':' + (d.km || 0)).join(','), before);
  assert.deepEqual([...new Set(a.state.days.map(d => d.week))].filter(Boolean)
    .map(w => JSON.stringify({ w, t: a.weekVolume(w).total, tr: a.weekVolume(w).training })), vols);
});

test('15. completing it creates no planned quality exposure', () => {
  const { a, dd } = optionalToday();
  const weeks = [...new Set(a.state.days.map(d => d.week))].filter(Boolean);
  const q = () => weeks.map(w => {
    const wd = a.state.days.filter(d => d.week === w);
    return a.horizonStimulus(wd).qualityExposures;
  }).join(',');
  const before = q();
  logRun(a, dd, 12, '3:40');            // fast enough to look like quality if anything did
  assert.equal(q(), before);
  const d = a.findDay(dd.id);
  assert.equal(a.isQualityType ? a.isQualityType(d.type) : false, false);
  assert.equal(a.sessionImportance(d), null, 'a rest day has no session importance');
});

test('16. completing it does not rewrite the original prescription', () => {
  const { a, dd } = optionalToday();
  const before = plannedShape(a);
  logRun(a, dd, 5.2, '5:34');
  assert.equal(plannedShape(a), before, 'every prescription in the plan is unchanged');
  const d = a.findDay(dd.id);
  assert.equal(d.title, 'Rest Day', 'the stored day is not rewritten either');
  assert.match(d.desc, /Full rest/);
  assert.equal(d.type, 'rest');
  assert.equal(d.prescription, undefined);
  assert.equal(d.manualEdit, undefined, 'and it is not recorded as an athlete edit of the plan');
});

test('17. a reload preserves a completed optional run', () => {
  const { a, dd } = optionalToday();
  logRun(a, dd, 5.2, '5:34');
  const sig = a.planContentSignature(a.state);
  /* Through the real serialisation the app stores and syncs. */
  const revived = build(a.todayStr());
  revived.state = JSON.parse(JSON.stringify(a.state));
  const d = revived.findDay(dd.id);
  assert.equal(d.completed, true);
  assert.equal(d.optionalRun, true);
  assert.equal(d.actual.km, 5.2);
  assert.equal(d.actual.pace, '5:34');
  assert.equal(revived.optionalRunDayState(d), 'logged');
  assert.match(revived.renderDayCard(d), /Logged — Valhalla/);
  assert.equal(revived.planContentSignature(revived.state), sig, 'and it signs the same');

  /* THE MARKER IS PART OF THE SIGNATURE, or a device that dropped it would
     adopt these kilometres as a prescribed session that was met. */
  const stripped = JSON.parse(JSON.stringify(a.state));
  delete stripped.days.filter(x => x.id === dd.id)[0].optionalRun;
  assert.notEqual(revived.planContentSignature(stripped), sig);
});

test('18. it can be corrected and removed through the same activity path', () => {
  const { a, dd } = optionalToday();
  logRun(a, dd, 5.2, '5:34');
  /* Correction re-opens the SAME fields, prefilled with what is stored. */
  a.handleOptionalRunLog(dd.id);
  const form = a.renderDayCard(a.findDay(dd.id));
  assert.match(form, /value="5\.2"/);
  assert.match(form, /value="5:34"/);
  a.handleActualFieldChange(dd.id, 'km', '6.1');
  a.handleOptionalRunSave(dd.id);
  assert.equal(a.findDay(dd.id).actual.km, 6.1);
  assert.equal(a.findDay(dd.id).completed, true);

  /* Removing it puts the day back exactly as the plan built it. */
  a.handleOptionalRunRemove(dd.id);
  const d = a.findDay(dd.id);
  assert.equal(d.completed, false);
  assert.equal(d.optionalRun, undefined);
  assert.equal(d.actual.km, null);
  assert.equal(a.optionalRunDayState(d), 'offered', 'and the offer comes back');
  assert.match(a.renderDayCard(d), /Log a run/);
});

// =====================================================================
// 19-20. AND THE NEIGHBOURS ARE UNHARMED
// =====================================================================

test('19. supporting work is untouched, and stays its own coaching system', () => {
  const { a, dd } = optionalToday();
  const weeks = [...new Set(a.state.days.map(d => d.week))].filter(Boolean);
  const selection = () => weeks.map(w => (a.supportForWeek(w) || [])
    .map(x => x.kind + '@' + x.dayId).join(',')).join('|');
  const before = selection();
  assert.ok(before.replace(/\|/g, '').length > 0, 'the fixture really prescribes supporting work');
  logRun(a, dd, 5.2, '5:34');
  assert.equal(selection(), before, 'logging a run does not move supporting work');
  /* The two never merge: an optional run is never named as a workout kind, and
     supporting work is never offered as a run. */
  Object.keys(a.SUPPORT_KINDS).forEach(k =>
    assert.doesNotMatch(a.renderDayCard(a.findDay(dd.id)).slice(
      a.renderDayCard(a.findDay(dd.id)).indexOf('optional-block')), new RegExp(k)));
  assert.equal(a.SUPPORT_KINDS.optional_run, undefined);
  assert.equal(a.SUPPORT_ORDER.indexOf('optional_run'), -1);
});

test('20. existing rest-day behaviour is intact', () => {
  const { a } = optionalToday();
  const k = kinds(a);
  k.protectedRest.concat(k.notOffered).forEach(d => {
    assert.equal(a.canToggleCompletion(d), false, d.date + ': a rest day is never ticked');
    assert.equal(a.applyCompletion(d, true), false, d.date + ': and never completed');
    assert.ok(!d.completed, d.date + ': and stays uncompleted');
    assert.equal(a.dayActionButton(d), '', d.date + ': and offers no edit');
  });
  /* applyCompletion() still refuses an optional day too -- the optional path is
     a different mutation, not a hole in that rule. */
  const { dd } = optionalToday();
  const opt = a.state.days.filter(d => d.date === dd.date)[0];
  assert.equal(a.applyCompletion(opt, true), false);
  assert.ok(!opt.completed);
});
