'use strict';
/* COACHING AUDIT II, THE FOUNDER'S DECISIONS (15 November 2026).
 *
 * A1  "a glass sheet every week the load rises, explaining why"
 * A3  a Base block has a destination above where it starts, at the 8% equation
 * A4  under six kilometres a week, the Choose Your Pathway sheet
 * A7  max heart rate on its own sets the zones when threshold is unknown
 * A8  "Agree but give the user the choice With the glass bottom": a
 *     persistent miss pattern proposes a hold
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

function athlete(pin){
  const a = loadApp({ pinnedDate: (pin || '2026-11-16') + 'T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 30, weeks: 10, experience: 'experienced',
    startDate: '2026-11-09', schedule: { activeDays: [0, 1, 3, 4, 6], longRunDay: 6 } });
  return a;
}
const runs = (a, w) => a.state.days.filter(d => d.week === w && d.type !== 'rest' && d.km > 0);
const miss = (a, d) => { a.state.unloggedAck = a.state.unloggedAck || {}; a.state.unloggedAck[d.id] = d.date; };

/* ---------------------------------------------------------------- A1 */
test('A1: every week the load rises raises the sheet, and it says why in the plan\'s own terms', () => {
  const a = athlete();
  runs(a, 1).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'progress');
  assert.ok(rv.plannedKm > rv.lastKm + 0.5, 'the fixture\'s week two rises');
  assert.equal(rv.material, true);
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /Your plan builds towards \d/, c.why);
  assert.equal(c.yes, 'Accept Progression');
  assert.equal(c.no, 'Stay at Current Weekly Mileage');
});

test('A1: with too little logged, the sheet still comes, says so plainly and invents nothing', () => {
  const a = athlete();
  logAsPrescribed(a, runs(a, 1)[0], { quality: 1 });
  const rv = a.weeklyCoachingReview(2);
  assert.equal(rv.kind, 'insufficient');
  assert.equal(rv.material, rv.plannedKm > rv.lastKm + 0.5);
  if (!rv.material) return;
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /too little to judge/);
  assert.doesNotMatch(c.why, /recovery|adapting|effort stayed/i, 'no reading is claimed that was not made');
  assert.equal(c.yes, 'Accept Progression');
  assert.equal(c.no, 'Stay at Current Weekly Mileage');
  const planned = rv.plannedKm;
  a.answerWeeklyReview(rv, true);
  assert.equal(a.weekPlannedKm(2), planned, 'accepting keeps the plan\'s own step');
});

test('A1: staying at the current weekly mileage from the too-little-logged sheet holds the week', () => {
  const a = athlete();
  logAsPrescribed(a, runs(a, 1)[0], { quality: 1 });
  const rv = a.weeklyCoachingReview(2);
  if (!rv.material) return;
  a.answerWeeklyReview(rv, false);
  assert.ok(Math.abs(a.weekPlannedKm(2) - a.weekPlannedKm(1)) <= 1.5);
});

/* ---------------------------------------------------------------- A8 */
test('A8: a persistent miss pattern proposes a hold, and the athlete chooses', () => {
  const a = athlete('2026-11-23');
  runs(a, 1).forEach(d => miss(a, d));
  runs(a, 2).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  const sig = a.weeklyInstrumentSignals();
  assert.equal(sig.missPattern, 'persistent', 'fixture: half the last ten sessions went unrun');
  const rv = a.weeklyCoachingReview(3);
  if (rv.kind === 'planned_reduction') return;
  assert.equal(rv.kind, 'hold');
  assert.ok(rv.reasons.indexOf('miss_pattern') !== -1);
  const c = a.weeklyReviewCopy(rv);
  assert.match(c.why, /You have run \d+ of your last \d+ planned sessions/);
  assert.match(c.no, /Progress as Planned/, 'the athlete can decline the hold');
  const planned = a.weekPlannedKm(3);
  a.answerWeeklyReview(rv, false);
  assert.equal(a.weekPlannedKm(3), planned, 'declining keeps the plan');
});

/* ---------------------------------------------------------------- A3 */
test('A3: a Base block grows towards the experience build volume at the 8% equation', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  a.athleteExperience = () => 'experienced';
  a.baseObjectiveWeeks = 10;
  const obj = a.baseObjectiveFromDeclared(30, 'half', 999);
  const prog = a.pathwayProgressingWeeks('base', 10);
  const zone = a.raceGoalPathway('half', 'experienced');
  const want = Math.round(Math.min(zone.buildVolumeKm, 30 * Math.pow(a.PATHWAY_FEASIBLE_RATE, prog)) * 10) / 10;
  assert.equal(obj, want, 'objective ' + obj + ' against ' + want);
  assert.ok(obj > 30 * a.VOLUME_BLOCK_GROWTH_CAP, 'more than one 10% step');
  /* Already at the build volume: the ordinary one-step growth, never less. */
  assert.equal(a.baseObjectiveFromDeclared(zone.buildVolumeKm + 5, 'half', 999),
    Math.round((zone.buildVolumeKm + 5) * a.VOLUME_BLOCK_GROWTH_CAP * 10) / 10);
});

/* ---------------------------------------------------------------- A7 */
test('A7: max heart rate alone sets the zones, and a known threshold still wins', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' };
  a.state.setup = { lthr: null, maxHR: 190 };
  const z = a.getActiveHRZones();
  const est = Math.round(190 * a.LTHR_FROM_MAX_HR);
  assert.equal(z.T.lo, est, 'threshold zone opens at the estimated threshold');
  assert.equal(z.I.hi, 190);
  assert.match(a.lthrProvenanceSuffix(), /estimated from your max heart rate/);
  a.state.setup = { lthr: 172, maxHR: 190 };
  assert.equal(a.getActiveHRZones().T.lo, 172);
  /* Nothing without consent. */
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'declined', at: '2026-01-01T00:00:00Z' };
  a.state.setup = { lthr: null, maxHR: 190 };
  assert.equal(Object.keys(a.getActiveHRZones()).length, 0);
});

/* ---------------------------------------------------------------- A4 */
test('A4: below the entry, the builder asks the pathway question instead of refusing', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  const gp = src.slice(src.indexOf('async function handleGeneratePlan'));
  const body = gp.slice(0, gp.indexOf('\nasync function'));
  const at = body.indexOf('!raceEntry.allowed');
  assert.ok(at > 0, 'the entry boundary is still read');
  const branch = body.slice(at, at + 900);
  /* Refined the same day: below the entry the programme is Developing. An
     athlete on Developing builds straight away; any other level is offered
     Developing and may keep their own. Nothing below the entry is refused. */
  assert.match(branch, /athleteExperience\(\) === EXPERIENCE_LEVELS\[0\]/);
  assert.match(branch, /openEntryPathwaySheet\(distanceKey, volume, admSig\)/);
  assert.doesNotMatch(branch, /openRaceGoalEntryModal\(/, 'the old refusal is still reachable');
});

/* ---------------------------------------------------------------- 0 TO 3KM
   Founder, 15 November 2026: "1-3km (should be 0-3) week starting - we start
   on the normal developing programme or the new rules that no run is lower
   than 5km ... We add in coaches note run walk if needed". And of pre-race
   shakeouts: "these offer a different stimulation to normal runs so they are
   completely fine" under 5km. */
function a0(){ return loadApp({ pinnedDate: '2026-11-16T09:00:00Z' }); }
/* 5 + 5 + 5, NOT 5 + 6 + 6 (founder, 18 November 2026, the run limit): a run
   may be no more than 1km over the longest of the last 30 days, and one of
   5km or less never counts, so a low starter opens on three 5km runs. The
   15km and 5km below were 17km and 6km until that decision. */
test('0-3km: the low start reads as three runs, and the long run starts at 5km', () => {
  const a = a0();
  a.pendingEntryEvidence = { weeklyKm: 2, runDaysPerWeek: 3, longestRunKm: 2,
    longestRunDate: '2026-11-10', recordedAt: '2026-11-16T09:00:00Z' };
  const st = a.statedEntryEvidence();
  assert.equal(st.lowStart, true);
  assert.equal(st.weeklyKm, 15);
  assert.equal(st.longKm, 5);
  a.pendingEntryEvidence = { weeklyKm: 20, runDaysPerWeek: 3, longestRunKm: 8,
    longestRunDate: '2026-11-10', recordedAt: '2026-11-16T09:00:00Z' };
  assert.equal(a.statedEntryEvidence().lowStart, false, 'only 0 to 4km a week is a low start');
});
test('0-3km: every run is 5km or more and carries run/walk until it has learned', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '5k', volume: 2, weeks: 10, experience: 'novice',
    startDate: '2026-11-16', schedule: { activeDays: [1, 3, 6], longRunDay: 6 } });
  const runs = a.state.days.filter(d => d.km > 0 && d.type !== 'race' && !/Shakeout/.test(d.title || ''));
  assert.ok(runs.length > 0);
  runs.forEach(d => assert.ok(d.km >= 5 || a.isQualityType(d.type),
    'a ' + d.km + 'km ' + d.type + ' run in week ' + d.week + ' of a 2km/week plan'));
  a.state.setup.runWalkStart = true;
  const next = a.state.days.filter(d => d.km > 0 && d.type !== 'race')[0];
  assert.match(a.coachNoteText(next), /Run\/walk is fine if you need it/);
  /* Three logged 5km runs and SACORO has learned: the note stops. */
  a.state.days.filter(d => d.km > 0 && d.type !== 'race').slice(0, 3).forEach(d => {
    d.completed = true; d.actual = { km: 5.2 }; });
  const later = a.state.days.filter(d => d.km > 0 && d.type !== 'race' && !d.completed)[0];
  assert.doesNotMatch(a.coachNoteText(later) || '', /Run\/walk/);
  /* Never on a plan that did not start under 5km. */
  a.state.setup.runWalkStart = false;
  assert.equal(a.runWalkNote(next), '');
});

test('0-3km: zero is an answer in the builder, and the plan opens on three runs', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /0 if you are not running yet/);
  assert.doesNotMatch(src, /\(!volume \|\| volume <= BUILDER_SPEC\.validation\.volumeMustExceed\)/, 'zero is still refused');
  /* Founder, 15 November 2026: "1 run a week isn't enough stimuli". Week one
     is three runs, the hard session short and sharp: 5 + 5 + 5 since the run
     limit (founder, 18 November 2026; it was 5 + 6 + 6, 17km). */
  assert.match(src, /if \(runWalkStart\) volume = LOW_START_WEEK_KM;/);
  assert.equal(a0().LOW_START_WEEK_KM, 15);
  assert.equal(a0().LOW_START_LONG_KM, 5);
  assert.match(src, /runWalkStart: runWalkStart,/);
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  assert.equal(a.baseWeeklyVolumeEvidence(0).source, 'declared');
  assert.equal(a.baseWeeklyVolumeEvidence(null).source !== 'declared', true);
});

test('0-3km: below the entry the offer is the Developing programme, never a refusal', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  a.athleteExperience = () => 'experienced';
  const c = a.entryPathwayCopy('10k', 2);
  /* The sheet describes the week the plan builds (Audit III UX3-04, founder
     16 November 2026: "So change the pathway sheet?"): the low start's three
     runs, not one 5km run. */
  /* 15km with a 5km long run in every programme since the run limit
     (founder, 18 November 2026: 5 + 5 + 5; it was 16 or 17km with a 6km
     long run). */
  assert.match(c.say, /Developing 10K programme with three runs in your first week, 15km in all with a 5km long run, run\/walk if you need it/);
  assert.match(a.entryPathwayCopy('half', 2).say, /15km in all/);
  assert.equal(c.yes, 'Switch to Developing');
  assert.equal(c.no, 'Keep Established');
});

test('pre-race shakeouts may stay under 5km; they are a different stimulus', () => {
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: 'half', volume: 40, weeks: 12, experience: 'experienced', hasEvent: true,
    /* Saturday is a running day, so the day before the race has its shakeout. */
    startDate: '2026-11-16', schedule: { activeDays: [0, 1, 3, 5, 6], longRunDay: 6 } });
  const shake = a.state.days.filter(d => /Shakeout/.test(d.title || '') && d.km > 0);
  assert.ok(shake.length >= 1, 'the race week has its shakeout');
  assert.ok(shake.some(d => d.km < 5), 'the shakeout keeps its short shape');
  const other = a.state.days.filter(d => d.type === 'easy' && d.km > 0 && !/Shakeout/.test(d.title || ''));
  other.forEach(d => assert.ok(d.km >= 5, 'an ordinary easy run of ' + d.km + 'km in week ' + d.week));
});

/* Founder, 15 November 2026, of the Half and Marathon low start: the same
   week one as the 5K and 10K (a 6km run, the short hard session, a 6km long
   run), run/walk if needed, and the Half's early hard session short and
   sharp rather than a tempo. */
function lowStart(dist, exp){
  const a = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { a[f] = () => {}; });
  a.pendingEntryEvidence = { weeklyKm: 0, runDaysPerWeek: 3, recordedAt: '2026-11-16T09:00:00Z' };
  buildPlan(a, { distanceKey: dist, volume: a.LOW_START_WEEK_KM, weeks: 16, experience: exp,
    startDate: '2026-11-16', schedule: { activeDays: [1, 3, 6], longRunDay: 6 } });
  return a;
}
['half', 'full'].forEach(dist => ['novice', 'experienced'].forEach(exp => {
  /* 5 + 5 + 5 since the run limit (founder, 18 November 2026); it was
     6 + 5 + 6, 17km with a 6km long run. */
  test('0-3km ' + dist + ' (' + exp + '): week one is 5 + 5 + 5, three runs through the first recovery week', () => {
    const a = lowStart(dist, exp);
    const wk1 = runs(a, 1);
    assert.equal(wk1.length, 3, 'week one is not three runs');
    assert.equal(Math.round(wk1.reduce((t, d) => t + d.km, 0) * 10) / 10, 15, 'week one is not 15km');
    assert.equal(wk1.find(d => d.type === 'long').km, 5);
    wk1.forEach(d => assert.equal(d.km, 5, 'a ' + d.km + 'km ' + d.type + ' run in week one'));
    for (let w = 1; w <= 4; w++){
      const r = runs(a, w);
      assert.ok(r.length >= 3, 'week ' + w + ' has ' + r.length + ' runs');
      r.forEach(d => assert.ok(d.km >= 5 || a.isQualityType(d.type), 'a ' + d.km + 'km run in week ' + w));
    }
    (a.planVolumeAccounting || []).filter(x => x.week <= 4).forEach(x =>
      assert.ok(x.reconciled, 'week ' + x.week + ' carries kilometres nobody named'));
  });
}));
test('0-3km half: the early hard session is short hill repeats, never a tempo', () => {
  ['novice', 'experienced'].forEach(exp => {
    const a = lowStart('half', exp);
    for (let w = 1; w <= a.LOW_START_SHARP_WEEKS; w++){
      const hard = runs(a, w).filter(d => a.isQualityType(d.type));
      assert.equal(hard.length, 1, exp + ' week ' + w);
      assert.equal(hard[0].prescription.archetype, 'hill_repeats', exp + ' week ' + w + ' is ' + hard[0].title);
      assert.ok(hard[0].km <= 5.5, exp + ' week ' + w + ' hill session is ' + hard[0].km + 'km');
    }
  });
  /* A half that did not start low keeps its own sequence. */
  const b = loadApp({ pinnedDate: '2026-11-16T09:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave'].forEach(f => { b[f] = () => {}; });
  buildPlan(b, { distanceKey: 'half', volume: 30, weeks: 16, experience: 'novice',
    startDate: '2026-11-16', schedule: { activeDays: [1, 3, 6], longRunDay: 6 } });
  assert.ok(runs(b, 1).some(d => d.type === 'tempo'), 'a 30km half lost its opening tempo');
});
