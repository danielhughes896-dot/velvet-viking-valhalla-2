'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* FOUR FINDINGS FROM THE EDIT-SESSION AND FITNESS AUDIT
   =========================================================================
   1. CURRENT FITNESS / RACE OUTLOOK. A week-7 marathon athlete with six weeks
      logged and a demonstrated 57km/week was told "Not enough sustained weekly
      volume yet" -- not because of their volume, but because the gate asked
      absorbedWeeklyVolume() for source === 'measured', which is only reachable
      through loadToleranceModel(), which discards any week lacking two days of
      feel/readiness/HR. Objective evidence was being thrown away.
   2. RESCHEDULE. Every past week was offered, and so were the race and the
      Fitness Checkpoint.
   3. PROVENANCE. Nothing distinguished a Valhalla prescription from an athlete
      one, and editing a session left its structure describing the old one.
   4. LIBRARY. Personal -> Candidate -> Approved, where nothing a client can
      write is ever globally prescribable. */

const TODAY = '2026-10-14';
function app(opts){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, Object.assign({ distanceKey:'full', volume:70, weeks:16, lthr:172, maxHR:188,
                               startDate: a.addDays(TODAY, -42) }, opts || {}));
  a.state.setup.purpose = 'race';
  return a;
}
/* The athlete from the report: logs distance and pace, nothing subjective. */
function logObjectiveOnly(a, fromDaysAgo){
  const from = a.addDays(TODAY, -(fromDaysAgo == null ? 42 : fromDaysAgo));
  a.state.days.forEach(d => {
    if (d.date >= TODAY || d.date < from || d.type === 'rest') return;
    d.completed = true;
    d.actual = { km:d.km, pace:'5:20', paceUnit:'km', hr:null, rpe:null, feel:null, notes:'' };
  });
}

// =====================================================================
// 1. THE 14-DAY RULE
// =====================================================================

test('the week-7 marathon athlete finally gets an estimate', () => {
  const a = app();
  logObjectiveOnly(a);
  assert.equal(a.currentWeekNum(), 7, 'the fixture is not the athlete from the report');
  const est = a.currentFitnessEstimate('full');
  assert.ok(est && !est.withheld, 'still withheld: ' + (est && est.reason));
  assert.ok(est.fastSec > 0 && est.slowSec > est.fastSec);
});

test('objective evidence alone is enough, and the missing layer costs confidence', () => {
  const a = app();
  logObjectiveOnly(a);
  // the subjective model still cannot see this athlete at all...
  const lt = (a.athleteResponseModel() || {}).loadTolerance || {};
  assert.equal(lt.confidence, 'insufficient',
    'the fixture no longer reproduces the condition that caused the defect');
  // ...and the estimate exists anyway
  const est = a.currentFitnessEstimate('full');
  assert.ok(!est.withheld);
  const conf = a.fitnessConfidence('full');
  assert.notEqual(conf.level, 'none');
  assert.ok(conf.reasons.some(r => /heart rate|effort/i.test(r)),
    'the missing subjective layer is not reflected in confidence');
});

test('below fourteen days there is no estimate, and the reason says so', () => {
  const a = app();
  logObjectiveOnly(a, 6);                      // under a week of evidence
  const e = a.fitnessEvidence();
  assert.ok(e.spanDays < 14 && e.sessions > 0);
  const est = a.currentFitnessEstimate('full');
  assert.equal(est.withheld, true);
  assert.match(est.reason, /two weeks/);
  assert.doesNotMatch(est.reason, /sustained weekly volume/,
    'the old volume wording is still being shown');
});

test('the window is a span, so missed sessions neither reset nor block it', () => {
  const a = app(), b = app();
  logObjectiveOnly(a);
  logObjectiveOnly(b);
  // b misses everything in the middle fortnight but keeps the same first day
  const cut0 = b.addDays(TODAY, -28), cut1 = b.addDays(TODAY, -14);
  b.state.days.forEach(d => {
    if (d.date >= cut0 && d.date < cut1){ d.completed = false; d.actual = null; }
  });
  assert.equal(b.fitnessEvidence().spanDays, a.fitnessEvidence().spanDays,
    'missed sessions moved the evidence window');
  assert.ok(b.fitnessEvidence().sessions < a.fitnessEvidence().sessions);
  assert.equal(b.currentFitnessEstimate('full').withheld, false,
    'a fortnight of missed sessions blocked the estimate');
});

test('marathon volume and long-run evidence move confidence, not existence', () => {
  const a = app();
  logObjectiveOnly(a);
  const est = a.currentFitnessEstimate('full');
  assert.ok(!est.withheld, 'durability still gates the estimate');
  assert.ok(Array.isArray(est.confidenceWhy));
  assert.ok(est.confidenceWhy.some(r => /long run|weekly volume/i.test(r)),
    'durability is not reported as a confidence reason');
  assert.ok(['low','moderate','high'].indexOf(est.confidence) !== -1);
});

test('a race or checkpoint is not mandatory, and raises confidence when present', () => {
  const a = app();
  logObjectiveOnly(a);
  const without = a.fitnessConfidence('full');
  assert.ok(without.reasons.some(r => /race or checkpoint/i.test(r)));
  const chk = a.state.days.filter(d => d.type === 'checkpoint' && d.date < TODAY)[0];
  if (chk){
    chk.completed = true;
    chk.actual = { km:chk.km, pace:'4:20', paceUnit:'km', hr:null, rpe:null, notes:'' };
    a.coachPersistReview(chk);
    assert.ok(a.fitnessConfidence('full').score > without.score,
      'a measured checkpoint did not strengthen confidence');
  }
});

test('a fast short effort can never become a confident marathon', () => {
  /* THE SAFETY PROPERTY THE OLD WITHHOLDING CARRIED. Written first as a bonus
     rather than a penalty, this scored HIGH for a 10K athlete on 34km a week
     with one fast 5K, while the reasons beside it said the volume and the long
     run were both short. A shortfall that only fails to add is not a
     shortfall; the volume one now caps the whole answer. */
  const a = app({ distanceKey:'10k', volume:30, weeks:12 });
  const d = a.state.days.filter(x => x.date < TODAY && x.type !== 'rest')[0];
  d.type = 'checkpoint'; d.km = 5; d.completed = true;
  d.actual = { km:5, pace:'3:40', hr:178, rpe:10, feel:'ok', notes:'', paceUnit:'km' };
  a.coachPersistReview(d);
  const m = a.measuredFitnessEstimate('full');
  assert.equal(m.withheld, false, 'the marathon went silent again');
  assert.equal(m.confidence, 'low', 'a fast 5K produced a confident marathon');
  assert.ok((m.confidenceWhy || []).some(w => /volume/i.test(w)));
});

test('an athlete who has done the volume is not capped by that rule', () => {
  const a = app();
  logObjectiveOnly(a);
  a.state.days.forEach(d => {
    if (d.date >= TODAY || !d.completed) return;
    d.actual.hr = 150; d.actual.rpe = 5; d.actual.feel = 'good';
  });
  const conf = a.fitnessConfidence('full');
  assert.ok(conf.evidence.weeklyKm >= 50, 'the fixture athlete is not actually doing the volume');
  assert.notEqual(conf.level, 'low', 'a genuine marathon athlete was capped at low confidence');
});

test('Race Outlook answers from training when nothing has been measured', () => {
  const a = app();
  logObjectiveOnly(a);
  const o = a.raceOutlook();
  assert.equal(o.state, 'estimated', 'Race Outlook is still blank: ' + o.state);
  assert.ok(o.fastSec > 0 && o.slowSec > o.fastSec);
  const html = a.renderRaceOutlook();
  assert.match(html, /Estimated from your training so far/);
  assert.doesNotMatch(html, /Nothing measured yet/);
});

test('a measured effort still outranks it and still says so', () => {
  const a = app();
  logObjectiveOnly(a);
  const chk = a.state.days.filter(d => d.type === 'checkpoint' && d.date < TODAY)[0];
  if (!chk) return;
  chk.completed = true;
  chk.actual = { km:chk.km, pace:'4:20', paceUnit:'km', hr:null, rpe:null, notes:'' };
  a.coachPersistReview(chk);
  const o = a.raceOutlook();
  assert.equal(o.state, 'measured');
  assert.match(a.renderRaceOutlook(), /Training runs do not move it/);
});

test('none of it touches the athlete’s goal', () => {
  const a = app();
  const goal = a.state.setup.activeGoal, goals = JSON.stringify(a.state.setup.goals);
  logObjectiveOnly(a);
  a.currentFitnessEstimate('full'); a.raceOutlook(); a.fitnessConfidence('full');
  assert.equal(a.state.setup.activeGoal, goal, 'the active goal moved');
  assert.equal(JSON.stringify(a.state.setup.goals), goals, 'the goal times moved');
});

test('the shorter distances are unaffected by any of it', () => {
  const a = app({ distanceKey:'half', volume:55, weeks:14 });
  logObjectiveOnly(a);
  const est = a.currentFitnessEstimate('half');
  assert.ok(est && !est.withheld);
  assert.ok(!a.fitnessConfidence('half').reasons.some(r => /marathon/i.test(r)),
    'a half is being judged against marathon durability');
});

// =====================================================================
// 2. RESCHEDULE
// =====================================================================

function editor(a, dd){
  let html = ''; a.openModal = h => { html = h; };
  a.openEditModal(dd.id);
  return html;
}
const swapIds = html => [...html.matchAll(/data-swap="([^"]+)"/g)].map(m => m[1]);

test('only the current week onwards is offered', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'easy')[0];
  const ids = swapIds(editor(a, dd));
  const cur = a.currentWeekNum();
  assert.ok(ids.length > 0);
  assert.equal(ids.filter(id => a.findDay(id).week < cur).length, 0,
    'weeks already behind the athlete are still offered');
  assert.ok(ids.some(id => a.findDay(id).week === cur), 'the current week is not offered');
});

test('race day and the Fitness Checkpoint are never offered', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'easy')[0];
  const ids = swapIds(editor(a, dd));
  assert.equal(ids.filter(id => a.findDay(id).type === 'race').length, 0);
  assert.equal(ids.filter(id => a.findDay(id).type === 'checkpoint').length, 0);
  assert.equal(a.swapProtectedType('race'), true);
  assert.equal(a.swapProtectedType('checkpoint'), true);
  assert.equal(a.swapProtectedType('easy'), false);
});

test('Reschedule leads the editor', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'easy')[0];
  const body = editor(a, dd);
  const b = body.slice(body.indexOf('modal-body'));
  assert.ok(b.indexOf('Reschedule') < b.indexOf('Session Title'),
    'Reschedule is still below the prescription fields');
});

test('the swap guards and the fields that travel are untouched', () => {
  const a = app();
  ['type','title','km','desc','mpSegment','completed','actual','prescription','manualEdit']
    .forEach(f => assert.ok(a.SWAPPED_WORKOUT_FIELDS.indexOf(f) !== -1, f + ' stopped travelling'));
  assert.equal(typeof a.swapWouldPlaceCompletionInFuture, 'function');
  assert.equal(typeof a.confirmSwapIfLogged, 'function');
});

// =====================================================================
// 3. PRESCRIPTION PROVENANCE AND COHERENCE
// =====================================================================

test('an existing plan reads as Valhalla’s, with no migration', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.prescription)[0];
  assert.equal(dd.prescription.source, undefined, 'a stored plan was rewritten');
  assert.equal(a.prescriptionSource(dd), 'valhalla');
  assert.equal(a.isAthleteAuthored(dd), false);
});

test('a cosmetic edit leaves the structure alone', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date >= TODAY && d.prescription)[0];
  const before = JSON.stringify(dd.prescription);
  a.reconcilePrescriptionAfterEdit(dd, ['title']);
  assert.equal(JSON.stringify(dd.prescription), before);
  assert.equal(a.prescriptionSource(dd), 'valhalla');
});

test('a rescalable distance edit keeps the structure true to the new distance', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'easy')[0];
  dd.km = 12;
  a.reconcilePrescriptionAfterEdit(dd, ['km']);
  assert.equal(dd.prescription.archetype, 'easy_run');
  assert.equal(dd.prescription.params.km, 12, 'the structure still describes the old distance');
  assert.equal(dd.prescription.athleteModified, true);
});

test('a structural edit stops the prescription claiming to be Valhalla’s', () => {
  const a = app({ distanceKey:'half', volume:55, weeks:14, earnedSecondQuality:true });
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'interval')[0];
  const was = dd.prescription.archetype;
  dd.km = 8; dd.type = 'tempo';
  a.reconcilePrescriptionAfterEdit(dd, ['km','type']);
  assert.equal(a.prescriptionSource(dd), 'athlete');
  assert.equal(dd.prescription.archetype, a.ATHLETE_ARCHETYPE);
  assert.equal(dd.prescription.derivedFrom, was, 'the lineage was lost');
  // and it degrades rather than lying about its internals
  assert.equal(a.prescriptionOf(dd), null);
  assert.equal(a.segmentsFor(dd.prescription), null);
});

test('the three layers survive a real edit through the save path', () => {
  const a = app();
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'easy')[0];
  const original = JSON.parse(JSON.stringify(dd.prescription));
  dd.completed = true;
  dd.actual = { km:9.4, pace:'5:30', paceUnit:'km', hr:null, rpe:null, notes:'' };
  dd.manualEdit = { at:new Date().toISOString(), fields:['km'],
                    from:{ title:dd.title, type:dd.type, km:dd.km, desc:dd.desc,
                           mpSegment:false, prescription: original } };
  dd.km = 12;
  a.reconcilePrescriptionAfterEdit(dd, ['km']);
  // PRESCRIBED
  assert.deepEqual(a.valhallaOriginalOf(dd), original, 'the original was lost');
  // MODIFIED
  assert.equal(a.isAthleteModified(dd), true);
  assert.equal(dd.prescription.params.km, 12);
  // EXECUTED
  assert.equal(dd.actual.km, 9.4, 'the log was disturbed');
});

test('a workout the athlete wrote never carries a Valhalla archetype', () => {
  const a = app();
  const p = a.athletePrescription({ km:9, type:'tempo', name:'My Tempo' });
  assert.equal(p.source, 'athlete');
  assert.equal(p.archetype, a.ATHLETE_ARCHETYPE);
  assert.equal(a.isKnownArchetype(p.archetype), false,
    'an athlete archetype entered the Valhalla registry');
  assert.equal(p.derivedFrom, null);
});

// =====================================================================
// 4. THE LIBRARY
// =====================================================================

function libApp(){
  const a = app();
  a.state.library = { workouts: [] };
  return a;
}

test('a saved workout is personal, athlete-sourced and not prescribable', () => {
  const a = libApp();
  const w = a.librarySaveWorkout({ name:'My Tempo', type:'tempo', km:10 });
  assert.equal(w.tier, 'personal');
  assert.equal(w.source, 'athlete');
  assert.equal(a.libraryWorkoutIsPrescribable(w), false);
  assert.equal(a.libraryWorkouts().length, 1);
  assert.equal(a.librarySaveWorkout({ name:'  ' }), null, 'an unnamed workout was saved');
});

test('applying one to a day produces an athlete prescription, never a Valhalla one', () => {
  const a = libApp();
  const w = a.librarySaveWorkout({ name:'My Tempo', type:'tempo', km:10 });
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type === 'easy')[0];
  assert.equal(a.libraryApplyToDay(dd, w.id), true);
  assert.equal(a.prescriptionSource(dd), 'athlete');
  assert.equal(dd.prescription.libraryId, w.id);
  assert.equal(dd.title, 'My Tempo');
  assert.equal(dd.km, 10);
});

test('a past session cannot be overwritten from the library', () => {
  const a = libApp();
  const w = a.librarySaveWorkout({ name:'My Tempo', type:'tempo', km:10 });
  const past = a.state.days.filter(d => d.date < TODAY && d.type === 'easy')[0];
  past.completed = true;
  past.actual = { km:8, pace:'5:30', paceUnit:'km', hr:null, rpe:null, notes:'' };
  assert.equal(a.libraryApplyToDay(past, w.id), false, 'history was rewritten');
});

test('candidate submission is explicit, consented and reversible', () => {
  const a = libApp();
  const w = a.librarySaveWorkout({ name:'My Tempo', type:'tempo', km:10 });
  assert.equal(a.librarySubmitCandidate(w.id, false), false, 'submitted without consent');
  assert.equal(w.tier, 'personal');
  assert.equal(a.librarySubmitCandidate(w.id), false, 'submitted with consent omitted');
  assert.equal(a.librarySubmitCandidate(w.id, true), true);
  assert.equal(w.tier, 'candidate');
  assert.ok(w.consentedAt);
  assert.equal(a.libraryWithdrawCandidate(w.id), true);
  assert.equal(w.tier, 'personal');
  assert.equal(w.consentedAt, null);
});

test('nothing a client can write is ever globally prescribable', () => {
  const a = libApp();
  const w = a.librarySaveWorkout({ name:'My Tempo', type:'tempo', km:10 });
  a.librarySubmitCandidate(w.id, true);
  assert.equal(a.libraryWorkoutIsPrescribable(w), false, 'a candidate became prescribable');
  // even forging the tier locally is not enough — source and archetype are checked too
  w.tier = 'approved';
  assert.equal(a.libraryWorkoutIsPrescribable(w), false,
    'setting the tier locally made an athlete workout globally prescribable');
  w.source = 'valhalla';
  assert.equal(a.libraryWorkoutIsPrescribable(w), false,
    'an unknown archetype became prescribable');
});

test('a candidate payload carries structure and nothing the athlete typed', () => {
  const a = libApp();
  const w = a.librarySaveWorkout({ name:'Dan’s hill session', type:'interval', km:10,
                                   notes:'the hill by the house, after the physio' });
  a.librarySubmitCandidate(w.id, true);
  const payload = a.libraryCandidatePayload(w.id);
  assert.ok(payload);
  assert.equal(a.carriesPersonalText(payload), false, 'free text left the device');
  assert.equal(payload.name, undefined);
  assert.equal(payload.notes, undefined);
  assert.equal(payload.type, 'interval');
  // the detector is not vacuous
  assert.equal(a.carriesPersonalText(w), true);
  // and a personal workout has no payload at all
  a.libraryWithdrawCandidate(w.id);
  assert.equal(a.libraryCandidatePayload(w.id), null, 'a private workout had a shareable payload');
});

test('the library syncs, so a saved workout is not stranded on one device', () => {
  const a = libApp();
  a.state.days = a.state.days.slice(0, 3);
  const sig = String(a.planContentSignature(a.state));
  a.librarySaveWorkout({ name:'My Tempo', type:'tempo', km:10 });
  assert.notEqual(String(a.planContentSignature(a.state)), sig,
    'the library is outside the signature and would be lost between devices');
});

test('a plan saved before the library existed still loads', () => {
  const a = app();
  delete a.state.library;
  // length, not deepEqual: a sandbox array and a test-realm array are never
  // reference-equal on their prototype, which deepEqual checks.
  assert.equal(a.libraryWorkouts().length, 0);
  assert.equal(a.libraryWorkoutById('nope'), null);
  assert.equal(a.libraryCandidatePayload('nope'), null);
});
