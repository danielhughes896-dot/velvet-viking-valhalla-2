'use strict';
/* SWAP THIS SESSION WITH... -- THE NATIVE PICKER, REPLACED.
 * ===========================================================================
 * before = the runtime at the branch base: a native <select>, which a phone
 *          draws as the OS picker in system grey with a system tint radio
 * after  = the plan's own rows, closed and with a day picked
 *
 * MEASURED as well as photographed, because a screenshot cannot prove that the
 * hidden <select> still holds the value handleSaveEdit() reads, and that is
 * the whole safety of the change.
 *
 *   node tools/shots/swap-list-shots.js [outDir]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const playwright = require('/opt/node22/lib/node_modules/playwright');
const ROOT = process.env.VVV_ROOT || path.join(__dirname, '..', '..');
const { loadApp } = require(path.join(ROOT, 'test', 'harness.js'));
const { buildPlan } = require(path.join(ROOT, 'test', 'fixtures.js'));

const AFTER  = path.join(ROOT, 'protected', 'velvet-viking-valhalla.html');
const BEFORE = process.env.VVV_BEFORE;
const OUT = process.argv[2] || path.join(__dirname, 'out-swap-list');
const TODAY = new Date().toISOString().slice(0, 10);

function athlete(){
  const a = loadApp({ pinnedDate: TODAY + 'T09:00:00Z' });
  a.showToast = () => {}; a.renderApp = () => {}; a.flushSave = () => {}; a.scheduleSave = () => {};
  buildPlan(a, { distanceKey: '10k', volume: 50, weeks: 12, lthr: 172, maxHR: 188,
                 startDate: a.addDays(TODAY, -7) });
  const dd = a.state.days.filter(d => d.type === 'interval' && d.date >= TODAY)[0]
          || a.state.days.filter(d => d.type === 'interval')[0];
  return { a, dd };
}
const { a: STATE, dd: DAY } = athlete();

const MIME = { '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json',
               '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2',
               '.html':'text/html; charset=utf-8' };
function serve(runtime){
  const html = fs.readFileSync(runtime, 'utf8');
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

function measure(){
  const list = document.querySelector('.swap-list');
  const sel = document.getElementById('ef-swap');
  const rows = [...document.querySelectorAll('.swap-day')];
  const box = el => { const b = el.getBoundingClientRect(); return Math.round(b.height); };
  return {
    hasNativeSelectVisible: !!sel && !sel.classList.contains('bld-mirror'),
    hasList: !!list,
    listH: list ? box(list) : null,
    rows: rows.length,
    weekHeads: document.querySelectorAll('.swap-week').length,
    rails: [...new Set(rows.map(r => [...r.classList].find(c => c.indexOf('type-') === 0)))].sort(),
    badges: [...new Set([...document.querySelectorAll('.swap-day .day-badge')].map(b => b.textContent.trim()))].sort(),
    picked: rows.filter(r => r.classList.contains('is-picked')).length,
    selValue: sel ? sel.value : null,
    rowH: rows.length ? box(rows[0]) : null,
    scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const base = JSON.parse(JSON.stringify(STATE.state));
  const browser = await playwright.chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const rows = [];
  const FRAMES = [];
  if (BEFORE) FRAMES.push({ tag: 'before', runtime: BEFORE, pick: false });
  FRAMES.push({ tag: 'after',        runtime: AFTER, pick: false });
  FRAMES.push({ tag: 'after-picked', runtime: AFTER, pick: true });

  for (const f of FRAMES){
    const { server, url } = await serve(f.runtime);
    for (const width of [360, 390, 430]){
      for (const theme of ['dark', 'light']){
        const ctx = await browser.newContext({ viewport: { width, height: 900 },
          deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: theme });
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(String(e && e.message || e)));
        await page.addInitScript(seed, { key: STATE.STORAGE_KEY,
          state: JSON.stringify(Object.assign({}, base, { view: 'full', theme, themeExplicit: true })) });
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(750);
        try { await page.evaluate((id) => { openEditModal(id); }, DAY.id); }
        catch (e) { errors.push('open: ' + e.message); }
        await page.waitForTimeout(350);
        if (f.pick){
          try { await page.evaluate(() => {
            const r = document.querySelectorAll('.swap-day')[2];
            if (r) r.click();
          }); } catch (e) { errors.push('pick: ' + e.message); }
          await page.waitForTimeout(250);
        }
        // bring the Reschedule fieldset into view inside the modal
        try { await page.evaluate(() => {
          const el = document.querySelector('.swap-list') || document.getElementById('ef-swap');
          if (el) el.scrollIntoView({ block: 'center' });
        }); } catch (e) {}
        await page.waitForTimeout(200);
        const m = await page.evaluate(measure);
        if (f.tag !== 'before' && !m.hasList) errors.push('no swap list rendered — this frame proves nothing');
        const file = f.tag + '-' + width + '-' + theme;
        await page.screenshot({ path: path.join(OUT, file + '.png'), fullPage: true });
        rows.push({ file, tag: f.tag, width, theme, errors, m });
        console.log(file.padEnd(24) +
          ' nativeSelect=' + m.hasNativeSelectVisible +
          ' list=' + (m.hasList ? m.listH + 'px' : 'none') +
          ' rows=' + m.rows + ' weeks=' + m.weekHeads +
          ' picked=' + m.picked + ' selValue=' + JSON.stringify(m.selValue) +
          ' rowH=' + m.rowH +
          ' xoverflow=' + (m.scrollW > m.clientW + 1 ? 'YES' : 'no') +
          (errors.length ? '  ERRORS: ' + errors.slice(0, 2).join(' | ') : ''));
        if (width === 390 && theme === 'dark' && m.hasList){
          console.log('      rails  ' + JSON.stringify(m.rails));
          console.log('      badges ' + JSON.stringify(m.badges));
        }
        await page.close(); await ctx.close();
      }
    }
    server.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(rows, null, 2));
  const bad = rows.filter(r => r.errors.length || r.m.scrollW > r.m.clientW + 1);
  console.log('\n' + rows.length + ' frames, ' + bad.length + ' with a problem');
  bad.forEach(b => console.log('  ' + b.file + ': ' + (b.errors.join(' | ') || 'layout')));
})();
