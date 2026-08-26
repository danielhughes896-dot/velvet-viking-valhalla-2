'use strict';
/* ONE-OFF spot check: the calibration completion card, in its actual location
   (Full Plan, where a non-today completed day lives), both themes. */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = path.join(__dirname, 'out-current-fitness');
const REAL = new Date();
const TODAY = new Date(REAL.getTime() - ((REAL.getUTCDay() + 6) % 7) * 86400000)
  .toISOString().slice(0, 10);

function engine(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
const a = engine();
buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
               benchSec: 45 * 60, maxHR: 190, healthConsent: true,
               schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
const calibrate = a.calibrationNeededNow(45);
const br = a.buildBlockWeeks('half', 45, 10, { purpose: 'race', calibrate: calibrate });
a.state.days = a.buildDaysFromWeeks(br, a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
const dd = a.state.days.filter(d => d.type === 'calibration')[0];
const segs = a.orderedSegments(a.prescriptionOf(dd)) || [];
const seg = segs.filter(s => s.role === 'calibration_measure')[0];
const settle = segs.filter(s => s.role === 'calibration_settle')[0];
dd.completed = true;
dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '4:38', rpe: 8, feel: 'good' });
dd.actual.splits = [
  { segId: settle.segId, role: 'calibration_settle', label: 'Time trial — first 10 min', km: 2.3, sec: 600, paceSec: null, hr: null },
  { segId: seg.segId, role: 'calibration_measure', label: 'Same effort — final 20 min', km: 4.6, sec: 1200, paceSec: null, hr: 171 }];
a.applyCalibrationFromDay(dd);

const state = JSON.parse(JSON.stringify(a.state));
const key = a.STORAGE_KEY;

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
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  for (const theme of ['light', 'dark']){
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, colorScheme: theme });
    const page = await ctx.newPage();
    const blob = Object.assign({}, state, { view: 'full', theme, themeExplicit: true });
    await page.addInitScript(seed, { key, state: JSON.stringify(blob), theme });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.evaluate(() => window.handleSetView && window.handleSetView('full'));
    await page.waitForTimeout(300);
    await page.evaluate((week) => {
      if (window.expandedWeeks) window.expandedWeeks[week] = true;
      var dd = (window.state.days || []).filter(d => d.type === 'calibration')[0];
      if (dd) window.dayExpandOverride[dd.id] = true;
      window.renderApp();
    }, dd.week);
    await page.waitForTimeout(300);
    const el = await page.$('#day-' + dd.id);
    if (el) await el.screenshot({ path: path.join(OUT, 'cal-result-card-' + theme + '.png') });
    else console.log('day element not found for theme ' + theme);
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log('done');
})();
