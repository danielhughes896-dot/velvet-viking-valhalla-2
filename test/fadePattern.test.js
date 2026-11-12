'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE SET THAT KEEPS NOT HOLDING.

   Founder: "Track recovery and effort fade across comparable quality
   sessions, allowing repeated patterns to inform coaching and Recovery."

   And, in the same message: "Keep subjective rep marks at low confidence
   without changing measured fitness or performance confidence."

   "Did your pace hold?" and "Recoveries" were answered on the log and went
   no further than the card. Once is a session; three of the last four
   comparable sessions is a pattern. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const fnBody = name => { const at = SRC.indexOf('\nfunction ' + name + '('); assert.ok(at !== -1, name + ' is gone'); return SRC.slice(at, SRC.indexOf('\n}\n', at)); };
const code = name => fnBody(name).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const PIN = '2026-10-21';

/* A 12-week 10k block, six weeks in, every session logged as prescribed.
   One quality day a week: reps and a sustained set, turn about. */
function app(pin, before){
  const a = loadApp({ pinnedDate: (pin || PIN) + 'T07:00:00Z' });
  ['renderApp', 'showToast', 'flushSave', 'scheduleSave', 'replaceCard', 'patchDerivedStats', 'patchExecutionUI', 'patchSplitsTotal']
    .forEach(f => { a[f] = () => {}; });
  buildPlan(a, { distanceKey: '10k', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-09-07', healthConsent: true });
  /* `before`: it is the morning of `pin`, and today's session is still to run. */
  a.state.days.filter(d => (before ? d.date < pin : d.date <= (pin || PIN)) && d.type !== 'rest')
    .forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  return a;
}
/* The morning of the next quality session after the fixture's last rep day. */
let NEXT_QUALITY = null;
function qualityMorning(){
  if (!NEXT_QUALITY){
    const probe = app();
    NEXT_QUALITY = probe.state.days.filter(d => d.date > PIN && d.type !== 'rest' && probe.fadeFamilyOf(d) && d.type !== 'checkpoint')
      .sort((x, y) => (x.date < y.date ? -1 : 1))[0].date;
  }
  return NEXT_QUALITY;
}
const family = (a, f) => a.state.days.filter(d => d.completed && a.fadeFamilyOf(d) === f && d.type !== 'checkpoint')
  .sort((x, y) => (x.date < y.date ? -1 : 1));
const held = (a, d, v) => a.handleLogAnswer(d.id, 'mainSetHeld', String(v));
const pats = a => JSON.parse(JSON.stringify(Array.from(a.qualityFadePatterns())));
/* The last four rep sessions, the last `n` of them answered "Faded". */
function fading(n, pin, before){
  const a = app(pin, before);
  const reps = family(a, 'reps').slice(-4);
  assert.equal(reps.length, 4, 'the fixture has fewer than four rep sessions');
  reps.forEach((d, i) => held(a, d, i >= 4 - n ? 5 : 3));
  return { a, reps };
}

test('the fixture: comparable sessions come round once a fortnight, which is why the window is ten weeks', () => {
  const a = app();
  const reps = family(a, 'reps'), sus = family(a, 'sustained');
  assert.equal(reps.length, 4); assert.ok(sus.length >= 2);
  assert.ok(reps[0].date < a.addDays(PIN, -41), 'four rep sessions fit in six weeks, so the window need not be ten');
  assert.ok(reps[0].date >= a.addDays(PIN, -(a.FADE_CAL.windowDays - 1)), 'four rep sessions do not fit in the window');
  assert.equal(a.FADE_CAL.windowDays, 70); assert.equal(a.FADE_CAL.recent, 4);
});

test('once is a session; two of four is emerging; three of four is established', () => {
  assert.deepEqual(pats(fading(0).a), []);
  assert.deepEqual(pats(fading(1).a), [], 'one faded set was called a pattern');
  const two = fading(2);
  assert.deepEqual(pats(two.a).map(p => [p.kind, p.family, p.hits, p.of, p.confidence]), [['fade', 'reps', 2, 4, 'emerging']]);
  const three = fading(3);
  const p = pats(three.a)[0];
  assert.deepEqual([p.kind, p.family, p.hits, p.of, p.confidence, p.measured], ['fade', 'reps', 3, 4, 'established', 0]);
  assert.equal(p.lastDate, three.reps[3].date);
  assert.deepEqual(p.dates, Array.from(three.reps.slice(1), d => d.date));
  assert.equal(three.a.fadePatternSentence(p), 'The main set has faded in 3 of your last 4 rep sessions.');
  /* "Slight fade" is a fade; "Even" and "Got faster" are not. */
  const slight = app(); family(slight, 'reps').slice(-4).forEach((d, i) => held(slight, d, i >= 1 ? 4 : 2));
  assert.equal(pats(slight)[0].confidence, 'established');
  /* It takes four that were answered: three faded sets out of three says nothing yet. */
  const three3 = app(); family(three3, 'reps').slice(-3).forEach(d => held(three3, d, 5));
  assert.deepEqual(pats(three3), [], 'a pattern was claimed on three sessions');
});

test('comparable means the same kind of set', () => {
  const a = app();
  const reps = family(a, 'reps'), sus = family(a, 'sustained');
  /* Every sustained session faded, and one rep session: no rep pattern. */
  sus.forEach(d => held(a, d, 5));
  reps.slice(-4).forEach((d, i) => held(a, d, i === 3 ? 5 : 3));
  assert.deepEqual(pats(a).filter(p => p.family === 'reps'), [], 'a tempo that faded was counted against the reps');
  /* Reps and hills are the same kind; an easy run with strides is neither. */
  const hills = a.state.days.filter(d => a.logShape(d).hills)[0];
  assert.equal(a.fadeFamilyOf(hills), 'reps');
  const easy = a.state.days.filter(d => d.type === 'easy')[0];
  assert.equal(a.fadeFamilyOf(easy), null);
  /* An easy run with strides: asked through the shape itself, so the law
     does not depend on the fixture's plan happening to hold one. */
  const real = a.logShape;
  a.logShape = () => ({ family: 'reps', reps: 6, main: false, hills: false, light: true });
  assert.equal(a.fadeFamilyOf(easy), null, 'strides were read as a quality set');
  a.logShape = () => ({ family: 'reps', reps: 6, main: true, hills: false, light: false });
  assert.equal(a.fadeFamilyOf(easy), 'reps');
  a.logShape = () => ({ family: 'sustained', reps: 0, main: true, hills: false, light: false });
  assert.equal(a.fadeFamilyOf(easy), 'sustained');
  a.logShape = real;
  /* A time trial is run to the limit on purpose: its fade is the session going to plan. */
  const tt = a.state.days.filter(d => d.type === 'checkpoint' && d.completed)[0];
  assert.ok(tt, 'the fixture has no checkpoint');
  held(a, tt, 5);
  assert.equal(a.sessionFadeReading(tt), null);
});

test('recoveries that keep lengthening are the same kind of pattern', () => {
  const a = app();
  const reps = family(a, 'reps').slice(-4);
  reps.forEach((d, i) => a.handleLogPick(d.id, 'recoveries', i >= 1 ? 'longer' : 'as-set'));
  const p = pats(a);
  assert.deepEqual(p.map(x => [x.kind, x.family, x.hits, x.of, x.confidence]), [['recoveries', 'reps', 3, 4, 'established']]);
  assert.equal(a.fadePatternSentence(p[0]), 'You have needed longer recoveries in 3 of your last 4 rep sessions.');
  /* Shorter recoveries are not a warning. */
  const b = app();
  family(b, 'reps').slice(-4).forEach(d => b.handleLogPick(d.id, 'recoveries', 'shorter'));
  assert.deepEqual(pats(b), []);
});

test('what is measured outranks what was reported, and the rep tiles are not read at all', () => {
  const a = app();
  const reps = family(a, 'reps').slice(-4);
  const paced = (d, paces) => Array.from(a.loggingModeFor(d).plan.rows).filter(r => r.role === 'work')
    .forEach((r, i) => a.handleStructuredSplitChange(d.id, r.segId, 'pace', paces[Math.min(i, paces.length - 1)]));
  /* Reps timed even, athlete says faded: the stopwatch is believed. */
  paced(reps[3], ['4:00']); held(a, reps[3], 5);
  assert.deepEqual([a.sessionFadeReading(reps[3]).faded, a.sessionFadeReading(reps[3]).basis], [false, 'measured']);
  /* Reps timed fading, athlete says even: likewise. */
  paced(reps[2], ['4:00', '4:02', '4:05', '4:08', '4:10']); held(a, reps[2], 3);
  assert.deepEqual([a.sessionFadeReading(reps[2]).faded, a.sessionFadeReading(reps[2]).basis], [true, 'measured']);
  assert.equal(a.structuredRepFadePct(reps[2]) >= a.FADE_CAL.measuredFadePct, true);
  /* Under the threshold is not a fade. */
  paced(reps[1], ['4:00', '4:01', '4:02', '4:03', '4:04']);
  assert.ok(a.structuredRepFadePct(reps[1]) > 0 && a.structuredRepFadePct(reps[1]) < a.FADE_CAL.measuredFadePct, 'the fixture is not a small drift');
  assert.equal(a.sessionFadeReading(reps[1]).faded, false);
  /* THE TILES. Every rep of four sessions marked "Too hard", then "Slower"
     on the last ones: no pattern, because a pattern is not built on them. */
  const b = app();
  family(b, 'reps').slice(-4).forEach(d => { const n = b.logShape(d).reps;
    for (let i = 1; i <= n; i++){ b.handleLogMark(d.id, String(i)); if (i > n / 2) b.handleLogMark(d.id, String(i)); } });
  assert.ok(family(b, 'reps').slice(-4).every(d => b.logRepMarkSummary(d).marked > 0), 'the fixture marked nothing');
  assert.deepEqual(pats(b), [], 'a pattern was built on the rep tiles');
  ['sessionFadeReading', 'qualityFadePatterns'].forEach(f =>
    assert.ok(!/repMarks|logRepMark|assessSession|assessExecution|\.score\b/.test(code(f)), f + ' reads the tiles or the unreviewed assessment'));
});

test('a set that faded for the day\'s own reasons is left out', () => {
  const ill = fading(3);
  ill.reps[3].actual.notes = 'felt ill, full of cold';
  assert.equal(ill.a.sessionFadeReading(ill.reps[3]), null);
  assert.deepEqual(pats(ill.a).map(p => p.confidence), [], 'a session run through illness made the pattern');
  const hot = fading(3);
  hot.reps[3].actual.tempC = 34; hot.reps[3].actual.humidity = 80;
  assert.equal(hot.a.effortIsReadable(hot.reps[3]), false, 'the fixture is not hot enough to matter');
  assert.equal(hot.a.sessionFadeReading(hot.reps[3]), null);
});

test('a pattern goes stale: its latest instance has to be recent', () => {
  /* The first three of four faded and the latest held: an established
     pattern whose last instance is a fortnight old. */
  const a = app();
  const reps = family(a, 'reps').slice(-4);
  reps.forEach((d, i) => held(a, d, i <= 2 ? 5 : 3));
  const last = reps[2].date;
  assert.deepEqual(pats(a).map(p => [p.hits, p.of, p.confidence, p.lastDate]), [[3, 4, 'established', last]]);
  const at = n => Array.from(a.qualityFadePatterns(a.addDays(last, n))).length;
  assert.equal(at(a.FADE_CAL.staleDays), 1);
  assert.equal(at(a.FADE_CAL.staleDays + 1), 0, 'a pattern a month old is still stated');
  /* All four sessions are still inside the window on that day: it is the
     staleness that drops it, not the window. */
  assert.ok(reps[0].date >= a.addDays(a.addDays(last, a.FADE_CAL.staleDays + 1), -(a.FADE_CAL.windowDays - 1)), 'the fixture tests the window, not the staleness');
});

// ---------------------------------------------------------------------------
// WHERE IT GOES
// ---------------------------------------------------------------------------

test('it is a trend like any other: its own concept, the dates behind it, and Patterns\' vocabulary', () => {
  const { a, reps } = fading(3);
  const t = Array.from(a.athleteTrends()).filter(x => x.id === 'set_fading_reps')[0];
  assert.ok(t, 'the pattern is not a trend');
  assert.deepEqual([t.area, t.direction, t.confidence, t.concept, t.headline], ['Recovery', 'negative', 'established', 'fade', 'Watching']);
  assert.equal(t.detail, 'The main set has faded in 3 of your last 4 rep sessions.');
  assert.deepEqual(Array.from(t.evidenceDates), Array.from(reps.slice(1), d => d.date));
  assert.equal(a.EVIDENCE_CONCEPT.fade, 'fade');
  /* Emerging is a trend too; nothing is not. */
  assert.equal(Array.from(fading(2).a.athleteTrends()).filter(x => x.id === 'set_fading_reps')[0].confidence, 'emerging');
  assert.equal(Array.from(fading(1).a.athleteTrends()).filter(x => /fading|lengthening/.test(x.id)).length, 0);
  const rec = app(); family(rec, 'reps').slice(-4).forEach((d, i) => rec.handleLogPick(d.id, 'recoveries', i >= 1 ? 'longer' : 'as-set'));
  assert.equal(Array.from(rec.athleteTrends()).filter(x => x.id === 'recoveries_lengthening_reps')[0].concept, 'fade');
});

test('an established pattern is one point of Recovery: Watch, never Strained by itself, and an emerging one moves nothing', () => {
  const none = fading(1).a.coachRecovery();
  assert.equal(none.state, 'fresh'); assert.equal(none.fading, null);
  const two = fading(2).a.coachRecovery();
  assert.equal(two.state, 'fresh', 'an emerging pattern moved Recovery'); assert.equal(two.fading, null);
  const { a } = fading(3);
  const rec = a.coachRecovery();
  assert.equal(rec.overRPE + rec.overHR + rec.stoppedTired, 0, 'the fixture is strained some other way');
  assert.equal(rec.fading.kind, 'fade'); assert.equal(rec.fading.confidence, 'established');
  assert.equal(rec.trainingState, 'watch');
  assert.equal(a.recoveryWatchSentence(rec, true), 'The main set has faded in 3 of your last 4 rep sessions. Do not force the pace if the effort starts climbing.');
  assert.equal(a.recoveryStrainSentence(rec), 'The main set has faded in 3 of your last 4 rep sessions.');
  /* Its latest instance has to be inside the week Recovery reads. */
  const later = fading(3, '2026-10-21');
  const todayWas = later.a.todayStr;
  later.a.todayStr = () => later.a.addDays(PIN, 8);
  assert.equal(later.a.coachRecovery().fading, null, 'a fade from last week strained this one');
  later.a.todayStr = todayWas;
});

test('a fade pattern and a fatigue stop are one fact: one point of Recovery and one vote in the decision', () => {
  const { a, reps } = fading(3);
  const before = a.coachDecision();
  assert.equal(before.rawScore, 2);
  assert.deepEqual(Array.from(before.reasons), ['The main set has faded in 3 of your last 4 rep sessions.']);
  /* The latest of them is also stopped for fatigue. */
  const last = reps[3];
  a.handleLogAnswer(last.id, 'repsDone', String(Math.max(1, a.logShape(last).reps - 3)));
  a.handleLogPick(last.id, 'stopReason', 'fatigue');
  const rec = a.coachRecovery();
  assert.equal(rec.stoppedTired, 1); assert.ok(rec.fading);
  assert.equal(rec.trainingState, 'watch', 'the same sessions were counted twice in Recovery');
  assert.equal(a.recoveryWatchSentence(rec, true), 'You stopped a session short for fatigue this week. Do not force the pace if the effort starts climbing.');
  /* Told apart from "a point each" by a third signal: with effort above
     its band on that session too, one point for the sets makes two, and a
     point each would make three -- which is Strained. */
  a.handleLogAnswer(last.id, 'rpe', '10');
  const three = a.coachRecovery();
  assert.equal(three.overRPE, 1, 'the fixture\'s effort is not above its band');
  assert.equal(three.trainingState, 'watch', 'the pattern and the stop were a point each');
  a.handleLogAnswer(last.id, 'rpe', String(Math.round(a.expectedRPEBand(last)[1])));
  const dec = a.coachDecision();
  assert.equal(dec.rawScore, 2, 'the pattern and the stop each got a vote');
  assert.deepEqual(Array.from(dec.reasons), ['You stopped a session short for fatigue this week']);
  assert.match(fnBody('coachDecision'), /if \(CONCEPT_OF_TREND\[t\.id\] === EVIDENCE_CONCEPT\.fade && recovery\.stoppedTired > 0\) return;/);
});

test('it corroborates a different fact, and one session alone never proposes a change', () => {
  /* The morning of the next quality session. Heavy legs is the athlete's
     feel; the pattern is the sets. Two facts. */
  const pin = qualityMorning();
  const { a } = fading(3, pin, true);
  assert.equal(pats(a).length, 1, 'the pattern did not survive to the next quality morning');
  const alone = a.coachDecision();
  assert.equal(alone.quality, true, 'the fixture is not the morning of a quality session');
  assert.equal(alone.rawScore, 2);
  assert.equal(alone.state, 'check', 'the pattern alone did more than ask for a check');
  a.handleSetReadiness('legs', 'heavy');
  const dec = a.coachDecision();
  assert.equal(dec.rawScore, 4);
  assert.equal(dec.state, 'modify', 'two independent facts before a quality session did not reach a proposal');
  /* One faded session and heavy legs: exactly what heavy legs alone is. */
  const one = fading(1, pin, true).a; one.handleSetReadiness('legs', 'heavy');
  const legs = app(pin, true); legs.handleSetReadiness('legs', 'heavy');
  assert.equal(one.coachDecision().rawScore, legs.coachDecision().rawScore);
  assert.equal(one.coachDecision().state, legs.coachDecision().state);
  assert.notEqual(one.coachDecision().state, 'modify', 'one faded session produced a proposal');
  /* And Evolution changes nothing on the pattern alone. */
  const ev = fading(3, pin, true).a.planEvolution();
  assert.equal(Array.from(ev.changes || []).length, 0, 'a reported pattern rewrote the plan by itself');
});

test('it changes neither Confidence nor measured fitness, and nor do the rep tiles', () => {
  const base = app();
  const conf = base.computeConfidenceScore(), fit = JSON.stringify(base.measuredPerformances()), vdot = base.raceGoalProjectedVdot(0);
  const same = (a, what) => {
    assert.equal(a.computeConfidenceScore(), conf, what + ' moved Confidence');
    assert.equal(JSON.stringify(a.measuredPerformances()), fit, what + ' changed measured fitness');
    assert.equal(a.raceGoalProjectedVdot(0), vdot, what + ' changed the projection');
  };
  same(fading(3).a, 'an established fade');
  const rec = app(); family(rec, 'reps').slice(-4).forEach(d => rec.handleLogPick(d.id, 'recoveries', 'longer'));
  same(rec, 'lengthening recoveries');
  const tiles = app();
  family(tiles, 'reps').slice(-4).forEach(d => { const n = tiles.logShape(d).reps;
    for (let i = 1; i <= n; i++){ tiles.handleLogMark(d.id, String(i)); tiles.handleLogMark(d.id, String(i)); tiles.handleLogMark(d.id, String(i)); } });
  same(tiles, 'the rep tiles');
  ['computeConfidenceScore', 'measuredPerformances', 'raceGoalProjectedVdot', 'fitnessConfidence'].forEach(f =>
    assert.ok(!/qualityFadePatterns|sessionFadeReading|repMarks|mainSetHeld|recoveries\b/.test(code(f)), f + ' reads the reported answers'));
});

test('Recovery never waits on the session strategy: typing a stage pace returns', () => {
  /* The pattern used to read structuredExecutionEvidence(), which reads the
     execution strategy, which reads the athlete's state, which reads
     Recovery -- and entering one pace on a tempo never came back. */
  ['sessionFadeReading', 'qualityFadePatterns', 'structuredRepFadePct'].forEach(f =>
    assert.ok(!/structuredExecutionEvidence|executionStrategy|coachRecovery|coachDecision|athleteTrends|athleteMemory/.test(code(f)),
      f + ' calls back into something that reads Recovery'));
  assert.match(code('structuredExecutionEvidence'), /var drift = structuredRepFadePct\(dd\);/, 'the session\'s own evidence and the pattern define a rep fade separately');
  const a = app();
  const tempo = family(a, 'sustained').slice(-1)[0];
  const started = Date.now();
  Array.from(a.loggingModeFor(tempo).plan.rows).forEach(r => a.handleStructuredSplitChange(tempo.id, r.segId, 'pace', '5:00'));
  a.coachRecovery(); a.coachDecision();
  assert.ok(Date.now() - started < 20000, 'entering stage paces took ' + (Date.now() - started) + 'ms');
});

test('the Recovery page shows the pattern as a row of its own', () => {
  assert.match(SRC, /\(report\.recovery\.fading \? hqRow\(report\.recovery\.fading\.kind === 'recoveries' \? 'Recoveries lengthening' : 'Main set fading',\n\s*report\.recovery\.fading\.hits\+' of last '\+report\.recovery\.fading\.of\) : ''\)\+/);
});
