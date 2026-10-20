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
    declaredAt:'2026-01-01T00:00:00.000Z', endedAt:null, endedOn:null };
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

/* EASY RUNNING ONLY MEANS EXACTLY THAT. An earlier version also multiplied
   every surviving distance by RECOVERY_PROFILE.volumeFactor. HQ removed it:
   the factor is documented as a fraction of the athlete's own ABSORBED
   WEEKLY VOLUME ("their own training, not a table") and was being applied to
   the prescribed kilometres of a future day, producing weeks between 22 and
   36km around the 28km its own recovery block would have started at --
   decided by where in the build the week sat. It was also ordered by the
   race just run (0.55 for 5K down to 0.40 for the marathon) and wrote past
   roundWorkoutKm(). */
test('easy running only removes intensity and leaves every distance alone', () => {
  const a = app();
  const until = a.addDays(TODAY, 13);
  const inWindow = a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && d.type !== 'rest' &&
    d.type !== 'race' && d.type !== 'checkpoint');
  assert.ok(inWindow.filter(d => a.isQualityType(d.type)).length > 0,
    'the fixture has no quality work in the window');
  const before = inWindow.map(d => d.id + ':' + d.km).join('|');
  a.declareRestriction('easy', until);
  assert.equal(a.state.days.filter(d =>
    d.date >= TODAY && d.date <= until && a.isQualityType(d.type) &&
    d.type !== 'race' && d.type !== 'checkpoint').length, 0,
    'intensity survived an easy-only restriction');
  assert.equal(inWindow.map(d => d.id + ':' + d.km).join('|'), before,
    'a distance moved under a level that only removes intensity');
  // the downgrade authored a real easy run, it did not strip the structure
  const easyDay = inWindow.filter(d => d.prescription)[0];
  assert.equal(easyDay.prescription.archetype, 'easy_run');
  assert.equal(easyDay.prescription.params.km, easyDay.km);
});

test('RECOVERY_PROFILE is not consulted anywhere in the restriction pathway', () => {
  const a = app();
  const reported = [];
  const real = a.recoveryProfileFor;
  a.recoveryProfileFor = function(k){ reported.push(k); return real(k); };
  // positive control first, so an empty result below cannot be a dead spy
  a.developmentBlockSpec('recovery', { raceDistanceKey:'full' });
  assert.deepEqual(reported, ['full'], 'the spy does not intercept internal calls');
  reported.length = 0;
  a.declareRestriction('easy', a.addDays(TODAY, 20));
  a.extendRestriction('none', a.addDays(TODAY, 30));
  a.ensureRestrictionApplied();
  a.endRestriction();
  a.recoveryProfileFor = real;
  assert.deepEqual(reported, [],
    'post-race recovery methodology is back in the injury pathway: ' + reported.join(','));
  assert.doesNotMatch(a.RESTRICTION_META.easy.applied, /distances come down/);
  assert.match(a.RESTRICTION_META.easy.applied, /unchanged/);
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

/* RETURN TO TRAINING IS AN OPEN AUTHORITY AND MUST STAY ONE.
   An earlier version sized a graded return as min(days out,
   RECOVERY_PROFILE.noIntensityDays). HQ removed it: the table's own comment
   claims support only for "the longer and harder the RACE, the longer the
   return", calls the number a safety floor nothing may shorten, and tunes it
   inside a package with a 40% volume factor that the ramp did not apply. The
   replacement is deliberately nothing, and these assertions are what stops a
   future reader filling the hole with a number nobody authorised. */
test('no return ramp is invented, and RECOVERY_PROFILE is not consulted for one', () => {
  const a = app();
  assert.equal(typeof a.restrictionReturnDays, 'undefined',
    'the unsupportable return window is back');
  assert.equal(typeof a.applyReturnRamp, 'undefined');
  a.declareRestriction('none', a.addDays(TODAY, 20));
  a.state.setup.restriction.from = a.addDays(TODAY, -20);   // twenty days out
  const r = a.endRestriction();
  assert.ok(r && r.endedAt, 'the restriction did not end');
  assert.equal(r.returnUntil, undefined, 'a return window was recorded');
  assert.equal(a.state.days.filter(d => d.returnRamp).length, 0,
    'something eased the athlete back in');
  assert.equal(a.state.days.filter(d => d.restricted).length,
               a.state.days.filter(d => d.restricted && d.date < TODAY).length,
    'a day ahead of the athlete is still restricted after they said they were back');
});

test('the programme that comes back is the one Valhalla wrote, intensity included', () => {
  const a = app();
  const until = a.addDays(TODAY, 20);
  const ahead = a.state.days.filter(d => d.date >= TODAY && d.date <= until);
  const before = ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|');
  const qualityBefore = ahead.filter(d => a.isQualityType(d.type)).length;
  assert.ok(qualityBefore > 0, 'the fixture has no quality work to lose');
  a.declareRestriction('none', until);
  a.state.setup.restriction.from = a.addDays(TODAY, -40);   // a long way out
  a.endRestriction();
  assert.equal(ahead.map(d => d.id + ':' + d.type + ':' + d.km).join('|'), before);
  assert.equal(ahead.filter(d => a.isQualityType(d.type)).length, qualityBefore,
    'quality work was withheld on return by something nobody authorised');
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
  assert.equal(a.renderRestrictionCard(), '',
    'a card is still claiming a return Valhalla does not manage');
});

test('nothing on screen promises a return Valhalla does not size', () => {
  const a = app();
  a.declareRestriction('easy', a.addDays(TODAY, 3));
  a.state.setup.restriction.from = a.addDays(TODAY, -18);
  a.state.setup.restriction.until = a.addDays(TODAY, -1);
  const card = a.renderRestrictionCard();
  assert.match(card, /Are you back\?/);
  assert.doesNotMatch(card, /eased in/i);
  assert.match(card, /does not yet decide how quickly you come back/);
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

// =====================================================================
// 11. THE INTERRUPTION REACHES RACE READINESS
// =====================================================================

/* THE DEFECT: raceGoalReadiness() credits workload, durability and
   specificity off blockResult.weeks -- the PRESCRIPTION -- and
   raceGoalCheckpointBlock() regenerates blockResult from four setup fields,
   so neither execution nor any adaptation of state.days can reach it. Its
   one athlete-reading dimension, absorption, goes through
   blockEffectiveness() -> athleteMemory(), which correctly withholds a
   restricted day (the athlete was absent, not straining) -- so after the
   restriction feature nothing in readiness could see an interruption at all.

   HQ's ruling: one more dimension, the existing 0.90/0.70 bands, scoped like
   the others, lowering only, no recency weighting, durability untouched. */

const DISTANCES = [['full', 70, 16], ['half', 55, 14], ['10k', 50, 12], ['5k', 45, 12]];
function raceApp(dk, vol, wk){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey:dk, volume:vol, weeks:wk, lthr:172, maxHR:188,
                 startDate: a.addDays(TODAY, -42) });
  a.state.setup.purpose = 'race';
  return a;
}
function prep(a){ return a.raceGoalAssessment(a.raceGoalCheckpointBlock()).preparation; }
function dimOf(a, key){
  return ((prep(a) || {}).dimensions || []).filter(d => d.key === key)[0] || null;
}

/* ---- THE ALIGNMENT PROOF HQ ASKED FOR FIRST ----
   The scoping depends on blockResult.weeks and state.days naming the same
   weeks. They do, and NOT by array position: buildDaysFromWeeks() stamps
   `week: wk.week` on every day it writes, so the join is on the week object's
   own number. Proven here rather than assumed, because the whole dimension
   is selected by it -- and proven against the REGENERATED blockResult, which
   is the one raceGoalReadiness() is actually handed. */
test('blockResult.weeks and state.days name the same weeks, by w.week', () => {
  DISTANCES.forEach(([dk, vol, wk]) => {
    const a = raceApp(dk, vol, wk);
    const br = a.raceGoalCheckpointBlock();
    assert.ok(br && br.weeks && br.weeks.length, dk + ': no regenerated block');
    const weekNums = br.weeks.map(w => w.week);
    assert.ok(weekNums.every(n => Number.isInteger(n) && n >= 1),
      dk + ': a week carries no usable number: ' + JSON.stringify(weekNums));
    assert.equal(weekNums.length, new Set(weekNums).size, dk + ': duplicate week numbers');
    assert.equal(weekNums.join(','),
      Array.from({ length: a.state.setup.planWeeks }, (_, i) => i + 1).join(','),
      dk + ': the regenerated weeks are not 1..planWeeks');
    const dayWeeks = [...new Set(a.state.days.map(d => d.week))].sort((x, y) => x - y);
    assert.equal(dayWeeks.join(','), weekNums.join(','),
      dk + ': the plan the athlete holds names different weeks from the block');
    // and every day lands in a week the block knows about
    assert.equal(a.state.days.filter(d => weekNums.indexOf(d.week) === -1).length, 0,
      dk + ': a day belongs to no week of the block');
  });
});

test('the developing weeks are the readiness dimensions’ own, race and taper excluded', () => {
  DISTANCES.forEach(([dk, vol, wk]) => {
    const a = raceApp(dk, vol, wk);
    const br = a.raceGoalCheckpointBlock();
    const developing = br.weeks.filter(w => !w.isRace && !w.isTaper && !w.eventTaperApplied);
    assert.ok(developing.length > 0 && developing.length < br.weeks.length,
      dk + ': the filter selected everything or nothing');
    const last = developing[developing.length - 1].week;
    assert.ok(br.weeks.filter(w => w.week > last).every(w => w.isRace || w.isTaper || w.eventTaperApplied),
      dk + ': a developing week sits after the taper');
    // and the measurement reads exactly those weeks
    a.declareRestriction('none', a.state.setup.raceDate);
    const f = a.restrictionDeliveredFraction(developing);
    const inScope = a.state.days.filter(d => developing.some(w => w.week === d.week));
    const asked = inScope.reduce((s, d) =>
      s + ((d.restricted && d.restricted.from) ? d.restricted.from.km : d.km || 0), 0);
    assert.ok(f, dk + ': no reading at all');
    assert.equal(f.prescribedKm, Math.round(asked * 10) / 10,
      dk + ': the measurement read days outside the developing weeks');
  });
});

/* ---- THE DEFECT, AND THE BANDS ---- */
test('six weeks lost no longer reads READY', () => {
  const a = raceApp('full', 70, 16);
  assert.equal(prep(a).verdict, 'READY', 'the fixture does not start from READY');
  a.declareRestriction('none', a.addDays(TODAY, 41));            // six weeks
  const d = dimOf(a, 'interruption');
  assert.ok(d, 'the interruption never reached the verdict');
  assert.ok(d.fraction < 0.70, 'fraction ' + d.fraction);
  assert.equal(d.met, false);
  assert.equal(prep(a).verdict, 'INSUFFICIENT');
  assert.equal(prep(a).limitedBy, 'interruption');
});

test('the bands are the product’s own: 0.90 ready, 0.70 marginal, below that insufficient', () => {
  const a0 = raceApp('full', 70, 16);
  assert.equal(a0.RACE_GOAL_READY_FRACTION, 0.9);
  assert.equal(a0.RACE_GOAL_MARGINAL_FRACTION, 0.7);
  const seen = [];
  [3, 7, 14, 21, 42].forEach(days => {
    const a = raceApp('full', 70, 16);
    a.declareRestriction('none', a.addDays(TODAY, days - 1));
    const d = dimOf(a, 'interruption');
    const v = prep(a).verdict;
    seen.push({ days, f: d.fraction, v });
    if (d.fraction >= 0.90) assert.equal(v, 'READY', days + ' days: ' + v);
    else if (d.fraction >= 0.70) assert.equal(v, 'MARGINAL', days + ' days: ' + v);
    else assert.equal(v, 'INSUFFICIENT', days + ' days: ' + v);
  });
  // and it is monotonic: more time out never reads as better preparation
  for (let i = 1; i < seen.length; i++)
    assert.ok(seen[i].f <= seen[i - 1].f,
      'a longer interruption scored higher: ' + JSON.stringify(seen));
});

test('it can only ever lower the verdict, never raise it', () => {
  DISTANCES.forEach(([dk, vol, wk]) => {
    const a = raceApp(dk, vol, wk);
    const before = prep(a);
    const beforeDims = (before.dimensions || []).map(d => d.key + ':' + d.fraction).join('|');
    a.declareRestriction('none', a.addDays(TODAY, 20));
    const after = prep(a);
    const d = dimOf(a, 'interruption');
    assert.ok(d.fraction <= 1, dk + ': the fraction exceeded one');
    // the three prescription dimensions are untouched -- durability included
    assert.equal((after.dimensions || []).filter(x => x.key !== 'interruption')
                   .map(x => x.key + ':' + x.fraction).join('|'), beforeDims,
      dk + ': a restriction moved a dimension it was told not to touch');
    const rank = { INSUFFICIENT:0, MARGINAL:1, READY:2 };
    assert.ok(rank[after.verdict] <= rank[before.verdict],
      dk + ': readiness went up because of an injury');
  });
});

test('with no declaration the verdict is byte-identical to before', () => {
  DISTANCES.forEach(([dk, vol, wk]) => {
    const a = raceApp(dk, vol, wk);
    const p = prep(a);
    assert.equal((p.dimensions || []).filter(d => d.key === 'interruption').length, 0,
      dk + ': an interruption dimension appeared without a declaration');
    assert.equal(a.restrictionDeliveredFraction(
      a.raceGoalCheckpointBlock().weeks.filter(w => !w.isRace && !w.isTaper)), null);
  });
});

test('a restriction that fell entirely in the taper is not reported here', () => {
  const a = raceApp('full', 70, 16);
  const br = a.raceGoalCheckpointBlock();
  const developing = br.weeks.filter(w => !w.isRace && !w.isTaper && !w.eventTaperApplied);
  const tapered = br.weeks.filter(w => w.isRace || w.isTaper || w.eventTaperApplied)
                          .map(w => w.week);
  assert.ok(tapered.length > 0, 'the fixture has no taper to restrict');
  a.state.setup.restriction = { level:'none', from:TODAY, until:a.state.setup.raceDate,
    declaredAt:'2026-01-01T00:00:00.000Z', endedAt:null, endedOn:null };
  a.state.days.forEach(d => {
    if (tapered.indexOf(d.week) === -1) return;
    d.restricted = { at:'2026-01-01T00:00:00.000Z', level:'none' };
    if (d.type === 'rest' || d.type === 'race' || d.type === 'checkpoint') return;
    d.restricted.from = a.workoutSnapshot(d);
    d.type = 'rest'; d.km = 0; d.title = 'Rest'; delete d.prescription;
  });
  assert.ok(a.state.days.filter(d => d.restricted).length > 0, 'nothing was staged');
  assert.equal(a.restrictionDeliveredFraction(developing), null,
    'a taper-only interruption was scored against the developing weeks');
  // the scoping decision, stated: this dimension is as blind to the taper as
  // workload, durability and specificity already are.
  assert.equal(((prep(a) || {}).dimensions || []).filter(d => d.key === 'interruption').length, 0);
});

test('no recency weighting: the same loss early and late reads the same', () => {
  const early = raceApp('full', 70, 16);
  const late = raceApp('full', 70, 16);
  // stage the same fourteen-day loss in two different weeks of the same block
  [[early, -35], [late, -7]].forEach(([a, offset]) => {
    const from = a.addDays(TODAY, offset), until = a.addDays(from, 13);
    stageHistoricRestriction(a, from, until, 'none');
  });
  const e = dimOf(early, 'interruption'), l = dimOf(late, 'interruption');
  assert.ok(e && l);
  /* THE PROOF THAT NO WEIGHTING TERM EXISTS AT ALL: each fraction is exactly
     delivered over prescribed, recomputed here from the plan without any
     reference to where the loss sat. Neither reading can carry a discount a
     bare comparison of the two would hide, because any such term would make
     one of these two equalities fail. */
  [[early, e], [late, l]].forEach(([a, d]) => {
    assert.equal(d.fraction,
      Math.min(1, Math.round((d.detail.deliveredKm / d.detail.prescribedKm) * 100) / 100));
  });
  assert.ok(e.fraction < 1 && l.fraction < 1, 'neither interruption registered');
  /* Same denominator -- the whole developing block, whichever weeks were
     lost -- and a different numerator, because weeks 6-8 ask for more
     running than weeks 2-4. That difference is the training, not a
     position term. */
  assert.equal(e.detail.prescribedKm, l.detail.prescribedKm);
  assert.notEqual(e.detail.deliveredKm, l.detail.deliveredKm);
});

test('no goal is changed by any of it', () => {
  const a = raceApp('full', 70, 16);
  const goal = JSON.stringify({ g:a.state.setup.goals, active:a.state.setup.activeGoal,
                                date:a.state.setup.raceDate, dk:a.state.setup.distanceKey });
  a.declareRestriction('none', a.addDays(TODAY, 41));
  prep(a); a.restrictionViability(); a.renderRestrictionCard(); a.renderCheckpointIntervention();
  assert.equal(JSON.stringify({ g:a.state.setup.goals, active:a.state.setup.activeGoal,
                                date:a.state.setup.raceDate, dk:a.state.setup.distanceKey }), goal);
});

/* ---- THE SENTENCE THE ATHLETE READS ---- */
test('prepLabelFor no longer answers "preparation" for the commonest shortfall', () => {
  const a = raceApp('full', 70, 16);
  assert.equal(a.prepLabelFor('workload'), 'weekly volume');
  assert.equal(a.prepLabelFor('volume'), 'weekly volume');
  assert.equal(a.prepLabelFor('durability'), 'long run');
  assert.equal(a.prepLabelFor('specificity'), 'race-pace work');
  assert.equal(a.prepLabelFor('frequency'), 'running days');
  assert.equal(a.prepLabelFor('something-new'), 'preparation');
});

test('the reason is said in a frame that fits it, and never blames the plan for an injury', () => {
  const a = raceApp('full', 70, 16);
  ['workload', 'durability', 'specificity'].forEach(k =>
    assert.match(a.prepShortSentence(k), /the block has not yet built the/));
  assert.doesNotMatch(a.prepShortSentence('workload'), /the preparation this race/);
  const interrupted = a.prepShortSentence('interruption');
  assert.match(interrupted, /injury or illness/);
  assert.doesNotMatch(interrupted, /the block has not yet built/);
  assert.doesNotMatch(a.prepShortSentence('absorption'), /the block has not yet built/);
});

// =====================================================================
// 12. WHAT COUNTS AS DELIVERED RACE PREPARATION
// =====================================================================

/* KILOMETRES ARE NOT THE WHOLE OF DELIVERY. Once easy-only stopped scaling
   distances, a km-only reading credited six weeks of removed quality as
   fully delivered preparation and the verdict read READY -- the interruption
   dimension's own defect arriving through the other level.

   AND TYPE IS NOT THE AUTHORITY FOR THE FIX. The runtime had already ruled on
   this exact question in the goal-pace budget note: isQualityType() is
   "blind: keyed on dd.type"; dd.mpSegment is "EXACT -- true for exactly the
   long runs that carry goal pace". These tests are the proof, run against
   every session kind a Race Goal block actually produces. */

test('type alone cannot separate preserved from converted stimulus', () => {
  const a = raceApp('full', 70, 16);
  a.declareRestriction('easy', a.addDays(TODAY, 60));
  const rows = a.state.days.filter(d => d.restricted && d.restricted.from);
  const kinds = {};
  rows.forEach(d => {
    const f = d.restricted.from;
    const k = f.type + (f.mpSegment ? '+mp' : '');
    kinds[k] = kinds[k] || { km:0, credited:0, nowType:d.type };
    kinds[k].km += f.km || 0;
    kinds[k].credited += a.restrictionDayDelivered(d, f);
  });
  /* THE CASE THAT BREAKS TYPE: a plain long run and a goal-pace long run are
     the same type, both become 'easy' at the same distance, and they must be
     credited differently. No comparison of dd.type could do this. */
  assert.ok(kinds['long'] && kinds['long+mp'], 'the fixture has only one kind of long run');
  assert.equal(kinds['long'].nowType, 'easy');
  assert.equal(kinds['long+mp'].nowType, 'easy');
  assert.equal(Math.round(kinds['long'].credited), Math.round(kinds['long'].km),
    'an aerobic long run lost its durability credit -- that is modifying durability');
  assert.equal(kinds['long+mp'].credited, 0,
    'goal-pace work lost out of a long run was credited as delivered');
  // and every hard session that is no longer hard delivers nothing
  Object.keys(kinds).forEach(k => {
    if (a.isQualityType(k.replace('+mp', ''))) assert.equal(kinds[k].credited, 0, k);
  });
  // while easy running, which was never converted, is credited in full
  assert.equal(Math.round(kinds['easy'].credited), Math.round(kinds['easy'].km));
});

test('the two authorities are the product’s own, each asked its own question', () => {
  const a = raceApp('full', 70, 16);
  const snap = (type, mp, km) => ({ type, mpSegment: !!mp, km });
  // a hard session that is no longer hard
  assert.equal(a.restrictionDayDelivered({ type:'easy', km:10 }, snap('threshold', false, 10)), 0);
  // a hard session still hard (nothing converted it)
  assert.equal(a.restrictionDayDelivered({ type:'threshold', km:10 }, snap('threshold', false, 10)), 10);
  // goal-pace work gone, type unchanged -- only mpSegment can see this
  assert.equal(a.restrictionDayDelivered({ type:'long', km:22 }, snap('long', true, 22)), 0);
  // an aerobic long run under a different name, same distance
  assert.equal(a.restrictionDayDelivered({ type:'easy', km:22 }, snap('long', false, 22)), 22);
  // a protected day carries no snapshot and asks for what it always did
  assert.equal(a.restrictionDayDelivered({ type:'race', km:42.2 }, null), 42.2);
});

test('an easy-only restriction is no longer invisible to readiness', () => {
  const bands = [];
  [7, 21, 42].forEach(days => {
    const a = raceApp('full', 70, 16);
    a.declareRestriction('easy', a.addDays(TODAY, days - 1));
    const p = prep(a);
    const d = (p.dimensions || []).filter(x => x.key === 'interruption')[0];
    assert.ok(d, days + ' days: no interruption dimension');
    bands.push({ days, f:d.fraction, v:p.verdict });
    if (d.fraction >= 0.90) assert.equal(p.verdict, 'READY');
    else if (d.fraction >= 0.70) assert.equal(p.verdict, 'MARGINAL');
    else assert.equal(p.verdict, 'INSUFFICIENT');
  });
  assert.ok(bands[2].f < 1, 'six weeks of easy-only still reads as fully delivered');
  assert.notEqual(bands[2].v, 'READY',
    'six weeks with every quality session removed still reads READY');
  for (let i = 1; i < bands.length; i++)
    assert.ok(bands[i].f <= bands[i - 1].f, JSON.stringify(bands));
});

test('the no-running level is unchanged by the delivery definition', () => {
  // HQ preserved these numbers; they must not move with the easy-only fix
  const expect = { 7:0.92, 21:0.78, 42:0.52 };
  Object.keys(expect).forEach(days => {
    const a = raceApp('full', 70, 16);
    a.declareRestriction('none', a.addDays(TODAY, Number(days) - 1));
    assert.equal(dimOf(a, 'interruption').fraction, expect[days], days + ' days');
  });
});

test('durability is still not modified, and the bands and scope are unchanged', () => {
  DISTANCES.forEach(([dk, vol, wk]) => {
    const a = raceApp(dk, vol, wk);
    const beforeDims = (prep(a).dimensions || []).map(d => d.key + ':' + d.fraction).join('|');
    a.declareRestriction('easy', a.addDays(TODAY, 20));
    const after = prep(a);
    assert.equal((after.dimensions || []).filter(x => x.key !== 'interruption')
                   .map(x => x.key + ':' + x.fraction).join('|'), beforeDims,
      dk + ': an easy-only restriction moved a dimension it was told not to touch');
    assert.ok(dimOf(a, 'interruption').fraction <= 1, dk + ': fraction above one');
  });
});

test('no surface anywhere promises a return Valhalla does not size', () => {
  /* Caught by a screenshot, not by a test: the ramp was removed and two
     field hints went on saying "eases you back in". Pinned here so the next
     reader of this copy has to mean it. */
  const a = app();
  a.declareRestriction('easy', a.addDays(TODAY, 14));
  const surfaces = [a.renderSettingsHubView(), a.renderRestrictionCard(), a.renderTodayView()];
  a.restrictionDraft = null;
  a.openRestrictionModal();
  surfaces.push(a.RESTRICTION_META.easy.applied, a.RESTRICTION_META.none.applied);
  surfaces.forEach((html, i) =>
    assert.doesNotMatch(String(html), /eases? you back in/i, 'surface ' + i));
});
