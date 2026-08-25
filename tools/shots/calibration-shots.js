'use strict';
/* THE EARLY CALIBRATION SESSION, PHOTOGRAPHED.
 *
 * Three athletes, because the whole point of the feature is that they get
 * different treatment:
 *
 *   needs    no LTHR, consented -- the calibration is in week one
 *   done     the same athlete after logging it -- zones now measured
 *   noconsent  the same athlete without Article 9 consent -- no session at all
 *
 * Reuses tools/shots/capture.js's serve/shoot approach and the app's own
 * generator, so what is photographed is what the product actually produces.
 *
 *   node tools/shots/calibration-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-calibration');
/* THE BROWSER'S OWN CLOCK. The node side is pinned so the plan is
   reproducible, but the PAGE is not -- it renders Today and This Week against
   the real date. A block generated for some other Monday would put week one in
   the past and photograph an empty Today view, which is what the first run of
   this script did. So week one opens on the day the screenshots are taken. */
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
                 benchSec: 45 * 60, maxHR: 190, healthConsent: o.consent !== false,
                 schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
  const calibrate = a.calibrationNeededNow(45);
  const br = a.buildBlockWeeks('half', 45, 10, { purpose: 'race', calibrate: calibrate });
  a.state.days = a.buildDaysFromWeeks(br, a.state.setup.raceDate,
    a.state.setup.schedule, TODAY, false);
  a.state.setup.purpose = 'race';
  if (o.logIt){
    const dd = a.state.days.filter(d => d.type === 'calibration')[0];
    const segs = a.orderedSegments(a.prescriptionOf(dd)) || [];
    const seg = segs.filter(s => s.role === 'calibration_measure')[0];
    dd.completed = true;
    dd.actual = Object.assign(a.emptyActual(), { km: dd.km, pace: '4:38', rpe: 8, feel: 'good' });
    /* A ROW PER WORK SEGMENT, because the two anchors use different windows:
       threshold PACE comes from the complete thirty minutes, so both halves
       carry a distance, and threshold HEART RATE from the final twenty, so
       only that row carries one. 2.3 + 4.6 = 6.9km in 30:00 = 4:21/km. */
    const settle = segs.filter(x => x.role === 'calibration_settle')[0];
    dd.actual.splits = [
      { segId: settle.segId, role: 'calibration_settle',
        label: 'Time trial \u2014 first 10 min', km: 2.3, sec: 600, paceSec: null, hr: null },
      { segId: seg.segId, role: 'calibration_measure',
        label: 'Same effort \u2014 final 20 min', km: 4.6, sec: 1200, paceSec: null, hr: 171 }];
    a.applyCalibrationFromDay(dd);
  }
  return a;
}
const SCENARIOS = {
  needs:     () => athlete({}),
  done:      () => athlete({ logIt: true }),
  noconsent: () => athlete({ consent: false })
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
    const cal = a.state.days.filter(d => d.type === 'calibration');
    console.log(k.padEnd(10) + ' calibrationSessions=' + cal.length +
                ' lthr=' + a.state.setup.lthr + ' source=' + (a.state.setup.lthrSource || '-') +
                ' tPaceSec=' + (a.state.setup.thresholdPaceSecPerKm || '-'));
  });

  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  for (const scenario of Object.keys(SCENARIOS)){
    for (const theme of ['light', 'dark']){
      for (const view of ['today', 'week', 'full']){
        const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
                                               deviceScaleFactor: 2, isMobile: true,
                                               hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        page.on('console', m => {
          /* A favicon or crest that the throwaway server raced on is noise, not
             a defect in the page under test. */
          if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
            errors.push('console: ' + m.text());
        });
        /* The view and the theme go INSIDE the plan blob: with a stored plan
           present, state.theme is the source of truth and the mirror key is
           only consulted when there is none. */
        const blob = Object.assign({}, states[scenario].state,
          { view: view, theme: theme, themeExplicit: true });
        await page.addInitScript(seed,
          { key: states[scenario].key, state: JSON.stringify(blob), theme });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(700);
        /* NAVIGATE THE WAY THE ATHLETE DOES. Seeding state.view is not enough --
           init() normalises it and the bottom nav is the real entry point --
           so the app's own handler is called instead of the state being poked. */
        try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), view); }
        catch (e) {}
        await page.waitForTimeout(350);
        /* OPEN THE SESSION, because that is what an athlete does. Day cards
           collapse by default now -- only the current calendar day starts open
           -- so photographing the default state would show a closed row and
           prove nothing about the card. dayExpandOverride is the app's own
           explicit-tap channel, so this is the same state a tap produces. */
        try {
          await page.evaluate(() => {
            var dd = (window.state.days || []).filter(d => d.type === 'calibration')[0];
            if (!dd) return;
            window.dayExpandOverride[dd.id] = true;
            /* Full Plan collapses its weeks; the calibration is in week one. */
            if (window.expandedWeeks) window.expandedWeeks[dd.week] = true;
            window.renderApp();
          });
        } catch (e) {}
        await page.waitForTimeout(400);
        const name = scenario + '-' + view + '-' + theme;
        await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
        const m = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
          theme: document.documentElement.getAttribute('data-theme'),
          hasCalibration: (document.body.innerText || '').indexOf('Calibration') !== -1,
          protocol: /final 20 minutes/i.test(document.body.innerText || ''),
          measured: (document.body.innerText || '').indexOf('(measured)') !== -1,
          head: (document.body.innerText || '').replace(/\s+/g,' ').slice(0, 220)
        }));
        results.push({ name, errors, m });
        if (process.env.DIAG) console.log('   TEXT: ' + m.head);
        console.log(name.padEnd(28) +
          ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES ' + m.scrollW + '>' + m.clientW : 'no') +
          ' theme=' + m.theme + ' calibration=' + (m.hasCalibration ? (m.protocol ? 'shown+protocol' : 'shown') : '-') +
          ' measuredLabel=' + (m.measured ? 'yes' : '-') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        await page.close(); await ctx.close();
      }
    }
  }
  await browser.close(); server.close();
  const bad = results.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.name).join(', ') : 'no page errors, no horizontal overflow');
})();
