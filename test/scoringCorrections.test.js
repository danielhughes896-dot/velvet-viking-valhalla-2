'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE FIVE SCORING CORRECTIONS. Founder:
   "Reject cycling, walking and other non-running activities as evidence of
   completing a prescribed run. Allow manual correction for incorrectly
   classified activities ... Cadence and maximum HR don't need to become
   scoring factors ... leave Optional Runs unscored ... For structured
   workouts, SACORO needs to distinguish missing evidence from successful
   execution ... That should produce a clearly labelled partial or
   unverified assessment, not an invented 100% ... fix all five, with
   regression tests across Easy, Long, Tempo, Threshold, Interval and
   race-specific sessions. Keep the existing scoring tolerances unless a
   demonstrated defect requires changing them." */

const TODAY = '2026-05-20';
function app(o) {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, Object.assign({ weeks: 16, distanceKey: 'half', startDate: a.addDays(TODAY, -70) }, o || {}));
  return a;
}
const mid = b => Math.round((b.fast + b.slow) / 2);
const past = (a, test) => a.state.days.filter(d => d.date < TODAY && test(d))[0];
function whole(a, d, extra) {
  d.completed = true; d.actual = a.emptyActual();
  a.handleActualFieldChange(d.id, 'km', String(d.km));
  a.handleActualFieldChange(d.id, 'pace', a.secToPace(mid(a.executionPaceTarget(d))));
  Object.keys(extra || {}).forEach(k => a.handleActualFieldChange(d.id, k, String(extra[k])));
}
function sections(a, d, goalPaceSec) {
  whole(a, d);
  const plan = a.loggingModeFor(d).plan;
  const paces = a.getActivePaces();
  const segs = a.orderedSegments(a.prescriptionOf(d));
  const st = plan.source === 'phases' ? a.executionStrategy(d).phases : null;
  Array.from(plan.rows).forEach((r, i) => {
    const intensity = st ? st[i].intensity : (segs.find(s => s.segId === r.segId) || {}).intensity;
    let b = a.segmentPaceBand({ intensity }, paces, a.getGoalPaceSecPerKm());
    if (intensity === 'goal_pace' && goalPaceSec) b = { fast: goalPaceSec, slow: goalPaceSec };
    a.handleStructuredSplitChange(d.id, r.segId, 'pace', a.secToPace(mid(b)));
  });
}

/* ---------- 1. EASY AND LONG: ONE INTENSITY, SCORED AS BEFORE ---------- */
test('Easy and plain Long runs logged as one total are scored exactly as before', () => {
  const a = app();
  for (const pick of [d => d.type === 'easy', d => d.type === 'long' && d.title === 'Long Run']) {
    const d = past(a, pick);
    assert.ok(d, 'the fixture has no such session');
    whole(a, d);
    assert.equal(a.executionNeedsSections(d), false, d.title + ' was taken for a structured session');
    assert.equal(a.computeExecutionScore(d), 100, d.title);
    assert.equal(a.computePartialAssessment(d), null);
  }
});

/* ---------- 2. STRUCTURED SESSIONS: SECTIONS, OR A PARTIAL ASSESSMENT ---------- */
const STRUCTURED = [
  ['Tempo', d => d.type === 'tempo'],
  ['Threshold', d => d.type === 'threshold'],
  ['Interval', d => d.type === 'interval' && /^Interval/.test(d.title || '')],
  ['Fartlek (reps by time)', d => /^Fartlek/.test(d.title || '')],
  ['Race-specific long run', d => d.type === 'long' && /Goal-Pace Insert/.test(d.title || '')],
];
for (const [name, pick] of STRUCTURED) {
  test(name + ': one total gives a labelled partial assessment and no score, never an invented 100', () => {
    const a = app();
    const d = past(a, pick);
    assert.ok(d, 'the fixture has no ' + name);
    whole(a, d);
    assert.equal(a.executionNeedsSections(d), true);
    assert.equal(a.computeExecutionScore(d), null, name + ' logged as one total still scored');
    const pa = a.computePartialAssessment(d);
    assert.equal(pa && pa.tier, 'partial');
    assert.equal(pa.paceRead, 'within');
    const html = a.renderExecutionReview(d);
    assert.match(html, /Partial assessment/);
    assert.match(html, /there is no execution score/);
    assert.doesNotMatch(html.slice(html.indexOf('exec-partial')), /\d%/, 'a percentage sits on a partial assessment');
  });
  test(name + ': every section logged on target is scored, and scores 100', () => {
    const a = app();
    const d = past(a, pick);
    sections(a, d);
    assert.equal(a.computePartialAssessment(d), null);
    assert.equal(a.computeExecutionScore(d), 100);
  });
}

test('the pace a section was typed at is the evidence, even on a rep prescribed by time', () => {
  const a = app();
  const d = past(a, d => /^Fartlek/.test(d.title || ''));
  sections(a, d);
  assert.ok(a.sectionPaceExecution(d), 'typed paces on time-based reps were thrown away');
});

/* ---------- 3. GOAL PACE: THE CARD'S BAND IN TRAINING, THE GOAL ON RACE DAY ---------- */
test('goal-pace work is judged against the band the card prints, and race day against the goal', () => {
  const a = app();
  const card = a.strategyPaceBand('goal_pace');
  assert.ok(card && card.slow > card.fast, 'the card prints no goal-pace band');
  const seg = { intensity: 'goal_pace' };
  const goal = a.getGoalPaceSecPerKm();
  assert.deepEqual(JSON.parse(JSON.stringify(a.segmentPaceBand(seg, a.getActivePaces(), goal))),
    { fast: card.fast, slow: card.slow }, 'training goal-pace work is not judged against the card');
  assert.deepEqual(JSON.parse(JSON.stringify(a.segmentPaceBand(seg, a.getActivePaces(), goal, true))),
    { fast: goal, slow: goal }, 'race day is not judged against the goal');
  /* A goal-pace rep run in the middle of the card's band scores in full. */
  const d = past(a, x => x.type === 'long' && /Goal-Pace Insert/.test(x.title || ''));
  sections(a, d, mid(card));
  assert.equal(a.computeExecutionScore(d), 100, 'a rep run as the card asked lost points');
});

test('a long run with a goal-pace finish, logged phase by phase, is scored by phase', () => {
  const a = app();
  const d = past(a, x => x.type === 'long' && x.title === 'Long Run + Goal Pace');
  assert.ok(d);
  assert.equal(a.structuredLoggingPlan(d).source, 'phases');
  sections(a, d);
  assert.ok(a.sectionPaceExecution(d), 'the phases were not read');
  assert.equal(a.computeExecutionScore(d), 100);
});

test('a single goal pace is printed as a target, never as a window from a pace to itself', () => {
  const a = app();
  assert.equal(a.fmtPaceWindow({ fast: 255, slow: 255 }), a.fmtPaceFromSecPerKm(255) + ' target');
  assert.match(a.fmtPaceWindow({ fast: 255, slow: 270 }), /–.* window$/);
});

test('race day logged as one total is still scored, against the goal', () => {
  const a = app();
  const d = a.state.days.find(x => x.type === 'race');
  assert.equal(a.executionNeedsSections(d), false);
  assert.equal(a.sectionPaceExecution(d), null, 'race day is not scored by section');
});

/* ---------- 4. HEART RATE ---------- */
test('notes that doubt the heart rate set it aside in the score, as the review already said', () => {
  const a = app({ lthr: 170, maxHR: 190 });
  const d = past(a, x => x.type === 'easy');
  const z = a.executionHRTarget(d);
  assert.ok(z && z.hi != null, 'the fixture has no heart-rate zone');
  whole(a, d, { hr: z.hi + 25 });                // a heart rate that would cost points
  const counted = a.computeHRScore(d, d.actual.hr);
  assert.ok(counted != null && counted < 100);
  d.actual.notes = 'HR strap was dodgy, ignore the heart rate';
  assert.equal(a.coachEnvironment(d.actual.notes, d.actual).hrDoubt, true, 'the fixture note is not read as doubt');
  assert.equal(a.computeHRScore(d, d.actual.hr), null, 'a heart rate the notes doubt still counts');
  assert.ok(!a.computeExecutionBreakdown(d).counted.some(p => p.key === 'hr'));
});

test('heart rate logged with no LTHR is said in the review, with the way to fix it', () => {
  const a = app();
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'granted', at: '2026-01-01T00:00:00Z' };
  const d = past(a, x => x.type === 'easy');
  whole(a, d, { hr: 150 });
  const b = a.computeExecutionBreakdown(d);
  assert.ok(b.missing.some(p => p.key === 'hr'), 'the fixture has heart-rate zones');
  const line = a.heartRateUnreadLine(d, b);
  assert.match(line, /^Heart rate 150 bpm logged, but there are no heart-rate zones to read it against until your LTHR is set in Training and Zones\.$/);
  a.coachPersistReview(d);
  assert.ok(a.renderExecutionReview(d).indexOf(line) !== -1, 'the review does not say it');
});

/* ---------- 5. ONLY A RUN IS EVIDENCE OF A RUN ---------- */
test('activity types: runs, named non-runs, and the ones that say nothing', () => {
  const a = app();
  ['Run', 'running', 'TrailRun', 'VirtualRun', 'Treadmill', 'Jog'].forEach(t => assert.equal(a.activityIsRun(t), true, t));
  ['Ride', 'cycling', 'Walk', 'Hike', 'Swim', 'Rowing', 'EBikeRide'].forEach(t => assert.equal(a.activityIsRun(t), false, t));
  [null, '', 'Other', 'Generic', 'unknown', 'Workout', '0'].forEach(t => assert.equal(a.activityIsRun(t), null, String(t)));
  assert.equal(a.activityTypeWords('Ride'), 'a ride');
  assert.equal(a.activityTypeWords('Walk'), 'a walk');
});

test('a session recorded as a ride is not scored or assessed, and says why; "It was a run" counts it', () => {
  const a = app();
  const d = past(a, x => x.type === 'easy');
  whole(a, d);
  assert.equal(a.computeExecutionScore(d), 100);
  d.actual.activityType = 'Ride';
  assert.equal(a.computeExecutionScore(d), null, 'a ride scored as a run');
  assert.equal(a.computePartialAssessment(d), null);
  assert.equal(a.computeCompletionAssessment(d), null);
  assert.match(a.renderYourLogAnswers(d), /Recorded as a ride, so it does not count as this run\./);
  assert.match(a.renderYourLogAnswers(d), /data-action="activity-is-run"/);
  a.handleActivityIsRun(d.id);
  assert.equal(d.actual.runConfirmed, true);
  assert.equal(a.computeExecutionScore(d), 100, '"It was a run" did not count it');
});

test('"Not a run?" sets an imported activity aside, and a later sync does not tick it again', () => {
  const a = app();
  const d = past(a, x => x.type === 'easy');
  whole(a, d);
  d.stravaActivityId = '424242';
  d.actual.activityType = 'Run';
  assert.match(a.renderYourLogAnswers(d), /data-action="activity-not-run"/);
  a.handleActivityNotRun(d.id);
  assert.equal(d.actual.notARun, true);
  assert.equal(d.completed, false, 'the day is still ticked');
  assert.equal(a.computeExecutionScore(d), null);
  /* The same activity arriving again is not applied. */
  const back = a.stravaWriteActivity(d, { activityId: '424242', km: d.km, paceSecPerKm: 330, activityType: 'Run' });
  assert.equal(back, 'same');
  assert.equal(d.completed, false, 'a later sync ticked it again');
  /* Hand-logged sessions are the athlete's own word: no control on them. */
  const m = past(a, x => x.type === 'easy' && x.id !== d.id);
  whole(a, m);
  assert.doesNotMatch(a.renderYourLogAnswers(m), /activity-not-run|activity-is-run/);
});

test('GPX, TCX and FIT files read their sport; a non-run is not applied to a run without "It was a run"', () => {
  const fs = require('fs'), path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const RT = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const body = n => { const i = RT.indexOf('function ' + n + '('); return RT.slice(i, RT.indexOf('\n}\n', i)); };
  assert.match(body('parseGPX'), /getElementsByTagName\('type'\)/);
  assert.match(body('parseGPX'), /activityType:/);
  assert.match(body('parseTCX'), /getAttribute\('Sport'\)/);
  assert.match(body('parseFIT'), /sessionMsg\[5\]/);
  assert.match(body('parseFIT'), /\{1:'Run', 2:'Ride', 5:'Swim', 11:'Walk', 17:'Hike'\}/);
  ['handleApplyActivity', 'handleApplyCsvRow'].forEach(n => {
    assert.match(body(n), /if \(!confirmed && activityIsRun\([a-z]+\.activityType\) === false\)\{\s*importRefuseNonRun\(/, n + ' applies a non-run');
    assert.match(body(n), /dd\.actual\.activityType = /, n + ' does not keep the sport');
  });
  assert.match(RT, /case 'apply-activity-run': handleApplyActivity\(true\); break;/);
  assert.match(RT, /case 'apply-csv-row-run': handleApplyCsvRow\(parseInt\(target\.getAttribute\('data-row'\),10\), true\); break;/);
  /* The refusal, run: the panel says so and offers the correction. */
  const a = app();
  const box = { children: [], insertBefore(el){ this.children.unshift(el); }, firstChild: null };
  a.document = { getElementById: id => id === 'import-result' ? box : null,
                 createElement: () => ({ id: '', className: '', innerHTML: '' }) };
  a.importRefuseNonRun('Ride', 'apply-activity-run', null);
  assert.match(box.children[0].innerHTML, /recorded as a ride, so it was not applied to a run/);
  assert.match(box.children[0].innerHTML, /data-action="apply-activity-run"[^>]*>It was a run</);
});

test('a CSV reads its Activity Type column', () => {
  const a = app();
  const csv = 'Activity Date,Activity Type,Distance,Average Pace\n' +
              '2026-05-12,Ride,30.1,2:10\n2026-05-13,Run,8.2,5:12\n';
  const rows = a.parseCSV(csv).rows;
  assert.equal(JSON.stringify(Array.from(rows).map(r => r.activityType)), JSON.stringify(['Ride', 'Run']));
  const plain = a.parseCSV('Date,Distance,Pace\n2026-05-13,8.2,5:12\n').rows;
  assert.equal(plain[0].activityType, null, 'a CSV with no sport was given one');
});

/* ---------- 6. WHAT DOES NOT CHANGE ---------- */
test('cadence and max HR stay supporting information: they never move a score', () => {
  const a = app({ lthr: 170, maxHR: 190 });
  const d = past(a, x => x.type === 'easy');
  whole(a, d, { hr: 150 });
  const before = JSON.stringify(a.computeExecutionBreakdown(d));
  d.actual.cadence = 150; d.actual.maxHR = 199;
  assert.equal(JSON.stringify(a.computeExecutionBreakdown(d)), before);
  d.actual.cadence = 190; d.actual.maxHR = 140;
  assert.equal(JSON.stringify(a.computeExecutionBreakdown(d)), before);
});

test('optional runs stay unscored', () => {
  const a = app();
  const rest = a.state.days.find(x => x.type === 'rest' && x.date < TODAY);
  assert.ok(rest, 'the fixture has no rest day');
  rest.completed = true;
  rest.actual = Object.assign(a.emptyActual(), { km: 5, pace: '5:30', paceUnit: 'km' });
  assert.equal(a.computeExecutionScore(rest), null);
  assert.equal(a.computePartialAssessment(rest), null);
  assert.equal(a.renderExecutionReview(rest), '');
});

/* A partial assessment is not the score, and only the score is withheld:
   what the athlete logged and the training trend stay on the card. */
test('the partial card keeps What you logged and the Training Trend, and still shows no percentage', () => {
  const a = app();
  const d = past(a, x => x.type === 'tempo');
  whole(a, d, { rpe: 7 });
  a.coachPersistReview(d);
  assert.equal(a.computeExecutionScore(d), null);
  const html = a.renderExecutionReview(d);
  assert.match(html, /exec-partial/);
  assert.match(html, /<div class="cr-k">Training Trend<\/div>/);
  assert.equal((html.match(/cr-k">Training Trend/g) || []).length, 1);
  assert.doesNotMatch(html, /\d+% EXEC|exec-pill/, 'a partial assessment printed a score');
});

/* A ride logged against a checkpoint is not a fitness measurement either:
   the paces a time trial sets must come from running it. */
test('a non-run on a checkpoint sets no fitness; "It was a run" lets it count', () => {
  const a = app();
  const d = a.state.days.filter(x => x.type === 'checkpoint')[0];
  assert.ok(d, 'the fixture has no checkpoint');
  d.completed = true;
  d.actual = Object.assign(a.emptyActual(), { km: d.km, pace: '4:30', paceUnit: 'km', activityType: 'Ride' });
  assert.equal(a.performanceFromDay(d), null, 'a ride set training paces');
  d.actual.runConfirmed = true;
  assert.ok(a.performanceFromDay(d), 'a confirmed run was still refused');
});

/* ---------- PAST SESSIONS KEEP THEIR SCORES ----------
   Founder, choosing between the corrections applying to every session or
   only to sessions logged after the release: "A". A plan that already held
   logged sessions is stamped the first time this version opens it; every
   session dated before the stamp scores exactly as it did. Checked against
   the released version itself: all 246 compared sessions identical. */
function stamped(o) {
  const a = app(o);
  a.state.scoringEvidenceFrom = TODAY;          // everything before today is history
  return a;
}
test('a past tempo, interval or goal-pace long run logged as one total keeps its score', () => {
  for (const pick of [x => x.type === 'tempo', x => x.type === 'interval', x => x.type === 'long' && /Goal/.test(x.title || '')]) {
    const a = stamped();
    const d = past(a, pick);
    whole(a, d);
    assert.equal(a.scoringLegacy(d), true);
    assert.equal(typeof a.computeExecutionScore(d), 'number', d.title + ' lost its score');
    assert.equal(a.computePartialAssessment(d), null, d.title + ' was re-marked as partial');
  }
});
test('a session dated on or after the stamp takes the corrected rules', () => {
  const a = app();
  const d = past(a, x => x.type === 'tempo');
  a.state.scoringEvidenceFrom = d.date;
  whole(a, d);
  assert.equal(a.scoringLegacy(d), false);
  assert.equal(a.computeExecutionScore(d), null);
  assert.equal(a.computePartialAssessment(d).tier, 'partial');
});
test('a past session keeps the heart rate its notes doubted, and its imported type, as it did', () => {
  const a = stamped({ lthr: 170, maxHR: 190 });
  const d = past(a, x => x.type === 'easy');
  whole(a, d, { hr: 150 });
  d.actual.notes = 'HR strap was dodgy, ignore the heart rate';
  assert.notEqual(a.computeHRScore(d, 150), null, 'a past score lost its heart rate');
  d.actual.activityType = 'Ride';
  assert.equal(typeof a.computeExecutionScore(d), 'number', 'a past imported session was re-marked');
  /* What the athlete does by hand applies to any session. */
  a.handleActivityNotRun(d.id);
  assert.equal(a.computeExecutionScore(d), null, '"Not a run?" did not set a past session aside');
});
test('the stamp: set once on a plan with logged sessions, empty on a new one', () => {
  const a = app();
  const st = { days: [{ date: '2026-05-01', completed: true, actual: { km: 5 } }] };
  a.migrateScoringEvidenceFrom(st);
  assert.equal(st.scoringEvidenceFrom, a.addDays(a.todayStr(), 1), 'today’s log is not kept as history');
  const kept = { scoringEvidenceFrom: '2026-01-01', days: st.days };
  a.migrateScoringEvidenceFrom(kept);
  assert.equal(kept.scoringEvidenceFrom, '2026-01-01', 'the stamp moved on a later open');
  const empty = { days: [{ date: '2026-05-01', completed: false }] };
  a.migrateScoringEvidenceFrom(empty);
  assert.equal(empty.scoringEvidenceFrom, '');
  assert.equal(a.makeDefaultState().scoringEvidenceFrom, '', 'a new plan has history to keep');
  /* Read on both ways in: this device's save and the account's. */
  const RT = require('fs').readFileSync(require('path').join(__dirname, '..', require('./harness.js').RUNTIME_RELATIVE), 'utf8');
  assert.equal((RT.match(/migrateScoringEvidenceFrom\((parsed|remote)\);/g) || []).length, 2);
});
