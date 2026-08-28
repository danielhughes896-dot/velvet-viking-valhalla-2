'use strict';
/* "PREPARING VOICE…" — REPRODUCED, THEN PROVEN FIXED, IN A REAL BROWSER.
 * ===========================================================================
 * The unit tests drive a fake clock. This drives a real one, in Chromium, with
 * the real render loop, and does the two things a unit test cannot:
 *
 *   1. REPRODUCES THE ORIGINAL BUG by neutralising the fix in the page, so the
 *      "before" is this code with the guards off rather than a description of
 *      it. A fix whose before-state cannot be demonstrated is a fix nobody can
 *      check.
 *   2. Watches the card over real time and reports what an athlete would see.
 *
 * Scenarios, all with the request stalled exactly as a dead radio stalls it:
 *
 *   stuck-before   guards disabled  -> the card never leaves "Preparing voice…"
 *   watchdog       guards on, no other speech route -> "Voice unavailable"
 *   fallback       guards on, device voice available -> it speaks instead
 *   stop           athlete presses Stop while preparing
 *
 *   node tools/voice/preparing-state-check.js
 */
const path = require('path');
const http = require('http');
const fs = require('fs');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const MIME = { '.png':'image/png','.css':'text/css','.js':'text/javascript',
               '.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml' };

function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/api/voice-tts'){ return; }   /* never answers -- a dead radio */
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type':'text/html; charset=utf-8' });
      return res.end(html);
    }
    const f = path.join(ROOT, url.replace(/^\/+/, ''));
    if (f.indexOf(ROOT) !== 0 || !fs.existsSync(f) || fs.statSync(f).isDirectory()){
      res.writeHead(404); return res.end('nf');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url:'http://127.0.0.1:' + server.address().port })));
}

const SCENARIOS = [
  { name:'stuck-before', guards:false, native:false },
  { name:'watchdog',     guards:true,  native:false },
  { name:'fallback',     guards:true,  native:true  },
  { name:'stop',         guards:true,  native:false, stopAfterMs:1500 }
];

(async () => {
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
  const problems = [];
  const seen = {};

  for (const sc of SCENARIOS){
    const ctx = await browser.newContext({ viewport:{ width:390, height:900 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true, colorScheme:'dark' });
    const page = await ctx.newPage();
    await page.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status:200, contentType:'text/css', body:'' }));
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    await page.goto(url, { waitUntil:'domcontentloaded' });
    await page.waitForTimeout(600);

    const out = await page.evaluate(async (s) => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      /* A signed-in athlete whose TTS request will never come back. */
      window.cloudSignedIn = () => true;
      window.cloudSession = { access_token:'t', expires_at: Math.floor(Date.now()/1000)+3600 };
      window.cloudRefreshIfNeeded = () => Promise.resolve(true);
      window.ttsCloudDown = false;
      window.ttsInflight = {};
      window.nativePlugin = () => null;
      /* speechSynthesis is a read-only accessor on window in Chromium, so a
         plain assignment silently does nothing -- which made the first run of
         this sweep report that the device voice was never tried when in fact
         it was never installed. defineProperty is what actually replaces it. */
      Object.defineProperty(window, 'speechSynthesis', { configurable: true,
        value: s.native
          ? { cancel(){}, speak(u){ window.__spoke = true; setTimeout(() => u.onend && u.onend(), 50); },
              getVoices(){ return []; } }
          : null });
      if (s.native) window.SpeechSynthesisUtterance = function(t){ this.text = t; };
      else window.SpeechSynthesisUtterance = undefined;

      /* THE "BEFORE". Neutralise both guards so the page behaves exactly as it
         did before this pass -- an unbounded request and no watchdog. */
      if (!s.guards){
        window.TTS_CLIENT_TIMEOUT_MS = 999999;
        window.VOICE_PREPARING_MAX_MS = 999999;
      }

      const samples = [];
      window.patchVoiceCard = () => {};
      const t0 = performance.now();
      const sample = () => samples.push({
        at: Math.round(performance.now() - t0),
        status: window.voiceState.status, phase: window.voiceState.phase });

      window.voiceCloudSpeak('Keep tomorrow easy and see how the calf feels.', { kind:'answer' });
      sample();
      if (s.stopAfterMs) setTimeout(() => { window.handleVoiceStopPress(); sample(); }, s.stopAfterMs);
      const tick = setInterval(sample, 500);
      await new Promise(r => setTimeout(r, 16000));
      clearInterval(tick);
      sample();

      /* What the athlete would be looking at, rendered through the real card. */
      window.voiceScriptFor = () => ({ kind:'briefing', lines:['Keep tomorrow easy.'] });
      window.voiceMayRender = () => true;
      window.voiceAvailable = () => true;
      let card = '';
      try{ card = window.renderVoiceCardBody({ id:'d1', date: window.todayStr(),
                                               type:'easy', km:8 }); }catch(e){ card = 'ERR ' + e.message; }
      return { samples, spoke: !!window.__spoke,
               final: window.voiceState,
               cardText: card.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() };
    }, sc);

    const last = out.samples[out.samples.length - 1];
    const stuck = last.status === 'speaking' && last.phase === 'preparing';
    const leftAt = out.samples.find(x => !(x.status === 'speaking' && x.phase === 'preparing'));
    seen[sc.name] = { stuck, last, leftAt };

    console.log('--- ' + sc.name + ' ---');
    console.log('  guards            : ' + (sc.guards ? 'on' : 'OFF (reproducing the bug)'));
    console.log('  left preparing at : ' + (leftAt ? leftAt.at + 'ms' : 'NEVER (still preparing at 16s)'));
    console.log('  final state       : ' + last.status + '/' + last.phase);
    console.log('  device voice spoke: ' + (out.spoke ? 'yes' : 'no'));
    console.log('  card reads        : ' + (out.cardText.slice(0, 96) || '(empty)'));
    console.log('  page errors       : ' + (errors.length ? errors.slice(0,2).join(' | ') : 'none'));

    if (errors.length) problems.push(sc.name + ': page errors');
    if (sc.name === 'stuck-before'){
      if (!stuck) problems.push('stuck-before: the original bug could not be reproduced, so the ' +
                                'other scenarios prove nothing');
    } else {
      if (stuck) problems.push(sc.name + ': STILL STUCK IN PREPARING at 16s');
      if (/Preparing voice/.test(out.cardText)) problems.push(sc.name + ': card still says Preparing voice');
    }
    if (sc.name === 'watchdog'){
      if (last.status !== 'unavailable') problems.push('watchdog: did not land on unavailable');
      if (!/Voice unavailable/.test(out.cardText)) problems.push('watchdog: no unavailable copy');
      if (!/Keep tomorrow easy/.test(out.cardText)) problems.push('watchdog: THE WORDS WERE LOST');
      if (/error|failed|timeout|abort/i.test(out.cardText)) problems.push('watchdog: technical wording leaked');
    }
    if (sc.name === 'fallback'){
      if (!out.spoke) problems.push('fallback: the device voice was never tried');
      if (last.status === 'unavailable') problems.push('fallback: gave up despite a working voice');
    }
    if (sc.name === 'stop'){
      if (last.status !== 'shown') problems.push('stop: did not land on shown, got ' + last.status);
      if (leftAt && leftAt.at > 2500) problems.push('stop: took ' + leftAt.at + 'ms to leave preparing');
    }
    await page.close(); await ctx.close();
  }

  await browser.close(); server.close();
  console.log('');
  if (problems.length){ console.log('PROBLEMS:\n  ' + problems.join('\n  ')); process.exitCode = 1; }
  else console.log('The original bug reproduces with the guards off and is gone with them on; ' +
                   'every scenario reaches a terminal state and keeps the words.');
})();
