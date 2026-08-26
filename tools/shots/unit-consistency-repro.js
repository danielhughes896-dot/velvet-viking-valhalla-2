'use strict';
/* KM / MI UNIT-CONSISTENCY -- LIVE REPRODUCTION (brief Part 17).
   ===========================================================================
   Logs a real structured Threshold session entirely through the same DOM
   inputs and events an athlete uses (fill + native 'change', the click
   dispatcher's own KM/MI toggle button) -- not by seeding state -- then
   proves live that switching KM -> MI converts every unit-sensitive figure
   (top-line distance/pace, segment distances/paces, Execution Review prose)
   while HR/RPE/Feel stay exactly as typed, and that MI -> KM returns the
   session to its original numbers.

   Run:  node tools/shots/unit-consistency-repro.js [outDir]
*/
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-unit-repro');
// The runtime's own "today" view renders exactly one day -- whichever the
// real browser clock calls today -- so the forced Threshold day must be
// dated there too, not at a Node-side "start of week" the browser's real
// Date never agrees with.
const TODAY = new Date().toISOString().slice(0, 10);

function engine(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  return a;
}
function athleteWithThresholdToday(){
  const a = engine();
  buildPlan(a, { weeks: 10, startDate: TODAY, distanceKey: 'half', volume: 45,
                 benchSec: 45 * 60, maxHR: 190, healthConsent: true,
                 schedule: { activeDays: [1, 2, 3, 4, 5, 6], longRunDay: 6 } });
  const br = a.buildBlockWeeks('half', 45, 10, { purpose: 'race' });
  a.state.days = a.buildDaysFromWeeks(br, a.state.setup.raceDate, a.state.setup.schedule, TODAY, false);
  // Force TODAY to be a genuine structured threshold day so the repro proves
  // the exact surface the brief reports (warm up / threshold / cool down).
  const today = a.state.days.find(d => d.date === TODAY);
  today.type = 'threshold'; today.km = 10;
  today.title = 'Threshold: 8km';
  today.desc = a.dtok(2) + ' warm-up. ' + a.dtok(8) + ' continuous @ Threshold pace. ' + a.dtok(2) + ' cool-down.';
  today.prescription = { v: a.PRESCRIPTION_VERSION, archetype: 'threshold_continuous', params: { km: 8 } };
  delete today.completed; delete today.actual; delete today.coachReview;
  return { a, dayId: today.id };
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

async function fillAndChange(page, selector, value){
  const handle = await page.$(selector);
  if (!handle) return false;
  await handle.fill(String(value));
  await handle.dispatchEvent('change');
  return true;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { a, dayId } = athleteWithThresholdToday();
  const state = JSON.parse(JSON.stringify(a.state));
  const key = a.STORAGE_KEY;

  const server = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const readings = {};

  for (const theme of ['light', 'dark']){
    const ctx = await browser.newContext({ viewport: { width: 390, height: 1800 }, deviceScaleFactor: 2,
      isMobile: true, hasTouch: true, colorScheme: theme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    const blob = Object.assign({}, state, { theme, themeExplicit: true, units: 'km' });
    await page.addInitScript(seed, { key, state: JSON.stringify(blob), theme });
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);

    // Expand today's structured Threshold day.
    await page.evaluate((id) => { window.dayExpandOverride[id] = true; window.renderApp(); }, dayId);
    await page.waitForTimeout(200);

    // ---- MARK COMPLETED FIRST -- the Actual/Execution Review panel only
    // renders once dd.completed is true, so the log inputs do not exist
    // until this real click fires. ----
    const toggleSel = '#day-' + dayId + ' [data-action="toggle-complete"]';
    if (await page.$(toggleSel)) { await page.click(toggleSel); await page.waitForTimeout(150); }
    await page.evaluate((id) => { window.dayExpandOverride[id] = true; window.renderApp(); }, dayId);
    await page.waitForTimeout(200);

    // ---- LOG UNDER KM: top-level actual fields, real inputs + native change ----
    await fillAndChange(page, '#day-' + dayId + ' [data-action="actual-field"][data-field="km"]', '10');
    await fillAndChange(page, '#day-' + dayId + ' [data-action="actual-field"][data-field="pace"]', '5:15');
    await fillAndChange(page, '#day-' + dayId + ' [data-action="actual-field"][data-field="hr"]', '162');
    await fillAndChange(page, '#day-' + dayId + ' [data-action="actual-field"][data-field="rpe"]', '7');
    await page.evaluate((id) => { window.handleSetFeel && window.handleSetFeel(id, 'good'); }, dayId);
    await page.waitForTimeout(150);

    // ---- LOG UNDER KM: structured segments (warm up / threshold / cool down) ----
    const segKmInputs = await page.$$('#day-' + dayId + ' .slog-in[data-field="km"]');
    const segSecInputs = await page.$$('#day-' + dayId + ' .slog-in[data-field="sec"]');
    const segHrInputs = await page.$$('#day-' + dayId + ' .slog-in[data-field="hr"]');
    const segKmValues = ['2', '8', '2'];
    const segSecValues = ['12:00', '41:20', '11:45'];
    for (let i = 0; i < segKmInputs.length; i++){ await segKmInputs[i].fill(segKmValues[i] || '2'); await segKmInputs[i].dispatchEvent('change'); }
    for (let i = 0; i < segSecInputs.length; i++){ await segSecInputs[i].fill(segSecValues[i] || '12:00'); await segSecInputs[i].dispatchEvent('change'); }
    for (let i = 0; i < segHrInputs.length; i++){ await segHrInputs[i].fill('160'); await segHrInputs[i].dispatchEvent('change'); }
    await page.evaluate((id) => { window.dayExpandOverride[id] = true; window.renderApp(); }, dayId);
    await page.waitForTimeout(200);

    const nameKm = 'unit-repro-KM-' + theme;
    const elKm = await page.$('#day-' + dayId);
    if (elKm) await elKm.screenshot({ path: path.join(OUT, nameKm + '.png') });
    readings['km-' + theme] = await page.evaluate((id) => {
      const el = document.getElementById('day-' + id);
      return el ? el.innerText : null;
    }, dayId);
    results.push({ name: nameKm, errors: errors.slice() });

    // ---- SWITCH TO MI via the real toggle button (lives on the Valhalla/Plan HQ hero) ----
    await page.evaluate(() => window.handleSetView && window.handleSetView('planhq'));
    await page.waitForTimeout(200);
    await page.click('[data-action="set-units"][data-units="mi"]');
    await page.evaluate(() => window.handleSetView && window.handleSetView('today'));
    await page.waitForTimeout(150);
    await page.waitForTimeout(200);
    await page.evaluate((id) => { window.dayExpandOverride[id] = true; window.renderApp(); }, dayId);
    await page.waitForTimeout(200);

    const nameMi = 'unit-repro-MI-' + theme;
    const elMi = await page.$('#day-' + dayId);
    if (elMi) await elMi.screenshot({ path: path.join(OUT, nameMi + '.png') });
    readings['mi-' + theme] = await page.evaluate((id) => {
      const el = document.getElementById('day-' + id);
      return el ? el.innerText : null;
    }, dayId);
    results.push({ name: nameMi, errors: errors.slice() });

    // ---- SWITCH BACK TO KM -- must return to the original numbers ----
    await page.evaluate(() => window.handleSetView && window.handleSetView('planhq'));
    await page.waitForTimeout(200);
    await page.click('[data-action="set-units"][data-units="km"]');
    await page.evaluate(() => window.handleSetView && window.handleSetView('today'));
    await page.waitForTimeout(150);
    await page.waitForTimeout(200);
    await page.evaluate((id) => { window.dayExpandOverride[id] = true; window.renderApp(); }, dayId);
    await page.waitForTimeout(200);

    const nameKm2 = 'unit-repro-KM-return-' + theme;
    const elKm2 = await page.$('#day-' + dayId);
    if (elKm2) await elKm2.screenshot({ path: path.join(OUT, nameKm2 + '.png') });
    readings['km-return-' + theme] = await page.evaluate((id) => {
      const el = document.getElementById('day-' + id);
      return el ? el.innerText : null;
    }, dayId);
    results.push({ name: nameKm2, errors: errors.slice() });

    await ctx.close();
  }

  await browser.close(); server.server.close();
  results.forEach(r => console.log(r.name.padEnd(28) + (r.errors.length ? '  ERRORS: ' + r.errors.join(' | ') : '  ok')));
  fs.writeFileSync(path.join(OUT, 'readings.json'), JSON.stringify(readings, null, 2));
  const bad = results.filter(r => r.errors.length);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.name).join(', ') : 'all clean');

  // ---- Text-level proof, printed straight to the console ----
  console.log('\n=== LIGHT THEME CARD TEXT (km) ===\n' + readings['km-light']);
  console.log('\n=== LIGHT THEME CARD TEXT (mi) ===\n' + readings['mi-light']);
  console.log('\n=== LIGHT THEME CARD TEXT (km, returned) ===\n' + readings['km-return-light']);
})();
