'use strict';
/* BUILDER TRAINING-DAY SELECTOR VISUAL REFINEMENT -- live proof.
   ===========================================================================
   Opens the real Builder, jumps to the WEEK stage, and photographs the
   Training Days circle row at 360/390/430 x light/dark. Also drives one real
   interaction: deselect the day currently holding the long run and confirm
   the Long Run Day grid reassigns -- the actual "long-run-day eligibility
   stays linked to selected training days" proof, exercised live rather than
   only asserted from source.

   Run:  node tools/shots/builder-training-day-circles-shots.js [outDir]
*/
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out-builder-training-days');
const WIDTHS = [360, 390, 430];

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
function seed(theme){
  try{ localStorage.setItem('vvv_theme', JSON.stringify({theme:theme, explicit:true})); }catch(e){}
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];

  for (const width of WIDTHS){
    for (const theme of ['light', 'dark']){
      const ctx = await browser.newContext({ viewport: { width, height: 1400 }, deviceScaleFactor: 2,
        isMobile: true, hasTouch: true, colorScheme: theme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(String(e && e.message || e)));
      await page.addInitScript(seed, theme);
      await page.goto(server.url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(500);
      await page.evaluate(() => { window.openSetupModal(); window.bldStage(6); });
      await page.waitForTimeout(250);

      const name = 'builder-week-' + width + '-' + theme;
      const el = await page.$('.bld-panel[data-stage="6"]');
      if (el) await el.screenshot({ path: path.join(OUT, name + '.png') });
      results.push({ name, errors: errors.slice() });

      // Live interaction proof, light theme / 390 only -- one representative
      // run through the actual long-run-day linkage.
      if (width === 390 && theme === 'light'){
        const before = await page.evaluate(() => {
          const sel = document.getElementById('su-longday');
          return { value: sel.value, options: Array.from(sel.options).map(o => o.value) };
        });
        // Deselect the checkbox currently holding the long run.
        const longIso = before.value;
        await page.click('label.wd-check:has(input[data-wd="' + longIso + '"])');
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => {
          const sel = document.getElementById('su-longday');
          const grid = document.getElementById('bld-longday-grid');
          return { value: sel.value, options: Array.from(sel.options).map(o => o.value), gridText: grid.innerText };
        });
        fs.writeFileSync(path.join(OUT, 'longday-linkage-proof.json'), JSON.stringify({ before, after }, null, 2));

        const name2 = 'builder-week-longday-reassigned-390-light';
        const el2 = await page.$('.bld-panel[data-stage="6"]');
        if (el2) await el2.screenshot({ path: path.join(OUT, name2 + '.png') });
        results.push({ name: name2, errors: [] });

        console.log('LONG-RUN-DAY LINKAGE PROOF');
        console.log('  before: longday=' + before.value + ' options=[' + before.options.join(',') + ']');
        console.log('  after:  longday=' + after.value + ' options=[' + after.options.join(',') + ']');
        console.log('  deselected day ' + longIso + ' (it held the long run) -> options no longer include it: ' +
          (after.options.indexOf(longIso) === -1));
        console.log('  select fell back to a still-selected day: ' + (after.options.indexOf(after.value) !== -1));
      }

      await ctx.close();
    }
  }

  await browser.close(); server.server.close();
  results.forEach(r => console.log(r.name.padEnd(40) + (r.errors.length ? '  ERRORS: ' + r.errors.join(' | ') : '  ok')));
  const bad = results.filter(r => r.errors.length);
  console.log('\n' + results.length + ' frames -> ' + OUT);
  console.log(bad.length ? 'PROBLEMS: ' + bad.map(b => b.name).join(', ') : 'all clean');
})();
