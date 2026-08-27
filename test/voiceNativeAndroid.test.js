'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, RUNTIME_RELATIVE } = require('./harness.js');
const { buildPlan } = require('./fixtures.js');

/* NATIVE SPEECH IN THE INSTALLED ANDROID APP
 * ===========================================================================
 * The WebView limitation was an implementation constraint, not a product
 * requirement: Android WebView exposes webkitSpeechRecognition with nothing
 * behind it and no speechSynthesis at all. Both are answered natively --
 * a local plugin for the microphone, @capacitor-community/text-to-speech for
 * the voice -- with the browser paths kept for real browsers and typing kept
 * everywhere.
 *
 * THE PRIVACY RULE THIS FILE PROTECTS ABOVE ALL. Android's ordinary recogniser
 * may send audio to the device's speech service. A spoken question to a running
 * coach can contain health information, so Valhalla asks for the ON-DEVICE
 * recogniser only and refuses rather than routing an athlete's voice to a third
 * party. That is a product decision, and it is enforced on both sides of the
 * bridge.
 */

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, RUNTIME_RELATIVE), 'utf8');
const PLUGIN = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main',
  'java', 'com', 'velvetviking', 'valhalla', 'VvvSpeechPlugin.java'), 'utf8');
const MANIFEST = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main',
  'AndroidManifest.xml'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'android', 'app', 'src', 'main',
  'java', 'com', 'velvetviking', 'valhalla', 'MainActivity.java'), 'utf8');
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const TODAY = '2026-08-24';

function app(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {};
  a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 14, startDate: '2026-07-01', distanceKey: '10k', volume: 40,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  a.state.view = 'today';
  a.voiceSetAvailable(true);
  return a;
}
/* The installed app: Capacitor present, no speechSynthesis, and a decoy
   webkitSpeechRecognition exactly as Android WebView provides. */
function installed(a, over){
  const o = over || {};
  a.window.webkitSpeechRecognition = function(){};
  a.window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      VvvSpeech: Object.assign({
        available: () => Promise.resolve({ supported:true, onDevice:true, granted:false }),
        listen: () => Promise.resolve({ transcript:'why this session today', onDevice:true }),
        cancel: () => {}
      }, o.stt || {}),
      TextToSpeech: Object.assign({
        speak: () => Promise.resolve(), stop: () => {},
        getSupportedVoices: () => Promise.resolve({ voices:[
          { name:'en-gb-x-rjs#male_1-local', lang:'en-GB' },
          { name:'English (United Kingdom) female', lang:'en-GB' }] })
      }, o.tts || {})
    }
  };
  return a;
}
const today = a => a.findDayByDate(TODAY);

// ---------------------------------------------------------------------------
// NATIVE INPUT
// ---------------------------------------------------------------------------
test('the installed app uses the native path, not the WebView decoy', async () => {
  const a = installed(app());
  await a.voiceCheckNativeStt();
  assert.equal(a.voiceNativeSttUsable(), true);
  assert.equal(a.voiceSttUnsupportedReason(), null);
  /* The decoy constructor is present and must not be what gets used. */
  assert.ok(a.voiceRecognitionCtor(), 'precondition: WebView exposes the decoy');
});

test('the microphone is drawn in the installed app', async () => {
  const a = installed(app());
  await a.voiceCheckNativeStt();
  a.askSet('open', {});
  assert.match(a.renderAskPanel(today(a)), /data-action="voice-ask-speak"/);
});

test('a spoken question is transcribed, shown, sent and answered aloud', async () => {
  const a = installed(app());
  await a.voiceCheckNativeStt();
  let sentQ = null, spoke = null, spokenFlag = null;
  a.askSend = (q, o) => { sentQ = q; spokenFlag = o && o.spoken; return Promise.resolve(null); };
  a.voiceSpeak = t => { spoke = t; return true; };
  a.askStartListening();
  await new Promise(r => setImmediate(r));
  assert.equal(a.askState.heard, 'why this session today', 'the transcript was not shown back');
  assert.equal(sentQ, 'why this session today', 'the transcript was not sent');
  assert.equal(spokenFlag, true, 'the send did not record that it came by voice');
});

test('permission denial is an answer, not a hang', async () => {
  const a = installed(app(), { stt: { listen: () => Promise.reject({ code:'PERMISSION_DENIED' }) } });
  await a.voiceCheckNativeStt();
  a.askStartListening();
  await new Promise(r => setImmediate(r));
  assert.equal(a.askState.status, 'error');
  assert.match(a.askState.message, /Microphone access is off/);
  assert.match(a.renderAskPanel(today(a)), /id="ask-input"/, 'typing must survive a denial');
});

test('no speech, busy and failure each say something true', async () => {
  for (const [code, rx] of [['NO_SPEECH', /Didn’t catch anything/],
                            ['BUSY', /using the microphone/],
                            ['FAILED', /Could not hear that/]]){
    const a = installed(app(), { stt: { listen: () => Promise.reject({ code }) } });
    await a.voiceCheckNativeStt();
    a.askStartListening();
    await new Promise(r => setImmediate(r));
    assert.equal(a.askState.status, 'error', code + ' did not resolve');
    assert.match(a.askState.message, rx, code + ' produced the wrong message');
  }
});

test('cancellation returns to the panel with the typed box intact', async () => {
  const a = installed(app(), { stt: { listen: () => Promise.reject({ code:'CANCELLED' }) } });
  await a.voiceCheckNativeStt();
  a.askStartListening();
  await new Promise(r => setImmediate(r));
  assert.equal(a.askState.status, 'open', 'a cancel should not look like a failure');
  assert.match(a.renderAskPanel(today(a)), /id="ask-input"/);
});

test('rapid repeated presses cannot stack recognisers', async () => {
  let starts = 0;
  const a = installed(app(), { stt: { listen: () => { starts++; return new Promise(() => {}); } } });
  await a.voiceCheckNativeStt();
  a.askStartListening();
  a.askStartListening();
  a.askStartListening();
  assert.equal(starts, 1, 'a second press started a second recogniser');
});

test('the watchdog still applies to the native path', () => {
  const fn = SRC.slice(SRC.indexOf('function askStartListeningNative'),
                       SRC.indexOf('function askStartListening()'));
  assert.match(fn, /VOICE_STT_TIMEOUT_MS/, 'the native listen has no watchdog');
  assert.match(fn, /askClearListenTimer/, 'the watchdog is never cleared');
  assert.match(fn, /cancel\(\)/, 'a timeout does not cancel the recogniser');
});

test('cancel reaches the native plugin', () => {
  const fn = SRC.slice(SRC.indexOf('function askStopListening'),
                       SRC.indexOf('function askSend'));
  assert.match(fn, /voiceNativeStt\(\)/, 'cancelling never tells the plugin');
});

// ---------------------------------------------------------------------------
// THE PRIVACY RULE
// ---------------------------------------------------------------------------
test('Valhalla asks for the on-device recogniser and refuses the networked one', async () => {
  const a = installed(app(), { stt: {
    available: () => Promise.resolve({ supported:true, onDevice:false }) } });
  await a.voiceCheckNativeStt();
  assert.equal(a.voiceNativeSttUsable(), false);
  assert.equal(a.voiceSttUnsupportedReason(), 'no_on_device');
  a.askSet('open', {});
  const panel = a.renderAskPanel(today(a));
  assert.ok(!/data-action="voice-ask-speak"/.test(panel),
    'a microphone was drawn on a phone that can only transcribe by sending audio away');
  assert.match(panel, /sending it away/, 'the athlete is not told why');
});

test('the request always demands on-device, on both sides of the bridge', () => {
  assert.match(SRC, /requireOnDevice:\s*true/, 'the web layer does not demand on-device');
  assert.match(PLUGIN, /requireOnDevice/, 'the plugin ignores the requirement');
  assert.match(PLUGIN, /NO_ON_DEVICE/, 'the plugin has no refusal for it');
  assert.match(PLUGIN, /createOnDeviceSpeechRecognizer/, 'the on-device recogniser is never used');
  assert.match(PLUGIN, /isOnDeviceRecognitionAvailable/);
});

test('no raw audio is read, stored or sent', () => {
  assert.match(PLUGIN, /onBufferReceived\(byte\[\] buffer\)\s*\{\s*\/\* never read or stored \*\/\s*\}/,
    'the audio buffer callback does something');
  assert.ok(!/FileOutputStream|MediaRecorder|AudioRecord|writeBytes/.test(PLUGIN),
    'the plugin touches raw audio');
  const askSrc = fs.readFileSync(path.join(ROOT, 'api', '_voice-ask.js'), 'utf8');
  assert.ok(!/audio|blob|base64|multipart/i.test(askSrc.replace(/\/\*[\s\S]*?\*\//g, ' ')),
    'the model endpoint accepts something audio-shaped');
});

test('no transcript is persisted or logged', () => {
  assert.ok(!/Log\.[dviwe]\(/.test(PLUGIN), 'the plugin writes to logcat');
  assert.ok(!/localStorage[^;]*(transcript|heard)/.test(SRC), 'a transcript is persisted');
  const ask = SRC.slice(SRC.indexOf('function askStartListeningNative'),
                        SRC.indexOf('function askSend'));
  assert.ok(!/console\.log/.test(ask), 'the transcript path logs');
});

// ---------------------------------------------------------------------------
// NATIVE OUTPUT
// ---------------------------------------------------------------------------
test('the installed app can speak, and prefers the native engine', () => {
  const a = installed(app());
  assert.equal(typeof a.window.speechSynthesis, 'undefined', 'precondition: WebView cannot speak');
  assert.equal(a.voiceAvailable(), true, 'the installed app still reports it cannot speak');
  let spoken = null;
  a.window.Capacitor.Plugins.TextToSpeech.speak = req => { spoken = req; return Promise.resolve(); };
  assert.equal(a.voiceSpeak('Today you have got 10 kilometres.', {}), true);
  return new Promise(r => setImmediate(r)).then(() => {
    assert.ok(spoken, 'nothing reached the native engine');
    assert.equal(spoken.lang, 'en-GB');
    assert.match(spoken.text, /10 kilometres/);
  });
});

test('an en-GB female voice is preferred from whatever the phone reports', () => {
  const a = installed(app());
  return a.voiceResolveNativeVoice().then(idx => {
    assert.equal(idx, 1, 'the female en-GB voice was not chosen from the device list');
  });
});

test('no voice name is hard-coded', () => {
  const region = SRC.slice(SRC.indexOf('function voiceResolveNativeVoice'),
                           SRC.indexOf('var voiceState'));
  assert.ok(!/en-gb-x-|Google UK|Samantha|Siri/i.test(region),
    'a device-specific voice name is hard-coded');
});

test('LISTEN speaks in the installed app rather than only showing text', async () => {
  const a = installed(app());
  let spoke = 0;
  a.window.Capacitor.Plugins.TextToSpeech.speak = () => { spoke++; return Promise.resolve(); };
  a.handleVoiceListen(today(a).id);
  /* voiceSpeak resolves the device's voice list first, so the call reaches the
     engine on a later tick. */
  await new Promise(r => setTimeout(r, 0));
  await new Promise(r => setImmediate(r));
  assert.equal(spoke, 1, 'the briefing was not spoken natively');
});

test('the Listen control promises speech when the app can speak', () => {
  const a = installed(app());
  const html = a.renderVoiceCard(today(a));
  assert.match(html, /data-action="voice-listen"/);
  assert.match(html, />Hear today</, 'the installed app should now offer to HEAR, not merely read');
});

test('stopping reaches the native engine too', () => {
  const a = installed(app());
  let stopped = 0;
  a.window.Capacitor.Plugins.TextToSpeech.stop = () => { stopped++; };
  a.voiceStop();
  assert.equal(stopped, 1);
});

test('the speech vendor is named in exactly one server file, and never in the browser', () => {
  /* THIS TEST USED TO SAY "no cloud TTS provider appeared anywhere". The
     founder has commissioned one, so the blanket ban is gone -- but what the
     ban was PROTECTING is not, and is asserted here instead:

       1. the runtime shipped to the browser never names a speech vendor, so
          the phone cannot talk to one directly and no credential of one can
          be anywhere near it;
       2. exactly ONE file in api/ names the vendor endpoint, so "how many
          places can spend money on speech" stays answerable by grep -- the
          same discipline the model endpoint is held to in _voice-ask.js;
       3. no OTHER cloud TTS vendor has appeared alongside it. */
  /* The ban is on REACHING the vendor, not on naming it. A comment that says
     which sub-processor speaks the briefing is documentation an athlete is
     entitled to; an endpoint or a credential in the browser is a defect. */
  const VENDORS = /api\.elevenlabs\.io|texttospeech\.googleapis|polly\.[a-z0-9-]*\.amazonaws|speech\.microsoft|tts\.[a-z]+\.com/i;
  assert.ok(!VENDORS.test(SRC),
    'the browser runtime reaches a speech vendor directly -- it must go through our own server');

  const apiFiles = fs.readdirSync(path.join(ROOT, 'api')).filter(f => f.endsWith('.js'));
  const naming = apiFiles.filter(f =>
    /api\.elevenlabs\.io/i.test(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')));
  assert.deepEqual(naming.length, 1,
    'the speech vendor endpoint is named in ' + naming.length + ' files: ' + naming.join(', '));
  assert.equal(naming[0], '_voice-tts.js', 'the vendor endpoint moved out of _voice-tts.js');

  /* The commissioned vendor is bounded by the count above; this catches a
     SECOND one being added beside it. */
  const OTHERS = /texttospeech\.googleapis|polly\.[a-z0-9-]*\.amazonaws|speech\.microsoft|tts\.[a-z]+\.com/i;
  apiFiles.forEach(f => assert.ok(
    !OTHERS.test(fs.readFileSync(path.join(ROOT, 'api', f), 'utf8')),
    'a second cloud TTS provider appeared in api/' + f));
});

test('the ElevenLabs credential is unreachable from the browser', () => {
  /* The one that would actually cost the founder money if it were wrong. */
  assert.ok(!/ELEVENLABS_API_KEY/.test(SRC), 'the runtime names the ElevenLabs key variable');
  assert.ok(!/xi-api-key/i.test(SRC), 'the runtime carries the vendor auth header');
  const raw = fs.readFileSync(path.join(ROOT, 'api', '_voice-tts.js'), 'utf8');
  assert.ok(/process\.env/.test(raw), 'the key is not read from the environment');
  /* And the real voice ids never appear as a literal in anything shipped. */
  assert.ok(!/jkSXBeN4g5pNelNQ3YWw/.test(SRC),
    'a voice id is hard-coded in the browser -- the catalogue is resolved server-side');
});

// ---------------------------------------------------------------------------
// BROWSER AND FALLBACK
// ---------------------------------------------------------------------------
test('a real browser still uses the Web Speech path', () => {
  const a = app();
  a.window.webkitSpeechRecognition = function(){};
  assert.equal(a.voiceSttUnsupportedReason(), null);
  assert.equal(a.voiceNativeSttUsable(), false, 'no plugin in a browser');
});

test('a browser with no recogniser degrades to typing with a reason', () => {
  const a = app();
  assert.equal(a.voiceSttUnsupportedReason(), 'no_api');
  a.askSet('open', {});
  const panel = a.renderAskPanel(today(a));
  assert.ok(!/voice-ask-speak/.test(panel));
  assert.match(panel, /id="ask-input"/);
});

test('typing survives every unsupported state', () => {
  const a = app();
  Object.keys(a.VOICE_STT_COPY).forEach(k => {
    const c = a.VOICE_STT_COPY[k];
    assert.match(c, /type/i, k + ' does not point at the typed path');
    ['SpeechRecognizer', 'webkit', 'API', 'plugin', 'Capacitor', 'WebView', 'Google']
      .forEach(w => assert.ok(!new RegExp(w, 'i').test(c),
        k + ' leaks implementation vocabulary: ' + w));
  });
});

test('before the native probe answers, no microphone is drawn', () => {
  /* Fail closed while the answer is unknown. */
  const a = installed(app());
  assert.equal(a.voiceNativeSttState, null, 'precondition: not probed yet');
  assert.notEqual(a.voiceSttUnsupportedReason(), null,
    'a microphone was offered before the platform had answered');
});

// ---------------------------------------------------------------------------
// THE NATIVE PROJECT
// ---------------------------------------------------------------------------
test('the plugin is registered before the bridge is built', () => {
  assert.match(MAIN, /registerPlugin\(VvvSpeechPlugin\.class\)/, 'the plugin is not registered');
  /* Against CODE, not comments: the note above the method explains this rule
     and naturally quotes super.onCreate(), which a raw scan reads as the call. */
  const code = MAIN.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const reg = code.indexOf('registerPlugin');
  const sup = code.indexOf('super.onCreate');
  assert.ok(reg > 0 && sup > reg,
    'registerPlugin must precede super.onCreate or it is not in the bridge');
});

test('the manifest declares the microphone and can see a recogniser', () => {
  assert.match(MANIFEST, /android\.permission\.RECORD_AUDIO/, 'no microphone permission');
  assert.match(MANIFEST, /android\.speech\.RecognitionService/,
    'without a <queries> entry the recogniser is invisible from Android 11');
  assert.match(MANIFEST, /android\.hardware\.microphone"\s+android:required="false"/,
    'a device with no microphone must still be able to install the app');
  assert.match(MANIFEST, /allowBackup="false"/, 'existing privacy posture must survive');
});

test('the permission is requested at runtime, not assumed', () => {
  assert.match(PLUGIN, /@Permission\(alias = VvvSpeechPlugin\.MIC/, 'no permission declaration');
  assert.match(PLUGIN, /requestPermissionForAlias/, 'the permission is never requested');
  assert.match(PLUGIN, /@PermissionCallback/, 'the result is never handled');
  assert.match(PLUGIN, /PERMISSION_DENIED/, 'a denial has no code');
});

test('every native outcome resolves or rejects exactly once', () => {
  /* An unresolved PluginCall is a permanent "Listening…" on the athlete's
     screen, so there is one exit and every path goes through it. */
  const code = PLUGIN.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.match(code, /private void finish\(/, 'there is no single exit');
  assert.match(code, /listening = null;/, 'the call is not cleared on exit');
  /* Every terminating callback must reach finish(). onError carries a switch
     over the platform's error codes, so the window is generous on purpose --
     what is being asserted is that the path ends, not how long it is. */
  ['onResults', 'onError'].forEach(h => {
    const at = code.indexOf(h + '(');
    assert.ok(at > 0, h + ' is missing');
    const body = code.slice(at, at + 1400);
    assert.match(body, /finish\(/, h + ' does not finish the call');
  });
});

test('the text-to-speech dependency is pinned and Capacitor 8 compatible', () => {
  const v = PKG.dependencies['@capacitor-community/text-to-speech'];
  assert.ok(v, 'the TTS plugin is not a dependency');
  assert.match(v, /^\^?8\./, 'the pinned major does not match Capacitor 8: ' + v);
  assert.match(PKG.dependencies['@capacitor/core'], /^\^?8\./);
  assert.ok(!PKG.dependencies['@capacitor-community/speech-recognition'],
    'the stale speech-recognition plugin was added despite declaring only Capacitor 7');
});

test('no new serverless function was added for any of this', () => {
  const fns = fs.readdirSync(path.join(ROOT, 'api'))
    .filter(f => f.endsWith('.js') && !f.startsWith('_'));
  assert.ok(fns.length <= 12, 'the function budget is exceeded: ' + fns.length);
  assert.equal(fns.includes('speech.js'), false);
  assert.equal(fns.includes('tts.js'), false);
});
