'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE INTERFACE REACTS TO THE TAP; THE NETWORK CAN TAKE AS LONG AS IT TAKES
 * ===========================================================================
 * Founder live-device report: app launch ~2s, and Ask Coach and Hear Today
 * each ~4s from tap to anything happening.
 *
 * MEASURED (tools/perf/measure.js, phone viewport, network stubbed so our own
 * cost is isolated from the vendors'):
 *
 *   the font stylesheet was RENDER-BLOCKING. Answered after 1000ms it pushed
 *   first paint to 1140ms and script execution to 1123ms -- a pending
 *   stylesheet blocks not only painting but every script after it, which here
 *   is the entire application. init(), the Today render and the voice probe
 *   all waited on a font host.
 *
 *   our own synchronous work was never the problem: renderApp() 13ms,
 *   voiceCoachContext() 0.1ms, the tap handlers 6-11ms.
 *
 *   Ask Coach painted its Thinking state 33ms after the tap already.
 *
 *   Hear Today painted the briefing 26ms after the tap, but the status line
 *   said "Playing briefing" while the audio was still being fetched.
 *
 * So this file guards three things: the critical path stays free of blocking
 * network work, the status line stays honest about which half of `speaking`
 * the athlete is in, and the loading states are reached before any request.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const HEAD = SRC.slice(0, SRC.indexOf('<style>'));
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
const statusLine = (h) => /Preparing voice/.test(h) ? 'preparing'
                       : /Playing briefing/.test(h) ? 'playing' : 'none';

/* `hold` keeps the speech request unanswered so the waiting state can be
   inspected for as long as the test needs. */
function online(a, opts){
  const o = opts || {};
  const calls = [];
  let land = null;
  a.AbortController = AbortController;
  a.cloudSession = { access_token:'tok', expires_at: Date.now() + 3600000 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  a.window.fetch = a.fetch = function(url, init){
    if (String(url).indexOf('/api/voice-tts') === -1)
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    calls.push({ url, init });
    if (o.fail) return Promise.reject(new Error('offline'));
    if (o.hold) return new Promise(r => { land = r; });
    return Promise.resolve({ ok:true, status:200,
      blob: () => Promise.resolve({ size: 2048 }) });
  };
  a.window.URL = { createObjectURL: () => 'blob:audio', revokeObjectURL: () => {} };
  const played = [];
  a.window.Audio = function(u){ played.push(u);
    this.play = () => Promise.resolve(); this.pause = () => {}; };
  a.ttsCacheClear();
  return { calls, played,
           deliver: () => land({ ok:true, status:200, blob: () => Promise.resolve({ size: 2048 }) }) };
}

// ---------------------------------------------------------------------------
// 1. THE CRITICAL PATH
// ---------------------------------------------------------------------------
test('the font stylesheet cannot block first paint or script execution', () => {
  /* THE LAUNCH DEFECT. A plain <link rel="stylesheet"> to a font host is
     render-blocking AND execution-blocking for every script after it. */
  /* The <noscript> copy is a plain stylesheet deliberately -- with no
     JavaScript there is nothing to flip the media attribute, and nothing to
     block either, because no script is waiting behind it. */
  const noNoscript = HEAD.replace(/<noscript>[\s\S]*?<\/noscript>/g, '');
  const links = noNoscript.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/g) || [];
  const sheets = links.filter(l => /rel=["']stylesheet["']/.test(l));
  assert.ok(sheets.length, 'the font stylesheet link vanished entirely');
  sheets.forEach(l => assert.match(l, /media=["']print["']/,
    'a render-blocking font stylesheet is back on the critical path: ' + l.slice(0, 90)));
  sheets.forEach(l => assert.match(l, /onload=[^>]*this\.media\s*=\s*['"]all['"]/,
    'the stylesheet is fetched but never applied -- the app would render in fallback fonts forever'));
  /* And it still works with JavaScript disabled. */
  assert.match(HEAD, /<noscript><link[^>]*fonts\.googleapis\.com[^>]*rel=["']stylesheet["'][^>]*><\/noscript>/,
    'no noscript fallback, so a no-JS load loses the typefaces');
});

test('the font faces still swap rather than blocking on the font files', () => {
  assert.match(HEAD, /display=swap/,
    'without display=swap the text is invisible until the webfonts land');
  /* Real fallbacks, so the pre-swap paint is readable rather than broken. */
  assert.match(SRC, /font-family:'Inter',-apple-system,sans-serif/);
  assert.match(SRC, /font-family:'Cinzel',serif/);
  assert.match(SRC, /font-family:'JetBrains Mono',monospace/);
});

test('preconnect to the font hosts is kept', () => {
  /* Now that the stylesheet no longer holds the page hostage, preconnect is
     the thing that keeps the swap quick. */
  assert.match(HEAD, /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">/);
  assert.match(HEAD, /<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>/);
});

test('startup paints before it talks to anything optional', () => {
  /* Measured order, asserted structurally: renderApp() must come before the
     cloud session, the voice probe and the Strava status in init(), so no
     optional service can ever be between the athlete and their plan. */
  /* CODE, NOT PROSE. init()'s comments name cloudInit() while explaining why
     something is read from storage rather than from it -- and that mention
     sits ABOVE renderApp(), so a naive indexOf reads the explanation as a
     call and reports a defect that does not exist. */
  const init = SRC.slice(SRC.indexOf('\nfunction init(){'));
  const body = init.slice(0, init.indexOf('\n}\n'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const at = (needle) => body.indexOf(needle);
  assert.ok(at('renderApp()') !== -1, 'init no longer renders');
  ['cloudInit()', 'voiceProbeOnce()', 'stravaRefreshStatus()'].forEach(later => {
    assert.ok(at(later) !== -1, later + ' left init()');
    assert.ok(at('renderApp()') < at(later),
      later + ' now runs before the first render -- startup waits on an optional service');
  });
});

test('no network call is awaited before the app is drawn', () => {
  const init = SRC.slice(SRC.indexOf('\nfunction init(){'));
  const body = init.slice(0, init.indexOf('\n}\n'))
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const beforeRender = body.slice(0, body.indexOf('renderApp()'));
  assert.ok(!/fetch\(/.test(beforeRender), 'init fetches before it renders');
  assert.ok(!/await /.test(body), 'init awaits something -- startup is serialised behind it');
});

// ---------------------------------------------------------------------------
// 2. HEAR TODAY — HONEST ABOUT WHICH HALF OF "SPEAKING" IT IS IN
// ---------------------------------------------------------------------------
test('while the audio is still being fetched it says Preparing, not Playing', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a, { hold: true });
  a.handleVoiceListen(dd.id);
  await settle();
  const html = a.renderVoiceCard(dd);
  assert.equal(net.played.length, 0, 'audio had already started, so this proved nothing');
  assert.equal(statusLine(html), 'preparing',
    'the card claims to be playing audio it does not have yet');
  /* The words are on screen throughout -- the waiting state is a status, not a
     substitute for the briefing. */
  assert.match(html, /class="voice-said"/, 'the briefing is hidden while preparing');
});

test('it says Playing only once there is genuinely sound', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a, { hold: true });
  a.handleVoiceListen(dd.id);
  await settle();
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'preparing');
  net.deliver();
  await settle(); await settle();
  assert.equal(net.played.length, 1, 'audio never started');
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'playing',
    'it still says Preparing after the audio started');
});

test('a cache hit never shows a preparing state', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a);
  a.handleVoiceListen(dd.id);
  await settle();
  a.handleVoiceStopPress(); a.voiceStop();

  a.handleVoiceListen(dd.id);                    /* served from memory */
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'playing',
    'a press with the audio already in hand pretended to be waiting for it');
  await settle();
  assert.equal(net.calls.length, 1, 'the cached press paid for the audio again');
});

test('the device-engine fallback does not sit in a preparing state', async () => {
  const a = app();
  const dd = todayDay(a);
  a.window.Capacitor = { Plugins: { TextToSpeech: {
    speak: () => new Promise(() => {}), stop: () => {},
    getSupportedVoices: () => Promise.resolve({ voices: [] }) } } };
  online(a, { fail: true });
  a.handleVoiceListen(dd.id);
  await settle(); await settle();
  assert.equal(a.voiceState.status, 'speaking');
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'playing',
    'the device engine is speaking but the card says it is still preparing');
});

test('Stop stays responsive while still preparing', async () => {
  const a = app();
  const dd = todayDay(a);
  const net = online(a, { hold: true });
  a.handleVoiceListen(dd.id);
  await settle();
  a.handleVoiceStopPress();
  assert.equal(a.voiceState.status, 'shown', 'Stop did nothing while preparing');
  assert.match(a.renderVoiceCard(dd), /class="voice-said"/, 'Stop took the words away');
  net.deliver();
  await settle(); await settle();
  assert.equal(net.played.length, 0, 'the audio arrived after Stop and started anyway');
});

test('the phase never leaks into a state that has no audio', () => {
  const a = app();
  const dd = todayDay(a);
  a.voiceSetStatus('shown', { kind:'briefing', dayId: dd.id });
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'none',
    'a stopped briefing still shows a playback status');
  a.voiceSetStatus('idle');
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'none');
});

test('an existing caller that sets no phase still means playing', () => {
  /* Backwards compatibility for every voiceSetStatus call that predates this. */
  const a = app();
  const dd = todayDay(a);
  a.voiceSetStatus('speaking', { kind:'briefing', dayId: dd.id });
  assert.equal(a.voiceState.phase, 'playing');
  assert.equal(statusLine(a.renderVoiceCard(dd)), 'playing');
});

// ---------------------------------------------------------------------------
// 3. ASK COACH — THINKING IS REACHED BEFORE THE REQUEST, NOT AFTER IT
// ---------------------------------------------------------------------------
test('Ask Coach is in its thinking state before any request is opened', async () => {
  const a = app();
  const calls = [];
  a.cloudSession = { access_token:'tok', expires_at: Date.now() + 3600000 };
  a.cloudRefreshIfNeeded = () => Promise.resolve(true);
  a.window.fetch = a.fetch = (url, init) => {
    /* Scoped to the Ask Coach route: the app makes its own availability probes
       and counting those would make "exactly one request" mean nothing. */
    if (String(url).indexOf('/api/voice-ask') === -1)
      return Promise.resolve({ ok:true, status:200, json: () => Promise.resolve({}) });
    /* The status at the moment the request is opened -- if the interface only
       reaches `thinking` after the network answers, this records the wrong one. */
    calls.push({ url, statusWhenSent: a.askState.status });
    return new Promise(() => {});
  };
  a.askSend('How hard should today feel?');
  /* Synchronously, in the same tick as the tap. */
  assert.equal(a.askState.status, 'thinking',
    'the interface is still idle after the tap');
  await settle();
  assert.equal(calls.length, 1, 'no request was opened');
  assert.equal(calls[0].statusWhenSent, 'thinking',
    'the request went out before the interface showed anything');
});

test('the thinking state is a visible, announced element', () => {
  const a = app();
  const dd = todayDay(a);
  a.askSet('thinking', { heard:'How hard should today feel?' });
  const panel = a.renderAskPanel(dd);
  assert.match(panel, /class="ask-thinking" role="status" aria-live="polite"/,
    'the waiting state is not announced to assistive technology');
  assert.match(panel, /Thinking/, 'there is no visible waiting state at all');
  assert.match(SRC, /\.ask-thinking\{/, 'the waiting state has no styling');
});

test('no synchronous coaching work sits between the tap and the thinking state', () => {
  /* voiceCoachContext() measured at 0.1ms, but the ORDER is what protects it:
     assembling the context after askSet('thinking') means any future growth in
     that assembly costs the athlete nothing visible. */
  const body = SRC.slice(SRC.indexOf('function askSend('));
  const fn = body.slice(0, body.indexOf('\n}\n'));
  assert.ok(fn.indexOf("askSet('thinking'") < fn.indexOf('voiceCoachContext()'),
    'the context is assembled before the interface reacts to the tap');
  assert.ok(fn.indexOf("askSet('thinking'") < fn.indexOf('fetch('),
    'the request is opened before the interface reacts to the tap');
});

// ---------------------------------------------------------------------------
// 4. NOTHING WAS LOGGED THAT SHOULD NOT BE
// ---------------------------------------------------------------------------
test('no athlete content was added to any log line', () => {
  const logs = SRC.match(/console\.(log|warn|info)\([^\n]*/g) || [];
  logs.forEach(l => {
    assert.ok(!/question|answer|briefing|script\.lines|voiceScriptText|heard/i.test(l),
      'a log line carries athlete content: ' + l.slice(0, 90));
  });
});
