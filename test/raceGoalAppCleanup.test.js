'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THREE RACE GOAL APP CLEANUPS, HELD SHUT
   =========================================================================
   1. Race Goal no longer asks for a Current Weekly Volume, and cannot regain
      that authority through APP state.
   2. The Fitness Checkpoint's verdict reaches the athlete on Today, rendered
      from SYSTEM's assessment and deciding nothing of its own.
   3. Athlete Experience displays as Developing / Established / Advanced while
      the pathway keys stay novice / experienced / advanced.

   WHAT MUST REMAIN TRUE THROUGHOUT: the other three products still ask their
   volume question and still build the same programmes, and Race Goal
   methodology is untouched by any of it. */

const RUNTIME = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
const SPEC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'builder-spec.js'), 'utf8');
const TODAY = '2026-09-02';

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
function bare(distKey, exp){
  const a = app();
  a.state = a.makeDefaultState();
  a.state.setup = { distanceKey: distKey, experience: exp || 'experienced', purpose: 'race' };
  return a;
}
const shape = r => JSON.stringify((r.weeks || []).map(w => [w.volume, w.phase, w.longTarget, w.hasGoalSegment]));

// =====================================================================
// 1. CURRENT WEEKLY VOLUME — THE QUESTION IS GONE FROM RACE GOAL ONLY
// =====================================================================

test('the builder asks the volume question for every product except Race Goal', () => {
  const a = app();
  assert.equal(a.builderAsksWeeklyVolume('race'), false);
  ['base', 'maintain', 'speed', 'recovery'].forEach(p =>
    assert.equal(a.builderAsksWeeklyVolume(p), true, p + ' lost its volume question'));
});

test('the panel, the validator and the generator read ONE predicate', () => {
  /* Three copies of this rule is how a screen ends up hiding a question the
     validator still demands, which is a builder nobody can finish. */
  const uses = (RUNTIME.match(/builderAsksWeeklyVolume\(/g) || []).length;
  assert.ok(uses >= 4, 'expected the panel, validator, generator and review to share it');
  assert.match(RUNTIME, /bld-volume-question/, 'the field carries no class the panel can hide it by');
});

test('a Race Goal programme is identical at every typed volume, and with none', () => {
  /* The removal is only safe because the answer stopped mattering. This is
     that claim, tested rather than asserted, across all four distances and
     all three pathways. */
  ['5k', '10k', 'half', 'full'].forEach(dk => {
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      const N = dk === 'full' ? 16 : 12;
      const seen = [10, 25, 40, 60, 90, null].map(v => {
        const a = bare(dk, exp);
        return shape(a.buildBlockWeeks(dk, v, N, { purpose: 'race', experience: exp }));
      });
      assert.equal(new Set(seen).size, 1,
        dk + '/' + exp + ': the typed weekly volume still moves the programme');
    });
  });
});

test('absent and zero are different answers, and only absent is what APP sends', () => {
  /* raceGoalEntry() reads 0 as "I am not running" and routes to Aerobic Base.
     A builder that passed 0 for its removed field would send every Race Goal
     athlete to the wrong product. */
  const a = bare('half');
  assert.equal(a.raceGoalEntry(null).purpose, 'race');
  assert.equal(a.raceGoalEntry(null).entrySource, 'pathway');
  assert.equal(a.raceGoalEntry(0).purpose, 'base');
  assert.match(RUNTIME, /\? parseDistInput\(document\.getElementById\('su-volume'\)\.value\)\s*\n\s*: null;/,
    'the generator must send null, never 0, when the field is not asked');
});

test('a stale persisted volume cannot steer a rebuilt Race Goal', () => {
  const a = bare('half');
  const N = 14;
  const asBuilt = shape(a.buildBlockWeeks('half', 45, N, { purpose:'race', experience:'experienced' }));
  a.state.setup.currentVolume = 200;              // a legacy value, wildly wrong
  const rebuilt = shape(a.buildBlockWeeks('half', a.state.setup.currentVolume, N,
    { purpose:'race', experience:'experienced' }));
  assert.equal(rebuilt, asBuilt, 'a persisted figure moved a Race Goal destination');
});

test('the legacy field is retained, not deleted, so nothing downstream loses it', () => {
  const a = app();
  buildPlan(a, { distanceKey:'half', volume:45, weeks:12, startDate:TODAY });
  assert.equal(a.state.setup.currentVolume, 45, 'a legacy value was destroyed on read');
});

test('Review never reports a weekly volume the athlete was not asked for', () => {
  assert.match(RUNTIME, /var heroSub = builderAsksWeeklyVolume\(reviewPurposeSel\)/,
    'Review still prints a volume line for a Race Goal build');
});

// =====================================================================
// 2. OTHER PRODUCTS — HARD ISOLATION
// =====================================================================

test('the other three products still build exactly as they did from their figure', () => {
  ['base', 'maintain', 'speed'].forEach(p => {
    const a = bare('half');
    const lo = shape(a.buildBlockWeeks('half', 30, 8, { purpose: p, experience: 'experienced' }));
    const hi = shape(a.buildBlockWeeks('half', 60, 8, { purpose: p, experience: 'experienced' }));
    assert.notEqual(lo, hi,
      p + ' stopped responding to its weekly volume — that is a methodology change');
  });
});

test('the new absorbed-volume rung is unreachable while a figure exists', () => {
  const a = app();
  buildPlan(a, { distanceKey:'half', volume:45, weeks:12, startDate:TODAY });
  a.state.setup.currentVolume = 45;
  const withFigure = a.absorbedWeeklyVolume();
  assert.equal(withFigure.source, 'stated');
  assert.equal(withFigure.km, 45, 'the stated figure stopped being believed');
});

test('and it answers the case that previously had no answer at all', () => {
  /* Finishing a race block used to leave the next-block offer sized from the
     stale typed number. With no number the offer produced a null volume and
     startDevelopmentBlock() refused — so finishing a race would have removed
     the athlete's route into their next block. Their own demonstrated volume
     answers instead. */
  const a = app();
  buildPlan(a, { distanceKey:'half', volume:45, weeks:14, startDate: a.addDays(TODAY, -98) });
  a.state.days.forEach(d => { if (d.date < TODAY && d.type !== 'rest'){
    d.completed = true; d.actual = { km:d.km, pace:'5:20', paceUnit:'km', hr:150, rpe:5, notes:'' }; } });
  a.state.setup.currentVolume = null;
  const abs = a.absorbedWeeklyVolume();
  assert.equal(abs.source, 'demonstrated', 'no rung answered, and the next block would be refused');
  assert.ok(abs.km > 0);
  assert.ok(a.developmentBlockSpec('base', {}).volume > 0, 'the next block still cannot be built');
});

// =====================================================================
// 3. FITNESS CHECKPOINT → TODAY
// =====================================================================

function raceAthlete(distKey){
  const a = app();
  buildPlan(a, { distanceKey: distKey, volume: 45, weeks: 14, lthr: 172, maxHR: 188,
                 startDate: a.addDays(TODAY, -49) });
  const su = a.state.setup;
  su.purpose = 'race';
  const bp = a.DISTANCE_PROFILES[su.benchmark.distanceKey], pr = a.DISTANCE_PROFILES[distKey];
  const vb = a.vdotFromPerformance(bp.raceKm * 1000, su.benchmark.timeSec);
  const m = a.BUILDER_SPEC.goals.ambitionMult;
  su.goals = {};
  a.GOAL_KEYS.forEach(k => { su.goals[k] = { timeSec: Math.round(a.equivalentTimeSec(vb * m[k], pr.raceKm * 1000)) }; });
  su.activeGoal = 'B';
  return a;
}
// Two qualified performances: SYSTEM needs two to have a rate at all.
function withEvidence(a, firstPace, chkPace){
  const past = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest');
  const early = past[3];
  early.type = 'checkpoint'; early.completed = true;
  early.actual = { km: early.km || 5, pace: firstPace, hr: null, rpe: null, notes: '' };
  a.coachPersistReview(early);
  const chk = a.state.days.filter(d => d.type === 'checkpoint' && d.date !== early.date)[0];
  if (chk){ chk.completed = true;
    chk.actual = { km: chk.km, pace: chkPace, hr: null, rpe: null, notes: '' };
    a.coachPersistReview(chk); }
  return chk;
}

test('a completed checkpoint with a rate produces a Today intervention', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  const st = a.checkpointInterventionState();
  assert.ok(st, 'the checkpoint produced no question at all');
  assert.equal(st.resolved, false);
  assert.match(a.renderCheckpointIntervention(), /coach-next-title/);
  assert.match(a.renderTodayView(), /cp-card/, 'the card never reached Today');
});

test('an unrun checkpoint produces nothing', () => {
  const a = raceAthlete('half');
  assert.equal(a.checkpointInterventionState(), null);
  assert.equal(a.renderCheckpointIntervention(), '');
});

test('one measurement is not a rate, and SYSTEM withholds rather than guessing', () => {
  const a = raceAthlete('half');
  const chk = a.state.days.filter(d => d.type === 'checkpoint')[0];
  chk.completed = true;
  chk.actual = { km: chk.km, pace: '4:20', hr: null, rpe: null, notes: '' };
  a.coachPersistReview(chk);
  const r = a.raceGoalAssessment(null);
  assert.equal(r.verdict, 'withheld');
  assert.equal(a.checkpointInterventionState(), null,
    'APP invented an intervention where the engine declined to answer');
});

test('the card renders SYSTEM’s verdict and decides nothing of its own', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  const asmt = a.checkpointInterventionState().assessment;
  const html = a.renderCheckpointIntervention();
  // the recommendation shown IS the one SYSTEM named
  assert.match(html, new RegExp('data-goal="' + asmt.recommend + '"'));
  assert.match(html, /class="cp-opt is-rec/, 'the recommendation is not marked');
  // every goal SYSTEM returned is on screen, none invented
  asmt.goals.forEach(g => assert.ok(html.indexOf('Goal ' + g.key) !== -1));
  assert.equal((html.match(/data-action="checkpoint-accept"/g) || []).length >= 1, true);
  // and rendering changed nothing
  assert.equal(a.state.setup.activeGoal, 'B', 'rendering the card moved the goal');
});

test('no internal methodology vocabulary reaches the athlete', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  const html = a.renderCheckpointIntervention();
  [/VDOT/i, /vdot/, /current_goal_supported/, /different_goal_recommended/,
   /no_goal_supported/, /preparation_short/, /supportedByFitness/, /projection/]
    .forEach(re => assert.doesNotMatch(html, re, 'internal vocabulary leaked: ' + re));
});

test('Accept goes through the existing goal authority and persists', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  const st = a.checkpointInterventionState();
  const want = st.assessment.recommend;
  a.handleCheckpointAccept(want);
  assert.equal(a.state.setup.activeGoal, want, 'Accept did not set the goal');
  const rec = a.checkpointDecisionRecord();
  assert.equal(rec.action, 'accepted');
  assert.equal(rec.goal, want);
  assert.equal(rec.evidenceDate, st.evidenceDate);
});

test('Accept survives a reload and does not ask again', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  const want = a.checkpointInterventionState().assessment.recommend;
  a.handleCheckpointAccept(want);
  // reload: the state that would have been saved, read back into a fresh app
  const saved = JSON.parse(JSON.stringify(a.state));
  const b = raceAthlete('half');
  b.state = saved;
  const st2 = b.checkpointInterventionState();
  assert.equal(st2.resolved, true, 'the same decision was asked for twice');
  assert.equal(b.state.setup.activeGoal, want, 'the accepted goal did not survive reload');
  const html = b.renderCheckpointIntervention();
  assert.match(html, /cp-done/);
  assert.doesNotMatch(html, /data-action="checkpoint-accept"/, 'a resolved card still offers the decision');
});

test('the decision syncs with the goal it is about', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  a.handleCheckpointAccept(a.checkpointInterventionState().assessment.recommend);
  const sig = String(a.planContentSignature(a.state));
  a.state.setup.checkpointDecision.action = 'kept';
  assert.notEqual(String(a.planContentSignature(a.state)), sig,
    'the decision is outside the sync signature and would be lost between devices');
});

test('Decline keeps the programme and the goal, and records that it was asked', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  const before = { goal: a.state.setup.activeGoal, days: JSON.stringify(a.state.days) };
  a.handleCheckpointDecline();
  assert.equal(a.state.setup.activeGoal, before.goal, 'Decline changed the goal');
  assert.equal(JSON.stringify(a.state.days), before.days, 'Decline touched the programme');
  assert.equal(a.checkpointDecisionRecord().action, 'kept');
  assert.equal(a.checkpointInterventionState().resolved, true);
});

test('the same evidence never asks twice, and new evidence is a new question', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  a.handleCheckpointDecline();
  assert.equal(a.checkpointInterventionState().resolved, true);
  /* A later qualified performance is genuinely new evidence, so the question
     is allowed to be asked again — that is SYSTEM's lifecycle, not a
     suppression rule invented here. */
  const later = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-1)[0];
  later.type = 'checkpoint'; later.completed = true;
  later.actual = { km: later.km || 5, pace: '4:05', hr: null, rpe: null, notes: '' };
  a.coachPersistReview(later);
  const st = a.checkpointInterventionState();
  assert.ok(st, 'new evidence produced no question');
  assert.equal(st.resolved, false, 'a superseding measurement was treated as already answered');
  assert.notEqual(st.evidenceDate, a.checkpointDecisionRecord().evidenceDate);
});

test('a stale recommendation cannot persist, because none is stored', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  assert.ok(a.checkpointInterventionState());
  // The athlete's goals go away — the card must go with them, not linger.
  a.state.setup.goals = {};
  assert.equal(a.checkpointInterventionState(), null, 'a card outlived the goals it was about');
  assert.equal(a.renderCheckpointIntervention(), '');
});

test('a non-race block never shows it', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  a.state.setup.purpose = 'base';
  assert.equal(a.checkpointAssessment(), null);
  assert.equal(a.checkpointInterventionState(), null);
});

test('history and completed sessions survive both answers', () => {
  ['accept', 'decline'].forEach(which => {
    const a = raceAthlete('half');
    withEvidence(a, '4:40', '4:20');
    const done = a.state.days.filter(d => d.completed).map(d => d.id + ':' + JSON.stringify(d.actual));
    const perfs = JSON.stringify(a.measuredPerformances());
    if (which === 'accept') a.handleCheckpointAccept(a.checkpointInterventionState().assessment.recommend);
    else a.handleCheckpointDecline();
    assert.equal(a.state.days.filter(d => d.completed).map(d => d.id + ':' + JSON.stringify(d.actual)).join('|'),
      done.join('|'), which + ' corrupted a completed session');
    assert.equal(JSON.stringify(a.measuredPerformances()), perfs, which + ' lost measured history');
  });
});

test('the intervention lives on Today and nowhere else', () => {
  const a = raceAthlete('half');
  withEvidence(a, '4:40', '4:20');
  assert.match(a.renderTodayView(), /cp-card/);
  // Full Plan keeps the checkpoint week and session, and carries no decision.
  const full = a.renderWeeksList(true);
  assert.doesNotMatch(full, /cp-card|checkpoint-accept|checkpoint-decline/,
    'the decision was duplicated back into the plan');
  assert.doesNotMatch(full, /class="checkpoint"/, 'the removed Full Plan panel came back');
  assert.match(full, /Fitness Checkpoint/, 'the checkpoint marker was lost from the plan');
});

// =====================================================================
// 4. EXPERIENCE TERMINOLOGY
// =====================================================================

test('the athlete sees Developing / Established / Advanced', () => {
  const a = app();
  const m = a.BUILDER_SPEC.experience.meta;
  assert.equal(m.novice.short, 'Developing');
  assert.equal(m.experienced.short, 'Established');
  assert.equal(m.advanced.short, 'Advanced');
  assert.equal(m.novice.label, 'Developing');
  assert.equal(m.experienced.label, 'Established');
});

test('and the old athlete-facing words are gone from the spec', () => {
  const block = /experience:\s*\{[\s\S]*?\n  \},/.exec(SPEC)[0];
  const labels = (block.match(/(label|short):\s*'([^']*)'/g) || []).join(' ');
  assert.doesNotMatch(labels, /\bNew\b/, '"New" is still shown to an athlete');
  assert.doesNotMatch(labels, /\bExperienced\b/, '"Experienced" is still shown to an athlete');
});

test('the internal pathway keys did not move', () => {
  const a = app();
  assert.equal(a.BUILDER_SPEC.experience.order.join(','), 'novice,experienced,advanced');
  assert.equal(a.BUILDER_SPEC.experience.default, 'experienced');
  assert.equal(a.normaliseExperience('novice'), 'novice');
  assert.equal(a.normaliseExperience('Developing'), null, 'a display label became a stored value');
});

test('an existing plan needs no migration and behaves identically', () => {
  const a = app();
  buildPlan(a, { distanceKey:'half', volume:45, weeks:12, startDate:TODAY });
  a.state.setup.experience = 'novice';                 // as written before the rename
  assert.equal(a.athleteExperience(), 'novice');
  assert.equal(a.BUILDER_SPEC.experience.meta[a.athleteExperience()].short, 'Developing');
  const before = shape(a.buildBlockWeeks('half', 45, 12, { purpose:'race', experience:'novice' }));
  const after  = shape(a.buildBlockWeeks('half', 45, 12, { purpose:'race', experience:a.athleteExperience() }));
  assert.equal(after, before, 'the rename changed what a novice pathway builds');
});

test('the copy does not claim Advanced means currently fit', () => {
  const m = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' }).BUILDER_SPEC.experience.meta;
  assert.doesNotMatch(m.advanced.hint, /fit enough|currently fit|ready for/i);
  // and Developing is not written as incapacity
  assert.doesNotMatch(m.novice.hint, /beginner|never run|no fitness|not fit/i);
  assert.match(m.novice.hint, /Building experience/);
  assert.match(m.experienced.hint, /Comfortable with regular structured training/);
});

test('every athlete-facing surface reads the label from the one spec', () => {
  /* A hardcoded "Experienced" anywhere athlete-facing is how half the product
     renames and the other half does not. */
  assert.match(RUNTIME, /EXPERIENCE_META\[k\]\.short/);
  assert.match(RUNTIME, /EXPERIENCE_META\[athleteExperience\(\)\]\.short/);
  const start = fs.readFileSync(path.join(__dirname, '..', 'start.html'), 'utf8');
  assert.match(start, /BS\.experience\.meta\[k\]\.short/);
  assert.match(start, /BS\.experience\.meta\[Ans\.experience\]\.short/);
});

// =====================================================================
// 5. RACE GOAL METHODOLOGY IS UNTOUCHED BY ALL THREE
// =====================================================================

test('programme geometry is unchanged across every distance and pathway', () => {
  /* The three cleanups are APP work. If any of them had reached the generator
     this is where it would show: length, phases, weekly volume, long-run
     destination and quality placement, for every combination. */
  ['5k', '10k', 'half', 'full'].forEach(dk => {
    ['novice', 'experienced', 'advanced'].forEach(exp => {
      const N = dk === 'full' ? 16 : 12;
      const a = bare(dk, exp);
      const r = a.buildBlockWeeks(dk, 45, N, { purpose: 'race', experience: exp });
      assert.equal(r.planWeeks, N, dk + '/' + exp + ': block length moved');
      assert.ok(r.weeks.length === N);
      assert.ok(r.weeks.some(w => w.isTaper), dk + '/' + exp + ': the taper vanished');
      assert.ok(r.weeks.every(w => w.volume >= 0));
      assert.ok(r.weeks.filter(w => w.hasGoalSegment).length >= 0);
    });
  });
});
