'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* YOUR LOG.

   Founder: "SACORO needs to extract the maximum coaching intelligence from
   the minimum athlete effort." And, approving the screen: "Advanced
   breakdown available but not required. No unnecessary symbols, decorative
   cards or additional screens. Most importantly, every answer must have a
   defined downstream purpose. Don't make an athlete answer questions SACORO
   then ignores."

   So this file is two lists. What is asked, of which session, and that
   nothing is answered on the athlete's behalf. And, for every answer, the
   place it lands: a law per answer that fails if the answer is collected and
   then dropped. */

const SRC = fs.readFileSync(path.join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const TODAY = '2026-11-12';

function app(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {};
  a.scheduleSave = () => {}; a.replaceCard = () => {}; a.patchDerivedStats = () => {};
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188,
    startDate: a.addDays(TODAY, -37) }, o.plan || {}));
  return a;
}
/* The most recent past session of a family, logged exactly as prescribed
   and with no effort recorded, so every answer starts unknown. */
function session(a, family){
  const dd = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY &&
    a.logShape(d).family === family).slice(-1)[0];
  assert.ok(dd, 'the fixture has no ' + family + ' session');
  logAsPrescribed(a, dd, { quality: 1 });
  dd.actual.rpe = null;
  return dd;
}
const answers = (a, dd) => a.renderYourLogAnswers(dd);
const asks = (html, field) => html.indexOf('data-field="' + field + '"') !== -1;
const signalIds = (a, actual) => Array.from(a.sessionSignals(actual).signals).map(s => s.id);

// ---------------------------------------------------------------------------
// WHAT IS ASKED, AND OF WHICH SESSION
// ---------------------------------------------------------------------------

test('an interval session is asked about its reps, how it felt, whether the pace held and the recoveries', () => {
  const a = app();
  const dd = session(a, 'reps');
  const html = answers(a, dd);
  ['repsDone', 'mainSetFelt', 'mainSetHeld', 'recoveries', 'rpe', 'conditions', 'hurting'].forEach(f =>
    assert.ok(asks(html, f), 'an interval session is not asked: ' + f));
  assert.match(html, /Main set/, 'the main set is not named');
  assert.match(html, /Did your pace hold\?/);
  const reps = a.logShape(dd).reps;
  assert.ok(reps >= 2, 'the fixture session has no reps to count');
  assert.match(html, new RegExp('data-field="repsDone"[^>]*data-of="' + reps + '"'),
    'the reps slider does not run to the number prescribed');
});

test('a hill session is asked whether the EFFORT held, and is not asked about recoveries', () => {
  const a = app();
  const html = answers(a, session(a, 'hills'));
  assert.match(html, /Did your effort hold\?/, 'hills are still asked about pace');
  assert.ok(!/Did your pace hold\?/.test(html));
  assert.ok(asks(html, 'repsDone'), 'hill reps are not counted');
  assert.ok(!asks(html, 'recoveries'), 'a jog back down a hill was asked about as a timed recovery');
});

test('a sustained session has a main set and no reps to count', () => {
  const a = app();
  const html = answers(a, session(a, 'sustained'));
  assert.ok(asks(html, 'mainSetHeld') && asks(html, 'mainSetFelt'));
  assert.ok(!asks(html, 'repsDone'), 'a continuous effort was asked how many reps it had');
  assert.ok(!asks(html, 'recoveries'));
});

test('an easy run is asked the least: how it felt, the effort, the conditions and whether anything hurts', () => {
  const a = app();
  const html = answers(a, session(a, 'aerobic'));
  assert.match(html, /The Run/, 'an easy run was given a main set');
  assert.ok(!/Main set/.test(html));
  ['repsDone', 'mainSetHeld', 'recoveries', 'stopReason'].forEach(f =>
    assert.ok(!asks(html, f), 'an easy run finished as prescribed was asked: ' + f));
  ['mainSetFelt', 'rpe', 'conditions', 'hurting'].forEach(f =>
    assert.ok(asks(html, f), 'an easy run is not asked: ' + f));
});

test('"Why did you stop?" is asked only of a session that stopped', () => {
  const a = app();
  const dd = session(a, 'reps');
  assert.ok(!asks(answers(a, dd), 'stopReason'), 'a finished session was asked why it stopped');
  a.handleLogAnswer(dd.id, 'repsDone', String(a.logShape(dd).reps - 2));
  assert.ok(asks(answers(a, dd), 'stopReason'), 'two reps short, and nobody asked why');
  const easy = session(a, 'aerobic');
  easy.actual.km = +(easy.km * 0.6).toFixed(2);
  assert.ok(asks(answers(a, easy), 'stopReason'), '60% of an easy run, and nobody asked why');
});

test('a rest day is asked nothing', () => {
  const a = app();
  const rest = a.state.days.filter(d => d.type === 'rest')[0];
  assert.equal(answers(a, rest), '');
});

// ---------------------------------------------------------------------------
// NO DEFAULT ANSWERS
// ---------------------------------------------------------------------------

test('an untouched slider is drawn unanswered and stores nothing', () => {
  /* Founder: "No selection means unknown, not position three." */
  const a = app();
  const dd = session(a, 'reps');
  const before = JSON.stringify(dd.actual);
  const html = answers(a, dd);
  const ranges = html.match(/<input type="range"[^>]*>/g) || [];
  assert.equal(ranges.length, 4, 'reps, felt, held and effort are the four sliders');
  ranges.forEach(r => {
    assert.match(r, /class="yl-range is-unset"/, 'an untouched slider looks answered: ' + r);
    assert.match(r, /aria-valuetext="Not answered"/, 'a screen reader is told an answer nobody gave');
  });
  assert.ok(!/aria-pressed="true"/.test(html), 'a tile is pressed before anyone pressed it');
  assert.ok(!/data-action="log-clear"/.test(html), 'there is something to clear before anything is answered');
  assert.match(html, /Slide to answer/);
  assert.equal(JSON.stringify(dd.actual), before, 'drawing the questions wrote an answer');
  ['repsDone', 'mainSetFelt', 'mainSetHeld', 'recoveries', 'conditions', 'hurting', 'stopReason', 'watchDataOff']
    .forEach(f => assert.equal(dd.actual[f], undefined, f + ' holds a value nobody gave'));
  assert.equal(dd.actual.feel == null, true, 'feel was defaulted');
});

test('every slider answer can be cleared back to unknown', () => {
  const a = app();
  const dd = session(a, 'reps');
  a.handleLogAnswer(dd.id, 'rpe', '7');
  a.handleLogAnswer(dd.id, 'mainSetFelt', '4');
  a.handleLogAnswer(dd.id, 'mainSetHeld', '5');
  a.handleLogAnswer(dd.id, 'repsDone', '3');
  assert.equal((answers(a, dd).match(/data-action="log-clear"/g) || []).length, 4,
    'an answered slider offers no way back');
  ['rpe', 'mainSetFelt', 'mainSetHeld', 'repsDone'].forEach(f => a.handleLogClear(dd.id, f));
  assert.equal(dd.actual.rpe, null);
  assert.equal(dd.actual.feel, null, 'clearing how it felt left the old feel behind');
  ['mainSetFelt', 'mainSetHeld', 'repsDone'].forEach(f =>
    assert.equal(dd.actual[f], undefined, f + ' survived being cleared'));
  assert.ok(!/data-action="log-clear"/.test(answers(a, dd)));
});

test('a tile pressed twice is unpressed, and a value that was never offered is refused', () => {
  const a = app();
  const dd = session(a, 'reps');
  a.handleLogPick(dd.id, 'conditions', 'hot');
  a.handleLogPick(dd.id, 'conditions', 'windy');
  assert.deepEqual(Array.from(dd.actual.conditions), ['hot', 'windy']);
  a.handleLogPick(dd.id, 'conditions', 'hot');
  a.handleLogPick(dd.id, 'conditions', 'windy');
  assert.equal(dd.actual.conditions, undefined, 'an emptied answer left an empty list behind');
  a.handleLogPick(dd.id, 'recoveries', 'longer');
  a.handleLogPick(dd.id, 'recoveries', 'longer');
  assert.equal(dd.actual.recoveries, undefined);
  a.handleLogPick(dd.id, 'hurting', 'pain');
  a.handleLogPick(dd.id, 'hurting', 'pain');
  assert.equal(dd.actual.hurting, undefined);
  a.handleLogPick(dd.id, 'conditions', 'snowing');
  a.handleLogPick(dd.id, 'hurting', 'agony');
  a.handleLogPick(dd.id, 'recoveries', 'none');
  a.handleLogPick(dd.id, 'stopReason', 'bored');
  a.handleLogAnswer(dd.id, 'rpe', '11');
  a.handleLogAnswer(dd.id, 'rpe', '0');
  a.handleLogAnswer(dd.id, 'mainSetFelt', '6');
  a.handleLogAnswer(dd.id, 'repsDone', String(a.logShape(dd).reps + 1));
  a.handleLogAnswer(dd.id, 'somethingElse', '3');
  ['conditions', 'hurting', 'recoveries', 'stopReason', 'mainSetFelt', 'repsDone', 'somethingElse']
    .forEach(f => assert.equal(dd.actual[f], undefined, 'a value never offered was stored in ' + f));
  assert.equal(dd.actual.rpe, null);
});

// ---------------------------------------------------------------------------
// EVERY ANSWER HAS SOMEWHERE TO GO
// ---------------------------------------------------------------------------

test('overall effort is the effort reading the coaching already used', () => {
  const a = app();
  const dd = session(a, 'aerobic');
  const before = a.coachRecovery().overRPE;
  assert.notEqual(a.assessSession(dd).response.reading, 'harder');
  a.handleLogAnswer(dd.id, 'rpe', '9');
  assert.equal(dd.actual.rpe, 9, 'the slider does not write the effort the engine reads');
  assert.equal(a.coachRecovery().overRPE, before + 1,
    'an easy run answered 9 out of 10 is not counted by Recovery as effort above its band');
  assert.equal(a.assessSession(dd).response.reading, 'harder', 'the effort answer never reaches the response reading');
});

test('how it felt takes over every job the Feel buttons had', () => {
  /* Founder: "Read the new scale and retire the old." */
  const a = app();
  const dd = session(a, 'aerobic');
  const want = { 1: 'very_good', 2: 'good', 3: 'normal', 4: 'heavy', 5: 'poor' };
  Object.keys(want).forEach(n => {
    a.handleLogAnswer(dd.id, 'mainSetFelt', n);
    assert.equal(dd.actual.mainSetFelt, +n);
    assert.equal(dd.actual.feel, want[n], 'position ' + n + ' does not write the feel the engine reads');
    assert.ok(a.FEEL_META[dd.actual.feel], 'it wrote a feel the engine has no meaning for');
  });
  a.logOpenFor[dd.id] = true;
  const html = a.renderCompletedPanel(dd, '');
  assert.equal((html.match(/data-field="mainSetFelt"/g) || []).filter(Boolean).length >= 1, true, 'how it felt is not asked');
  assert.ok(!/data-action="set-feel"/.test(html) && !/feel-btn/.test(html), 'feel is asked twice');
});

test('without health consent, how it felt, pain and stopping for illness or injury are neither asked nor stored', () => {
  const a = app({ plan: { healthConsent: false } });
  assert.equal(a.healthConsentGranted(), false, 'the fixture granted consent');
  const dd = session(a, 'reps');
  a.handleLogAnswer(dd.id, 'repsDone', '2');
  const html = answers(a, dd);
  assert.ok(!asks(html, 'mainSetFelt') && !asks(html, 'hurting'), 'health was asked about without consent');
  assert.ok(!/data-value="illness"|data-value="injury"/.test(html), 'illness or injury was offered as a reason');
  assert.match(html, /data-value="fatigue"/);
  assert.match(html, /data-value="time"/);
  a.handleLogAnswer(dd.id, 'mainSetFelt', '5');
  a.handleLogPick(dd.id, 'hurting', 'pain');
  a.handleLogPick(dd.id, 'stopReason', 'illness');
  assert.equal(dd.actual.mainSetFelt, undefined);
  assert.equal(dd.actual.feel == null, true);
  assert.equal(dd.actual.hurting, undefined);
  assert.equal(dd.actual.stopReason, undefined);
  /* And an answer stored while consent stood says nothing once it is gone. */
  assert.deepEqual(signalIds(a, { hurting: 'pain', stopReason: 'illness' }), []);
  /* Ordinary training data is untouched by any of that. */
  ['rpe', 'repsDone', 'mainSetHeld', 'recoveries', 'conditions'].forEach(f =>
    assert.ok(asks(html, f), f + ' was gated on health consent'));
});

test('a tapped condition is the same evidence as the same thing written in the notes', () => {
  const a = app();
  const dd = session(a, 'aerobic');
  const env = extra => a.coachEnvironment(extra.notes || '', Object.assign({}, dd.actual, extra));
  const pick = e => ({ heat: e.heatBand, humid: e.humidBand, treadmill: e.treadmill, severe: e.severe });
  assert.equal(env({}).heatBand, 'none');
  assert.deepEqual(pick(env({ conditions: ['hot'] })), pick(env({ notes: 'It was hot.' })),
    'a tapped Hot and a written "hot" are read differently');
  assert.notEqual(env({ conditions: ['hot'] }).heatBand, 'none', 'Hot changes nothing');
  assert.deepEqual(pick(env({ conditions: ['humid'] })), pick(env({ notes: 'Very humid.' })));
  assert.notEqual(env({ conditions: ['humid'] }).heatBand, 'none', 'Humid changes nothing');
  assert.equal(env({ conditions: ['treadmill'] }).treadmill, true, 'Treadmill changes nothing');
  assert.deepEqual(signalIds(a, { conditions: ['windy', 'hilly'] }), ['wind', 'hills']);
  /* Every condition offered stands for a signal the engine knows. */
  Array.from(a.LOG_CONDITIONS).forEach(row =>
    assert.ok(a.NOTE_SIGNAL_BY_ID[row[2]], row[1] + ' stands for a signal that does not exist'));
});

test('watch data off doubts the distance and pace, and keeps the heart rate', () => {
  /* Founder: "Watch data off must not automatically discard all evidence ...
     unreliable GPS does not necessarily invalidate reliable heart-rate
     readings, reported effort or completion information." */
  const a = app();
  const dd = session(a, 'aerobic');
  a.handleLogPick(dd.id, 'conditions', 'watch');
  assert.equal(dd.actual.watchDataOff, true);
  assert.equal(dd.actual.conditions, undefined, 'the watch was filed as weather');
  assert.deepEqual(signalIds(a, dd.actual), ['gps_doubt']);
  assert.equal(a.coachEnvironment('', dd.actual).hrDoubt, false, 'watch data off threw the heart rate away');
  a.handleLogPick(dd.id, 'conditions', 'watch');
  assert.equal(dd.actual.watchDataOff, undefined);
  assert.deepEqual(signalIds(a, dd.actual), []);
});

test('pain on a tile is the pain signal, and reaches the decision exactly as written pain does', () => {
  const a = app();
  assert.deepEqual(signalIds(a, { hurting: 'pain' }), ['pain']);
  assert.deepEqual(signalIds(a, { hurting: 'niggle' }), ['niggle']);
  assert.deepEqual(signalIds(a, { hurting: 'no' }), [], '"No" was read as a complaint');
  assert.equal(a.coachEnvironment('', { hurting: 'pain' }).pain, true);
  /* One concept, said once: the note already speaks to pain, so the tile
     adds nothing beside it. */
  assert.deepEqual(signalIds(a, { notes: 'Sharp pain in my knee.', hurting: 'niggle' }), ['pain']);

  const decide = mark => {
    const b = app();
    b.state.days.filter(d => d.type !== 'rest' && d.date < TODAY).forEach(d => logAsPrescribed(b, d, { quality: 1 }));
    b.state.days.filter(d => d.type !== 'rest' && d.date < TODAY).slice(-2).forEach(d => mark(d.actual));
    return b.coachDecision().state;
  };
  const none = decide(() => {});
  const written = decide(x => { x.notes = 'Sharp pain in my knee.'; });
  const tapped = decide(x => { x.hurting = 'pain'; });
  assert.equal(tapped, written, 'two sessions with pain on a tile do not decide what two notes saying so decide');
  assert.notEqual(tapped, none, 'two sessions with pain change nothing');
});

test('a reason for stopping is either a signal or an excuse, never nothing', () => {
  const a = app();
  assert.deepEqual(signalIds(a, { stopReason: 'illness' }), ['illness']);
  assert.deepEqual(signalIds(a, { stopReason: 'injury' }), ['pain']);
  assert.deepEqual(signalIds(a, { stopReason: 'fatigue' }), ['tired']);
  Array.from(a.LOG_STOP).forEach(row => {
    const excused = a.logStopExcused({ actual: { stopReason: row[0] } });
    assert.notEqual(!!row[2], excused,
      row[1] + ' is ' + (excused ? 'both a signal and an excuse' : 'collected and then ignored'));
  });
  assert.equal(a.logStopExcused({ actual: {} }), false);
});

test('a session stopped for lack of time is not evidence that the athlete cannot do it', () => {
  const a = app();
  const two = a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY).slice(-2);
  two.forEach(d => { logAsPrescribed(a, d, { quality: 1 }); });
  a.playbookRelevantScored = () => two;
  a.computeExecutionScore = () => 40;
  assert.ok(a.playbookRepeatedShortfall('any', 2), 'two poor sessions are not read as a repeated shortfall');
  two[1].actual.stopReason = 'fatigue';
  assert.ok(a.playbookRepeatedShortfall('any', 2), 'stopping from fatigue excused the session');
  ['time', 'rest', 'other'].forEach(r => {
    two[1].actual.stopReason = r;
    assert.equal(a.playbookRepeatedShortfall('any', 2), null,
      'a session stopped for "' + r + '" still counts as one the athlete could not do');
  });
});

test('a reason for stopping does not outlive the stop', () => {
  const a = app();
  const dd = session(a, 'reps');
  const reps = a.logShape(dd).reps;
  a.handleLogAnswer(dd.id, 'repsDone', String(reps - 1));
  a.handleLogPick(dd.id, 'stopReason', 'time');
  assert.equal(dd.actual.stopReason, 'time');
  a.handleLogAnswer(dd.id, 'repsDone', String(reps));
  assert.equal(dd.actual.stopReason, undefined, 'every rep was done and the session is still excused');

  const easy = session(a, 'aerobic');
  const full = easy.actual.km;
  easy.actual.km = +(full * 0.5).toFixed(2);
  a.handleLogPick(easy.id, 'stopReason', 'rest');
  assert.equal(easy.actual.stopReason, 'rest');
  easy.actual.km = full;
  a.logTidy(easy);
  assert.equal(easy.actual.stopReason, undefined, 'the distance was corrected and the reason stayed');
  assert.match(a.handleActualFieldChange.toString(), /logTidy\(/, 'correcting the distance does not tidy the reason');
});

test('reps, the hold and the recoveries are read back in the analysis, in words, beside the score', () => {
  /* Founder: "a 100/100 Execution score must never be displayed on its own
     when only 60% of the workout was completed." */
  const a = app();
  const dd = session(a, 'reps');
  const reps = a.logShape(dd).reps;
  assert.equal(a.sessionReadoutHtml(dd), '', 'a session finished as prescribed with nothing said has a readout');
  a.handleLogAnswer(dd.id, 'repsDone', String(reps - 2));
  a.handleLogAnswer(dd.id, 'mainSetHeld', '5');
  a.handleLogPick(dd.id, 'recoveries', 'longer');
  a.handleLogPick(dd.id, 'conditions', 'hot');
  const out = a.sessionReadoutHtml(dd);
  const text = out.replace(/<[^>]+>/g, ' ');
  assert.match(text, /What you logged/);
  assert.match(text, new RegExp((reps - 2) + ' of ' + reps + ' reps completed'), 'the partial session is not stated');
  assert.match(text, /the set faded/, 'the fade is collected and never read back');
  assert.match(text, /longer recoveries/, 'the recoveries are collected and never read back');
  assert.match(text, /heat/i, 'the conditions are not read back');
  assert.ok(!/\d+\s*\/\s*100|\d+%/.test(text.replace(/\d+ of \d+/, '')),
    'the readout prints a figure: the new Execution score is behind the gate');
  a.analysisOpenFor[dd.id] = true;
  const review = a.renderExecutionReview(dd);
  assert.ok(review.indexOf(out) !== -1, 'the readout is not in the session analysis');
  assert.ok(review.indexOf('coach-msg-review') < review.indexOf(out), 'the readout comes before the coach has spoken');

  a.handleLogAnswer(dd.id, 'mainSetHeld', '1');
  assert.match(a.sessionReadoutHtml(dd), /the set got stronger/);
  a.handleLogAnswer(dd.id, 'mainSetHeld', '3');
  assert.ok(!/faded|stronger/.test(a.sessionReadoutHtml(dd)), 'an even set was reported as a change');
});

test('the five-position hold is read by the assessment as built, held or faded', () => {
  const a = app();
  assert.equal(a.logHeldWord(null), null);
  assert.deepEqual([1, 2, 3, 4, 5].map(a.logHeldWord), ['built', 'built', 'held', 'faded', 'faded']);
  assert.equal(a.logHeldWord('faded'), 'faded', 'an answer stored as a word no longer reads');
  /* Hill reps have no pace to hold them to: what the athlete says of the
     set is the whole of what the assessment can describe. */
  const dd = session(a, 'hills');
  a.handleLogAnswer(dd.id, 'mainSetHeld', '3');
  assert.equal(a.assessSession(dd).execution.level, 'high');
  a.handleLogAnswer(dd.id, 'mainSetHeld', '5');
  assert.equal(a.assessSession(dd).execution.level, 'mixed', 'the assessment does not read the slider');
});

// ---------------------------------------------------------------------------
// THE CONTROLS
// ---------------------------------------------------------------------------

test('a slider is the slider\'s: the tab pager stands down, and its changes are wired', () => {
  const a = app();
  const html = answers(a, session(a, 'reps'));
  (html.match(/<input type="range"[^>]*>/g) || []).forEach(r => {
    assert.match(r, /data-hswipe/, 'a drag on this slider would change tab: ' + r);
    assert.match(r, /data-action="log-slide"/);
    assert.match(r, /data-day="/);
  });
  assert.match(SRC, /action === 'log-slide'\) handleLogAnswer\(/, 'a slider that is let go saves nothing');
  assert.match(SRC, /case 'log-pick': handleLogPick\(/);
  assert.match(SRC, /case 'log-clear': handleLogClear\(/);
  assert.match(SRC, /addEventListener\('input', logRangeLive\)/);
  assert.match(SRC, /addEventListener\('pointerup', logRangeSettle\)/);
});

test('lifting a finger from an untouched slider where its thumb sits is the answer', () => {
  /* Measured in Chromium: a touch on a range that moves nothing fires
     neither input, change nor click. The lift is the only event there is. */
  const a = app();
  const dd = session(a, 'aerobic');
  const el = (cls, field, value) => ({
    classList: { contains: c => cls.indexOf(c) !== -1 },
    getAttribute: k => (k === 'data-day' ? dd.id : k === 'data-field' ? field : null), value: value });
  a.logRangeSettle({ target: el(['yl-range'], 'mainSetFelt', '3') });
  assert.equal(dd.actual.mainSetFelt, undefined, 'a slider already answered was answered again by a touch');
  a.logRangeSettle({ target: el(['is-unset'], 'mainSetFelt', '3') });
  assert.equal(dd.actual.mainSetFelt, undefined, 'something that is not a log slider was answered');
  a.logRangeSettle({ target: el(['yl-range', 'is-unset'], 'mainSetFelt', '3') });
  assert.equal(dd.actual.mainSetFelt, 3, 'a tap on the untouched thumb answered nothing');
  assert.equal(dd.actual.feel, 'normal');
  a.logRangeSettle({});
});

test('the old effort box and Feel buttons are gone, and effort is asked once', () => {
  const a = app();
  const dd = session(a, 'reps');
  a.logOpenFor[dd.id] = true;
  const html = a.renderCompletedPanel(dd, '');
  assert.equal((html.match(/data-field="rpe"/g) || []).length, 1, 'effort is asked more than once');
  assert.ok(!/<input type="number"[^>]*data-field="rpe"/.test(html), 'effort is still a typed box');
  assert.ok(!/feel-btn|data-action="set-feel"/.test(html), 'the Feel buttons are still drawn');
  assert.ok(html.indexOf('data-field="pace"') < html.indexOf('class="actual-field full yl"'),
    'the answers come before the two numbers a watch gives');
  assert.ok(!/toggle-detail|toggle-splits/.test(html), 'something in the log is behind a toggle again');
});

test('the answers are words and controls: no symbols, and the tiles are the builder\'s', () => {
  const a = app();
  const dd = session(a, 'reps');
  a.handleLogAnswer(dd.id, 'repsDone', '2');
  const html = answers(a, dd);
  assert.ok(!/<svg|<img|class="[^"]*\bpill\b/.test(html), 'an icon or a pill was drawn in the log');
  assert.match(html, /class="opt-grid yl-tiles"/, 'the tiles are not the builder\'s grid');
  /* Words in three columns, which the builder forbids of .cols-N for a
     reason: a label that cannot break widens a bare 1fr track. So these do
     not use .cols-N, and their own track cannot be widened by its contents. */
  assert.ok(!/opt-grid[^"]*cols-\d/.test(html), 'a worded grid is asking the builder for columns');
  const css = SRC.slice(SRC.indexOf('.yl{'), SRC.indexOf('.today-proposal{'));
  assert.match(css, /\.yl \.yl-tiles\{grid-template-columns:repeat\(3, minmax\(0, 1fr\)\);\}/,
    'the tiles\' track can be widened by a long word');
  assert.match(css, /\.yl-range\{[^}]*height:44px/, 'the slider is not a 44px target');
  /* Founder: "The current buttons feel slightly oversized relative to the
     inputs." 48px beside 44px fields; still a thumb's height. */
  assert.match(css, /\.yl \.opt-grid button\{min-height:48px/, 'the tiles are not thumb height, or are oversized again');
  assert.match(css, /\.yl-clear\{[^}]*min-height:44px/, 'Clear is not a 44px target');
  assert.ok(!/#[0-9A-Fa-f]{6}/.test(css.replace(/#FFFFFF/g, '')), 'a colour that is not white or a token is used');
});

// ---------------------------------------------------------------------------
// A TAPPED CONDITION IS READ AS THE TYPED ONE IS
// ---------------------------------------------------------------------------

/* Found by auditing every input through to the coaching: "Hilly" and "Windy"
   were stored, drawn and counted as signals, and then the one function that
   decides whether a slow pace has an explanation read the note's text and
   nothing else. Typing "hilly" put the pace in context; tapping Hilly did
   not. The screen's own rule is that nothing downstream can tell the two
   apart. */
test('a tapped condition excuses a slow pace exactly as the same word typed in the notes does', () => {
  const slowed = () => {
    const a = app(), dd = session(a, 'sustained');
    const sec = a.actualPaceSecPerKm(dd) * 1.12;
    dd.actual.pace = Math.floor(sec / 60) + ':' + String(Math.round(sec % 60)).padStart(2, '0');
    return { a, dd };
  };
  const read = (a, dd) => {
    delete dd.coachReview; a.coachPersistReview(dd);
    const b = a.computeExecutionBreakdown(dd), env = a.coachEnvironment(dd.actual.notes, dd.actual);
    return { pace: Array.from(a.coachExcuses(dd, 'pace')).map(c => c.key),
             hr: Array.from(a.coachExcuses(dd, 'hr')).map(c => c.key),
             verdict: a.coachVerdict(dd, b, env) };
  };
  const bare = slowed(), nothing = read(bare.a, bare.dd);
  assert.deepEqual(nothing.pace, []);
  assert.match(nothing.verdict, /nothing in the notes to explain it/, 'the fixture is not a slow session');

  [['hilly', 'a very hilly route', 'hills', true], ['windy', 'brutal headwind all the way', 'wind', false]].forEach(([tile, note, cue, excusesHr]) => {
    const t = slowed(); t.a.handleLogPick(t.dd.id, 'conditions', tile);
    const tapped = read(t.a, t.dd);
    const n = slowed(); n.dd.actual.notes = note;
    const typed = read(n.a, n.dd);
    assert.deepEqual(tapped.pace, [cue], tile + ': the tile explains nothing');
    assert.deepEqual(tapped.pace, typed.pace, tile + ': tapped and typed disagree about pace');
    assert.deepEqual(tapped.hr, typed.hr, tile + ': tapped and typed disagree about heart rate');
    assert.deepEqual(tapped.hr, excusesHr ? [cue] : []);
    assert.ok(!/nothing in the notes to explain it/.test(tapped.verdict), tile + ': the athlete said why and was told they had not');
    assert.equal(tapped.verdict, typed.verdict, tile + ': the two are read differently');
  });
  /* Tapped twice is untapped, and the explanation goes with it. */
  const u = slowed(); u.a.handleLogPick(u.dd.id, 'conditions', 'hilly'); u.a.handleLogPick(u.dd.id, 'conditions', 'hilly');
  assert.deepEqual(read(u.a, u.dd).pace, []);
  /* Both said: one explanation, not two. */
  const both = slowed(); both.a.handleLogPick(both.dd.id, 'conditions', 'hilly'); both.dd.actual.notes = 'hilly';
  assert.deepEqual(read(both.a, both.dd).pace, ['hills']);
  /* Hot and Humid are one explanation -- heat -- however many tiles say it. */
  const hh = slowed(); hh.a.handleLogPick(hh.dd.id, 'conditions', 'hot'); hh.a.handleLogPick(hh.dd.id, 'conditions', 'humid');
  assert.deepEqual(read(hh.a, hh.dd).pace, ['heat']);
  /* And no tile excuses more than its word did. */
  Object.keys(bare.a.LOG_CONDITION_CUE).forEach(id => {
    const cueKey = bare.a.LOG_CONDITION_CUE[id];
    assert.ok(Array.from(bare.a.COACH_NOTE_CUES).some(c => c.key === cueKey), id + ' maps to a cue that does not exist');
    assert.ok(Array.from(bare.a.LOG_CONDITIONS).some(row => row[2] === id), id + ' is not a condition the screen offers');
  });
});
