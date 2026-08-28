'use strict';
/* SUPPORTING WORK, ON THE FOUR SURFACES IT TOUCHES.
 * ===========================================================================
 * The question on the builder's Review stage, the companion on Today, the same
 * companion in This Week, and the Settings control -- in both themes, at
 * 390px, with the preference on and off so the "renders nothing" case is
 * photographed rather than asserted.
 *
 *   node tools/shots/supporting-work-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan, logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-supporting-work');
const TODAY = '2026-08-05';   // a Base-phase Wednesday, where companions exist

function athlete(on){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: 'half', volume: 45, weeks: 14,
    startDate: a.addDays(a.todayStr(), -21), benchSec: a.clockToSec('0:45:00'),
    lthr: 168, maxHR: 188 });
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').forEach(d => logAsPrescribed(a, d));
  a.state.setup.supportWork = on ? 'on' : 'off';
  return a;
}

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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const notes = [];

  const SHOTS = [
    { name:'today',    view:'today',    on:true  },
    { name:'today-off',view:'today',    on:false },
    { name:'week',     view:'week',     on:true  },
    { name:'settings', view:'settings', on:true  },
    { name:'builder',  view:'today',    on:true, builder:true }
  ];

  for (const shot of SHOTS){
    for (const theme of ['light', 'dark']){
      const a = athlete(shot.on);
      const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
        deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      await page.route('https://fonts.googleapis.com/**', r =>
        r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      const blob = Object.assign({}, JSON.parse(JSON.stringify(a.state)),
        { view: shot.view, theme, themeExplicit: true });
      await page.addInitScript(seed, { key: a.STORAGE_KEY, state: JSON.stringify(blob) });
      await page.addInitScript(`(function(){
        var pinned = new Date(${JSON.stringify(TODAY + 'T09:00:00Z')}).getTime();
        var RealDate = Date;
        function D(){ return arguments.length ? new RealDate(...arguments) : new RealDate(pinned); }
        D.now = function(){ return pinned; };
        D.parse = RealDate.parse; D.UTC = RealDate.UTC; D.prototype = RealDate.prototype;
        window.Date = D;
      })();`);
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(700);
      /* DRIVEN, NOT SEEDED. Putting `view` in the stored blob was not enough --
         the first render happens before the blob's view is applied on some
         paths, and the first attempt photographed Today four times over while
         reporting success. The counts below are what caught it, and they stay
         in the output for exactly that reason. */
      if (shot.view !== 'today'){
        try { await page.evaluate(v => window.handleSetView && window.handleSetView(v), shot.view); } catch(e){}
        await page.waitForTimeout(500);
      }
      if (shot.builder){
        /* Open the builder and jump to Review -- the stage the question ships
           on, photographed there rather than rendered in isolation. */
        try { await page.evaluate(() => window.openSetupModal && window.openSetupModal()); } catch(e){}
        await page.waitForTimeout(600);
        try { await page.evaluate(() => {
          var panels = document.querySelectorAll('.bld-panel');
          for (var i = 0; i < panels.length; i++) panels[i].hidden = i !== panels.length - 1;
          var last = panels[panels.length - 1];
          if (last) last.scrollIntoView();
        }); } catch(e){}
        await page.waitForTimeout(400);
      }
      /* What actually got photographed, stated rather than assumed. */
      const found = await page.evaluate(() => ({
        block: document.querySelectorAll('.support-block').length,
        line: document.querySelectorAll('.support-line').length,
        settings: document.querySelectorAll('#support-work-row').length,
        builder: document.querySelectorAll('#su-support-work').length
      }));
      const file = path.join(OUT, shot.name + '-' + theme + '.png');
      await page.screenshot({ path: file, fullPage: true });
      notes.push({ shot: shot.name, theme, found, errors: errors.length ? errors : null });
      await ctx.close();
    }
  }
  await browser.close();
  await new Promise(r => server.close(r));
  console.log(JSON.stringify(notes, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(notes, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
