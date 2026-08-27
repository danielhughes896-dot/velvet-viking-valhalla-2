'use strict';
/* TODAY, AFTER THE HIERARCHY PASS — PHOTOGRAPHED AT PHONE WIDTH.
 * ===========================================================================
 * The brief asks to see, before anything is judged: every session type on
 * Today, the "How to run this" disclosure both closed and open, Hear Today
 * both idle and playing, and Ask Coach both closed and open — in both themes.
 *
 * Each frame moves TODAY's day to the type under test through the app's own
 * state and re-renders through renderApp(), so what is photographed is the
 * product's render path, not hand-built markup. The disclosure is opened by
 * clicking the real <details> summary; Hear Today is put into its playing
 * state through voiceSetStatus(), which is the same call the press makes.
 *
 * It also MEASURES what the pass was for: how many times the same coaching
 * sentence appears anywhere on the rendered page. A repeat count above one is
 * the defect this pass exists to remove, so it is printed per frame.
 *
 *   node tools/shots/today-hierarchy-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-today-hierarchy');
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);
const TYPES = ['easy','long','tempo','threshold','interval','repetition','checkpoint','race'];

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { weeks: 12, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190,
                 schedule: { activeDays: [0,1,2,3,4,5,6], longRunDay: 6 } });
  return a;
}
const STATE = athlete();

/* Move today's slot onto the archetype under test, copying the prescription
   from a real planned day of that type so nothing is invented here. */
const becomeToday = (t) => `
  var src=state.days.filter(function(x){return x.type==='${t}';})[0];
  var cur=findDayByDate(todayStr());
  if(src&&cur){ var keep=cur.id, kd=cur.date;
    var copy=JSON.parse(JSON.stringify(src));
    copy.id=keep; copy.date=kd; copy.completed=false; copy.actual=null;
    state.days[state.days.indexOf(cur)]=copy; }
`;

const FRAMES = [];
TYPES.forEach(t => {
  FRAMES.push({ name: 'today-' + t, setup: becomeToday(t) });
});
/* The four interaction states, on one representative session each: a quality
   day (the richest disclosure) and an easy day (the leanest). */
FRAMES.push({ name: 'how-closed-threshold', setup: becomeToday('threshold') });
FRAMES.push({ name: 'how-open-threshold',   setup: becomeToday('threshold'), openHow: true });
FRAMES.push({ name: 'how-closed-easy',      setup: becomeToday('easy') });
FRAMES.push({ name: 'how-open-easy',        setup: becomeToday('easy'), openHow: true });
FRAMES.push({ name: 'hear-idle',            setup: becomeToday('easy') });
FRAMES.push({ name: 'hear-playing',         setup: becomeToday('easy') + `
  var d=findDayByDate(todayStr()); voiceSetStatus('speaking',{kind:'briefing',dayId:d.id});` });
/* The half of `speaking` where the audio has not arrived yet: the words are
   already readable and the status says so honestly. */
FRAMES.push({ name: 'hear-preparing',       setup: becomeToday('easy') + `
  var d=findDayByDate(todayStr());
  voiceSetStatus('speaking',{kind:'briefing',dayId:d.id,phase:'preparing'});` });
FRAMES.push({ name: 'hear-read-no-speech',  setup: becomeToday('easy') + `
  var d=findDayByDate(todayStr()); voiceSetStatus('shown',{kind:'briefing',dayId:d.id});` });
FRAMES.push({ name: 'ask-closed',           setup: becomeToday('easy') });
FRAMES.push({ name: 'ask-open',             setup: becomeToday('easy') + `askSet('open',{heard:'',answer:'',message:'',proposalDayId:null});` });

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

/* THE MEASUREMENT THE PASS IS ABOUT. Sentences of real coaching length,
   normalised, counted. Anything appearing twice on one screen is a repeat. */
function repeatScan(){
  const txt = (document.body.innerText || '');
  const seen = {};
  txt.split(/(?<=[.!?])\s+|\n+/).forEach(s => {
    const k = s.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ');
    if (k.split(' ').length < 6) return;
    seen[k] = (seen[k] || 0) + 1;
  });
  return Object.keys(seen).filter(k => seen[k] > 1).map(k => seen[k] + 'x ' + k.slice(0, 60));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const blobBase = JSON.parse(JSON.stringify(STATE.state));
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  /* An optional name filter. 36 frames x 2 themes opens enough browser
     contexts to exhaust a small container, so a targeted re-capture after a
     one-state change should not have to photograph the whole app:
       node tools/shots/today-hierarchy-shots.js <outDir> hear- */
  const only = process.argv[3] || '';
  const frames = only ? FRAMES.filter(f => f.name.indexOf(only) !== -1) : FRAMES;
  for (const f of frames){
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      page.on('console', m => {
        if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
          errors.push('console: ' + m.text());
      });
      const blob = Object.assign({}, blobBase, { view: 'today', theme, themeExplicit: true });
      await page.addInitScript(seed, { key: STATE.STORAGE_KEY, state: JSON.stringify(blob) });
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      /* The coach control only draws where the deployment has a coach. */
      try { await page.evaluate(() => window.voiceSetAvailable && window.voiceSetAvailable(true)); } catch (e) {}
      try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), 'today'); } catch (e) {}
      await page.waitForTimeout(200);
      try { await page.evaluate(f.setup); } catch (e) { errors.push('setup: ' + e.message); }
      try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
      await page.waitForTimeout(300);
      if (f.openHow){
        try { await page.evaluate(() => {
          const d = document.querySelector('details.how-card');
          if (d) d.open = true; else throw new Error('no how-card on this frame');
        }); } catch (e) { errors.push('openHow: ' + e.message); }
        await page.waitForTimeout(250);
      }
      const file = f.name + '-' + theme;
      await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
      const m = await page.evaluate(([scan]) => {
        const fn = new Function('return (' + scan + ')()');
        return {
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          h: document.documentElement.scrollHeight,
          theme: document.documentElement.getAttribute('data-theme'),
          hear: !!document.querySelector('[data-action="voice-listen"],[data-action="voice-stop"]'),
          ask: !!document.querySelector('[data-action="voice-ask-open"]'),
          said: !!document.querySelector('.voice-said'),
          liveRegion: !!document.querySelector('.voice-live[aria-live]'),
          fuller: (document.body.innerText || '').indexOf('Fuller detail') !== -1,
          repeats: fn()
        };
      }, [repeatScan.toString()]);
      results.push({ file, errors, m });
      console.log(file.padEnd(28) +
        ' h=' + String(m.h).padStart(5) +
        ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
        ' hear=' + (m.hear ? 'y' : '-') + ' ask=' + (m.ask ? 'y' : '-') +
        ' said=' + (m.said ? 'y' : '-') + ' live=' + (m.liveRegion ? 'y' : '-') +
        ' fullerDetail=' + (m.fuller ? 'STILL THERE' : 'gone') +
        ' repeats=' + (m.repeats.length || 0) +
        (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
      if (m.repeats.length) m.repeats.forEach(r => console.log('      repeat: ' + r));
      await page.close(); await ctx.close();
    }
  }
  await browser.close(); server.close();
  const bad = results.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1 ||
                                  r.m.repeats.length || r.m.fuller);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.file).join(', ')
                         : 'no page errors, no horizontal overflow, no repeated coaching, note gone');
})();
