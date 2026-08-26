'use strict';
/* THE TODAY VOICE COACH, PHOTOGRAPHED.
 *
 *   builder-offer     Build Your Programme, first screen, Strava available
 *   builder-connected the same screen once connected
 *   settings-off      Settings, not connected
 *   settings-on       Settings, connected, named account
 *   settings-error    Settings after a failed attempt
 *   settings-gated    Settings while the private-beta gate is shut
 *
 * Availability and connection are pushed through the app's own setters, so
 * what is photographed is the real render path rather than hand-built markup.
 *
 *   node tools/shots/voice-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-voice');
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190,
                 schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
  return a;
}
const STATE = athlete();

/* Each frame is a (view, setup) pair. The setup runs INSIDE the page against
   the real app, so the render path is the product's own. */
/* Each frame is a (view, setup) pair. The setup runs INSIDE the page against
   the real app, so what is photographed is the product's own render path.

   speechSynthesis is stubbed rather than driven: a headless browser has no
   voices, so voiceAvailable() would be false and the Listen control would be
   undrawn for a reason that has nothing to do with the design being reviewed.
   The stub makes the control appear; it never makes a sound. */
const SPEECH = `
  window.speechSynthesis = window.speechSynthesis || {
    getVoices: () => [{ name:'Google UK English Female', lang:'en-GB', localService:false }],
    speak(){}, cancel(){}
  };
  window.voiceSelected = null; window.voiceSelectedResolved = false;
`;
const FRAMES = {
  'today-listen':      { view:'today', setup: SPEECH + `voiceSetAvailable(true); renderApp();` },
  'today-speaking':    { view:'today', setup: SPEECH + `voiceSetAvailable(true); renderApp();
                            voiceState={status:'speaking',kind:'briefing',dayId:null}; patchVoiceCard();` },
  'today-ask-open':    { view:'today', setup: SPEECH + `voiceSetAvailable(true); renderApp();
                            askSet('open',{});` },
  'today-ask-listening':{view:'today', setup: SPEECH + `voiceSetAvailable(true); renderApp();
                            askSet('listening',{});` },
  'today-ask-answer':  { view:'today', setup: SPEECH + `voiceSetAvailable(true); renderApp();
                            askSet('answered',{heard:'why threshold today?',
                              answer:'Threshold is the session that moves your sustainable pace, and today is the one day this week your legs are fresh enough to hold it. Keep it controlled — you should finish feeling you could have run another kilometre.'});` },
  'today-ask-error':   { view:'today', setup: SPEECH + `voiceSetAvailable(true); renderApp();
                            askSet('error',{heard:'can I move my long run?',
                              message:'Your coach is not responding — try again shortly'});` },
  'today-strava-day':  { view:'today', setup: SPEECH + `voiceSetAvailable(true);
                            var d=findDayByDate(todayStr()); if(d){d.stravaActivityId='555';} renderApp();` },
  /* THE CORRECTION, PHOTOGRAPHED. A Strava-connected athlete -- history
     imported on other days -- must still be offered both controls on a Today
     that Strava never touched. */
  'today-strava-coexist': { view:'today', setup: SPEECH + `voiceSetAvailable(true);
                            var ds=state.days.filter(function(x){return x.date<todayStr()&&x.type!=='rest';});
                            if(ds[0]){ applyCompletion(ds[0],true);
                              ds[0].actual=Object.assign(emptyActual(),{km:ds[0].km,pace:'5:10'});
                              ds[0].stravaActivityId='999'; }
                            renderApp();` },
  'today-completed':   { view:'today', setup: SPEECH + `voiceSetAvailable(true);
                            var d=findDayByDate(todayStr());
                            if(d){ applyCompletion(d,true);
                              d.actual=Object.assign(emptyActual(),{km:d.km,pace:'5:18',rpe:6}); }
                            renderApp();` },
  'today-ask-disabled':{ view:'today', setup: SPEECH + `voiceSetAvailable(false); renderApp();` },
  'settings-guidance': { view:'settings', setup: SPEECH + `renderApp();` },

  /* THE DEVICE THE FEATURE ACTUALLY SHIPPED TO, and the frame whose absence let
     a missing control reach production. Every frame above STUBS speechSynthesis
     so the Listen button appears; a fixture that manufactures the capability
     cannot photograph its absence. These two remove it instead -- the installed
     Capacitor app, where Android WebView exposes no synthesiser and no working
     speech recogniser. */
  'android-app-no-speech': { view:'today', setup: `
      try{ delete window.speechSynthesis; }catch(e){}
      window.Capacitor = { isNativePlatform: function(){ return true; } };
      window.webkitSpeechRecognition = function(){};
      voiceSetAvailable(true); renderApp();` },
  'android-app-reading':   { view:'today', setup: `
      try{ delete window.speechSynthesis; }catch(e){}
      window.Capacitor = { isNativePlatform: function(){ return true; } };
      window.webkitSpeechRecognition = function(){};
      voiceSetAvailable(true); renderApp();
      handleVoiceListen(findDayByDate(todayStr()).id);` },
  'android-app-ask':       { view:'today', setup: `
      try{ delete window.speechSynthesis; }catch(e){}
      window.Capacitor = { isNativePlatform: function(){ return true; } };
      window.webkitSpeechRecognition = function(){};
      voiceSetAvailable(true); renderApp(); askSet('open',{});` }
};

const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.webp':'image/webp',
               '.ico':'image/x-icon', '.json':'application/json', '.js':'text/javascript',
               '.css':'text/css', '.woff2':'font/woff2', '.html':'text/html; charset=utf-8' };
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const blobBase = JSON.parse(JSON.stringify(STATE.state));
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  for (const name of Object.keys(FRAMES)){
    for (const theme of ['light', 'dark']){
      const f = FRAMES[name];
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
          errors.push('console: ' + m.text());
      });
      const blob = Object.assign({}, blobBase, { view: f.view, theme, themeExplicit: true });
      await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), f.view); } catch (e) {}
      await page.waitForTimeout(300);
      try { await page.evaluate(f.setup); } catch (e) { errors.push('setup: ' + e.message); }
      try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
      await page.waitForTimeout(400);
      const file = name + '-' + theme;
      await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        theme: document.documentElement.getAttribute('data-theme'),
        voice: !!document.querySelector('#voice-card'),
        listen: !!document.querySelector('[data-action="voice-listen"]'),
        ask: !!document.querySelector('[data-action="voice-ask-open"]')
      }));
      results.push({ file, errors, m });
      console.log(file.padEnd(26) +
        ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES ' + m.scrollW + '>' + m.clientW : 'no') +
        ' theme=' + m.theme +
        ' card=' + (m.voice ? 'y' : '-') + ' listen=' + (m.listen ? 'y' : '-') +
        ' ask=' + (m.ask ? 'y' : '-') +
        (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
      await page.close(); await ctx.close();
    }
  }
  await browser.close(); server.close();
  const bad = results.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.file).join(', ')
                         : 'no page errors, no horizontal overflow');
})();
