'use strict';
/* THE RECORD'S EMPTY PLATE, PHOTOGRAPHED BESIDE THE MEASURED ONES.
 * ===========================================================================
 * Valhalla tab -> The Record. Three chamfered plates, value over label:
 *
 *     Nothing measured   |   5K · 23:00        9%
 *     MEASURED FITNESS   |   BENCHMARK      PROGRESS
 *
 * The point of this sweep is the COMPARISON. "Nothing measured" only looks
 * wrong next to the two plates that really are data, so every frame contains
 * all three, and the sweep reads the computed font of each value out of the
 * live DOM -- a screenshot cannot tell you which typeface rendered, and the
 * fallback stack means a missing web font would look plausible either way.
 *
 *   node tools/shots/record-empty-typography-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const { loadApp } = require(path.join(__dirname, '..', '..', 'test', 'harness.js'));
const { buildPlan, logAsPrescribed } = require(path.join(__dirname, '..', '..', 'test', 'fixtures.js'));

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-record-empty');
const TODAY = '2026-08-27';

/* An athlete part-way through a block who has not yet raced or run a
   checkpoint -- so Benchmark and Progress carry real values and Measured
   Fitness genuinely has none. Nothing here fakes the empty state. */
function athlete(noBenchmark){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '5k', volume: 40, weeks: 12,
    startDate: a.addDays(a.todayStr(), -21), benchSec: a.clockToSec('0:23:00'),
    schedule: { activeDays: [1, 2, 3, 5, 6], longRunDay: 6 } });
  /* A few completed easy runs, so Progress is a real percentage. Training runs
     never move measured fitness, which is the whole point of the empty plate. */
  const t = a.todayStr();
  a.state.days.filter(d => d.date < t && d.type === 'easy').slice(0, 6)
    .forEach(d => logAsPrescribed(a, d));
  a.state.athlete = a.state.athlete || { sessions: [], baselines: {}, performances: [], blocks: [] };
  /* THE OTHER EMPTY VALUE IN THIS SLOT. Benchmark renders "Not set" with the
     same rec-none class, so any rule keyed on emptiness reaches it too --
     which is the evidence that decided the size question. */
  if (noBenchmark) a.state.setup.benchmark = null;
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

/* Every width the product actually meets. 360 and 412 are the common Android
   viewports, 390 the iPhone this is designed at, 320 the narrowest device
   still in use. The plate is half-width at all of them, so this is where a
   16-character value either fits on one line or does not -- and that is the
   whole question this sweep answers. */
const WIDTHS = [430, 412, 390, 384, 360, 320];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  const a = athlete(process.argv[3] === 'nobench');

  for (const width of WIDTHS){
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width, height: 900 },
        deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
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
      await page.waitForTimeout(900);
      try { await page.evaluate(() => window.handleSetView && window.handleSetView('planhq')); } catch (e) {}
      try { await page.evaluate(() => window.handleSetPlanhqTab && window.handleSetPlanhqTab('valhalla')); } catch (e) {}
      try { await page.evaluate(() => window.renderApp && window.renderApp()); } catch (e) {}
      await page.waitForTimeout(500);

      /* THE FONT, READ NOT ASSUMED -- a screenshot cannot tell you which
         typeface rendered, and the fallback stack means a missing web font
         would look plausible either way. */
      const m = await page.evaluate(() => {
        const plates = [...document.querySelectorAll('.b-record .b-plate')].map(p => {
          const v = p.querySelector('.val'), l = p.querySelector('.lbl');
          const cs = v ? getComputedStyle(v) : null;
          const r = v ? v.getBoundingClientRect() : null;
          const pr = p.getBoundingClientRect();
          return {
            label: l ? l.textContent.trim() : '?',
            value: v ? v.textContent.trim() : '?',
            none: v ? v.classList.contains('rec-none') : false,
            font: cs ? cs.fontFamily.split(',')[0].replace(/["']/g, '') : '?',
            size: cs ? cs.fontSize : '?',
            weight: cs ? cs.fontWeight : '?',
            colour: cs ? cs.color : '?',
            /* Does the value spill out of its own plate? */
            overflows: !!(v && r && (r.width > pr.width - 2)),
            /* Real line boxes, via a Range. Dividing height by line-height
               reported NaN for the mono plates, whose computed line-height is
               the keyword "normal". */
            lines: (function(){
              if (!v) return 0;
              var rg = document.createRange(); rg.selectNodeContents(v);
              return rg.getClientRects().length;
            })(),
            /* The plate's own box. Switching to a proportional face stops the
               sentence wrapping at 390px, which makes the whole grid row
               shorter -- a real consequence of the change and one the eye
               alone would not report accurately. */
            plateH: Math.round(pr.height), plateW: Math.round(pr.width)
          };
        });
        return { plates,
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth };
      });

      const file = 'record-' + width + '-' + theme;
      const el = await page.$('.b-record');
      if (el) await el.screenshot({ path: path.join(OUT, file + '.png') });
      results.push({ file, errors, m });

      console.log(file.padEnd(24) + (errors.length ? ' ERRORS ' : ' ') +
        m.plates.map(p => p.label + '="' + p.value + '" ' + p.font + ' ' +
          p.size + '/' + p.weight + ' ' + p.lines + 'ln box=' + p.plateW + 'x' + p.plateH +
          (p.none ? ' [none]' : '') +
          (p.overflows ? ' OVERFLOW' : '')).join('   |   '));
      if (errors.length) console.log('  ' + errors.slice(0, 2).join(' | '));
      await page.close(); await ctx.close();
    }
  }
  await browser.close(); server.close();

  const problems = [];
  results.forEach(r => {
    if (r.errors.length) problems.push(r.file + ': page errors');
    if (r.m.scrollW > r.m.clientW + 1) problems.push(r.file + ': horizontal overflow');
    r.m.plates.forEach(p => {
      if (p.overflows) problems.push(r.file + ': "' + p.value + '" overflows its plate');
      /* EVERY plate value is on the data face, the empty one included -- that
         is the point of this pass. A face that drifted on any of them would
         be invisible in the image. */
      if (p.font !== 'JetBrains Mono')
        problems.push(r.file + ': ' + p.label + ' left the data face (' + p.font + ')');
      /* EVERY plate value is the same size, empty or not. The empty ones are
         the value role unavailable, not a smaller role of their own -- a size
         override keyed on emptiness also shrank "Not set", which fits. */
      if (p.size !== '16px')
        problems.push(r.file + ': ' + p.label + ' is ' + p.size + ', not the plate value size');
      if (p.weight !== '600')
        problems.push(r.file + ': ' + p.label + ' is weight ' + p.weight + ', not the value weight');
    });
    if (r.m.plates.filter(p => p.none).length !== 1)
      problems.push(r.file + ': expected exactly one empty plate');
    /* Wrapping is not a defect here: sixteen characters do not fit in half a
       phone at the value size, and the slot keeping its size while its contents
       wrap is the honest outcome. What IS checked is that the pair of plates in
       a grid row stay the same height as each other, so a wrap never leaves the
       row looking ragged. */
    const heights = r.m.plates.slice(0, 2).map(p => p.plateH);
    if (heights.length === 2 && heights[0] !== heights[1])
      problems.push(r.file + ': the two plates in a row are ' + heights.join(' and ') + 'px tall');
  });
  console.log('\n' + results.length + ' frames -> ' + OUT);
  if (problems.length) console.log('PROBLEMS:\n  ' + problems.join('\n  '));
  else console.log('One empty plate; the measured plates keep the data face; nothing overflows');
})();
