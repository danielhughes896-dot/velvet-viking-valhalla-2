'use strict';
/* Visual verification for the VALHALLA CONSISTENCY PASS:
   - Build Your Training Block: all 10 stages (incl. new Overview)
   - Re-calibrate Training Zones + Race Day Pacing Strategy (repositioned modals)
   - Settings (elevated sections)
   - Plan HQ Coach tab (elevated cards)

   Run:  node tools/shots/valhalla-consistency-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'valhalla-consistency');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8' };

function serve(){
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = url === '/' ? 'protected/velvet-viking-valhalla.html' : url.replace(/^\//, '');
      const abs = path.join(ROOT, file);
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs)){ res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'text/plain' });
      res.end(fs.readFileSync(abs));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

function seed(theme){
  const start = todayStr();
  const startMonday = addDays(start, -isoWeekday(start));
  const weeks = 12;
  const raceDate = addDays(startMonday, weeks * 7 - 1);
  const br = buildBlockWeeks('half', 45, weeks);
  const schedule = { activeDays:[1,2,3,5,6], longRunDay:6 };
  state.days = buildDaysFromWeeks(br, raceDate, schedule, addDays(startMonday, -28), false);
  state.setup = { distanceKey:'half', currentVolume:45, raceDate:raceDate, hasEvent:false,
    startDate: addDays(startMonday, -28), planWeeks: br.planWeeks, schedule: schedule,
    benchmark:{ distanceKey:'10k', timeSec:2585 },
    goals:{ A:{ timeSec:5820 }, B:{ timeSec:6120 } }, activeGoal:'A',
    paceOverrides:{ M:{ fast:294, slow:313 } },
    lthr:168, maxHR:190, experience:'experienced' };
  state.healthConsent = { version:HEALTH_CONSENT_VERSION, decision:'granted', decidedAt:new Date().toISOString(), grantedAt:new Date().toISOString(), withdrawnAt:null };
  const today = todayStr();
  state.days.forEach(function(dd){
    if (dd.type === 'rest' || dd.date >= today) return;
    dd.completed = true;
    dd.actual = { km: dd.km, pace: '5:20', hr: 148, rpe: 5, feel: 'good', notes: '' };
  });
  state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];
  const widths = process.env.UC_WIDTHS ? process.env.UC_WIDTHS.split(',').map(Number) : [390];
  const themes = process.env.UC_THEMES ? process.env.UC_THEMES.split(',') : ['light', 'dark'];

  for (const width of widths) {
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2 });
      await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });
      await page.evaluate(seed, theme);
      const tag = width + '.' + theme;
      const bodyOverflow = async () => page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 1);

      // --- BUILDER: open, walk all 10 stages -------------------------------
      await page.evaluate(() => { state.view = 'today'; renderApp(); openSetupModal(); });
      await page.waitForTimeout(250);
      for (let i = 0; i < 10; i++) {
        const info = await page.evaluate(() => ({
          stage: bldCurrentStage, name: BLD_STAGE_NAMES[bldCurrentStage], no: document.getElementById('bld-no').textContent
        }));
        await page.screenshot({ path: path.join(OUT, 'builder-' + i + '-' + info.name.replace(/\s+/g,'') + '.' + tag + '.png') });
        if (await bodyOverflow()) problems.push(tag + '/builder stage ' + i + ' (' + info.name + '): horizontal overflow');
        console.log(tag + ' builder stage ' + i + ': ' + info.name + ' [' + info.no + ']');
        if (i < 9) {
          await page.evaluate(() => { document.querySelector('.bld-panel:not([hidden]) [data-action="bld-next"]').click(); });
          await page.waitForTimeout(150);
        }
      }
      await page.evaluate(() => { closeModal(); });
      await page.waitForTimeout(150);

      // --- RE-CALIBRATE (repositioned modal) --------------------------------
      await page.evaluate(() => { openRecalibrateModal(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'recalibrate.' + tag + '.png') });
      if (await bodyOverflow()) problems.push(tag + '/recalibrate: horizontal overflow');
      await page.evaluate(() => { closeModal(); });
      await page.waitForTimeout(150);

      // --- RACE PACING (repositioned modal) ----------------------------------
      await page.evaluate(() => { openPacingModal(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'pacing.' + tag + '.png') });
      if (await bodyOverflow()) problems.push(tag + '/pacing: horizontal overflow');
      await page.evaluate(() => { closeModal(); });
      await page.waitForTimeout(150);

      // --- SETTINGS -----------------------------------------------------------
      await page.evaluate(() => { state.view = 'settings'; renderApp(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'settings.' + tag + '.png'), fullPage: true });
      if (await bodyOverflow()) problems.push(tag + '/settings: horizontal overflow');

      // --- PLAN HQ: Coach tab ----------------------------------------------
      await page.evaluate(() => { state.view = 'planhq'; planhqTab = 'coach'; renderApp(); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'planhq-coach.' + tag + '.png'), fullPage: true });
      if (await bodyOverflow()) problems.push(tag + '/planhq-coach: horizontal overflow');

      // --- PLAN HQ: Zone Paces record panel ---------------------------------
      await page.evaluate(() => { state.view = 'planhq'; planhqTab = 'record'; renderApp(); openHQPanel('zones'); });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(OUT, 'planhq-zones.' + tag + '.png') });
      if (await bodyOverflow()) problems.push(tag + '/planhq-zones: horizontal overflow');
      await page.evaluate(() => { closeModal(); });

      await ctx.close();
    }
  }
  await browser.close();
  server.close();

  console.log('\n=== ' + (problems.length ? problems.length + ' PROBLEM(S)' : 'no problems') + ' ===');
  problems.forEach(p => console.log('  ! ' + p));
  console.log('frames in ' + path.relative(ROOT, OUT));
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
