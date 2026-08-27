'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* HEAR TODAY — THE BRIEFING OPENS ON THE PRESS, NOT ON THE ENDING
 * ===========================================================================
 * THE DEFECT THIS FILE EXISTS FOR, as found on the founder's own device:
 *
 *   press Hear today  ->  coach starts talking
 *                     ->  the words stay hidden
 *                     ->  the briefing appears only once speech FINISHES
 *
 * which is precisely when the athlete no longer needs to read it. The card now
 * opens at the moment of the press, in the same tick, and speech starts
 * alongside it.
 *
 * THE PROPERTY UNDER TEST IS "NOT LATER", so every test here is written to
 * fail if the render is made to wait on ANYTHING: playback ending, the audio
 * element, the provider answering, the cache, or a fallback resolving. The
 * strongest of them run against a request that never resolves at all.
 *
 * Content, design, fallback, cache, Stop, Ask Coach and the Today hierarchy are
 * all unchanged by this fix and are covered where they already were.
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
const settle = () => new Promise(r => setImmediate(() => setImmediate(r)));
const briefingVisible = (html) => /class="voice-said"/.test(html);

/* `hang: true` gives a speech request that NEVER answers -- the harshest
   version of the founder's complaint. Nothing downstream of the network can be
   what makes the briefing appear. */
function online(a, opts){
  const o = opts || {};
  const calls = [];
  const played = [];
  a.AbortController = AbortController;
  a.cloudSession = { access_token:'tok', expires_at: Date.now() + 3600000 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  a.window.fetch = a.fetch = function(url, init){
    if (String(url).indexOf('/api/voice-tts') === -1)
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    calls.push({ url, init });
    if (o.hang) return new Promise(() => {});
    if (o.fail) return Promise.reject(new Error('offline'));
    if (o.status) return Promise.resolve({ ok:false, status:o.status });
    return Promise.resolve({ ok:true, status:200,
      blob: () => Promise.resolve({ size: 2048, type:'audio/mpeg' }) });
  };
  a.window.URL = { createObjectURL: () => 'blob:audio', revokeObjectURL: () => {} };
  a.window.Audio = function(url){
    played.push(url);
    this.play = function(){ return Promise.resolve(); };
    this.pause = function(){};
  };
  a.ttsCacheClear();
  return { calls, played };
}
function withNative(a){
  const spoken = [];
  a.window.Capacitor = { Plugins: { TextToSpeech: {
    speak: (req) => { spoken.push(req.text); return Promise.resolve(); },
    stop: () => {},
    getSupportedVoices: () => Promise.resolve({ voices: [] })
  } } };
  return spoken;
}

// ---------------------------------------------------------------------------
// 1. THE FIX ITSELF — VISIBLE FROM THE INITIAL PLAYING STATE
// ---------------------------------------------------------------------------
test('the briefing is visible in the same tick as the press', () => {
  const a = app();
  const dd = todayDay(a);
  online(a, { hang: true });

  assert.ok(!briefingVisible(a.renderVoiceCard(dd)), 'the briefing was showing before any press');
  a.handleVoiceListen(dd.id);
  /* No await. Nothing has been given a chance to resolve. */
  assert.equal(a.voiceState.status, 'speaking');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)),
    'the briefing is not on screen at the moment of the press');
});

test('every spoken line is on screen while it is still playing', () => {
  const a = app();
  const dd = todayDay(a);
  online(a, { hang: true });
  a.handleVoiceListen(dd.id);
  const html = a.renderVoiceCard(dd);
  const lines = a.voiceScriptFor(dd).lines;
  assert.ok(lines.length >= 2, 'the fixture briefing is too short to prove anything');
  lines.forEach(l => assert.ok(
    html.indexOf(l) !== -1 || html.indexOf(l.replace(/&/g, '&amp;').replace(/</g, '&lt;')) !== -1,
    'a spoken line is missing while the coach is saying it: ' + l));
});

test('a provider that never answers cannot delay the briefing', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a, { hang: true });
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(net.calls.length, 1, 'the speech request was never opened');
  assert.equal(net.played.length, 0, 'audio started, so this proved nothing about waiting');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)),
    'the briefing is waiting on the provider');
});

test('the briefing does not wait for playback to end', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  let ended = null;
  a.window.Audio = function(url){
    net.played.push(url);
    const self = this;
    this.play = function(){ return Promise.resolve(); };
    this.pause = function(){};
    /* Captured and deliberately NEVER fired: playback that never completes. */
    Object.defineProperty(this, 'onended', {
      set: function(fn){ ended = fn; }, get: function(){ return ended; } });
  };
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(net.played.length, 1, 'audio never started');
  assert.equal(a.voiceState.status, 'speaking', 'the state left the playing state on its own');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)),
    'the briefing only appears once playback ends -- this is the reported defect');
});

test('the native fallback shows the briefing on the press too', async () => {
  const a = app();
  const dd = todayDay(a);
  const spoken = withNative(a);
  online(a, { fail: true });
  a.handleVoiceListen(dd.id);
  assert.ok(briefingVisible(a.renderVoiceCard(dd)), 'not visible at the press on the fallback path');
  await settle(); await settle();
  assert.equal(spoken.length, 1, 'the device engine never spoke');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)), 'the briefing vanished when the fallback took over');
});

test('a device with no speech at all still opens the card on the press', () => {
  const a = app();
  const dd = todayDay(a);
  /* No cloud, no plugin, no synthesiser: the words ARE the delivery. */
  a.cloudSession = null;
  a.handleVoiceListen(dd.id);
  assert.ok(briefingVisible(a.renderVoiceCard(dd)), 'a silent device got nothing at all');
});

test('a cache hit is not what makes it visible, and does not change the moment', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  a.handleVoiceListen(dd.id);
  await settle();
  a.handleVoiceStopPress(); a.voiceStop();
  assert.ok(!briefingVisible(a.renderVoiceCard(dd)));

  a.handleVoiceListen(dd.id);                 /* served from cache */
  assert.ok(briefingVisible(a.renderVoiceCard(dd)), 'a cached replay did not open the card');
  await settle();
  assert.equal(net.calls.length, 1, 'the cached press paid for the audio again');
});

// ---------------------------------------------------------------------------
// 2. STOP SILENCES; HIDE COLLAPSES
// ---------------------------------------------------------------------------
test('Stop silences the coach and KEEPS the briefing on screen', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  let paused = 0;
  a.window.Audio = function(u){ net.played.push(u);
    this.play = () => Promise.resolve(); this.pause = () => { paused++; }; };
  a.handleVoiceListen(dd.id);
  await settle();
  a.handleVoiceStopPress();
  assert.equal(paused, 1, 'Stop left the coach talking');
  assert.equal(a.voiceState.status, 'shown');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)),
    'Stop took the words away as well as the audio');
  assert.ok(!/Playing briefing/.test(a.renderVoiceCard(dd)),
    'it still claims to be playing after Stop');
});

test('Stop reaches the device engine as well as the premium one', async () => {
  const a = app();
  const dd = todayDay(a);
  let stopped = 0;
  /* A native utterance that never finishes, so Stop is pressed while the
     device engine is genuinely mid-sentence. A speak() that resolves
     immediately would have left the card in `shown` and turned this into a
     test of Hide. */
  a.window.Capacitor = { Plugins: { TextToSpeech: {
    speak: () => new Promise(() => {}),
    stop: () => { stopped++; },
    getSupportedVoices: () => Promise.resolve({ voices: [] })
  } } };
  online(a, { fail: true });
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(a.voiceState.status, 'speaking', 'the device engine never started');
  a.handleVoiceStopPress();
  assert.equal(stopped, 1, 'the device engine kept talking after Stop');
  assert.equal(a.voiceState.status, 'shown');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)), 'Stop took the words away too');
});

test('Stop cancels a request still in flight, and the card stays open', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a, { hang: true });
  a.handleVoiceListen(dd.id);
  await settle();
  a.handleVoiceStopPress();
  assert.equal(net.played.length, 0, 'audio started after Stop');
  assert.equal(a.voiceState.status, 'shown');
  assert.ok(briefingVisible(a.renderVoiceCard(dd)));
});

test('the second press HIDES, and that is what collapses the briefing', async () => {
  const a = app();
  const dd = todayDay(a);
  online(a);
  a.handleVoiceListen(dd.id);
  await settle();
  const playing = a.renderVoiceCard(dd);
  assert.match(playing, /<span>Stop<\/span>/, 'the control does not offer Stop while playing');

  a.handleVoiceStopPress();                       // Stop
  const stopped = a.renderVoiceCard(dd);
  assert.match(stopped, /<span>Hide<\/span>/, 'the control does not become Hide once stopped');
  assert.ok(briefingVisible(stopped));

  a.handleVoiceStopPress();                       // Hide
  assert.equal(a.voiceState.status, 'idle');
  assert.ok(!briefingVisible(a.renderVoiceCard(dd)), 'Hide did not collapse the briefing');
});

test('the card offers Hear today again after it has been hidden', async () => {
  const a = app();
  const dd = todayDay(a);
  online(a);
  a.handleVoiceListen(dd.id); await settle();
  a.handleVoiceStopPress(); a.handleVoiceStopPress();
  assert.match(a.renderVoiceCard(dd), /data-action="voice-listen"/,
    'the athlete cannot start the briefing again');
});

test('the button is wired to the two-job handler, not to the collapse primitive', () => {
  assert.match(SRC, /case 'voice-stop': handleVoiceStopPress\(\)/,
    'the control still collapses the card the moment the coach is silenced');
});

// ---------------------------------------------------------------------------
// 3. WHAT THIS FIX MUST NOT HAVE TOUCHED
// ---------------------------------------------------------------------------
test('opening Ask Coach still clears the briefing entirely', () => {
  /* voiceStop() stays the "stop AND collapse" primitive. Two voices at once is
     not a state a coach has, and neither is a briefing sitting open underneath
     the question panel. */
  const a = app();
  const dd = todayDay(a);
  online(a);
  a.handleVoiceListen(dd.id);
  a.voiceCoachAvailable = true;
  a.handleVoiceAskOpen();
  assert.equal(a.voiceState.status, 'idle', 'the briefing survived Ask Coach opening');
  assert.match(SRC, /function handleVoiceAskOpen\(\)\{[\s\S]{0,300}voiceStop\(\)/);
});

test('the briefing content is byte-for-byte what it was', () => {
  /* A timing fix that changed a word would be a content change wearing a
     timing fix's clothes. */
  const a = app();
  const dd = todayDay(a);
  const script = a.voiceScriptFor(dd);
  const net = online(a);
  a.handleVoiceListen(dd.id);
  const html = a.renderVoiceCard(dd);
  script.lines.forEach(l => assert.ok(
    html.indexOf(l) !== -1 || html.indexOf(l.replace(/&/g, '&amp;')) !== -1,
    'the rendered briefing differs from the composed one'));
  return settle().then(() => {
    assert.equal(net.calls.length, 1);
    assert.equal(JSON.parse(net.calls[0].init.body).text, a.voiceScriptText(script),
      'what is spoken is no longer what is shown');
  });
});

test('the card design was not redrawn -- same block, same class', () => {
  assert.match(SRC, /\.voice-said\{/, 'the briefing block lost its styling');
  assert.match(SRC, /class="voice-said"/, 'the briefing block was renamed');
  assert.match(SRC, /\.voice-playing\{/, 'the playing indicator lost its styling');
});

test('a Strava-derived day is still refused whole', async () => {
  const a = app();
  const dd = todayDay(a);
  /* isStravaDerived() keys on stravaActivityId. Setting some other field would
     produce a day that is not Strava-derived at all, and the test would pass
     while proving nothing. */
  dd.stravaActivityId = 987654321;
  assert.equal(a.isStravaDerived(dd), true, 'the fixture is not actually Strava-derived');
  const net = online(a);
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(net.calls.length, 0, 'a Strava-derived day reached the speech vendor');
  assert.ok(!briefingVisible(a.renderVoiceCard(dd)), 'a Strava-derived day was spoken about');
  assert.match(a.renderVoiceCard(dd), /voice-unavailable/,
    'the athlete is not told why the coach will not talk about this day');
});
