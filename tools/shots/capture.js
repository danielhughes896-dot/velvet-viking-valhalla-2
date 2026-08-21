'use strict';
/* VISUAL EVIDENCE, TAKEN FROM THE REAL RUNTIME.
 *
 * Serves protected/velvet-viking-valhalla.html over http (localStorage is not
 * reliable on file://), seeds one of the scenarios from states.js into
 * localStorage before the page boots, and photographs each surface at three
 * mobile widths in both themes.
 *
 *   node tools/shots/capture.js [outDir]
 *
 * Chromium comes from PLAYWRIGHT_BROWSERS_PATH; nothing is downloaded.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.join(__dirname, '..', '..');
const RUNTIME = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const OUT = process.argv[2] || path.join(__dirname, 'out');
const STATES = JSON.parse(fs.readFileSync(path.join(__dirname, 'states.json'), 'utf8'));

const WIDTHS = [360, 390, 430];
const THEMES = ['light', 'dark'];
const VIEWS = ['today', 'week', 'full', 'planhq', 'settings'];

/* Which combinations are worth a frame. The brief asks for both themes "where
   the surface materially changes" -- which for this app is everywhere, because
   the whole palette swaps -- but three widths of every view of every scenario
   is 180 images nobody will look at. So: every view at 390 in both themes for
   the primary scenarios, and the width sweep on the surfaces where layout
   actually differs (a session card, a week grid, the full plan). */
const PLAN = [];
Object.keys(STATES).forEach(scenario => {
  VIEWS.forEach(view => THEMES.forEach(theme => PLAN.push({ scenario, view, theme, width: 390 })));
});
['race', 'maintain'].forEach(scenario => {
  ['today', 'week', 'full'].forEach(view => {
    [360, 430].forEach(width => THEMES.forEach(theme => PLAN.push({ scenario, view, theme, width })));
  });
});
// The builder, with each programme purpose visible, and the first-run/start
// screen. Both come from an EMPTY state -- that is what a new athlete sees.
const BUILDER = [];
['race', 'maintain', 'base', 'speed'].forEach(purpose =>
  THEMES.forEach(theme => BUILDER.push({ purpose, theme, width: 390 })));

/* Runs in the page BEFORE any of the app's own script, which is the only
   moment localStorage can be seeded: the theme boot in <head> reads it on the
   very first line, and init() reads the plan immediately after. */
function seed(p){
  try { localStorage.setItem(p.key, p.state); } catch (e) {}
  try { localStorage.setItem('vvv_theme', JSON.stringify({ theme: p.theme, explicit: true })); } catch (e) {}
}
function seedTheme(p){
  // No plan blob here, so the mirror IS the source -- and only an explicit
  // choice is honoured, which is what `explicit` says.
  try { localStorage.setItem('vvv_theme', JSON.stringify({ theme: p.theme, explicit: true })); } catch (e) {}
}

/* The runtime at "/", every other path served from the site root so the crest,
   the icons and the manifest resolve. Without this the crest renders as a
   broken-image placeholder and the screenshots libel the app. */
const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg',
               '.webp':'image/webp', '.ico':'image/x-icon', '.json':'application/json',
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
  return new Promise(resolve => server.listen(0, '127.0.0.1',
    () => resolve({ server, url: 'http://127.0.0.1:' + server.address().port + '/' })));
}

async function shoot(ctx, url, name, opts){
  const o = opts || {};
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (o.init) await page.addInitScript(o.init, o.initArg);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  if (o.after) { try { await o.after(page); } catch (e) { errors.push('after: ' + e.message); } }
  await page.waitForTimeout(300);
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: true });
  /* OVERFLOW IS MEASURED, NOT EYEBALLED. The brief asks for no clipping and no
     horizontal scroll; a screenshot alone cannot prove that, so the page is
     asked directly and the answer travels with the image. */
  const metrics = await page.evaluate(() => {
    const de = document.documentElement;
    const out = { scrollW: de.scrollWidth, clientW: de.clientWidth, overflowing: [],
                  theme: de.getAttribute('data-theme'),
                  text: (document.body.innerText || '').slice(0, 20000) };
    // Only walk the DOM when the cheap check says there IS an overflow. On a
    // twelve-week Full Plan the walk is thousands of layout reads and it is
    // what made a full capture take an hour.
    if (out.scrollW > out.clientW + 1){
      const all = document.querySelectorAll('*');
      for (let i = 0; i < all.length && out.overflowing.length < 6; i++){
        const r = all[i].getBoundingClientRect();
        if (r.width > 0 && (r.right > out.clientW + 1 || r.left < -1))
          out.overflowing.push((all[i].tagName + '.' + (all[i].className || '')).slice(0, 60) +
                               ' @' + Math.round(r.right));
      }
    }
    return out;
  });
  await page.close();
  return { name, file, errors, metrics };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, url } = await serve();
  const browser = await playwright.chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--force-device-scale-factor=2'],
  });
  const results = [];

  for (const job of PLAN){
    const s = STATES[job.scenario];
    /* The theme goes INSIDE the plan blob, not just in the mirror key. The
       mirror is only consulted when there is no stored plan -- with one
       present, state.theme is the source of truth -- so seeding only the
       mirror produced byte-identical "light" and "dark" screenshots. */
    const state = Object.assign({}, s.state,
      { view: job.view, theme: job.theme, themeExplicit: true });
    const ctx = await browser.newContext({
      viewport: { width: job.width, height: 900 }, deviceScaleFactor: 2, isMobile: true,
      hasTouch: true, colorScheme: job.theme,
    });
    const r = await shoot(ctx, url,
      [job.scenario, job.view, job.theme, job.width].join('-'),
      { init: seed, initArg: { key: s.storageKey, state: JSON.stringify(state), theme: job.theme } });
    results.push(Object.assign(r, job));
    await ctx.close();
  }

  /* THE BUILDER, from an empty state -- which is what a new athlete sees. Each
     of the four programme purposes is selected in turn so the screenshots show
     what each one offers, including the fields that only a race build has. */
  for (const job of BUILDER){
    const ctx = await browser.newContext({
      viewport: { width: job.width, height: 900 }, deviceScaleFactor: 2, isMobile: true,
      hasTouch: true, colorScheme: job.theme,
    });
    const r = await shoot(ctx, url, ['builder', job.purpose, job.theme, job.width].join('-'), {
      init: seedTheme, initArg: { theme: job.theme },
      /* THE BUILDER IS BEHIND A DOOR. The first screen a new athlete sees is
         the entry card with "Build My Plan" on it; the purpose selector only
         exists once that has been pressed. The first version of this capture
         selected the purpose without opening the builder, swallowed the
         failure, and produced eight identical photographs of the landing
         page. Failures are raised now rather than caught. */
      after: async page => {
        await page.click('[data-action="open-setup"]');
        await page.waitForSelector('#su-purpose', { timeout: 5000 });
        await page.selectOption('#su-purpose', job.purpose);
        await page.waitForTimeout(400);
      },
    });
    results.push(Object.assign(r, { scenario: 'builder', view: job.purpose }, job));
    await ctx.close();
  }

  /* And the very first screen, untouched: no plan, no purpose chosen. */
  for (const theme of THEMES){
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 900 }, deviceScaleFactor: 2, isMobile: true,
      hasTouch: true, colorScheme: theme,
    });
    const r = await shoot(ctx, url, ['start', theme, 390].join('-'),
      { init: seedTheme, initArg: { theme } });
    results.push(Object.assign(r, { scenario: 'start', view: 'start', theme, width: 390 }));
    await ctx.close();
  }

  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 1));
  console.log('captured ' + results.length + ' frames into ' + OUT);
})().catch(e => { console.error(e); process.exit(1); });
