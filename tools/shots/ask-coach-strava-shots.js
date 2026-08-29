'use strict';
/* ASK COACH AFTER A STRAVA SYNC — THE FOUR ACCEPTANCE STATES
 * ===========================================================================
 * Today's session has been completed and synced from Strava. What is
 * photographed, in both themes at 390px, in a real Chromium:
 *
 *   1  the card: the privacy line, and Ask Coach still on it
 *   2  the Ask panel open, with forward-looking suggestions
 *   3  "How did today's run go?"  -> the boundary answer, no request opened
 *   4  "What am I doing next?"    -> a normal coaching answer about the
 *                                    Valhalla-owned future session
 *
 * WHAT IS REAL AND WHAT IS STUBBED, because acceptance evidence that blurs
 * that is worth nothing. Everything on the device is real: the state, the
 * import, the provenance boundary, the gate, the context assembly, the card.
 * The MODEL's reply in shot 4 is stubbed -- there is no Anthropic key here --
 * and the request body the app actually built is written out beside the
 * screenshots so the context can be read rather than trusted.
 *
 *   node tools/shots/ask-coach-strava-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan, logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));
const S = require(path.join(__dirname, '..', '..', 'api', '_strava.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-ask-coach-strava');
const TODAY = '2026-08-05';

/* An athlete mid-block who ran this morning and let Strava sync it. */
function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 14,
    startDate: a.addDays(a.todayStr(), -21), benchSec: a.clockToSec('0:45:00'),
    lthr: 168, maxHR: 188 });
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach(d => logAsPrescribed(a, d));
  const dd = a.findDayByDate(t);
  a.stravaWriteActivity(dd, S.normaliseActivity({
    id: 4242, type: 'Run', start_date_local: t + 'T07:00:00Z',
    distance: (dd.km || 10) * 1000, moving_time: Math.round((dd.km || 10) * 268),
    has_heartrate: true, average_heartrate: 163, max_heartrate: 174,
    total_elevation_gain: 88,
    splits_metric: [{ distance: 1000, moving_time: 271, average_heartrate: 158 },
                    { distance: 1000, moving_time: 264, average_heartrate: 161 }]
  }));
  return a;
}

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
    /* The deployment says it has a coach. Nothing else about the coach is
       served here -- the ask itself is intercepted in the page. */
    if (url === '/api/voice-enabled'){
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ enabled: true }));
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
function seed(p){
  try {
    localStorage.setItem(p.key, p.state);
    localStorage.setItem(p.sessKey, p.sess);
  } catch (e) {}
}

const SHOTS = [
  { name: '1-card',        ask: null },
  { name: '2-ask-open',    ask: null, open: true },
  { name: '3-retro',       ask: 'How did today’s run go?' },
  { name: '4-forward',     ask: 'What am I doing next?' }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const notes = [];

  for (const shot of SHOTS){
    for (const theme of ['light', 'dark']){
      const a = athlete();
      const ctx = await browser.newContext({ viewport: { width: 390, height: 1000 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', r =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));

      const blob = Object.assign({}, JSON.parse(JSON.stringify(a.state)),
        { view: 'today', theme, themeExplicit: true });
      await page.addInitScript(seed, {
        key: a.STORAGE_KEY, state: JSON.stringify(blob),
        sessKey: 'vvv_cloud_session',
        sess: JSON.stringify({ access_token:'t', refresh_token:'r',
          expires_at: Date.now() + 36000000, user_id:'u', email:'a@b.c' })
      });
      await page.addInitScript(`(function(){
        var pinned = new Date(${JSON.stringify(TODAY + 'T09:00:00Z')}).getTime();
        var RealDate = Date;
        function D(){ return arguments.length ? new RealDate(...arguments) : new RealDate(pinned); }
        D.now = function(){ return pinned; };
        D.parse = RealDate.parse; D.UTC = RealDate.UTC; D.prototype = RealDate.prototype;
        window.Date = D;
        /* EVERY COACH REQUEST IS RECORDED AND ANSWERED DETERMINISTICALLY.
           Recorded so the context can be READ afterwards; answered so shot 4
           photographs a real answered card rather than an error state. */
        window.__coachCalls = [];
        var realFetch = window.fetch;
        window.fetch = function(u, init){
          var s = String(u || '');
          if (s.indexOf('/api/voice-ask') !== -1){
            window.__coachCalls.push(init && init.body);
            return Promise.resolve({ ok:true, status:200,
              headers:{ get: function(){ return 'application/json'; } },
              json: function(){ return Promise.resolve({
                answer: 'Tomorrow is your interval session — 4x600m at threshold, ' +
                        'around 4:12 per kilometre with 90 seconds jog between. ' +
                        'Hold the first rep back; the last two are the ones that count.' }); } });
          }
          if (s.indexOf('grant_type=refresh_token') !== -1){
            return Promise.resolve({ ok:true, status:200,
              headers:{ get: function(){ return 'application/json'; } },
              json: function(){ return Promise.resolve({ access_token:'t2',
                refresh_token:'r2', expires_in:36000 }); } });
          }
          if (s.indexOf('supabase') !== -1 || s.indexOf('/api/') !== -1){
            return Promise.resolve({ ok:true, status:200,
              headers:{ get: function(){ return 'application/json'; } },
              json: function(){ return Promise.resolve(
                s.indexOf('voice-enabled') !== -1 ? { enabled:true } : {}); },
              text: function(){ return Promise.resolve(''); } });
          }
          return realFetch.apply(window, arguments);
        };
        /* Speech is not part of the evidence and does not exist here. */
        window.__spoke = [];
        window.addEventListener('load', function(){
          if (window.voiceSpeak) { var r = window.voiceSpeak;
            window.voiceSpeak = function(t, o){ window.__spoke.push(o||{}); return true; }; }
        });
      })();`);

      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(900);

      if (shot.open || shot.ask){
        await page.evaluate(() => window.handleVoiceAskOpen && window.handleVoiceAskOpen());
        await page.waitForTimeout(400);
      }
      if (shot.ask){
        await page.evaluate(q => window.askSend && window.askSend(q), shot.ask);
        await page.waitForTimeout(900);
      }

      const read = await page.evaluate(() => ({
        askVisible: !!document.querySelector('[data-action="voice-ask-open"]'),
        listenDay: (document.querySelector('[data-action="voice-listen"]') || {})
                     .getAttribute ? document.querySelector('[data-action="voice-listen"]')
                     .getAttribute('data-day') : null,
        listenLabel: (document.querySelector('[data-action="voice-listen"] span') || {}).textContent || null,
        note: (document.querySelector('.voice-note') || {}).textContent || null,
        answer: (document.querySelector('.ask-answer') || {}).textContent || null,
        source: (document.querySelector('.ask-source') || {}).textContent || null,
        chips: Array.from(document.querySelectorAll('.ask-chip')).map(c => c.textContent),
        coachCalls: window.__coachCalls.length,
        lastBody: window.__coachCalls.length ? window.__coachCalls[window.__coachCalls.length - 1] : null,
        todayIsStrava: !!(window.voiceTodayIsStravaDerived && window.voiceTodayIsStravaDerived())
      }));

      const el = await page.$('#voice-card');
      const file = path.join(OUT, shot.name + '-' + theme + '.png');
      if (el) await el.screenshot({ path: file });
      else await page.screenshot({ path: file });
      /* Full page too: the card in the context of the screen around it. */
      await page.screenshot({ path: path.join(OUT, shot.name + '-' + theme + '-page.png') });

      /* THE CONTEXT, WRITTEN OUT. Shot 4's request body is the evidence that
         nothing from the imported run left the device. */
      if (read.lastBody){
        fs.writeFileSync(path.join(OUT, shot.name + '-' + theme + '-request.json'),
          JSON.stringify(JSON.parse(read.lastBody), null, 2));
      }
      delete read.lastBody;
      notes.push({ shot: shot.name, theme, errors, ...read });
      await ctx.close();
    }
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'notes.json'), JSON.stringify(notes, null, 2));
  notes.forEach(n => console.log(
    n.shot.padEnd(12), n.theme.padEnd(6),
    'ask=' + (n.askVisible ? 'yes' : 'NO '),
    'listen=' + (n.listenDay || '-'),
    'calls=' + n.coachCalls,
    'errs=' + n.errors.length,
    n.answer ? ('| ' + n.answer.slice(0, 60)) : ''));
  console.log('\nwrote ' + OUT);
})();
