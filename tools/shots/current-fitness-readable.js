'use strict';
/* READABLE-VIEWPORT PROOF for the Current Fitness product-completion pass.
 * Not full-page zoomed-out captures -- real device-sized viewport shots,
 * scrolled/cropped to the actual surface under review, so the visual
 * hierarchy can be judged the way an athlete would actually see it.
 *
 *   node tools/shots/current-fitness-readable.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-current-fitness-readable');
const WIDTHS = [360, 390, 430];
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);

function engine(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
function athlete(opts){
  const o = opts || {};
  const a = engine();
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190, healthConsent: true,
                 schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
  if (o.noBenchmark) delete a.state.setup.benchmark;
  const calibrate = a.calibrationNeededNow(45);
  const br = a.buildBlockWeeks('half', 45, 10, { purpose: 'race', calibrate: calibrate });
  a.state.days = a.buildDaysFromWeeks(br, a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  a.state.setup.purpose = 'race';
  let calDay = null;
  if (o.logIt){
    calDay = a.state.days.filter(d => d.type === 'calibration')[0];
    const segs = a.orderedSegments(a.prescriptionOf(calDay)) || [];
    const seg = segs.filter(s => s.role === 'calibration_measure')[0];
    const settle = segs.filter(s => s.role === 'calibration_settle')[0];
    calDay.completed = true;
    calDay.actual = Object.assign(a.emptyActual(), { km: calDay.km, pace: '4:38', rpe: 8, feel: 'good' });
    calDay.actual.splits = [
      { segId: settle.segId, role: 'calibration_settle', label: 'Time trial — first 10 min', km: 2.3, sec: 600, paceSec: null, hr: null },
      { segId: seg.segId, role: 'calibration_measure', label: 'Same effort — final 20 min', km: 4.6, sec: 1200, paceSec: null, hr: 171 }];
    a.applyCalibrationFromDay(calDay);
  }
  return { app: a, calDay };
}

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript' };
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
  const goal = athlete({ noBenchmark: true });
  const calibrated = athlete({ logIt: true });
  const scenarios = {
    goal: { state: JSON.parse(JSON.stringify(goal.app.state)), key: goal.app.STORAGE_KEY },
    calibrated: { state: JSON.parse(JSON.stringify(calibrated.app.state)), key: calibrated.app.STORAGE_KEY, calDayId: calibrated.calDay.id, calWeek: calibrated.calDay.week }
  };

  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];

  for (const width of WIDTHS){
    for (const theme of ['light', 'dark']){
      // ---- 1/2/4. VALHALLA OVERVIEW HERO: Current Fitness (primary + vs Goal + evidence state) ----
      for (const key of ['goal', 'calibrated']){
        const s = scenarios[key];
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, s.state, { theme, themeExplicit: true });
        await page.addInitScript(seed, { key: s.key, state: JSON.stringify(blob), theme });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => window.handleSetView && window.handleSetView('planhq'));
        await page.waitForTimeout(300);
        // VIEWPORT screenshot of just the hero element, not the full page.
        const hero = await page.$('.v-hero');
        const name = 'hero-' + key + '-' + width + '-' + theme;
        if (hero) await hero.screenshot({ path: path.join(OUT, name + '.png') });
        const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
        results.push({ name, errors, overflow: m.scrollW > m.clientW + 1 });
        await ctx.close();
      }

      // ---- 3. CALIBRATION COMPLETE (day card, viewport-cropped to the card) ----
      {
        const s = scenarios.calibrated;
        const ctx = await browser.newContext({ viewport: { width, height: 1400 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, s.state, { theme, themeExplicit: true });
        await page.addInitScript(seed, { key: s.key, state: JSON.stringify(blob), theme });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => window.handleSetView && window.handleSetView('full'));
        await page.waitForTimeout(300);
        await page.evaluate((arg) => {
          if (window.expandedWeeks) window.expandedWeeks[arg.week] = true;
          window.dayExpandOverride[arg.id] = true;
          window.renderApp();
        }, { week: s.calWeek, id: s.calDayId });
        await page.waitForTimeout(300);
        const el = await page.$('.cal-result');
        const name = 'calibration-complete-' + width + '-' + theme;
        if (el) await el.screenshot({ path: path.join(OUT, name + '.png') });
        else errors.push('.cal-result not found');
        results.push({ name, errors, overflow: false });
        await ctx.close();
      }

      // ---- 5. SETTINGS -> Training Zone Paces detail view ----
      {
        const s = scenarios.calibrated;
        const ctx = await browser.newContext({ viewport: { width, height: 1400 }, deviceScaleFactor: 2,
          isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        const blob = Object.assign({}, s.state, { theme, themeExplicit: true });
        await page.addInitScript(seed, { key: s.key, state: JSON.stringify(blob), theme });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(600);
        await page.evaluate(() => window.handleSetView && window.handleSetView('settings'));
        await page.waitForTimeout(300);
        try { await page.click('[data-action="open-record"][data-record="zones"]', { timeout: 3000 }); await page.waitForTimeout(300); }
        catch (e) { errors.push('could not open zones panel: ' + e.message); }
        const panel = await page.$('.modal-body');
        const name = 'settings-zones-' + width + '-' + theme;
        if (panel) await panel.screenshot({ path: path.join(OUT, name + '.png') });
        else errors.push('.modal-body not found');
        const m = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
        results.push({ name, errors, overflow: m.scrollW > m.clientW + 1 });
        await ctx.close();
      }
    }
  }

  await browser.close(); server.close();
  results.forEach(r => console.log(r.name.padEnd(32) + ' overflow=' + (r.overflow ? 'YES' : 'no') +
    (r.errors.length ? '  ERRORS: ' + r.errors.join(' | ') : '')));
  const bad = results.filter(r => r.errors.length || r.overflow);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.name).join(', ') : 'all clean');
})();
