'use strict';
/* THE TWO PLACES AN ATHLETE MEETS STRAVA, PHOTOGRAPHED.
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
 *   node tools/shots/strava-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-hierarchy-after');
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
const FRAMES = {
  /* PART C — the states the hierarchy brief asks to see before anything is
     redesigned. Photographed from the product's own render path. */
  'valhalla-nothing-measured': { view: 'planhq', setup: `planhqTab='valhalla'; state.athlete.performances=[];` },
  'valhalla-measured':         { view: 'planhq', setup: `planhqTab='valhalla';
      state.athlete.performances=[{date:'2026-08-10',km:5,timeSec:23*60,source:'race'}];` },
  'record-nothing-measured':   { view: 'planhq', setup: `planhqTab='record'; state.athlete.performances=[];` },
  'record-measured':           { view: 'planhq', setup: `planhqTab='record';
      state.athlete.performances=[{date:'2026-08-10',km:5,timeSec:23*60,source:'race'}];` },
  'fullplan-collapsed':        { view: 'planhq', setup: `planhqTab='full';` },
  'fullplan-expanded':         { view: 'planhq', setup: `planhqTab='full';
      expandedWeeks={}; expandedWeeks[1]=true; expandedWeeks[2]=true;` },
  'review-whole-session':      { view: 'today', setup: `
      var d=state.days.filter(function(x){return x.type==='threshold';})[0];
      if(d){ d.date=todayStr(); d.completed=true; d.actual={km:d.km,pace:'5:12',paceUnit:'km'}; }` },
  'review-rich-evidence':      { view: 'today', setup: `
      var d=state.days.filter(function(x){return x.type==='threshold';})[0];
      if(d){ d.date=todayStr(); d.completed=true;
             d.actual={km:d.km,pace:'5:12',paceUnit:'km',hr:158,rpe:6,feel:'good',note:'Felt strong late.'}; }` },
  'today-simple-log':          { view: 'today', setup: `
      var d=findDayByDate(todayStr()); if(d){ d.completed=false; d.actual=null; }` },
  'review-distance-only':      { view: 'today', setup: `
      var d=state.days.filter(function(x){return x.type==='threshold';})[0];
      if(d){ d.date=todayStr(); d.completed=true; d.actual={km:d.km}; }` },
  'review-distance-partial':   { view: 'today', setup: `
      var d=state.days.filter(function(x){return x.type==='threshold';})[0];
      if(d){ d.date=todayStr(); d.completed=true; d.actual={km:Math.round(d.km*0.6*10)/10}; }` }
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
        strava: (document.body.innerText || '').indexOf('Strava') !== -1,
        nothing: (document.body.innerText || '').indexOf('Nothing measured') !== -1
      }));
      results.push({ file, errors, m });
      console.log(file.padEnd(26) +
        ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES ' + m.scrollW + '>' + m.clientW : 'no') +
        ' theme=' + m.theme + ' strava=' + (m.strava ? 'shown' : '-') +
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
