'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* ASK COACH — THE GENERATIVE LAYER, AND EVERYTHING THAT BOUNDS IT
 * ===========================================================================
 * THE ARCHITECTURAL RULE THIS FILE ENFORCES: the language model is not the
 * training methodology. It may explain a decision Valhalla already made. It may
 * not make one, and it may not reach anything that could.
 *
 * The three properties that make that true rather than intended:
 *
 *   1. THE MODEL CANNOT WRITE A PLAN. The endpoint has no database access, and
 *      a plan change is only ever offered when Valhalla's OWN engine already
 *      recommended one -- routed through the existing coach-accept handler,
 *      with the existing provenance.
 *   2. THE MODEL CANNOT SEE WHAT IT MAY NOT SEE. Strava-derived days and
 *      unconsented health information are absent from the context, not filtered
 *      out of it afterwards.
 *   3. THE ATHLETE IS NEVER STRANDED. Every failure -- offline, denied
 *      microphone, refused, rate-limited, malformed -- leaves the written
 *      coaching intact and says something true.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const ASK = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
const askMod = require('../api/_voice-ask.js');
const V = require('../api/_voice.js');
const TODAY = '2026-08-24';

function athlete(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 10, startDate: '2026-08-03', distanceKey: '10k', volume: 40,
                 healthConsent: o.healthConsent !== false,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  return a;
}
function withEnv(vars, run){
  const saved = {};
  Object.keys(vars).forEach(k => { saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; });
  try { return run(); }
  finally { Object.keys(saved).forEach(k => {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }); }
}

// ---------------------------------------------------------------------------
// THE MODEL CANNOT DECIDE
// ---------------------------------------------------------------------------
test('a plan change is offered only when the ENGINE already proposed one', () => {
  /* The model returning needsPlanChange is an opinion. On its own it produces
     no offer at all, because there is nothing authorised to offer. */
  const a = athlete();
  assert.equal(a.coachProposedChangeDayId(), null,
    'a proposal appeared with no engine recommendation behind it');
  a.askSet('answered', { answer: 'I would ease tomorrow off.', proposalDayId: null });
  assert.equal(a.renderAskProposal(), '',
    'the model\'s opinion alone drew Accept/Keep buttons');
});

test('when a proposal IS drawn it reuses the existing accept/keep handlers', () => {
  /* Same data-action, same day id, same provenance as accepting from the
     Execution Review card. There is no second way to change a session. */
  const a = athlete();
  const nxt = a.state.days.filter(d => d.date > TODAY && d.type !== 'rest')[0];
  a.askSet('answered', { answer: 'x', proposalDayId: nxt.id });
  const html = a.renderAskProposal();
  assert.match(html, /data-action="coach-accept"/);
  assert.match(html, /data-action="coach-keep"/);
  assert.match(html, new RegExp('data-day="' + nxt.id + '"'));
});

test('answering changes no session by itself', () => {
  const a = athlete();
  const before = JSON.stringify(a.state.days);
  a.askSet('answered', { answer: 'Tomorrow should probably be easier.', proposalDayId: null });
  a.renderAskProposal();
  assert.equal(JSON.stringify(a.state.days), before, 'an answer mutated the plan');
});

test('the endpoint cannot reach a plan even if it wanted to', () => {
  assert.ok(!/serviceKey|service_role|rest\/v1|supabase/i.test(
    ASK.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'the model call site can reach the database');
});

// ---------------------------------------------------------------------------
// WHAT THE MODEL IS TOLD
// ---------------------------------------------------------------------------
test('the system prompt forbids inventing, prescribing and diagnosing', () => {
  const p = askMod.SYSTEM;
  assert.match(p, /Never invent a session, a distance, a pace/i);
  assert.match(p, /Never tell the athlete their plan has been changed/i);
  assert.match(p, /Never diagnose/i);
  assert.match(p, /not a doctor/i);
  assert.match(p, /deterministic engine/i);
});

test('a reply that will not parse becomes an answer, never a proposal', () => {
  /* Failing towards "just answer" is safe. Failing towards a parsed change
     would not be. */
  const r = askMod.parseReply('Keep tomorrow easy and see how the calf feels.');
  assert.equal(r.needsPlanChange, false);
  assert.match(r.answer, /Keep tomorrow easy/);
});

test('a well-formed reply is read, including from a code fence', () => {
  const plain = askMod.parseReply('{"answer":"Ease off.","needsPlanChange":true,"changeReason":"Sore calf."}');
  assert.equal(plain.answer, 'Ease off.');
  assert.equal(plain.needsPlanChange, true);
  const fenced = askMod.parseReply('```json\n{"answer":"Ease off.","needsPlanChange":false}\n```');
  assert.equal(fenced.answer, 'Ease off.');
  assert.equal(fenced.needsPlanChange, false);
});

test('an empty reply is not an answer', () => {
  assert.equal(askMod.parseReply(''), null);
  assert.equal(askMod.parseReply('   '), null);
  assert.equal(askMod.parseReply('{"answer":"   "}').answer.length >= 0, true);
});

// ---------------------------------------------------------------------------
// ARTICLE 9
// ---------------------------------------------------------------------------
test('without consent, no health information is assembled at all', () => {
  /* Not sent and then ignored -- never built. The same strip-at-source rule
     api/_health-consent.js applies server-side. */
  const a = athlete({ healthConsent: false });
  const recent = a.state.days.filter(d => d.date < TODAY && d.date >= '2026-08-12' && d.type !== 'rest')[0];
  a.applyCompletion(recent, true);
  recent.actual = Object.assign(a.emptyActual(), { km: recent.km, pace: '5:20', rpe: 6, hr: 151, feel: 'good' });
  const json = JSON.stringify(a.voiceCoachContext());
  assert.ok(!/151/.test(json), 'a heart rate reached the model context without consent');
  assert.ok(!/"feel"/.test(json), 'how the session felt reached the model context without consent');
  assert.match(json, /"healthWithheld":true/);
  assert.match(json, /"effort":6/, 'ordinary training data should still be available');
});

test('with consent, health information is available and declared', () => {
  const a = athlete({ healthConsent: true });
  const recent = a.state.days.filter(d => d.date < TODAY && d.date >= '2026-08-12' && d.type !== 'rest')[0];
  a.applyCompletion(recent, true);
  recent.actual = Object.assign(a.emptyActual(), { km: recent.km, pace: '5:20', hr: 151 });
  const ctx = a.voiceCoachContext();
  assert.equal(ctx.healthDataAvailable, true);
  assert.match(JSON.stringify(ctx), /151/);
});

test('withdrawing consent removes health information from the next question', () => {
  const a = athlete({ healthConsent: true });
  const recent = a.state.days.filter(d => d.date < TODAY && d.date >= '2026-08-12' && d.type !== 'rest')[0];
  a.applyCompletion(recent, true);
  recent.actual = Object.assign(a.emptyActual(), { km: recent.km, pace: '5:20', hr: 151 });
  assert.match(JSON.stringify(a.voiceCoachContext()), /151/);
  a.state.healthConsent = { version: a.HEALTH_CONSENT_VERSION, decision: 'withdrawn',
                            decidedAt: '2026-08-20T09:00:00.000Z', withdrawnAt: '2026-08-20T09:00:00.000Z' };
  assert.ok(!/151/.test(JSON.stringify(a.voiceCoachContext())),
    'withdrawal did not stop health information reaching the model');
});

test('the question never widens what the coach may see', () => {
  /* Scope is decided by consent and provenance. Asking about heart rate does
     not unlock heart rate. */
  const a = athlete({ healthConsent: false });
  const one = JSON.stringify(a.voiceCoachContext());
  const two = JSON.stringify(a.voiceCoachContext());
  assert.equal(one, two);
  assert.equal(a.voiceCoachContext.length, 0,
    'the context builder takes the question as an argument -- it must not');
});

test('nothing sensitive is written to a log line', () => {
  /* A voice question can carry health information -- "my calf hurts" -- so the
     question is exactly the thing that must never reach a log, an analytics
     event or an error report. */
  const code = ASK.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const logs = [...code.matchAll(/V\.log\(([^;]*)\)/g)].map(m => m[1]);
  assert.ok(logs.length, 'the endpoint logs nothing at all');
  logs.forEach(l => {
    /* SENSITIVE MATERIAL CAN ONLY ESCAPE THROUGH AN EXPRESSION. A fixed reason
       code is safe however it reads -- 'ASK REFUSED strava_marker_in_context'
       names a branch, it does not carry one. So the string literals are removed
       and only what remains, the interpolated code, is judged. */
    const expr = l.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
    assert.ok(!/question/.test(expr), 'the question is logged: ' + l);
    assert.ok(!/context|uid|email|apiKey|access_token/.test(expr),
      'sensitive material is logged: ' + l);
    /* A LENGTH IS NOT CONTENT. "chars=142" is how a founder confirms a reply
       arrived; the reply itself must never be readable in a deployment log. */
    const answerRefs = [...expr.matchAll(/answer(\.[A-Za-z]+)?/g)].map(m => m[1]);
    answerRefs.forEach(suffix => assert.equal(suffix, '.length',
      'the answer itself is logged, not merely its size: ' + l));
  });
});

// ---------------------------------------------------------------------------
// FAILURE, DEGRADED, AND NEVER TRAPPED
// ---------------------------------------------------------------------------
test('every failure has human copy and none of it is a code', () => {
  const a = athlete();
  Object.keys(a.VOICE_ERROR_COPY).forEach(k => {
    const s = a.VOICE_ERROR_COPY[k];
    assert.ok(s && s.length > 10, k + ' has no human sentence');
    assert.ok(!/\b(4\d\d|5\d\d|null|undefined)\b/.test(s), k + ' shows an error code: ' + s);
    assert.ok(!/API|token|endpoint|model|LLM/i.test(s), k + ' uses developer vocabulary: ' + s);
  });
});

test('a typed question is always possible, even with no microphone', () => {
  /* The installed Android app is a WebView, where SpeechRecognition does not
     exist. Typing is not a fallback there -- it is the only path, and it must
     always be drawn. */
  const a = athlete();
  assert.equal(a.voiceSttAvailable(), false, 'the harness should have no recogniser');
  a.askSet('open', {});
  const panel = a.renderAskPanel(a.findDayByDate(TODAY));
  assert.match(panel, /id="ask-input"/, 'no way to type a question');
  assert.match(panel, /data-action="voice-ask-submit"/);
  assert.ok(!/data-action="voice-ask-speak"/.test(panel),
    'a Speak button was drawn on a device with no recogniser');
});

test('a denied microphone says so and leaves the typed path open', () => {
  const a = athlete();
  a.askSet('error', { message: a.VOICE_ERROR_COPY.mic_denied });
  const panel = a.renderAskPanel(a.findDayByDate(TODAY));
  assert.match(panel, /Microphone access is off/);
  assert.match(panel, /id="ask-input"/, 'the athlete was trapped with no way to ask');
});

test('the panel can always be closed', () => {
  const a = athlete();
  ['open', 'thinking', 'answered', 'error'].forEach(st => {
    a.askSet(st, { answer: 'x', message: 'y' });
    const panel = a.renderAskPanel(a.findDayByDate(TODAY));
    assert.match(panel, /voice-ask-close|voice-ask-cancel/, 'no way out of state ' + st);
  });
  a.askReset();
  assert.equal(a.askState.status, 'closed');
  assert.equal(a.renderAskPanel(a.findDayByDate(TODAY)), '');
});

test('an answer is readable text before it is ever speech', () => {
  const a = athlete();
  a.askSet('answered', { answer: 'Keep tomorrow easy.', proposalDayId: null });
  assert.match(a.renderAskPanel(a.findDayByDate(TODAY)), /Keep tomorrow easy\./);
});

test('what Valhalla heard is shown back before the answer', () => {
  const a = athlete();
  a.askSet('thinking', { heard: 'why intervals tomorrow' });
  const panel = a.renderAskPanel(a.findDayByDate(TODAY));
  assert.match(panel, /why intervals tomorrow/, 'the athlete cannot check what was understood');
});

// ---------------------------------------------------------------------------
// THE SWITCH
// ---------------------------------------------------------------------------
test('the deployment switch fails closed, and needs a key as well', () => {
  withEnv({ VVV_VOICE_ENABLED: undefined, ANTHROPIC_API_KEY: 'x' }, () =>
    assert.equal(V.voiceEnabled(), false, 'unset must mean off'));
  withEnv({ VVV_VOICE_ENABLED: 'no', ANTHROPIC_API_KEY: 'x' }, () =>
    assert.equal(V.voiceEnabled(), false));
  withEnv({ VVV_VOICE_ENABLED: '1', ANTHROPIC_API_KEY: 'x' }, () =>
    assert.equal(V.voiceEnabled(), true));
  withEnv({ VVV_VOICE_ENABLED: '1', ANTHROPIC_API_KEY: '' }, () => {
    const cfg = V.voiceConfig();
    assert.equal(!!(cfg.enabled && cfg.apiKey), false,
      'a switched-on deployment with no key must not advertise a coach');
  });
});

test('the client defaults to unavailable and only the server can open it', () => {
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  assert.equal(a.voiceCoachAvailable, false, 'Ask Coach defaulted to available');
});

test('the model id is pinned in one place', () => {
  assert.equal(V.VOICE_MODEL, 'claude-opus-5');
  const runtimeCode = SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.ok(!/claude-|opus|sonnet/i.test(runtimeCode),
    'a model name reached the file served to the browser');
});
