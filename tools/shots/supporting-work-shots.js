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
    { name:'today-collapsed', view:'today', on:true  },
    { name:'today-expanded',  view:'today', on:true, expand:true },
    { name:'today-off',       view:'today', on:false },
    { name:'week',            view:'week',  on:true  },
    { name:'settings',        view:'settings', on:true },
    { name:'builder',         view:'today', on:true, builder:true }
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
      let builderWalk = null;
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
        /* WALKED, NOT UNHIDDEN. The first version of this jumped to Review by
           setting `hidden` on the other panels, which photographed a Review
           stage whose #bld-review container had never been populated -- an
           empty grey pill sitting above the question, present only because of
           how the screenshot was taken. Acceptance evidence has to be the
           screen an athlete actually reaches, so this presses Next through
           every stage and lets the builder's own validation and its own
           bldRenderReview() run. The athlete already has a plan, so every
           stage arrives pre-filled from state and nothing has to be typed. */
        try { await page.evaluate(() => window.openSetupModal && window.openSetupModal()); } catch(e){}
        await page.waitForTimeout(600);
        const walk = await page.evaluate(() => {
          const seen = [];
          for (let i = 0; i < 20; i++){
            seen.push(window.bldCurrentStage);
            if (window.bldCurrentStage >= 9) break;
            const before = window.bldCurrentStage;
            window.handleBldNext();
            if (window.bldCurrentStage === before) break;   // validation refused
          }
          return { path: seen, stage: window.bldCurrentStage,
                   review: (document.getElementById('bld-review') || {}).innerHTML ?
                     (document.getElementById('bld-review').innerHTML.length) : 0 };
        });
        await page.waitForTimeout(500);
        builderWalk = walk;
      }
      /* The expanded state is the athlete's own tap on the disclosure, not a
         different render -- so it is produced by opening the same <details>
         they would open, rather than by a second code path. */
      if (shot.expand){
        try { await page.evaluate(() => {
          var d = document.querySelector('details.support-detail');
          if (d) { d.open = true; d.scrollIntoView({ block:'center' }); }
        }); } catch(e){}
        await page.waitForTimeout(400);
      }
      /* What actually got photographed, stated rather than assumed. */
      const found = await page.evaluate(() => ({
        reviewChars: (document.getElementById('bld-review') || { innerHTML:'' }).innerHTML.length,
        block: document.querySelectorAll('.support-block').length,
        line: document.querySelectorAll('.support-line').length,
        settings: document.querySelectorAll('#support-work-row').length,
        builder: document.querySelectorAll('#su-support-work').length,
        detailOpen: document.querySelectorAll('details.support-detail[open]').length,
        kind: (document.querySelector('.support-title') || {}).textContent || null
      }));
      /* VIEWPORT, SCROLLED TO THE SUBJECT -- not fullPage. The bottom nav is
         fixed, and a full-page capture paints it across the middle of the
         document, which in the first run landed squarely over the companion's
         own heading. The evidence has to show the thing being accepted. */
      const file = path.join(OUT, shot.name + '-' + theme + '.png');
      const subject = shot.builder ? '.bld-panel:not([hidden])'
                    : shot.view === 'settings' ? '#support-work-row'
                    : shot.name === 'today-off' ? '.day.is-today, .day'
                    : '.support-block';
      let shotEl = null;
      try { shotEl = await page.$(subject); } catch(e){}
      if (shotEl){
        try { await shotEl.scrollIntoViewIfNeeded(); } catch(e){}
        await page.waitForTimeout(250);
      }
      await page.screenshot({ path: file, fullPage: false });
      notes.push({ shot: shot.name, theme, found, walk: builderWalk,
                   errors: errors.length ? errors : null });
      await ctx.close();
    }
  }
  await browser.close();
  await new Promise(r => server.close(r));
  console.log(JSON.stringify(notes, null, 2));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(notes, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
