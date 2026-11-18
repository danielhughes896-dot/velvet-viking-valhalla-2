'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness.js');
const { buildPlan, logAsPrescribed } = require('./fixtures.js');

/* THE COACH'S NOTE, WRITTEN
 * ===========================================================================
 * Founder: "Upgrade Coach's Note to genuinely personalised, AI-written
 * coaching using existing Anthropic integration and engine evidence. The
 * engine retains all training decisions; AI explains, never invents data or
 * changes prescriptions. Avoid duplicate observations and provide a safe
 * fallback. Keep scope narrow and existing design intact."
 *
 * Each clause of that is a property of the code, tested here:
 *
 *   EXISTING INTEGRATION    one model endpoint in the product, still
 *   ENGINE EVIDENCE         what is sent is what the engine concluded
 *   AI EXPLAINS             the reply is text; nothing reads it as a decision
 *   NEVER INVENTS           a number not in the evidence is rejected, twice
 *   NEVER CHANGES           an instruction the engine did not give is rejected
 *   NO DUPLICATES           one line, one place; never a line already beside it
 *   SAFE FALLBACK           every failure leaves the engine's sentence
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'protected', 'velvet-viking-valhalla.html'), 'utf8');
const NOTE_SRC = fs.readFileSync(path.join(ROOT, 'api', '_voice-note.js'), 'utf8');
const N = require('../api/_voice-note.js');
const TODAY = '2026-11-05';
const GOOD = 'Your legs felt heavy this morning, so let the tempo come to you and hold back if the effort starts to climb.';

function quiet(a){
  a.showToast = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
/* An athlete the engine has something to say to: heavy legs this morning. */
function athlete(opts){
  const o = opts || {};
  const a = quiet(loadApp({ pinnedDate: TODAY + 'T09:00:00Z', fetch: o.fetch }));
  a.renderApp = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 12, lthr: 172, maxHR: 188, startDate: '2026-10-06',
                 healthConsent: o.healthConsent !== false });
  a.state.days.filter(d => d.type !== 'rest' && d.date < TODAY).forEach(d => logAsPrescribed(a, d, { quality: 1 }));
  if (o.steady !== true) a.state.readiness = { date: TODAY, legs: 'heavy', sleep: 'good', health: 'good' };
  a.state.view = 'today';
  return a;
}
const session = a => a.state.days.filter(d => d.date === TODAY)[0];
const signIn = a => { a.cloudSession = { access_token: 'tok', user_id: 'u1', email: 'a@b.c', expires_at: Date.parse('2031-01-01') }; };
const body = name => {
  const at = SRC.indexOf('\nfunction ' + name + '(');
  assert.ok(at !== -1, name + ' is gone');
  return SRC.slice(at, SRC.indexOf('\n}\n', at));
};
const text = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const noteOnCard = card => (card.match(/<span class="[^"]*\b(why-session-o|how-note-obs|hn-obs)\b[^"]*">([\s\S]*?)<\/span>/g) || []).map(text);

/* A server response, as the route's handler sees one. */
function res(){
  const r = { code: 0, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.code = c; return r; };
  r.send = b => { r.body = JSON.parse(b); return r; };
  return r;
}
const EVIDENCE = {
  units: 'km', session: { title: 'Progressive Tempo: 19min', type: 'tempo', plannedDistance: '6.5km', isToday: true },
  decision: 'check', reasons: ['You reported heavy legs this morning'],
  recovery: { state: 'watch', hardDaysInARow: 1 },
  engineNote: 'You reported heavy legs this morning. Do not force the pace if the effort starts climbing.',
  alreadyOnScreen: ['This is the session that makes race effort feel repeatable. Controlled and rhythmic, never a race.']
};
function deps(over){
  const o = over || {};
  const calls = [];
  return {
    calls,
    voiceConfig: () => Object.assign({ enabled: true, apiKey: 'sk-ant-api03-' + 'x'.repeat(90), model: 'm' }, o.cfg || {}),
    verifyUser: async () => ('who' in o ? o.who : { uid: 'u1' }),
    postModel: async (cfg, payload) => {
      calls.push(payload);
      if (o.throws) throw new Error('down');
      if (o.statuses && o.statuses.length) {
        const st = o.statuses.shift();
        if (st !== 200) return { ok: false, status: st, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => (o.data || { content: [{ type: 'text', text: o.text == null ? GOOD : o.text }] }) };
    }
  };
}
const post = async (d, payload) => {
  const r = res();
  await N.handle({ method: 'POST', headers: {}, body: payload === undefined ? { evidence: EVIDENCE } : payload }, r, d);
  return r;
};

// ---------------------------------------------------------------------------
// THE CHECK: NEVER INVENTS, NEVER CHANGES, NEVER REPEATS
// ---------------------------------------------------------------------------

/* One table, put to both copies of the check. `why` null means accepted. */
const CASES = [
  ['a note that says what the engine said', GOOD, null],
  ['a number the engine gave', 'Heavy legs this morning. Keep the 6.5km honest and ease off if the effort climbs early.', null],
  ['an invented pace', 'Heavy legs this morning, so hold 4:45 per km and no quicker through the tempo.', 'invented_number'],
  ['an invented count', 'That is 3 hard days in a row on heavy legs, so ease into this one.', 'invented_number'],
  ['an invented heart rate', 'Heavy legs this morning. Keep your heart rate under 165 through the tempo.', 'invented_number'],
  ['an instruction to skip', 'Your legs are heavy this morning, so skip the tempo and jog easily today.', 'changes_prescription'],
  ['an instruction to shorten', 'Your legs are heavy this morning, so shorten the tempo and call it done.', 'changes_prescription'],
  ['an instruction not to run', 'Your legs are heavy this morning. Do not run the tempo; walk today.', 'changes_prescription'],
  ['a claim that the plan changed', 'Your legs are heavy, so we have adjusted the tempo to suit how you feel.', 'claims_change'],
  ['a claim that the plan changed, passive', 'Your legs are heavy and your session has been reduced to match.', 'claims_change'],
  ['medical advice', 'Your legs are heavy this morning. Take ibuprofen before you start the tempo.', 'medical'],
  ['the machine showing', 'The data shows heavy legs this morning, so run the tempo by feel.', 'mentions_machine'],
  ['a line already on the screen', 'Heavy legs today. This is the session that makes race effort feel repeatable.', 'duplicate'],
  ['a list', '- Heavy legs this morning\n- Run the tempo by feel and nothing more', 'markup'],
  ['nothing much', 'Go well.', 'too_short'],
  ['an essay', ('Your legs are heavy this morning so run by feel. ').repeat(9), 'too_long'],
  ['four sentences', 'Heavy legs today. Run by feel. Ease off early. Do not force it.', 'too_many_sentences'],
];

test('the server rejects a note that invents a number, changes the session, advises medically or repeats the card', () => {
  CASES.forEach(([name, note, why]) => {
    const v = N.validateNote(note, EVIDENCE);
    if (why === null) assert.equal(v.ok, true, name + ': ' + v.why);
    else { assert.equal(v.ok, false, name + ' was accepted'); assert.equal(v.why, why, name); }
  });
});

test('the app applies the same check again before it shows anything', () => {
  const a = athlete();
  CASES.forEach(([name, note, why]) => {
    const v = a.coachNoteValid(note, EVIDENCE);
    if (why === null) { assert.equal(v.ok, true, name + ': ' + v.why); assert.equal(v.note, N.validateNote(note, EVIDENCE).note); }
    else { assert.equal(v.ok, false, name + ' was accepted by the app'); assert.equal(v.why, why, name); }
  });
  /* And the two lists the check is made of have not drifted apart. */
  assert.deepEqual(Array.from(a.COACH_NOTE_CHANGE_WORDS), N.CHANGE_WORDS);
  assert.equal(a.COACH_NOTE_MAX_CHARS, N.NOTE_MAX_CHARS);
  assert.equal(a.COACH_NOTE_MIN_CHARS, N.NOTE_MIN_CHARS);
  assert.equal(a.COACH_NOTE_NEVER.length, (NOTE_SRC.match(/^  \[\/.*'\w+'\],?$/gm) || []).length);
});

test('a word that changes the session is allowed only where the engine used it first', () => {
  const ev = Object.assign({}, EVIDENCE, { engineNote: 'Skip the tempo today and recover.', decision: 'recover' });
  assert.equal(N.validateNote('Recover first: skip the tempo today and come back to it fresh.', ev).ok, true);
  assert.equal(N.validateNote('Recover first: skip the tempo today and come back to it fresh.', EVIDENCE).why, 'changes_prescription');
});

test('when the engine says recover, a note that does not say so is rejected', () => {
  const ev = Object.assign({}, EVIDENCE, { decision: 'recover', engineNote: 'Recovery comes before this session.' });
  assert.equal(N.validateNote('Your legs are heavy this morning, so settle into the tempo gently.', ev).why, 'softens_recover');
  assert.equal(N.validateNote('Your legs are heavy this morning. Recovery comes first today.', ev).ok, true);
  /* The app's copy of the check holds the same line. */
  const a = athlete();
  assert.equal(a.coachNoteValid('Your legs are heavy this morning, so settle into the tempo gently.', ev).why, 'softens_recover');
  assert.equal(a.coachNoteValid('Your legs are heavy this morning. Recovery comes first today.', ev).ok, true);
  const skip = Object.assign({}, EVIDENCE, { engineNote: 'Skip the tempo today and recover.', decision: 'recover' });
  assert.equal(a.coachNoteValid('Recover first: skip the tempo today and come back to it fresh.', skip).ok, true);
  assert.equal(a.coachNoteValid('Recover first: skip the tempo today and come back to it fresh.', EVIDENCE).why, 'changes_prescription');
});

// ---------------------------------------------------------------------------
// THE ROUTE: ONE DOOR, AND EVERY REFUSAL IS "NO NOTE"
// ---------------------------------------------------------------------------

test('a good note comes back as text and nothing else', async () => {
  const d = deps();
  const r = await post(d);
  assert.equal(r.code, 200);
  assert.deepEqual(r.body, { note: GOOD });
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(d.calls.length, 1);
  /* What was sent: the evidence, the fixed instruction, and no tools. */
  const p = d.calls[0];
  assert.equal(p.system, N.SYSTEM);
  assert.equal(p.messages.length, 1);
  assert.ok(p.messages[0].content.indexOf(JSON.stringify(EVIDENCE)) !== -1);
  assert.ok(!('tools' in p) && !('tool_choice' in p), 'the note route gave the model tools');
});

test('every refusal returns no note, and the model is not asked', async () => {
  const table = [
    ['switched off',  deps({ cfg: { enabled: false } }), undefined, 403, 'VOICE_DISABLED'],
    ['no key',        deps({ cfg: { apiKey: '' } }),     undefined, 503, 'VOICE_NOT_CONFIGURED'],
    ['signed out',    deps({ who: null }),               undefined, 401, 'not_signed_in'],
    ['unknown user',  deps({ who: { code: 'bad' } }),    undefined, 401, 'not_signed_in'],
    ['no evidence',   deps(),                            {},        400, 'no_evidence'],
    ['no engine note', deps(), { evidence: { decision: 'check' } }, 400, 'no_evidence'],
    ['evidence as a list', deps(), { evidence: [EVIDENCE] },        400, 'no_evidence'],
    ['evidence too large', deps(), { evidence: Object.assign({}, EVIDENCE, { pad: 'x'.repeat(N.EVIDENCE_MAX_CHARS) }) }, 413, 'evidence_too_large'],
    ['a Strava activity id', deps(), { evidence: Object.assign({}, EVIDENCE, { stravaActivityId: 1 }) }, 422, 'STRAVA_DERIVED_CONTEXT'],
    ['a Strava source', deps(), { evidence: Object.assign({}, EVIDENCE, { day: { source: 'strava' } }) }, 422, 'STRAVA_DERIVED_CONTEXT'],
  ];
  for (const [name, d, payload, code, word] of table){
    const r = await post(d, payload);
    assert.equal(r.code, code, name);
    assert.deepEqual(r.body, { note: null, code: word }, name);
    assert.equal(d.calls.length, 0, name + ': the model was asked anyway');
  }
  const r = res();
  const d = deps();
  await N.handle({ method: 'GET', headers: {} }, r, d);
  assert.equal(r.code, 405);
  assert.equal(r.body.note, null);
  assert.equal(d.calls.length, 0);
});

test('an upstream failure, a refusal and a rejected reply all return no note', async () => {
  const table = [
    ['unreachable',  deps({ throws: true }), 502, 'coach_unavailable'],
    ['server error', deps({ statuses: [500] }), 502, 'coach_unavailable'],
    ['refusal',      deps({ data: { stop_reason: 'refusal', content: [] } }), 200, 'declined'],
    ['empty',        deps({ data: { content: [] } }), 200, 'rejected_too_short'],
    ['thinking only', deps({ data: { content: [{ type: 'thinking', thinking: GOOD }] } }), 200, 'rejected_too_short'],
    ['invented pace', deps({ text: 'Heavy legs this morning, so hold 4:45 per km through the tempo.' }), 200, 'rejected_invented_number'],
    ['changes plan',  deps({ text: 'Your legs are heavy this morning, so skip the tempo and jog easily.' }), 200, 'rejected_changes_prescription'],
  ];
  for (const [name, d, code, word] of table){
    const r = await post(d);
    assert.equal(r.code, code, name);
    assert.deepEqual(r.body, { note: null, code: word }, name);
  }
});

test('a request rejected as malformed is retried once without the effort setting, and only once', async () => {
  const d = deps({ statuses: [400, 200] });
  const r = await post(d);
  assert.deepEqual(r.body, { note: GOOD });
  assert.equal(d.calls.length, 2);
  assert.ok('output_config' in d.calls[0]);
  assert.ok(!('output_config' in d.calls[1]));
  const again = deps({ statuses: [400, 400, 200] });
  const r2 = await post(again);
  assert.equal(r2.body.note, null);
  assert.equal(again.calls.length, 2);
});

test('there is still one place in the product that can reach a model', () => {
  const apiDir = path.join(ROOT, 'api');
  const read = f => fs.readFileSync(path.join(apiDir, f), 'utf8');
  const files = fs.readdirSync(apiDir).filter(f => /\.js$/.test(f));
  assert.deepEqual(files.filter(f => /api\.anthropic\.com/.test(read(f))).sort(), ['_voice-ask.js']);
  assert.match(NOTE_SRC, /ASK\.postModel/);
  assert.ok(!/https?:\/\//.test(NOTE_SRC), 'the note route names a URL of its own');
  /* It reads no database and holds no way to write a plan. */
  assert.ok(!/supabase|service_role|SERVICE_ROLE|\.from\(|rest\/v1/i.test(NOTE_SRC));
  /* It is a route behind the existing voice function, not a function of its own. */
  assert.match(read('voice.js'), /'voice-note':\s+require\('\.\/_voice-note\.js'\)/);
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  assert.ok(JSON.stringify(vercel).indexOf('"/api/voice?route=voice-note"') !== -1);
  assert.ok(files.filter(f => f[0] !== '_').length <= 12, 'over the function limit');
  /* The log never carries the note or the evidence. */
  (NOTE_SRC.match(/V\.log\([^;]*;/g) || []).forEach(l =>
    assert.ok(!/verdict\.note[^.]|evidenceJson|textOf|body\./.test(l), 'a log line carries content: ' + l));
});

// ---------------------------------------------------------------------------
// THE EVIDENCE: WHAT THE ENGINE CONCLUDED, AND WHO IT IS NOT SENT FOR
// ---------------------------------------------------------------------------

test('the evidence is the engine\'s own conclusions about the session it decided on', () => {
  const a = athlete(), dd = session(a);
  const ev = a.coachNoteEvidence(dd);
  assert.ok(ev);
  assert.equal(ev.engineNote, a.coachObservation(dd));
  assert.equal(ev.decision, a.coachDecision().state);
  assert.deepEqual(Array.from(ev.reasons), Array.from(a.coachDecision().reasons).slice(0, 3));
  assert.equal(ev.recovery.state, a.coachRecovery().state);
  assert.equal(ev.recovery.hardDaysInARow, a.coachRecovery().hardStreak);
  assert.equal(ev.session.title, dd.title);
  assert.deepEqual(Array.from(ev.reportedThisMorning), ['heavy legs']);
  /* No training record: no day list, no logged actuals, no identity. */
  const json = JSON.stringify(ev);
  assert.ok(!/"days"|"actual"|"laps"|"splits"|"email"|"user_id"|"name"/.test(json), json);
  assert.ok(json.length < N.EVIDENCE_MAX_CHARS);
  /* And the server takes it as it is. */
  assert.equal(N.validateNote(GOOD, JSON.parse(json)).ok, true);
});

test('an athlete the engine has nothing to say to is never sent anywhere', () => {
  const a = athlete({ steady: true }), dd = session(a);
  assert.equal(a.coachObservation(dd), '');
  assert.equal(a.coachNoteEvidence(dd), null);
  /* Nor any session but the one the decision is about. */
  const b = athlete();
  b.state.days.filter(d => d.id !== session(b).id).forEach(d => assert.equal(b.coachNoteEvidence(d), null, d.date));
});

test('an athlete with a Strava-derived day keeps the engine\'s note: nothing is sent', async () => {
  let asked = 0;
  const a = athlete({ fetch: () => { asked++; return Promise.reject(new Error('x')); } });
  const dd = session(a);
  const before = asked;
  a.state.days.filter(d => d.completed)[3].stravaActivityId = 'S-1';
  assert.equal(a.voiceHasStravaEvidence(), true);
  assert.equal(a.coachNoteEvidence(dd), null);
  signIn(a); a.voiceCoachAvailable = true;
  assert.equal(a.coachNoteMaybeFetch(), null);
  assert.equal(asked, before);
  /* A note written before the connection is no longer used either. */
  assert.equal(a.coachNoteText(dd), a.coachObservation(dd));
});

test('health information leaves the device only with consent', () => {
  /* Without consent the morning check-in is not read at all, so the engine
     has nothing to say about it and nothing is sent. */
  const a = athlete({ healthConsent: false });
  assert.equal(a.coachNoteEvidence(session(a)), null);
  /* Missed training is not health information: the engine does speak, and
     what is sent carries no effort, heart-rate or check-in reading. */
  const m = athlete({ healthConsent: false, steady: true });
  m.state.days.filter(d => d.completed).slice(-3).forEach(d => { d.completed = false; d.actual = {}; delete d.coachReview; });
  const ev = m.coachNoteEvidence(session(m));
  assert.ok(ev, 'the missed-training athlete has no evidence');
  assert.equal(ev.healthInformation, 'withheld');
  assert.ok(!('reportedThisMorning' in ev));
  assert.ok(!('sessionsEffortAboveBand' in ev.recovery) && !('sessionsHeartRateAboveZone' in ev.recovery));
  assert.ok(ev.missedTraining && ev.missedTraining.planned > ev.missedTraining.ran);
  const b = athlete(), evB = b.coachNoteEvidence(session(b));
  assert.ok('sessionsEffortAboveBand' in evB.recovery && 'sessionsHeartRateAboveZone' in evB.recovery);
  assert.ok(!('healthInformation' in evB));
});

test('what is already beside the note is sent as such, so it is not said again', () => {
  /* The session's own Why and cue, always. */
  const a = athlete(), dd = session(a), ev = a.coachNoteEvidence(dd);
  const shown = Array.from(ev.alreadyOnScreen);
  const why = a.resolveDesc(a.coachingDisclosureFor(dd, a.athleteExperience()).why);
  const cue = a.coachingEntryFor(dd).cue;
  assert.ok(why && shown.indexOf(why) !== -1, 'the Why is not counted as on screen');
  assert.ok(cue && shown.indexOf(cue) !== -1, 'the cue is not counted as on screen');
  assert.equal(a.coachNoteValid('Heavy legs today. ' + cue, ev).why, 'duplicate');
  /* And, when Today is showing a suggested change, the reason printed on it. */
  const b = athlete({ steady: true });
  b.state.days.filter(d => d.completed).slice(-5).forEach(d => {
    const band = b.expectedRPEBand(d) || [5, 7];
    d.actual.rpe = Math.min(10, band[1] + 2);
    const z = b.executionHRTarget(d); if (z && z.hi) d.actual.hr = z.hi + 8;
    delete d.coachReview; b.coachPersistReview(d);
  });
  const pe = b.planEvolution();
  assert.equal(b.evolutionProposalVisible(pe), true, 'the strained athlete has no proposal on Today');
  const evB = b.coachNoteEvidence(session(b));
  assert.ok(evB, 'the strained athlete has no evidence');
  assert.ok(Array.from(evB.alreadyOnScreen).indexOf(String(pe.reasons[0])) !== -1, 'the reason on the proposal is not counted as on screen');
});

// ---------------------------------------------------------------------------
// THE APP: ONE LINE, ONE PLACE, AND THE ENGINE'S SENTENCE UNTIL PROVEN OTHERWISE
// ---------------------------------------------------------------------------

function online(note, o){
  const calls = [];
  const opts = o || {};
  const a = athlete({ fetch: (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) !== '/api/voice-note') return Promise.reject(new Error('network disabled'));
    if (opts.reject) return Promise.reject(new Error('offline'));
    return Promise.resolve({ ok: opts.status ? false : true, status: opts.status || 200,
                             json: async () => (opts.body || { note }) });
  } });
  signIn(a); a.voiceCoachAvailable = true;
  const noteCalls = () => calls.filter(c => c.url === '/api/voice-note');
  return { a, noteCalls };
}

test('the engine\'s sentence is on the card first; the written note takes its place, in the same place', async () => {
  const { a, noteCalls } = online(GOOD), dd = session(a);
  const engine = a.coachObservation(dd);
  assert.deepEqual(noteOnCard(a.renderDayCard(dd)), [engine]);
  const got = await a.coachNoteMaybeFetch();
  assert.equal(got, GOOD);
  assert.equal(noteCalls().length, 1);
  const sent = noteCalls()[0].init;
  assert.equal(sent.method, 'POST');
  assert.equal(sent.headers.Authorization, 'Bearer tok');
  assert.deepEqual(Object.keys(JSON.parse(sent.body)), ['evidence']);
  /* One line, where the engine's was. Never both. */
  const after = noteOnCard(a.renderDayCard(dd));
  assert.deepEqual(after, [GOOD]);
  assert.ok(a.renderDayCard(dd).indexOf(engine) === -1, 'the engine sentence is still drawn beside the written note');
  /* The engine function itself is untouched: Hear Today and the briefing still read it. */
  assert.equal(a.coachObservation(dd), engine);
});

test('it is asked once per body of evidence, not once per render', async () => {
  const { a, noteCalls } = online(GOOD);
  await a.coachNoteMaybeFetch();
  assert.equal(a.coachNoteMaybeFetch(), null);
  assert.equal(a.coachNoteMaybeFetch(), null);
  assert.equal(noteCalls().length, 1);
  /* New evidence: the old note is not shown for it, and a new one is asked for. */
  const dd = session(a);
  a.state.readiness = { date: TODAY, legs: 'heavy', sleep: 'poor', health: 'good' };
  const fresh = a.coachObservation(dd);
  assert.notEqual(fresh, JSON.parse(noteCalls()[0].init.body).evidence.engineNote);
  assert.equal(a.coachNoteText(dd), fresh, 'a note written for other evidence was shown');
  await a.coachNoteMaybeFetch();
  assert.equal(noteCalls().length, 2);
  assert.equal(JSON.parse(noteCalls()[1].init.body).evidence.engineNote, fresh);
});

test('every failure leaves the engine\'s sentence exactly where it was', async () => {
  const bad = [
    ['offline',        online(GOOD, { reject: true })],
    ['server error',   online(GOOD, { status: 502 })],
    ['no note',        online(null, { body: { note: null, code: 'declined' } })],
    ['not an object',  online(null, { body: 'nope' })],
    ['invented pace',  online('Heavy legs this morning, so hold 4:45 per km through the tempo.')],
    ['changes plan',   online('Your legs are heavy this morning, so skip the tempo and jog easily.')],
    ['repeats the card', online('Heavy legs. Build steadily, so the final third is the quickest running of the day.')],
  ];
  for (const [name, { a, noteCalls }] of bad){
    const dd = session(a), engine = a.coachObservation(dd);
    const got = await a.coachNoteMaybeFetch();
    assert.equal(got, null, name);
    assert.equal(a.coachNoteText(dd), engine, name);
    assert.deepEqual(noteOnCard(a.renderDayCard(dd)), [engine], name);
    /* And it is not asked again on the next render. */
    assert.equal(a.coachNoteMaybeFetch(), null, name);
    assert.equal(noteCalls().length, 1, name);
  }
});

test('it is not asked for when the coach is off, the athlete is signed out, offline, or elsewhere in the app', () => {
  const cases = [
    ['coach off',   x => { x.a.voiceCoachAvailable = false; }],
    ['signed out',  x => { x.a.cloudSession = null; }],
    ['offline',     x => { x.a.navigator.onLine = false; }],
    ['on the plan', x => { x.a.state.view = 'full'; }],
    ['on Coach',    x => { x.a.state.view = 'planhq'; }],
  ];
  cases.forEach(([name, set]) => {
    const x = online(GOOD); set(x);
    assert.equal(x.a.coachNoteMaybeFetch(), null, name);
    assert.equal(x.noteCalls().length, 0, name);
  });
});

test('there is a ceiling on asks in a day', async () => {
  const { a, noteCalls } = online(GOOD);
  a.localStorage.setItem(a.COACH_NOTE_KEY, JSON.stringify({ day: TODAY, count: a.COACH_NOTE_DAILY }));
  assert.equal(a.coachNoteMaybeFetch(), null);
  assert.equal(noteCalls().length, 0);
  const y = online(GOOD);
  y.a.localStorage.setItem(y.a.COACH_NOTE_KEY, JSON.stringify({ day: '2026-11-04', count: 99 }));
  await y.a.coachNoteMaybeFetch();
  assert.equal(y.noteCalls().length, 1);
  assert.equal(JSON.parse(y.a.localStorage.getItem(y.a.COACH_NOTE_KEY)).count, 1);
});

test('a stored note that no longer passes is not shown', () => {
  const { a } = online(GOOD), dd = session(a);
  const ev = a.coachNoteEvidence(dd);
  const fp = a.coachNoteHash(JSON.stringify(ev));
  const put = note => { a.coachNoteMem = null; a.localStorage.setItem(a.COACH_NOTE_KEY, JSON.stringify({ fp, note })); };
  put(GOOD);
  assert.equal(a.coachNoteText(dd), GOOD);
  put('Heavy legs this morning, so hold 4:45 per km through the tempo.');
  assert.equal(a.coachNoteText(dd), a.coachObservation(dd));
  put(GOOD); a.localStorage.setItem(a.COACH_NOTE_KEY, JSON.stringify({ fp: 'cnother', note: GOOD })); a.coachNoteMem = null;
  assert.equal(a.coachNoteText(dd), a.coachObservation(dd));
  a.localStorage.setItem(a.COACH_NOTE_KEY, '{not json'); a.coachNoteMem = null;
  assert.equal(a.coachNoteText(dd), a.coachObservation(dd));
});

test('the written note decides nothing: no engine function reads it, and it is not part of the plan', async () => {
  const { a } = online(GOOD), dd = session(a);
  const before = JSON.stringify(a.state);
  const decision = JSON.stringify(a.coachDecision()), evo = JSON.stringify(a.planEvolution().changes);
  await a.coachNoteMaybeFetch();
  assert.equal(JSON.stringify(a.state), before, 'the note was written into the plan');
  assert.equal(JSON.stringify(a.coachDecision()), decision);
  assert.equal(JSON.stringify(a.planEvolution().changes), evo);
  assert.equal(a.coachNoteText(dd), GOOD);
  /* Only the three places that draw the note read it. */
  const readers = (SRC.match(/coachNoteText\(dd\)/g) || []).length;
  assert.equal(readers, 4, 'coachNoteText is read somewhere new');   // its definition's name + three draw sites
  ['coachDecision', 'coachRecovery', 'coachBrief', 'coachObservation', 'planEvolution', 'coachReadinessLine',
   'voiceCoachContext', 'coachTrend', 'coachLoad'].forEach(n =>
    assert.ok(!/coachNote(Text|Written|Mem|Load)\b/.test(body(n)), n + ' reads the written note'));
  /* Asking is the last thing a render does, and nothing waits for it. */
  const render = body('renderApp');
  assert.match(render, /try \{ coachNoteMaybeFetch\(\); \} catch\(e\)\{\}\s*$/);
  assert.ok(!/await|\.then\(/.test(body('coachNoteText')) && !/fetch\(/.test(body('coachNoteText')));
});

test('the athlete is never told a machine wrote it, and the design is the one already there', () => {
  const { a } = online(GOOD), dd = session(a);
  const engineCard = a.renderDayCard(dd);
  a.coachNoteMem = null;
  a.localStorage.setItem(a.COACH_NOTE_KEY, JSON.stringify({ fp: a.coachNoteHash(JSON.stringify(a.coachNoteEvidence(dd))), note: GOOD }));
  const writtenCard = a.renderDayCard(dd);
  const engine = a.coachObservation(dd);
  /* Swap the sentence back and the two cards are the same markup. */
  assert.equal(writtenCard.split(a.escapeHtml ? a.escapeHtml(GOOD) : GOOD).join('#'),
               engineCard.split(a.escapeHtml ? a.escapeHtml(engine) : engine).join('#'));
  assert.ok(!/AI Analysis|AI-written|written by AI|Generated/i.test(text(writtenCard)));
});
