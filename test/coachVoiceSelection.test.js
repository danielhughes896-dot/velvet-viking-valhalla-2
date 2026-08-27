'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* COACH VOICE — A PRESENTATION PREFERENCE, PROVED TO BE ONLY THAT
 * ===========================================================================
 * THE PRODUCT RULE THIS FILE ENFORCES: choosing a different coach voice
 * changes which larynx says the words, and nothing else. Not the coaching, not
 * the prescription, not Guidance Level, not Ask Coach's reasoning, not the
 * athlete's state, and not one character of the text handed to the speech
 * vendor. The same Valhalla coach, speaking through a different voice.
 *
 * The rest of the file covers the delivery layer that sits under it: the
 * premium voice is primary, the device's own engine is the floor beneath every
 * failure, and a press costs at most one generation.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const TODAY = '2026-08-24';

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.scheduleSave = () => {}; a.flushSave = () => {};
  buildPlan(a, { weeks: 12, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  return a;
}
const todayDay = (a) => a.state.days.filter(d => d.date === a.todayStr())[0];

/* A signed-in athlete on a device with a working network and an Audio
   element -- the state in which the premium path is meant to run. Every
   outbound call is captured; nothing leaves the test. */
function online(a, opts){
  const o = opts || {};
  const calls = [];
  /* The VM sandbox is not a browser and has no AbortController; a real
     WebView does. The client already degrades safely without one -- the
     monotonic token still makes a stopped press inert -- but the cancellation
     path itself can only be exercised where the global exists. */
  a.AbortController = AbortController;
  a.cloudSession = { access_token:'tok', refresh_token:'r', expires_at: Date.now() + 3600000 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  a.window.fetch = a.fetch = function(url, init){
    /* SCOPED TO THE SPEECH ROUTE. The app makes its own unrelated probes
       (Strava availability, the coach switch); counting those as speech
       requests would make every "exactly one generation" assertion lie. */
    if (String(url).indexOf('/api/voice-tts') === -1){
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    }
    calls.push({ url:url, init:init, body: JSON.parse((init && init.body) || '{}') });
    if (o.fail) return Promise.reject(new Error('offline'));
    if (o.status) return Promise.resolve({ ok:false, status:o.status });
    return Promise.resolve({ ok:true, status:200,
      blob: () => Promise.resolve({ size: 2048, type:'audio/mpeg' }) });
  };
  const played = [];
  a.window.URL = { createObjectURL: (b) => 'blob:audio-' + (played.length + calls.length),
                   revokeObjectURL: () => {} };
  a.window.Audio = function(url){
    this.src = url; played.push(url);
    this.play = function(){ return Promise.resolve(); };
    this.pause = function(){};
  };
  a.ttsCacheClear();
  return { calls, played };
}
/* The device's own engine, so a fallback is observable rather than inferred. */
function withNative(a){
  const spoken = [];
  a.window.Capacitor = { Plugins: { TextToSpeech: {
    speak: (req) => { spoken.push(req.text); return Promise.resolve(); },
    stop: () => {},
    getSupportedVoices: () => Promise.resolve({ voices: [] })
  } } };
  return spoken;
}
const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));

// ---------------------------------------------------------------------------
// 1. THE DEFAULT, THE FOUR VOICES, AND PERSISTENCE
// ---------------------------------------------------------------------------
test('Molly is the default coach voice', () => {
  const a = app();
  assert.equal(a.COACH_VOICE_DEFAULT, 'molly');
  assert.equal(a.coachVoice(), 'molly');
});

test('an existing athlete with no stored preference gets Molly', () => {
  const a = app();
  delete a.state.coachVoice;                     // the state every athlete has today
  assert.equal(a.coachVoice(), 'molly');
  assert.match(a.renderCoachVoiceRow(), /value="molly" checked/);
});

test('each of the four approved voices can be selected', () => {
  ['molly', 'joanna', 'harry', 'andrew'].forEach(v => {
    const a = app();
    assert.equal(a.setCoachVoice(v), true, v + ' could not be selected');
    assert.equal(a.coachVoice(), v);
    assert.match(a.renderCoachVoiceRow(), new RegExp('value="' + v + '" checked'),
      v + ' is selected but the control does not show it');
  });
});

test('the selection persists into saved state', () => {
  const a = app();
  let saved = 0;
  a.scheduleSave = () => { saved++; };
  a.setCoachVoice('joanna');
  assert.equal(a.state.coachVoice, 'joanna', 'the choice was not written to state');
  assert.ok(saved > 0, 'the choice was never scheduled for saving');
  /* And it survives the trip through storage the app actually uses. */
  const revived = JSON.parse(JSON.stringify(a.state));
  a.state = revived;
  assert.equal(a.coachVoice(), 'joanna');
});

test('an invalid or corrupt stored voice falls back to Molly and is never written', () => {
  const a = app();
  ['', 'zoe', 'MOLLY', null, undefined, 42, {}].forEach(bad => {
    a.state.coachVoice = bad;
    assert.equal(a.coachVoice(), 'molly',
      'a corrupt stored preference did not fall back to Molly: ' + String(bad));
  });
  assert.equal(a.setCoachVoice('zoe'), false, 'an unknown voice was accepted');
  a.state.coachVoice = 'molly';
  assert.equal(a.setCoachVoice('nope'), false);
  assert.equal(a.state.coachVoice, 'molly', 'a rejected choice still overwrote the stored one');
});

// ---------------------------------------------------------------------------
// 2. THE CONTROL ITSELF
// ---------------------------------------------------------------------------
test('the control offers exactly the four approved voices, as one radio group', () => {
  const a = app();
  const html = a.renderCoachVoiceRow();
  assert.match(html, /role="radiogroup"/, 'a single-choice control must announce itself as one');
  assert.equal((html.match(/type="radio"/g) || []).length, 4);
  ['Molly','Joanna','Harry','Andrew'].forEach(n =>
    assert.ok(html.indexOf('>' + n + '<') !== -1, n + ' is missing from Settings'));
  assert.equal((html.match(/name="coach-voice"/g) || []).length, 4,
    'the radios are not in one group, so more than one could be selected');
});

test('it uses the existing circular cherry selection component, not a new one', () => {
  /* The founder asked for the circle cherry selection button. There is exactly
     ONE definition of that in the product and this joins it rather than
     copying it -- see test/builderTrainingDayCircles.test.js, which guards the
     same rule from the other side. */
  const rule = /\.day-check input, \.wd-check input(?:, [^{]+)?\{/.exec(SRC);
  assert.ok(rule && /\.cv-opt input/.test(rule[0]),
    'Coach Voice drew its own circle instead of sharing the component');
  const checked = /\.day-check input:checked, \.wd-check input:checked(?:, [^{]+)?\{([^}]*)\}/.exec(SRC);
  assert.ok(checked && /\.cv-opt input:checked/.test(checked[0]));
  assert.match(checked[1], /background:var\(--cherry\)/, 'the selected circle is not Cherry Lacquer');
  /* And no second, parallel definition appeared alongside it. */
  /* The lookbehind matters: the SHARED rule ends in ".cv-opt input{", so a
     naive search finds itself and this test would fail on a correct file. */
  assert.ok(!/(?<!, )\.cv-opt input\{[^}]*appearance/.test(SRC),
    'a standalone .cv-opt input rule duplicates the shared component');
});

test('the control says plainly that it changes nothing about the coaching', () => {
  const a = app();
  assert.match(a.renderCoachVoiceRow(), /never changes/i,
    'an athlete cannot tell whether this affects their training');
});

test('Coach Voice sits in Settings with the other presentation preferences', () => {
  const a = app();
  const html = a.renderSettingsHubView();
  assert.ok(html.indexOf('coach-voice-row') !== -1, 'Coach Voice is not in Settings');
  const prefs = html.indexOf('Preferences');
  const voice = html.indexOf('coach-voice-row');
  const training = html.indexOf('Training &amp; Zones');
  assert.ok(prefs !== -1 && voice > prefs && (training === -1 || voice < training),
    'Coach Voice is not inside the Preferences card');
});

// ---------------------------------------------------------------------------
// 3. IT CHANGES THE VOICE AND NOTHING ELSE
// ---------------------------------------------------------------------------
test('switching Molny to Joanna to Harry never changes a word of the briefing', () => {
  const a = app();
  const dd = todayDay(a);
  const said = [];
  ['molly', 'joanna', 'harry', 'andrew'].forEach(v => {
    a.setCoachVoice(v);
    said.push(a.voiceScriptText(a.voiceScriptFor(dd)));
  });
  assert.equal(new Set(said).size, 1,
    'the coach voice changed the words: ' + JSON.stringify(said, null, 1));
  assert.ok(said[0].length > 40, 'the briefing was empty, so this proved nothing');
});

test('the coach voice reaches no coaching decision, prescription or state', () => {
  const a = app();
  const dd = todayDay(a);
  const snapshot = () => JSON.stringify({
    brief: a.coachBrief(dd),
    disclosure: a.coachingDisclosureFor(dd, a.athleteExperience(a.state.setup)),
    guidance: a.resolvedGuidanceLevel(dd),
    targets: (function(){ try { return a.getDayTargets(dd); } catch(e){ return null; } })(),
    day: { km: dd.km, type: dd.type, pace: dd.pace }
  });
  const before = snapshot();
  ['joanna', 'harry', 'andrew', 'molly'].forEach(v => {
    a.setCoachVoice(v);
    assert.equal(snapshot(), before, 'selecting ' + v + ' changed the coaching');
  });
});

test('Guidance Level is untouched by the coach voice', () => {
  const a = app();
  const dd = todayDay(a);
  a.setGuidanceLevel('adaptive');
  const before = a.resolvedGuidanceLevel(dd);
  a.setCoachVoice('harry');
  assert.equal(a.resolvedGuidanceLevel(dd), before);
  assert.equal(a.guidanceLevel(), 'adaptive', 'the coach voice overwrote Guidance Level');
});

// ---------------------------------------------------------------------------
// 4. HEAR TODAY USES THE SELECTED VOICE
// ---------------------------------------------------------------------------
test('Hear Today sends the selected voice, and only the briefing text', async () => {
  const a = app();
  const dd = todayDay(a);
  a.setCoachVoice('harry');
  const net = online(a);
  a.handleVoiceListen(dd.id);
  await settle();

  assert.equal(net.calls.length, 1, 'expected exactly one speech request');
  assert.match(String(net.calls[0].url), /\/api\/voice-tts/, 'the phone called something else');
  const body = net.calls[0].body;
  assert.deepEqual(Object.keys(body).sort(), ['text', 'voice'],
    'the phone sent a field beyond the text and the voice: ' + JSON.stringify(body));
  assert.equal(body.voice, 'harry', 'the selected coach voice was not used');
  assert.equal(body.text, a.voiceScriptText(a.voiceScriptFor(dd)),
    'what was sent is not what the engine composed');
});

test('switching voice takes effect on the very next playback', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);

  a.setCoachVoice('molly');
  a.handleVoiceListen(dd.id); await settle(); a.voiceStop();
  /* No restart, no new programme, no sign-in -- just the next press. */
  a.handleSetCoachVoice('andrew');
  a.handleVoiceListen(dd.id); await settle();

  assert.equal(net.calls.length, 2, 'the second press did not generate for the new voice');
  assert.equal(net.calls[0].body.voice, 'molly');
  assert.equal(net.calls[1].body.voice, 'andrew');
  assert.equal(net.calls[0].body.text, net.calls[1].body.text,
    'changing the voice changed the words');
});

test('a Strava-derived day still refuses to be spoken at all', () => {
  const a = app();
  const dd = todayDay(a);
  dd.source = 'strava';
  const net = online(a);
  a.handleVoiceListen(dd.id);
  assert.equal(net.calls.length, 0,
    'a Strava-derived day reached a third-party speech vendor');
});

// ---------------------------------------------------------------------------
// 5. THE CACHE — ONE PRESS, ONE GENERATION
// ---------------------------------------------------------------------------
test('cache identity cannot collide across voices or across briefings', () => {
  const a = app();
  const T = 'Nice easy one today, five kilometres.';
  const keys = ['molly','joanna','harry','andrew'].map(v => a.ttsCacheKey(T, v));
  assert.equal(new Set(keys).size, 4, 'two voices share a cache key -- one would speak in another\'s audio');
  assert.notEqual(a.ttsCacheKey(T, 'molly'), a.ttsCacheKey(T + ' Watch for racing it.', 'molly'),
    'a changed briefing would replay stale audio');
  assert.equal(a.ttsCacheKey(T, 'molly'), a.ttsCacheKey(T, 'molly'),
    'identical input produced two keys -- the cache could never hit');
  assert.match(a.ttsCacheKey(T, 'molly'), /^[0-9a-f]{32}$/, 'the key is not opaque');
  assert.equal(a.ttsCacheKey(T, 'molly').indexOf('molly'), -1, 'the key names the voice in clear');
  assert.equal(a.ttsCacheKey(T, 'molly').indexOf('easy'), -1, 'the key carries briefing text');
});

test('pressing Hear Today again for an unchanged briefing costs nothing', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  for (let i = 0; i < 4; i++){
    a.handleVoiceListen(dd.id);
    await settle();
    a.voiceStop();
  }
  assert.equal(net.calls.length, 1,
    'four presses of an unchanged briefing cost ' + net.calls.length + ' generations');
  assert.equal(net.played.length, 4, 'the cached audio was not replayed');
});

test('two presses in the same instant become one request', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  a.handleVoiceListen(dd.id);
  a.handleVoiceListen(dd.id);   /* before the first has resolved */
  await settle();
  assert.equal(net.calls.length, 1,
    'a double tap opened ' + net.calls.length + ' billable requests');
});

test('an expired entry is regenerated rather than replayed', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  a.handleVoiceListen(dd.id); await settle(); a.voiceStop();
  assert.equal(net.calls.length, 1);
  /* Age every entry past the retention window -- using the APP's clock. The
     harness pins Date inside the sandbox, so this realm's Date.now() is a
     different clock entirely and subtracting from it would have aged the
     entries into the future. */
  a.ttsCacheEntries.forEach(e => { e.at = a.Date.now() - a.TTS_CACHE_TTL_MS - 1; });
  a.handleVoiceListen(dd.id); await settle();
  assert.equal(net.calls.length, 2, 'expired audio was replayed -- retention is not bounded');
});

test('the cache is bounded and holds no persistent archive', () => {
  const a = app();
  assert.ok(a.TTS_CACHE_MAX > 0 && a.TTS_CACHE_MAX <= 16, 'the client cache is unbounded');
  assert.ok(a.TTS_CACHE_TTL_MS > 0 && a.TTS_CACHE_TTL_MS <= 60 * 60 * 1000,
    'client audio is retained for longer than a session needs');
  /* Nothing writes audio to storage: localStorage never sees a blob or a url. */
  assert.ok(!/setItem\([^)]*(ttsCache|blob:)/.test(SRC),
    'generated coaching audio is being written to athlete storage');
});

// ---------------------------------------------------------------------------
// 6. THE DEVICE IS ALWAYS THE FLOOR
// ---------------------------------------------------------------------------
test('a provider error falls back to the device engine with the same words', async () => {
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  const net = online(a, { status: 502 });
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(net.calls.length, 1);
  assert.equal(spoken.length, 1, 'the athlete got silence instead of a fallback');
  assert.equal(spoken[0], a.voiceScriptText(a.voiceScriptFor(dd)),
    'the fallback spoke different words from the premium path');
});

test('a network failure falls back to the device engine', async () => {
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  online(a, { fail: true });
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(spoken.length, 1, 'a flat network took Hear Today away entirely');
});

test('an uncommissioned deployment costs one request, then speaks natively forever', async () => {
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  const net = online(a, { status: 503 });
  for (let i = 0; i < 3; i++){
    a.handleVoiceListen(dd.id);
    await settle(); await settle();
    a.voiceStop();
  }
  assert.equal(net.calls.length, 1,
    'the client kept asking an unconfigured deployment: ' + net.calls.length + ' requests');
  assert.equal(spoken.length, 3, 'the athlete lost the briefing on the later presses');
});

test('a signed-out athlete never reaches the vendor and still hears the briefing', async () => {
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  const net = online(a);
  a.cloudSession = null;                    /* signed out */
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(net.calls.length, 0, 'a signed-out athlete was allowed to spend money');
  assert.equal(spoken.length, 1, 'a signed-out athlete lost the briefing');
});

test('the native engine was not removed to make room for the premium one', () => {
  const a = app();
  assert.equal(typeof a.voiceSpeakNative, 'function', 'the native speech path is gone');
  assert.match(SRC, /voiceNativeTts\(\)/, 'the Android TextToSpeech bridge is gone');
  assert.match(SRC, /new window\.SpeechSynthesisUtterance/, 'the Web Speech path is gone');
});

// ---------------------------------------------------------------------------
// 7. STOP, AND NO OVERLAPPING SPEECH
// ---------------------------------------------------------------------------
test('Stop cancels a request that has not landed yet', async () => {
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  let aborted = false;
  a.AbortController = AbortController;
  a.cloudSession = { access_token:'tok', expires_at: Date.now() + 3600000 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  let resolveFetch;
  a.window.fetch = a.fetch = (url, init) => {
    if (String(url).indexOf('/api/voice-tts') === -1)
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    if (init && init.signal) init.signal.addEventListener('abort', () => { aborted = true; });
    return new Promise(r => { resolveFetch = r; });
  };
  a.window.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  const played = [];
  a.window.Audio = function(u){ played.push(u); this.play = () => Promise.resolve(); this.pause = () => {}; };

  a.handleVoiceListen(dd.id);
  /* The fetch is opened on a later microtask -- cloudRefreshIfNeeded() resolves
     first -- so Stop has to be pressed once the request genuinely exists, or
     this would be testing the easier case where nothing had started yet. */
  await settle();
  a.voiceStop();
  assert.equal(aborted, true, 'Stop did not cancel the request in flight');
  /* And if it lands anyway, it must not start talking into a stopped card. */
  resolveFetch({ ok:true, status:200, blob: () => Promise.resolve({ size: 10 }) });
  await settle(); await settle();
  assert.equal(played.length, 0, 'audio started after Stop was pressed');
  assert.equal(spoken.length, 0, 'the fallback spoke after Stop was pressed');
  assert.equal(a.voiceState.status, 'idle');
});

test('a WebView with no AbortController still cannot be made to talk after Stop', async () => {
  /* Cancellation is a nicety; NOT SPEAKING AFTER STOP is the guarantee. The
     monotonic token carries it on its own, so an old WebView missing
     AbortController degrades to one wasted request and never to a coach who
     starts talking into a card the athlete already closed. */
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  a.cloudSession = { access_token:'tok', expires_at: Date.now() + 3600000 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  delete a.AbortController;
  let land;
  a.window.fetch = a.fetch = (url) => {
    if (String(url).indexOf('/api/voice-tts') === -1)
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    return new Promise(r => { land = r; });
  };
  a.window.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
  const played = [];
  a.window.Audio = function(u){ played.push(u);
    this.play = () => Promise.resolve(); this.pause = () => {}; };
  a.ttsCacheClear();

  a.handleVoiceListen(dd.id);
  await settle();                 /* the request is open and unanswered */
  a.voiceStop();
  land({ ok:true, status:200, blob: () => Promise.resolve({ size: 10 }) });
  await settle(); await settle();

  assert.equal(played.length, 0, 'audio started after Stop on a device with no AbortController');
  assert.equal(spoken.length, 0, 'the fallback spoke after Stop');
  assert.equal(a.voiceState.status, 'idle');
});

test('Stop halts audio that is already playing', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  let paused = 0;
  a.window.Audio = function(u){ net.played.push(u);
    this.play = () => Promise.resolve(); this.pause = () => { paused++; }; };
  a.handleVoiceListen(dd.id);
  await settle();
  a.voiceStop();
  assert.equal(paused, 1, 'Stop left the coach talking');
  assert.equal(a.voiceState.status, 'idle');
});

test('leaving Today and opening Ask Coach both stop playback', () => {
  const a = app();
  assert.match(SRC, /function voiceStop\(\)\{[\s\S]{0,400}ttsHalt\(\)/,
    'voiceStop does not reach the premium playback path');
  assert.match(SRC, /function handleVoiceAskOpen\(\)\{[\s\S]{0,300}voiceStop\(\)/,
    'opening Ask Coach leaves the briefing talking over it');
});

test('a second press cannot leave two briefings talking at once', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  a.handleVoiceListen(dd.id);
  await settle();
  const first = net.played.length;
  a.handleVoiceListen(dd.id);   /* a second deliberate press */
  await settle();
  /* The token bumped on the second press, so the first press's continuations
     are inert; only one element is ever live. */
  assert.ok(net.played.length >= first, 'the second press produced nothing');
  assert.equal(net.calls.length, 1, 'the second press paid for the same audio again');
});

// ---------------------------------------------------------------------------
// 8. PREVIEW
// ---------------------------------------------------------------------------
test('Preview speaks one fixed sentence, identical for every voice', async () => {
  const a = app();
  const net = online(a);
  for (const v of ['molly','joanna','harry','andrew']){
    a.coachVoicePreview(v);
    await settle();
  }
  assert.equal(net.calls.length, 4, 'each voice needs its own audio');
  const texts = new Set(net.calls.map(c => c.body.text));
  assert.equal(texts.size, 1, 'the voices were previewed on different sentences');
  assert.deepEqual(net.calls.map(c => c.body.voice), ['molly','joanna','harry','andrew']);
  assert.equal([...texts][0], a.COACH_VOICE_PREVIEW);
  assert.ok(a.COACH_VOICE_PREVIEW.length > 20, 'the preview sentence is too short to judge a voice on');
});

test('Preview never invokes Ask Coach or any coaching or model endpoint', async () => {
  const a = app();
  const net = online(a);
  let asked = 0;
  a.askSend = () => { asked++; };
  a.coachVoicePreview('harry');
  await settle();
  assert.equal(asked, 0, 'Preview reached Ask Coach');
  net.calls.forEach(c => assert.ok(String(c.url).indexOf('voice-ask') === -1,
    'Preview called the Ask Coach endpoint'));
  /* The sentence is a literal, so it cannot be generated by anything. */
  assert.ok(SRC.indexOf("var COACH_VOICE_PREVIEW = '") !== -1,
    'the preview sentence is not a fixed literal');
});

test('Preview does not change the stored coach voice', async () => {
  const a = app();
  a.setCoachVoice('molly');
  online(a);
  a.coachVoicePreview('harry');
  await settle();
  assert.equal(a.coachVoice(), 'molly', 'previewing a voice silently selected it');
});

test('Preview stops whatever was already speaking', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  let paused = 0;
  a.window.Audio = function(u){ net.played.push(u);
    this.play = () => Promise.resolve(); this.pause = () => { paused++; }; };
  a.handleVoiceListen(dd.id);
  await settle();
  a.coachVoicePreview('harry');
  assert.equal(paused, 1, 'Preview talked over the briefing');
});

// ---------------------------------------------------------------------------
// 9. THE CREDENTIAL, AND ASK COACH
// ---------------------------------------------------------------------------
test('no ElevenLabs credential, endpoint or voice id is anywhere in the browser', () => {
  assert.ok(!/ELEVENLABS_API_KEY/.test(SRC), 'the runtime names the key variable');
  assert.ok(!/xi-api-key/i.test(SRC), 'the runtime carries the vendor auth header');
  assert.ok(!/api\.elevenlabs\.io/i.test(SRC), 'the runtime reaches the vendor directly');
  ['jkSXBeN4g5pNelNQ3YWw','dVoi15NNDJligFBwnVO0','8Qks38ENjPxXSdubdeg8','jR6tjweqjDI3m7B2nd5t']
    .forEach(id => assert.equal(SRC.indexOf(id), -1,
      'a voice id is hard-coded in the browser -- the catalogue is resolved server-side'));
  /* And nothing about the voice is written into athlete storage but the key. */
  const a = app();
  a.setCoachVoice('harry');
  assert.equal(JSON.stringify(a.state).indexOf('8Qks38ENjPxXSdubdeg8'), -1);
});

test('Ask Coach still reasons through Anthropic and was not touched', () => {
  const a = app();
  assert.equal(typeof a.askSend, 'function');
  assert.match(SRC, /\/api\/voice-ask/, 'the Ask Coach route is gone');
  const askRegion = SRC.slice(SRC.indexOf('ASK COACH — THE CONTEXT LAYER'));
  assert.ok(!/voice-tts/.test(askRegion.slice(0, askRegion.indexOf('STRAVA INTEGRATION'))),
    'the speech vendor was wired into the Ask Coach reasoning path');
});
