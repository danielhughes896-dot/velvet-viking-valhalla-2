'use strict';
/* WHERE THE TIME ACTUALLY GOES — measured, not guessed.
 * ===========================================================================
 * Three timelines, on the real runtime, in a real browser at phone size:
 *
 *   COLD START    navigation -> script parse -> init() -> first paint -> Today
 *   ASK COACH     tap -> the "thinking" state actually PAINTED -> response
 *   HEAR TODAY    tap -> the briefing actually PAINTED -> audio
 *
 * THE MEASUREMENT THAT MATTERS IS "PAINTED", NOT "SET". Setting a loading
 * state and then doing 200ms of synchronous work before yielding leaves the
 * interface visibly dead for 200ms, however early the state was assigned. So
 * every UI timing here is taken from a double requestAnimationFrame after the
 * tap -- the first frame the browser could actually show the athlete.
 *
 * The network is stubbed at a fixed, declared delay so the numbers isolate OUR
 * cost from the vendors'. Vendor latency is real and is reported separately.
 *
 *   node tools/perf/measure.js [--json]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);
/* A declared, fixed stand-in for vendor time so our own cost is isolated. */
const NET_MS = 400;

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 14, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190, healthConsent: true,
                 schedule: { activeDays: [1,2,3,5,6], longRunDay: 6 } });
  return a;
}
const STATE = athlete();

const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2',
               '.html':'text/html; charset=utf-8' };
function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1',
    () => r({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}
function seed(p){ try { localStorage.setItem(p.key, p.state); } catch (e) {} }

/* Every network call the app can make, answered after a fixed delay. Installed
   before any app code runs, so nothing escapes to a real host and no timing
   here is at the mercy of a vendor. */
function stubNetwork(delayMs){
  window.__net = [];
  const t0 = performance.now();
  const realFetch = window.fetch;
  window.fetch = function(url, init){
    const u = String(url);
    window.__net.push({ url: u, at: Math.round(performance.now() - t0) });
    return new Promise((resolve) => setTimeout(() => {
      if (u.indexOf('/api/voice-tts') !== -1){
        return resolve({ ok:true, status:200,
          blob: () => Promise.resolve(new Blob([new Uint8Array([1,2,3])], { type:'audio/mpeg' })) });
      }
      resolve({ ok:true, status:200,
        json: () => Promise.resolve({ enabled:true, answer:'A short answer.', connected:false }),
        text: () => Promise.resolve('{}') });
    }, delayMs));
  };
  window.__realFetch = realFetch;
}

/* The first frame the browser could actually show the athlete. */
const PAINTED = `(function(){
  return new Promise(function(r){
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ r(performance.now()); }); });
  });
})()`;

(async () => {
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const out = {};

  // -------------------------------------------------------------------------
  // COLD START
  // -------------------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    /* THE FONT HOST IS UNREACHABLE FROM THIS SANDBOX, and an unanswered
       render-blocking stylesheet stalls for the full proxy timeout -- which
       would drown every other number in this timeline. Answered instantly
       instead, so what is measured below is OUR cost. The render-blocking
       dependency itself is measured separately, in fontBlocking. */
    await page.route('https://fonts.googleapis.com/**', r =>
      r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.route('https://fonts.gstatic.com/**', r =>
      r.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
    const blob = Object.assign({}, JSON.parse(JSON.stringify(STATE.state)), { view:'today' });
    await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
    await page.addInitScript(stubNetwork, NET_MS);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1500);   /* let deferred work settle */

    out.coldStart = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paints = {};
      performance.getEntriesByType('paint').forEach(p => { paints[p.name] = Math.round(p.startTime); });
      const marks = {};
      performance.getEntriesByType('mark').forEach(m => { marks[m.name] = Math.round(m.startTime); });
      return {
        responseEnd: Math.round(nav.responseEnd || 0),
        domInteractive: Math.round(nav.domInteractive || 0),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        loadEvent: Math.round(nav.loadEventEnd || 0),
        firstPaint: paints['first-paint'] || null,
        firstContentfulPaint: paints['first-contentful-paint'] || null,
        marks: marks,
        htmlBytes: Math.round((nav.transferSize || 0) / 1024),
        network: window.__net,
        todayDrawn: !!document.querySelector('#voice-card, .coach-card, [data-action="voice-listen"]')
      };
    });
    out.coldStart.resources = await page.evaluate(() =>
      performance.getEntriesByType('resource')
        .map(r => ({ name: String(r.name).split('/').pop().slice(0, 40),
                     start: Math.round(r.startTime), dur: Math.round(r.duration),
                     kb: Math.round((r.transferSize || 0) / 1024) }))
        .sort((a, b) => b.dur - a.dur).slice(0, 12));
    await page.close(); await ctx.close();
  }

  // -------------------------------------------------------------------------
  // IS THE FONT STYLESHEET ON THE CRITICAL PATH?
  // Answered after a declared delay, so the question is not "is the network
  // slow" but "does OUR first paint wait for it".
  // -------------------------------------------------------------------------
  {
    const FONT_DELAY = 1000;
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    await page.route('https://fonts.googleapis.com/**', async r => {
      await new Promise(x => setTimeout(x, FONT_DELAY));
      r.fulfill({ status: 200, contentType: 'text/css', body: '' });
    });
    await page.route('https://fonts.gstatic.com/**', r =>
      r.fulfill({ status: 200, contentType: 'font/woff2', body: '' }));
    const blob = Object.assign({}, JSON.parse(JSON.stringify(STATE.state)), { view:'today' });
    await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
    await page.addInitScript(stubNetwork, NET_MS);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    out.fontBlocking = await page.evaluate((d) => {
      const paints = {};
      performance.getEntriesByType('paint').forEach(p => { paints[p.name] = Math.round(p.startTime); });
      const nav = performance.getEntriesByType('navigation')[0] || {};
      return { fontDelayMs: d,
               firstPaint: paints['first-paint'] || null,
               domInteractive: Math.round(nav.domInteractive || 0),
               firstVoiceProbeAt: (window.__net && window.__net[0]) ? window.__net[0].at : null };
    }, FONT_DELAY);
    await page.close(); await ctx.close();
  }

  // -------------------------------------------------------------------------
  // SYNCHRONOUS COST OF THE WORK EACH TAP DOES BEFORE IT CAN YIELD
  // -------------------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const blob = Object.assign({}, JSON.parse(JSON.stringify(STATE.state)), { view:'today' });
    await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
    await page.addInitScript(stubNetwork, NET_MS);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    out.syncWork = await page.evaluate(() => {
      const time = (label, fn, runs) => {
        runs = runs || 5;
        try { fn(); } catch(e) { return { label, error: String(e.message).slice(0, 60) }; }
        const t = performance.now();
        for (let i = 0; i < runs; i++) fn();
        return { label, ms: +((performance.now() - t) / runs).toFixed(1) };
      };
      const dd = state.days.filter(d => d.date === todayStr())[0];
      const raw = localStorage.getItem(Object.keys(localStorage).filter(k => /vvv|valhalla/i.test(k))[0] || '');
      return [
        time('JSON.parse(state)', () => { if (raw) JSON.parse(raw); }),
        time('renderApp()', () => renderApp(), 3),
        time('renderTodayView()', () => renderTodayView(), 3),
        time('voiceCoachContext()', () => voiceCoachContext()),
        time('voiceScriptFor(today)', () => voiceScriptFor(dd)),
        time('coachBrief(today)', () => coachBrief(dd)),
        time('patchVoiceCard()', () => patchVoiceCard()),
        time('renderVoiceCard(today)', () => renderVoiceCard(dd))
      ];
    });
    await page.close(); await ctx.close();
  }

  // -------------------------------------------------------------------------
  // ASK COACH — tap to PAINTED thinking state
  // -------------------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const blob = Object.assign({}, JSON.parse(JSON.stringify(STATE.state)), { view:'today' });
    await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
    await page.addInitScript(stubNetwork, NET_MS);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    out.askCoach = await page.evaluate(async (NET) => {
      const painted = () => new Promise(r =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
      voiceSetAvailable(true);
      cloudSession = cloudSession || { access_token:'tok', expires_at: Date.now() + 3600000 };
      window.cloudRefreshIfNeeded = () => Promise.resolve(true);

      const tOpen = performance.now();
      handleVoiceAskOpen();
      const openPainted = await painted();

      const tAsk = performance.now();
      const p = askSend('How hard should today feel?');
      const syncReturn = performance.now();            /* when the tap handler let go */
      const thinkingPainted = await painted();
      const thinkingVisible = !!document.querySelector('.ask-thinking, [class*="thinking"]') ||
        /thinking|Thinking|…/.test((document.getElementById('voice-card') || {}).innerText || '');
      await p;
      const answered = performance.now();
      return {
        openToPaint: Math.round(openPainted - tOpen),
        tapToHandlerReturn: Math.round(syncReturn - tAsk),
        tapToThinkingPainted: Math.round(thinkingPainted - tAsk),
        thinkingVisible: thinkingVisible,
        tapToAnswer: Math.round(answered - tAsk),
        stubbedNetworkMs: NET
      };
    }, NET_MS);
    await page.close(); await ctx.close();
  }

  // -------------------------------------------------------------------------
  // HEAR TODAY — tap to PAINTED briefing, and to audio
  // -------------------------------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport:{ width:390, height:844 },
      deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const blob = Object.assign({}, JSON.parse(JSON.stringify(STATE.state)), { view:'today' });
    await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
    await page.addInitScript(stubNetwork, NET_MS);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    out.hearToday = await page.evaluate(async (NET) => {
      const painted = () => new Promise(r =>
        requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));
      voiceSetAvailable(true);
      cloudSession = cloudSession || { access_token:'tok', expires_at: Date.now() + 3600000 };
      window.cloudRefreshIfNeeded = () => Promise.resolve(true);
      let audioAt = null;
      const t0 = performance.now();
      window.Audio = function(){ audioAt = performance.now();
        this.play = () => Promise.resolve(); this.pause = () => {}; };

      const dd = state.days.filter(d => d.date === todayStr())[0];
      const tTap = performance.now();
      handleVoiceListen(dd.id);
      const handlerReturn = performance.now();
      const briefingPainted = await painted();
      const card = document.getElementById('voice-card');
      const txt = (card && card.innerText) || '';
      const briefingVisible = !!(card && card.querySelector('.voice-said'));
      const label = /Playing briefing/.test(txt) ? 'Playing briefing'
                  : /Preparing/.test(txt) ? 'Preparing voice' : '(none)';
      for (let i = 0; i < 60 && audioAt === null; i++) await new Promise(r => setTimeout(r, 25));
      return {
        tapToHandlerReturn: Math.round(handlerReturn - tTap),
        tapToBriefingPainted: Math.round(briefingPainted - tTap),
        briefingVisible: briefingVisible,
        statusLabelWhileWaiting: label,
        tapToAudio: audioAt === null ? null : Math.round(audioAt - tTap),
        stubbedNetworkMs: NET
      };
    }, NET_MS);
    await page.close(); await ctx.close();
  }

  await browser.close(); server.close();

  if (process.argv.indexOf('--json') !== -1){
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const cs = out.coldStart;
  console.log('\n=== COLD START (phone viewport, network stubbed at ' + NET_MS + 'ms) ===');
  console.log('  HTML delivered (responseEnd)   ' + cs.responseEnd + ' ms   (' + cs.htmlBytes + ' KB)');
  console.log('  domInteractive (script parsed) ' + cs.domInteractive + ' ms');
  console.log('  first paint                    ' + cs.firstPaint + ' ms');
  console.log('  first contentful paint         ' + cs.firstContentfulPaint + ' ms');
  console.log('  DOMContentLoaded               ' + cs.domContentLoaded + ' ms');
  console.log('  load event                     ' + cs.loadEvent + ' ms');
  console.log('  Today drawn                    ' + (cs.todayDrawn ? 'yes' : 'NO'));
  console.log('  network calls started during startup:');
  (cs.network || []).forEach(n => console.log('      +' + String(n.at).padStart(5) + ' ms  ' + n.url));
  console.log('  slowest resources:');
  (cs.resources || []).forEach(r => console.log('      ' + String(r.dur).padStart(5) + ' ms  ' +
    String(r.kb).padStart(5) + ' KB  ' + r.name));

  const fb = out.fontBlocking;
  console.log('\n=== IS THE FONT STYLESHEET ON THE CRITICAL PATH? ===');
  console.log('  font stylesheet answered after ' + fb.fontDelayMs + ' ms');
  console.log('  first paint                    ' + fb.firstPaint + ' ms');
  console.log('  script executed (domInteractive)' + fb.domInteractive + ' ms');
  console.log('  first app network call at      ' + fb.firstVoiceProbeAt + ' ms');
  console.log('  verdict: ' + (fb.firstPaint >= fb.fontDelayMs
    ? 'BLOCKING -- first paint waits for the font stylesheet'
    : 'not blocking'));

  console.log('\n=== SYNCHRONOUS WORK (one call, averaged) ===');
  out.syncWork.forEach(w => console.log('  ' + String(w.ms == null ? w.error : w.ms + ' ms').padStart(12) +
    '  ' + w.label));

  console.log('\n=== ASK COACH ===');
  const ac = out.askCoach;
  console.log('  open panel -> painted          ' + ac.openToPaint + ' ms');
  console.log('  submit -> handler returned     ' + ac.tapToHandlerReturn + ' ms  <-- interface frozen for this long');
  console.log('  submit -> thinking PAINTED     ' + ac.tapToThinkingPainted + ' ms');
  console.log('  thinking state visible         ' + (ac.thinkingVisible ? 'yes' : 'NO'));
  console.log('  submit -> answer               ' + ac.tapToAnswer + ' ms (of which ' + NET_MS + ' ms is the stub)');

  console.log('\n=== HEAR TODAY ===');
  const ht = out.hearToday;
  console.log('  tap -> handler returned        ' + ht.tapToHandlerReturn + ' ms  <-- interface frozen for this long');
  console.log('  tap -> briefing PAINTED        ' + ht.tapToBriefingPainted + ' ms');
  console.log('  briefing visible               ' + (ht.briefingVisible ? 'yes' : 'NO'));
  console.log('  status label while waiting     ' + ht.statusLabelWhileWaiting);
  console.log('  tap -> audio started           ' + ht.tapToAudio + ' ms (of which ' + NET_MS + ' ms is the stub)');
  console.log('');
})();
