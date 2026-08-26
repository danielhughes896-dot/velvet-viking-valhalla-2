'use strict';
/* CURRENT FITNESS / THRESHOLD CALIBRATION -- THE NEW VISUAL SURFACES,
 * PHOTOGRAPHED.
 *
 * Reuses tools/shots/calibration-shots.js's exact athlete builder and
 * serve/shoot approach -- what is photographed is what the product actually
 * produces, not a hand-built fixture. Four athletes:
 *
 *   goal        no benchmark, no measurement -- the goal fallback
 *   benchmark   a benchmark set, nothing measured
 *   needs       calibration eligible, not yet run
 *   done        the calibration logged -- zones now measured
 *   hronly      calibration logged, HR rejected, pace accepted
 *
 * Surfaces covered: Plan HQ (Pace Reference provenance line), Today (the
 * calibration day card and its completion result), and Settings -> Training
 * & Zones (the new Current Fitness vs Goal panel).
 *
 *   node tools/shots/current-fitness-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-current-fitness');
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
  a.state.days = a.buildDaysFromWeeks(br, a.state.setup.raceDate,
    a.state.setup.schedule, TODAY, false);
  a.state.setup.purpose = 'race';
  if (o.logIt || o.hrOnly){
    const dd = a.state.days.filter(d => d.type === 'calibration')[0];
    const segs = a.orderedSegments(a.prescriptionOf(dd)) || [];
    const seg = segs.filter(s => s.role === 'calibration_measure')[0];
    const settle = segs.filter(s => s.role === 'calibration_settle')[0];
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '4:38', rpe: 8, feel: 'good' });
    dd.actual.splits = [
      { segId: settle.segId, role: 'calibration_settle',
        label: 'Time trial — first 10 min', km: 2.3, sec: 600, paceSec: null, hr: null },
      { segId: seg.segId, role: 'calibration_measure',
        label: 'Same effort — final 20 min', km: 4.6, sec: 1200, paceSec: null,
        hr: o.hrOnly ? 42 /* implausible_hr -- pace still accepted */ : 171 }];
    a.applyCalibrationFromDay(dd);
  }
  return a;
}
const SCENARIOS = {
  goal:      () => athlete({ noBenchmark: true }),
  benchmark: () => athlete({}),
  needs:     () => athlete({ logIt: false }),
  done:      () => athlete({ logIt: true }),
  hronly:    () => athlete({ hrOnly: true })
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
function seed(p){
  try { localStorage.setItem(p.key, p.state); } catch (e) {}
  try { localStorage.setItem('vvv_theme', JSON.stringify({ theme: p.theme, explicit: true })); } catch (e) {}
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const states = {};
  Object.keys(SCENARIOS).forEach(k => {
    const a = SCENARIOS[k]();
    states[k] = { key: a.STORAGE_KEY, state: JSON.parse(JSON.stringify(a.state)) };
    console.log(k.padEnd(10) + ' anchor=' + a.currentFitnessAnchor().source +
      ' lthr=' + a.state.setup.lthr + ' tPaceSec=' + (a.state.setup.thresholdPaceSecPerKm || '-'));
  });

  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  for (const scenario of Object.keys(SCENARIOS)){
    for (const width of WIDTHS){
      for (const theme of ['light', 'dark']){
        for (const surface of ['planhq', 'today', 'zones']){
          const ctx = await browser.newContext({ viewport: { width, height: 900 },
                                                 deviceScaleFactor: 2, isMobile: true,
                                                 hasTouch: true, colorScheme: theme });
          const page = await ctx.newPage();
          const errors = [];
          page.on('pageerror', e => errors.push(String(e && e.message || e)));
          page.on('console', m => {
            if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
              errors.push('console: ' + m.text());
          });
          const view = surface === 'zones' ? 'settings' : (surface === 'planhq' ? 'planhq' : 'today');
          const blob = Object.assign({}, states[scenario].state,
            { view: view, theme: theme, themeExplicit: true });
          await page.addInitScript(seed,
            { key: states[scenario].key, state: JSON.stringify(blob), theme });
          await page.goto(url, { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(700);
          try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), view); }
          catch (e) {}
          await page.waitForTimeout(350);
          if (surface === 'today'){
            try {
              await page.evaluate(() => {
                var dd = (window.state.days || []).filter(d => d.type === 'calibration')[0];
                if (!dd) return;
                window.dayExpandOverride[dd.id] = true;
                window.renderApp();
              });
            } catch (e) {}
            await page.waitForTimeout(300);
          }
          if (surface === 'zones'){
            try {
              await page.click('[data-action="open-record"][data-record="zones"]', { timeout: 3000 });
              await page.waitForTimeout(300);
            } catch (e) { errors.push('could not open zones panel: ' + e.message); }
          }
          const name = scenario + '-' + surface + '-' + width + '-' + theme;
          await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
          const m = await page.evaluate(() => ({
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            text: (document.body.innerText || '')
          }));
          const hasVdot = /\bVDOT\b/.test(m.text);
          results.push({ name, errors, overflow: m.scrollW > m.clientW + 1, hasVdot });
          console.log(name.padEnd(34) +
            ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES ' + m.scrollW + '>' + m.clientW : 'no') +
            ' vdotLeak=' + (hasVdot ? 'YES' : 'no') +
            (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
          await page.close(); await ctx.close();
        }
      }
    }
  }
  await browser.close(); server.close();
  const bad = results.filter(r => r.errors.length || r.overflow || r.hasVdot);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.name).join(', ') : 'no page errors, no horizontal overflow, no VDOT leak');
})();
