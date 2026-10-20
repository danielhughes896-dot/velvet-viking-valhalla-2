'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* INJURY / TRAINING RESTRICTION
   =========================================================================
   An athlete who cannot train normally could not tell Valhalla so. Illness
   and pain were only ever read retrospectively, out of the notes on a
   session that was RUN -- which is the one thing an injured athlete does
   not produce. Everything downstream then read their silence as a choice:
   missPattern() put three weeks of injury straight into its 'persistent'
   tier ("a plan that does not fit the weeks you are having is not worth
   carrying"), the watch-outs said the sessions "went unlogged", Week Status
   counted them, missedStimulus() offered the quality work back, and the
   evidence window counted the calendar time as though training had filled
   it.

   What is asserted here is the declaration, what it does to the plan, and
   -- more importantly -- the six promises: adaptation, no adherence
   penalty, no catch-up, protected history, a managed return, and a goal
   that is reassessed but never changed. */

const TODAY = '2026-10-14';
function app(opts){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, Object.assign({ distanceKey:'full', volume:70, weeks:16, lthr:172, maxHR:188,
                               startDate: a.addDays(TODAY, -42) }, opts || {}));
  a.state.setup.purpose = 'race';
  return a;
}
function logObjective(a, fromDaysAgo, toDate){
  const from = a.addDays(TODAY, -(fromDaysAgo == null ? 42 : fromDaysAgo));
  const to = toDate || TODAY;
  a.state.days.forEach(d => {
    if (d.date >= to || d.date < from || d.type === 'rest') return;
    d.completed = true;
    d.actual = { km:d.km, pace:'5:20', paceUnit:'km', hr:null, rpe:null, feel:null, notes:'' };
  });
}
/* A RESTRICTION THAT IS ALREADY IN THE PAST. applyRestrictionToPlan() will
   not write to a past day -- that is a safety property asserted below -- so
   history is staged the way the app itself would have left it had the
   declaration been made at the time: the same record, the same per-day
   marker, the same mutation. */
function stageHistoricRestriction(a, from, until, level){
  a.state.setup.restriction = { level:level, from:from, until:until,
    declaredAt:'2026-01-01T00:00:00.000Z', endedAt:null, endedOn:null, returnUntil:null };
  a.state.days.forEach(d => {
    if (d.date < from || d.date > until) return;
    d.restricted = { at:'2026-01-01T00:00:00.000Z', level:level };
    if (d.type === 'rest' || d.type === 'race' || d.type === 'checkpoint') return;
    d.restricted.from = a.workoutSnapshot(d);
    if (level === 'none'){ d.type = 'rest'; d.km = 0; d.title = 'Rest'; delete d.prescription; }
  });
}

// =====================================================================
// 1. THE DECLARATION, AND WHAT IT DOES TO THE PLAN
// =====================================================================

test('no running at all turns every run in the window into rest, and marks the window', () => {
  const a = app();
  const until = a.addDays(TODAY, 13);
  const runsBefore = a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && d.type !== 'rest').length;
  assert.ok(runsBefore > 0, 'the fixture has no runs in the window');
  const r = a.declareRestriction('none', until);
  assert.ok(r, 'the declaration was refused');
  assert.equal(a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && d.type !== 'rest').length, 0);
  // every calendar day in the window carries the marker, rest days included
  assert.equal(a.state.days.filter(d => d.date >= TODAY && d.date <= until && d.restricted).length,
               a.state.days.filter(d => d.date >= TODAY && d.date <= until).length);
});

test('easy running only removes intensity and applies the recovery profile’s own factor', () => {
  const a = app();
  const until = a.addDays(TODAY, 13);
  const quality = a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && a.isQualityType(d.type) && d.type !== 'race');
  assert.ok(quality.length > 0, 'the fixture has no quality work in the window');
  const easyDay = a.state.days.filter(d => d.date >= TODAY && d.date <= until && d.type === 'easy')[0];
  const easyBefore = easyDay.km;
  a.declareRestriction('easy', until);
  const factor = a.recoveryProfileFor('full').volumeFactor;
  assert.equal(a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && a.isQualityType(d.type) &&
    d.type !== 'race' && d.type !== 'checkpoint').length, 0,
    'intensity survived an easy-only restriction');
  assert.equal(easyDay.km, Math.max(1, Math.round(easyBefore * factor * 10) / 10));
  // the downgrade authored a real easy run, it did not strip the structure
  assert.equal(easyDay.prescription.archetype, 'easy_run');
  assert.equal(easyDay.prescription.params.km, easyDay.km);
});

test('the race and the Fitness Checkpoint are marked but never rewritten', () => {
  const a = app();
  const key = a.state.days.filter(d => d.type === 'race' || d.type === 'checkpoint');
  assert.ok(key.length > 0, 'the fixture carries no protected sessions');
  const target = key[key.length - 1];
  const before = JSON.stringify(a.workoutSnapshot(target));
  a.declareRestriction('none', target.date);
  assert.equal(JSON.stringify(a.workoutSnapshot(target)), before,
    'a restriction rewrote the goal day');
  assert.ok(target.restricted, 'the goal day was not marked as restricted');
  assert.equal(target.restricted.from, undefined,
    'a snapshot was taken of a session that was never changed');
});

test('a restriction never writes to the past, and never to a session that happened', () => {
  const a = app();
  logObjective(a);
  const past = a.state.days.filter(d => d.date < TODAY);
  const pastBefore = past.map(d => d.type + ':' + d.km).join('|');
  const todayDay = a.state.days.filter(d => d.date === TODAY && d.type !== 'rest')[0];
  if (todayDay){ todayDay.completed = true; todayDay.actual = { km: todayDay.km }; }
  const todayBefore = todayDay ? todayDay.type + ':' + todayDay.km : null;
  a.declareRestriction('none', a.addDays(TODAY, 10));
  assert.equal(past.map(d => d.type + ':' + d.km).join('|'), pastBefore);
  assert.equal(past.filter(d => d.restricted).length, 0);
  if (todayDay) assert.equal(todayDay.type + ':' + todayDay.km, todayBefore,
    'a run that had already happened today was rewritten');
});

test('a malformed or expired declaration restricts nothing', () => {
  const a = app();
  assert.equal(a.declareRestriction('none', a.addDays(TODAY, -1)), null, 'a past end date was accepted');
  assert.equal(a.declareRestriction('sometimes', a.addDays(TODAY, 7)), null, 'an unknown level was accepted');
  a.state.setup.restriction = { level:'none', from:TODAY, until:a.addDays(TODAY,-3) };
  assert.equal(a.restrictionRecord(), null, 'a window that ends before it starts was read');
  a.state.setup.restriction = { level:'nonsense', from:TODAY, until:a.addDays(TODAY,3) };
  assert.equal(a.restrictionRecord(), null);
  assert.equal(a.activeRestriction(), null);
});

// =====================================================================
// 2. IT IS NOT POOR ADHERENCE
// =====================================================================

test('three weeks of injury is not a miss pattern', () => {
  const a = app();
  logObjective(a, 42, a.addDays(TODAY, -21));
  // without the declaration this is exactly the defect: the worst tier
  const bare = a.missPattern();
  assert.ok(bare && bare.tier === 'persistent',
    'the fixture does not reproduce the defect (tier ' + (bare && bare.tier) + ')');
  assert.match(a.missPatternSentence(bare), /not worth carrying/);
  stageHistoricRestriction(a, a.addDays(TODAY, -21), a.addDays(TODAY, -1), 'none');
  assert.equal(a.missPattern(), null,
    'a declared restriction still reads as a pattern of missed sessions');
});

test('a restricted day is labelled Restricted, never Missed', () => {
  const a = app();
  stageHistoricRestriction(a, a.addDays(TODAY, -14), a.addDays(TODAY, -1), 'easy');
  const day = a.state.days.filter(d => d.date < TODAY && d.date >= a.addDays(TODAY,-14) &&
                                       d.type !== 'rest' && !d.completed)[0];
  assert.ok(day, 'no restricted unlogged day in the fixture');
  const label = a.dayStatusLabel(day);
  assert.match(label, /Restricted/);
  assert.doesNotMatch(label, /Missed/);
});

test('an empty restricted day never reaches the evidence funnel, but a run that happened does', () => {
  const a = app();
  stageHistoricRestriction(a, a.addDays(TODAY, -14), a.addDays(TODAY, -1), 'easy');
  const inWindow = a.state.days.filter(d => d.restricted && d.type !== 'rest');
  assert.ok(inWindow.length >= 2);
  const ran = inWindow[0];
  ran.completed = true;
  ran.actual = { km: ran.km, pace:'6:10', paceUnit:'km' };
  const mem = a.athleteMemory(120);
  const dates = mem.map(r => r.date);
  assert.ok(dates.indexOf(ran.date) !== -1, 'a real run during a restriction was discarded');
  inWindow.slice(1).forEach(d => {
    assert.equal(dates.indexOf(d.date), -1,
      'an empty restricted day entered the record as a session that was not completed');
  });
});

test('restricted days cannot drag the completion rate down', () => {
  const a = app();
  logObjective(a, 42, a.addDays(TODAY, -14));
  stageHistoricRestriction(a, a.addDays(TODAY, -14), a.addDays(TODAY, -1), 'none');
  const recs = a.athleteMemory(120);
  assert.ok(recs.length > 0);
  assert.equal(a.baselineFor(recs).completionRate, 100,
    'medically unavailable days are being counted as incomplete sessions');
});

test('Week Status and the watch-outs do not call a restricted day unlogged', () => {
  const a = app();
  stageHistoricRestriction(a, a.addDays(TODAY, -13), a.addDays(TODAY, -1), 'easy');
  const wk = a.renderWeekStatus(a.currentWeekNum());
  assert.doesNotMatch(wk, /unlogged/, 'Week Status counted restricted days as unlogged');
  assert.match(wk, /restricted/i, 'Week Status says nothing about the restriction at all');
  const report = a.coachAnalyse();
  const watch = (report && report.watchOuts) || [];
  assert.equal(watch.filter(w => /unlogged/.test(w.detail)).length, 0,
    'the watch-outs still say restricted sessions went unlogged');
});

// =====================================================================
// 3. NOTHING IS EVER CAUGHT UP
// =====================================================================

test('no restricted session is ever offered back', () => {
  const a = app();
  stageHistoricRestriction(a, a.addDays(TODAY, -4), a.addDays(TODAY, -1), 'easy');
  const recoverable = a.missedStimulus();
  assert.equal(recoverable.filter(m => {
    const dd = a.findDay(m.dayId);
    return dd && dd.restricted;
  }).length, 0, 'a restricted session was proposed as still-useful stimulus');
});

// =====================================================================
// 4. HISTORY IS PROTECTED
// =====================================================================

test('what Valhalla prescribed is kept, restored ahead, and left standing behind', () => {
  const a = app();
  const until = a.addDays(TODAY, 20);
  // protected sessions are deliberately never snapshotted -- see the test above
  const ahead = a.state.days.filter(d => d.date >= TODAY && d.date <= until &&
    d.type !== 'rest' && d.type !== 'race' && d.type !== 'checkpoint');
  const before = ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|');
  a.declareRestriction('none', until);
  ahead.forEach(d => assert.ok(d.restricted.from, 'no snapshot of the original prescription'));
  const r = a.endRestriction();
  assert.ok(r && r.endedAt);
  assert.equal(ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|'), before,
    'ending the restriction did not restore the programme');
  assert.equal(ahead.filter(d => d.restricted).length, 0);
});

test('days already behind the athlete keep their markers for good', () => {
  const a = app();
  stageHistoricRestriction(a, a.addDays(TODAY, -10), a.addDays(TODAY, 3), 'none');
  const past = a.state.days.filter(d => d.date < TODAY && d.restricted);
  assert.ok(past.length > 0);
  a.endRestriction();
  assert.equal(a.state.days.filter(d => d.date < TODAY && d.restricted).length, past.length,
    'the record of what the athlete was unavailable for was erased');
});

test('nothing is ever deleted from the plan', () => {
  const a = app();
  const n = a.state.days.length;
  a.declareRestriction('none', a.addDays(TODAY, 20));
  assert.equal(a.state.days.length, n);
  a.endRestriction();
  assert.equal(a.state.days.length, n);
});

// =====================================================================
// 5. COMING BACK
// =====================================================================

test('a restriction does not expire on its own', () => {
  const a = app();
  a.declareRestriction('none', a.addDays(TODAY, 3));
  // the window passes: the declaration was made ten days ago and ran out yesterday
  a.state.setup.restriction.from = a.addDays(TODAY, -10);
  a.state.setup.restriction.until = a.addDays(TODAY, -1);
  assert.equal(a.activeRestriction(), null);
  assert.ok(a.restrictionAwaitingReturn(), 'the declaration closed itself');
  assert.match(a.renderRestrictionCard(), /Are you back\?/);
});

test('the return window is the shorter of the time out and the distance’s own no-intensity window', () => {
  const a = app();
  const prof = a.recoveryProfileFor('full');
  assert.equal(a.restrictionReturnDays(4), 4);
  assert.equal(a.restrictionReturnDays(prof.noIntensityDays + 40), prof.noIntensityDays);
  assert.equal(a.restrictionReturnDays(0), 0);
});

test('coming back is eased in, and the ramp never touches the goal day', () => {
  const a = app();
  a.declareRestriction('none', a.addDays(TODAY, 20));
  a.state.setup.restriction.from = a.addDays(TODAY, -20);   // twenty days out
  const r = a.endRestriction();
  assert.ok(r.returnUntil, 'no return ramp was applied');
  const ramped = a.state.days.filter(d => d.returnRamp);
  assert.ok(ramped.length > 0);
  ramped.forEach(d => {
    assert.equal(d.type, 'easy');
    assert.equal(d.prescription.archetype, 'easy_run');
    assert.ok(d.returnRamp.from, 'the ramp kept no record of what it replaced');
    assert.ok(d.date >= TODAY && d.date <= r.returnUntil);
  });
  assert.equal(a.state.days.filter(d => d.returnRamp &&
    (d.returnRamp.from.type === 'race' || d.returnRamp.from.type === 'checkpoint')).length, 0,
    'the return ramp rewrote a protected session');
});

test('nothing a restriction or a return does ever adds training', () => {
  const a = app();
  const until = a.addDays(TODAY, 20);
  const before = {};
  a.state.days.forEach(d => { if (d.date >= TODAY) before[d.id] = d.km || 0; });
  a.declareRestriction('easy', until);
  a.state.days.forEach(d => {
    if (d.date >= TODAY) assert.ok((d.km || 0) <= before[d.id] + 1e-9,
      'a restriction increased a session on ' + d.date);
  });
  a.endRestriction();
  a.state.days.forEach(d => {
    if (d.date >= TODAY) assert.ok((d.km || 0) <= before[d.id] + 1e-9,
      'the return ramp increased a session on ' + d.date);
  });
});

test('extending keeps one record and re-applies at the new level', () => {
  const a = app();
  a.declareRestriction('none', a.addDays(TODAY, 6));
  const declaredAt = a.state.setup.restriction.declaredAt;
  const r = a.extendRestriction('easy', a.addDays(TODAY, 20));
  assert.ok(r);
  assert.equal(r.declaredAt, declaredAt, 'extending started a second restriction');
  assert.equal(r.level, 'easy');
  assert.equal(r.until, a.addDays(TODAY, 20));
  assert.equal(a.state.days.filter(d =>
    d.date >= TODAY && d.date <= r.until && a.isQualityType(d.type) &&
    d.type !== 'race' && d.type !== 'checkpoint').length, 0);
});

// =====================================================================
// 6. THE EVIDENCE LAYER
// =====================================================================

test('restricted days are neither evidence nor the absence of it', () => {
  const a = app();
  logObjective(a, 40, a.addDays(TODAY, -20));
  const gross = a.fitnessEvidence();
  assert.equal(gross.restrictedDays, 0);
  assert.equal(gross.usableSpanDays, gross.spanDays);
  stageHistoricRestriction(a, a.addDays(TODAY, -20), a.addDays(TODAY, -1), 'none');
  const e = a.fitnessEvidence();
  assert.ok(e.restrictedDays >= 19, 'restricted days were not counted: ' + e.restrictedDays);
  assert.equal(e.usableSpanDays, e.spanDays - e.restrictedDays);
  assert.ok(e.sessions > 0, 'the training that did happen was discarded');
});

test('an interruption cannot lengthen the window that decides how much Valhalla claims to know', () => {
  const a = app();
  // ten days of real training, then ten days restricted: a twenty-day span
  logObjective(a, 20, a.addDays(TODAY, -10));
  stageHistoricRestriction(a, a.addDays(TODAY, -10), a.addDays(TODAY, -1), 'none');
  const e = a.fitnessEvidence();
  assert.ok(e.spanDays >= 14, 'the gross span is not over the floor, so this proves nothing');
  assert.ok(e.usableSpanDays < 14, 'usable span ' + e.usableSpanDays);
  assert.equal(a.fitnessEvidenceReady(), false,
    'ten restricted days were counted as evidence of fitness');
});

test('the interruption costs confidence and never the estimate', () => {
  const a = app();
  logObjective(a, 56, a.addDays(TODAY, -14));
  stageHistoricRestriction(a, a.addDays(TODAY, -14), a.addDays(TODAY, -1), 'none');
  assert.equal(a.fitnessEvidenceReady(), true, 'the estimate was withheld over an interruption');
  const est = a.currentFitnessEstimate('full');
  assert.ok(est && !est.withheld);
  const conf = a.fitnessConfidence('full');
  assert.ok(conf.reasons.some(r => /restricted by injury or illness/.test(r)),
    'confidence says nothing about the interruption: ' + JSON.stringify(conf.reasons));
});

// =====================================================================
// 7. THE GOAL IS REASSESSED, NEVER CHANGED
// =====================================================================

test('viability is reported from SYSTEM’s verdict and nothing else', () => {
  const a = app();
  a.declareRestriction('none', a.addDays(TODAY, 20));
  const v = a.restrictionViability();
  assert.ok(v, 'no viability reading at all');
  assert.ok(v.sessionsLost > 0);
  assert.equal(v.daysToRace, a.daysBetween(TODAY, a.state.setup.raceDate));
  // whatever the verdict is, it is raceGoalAssessment()'s and not a second opinion
  const direct = a.raceGoalAssessment(a.raceGoalCheckpointBlock());
  assert.equal(JSON.stringify(v.assessment), JSON.stringify(direct));
});

test('no path through a restriction changes the athlete’s goal', () => {
  const a = app();
  const goal = JSON.stringify({ g: a.state.setup.goals, active: a.state.setup.activeGoal,
                                date: a.state.setup.raceDate, dk: a.state.setup.distanceKey });
  a.declareRestriction('none', a.addDays(TODAY, 30));
  a.renderRestrictionCard();
  a.restrictionViability();
  a.extendRestriction('easy', a.addDays(TODAY, 40));
  a.endRestriction();
  assert.equal(JSON.stringify({ g: a.state.setup.goals, active: a.state.setup.activeGoal,
                                date: a.state.setup.raceDate, dk: a.state.setup.distanceKey }), goal,
    'something in the restriction lifecycle moved the race goal');
});

test('viability is not raised where nothing was taken away', () => {
  const a = app();
  assert.equal(a.restrictionViability(), null, 'reported with no declaration at all');
  a.state.setup.purpose = 'base';
  a.declareRestriction('none', a.addDays(TODAY, 10));
  assert.equal(a.restrictionViability(), null, 'reported for a block with no race goal');
});

// =====================================================================
// 8. THE COACH, AND THE REST OF THE PRODUCT
// =====================================================================

test('a declared restriction is a safety input, counted once', () => {
  const a = app();
  logObjective(a);
  a.declareRestriction('easy', a.addDays(TODAY, 14));
  const dec = a.coachDecision();
  assert.ok(dec, 'no decision at all');
  assert.equal(dec.state, 'recover');
  assert.ok(dec.reasons.some(r => /cannot train normally/.test(r)),
    'the declaration is not among the reasons: ' + JSON.stringify(dec.reasons));
  // one illness, counted once, whether inferred or declared
  assert.equal(dec.reasons.filter(r => /cannot train normally|Illness reported|under the weather/.test(r)).length, 1);
});

test('supporting work is not prescribed through a restriction', () => {
  const a = app();
  assert.equal(a.supportSafetyBlocked(), false);
  a.declareRestriction('easy', a.addDays(TODAY, 14));
  assert.equal(a.supportSafetyBlocked(), true);
});

test('the declaration travels with the plan', () => {
  const a = app();
  const before = a.planContentSignature(a.state);
  a.declareRestriction('easy', a.addDays(TODAY, 14));
  assert.notEqual(a.planContentSignature(a.state), before,
    'a device that declared an injury would read as carrying the same plan');
});

test('an open restriction survives a block transition and is re-applied', () => {
  const a = app();
  a.declareRestriction('none', a.addDays(TODAY, 40));
  const block = a.startDevelopmentBlock('maintain');
  assert.ok(block, 'the transition itself failed, so this proves nothing');
  assert.ok(a.activeRestriction(), 'the declaration was lost with the old block');
  const until = a.state.setup.restriction.until;
  assert.equal(a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && d.type !== 'rest').length, 0,
    'the new block was generated full of sessions the athlete cannot run');
});

// =====================================================================
// 9. THE CARD
// =====================================================================

test('the card renders nothing until there is something to say', () => {
  const a = app();
  assert.equal(a.renderRestrictionCard(), '');
  a.declareRestriction('easy', a.addDays(TODAY, 14));
  const open = a.renderRestrictionCard();
  assert.match(open, /Training restricted/);
  assert.match(open, /not counted against you/);
  assert.match(open, /nothing missed is made up/);
  a.state.setup.restriction.from = a.addDays(TODAY, -12);   // twelve days out
  a.endRestriction();
  const back = a.renderRestrictionCard();
  assert.match(back, /Easing back in/);
});

test('Today leads with availability, and Settings is the permanent home', () => {
  const a = app();
  a.declareRestriction('none', a.addDays(TODAY, 14));
  const today = a.renderTodayView();
  assert.ok(today.indexOf('Training restricted') !== -1);
  assert.ok(today.indexOf('Training restricted') < today.indexOf('Next Move') ||
            today.indexOf('Next Move') === -1,
            'the restriction is not established before the coach speaks');
  const settings = a.renderSettingsHubView();
  assert.match(settings, /Training Availability/);
  assert.match(settings, /restriction-open/);
});

// =====================================================================
// 10. IT SURVIVES THE PLAN BEING REBUILT
// =====================================================================

/* THE DEFECT THESE EXIST FOR was invisible to this suite and was found with
   a screenshot: declare a restriction, and the very next render in a real
   browser put the whole programme back. renderApp() calls
   ensureRaceGoalFrequencyReconciled(), which regenerates every future day
   from the setup -- so the markers and the adapted prescription went with
   them, while the declaration survived on state.setup and the card went on
   saying "training restricted" over a plan that had quietly resumed.

   The ensure* calls sit after renderApp()'s own `if (!app) return`, so a
   headless harness never reaches them. They are therefore called directly
   here, which is the only way this suite can see either the regeneration or
   the keeper that answers it. */

test('a regeneration of the plan cannot quietly resume a restricted programme', () => {
  const a = app();
  const until = a.addDays(TODAY, 20);
  delete a.state.setup.freqRepairIIReconciled;
  a.declareRestriction('none', until);
  assert.ok(a.state.days.filter(d => d.restricted).length > 0);

  assert.equal(a.ensureRaceGoalFrequencyReconciled(), true,
    'the regeneration did not run, so this proves nothing');
  assert.equal(a.state.days.filter(d => d.date >= TODAY && d.restricted).length, 0,
    'the fixture no longer reproduces the regeneration that caused the defect');

  assert.equal(a.ensureRestrictionApplied(), true, 'the declaration was not re-applied');
  assert.equal(a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && d.type !== 'rest' &&
    d.type !== 'race' && d.type !== 'checkpoint').length, 0,
    'the programme resumed underneath an open declaration');
  assert.equal(a.ensureRestrictionApplied(), false,
    'the keeper is not a no-op once the plan already honours the declaration');
});

test('the keeper does nothing at all without an open declaration', () => {
  const a = app();
  assert.equal(a.ensureRestrictionApplied(), false);
  const before = a.planContentSignature(a.state);
  a.ensureRestrictionApplied();
  assert.equal(a.planContentSignature(a.state), before);
  // and nothing once it has been ended, either
  a.declareRestriction('none', a.addDays(TODAY, 5));
  a.endRestriction();
  assert.equal(a.ensureRestrictionApplied(), false,
    'a lifted restriction is being re-applied to the programme the athlete came back to');
});

test('while the athlete has not said they are back, the days keep being restricted', () => {
  const a = app();
  a.declareRestriction('easy', a.addDays(TODAY, 3));
  // the window ran out three days ago and nobody answered the card
  a.state.setup.restriction.from = a.addDays(TODAY, -20);
  a.state.setup.restriction.until = a.addDays(TODAY, -3);
  assert.ok(a.restrictionAwaitingReturn());
  const todayDay = a.state.days.filter(d => d.date === TODAY)[0];
  delete todayDay.restricted;
  assert.equal(a.ensureRestrictionApplied(), true);
  assert.ok(todayDay.restricted, 'today resumed while the athlete was still waiting to answer');
});

test('applying a restriction twice cannot eat the session it is protecting', () => {
  const a = app();
  const until = a.addDays(TODAY, 20);
  const ahead = a.state.days.filter(d => d.date >= TODAY && d.date <= until &&
    d.type !== 'rest' && d.type !== 'race' && d.type !== 'checkpoint');
  const original = ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|');
  a.declareRestriction('easy', until);
  const afterOne = ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|');
  // four more passes: an extension, a level change, and two keeper runs
  a.extendRestriction('easy', until);
  // a regeneration: one day comes back as Valhalla wrote it, with no marker
  a.state.days.forEach(d => {
    if (d.date !== TODAY || !d.restricted) return;
    a.restoreWorkoutSnapshot(d, d.restricted.from);
    delete d.restricted;
  });
  a.ensureRestrictionApplied();
  a.extendRestriction('none', until);
  a.extendRestriction('easy', until);
  assert.equal(ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|'), afterOne,
    'repeated application kept shrinking the plan');
  // and what Valhalla prescribed is still the thing that comes back
  ahead.forEach(d => assert.ok(d.restricted.from,
    'the original prescription was lost on a later pass'));
  a.endRestriction();
  assert.equal(ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|'), original,
    'the programme that came back is not the one Valhalla wrote');
});

test('the coach does not say proceed over an unanswered "are you back?"', () => {
  const a = app();
  logObjective(a);
  a.declareRestriction('easy', a.addDays(TODAY, 3));
  // the window ran out and the athlete has not answered
  a.state.setup.restriction.from = a.addDays(TODAY, -18);
  a.state.setup.restriction.until = a.addDays(TODAY, -1);
  assert.ok(a.restrictionAwaitingReturn());
  const dec = a.coachDecision();
  assert.ok(dec, 'no decision at all');
  assert.equal(dec.state, 'recover',
    'Next Move reads ' + dec.state + ' beneath a card saying nothing resumes until you say so');
  assert.ok(dec.reasons.some(r => /not told Valhalla you are back/.test(r)),
    JSON.stringify(dec.reasons));
  assert.equal(a.supportSafetyBlocked(), true);
});
