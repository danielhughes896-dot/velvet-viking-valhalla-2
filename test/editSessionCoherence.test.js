'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

// VALHALLA -- EDIT SESSION MUST NOT LEAVE STALE COACHING IDENTITY BEHIND.
//
// REPRODUCED DEFECT. An athlete edits an Easy session's title, distance and
// instructions to "10km best effort" and turns on the goal-pace segment, but
// leaves Session Type set to Easy. After saving, the card still classified
// as Easy, still showed the Easy pace cue, and "How to run this" still said
// WHY: "Builds the aerobic base..." -- an invalid state: TYPE Easy +
// INSTRUCTION "10km best effort" + WHY "Builds the aerobic base..." cannot
// both be true.
//
// ROOT CAUSE. handleSaveEdit() already deletes dd.prescription on a
// structural edit (type/desc/mpSegment changed) -- so the STRUCTURED workout
// display was already correct. But every narrative guidance table
// (COACH_GUIDANCE, SESSION_INTENT_BY_TYPE, SESSION_PURPOSE) and
// coachComparable()'s same-type matching all fall back to dd.type once the
// prescription/archetype is gone, with no check for whether dd.type itself
// is still a trustworthy description of what was actually written. A type
// EXPLICITLY changed by the athlete is trusted outright (test 1); an
// untouched or cosmetically-edited day (title/km only) is unaffected (test
// 2); a day whose desc/mpSegment changed without a matching type change is
// no longer trusted for any of these lookups (test 3) -- see
// sessionIdentityTrusted() in the runtime.
//
// DELIBERATELY UNCHANGED, and why: the Session Type LABEL and its semantic
// colour stay exactly what the athlete picked (TYPE is the one field the
// athlete can use to explicitly resolve the question; hiding what they
// picked would be its own incoherence). The zone-pace fallback
// getTargetPaceRangeSecPerKm()/executionMix() used for SCORING is left
// alone -- it is a different, pre-existing, documented fallback ("nothing
// about those days changes") that compares actual pace against a zone
// window for hand-edited days generally, not a narrative-copy staleness
// bug. coachTrainingSignal()'s maximal-effort check reads the CURRENT
// dd.type live at evaluation time, not a cached table -- there is nothing
// stale about it to fix; if it disagrees with what the athlete wrote, that
// is exactly the coherence question Session Type is meant to resolve.

const TODAY = '2026-06-09';

function mockEditModalDom(app, dd, overrides) {
  const base = {
    'ef-title': { value: dd.title || 'Untitled Session' },
    'ef-type': { value: dd.type },
    'ef-km': { value: String(dd.km) },
    'ef-mp': { checked: !!dd.mpSegment },
    'ef-desc': { value: app.resolveDesc(dd.desc) },
    'ef-swap': { value: '' },
  };
  Object.assign(base, overrides || {});
  app.document.getElementById = (id) => base[id] || null;
}

function plannedApp() {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, 7) }); // all future -- nothing pre-completed
  a.showToast = () => {};
  a.canEditPrescription = () => true;
  a.canEditCompletion = () => false;
  return a;
}

function findEasyDay(a) {
  return a.state.days.find((d) => d.type === 'easy');
}

test('1. Easy -> another existing type (Tempo): dependent coaching guidance updates', () => {
  const a = plannedApp();
  const dd = findEasyDay(a);
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'Now Tempo' }, 'ef-type': { value: 'tempo' },
    'ef-km': { value: '8' }, 'ef-desc': { value: 'Tempo run' },
  });
  a.handleSaveEdit(dd.id);
  const after = a.findDay(dd.id);
  assert.equal(after.type, 'tempo');
  assert.equal((a.coachingEntryFor(after) || {}).cue, a.COACH_GUIDANCE.tempo.cue);
  assert.equal(a.coachIntentLine(after), a.SESSION_INTENT_BY_TYPE.tempo);
  assert.equal((a.sessionPurpose(after) || {}).label, a.SESSION_PURPOSE.tempo.label);
  assert.doesNotMatch(a.coachingEntryFor(after).why, /aerobic base/,
    'the stale Easy WHY must not survive a type change');
});

test('2. title/distance edited only, still genuinely Easy: Easy guidance remains', () => {
  const a = plannedApp();
  const dd = findEasyDay(a);
  const unchangedDesc = a.resolveDesc(dd.desc);
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'My easy run' }, 'ef-km': { value: '7' },
    'ef-desc': { value: unchangedDesc },
  });
  a.handleSaveEdit(dd.id);
  const after = a.findDay(dd.id);
  assert.equal(after.type, 'easy');
  assert.equal(after.manualEdit.fields.sort().join(','), 'km,title');
  assert.equal((a.coachingEntryFor(after) || {}).cue, a.COACH_GUIDANCE.easy.cue);
  assert.equal(a.coachIntentLine(after), a.SESSION_INTENT_BY_TYPE.easy);
  assert.equal((a.sessionPurpose(after) || {}).label, 'Easy Aerobic');
});

test('3. materially contradictory custom prescription cannot retain stale Easy guidance', () => {
  const a = plannedApp();
  const dd = findEasyDay(a);
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'Lavidia race race' }, 'ef-type': { value: 'easy' },
    'ef-km': { value: '10' }, 'ef-mp': { checked: true },
    'ef-desc': { value: '10km best effort' },
  });
  a.handleSaveEdit(dd.id);
  const after = a.findDay(dd.id);
  // The reproduced example, verified exactly: type left as Easy.
  assert.equal(after.type, 'easy');
  assert.equal(after.km, 10);
  assert.equal(after.desc, '10km best effort');
  assert.equal(after.mpSegment, true);
  assert.equal(after.prescription, undefined, 'the structure was already correctly dropped');
  // The invalid combination itself: no WHY, no cue, no purpose, no intent
  // line may survive from the Easy archetype now that the words no longer
  // describe an easy run.
  assert.equal(a.coachingEntryFor(after), null);
  assert.equal(a.coachingKeyFor(after), null);
  assert.equal(a.coachIntentLine(after), '');
  assert.equal(a.sessionPurpose(after), null);
  assert.equal(a.renderCoachingDepth(after), '',
    'the whole "How to run this" block, cue included, must not render');
  // The pace/effort PRESCRIPTION line must not print the Easy zone band next
  // to hand-written "10km best effort" instructions either -- same defect,
  // same fix, one shared function (getDayTargets()).
  const targets = a.getDayTargets(after);
  assert.equal(targets.pace, null, 'no stale Easy-zone pace target');
  assert.equal(targets.hr, null, 'no stale Easy-zone HR target');
  // The athlete's own goal race pace is not a type-zone lookup and survives.
  assert.equal(targets.goalPace, 'Goal ' + a.fmtPaceFromSecPerKm(a.getGoalPaceSecPerKm()));
  // renderDayCard() renders getDayTargets() verbatim into .day-targets, so a
  // pace RANGE (the only "–"-joined figure getDayTargets ever produces) can
  // only appear there if the Easy zone leaked back in.
  const cardTargets = (a.renderDayCard(after).match(/class="day-targets">([\s\S]*?)<\/div>/) || [])[1] || '';
  assert.doesNotMatch(cardTargets, /\d:\d\d\u2013\d:\d\d/, 'no pace band may appear in the card\'s target line');
  // And the daily notification body, which reads the same function.
  after.date = a.todayStr();
  a.state.days = [after];
  assert.doesNotMatch(a.buildTodayNotificationText().body, /\/km/,
    'the notification must not carry a stale Easy pace band either');
  // Never allow the specific banned sentence back in under any call shape.
  const everything = JSON.stringify([a.coachingEntryFor(after), a.coachIntentLine(after),
    a.sessionPurpose(after), a.renderCoachingDepth(after)]);
  assert.doesNotMatch(everything, /aerobic base/i);
  assert.doesNotMatch(everything, /banking aerobic time/i);
  assert.doesNotMatch(everything, /conversational the whole way/i);
});

test('3b. the same contradiction with only mpSegment changed (type and desc untouched) is caught too', () => {
  const a = plannedApp();
  const dd = findEasyDay(a);
  const unchangedDesc = a.resolveDesc(dd.desc);
  mockEditModalDom(a, dd, { 'ef-desc': { value: unchangedDesc }, 'ef-mp': { checked: true } });
  a.handleSaveEdit(dd.id);
  const after = a.findDay(dd.id);
  assert.equal(after.manualEdit.fields.join(','), 'mpSegment');
  assert.equal(a.coachingEntryFor(after), null,
    'mpSegment is one of the fields that can change what the session IS, same as desc');
});

test('4. an edited session renders identically -- and coherently -- in Today, This Week and Full Plan', () => {
  const a = plannedApp();
  const dd = a.state.days.find((d) => d.type === 'easy' && d.date >= TODAY);
  // Pin this exact day to today's date so it appears in all three views.
  dd.date = TODAY;
  dd.id = TODAY;
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'Lavidia race race' }, 'ef-km': { value: '10' },
    'ef-mp': { checked: true }, 'ef-desc': { value: '10km best effort' },
  });
  a.handleSaveEdit(dd.id);
  const after = a.findDay(dd.id);
  const canonical = a.renderDayCard(after);
  assert.doesNotMatch(canonical, /aerobic base/i);

  const today = a.renderTodayView();
  const week = a.renderWeekView();
  const full = a.renderFullPlanView();
  // renderDayCard() is a pure function of the day object -- if all three
  // views embed the exact same string it produced, they cannot have each
  // independently re-derived (and possibly disagreed on) its coherence.
  assert.ok(today.indexOf(canonical) !== -1, 'Today must render the same card');
  assert.ok(week.indexOf(canonical) !== -1, 'This Week must render the same card');
  assert.ok(full.indexOf(canonical) !== -1, 'Full Plan must render the same card');
  // NOT a claim that "aerobic base" is absent from the whole page -- the
  // fixture's OTHER, untouched easy days correctly still say it. The
  // substring checks above are the real assertion: this specific day's
  // card, containing none of that stale copy, is what actually landed in
  // all three views, verbatim.
});

test('5. reload/persistence retains the corrected identity and guidance', () => {
  const a = plannedApp();
  const dd = findEasyDay(a);
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'Lavidia race race' }, 'ef-km': { value: '10' },
    'ef-mp': { checked: true }, 'ef-desc': { value: '10km best effort' },
  });
  a.handleSaveEdit(dd.id);
  a.persistStateLocalOnly();

  const b = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  b.showToast = () => {};
  b.localStorage.setItem(a.STORAGE_KEY, a.localStorage.getItem(a.STORAGE_KEY));
  b.loadState();

  const reloaded = b.findDay(dd.id);
  assert.equal(reloaded.type, 'easy');
  assert.equal(reloaded.desc, '10km best effort');
  assert.equal(reloaded.manualEdit.fields.sort().join(','), 'desc,km,mpSegment,title');
  assert.equal(b.coachingEntryFor(reloaded), null,
    'the corrected (suppressed) guidance state must survive a reload, not just the in-memory session');
  assert.equal(b.sessionPurpose(reloaded), null);
});

test('6. Reset restores a coherent (Rest) identity -- no leftover Easy guidance of any kind', () => {
  const a = plannedApp();
  const dd = findEasyDay(a);
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'Lavidia race race' }, 'ef-km': { value: '10' },
    'ef-mp': { checked: true }, 'ef-desc': { value: '10km best effort' },
  });
  a.handleSaveEdit(dd.id);
  a.handleResetDay(dd.id);
  const after = a.findDay(dd.id);
  assert.equal(after.type, 'rest');
  assert.equal(after.title, 'Rest Day');
  assert.equal(a.renderCoachingDepth(after), '');
  assert.equal(a.coachIntentLine(after), '');
  assert.equal(a.sessionPurpose(after), null);
  assert.doesNotMatch(a.renderDayCard(after), /aerobic base|best effort|Lavidia/i);
});

test('execution review / comparison: an untrusted-identity day neither seeks nor is offered as an Easy comparable', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  buildPlan(a, { weeks: 8, startDate: a.addDays(TODAY, -21) });
  a.showToast = () => {};
  a.canEditPrescription = () => true;
  a.canEditCompletion = () => false;
  // A real, untouched easy history to compare against.
  a.state.days.forEach((d) => {
    if (d.date < TODAY && d.type !== 'rest') {
      d.completed = true;
      d.actual = { km: d.km, pace: '5:20', hr: 150, rpe: 5, feel: 'good', notes: '' };
    }
  });
  const priorEasy = a.state.days.find((d) => d.type === 'easy' && d.date < TODAY);
  assert.ok(priorEasy, 'fixture must include a genuine logged easy run to compare against');
  const dd = a.state.days.find((d) => d.type === 'easy' && d.date >= TODAY);
  mockEditModalDom(a, dd, {
    'ef-title': { value: 'Lavidia race race' }, 'ef-km': { value: '10' },
    'ef-mp': { checked: true }, 'ef-desc': { value: '10km best effort' },
  });
  a.handleSaveEdit(dd.id);
  const edited = a.findDay(dd.id);
  edited.completed = true;
  edited.actual = { km: 10, pace: '3:35', hr: 178, rpe: 9, feel: 'good', notes: '' };

  assert.equal(a.coachComparable(edited, 3).length, 0,
    'the edited session must not go looking for genuine easy runs to compare itself against');
  const comparableForRealEasy = a.coachComparable(priorEasy, 3);
  assert.ok(!comparableForRealEasy.some((c) => c.id === edited.id || c.date === edited.date),
    'a genuine easy run must not be offered the edited session as one of its comparables');
});

test('7. an unrelated, untouched generated session is completely unaffected', () => {
  const a = plannedApp();
  const untouched = a.state.days.find((d) => d.type === 'tempo');
  assert.ok(untouched, 'fixture must include an unedited tempo day');
  assert.ok(a.coachingEntryFor(untouched));
  assert.ok(a.coachIntentLine(untouched));
  assert.ok(a.sessionPurpose(untouched));
});
