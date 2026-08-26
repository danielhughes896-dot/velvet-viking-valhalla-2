'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* THE THREE DEFECTS A LIVE ANDROID TEST FOUND, AND THE SUITE DID NOT
 * ===========================================================================
 * Every one of these passed 2723 unit tests and 22 screenshots before failing
 * on a real phone, so the shape of the mistake matters as much as the fix:
 *
 *   1. LISTEN VANISHED. The control was gated on window.speechSynthesis. The
 *      installed app is a Capacitor WebView, Android WebView does not expose
 *      it, and the whole capability disappeared -- with the deterministic
 *      coaching inside it. The suite agreed, because a test asserted that
 *      "no speech means no control" was CORRECT. A test that encodes the
 *      assumption cannot falsify it.
 *
 *   2. THE MICROPHONE WAS DRAWN AND DID NOTHING. webkitSpeechRecognition
 *      exists in Android WebView; nothing services it. start() succeeds, no
 *      result and no error ever arrive, and the athlete watches "Listening…"
 *      until they give up.
 *
 *   3. ASK COACH RETURNED "not responding". max_tokens was 1024 on a model
 *      whose thinking is on by default and is billed from the same budget --
 *      so the ceiling could be spent before a single word of the answer.
 *
 * The screenshots missed 1 and 2 because the shot harness STUBS speechSynthesis
 * to make the control appear. A fixture that manufactures the capability cannot
 * discover its absence, so the reproduction below removes it instead.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const ASK = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
const TODAY = '2026-08-24';

/* The founder's real device: the installed Capacitor app, Ask Coach configured
   (so the server said yes), and no speech synthesis behind the WebView. */
function androidApp(opts){
  const o = opts || {};
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  a.window.Capacitor = { isNativePlatform: () => true };
  if (o.stt) a.window.webkitSpeechRecognition = o.stt;
  return a;
}
const today = a => a.findDayByDate(TODAY);

// ---------------------------------------------------------------------------
// DEFECT 1 — THE MISSING BRIEFING
// ---------------------------------------------------------------------------
test('REGRESSION: the installed Android app still offers the briefing', () => {
  const a = androidApp();
  assert.equal(a.voiceAvailable(), false, 'precondition: the WebView cannot speak');
  const html = a.renderVoiceCard(today(a));
  assert.match(html, /data-action="voice-listen"/,
    'the briefing is missing on the device this feature shipped to');
  assert.match(html, /data-action="voice-ask-open"/, 'Ask Coach should be there too');
});

test('REGRESSION: the briefing survives on the exact card state that failed', () => {
  /* Today, expanded, not yet completed, Strava connected on other days, Ask
     Coach configured. This is the state in the founder's screenshot. */
  const a = androidApp();
  const past = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')[0];
  a.applyCompletion(past, true);
  past.actual = Object.assign(a.emptyActual(), { km: past.km, pace: '5:10' });
  past.stravaActivityId = 'S1';
  const card = a.renderDayCard(today(a));
  assert.match(card, /data-action="voice-listen"/, 'no briefing control on the real card');
  assert.match(card, /Read today/, 'the label does not match what the device can do');
});

test('REGRESSION: the control sits with the coaching, not below the log', () => {
  /* It was last on a long card, under the logging panel and the Execution
     Review, which is where it could not be found. */
  const a = androidApp();
  const card = a.renderDayCard(today(a));
  const voiceAt = card.indexOf('id="voice-card"');
  const logAt = card.indexOf('class="actual-panel"');
  const reviewAt = card.indexOf('exec-review-');
  assert.ok(voiceAt > 0, 'the voice card is not on the day card at all');
  if (logAt > 0) assert.ok(voiceAt < logAt, 'voice still sits below the logging panel');
  if (reviewAt > 0) assert.ok(voiceAt < reviewAt, 'voice still sits below Execution Review');
});

test('LISTEN still needs no model, no key and no network', () => {
  const a = androidApp();
  a.window.fetch = () => { throw new Error('LISTEN must not reach the network'); };
  const script = a.voiceScriptFor(today(a));
  assert.ok(script && script.lines.length);
  a.handleVoiceListen(today(a).id);
  assert.match(a.renderVoiceCard(today(a)), /voice-said/);
});

test('LISTEN works for a Strava-connected founder account', () => {
  const a = androidApp();
  const past = a.state.days.filter(d => d.date < TODAY && d.type !== 'rest')[0];
  past.stravaActivityId = 'S1';
  assert.match(a.renderVoiceCard(today(a)), /data-action="voice-listen"/);
});

// ---------------------------------------------------------------------------
// DEFECT 2 — THE MICROPHONE THAT COULD NOT LISTEN
// ---------------------------------------------------------------------------
test('REGRESSION: no microphone control inside the installed app', () => {
  /* The constructor exists in Android WebView and nothing services it, so its
     presence is not permission to draw a control. */
  const a = androidApp({ stt: function(){} });
  assert.equal(a.voiceSttUnsupportedReason(), 'native_shell');
  assert.equal(a.voiceSttAvailable(), false);
  a.askSet('open', {});
  const panel = a.renderAskPanel(today(a));
  assert.ok(!/data-action="voice-ask-speak"/.test(panel),
    'a microphone was offered where speech recognition cannot work');
  assert.match(panel, /id="ask-input"/, 'and typing must always remain');
});

test('the athlete is told why, in product language', () => {
  const a = androidApp({ stt: function(){} });
  a.askSet('open', {});
  const panel = a.renderAskPanel(today(a));
  assert.match(panel, /Speaking isn’t available inside the app/);
  assert.match(panel, /type your question/i, 'no alternative was offered');
  ['SpeechRecognition', 'webkit', 'permission', 'API', 'secure context', 'WebView']
    .forEach(w => assert.ok(!new RegExp(w, 'i').test(panel),
      'developer vocabulary reached the athlete: ' + w));
});

test('an ordinary mobile browser still gets the microphone', () => {
  const a = androidApp({ stt: function(){} });
  a.window.Capacitor = null;                       // Chrome, not the installed app
  assert.equal(a.voiceSttUnsupportedReason(), null);
  a.askSet('open', {});
  assert.match(a.renderAskPanel(today(a)), /data-action="voice-ask-speak"/);
});

test('every unsupported reason is distinguishable and explained', () => {
  const a = androidApp();
  assert.equal(a.voiceSttUnsupportedReason(), 'no_api');
  a.window.webkitSpeechRecognition = function(){};
  a.window.Capacitor = null;
  a.window.isSecureContext = false;
  assert.equal(a.voiceSttUnsupportedReason(), 'insecure');
  Object.keys(a.VOICE_STT_COPY).forEach(k => {
    const c = a.VOICE_STT_COPY[k];
    assert.ok(c && c.length > 20, k + ' has no human sentence');
    assert.match(c, /type/i, k + ' does not point at the typed path');
  });
});

test('a listening state that never returns still ends', () => {
  /* The WebView case: start() succeeds and nothing ever fires. Without its own
     way out the athlete is stuck on "Listening…" indefinitely. */
  assert.match(SRC, /VOICE_STT_TIMEOUT_MS/, 'there is no watchdog on listening');
  const fn = SRC.slice(SRC.indexOf('function askStartListening'),
                       SRC.indexOf('function askStopListening'));
  assert.match(fn, /setTimeout\(/, 'listening has no timeout');
  assert.match(fn, /mic_timeout/, 'a timeout produces no message');
  ['onresult', 'onerror', 'onend'].forEach(h =>
    assert.match(fn, new RegExp(h + '[\\s\\S]{0,80}askClearListenTimer'),
      h + ' does not clear the watchdog -- it will fire after the fact'));
});

test('cancelling returns to the panel rather than closing it', () => {
  /* Closing outright would take the typed box away at the moment the athlete
     has just discovered they cannot speak. */
  const a = androidApp({ stt: function(){} });
  a.askSet('listening', {});
  a.askStopListening();
  assert.equal(a.askState.status, 'open');
  assert.match(a.renderAskPanel(today(a)), /id="ask-input"/);
});

// ---------------------------------------------------------------------------
// DEFECT 3 — "YOUR COACH IS NOT RESPONDING"
// ---------------------------------------------------------------------------
test('REGRESSION: max_tokens leaves room for thinking AND an answer', () => {
  /* 1024 could be spent entirely on reasoning, returning no text block at all.
     Billing is on tokens produced, so the ceiling costs nothing until used. */
  const m = /const VOICE_MAX_TOKENS = (\d+);/.exec(ASK);
  assert.ok(m, 'the token ceiling has moved');
  assert.ok(Number(m[1]) >= 4096,
    'max_tokens is too low for a model whose thinking shares the budget: ' + m[1]);
});

test('an upstream failure records WHY, not merely that', () => {
  const code = ASK.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(code, /error\.type/, 'the upstream error type is not read');
  assert.match(code, /upstream status=.*type=/, 'the log cannot distinguish causes');
  assert.match(code, /empty_reply stop=/, 'an empty reply does not record stop_reason');
});

test('a rejected request retries once without the tuning parameter', () => {
  const code = ASK.replace(/\/\*[\s\S]*?\*\//g, ' ');
  assert.match(code, /noEffort/, 'there is no retry path');
  assert.match(code, /r\.status === 400 && !opts\.noEffort/,
    'the retry is not bounded to one attempt on a 400');
  assert.match(code, /if \(!opts\.noEffort\) payload\.output_config/,
    'the retry does not actually drop the parameter');
});

test('the log still carries no question, answer or credential', () => {
  const code = ASK.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  [...code.matchAll(/V\.log\(([^;]*)\)/g)].map(m => m[1]).forEach(l => {
    const expr = l.replace(/'[^']*'/g, '').replace(/"[^"]*"/g, '');
    assert.ok(!/question|context|apiKey|uid|email/.test(expr), 'sensitive material logged: ' + l);
    [...expr.matchAll(/answer(\.[A-Za-z]+)?/g)].map(x => x[1])
      .forEach(sfx => assert.equal(sfx, '.length', 'the answer itself is logged: ' + l));
  });
});

test('an unconfigured server no longer reads as a passing outage', () => {
  const a = androidApp();
  assert.ok(a.VOICE_ERROR_COPY.voice_not_configured,
    'a 503 from an unconfigured deployment still falls through to "not responding"');
  assert.notEqual(a.VOICE_ERROR_COPY.voice_not_configured,
                  a.VOICE_ERROR_COPY.coach_unavailable);
});

// ---------------------------------------------------------------------------
// THE FIXTURE THAT HID ALL THIS
// ---------------------------------------------------------------------------
test('the shot harness no longer only photographs a stubbed device', () => {
  const shots = fs.readFileSync(path.join(ROOT, 'tools', 'shots', 'voice-shots.js'), 'utf8');
  assert.match(shots, /android-app|no-speech/i,
    'every frame still manufactures speechSynthesis, so the missing control cannot reappear in a screenshot');
});
