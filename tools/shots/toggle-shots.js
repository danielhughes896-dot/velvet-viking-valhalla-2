'use strict';
/* Visual proof for the toggle-switch consistency fix.
   ===========================================================================

   Captures the Settings card that holds every binary switch in the product, in
   both themes, with each switch ON and then OFF -- because "ON is one colour"
   and "OFF is unchanged" are two separate claims and both were made.

   Run:  node tools/shots/toggle-shots.js  */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PW || '/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tools', 'shots', 'toggles');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
               '.css':'text/css; charset=utf-8', '.png':'image/png', '.svg':'image/svg+xml',
               '.json':'application/json' };

function serve(){
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = url === '/' ? 'protected/velvet-viking-valhalla.html' : url.replace(/^\//, '');
      const abs = path.join(ROOT, file);
      if (!abs.startsWith(ROOT) || !fs.existsSync(abs) || fs.statSync(abs).isDirectory()){
        res.writeHead(404); res.end('nope'); return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(abs)] || 'application/octet-stream' });
      res.end(fs.readFileSync(abs));
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

async function main(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  fs.mkdirSync(OUT, { recursive: true });
  const swatches = [];

  for (const theme of ['light', 'dark']) {
    for (const on of [true, false]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
                                             deviceScaleFactor: 3 });
      await ctx.route('**/*', (r) => r.request().url().startsWith(base) ? r.continue() : r.abort());
      const page = await ctx.newPage();
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.buildBlockWeeks === 'function', { timeout: 20000 });

      await page.evaluate(({ theme, on }) => {
        const start = todayStr();
        const startMonday = addDays(start, -isoWeekday(start));
        const br = buildBlockWeeks('10k', 40, 10);
        state.days = buildDaysFromWeeks(br, addDays(startMonday, 69),
          { activeDays:[1,2,3,5,6], longRunDay:6 }, start, false);
        state.setup = { distanceKey:'10k', currentVolume:40, raceDate:addDays(startMonday,69),
          hasEvent:false, startDate:start, planWeeks:br.planWeeks,
          schedule:{ activeDays:[1,2,3,5,6], longRunDay:6 },
          benchmark:{ distanceKey:'10k', timeSec:2700 }, goals:{ A:{ timeSec:2565 } },
          activeGoal:'A', paceOverrides:{}, lthr:null, maxHR:null, experience:'experienced' };
        /* THEME LIVES IN THE PLAN, not only in the mirror key -- seeding just
           the mirror produces identical light and dark frames. */
        state.theme = theme; state.themeExplicit = true; applyThemeToDocument();
        /* Notifications are normally disabled without Notification permission,
           and a disabled switch is a different visual question from an ON one.
           The reminder state is set directly so the control renders enabled. */
        state.notify = { enabled: on, time: '08:00' };
        if (typeof state.healthConsent !== 'undefined' || true) {
          state.healthConsent = on
            ? { granted:true, version: (typeof HEALTH_CONSENT_VERSION!=='undefined'?HEALTH_CONSENT_VERSION:1),
                at: new Date().toISOString() }
            : null;
        }
        state.view = 'settings';
        renderApp();
      }, { theme, on });
      await page.waitForTimeout(400);

      /* Force the checkbox state directly as well, so the frame shows the ON
         appearance even where a render path would have refused it -- this is a
         COLOUR check, not a behaviour check, and behaviour has its own tests. */
      await page.evaluate((on) => {
        document.querySelectorAll('.switch input').forEach((i) => {
          i.checked = on; i.disabled = false;
        });
      }, on);
      await page.waitForTimeout(120);

      const label = `settings.${on ? 'on' : 'off'}.${theme}`;
      await page.screenshot({ path: path.join(OUT, label + '.png'), fullPage: true });

      /* The measurement that actually settles it: the computed track colour of
         every switch on the screen, read from the live page. */
      const tracks = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.switch')).map((s) => ({
          row: (s.closest('.connect-row') || {}).id ||
               ((s.closest('.connect-row') || document.body).querySelector('.name') || {}).textContent || '?',
          colour: getComputedStyle(s.querySelector('.switch-track')).backgroundColor,
        })));
      const unique = new Set(tracks.map((t) => t.colour));
      swatches.push({ label, tracks, unique: unique.size });
      console.log(label.padEnd(22) + ' switches=' + tracks.length +
                  '  distinct track colours=' + unique.size);
      tracks.forEach((t) => console.log('    ' + String(t.row).slice(0, 34).padEnd(36) + t.colour));

      await ctx.close();
    }
  }
  await browser.close();
  server.close();

  const bad = swatches.filter((s) => s.unique !== 1);
  console.log('\n=== ' + swatches.length + ' frames ===');
  console.log('frames where the switches disagree on colour: ' + bad.length +
    (bad.length ? ' -> ' + bad.map((b) => b.label).join(', ') : ''));
}

main().catch((e) => { console.error(e); process.exit(1); });
