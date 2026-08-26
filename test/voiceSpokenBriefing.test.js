'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

const V = require('../api/_voice.js');
const A = require('../api/_voice-ask.js');
const B = require('../api/_voice-brief.js');

/* SAID, RATHER THAN READ.
 * ===========================================================================
 * LISTEN used to speak the written card. voiceSpeakable() made it
 * PRONOUNCEABLE -- "4:09/km" became "4 minutes 9 seconds per kilometre" -- but
 * it never rephrased, so what the athlete heard was written prose read aloud.
 *
 * THE TWO THINGS THIS FILE HOLDS, and they pull in opposite directions:
 *
 *   1. The spoken phrasing must be a rephrasing of the SAME coaching. It may
 *      condense, join and rephrase. It may never introduce a number the
 *      engine did not say -- enforced by a guard, not by a prompt.
 *   2. LISTEN must keep every guarantee it already had: instant, offline, no
 *      model, no key, no network. The phrasing is prepared BEFORE the press
 *      and is never something the press waits for.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';

// ---------------------------------------------------------------------------
// THE GUARD — a paraphrase cannot change the prescription
// ---------------------------------------------------------------------------
test('a reply that invents a number is rejected', () => {
  const written = 'Run 8 kilometres at 5 minutes 12 seconds per kilometre.';
  assert.equal(B.inventsNumber(written, 'Keep it to 8 km at 4 minutes 30.'), true,
    'a pace the coach never said was allowed through');
  assert.equal(B.inventsNumber(written, 'Eight k, and hold 5 minutes 12.'), false,
    'a faithful rephrasing was rejected');
});

test('dropping a number is condensing, and repeating one is emphasis', () => {
  const written = 'Run 8 kilometres at 5 minutes 12 seconds. Heart rate 150.';
  assert.equal(B.inventsNumber(written, 'Eight k, relaxed.'), false,
    'condensing must be allowed -- it is the whole job');
  assert.equal(B.inventsNumber(written, '8 km. Really, 8 km, no faster.'), false,
    'repeating an existing number is not invention');
  assert.equal(B.inventsNumber(written, 'Run 8 km and keep it under 160.'), true,
    'a heart rate the coach never said was allowed through');
});

test('the guard reads digits wherever they sit', () => {
  assert.equal(B.inventsNumber('a 10k next Sunday', 'the 10k on Sunday'), false);
  assert.equal(B.inventsNumber('a 10k next Sunday', 'the 10k, about 42 minutes'), true,
    'a predicted time is exactly the kind of number this must stop');
});

// ---------------------------------------------------------------------------
// THE SERVER
// ---------------------------------------------------------------------------
function mkRes(){
  const out = { status: 0, body: null, headers: {} };
  return {
    out,
    setHeader(k, v){ out.headers[k] = v; },
    status(n){ out.status = n; return this; },
    send(s){ try { out.body = JSON.parse(s); } catch(e){ out.body = s; } },
  };
}
const LINES = ['Today is about banking aerobic time cheaply.',
               'Run 8 kilometres at 5 minutes 12 seconds per kilometre.',
               'Save the hard running for the sessions built for it.'];

/* The module seams are stubbed rather than the network, so these tests make no
   request of any kind and cannot pass or fail on connectivity. */
async function callBrief(opts){
  const o = opts || {};
  const realCfg = V.voiceConfig, realVerify = V.verifyUser, realPost = A.postModel;
  V.voiceConfig = () => ({
    enabled: o.enabled !== false,
    apiKey: o.apiKey === undefined ? 'k' : o.apiKey,
    model: 'claude-opus-5',
  });
  V.verifyUser = async () => (o.uid === null ? { uid: null, code: 'NO_TOKEN' } : { uid: 'u1' });
  let sent = 0;
  A.postModel = async (cfg, payload) => {
    sent++;
    if (o.throws) throw new Error('unreachable');
    if (o.status && o.status !== 200)
      return { ok: false, status: o.status, json: async () => ({ error: { type: 'invalid_request_error' } }) };
    return { ok: true, status: 200, json: async () => ({
      stop_reason: o.stopReason || 'end_turn',
      usage: { output_tokens: 40 },
      content: o.content !== undefined ? o.content
             : [{ type: 'text', text: o.reply || 'Keep this one easy. Eight k at 5 minutes 12, relaxed.' }],
    }) };
  };
  const res = mkRes();
  try {
    await B.handle({ method: 'POST', body: { lines: o.lines || LINES, level: o.level || 'full' } }, res);
  } finally {
    V.voiceConfig = realCfg; V.verifyUser = realVerify; A.postModel = realPost;
  }
  return { res: res.out, sent };
}

test('a faithful rephrasing is returned and marked spoken', async () => {
  const { res } = await callBrief({});
  assert.equal(res.status, 200);
  assert.equal(res.body.spoken, true);
  assert.ok(res.body.lines.length, 'no lines came back');
  assert.ok(res.body.lines.join(' ').length < LINES.join(' ').length,
    'the spoken form should be shorter than the written one');
});

test('a reply that invents a pace is discarded and the written lines are spoken', async () => {
  const { res } = await callBrief({ reply: 'Keep it easy. Hold 4 minutes 30 per kilometre.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.spoken, false, 'an invented pace was accepted');
  assert.deepEqual(res.body.lines, LINES, 'the written briefing must survive intact');
});

test('an unconfigured deployment speaks the written briefing and asks nothing', async () => {
  const { res, sent } = await callBrief({ apiKey: '' });
  assert.equal(res.status, 200);
  assert.equal(res.body.spoken, false);
  assert.deepEqual(res.body.lines, LINES);
  assert.equal(sent, 0, 'a request was made with no key configured');
});

test('voice switched off speaks the written briefing and asks nothing', async () => {
  const { res, sent } = await callBrief({ enabled: false });
  assert.equal(res.body.spoken, false);
  assert.deepEqual(res.body.lines, LINES);
  assert.equal(sent, 0);
});

test('every upstream failure ends at the written briefing, never at silence', async () => {
  for (const bad of [{ throws: true }, { status: 400 }, { status: 500 },
                     { stopReason: 'refusal' }, { content: [] },
                     { content: [{ type: 'thinking', thinking: '' }] }]) {
    const { res } = await callBrief(bad);
    assert.equal(res.status, 200, 'a failure reached the athlete as an error: ' + JSON.stringify(bad));
    assert.equal(res.body.spoken, false);
    assert.deepEqual(res.body.lines, LINES);
  }
});

test('a signed-out caller is refused', async () => {
  const { res, sent } = await callBrief({ uid: null });
  assert.equal(res.status, 401);
  assert.equal(sent, 0, 'an unauthenticated request reached the model');
});

test('lines carrying a Strava marker are refused, not cleaned', async () => {
  const { res, sent } = await callBrief({
    lines: ['Your run', 'stravaActivityId 12345 came in'],
  });
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'STRAVA_DERIVED_CONTEXT');
  assert.equal(sent, 0, 'a Strava marker reached the model');
});

test('the spoken layer opens no second model call site', () => {
  const ENDPOINT = /api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis/i;
  const src = fs.readFileSync(path.join(ROOT, 'api', '_voice-brief.js'), 'utf8');
  assert.ok(!ENDPOINT.test(src), 'the spoken layer names a model endpoint of its own');
  assert.ok(!/serviceKey|service_role|rest\/v1/.test(src),
    'the spoken layer can reach the database');
});

// ---------------------------------------------------------------------------
// THE CLIENT — LISTEN keeps every guarantee it had
// ---------------------------------------------------------------------------
function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  a.window.Capacitor = { isNativePlatform: () => true };
  return a;
}
const today = a => a.findDayByDate(TODAY);

test('LISTEN still needs no model, no key and no network', () => {
  const a = app();
  a.fetch = () => { throw new Error('LISTEN must not reach the network'); };
  if (a.window) a.window.fetch = a.fetch;
  const dd = today(a);
  const script = a.voiceScriptFor(dd);
  assert.ok(script && script.lines.length);
  a.handleVoiceListen(dd.id);
  assert.match(a.renderVoiceCard(dd), /voice-said/, 'the words never appeared');
});

test('with nothing prepared, LISTEN speaks the written lines', () => {
  const a = app();
  const dd = today(a);
  const script = a.voiceScriptFor(dd);
  assert.deepEqual(a.voiceLinesToSpeak(script, dd.id), script.lines);
});

test('with a phrasing prepared, LISTEN speaks that instead', () => {
  const a = app();
  const dd = today(a);
  const script = a.voiceScriptFor(dd);
  const spoken = ['Keep this one easy today.'];
  a.voiceSpokenCache[a.voiceSpokenCacheKey(script, dd.id)] = spoken;
  assert.deepEqual(a.voiceLinesToSpeak(script, dd.id), spoken);
});

test('an empty prepared phrasing falls back rather than speaking nothing', () => {
  const a = app();
  const dd = today(a);
  const script = a.voiceScriptFor(dd);
  a.voiceSpokenCache[a.voiceSpokenCacheKey(script, dd.id)] = [];
  assert.deepEqual(a.voiceLinesToSpeak(script, dd.id), script.lines);
});

test('the narration half contains no fetch and no endpoint', () => {
  /* The whole reason the prepare step lives in the context layer. */
  const region = SRC.slice(SRC.indexOf('THE VOICE COACH — NARRATION'),
                           SRC.indexOf('ASK COACH — THE CONTEXT LAYER'));
  assert.ok(!/fetch\(/.test(region), 'the on-device half makes a network call');
  assert.ok(!/\/api\//.test(region), 'the on-device half names an endpoint');
});

// ---------------------------------------------------------------------------
// PREPARING IT — who is asked about, and who is never asked about
// ---------------------------------------------------------------------------
function prefetchApp(opts){
  const o = opts || {};
  const a = app();
  a.calls = [];
  a.fetch = (url, init) => {
    a.calls.push(String(url));
    return Promise.resolve({ ok: true, status: 200,
      json: () => Promise.resolve({ spoken: true, lines: ['Keep it easy.'] }) });
  };
  if (a.window) a.window.fetch = a.fetch;
  a.voiceSetAvailable(o.available !== false);
  if (o.signedIn !== false)
    a.cloudSession = { access_token: 't', refresh_token: 'r',
                       expires_at: Date.now() + 3600000, user_id: 'u1' };
  return a;
}
const briefCalls = a => a.calls.filter(u => u.indexOf('/api/voice-brief') !== -1).length;

test('a Strava-derived day is never sent to be rephrased', async () => {
  const a = prefetchApp();
  const dd = today(a);
  dd.stravaActivityId = 'S1';
  await a.voicePrefetchSpoken(dd);
  assert.equal(briefCalls(a), 0, 'a Strava-derived day was sent to a model');
});

test('nothing is prepared while signed out', async () => {
  const a = prefetchApp({ signedIn: false });
  await a.voicePrefetchSpoken(today(a));
  assert.equal(briefCalls(a), 0);
});

test('nothing is prepared on a deployment with no coach', async () => {
  const a = prefetchApp({ available: false });
  await a.voicePrefetchSpoken(today(a));
  assert.equal(briefCalls(a), 0);
});

test('it is prepared once, and a second open costs nothing', async () => {
  const a = prefetchApp();
  const dd = today(a);
  assert.equal(await a.voicePrefetchSpoken(dd), true);
  assert.equal(briefCalls(a), 1);
  assert.equal(await a.voicePrefetchSpoken(dd), true);
  assert.equal(briefCalls(a), 1, 'the same briefing was paid for twice');
});

test('a failed prepare leaves LISTEN exactly as it was', async () => {
  const a = prefetchApp();
  a.fetch = () => Promise.reject(new TypeError('offline'));
  if (a.window) a.window.fetch = a.fetch;
  const dd = today(a);
  const script = a.voiceScriptFor(dd);
  assert.equal(await a.voicePrefetchSpoken(dd), false);
  assert.deepEqual(a.voiceLinesToSpeak(script, dd.id), script.lines);
});
