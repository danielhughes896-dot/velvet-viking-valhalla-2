'use strict';
/* PLAN HQ'S THREE TABS, AND THE SELECTORS NOTHING MATCHES.
 * ===========================================================================
 * Written to prove a CSS DELETION inert, which is a different job from
 * proving a change correct. Two things have to hold:
 *
 *   1. no element anywhere in Plan HQ matches the removed selectors -- checked
 *      against the live DOM, in every tab, in both themes, in both the
 *      measured and the unmeasured athlete state; and
 *   2. the rendered pixels are unchanged -- checked by running this on the
 *      commit before and after and comparing the PNGs byte for byte.
 *
 * (1) alone is the real argument: a rule that matches nothing cannot paint
 * anything. (2) is the backstop for the case where (1)'s selector list is
 * wrong, which is the only way this could go quietly wrong.
 *
 *   node tools/shots/plan-hq-shell-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan, logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-plan-hq-shell');
const TODAY = '2026-08-27';

/* The Record list-row shell, removed once nothing emitted it. If any of these
   ever matches again, either the shell came back without its CSS or this list
   is out of date -- both worth failing on. */
const REMOVED = ['.rec-card', '.rec-top', '.rec-subject', '.rec-right', '.rec-val', '.rec-syn'];

function athlete(measured){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '5k', volume: 40, weeks: 12,
    startDate: a.addDays(a.todayStr(), -21), benchSec: a.clockToSec('0:23:00'),
    lthr: 172, maxHR: 190 });
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type !== 'rest').slice(0, 10)
    .forEach(d => logAsPrescribed(a, d));
  a.state.athlete = a.state.athlete || { sessions: [], baselines: {}, performances: [], blocks: [] };
  a.state.athlete.performances = measured
    ? [{ date: a.addDays(t, -14), source: 'race', km: 5,
         timeSec: a.clockToSec('0:22:30'), vdot: 50, blockId: null, qualified: true }]
    : [];
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

const TABS = ['valhalla', 'coach', 'record'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];

  for (const measured of [false, true]){
    const a = athlete(measured);
    for (const tab of TABS){
      for (const theme of ['light', 'dark']){
        const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        await page.route('https://fonts.googleapis.com/**', r =>
          r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));

        const blob = Object.assign({}, JSON.parse(JSON.stringify(a.state)),
          { view: 'planhq', theme, themeExplicit: true });
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
        await page.waitForTimeout(800);
        try { await page.evaluate(() => window.handleSetView && window.handleSetView('planhq')); } catch (e) {}
        try { await page.evaluate(t => window.handleSetPlanhqTab && window.handleSetPlanhqTab(t), tab); } catch (e) {}
        try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
        await page.waitForTimeout(400);

        const m = await page.evaluate(sels => {
          const hits = {};
          sels.forEach(s => { const n = document.querySelectorAll(s).length; if (n) hits[s] = n; });
          return { hits,
            tab: (window.planhqTab !== undefined ? window.planhqTab : '?'),
            /* The Valhalla tab is plates and dials, not .ev-card buttons --
               counting only .ev-card reported its four frames as proving
               nothing while they were rendering the Record preview perfectly
               well. What every frame must have is SOME Record/Reading
               element, which is what the removed shell would have been. */
            cards: document.querySelectorAll('.ev-card, .b-plate, .rd-val').length,
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth };
        }, REMOVED);

        const file = (measured ? 'measured' : 'unmeasured') + '-' + tab + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        results.push({ file, errors, m });
        console.log(file.padEnd(30) +
          ' recordEls=' + m.cards +
          ' removedSelectorsMatched=' + (Object.keys(m.hits).length
            ? JSON.stringify(m.hits) : 'none') +
          ' overflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        await page.close(); await ctx.close();
      }
    }
  }
  await browser.close(); server.close();

  const problems = [];
  results.forEach(r => {
    if (r.errors.length) problems.push(r.file + ': page errors');
    if (r.m.scrollW > r.m.clientW + 1) problems.push(r.file + ': horizontal overflow');
    if (Object.keys(r.m.hits).length)
      problems.push(r.file + ': removed selectors matched ' + JSON.stringify(r.m.hits));
    /* A frame with no cards would make "no matches" vacuously true. */
    if (!r.m.cards) problems.push(r.file + ': no Record/Reading elements rendered, so this frame proves nothing');
  });
  console.log('\n' + results.length + ' frames -> ' + OUT);
  if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));
  else console.log('No element in any Plan HQ tab matches the removed shell; ' +
    'cards render, nothing overflows, no page errors');
})();
