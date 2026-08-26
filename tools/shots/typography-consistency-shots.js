'use strict';
/* TYPOGRAPHY CONSISTENCY PASS -- live proof for every rule this pass touched.
 * Not full-page zoomed-out captures -- viewport-sized shots cropped to the
 * actual changed element, at 360/390/430 x light/dark.
 *
 *   node tools/shots/typography-consistency-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-typography');
const WIDTHS = [360, 390, 430];
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);

function engine(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
function athlete(){
  const a = engine();
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190, healthConsent: true,
                 schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
  const br = a.buildBlockWeeks('half', 45, 10, { purpose: 'race' });
  a.state.days = a.buildDaysFromWeeks(br, a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  // Complete a couple of early sessions with a note, so Execution Review,
  // note-chips and the readiness card all have real content to photograph.
  const easy = a.state.days.filter(d => d.type === 'easy')[0];
  easy.completed = true;
  easy.actual = Object.assign(a.emptyActual(), { km: easy.km, pace: '5:20', rpe: 4, feel: 'good',
    notes: 'Legs felt heavy after yesterday, slept badly.' });
  return a;
}

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript',
  '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' };
function serve(){
  const html = fs.readFileSync(RUNTIME, 'utf8');
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){ res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(html); }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file)] || 'application/octet-stream'});
    res.end(fs.readFileSync(file));
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({server, url:'http://127.0.0.1:'+server.address().port+'/'})));
}
function seed(p){
  try{ localStorage.setItem(p.key, p.state); }catch(e){}
  try{ localStorage.setItem('vvv_theme', JSON.stringify({theme:p.theme, explicit:true})); }catch(e){}
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const a = athlete();
  const state = JSON.parse(JSON.stringify(a.state));
  const key = a.STORAGE_KEY;
  const easyId = a.state.days.filter(d => d.completed)[0].id;

  // Also render start.html's plan-preview element directly, standalone.
  const startHtml = fs.readFileSync(path.join(ROOT, 'start.html'), 'utf8');

  const server = await serve();
  const startServer = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (url === '/' || url === '/index.html'){ res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); return res.end(startHtml); }
    const file = path.join(ROOT, url.replace(/^\/+/, ''));
    if (file.indexOf(ROOT) !== 0 || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => startServer.listen(0, '127.0.0.1', r));
  const startPort = startServer.address().port;

  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];

  for (const width of WIDTHS){
    for (const theme of ['light', 'dark']){
      // ---- 1. VALHALLA overview + RECORD tab (Progress panel .stat .l) ----
      {
        const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, state, { theme, themeExplicit: true });
        await page.addInitScript(seed, { key, state: JSON.stringify(blob), theme });
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => window.handleSetView && window.handleSetView('planhq'));
        await page.waitForTimeout(300);
        const name = 'valhalla-overview-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
        results.push({ name, errors });

        await page.evaluate(() => window.handleSetPlanhqTab && window.handleSetPlanhqTab('record'));
        await page.waitForTimeout(300);
        try {
          await page.click('.ev-card[data-record="progress"]', { timeout: 3000 });
          await page.waitForTimeout(300);
        } catch (e) { errors.push('progress panel: ' + e.message); }
        const panel = await page.$('.modal-body');
        const name2 = 'record-progress-' + width + '-' + theme;
        if (panel) await panel.screenshot({ path: path.join(OUT, name2 + '.png') });
        results.push({ name: name2, errors: [] });
        await ctx.close();
      }

      // ---- 2. TODAY: completed session (Execution Review + note chips) ----
      {
        const ctx = await browser.newContext({ viewport: { width, height: 1600 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, state, { theme, themeExplicit: true });
        await page.addInitScript(seed, { key, state: JSON.stringify(blob), theme });
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate((id) => {
          window.dayExpandOverride[id] = true;
          window.renderApp();
        }, easyId);
        await page.waitForTimeout(300);
        const el = await page.$('#day-' + easyId);
        const name = 'today-completed-day-' + width + '-' + theme;
        if (el) await el.screenshot({ path: path.join(OUT, name + '.png') });
        results.push({ name, errors });
        await ctx.close();
      }

      // ---- 3. SETTINGS -> readiness card + Export/Backup dividers ----
      {
        const ctx = await browser.newContext({ viewport: { width, height: 1600 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, state, { theme, themeExplicit: true });
        await page.addInitScript(seed, { key, state: JSON.stringify(blob), theme });
        await page.goto(server.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => window.handleSetView && window.handleSetView('settings'));
        await page.waitForTimeout(300);
        const name = 'settings-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
        results.push({ name, errors });
        await ctx.close();
      }

      // ---- 4. start.html: plan preview (.step / .big / .card h3) ----
      {
        const ctx = await browser.newContext({ viewport: { width, height: 1600 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        await page.addInitScript((t) => { try{ localStorage.setItem('vvv_theme', JSON.stringify({theme:t, explicit:true})); }catch(e){} }, theme);
        await page.goto('http://127.0.0.1:' + startPort + '/', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(400);
        const name = 'start-page-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
        results.push({ name, errors });
        await ctx.close();
      }
    }
  }

  await browser.close(); server.server.close(); startServer.close();
  results.forEach(r => console.log(r.name.padEnd(32) + (r.errors.length ? '  ERRORS: ' + r.errors.join(' | ') : '  ok')));
  const bad = results.filter(r => r.errors.length);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.name).join(', ') : 'all clean');
})();
