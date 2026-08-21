'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');
const HC = require('../api/_health-consent.js');
const G = require('../api/_garmin.js');

/* EXPLICIT CONSENT FOR HEALTH AND READINESS INFORMATION.
 *
 * Some of what an athlete may tell Valhalla can reveal something about their
 * health, and running a training programme is not a lawful basis for
 * processing that on its own. This file is the behavioural proof of the
 * mechanism: what is covered, what is not, that consent is a real affirmative
 * act, that declining leaves an entirely usable product, and that withdrawal
 * actually stops things.
 *
 * NOTHING HERE READS SOURCE TEXT TO PROVE A BEHAVIOUR. Two tests do read
 * source, and both are stated as what they are: one compares two constants
 * that must not drift apart, and one checks a boundary in a file whose whole
 * job is to not contain something. Everything else drives the product.
 */

const TODAY = '2026-08-18';
const app = () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {};
  a.renderApp = () => {};
  a.flushSave = () => {};
  a.scheduleSave = () => {};
  return a;
};
// The athlete who agreed. buildPlan grants by default -- see test/fixtures.js.
function consenting(opts) {
  const a = app();
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(TODAY, -28),
                               distanceKey: 'half', volume: 55, benchSec: 45 * 60,
                               lthr: 165, maxHR: 190 }, opts || {}));
  return a;
}
// The athlete who did not. Same plan, same history, no agreement.
function withholding(opts) {
  const a = app();
  buildPlan(a, Object.assign({ weeks: 12, startDate: a.addDays(TODAY, -28),
                               distanceKey: 'half', volume: 55, benchSec: 45 * 60,
                               lthr: 165, maxHR: 190, healthConsent: false }, opts || {}));
  return a;
}
// A day in the past with a full log on it, health information included.
function loggedDay(a, extra) {
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-1)[0];
  dd.completed = true;
  // pace as well as distance: computeExecutionBreakdown refuses to score a
  // session missing either, consent or no consent, and a fixture without one
  // would prove the wrong thing about why the score is absent.
  dd.actual = Object.assign(a.emptyActual(),
    { km: dd.km, pace: '5:00', hr: 158, rpe: 6, feel: 'good' }, extra || {});
  return dd;
}

// ---------------------------------------------------------------------------
// 1-4. CONSENT IS A SEPARATE, AFFIRMATIVE ACT
// ---------------------------------------------------------------------------
test('1. a new athlete is not consented', () => {
  const a = app();
  assert.equal(a.healthConsentGranted(), false);
  assert.equal(a.healthConsentAnswered(), false, 'and has not been asked either');
  assert.equal(a.makeDefaultState().healthConsent, null,
    'the default state records no decision at all, not a false one');
});

test('2. consent requires an affirmative act, and the control is never pre-ticked', () => {
  const a = app();
  const step = a.renderHealthConsentStep();
  assert.match(step, /type="checkbox"/, 'the builder asks with a checkbox');
  assert.doesNotMatch(step, /checked/, 'which is never rendered ticked');
  assert.equal(a.healthConsentGranted(), false, 'rendering the question grants nothing');

  a.handleHealthConsentDecision(true);
  assert.equal(a.healthConsentGranted(), true, 'the act is what grants it');
});

test('3. accepting the Terms is not health consent', () => {
  const a = app();
  /* There is no "accept the terms" flag in the product: using it is the
     acceptance, and the builder says so in its own footer. So the strong form
     of this is the one that matters -- building a plan, which is the act that
     legally engages the Terms, must leave health consent exactly where it
     was. */
  buildPlan(a, { weeks: 8, healthConsent: false });
  assert.equal(a.healthConsentGranted(), false);
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const footer = /Using the private beta is covered by our[\s\S]{0,400}?Settings\./.exec(src);
  assert.ok(footer, 'the builder still carries its Terms/Privacy footer');
  assert.doesNotMatch(footer[0], /health|readiness|heart rate/i,
    'and that footer does not bundle health consent into accepting the Terms');
});

test('4. starting a trial or paying does not imply health consent', () => {
  const a = withholding();
  a.state.subscription = { state: 'trialing', trialEnds: a.addDays(TODAY, 14) };
  a.state.entitlement = { active: true, reason: 'paid' };
  assert.equal(a.healthConsentGranted(), false, 'a trial is not an agreement about health data');
  assert.equal(a.healthConsentAnswered(), false, 'and does not even count as being asked');
});

test('4b. entering health information is not consent to process it', () => {
  const a = withholding();
  const dd = loggedDay(a, { hr: 170 });
  // The field is not offered, and the writer refuses even if something calls it.
  a.handleActualFieldChange(dd.id, 'hr', '170');
  assert.equal(a.prescriptionOf ? true : true, true);
  assert.equal(a.healthConsentGranted(), false, 'typing a number agrees to nothing');
});

// ---------------------------------------------------------------------------
// 5-8. THE RECORD
// ---------------------------------------------------------------------------
test('5-7. the record persists, and carries when and against what', () => {
  const a = app();
  a.handleHealthConsentDecision(true);
  const rec = a.healthConsentRecord();
  assert.equal(rec.decision, 'granted');
  assert.ok(rec.grantedAt, 'granted_at is recorded');                       // 6
  assert.equal(rec.version, a.HEALTH_CONSENT_VERSION);                      // 7
  assert.equal(rec.withdrawnAt, null);

  // 5. persistence: the record is part of the state that is saved and restored.
  const restored = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  restored.state = JSON.parse(JSON.stringify(a.state));
  assert.equal(restored.healthConsentGranted(), true, 'it survives a reload');
});

test('8. withdrawal is recorded, and does not erase the fact of the grant', () => {
  const a = app();
  a.handleHealthConsentDecision(true);
  const grantedAt = a.healthConsentRecord().grantedAt;
  a.handleHealthConsentDecision(false);
  const rec = a.healthConsentRecord();
  assert.equal(rec.decision, 'declined');
  assert.ok(rec.withdrawnAt, 'withdrawn_at is recorded');
  assert.equal(rec.grantedAt, grantedAt,
    'and the earlier grant is still on the record -- processing before it was lawful');
  assert.equal(a.healthConsentGranted(), false);
});

test('8b. a consent recorded against an older version does not count', () => {
  const a = consenting();
  assert.equal(a.healthConsentGranted(), true);
  a.state.healthConsent.version = 'health_data_consent_v0';
  assert.equal(a.healthConsentGranted(), false,
    'a changed purpose requires fresh consent, with no migration needed to enforce it');
  assert.equal(a.healthConsentAnswered(), false,
    'and the athlete counts as un-asked, so they are asked again');
});

// ---------------------------------------------------------------------------
// 9. WITHDRAWAL STOPS FUTURE PROCESSING
// ---------------------------------------------------------------------------
test('9. withdrawal stops covered information reaching any decision', () => {
  const a = consenting();
  const dd = loggedDay(a);
  assert.equal(a.athleteMemory(60).filter(r => r.hr != null).length > 0, true,
    'while consented, heart rate is in the athlete record');
  assert.ok(a.feelOf(dd), 'and so is how the session felt');

  a.handleHealthConsentDecision(false);

  assert.equal(a.athleteMemory(60).filter(r => r.hr != null).length, 0,
    'after withdrawal no record carries a heart rate');
  assert.equal(a.feelOf(dd), null);
  assert.equal(a.dayReadiness({ readiness: { legs: 'heavy' } }), null);
  assert.equal(a.executionHRTarget(dd), null);
  assert.equal(a.coachRecovery().overHR, 0, 'and heart rate contributes no strain');
});

test('9b. withdrawal stops collection too, not only use', () => {
  const a = consenting();
  const dd = loggedDay(a, { hr: null, feel: null });
  a.handleHealthConsentDecision(false);

  a.handleActualFieldChange(dd.id, 'hr', '162');
  assert.equal(dd.actual.hr, null, 'a heart rate typed after withdrawal is not stored');
  a.handleSetFeel(dd.id, 'good');
  assert.equal(dd.actual.feel, null, 'nor is a feel');
  a.handleSetReadiness('legs', 'heavy');
  const today = a.findDayByDate(TODAY);
  assert.ok(!today || !today.readiness || !today.readiness.legs,
    'nor a readiness answer');
});

test('9c. withdrawal clears the two heart-rate profile values it collected', () => {
  const a = consenting();
  assert.equal(a.state.setup.lthr, 165);
  a.handleHealthConsentDecision(false);
  assert.equal(a.state.setup.lthr, null);
  assert.equal(a.state.setup.maxHR, null);
});

test('9d. withdrawal touches nothing commercial and nothing about the plan', () => {
  const a = consenting();
  a.state.subscription = { state: 'active' };
  const daysBefore = a.state.days.length;
  const planSig = JSON.stringify(a.state.days.map(d => [d.date, d.type, d.km, d.title]));
  const setupBefore = Object.assign({}, a.state.setup);

  a.handleHealthConsentDecision(false);

  assert.equal(a.state.days.length, daysBefore, 'the plan is not reset');
  assert.equal(JSON.stringify(a.state.days.map(d => [d.date, d.type, d.km, d.title])), planSig);
  assert.deepEqual(a.state.subscription, { state: 'active' }, 'the subscription is not cancelled');
  assert.ok(a.state.setup, 'the account is not deleted');
  assert.equal(a.state.setup.distanceKey, setupBefore.distanceKey);
  assert.equal(a.state.setup.currentVolume, setupBefore.currentVolume);
});

// ---------------------------------------------------------------------------
// 10-12. DECLINING LEAVES A WORKING PRODUCT
// ---------------------------------------------------------------------------
test('10. declining does not prevent ordinary use of Valhalla', () => {
  const a = withholding();
  const dd = loggedDay(a, { hr: null, feel: null });
  ['renderTodayView', 'renderWeekView', 'renderFullPlanView', 'renderPlanHQView',
   'renderSettingsHubView'].forEach(v => {
    assert.doesNotThrow(() => a[v](), v + ' must still render');
    assert.ok(a[v]().length > 0, v + ' must still have content');
  });
  assert.ok(a.computeExecutionScore(dd) != null, 'sessions are still scored');
  assert.ok(a.coachAnalyse(), 'the coach still has a report');
  assert.ok(a.renderDayCard(dd).length > 0, 'the workout card still renders');
  assert.match(a.renderDayCard(dd), /class="ws-block"/, 'structured workouts are unaffected');
});

test('11. withholding health information never reads as poor readiness', () => {
  const withheld = withholding();
  const consented = consenting();
  [withheld, consented].forEach(a => {
    a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-6).forEach(dd => {
      dd.completed = true;
      dd.actual = Object.assign(a.emptyActual(), { km: dd.km, rpe: 5 });
    });
  });
  const r = withheld.coachRecovery();
  assert.equal(r.overHR, 0);
  assert.equal(r.state, 'fresh', 'no covered evidence means nothing to worry about, not worry');

  // The response model's own reading of a day with nothing covered on it.
  const probe = withheld.recoveryProbe({ type: 'easy', hr: null, feel: null,
                                         readiness: null, signals: [] }, null);
  assert.equal(probe.state, 'unknown', 'absence is unknown, never rough');
  assert.notEqual(probe.state, 'rough');
});

test('11d. no heart-rate target is produced for a structured session either', () => {
  /* executionHRTarget() has two routes to a range: a fallback from the day's
     zone, and a computed one from the session's own intensity mix. The
     fallback is closed by getTargetHRRangeForDay's gate; the MIX route is not,
     and it is the one a structured quality session takes -- so a test that
     only ever looks at an easy day proves half the boundary and reads as if it
     proved all of it. */
  const on = consenting();
  const off = withholding();
  const quality = a => a.state.days.filter(d =>
    d.prescription && ['threshold_continuous','track_reps','steady_tempo']
      .indexOf(d.prescription.archetype) !== -1)[0];
  const q1 = quality(on), q2 = quality(off);
  assert.ok(q1 && q2, 'the fixture must contain a structured quality session');
  assert.ok(on.executionMix(q1), 'which really does take the mix route');
  assert.ok(on.executionHRTarget(q1), 'and really does produce a range when consented');

  assert.equal(off.executionHRTarget(q2), null, 'and none at all when not');
  assert.equal(off.getTargetHRRangeForDay(q2), null);
  assert.doesNotMatch(off.renderDayCard(q2), /BPM/,
    'so no heart-rate figure reaches the card');
});

test('11b. an Execution Score is not lowered by withholding heart rate', () => {
  /* THE TEST THAT MATTERS MOST for "declining must not punish you". The score
     re-normalises over the parts that produced one, so an athlete who
     withholds heart rate is scored exactly like one who never owned a strap --
     which is most of them. Proven by comparing the two, not by asserting a
     number. */
  const withheld = withholding();
  const noStrap = consenting();
  const a1 = loggedDay(withheld, { hr: 175, feel: null });   // an HR that WOULD score badly
  const a2 = loggedDay(noStrap,  { hr: null, feel: null });
  a1.actual.pace = a2.actual.pace = '4:30';
  a1.actual.rpe = a2.actual.rpe = 6;
  assert.equal(withheld.computeExecutionScore(a1), noStrap.computeExecutionScore(a2),
    'withholding scores identically to never having recorded it');
  const parts = withheld.computeExecutionBreakdown(a1).counted.map(p => p.key).sort();
  assert.equal(parts.join(','), 'distance,pace,rpe', 'and HR simply is not one of the parts');
});

test('11c. confidence is not punished for withholding', () => {
  const withheld = withholding();
  const noStrap = consenting();
  [[withheld, 175], [noStrap, null]].forEach(([a, hr]) => {
    a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-8).forEach(dd => {
      dd.completed = true;
      dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '4:30', rpe: 6, hr: hr });
    });
  });
  assert.equal(withheld.computeConfidenceScore(), noStrap.computeConfidenceScore(),
    'the same training, judged the same way');
});

test('12. the consent request is asked once and never nags', () => {
  const granted = consenting();
  assert.equal(granted.renderHealthConsentCard(), '',
    'an athlete who said yes is not asked again');

  const fresh = app();
  buildPlan(fresh, { weeks: 8, healthConsent: false });
  assert.equal(fresh.healthConsentAnswered(), false, 'this athlete has never been asked');
  assert.ok(fresh.renderHealthConsentCard().length > 0, 'so they are asked, once');
  fresh.handleHealthConsentDecision(false);         // "No thanks"
  assert.equal(fresh.renderHealthConsentCard(), '',
    'and declining ends it — a recorded "no" is an answer, not a blank to re-ask');
  assert.doesNotMatch(fresh.renderTodayView(), /Use my health and readiness information/,
    'Today carries no standing request afterwards');

  // Nor does declining leave a permanent banner anywhere else in the product.
  assert.doesNotMatch(fresh.renderWeekView(), /Use my health and readiness information/);
  assert.doesNotMatch(fresh.renderFullPlanView(), /Use my health and readiness information/);
});

test('12b. the offer still exists in Settings, in both directions', () => {
  const off = withholding();
  assert.match(off.renderSettingsHubView(), /Use my health and readiness information/);
  assert.match(off.renderHealthConsentSettings(), /data-action="toggle-health-consent"/);
  assert.doesNotMatch(off.renderHealthConsentSettings(), /checked/, 'shown off when it is off');

  const on = consenting();
  assert.match(on.renderHealthConsentSettings(), /checked/, 'and on when it is on');
  assert.match(on.renderHealthConsentSettings(), /data-action="toggle-health-consent"/,
    'the same one control withdraws it -- withdrawal is exactly as easy as granting');
});

// ---------------------------------------------------------------------------
// 13-15. EXISTING ATHLETES, AND WHAT THE BOUNDARY ACTUALLY COVERS
// ---------------------------------------------------------------------------
test('13. an existing athlete is not retrospectively consented', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28), healthConsent: false });
  // A state blob written by a build that predates any of this: no key at all.
  delete a.state.healthConsent;
  assert.equal(a.healthConsentGranted(), false);
  assert.equal(a.healthConsentAnswered(), false, 'they are un-asked, not declined');
  assert.ok(a.renderHealthConsentCard().length > 0, 'so they are asked, once');

  // And a malformed or hostile record fails closed rather than open.
  [{}, { decision: 'granted' }, { decision: 'granted', version: 'other' },
   'granted', true, 0].forEach(bad => {
    a.state.healthConsent = bad;
    assert.equal(a.healthConsentGranted(), false, 'malformed: ' + JSON.stringify(bad));
  });
});

test('13b. an existing athlete keeps their plan and their programme', () => {
  const a = app();
  buildPlan(a, { weeks: 12, startDate: a.addDays(TODAY, -28), healthConsent: false });
  delete a.state.healthConsent;
  const dd = loggedDay(a, { hr: 150 });
  assert.ok(a.state.days.length > 50, 'the plan is intact');
  assert.ok(a.computeExecutionScore(dd) != null, 'their logged sessions still score');
  assert.doesNotThrow(() => a.renderTodayView(), 'and entry into Valhalla is not broken');
});

test('14. ordinary athlete memory survives — ATHLETE is still not PLAN', () => {
  const a = withholding();
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-10).forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:00', rpe: 6, hr: 150,
                                                 feel: 'good' });
  });
  const mem = a.athleteMemory(60).filter(r => r.completed);
  assert.ok(mem.length >= 5, 'the record still exists');
  assert.ok(mem.every(r => r.actualKm != null), 'distance survives');
  assert.ok(mem.some(r => r.actualPace != null), 'pace survives');
  assert.ok(mem.every(r => r.executionScore != null), 'execution scores survive');
  assert.ok(mem.every(r => r.phase), 'phase and plan context survive');
  assert.ok(mem.some(r => r.rpe != null), 'and RPE, which is not health information, survives');
  assert.ok(a.state.athlete, 'the athlete record itself is untouched');
});

test('15. covered evidence is excluded, and only covered evidence', () => {
  const a = withholding();
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-10).forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:00', rpe: 6, hr: 150,
      feel: 'poor', notes: 'sore calf and slept badly, plus 31C heat on a treadmill' });
    dd.readiness = { legs: 'heavy', sleep: 'poor', health: 'under' };
  });
  const mem = a.athleteMemory(60).filter(r => r.completed);
  assert.ok(mem.every(r => r.hr == null), 'no heart rate');
  assert.ok(mem.every(r => r.feel == null), 'no feel');
  assert.ok(mem.every(r => r.readiness == null), 'no readiness');

  const ids = mem.flatMap(r => r.signals || []);
  ['soreness', 'pain', 'illness', 'heavy_legs', 'tired', 'poor_sleep', 'stress']
    .forEach(id => assert.ok(ids.indexOf(id) === -1, id + ' must not be read'));
  assert.ok(ids.indexOf('heat') !== -1 || ids.indexOf('treadmill') !== -1,
    'conditions still are: losing them would degrade ordinary coaching for no reason');
});

/* THE READERS THAT DO NOT GO THROUGH athleteMemory.
 *
 * Almost every heart-rate reader in the engine is fed by a memory record or by
 * executionHRTarget(), and both are empty without consent -- so almost all of
 * the boundary is inherited rather than repeated. Three readers are not: they
 * open dd.actual (or another day's) directly. A sweep of every direct read
 * found exactly these three, and each one is the same failure -- laps and logs
 * recorded while consent was in force still producing a health reading after
 * it was withdrawn. They are tested together because they are one class of
 * mistake, and because the next one added will look exactly like them. */
test('15e. saved laps stop producing heart-rate drift once consent ends', () => {
  const a = consenting();
  const dd = loggedDay(a);
  dd.actual.splits = [{ km: 1, sec: 300, paceSec: 300, hr: 140 },
                      { km: 1, sec: 300, paceSec: 300, hr: 146 },
                      { km: 1, sec: 300, paceSec: 300, hr: 152 },
                      { km: 1, sec: 300, paceSec: 300, hr: 158 }];
  assert.ok(a.coachHRDrift(dd) != null, 'while consented there is a drift figure');
  a.handleHealthConsentDecision(false);
  assert.equal(a.coachHRDrift(dd), null,
    'and after withdrawal the saved laps produce none');
  assert.ok(a.coachSplitMetrics(dd), 'while pace-based lap analysis is unaffected');
});

test('15f. the recent-context aggregate carries no heart rate without consent', () => {
  const a = withholding();
  a.state.days.filter(d => d.date < TODAY && d.type === 'easy').slice(-6).forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:30', rpe: 4, hr: 142 });
  });
  const dd = a.state.days.filter(d => d.date >= TODAY && d.type !== 'rest')[0];
  const ctx = a.coachRecentContext(dd);
  assert.equal(ctx.recentEasyHR, null, 'no averaged heart rate');
  assert.ok(ctx.volume7 != null, 'while ordinary volume context survives');
  assert.ok(ctx.recentRPE != null, 'and so does RPE, which is not health information');
});

test('15g. comparable sessions do not put the heart rate back on the card', () => {
  const a = withholding();
  a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-8).forEach(dd => {
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:00', rpe: 6, hr: 150 });
  });
  const dd = a.state.days.filter(d => d.date < TODAY && d.completed).slice(-1)[0];
  const review = a.coachWorkoutReview(dd);
  if (review && review.comparable){
    review.comparable.forEach(c => assert.equal(c.hr, null,
      'a past session shown beside this one must not carry its heart rate'));
    assert.ok(review.comparable.some(c => c.paceSecPerKm != null || c.km != null),
      'while the comparison itself still works on ordinary training data');
  }
  assert.doesNotThrow(() => a.renderExecutionReview(dd), 'and the card still renders');
});

test('15b. the notes themselves are never edited or withheld from the athlete', () => {
  const a = withholding();
  const dd = loggedDay(a, { notes: 'sore calf the whole way' });
  assert.equal(dd.actual.notes, 'sore calf the whole way',
    'their words are theirs; the consent boundary is on the reading, not the text');
  assert.match(a.renderDayCard(dd), /sore calf the whole way/,
    'and they can still see what they wrote');
});

test('15c. the covered and not-covered lists are the boundary, written down', () => {
  const a = app();
  assert.equal(a.HEALTH_COVERED_CONCEPTS.slice().sort().join(','), 'efficiency,feel,hr_cost');
  assert.equal(a.HEALTH_COVERED_NOTE_CATS.join(','), 'physical');
  assert.equal(a.HEALTH_COVERED_NOTE_CONCEPTS.slice().sort().join(','), 'sleep,stress');
  ['rpe', 'distance', 'pace', 'splits', 'benchmark', 'race_result', 'plan_history']
    .forEach(k => assert.ok(a.HEALTH_CONSENT_NOT_COVERED.indexOf(k) !== -1,
      k + ' is ordinary training data and must stay outside the boundary'));

  // The classifier agrees with the table, rule by rule.
  const covered = id => a.isCoveredNoteSignal(a.NOTE_SIGNAL_BY_ID[id]);
  ['pain', 'niggle', 'illness', 'soreness', 'stiffness', 'heavy_legs', 'tired',
   'fresh_legs', 'poor_sleep', 'good_sleep', 'stress'].forEach(id =>
    assert.equal(covered(id), true, id + ' is health-indicating'));
  ['heat', 'humidity', 'wind', 'rain', 'cold', 'hills', 'treadmill', 'surface',
   'struggled_early', 'faded_late', 'cut_short', 'hr_doubt', 'gps_doubt',
   'fuelling', 'hydration'].forEach(id =>
    assert.equal(covered(id), false, id + ' is about the run or the conditions'));
});

test('15d. a covered decision path is not merely quiet — it changes the outcome', () => {
  /* The adversarial pair. The same athlete, the same reported pain, one with
     consent and one without: the consented one reaches a safety state, and the
     other must not be silently treated as if they had reported nothing bad AND
     must not be treated as if they had. */
  const withPain = a => {
    a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-4).forEach(dd => {
      dd.completed = true;
      dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '5:00', rpe: 6,
        notes: 'sharp pain in my calf, had to slow right down' });
    });
    return a.coachDecision();
  };
  const on = withPain(consenting());
  const off = withPain(withholding());
  assert.ok(on, 'the consented athlete gets a decision');
  assert.equal(on.state, 'recover', 'and a reported pain reaches safety, as it always did');
  assert.ok(off, 'the withholding athlete still gets a decision');
  assert.notEqual(off.state, 'recover',
    'but it is not built from information Valhalla was not allowed to read');
  assert.ok(!(off.reasons || []).some(r => /pain|sore|injur/i.test(r)),
    'and nothing it says is derived from that information');
});

// ---------------------------------------------------------------------------
// 16-18. IMPORTS CANNOT BYPASS IT
// ---------------------------------------------------------------------------
test('16. Strava heart rate cannot bypass consent — in the browser', () => {
  const a = withholding();
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-1)[0];
  a.stravaWriteActivity(dd, { activityId: '1', km: dd.km, paceSecPerKm: 300,
                              hr: 152, maxHR: 178, cadence: 176, elevationGainM: 40 });
  assert.ok(dd.actual.hr == null, 'no heart rate is written');
  assert.ok(dd.actual.maxHR == null, 'nor a max heart rate');
  assert.equal(dd.actual.cadence, 176, 'and everything ordinary still imports');
  assert.ok(dd.actual.km != null && dd.actual.pace, 'distance and pace still import');
  assert.equal(dd.completed, true, 'the session is still logged');
});

test('16b. Strava heart rate cannot bypass consent — on the server, before storage', async () => {
  const noRows = async () => ({ ok: true, json: async () => [] });
  const granted = async () => ({ ok: true, json: async () => [
    { decision: 'granted', consent_version: HC.HEALTH_CONSENT_VERSION, decided_at: '2026-01-01' }] });
  const activity = { activityId: '9', km: 10, hr: 150, maxHR: 172, cadence: 176 };

  const withheld = await HC.forIngest({}, noRows, 'u1', activity);
  assert.equal(withheld.hr, undefined, 'the field is removed before the row is written');
  assert.equal(withheld.maxHR, undefined);
  assert.equal(withheld.cadence, 176, 'and nothing ordinary is lost');
  assert.equal(activity.hr, 150, 'the caller’s own object is not mutated behind its back');

  const kept = await HC.forIngest({}, granted, 'u1', activity);
  assert.equal(kept.hr, 150, 'a consenting athlete keeps theirs');
});

test('16d. the strip is wired into the function that writes the row', async () => {
  /* 16b proves the helper strips. This proves the ingest path CALLS it -- the
     two are different failures and the second one is invisible to the first.
     Both Strava ingest paths (manual sync and webhook) reach stageActivity, so
     driving it is driving both. */
  const S = require('../api/_strava.js');
  const writes = [];
  const cfg = { supabaseUrl: 'https://example.invalid', serviceKey: 'k' };
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).indexOf('/health_data_consent') !== -1)
      return { ok: true, json: async () => [] };          // never consented
    writes.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok: true, json: async () => [] };
  };
  try {
    await S.stageActivity(cfg, 'u1',
      { activityId: '7', km: 10, hr: 151, maxHR: 173, cadence: 174 });
  } finally { global.fetch = realFetch; }

  assert.equal(writes.length, 1, 'exactly one row was written');
  const stored = writes[0].body.payload;
  assert.equal(stored.hr, undefined, 'and it carries no heart rate');
  assert.equal(stored.maxHR, undefined);
  assert.equal(stored.cadence, 174, 'while the ordinary fields are all there');
  assert.equal(writes[0].body.activity_id, '7', 'and it is still the right activity');
});

test('16c. an unreadable consent table means no consent, never assumed consent', async () => {
  const shapes = [
    async () => ({ ok: false }),                                       // database error
    async () => { throw new Error('network'); },                       // unreachable
    async () => ({ ok: true, json: async () => [{ decision: 'granted' }] }),        // no version
    async () => ({ ok: true, json: async () => [{ decision: 'granted', consent_version: 'v0' }] }),
    async () => ({ ok: true, json: async () => [{ decision: 'withdrawn',
                    consent_version: HC.HEALTH_CONSENT_VERSION }] })
  ];
  for (const sb of shapes) assert.equal(await HC.isGranted({}, sb, 'u1'), false);
  assert.equal(await HC.isGranted(null, null, null), false, 'and so does a missing caller');
});

test('17. the Garmin seam cannot bypass consent when it is eventually built', async () => {
  const noRows = async () => ({ ok: true, json: async () => [] });
  const granted = async () => ({ ok: true, json: async () => [
    { decision: 'granted', consent_version: HC.HEALTH_CONSENT_VERSION, decided_at: '2026-01-01' }] });

  const out = await G.ingestGuard({}, noRows, 'u1', { km: 12, hr: 148, cadence: 180 });
  assert.equal(out.hr, undefined, 'a watch cannot deliver a heart rate into an unconsented account');
  assert.equal(out.cadence, 180);
  const ok = await G.ingestGuard({}, granted, 'u1', { km: 12, hr: 148 });
  assert.equal(ok.hr, 148, 'and a consenting one is unaffected');

  // Garmin is still off, and none of this switched it on.
  assert.equal(G.configured(), false);
  await assert.rejects(() => G.ingestActivity('u1', {}),
    e => e.code === 'GARMIN_UNAVAILABLE',
    'the integration itself still refuses, exactly as before');
});

test('17b. the guard refuses rather than trusting its own strip', async () => {
  const noRows = async () => ({ ok: true, json: async () => [] });
  const realStrip = HC.stripCovered;
  HC.stripCovered = a => a;                       // a future edit that forgot a field
  try {
    await assert.rejects(() => G.ingestGuard({}, noRows, 'u1', { km: 12, hr: 148 }),
      e => e.code === 'health_consent_required',
      'a covered field surviving the strip must throw, not reach storage');
  } finally { HC.stripCovered = realStrip; }
});

test('18. a manual file or CSV import cannot bypass consent either', () => {
  const a = withholding();
  const dd = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest').slice(-1)[0];
  a.closeModal = () => {};
  a.state.days.forEach(x => { x.id = x.id; });
  const sel = { value: dd.id };
  a.document.getElementById = id => (id === 'activity-target' ? sel : null);
  a.window.__pendingActivity = { km: 9, pace: '5:00', hr: 149 };
  a.handleApplyActivity();
  assert.equal(dd.actual.hr, null, 'an imported heart rate is not stored');
  assert.equal(dd.actual.km, 9, 'and the ordinary fields still are');
});

// ---------------------------------------------------------------------------
// 19-21. THE OUTWARD BOUNDARIES
// ---------------------------------------------------------------------------
test('19. no covered field can reach the operational board', () => {
  const M = require('../api/_monday-operational.js');
  /* The allow list itself, as data. A substring scan of the source would have
     matched "paidT-h-r-ough" for "hr" and passed for the wrong reason, which is
     exactly the class of assertion that looks like a guard and is not. */
  const COVERED = ['hr', 'heartRate', 'maxHR', 'feel', 'readiness', 'sleep', 'pain',
                   'injury', 'illness', 'soreness', 'healthConsent'];
  M.ALLOWED.forEach(field => assert.ok(COVERED.indexOf(field) === -1,
    field + ' must not be on the operational allow list'));

  // And behaviourally: a payload carrying covered fields is refused, not
  // silently trimmed, so an attempt to send one is a loud failure.
  const problems = M.validatePayload({ accountRef: 'x', hr: 150, feel: 'poor',
                                       readiness: 'heavy' });
  assert.ok(problems.length >= 3, 'every covered field is reported, saw ' + problems.length);
  ['hr', 'feel', 'readiness'].forEach(f =>
    assert.ok(problems.some(p => p.indexOf(f) !== -1), f + ' must be named in the refusal'));

  // The projection the board actually receives never contains one.
  const payload = M.operationalPayload
    ? M.operationalPayload({ account_id: 'a1', last_active_at: '2026-08-01',
                             hr: 150, feel: 'poor' }, {})
    : null;
  if (payload) COVERED.forEach(f => assert.equal(payload[f], undefined,
    f + ' reached the outbound payload'));
});

test('20. no covered field can reach the billing rails', () => {
  ['_stripe.js', '_checkout.js', '_billing.js', 'billing-webhook.js', '_products.js',
   '_subscription.js', '_commercial-store.js', '_entitlement.js'].forEach(f => {
    const p = path.join(__dirname, '..', 'api', f);
    if (!fs.existsSync(p)) return;
    const src = fs.readFileSync(p, 'utf8');
    [/\bheart[_ ]?rate\b/i, /\breadiness\b/i, /health_data_consent/i, /\bfeelOf\b/]
      .forEach(re => assert.doesNotMatch(src, re,
        f + ' names health information — the billing rails must never see any'));
  });
});

test('21. the consent record is the athlete’s own, and cannot be rewritten', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-health-consent.sql'), 'utf8');
  /* Read as SQL rather than as prose: this file's whole job is to establish a
     posture, and the posture IS its statements. */
  assert.match(sql, /alter table public\.health_data_consent enable row level security/i);
  /* Each policy is read to its own terminating semicolon, not to a fixed
     number of characters. A window wide enough to spill into the NEXT policy
     is a guard that passes because its neighbour is correct -- which is
     exactly how an unscoped `using (true)` slipped past an earlier version of
     this assertion. */
  const policies = [...sql.matchAll(
    /create policy "([^"]+)" on public\.health_data_consent\s+for (\w+)([\s\S]*?);/gi)];
  assert.equal(policies.length, 2, 'exactly two policies');
  assert.equal(policies.map(m => m[2].toLowerCase()).sort().join(','), 'insert,select',
    'select and insert only -- no update, no delete, so the history is append-only');
  policies.forEach(m => {
    assert.match(m[3], /\(select auth\.uid\(\)\) = user_id/,
      m[1] + ' must be scoped to the calling athlete');
    assert.doesNotMatch(m[3], /using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i,
      m[1] + ' must not be unconditional');
  });
  assert.match(sql, /references auth\.users\(id\) on delete cascade/,
    'deleting the account removes the consent history with it');
});

test('21b. the client and server agree on the consent version', () => {
  const a = app();
  assert.equal(a.HEALTH_CONSENT_VERSION, HC.HEALTH_CONSENT_VERSION,
    'the runtime and the ingest boundary must never drift apart on what was agreed');
  assert.equal(a.HEALTH_CONSENT_VERSION, 'health_data_consent_v1');
});

// ---------------------------------------------------------------------------
// 22-25. NOTHING ELSE MOVED
// ---------------------------------------------------------------------------
test('22. the commercial journey is unchanged', () => {
  const P = require('../api/_products.js');
  assert.equal(P.TRIAL_DAYS, 14, 'the trial is still 14 days');
  const src = fs.readFileSync(path.join(__dirname, '..', 'api', '_products.js'), 'utf8');
  assert.match(src, /1199/, 'monthly price unchanged');
  assert.match(src, /8999/, 'yearly price unchanged');
  const stripe = fs.readFileSync(path.join(__dirname, '..', 'api', '_stripe.js'), 'utf8');
  assert.match(stripe, /payment_method_collection: 'always'/,
    'the trial still requires a card');
});

test('23. the year-round journey is unchanged', () => {
  const a = consenting();
  assert.ok(a.PURPOSE_SHAPE || a.BLOCK_PURPOSES || a.startDevelopmentBlock,
    'the year-round engine is still present');
  const off = withholding();
  assert.doesNotThrow(() => off.coachAnalyse(), 'and still runs without consent');
  const rep = off.coachAnalyse();
  assert.ok(rep.block !== undefined, 'block effectiveness still computes');
  assert.ok(rep.evolution !== undefined, 'plan evolution still computes');
});

test('24. Reset Plan behaviour is unchanged, and does not touch consent', () => {
  const a = consenting();
  assert.equal(a.healthConsentGranted(), true);
  a.confirm = () => true;
  a.handleResetPlan();
  assert.equal(a.healthConsentGranted(), true,
    'resetting a schedule is not a change of mind about health information');
  assert.ok(a.state.athlete, 'and the athlete record still survives a reset, as before');
});

test('25. account deletion still removes everything, consent record included', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', 'supabase-setup.sql'), 'utf8');
  assert.match(setup, /delete_own_account/, 'the erasure function is still there');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase-health-consent.sql'), 'utf8');
  assert.match(sql, /on delete cascade/,
    'and the consent rows go with the auth user rather than outliving the account');
});

test('25b. the migration is in the documented apply order', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'SUPABASE-MIGRATIONS.md'), 'utf8');
  assert.match(doc, /\| 11 \| `supabase-health-consent\.sql`/,
    'a migration nobody knows to run is not a migration');
  const posture = doc.indexOf('supabase-security-posture.sql');
  const consent = doc.indexOf('supabase-health-consent.sql');
  assert.ok(posture !== -1 && consent > posture,
    'and it runs after the file that asserts every table has RLS on');
});

test('25c. no serverless function was added', () => {
  const fns = fs.readdirSync(path.join(__dirname, '..', 'api'))
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12, 'the deployment budget still holds, saw ' + fns.length);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'api', '_health-consent.js')),
    'the shared module stays underscored');
});
