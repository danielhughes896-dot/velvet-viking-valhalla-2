'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');
const NOTE = require('../api/_voice-note.js');
const EXPLAIN = require('../api/_voice-explain.js');
const ASK = require('../api/_voice-ask.js');

/* A SESSION'S FACTS, THE SAME IN EVERY PACKET.

   Founder, after testing Ask Coach live: the coach answered "I don't have
   target paces for your coming sessions, so I can't tell you what number to
   hold." Approved: "Build it, push and merge when no fails. But it would
   still be in flowing convo not bullet form."

   So: one builder (voiceSessionFacts) gives Ask Coach, the Coach's Note and
   the run analysis the card's own target pace and heart-rate range; the
   checkers accept those figures and no others; and every reply is prose. */

const TODAY = '2026-11-05';   // a progressive tempo, in the half-marathon fixture

function quiet(a){
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
function athlete(opts){
  const a = quiet(loadApp({ pinnedDate: TODAY + 'T09:00:00Z' }));
  buildPlan(a, Object.assign({ distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188,
                               startDate: '2026-10-06' }, opts || {}));
  a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  /* Heavy legs: something for the Coach's Note to explain. */
  a.state.readiness = { date: TODAY, legs: 'heavy', sleep: 'good', health: 'good' };
  return a;
}
const day = (a, date) => a.state.days.find(d => d.date === date);
const firstOf = (a, pred) => a.state.days.find(d => d.date >= TODAY && pred(d));
const plain = o => JSON.parse(JSON.stringify(o));
const FIELDS = ['date', 'title', 'targetPace', 'goalPace', 'targetHeartRate'];
const pick = o => FIELDS.reduce((m, k) => { if (o && o[k] != null) m[k] = o[k]; return m; }, {});
/* The ring prints each figure as a row of its own: pace and heart rate
   behind their glyphs, the goal band bare. */
const onCard = (a, dd, figure) => a.renderDayCard(dd).indexOf('>' + a.escapeHtml(figure) + '</div>') !== -1;

// ---------------------------------------------------------------------------
// (a) ONE SET OF FACTS, THREE PACKETS
// ---------------------------------------------------------------------------
test('the same day carries the same facts in Ask Coach, the Coach’s Note and the run analysis', () => {
  const a = athlete();
  const dd = day(a, TODAY);
  const facts = plain(a.voiceSessionFacts(dd));
  assert.equal(facts.targetPace, '4:47–5:05/km', 'the tempo band the founder saw on the card');
  assert.equal(facts.targetHeartRate, '164–171 BPM');

  const note = a.coachNoteEvidence(dd);
  assert.ok(note, 'precondition: a Coach’s Note is asked for');
  const ask = a.voiceCoachContext().todaySession;
  logAsPrescribed(a, dd, { quality: 1 });
  const run = a.resultSayEvidence('run', dd);

  const want = pick(facts);
  assert.deepEqual(pick(plain(ask)), want, 'Ask Coach');
  /* NO DATE IN A CHECKED PACKET. The note and the run analysis are checked
     for invented numbers against their packet, and an ISO date would make
     its year, month and day "evidence": "Run 17km" passed on the 17th. The
     session they are about is already known; only Ask Coach, which talks
     about the days ahead and has no number check, carries the date. */
  const noDate = o => { const c = Object.assign({}, o); delete c.date; return c; };
  assert.deepEqual(pick(plain(note.session)), noDate(want), 'the Coach’s Note');
  assert.deepEqual(pick(plain(run.session)), noDate(want), 'the run analysis');
  assert.equal(note.session.date, undefined, 'a date crept into the checked note packet');
  assert.equal(run.session.date, undefined, 'a date crept into the checked run packet');
  assert.equal(NOTE.validateNote('Run 17km steady today and keep it controlled.', note).why, 'invented_number',
    'a number taken from the date passed as evidence');

  /* Added, not renamed: each packet keeps the names and units it always had. */
  assert.equal(ask.plannedKm, 6.5);
  assert.equal(note.session.plannedDistance, '6.5km');
  assert.equal(note.session.isToday, true);
  assert.equal(run.session.planned, '6.5km');
  assert.equal(run.session.type, 'Tempo');

  /* What is coming carries the same facts as well. */
  const up = a.voiceCoachContext().upcoming;
  assert.ok(up.length);
  up.forEach(u => assert.deepEqual(plain(u), plain(a.voiceSessionFacts(day(a, u.date)))));
});

// ---------------------------------------------------------------------------
// (b) THE CARD'S NUMBER, NOT A SECOND DERIVATION
// ---------------------------------------------------------------------------
test('the target pace is the card’s, for easy, tempo, interval and long runs', () => {
  const a = athlete();
  const cases = {
    easy: firstOf(a, d => d.type === 'easy'),
    tempo: firstOf(a, d => d.type === 'tempo'),
    interval: firstOf(a, d => d.type === 'interval' && !a.isHillRepeats(d)),
    long: firstOf(a, d => d.type === 'long' && d.mpSegment)
  };
  Object.keys(cases).forEach(k => {
    const dd = cases[k];
    assert.ok(dd, 'no ' + k + ' session in the fixture');
    const f = a.voiceSessionFacts(dd), t = a.getDayTargets(dd);
    assert.ok(f.targetPace, k + ': no target pace');
    assert.equal(f.targetPace, t.pace, k + ': not the ring’s pace');
    assert.ok(onCard(a, dd, f.targetPace), k + ': ' + f.targetPace + ' is not on the card');
    assert.ok(onCard(a, dd, f.targetHeartRate), k + ': ' + f.targetHeartRate + ' is not on the card');
  });
  /* A structured session: the band is its WORK stage's. */
  ['tempo', 'interval'].forEach(k => {
    const work = a.workoutSteps(cases[k]).filter(s => s.role === 'work')[0];
    assert.equal(a.stepPrescriptionParts(work).pace, a.voiceSessionFacts(cases[k]).targetPace,
      k + ': the band is not the work stage’s');
  });
  /* A long run with a goal-pace section: the easy band and the section's, as the ring shows both. */
  const lf = a.voiceSessionFacts(cases.long);
  const easy = a.voiceSessionFacts(cases.easy);
  assert.equal(lf.targetPace, easy.targetPace);
  assert.ok(lf.goalPace, 'the goal-pace section is missing');
  assert.ok(onCard(a, cases.long, 'Goal ' + lf.goalPace), 'the goal band is not the ring’s');
  assert.ok(!('goalPace' in a.voiceSessionFacts(cases.easy)), 'an easy run was given a goal band');
  /* Rest carries no target, and an untouched day is not reworked. */
  const rest = firstOf(a, d => d.type === 'rest');
  assert.deepEqual(Object.keys(a.voiceSessionFacts(rest)), ['date', 'type', 'title', 'plannedKm']);
});

// ---------------------------------------------------------------------------
// (c) NO PACE FROM A STRAVA-DERIVED ANCHOR
// ---------------------------------------------------------------------------
test('no pace is sent when the fitness anchor cannot be shown Strava-free', () => {
  const a = athlete();
  /* The laundering path voiceStravaProvenance pins: a Strava race becomes the anchor. */
  const race = day(a, '2026-11-01');
  race.type = 'race'; race.km = 10;
  race.actual = Object.assign(a.emptyActual(), { km: 10, pace: '4:20' });
  race.completed = true;
  race.stravaActivityId = 'ANCHOR';
  a.recordMeasuredPerformance(race);
  assert.equal(a.voiceFitnessAnchorIndependent(), false, 'precondition: the anchor is Strava-derived');

  const ctx = a.voiceCoachContext();
  const j = JSON.stringify(ctx);
  assert.ok(ctx.todaySession, 'today was lost with the paces');
  assert.doesNotMatch(j, /"targetPace"|"goalPace"/, 'a pace from a Strava-derived anchor was sent');
  assert.equal(ctx.withheld.targetPaces, true, 'the withholding is not declared');
  ctx.upcoming.forEach(u => assert.ok(!('targetPace' in u)));
  /* The same answer from the builder itself, whoever asks. */
  assert.ok(!('targetPace' in a.voiceSessionFacts(day(a, TODAY))));
  /* And the other half: an independent anchor declares nothing withheld. */
  assert.equal(athlete().voiceCoachContext().withheld.targetPaces, false);
});

// ---------------------------------------------------------------------------
// (d) HEART RATE ONLY WITH CONSENT
// ---------------------------------------------------------------------------
test('no heart-rate range without health consent; the card’s range with it', () => {
  const yes = athlete();
  const dd = day(yes, TODAY);
  assert.equal(yes.voiceSessionFacts(dd).targetHeartRate, '164–171 BPM');
  assert.equal(yes.coachNoteEvidence(dd).session.targetHeartRate, '164–171 BPM');

  const no = athlete({ healthConsent: false });
  const nd = day(no, TODAY);
  assert.equal(no.healthConsentGranted(), false);
  const f = no.voiceSessionFacts(nd);
  assert.ok(f.targetPace, 'the pace went with the heart rate');
  assert.ok(!('targetHeartRate' in f));
  assert.doesNotMatch(JSON.stringify(no.voiceCoachContext()), /BPM|targetHeartRate/);
  const nev = no.coachNoteEvidence(nd);
  if (nev) assert.ok(!('targetHeartRate' in nev.session));
  /* Passing health:true cannot stand in for consent. */
  assert.ok(!('targetHeartRate' in no.voiceSessionFacts(nd, { health: true, derived: true })));

  /* A threshold measured on a Strava-derived day fails closed, as the pace anchor does. */
  const cal = athlete();
  const cday = day(cal, '2026-11-01');
  cal.state.setup.lthrSource = 'calibration';
  cal.state.setup.lthrMeasuredOn = cday.date;
  assert.ok(cal.voiceSessionFacts(day(cal, TODAY)).targetHeartRate, 'precondition');
  cday.stravaActivityId = 'CAL';
  assert.ok(!('targetHeartRate' in cal.voiceSessionFacts(day(cal, TODAY))));
});

// ---------------------------------------------------------------------------
// (e) A STRAVA-DERIVED DAY IS STILL ABSENT
// ---------------------------------------------------------------------------
test('a Strava-derived day gets no facts, and the packets that refuse it still refuse it', () => {
  const a = athlete();
  const next = day(a, '2026-11-07');
  next.stravaActivityId = 'IMPORTED';
  assert.equal(a.voiceSessionFacts(next), null);
  const ctx = a.voiceCoachContext();
  assert.ok(!ctx.upcoming.some(u => u.date === next.date), 'the imported day reached upcoming');
  assert.doesNotMatch(JSON.stringify(ctx), /IMPORTED/);
  /* Any Strava evidence: no Coach's Note packet and no explain packet at all. */
  assert.equal(a.coachNoteEvidence(day(a, TODAY)), null);
  assert.equal(a.resultSayEvidence('run', day(a, '2026-11-04')), null);
  /* Today imported: no session summarised, facts or otherwise. */
  const b = athlete();
  day(b, TODAY).stravaActivityId = 'TODAY';
  assert.equal(b.voiceCoachContext().todaySession, null);
  assert.equal(b.voiceSessionFacts(day(b, TODAY)), null);
  /* A plan change made after Strava evidence existed stays out too. */
  const c = athlete();
  day(c, '2026-10-30').stravaActivityId = 'OLD';
  const moved = day(c, '2026-11-08');
  moved.coachAdjust = { at: 'x', source: 'evolution', reason: 'y' };
  assert.equal(c.voiceSessionFacts(moved), null);
});

// ---------------------------------------------------------------------------
// (f) THE PACKET'S PACE MAY BE QUOTED; NO OTHER MAY
// ---------------------------------------------------------------------------
test('a reply quoting the packet’s pace passes; an invented pace fails, on both sides of the wire', () => {
  const a = athlete();
  const dd = day(a, TODAY);
  const note = a.coachNoteEvidence(dd);
  const good = 'Heavy legs today, so hold the tempo between 4:47 and 5:05 and let your heart rate settle near 164 to 171 without chasing more.';
  const bad  = 'Heavy legs today, so hold the tempo between 4:40 and 4:55 and let the effort settle without chasing more.';
  assert.deepEqual(NOTE.validateNote(good, note), { ok: true, note: good });
  assert.equal(a.coachNoteValid(good, note).ok, true);
  assert.equal(NOTE.validateNote(bad, note).why, 'invented_number');
  assert.equal(a.coachNoteValid(bad, note).why, 'invented_number');
  /* The range itself, en-dash and all. */
  assert.equal(NOTE.validateNote('Heavy legs today, so hold 4:47–5:05/km and no quicker.', note).ok, true);
  assert.deepEqual(NOTE.numbersIn('4:47–5:05/km · 162–169 BPM'), ['4:47', '5:05', '162', '169']);

  logAsPrescribed(a, dd, { quality: 1 });
  const run = a.resultSayEvidence('run', dd);
  const say = 'An effort of 7 out of 10 is right where this tempo should sit. Your pace came in at 5:13 against a target of 4:47 to 5:05, so the next one can settle a little quicker once your legs are fresher. Keep the easy run genuinely easy.';
  const off = say.replace('4:47 to 5:05', '4:30 to 4:50');
  assert.deepEqual(EXPLAIN.validateExplain(say, run), { ok: true, text: say });
  assert.equal(a.resultSayValid(say, run).ok, true);
  assert.equal(EXPLAIN.validateExplain(off, run).why, 'invented_number');
  assert.equal(a.resultSayValid(off, run).why, 'invented_number');
});

// ---------------------------------------------------------------------------
// (g) PROSE, NEVER A LIST
// ---------------------------------------------------------------------------
test('a list or markdown fails the note and explain checks, and the app’s copies of them', () => {
  const a = athlete();
  const dd = day(a, TODAY);
  const note = a.coachNoteEvidence(dd);
  logAsPrescribed(a, dd, { quality: 1 });
  const run = a.resultSayEvidence('run', dd);
  const prose = 'Heavy legs today, so hold the tempo by feel and let the pace come to you.';
  assert.equal(NOTE.validateNote(prose, note).ok, true, 'precondition: the prose passes');
  const shapes = {
    bullets: 'Heavy legs today.\n- Hold the tempo by feel\n- Let the pace come to you',
    star: 'Heavy legs today.\n* Hold the tempo by feel, and let the pace come to you.',
    dot: 'Heavy legs today.\n• Hold the tempo by feel, and let the pace come to you.',
    numbered: 'Heavy legs today.\n1. Hold the tempo by feel.\n2. Let the pace come to you.',
    bracket: 'Heavy legs today.\n1) Hold the tempo by feel, and let the pace come to you.',
    heading: '# Today\nHeavy legs today, so hold the tempo by feel and let the pace come to you.',
    bold: 'Heavy legs today, so **hold the tempo by feel** and let the pace come to you.',
    underline: 'Heavy legs today, so __hold the tempo by feel__ and let the pace come to you.'
  };
  Object.keys(shapes).forEach(k => {
    const t = shapes[k];
    assert.equal(NOTE.validateNote(t, note).ok, false, 'validateNote: ' + k);
    assert.equal(a.coachNoteValid(t, note).ok, false, 'coachNoteValid: ' + k);
    assert.equal(EXPLAIN.validateExplain(t, run).ok, false, 'validateExplain: ' + k);
    assert.equal(a.resultSayValid(t, run).ok, false, 'resultSayValid: ' + k);
  });
  /* A list hidden inside a paragraph the explain check joins up is still a list. */
  assert.equal(EXPLAIN.validateExplain('Good work.\n\n- Keep it easy', run).why, 'not_prose');
  assert.equal(a.resultSayValid('Good work.\n\n- Keep it easy', run).why, 'not_prose');
  /* A sentence that opens on a figure is not an item. */
  assert.equal(NOTE.listFormatting('10.5km at an easy effort.\n5:13 was the pace.'), false);
  assert.equal(a.coachNoteListFormatting('10.5km at an easy effort.\n5:13 was the pace.'), false);
});

test('the prompts say quote-exactly and flowing prose, once each', () => {
  const systems = [ASK.SYSTEM, NOTE.SYSTEM, EXPLAIN.SYSTEM.run, EXPLAIN.SYSTEM.week, EXPLAIN.SYSTEM.recovery];
  systems.forEach((s, i) => {
    assert.match(s, /targetPace, goalPace and targetHeartRate/, 'prompt ' + i + ': no target rule');
    assert.match(s, /never change,\s+round, widen or narrow/, 'prompt ' + i + ': targets may be altered');
    assert.match(s, /[Ff]lowing conversational prose/, 'prompt ' + i + ': no prose rule');
    assert.match(s, /never bullet points, numbered lists,\s+headings, bold or any other markdown/, 'prompt ' + i);
    assert.equal((s.match(/bullet points/g) || []).length, 1, 'prompt ' + i + ': the list rule is said twice');
  });
});

// ---------------------------------------------------------------------------
// (h) ASK COACH: FLATTENED WHERE IT IS DRAWN
// ---------------------------------------------------------------------------
test('an Ask Coach answer with a list is drawn as prose, and a plain one is untouched', () => {
  const a = quiet(loadApp({ pinnedDate: TODAY + 'T09:00:00Z' }));
  assert.equal(a.askAnswerProse('- a\n- b', true), 'A. B.');
  assert.equal(a.askAnswerProse('Two things:\n1. Hold **4:47** early\n2. Finish strong', true),
    'Two things: Hold 4:47 early. Finish strong.');
  assert.equal(a.askAnswerProse('Two things:\n• one\n• two', false), 'Two things: One. Two',
    'a streaming answer’s last line is left open');
  const plainAnswer = 'Hold 4:47–5:05/km for the tempo.\nThen ease off - nothing more.';
  assert.equal(a.askAnswerProse(plainAnswer, true), plainAnswer);
  a.askSet('answered', { answer: '- Hold the tempo at 4:47–5:05/km\n- Sacoro says keep the easy run easy' });
  assert.equal(a.askState.answer, 'Hold the tempo at 4:47–5:05/km. SACORO says keep the easy run easy.');
  assert.doesNotMatch(a.askState.answer, /\n|^- |\*\*/);
});

test('the spoken answer drops list and bold marks too', () => {
  const a = athlete();
  assert.equal(a.askSpeechPlain('- Keep it easy\n- **Hold** 4:47'), 'Keep it easy\nHold 4:47');
  assert.equal(a.askSpeechPlain('Run 10.5km easy.'), 'Run 10.5km easy.', 'a plain sentence is untouched');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'protected', 'velvet-viking-valhalla.html'), 'utf8');
  assert.match(src, /askSpeechFeed\(askSpeechPlain\(text\), false\);/);
});
