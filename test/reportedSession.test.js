'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* A SESSION WITH NO PACE IS STILL A SESSION.

   Founder, having logged a hill session in full -- three of five efforts,
   stopped for fatigue, effort 8/10, a slight fade, each rep marked -- and
   been shown "Session completed -- 5km logged, as prescribed. Distance is
   all that was recorded, so this one is not judged on pace or effort":

     "I've input all that and the analysis is still [poor] ... we need to
      verify whether the underlying coaching engine is ignoring these inputs
      or whether it's only the Execution Review text that's wrong. Those are
      two very different problems."

   It was both. No review was written for a session without an overall pace,
   so the card had nothing to say AND the engine's training signal -- which
   is decided in the review -- was never asked. The analysis the founder
   wrote out as what they expected:

     "Session partially completed. You completed 3 of 5 prescribed hill
      efforts, stopping because of fatigue. Your overall effort was high at
      8/10, and you reported a slight fade. Although the total distance
      matched the plan, the main set was incomplete. The warm-up and
      cool-down were logged, but there isn't enough objective information to
      verify the quality of each hill effort. Coaching interpretation:
      Fatigue limited completion today. SACORO should consider this alongside
      your recent training and recovery before recommending any change."

   And of the rep tiles: "Subjective rep assessments must inform qualitative
   execution scoring and coaching, with appropriate evidence confidence.
   Never treat them as measured pace." */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };
const text = h => String(h || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const OPT = { distanceKey: '5k', volume: 30, weeks: 16, lthr: 172, maxHR: 188, startDate: '2026-11-09' };
function app(pinned){
  const a = loadApp({ pinnedDate: pinned + 'T19:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'replaceCard', 'patchDerivedStats', 'patchExecutionUI', 'patchSplitsTotal']
    .forEach(f => { a[f] = () => {}; });
  buildPlan(a, OPT);
  return a;
}
/* The first hill session of the block, seen from the day after it: the
   week Recovery reads then holds it and the easy run that follows. */
let HILL_DATE = null, NEXT_DATE = null;
function hillDay(){
  if (!HILL_DATE){
    const probe = app('2026-11-09');
    HILL_DATE = probe.state.days.filter(d => d.type !== 'rest' && probe.logShape(d).hills)[0].date;
    NEXT_DATE = probe.addDays(HILL_DATE, 1);
  }
  const a = app(NEXT_DATE);
  const dd = a.state.days.filter(d => d.date === HILL_DATE)[0];
  assert.equal(a.logShape(dd).reps, 5, 'the fixture is not five hill efforts');
  return { a, dd };
}
/* Exactly what the founder entered. Rep 2 is tapped three times: on target,
   too easy, too hard. */
function founders(opts){
  opts = opts || {};
  const { a, dd } = hillDay();
  dd.completed = true; dd.actual = a.emptyActual();
  a.handleActualFieldChange(dd.id, 'km', String(dd.km));
  if (opts.distanceOnly){ a.coachPersistReview(dd); return { a, dd }; }
  const rows = Array.from(a.loggingModeFor(dd).plan.rows);
  const w = rows.filter(r => r.role === 'warmup')[0], c = rows.filter(r => r.role === 'cooldown')[0];
  if (!opts.noStages){
    a.handleStructuredSplitChange(dd.id, w.segId, 'pace', '5:09'); a.handleStructuredSplitChange(dd.id, w.segId, 'hr', '152');
    a.handleStructuredSplitChange(dd.id, c.segId, 'pace', '5:30'); a.handleStructuredSplitChange(dd.id, c.segId, 'hr', '160');
  }
  a.handleLogAnswer(dd.id, 'repsDone', String(opts.reps == null ? 3 : opts.reps));
  if (!opts.noMarks){
    a.handleLogMark(dd.id, '1');
    a.handleLogMark(dd.id, '2'); a.handleLogMark(dd.id, '2'); a.handleLogMark(dd.id, '2');
    a.handleLogMark(dd.id, '3');
  }
  a.handleLogAnswer(dd.id, 'mainSetFelt', '3');
  a.handleLogAnswer(dd.id, 'mainSetHeld', '4');
  a.handleLogAnswer(dd.id, 'rpe', '8');
  if (opts.stop !== null) a.handleLogPick(dd.id, 'stopReason', opts.stop || 'fatigue');
  a.handleLogPick(dd.id, 'hurting', 'no');
  a.coachPersistReview(dd);
  return { a, dd };
}

// ---------------------------------------------------------------------------
// 1. THE ENGINE
// ---------------------------------------------------------------------------

test('the fixture is the founder\'s session: no overall pace, so no score, and nothing here invents one', () => {
  const { a, dd } = founders();
  assert.equal(dd.actual.pace, null);
  assert.equal(a.actualPaceSecPerKm(dd), null);
  assert.equal(a.computeExecutionBreakdown(dd), null, 'a score was made for a session with no pace');
  assert.equal(a.computeExecutionScore(dd), null);
  assert.deepEqual(Array.from(dd.actual.repMarks), ['on', 'over', 'on']);
  assert.equal(dd.actual.stopReason, 'fatigue');
});

test('the engine is no longer deaf to it: a session with no pace is reviewed, and the stop for fatigue is its training signal', () => {
  const { a, dd } = founders();
  const r = dd.coachReview;
  assert.ok(r, 'no review was written for a session the athlete described in full');
  assert.equal(r.source, 'engine');
  assert.equal(r.version, a.COACH_REVIEW_VERSION);
  /* The engine's own rule, unchanged: reported fatigue is watched, not acted on. */
  assert.equal(r.trainingSignal, 'monitor_fatigue');
  assert.equal(r.trainingSignalReason, 'Subjective fatigue reported; worth watching rather than acting on yet.');
  assert.equal(r.recommendPlanAdjustment, false, 'one tired session produced a proposal');
  assert.equal(r.adjustmentType, null);
  assert.match(fnBody('coachReportedReview'), /var sig = coachTrainingSignal\(dd, env, null\);/, 'the signal is not the engine\'s own');
  assert.match(fnBody('coachWorkoutReview'), /if \(!b\) return coachReportedReview\(dd\);/);
  /* It reaches the memory every longitudinal reading is built from. */
  const mem = Array.from(a.athleteMemory(30)).filter(m => m.date === dd.date)[0];
  assert.equal(mem.trainingSignal, 'monitor_fatigue');
  assert.equal(mem.executionScore, null);
  assert.equal(mem.asPlanned, false);
  assert.equal(mem.reported.evidence, 'reported');
  assert.deepEqual(JSON.parse(JSON.stringify(mem.reported.completion)), { done: 3, of: 5, fraction: 0.6, short: true, reason: 'fatigue' });
  assert.deepEqual(JSON.parse(JSON.stringify(mem.reported.marks)), { on: 2, under: 0, over: 1, marked: 3, of: 3 });
  assert.equal(mem.reported.level, 'mixed');
  /* What was said of the set, the recoveries and the day is kept as said. */
  assert.equal(mem.reported.pattern, 'faded', 'the reported fade is not in the memory');
  assert.equal(mem.reported.recoveries, null); assert.equal(mem.reported.conditions, null);
  a.handleLogPick(dd.id, 'recoveries', 'longer');
  a.handleLogPick(dd.id, 'conditions', 'hilly'); a.handleLogPick(dd.id, 'conditions', 'windy');
  a.coachPersistReview(dd);
  const kept = Array.from(a.athleteMemory(30)).filter(m => m.date === dd.date)[0].reported;
  assert.equal(kept.recoveries, 'longer');
  assert.deepEqual(Array.from(kept.conditions), ['hilly', 'windy']);
  /* A distance and nothing else has told Sacoro nothing more, and is still not reviewed. */
  const bare = founders({ distanceOnly: true });
  assert.equal(bare.dd.coachReview, undefined, 'a distance on its own was given a review');
  assert.equal(bare.a.coachWorkoutReview(bare.dd), null);
  assert.equal(bare.a.sessionInterpretation(bare.dd), null);
  const bm = Array.from(bare.a.athleteMemory(30)).filter(m => m.date === bare.dd.date)[0];
  assert.equal(bm.trainingSignal, null); assert.equal(bm.reported, null);
});

test('with appropriate evidence confidence: it is marked as unscored and as reported, and sits below any scored review', () => {
  const { a, dd } = founders();
  const r = dd.coachReview;
  assert.equal(r.scored, false);
  assert.equal(r.reported.evidence, 'reported');
  assert.equal(r.confidence, 0.3);
  assert.equal(r.breakthrough, false);
  assert.deepEqual(Array.from(r.comparable), []);
  assert.equal(r.hrDrift, null); assert.equal(r.splitMetrics, null);
  /* A scored session of the same kind is more sure of itself, and says so. */
  const scored = hillDay();
  logAsPrescribed(scored.a, scored.dd, { quality: 1, sections: true });
  const sr = scored.a.coachWorkoutReview(scored.dd);
  assert.ok(scored.a.computeExecutionBreakdown(scored.dd), 'the comparison session did not score');
  assert.notEqual(sr.scored, false);
  assert.ok(sr.confidence > r.confidence, 'a report alone is as confident as a measurement');
  /* A scored session keeps the athlete's account beside its score, so the
     memory can tell one run in full from one stopped at three of five. */
  scored.a.handleLogAnswer(scored.dd.id, 'repsDone', '3');
  scored.a.handleLogPick(scored.dd.id, 'stopReason', 'fatigue');
  scored.a.coachPersistReview(scored.dd);
  assert.ok(scored.a.computeExecutionBreakdown(scored.dd), 'the scored session lost its score');
  assert.equal(scored.dd.coachReview.reported.evidence, 'reported');
  assert.equal(scored.dd.coachReview.reported.completion.done, 3);
  assert.equal(scored.dd.coachReview.reported.completion.reason, 'fatigue');
  const sm = Array.from(scored.a.athleteMemory(30)).filter(m => m.date === scored.dd.date)[0];
  assert.equal(sm.reported.completion.of, 5);
  assert.ok(sm.executionScore != null, 'the account replaced the score in the memory');
  /* No label is made for sharing from an account of a session. */
  assert.equal(a.shareVerdictLabel(dd), null);
  assert.match(fnBody('shareVerdictLabel'), /if \(r\.scored === false\) return null;/);
});

test('never treated as measured pace: the marks write no pace, no split and no score', () => {
  const { a, dd } = founders();
  const reps = Array.from(a.loggingModeFor(dd).plan.rows).filter(r => r.role === 'work');
  reps.forEach(r => {
    const s = Array.from(dd.actual.splits || []).filter(x => x.segId === r.segId)[0];
    assert.ok(!s || s.paceSec == null, 'a marked rep was given a pace');
  });
  ['sessionInterpretation', 'sessionReportedBlock', 'coachReportedReview', 'sessionReported', 'sessionCutShortFor'].forEach(f => {
    const body = fnBody(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/\.score\b|computeExecutionScore|computeExecutionBreakdown|paceSec\s*=|\.pace\s*=/.test(body),
      f + ' reads the assessment\'s figure or writes a measurement');
  });
  /* The scoring gate holds: the numeric scorer is read by nothing new. */
  assert.equal(a.assessSession(dd).execution.score, null);
  assert.equal(a.assessSession(dd).execution.basis, 'reported');
});

// ---------------------------------------------------------------------------
// 2. THE EXECUTION REVIEW
// ---------------------------------------------------------------------------

test('the review says what happened, why, and what the evidence supports -- in that order', () => {
  const { a, dd } = founders();
  const it = a.sessionInterpretation(dd);
  assert.equal(it.head, 'Session partially completed.');
  assert.deepEqual(Array.from(it.what), [
    'You completed 3 of 5 prescribed hill efforts, stopping because of fatigue.',
    'Your overall effort was 8/10, inside the 7–9 this session asks for, and you reported a slight fade.',
    'It felt as intended.'
  ]);
  assert.deepEqual(Array.from(it.evidence), [
    'Although the total distance matched the plan, the main set was incomplete.',
    'The warm-up and cool-down were logged. There is no measured pace for the hill efforts, so their quality rests on your own marks: 2 on target, 1 too hard.'
  ]);
  assert.equal(it.coaching, 'Fatigue limited completion today. SACORO weighs this with your recent training and recovery before recommending any change.');
  /* No marks: the founder's own sentence. */
  const bare = founders({ noMarks: true });
  assert.equal(Array.from(bare.a.sessionInterpretation(bare.dd).evidence)[1],
    'The warm-up and cool-down were logged, but there is not enough objective information to verify the quality of each hill effort.');
  /* Stages never typed are not said to have been logged. */
  const noStages = founders({ noStages: true, noMarks: true });
  assert.equal(Array.from(noStages.a.sessionInterpretation(noStages.dd).evidence)[1],
    'There is not enough objective information to verify the quality of each hill effort.');
  /* An effort above the band is said to be above it. */
  bare.a.handleLogAnswer(bare.dd.id, 'rpe', '10');
  assert.match(Array.from(bare.a.sessionInterpretation(bare.dd).what)[1], /^Your overall effort was 10\/10, above the 7–9 this session asks for/);
});

test('the card shows the interpretation, not the distance-only line', () => {
  const { a, dd } = founders();
  a.analysisOpenFor[dd.id] = true;
  const html = a.renderExecutionReview(dd), said = text(html);
  const it = a.sessionInterpretation(dd);
  [it.head].concat(Array.from(it.what), Array.from(it.evidence), [it.coaching]).forEach(line =>
    assert.ok(said.indexOf(line) !== -1, 'the card does not say: ' + line));
  assert.ok(said.indexOf(it.head) < said.indexOf(Array.from(it.what)[0]) &&
            said.indexOf(Array.from(it.what)[0]) < said.indexOf(Array.from(it.evidence)[0]) &&
            said.indexOf(Array.from(it.evidence)[0]) < said.indexOf('Coaching interpretation') &&
            said.indexOf('Coaching interpretation') < said.indexOf(it.coaching), 'the card is not in order');
  assert.doesNotMatch(said, /Distance is all that was recorded|Add an average pace|as prescribed/);
  assert.doesNotMatch(said, /\d+\s*\/\s*100|AI Analysis/, 'a figure or an "AI" label is on an unscored review');
  /* The tab is lit: there is something to open. */
  assert.doesNotMatch(html, /class="sess-tab sess-tab-btn is-quiet"/);
  /* A distance and nothing else keeps the line that is true of it, and a quiet tab. */
  const bare = founders({ distanceOnly: true });
  bare.a.analysisOpenFor[bare.dd.id] = true;
  const bh = bare.a.renderExecutionReview(bare.dd);
  assert.match(text(bh), /Distance is all that was recorded/);
  assert.match(bh, /class="sess-tab sess-tab-btn is-quiet"/);
  /* And a scored session keeps the review it always had. */
  const scored = hillDay();
  logAsPrescribed(scored.a, scored.dd, { quality: 1 });
  scored.a.analysisOpenFor[scored.dd.id] = true;
  assert.doesNotMatch(text(scored.a.renderExecutionReview(scored.dd)), /Coaching interpretation/);
});

test('each reason for stopping is read for what it is', () => {
  const said = stop => { const f = founders({ stop, noMarks: true }); return { it: f.a.sessionInterpretation(f.dd), r: f.dd.coachReview, a: f.a, dd: f.dd }; };
  const time = said('time');
  assert.equal(Array.from(time.it.what)[0], 'You completed 3 of 5 prescribed hill efforts, stopping because you ran out of time.');
  assert.equal(time.it.coaching, 'Stopping for that reason says nothing about your fitness. It is counted as partly done and nothing more.');
  assert.notEqual(time.r.trainingSignal, 'monitor_fatigue', 'running out of time was read as fatigue');
  assert.notEqual(time.r.trainingSignal, 'recovery_priority');
  const ill = said('illness');
  assert.equal(Array.from(ill.it.what)[0], 'You completed 3 of 5 prescribed hill efforts, stopping because of illness.');
  assert.match(ill.it.coaching, /^Illness stopped this session\./);
  assert.equal(ill.r.trainingSignal, 'recovery_priority');
  /* The proposal rule is the one scored sessions already have: recovery first, before a quality session only. */
  const nxt = ill.a.coachSessionAfter(ill.dd);
  const nextIsQuality = !!nxt && !ill.a.isRecoveryWorkoutType(nxt.type) && nxt.type !== 'rest';
  assert.equal(ill.r.recommendPlanAdjustment, nextIsQuality);
  assert.match(fnBody('coachReportedReview'), /var propose = \(sig\.signal === 'recovery_priority'\) && nextIsQuality;/);
  const inj = said('injury');
  assert.match(inj.it.coaching, /^You stopped for an injury or soreness\./);
  assert.equal(inj.r.trainingSignal, 'recovery_priority');
  /* No reason given: none is invented, and the athlete is asked. */
  const none = said(null);
  assert.equal(Array.from(none.it.what)[0], 'You completed 3 of 5 prescribed hill efforts.');
  assert.equal(none.it.coaching, 'Say why you stopped and SACORO can read this properly.');
});

test('a set finished in full is read from its marks, and said to be the athlete\'s own account', () => {
  const { a, dd } = founders({ reps: 5, stop: null });
  /* Five efforts, three marked: on target, too hard, on target. */
  const it = a.sessionInterpretation(dd);
  assert.equal(it.head, 'Session completed.');
  assert.equal(Array.from(it.what)[0], 'You completed all 5 prescribed hill efforts.');
  assert.doesNotMatch(Array.from(it.evidence).join(' '), /main set was incomplete/);
  assert.match(Array.from(it.evidence).join(' '), /their quality rests on your own marks: 2 on target, 1 too hard\./);
  assert.equal(a.assessSession(dd).execution.level, 'mixed');
  /* Two of three on target and a reported fade: the fade is what is said,
     as the athlete's account of one session. */
  assert.equal(it.coaching, 'By your own account the set faded. One session, on your report alone: worth watching rather than acting on.');
  /* Fewer than half the marked efforts on target is said too. */
  a.handleLogMark(dd.id, '1'); a.handleLogMark(dd.id, '3'); a.handleLogMark(dd.id, '3');      // too easy, too hard, too hard
  assert.deepEqual(Array.from(dd.actual.repMarks).slice(0, 3), ['under', 'over', 'over']);
  assert.equal(a.sessionInterpretation(dd).coaching, 'By your own account the set fell short of target and faded. One session, on your report alone: worth watching rather than acting on.');
  a.handleLogAnswer(dd.id, 'mainSetHeld', '3');
  assert.equal(a.sessionInterpretation(dd).coaching, 'By your own account the set fell short of target. One session, on your report alone: worth watching rather than acting on.');
  /* REPS THAT WERE TIMED ARE MEASURED, AND SAID TO BE. With no overall pace
     the session still has no score, but it is not the athlete's account
     alone and is not described as one. */
  const timed = (() => {
    const t = app('2026-12-20');
    const d = t.state.days.filter(x => x.type !== 'rest' && t.logShape(x).reps && !t.logShape(x).hills && !t.logShape(x).light)[0];
    d.completed = true; d.actual = t.emptyActual();
    t.handleActualFieldChange(d.id, 'km', String(d.km));
    Array.from(t.loggingModeFor(d).plan.rows).filter(r => r.role === 'work')
      .forEach(r => t.handleStructuredSplitChange(d.id, r.segId, 'pace', '4:30'));
    t.handleLogAnswer(d.id, 'mainSetHeld', '5');
    t.handleLogMark(d.id, '1'); t.handleLogMark(d.id, '1');       // and a rep marked too easy as well
    return { t, d };
  })();
  assert.equal(timed.t.computeExecutionBreakdown(timed.d), null, 'the fixture scored, so it is not this case');
  assert.equal(timed.t.assessSession(timed.d).execution.basis, 'sections');
  const ti = timed.t.sessionInterpretation(timed.d);
  assert.match(Array.from(ti.evidence).join(' '), /Your reps were timed, so their pace is on record\. Add an average pace for the whole session and it is scored\./);
  assert.doesNotMatch(Array.from(ti.evidence).join(' '), /not enough objective information|your own marks/);
  assert.equal(ti.coaching, '', 'a measured set was called the athlete\'s own account');
  /* Every effort on target: nothing to interpret, and the engine's next move is what is said. */
  const clean = founders({ reps: 5, stop: null, noMarks: true });
  for (let i = 1; i <= 5; i++) clean.a.handleLogMark(clean.dd.id, String(i));
  clean.a.handleLogAnswer(clean.dd.id, 'mainSetHeld', '3');
  clean.a.coachPersistReview(clean.dd);
  assert.equal(clean.a.sessionInterpretation(clean.dd).coaching, '');
  assert.ok(clean.dd.coachReview.nextMove, 'a clean session has no next move');
  assert.doesNotMatch(text(clean.a.renderExecutionReview(clean.dd)), /Coaching interpretation/);
});

// ---------------------------------------------------------------------------
// 3. RECOVERY
// ---------------------------------------------------------------------------

test('a session stopped for fatigue is one point of Recovery: Watch, and never Strained by itself', () => {
  const before = founders({ distanceOnly: true });
  assert.equal(before.a.coachRecovery().state, 'fresh');
  assert.equal(before.a.coachRecovery().stoppedTired, 0);
  const { a, dd } = founders();
  let rec = a.coachRecovery();
  assert.equal(rec.overRPE, 0, 'the fixture is strained some other way');
  assert.equal(rec.overHR, 0);
  assert.equal(rec.stoppedTired, 1);
  assert.equal(rec.trainingState, 'watch');
  assert.equal(rec.state, 'watch');
  /* Said as what was seen. */
  assert.equal(a.recoveryWatchSentence(rec, true), 'You stopped a session short for fatigue this week. Do not force the pace if the effort starts climbing.');
  assert.equal(a.recoveryWatchSentence(rec, false), 'You stopped a session short for fatigue this week. Worth knowing rather than worth worrying about.');
  assert.equal(a.recoveryStrainSentence(rec), 'You stopped a session short for fatigue.');
  /* The decision knows why, at the weight heavy legs carries and as the same concept. */
  const dec = a.coachDecision();
  assert.ok(Array.from(dec.reasons).indexOf('You stopped a session short for fatigue this week') !== -1, 'the decision does not know');
  assert.match(fnBody('coachDecision'), /if \(recovery\.stoppedTired > 0\) add\(EVIDENCE_CONCEPT\.feel, 2, 'You stopped a session short for fatigue this week'\);/);
  assert.match(fnBody('coachDecision'), /if \(ready && ready\.legs === 'heavy'\) add\(EVIDENCE_CONCEPT\.feel, 2, /);
  assert.notEqual(dec.state, 'reduce'); assert.notEqual(dec.state, 'recover');
  /* A second one in the same week is still one point. */
  const other = a.state.days.filter(d => d.type === 'easy' && d.date > dd.date && d.date <= a.todayStr())[0];
  assert.ok(other, 'the fixture has no easy run in the same week');
  other.completed = true; other.actual = a.emptyActual();
  other.actual.km = +(other.km * 0.5).toFixed(2); other.actual.stopReason = 'fatigue';
  assert.equal(a.sessionCutShortFor(other), 'fatigue');
  rec = a.coachRecovery();
  assert.equal(rec.stoppedTired, 2);
  assert.equal(rec.trainingState, 'watch', 'two tired sessions reached Strained without any other evidence');
  /* And a third. Three points is Strained, so this is the case that tells
     "one point however many" from "a point each". */
  const third = a.state.days.filter(d => d.date === a.addDays(dd.date, -1))[0];
  third.type = 'easy'; third.km = 5; third.title = 'Easy Aerobic'; third.completed = true;
  third.actual = a.emptyActual(); third.actual.km = 2.5; third.actual.stopReason = 'fatigue';
  assert.equal(a.sessionCutShortFor(third), 'fatigue');
  rec = a.coachRecovery();
  assert.equal(rec.stoppedTired, 3);
  assert.equal(rec.hardStreak < 3, true, 'the fixture is strained by a streak');
  assert.equal(rec.trainingState, 'watch', 'tired sessions alone reached Strained');
});

test('only fatigue counts, and only on a session that was actually cut short', () => {
  ['time', 'rest', 'other'].forEach(stop => {
    const f = founders({ stop });
    assert.equal(f.a.sessionCutShortFor(f.dd), stop);
    assert.equal(f.a.coachRecovery().stoppedTired, 0, stop + ' was counted as fatigue');
    assert.equal(f.a.coachRecovery().state, 'fresh');
  });
  /* Finished in full: there is no stop to have a reason. */
  const full = founders({ reps: 5, stop: null });
  assert.equal(full.a.sessionCutShortFor(full.dd), null);
  full.dd.actual.stopReason = 'fatigue';
  assert.equal(full.a.sessionCutShortFor(full.dd), null, 'a reason left on a finished session was read as a stop');
  assert.equal(full.a.coachRecovery().stoppedTired, 0);
  /* A rest day and an unlogged day say nothing. */
  assert.equal(full.a.sessionCutShortFor({ type: 'rest', completed: true, actual: {} }), null);
  assert.equal(full.a.sessionCutShortFor({ type: 'easy', completed: false }), null);
});
