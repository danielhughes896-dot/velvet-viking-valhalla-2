'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness.js');

/* "PREPARING VOICE…" MUST NEVER BE A PLACE THE APP CAN STOP
 * ===========================================================================
 * The card renders that line in exactly one state -- speaking/preparing -- and
 * that state was set in exactly one place: voiceCloudSpeak(), immediately
 * before
 *
 *     ttsFetchAudio(key, text, voiceKey).then(play, fail)
 *
 * BOTH routes out of preparing hang off that one promise. It carried an
 * AbortController from the day it was written and nothing ever fired it except
 * the Stop button, so on a stalled radio -- where fetch() in an Android WebView
 * does not time out on its own -- the promise stayed pending, neither handler
 * ran, and the athlete watched "Preparing voice…" having already read the whole
 * answer.
 *
 * These tests assert the property rather than the fix: every way of leaving
 * preparing is terminal, and the words survive all of them.
 */

/* A clock the test drives. The app reads setTimeout from its own sandbox, so
   this is the real scheduling path with the waiting removed. */
function appWithClock(){
  const a = loadApp({});
  const timers = [];
  a.setTimeout = (fn, ms) => { timers.push({ fn, ms, id: timers.length + 1 }); return timers.length; };
  a.clearTimeout = (id) => { const t = timers[id - 1]; if (t) t.cancelled = true; };
  a.patchVoiceCard = () => {};
  a.cloudSignedIn = () => true;
  /* A signed-in athlete with a live session. Without this the real
     cloudRefreshIfNeeded() reads a null session and rejects asynchronously --
     the fixture's fault, not the app's, but it lands as an unhandled rejection
     after the test has ended and hides whatever the test was actually saying. */
  a.cloudSession = { access_token:'test-token', expires_at: Math.floor(Date.now()/1000) + 3600 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  a.fetch = () => new Promise(() => {});   /* nothing real ever leaves the test */
  a.fire = (ms) => {
    timers.filter(t => !t.cancelled && !t.fired && t.ms <= ms).forEach(t => { t.fired = true; t.fn(); });
  };
  a.pending = () => timers.filter(t => !t.cancelled && !t.fired).length;
  a.timers = timers;
  return a;
}
/* voiceCloudSpeak with a controllable upstream. */
function speaking(a, upstream){
  a.ttsCloudDown = false;
  a.ttsInflight = {};
  a.ttsFetchAudio = upstream;
  a.voiceCloudSpeak('Keep tomorrow easy.', { kind:'answer' });
  return a.voiceState;
}
const never = () => new Promise(() => {});
const settled = { resolve: (v) => () => Promise.resolve(v),
                  reject:  (e) => () => Promise.reject(e || new Error('x')) };

// ---------------------------------------------------------------------------
// 1. THE BUG
// ---------------------------------------------------------------------------

test('a request that never settles no longer strands the card in preparing', () => {
  const a = appWithClock();
  const st = speaking(a, never);
  assert.equal(st.status, 'speaking');
  assert.equal(st.phase, 'preparing', 'the fixture does not reproduce the stuck state');
  /* Before the watchdog this was the end of the story. */
  a.voiceSpeakNative = () => false;      // nothing else can speak either
  a.fire(a.VOICE_PREPARING_MAX_MS);
  assert.notEqual(a.voiceState.phase, 'preparing',
    '"Preparing voice…" is still on screen after the watchdog bound');
  assert.equal(a.voiceState.status, 'unavailable');
});

test('the watchdog prefers the device voice over silence', () => {
  const a = appWithClock();
  speaking(a, never);
  let spokeWith = null;
  a.voiceSpeakNative = (t) => { spokeWith = t; a.voiceSetStatus('speaking', { kind:'answer' }); return true; };
  a.fire(a.VOICE_PREPARING_MAX_MS);
  assert.equal(spokeWith, 'Keep tomorrow easy.',
    'the watchdog gave up without trying the device voice');
  assert.equal(a.voiceState.phase, 'playing');
});

test('the request itself is bounded, and the bound comes from the server', () => {
  /* api/_voice-tts.js gives its own upstream 8000ms and then answers with an
     error, so past that plus transit the browser is waiting for a response
     nobody is producing. The client bound must sit above the server's, and the
     watchdog above the client's -- otherwise the outer guard fires first and
     the inner ones never get to do their more specific job. */
  const server = require('../api/_voice-tts.js').TTS_TIMEOUT_MS;
  const a = loadApp({});
  assert.equal(server, 8000);
  assert.ok(a.TTS_CLIENT_TIMEOUT_MS > server,
    'the browser gives up before the server does');
  assert.ok(a.VOICE_PREPARING_MAX_MS > a.TTS_CLIENT_TIMEOUT_MS,
    'the watchdog fires before the request bound, so the request bound is dead code');
  assert.ok(a.TTS_CLIENT_TIMEOUT_MS <= server + 5000,
    'the client bound is far longer than the server behaviour justifies');
});

// ---------------------------------------------------------------------------
// 2. EVERY OTHER WAY OUT IS TERMINAL TOO
// ---------------------------------------------------------------------------

test('a rejected request leaves preparing, and says why there was no sound', async () => {
  /* THE LANDING STATE MOVED, AND THE BROWSER RUN IS WHY. This used to assert
     `shown` -- the state a briefing reaches once it has been read ALOUD and
     finished. So a press that produced eleven seconds of waiting and then
     silence was presented as though the coach had spoken, which live reads as
     the app ignoring the button. `unavailable` renders the same transcript and
     adds one quiet line. The words are identical either way. */
  const a = appWithClock();
  a.voiceSpeakNative = () => false;
  speaking(a, settled.reject({ code:'tts_unavailable' }));
  await new Promise(r => setImmediate(r));
  assert.notEqual(a.voiceState.phase, 'preparing');
  assert.equal(a.voiceState.status, 'unavailable',
    'silence is being presented as a completed briefing');
});

test('a rejected request still speaks when the device can', async () => {
  const a = appWithClock();
  let spoke = false;
  a.voiceSpeakNative = () => { spoke = true; a.voiceSetStatus('speaking', { kind:'answer' }); return true; };
  speaking(a, settled.reject({ code:'tts_unavailable' }));
  await new Promise(r => setImmediate(r));
  assert.equal(spoke, true, 'the device voice was not tried before giving up');
  assert.notEqual(a.voiceState.status, 'unavailable',
    'gave up despite a working device voice');
});

test('a synchronous throw inside the speech path leaves preparing', () => {
  const a = appWithClock();
  a.voiceSpeakNative = () => false;
  let threw = false;
  try { speaking(a, () => { throw new Error('boom'); }); }
  catch(e){ threw = true; }
  /* Whether it throws or not, it must not be left preparing with a live
     watchdog as the only escape -- and if it is, the watchdog is that escape. */
  if (a.voiceState.phase === 'preparing'){
    a.fire(a.VOICE_PREPARING_MAX_MS);
    assert.notEqual(a.voiceState.phase, 'preparing',
      'a synchronous throw strands the card' + (threw ? ' (and propagated)' : ''));
  }
});

test('audio that resolves but cannot play leaves preparing', async () => {
  const a = appWithClock();
  a.voiceSpeakNative = () => false;
  a.window.Audio = function(){ throw new Error('no codec'); };
  speaking(a, settled.resolve('blob:x'));
  await Promise.resolve(); await Promise.resolve();
  assert.notEqual(a.voiceState.phase, 'preparing');
});

test('Stop leaves preparing immediately and cancels the watchdog', () => {
  const a = appWithClock();
  speaking(a, never);
  assert.equal(a.voiceState.phase, 'preparing');
  a.handleVoiceStopPress();
  assert.equal(a.voiceState.status, 'shown', 'Stop did not reach a terminal state');
  assert.equal(a.pending(), 0, 'Stop left the watchdog armed');
});

test('a new ask supersedes the old speech and its watchdog', () => {
  const a = appWithClock();
  speaking(a, never);
  const firstToken = a.ttsToken;
  speaking(a, never);                       // a second press
  assert.ok(a.ttsToken > firstToken, 'the token did not advance');
  /* The first watchdog, if it ever fires, must do nothing. */
  a.voiceSpeakNative = () => { throw new Error('the stale watchdog spoke'); };
  a.voicePreparingTimedOut(firstToken, {});
  assert.equal(a.voiceState.phase, 'preparing', 'a stale watchdog changed live state');
});

test('a late callback cannot put the card back into preparing', () => {
  /* THE STALE-STATE TRAP. A superseded request resolving after a newer one has
     finished must not repaint the old status. */
  const a = appWithClock();
  speaking(a, never);
  const stale = a.ttsToken;
  a.ttsHalt();
  a.voiceSetStatus('shown', { kind:'answer' });
  a.voicePreparingTimedOut(stale, {});
  assert.equal(a.voiceState.status, 'shown');
  assert.notEqual(a.voiceState.phase, 'preparing');
});

// ---------------------------------------------------------------------------
// 3. THE TEXT IS THE PRODUCT
// ---------------------------------------------------------------------------

test('speech failure never touches the answer or the plan decision', () => {
  const a = appWithClock();
  a.askState = { status:'answered', heard:'Q', answer:'The full coaching answer.',
                 message:'', proposalDayId:'d-7', incomplete:false };
  const before = JSON.stringify(a.askState);
  speaking(a, never);
  a.voiceSpeakNative = () => false;
  a.fire(a.VOICE_PREPARING_MAX_MS);
  assert.equal(JSON.stringify(a.askState), before,
    'a speech failure changed the answer or the plan-change state');
  assert.equal(a.askState.proposalDayId, 'd-7', 'the proposal was withdrawn by a TTS failure');
  assert.equal(a.askState.incomplete, false, 'the answer was marked incomplete by a TTS failure');
  assert.match(a.renderAskPanel(), /The full coaching answer\./,
    'the answer disappeared when speech failed');
});

test('a speech failure never re-asks the model', () => {
  const a = appWithClock();
  let asks = 0;
  a.voiceAskCoach = () => { asks++; return Promise.resolve(null); };
  speaking(a, never);
  a.voiceSpeakNative = () => false;
  a.fire(a.VOICE_PREPARING_MAX_MS);
  assert.equal(asks, 0, 'a speech failure triggered another model request');
});

test('the unavailable state keeps the transcript and says one quiet thing', () => {
  const a = loadApp({ pinnedDate: '2026-08-27T09:00:00Z' });
  a.voiceState = { status:'unavailable', kind:'answer', dayId:null, phase:'playing' };
  a.voiceScriptFor = () => ({ kind:'briefing', lines:['The coaching still stands.'] });
  a.voiceMayRender = () => true;
  a.voiceAvailable = () => true;
  const html = a.renderVoiceCardBody({ id:'d1', date:a.todayStr(), type:'easy', km:8 });
  assert.match(html, /The coaching still stands\./, 'the transcript vanished');
  assert.match(html, /class="voice-silent" role="status" aria-live="polite"/,
    'the unavailable state is not announced');
  assert.match(html, /Voice unavailable/);
  /* Never technical, never alarming. */
  assert.ok(!/error|failed|timeout|abort|codec|network/i.test(
    /class="voice-silent"[^>]*>([^<]*)</.exec(html)[1]), 'raw failure detail reached the athlete');
  assert.ok(!/Preparing voice/.test(html), 'still claiming to be preparing');
});

// ---------------------------------------------------------------------------
// 4. THE REQUEST LAYER
// ---------------------------------------------------------------------------

test('every in-flight request is cancellable, not just the newest', () => {
  /* ttsAbort was one global overwritten by whichever request started last, so
     with two generations in flight Stop aborted only the newer one and the
     older ran to completion -- and kept billing. */
  const a = loadApp({});
  const aborted = [];
  a.ttsAborts = [{ abort(){ aborted.push('first'); } }, { abort(){ aborted.push('second'); } }];
  a.ttsAbort = null;
  a.ttsHalt();
  assert.deepEqual(aborted.sort().join(','), 'first,second',
    'Stop left an in-flight generation running');
  assert.equal(a.ttsAborts.length, 0);
});

test('clearing the cache cancels rather than orphans in-flight work', () => {
  const a = loadApp({});
  let cancelled = 0;
  a.ttsAborts = [{ abort(){ cancelled++; } }];
  a.ttsInflight = { k: Promise.resolve('x') };
  a.ttsCacheClear();
  assert.equal(cancelled, 1,
    'the in-flight map was emptied while a request was still running -- the next ' +
    'caller would start a second billable generation for the same key');
  assert.deepEqual(Object.keys(a.ttsInflight).length, 0);
});

test('the streaming work is untouched by this pass', () => {
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  /* The speech layer and the answer layer are separate stages, and this bug was
     entirely in the first. */
  assert.match(src, /function askReadStream\(resp\)/);
  assert.match(src, /id="ask-answer-announce"/);
  assert.match(src, /d\.needsPlanChange && d\.complete !== false/);
  assert.ok(src.indexOf('###VALHALLA_TRAILER###') === -1);
});

// ---------------------------------------------------------------------------
// 5. ANDROID
// ---------------------------------------------------------------------------

test('a wedged Android voice list cannot strand the card in "playing"', async () => {
  /* THE SECOND UNBOUNDED WAIT, one state further along. voiceSpeakNative()
     sets the card to `speaking` and returns true -- claiming the press --
     BEFORE awaiting getSupportedVoices(). Android's TextToSpeech engine can be
     wedged rather than broken, in which case that call never answers, and the
     card read "Playing briefing…" with no sound and no escape. The preparing
     watchdog does not cover it, because this is not preparing. */
  const a = appWithClock();
  a.voiceNativeResolved = false;
  a.voiceNativeVoice = null;
  let spoken = null;
  a.nativePlugin = (n) => (n === 'TextToSpeech' ? {
    getSupportedVoices: () => new Promise(() => {}),      // never answers
    speak: (req) => { spoken = req; return Promise.resolve(); }
  } : null);

  const ok = a.voiceSpeakNative('Keep tomorrow easy.', { kind:'answer' });
  assert.equal(ok, true, 'the native path declined the press');
  assert.equal(spoken, null, 'it spoke before the voice list was resolved');

  a.fire(a.NATIVE_VOICE_LIST_TIMEOUT_MS);
  /* setImmediate rather than a fixed number of microtask turns: the timeout
     resolves a race, which chains through voiceResolveNativeVoice's handler
     and then voiceSpeakNative's, and counting hops is how a test like this
     becomes flaky the moment one is added. */
  await new Promise(r => setImmediate(r));
  assert.ok(spoken, 'a wedged voice list stopped the briefing being spoken at all');
  assert.equal(spoken.text, 'Keep tomorrow easy.');
  assert.ok(!('voice' in spoken),
    'a timed-out enumeration should fall back to the platform default voice');
});

test('the enumeration bound is short, because it is a local list not a request', () => {
  const a = loadApp({});
  assert.ok(a.NATIVE_VOICE_LIST_TIMEOUT_MS <= 3000,
    'enumerating local voices is being given network-scale patience');
  assert.ok(a.NATIVE_VOICE_LIST_TIMEOUT_MS < a.TTS_CLIENT_TIMEOUT_MS,
    'the local list is given longer than a network request');
});

test('speech itself is deliberately not bounded', () => {
  /* A briefing legitimately takes half a minute to read aloud. A timer long
     enough not to cut real coaching off would be too long to be worth having,
     so speak() is left alone -- and this records that as a decision rather
     than an oversight, so it is not "fixed" later by someone pattern-matching
     the other two bounds. */
  const fs = require('fs');
  const path = require('path');
  const { RUNTIME_RELATIVE } = require('./harness.js');
  const src = fs.readFileSync(path.join(__dirname, '..', RUNTIME_RELATIVE), 'utf8');
  const fn = /function voiceSpeakNative\([\s\S]*?\n\}/.exec(src);
  assert.ok(fn, 'voiceSpeakNative is gone');
  assert.ok(!/setTimeout/.test(fn[0]),
    'a timer was added around speech itself -- it will cut off a real briefing');
});

test('a device with no speech route at all still keeps the words', () => {
  const a = appWithClock();
  a.nativePlugin = () => null;
  a.window.speechSynthesis = null;
  assert.equal(a.voiceSpeakNative('Anything.', {}), false,
    'a device with no synthesiser claimed it could speak');
  /* And voiceCloudSpeak's failure path lands on `shown`, keeping the text. */
  a.voiceSetStatus('speaking', { kind:'answer', phase:'preparing' });
  a.fire(a.VOICE_PREPARING_MAX_MS);
  assert.equal(a.voiceState.status, 'unavailable');
});

test('Web Speech is used when there is no native engine, and still terminates', () => {
  const a = appWithClock();
  a.nativePlugin = () => null;
  let utt = null;
  a.window.SpeechSynthesisUtterance = function(t){ this.text = t; utt = this; };
  a.window.speechSynthesis = { cancel(){}, speak(){}, getVoices(){ return []; } };
  assert.equal(a.voiceSpeakNative('Say this.', { kind:'answer' }), true);
  assert.equal(a.voiceState.status, 'speaking');
  assert.ok(utt && typeof utt.onend === 'function', 'no end handler was attached');
  assert.ok(typeof utt.onerror === 'function', 'no error handler was attached');
  utt.onend();
  assert.equal(a.voiceState.status, 'idle', 'the end of speech is not terminal');
});
